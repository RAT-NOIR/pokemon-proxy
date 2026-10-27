/**
 * LA LANGUE D'UN VISUEL doit être celle du set qui l'affiche — jamais le scan
 * d'un autre tirage. C'est la règle la plus ancienne du catalogue, et sa sixième
 * occurrence du piège de l'homologue (après `nomEn`, `nomJa`, les dates, les
 * logos et le `fr`) : vu en ligne le 2026-09-23, Evolving Skies montrait les
 * scans JAPONAIS d'Eevee Heroes sur ses fiches.
 *
 * ── LA CAUSE, établie avant de corriger ─────────────────────────────────────
 * Ni le site, ni les clés : `images.set` était juste, la clé `bulbapedia/…`,
 * l'`urlOriginal` au nom anglais, le sha256 conforme — et 0 image artofpkm sur
 * un set intl dans toute la base. C'est la SOURCE : Bulbapedia publie le scan
 * de l'impression japonaise SOUS LE NOM DE FICHIER ANGLAIS tant que l'anglais
 * n'est pas scanné, et rien dans le wikitext ne le dit. Un fichier
 * « PinsirEvolvingSkies1.jpg » téléversé en mai 2021, jamais remplacé.
 *
 * Le site ne voit pas les pixels ; il ne peut refuser que ce qu'un champ lui
 * dit. D'où cette règle, écrite AVANT que le champ existe, comme pour les logos :
 *   · `images.langue` absent → on ne sait pas, on affiche (l'état d'avant) ;
 *   · `images.langue` présent → il doit être celle qu'un set de cette région
 *     peut porter : `ja` pour un set jp, `en` (ou toute langue non japonaise)
 *     pour un set intl ; sinon le visuel est REFUSÉ et le nom en typographie
 *     reprend. Un visuel absent est honnête, celui d'un autre tirage ne l'est
 *     pas.
 * En attendant le champ, la mesure vit dans
 * scripts/mesurer-visuels-japonais-intl.mjs (dimensions du fichier source, par
 * l'API de l'archive) et la liste va au serveur : archives/DEMANDE-VISUELS-JAPONAIS.md.
 */
// L'attribut `with { type: "json" }` : exigé par Node (les tests et les scripts
// lisent ce module directement), accepté par Next/webpack.
import scans from "./visuels-japonais-sur-sets-intl.json" with { type: "json" };
import regardes from "./visuels-anglais-regardes.json" with { type: "json" };

                                   
                
                                                                                         
                         
     
                                                                              
                                                                                
                                                       
     
                               
 

/**
 * LES FORMATS AUDITÉS ANGLAIS (2026-09-24) — les seuls qu'un scan sans langue
 * peut avoir pour s'afficher sur un set international. Chacun a été regardé :
 * 3 images par format sur les dix plus nombreux (30 anglaises sur 30), puis 20
 * de plus en 734×1024 et 20 en 735×1024 (40 anglaises sur 40), parce que le
 * Cobalion japonais de Lost Thunder faisait 736×1024 — un pixel à côté. Tout
 * format hors de cette liste est refusé, y compris les 408 formats jamais
 * regardés : trois scans japonais (500×694, 692×964, 736×1024) y dormaient.
 * Un format s'ajoute ici APRÈS avoir été regardé, jamais avant.
 */
export const FORMATS_ANGLAIS_AUDITES                      = new Set([
  "734×1024", "660×920", "350×495", "744×1040", "355×500",
  "654×916", "658×920", "735×1024", "600×831", "750×1044",
]);

/** Le format « L×H » du fichier source, lu dans la preuve du serveur ; `null` si elle ne le dit pas. */
export function formatDuFichierSource(preuve                           )                {
  const m = /(\d+)\s*[×x]\s*(\d+)/.exec(preuve ?? "");
  return m ? `${m[1]}×${m[2]}` : null;
}

/**
 * LES SCANS JAPONAIS CONNUS sur des sets internationaux — 3 178 clés le
 * 2026-09-23, dans 31 sets (Cosmic Eclipse 224/245, Fusion Strike 214/282…).
 * Établie par scripts/mesurer-visuels-japonais-intl.mjs à partir des dimensions
 * du fichier SOURCE sur l'archive Bulbagarden : 868×1212 et 748×1044 sont les
 * deux formats des scans japonais, validés à l'œil format par format. C'est
 * l'exclusion en attendant que le serveur écrive `images.langue` — le jour où
 * il le fait, cette liste devient inutile et se retire.
 */
const SCANS_JAPONAIS_CONNUS                      = new Set(scans.cles);

export function estUnScanJaponaisConnu(cleR2        )          {
  return SCANS_JAPONAIS_CONNUS.has(cleR2);
}

/**
 * LES IMAGES REGARDÉES, UNE À UNE (2026-09-28, demande du serveur : « 177 fiches
 * refusées par la langue, formats à auditer à l'œil »). Les 157 images sans
 * langue d'un set international, hors formats audités, ont été mises en
 * planches contacts (scripts/auditer-formats-langue.mjs) et REGARDÉES : 111
 * anglaises — ce sont elles, par leur clé — et 46 japonaises, laissées refusées
 * et signalées au serveur (LISTE-VISUELS-JAPONAIS-REGARDES.json). On admet des
 * IMAGES, pas des formats : 98 formats pour 157 images, un ou deux scans chacun
 * le plus souvent — admettre un format, c'est admettre sans les voir les images
 * qu'il portera demain. Consigné par scripts/consigner-audit-langue.mjs, jamais
 * à la main.
 */
const VISUELS_ANGLAIS_REGARDES                      = new Set(regardes.cles);

/**
 * LA GARDE, ÉCRITE PAR CE QU'ELLE AUTORISE (2026-09-24) — tout le reste est refusé :
 *   set international : `en` ; ou `null` SEULEMENT si le format du fichier
 *     source est parmi les formats audités anglais ET que la clé n'est pas
 *     dans la liste des scans japonais mesurés ;
 *   set japonais      : `ja`, ou `null`.
 * Une langue inconnue (ko, zh, fr, une langue future) n'est PAS « pas du
 * japonais » : c'est un autre tirage, refusé. Le chemin « null hors liste »
 * était le trou : Lost Thunder servait trois scans japonais dont le format
 * n'était ni japonais connu ni audité. Il est fermé le 2026-09-24.
 */
/**
 * LES TIRAGES ASIATIQUES (2026-09-28, demande du serveur) : un scan s'y affiche
 * s'il est DE CE tirage — `zh-hans` sur un set chinois simplifié, `th` sur un set
 * thaï, etc. ; un set `idth` (Indonésie et Thaïlande) accepte `id` et `th`. Ni
 * l'anglais (c'est le jumeau international), ni un `null` (on ne sait pas). Le
 * serveur n'écrit aucun visuel asiatique tant que cette règle n'existe pas
 * (TCGdex en sert 1 224 thaïs et 1 152 indonésiens) ; mesuré le 2026-09-28 :
 * 0 image sur les 109 sets asiatiques publiés — la règle n'en retire aucune.
 */
const LANGUES_DES_TIRAGES_ASIATIQUES                                              = {
  "zh-hans": ["zh-hans"],
  "zh-hant": ["zh-hant"],
  th: ["th"],
  id: ["id"],
  idth: ["id", "th"],
};

export function visuelAdmisPourLaRegion(visuel                  , regionDuSet        , editionLocale                = null)          {
  return refusDuVisuel(visuel, regionDuSet, editionLocale) === null;
}

/**
 * POURQUOI la garde refuse un visuel — `null` s'il passe. C'est LA règle : la
 * garde ci-dessus n'est que « aucun refus ». Écrite ainsi (2026-10-05) pour que
 * l'audit des visuels non servis (scripts/auditer-visuels-non-servis.mjs)
 * IMPORTE la raison au lieu de la deviner : un contrôle qui réécrit la règle se
 * trompe de règle.
 *   · `artofpkm-hors-jp`, `tirage-inconnu` ;
 *   · `langue:<l>` — une langue écrite qui n'est pas celle du tirage (`ja` sur
 *     un set international, `en` sur un set japonais ou asiatique…) ;
 *   · `sans-langue` — tirage asiatique : sans langue, on ne sait pas ;
 *   · `scan-japonais-connu` — la liste mesurée du 2026-09-23 ;
 *   · `format:<L×H>` — sans langue, format du fichier source jamais regardé ;
 *   · `sans-format` — sans langue, et la preuve ne dit aucun format.
 * `editionLocale` (`sets.editionLocale`, posé par l'API, 2026-10-27) : un set OCCIDENTAL imprimé dans une seule langue d'Europe
 * (McDonald's FR) admet en plus les scans de CETTE langue — rien d'autre ne change.
 */
export function refusDuVisuel(visuel                  , regionDuSet        , editionLocale                = null)                {
  // Par construction : artofpkm ne sert que du japonais. Mesuré à 0 cas sur
  // les sets intl le 2026-09-23 — le garde-fou est là pour la collecte de demain.
  if (regionDuSet !== "jp" && visuel.cleR2.startsWith("artofpkm/")) return "artofpkm-hors-jp";
  const langue = visuel.langue?.trim().toLowerCase() || null;
  if (regionDuSet === "jp") return langue === "ja" || langue === null ? null : `langue:${langue}`;
  const asiatiques = LANGUES_DES_TIRAGES_ASIATIQUES[regionDuSet];
  if (asiatiques) return langue === null ? "sans-langue" : asiatiques.includes(langue) ? null : `langue:${langue}`;
  // Un tirage inconnu (demain, `ko`) n'est pas « international » : refusé.
  if (regionDuSet !== "intl") return "tirage-inconnu";
  if (langue === "en") return null;
  if (langue !== null && langue === editionLocale?.trim().toLowerCase()) return null;
  if (langue !== null) return `langue:${langue}`;
  if (estUnScanJaponaisConnu(visuel.cleR2)) return "scan-japonais-connu";
  if (VISUELS_ANGLAIS_REGARDES.has(visuel.cleR2)) return null;
  const format = formatDuFichierSource(visuel.languePreuve);
  if (format === null) return "sans-format";
  return FORMATS_ANGLAIS_AUDITES.has(format) ? null : `format:${format}`;
}
