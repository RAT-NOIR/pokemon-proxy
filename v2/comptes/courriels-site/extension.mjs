/**
 * L'INSTALLATION DE L'EXTENSION V2 — PRÉPARÉE, PAS PUBLIÉE (lot L3, 2026-10-18). Tout ce que la page `/fr/installer` et les
 * emplacements des visuels de la v2 ont besoin de savoir vit ICI, et rien n'est servi tant que `COMPTES_LANCES` (lib/promesse.ts) est
 * éteint : la page répond 404, l'accueil garde sa vidéo et son image de la 1.0.5.
 *
 * CE QUE L'ALLUMAGE EXIGE (lib/installer.test.ts le refuse sinon) :
 *   1. les fichiers de `FICHIERS_V2` dans `public/` (la vidéo en mp4 H.264 ET webm, son image d'attente, les captures), puis
 *      `VISUELS_V2_PRETS = true` ;
 *   2. la durée de conservation des photos confirmée par l'API dans son contrat (`PHOTOS_DEUX_MINUTES_CONFIRMEES`, plus bas).
 *
 * LE LIEN DU STORE (lot L5, décision 7 de l'éditeur, 2026-10-18) : la v2 est une mise à jour de la MÊME fiche que la 1.0.5. L'adresse est
 * `CHROME_STORE_URL` (lib/site.ts), UNE SEULE FOIS dans tout le code : l'ancienne constante factice de la v2 est supprimée, avec ses gardes
 * d'allumage (un lien factice ne peut plus bloquer l'allumage, ni être servi). lib/installer.test.ts exige qu'un seul fichier la porte.
 */
export const ADRESSE_INSTALLER = "/fr/installer";

/** Une vraie adresse de fiche du Chrome Web Store : « https », l'hôte du Store, `/detail/<nom>/<identifiant de 32 lettres a-p>`. */
export function lienStoreValide(url        )          {
  const m = /^https:\/\/chromewebstore\.google\.com\/detail\/[a-z0-9-]+\/([a-p]{32})(\?[^\s#]*)?$/.exec(url);
  // Jamais un identifiant de remplissage : au moins huit lettres différentes (« aaaa… », « abab… » ne sont pas des identifiants du Store).
  return m !== null && new Set(m[1]).size >= 8;
}

/**
 * LA VIDÉO DE MOTION DESIGN DE LA V2 : des noms RÉSERVÉS, les fichiers n'existent pas encore (le montage est fait à part). Format
 * demandé : mp4 H.264 ET webm, une image d'attente, lecture muette en boucle (components/media/VideoDemo.tsx). Les dimensions de
 * l'image d'attente sont celles de la vidéo : l'emplacement les réserve, la page ne saute pas à l'arrivée du fichier.
 */
export const VIDEO_V2 = {
  mp4: "/videos/demo-v2.mp4",
  webm: "/videos/demo-v2.webm",
  poster: "/videos/demo-v2-poster.webp",
  /** 16:9, comme la vidéo de la 1.0.5 (1440 × 810). À CONFIRMER avec le montage. */
  largeur: 1440,
  hauteur: 810,
  alt: "Démonstration : Rat-Market analyse une annonce Vinted et affiche le verdict de prix.",
}         ;

/**
 * LES CAPTURES DE LA V2 : des EMPLACEMENTS (noms et dimensions réservés ; l'éditeur donnera son signal pour le kit de captures).
 * Les dimensions sont celles de l'image de la 1.0.5 qu'elles remplacent (898 × 1268) : À CONFIRMER à la livraison.
 */
export const CAPTURES_V2 = [
  {
    fichier: "/images/captures-v2/verdict.webp",
    largeur: 898,
    hauteur: 1268,
    alt: "La fiche Rat-Market affichée sur une annonce Vinted, avec le verdict d’achat de la carte identifiée.",
    legende: "Le verdict, sur l’annonce",
  },
  {
    fichier: "/images/captures-v2/quota.webp",
    largeur: 898,
    hauteur: 1268,
    alt: "Le panneau de l’extension avec l’offre et le nombre d’analyses restantes aujourd’hui.",
    legende: "L’offre et le quota du jour",
  },
]         ;

/** Poids maximal de l'image d'attente : sur /fr/installer elle est dans le premier écran et peut être le LCP (mesuré : un poster de 270 Ko ajoute ~500 ms au LCP de WebKit en 4G). */
export const POIDS_POSTER_MAX_OCTETS = 60_000;

/** Tout ce que l'allumage attend dans `public/`. */
export const FICHIERS_V2                    = [VIDEO_V2.mp4, VIDEO_V2.webm, VIDEO_V2.poster, ...CAPTURES_V2.map((c) => c.fichier)];

/**
 * VRAI quand les fichiers de `FICHIERS_V2` sont dans `public/` : l'emplacement montre alors la vidéo et les captures au lieu du cadre
 * « à venir ». Le test (lib/installer.test.ts) exige qu'il dise vrai EXACTEMENT quand tous les fichiers existent, et l'allumage du
 * lancement exige vrai. À lever par l'éditeur (ou à sa suite) quand il fournit le montage et les captures.
 */
export const VISUELS_V2_PRETS = false;

/**
 * LA FAQ DE L'INSTALLATION — « n'écris que ce que l'API fait VRAIMENT » (décisions 5 et 6 de l'éditeur, 2026-10-18).
 *
 * LES PHOTOS : la formulation visée est celle de l'éditeur, MOT POUR MOT — « La photo de l'annonce est analysée puis effacée en 2 minutes au
 * plus. Elle n'est jamais conservée. » Elle ne sera PUBLIÉE qu'une fois l'API l'aura confirmée dans son contrat (l'éditeur le lui demande).
 * D'ici là la ligne reste derrière le drapeau d'allumage — la page n'est servie qu'allumée, et l'allumage est REFUSÉ par un test tant que
 * `PHOTOS_DEUX_MINUTES_CONFIRMEES` est faux — avec un REPÈRE « à confirmer » visible (`REPERE_PHOTOS`, surligné sur la page d'aperçu). La
 * réponse « trois mois au plus » de la politique de confidentialité de la v2 n'est plus servie ici ; la politique, elle, dit encore « trois
 * mois » : levé, le repère disparaît et la politique doit dire la même chose (lib/installer.test.ts).
 */
export const PHOTOS_DEUX_MINUTES_CONFIRMEES = false;

export const REPONSE_PHOTOS = "La photo de l’annonce est analysée puis effacée en 2\u00a0minutes au plus. Elle n’est jamais conservée.";

/** Le repère « à confirmer » : tant que l'API n'a pas confirmé la durée, la réponse est servie AVEC lui. Levé, il disparaît. */
export function repereDesPhotos(confirmees         )                {
  return confirmees ? null : "à confirmer";
}
export const REPERE_PHOTOS = repereDesPhotos(PHOTOS_DEUX_MINUTES_CONFIRMEES);

/**
 * L'ÉTAT D'UNE CARTE : « L'état d'une carte n'est jamais repris du vendeur » — la phrase de l'éditeur. Elle ne revient dans la FAQ que le
 * jour où l'API la garantit par un test (l'éditeur le lui demande) : tant que `ETAT_NON_REPRIS_CONFIRME` est faux, NI la question NI la
 * réponse ne sont servies (ni la phrase de l'éditeur, ni « estimé à partir des photos »). L'allumage n'en dépend pas.
 * Ce que dit le code de l'extension (lecture seule) : à l'API partent le titre de l'annonce (expurgé), les photos et le prix, jamais la
 * description ni un champ « état » ; mais le titre peut contenir un mot d'état, et ni la politique de la v2 ni le code ne disent ce que le
 * serveur en fait. Question posée : DEMANDE-SERVEUR-SITE.md (entrées L3 et L5).
 */
export const ETAT_NON_REPRIS_CONFIRME = false;

export const QUESTION_ETAT_EDITEUR = "Reprenez-vous l’état annoncé par le vendeur\u00a0?";
export const REPONSE_ETAT_EDITEUR = "Non. L’état d’une carte n’est jamais repris du vendeur.";

                            
                   
                  
 
/** L'entrée de la FAQ sur l'état, ou `null` tant que l'API ne l'a pas garantie. */
export function faqEtat(confirme         )                   {
  return confirme ? { question: QUESTION_ETAT_EDITEUR, reponse: REPONSE_ETAT_EDITEUR } : null;
}
export const FAQ_ETAT = faqEtat(ETAT_NON_REPRIS_CONFIRME);

/**
 * Les fichiers de la v2 exigés à l'allumage : NON VIDES et de la bonne signature (mp4 : `ftyp` aux octets 4-7 ; webm : en-tête EBML
 * `1A 45 DF A3` ; webp : `RIFF` … `WEBP`). `existsSync` ne dit ni l'un ni l'autre. Les captures sont des webp.
 */
export function fichierV2Valide(chemin        , octets            )          {
  if (octets.length < 12) return false;
  const texte = (a        , b        ) => String.fromCharCode(...octets.slice(a, b));
  if (chemin.endsWith(".mp4")) return texte(4, 8) === "ftyp";
  if (chemin.endsWith(".webm")) return octets[0] === 0x1a && octets[1] === 0x45 && octets[2] === 0xdf && octets[3] === 0xa3;
  if (chemin.endsWith(".webp")) return texte(0, 4) === "RIFF" && texte(8, 12) === "WEBP";
  return false;
}