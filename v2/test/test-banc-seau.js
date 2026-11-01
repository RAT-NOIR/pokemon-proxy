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

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { console.log(`   frontière de fenêtre (1 h) dans ${Math.round(reste / 1000)} s : attente`); await new Promise(r => setTimeout(r, reste + 2000)); } }

    // ── la configuration : le drapeau n'est allumé que par « 1 » exactement
    H.v('config : drapeau absent ⇒ éteint', cfgOff.bancSeau, false);
    H.v('config : V2_BANC_SEAU=1 ⇒ allumé', cfgOn.bancSeau, true);
    for (const autre of ['0', 'true', 'oui', ' 1', '2', '']) H.v(`config : V2_BANC_SEAU="${autre}" ⇒ éteint`, lireConfig({ MONGODB_BASE: 'test_scratch', V2_BANC_SEAU: autre }).bancSeau, false);

    await H.ouvrirBac('test-banc-seau.js'); await M.creerIndex();
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

    const seaux = creerSeaux({ cfg: cfgOn, stockage: memoire, horloge, catalogue: reel });
    const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
    const monter = async cfg => {
        const app = express(); app.use(express.json());
        const router = express.Router();
        monterBanc.routes(router, cfg, { banc: {}, purge: purgeStub, seaux });
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
        r = await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'juge-200', type: 'juge' });
        H.v('2. déclarer le juge (cible 200 par défaut) : 201', [r.statut, r.json && r.json.seau && r.json.seau.type, r.json.seau.cible, r.json.seau.etat], [201, 'juge', 200, 'ouvert']);
        juge = r.json.seau;
        H.v('2. empreinte de 64 hexadécimaux, horodatage, identifiant de 16 hexadécimaux', [/^[0-9a-f]{64}$/.test(juge.empreinte), !Number.isNaN(Date.parse(juge.declareLe)), /^[0-9a-f]{16}$/.test(juge.id)], [true, true, true]);
        H.v('2. un second seau pendant que le juge est ouvert : 409', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'autre', type: 'entrainement' })).statut, 409);
        H.v('2. un nom invalide : 400', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'a b!', type: 'entrainement' })).statut, 400);
        H.v('2. un type inconnu : 400', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'zz', type: 'test' })).statut, 400);
        H.v('2. un champ inconnu : 400', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'zz', type: 'entrainement', etat: 'scelle' })).statut, 400);
        H.v('2. un juge de cible 300 : 400 (le juge a 200 annonces)', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'juge-300', type: 'juge', cible: 300 })).statut, 400);
        r = await get(sv, ADM, '/api/banc/seau/courant');
        H.v('2. courant rend le juge ouvert', [r.json.seau.id, r.json.seau.n], [juge.id, 0]);
        // la déclaration ne se modifie pas : aucune route de mise à jour n'existe
        for (const m of ['PUT', 'PATCH', 'DELETE']) {
            const x = await fetch(sv.url + '/api/banc/seau/declarer', { method: m, headers: { 'content-type': 'application/json', ...auth(ADM) }, body: '{}' });
            H.v(`2. ${m} sur la déclaration : 404`, x.status, 404);
        }
    });

    // ══ 3. les photos : EN OCTETS, au scan, avec leur sha256 ; le seau en cours est posé par l'outil
    const photos = { a: await bruit(400, 560, 80), b: await bruit(300, 420, 70), c: await bruit(500, 700, 90) };
    const scans = [];
    await essayer('photos', async () => {
        const scan1 = await semerScan(ADM); scans.push(scan1);
        const url = (s, i, extra = '') => `/api/banc/seau/photo?scanId=${s}&photo=${i}&seau=${juge.id}${extra}`;
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
        // les refus
        const scan2 = await semerScan(ADM); scans.push(scan2);
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
    });

    // ══ 5. la chaîne d'empreintes, et le scellé
    let chaine1;
    await essayer('scellé', async () => {
        let r = await get(sv, ADM, `/api/banc/seau/verifier?seau=${juge.id}`);
        H.v('5. la chaîne du juge ouvert se vérifie : ok, 4 lignes (0 manquante)', [r.statut, r.json.ok, r.json.lignes, r.json.problemes], [200, true, 4, []]);
        chaine1 = r.json.tete;
        H.v('5. sceller sans seauId : 400', (await post(sv, ADM, '/api/banc/seau/sceller', {})).statut, 400);
        H.v('5. sceller un seau inconnu : 404', (await post(sv, ADM, '/api/banc/seau/sceller', { seauId: 'a'.repeat(16) })).statut, 404);
        r = await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id });
        H.v('5. sceller le juge : etat scelle, n 4, tête = dernière empreinte, empreinte du scellé', [r.statut, r.json.seau.etat, r.json.seau.n, r.json.seau.tete, /^[0-9a-f]{64}$/.test(r.json.seau.empreinteScellee), !!r.json.seau.photosEmpreinte], [200, 'scelle', 4, chaine1, true, true]);
        H.v('5. sceller deux fois : 409 (une transition, une seule)', detail(await post(sv, ADM, '/api/banc/seau/sceller', { seauId: juge.id })), 'deja-scelle');
        const scelle = await db.col('banc_seaux').findOne({ _id: juge.id });
        H.v('5. la déclaration est intacte après le scellé', [scelle.nom, scelle.type, scelle.cible, scelle.empreinte], [juge.nom, 'juge', 200, juge.empreinte]);
        const p = await envoyer(sv, ADM, `/api/banc/seau/photo?scanId=${await semerScan(ADM)}&photo=0&seau=${juge.id}`, photos.a);
        H.v('5. une photo vers le juge scellé : 409 (aucun seau ouvert)', [p.statut], [409]);
        H.v('5. la vérité reste saisissable (le scellé fige la liste, pas la réponse du testeur)', (await post(sv, ADM, '/api/banc/seau/verite', { scanId: scans[2], idProduct: 2001, via: 'idProduct' })).statut, 200);
        H.v('5. un second juge : 409 (un seul juge existe)', (await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'juge-bis', type: 'juge' })).statut, 409);
        r = await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'entrainement-1', type: 'entrainement', cible: 3, note: 'tamponnées' });
        H.v('5. l\'entraînement se déclare après le scellé du juge : 201', [r.statut, r.json.seau.cible], [201, 3]);
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
        for (let i = 0; i < 3; i++) { const s = await semerScan(ADM); e.push(s); const r = await envoyer(sv, ADM, u(s, 0), await bruit(380 + i, 500)); H.v(`6. scan ${i + 1} de l'entraînement : rang ${i + 1}`, [r.statut, r.json.rang], [200, i + 1]); }
        const plein = await envoyer(sv, ADM, u(await semerScan(ADM), 0), photos.a);
        H.v('6. au-delà de la cible : 409 seau-plein', [plein.statut, detail(plein)], [409, 'seau-plein']);
        // la même annonce que dans le juge : repérée (fuite), pas écrite comme neuve silencieusement
        entr.scans = e;
    });

    // ══ 7. l'export rejouable ; le juge ne sert JAMAIS à l'entraînement
    await essayer('export', async () => {
        const { exporterSeau } = require('../mesures/exporter-seau');
        const base = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-seau-'));
        const colFn = n => db.col(n);
        const stockage = { lire: k => memoire.lire(k) };
        const refus = async (o) => { try { await exporterSeau({ colFn, stockage, base: 'test_scratch', ...o }); return 'a exporté'; } catch (e) { return e && e.code; } };
        H.v('7. usage absent : refusé', await refus({ seauId: juge.id, dossier: path.join(base, 'a') }), 'USAGE');
        H.v('7. usage inconnu : refusé', await refus({ seauId: juge.id, usage: 'autre', dossier: path.join(base, 'a2') }), 'USAGE');
        H.v('7. 🔑 un export d\'ENTRAÎNEMENT du juge (même scellé) : refusé JUGE_INTERDIT', await refus({ seauId: juge.id, usage: 'entrainement', dossier: path.join(base, 'b') }), 'JUGE_INTERDIT');
        H.v('7. le refus a lieu AVANT toute écriture : le dossier n\'existe pas', fs.existsSync(path.join(base, 'b')), false);
        H.v('7. la base `test` (production) : refusée', await refus({ seauId: juge.id, usage: 'mesure', base: 'test', dossier: path.join(base, 'bb') }), 'BASE-REFUSEE');
        H.v('7. un seau inconnu : refusé', await refus({ seauId: 'b'.repeat(16), usage: 'mesure', dossier: path.join(base, 'c') }), 'SEAU_INCONNU');
        // l'export de MESURE du juge scellé
        const sortieJ = path.join(base, 'juge');
        const rj = await exporterSeau({ seauId: juge.id, usage: 'mesure', dossier: sortieJ, colFn, stockage, base: 'test_scratch' });
        const man = JSON.parse(fs.readFileSync(path.join(sortieJ, 'manifeste.json'), 'utf8')), lignes = JSON.parse(fs.readFileSync(path.join(sortieJ, 'lignes.json'), 'utf8'));
        H.v('7. export de mesure du juge : 4 lignes, chaîne ok, usage mesure', [rj.lignes, man.chaineOk, man.usage, man.format, man.seau.type, man.seau.etat], [4, true, 'mesure', 'banc-seau-v1', 'juge', 'scelle']);
        const l0 = lignes[0];
        H.v('7. la ligne 1 : rang, scanId, 4 photos avec sha256, vérité, candidatsVus, analyse rejouable', [l0.rang, l0.scanId === scans[0], l0.photos.length, l0.photos.every(p => /^[0-9a-f]{64}$/.test(p.sha256)), l0.verite.idProduct, l0.verite.aveugle, !!l0.analyse.versionModele, l0.analyse.cartes.length], [1, true, 4, true, 2002, false, true, 1]);
        H.v('7. les mesures du client sont dans l\'export', [!!l0.mesures, l0.mesures && l0.mesures.fichier && fs.existsSync(path.join(sortieJ, l0.mesures.fichier))], [true, true]);
        H.v('7. les photos exportées sont identiques aux octets reçus', l0.photos.map(p => Buffer.compare(fs.readFileSync(path.join(sortieJ, p.fichier)), p.index === 0 ? photos.a : p.index === 1 ? photos.b : photos.c) === 0), [true, true, true, true]);
        H.v('7. la ligne 4 : doublon d\'annonce noté', lignes[3].doublonDe, scans[2]);
        H.v('7. une ligne sans vérité : verite null', lignes[3].verite, null);
        H.v('7. le dossier de sortie existant : refusé (un export crée un dossier neuf)', await refus({ seauId: juge.id, usage: 'mesure', dossier: sortieJ }), 'DOSSIER-REFUSE');
        H.v('7. un dossier sous un dossier d\'apports : refusé', await refus({ seauId: juge.id, usage: 'mesure', dossier: path.join(base, 'Logo FR', 'x') }), 'DOSSIER-REFUSE');
        // l'export d'ENTRAÎNEMENT du seau d'entraînement : exclut tout ce qui fuit du juge
        const fuite = await semerScan(ADM);   // une copie du juge (même photo) rangée dans l'entraînement : impossible (plein), donc on l'écrit à la main comme le ferait une fuite
        await db.col('banc_seaux').updateOne({ _id: entr.id }, { $set: { cible: 3 } });
        const l1 = await db.col('banc_seau_scans').findOne({ seauId: entr.id, rang: 1 });
        const phs = await db.col('banc_seau_photos').findOne({ scanId: l1.scanId, index: 0 });
        await db.col('banc_seau_photos').updateOne({ _id: phs._id }, { $set: { sha256: sha(photos.a) } });   // la 1re photo de l'entraînement est celle du juge
        await db.col('banc_seau_verites').insertOne({ _id: `${l1.scanId}:0`, seauId: entr.id, scanId: l1.scanId, carte: 0, idProduct: 2001, via: 'idProduct', candidatsVus: false, rev: 1, historique: [], saisieLe: new Date() });
        const sortieE = path.join(base, 'entr');
        const re = await exporterSeau({ seauId: entr.id, usage: 'entrainement', dossier: sortieE, colFn, stockage, base: 'test_scratch' });
        const manE = JSON.parse(fs.readFileSync(path.join(sortieE, 'manifeste.json'), 'utf8')), lignesE = JSON.parse(fs.readFileSync(path.join(sortieE, 'lignes.json'), 'utf8'));
        H.v('7. export d\'entraînement : le scan qui porte une photo du juge est EXCLU et compté', [re.lignes, manE.exclusFuiteJuge, lignesE.map(l => l.rang)], [2, 1, [2, 3]]);
        H.v('7. le manifeste dit l\'usage et que le juge n\'y est pas', [manE.usage, manE.seau.type], ['entrainement', 'entrainement']);
        void fuite;
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

    await sv.fermer(); await svOff.fermer();
    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
void http;
