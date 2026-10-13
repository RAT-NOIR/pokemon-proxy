'use strict';
// Parcours de bout en bout du lot B2 sur l'app Express réelle (routes des deux montages). L'argent (B3) est un faux qui lit les mêmes champs que le vrai.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const { creerCourrierMemoire } = require('../comptes/courrier');
(async () => {
    await H.ouvrirBac('test-comptes-parcours.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); const fusions = [];
    A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    A.registre.fournir('argent', {
        solde: async p => p.compte ? { accueil: p.compte.solde.accueil, essai: 0 } : { essai: p.installation.essais },
        historique: async () => ({ lignes: [], suite: null }),
        offre: p => require('../argent/offre').offre(p, cfg),      // OFFRE-QUOTA : la VRAIE fonction (le faux ne ment pas sur l'offre), appelée par lier / délier
        // O3 tour 2 (I-B) : un faux FIDÈLE à la signature réelle (`{ compteId, installationId }`), pas un qui accepte n'importe quelle forme
        fusionnerALaLiaison: require('./_fusion-fidele').fusionFidele(fusions, { apres: o => db.col('installations').updateOne({ _id: o.installationId }, { $set: { essais: 0 } }) })
    });
    const srv = await A.demarrer(cfg); let n = 0;
    const ip = () => A.ip(++n);
    const MDP = 'un-mot-de-passe-solide';
    const post = async (c, corps, entetes) => { const r = await H.appel(srv.url, c, { methode: 'POST', corps, entetes: { ...ip(), ...entetes } }); await A.attendre(); return r; };   // travail d'inscription détaché (I2)

    const inst = await post('/api/installation', { versionExtension: '2.0.0', libelle: 'Chrome · Windows' });
    H.v('1. installation : 3 essais annoncés', [inst.statut, inst.json.solde.essai], [201, 3]);
    const jeton0 = inst.json.jetonInstallation;
    const i1 = await post('/api/compte/inscription', { email: 'A.B+promo@Gmail.com', turnstile: 't' }, A.SITE);
    H.v('2. inscription : 202', i1.statut, 202);
    const i2 = await post('/api/compte/inscription', { email: 'ab@gmail.com', turnstile: 't' }, A.SITE);
    H.v('CRITÈRE : le même e-mail sous une autre écriture est refusé (202 neutre, UN seul compte, un seul courrier)', [i2.texte === i1.texte, await db.col('comptes').countDocuments({}), courrier.envoyes.length], [true, 1, 1]);
    const jetonLien = new URL(courrier.envoyes[0].lien).searchParams.get('jeton');
    const clicks = await Promise.all([1, 2, 3, 4, 5].map(() => post('/api/compte/verification', { jeton: jetonLien, motDePasse: MDP }, A.SITE)));   // D6 : le mot de passe se choisit au clic
    const compte = await db.col('comptes').findOne({});
    H.v('3. CRITÈRE : un compte vérifié reçoit 25 une fois quel que soit le nombre de clics (5 clics)', [clicks.filter(x => x.statut === 200).length, compte.verifie, compte.solde.accueil, await db.col('mouvements').countDocuments({ motif: 'octroi-accueil' })], [1, true, 25, 1]);
    const conn = await post('/api/compte/connexion', { email: 'ab@gmail.com', motDePasse: MDP }, A.SITE);
    const cookie = /rm_session=[^;]+/.exec(conn.entetes['set-cookie'])[0];
    H.v('4. connexion par une autre écriture de l\'adresse : 200 + cookie', [conn.statut, conn.json.compte.verifie], [200, true]);
    const code = await post('/api/compte/code', {}, { ...A.SITE, cookie });
    const lie = await post('/api/compte/lier', { code: code.json.code }, { authorization: `Bearer ${jeton0}` });
    H.v('5. code puis liaison : 200, jeton renouvelé, fusion appelée une fois', [code.statut, lie.statut, lie.json.jetonInstallation !== jeton0, fusions.length], [200, 200, true, 1]);
    H.v('   la liaison sert l\'offre du COMPTE lié : gratuit, 10 restants, remise à zéro au prochain minuit de Paris (ISO avec fuseau)', [lie.json.offre.nom, lie.json.offre.restant, /^\d{4}-\d{2}-\d{2}T00:00:00\+0[12]:00$/.test(lie.json.offre.remiseAZero)], ['gratuit', 10, true]);
    const ancien = await post('/api/compte/delier', {}, { authorization: `Bearer ${jeton0}` });
    H.v('6. l\'ancien jeton est refusé', [ancien.statut, ancien.json.erreur.code], [401, 'JETON']);
    const lu = await H.appel(srv.url, '/api/compte', { entetes: { cookie, ...ip() } });
    H.v('7. GET /api/compte : l\'installation liée y figure, solde du compte', [lu.statut, lu.json.installations.length, lu.json.installations[0].libelle, lu.json.solde.accueil], [200, 1, 'Chrome · Windows', 25]);
    // CRITÈRE x-jeton
    const xj = await H.appel(srv.url, '/api/compte', { entetes: { 'x-jeton': lie.json.jetonInstallation, ...ip() } });
    const xi = await post('/api/compte/delier', {}, { 'x-jeton': lie.json.jetonInstallation });
    H.v('CRITÈRE : le x-jeton public seul ne porte aucune identité (resoudrePorteur l\'ignore : SESSION / JETON)', [xj.statut, xj.json.erreur.code, xi.statut, xi.json.erreur.code], [401, 'SESSION', 401, 'JETON']);
    const del = await post('/api/compte/delier', {}, { authorization: `Bearer ${lie.json.jetonInstallation}` });
    H.v('8. délier : 200, installation non liée, 0 essai (pas de nouvel essai)', [del.statut, (await db.col('installations').findOne({ _id: inst.json.installationId })).compteId, del.json.solde.essai], [200, null, 0]);
    H.v('   déliée, l\'installation redevient « sans-compte » : 3 analyses par jour, sans rapport avec ses 0 essai en base', [del.json.offre.nom, del.json.offre.restant], ['sans-compte', 3]);
    const sup = await H.appel(srv.url, '/api/compte', { methode: 'DELETE', corps: { motDePasse: MDP }, entetes: { ...A.SITE, cookie, ...ip() } });
    H.v('9. suppression : 200, plus de compte, le cookie ne vaut plus rien', [sup.statut, await db.col('comptes').countDocuments({}), (await H.appel(srv.url, '/api/compte', { entetes: { cookie, ...ip() } })).statut], [200, 0, 401]);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
