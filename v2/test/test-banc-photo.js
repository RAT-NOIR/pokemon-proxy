'use strict';
// PHOTO-EXTENSION (recadrage) — POST /api/banc/photo : l'extension de l'administrateur envoie l'image qu'elle affiche, en octets bruts. Base EN MÉMOIRE, stockage MÉMOIRE, images SYNTHÉTIQUES (sharp, en mémoire),
// aucun réseau hors boucle locale, aucune requête vers Vinted. 🔑 La preuve d'un refus « avant la lecture » est un COMPTEUR D'OCTETS LUS : `socket.bytesRead` au moment où la réponse part.
const H = require('./_harnais');
const http = require('http');
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

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_PHOTO_ADMIN_INTERVALLE_S: '0', V2_PHOTO_ADMIN_MAX_JOUR: '100000', V2_PHOTO_ADMIN_DELAI_S: '0' });
const oid = () => new mongoose.Types.ObjectId();
const ENV = { V2_BANC_BUCKET: 'bucket-banc-test', V2_BANC_SEL: 'sel-photo-route' };
const MIO = 1024 * 1024;
const attendre = ms => new Promise(r => setTimeout(r, ms));
const jusque = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await attendre(20); } return false; };
const bruit = (w = 400, h = 560) => sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
const lus = new Map();
let nEssai = 0, nIp = 0;
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.code || e.message)), 'aucune'); } };

// client brut : `corps` (Buffer) ; `partiel` : n'écrit que ce nombre d'octets puis se tait (Content-Length annoncé = corps.length) ; `contentLength: null` : chunked
// TOUR 2 (I2) : une réponse DOIT partir. `fini` rend { statut: 'EXPIRE-sans-reponse' } et détruit la requête après `attente` ms (2,5 s pour un refus décidé sur les en-têtes) : un mutant qui lit le corps AVANT de
// répondre (R3, R14) fait donc échouer une ASSERTION et le banc se termine, au lieu de pendre jusqu'à l'expiration de la porte.
function envoyer(base, { chemin = '/api/banc/photo', query, jeton, type = 'image/jpeg', corps = Buffer.alloc(0), contentLength, partiel = null, attente = 8000 } = {}) {
    const essai = `e${++nEssai}`, url = new URL(base + chemin + (query === undefined ? '' : `?${query}`));
    const h = { 'x-essai': essai, 'x-forwarded-for': `10.20.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}` };
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

setTimeout(() => { console.error('❌ le banc a dépassé 170 s (une lecture ou un serveur est resté en suspens)'); process.exit(1); }, 170000).unref();
(async () => {
    await H.ouvrirBac('test-banc-photo.js'); await M.creerIndex();
    const mem = S.creerStockageMemoire();
    const stockage = { async verifierBucket() { }, ecrire: (c, b) => mem.ecrire(c, b), supprimer: c => mem.supprimer(c), lire: c => mem.lire(c), lister: () => mem.lister(), cles: () => mem.cles() };
    const banc = creerBanc({ cfg, env: ENV, stockage });
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
    const semer = async (a, o = {}) => {
        const _id = oid();
        const carte = { idProduct: 4242, statut: 'identifiee', raison: null, etat: { retenu: 'NM' }, question: null, zone: null, ...(o.attente ? { etiquetteAdmin: { verdict: 'juste', idProduct: 4242, rev: 1, le: new Date(), banc: 'en-attente', versionModele: 'x', versionChaine: 'abc123def456' } } : {}) };
        await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: 'identifiee', cartes: [carte], produits: [], facturation: { motif: 'administrateur' }, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), ...(o.attente ? { bancAttente: true } : {}), ...(o.photo ? { photoBanc: { cle: 'banc-reel/v2/' + 'a'.repeat(32) + '.webp', sha256: 'b'.repeat(64) } } : {}) });
        return String(_id);
    };
    const lire = id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });
    const ADM = await acteur({ role: 'administrateur' }), ADM2 = await acteur({ role: 'administrateur' }), ADM3 = await acteur({ role: 'administrateur' }), USR = await acteur({}), SEUL = await acteur({ lie: false });

    const pret = require('../pret'), { dansUnScan } = require('../../sources'), { assembler } = require('../index');
    let chaineAppels = 0, tel = 0;
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const chaine = async (req, res) => { chaineAppels++; res.json({ success: true, carte: { idProduct: 4242, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '58', total: '102', setCode: 'BS', rarete: null, langue: 'FR', ambigu: false }, etat: ETAT, candidats: [], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2, scanId: String(req.scanIdImpose) }); };
    for (const [id, nom] of [[4242, 'Pikachu']]) { await db.col('catalogue_produits').insertOne({ idProduct: id, name: nom, idMetacard: id }); await db.col('numeros_cartes').insertOne({ idProduct: id, slugSet: 'Base-Set', numero: String(id % 100) }); }
    const monter = async (reglage = { placesMax: 2, delaiLectureMs: 1200 }) => {
        const app = express(); app.set('trust proxy', true);
        app.use((q, s, n) => { const wh = s.writeHead; s.writeHead = function (...a) { lus.set(q.headers['x-essai'], q.socket.bytesRead); return wh.apply(this, a); }; n(); });
        app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
        app.use(assembler([require('../argent/monter'), require('../identifier/monter'), monterBanc], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), banc, purge: purgeStub, photoRoute: reglage, telechargerPhoto: async () => { tel++; return bruit(); } }));
        return H.serveur(app);
    };
    const sv = await monter(), url = sv.url;
    const jpg = await bruit();
    const pasLu = (c) => (c.lus() ?? 1e9) < 100 * 1024;
    const refus = async (nom, opts, statut, detail) => {
        const avant = mem.cles().length;
        const c = envoyer(url, { partiel: 16, corps: jpg, attente: 2500, ...opts }); const r = await c.fini;      // une réponse DOIT partir sans le corps
        H.v(`${nom} : ${statut}${detail ? ` (${detail})` : ''}, corps NON lu (moins de 100 ko lus sur ${Math.round((opts.contentLength ?? jpg.length) / 1024)} ko annoncés), rien conservé`, [r.statut, detail === undefined ? undefined : (r.json && r.json.erreur && r.json.erreur.detail), pasLu(c), mem.cles().length - avant], [statut, detail, true, 0]);
        return r;
    };

    // ═══ 1. l'ordre des gardes, tous AVANT la lecture ═══
    await essayer('1', async () => {
        const SA = await semer(ADM), q = `scanId=${SA}`;
        await refus('1. sans Authorization', { query: q }, 401);
        await refus('1. jeton inconnu', { query: q, jeton: J.genererJeton() }, 401);
        // le 404 natif pour tout autre porteur
        const brut = async (jeton, chemin) => { const x = await fetch(url + chemin, { method: 'POST', headers: { 'content-type': 'image/jpeg', authorization: `Bearer ${jeton}` }, body: jpg }); const texte = await x.text(); const h = Object.fromEntries(x.headers); delete h.date; delete h['content-length']; delete h.etag; return { statut: x.status, texte: texte.split(chemin.split('?')[0]).join('<CHEMIN>'), h }; };
        const vraie = await brut(USR.jeton, '/api/banc/route-inexistante');
        for (const [nom, a] of [['compte non administrateur', USR], ['installation seule', SEUL]]) H.v(`1. ${nom} : EXACTEMENT la réponse d'une route inexistante (404 natif, mêmes corps et en-têtes)`, await brut(a.jeton, `/api/banc/photo?scanId=${SA}`), vraie);
        H.vrai('1. instrument : la route inexistante rend bien un 404 non JSON qui cite le chemin', vraie.statut === 404 && vraie.texte.includes('<CHEMIN>'));
        await refus('1. non-administrateur : 404, corps non lu', { query: q, jeton: USR.jeton }, 404);
        // TOUR 2 (I1) : le refus d'un non-administrateur ne prend NI place NI mémoire et laisse Node vider le corps comme pour une route inexistante (aucun plafond d'octets maison : il était du code mort, Node ne
        // livre plus de `data` après `_dump()`). Preuve : trois non-administrateurs gardent leur corps incomplet ouvert, et les deux places (ici) restent libres pour un administrateur.
        {
            const ouverts = [USR, SEUL, USR].map(a => envoyer(url, { query: q, jeton: a.jeton, partiel: 16, corps: jpg, attente: 2500 }));
            const reps = await Promise.all(ouverts.map(o => o.fini));
            const SF = await semer(ADM);
            const adm = await envoyer(url, { query: `scanId=${SF}`, jeton: ADM.jeton, corps: jpg }).fini;
            H.v('1. TOUR 2 (I1) : trois refus de non-administrateurs corps ouverts => 404 natif chacun, et un administrateur passe aussitôt (aucune place prise)', [reps.map(r => r.statut), adm.statut], [[404, 404, 404], 200]);
            const src = require('fs').readFileSync(require.resolve('../banc/photo'), 'utf8');
            H.v('1. TOUR 2 (I1) : le code mort est retiré (aucun compteur « jeté », aucun plafond de 8 Mio, aucun minuteur de rejet)', [/jete\b|8 \* 1024 \* 1024/.test(src), /setTimeout\(arret/.test(src)], [false, false]);
        }
        await refus('1. scanId absent', { jeton: ADM.jeton }, 400, 'scan-id');
        await refus('1. scanId mal formé', { query: 'scanId=pas-un-id', jeton: ADM.jeton }, 400, 'scan-id');
        await refus('1. photo=1 (le banc ne garde que la première photo)', { query: `${q}&photo=1`, jeton: ADM.jeton }, 400, 'photo');
        await refus('1. paramètre inconnu', { query: `${q}&x=1`, jeton: ADM.jeton }, 400, 'champ-inconnu');
        // (`application/json` n'est pas dans la liste : l'analyseur JSON GLOBAL d'index.js lit ce type avant toute route — c'est l'ancienne limite de 100 ko, hors du sujet)
        for (const type of ['text/plain', 'image/gif', 'image/svg+xml', 'image/heic', null]) await refus(`1. Content-Type ${type}`, { query: q, jeton: ADM.jeton, type }, 415, 'type');
        await refus('1. sans Content-Length (chunked)', { query: q, jeton: ADM.jeton, contentLength: null }, 400, 'content-length');
        await refus('1. Content-Length 0', { query: q, jeton: ADM.jeton, contentLength: 0, corps: Buffer.alloc(0), partiel: null }, 400, 'content-length');
        await refus('1. Content-Length au-delà de 2 Mio', { query: q, jeton: ADM.jeton, contentLength: 2 * MIO + 1 }, 413, 'trop-lourde');
        await refus('1. scan d\'un AUTRE porteur', { query: `scanId=${await semer(ADM2)}`, jeton: ADM.jeton }, 404);
        await refus('1. scan inconnu', { query: `scanId=${oid()}`, jeton: ADM.jeton }, 404);
        const SD = await semer(ADM, { photo: true });
        const cd = envoyer(url, { query: `scanId=${SD}`, jeton: ADM.jeton, partiel: 16, corps: jpg }); const rd = await cd.fini;
        H.v('1. la photo existe déjà : 200 `deja` sans lire le corps', [rd.statut, rd.json && rd.json.etat, pasLu(cd)], [200, 'deja', true]);
    });

    // ═══ 2. un administrateur passe : conservée, sans téléchargement ═══
    await essayer('2', async () => {
        const SA = await semer(ADM); const avant = mem.cles().length; tel = 0;
        const c = envoyer(url, { query: `scanId=${SA}`, jeton: ADM.jeton, corps: jpg }); const r = await c.fini;
        const an = await lire(SA), m = an.photoBanc && await sharp(await mem.lire(an.photoBanc.cle)).metadata();
        H.v('2. administrateur, scan à lui, JPEG : 200 `ecrit`, corps lu en entier, un objet WebP sans EXIF ≤ 1600 px, sha256 sur l\'analyse, aucun téléchargement',
            [r.statut, r.json && r.json.etat, c.lus() > jpg.length, mem.cles().length - avant, m && m.format, m && m.exif === undefined, /^[0-9a-f]{64}$/.test(an.photoBanc && an.photoBanc.sha256), tel], [200, 'ecrit', true, 1, 'webp', true, true, 0]);
        const c2 = envoyer(url, { query: `scanId=${SA}&photo=0`, jeton: ADM.jeton, corps: jpg }); const r2 = await c2.fini;
        H.v('2. idempotence : la même photo pour le même scan => `deja`, rien de plus (un seul objet, la même clé)', [r2.statut, r2.json && r2.json.etat, mem.cles().length - avant, (await lire(SA)).photoBanc.cle === an.photoBanc.cle], [200, 'deja', 1, true]);
        // PNG et WebP
        for (const [nom, f] of [['PNG', 'png'], ['WebP', 'webp']]) {
            const S1 = await semer(ADM); const b = await sharp({ create: { width: 300, height: 420, channels: 3, background: { r: 9, g: 8, b: 7 } } })[f]().toBuffer();
            const rr = await envoyer(url, { query: `scanId=${S1}`, jeton: ADM.jeton, type: `image/${f}`, corps: b }).fini;
            H.v(`2. ${nom} accepté`, [rr.statut, rr.json && rr.json.etat], [200, 'ecrit']);
        }
        // une carte qui attendait sa photo : sa ligne du banc naît
        const SE = await semer(ADM, { attente: true });
        const re = await envoyer(url, { query: `scanId=${SE}`, jeton: ADM.jeton, corps: await bruit(300, 420) }).fini;
        const ane = await lire(SE), lignes = await db.col('banc_lignes').find({ cleR2: ane.photoBanc && ane.photoBanc.cle }).toArray();
        H.v('2. une carte `en-attente` de sa photo : la réponse dit `banc: ecrit`, la ligne du banc naît (source etiquette-admin), la marque d\'attente tombe', [re.statut, re.json && re.json.banc, lignes.length, lignes[0] && lignes[0].source, ane.bancAttente], [200, 'ecrit', 1, 'etiquette-admin', undefined]);
    });

    // ═══ 3. le contenu : validé par l'analyse d'image du scanner ═══
    await essayer('3', async () => {
        const essai = async (corps, type = 'image/jpeg') => { const S1 = await semer(ADM); const a = mem.cles().length; const r = await envoyer(url, { query: `scanId=${S1}`, jeton: ADM.jeton, type, corps }).fini; return [r.statut, r.json && r.json.erreur && r.json.erreur.detail, mem.cles().length - a, (await lire(S1)).photoBanc]; };
        const png = await sharp({ create: { width: 100, height: 100, channels: 3, background: '#123456' } }).png().toBuffer();
        H.v('3. octets au hasard annoncés JPEG : 415 (format)', (await essai(crypto.randomBytes(2000))).slice(0, 3), [415, 'type', 0]);
        H.v('3. un PNG annoncé `image/jpeg` : 415 (les octets doivent être ce que le Content-Type annonce)', (await essai(png)).slice(0, 3), [415, 'type', 0]);
        H.v('3. JPEG tronqué : 422 (illisible)', (await essai(jpg.subarray(0, jpg.length >> 2))).slice(0, 3), [422, 'illisible', 0]);
        const large = await sharp({ create: { width: 4097, height: 1, channels: 3, background: '#000' } }).png().toBuffer();
        H.v('3. côté de 4 097 px : 422 (dimensions)', (await essai(large, 'image/png')).slice(0, 3), [422, 'dimensions', 0]);
        const progressif = await sharp({ create: { width: 7000, height: 7000, channels: 3, background: { r: 3, g: 4, b: 5 } } }).jpeg({ progressive: true }).toBuffer();
        const r0 = process.memoryUsage().rss; const rp = await essai(progressif); const dr = (process.memoryUsage().rss - r0) / MIO;
        H.v('3. JPEG progressif de 49 Mpx : 422 (dimensions) sans décodage complet (mémoire du serveur de banc < 100 Mo de plus)', [rp.slice(0, 3), dr < 100], [[422, 'dimensions', 0], true]);
        const anime = await sharp(crypto.randomBytes(64 * 64 * 3 * 3), { raw: { width: 64, height: 192, channels: 3, pageHeight: 64 } }).webp({ loop: 0, delay: [100, 100, 100] }).toBuffer();
        H.v('3. WebP animé : 422 (illisible)', (await essai(anime, 'image/webp')).slice(0, 3), [422, 'illisible', 0]);
        const grosse = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#445566' } }).png().toBuffer();
        H.v('3. 4000 × 3000 (12 Mpx, une photo de téléphone) : accepté', (await essai(grosse, 'image/png'))[0], 200);
    });

    // ═══ 4. places de lecture : 2 au total ici, 1 par porteur ; délai de lecture ═══
    await essayer('4', async () => {
        const SA = await semer(ADM), SB = await semer(ADM2), SC = await semer(ADM3);
        const lent = (a, S1) => envoyer(url, { query: `scanId=${S1}`, jeton: a.jeton, corps: jpg, partiel: 100 });
        const A = lent(ADM, SA); await attendre(300);
        const A2 = await refus('4. le MÊME porteur, une deuxième lecture pendant la première', { query: `scanId=${await semer(ADM)}`, jeton: ADM.jeton }, 429, undefined);
        H.v('4. 429 `DEBIT` avec Retry-After', [A2.json && A2.json.erreur && A2.json.erreur.code, Boolean(A2.entetes['retry-after'])], ['DEBIT', true]);
        const B = lent(ADM2, SB); await attendre(300);
        await refus('4. plafond GLOBAL (2 ici) : un troisième porteur', { query: `scanId=${SC}`, jeton: ADM3.jeton }, 429, undefined);
        A.req.destroy(); B.req.destroy(); await attendre(400);
        const ok = await envoyer(url, { query: `scanId=${SA}`, jeton: ADM.jeton, corps: jpg }).fini;
        H.v('4. un client qui coupe libère sa place : la lecture suivante passe', ok.statut, 200);
        // délai : 500 ms ici
        const SD = await semer(ADM2); const t0 = Date.now();
        const L = lent(ADM2, SD); const coupee = await jusque(() => L.estFerme(), 3000);
        H.v('4. un client qui envoie 100 octets puis se tait : connexion COUPÉE par le serveur après le délai (1,2 s ici)', [coupee, Date.now() - t0 < 3000], [true, true]);
        const ok2 = await envoyer(url, { query: `scanId=${SD}`, jeton: ADM2.jeton, corps: jpg }).fini;
        H.v('4. et la place est rendue : le même porteur peut envoyer ensuite', ok2.statut, 200);
        H.v('4. le défaut de production est un délai fini (≤ 30 s) et 4 places', [require('../banc/photo').DELAI_LECTURE_MS <= 30000, require('../banc/photo').PLACES_MAX], [true, 4]);
    });

    // ═══ 5. trois décodages simultanés : un refusé ═══
    await essayer('5', async () => {
        const sv2 = await monter({ placesMax: 4, delaiLectureMs: 5000 });
        const grosse = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#445566' } }).png().toBuffer();
        const trio = [ADM, ADM2, ADM3]; const scans = []; for (const a of trio) scans.push(await semer(a));
        const rs = await Promise.all(trio.map((a, i) => envoyer(sv2.url, { query: `scanId=${scans[i]}`, jeton: a.jeton, type: 'image/png', corps: grosse }).fini));
        H.v('5. trois photos de 12 Mpx envoyées en même temps : au plus 2 décodages à la fois — le troisième reçoit 429 `DEBIT` (réessayer), jamais une attente', [rs.filter(r => r.statut === 200).length, rs.filter(r => r.statut === 429 && r.json.erreur.code === 'DEBIT').length], [2, 1]);
        await sv2.fermer();
    });

    // ═══ 6. POST /api/identifier garde ses 100 ko : aucun champ d'image, aucune grande limite ═══
    await essayer('6', async () => {
        const post = (corps) => fetch(url + '/api/identifier', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${ADM.jeton}`, 'idempotency-key': `photo-${nEssai++}-${Date.now()}-abc` }, body: JSON.stringify(corps) });
        const base = { contrat: 2, imageUrls: ['https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg'], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' };
        const a0 = chaineAppels;
        const gros = await post({ ...base, title: 'a'.repeat(3 * MIO) });
        H.v('6. POST /api/identifier avec un corps de 3 Mio : 413, la chaîne (le modèle) n\'est pas appelée', [gros.status, chaineAppels - a0], [413, 0]);
        const sansContrat = await post({ title: 'a'.repeat(3 * MIO), userId: 'x' });
        H.v('6. et sans `contrat: 2` (la route héritée) : 413 aussi', sansContrat.status, 413);
        const avecChamp = await post({ ...base, photoBase64: 'AAAA' });
        const j = await avecChamp.json();
        H.v('6. un champ `photoBase64` n\'existe plus : ignoré, le scan est servi comme avant et rien n\'est conservé de lui', [avecChamp.status, j.success, JSON.stringify(j).includes('AAAA'), JSON.stringify(await db.col('analyses').find({}).toArray()).includes('photoBase64')], [200, true, false, false]);
        const src = require('fs').readFileSync(require.resolve('../../index.js'), 'utf8');
        H.v('6. index.js : l\'analyseur JSON global est `express.json()` seul (aucun analyseur à grande limite)', [(src.match(/app\.use\(express\.json\(\)\)/g) || []).length, /corpsJson|corps-json/.test(src)], [1, false]);
    });

    await sv.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exit(1); });
