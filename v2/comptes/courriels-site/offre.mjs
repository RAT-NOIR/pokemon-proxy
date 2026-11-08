/**
 * L'OFFRE — LA SOURCE UNIQUE (lot « source unique de l'offre », point 2 de l'audit du 2026-11-07) : « UNE source de vérité, une
 * configuration lue par toutes les pages, alignée sur Tarifs et l'API. » Chaque chiffre de l'offre, chaque phrase qui le porte et
 * que plusieurs pages partagent, est écrit ICI et nulle part ailleurs (lib/offre.test.ts le tient, avec son témoin ; sur les pages
 * servies : scripts/verifier-offre.mjs).
 *
 * POURQUOI UN MODULE À PART, et pas lib/tarifs.ts étendu : Tarifs est une page CACHÉE (lib/pagesCachees.test.ts range `lib/tarifs*`
 * dans sa famille) qui ne décrit que la v2 ; l'offre a DEUX états, lus par des pages publiques (accueil, FAQ, CGU, CGV, politique)
 * comme cachées (scanner, inscription, compte, Tarifs). Ce module est PUR — aucun import, ni drapeau ni environnement : il peut
 * entrer dans un composant client sans rien y tirer. lib/tarifs.ts en REPREND les quotas (mêmes noms qu'avant).
 *
 * LES DEUX ÉTATS, choisis par l'interrupteur EXISTANT (`COMPTES_LANCES`, lib/promesse.ts — jamais un second drapeau) :
 *   · `servie` — ce que fait la 1.0.5 publiée, régie par l'ancienne API : des analyses offertes à l'installation, puis un quota
 *     hebdomadaire, sans compte. C'est ce que le site public dit tant que `LANCEMENT_VALIDE` est faux.
 *   · `v2` — l'entrée de l'API du 2026-11-07 (DEMANDE-SERVEUR-SITE.md, « QUOTAS DÉFINITIFS », défauts du code de l'API v2) :
 *     3 analyses par jour sans compte, 10 avec un compte gratuit à l'adresse confirmée (0 tant qu'elle ne l'est pas), remise à zéro
 *     au minuit de Paris, un lot de N cartes = ⌈N/10⌉ analyses et 20 cartes au plus, les analyses sans résultat rendues dans la
 *     limite de plafonds quotidiens, Pro sans quota montré (l'offre réservée a celui de Pro : lib/tarifs.ts, sa page seule le dit).
 * Le plafond technique de Pro (200 par jour pour l'API) : confirmé par l'éditeur le 2026-11-08, écrit aux CGV SEULEMENT (`PLAFOND_PRO_CGV`) ;
 * toute autre page dit « usage raisonnable » sans nombre, et aucune ne dit « illimité » (écart 1 de l'API).
 */

/** L'offre de la 1.0.5 publiée (servie aujourd'hui). */
export const OFFRE_SERVIE = {
  /** Les analyses offertes à l'installation de l'extension (le premier écran de l'accueil, la FAQ, les garanties). */
  analysesOffertes: 25,
  /** Ce qui vient après elles. */
  quota: "quota hebdomadaire",
}         ;

/** L'offre de la v2 (préparée) — les défauts du code de l'API, entrée du 2026-11-07. */
export const OFFRE_V2 = {
  /** Analyses par jour sans compte (installation non liée). */
  sansCompte: 3,
  /** Analyses par jour avec un compte gratuit, adresse e-mail confirmée. */
  compteGratuit: 10,
  /** Jour civil de Paris : remise à zéro au prochain minuit de Paris. */
  remiseAZero: "chaque jour à minuit, heure de Paris",
  /** Un lot de N cartes coûte ⌈N/10⌉ analyses ; 20 cartes au plus par lot. */
  lot: { cartesParAnalyse: 10, cartesMax: 20 },
}         ;

                                        

/** L'état affiché : `lances` est `COMPTES_LANCES` (lib/promesse.ts), lu par l'appelant — ce module ne lit aucun drapeau. */
export const etatOffre = (lances         )            => (lances ? "v2" : "servie");

/**
 * TRANCHÉ par l'éditeur le 2026-11-08 (écart 3 de l'API) : « au lancement » accolé aux 10 analyses par jour du compte gratuit est RETIRÉ
 * (le 10 est le chiffre DÉFINITIF côté API). `false` : FAQ, CGU, CGV, politique, scanner, inscription, installer, compte ne le disent plus.
 * Gardée comme UNE ligne de retour en arrière (`true` le rend à tous ces passages) — une constante de TEXTE, pas un interrupteur.
 * ⛔ Tarifs et le bloc « accès » de l'accueil ne la lisent PAS : allumés, ils ne disent jamais « au lancement » (on ne promet pas ce qui
 * est lancé — tour 1 du 2026-10-31) ; éteint, Tarifs garde « avec un compte gratuit, au lancement » (= « quand les comptes ouvriront »).
 */
export const DIRE_AU_LANCEMENT = false;

/** « , au lancement » / « au lancement » après `avant`, ou rien si l'éditeur l'a retiré. */
export const auLancement = (avant        )         => (DIRE_AU_LANCEMENT ? `${avant}au lancement` : "");

/** Écart 4 de l'API : la phrase qu'elle propose, mot pour mot (guillemets français, insécables). FAQ et Tarifs de la v2. */
export const REMBOURSEMENT =
  "Une analyse qui ne livre rien (carte introuvable, panne, ou réponse «\u00a0aucune carte ne correspond\u00a0») est rendue au compteur du jour, dans la limite de plafonds quotidiens anti-abus.";

/** Écart 5 : le coût d'une photo à plusieurs cartes (⌈N/10⌉ : une tranche ENTAMÉE compte, 20 au plus). Scanner de la v2. */
export const COUT_D_UN_LOT = `un lot de cartes compte une analyse par tranche de ${OFFRE_V2.lot.cartesParAnalyse}\u00a0cartes entamée, ${OFFRE_V2.lot.cartesMax}\u00a0cartes au plus`;

/** Le plafond technique de Pro, par jour (API) : tranché par l'éditeur le 2026-11-08 ; seules les CGV l'écrivent, par `PLAFOND_PRO_CGV`. */
export const PLAFOND_PRO_JOUR = 200;

/**
 * Écart 1, tranché le 2026-11-08 : l'usage raisonnable de Pro, défini aux CGV de lancement (art. 3), nomme son plafond — phrase validée par
 * l'éditeur. Sans « illimité » : l'API refuse au-delà du plafond du jour (refus « quota »), elle ne ralentit pas. ⛔ Tarifs et les pages
 * publiques disent « usage raisonnable » SANS nombre ; le nombre n'est lu que par cette phrase (lib/offre.test.ts).
 */
export const PLAFOND_PRO_CGV = `Au-delà d’un plafond de ${PLAFOND_PRO_JOUR}\u00a0analyses par jour, fixé pour prévenir les abus, les analyses sont refusées jusqu’au minuit suivant, heure de Paris.`;

/** A1 : ce que Tarifs allumé dit à côté de l'offre « sans compte » (qui est celle de l'extension) : le scanner web demande un compte. */
export const SCANNER_WEB_COMPTE_GRATUIT = "Le scanner web demande un compte gratuit.";

/** Écart 7 : un compte non confirmé n'a aucune analyse (refus « VERIFICATION ») ; l'inscription le répète. */
export const CONFIRMATION_OUVRE_LES_ANALYSES = "Les analyses du compte s’ouvrent quand l’adresse e\u2011mail est confirmée.";

/** Le coût d'une photo, une carte ou un lot de 10 au plus (le scanner le dit sous la zone de dépôt et sur la facture d'un lot). */
export const UNE_ANALYSE_PAR_LOT = `1 analyse jusqu’à ${OFFRE_V2.lot.cartesParAnalyse} cartes`;

/**
 * LA SONDE (lib/offre.test.ts, scripts/verifier-offre.mjs) : les CHIFFRES DE L'OFFRE d'un texte — un nombre accolé à « analyse(s) »
 * ou « scan(s) », un nombre « par jour » / « /jour » / « par semaine », « hebdomadaire », la taille d'un lot. Insécables (entité,
 * échappement, caractère, `&#xA0;` / `&#160;`) lus comme des espaces ; nombres en chiffres OU en lettres (deux à vingt-cinq).
 * « 1 analyse », « une analyse » n'en sont pas : c'est l'UNITÉ (« Analyser · 1 analyse », ce que coûte une réponse), pas un quota.
 * Rend les morceaux trouvés (vide : aucun).
 */
const EN_LETTRES =
  "(?:deux|trois|quatre|cinq|six|sept|huit|neuf|dix(?:-(?:sept|huit|neuf))?|onze|douze|treize|quatorze|quinze|seize|vingt(?:-(?:et-un|deux|trois|quatre|cinq))?)";
const EN_LETTRES_DEVANT = new RegExp(`(?<![\\p{L}-])${EN_LETTRES}\\s+(?:analyses?|scans?|par\\s+(?:jour|semaine))\\b`, "giu");

export function chiffresDeLOffre(texte        )           {
  const t = texte.replace(/&nbsp;|&#0*160;|&#x0*a0;|\\u00a0|\\xa0|[\u00a0\u202f]/gi, " ");
  const motifs = [
    /\b(?!1\b)\d+\s*(?:analyses?|scans?)\b/gi,
    /\b\d+\s*(?:\/\s*jour|par\s+(?:jour|semaine))\b/gi,
    EN_LETTRES_DEVANT,
    /hebdomadaire/gi,
    /tranche\s+de\s+\d+\s*cartes|\b\d+\s*cartes\s+au\s+plus|jusqu.à\s+\d+\s*cartes/gi,
  ];
  return motifs.flatMap((m) => [...t.matchAll(m)].map((r) => r[0]));
}
