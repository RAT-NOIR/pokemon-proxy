'use strict';
// BANC-TELEPHONE, tour 2 : la page dans un VRAI navigateur envoie un en-tête Origin (un script de type module, un fetch POST) ; la garde CORS héritée (index.js) refusait cette origine en 403.
// Ce banc lance l'APPLICATION ENTIÈRE (index.js avec la v2, comme test-montage.js) et observe, avec l'en-tête Origin d'un navigateur, la page, ses fichiers et le dépôt :
// garde allumée ⇒ l'origine EXACTE de l'essai est admise sur /api/banc/telephone seulement ; garde éteinte ou base autre que rm_essai ⇒ comportement d'avant, octet pour octet.
require('dotenv').config();
const path = require('path');
const { demarrer, RACINE } = require('../../verrou/serveur');
const H = require('./_harnais');
const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js');
const CHARGES = path.join(RACINE, 'verrou', 'charges.json');
const ESSAI = 'https://rat-market-api-essai.onrender.com';
const ENV_BASE = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-cors-banc-telephone', OPENROUTER_API_KEY: '', RM_API_V2: '1' };
const ALLUME = { V2_BANC_TELEPHONE: '1', V2_CIBLE: 'essai', RENDER_SERVICE_ID: 'srv-db7ticgm7kps73crjibg', MONGODB_BASE: 'rm_essai', V2_SECRET_EMPREINTE: 'e'.repeat(40) };
const doc = () => ({ v: 1, runId: '0123456789abcdef', modeleSha: 'a'.repeat(64), ua: 'Mozilla/5.0 test', isole: true, coeurs: 4, gpuDispo: false, gpu: null, shaVerifie: true, mesure: { moteur: 'wasm', verdict: 'IDENTIQUE', nEmpreintes: 30, cosMin: 0.99999 } });
const gros = n => JSON.stringify({ v: 1, x: 'x'.repeat(n) });

async function avec(envSup, fn) {
    const srv = await demarrer(FAUX, { ...ENV_BASE, ...envSup });
    try {
        if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
        const url = `http://127.0.0.1:${srv.port}`;
        // la v2 répond 503 tant que ses index ne sont pas prêts : on attend une route v2 connue (/api/banc/etiquette sans jeton ⇒ 401)
        for (let i = 0; i < 80; i++) { const r = await H.appel(url, '/api/banc/etiquette', { methode: 'POST', corps: {} }); if (r.statut === 401) break; if (i === 79) console.log('   ⚠️ la v2 ne répond pas 401 : ' + r.statut + ' — journal du serveur : ' + srv.lire().slice(-700)); await new Promise(r2 => setTimeout(r2, 250)); }
        return await fn(url, srv);
    } finally { srv.enfant.kill(); }
}
const avecOrigine = (origine, extra = {}) => ({ entetes: { ...(origine === undefined ? {} : { Origin: origine }), ...extra } });
const vue = r => ({ statut: r.statut, acao: r.entetes['access-control-allow-origin'] ?? null, acac: r.entetes['access-control-allow-credentials'] ?? null, vary: r.entetes['vary'] ?? null });

(async () => {
    await H.ouvrirBancV2();
    // les index de la v2 (migration creerIndex, que le serveur n'exécute pas lui-même) sur les deux bases que les serveurs enfants utilisent ; sans eux la garde d'index de la v2 répond 503
    {
        const mongoose = require('mongoose'), M = require('../modeles');
        for (const base of ['rm_essai', 'test_scratch']) { const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: base }).asPromise(); await M.creerIndex(undefined, nom => c.db.collection(nom)); await c.close(); }
    }

    // ═══ garde ALLUMÉE (essai, drapeau, base rm_essai) ═══
    await avec(ALLUME, async url => {
        let r = await H.appel(url, '/api/banc/telephone/app.js', avecOrigine(ESSAI));
        H.v('app.js demandé avec l\'Origin de l\'essai (un script de type module) ⇒ 200, ACAO = l\'origine exacte, sans credentials, Vary: Origin', [r.statut, r.entetes['access-control-allow-origin'], r.entetes['access-control-allow-credentials'] ?? null, /Origin/i.test(r.entetes.vary || '')], [200, ESSAI, null, true]);
        r = await H.appel(url, '/api/banc/telephone', avecOrigine(ESSAI));
        H.v('la page elle-même avec Origin ⇒ 200', r.statut, 200);
        for (const f of ['empreinte.js', 'moteur-ort.js', 'verdict.mjs', 'lot.json', 'ort/ort.wasm.bundle.min.mjs', 'app.css']) H.v(`${f} avec Origin ⇒ 200`, (await H.appel(url, `/api/banc/telephone/${f}`, avecOrigine(ESSAI))).statut, 200);
        r = await H.appel(url, '/api/banc/telephone/resultat', { methode: 'POST', corps: doc(), ...avecOrigine(ESSAI) });
        H.v('le dépôt (fetch POST, Origin envoyé) ⇒ 201, ACAO exact', [r.statut, r.entetes['access-control-allow-origin']], [201, ESSAI]);
        r = await H.appel(url, '/api/banc/telephone/resultat', { methode: 'OPTIONS', ...avecOrigine(ESSAI, { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' }) });
        H.v('préflight du dépôt ⇒ 204, méthodes GET, HEAD, POST, en-tête Content-Type, pas de credentials', [r.statut, r.entetes['access-control-allow-methods'], r.entetes['access-control-allow-headers'], r.entetes['access-control-allow-credentials'] ?? null], [204, 'GET, HEAD, POST', 'Content-Type', null]);
        // les autres origines ne passent pas, byte à byte
        for (const [nom, o] of [['une autre origine', 'https://evil.example'], ['Origin: null', 'null'], ['suffixe', `${ESSAI}.evil.fr`], ['préfixe', 'https://evil-rat-market-api-essai.onrender.com'], ['http', 'http://rat-market-api-essai.onrender.com'], ['majuscules', 'HTTPS://RAT-MARKET-API-ESSAI.ONRENDER.COM'], ['barre finale', `${ESSAI}/`], ['port', `${ESSAI}:443`], ['vide', ''], ['site', 'https://www.rat-market.fr']]) {
            const x = await H.appel(url, '/api/banc/telephone/app.js', avecOrigine(o));
            H.v(`app.js avec ${nom} (${o || '(vide)'}) ⇒ 403, aucun ACAO`, [x.statut, x.entetes['access-control-allow-origin'] ?? null], [o === '' ? 200 : 403, null]);
        }
        // l'origine de l'essai n'ouvre RIEN d'autre
        for (const chemin of ['/ping', '/api/banc/etiquette', '/api/banc/seau/courant', '/api/identifier', '/api/solde', '/api/banc/telephonex', '/api/banc/telephone-autre', '/api/modele-empreinte/' + 'a'.repeat(64), '/api/compte']) {
            const x = await H.appel(url, chemin, avecOrigine(ESSAI));
            H.v(`hors profil : ${chemin} avec l'Origin de l'essai ⇒ 403 (refus hérité), aucun ACAO`, [x.statut, x.entetes['access-control-allow-origin'] ?? null], [403, null]);
        }
        // 8 Ko : le chemin de l'analyseur est comparé SANS CASSE et SANS barre finale
        for (const chemin of ['/api/banc/telephone/resultat', '/api/banc/telephone/Resultat', '/api/banc/telephone/RESULTAT', '/api/banc/telephone/resultat/', '/API/banc/telephone/resultat']) {
            const x = await H.appel(url, chemin, { methode: 'POST', corps: JSON.parse(gros(20000)) });
            H.v(`${chemin} avec 20 Ko ⇒ 413 (l'analyseur de 8 Ko, pas le global de 100 Ko)`, x.statut, 413);
        }
        // sans Origin (curl, serveur à serveur) : comme avant
        r = await H.appel(url, '/api/banc/telephone/app.js');
        H.v('sans Origin ⇒ 200, aucun en-tête CORS', [r.statut, r.entetes['access-control-allow-origin'] ?? null], [200, null]);
    });

    // ═══ garde ÉTEINTE (drapeau absent) : l'application d'aujourd'hui ═══
    await avec({ ...ALLUME, V2_BANC_TELEPHONE: undefined }, async url => {
        const inex = await H.appel(url, '/api/banc/route-inexistante', avecOrigine(ESSAI));
        const norm = (r, chemin) => ({ statut: r.statut, corps: r.texte.split(chemin).join('<C>'), acao: r.entetes['access-control-allow-origin'] ?? null });
        const base = norm(inex, '/api/banc/route-inexistante');
        H.v('éteint, Origin de l\'essai : une route inexistante rend le refus hérité (403, aucun ACAO) — la référence', [base.statut, base.acao], [403, null]);
        for (const chemin of ['/api/banc/telephone/app.js', '/api/banc/telephone', '/api/banc/telephone/resultat']) {
            const x = await H.appel(url, chemin, { ...(chemin.endsWith('resultat') ? { methode: 'POST', corps: doc() } : {}), ...avecOrigine(ESSAI) });
            H.v(`éteint : ${chemin} avec l'Origin de l'essai = exactement le refus de la route inexistante`, norm(x, chemin), base);
        }
        const sans = await H.appel(url, '/api/banc/telephone/app.js');
        H.v('éteint, sans Origin : 404 natif', sans.statut, 404);
        const gros_ = await H.appel(url, '/api/banc/telephone/resultat', { methode: 'POST', corps: JSON.parse(gros(20000)) });
        H.v('éteint : un corps de 20 Ko sur ce chemin n\'est PAS pris par l\'analyseur de 8 Ko (404 natif, pas 413)', gros_.statut, 404);
    });

    // ═══ drapeaux posés mais base différente de rm_essai : rien n'est monté, l'analyseur de 8 Ko non plus, le profil CORS non plus ═══
    await avec({ ...ALLUME, MONGODB_BASE: 'test_scratch' }, async url => {
        const x = await H.appel(url, '/api/banc/telephone/app.js', avecOrigine(ESSAI));
        H.v('base ≠ rm_essai : app.js avec l\'Origin de l\'essai ⇒ 403 hérité (le profil CORS n\'existe pas)', [x.statut, x.entetes['access-control-allow-origin'] ?? null], [403, null]);
        H.v('base ≠ rm_essai : la page est un 404 natif', (await H.appel(url, '/api/banc/telephone')).statut, 404);
        const g = await H.appel(url, '/api/banc/telephone/resultat', { methode: 'POST', corps: JSON.parse(gros(20000)) });
        H.v('base ≠ rm_essai : l\'analyseur de 8 Ko est INACTIF (20 Ko ⇒ 404 natif, pas 413)', g.statut, 404);
    });

    H.bilan();
    await H.arreterBanc();
})().catch(e => { console.error('❌', e); process.exit(1); });
