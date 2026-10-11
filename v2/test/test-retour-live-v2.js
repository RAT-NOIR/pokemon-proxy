'use strict';
// Banc B1b.5 (2/2) — POST /api/retour-live (Bearer) et POST /api/solde (Bearer) : le prix lu en direct, la lecture ratée remboursée une fois, le solde.
// Base : la base EN MÉMOIRE du banc (INT2) — jamais la production, ni la grappe, ni R2. Aucune requête réseau réelle (faux réseau du verrou dans l'enfant).
// Deux serveurs ENFANTS sur la même base : v2 éteinte / v2 allumée. Le chemin hérité (gererRetourLive) est celui d'index.js, inchangé.
// Ordre voulu : d'abord « sans Bearer = forme héritée, octet pour octet », ensuite le contrat 2.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const VB = require('./_visuels-banc'); const VIS = new Map();
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const IMAGE = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const ORIGINE = cfg.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.6.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-b1b5l-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const attendre = ms => new Promise(r => setTimeout(r, ms));
let validees = 0, ecarts = 0;

async function inst(essais = 3, o = {}) {
    const jeton = J.genererJeton(); const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' }), o);
    await db.col('installations').insertOne(i); return { i, jeton };
}
const entetes = (jeton, plus = {}) => ({ origin: ORIGINE, ...ip(), ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...plus });
const ID_A = 895789, ID_B = 895790, EXP = 990001;
async function semer() {
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
    for (const [id, variante] of [[ID_A, 'normale'], [ID_B, 'reverse']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990101 });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: id === ID_A ? 1180 : 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
        VIS.set(id, VB.doc(id, { variante }));
    }
}

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-retour-live-v2.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const { JournalScan } = require('../../journal-scans');
    const { demarrer, appeler } = require('../../verrou/serveur');
    await semer();
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', V2_VISUELS_BANC_FICHIER: VB.fichier([...VIS.values()]) };
    const srvOff = await demarrer(FAUX, { ...base, RM_API_V2: '' });
    const srvOn = await demarrer(FAUX, { ...base, RM_API_V2: '1' });
    if (!await srvOff.attendreMongo() || !await srvOn.attendreMongo()) throw new Error('Mongo non connecté');
    const url = `http://127.0.0.1:${srvOn.port}`;

    // ── A. SANS Bearer : la route héritée répond comme aujourd'hui, octet pour octet (v2 éteinte contre v2 allumée, mêmes requêtes)
    {
        const MOI = `__rl-${Date.now()}`, AUTRE = `${MOI}-autre`;
        const forme = async (srv, quoi) => {
            const mk = async () => String((await JournalScan.create({ route: 'identifier', userId: MOI, idProduct: 606889, nom: 'Dark Porygon2' }))._id);
            const id = await mk(), inconnu = String(new mongoose.Types.ObjectId());
            const poster = async c => { const r = await appeler(srv.port, 'POST', '/api/retour-live', c, 'jeton-verrou'); return `${r.status} ${r.brut}`; };
            const sorties = [];
            sorties.push(await poster({ userId: MOI, scanId: id, prixLive: 0 }));                       // 400
            sorties.push(await poster({ userId: MOI, scanId: inconnu, prixLive: 12 }));                  // 404
            sorties.push(await poster({ userId: AUTRE, scanId: id, prixLive: 12 }));                     // 403
            sorties.push(await poster({ userId: MOI, scanId: id, prixLive: 24.13, prixLiveEtat: 'ex' })); // 200
            sorties.push(await poster({ userId: MOI, scanId: id, prixLive: 99 }));                       // 409
            const sans = await appeler(srv.port, 'POST', '/api/retour-live', { userId: MOI, scanId: id, prixLive: 12 }, 'mauvais'); sorties.push(`${sans.status} ${sans.brut}`);   // 401
            sorties.push(quoi);
            return sorties;
        };
        const a = await forme(srvOff, 'x'), b = await forme(srvOn, 'x');
        H.v(`A1. /api/retour-live SANS Bearer : ${a.length - 1} réponses héritées identiques octet pour octet, v2 éteinte / allumée`, a.filter((s, i) => s === b[i]).length, a.length);
        H.v('    les statuts rendus couvrent 400, 404, 403, 200, 409, 401 (la comparaison n\'est pas vide)', b.slice(0, 6).map(s => Number(s.split(' ')[0])), [400, 404, 403, 200, 409, 401]);
        const s1 = await appeler(srvOff.port, 'POST', '/api/solde', { userId: `${MOI}-solde` }, 'jeton-verrou'), s2 = await appeler(srvOn.port, 'POST', '/api/solde', { userId: `${MOI}-solde` }, 'jeton-verrou');
        H.v('A2. /api/solde SANS Bearer : forme héritée identique octet pour octet (soldeGratuit, soldeScans, restantSemaine)', [s1.brut === s2.brut, ['soldeGratuit', 'soldeScans', 'restantSemaine'].every(k => k in s2.json)], [true, true]);
        await JournalScan.deleteMany({ userId: { $in: [MOI, AUTRE] } });
    }

    // ── helpers du contrat 2
    const identifier = async (jeton) => H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: entetes(jeton, { 'idempotency-key': cle() }) });
    const repondre = (jeton, scanId, choix) => H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: { scanId, choix }, entetes: entetes(jeton) });
    const rl = async (jeton, corps, { cleIdem } = {}) => {
        const r = await H.appel(url, '/api/retour-live', { methode: 'POST', corps, entetes: entetes(jeton, cleIdem ? { 'idempotency-key': cleIdem } : {}) });
        if (r.json && r.json.success === true) { const v = valider(r.json, ref('ReponseRetourLive'), SCHEMA); validees++; if (!v.ok) { ecarts++; console.log(`   écart : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
        return r;
    };
    const journal = async scanId => { for (let k = 0; k < 40; k++) { const l = await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(scanId) }); if (l) return l; await attendre(150); } return null; };
    // un scan « identifié » : ambigu, puis répondu « a » (débité UNE fois) ; la ligne du journal hérité est attendue
    const scanRepondu = async (essais = 3, choix = 'a') => {
        const x = await inst(essais); const r = await identifier(x.jeton); const scanId = r.json.scanId;
        const q = await raw('questions').findOne({ _id: `${scanId}:0` }); const rep = await repondre(x.jeton, scanId, choix);
        if (rep.statut !== 200) throw new Error(`réponse refusée ${rep.statut}`);
        await journal(scanId);
        return { ...x, scanId, q, idRepondu: (q.choix.find(c => c.id === choix) || {}).idProduct };
    };
    const essais = async id => (await raw('installations').findOne({ _id: id })).essais;
    const mouv = id => raw('mouvements').find({ installationId: id }).toArray();
    const rembNet = async id => (await mouv(id)).filter(m => m.type === 'remboursement' && m.delta === 1).length;

    // ── B. un prix lu valide est écrit par gererRetourLive (le chemin hérité), sous l'identité v2
    {
        const s = await scanRepondu();
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, prixLive: 24.13, prixLiveEtat: 'ex', prixLiveCodeLangue: 2, originePrix: 'grille', verdictAffiche: 'correct' });
        H.v('B1. prix lu valide : 200 success:true, facturation null, solde présent', [r.statut, r.json.success, r.json.facturation, typeof (r.json.solde && r.json.solde.total)], [200, true, null, 'number']);
        const l = await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(s.scanId) });
        H.v('    écrit dans la ligne du journal hérité (prix, état normalisé, origine, retourLe), userId inchangé', [l.prixLive, l.prixLiveEtat, l.originePrix, l.retourLe instanceof Date, l.userId], [24.13, 'EX', 'grille', true, `v2:installation:${s.i._id}`]);
        H.v('    aucun débit, aucun remboursement : essais inchangés (2), un seul mouvement', [await essais(s.i._id), (await mouv(s.i._id)).length], [2, 1]);
        // 6. garde : déjà complété => 409
        const r2 = await rl(s.jeton, { scanId: s.scanId, prixLive: 999 });
        H.v('B6a. scan déjà complété : 409 CONFLIT, le premier prix est intact', [r2.statut, r2.json.erreur.code, (await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(s.scanId) })).prixLive], [409, 'CONFLIT', 24.13]);
        // scan d'un autre porteur : 404 (pas 403)
        const autre = await inst(3); const s2 = await scanRepondu();
        const r3 = await rl(autre.jeton, { scanId: s2.scanId, prixLive: 5 });
        H.v('B6b. scan d\'un AUTRE porteur : 404 (pas 403), rien écrit', [r3.statut, r3.json.erreur.code, (await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(s2.scanId) })).prixLive ?? null], [404, 'CODE_INVALIDE', null]);
        const r4 = await rl(s2.jeton, { scanId: String(new mongoose.Types.ObjectId()), prixLive: 5 });
        H.v('B6c. scanId inconnu : 404 ; mal formé : 400', [r4.statut, (await rl(s2.jeton, { scanId: 'pas-un-objectid', prixLive: 5 })).statut], [404, 400]);
        // 7. Idempotency-Key honorée
        const k = cle(); const a = await rl(s2.jeton, { scanId: s2.scanId, prixLive: 7.5, originePrix: 'grille' }, { cleIdem: k });
        const b = await rl(s2.jeton, { scanId: s2.scanId, prixLive: 7.5, originePrix: 'grille' }, { cleIdem: k });
        H.v('B7. Idempotency-Key : le rejeu rend le même corps, Idempotency-Replayed, sans 409', [a.statut, b.statut, b.texte === a.texte, b.entetes['idempotency-replayed']], [200, 200, true, 'true']);
    }

    // ── C. entrées : liste fermée, aucun effet
    {
        const s = await scanRepondu(); const m0 = (await mouv(s.i._id)).length;
        const verdict = await rl(s.jeton, { scanId: s.scanId, prixLive: 5, verdictAffiche: 'moyen' });
        const cause = await rl(s.jeton, { scanId: s.scanId, lectureRatee: { cause: 'au-pif', definitive: true } });
        const definitive = await rl(s.jeton, { scanId: s.scanId, lectureRatee: { cause: 'defi', definitive: 'oui' } });
        const rien = await rl(s.jeton, { scanId: s.scanId });
        const deux = await rl(s.jeton, { scanId: s.scanId, prixLive: 5, lectureRatee: { cause: 'sans-prix', definitive: true } });
        const prixNul = await rl(s.jeton, { scanId: s.scanId, prixLive: 0 });
        const etat = await rl(s.jeton, { scanId: s.scanId, prixLive: 5, prixLiveEtat: 'PARFAIT' });
        H.v('C2. verdictAffiche, cause, definitive hors liste ; ni prix ni lecture ratée ; les deux ; prix 0 ; état hors liste : sept 400 ENTREE',
            [verdict, cause, definitive, rien, deux, prixNul, etat].map(r => [r.statut, r.json.erreur.code]), Array(7).fill([400, 'ENTREE']));
        const l = await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(s.scanId) });
        H.v('    aucun effet : ligne du journal non complétée, aucun mouvement de plus, essais 2', [l.prixLive ?? null, (await mouv(s.i._id)).length - m0, await essais(s.i._id)], [null, 0, 2]);
    }

    // ── D. la lecture ratée définitive rembourse (sans-prix) UNE fois par scan, sous le compteur des questions
    {
        const s = await scanRepondu();
        H.v('D0. avant : scan répondu « a » = débité (essais 2)', await essais(s.i._id), 2);
        const r = await rl(s.jeton, { scanId: s.scanId, carte: 0, lectureRatee: { cause: 'sans-prix', definitive: true } }), j = r.json || {};
        H.v('D3. definitive:true : 200, facturation { debite:0, rembourse:true, motif:sans-prix }, solde.essai 3', [r.statut, j.facturation && j.facturation.debite, j.facturation && j.facturation.rembourse, j.facturation && j.facturation.motif, j.solde && j.solde.essai, await essais(s.i._id)], [200, 0, true, 'sans-prix', 3, 3]);
        const pl = await raw('plafonds').findOne({ porteur: `installation:${s.i._id}`, type: 'sans-prix' });
        H.v('    compté sous le compteur PROPRE sans-prix (5/jour), ni celui des QUESTIONS (30/jour) ni celui des pannes', [pl && pl.count, await raw('plafonds').countDocuments({ porteur: `installation:${s.i._id}`, type: { $in: ['panne', 'question'] } })], [1, 0]);
        const r2 = await rl(s.jeton, { scanId: s.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } }), j2 = r2.json || {};
        H.v('    rejeu : AUCUN second crédit — deja-rembourse', [r2.statut, j2.facturation && j2.facturation.rembourse, j2.facturation && j2.facturation.raisonNonRembourse, await essais(s.i._id), await rembNet(s.i._id)], [200, false, 'deja-rembourse', 3, 1]);
        // definitive:false (un défi Cloudflare) : rien rendu
        const t = await scanRepondu();
        const rf = await rl(t.jeton, { scanId: t.scanId, lectureRatee: { cause: 'defi', definitive: false } }), jf = rf.json || {};
        H.v('D3b. definitive:false (défi) : 200 success, aucun remboursement, essais 2', [rf.statut, jf.success, jf.facturation, await rembNet(t.i._id), await essais(t.i._id)], [200, true, null, 0, 2]);
        // ... et la même lecture, plus tard, définitive : rembourse bien
        const rd = await rl(t.jeton, { scanId: t.scanId, lectureRatee: { cause: 'blocage', definitive: true } });
        H.v('    puis définitive sur le même scan : remboursée (la non-définitive n\'a rien consommé)', [rd.json.facturation && rd.json.facturation.rembourse, await essais(t.i._id)], [true, 3]);
        // 4. plafond atteint
        const u = await scanRepondu();
        await raw('plafonds').insertOne({ porteur: `installation:${u.i._id}`, jour: new Date().toISOString().slice(0, 10), type: 'sans-prix', count: cfg.plafonds.sansPrix, expireLe: new Date(Date.now() + 3 * 86400e3) });
        const rp = await rl(u.jeton, { scanId: u.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } }), jp = rp.json || {};
        H.v('D4. plafond sans-prix atteint : motif plafond-jour, rembourse:false, debite 1, essais 2', [rp.statut, jp.facturation && jp.facturation.motif, jp.facturation && jp.facturation.rembourse, jp.facturation && jp.facturation.debite, jp.facturation && jp.facturation.raisonNonRembourse, await essais(u.i._id)], [200, 'plafond-jour', false, 1, 'plafond-jour', 2]);
        // lecture ratée sur un scan d'un autre porteur : 404, rien rendu
        const v = await scanRepondu(), autre = await inst(3);
        const ra = await rl(autre.jeton, { scanId: v.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('    lecture ratée sur le scan d\'un autre : 404, rien rendu à personne', [ra.statut, await essais(v.i._id), await essais(autre.i._id)], [404, 2, 3]);
        // lecture ratée sur un scan déjà complété (prix lu) : 409, pas de remboursement
        const w = await scanRepondu(); await rl(w.jeton, { scanId: w.scanId, prixLive: 3.2, originePrix: 'grille' });
        const rw = await rl(w.jeton, { scanId: w.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        H.v('    lecture ratée sur un scan dont le prix a été lu : 409, aucun remboursement', [rw.statut, await essais(w.i._id)], [409, 2]);
        // administrateur : rien à rendre
        const c = Object.assign(M.nouveauCompte({ email: `adm${++nCle}@x.fr`, emailCle: `adm${nCle}@x.fr`, motDePasse: {} }), { verifie: true, role: 'administrateur', solde: { accueil: 25, achete: 0 } });
        await db.col('comptes').insertOne(c);
        const adm = await inst(0, { compteId: c._id }); const ia = await identifier(adm.jeton); await journal(ia.json.scanId);
        await repondre(adm.jeton, ia.json.scanId, 'a');
        const rr = await rl(adm.jeton, { scanId: ia.json.scanId, lectureRatee: { cause: 'sans-prix', definitive: true } }), jr = rr.json || {};
        H.v('    administrateur : motif administrateur, rien rendu, compte intact (accueil 25)', [rr.statut, jr.facturation && jr.facturation.motif, jr.facturation && jr.facturation.rembourse, (await raw('comptes').findOne({ _id: c._id })).solde.accueil], [200, 'administrateur', false, 25]);
    }

    // ── G. la garde du remboursement sans-prix, écrite par ce qu'elle AUTORISE : une carte IDENTIFIÉE (affirmée à l'analyse, ou tranchée par une réponse « repondue »)
    {
        const refus = (r) => [r.statut, r.json && r.json.erreur && r.json.erreur.code, r.json && r.json.erreur && r.json.erreur.detail];
        const LR = scanId => ({ scanId, lectureRatee: { cause: 'sans-prix', definitive: true } });
        // G1. question encore EN ATTENTE : refus explicite, crédit et question inchangés
        {
            const x = await inst(3); const r0 = await identifier(x.jeton); const scanId = r0.json.scanId; await journal(scanId);
            const m0 = (await mouv(x.i._id)).length;
            const r = await rl(x.jeton, LR(scanId));
            H.v('G1. question EN ATTENTE + sans-prix : 409 CONFLIT (carte-non-identifiee), jamais un remboursement', refus(r), [409, 'CONFLIT', 'carte-non-identifiee']);
            const q = await raw('questions').findOne({ _id: `${scanId}:0` });
            H.v('    crédit et question inchangés : essais 2, question en-attente, aucun mouvement de plus, aucun plafond consommé', [await essais(x.i._id), q.etat, (await mouv(x.i._id)).length - m0, await raw('plafonds').countDocuments({ porteur: `installation:${x.i._id}` })], [2, 'en-attente', 0, 0]);
            // la question répondue ensuite redevient remboursable : la garde suit l'état, pas une marque posée une fois
            await repondre(x.jeton, scanId, 'a');
            const r2 = await rl(x.jeton, LR(scanId));
            H.v('    la même carte, une fois la question RÉPONDUE : le remboursement est permis', [r2.statut, r2.json.facturation && r2.json.facturation.rembourse, await essais(x.i._id)], [200, true, 3]);
        }
        // G2. question abandonnée (ne-sait-pas) : la carte n'est pas identifiée, le crédit est déjà rendu => refus
        {
            const x = await inst(3); const r0 = await identifier(x.jeton); const scanId = r0.json.scanId; await journal(scanId);
            await repondre(x.jeton, scanId, 'ne-sait-pas');
            const r = await rl(x.jeton, LR(scanId));
            H.v('G2. question abandonnée (ne-sait-pas) : refus, pas de second crédit (essais 3)', [...refus(r), await essais(x.i._id), await rembNet(x.i._id)], [409, 'CONFLIT', 'carte-non-identifiee', 3, 1]);
        }
        // G3. carte AFFIRMÉE à l'analyse (ligne fabriquée d'après un vrai scan) : la garde l'autorise, la requête atteint le ledger (aucun débit => aucun-debit)
        {
            const s = await scanRepondu(); const src = await raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(s.scanId) });
            const sid = new mongoose.Types.ObjectId();
            await raw('analyses').insertOne({ ...src, _id: sid, cartes: [{ ...src.cartes[0], statut: 'identifiee', reponse: undefined }] });
            await raw('journal_scans').insertOne({ _id: sid, userId: `v2:installation:${s.i._id}`, idProduct: ID_A, route: 'identifier' });
            const r = await rl(s.jeton, LR(String(sid))), j = r.json || {};
            H.v('G3. carte AFFIRMÉE à l\'analyse : la garde l\'autorise (200, atteint le ledger : aucun-debit, rien rendu)', [r.statut, j.facturation && j.facturation.raisonNonRembourse, j.facturation && j.facturation.rembourse], [200, 'aucun-debit', false]);
        }
        // G4. ligne analyses absente : la garde ne peut pas conclure => elle BLOQUE
        {
            const s = await scanRepondu();
            await raw('analyses').deleteOne({ _id: new mongoose.Types.ObjectId(s.scanId) });
            const r = await rl(s.jeton, LR(s.scanId));
            H.v('G4. analyses absente (la garde ne peut pas conclure) : refus, rien rendu (essais 2)', [...refus(r), await essais(s.i._id)], [409, 'CONFLIT', 'carte-non-identifiee', 2]);
        }
    }

    // ── E. un prix lu 100 fois sous le guide est écrit « douteux » (le 1,18 € de la 1.0.5 contre un guide à 1 180 €)
    {
        const s = await scanRepondu(3, 'a');                                   // 'a' = idProduct le plus bas = ID_A (guide 1 180)
        H.v('E0. le produit répondu est celui dont le guide vaut 1 180', s.idRepondu, ID_A);
        const r = await rl(s.jeton, { scanId: s.scanId, prixLive: 1.18, originePrix: 'grille' });
        const l = await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(s.scanId) });
        H.v('E5. 1,18 € pour un guide à 1 180 € : écrit (200) avec douteux:true', [r.statut, l.prixLive, l.douteux], [200, 1.18, true]);
        const t = await scanRepondu(3, 'a');
        await rl(t.jeton, { scanId: t.scanId, prixLive: 24.13, originePrix: 'grille' });
        const m = await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(t.scanId) });
        H.v('    24,13 € (même guide) : pas douteux', [m.prixLive, m.douteux === true], [24.13, false]);
        const u = await scanRepondu(3, 'a');
        await rl(u.jeton, { scanId: u.scanId, prixLive: 11.8, originePrix: 'grille' });
        H.v('    11,80 € = exactement 100 fois sous : pas « plus de 100 fois » -> pas douteux', (await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(u.scanId) })).douteux === true, false);
        const w = await scanRepondu(3, 'b');                                   // ID_B, guide à 1 €
        await rl(w.jeton, { scanId: w.scanId, prixLive: 0.5, originePrix: 'grille' });
        H.v('    0,50 € pour un guide à 1 € : pas douteux', (await raw('journal_scans').findOne({ _id: new mongoose.Types.ObjectId(w.scanId) })).douteux === true, false);
    }

    // ── F. /api/solde avec Bearer
    {
        const x = await inst(3);
        const r = await H.appel(url, '/api/solde', { methode: 'POST', corps: {}, entetes: entetes(x.jeton) });
        const v = valider(r.json, ref('ReponseSolde'), SCHEMA);
        H.v('F1. Bearer : { success:true, solde } valide contre ReponseSolde, essai 3', [r.statut, r.json.success, v.ok, r.json.solde && r.json.solde.essai, r.json.solde && r.json.solde.total], [200, true, true, 3, 3]);
        await identifier(x.jeton);
        const r2 = await H.appel(url, '/api/solde', { methode: 'POST', corps: {}, entetes: entetes(x.jeton) });
        H.v('    relu après un scan : essai 2 (lecture seule, aucun débit par la route)', [r2.json.solde.essai, (await mouv(x.i._id)).length], [2, 1]);
        const r3 = await H.appel(url, '/api/solde', { methode: 'POST', corps: {}, entetes: entetes('A'.repeat(30)) });
        H.v('F2. Bearer inconnu : 401 JETON (corps v2), jamais la forme héritée', [r3.statut, r3.json.erreur.code, 'soldeGratuit' in r3.json], [401, 'JETON', false]);
        const r4 = await H.appel(url, '/api/solde', { methode: 'POST', corps: {}, entetes: { origin: ORIGINE, ...ip(), 'x-jeton': 'jeton-verrou' } });
        H.v('F3. sans Bearer (x-jeton public) : forme héritée (400 « Identifiant utilisateur manquant »), pas une erreur v2', [r4.statut, r4.json.erreur === undefined], [400, true]);
        H.v('F4. CORS de l\'extension sur la réponse Bearer', r.entetes['access-control-allow-origin'], ORIGINE);
    }
    H.v(`contrat : ${validees} réponses retour-live validées contre ReponseRetourLive, écarts`, [ecarts, validees > 0], [0, true]);

    srvOff.enfant.kill(); srvOn.enfant.kill();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
