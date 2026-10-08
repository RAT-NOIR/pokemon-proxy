'use strict';
require('dotenv').config();
const path = require('path');
const { demarrer, appeler, RACINE } = require('../../verrou/serveur');
const H = require('./_harnais');
const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js');
const CHARGES = path.join(RACINE, 'verrou', 'charges.json');
const JETON = process.env.JETON_API || 'jeton-montage';

async function avec(envSup, fn) {
    const srv = await demarrer(FAUX, { VERROU_CHARGES: CHARGES, JETON_API: JETON, MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', ...envSup });
    try { if (!await srv.attendreMongo()) throw new Error('Mongo non connecté'); return await fn(srv); }
    finally { srv.enfant.kill(); }
}
(async () => {
    // INTERRUPTEUR ÉTEINT : /ping a EXACTEMENT les clés d'aujourd'hui, et aucune route v2 n'existe
    await avec({ RM_API_V2: '' }, async srv => {
        const p = await appeler(srv.port, 'GET', '/ping');
        H.v('éteint : /ping a les clés d\'aujourd\'hui', Object.keys(p.json).sort(), ['mongo', 'ok', 'version']);
        const c = await appeler(srv.port, 'GET', '/api/compte');
        H.v('éteint : /api/compte n\'existe pas (404)', c.status, 404);
        const i = await appeler(srv.port, 'POST', '/api/installation', { libelle: 'x' });
        H.v('éteint : /api/installation n\'existe pas (404)', i.status, 404);
    });
    // INTERRUPTEUR ALLUMÉ mais index absents (préfixe '' : collections nues de test_scratch) :
    // la garde ferme les routes v2 en 503 et ne casse pas l'ancien chemin
    await avec({ RM_API_V2: '1' }, async srv => {
        const p = await appeler(srv.port, 'GET', '/ping');
        H.vrai('allumé : /ping garde ses clés et AJOUTE versionMinExtension', ['mongo', 'ok', 'version', 'versionMinExtension'].every(k => k in p.json));
        const s = await appeler(srv.port, 'POST', '/api/solde', { userId: 'montage' }, JETON);
        H.vrai('allumé, sans Bearer : /api/solde garde la forme d\'AUJOURD\'HUI', ['soldeGratuit', 'soldeScans', 'restantSemaine'].every(k => k in s.json));
    });
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
