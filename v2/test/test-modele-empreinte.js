'use strict';
// Banc INDEX-EMPREINTES (tour de correction 1) — GET /api/modele-empreinte/<sha256> répond 302 vers une adresse R2 PRÉSIGNÉE ; le modèle ne transite JAMAIS par l'API. Base EN MÉMOIRE du banc, serveur HTTP réel (en processus),
// le « R2 » est un FAUX client S3 (aucun réseau, aucun bucket, aucune clé réelle) qui ne connaît que HeadObject : une lecture du corps (GetObject) le fait lever. L'assertion du drapeau ÉTEINT vient en PREMIER (après la signature pure).
// Les variantes rouges prouvent que chaque garde peut échouer : mauvais sha256, métadonnée fausse ou absente, taille fausse, R2 en panne, variables absentes, durée de l'adresse.
const H = require('./_harnais');
const crypto = require('crypto'), http = require('http');
const mongoose = require('mongoose');
const QA = require('./_aide-quota');
const { lireConfig } = require('../config');
const M = require('../modeles'), db = require('../db');
const ME = require('../identifier/modele-empreinte');

const TAILLE = 118202501;
const SHA = crypto.createHash('sha256').update('le-fichier-du-modele-du-banc').digest('hex');
const AUTRE_SHA = crypto.createHash('sha256').update('autre').digest('hex');
const OBJET = 'modeles/p8000-poids8s-1-banc.onnx';
const ENV_BASE = { MONGODB_BASE: 'test_scratch', V2_EMPREINTE_EXTENSION: '1', V2_MODELE_EMPREINTE_ID: 'p8000-poids8-banc', V2_MODELE_EMPREINTE_SHA256: SHA, V2_MODELE_EMPREINTE_OCTETS: String(TAILLE), V2_MODELE_EMPREINTE_OBJET: OBJET };
const ENV_R2 = { V2_VISUELS_R2_COMPTE: 'compte-banc', V2_VISUELS_R2_CLE_ID: 'CLEIDBANC0000000001', V2_VISUELS_R2_SECRET: 'secret-de-banc-qui-ne-doit-jamais-sortir', V2_VISUELS_R2_BUCKET: 'bucket-banc' };
let nIp = 0; const ip = () => ({ 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${++nIp % 250 + 1}` });

function obtenir(url, chemin, { methode = 'GET', entetes = {}, ip: monIp } = {}) {
    return new Promise((ok, ko) => {
        const u = new URL(url + chemin);
        const r = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: methode, headers: { ...(monIp ? { 'x-forwarded-for': monIp } : ip()), ...entetes } }, res => {
            const m = []; res.on('data', d => m.push(d)); res.on('end', () => ok({ statut: res.statusCode, entetes: res.headers, corps: Buffer.concat(m) }));
        });
        r.on('error', ko); r.end();
    });
}
/** Faux client S3 : SEULEMENT HeadObject (tout autre appel lève et est compté). */
function fauxClient({ meta = SHA, taille = TAILLE, echec = false } = {}) {
    const appels = [];
    return { appels, async send(cmd) {
        const nom = cmd.constructor.name; appels.push([nom, cmd.input.Key]);
        if (nom !== 'HeadObjectCommand') throw new Error(`appel interdit : ${nom} (le corps de l'objet n'est jamais lu)`);
        if (echec) throw Object.assign(new Error('boum'), { name: 'ServiceUnavailable' });
        return { ContentLength: taille, Metadata: meta ? { sha256: meta } : {} };
    } };
}

(async () => {
    // ── (0) la signature SigV4 : le vecteur PUBLIÉ par AWS (« Authenticating Requests: Using Query Parameters », GET examplebucket/test.txt, 86400 s)
    {
        // Identifiant et secret d'EXEMPLE de la documentation AWS (le vecteur public) : composés par morceaux A L'EXECUTION, jamais en littéral entier (aucune forme de clé dans le dépôt).
        const cleVecteur = ['AKI', 'AIOSFODNN7', 'EXAMPLE'].join('');
        const secretVecteur = ['wJalrXUtnFEMI/K7MDENG', '/bPxRfiCY', 'EXAMPLEKEY'].join('');
        const base = { hote: 'examplebucket.s3.amazonaws.com', cheminCanonique: '/test.txt', cleId: cleVecteur, secret: secretVecteur, region: 'us-east-1', maintenant: new Date('2013-05-24T00:00:00Z') };
        const v = ME.signerSigV4({ ...base, expireS: 86400 });
        H.v('0a. 🔑 le vecteur publié par AWS : la signature calculée est exactement aeeed9bb…d404', /X-Amz-Signature=([0-9a-f]+)$/.exec(v)[1], 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404');
        const refus = []; for (const e of [601, 0, 86400, 1.5, -1]) { try { ME.presigner({ ...base, expireS: e }); refus.push(false); } catch { refus.push(true); } }
        H.v('0b. 🔑 la durée de l\'adresse est BORNÉE par la route : 601, 0, 86400, 1,5 et -1 s sont refusés', refus, [true, true, true, true, true]);
        H.vrai('0c. variante : 600 s passe, avec X-Amz-Expires=600 et seul « host » signé', /X-Amz-Expires=600&/.test(ME.presigner({ ...base, expireS: 600 })) && /X-Amz-SignedHeaders=host/.test(ME.presigner(base)));
    }
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
    const cfg = lireConfig(ENV_BASE);
    const ORIGINE = cfg.origines.extension;
    const route = (client, env = ENV_R2, extra = {}) => ({ modeleEmpreinte: { client, env, ...extra } });

    // ── (1) drapeau ÉTEINT — la route n'existe pas
    {
        const off = await app(lireConfig({ MONGODB_BASE: 'test_scratch', V2_MODELE_EMPREINTE_ID: 'p8000-poids8-banc', V2_MODELE_EMPREINTE_SHA256: SHA, V2_MODELE_EMPREINTE_OBJET: OBJET }), route(fauxClient()));
        const r = await obtenir(off.url, C);
        H.vrai('1a. drapeau éteint : GET /api/modele-empreinte/<sha256> n\'est pas servi (404, aucune Location)', r.statut === 404 && !r.entetes.location);
        await off.fermer();
    }

    // ── (2) allumé : 302 vers l'adresse présignée, sans lire le corps
    const c = fauxClient(); const horloge = new Date(Date.now() - 1000);
    const sv = await app(cfg, route(c, ENV_R2, { maintenant: () => horloge }));
    {
        const r = await obtenir(sv.url, C);
        const loc = r.entetes.location || ''; const u = loc ? new URL(loc) : null;
        H.v('2a. 302, Cache-Control: no-store, Referrer-Policy: no-referrer, AUCUN corps', [r.statut, r.entetes['cache-control'], r.entetes['referrer-policy'], r.corps.length], [302, 'no-store', 'no-referrer', 0]);
        H.v('2b. 🔑 la Location vise le BON hôte (celui du compte R2) et le chemin exact bucket/objet', u && [u.protocol, u.host, u.pathname], ['https:', 'compte-banc.r2.cloudflarestorage.com', `/bucket-banc/${OBJET}`]);
        H.v('2c. 🔑 lecture seule, 10 minutes au plus : X-Amz-Expires=600, seul « host » signé, SigV4', u && [u.searchParams.get('X-Amz-Expires'), u.searchParams.get('X-Amz-SignedHeaders'), u.searchParams.get('X-Amz-Algorithm')], ['600', 'host', 'AWS4-HMAC-SHA256']);
        H.vrai('2d. 🔑 signée par la clé de lecture : identifiant de clé et portée « auto/s3 » dans le credential, signature de 64 chiffres hexadécimaux', u && u.searchParams.get('X-Amz-Credential').startsWith('CLEIDBANC0000000001/') && /\/auto\/s3\/aws4_request$/.test(u.searchParams.get('X-Amz-Credential')) && /^[0-9a-f]{64}$/.test(u.searchParams.get('X-Amz-Signature')));
        H.vrai('2e. le SECRET de la clé ne figure nulle part dans la réponse (en-têtes, corps, adresse)', !JSON.stringify(r.entetes).includes(ENV_R2.V2_VISUELS_R2_SECRET) && !r.corps.toString().includes(ENV_R2.V2_VISUELS_R2_SECRET));
        H.v('2f. la date de la signature est celle de l\'horloge injectée (X-Amz-Date)', u && u.searchParams.get('X-Amz-Date'), horloge.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''));
        H.v('2g. 🔑 le serveur n\'a fait QU\'UN HEAD de l\'objet : jamais de lecture du corps', c.appels, [['HeadObjectCommand', OBJET]]);
        const h = await obtenir(sv.url, C, { methode: 'HEAD' });
        H.vrai('2h. HEAD sur la route : même redirection, jamais de flux', h.statut === 302 && h.corps.length === 0);
        const rg = await obtenir(sv.url, C, { entetes: { range: 'bytes=0-99' } });
        H.vrai('2i. un en-tête Range ne change rien : la route ne sert aucun octet (Range est servi par R2)', rg.statut === 302 && rg.corps.length === 0);
    }
    // ── (3) l'adresse : un seul sha256 mène à une adresse
    {
        const n = c.appels.length;
        const q = await obtenir(sv.url, `/api/modele-empreinte/${AUTRE_SHA}`);
        H.vrai('3a. 🔑 un sha256 bien formé mais AUTRE que celui de la configuration : 404, aucune adresse, aucun HEAD', q.statut === 404 && !q.entetes.location && c.appels.length === n);
        for (const [nom, chemin] of [['majuscules', `/api/modele-empreinte/${SHA.toUpperCase()}`], ['trop court', `/api/modele-empreinte/${SHA.slice(0, 63)}`], ['trop long', `/api/modele-empreinte/${SHA}0`], ['extension .onnx', `/api/modele-empreinte/${SHA}.onnx`], ['sans sha256', '/api/modele-empreinte/']]) {
            const x = await obtenir(sv.url, chemin); H.vrai(`3b. ${nom} : 404, aucune adresse`, x.statut === 404 && !x.entetes.location);
        }
        H.vrai('3c. un sha256 forgé de chemin (« ../ ») : jamais une adresse', !(await obtenir(sv.url, `/api/modele-empreinte/..%2F${SHA}`)).entetes.location);
    }
    // ── (4) CORS : le profil du modèle, l'extension seulement
    {
        const r = await obtenir(sv.url, C, { entetes: { origin: ORIGINE } });
        H.v('4a. origine de l\'extension : Allow-Origin exacte (jamais *)', r.entetes['access-control-allow-origin'], ORIGINE);
        const pre = await obtenir(sv.url, C, { methode: 'OPTIONS', entetes: { origin: ORIGINE, 'access-control-request-method': 'GET', 'access-control-request-headers': 'range' } });
        H.v('4b. préflight : 204, Range autorisé, GET et HEAD seulement', [pre.statut, pre.entetes['access-control-allow-headers'], pre.entetes['access-control-allow-methods']], [204, 'Range, If-None-Match', 'GET, HEAD']);
        const autre = await obtenir(sv.url, C, { entetes: { origin: 'https://exemple.invalid' } });
        H.vrai('4c. une autre origine ne reçoit aucun en-tête CORS du profil', autre.entetes['access-control-allow-origin'] !== 'https://exemple.invalid');
    }
    await sv.fermer();

    // ── (5) le limiteur par IP, AVANT le gestionnaire
    {
        const cl = fauxClient();
        const lim = await app(lireConfig({ ...ENV_BASE, V2_MODELE_EMPREINTE_IP_HEURE: '3' }), route(cl));
        const sts = []; for (let i = 0; i < 4; i++) sts.push((await obtenir(lim.url, C, { ip: '10.200.0.1' })).statut);
        H.v('5a. 🔑 3 requêtes de la même IP passent (302), la 4e est refusée 429', sts, [302, 302, 302, 429]);
        const q = await obtenir(lim.url, C, { ip: '10.200.0.1' });
        H.vrai('5b. le refus porte Retry-After, aucune adresse', q.statut === 429 && Number(q.entetes['retry-after']) > 0 && !q.entetes.location);
        H.v('5c. et les refus n\'ont pas touché R2 (3 HEAD pour 3 adresses)', cl.appels.length, 3);
        H.v('5d. une AUTRE IP n\'est pas touchée', (await obtenir(lim.url, C, { ip: '10.200.0.2' })).statut, 302);
        await lim.fermer();
    }

    // ── (6) les refus : 502 (métadonnée, taille), 503 (panne, variables) — jamais d'adresse
    {
        for (const [nom, cl] of [['métadonnée sha256 d\'un AUTRE fichier', fauxClient({ meta: AUTRE_SHA })], ['métadonnée sha256 absente', fauxClient({ meta: null })], ['taille différente de V2_MODELE_EMPREINTE_OCTETS', fauxClient({ taille: TAILLE + 1 })]]) {
            const s = await app(cfg, route(cl)); const x = await obtenir(s.url, C);
            H.vrai(`6a. 🔑 ${nom} : 502, rien n'est signé (aucune Location), Cache-Control: no-store`, x.statut === 502 && !x.entetes.location && x.entetes['cache-control'] === 'no-store' && !/CLEID|secret-de-banc/.test(x.corps.toString()));
            await s.fermer();
        }
        const s2 = await app(cfg, route(fauxClient({ echec: true }))); const x2 = await obtenir(s2.url, C);
        H.vrai('6b. R2 en panne : 503 + Retry-After, aucune adresse, aucun détail du pilote', x2.statut === 503 && Number(x2.entetes['retry-after']) > 0 && !x2.entetes.location && !/boum|ServiceUnavailable/.test(x2.corps.toString()));
        await s2.fermer();
        for (const [nom, env] of [['la clé de lecture absente', { ...ENV_R2, V2_VISUELS_R2_CLE_ID: '' }], ['le secret de lecture absent', { ...ENV_R2, V2_VISUELS_R2_SECRET: '' }], ['le bucket absent', { ...ENV_R2, V2_VISUELS_R2_BUCKET: '' }]]) {
            const s = await app(cfg, route(fauxClient(), env)); const x = await obtenir(s.url, C);
            H.vrai(`6c. ${nom} : 503, aucune adresse (le journal nomme la variable, jamais une valeur)`, x.statut === 503 && !x.entetes.location); await s.fermer();
        }
        const s4 = await app(lireConfig({ ...ENV_BASE, V2_MODELE_EMPREINTE_OBJET: '' }), route(fauxClient())); const x4 = await obtenir(s4.url, C);
        H.v('6d. objet du modèle non configuré (V2_MODELE_EMPREINTE_OBJET absent) : 503, aucune adresse', [x4.statut, !!x4.entetes.location], [503, false]); await s4.fermer();
        const s5 = await app(cfg, route(fauxClient(), { ...ENV_R2, V2_VISUELS_R2_ENDPOINT: 'http://exemple.invalid' })); const x5 = await obtenir(s5.url, C);
        H.v('6e. un endpoint qui n\'est pas https : 503, jamais une adresse en clair', [x5.statut, !!x5.entetes.location], [503, false]); await s5.fermer();
        const s6 = await app(cfg, route(fauxClient(), { ...ENV_R2, V2_VISUELS_R2_ENDPOINT: 'https://compte-banc.eu.r2.cloudflarestorage.com' })); const x6 = await obtenir(s6.url, C);
        H.v('6f. juridiction UE (V2_VISUELS_R2_ENDPOINT) : l\'adresse porte l\'hôte UE', new URL(x6.entetes.location).host, 'compte-banc.eu.r2.cloudflarestorage.com'); await s6.fermer();
    }
    restaurerHorloge();
    const monter = require('../identifier/monter'); monter.arreterBalayage(); monter.arreterPurge(); require('../argent/marque-scan').arreterRattrapage();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
