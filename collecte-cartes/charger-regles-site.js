'use strict';
// Charge les règles du site (rat-market-site/lib/*.ts) par import() local (Node 24) : impressionDuSet et normaliserNumero.
// Module SUIVI du dépôt : les outils de mesure (catalogue) l'appellent au lieu de porter eux-mêmes un import(). Aucun réseau, lecture seule.
// Une fonction absente LÈVE : jamais de repli.
const path = require('path');
const { pathToFileURL } = require('url');

// Même convention que regle-r-fiches.js : RAT_MARKET_SITE_LIB, sinon le voisin du dépôt principal.
const dossierLib = (env = process.env, dirname = __dirname) => (env.RAT_MARKET_SITE_LIB && String(env.RAT_MARKET_SITE_LIB).trim()) || path.join(dirname, '..', '..', 'rat-market-site', 'lib');

const importerLocal = chemin => import(pathToFileURL(chemin).href);

async function chargerReglesSite({ lib = dossierLib(), importer = importerLocal } = {}) {
    const [a, b] = await Promise.all([importer(path.join(lib, 'impressionDuSet.ts')), importer(path.join(lib, 'imageDeLImpression.ts'))]);
    const regles = { impressionDuSet: a.impressionDuSet, normaliserNumero: b.normaliserNumero };
    for (const [k, f] of Object.entries(regles)) if (typeof f !== 'function') throw new Error(`règle du site non importée : ${k} absent de ${lib}`);
    return regles;
}
module.exports = { chargerReglesSite, dossierLib };
