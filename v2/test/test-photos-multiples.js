'use strict';
// PHOTOS-MULTIPLES (7d) — POST /api/photo?index=<0..7> (les octets d'une photo de l'annonce, AVANT le scan, administrateur, derrière V2_PHOTOS_MULTIPLES=1) et POST /api/identifier { photoIds: [{ index, photoId }] }.
// Base EN MÉMOIRE, stockage MÉMOIRE, images SYNTHÉTIQUES (sharp). 🔑 Aucune requête hors de la boucle locale : un espion compte tout appel sortant (fetch, https) et le TÉLÉCHARGEUR de la photo du banc est un compteur.
// La preuve d'un refus « avant la lecture » est un COMPTEUR D'OCTETS LUS : `socket.bytesRead` au moment où la réponse part (comme test-banc-photo.js).
const H = require('./_harnais');
const http = require('http'), https = require('https');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const { creerBanc } = require('../banc/routes');
const S = require('../banc/stockage');
const registre = require('../registre');
const { creerPhotosRecues } = require('../identifier/photos-recues');

const BASE = { MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '100000', V2_PHOTO_ADMIN_DELAI_S: '0' };
const cfgOn = lireConfig({ ...BASE, V2_PHOTOS_MULTIPLES: '1' });
const cfgOff = lireConfig({ ...BASE });
const cfgPlafond = lireConfig({ ...BASE, V2_PHOTOS_MULTIPLES: '1', V2_ETIQUETTE_HEURE: '3' });
const oid = () => new mongoose.Types.ObjectId();
const ENV = { V2_BANC_BUCKET: 'bucket-banc-test', V2_BANC_SEL: 'sel-photos-multiples' };
const MIO = 1024 * 1024;
const attendre = ms => new Promise(r => setTimeout(r, ms));
const jusque = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await attendre(20); } return false; };
const bruit = (w = 400, h = 560) => sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
const lus = new Map();
let nEssai = 0, nIp = 0, nCle = 0;
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };
const FORME_ID = /^[0-9a-f]{32}$/;
const code = r => r.json && r.json.erreur && r.json.erreur.code;
const detail = r => r.json && r.json.erreur && r.json.erreur.detail;

// ── l'ESPION des sorties : tout appel sortant hors de la boucle locale est noté. Un banc de « zéro téléchargement » dont l'instrument ne sait rien voir ne prouve rien : le cas témoin plus bas le fait compter.
const sorties = [];
{
    const local = h => /^(127\.0\.0\.1|localhost|::1|\[::1\])$/.test(String(h || ''));
    const f0 = globalThis.fetch;
    globalThis.fetch = function (u, ...r) { try { const h = new URL(typeof u === 'string' ? u : (u && u.url) || String(u)).hostname; if (!local(h)) sorties.push(`fetch ${h}`); } catch { /* URL illisible */ } return f0.call(this, u, ...r); };
    for (const k of ['request', 'get']) { const o = https[k]; https[k] = function (...a) { sorties.push(`https.${k}`); return o.apply(this, a); }; }
}
// ── l'ESPION des journaux : tout ce que le processus écrit sur la console pendant le banc
const journaux = [];
for (const k of ['log', 'warn', 'error', 'info']) { const o = console[k]; console[k] = (...a) => { journaux.push(a.map(x => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch { return String(x); } })())).join(' ')); return o.apply(console, a); }; }

function envoyer(base, { chemin = '/api/photo', query, jeton, type = 'image/jpeg', corps = Buffer.alloc(0), contentLength, partiel = null, attente = 8000 } = {}) {
    const essai = `e${++nEssai}`, url = new URL(base + chemin + (query === undefined ? '' : `?${query}`));
    const h = { 'x-essai': essai, 'x-forwarded-for': `10.30.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}` };
    if (type) h['content-type'] = type; if (jeton) h.authorization = `Bearer ${jeton}`;
    if (contentLength !== null) h['content-length'] = String(contentLength !== undefined ? contentLength : corps.length);
    let ferme = false, repondu = null, fin; const fini = new Promise(r => { fin = r; });
    const req = http.request({ host: url.hostname, port: url.port, path: url.pathname + url.search, method: 'POST', headers: h, agent: false }, res => {
        const m = []; res.on('data', c => m.push(c));
        res.on('end', () => { const t = Buffer.concat(m).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch { /* non JSON */ } repondu = { statut: res.statusCode, entetes: res.headers, json: j, texte: t }; fin(repondu); });
    });
    req.on('error', () => { ferme = true; setTimeout(() => fin(repondu || { statut: null, erreur: true }), 300); });
    req.on('close', () => { ferme = true; setTimeout(() => fin(repondu || { statut: null, ferme: true }), 300); });
    const garde = setTimeout(() => { if (!repondu) { fin({ statut: 'EXPIRE-sans-reponse' }); try { req.destroy(); } catch { /* déjà fermée */ } } }, attente); garde.unref();
    if (partiel !== null) req.write(corps.subarray(0, partiel));
    else if (contentLength === null) { req.write(corps.subarray(0, 100)); req.end(corps.subarray(100)); }
    else req.end(corps);
    return { essai, req, fini, estFerme: () => ferme, lus: () => lus.get(essai) };
}

setTimeout(() => { console.error('❌ le banc a dépassé 170 s'); process.exit(1); }, 170000).unref();
(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { await attendre(reste + 2000); } }

    // ═══ 0. la configuration : « 1 » exactement allume ; tout le reste éteint SANS invalider ; le second état (phase 2) est lu, éteint, et ne branche rien ═══
    H.v('0. config : drapeau absent ⇒ éteint', cfgOff.photosMultiples, false);
    H.v('0. config : V2_PHOTOS_MULTIPLES=1 ⇒ allumé', cfgOn.photosMultiples, true);
    for (const autre of ['0', 'true', 'oui', ' 1', '2', '1 ', '']) H.v(`0. config : V2_PHOTOS_MULTIPLES="${autre}" ⇒ éteint (et la configuration reste valide)`, lireConfig({ ...BASE, V2_PHOTOS_MULTIPLES: autre }).photosMultiples, false);
    H.v('0. config : le second état (tous les porteurs) est ÉTEINT par défaut, allumé par « 1 » exactement, et jamais sans le premier', [cfgOn.photosMultiplesTous, lireConfig({ ...BASE, V2_PHOTOS_MULTIPLES: '1', V2_PHOTOS_MULTIPLES_TOUS: '1' }).photosMultiplesTous, lireConfig({ ...BASE, V2_PHOTOS_MULTIPLES_TOUS: '1' }).photosMultiplesTous, lireConfig({ ...BASE, V2_PHOTOS_MULTIPLES: '1', V2_PHOTOS_MULTIPLES_TOUS: 'oui' }).photosMultiplesTous], [false, true, false, false]);

    await H.ouvrirBac('test-photos-multiples.js'); await M.creerIndex();
    const mem = S.creerStockageMemoire();
    const stockage = { async verifierBucket() { }, ecrire: (c, b) => mem.ecrire(c, b), supprimer: c => mem.supprimer(c), lire: c => mem.lire(c), lister: () => mem.lister(), cles: () => mem.cles() };
    const banc = creerBanc({ cfg: cfgOn, env: ENV, stockage });
    registre.fournir('banc', banc);
    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null, lie = true } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), ...(lie ? { compteId: c._id, generation: 0 } : {}) });
        return { c, jeton, porteur: `compte:${c._id}` };
    }
    const ADM = await acteur({ role: 'administrateur' }), ADM2 = await acteur({ role: 'administrateur' }), ADM3 = await acteur({ role: 'administrateur' }), ADM4 = await acteur({ role: 'administrateur' }), ADM5 = await acteur({ role: 'administrateur' });
    const USR = await acteur({}), SEUL = await acteur({ lie: false });

    const pret = require('../pret'), { dansUnScan } = require('../../sources'), { assembler } = require('../index');
    const horloge = { t: Date.now() };
    const stockPhotos = creerPhotosRecues({ horloge: () => horloge.t });
    let chaineAppels = 0, tel = 0, vusParLaChaine = [];
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const chaine = async (req, res) => { chaineAppels++; vusParLaChaine.push([...(req.body.imageUrls || [])]); res.json({ success: true, carte: { idProduct: 4242, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '58', total: '102', setCode: 'BS', rarete: null, langue: 'FR', ambigu: false }, etat: ETAT, candidats: [], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2, scanId: String(req.scanIdImpose) }); };
    for (const [id, nom] of [[4242, 'Pikachu']]) { await db.col('catalogue_produits').insertOne({ idProduct: id, name: nom, idMetacard: id }); await db.col('numeros_cartes').insertOne({ idProduct: id, slugSet: 'Base-Set', numero: String(id % 100) }); }
    const monter = async (cfg, reglage = { placesMax: 2, delaiLectureMs: 1200 }, photos = stockPhotos) => {
        const app = express(); app.set('trust proxy', true);
        app.use((q, s, n) => { const wh = s.writeHead; s.writeHead = function (...a) { lus.set(q.headers['x-essai'], q.socket.bytesRead); return wh.apply(this, a); }; n(); });
        app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
        app.use(assembler([require('../argent/monter'), require('../identifier/monter'), monterBanc], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), banc, purge: purgeStub, photoRoute: reglage, photoAvantScan: reglage, photosRecues: photos, telechargerPhoto: async () => { tel++; return bruit(); } }));
        return H.serveur(app);
    };
    const sv = await monter(cfgOn), svOff = await monter(cfgOff), svPlafond = await monter(cfgPlafond);
    const url = sv.url;
    const jpg = await bruit();
    const pasLu = c => (c.lus() ?? 1e9) < 100 * 1024;
    const refus = async (nom, opts, statut, det) => {
        const avant = stockPhotos.taille(opts.porteur || '').photos;
        const c = envoyer(url, { partiel: 16, corps: jpg, attente: 2500, ...opts }); const r = await c.fini;      // une réponse DOIT partir sans le corps
        H.v(`${nom} : ${statut}${det ? ` (${det})` : ''}, corps NON lu (moins de 100 ko lus), rien retenu`, [r.statut, det === undefined ? undefined : detail(r), pasLu(c), stockPhotos.taille(opts.porteur || '').photos - avant], [statut, det, true, 0]);
        return r;
    };
    const IMG = i => `https://images1.vinted.net/t/01_00000_abcdef/f800/17000000${i}.jpeg`;
    const corpsId = (extra = {}, n = 1) => ({ contrat: 2, imageUrls: Array.from({ length: n }, (_, i) => IMG(i)), title: 'Pikachu 58/102', description: '', prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...extra });
    const identifier = (srv, a, corps) => fetch(srv.url + '/api/identifier', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jeton}`, 'idempotency-key': `photos-${++nCle}-${Date.now()}-abcdefgh` }, body: JSON.stringify(corps) }).then(async r => { const texte = await r.text(); let json = null; try { json = JSON.parse(texte); } catch { /* */ } return { statut: r.status, json, texte }; });
    const poster = async (a, index, corps = jpg, type = 'image/jpeg') => envoyer(url, { query: `index=${index}`, jeton: a.jeton, corps, type }).fini;
    const dataVersOctets = u => Buffer.from(String(u).split(',')[1], 'base64');
    const lireAn = id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });

    // ═══ 1. le drapeau ÉTEINT : la route n'existe pour personne ; /api/identifier est celui d'aujourd'hui, octet pour octet ═══
    await essayer('1', async () => {
        const brut = async (srv, jeton, chemin) => { const x = await fetch(srv.url + chemin, { method: 'POST', headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${jeton}` }, body: jpg }); const texte = await x.text(); const h = Object.fromEntries(x.headers); delete h.date; delete h['content-length']; delete h.etag; return { statut: x.status, texte: texte.split(chemin.split('?')[0]).join('<CHEMIN>'), h }; };
        const vraie = await brut(svOff, ADM.jeton, '/api/photo/inexistante');
        H.vrai('1. instrument : une route inexistante rend un 404 non JSON qui cite le chemin', vraie.statut === 404 && vraie.texte.includes('<CHEMIN>'));
        H.v('1. drapeau éteint : MÊME un administrateur reçoit EXACTEMENT la réponse d\'une route inexistante', await brut(svOff, ADM.jeton, '/api/photo?index=0'), vraie);
        H.v('1. drapeau éteint, sans jeton : 404 aussi (la route n\'existe pas), pas 401', (await envoyer(svOff.url, { query: 'index=0', corps: jpg }).fini).statut, 404);
        // /api/identifier : un champ inconnu aujourd'hui, avec ou sans le drapeau éteint — la même réponse, octet pour octet (à l'identifiant du scan près)
        const norm = r => r.texte.replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"X"');
        const sans = await identifier(svOff, ADM, corpsId());
        const avec = await identifier(svOff, ADM, corpsId({ photoIds: [{ index: 0, photoId: 'a'.repeat(32) }] }));
        const mal = await identifier(svOff, ADM, corpsId({ photoId: 'pas-un-photo-id', photoIds: 'x' }));
        H.v('1. drapeau éteint : `photoIds` est un champ inconnu comme aujourd\'hui — mêmes statut et corps, octet pour octet', [avec.statut, norm(avec)], [sans.statut, norm(sans)]);
        H.v('1. drapeau éteint : `photoId` mal formé et `photoIds` absurde — AUCUN 400 (champs inconnus, ignorés), même corps que sans', [mal.statut, norm(mal)], [sans.statut, norm(sans)]);
        H.vrai('1. drapeau éteint : la chaîne a reçu les URLs https, jamais des octets', vusParLaChaine.slice(-3).every(u => u.every(x => /^https:\/\/images1\.vinted\.net\//.test(x))));
        const avantSrc = require('fs').readFileSync(require.resolve('../identifier/routes.js'), 'utf8');
        H.vrai('1. le drapeau est lu depuis cfg (jamais process.env) dans la validation', !/process\.env/.test(avantSrc));
    });

    // ═══ 2. qui entre, et l'ordre des gardes : tous AVANT la lecture ═══
    await essayer('2', async () => {
        await refus('2. sans Authorization', { query: 'index=0' }, 401);
        await refus('2. jeton inconnu', { query: 'index=0', jeton: J.genererJeton() }, 401);
        const brut = async (jeton, chemin) => { const x = await fetch(url + chemin, { method: 'POST', headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${jeton}` }, body: jpg }); const texte = await x.text(); const h = Object.fromEntries(x.headers); delete h.date; delete h['content-length']; delete h.etag; return { statut: x.status, texte: texte.split(chemin.split('?')[0]).join('<CHEMIN>'), h }; };
        const vraie = await brut(USR.jeton, '/api/photo/inexistante');
        for (const [nom, a] of [['compte non administrateur', USR], ['installation seule', SEUL]]) H.v(`2. ${nom} : EXACTEMENT la réponse d'une route inexistante (404 natif, mêmes corps et en-têtes)`, await brut(a.jeton, '/api/photo?index=0'), vraie);
        await refus('2. non-administrateur : 404, corps non lu', { query: 'index=0', jeton: USR.jeton }, 404);
        // le rôle est RELU en base : un administrateur rétrogradé n'a plus la route
        const D = await acteur({ role: 'administrateur' });
        H.v('2. un administrateur passe', (await poster(D, 0)).statut, 200);
        await db.col('comptes').updateOne({ _id: D.c._id }, { $unset: { role: '' } });
        await refus('2. rôle retiré en base depuis : 404 (relu à chaque requête)', { query: 'index=0', jeton: D.jeton }, 404);
        // le second état du drapeau ne branche rien : même allumé, la phase 2 n'ouvre pas la route aux autres porteurs
        const svTous = await monter(lireConfig({ ...BASE, V2_PHOTOS_MULTIPLES: '1', V2_PHOTOS_MULTIPLES_TOUS: '1' }));
        H.v('2. V2_PHOTOS_MULTIPLES_TOUS=1 est LU et ne change rien : un non-administrateur reçoit toujours le 404 natif', (await envoyer(svTous.url, { query: 'index=0', jeton: USR.jeton, corps: jpg }).fini).statut, 404);
        await svTous.fermer();
    });

    // ═══ 3. la requête : `index` seul, 0 à 7 ═══
    await essayer('3', async () => {
        const P1 = ADM.porteur;
        await refus('3. index absent', { jeton: ADM.jeton, porteur: P1 }, 400, 'index');
        for (const i of ['8', '-1', '9', 'a', '1.5', '01', '', '1e0', ' 1', '0x1']) await refus(`3. index=${JSON.stringify(i)}`, { query: `index=${encodeURIComponent(i)}`, jeton: ADM.jeton, porteur: P1 }, 400, 'index');
        await refus('3. index donné deux fois', { query: 'index=1&index=2', jeton: ADM.jeton, porteur: P1 }, 400, 'index');
        await refus('3. un paramètre de plus (scanId)', { query: `index=0&scanId=${oid()}`, jeton: ADM.jeton, porteur: P1 }, 400, 'champ-inconnu');
        await refus('3. un autre paramètre seul', { query: 'photo=0', jeton: ADM.jeton, porteur: P1 }, 400, 'champ-inconnu');
        for (const type of ['text/plain', 'image/gif', 'image/svg+xml', 'image/heic', null]) await refus(`3. Content-Type ${type}`, { query: 'index=0', jeton: ADM.jeton, type, porteur: P1 }, 415, 'type');
        await refus('3. sans Content-Length (chunked)', { query: 'index=0', jeton: ADM.jeton, contentLength: null, porteur: P1 }, 400, 'content-length');
        await refus('3. Content-Length 0', { query: 'index=0', jeton: ADM.jeton, contentLength: 0, corps: Buffer.alloc(0), partiel: null, porteur: P1 }, 400, 'content-length');
        await refus('3. Content-Length au-delà de 2 Mio', { query: 'index=0', jeton: ADM.jeton, contentLength: 2 * MIO + 1, porteur: P1 }, 413, 'trop-lourde');
        for (const i of ['0', '7']) { const r = await poster(ADM2, i); H.v(`3. index=${i} accepté`, r.statut, 200); }
        const src = require('fs').readFileSync(require.resolve('../identifier/photo-avant-scan.js'), 'utf8');
        H.vrai('3. la validation est celle de photo-extension.js::evaluerOctets, jamais recopiée', /evaluerOctets/.test(src) && !/typeDesOctets|analyserImage|PIXELS_MAX\s*=/.test(src));
    });

    // ═══ 4. le contenu : validé par la validation de photo-extension.js ═══
    await essayer('4', async () => {
        const essai = async (corps, type = 'image/jpeg') => { const r = await envoyer(url, { query: 'index=2', jeton: ADM3.jeton, type, corps }).fini; return [r.statut, detail(r)]; };
        const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#123456' } }).png().toBuffer();
        H.v('4. octets au hasard annoncés JPEG : 415 (format)', await essai(crypto.randomBytes(2000)), [415, 'type']);
        H.v('4. un PNG annoncé `image/jpeg` : 415', await essai(png), [415, 'type']);
        H.v('4. JPEG tronqué : 422 (illisible)', await essai(jpg.subarray(0, jpg.length >> 2)), [422, 'illisible']);
        const large = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
        H.v('4. côté de 4 097 px : 422 (dimensions)', await essai(large, 'image/png'), [422, 'dimensions']);
        const progressif = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 3, g: 4, b: 5 } } }).jpeg({ progressive: true }).toBuffer();
        H.v('4. JPEG progressif de 49 Mpx : 422 (dimensions)', await essai(progressif), [422, 'dimensions']);
        const anime = await sharp(crypto.randomBytes(64 * 64 * 3 * 3), { raw: { width: 64, height: 192, channels: 3, pageHeight: 64 } }).webp({ loop: 0, delay: [100, 100, 100] }).toBuffer();
        H.v('4. WebP animé : 422 (illisible)', await essai(anime, 'image/webp'), [422, 'illisible']);
        const grosse = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#445566' } }).png().toBuffer();
        H.v('4. 4000 × 3000 (12 Mpx) : accepté', (await essai(grosse, 'image/png'))[0], 200);
        for (const [nom, f] of [['PNG', 'png'], ['WebP', 'webp']]) H.v(`4. ${nom} accepté`, (await essai(await sharp({ create: { width: 300, height: 420, channels: 3, background: { r: 9, g: 8, b: 7 } } })[f]().toBuffer(), `image/${f}`))[0], 200);
    });

    // ═══ 5. la réponse : { photoId, expireDans: 120 } ; rien d'écrit, rien débité ═══
    await essayer('5', async () => {
        const tables = async () => { const noms = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => n.includes('mouvements') || n.includes('analyses') || n.includes('banc')); const o = {}; for (const n of noms) o[n] = await mongoose.connection.db.collection(n).countDocuments({}); return o; };
        const avant = await tables(), clesAvant = mem.cles().length;
        const r1 = await poster(ADM4, 1), r2 = await poster(ADM4, 1);
        H.v('5. 200 { success, photoId (32 hexadécimaux), expireDans: 120 } — et rien d\'autre', [r1.statut, r1.json.success, FORME_ID.test(r1.json.photoId), r1.json.expireDans, Object.keys(r1.json).sort()], [200, true, true, 120, ['expireDans', 'photoId', 'success']]);
        H.vrai('5. deux photos, deux identifiants différents (tirés au hasard)', r1.json.photoId !== r2.json.photoId && FORME_ID.test(r2.json.photoId));
        H.v('5. aucun argent, aucune ligne : mouvements, analyses, banc inchangés ; aucun objet au bucket', [await tables(), mem.cles().length - clesAvant], [avant, 0]);
        const src = require('fs').readFileSync(require.resolve('../identifier/photo-avant-scan.js'), 'utf8');
        H.vrai('5. les identifiants viennent de crypto.randomBytes (le magasin)', /randomBytes\(16\)/.test(require('fs').readFileSync(require.resolve('../identifier/photos-recues.js'), 'utf8')));
        H.vrai('5. la route ne débite rien : aucun appel à l\'argent', !/argent|debiter|rembourser/.test(src.replace(/\/\/.*$/gm, '')));
    });

    // ═══ 6. places de lecture, délai de lecture, plafond horaire (ceux de /api/banc/photo) ═══
    await essayer('6', async () => {
        const lent = a => envoyer(url, { query: 'index=0', jeton: a.jeton, corps: jpg, partiel: 100 });
        const A = lent(ADM); await attendre(300);
        const A2 = await refus('6. le MÊME porteur, une deuxième lecture pendant la première', { query: 'index=1', jeton: ADM.jeton }, 429, undefined);
        H.v('6. 429 `DEBIT` avec Retry-After', [code(A2), Boolean(A2.entetes['retry-after'])], ['DEBIT', true]);
        const B = lent(ADM2); await attendre(300);
        await refus('6. plafond GLOBAL (2 ici) : un troisième porteur', { query: 'index=0', jeton: ADM3.jeton }, 429, undefined);
        A.req.destroy(); B.req.destroy(); await attendre(400);
        H.v('6. un client qui coupe libère sa place', (await poster(ADM, 0)).statut, 200);
        const t0 = Date.now(); const L = lent(ADM2); const coupee = await jusque(() => L.estFerme(), 3000);
        H.v('6. un client qui envoie 100 octets puis se tait : connexion COUPÉE après le délai (1,2 s ici)', [coupee, Date.now() - t0 < 3000], [true, true]);
        H.v('6. la place est rendue', (await poster(ADM2, 0)).statut, 200);
        const R = require('../identifier/photo-avant-scan');
        H.v('6. les défauts de production sont ceux de /api/banc/photo : 4 places, délai de 15 s', [R.PLACES_MAX, R.DELAI_LECTURE_MS], [4, 15000]);
        // le plafond horaire : 3 ici, comme etiquetteParPorteurHeure ; la 4e demande est refusée AVANT la lecture
        const sp = svPlafond.url;
        const e3 = []; for (let i = 0; i < 3; i++) e3.push((await envoyer(sp, { query: 'index=0', jeton: ADM5.jeton, corps: jpg }).fini).statut);
        const c4 = envoyer(sp, { query: 'index=0', jeton: ADM5.jeton, corps: jpg, partiel: 16 }); const r4 = await c4.fini;
        H.v('6. plafond horaire par porteur (3 ici) : la 4e demande est 429 DEBIT + Retry-After, corps non lu', [e3, r4.statut, code(r4), Boolean(r4.entetes['retry-after']), pasLu(c4)], [[200, 200, 200], 429, 'DEBIT', true, true]);
    });

    // ═══ 7. le MAGASIN : 120 s, un par service, bornes par porteur (8 photos, 8 Mio) ═══
    await essayer('7', async () => {
        const T = () => horloge.t, mk = n => Buffer.alloc(n, 7);
        const m = creerPhotosRecues({ horloge: T });
        const id1 = m.deposer('p', 0, mk(10));
        H.v('7. le magasin rend un identifiant de 32 hexadécimaux', FORME_ID.test(id1), true);
        H.v('7. prendre : l\'index et les octets, UNE fois (consommé)', [m.prendre('p', id1) && m.prendre('p', id1) === null, m.taille('p')], [true, { photos: 0, octets: 0 }]);
        const id2 = m.deposer('p', 3, mk(10));
        H.v('7. d\'un AUTRE porteur : absent, et la photo n\'est PAS consommée par cette tentative', [m.prendre('q', id2), m.prendre('p', id2) !== null], [null, true]);
        const id3 = m.deposer('p', 0, mk(10)); horloge.t += 119e3;
        H.v('7. à 119 s : encore là', m.prendre('p', id3) !== null, true);
        const id4 = m.deposer('p', 0, mk(10)); horloge.t += 120e3 + 1;
        H.v('7. au-delà de 120 s : expirée (ignorée), et plus retenue (mémoire rendue)', [m.prendre('p', id4), m.taille('p')], [null, { photos: 0, octets: 0 }]);
        // 8 photos au plus : la 9e fait oublier la plus ancienne
        const ids = []; for (let i = 0; i < 9; i++) { ids.push(m.deposer('p', i % 8, mk(100))); horloge.t += 10; }
        H.v('7. 9e photo : 8 retenues, la PLUS ANCIENNE oubliée, les 8 autres intactes', [m.taille('p').photos, m.prendre('p', ids[0]), ids.slice(1).every(i => m.prendre('p', i) !== null)], [8, null, true]);
        // 8 Mio au plus au total : on oublie les plus anciennes jusqu'à tenir
        const g = []; for (let i = 0; i < 5; i++) { g.push(m.deposer('p', i, mk(Math.floor(1.9 * MIO)))); horloge.t += 10; }
        const t = m.taille('p');
        H.v('7. 5 photos de 1,9 Mio (9,5 Mio) : au plus 8 Mio retenus, la plus ancienne oubliée, les 4 suivantes intactes', [t.octets <= 8 * MIO, t.photos, m.prendre('p', g[0]), g.slice(1).every(i => m.prendre('p', i) !== null)], [true, 4, null, true]);
        H.v('7. les bornes sont PAR PORTEUR : un porteur qui dépose beaucoup n\'oublie rien chez un autre', (() => { const a = m.deposer('a', 0, mk(5)); for (let i = 0; i < 20; i++) m.deposer('b', i % 8, mk(5)); return m.prendre('a', a) !== null; })(), true);
        // au-delà de 2 Mio, une photo n'entre pas (jamais retenue) : le magasin refuse
        let leve = null; try { m.deposer('p', 0, mk(2 * MIO + 1)); } catch (e) { leve = e.code || e.message; }
        H.vrai('7. une photo de plus de 2 Mio n\'entre pas dans le magasin', leve);
        H.v('7. TTL = 120 s, 8 photos, 8 Mio (valeurs du contrat)', [creerPhotosRecues.TTL_S, creerPhotosRecues.PHOTOS_MAX, creerPhotosRecues.OCTETS_MAX], [120, 8, 8 * MIO]);
        const ts = require('fs').readFileSync(require.resolve('../identifier/photos-recues.js'), 'utf8');
        H.vrai('7. le magasin ne touche ni la base, ni le disque, ni le réseau', !/require\('(fs|http|https|mongoose|\.\.\/db)'\)|col\(|writeFile/.test(ts));
    });

    // ═══ 8. POST /api/identifier : la validation de photoIds / photoId ═══
    await essayer('8', async () => {
        const nuls = async (nom, corps, det) => {
            const c0 = chaineAppels, mv = await db.col('mouvements').countDocuments({}), an = await db.col('analyses').countDocuments({});
            const r = await identifier(sv, USR, corps);
            H.v(`8. ${nom} : 400 ENTREE ${det}, la chaîne n'est pas appelée, rien débité ni écrit`, [r.statut, code(r), detail(r), chaineAppels - c0, (await db.col('mouvements').countDocuments({})) - mv, (await db.col('analyses').countDocuments({})) - an], [400, 'ENTREE', det, 0, 0, 0]);
        };
        const bon = 'b'.repeat(32);
        await nuls('photoId mal formé (trop court)', corpsId({ photoId: 'abc' }), 'photo-id');
        await nuls('photoId mal formé (majuscules)', corpsId({ photoId: 'B'.repeat(32) }), 'photo-id');
        await nuls('photoId mal formé (33 caractères)', corpsId({ photoId: 'b'.repeat(33) }), 'photo-id');
        await nuls('photoId qui n\'est pas une chaîne', corpsId({ photoId: 12 }), 'photo-id');
        await nuls('photoId null', corpsId({ photoId: null }), 'photo-id');
        await nuls('photoIds : un photoId mal formé', corpsId({ photoIds: [{ index: 0, photoId: 'zz' }] }), 'photo-id');
        await nuls('photoIds : photoId absent', corpsId({ photoIds: [{ index: 0 }] }), 'photo-id');
        await nuls('photoIds : pas un tableau', corpsId({ photoIds: 'x' }), 'photo-ids');
        await nuls('photoIds : un objet', corpsId({ photoIds: { index: 0, photoId: bon } }), 'photo-ids');
        await nuls('photoIds : un élément qui n\'est pas un objet', corpsId({ photoIds: [bon] }), 'photo-ids');
        await nuls('photoIds : une clé de plus dans un élément', corpsId({ photoIds: [{ index: 0, photoId: bon, x: 1 }] }), 'photo-ids');
        await nuls('photoIds : neuf entrées', corpsId({ photoIds: Array.from({ length: 9 }, (_, i) => ({ index: i, photoId: bon })) }, 9), 'photo-ids');
        await nuls('photoIds : deux entrées au même index', corpsId({ photoIds: [{ index: 0, photoId: bon }, { index: 0, photoId: 'c'.repeat(32) }] }), 'photo-ids');
        await nuls('photoIds : un index absent de imageUrls', corpsId({ photoIds: [{ index: 1, photoId: bon }] }, 1), 'photo-ids');
        await nuls('photoIds : un index négatif', corpsId({ photoIds: [{ index: -1, photoId: bon }] }), 'photo-ids');
        await nuls('photoIds : un index qui n\'est pas entier', corpsId({ photoIds: [{ index: 0.5, photoId: bon }] }), 'photo-ids');
        await nuls('photoIds : un index en chaîne', corpsId({ photoIds: [{ index: '0', photoId: bon }] }), 'photo-ids');
        await nuls('photoIds : index 8 (au-delà de 0..7) même si imageUrls en a 9', corpsId({ photoIds: [{ index: 8, photoId: bon }] }, 9), 'photo-ids');
        await nuls('photoId ET photoIds ensemble', corpsId({ photoId: bon, photoIds: [{ index: 0, photoId: 'c'.repeat(32) }] }), 'photo-ids');
        // le corps de /api/identifier garde sa limite de 100 ko : les octets ne passent JAMAIS par lui
        const gros = await fetch(url + '/api/identifier', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${USR.jeton}`, 'idempotency-key': `photos-${++nCle}-${Date.now()}-abcdefgh` }, body: JSON.stringify(corpsId({ title: 'a'.repeat(3 * MIO) })) });
        H.v('8. le corps de /api/identifier garde sa limite (3 Mio : 413)', gros.status, 413);
        // les entrées valides absentes du magasin : ignorées, sans erreur
        const c0 = chaineAppels;
        const ign = await identifier(sv, USR, corpsId({ photoIds: [{ index: 0, photoId: 'd'.repeat(32) }] }));
        H.v('8. un photoId bien formé mais inconnu : IGNORÉ, scan normal (200), la chaîne reçoit les URLs https', [ign.statut, ign.json && ign.json.success, chaineAppels - c0, vusParLaChaine[vusParLaChaine.length - 1].every(x => x.startsWith('https://'))], [200, true, 1, true]);
        const src = require('fs').readFileSync(require.resolve('../identifier/routes.js'), 'utf8').replace(/\/\/.*$/gm, '');
        H.vrai('8. la validation est pure et ne lit le magasin que pour les identifiants déjà jugés bien formés (le magasin est consulté après validerEntree)', /rattacherPhotos/.test(src));
    });

    // ═══ 9. le scan AVEC photos : les octets vont au modèle, JAMAIS une URL ; ZÉRO téléchargement ═══
    await essayer('9', async () => {
        // le cas TÉMOIN d'abord : sans photo reçue, le téléchargement de la photo du banc part bel et bien (l'instrument sait compter)
        tel = 0; const s0 = sorties.length, mv0 = await db.col('mouvements').countDocuments({});
        const T0 = await identifier(sv, ADM, corpsId());
        await jusque(() => tel > 0, 3000); await attendre(400);
        const deltaTemoin = (await db.col('mouvements').countDocuments({})) - mv0;      // ce qu'un scan d'administrateur écrit dans `mouvements` sans photo reçue (la ligne « administrateur », zéro crédit)
        H.v('9. TÉMOIN : sans photo reçue, l\'administrateur voit le repli télécharger la photo du banc (1 appel) et la chaîne reçoit l\'URL', [T0.statut, tel, vusParLaChaine[vusParLaChaine.length - 1]], [200, 1, [IMG(0)]]);
        // 3 photos, indices 0, 1 et 3 sur 4 URLs
        const avecExif = await sharp(await bruit(300, 420)).withMetadata({ exif: { IFD0: { Copyright: 'secret-copyright-a-retirer' } } }).jpeg().toBuffer();
        H.vrai('9. instrument : la photo de départ porte bien l\'EXIF', avecExif.includes(Buffer.from('secret-copyright-a-retirer')));
        const p0 = await poster(ADM, 0, avecExif), p1 = await poster(ADM, 1, await bruit(300, 420)), p3 = await poster(ADM, 3, await bruit(300, 420, 'x'));
        const ids = [p0, p1, p3].map(r => r.json.photoId);
        tel = 0; const s1 = sorties.length, mv = await db.col('mouvements').countDocuments({}), cles0 = mem.cles().length, j0 = journaux.length;
        const R = await identifier(sv, ADM, corpsId({ photoIds: [{ index: 3, photoId: ids[2] }, { index: 0, photoId: ids[0] }, { index: 1, photoId: ids[1] }] }, 4));
        const vue = vusParLaChaine[vusParLaChaine.length - 1];
        H.v('9. 200, et la chaîne reçoit 3 images en `data:` (dans l\'ordre des index), AUCUNE URL https', [R.statut, vue.length, vue.every(u => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(u))], [200, 3, true]);
        const octets = vue.map(dataVersOctets);
        const meta0 = await sharp(octets[0]).metadata();
        H.v('9. métadonnées retirées : ni EXIF dans l\'image transmise, ni le texte du copyright dans ses octets', [meta0.exif === undefined, octets[0].includes(Buffer.from('secret-copyright-a-retirer'))], [true, false]);
        await attendre(300);
        H.v('9. ZÉRO téléchargement : le téléchargeur de la photo du banc n\'est pas appelé', tel, 0);
        H.v('9. ZÉRO appel sortant (fetch, https) pendant tout le scan', sorties.slice(s1), []);
        // la photo d'index 0 devient la photo du banc de l'administrateur (phase 1)
        const okBanc = await jusque(async () => (await lireAn(R.json.scanId)).photoBanc);
        const an = await lireAn(R.json.scanId);
        H.v('9. l\'index 0 devient la photo du banc : photoBanc écrit (sha256), UN objet au bucket', [okBanc && /^[0-9a-f]{64}$/.test(an.photoBanc.sha256), mem.cles().length - cles0], [true, 1]);
        H.v('9. /api/photo ne débite rien, et /api/identifier facture comme aujourd\'hui : les mêmes lignes `mouvements` qu\'un scan sans photo', (await db.col('mouvements').countDocuments({})) - mv, deltaTemoin);        // un photoId SERT UNE FOIS
        const c0 = chaineAppels, deuxieme = await identifier(sv, ADM, corpsId({ photoIds: [{ index: 0, photoId: ids[0] }] }));
        H.v('9. le même photoId une seconde fois : ignoré (déjà servi) — la chaîne reçoit l\'URL https', [deuxieme.statut, chaineAppels - c0, vusParLaChaine[vusParLaChaine.length - 1]], [200, 1, [IMG(0)]]);
        await jusque(() => tel > 0, 3000); await attendre(500);      // ce scan-là n'a reçu aucune photo : le repli télécharge, en arrière-plan ; on le laisse finir avant de compter la suite
        // aucun octet ni journalisé ni écrit : ni la base, ni les journaux de la console
        const b64 = vue.map(u => u.split(',')[1]);
        let trouvees = []; for (const c of await mongoose.connection.db.listCollections().toArray()) { const t = JSON.stringify(await mongoose.connection.db.collection(c.name).find({}).toArray()); for (const [i, b] of b64.entries()) if (t.includes(b.slice(0, 120)) || t.includes(b.slice(-120))) trouvees.push(`${c.name}:${i}`); }
        H.v('9. aucun octet de photo dans AUCUNE collection de la base', trouvees, []);
        H.v('9. aucun octet de photo dans les journaux de la console', journaux.slice(j0).filter(l => b64.some(b => l.includes(b.slice(0, 60)))).length, 0);
        H.vrai('9. aucun journal du magasin ni de la route ne cite d\'URL ni d\'octets', !/console\.(log|warn|error)\([^)]*(octets|buffer|base64)/i.test(require('fs').readFileSync(require.resolve('../identifier/photos-recues.js'), 'utf8') + require('fs').readFileSync(require.resolve('../identifier/photo-avant-scan.js'), 'utf8')));
    });

    // ═══ 10. les trois écarts : seule l'index 3 reçue (pas d'index 0) ; l'ancien `photoId` seul vaut l'index 0 ; expiré ; d'un autre porteur ═══
    await essayer('10', async () => {
        // pas d'index 0 : la chaîne reçoit la photo reçue ; AUCUN téléchargement (la photo du banc est sautée aussi) ; pas de photo du banc
        const p3 = await poster(ADM2, 3);
        tel = 0; const s = sorties.length, c0 = mem.cles().length;
        const R = await identifier(sv, ADM2, corpsId({ photoIds: [{ index: 3, photoId: p3.json.photoId }] }, 4));
        await attendre(500);
        const vue = vusParLaChaine[vusParLaChaine.length - 1];
        H.v('10. seule l\'index 3 reçue : la chaîne reçoit UNE image en `data:` (pas les trois URLs https non reçues)', [R.statut, vue.length, /^data:image\/jpeg;base64,/.test(vue[0])], [200, 1, true]);
        H.v('10. et rien n\'est téléchargé : ni la photo du banc (index 0 non reçu), ni aucune image', [tel, sorties.slice(s), (await lireAn(R.json.scanId)).photoBanc === undefined, mem.cles().length - c0], [0, [], true, 0]);
        // l'ancien `photoId` seul : index 0
        const q0 = await poster(ADM2, 0);
        const R2 = await identifier(sv, ADM2, corpsId({ photoId: q0.json.photoId }));
        H.v('10. l\'ancien `photoId` seul vaut l\'index 0 : image en `data:`, photo du banc écrite', [R2.statut, vusParLaChaine[vusParLaChaine.length - 1].length, /^data:/.test(vusParLaChaine[vusParLaChaine.length - 1][0]), Boolean(await jusque(async () => (await lireAn(R2.json.scanId)).photoBanc))], [200, 1, true, true]);
        // d'un autre porteur : ignoré, et la photo de son porteur n'est PAS consommée par cette tentative
        const a = await poster(ADM3, 0);
        const volee = await identifier(sv, ADM4, corpsId({ photoIds: [{ index: 0, photoId: a.json.photoId }] }));
        H.v('10. le photoId d\'un AUTRE porteur : ignoré (la chaîne reçoit l\'URL https)', [volee.statut, vusParLaChaine[vusParLaChaine.length - 1]], [200, [IMG(0)]]);
        const sien = await identifier(sv, ADM3, corpsId({ photoIds: [{ index: 0, photoId: a.json.photoId }] }));
        H.v('10. … et son vrai porteur peut encore s\'en servir (non consommé par le voleur)', [sien.statut, /^data:/.test(vusParLaChaine[vusParLaChaine.length - 1][0])], [200, true]);
        // expiré : 120 s plus tard
        const e = await poster(ADM3, 0);
        horloge.t += 121e3;
        const exp = await identifier(sv, ADM3, corpsId({ photoIds: [{ index: 0, photoId: e.json.photoId }] }));
        H.v('10. un photoId expiré (121 s) : ignoré, scan normal, la chaîne reçoit l\'URL https', [exp.statut, vusParLaChaine[vusParLaChaine.length - 1]], [200, [IMG(0)]]);
        // un utilisateur NON administrateur qui présente un photoId qu'il ne peut pas avoir : ignoré (la route n'existe pas pour lui)
        const user = await identifier(sv, USR, corpsId({ photoIds: [{ index: 0, photoId: a.json.photoId }] }));
        H.v('10. un non-administrateur avec un photoId : ignoré, 200, URL https', [user.statut, vusParLaChaine[vusParLaChaine.length - 1]], [200, [IMG(0)]]);
    });

    // ═══ 11. 9 photos au niveau de la route : la plus ancienne est oubliée ═══
    await essayer('11', async () => {
        const D = await acteur({ role: 'administrateur' });
        const ids = []; for (let i = 0; i < 9; i++) ids.push((await poster(D, i % 8, await bruit(120, 160))).json.photoId);
        H.v('11. après 9 photos, la 1re est oubliée : retenues 8', stockPhotos.taille(D.porteur).photos, 8);
        const R = await identifier(sv, D, corpsId({ photoIds: ids.slice(1).map((photoId, k) => ({ index: (k + 1) % 8, photoId })) }, 8));
        const vue = vusParLaChaine[vusParLaChaine.length - 1];
        H.v('11. les 8 dernières servent (8 images en `data:`)', [R.statut, vue.length, vue.every(u => u.startsWith('data:'))], [200, 8, true]);
        const old = await identifier(sv, D, corpsId({ photoIds: [{ index: 0, photoId: ids[0] }] }));
        H.v('11. la première (oubliée) est ignorée sans erreur', [old.statut, vusParLaChaine[vusParLaChaine.length - 1]], [200, [IMG(0)]]);
    });

    // ═══ 12. CORS : la pré-requête de POST /api/photo (Content-Type et Authorization, origine de l'extension) ═══
    await essayer('12', async () => {
        const { middlewareV2 } = require('../transport/cors');
        const prefl = async cfg => { const app = express(); app.use(middlewareV2(cfg)); app.use((q, s) => s.status(404).end()); const srv = await H.serveur(app); try { const r = await fetch(srv.url + '/api/photo', { method: 'OPTIONS', headers: { origin: cfg.origines.extension, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, authorization' } }); return { statut: r.status, methodes: r.headers.get('access-control-allow-methods'), entetes: r.headers.get('access-control-allow-headers'), origine: r.headers.get('access-control-allow-origin') }; } finally { await srv.fermer(); } };
        const on = await prefl(cfgOn), off = await prefl(cfgOff);
        H.v('12. drapeau allumé : 204, POST, Authorization et Content-Type autorisés pour l\'origine exacte de l\'extension', [on.statut, /POST/.test(on.methodes), /Authorization/.test(on.entetes), /Content-Type/.test(on.entetes), on.origine], [204, true, true, true, cfgOn.origines.extension]);
        H.v('12. drapeau éteint : aucun en-tête CORS propre à v2 pour ce chemin (la route n\'existe pas)', [off.statut, off.origine], [404, null]);
        const { cheminV2 } = require('../transport/entetes');
        H.vrai('12. /api/photo reçoit les en-têtes de sécurité v2 (comme tout chemin v2), pour que le 404 natif d\'un non-administrateur ne se distingue pas', cheminV2('/api/photo'));
    });

    // ═══ 13. les chemins qui téléchargent : chacun est coupé quand une photo est reçue (preuve par le code) ═══
    await essayer('13', async () => {
        const lire = f => require('fs').readFileSync(require.resolve(f), 'utf8').replace(/\/\/.*$/gm, '');
        const routes = lire('../identifier/routes.js'), lot = lire('../identifier/lot.js'), crochet = lire('../banc/crochet.js'), admin = lire('../banc/photo-admin.js');
        H.vrai('13. routes.js : la chaîne héritée, le lot, la règle G et la seconde lecture reçoivent les images par `imagesDeLaChaine` / `imageOctets`, jamais `entree.imageUrls` brut', !/imageUrls: entree\.imageUrls/.test(routes) && /imagesDeLaChaine\(entree\)/.test(routes) && /entree\.imageOctets/.test(routes));
        H.vrai('13. lot.js : le lot reçoit les images par `imagesDeLaChaine`', !/imageUrls: entree\.imageUrls/.test(lot) && /imagesDeLaChaine/.test(lot));
        H.vrai('13. crochet.js : la détection reçoit les images par `imagesDeLaChaine`', !/req\.entree\.imageUrls/.test(crochet) && /imagesDeLaChaine/.test(crochet));
        H.vrai('13. photo-admin.js : le repli ne télécharge pas quand des photos sont reçues', /photosRecues/.test(admin));
        const { imagesDeLaChaine } = require('../identifier/photos-recues');
        H.v('13. imagesDeLaChaine : sans photo reçue, les URLs ; avec, des `data:` dans l\'ordre des index', [imagesDeLaChaine({ imageUrls: ['https://a'] }), imagesDeLaChaine({ imageUrls: ['https://a', 'https://b'], photosRecues: [{ index: 1, octets: Buffer.from('xy') }] })], [['https://a'], ['data:image/jpeg;base64,eHk=']]);
        // aucune des URLs transmises à la chaîne ne peut être téléchargée par le départage par l'image (liste blanche d'hôtes : un `data:` n'a pas d'hôte)
        const { HOTES_PHOTO_AUTORISES } = require('../../departage-image');
        const u = imagesDeLaChaine({ imageUrls: ['https://images1.vinted.net/a.jpeg'], photosRecues: [{ index: 0, octets: Buffer.from('xy') }] })[0];
        H.v('13. une image `data:` n\'a pas d\'hôte : le départage par l\'image (qui télécharge photos[0]) s\'abstient avant tout appel', [new URL(u).hostname, HOTES_PHOTO_AUTORISES.some(re => re.test(new URL(u).hostname))], ['', false]);
    });

    await sv.fermer(); await svOff.fermer(); await svPlafond.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exit(1); });
