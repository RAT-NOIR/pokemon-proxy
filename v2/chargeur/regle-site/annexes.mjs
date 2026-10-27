import annexes from "./annexes.json" with { type: "json" };
import { texteSur } from "./expressionsSures.mjs";
import { conditionImpressionMongo } from "./impressionDuSet.mjs";

/**
 * LES IMPRESSIONS ANNEXES (2026-10-27, règle b de l'éditeur) — les « Yellow A » : numéros 124a, XY67a…, déclarés sous une
 * expansion qu'aucun set ne porte (« Yellow A Alternate cards »). Chacune est une VARIANTE de la carte de même numéro sans sa
 * lettre, et prend sa fiche dans le set de cette carte (124a-enhanced-hammer dans Guardians Rising : une adresse stable, celle
 * de son numéro). La liste est FERMÉE, écrite depuis la base par scripts/generer-annexes.mjs : carte, numéro, expansion parente.
 * Un parent ambigu n'est pas deviné (écartées, avec la raison). `impressionDuSet` (copié par l'API, vérifié par empreinte) ne
 * change pas : cette règle vient À CÔTÉ, en TypeScript (`annexeDuSet`) comme dans Mongo (`conditionAnnexeMongo`).
 */
                  
                  
                 
                        
                          
                 
 

const ENTREES                    = (annexes                         ).entrees;

const cle = (carteId        , numero        ) => `${carteId}|${numero}`;
const PARENT_PAR_CLE                              = new Map(ENTREES.map((a) => [cle(a.carteId, a.numero), a]));

/** Une impression annexe de ce document appartient-elle à ce set (son tirage, et son parent parmi ses expansions) ? */
export function annexeDuSet(
  imp                                                             ,
  carteId        ,
  cible                                                                        ,
)          {
  if (typeof imp.numero !== "string" || typeof imp.expansion !== "string") return false;
  const a = PARENT_PAR_CLE.get(cle(carteId, imp.numero));
  return !!a && a.expansionAnnexe === imp.expansion && a.tirage === imp.tirage && a.tirage === cible.tirage && cible.expansions.includes(a.parent);
}

/** Les clés « carte|numéro » des annexes d'un set : la liste littérale que reçoit une agrégation. */
export function clesAnnexes(tirage        , expansions                   )           {
  return ENTREES.filter((a) => a.tirage === tirage && expansions.includes(a.parent)).map((a) => cle(a.carteId, a.numero));
}

/** Les expansions annexes (pour les listes, qui présélectionnent les impressions par « tirage|expansion »). */
export const EXPANSIONS_ANNEXES                    = (annexes                            ).expansions;

/**
 * La même règle dans une agrégation : `imp` est l'impression (`$$i`), `cles` une liste littérale (ou une expression qui en
 * rend une) de clés « carte|numéro ». L'identifiant du document est `$_id`, lisible dans un `$filter`.
 */
export function conditionAnnexeMongo(imp        , cles         )          {
  const idTexte = texteSur("$_id");
  const numeroTexte = texteSur(`${imp}.numero`);
  return {
    $and: [
      { $in: [{ $ifNull: [`${imp}.expansion`, null] }, { $literal: EXPANSIONS_ANNEXES }] },
      { $eq: [{ $type: `${imp}.numero` }, "string"] },
      // Numéro tel qu'écrit (le générateur l'a lu sans espace autour ; un espace de plus ne correspond à rien : refus, jamais deviné).
      { $in: [{ $concat: [idTexte, "|", numeroTexte] }, cles] },
    ],
  };
}

/**
 * Les impressions du set PUIS ses annexes (relecture du lot, I1) : le rang d'une fiche vient de l'ordre du tableau — une annexe
 * écrite avant sa carte (« 124a » avant « 124 ») deviendrait sinon la PRINCIPALE (recherche, espèces, « autres apparitions »).
 */
export function impressionsEtAnnexes                                                                       (
  imps              ,
  carteId        ,
  cible                                                              ,
  duSet                     ,
)      {
  return [...imps.filter(duSet), ...imps.filter((i) => !duSet(i) && annexeDuSet(i, carteId, cible))];
}

/** La même chose dans une agrégation : les impressions du set (`$filter` garde l'ordre), PUIS les annexes. */
export function impressionsEtAnnexesMongo(input         , region         , expansions         , decks                , cles         )          {
  return {
    $concatArrays: [
      { $filter: { input, as: "i", cond: conditionImpressionMongo("$$i", region, expansions, decks) } },
      { $filter: { input, as: "i", cond: conditionAnnexeMongo("$$i", cles) } },
    ],
  };
}

/** L'impression est DU set (lib/impressionDuSet.ts) OU une de ses annexes : la condition que lisent toutes les agrégations. */
export function conditionImpressionOuAnnexeMongo(imp        , region         , expansions         , decks                , cles         )          {
  return { $or: [conditionImpressionMongo(imp, region, expansions, decks), conditionAnnexeMongo(imp, cles)] };
}

/** Pour des sets en tableaux parallèles (après `$unwind: "$sets"`) : la liste des clés annexes de chacun. */
export function clesAnnexesParSet(regions                   , expansions                                )             {
  return regions.map((r, i) => clesAnnexes(r, expansions[i] ?? []));
}

/** L'empreinte d'une liste de clés (FNV-1a 32 bits, en base 36) : elle entre dans la clé de cache des entrées du set. */
export function empreinteAnnexes(cles                   )         {
  let h = 0x811c9dc5;
  for (const c of [...cles].sort().join(",")) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}