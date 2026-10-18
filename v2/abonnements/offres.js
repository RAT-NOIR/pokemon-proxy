'use strict';
// LES OFFRES — les valeurs exactes décidées par le testeur (18/10/2026), à UN seul endroit : le script de provisionnement, les routes et le webhook les lisent ici.
// Les montants sont en CENTIMES, EUR. Le code de l'API ne contient aucun identifiant price_ : ils viennent des variables (config.js).
const OFFRES = Object.freeze(['pro', 'fondateurs']);
const PERIODES = Object.freeze(['mois', 'an']);
const CATALOGUE = Object.freeze({
    pro: Object.freeze({ nom: 'Rat-Market Pro', prix: Object.freeze({ mois: 499, an: 3900 }) }),
    fondateurs: Object.freeze({ nom: 'Rat-Market Fondateurs', prix: Object.freeze({ mois: 299, an: 2900 }) })
});
const DEVISE = 'eur';
const INTERVALLE = Object.freeze({ mois: 'month', an: 'year' });
// Une clé de recherche par prix : le script la pose, le webhook la relit si l'identifiant price_ n'est pas dans la configuration (une offre fermée reste servie à ses abonnés).
const lookupKey = (offre, periode) => `rm_v2_${offre}_${periode}`;
const DEPUIS_LOOKUP = Object.freeze(Object.fromEntries(OFFRES.flatMap(o => PERIODES.map(p => [lookupKey(o, p), { offre: o, periode: p }]))));
// Les métadonnées d'un produit : le script les relit pour retrouver ses produits sans en créer de second.
const cleProduit = offre => `rm_v2_${offre}`;

const MENTION_FACTURE = 'TVA non applicable, art. 293 B du CGI';      // décision de l'éditeur (18/10) : en pied de CHAQUE facture et reçu Stripe (invoice_settings.footer du client) ; écrite aussi au contrat
const ESSAI_JOURS = 14;               // Pro : 14 jours, UNE fois par compte
const ESSAI_PARRAINAGE_JOURS = 30;      // le filleul : 30 jours au lieu de 14
const PLAFOND_PARRAINAGE_MOIS = 12;     // un parrain : au plus 12 mois offerts…
const FENETRE_PARRAINAGE_JOURS = 365;   // …sur 365 jours glissants, comptés à la date d'application de chaque prime
const GRACE_IMPAYE_JOURS = 3;          // past_due : Pro maintenu 3 jours après le premier échec (voir etat.js), jamais prolongé par un nouvel échec
const MARGE_ESSAI_PLACE_JOURS = 3;      // I3 : une place Fondateurs RÉSERVÉE pendant l'essai vit jusqu'à la fin de l'essai + 3 jours (la grâce d'un premier paiement refusé), puis se libère seule
const MARGE_RENOUVELLEMENT_HEURES = 48; // I2 : jusquAu = fin de période + 48 h pour un abonnement actif/en essai qui doit se RENOUVELER (jamais pour une résiliation, un abonnement supprimé, un impayé)
const PRIX_PUBLICS_CACHE_MS = 10 * 60e3; // M4 : durée de vie des montants publics lus chez Stripe
const SESSION_MINUTES = 60;            // la durée MINIMALE d'une session Checkout (elle vit de 60 à 70 minutes : voir routes.js, tranche de 10 minutes)
const ESSAI_RESERVATION_MINUTES = 180;  // la réservation de l'essai (boîte, installations) : bien au-delà de la vie d'une session Checkout (60-70 min) ; la confirmation du webhook vérifie de toute façon (essai.js)
const MARGE_RESERVATION_MINUTES = 15;  // la réservation d'une place Fondateurs dure SESSION_MINUTES + cette marge : elle couvre toute la vie de la session (70 minutes) avec 5 minutes de plus
module.exports = { MENTION_FACTURE, OFFRES, PERIODES, CATALOGUE, DEVISE, INTERVALLE, lookupKey, DEPUIS_LOOKUP, cleProduit, ESSAI_JOURS, ESSAI_PARRAINAGE_JOURS, PLAFOND_PARRAINAGE_MOIS, FENETRE_PARRAINAGE_JOURS, GRACE_IMPAYE_JOURS, MARGE_RENOUVELLEMENT_HEURES, MARGE_ESSAI_PLACE_JOURS, PRIX_PUBLICS_CACHE_MS, ESSAI_RESERVATION_MINUTES, SESSION_MINUTES, MARGE_RESERVATION_MINUTES };
