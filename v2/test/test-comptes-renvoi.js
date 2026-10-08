'use strict';
// I3(a) : un compte non vérifié peut recevoir un nouveau lien ; la réponse ne dit rien de l'existence de l'adresse.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const J = require('../comptes/jetons'); const { creerCourrierMemoire } = require('../comptes/courrier');
(async () => {
    await H.ouvrirBac('test-comptes-renvoi.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const courrier = creerCourrierMemoire(); A.registre.fournir('courrier', courrier); A.registre.fournir('turnstile', { verifier: async () => true });
    const srv = await A.demarrer(cfg); let n = 0;
    const renvoyer = (email, e = {}, ipn = ++n) => H.appel(srv.url, '/api/compte/renvoyer-verification', { methode: 'POST', corps: { email }, entetes: { ...A.SITE, ...A.ip(ipn), ...e } });
    const creer = async (email, verifie) => { const c = M.nouveauCompte({ email, emailCle: email, motDePasse: {} }); c.verifie = verifie; await db.col('comptes').insertOne(c); return c; };
    const nv = await creer('perdu@exemple.fr', false); const ok = await creer('deja@exemple.fr', true);
    const a = await renvoyer('perdu@exemple.fr'); await A.attendre();
    const b = await renvoyer('deja@exemple.fr'); await A.attendre();
    const c = await renvoyer('inconnu@exemple.fr'); await A.attendre();
    const d = await renvoyer('pas-une-adresse'); await A.attendre();
    H.v('réponse identique octet pour octet : non vérifié / vérifié / inconnu / invalide (4 requêtes)', [a.statut, b.texte === a.texte, c.texte === a.texte, d.texte === a.texte], [202, true, true, true]);
    H.v('un seul courrier, pour le compte NON vérifié', [courrier.envoyes.length, courrier.envoyes[0].type, courrier.envoyes[0].email], [1, 'verification', 'perdu@exemple.fr']);
    const liens = await db.col('liens_email').find({}).toArray();
    H.v('un lien de vérification, +24 h, empreinte seule', [liens.length, liens[0].type, liens[0].compteId.equals(nv._id), Math.abs(liens[0].expireLe.getTime() - (Date.now() + 864e5)) < 5000], [1, 'verification', true, true]);
    const jeton = new URL(courrier.envoyes[0].lien).searchParams.get('jeton');
    H.v('le lien renvoyé vérifie le compte et accorde les 25', [(await H.appel(srv.url, '/api/compte/verification', { methode: 'POST', corps: { jeton }, entetes: { ...A.SITE, ...A.ip(++n) } })).statut, (await db.col('comptes').findOne({ _id: nv._id })).solde.accueil], [200, 25]);
    // plafond par compte : 3 par heure
    const nv2 = await creer('insiste@exemple.fr', false); courrier.envoyes.length = 0;
    for (let i = 0; i < 6; i++) { await renvoyer('insiste@exemple.fr'); await A.attendre(); }
    H.v('6 demandes pour un même compte : 3 courriers au plus (pas de bombardement d\'une boîte)', courrier.envoyes.length, 3);
    // IP
    const codes = []; for (let i = 0; i < 31; i++) codes.push((await renvoyer('inconnu@exemple.fr', {}, 8000)).statut);
    H.v('31 demandes de la même IP dans l\'heure : 30 passent, la 31e est 429', [codes.filter(x => x === 202).length, codes[30]], [30, 429]);
    H.v('sans Origin : 403', (await H.appel(srv.url, '/api/compte/renvoyer-verification', { methode: 'POST', corps: { email: 'perdu@exemple.fr' }, entetes: A.ip(++n) })).statut, 403);
    A.registre.vider(); A.registre.fournir('turnstile', { verifier: async () => true });
    H.v('courrier absent : 503 (fail-closed)', (await renvoyer('perdu@exemple.fr')).statut, 503);
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
