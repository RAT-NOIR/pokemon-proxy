'use strict';
// B1b.3 — la lecture du catalogue de l'API : les LIGNES (ProduitSource) que construireProduit/l'adaptateur attendent, pour une liste d'idProduct.
// 🔑 Aucune lecture de la base `cartes` ici : LISTE FERMÉE de trois collections, toutes dans la base de l'API —
//    `numeros_cartes` (numéro, code et slug de set, nom français), `catalogue_produits` (nom Cardmarket, métacarte), `guide_prix` (prix daté).
//    Les visuels et les impressions viennent de la version EN MÉMOIRE du chargeur (visuels.js, `entree`) : plus de collection `visuels`. Une autre collection est refusée AVANT la lecture.
// Écrit par ce qu'il AUTORISE : un produit n'entre dans la table que s'il a un nom Cardmarket ET un set nommable ; sinon il en est ABSENT, et l'adaptateur
// refuse alors d'affirmer (panne SERVEUR remboursée) — on n'invente ni un nom ni un set. Une lecture qui ÉCHOUE lève : l'appelant en fait une panne
// INDISPONIBLE (jamais un « introuvable »).
const db = require('../db');
const { lireConfig } = require('../config');
const { creerVisuels } = require('./visuels');
const { VARIANTES } = require('./produit');
const { construireIndexVerifie, INDEX_CODE_NUMERO_MIN } = require('./langue-decisive');
const { versionDe } = require('./fiabilite-prix');

const COLLECTIONS_LUES = Object.freeze(['numeros_cartes', 'catalogue_produits', 'guide_prix']);
function colLue(nom) {
    if (!COLLECTIONS_LUES.includes(nom)) throw new Error(`catalogue.js : la collection "${nom}" n'est pas lisible (liste fermée : ${COLLECTIONS_LUES.join(', ')}) — l'API ne lit jamais la base cartes`);
    return db.col(nom);
}
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const lisible = slug => slug.replace(/-/g, ' ');

const IMPRESSIONS_MAX_TIME_MS = 1500;      // côté base : la requête des versions d'impressions ne dépasse jamais 1,5 s
const IMPRESSIONS_DELAI_MS = 2000;         // côté serveur : au-delà, abandonnée (les impressions sont non lues)

function creerCatalogue(opts = {}) {
    const cfg = opts.cfg || lireConfig();
    const visuels = opts.visuels || creerVisuels({ cfg });

    // JUMEAU-V2 : y a-t-il, dans le catalogue d'AUJOURD'HUI, un produit PLUS RÉCENT que l'archive (idProduct > maxArchive) de la MÊME métacarte ? C'est le seul cas où la colonne des jumeaux
    // (fabriquée plus tôt) peut ignorer un jumeau du produit que la route s'apprête à affirmer. Une requête INDEXÉE (l'index unique sur idProduct borne le balayage aux produits plus récents que
    // l'archive : quelques dizaines), une par produit affirmé, jamais une lecture globale. Rend true / false ; une lecture qui échoue LÈVE (l'appelant en fait « on ne peut pas conclure »).
    async function plusRecentDansMetacarte(maxArchive, idMetacard) {
        if (!Number.isInteger(maxArchive) || !Number.isInteger(idMetacard)) throw new Error('plusRecentDansMetacarte : entiers attendus');
        const trouves = await colLue('catalogue_produits').find({ idProduct: { $gt: maxArchive }, idMetacard }, { projection: { idProduct: 1 } }).limit(1).toArray();
        return trouves.length > 0;
    }

    // LANGUE-DECISIVE M2 : l'index code × numéro du CATALOGUE ENTIER (numeros_cartes : 73 756 lignes, projection de trois champs), construit UNE fois puis gardé 6 h (le catalogue change à chaque import quotidien) ;
    // coût mémoire : une chaîne courte par couple (chiffres du numéro, code) distinct, mesuré dans le rapport du lot. Une lecture qui ÉCHOUE lève : l'appelant ferme R4 (jamais une R4 sans index).
    // La lecture est précédée d'un COMPTE de la même collection avec le même filtre : moins de documents lus que comptés = lecture tronquée, refusée (R4 fermée) ; plancher de 10 000 couples en plus (M-B).
    let indexEnCours = null, indexLe = 0, indexPret = null;
    const INDEX_DUREE_MS = 6 * 3600 * 1000;
    async function indexCodeNumero() {
        if (indexEnCours && Date.now() - indexLe < INDEX_DUREE_MS) return indexEnCours;
        const p = (async () => {
            const col = colLue('numeros_cartes');
            const attendu = await col.countDocuments({});
            const docs = await col.find({}, { projection: { codeSet: 1, numero: 1, numeroUrl: 1 } }).toArray();
            return construireIndexVerifie(docs, INDEX_CODE_NUMERO_MIN, attendu);               // sous le plancher ou tronqué : LÈVE (R4 fermée)
        })();
        indexEnCours = p; indexLe = Date.now();
        p.then(idx => { if (indexEnCours === p) indexPret = idx; }, () => { if (indexEnCours === p) { indexEnCours = null; indexLe = 0; } });      // un échec n'est pas gardé
        return p;
    }
    // Sans attente : l'index PRÊT (même un peu périmé pendant sa reconstruction), ou null — et la construction part en ARRIÈRE-PLAN. Tant qu'il n'est pas prêt R4 est FERMÉE, le scan ne l'attend jamais (le suivant en profite).
    function indexSansAttente() {
        if (!indexEnCours || Date.now() - indexLe >= INDEX_DUREE_MS) indexCodeNumero().catch(() => { });
        return indexPret;
    }

    /** @returns Promise<Map<idProduct, ProduitSource>> — les produits introuvables ou innommables sont ABSENTS de la table. */
    async function lire(idProducts) {
        const ids = [...new Set((Array.isArray(idProducts) ? idProducts : []).filter(Number.isInteger))];
        const table = new Map();
        if (!ids.length) return table;
        const filtre = { idProduct: { $in: ids } };
        const [cats, nums, guides] = await Promise.all(['catalogue_produits', 'numeros_cartes', 'guide_prix'].map(n => colLue(n).find(filtre).toArray()));
        const parId = l => new Map(l.map(d => [d.idProduct, d]));
        const C = parId(cats), N = parId(nums), G = parId(guides);
        const vis = visuels.instantane ? visuels.instantane() : visuels;                  // UNE version pour toute la requête : jamais un visuel d'une version et une impression d'une autre
        for (const id of ids) {
            const c = C.get(id), n = N.get(id) || {}, v = (vis.entree && vis.entree(id)) || {};     // le visuel et l'impression : la version EN MÉMOIRE du chargeur
            const nom = c && texte(c.name);
            const slug = texte(n.slugSet) || texte(n.codeSet);
            if (!nom || !slug) continue;
            const g = G.get(id);
            const visuel = await vis.resoudre(id);
            const impressions = Number.isInteger(c.idMetacard) ? await vis.impressions(c.idMetacard) : [];
            table.set(id, {
                idProduct: id, nomCardmarket: nom, nomFr: texte(n.nomFr), idExpansion: Number.isInteger(n.idExpansion) ? n.idExpansion : (Number.isInteger(c.idExpansion) ? c.idExpansion : null),   // R5 (non servi : construireProduit ne le lit pas)
                set: { slug, nom: texte(v.setNom) || lisible(slug), code: texte(n.codeSet), tirage: null, annee: null, symbole: null },
                numero: texte(n.numero) || texte(n.numeroUrl), total: v.total ?? null, langue: null, setTcgdex: texte(n.setTcgdex), tirageSource: texte(typeof vis.tirage === 'function' ? vis.tirage(id) : null),   // GARDE-CONTRADICTION : le set TCGdex appris de l'expansion (non servi : construireProduit ne le lit pas)
                variante: VARIANTES.includes(v.variante) ? v.variante : null, rarete: texte(v.rarete),
                visuel: visuel ? { url: visuel.url, w: visuel.w, h: visuel.h, grande: visuel.grande } : null, visuelMention: visuel ? visuel.mention : null,
                prixGuide: g ? { trend: g.trend, low: g.low, avg7: g.avg7, avg30: g.avg30, guideDu: g.guideDu } : null,   // la date du GUIDE (jamais celle de l'import) ; avg7 : F4-PRIX, l'écart de la tendance
                // F4-PRIX : la version Cardmarket (V1, V2… : numeros_cartes.variante, ce qui sépare deux produits au même set et au même numéro) et le prix MÉLANGÉ (la fiche réunit la version normale et une
                // version tamponnée : `prixMelangeTampon`, posé par le catalogue). Lus sur la ligne du produit, par le chemin qui sert déjà l'identification ; === true seulement.
                version: versionDe(n.variante), prixMelangeTampon: n.prixMelangeTampon === true,
                lienCardmarket: texte(v.lien), impressions
            });
        }
        await completerImpressions(table, N);
        return table;
    }
    // Les impressions d'une métacarte viennent de la version en mémoire du chargeur (visuels.js), qui ne lit pas numeros_cartes (liste fermée). Leur version Cardmarket et leur prix mélangé se lisent
    // ici, en UNE requête indexée sur tous les produits des impressions qu'on ne connaît pas encore. Une impression absente de numeros_cartes : version null, prix non mélangé (rien d'inventé).
    // Tour tour 1 (I2) : la requête est BORNÉE (maxTimeMS nommé, limit = nombre d'ids demandés, délai nommé côté serveur) et ISOLÉE (try) : sa panne ne casse JAMAIS l'identification. Une impression dont la ligne
    // n'a pas été lue (absente de numeros_cartes, ou lecture en panne) est `nonLu: true` : version null, prixMelangeTampon false SANS valeur de preuve, et son prix n'est jamais fiable (ecart-non-mesurable).
    async function completerImpressions(table, deja) {
        const ids = new Set();
        for (const ligne of table.values()) for (const i of ligne.impressions) if (!deja.has(i.idProduct)) ids.add(i.idProduct);
        let autres = new Map();
        if (ids.size) {
            let minuterie;
            try {
                const lecture = Promise.resolve().then(() => colLue('numeros_cartes').find({ idProduct: { $in: [...ids] } },
                    { projection: { idProduct: 1, variante: 1, prixMelangeTampon: 1 }, maxTimeMS: IMPRESSIONS_MAX_TIME_MS, limit: ids.size }).toArray());
                const delai = new Promise((_, ko) => { minuterie = setTimeout(() => ko(new Error('délai dépassé')), opts.delaiImpressionsMs || IMPRESSIONS_DELAI_MS); });
                autres = new Map((await Promise.race([lecture, delai])).map(d => [d.idProduct, d]));
            } catch (e) {
                autres = new Map();
                console.warn(`⚠️ [catalogue] lecture des versions des impressions en panne (${(e && (e.code || e.name)) || 'erreur'}) : ${ids.size} impression(s) non lue(s), prix non fiables`);
            } finally { clearTimeout(minuterie); }
        }
        for (const ligne of table.values())
            ligne.impressions = ligne.impressions.map(i => {
                const d = deja.get(i.idProduct) || autres.get(i.idProduct);
                return Object.freeze(d ? { ...i, version: versionDe(d.variante), prixMelangeTampon: d.prixMelangeTampon === true, nonLu: false } : { ...i, version: null, prixMelangeTampon: false, nonLu: true });
            });
    }
    return { lire, plusRecentDansMetacarte, indexCodeNumero, indexSansAttente };
}
module.exports = { creerCatalogue, COLLECTIONS_LUES, colLue, IMPRESSIONS_MAX_TIME_MS, IMPRESSIONS_DELAI_MS };
