'use strict';
// COTES-VISUELS — l'ex-EXPORT des visuels (B1b.4b). L'IMPORT dans la collection `visuels` est ABANDONNÉ (décision du testeur, 2026-10-11 : « AUCUN import dans la grappe de production ») :
// l'API charge la décision en mémoire (v2/chargeur). Il ne reste ici que ce qui sert encore, et sans second exemplaire de la décision :
//   · `exporter` : lit `cartes` (et un catalogue) par des façades de lecture et appelle v2/chargeur/decision.js::decider — la MÊME fonction que le chargeur ;
//   · `chargerRegle` : la règle du site lue sur le dépôt voisin (.ts), pour COMPARER à la copie embarquée (banc d'équivalence) — le chargeur, lui, n'en lit jamais.
// Le CLI (--vers=<fichier>) et le résumé de l'importeur sont retirés avec l'import : rien ne lit plus ce fichier.
const path = require('path');
const { decider, verifierRegle, REGLE_REQUISE } = require('../chargeur/decision');

const LOGOS = () => require('../../exporter-donnees-logos-site');     // paresseux : ce module charge dotenv à l'import
const SITE_LIB = path.join(__dirname, '..', '..', '..', 'rat-market-site', 'lib');
/** La règle du site : celle que exporter-donnees-logos-site.js charge déjà (regleDuSite, laissée intacte) + `cardmarketUrl` (lib/cardmarket.ts). `importer` est injectable pour le banc. */
async function chargerRegle({ importer = f => import(require('url').pathToFileURL(path.join(SITE_LIB, f)).href) } = {}) {
    const base = await LOGOS().regleDuSite();
    const C = await importer('cardmarket.ts');
    if (typeof C?.cardmarketUrl !== 'function') throw new Error(`cardmarketUrl absent de ${SITE_LIB} — l'export s'arrête (jamais un repli)`);
    const D = await importer('impressionDuSet.ts');       // lot 2-A du site : « une impression appartient au set » (tirage, expansion, deck)
    if (typeof D?.impressionDuSet !== 'function') throw new Error(`impressionDuSet absent de ${SITE_LIB} — l'export s'arrête (jamais un repli)`);
    return { ...base, cardmarketUrl: C.cardmarketUrl, impressionDuSet: D.impressionDuSet };
}

async function lireTout(col, filtre, projection) { return col.find(filtre, { projection }).toArray(); }

/**
 * @param cartes  base `cartes` (façade de lecture ou db) ; @param prod  base de production (catalogue_produits) ; @param regle  chargerRegle() ou la règle embarquée
 * @returns { entrees, denominateurs, liens } — n'écrit rien nulle part.
 */
async function exporter({ cartes, prod, regle, journal = () => { } }) {
    verifierRegle(regle);
    const sets = await lireTout(cartes.collection('sets'), {}, { idExpansion: 1, nomAffichage: 1, tirage: 1, region: 1, code: 1, 'bulba.expansion': 1, deck: 1 });
    const docs = await lireTout(cartes.collection('cartes'), {}, { nomEn: 1, sets: 1, impressions: 1, images: 1 });
    const lignes = await lireTout(cartes.collection('cartes_produits'), {}, { carteId: 1, idProduct: 1, idExpansion: 1, numeroFiche: 1, slug: 1, slugSet: 1, visuelSubstitut: 1 });
    const catalogue = await lireTout(prod.collection('catalogue_produits'), {}, { idProduct: 1, idMetacard: 1 });
    return decider({ sets, docs, lignes, metacarte: new Map(catalogue.map(c => [c.idProduct, c.idMetacard])), regle, journal });
}

module.exports = { exporter, chargerRegle, verifierRegle, REGLE_REQUISE };
