'use strict';
// Les index des abonnements (modeles.js : INDEX_ABO). Créés avec tous les autres par creerIndex() (migrations/creer-index.js) ; EXIGÉS par verifierIndex(true) seulement quand les abonnements sont allumés.
// Collections neuves, noms nus (aucun ne figure parmi les collections héritées : le registre d'événements de la v1 a la sienne et n'est JAMAIS touché).
//   · abo_evenements  : le REGISTRE des événements Stripe, une ligne par identifiant d'événement (_id = evt_…, donc unique par construction). Jamais purgé, pas de TTL.
//   · abo_places      : les places Fondateurs, une ligne par place (_id = « place:k »). L'insertion de l'_id est ATOMIQUE : deux acheteurs ne gagnent jamais la même place.
//                       L'index sur compteId garantit UNE place par compte.
//   · abo_parrainage  : les codes de parrainage (_id = le code), un par compte.
//   · abo_primes      : les mois offerts aux parrains, une ligne par FILLEUL (_id = compteId du filleul) : un seul crédit par filleul, quoi qu'il arrive.
//   · abo_essais      : le registre de l'essai sans carte (HMAC de la boîte et des installations ; survit à la suppression du compte).
//   · comptes.stripeClient : UN client Stripe par compte, et un client Stripe n'appartient jamais à deux comptes.
const I = (c, nom, cle, opts = {}) => ({ c, nom, cle, opts: { name: nom, ...opts } });
const INDEX_ABO = Object.freeze([
    I('comptes', 'comptes_stripeClient', { stripeClient: 1 }, { unique: true, partialFilterExpression: { stripeClient: { $type: 'string' } } }),
    I('abo_places', 'abo_places_compte', { compteId: 1 }, { unique: true, partialFilterExpression: { compteId: { $type: 'objectId' } } }),
    I('abo_parrainage', 'abo_parrainage_compte', { compteId: 1 }, { unique: true })
]);
// STRIPE-DECISIONS — des index de CONFORT : créés avec les autres (creerIndex) mais jamais EXIGÉS par verifierIndex. Aucun ne garantit une propriété du droit (l'unicité du registre de l'essai est son _id) ;
// déployer le code avant de les créer ne ferme donc aucune route v2 : l'essai fonctionne, un peu moins vite, et les lignes expirées ne sont comparées qu'à leur date (essai.js) en attendant le TTL.
//   · abo_essais.expireLe (TTL) retire une réservation abandonnée (75 min) ou un essai plus vieux que la rétention ; abo_essais.compteId sert la confirmation du webhook ;
//   · installations.comptesLies : les installations qui ont été liées à un compte (posé à la liaison) — la garde « une installation, un essai » les retrouve même déliées.
const INDEX_ABO_CONFORT = Object.freeze([
    I('abo_essais', 'abo_essais_ttl', { expireLe: 1 }, { expireAfterSeconds: 0 }),
    I('abo_essais', 'abo_essais_compte', { compteId: 1 }),
    I('installations', 'installations_comptes_lies', { comptesLies: 1 })
]);
module.exports = { INDEX_ABO, INDEX_ABO_CONFORT };
