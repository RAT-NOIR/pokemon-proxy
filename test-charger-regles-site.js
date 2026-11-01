'use strict';
// Banc PUR de collecte-cartes/charger-regles-site.js : aucun fichier du site, aucun réseau (le chargeur est injecté).
const assert = require('assert');
const path = require('path');
const { chargerReglesSite, dossierLib } = require('./collecte-cartes/charger-regles-site');
let ko = 0;
const t = async (nom, f) => { try { await f(); } catch (e) { ko++; console.log(`ECHEC ${nom} : ${e.message}`); } };
const faux = (modules) => async (chemin) => { const base = path.basename(chemin); if (!modules[base]) throw new Error('absent ' + base); return modules[base]; };
const OK = { 'impressionDuSet.ts': { impressionDuSet: () => true }, 'imageDeLImpression.ts': { normaliserNumero: x => x } };

(async () => {
    await t('rend impressionDuSet et normaliserNumero', async () => {
        const r = await chargerReglesSite({ importer: faux(OK) });
        assert.strictEqual(typeof r.impressionDuSet, 'function'); assert.strictEqual(typeof r.normaliserNumero, 'function');
    });
    await t('une fonction manquante LÈVE (jamais de repli)', async () => {
        await assert.rejects(chargerReglesSite({ importer: faux({ 'impressionDuSet.ts': {}, 'imageDeLImpression.ts': OK['imageDeLImpression.ts'] }) }), /impressionDuSet/);
    });
    await t('un fichier absent LÈVE', async () => {
        await assert.rejects(chargerReglesSite({ importer: faux({}) }), /absent/);
    });
    await t('dossier : variable RAT_MARKET_SITE_LIB sinon voisin du dépôt', () => {
        assert.strictEqual(dossierLib({ RAT_MARKET_SITE_LIB: 'X:/lib' }, 'D:/a/b'), 'X:/lib');
        assert.strictEqual(path.normalize(dossierLib({}, 'D:/a/depot/collecte-cartes')), path.normalize('D:/a/rat-market-site/lib'));
    });
    console.log(`${ko === 0 ? 'VERT' : 'ROUGE'} : ${ko} échec(s)`);
    process.exit(ko === 0 ? 0 : 1);
})();
