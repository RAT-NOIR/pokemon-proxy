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

const JPEG = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF, 0xE0]), crypto.randomBytes(300)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), crypto.randomBytes(100)]);
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
        if (mode === 'ambigue') {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [ID_A, ID_B] });
            return res.json({ ...affirme(ID_A), scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...affirme(ID_A).carte, ambigu: true },
                candidats: [ID_A, ID_B].map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    const lotFabrique = async req => { appelsChaine++; dernierBody = req.body; return [ID_A, ID_B, ID_C].map(id => ({ statutHttp: 200, corps: { ...affirme(id), scanId: String(req.scanIdImpose) } })); };
    const monter = async (deps = {}) => {
        const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter'), require('../scanner/monter')], cfg, { gererIdentifier: chaine, ...deps }));
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
        const r = await scanner(sv.url, compteA.cookie, { nom: '3' }), j = r.json || {};
        const attendu = `data:image/jpeg;base64,${JPEG.toString('base64')}`;
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
            ['422 partie image vide', formulaire({ image: Buffer.alloc(0) }), 422, 'IMAGE', 'aucune-carte'],
            ['422 aucune partie image', formulaire({ image: null }), 422, 'IMAGE', 'aucune-carte'],
            ['400 source hors liste', formulaire({ source: 'url' }), 400, 'ENTREE', 'source'],
            ['400 un champ de consentement du banc n\'existe pas au scanner', formulaire({ extra: { consentementBanc: '1' } }), 400, 'ENTREE', 'champ-inconnu']
        ];
        for (const [nom, form, st, code, detail] of cas) {
            const r = await scanner(sv.url, cookie, { form, nom: 'r3' });
            H.v(`R3. ${nom} : ${st} ${code}/${detail}, facturation null`, [r.statut, r.json.erreur.code, r.json.erreur.detail, r.json.facturation], [st, code, detail, null]);
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
        const decode = Buffer.concat([Buffer.from([0xFF, 0xD8, 0xFF]), crypto.randomBytes(50)]);
        const svH = await monter({ decoderHeic: async b => { if (!b.equals(HEIC)) throw new Error('mauvais octets'); return decode; } });
        const ok = await scanner(svH.url, cookie, { form: formulaire({ image: HEIC, type: 'image/heic' }), nom: 'heic2' });
        H.v('   HEIC décodé : la chaîne reçoit le JPEG DÉCODÉ (data:image/jpeg), jamais les octets HEIC', [ok.statut, dernierBody.imageUrls[0] === `data:image/jpeg;base64,${decode.toString('base64')}`], [200, true]);
        const svE = await monter({ decoderHeic: async () => { throw new Error('échec'); } });
        const ko = await scanner(svE.url, cookie, { form: formulaire({ image: HEIC, type: 'image/heic' }), nom: 'heic3' });
        H.v('   décodage qui échoue : 415 format, pas de second débit (solde 24 après le seul scan réussi)', [ko.statut, ko.json.erreur.detail, await soldeCompte(c)], [415, 'format', 24]);
        await svH.fermer(); await svE.fermer();
    }

    // ═══ R2 : au plus 3 corps en mémoire à la fois ═══
    {
        const { c, cookie } = await compte(); const m0 = await nMouv();
        const reqs = [], tenus = [];
        for (let k = 0; k < 3; k++) tenus.push(brut(sv.url, { cookie, entetes: { 'content-length': '5000' }, delaiMs: 20000, surReq: q => reqs.push(q), ecrire: req => { req.write('--BBB\r\n'); } }));
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
    {
        const { demarrer } = require('../../verrou/serveur');
        const FAUX = path.join(__dirname, 'faux-reseau-scanner.js');
        const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: '1' };
        await semer();
        const srv = await demarrer(FAUX, base);
        if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
        const url = `http://127.0.0.1:${srv.port}`;
        const { c, cookie } = await compte();
        const r = await scanner(url, cookie, { nom: 'reel' }), j = r.json || {};
        H.v('3b. VRAIE chaîne (faux réseau) : 200, contrat 2, a-trancher à 2 candidats, réservé', [r.statut, j.contrat, j.analyse && j.analyse.statut, j.analyse && j.analyse.cartes[0].candidats.length, j.facturation && j.facturation.reserve], [200, 2, 'a-trancher', 2, 1]);
        H.vrai('   l\'IA (faux réseau) a bien reçu un data-URL', /data-URL transmis à l'IA \(\d+ caractères\)/.test(srv.lire()));
        let jl = null; for (let k = 0; k < 30 && !jl; k++) { jl = await raw('journal_scans').findOne({ userId: `v2:compte:${c._id}` }); if (!jl) await attendre(200); }   // un refus par égalité porte un _id propre, pas le scanId
        H.v('   journal_scans : ligne du compte, imageUrl null (le data-URL n\'est pas journalisé)', [jl && jl.userId, jl && jl.imageUrl], [`v2:compte:${c._id}`, null]);
        const rep = await repondre(url, cookie, j.scanId, { choix: j.analyse.cartes[0].question.choix[0].id }, { nom: 'reel-rep' });
        H.v('   réponse à la question sur la vraie chaîne : 200 identifiée', [rep.statut, rep.json.carte.statut], [200, 'identifiee']);
        // un scan dont la lecture tombe (image non rejouable ne peut pas se fabriquer ici : on vérifie la panne par une image rejouée absente — non faisable) : voir réserves
        await attendre(500); srv.enfant.kill();
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
    H.bilan();
    await mongoose.disconnect(); await H.arreterBanc();
})().catch(e => { console.error('❌', e); process.exit(1); });
