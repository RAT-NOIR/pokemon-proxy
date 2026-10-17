'use strict';
// FREIN-CONSTATES tours 2 et 3 — UNE SEULE fonction décide, pour un remboursement qui ne nomme pas sa nature (la chaîne héritée par le pont, les filets de la route et du lot), si le motif est une panne de NOTRE côté
// (nature `panne`, classe `infra` du grand livre : HORS plafond, elle ne se facture jamais) ou un constat sur la photo (nature `introuvable`, classe `constate` : plafonné par offre).
// Écrite par ce qu'elle AUTORISE : deux listes FERMÉES de VALEURS EXACTES (aucun préfixe ouvert), établies sur TOUS les motifs que le code émet aujourd'hui (index.js : rembourserScan ; v2 : routes, lot, questions, scanner, marque-scan).
// Un motif INCONNU (un futur `panne-XXX` compris) va du côté constat (plafonné, jamais illimité : la règle de l'offre inconnue), est COMPTÉ (`motifInconnu`) et journalisé sans donnée de scan.
// Les natures `jumeaux`, `constate-question`, `question`, `sans-prix`, `lot-trop-grand` sont NOMMÉES par leurs appelants et ne passent pas ici.
const { absenceNonConstatee } = require('../../sources');

// PANNE de notre côté, hors plafond. Valeurs exactes :
//   ia-echec                  index.js (/api/identifier et /api/analyser) — le fournisseur du modèle en PANNE PROUVÉE (erreur classée par classerPanneIA, ou 200 au corps d'erreur) ; plus jamais « le modèle n'a rien rendu »
//   depense-modele-plafond    index.js — le plafond de dépense du modèle atteint PENDANT le scan (lecture nulle, cause 'depense')
//   erreur-serveur            index.js (rembourserSiRienLivre) — une exception de NOTRE code
//   tcgdex-injoignable        index.js — la source TCGdex hors service
//   arret-serveur             v2/argent/marque-scan.js — le serveur est mort pendant le scan
//   panne-SERVEUR, panne-INDISPONIBLE, panne-IA     v2/identifier/routes.js (`panne-${erreur.code}`) et lot.js (`panne-${code}`) : les trois seuls codes de panne que l'adaptateur et le lot produisent
//   lot-supplement-verification, lot-supplement-en_reconciliation, lot-supplement-indisponible    lot.js (`lot-supplement-${code}`, sansPlafond en dur) ; QUOTA devient `lot-trop-grand`
// Et, par le prédicat UNIQUE de sources.js (`absenceNonConstatee`) : `carte-introuvable` / `aucun-candidat` prononcés alors qu'une source est tombée pendant le scan.
const MOTIFS_PANNE = Object.freeze(['ia-echec', 'depense-modele-plafond', 'erreur-serveur', 'tcgdex-injoignable', 'arret-serveur',
    'panne-SERVEUR', 'panne-INDISPONIBLE', 'panne-IA',
    'lot-supplement-verification', 'lot-supplement-en_reconciliation', 'lot-supplement-indisponible']);
// CONSTAT sur la photo, plafonné. Valeurs exactes :
//   introuvable (v2 routes, lot) · ia-sans-lecture (la lecture n'a rien rendu d'exploitable : photo sans carte, JSON invalide ou sans nom) · numero-illisible, carte-introuvable · aucun-prix · aucun-candidat
//   nom-contredit-egalite, nom-contredit-sans-repli · egalite-parfaite · sans-prix (scanner)
const MOTIFS_CONSTAT = Object.freeze(['introuvable', 'ia-sans-lecture', 'numero-illisible', 'carte-introuvable', 'aucun-prix', 'aucun-candidat', 'nom-contredit-egalite', 'nom-contredit-sans-repli', 'egalite-parfaite', 'sans-prix']);
const PREFIXES_CONSTAT = Object.freeze(['question:']);       // `question:${raison}` : la question posée par la chaîne (acces.js), nommée `question` / `constate-question` par ses appelants (raison libre, côté constat par construction)

const compte = { motifInconnu: 0 };
const compteurs = () => ({ ...compte });
const enConstat = m => MOTIFS_CONSTAT.includes(m) || PREFIXES_CONSTAT.some(p => m.startsWith(p));

/** @returns 'panne' (hors plafond) ou 'introuvable' (plafonné). Seule une valeur de la liste « panne », ou une absence non constatée (source tombée), est hors plafond ; un motif absent des DEUX listes est compté et journalisé. */
function natureDuMotif(motif) {
    if (typeof motif !== 'string') { signalerInconnu(); return 'introuvable'; }
    if (MOTIFS_PANNE.includes(motif)) return 'panne';
    if (absenceNonConstatee(motif)) return 'panne';              // « cette carte n'existe pas » dit alors qu'on n'a pas pu chercher : une panne de NOTRE côté (le même prédicat requalifie le refus en échec technique)
    if (!enConstat(motif)) signalerInconnu();
    return 'introuvable';
}
// la ligne de journal ne cite NI le motif brut (il pourrait porter une donnée), NI un scan : le compteur et le fait suffisent. Un motif inconnu est rare par construction (deux listes fermées) : une ligne par occurrence.
function signalerInconnu() {
    compte.motifInconnu++;
    {
        console.warn(`⚠️ [v2 nature-du-motif] motif-inconnu : un remboursement a un motif absent des deux listes, rangé du côté constat (plafonné) — ${compte.motifInconnu} jusqu'ici`);
    }
}

module.exports = { natureDuMotif, compteurs, MOTIFS_PANNE, MOTIFS_CONSTAT, PREFIXES_CONSTAT };
