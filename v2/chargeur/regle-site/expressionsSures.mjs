/**
 * LES EXPRESSIONS MONGO QUI NE PRÉSUMENT JAMAIS LE TYPE D'UN CHAMP (2026-10-13, tour 1 du lot « blindage »).
 *
 * `$ifNull` ne rattrape que l'absent et le nul. Un objet, une chaîne ou un nombre là où l'on attend un tableau fait échouer
 * `$filter`, `$map`, `$size` ou `$arrayElemAt` ; un objet là où l'on attend un texte fait échouer `$toString`. L'agrégation
 * jette alors AVANT que les lecteurs (lib/lireDonnee.ts) ne voient un document : la page du set et toutes ses fiches
 * répondaient 500. Sur une forme saine la sortie est IDENTIQUE à l'ancienne écriture (aucune clé de cache). Le test
 * lib/expressionsSures.test.ts refuse l'écriture nue dans lib/, scripts/verifier-pipelines-surs.mjs la prouve sur des documents
 * abîmés (`$documents`, aucune collection lue).
 */

/** Un champ qu'on va parcourir : le tableau lui-même, sinon un tableau vide (absent, nul, objet, texte, nombre…). */
export const tableauOuVide = (champ        ) => ({ $cond: [{ $isArray: champ }, champ, []] });

/** `liens.idProduct[0]`, ou 0 : l'identifiant produit qui entre dans le slug d'une carte sans numéro. */
export const idProduitRepere = () => ({
  $cond: [{ $isArray: "$liens.idProduct" }, { $ifNull: [{ $arrayElemAt: ["$liens.idProduct", 0] }, 0] }, 0],
});

/** Le texte d'un champ, ou "" : un objet ou un tableau ne fait pas échouer la conversion. */
export const texteSur = (champ         ) => ({ $convert: { input: champ, to: "string", onError: "", onNull: "" } });

/** Un numéro de fiche : son texte, sinon nul (un numéro d'un autre type n'est pas un numéro). */
export const numeroTexteOuNul = (champ        ) => ({ $cond: [{ $eq: [{ $type: champ }, "string"] }, champ, null] });
