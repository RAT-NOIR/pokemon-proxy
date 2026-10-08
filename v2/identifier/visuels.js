'use strict';
// B1b.4 — les visuels servis depuis NOS fichiers (collection `visuels`, importée par v2/migrations/importer-visuels.js) et les impressions
// d'une métacarte. Les règles d'admission d'un visuel vivent dans le SITE (§5 Q11) : le serveur sert ce qu'on lui a DONNÉ, et ne les recopie pas.
// Écrit par ce qu'il AUTORISE : une clé n'est servie que si elle est un chemin relatif propre ; le reste donne null.
const { lireConfig } = require('../config');
const db = require('../db');
const { VARIANTES } = require('./produit');

// Une clé R2 est un chemin relatif : ni schéma ("://"), ni remontée (".."), ni Cardmarket, ni barre initiale ou inverse.
const CLE = /^[A-Za-z0-9][A-Za-z0-9._\-\/]*$/;
function cleMotif(cle) {
    if (typeof cle !== 'string' || !cle.trim()) return 'clé absente';
    if (cle.includes('://')) return 'clé avec "://"';
    if (cle.includes('..')) return 'clé avec ".."';
    if (/cardmarket/i.test(cle)) return 'clé Cardmarket';
    if (!CLE.test(cle)) return 'clé hors forme';
    return null;
}
const entierPositif = x => Number.isInteger(x) && x > 0;
const texte = x => (typeof x === 'string' && x.trim() ? x.trim() : null);

function fichier(f, nom) {
    if (!f || typeof f !== 'object') return { motif: `${nom} absente` };
    const m = cleMotif(f.cle);
    if (m) return { motif: `${nom} : ${m}` };
    if (!entierPositif(f.w) || !entierPositif(f.h)) return { motif: `${nom} : w/h non entiers positifs` };
    return { fichier: { cle: f.cle, w: f.w, h: f.h } };
}

/**
 * Une entrée d'export -> le document `visuels`, ou un refus MOTIVÉ. Entrée : { idProduct, vignette:{cle,w,h}, grande:{cle,w,h}|null,
 * visuel?:'du-set'|'substitut'|'autre-tirage', mention?:string|null }. Un visuel qui n'est pas celui du set n'est admis qu'avec sa mention.
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
    return { ok: true, doc: { idProduct: e.idProduct, vignette: v.fichier, grande: g, mention } };
}

const urlDe = (hote, f) => `https://${hote}/${f.cle}`;

/** @param opts { cfg?, rareteDe?(idProduct) } — rareteDe est INJECTABLE : par défaut elle lit cartes.impressions[].rarete, jamais ne la devine. */
function creerVisuels(opts = {}) {
    const cfg = opts.cfg || lireConfig();
    const hote = cfg.images.hotesPublics[0];
    const rareteDe = opts.rareteDe || rareteLue;

    async function resoudre(idProduct) {
        if (!Number.isInteger(idProduct)) return null;
        const d = await db.col('visuels').findOne({ idProduct });
        if (!d) return null;
        const v = fichier(d.vignette, 'vignette').fichier;
        if (!v) return null;                                                   // une clé interdite posée hors import n'est jamais servie
        const g = d.grande ? fichier(d.grande, 'grande').fichier : null;
        return { url: urlDe(hote, v), w: v.w, h: v.h, grande: g ? { url: urlDe(hote, g), w: g.w, h: g.h } : null, mention: texte(d.mention) };
    }

    async function impressions(idMetacard) {
        if (!Number.isInteger(idMetacard)) return [];
        const ids = (await db.col('catalogue_produits').find({ idMetacard }).project({ idProduct: 1 }).toArray()).map(p => p.idProduct);
        if (!ids.length) return [];
        const nums = await db.col('numeros_cartes').find({ idProduct: { $in: ids } }).toArray();
        const guides = new Map((await db.col('guide_prix').find({ idProduct: { $in: ids } }).toArray()).map(g => [g.idProduct, g]));
        const sortie = [];
        for (const idProduct of ids) {
            const n = nums.find(x => x.idProduct === idProduct) || {};
            const numero = texte(n.numero), rarete = numero ? texte(await rareteDe(idProduct)) : null;
            const lien = numero && rarete && texte(n.slug) && texte(n.slugSet)
                ? `https://www.cardmarket.com/en/Pokemon/Products/Singles/${n.slugSet}/${n.slug}` : null;     // jamais de lien anonyme
            sortie.push(Object.freeze({
                idProduct, numero, total: null, rarete, variante: VARIANTES.includes(n.variante) ? n.variante : null,   // V1/V2 n'a pas de sémantique (CLAUDE.md §7)
                set: Object.freeze({ nom: texte(n.slugSet) ? n.slugSet.replace(/-/g, ' ') : null }),
                lien, lienCardmarket: lien, prixGuide: prixGuide(guides.get(idProduct))
            }));
        }
        return sortie.sort((a, b) => (Number(a.numero) || 1e9) - (Number(b.numero) || 1e9) || a.idProduct - b.idProduct);
    }
    return { resoudre, impressions };
}

const prix = x => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : null);
function prixGuide(g) {
    if (!g) return null;
    const d = g.guideDu instanceof Date && !Number.isNaN(g.guideDu.getTime()) ? g.guideDu.toISOString().slice(0, 10)
        : typeof g.guideDu === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(g.guideDu) ? g.guideDu : null;
    const tendance = prix(g.trend), de = prix(g.low), moyenne30 = prix(g.avg30);
    if (!d || (tendance === null && de === null && moyenne30 === null)) return null;       // un prix non daté n'est pas servi
    return Object.freeze({ tendance, de, moyenne30, date: d });
}

// Rareté LUE : la carte du produit (cartes_produits.carteId) porte une impression au numéro de la fiche (numeroFiche) avec une `rarete`.
async function rareteLue(idProduct) {
    const l = await db.col('cartes_produits').findOne({ idProduct });
    if (!l || !l.carteId || l.numeroFiche === undefined || l.numeroFiche === null) return null;
    const c = await db.col('cartes').findOne({ _id: l.carteId });
    const i = c && Array.isArray(c.impressions) ? c.impressions.find(x => x && String(x.numero) === String(l.numeroFiche) && texte(x.rarete)) : null;
    return i ? i.rarete : null;
}

module.exports = { creerVisuels, lireEntree, cleMotif };
