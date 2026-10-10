'use strict';
// Banc B1b.7 — la règle G branchée DERRIÈRE son interrupteur (V2_REGLE_G), et le montage final (registre, balayage, purge).
// Base : la base EN MÉMOIRE du banc (INT2) — jamais la production, ni la grappe, ni R2. Aucune requête réseau.
// La chaîne héritée est FABRIQUÉE (deps.gererIdentifier), comme dans test-identifier-v2.js : c'est la seule façon de produire un verdict ferme ET de
// fabriquer chaque désaccord. Les voisins sont un FAUX fournisseur rejouant les fixtures du labo (ratmarket/fixtures-g) : si elles manquent, le banc le
// DIT et ÉCHOUE (jamais vert) — aucune fixture « réaliste » n'est fabriquée à leur place.
// L'assertion (1) — interrupteur éteint, decisionRegleG jamais appelée — est écrite EN PREMIER.
const H = require('./_harnais');
const fs = require('fs'), path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const { lireConfig } = require('../config');
const { choixPour } = require('../choix');
const G = require('../../ratmarket/decision-g');
const RG = require('../identifier/regle-g');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const DOSSIER_FIXTURES = process.argv.find((a, i) => i > 1 && !a.startsWith('--')) || 'C:/Users/Yung/Desktop/labo-embedding/rm/fixtures-g';
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch' });
const cfgOn = lireConfig({ MONGODB_BASE: 'test_scratch', V2_REGLE_G: '1' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.9.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-b1b7-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
const corps = (o = {}) => ({ contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...o });
async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function poster(url, jeton) {
    return H.appel(url, '/api/identifier', { methode: 'POST', corps: corps(), entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
}
const essaisDe = async id => (await raw('installations').findOne({ _id: id })).essais;
const mouvements = id => raw('mouvements').find({ installationId: id }).toArray();
const ID_A = 895789, ID_B = 895790, EXP = 990001;
const semerProduit = async id => {
    await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
    await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
    await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    await raw('visuels').insertOne({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990101, numero: '001', rarete: 'Common', total: '064', variante: 'normale', setNom: 'Banc Set', lien: null });
};

// ── les fixtures du labo : une ligne qui AFFIRME et une qui pose une QUESTION, trouvées par l'enveloppe elle-même
function chargerFixtures() {
    if (!fs.existsSync(path.join(DOSSIER_FIXTURES, 'contexte.json')) || !fs.existsSync(path.join(DOSSIER_FIXTURES, 'reel.json'))) return null;
    const ctx = G.contexte(JSON.parse(fs.readFileSync(path.join(DOSSIER_FIXTURES, 'contexte.json'), 'utf8')));
    const F = JSON.parse(fs.readFileSync(path.join(DOSSIER_FIXTURES, 'reel.json'), 'utf8'));
    const mesuresDe = l => {
        const fichier = k => { const x = F.fichierDe[k]; if (!x) throw new Error('fichier inconnu ' + k); return x; };
        return { comparerPaire: (a, b) => { const p = l.paires[`${fichier(a)}|${fichier(b)}`]; if (!p) throw new Error('paire'); return p; },
                 scoresZones: x => { const z = l.zones[fichier(x)]; if (!z) throw new Error('zones'); return z; } };
    };
    let affirmee = null, question = null, n = 0;
    for (const l of F.lignes) {
        let w; try { w = RG.decisionRegleG({ ligne: l, nEssais: l.nEssais, mesures: mesuresDe(l), contexteG: ctx }, F.seuils); } catch { continue; }
        n++;
        if (w && w.issue === 'affirmee' && !affirmee) affirmee = { l, produit: w.produit };
        if (w && w.issue === 'question' && !question) question = { l, candidats: w.candidats };
        if (affirmee && question) break;
    }
    return { ctx, F, mesuresDe, affirmee, question, n };
}

(async () => {
    const fx = chargerFixtures();
    H.vrai(`0. fixtures du labo présentes (${DOSSIER_FIXTURES}) et contenant une ligne qui affirme ET une qui pose une question (sinon le banc ne conclut pas : code 1)`, fx && fx.affirmee && fx.question);
    if (!fx || !fx.affirmee || !fx.question) { console.log('❌ fixtures du labo ABSENTES ou sans cas : aucune fixture n\'est fabriquée à leur place'); H.bilan(); return; }
    const P = fx.affirmee.produit, Q = fx.question.candidats;
    console.log(`   fixtures : ${fx.n} lignes jouées avant de trouver un affirmé (produit ${P}) et une question (candidats ${JSON.stringify(Q)})`);

    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-identifier-regle-g-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const id of new Set([ID_A, ID_B, P, ...Q])) await semerProduit(id);

    const express = require('express'); const pret = require('../pret'); const registre = require('../registre');
    const { dansUnScan } = require('../../sources');
    const { assembler } = require('../index');
    const corpsAffirme = id => ({ success: true, question: null, carte: { idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu: false },
        etat: { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null },
        candidats: [{ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 });
    let chaine = null;                                            // { mode, ids }
    let appelsChaine = 0;
    const chaineFabriquee = async (req, res) => {
        appelsChaine++;
        const { mode, ids } = chaine;
        if (mode === 'affirmee') return res.json({ ...corpsAffirme(ids[0]), scanId: String(req.scanIdImpose) });
        if (mode === 'introuvable') { await req.credit.v2.rembourser(req, 'aucun-prix'); return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' }); }
        if (mode === 'ambigue') {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: ids });
            return res.json({ ...corpsAffirme(ids[0]), scanId: String(req.scanIdImpose), question: { etat: 'en-attente', delaiHeures: 24 }, carte: { ...corpsAffirme(ids[0]).carte, ambigu: true },
                candidats: ids.map(id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null })) });
        }
        if (mode === 'refus-egalite') {
            await req.credit.v2.rembourser(req, 'egalite-parfaite');
            return res.json({ success: false, natureRefus: 'refus-delibere', motifRefus: 'egalite-parfaite', candidats: ids.map(id => ({ idProduct: id })) });
        }
        throw new Error(`mode inconnu ${mode}`);
    };
    // ── l'espion : decisionRegleG est appelée À TRAVERS l'objet du module (RG.decisionRegleG), jamais par une référence figée
    const origDecision = RG.decisionRegleG;
    let appelsG = 0, appelsVoisins = 0;
    RG.decisionRegleG = (...a) => { appelsG++; return origDecision(...a); };
    let voisinsMode = null;                                       // 'affirmee' | 'question' | 'nul' | 'leve' | 'contexte-absent' | 'question-inconnue'
    const voisins = async () => {
        appelsVoisins++;
        if (voisinsMode === 'leve') throw new Error('service de voisins injoignable');
        if (voisinsMode === 'nul') return null;
        const l = voisinsMode === 'question' ? fx.question.l : fx.affirmee.l, base = l;
        const r ={ ligne: l, nEssais: l.nEssais, mesures: fx.mesuresDe(base), contexteG: fx.ctx, seuils: fx.F.seuils };
        if (voisinsMode === 'contexte-absent') r.contexteG = null;
        return r;
    };
    const appFabrique = async (cfgApp, deps = {}) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { gererIdentifier: chaineFabriquee, ...deps }));
        return H.serveur(app);
    };
    const jouer = async (sv, c, vm) => { chaine = c; voisinsMode = vm; appelsG = 0; appelsVoisins = 0; const x = await inst(3); const r = await poster(sv.url, x.jeton); await attendre(50); return { ...x, r, j: r.json || {} }; };
    const analyseDe = async j => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(j.scanId) });
    const sansRetenue = ent => { const { _id, ...x } = ent || {}; return x; };

    // ── (1) EN PREMIER : interrupteur ÉTEINT => la chaîne héritée décide, decisionRegleG jamais appelée (même avec un fournisseur de voisins branché)
    const svOff = await appFabrique(cfgOff, { voisins });
    {
        const o = await jouer(svOff, { mode: 'affirmee', ids: [ID_A] }, 'question');
        H.v('1. V2_REGLE_G éteint (avec un fournisseur de voisins branché) : la chaîne héritée décide — identifiee, facturation affirmee', [o.r.statut, o.j.analyse.statut, o.j.analyse.cartes[0].carte.idProduct, o.j.facturation.motif], [200, 'identifiee', ID_A, 'affirmee']);
        H.v('   decisionRegleG et voisins jamais appelés (espions : 0 et 0), la chaîne appelée une fois', [appelsG, appelsVoisins, appelsChaine > 0], [0, 0, true]);
        H.vrai('   aucun désaccord journalisé', !(await analyseDe(o.j)).desaccordRegleG);
    }
    // contrôle de l'espion : le MÊME montage, interrupteur allumé, doit faire bouger l'espion (sinon le 0 ci-dessus ne prouverait rien)
    const svOn = await appFabrique(cfgOn, { voisins });
    {
        const o = await jouer(svOn, { mode: 'affirmee', ids: [P] }, 'affirmee');
        H.vrai('   contrôle de l\'espion : allumé, avec voisins, decisionRegleG ET le fournisseur sont appelés', appelsG === 1 && appelsVoisins === 1);
        void o;
    }

    // ── (2) allumé SANS deps.voisins : la chaîne héritée décide + une ligne d'avertissement au démarrage
    {
        const avert = []; const w = console.warn; console.warn = (...x) => { avert.push(x.join(' ')); };
        let svSans; try { svSans = await appFabrique(cfgOn, {}); } finally { console.warn = w; }
        H.vrai('2. allumé sans fournisseur de voisins : une ligne d\'avertissement « règle G demandée, aucun fournisseur de voisins » au montage', avert.filter(l => /règle G demandée, aucun fournisseur de voisins/.test(l)).length === 1);
        appelsG = 0; chaine = { mode: 'affirmee', ids: [ID_A] };
        const x = await inst(3); const r = await poster(svSans.url, x.jeton);
        H.v('   la chaîne héritée décide (identifiee, essai 3 -> 2), decisionRegleG jamais appelée', [r.json.analyse.statut, r.json.analyse.cartes[0].carte.idProduct, await essaisDe(x.i._id), appelsG], ['identifiee', ID_A, 2, 0]);
        // éteint : aucun avertissement (l'avertissement ne dit que ce qui est demandé)
        const avert2 = []; console.warn = (...x2) => { avert2.push(x2.join(' ')); };
        let svEteint; try { svEteint = await appFabrique(cfgOff, {}); } finally { console.warn = w; }
        await svEteint.fermer();
        H.vrai('   éteint sans voisins : aucun avertissement', avert2.filter(l => /règle G/.test(l)).length === 0);
        await svSans.fermer();
    }

    // ── (3) allumé AVEC les voisins des fixtures : la décision de G devient la forme de l'adaptateur et la facturation qui lui correspond
    {
        // G affirme P, la chaîne affirme P : accord => identifiee, débit
        const a = await jouer(svOn, { mode: 'affirmee', ids: [P] }, 'affirmee');
        H.v('3a. G affirme, la chaîne affirme le même produit : identifiee, facturation affirmee { debite:1 }, essai 3 -> 2, aucun désaccord', [a.j.analyse.statut, a.j.analyse.cartes[0].carte.idProduct, a.j.facturation.motif, a.j.facturation.debite, await essaisDe(a.i._id), (await analyseDe(a.j)).desaccordRegleG], ['identifiee', P, 'affirmee', 1, 2, undefined]);
        // G pose une question sur Q, la chaîne pose la même question : accord => a-trancher, crédit réservé
        const b = await jouer(svOn, { mode: 'ambigue', ids: Q }, 'question');
        const qb = await raw('questions').findOne({ _id: `${b.j.scanId}:0` });
        H.v('3b. G pose une question, la chaîne pose la même : a-trancher, facturation { debite:0, reserve:1, motif:question }, aucun désaccord', [b.j.analyse.statut, b.j.analyse.cartes[0].candidats.map(c => c.idProduct).sort(), b.j.facturation, (await analyseDe(b.j)).desaccordRegleG], ['a-trancher', [...Q].sort(), { debite: 0, reserve: 1, rembourse: false, motif: 'question', raisonNonRembourse: null }, undefined]);
        H.v('   la question existe, en-attente, ses choix = choixPour(candidats)', [qb && qb.etat, qb && qb.choix], ['en-attente', choixPour(Q.slice(0, 3))]);
    }

    // ── (4) DÉSACCORD : jamais tranché en silence — le plus PRUDENT gagne (a-trancher > identifiee), la facturation suit l'issue retenue, ligne desaccordRegleG
    {
        const journal = []; const w = console.warn; console.warn = (...x) => { journal.push(x.join(' ')); };
        let a, b, c, d;
        try {
            // 4a. la chaîne AFFIRME un produit, G pose une QUESTION : la question gagne ; le crédit pris par l'affirmation est RÉSERVÉ (pas débité, pas perdu)
            a = await jouer(svOn, { mode: 'affirmee', ids: [ID_A] }, 'question');
            // 4b. la chaîne pose une QUESTION (refus par égalité), G AFFIRME : la question de la chaîne gagne
            b = await jouer(svOn, { mode: 'refus-egalite', ids: [ID_A, ID_B] }, 'affirmee');
            // 4c. la chaîne affirme A, G affirme P (autre produit) : ni l'un ni l'autre n'est cru seul — question entre les deux
            c = await jouer(svOn, { mode: 'affirmee', ids: [ID_A] }, 'affirmee');
            // 4d. la chaîne ne trouve RIEN (introuvable, déjà remboursée), G affirme : on n'affirme pas contre un « introuvable »
            d = await jouer(svOn, { mode: 'introuvable', ids: [] }, 'affirmee');
        } finally { console.warn = w; }
        const reserve = { debite: 0, reserve: 1, rembourse: false, motif: 'question', raisonNonRembourse: null };
        const net = async x => (await mouvements(x.i._id)).reduce((s, m) => s + m.delta, 0);
        const ouverts = async x => (await mouvements(x.i._id)).filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat);
        H.v('4a. chaîne affirme / G question : a-trancher avec les candidats de G, facturation reserve (celle de l\'issue RETENUE, pas de l\'affirmation)', [a.j.analyse.statut, a.j.analyse.cartes[0].candidats.map(c => c.idProduct).sort((x, y) => x - y), a.j.facturation], ['a-trancher', [...Q].slice(0, 3).sort((x, y) => x - y), reserve]);
        H.v('   essai 3 -> 2, net -1, un seul débit RÉSERVÉ, question en-attente avec ses choix', [await essaisDe(a.i._id), await net(a), await ouverts(a), (await raw('questions').findOne({ _id: `${a.j.scanId}:0` })).etat], [2, -1, ['reserve'], 'en-attente']);
        const anA = await analyseDe(a.j);
        H.v('   desaccordRegleG écrit : chaîne affirmee, G question, retenue a-trancher, produits des deux côtés', anA.desaccordRegleG, { chaine: 'affirmee', regleG: 'question', retenue: 'a-trancher', produitsChaine: [ID_A], produitsRegleG: Q.slice(0, 3) });
        H.v('4b. chaîne question / G affirme : la question de la chaîne reste (2 candidats), facturation reserve', [b.j.analyse.statut, b.j.analyse.cartes[0].candidats.map(c => c.idProduct), b.j.facturation, await essaisDe(b.i._id), await ouverts(b)], ['a-trancher', [ID_A, ID_B], reserve, 2, ['reserve']]);
        H.v('   desaccordRegleG : chaîne question, G affirmee, retenue a-trancher', (await analyseDe(b.j)).desaccordRegleG, { chaine: 'question', regleG: 'affirmee', retenue: 'a-trancher', produitsChaine: [ID_A, ID_B], produitsRegleG: [P] });
        H.v('4c. chaîne affirme A / G affirme P (autre) : question entre les deux, facturation reserve, essai 2', [c.j.analyse.statut, c.j.analyse.cartes[0].candidats.map(x => x.idProduct).sort((x, y) => x - y), c.j.facturation, await essaisDe(c.i._id), await ouverts(c)], ['a-trancher', [ID_A, P].sort((x, y) => x - y), reserve, 2, ['reserve']]);
        H.v('   desaccordRegleG : chaîne affirmee, G affirmee, retenue a-trancher', (await analyseDe(c.j)).desaccordRegleG, { chaine: 'affirmee', regleG: 'affirmee', retenue: 'a-trancher', produitsChaine: [ID_A], produitsRegleG: [P] });
        H.v('4d. chaîne introuvable (déjà remboursée) / G affirme : introuvable gardé, crédit rendu (essai 3), facturation introuvable', [d.j.analyse.statut, d.j.facturation.motif, d.j.facturation.rembourse, await essaisDe(d.i._id), await net(d)], ['introuvable', 'introuvable', true, 3, 0]);
        H.v('   desaccordRegleG : chaîne introuvable, G affirmee, retenue introuvable', (await analyseDe(d.j)).desaccordRegleG, { chaine: 'introuvable', regleG: 'affirmee', retenue: 'introuvable', produitsChaine: [], produitsRegleG: [P] });
        H.v('   chaque désaccord a sa ligne au journal (4 lignes « desaccordRegleG »)', journal.filter(l => /desaccordRegleG/.test(l)).length, 4);
        // la question née du désaccord se RÉPOND comme n'importe quelle autre : débit unique
        const argentReg = registre.obtenir('argent');
        const porteurA = { type: 'installation', id: a.i._id, compte: null, installation: a.i, surface: 'extension', administrateur: false };
        const idChoix = (await raw('questions').findOne({ _id: `${a.j.scanId}:0` })).choix[0].id;
        await argentReg.repondreQuestion(porteurA, { scanId: new mongoose.Types.ObjectId(a.j.scanId), carte: 0, choix: idChoix });
        H.v('   répondre à la question du désaccord 4a : débitée UNE fois (essai 2, net -1, débit « debite »)', [await essaisDe(a.i._id), await net(a), await ouverts(a)], [2, -1, ['debite']]);
        const abandon = await jouer(svOn, { mode: 'affirmee', ids: [ID_A] }, 'question');
        const porteurAb = { type: 'installation', id: abandon.i._id, compte: null, installation: abandon.i, surface: 'extension', administrateur: false };
        await argentReg.repondreQuestion(porteurAb, { scanId: new mongoose.Types.ObjectId(abandon.j.scanId), carte: 0, choix: 'aucune' });
        H.v('   abandonner la question du désaccord : crédit rendu (essai 3, net 0)', [await essaisDe(abandon.i._id), await net(abandon)], [3, 0]);
    }

    // ── (4 bis) G ne peut rien dire d'exploitable : la chaîne héritée décide, rien ne casse, rien n'est débité de plus
    {
        const journal = []; const e = console.error; const w = console.warn; console.error = (...x) => { journal.push(x.join(' ')); }; console.warn = (...x) => { journal.push(x.join(' ')); };
        let n, l, ca;
        try {
            n = await jouer(svOn, { mode: 'affirmee', ids: [ID_A] }, 'nul');                // le fournisseur ne sait pas : null
            l = await jouer(svOn, { mode: 'affirmee', ids: [ID_A] }, 'leve');               // le fournisseur lève
            ca = await jouer(svOn, { mode: 'affirmee', ids: [ID_A] }, 'contexte-absent');   // voisins sans contexte : decisionRegleG lève
        } finally { console.error = e; console.warn = w; }
        for (const [nom, x] of [['voisins null', n], ['voisins qui lèvent', l], ['contexte absent (decisionRegleG lève)', ca]]) {
            H.v(`4bis. ${nom} : la chaîne héritée décide (identifiee A, essai 3 -> 2), aucune erreur`, [x.r.statut, x.j.analyse.statut, x.j.analyse.cartes[0].carte.idProduct, await essaisDe(x.i._id), (await analyseDe(x.j)).desaccordRegleG], [200, 'identifiee', ID_A, 2, undefined]);
        }
        H.vrai('   les deux échecs sont journalisés sans contenu (aucune adresse, aucune image)', journal.filter(t => /règle G/.test(t)).length >= 2 && !journal.some(t => t.includes(IMAGE)));
        // produits de G absents du catalogue de l'API : on n'invente rien, la chaîne décide (jamais une panne de plus)
        for (const id of Q) await raw('catalogue_produits').deleteOne({ idProduct: id });
        const inconnu = await jouer(svOn, { mode: 'affirmee', ids: [ID_A] }, 'question');
        H.v('   G pose une question sur des produits absents du catalogue de l\'API : la chaîne décide, identifiee A, débitée une fois (essai 2)', [inconnu.r.statut, inconnu.j.analyse.statut, inconnu.j.analyse.cartes[0].carte.idProduct, await essaisDe(inconnu.i._id)], [200, 'identifiee', ID_A, 2]);
        for (const id of Q) await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
    }
    // pannes de la chaîne : G ne les rattrape pas (une panne reste une panne, remboursée) et n'est même pas consultée
    {
        chaine = { mode: 'exception-absente', ids: [] }; appelsG = 0; voisinsMode = 'affirmee';
        const x = await inst(3); const r = await poster(svOn.url, x.jeton);
        H.v('4ter. panne de la chaîne (mode inconnu => exception) : 500 SERVEUR remboursée, G non consultée', [r.statut, r.json.erreur.code, r.json.facturation.rembourse, await essaisDe(x.i._id), appelsG], [500, 'SERVEUR', true, 3, 0]);
    }
    await svOff.fermer(); await svOn.fermer();
    RG.decisionRegleG = origDecision;

    // ── (5) le montage final : registre (annonce, visuels, taux), UN balayage et UNE purge par processus, tous unref
    {
        const monter = require('../identifier/monter');
        monter.arreterBalayage(); if (monter.arreterPurge) monter.arreterPurge();
        registre.vider();
        const cree = [], efface = new Set(); const siOrig = global.setInterval, ciOrig = global.clearInterval;
        global.setInterval = (f, ms, ...r) => { const t = siOrig(f, ms, ...r); cree.push({ t, ms }); return t; };
        global.clearInterval = t => { efface.add(t); return ciOrig(t); };
        let a1, a2;
        try {
            const mk = () => assembler([require('../argent/monter'), require('../identifier/monter')], cfgOff, {});
            mk(); a1 = cree.filter(c => !efface.has(c.t)).map(c => c.ms);
            mk(); a2 = cree.filter(c => !efface.has(c.t)).map(c => c.ms);
        } finally { global.setInterval = siOrig; global.clearInterval = ciOrig; }
        const vivants = cree.filter(c => !efface.has(c.t));
        H.v('5. un montage arme UN balayage des questions (1/min) et UNE purge des annonces (24 h)', [...a1].sort((x, y) => x - y), [60 * 1000, 24 * 3600 * 1000]);
        H.v('   un second montage dans le même processus n\'en arme pas un second (toujours 1 + 1 minuteurs vivants, les premiers sont arrêtés)', [...a2].sort((x, y) => x - y), [60 * 1000, 24 * 3600 * 1000]);
        H.vrai('   tous les minuteurs vivants sont unref (ils ne retiennent jamais le processus)', vivants.length === 2 && vivants.every(c => c.t.hasRef() === false));
        const noms = ['annonce', 'visuels', 'taux'];
        const presents = noms.map(n => { try { return typeof registre.obtenir(n) === 'object'; } catch { return false; } });
        H.v('   le registre porte annonce, visuels, taux', presents, [true, true, true]);
        const an = registre.obtenir('annonce'), vi = registre.obtenir('visuels'), ta = registre.obtenir('taux');
        H.vrai('   annonce : preparerAnnonce expurge (un e-mail disparaît) et conserverAnnonce est une fonction', typeof an.preparerAnnonce === 'function' && typeof an.conserverAnnonce === 'function' && !/@/.test(an.preparerAnnonce({ title: 'x jean@exemple.fr', description: null }).titre));
        H.v('   visuels.resoudre(produit semé) : une URL de NOS fichiers ; produit absent : null', [(await vi.resoudre(ID_A)).url.startsWith(`https://${cfgOff.images.hotesPublics[0]}/`), await vi.resoudre(1)], [true, null]);
        H.v('   taux.versEUR(EUR) : 1', (await ta.versEUR('EUR')).versEUR, 1);
        // un fournisseur déjà posé (un banc, un autre lot) n'est jamais écrasé
        registre.vider(); registre.fournir('taux', { versEUR: async () => ({ versEUR: 7, tauxDate: null }) });
        assembler([require('../argent/monter'), require('../identifier/monter')], cfgOff, {});
        H.v('   un fournisseur déjà posé n\'est pas écrasé par le montage', (await registre.obtenir('taux').versEUR('EUR')).versEUR, 7);
        // « rien sans Mongo » : la passe de purge ne touche pas la base quand la connexion n'est pas prête
        let passes = 0; const purge = async () => { passes++; return { supprimees: 0 }; };
        const r0 = await monter.purgerAnnoncesUneFois({ etatMongo: () => 0, purge });
        const r1 = await monter.purgerAnnoncesUneFois({ etatMongo: () => 1, purge });
        const r2 = await monter.purgerAnnoncesUneFois({ etatMongo: () => 1, purge: async () => { throw new Error('boum'); } });
        H.v('   la purge ne fait rien sans Mongo prêt (0 passe), passe une fois si prêt (1), et une passe qui échoue ne lève pas', [r0, r1, r2, passes], [false, true, false, 1]);
        monter.arreterBalayage(); monter.arreterPurge();
    }
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
