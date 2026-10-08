'use strict';
// B1b.4 — les visuels servis depuis NOS fichiers (collection `visuels`, importée par v2/migrations/importer-visuels.js) et les impressions
// d'une métacarte. Les règles d'admission d'un visuel vivent dans le SITE (§5 Q11) : le serveur sert ce qu'on lui a DONNÉ, et ne les recopie pas.
// 🔑 L'API ne lit JAMAIS la base `cartes` (autre grappe, MONGODB_CARTES_URI) : tout ce qu'elle sert d'une impression (numéro, total, rareté, set,
// variante, lien) est porté par le document `visuels` ET DONNÉ À L'IMPORT. Seul le guide de prix se lit en direct (il vit dans la base de l'API).
// Écrit par ce qu'il AUTORISE : une clé n'est servie que si elle est un chemin relatif propre ; le reste donne null.
const { lireConfig } = require('../config');
const db = require('../db');
const { VARIANTES } = require('./produit');

// LISTE FERMÉE des collections que ce module lit. Tout autre nom est refusé AVANT la lecture ; un test échoue si ce fichier en nomme une autre.
const COLLECTIONS_LUES = Object.freeze(['visuels', 'guide_prix']);
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

/**
 * Une entrée d'export -> le document `visuels`, ou un refus MOTIVÉ. Entrée : { idProduct, vignette:{cle,w,h}, grande:{cle,w,h}|null,
 * visuel?:'du-set'|'substitut'|'autre-tirage', mention?, idMetacard:int|null, numero, rarete, total, variante?, setNom?, lien? }.
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
    if (nature !== 'du-set' && !mention) return { ok: false, motif: 'visuel de substitution sans mention' };
    for (const c of CHAMPS_IMPRESSION) if (e[c] === undefined) return { ok: false, motif: `champ "${c}" absent (null admis, absent non)` };
    if (e.idMetacard !== null && !(Number.isInteger(e.idMetacard) && e.idMetacard > 0)) return { ok: false, motif: 'idMetacard ni entier ni null' };
    if (e.lien !== undefined && e.lien !== null && !lienCardmarket(e.lien)) return { ok: false, motif: 'lien hors Cardmarket (https://www.cardmarket.com/…)' };
    return { ok: true, doc: {
        idProduct: e.idProduct, vignette: v.fichier, grande: g, mention,
        idMetacard: e.idMetacard, numero: chaineOuNull(e.numero), rarete: texte(e.rarete), total: chaineOuNull(e.total),
        variante: texte(e.variante), setNom: texte(e.setNom), lien: e.lien ? e.lien : null
    } };
}

const urlDe = (hote, f) => `https://${hote}/${f.cle}`;
const prix = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
const dateGuide = d => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10)
    : typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? d : null);
/** Ligne de guide -> la forme que construireProduit lit ({ trend, low, avg30, guideDu }) ; un prix non daté n'est pas servi. */
function prixGuide(g) {
    if (!g) return null;
    const guideDu = dateGuide(g.guideDu), trend = prix(g.trend), low = prix(g.low), avg30 = prix(g.avg30);
    if (!guideDu || (trend === null && low === null && avg30 === null)) return null;
    return Object.freeze({ trend, low, avg30, guideDu });
}

function creerVisuels(opts = {}) {
    const cfg = opts.cfg || lireConfig();
    const hote = cfg.images.hotesPublics[0];

    async function resoudre(idProduct) {
        if (!Number.isInteger(idProduct)) return null;
        const d = await colLue('visuels').findOne({ idProduct });
        if (!d) return null;
        const v = fichier(d.vignette, 'vignette').fichier;
        if (!v) return null;                                                   // une clé interdite posée hors import n'est jamais servie
        const g = d.grande ? fichier(d.grande, 'grande').fichier : null;
        return { url: urlDe(hote, v), w: v.w, h: v.h, grande: g ? { url: urlDe(hote, g), w: g.w, h: g.h } : null, mention: texte(d.mention) };
    }

    // Les impressions d'une métacarte : les documents `visuels` de même idMetacard (index visuels_metacarte), rien d'autre. Le lien n'est servi
    // que si numéro ET rareté sont connus (la rareté vient de l'import, lue sur cartes.impressions[].rarete, jamais devinée).
    async function impressions(idMetacard) {
        if (!Number.isInteger(idMetacard)) return [];
        const docs = await colLue('visuels').find({ idMetacard }).toArray();
        if (!docs.length) return [];
        const guides = new Map((await colLue('guide_prix').find({ idProduct: { $in: docs.map(d => d.idProduct) } }).toArray()).map(g => [g.idProduct, g]));
        const sortie = docs.map(d => {
            const numero = chaineOuNull(d.numero), rarete = texte(d.rarete);
            const lien = numero && rarete && lienCardmarket(d.lien) ? d.lien : null;                     // jamais de lien anonyme
            return Object.freeze({
                idProduct: d.idProduct, numero, total: chaineOuNull(d.total), rarete,
                variante: VARIANTES.includes(d.variante) ? d.variante : null,                          // V1/V2 n'a pas de sémantique (CLAUDE.md §7)
                set: Object.freeze({ nom: texte(d.setNom) }), lien, prixGuide: prixGuide(guides.get(d.idProduct))
            });
        });
        return sortie.sort((a, b) => (Number(a.numero) || 1e9) - (Number(b.numero) || 1e9) || a.idProduct - b.idProduct);
    }
    return { resoudre, impressions };
}

module.exports = { creerVisuels, lireEntree, cleMotif, colLue, COLLECTIONS_LUES, CHAMPS_IMPRESSION };
