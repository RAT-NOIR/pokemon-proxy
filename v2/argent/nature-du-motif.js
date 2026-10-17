'use strict';
// FREIN-CONSTATES tour 2 — UNE SEULE fonction décide, pour un remboursement qui ne nomme pas sa nature (la chaîne héritée par le pont, les filets de la route et du lot), si le motif est une panne de NOTRE côté
// (nature `panne`, classe `infra` du grand livre : HORS plafond, elle ne se facture jamais) ou un constat sur la photo (nature `introuvable`, classe `constate` : plafonné par offre).
// Écrite par ce qu'elle AUTORISE : deux listes FERMÉES, établies sur TOUS les motifs que le code émet aujourd'hui (index.js : rembourserScan ; v2 : routes, lot, questions, scanner, marque-scan).
// Un motif INCONNU va du côté constat (plafonné, jamais illimité : la règle de l'offre inconnue), est COMPTÉ (`motifInconnu`) et journalisé sans donnée de scan.
// Les natures `jumeaux`, `constate-question`, `question`, `sans-prix`, `lot-trop-grand` sont NOMMÉES par leurs appelants et ne passent pas ici.

// PANNE de notre côté, hors plafond. Exacts :
//   ia-echec            index.js:3136, 3781 — le service de lecture (modèle) en échec
//   erreur-serveur      index.js:3400, 6308 (rembourserSiRienLivre) — une exception de NOTRE code
//   tcgdex-injoignable  index.js:4143 — la source TCGdex hors service
//   arret-serveur       v2/argent/marque-scan.js — le serveur est mort pendant le scan
//   depense-modele-plafond  la coupure de dépense du modèle (v2/argent/depense-modele.js)
// Préfixes : `panne-` (v2/identifier/routes.js, lot.js : `panne-${code}` avec INDISPONIBLE, SERVEUR, IA…) et `lot-supplement-` (lot.js : supplément impayable côté serveur, déjà sans plafond).
const MOTIFS_PANNE = Object.freeze(['ia-echec', 'erreur-serveur', 'tcgdex-injoignable', 'arret-serveur', 'depense-modele-plafond']);
const PREFIXES_PANNE = Object.freeze(['panne-', 'lot-supplement-']);
// CONSTAT sur la photo, plafonné. Exacts :
//   introuvable (v2 routes, lot) · numero-illisible, carte-introuvable (index.js:3169, 4144) · aucun-prix (3298) · aucun-candidat (4741)
//   nom-contredit-egalite, nom-contredit-sans-repli (4855) · egalite-parfaite (5031) · sans-prix (scanner)
const MOTIFS_CONSTAT = Object.freeze(['introuvable', 'numero-illisible', 'carte-introuvable', 'aucun-prix', 'aucun-candidat', 'nom-contredit-egalite', 'nom-contredit-sans-repli', 'egalite-parfaite', 'sans-prix']);
const PREFIXES_CONSTAT = Object.freeze(['question:']);       // `question:${raison}` : la question posée par la chaîne (acces.js), nommée `question` / `constate-question` par ses appelants

const compte = { motifInconnu: 0 };
const compteurs = () => ({ ...compte });
const enPanne = m => MOTIFS_PANNE.includes(m) || PREFIXES_PANNE.some(p => m.startsWith(p));
const enConstat = m => MOTIFS_CONSTAT.includes(m) || PREFIXES_CONSTAT.some(p => m.startsWith(p));

/** @returns 'panne' (hors plafond) ou 'introuvable' (plafonné). Tout ce qui n'est pas une chaîne de la liste « panne » est plafonné ; un motif absent des DEUX listes est compté et journalisé. */
function natureDuMotif(motif) {
    if (typeof motif !== 'string') { signalerInconnu(); return 'introuvable'; }
    if (enPanne(motif)) return 'panne';
    if (!enConstat(motif)) signalerInconnu();
    return 'introuvable';
}
// la ligne de journal ne cite NI le motif brut (il pourrait porter une donnée), NI un scan : le compteur et le fait suffisent ; une ligne par tranche de 100 pour ne pas inonder
function signalerInconnu() {
    compte.motifInconnu++;
    if (compte.motifInconnu === 1 || compte.motifInconnu % 100 === 0) console.warn(`⚠️ [v2 nature-du-motif] motif-inconnu : un remboursement a un motif absent des deux listes, rangé du côté constat (plafonné) — ${compte.motifInconnu} jusqu'ici`);
}

module.exports = { natureDuMotif, compteurs, MOTIFS_PANNE, PREFIXES_PANNE, MOTIFS_CONSTAT, PREFIXES_CONSTAT };
