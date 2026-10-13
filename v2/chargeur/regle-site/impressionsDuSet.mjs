import { tableauOuVide, texteSur } from "./expressionsSures.mjs";
import { normaliserNumero,                     } from "./imageDeLImpression.mjs";

/**
 * UNE FICHE PAR IMPRESSION — la règle, testée avant d'être allumée.
 *
 * Aujourd'hui : une fiche = un document de carte × un set, PREMIÈRE impression
 * seulement. 5 915 cartes que la base contient n'ont donc ni page ni URL, dont
 * 82 % de secrètes (scripts/mesurer-impressions-cachees.mjs). Demain : une
 * fiche par NUMÉRO distinct imprimé dans le set.
 *
 * ── CE QUI DÉCIDE : l'AMBIGUÏTÉ, pas la couverture ─────────────────────────
 * Une fiche sans visuel n'est pas un problème — le site en a déjà 17 000, et
 * elles sont honnêtes. Le problème est une image qu'on ne sait pas ATTRIBUER :
 * un document à trois impressions et une image SANS `numero`, c'est une image
 * dont on ignore laquelle des trois cartes elle montre. La garde est donc :
 *
 *   un document est AMBIGU s'il a plusieurs impressions dans le set ET qu'une
 *   de ses images pour ce set ne porte pas de `numero`.
 *
 * Et elle joue PAR SET, tout ou rien : un set ne passe « par impression » que
 * si AUCUN de ses documents n'est ambigu. Sinon on afficherait la secrète
 * n° 199 mais pas la n° 183, et une numérotation à trous se lit comme une
 * collecte ratée.
 *
 * ── POURQUOI UN INTERRUPTEUR, alors que les logos s'activent seuls ─────────
 * Parce que le champ est DÉJÀ arrivé. Mesuré le 2026-09-21 : 113 sets sur 263
 * passent la garde, soit 2 720 nouvelles fiches. Sans interrupteur, elles
 * seraient publiées par le prochain déploiement — 2 720 URL, leur entrée au
 * sitemap, des comptes qui changent sur 113 pages — comme un effet de bord.
 * Un logo qui s'allume ne crée pas d'URL ; ceci, si. C'est une décision
 * d'éditeur : `FICHES_PAR_IMPRESSION` passe à `true` quand il le dit, et à
 * partir de là chaque set s'active SEUL dès que le serveur a numéroté ses
 * images — sans plus toucher au code.
 *
 * ── LES URL EXISTANTES NE BOUGENT PAS ──────────────────────────────────────
 * Simulé sur toute la base (scripts/simuler-fiche-par-impression.mjs) : 0 des
 * 41 650 slugs actuels ne change, 0 des nouveaux n'en heurte un. La première
 * impression reste la PRINCIPALE (`rang` 0) : elle garde son slug, son image,
 * et c'est elle que désignent la recherche, les pages d'espèce et « autres
 * apparitions ». `ordonnerEtSlugger` sert les principales d'abord.
 *
 * ── LEVÉ LE 2026-09-21, sur décision de l'éditeur ──────────────────────────
 * Après : le nouveau sitemap vérifié en production (cinq fichiers à froid en
 * 105–483 ms), les comptes branchés sur les fiches (tuile = page = sitemap),
 * 0 collision de slug et 0 écart entre les deux écritures de la règle. Ce jour-
 * là : 120 sets prêts, 2 853 fiches de plus — le serveur venait de reporter
 * `numero` sur les images, et le chiffre continue de monter SEUL.
 * ⛔ Le rebaisser RETIRE des URL publiées et indexées : ce n'est pas un retour
 * en arrière anodin, c'est 2 853 pages qui passent en 404.
 */
export const FICHES_PAR_IMPRESSION = true;

/**
 * L'état de l'interrupteur, pour les CLÉS de cache. Le catalogue, les entrées
 * d'un set et les tranches du sitemap dépendent tous de lui ; le Data Cache
 * survit aux déploiements. Sans ce suffixe, lever l'interrupteur servirait
 * encore, pendant des heures, des comptes et des slugs « par document » — et
 * il faudrait penser à changer trois clés à la main le jour J.
 */
export const CLE_FICHES = FICHES_PAR_IMPRESSION ? "par-impression" : "par-document";

                                  
                         
                        
                         
                                                                                                  
                               
 

                                  
                                                                                 
               
                        
                       
                        
                              
 

/**
 * Les fiches possibles d'un document dans un set : une par NUMÉRO distinct,
 * dans l'ordre de la base. Deux impressions au même numéro ne sont pas deux
 * cartes — mesuré : 31 doublons stricts et 40 qui ne diffèrent que par `deck`.
 * « 006 » et « 6 » sont le même numéro. Aucune impression : une fiche quand
 * même, sans numéro — c'est l'état d'aujourd'hui.
 */
export function fichesDuDocument(impressions                            )                    {
  const vues = new Set        ();
  const fiches                    = [];
  for (const i of impressions) {
    const cle = normaliserNumero(i.numero) ?? "";
    if (vues.has(cle)) continue;
    vues.add(cle);
    fiches.push({ rang: fiches.length, numero: i.numero ?? null, total: i.total ?? null, rarete: i.rarete ?? null, illustrateur: i.illustrateur ?? null });
  }
  return fiches.length ? fiches : [{ rang: 0, numero: null, total: null, rarete: null, illustrateur: null }];
}

/** Plusieurs impressions ET une image qu'on ne sait pas attribuer. */
export function documentAmbigu(fiches                            , images                           )          {
  return fiches.length > 1 && images.some((m) => normaliserNumero(m.numero) === null);
}

/**
 * LA MÊME RÈGLE, EN EXPRESSIONS MONGO — pour COMPTER les fiches de tous les
 * sets sans sortir une carte de la base.
 *
 * Pourquoi une seconde écriture d'une règle déjà écrite en TypeScript : le
 * cluster est bridé en DÉBIT (~85 à 143 Ko/s, et la compression du protocole
 * n'y change rien — scripts/mesurer-compression-mongo.mjs). Compter en
 * JavaScript demande de rapatrier toutes les impressions : ~85 s. Compter dans
 * Mongo ne sort qu'une ligne par set. Le catalogue a besoin de ces comptes
 * (tuiles, pagination, découpage du sitemap), et il ne peut pas attendre 85 s.
 *
 * ⚠️ DEUX COPIES d'une règle divergent un jour. Celle-ci est donc CONTRÔLÉE
 * contre l'autre sur toute la base : scripts/verifier-comptes-fiches.mjs
 * compare, set par set, ce que Mongo compte à ce que `fichesDuDocument` et
 * `documentAmbigu` comptent. À relancer après toute retouche de l'une ou de
 * l'autre.
 *
 * S'applique APRÈS un `$unwind: "$sets"` : `$sets` est alors le slug d'UN set.
 * Les trois tableaux sont parallèles (même indice = même set).
 */
/** normaliserNumero en Mongo : « 006 », « 6 » et 6 sont le même numéro ; sans numéro → "". */
const normalise = (champ        ) => ({
  $let: {
    vars: { s: { $toUpper: { $trim: { input: texteSur(champ) } } } },
    in: {
      $cond: [
        { $regexMatch: { input: "$$s", regex: "^0+[0-9]" } },
        { $ltrim: { input: "$$s", chars: "0" } },
        "$$s",
      ],
    },
  },
});

/** Après `$unwind: "$sets"` : la région et les expansions du set courant, par les trois tableaux parallèles. */
function expressionsDuSetCourant(
  slugs                   ,
  regions                   ,
  expansions                                ,
) {
  const indice = { $indexOfArray: [{ $literal: slugs }, "$sets"] };
  return {
    region: { $arrayElemAt: [{ $literal: regions }, indice] },
    expansionsDuSet: { $arrayElemAt: [{ $literal: expansions }, indice] },
  };
}

/**
 * LES LIGNES PAR ILLUSTRATEUR, en étapes d'agrégation — après `$unwind: "$sets"`.
 * Une ligne = une FICHE (document × set × numéro distinct) dont l'impression
 * porte cet illustrateur : la même unité que `getLignesParIllustrateur`, qui
 * pagine les pages /fr/illustrateurs/…, et que le sitemap compte. Deux
 * impressions au même numéro (les doublons de deck) ne font qu'une ligne.
 * Contrôlé contre l'écriture TypeScript par scripts/verifier-illustrateurs.mjs
 * (le nombre de pages de la page servie contre le compte de la base).
 */
export function etapesLignesParIllustrateur(
  slugs                   ,
  regions                   ,
  expansions                                ,
) {
  const { region, expansionsDuSet } = expressionsDuSetCourant(slugs, regions, expansions);
  return [
    { $unwind: "$impressions" },
    {
      $match: {
        $expr: {
          $and: [
            { $eq: ["$impressions.tirage", region] },
            { $in: ["$impressions.expansion", expansionsDuSet] },
            { $eq: [{ $type: "$impressions.illustrateur" }, "string"] },
            { $ne: ["$impressions.illustrateur", ""] },
          ],
        },
      },
    },
    // Une fiche par numéro distinct : le PREMIER illustrateur au numéro,
    // comme fichesDuDocument garde la première impression au numéro.
    { $group: { _id: { set: "$sets", doc: "$_id", numero: normalise("$impressions.numero") }, illustrateur: { $first: "$impressions.illustrateur" } } },
    { $group: { _id: "$illustrateur", n: { $sum: 1 } } },
  ];
}

export function expressionsFichesParSet(
  slugs                   ,
  regions                   ,
  expansions                                ,
) {
  const { region, expansionsDuSet } = expressionsDuSetCourant(slugs, regions, expansions);
  const numeros = {
    $setUnion: [
      {
        $map: {
          input: {
            $filter: {
              input: tableauOuVide("$impressions"),
              as: "i",
              cond: {
                $and: [{ $eq: ["$$i.tirage", region] }, { $in: ["$$i.expansion", expansionsDuSet] }],
              },
            },
          },
          as: "i",
          in: normalise("$$i.numero"),
        },
      },
    ],
  };
  const imagesSansNumero = {
    $filter: {
      input: tableauOuVide("$images"),
      as: "m",
      cond: {
        $and: [
          { $eq: ["$$m.set", "$sets"] },
          { $eq: [normalise("$$m.numero"), ""] },
        ],
      },
    },
  };
  return {
    /** Le nombre de fiches que ce document donnerait dans ce set (au moins une). */
    fiches: { $max: [1, { $size: numeros }] },
    /** documentAmbigu : plusieurs numéros ET une image qu'on ne sait pas attribuer. */
    ambigu: { $and: [{ $gt: [{ $size: numeros }, 1] }, { $gt: [{ $size: imagesSansNumero }, 0] }] },
  };
}

/** Le compte à AFFICHER pour un set : ses fiches s'il passe par impression, ses documents sinon. */
export function compteDuSet(
  ligne                                                        ,
  actif          = FICHES_PAR_IMPRESSION,
)         {
  return actif && ligne.ambigus === 0 ? ligne.fiches : ligne.documents;
}

/**
 * Ce set s'affiche-t-il par impression ? Tout ou rien, et seulement si
 * l'interrupteur est levé. `actif` est un paramètre pour que la règle se teste
 * dans les deux états sans toucher à la constante.
 */
export function setParImpression(
  documents                                                                                      ,
  actif          = FICHES_PAR_IMPRESSION,
)          {
  return actif && documents.every((d) => !documentAmbigu(d.fiches, d.images));
}
