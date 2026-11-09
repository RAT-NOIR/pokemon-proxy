'use strict';
// CRITÈRE BLOQUANT N° 5 DE L'OUVERTURE DE PRO (LISTE-LANCEMENT.md, contrat §1.5, décision de l'éditeur du 08/11) : le PRIX par état et par langue est réservé à Pro. L'ÉTAT ESTIMÉ sans prix (le champ `etat`) reste
// gratuit pour tous, à l'octet près. Drapeau V2_PRO_PRIX_RESERVE (éteint par défaut) : éteint, chaque réponse est celle d'avant ; allumé, seule une offre Pro ACTIVE reçoit `prixLive` (l'instruction de lire le prix
// par état ou par langue) et les `prixRepli` d'état (`etat-proche`, `fourchette`) ; le repli `tendance` à fourchette est DÉGRADÉ en repli général (même guide, sans fourchette : le scan reste compté, F1).
// Par les VRAIS routeurs v2 (assembler, base en mémoire du banc, chaîne héritée fabriquée). Deux applications côte à côte, le drapeau éteint et allumé. L'ORACLE du gratuit est la réponse du drapeau éteint, transformée
// par une fonction écrite ICI (_prix-reserve-aide.js : jamais celle de la production). Fixtures : réelles, leur origine est écrite dans _prix-reserve-aide.js.
// Les six conditions du critère n° 5 : (1) `etat` identique à l'octet pour tous ; (2) sans compte, gratuit, expiré, offre illisible ou inconnue : aucun prix par état ni par langue, sur TOUTES les sorties (la liste se DÉDUIT
// des fichiers qui posent ces champs) ; (3) Pro : égal à ce que rend le code actuel ; (4) abonnement expiré ou offre inconnue : la réponse du gratuit (par des ROUTEURS) ; (5) quota : le repli retiré n'est plus un « prix affiché »,
// une carte sans aucun prix au guide est rendue au gratuit (F2) ; (6) mutation : v2/mesures/mutations-prix-reserve-pro.js (chaque mutant doit MOURIR : le jeu vérifie que la copie mutée est chargée ET que le banc rougit).
// « Éteint = identique » : ce banc compare, drapeau éteint, les cinq porteurs ENTRE EUX (cartes, rejeu au texte près) ; l'identité avec le code d'AVANT ce lot s'appuie sur le rejeu des suites existantes (rapport).
const H = require('./_harnais');
const path = require('path'), fs = require('fs');
const mongoose = require('mongoose');
const express = require('express');
const db = require('../db'); const M = require('../modeles'); const Q = require('./_aide-quota'); const VB = require('./_visuels-banc');
const registre = require('../registre');
const { lireConfig } = require('../config');
const X = require('./_prix-reserve-aide');
const V = path.join(__dirname, '..');
const CHARGES = path.join(V, '..', 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const BASE = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0', V2_LOT_CARTES_MAX: '100' };
const cfgOff = lireConfig(BASE);
const cfgOn = lireConfig({ ...BASE, V2_PRO_PRIX_RESERVE: '1' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.31.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-prp-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const oid = s => new mongoose.Types.ObjectId(s);
const sur = f => { try { return f(); } catch (e) { return `💥 ${e && e.message}`; } };
const j = x => JSON.stringify(x);
const appeler = (url, chemin, o) => Promise.race([H.appel(url, chemin, o), new Promise((_, rej) => setTimeout(() => rej(new Error('TEMPS DÉPASSÉ (60 s) : ' + chemin)), 60000))]);
const { GENRES, LIBRES, general, gratuitDe, aDuPrixParEtat, META, SANS, LU, REEL } = X;
const TAUROS = META.tauros, ARCANIN = META.arcanin;

// ════════════ 0. LES SORTIES SE DÉDUISENT DU CODE : tout fichier qui pose ces champs passe par la décision ════════════
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
    'scanner/routes.js': 'ne sert JAMAIS prixLive ni prixRepli (sansLive les retire pour tout le monde) ; prouvé par test-scanner-routes.js (drapeau allumé) et son mutant'
};
const posent = fichiersV2(V).filter(f => POSE.test(fs.readFileSync(f, 'utf8'))).map(rel).sort();
const sorties = posent.filter(f => !(f in PRODUCTEURS));
H.vrai(`0a. les fichiers qui posent ces champs sont déduits du code (${posent.length} : ${posent.join(', ')}) ; les sorties à garder sont ${sorties.join(', ')}`, sorties.length >= 4);
let reserve = null; try { reserve = require('../identifier/reserve-pro-prix'); } catch (e) { reserve = null; }
H.v('0b. TOUTE sortie qui pose ces champs importe la décision unique (identifier/reserve-pro-prix.js)', sorties.filter(f => !/reserve-pro-prix/.test(fs.readFileSync(path.join(V, f), 'utf8'))), []);
H.v('0b bis. chaque sortie DÉRIVE son accès de la décision unique (const acces = PRO.accesPrixParEtat(…) ou await PRO.accesPour(…)), jamais d\'une valeur écrite', sorties.filter(f => !/const acces = (typeof p\.acces === 'boolean' \? p\.acces : )?(await )?PRO\.(accesPrixParEtat|accesPour)\(/.test(fs.readFileSync(path.join(V, f), 'utf8'))), []);
H.vrai('0c. le scanner ne sert jamais ces champs : il retire le repli et met prixLive à null pour tout le monde (sansLive), et la route est branchée sur `sansPrix` (le comportement : test-scanner-routes.js)', /const sansLive = k => \{ const s = sansRepli\(k\); return s && typeof s === 'object' \? \{ \.\.\.s, prixLive: null \} : s; \};/.test(fs.readFileSync(path.join(V, 'scanner/routes.js'), 'utf8')) && /idempotente\('scanner', \{ obligatoire: false \}, cfg\), cleDeDebit, entreeDuScanner, sansPrix, lancer\(/.test(fs.readFileSync(path.join(V, 'scanner/routes.js'), 'utf8')));

// ════════════ A. la décision, pure ════════════
const decide = (cfg, offre) => sur(() => reserve.accesPrixParEtat(cfg, offre));
H.v('A1. drapeau éteint : tout le monde reçoit (la réponse d\'avant)', [undefined, null, { nom: 'sans-compte' }, { nom: 'gratuit' }, { nom: 'pro' }].map(o => decide(cfgOff, o)), [true, true, true, true, true]);
H.v('A2. drapeau allumé : SEULE l\'offre « pro » reçoit ; absente, nulle, inconnue, d\'une autre forme : la réponse du gratuit',
    [{ nom: 'pro', restant: null }, { nom: 'gratuit' }, { nom: 'sans-compte' }, undefined, null, { nom: 'PRO' }, { nom: 'inconnue' }, 'pro', 1, [], {}].map(o => decide(cfgOn, o)), [true, false, false, false, false, false, false, false, false, false, false]);
H.v('A3. configuration absente ou drapeau d\'une autre valeur que true : tout le monde reçoit ; drapeau true : le gratuit ne reçoit pas', [decide(undefined, { nom: 'gratuit' }), decide({ proPrixReserve: 'oui' }, { nom: 'gratuit' }), decide({ proPrixReserve: true }, { nom: 'gratuit' })], [true, true, false]);

// ════════════ B. par les vrais routeurs ════════════
const VIS = [];
let MODE = { retenu: null, codeLangue: 2 }, PRODUIT = TAUROS;
const GU = REEL.tauros.guide;
const ident = async (url, x, k = cle()) => appeler(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}`, 'idempotency-key': k } });
const repondre = (url, x, b) => appeler(url, '/api/identifier/reponse', { methode: 'POST', corps: b, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}` } });
const retour = (url, x, b) => appeler(url, '/api/retour-live', { methode: 'POST', corps: b, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${x.jeton}` } });
const cartesDe = r => (r.json && r.json.analyse ? r.json.analyse.cartes : null);
const porteurDe = g => X.porteurDe(raw, g);
const remboursements = scanId => raw('mouvements').countDocuments({ scanId: oid(scanId), type: 'remboursement' });
const prisDuJour = async x => (await Q.prisAujourdhui(x.cleQuota)) ?? 0;

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
    await X.semer(raw, VB, VIS);
    VB.installer(VIS);

    const pret = require('../pret'); const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let lotImpl = null;
    let QUESTION = null;                                  // non nul : la chaîne fabriquée pose UNE question (une carte, deux candidats) sur ces produits
    const chaine = async (req, res) => {
        if (QUESTION) {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: QUESTION.map(m => m.id) });
            return res.json({ ...X.qst(QUESTION, MODE).corps, scanId: String(req.scanIdImpose) });
        }
        return res.json({ ...X.aff(PRODUIT, MODE).corps, scanId: String(req.scanIdImpose) });
    };
    const identifierLot = async req => (lotImpl ? lotImpl(req) : [X.aff(PRODUIT, MODE)]);      // sans liste imposée : UN résultat = une carte (la route d'une carte)
    const monter = async (cfg, avecLot = true) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), ...(avecLot ? { identifierLot } : {}) }));
        return H.serveur(app);
    };
    const svOff = await monter(cfgOff), svOn = await monter(cfgOn);
    const svOffQ = await monter(cfgOff, false), svOnQ = await monter(cfgOn, false);      // sans crochet de lot : la chaîne fabriquée pose elle-même la question d'UNE carte
    X.armerOffres(registre.obtenir('argent'));
    H.vrai('B0. les offres en panne et inconnue sont bien armées (le banc fabrique l\'erreur de lecture et l\'offre inconnue)', await (async () => {
        const a = await porteurDe('panne'), b = await porteurDe('inconnue'); const ag = registre.obtenir('argent');
        let panne = false; try { await ag.offre({ type: 'compte', id: a.compte._id }); } catch (e) { panne = e.code === 'PANNE_BANC'; }
        return panne && (await ag.offre({ type: 'compte', id: b.compte._id })).nom === 'inconnue';
    })());

    // ── B1. /api/identifier, une carte : trois scénarios (état non estimable + langue lue ; état estimable + langue lue ; langue NON lue)
    const SCENARIOS = [['E0 état nul, langue lue', { retenu: null, codeLangue: 2 }], ['E1 état EX, langue lue', { retenu: 'EX', codeLangue: 2 }], ['E2 langue non lue', { retenu: 'EX', codeLangue: null }]];
    for (const [nom, mode] of SCENARIOS) {
        MODE = mode; PRODUIT = TAUROS; lotImpl = null;
        const off = {}, on = {};
        for (const g of GENRES) { off[g] = await ident(svOff.url, await porteurDe(g)); on[g] = await ident(svOn.url, await porteurDe(g)); }
        const ok = GENRES.every(g => off[g].statut === 200 && on[g].statut === 200 && cartesDe(off[g]) && cartesDe(on[g]));
        H.vrai(`B1 ${nom} : les ${2 * GENRES.length} réponses sont des analyses rendues (200)`, ok);
        if (!ok) continue;
        const ref = j(cartesDe(off.pro));
        H.v(`B1 ${nom} — éteint : tous les porteurs rendent la MÊME analyse, à l'octet (la réponse d'avant)`, GENRES.map(g => j(cartesDe(off[g])) === ref), GENRES.map(() => true));
        const c0 = cartesDe(off.pro)[0];
        H.vrai(`   (garde de scénario : statut ${c0.statut}/${c0.raison}/${JSON.stringify(c0.question && c0.question.code)}/${JSON.stringify((c0.candidats || []).map(x => x.idProduct))} ; la carte complète porte ${c0.prixLive ? 'une instruction prixLive' : 'prixLive null'}${c0.prixRepli ? ' et un prixRepli ' + c0.prixRepli.repli + '/' + c0.prixRepli.cause : ''})`,
            nom.startsWith('E0') ? Boolean(c0.prixLive && c0.prixRepli && 'fourchette' in c0.prixRepli) : nom.startsWith('E1') ? Boolean(c0.prixLive && !c0.prixRepli) : Boolean(c0.prixLive === null && c0.prixRepli && general(c0.prixRepli)));
        H.v(`B1 ${nom} — (3) Pro, allumé : la même analyse que le code actuel, à l'octet`, j(cartesDe(on.pro)), ref);
        const attendu = j(cartesDe(off.pro).map(gratuitDe));
        H.v(`B1 ${nom} — (2)(4) sans compte, gratuit, expiré, offre illisible, offre inconnue, allumé : la réponse d'avant SANS prix par état ni par langue (fourchette dégradée en repli général), rien d'autre`, LIBRES.map(g => j(cartesDe(on[g])) === attendu), LIBRES.map(() => true));
        H.v(`B1 ${nom} — (2) aucune carte du gratuit ne porte de prix par état ou par langue`, LIBRES.map(g => cartesDe(on[g]).some(X.aDuPrixParEtat)), LIBRES.map(() => false));
        if (nom.startsWith('E0')) H.vrai('   F1 : la carte du gratuit garde un repli général (le même guide, SANS fourchette)', LIBRES.every(g => { const r = cartesDe(on[g])[0].prixRepli; return r && general(r) && j(r.guide) === j(c0.prixRepli.guide); }));
        const etats = [...GENRES.map(g => j(cartesDe(on[g]).map(c => c.etat))), ...GENRES.map(g => j(cartesDe(off[g]).map(c => c.etat)))];
        H.vrai(`B1 ${nom} — (1) le champ \`etat\` est identique à l'octet pour toutes les offres, drapeau allumé comme éteint`, etats.every(e => e === etats[0]) && etats[0].includes('"retenu"'));
        H.v(`   le produit servi (carte.carte, prixGuide compris) est identique pour tous : le guide général ne change pas`, GENRES.map(g => j(cartesDe(on[g]).map(c => c.carte)) === j(cartesDe(off.pro).map(c => c.carte))), GENRES.map(() => true));
        if (nom.startsWith('E2')) H.v('   langue non lue : le repli GÉNÉRAL (tendance du guide) est gardé pour le gratuit', on.gratuit.json.analyse.cartes[0].prixRepli.cause, 'langue-non-lue');
    }

    // ── B2. un LOT : une carte identifiée (état nul, langue lue) et une question
    const lotListe = () => [X.aff(TAUROS, { retenu: null, codeLangue: 2 }), X.qst([TAUROS, ARCANIN], { retenu: null, codeLangue: 2 })];
    {
        const off = {}, on = {};
        for (const g of GENRES) { lotImpl = async () => lotListe(); off[g] = await ident(svOff.url, await porteurDe(g)); on[g] = await ident(svOn.url, await porteurDe(g)); }
        H.vrai('B2. lot : toutes les réponses sont des lots rendus', GENRES.every(g => off[g].statut === 200 && on[g].statut === 200 && cartesDe(on[g]) && on[g].json.analyse.statut === 'lot'));
        const ref = j(cartesDe(off.pro));
        H.v('B2 éteint : la même analyse de lot pour toutes les offres (à l\'octet)', GENRES.map(g => j(cartesDe(off[g])) === ref), GENRES.map(() => true));
        H.vrai('   (le lot porte bien un prixLive et un prixRepli à fourchette)', cartesDe(off.pro).some(c => c.prixLive) && cartesDe(off.pro).some(c => c.prixRepli && 'fourchette' in c.prixRepli));
        H.v('B2 allumé : Pro = le code actuel, à l\'octet', j(cartesDe(on.pro)), ref);
        H.v('B2 allumé : tous les non-Pro = le code actuel sans prix par état ni par langue (oracle écrit dans ce banc)', LIBRES.map(g => j(cartesDe(on[g])) === j(cartesDe(off.pro).map(gratuitDe))), LIBRES.map(() => true));
        H.vrai('B2 (1) `etat` identique à l\'octet pour toutes les offres du lot', GENRES.every(g => j(cartesDe(on[g]).map(c => c.etat)) === j(cartesDe(off.pro).map(c => c.etat))));
    }

    // ── B3. la réponse à une question
    {
        const off = {}, on = {};
        const jouer = async (url, g) => { const x = await porteurDe(g); lotImpl = async () => lotListe(); const r = await ident(url, x); const q = (cartesDe(r) || []).findIndex(c => c.statut === 'a-trancher'); return { x, r, rep: await repondre(url, x, { scanId: r.json.scanId, carte: q, choix: 'a' }) }; };
        for (const g of GENRES) { off[g] = await jouer(svOff.url, g); on[g] = await jouer(svOn.url, g); }
        H.vrai('B3. les réponses à la question du lot sont 200 et portent une carte identifiée', GENRES.every(g => [off[g], on[g]].every(o => o.rep.statut === 200 && o.rep.json && o.rep.json.carte && o.rep.json.carte.statut === 'identifiee')));
        const ref = j(off.pro.rep.json.carte);
        H.v('B3 éteint : la même carte pour toutes les offres', GENRES.map(g => j(off[g].rep.json.carte) === ref), GENRES.map(() => true));
        H.vrai('   (garde de scénario : la carte répondue porte un prixLive et un prixRepli à fourchette)', Boolean(off.pro.rep.json.carte.prixLive && off.pro.rep.json.carte.prixRepli && 'fourchette' in off.pro.rep.json.carte.prixRepli));
        H.v('B3 allumé : Pro = le code actuel', j(on.pro.rep.json.carte), ref);
        H.v('B3 allumé : tous les non-Pro = le code actuel sans prix par état ni par langue', LIBRES.map(g => j(on[g].rep.json.carte) === j(gratuitDe(off.pro.rep.json.carte))), LIBRES.map(() => true));
        H.vrai('B3 (1) `etat` de la carte répondue identique à l\'octet pour toutes les offres', GENRES.every(g => j(on[g].rep.json.carte.etat) === j(off.pro.rep.json.carte.etat)));
    }

    // ── B4. /api/retour-live : le repli de l'extension, ET le quota (5)
    const scanPour = async (url, g, mode, produit = TAUROS) => {
        MODE = mode; PRODUIT = produit; lotImpl = null; const x = await porteurDe(g); const r = await ident(url, x);
        await raw('journal_scans').insertOne({ _id: oid(r.json.scanId), userId: x.userId, route: 'identifier' });
        return { x, scanId: r.json.scanId, r };
    };
    const RETOURS = [
        ['lecture ratée définitive (état nul)', { retenu: null, codeLangue: 2 }, s => ({ scanId: s, lectureRatee: { cause: 'sans-prix', definitive: true } })],
        ['offre dans un état pire (etat-proche)', { retenu: 'EX', codeLangue: 2 }, s => ({ scanId: s, prixLive: LU.pire, prixLiveEtat: 'GD', originePrix: 'grille', prixLiveCodeLangue: 1 })],
        ['prix lu avec grille, état nul (fourchette)', { retenu: null, codeLangue: 2 }, s => ({ scanId: s, prixLive: LU.pire, prixLiveEtat: 'GD', originePrix: 'grille', prixLiveCodeLangue: 1, grilleLive: LU.grille })],
        ['tendance seule, état estimable (repli GÉNÉRAL)', { retenu: 'EX', codeLangue: 2 }, s => ({ scanId: s, prixLive: LU.tendanceArcanin, originePrix: 'tendance', prixLiveCodeLangue: 1 })]
    ];
    const rp = o => o.r.json.prixRepli;
    const fact = o => { const f = o.r.json.facturation; return f ? { debite: f.debite, rembourse: f.rembourse, raisonNonRembourse: f.raisonNonRembourse ?? null, motif: f.motif } : null; };
    for (const [nom, mode, corps] of RETOURS) {
        const off = {}, on = {};
        for (const g of GENRES) {
            const a = await scanPour(svOff.url, g, mode); off[g] = { s: a, r: await retour(svOff.url, a.x, corps(a.scanId)) };
            const b = await scanPour(svOn.url, g, mode); on[g] = { s: b, r: await retour(svOn.url, b.x, corps(b.scanId)) };
        }
        H.vrai(`B4 ${nom} : tous les retours sont 200`, GENRES.every(g => off[g].r.statut === 200 && on[g].r.statut === 200));
        const refRepli = j(rp(off.pro) ?? null);
        H.v(`B4 ${nom} — éteint : même repli et même facturation pour toutes les offres`, GENRES.map(g => j(rp(off[g]) ?? null) === refRepli && j(fact(off[g])) === j(fact(off.pro))), GENRES.map(() => true));
        H.v(`B4 ${nom} — Pro allumé : le repli et la facturation du code actuel`, [j(rp(on.pro) ?? null), j(fact(on.pro))], [refRepli, j(fact(off.pro))]);
        const attenduGratuit = j(X.gratuitRepli(rp(off.pro) ?? null));
        H.v(`B4 ${nom} — non-Pro allumé : le repli du gratuit selon l'oracle (général gardé, fourchette dégradée, état-proche retiré)`, LIBRES.map(g => j(rp(on[g]) ?? null)), LIBRES.map(() => attenduGratuit));
        // (5) le guide est servi (Tauros) : le repli général reste un prix affiché, le scan est compté comme pour Pro
        H.v(`B4 ${nom} — (5) facturation du non-Pro = celle de Pro (le guide affiché est un prix : le scan compte)`, LIBRES.map(g => j(fact(on[g]))), LIBRES.map(() => j(fact(on.pro))));
        if (nom.startsWith('lecture ratée')) {
            H.v('B4 F1 (5) lecture ratée définitive, état nul, guide servi : Pro ET non-Pro COMPTENT (debite 1, prix-repli) — plus de remboursement d\'un scan dont le guide est affiché', ['pro', ...LIBRES].map(g => [fact(on[g]).debite, fact(on[g]).rembourse, fact(on[g]).raisonNonRembourse]), ['pro', ...LIBRES].map(() => [1, false, 'prix-repli']));
            H.v('B4 (5) éteint, le gratuit garde le repli et compte (la réponse d\'avant)', [fact(off.gratuit).rembourse, fact(off.gratuit).raisonNonRembourse], [false, 'prix-repli']);
        }
    }

    // ── B5. la règle de quota elle-même, par la fonction de production, sur les replis réels
    {
        const PR = require('../identifier/prix-repli');
        const guide = REEL.tauros.prixGuideServi;
        const fourchette = { repli: 'tendance', cause: 'etat-non-retenu', fiable: false, guide, offre: null, fourchette: { basse: { prix: GU.low, source: 'guide-de' }, haute: null, absentes: ['haute'] } };
        const degrade = sur(() => reserve.repliSelonOffre(fourchette, false)), pro = sur(() => reserve.repliSelonOffre(fourchette, true));
        H.v('B5. F1 : le repli à fourchette est DÉGRADÉ pour le non-Pro (même guide, sans fourchette) et reste un prix affiché ; Pro le garde entier', [degrade && 'fourchette' in degrade, degrade && degrade.guide === guide, PR.afficheUnPrix({ repli: degrade }), pro === fourchette], [false, true, true, true]);
        const tendance = { repli: 'tendance', cause: 'langue-non-lue', fiable: false, guide, offre: null };
        H.v('   le repli général reste tel quel (même référence) pour le gratuit', sur(() => reserve.repliSelonOffre(tendance, false)) === tendance, true);
        H.v('   etat-proche et fourchette sans guide sont retirés pour le gratuit : plus un prix affiché', [{ repli: 'etat-proche', cause: 'offre-autre-etat', fiable: false, guide: null, offre: { etat: 'GD', prix: LU.pire } }, { repli: 'fourchette', cause: 'etat-non-retenu', fiable: false, guide: null, offre: null, fourchette: {} }].map(r => PR.afficheUnPrix({ repli: sur(() => reserve.repliSelonOffre(r, false)) })), [false, false]);
    }

    // ── B6. le QUOTA d'un lot : sans le prixLive ni le repli, le lot du gratuit sans guide n'affiche plus de prix (rendu) ; Pro et le drapeau éteint le comptent
    {
        const lueN = n => Array.from({ length: n }, (_, i) => X.aff(SANS[i % SANS.length], { retenu: null, codeLangue: 2 }));
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
        MODE = { retenu: null, codeLangue: 2 }; PRODUIT = TAUROS; lotImpl = null;
        const k1 = cle(), p = await porteurDe('pro');
        const r1 = await ident(svOn.url, p, k1), r1b = await ident(svOn.url, p, k1);
        H.v('B7a. rejeu sous Pro (rien n\'a changé) : l\'en-tête Idempotency-Replayed, la MÊME réponse à l\'octet', [r1b.entetes['idempotency-replayed'], r1b.texte === r1.texte], ['true', true]);
        H.vrai('   (la réponse initiale de Pro porte bien le prix par état)', cartesDe(r1).some(aDuPrixParEtat));
        await raw('comptes').updateOne({ _id: p.compte._id }, { $set: { 'abonnement.jusquAu': X.passe } });
        const r1c = await ident(svOn.url, p, k1);
        H.v('B7b. rejeu APRÈS expiration de l\'abonnement : rien ne fuit — aucun prix par état ni par langue, le reste de l\'analyse intact', [r1c.entetes['idempotency-replayed'], j(cartesDe(r1c)) === j(cartesDe(r1).map(gratuitDe)), cartesDe(r1c).some(aDuPrixParEtat), j(cartesDe(r1c).map(c => c.etat)) === j(cartesDe(r1).map(c => c.etat))], ['true', true, false, true]);
        const k2 = cle(), g = await porteurDe('gratuit');
        const s1 = await ident(svOn.url, g, k2);
        H.vrai('B7c. première réponse du gratuit : aucun prix par état', !cartesDe(s1).some(aDuPrixParEtat));
        await raw('comptes').updateOne({ _id: g.compte._id }, { $set: { abonnement: X.abo(X.futur) } });
        const s2 = await ident(svOn.url, g, k2);
        H.v('B7c. rejeu APRÈS passage à Pro : le prix par état est servi (la réponse conservée est complète), égal à ce que Pro reçoit', [s2.entetes['idempotency-replayed'], j(cartesDe(s2)) === j(cartesDe(r1)), s2.json.scanId === s1.json.scanId], ['true', true, true]);
        await raw('comptes').updateOne({ _id: g.compte._id }, { $set: { 'abonnement.jusquAu': X.passe } });
        const s3 = await ident(svOn.url, g, k2);
        H.v('B7d. et de nouveau expiré : le gratuit, à l\'octet de la première réponse du gratuit (hors le rejeu)', [j(cartesDe(s3)) === j(cartesDe(s1)), j(s3.json.analyse.regleVerdict) === j(s1.json.analyse.regleVerdict)], [true, true]);
        const k3 = cle(), e = await porteurDe('gratuit');
        const t1 = await ident(svOff.url, e, k3), t2 = await ident(svOff.url, e, k3);
        H.v('B7e. drapeau éteint : rejeu identique à l\'octet, avec le prix par état (la réponse d\'avant)', [t2.texte === t1.texte, cartesDe(t2).some(aDuPrixParEtat)], [true, true]);
        const k4 = cle(), q = await porteurDe('pro');
        const u1 = await ident(svOn.url, q, k4);
        X.enPanne.add(String(q.compte._id));
        const u2 = await ident(svOn.url, q, k4);
        X.enPanne.delete(String(q.compte._id));
        H.v('B7f. rejeu quand la lecture de l\'offre échoue : la réponse du gratuit (rien ne fuit)', [u2.statut, cartesDe(u2).some(aDuPrixParEtat), j(cartesDe(u2)) === j(cartesDe(u1).map(gratuitDe))], [200, false, true]);
        const k5 = cle(), l = await porteurDe('gratuit'); lotImpl = async () => lotListe();
        const m1 = await ident(svOn.url, l, k5);
        await raw('comptes').updateOne({ _id: l.compte._id }, { $set: { abonnement: X.abo(X.futur) } });
        const m2 = await ident(svOn.url, l, k5);
        H.v('B7g. lot : première réponse du gratuit, rejeu sous Pro : la réponse conservée est celle qui a été servie (la décision d\'argent du lot en a dépendu) — arbitrage nommé', [m2.entetes['idempotency-replayed'], j(cartesDe(m2)) === j(cartesDe(m1))], ['true', true]);
        const k6 = cle(), lp = await porteurDe('pro'); lotImpl = async () => lotListe();
        const w1 = await ident(svOn.url, lp, k6);
        await raw('comptes').updateOne({ _id: lp.compte._id }, { $set: { 'abonnement.jusquAu': X.passe } });
        const w2 = await ident(svOn.url, lp, k6);
        H.v('B7h. lot : première réponse de Pro, rejeu après expiration : rien ne fuit', [cartesDe(w1).some(aDuPrixParEtat), cartesDe(w2).some(aDuPrixParEtat), j(cartesDe(w2)) === j(cartesDe(w1).map(gratuitDe))], [true, false, true]);
        lotImpl = null;
    }

    // ── B9. F2 : une carte UNIQUE sans AUCUN prix au guide, servie à un non-Pro sans instruction de prix : le scan est RENDU par le serveur, une seule fois
    {
        const E1 = { retenu: 'EX', codeLangue: 2 };
        const on = {}, off = {};
        for (const g of GENRES) { on[g] = await scanPour(svOn.url, g, E1, SANS[0]); off[g] = await scanPour(svOff.url, g, E1, SANS[0]); }
        const f = o => { const x = o.r.json.facturation; return { debite: x.debite, rembourse: x.rembourse, motif: x.motif }; };
        H.v('B9 F2 (garde de scénario) : la carte complète de Pro porte une instruction prixLive et AUCUN prixGuide ni repli', [on.pro.r.json.analyse.cartes[0].prixLive !== null, on.pro.r.json.analyse.cartes[0].carte.prixGuide, 'prixRepli' in on.pro.r.json.analyse.cartes[0]], [true, null, false]);
        H.v('B9 F2 Pro : le scan COMPTE (l\'instruction peut donner un prix que le serveur ne voit pas) — debite 1, affirmee, un crédit pris, aucun remboursement', [f(on.pro), await prisDuJour(on.pro.x), await remboursements(on.pro.scanId)], [{ debite: 1, rembourse: false, motif: 'affirmee' }, 1, 0]);
        H.v('B9 F2 drapeau éteint, gratuit : le scan compte (la réponse d\'avant)', [f(off.gratuit), await prisDuJour(off.gratuit.x)], [{ debite: 1, rembourse: false, motif: 'affirmee' }, 1]);
        for (const g of LIBRES) {
            H.v(`B9 F2 ${g}, allumé : aucun prix affiché (ni instruction, ni guide, ni repli) : le scan est RENDU (sans-prix), le compteur du jour revient à 0, UN remboursement`, [f(on[g]), await prisDuJour(on[g].x), await remboursements(on[g].scanId), on[g].r.json.analyse.cartes[0].prixLive], [{ debite: 0, rembourse: true, motif: 'sans-prix' }, 0, 1, null]);
        }
        // pas de DOUBLE remboursement : un retour-live (lecture ratée définitive) trouve le scan déjà rendu
        const g = on.gratuit;
        const rl = await retour(svOn.url, g.x, { scanId: g.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('B9 F2 retour-live (lecture ratée définitive) après le remboursement serveur : « deja-rembourse », rien de rendu de plus, toujours UN remboursement, compteur à 0', [rl.statut, rl.json.facturation.rembourse, rl.json.facturation.raisonNonRembourse, await remboursements(g.scanId), await prisDuJour(g.x)], [200, false, 'deja-rembourse', 1, 0]);
        // le rejeu de la même requête ne rend pas une seconde fois
        const k = cle(), z = await porteurDe('gratuit'); MODE = E1; PRODUIT = SANS[0]; lotImpl = null;
        const z1 = await ident(svOn.url, z, k), z2 = await ident(svOn.url, z, k);
        H.v('B9 F2 rejeu de la même requête : la même réponse à l\'octet, toujours UN remboursement, compteur à 0', [z2.texte === z1.texte, z2.entetes['idempotency-replayed'], await remboursements(z1.json.scanId), await prisDuJour(z)], [true, 'true', 1, 0]);
        // une carte AU GUIDE n'est jamais rendue : le guide affiché est un prix
        for (const mode of [{ retenu: null, codeLangue: 2 }, E1, { retenu: 'EX', codeLangue: null }]) {
            const a = await scanPour(svOn.url, 'gratuit', mode, TAUROS);
            H.v(`B9 F2 témoin : carte AU GUIDE (état ${mode.retenu}, langue ${mode.codeLangue}), gratuit allumé : le scan COMPTE, aucun remboursement`, [f(a), await prisDuJour(a.x), await remboursements(a.scanId)], [{ debite: 1, rembourse: false, motif: 'affirmee' }, 1, 0]);
        }
    }

    // ── B10. résidu de F2 : la réponse à une QUESTION d'UNE carte dont le candidat tranché n'a aucun prix, servie à un non-Pro : le crédit confirmé est RENDU une seule fois
    {
        const E1 = { retenu: 'EX', codeLangue: 2 };
        MODE = E1; PRODUIT = TAUROS; lotImpl = null;
        const jouerQ = async (url, g, ms) => { QUESTION = ms; const x = await porteurDe(g); const r = await ident(url, x); const rep = await repondre(url, x, { scanId: r.json.scanId, carte: 0, choix: 'a' }); QUESTION = null; return { x, r, rep, scanId: r.json.scanId }; };
        const f = o => { const x = o.rep.json.facturation; return { debite: x.debite, rembourse: x.rembourse, motif: x.motif }; };
        const sansPrix = [SANS[0], SANS[1]];
        const on = {}, off = {};
        for (const g of GENRES) { on[g] = await jouerQ(svOnQ.url, g, sansPrix); off[g] = await jouerQ(svOffQ.url, g, sansPrix); }
        H.v('B10 (garde de scénario) : la question d\'UNE carte est répondue, la carte tranchée est identifiée, et la carte complète de Pro porte une instruction prixLive sans aucun guide', [on.pro.r.json.analyse.cartes[0].statut, on.pro.rep.statut, on.pro.rep.json.carte.statut, on.pro.rep.json.carte.carte.idProduct, on.pro.rep.json.carte.prixLive !== null, on.pro.rep.json.carte.carte.prixGuide], ['a-trancher', 200, 'identifiee', SANS[0].id, true, null]);
        H.v('B10 Pro : le scan COMPTE (debite 1, question), un crédit pris, aucun remboursement', [f(on.pro), await prisDuJour(on.pro.x), await remboursements(on.pro.scanId)], [{ debite: 1, rembourse: false, motif: 'question' }, 1, 0]);
        H.v('B10 drapeau éteint, gratuit : le scan compte (la réponse d\'avant)', [f(off.gratuit), await prisDuJour(off.gratuit.x)], [{ debite: 1, rembourse: false, motif: 'question' }, 1]);
        for (const g of LIBRES) H.v(`B10 ${g}, allumé : aucun prix affiché (ni instruction, ni guide, ni repli) : le scan est RENDU (sans-prix), le compteur du jour revient à 0, UN remboursement, aucune instruction servie`, [f(on[g]), await prisDuJour(on[g].x), await remboursements(on[g].scanId), on[g].rep.json.carte.prixLive], [{ debite: 0, rembourse: true, motif: 'sans-prix' }, 0, 1, null]);
        // pas de DOUBLE remboursement : le rejeu de la même réponse retrouve le scan déjà rendu
        const g = on.gratuit;
        const rej = await repondre(svOnQ.url, g.x, { scanId: g.scanId, carte: 0, choix: 'a' });
        H.v('B10 rejeu de la même réponse : la facturation dit toujours « rendu », toujours UN remboursement, compteur à 0', [rej.statut, rej.json.facturation.rembourse, rej.json.facturation.motif, await remboursements(g.scanId), await prisDuJour(g.x)], [200, true, 'sans-prix', 1, 0]);
        // et un retour-live qui suit trouve le scan déjà rendu
        await raw('journal_scans').insertOne({ _id: oid(g.scanId), userId: g.x.userId, route: 'identifier' });
        const rl = await retour(svOnQ.url, g.x, { scanId: g.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('B10 retour-live (lecture ratée définitive) après le remboursement serveur : jamais de second remboursement', [rl.statut, await remboursements(g.scanId), await prisDuJour(g.x)], [200, 1, 0]);
        // témoin : le candidat tranché a un GUIDE : le guide affiché est un prix, le scan compte, rien n'est rendu
        const t = await jouerQ(svOnQ.url, 'gratuit', [TAUROS, ARCANIN]);
        H.v('B10 témoin : candidat tranché AU GUIDE, gratuit allumé : le scan COMPTE, aucun remboursement', [t.rep.json.carte.carte.idProduct, f(t), await prisDuJour(t.x), await remboursements(t.scanId)], [TAUROS.id, { debite: 1, rembourse: false, motif: 'question' }, 1, 0]);
        // un LOT : répondre à une question de lot ne coûte ni ne rend rien : jamais de remboursement par cette route
        const lotQ = async () => { const x = await porteurDe('gratuit'); lotImpl = async () => [X.aff(TAUROS, { retenu: 'EX', codeLangue: 2 }), X.qst([SANS[0], SANS[1]], { retenu: 'EX', codeLangue: 2 })]; const r = await ident(svOn.url, x); const q = cartesDe(r).findIndex(c => c.statut === 'a-trancher'); const rep = await repondre(svOn.url, x, { scanId: r.json.scanId, carte: q, choix: 'a' }); lotImpl = null; return { x, r, rep }; };
        const L = await lotQ();
        H.v('B10 une question de LOT : le lot garde une carte AU GUIDE (donc compté) ; répondre à sa question sans prix ne rembourse rien (le lot se juge une fois, à l\'analyse)', [L.rep.statut, await remboursements(L.r.json.scanId)], [200, 0]);
    }

    // ── B11. l'HISTORIQUE (argent/solde.js::ligneAnalyse, servi par GET /api/compte) ne porte AUCUN champ de prix réservé : ni pour Pro, ni pour un non-Pro
    {
        MODE = { retenu: null, codeLangue: 2 }; PRODUIT = TAUROS; lotImpl = null; QUESTION = null;
        const ag = registre.obtenir('argent');
        for (const g of ['pro', 'gratuit']) {
            const x = await porteurDe(g); const r = await ident(svOn.url, x);
            const h = await ag.historique({ type: 'compte', id: x.compte._id }, {});
            const ligne = (h.lignes || []).find(l => l.genre === 'analyse');
            H.vrai(`B11 (${g}) : l'historique porte la ligne de l'analyse qui vient d'être faite (statut ${ligne && ligne.statut})`, Boolean(ligne) && ligne.statut === 'identifiee' && r.statut === 200);
            H.v(`B11 (${g}) : aucun champ de prix (prixLive, prixRepli, prixGuide, fourchette, tendance, langues, etatVise) dans la ligne servie`, /prixLive|prixRepli|prixGuide|fourchette|tendance|langues|etatVise|reverseHolo/.test(j(ligne || {})), false);
        }
    }

    // ── B8. le contrat : /ping annonce la réservation seulement quand elle est allumée
    {
        const { capacitesServies } = require('../capacites');
        H.v('B8. le jeton `prix-pro-reserve` n\'est annoncé que drapeau allumé (la clé absente est lue éteinte)', [capacitesServies(cfgOff).includes('prix-pro-reserve'), capacitesServies(cfgOn).includes('prix-pro-reserve')], [false, true]);
    }

    // ── C. la mutation : le jeu existe, ses ancres sont valides, il couvre CHAQUE sortie déduite ; sa MORT est prouvée par le jeu lui-même (copie mutée chargée ET banc rouge : verdict TUÉ, sinon NON-CHARGÉ ou SURVIVANT)
    try {
        const MU = require('../mesures/mutations-prix-reserve-pro');
        H.v('C1. le jeu de mutants (une garde retirée par sortie) a toutes ses ancres', MU.ancresCassees(), []);
        const vivants = MU.MUTANTS.filter(m => !m[5]);
        H.v('C2. chaque sortie déduite du code a au moins un mutant NON équivalent qui retire SA garde', sorties.filter(f => !vivants.some(m => m[1] === f)), []);
        H.v('C3. chaque mutant a un banc qui existe, et un mutant déclaré équivalent porte sa raison écrite', [MU.MUTANTS.filter(m => !fs.existsSync(path.join(__dirname, m[4]))).map(m => m[0]), MU.MUTANTS.filter(m => m[5] !== undefined && !(typeof m[5] === 'string' && m[5].length > 20)).map(m => m[0])], [[], []]);
        H.v('C4. le jeu EXIGE la preuve de chargement : un mutant dont la copie n\'a pas été compilée ne peut pas être « TUÉ » (accroche-mutant.js écrit sa trace, le jeu la relit)', [/RM_MUTANT_TRACE/.test(fs.readFileSync(path.join(V, 'mesures', 'accroche-mutant.js'), 'utf8')), /NON-CHARGÉ/.test(fs.readFileSync(path.join(V, 'mesures', 'mutations-prix-reserve-pro.js'), 'utf8'))], [true, true]);
    } catch (e) { H.vrai(`C. le jeu de mutants est chargeable (${e && e.message})`, false); }

    await svOff.fermer(); await svOn.fermer(); await svOffQ.fermer(); await svOnQ.fermer();
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
