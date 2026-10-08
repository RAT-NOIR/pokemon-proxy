'use strict';
// B4.4 — en-têtes de sécurité des réponses v2 (et seulement v2 : les routes héritées ne les reçoivent pas).
const express = require('express');
const H = require('./_harnais');
const M = require('../modeles');
const v2 = require('../index');
const { repondreErreur } = require('../erreurs');
const ENV = { RM_API_V2: '1', MONGODB_BASE: 'test_scratch' };
const SECU = ['cache-control', 'x-content-type-options', 'referrer-policy'];

function fabriquer(avecV2) {
    const app = express();                                   // express « nu » : x-powered-by activé comme dans index.js
    if (avecV2) v2.monterEnTete(app, ENV);
    app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-porteur']) req.v2 = { porteur: { type: 'installation', id: 'p' } }; next(); });   // faux resoudrePorteur
    app.get('/ping', (req, res) => res.json({ ok: true }));                                   // héritée
    app.post('/api/identifier', (req, res) => res.json({ ok: true, herite: !req.v2 }));      // héritée ET v2 selon le porteur
    app.get('/api/solde', (req, res) => res.json({ ok: true }));
    app.get('/api/compte/essai', (req, res) => res.json({ ok: true }));
    app.get('/api/compte/erreur', (req, res) => repondreErreur(res, 'SESSION', 'non'));
    app.get('/api/compte/plante', (req, res) => { throw new Error('boum'); });
    app.get('/api/installation/x', (req, res) => res.status(201).json({ ok: true }));
    app.get('/api/scanner/x', (req, res) => res.send('pas du json'));
    app.get('/api/banc/x', (req, res) => res.status(204).end());
    return app;
}

(async () => {
    await H.ouvrirBac('test-entetes.js'); await M.creerIndex();
    const avec = await H.serveur(fabriquer(true)), sans = await H.serveur(fabriquer(false));
    const ent = (r, k) => r.entetes[k];

    // routes exclusivement v2 : tous les statuts
    const v2Chemins = [['/api/compte/essai', 'GET', 200], ['/api/compte/erreur', 'GET', 401], ['/api/compte/plante', 'GET', 500], ['/api/installation/x', 'GET', 201],
                       ['/api/scanner/x', 'GET', 200], ['/api/banc/x', 'GET', 204], ['/api/compte/inconnue', 'GET', 404]];
    let ok = 0;
    for (const [chemin, methode, statut] of v2Chemins) {
        const r = await H.appel(avec.url, chemin, { methode });
        const bon = r.statut === statut && ent(r, 'cache-control') === 'no-store' && ent(r, 'x-content-type-options') === 'nosniff' && ent(r, 'referrer-policy') === 'no-referrer';
        if (!bon) console.log(`   ✗ ${methode} ${chemin} : ${r.statut}`, SECU.map(k => ent(r, k)));
        if (bon) ok++;
    }
    H.v(`route v2 (${v2Chemins.length} chemins, 2xx/4xx/5xx/204) : no-store + nosniff + no-referrer`, ok, v2Chemins.length);
    let r = await H.appel(avec.url, '/api/compte/essai');
    H.vrai('pas de X-Powered-By (app réelle, monterEnTete l\'a désactivé)', !('x-powered-by' in r.entetes));
    r = await H.appel(sans.url, '/ping');
    H.vrai('contrôle : sans v2, express nu envoie bien X-Powered-By (le test sait voir l\'en-tête)', 'x-powered-by' in r.entetes);

    // routes partagées : v2 seulement quand un porteur v2 est résolu
    r = await H.appel(avec.url, '/api/identifier', { methode: 'POST', corps: {}, entetes: { 'x-porteur': 'oui' } });
    H.v('/api/identifier avec porteur v2 : en-têtes de sécurité', SECU.map(k => ent(r, k)), ['no-store', 'nosniff', 'no-referrer']);
    r = await H.appel(avec.url, '/api/identifier', { methode: 'POST', corps: {} });
    H.v('/api/identifier héritée (pas de porteur v2) : AUCUN des trois', SECU.map(k => ent(r, k)), [undefined, undefined, undefined]);
    r = await H.appel(avec.url, '/api/solde');
    H.v('/api/solde hérité : AUCUN des trois', SECU.map(k => ent(r, k)), [undefined, undefined, undefined]);

    // /ping : héritée, identique allumée/éteinte hors le champ ajouté par le lot qui l'ajoute
    const pa = await H.appel(avec.url, '/ping'), ps = await H.appel(sans.url, '/ping');
    H.v('/ping allumé : aucun en-tête de sécurité', SECU.map(k => ent(pa, k)), [undefined, undefined, undefined]);
    const noms = r => Object.keys(r.entetes).filter(k => k !== 'x-powered-by' && k !== 'vary' && k !== 'date' && k !== 'keep-alive' && k !== 'connection').sort();
    H.v('/ping allumé/éteint : mêmes en-têtes de réponse (hors X-Powered-By et Vary: Origin, que le CORS v2 ajoute sur /ping)', noms(pa), noms(ps));
    H.v('/ping allumé/éteint : même corps ici (le champ versionMinExtension est ajouté par la route héritée, pas par B4)', pa.texte, ps.texte);

    // la garde ne s'ouvre pas à un chemin voisin
    r = await H.appel(avec.url, '/api/comptes-voisins');
    H.v('/api/comptes-voisins (préfixe voisin, route absente) : ni no-store ni no-referrer (le nosniff du 404 est celui d\'Express)', [ent(r, 'cache-control'), ent(r, 'referrer-policy')], [undefined, undefined]);
    r = await H.appel(avec.url, '/api/compte');
    H.v('/api/compte (la racine du préfixe) : en-têtes posés', ent(r, 'cache-control'), 'no-store');

    await avec.fermer(); await sans.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
