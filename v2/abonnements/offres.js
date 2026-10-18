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

const ESSAI_JOURS = 14;                 // Pro : 14 jours, UNE fois par compte
const ESSAI_PARRAINAGE_JOURS = 30;      // le filleul : 30 jours au lieu de 14
const GRACE_IMPAYE_JOURS = 3;           // past_due : Pro maintenu 3 jours après le premier échec (voir etat.js), jamais prolongé par un nouvel échec
const SESSION_MINUTES = 60;             // la durée MINIMALE d'une session Checkout (elle vit de 60 à 70 minutes : voir routes.js, tranche de 10 minutes)
const MARGE_RESERVATION_MINUTES = 15;   // la réservation d'une place Fondateurs dure SESSION_MINUTES + cette marge : elle couvre toute la vie de la session (70 minutes) avec 5 minutes de plus
module.exports = { OFFRES, PERIODES, CATALOGUE, DEVISE, INTERVALLE, lookupKey, DEPUIS_LOOKUP, cleProduit, ESSAI_JOURS, ESSAI_PARRAINAGE_JOURS, GRACE_IMPAYE_JOURS, SESSION_MINUTES, MARGE_RESERVATION_MINUTES };
