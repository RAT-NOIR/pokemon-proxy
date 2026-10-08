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
// Le CORS HÉRITÉ (index.js, ORIGINES_AUTORISEES) : une origine interdite reçoit le refus d'aujourd'hui (403 JSON court),
// une origine autorisée reçoit ses en-têtes d'aujourd'hui. Observé avec l'interrupteur éteint PUIS allumé : les deux doivent coïncider.
const ORIGINE_INTERDITE = 'https://evil.example', ORIGINE_VINTED = 'https://www.vinted.fr', ORIGINE_EXTENSION = 'chrome-extension://abcdefghijklmnop';
async function observerCors(srv) {
    const url = `http://127.0.0.1:${srv.port}`;
    const vu = async origine => {
        const r = await H.appel(url, '/ping', { entetes: { Origin: origine } });
        // le corps de /ping gagne versionMinExtension quand la v2 est allumée (voulu) : seul le corps du REFUS se compare
        return { statut: r.statut, acao: r.entetes['access-control-allow-origin'] ?? null, vary: r.entetes['vary'] ?? null, corps: r.statut === 403 ? r.texte : null };
    };
    return { interdite: await vu(ORIGINE_INTERDITE), vinted: await vu(ORIGINE_VINTED), extension: await vu(ORIGINE_EXTENSION) };
}
const cors = {};
(async () => {
    // INTERRUPTEUR ÉTEINT : /ping a EXACTEMENT les clés d'aujourd'hui, et aucune route v2 n'existe
    await avec({ RM_API_V2: '' }, async srv => {
        cors.eteint = await observerCors(srv);
        const p = await appeler(srv.port, 'GET', '/ping');
        H.v('éteint : /ping a les clés d\'aujourd\'hui', Object.keys(p.json).sort(), ['mongo', 'ok', 'version']);
        const c = await appeler(srv.port, 'GET', '/api/compte');
        H.v('éteint : /api/compte n\'existe pas (404)', c.status, 404);
        const i = await appeler(srv.port, 'POST', '/api/installation', { libelle: 'x' });
        H.v('éteint : /api/installation n\'existe pas (404)', i.status, 404);
    });
    // INTERRUPTEUR ALLUMÉ : aucun lot ne monte encore de route (A0) ; la garde d'index qui ferme les routes v2 en 503 est
    // prouvée par test-pret.js (assembler + routes factices). Ici : l'ancien chemin n'est pas cassé.
    await avec({ RM_API_V2: '1' }, async srv => {
        cors.allume = await observerCors(srv);
        const p = await appeler(srv.port, 'GET', '/ping');
        H.vrai('allumé : /ping garde ses clés et AJOUTE versionMinExtension', ['mongo', 'ok', 'version', 'versionMinExtension'].every(k => k in p.json));
        const s = await appeler(srv.port, 'POST', '/api/solde', { userId: 'montage' }, JETON);
        H.vrai('allumé, sans Bearer : /api/solde garde la forme d\'AUJOURD\'HUI', ['soldeGratuit', 'soldeScans', 'restantSemaine'].every(k => k in s.json));
    });
    // CONFIGURATION INVALIDE avec l'interrupteur allumé : les chemins PROPRES à la v2 répondent 503 INDISPONIBLE, l'ancien serveur sert toujours
    await avec({ RM_API_V2: '1', V2_ACCUEIL: 'beaucoup' }, async srv => {
        const c = await appeler(srv.port, 'GET', '/api/compte');
        H.v('configuration invalide : /api/compte => 503 INDISPONIBLE', [c.status, c.json && c.json.erreur && c.json.erreur.code], [503, 'INDISPONIBLE']);
        const p = await appeler(srv.port, 'GET', '/ping');
        H.v('configuration invalide : /ping reste celui d\'aujourd\'hui', Object.keys(p.json).sort(), ['mongo', 'ok', 'version']);
    });
    // CORS hérité inchangé
    for (const [nom, o] of [['éteint', cors.eteint], ['allumé', cors.allume]]) {
        H.v(`CORS hérité (${nom}) : origine interdite => 403`, o.interdite.statut, 403);
        H.vrai(`   le refus n'expose ni stack ni en-tête CORS (${nom})`, !o.interdite.acao && !/\bat \w|node_modules/.test(o.interdite.corps || ''));
        H.v(`CORS hérité (${nom}) : Vinted autorisé`, [o.vinted.statut, o.vinted.acao], [200, ORIGINE_VINTED]);
        H.v(`CORS hérité (${nom}) : extension autorisée`, [o.extension.statut, o.extension.acao], [200, ORIGINE_EXTENSION]);
        H.vrai(`   Vary: Origin présent (${nom})`, /origin/i.test(o.vinted.vary || ''));
    }
    H.v('CORS hérité : éteint et allumé rendent EXACTEMENT les mêmes réponses', cors.allume, cors.eteint);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
