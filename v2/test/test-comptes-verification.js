'use strict';
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons');
(async () => {
    await H.ouvrirBac('test-comptes-verification.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const srv = await A.demarrer(cfg);
    let n = 0;
    const verif = (jeton, s = srv, entetes = {}) => H.appel(s.url, '/api/compte/verification', { methode: 'POST', corps: { jeton }, entetes: { ...A.SITE, ...A.ip(++n), ...entetes } });
    const nouveauCompte = async (email = `u${++n}@exemple.fr`) => { const c = M.nouveauCompte({ email, emailCle: email, motDePasse: {} }); await db.col('comptes').insertOne(c); return c; };
    const lien = async (c, type = 'verification', decalageMs = 24 * 3600e3) => {
        const jeton = J.genererJeton();
        await db.col('liens_email').insertOne({ empreinte: J.empreinte(jeton), type, compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + decalageMs), utiliseLe: null });
        return jeton;
    };

    // 1 + 7
    const c1 = await nouveauCompte(); const j1 = await lien(c1);
    const r1 = await verif(j1);
    H.v('200 { success, verifie }', [r1.statut, r1.json], [200, { success: true, verifie: true }]);
    const a1 = await db.col('comptes').findOne({ _id: c1._id });
    H.v('verifie, offertes posées, accueil 25', [a1.verifie, a1.offertesAccordeesLe instanceof Date, a1.solde.accueil], [true, true, 25]);
    const mv = await db.col('mouvements').find({ compteId: c1._id }).toArray();
    H.v('un mouvement octroi-accueil conforme', mv.map(m => [m.type, m.delta, m.poche, m.motif, m.cleIdempotence, m.etat]), [['octroi', 25, 'accueil', 'octroi-accueil', `octroi-accueil|${c1._id}`, 'debite']]);
    H.vrai('le mouvement expire à +24 mois (730 j)', Math.abs(mv[0].expireLe.getTime() - (Date.now() + 730 * 86400e3)) < 10000);
    // rejeu du même jeton
    const rr = await verif(j1);
    H.v('jeton déjà utilisé : 404 CODE_INVALIDE', [rr.statut, rr.json.erreur.code], [404, 'CODE_INVALIDE']);
    // 2 : 20 vérifications simultanées
    const c2 = await nouveauCompte(); const j2 = await lien(c2);
    const rafale = await Promise.all(Array.from({ length: 20 }, () => verif(j2)));
    const a2 = await db.col('comptes').findOne({ _id: c2._id });
    const nbMv = await db.col('mouvements').countDocuments({ compteId: c2._id, motif: 'octroi-accueil' });
    H.v('20 requêtes, 1 octroi : accueil 25, 1 mouvement', [a2.solde.accueil, nbMv, rafale.filter(x => x.statut === 200).length], [25, 1, 1]);
    // 3 : second jeton pour le même compte
    const j2b = await lien(c2);
    const r2b = await verif(j2b);
    const a2b = await db.col('comptes').findOne({ _id: c2._id });
    H.v('second lien : 200 mais aucun octroi de plus', [r2b.statut, a2b.solde.accueil, await db.col('mouvements').countDocuments({ compteId: c2._id })], [200, 25, 1]);
    // 4 : expiré
    const c4 = await nouveauCompte(); const j4 = await lien(c4, 'verification', -1000);
    const r4 = await verif(j4);
    H.v('lien expiré : 410 CODE_EXPIRE, verifie reste faux', [r4.statut, r4.json.erreur.code, (await db.col('comptes').findOne({ _id: c4._id })).verifie], [410, 'CODE_EXPIRE', false]);
    // 5 : mauvais type
    const c5 = await nouveauCompte(); const j5 = await lien(c5, 'reinit');
    const r5 = await verif(j5);
    H.v('lien de réinitialisation présenté ici : 404, rien d\'accordé', [r5.statut, r5.json.erreur.code, (await db.col('comptes').findOne({ _id: c5._id })).solde.accueil], [404, 'CODE_INVALIDE', 0]);
    const rinc = await verif(J.genererJeton());
    H.v('jeton inconnu : 404', rinc.statut, 404);
    const rnt = await verif(12345);
    H.v('jeton non-texte : 404', rnt.statut, 404);
    // origine
    const c9 = await nouveauCompte(); const j9 = await lien(c9);
    const so = await H.appel(srv.url, '/api/compte/verification', { methode: 'POST', corps: { jeton: j9 }, entetes: A.ip(++n) });
    H.v('sans Origin : 403 ORIGINE et le jeton n\'est pas consommé', [so.statut, (await db.col('liens_email').findOne({ empreinte: J.empreinte(j9) })).utiliseLe], [403, null]);
    // 6 : V2_ACCUEIL=10
    const srv10 = await A.demarrer(lireConfig({ MONGODB_BASE: 'test_scratch', V2_ACCUEIL: '10' }));
    const c6 = await nouveauCompte(); const j6 = await lien(c6);
    await verif(j6, srv10);
    H.v('V2_ACCUEIL=10 : octroi de 10', [(await db.col('comptes').findOne({ _id: c6._id })).solde.accueil, (await db.col('mouvements').findOne({ compteId: c6._id })).delta], [10, 10]);
    await srv10.fermer();
    // 8 : le trou connu (suppression puis réinscription) est FERMÉ par l'empreinte d'adresse : voir test-comptes-empreinte.js
    H.v('l\'octroi a écrit l\'empreinte de l\'adresse (c1, c2, c6… : un octroi, une empreinte)', await db.col('adresses_octroyees').countDocuments({}), await db.col('mouvements').countDocuments({ motif: 'octroi-accueil' }));
    // garde au niveau du COMPTE : 10 liens différents consommés ensemble
    const cm = await nouveauCompte(); const liensM = []; for (let i = 0; i < 10; i++) liensM.push(await lien(cm));
    const rm = await Promise.all(liensM.map(j => verif(j)));
    H.v('10 liens différents simultanés (10 requêtes) : accueil 25, 1 mouvement', [rm.filter(x => x.statut === 200).length, (await db.col('comptes').findOne({ _id: cm._id })).solde.accueil, await db.col('mouvements').countDocuments({ compteId: cm._id })], [10, 25, 1]);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
