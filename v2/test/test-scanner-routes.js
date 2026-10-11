'use strict';
// B9.2 : POST /api/scanner/analyses et /api/scanner/analyses/:id/reponse (le scanner du site, sur la session du compte).
// Base EN MÉMOIRE (INT2), faux réseau seulement. Deux montages :
//   · en processus : la vraie couche argent + traiterIdentifier/traiterReponse, la chaîne héritée FABRIQUÉE (on voit ce qu'elle reçoit) ;
//   · un serveur ENFANT (index.js réel, faux réseau du verrou + data-URL rejoué) : la VRAIE chaîne héritée et ses écritures (journal_scans…).
// ⚠️ Le comportement RÉEL du modèle sur un data-URL n'est pas prouvé ici (§5 Q20) : le faux réseau rejoue une lecture enregistrée.
const H = require('./_harnais');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const SITE = cfg.origines.site, EXT = cfg.origines.extension;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));

// Images RÉELLES (sharp) : le scanner vérifie que l'image se décode (M6). FAUX_JPEG = octets magiques valides, rien de décodable derrière.
let JPEG, PNG, CANARI;                               // CANARI : > 20 Ko de bruit ; son base64 est cherché dans TOUTE la base et dans la sortie de l'enfant (M1)
const bruit = (l, h) => ({ raw: { width: l, height: h, channels: 3 } });
const FAUX_JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), crypto.randomBytes(300)]);
const HEIC = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), crypto.randomBytes(100)]);
const EXE = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(100)]);
const ID_A = 895789, ID_B = 895790, ID_C = 895791, EXP = 990001;
let nIp = 0, nCle = 0;
const toutes = [];                                   // toutes les réponses reçues (assertion 11 : CORS du site sur chacune)

async function semer() {
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante, trend] of [[ID_A, 'normale', 1.0], [ID_B, 'reverse', 2.5], [ID_C, 'normale', null]]) {   // ID_C : AUCUNE ligne au guide
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 + (id === ID_C ? 1 : 0) });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        if (trend !== null) await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: 0.5, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
        await raw('visuels').insertOne({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990101, numero: '001', rarete: 'Common', total: '064', variante, setNom: 'Banc Set', lien: null });
    }
}
async function compte(o = {}) {
    const c = Object.assign(M.nouveauCompte({ email: `s${++nCle}@x.fr`, emailCle: `s${nCle}@x.fr`, motDePasse: {} }), { verifie: true, solde: { accueil: 25, achete: 0 } }, o);
    await raw('comptes').insertOne(c);
    const S = require('../comptes/sessions'); const s = await S.creerSession(c._id);
    return { c, cookie: `rm_session=${s.token}` };
}
async function installationLiee(c) {
    const J = require('../comptes/jetons'); const jeton = J.genererJeton();
    const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'ext' }), { compteId: c._id });
    await raw('installations').insertOne(i); return { i, jeton };
}
const soldeCompte = async c => (await raw('comptes').findOne({ _id: c._id })).solde.accueil;
const nMouv = () => raw('mouvements').countDocuments({});

// ── POST multipart (fetch + FormData : le corps que produira le navigateur)
function formulaire({ image = JPEG, type = 'image/jpeg', source = 'camera', extra = {} } = {}) {
    const f = new FormData();
    if (source !== null) f.append('source', source);
    if (image !== null) f.append('image', new Blob([image], { type }), 'photo.jpg');
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
}
async function scanner(url, cookie, { form = formulaire(), origine = SITE, xrm = '1', entetes = {}, nom, chemin = '/api/scanner/analyses' } = {}) {
    const r = await fetch(url + chemin, { method: 'POST', redirect: 'manual', body: form,
        headers: { ...(cookie ? { cookie } : {}), ...(origine ? { origin: origine } : {}), ...(xrm ? { 'x-rat-market': xrm } : {}), 'x-forwarded-for': `10.8.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}`, ...entetes } });
    const texte = await r.text(); let json = null; try { json = JSON.parse(texte); } catch { /* */ }
    const rep = { statut: r.status, json, texte, entetes: Object.fromEntries(r.headers) };
    toutes.push({ nom, statut: r.status, acao: rep.entetes['access-control-allow-origin'], acac: rep.entetes['access-control-allow-credentials'] });
    return rep;
}
async function repondre(url, cookie, scanId, corps, { origine = SITE, xrm = '1', idPath = scanId, entetes = {}, nom } = {}) {
    const r = await fetch(`${url}/api/scanner/analyses/${idPath}/reponse`, { method: 'POST', redirect: 'manual', body: JSON.stringify(corps),
        headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(origine ? { origin: origine } : {}), ...(xrm ? { 'x-rat-market': xrm } : {}), ...entetes } });
    const texte = await r.text(); let json = null; try { json = JSON.parse(texte); } catch { /* */ }
    toutes.push({ nom, statut: r.status, acao: r.headers.get('access-control-allow-origin'), acac: r.headers.get('access-control-allow-credentials') });
    return { statut: r.status, json, texte, entetes: Object.fromEntries(r.headers) };
}
// ── requête brute (corps maîtrisé octet par octet) : { statut, json, entetes, fermee } ; `ecrire(req)` pilote l'envoi
function brut(urlBase, { cookie, entetes = {}, ecrire, delaiMs = 5000, surReq }) {
    return new Promise(resolve => {
        const u = new URL(urlBase + '/api/scanner/analyses');
        let rep = null, tout = '', fermee = false, erreur = null;
        const req = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: {
            'content-type': 'multipart/form-data; boundary=BBB', origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), 'x-forwarded-for': `10.9.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}`, ...entetes } });
        const fin = () => { let json = null; try { json = JSON.parse(tout); } catch { /* */ } resolve({ statut: rep && rep.statusCode, entetes: rep ? rep.headers : {}, json, get fermee() { return fermee; }, erreur, req }); };   // `fermee` se lit EN DIRECT
        req.on('response', r => { rep = r; r.on('data', d => { tout += d; }); r.on('end', () => { toutes.push({ nom: 'brut', statut: r.statusCode, acao: r.headers['access-control-allow-origin'], acac: r.headers['access-control-allow-credentials'] }); setTimeout(fin, 50); }); });
        req.on('socket', s => s.on('close', () => { fermee = true; }));
        req.on('error', e => { erreur = e.code || e.message; if (!rep) fin(); });
        setTimeout(() => { if (!rep) { req.destroy(); } }, delaiMs).unref();
        if (surReq) surReq(req);
        ecrire(req);
    });
}

// ── parcours de TOUTES les collections de la base en mémoire (assertion 10)
function suspect(v, chemin, sortie) {
    if (v === null || v === undefined) return;
    if (Buffer.isBuffer(v) || (v && v._bsontype === 'Binary')) { sortie.push(`${chemin} : Buffer/Binary`); return; }
    if (typeof v === 'string') { if (/^\s*data:/i.test(v)) sortie.push(`${chemin} : chaîne data:`); else if (v.length > 10 * 1024) sortie.push(`${chemin} : chaîne de ${v.length} caractères`); return; }
    if (Array.isArray(v)) { v.forEach((x, i) => suspect(x, `${chemin}[${i}]`, sortie)); return; }
    if (typeof v === 'object' && !(v instanceof Date) && v._bsontype === undefined) for (const [k, x] of Object.entries(v)) suspect(x, `${chemin}.${k}`, sortie);
}
async function parcourir() {
    const noms = (await mongoose.connection.db.listCollections().toArray()).map(c => c.name).filter(n => !n.startsWith('system.'));
    let docs = 0; const sortie = [];
    for (const n of noms) for (const d of await raw(n).find({}).toArray()) { docs++; suspect(d, n, sortie); }
    return { collections: noms.length, docs, suspects: sortie };
}

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-scanner-routes.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    await semer();
    const sharp = require('sharp');
    JPEG = await sharp(crypto.randomBytes(24 * 24 * 3), bruit(24, 24)).jpeg().toBuffer();
    PNG = await sharp(crypto.randomBytes(16 * 16 * 3), bruit(16, 16)).png().toBuffer();
    CANARI = await sharp(crypto.randomBytes(300 * 300 * 3), bruit(300, 300)).jpeg({ quality: 95 }).toBuffer();
    H.vrai(`fixtures : JPEG ${JPEG.length} o, PNG ${PNG.length} o, canari ${CANARI.length} o (> 20 Ko)`, CANARI.length > 20 * 1024);
    const B64_CANARI = CANARI.toString('base64'), MILIEU_CANARI = B64_CANARI.slice(2000, 2200);

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index'); const cors = require('../transport/cors');
    const SC = require('../scanner/routes');
    let mode = 'affirmee', appelsChaine = 0, dernierBody = null, retard = 0;
    const affirme = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const chaine = async (req, res) => {
        appelsChaine++; dernierBody = req.body;
        if (retard) await attendre(retard);
        if (mode === 'affirmee') return res.json({ ...affirme(ID_A), scanId: String(req.scanIdImpose) });
        if (mode === 'sans-prix') return res.json({ ...affirme(ID_C), scanId: String(req.scanIdImpose) });
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        if (mode === 'ambigue' || mode === 'ambigue-sans-prix') {
            const ids = mode === 'ambigue' ? [ID_A, ID_B] : [ID_A, ID_C];
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            return res.json({ ...affirme(ID_A), scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...affirme(ID_A).carte, ambigu: true },
                candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    const lotFabrique = async req => { appelsChaine++; dernierBody = req.body; return [ID_A, ID_B, ID_C].map(id => ({ statutHttp: 200, corps: { ...affirme(id), scanId: String(req.scanIdImpose) } })); };
    const monter = async (deps = {}, c = cfg) => {
        const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(c)); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter'), require('../scanner/monter')], c, { gererIdentifier: chaine, ...deps }));
        return H.serveur(app);
    };
    const sv = await monter();

    // ═══ (1) EN PREMIER — sans session : 401 SESSION, jamais d'essai sans compte ═══
    {
        const m0 = await nMouv(), a0 = appelsChaine;
        const a = await scanner(sv.url, null, { nom: '1a' });
        H.v('1. sans cookie : 401 SESSION, facturation null', [a.statut, a.json && a.json.erreur && a.json.erreur.code, a.json && a.json.facturation], [401, 'SESSION', null]);
        // une installation non liée (3 essais) présente son JETON, pas de cookie : le scanner ne lui donne JAMAIS d'essai
        const J = require('../comptes/jetons'); const jeton = J.genererJeton();
        const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'x' }); await raw('installations').insertOne(i);
        const b = await scanner(sv.url, null, { nom: '1b', entetes: { authorization: `Bearer ${jeton}` } });
        H.v('   un jeton d\'installation (3 essais) sans cookie : 401 SESSION, essais intacts', [b.statut, b.json.erreur.code, (await raw('installations').findOne({ _id: i._id })).essais], [401, 'SESSION', 3]);
        const bad = await scanner(sv.url, 'rm_session=inconnu-inconnu-inconnu-inconnu', { nom: '1c' });
        H.v('   cookie inconnu : 401 SESSION', [bad.statut, bad.json.erreur.code], [401, 'SESSION']);
        H.v('   aucune chaîne appelée, aucun mouvement', [appelsChaine - a0, await nMouv() - m0], [0, 0]);
        const nv = await compte({ verifie: false, solde: { accueil: 0, achete: 0 } });
        const c = await scanner(sv.url, nv.cookie, { nom: '1d' });
        H.v('   compte non vérifié : 403 VERIFICATION', [c.statut, c.json.erreur.code, c.json.facturation], [403, 'VERIFICATION', null]);
        H.v('   (toujours aucune chaîne appelée, aucun mouvement)', [appelsChaine - a0, await nMouv() - m0], [0, 0]);
        // M3 : un compte NON vérifié dont la base porte 25 « accueil » n'a aucun crédit utilisable : VERIFICATION, rien débité
        const nv25 = await compte({ verifie: false, solde: { accueil: 25, achete: 0 } });
        const c25 = await scanner(sv.url, nv25.cookie, { nom: '1e' });
        H.v('M3. compte non vérifié avec accueil 25 : 403 VERIFICATION, rien débité, chaîne non appelée', [c25.statut, c25.json.erreur.code, await soldeCompte(nv25.c), await nMouv() - m0, appelsChaine - a0], [403, 'VERIFICATION', 25, 0, 0]);
    }

    // ═══ I2a : « peut-il payer ? » se juge AVANT de lire le corps (jamais 12 Mo lus pour un refus d'argent) ═══
    {
        // N2 : un vrai client HTTP envoie 5 Mo ; le refus d'argent (décidé AVANT la lecture) lui arrive COMPLET : le corps est jeté, pas gardé, puis la réponse part normalement
        const envoyer5Mo = req => { let n = 0; const bloc = Buffer.alloc(65536, 3); const pousse = () => { while (n < 80) { n++; if (!req.write(bloc)) return req.once('drain', pousse); } req.end(); }; pousse(); };   // 80 x 64 Kio = 5 Mo
        const taille5Mo = { 'content-length': String(80 * 65536) };
        const nv = await compte({ verifie: false, solde: { accueil: 25, achete: 0 } });
        const vide = await compte({ solde: { accueil: 0, achete: 0 } });
        await raw('hebdo').insertOne({ compteId: vide.c._id, semaine: require('../../acces').semaineISO(new Date()), count: cfg.quotas.hebdo, expireLe: new Date(Date.now() + 86400e3) });   // la poche hebdo de la semaine est épuisée
        require('v8').setFlagsFromString('--expose-gc'); const gc = require('vm').runInNewContext('gc'); const ab = async () => { for (let k = 0; k < 4; k++) { gc(); await attendre(80); } return process.memoryUsage().arrayBuffers; };
        const ab0 = await ab();
        const a = await brut(sv.url, { cookie: nv.cookie, entetes: taille5Mo, delaiMs: 15000, ecrire: envoyer5Mo });
        H.v('N2/I2a. compte non vérifié, client qui envoie 5 Mo : 403 VERIFICATION COMPLET (statut, JSON), connexion non coupée', [a.statut, a.json && a.json.erreur.code, a.json && a.json.facturation, a.erreur, a.entetes.connection !== 'close'], [403, 'VERIFICATION', null, null, true]);
        const b = await brut(sv.url, { cookie: vide.cookie, entetes: taille5Mo, delaiMs: 15000, ecrire: envoyer5Mo });
        H.v('   compte vérifié sans crédit, 5 Mo : 429 QUOTA complet, avec solde, facturation null ET achat.url', [b.statut, b.json && b.json.erreur.code, b.json && b.json.facturation, b.json && b.json.solde && b.json.solde.total, b.json && b.json.achat && typeof b.json.achat.url, b.erreur], [429, 'QUOTA', null, 0, 'string', null]);
        const ab1 = await ab();
        H.vrai(`   mémoire : aucun corps accumulé (arrayBuffers après GC : ${ab0} -> ${ab1}, 10 Mo envoyés)`, ab1 - ab0 < 4 * 1024 * 1024);
        H.v('   la porte n\'a rien gardé', [SC.etatPorte().enCours, SC.etatPorte().comptes], [0, 0]);
        // l'échéance coupe un client trop lent : le refus part (Connection: close) et la socket est détruite
        const svLent = await monter({ scannerDelaiLectureMs: 300 });
        const lent = await brut(svLent.url, { cookie: nv.cookie, entetes: { 'content-length': '5000' }, ecrire: req => { req.write('0123456789'); } });
        for (let k = 0; k < 30 && !lent.fermee; k++) await attendre(100);
        H.v('   client trop lent (10 octets sur 5 000) : à l\'échéance, 403 + Connection: close, socket détruite', [lent.statut, lent.json && lent.json.erreur.code, lent.entetes.connection, lent.fermee], [403, 'VERIFICATION', 'close', true]);
        await svLent.fermer();
        const ad = await compte({ role: 'administrateur', solde: { accueil: 0, achete: 0 } });
        const c = await scanner(sv.url, ad.cookie, { nom: 'I2a-admin' });
        H.v('   un administrateur sans crédit passe (le débit ne lui prend rien)', [c.statut, c.json.facturation.motif], [200, 'administrateur']);
    }

    // ═══ (2) cookie + Origin exacte + X-Rat-Market ═══
    {
        const { c, cookie } = await compte(); const m0 = await nMouv(), a0 = appelsChaine;
        const cas = [['Origin absente', { origine: null }], ['Origin voisine', { origine: SITE + '.evil.fr' }], ['Origin de l\'extension', { origine: EXT }], ['X-Rat-Market absent', { xrm: null }], ['X-Rat-Market=0', { xrm: '0' }]];
        for (const [nom, o] of cas) {
            const r = await scanner(sv.url, cookie, { ...o, nom: '2' });
            H.v(`2. ${nom} : 403 ORIGINE`, [r.statut, r.json && r.json.erreur && r.json.erreur.code], [403, 'ORIGINE']);
        }
        H.v('   aucune chaîne appelée, aucun mouvement, solde 25', [appelsChaine - a0, await nMouv() - m0, await soldeCompte(c)], [0, 0, 25]);
        const r = await repondre(sv.url, cookie, 'a'.repeat(24), { scanId: 'a'.repeat(24), choix: 'a' }, { origine: null, nom: '2r' });
        H.v('   la réponse aussi : sans Origin => 403 ORIGINE', [r.statut, r.json.erreur.code], [403, 'ORIGINE']);
    }

    // ═══ (3) data-URL passé à la chaîne, (4) forme de la réponse ═══
    let compteA, scanAffirme;
    {
        compteA = await compte(); mode = 'affirmee';
        const r = await scanner(sv.url, compteA.cookie, { form: formulaire({ image: CANARI }), nom: '3' }), j = r.json || {};
        const attendu = `data:image/jpeg;base64,${B64_CANARI}`;
        H.v('3. la chaîne héritée reçoit UN data-URL = les octets reçus, en base64', [r.statut, dernierBody.imageUrls.length, dernierBody.imageUrls[0] === attendu], [200, 1, true]);
        H.v('   userId v2:compte:<id> (jamais un portefeuille hérité)', dernierBody.userId, `v2:compte:${compteA.c._id}`);
        const k = j.analyse.cartes[0];
        H.v('4. regleVerdict null, prixLive null', [j.analyse.regleVerdict, k.prixLive], [null, null]);
        H.vrai('   prixGuide rempli ET daté', k.carte.prixGuide && k.carte.prixGuide.tendance === 1 && /^2026-10-04/.test(String(k.carte.prixGuide.date)));
        H.v('   facturation affirmee, solde 25 -> 24', [j.facturation.motif, j.facturation.debite, j.solde.accueil, await soldeCompte(compteA.c)], ['affirmee', 1, 24, 24]);
        scanAffirme = j;
        const a = await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
        H.v('   la ligne analyses est celle du compte, surface scanner', [a.porteur, a.surface], [`compte:${compteA.c._id}`, 'scanner']);
        // formats : PNG ok ; WebP ok
        const p = await scanner(sv.url, compteA.cookie, { form: formulaire({ image: PNG, type: 'image/png', source: 'fichier' }), nom: '3p' });
        H.v('   PNG + source=fichier : 200 et data:image/png', [p.statut, dernierBody.imageUrls[0].startsWith('data:image/png;base64,')], [200, true]);
    }

    // ═══ (5) carte identifiée SANS prix au guide : remboursée, motif sans-prix, UNE fois ═══
    {
        const { c, cookie } = await compte(); mode = 'sans-prix';
        const r = await scanner(sv.url, cookie, { nom: '5' }), j = r.json || {};
        H.v('5. identifiée sans prix au guide : prixGuide null, facturation { debite:0, rembourse:true, motif:sans-prix }', [j.analyse.cartes[0].carte.prixGuide, j.facturation.debite, j.facturation.rembourse, j.facturation.motif], [null, 0, true, 'sans-prix']);
        H.v('   solde revenu à 25 (corps ET base)', [j.solde.accueil, await soldeCompte(c)], [25, 25]);
        const nRb = () => raw('mouvements').countDocuments({ type: 'remboursement', scanId: new mongoose.Types.ObjectId(j.scanId) });
        H.v('   UN seul mouvement de remboursement pour ce scan', await nRb(), 1);
        const argent = registre.obtenir('argent');
        const encore = await argent.rembourser({ type: 'compte', id: c._id, compte: c, installation: null, surface: 'scanner', administrateur: false }, { poche: null }, 'sans-prix', { scanId: new mongoose.Types.ObjectId(j.scanId), compteur: 'question' });
        H.v('   un second remboursement du même scan est refusé par le ledger (deja-rembourse)', [encore.rendu, encore.raisonNonRembourse, await nRb(), await soldeCompte(c)], [false, 'deja-rembourse', 1, 25]);
        // une carte AVEC prix n'est pas remboursée (compte A, étape 3)
        H.v('   une carte avec prix au guide n\'est pas remboursée (scan de l\'étape 3)', [scanAffirme.facturation.rembourse, await raw('mouvements').countDocuments({ type: 'remboursement', scanId: new mongoose.Types.ObjectId(scanAffirme.scanId) })], [false, 0]);
        // l'administrateur : rien débité, rien remboursé
        const ad = await compte({ role: 'administrateur' });
        const x = await scanner(sv.url, ad.cookie, { nom: '5a' });
        H.v('   administrateur : motif administrateur, aucun remboursement', [x.json.facturation.motif, x.json.facturation.rembourse, await soldeCompte(ad.c)], ['administrateur', false, 25]);
    }

    // ═══ (5 bis) O5 : la marque de livraison se clôt en DERNIER, après le remboursement sans-prix (la dernière opération d'argent de la requête) ═══
    {
        const MS = require('../argent/marque-scan'); const argentR = registre.obtenir('argent');
        const rbOrig = argentR.rembourser, closOrig = MS.clore, ordre = [];
        argentR.rembourser = async (p, cr, motif, o) => { ordre.push(`rb:${motif}`); return rbOrig(p, cr, motif, o); };
        MS.clore = async (...a) => { ordre.push('clore'); return closOrig(...a); };
        const { c, cookie } = await compte(); mode = 'sans-prix';
        let r; try { r = await scanner(sv.url, cookie, { nom: '5b' }); } finally { argentR.rembourser = rbOrig; MS.clore = closOrig; }
        await attendre(100);
        const m = await raw('scans_en_cours').findOne({ 'porteur.id': c._id });
        H.v('5b. scanner, carte sans prix : l\'ordre est remboursement sans-prix PUIS clôture de la marque (livre), une seule clôture', [ordre.filter(x => x === 'rb:sans-prix' || x === 'clore'), m && m.etat], [['rb:sans-prix', 'clore'], 'livre']);
        // une carte AVEC prix (aucun remboursement) : c'est le wrapper de réponse qui clôt aussi, la marque est « livre » (D3)
        const c3 = await compte(); mode = 'affirmee';
        const ra = await scanner(sv.url, c3.cookie, { nom: '5c' }); await attendre(100);
        const m3 = await raw('scans_en_cours').findOne({ 'porteur.id': c3.c._id });
        H.v('   scanner, carte AVEC prix : la clôture déposée est exécutée par la réponse : marque « livre »', [ra.statut, m3 && m3.etat], [200, 'livre']);
        mode = 'sans-prix';
        // l'arrêt entre le débit et la clôture : le remboursement sans-prix ne revient jamais (le processus meurt), la marque est ENCORE ouverte — la passe rend le scan en entier
        const c2 = await compte(); let bloque = 0;
        argentR.rembourser = async (p, cr, motif, o) => { if (motif === 'sans-prix') { bloque++; return new Promise(() => { }); } return rbOrig(p, cr, motif, o); };
        const ctl = new AbortController(); let p;
        try {
            p = fetch(sv.url + '/api/scanner/analyses', { method: 'POST', body: formulaire(), signal: ctl.signal, headers: { cookie: c2.cookie, origin: SITE, 'x-rat-market': '1', 'x-forwarded-for': `10.8.7.${++nIp % 250 + 1}` } }).catch(e => e);
            for (let k = 0; k < 100 && !bloque; k++) await attendre(50);
            await attendre(150);
            const mb = await raw('scans_en_cours').findOne({ 'porteur.id': c2.c._id });
            H.v('   le processus « meurt » pendant le remboursement sans-prix : la marque est encore EN SUSPENS (pas close avant le dernier geste d\'argent), le crédit est encore pris (24)', [bloque, mb && mb.etat, await soldeCompte(c2.c)], [1, 'en-suspens', 24]);
            await raw('scans_en_cours').updateOne({ _id: mb._id }, { $set: { ouverteLe: new Date(Date.now() - 20 * 60e3), batLe: new Date(Date.now() - 20 * 60e3) } });
            const bilan = await MS.rattraper({ argent: { rembourser: rbOrig, rembourserLigne: argentR.rembourserLigne } });
            H.v('   la passe rend le scan en entier (solde 25), marque rendu — le scan n\'est ni facturé ni offert à moitié', [await soldeCompte(c2.c), (await raw('scans_en_cours').findOne({ _id: mb._id })).etat, bilan.rendues], [25, 'rendu', 1]);
        } finally { argentR.rembourser = rbOrig; ctl.abort(); if (p) await p; }
    }

    // ═══ (6) lot : la valeur est SOMME des tendances avec couverture — le client la calcule, le serveur ne la sert pas ═══
    {
        const svLot = await monter({ identifierLot: lotFabrique });
        const { c, cookie } = await compte(); const m0 = appelsChaine;
        const r = await scanner(svLot.url, cookie, { nom: '6' }), j = r.json || {};
        H.v('6. lot de 3 photos : statut lot, 3 cartes, un seul appel, coût 1 crédit', [j.analyse && j.analyse.statut, j.analyse.cartes.length, appelsChaine - m0, await soldeCompte(c)], ['lot', 3, 1, 24]);
        const tend = j.analyse.cartes.map(k => k.carte && k.carte.prixGuide ? k.carte.prixGuide.tendance : null);
        const somme = tend.filter(t => t !== null).reduce((s, t) => s + t, 0), couvertes = tend.filter(t => t !== null).length;
        H.v('   le client peut calculer la somme des tendances (3,5) et la couverture (2 / 3) depuis les cartes servies', [somme, couvertes, tend.length], [3.5, 2, 3]);
        H.v('   le serveur ne sert aucune valeur de lot : analyse.lot = les seuls compteurs', Object.keys(j.analyse.lot).sort(), ['aTrancher', 'cartesVues', 'identifiees', 'introuvables', 'lectureLiveMax']);
        H.vrai('   aucune clé de valeur/total dans la réponse entière', !/valeurTotale|totalLot|sommeTendances|"valeur"/.test(r.texte));
        H.v('   un lot n\'est jamais remboursé « sans-prix » (une carte sans prix parmi trois)', [j.facturation.motif, j.facturation.rembourse], ['lot', false]);
        await svLot.fermer();
    }

    // ═══ (7) le MÊME solde que l'extension ═══
    {
        const { c, cookie } = await compte(); mode = 'affirmee';
        const { jeton } = await installationLiee(c);
        const lireExt = async () => (await (await fetch(sv.url + '/api/solde', { method: 'POST', headers: { authorization: `Bearer ${jeton}`, origin: EXT, 'content-type': 'application/json' }, body: '{}' })).json()).solde;
        const avant = await lireExt();
        await scanner(sv.url, cookie, { nom: '7' });
        const apres = await lireExt();
        H.v('7. un débit scanner, puis /api/solde (extension, installation liée) : le total baisse de 1, partage:true, accueil 25 -> 24', [avant.total - apres.total, apres.partage, avant.accueil, apres.accueil], [1, true, 25, 24]);
    }

    // ═══ (8) la réponse à une question suit B1b.5 ═══
    {
        const { c, cookie } = await compte(); mode = 'ambigue';
        const r = await scanner(sv.url, cookie, { nom: '8' }), j = r.json || {};
        H.v('8. ambiguë au scanner : a-trancher, 2 candidats, réservé (debite 0, reserve 1)', [j.analyse.statut, j.analyse.cartes[0].candidats.length, j.facturation.debite, j.facturation.reserve, j.solde.accueil], ['a-trancher', 2, 0, 1, 24]);
        const q = j.analyse.cartes[0].question; const choixA = q.choix[0].id;
        const rep = await repondre(sv.url, cookie, j.scanId, { choix: choixA, carte: 0 }, { nom: '8a' });
        H.v('   répondre « a » (scanId dans le chemin) : 200, carte identifiée, débité UNE fois', [rep.statut, rep.json.carte.statut, rep.json.facturation.debite, rep.json.facturation.motif, await soldeCompte(c)], [200, 'identifiee', 1, 'question', 24]);
        H.v('   la carte rendue n\'a pas de prixLive (null au scanner)', rep.json.carte.prixLive, null);
        const rej = await repondre(sv.url, cookie, j.scanId, { choix: choixA, carte: 0 }, { nom: '8b' });
        H.v('   rejeu de la même réponse : même carte, aucun second débit', [rej.statut, rej.json.carte.statut, await soldeCompte(c)], [200, 'identifiee', 24]);
        const autre = q.choix[1].id;
        const conf = await repondre(sv.url, cookie, j.scanId, { choix: autre }, { nom: '8c' });
        H.v('   une réponse contradictoire : 409 CONFLIT', [conf.statut, conf.json.erreur.code], [409, 'CONFLIT']);
        const aut = await compte();
        const chez = await repondre(sv.url, aut.cookie, j.scanId, { choix: choixA }, { nom: '8d' });
        H.v('   le scan d\'un AUTRE compte : 404 CODE_INVALIDE', [chez.statut, chez.json.erreur.code], [404, 'CODE_INVALIDE']);
        const sans = await repondre(sv.url, null, j.scanId, { choix: choixA }, { nom: '8e' });
        H.v('   sans session : 401 SESSION', [sans.statut, sans.json.erreur.code], [401, 'SESSION']);
        const disc = await repondre(sv.url, cookie, j.scanId, { scanId: 'b'.repeat(24), choix: choixA }, { nom: '8f' });
        H.v('   un scanId du corps différent de celui du chemin : 400 ENTREE', [disc.statut, disc.json.erreur.code], [400, 'ENTREE']);
        const mauv = await repondre(sv.url, cookie, 'pas-un-id', { choix: choixA }, { nom: '8g' });
        H.v('   un identifiant illisible dans le chemin : 400 ENTREE', [mauv.statut, mauv.json.erreur.code], [400, 'ENTREE']);
        // abandon : « aucune » rend le crédit
        const r2 = await scanner(sv.url, cookie, { nom: '8h' });
        const ab = await repondre(sv.url, cookie, r2.json.scanId, { choix: 'aucune' }, { nom: '8i' });
        H.v('   « aucune » : introuvable, crédit rendu (solde 24)', [ab.json.carte.statut, await soldeCompte(c)], ['introuvable', 24]);
    }

    // ═══ M4 : une question répondue par un candidat SANS prix au guide est remboursée « sans-prix », comme une carte identifiée d'emblée ═══
    {
        const { c, cookie } = await compte(); mode = 'ambigue-sans-prix';
        const r = await scanner(sv.url, cookie, { nom: 'M4' }), j = r.json || {};
        const ch = j.analyse.cartes[0].question.choix;
        const sansPrix = ch.find(x => x.idProduct === ID_C).id, avecPrix = ch.find(x => x.idProduct === ID_A).id;
        const nRb = () => raw('mouvements').countDocuments({ type: 'remboursement', scanId: new mongoose.Types.ObjectId(j.scanId) });
        const rep = await repondre(sv.url, cookie, j.scanId, { choix: sansPrix }, { nom: 'M4a' });
        H.v('M4. répondre par le candidat SANS prix : identifiée, prixGuide null, { debite:0, rembourse:true, motif:sans-prix }, solde revenu à 25', [rep.json.carte.statut, rep.json.carte.carte.prixGuide, rep.json.facturation.debite, rep.json.facturation.rembourse, rep.json.facturation.motif, rep.json.solde.accueil, await soldeCompte(c)], ['identifiee', null, 0, true, 'sans-prix', 25, 25]);
        const rej = await repondre(sv.url, cookie, j.scanId, { choix: sansPrix }, { nom: 'M4b' });
        H.v('   le rejeu de la réponse : même facturation, UN seul remboursement, solde 25', [rej.json.facturation, await nRb(), await soldeCompte(c)], [rep.json.facturation, 1, 25]);
        const r2 = await scanner(sv.url, cookie, { nom: 'M4c' });
        const rep2 = await repondre(sv.url, cookie, r2.json.scanId, { choix: r2.json.analyse.cartes[0].question.choix.find(x => x.idProduct === ID_A).id }, { nom: 'M4d' });
        H.v('   répondre par le candidat AVEC prix : pas de remboursement (debite 1, motif question), solde 24', [rep2.json.facturation.debite, rep2.json.facturation.rembourse, rep2.json.facturation.motif, await soldeCompte(c)], [1, false, 'question', 24]);
        void avecPrix;
    }

    // ═══ (9) 120 analyses par heure et par compte ═══
    {
        const { cookie } = await compte(); let dernier = null, passes = 0;
        for (let k = 0; k < 121; k++) {
            const r = await fetch(sv.url + '/api/scanner/analyses', { method: 'POST', headers: { cookie, origin: SITE, 'x-rat-market': '1', 'content-type': 'multipart/form-data; boundary=BBB', 'x-forwarded-for': '10.7.7.7' }, body: '' });
            const t = await r.text(); dernier = { statut: r.status, json: JSON.parse(t), ra: r.headers.get('retry-after'), acao: r.headers.get('access-control-allow-origin') };
            toutes.push({ nom: '9', statut: r.status, acao: dernier.acao, acac: r.headers.get('access-control-allow-credentials') });
            if (r.status !== 429) passes++;
        }
        H.v('9. 121 requêtes en une heure : 120 traitées (corps vide => 422), la 121e est 429 DEBIT avec Retry-After', [passes, dernier.statut, dernier.json.erreur.code, Number(dernier.ra) > 0], [120, 429, 'DEBIT', true]);
    }

    // ═══ rulings 2 et 3 : refus de corps ⇒ rien débité ═══
    {
        const { c, cookie } = await compte(); const m0 = await nMouv(), a0 = appelsChaine;
        const cas = [
            ['415 octets d\'exécutable', formulaire({ image: EXE }), 415, 'IMAGE', 'format'],
            ['M6. 415 octets magiques JPEG valides mais image indécodable', formulaire({ image: FAUX_JPEG }), 415, 'IMAGE', 'format'],
            ['422 partie image vide', formulaire({ image: Buffer.alloc(0) }), 422, 'IMAGE', 'aucune-carte'],
            ['422 aucune partie image', formulaire({ image: null }), 422, 'IMAGE', 'aucune-carte'],
            ['400 source hors liste', formulaire({ source: 'url' }), 400, 'ENTREE', 'source'],
            ['400 un champ de consentement du banc n\'existe pas au scanner', formulaire({ extra: { consentementBanc: '1' } }), 400, 'ENTREE', 'champ-inconnu']
        ];
        for (const [nom, form, st, code, detail] of cas) {
            const r = await scanner(sv.url, cookie, { form, nom: 'r3' });
            H.v(`R3. ${nom} : ${st} ${code}/${detail}, facturation null`, [r.statut, (r.json.erreur || {}).code, (r.json.erreur || {}).detail, r.json.facturation], [st, code, detail, null]);
        }
        const bound = await fetch(sv.url + '/api/scanner/analyses', { method: 'POST', headers: { cookie, origin: SITE, 'x-rat-market': '1', 'content-type': 'multipart/form-data' }, body: 'x' });
        const bj = await bound.json();
        H.v('R2. une boundary absente : 400 ENTREE (jamais 500)', [bound.status, bj.erreur.code], [400, 'ENTREE']);
        // 413 : Content-Length annoncé trop grand — refus avant lecture, Connection: close, socket détruite
        const gros = await brut(sv.url, { cookie, entetes: { 'content-length': String(13 * 1024 * 1024 + 70000) }, ecrire: req => { req.write(Buffer.alloc(2000, 1)); } });
        for (let k = 0; k < 40 && !gros.fermee; k++) await attendre(100);
        H.v('R2. 413 trop-lourde (Content-Length annoncé) : code IMAGE, Connection: close, socket détruite par le serveur', [gros.statut, gros.json && gros.json.erreur.detail, gros.entetes.connection, gros.fermee], [413, 'trop-lourde', 'close', true]);
        const coupe = await brut(sv.url, { cookie, entetes: { 'transfer-encoding': 'chunked' }, delaiMs: 8000, ecrire: req => {
            let n = 0; const bloc = Buffer.alloc(65536, 2);
            const pousse = () => { while (n < 220) { n++; if (!req.write(bloc)) return req.once('drain', pousse); } req.end(); };
            req.on('error', () => { }); pousse(); } });
        for (let k = 0; k < 30 && !coupe.fermee; k++) await attendre(100);
        H.vrai(`R2. 413 sans Content-Length (14 Mo+ par blocs) : réponse 413 reçue, ou connexion coupée par le serveur avant la fin de l'envoi (statut ${coupe.statut || '-'}, erreur ${coupe.erreur || '-'}, socket fermée ${coupe.fermee})`, coupe.statut === 413 || (Boolean(coupe.erreur) && coupe.fermee));
        H.v('R3. 413, 415, 422, 400 : solde inchangé (25), aucun mouvement, aucune chaîne appelée', [await soldeCompte(c), await nMouv() - m0, appelsChaine - a0], [25, 0, 0]);
    }
    // échéance de lecture : 408 ENTREE, Connection: close, socket détruite
    {
        const svLent = await monter({ scannerDelaiLectureMs: 300 });
        const { c, cookie } = await compte();
        const r = await brut(svLent.url, { cookie, entetes: { 'content-length': '5000' }, ecrire: req => { req.write('--BBB\r\n'); } });
        for (let k = 0; k < 30 && !r.fermee; k++) await attendre(100);
        H.v('R2. client trop lent : 408 ENTREE/delai, Connection: close, socket détruite', [r.statut, r.json && r.json.erreur.code, r.json && r.json.erreur.detail, r.entetes.connection, r.fermee], [408, 'ENTREE', 'delai', 'close', true]);
        H.v('   rien débité', await soldeCompte(c), 25);
        await svLent.fermer();
    }

    // ═══ R2 : HEIC DÉCODÉ avant l'IA ═══
    {
        const { c, cookie } = await compte(); mode = 'affirmee';
        const m0 = await nMouv(), a0 = appelsChaine;
        const r = await scanner(sv.url, cookie, { form: formulaire({ image: HEIC, type: 'image/heic' }), nom: 'heic' });
        H.v('R2. HEIC que sharp ne décode pas : 415 IMAGE/format, crédit jamais débité, chaîne non appelée', [r.statut, r.json.erreur.code, r.json.erreur.detail, await soldeCompte(c), await nMouv() - m0, appelsChaine - a0], [415, 'IMAGE', 'format', 25, 0, 0]);
        const decode = JPEG;                                  // une sortie de décodeur DÉCODABLE (N3 : la sortie du décodeur est vérifiée comme une entrée)
        const svH = await monter({ decoderHeic: async b => { if (!b.equals(HEIC)) throw new Error('mauvais octets'); return decode; } });
        const ok = await scanner(svH.url, cookie, { form: formulaire({ image: HEIC, type: 'image/heic' }), nom: 'heic2' });
        H.v('   HEIC décodé : la chaîne reçoit le JPEG DÉCODÉ (data:image/jpeg), jamais les octets HEIC', [ok.statut, dernierBody.imageUrls[0] === `data:image/jpeg;base64,${decode.toString('base64')}`], [200, true]);
        const svE = await monter({ decoderHeic: async () => { throw new Error('échec'); } });
        const ko = await scanner(svE.url, cookie, { form: formulaire({ image: HEIC, type: 'image/heic' }), nom: 'heic3' });
        H.v('   décodage qui échoue : 415 format, pas de second débit (solde 24 après le seul scan réussi)', [ko.statut, ko.json.erreur.detail, await soldeCompte(c)], [415, 'format', 24]);
        const tronque = JPEG.subarray(0, Math.floor(JPEG.length / 2));
        const svT = await monter({ decoderHeic: async () => tronque });
        const kt = await scanner(svT.url, cookie, { form: formulaire({ image: HEIC, type: 'image/heic' }), nom: 'heic4' });
        H.v('N3. une sortie de décodeur HEIC TRONQUÉE : 415 format, aucun second débit (solde 24)', [kt.statut, (kt.json.erreur || {}).detail, await soldeCompte(c)], [415, 'format', 24]);
        await svH.fermer(); await svE.fermer(); await svT.fermer();
    }

    // ═══ N3 : décodabilité réelle (pas seulement l'en-tête) ═══
    {
        const { c, cookie } = await compte(); const m0 = await nMouv();
        for (const [nom, img, type] of [['JPEG à en-tête valide mais TRONQUÉ', CANARI.subarray(0, Math.floor(CANARI.length / 2)), 'image/jpeg'], ['PNG tronqué', PNG.subarray(0, Math.floor(PNG.length / 2)), 'image/png']]) {
            const r = await scanner(sv.url, cookie, { form: formulaire({ image: img, type }), nom: 'N3' });
            H.v(`N3. ${nom} : 415 IMAGE/format, facturation null`, [r.statut, (r.json.erreur || {}).detail, r.json.facturation], [415, 'format', null]);
        }
        H.v('   rien débité, solde 25', [await soldeCompte(c), await nMouv() - m0], [25, 0]);
    }

    // ═══ N1 : la porte se libère à la FIN RÉELLE du traitement, pas quand le client coupe ═══
    {
        const { c, cookie } = await compte(); mode = 'affirmee'; retard = 1500;
        const corpsMp = Buffer.concat([Buffer.from('--BBB\r\nContent-Disposition: form-data; name="source"\r\n\r\ncamera\r\n--BBB\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'), JPEG, Buffer.from('\r\n--BBB--\r\n')]);
        const a0 = appelsChaine;
        const client = brut(sv.url, { cookie, entetes: { 'content-length': String(corpsMp.length) }, delaiMs: 6000, surReq: q => setTimeout(() => q.destroy(), 500), ecrire: req => { req.write(corpsMp); req.end(); } });
        for (let k = 0; k < 40 && appelsChaine === a0; k++) await attendre(25);
        await client; await attendre(300);                      // le client a coupé (≈ 500 ms) ; la chaîne fabriquée dort encore (1 500 ms)
        H.v('N1. le client coupe PENDANT la chaîne : la porte reste tenue (jeton global ET jeton du compte)', [appelsChaine - a0, SC.etatPorte().enCours, SC.etatPorte().comptes], [1, 1, 1]);
        for (let k = 0; k < 80 && SC.etatPorte().enCours > 0; k++) await attendre(50);
        retard = 0;
        H.v('   à la fin réelle du traitement : rendue exactement une fois (0, 0), le scan a été débité (24)', [SC.etatPorte().enCours, SC.etatPorte().comptes, await soldeCompte(c)], [0, 0, 24]);
        const suite = await scanner(sv.url, cookie, { nom: 'N1-suite' });
        H.v('   le compte peut scanner à nouveau', suite.statut, 200);
    }

    // ═══ I-1 : un client qui coupe ENTRE le claim d'idempotence et le traitement ne bloque pas sa propre clé ═══
    {
        const { c, cookie } = await compte(); mode = 'affirmee';
        const cleI = `rejeu-i1-${Date.now().toString(36)}`;
        const corpsMp = Buffer.concat([Buffer.from('--BBB\r\nContent-Disposition: form-data; name="source"\r\n\r\ncamera\r\n--BBB\r\nContent-Disposition: form-data; name="image"; filename="a.jpg"\r\nContent-Type: image/jpeg\r\n\r\n'), JPEG, Buffer.from('\r\n--BBB--\r\n')]);
        const dbReelle = mongoose.connection.db;
        const lente = new Proxy(dbReelle, { get(t, p) {                    // l'écriture du claim réussit, PUIS la requête attend 600 ms : le client coupe dans cette fenêtre
            if (p !== 'collection') { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; }
            return nom => { const col = t.collection(nom); if (!nom.endsWith('idempotence')) return col;
                return new Proxy(col, { get(tc, pc) { if (pc === 'insertOne') return async (...a) => { const r = await tc.insertOne(...a); await attendre(600); return r; }; const v = tc[pc]; return typeof v === 'function' ? v.bind(tc) : v; } }); };
        } });
        const a0 = appelsChaine, m0 = await nMouv();
        db.brancher(lente);
        try {
            await brut(sv.url, { cookie, entetes: { 'content-length': String(corpsMp.length), 'idempotency-key': cleI }, delaiMs: 4000, surReq: q => setTimeout(() => q.destroy(), 250), ecrire: req => { req.write(corpsMp); req.end(); } });
            await attendre(1200);
        } finally { db.brancher(dbReelle); }
        H.v('I-1. le client a coupé après le claim : rien traité, rien débité, porte rendue', [appelsChaine - a0, await nMouv() - m0, await soldeCompte(c), SC.etatPorte().enCours], [0, 0, 25, 0]);
        H.v('   le claim d\'idempotence est LIBÉRÉ (aucun document restant pour cette clé)', await raw('idempotence').countDocuments({ cle: new RegExp(`${cleI}$`) }), 0);
        const rejeu = await scanner(sv.url, cookie, { entetes: { 'idempotency-key': cleI }, nom: 'I-1-rejeu' });
        H.v('   le rejeu avec la MÊME clé est traité normalement : 200, UN seul débit (solde 24), pas de 429 « en cours »', [rejeu.statut, rejeu.json.success, await soldeCompte(c), await nMouv() - m0], [200, true, 24, 1]);
    }

    // ═══ I4 : le décodage HEIC est BORNÉ ═══
    {
        const { c, cookie } = await compte();
        const enorme = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), Buffer.alloc(13 * 1024 * 1024, 7)]);       // un décodeur qui rend 13 Mo de « JPEG »
        const svG = await monter({ decoderHeic: async () => enorme });
        const r = await scanner(svG.url, cookie, { form: formulaire({ image: HEIC, type: 'image/heic' }), nom: 'I4' });
        H.v('I4. un décodeur qui rend plus de 12 Mo : 413 trop-lourde, rien débité', [r.statut, (r.json.erreur || {}).code, (r.json.erreur || {}).detail, await soldeCompte(c)], [413, 'IMAGE', 'trop-lourde', 25]);
        await svG.fermer();
        H.vrai('   le décodeur par défaut est exporté (pour être borné par un test)', typeof SC.decoderHeicParDefaut === 'function');
        if (typeof SC.decoderHeicParDefaut === 'function') {
            const grande = await sharp({ create: { width: 5000, height: 3000, channels: 3, background: { r: 200, g: 30, b: 30 } } }).png().toBuffer();
            const sortie = await SC.decoderHeicParDefaut(grande);
            const meta = await sharp(sortie).metadata();
            H.v('   le décodeur par défaut : JPEG, côté long ≤ 2048 px, sans agrandir', [meta.format, Math.max(meta.width, meta.height)], ['jpeg', 2048]);
            const petite = await sharp(PNG).metadata(); const sp = await sharp(await SC.decoderHeicParDefaut(PNG)).metadata();
            H.v('   une petite image n\'est pas agrandie', [sp.width, sp.height], [petite.width, petite.height]);
        }
    }

    // ═══ I1 : un Content-Type qui n'est pas multipart est refusé TOUT DE SUITE ═══
    {
        const t0 = Date.now(), { cookie } = await compte();
        let r = null;
        try { const x = await fetch(sv.url + '/api/scanner/analyses', { method: 'POST', headers: { cookie, origin: SITE, 'x-rat-market': '1', 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(3000) }); r = { statut: x.status, json: await x.json() }; toutes.push({ nom: 'I1', statut: x.status, acao: x.headers.get('access-control-allow-origin'), acac: x.headers.get('access-control-allow-credentials') }); }
        catch (e) { r = { statut: `abandon (${e.name})`, json: { erreur: {} } }; }
        H.v('I1. application/json de 2 octets : 400 ENTREE en moins de 1 s, porte intacte', [r.statut, r.json.erreur.code, Date.now() - t0 < 1000, SC.etatPorte().enCours], [400, 'ENTREE', true, 0]);
    }

    // ═══ C1 : la porte ne fuit JAMAIS (client coupé pendant une lecture lente, exception après la prise) ═══
    {
        const { cookie } = await compte();
        const dbReelle = mongoose.connection.db;
        const ralentie = new Proxy(dbReelle, { get(t, p) {
            if (p !== 'collection') { const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; }
            return nom => { const c = t.collection(nom); if (!nom.endsWith('sessions')) return c;
                return new Proxy(c, { get(tc, pc) { if (pc === 'findOne') return async (...a) => { await attendre(400); return tc.findOne(...a); }; const v = tc[pc]; return typeof v === 'function' ? v.bind(tc) : v; } }); };
        } });
        db.brancher(ralentie);
        const coupes = [];
        try {
            for (let k = 0; k < 5; k++) coupes.push(brut(sv.url, { cookie, entetes: { 'content-length': '5000' }, delaiMs: 3000, ecrire: req => { req.write('--BBB\r\n'); setTimeout(() => req.destroy(), 80); } }));
            await Promise.all(coupes); await attendre(1500);
        } finally { db.brancher(dbReelle); }
        H.v('C1. 5 clients qui coupent PENDANT la lecture de session (400 ms) : la porte est rendue (0/3)', SC.etatPorte().enCours, 0);
        const apres = await scanner(sv.url, cookie, { nom: 'C1-apres' });
        H.v('   le compte et le processus ne sont pas bloqués : le scan suivant passe', apres.statut, 200);
        // exception APRÈS la prise : la lecture du corps lève une erreur inattendue
        const MP = require('../scanner/multipart'), orig = MP.lireMultipart;
        MP.lireMultipart = async () => { throw new TypeError('défaut simulé'); };
        let boum; try { boum = await scanner(sv.url, cookie, { nom: 'C1-exception' }); } finally { MP.lireMultipart = orig; }
        await attendre(200);
        H.v('   une exception après la prise : 500 SERVEUR, rien débité, porte rendue (0/3)', [boum.statut, (boum.json.erreur || {}).code, boum.json.facturation, SC.etatPorte().enCours], [500, 'SERVEUR', null, 0]);
        const encore = await scanner(sv.url, cookie, { nom: 'C1-encore' });
        H.v('   et le scan suivant du même compte passe', encore.statut, 200);
    }

    // ═══ I2b : UN seul corps en lecture par compte à la fois ═══
    {
        const { c, cookie } = await compte(), autre = await compte();
        const reqs = [], tenu = brut(sv.url, { cookie, entetes: { 'content-length': '5000' }, delaiMs: 20000, surReq: q => reqs.push(q), ecrire: req => { req.write('--BBB\r\n'); } });
        for (let k = 0; k < 50 && SC.etatPorte().enCours < 1; k++) await attendre(50);
        const m0 = await nMouv();
        const second = await scanner(sv.url, cookie, { nom: 'I2b' });
        H.v('I2b. un second corps du même compte pendant le premier : 429 DEBIT avec reessayerDans court, rien débité', [second.statut, (second.json.erreur || {}).code, ((second.json.erreur || {}).reessayerDans > 0) && second.json.erreur.reessayerDans <= 10, await nMouv() - m0, await soldeCompte(c)], [429, 'DEBIT', true, 0, 25]);
        const autreCompte = await scanner(sv.url, autre.cookie, { nom: 'I2b2' });
        H.v('   un AUTRE compte n\'est pas gêné', autreCompte.statut, 200);
        for (const q of reqs) q.destroy();
        await tenu;
        for (let k = 0; k < 60 && SC.etatPorte().enCours > 0; k++) await attendre(50);
        const apres = await scanner(sv.url, cookie, { nom: 'I2b3' });
        H.v('   le premier terminé, le compte peut scanner à nouveau', [apres.statut, SC.etatPorte().enCours], [200, 0]);
    }

    // ═══ I3 : la règle G n'est PAS coupée au scanner (consultée comme à l'extension) ═══
    {
        const RG = require('../identifier/regle-g'), origG = RG.decisionRegleG;
        let appelsG = 0; const vus = [];
        RG.decisionRegleG = () => { appelsG++; return null; };
        const voisins = async ({ imageUrls }) => { vus.push(String(imageUrls[0]).startsWith('data:')); return { ligne: {}, nEssais: 0, mesures: [], contexteG: {}, seuils: {} }; };
        const cfgG = lireConfig({ MONGODB_BASE: 'test_scratch', V2_REGLE_G: '1' });
        const svG = await monter({ voisins }, cfgG);
        try {
            mode = 'affirmee';
            const { cookie } = await compte();
            const r = await scanner(svG.url, cookie, { form: formulaire({ image: CANARI }), nom: 'I3' });
            H.v('I3. règle G allumée + un fournisseur de voisins : decisionRegleG est consultée au scanner (1 appel), le fournisseur reçoit le data-URL', [r.statut, appelsG, vus], [200, 1, [true]]);
        } finally { RG.decisionRegleG = origG; await svG.fermer(); }
    }

    // ═══ M2 : journal-scans.js — une URL https s'écrit à l'identique, un data: devient null ═══
    {
        const { enregistrerScan, JournalScan } = require('../../journal-scans');
        const marque = `__m2-${Date.now()}`;
        const https = 'https://images1.vinted.net/t/01_00/f800/photo.webp?s=abc';
        enregistrerScan({ route: 'identifier', userId: `${marque}-a`, imageUrl: https });
        enregistrerScan({ route: 'identifier', userId: `${marque}-b`, imageUrl: `data:image/jpeg;base64,${B64_CANARI.slice(0, 400)}` });
        enregistrerScan({ route: 'identifier', userId: `${marque}-c`, imageUrl: `  DATA:image/png;base64,AAAA` });
        const lire = async u => { for (let k = 0; k < 40; k++) { const d = await JournalScan.findOne({ userId: u }).lean(); if (d) return d; await attendre(100); } return null; };
        const [a, b, cc] = [await lire(`${marque}-a`), await lire(`${marque}-b`), await lire(`${marque}-c`)];
        H.v('M2. journal-scans : https écrite à l\'identique ; data: (même en majuscules ou après des espaces) => null', [a && a.imageUrl, b && b.imageUrl, cc && cc.imageUrl], [https, null, null]);
        await JournalScan.deleteMany({ userId: new RegExp(`^${marque}`) });
    }

    // ═══ R2 : au plus 3 corps en mémoire à la fois (un seul par compte : trois comptes) ═══
    {
        const trois = [await compte(), await compte(), await compte()], quatre = await compte(); const cookie = quatre.cookie, c = quatre.c; const m0 = await nMouv();
        const reqs = [], tenus = [];
        for (const t of trois) tenus.push(brut(sv.url, { cookie: t.cookie, entetes: { 'content-length': '5000' }, delaiMs: 20000, surReq: q => reqs.push(q), ecrire: req => { req.write('--BBB\r\n'); } }));
        for (let k = 0; k < 50 && SC.etatPorte().enCours < 3; k++) await attendre(100);
        H.v('R2. trois corps en lecture : la porte est pleine (3/3)', [SC.etatPorte().enCours, SC.etatPorte().max], [3, 3]);
        const quatrieme = await scanner(sv.url, cookie, { nom: 'porte' });
        H.v('   le 4e : 503 INDISPONIBLE réessayable (Retry-After), corps jamais lu, facturation null, rien débité', [quatrieme.statut, quatrieme.json.erreur.code, Number(quatrieme.entetes['retry-after']) > 0, quatrieme.json.facturation, await soldeCompte(c), await nMouv() - m0], [503, 'INDISPONIBLE', true, null, 25, 0]);
        // on libère : les trois requêtes tenues sont coupées par leur client
        for (const q of reqs) q.destroy();
        await Promise.all(tenus);
        for (let k = 0; k < 60 && SC.etatPorte().enCours > 0; k++) { await attendre(100); }
        H.v('   porte libérée quand les corps se terminent (0/3)', SC.etatPorte().enCours, 0);
        const cinq = await scanner(sv.url, cookie, { nom: 'porte2' });
        H.v('   la suivante passe', cinq.statut, 200);
    }

    // ═══ (11) CORS du site, credentials, sur chaque réponse reçue, erreurs comprises ═══
    {
        // les réponses à une requête SANS l'Origin du site (cas '2' : absente, voisine, extension) n'ont, par construction, aucun en-tête du site
        const site = toutes.filter(t => t.nom !== '2' && t.nom !== '2r');
        const sans = site.filter(t => t.acao !== SITE || t.acac !== 'true');
        H.v(`11. en-têtes CORS du site (origine exacte + credentials) sur chacune des ${site.length} réponses d'origine du site (statuts vus : ${[...new Set(site.map(t => t.statut))].sort().join(',')})`, [sans.length, new Set(site.map(t => t.statut)).size >= 8], [0, true]);
        if (sans.length) console.log('   sans CORS :', JSON.stringify(sans.slice(0, 6)));
        const pre = await fetch(sv.url + '/api/scanner/analyses', { method: 'OPTIONS', headers: { origin: SITE, 'access-control-request-method': 'POST' } });
        H.v('   préflight : 204, credentials, Allow-Headers du site', [pre.status, pre.headers.get('access-control-allow-credentials'), /X-Rat-Market/.test(pre.headers.get('access-control-allow-headers') || '')], [204, 'true', true]);
    }
    await sv.fermer();

    // ═══ (3 réel) + (10) la VRAIE chaîne héritée, serveur enfant, faux réseau ═══
    let sortieEnfant = '';
    {
        const { demarrer } = require('../../verrou/serveur');
        const FAUX = path.join(__dirname, 'faux-reseau-scanner.js');
        const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: '1' };
        await semer();
        const srv = await demarrer(FAUX, base);
        if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
        const url = `http://127.0.0.1:${srv.port}`;
        const { c, cookie } = await compte();
        const r = await scanner(url, cookie, { form: formulaire({ image: CANARI }), nom: 'reel' }), j = r.json || {};
        H.v('3b. VRAIE chaîne (faux réseau) : 200, contrat 2, a-trancher à 2 candidats, réservé', [r.statut, j.contrat, j.analyse && j.analyse.statut, j.analyse && j.analyse.cartes[0].candidats.length, j.facturation && j.facturation.reserve], [200, 2, 'a-trancher', 2, 1]);
        H.vrai('   l\'IA (faux réseau) a bien reçu un data-URL', /data-URL transmis à l'IA \(\d+ caractères\)/.test(srv.lire()));
        let jl = null; for (let k = 0; k < 30 && !jl; k++) { jl = await raw('journal_scans').findOne({ userId: `v2:compte:${c._id}` }); if (!jl) await attendre(200); }   // un refus par égalité porte un _id propre, pas le scanId
        H.v('   journal_scans : ligne du compte, imageUrl null (le data-URL n\'est pas journalisé)', [jl && jl.userId, jl && jl.imageUrl], [`v2:compte:${c._id}`, null]);
        const rep = await repondre(url, cookie, j.scanId, { choix: j.analyse.cartes[0].question.choix[0].id }, { nom: 'reel-rep' });
        H.v('   réponse à la question sur la vraie chaîne : 200 identifiée', [rep.statut, rep.json.carte.statut], [200, 'identifiee']);
        // un scan dont la lecture tombe (image non rejouable ne peut pas se fabriquer ici : on vérifie la panne par une image rejouée absente — non faisable) : voir réserves
        await attendre(500); sortieEnfant = srv.lire(); srv.enfant.kill();
    }

    // ═══ (10) l'image n'est ni stockée ni journalisée : TOUTES les collections ═══
    {
        const p = await parcourir();
        H.v(`10. parcours de ${p.collections} collections / ${p.docs} documents : aucun Buffer, aucune chaîne data:, aucune chaîne > 10 Ko`, p.suspects, []);
        const noms = (await mongoose.connection.db.listCollections().toArray()).map(x => x.name);
        H.vrai('    (le dénominateur contient bien les collections écrites par un scan : analyses, annonces, journal_scans, mouvements, questions, idempotence)', ['analyses', 'annonces', 'journal_scans', 'mouvements', 'questions'].every(n => noms.includes(n)));
        const docsBanc = []; for (const n of noms.filter(x => /banc/i.test(x))) docsBanc.push([n, await raw(n).countDocuments({})]);
        H.vrai(`    rien n'est conservé pour le banc (le scanner ne transmet aucun consentement) : 0 document dans ${docsBanc.length} collection(s) du banc (${docsBanc.map(x => x[0]).join(', ')})`, docsBanc.every(x => x[1] === 0));
    }
    // ═══ M1 : une image CANARI de plus de 20 Ko (scans en processus ET par la vraie chaîne) ne se retrouve en sous-chaîne NULLE PART ═══
    {
        const noms = (await mongoose.connection.db.listCollections().toArray()).map(x => x.name).filter(n => !n.startsWith('system.'));
        let docs = 0; const trouves = [];
        for (const n of noms) for (const d of await raw(n).find({}).toArray()) {
            docs++; const s = JSON.stringify(d);
            if (s.includes(B64_CANARI) || s.includes(MILIEU_CANARI) || s.includes(CANARI.toString('hex').slice(2000, 2200))) trouves.push(`${n}/${d._id}`);
        }
        H.v(`M1. canari de ${CANARI.length} o (base64 entier ET un fragment de 200 caractères, avec ou sans « data: », + son hex) cherché dans ${docs} documents / ${noms.length} collections`, trouves, []);
        H.vrai(`    ... et dans la sortie du serveur enfant (${sortieEnfant.length} caractères) : absent`, sortieEnfant.length > 0 && !sortieEnfant.includes(MILIEU_CANARI) && !sortieEnfant.includes(B64_CANARI));
    }
    H.bilan();
    await mongoose.disconnect(); await H.arreterBanc();
})().catch(e => { console.error('❌', e); process.exit(1); });
