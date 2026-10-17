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

const COLLECTIONS_LUES = Object.freeze(['numeros_cartes', 'catalogue_produits', 'guide_prix']);
function colLue(nom) {
    if (!COLLECTIONS_LUES.includes(nom)) throw new Error(`catalogue.js : la collection "${nom}" n'est pas lisible (liste fermée : ${COLLECTIONS_LUES.join(', ')}) — l'API ne lit jamais la base cartes`);
    return db.col(nom);
}
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const lisible = slug => slug.replace(/-/g, ' ');

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
                idProduct: id, nomCardmarket: nom, nomFr: texte(n.nomFr),
                set: { slug, nom: texte(v.setNom) || lisible(slug), code: texte(n.codeSet), tirage: null, annee: null, symbole: null },
                numero: texte(n.numero) || texte(n.numeroUrl), total: v.total ?? null, langue: null, setTcgdex: texte(n.setTcgdex), tirageSource: texte(typeof vis.tirage === 'function' ? vis.tirage(id) : null),   // GARDE-CONTRADICTION : le set TCGdex appris de l'expansion (non servi : construireProduit ne le lit pas)
                variante: VARIANTES.includes(v.variante) ? v.variante : null, rarete: texte(v.rarete),
                visuel: visuel ? { url: visuel.url, w: visuel.w, h: visuel.h, grande: visuel.grande } : null, visuelMention: visuel ? visuel.mention : null,
                prixGuide: g ? { trend: g.trend, low: g.low, avg30: g.avg30, guideDu: g.guideDu } : null,   // la date du GUIDE (jamais celle de l'import)
                lienCardmarket: texte(v.lien), impressions
            });
        }
        return table;
    }
    return { lire, plusRecentDansMetacarte };
}
module.exports = { creerCatalogue, COLLECTIONS_LUES, colLue };
