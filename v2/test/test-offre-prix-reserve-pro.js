'use strict';
// CRITÈRE BLOQUANT N° 5 DE L'OUVERTURE DE PRO (LISTE-LANCEMENT.md, contrat §1.5, décision de l'éditeur du 08/11) : le PRIX par état et par langue est réservé à Pro. L'ÉTAT ESTIMÉ sans prix (le champ `etat`) reste
// gratuit pour tous, à l'octet près. Drapeau V2_PRO_PRIX_RESERVE (éteint par défaut) : éteint, chaque réponse est celle d'avant ; allumé, seule une offre Pro ACTIVE reçoit `prixLive` (l'instruction de lire le prix
// par état ou par langue) et les `prixRepli` d'état (`etat-proche`, `fourchette`, tout repli qui porte une fourchette).
// Par les VRAIS routeurs v2 (assembler, base en mémoire du banc, chaîne héritée fabriquée comme test-abus-routes.js / test-lot-sans-prix.js). Deux applications côte à côte, le drapeau éteint et allumé :
// l'ORACLE du gratuit est la réponse du drapeau éteint, amputée des deux champs par une fonction écrite ICI (jamais celle de la production).
// Les six conditions du critère n° 5 : (1) `etat` identique à l'octet pour tous ; (2) sans compte, gratuit, expiré, offre illisible : aucun prix par état ou par langue, sur TOUTES les sorties (la liste se DÉDUIT des
// fichiers qui posent ces champs, elle ne se recopie pas) ; (3) Pro : égal à ce que rend le code actuel ; (4) abonnement expiré ou offre inconnue : la réponse du gratuit ; (5) quota : un scan gratuit dont le repli est
// retiré n'est plus compté comme « prix affiché » ; (6) mutation : retirer la garde d'une seule sortie fait échouer ce banc (v2/mesures/mutations-prix-reserve-pro.js).
const H = require('./_harnais');
const path = require('path'), fs = require('fs');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota'); const VB = require('./_visuels-banc');
const registre = require('../registre');
const { lireConfig } = require('../config');
const V = path.join(__dirname, '..');
const CHARGES = path.join(V, '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const BASE = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_LOT_CARTES_MAX: '100' };
const cfgOff = lireConfig(BASE);
const cfgOn = lireConfig({ ...BASE, V2_PRO_PRIX_RESERVE: '1' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.31.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-prp-${Date.now().toString(36)}-${++nCle}`;
let nMail = 0;
const raw = n => mongoose.connection.db.collection(n);
const oid = s => new mongoose.Types.ObjectId(s);
const sur = f => { try { return f(); } catch (e) { return `💥 ${e && e.message}`; } };
const j = x => JSON.stringify(x);
const appeler = (url, chemin, o) => Promise.race([H.appel(url, chemin, o), new Promise((_, rej) => setTimeout(() => rej(new Error('TEMPS DÉPASSÉ (60 s) : ' + chemin)), 60000))]);

// ════════════ 0. LES SORTIES SE DÉDUISENT DU CODE : tout fichier qui pose ces champs passe par la décision ════════════
// Un fichier de v2/ (hors bancs, mesures, contrat publié) qui nomme `prixLive`, `prixRepli` ou les fonctions qui les fabriquent est ou bien un PRODUCTEUR (il calcule, il n'envoie rien : liste fermée, avec sa raison),
// ou bien une SORTIE : elle doit importer la décision unique (identifier/reserve-pro-prix.js). Un nouveau fichier qui pose ces champs et ne l'importe pas fait échouer ce banc.
function fichiersV2(dir, sortie = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!['test', 'mesures', 'openapi', 'node_modules'].includes(e.name)) fichiersV2(p, sortie); }
        else if (e.name.endsWith('.js')) sortie.push(p);
    }
    return sortie;
}
const POSE = /\b(prixRepli|prixLive)\b|avecRepliAnalyse|analyseAvecRepli|repliRetourLive/;
const rel = p => path.relative(V, p).replace(/\\/g, '/');
const PRODUCTEURS = {
    'capacites.js': 'décrit les jetons annoncés par /ping',
    'identifier/adaptateur.js': 'fabrique l\'instruction prixLive de la carte (calcul pur, aucun envoi)',
    'identifier/fiabilite-prix.js': 'commentaire seulement',
    'identifier/fourchette-etat.js': 'règle pure de la fourchette',
    'identifier/prix-repli.js': 'fabrique le repli (module pur)',
    'identifier/reserve-pro-prix.js': 'la décision elle-même',
    'scanner/routes.js': 'ne sert JAMAIS prixLive ni prixRepli (sansLive les retire pour tout le monde) ; vérifié plus bas'
};
const posent = fichiersV2(V).filter(f => POSE.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
const sorties = posent.filter(f => !(f in PRODUCTEURS));
H.vrai(`0a. les fichiers qui posent ces champs sont déduits du code (${posent.length} : ${posent.join(', ')}) ; les sorties à garder sont ${sorties.join(', ')}`, sorties.length >= 4);
let reserve = null; try { reserve = require('../identifier/reserve-pro-prix'); } catch (e) { reserve = null; }
const nePasserPas = sorties.filter(f => !/reserve-pro-prix/.test(fs.readFileSync(path.join(V, f), 'utf8')));
H.v('0b. TOUTE sortie qui pose ces champs importe la décision unique (identifier/reserve-pro-prix.js)', nePasserPas, []);
H.v('0b bis. chaque sortie DÉRIVE son accès de la décision unique (const acces = PRO.accesPrixParEtat(…) ou await PRO.accesPour(…)), jamais d\'une valeur écrite', sorties.filter(f => !/const acces = (await )?PRO\.(accesPrixParEtat|accesPour)\(/.test(fs.readFileSync(path.join(V, f), 'utf8'))), []);
H.vrai('0c. le scanner ne sert jamais ces champs : il retire le repli et met prixLive à null pour tout le monde (sansLive)', /const sansLive = k => \{ const s = sansRepli\(k\); return s && typeof s === 'object' \? \{ \.\.\.s, prixLive: null \} : s; \};/.test(fs.readFileSync(path.join(V, 'scanner/routes.js'), 'utf8')));

// ════════════ A. la décision, pure ════════════
const decide = (cfg, offre) => sur(() => reserve.accesPrixParEtat(cfg, offre));
H.v('A1. drapeau éteint : tout le monde reçoit (la réponse d\'avant)', [undefined, null, { nom: 'sans-compte' }, { nom: 'gratuit' }, { nom: 'pro' }].map(o => decide(cfgOff, o)), [true, true, true, true, true]);
H.v('A2. drapeau allumé : SEULE l\'offre « pro » reçoit ; absente, nulle, inconnue, d\'une autre forme : la réponse du gratuit',
    [{ nom: 'pro', restant: null }, { nom: 'gratuit' }, { nom: 'sans-compte' }, undefined, null, { nom: 'PRO' }, { nom: 'inconnue' }, 'pro', 1, [], {}].map(o => decide(cfgOn, o)), [true, false, false, false, false, false, false, false, false, false, false]);
H.v('A3. drapeau allumé, configuration absente ou drapeau d\'une autre valeur que true : aucun accès accordé par défaut seulement si le drapeau EST vrai', [decide(undefined, { nom: 'gratuit' }), decide({ proPrixReserve: 'oui' }, { nom: 'gratuit' }), decide({ proPrixReserve: true }, { nom: 'gratuit' })], [true, true, false]);

// ════════════ B. par les vrais routeurs ════════════
const EXP = 990007;
const AVEC = 930001, AVEC2 = 930002;
const SANS = Array.from({ length: 6 }, (_, i) => 930100 + i);
const VIS = [];
const semer = async (id, trend) => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990700 + (id % 1000) });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Prix-Pro', source: 'cardmarket', certitude: 'exacte' });
    if (trend !== undefined) await raw('guide_prix').insertOne({ idProduct: id, avg: trend, low: trend / 2, trend, avg1: trend, avg7: trend, avg30: trend, guideDu: new Date('2026-10-04') });
    VIS.push(VB.doc(id, { idMetacard: 990700 + (id % 1000), setNom: 'Banc Prix Pro' }));
};
// ce que la chaîne fabriquée rend : l'état retenu et la langue lue changent d'un scénario à l'autre
let MODE = { retenu: null, codeLangue: 2 };
const carteCorps = (id, ambigu) => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu });
const etatDe = m => ({ estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: m.retenu });
const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Prix', prix: 1, photoUrl: null });
const reverse = { attendue: false, motif: null, etat: 'aucun-motif', strategie: null };
const aff = (id, m = MODE) => ({ statutHttp: 200, corps: { success: true, question: null, carte: carteCorps(id, false), etat: etatDe(m), candidats: [cand(id)], classement: [], guidePrix: {}, reverse, codeLangue: m.codeLangue } });
const qst = (ids, m = MODE) => ({ statutHttp: 200, corps: { success: true, question: { etat: 'en-attente', delaiHeures: 24 }, carte: carteCorps(ids[0], true), etat: etatDe(m), candidats: ids.map(cand), classement: [], guidePrix: {}, reverse, codeLangue: m.codeLangue } });

const futur = new Date(Date.now() + 40 * 86400e3), passe = new Date(Date.now() - 3600e3);
const abo = jusquAu => ({ actif: true, quotaMensuel: 100, moisCle: '2026-11', restant: 100, jusquAu });
const enPanne = new Set();
async function porteurDe(genre) {
    const jeton = J.genererJeton(); let compte = null;
    if (genre !== 'sans') {
        const a = `prp${++nMail}.${Date.now().toString(36)}@exemple.fr`;
        compte = Object.assign(M.nouveauCompte({ email: a, emailCle: a, motDePasse: {} }), { verifie: true }, genre === 'pro' ? { abonnement: abo(futur) } : genre === 'expire' ? { abonnement: abo(passe) } : {});
        await raw('comptes').insertOne(compte);
    }
    const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compte ? { compteId: compte._id, lieeLe: new Date() } : {});
    await raw('installations').insertOne(i);
    if (genre === 'panne') enPanne.add(String(compte._id));
    return { genre, jeton, compte, i, userId: compte ? `v2:compte:${compte._id}` : `v2:installation:${i._id}`, cleQuota: compte ? `compte:${compte._id}` : `installation:${i._id}` };
}
const GENRES = ['sans', 'gratuit', 'expire', 'panne', 'pro'];
const corpsId = () => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' });
const entetes = (x, k) => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}`, ...(k ? { 'idempotency-key': k } : {}) });
const ident = (url, x, k = cle()) => appeler(url, '/api/identifier', { methode: 'POST', corps: corpsId(), entetes: entetes(x, k) });
const repondre = (url, x, b) => appeler(url, '/api/identifier/reponse', { methode: 'POST', corps: b, entetes: entetes(x) });
const retour = (url, x, b) => appeler(url, '/api/retour-live', { methode: 'POST', corps: b, entetes: entetes(x) });
const cartesDe = r => (r.json && r.json.analyse ? r.json.analyse.cartes : null);
// L'ORACLE du gratuit, écrit ICI : le prix par état ou par langue part (prixLive -> null, repli d'état retiré) ; le repli GÉNÉRAL (tendance du guide, sans fourchette ni offre) et tout le reste restent.
const general = r => Boolean(r) && r.repli === 'tendance' && r.offre === null && !('fourchette' in r);
const gratuitDe = c => { const o = { ...c }; if (o.prixRepli && !general(o.prixRepli)) delete o.prixRepli; if (o.prixLive) o.prixLive = null; return o; };
const aDuPrixParEtat = c => Boolean(c.prixLive) || Boolean(c.prixRepli && !general(c.prixRepli));

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true });
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-offre-prix-reserve-pro.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    await semer(AVEC, 6); await semer(AVEC2, 3);
    for (const id of SANS) await semer(id);
    VB.installer(VIS);

    const pret = require('../pret'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let lotImpl = null;
    const chaine = async (req, res) => res.json({ ...aff(AVEC).corps, scanId: String(req.scanIdImpose) });
    const identifierLot = async req => (lotImpl ? lotImpl(req) : [aff(AVEC)]);      // sans liste imposée : UN résultat = une carte (la route d'une carte)
    const monter = async cfg => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), identifierLot }));
        return H.serveur(app);
    };
    const svOff = await monter(cfgOff), svOn = await monter(cfgOn);
    // la LECTURE de l'offre en panne pour les porteurs de `enPanne` (jamais pour les autres) : le registre « argent » est celui des routes
    const argent = registre.obtenir('argent'), offreOrig = argent.offre.bind(argent);
    argent.offre = async p => { if (p && enPanne.has(String(p.id))) throw Object.assign(new Error('lecture de l\'offre en panne (banc)'), { code: 'PANNE_BANC' }); return offreOrig(p); };
    H.vrai('B0. la panne de lecture de l\'offre est bien armée (le banc peut fabriquer l\'erreur de lecture)', await (async () => { const x = await porteurDe('panne'); try { await argent.offre({ type: 'compte', id: x.compte._id }); return false; } catch (e) { return e.code === 'PANNE_BANC'; } })());

    // ── B1. /api/identifier, une carte : trois scénarios (état non estimable + langue lue ; état estimable + langue lue ; langue NON lue)
    const SCENARIOS = [['E0 état nul, langue lue', { retenu: null, codeLangue: 2 }], ['E1 état EX, langue lue', { retenu: 'EX', codeLangue: 2 }], ['E2 langue non lue', { retenu: 'EX', codeLangue: null }]];
    const bases = {};      // le drapeau éteint, par scénario : la référence de « ce que rend le code actuel » (Pro, sans compte, gratuit : TOUS identiques)
    for (const [nom, mode] of SCENARIOS) {
        MODE = mode; lotImpl = null;
        const off = {}, on = {};
        for (const g of GENRES) { off[g] = await ident(svOff.url, await porteurDe(g)); on[g] = await ident(svOn.url, await porteurDe(g)); }
        const ok = GENRES.every(g => off[g].statut === 200 && on[g].statut === 200 && cartesDe(off[g]) && cartesDe(on[g]));
        H.vrai(`B1 ${nom} : les dix réponses sont des analyses rendues (200)`, ok);
        if (!ok) continue;
        const ref = j(cartesDe(off.pro));
        H.v(`B1 ${nom} — éteint : sans compte, gratuit, expiré, offre illisible et Pro rendent la MÊME analyse, à l'octet (la réponse d'avant)`, GENRES.map(g => j(cartesDe(off[g])) === ref), GENRES.map(() => true));
        bases[nom] = cartesDe(off.pro);
        const c0 = cartesDe(off.pro)[0];
        H.vrai(`   (le scénario est bien celui du risque : la carte porte ${c0.prixLive ? 'une instruction prixLive' : 'prixLive null'}${c0.prixRepli ? ' et un prixRepli ' + c0.prixRepli.repli + '/' + c0.prixRepli.cause : ''})`,
            nom.startsWith('E0') ? Boolean(c0.prixLive && c0.prixRepli && 'fourchette' in c0.prixRepli) : nom.startsWith('E1') ? Boolean(c0.prixLive && !c0.prixRepli) : Boolean(c0.prixLive === null && c0.prixRepli && general(c0.prixRepli)));
        H.v(`B1 ${nom} — (3) Pro, allumé : la même analyse que le code actuel, à l'octet`, j(cartesDe(on.pro)), ref);
        const attendu = j(cartesDe(off.pro).map(gratuitDe));
        H.v(`B1 ${nom} — (2)(4) sans compte, gratuit, expiré, offre illisible, allumé : la réponse d'avant SANS prix par état ni par langue, rien d'autre`, ['sans', 'gratuit', 'expire', 'panne'].map(g => j(cartesDe(on[g])) === attendu), [true, true, true, true]);
        H.v(`B1 ${nom} — (2) aucune carte du gratuit ne porte de prix par état ou par langue`, ['sans', 'gratuit', 'expire', 'panne'].map(g => cartesDe(on[g]).some(aDuPrixParEtat)), [false, false, false, false]);
        // (1) l'ÉTAT, à l'octet, pour les cinq offres, allumé et éteint
        const etats = [...GENRES.map(g => j(cartesDe(on[g]).map(c => c.etat))), ...GENRES.map(g => j(cartesDe(off[g]).map(c => c.etat)))];
        H.vrai(`B1 ${nom} — (1) le champ \`etat\` est identique à l'octet pour les cinq offres, drapeau allumé comme éteint`, etats.every(e => e === etats[0]) && etats[0].includes('"retenu"'));
        H.v(`   le produit servi (carte.carte, prixGuide compris) est identique pour tous : le guide général ne change pas`, GENRES.map(g => j(cartesDe(on[g]).map(c => c.carte))), GENRES.map(() => j(cartesDe(off.pro).map(c => c.carte))));
        if (nom.startsWith('E2')) H.v('   langue non lue : le repli GÉNÉRAL (tendance du guide) est gardé pour le gratuit', on.gratuit.json.analyse.cartes[0].prixRepli.cause, 'langue-non-lue');
    }

    // ── B2. un LOT : une carte identifiée (état nul, langue lue) et une question ; sa réponse (/api/identifier/reponse) passe par la même décision
    const lotListe = () => [aff(AVEC, { retenu: null, codeLangue: 2 }), qst([AVEC, AVEC2], { retenu: null, codeLangue: 2 })];
    {
        const off = {}, on = {};
        for (const g of GENRES) { lotImpl = async () => lotListe(); off[g] = await ident(svOff.url, await porteurDe(g)); on[g] = await ident(svOn.url, await porteurDe(g)); }
        H.vrai('B2. lot : les dix réponses sont des lots rendus', GENRES.every(g => off[g].statut === 200 && on[g].statut === 200 && cartesDe(on[g]) && on[g].json.analyse.statut === 'lot'));
        const ref = j(cartesDe(off.pro));
        H.v('B2 éteint : la même analyse de lot pour toutes les offres (à l\'octet)', GENRES.map(g => j(cartesDe(off[g])) === ref), GENRES.map(() => true));
        H.vrai('   (le lot porte bien un prixLive et un prixRepli à fourchette)', cartesDe(off.pro).some(c => c.prixLive) && cartesDe(off.pro).some(c => c.prixRepli && 'fourchette' in c.prixRepli));
        H.v('B2 allumé : Pro = le code actuel, à l\'octet', j(cartesDe(on.pro)), ref);
        H.v('B2 allumé : les quatre autres = le code actuel sans prix par état ni par langue (oracle écrit dans ce banc)', ['sans', 'gratuit', 'expire', 'panne'].map(g => j(cartesDe(on[g])) === j(cartesDe(off.pro).map(gratuitDe))), [true, true, true, true]);
        H.vrai('B2 (1) `etat` identique à l\'octet pour toutes les offres du lot', GENRES.every(g => j(cartesDe(on[g]).map(c => c.etat)) === j(cartesDe(off.pro).map(c => c.etat))));
    }

    // ── B3. la réponse à une question : porteurs frais, lot refait pour garder le porteur
    {
        const off = {}, on = {};
        const jouer = async (url, g) => { const x = await porteurDe(g); lotImpl = async () => lotListe(); const r = await ident(url, x); const q = (r.json && r.json.analyse ? r.json.analyse.cartes : []).findIndex(c => c.statut === 'a-trancher'); return { x, r, rep: await repondre(url, x, { scanId: r.json.scanId, carte: q, choix: 'a' }) }; };
        for (const g of GENRES) { off[g] = await jouer(svOff.url, g); on[g] = await jouer(svOn.url, g); }
        H.vrai('B3. les dix réponses à la question du lot sont 200 et portent une carte identifiée', GENRES.every(g => [off[g], on[g]].every(o => o.rep.statut === 200 && o.rep.json && o.rep.json.carte && o.rep.json.carte.statut === 'identifiee')));
        const ref = j(off.pro.rep.json.carte);
        H.v('B3 éteint : la même carte pour toutes les offres', GENRES.map(g => j(off[g].rep.json.carte) === ref), GENRES.map(() => true));
        H.vrai('   (la carte répondue porte un prixLive et un prixRepli à fourchette : état nul, langue lue)', Boolean(off.pro.rep.json.carte.prixLive && off.pro.rep.json.carte.prixRepli && 'fourchette' in off.pro.rep.json.carte.prixRepli));
        H.v('B3 allumé : Pro = le code actuel', j(on.pro.rep.json.carte), ref);
        H.v('B3 allumé : sans compte, gratuit, expiré, offre illisible = le code actuel sans prix par état ni par langue', ['sans', 'gratuit', 'expire', 'panne'].map(g => j(on[g].rep.json.carte) === j(gratuitDe(off.pro.rep.json.carte))), [true, true, true, true]);
        H.vrai('B3 (1) `etat` de la carte répondue identique à l\'octet pour toutes les offres', GENRES.every(g => j(on[g].rep.json.carte.etat) === j(off.pro.rep.json.carte.etat)));
    }

    // ── B4. /api/retour-live : le repli de l'extension, ET le quota (5)
    // Un scan identifié par la route, son journal posé (la chaîne fabriquée n'écrit pas le journal du scan), puis le retour.
    const scanPour = async (url, g, mode) => {
        MODE = mode; lotImpl = null; const x = await porteurDe(g); const r = await ident(url, x);
        await raw('journal_scans').insertOne({ _id: oid(r.json.scanId), userId: x.userId, route: 'identifier' });
        return { x, scanId: r.json.scanId };
    };
    const RETOURS = [
        ['lecture ratée définitive (état nul)', { retenu: null, codeLangue: 2 }, s => ({ scanId: s, lectureRatee: { cause: 'sans-prix', definitive: true } })],
        ['offre dans un état pire (etat-proche)', { retenu: 'EX', codeLangue: 2 }, s => ({ scanId: s, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille', prixLiveCodeLangue: 1 })],
        ['prix lu avec grille, état nul (fourchette)', { retenu: null, codeLangue: 2 }, s => ({ scanId: s, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille', prixLiveCodeLangue: 1, grilleLive: { NM: 1.4, GD: 0.9 } })],
        ['tendance seule, état estimable (repli GÉNÉRAL)', { retenu: 'EX', codeLangue: 2 }, s => ({ scanId: s, prixLive: 7.67, originePrix: 'tendance', prixLiveCodeLangue: 1 })]
    ];
    for (const [nom, mode, corps] of RETOURS) {
        const off = {}, on = {};
        for (const g of GENRES) {
            const a = await scanPour(svOff.url, g, mode); off[g] = { s: a, r: await retour(svOff.url, a.x, corps(a.scanId)) };
            const b = await scanPour(svOn.url, g, mode); on[g] = { s: b, r: await retour(svOn.url, b.x, corps(b.scanId)) };
        }
        H.vrai(`B4 ${nom} : les dix retours sont 200`, GENRES.every(g => off[g].r.statut === 200 && on[g].r.statut === 200));
        const rp = o => o.r.json.prixRepli, fact = o => { const f = o.r.json.facturation; return f ? { debite: f.debite, rembourse: f.rembourse, raisonNonRembourse: f.raisonNonRembourse ?? null, motif: f.motif } : null; };
        const refRepli = j(rp(off.pro) ?? null);
        H.v(`B4 ${nom} — éteint : même repli et même facturation pour toutes les offres`, GENRES.map(g => j(rp(off[g]) ?? null) === refRepli && j(fact(off[g])) === j(fact(off.pro))), GENRES.map(() => true));
        H.v(`B4 ${nom} — Pro allumé : le repli et la facturation du code actuel`, [j(rp(on.pro) ?? null), j(fact(on.pro))], [refRepli, j(fact(off.pro))]);
        const gratuitRepli = rp(off.pro) && general(rp(off.pro)) ? refRepli : 'null';
        H.v(`B4 ${nom} — sans compte, gratuit, expiré, offre illisible, allumé : ${gratuitRepli === 'null' ? 'aucun repli' : 'le repli GÉNÉRAL seul'}`, ['sans', 'gratuit', 'expire', 'panne'].map(g => j(rp(on[g]) ?? null)), ['sans', 'gratuit', 'expire', 'panne'].map(() => gratuitRepli));
        if (nom.startsWith('lecture ratée')) {
            // (5) le QUOTA : sans repli, le scan n'AFFICHE aucun prix (la page n'a rien rendu) : le remboursement « sans-prix » d'avant s'applique ; avec le repli de Pro, le scan compte
            H.v('B4 (5) lecture ratée définitive, Pro : le repli est servi, le scan COMPTE (debite 1, prix-repli)', [fact(on.pro).debite, fact(on.pro).rembourse, fact(on.pro).raisonNonRembourse], [1, false, 'prix-repli']);
            H.v('B4 (5) la même lecture ratée, gratuit / sans compte / expiré / offre illisible, allumé : repli retiré => plus un « prix affiché » : REMBOURSÉ (sans-prix)', ['sans', 'gratuit', 'expire', 'panne'].map(g => [fact(on[g]).rembourse, fact(on[g]).motif, fact(on[g]).raisonNonRembourse, 'prixRepli' in on[g].r.json]), ['sans', 'gratuit', 'expire', 'panne'].map(() => [true, 'sans-prix', null, false]));
            H.v('B4 (5) éteint, le gratuit garde le repli et compte (la réponse d\'avant)', [fact(off.gratuit).rembourse, fact(off.gratuit).raisonNonRembourse], [false, 'prix-repli']);
            const comptes = await Promise.all(['sans', 'gratuit'].map(async g => (await Q.prisAujourdhui(on[g].s.x.cleQuota)) ?? 0));
            H.v('   le compteur du jour du gratuit allumé est revenu à 0 (l\'analyse rendue est rendue)', comptes, [0, 0]);
        }
    }
    // la règle de quota elle-même, par la fonction de production, sur le repli que la route sert
    {
        const PR = require('../identifier/prix-repli');
        const fourchette = { repli: 'tendance', cause: 'etat-non-retenu', fiable: false, guide: { tendance: 1, date: '2026-10-04' }, offre: null, fourchette: { basse: { prix: 1, source: 'guide-de' }, haute: null, absentes: ['haute'] } };
        const sans = sur(() => reserve.repliSelonOffre(fourchette, false)), avec = sur(() => reserve.repliSelonOffre(fourchette, true));
        H.v('B5. afficheUnPrix : le repli à fourchette retiré n\'est plus un prix affiché ; conservé (Pro), il l\'est', [PR.afficheUnPrix({ repli: sans }), PR.afficheUnPrix({ repli: avec })], [false, true]);
        const tendance = { repli: 'tendance', cause: 'langue-non-lue', fiable: false, guide: { tendance: 1, date: '2026-10-04' }, offre: null };
        H.v('   le repli général (tendance du guide, sans fourchette) reste un prix affiché pour le gratuit', PR.afficheUnPrix({ repli: sur(() => reserve.repliSelonOffre(tendance, false)) }), true);
        H.v('   etat-proche et fourchette sans guide sont retirés pour le gratuit', [{ repli: 'etat-proche', cause: 'offre-autre-etat', fiable: false, guide: null, offre: { etat: 'GD', prix: 1 } }, { repli: 'fourchette', cause: 'etat-non-retenu', fiable: false, guide: null, offre: null, fourchette: {} }].map(r => sur(() => reserve.repliSelonOffre(r, false))), [null, null]);
    }

    // ── B6. le QUOTA d'un lot : sans le prixLive ni le repli, le lot du gratuit n'affiche plus de prix (rendu) ; Pro et le drapeau éteint le comptent
    {
        const lueN = n => Array.from({ length: n }, (_, i) => aff(SANS[i % SANS.length], { retenu: null, codeLangue: 2 }));
        const jouer = async (url, g) => { const x = await porteurDe(g); lotImpl = async () => lueN(3); const r = await ident(url, x); return { x, r }; };
        const o = {}, n = {};
        for (const g of ['gratuit', 'pro', 'sans']) { o[g] = await jouer(svOff.url, g); n[g] = await jouer(svOn.url, g); }
        const f = x => x.r.json.facturation;
        H.v('B6. lot de 3 cartes sans guide, langue lue : éteint, le gratuit COMPTE (une instruction de prix en direct est servie) — la réponse d\'avant', [f(o.gratuit).motif, f(o.gratuit).rembourse, f(o.gratuit).debite], ['lot', false, 1]);
        H.v('B6 (5) allumé, Pro : l\'instruction est servie, le lot COMPTE', [f(n.pro).motif, f(n.pro).rembourse], ['lot', false]);
        H.v('B6 (5) allumé, gratuit et sans compte : ni prixLive ni repli, aucun prix affiché : le lot est RENDU (sans-prix)', [f(n.gratuit).motif, f(n.gratuit).rembourse, f(n.sans).motif, f(n.sans).rembourse], ['sans-prix', true, 'sans-prix', true]);
        H.v('   et aucune carte du lot servi au gratuit ne porte de prix par état', cartesDe(n.gratuit.r).some(aDuPrixParEtat), false);
    }

    // ── B7. le REJEU d'idempotence : la réponse conservée suit l'offre ACTUELLE (jamais de fuite, jamais de retrait à tort)
    {
        MODE = { retenu: null, codeLangue: 2 }; lotImpl = null;
        const k1 = cle();
        const p = await porteurDe('pro');
        const r1 = await ident(svOn.url, p, k1);
        const r1b = await ident(svOn.url, p, k1);
        H.v('B7a. rejeu sous Pro (rien n\'a changé) : l\'en-tête Idempotency-Replayed, la MÊME réponse à l\'octet', [r1b.entetes['idempotency-replayed'], r1b.texte === r1.texte], ['true', true]);
        H.vrai('   (la réponse initiale de Pro porte bien le prix par état)', cartesDe(r1).some(aDuPrixParEtat));
        await raw('comptes').updateOne({ _id: p.compte._id }, { $set: { 'abonnement.jusquAu': passe } });
        const r1c = await ident(svOn.url, p, k1);
        H.v('B7b. rejeu APRÈS expiration de l\'abonnement : rien ne fuit — aucun prix par état ni par langue, le reste de l\'analyse intact', [r1c.entetes['idempotency-replayed'], j(cartesDe(r1c)) === j(cartesDe(r1).map(gratuitDe)), cartesDe(r1c).some(aDuPrixParEtat), j(cartesDe(r1c).map(c => c.etat)) === j(cartesDe(r1).map(c => c.etat))], ['true', true, false, true]);
        // l'inverse : première réponse sous une offre gratuite, rejeu après passage à Pro : le prix n'est pas retiré à tort
        const k2 = cle(), g = await porteurDe('gratuit');
        const s1 = await ident(svOn.url, g, k2);
        H.vrai('B7c. première réponse du gratuit : aucun prix par état', !cartesDe(s1).some(aDuPrixParEtat));
        await raw('comptes').updateOne({ _id: g.compte._id }, { $set: { abonnement: abo(futur) } });
        const s2 = await ident(svOn.url, g, k2);
        H.v('B7c. rejeu APRÈS passage à Pro : le prix par état est servi (la réponse conservée est complète), égal à ce que Pro reçoit', [s2.entetes['idempotency-replayed'], j(cartesDe(s2)) === j(cartesDe(r1)), s2.json.scanId === s1.json.scanId], ['true', true, true]);
        await raw('comptes').updateOne({ _id: g.compte._id }, { $set: { 'abonnement.jusquAu': passe } });
        const s3 = await ident(svOn.url, g, k2);
        H.v('B7d. et de nouveau expiré : le gratuit, à l\'octet de la première réponse du gratuit (hors le rejeu)', [j(cartesDe(s3)) === j(cartesDe(s1)), j(s3.json.analyse.regleVerdict) === j(s1.json.analyse.regleVerdict)], [true, true]);
        // drapeau éteint : le rejeu est celui d'avant, à l'octet, sans aucune relecture d'offre
        const k3 = cle(), e = await porteurDe('gratuit');
        const t1 = await ident(svOff.url, e, k3); const t2 = await ident(svOff.url, e, k3);
        H.v('B7e. drapeau éteint : rejeu identique à l\'octet, avec le prix par état (la réponse d\'avant)', [t2.texte === t1.texte, cartesDe(t2).some(aDuPrixParEtat)], [true, true]);
        // erreur de lecture de l'offre au rejeu : la réponse du gratuit, jamais un prix
        const k4 = cle(), q = await porteurDe('pro');
        const u1 = await ident(svOn.url, q, k4);
        enPanne.add(String(q.compte._id));
        const u2 = await ident(svOn.url, q, k4);
        enPanne.delete(String(q.compte._id));
        H.v('B7f. rejeu quand la lecture de l\'offre échoue : la réponse du gratuit (rien ne fuit)', [u2.statut, cartesDe(u2).some(aDuPrixParEtat), j(cartesDe(u2)) === j(cartesDe(u1).map(gratuitDe))], [200, false, true]);
        // un LOT : la décision d'argent (rendu ou compté) a dépendu de la réservation : la réponse conservée est celle qui a été SERVIE, le rejeu ne fait que retirer
        const k5 = cle(), l = await porteurDe('gratuit'); lotImpl = async () => lotListe();
        const m1 = await ident(svOn.url, l, k5);
        await raw('comptes').updateOne({ _id: l.compte._id }, { $set: { abonnement: abo(futur) } });
        const m2 = await ident(svOn.url, l, k5);
        H.v('B7g. lot : première réponse du gratuit, rejeu sous Pro : la réponse conservée est celle qui a été servie (la décision d\'argent du lot en a dépendu) — arbitrage nommé', [m2.entetes['idempotency-replayed'], j(cartesDe(m2)) === j(cartesDe(m1))], ['true', true]);
        const k6 = cle(), lp = await porteurDe('pro'); lotImpl = async () => lotListe();
        const w1 = await ident(svOn.url, lp, k6);
        await raw('comptes').updateOne({ _id: lp.compte._id }, { $set: { 'abonnement.jusquAu': passe } });
        const w2 = await ident(svOn.url, lp, k6);
        H.v('B7h. lot : première réponse de Pro, rejeu après expiration : rien ne fuit', [cartesDe(w1).some(aDuPrixParEtat), cartesDe(w2).some(aDuPrixParEtat), j(cartesDe(w2)) === j(cartesDe(w1).map(gratuitDe))], [true, false, true]);
    }

    // ── B8. le contrat : /ping annonce la réservation seulement quand elle est allumée
    {
        const { capacitesServies } = require('../capacites');
        H.v('B8. le jeton `prix-pro-reserve` n\'est annoncé que drapeau allumé (la clé absente est lue éteinte)', [capacitesServies(cfgOff).includes('prix-pro-reserve'), capacitesServies(cfgOn).includes('prix-pro-reserve')], [false, true]);
    }

    // ── C. la mutation : le jeu de mutants existe, ses ancres sont toutes valides, et il couvre CHAQUE sortie déduite ci-dessus
    try {
        const MU = require('../mesures/mutations-prix-reserve-pro');
        H.v('C1. le jeu de mutants (une garde retirée par sortie) a toutes ses ancres', MU.ancresCassees(), []);
        const couverts = new Set(MU.MUTANTS.map(m => m[1]));
        H.v('C2. chaque sortie déduite du code a au moins un mutant qui retire SA garde', sorties.filter(f => !couverts.has(f)), []);
    } catch (e) { H.vrai(`C. le jeu de mutants est chargeable (${e && e.message})`, false); }

    await svOff.fermer(); await svOn.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
