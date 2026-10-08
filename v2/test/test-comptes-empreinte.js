'use strict';
// I1 : « jamais deux fois pour une même adresse » survit à la suppression du compte. I3(b) : un lien de réinitialisation prouve l'adresse.
// M6 : le lien n'est brûlé qu'APRÈS l'octroi.
const crypto = require('crypto'); const mongoose = require('mongoose');
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe'); const S = require('../comptes/sessions');
const { creerCourrierMemoire } = require('../comptes/courrier');
const SECRET = 'un-secret-serveur-de-test-assez-long';
const hmac = cle => crypto.createHmac('sha256', SECRET).update(`octroi|${cle}`).digest('hex');
(async () => {
    await H.ouvrirBac('test-comptes-empreinte.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_SECRET_EMPREINTE: SECRET });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    A.registre.fournir('argent', { solde: async () => ({}), historique: async () => ({ lignes: [], suite: null }) });
    const srv = await A.demarrer(cfg); let n = 0; const MDP = 'un-mot-de-passe-solide';
    const hash = await P.hacher(MDP);
    const post = (c, corps, e = {}) => H.appel(srv.url, c, { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(++n), ...e } });
    const lien = async (compteId, type = 'verification') => { const j = J.genererJeton(); await db.col('liens_email').insertOne({ empreinte: J.empreinte(j), type, compteId, creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), utiliseLe: null }); return j; };
    const creer = async cle => { const c = M.nouveauCompte({ email: cle, emailCle: cle, motDePasse: hash }); await db.col('comptes').insertOne(c); return c; };
    const supprimer = async c => { const s = await S.creerSession(c._id); return H.appel(srv.url, '/api/compte', { methode: 'DELETE', corps: { motDePasse: MDP, renonciation: true }, entetes: { ...A.SITE, cookie: `rm_session=${s.token}`, ...A.ip(++n) } }); };
    const accueil = async cle => (await db.col('comptes').findOne({ emailCle: cle }));

    // 1 : l'empreinte est un HMAC écrit avec l'octroi
    const c1 = await creer('dup@exemple.fr');
    await post('/api/compte/verification', { jeton: await lien(c1._id) });
    const emp = await db.col('adresses_octroyees').find({}).toArray();
    H.v('octroi : 25, une empreinte écrite', [(await accueil('dup@exemple.fr')).solde.accueil, emp.length], [25, 1]);
    H.v('l\'empreinte est le HMAC-SHA256 (clé = secret serveur), pas un simple SHA de l\'adresse', [emp[0].empreinte === hmac('dup@exemple.fr'), emp[0].empreinte === J.empreinte('dup@exemple.fr'), JSON.stringify(emp).includes('dup')], [true, false, false]);
    H.vrai('expireLe ≈ +365 jours (12 mois, décision 5)', Math.abs(emp[0].expireLe.getTime() - (Date.now() + 365 * 864e5)) < 10000);
    // 2 : suppression puis réinscription
    const sup = await supprimer(c1);
    H.v('suppression : 200, l\'empreinte SURVIT (1)', [sup.statut, await db.col('adresses_octroyees').countDocuments({})], [200, 1]);
    const ri = await post('/api/compte/inscription', { email: 'DUP@exemple.fr', motDePasse: MDP, turnstile: 't' }); await A.attendre();
    const c2 = await accueil('dup@exemple.fr');
    const lienMail = courrier.envoyes.filter(e => e.type === 'verification').pop().lien;
    const rv = await post('/api/compte/verification', { jeton: new URL(lienMail).searchParams.get('jeton') });
    const c2b = await accueil('dup@exemple.fr');
    H.v('même adresse recréée : vérifiée (200) mais AUCUNE offerte', [ri.statut, rv.statut, c2b.verifie, c2b.solde.accueil, c2b.offertesAccordeesLe, await db.col('mouvements').countDocuments({ compteId: c2._id })], [202, 200, true, 0, null, 0]);
    // 3 : variante Gmail
    const g1 = await creer('xy@gmail.com'); await post('/api/compte/verification', { jeton: await lien(g1._id) }); await supprimer(g1);
    await post('/api/compte/inscription', { email: 'x.y+bis@Gmail.com', motDePasse: MDP, turnstile: 't' }); await A.attendre();
    const g2 = await accueil('xy@gmail.com');
    await post('/api/compte/verification', { jeton: new URL(courrier.envoyes.filter(e => e.type === 'verification').pop().lien).searchParams.get('jeton') });
    H.v('autre écriture Gmail de l\'adresse : toujours refusée', (await accueil('xy@gmail.com')).solde.accueil, 0);
    // 4 : un compte jamais vérifié, supprimé, n'a pas consommé l'offre
    const nv = await creer('jamais@exemple.fr'); await supprimer(nv);
    const nv2 = await creer('jamais@exemple.fr'); await post('/api/compte/verification', { jeton: await lien(nv2._id) });
    H.v('compte supprimé sans offertes : la réinscription les reçoit', (await accueil('jamais@exemple.fr')).solde.accueil, 25);
    // 5 : I3(b) réinitialisation
    const u = await creer('oubli@exemple.fr');
    const ru = await post('/api/compte/reinitialiser', { jeton: await lien(u._id, 'reinit'), motDePasse: 'nouveau-mot-de-passe-2' });
    const au = await accueil('oubli@exemple.fr');
    H.v('réinitialisation d\'un compte NON vérifié : prouve l\'adresse, verifie true + 25', [ru.statut, au.verifie, au.solde.accueil, await db.col('mouvements').countDocuments({ compteId: u._id, motif: 'octroi-accueil' })], [200, true, 25, 1]);
    const ru2 = await post('/api/compte/reinitialiser', { jeton: await lien(u._id, 'reinit'), motDePasse: 'encore-un-mot-de-passe-3' });
    H.v('une seconde réinitialisation ne redonne rien', [ru2.statut, (await accueil('oubli@exemple.fr')).solde.accueil], [200, 25]);
    const d = await creer('dup@exemple.fr').catch(() => null);   // existe déjà (c2) : on réutilise c2
    await db.col('comptes').updateOne({ _id: c2._id }, { $set: { verifie: false, verifieLe: null } });
    await post('/api/compte/reinitialiser', { jeton: await lien(c2._id, 'reinit'), motDePasse: 'nouveau-mot-de-passe-2' });
    H.v('réinitialisation sur une adresse déjà octroyée : vérifiée, 0 offerte (I1 tient)', [(await accueil('dup@exemple.fr')).verifie, (await accueil('dup@exemple.fr')).solde.accueil], [true, 0]);
    // 6 : M6, panne entre l'octroi et la consommation du lien
    const m = await creer('panne@exemple.fr'); const jm = await lien(m._id);
    const reelle = mongoose.connection.db; let casse = true;
    const lie = (t, tc) => new Proxy(tc, { get(o, p) { if (p === 'findOneAndUpdate' && casse) return async () => { throw new Error('panne'); }; const v = o[p]; return typeof v === 'function' ? v.bind(o) : v; } });
    db.brancher(new Proxy(reelle, { get(t, p) { if (p === 'collection') return nom => { const c = t.collection(nom); return nom.endsWith('liens_email') ? lie(t, c) : c; }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v; } }));
    const r1 = await post('/api/compte/verification', { jeton: jm });
    casse = false; db.brancher(reelle);
    const am = await accueil('panne@exemple.fr');
    H.v('panne sur la consommation du lien : 503, MAIS les 25 sont accordés et le lien reste utilisable', [r1.statut, am.solde.accueil, am.verifie, (await db.col('liens_email').findOne({ empreinte: J.empreinte(jm) })).utiliseLe], [503, 25, true, null]);
    const r2 = await post('/api/compte/verification', { jeton: jm });
    H.v('relance du même lien : 200, pas de second octroi', [r2.statut, (await accueil('panne@exemple.fr')).solde.accueil, await db.col('mouvements').countDocuments({ compteId: m._id })], [200, 25, 1]);
    // concurrence conservée
    const k = await creer('course@exemple.fr'); const jk = await lien(k._id);
    const rafale = await Promise.all(Array.from({ length: 20 }, () => post('/api/compte/verification', { jeton: jk })));
    H.v('20 requêtes sur un lien : 1 réponse 200, accueil 25, 1 mouvement', [rafale.filter(x => x.statut === 200).length, (await accueil('course@exemple.fr')).solde.accueil, await db.col('mouvements').countDocuments({ compteId: k._id })], [1, 25, 1]);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
