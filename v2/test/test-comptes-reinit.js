'use strict';
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const S = require('../comptes/sessions'); const { creerCourrierMemoire } = require('../comptes/courrier');
(async () => {
    await H.ouvrirBac('test-comptes-reinit.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();   // B2b point 6 : le plafond de 10 demandes par IP et par heure est une fenêtre FIXE ; l'horloge des limiteurs est fixée au milieu de l'heure
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier);
    A.registre.fournir('turnstile', { verifier: async () => true });
    const srv = await A.demarrer(cfg);
    let n = 0; const ANCIEN = 'ancien-mot-de-passe-1', NOUVEAU = 'nouveau-mot-de-passe-2';
    const post = async (chemin, corps, entetes = {}, ipn = ++n) => { const r = await H.appel(srv.url, chemin, { methode: 'POST', corps, entetes: { ...A.SITE, ...A.ip(ipn), ...entetes } }); await A.attendre(); return r; };   // travail détaché (I2)
    const creer = async (email) => { const c = M.nouveauCompte({ email, emailCle: email, motDePasse: await P.hacher(ANCIEN) }); c.verifie = true; c.offertesAccordeesLe = new Date(Date.now() - 1000); c.solde.accueil = 25; await db.col('comptes').insertOne(c); return c; };
    const lien = async (c, type = 'reinit', decalage = 24 * 3600e3) => { const j = J.genererJeton(); await db.col('liens_email').insertOne({ empreinte: J.empreinte(j), type, compteId: c._id, creeLe: new Date(), expireLe: new Date(Date.now() + decalage), utiliseLe: null }); return j; };

    const c = await creer('carol@exemple.fr'); const autre = await creer('dave@exemple.fr');
    // 1
    const a = await post('/api/compte/mot-de-passe-oublie', { email: 'Carol@Exemple.fr' });
    const b = await post('/api/compte/mot-de-passe-oublie', { email: 'inconnue@exemple.fr' });
    const d = await post('/api/compte/mot-de-passe-oublie', { email: 'pas-une-adresse' });
    H.v('adresse connue / inconnue / invalide : 202 identique octet pour octet (3 requêtes)', [a.statut, b.texte === a.texte, d.texte === a.texte], [202, true, true]);
    const liens = await db.col('liens_email').find({}).toArray();
    H.v('un seul lien (adresse connue), de type reinit, +24 h', [liens.length, liens[0].type, liens[0].compteId.equals(c._id), Math.abs(liens[0].expireLe.getTime() - (Date.now() + 24 * 3600e3)) < 5000], [1, 'reinit', true, true]);
    H.v('un seul courrier, pour la connue', [courrier.envoyes.length, courrier.envoyes[0].type, courrier.envoyes[0].email], [1, 'reinit', 'carol@exemple.fr']);
    const jeton = new URL(courrier.envoyes[0].lien).searchParams.get('jeton');
    H.v('base : empreinte seule', [liens[0].empreinte === J.empreinte(jeton), JSON.stringify(liens).includes(jeton)], [true, false]);
    // 5 : 10 demandes/h/IP
    const rafale = []; for (let i = 0; i < 11; i++) rafale.push((await post('/api/compte/mot-de-passe-oublie', { email: 'inconnue@exemple.fr' }, {}, 9000)).statut);
    H.v('11 demandes de la même IP dans l\'heure : 10 passent, la 11e est 429', [rafale.filter(x => x === 202).length, rafale[10]], [10, 429]);
    const so = await H.appel(srv.url, '/api/compte/mot-de-passe-oublie', { methode: 'POST', corps: { email: 'carol@exemple.fr' }, entetes: A.ip(++n) });
    H.v('sans Origin : 403', so.statut, 403);
    // refus avant consommation
    const faible = await post('/api/compte/reinitialiser', { jeton, motDePasse: '123456789' });
    H.v('mot de passe faible : 422 et le lien n\'est PAS consommé', [faible.statut, faible.json.erreur.code, (await db.col('liens_email').findOne({ empreinte: J.empreinte(jeton) })).utiliseLe], [422, 'MOT_DE_PASSE_FAIBLE', null]);
    const egal = await post('/api/compte/reinitialiser', { jeton, motDePasse: 'carol@exemple.fr' });
    H.v('mot de passe égal à l\'adresse : 422', egal.statut, 422);
    const typeV = await lien(c, 'verification');
    const rv = await post('/api/compte/reinitialiser', { jeton: typeV, motDePasse: NOUVEAU });
    H.v('lien de type verification présenté ici : 404', [rv.statut, rv.json.erreur.code], [404, 'CODE_INVALIDE']);
    const exp = await lien(c, 'reinit', -1000);
    const re = await post('/api/compte/reinitialiser', { jeton: exp, motDePasse: NOUVEAU });
    H.v('lien échu : 410 CODE_EXPIRE', [re.statut, re.json.erreur.code], [410, 'CODE_EXPIRE']);
    H.v('jeton inconnu : 404', (await post('/api/compte/reinitialiser', { jeton: J.genererJeton(), motDePasse: NOUVEAU })).statut, 404);
    // 2 : sessions
    for (let i = 0; i < 3; i++) await S.creerSession(c._id);
    await S.creerSession(autre._id);
    const second = await lien(c);
    const avantHash = (await db.col('comptes').findOne({ _id: c._id })).motDePasse.hash;
    const ok = await post('/api/compte/reinitialiser', { jeton, motDePasse: NOUVEAU });
    H.v('réinitialisation : 200', [ok.statut, ok.json], [200, { success: true }]);
    const apres = await db.col('comptes').findOne({ _id: c._id });
    H.v('hachage changé, sessions du compte supprimées (3 → 0), celles d\'un autre compte intactes', [apres.motDePasse.hash !== avantHash, await db.col('sessions').countDocuments({ compteId: c._id }), await db.col('sessions').countDocuments({ compteId: autre._id })], [true, 0, 1]);
    H.vrai('le nouveau mot de passe n\'est pas en clair', !JSON.stringify(apres).includes(NOUVEAU));
    // 3
    const rejeu = await post('/api/compte/reinitialiser', { jeton, motDePasse: NOUVEAU });
    H.v('même lien rejoué : 404', rejeu.statut, 404);
    H.v('les autres liens de réinitialisation du compte sont invalidés aussi', [(await post('/api/compte/reinitialiser', { jeton: second, motDePasse: NOUVEAU })).statut], [404]);
    // 6
    const vieux = await post('/api/compte/connexion', { email: 'carol@exemple.fr', motDePasse: ANCIEN });
    const neuf = await post('/api/compte/connexion', { email: 'carol@exemple.fr', motDePasse: NOUVEAU });
    H.v('l\'ancien mot de passe échoue, le nouveau passe', [vieux.statut, neuf.statut], [401, 200]);
    // 7
    H.v('ni vérification ni octroi', [apres.verifie, apres.offertesAccordeesLe.getTime() === c.offertesAccordeesLe.getTime(), apres.solde.accueil], [true, true, 25]);
    const nv = M.nouveauCompte({ email: 'nv@exemple.fr', emailCle: 'nv@exemple.fr', motDePasse: await P.hacher(ANCIEN) }); await db.col('comptes').insertOne(nv);
    await post('/api/compte/reinitialiser', { jeton: await lien(nv), motDePasse: NOUVEAU });
    const anv = await db.col('comptes').findOne({ _id: nv._id });
    H.v('compte NON vérifié : la réinitialisation prouve l\'adresse (I3b) => vérifié + 25 offertes, une fois', [anv.verifie, anv.offertesAccordeesLe instanceof Date, anv.solde.accueil, await db.col('mouvements').countDocuments({ compteId: nv._id })], [true, true, 25, 1]);
    const lx = await post('/api/compte/reinitialiser', { jeton: 'x'.repeat(20), motDePasse: {} });
    H.v('motDePasse non-texte : 400 ENTREE (reinit)', [lx.statut, lx.json.erreur.code], [400, 'ENTREE']);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
