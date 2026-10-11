'use strict';
// COTES-VISUELS — la règle du site EMBARQUÉE : les `.mjs` voisins sont produits par copier-regle-site.js (types retirés, jamais modifiés à la main : leur empreinte est vérifiée).
// Ils s'exécutent tels quels en Node 22.x. Une fonction qui manque LÈVE : jamais un repli sur une règle vide ou recopiée (§76).
const path = require('path');
const { pathToFileURL } = require('url');

const REQUISES = Object.freeze(['fichesDuDocument', 'setParImpression', 'produitsDeLaFiche', 'visuelAdmisPourLaRegion', 'normaliserNumero', 'cardmarketUrl']);
const importerParDefaut = f => import(pathToFileURL(path.join(__dirname, f)).href);

/** @returns {Promise<{fichesDuDocument, setParImpression, produitsDeLaFiche, visuelAdmisPourLaRegion, normaliserNumero, cardmarketUrl}>} — `importer` est injectable pour le banc. */
async function regleEmbarquee({ importer = importerParDefaut } = {}) {
    const [I, C, L, N] = await Promise.all(['impressionsDuSet.mjs', 'cardmarket.mjs', 'langueDuVisuel.mjs', 'imageDeLImpression.mjs'].map(f => importer(f)));
    const r = { fichesDuDocument: I?.fichesDuDocument, setParImpression: I?.setParImpression, produitsDeLaFiche: C?.produitsDeLaFiche, visuelAdmisPourLaRegion: L?.visuelAdmisPourLaRegion,
        normaliserNumero: N?.normaliserNumero, cardmarketUrl: C?.cardmarketUrl };
    for (const k of REQUISES) if (typeof r[k] !== 'function') throw new Error(`règle embarquée : ${k} absent de v2/chargeur/regle-site — le chargeur s'arrête (jamais un repli)`);
    return Object.freeze(r);
}
module.exports = { regleEmbarquee, REQUISES };
