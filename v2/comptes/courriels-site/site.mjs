/**
 * Source unique de vérité pour tout ce qui est susceptible de changer.
 * Ne jamais redupliquer ces valeurs dans les composants.
 */
import { ADRESSE_INSTALLER } from "./extension.mjs";
import { ADRESSE_TARIFS } from "./tarifs.mjs";

export const SITE = {
  name: "Rat-Market",
  tagline: "Flaire la bonne affaire.",
  description:
    "L’extension Chrome qui identifie les cartes Pokémon sur Vinted et compare instantanément leur prix à Cardmarket.",
  url: "https://rat-market.fr",
  contactEmail: "ratmarket.contact@gmail.com",
}         ;

/**
 * LA fiche du Chrome Web Store — la SEULE adresse du Store dans tout le code (décision 7 de l'éditeur, 2026-10-18 : la v2 est une mise à jour
 * de la MÊME fiche que la 1.0.5). Lue par la page Installer (`/fr/installer`) et, drapeau éteint, par les boutons (`lienBoutonInstaller`).
 */
export const CHROME_STORE_URL =
  "https://chromewebstore.google.com/detail/rat-market/fgibgdgmadfejkaapeohbhaoolhgpkhb?hl=fr";

// Les chiffres de l'offre (analyses offertes de la 1.0.5, quotas du jour de la v2) ne vivent plus ici : lib/offre.ts, la source
// unique (lot « source unique de l'offre », 2026-11-07).

/**
 * Informations légales de l’éditeur.
 * Reprises telles quelles par les mentions légales et la politique de
 * confidentialité : une seule identité pour tout le site.
 */
export const EDITEUR = {
  nom: "Revol Quentin",
  /** Nom + mention « EI » : à utiliser partout où l’éditeur est nommé seul. */
  nomComplet: "Revol Quentin (EI)",
  adresse: "62 cours Jean Jaurès, 38000 Grenoble",
  /** Numéro d’immatriculation au RCS (9 chiffres, identique au SIREN). */
  rcs: "108 064 676",
}         ;

/** Date affichée en tête des pages juridiques. */
export const MISE_A_JOUR_JURIDIQUE = "15 août 2026";
/**
 * « Dernière mise à jour » de la version v2 des CGU (2026-10-17 : la clause des licences ne nomme plus une source d'images). Les CGU
 * servies aujourd'hui, les CGV et la politique gardent la date commune : l'archive des CGV d'aujourd'hui ne bouge pas. Les mentions
 * légales ont la leur (`MISE_A_JOUR_MENTIONS`).
 */
export const MISE_A_JOUR_CGU = "17 octobre 2026";
/** « Dernière mise à jour » de /fr/sources (2026-10-17 : la section « Images » ne nomme plus de source ; un texte modifié, une date modifiée). */
export const MISE_A_JOUR_SOURCES = "17 octobre 2026";
/**
 * « Dernière mise à jour » des mentions légales : 2026-10-17, la provenance des logos ne nomme plus de source (relecture de
 * l'intégration, M4) ; 2026-10-18, la notice MIT de TCGdex, seule source dont la licence exige l'attribution (lib/licencesSources.ts).
 */
export const MISE_A_JOUR_MENTIONS = "18 octobre 2026";

/**
 * LA navigation du site — la pilule de l'en-tête ET le pied de page lisent
 * cette liste : les mêmes liens, dans le même ordre, aux deux bouts de la page.
 *
 * Ancres préfixées par « / » : l'en-tête et le pied sont communs à toutes les
 * pages, pas seulement à l'accueil où vivent ces ancres. Sans le « / », un
 * clic depuis /fr/sets/… cherche l'ancre sur la page courante et ne mène nulle
 * part — c'était le cas du pied de page jusqu'au 2026-09-21.
 *
 * `actif` : le préfixe de chemin qui allume le lien dans la pilule. Une ancre
 * n'en a pas — elle s'allume quand SA section est à l'écran (NavPilule).
 */
export const LIENS_PRINCIPAUX = [
  { href: "/#fonctionnement", label: "Fonctionnement", ancre: "fonctionnement" },
  { href: "/#faq", label: "FAQ", ancre: "faq" },
  { href: "/fr/sets", label: "Catalogue", actif: "/fr/sets" },
  // Les 1 025 pages d'espèce n'avaient AUCUN lien depuis une page elle-même
  // liée. Un sitemap dit qu'une page existe ; un lien dit qu'elle compte.
  { href: "/fr/pokemon", label: "Pokémon", actif: "/fr/pokemon" },
]         ;

/** Un lien de la navigation : une page (`actif`, préfixe) ou une ancre de l'accueil (`ancre`). */
                                                                                                                                          

/**
 * LA NAVIGATION SELON LE LANCEMENT (lot L1, 2026-10-18). Éteint (`lances` faux, la production d'aujourd'hui) : exactement
 * `LIENS_PRINCIPAUX`. Allumé : un cinquième lien « Tarifs ». Fonction PURE — le drapeau (`COMPTES_LANCES`, lib/promesse.ts) est
 * lu par lib/navigation.ts, côté serveur, et la liste passée au composant client (`process.env` n'y est pas inliné).
 */
export function liensPrincipaux(lances         )                           {
  return lances ? [...LIENS_PRINCIPAUX, { href: ADRESSE_TARIFS, label: "Tarifs", actif: ADRESSE_TARIFS }] : LIENS_PRINCIPAUX;
}

/**
 * OÙ MÈNENT LES BOUTONS « AJOUTER À CHROME » / « INSTALLER » (lot L5, décision 8 de l'éditeur, 2026-10-18). Éteint (`lances` faux, la
 * production d'aujourd'hui) : la fiche du Store, en nouvel onglet, comme avant — la page Installer répond 404. Allumé : la page Installer, un
 * lien INTERNE (sans nouvel onglet), et c'est elle seule qui porte le lien vers le Store. Fonction PURE ; le drapeau est lu côté serveur
 * (lib/navigation.ts, `LIEN_INSTALLER`) : `process.env` n'est pas inliné dans un composant client.
 */
export function lienBoutonInstaller(lances         )                                     {
  return lances ? { href: ADRESSE_INSTALLER, interne: true } : { href: CHROME_STORE_URL, interne: false };
}

/** Le second rang du pied de page : le juridique. */
export const NAV_LINKS = [
  { href: "/mentions-legales", label: "Mentions légales" },
  { href: "/cgv", label: "CGV" },
  { href: "/cgu", label: "CGU" },
  { href: "/politique-confidentialite", label: "Confidentialité" },
]         ;
