'use strict';
// Banc PRIX-LISIBLE (routes) — le repli honnête `prixRepli` par les VRAIES routes v2 : POST /api/identifier/reponse (la carte tranchée dont l'analyse n'a rien dicté à lire)
// et POST /api/retour-live (lecture ratée, tendance seule, offre dans un état pire). Base : la base EN MÉMOIRE du banc (INT2), faux réseau du verrou dans l'enfant ; aucune production.
// Les fiches semées portent les champs RÉELS du guide de Tauros (Jungle 47/64) et d'Arcanin [G] Lv.60 (Supreme Victors 15/147), relevés en lecture seule (fixtures/prix-repli-reels.json) : aucune valeur inventée.
// L'état retenu de l'analyse est posé dans la ligne `analyses` avant la réponse (le faux modèle du verrou rend une confiance fixe) : c'est ce que l'analyse de Tauros avait écrit (confiance « basse », retenu null).
const H = require('./_harnais');
const path = require('path'), fs = require('fs');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const VB = require('./_visuels-banc'); const VIS = new Map(); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const REEL = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'prix-repli-reels.json'), 'utf8')).cas;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.7.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-prl-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
let validees = 0, ecarts = 0;

async function inst(essais = 3) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
const entetes = jeton => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}` });
const ID_A = 895789, ID_B = 895790, EXP = 990001;
const G = nom => ({ ...REEL[nom].guide, guideDu: new Date(REEL[nom].guide.guideDu) });
async function semer() {
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante, nom] of [[ID_A, 'normale', 'tauros'], [ID_B, 'reverse', 'arcanin']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, ...G(nom) });                 // ID_A porte le guide RÉEL de Tauros, ID_B celui d'Arcanin
        VIS.set(id, VB.doc(id, { variante }));
    }
}

(async () => {
    await H.ouvrirBancV2();
    await H.eviterFrontieres({ jour: true });
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-prix-repli-routes.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const { demarrer } = require('../../verrou/serveur');
    await semer();
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', V2_VISUELS_BANC_FICHIER: VB.fichier([...VIS.values()]) };
    const srv = await demarrer(FAUX, { ...base, RM_API_V2: '1' });
    if (!await srv.attendreMongo()) throw new Error('Mongo non connecté');
    const url = `http://127.0.0.1:${srv.port}`;

    const identifier = jeton => H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { ...entetes(jeton), 'idempotency-key': cle() } });
    const repondre = async (jeton, scanId, choix) => {
        const r = await H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: { scanId, choix }, entetes: entetes(jeton) });
        if (r.json && r.json.success === true) { const v = valider(r.json, ref('ReponseQuestion'), SCHEMA); validees++; if (!v.ok) { ecarts++; console.log(`   écart reponse : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
        return r;
    };
    const rl = async (jeton, corps) => {
        const r = await H.appel(url, '/api/retour-live', { methode: 'POST', corps, entetes: entetes(jeton) });
        if (r.json && r.json.success === true) { const v = valider(r.json, ref('ReponseRetourLive'), SCHEMA); validees++; if (!v.ok) { ecarts++; console.log(`   écart retour-live : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
        return r;
    };
    const oid = s => new mongoose.Types.ObjectId(s);
    const journal = async scanId => { for (let k = 0; k < 40; k++) { const l = await raw('journal_scans').findOne({ _id: oid(scanId) }); if (l) return l; await attendre(150); } return null; };
    const poserEtat = (scanId, retenu) => raw('analyses').updateOne({ _id: oid(scanId) }, { $set: { 'cartes.0.etat.retenu': retenu } });
    // un scan à question, dont l'état retenu est posé AVANT la réponse
    const scanQuestion = async (retenu) => {
        const x = await inst(3); const r = await identifier(x.jeton); const scanId = r.json.scanId; await journal(scanId);
        if (retenu !== undefined) await poserEtat(scanId, retenu);
        const q = await raw('questions_v2').findOne({ _id: `${scanId}:0` });
        return { ...x, scanId, q };
    };
    const repondu = async (choix = 'a', retenu) => { const s = await scanQuestion(retenu); const r = await repondre(s.jeton, s.scanId, choix); if (r.statut !== 200) throw new Error(`réponse refusée ${r.statut}`); await journal(s.scanId); return { ...s, rep: r.json, idRepondu: (s.q.choix.find(c => c.id === choix) || {}).idProduct }; };

    // ── A. la RÉPONSE à une question : l'analyse a écrit « état retenu null » (confiance basse) — le cas réel de Tauros
    {
        const s = await repondu('a', null);
        const c = s.rep.carte;
        H.v('A0. le produit répondu est celui du guide réel de Tauros (ID_A)', s.idRepondu, ID_A);
        H.v('A1. état retenu null : le client n\'a « rien à lire » (prixLive.etatVise null) — la cause réelle du « prix illisible »', [c.statut, c.prixLive && c.prixLive.etatVise], ['identifiee', null]);
        H.v('A2. ... et la carte porte le repli : tendance, cause etat-non-retenu, fiable false', [c.prixRepli && c.prixRepli.repli, c.prixRepli && c.prixRepli.cause, c.prixRepli && c.prixRepli.fiable], ['tendance', 'etat-non-retenu', false]);
        H.v('    les chiffres du guide RÉEL de Tauros (1,49 / 0,02 / 1,55 / 1,26 au 2026-10-12), aucune offre, aucun verdict', [c.prixRepli.guide.tendance, c.prixRepli.guide.de, c.prixRepli.guide.moyenne7, c.prixRepli.guide.moyenne30, c.prixRepli.guide.date, c.prixRepli.offre, 'verdict' in c.prixRepli], [1.49, 0.02, 1.55, 1.26, '2026-10-12', null, false]);
        // ETAT-FOURCHETTE : l'état retenu est null => le guide du repli est celui de la fiche SOUS FOURCHETTE (mêmes chiffres, jamais fiable, la mention en dernier) ; la fiche garde son guide
        H.v('    le guide du repli est la fiche servie (mêmes chiffres), sous fourchette : fiable false, réserve etat-non-estimable ; carte.prixGuide intact', [c.prixRepli.guide, c.carte.prixGuide.fiable, c.carte.prixGuide.reserves], [{ ...c.carte.prixGuide, fiable: false, reserves: ['etat-non-estimable'] }, true, []]);
        H.v('    la fourchette : basse = le « De » du guide réel (0,02), haute ABSENTE et dite absente, aucun verdict', [c.prixRepli.fourchette, 'verdict' in c.prixRepli], [{ basse: { prix: 0.02, source: 'guide-de' }, haute: null, absentes: ['haute'] }, false]);
        H.v('    REPLI-QUOTA : la carte à fourchette AFFICHE un prix (la même règle afficheUnPrix)', require('../identifier/prix-repli').afficheUnPrix({ repli: c.prixRepli }), true);
        // la même réponse rejouée : identique (la question est réglée, la carte se refabrique)
        const r2 = await repondre(s.jeton, s.scanId, 'a');
        H.v('A3. rejeu de la réponse : même carte, même repli', r2.json && JSON.stringify(r2.json.carte), JSON.stringify(c));
    }
    {
        const s = await repondu('a', 'EX');
        const c = s.rep.carte;
        H.v('A4. état retenu EX : un prix à lire dans l\'état — AUCUN repli, aucune clé de plus', [c.prixLive && c.prixLive.etatVise, 'prixRepli' in c], ['EX', false]);
    }
    {
        // la carte dont l'état n'est pas retenu mais dont la fiche n'a AUCUNE donnée de prix : aucun repli
        const x = await scanQuestion(null);
        await raw('analyses').updateOne({ _id: oid(x.scanId) }, { $set: { 'produits.$[].prixGuide': null } });
        const r = await repondre(x.jeton, x.scanId, 'a');
        H.v('A5. état non retenu ET fiche sans aucune donnée de prix : AUCUN repli (alors seulement « illisible » est vrai)', [r.statut, r.json.carte.prixLive.etatVise, 'prixRepli' in r.json.carte, r.json.carte.carte.prixGuide], [200, null, false, null]);
    }
    {
        // l'analyse d'une carte AFFIRMÉE (pas de question) : la même règle. Ici l'analyse du faux modèle : repli SSI prixLive absent ou etatVise null.
        // chaque image du verrou (une par cellule) : sur toute carte IDENTIFIÉE, le repli est servi exactement quand l'analyse n'a rien dicté à lire ; ailleurs, jamais
        let identifiees = 0, nSansDictee = 0, ko = [];
        for (const ch of require(CHARGES).charges) {
            const x = await inst(3);
            const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [ch.imageUrl], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { ...entetes(x.jeton), 'idempotency-key': cle() } });
            if (!r.json || r.json.success !== true) continue;
            const v = valider(r.json, ref('ReponseAnalyse'), SCHEMA); validees++; if (!v.ok) { ecarts++; ko.push(ch.cellule); }
            for (const c0 of r.json.analyse.cartes) {
                const sansDictee = c0.statut === 'identifiee' && (c0.prixLive === null || (c0.prixLive && c0.prixLive.etatVise === null));
                if (c0.statut === 'identifiee') identifiees++;
                if (sansDictee) nSansDictee++;
                const guideOk = c0.carte && c0.carte.prixGuide;
                if (Boolean(c0.prixRepli) !== Boolean(sansDictee && guideOk)) ko.push(`${ch.cellule} : repli ${Boolean(c0.prixRepli)} pour sansDictee ${sansDictee}`);
            }
        }
        // ⚠️ avec le catalogue semé (des « Tropius ») le faux modèle n'AFFIRME rien : ce contrôle prouve qu'aucune carte à trancher ou introuvable ne reçoit de repli ; le côté « posé » de l'analyse affirmée est prouvé purement (test-prix-repli.js)
        H.v(`A6. /api/identifier sur chaque image du verrou (${identifiees} cartes identifiées, dont ${nSansDictee} sans lecture dictée) : le repli n'est servi que sur une carte identifiée sans lecture dictée`, ko, []);
    }

    // ── B. le RETOUR-LIVE
    {
        // B1. lecture ratée (Tauros : la page n'a jamais été ouverte, ou ratée) : le repli « tendance », cause lecture-ratee ; le remboursement ne change pas
        const s = await repondu('a', null);
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('B1. lecture ratée définitive : 200, repli tendance / lecture-ratee / fiable false, guide réel de Tauros', [r.statut, r.json.prixRepli && r.json.prixRepli.repli, r.json.prixRepli && r.json.prixRepli.cause, r.json.prixRepli && r.json.prixRepli.fiable, r.json.prixRepli && r.json.prixRepli.guide.tendance, r.json.prixRepli && r.json.prixRepli.guide.moyenne30], [200, 'tendance', 'lecture-ratee', false, 1.49, 1.26]);
        H.v('    REPLI-QUOTA : le repli est un prix affiché, le scan n\'est PAS remboursé (debite 1, rembourse false, raisonNonRembourse prix-repli) — le détail est dans test-repli-quota.js', [r.json.facturation && r.json.facturation.debite, r.json.facturation && r.json.facturation.rembourse, r.json.facturation && r.json.facturation.raisonNonRembourse], [1, false, 'prix-repli']);
        const t = await repondu('a', 'EX');
        const rn = await rl(t.jeton, { scanId: t.scanId, carte: 0, lectureRatee: { cause: 'defi', definitive: false } });
        H.v('B2. lecture ratée non définitive (défi) : le repli est servi aussi (le client ne dit pas « illisible »), rien n\'est remboursé', [rn.statut, rn.json.prixRepli && rn.json.prixRepli.cause, rn.json.facturation], [200, 'lecture-ratee', null]);
    }
    {
        // B3. Arcanin : prixLive 7,67 d'origine « tendance », ni état ni offre => le repli tendance-seule
        const s = await repondu('b', 'NM');
        H.v('B3a. le produit répondu est celui du guide réel d\'Arcanin (ID_B)', s.idRepondu, ID_B);
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, prixLive: 7.67, originePrix: 'tendance', prixLiveCodeLangue: 1, verdictAffiche: 'aucun' });
        H.v('B3. tendance seule : repli tendance / tendance-seule, guide réel d\'Arcanin (10,18 / 1 / 14,59 / 13,15), fiable false (écart > 30 %)', [r.statut, r.json.prixRepli.repli, r.json.prixRepli.cause, r.json.prixRepli.fiable, r.json.prixRepli.guide.tendance, r.json.prixRepli.guide.de, r.json.prixRepli.guide.moyenne7, r.json.prixRepli.guide.moyenne30, r.json.prixRepli.guide.reserves], [200, 'tendance', 'tendance-seule', false, 10.18, 1, 14.59, 13.15, ['ecart-tendance']]);
        const l = await raw('journal_scans').findOne({ _id: oid(s.scanId) });
        H.v('    le prix lu est écrit comme avant (prixLive 7,67, origine tendance)', [l.prixLive, l.originePrix], [7.67, 'tendance']);
    }
    {
        // B4. l'offre dans l'état le plus proche
        const s = await repondu('a', 'EX');
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'gd', originePrix: 'grille', prixLiveCodeLangue: 1 });
        H.v('B4. retenu EX, offre lue en GD (pire) : repli etat-proche / offre-autre-etat, offre { GD, 0,9 }, le guide avec', [r.statut, r.json.prixRepli && r.json.prixRepli.repli, r.json.prixRepli && r.json.prixRepli.cause, r.json.prixRepli && r.json.prixRepli.offre, r.json.prixRepli && r.json.prixRepli.guide.tendance], [200, 'etat-proche', 'offre-autre-etat', { etat: 'GD', prix: 0.9 }, 1.49]);
        const t = await repondu('a', 'EX');
        const rd = await rl(t.jeton, { scanId: t.scanId, carte: 0, prixLive: 1.2, prixLiveEtat: 'NM', originePrix: 'grille', prixLiveCodeLangue: 1 });
        H.v('B5. retenu EX, offre lue en NM (mieux) : un prix dans l\'état — la réponse est celle d\'avant (aucune clé prixRepli)', [rd.statut, 'prixRepli' in rd.json], [200, false]);
        const u = await repondu('a', 'EX');
        const re = await rl(u.jeton, { scanId: u.scanId, carte: 0, prixLive: 1.2, prixLiveEtat: 'EX', originePrix: 'grille' });
        H.v('B6. retenu EX, offre lue en EX : idem, aucune clé prixRepli', [re.statut, 'prixRepli' in re.json], [200, false]);
        const w = await repondu('a', 'EX');
        const rp = await rl(w.jeton, { scanId: w.scanId, carte: 0, prixLive: 1.0, originePrix: 'plancher-toutes-langues' });
        H.v('B7. plancher toutes langues (De) : un prix, pas un repli — aucune clé prixRepli', [rp.statut, 'prixRepli' in rp.json], [200, false]);
        const x = await repondu('a', 'EX');
        const rg = await rl(x.jeton, { scanId: x.scanId, carte: 0, prixLive: 0.9, originePrix: 'grille', prixLiveEtat: 'EX' });
        H.v('    la clé n\'est JAMAIS nulle : aucune réponse sans repli ne porte prixRepli: null', [rg.texte.includes('prixRepli')], [false]);
    }
    {
        // B8. fiche sans AUCUNE donnée de prix : lecture ratée / tendance seule => aucun repli
        const s = await repondu('a', null);
        await raw('analyses').updateOne({ _id: oid(s.scanId) }, { $set: { 'produits.$[].prixGuide': null } });
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('B8. lecture ratée, fiche sans aucune donnée de prix : AUCUN repli (« illisible » est vrai)', [r.statut, 'prixRepli' in r.json], [200, false]);
        const t = await repondu('a', 'NM');
        await raw('analyses').updateOne({ _id: oid(t.scanId) }, { $set: { 'produits.$[].prixGuide': null } });
        const rt = await rl(t.jeton, { scanId: t.scanId, carte: 0, prixLive: 7.67, originePrix: 'tendance' });
        H.v('B9. tendance seule, fiche sans guide : AUCUN repli (le client a déjà lu la tendance)', [rt.statut, 'prixRepli' in rt.json], [200, false]);
        const u = await repondu('a', 'EX');
        await raw('analyses').updateOne({ _id: oid(u.scanId) }, { $set: { 'produits.$[].prixGuide': null } });
        const ru = await rl(u.jeton, { scanId: u.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille' });
        H.v('B10. offre en GD pour EX, fiche sans guide : le repli etat-proche est servi (l\'offre est la donnée de prix), guide null', [ru.statut, ru.json.prixRepli && ru.json.prixRepli.repli, ru.json.prixRepli && ru.json.prixRepli.guide], [200, 'etat-proche', null]);
    }
    {
        // B11. la ligne analyses absente : le repli ne se fabrique pas, la réponse reste celle d'avant (jamais une panne)
        const s = await repondu('a', 'EX');
        await raw('analyses').deleteOne({ _id: oid(s.scanId) });
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille' });
        H.v('B11. analyses absente : 200 sans repli (le prix est écrit, la route ne casse pas)', [r.statut, r.json.success, 'prixRepli' in r.json], [200, true, false]);
    }
    {
        // B12. TOUR 1, M-1 — un repli n'est servi QUE pour une carte IDENTIFIÉE (l'idProduct confirmé de l'analyse) : jamais pour une question en attente, abandonnée ou un candidat.
        // La ligne du journal porte pourtant l'idProduct du gagnant de la chaîne (38 cartes à question de rm_essai) : sans la garde, le repli retombait sur le guide d'un candidat NON confirmé.
        const sansConfirmation = async (nom, preparer, corps) => {
            const s = await scanQuestion(null);
            await preparer(s);
            await raw('journal_scans').updateOne({ _id: oid(s.scanId) }, { $set: { idProduct: ID_A } });
            const l = await raw('journal_scans').findOne({ _id: oid(s.scanId) }), an = await raw('analyses').findOne({ _id: oid(s.scanId) });
            H.v(`B12 (${nom}) : l'état fabriqué est bien celui du risque — journal.idProduct entier, analyses.cartes[0].idProduct null, le candidat est dans analyses.produits avec un guide`, [Number.isInteger(l.idProduct), an.cartes[0].idProduct, an.cartes[0].statut, an.produits.some(p => p.idProduct === ID_A && p.prixGuide !== null)], [true, null, 'a-trancher', true]);
            const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, ...corps });
            H.v(`B12 (${nom}) : AUCUN repli (le guide d'un candidat non confirmé n'est pas celui de la carte)`, [r.statut, 'prixRepli' in (r.json || {})], [200, false]);
        };
        await sansConfirmation('question en attente, lecture ratée non définitive', async () => { }, { lectureRatee: { cause: 'defi', definitive: false } });
        await sansConfirmation('question en attente, tendance seule', async () => { }, { prixLive: 7.67, originePrix: 'tendance' });
        await sansConfirmation('question en attente, offre en GD', async s => { await poserEtat(s.scanId, 'EX'); }, { prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille' });
        await sansConfirmation('question abandonnée (ne-sait-pas)', async s => { await repondre(s.jeton, s.scanId, 'ne-sait-pas'); }, { lectureRatee: { cause: 'defi', definitive: false } });
        await sansConfirmation('question répondue « aucune »', async s => { await repondre(s.jeton, s.scanId, 'aucune'); }, { lectureRatee: { cause: 'defi', definitive: false } });
        // témoin positif : une carte AFFIRMÉE à l'analyse (statut identifiee, idProduct confirmé) reçoit son repli — la garde n'a pas tout fermé
        const s = await scanQuestion('EX'); const src = await raw('analyses').findOne({ _id: oid(s.scanId) }); const sid = new mongoose.Types.ObjectId();
        await raw('analyses').insertOne({ ...src, _id: sid, cartes: [{ ...src.cartes[0], statut: 'identifiee', idProduct: ID_A, question: null }] });
        await raw('journal_scans').insertOne({ _id: sid, userId: `v2:installation:${s.i._id}`, route: 'identifier' });
        const ra = await rl(s.jeton, { scanId: String(sid), carte: 0, lectureRatee: { cause: 'defi', definitive: false } });
        H.v('B12 (témoin) : carte affirmée à l\'analyse (idProduct confirmé, journal sans idProduct) : le repli est servi', [ra.statut, ra.json.prixRepli && ra.json.prixRepli.cause, ra.json.prixRepli && ra.json.prixRepli.guide.tendance], [200, 'lecture-ratee', 1.49]);
    }
    {
        // B13. ETAT-FOURCHETTE — l'état retenu de l'analyse est null : quoi que l'extension envoie, JAMAIS le prix d'un seul état présenté comme sûr ; la fourchette (la MÊME règle que l'analyse) est servie
        const g = REEL.tauros.guide;
        const s = await repondu('a', null);
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'gd', originePrix: 'grille', prixLiveCodeLangue: 1, grilleLive: { NM: 1.4, GD: 0.9 } });
        const p = r.json.prixRepli;
        H.v('B13a. retenu null, prix de la grille lu en GD avec sa grille { NM 1,4 ; GD 0,9 } : repli tendance / etat-non-retenu, sans offre, fiable false', [r.statut, p && p.repli, p && p.cause, p && p.offre, p && p.fiable], [200, 'tendance', 'etat-non-retenu', null, false]);
        H.v('    les bornes viennent de la grille lue en direct (0,9 .. 1,4), source grille-directe', p.fourchette, { basse: { prix: 0.9, source: 'grille-directe' }, haute: { prix: 1.4, source: 'grille-directe' }, absentes: [] });
        H.v('    le guide du repli porte la mention et n\'est pas fiable ; les chiffres sont ceux du guide réel de Tauros', [p.guide.fiable, p.guide.reserves, p.guide.tendance, p.guide.de], [false, ['etat-non-estimable'], g.trend, g.low]);
        const l = await raw('journal_scans').findOne({ _id: oid(s.scanId) });
        H.v('    le prix lu est écrit comme avant (0,9 en GD, origine grille) : la fourchette ne touche pas au journal du prix', [l.prixLive, l.prixLiveEtat, l.originePrix], [0.9, 'GD', 'grille']);
        const t = await repondu('a', null);
        const rs = await rl(t.jeton, { scanId: t.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille', prixLiveCodeLangue: 1 });
        H.v('B13b. retenu null, prix lu SANS grille : la fourchette retombe sur le guide (basse = « De », haute absente)', [rs.statut, rs.json.prixRepli.fourchette], [200, { basse: { prix: 0.02, source: 'guide-de' }, haute: null, absentes: ['haute'] }]);
        const u = await repondu('a', null);
        const ru = await rl(u.jeton, { scanId: u.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille', grilleLive: { GD: 0.9 } });
        H.v('B13c. grille à un seul état : elle ne borne rien (le guide parle)', [ru.statut, ru.json.prixRepli.fourchette.basse], [200, { prix: 0.02, source: 'guide-de' }]);
        const w = await repondu('a', null);
        const rt = await rl(w.jeton, { scanId: w.scanId, carte: 0, prixLive: 7.67, originePrix: 'tendance' });
        H.v('B13d. retenu null, tendance seule : tendance-seule AVEC la fourchette et la mention', [rt.statut, rt.json.prixRepli.cause, rt.json.prixRepli.fourchette.absentes, rt.json.prixRepli.guide.reserves], [200, 'tendance-seule', ['haute'], ['etat-non-estimable']]);
        const x = await repondu('a', null);
        await raw('analyses').updateOne({ _id: oid(x.scanId) }, { $set: { 'produits.$[].prixGuide': null } });
        const rx = await rl(x.jeton, { scanId: x.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille', grilleLive: { NM: 1.4, GD: 0.9 } });
        H.v('B13e. retenu null, fiche SANS guide : rien à servir (le prix lu reste celui du client), aucun repli, jamais une panne', [rx.statut, rx.json.success, 'prixRepli' in rx.json], [200, true, false]);
        const y = await repondu('a', 'EX');
        const ry = await rl(y.jeton, { scanId: y.scanId, carte: 0, prixLive: 0.9, prixLiveEtat: 'GD', originePrix: 'grille', grilleLive: { NM: 1.4, GD: 0.9 } });
        H.v('B13f. témoin : retenu EX, la même offre en GD => etat-proche comme avant, SANS fourchette ni mention', [ry.statut, ry.json.prixRepli.repli, 'fourchette' in ry.json.prixRepli, ry.json.prixRepli.guide.reserves], [200, 'etat-proche', false, []]);
        const z = await repondu('a', null);
        const rz = await rl(z.jeton, { scanId: z.scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('B13g. retenu null, lecture ratée définitive : la fourchette est servie ET le scan compte (REPLI-QUOTA : prix-repli, pas remboursé)', [rz.json.prixRepli.fourchette !== undefined, rz.json.facturation && rz.json.facturation.raisonNonRembourse, rz.json.facturation && rz.json.facturation.rembourse], [true, 'prix-repli', false]);
    }
    H.v(`contrat : ${validees} réponses validées contre leur schéma (ReponseQuestion, ReponseRetourLive, ReponseAnalyse), écarts`, [ecarts, validees > 0], [0, true]);

    srv.enfant.kill();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
