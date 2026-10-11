'use strict';
// COTES-VISUELS, tour 1 — la LECTURE de `cartes` en FLUX : chaque document est converti AUSSITÔT en un enregistrement minimal aux chaînes INTERNÉES (une seule exemplaire de « intl »,
// « Set A », « en »…), et le document brut est abandonné. Jamais `toArray()` sur `cartes` : le tas ne porte que les enregistrements minimaux (de la même forme que les documents,
// donc `decider` n'a pas changé). Le nom anglais d'une carte ne sert qu'à savoir s'il est vide : il est réduit à un témoin.
const LS = require('./lecture-seule');

// Ce que l'API lit dans `cartes` : TROIS collections, ces champs, rien d'autre (la liste du rapport ; la façade restreinte refuse toute autre collection).
const PROJECTIONS = Object.freeze({
    sets: Object.freeze({ idExpansion: 1, nomAffichage: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1 }),
    cartes: Object.freeze({ nomEn: 1, sets: 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.numero': 1, 'impressions.total': 1, 'impressions.rarete': 1,
        'images.set': 1, 'images.cleR2': 1, 'images.w': 1, 'images.h': 1, 'images.numero': 1, 'images.langue': 1, 'images.languePreuve': 1, 'images.source': 1,
        'images.vignette.cleR2': 1, 'images.vignette.w': 1, 'images.vignette.h': 1 }),
    cartes_produits: Object.freeze({ carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1, slug: 1, slugSet: 1, visuelSubstitut: 1 })
});
const LOT = 500;

/** Un internuer : la même chaîne, un seul exemplaire. Les valeurs qui ne sont pas des chaînes passent telles quelles (null, undefined, nombres). */
function interneur() {
    const pool = new Map();
    return s => { if (typeof s !== 'string' || s.length > 160) return s; const v = pool.get(s); if (v !== undefined) return v; pool.set(s, s); return s; };
}
const liste = (x, f) => (Array.isArray(x) ? x.map(f) : x);
function compacterSet(d, I) { return { _id: d._id, idExpansion: d.idExpansion, nomAffichage: d.nomAffichage, tirage: I(d.tirage), region: I(d.region), code: d.code, bulba: d.bulba && { expansion: d.bulba.expansion } }; }
function compacterCarte(d, I) {
    return { _id: d._id, nomEn: typeof d.nomEn === 'string' && d.nomEn !== '' ? 'x' : d.nomEn, sets: liste(d.sets, I),
        impressions: liste(d.impressions, i => (i && typeof i === 'object' ? { tirage: I(i.tirage), expansion: I(i.expansion), numero: I(i.numero), total: I(i.total), rarete: I(i.rarete) } : i)),
        images: liste(d.images, m => (m && typeof m === 'object' ? { set: I(m.set), cleR2: m.cleR2, w: m.w, h: m.h, numero: I(m.numero), langue: I(m.langue), languePreuve: I(m.languePreuve), source: I(m.source),
            vignette: m.vignette && typeof m.vignette === 'object' ? { cleR2: m.vignette.cleR2, w: m.vignette.w, h: m.vignette.h } : m.vignette } : m)) };
}
function compacterLigne(d, I) {
    const v = d.visuelSubstitut;
    return { carteId: d.carteId, idProduct: d.idProduct, idExpansion: d.idExpansion, numeroFiche: I(d.numeroFiche), slug: d.slug, slugSet: I(d.slugSet),
        visuelSubstitut: v && typeof v === 'object' ? { ...v, set: I(v.set), mention: I(v.mention) } : v };
}
async function lireEnFlux(collection, projection, convertir) {
    const sortie = [];
    for await (const d of collection.find({}, { projection, batchSize: LOT })) sortie.push(convertir(d));
    return sortie;
}

/** La source par défaut : la lecture seule de `cartes` (ouvrir injectable). Rend { ok:true, sets, docs, lignes, fermer } ou { ok:false, raison }. */
async function sourceCartes({ env = process.env, ouvrir = LS.ouvrir } = {}) {
    const o = await ouvrir({ env });
    if (!o.ok) return o;
    const c = o.cartes, I = interneur();
    try {
        const sets = await lireEnFlux(c.collection('sets'), PROJECTIONS.sets, d => compacterSet(d, I));
        const docs = await lireEnFlux(c.collection('cartes'), PROJECTIONS.cartes, d => compacterCarte(d, I));
        const lignes = await lireEnFlux(c.collection('cartes_produits'), PROJECTIONS.cartes_produits, d => compacterLigne(d, I));
        return { ok: true, sets, docs, lignes, fermer: () => c.fermer() };
    } catch (e) { try { await c.fermer(); } catch { /* déjà fermée */ } throw e; }
}
module.exports = { sourceCartes, PROJECTIONS, interneur, compacterSet, compacterCarte, compacterLigne };
