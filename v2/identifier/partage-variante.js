'use strict';
// PARTAGES-VARIANTE (2026-10-18) — UNE SEULE définition de la forme « paire Staff/Jumbo séparée par la variante », pour la décision du chargeur (decision.js), la validation d'entrée (visuels.js),
// la structure de l'archive (version.js), la colonne des partages (version.js) et la lecture du tampon (lecture-tampon.js) : jamais deux copies (§21 bis). Module PUR : ni base, ni réseau.
// Le catalogue a retiré `produitsPartages` de 61 paires (56 Staff, 5 Jumbo) : elles sont séparées par la `variante` de leurs lignes cartes_produits (staff|jumbo et normale, chacune avec sa preuve).
// 🔑 Écrit par ce qu'il AUTORISE. Une image est « servie à une paire séparée par la variante » SEULEMENT si, tout à la fois :
//   · partageeTamponNonSepare est EXACTEMENT false (ni true, ni null, ni absent) ;
//   · partageeHoloNonHolo n'est pas true ;
//   · elle ne porte AUCUNE liste produitsPartages (null ou absente ; une liste vide ou à un autre produit est une liste : la règle d'avant s'applique) ;
//   · le produit servi porte un jeton de variante de la liste fermée (marques-tampon.js : une marque, un ensemble de marques, jumbo ou normale ; le chargeur ne la pose qu'AVEC sa preuve : varianteAvecPreuve).
// Tout le reste garde la règle fermée d'avant : true sans liste, holo sans liste, liste qui ne contient pas le produit, false sans liste sur un produit sans variante prouvée -> écarté.
// LOT TAMPONS : « une variante staff, jumbo ou normale » devient « un jeton de la liste fermée du catalogue » (identifier/marques-tampon.js : une marque, un ensemble de marques canonique joint par « + »,
// jumbo, normale). Staff et jumbo se comportent EXACTEMENT comme avant ; la liste n'est écrite qu'à UN endroit (marques-tampon.js), jamais recopiée ici.
const MT = require('./marques-tampon');
const estVariantePaire = MT.estVariante;                                                // la forme canonique seulement : null pour tout le reste (jamais deviné)

const sansListe = l => l === undefined || l === null;

/** @param m { partageeTamponNonSepare, partageeHoloNonHolo, produitsPartages } (une entrée, ou une image cartes.images) ; @param variante la variante PROUVÉE du produit servi */
function separeeParVariante(m, variante) {
    return Boolean(m) && typeof m === 'object' && m.partageeTamponNonSepare === false && m.partageeHoloNonHolo !== true && sansListe(m.produitsPartages) && estVariantePaire(variante);
}

// Deux fichiers sont « le même » s'ils portent la même clé. Deux ABSENCES ne sont l'égalité que pour `grande` (absenteAdmise) : une paire dont les deux vignettes manquent n'est pas « le même visuel ».
const absent = x => x === null || x === undefined;
const memeFichier = (x, y, absenteAdmise = false) => (absent(x) && absent(y) ? absenteAdmise === true : Boolean(x && y && typeof x.cle === 'string' && x.cle && x.cle === y.cle));

/**
 * Deux entrées d'archive (format 2) forment-elles une paire séparée par la variante ? (b) de F1 et colonne des partages de la version.
 * Exige : la forme ci-dessus des DEUX côtés ; une variante staff|jumbo d'un côté et normale de l'autre ; le MÊME visuel (même vignette, même grande) ; la MÊME fiche (`memeFiche(a, b)` injecté, absent = non).
 * @returns { ok: true, special, normale, variante } | { ok: false, motif }  — special / normale sont les idProduct.
 */
function pairePar(ea, eb, memeFiche) {
    const refus = motif => ({ ok: false, motif });
    if (!ea || !eb || typeof ea !== 'object' || typeof eb !== 'object') return refus('un candidat n\'a pas d\'entrée d\'archive');
    if (!separeeParVariante(ea, ea.variante) || !separeeParVariante(eb, eb.variante)) return refus('la paire n\'est pas séparée par la variante (marquage, liste ou variante)');
    const sa = MT.estSpeciale(ea.variante), sb = MT.estSpeciale(eb.variante);
    if (!(sa !== sb && (sa ? eb : ea).variante === 'normale')) return refus('les variantes ne sont pas une paire staff|jumbo/normale');
    if (!memeFichier(ea.vignette, eb.vignette) || !memeFichier(ea.grande, eb.grande, true)) return refus('les deux produits ne partagent pas le même visuel');
    if (typeof memeFiche !== 'function') return refus('la fiche commune n\'est pas connue');
    let meme = false;
    try { meme = memeFiche(ea.idProduct, eb.idProduct) === true; } catch { meme = false; }
    if (!meme) return refus('les deux produits ne sont pas de la même fiche');
    const special = sa ? ea : eb, normale = sa ? eb : ea;
    return { ok: true, special: special.idProduct, normale: normale.idProduct, variante: special.variante };
}

module.exports = { separeeParVariante, pairePar, estVariantePaire };
