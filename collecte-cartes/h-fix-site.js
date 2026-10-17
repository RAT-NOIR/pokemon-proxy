// ============================================================
// LA RÈGLE DU SITE, REJOUÉE SUR QUELQUES SETS — avant / après une correction de données (lot H-FIX, 2026-10-17)
// ============================================================
// Ce module ne lit RIEN en base : il reçoit les documents (sets, cartes, lignes de jointure) et rend, pour chaque produit, la fiche qui
// le sert et l'image que cette fiche montre. La règle est celle du SITE, importée (exporter-donnees-logos-site.js : regleDuSite,
// fichesDesProduits ; lib/imageDeLImpression.ts : imageDeLImpression ; lib/langueDuVisuel.ts : refusDuVisuel) — jamais recopiée (§21 bis).
const path = require('path');
const { pathToFileURL } = require('url');

/** @returns {Promise<{regle, imageDeLImpression, refusDuVisuel}>} les fonctions du site ; une fonction absente lève (une règle qui manque n'est pas une règle vide). */
async function chargerRegle({ racine, siteLib }) {
    const exporteur = require(path.join(racine, 'exporter-donnees-logos-site.js'));
    const lib = siteLib || path.join(racine, '..', 'rat-market-site', 'lib');
    const lire = f => import(pathToFileURL(path.join(lib, f)).href);
    const [N, Lg] = await Promise.all([lire('imageDeLImpression.ts'), lire('langueDuVisuel.ts')]);
    if (typeof N.imageDeLImpression !== 'function' || typeof Lg.refusDuVisuel !== 'function') throw new Error('imageDeLImpression / refusDuVisuel absents du site');
    const regle = await exporteur.regleDuSite(racine);
    return { exporteur, regle, imageDeLImpression: N.imageDeLImpression, refusDuVisuel: Lg.refusDuVisuel };
}

/**
 * @param {object} R   chargerRegle()
 * @param {{sets: object[], cartes: object[], lignes: object[]}} D   sets (tirage, region, bulba.expansion, idExpansion, code), cartes (_id, nomEn, sets, impressions, images), lignes de cartes_produits
 * @returns {Map<number, {set, carteId, fiche: boolean, rang, numero, cleR2}>}  une entrée par (produit) ; `fiche:false` : le produit n'est servi sur aucune fiche
 */
function servir(R, { sets, cartes, lignes }) {
    const docsDeSet = new Map();
    for (const c of cartes) {
        if (typeof c.nomEn !== 'string' || c.nomEn === '' || !Array.isArray(c.sets)) continue;
        for (const sid of new Set(c.sets)) { if (!docsDeSet.has(sid)) docsDeSet.set(sid, []); docsDeSet.get(sid).push(c); }
    }
    const imagesDeCarte = new Map(cartes.map(c => [c._id, c.images || []]));
    const sortie = new Map();
    for (const s of sets) {
        const exps = [].concat(s.idExpansion ?? []);
        const docs = docsDeSet.get(s._id) || [];
        const ids = new Set(docs.map(d => d._id));
        const duSet = lignes.filter(l => exps.includes(l.idExpansion) && ids.has(l.carteId));
        const { fiche: ficheDe, parImpression } = R.exporteur.fichesDesProduits(R.regle, s, docs, duSet);
        const tir = s.tirage ?? s.region;
        for (const L of duSet) {
            const k = `${s._id}|${L.idProduct}|${L.carteId}`;
            if (sortie.has(k)) continue;
            const F = ficheDe.get(L.idProduct);
            if (!F || F.carteId !== L.carteId) { sortie.set(k, { set: s._id, idProduct: L.idProduct, carteId: L.carteId, fiche: false, rang: null, numero: null, cleR2: null, parImpression }); continue; }
            const admis = (imagesDeCarte.get(L.carteId) || []).filter(e => e.set === s._id && e.cleR2).filter(e => R.refusDuVisuel(e, tir) === null);
            const E = R.imageDeLImpression(admis, F.numero);
            sortie.set(k, { set: s._id, idProduct: L.idProduct, carteId: L.carteId, fiche: true, rang: F.rang, numero: F.numero ?? null, cleR2: E ? E.cleR2 : null, parImpression });
        }
    }
    return sortie;
}

/** Les différences produit par produit entre deux états servis (clé `set|idProduct|carteId`). */
function diff(avant, apres) {
    const dif = [];
    for (const [k, a] of avant) {
        const b = apres.get(k);
        if (!b) { dif.push({ k, a, b: null, nature: 'produit sorti de la sortie' }); continue; }
        if (a.fiche !== b.fiche) dif.push({ k, a, b, nature: a.fiche ? 'PRODUIT PERDU (plus aucune fiche)' : 'produit gagné une fiche' });
        else if (a.cleR2 !== b.cleR2) dif.push({ k, a, b, nature: 'visuel changé' });
        else if (a.rang !== b.rang || a.numero !== b.numero) dif.push({ k, a, b, nature: 'fiche changée (visuel identique)' });
    }
    return dif;
}

module.exports = { chargerRegle, servir, diff };
