'use strict';
// BREVO, tour 1 (R4) — un courriel de vérification ou de réinitialisation REFUSÉ PAR LE PLAFOND DU JOUR ne consomme pas la place de 24 h de l'adresse : la demande suivante (plafond levé) part.
// Un échec d'une autre nature (panne de Brevo) garde la prise : un pilote en panne ne se rattrape pas en bombardant une boîte (O3). Base de banc, courrier simulé.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles');
const { lireConfig } = require('../config'); const svc = require('../comptes/service'); const J = require('../comptes/jetons');
(async () => {
    await H.ouvrirBac('test-courrier-plafond-service.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const erreur = nom => Object.assign(new Error(nom), { name: nom });
    let panne = null; const envoyes = [];
    const courrier = {
        async envoyerVerification(email, lien) { if (panne) throw panne; envoyes.push(['verification', email]); },
        async envoyerReinitialisation(email, lien) { if (panne) throw panne; envoyes.push(['reinit', email]); }
    };
    const orig = console.error; const traces = []; console.error = (...a) => traces.push(a.join(' '));
    try {
        const mail = 'tiers@exemple.fr';
        // inscription : refus au plafond, puis nouvelle demande possible
        panne = erreur('BrevoPlafond');
        await svc.inscrire({ email: mail, emailCle: mail, cfg, courrier }); await svc.attendre();
        H.v('R4 : plafond atteint à l\'inscription : rien n\'est parti', envoyes.length, 0);
        panne = null;
        await svc.renvoyerVerification({ email: mail, cfg, courrier }); await svc.attendre();
        H.v('   la demande suivante (plafond levé) PART : la place de 24 h n\'a pas été consommée', envoyes.map(e => e[0]), ['verification']);
        await svc.renvoyerVerification({ email: mail, cfg, courrier }); await svc.attendre();
        H.v('   et la place de 24 h est ensuite bien prise (pas de second courriel)', envoyes.length, 1);

        // une panne ordinaire garde la prise
        const autre = 'autre@exemple.fr';
        panne = erreur('BrevoStatut503');
        await svc.inscrire({ email: autre, emailCle: autre, cfg, courrier }); await svc.attendre();
        panne = null;
        await svc.renvoyerVerification({ email: autre, cfg, courrier }); await svc.attendre();
        H.v('   une panne de Brevo (503) garde la prise de 24 h (rien ne part à la demande suivante)', envoyes.length, 1);

        // réinitialisation : refus au plafond, puis nouvelle demande possible (3 par heure : le refus ne doit pas en consommer une)
        const compte = 'reinit@exemple.fr';
        await db.col('comptes').insertOne(Object.assign(M.nouveauCompte({ email: compte, emailCle: compte, motDePasse: null, now: new Date() }), { verifie: true, verifieLe: new Date() }));
        panne = erreur('BrevoPlafond');
        for (let i = 0; i < 4; i++) { await svc.demanderReinit({ email: compte, cfg, courrier }); await svc.attendre(); }
        panne = null;
        await svc.demanderReinit({ email: compte, cfg, courrier }); await svc.attendre();
        H.v('R4 : 4 refus au plafond de réinitialisation ne consomment pas les 3 demandes de l\'heure : la suivante part', envoyes.filter(e => e[0] === 'reinit').length, 1);
        H.vrai('aucune adresse dans les journaux', !traces.join('\n').includes('exemple.fr'));
    } finally { console.error = orig; }
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
