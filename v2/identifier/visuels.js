'use strict';
// B1b.4 puis COTES-VISUELS — les visuels servis depuis NOS fichiers et les impressions d'une métacarte, lus dans la version EN MÉMOIRE que le chargeur (v2/chargeur) bascule d'un geste.
// Les règles d'admission d'un visuel vivent dans le SITE (§5 Q11) : le serveur sert ce qu'on lui a DONNÉ (la décision, calculée hors de la requête), et ne les recopie pas.
// 🔑 La collection `visuels` N'EXISTE PLUS (décision du testeur, 2026-10-11 : aucun import dans la grappe de production). Ce module ne lit AUCUNE collection de `cartes` ; seul le guide
// de prix se lit en direct (il vit dans la base de l'API). Chaque entrée chargée passe par lireEntree (v2/chargeur/version.js).
// Écrit par ce qu'il AUTORISE : une clé n'est servie que si elle est un chemin relatif propre ; le reste donne null.
const { lireConfig } = require('../config');
const db = require('../db');
const etat = require('../chargeur/etat');
const { VARIANTES } = require('./produit');
const { lienServi } = require('./lien-cardmarket');
const { langueDeTirage } = require('./langue-decisive');
const { separeeParVariante } = require('./partage-variante');
const { setWcdDeLEntree } = require('./marqueurs');
const { marquesProuvees, estVariante } = require('./marques-tampon');

// LISTE FERMÉE des collections que ce module lit. Tout autre nom est refusé AVANT la lecture ; un test échoue si ce fichier en nomme une autre.
const COLLECTIONS_LUES = Object.freeze(['guide_prix']);
function colLue(nom) {
    if (!COLLECTIONS_LUES.includes(nom)) throw new Error(`visuels.js : la collection "${nom}" n'est pas lisible (liste fermée : ${COLLECTIONS_LUES.join(', ')}) — l'API ne lit jamais la base cartes`);
    return db.col(nom);
}

// Une clé R2 est un chemin relatif : ni schéma ("://"), ni remontée (".."), ni Cardmarket, ni barre initiale/inverse, ni segment vide ou ".".
const CLE = /^[A-Za-z0-9][A-Za-z0-9._\-\/]*$/;
function cleMotif(cle) {
    if (typeof cle !== 'string' || !cle.trim()) return 'clé absente';
    if (cle.includes('://')) return 'clé avec "://"';
    if (cle.includes('..')) return 'clé avec ".."';
    if (/cardmarket/i.test(cle)) return 'clé Cardmarket';
    if (!CLE.test(cle)) return 'clé hors forme';
    if (cle.split('/').some(s => s === '' || s === '.')) return 'clé avec un segment vide ou "."';
    return null;
}
const entierPositif = x => Number.isInteger(x) && x > 0;
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);
const chaineOuNull = x => (typeof x === 'number' && Number.isFinite(x) ? String(x) : texte(x));

function fichier(f, nom) {
    if (!f || typeof f !== 'object') return { motif: `${nom} absente` };
    const m = cleMotif(f.cle);
    if (m) return { motif: `${nom} : ${m}` };
    if (!entierPositif(f.w) || !entierPositif(f.h)) return { motif: `${nom} : w/h non entiers positifs` };
    return { fichier: { cle: f.cle, w: f.w, h: f.h } };
}
function lienCardmarket(u) {
    if (typeof u !== 'string') return false;
    let p; try { p = new URL(u); } catch { return false; }
    return p.protocol === 'https:' && !p.username && !p.password && !p.port && (p.hostname === 'www.cardmarket.com' || p.hostname === 'cardmarket.com');
}

/** Les champs d'impression doivent être PRÉSENTS (null admis : « non lu »), jamais absents : un champ qui manque n'est pas un champ non lu. */
const CHAMPS_IMPRESSION = Object.freeze(['idMetacard', 'numero', 'rarete', 'total']);

// REPLI-REIMPRESSIONS — les MARQUAGES « partagée » que le catalogue pose sur l'image servie (cartes.images) : un visuel qui sert plusieurs produits que l'IMAGE ne sépare pas.
//   partageeHoloNonHolo     true : le même scan sert le produit holo ET le non-holo (Prize Packs S1-S4) ;
//   partageeTamponNonSepare true : le même scan sert une paire dont l'une est tamponnée (Staff…) et l'on ne sait pas laquelle ; false : la paire est SÉPARÉE par l'étiquette Cardmarket (la liste est gardée) ;
//   produitsPartages        les idProduct qui partagent ce scan (celui de l'entrée compris) ; tamponNonRepresente le tampon que le scan ne montre pas (« Staff », « Play! Pokémon ») ;
//   basseDefinition         l'original est sous 350 px (gardé dans l'archive, décision du coordinateur).
// Écrit par ce qu'il AUTORISE : un booléen est true/false/null (absent = null), rien d'autre ; une liste n'existe qu'avec un marquage de partage, et inversement ; elle contient le produit de l'entrée.
const PARTAGES_MAX = 6, TAMPON_MAX = 40;
const booleenOuNull = x => x === undefined || x === null || typeof x === 'boolean';
function lireMarquages(e) {
    for (const c of ['partageeHoloNonHolo', 'partageeTamponNonSepare', 'basseDefinition']) if (!booleenOuNull(e[c])) return { motif: `champ "${c}" ni booleen ni null` };
    const holo = e.partageeHoloNonHolo === undefined ? null : e.partageeHoloNonHolo, tampon = e.partageeTamponNonSepare === undefined ? null : e.partageeTamponNonSepare;
    const basse = e.basseDefinition === undefined ? null : e.basseDefinition;
    let tn = null;
    if (e.tamponNonRepresente !== undefined && e.tamponNonRepresente !== null) {
        if (typeof e.tamponNonRepresente !== 'string' || !e.tamponNonRepresente.trim() || e.tamponNonRepresente.trim().length > TAMPON_MAX) return { motif: 'champ "tamponNonRepresente" ni null ni un texte non vide' };
        tn = e.tamponNonRepresente.trim();
    }
    const partage = holo === true || tampon !== null;
    let liste = null;
    if (e.produitsPartages !== undefined && e.produitsPartages !== null) {
        const l = e.produitsPartages;
        if (!Array.isArray(l) || l.length < 2 || l.length > PARTAGES_MAX || !l.every(x => Number.isInteger(x) && x > 0) || new Set(l).size !== l.length) return { motif: `champ "produitsPartages" : entre 2 et ${PARTAGES_MAX} idProduct entiers distincts attendus` };
        if (!l.includes(e.idProduct)) return { motif: 'champ "produitsPartages" ne contient pas le produit de l\'entrée' };
        liste = [...l].sort((a, b) => a - b);
    }
    // PARTAGES-VARIANTE : UNE seule forme sans liste est admise — la paire séparée par la variante (partage-variante.js, la même définition que la décision, la structure de l'archive et F1) ; tout le reste reste refusé
    if (partage && liste === null && !separeeParVariante({ partageeHoloNonHolo: holo, partageeTamponNonSepare: tampon, produitsPartages: null }, texte(e.variante))) return { motif: 'marquage de partage sans "produitsPartages"' };
    if (!partage && liste !== null) return { motif: '"produitsPartages" sans marquage de partage (partageeHoloNonHolo ou partageeTamponNonSepare)' };
    return { marquages: { partageeHoloNonHolo: holo, partageeTamponNonSepare: tampon, produitsPartages: liste, tamponNonRepresente: tn, basseDefinition: basse } };
}

/**
 * Une entrée d'export -> le document `visuels`, ou un refus MOTIVÉ. Entrée : { idProduct, vignette:{cle,w,h}, grande:{cle,w,h}|null,
 * visuel?:'du-set'|'substitut'|'autre-tirage', mention?, idMetacard:int|null, numero, rarete, total, variante?, setNom?, lien?,
 * partageeHoloNonHolo?, partageeTamponNonSepare?, produitsPartages?, tamponNonRepresente?, basseDefinition? }.
 * Un visuel qui n'est pas celui du set n'est admis qu'avec sa mention.
 */
function lireEntree(e) {
    if (!e || typeof e !== 'object') return { ok: false, motif: 'entrée illisible' };
    if (!Number.isInteger(e.idProduct) || e.idProduct <= 0) return { ok: false, motif: 'idProduct non entier' };
    const v = fichier(e.vignette, 'vignette');
    if (!v.fichier) return { ok: false, motif: v.motif };
    let g = null;
    if (e.grande !== null && e.grande !== undefined) { const r = fichier(e.grande, 'grande'); if (!r.fichier) return { ok: false, motif: r.motif }; g = r.fichier; }
    const nature = e.visuel === undefined || e.visuel === null ? 'du-set' : e.visuel;
    if (!['du-set', 'substitut', 'autre-tirage'].includes(nature)) return { ok: false, motif: `nature de visuel inconnue "${nature}"` };
    const mention = texte(e.mention);
    // MARQUEURS (CONTRAT-MARQUEURS.md §6) : l'UNIQUE exception — un visuel `autre-tirage` (l'emprunt marqué du catalogue) d'un produit d'un set WCD-<aaaa>, reconnu sur l'entrée elle-même (lien Cardmarket ou nom affiché),
    // s'affiche sans mention : le bandeau WCD / NON_LEGAL la remplace. Un substitut, et tout autre set, gardent l'exigence.
    if (nature !== 'du-set' && !mention && !(nature === 'autre-tirage' && setWcdDeLEntree(e))) return { ok: false, motif: 'visuel de substitution sans mention' };
    for (const c of CHAMPS_IMPRESSION) if (e[c] === undefined) return { ok: false, motif: `champ "${c}" absent (null admis, absent non)` };
    if (e.idMetacard !== null && !(Number.isInteger(e.idMetacard) && e.idMetacard > 0)) return { ok: false, motif: 'idMetacard ni entier ni null' };
    if (e.lien !== undefined && e.lien !== null && !lienCardmarket(e.lien)) return { ok: false, motif: 'lien hors Cardmarket (https://www.cardmarket.com/…)' };
    const m = lireMarquages(e);
    if (!m.marquages) return { ok: false, motif: m.motif };
    return { ok: true, doc: {
        idProduct: e.idProduct, vignette: v.fichier, grande: g, mention,
        idMetacard: e.idMetacard, numero: chaineOuNull(e.numero), rarete: texte(e.rarete), total: chaineOuNull(e.total),
        variante: estVariante(texte(e.variante)) ? texte(e.variante) : null,                     // LOT TAMPONS (M3) : la liste fermée (marques-tampon.js) s'applique AUSSI à la lecture : hors liste = null, comme le producteur
        setNom: texte(e.setNom), lien: e.lien ? e.lien : null,
        ...m.marquages
    } };
}

const urlDe = (hote, f) => `https://${hote}/${f.cle}`;
const prix = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const dateGuide = d => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10)
    : typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);
/** Ligne de guide -> la forme que construireProduit lit ({ trend, low, avg7, avg30, guideDu }) ; un prix non daté n'est pas servi. F4-PRIX : avg7 sert à juger l'écart de la tendance. */
function prixGuide(g) {
    if (!g) return null;
    const guideDu = dateGuide(g.guideDu), trend = prix(g.trend), low = prix(g.low), avg7 = prix(g.avg7), avg30 = prix(g.avg30);
    if (!guideDu || (trend === null && low === null && avg30 === null)) return null;
    return Object.freeze({ trend, low, avg7, avg30, guideDu });
}

function creerVisuels(opts = {}) {
    const cfg = opts.cfg || lireConfig();
    const hote = cfg.images.hotesPublics[0];
    // La version EN MÉMOIRE (v2/chargeur/etat.js) : relue à CHAQUE appel, jamais gardée (la bascule du chargeur est visible tout de suite). Aucune version = l'état « sans visuel ».
    const version = opts.version || (() => etat.version());
    /** L'entrée d'un produit (le document validé par lireEntree au chargement), ou null. Synchrone : la mémoire seule. */
    function entree(idProduct) { const v = version(); return v && Number.isInteger(idProduct) ? v.entree(idProduct) : null; }

    async function resoudre(idProduct) {
        if (!Number.isInteger(idProduct)) return null;
        const d = entree(idProduct);
        if (!d) return null;
        const v = fichier(d.vignette, 'vignette').fichier;
        if (!v) return null;                                                   // une clé interdite n'est jamais servie (défense en profondeur : le chargement l'a déjà refusée)
        const g = d.grande ? fichier(d.grande, 'grande').fichier : null;
        return { url: urlDe(hote, v), w: v.w, h: v.h, grande: g ? { url: urlDe(hote, g), w: g.w, h: g.h } : null, mention: texte(d.mention) };
    }

    // Les impressions d'une métacarte : les entrées EN MÉMOIRE de même idMetacard, rien d'autre. Le lien n'est servi
    // que si le numéro est connu ET que l'URL est la page exacte du produit (la rareté, lue sur cartes.impressions[].rarete, n'est plus exigée).
    async function impressions(idMetacard) {
        const v = version();
        if (!v || !Number.isInteger(idMetacard)) return [];
        const docs = v.produitsDeMetacarte(idMetacard).map(id => v.entree(id)).filter(Boolean);
        if (!docs.length) return [];
        const guides = new Map((await colLue('guide_prix').find({ idProduct: { $in: docs.map(d => d.idProduct) } }).toArray()).map(g => [g.idProduct, g]));
        const sortie = docs.map(d => {
            const numero = chaineOuNull(d.numero), rarete = texte(d.rarete);
            const lien = lienServi(d.lien, numero);                          // LIEN-CARDMARKET : numéro connu + page produit exacte (rareté non exigée)
            return Object.freeze({
                idProduct: d.idProduct, numero, total: chaineOuNull(d.total), rarete,
                variante: VARIANTES.includes(d.variante) ? d.variante : null,                          // V1/V2 n'a pas de sémantique (CLAUDE.md §7)
                marques: marquesProuvees(d.variante),                                                  // LOT TAMPONS (ajout additif) : les marques prouvées de CETTE impression
                prixMelangeTampon: typeof v.prixMelange === 'function' && v.prixMelange(d.idProduct) === true,   // LOT TAMPONS (B) : la colonne PROPRE de l'archive (=== true seulement) ; le catalogue la réunit à numeros_cartes
                langue: langueDeTirage(typeof v.tirageJumeaux === 'function' ? v.tirageJumeaux(d.idProduct) : null),   // CONTRAT 7a : la langue du TIRAGE de CETTE impression (jp -> ja, zh-hans, zh-hant, ko) ; intl, id, th, idth : null, jamais devinée
                set: Object.freeze({ nom: texte(d.setNom) }), lien, prixGuide: prixGuide(guides.get(d.idProduct))
            });
        });
        return sortie.sort((a, b) => (Number(a.numero) || 1e9) - (Number(b.numero) || 1e9) || a.idProduct - b.idProduct);
    }
    /** Un jeu de lecteurs LIÉ à la version en place À CET INSTANT : une requête qui lit le visuel, l'entrée et les impressions d'un produit ne mêle jamais deux versions (revue M6). */
    function instantane() { const fixe = version(); return creerVisuels({ ...opts, cfg, version: () => fixe }); }
    /** GARDE-CONTRADICTION : la langue de tirage d'un produit (colonne des jumeaux de la version en place), ou null. Synchrone. */
    function tirage(idProduct) { const v = version(); return v && typeof v.tirageJumeaux === 'function' ? v.tirageJumeaux(idProduct) : null; }
    /** LOT TAMPONS (B, tour 1) : ce produit est-il marqué `prixMelangeTampon` (colonne propre de la version en place, sans dépendre d'une entrée) ? true / false ; null sans colonne. */
    function prixMelange(idProduct) { const v = version(); return v && typeof v.prixMelange === 'function' ? v.prixMelange(idProduct) : null; }
    /**
     * MARQUE-EMPRUNT : le visuel de ce produit est-il emprunté à un autre tirage (colonne propre de la version en place) ? true / false ; null = on ne sait pas (archive d'avant la colonne, aucune version,
     * identifiant non entier) — jamais « non emprunté » en silence. Les règles d'image lisent null comme emprunté : identifier/emprunt.js (`empruntOuInconnu`).
     */
    function empruntDe(idProduct) { const v = version(); return v && typeof v.empruntDe === 'function' ? v.empruntDe(idProduct) : null; }
    return { resoudre, impressions, entree, instantane, tirage, prixMelange, empruntDe };
}

module.exports = { creerVisuels, lireEntree, cleMotif, colLue, COLLECTIONS_LUES, CHAMPS_IMPRESSION, prix, dateGuide };
