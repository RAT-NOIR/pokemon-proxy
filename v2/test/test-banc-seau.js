'use strict';
// BANC-200 — les SEAUX du banc (juge scellé, entraînement) : déclaration immuable + chaîne d'empreintes, photos conservées EN OCTETS au scan, vérité saisie À L'AVEUGLE (trace des candidats vus), export rejouable.
// Base EN MÉMOIRE, stockage MÉMOIRE, images SYNTHÉTIQUES (sharp), aucun réseau hors boucle locale, aucune requête vers Vinted ni Cardmarket.
const H = require('./_harnais');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const S = require('../banc/stockage');
const { creerCatalogue } = require('../identifier/catalogue');

const cfgOn = lireConfig({ MONGODB_BASE: 'test_scratch', V2_BANC_SEAU: '1' });
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch' });
const code = r => r.json && r.json.erreur && r.json.erreur.code;
const detail = r => r.json && r.json.erreur && r.json.erreur.detail;
const oid = () => new mongoose.Types.ObjectId();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const bruit = (w = 400, h = 560, q = 80) => sharp(crypto.randomBytes(w * h * 3), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toBuffer();
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };
// une image à 9 × 8 blocs de gris bien séparés : son dHash est stable (une re-photo plus petite, plus compressée, reste à quelques bits ; une autre image est à ~32)
const blocs = async (w = 400, h = 560) => {
    const niv = [];
    for (let i = 0; i < 72; i++) { let v; do { v = crypto.randomInt(0, 256); } while (i % 9 !== 0 && Math.abs(v - niv[i - 1]) < 40); niv.push(v); }
    const buf = Buffer.alloc(w * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = niv[Math.min(7, Math.floor(y * 8 / h)) * 9 + Math.min(8, Math.floor(x * 9 / w))]; const o = (y * w + x) * 3; buf[o] = c; buf[o + 1] = c; buf[o + 2] = c; }
    return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 85 }).toBuffer();
};

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { console.log(`   frontière de fenêtre (1 h) dans ${Math.round(reste / 1000)} s : attente`); await new Promise(r => setTimeout(r, reste + 2000)); } }

    // ── la configuration : le drapeau n'est allumé que par « 1 » exactement
    H.v('config : drapeau absent ⇒ éteint', cfgOff.bancSeau, false);
    H.v('config : V2_BANC_SEAU=1 ⇒ allumé', cfgOn.bancSeau, true);
    for (const autre of ['0', 'true', 'oui', ' 1', '2', '']) H.v(`config : V2_BANC_SEAU="${autre}" ⇒ éteint`, lireConfig({ MONGODB_BASE: 'test_scratch', V2_BANC_SEAU: autre }).bancSeau, false);

    await H.ouvrirBac('test-banc-seau.js'); await M.creerIndex();
    { let idx = []; try { idx = await db.col('banc_seaux').indexes(); } catch { /* collection absente */ }
      H.v('0. la migration creerIndex() ne crée AUCUN index des seaux (ils naissent à la première utilisation, derrière le drapeau)', idx.length, 0); }
    const { creerSeaux } = require('../banc/seau');
    const memoire = S.creerStockageMemoire(S.CLE_SEAU);
    let decalageMs = 0;
    const horloge = () => new Date(Date.now() + decalageMs);

    // catalogue réel de la base de banc : trois produits au même nom de carte, prix différents (le tri croissant se voit), un quatrième sans prix
    const reel = creerCatalogue({ cfg: cfgOn, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const semerProduit = async (idProduct, nom, slugSet, numero, trend) => {
        await db.col('catalogue_produits').insertOne({ idProduct, name: nom, idMetacard: idProduct });
        await db.col('numeros_cartes').insertOne({ idProduct, slugSet, slug: `${nom}-${idProduct}`, numero });
        if (trend !== null) await db.col('guide_prix').insertOne({ idProduct, trend, low: trend, avg7: trend, avg30: trend, guideDu: new Date() });
    };
    await semerProduit(2001, 'Pikachu', 'Base-Set', '58', 12.5);
    await semerProduit(2002, 'Pikachu', 'Jungle', '60', 3.2);
    await semerProduit(2003, 'Pikachu', 'Wizards-Black-Star-Promos', '1', 40);
    await semerProduit(2004, 'Pikachu', 'Sans-Prix', '9', null);
    await semerProduit(2005, 'Raichu', 'Base-Set', '14', 8);

    const ancres = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-ancres-'));       // le dossier d'ancres du banc est un dossier TEMPORAIRE : le banc n'écrit jamais dans le dépôt
    const seaux = creerSeaux({ cfg: cfgOn, stockage: memoire, horloge, catalogue: reel, ancresDir: ancres });
    const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
    const monter = async (cfg, plus = {}) => {
        const app = express(); app.use(express.json());
        const router = express.Router();
        monterBanc.routes(router, cfg, { banc: {}, purge: purgeStub, seaux, ...plus });
        app.use(router);
        return H.serveur(app);
    };
    const sv = await monter(cfgOn), svOff = await monter(cfgOff);

    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null, lie = true } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), ...(lie ? { compteId: c._id, generation: 0 } : {}) });
        return { c, jeton, porteur: `compte:${c._id}` };
    }
    const ADM = await acteur({ role: 'administrateur' }), ADM2 = await acteur({ role: 'administrateur' }), USR = await acteur({});
    const SEUL = await (async () => { const jeton = J.genererJeton(); await db.col('installations').insertOne(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'seule' })); return { jeton }; })();
    const auth = a => (a ? { authorization: `Bearer ${a.jeton}` } : {});
    const post = (s, a, chemin, corps) => H.appel(s.url, chemin, { methode: 'POST', corps, entetes: auth(a) });
    const get = (s, a, chemin) => H.appel(s.url, chemin, { entetes: auth(a) });
    // un envoi d'octets bruts (la photo) : renvoie { statut, json, texte, octets }
    const envoyer = async (s, a, chemin, corps, type = 'image/jpeg') => {
        const r = await fetch(s.url + chemin, { method: 'POST', headers: { 'content-type': type, ...auth(a) }, body: corps });
        const texte = await r.text(); let json = null; try { json = JSON.parse(texte); } catch { /* non JSON */ }
        return { statut: r.status, json, texte };
    };
    const semerScan = async (a, o = {}) => {
        const _id = oid();
        const carte = { idProduct: 2001, statut: 'identifiee', raison: null, etat: { retenu: 'NM' }, question: { code: 'q', choix: [{ idProduct: 2001 }, { idProduct: 2002 }, { idProduct: 2003 }] }, zone: null };
        await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: 'identifiee', cartes: o.cartes || [carte], produits: [], facturation: { motif: 'administrateur' }, versionChaine: 'abc123def456', versionModele: 'modele-x', creeLe: o.creeLe || new Date(), expireLe: new Date(Date.now() + 864e5) });
        return String(_id);
    };

    // ══ 1. l'accès : l'administrateur seul ; tout le reste reçoit le 404 natif d'une route qui n'existe pas
    await essayer('accès', async () => {
        const ROUTES = [['POST', '/api/banc/seau/declarer', { nom: 'x', type: 'entrainement' }], ['GET', '/api/banc/seau/courant'], ['POST', '/api/banc/seau/sceller', { seauId: 'a'.repeat(16) }],
            ['GET', '/api/banc/seau/a-etiqueter'], ['POST', '/api/banc/seau/candidats', { scanId: 'a'.repeat(24) }], ['POST', '/api/banc/seau/verite', { scanId: 'a'.repeat(24) }], ['GET', '/api/banc/seau/verifier']];
        for (const [m, c, corps] of ROUTES) {
            const natif = (await get(sv, ADM, '/api/banc/route-qui-nexiste-pas')).statut;
            for (const [nom, a] of [['simple utilisateur', USR], ['installation seule', SEUL]]) {
                const r = m === 'GET' ? await get(sv, a, c) : await post(sv, a, c, corps);
                H.v(`1. ${m} ${c} ${nom} : 404 natif`, [r.statut, r.json && r.json.success], [natif, undefined]);
            }
            H.v(`1. ${m} ${c} sans jeton : 401 JETON (comme le reste du banc)`, (m === 'GET' ? await get(sv, null, c) : await post(sv, null, c, corps)).statut, 401);
            const off = m === 'GET' ? await get(svOff, ADM, c) : await post(svOff, ADM, c, corps);
            H.v(`1. ${m} ${c} drapeau éteint (même l'administrateur) : 404 natif`, off.statut, natif);
        }
        for (const [nom, a, attendu] of [['simple utilisateur', USR, 404], ['sans jeton', null, 401]]) {
            const r = await envoyer(sv, a, `/api/banc/seau/photo?scanId=${'a'.repeat(24)}&photo=0&seau=${'a'.repeat(16)}`, await bruit());
            H.v(`1. POST photo ${nom} : ${attendu}`, [r.statut], [attendu]);
        }
    });

    // ══ 2. la déclaration : immuable, une seule ouverte, un seul juge
    let juge, entr;
    await essayer('déclaration', async () => {
        let r = await get(sv, ADM, '/api/banc/seau/courant');
        H.v('2. aucun seau : courant rend seau null', [r.statut, r.json.seau], [200, null]);
        const { cibleParDefaut } = require('../banc/seau');
        H.v('2. cible par défaut : 200 pour le juge', cibleParDefaut('juge'), 200);
        r = await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'juge-200', type: 'juge', cible: 4 });       // le banc joue un juge de 4 annonces (la cible est déclarée, 200 par défaut)
        H.v('2. déclarer le juge (cible déclarée : 4) : 201', [r.statut, r.json && r.json.seau && r.json.seau.type, r.json.seau.cible, r.json.seau.etat], [201, 'juge', 4, 'ouvert']);
        juge = r.json.seau;
        H.v('2. empreinte de 64 hexadécimaux, horodatage, identifiant de 16 hexadécimaux', [/^[0-9a-f]{64}$/.test(juge.empreinte), !Number.isNaN(Date.parse(juge.declareLe)), /^[0-9a-f]{16}$/.test(juge.id)], [true, true, true]);
        H.v('2. un second seau pendant que le juge est ouvert : 409', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'autre', type: 'entrainement' })).statut, 409);
        H.v('2. un nom invalide : 400', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'a b!', type: 'entrainement' })).statut, 400);
        H.v('2. un type inconnu : 400', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'zz', type: 'test' })).statut, 400);
        H.v('2. un champ inconnu : 400', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'zz', type: 'entrainement', etat: 'scelle' })).statut, 400);
        H.v('2. une cible hors 1..500 : 400', [(await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'zz', type: 'juge', cible: 501 })).statut, (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'zz', type: 'juge', cible: 0 })).statut], [400, 400]);
        r = await get(sv, ADM, '/api/banc/seau/courant');
        H.v('2. courant rend le juge ouvert', [r.json.seau.id, r.json.seau.n], [juge.id, 0]);
        // la déclaration ne se modifie pas : aucune route de mise à jour n'existe
        for (const m of ['PUT', 'PATCH', 'DELETE']) {
            const x = await fetch(sv.url + '/api/banc/seau/declarer', { method: m, headers: { 'content-type': 'application/json', ...auth(ADM) }, body: '{}' });
            H.v(`2. ${m} sur la déclaration : 404`, x.status, 404);
        }
    });

    // ══ 3. les photos : EN OCTETS, au scan, avec leur sha256 ; le seau en cours est posé par l'outil
    const photos = { a: await blocs(), b: await bruit(300, 420, 70), c: await bruit(500, 700, 90) };
    const scans = [];
    await essayer('photos', async () => {
        const scan1 = await semerScan(ADM); scans.push(scan1);
        // dans un JUGE, l'empreinte d'annonce est OBLIGATOIRE : le banc en fournit une par scan, sauf quand le cas la précise
        const url = (s, i, extra = '') => `/api/banc/seau/photo?scanId=${s}&photo=${i}&seau=${juge.id}${extra.includes('annonce=') ? extra : `&annonce=${sha(s)}${extra}`}`;
        let r = await envoyer(sv, ADM, url(scan1, 0), photos.a);
        H.v('3. photo 0 : 200 ecrit, rang 1, seau du juge', [r.statut, r.json && r.json.etat, r.json.rang, r.json.seauId], [200, 'ecrit', 1, juge.id]);
        r = await envoyer(sv, ADM, url(scan1, 0), photos.a);
        H.v('3. la même photo, même index : deja (rien de plus)', [r.statut, r.json.etat, r.json.rang], [200, 'deja', 1]);
        r = await envoyer(sv, ADM, url(scan1, 0), photos.b);
        H.v('3. une AUTRE photo au même index : 409 (jamais écrasée)', [r.statut, detail(r)], [409, 'photo-differente']);
        r = await envoyer(sv, ADM, url(scan1, 1), photos.b); const r2 = await envoyer(sv, ADM, url(scan1, 2), photos.c);
        H.v('3. photos 1 et 2 du même scan : ecrit, même rang', [r.json.etat, r2.json.etat, r.json.rang, r2.json.rang], ['ecrit', 'ecrit', 1, 1]);
        // les octets conservés sont les octets REÇUS, avec leur sha256
        const docs = await db.col('banc_seau_photos').find({ scanId: scan1 }).sort({ index: 1 }).toArray();
        H.v('3. trois photos en base, index 0, 1, 2', docs.map(d => d.index), [0, 1, 2]);
        H.v('3. le sha256 de chaque photo est celui des octets reçus', docs.map(d => d.sha256), [sha(photos.a), sha(photos.b), sha(photos.c)]);
        const relu = await memoire.lire(docs[0].cle);
        H.v('3. l\'objet du bucket est identique octet pour octet (pas de réencodage)', [Buffer.compare(relu, photos.a) === 0, docs[0].octets, docs[0].type], [true, photos.a.length, 'image/jpeg']);
        H.v('3. la clé est adressée par le contenu et sous le préfixe banc-seau/', docs[0].cle, `banc-seau/${juge.id}/${sha(photos.a)}.jpg`);
        // la ligne scannée porte le seau EN COURS, posé à ce moment
        const ligne = await db.col('banc_seau_scans').findOne({ scanId: scan1 });
        H.v('3. la ligne porte seauId, rang, posteLe, scanCreeLe et une empreinte', [ligne.seauId, ligne.rang, ligne.posteLe instanceof Date, ligne.scanCreeLe instanceof Date, /^[0-9a-f]{64}$/.test(ligne.empreinte)], [juge.id, 1, true, true, true]);
        H.v('3. la photo porte son dHash (16 hexadécimaux) pour repérer une re-photo', /^[0-9a-f]{16}$/.test(docs[0].dhash), true);
        // les refus
        const scan2 = await semerScan(ADM); scans.push(scan2);
        const sansAnnonce = await envoyer(sv, ADM, `/api/banc/seau/photo?scanId=${scan2}&photo=0&seau=${juge.id}`, photos.a);
        H.v('3. 🔑 dans un juge, un scan SANS empreinte d\'annonce est refusé (400 annonce-obligatoire) et ne prend aucun rang', [sansAnnonce.statut, detail(sansAnnonce), await db.col('banc_seau_scans').countDocuments({ scanId: scan2 })], [400, 'annonce-obligatoire', 0]);
        H.v('3. un autre seau que celui en cours : 409 seau-change', detail(await envoyer(sv, ADM, `/api/banc/seau/photo?scanId=${scan2}&photo=0&seau=${'f'.repeat(16)}`, photos.a)), 'seau-change');
        H.v('3. sans paramètre seau : 400 (l\'extension DIT quel seau elle croit en cours)', (await envoyer(sv, ADM, `/api/banc/seau/photo?scanId=${scan2}&photo=0`, photos.a)).statut, 400);
        H.v('3. un scan inconnu : 404', (await envoyer(sv, ADM, url(String(oid()), 0), photos.a)).statut, 404);
        const autre = await semerScan(ADM2);
        H.v('3. le scan d\'un AUTRE administrateur : 404 (indiscernable d\'inconnu)', (await envoyer(sv, ADM, url(autre, 0), photos.a)).statut, 404);
        H.v('3. un index 8 : 400', (await envoyer(sv, ADM, url(scan2, 8), photos.a)).statut, 400);
        H.v('3. un type non pris en charge : 415', (await envoyer(sv, ADM, url(scan2, 0), photos.a, 'image/gif')).statut, 415);
        H.v('3. des octets qui ne sont pas une image : 415 (le format se juge sur les OCTETS)', (await envoyer(sv, ADM, url(scan2, 0), Buffer.from('pas une image du tout'))).statut, 415);
        const vieux = await semerScan(ADM, { creeLe: new Date(Date.now() - 3600e3) });
        H.v('3. un scan né AVANT la déclaration du seau : 409 scan-avant-seau', detail(await envoyer(sv, ADM, url(vieux, 0), photos.a)), 'scan-avant-seau');
        decalageMs = 20 * 60e3;
        const perime = await semerScan(ADM, { creeLe: new Date() });
        H.v('3. un scan vieux de plus de 15 minutes : 409 scan-perime (jamais rattaché après coup)', detail(await envoyer(sv, ADM, url(perime, 0), photos.a)), 'scan-perime');
        H.v('3. mais les photos manquantes d\'un scan DÉJÀ rangé passent encore', (await envoyer(sv, ADM, url(scan1, 3), photos.c)).json.etat, 'ecrit');
        decalageMs = 0;
        H.v('3. le scan 2 reçoit enfin sa photo : rang 2', (await envoyer(sv, ADM, url(scan2, 0), photos.c)).json.rang, 2);
        H.v('3. 🔑 sceller un juge SOUS sa cible (2 sur 4) : 409 sous-cible', detail(await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id })), 'sous-cible');
        // l'annonce : une empreinte (jamais l'adresse) pour repérer un doublon
        const an = 'e'.repeat(64);
        const d1 = await semerScan(ADM), d2 = await semerScan(ADM);
        await envoyer(sv, ADM, url(d1, 0, `&annonce=${an}`), photos.a); r = await envoyer(sv, ADM, url(d2, 0, `&annonce=${an}`), photos.b);
        const l2 = await db.col('banc_seau_scans').findOne({ scanId: d2 });
        H.v('3. la même annonce scannée deux fois : la seconde est marquée doublon de la première (§5)', [l2.doublonDe, l2.rang], [d1, 4]);
        H.v('3. une empreinte d\'annonce mal formée : 400', (await envoyer(sv, ADM, url(await semerScan(ADM), 0, '&annonce=https://www.vinted.fr/items/1'), photos.a)).statut, 400);
        scans.push(d1, d2);
        r = await envoyer(sv, ADM, `/api/banc/seau/mesures?scanId=${scan1}&seau=${juge.id}`, Buffer.from(JSON.stringify({ version: 'm1', empreinte: [0.1, 0.2], orb: { n: 12 } })), 'application/octet-stream');
        H.v('3. les mesures du client : conservées (bucket, sha256)', [r.statut, r.json && r.json.etat], [200, 'ecrit']);
        const dm = await db.col('banc_seau_mesures').findOne({ scanId: scan1 });
        H.v('3. leur document nomme la clé .json et le sha256 des octets', [dm && /\.json$/.test(dm.cle), dm && dm.sha256 === sha(Buffer.from(JSON.stringify({ version: 'm1', empreinte: [0.1, 0.2], orb: { n: 12 } })))], [true, true]);
        H.v('3. des mesures qui ne sont pas du JSON : 422', (await envoyer(sv, ADM, `/api/banc/seau/mesures?scanId=${scan1}&seau=${juge.id}`, Buffer.from('{pas du json'), 'application/octet-stream')).statut, 422);
    });

    // ══ 4. la saisie À L'AVEUGLE
    await essayer('aveugle', async () => {
        const s1 = scans[0];
        let r = await get(sv, ADM, `/api/banc/seau/a-etiqueter?seau=${juge.id}`);
        H.v('4. la liste à étiqueter : dans l\'ordre du scan, avec le nombre de photos, SANS aucun candidat', [r.statut, r.json.scans.map(x => x.rang), r.json.scans[0].photos, r.json.prochain], [200, [1, 2, 3, 4], 4, s1]);
        const cles = Object.keys(r.json.scans[0]).sort();
        H.v('4. les champs de la liste : seulement scanId, rang, photos, cartes, etiquetees', cles, ['cartes', 'etiquetees', 'photos', 'rang', 'scanId']);
        const brut = await fetch(sv.url + `/api/banc/seau/photo?scanId=${s1}&photo=1`, { headers: auth(ADM) });
        const oc = Buffer.from(await brut.arrayBuffer());
        H.v('4. la photo se relit (octets identiques, type d\'origine)', [brut.status, brut.headers.get('content-type'), Buffer.compare(oc, photos.b) === 0], [200, 'image/jpeg', true]);
        H.v('4. une photo absente : 404', (await get(sv, ADM, `/api/banc/seau/photo?scanId=${s1}&photo=7`)).statut, 404);
        H.v('4. la photo d\'un autre administrateur : 404', (await fetch(sv.url + `/api/banc/seau/photo?scanId=${s1}&photo=1`, { headers: auth(ADM2) })).status, 404);
        // JUGE EN UN CLIC, tour 1 : le filtre par porteur est une GARDE (isolation des comptes, testée ci-dessus) — on ne l'affaiblit pas ; la liste DIT seulement COMBIEN de scans du seau sont d'un autre compte, sans rien révéler d'autre
        const autres = await get(sv, ADM2, `/api/banc/seau/a-etiqueter?seau=${juge.id}`);
        H.v('4. 🔑 un AUTRE administrateur ne voit aucun scan (garde intacte) mais sait COMBIEN sont d\'un autre compte (4)', [autres.statut, autres.json.scans, autres.json.prochain, autres.json.autresComptes], [200, [], null, 4]);
        H.v('4. ce compte compté ne révèle ni identifiant de scan, ni porteur, ni rang', [autres.texte.includes(s1), autres.texte.includes('compte:'), autres.texte.includes(ADM.porteur)], [false, false, false]);
        H.v('4. le porteur de la liste a 0 scan d\'un autre compte, et la réponse décrit le seau (état, n, cible)', [r.json.autresComptes, r.json.seau && r.json.seau.etat, r.json.seau && r.json.seau.n, r.json.seau && r.json.seau.cible, r.json.seau && r.json.seau.nom], [0, 'ouvert', 4, 4, 'juge-200']);

        // 4a. une vérité par idProduct nu, SANS avoir vu les candidats
        r = await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2005, via: 'idProduct' });
        H.v('4. vérité par idProduct, candidats jamais ouverts : écrite, candidatsVus faux, rev 1', [r.statut, r.json.candidatsVus, r.json.rev], [200, false, 1]);
        let v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('4. le document : seauId du scan, via, idProduct, saisieLe', [v.seauId, v.via, v.idProduct, v.saisieLe instanceof Date], [juge.id, 'idProduct', 2005, true]);
        H.v('4. aucune vue enregistrée', await db.col('banc_seau_vues').countDocuments({ scanId: s1 }), 0);
        // 4b. un champ « candidatsVus » envoyé par le client est refusé : seul le serveur le sait
        H.v('4. `candidatsVus` dans le corps : 400 (le client ne déclare pas ce qu\'il a vu)', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2005, via: 'idProduct', candidatsVus: false })).statut, 400);
        // 4c. choisir « dans les candidats » sans les avoir demandés
        H.v('4. via candidat sans avoir demandé les candidats : 409 candidat-non-vu', detail(await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2002, via: 'candidat' })), 'candidat-non-vu');
        // 4d. les candidats : à la demande, triés par prix croissant, vue enregistrée
        r = await post(sv, ADM, '/api/banc/seau/candidats', { scanId: s1 });
        H.v('4. candidats : triés par prix croissant, prix inconnu en dernier', [r.statut, r.json.candidats.map(c => c.idProduct)], [200, [2002, 2001, 2003]]);
        H.v('4. chaque candidat : nom, set, numéro, prix', Object.keys(r.json.candidats[0]).sort(), ['idProduct', 'nom', 'numero', 'prix', 'set', 'version', 'visuel']);
        H.v('4. aucun indice de la réponse de la chaîne (ni statut, ni rang, ni « affirmé »)', JSON.stringify(r.json).includes('identifiee') || JSON.stringify(r.json).includes('statut'), false);
        H.v('4. la vue est ENREGISTRÉE (scan, carte, identifiants montrés)', await db.col('banc_seau_vues').countDocuments({ scanId: s1, carte: 0 }), 1);
        // 4e. la confirmation d'un clic : via candidat, id vu
        r = await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2002, via: 'candidat' });
        H.v('4. via candidat (vu) : écrite, rev 2, candidatsVus VRAI (calculé par le serveur)', [r.statut, r.json.rev, r.json.candidatsVus], [200, 2, true]);
        v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('4. l\'historique garde la première saisie', [v.idProduct, v.historique.length, v.historique[0].idProduct, v.historique[0].candidatsVus], [2002, 1, 2005, false]);
        H.v('4. un candidat qui n\'a PAS été montré : 409', detail(await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2005, via: 'candidat' })), 'candidat-non-vu');
        // 4e bis. « la photo suffit-elle à un expert ? » : booléen enregistré AVEC la vérité, modifiable, jamais renvoyé comme un indice
        H.v('4. photoSuffisante qui n\'est pas un booléen : 400', detail(await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2002, via: 'idProduct', photoSuffisante: 'oui' })), 'photo-suffisante');
        v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('4. une saisie sans la réponse la laisse nulle (rev 2 inchangée par le refus)', [v.rev, v.photoSuffisante ?? null], [2, null]);
        r = await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2002, via: 'idProduct', photoSuffisante: true });
        v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('4. photoSuffisante vrai : écrite avec la vérité (même document)', [r.statut, v.rev, v.photoSuffisante], [200, 3, true]);
        await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2002, via: 'idProduct', photoSuffisante: false });
        v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('4. modifiable : faux remplace vrai, et l\'historique garde vrai', [v.photoSuffisante, v.historique[v.historique.length - 1].photoSuffisante], [false, true]);
        await post(sv, ADM, '/api/banc/seau/verite', { scanId: s1, idProduct: 2002, via: 'idProduct' });
        v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 });
        H.v('4. une re-saisie sans le champ ne l\'efface pas', v.photoSuffisante, false);
        // 4f. les refus
        H.v('4. un idProduct inconnu du catalogue : 422', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[1], idProduct: 999999, via: 'idProduct' })).statut, 422);
        H.v('4. idProduct ET aucune : 400', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[1], idProduct: 2001, aucune: 'pas-une-carte', via: 'idProduct' })).statut, 400);
        H.v('4. via inconnu : 400', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[1], idProduct: 2001, via: 'devine' })).statut, 400);
        H.v('4. un scan qui n\'est dans aucun seau : 404', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: await semerScan(ADM), idProduct: 2001, via: 'idProduct' })).statut, 404);
        H.v('4. une carte hors du scan : 404', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[1], carte: 3, idProduct: 2001, via: 'idProduct' })).statut, 404);
        H.v('4. `aucune` valide : écrite', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[1], aucune: 'hors-catalogue', via: 'idProduct' })).statut, 200);
        H.v('4. `aucune` hors liste : 400', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[1], aucune: 'peut-etre', via: 'idProduct' })).statut, 400);
        r = await get(sv, ADM, `/api/banc/seau/a-etiqueter?seau=${juge.id}`);
        H.v('4. après deux vérités, le prochain est le troisième scan', [r.json.scans[0].etiquetees, r.json.prochain], [1, scans[2]]);
        // la vérité n'est jamais rattachée à une ligne scannée APRÈS elle (§14) : la saisie vit sur la ligne, sa date est postérieure au scan
        v = await db.col('banc_seau_verites').findOne({ scanId: s1, carte: 0 }); const ln = await db.col('banc_seau_scans').findOne({ scanId: s1 });
        H.v('4. §14 : la saisie est postérieure à la ligne du scan', v.saisieLe >= ln.posteLe, true);
        // le scellé du juge exige TOUT étiqueté : deux scans n'ont pas encore de vérité
        H.v('4. 🔑 sceller un juge dont des vérités manquent : 409 verites-incompletes', detail(await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id })), 'verites-incompletes');
        for (const s of [scans[2], scans[3]]) await post(sv, ADM, '/api/banc/seau/verite', { scanId: s, idProduct: 2001, via: 'idProduct' });
        H.v('4. tout est étiqueté : plus de prochain', (await get(sv, ADM, `/api/banc/seau/a-etiqueter?seau=${juge.id}`)).json.prochain, null);
        // une ligne sans photo (l'objet n'a pas pu s'écrire) ne se scelle pas, et sort de l'export
        const sauve = await db.col('banc_seau_photos').find({ scanId: scans[3] }).toArray();
        await db.col('banc_seau_photos').deleteMany({ scanId: scans[3] });
        H.v('4. 🔑 sceller avec une ligne SANS photo : 409 ligne-sans-photo', detail(await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id })), 'ligne-sans-photo');
        await db.col('banc_seau_photos').insertMany(sauve);
    });

    // ══ 5. la chaîne d'empreintes, et le scellé
    let chaine1;
    await essayer('scellé', async () => {
        let r = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. la chaîne du juge ouvert se vérifie : ok, 4 lignes (0 manquante), 0 erratum', [r.statut, r.json.ok, r.json.lignes, r.json.problemes, r.json.errata], [200, true, 4, [], 0]);
        chaine1 = r.json.tete;
        H.v('5. sceller sans seauId : 400', (await post(sv, ADM, '/api/banc/seau/sceller', {})).statut, 400);
        H.v('5. sceller un seau inconnu : 404', (await post(sv, ADM, '/api/banc/seau/sceller', { seauId: 'a'.repeat(16) })).statut, 404);
        r = await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id });
        H.v('5. sceller le juge : etat scelle, n 4, tête = dernière empreinte, empreinte du scellé', [r.statut, r.json.seau.etat, r.json.seau.n, r.json.seau.tete, /^[0-9a-f]{64}$/.test(r.json.seau.empreinteScellee), !!r.json.seau.photosEmpreinte], [200, 'scelle', 4, chaine1, true, true]);
        H.v('5. sceller deux fois : 409 (une transition, une seule)', detail(await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id })), 'deja-scelle');
        const scelle = await db.col('banc_seaux').findOne({ _id: juge.id });
        H.v('5. la déclaration est intacte après le scellé', [scelle.nom, scelle.type, scelle.cible, scelle.empreinte], [juge.nom, 'juge', 4, juge.empreinte]);
        H.v('5. le scellé porte l\'empreinte des vérités', /^[0-9a-f]{64}$/.test(scelle.veritesEmpreinte), true);
        H.v('5. la réponse du scellé RENDT la tête de chaîne (à ancrer)', [r.json.seau.tete === scelle.tete, r.json.seau.empreinteScellee === scelle.empreinteScellee], [true, true]);
        const { ecrireAncre } = require('../mesures/ancrer-seau');
        const nonAncre0 = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. 🔑 un JUGE scellé NON ancré : verifier rend ok FALSE, ancre « non-ancre », cause « non-ancre »', [nonAncre0.json.ok, nonAncre0.json.ancre, nonAncre0.json.problemes.some(p => p.cause === 'non-ancre')], [false, 'non-ancre', true]);
        const ancreEcrite = await ecrireAncre({ seauId: juge.id, colFn: n => db.col(n), dossier: ancres });
        H.v('5. l\'outil écrit l\'ancre (tête de la chaîne principale ET des errata) dans le dossier donné', [fs.existsSync(path.join(ancres, `${juge.id}.json`)), ancreEcrite.tete === scelle.tete, ancreEcrite.errata, ancreEcrite.erratumTete], [true, true, 0, null]);
        H.v('5. avec l\'ancre : ok TRUE, ancre « ok »', ((x) => [x.json.ok, x.json.ancre])(await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`)), [true, 'ok']);
        const p = await envoyer(sv, ADM, `/api/banc/seau/photo?scanId=${await semerScan(ADM)}&photo=0&seau=${juge.id}`, photos.a);
        H.v('5. une photo vers le juge scellé : 409 (aucun seau ouvert)', [p.statut], [409]);
        // 🔑 les vérités du juge scellé ne se réécrivent plus : une erreur humaine s'ajoute en ERRATUM
        const refusee = await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[2], idProduct: 2003, via: 'idProduct' });
        H.v('5. 🔑 une vérité sur un juge scellé : 409 juge-scelle, rien d\'écrit', [refusee.statut, detail(refusee), (await db.col('banc_seau_verites').findOne({ scanId: scans[2] })).idProduct], [409, 'juge-scelle', 2001]);
        const errUrl = '/api/banc/seau/erratum';
        H.v('5. un erratum sans motif : 400', (await post(sv, ADM, errUrl, { scanId: scans[2], idProduct: 2003, via: 'idProduct' })).statut, 400);
        H.v('5. un erratum à motif trop court : 400', (await post(sv, ADM, errUrl, { scanId: scans[2], idProduct: 2003, via: 'idProduct', motif: 'x' })).statut, 400);
        H.v('5. un erratum sur un scan inconnu : 404', (await post(sv, ADM, errUrl, { scanId: String(oid()), idProduct: 2003, via: 'idProduct', motif: 'mauvais set choisi' })).statut, 404);
        const motif = 'mauvais set choisi à la saisie';
        let er = await post(sv, ADM, errUrl, { scanId: scans[2], idProduct: 2003, via: 'idProduct', motif });
        H.v('5. un erratum : 200, numéro 1', [er.statut, er.json.erratum], [200, 1]);
        const docEr = await db.col('banc_seau_errata').findOne({ scanId: scans[2] });
        H.v('5. l\'erratum garde l\'ancienne valeur, la nouvelle, la date et le motif', [docEr.ancien.idProduct, docEr.nouveau.idProduct, docEr.le instanceof Date, docEr.motif], [2001, 2003, true, motif]);
        H.v('5. la vérité d\'origine n\'est PAS réécrite', (await db.col('banc_seau_verites').findOne({ scanId: scans[2] })).idProduct, 2001);
        er = await post(sv, ADM, errUrl, { scanId: scans[2], idProduct: 2005, via: 'idProduct', motif: 'second erratum, corrige le premier' });
        H.v('5. un second erratum s\'ajoute à la chaîne (numéro 2, l\'ancien est le premier erratum)', [er.json.erratum, (await db.col('banc_seau_errata').findOne({ scanId: scans[2], n: 2 })).ancien.idProduct], [2, 2003]);
        const peri = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. 🔑 des errata ajoutés SANS ré-ancrage : ok FALSE, ancre « perimee », cause « ancre-errata »', [peri.json.ok, peri.json.ancre, peri.json.problemes.some(p => p.cause === 'ancre-errata')], [false, 'perimee', true]);
        const reancre = await ecrireAncre({ seauId: juge.id, colFn: n => db.col(n), dossier: ancres });
        H.v('5. le ré-ancrage prolonge la chaîne des errata (2 errata, tête = celle du second)', [reancre.errata, reancre.erratumTete === (await db.col('banc_seau_errata').findOne({ scanId: scans[2], n: 2 })).empreinte], [2, true]);
        const v1 = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. 🔑 verifier : ok, et il IMPRIME le nombre d\'errata', [v1.json.ok, v1.json.errata, v1.json.ancre], [true, 2, 'ok']);
        const dernierE = await db.col('banc_seau_errata').findOne({ scanId: scans[2], n: 2 });
        await db.col('banc_seau_errata').deleteOne({ _id: dernierE._id });
        const sansE = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. 🔑 un erratum SUPPRIMÉ en base : la chaîne des errata reste cohérente mais l\'ancre le voit (cause ancre-errata)', [sansE.json.ok, sansE.json.problemes.some(p => p.cause === 'ancre-errata')], [false, true]);
        await db.col('banc_seau_errata').insertOne(dernierE);
        let refait0 = null; try { await db.col('banc_seau_errata').deleteOne({ _id: dernierE._id }); await ecrireAncre({ seauId: juge.id, colFn: n => db.col(n), dossier: ancres }); } catch (e) { refait0 = e.code; } finally { await db.col('banc_seau_errata').insertOne(dernierE).catch(() => { }); }
        H.v('5. l\'outil ne ré-ancre JAMAIS une chaîne d\'errata raccourcie (ANCRE_DIFFERENTE)', refait0, 'ANCRE_DIFFERENTE');
        const docE2 = await db.col('banc_seau_errata').findOne({ scanId: scans[2], n: 2 });
        await db.col('banc_seau_errata').updateOne({ _id: docE2._id }, { $set: { 'nouveau.idProduct': 2002 } });
        const casseE = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. un erratum modifié à la main : verifier n\'est plus ok (cause erratum)', [casseE.json.ok, casseE.json.problemes.some(p => p.cause === 'erratum')], [false, true]);
        await db.col('banc_seau_errata').updateOne({ _id: docE2._id }, { $set: { 'nouveau.idProduct': 2005 } });
        const vd = await db.col('banc_seau_verites').findOne({ scanId: scans[3] });
        await db.col('banc_seau_verites').updateOne({ _id: vd._id }, { $set: { idProduct: 2004 } });
        const casseV = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. 🔑 une vérité du juge modifiée en base après le scellé : verifier n\'est plus ok (cause verites)', [casseV.json.ok, casseV.json.problemes.some(p => p.cause === 'verites')], [false, true]);
        await db.col('banc_seau_verites').updateOne({ _id: vd._id }, { $set: { idProduct: vd.idProduct } });
        // l'ancrage hors base
        const fa = path.join(ancres, `${juge.id}.json`), brutA = fs.readFileSync(fa, 'utf8');
        fs.writeFileSync(fa, brutA.replace(scelle.tete, 'c'.repeat(64)));
        const diff = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. 🔑 une tête différente de l\'ancre : verifier n\'est plus ok, ancre « differente »', [diff.json.ok, diff.json.ancre, diff.json.problemes.some(p => p.cause === 'ancre')], [false, 'differente', true]);
        let ecrase = null; try { await ecrireAncre({ seauId: juge.id, colFn: n => db.col(n), dossier: ancres }); } catch (e) { ecrase = e.code; }
        H.v('5. l\'outil ne remplace jamais une ancre qui DIFFÈRE de la base (ANCRE_DIFFERENTE)', ecrase, 'ANCRE_DIFFERENTE');
        fs.writeFileSync(fa, brutA);
        const refait = await ecrireAncre({ seauId: juge.id, colFn: n => db.col(n), dossier: ancres });
        H.v('5. réécrire l\'ancre identique : sans effet', refait.tete === scelle.tete, true);
        // --relire-r2
        const r2ok = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}&relireR2=1`);
        H.v('5. relire R2 : chaque objet relu et re-haché (photos + mesures), ok', [r2ok.json.ok, r2ok.json.objets > 0], [true, true]);
        const cleR2 = (await db.col('banc_seau_photos').findOne({ scanId: scans[0], index: 1 })).cle;
        await memoire.ecrire(cleR2, Buffer.from('octets changes'));
        const r2ko = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}&relireR2=1`);
        H.v('5. 🔑 un objet R2 altéré : verifier --relire-r2 n\'est plus ok (cause objet-altere)', [r2ko.json.ok, r2ko.json.problemes.some(p => p.cause === 'objet-altere')], [false, true]);
        await memoire.ecrire(cleR2, photos.b);
        H.v('5. sans relire R2, l\'objet altéré n\'est pas vu (c\'est le coût de l\'option)', (await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`)).json.ok, true);
        // la même vérification hors de l'API (CLI), avec --relire-r2
        const CLI = require('../mesures/verifier-seau');
        const dits = [];
        const connecter = async () => ({ colFn: n => db.col(n), fermer: async () => { } });
        const envCli = { MONGODB_ESSAI_LECTURE_URI: 'mongodb://127.0.0.1:1/x', V2_BANC_BUCKET: 'b' };
        const codeOk = await CLI.lancerCLI([`--base=test_scratch`, `--seau=${juge.id}`, '--relire-r2'], { env: envCli, connecter, stockage: { lire: k => memoire.lire(k) }, journal: l => dits.push(l), dossierAncres: ancres });
        H.v('5. verifier-seau --relire-r2 : code 0, dit « ancre : ok » et le nombre d\'objets relus', [codeOk, /^ok /.test(dits[0]), /ancre : ok/.test(dits[0]), /objets relus : [1-9]/.test(dits[0])], [0, true, true, true]);
        const sansAncre = [];
        await CLI.lancerCLI([`--base=test_scratch`, `--seau=${juge.id}`], { env: envCli, connecter, journal: l => sansAncre.push(l), dossierAncres: path.join(ancres, 'vide') });
        H.v('5. sans fichier d\'ancre, la CLI écrit « non ancré »', /non ancré/.test(sansAncre[0]), true);
        H.v('5. la CLI refuse la base `test` et un argument inconnu', [await CLI.lancerCLI(['--base=test', `--seau=${juge.id}`], { env: envCli, connecter }), await CLI.lancerCLI(['--base=x', `--seau=${juge.id}`, '--force'], { env: envCli, connecter })], [1, 1]);
        H.v('5. un second juge : 409 (un seul juge existe)', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'juge-bis', type: 'juge' })).statut, 409);
        r = await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'entrainement-1', type: 'entrainement', cible: 5, note: 'tamponnées' });
        H.v('5. l\'entraînement se déclare après le scellé du juge : 201', [r.statut, r.json.seau.cible], [201, 5]);
        entr = r.json.seau;
        const s = await db.col('banc_seaux').find({}).sort({ declareLe: 1 }).toArray();
        H.v('5. la chaîne des seaux : le second porte `prec` = l\'empreinte du premier', [s[0].prec, s[1].prec], ['0'.repeat(64), s[0].empreinte]);
        // une ligne falsifiée est vue
        const intact = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. la chaîne du juge scellé est ok', intact.json.ok, true);
        const avant = await db.col('banc_seau_scans').findOne({ seauId: juge.id, rang: 3 });
        await db.col('banc_seau_scans').updateOne({ _id: avant._id }, { $set: { scanId: 'f'.repeat(24) } });
        const casse = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. une ligne modifiée à la main : la chaîne est rompue au rang 3', [casse.json.ok, casse.json.problemes.map(p => p.rang)], [false, [3]]);
        await db.col('banc_seau_scans').updateOne({ _id: avant._id }, { $set: { scanId: avant.scanId } });
        const ph = await db.col('banc_seau_photos').findOne({ scanId: scans[0], index: 1 });
        await db.col('banc_seau_photos').updateOne({ _id: ph._id }, { $set: { sha256: 'd'.repeat(64) } });
        const casse2 = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. une photo modifiée après le scellé : l\'empreinte des photos ne concorde plus', [casse2.json.ok, casse2.json.problemes.some(p => p.cause === 'photos')], [false, true]);
        await db.col('banc_seau_photos').updateOne({ _id: ph._id }, { $set: { sha256: ph.sha256 } });
        H.v('5. rétabli : ok de nouveau', (await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`)).json.ok, true);
    });

    // ══ 6. le seau d'entraînement : la cible
    await essayer('entrainement', async () => {
        const u = (s, i) => `/api/banc/seau/photo?scanId=${s}&photo=${i}&seau=${entr.id}`;
        const e = [];
        // rang 1-3 : des photos ordinaires ; rang 4 : une RE-PHOTO du dessin d'une photo du juge (autre taille, autre compression, aucune annonce) ; rang 5 : un tout autre dessin
        const images = [await bruit(380, 500), await bruit(381, 500), await bruit(382, 500), await sharp(photos.a).resize(300, 420).jpeg({ quality: 50 }).toBuffer(), await blocs()];
        for (let i = 0; i < 5; i++) { const s = await semerScan(ADM); e.push(s); const r = await envoyer(sv, ADM, u(s, 0), images[i]); H.v(`6. scan ${i + 1} de l'entraînement : rang ${i + 1} (sans annonce : permis hors du juge)`, [r.statut, r.json.rang], [200, i + 1]); }
        const plein = await envoyer(sv, ADM, u(await semerScan(ADM), 0), photos.a);
        H.v('6. au-delà de la cible : 409 seau-plein', [plein.statut, detail(plein)], [409, 'seau-plein']);
        const { distance } = require('../banc/dhash');
        const dh = async i => (await db.col('banc_seau_photos').findOne({ scanId: e[i], index: 0 })).dhash;
        const dj = (await db.col('banc_seau_photos').findOne({ scanId: scans[0], index: 0 })).dhash;
        H.v('6. dHash : la re-photo est à ≤ 8 bits du juge, un autre dessin à plus de 8', [distance(await dh(3), dj) <= 8, distance(await dh(4), dj) > 8], [true, true]);
        entr.scans = e;
        // un erratum n'existe que pour un juge SCELLÉ
        H.v('6. un erratum sur un seau d\'entraînement : 409 pas-un-juge-scelle', detail(await post(sv, ADM, '/api/banc/seau/erratum', { scanId: e[0], idProduct: 2001, via: 'idProduct', motif: 'pas un juge du tout' })), 'pas-un-juge-scelle');
        // hors juge, la règle d'avant tient : on réécrit, l'historique est gardé
        await post(sv, ADM, '/api/banc/seau/verite', { scanId: e[1], idProduct: 2001, via: 'idProduct' });
        const rr = await post(sv, ADM, '/api/banc/seau/verite', { scanId: e[1], idProduct: 2003, via: 'idProduct' });
        H.v('6. hors juge : une vérité se réécrit (rev 2, historique gardé)', [rr.statut, rr.json.rev], [200, 2]);
    });

    // ══ 7. l'export rejouable ; le juge ne sert JAMAIS à l'entraînement
    await essayer('export', async () => {
        const { exporterSeau } = require('../mesures/exporter-seau');
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-seau-'));
        const colFn = n => db.col(n);
        const stockage = { lire: k => memoire.lire(k) };
        const envExport = { V2_EXPORT_RACINE: base };          // le dossier temporaire du système n'est plus une racine permise PAR DÉFAUT : la racine est nommée
        const refus = async (o) => { try { await exporterSeau({ colFn, stockage, base: 'test_scratch', env: envExport, ancresDir: ancres, ...o }); return 'a exporté'; } catch (e) { return e && e.code; } };
        H.v('7. 🔑 sans V2_EXPORT_RACINE, le dossier temporaire n\'est pas une racine permise : DOSSIER-REFUSE', await (async () => { try { await exporterSeau({ seauId: juge.id, usage: 'mesure', dossier: path.join(base, 'sans-racine'), colFn, stockage, base: 'test_scratch', env: {}, ancresDir: ancres }); return 'a exporté'; } catch (e) { return e.code; } })(), 'DOSSIER-REFUSE');
        H.v('7. usage absent : refusé', await refus({ seauId: juge.id, dossier: path.join(base, 'a') }), 'USAGE');
        H.v('7. usage inconnu : refusé', await refus({ seauId: juge.id, usage: 'autre', dossier: path.join(base, 'a2') }), 'USAGE');
        H.v('7. 🔑 un export d\'ENTRAÎNEMENT du juge (même scellé) : refusé JUGE_INTERDIT', await refus({ seauId: juge.id, usage: 'entrainement', dossier: path.join(base, 'b') }), 'JUGE_INTERDIT');
        H.v('7. le refus a lieu AVANT toute écriture : le dossier n\'existe pas', fs.existsSync(path.join(base, 'b')), false);
        H.v('7. la base `test` (production) : refusée', await refus({ seauId: juge.id, usage: 'mesure', base: 'test', dossier: path.join(base, 'bb') }), 'BASE-REFUSEE');
        H.v('7. un seau inconnu : refusé', await refus({ seauId: 'b'.repeat(16), usage: 'mesure', dossier: path.join(base, 'c') }), 'SEAU_INCONNU');
        // l'export de MESURE du juge scellé
        const sortieJ = path.join(base, 'juge');
        const rj = await exporterSeau({ seauId: juge.id, usage: 'mesure', dossier: sortieJ, colFn, stockage, base: 'test_scratch', env: envExport, ancresDir: ancres });
        const man = JSON.parse(fs.readFileSync(path.join(sortieJ, 'manifeste.json'), 'utf8')), lignes = JSON.parse(fs.readFileSync(path.join(sortieJ, 'lignes.json'), 'utf8'));
        H.v('7. export de mesure du juge : 4 lignes, chaîne ok, usage mesure', [rj.lignes, man.chaineOk, man.usage, man.format, man.seau.type, man.seau.etat], [4, true, 'mesure', 'banc-seau-v1', 'juge', 'scelle']);
        // l'export de MESURE d'un juge exige son ANCRE : sans le fichier, NON_ANCRE (et rien n'est écrit)
        fs.renameSync(path.join(ancres, `${juge.id}.json`), path.join(ancres, 'mise-de-cote.json'));
        H.v('7. 🔑 export de mesure d\'un juge NON ancré : refusé NON_ANCRE, avant toute écriture', [await refus({ seauId: juge.id, usage: 'mesure', dossier: path.join(base, 'sans-ancre') }), fs.existsSync(path.join(base, 'sans-ancre'))], ['NON_ANCRE', false]);
        fs.renameSync(path.join(ancres, 'mise-de-cote.json'), path.join(ancres, `${juge.id}.json`));
        const l0 = lignes[0];
        H.v('7. la ligne 1 : rang, scanId, 4 photos avec sha256, vérité, candidatsVus, analyse rejouable', [l0.rang, l0.scanId === scans[0], l0.photos.length, l0.photos.every(p => /^[0-9a-f]{64}$/.test(p.sha256)), l0.verite.idProduct, l0.verite.aveugle, !!l0.analyse.versionModele, l0.analyse.cartes.length], [1, true, 4, true, 2002, false, true, 1]);
        H.v('7. les mesures du client sont dans l\'export', [!!l0.mesures, l0.mesures && l0.mesures.fichier && fs.existsSync(path.join(sortieJ, l0.mesures.fichier))], [true, true]);
        H.v('7. les photos exportées sont identiques aux octets reçus', l0.photos.map(p => Buffer.compare(fs.readFileSync(path.join(sortieJ, p.fichier)), p.index === 0 ? photos.a : p.index === 1 ? photos.b : photos.c) === 0), [true, true, true, true]);
        H.v('7. la ligne 4 : doublon d\'annonce noté', lignes[3].doublonDe, scans[2]);
        H.v('7. la vérité EFFECTIVE d\'un juge porte ses errata : dernière valeur, valeur d\'origine et nombre', [lignes[2].verite.idProduct, lignes[2].verite.origine.idProduct, lignes[2].verite.errata.length, lignes[2].verite.errata[1].motif], [2005, 2001, 2, 'second erratum, corrige le premier']);
        H.v('7. le manifeste dit le nombre d\'errata et la tête de chaîne', [man.errata, man.tete === (await db.col('banc_seaux').findOne({ _id: juge.id })).tete], [2, true]);
        H.v('7. le dossier de sortie existant : refusé (un export crée un dossier neuf)', await refus({ seauId: juge.id, usage: 'mesure', dossier: sortieJ }), 'DOSSIER-REFUSE');
        // un nom fabriqué que la garde de dossier reconnaît par sa forme (nom court 8.3), jamais le nom d'un vrai dossier du testeur
        H.v('7. un nom court 8.3 : refusé', await refus({ seauId: juge.id, usage: 'mesure', dossier: path.join(base, 'ABCDEF~1', 'x') }), 'DOSSIER-REFUSE');
        // l'export d'ENTRAÎNEMENT du seau d'entraînement : exclut tout ce qui fuit du juge
        const l1 = await db.col('banc_seau_scans').findOne({ seauId: entr.id, rang: 1 });
        const phs = await db.col('banc_seau_photos').findOne({ scanId: l1.scanId, index: 0 });
        await db.col('banc_seau_photos').updateOne({ _id: phs._id }, { $set: { sha256: sha(photos.a) } });   // la 1re photo de l'entraînement est celle du juge (même sha256)
        const sortieE = path.join(base, 'entr');
        const re = await exporterSeau({ seauId: entr.id, usage: 'entrainement', dossier: sortieE, colFn, stockage, base: 'test_scratch', env: envExport, journal: () => { } });
        const manE = JSON.parse(fs.readFileSync(path.join(sortieE, 'manifeste.json'), 'utf8')), lignesE = JSON.parse(fs.readFileSync(path.join(sortieE, 'lignes.json'), 'utf8'));
        H.v('7. export d\'entraînement : sont EXCLUS le scan à photo du juge (sha256) et la RE-PHOTO (dHash ≤ 8) ; restent les 3 autres', [re.lignes, manE.exclusFuiteJuge, lignesE.map(l => l.rang)], [3, 2, [2, 3, 5]]);
        H.v('7. le manifeste dit la cause de chaque exclusion', manE.exclusParCause, { sha256: 1, annonce: 0, dhash: 1 });
        await db.col('banc_seau_photos').updateOne({ _id: phs._id }, { $set: { sha256: phs.sha256 } });          // la photo du rang 1 retrouve son vrai sha256 (la falsification n'était que pour la preuve ci-dessus)
        H.v('7. le manifeste dit l\'usage et que le seau est d\'entraînement', [manE.usage, manE.seau.type], ['entrainement', 'entrainement']);
        // 🔑 aucun juge déclaré : l'export d'entraînement REFUSE, sauf phrase de raison explicite (imprimée, gardée au manifeste)
        const sansJugeCol = n => { const c = db.col(n); return n !== 'banc_seaux' ? c : { findOne: async (q, o) => (q && q.type === 'juge' ? null : c.findOne(q, o)), find: (q, o) => (q && q.type === 'juge' ? { toArray: async () => [] } : c.find(q, o)), countDocuments: (q, o) => c.countDocuments(q, o) }; };
        H.v('7. 🔑 aucun juge : l\'export d\'entraînement refuse (JUGE_ABSENT)', await refus({ seauId: entr.id, usage: 'entrainement', dossier: path.join(base, 'sansjuge'), colFn: sansJugeCol }), 'JUGE_ABSENT');
        H.v('7. une « raison » trop courte ne suffit pas', await refus({ seauId: entr.id, usage: 'entrainement', dossier: path.join(base, 'sansjuge'), colFn: sansJugeCol, sansJuge: 'ok' }), 'JUGE_ABSENT');
        const dits = [];
        const phrase = 'premier lot avant la déclaration du juge, accepté par l\'éditeur le 1/11';
        await exporterSeau({ seauId: entr.id, usage: 'entrainement', dossier: path.join(base, 'sansjuge'), colFn: sansJugeCol, sansJuge: phrase, stockage, base: 'test_scratch', env: envExport, journal: l => dits.push(l) });
        H.v('7. avec la phrase : exporté, la phrase est IMPRIMÉE et gardée au manifeste', [dits.some(l => l.includes(phrase)), JSON.parse(fs.readFileSync(path.join(base, 'sansjuge', 'manifeste.json'), 'utf8')).sansJuge], [true, phrase]);
        // une ligne sans photo : marquée, absente de l'export
        const sauvePh = await db.col('banc_seau_photos').find({ scanId: entr.scans[4] }).toArray();
        await db.col('banc_seau_photos').deleteMany({ scanId: entr.scans[4] });
        const sortieS = path.join(base, 'entr-sans-photo');
        await exporterSeau({ seauId: entr.id, usage: 'entrainement', dossier: sortieS, colFn, stockage, base: 'test_scratch', env: envExport, journal: () => { } });
        const manS = JSON.parse(fs.readFileSync(path.join(sortieS, 'manifeste.json'), 'utf8'));
        H.v('7. une ligne SANS photo : absente de l\'export, comptée (sansPhoto)', [JSON.parse(fs.readFileSync(path.join(sortieS, 'lignes.json'), 'utf8')).map(l => l.rang), manS.sansPhoto], [[1, 2, 3], 1]);
        await db.col('banc_seau_photos').insertMany(sauvePh);
        // l'export de mesure d'un juge OUVERT est refusé : on ne mesure pas un juge qui bouge
        await db.col('banc_seaux').updateOne({ _id: entr.id }, { $set: { etat: 'scelle' } });       // l'index n'admet qu'UN seau ouvert : on libère la place pour jouer le cas
        await db.col('banc_seaux').updateOne({ _id: juge.id }, { $set: { etat: 'ouvert' } });
        H.v('7. mesure d\'un juge non scellé : refusée SEAU_OUVERT', await refus({ seauId: juge.id, usage: 'mesure', dossier: path.join(base, 'ouvert') }), 'SEAU_OUVERT');
        await db.col('banc_seaux').updateOne({ _id: juge.id }, { $set: { etat: 'scelle' } });
        await db.col('banc_seaux').updateOne({ _id: entr.id }, { $set: { etat: 'ouvert' } });
        // une photo dont les octets ont changé dans le bucket : l'export le dit (re-hachage)
        const cle0 = (await db.col('banc_seau_photos').findOne({ scanId: scans[0], index: 2 })).cle;
        await memoire.ecrire(cle0, Buffer.from('corrompu'));
        H.v('7. un objet du bucket altéré : l\'export refuse (sha256 relu ≠ sha256 noté)', await refus({ seauId: juge.id, usage: 'mesure', dossier: path.join(base, 'corrompu') }), 'OBJET_ALTERE');
        fs.rmSync(base, { recursive: true, force: true });
    });

    // ══ 8. le code de l'API est fidèle à l'intention : une fonction qui exporte pour l'entraînement ne lit JAMAIS le type du juge dans l'appel
    await essayer('garde dans le code', async () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'mesures', 'exporter-seau.js'), 'utf8');
        H.v('8. l\'export juge le TYPE lu en base (pas un argument de l\'appelant)', /JUGE_INTERDIT/.test(src) && /seau\.type\s*===\s*'juge'/.test(src), true);
    });

    // ══ 9. 🔑 L'ANCIEN CHEMIN CONNAÎT LE JUGE (relecture 1, C1) : ni l'étiquette, ni la ligne du banc, ni l'ancien export ne laissent passer un scan du juge
    await essayer('ancien chemin', async () => {
        const jugeScan = scans[1];
        const svPanne = await monter(cfgOn, { scanDuJuge: async () => { throw Object.assign(new Error('illisible'), { code: 'LECTURE_HS' }); } });
        let r = await post(sv, ADM, '/api/banc/etiquette', { scanId: jugeScan, carte: 0, verdict: 'juste', rev: 1 });
        const apres = await db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(jugeScan) });
        H.v('9. 🔑 /api/banc/etiquette sur un scan du JUGE : 409 scan-du-juge, aucune étiquette écrite', [r.statut, detail(r), apres.cartes[0].etiquetteAdmin], [409, 'scan-du-juge', undefined]);
        const libre = await semerScan(ADM);
        H.v('9. témoin : le même geste sur un scan hors du juge passe (200)', (await post(sv, ADM, '/api/banc/etiquette', { scanId: libre, carte: 0, verdict: 'juste', rev: 1 })).statut, 200);
        const e1 = entr.scans[1];
        H.v('9. témoin : un scan d\'un seau d\'entraînement s\'étiquette (200)', (await post(sv, ADM, '/api/banc/etiquette', { scanId: e1, carte: 0, verdict: 'juste', rev: 1 })).statut, 200);
        const libre2 = await semerScan(ADM);
        r = await post(svPanne, ADM, '/api/banc/etiquette', { scanId: libre2, carte: 0, verdict: 'juste', rev: 1 });
        H.v('9. 🔑 échec FERMÉ : l\'état du juge ne se lit pas ⇒ refus (503), rien d\'écrit', [r.statut, (await db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(libre2) })).cartes[0].etiquetteAdmin], [503, undefined]);
        await svPanne.fermer();

        // le rédacteur de la ligne du banc : un scan du juge n'y entre jamais, même si une étiquette existe déjà
        const { creerBanc } = require('../banc/routes');
        const stockBanc = S.creerStockageMemoire();
        const bancReel = creerBanc({ cfg: cfgOn, env: { V2_BANC_BUCKET: 'bucket-banc-test', V2_BANC_SEL: 'sel-x' }, stockage: stockBanc });
        const cleBanc = n => `banc-reel/v2/${String(n).repeat(32)}.webp`;
        await stockBanc.ecrire(cleBanc(1), Buffer.from('webp')); await stockBanc.ecrire(cleBanc(2), Buffer.from('webp'));
        const etiqueter = async (scanId, cle) => db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(scanId) }, { $set: { photoBanc: { cle, sha256: '9'.repeat(64) }, 'cartes.0.etiquetteAdmin': { verdict: 'juste', idProduct: 2001, rev: 1, le: new Date(), banc: 'en-attente' } } });
        await etiqueter(jugeScan, cleBanc(1)); await etiqueter(libre, cleBanc(2));
        const avant = await db.col('banc_lignes').countDocuments({});
        H.v('9. 🔑 le rédacteur de la ligne du banc refuse un scan du juge (exclue-juge)', await bancReel.etiquetteAdmin({ scanId: jugeScan, carte: 0 }), 'exclue-juge');
        H.v('9. …aucune ligne n\'est née ; témoin : un scan libre s\'écrit', [await db.col('banc_lignes').countDocuments({}) === avant, await bancReel.etiquetteAdmin({ scanId: libre, carte: 0 })], [true, 'ecrit']);

        // l'ANCIEN EXPORT (exporter-banc-admin) exclut le juge par photoBanc (clé, sha256), par sha256 des photos d'origine, et par identifiant de ligne (sel)
        const { exporterBancAdmin } = require('../mesures/exporter-banc-admin');
        const base2 = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-ancien-'));
        await db.col('banc_lignes').deleteMany({});
        await etiqueter(scans[2], cleBanc(3));
        const idLigne = (scanId, carte) => crypto.createHash('sha256').update(`${scanId}|${carte}|etiquette-admin|sel-x`).digest('hex');
        const ligne = (id, cle, shaP) => ({ _id: id, source: 'etiquette-admin', etat: 'confirmee', verite: 2001, cleR2: cle, sha256: shaP, rev: 1, reponse: { statut: 'identifiee', idProduct: 2001, candidats: [], questionCode: null } });
        await db.col('banc_lignes').insertMany([ligne('l1', cleBanc(3), '8'.repeat(64)), ligne('l2', cleBanc(4), sha(photos.a)), ligne(idLigne(scans[3], 0), cleBanc(5), '6'.repeat(64)), ligne('l4', cleBanc(6), '7'.repeat(64)), ligne('l5', cleBanc(7), '5'.repeat(64))]);
        // l4 : une photo SANS rapport avec le juge ; l5 : la RE-PHOTO d'une photo du juge (autre taille, autre compression, aucun sha256 en commun)
        const innocente = await blocs(), rephoto = await sharp(photos.a).resize(280, 400).jpeg({ quality: 45 }).toBuffer();
        const stockage = { lire: async k => (k === cleBanc(7) ? rephoto : innocente) };
        const envAncien = { V2_EXPORT_RACINE: base2, V2_BANC_SEL: 'sel-x' };
        const ex = await exporterBancAdmin({ dossier: path.join(base2, 'ancien'), colFn: n => db.col(n), stockage, base: 'test_scratch', env: envAncien });
        const manA = JSON.parse(fs.readFileSync(path.join(base2, 'ancien', 'manifeste.json'), 'utf8')), lignesA = JSON.parse(fs.readFileSync(path.join(base2, 'ancien', 'lignes.json'), 'utf8'));
        H.v('9. 🔑 l\'ancien export : les 3 lignes du juge (clé photoBanc, sha256 d\'origine, identifiant salé) sont EXCLUES, la ligne innocente reste', [ex.lignes, lignesA.map(l => l.id), manA.exclusJuge - manA.exclusDhash], [1, ['l4'], 3]);
        H.v('9. 🔑 l\'ancien export applique aussi le dHash ≤ 8 : la RE-PHOTO d\'une photo du juge est exclue et comptée (exclusDhash)', manA.exclusDhash, 1);
        let codeIllisible = null; try { await exporterBancAdmin({ dossier: path.join(base2, 'ancien3'), colFn: n => db.col(n), stockage: { lire: async () => Buffer.from('pas une image') }, base: 'test_scratch', env: envAncien }); } catch (e) { codeIllisible = e.code; }
        H.v('9. une photo qu\'on ne sait pas décoder : le dHash contre le juge est impossible ⇒ l\'ancien export REFUSE (échec fermé)', codeIllisible, 'JUGE_ILLISIBLE');
        let code9 = null;
        try { await exporterBancAdmin({ dossier: path.join(base2, 'ancien2'), colFn: n => (n === 'banc_seaux' ? { findOne: async () => { throw new Error('HS'); }, find: () => ({ toArray: async () => { throw new Error('HS'); } }) } : db.col(n)), stockage, base: 'test_scratch', env: envAncien }); } catch (e) { code9 = e.code; }
        H.v('9. 🔑 échec FERMÉ : l\'état du juge ne se lit pas ⇒ l\'ancien export refuse (JUGE_ILLISIBLE) et n\'écrit rien', [code9, fs.existsSync(path.join(base2, 'ancien2'))], ['JUGE_ILLISIBLE', false]);

        // les outils de mesure qui lisent des photos de banc (analyses.photoBanc) passent par la même garde
        const outils = ['mesurer-etat-titre.js', 'mesurer-lecture-tampon.js', 'mesurer-marques-tampon.js', 'verifier-tampon-bout-en-bout.js', 'mesurer-probable-production.js'];
        H.v('9. les 5 outils de mesure qui lisent analyses / photoBanc excluent le juge (juge-garde)', outils.map(f => /juge-garde/.test(fs.readFileSync(path.join(__dirname, '..', 'mesures', f), 'utf8'))), [true, true, true, true, true]);
        fs.rmSync(base2, { recursive: true, force: true });
    });

    await sv.fermer(); await svOff.fermer();
    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
void http;
