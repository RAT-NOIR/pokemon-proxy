'use strict';
// Banc INDEX-EMPREINTES — GET /api/modele-empreinte/<sha256> : le fichier du modèle servi à l'extension. Base EN MÉMOIRE du banc, serveur HTTP réel (en processus), le « fichier du modèle » est un fichier FABRIQUÉ de 3 Mo
// (octets pseudo-aléatoires à graine fixe), le « R2 » est un FAUX client S3 (aucun réseau, aucun bucket, aucune clé réelle). L'assertion du drapeau ÉTEINT est écrite en PREMIER.
// Les variantes rouges prouvent que chaque garde peut échouer : mauvais sha256, objet de banc d'une autre taille, métadonnée sha256 fausse, plafond d'envois à 1.
const H = require('./_harnais');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const { Readable } = require('stream');
const mongoose = require('mongoose');
const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const M = require('../modeles'), db = require('../db');

const TAILLE = 3 * 1024 * 1024 + 17;
const octets = Buffer.alloc(TAILLE); { let x = 20261018 >>> 0; for (let i = 0; i < TAILLE; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; octets[i] = x >>> 24; } }
const SHA = crypto.createHash('sha256').update(octets).digest('hex');
const AUTRE_SHA = crypto.createHash('sha256').update('autre').digest('hex');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const DOSSIER = fs.mkdtempSync(path.join(os.tmpdir(), 'modele-empreinte-'));
const FICHIER = path.join(DOSSIER, 'modele-banc.onnx'); fs.writeFileSync(FICHIER, octets);
const ENV_BASE = { MONGODB_BASE: 'test_scratch', V2_EMPREINTE_EXTENSION: '1', V2_MODELE_EMPREINTE_ID: 'p8000-poids8-banc', V2_MODELE_EMPREINTE_SHA256: SHA, V2_MODELE_EMPREINTE_OCTETS: String(TAILLE) };
const cfgBanc = (sup = {}) => lireConfig({ ...ENV_BASE, V2_MODELE_EMPREINTE_FICHIER_BANC: FICHIER, ...sup });
let nIp = 0; const ip = () => ({ 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${++nIp % 250 + 1}` });

/** GET/HEAD binaire : rend { statut, entetes, corps: Buffer }. */
function obtenir(url, chemin, { methode = 'GET', entetes = {} } = {}) {
    return new Promise((ok, ko) => {
        const u = new URL(url + chemin);
        const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: methode, headers: { ...ip(), ...entetes } }, res => {
            const m = []; res.on('data', d => m.push(d)); res.on('end', () => ok({ statut: res.statusCode, entetes: res.headers, corps: Buffer.concat(m) }));
        });
        r.on('error', ko); r.end();
    });
}
/** Un faux client S3 : Head/Get sur le fichier fabriqué ; `meta` règle la métadonnée sha256, `taille` la taille annoncée, `lent` ralentit le flux, `echec` fait lever Head ou Get. */
function fauxClient({ meta = SHA, taille = TAILLE, lent = false, echec = null } = {}) {
    const appels = [];
    return { appels, async send(cmd) {
        const nom = cmd.constructor.name; appels.push([nom, cmd.input.Key, cmd.input.Range || null]);
        if (echec === nom) throw Object.assign(new Error('boum'), { name: 'ServiceUnavailable' });
        if (nom === 'HeadObjectCommand') return { ContentLength: taille, Metadata: meta ? { sha256: meta } : {} };
        const m = /^bytes=(\d+)-(\d+)$/.exec(cmd.input.Range); const morceau = octets.subarray(Number(m[1]), Number(m[2]) + 1);
        if (!lent) return { Body: Readable.from([morceau]) };
        return { Body: new Readable({ read() { setTimeout(() => { this.push(morceau.subarray(0, 1000)); this.push(null); }, 700); } }) };
    } };
}
const ENV_R2 = { V2_VISUELS_R2_COMPTE: 'compte-banc', V2_VISUELS_R2_CLE_ID: 'cle-banc-00', V2_VISUELS_R2_SECRET: 'secret-banc-0000', V2_VISUELS_R2_BUCKET: 'bucket-banc' };

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-modele-empreinte.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const restaurerHorloge = H.fixerHorlogeMilieu();
    const express = require('express'); const pret = require('../pret');
    const { assembler } = require('../index'); const { middlewareV2 } = require('../transport/cors');
    pret.armer(M.verifierIndex);
    const app = async (cfg, deps = {}) => {
        const a = express(); a.set('trust proxy', true); a.use(middlewareV2(cfg));
        a.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: (q, s) => s.json({}), ...deps }));
        return H.serveur(a);
    };
    const C = `/api/modele-empreinte/${SHA}`;
    const ORIGINE = cfgBanc().origines.extension;

    // ── (1) EN PREMIER : drapeau ÉTEINT — la route n'existe pas
    {
        const off = await app(lireConfig({ MONGODB_BASE: 'test_scratch', V2_MODELE_EMPREINTE_ID: 'p8000-poids8-banc', V2_MODELE_EMPREINTE_SHA256: SHA }));
        const r = await obtenir(off.url, C);
        H.vrai('1a. drapeau éteint : GET /api/modele-empreinte/<sha256> n\'est pas servi (404, aucun octet du fichier)', r.statut === 404 && r.corps.length < 2000 && !r.corps.includes(octets.subarray(0, 64)));
        await off.fermer();
    }

    // ── (2) allumé, fichier de banc : le fichier ENTIER, octet pour octet
    const sv = await app(cfgBanc());
    {
        const r = await obtenir(sv.url, C);
        H.v('2a. 200 et le corps est EXACTEMENT le fichier (sha256 du corps = sha256 de l\'adresse)', [r.statut, sha(r.corps)], [200, SHA]);
        H.v('2b. Cache-Control exact, immuable un an', r.entetes['cache-control'], 'public, max-age=31536000, immutable');
        H.v('2c. Content-Length = la taille du fichier, Accept-Ranges: bytes, ETag = "<sha256>", octet-stream, nosniff', [r.entetes['content-length'], r.entetes['accept-ranges'], r.entetes.etag, r.entetes['content-type'], r.entetes['x-content-type-options']], [String(TAILLE), 'bytes', `"${SHA}"`, 'application/octet-stream', 'nosniff']);
        H.vrai('2d. aucune Set-Cookie, aucune clé d\'objet ni nom de bucket dans les en-têtes', !r.entetes['set-cookie'] && !JSON.stringify(r.entetes).includes('bucket') && !JSON.stringify(r.entetes).includes('modele-banc'));
    }
    // ── (3) l'adresse : un seul sha256 mène à un octet
    {
        const q = await obtenir(sv.url, `/api/modele-empreinte/${AUTRE_SHA}`);
        H.vrai('3a. 🔑 un sha256 bien formé mais AUTRE que celui de la configuration : 404, aucun octet du fichier', q.statut === 404 && q.corps.length < 500 && !q.corps.includes(octets.subarray(0, 64)));
        for (const [nom, chemin] of [['majuscules', `/api/modele-empreinte/${SHA.toUpperCase()}`], ['trop court', `/api/modele-empreinte/${SHA.slice(0, 63)}`], ['trop long', `/api/modele-empreinte/${SHA}0`], ['extension .onnx', `/api/modele-empreinte/${SHA}.onnx`], ['sans sha256', '/api/modele-empreinte/']])
            H.vrai(`3b. ${nom} : 404`, (await obtenir(sv.url, chemin)).statut === 404);
        H.vrai('3c. un sha256 forgé de chemin (« ../ ») : 404 ou refus, jamais le fichier', (await obtenir(sv.url, `/api/modele-empreinte/..%2F${SHA}`)).statut !== 200);
    }
    // ── (4) Range : UNE plage simple
    {
        const p1 = await obtenir(sv.url, C, { entetes: { range: 'bytes=0-99' } });
        H.v('4a. bytes=0-99 : 206, Content-Range, 100 octets identiques', [p1.statut, p1.entetes['content-range'], p1.entetes['content-length'], p1.corps.equals(octets.subarray(0, 100))], [206, `bytes 0-99/${TAILLE}`, '100', true]);
        const p2 = await obtenir(sv.url, C, { entetes: { range: 'bytes=1000000-' } });
        H.v('4b. bytes=1000000- : 206 jusqu\'à la fin, octets identiques', [p2.statut, p2.entetes['content-range'], p2.corps.equals(octets.subarray(1000000))], [206, `bytes 1000000-${TAILLE - 1}/${TAILLE}`, true]);
        const p3 = await obtenir(sv.url, C, { entetes: { range: 'bytes=-50' } });
        H.v('4c. bytes=-50 : les 50 derniers octets', [p3.statut, p3.entetes['content-range'], p3.corps.equals(octets.subarray(TAILLE - 50))], [206, `bytes ${TAILLE - 50}-${TAILLE - 1}/${TAILLE}`, true]);
        const p4 = await obtenir(sv.url, C, { entetes: { range: `bytes=${TAILLE - 10}-${TAILLE + 5000}` } });
        H.v('4d. une fin au-delà du fichier est ramenée à la fin', [p4.statut, p4.entetes['content-range'], p4.corps.length], [206, `bytes ${TAILLE - 10}-${TAILLE - 1}/${TAILLE}`, 10]);
        const p5 = await obtenir(sv.url, C, { entetes: { range: `bytes=${TAILLE}-` } });
        H.v('4e. un début hors du fichier : 416 avec Content-Range: bytes */taille, aucun octet du fichier', [p5.statut, p5.entetes['content-range'], p5.corps.length < 500], [416, `bytes */${TAILLE}`, true]);
        for (const [nom, entete] of [['plusieurs plages', 'bytes=0-9,20-29'], ['autre unité', 'items=0-9'], ['illisible', 'bytes=abc'], ['plage inversée', 'bytes=50-10']]) {
            const r = await obtenir(sv.url, C, { entetes: { range: entete } });
            H.v(`4f. ${nom} : l'en-tête est ignoré, réponse entière (200)`, [r.statut, r.corps.length], [200, TAILLE]);
        }
    }
    // ── (5) HEAD et revalidation
    {
        const h = await obtenir(sv.url, C, { methode: 'HEAD' });
        H.v('5a. HEAD : 200, Content-Length, aucun corps', [h.statut, h.entetes['content-length'], h.corps.length], [200, String(TAILLE), 0]);
        const n = await obtenir(sv.url, C, { entetes: { 'if-none-match': `"${SHA}"` } });
        H.v('5b. If-None-Match = l\'ETag : 304, aucun corps', [n.statut, n.corps.length], [304, 0]);
        const n2 = await obtenir(sv.url, C, { entetes: { 'if-none-match': `"${AUTRE_SHA}"` } });
        H.v('5c. variante : un autre ETag ⇒ 200 entier', [n2.statut, n2.corps.length], [200, TAILLE]);
    }
    // ── (6) CORS : le profil du modèle, l'extension seulement
    {
        const r = await obtenir(sv.url, C, { entetes: { origin: ORIGINE, range: 'bytes=0-9' } });
        H.v('6a. origine de l\'extension : Allow-Origin exacte (jamais *), Expose-Headers lisible', [r.entetes['access-control-allow-origin'], /Content-Range/.test(r.entetes['access-control-expose-headers'] || ''), /Content-Length/.test(r.entetes['access-control-expose-headers'] || '')], [ORIGINE, true, true]);
        const pre = await obtenir(sv.url, C, { methode: 'OPTIONS', entetes: { origin: ORIGINE, 'access-control-request-method': 'GET', 'access-control-request-headers': 'range' } });
        H.v('6b. préflight : 204, Range autorisé, GET et HEAD seulement', [pre.statut, pre.entetes['access-control-allow-headers'], pre.entetes['access-control-allow-methods']], [204, 'Range, If-None-Match', 'GET, HEAD']);
        const autre = await obtenir(sv.url, C, { entetes: { origin: 'https://exemple.invalid' } });
        H.vrai('6c. une autre origine ne reçoit aucun en-tête CORS du profil', !autre.entetes['access-control-allow-origin'] || autre.entetes['access-control-allow-origin'] !== 'https://exemple.invalid');
    }
    await sv.fermer();

    // ── (7) le limiteur par IP, AVANT le gestionnaire
    {
        const lim = await app(cfgBanc({ V2_MODELE_EMPREINTE_IP_HEURE: '3' }));
        const memeIp = { 'x-forwarded-for': '10.200.0.1' };
        const get = () => new Promise((ok, ko) => { const u = new URL(lim.url); http.get({ host: u.hostname, port: u.port, path: C, headers: { ...memeIp, range: 'bytes=0-9' } }, res => { const m = []; res.on('data', d => m.push(d)); res.on('end', () => ok({ statut: res.statusCode, entetes: res.headers, texte: Buffer.concat(m).toString() })); }).on('error', ko); });
        const sts = []; for (let i = 0; i < 4; i++) sts.push((await get()).statut);
        H.v('7a. 🔑 3 requêtes de la même IP passent, la 4e est refusée 429', sts, [206, 206, 206, 429]);
        const q = await get();
        H.vrai('7b. le refus porte Retry-After et ne contient aucun octet du fichier', q.statut === 429 && Number(q.entetes['retry-after']) > 0 && !q.texte.includes(octets.subarray(0, 8).toString('latin1')));
        const autreIp = await obtenir(lim.url, C, { entetes: { range: 'bytes=0-9', 'x-forwarded-for': '10.200.0.2' } });
        H.v('7c. une AUTRE IP n\'est pas touchée', autreIp.statut, 206);
        await lim.fermer();
    }

    // ── (8) R2 privé (faux client) : métadonnée, taille, panne, variables
    {
        const c = fauxClient(); const cfg = lireConfig({ ...ENV_BASE, V2_MODELE_EMPREINTE_OBJET: 'modeles/p8000-poids8-1.onnx' });
        const r2 = await app(cfg, { modeleEmpreinte: { client: c, env: { ...ENV_R2 } } });
        const r = await obtenir(r2.url, C);
        H.v('8a. R2 : 200, corps = fichier, une lecture de métadonnées puis UNE lecture de l\'objet avec Range sur tout le fichier', [r.statut, sha(r.corps), c.appels.map(a => a[0]), c.appels[1][2], c.appels[1][1]], [200, SHA, ['HeadObjectCommand', 'GetObjectCommand'], `bytes=0-${TAILLE - 1}`, 'modeles/p8000-poids8-1.onnx']);
        const p = await obtenir(r2.url, C, { entetes: { range: 'bytes=10-19' } });
        H.v('8b. R2 : la plage est transmise telle quelle à R2 (aucun octet de trop lu)', [p.statut, p.corps.equals(octets.subarray(10, 20)), c.appels[c.appels.length - 1][2]], [206, true, 'bytes=10-19']);
        const h = await obtenir(r2.url, C, { methode: 'HEAD' }); const avant = c.appels.length;
        H.vrai('8c. HEAD : la taille vient de la métadonnée, l\'objet n\'est pas lu', h.statut === 200 && c.appels[avant - 1][0] === 'HeadObjectCommand');
        await r2.fermer();
        // rouge : métadonnée fausse / absente, taille fausse
        for (const [nom, cl] of [['métadonnée sha256 d\'un AUTRE fichier', fauxClient({ meta: AUTRE_SHA })], ['métadonnée sha256 absente', fauxClient({ meta: null })], ['taille différente de V2_MODELE_EMPREINTE_OCTETS', fauxClient({ taille: TAILLE + 1 })]]) {
            const s = await app(cfg, { modeleEmpreinte: { client: cl, env: { ...ENV_R2 } } });
            const x = await obtenir(s.url, C);
            H.vrai(`8d. 🔑 ${nom} : 502, aucun octet du fichier, l'objet n'est pas lu`, x.statut === 502 && x.corps.length < 500 && !cl.appels.some(a => a[0] === 'GetObjectCommand'));
            await s.fermer();
        }
        const pan = fauxClient({ echec: 'HeadObjectCommand' }); const s2 = await app(cfg, { modeleEmpreinte: { client: pan, env: { ...ENV_R2 } } });
        const x2 = await obtenir(s2.url, C);
        H.vrai('8e. R2 en panne : 503 + Retry-After, aucun détail du pilote dans le corps', x2.statut === 503 && Number(x2.entetes['retry-after']) > 0 && !/boum|ServiceUnavailable/.test(x2.corps.toString()));
        await s2.fermer();
        const s3 = await app(cfg, { modeleEmpreinte: { client: fauxClient(), env: { V2_VISUELS_R2_COMPTE: 'x' } } });
        const x3 = await obtenir(s3.url, C);
        H.vrai('8f. variables R2 absentes : 503 (le journal les nomme, jamais une valeur) et le corps ne dit rien', x3.statut === 503 && x3.corps.length < 500);
        await s3.fermer();
        const s4 = await app(lireConfig({ ...ENV_BASE }), { modeleEmpreinte: { client: fauxClient(), env: { ...ENV_R2 } } });
        H.v('8g. objet du modèle non configuré (V2_MODELE_EMPREINTE_OBJET absent) : 503', (await obtenir(s4.url, C)).statut, 503);
        await s4.fermer();
    }

    // ── (9) le plafond d'envois simultanés : le troisième attend dehors
    {
        const lent = fauxClient({ lent: true });
        const cfg = lireConfig({ ...ENV_BASE, V2_MODELE_EMPREINTE_OBJET: 'modeles/x.onnx', V2_MODELE_EMPREINTE_IP_HEURE: '100' });
        const s = await app(cfg, { modeleEmpreinte: { client: lent, env: { ...ENV_R2 }, maxFlux: 1 } });
        const un = obtenir(s.url, C, { entetes: { range: 'bytes=0-999' } });
        await new Promise(r => setTimeout(r, 250));
        const deux = await obtenir(s.url, C, { entetes: { range: 'bytes=0-999' } });
        H.vrai('9a. 🔑 plafond à 1 envoi : pendant qu\'un envoi dure, le suivant reçoit 503 + Retry-After', deux.statut === 503 && Number(deux.entetes['retry-after']) > 0);
        await un;
        const trois = await obtenir(s.url, C, { entetes: { range: 'bytes=0-999' } });
        H.v('9b. l\'envoi fini, le plafond est LIBÉRÉ : la requête suivante passe', trois.statut, 206);
        await s.fermer();
    }
    try { fs.unlinkSync(FICHIER); fs.rmdirSync(DOSSIER); } catch { /* le dossier temporaire du banc (un fichier, non récursif) */ }
    restaurerHorloge();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
