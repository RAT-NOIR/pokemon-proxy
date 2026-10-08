'use strict';
// La Facturation (CONTRAT-2 §3.5) : { debite, reserve, rembourse, motif, raisonNonRembourse }. Listes FERMÉES : une valeur hors liste lève.
// Les causes de non-remboursement sont celles de sources.js (RAISONS_NON_REMBOURSE) — importées, jamais recopiées (§21 bis).
const { RAISONS_NON_REMBOURSE } = require('../../sources');
const MOTIFS = Object.freeze(['affirmee', 'question', 'lot', 'introuvable', 'sans-prix', 'panne', 'plafond-jour', 'administrateur']);

// La liste de sources.js est fermée et n'est pas à moi : une cause que v2 connaît seule (« abonnement-mois-change ») se dit « poche-introuvable » vers le public.
// Toute cause inconnue de la liste devient « erreur » (un cas non classé ne passe jamais pour un cas ordinaire).
const SYNONYMES = Object.freeze({ 'abonnement-mois-change': 'poche-introuvable' });
function raisonPublique(raison) {
    if (raison == null) return null;
    if (RAISONS_NON_REMBOURSE.includes(raison)) return raison;
    const s = SYNONYMES[raison];
    return s && RAISONS_NON_REMBOURSE.includes(s) ? s : 'erreur';
}
function facturation({ debite = 0, reserve = 0, rembourse = 0, motif = null, raisonNonRembourse = null } = {}) {
    if (motif !== null && !MOTIFS.includes(motif)) throw new Error(`facturation : motif hors liste fermée "${motif}"`);
    if (raisonNonRembourse !== null && !RAISONS_NON_REMBOURSE.includes(raisonNonRembourse)) throw new Error(`facturation : raisonNonRembourse hors liste fermée "${raisonNonRembourse}"`);
    return { debite, reserve: motif === 'question' ? reserve : 0, rembourse, motif, raisonNonRembourse };
}
module.exports = { facturation, raisonPublique, MOTIFS };
