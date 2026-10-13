'use strict';
// ETIQUETAGE-B — la photo des scans de l'ADMINISTRATEUR au banc réel, et une ligne anonyme par carte étiquetée (`source: 'etiquette-admin'`).
// Base : la base EN MÉMOIRE du banc. Stockage : le stockage MÉMOIRE de v2/banc/stockage.js (ou un enrobage qui tombe en panne à la demande). Aucun réseau (le téléchargement de la photo est INJECTÉ),
// aucune base réelle, aucun bucket réel. Chaque section est isolée dans un bloc.
const H = require('./_harnais');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const { creerBanc, statistiquesBanc } = require('../banc/routes');
const S = require('../banc/stockage');
const { creerPurge } = require('../banc/purge');
const { creerCatalogue } = require('../identifier/catalogue');
const registre = require('../registre');
const { supprimerCompte } = require('../comptes/service');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const oid = () => new mongoose.Types.ObjectId();
const BUCKET = 'bucket-banc-test', SEL = 'sel-etiquette-b';
const ENV = { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL };
const URL_PHOTO = 'https://images1.vinted.net/t/01_00000_abcdef/f800/1700000000.jpeg';
const attendre = ms => new Promise(r => setTimeout(r, ms));
const jusque = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await attendre(25); } return false; };
const photoJpeg = (w = 600, h = 800, couleur = { r: 200, g: 40, b: 40 }) => sharp({ create: { width: w, height: h, channels: 3, background: couleur } }).jpeg().toBuffer();
const lignes = () => db.col('banc_lignes').find({}).toArray();
const lire = async id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });

(async () => {
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { console.log(`   frontière de fenêtre (1 h) dans ${Math.round(reste / 1000)} s : attente`); await attendre(reste + 2000); } }
    await H.ouvrirBac('test-banc-etiquette-photo.js'); await M.creerIndex();

    const reel = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const catalogue = { lire: async ids => reel.lire(ids) };
    for (const [id, nom] of [[4242, 'Pikachu'], [4343, 'Raichu'], [4444, 'Pichu']]) {
        await db.col('catalogue_produits').insertOne({ idProduct: id, name: nom, idMetacard: id });
        await db.col('numeros_cartes').insertOne({ idProduct: id, slugSet: 'Base-Set', numero: String(id % 100) });
    }

    // le stockage : la mémoire, enrobée pour tomber en panne à la demande
    const mem = S.creerStockageMemoire();
    const panne = { lire: false, ecrire: false, verifier: false };
    const stockage = {
        async verifierBucket() { if (panne.verifier) throw new Error('bucket injoignable'); },
        async ecrire(c, b) { if (panne.ecrire) throw new Error('R2 en panne'); return mem.ecrire(c, b); },
        async supprimer(c) { return mem.supprimer(c); },
        async lire(c) { if (panne.lire) throw new Error('R2 en panne'); return mem.lire(c); },
        async lister() { return mem.lister(); },
        cles: () => mem.cles()
    };
    const banc = creerBanc({ cfg, env: ENV, stockage });
    registre.fournir('banc', banc);
    const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
    const app = express(); app.use(express.json());
    const router = express.Router(); monterBanc.routes(router, cfg, { banc, purge: purgeStub, catalogue }); app.use(router);
    const srv = await H.serveur(app);

    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null, lie = true } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), ...(lie ? { compteId: c._id, generation: 0 } : {}) });
        return { c, jeton, porteur: `compte:${c._id}`, obj: { type: 'compte', id: c._id, administrateur: role === 'administrateur', surface: 'extension' } };
    }
    const ADM = await acteur({ role: 'administrateur' }), USR = await acteur({});
    const CARTES = () => [
        { idProduct: 4242, statut: 'identifiee', raison: null, etat: { retenu: 'NM' }, question: null, zone: null },
        { idProduct: null, statut: 'a-trancher', raison: null, etat: null, question: { code: 'departage', choix: [{ id: 'a', idProduct: 4242 }, { id: 'b', idProduct: 4343 }] }, zone: null },
        { idProduct: null, statut: 'introuvable', raison: 'hors-catalogue', etat: null, question: null, zone: null }
    ];
    const semer = async (a, o = {}) => { const _id = oid(); await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: 'identifiee', cartes: o.cartes || CARTES(), produits: [], facturation: { motif: 'administrateur' }, versionChaine: 'abc123def456', versionModele: 'gemini-x', creeLe: new Date(), expireLe: new Date(Date.now() + 864e5) }); return String(_id); };
    let nIp = 0; const ip = () => ({ 'x-forwarded-for': `10.14.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}` });
    const post = (a, corps) => H.appel(srv.url, '/api/banc/etiquette', { methode: 'POST', corps, entetes: { authorization: `Bearer ${a.jeton}`, ...ip() } });
    const CP = require('../banc/photo-admin');
    const scanner = (a, scanId, o = {}) => CP.apresIdentifierAdmin({ cfg, deps: { telechargerPhoto: o.telecharger || (async () => photoJpeg()) }, req: { entree: { imageUrls: o.urls || [URL_PHOTO] }, body: o.corps || {} }, scanId, porteur: o.porteur || a.obj });
    const CLES_ADMIN = ['_id', 'aucune', 'cleR2', 'etat', 'expireLe', 'le', 'rev', 'reponse', 'source', 'verite', 'versionChaine', 'versionModele'];

    // ═══ 0. la photo : un WebP sans métadonnées, de taille bornée ═══
    {
        const grande = await sharp({ create: { width: 3000, height: 4000, channels: 3, background: { r: 1, g: 2, b: 3 } } }).jpeg().toBuffer();
        const t = await S.traiterPhoto(grande), m = await sharp(t.buffer).metadata();
        H.v('0. une grande photo ressort en WebP, plus grand côté ≤ 1600, sans EXIF', [m.format, Math.max(m.width, m.height) <= 1600, m.exif === undefined], ['webp', true, true]);
        const p = await sharp(await photoJpeg(300, 400)).withMetadata({ exif: { IFD0: { Copyright: 'moi' } } }).jpeg().toBuffer();
        const pt = await sharp((await S.traiterPhoto(p)).buffer).metadata();
        H.v('0. une petite photo n\'est pas agrandie, et ses métadonnées EXIF sont retirées', [pt.width, pt.height, pt.exif === undefined], [300, 400, true]);
        let e1 = null, e2 = null, e3 = null;
        try { await S.traiterPhoto(Buffer.from('pas une image')); } catch (x) { e1 = x.code; }
        try { await S.traiterPhoto(Buffer.alloc(6 * 1024 * 1024)); } catch (x) { e2 = x.code; }
        try { await S.traiterPhoto('texte'); } catch (x) { e3 = x.code; }
        H.v('0. un fichier qui n\'est pas une image, un fichier trop gros, autre chose qu\'un Buffer : refusés (image-refusee)', [e1, e2, e3], ['image-refusee', 'image-refusee', 'image-refusee']);
    }

    // ═══ 1. un non-administrateur : ni photo, ni ligne, même avec un consentement du banc ═══
    {
        const consent = { consentementBanc: { version: cfg.banc.versionsTexte[0], le: new Date().toISOString(), jeton: 'jeton-test-abcdefghij1234' } };
        const S1 = await semer(USR); let appels = 0;
        const avant = mem.cles().length;
        await scanner(USR, S1, { corps: consent, telecharger: async () => { appels++; return photoJpeg(); } });
        const inst = { type: 'installation', id: oid(), administrateur: false, surface: 'extension' };
        await scanner(USR, S1, { porteur: inst, corps: consent, telecharger: async () => { appels++; return photoJpeg(); } });
        // un drapeau périmé : le porteur dit administrateur, la base dit le contraire
        const A2 = await acteur({ role: 'administrateur' }); const S2 = await semer(A2);
        await db.col('comptes').updateOne({ _id: A2.c._id }, { $unset: { role: '' } });
        await scanner(A2, S2, { telecharger: async () => { appels++; return photoJpeg(); } });
        H.v('1. non-administrateur, installation seule, drapeau périmé : le téléchargeur n\'est jamais appelé, aucun objet, aucune photoBanc', [appels, mem.cles().length - avant, (await lire(S1)).photoBanc, (await lire(S2)).photoBanc], [0, 0, undefined, undefined]);
        const r = await post(USR, { scanId: S1, verdict: 'corrige', idProduct: 4242, rev: 1 });
        H.v('1. et l\'étiquette d\'un non-administrateur est un 404 : aucune ligne', [r.statut, (await lignes()).length], [404, 0]);
    }

    // ═══ 2. la photo d'un administrateur : conservée au scan, jamais une URL ailleurs ═══
    {
        const S2 = await semer(ADM); let appels = 0;
        await scanner(ADM, S2, { urls: ['https://exemple.org/p.jpg', URL_PHOTO], telecharger: async () => { appels++; return photoJpeg(); } });
        H.v('2. première URL hors liste blanche : rien n\'est téléchargé, rien n\'est conservé', [appels, (await lire(S2)).photoBanc], [0, undefined]);
        const avant = mem.cles().length;
        await scanner(ADM, S2, { urls: [URL_PHOTO, 'https://images1.vinted.net/autre.jpg'] });
        const an = await lire(S2);
        H.v('2. administrateur : un objet WebP au banc, `analyses.photoBanc.cle` en forme de clé du banc, aucune ligne encore (une carte non étiquetée n\'a pas de vérité)', [mem.cles().length - avant, S.PREFIXE && /^banc-reel\/v2\/[0-9a-f]{32}\.webp$/.test(an.photoBanc && an.photoBanc.cle), (await lignes()).length], [1, true, 0]);
        const m = await sharp(await mem.lire(an.photoBanc.cle)).metadata();
        H.v('2. l\'objet est un WebP', m.format, 'webp');
        const k = an.photoBanc.cle;
        await scanner(ADM, S2);
        H.v('2. un second passage pour le même scan ne duplique pas l\'objet (la première photo reste)', [mem.cles().length - avant, (await lire(S2)).photoBanc.cle === k], [1, true]);
        // téléchargement ou stockage en panne : le scan n'a pas de photo, rien ne plante
        const S3 = await semer(ADM); panne.ecrire = true;
        await scanner(ADM, S3); panne.ecrire = false;
        const S4 = await semer(ADM);
        await scanner(ADM, S4, { telecharger: async () => { throw new Error('404'); } });
        await scanner(ADM, S4, { telecharger: async () => Buffer.from('pas une image') });
        H.v('2. stockage en panne, téléchargement en échec, fichier qui n\'est pas une image : pas de photoBanc, pas d\'objet, pas d\'exception', [(await lire(S3)).photoBanc, (await lire(S4)).photoBanc, mem.cles().length - avant], [undefined, undefined, 1]);
    }

    // ═══ 3. l'étiquette crée la ligne : une carte, une ligne ; une photo ; la ligne n'a que ses champs ═══
    let SCAN, CLE;
    {
        SCAN = await semer(ADM); await scanner(ADM, SCAN);
        CLE = (await lire(SCAN)).photoBanc.cle;
        const nObjets = mem.cles().length;
        let r = await post(ADM, { scanId: SCAN, carte: 0, verdict: 'juste', rev: 1 });
        H.v('3. « juste » : l\'étiquette est écrite et la réponse dit banc: ecrit', [r.statut, r.json.etat, r.json.banc], [200, 'ecrit', 'ecrit']);
        const l = await lignes();
        const ligne = l.find(x => x.source === 'etiquette-admin' && x.cleR2 === CLE);
        H.vrai('3. une ligne `etiquette-admin` porte la clé de la photo', ligne);
        H.v('3. liste fermée des champs de la ligne', Object.keys(ligne).sort(), [...CLES_ADMIN].filter(c => c !== 'aucune').sort());
        H.v('3. la vérité (l\'idProduct affirmé), l\'état, la révision, les versions', [ligne.verite, ligne.etat, ligne.rev, ligne.versionModele, ligne.versionChaine], [4242, 'confirmee', 1, 'gemini-x', 'abc123def456']);
        H.v('3. la réponse d\'origine : statut, idProduct affirmé, candidats vides, pas de code de question', ligne.reponse, { statut: 'identifiee', idProduct: 4242, candidats: [], questionCode: null });
        const brut = JSON.stringify(ligne);
        H.vrai('3. la ligne ne contient ni le scanId, ni l\'identifiant du compte, ni l\'installation, ni une URL, ni « vinted »', ![SCAN, String(ADM.c._id), 'http', 'vinted', 'jetonEmpreinte'].some(x => brut.includes(x)));
        H.vrai('3. `_id` = une empreinte de 64 hexadécimaux, `le` au jour UTC, `expireLe` dans bancMois', /^[0-9a-f]{64}$/.test(ligne._id) && ligne.le.getTime() % 86400e3 === 0 && ligne.expireLe > ligne.le);
        H.v('3. l\'analyse est marquée banc: ecrit, plus rien en attente', [(await lire(SCAN)).cartes[0].etiquetteAdmin.banc, (await lire(SCAN)).bancAttente], ['ecrit', undefined]);
        // une seconde étiquette (rev plus grand) MET À JOUR la même ligne ; la photo n'est pas dupliquée
        r = await post(ADM, { scanId: SCAN, carte: 0, verdict: 'corrige', idProduct: 4343, rev: 2 });
        const l2 = (await lignes()).filter(x => x.source === 'etiquette-admin');
        H.v('4. un rev plus grand : la ligne est mise à jour (une seule ligne, vérité 4343, rev 2), la réponse d\'origine reste, la photo n\'est pas dupliquée', [r.json.banc, l2.length, l2[0].verite, l2[0].rev, l2[0].reponse.idProduct, l2[0].cleR2 === CLE, mem.cles().length - nObjets], ['ecrit', 1, 4343, 2, 4242, true, 0]);
        r = await post(ADM, { scanId: SCAN, carte: 0, verdict: 'corrige', idProduct: 4343, rev: 2 });
        H.v('4. rejouer le même rev : `rejoue`, banc: ecrit, rien ne bouge', [r.json.etat, r.json.banc, (await lignes()).filter(x => x.source === 'etiquette-admin').length], ['rejoue', 'ecrit', 1]);
        r = await post(ADM, { scanId: SCAN, carte: 0, verdict: 'corrige', idProduct: 4343, rev: 1 });
        H.v('4. un rev périmé est refusé (409) et la ligne garde le rev 2', [r.statut, (await lignes()).find(x => x.source === 'etiquette-admin').rev], [409, 2]);
        // « aucune »
        r = await post(ADM, { scanId: SCAN, carte: 0, verdict: 'corrige', aucune: 'pas-une-carte', rev: 3 });
        const l3 = (await lignes()).find(x => x.source === 'etiquette-admin');
        H.v('4. « aucune » : vérité nulle, `aucune` posé, champs fermés', [r.json.banc, l3.verite, l3.aucune, Object.keys(l3).sort().every(c => CLES_ADMIN.includes(c))], ['ecrit', null, 'pas-une-carte', true]);
        r = await post(ADM, { scanId: SCAN, carte: 0, verdict: 'corrige', idProduct: 4444, rev: 4 });
        H.v('4. puis un idProduct : `aucune` est retiré', [(await lignes()).find(x => x.source === 'etiquette-admin').aucune, (await lignes()).find(x => x.source === 'etiquette-admin').verite], [undefined, 4444]);
    }

    // ═══ 5. un lot de 3 cartes : 3 lignes, UNE photo ═══
    let LOT;
    {
        LOT = await semer(ADM); const avant = mem.cles().length;
        await scanner(ADM, LOT);
        const cle = (await lire(LOT)).photoBanc.cle;
        const r0 = await post(ADM, { scanId: LOT, carte: 0, verdict: 'juste', rev: 1 });
        const r1 = await post(ADM, { scanId: LOT, carte: 1, verdict: 'corrige', idProduct: 4343, rev: 1 });
        const r2 = await post(ADM, { scanId: LOT, carte: 2, verdict: 'corrige', aucune: 'hors-catalogue', rev: 1 });
        const l = (await lignes()).filter(x => x.cleR2 === cle);
        H.v('5. trois cartes étiquetées : trois lignes, trois ids distincts, une seule photo (un objet), toutes `ecrit`', [r0.json.banc, r1.json.banc, r2.json.banc, l.length, new Set(l.map(x => x._id)).size, mem.cles().length - avant], ['ecrit', 'ecrit', 'ecrit', 3, 3, 1]);
        const q = l.find(x => x.reponse.statut === 'a-trancher');
        H.v('5. la réponse d\'origine d\'une question : ids des candidats et code de la question', q && q.reponse, { statut: 'a-trancher', idProduct: null, candidats: [4242, 4343], questionCode: 'departage' });
        const i = l.find(x => x.reponse.statut === 'introuvable');
        H.v('5. la réponse d\'origine d\'un introuvable : statut seul', i && [i.reponse, i.aucune, i.verite], [{ statut: 'introuvable', idProduct: null, candidats: [], questionCode: null }, 'hors-catalogue', null]);
    }

    // ═══ 6. les pannes : l'étiquette s'écrit TOUJOURS ; la ligne est reprise, jamais présentée complète sans photo ═══
    {
        // 6a. le bucket lit mal au moment d'étiqueter
        const S6 = await semer(ADM); await scanner(ADM, S6); panne.lire = true;
        const nLignes = (await lignes()).length;
        let r = await post(ADM, { scanId: S6, carte: 0, verdict: 'juste', rev: 1 });
        let an = await lire(S6);
        H.v('6a. bucket en panne : l\'étiquette est écrite (200 ecrit), banc: en-attente, aucune ligne, marque en attente sur l\'analyse', [r.statut, r.json.etat, r.json.banc, (await lignes()).length - nLignes, an.cartes[0].etiquetteAdmin.verdict, an.cartes[0].etiquetteAdmin.banc, an.bancAttente], [200, 'ecrit', 'en-attente', 0, 'juste', 'en-attente', true]);
        r = await post(ADM, { scanId: S6, carte: 0, verdict: 'juste', rev: 1 });
        H.v('6a. rejouer pendant la panne : rejoue, toujours en-attente', [r.json.etat, r.json.banc], ['rejoue', 'en-attente']);
        const rien = await banc.reprendreEtiquettes();
        H.v('6a. la reprise pendant la panne ne produit rien (1 restante au moins)', [rien.ecrites, rien.restantes >= 1, (await lignes()).length - nLignes], [0, true, 0]);
        panne.lire = false;
        const rep = await banc.reprendreEtiquettes();
        an = await lire(S6);
        H.v('6a. la panne finie, la reprise écrit la ligne et la photo est la bonne ; la marque tombe', [rep.ecrites, (await lignes()).length - nLignes, (await lignes()).filter(x => x.cleR2 === an.photoBanc.cle).length, an.cartes[0].etiquetteAdmin.banc, an.bancAttente], [1, 1, 1, 'ecrit', undefined]);
        // 6b. le bucket est injoignable à la vérification
        const S7 = await semer(ADM); await scanner(ADM, S7);
        const B2 = creerBanc({ cfg, env: ENV, stockage });
        panne.verifier = true;
        const n2 = (await lignes()).length;
        const sv2 = await etiqueterAvec(B2, S7);
        panne.verifier = false;
        H.v('6b. verifierBucket échoue : banc: en-attente, aucune ligne', [sv2, (await lignes()).length - n2], ['en-attente', 0]);
        // 6c. variable absente : le banc est désactivé, l'étiquette passe quand même
        const S8 = await semer(ADM);
        const B3 = creerBanc({ cfg, env: {}, stockage });
        const sv3 = await etiqueterAvec(B3, S8);
        H.v('6c. V2_BANC_BUCKET et V2_BANC_SEL absentes : banc: en-attente, aucune ligne, aucune exception', [sv3, (await lignes()).length - n2], ['en-attente', 0]);
        // 6d. un scan SANS photo (téléchargement raté) : jamais une ligne sans photo
        const S9 = await semer(ADM);
        const r9 = await post(ADM, { scanId: S9, carte: 0, verdict: 'juste', rev: 1 });
        H.v('6d. scan sans photo : étiquette écrite, banc: en-attente, aucune ligne sans photo', [r9.statut, r9.json.banc, (await lignes()).filter(x => !x.cleR2).length, (await lignes()).length - n2], [200, 'en-attente', 0, 0]);
        // 6e. un objet disparu du bucket : pas de ligne qui promet une photo absente
        const S10 = await semer(ADM); await scanner(ADM, S10);
        await mem.supprimer((await lire(S10)).photoBanc.cle);
        const r10 = await post(ADM, { scanId: S10, carte: 0, verdict: 'juste', rev: 1 });
        H.v('6e. l\'objet n\'existe plus : banc: en-attente, aucune ligne', [r10.json.banc, (await lignes()).length - n2], ['en-attente', 0]);
    }
    async function etiqueterAvec(b, scanId) {
        // l'étiquette d'ETIQUETAGE-A écrite à la main, puis le banc interrogé directement
        await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(scanId) }, { $set: { 'cartes.0.etiquetteAdmin': { verdict: 'juste', idProduct: 4242, rev: 1, le: new Date(), versionModele: 'gemini-x', versionChaine: 'abc123def456' } } });
        return b.etiquetteAdmin({ scanId, carte: 0 });
    }

    // ═══ 7. durées : la purge, le partage d'un objet entre lignes, le filet des orphelins ═══
    {
        const T = new Date(Date.now() + 4 * 86400e3);       // « maintenant » du scénario : dans 4 jours (tous les objets, même ceux créés pendant ce bloc, ont plus de 48 h)
        const purge = creerPurge({ cfg, env: ENV, stockage, horloge: () => T });
        // le lot (3 lignes, 1 objet) : on fait échoir UNE ligne, l'objet reste pour les deux autres
        const cle = (await lire(LOT)).photoBanc.cle;
        const trois = (await lignes()).filter(x => x.cleR2 === cle);
        await db.col('banc_lignes').updateOne({ _id: trois[0]._id }, { $set: { expireLe: new Date(T.getTime() - 1000) } });
        let b = await purge.purgerBanc(T);
        H.v('7. une ligne échue sur trois : elle part, l\'objet RESTE (les deux autres le portent)', [(await lignes()).filter(x => x.cleR2 === cle).length, mem.cles().includes(cle), b.echecs], [2, true, 0]);
        await db.col('banc_lignes').updateMany({ cleR2: cle }, { $set: { expireLe: new Date(T.getTime() - 1000) } });
        b = await purge.purgerBanc(T);
        H.v('7. les trois échues : lignes ET objet partent', [(await lignes()).filter(x => x.cleR2 === cle).length, mem.cles().includes(cle)], [0, false]);
        // le filet : un objet vieux, sans ligne, MAIS référencé par une analyse (photo d'un scan pas encore étiqueté) : gardé ; l'analyse partie : supprimé
        const SN = await semer(ADM); await scanner(ADM, SN);
        const cn = (await lire(SN)).photoBanc.cle;
        b = await purge.purgerBanc(T);
        H.v('7. objet de 48 h sans ligne mais référencé par `analyses.photoBanc` (scan non étiqueté) : gardé', mem.cles().includes(cn), true);
        await db.col('analyses').deleteOne({ _id: new mongoose.Types.ObjectId(SN) });
        b = await purge.purgerBanc(T);
        H.v('7. l\'analyse partie (rétention ou compte supprimé) : l\'objet orphelin est supprimé par le filet', [mem.cles().includes(cn), b.orphelins >= 1], [false, true]);
        // le filet ne supprime rien quand les analyses sont illisibles
        const SM = await semer(ADM); await scanner(ADM, SM); await db.col('analyses').deleteOne({ _id: new mongoose.Types.ObjectId(SM) });
        const cm = mem.cles().filter(c => c !== undefined);
        const colPanne = n => (n === 'analyses' ? { find: () => { throw new Error('mongo muet'); } } : db.col(n));
        const purge2 = creerPurge({ cfg, env: ENV, stockage, horloge: () => T, colFn: colPanne });
        const nAvant = mem.cles().length;
        await purge2.purgerBanc(T);
        H.v('7. analyses illisibles : AUCUN orphelin supprimé (on ne sait pas)', mem.cles().length, nAvant);
        await purge.purgerBanc(T);
        void cm;
    }

    // ═══ 8. l'anonymisation à 12 mois : la copie garde la vérité et la réponse d'origine, perd le lien ═══
    {
        const AN = await semer(ADM); await scanner(ADM, AN);
        const cle = (await lire(AN)).photoBanc.cle;
        for (const [c, corps] of [[0, { verdict: 'juste' }], [1, { verdict: 'corrige', idProduct: 4343 }], [2, { verdict: 'corrige', aucune: 'pas-une-carte' }]]) await post(ADM, { scanId: AN, carte: c, rev: 1, ...corps });
        const avant = (await lignes()).filter(x => x.cleR2 === cle);
        const T = new Date();
        const vieux = new Date(T.getTime() - 14 * 31 * 86400e3);
        await db.col('banc_lignes').updateMany({ cleR2: cle }, { $set: { le: new Date(Date.UTC(vieux.getUTCFullYear(), vieux.getUTCMonth(), vieux.getUTCDate())) } });
        await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(AN) }, { $set: { creeLe: vieux } });
        const purge = creerPurge({ cfg, env: ENV, stockage, horloge: () => T });
        const bilan = await purge.anonymiserLiens(T);
        const apres = (await lignes()).filter(x => x.anonyme === true);
        const copies = apres.filter(x => x.source === 'etiquette-admin');
        H.v('8. trois lignes avant, trois copies anonymes après, chacune avec SA copie de la photo ; l\'ancienne photo partagée est supprimée', [avant.length, copies.length, new Set(copies.map(x => x.cleR2)).size, copies.every(x => mem.cles().includes(x.cleR2)), mem.cles().includes(cle), bilan.echecs], [3, 3, 3, true, false, 0]);
        const brut = JSON.stringify(copies);
        H.vrai('8. la copie ne porte ni jour, ni jeton, ni scanId ; elle garde la vérité, `aucune`, la réponse d\'origine, la révision et les versions', !brut.includes('"le"') && !brut.includes(AN) && copies.some(x => x.verite === 4343 && x.reponse.statut === 'a-trancher' && x.reponse.candidats.length === 2) && copies.some(x => x.aucune === 'pas-une-carte' && x.verite === null) && copies.every(x => x.rev === 1 && x.versionModele === 'gemini-x' && x.versionChaine === 'abc123def456'));
        H.vrai('8. et seulement des clés permises (liste fermée + anonyme)', copies.every(x => Object.keys(x).every(c => [...CLES_ADMIN, 'anonyme'].includes(c) && c !== 'le')));
        H.v('8. l\'analyse de cet âge est supprimée avec le lien', [await db.col('analyses').countDocuments({ _id: new mongoose.Types.ObjectId(AN) })], [0]);
    }

    // ═══ 9. l'effacement du compte de l'administrateur : le lien est coupé comme pour toute ligne ═══
    {
        const A = await acteur({ role: 'administrateur' }); const S9 = await semer(A); await scanner(A, S9);
        await post(A, { scanId: S9, carte: 0, verdict: 'juste', rev: 1 });
        const cle = (await lire(S9)).photoBanc.cle;
        const compte = await db.col('comptes').findOne({ _id: A.c._id });
        const sup = await supprimerCompte({ compte, motDePasse: 'mot-de-passe-du-banc', renonciation: true, cfg });
        const reste = (await lignes()).filter(x => x.cleR2 === cle);
        H.v('9. compte supprimé : l\'analyse (seul lien vers le scan) a disparu ; la ligne anonyme reste sans aucun identifiant de compte', [sup.statut, await lire(S9), reste.length, JSON.stringify(reste).includes(String(A.c._id))], [200, null, 1, false]);
        const T = new Date(Date.now() + 3 * 86400e3);
        await purgerLaLigne(reste[0], T, cle);
    }
    async function purgerLaLigne(l, T, cle) {
        await db.col('banc_lignes').updateOne({ _id: l._id }, { $set: { expireLe: new Date(T.getTime() - 1000) } });
        await creerPurge({ cfg, env: ENV, stockage, horloge: () => T }).purgerBanc(T);
        H.v('9. la purge suit son cours : ligne et objet partent à l\'échéance', [(await lignes()).filter(x => x.cleR2 === cle).length, mem.cles().includes(cle)], [0, false]);
    }

    // ═══ 10. les statistiques comptent la source ═══
    {
        const st = await statistiquesBanc();
        const n = (await lignes()).filter(x => x.source === 'etiquette-admin' && x.etat === 'confirmee').length;
        H.v('10. `statistiquesBanc` compte `etiquette-admin` (confirmées), sans casser les autres', [st.confirmees['etiquette-admin'], n > 0, st.confirmees.affirme, st.total], [n, true, 0, (await lignes()).length]);
    }

    // ═══ 11. de bout en bout par la VRAIE route /api/identifier (chaîne fabriquée) : l'administrateur est photographié, le client non, la réponse ne change pas ═══
    {
        const pret = require('../pret'), { dansUnScan } = require('../../sources'), { assembler } = require('../index');
        const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
        const chaine = async (req, res) => res.json({ success: true, carte: { idProduct: 4242, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '58', total: '102', setCode: 'BS', rarete: null, langue: 'FR', ambigu: false }, etat: ETAT, candidats: [], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2, scanId: String(req.scanIdImpose) });
        const nTel = { n: 0 };
        const app2 = express(); app2.set('trust proxy', true); app2.use(express.json()); app2.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app2.use(assembler([require('../argent/monter'), require('../identifier/monter'), monterBanc], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), banc, purge: purgeStub, catalogue, telechargerPhoto: async () => { nTel.n++; return photoJpeg(); } }));
        const sv2 = await H.serveur(app2);
        try {
            const corps = { contrat: 2, imageUrls: [URL_PHOTO], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' };
            const ent = a => ({ origin: cfg.origines.extension, authorization: `Bearer ${a.jeton}` });
            const A = await acteur({ role: 'administrateur' });
            await db.col('comptes').updateOne({ _id: A.c._id }, { $set: { 'solde.achete': 0 } });
            const avant = mem.cles().length;
            const sc = await H.appel(sv2.url, '/api/identifier', { methode: 'POST', corps, entetes: { ...ent(A), 'x-forwarded-for': '10.7.7.7', 'idempotency-key': 'etiq-photo-0000001' } });
            await jusque(async () => (await lire(sc.json.scanId)).photoBanc);
            const photo = (await lire(sc.json.scanId)).photoBanc;
            H.v('11. administrateur : /api/identifier répond comme avant (aucun champ nouveau), puis la photo est conservée, hors de la réponse', [sc.statut, sc.json.analyse.cartes[0].statut, Object.keys(sc.json).sort(), photo ? true : false, mem.cles().length - avant, JSON.stringify(sc.json).includes('photoBanc')], [200, 'identifiee', ['analyse', 'contrat', 'facturation', 'scanId', 'success'].concat(sc.json.solde !== undefined ? ['solde'] : []).sort(), true, 1, false]);
            const r = await H.appel(sv2.url, '/api/banc/etiquette', { methode: 'POST', corps: { scanId: sc.json.scanId, verdict: 'juste', rev: 1 }, entetes: { ...ent(A), 'x-forwarded-for': '10.7.7.8' } });
            H.v('11. puis « juste » : banc: ecrit, une ligne `etiquette-admin` avec la vérité de la réponse', [r.statut, r.json.banc, (await lignes()).filter(x => x.cleR2 === photo.cle).map(x => [x.source, x.verite])], [200, 'ecrit', [['etiquette-admin', 4242]]]);
            // un client ordinaire : même route, aucune photo
            const U = await acteur({}); await db.col('comptes').updateOne({ _id: U.c._id }, { $set: { 'solde.offert': 5 } });
            const t0 = nTel.n;
            const su = await H.appel(sv2.url, '/api/identifier', { methode: 'POST', corps, entetes: { ...ent(U), 'x-forwarded-for': '10.7.7.9', 'idempotency-key': 'etiq-photo-0000002' } });
            await attendre(300);
            H.v('11. client ordinaire : scan servi (200), aucun téléchargement de photo, aucune photoBanc', [su.statut, nTel.n - t0, su.json && su.json.scanId ? (await lire(su.json.scanId)).photoBanc : 'pas de scanId'], [200, 0, undefined]);
        } finally { await sv2.fermer(); }
    }

    await srv.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
