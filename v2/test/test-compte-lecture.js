'use strict';
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const S = require('../comptes/sessions'); const P = require('../comptes/mots-de-passe');
(async () => {
    await H.ouvrirBac('test-compte-lecture.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const vus = [];
    A.registre.fournir('argent', {
        solde: async p => ({ total: 7, compte: p.type }),
        historique: async (p, suite) => { vus.push([p.type, suite]); return suite === 'p2' ? { lignes: [{ n: 3 }], suite: null } : { lignes: [{ n: 1 }, { n: 2 }], suite: 'p2' }; }
    });
    const srv = await A.demarrer(cfg);
    let n = 0; const MDP = 'un-mot-de-passe-solide';
    const hash = await P.hacher(MDP);
    const creer = async (email, achete = 0) => { const c = M.nouveauCompte({ email, emailCle: email.toLowerCase().replace(/\./g, ''), motDePasse: hash }); c.verifie = true; c.solde.achete = achete; await db.col('comptes').insertOne(c); const s = await S.creerSession(c._id); return { c, cookie: `rm_session=${s.token}`, token: s.token }; };
    const get = (cookie, q = '') => H.appel(srv.url, '/api/compte' + q, { entetes: { cookie, ...A.ip(++n) } });
    const supp = (cookie, corps, site = true) => H.appel(srv.url, '/api/compte', { methode: 'DELETE', corps, entetes: { cookie, ...(site ? A.SITE : {}), ...A.ip(++n) } });
    const inst = async (compteId, extra = {}) => { const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(J.genererJeton()), essais: 2, libelle: 'Chrome' }); i.compteId = compteId; Object.assign(i, extra); await db.col('installations').insertOne(i); return i; };

    const { c, cookie } = await creer('A.B@Gmail.com');
    const autre = await creer('autre@exemple.fr');
    const i1 = await inst(c._id, { lieeLe: new Date(), derniereAnalyseLe: new Date() }), iRev = await inst(c._id, { revoqueeLe: new Date() }), iAutre = await inst(autre.c._id);
    // 1-4
    const r = await get(cookie);
    H.v('200 + no-store', [r.statut, r.entetes['cache-control']], [200, 'no-store']);
    H.v('forme : compte, solde, installations, historique', [r.json.success, Object.keys(r.json.compte).sort(), r.json.compte.email, r.json.solde, Object.keys(r.json.historique)], [true, ['creeLe', 'email', 'verifie'], 'A.B@Gmail.com', { total: 7, compte: 'compte' }, ['lignes', 'suite']]);
    H.v('les installations révoquées et celles d\'un autre compte n\'y figurent pas (3 en base, 1 rendue)', r.json.installations.map(i => [i.id, i.libelle, Object.keys(i).sort()]), [[i1._id, 'Chrome', ['derniereAnalyse', 'id', 'libelle', 'lieeLe']]]);
    const motifs = ['motDePasse', 'jetonEmpreinte', 'tokenEmpreinte', 'emailCle', 'hash', 'ab@gmail.com', hash.hash, hash.sel, i1.jetonEmpreinte];
    H.v('aucun champ secret dans la réponse (9 motifs cherchés)', motifs.filter(m => r.texte.includes(m)), []);
    const p2 = await get(cookie, '?suite=p2');
    H.v('historique paginé par curseur opaque', [r.json.historique.suite, p2.json.historique.lignes, p2.json.historique.suite, vus[vus.length - 1][1]], ['p2', [{ n: 3 }], null, 'p2']);
    const sans = await get('');
    H.v('sans session : 401 SESSION', [sans.statut, sans.json.erreur.code], [401, 'SESSION']);
    // 5 suppression
    const mauvais = await supp(cookie, { motDePasse: 'mauvais-mot-de-passe' });
    H.v('mauvais mot de passe : 401 IDENTIFIANTS, rien supprimé', [mauvais.statut, mauvais.json.erreur.code, await db.col('comptes').countDocuments({ _id: c._id })], [401, 'IDENTIFIANTS', 1]);
    const sansO = await supp(cookie, { motDePasse: MDP }, false);
    H.v('sans Origin : 403, rien supprimé', [sansO.statut, await db.col('comptes').countDocuments({ _id: c._id })], [403, 1]);
    await db.col('comptes').updateOne({ _id: c._id }, { $set: { 'solde.achete': 40 } });
    for (const x of [`compte:${c._id}`]) await db.col('analyses').insertMany([{ _id: 'a1', porteur: x, creeLe: new Date() }, { _id: 'a2', porteur: x, creeLe: new Date() }]);
    await db.col('analyses').insertOne({ _id: 'a3', porteur: `compte:${autre.c._id}`, creeLe: new Date() });
    await db.col('mouvements').insertMany([{ compteId: c._id, le: new Date(), type: 'octroi', delta: 25 }, { compteId: autre.c._id, le: new Date(), type: 'octroi', delta: 25 }]);
    await db.col('codes_liaison').insertOne({ codeEmpreinte: 'e1', compteId: c._id, expireLe: new Date(Date.now() + 1e5), utiliseLe: null });
    await db.col('liens_email').insertOne({ empreinte: 'l1', type: 'reinit', compteId: c._id, expireLe: new Date(Date.now() + 1e5), utiliseLe: null });
    const achete = await supp(cookie, { motDePasse: MDP });
    H.v('crédits achetés sans renonciation : 409 CREDITS_ACHETES et RIEN supprimé', [achete.statut, achete.json.erreur.code, await db.col('comptes').countDocuments({ _id: c._id }), await db.col('analyses').countDocuments({ porteur: `compte:${c._id}` }), await db.col('sessions').countDocuments({ compteId: c._id })], [409, 'CREDITS_ACHETES', 1, 2, 1]);
    const faux = await supp(cookie, { motDePasse: MDP, renonciation: 'oui' });
    H.v('renonciation non booléenne vraie : refusée (409)', faux.statut, 409);
    const ok = await supp(cookie, { motDePasse: MDP, renonciation: true });
    H.v('avec renonciation : 200', [ok.statut, ok.json], [200, { success: true }]);
    H.v('compte, sessions, codes, liens, analyses supprimés ; ceux d\'un autre compte intacts', [await db.col('comptes').countDocuments({ _id: c._id }), await db.col('sessions').countDocuments({ compteId: c._id }), await db.col('codes_liaison').countDocuments({ compteId: c._id }), await db.col('liens_email').countDocuments({ compteId: c._id }), await db.col('analyses').countDocuments({ porteur: `compte:${c._id}` }), await db.col('analyses').countDocuments({}), await db.col('comptes').countDocuments({ _id: autre.c._id }), await db.col('sessions').countDocuments({ compteId: autre.c._id })], [0, 0, 0, 0, 0, 1, 1, 1]);
    const ins = await db.col('installations').find({ _id: { $in: [i1._id, iRev._id] } }).toArray();
    H.v('ses installations : compteId null, essais 0', ins.map(i => [i.compteId, i.essais]), [[null, 0], [null, 0]]);
    H.v('installation d\'un autre compte intacte', (await db.col('installations').findOne({ _id: iAutre._id })).compteId.equals(autre.c._id), true);
    const mv = await db.col('mouvements').find({}).toArray();
    H.v('mouvements : compteId retiré et supprime:true pour le compte supprimé, intacts pour l\'autre', mv.map(m => [m.compteId ? 'oui' : 'non', m.supprime === true]).sort(), [['non', true], ['oui', false]]);
    // 6
    const rejoue = await get(cookie);
    H.v('cookie rejoué : 401 SESSION', [rejoue.statut, rejoue.json.erreur.code], [401, 'SESSION']);
    // 7 sans crédits achetés : sans renonciation
    const d = await creer('dernier@exemple.fr', 0);
    const ok2 = await supp(d.cookie, { motDePasse: MDP });
    H.v('sans crédits achetés : la suppression passe sans renonciation', [ok2.statut, await db.col('comptes').countDocuments({ _id: d.c._id })], [200, 0]);
    // plafond partagé avec la connexion (10/h/adresse)
    const e = await creer('essaie@exemple.fr'); const codes = [];
    for (let k = 0; k < 11; k++) codes.push((await supp(e.cookie, { motDePasse: 'mauvais-mot-de-passe' })).statut);
    H.v('suppression avec mots de passe faux : 10 × 401 puis 429 (11 tentatives)', [codes.slice(0, 10).every(x => x === 401), codes[10]], [true, 429]);
    // I5 / mineur : le limiteur de suppression est distinct de celui de la connexion
    const f = await creer('separe@exemple.fr'); const ckf = f.cookie;
    for (let k = 0; k < 10; k++) await supp(ckf, { motDePasse: 'mauvais-mot-de-passe' });
    const connexionLibre = await H.appel(srv.url, '/api/compte/connexion', { methode: 'POST', corps: { email: 'separe@exemple.fr', motDePasse: 'mauvais-mot-de-passe' }, entetes: { ...A.SITE, ...A.ip(++n) } });
    H.v('10 suppressions ratées ne consomment PAS le budget de connexion (401 IDENTIFIANTS, pas 429)', connexionLibre.statut, 401);
    // mineur : purge de hebdo, plafonds, questions
    const g = await creer('purge@exemple.fr');
    await db.col('hebdo').insertOne({ compteId: g.c._id, semaine: '2026-W41', count: 1, expireLe: new Date(Date.now() + 1e8) });
    await db.col('hebdo').insertOne({ compteId: autre.c._id, semaine: '2026-W41', count: 1, expireLe: new Date(Date.now() + 1e8) });
    await db.col('plafonds').insertMany([{ porteur: `compte:${g.c._id}`, jour: '2026-10-08', type: 'panne', count: 2, expireLe: new Date(Date.now() + 1e8) }, { porteur: `compte:${autre.c._id}`, jour: '2026-10-08', type: 'panne', count: 2, expireLe: new Date(Date.now() + 1e8) }]);
    await db.col('questions_v2').insertMany([{ _id: 'q1', porteur: `compte:${g.c._id}`, etat: 'en-attente', poseeLe: new Date() }, { _id: 'q2', porteur: `compte:${autre.c._id}`, etat: 'en-attente', poseeLe: new Date() }]);
    const sp = await supp(g.cookie, { motDePasse: MDP });
    H.v('suppression : hebdo, plafonds, questions du compte purgés, ceux d\'un autre intacts', [sp.statut, await db.col('hebdo').countDocuments({ compteId: g.c._id }), await db.col('plafonds').countDocuments({ porteur: `compte:${g.c._id}` }), await db.col('questions_v2').countDocuments({ porteur: `compte:${g.c._id}` }), await db.col('hebdo').countDocuments({}), await db.col('plafonds').countDocuments({}), await db.col('questions_v2').countDocuments({})], [200, 0, 0, 0, 1, 1, 1]);
    // I1 : une empreinte d'adresse est écrite à la suppression d'un compte qui avait reçu ses offertes
    const h = await creer('empreinte@exemple.fr'); await db.col('comptes').updateOne({ _id: h.c._id }, { $set: { offertesAccordeesLe: new Date() } });
    await supp(h.cookie, { motDePasse: MDP });
    H.v('compte aux offertes accordées supprimé : une empreinte conservée', await db.col('adresses_octroyees').countDocuments({}), 1);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
