'use strict';
// B6.3 — les lignes du banc réel : seulement ce qui est CONFIRMÉ, rien d'IDENTIFIANT. Le cas par défaut (sans consentement valide : rien) est lancé EN PREMIER.
// Base : la base EN MÉMOIRE du banc (INT2). R2 : un FAUX client qui lève si le bucket n'est pas `bucket-banc-test`. Aucun réseau, aucune base réelle.
const H = require('./_harnais');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const { creerStockage } = require('../banc/stockage');
const { creerBanc, TIMEOUT_MS } = require('../banc/routes');
const monterBanc = require('../banc/monter');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const BUCKET = 'bucket-banc-test';
const SEL = 'sel-de-banc-A', SEL_B = 'sel-de-banc-B';
const SCAN = '650000000000000000000001', IP = '203.0.113.77', INSTALLATION = 'inst-secrete-0123456789abcdef', COMPTE = 'compte-secret-42';
const attendre = ms => new Promise(r => setTimeout(r, ms));

function fauxClient() {
    const commandes = [], objets = new Map(), panne = { put: false, del: false, pend: false };
    const garde = b => { if (b !== BUCKET) throw new Error('mauvais bucket ' + b); };
    return {
        commandes, objets, panne,
        async deposerBinaire(bucket, cle, buf, ct) { garde(bucket); commandes.push({ op: 'put', cle, ct }); if (panne.pend) await new Promise(() => { }); if (panne.put) throw new Error('R2 en panne ' + cle); objets.set(cle, buf); return { ecrit: true, cle }; },
        async supprimer(bucket, cles) { garde(bucket); commandes.push({ op: 'del', cles }); if (panne.del) throw new Error('R2 suppression en panne'); for (const c of cles) objets.delete(c); return cles.length; },
        async lireBinaire(bucket, cle) { garde(bucket); commandes.push({ op: 'get', cle }); if (!objets.has(cle)) throw new Error('absent'); return objets.get(cle); },
    };
}
const ecritures = c => c.commandes.filter(x => x.op === 'put').length;
let T0 = new Date('2026-10-10T12:00:00Z');
function nouveau(o = {}) {
    const client = fauxClient();
    const env = { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL, ...(o.env || {}) };
    const stockage = creerStockage({ client, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } });
    if (o.verifierBucket) stockage.verifierBucket = o.verifierBucket;
    const banc = creerBanc({ cfg, env, stockage, horloge: () => T0, delaiMs: o.delaiMs, colFn: o.colFn });
    return { banc, client, env, stockage };
}
const lignes = () => db.col('banc_lignes').find({}).toArray();
const vider = () => db.col('banc_lignes').deleteMany({});
const consentement = (jeton = 'jeton-test-abcdefghij1234') => ({ consentementBanc: { version: '2026-10-07-v1', le: new Date(T0.getTime() - 3600e3).toISOString(), jeton } });
const empreinte = j => crypto.createHash('sha256').update(j).digest('hex');
const carteImg = (w = 640, h = 894) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 30, g: 120, b: 60 } } }).jpeg().toBuffer();
const idLigne = (scanId, carte, sel = SEL) => crypto.createHash('sha256').update(`${scanId}|${carte}|${sel}`).digest('hex');

// capture du journal (console.error / console.warn / console.log) : jamais de contenu
function capturer() {
    const vus = [], o = { e: console.error, w: console.warn, l: console.log };
    const f = (...a) => { vus.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' ')); };
    console.error = f; console.warn = f; console.log = f;
    return { vus, rendre() { console.error = o.e; console.warn = o.w; console.log = o.l; } };
}

(async () => {
    const prefixe = await H.ouvrirBac('test-banc-ecriture.js');
    await M.creerIndex(['banc_lignes', 'installations', 'analyses', 'comptes']);
    const image = await carteImg();

    // ═══ (1) LE DÉFAUT D'ABORD — sans consentement valide : zéro ligne, zéro objet, quelle que soit l'issue ═══
    {
        const corpsInvalides = [undefined, {}, { consentementBanc: null }, { consentementBanc: {} }, { consentementBanc: 'oui' }, { consentementBanc: true },
            { consentementBanc: { ...consentement().consentementBanc, version: 'inconnue' } }, { consentementBanc: { ...consentement().consentementBanc, jeton: 'court' } },
            { consentementBanc: { ...consentement().consentementBanc, le: 'hier' } }];
        let appels = 0, lignesVues = 0, objetsVus = 0, commandes = 0;
        for (const corps of corpsInvalides) {
            const { banc, client } = nouveau();
            const e = { corps, scanId: SCAN, carte: 0, idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'm1' };
            await banc.apresVerdict({ ...e, issue: 'affirmee' }); await banc.apresVerdict({ ...e, issue: 'question' });
            await banc.apresReponse({ ...e, choix: 'a' });
            await banc.apresVerdict({ ...e, issue: 'introuvable' }); await banc.apresVerdict({ ...e, issue: 'panne' });
            await banc.corriger({ ...e, porteur: 'installation:x' });
            appels += 6; lignesVues += (await lignes()).length; objetsVus += client.objets.size; commandes += client.commandes.length;
            await vider();
        }
        H.v(`(1) sans consentement valide : ${corpsInvalides.length} corps × 6 issues = ${appels} appels → lignes, objets, commandes R2`, [appels, lignesVues, objetsVus, commandes], [corpsInvalides.length * 6, 0, 0, 0]);
        // le contrôle positif : le même appel AVEC consentement écrit bel et bien (le test peut échouer)
        const { banc, client } = nouveau();
        await banc.apresVerdict({ corps: consentement(), scanId: SCAN, carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'm1' });
        H.v('(1) contrôle positif : avec consentement valide, une ligne et un objet', [(await lignes()).length, client.objets.size], [1, 1]);
        await vider();
    }
    // ─── hors consentement : réponse et correction sur un ÉTAT existant ne le changent pas (avant/après identiques)
    {
        const { banc, client } = nouveau();
        await banc.apresVerdict({ corps: consentement(), scanId: SCAN, carte: 0, issue: 'question', imageRedressee: image, detectionSure: true });
        const avant = JSON.stringify(await lignes()), objAvant = [...client.objets.keys()].join();
        await banc.apresReponse({ corps: {}, scanId: SCAN, carte: 0, choix: 'a', idProduct: 777 });
        await banc.apresReponse({ corps: { consentementBanc: 'oui' }, scanId: SCAN, carte: 0, choix: 'a', idProduct: 777 });
        await banc.corriger({ corps: {}, scanId: SCAN, carte: 0, idProduct: 888 });
        H.v('(1) réponse / correction sans consentement sur une ligne en attente : ligne et objet inchangés', [JSON.stringify(await lignes()) === avant, [...client.objets.keys()].join() === objAvant], [true, true]);
        await vider();
    }

    // ═══ (2) consentement valide mais rien à conserver ═══
    {
        const base = { corps: consentement(), scanId: SCAN, carte: 0, issue: 'affirmee', idProduct: 4242, versionModele: 'm1' };
        const cas = [
            ['imageRedressee absente (le cas d\'AUJOURD\'HUI en production)', { detectionSure: true }],
            ['detectionSure:false', { imageRedressee: image, detectionSure: false }],
            ['detectionSure absente', { imageRedressee: image }],
            ['detectionSure:"true" (texte)', { imageRedressee: image, detectionSure: 'true' }],
            ['image non-Buffer', { imageRedressee: 'texte', detectionSure: true }],
            ['photo entière 4000×3000 (image-refusee par traiterImage)', { imageRedressee: await carteImg(4000, 3000), detectionSure: true }],
            ['idProduct mal formé (affirmée)', { imageRedressee: image, detectionSure: true, idProduct: '4242' }],
            ['issue introuvable', { imageRedressee: image, detectionSure: true, issue: 'introuvable' }],
        ];
        for (const [nom, plus] of cas) {
            const { banc, client } = nouveau();
            await banc.apresVerdict({ ...base, ...plus });
            H.v(`(2) ${nom} : rien`, [(await lignes()).length, client.commandes.length], [0, 0]);
        }
        // V2_BANC_SEL absent => banc désactivé, DIT UNE FOIS (deux appels)
        let cap = capturer();
        const sansSel = nouveau({ env: { V2_BANC_SEL: '' } });
        await sansSel.banc.apresVerdict({ ...base, imageRedressee: image, detectionSure: true });
        await sansSel.banc.apresVerdict({ ...base, imageRedressee: image, detectionSure: true });
        cap.rendre();
        H.v('(2) V2_BANC_SEL absent : rien, aucune commande R2', [(await lignes()).length, sansSel.client.commandes.length], [0, 0]);
        H.v('(2) V2_BANC_SEL absent : dit UNE seule fois sur deux appels, sans le nom d\'un secret ni de contenu', [cap.vus.length, /V2_BANC_SEL/.test(cap.vus[0] || ''), /sel-de-banc/.test(cap.vus.join())], [1, true, false]);
        cap = capturer();
        const sansBucket = nouveau({ env: { V2_BANC_BUCKET: '' } });
        await sansBucket.banc.apresVerdict({ ...base, imageRedressee: image, detectionSure: true });
        await sansBucket.banc.apresVerdict({ ...base, imageRedressee: image, detectionSure: true });
        cap.rendre();
        H.v('(2) V2_BANC_BUCKET absent : rien, dit une seule fois', [(await lignes()).length, sansBucket.client.commandes.length, cap.vus.length], [0, 0, 1]);
    }

    // ═══ verifierBucket : aucune écriture avant sa résolution ; un échec désactive le banc pour le processus ═══
    {
        let appels = 0;
        const cap = capturer();
        const rejet = nouveau({ verifierBucket: () => { appels++; return Promise.reject(Object.assign(new Error('endpoint https://secret.exemple/x'), { code: 'MAUVAIS_ENDPOINT' })); } });
        const e = { corps: consentement(), scanId: SCAN, carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true };
        await rejet.banc.apresVerdict(e); await rejet.banc.apresVerdict({ ...e, scanId: '650000000000000000000002' });
        cap.rendre();
        H.v('verifierBucket qui rejette : 0 commande R2, 0 ligne, appelé UNE fois (désactivé pour le processus)', [rejet.client.commandes.length, (await lignes()).length, appels], [0, 0, 1]);
        H.v('   dit une fois, sans l\'adresse ni le message de l\'erreur', [cap.vus.length, /secret\.exemple/.test(cap.vus.join())], [1, false]);
        // qui résout tard
        let libere; const tard = new Promise(r => { libere = r; });
        const lent = nouveau({ verifierBucket: () => tard });
        const p = lent.banc.apresVerdict(e);
        await attendre(80);
        H.v('verifierBucket pas encore résolu : aucune commande R2', lent.client.commandes.length, 0);
        libere(); await p;
        H.v('   résolu : l\'écriture a lieu (une ligne, un put)', [(await lignes()).length, ecritures(lent.client)], [1, 1]);
        await vider();
    }

    // ═══ (3) affirmée : une ligne confirmée, clés EXACTES, rien d'identifiant ═══
    {
        const { banc, client } = nouveau();
        const jeton = 'jeton-test-abcdefghij1234';
        const corps = { consentementBanc: { ...consentement(jeton).consentementBanc, ip: IP, compteId: COMPTE }, installationId: INSTALLATION };
        await banc.apresVerdict({ corps, scanId: SCAN, carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true, versionModele: 'modele-7',
            ip: IP, installationId: INSTALLATION, compteId: COMPTE, titre: 'Dracaufeu rare', vendeur: 'vendeur42', url: 'https://www.vinted.fr/items/123' });
        const ls = await lignes();
        H.v('(3) une ligne', ls.length, 1);
        const l = ls[0] || {};
        H.v('(3) clés du document EXACTEMENT la liste du plan', Object.keys(l).sort(), ['_id', 'cleR2', 'etat', 'expireLe', 'jetonEmpreinte', 'le', 'source', 'verite', 'versionModele', 'versionTexte']);
        H.v('(3) valeurs : confirmée / affirme / vérité / versions / empreinte du jeton', [l.etat, l.source, l.verite, l.versionModele, l.versionTexte, l.jetonEmpreinte], ['confirmee', 'affirme', 4242, 'modele-7', '2026-10-07-v1', empreinte(jeton)]);
        H.v('(3) _id = sha256(scanId|carte|sel)', l._id, idLigne(SCAN, 0));
        H.v('(3) cleR2 = banc-reel/v2/<hex>.webp, et l\'objet existe', [/^banc-reel\/v2\/[0-9a-f]{32}\.webp$/.test(l.cleR2), client.objets.has(l.cleR2)], [true, true]);
        H.v('(3) expireLe = le + 24 mois (30,5 j)', Math.round((l.expireLe - l.le) / 86400e3), 732);
        const brut = JSON.stringify(l);
        H.v('(3) JSON.stringify(ligne) : ni scanId, ni installationId, ni IP, ni compteId, ni jeton en clair, ni titre/vendeur/URL',
            [brut.includes(SCAN), brut.includes(INSTALLATION), brut.includes(IP), brut.includes(COMPTE), brut.includes(jeton), /Dracaufeu|vendeur42|vinted/.test(brut)], Array(6).fill(false));
        // ruling 7 : _id ne se recalcule pas sans le sel
        const autreSel = nouveau({ env: { V2_BANC_SEL: SEL_B } });
        await autreSel.banc.apresVerdict({ corps, scanId: SCAN, carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true });
        const ids = (await lignes()).map(x => x._id);
        H.v('(3) deux sels différents ⇒ deux _id distincts pour le même (scanId, carte) — 2 lignes', [ids.length, new Set(ids).size, ids.includes(idLigne(SCAN, 0, SEL_B))], [2, 2, true]);
        H.vrai('   et le sel n\'est pas dans le document', !JSON.stringify(await lignes()).includes('sel-de-banc'));
        await vider();
    }

    // ═══ (4) question puis réponse / abandon / 24 h ═══
    {
        const e = { corps: consentement(), scanId: SCAN, carte: 0, imageRedressee: image, detectionSure: true, versionModele: 'm1' };
        let { banc, client } = nouveau();
        await banc.apresVerdict({ ...e, issue: 'question' });
        let l = (await lignes())[0] || {};
        H.v('(4) question ⇒ une ligne `attente`, vérité vide, objet sous attente/', [(await lignes()).length, l.etat, l.verite, /^banc-reel\/v2\/attente\/[0-9a-f]{32}\.webp$/.test(l.cleR2), client.objets.has(l.cleR2)], [1, 'attente', null, true, true]);
        const cleAttente = l.cleR2;
        // une réponse portant un AUTRE jeton ne confirme rien
        await banc.apresReponse({ ...e, corps: consentement('autre-jeton-abcdefghij99'), choix: 'a', idProduct: 777 });
        H.v('(4) réponse d\'un autre jeton de consentement : la ligne reste en attente', (await lignes())[0].etat, 'attente');
        await banc.apresReponse({ ...e, choix: 'a', idProduct: 777 });
        l = (await lignes())[0] || {};
        H.v('(4) réponse `a` ⇒ confirmee / reponse / vérité = l\'idProduct du choix', [(await lignes()).length, l.etat, l.source, l.verite], [1, 'confirmee', 'reponse', 777]);
        H.v('(4) l\'objet est passé de attente/ à son emplacement final', [client.objets.has(cleAttente), /^banc-reel\/v2\/[0-9a-f]{32}\.webp$/.test(l.cleR2), client.objets.has(l.cleR2), client.objets.size], [false, true, true, 1]);
        await banc.apresReponse({ ...e, choix: 'b', idProduct: 999 });
        H.v('(4) une seconde réponse ne change rien (déjà confirmée)', [(await lignes())[0].verite, client.objets.size], [777, 1]);
        await vider();
        // au plus une ligne `attente` par (scanId, carte)
        ({ banc, client } = nouveau());
        await banc.apresVerdict({ ...e, issue: 'question' }); await banc.apresVerdict({ ...e, issue: 'question' });
        H.v('(9) deux questions pour le même (scanId, carte) : une ligne, un objet (le second est défait)', [(await lignes()).length, client.objets.size], [1, 1]);
        await vider();
        // aucune / ne-sait-pas ⇒ zéro ligne, zéro objet (objet d'abord, ligne ensuite)
        for (const choix of ['aucune', 'ne-sait-pas']) {
            ({ banc, client } = nouveau());
            await banc.apresVerdict({ ...e, issue: 'question' });
            await banc.apresReponse({ ...e, choix });
            H.v(`(4) question puis \`${choix}\` ⇒ zéro ligne, zéro objet`, [(await lignes()).length, client.objets.size], [0, 0]);
        }
        ({ banc, client } = nouveau());
        await banc.apresVerdict({ ...e, issue: 'question' });
        await banc.apresAbandon({ scanId: SCAN, carte: 0 });
        H.v('(4) apresAbandon direct ⇒ zéro ligne, zéro objet', [(await lignes()).length, client.objets.size], [0, 0]);
        // abandon dont la suppression d'objet ÉCHOUE : la ligne reste (objet d'abord)
        ({ banc, client } = nouveau());
        await banc.apresVerdict({ ...e, issue: 'question' });
        client.panne.del = true; const cap = capturer();
        await banc.apresAbandon({ scanId: SCAN, carte: 0 });
        cap.rendre(); client.panne.del = false;
        H.v('(4) suppression d\'objet ratée à l\'abandon : la ligne est CONSERVÉE (on ne perd pas la trace d\'un objet vivant)', [(await lignes()).length, client.objets.size], [1, 1]);
        await vider();
        // un abandon n'efface JAMAIS une ligne confirmée
        ({ banc, client } = nouveau());
        await banc.apresVerdict({ ...e, issue: 'affirmee', idProduct: 4242 });
        await banc.apresAbandon({ scanId: SCAN, carte: 0 });
        H.v('(4) apresAbandon sur une ligne confirmée : intacte', [(await lignes()).length, client.objets.size], [1, 1]);
        await vider();
        // 24 h sans réponse : le balayage (objet d'abord, ligne ensuite)
        ({ banc, client } = nouveau());
        await banc.apresVerdict({ ...e, issue: 'question' });
        await banc.apresVerdict({ ...e, scanId: '650000000000000000000009', issue: 'affirmee', idProduct: 1 });
        let b = await banc.balayerAttente(new Date(T0.getTime() + 23 * 3600e3));
        H.v('(4) balayage à 23 h : rien (2 lignes, 2 objets)', [b, (await lignes()).length, client.objets.size], [{ supprimees: 0, echecs: 0 }, 2, 2]);
        client.panne.del = true; const cap2 = capturer();
        b = await banc.balayerAttente(new Date(T0.getTime() + 25 * 3600e3));
        cap2.rendre(); client.panne.del = false;
        H.v('(4) balayage à 25 h, suppression d\'objet ratée : la ligne en attente est conservée (échec compté)', [b, (await lignes()).length], [{ supprimees: 0, echecs: 1 }, 2]);
        b = await banc.balayerAttente(new Date(T0.getTime() + 25 * 3600e3));
        H.v('(4) balayage à 25 h : la ligne en attente et son objet partent, la ligne confirmée reste (1 ligne, 1 objet)', [b, (await lignes()).map(x => x.etat), client.objets.size], [{ supprimees: 1, echecs: 0 }, ['confirmee'], 1]);
        await vider();
    }

    // ═══ (5) la correction : POST /api/banc/correction, de bout en bout par HTTP (faux R2, base en mémoire) ═══
    {
        const { banc, client } = nouveau();
        const app = express(); app.use(express.json());
        const router = express.Router(); monterBanc.routes(router, cfg, { banc }); app.use(router);
        const srv = await H.serveur(app);
        const inst = async () => { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }); await db.col('installations').insertOne(i); return { i, jeton }; };
        const A = await inst(), B = await inst();
        const scan = async (x, hex) => { await db.col('analyses').insertOne({ _id: new mongoose.Types.ObjectId(hex), porteur: `installation:${x.i._id}`, cartes: [{ statut: 'identifiee' }] }); return hex; };
        const S1 = await scan(A, '650000000000000000000011'), S2 = await scan(A, '650000000000000000000012');
        const post = (x, corps) => H.appel(srv.url, '/api/banc/correction', { methode: 'POST', corps, entetes: x ? { authorization: `Bearer ${x.jeton}` } : {} });
        const e = { corps: consentement(), scanId: S1, carte: 0, imageRedressee: image, detectionSure: true };
        await banc.apresVerdict({ ...e, issue: 'affirmee', idProduct: 4242 });
        const ligneS1 = async () => (await lignes()).find(x => x._id === idLigne(S1, 0));
        const avant = JSON.stringify(await lignes());
        let r = await post(null, { scanId: S1, idProduct: 31, ...consentement() });
        H.v('(5) sans Bearer : 401, rien ne change', [r.statut, JSON.stringify(await lignes()) === avant], [401, true]);
        r = await post(B, { scanId: S1, idProduct: 31, ...consentement() });
        H.v('(5) correction par un AUTRE porteur ⇒ 404 CODE_INVALIDE, ligne inchangée', [r.statut, r.json && r.json.erreur && r.json.erreur.code, JSON.stringify(await lignes()) === avant], [404, 'CODE_INVALIDE', true]);
        r = await post(A, { scanId: '650000000000000000000099', idProduct: 31, ...consentement() });
        H.v('(5) scan inconnu ⇒ 404', r.statut, 404);
        for (const [nom, corps] of [['idProduct texte', { idProduct: '31' }], ['idProduct négatif', { idProduct: -3 }], ['idProduct décimal', { idProduct: 1.5 }], ['idProduct absent', {}], ['idProduct null', { idProduct: null }],
            ['carte hors bornes', { idProduct: 31, carte: 500 }], ['scanId mal formé', { idProduct: 31, scanId: 'abc' }]]) {
            r = await post(A, { scanId: S1, ...consentement(), ...corps });
            H.v(`(5) ${nom} ⇒ 400 ENTREE, ligne inchangée`, [r.statut, r.json && r.json.erreur && r.json.erreur.code, JSON.stringify(await lignes()) === avant], [400, 'ENTREE', true]);
        }
        r = await post(A, { scanId: S1, idProduct: 31 });
        H.v('(5) sans consentement dans le corps ⇒ 200 { success:true }, ligne inchangée (la route ne dit pas si la conservation a eu lieu)', [r.statut, r.json, JSON.stringify(await lignes()) === avant], [200, { success: true }, true]);
        r = await post(A, { scanId: S1, idProduct: 31, consentementBanc: { ...consentement().consentementBanc, version: 'v-inconnue' } });
        H.v('(5) consentement invalide ⇒ 200, ligne inchangée', [r.statut, JSON.stringify(await lignes()) === avant], [200, true]);
        r = await post(A, { scanId: S1, idProduct: 31, ...consentement('autre-jeton-abcdefghij99') });
        H.v('(5) consentement valide mais d\'un autre jeton que la ligne ⇒ 200, ligne inchangée', [r.statut, JSON.stringify(await lignes()) === avant], [200, true]);
        r = await post(A, { scanId: S2, idProduct: 31, ...consentement() });
        H.v('(5) scan du porteur SANS ligne (aucune image conservée) ⇒ 200 et AUCUNE ligne créée, aucun objet', [r.statut, (await lignes()).length, client.objets.size], [200, 1, 1]);
        r = await post(A, { scanId: S1, idProduct: 31, ...consentement() });
        const l = await ligneS1();
        H.v('(5) correction valide ⇒ 200, source `correction`, vérité remplacée, confirmée', [r.statut, l.source, l.verite, l.etat], [200, 'correction', 31, 'confirmee']);
        // correction d'une ligne encore en attente : confirmée, objet déplacé
        const S3 = await scan(A, '650000000000000000000013');
        await banc.apresVerdict({ ...e, scanId: S3, issue: 'question' });
        const att = (await lignes()).find(x => x._id === idLigne(S3, 0));
        r = await post(A, { scanId: S3, idProduct: 55, ...consentement() });
        const apres = (await lignes()).find(x => x._id === idLigne(S3, 0));
        H.v('(5) correction d\'une ligne en attente : confirmee/correction, objet déplacé hors d\'attente/', [r.statut, apres.etat, apres.source, apres.verite, client.objets.has(att.cleR2), client.objets.has(apres.cleR2)], [200, 'confirmee', 'correction', 55, false, true]);
        await srv.fermer(); await vider();
        await db.col('installations').deleteMany({}); await db.col('analyses').deleteMany({});
    }

    // ═══ (6) un échec d'écriture ne change jamais la réponse : ne lève pas, rend la main en ≤ TIMEOUT_MS, journal sans contenu ═══
    {
        H.v('(6) le délai par défaut est de 2 s', TIMEOUT_MS, 2000);
        const jeton = 'jeton-test-abcdefghij1234';
        const e = { corps: consentement(jeton), scanId: SCAN, carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true };
        const sansContenu = vus => [SCAN, jeton, 'banc-reel', 'http', IP].map(x => vus.join('\n').includes(x));
        const leve = async f => { try { await f(); return false; } catch { return true; } };
        // R2 qui lève
        let n = nouveau(); n.client.panne.put = true; let cap = capturer();
        let leva = await leve(() => n.banc.apresVerdict(e)); cap.rendre();
        H.v('(6) R2 qui lève : apresVerdict ne lève pas, 0 ligne, 0 objet ; journal sans scanId, jeton, clé, URL, IP', [leva, (await lignes()).length, n.client.objets.size, cap.vus.length > 0, sansContenu(cap.vus)], [false, 0, 0, true, Array(5).fill(false)]);
        // Mongo qui lève à l'insertion : l'objet écrit est défait
        const colCassee = () => ({ insertOne: async () => { throw Object.assign(new Error('Mongo ' + SCAN + ' ' + IP), { code: 'MONGO_HS' }); }, find: () => ({ toArray: async () => [] }), findOne: async () => null, deleteOne: async () => ({}) });
        n = nouveau({ colFn: () => colCassee() }); cap = capturer();
        leva = await leve(() => n.banc.apresVerdict(e)); cap.rendre();
        H.v('(6) Mongo qui lève : ne lève pas, l\'objet déjà écrit est supprimé (0 objet), journal sans contenu (le message de l\'erreur n\'y est pas)', [leva, n.client.objets.size, sansContenu(cap.vus), cap.vus.join().includes(IP)], [false, 0, Array(5).fill(false), false]);
        // R2 qui pend : la main revient dans le délai
        n = nouveau({ delaiMs: 60 }); n.client.panne.pend = true; cap = capturer();
        let t0 = Date.now(); leva = await leve(() => n.banc.apresVerdict(e)); let dt = Date.now() - t0; cap.rendre();
        H.v('(6) R2 qui pend (promesse jamais résolue, délai 60 ms injecté) : rend la main sans lever, bien avant 1 s', [leva, dt < 1000, dt >= 55, (await lignes()).length], [false, true, true, 0]);
        // Mongo qui pend
        const colPend = () => ({ insertOne: () => new Promise(() => { }), find: () => ({ toArray: () => new Promise(() => { }) }), findOne: () => new Promise(() => { }), deleteOne: async () => ({}) });
        n = nouveau({ delaiMs: 60, colFn: () => colPend() }); cap = capturer();
        t0 = Date.now(); leva = await leve(() => n.banc.apresVerdict(e)); dt = Date.now() - t0; cap.rendre();
        H.v('(6) Mongo qui pend : rend la main dans le délai, l\'objet déjà écrit est défait', [leva, dt < 1000, n.client.objets.size], [false, true, 0]);
        // verifierBucket qui pend
        n = nouveau({ delaiMs: 60, verifierBucket: () => new Promise(() => { }) }); cap = capturer();
        t0 = Date.now(); leva = await leve(() => n.banc.apresVerdict(e)); dt = Date.now() - t0; cap.rendre();
        H.v('(6) verifierBucket qui pend : rend la main dans le délai, aucune commande R2', [leva, dt < 1000, n.client.commandes.length], [false, true, 0]);
        // R2 lent qui finit APRÈS le délai : rien ne reste
        let reprend; n = nouveau({ delaiMs: 40 }); n.client.panne.retient = new Promise(r => { reprend = r; });
        const orig = n.client.deposerBinaire.bind(n.client);
        n.client.deposerBinaire = async (b, c, buf, ct) => { await n.client.panne.retient; return orig(b, c, buf, ct); };
        cap = capturer(); await n.banc.apresVerdict(e); reprend(); await attendre(150); cap.rendre();
        H.v('(6) écriture qui aboutit APRÈS le délai : l\'objet est défait, aucune ligne ne survit', [(await lignes()).length, n.client.objets.size], [0, 0]);
        // réponse et correction : mêmes garanties
        n = nouveau(); await n.banc.apresVerdict({ ...e, issue: 'question' }); n.client.panne.put = true; cap = capturer();
        leva = await leve(() => n.banc.apresReponse({ ...e, choix: 'a', idProduct: 7 })); cap.rendre();
        H.v('(6) apresReponse avec R2 qui lève : ne lève pas, la ligne reste en attente avec son objet d\'attente', [leva, (await lignes())[0].etat, n.client.objets.size], [false, 'attente', 1]);
        await vider();
    }

    // ═══ (7) révocation : un consentement non renvoyé à l'analyse suivante ⇒ aucune nouvelle ligne (sans état serveur) ═══
    {
        const { banc, client } = nouveau();
        const e = { scanId: SCAN, carte: 0, issue: 'affirmee', idProduct: 4242, imageRedressee: image, detectionSure: true };
        await banc.apresVerdict({ ...e, corps: consentement() });
        await banc.apresVerdict({ ...e, scanId: '650000000000000000000021', corps: {} });
        await banc.apresVerdict({ ...e, scanId: '650000000000000000000022', corps: undefined });
        H.v('(7) 1 analyse consentie puis 2 sans consentement : une seule ligne, un seul objet', [(await lignes()).length, client.objets.size], [1, 1]);
        // (8) le biais est écrit : le dénominateur par source
        await banc.apresVerdict({ ...e, scanId: '650000000000000000000023', corps: consentement() });
        await banc.apresVerdict({ ...e, scanId: '650000000000000000000024', corps: consentement(), issue: 'question' });
        await banc.apresVerdict({ ...e, scanId: '650000000000000000000025', corps: consentement(), issue: 'question' });
        await banc.apresReponse({ ...e, scanId: '650000000000000000000025', corps: consentement(), choix: 'a', idProduct: 9 });
        await banc.corriger({ ...e, scanId: SCAN, corps: consentement(), idProduct: 12 });
        const st = await banc.statistiquesBanc();
        H.v('(8) statistiquesBanc : dénominateur par source — 1 affirme, 1 reponse, 1 correction (l\'affirmée corrigée change de source), 1 en attente, total 4', st, { confirmees: { affirme: 1, reponse: 1, correction: 1 }, attente: 1, total: 4 });
        H.vrai('(8) aucune clé de taux global dans le bilan', !Object.keys(st).some(k => /taux|ratio|pourcent/i.test(k)));
        await vider();
    }

    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error('❌', e); process.exit(1); });
