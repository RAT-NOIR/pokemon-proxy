/**
 * LES TARIFS — L'OFFRE VALIDÉE PAR L'ÉDITEUR LE 2026-10-17 (elle remplace celle du 2026-10-12 là où elle diffère).
 * « Sans compte 3 analyses/jour ; compte gratuit 10/jour au lancement ; Pro 4,99 €/mois ou 39 €/an (prix par état et par
 * langue, repérage dans Vinted, alertes de cote illimitées, historique et export, usage raisonnable), essai 14 jours sans
 * carte bancaire ; fondateurs 2,99 €/mois ou 29 €/an ; parrainage 1 mois de Pro. (Corrigé depuis : 100 places, prix garanti tant que
 * l'abonnement reste actif sans interruption — jamais « à vie », décision 5 du 2026-10-26.) Paiement Stripe plus
 * tard : bouton désactivé « bientôt ». »
 *
 * Ces chiffres sont des CONSTANTES : la page (app/fr/tarifs) n'écrit jamais un montant ni un quota en dur, tout montant
 * passe par `prixAffiche()`, tout quota par sa constante (lib/tarifs.test.ts le vérifie). Les constantes du site
 * (`SCANS_ACCUEIL`, `ANALYSES_SANS_COMPTE` de lib/site.ts : pages publiques et promesse préparée) ne sont PAS lues ici.
 *
 * La page est CACHÉE (`noindex`, aucun lien public, lib/pagesCachees.test.ts) et statique : `/fr/tarifs?depuis=extension`
 * (adresse ouverte par « Passer Pro » dans l'extension) répond directement et garde son paramètre. Aucun paiement.
 */
import { formaterMontant } from "./montants.mjs";

export const ADRESSE_TARIFS = "/fr/tarifs";

/** Analyses par jour, sans compte. */
export const ANALYSES_PAR_JOUR_SANS_COMPTE = 3;
/** Analyses par jour avec un compte gratuit — « au lancement » (le mot est de l'éditeur : la page le dit). */
export const ANALYSES_PAR_JOUR_COMPTE_GRATUIT = 10;

/** Rat-Market Pro, en euros (TVA non applicable, art. 293 B du CGI : CONTRAT-STRIPE-V2 §2 quinquies). */
export const PRO = { mensuel: 4.99, annuel: 39 }         ;
/** Jours d'essai de Pro. */
export const ESSAI_JOURS = 14;
/**
 * Jours d'essai d'un compte PARRAINÉ (lot L2) : « 30 jours d'essai pour vous, un mois offert pour votre parrain » — l'entrée de l'API du
 * 2026-10-18 (DEMANDE-SERVEUR-SITE.md). Le texte de la page de paiement lit cette constante, jamais un nombre écrit.
 */
export const ESSAI_JOURS_PARRAINAGE = 30;

/**
 * Lot L4 (2026-10-18) : jours avant la fin de l'essai où part le courriel de rappel (« fin d'essai proche, J−3 »), et jours pendant
 * lesquels Pro est MAINTENU après un premier paiement échoué (l'API : « l'impayé garde Pro 3 jours après le premier échec »,
 * DEMANDE-SERVEUR-SITE.md, entrée du 2026-10-18). Lus par lib/courriels.ts ; l'API reste seule à décider du calendrier.
 */
export const RAPPEL_FIN_ESSAI_JOURS = 3;
export const PRO_MAINTIEN_IMPAYE_JOURS = 3;

/**
 * Membres fondateurs : ces prix, garantis tant que l'abonnement reste actif sans interruption (jamais « à vie », décision du 2026-10-26). ⛔ DÉCISION DE L'ÉDITEUR (2026-10-18) : JAMAIS sur la page Tarifs publique. L'offre n'est lue que par
 * la page réservée `ADRESSE_FONDATEURS` (noindex, hors sitemap, liée de nulle part — lib/tarifsFondateurs.test.ts).
 * `places` : 100, décision de l'éditeur du 2026-10-18 (comme le contrat de l'API, `V2_FONDATEURS_PLACES`) ; la page réservée le lit ici.
 */
export const FONDATEURS = { places: 100, mensuel: 2.99, annuel: 29 }         ;

/** La page réservée aux Fondateurs (code ou lien fourni par l'API). Non indexée, absente du sitemap et de robots.txt, liée de nulle part. */
export const ADRESSE_FONDATEURS = "/fr/fondateurs";

/** Parrainage : mois de Pro offerts au parrain quand son filleul paie sa première échéance. */
export const PARRAINAGE_MOIS_PRO = 1;
/**
 * Parrainage : le plafond des mois offerts « jusqu'à 12 mois par an » (les mots de l'éditeur, 2026-10-18, sur les pages). La définition de
 * l'API est « sur 12 mois glissants » (DEMANDE-SERVEUR-SITE.md) : le brouillon des CGV l'écrit ainsi. Le contrat publié n'a pas encore de
 * plafond (« les avoirs s'additionnent ») : demandé à l'API.
 */
export const PARRAINAGE_PLAFOND_MOIS_PAR_AN = 12;

/**
 * L'essai SANS CARTE (décision de l'éditeur, 2026-10-18) : « 14 jours d'essai, sans carte bancaire ». Le même texte drapeau éteint et allumé.
 */
/**
 * L'essai SANS carte est-il confirmé par l'API ? Le CONTRAT est aligné depuis le 2026-10-19 (`CONTRAT-STRIPE-V2.md` §1 : « Essai de 14 jours
 * SANS CARTE », Checkout en `payment_method_collection=if_required`) ; reste FAUX jusqu'au parcours de bout en bout en Test (contrat §6 :
 * l'essai sans carte joué sur la vraie page de paiement, `verifier-paiement.mjs`) et aux courriels du lot L4 — sinon Tarifs, le compte et
 * l'accueil promettraient « sans carte bancaire » sur un Checkout jamais vu.
 * L'ALLUMAGE (`LANCEMENT_VALIDE`, lib/promesse.ts) est REFUSÉ par un test tant qu'elle est fausse (lib/tarifs.test.ts), comme pour
 * `PHOTOS_DEUX_MINUTES_CONFIRMEES`. À lever quand l'API a aligné son contrat ET son Checkout sur la décision de l'éditeur du 2026-10-18.
 */
export const ESSAI_SANS_CARTE_CONFIRME = false;

/** « sans carte bancaire » : les mots de l'éditeur, lus aussi par les courriels (lib/courriels.ts), dont la durée de l'essai vient des dates de l'API. */
export const SANS_CARTE_BANCAIRE = "sans carte bancaire";
export const ESSAI_SANS_CARTE = `${ESSAI_JOURS}\u00a0jours d’essai, ${SANS_CARTE_BANCAIRE}`;

/** Un essai par PERSONNE (décision 8 de l'éditeur, 2026-10-26, comme CONTRAT-STRIPE-V2 §1 : l'API le tient par l'adresse vérifiée et les installations). */
export const UN_SEUL_ESSAI = "Un seul essai par personne.";

/**
 * Ce qui se passe à la fin de l'essai, avec ce que l'API fait VRAIMENT : sans carte enregistrée, l'abonnement s'arrête, le compte
 * retrouve l'offre gratuite, aucun prélèvement ; un seul essai par compte (adresse vérifiée). Une carte AJOUTÉE pendant l'essai est
 * débitée à sa fin (décision de l'éditeur du 2026-10-18 nuit : ajouter sa carte, c'est choisir de continuer) : « sans prélèvement » ne vaut que
 * SANS carte, d'où « Sans carte enregistrée » ; la phrase du débit est dite dans la section « Votre abonnement » (lib/compteAbonnement.ts).
 */
export const FIN_D_ESSAI = `Sans carte enregistrée, le compte retrouve à la fin de l’essai l’offre gratuite (${ANALYSES_PAR_JOUR_COMPTE_GRATUIT}\u00a0analyses par jour), sans aucun prélèvement. ${UN_SEUL_ESSAI}`;

/** « un mois » pour 1 (les mots de l'éditeur : « un mois de Pro offert »), sinon « 2 mois » (espace insécable en échappement). */
export function moisAffiche(n        )         {
  return n === 1 ? "un mois" : `${n}\u00a0mois`;
}

/**
 * Ce que comprend Pro — exactement la liste du 2026-10-17. Le prix par état est le rôle de l'EXTENSION, qui le lit dans le
 * navigateur de l'utilisateur (décision du 2026-10-06, CLAUDE.md « LE PRIX DU SCANNER : LE GUIDE, JAMAIS L'ÉTAT »).
 */
export const AVANTAGES_PRO = [
  "Prix par état et par langue, dans l’extension",
  "Repérage dans Vinted",
  "Alertes de cote illimitées",
  "Historique et export",
]         ;

/** « 4,99 € » (espace insécable) ; `null` si le prix est invalide — la page n'invente jamais le reste. */
export function prixAffiche(prix               )                {
  if (prix === null || !Number.isFinite(prix) || prix < 0) return null;
  // Un prix rond s'écrit sans décimales (« 39 € », comme l'éditeur l'écrit), sinon avec deux (« 4,99 € », « 4,90 € »).
  const decimales = Number.isInteger(prix) ? 0 : 2;
  return formaterMontant(prix, decimales);
}

const auCentime = (v        ) => Math.round(v * 100) / 100;

/**
 * Ce que l'annuel fait gagner, CALCULÉ à partir des deux prix (lot C, 2026-10-26) : jamais écrit à la main, il suit les prix.
 * `euros` : 12 mois au prix mensuel moins le prix annuel ; `pourcent` : la même économie rapportée aux 12 mois, arrondie ;
 * `parMois` : le prix annuel ramené au mois.
 */
export function economieAnnuelle()                                                       {
  const douzeMois = PRO.mensuel * 12;
  const euros = auCentime(douzeMois - PRO.annuel);
  return { euros, pourcent: Math.round((euros / douzeMois) * 100), parMois: auCentime(PRO.annuel / 12) };
}

/**
 * LES TEXTES QUI DÉPENDENT D'UN LANCEMENT (tour 1 de l'étape 2, 2026-10-31) : la page Tarifs ne promet pas ce qui n'est pas lancé.
 * « au lancement » (le quota du compte gratuit) tombe quand les comptes sont lancés (`COMPTES_LANCES`, lib/promesse.ts) ; la Communauté
 * n'est nommée que si elle est visible (`COMMUNAUTE_VISIBLE`, lib/communaute.ts : le drapeau qui garde la galerie).
 */
export const libelleCompteGratuit = (comptesLances         )         => (comptesLances ? "avec un compte gratuit" : "avec un compte gratuit, au lancement");
export const ligneMaCollection = (communaute         )         =>
  communaute ? "Ma collection, l\u2019Atelier et la Communaut\u00e9, gratuits avec un compte" : "Ma collection et l\u2019Atelier, gratuits avec un compte";
export const ligneAtelier = (communaute         )         => (communaute ? "Atelier et Communaut\u00e9" : "Atelier");