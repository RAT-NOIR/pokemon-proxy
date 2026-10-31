/**
 * LE FORMATEUR DE NOMBRES ET DE MONTANTS DU SITE (lot 6-B, tour 1, M2) — un seul, lu par Tarifs (`prixAffiche`), le scanner et les
 * comptes (`components/espace/NombreVivant.tsx`). Chemin et noms stables : `formaterNombre`, `formaterMontant`.
 *
 * `Intl.NumberFormat("fr-FR")` écrit le séparateur de milliers en ESPACE FINE INSÉCABLE (U+202F) : un glyphe que certaines polices
 * n'ont pas (blanc trop large ou « tofu ») et qui n'est pas une espace sûre pour tous les moteurs. Toute espace d'un nombre devient une
 * espace insécable U+00A0, écrite en échappement : un montant ne se coupe jamais en fin de ligne.
 */
export function formaterNombre(valeur        , decimales = 0)         {
  return valeur.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }).replace(/[\s\u202f]/g, "\u00a0");
}

/** « 631,80 € » : le nombre, une espace insécable, le signe euro. */
export function formaterMontant(valeur        , decimales = 2)         {
  return `${formaterNombre(valeur, decimales)}\u00a0€`;
}
