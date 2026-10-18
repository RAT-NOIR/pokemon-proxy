'use strict';
// Les index des abonnements (modeles.js : INDEX_ABO). Créés avec tous les autres par creerIndex() (migrations/creer-index.js) ; EXIGÉS par verifierIndex(true) seulement quand les abonnements sont allumés.
// Collections neuves, noms nus (aucun ne figure parmi les collections héritées : le registre d'événements de la v1 a la sienne et n'est JAMAIS touché).
//   · abo_evenements  : le REGISTRE des événements Stripe, une ligne par identifiant d'événement (_id = evt_…, donc unique par construction). Jamais purgé, pas de TTL.
//   · abo_places      : les places Fondateurs, une ligne par place (_id = « place:k »). L'insertion de l'_id est ATOMIQUE : deux acheteurs ne gagnent jamais la même place.
//                       L'index sur compteId garantit UNE place par compte.
//   · abo_parrainage  : les codes de parrainage (_id = le code), un par compte.
//   · abo_primes      : les mois offerts aux parrains, une ligne par FILLEUL (_id = compteId du filleul) : un seul crédit par filleul, quoi qu'il arrive.
//   · comptes.stripeClient : UN client Stripe par compte, et un client Stripe n'appartient jamais à deux comptes.
const I = (c, nom, cle, opts = {}) => ({ c, nom, cle, opts: { name: nom, ...opts } });
const INDEX_ABO = Object.freeze([
    I('comptes', 'comptes_stripeClient', { stripeClient: 1 }, { unique: true, partialFilterExpression: { stripeClient: { $type: 'string' } } }),
    I('abo_places', 'abo_places_compte', { compteId: 1 }, { unique: true, partialFilterExpression: { compteId: { $type: 'objectId' } } }),
    I('abo_parrainage', 'abo_parrainage_compte', { compteId: 1 }, { unique: true })
]);
module.exports = { INDEX_ABO };
