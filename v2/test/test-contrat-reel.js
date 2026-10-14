'use strict';
// B7b.1 — LE CONTRAT PUBLIÉ EST VALIDÉ SUR LES RÉPONSES RÉELLES DU SERVEUR (openapi.v2.json, lot B7a, contre le serveur v2 de B1b/B2/B3/B6/B9).
// Step 1 : chaque route de `paths` (liste DÉRIVÉE de `paths`), dans chaque état que le serveur sait produire, est jouée contre le serveur v2 RÉEL ; le corps est jugé contre le
//          schéma que `paths` documente pour CE statut. « N réponses, M valides, 0 écart » ; un écart nomme route, état, chemin JSON. Le banc ÉCHOUE si une route de `paths`
//          n'a été jouée dans aucun état, ou si un statut documenté n'a été joué ni déclaré non joué avec sa raison.
// Step 2 : la propriété inverse — 24 corruptions connues de réponses RÉELLES ; le validateur doit les REFUSER (il sait dire non).
// Deux montages : (a) un serveur ENFANT (index.js réel, RM_API_V2=1, faux réseau du verrou : la VRAIE chaîne héritée hors ligne) ; (b) l'assembleur du socle en processus (les lots de
// production, la chaîne héritée FABRIQUÉE pour fabriquer les verdicts fermes, lots, introuvables). Base : la base EN MÉMOIRE du banc (INT2) — ni production, ni R2, ni réseau.
const H = require('./_harnais');
const path = require('path');
const crypto = require('crypto');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const { CODES } = require('../erreurs');
const A = require('./_contrat-reel-aide'); const Q = require('./_aide-quota');
const { SCHEMA, ref, OPERATIONS, STATUTS_DOCUMENTES, grandLivre, consigner, consignerHorsContrat } = A;
const { valider } = require('../openapi/valider');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const IMAGE_INCONNUE = 'https://images1.vinted.net/t/00_rm-b7b1/f800/inconnue.webp';
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSCRIPTION_IP_HEURE: '3', V2_OUBLI_IP_HEURE: '3', V2_REINIT_IP_HEURE: '3', V2_VERIFICATION_IP_HEURE: '3', V2_LOT_CARTES_MAX: '100' });   // les lots de ce banc dépassent 20 cartes (le défaut les refuserait : test-plafonds.js)
const EXT = cfg.origines.extension, SITE = cfg.origines.site;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
let nIp = 0, nCle = 0;
const ip = () => { nIp++; return { 'x-forwarded-for': `10.70.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
const cle = () => `banc-b7b1-${Date.now().toString(36)}-${++nCle}`;
const MDP = 'un-mot-de-passe-solide';

// ── états joués : un statut obtenu différent du statut attendu est une anomalie du BANC (état mal fabriqué), pas un écart de contrat
const mal = [];
async function jouer(url, route, etat, attendu, chemin, { corps, entetes = {}, methode, garde = false } = {}) {
    const m = methode || route.split(' ')[0];
    const r = await H.appel(url, chemin, { methode: m, corps, entetes });
    consigner(route, etat, r, { garde });
    if (r.statut !== attendu) mal.push(`${route} [${etat}] : statut ${r.statut} au lieu de ${attendu}${r.json && r.json.erreur ? ` (${r.json.erreur.code}${r.json.erreur.detail ? '/' + r.json.erreur.detail : ''} « ${r.json.erreur.message} »)` : ''}`);
    return r;
}
async function jouerFormulaire(url, route, etat, attendu, chemin, form, entetes, { garde = false } = {}) {
    const x = await fetch(url + chemin, { method: 'POST', redirect: 'manual', body: form, headers: entetes });
    const texte = await x.text(); let json = null; try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    const r = { statut: x.status, json, texte, entetes: Object.fromEntries(x.headers) };
    consigner(route, etat, r, { garde });
    if (r.statut !== attendu) mal.push(`${route} [${etat}] : statut ${r.statut} au lieu de ${attendu}${r.json && r.json.erreur ? ` (${r.json.erreur.code}${r.json.erreur.detail ? '/' + r.json.erreur.detail : ''})` : ''}`);
    return r;
}

// PHOTO-EXTENSION : un corps BINAIRE (une image) avec son Content-Type
async function jouerBinaire(url, route, etat, attendu, chemin, octets, type, entetes, { garde = false, longueurAnnoncee = null } = {}) {
    let r;
    if (longueurAnnoncee !== null) {
        // un refus décidé sur les EN-TÊTES : le client annonce une longueur et n'écrit que 16 octets, puis attend la réponse (un client qui écrit 2 Mio pendant qu'on lui répond peut perdre la réponse dans une
        // réinitialisation de la connexion : de la plomberie de socket, pas le sujet du contrat)
        r = await new Promise((resolve, reject) => {
            const u = new URL(url + chemin);
            const req = require('http').request({ host: u.hostname, port: u.port, path: u.pathname + u.search, method: 'POST', agent: false, headers: { ...(type ? { 'content-type': type } : {}), ...entetes, 'content-length': String(longueurAnnoncee) } }, res => {
                const m = []; res.on('data', c => m.push(c));
                res.on('end', () => { const texte = Buffer.concat(m).toString('utf8'); let json = null; try { json = JSON.parse(texte); } catch { /* corps non JSON */ } resolve({ statut: res.statusCode, json, texte, entetes: res.headers }); req.destroy(); });
            });
            req.on('error', reject); req.write(octets.subarray(0, 16));
        });
    } else {
        const x = await fetch(url + chemin, { method: 'POST', redirect: 'manual', body: octets, headers: { ...(type ? { 'content-type': type } : {}), ...entetes } });
        const texte = await x.text(); let json = null; try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
        r = { statut: x.status, json, texte, entetes: Object.fromEntries(x.headers) };
    }
    consigner(route, etat, r, { garde });
    if (r.statut !== attendu) mal.push(`${route} [${etat}] : statut ${r.statut} au lieu de ${attendu}${r.json && r.json.erreur ? ` (${r.json.erreur.code}${r.json.erreur.detail ? '/' + r.json.erreur.detail : ''})` : ''}`);
    return r;
}

async function jouerBinaireBrut(url, chemin, octets, type, entetes) {
    const x = await fetch(url + chemin, { method: 'POST', redirect: 'manual', body: octets, headers: { 'content-type': type, ...entetes } });
    const texte = await x.text(); let json = null; try { json = JSON.parse(texte); } catch { /* corps non JSON */ }
    return { statut: x.status, json, texte, entetes: Object.fromEntries(x.headers) };
}

// ── porteurs
async function inst(essais = 3, o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function compte(o = {}) {
    const c = Object.assign(M.nouveauCompte({ email: `c${++nCle}@exemple.fr`, emailCle: `c${nCle}@exemple.fr`, motDePasse: {} }), { verifie: true, solde: { accueil: 25, achete: 0 } }, o);
    await db.col('comptes').insertOne(c);
    const s = await require('../comptes/sessions').creerSession(c._id);
    return { c, cookie: `rm_session=${s.token}` };
}
async function instLiee(c, o = {}) { return inst(0, { compteId: (c.c || c)._id, lieeLe: new Date(), ...o }); }     // une installation LIÉE porte toujours sa date de liaison (liaison.js l.43) ; sans elle le banc fabriquait un état que le serveur ne produit pas
const extH = (jeton, plus = {}) => ({ origin: EXT, ...ip(), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...plus });
const siteH = (cookie, plus = {}) => ({ origin: SITE, 'x-rat-market': '1', ...(cookie ? { cookie } : {}), ...ip(), ...plus });
const corpsId = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });

// ── catalogue FABRIQUÉ (seul l'idProduct de A et B vient de la charge)
const ID_A = 895789, ID_B = 895790, ID_C = 895791, EXP = 990001;
const VB = require('./_visuels-banc'); const VIS = new Map(); let FICHIER_VIS = null;
async function semer(mode) {                              // 'double' (A, B) | 'triple' (A, B, C sans prix) | 'vide'
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    VIS.clear();
    if (mode === 'vide') { VB.vider(); return; }
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    // 'double' : les prix de test-retour-live-v2.js (1180 contre 1) — deux prix très écartés, la chaîne héritée pose une vraie question et écrit sa ligne de journal ;
    // avec 1,00 contre 2,50 elle REFUSE par égalité (remboursement différé, question réservée par v2) et n'écrit aucune ligne de journal : pas de retour-live possible.
    const liste = mode === 'triple' ? [[ID_A, 'normale', 1.0], [ID_B, 'reverse', 2.5], [ID_C, 'normale', null]] : [[ID_A, 'normale', 1180], [ID_B, 'reverse', 1.0]];
    for (const [id, variante, trend] of liste) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 + (id === ID_C ? 1 : 0) });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        if (trend !== null) await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: 0.5, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
        VIS.set(id, VB.doc(id, { variante }));
    }
    FICHIER_VIS = VB.fichier([...VIS.values()]);          // installe la version dans CE processus ET écrit l'archive pour l'enfant
}
const journalDe = async scanId => { for (let k = 0; k < 40; k++) { const l = await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(scanId) }); if (l) return l; await attendre(150); } return null; };
// une clé d'idempotence DÉJÀ prise par une requête en cours (le seul moyen honnête de fabriquer le 429 DEBIT « requête identique en cours » sans course)
// Pose le compteur de la fenêtre horaire COURANTE d'un limiteur par porteur (v2/transport/limites.js : clé `${nom}:${type}:${id}|${début de fenêtre}`) à son plafond : jouer le plafond
// de 600 ou 1 200 requêtes une à une n'apporterait rien de plus que la 429 elle-même, que le serveur réel rend.
async function plafonner(nom, type, id, n) {
    const debut = Math.floor(Date.now() / 3600e3) * 3600e3;
    await raw('limites').insertOne({ cle: `${nom}:${type}:${id}|${debut}`, n, expireLe: new Date(debut + 7200e3) });
}
async function claimEnCours(porteur, routeIdem, valeur, corps) {
    const { empreinteDuCorps } = require('../transport/idempotence');
    await raw('idempotence').insertOne({ cle: `${porteur}|${routeIdem}|${valeur}`, empreinteCorps: empreinteDuCorps(corps), etat: 'en-cours', proprietaire: 'banc', creeLe: new Date(), expireLe: new Date(Date.now() + 120000) });
}

(async () => {
    // Les limiteurs du serveur comptent par FENÊTRE FIXE (heure, jour). Un banc qui franchirait une frontière en pleine série de « 3 essais puis 429 » verrait son compteur repartir à zéro :
    // état non joué, comptes différents d'une exécution à l'autre (constat du tour 1, M3). On attend donc la frontière avant de commencer quand elle est à moins de 4 minutes.
    // B2b point 6 : la garde couvre aussi la SEMAINE (poche hebdo semée à la semaine ISO courante, l.168 et l.559) et le MOIS (abonnement `moisCle`, l.501) — lus par le serveur enfant avec son horloge réelle.
    // Une horloge de limiteur ne peut pas atteindre un serveur enfant : la garde d'attente reste le seul moyen ici (harnais : H.eviterFrontieres, marge 4 minutes).
    await H.eviterFrontieres({ heure: true, jour: true, semaine: true, mois: true }, 240e3); await Q.eviterMinuit();
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-contrat-reel.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const sharp = require('sharp');
    const JPEG = await sharp(crypto.randomBytes(24 * 24 * 3), { raw: { width: 24, height: 24, channels: 3 } }).jpeg().toBuffer();
    const PNG = await sharp(crypto.randomBytes(16 * 16 * 3), { raw: { width: 16, height: 16, channels: 3 } }).png().toBuffer();
    const EXE = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(100)]);
    const formulaire = ({ image = JPEG, type = 'image/jpeg', source = 'camera' } = {}) => {
        const f = new FormData();
        if (source !== null) f.append('source', source);
        if (image !== null) f.append('image', new Blob([image], { type }), 'photo.jpg');
        return f;
    };

    // ═══════════════════════════ (a) LE SERVEUR ENFANT — la vraie chaîne héritée, hors ligne ═══════════════════════════
    const { demarrer } = require('../../verrou/serveur');
    await semer('double');
    const FAUX = path.join(__dirname, 'faux-reseau-scanner.js');          // = faux-reseau-v2.js (le faux réseau du verrou) + le data-URL du scanner rejoué
    const baseEnv = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', V2_VISUELS_BANC_FICHIER: FICHIER_VIS };
    const srv = await demarrer(FAUX, { ...baseEnv, RM_API_V2: '1' });
    if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
    const U = `http://127.0.0.1:${srv.port}`;
    const ident = (url, etat, attendu, jeton, c = corpsId(), { cleIdem = cle(), sansCle = false, entetes = {} } = {}) =>
        jouer(url, 'POST /api/identifier', etat, attendu, '/api/identifier', { corps: c, entetes: extH(jeton, { ...(sansCle ? {} : { 'idempotency-key': cleIdem }), ...entetes }) });
    const repondre = (url, etat, attendu, jeton, b, { cleIdem, entetes = {} } = {}) =>
        jouer(url, 'POST /api/identifier/reponse', etat, attendu, '/api/identifier/reponse', { corps: b, entetes: extH(jeton, { ...(cleIdem ? { 'idempotency-key': cleIdem } : {}), ...entetes }) });
    const retour = (url, etat, attendu, jeton, b, { cleIdem, entetes = {} } = {}) =>
        jouer(url, 'POST /api/retour-live', etat, attendu, '/api/retour-live', { corps: b, entetes: extH(jeton, { ...(cleIdem ? { 'idempotency-key': cleIdem } : {}), ...entetes }) });
    const scanAmbigu = async (url, essais = 3, etat = 'a-trancher à 2 (vraie chaîne)') => { const x = await inst(essais); const r = await ident(url, etat, 200, x.jeton); return { ...x, r, scanId: r.json && r.json.scanId }; };

    await jouer(U, 'GET /ping', 'serveur v2 allumé', 200, '/ping');
    // installation
    {
        const mem = ip();
        await jouer(U, 'POST /api/installation', 'créée', 201, '/api/installation', { corps: { versionExtension: '2.0.0', libelle: 'Chrome · Windows' }, entetes: mem });
        await jouer(U, 'POST /api/installation', 'deuxième de la même IP', 201, '/api/installation', { corps: { versionExtension: '2.0.0' }, entetes: mem });
        await jouer(U, 'POST /api/installation', 'plafond par IP et par jour', 429, '/api/installation', { corps: { versionExtension: '2.0.0' }, entetes: mem });
        await jouer(U, 'POST /api/installation', 'versionExtension de mauvais type', 400, '/api/installation', { corps: { versionExtension: 7 }, entetes: ip() });
        // LOT IDEMPOTENCE-INSTALLATION : Idempotency-Key facultative (réponse scellée en base), champ `heritage`, 422 cle-reutilisee
        const kI = `${cle()}-`.padEnd(40, 'k'), ipI = ip(), corpsI = { versionExtension: '2.0.0', libelle: 'Chrome · Windows', userIdHerite: 'portefeuille-inexistant-contrat' };
        const avecCle = await jouer(U, 'POST /api/installation', 'avec Idempotency-Key (heritage inconnu)', 201, '/api/installation', { corps: corpsI, entetes: { ...ipI, 'idempotency-key': kI } });
        const rejeuI = await jouer(U, 'POST /api/installation', 'rejeu de la même clé (même installation, même jeton)', 201, '/api/installation', { corps: corpsI, entetes: { ...ipI, 'idempotency-key': kI } });
        H.v('POST /api/installation : heritage "inconnu" rendu, le rejeu rend le même corps, marqué rejoué', [avecCle.json && avecCle.json.heritage, rejeuI.texte === avecCle.texte, rejeuI.entetes['idempotency-replayed']], ['inconnu', true, 'true']);
        await jouer(U, 'POST /api/installation', 'clé réutilisée avec un autre corps', 422, '/api/installation', { corps: { ...corpsI, libelle: 'Firefox' }, entetes: { ...ipI, 'idempotency-key': kI } });
    }
    // identifier — la vraie chaîne
    const sc = await scanAmbigu(U);
    {
        const x = await inst(3), k = cle();
        await ident(U, 'a-trancher à 2 (avec clé)', 200, x.jeton, corpsId(), { cleIdem: k });
        await ident(U, 'rejeu de la même clé (Idempotency-Replayed)', 200, x.jeton, corpsId(), { cleIdem: k });
        await ident(U, 'clé réutilisée avec un autre corps', 422, x.jeton, corpsId({ langueInterface: 'en' }), { cleIdem: k });
        const y = await inst(3), k2 = cle();
        await claimEnCours(`installation:${y.i._id}`, 'identifier', k2, corpsId());
        await ident(U, 'même clé encore en cours de traitement', 429, y.jeton, corpsId(), { cleIdem: k2 });
        const z = await inst(0); await Q.poserRestant(`installation:${z.i._id}`, 0, { limite: 3 });      // OFFRE-QUOTA : les 3 analyses du jour sont déjà prises
        await ident(U, 'QUOTA installation (plus d\'essai)', 429, z.jeton);
        await ident(U, 'sans Authorization', 401, null);
        await ident(U, 'jeton inconnu', 401, 'a'.repeat(32));
        await ident(U, 'Idempotency-Key absente', 400, x.jeton, corpsId(), { sansCle: true });
        await ident(U, 'imageUrls : hôte non autorisé', 400, x.jeton, corpsId({ imageUrls: ['https://evil.example/x.jpg'] }));
        await ident(U, 'aucune image', 200, x.jeton, corpsId({ imageUrls: [] })).then(r => r);
        await ident(U, 'marché non pris en charge', 422, x.jeton, corpsId({ marche: 'amazon.fr' }));
        await ident(U, 'extension trop ancienne', 426, x.jeton, corpsId({ versionExtension: '1.0.0' }));
        const nv = await compte({ verifie: false, solde: { accueil: 25, achete: 0 } }); const il = await instLiee(nv);
        await ident(U, 'compte non vérifié (O3 : plus un porteur, l\'installation liée redevient une installation seule sans essai ; OFFRE-QUOTA : une installation liée n\'a pas de quota propre, aucune offre plus large)', 429, il.jeton);
        const ad = await compte({ role: 'administrateur', solde: { accueil: 25, achete: 0 } }); const ia = await instLiee(ad);
        await ident(U, 'administrateur (a-trancher, rien débité)', 200, ia.jeton);
        const ex = await compte({ solde: { accueil: 0, achete: 0 } }); const ie = await instLiee(ex);
        await Q.poserRestant(`compte:${ex.c._id}`, 0, { limite: 10 });      // OFFRE-QUOTA : les 10 analyses du jour du compte gratuit sont déjà prises (plus de recharge : pas d'`achat`)
        await ident(U, 'QUOTA compte (offre restant 0)', 429, ie.jeton);
        // la panne de lecture est une panne, jamais un introuvable
        const p = await inst(3);
        await ident(U, 'panne de lecture (IA)', 200, p.jeton, corpsId({ imageUrls: [IMAGE_INCONNUE] }));
        // panne du catalogue
        const q = await inst(3);
        srv.enfant.send('panne-catalogue'); await attendre(500);
        await ident(U, 'panne du catalogue (INDISPONIBLE)', 503, q.jeton);
        srv.enfant.send('panne-catalogue-off'); await attendre(300);
        // absente du catalogue
        await semer('vide');
        const v = await inst(3);
        await ident(U, 'introuvable / hors-catalogue', 200, v.jeton);
        await semer('double');
    }
    // réponses à une question (la vraie machine à états)
    {
        const a = await scanAmbigu(U, 3, 'a-trancher à 2 pour la réponse « a »');
        await repondre(U, 'choix « a »', 200, a.jeton, { scanId: a.scanId, carte: 0, choix: 'a' });
        await repondre(U, 'rejeu du même choix (un seul débit)', 200, a.jeton, { scanId: a.scanId, carte: 0, choix: 'a' });
        await repondre(U, 'réponse contradictoire', 409, a.jeton, { scanId: a.scanId, carte: 0, choix: 'b' });
        const b = await scanAmbigu(U, 3, 'a-trancher à 2 pour « aucune »');
        await repondre(U, 'choix « aucune » (crédit rendu)', 200, b.jeton, { scanId: b.scanId, choix: 'aucune' });
        const c = await scanAmbigu(U, 3, 'a-trancher à 2 pour « ne-sait-pas »');
        await repondre(U, 'choix « ne-sait-pas » (carte inchangée)', 200, c.jeton, { scanId: c.scanId, choix: 'ne-sait-pas' });
        await repondre(U, 'choix hors liste', 400, a.jeton, { scanId: a.scanId, choix: 'z' });
        await repondre(U, 'scanId mal formé', 400, a.jeton, { scanId: 'pas-un-id', choix: 'a' });
        await repondre(U, 'sans Authorization', 401, null, { scanId: a.scanId, choix: 'a' });
        const autre = await inst(3);
        await repondre(U, 'le scan d\'un AUTRE porteur', 404, autre.jeton, { scanId: a.scanId, choix: 'a' });
        await repondre(U, 'scan inconnu', 404, a.jeton, { scanId: String(new mongoose.Types.ObjectId()), choix: 'a' });
        const d = await scanAmbigu(U, 3, 'a-trancher à 2 pour une question expirée');
        await raw('questions_v2').updateOne({ _id: `${d.scanId}:0` }, { $set: { poseeLe: new Date(Date.now() - 72 * 3600e3) } });
        await repondre(U, 'question abandonnée après 24 h', 410, d.jeton, { scanId: d.scanId, choix: 'a' });
        const e = await scanAmbigu(U, 3, 'a-trancher à 2 pour une clé réutilisée'), k = cle();
        await repondre(U, 'première réponse avec clé', 200, e.jeton, { scanId: e.scanId, choix: 'a' }, { cleIdem: k });
        await repondre(U, 'clé réutilisée avec un autre corps', 422, e.jeton, { scanId: e.scanId, choix: 'b' }, { cleIdem: k });
        const f = await scanAmbigu(U, 3, 'a-trancher à 2 pour une clé en cours'), k2 = cle();
        await claimEnCours(`installation:${f.i._id}`, 'reponse', k2, { scanId: f.scanId, choix: 'a' });
        await repondre(U, 'même clé encore en cours', 429, f.jeton, { scanId: f.scanId, choix: 'a' }, { cleIdem: k2 });
        const g = await scanAmbigu(U, 3, 'a-trancher à 2 pour une carte non fabricable');
        await raw('analyses').updateOne({ _id: new mongoose.Types.ObjectId(g.scanId) }, { $set: { produits: [] } });
        await repondre(U, 'carte non fabricable depuis analyses (SERVEUR)', 500, g.jeton, { scanId: g.scanId, choix: 'a' });
        const h = await scanAmbigu(U, 3, 'a-trancher à 2 pour une analyse absente');
        await raw('analyses').deleteOne({ _id: new mongoose.Types.ObjectId(h.scanId) });
        await repondre(U, 'question présente, analyse absente (analyse-absente)', 503, h.jeton, { scanId: h.scanId, choix: 'a' });
    }
    // retour-live (le chemin hérité gererRetourLive, inchangé)
    {
        const scanRepondu = async () => { const x = await scanAmbigu(U, 3, 'a-trancher à 2 pour le retour live'); await repondre(U, 'choix « a » avant le retour live', 200, x.jeton, { scanId: x.scanId, choix: 'a' }); const jl = await journalDe(x.scanId); if (!jl || jl.userId !== `v2:installation:${x.i._id}`) mal.push(`retour-live : ligne du journal ${jl ? 'userId ' + jl.userId : 'ABSENTE'} (attendu v2:installation:${x.i._id}) ; journal de l'enfant : ${srv.lire().split('\n').filter(l => /journal|scan/i.test(l)).slice(-4).join(' | ').slice(0, 500)}`); return x; };
        const a = await scanRepondu();
        await retour(U, 'prix lu valide', 200, a.jeton, { scanId: a.scanId, carte: 0, prixLive: 24.13, prixLiveEtat: 'ex', prixLiveCodeLangue: 2, originePrix: 'grille', verdictAffiche: 'correct' });
        await retour(U, 'second retour pour le même scan', 409, a.jeton, { scanId: a.scanId, prixLive: 99 });
        const b = await scanRepondu();
        await retour(U, 'lecture ratée définitive (remboursée sans-prix)', 200, b.jeton, { scanId: b.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        await retour(U, 'lecture ratée définitive REJOUÉE (deja-rembourse : rien de rendu une seconde fois)', 200, b.jeton, { scanId: b.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        const c = await scanRepondu();
        await retour(U, 'lecture ratée non définitive (défi Cloudflare)', 200, c.jeton, { scanId: c.scanId, lectureRatee: { cause: 'defi', definitive: false } });
        const d = await scanAmbigu(U, 3, 'a-trancher à 2 sans réponse'); await journalDe(d.scanId);
        await retour(U, 'carte-non-identifiee (lecture ratée définitive sur une question)', 409, d.jeton, { scanId: d.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        await retour(U, 'scan d\'un autre porteur', 404, (await inst(3)).jeton, { scanId: a.scanId, prixLive: 5 });
        await retour(U, 'scan inconnu', 404, a.jeton, { scanId: String(new mongoose.Types.ObjectId()), prixLive: 5 });
        await retour(U, 'scanId mal formé', 400, a.jeton, { scanId: 'pas-un-id', prixLive: 5 });
        await retour(U, 'ni prix ni lecture ratée', 400, a.jeton, { scanId: a.scanId });
        await retour(U, 'Authorization illisible', 401, 'a'.repeat(32), { scanId: a.scanId, prixLive: 5 });
        const e = await scanRepondu(), k = cle();
        await retour(U, 'prix avec clé', 200, e.jeton, { scanId: e.scanId, prixLive: 24.13 }, { cleIdem: k });
        await retour(U, 'clé réutilisée avec un autre corps', 422, e.jeton, { scanId: e.scanId, prixLive: 30 }, { cleIdem: k });
        const f = await scanRepondu(), k2 = cle();
        await claimEnCours(`installation:${f.i._id}`, 'retour-live', k2, { scanId: f.scanId, prixLive: 5 });
        await retour(U, 'même clé encore en cours', 429, f.jeton, { scanId: f.scanId, prixLive: 5 }, { cleIdem: k2 });
    }
    // solde
    {
        const x = await inst(3);
        await jouer(U, 'POST /api/solde', 'installation non liée', 200, '/api/solde', { corps: {}, entetes: extH(x.jeton) });
        const c = await compte(); const l = await instLiee(c);
        await jouer(U, 'POST /api/solde', 'installation liée à un compte vérifié', 200, '/api/solde', { corps: {}, entetes: extH(l.jeton) });
        const nv = await compte({ verifie: false, solde: { accueil: 0, achete: 0 } }); const ln = await instLiee(nv);
        await jouer(U, 'POST /api/solde', 'compte non vérifié', 200, '/api/solde', { corps: {}, entetes: extH(ln.jeton) });
        const ab = await compte({ abonnement: { actif: true, paliers: 1, expireLe: new Date(Date.now() + 20 * 86400e3), restant: 80 } }); const la = await instLiee(ab);
        await jouer(U, 'POST /api/solde', 'compte avec abonnement', 200, '/api/solde', { corps: {}, entetes: extH(la.jeton) });
        await jouer(U, 'POST /api/solde', 'jeton inconnu', 401, '/api/solde', { corps: {}, entetes: extH('b'.repeat(32)) });
        // MOYENS-B1 (O4) : le plafond horaire de l'installation (1 200), compteur posé au plafond (voir plafonner)
        const xp = await inst(3); await plafonner('solde', 'installation', xp.i._id, 1200);
        await jouer(U, 'POST /api/solde', 'plafond horaire par porteur atteint (DEBIT, Retry-After)', 429, '/api/solde', { corps: {}, entetes: extH(xp.jeton) });
    }
    // comptes côté enfant : lecture, connexion par un VRAI hachage, session -> scanner (la vraie chaîne, le data-URL rejoué)
    {
        const P = require('../comptes/mots-de-passe');
        const hash = await P.hacher(MDP);
        const c = await compte({ motDePasse: hash });
        const conn = await jouer(U, 'POST /api/compte/connexion', 'identifiants justes (Set-Cookie rm_session)', 200, '/api/compte/connexion', { corps: { email: c.c.email, motDePasse: MDP }, entetes: siteH() });
        const cookie = /rm_session=[^;]+/.exec(conn.entetes['set-cookie'] || '')?.[0];
        H.vrai('connexion (enfant) : un cookie rm_session est posé', Boolean(cookie));
        await jouer(U, 'GET /api/compte', 'session ouverte par la connexion', 200, '/api/compte', { entetes: siteH(cookie) });
    }
    // le scanner au travers du serveur enfant (le formulaire n'est pas du JSON)
    {
        const c = await compte();
        const r = await jouerFormulaire(U, 'POST /api/scanner/analyses', 'a-trancher à 2 (vraie chaîne, faux réseau du scanner)', 200, '/api/scanner/analyses', formulaire(), siteH(c.cookie));
        if (r.json && r.json.scanId) await jouer(U, 'POST /api/scanner/analyses/{id}/reponse', 'réponse « a » (vraie chaîne)', 200, `/api/scanner/analyses/${r.json.scanId}/reponse`, { corps: { choix: 'a' }, entetes: siteH(c.cookie) });
    }
    // une sonde HORS contrat : un JSON illisible ne doit pas rendre une page HTML (constat, non jugé)
    const sondeJsonIllisible = await (async () => { const r = await fetch(U + '/api/identifier', { method: 'POST', headers: { 'content-type': 'application/json', origin: EXT, ...ip() }, body: '{"x' }); const t = await r.text(); return { statut: r.status, ct: r.headers.get('content-type'), debut: t.slice(0, 40) }; })();
    srv.enfant.kill();

    // ═══════════════════════════ (b) L'ASSEMBLEUR EN PROCESSUS — les lots de production, la chaîne héritée FABRIQUÉE ═══════════════════════════
    await semer('triple');
    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources'); const { assembler, LOTS } = require('../index');          // LOTS : la liste de v2/index.js, UNE seule définition (tour 1, I7)
    H.vrai(`LOTS lu de v2/index.js : ${LOTS.length} lots`, Array.isArray(LOTS) && LOTS.length === 8);   // 7 → 8 : le lot COLLECTION entre dans LOTS (ruling 1 du lot) ; le dénominateur suit la liste, aucune garde n'est desserrée
    const { creerCourrierMemoire } = require('../comptes/courrier');
    const courrier = creerCourrierMemoire();
    registre.fournir('courrier', courrier); registre.fournir('turnstile', { verifier: async () => true });
    let mode = 'affirmee', retardLot = null;
    const etatCarte = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const affirme = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: etatCarte, candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        if (mode === 'affirmee') return res.json({ ...affirme(ID_A), scanId: sid });
        if (mode === 'sans-prix') return res.json({ ...affirme(ID_C), scanId: sid });
        if (mode === 'exception') throw new Error('boum');
        if (mode.startsWith('introuvable:')) { await req.credit.v2.rembourser(req, mode.slice(12)); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: mode.slice(12) }); }
        if (mode === 'refus-egalite') { await req.credit.v2.rembourser(req, 'egalite-parfaite'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'egalite-parfaite', candidats: [ID_A, ID_B].map(idProduct => ({ idProduct })) }); }
        if (mode === 'ia-echec') return res.json({ success: false, natureRefus: 'echec-technique', motifRefus: 'ia-echec' });
        if (mode === 'indisponible') return res.json({ success: false, natureRefus: 'echec-technique', motifRefus: 'tcgdex-injoignable' });
        if (mode === 'ambigue2' || mode === 'ambigue3') {
            const ids = mode === 'ambigue2' ? [ID_A, ID_B] : [ID_A, ID_B, ID_C];
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            return res.json({ ...affirme(ID_A), scanId: sid, question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...affirme(ID_A).carte, ambigu: true },
                candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    const lotFabrique = async () => { if (retardLot) return retardLot(); return [ID_A, ID_B, ID_C].map(id => ({ statutHttp: 200, corps: affirme(id) })); };
    const nAff = n => Array.from({ length: n }, () => ({ statutHttp: 200, corps: affirme(ID_A) }));
    const monter = async (cfgApp = cfg, deps = {}) => {
        const app = express(); app.set('trust proxy', true);
        for (const l of LOTS) l.enTete(app, cfgApp);
        app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler(LOTS, cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), banc: BANC_MEMOIRE, ...deps }));
        return H.serveur(app);
    };
    // PHOTO-EXTENSION : un banc à stockage MÉMOIRE (sans lui `POST /api/banc/photo` ne pourrait jamais rendre 200 : pas de bucket)
    const BANC_MEMOIRE = require('../banc/routes').creerBanc({ cfg, env: { V2_BANC_BUCKET: 'bucket-banc-test', V2_BANC_SEL: 'sel-contrat-reel' }, stockage: require('../banc/stockage').creerStockageMemoire() });
    const sv = await monter();
    const V = sv.url;
    // identifier : les états que SEULE la chaîne fabriquée sait produire
    {
        mode = 'affirmee';   const a = await inst(3); await ident(V, 'identifiée (verdict ferme)', 200, a.jeton);
        mode = 'affirmee';   const aq = await compte(); const al = await instLiee(aq); await ident(V, 'identifiée, compte lié (solde de compte)', 200, al.jeton);
        mode = 'sans-prix';  const sp = await inst(3); await ident(V, 'identifiée sans prix au guide (prixGuide null)', 200, sp.jeton);
        mode = 'ambigue2';   const a2 = await inst(3); await ident(V, 'a-trancher à 2', 200, a2.jeton);
        mode = 'ambigue3';   const a3 = await inst(3); await ident(V, 'a-trancher à 3', 200, a3.jeton);
        mode = 'introuvable:numero-illisible'; await ident(V, 'introuvable / photo-illisible', 200, (await inst(3)).jeton);
        mode = 'introuvable:aucun-prix';       await ident(V, 'introuvable / hors-catalogue', 200, (await inst(3)).jeton);
        mode = 'ia-echec';   await ident(V, 'panne IA remboursée', 200, (await inst(3)).jeton);
        mode = 'indisponible'; await ident(V, 'panne INDISPONIBLE (source tombée) remboursée', 503, (await inst(3)).jeton);
        mode = 'exception';  await ident(V, 'exception de la chaîne (SERVEUR) remboursée', 500, (await inst(3)).jeton);
        mode = 'affirmee';
        const svLot = await monter(cfg, { identifierLot: lotFabrique });
        const l = await inst(3); await ident(svLot.url, 'lot de 3 cartes', 200, l.jeton, corpsId({ imageUrls: [IMAGE, IMAGE, IMAGE] }));
        retardLot = async () => [...nAff(2), { statutHttp: 500, corps: null }];
        await ident(svLot.url, 'lot dont une photo est illisible (panne-lecture)', 200, (await inst(3)).jeton, corpsId({ imageUrls: [IMAGE, IMAGE, IMAGE] }));
        retardLot = async () => nAff(25);
        const unSeul = await inst(1, { achete: 0 }); await Q.poserRestant(`installation:${unSeul.i._id}`, 1, { limite: 3 });      // OFFRE-QUOTA : une seule analyse devant lui, le lot en demande 3
        await ident(svLot.url, 'lot trop grand pour le solde (QUOTA lot-trop-grand)', 429, unSeul.jeton, corpsId({ imageUrls: [IMAGE, IMAGE, IMAGE] }));
        retardLot = null;
        // le scanner sur un lot (la clé de lot passe par le même traiterIdentifier)
        const cl = await compte();
        await jouerFormulaire(svLot.url, 'POST /api/scanner/analyses', 'lot de 3 cartes (statut lot)', 200, '/api/scanner/analyses', formulaire(), siteH(cl.cookie));
        await svLot.fermer();
    }
    // réponses sur la chaîne fabriquée : à 3 candidats, choix « c »
    {
        mode = 'ambigue3'; const x = await inst(3); const r = await ident(V, 'a-trancher à 3 pour « c »', 200, x.jeton);
        await repondre(V, 'choix « c » (candidat sans prix)', 200, x.jeton, { scanId: r.json.scanId, choix: 'c' });
        mode = 'affirmee';
    }
    // ── (tour 1, section 3) les états de FACTURATION que le premier jeu ne jouait pas
    {
        const aujourdhui = Q.jourCourant(), exp = new Date(Date.now() + 3 * 86400e3);
        const plafond = async (x, type) => raw('plafonds').insertOne({ porteur: `installation:${x.i._id}`, jour: aujourdhui, type, count: cfg.plafonds[type], expireLe: exp });
        // introuvable NON remboursé : le plafond des pannes du jour est atteint, l'utilisateur PAIE (debite 1, motif plafond-jour, raisonNonRembourse)
        mode = 'introuvable:aucun-prix'; const p1 = await inst(3); await plafond(p1, 'panne');
        const r1 = await ident(V, 'introuvable NON remboursé (plafond du jour atteint : debite 1)', 200, p1.jeton);
        H.v('   … facturation { debite:1, rembourse:false, motif:plafond-jour, raisonNonRembourse:plafond-jour }', r1.json && [r1.json.facturation.debite, r1.json.facturation.rembourse, r1.json.facturation.motif, r1.json.facturation.raisonNonRembourse], [1, false, 'plafond-jour', 'plafond-jour']);
        // une exception de la chaîne dont le remboursement est refusé : 500 SERVEUR AVEC une facturation qui dit pourquoi
        mode = 'exception'; const p2 = await inst(3); await plafond(p2, 'panne');
        const r2 = await ident(V, 'panne SERVEUR NON remboursée (plafond du jour atteint)', 500, p2.jeton);
        H.v('   … facturation { debite:1, rembourse:false, raisonNonRembourse:plafond-jour }', r2.json && [r2.json.facturation.debite, r2.json.facturation.rembourse, r2.json.facturation.raisonNonRembourse], [1, false, 'plafond-jour']);
        // un refus de la chaîne par égalité (≥ 2 candidats) devient une QUESTION réservée (ruling n°2 de B1b)
        mode = 'refus-egalite'; const p3 = await inst(3);
        const r3 = await ident(V, 'refus par égalité devenu question réservée', 200, p3.jeton);
        H.v('   … a-trancher, facturation { debite:0, reserve:1, motif:question }', r3.json && [r3.json.analyse.statut, r3.json.facturation.debite, r3.json.facturation.reserve, r3.json.facturation.motif], ['a-trancher', 0, 1, 'question']);
        // repli de question : la question n'a pas pu être écrite
        const colOrig = db.col;
        const sansEcritureQuestion = () => { db.col = nom => { const c = colOrig(nom); if (nom !== 'questions_v2') return c; return new Proxy(c, { get(t, p) { if (p === 'insertOne') return async () => { throw new Error('panne simulée : écriture de la question'); }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } }); }; };
        const journalMute = console.error; console.error = () => { };
        try {
            const p4 = await inst(3); sansEcritureQuestion();
            const r4 = await ident(V, 'repli de question REMBOURSÉ (question non écrite, crédit rendu : a-trancher gratuit)', 200, p4.jeton);
            db.col = colOrig;
            H.v('   … a-trancher, facturation { debite:0, rembourse:true, motif:question }', r4.json && [r4.json.analyse.statut, r4.json.facturation.debite, r4.json.facturation.rembourse, r4.json.facturation.motif], ['a-trancher', 0, true, 'question']);
            const p5 = await inst(3); await plafond(p5, 'question'); sansEcritureQuestion();
            const r5 = await ident(V, 'repli de question NON remboursé (question non écrite ET plafond atteint : panne SERVEUR)', 500, p5.jeton);
            db.col = colOrig;
            H.v('   … SERVEUR, jamais un a-trancher, facturation { debite:1, rembourse:false, raisonNonRembourse:plafond-jour }', r5.json && [r5.json.erreur.code, r5.json.analyse, r5.json.facturation.debite, r5.json.facturation.rembourse, r5.json.facturation.raisonNonRembourse], ['SERVEUR', undefined, 1, false, 'plafond-jour']);
        } finally { db.col = colOrig; console.error = journalMute; }
        mode = 'affirmee';
        // une QUESTION dans un lot, et la RÉPONSE sur un lot (le prix du lot couvre la question : rien ne bouge)
        const candidatsLot = ids => ids.map(idProduct => ({ idProduct, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }));
        const qLot = { statutHttp: 200, corps: { ...affirme(ID_A), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...affirme(ID_A).carte, ambigu: true }, candidats: candidatsLot([ID_A, ID_B]) } };
        const svLot2 = await monter(cfg, { identifierLot: async () => [{ statutHttp: 200, corps: affirme(ID_A) }, qLot] });
        const lq = await inst(3);
        const rl = await ident(svLot2.url, 'lot dont une carte est à trancher (question DANS un lot)', 200, lq.jeton, corpsId({ imageUrls: [IMAGE, IMAGE] }));
        const iq = rl.json.analyse.cartes.find(c => c.statut === 'a-trancher');
        H.vrai('   … le lot porte bien une carte à trancher', Boolean(iq && rl.json.analyse.statut === 'lot'));
        if (iq) {
            const choixLot = iq.question.choix[0].id;
            const rr = await jouer(svLot2.url, 'POST /api/identifier/reponse', 'réponse SUR UN LOT (rien ne bouge : motif lot)', 200, '/api/identifier/reponse', { corps: { scanId: rl.json.scanId, carte: iq.index, choix: choixLot }, entetes: extH(lq.jeton) });
            H.v('   … facturation de la réponse sur un lot : { debite:0, rembourse:false, motif:lot }', rr.json && rr.json.facturation && [rr.json.facturation.debite, rr.json.facturation.rembourse, rr.json.facturation.motif], [0, false, 'lot']);
            // un abandon sur un AUTRE lot (la réponse « a » ci-dessus est la vérité du premier : une seconde, contraire, serait un 409)
            const lq2 = await inst(3); const rl2 = await ident(svLot2.url, 'lot dont une carte est à trancher (second lot, pour l\'abandon)', 200, lq2.jeton, corpsId({ imageUrls: [IMAGE, IMAGE] }));
            const iq2 = rl2.json.analyse.cartes.find(c => c.statut === 'a-trancher');
            await jouer(svLot2.url, 'POST /api/identifier/reponse', 'abandon « aucune » SUR UN LOT', 200, '/api/identifier/reponse', { corps: { scanId: rl2.json.scanId, carte: iq2.index, choix: 'aucune' }, entetes: extH(lq2.jeton) });
        }
        await svLot2.fermer();
    }
    // comptes — le parcours réel (courrier en mémoire)
    const attendreCourrier = () => require('../comptes/service').attendre();
    const postS = (route, etat, attendu, chemin, corps, entetes) => jouer(V, route, etat, attendu, chemin, { corps, entetes: entetes || siteH(null) });
    let cookie, jetonLien, compteC, jetonInst;
    {
        const email = 'a.b+promo@gmail.com';
        await postS('POST /api/compte/inscription', 'adresse neuve', 202, '/api/compte/inscription', { email, turnstile: 't' });
        await attendreCourrier();
        await postS('POST /api/compte/inscription', 'même adresse sous une autre écriture (202 neutre)', 202, '/api/compte/inscription', { email: 'ab@gmail.com', turnstile: 't' });
        await postS('POST /api/compte/inscription', 'adresse invalide', 422, '/api/compte/inscription', { email: 'pas-une-adresse', turnstile: 't' });
        await postS('POST /api/compte/inscription', 'mot de passe fourni à l\'inscription (D6 : refusé, il se choisit à la confirmation)', 422, '/api/compte/inscription', { email: 'faible@exemple.fr', motDePasse: 'abc', turnstile: 't' });
        await postS('POST /api/compte/inscription', 'motDePasse de mauvais type (refusé de même)', 422, '/api/compte/inscription', { email: 'x@exemple.fr', motDePasse: 12, turnstile: 't' });
        await postS('POST /api/compte/inscription', 'sans Origin du site', 403, '/api/compte/inscription', { email: 'y@exemple.fr' }, ip());
        const mem = ip(); for (let k = 0; k < 3; k++) await postS('POST /api/compte/inscription', 'sous le plafond par IP', 202, '/api/compte/inscription', { email: `plaf${k}@exemple.fr`, turnstile: 't' }, { ...siteH(null), ...mem });
        await postS('POST /api/compte/inscription', 'plafond par IP atteint', 429, '/api/compte/inscription', { email: 'plaf9@exemple.fr', turnstile: 't' }, { ...siteH(null), ...mem });
        await attendreCourrier();
        jetonLien = new URL(courrier.envoyes.find(e => e.type === 'verification').lien).searchParams.get('jeton');
        await postS('POST /api/compte/verification', 'lien inconnu', 404, '/api/compte/verification', { jeton: 'x'.repeat(40), motDePasse: MDP });
        await postS('POST /api/compte/verification', 'sans Origin du site', 403, '/api/compte/verification', { jeton: jetonLien, motDePasse: MDP }, ip());
        // un lien expiré : ceux de « plaf0 »
        const plaf = await raw('comptes').findOne({ emailCle: 'plaf0@exemple.fr' });
        const lienExpire = await raw('liens_email').findOne({ compteId: plaf._id });
        await raw('liens_email').updateOne({ _id: lienExpire._id }, { $set: { expireLe: new Date(Date.now() - 1000) } });
        const lienPlaf = courrier.envoyes.find(e => e.email === 'plaf0@exemple.fr');
        await postS('POST /api/compte/verification', 'lien expiré', 410, '/api/compte/verification', { jeton: new URL(lienPlaf.lien).searchParams.get('jeton'), motDePasse: MDP });
        await postS('POST /api/compte/verification', 'sans mot de passe (D6 : requis)', 400, '/api/compte/verification', { jeton: jetonLien });
        await postS('POST /api/compte/verification', 'mot de passe de mauvais type', 400, '/api/compte/verification', { jeton: jetonLien, motDePasse: 12 });
        await postS('POST /api/compte/verification', 'mot de passe trop faible (le lien n\'est pas brûlé)', 422, '/api/compte/verification', { jeton: jetonLien, motDePasse: 'abc' });
        await postS('POST /api/compte/verification', 'lien valide + mot de passe choisi (25 offertes)', 200, '/api/compte/verification', { jeton: jetonLien, motDePasse: MDP });
        const memV = ip(); for (let k = 0; k < 3; k++) await postS('POST /api/compte/verification', 'sous le plafond', 404, '/api/compte/verification', { jeton: 'y'.repeat(40), motDePasse: MDP }, { ...siteH(null), ...memV });
        await postS('POST /api/compte/verification', 'plafond par IP atteint', 429, '/api/compte/verification', { jeton: 'y'.repeat(40), motDePasse: MDP }, { ...siteH(null), ...memV });
        // connexion
        const conn = await postS('POST /api/compte/connexion', 'identifiants justes', 200, '/api/compte/connexion', { email: 'ab@gmail.com', motDePasse: MDP });
        cookie = /rm_session=[^;]+/.exec(conn.entetes['set-cookie'] || '')?.[0];
        compteC = await raw('comptes').findOne({ emailCle: 'ab@gmail.com' });
        await postS('POST /api/compte/connexion', 'mot de passe faux', 401, '/api/compte/connexion', { email: 'ab@gmail.com', motDePasse: 'faux-faux-faux' });
        await postS('POST /api/compte/connexion', 'adresse inconnue (même réponse)', 401, '/api/compte/connexion', { email: 'inconnu@exemple.fr', motDePasse: MDP });
        await postS('POST /api/compte/connexion', 'sans Origin du site', 403, '/api/compte/connexion', { email: 'ab@gmail.com', motDePasse: MDP }, ip());
        for (let k = 0; k < 10; k++) await postS('POST /api/compte/connexion', 'essais sur une adresse', 401, '/api/compte/connexion', { email: 'cible@exemple.fr', motDePasse: 'x' + k });
        await postS('POST /api/compte/connexion', 'plafond par adresse atteint', 429, '/api/compte/connexion', { email: 'cible@exemple.fr', motDePasse: 'x' });
        // oubli / réinitialisation
        await postS('POST /api/compte/mot-de-passe-oublie', 'adresse connue', 202, '/api/compte/mot-de-passe-oublie', { email: 'ab@gmail.com' });
        await postS('POST /api/compte/mot-de-passe-oublie', 'adresse inconnue (même réponse)', 202, '/api/compte/mot-de-passe-oublie', { email: 'inconnu@exemple.fr' });
        await postS('POST /api/compte/mot-de-passe-oublie', 'sans Origin du site', 403, '/api/compte/mot-de-passe-oublie', { email: 'ab@gmail.com' }, ip());
        const memO = ip(); for (let k = 0; k < 3; k++) await postS('POST /api/compte/mot-de-passe-oublie', 'sous le plafond', 202, '/api/compte/mot-de-passe-oublie', { email: 'inconnu@exemple.fr' }, { ...siteH(null), ...memO });
        await postS('POST /api/compte/mot-de-passe-oublie', 'plafond par IP atteint', 429, '/api/compte/mot-de-passe-oublie', { email: 'inconnu@exemple.fr' }, { ...siteH(null), ...memO });
        await attendreCourrier();
        const reinit = courrier.envoyes.filter(e => e.type === 'reinit' && e.email === compteC.email).pop();
        const jetonReinit = new URL(reinit.lien).searchParams.get('jeton');
        await postS('POST /api/compte/reinitialiser', 'lien inconnu', 404, '/api/compte/reinitialiser', { jeton: 'z'.repeat(40), motDePasse: 'nouveau-mot-de-passe-solide' });
        const memR = ip(); for (let k = 0; k < 3; k++) await postS('POST /api/compte/reinitialiser', 'sous le plafond', 404, '/api/compte/reinitialiser', { jeton: 'w'.repeat(40), motDePasse: 'nouveau-mot-de-passe-solide' }, { ...siteH(null), ...memR });
        await postS('POST /api/compte/reinitialiser', 'plafond par IP atteint', 429, '/api/compte/reinitialiser', { jeton: 'w'.repeat(40), motDePasse: 'nouveau-mot-de-passe-solide' }, { ...siteH(null), ...memR });
        await postS('POST /api/compte/reinitialiser', 'sans Origin du site', 403, '/api/compte/reinitialiser', { jeton: jetonReinit, motDePasse: 'nouveau-mot-de-passe-solide' }, ip());
        await postS('POST /api/compte/reinitialiser', 'mot de passe trop faible (le lien n\'est pas brûlé)', 422, '/api/compte/reinitialiser', { jeton: jetonReinit, motDePasse: 'abc' });
        await postS('POST /api/compte/reinitialiser', 'motDePasse de mauvais type', 400, '/api/compte/reinitialiser', { jeton: jetonReinit, motDePasse: 5 });
        const lr = await raw('liens_email').findOne({ type: 'reinit', compteId: compteC._id, utiliseLe: null });
        await raw('liens_email').updateOne({ _id: lr._id }, { $set: { expireLe: new Date(Date.now() - 1000) } });
        await postS('POST /api/compte/reinitialiser', 'lien expiré', 410, '/api/compte/reinitialiser', { jeton: jetonReinit, motDePasse: 'nouveau-mot-de-passe-solide' });
        await raw('liens_email').updateOne({ _id: lr._id }, { $set: { expireLe: new Date(Date.now() + 3600e3) } });
        await postS('POST /api/compte/reinitialiser', 'lien valide', 200, '/api/compte/reinitialiser', { jeton: jetonReinit, motDePasse: 'nouveau-mot-de-passe-solide' });
        // renvoi du lien de vérification (route publiée au tour 1) : la réponse ne dépend PAS de l'adresse
        const renv1 = await postS('POST /api/compte/renvoyer-verification', 'compte non vérifié', 202, '/api/compte/renvoyer-verification', { email: 'plaf1@exemple.fr' });
        const renv2 = await postS('POST /api/compte/renvoyer-verification', 'adresse inconnue (même réponse)', 202, '/api/compte/renvoyer-verification', { email: 'inconnue@exemple.fr' });
        H.v('renvoi : la réponse est identique pour une adresse connue et inconnue (octet pour octet)', renv1.texte === renv2.texte, true);
        await postS('POST /api/compte/renvoyer-verification', 'sans Origin du site', 403, '/api/compte/renvoyer-verification', { email: 'plaf1@exemple.fr' }, ip());
        const memRv = ip(); for (let k = 0; k < 3; k++) await postS('POST /api/compte/renvoyer-verification', 'sous le plafond', 202, '/api/compte/renvoyer-verification', { email: 'inconnue@exemple.fr' }, { ...siteH(null), ...memRv });
        await postS('POST /api/compte/renvoyer-verification', 'plafond par IP atteint', 429, '/api/compte/renvoyer-verification', { email: 'inconnue@exemple.fr' }, { ...siteH(null), ...memRv });
        // nouvelle session (la réinitialisation a révoqué les sessions)
        const conn2 = await H.appel(V, '/api/compte/connexion', { methode: 'POST', corps: { email: 'ab@gmail.com', motDePasse: 'nouveau-mot-de-passe-solide' }, entetes: siteH(null) });
        cookie = /rm_session=[^;]+/.exec(conn2.entetes['set-cookie'] || '')?.[0];
        H.vrai('connexion après réinitialisation : un cookie est posé', Boolean(cookie));
        // installation → code → liaison
        const instR = await jouer(V, 'POST /api/installation', 'créée (assembleur)', 201, '/api/installation', { corps: { versionExtension: '2.0.0', libelle: 'Chrome · Windows' }, entetes: ip() });
        jetonInst = instR.json.jetonInstallation;
        const code = await jouer(V, 'POST /api/compte/code', 'session ouverte', 200, '/api/compte/code', { corps: {}, entetes: siteH(cookie) });
        await jouer(V, 'POST /api/compte/code', 'sans session', 401, '/api/compte/code', { corps: {}, entetes: siteH(null) });
        await jouer(V, 'POST /api/compte/code', 'sans Origin du site', 403, '/api/compte/code', { corps: {}, entetes: { cookie, ...ip() } });
        await jouer(V, 'POST /api/compte/code', 'deuxième code vivant', 200, '/api/compte/code', { corps: {}, entetes: siteH(cookie) });
        await jouer(V, 'POST /api/compte/code', 'troisième code vivant', 200, '/api/compte/code', { corps: {}, entetes: siteH(cookie) });
        await jouer(V, 'POST /api/compte/code', 'trop de codes vivants (DEBIT, Retry-After)', 429, '/api/compte/code', { corps: {}, entetes: siteH(cookie) });
        await jouer(V, 'POST /api/compte/lier', 'sans Authorization', 401, '/api/compte/lier', { corps: { code: code.json.code }, entetes: ip() });
        await jouer(V, 'POST /api/compte/lier', 'code inconnu', 404, '/api/compte/lier', { corps: { code: 'ZZZZZZ' }, entetes: extH(jetonInst) });
        const codeExpire = J.genererCode(6);
        await raw('codes_liaison').insertOne({ codeEmpreinte: J.empreinte(codeExpire), compteId: compteC._id, creeLe: new Date(), expireLe: new Date(Date.now() - 1000), utiliseLe: null });
        await jouer(V, 'POST /api/compte/lier', 'code expiré', 410, '/api/compte/lier', { corps: { code: codeExpire }, entetes: extH(jetonInst) });
        const lie = await jouer(V, 'POST /api/compte/lier', 'code valide', 200, '/api/compte/lier', { corps: { code: code.json.code }, entetes: extH(jetonInst) });
        const jetonLie = lie.json && lie.json.jetonInstallation;
        // LOT IDEMPOTENCE-INSTALLATION : lier avec Idempotency-Key, rejeu avec l'ANCIEN jeton (même nouveau jeton), puis la clé réutilisée avec un autre code (422)
        {
            const code2 = await jouer(V, 'POST /api/compte/code', 'code pour une liaison avec clé', 200, '/api/compte/code', { corps: {}, entetes: siteH(cookie) });
            const x = await inst(0), kL = cle();
            const l1 = await jouer(V, 'POST /api/compte/lier', 'avec Idempotency-Key', 200, '/api/compte/lier', { corps: { code: code2.json.code }, entetes: extH(x.jeton, { 'idempotency-key': kL }) });
            const l2 = await jouer(V, 'POST /api/compte/lier', 'rejeu de la même clé avec l\'ancien jeton (même nouveau jeton)', 200, '/api/compte/lier', { corps: { code: code2.json.code }, entetes: extH(x.jeton, { 'idempotency-key': kL }) });
            H.v('POST /api/compte/lier : le rejeu rend le même corps, marqué rejoué', [l2.texte === l1.texte, l2.entetes['idempotency-replayed']], [true, 'true']);
            await jouer(V, 'POST /api/compte/lier', 'clé réutilisée avec un autre code', 422, '/api/compte/lier', { corps: { code: 'ABCDEF' }, entetes: extH(x.jeton, { 'idempotency-key': kL }) });
        }
        await jouer(V, 'POST /api/compte/lier', 'installation déjà liée', 409, '/api/compte/lier', { corps: { code: 'ABCDEF' }, entetes: extH(jetonLie) });
        const seul = await inst(3);
        for (let k = 0; k < 5; k++) await jouer(V, 'POST /api/compte/lier', 'essais sous le plafond', 404, '/api/compte/lier', { corps: { code: 'ZZZZZZ' }, entetes: extH(seul.jeton) });
        await jouer(V, 'POST /api/compte/lier', 'plafond par installation atteint', 429, '/api/compte/lier', { corps: { code: 'ZZZZZZ' }, entetes: extH(seul.jeton) });
        // lecture du compte : de VRAIES analyses (par l'installation liée, chaîne fabriquée) et le VRAI mouvement d'octroi de la vérification
        mode = 'affirmee';
        // OFFRE-QUOTA : 22 analyses dépassent les 10 du jour du compte gratuit — le compte est Pro (abonnement actif, plafond technique 200) le temps de cette série, puis redevient gratuit.
        await raw('comptes').updateOne({ _id: compteC._id }, { $set: { abonnement: { actif: true, jusquAu: new Date(Date.now() + 30 * 86400e3) } } });
        for (let k = 0; k < 22; k++) await ident(V, 'analyse pour l\'historique du compte', 200, jetonLie);
        await raw('comptes').updateOne({ _id: compteC._id }, { $unset: { abonnement: '' } });
        const g1 = await jouer(V, 'GET /api/compte', 'compte vérifié, installation liée, historique PAGINÉ (page 1)', 200, '/api/compte', { entetes: siteH(cookie) });
        const g1l = (g1.json && g1.json.historique.lignes) || [];
        H.v('GET /api/compte page 1 : 20 lignes, suite non nulle ; au moins UNE ligne analyse et (sur l\'ensemble des pages) UNE ligne credits', [g1l.length, typeof g1.json.historique.suite, g1l.some(l => l.genre === 'analyse')], [20, 'string', true]);
        const g2 = await jouer(V, 'GET /api/compte', 'historique PAGINÉ (page 2, curseur suite)', 200, `/api/compte?suite=${encodeURIComponent(g1.json.historique.suite)}`, { entetes: siteH(cookie) });
        const g2l = (g2.json && g2.json.historique.lignes) || [];
        H.v('GET /api/compte page 2 : le reste (3 lignes dont le crédit d\'octroi), suite nulle, aucune ligne en double avec la page 1', [g2l.length, g2.json.historique.suite, g2l.some(l => l.genre === 'credits'), new Set([...g1l, ...g2l].map(l => JSON.stringify(l))).size], [3, null, true, 23]);
        const g400 = await jouer(V, 'GET /api/compte', 'curseur de suite falsifié (400 ENTREE, une faute du client — plus un 503)', 400, '/api/compte?suite=%25%25pas-une-suite', { entetes: siteH(cookie) });
        H.v('   … 400 ENTREE, detail « suite »', g400.json && [g400.json.erreur.code, g400.json.erreur.detail], ['ENTREE', 'suite']);
        await jouer(V, 'GET /api/compte', 'curseur de suite répété (deux paramètres : pas une chaîne) → 400', 400, '/api/compte?suite=a&suite=b', { entetes: siteH(cookie) });
        await jouer(V, 'GET /api/compte', 'curseur de suite vide → 400 (jamais la première page en silence)', 400, '/api/compte?suite=', { entetes: siteH(cookie) });
        await jouer(V, 'GET /api/compte', 'curseur de suite trop long (> 200) → 400', 400, `/api/compte?suite=${'a'.repeat(201)}`, { entetes: siteH(cookie) });
        // un compte à abonnement, un compte non vérifié, un compte à plusieurs installations
        const cab = await compte({ abonnement: { actif: true, quotaMensuel: 100, moisCle: new Date().toISOString().slice(0, 7), restant: 40, jusquAu: new Date(Date.now() + 40 * 86400e3) } });
        const gab = await jouer(V, 'GET /api/compte', 'compte à abonnement actif', 200, '/api/compte', { entetes: siteH(cab.cookie) });
        H.v('   … l\'abonnement est servi (restant 40 / quota 100)', gab.json && gab.json.solde.abonnement && [gab.json.solde.abonnement.restant, gab.json.solde.abonnement.quotaMensuel], [40, 100]);
        const cnv = await compte({ verifie: false, solde: { accueil: 25, achete: 0 } });
        // O3 : un compte non confirmé n'est plus un porteur — sa session ne lit rien (401 SESSION), même avec un accueil écrit en base
        await jouer(V, 'GET /api/compte', 'compte NON vérifié (O3 : plus un porteur)', 401, '/api/compte', { entetes: siteH(cnv.cookie) });
        const cmu = await compte(); for (let k = 0; k < 3; k++) await instLiee(cmu, { libelle: `Poste ${k}` });
        const gmu = await jouer(V, 'GET /api/compte', 'compte à PLUSIEURS installations', 200, '/api/compte', { entetes: siteH(cmu.cookie) });
        H.v('   … trois installations servies', gmu.json && gmu.json.installations.length, 3);
        await jouer(V, 'GET /api/compte', 'sans session', 401, '/api/compte', { entetes: ip() });
        // MOYENS-B1 (O4) : le plafond horaire du compte (600). Le compteur de la fenêtre courante est posé AU PLAFOND (la frontière d'heure est évitée en tête de banc) : la requête suivante est la 601e.
        const cpl = await compte(); await plafonner('compte-lecture', 'compte', cpl.c._id, 600);
        await jouer(V, 'GET /api/compte', 'plafond horaire par compte atteint (DEBIT, Retry-After)', 429, '/api/compte', { entetes: siteH(cpl.cookie) });
        const idLiee = (await raw('installations').findOne({ compteId: compteC._id }))._id;
        const autreC = await compte(); const autreI = await instLiee(autreC);
        await jouer(V, 'DELETE /api/compte/installations/{id}', 'installation d\'un autre compte (404, rien révélé)', 404, `/api/compte/installations/${autreI.i._id}`, { entetes: siteH(cookie) });
        await jouer(V, 'DELETE /api/compte/installations/{id}', 'sans session', 401, `/api/compte/installations/${idLiee}`, { entetes: siteH(null) });
        await jouer(V, 'DELETE /api/compte/installations/{id}', 'sans Origin du site', 403, `/api/compte/installations/${idLiee}`, { entetes: { cookie, ...ip() } });
        const dl = await jouer(V, 'POST /api/compte/delier', 'installation liée', 200, '/api/compte/delier', { corps: {}, entetes: extH(jetonLie) });
        void dl;
        await jouer(V, 'POST /api/compte/delier', 'jeton inconnu', 401, '/api/compte/delier', { corps: {}, entetes: extH('c'.repeat(32)) });
        const jetonR = J.genererJeton(); const iR = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jetonR), essais: 0, libelle: 'à révoquer' }), { compteId: compteC._id });
        await raw('installations').insertOne(iR);
        await jouer(V, 'DELETE /api/compte/installations/{id}', 'installation du compte', 200, `/api/compte/installations/${iR._id}`, { entetes: siteH(cookie) });
        // déconnexion, suppression
        await jouer(V, 'POST /api/compte/deconnexion', 'sans Origin du site', 403, '/api/compte/deconnexion', { corps: {}, entetes: ip() });
        await jouer(V, 'DELETE /api/compte', 'sans session', 401, '/api/compte', { corps: { motDePasse: MDP }, entetes: siteH(null) });
        await jouer(V, 'DELETE /api/compte', 'sans Origin du site', 403, '/api/compte', { corps: { motDePasse: 'nouveau-mot-de-passe-solide' }, entetes: { cookie, ...ip() } });
        await jouer(V, 'DELETE /api/compte', 'mot de passe faux (IDENTIFIANTS)', 401, '/api/compte', { corps: { motDePasse: 'faux-faux-faux' }, entetes: siteH(cookie) });
        const ach = await compte({ motDePasse: await require('../comptes/mots-de-passe').hacher(MDP), solde: { accueil: 0, achete: 5 } });
        await jouer(V, 'DELETE /api/compte', 'crédits achetés sans renonciation (CREDITS_ACHETES)', 409, '/api/compte', { corps: { motDePasse: MDP }, entetes: siteH(ach.cookie) });
        await jouer(V, 'POST /api/compte/deconnexion', 'session ouverte', 200, '/api/compte/deconnexion', { corps: {}, entetes: siteH(cookie) });
        const conn3 = await H.appel(V, '/api/compte/connexion', { methode: 'POST', corps: { email: 'ab@gmail.com', motDePasse: 'nouveau-mot-de-passe-solide' }, entetes: siteH(null) });
        const cookie3 = /rm_session=[^;]+/.exec(conn3.entetes['set-cookie'] || '')?.[0];
        await jouer(V, 'DELETE /api/compte', 'mot de passe juste', 200, '/api/compte', { corps: { motDePasse: 'nouveau-mot-de-passe-solide' }, entetes: siteH(cookie3) });
    }
    // solde d'un compte à abonnement, côté assembleur (le même schéma)
    // le scanner — l'assembleur
    {
        const scan = (etat, attendu, c, { form = formulaire(), entetes } = {}) => jouerFormulaire(V, 'POST /api/scanner/analyses', etat, attendu, '/api/scanner/analyses', form, entetes || siteH(c && c.cookie));
        const c = await compte();
        mode = 'affirmee';  const r1 = await scan('identifiée (prixLive null, regleVerdict null)', 200, c);
        mode = 'sans-prix'; await scan('identifiée sans prix au guide (remboursée sans-prix)', 200, await compte());
        mode = 'ambigue2';  const ra2 = await scan('a-trancher à 2', 200, c);
        mode = 'ambigue3';  const ra3 = await scan('a-trancher à 3', 200, c);
        mode = 'introuvable:aucun-prix'; await scan('introuvable / hors-catalogue', 200, c);
        mode = 'ia-echec';  await scan('panne IA remboursée', 200, c);
        mode = 'exception'; await scan('exception de la chaîne (SERVEUR)', 500, c);
        mode = 'affirmee';
        await scan('PNG, source=fichier', 200, c, { form: formulaire({ image: PNG, type: 'image/png', source: 'fichier' }) });
        await scan('administrateur', 200, await compte({ role: 'administrateur' }));
        await scan('sans session', 401, null);
        await scan('compte non vérifié (O3 : plus un porteur)', 401, await compte({ verifie: false, solde: { accueil: 0, achete: 0 } }));
        await scan('Origin de l\'extension', 403, c, { entetes: { origin: EXT, 'x-rat-market': '1', cookie: c.cookie, ...ip() } });
        await scan('octets d\'exécutable', 415, c, { form: formulaire({ image: EXE }) });
        await scan('partie image vide', 422, c, { form: formulaire({ image: Buffer.alloc(0) }) });
        await scan('source hors liste', 400, c, { form: formulaire({ source: 'url' }) });
        const vide = await compte({ solde: { accueil: 0, achete: 0 } });
        await Q.poserRestant(`compte:${vide.c._id}`, 0, { limite: 10 });      // OFFRE-QUOTA : les 10 analyses du jour sont déjà prises
        await scan('QUOTA compte (offre restant 0)', 429, vide);
        // une clé déjà en cours (429 DEBIT) : l'empreinte du corps est celle que le serveur calcule (source + sha256 de l'image)
        const k = cle(); await claimEnCours(`compte:${c.c._id}`, 'scanner', k, { source: 'camera', image: crypto.createHash('sha256').update(JPEG).digest('hex') });
        await scan('même Idempotency-Key encore en cours (DEBIT)', 429, c, { entetes: siteH(c.cookie, { 'idempotency-key': k }) });
        // 413 : Content-Length annoncé trop grand
        await (async () => {
            const u = new URL(V + '/api/scanner/analyses'); const http = require('http');
            const rep = await new Promise(res => { const q = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=BBB', 'content-length': String(13 * 1024 * 1024 + 70000), ...siteH(c.cookie) } },
                r => { let t = ''; r.on('data', d => { t += d; }); r.on('end', () => res({ statut: r.statusCode, texte: t, entetes: r.headers })); }); q.on('error', () => res({ statut: 0, texte: '', entetes: {} })); q.write(Buffer.alloc(2000, 1)); });
            let json = null; try { json = JSON.parse(rep.texte); } catch { /* */ }
            consigner('POST /api/scanner/analyses', 'Content-Length annoncé > 12 Mo (413, connexion fermée)', { ...rep, json });
            if (rep.statut !== 413) mal.push(`POST /api/scanner/analyses [413] : statut ${rep.statut}`);
        })();
        // 408 : un client trop lent, sur un montage à échéance courte
        const svLent = await monter(cfg, { scannerDelaiLectureMs: 300 });
        await (async () => {
            const u = new URL(svLent.url + '/api/scanner/analyses'); const http = require('http');
            const rep = await new Promise(res => { const q = http.request({ host: u.hostname, port: u.port, path: u.pathname, method: 'POST', headers: { 'content-type': 'multipart/form-data; boundary=BBB', 'content-length': '5000', ...siteH(c.cookie) } },
                r => { let t = ''; r.on('data', d => { t += d; }); r.on('end', () => res({ statut: r.statusCode, texte: t, entetes: r.headers })); }); q.on('error', () => res({ statut: 0, texte: '', entetes: {} })); q.write('--BBB\r\n'); });
            let json = null; try { json = JSON.parse(rep.texte); } catch { /* */ }
            consigner('POST /api/scanner/analyses', 'client trop lent (408, connexion fermée)', { ...rep, json });
            if (rep.statut !== 408) mal.push(`POST /api/scanner/analyses [408] : statut ${rep.statut}`);
        })();
        await svLent.fermer();
        // 500 : une exception du lecteur de corps APRÈS la prise de la porte
        const MP = require('../scanner/multipart'), orig = MP.lireMultipart;
        MP.lireMultipart = async () => { throw new TypeError('défaut simulé'); };
        try { await scan('exception du lecteur de corps (SERVEUR)', 500, c); } finally { MP.lireMultipart = orig; }
        // la réponse à une question au scanner
        const rep = (etat, attendu, cc, scanId, corps, entetes) => jouer(V, 'POST /api/scanner/analyses/{id}/reponse', etat, attendu, `/api/scanner/analyses/${scanId}/reponse`, { corps, entetes: entetes || siteH(cc && cc.cookie) });
        if (!(ra2.json && ra2.json.analyse && ra2.json.analyse.cartes[0].question)) { console.log('   anomalies du banc avant arrêt :', JSON.stringify(mal), JSON.stringify(ra2.json).slice(0, 400)); }
        const idA2 = ra2.json.scanId, ch2 = ra2.json.analyse.cartes[0].question.choix;
        await rep('choix « a »', 200, c, idA2, { choix: ch2[0].id, carte: 0 });
        await rep('rejeu du même choix', 200, c, idA2, { choix: ch2[0].id });
        await rep('réponse contradictoire', 409, c, idA2, { choix: ch2[1].id });
        await rep('scan d\'un autre compte', 404, await compte(), idA2, { choix: ch2[0].id });
        await rep('sans session', 401, null, idA2, { choix: 'a' });
        await rep('sans Origin du site', 403, c, idA2, { choix: 'a' }, { cookie: c.cookie, ...ip() });
        await rep('identifiant illisible dans le chemin', 400, c, 'pas-un-id', { choix: 'a' });
        const idA3 = ra3.json.scanId, ch3 = ra3.json.analyse.cartes[0].question.choix;
        await rep('choix « c » (candidat sans prix, remboursé sans-prix)', 200, c, idA3, { choix: ch3[2].id });
        mode = 'ambigue2'; const rb = await scan('a-trancher à 2 pour « aucune »', 200, c);
        const rc = await scan('a-trancher à 2 pour « ne-sait-pas »', 200, c);
        const rd = await scan('a-trancher à 2 pour une question expirée', 200, c);
        mode = 'affirmee';
        await rep('choix « aucune »', 200, c, rb.json.scanId, { choix: 'aucune' });
        await rep('choix « ne-sait-pas »', 200, c, rc.json.scanId, { choix: 'ne-sait-pas' });
        await raw('questions_v2').updateOne({ _id: `${rd.json.scanId}:0` }, { $set: { poseeLe: new Date(Date.now() - 72 * 3600e3) } });
        await rep('question abandonnée après 24 h', 410, c, rd.json.scanId, { choix: 'a' });
        const k2 = cle(); await claimEnCours(`compte:${c.c._id}`, 'reponse-scanner', k2, { choix: 'a', scanId: rb.json.scanId });
        await rep('même Idempotency-Key encore en cours (DEBIT)', 429, c, rb.json.scanId, { choix: 'a' }, siteH(c.cookie, { 'idempotency-key': k2 }));
        void r1;
    }
    // « Ma collection » (lot COLLECTION) : chaque statut documenté des trois routes, sur un montage aux bornes et au limiteur RÉDUITS (2 clés par set, 3 par compte, 5 écritures par heure) pour les atteindre sans milliers de requêtes
    {
        // COLLECTION-COMPACTE : le catalogue EN MÉMOIRE connaît S1 (1|1, 2|1) et S2 (3|1, 4|1) : leurs clés entrent au REGISTRE ; celles de « Banc-Set » n'y sont pas : elles vont dans `hors` (2 au plus ici)
        const etatMem = require('../chargeur/etat'), versionAvant = etatMem.version();
        VB.installer([VB.doc(1)], [['S1', '1|1', [1]], ['S1', '2|1', [1]], ['S2', '3|1', [1]], ['S2', '4|1', [1]]]);
        const cfgC = { ...cfg, limites: { ...cfg.limites, collectionEcrituresParCompteHeure: 5 }, collection: { ...cfg.collection, horsCatalogueParCompte: 2, clesParCompte: 3, setsParCompte: 10 } };
        const svC = await monter(cfgC), U = svC.url;
        // TOUR 1 (I2) : aucun catalogue chargé → une clé neuve rend 503 INDISPONIBLE (detail catalogue, reessayerDans, Retry-After) ; le catalogue se charge ensuite
        etatMem.vider(); const cS = await compte();
        await jouer(U, 'PUT /api/collection/sets/{slug}/fiches/{cle}', 'aucun catalogue chargé (INDISPONIBLE, detail catalogue)', 503, '/api/collection/sets/Banc-Set/fiches/' + encodeURIComponent('895789|001'), { corps: { possedee: true }, entetes: siteH(cS.cookie) });
        VB.installer([VB.doc(1)], [['S1', '1|1', [1]], ['S1', '2|1', [1]], ['S2', '3|1', [1]], ['S2', '4|1', [1]]]);
        const ch = (slug, cle) => `/api/collection/sets/${encodeURIComponent(slug)}/fiches/${encodeURIComponent(cle)}`;
        const R_PUT = 'PUT /api/collection/sets/{slug}/fiches/{cle}', R_SET = 'GET /api/collection/sets/{slug}', R_LISTE = 'GET /api/collection';
        const c1 = await compte();
        await jouer(U, R_LISTE, 'compte sans rien de coché', 200, '/api/collection', { entetes: siteH(c1.cookie) });
        await jouer(U, R_SET, 'set jamais touché (possedees [], majLe null)', 200, '/api/collection/sets/Banc-Set', { entetes: siteH(c1.cookie) });
        await jouer(U, R_PUT, 'cocher une fiche', 200, ch('Banc-Set', '895789|001'), { corps: { possedee: true }, entetes: siteH(c1.cookie) });
        await jouer(U, R_PUT, 'cocher une fiche sans numéro (« - »)', 200, ch('Banc-Set', '895790|-'), { corps: { possedee: true }, entetes: siteH(c1.cookie) });
        await jouer(U, R_PUT, 'clés hors catalogue pleines (CONFLIT borne-hors)', 409, ch('Banc-Set', '895791|001'), { corps: { possedee: true }, entetes: siteH(c1.cookie) });
        await jouer(U, R_LISTE, 'compte avec un set coché', 200, '/api/collection', { entetes: siteH(c1.cookie) });
        await jouer(U, R_SET, 'set coché (deux clés, cotes {})', 200, '/api/collection/sets/Banc-Set', { entetes: siteH(c1.cookie) });
        const c2 = await compte();
        await jouer(U, R_PUT, 'compte : première fiche', 200, ch('S1', '1|1'), { corps: { possedee: true }, entetes: siteH(c2.cookie) });
        await jouer(U, R_PUT, 'compte : deuxième fiche', 200, ch('S1', '2|1'), { corps: { possedee: true }, entetes: siteH(c2.cookie) });
        await jouer(U, R_PUT, 'compte : troisième fiche, autre set', 200, ch('S2', '3|1'), { corps: { possedee: true }, entetes: siteH(c2.cookie) });
        await jouer(U, R_PUT, 'compte plein (borne par compte, CONFLIT borne-compte)', 409, ch('S2', '4|1'), { corps: { possedee: true }, entetes: siteH(c2.cookie) });
        await jouer(U, R_PUT, 'décocher', 200, ch('S2', '3|1'), { corps: { possedee: false }, entetes: siteH(c2.cookie) });
        const c3 = await compte();
        for (let i = 1; i <= 5; i++) await jouer(U, R_PUT, `écriture ${i} sur 5 permises`, 200, ch('S1', `${Math.ceil(i / 2)}|1`), { corps: { possedee: i % 2 === 1 }, entetes: siteH(c3.cookie) });
        await jouer(U, R_PUT, 'limiteur d\'écriture dépassé (DEBIT, Retry-After)', 429, ch('S1', '9|1'), { corps: { possedee: true }, entetes: siteH(c3.cookie) });
        const c4 = await compte();
        await jouer(U, R_SET, 'slug illisible (ENTREE slug)', 400, '/api/collection/sets/a%20b', { entetes: siteH(c4.cookie) });
        await jouer(U, R_PUT, 'clé mal formée (ENTREE cle)', 400, ch('S1', 'abc'), { corps: { possedee: true }, entetes: siteH(c4.cookie) });
        await jouer(U, R_PUT, 'corps sans booléen (ENTREE possedee)', 400, ch('S1', '1|1'), { corps: { possedee: 'oui' }, entetes: siteH(c4.cookie) });
        await jouer(U, R_LISTE, 'sans session', 401, '/api/collection', { entetes: siteH(null) });
        await jouer(U, R_SET, 'sans session', 401, '/api/collection/sets/Banc-Set', { entetes: siteH(null) });
        await jouer(U, R_PUT, 'sans session', 401, ch('S1', '1|1'), { corps: { possedee: true }, entetes: siteH(null) });
        await jouer(U, R_PUT, 'sans Origin du site (ORIGINE)', 403, ch('S1', '1|1'), { corps: { possedee: true }, entetes: { cookie: c4.cookie, ...ip() } });
        const cnv = await compte({ verifie: false });
        await jouer(U, R_PUT, 'compte non vérifié (O3 : plus un porteur)', 401, ch('S1', '1|1'), { corps: { possedee: true }, entetes: siteH(cnv.cookie) });
        // COLLECTION-COMPACTE : la quantité facultative des doubles, et le budget du service (CONFLIT borne-service) à un montage au plafond d'octets
        const c5 = await compte();
        await jouer(U, R_PUT, 'cocher avec une quantité (doubles)', 200, ch('S1', '2|1'), { corps: { possedee: true, quantite: 3 }, entetes: siteH(c5.cookie) });
        await jouer(U, R_SET, 'set avec une quantité ≥ 2 (`quantites`)', 200, '/api/collection/sets/S1', { entetes: siteH(c5.cookie) });
        await jouer(U, R_PUT, 'quantité hors 1…99 (ENTREE quantite)', 400, ch('S1', '2|1'), { corps: { possedee: true, quantite: 100 }, entetes: siteH(c5.cookie) });
        await svC.fermer();
        const baseOctets = await require('../collection/service').recompter(cfg);
        const svB = await monter({ ...cfgC, limites: { ...cfgC.limites, collectionEcrituresParCompteHeure: 50 }, collection: { ...cfgC.collection, octetsService: baseOctets } });
        const c6 = await compte();
        await jouer(svB.url, R_PUT, 'budget du service atteint (CONFLIT borne-service)', 409, ch('S1', '4|1'), { corps: { possedee: true }, entetes: siteH(c6.cookie) });
        await svB.fermer();
        if (versionAvant) etatMem.installer(versionAvant); else etatMem.vider();
    }
    // le banc réel (routes publiées au tour 1) et le paiement (route servie, NON publiée : « publiée quand implémentée »)
    {
        const x = await inst(3); mode = 'affirmee';
        const sx = await ident(V, 'analyse pour la correction du banc', 200, x.jeton);
        await jouer(V, 'POST /api/banc/correction', 'scan du porteur, sans consentement (200 quoi qu\'il arrive : la route ne dit pas si elle conserve)', 200, '/api/banc/correction', { corps: { scanId: sx.json.scanId, idProduct: ID_A }, entetes: extH(x.jeton) });
        await jouer(V, 'POST /api/banc/correction', 'scan inconnu', 404, '/api/banc/correction', { corps: { scanId: String(new mongoose.Types.ObjectId()), idProduct: ID_A }, entetes: extH(x.jeton) });
        await jouer(V, 'POST /api/banc/correction', 'scanId mal formé', 400, '/api/banc/correction', { corps: { scanId: 'x', idProduct: ID_A }, entetes: extH(x.jeton) });
        await jouer(V, 'POST /api/banc/correction', 'sans Authorization', 401, '/api/banc/correction', { corps: { scanId: sx.json.scanId, idProduct: ID_A }, entetes: extH(null) });
        await jouer(V, 'POST /api/banc/correction', 'le scan d\'un AUTRE porteur (404, rien révélé)', 404, '/api/banc/correction', { corps: { scanId: sx.json.scanId, idProduct: ID_A }, entetes: extH((await inst(3)).jeton) });
        const jetonContribution = 'jeton-inconnu-abcdefghij1234';
        await jouer(V, 'DELETE /api/banc/contributions', 'jeton inconnu (200, supprimees 0)', 200, '/api/banc/contributions', { corps: { jeton: jetonContribution }, entetes: extH(x.jeton) });
        await jouer(V, 'DELETE /api/banc/contributions', 'forme de jeton invalide', 400, '/api/banc/contributions', { corps: { jeton: 'x' }, entetes: extH(x.jeton) });
        await jouer(V, 'DELETE /api/banc/contributions', 'sans Authorization', 401, '/api/banc/contributions', { corps: { jeton: jetonContribution }, entetes: extH(null) });
        // ETIQUETAGE-A : l'étiquette d'un administrateur sur SON scan (compte administrateur + installation liée) ; tous les statuts documentés sont joués par un état réel (hors 503 : garde d'index)
        {
            const R = 'POST /api/banc/etiquette', CH = '/api/banc/etiquette';
            const adm = await compte({ role: 'administrateur' }), xa = await instLiee(adm), adm2 = await compte({ role: 'administrateur' }), xa2 = await instLiee(adm2);
            mode = 'affirmee';
            const aff = await ident(V, 'analyse affirmée de l\'administrateur (pour l\'étiquette)', 200, xa.jeton);
            mode = 'ambigue2';
            const que = await ident(V, 'analyse à question de l\'administrateur (pour l\'étiquette)', 200, xa.jeton);
            mode = 'affirmee';
            await jouer(V, R, 'juste sur une affirmation (ecrit)', 200, CH, { corps: { scanId: aff.json.scanId, verdict: 'juste', rev: 1 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'même rev, même contenu (rejoue)', 200, CH, { corps: { scanId: aff.json.scanId, verdict: 'juste', rev: 1 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'corrige avec un idProduct du catalogue, rev plus grand (écrase)', 200, CH, { corps: { scanId: aff.json.scanId, verdict: 'corrige', idProduct: ID_B, rev: 2 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'corrige « hors catalogue » sur la question', 200, CH, { corps: { scanId: que.json.scanId, verdict: 'corrige', aucune: 'hors-catalogue', rev: 1 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'juste sur une question (corriger est exigé)', 409, CH, { corps: { scanId: que.json.scanId, verdict: 'juste', rev: 2 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'même rev, autre contenu', 409, CH, { corps: { scanId: aff.json.scanId, verdict: 'corrige', idProduct: ID_A, rev: 2 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'idProduct inconnu du catalogue', 422, CH, { corps: { scanId: aff.json.scanId, verdict: 'corrige', idProduct: 999999999, rev: 3 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'scanId mal formé', 400, CH, { corps: { scanId: 'x', verdict: 'juste', rev: 1 }, entetes: extH(xa.jeton) });
            await jouer(V, R, 'sans Authorization', 401, CH, { corps: { scanId: aff.json.scanId, verdict: 'juste', rev: 1 }, entetes: extH(null) });
            {   // installation sans compte administrateur : le 404 NATIF d'une route inexistante (corps non JSON) — hors schéma par construction, déclaré comme tel
                const rn = await H.appel(V, CH, { methode: 'POST', corps: { scanId: aff.json.scanId, verdict: 'juste', rev: 1 }, entetes: extH(x.jeton) });
                consignerHorsContrat(R, 'installation sans compte administrateur (404 natif d\'une route inexistante, corps non JSON)', rn);
                if (rn.statut !== 404 || rn.json !== null) mal.push(`${R} [non-administrateur] : statut ${rn.statut}, attendu le 404 natif non JSON`);
            }
            await jouer(V, R, 'scan d\'un autre administrateur', 404, CH, { corps: { scanId: aff.json.scanId, verdict: 'juste', rev: 1 }, entetes: extH(xa2.jeton) });
            const adm3 = await compte({ role: 'administrateur' }), xa3 = await instLiee(adm3);      // un compteur neuf : celui d'adm2 existe déjà (sa requête de 404 l'a ouvert)
            await plafonner('banc-etiquette', 'compte', adm3.c._id, 600);
            await jouer(V, R, 'plafond de 600 par heure atteint (DEBIT, Retry-After)', 429, CH, { corps: { scanId: aff.json.scanId, verdict: 'juste', rev: 1 }, entetes: extH(xa3.jeton) });
        }
        // PHOTO-EXTENSION (recadrage) : la photo d'un administrateur sur SON scan ; tous les statuts documentés sont joués par un état réel (hors 503 : garde d'index)
        {
            const R = 'POST /api/banc/photo', CH = '/api/banc/photo';
            const sharp = require('sharp');
            const JPG = await sharp(crypto.randomBytes(120 * 160 * 3), { raw: { width: 120, height: 160, channels: 3 } }).jpeg().toBuffer();
            const adm = await compte({ role: 'administrateur' }), xa = await instLiee(adm), adm2 = await compte({ role: 'administrateur' }), xa2 = await instLiee(adm2);
            mode = 'affirmee';
            const aff = await ident(V, 'analyse affirmée de l\'administrateur (pour la photo)', 200, xa.jeton);
            const q = `${CH}?scanId=${aff.json.scanId}`;
            await jouerBinaire(V, R, 'photo conservée (ecrit)', 200, q, JPG, 'image/jpeg', extH(xa.jeton));
            await jouerBinaire(V, R, 'la photo existe déjà (deja)', 200, q, JPG, 'image/jpeg', extH(xa.jeton));
            await jouerBinaire(V, R, 'scanId mal formé', 400, `${CH}?scanId=x`, JPG, 'image/jpeg', extH(xa.jeton));
            await jouerBinaire(V, R, 'sans Authorization', 401, q, JPG, 'image/jpeg', extH(null));
            {   // installation sans compte administrateur : le 404 NATIF d'une route inexistante (corps non JSON) — hors schéma par construction, déclaré comme tel
                const rn = await jouerBinaireBrut(V, q, JPG, 'image/jpeg', extH(x.jeton));
                consignerHorsContrat(R, 'installation sans compte administrateur (404 natif d\'une route inexistante, corps non JSON)', rn);
                if (rn.statut !== 404 || rn.json !== null) mal.push(`${R} [non-administrateur] : statut ${rn.statut}, attendu le 404 natif non JSON`);
            }
            await jouerBinaire(V, R, 'scan d\'un autre administrateur', 404, q, JPG, 'image/jpeg', extH(xa2.jeton));
            const aff2 = await ident(V, 'seconde analyse de l\'administrateur (pour la photo)', 200, xa.jeton);
            const q2 = `${CH}?scanId=${aff2.json.scanId}`;
            await jouerBinaire(V, R, 'plus de 2 Mio (413)', 413, q2, JPG, 'image/jpeg', extH(xa.jeton), { longueurAnnoncee: 2 * 1024 * 1024 + 1 });
            await jouerBinaire(V, R, 'Content-Type hors JPEG/PNG/WebP (415)', 415, q2, JPG, 'text/plain', extH(xa.jeton));
            await jouerBinaire(V, R, 'image tronquée (422)', 422, q2, JPG.subarray(0, 60), 'image/jpeg', extH(xa.jeton));
            const adm3 = await compte({ role: 'administrateur' }), xa3 = await instLiee(adm3);
            await plafonner('banc-photo', 'compte', adm3.c._id, 600);
            await jouerBinaire(V, R, 'plafond de 600 par heure atteint (DEBIT, Retry-After)', 429, q2, JPG, 'image/jpeg', extH(xa3.jeton));
        }
        consignerHorsContrat('POST /api/creer-recharge', 'paiement non branché (501)', await H.appel(V, '/api/creer-recharge', { methode: 'POST', corps: {}, entetes: extH(x.jeton) }));
    }
    // 503 : la garde d'index (routes v2 fermées) sur CHAQUE route de `paths` servie par l'assembleur
    {
        pret.armer(async () => ({ manquants: ['index-du-banc'] }));
        const fauxId = 'a'.repeat(24);
        const REQ503 = {
            'POST /api/installation': { chemin: '/api/installation', corps: { versionExtension: '2.0.0' } },
            'POST /api/identifier': { chemin: '/api/identifier', corps: corpsId(), entetes: { 'idempotency-key': cle() } },
            'POST /api/identifier/reponse': { chemin: '/api/identifier/reponse', corps: { scanId: fauxId, choix: 'a' } },
            'POST /api/retour-live': { chemin: '/api/retour-live', corps: { scanId: fauxId, prixLive: 5 }, entetes: { authorization: 'Bearer ' + 'a'.repeat(32) } },
            'POST /api/solde': { chemin: '/api/solde', corps: {}, entetes: { authorization: 'Bearer ' + 'a'.repeat(32) } },
            'GET /api/compte': { chemin: '/api/compte' },
            'DELETE /api/compte': { chemin: '/api/compte', corps: { motDePasse: MDP } },
            'POST /api/compte/inscription': { chemin: '/api/compte/inscription', corps: { email: 'a@exemple.fr' } },
            'POST /api/compte/verification': { chemin: '/api/compte/verification', corps: { jeton: 'x', motDePasse: MDP } },
            'POST /api/compte/connexion': { chemin: '/api/compte/connexion', corps: { email: 'a@exemple.fr', motDePasse: MDP } },
            'POST /api/compte/deconnexion': { chemin: '/api/compte/deconnexion', corps: {} },
            'POST /api/compte/mot-de-passe-oublie': { chemin: '/api/compte/mot-de-passe-oublie', corps: { email: 'a@exemple.fr' } },
            'POST /api/compte/reinitialiser': { chemin: '/api/compte/reinitialiser', corps: { jeton: 'x', motDePasse: MDP } },
            'POST /api/compte/code': { chemin: '/api/compte/code', corps: {} },
            'POST /api/compte/lier': { chemin: '/api/compte/lier', corps: { code: 'ABCDEF' } },
            'POST /api/compte/delier': { chemin: '/api/compte/delier', corps: {} },
            'POST /api/compte/renvoyer-verification': { chemin: '/api/compte/renvoyer-verification', corps: { email: 'a@exemple.fr' } },
            'POST /api/banc/correction': { chemin: '/api/banc/correction', corps: { scanId: fauxId, idProduct: 1 } },
            'POST /api/banc/etiquette': { chemin: '/api/banc/etiquette', corps: { scanId: fauxId, verdict: 'juste', rev: 1 }, entetes: { authorization: 'Bearer ' + 'a'.repeat(32) } },
            'POST /api/banc/photo': { chemin: `/api/banc/photo?scanId=${fauxId}`, entetes: { authorization: 'Bearer ' + 'a'.repeat(32) } },
            'DELETE /api/banc/contributions': { chemin: '/api/banc/contributions', corps: { jeton: 'jeton-inconnu-abcdefghij1234' } },
            'DELETE /api/compte/installations/{id}': { chemin: `/api/compte/installations/${'a'.repeat(32)}` },
            'POST /api/scanner/analyses': { chemin: '/api/scanner/analyses', form: true },
            'POST /api/scanner/analyses/{id}/reponse': { chemin: `/api/scanner/analyses/${fauxId}/reponse`, corps: { choix: 'a' } },
            'GET /api/collection': { chemin: '/api/collection' },
            'GET /api/collection/sets/{slug}': { chemin: '/api/collection/sets/Banc-Set' },
            'PUT /api/collection/sets/{slug}/fiches/{cle}': { chemin: '/api/collection/sets/Banc-Set/fiches/1%7C001', corps: { possedee: true } }
        };
        const sansRequete = OPERATIONS.filter(o => o.route !== 'GET /ping' && !REQ503[o.route]).map(o => o.route);
        H.v('503 : chaque route de `paths` (hors /ping) a sa requête de la garde d\'index', sansRequete, []);
        for (const [route, q] of Object.entries(REQ503)) {
            const entetes = { origin: EXT, ...siteH(null), ...(q.entetes || {}) };
            if (q.form) await jouerFormulaire(V, route, 'garde d\'index : routes v2 fermées', 503, q.chemin, formulaire(), { ...siteH('rm_session=x'), ...ip() }, { garde: true });
            else await jouer(V, route, 'garde d\'index : routes v2 fermées', 503, q.chemin, { corps: q.corps, garde: true, entetes: { ...entetes, origin: route.includes('/compte') || route.includes('/scanner') || route.includes('/collection') ? SITE : EXT } });
        }
        pret.armer(M.verifierIndex);
    }
    await sv.fermer();
    const tousLesCas = grandLivre.length;

    // ═══════════════════════════ BILAN DU STEP 1 ═══════════════════════════
    H.v('états joués au statut attendu (anomalies du banc : un état mal fabriqué n\'est pas un écart de contrat)', mal, []);
    // Plus aucun écart déclaré : l'historique de GET /api/compte (défaut du serveur, B3) est réparé à la source (ruling A du tour 1).
    const ecarts = grandLivre.filter(e => e.ecarts.length);
    for (const e of ecarts) console.log(`   ÉCART  ${e.route} [${e.etat}] ${e.statut} : ${e.ecarts.slice(0, 4).map(x => `${x.chemin} ${x.message}`).join(' ; ')}`);
    const dansContrat = grandLivre.filter(e => !e.horsContrat), valides = dansContrat.filter(e => !e.ecarts.length);
    console.log(`   ${dansContrat.length} réponses, ${valides.length} valides, ${dansContrat.length - valides.length} écart(s)`);
    H.v(`${dansContrat.length} réponses, ${valides.length} valides, 0 écart`, dansContrat.length - valides.length, 0);
    // GET /api/compte a servi de VRAIES lignes des deux genres (le premier jeu n'en servait aucune : un historique vide ne prouvait rien)
    {
        const genres = new Map();
        for (const e of dansContrat.filter(x => x.route === 'GET /api/compte' && x.statut === 200 && x.json)) for (const l of e.json.historique.lignes) genres.set(l.genre, (genres.get(l.genre) || 0) + 1);
        console.log(`   lignes d'historique servies par GET /api/compte : ${[...genres].map(([g, n]) => `${g} ${n}`).join(', ')}`);
        H.vrai('GET /api/compte a servi au moins UNE ligne analyse et UNE ligne credits', (genres.get('analyse') || 0) >= 1 && (genres.get('credits') || 0) >= 1);
    }
    // ── les dénominateurs de tête (tour 1, C1) : seuls comptent les couples (route, statut) joués par un ÉTAT RÉEL. La boucle de la garde d'index (503, routes fermées) est à part.
    const reels = dansContrat.filter(e => !e.garde), gardes = dansContrat.filter(e => e.garde);
    // le compteur sait dire NON (cas fabriqué que l'ancien dénominateur laissait passer) : une route que seule la garde d'index a « jouée » n'est PAS jouée
    const routesJoueesPar = es => new Set(es.filter(e => !e.garde).map(e => e.route));
    H.v('compteur de routes jouées : une route que la boucle 503 est seule à avoir jouée n\'est pas comptée', [...routesJoueesPar([{ route: 'GET /fabriquee', garde: true }, { route: 'GET /reelle', garde: false }])], ['GET /reelle']);
    const jouees = routesJoueesPar(dansContrat);
    const nonJouees = OPERATIONS.filter(o => !jouees.has(o.route)).map(o => o.route);
    console.log(`   routes : ${OPERATIONS.length} dans paths, ${OPERATIONS.length - nonJouees.length} jouées par un état réel (hors boucle 503 de la garde d'index : ${gardes.length} réponses à part)`);
    H.v(`routes de paths jouées par un état RÉEL (${OPERATIONS.length - nonJouees.length} / ${OPERATIONS.length}) — la boucle 503 ne compte pas`, nonJouees, []);
    // chaque statut documenté : joué par un état réel, joué par la garde d'index (503 seulement), ou déclaré non joué avec sa raison — et une déclaration périmée est vue
    const NON_JOUES = {
        'DELETE /api/compte 400': 'aucun chemin ne rend 400 : v2/comptes/routes.js l.117-125 — supprimerCompte rend 401 IDENTIFIANTS ou 409 CREDITS_ACHETES, parSession rend 401/403 ; un corps non objet devient {} (donc 401), jamais 400',
        'POST /api/compte/deconnexion 401': 'aucun chemin ne rend 401 : v2/comptes/routes.js l.63-69 — la déconnexion rend 200 même sans cookie ; seul le garde de site peut refuser (403)',
        'POST /api/identifier 403': 'O3 : le 403 VERIFICATION n\'est plus atteignable — un compte non confirmé n\'est plus un porteur (v2/porteur.js : session refusée, installation liée = installation seule) ; la garde de la chaîne reste en profondeur. Le contrat OpenAPI le documente encore (aucun contrat changé par O3 hors comptes)',
        'POST /api/compte/mot-de-passe-oublie 400': 'aucun chemin ne rend 400 : v2/comptes/routes.js l.71-77 — un corps illisible vaut une adresse absente (202 neutre, l\'énumération d\'adresses est refusée par construction)'
    };
    const joues = new Set(reels.map(e => `${e.route} ${e.statut}`)), joues503 = new Set(gardes.map(e => `${e.route} ${e.statut}`));
    const documentes = STATUTS_DOCUMENTES.map(s => `${s.route} ${s.statut}`);
    const parGardeSeule = documentes.filter(k => !joues.has(k) && joues503.has(k));
    const nonJouesDoc = documentes.filter(k => !joues.has(k) && !joues503.has(k));
    console.log(`   statuts documentés : ${documentes.length} ; joués par un état réel ${documentes.filter(k => joues.has(k)).length} ; joués par la seule garde d'index (503) ${parGardeSeule.length} ; déclarés non joués ${Object.keys(NON_JOUES).length}`);
    H.v('statuts documentés ni joués ni déclarés non joués', nonJouesDoc.filter(k => !(k in NON_JOUES)), []);
    H.v('la garde d\'index ne joue QUE des 503', [...joues503].filter(k => !k.endsWith(' 503')), []);
    H.v('déclarations « non joué » périmées (le statut a été joué)', Object.keys(NON_JOUES).filter(k => joues.has(k) || joues503.has(k)), []);
    for (const k of Object.keys(NON_JOUES)) console.log(`   non joué : ${k} — ${NON_JOUES[k]}`);
    // les ÉTATS que le banc ne sait pas fabriquer : déclarés avec leur raison, et la déclaration échoue si l'état devient jouable (EN_RECONCILIATION, ci-dessous)
    // les codes d'erreur : tous ceux de la liste fermée que le serveur a produits, et ceux que le banc n'a pas pu produire (dits)
    const produits = new Set(grandLivre.filter(e => e.json && e.json.erreur).map(e => e.json.erreur.code));
    const horsListe = [...produits].filter(c => !Object.hasOwn(CODES, c));
    H.v('un code produit par le serveur et absent de la liste fermée / du schéma', horsListe, []);
    const JAMAIS = Object.keys(CODES).filter(c => !produits.has(c));
    console.log(`   codes de la liste fermée produits : ${Object.keys(CODES).length - JAMAIS.length} / ${Object.keys(CODES).length} ; non produits par le banc : ${JAMAIS.join(', ') || 'aucun'}`);
    const CODES_NON_PRODUITS = { VERIFICATION: 'O3 : un compte non confirmé n\'est plus un porteur, donc aucune requête n\'atteint plus les gardes « compte vérifié » (identifier, scanner, collection) — elles restent en profondeur ; test-comptes-o3.js prouve le refus à la source', EN_RECONCILIATION: 'ne naît que d\'une clé de débit rejouée dont la ligne attend la réconciliation (test-argent-tour4.js) — état fabriqué par ce banc-là, pas par une route sur un état courant' };
    H.v('codes de la liste fermée jamais produits et non déclarés', JAMAIS.filter(c => !(c in CODES_NON_PRODUITS)), []);
    H.v('déclarations « code non produit » périmées (le code a été produit : retirer la déclaration)', Object.keys(CODES_NON_PRODUITS).filter(c => produits.has(c)), []);
    // les causes de non-remboursement servies (RAISONS_NON_REMBOURSE, une source) : celles que le banc a vues, et celles qu'il ne sait pas fabriquer (dites)
    {
        const { RAISONS_NON_REMBOURSE } = require('../../sources');
        const vues = new Set(grandLivre.map(e => e.json && e.json.facturation && e.json.facturation.raisonNonRembourse).filter(Boolean));
        for (const e of grandLivre) { const f = e.json && e.json.carte && e.json.facturation; if (f && f.raisonNonRembourse) vues.add(f.raisonNonRembourse); }
        const hors = [...vues].filter(r => !RAISONS_NON_REMBOURSE.includes(r));
        console.log(`   raisonNonRembourse servies : ${[...vues].sort().join(', ')} ; non fabriquées par ce banc : ${RAISONS_NON_REMBOURSE.filter(r => !vues.has(r)).join(', ')}`);
        H.v('toute raisonNonRembourse servie appartient à RAISONS_NON_REMBOURSE (sources.js)', hors, []);
        H.vrai('plafond-jour ET deja-rembourse ont été servies par un état réel', vues.has('plafond-jour') && vues.has('deja-rembourse'));
    }
    // les raisons d'« introuvable » que le serveur peut produire (les deux autres sont dans le contrat mais ne sortent d'aucun chemin du code)
    const raisonsVues = new Set();
    (function parcourir(x) { if (Array.isArray(x)) return x.forEach(parcourir); if (x && typeof x === 'object') { if (x.statut === 'introuvable' && typeof x.raison === 'string') raisonsVues.add(x.raison); Object.values(x).forEach(parcourir); } })(grandLivre.map(e => e.json));
    console.log(`   raisons d'introuvable produites : ${[...raisonsVues].sort().join(', ')}`);
    H.v('raisons d\'introuvable que le serveur sait produire, toutes jouées', ['photo-illisible', 'hors-catalogue', 'panne-lecture'].filter(r => !raisonsVues.has(r)), []);
    const motifsVus = new Set(grandLivre.map(e => e.json && e.json.facturation && e.json.facturation.motif).filter(Boolean));
    console.log(`   motifs de facturation produits : ${[...motifsVus].sort().join(', ')}`);

    // routes SERVIES et absentes de `paths` : l'ensemble est DÉCLARÉ (une route de plus fait échouer le banc)
    const express2 = require('express');
    const servies = (function () {
        const out = new Set(); const app = express2(); for (const l of LOTS) { l.enTete(app, cfg); }
        app.use(assembler(LOTS, cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine }));
        (function lire(pile) { for (const l of pile || []) { if (l.route) for (const m of Object.keys(l.route.methods)) out.add(`${m.toUpperCase()} ${l.route.path.replace(/:([A-Za-z]+)/g, '{$1}')}`); else if (l.name === 'router' && l.handle && l.handle.stack) lire(l.handle.stack); } })(app._router && app._router.stack);
        return out;
    })();
    const dansPaths = new Set(OPERATIONS.map(o => o.route));
    const horsContrat = [...servies].filter(r => !dansPaths.has(r)).sort();
    // (tour 1, ruling C) les trois routes du banc / du renvoi sont PUBLIÉES ; reste le paiement, 501 non implémenté : « publiée quand implémentée » (l'alignement 501 / INDISPONIBLE est parqué pour la tâche de paiement)
    const HORS_CONTRAT_DECLAREES = ['POST /api/creer-recharge'];
    console.log(`   routes servies par l'assembleur : ${servies.size} ; absentes de paths : ${horsContrat.join(', ')}`);
    H.v('routes servies et absentes de `paths` = exactement la liste déclarée', horsContrat, HORS_CONTRAT_DECLAREES);
    // CONSTAT : le 501 `paiement-non-branche` du code est INATTEIGNABLE en l'état — la route est montée derrière un aiguilleur dont le prédicat exige un porteur v2, et rien ne résout le porteur sur cette route :
    // elle passe donc toujours la main à la route héritée (404 dans ce montage, qui n'en a pas). Déclaré, jamais publié.
    H.v('la route déclarée hors contrat passe la main (404 dans ce montage sans route héritée), elle ne rend jamais son 501 : la déclaration est vraie', grandLivre.filter(e => e.route === 'POST /api/creer-recharge').map(e => e.statut), [404]);
    H.v('corps d\'erreur des routes hors contrat : tous valides contre ReponseErreur', grandLivre.filter(e => e.horsContrat && e.ecarts.length).map(e => `${e.route} [${e.etat}]`), []);
    console.log(`   constat : un JSON illisible sur /api/identifier rend ${sondeJsonIllisible.statut} ${sondeJsonIllisible.ct} « ${sondeJsonIllisible.debut.replace(/\s+/g, ' ')} »`);

    // ce que le banc a constaté côté SERVEUR est écrit dans CONTRAT-API-V2.md §7.4 (jamais corrigé en silence)
    {
        const doc = require('fs').readFileSync(path.join(R, 'CONTRAT-API-V2.md'), 'utf8'); const i = doc.indexOf('### 7.4');
        const s74 = i >= 0 ? doc.slice(i, doc.indexOf('## 8.')) : '';
        H.vrai('CONTRAT-API-V2.md §7.4 existe', s74.length > 0);
        // EXACT (tour 1, C4) : une déclaration est prouvée par UNE ligne de tableau qui porte, ensemble, la route, le statut et le chemin — jamais une sous-chaîne quelque part dans la section.
        const lignesTableau = s74.split(/\r?\n/).filter(l => l.startsWith('|'));
        const ligneExacte = (route, statut, chemin) => lignesTableau.some(l => l.includes('`' + route + '`') && (statut === null || l.includes('`' + statut + '`')) && (chemin === null || l.includes('`' + chemin + '`')));
        const declarations = [
            ...Object.keys(NON_JOUES).map(k => { const m = /^(\S+ \S+) (\d+)$/.exec(k); return { quoi: `statut documenté non joué ${k}`, route: m[1], statut: m[2], chemin: null }; }),
            ...HORS_CONTRAT_DECLAREES.flatMap(r => [501, 404].map(s => ({ quoi: `route servie hors contrat ${r} (${s})`, route: r, statut: String(s), chemin: null }))),
            { quoi: 'raison pas-une-carte jamais produite', route: 'POST /api/identifier', statut: '200', chemin: 'pas-une-carte' },
            { quoi: 'raison plusieurs-cartes-non-separees jamais produite', route: 'POST /api/identifier', statut: '200', chemin: 'plusieurs-cartes-non-separees' },
            { quoi: 'Produit.set.tirage toujours null', route: 'POST /api/identifier', statut: '200', chemin: '$.analyse.cartes[].carte.set.tirage' },
            { quoi: 'lignes de crédits sans motif au contrat omises (abonnement, essai)', route: 'GET /api/compte', statut: '200', chemin: '$.historique.lignes[]' }
        ];
        const sansLigne = declarations.filter(d => !ligneExacte(d.route, d.statut, d.chemin)).map(d => d.quoi);
        console.log(`   §7.4 : ${declarations.length} déclarations, chacune prouvée par une ligne de tableau (route + statut + chemin)`);
        H.v('§7.4 : chaque déclaration a UNE ligne exacte (route ET statut ET chemin dans la même ligne)', sansLigne, []);
        // le contrôle sait dire NON : une déclaration que la section ne porte pas n'est pas trouvée, même si ses mots sont ailleurs dans la section
        H.v('   (le contrôle exact refuse une ligne qui manque)', [ligneExacte('POST /api/inexistante', '200', null), ligneExacte('GET /api/compte', '418', '$.historique.lignes[]'), ligneExacte('POST /api/creer-recharge', '200', null)], [false, false, false]);
    }
    // les dettes du ruling 5
    {
        const ATT = require('fs').readFileSync(path.join(__dirname, 'test-openapi.js'), 'utf8');
        H.vrai('ruling 5 : ATTENDUES_ABSENTES de test-openapi.js est vide', /const ATTENDUES_ABSENTES = \[\];/.test(ATT));
        const adaptateur = require('../identifier/adaptateur');
        const raisonsSchema = SCHEMA.components.schemas.CarteIntrouvable.properties.raison.enum.filter(x => x !== null);
        H.v('ruling 5 : RAISONS (adaptateur.js) = CarteIntrouvable.raison (contrat), ensemble pour ensemble', [[...adaptateur.RAISONS].sort(), [...raisonsSchema].sort()].map(JSON.stringify).reduce((a, b) => a === b), true);
        const t = SCHEMA.components.schemas.Set ? SCHEMA.components.schemas.Set : SCHEMA.components.schemas.SetProduit;
        const ty = t.properties.tirage.type;
        H.v('ruling 5 : Produit.set.tirage est déclaré nullable', Array.isArray(ty) && ty.includes('null'), true);
        const prodVus = []; (function p(x) { if (Array.isArray(x)) return x.forEach(p); if (x && typeof x === 'object') { if (x.set && typeof x.set === 'object' && 'tirage' in x.set && 'idProduct' in x) prodVus.push(x.set.tirage); Object.values(x).forEach(p); } })(grandLivre.map(e => e.json));
        console.log(`   Produit.set.tirage : ${prodVus.filter(v => v === null).length} null sur ${prodVus.length} produits servis`);
        H.vrai('ruling 5 : Produit.set.tirage est encore TOUJOURS null (catalogue.js le pose à null), dénominateur > 0', prodVus.length > 0 && prodVus.every(v => v === null));
    }

    // ═══════════════════════════ STEP 2 — LA PROPRIÉTÉ INVERSE : le validateur sait dire NON ═══════════════════════════
    {
        const clone = o => JSON.parse(JSON.stringify(o));
        const trouver = (route, motEtat, statut) => { const e = dansContrat.find(x => x.route === route && x.etat.includes(motEtat) && (statut === undefined || x.statut === statut) && x.json); if (!e) throw new Error(`corruption : aucune réponse « ${route} [${motEtat}] »`); return e; };
        const C = [
            ['1. une clé ajoutée à la racine (analyse)', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.extra = 1; }],
            ['2. un score ajouté (la confiance chiffrée est interdite)', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.score = 0.97; }],
            ['3. une clé requise retirée (facturation)', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { delete j.facturation; }],
            ['4. une clé requise retirée (solde.essai)', trouver('POST /api/solde', 'installation non liée'), j => { delete j.solde.essai; }],
            ['5. un type changé (cartes[0].index en chaîne)', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.analyse.cartes[0].index = '0'; }],
            ['6. un type changé (carte.idProduct en chaîne)', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.analyse.cartes[0].carte.idProduct = String(j.analyse.cartes[0].carte.idProduct); }],
            ['7. une valeur hors liste (analyse.statut)', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.analyse.statut = 'peut-etre'; }],
            ['8. un code d\'erreur hors liste', trouver('POST /api/identifier', 'QUOTA installation'), j => { j.erreur.code = 'INCONNU'; }],
            ['9. un motif de facturation retiré de la liste (code-maitre)', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.facturation.motif = 'code-maitre'; }],
            ['10. une variante hors liste', trouver('POST /api/identifier', 'a-trancher à 2'), j => { j.analyse.cartes[0].candidats[0].variante = 'V9'; }],
            ['11. un état Cardmarket inconnu', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.analyse.cartes[0].etat = { estime: 'MINT', confiance: 'haute', defauts: [], declare: null, retenu: null }; }],
            ['12. une clé en trop dans un Produit imbriqué', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.analyse.cartes[0].carte.classement = 1; }],
            ['13. une confiance chiffrée', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.analyse.cartes[0].etat = { estime: 'EX', confiance: 0.97, defauts: [], declare: null, retenu: 'EX' }; }],
            ['14. un contrat différent de 2', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.contrat = 3; }],
            ['15. success en chaîne', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.success = 'true'; }],
            ['16. une image Cardmarket', trouver('POST /api/identifier', 'identifiée (verdict ferme)'), j => { j.analyse.cartes[0].carte.visuel.url = 'https://www.cardmarket.com/img/x.jpg'; }],
            ['17. une raison d\'introuvable hors liste', trouver('POST /api/identifier', 'introuvable / hors-catalogue'), j => { j.analyse.cartes[0].raison = 'trop-flou'; }],
            ['18. un a-trancher sans candidat (UN-CANDIDAT : un seul est permis, zéro non)', trouver('POST /api/identifier', 'a-trancher à 2'), j => { j.analyse.cartes[0].candidats.length = 0; }],
            ['19. un a-trancher à quatre candidats', trouver('POST /api/identifier', 'a-trancher à 3'), j => { const c = j.analyse.cartes[0]; c.candidats.push(clone(c.candidats[0])); }],
            ['20. un identifiant de choix inconnu', trouver('POST /api/identifier', 'a-trancher à 2'), j => { j.analyse.cartes[0].question.choix[0].id = 'z'; }],
            ['21. une erreur sans facturation', trouver('POST /api/identifier', 'QUOTA installation'), j => { delete j.facturation; }],
            ['22. l\'ancienne forme de solde (soldeGratuit)', trouver('POST /api/solde', 'installation non liée'), j => { j.solde.soldeGratuit = 17; }],
            ['23. une liaison dont le jeton renouvelé est retiré', trouver('POST /api/compte/lier', 'code valide'), j => { delete j.jetonInstallation; }],
            ['24. un ping dont version n\'est plus une chaîne', trouver('GET /ping', 'serveur v2 allumé'), j => { j.version = 3; }]
        ];
        H.v('propriété inverse : 24 corruptions définies', C.length, 24);
        // M2 : l'en-tête Retry-After est vérifié quand le schéma le déclare — le contrôle sait dire NON (une erreur DEBIT sans l'en-tête, ou avec une autre valeur, est un écart)
        {
            const e429 = { success: false, erreur: { code: 'DEBIT', message: 'x', reessayerDans: 7 }, facturation: null }, ct = { 'content-type': 'application/json' };
            const ecart = h => A.juger('POST /api/compte/code', 429, e429, '{}', { ...ct, ...h }).filter(x => /Retry-After/.test(x.chemin)).length;
            H.v('Retry-After : absent => écart ; égal à reessayerDans => aucun écart ; valeur différente => écart', [ecart({}), ecart({ 'retry-after': '7' }), ecart({ 'retry-after': '9' })], [1, 0, 1]);
            const avecHeader = dansContrat.filter(e => e.json && e.json.erreur && e.json.erreur.reessayerDans !== undefined);
            console.log(`   Retry-After : ${avecHeader.length} réponses portent reessayerDans, toutes avec l'en-tête de la même valeur (jugé par juger)`);
            H.vrai('Retry-After : au moins une réponse réelle porte reessayerDans', avecHeader.length > 0);
        }
        // I7 : LOTS n'a qu'UNE définition (v2/index.js) — aucun des deux bancs n'en recopie la liste
        for (const f of ['test-contrat-reel.js', 'test-integration-banc-scanner.js'])
            H.v(`LOTS : ${f} ne recopie pas la liste des lots`, (require('fs').readFileSync(path.join(__dirname, f), 'utf8').match(/\[\s*require\('\.\.\/(transport|installations)\/monter'\)\s*,\s*require\('\.\.\/(installations|comptes)\/monter'\)/g) || []).length, 0);
        let refusees = 0; const acceptees = [];
        for (const [nom, e, abimer] of C) {
            const sain = A.juger(e.route, e.statut, e.json, JSON.stringify(e.json), e.entetes).filter(x => !x.message.startsWith('(ReponseErreur)'));
            const c = clone(e.json); abimer(c);
            const apres = A.juger(e.route, e.statut, c, JSON.stringify(c), e.entetes);
            if (sain.length) acceptees.push(`${nom} : la réponse de départ n'était pas saine`);
            else if (!apres.length) acceptees.push(nom);
            else refusees++;
        }
        console.log(`   propriété inverse : ${refusees} corruptions refusées sur ${C.length}`);
        H.v('propriété inverse : le validateur REFUSE les 24 corruptions (liste de celles qu\'il accepte)', acceptees, []);
        // LE BANC SAIT ÊTRE ROUGE (TDD de la propriété inverse) : deux validateurs MUTANTS — l'un ignore `additionalProperties:false`, l'autre ignore `enum` et `const` — doivent LAISSER PASSER
        // plusieurs des 24 corruptions. Si les 24 passaient aussi par un validateur lâche, la mesure ne mesurerait pas le validateur.
        const muter = f => { const m = clone(SCHEMA); (function parcourir(x) { if (Array.isArray(x)) return x.forEach(parcourir); if (x && typeof x === 'object') { f(x); Object.values(x).forEach(parcourir); } })(m.paths); (function parcourir(x) { if (Array.isArray(x)) return x.forEach(parcourir); if (x && typeof x === 'object') { f(x); Object.values(x).forEach(parcourir); } })(m.components); return m; };
        const mutants = { 'additionalProperties ignoré': muter(x => { if (x.additionalProperties === false) delete x.additionalProperties; }), 'enum et const ignorés': muter(x => { delete x.enum; delete x.const; }) };
        for (const [nomMutant, doc] of Object.entries(mutants)) {
            let laisses = 0;
            for (const [, e, abimer] of C) {
                const c = clone(e.json); abimer(c);
                const [methode, chemin] = e.route.split(' ');
                const rep = doc.paths[chemin][methode.toLowerCase()].responses[String(e.statut)];
                if (valider(c, rep.content['application/json'].schema, doc).ok) laisses++;
            }
            console.log(`   mutant « ${nomMutant} » : ${laisses} corruption(s) sur 24 lui échappent`);
            H.vrai(`le banc est capable d'être rouge : le validateur mutant « ${nomMutant} » laisse passer au moins 3 corruptions (${laisses} / 24)`, laisses >= 3);
        }
        // balayage : une clé ajoutée à la racine de CHAQUE réponse JSON consignée est refusée ; un code d'erreur falsifié aussi
        let n = 0; const laisses = [];
        for (const e of dansContrat) {
            if (!e.json || typeof e.json !== 'object' || Array.isArray(e.json) || e.ecarts.length) continue;
            const doc = A.reponseDocumentee(e.route, e.statut); if (!doc || !doc.content) continue;
            n++; const c = clone(e.json); c.__intruse = 1;
            if (!A.juger(e.route, e.statut, c, '{}', e.entetes).length) laisses.push(`${e.route} [${e.etat}]`);
        }
        console.log(`   balayage : une clé inconnue ajoutée à chacune des ${n} réponses valides`);
        H.v(`balayage : la clé ajoutée à la racine est refusée pour ${n} réponses sur ${n}`, laisses, []);
        let m = 0; const faux = [];
        for (const e of dansContrat) { if (!e.json || !e.json.erreur || e.ecarts.length) continue; m++; const c = clone(e.json); c.erreur.code = 'ZZZ'; if (!A.juger(e.route, e.statut, c, '{}', e.entetes).length) faux.push(`${e.route} [${e.etat}]`); }
        H.v(`balayage : un code d'erreur falsifié est refusé pour ${m} réponses d'erreur sur ${m}`, faux, []);
        // ── LA PROPRIÉTÉ INVERSE SYSTÉMATIQUE (tour 1, I3) : par couple (route, statut) joué, UNE réponse valide (la plus riche) ; chaque clé REQUISE retirée, chaque nœud contraint
        //    (feuille ET conteneur, à toute profondeur) changé de type ⇒ le validateur doit REFUSER, à chaque fois. Le schéma choisit les sites ; le banc ne les devine pas.
        const parCouple = new Map();
        for (const e of dansContrat) {
            if (!e.json || e.ecarts.length) continue;
            const doc = A.reponseDocumentee(e.route, e.statut); if (!doc || !doc.content) continue;
            const schema = doc.content['application/json'].schema, nb = A.sitesDeMutation(e.json, schema).sites.length, k = `${e.route} ${e.statut}`;
            if (!parCouple.has(k) || nb > parCouple.get(k).nb) parCouple.set(k, { e, schema, nb });
        }
        let sites = 0, refuses = 0, libres = 0, retraits = 0, types = 0; const laisses2 = [];
        for (const [k, { e, schema }] of parCouple) {
            const s = A.sitesDeMutation(e.json, schema); libres += s.libres;
            for (const site of s.sites) {
                sites++; if (site.genre === 'retrait') retraits++; else types++;
                const c = A.muter(e.json, site);
                if (!valider(c, schema, SCHEMA).ok) refuses++;
                else laisses2.push(`${k} [${e.etat}] ${site.genre} ${site.chemin.join('.')}`);
            }
        }
        console.log(`   inverse systématique : ${parCouple.size} couples (route, statut) à réponse valide ; ${sites} mutations (${retraits} clés requises retirées, ${types} types changés) ; ${refuses} refusées ; ${libres} nœuds libres (schéma sans contrainte) non mutés`);
        H.vrai('inverse systématique : le dénominateur est consistant (couples > 40, mutations > 500)', parCouple.size > 40 && sites > 500);
        H.v(`inverse systématique : ${refuses} mutations refusées sur ${sites} (la liste de celles que le validateur accepte)`, laisses2.slice(0, 20), []);
        // le contrôle sait être rouge : un validateur mutant (sans `required`) laisserait passer tous les retraits
        const sansRequired = JSON.parse(JSON.stringify(SCHEMA)); (function p(x) { if (Array.isArray(x)) return x.forEach(p); if (x && typeof x === 'object') { delete x.required; Object.values(x).forEach(p); } })(sansRequired.components);
        const [kk, { e: eM, schema: sM }] = [...parCouple].find(([, v]) => A.sitesDeMutation(v.e.json, v.schema).sites.some(s => s.genre === 'retrait'));
        const siteR = A.sitesDeMutation(eM.json, sM).sites.find(s => s.genre === 'retrait');
        H.v(`   mutant sans « required » sur ${kk} : le retrait de ${siteR.chemin.join('.')} lui échappe (le banc serait rouge)`, valider(A.muter(eM.json, siteR), sM, sansRequired).ok, true);
    }
    void tousLesCas;
    await attendre(400);                                       // la passe de purge que le second montage (calcul des routes servies) lance au démarrage se termine avant la base
    require('../identifier/monter').arreterBalayage(); require('../identifier/monter').arreterPurge(); require('../banc/monter').arreterPurge();   // les minuteurs des lots ne survivent pas à la base
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
