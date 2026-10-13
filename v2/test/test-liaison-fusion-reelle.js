'use strict';
// O3 tour 2 (I-B) — banc d'INTÉGRATION de la liaison avec le VRAI module d'argent, sans aucun faux d'argent : la couture `liaison.lier` -> `registre.argent.fusionnerALaLiaison`.
// Avant ce banc, `lier` passait `{ installation, compteId }` à une fonction qui attend `{ compteId, installationId }` : la fusion rendait `ok:false` sans lever, `lier` ignorait
// le retour, et les deux bancs de liaison (faux d'argent qui acceptait n'importe quelle forme) ne le voyaient pas.
const express = require('express');
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles'); const pret = require('../pret');
const { lireConfig } = require('../config'); const { creerCourrierMemoire } = require('../comptes/courrier');
(async () => {
    await H.ouvrirBac('test-liaison-fusion-reelle.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    const { assembler } = require('../index'); const app = express(); app.set('trust proxy', true); app.use(express.json()); pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../installations/monter'), require('../comptes/monter')], cfg, {}));   // le VRAI module d'argent
    const srv = await H.serveur(app); let n = 0;
    const SITE = { ...A.SITE }, EXT = { origin: cfg.origines.extension };
    const post = (ch, corps, entetes = {}) => H.appel(srv.url, ch, { methode: 'POST', corps, entetes: { ...A.ip(++n), ...entetes } });
    const MDP = 'un-mot-de-passe-solide';
    await post('/api/compte/inscription', { email: 'fusion@exemple.fr', turnstile: 'ok' }, SITE); await A.attendre();
    await post('/api/compte/verification', { jeton: new URL(courrier.envoyes[0].lien).searchParams.get('jeton'), motDePasse: MDP }, SITE);   // D6 : mot de passe choisi au clic
    const compte0 = await db.col('comptes').findOne({ emailCle: 'fusion@exemple.fr' });
    const conn = await post('/api/compte/connexion', { email: 'fusion@exemple.fr', motDePasse: MDP }, SITE); const cookie = String(conn.entetes['set-cookie']).split(';')[0];
    const cr = await post('/api/installation', { libelle: 'Chrome' }, EXT);
    await db.col('installations').updateOne({ _id: cr.json.installationId }, { $set: { achete: 2 } });
    const avant = await db.col('installations').findOne({ _id: cr.json.installationId });
    H.v('0. (départ) l\'installation a 3 essais et 2 crédits achetés, le compte 25 d\'accueil et 0 acheté', [avant.essais, avant.achete, compte0.solde], [3, 2, { accueil: 25, achete: 0 }]);
    const code = await post('/api/compte/code', {}, { ...SITE, cookie });
    const lie = await post('/api/compte/lier', { code: code.json.code }, { authorization: `Bearer ${cr.json.jetonInstallation}`, ...EXT });
    const inst = await db.col('installations').findOne({ _id: cr.json.installationId }), compte = await db.col('comptes').findOne({ _id: compte0._id });
    H.v('1. la liaison réelle : 200, installation liée', [lie.statut, String(inst.compteId)], [200, String(compte0._id)]);
    H.v('2. après la liaison : le compte porte les achats (acheté 2, accueil 25 inchangé), l\'installation est à 0 essai / 0 acheté', [compte.solde, inst.essais, inst.achete], [{ accueil: 25, achete: 2 }, 0, 0]);
    const mc = await db.col('mouvements').find({ compteId: compte0._id }).toArray(), mi = await db.col('mouvements').find({ installationId: cr.json.installationId }).toArray();
    H.v('3. les mouvements de fusion existent : entrée +2 acheté sur le compte, sorties −2 acheté et −3 essai sur l\'installation', [mc.filter(m => m.motif === 'fusion-liaison').map(m => [m.delta, m.poche]), mi.map(m => [m.delta, m.poche]).sort()], [[[2, 'achete']], [[-2, 'achete'], [-3, 'essai']].sort()]);
    const somme = mc.reduce((s, m) => s + m.delta, 0);
    H.v('4. la somme des deltas du compte (octroi 25 + fusion 2) égale son solde (accueil + acheté)', [somme, compte.solde.accueil + compte.solde.achete], [27, 27]);
    H.v('5. le solde rendu à l\'extension est celui du COMPTE fusionné (acheté 2, accueil 25)', [lie.json.solde.accueil, lie.json.solde.achete], [25, 2]);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
