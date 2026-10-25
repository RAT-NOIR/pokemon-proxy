'use strict';
// HORS-BANC (25/10) — les scans du compte de MESURE (`comptes.banc === true`, créé par v2/admin/compte-essai.js --banc) sont marqués `banc: true` au journal (`journal_scans`) et sur `analyses` : ils servent à mesurer le
// service d'essai, jamais à compter l'usage. Toute statistique d'usage lit le journal À TRAVERS ce filtre.
// Écrit par ce qu'il AUTORISE : une ligne compte dans l'usage seulement si `banc` n'est PAS exactement `true` (absent, null, false : l'usage réel — le champ est jeune, `undefined` n'est pas « banc »).
const FILTRE_HORS_BANC = Object.freeze({ banc: Object.freeze({ $ne: true }) });
const horsBanc = ligne => !(ligne && ligne.banc === true);
/** Fusionne le filtre dans une requête Mongo existante (le `banc` de la requête, s'il y en avait un, est remplacé : le filtre prime). */
const avecHorsBanc = (filtre = {}) => ({ ...filtre, banc: { $ne: true } });
module.exports = { FILTRE_HORS_BANC, horsBanc, avecHorsBanc };
