'use strict';
// PROBABLE (31/10) — la ROUTE et l'ARGENT, de bout en bout : un candidat qui se détache est servi `niveau: "probable"` (débité à l'affichage), seulement avec V2_PROBABLE=1 ET une extension >= 2.0.1 ;
// éteint, ou extension plus ancienne, la réponse est celle d'avant (crédit réservé). Base EN MÉMOIRE du banc, chaîne héritée FABRIQUÉE, aucun réseau, aucun appel payant.
const H = require('./_harnais');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const Q = require('./_aide-quota');
const { lireConfig } = require('../config'); const { valider } = require('../openapi/valider'); const SCHEMA = require('../openapi/openapi.v2.json');
const path = require('path');
const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
const ref = n => ({ $ref: `#/components/schemas/${n}` });
const base = { MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' };
const cfgOff = lireConfig(base), cfgOn = lireConfig({ ...base, V2_PROBABLE: '1' });
const ORIGINE = cfgOff.origines.extension;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.17.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-probable-${Date.now().toString(36)}-${++nCle}`;
const raw = n => mongoose.connection.db.collection(n);
const E = require('../chargeur/etat'); const { creerConstructeur } = require('../chargeur/version'); const VB = require('./_visuels-banc');
const P1 = 897001, P2 = 897002, P3 = 897003, EXP = 992001, META1 = 992101, META2 = 992102, META3 = 992103;
let ecartsContrat = 0;

async function inst(essais = 30) {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais, libelle: 'banc' });
    await db.col('installations').insertOne(i); return { i, jeton };
}
async function poster(url, jeton, version = '2.0.1') {
    const r = await H.appel(url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: 'Pikachu', description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: version, langueInterface: 'fr' },
        entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
    if (r.json && r.json.success === true && r.json.contrat === 2) { const v = valider(r.json, ref('ReponseAnalyse'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
async function repondre(url, jeton, scanId, choix) {
    const r = await H.appel(url, '/api/identifier/reponse', { methode: 'POST', corps: { scanId, carte: 0, choix }, entetes: { origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, 'idempotency-key': cle() } });
    if (r.json && r.json.success === true) { const v = valider(r.json, ref('ReponseQuestion'), SCHEMA); if (!v.ok) { ecartsContrat++; console.log(`   écart de contrat (reponse) : ${v.erreurs.slice(0, 3).map(e => `${e.chemin} ${e.message}`).join(' ; ')}`); } }
    return r;
}
async function livre(x) {
    const mv = await raw('mouvements').find({ installationId: x.i._id }).toArray();
    return { net: mv.reduce((s, m) => s + m.delta, 0), ouverts: mv.filter(m => m.type === 'debit' && m.etat !== 'rembourse').map(m => m.etat), remboursements: mv.filter(m => m.type === 'remboursement').length, debits: mv.filter(m => m.type === 'debit' && m.delta === -1).length };
}
const PAYE = { net: -1, ouverts: ['debite'], remboursements: 0, debits: 1 }, RESERVE = { net: -1, ouverts: ['reserve'], remboursements: 0, debits: 1 }, RENDU = { net: 0, ouverts: [], remboursements: 1, debits: 1 };
const analyseDe = scanId => raw('analyses').findOne({ _id: new mongoose.Types.ObjectId(scanId) });
const norm = s => String(s).replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
const ids = c0 => c0.candidats.map(c => c.idProduct).sort();

(async () => {
    await H.ouvrirBancV2();
    await Q.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-probable-route.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'depense_modele']) await raw(c).deleteMany({});
    await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PRB', apprisLe: new Date() });
    // trois produits d'un même set, TROIS numéros : la lecture « 12/131 » en désigne un seul
    for (const [id, meta, numero] of [[P1, META1, '12'], [P2, META2, '15'], [P3, META3, '12']]) {
        await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Pikachu', idExpansion: EXP, idMetacard: meta });
        await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero, numeroUrl: `PRB${numero}`, codeSet: 'PRB', nomFr: 'Pikachu', slug: `Pikachu-PRB${numero}-${id}`, slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte' });
        await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
    }
    const b = creerConstructeur({ marquages: true });
    for (const [id, meta, numero] of [[P1, META1, '12'], [P2, META2, '15'], [P3, META3, '12']]) b.entree(VB.doc(id, { idMetacard: meta, numero, variante: 'normale', total: '131', vignette: { cle: `banc/probable-${id}.webp`, w: 300, h: 420 } }));
    E.installer(b.finir());

    const express = require('express'); const pret = require('../pret');
    const { dansUnScan } = require('../../sources'); const { assembler } = require('../index');
    let mode = 'probable';
    const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
    const cand = (id, numero) => ({ idProduct: id, nom: 'Pikachu', numero, set: 'Banc Set', prix: 1, photoUrl: null });
    const enTete = { etat: ETAT, classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 };
    const lecture = (numero, ids) => ({ numero, total: '131', setCode: 'PRB', symboleSet: null, langue: 'EN', attaque: null, attaqueConfiance: null, carteTcgdexId: null, totalHorsTailleDeSet: false, vivierIds: ids });
    const chaine = async (req, res) => {
        const sid = String(req.scanIdImpose);
        if (mode === 'sur') return res.json({ success: true, scanId: sid, question: null, ...enTete, candidats: [cand(P1, '12')], carte: { idProduct: P1, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '12', setCode: 'PRB', total: '131', rarete: null, langue: 'EN', ambigu: false }, lectureGarde: lecture('12', [P1]) });
        // la chaîne POSE une question (réserve le crédit). 'probable' : la lecture « 12 » contredit P2 (15) mais PAS P3 (12) → non, voir plus bas ; 'un-contredit' : P1 et P2 seuls
        const [a, b2, l] = mode === 'probable' ? [P1, P2, lecture('12', [P1, P2])] : mode === 'trois' ? [P1, P2, lecture('12', [P1, P2, P3])] : [P1, P3, lecture('12', [P1, P3])];     // 'sans-signal' : P1 et P3 portent le MÊME numéro
        const liste = mode === 'trois' ? [P1, P2, P3] : [a, b2];
        await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: liste });
        return res.json({ success: true, scanId: sid, question: { etat: 'en-attente', delaiHeures: 24 }, ...enTete, candidats: liste.map(i => cand(i, i === P2 ? '15' : '12')), carte: { idProduct: a, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '12', setCode: 'PRB', total: '131', rarete: null, langue: 'EN', ambigu: true }, lectureGarde: l });
    };
    const monter = async cfgApp => {
        const app = express(); app.set('trust proxy', true); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
        pret.armer(require('../modeles').verifierIndex);
        app.use(assembler([require('../argent/monter'), require('../identifier/monter')], cfgApp, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), voisinsEmpreinte: async () => ({ ok: false, code: 'muette' }) }));
        return H.serveur(app);
    };
    const scan = async (s, m, version) => { mode = m; const x = await inst(); const r = await poster(s.url, x.jeton, version); const j = r.json || {}; return { ...x, r, j, scanId: j.scanId, c0: j.analyse && j.analyse.cartes[0] }; };
    const sOff = await monter(cfgOff), sOn = await monter(cfgOn);

    // ── 1. ÉTEINT (défaut) : la réponse est celle d'avant — ni niveau ni probable, crédit RÉSERVÉ, rien de plus dans `analyses`
    const off = await scan(sOff, 'probable', '2.0.1');
    H.v('1a. V2_PROBABLE éteint, extension 2.0.1 : la question d\'avant (a-trancher), crédit RÉSERVÉ, ni `niveau` ni `probable`', [off.c0.statut, ids(off.c0), await livre(off), 'niveau' in off.c0, 'probable' in off.c0, off.j.facturation.reserve, off.j.facturation.debite], ['a-trancher', [P1, P2], RESERVE, false, false, 1, 0]);
    H.v('   `analyses` ne porte aucun champ probable', JSON.stringify((await analyseDe(off.scanId)).cartes[0]).includes('probable'), false);

    // ── 2. ALLUMÉ + extension >= 2.0.1 : le probable
    const on = await scan(sOn, 'probable', '2.0.1');
    H.v('2a. allumé, 2.0.1, la lecture contredit l\'autre candidat : niveau probable, probable { P1, aConfirmer }, carte et prixLive null, les deux candidats gardés', [on.c0.statut, on.c0.niveau, on.c0.probable, on.c0.carte, on.c0.prixLive, ids(on.c0)], ['a-trancher', 'probable', { idProduct: P1, aConfirmer: true }, null, null, [P1, P2]]);
    H.v('   facturation : débité à l\'affichage (debite 1, reserve 0), un seul débit, le grand livre « debite »', [on.j.facturation.debite, on.j.facturation.reserve, on.j.facturation.motif, await livre(on)], [1, 0, 'question', PAYE]);
    const anOn = await analyseDe(on.scanId), qOn = await raw('questions_v2').findOne({ _id: `${on.scanId}:0` });
    H.v('   surveillance interne : analyses.cartes[0].probable = { idProduct, signal }, jamais servi sous cette forme ; la question est marquée probable', [anOn.cartes[0].probable, qOn.probable, qOn.etat], [{ idProduct: P1, signal: 'A' }, true, 'en-attente']);
    H.v('   pas de verdict d\'affaire ni de fourchette sur la carte probable', [on.c0.verdictAffiche ?? null, on.c0.fourchette ?? null, 'verdict' in on.c0], [null, null, false]);
    const sur = await scan(sOn, 'sur', '2.0.1');
    H.v('2b. un SÛR : niveau sur, probable null ; facturation affirmée', [sur.c0.statut, sur.c0.niveau, sur.c0.probable, sur.j.facturation.motif, await livre(sur)], ['identifiee', 'sur', null, 'affirmee', PAYE]);
    const nul = await scan(sOn, 'sans-signal', '2.0.1');
    H.v('2c. deux candidats au MÊME numéro (la lecture ne contredit pas le rival) : niveau question, probable null, crédit RÉSERVÉ', [nul.c0.statut, nul.c0.niveau, nul.c0.probable, await livre(nul)], ['a-trancher', 'question', null, RESERVE]);
    const tr = await scan(sOn, 'trois', '2.0.1');
    H.v('2d. trois candidats dont un seul n\'est PAS contredit... P3 porte le même numéro que P1 : pas de probable', [tr.c0.niveau, tr.c0.probable, await livre(tr)], ['question', null, RESERVE]);

    // ── 3. ALLUMÉ + extension plus ancienne : la réponse est celle d'avant, OCTET POUR OCTET (même octets que le serveur éteint)
    const vieux = await scan(sOn, 'probable', '2.0.0');
    H.v('3a. allumé mais extension 2.0.0 : ni niveau ni probable, crédit RÉSERVÉ, rien d\'écrit en probable', [vieux.c0.statut, 'niveau' in vieux.c0, 'probable' in vieux.c0, await livre(vieux), (await raw('questions_v2').findOne({ _id: `${vieux.scanId}:0` })).probable ?? false], ['a-trancher', false, false, RESERVE, false]);
    H.v('3b. la réponse (2.0.0, allumé) est identique octet pour octet à celle du serveur éteint', norm(JSON.stringify(vieux.j.analyse)) === norm(JSON.stringify(off.j.analyse)) && JSON.stringify(vieux.j.facturation) === JSON.stringify(off.j.facturation), true);
    // ── 4. éteint + extension récente et sûr : aucun niveau non plus
    const surOff = await scan(sOff, 'sur', '2.0.1');
    H.v('4. éteint : même un sûr ne porte pas `niveau`', 'niveau' in surOff.c0, false);

    // ── 5. LES RÉPONSES : confirmer ne débite pas de plus ; « aucune » rend (constats) ; « ne-sait-pas » ne rend pas ; jamais deux débits
    const a1 = await scan(sOn, 'probable', '2.0.1');
    const ok = await repondre(sOn.url, a1.jeton, a1.scanId, (await raw('questions_v2').findOne({ _id: `${a1.scanId}:0` })).choix.find(c => c.idProduct === P1).id);
    H.v('5a. confirmer le probable : identifiee P1, debite 1, un seul débit, rien de rendu', [ok.json.carte.statut, ok.json.carte.carte.idProduct, ok.json.facturation.debite, await livre(a1)], ['identifiee', P1, 1, PAYE]);
    H.v('   probableConfirme = true (interne)', (await analyseDe(a1.scanId)).cartes[0].probableConfirme, true);
    const a2 = await scan(sOn, 'probable', '2.0.1');
    const autre = await repondre(sOn.url, a2.jeton, a2.scanId, (await raw('questions_v2').findOne({ _id: `${a2.scanId}:0` })).choix.find(c => c.idProduct === P2).id);
    H.v('5b. choisir l\'autre candidat : identifiee P2, un seul débit ; probableConfirme = false', [autre.json.carte.carte.idProduct, await livre(a2), (await analyseDe(a2.scanId)).cartes[0].probableConfirme], [P2, PAYE, false]);
    const a3 = await scan(sOn, 'probable', '2.0.1');
    const aucune = await repondre(sOn.url, a3.jeton, a3.scanId, 'aucune');
    H.v('5c. « aucune » : introuvable, REMBOURSÉ (rembourse true), un débit, un remboursement ; probableConfirme = false', [aucune.json.carte.statut, aucune.json.facturation.rembourse, await livre(a3), (await analyseDe(a3.scanId)).cartes[0].probableConfirme], ['introuvable', true, RENDU, false]);
    const a4 = await scan(sOn, 'probable', '2.0.1');
    const nsp = await repondre(sOn.url, a4.jeton, a4.scanId, 'ne-sait-pas');
    H.v('5d. « ne-sait-pas » : PAS de remboursement (debite 1), le débit reste acquis', [nsp.json.facturation.debite, nsp.json.facturation.rembourse, await livre(a4)], [1, false, PAYE]);
    const rej = await repondre(sOn.url, a1.jeton, a1.scanId, (await raw('questions_v2').findOne({ _id: `${a1.scanId}:0` })).choix.find(c => c.idProduct === P1).id);
    H.v('5e. rejeu de la même réponse : 200, toujours un seul débit', [rej.statut, await livre(a1)], [200, PAYE]);

    // ── 6. /ping annonce le jeton `probable` seulement allumé
    // (le jeton de /ping est tenu par test-capacites-ping.js : cet assemblage ne monte pas /ping)

    for (const s of [sOff, sOn]) await s.fermer();
    H.v('contrat : toutes les réponses valident le schéma publié', ecartsContrat, 0);
    await mongoose.disconnect(); await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
