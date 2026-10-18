'use strict';
// Banc MODELE-VISUEL-API (2, tour 2 : I3 et M1) — LA TAILLE DU CORPS de POST /api/identifier. L'extension joint une carte redressée (JPEG 420 × 587, <= 200 Ko, <= 273 068 caractères base64) à chaque entrée, 8 au plus : jusqu'à ≈ 2,19 Mo.
// `express.json()` plafonne à 100 Ko ; la limite est relevée à 2 400 Ko POUR CETTE ROUTE SEULEMENT, SEULEMENT si V2_EMPREINTE_EXTENSION=1 ET que l'API v2 est montée (RM_API_V2=1), et SEULEMENT APRÈS : un en-tête
// Authorization: Bearer présent, un Content-Length annoncé, et le plafond par IP (limiteur-heritage.js, plafondGrand). Sans jeton : 413 SANS LECTURE du corps (Content-Length > 100 Ko) ; sans Content-Length : coupé à 100 Ko.
// Serveurs ENFANTS (index.js réel, faux réseau, base en mémoire), jamais la production. Les variantes (jeton absent, Content-Length absent, v2 éteinte, drapeau éteint) prouvent que chaque condition est ce qui ferme.
const H = require('./_harnais');
const path = require('path');
const http = require('http'), net = require('net');
const mongoose = require('mongoose');
const QA = require('./_aide-quota');
const { fabrique } = require('../limiteur-heritage');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');

const corps = n => JSON.stringify({ contrat: 2, imageUrls: ['https://images1.vinted.net/a.jpg'], versionExtension: '2.0.0', marche: 'vinted.fr', bourrage: 'A'.repeat(n) });
/** POST brut. `bearer` : en-tête Authorization ; `chunked` : pas de Content-Length (transfert par morceaux). Rend le statut. */
function post(port, chemin, n, { bearer = false, chunked = false } = {}) {
    return new Promise(resolve => {
        const c = corps(n);
        const entetes = { 'content-type': 'application/json', ...(bearer ? { authorization: 'Bearer jeton-de-banc-inconnu' } : {}), ...(chunked ? { 'transfer-encoding': 'chunked' } : { 'content-length': Buffer.byteLength(c) }) };
        const req = http.request({ host: '127.0.0.1', port, path: chemin, method: 'POST', headers: entetes }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
        req.on('error', () => resolve(0));
        req.setTimeout(20000, () => { req.destroy(); resolve(-1); });
        req.write(c); req.end();
    });
}
/** Annonce un Content-Length énorme et N'ENVOIE QUE les en-têtes : un 413 qui arrive prouve que le serveur n'a pas attendu (ni lu) le corps. */
function annonceSansCorps(port, longueur, bearer) {
    return new Promise(resolve => {
        const s = net.connect(port, '127.0.0.1'); let reponse = '';
        s.on('data', d => { reponse += d; if (/\r\n\r\n/.test(reponse)) { s.destroy(); resolve(Number((/^HTTP\/1\.1 (\d+)/.exec(reponse) || [])[1])); } });
        s.on('error', () => resolve(0));
        setTimeout(() => { s.destroy(); resolve(-1); }, 5000);
        s.write(`POST /api/identifier HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: ${longueur}\r\n${bearer ? 'Authorization: Bearer jeton-de-banc-inconnu\r\n' : ''}Connection: close\r\n\r\n{"contrat":2`);
    });
}

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-corps-identifier-empreinte.js', ecrit: true });
    const { demarrer } = require('../../verrou/serveur');
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '' };
    const off = await demarrer(FAUX, { ...base, RM_API_V2: '1', V2_EMPREINTE_EXTENSION: '0' });
    const on = await demarrer(FAUX, { ...base, RM_API_V2: '1', V2_EMPREINTE_EXTENSION: '1' });
    const sansV2 = await demarrer(FAUX, { ...base, RM_API_V2: '', V2_EMPREINTE_EXTENSION: '1' });
    for (const s of [off, on, sansV2]) if (!await s.attendreMongo()) throw new Error('Mongo non connecté');
    const un = 1024 * 1024, I = '/api/identifier';

    H.v('1a. éteint : un corps de 1 Mo AVEC jeton est refusé 413 (le plafond de 100 Ko est inchangé)', await post(off.port, I, un, { bearer: true }), 413);
    H.vrai('1b. éteint : un corps de 90 Ko passe la lecture du corps (n\'est PAS un 413)', await post(off.port, I, 90 * 1024) !== 413);
    H.vrai('2a. allumé, AVEC jeton : un corps de 1 Mo passe la lecture (jamais un 413 ; la suite refuse le jeton inconnu)', await post(on.port, I, un, { bearer: true }) !== 413);
    H.vrai('2b. allumé, AVEC jeton : le corps maximal de 8 entrées (8 × 273 068 caractères + enveloppe ≈ 2,19 Mo) passe', await post(on.port, I, 8 * 273068 + 20000, { bearer: true }) !== 413);
    H.v('2c. allumé, avec jeton, au-delà de la borne (2 400 Ko, ici 2,6 Mo) : 413', await post(on.port, I, 2600 * 1024, { bearer: true }), 413);
    // I3 : sans jeton, la limite relevée n'existe pas
    H.v('3a. 🔑 I3 allumé, SANS jeton : 1 Mo ⇒ 413 (l\'analyseur par défaut, jamais le grand)', await post(on.port, I, un), 413);
    H.v('3b. 🔑 I3 allumé, SANS jeton : un Content-Length de 5 Mo annoncé et AUCUN corps envoyé ⇒ 413 tout de suite (le corps n\'est pas lu)', await annonceSansCorps(on.port, 5 * un, false), 413);
    H.v('3c. 🔑 I3 allumé, AVEC jeton mais SANS Content-Length (transfert par morceaux) : 1 Mo ⇒ 413, le corps est coupé à 100 Ko', await post(on.port, I, un, { bearer: true, chunked: true }), 413);
    H.vrai('3d. variante : le même Content-Length de 5 Mo AVEC jeton n\'est PAS refusé d\'avance (le serveur attend le corps — le grand analyseur a pris la main) : aucune réponse en 1,5 s', await Promise.race([annonceSansCorps(on.port, 5 * un, true).then(() => false), new Promise(r => setTimeout(() => r(true), 1500))]));
    H.vrai('3e. variante : un corps de 90 Ko SANS jeton passe encore (la limite de 100 Ko est inchangée)', await post(on.port, I, 90 * 1024) !== 413);
    // M1 : la route héritée garde 100 Ko
    H.v('4. 🔑 M1 drapeau allumé mais API v2 NON montée (RM_API_V2 absent) : la route héritée garde 100 Ko — 1 Mo avec jeton ⇒ 413', await post(sansV2.port, I, un, { bearer: true }), 413);
    H.v('5. allumé : la limite relevée ne vaut QUE pour /api/identifier — un corps de 1 Mo avec jeton sur /api/solde reste un 413', await post(on.port, '/api/solde', un, { bearer: true }), 413);
    for (const s of [off, on, sansV2]) { try { s.enfant.kill(); } catch { /* déjà arrêté */ } }

    // I3 (suite) : le plafond par IP s'applique AVANT la lecture d'un grand corps, et ne compte pas deux fois
    {
        const cfg = { limites: { identifierParCompteHeure: 1, reponseParPorteurHeure: 0 } };          // plafond par IP = 5 × (1 + 0) = 5
        const lim = fabrique(() => cfg, {});
        const fauxRes = () => ({ code: null, setHeader() { }, status(c) { this.code = c; return this; }, json() { return this; } });
        const essai = () => { const res = fauxRes(); let passe = false; const req = { method: 'POST', originalUrl: '/api/identifier', ip: '203.0.113.9', headers: {} }; lim.plafondGrand(req, res, () => { passe = true; }); return { passe, res }; };
        const rs = [1, 2, 3, 4, 5, 6].map(essai);
        H.v('6a. plafondGrand : les 5 premiers grands corps de l\'IP passent, le 6e est refusé AVANT toute lecture', rs.map(r => r.passe), [true, true, true, true, true, false]);
        H.v('6b. … le refus est celui du plafond (DEBIT, 429)', rs[5].res.code, 429);
        const lim2 = fabrique(() => cfg, {});
        const g = { method: 'POST', originalUrl: '/api/identifier', ip: '203.0.113.10', headers: {}, body: { contrat: 2 } }; let a = false, b = false;
        lim2.plafondGrand(g, fauxRes(), () => { a = true; });
        lim2.plafondIp(g, fauxRes(), () => { b = true; });
        H.v('6c. une requête comptée par plafondGrand n\'est PAS recomptée par plafondIp (une seule fois dans la fenêtre)', [a, b, lim2.taillePlafond()], [true, true, 1]);
        let n = 0; const lim3 = fabrique(() => cfg, {});
        for (let i = 0; i < 6; i++) lim3.plafondIp({ method: 'POST', originalUrl: '/api/identifier', ip: '203.0.113.11', headers: {}, body: { contrat: 2 } }, fauxRes(), () => { n++; });
        H.v('6d. 🔑 variante : plafondIp seul compte chaque requête (5 passent, la 6e est refusée) — le marqueur `_plafondIpCompte` est ce qui évite le double compte', n, 5);
        const res0 = fauxRes(); let ok0 = false;
        fabrique(() => null, {}).plafondGrand({ method: 'POST', originalUrl: '/api/identifier', ip: '1.1.1.1', headers: {} }, res0, () => { ok0 = true; });
        H.v('6e. v2 non montée (configuration nulle) : plafondGrand REFUSE (400) et ne laisse jamais passer un grand corps', [ok0, res0.code], [false, 400]);
    }
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
