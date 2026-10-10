'use strict';
// Emplacement du lot B3 — réécrit par son lot, et par lui seul. Enregistre « argent » dans le registre (contrat §3.3) : la configuration est LIÉE ici, les consommateurs appellent sans cfg.
const paiement = require('./paiement'); const { aiguilleur } = require('../heritage'); const registre = require('../registre');
const Lg = require('./ledger'); const Q = require('./questions'); const S = require('./solde'); const Lot = require('./lot'); const Fa = require('./facturation');
const Fu = require('./fusion'); const He = require('./heritage'); const Ab = require('./abonnement'); const Pont = require('./pont-acces');
module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps) {
        // INT2 : /api/creer-recharge recouvre une route HÉRITÉE (heritage.js) : l'assembleur exige un aiguilleur en premier handler. Même prédicat que celui de
        // creerRecharge (porteur v2 posé en amont) : tout autre appelant (1.0.x) tombe sur la route héritée, avant la garde d'index.
        router.post('/api/creer-recharge', aiguilleur(req => Boolean(req.v2 && req.v2.porteur)), paiement.creerRecharge);
        registre.fournir('argent', {
            solde: (porteur, maintenant) => S.solde(porteur, cfg, maintenant),
            peutPayer: (porteur, maintenant) => S.peutPayer(porteur, cfg, maintenant),
            historique: (porteur, suite) => S.historique(porteur, typeof suite === 'object' && suite !== null ? suite : { suite }, cfg),
            debiter: (porteur, o) => Lg.debiter(porteur, o, cfg),
            rembourser: (porteur, credit, motif, o) => Lg.rembourser(porteur, credit, motif, o, cfg),
            reserverQuestion: (porteur, credit, q, maintenant) => Q.reserverQuestion(porteur, credit, q, cfg, maintenant),
            repondreQuestion: (porteur, o, maintenant) => Q.repondreQuestion(porteur, o, cfg, maintenant),
            balayerQuestions: o => Q.balayerQuestions(o, cfg),
            fusionnerALaLiaison: o => Fu.fusionnerALaLiaison(o, cfg),
            reprendreHeritage: o => He.reprendreHeritage(o, cfg),
            rattacherAchats: (o, injections) => He.rattacherAchats(o, cfg, injections),
            debiterSupplement: (porteur, o) => Lot.debiterSupplement(porteur, o, cfg),
            coutDuLot: n => Lot.coutDuLot(n, cfg),
            facturation: Fa.facturation,
            creditPourReq: (porteur, credit, ctx) => Pont.creditPourReq(porteur, credit, cfg, ctx),
            crediterAchat: o => paiement.crediterAchat(o, cfg),
            activerAbonnement: Ab.activerAbonnement, desactiverAbonnement: Ab.desactiverAbonnement
        });
    }
};
