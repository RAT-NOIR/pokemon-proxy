'use strict';
// B7b.1 ruling 8 — REJEU D'INTÉGRATION B6 × B9 (porté du registre). B6.4 a câblé le crochet du banc réel dans traiterIdentifier / traiterReponse, que le scanner du site RÉUTILISE.
// Question : un consentement VALIDE présenté au scanner par TOUS les moyens possibles peut-il faire écrire une image au banc ? Réponse attendue : non — `banc_lignes` reste à 0, le stockage
// du banc ne reçoit AUCUNE commande, le détecteur n'est jamais appelé. CONTRÔLE POSITIF : le même scénario par l'extension (POST /api/identifier, consentement dans le corps) écrit 1 ligne.
// Base : la base EN MÉMOIRE du banc (INT2). Stockage : un faux en mémoire dont CHAQUE appel est compté. Détecteur : un faux (deps.detection). Aucun réseau, aucun R2.
const H = require('./_harnais');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const CHARGES = path.join(__dirname, '..', '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const EXT = cfg.origines.extension, SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
let nIp = 0;
const ip = () => ({ 'x-forwarded-for': `10.71.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}` });
const ID_A = 895789, ID_B = 895790, EXP = 990001;
const JETON_CONSENTEMENT = 'jeton-de-banc-abcdefghij1234';
const consentement = () => ({ version: cfg.banc.versionsTexte[0], le: new Date().toISOString(), jeton: JETON_CONSENTEMENT });

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-integration-banc-scanner.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const sharp = require('sharp');
    const JPEG = await sharp(crypto.randomBytes(24 * 24 * 3), { raw: { width: 24, height: 24, channels: 3 } }).jpeg().toBuffer();
    const CARTE = await sharp({ create: { width: 640, height: 894, channels: 3, background: { r: 30, g: 120, b: 60 } } }).jpeg().toBuffer();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante, trend] of [[ID_A, 'normale', 1.0], [ID_B, 'reverse', 2.5]]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: 0.5, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
        await raw('visuels').insertOne({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990101, numero: '001', rarete: 'Common', total: '064', variante, setNom: 'Banc Set', lien: null });
    }

    // ── le banc réel, avec un stockage dont CHAQUE commande est comptée (verifierBucket n'est pas une commande de données)
    const { creerBanc } = require('../banc/routes'); const { creerStockageMemoire } = require('../banc/stockage');
    const commandes = [];
    const memoire = creerStockageMemoire();
    const stockage = new Proxy(memoire, { get(t, p) { const v = t[p]; return typeof v === 'function' && p !== 'verifierBucket' ? (...a) => { commandes.push(String(p)); return v.apply(t, a); } : v; } });
    const banc = creerBanc({ cfg, env: { V2_BANC_SEL: 'sel-du-banc-b7b', V2_BANC_BUCKET: 'bucket-banc-b7b' }, stockage });
    const registre = require('../registre'); registre.fournir('banc', banc);
    registre.fournir('courrier', require('../comptes/courrier').creerCourrierMemoire()); registre.fournir('turnstile', { verifier: async () => true });

    // ── le serveur : tous les lots, la chaîne héritée FABRIQUÉE, un détecteur FAUX qui compte ses appels
    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler, LOTS } = require('../index');          // LOTS : la liste de v2/index.js, UNE seule définition
    let mode = 'affirmee', detectionAppels = 0;
    const affirme = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        if (mode === 'affirmee') return res.json({ ...affirme(ID_A), scanId: sid });
        await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [ID_A, ID_B] });
        return res.json({ ...affirme(ID_A), scanId: sid, question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...affirme(ID_A).carte, ambigu: true },
            candidats: [ID_A, ID_B].map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
    };
    const detection = async () => { detectionAppels++; return { imageRedressee: CARTE, detectionSure: true, versionModele: 'banc-v1' }; };
    const app = express(); app.set('trust proxy', true);
    for (const l of LOTS) l.enTete(app, cfg);
    app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(M.verifierIndex);
    app.use(assembler(LOTS, cfg, { gererIdentifier: chaine, detection }));
    const sv = await H.serveur(app), V = sv.url;

    async function compte() {
        const c = Object.assign(M.nouveauCompte({ email: `i${++nIp}@exemple.fr`, emailCle: `i${nIp}@exemple.fr`, motDePasse: {} }), { verifie: true, solde: { accueil: 25, achete: 0 } });
        await raw('comptes').insertOne(c);
        const s = await require('../comptes/sessions').creerSession(c._id);
        return { c, cookie: `rm_session=${s.token}` };
    }
    async function installation() {
        const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' });
        await raw('installations').insertOne(i); return { i, jeton };
    }
    const lignes = () => raw('banc_lignes').countDocuments({});
    const formulaire = (extra = {}, { nomFichier = 'photo.jpg', source = 'camera' } = {}) => {
        const f = new FormData(); f.append('source', source);
        for (const [k, v] of Object.entries(extra)) f.append(k, v);
        f.append('image', new Blob([JPEG], { type: 'image/jpeg' }), nomFichier); return f;
    };
    const consJson = JSON.stringify({ consentementBanc: consentement() });
    const consSeul = JSON.stringify(consentement());

    // ════ 0. le contrôle de l'instrument : sans rien, le banc est vide et le détecteur n'a jamais été appelé ════
    H.v('départ : banc_lignes 0, commandes de stockage 0, détecteur 0 appel', [await lignes(), commandes.length, detectionAppels], [0, 0, 0]);

    // ════ 1. LE SCANNER, TOUS LES MOYENS ════
    const c = await compte();
    const moyens = [];                                            // { nom, attendu, obtenu }
    const scan = async (nom, attendu, { form = formulaire(), entetes = {}, chemin = '/api/scanner/analyses' } = {}) => {
        const r = await fetch(V + chemin, { method: 'POST', redirect: 'manual', body: form, headers: { origin: SITE, 'x-rat-market': '1', cookie: c.cookie, ...ip(), ...entetes } });
        const t = await r.text(); let json = null; try { json = JSON.parse(t); } catch { /* */ }
        moyens.push({ nom, attendu, obtenu: r.status, detail: json && json.erreur ? `${json.erreur.code}/${json.erreur.detail || ''}` : (json && json.success ? 'ok' : '?') });
        return { statut: r.status, json };
    };
    mode = 'affirmee';
    await scan('champ multipart « consentementBanc » (JSON complet)', 400, { form: formulaire({ consentementBanc: consSeul }) });
    await scan('champ multipart « consentementBanc » (objet englobant)', 400, { form: formulaire({ consentementBanc: consJson }) });
    await scan('champs multipart séparés version / le / jeton', 400, { form: formulaire({ version: cfg.banc.versionsTexte[0], le: new Date().toISOString(), jeton: JETON_CONSENTEMENT }) });
    await scan('champs multipart « consentementBanc[jeton] » …', 400, { form: formulaire({ 'consentementBanc[version]': cfg.banc.versionsTexte[0], 'consentementBanc[le]': new Date().toISOString(), 'consentementBanc[jeton]': JETON_CONSENTEMENT }) });
    await scan('champ multipart « source » = le JSON du consentement', 400, { form: formulaire({}, { source: consJson }) });
    await scan('en-tête X-Consentement-Banc (JSON)', 200, { entetes: { 'x-consentement-banc': consSeul } });
    await scan('en-tête Consentement-Banc (JSON englobant)', 200, { entetes: { 'consentement-banc': consJson } });
    await scan('en-tête Authorization portant le jeton de consentement', 200, { entetes: { 'x-banc-jeton': JETON_CONSENTEMENT } });
    await scan('chaîne de requête ?consentementBanc=…', 200, { chemin: `/api/scanner/analyses?consentementBanc=${encodeURIComponent(consSeul)}&jeton=${JETON_CONSENTEMENT}` });
    await scan('second cookie « consentementBanc » à côté de la session', 200, { entetes: { cookie: `${c.cookie}; consentementBanc=${encodeURIComponent(consJson)}` } });
    await scan('le consentement dans le NOM de fichier de l\'image', 200, { form: formulaire({}, { nomFichier: `${consJson}.jpg` }) });
    // corps JSON au scanner (le consentement dans le corps, comme à l'extension)
    {
        const r = await fetch(V + '/api/scanner/analyses', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-rat-market': '1', cookie: c.cookie, ...ip() }, body: JSON.stringify({ consentementBanc: consentement(), source: 'camera' }) });
        const j = await r.json(); moyens.push({ nom: 'corps JSON {consentementBanc} (comme à l\'extension)', attendu: 400, obtenu: r.status, detail: `${j.erreur && j.erreur.code}/${j.erreur && j.erreur.detail}` });
    }
    // la RÉPONSE à une question, au scanner : JSON, le consentement dans le corps — c'est le seul endroit où le scanner lit un corps JSON
    mode = 'ambigue2';
    const q = await scan('scan à 2 candidats (pour la réponse)', 200);
    mode = 'affirmee';
    {
        const choix = q.json.analyse.cartes[0].question.choix[0].id;
        const r = await fetch(`${V}/api/scanner/analyses/${q.json.scanId}/reponse`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-rat-market': '1', cookie: c.cookie, ...ip() }, body: JSON.stringify({ choix, carte: 0, consentementBanc: consentement() }) });
        const j = await r.json(); moyens.push({ nom: 'réponse du scanner avec {choix, consentementBanc} dans le corps JSON', attendu: 200, obtenu: r.status, detail: j.success ? 'ok' : `${j.erreur && j.erreur.code}` });
    }
    // une correction : la route est celle de l'extension (Bearer) ; une session seule n'y entre pas
    {
        const r = await fetch(V + '/api/banc/correction', { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-rat-market': '1', cookie: c.cookie, ...ip() }, body: JSON.stringify({ scanId: q.json.scanId, idProduct: ID_A, consentementBanc: consentement() }) });
        const j = await r.json(); moyens.push({ nom: 'correction du banc avec la session du scanner (sans Bearer)', attendu: 401, obtenu: r.status, detail: `${j.erreur && j.erreur.code}` });
    }
    // l'effacement de contribution par jeton : sans Bearer, refusé
    {
        const r = await fetch(V + '/api/banc/contributions', { method: 'DELETE', headers: { 'content-type': 'application/json', origin: SITE, 'x-rat-market': '1', cookie: c.cookie, ...ip() }, body: JSON.stringify({ jeton: JETON_CONSENTEMENT }) });
        const j = await r.json(); moyens.push({ nom: 'effacement par jeton avec la session du scanner (sans Bearer)', attendu: 401, obtenu: r.status, detail: `${j.erreur && j.erreur.code}` });
    }
    await attendre(1500);                                         // le crochet n'est jamais attendu : on laisse à une écriture éventuelle le temps d'arriver (une assertion de ZÉRO sans délai ne prouve rien)
    for (const m of moyens) console.log(`   ${m.obtenu === m.attendu ? '·' : '✗'} ${m.nom} → ${m.obtenu} (${m.detail})`);
    H.v(`dénominateur : ${moyens.length} moyens de présenter le consentement au scanner, chacun a rendu le statut attendu`, moyens.filter(m => m.obtenu !== m.attendu).map(m => `${m.nom} : ${m.obtenu} au lieu de ${m.attendu}`), []);
    const acceptes = moyens.filter(m => m.obtenu === 200).length;
    console.log(`   ${moyens.length} requêtes, dont ${acceptes} acceptées par le scanner (analyses débitées) et ${moyens.length - acceptes} refusées`);
    H.vrai('au moins une analyse du scanner est allée jusqu\'au crochet (sinon « 0 ligne » ne dirait rien)', acceptes >= 5);
    H.v('SCANNER : banc_lignes reste à 0', await lignes(), 0);
    H.v('SCANNER : le stockage du banc n\'a reçu AUCUNE commande', commandes, []);
    H.v('SCANNER : le détecteur n\'a jamais été appelé (sans consentement lisible, la photo n\'est même pas regardée)', detectionAppels, 0);

    // ════ 2. CONTRÔLE POSITIF : le même scénario par l'extension écrit UNE ligne ════
    const x = await installation();
    const poster = (corps, entetes = {}) => H.appel(V, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...corps },
        entetes: { origin: EXT, ...ip(), authorization: `Bearer ${x.jeton}`, 'idempotency-key': `banc-int-${Date.now().toString(36)}-${++nIp}`, ...entetes } });
    // d'abord le MÊME consentement présenté par l'en-tête seulement : l'extension non plus ne le lit que dans le CORPS
    const sansCorps = await poster({}, { 'x-consentement-banc': consSeul });
    await attendre(1500);
    H.v('EXTENSION, consentement en en-tête seulement : 200, aucune ligne, aucune commande, détecteur non appelé', [sansCorps.statut, await lignes(), commandes.length, detectionAppels], [200, 0, 0, 0]);
    const avec = await poster({ consentementBanc: consentement() });
    let n = 0; for (let k = 0; k < 60 && !n; k++) { n = await lignes(); if (!n) await attendre(100); }
    H.v('EXTENSION, consentement dans le corps (verdict ferme, détecteur fourni) : 200, UNE ligne', [avec.statut, n], [200, 1]);
    const l = await raw('banc_lignes').findOne({});
    H.v('   la ligne est confirmée, source « affirme », verité = le produit désigné', l && [l.etat, l.source, l.verite], ['confirmee', 'affirme', ID_A]);
    H.vrai('   le stockage a reçu au moins une écriture (le canal d\'observation fonctionne)', commandes.includes('ecrire'));
    H.v('   le détecteur a été appelé UNE fois', detectionAppels, 1);
    // le scanner, après le contrôle positif, n'a toujours rien ajouté : toujours UNE ligne, celle de l'extension, et le jeton de la ligne n'est celui d'aucun compte
    const compteLigne = await raw('banc_lignes').countDocuments({ cleR2: { $exists: true } });
    H.v('TOTAL : une seule ligne dans le banc, venue de l\'extension (dénominateur : 1 ligne, 0 venue du scanner)', [await lignes(), compteLigne], [1, 1]);
    const cles = Object.keys(l || {}).sort();
    H.vrai(`   la ligne n'a que les clés prévues (${cles.join(', ')}) : aucun scanId, compteId, installationId, IP`, !cles.some(k => /scan|compte|install|ip$/i.test(k)));

    // ════ 3. (tour 1, ruling E) LA RÉPONSE DU SCANNER NE CONFIRME JAMAIS UNE LIGNE DU BANC ════
    // Un compte, une installation LIÉE : l'extension et le scanner parlent alors au MÊME porteur (compte:<id>) — le scan de l'un est répondable par l'autre.
    {
        const cc = await compte();
        const jetonLie = J.genererJeton(); const il = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jetonLie), essais: 0, libelle: 'liée' });
        await raw('installations').insertOne({ ...il, compteId: cc.c._id });
        const posterLie = (corps) => H.appel(V, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...corps },
            entetes: { origin: EXT, ...ip(), authorization: `Bearer ${jetonLie}`, 'idempotency-key': `banc-int-${Date.now().toString(36)}-${++nIp}` } });
        mode = 'ambigue2';
        // (a) l'extension crée une ligne « attente » sous le jeton de consentement T
        const avant = await raw('banc_lignes').countDocuments({ etat: 'attente' });
        const s1 = await posterLie({ consentementBanc: consentement() });
        let ligne1 = null; for (let k = 0; k < 60 && !ligne1; k++) { ligne1 = await raw('banc_lignes').findOne({ etat: 'attente' }); if (!ligne1) await attendre(100); }
        H.v('E(a). l\'extension crée UNE ligne « attente » sous le jeton T (question, consentement dans le corps)', [s1.statut, avant, ligne1 && ligne1.etat, ligne1 && ligne1.source], [200, 0, 'attente', 'reponse']);
        const objetsAvant = (await memoire.lister()).map(o => o.cle).sort(), cmdAvant = commandes.length;
        // (b) le SCANNER répond au même scan en portant le jeton T : la ligne reste « attente », aucune copie d'objet
        const choix = s1.json.analyse.cartes[0].question.choix[0].id;
        const rs = await fetch(`${V}/api/scanner/analyses/${s1.json.scanId}/reponse`, { method: 'POST', headers: { 'content-type': 'application/json', origin: SITE, 'x-rat-market': '1', cookie: cc.cookie, ...ip() }, body: JSON.stringify({ choix, carte: 0, consentementBanc: consentement() }) });
        const rj = await rs.json();
        await attendre(1500);
        const ligne1b = await raw('banc_lignes').findOne({ _id: ligne1._id });
        H.v('E(b). réponse du SCANNER portant le jeton T : 200, la question est réglée (le scanner répond normalement)', [rs.status, rj.success, rj.carte && rj.carte.statut], [200, true, 'identifiee']);
        H.v('E(b). …mais la ligne du banc reste « attente », même objet, même source, aucune commande de stockage de plus, aucun objet de plus', [ligne1b.etat, ligne1b.cleR2 === ligne1.cleR2, ligne1b.source, commandes.length - cmdAvant, (await memoire.lister()).map(o => o.cle).sort()], ['attente', true, 'reponse', 0, objetsAvant]);
        // (c) CONTRÔLE POSITIF : la même réponse par l'EXTENSION, sur un second scan (même détecteur, même stockage) confirme la ligne
        const s2 = await posterLie({ consentementBanc: consentement() });
        let ligne2 = null; for (let k = 0; k < 60 && !ligne2; k++) { ligne2 = await raw('banc_lignes').findOne({ etat: 'attente', _id: { $ne: ligne1._id } }); if (!ligne2) await attendre(100); }
        const choix2 = s2.json.analyse.cartes[0].question.choix[0].id;
        const re = await H.appel(V, '/api/identifier/reponse', { methode: 'POST', corps: { scanId: s2.json.scanId, carte: 0, choix: choix2, consentementBanc: consentement() }, entetes: { origin: EXT, ...ip(), authorization: `Bearer ${jetonLie}` } });
        let ligne2b = null; for (let k = 0; k < 60; k++) { ligne2b = await raw('banc_lignes').findOne({ _id: ligne2._id }); if (ligne2b && ligne2b.etat === 'confirmee') break; await attendre(100); }
        H.v('E(c). CONTRÔLE POSITIF : la réponse de l\'EXTENSION (même jeton T) confirme la ligne 2 (« confirmee », nouvel objet)', [re.statut, ligne2b && ligne2b.etat, ligne2b && ligne2b.cleR2 !== ligne2.cleR2], [200, 'confirmee', true]);
        H.v('E(d). au total : la ligne 1 (créée par l\'extension, répondue par le scanner) est toujours en attente ; la ligne 2 est confirmée', [(await raw('banc_lignes').findOne({ _id: ligne1._id })).etat, (await raw('banc_lignes').findOne({ _id: ligne2._id })).etat], ['attente', 'confirmee']);
        mode = 'affirmee';
    }
    require('../identifier/monter').arreterBalayage(); require('../identifier/monter').arreterPurge(); require('../banc/monter').arreterPurge();
    await sv.fermer();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
