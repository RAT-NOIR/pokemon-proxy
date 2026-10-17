// ============================================================
// PRODUITS EN MATIÈRE SPÉCIALE (lot METAL, 2026-10-17) — TABLE FERMÉE
// ============================================================
// 🔑 DÉCISION DU TESTEUR (2026-10-17 soir) : « 580162 (Charizard en métal doré du coffret Ultra-Premium de Celebrations). Un trou, pas un badge. Le badge Staff/Jumbo ne vaut que
// lorsque le scan partagé est fidèle à un tampon près. Une carte en métal doré ne ressemble pas à la carte normale : le scan normal serait une vignette fausse. Le produit reste sans fiche
// ni visuel tant qu'on n'a pas de scan de la carte en métal elle-même. »
//
// UN PRODUIT DE CETTE TABLE NE SE JOINT JAMAIS À LA FICHE (NI AU SCAN) DE SA CARTE NORMALE. Cardmarket le range comme « V2 » de la carte normale (même idMetacard, même nom) : toute jointure
// par le numéro, par le nom, ou par les frères de métacarte le rattacherait à la carte normale. La table est lue par `joindre()` (collecte-cartes/jointure.js, `attache`), par
// `ecrireJointure` (ecrire-jointure.js, défense en profondeur) et par les poseurs de fiches par métacarte (poser-par-metacarte.js, poser-fiches-par-freres.js, poser-fiches-par-setlist.js).
// Elle est ÉCRITE PAR CE QU'ELLE AUTORISE : on n'y entre que par une décision nommée (le testeur, ou le coordinateur après une planche), avec le motif, la date et le frère normal.
//
// POUR AJOUTER UN PRODUIT : une entrée ici (motif, décision, date, frère normal) ET `node retirer-scan-faux-metal.js` (à blanc, puis --ecrire --attendu=N) pour détacher sa ligne éventuelle.
// Retirer une entrée est la seule façon de rendre le produit à la jointure : elle demande le scan de la carte en métal elle-même (ou une décision du testeur).
'use strict';

const entree = (o) => Object.freeze(o);

const PRODUITS_MATIERE_SPECIALE = Object.freeze({
    580162: entree({
        nom: 'Charizard [Energy Burn | Fire Spin]',
        motif: 'carte en métal doré du coffret Ultra-Premium de Celebrations, rangée V2 de la carte normale de la Classic Collection (576772, carte 60348 n°4) : une vignette dorée, pas le scan normal',
        decision: 'testeur, 2026-10-17 soir : un trou, pas un badge ; le produit reste sans fiche ni visuel tant qu\'on n\'a pas le scan de la carte en métal elle-même',
        date: '2026-10-17',
        frereNormal: 576772,
        idExpansion: 4347,
    }),
});

/** Le produit est-il en matière spéciale ? Accepte un nombre ou une chaîne de chiffres ; tout le reste est faux. */
function estMatiereSpeciale(idProduct) {
    if (idProduct === null || idProduct === undefined || idProduct === '') return false;
    const n = Number(idProduct);
    return Number.isInteger(n) && Object.hasOwn(PRODUITS_MATIERE_SPECIALE, n);
}

/** La raison écrite d'un produit de la table (pour le détail d'un reste), ou null. */
function motifMatiere(idProduct) { return estMatiereSpeciale(idProduct) ? PRODUITS_MATIERE_SPECIALE[Number(idProduct)].motif : null; }

/** Garde d'écriture : LÈVE, en nommant les produits et le contexte, si un produit de la table figure dans le lot. À appeler AVANT la première écriture. */
function garderMatiereSpeciale(idProducts, contexte = '') {
    const trouves = [...new Set((idProducts || []).filter(estMatiereSpeciale).map(Number))];
    if (trouves.length) throw new Error(`❌ ARRÊT${contexte ? ` (${contexte})` : ''} : ${trouves.length} produit(s) en matière spéciale dans le lot (${trouves.join(', ')}) — décision du testeur : un trou, jamais la fiche de la carte normale. Rien n'est écrit.`);
}

module.exports = { PRODUITS_MATIERE_SPECIALE, estMatiereSpeciale, motifMatiere, garderMatiereSpeciale };
