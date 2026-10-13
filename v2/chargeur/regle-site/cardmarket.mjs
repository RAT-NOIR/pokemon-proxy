                                       
                    
                       
                          
     
                                                                    
                                                                           
                                                                              
                                                                           
                                                                               
                                                         
     
                              
     
                                                                            
                                                                    
                                                    
     
                                           
 

/** Un numéro comparable : majuscules, sans ponctuation, sans zéros de tête (« 001 » = « 1 », « TG24 »). */
export function numeroComparable(n                           )         {
  return String(n ?? "").trim().split(/[\s(]/)[0].toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * L'INTERRUPTEUR de la règle `numeroFiche`. LEVÉ le 2026-09-25 : le champ est
 * en base (59 627 produits), et l'éditeur a vérifié à l'œil les 20 placements
 * de archives/VERIFIER-NUMEROFICHE.md — 20 sur 20 justes. Un test exige qu'il reste
 * levé : le rebaisser ferait disparaître des liens vérifiés.
 */
export const NUMEROFICHE_ACTIF = true;

                                     
                      
                                                                               
                           

/**
 * LA RÈGLE `numeroFiche` (2026-09-25), avant toute lecture du slug :
 *   · absent → la lecture du slug s'applique, comme avant ;
 *   · présent et égal à une fiche du document → le produit va sur cette fiche ;
 *   · présent sans fiche correspondante → nulle part, SAUF si le document n'a
 *     AUCUNE fiche numérotée dans le set (1 858 produits de sets chinois en
 *     cours de collecte) : alors rien ne le contredit, et il reste sur sa
 *     fiche sans numéro comme la règle de la fiche unique le veut.
 * Le TÉMOIN TCGDEX NE DÉTACHE PLUS RIEN (décision du 2026-09-25) : sur 97
 * désaccords entre `numeroFiche` et TCGdex, le serveur a vérifié que TCGdex
 * se trompait 93 fois (attaques et nom donnent raison à notre ligne). Il ne
 * fait que confirmer (`temoin`), pour la mesure ; les désaccords sont
 * tranchés par le serveur, qui corrige `numeroFiche` lui-même.
 */
export function placementParNumeroFiche(
  produit                      ,
  numerosDuDocument                            ,
)                          {
  const voulu = numeroComparable(produit.numeroFiche);
  if (!voulu) return { etat: "absent" };
  if (!numerosDuDocument.some((n) => n != null)) return { etat: "absent" };
  const rang = numerosDuDocument.findIndex((n) => n != null && numeroComparable(n) === voulu);
  if (rang < 0) return { etat: "sans-fiche" };
  const temoins = (produit.numerosTcgdex ?? []).map(numeroComparable).filter(Boolean);
  return { etat: "fiche", rang, temoin: !temoins.length ? "aucun" : temoins.includes(voulu) ? "confirme" : "desaccord" };
}

/**
 * L'idProduct seul ne suffit pas : Cardmarket exige le couple slug/slugSet
 * dans l'URL (vérifié — un lien par idProduct seul ne s'ouvre pas hors de
 * la navigation interne du site). Sans les deux, pas de lien : mieux vaut
 * un idProduct en texte qu'une URL cassée.
 */
export function cardmarketUrl(impression                      )                {
  if (!impression.slug || !impression.slugSet) return null;
  return `https://www.cardmarket.com/fr/Pokemon/Products/Singles/${impression.slugSet}/${impression.slug}`;
}

/**
 * À QUELLE FICHE DU DOCUMENT CE PRODUIT CARDMARKET APPARTIENT-IL ?
 *
 * Les produits sont rattachés au DOCUMENT de carte (`cartes_produits.carteId`),
 * pas à une impression : Umbreon V de VMAX Climax porte deux produits, la RR
 * n° 100 et la CSR n° 244. Depuis les fiches par impression (2026-09-21), la
 * fiche de la n° 244 listait les DEUX — un clic sur le premier menait à la carte
 * de base, au mauvais prix. Mesuré : 7 327 fiches montraient au moins un lien
 * faux, dont 3 167 secrètes. Le produit du site est de donner le BON prix : un
 * lien vers le mauvais produit contredit ce qu'on vend.
 *
 * Le produit n'a pas de champ `numero`, mais son slug se termine par le code du
 * set collé au numéro : `Umbreon-V-V2-s8b244`, `…-MEW199`, `…-sv4a200`. On ne
 * cherche PAS à lire ce numéro dans l'absolu — un code peut finir par un
 * chiffre (`sm5` + `004` = `sm5004`), et une première règle écrite ainsi ne
 * reconnaissait que 64 % des produits là où aucun doute n'existe. On pose la
 * question à laquelle on sait répondre : PARMI LES NUMÉROS DES FICHES DE CE
 * DOCUMENT, lequel termine ce slug ?
 *   · on essaie le numéro tel qu'il est écrit (« 027 »), puis sans ses zéros ;
 *   · une forme de moins de trois chiffres doit être précédée d'autre chose
 *     qu'un chiffre — sinon « 44 » se reconnaîtrait dans « s8b244 » ;
 *   · si deux numéros conviennent (« 4 » et « 104 » pour « xy104 »), le plus
 *     long l'emporte ;
 *   · aucun ne convient (slug sans numéro, produit d'une impression que le set
 *     n'a pas) : `null` — le produit n'est montré sur AUCUNE fiche.
 * Rend l'indice de la fiche dans `numeros`, ou `null`.
 */
/**
 * LE SEGMENT DU SLUG APRÈS LE CODE DU SET, ou `null` si le code ne le préfixe
 * pas (ou n'est pas connu). ⛔ Depuis le 2026-09-24, un numéro ne se lit QUE
 * là : demande du serveur, mesurée — la « lecture par la fin », qui reprenait
 * quand le code ne préfixait pas, lisait « 01 » dans « Falkners-TM-01 » et
 * détachait la carte de sa fiche n° 103 ; 327 → 129 détachements sur fiche
 * unique, les 198 disparus étant de faux signaux. Le prix : 157 produits de
 * moins servis (des placements par la fin sur des slugs dont le code diffère
 * de `sets.code`, qu'on ne sait plus prouver). `sets.code` porte bien le code
 * Cardmarket des sets internationaux (MEW, PAR, ASC… : préfixe de 29 075
 * segments chiffrés sur 31 485).
 */
export function segmentApresLeCode(slug                           , codeSet                )                {
  if (!slug) return null;
  const code = (codeSet ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (code.length < 2) return null;
  // SANS LES TIRETS (2026-09-25) : le code d'un set de promos porte un tiret
  // (« SM-P », « s8a-P », « M-P/ID »), que Cardmarket garde dans le slug —
  // « Xurkitree-SM-P182 », « Charmander-M-PID071 ». Lu sur le dernier segment
  // seul, le code ne se trouvait pas : 2 661 produits illisibles, dont 1 687
  // sur les sets asiatiques, et 47 vrais décalages invisibles (SM-P182 sur la
  // fiche 181). On lit donc le slug entier, sans tirets ni ponctuation, après
  // la DERNIÈRE occurrence du code — et ce qui suit doit avoir la forme d'un
  // numéro (« 244 », « TG24 », « SL01 »), sinon ce n'est pas une lecture.
  // Une version finale (« Volcarona-V2 ») s'ôte d'abord : ce n'est pas un numéro.
  const s = slug.replace(/-V\d+$/i, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const i = s.lastIndexOf(code);
  if (i < 0) return null;
  const segment = s.slice(i + code.length);
  return /^[A-Z]{0,4}\d{1,5}[A-Z]{0,2}$/.test(segment) ? segment : null;
}

export function ficheDuProduit(
  slug                           ,
  numeros                            ,
  codeSet                ,
)                {
  // Le CODE DU SET se retire d'abord : « s4 » + « 80 » donne « s480 », qu'une
  // lecture par la fin ne sait pas couper. Sans le code en préfixe, on ne lit
  // RIEN (cf. segmentApresLeCode).
  const segment = segmentApresLeCode(slug, codeSet);
  if (segment === null) return null;
  const code = (codeSet ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Un numéro se lit « préfixe de lettres + chiffres sans zéros de tête » :
  // « SL01 » = « SL1 », « BW004 » = « BW4 ». Et un numéro qui porte lui-même le
  // code du set (« SWSH204 », « XY27 » pour un code XYPR) se compare code ôté.
  const lire = (x        ) => {
    const m = /^([A-Z]*)0*(\d*)([A-Z0-9]*)$/.exec(x);
    return m ? `${m[1]}${m[2]}${m[3]}` : x;
  };
  const sansCode = (x        ) => (code.length >= 2 && x.startsWith(code) && x.length > code.length ? x.slice(code.length) : x);
  const sansPrefixe = (x        ) => x.replace(/^[A-Z]+(?=\d)/, "");
  let meilleur                = null;
  let longueur = 0;
  numeros.forEach((numero, i) => {
    // « SWSH155 (Top Left) » : le numéro s'arrête au premier blanc.
    const brut = (numero ?? "").trim().split(/[\s(]/)[0].toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!brut) return;
    // Le segment et le numéro, chacun avec et sans le code ; le numéro aussi
    // sans son préfixe quand ce préfixe est un début du code (« XY27 » pour
    // XYPR). Une égalité suffit.
    const prefixe = /^[A-Z]+/.exec(brut)?.[0] ?? "";
    const segs = new Set([lire(segment), lire(sansCode(segment))]);
    const nums = [lire(brut), lire(sansCode(brut))];
    if (prefixe.length >= 2 && code.startsWith(prefixe)) nums.push(lire(sansPrefixe(brut)));
    if (nums.some((n) => n.length > 0 && segs.has(n)) && brut.length > longueur) {
      longueur = brut.length;
      meilleur = i;
    }
  });
  return meilleur;
}

/**
 * LES PRODUITS « V1, V2, V3 » SANS CODE : Cardmarket numérote ainsi les versions
 * d'une même carte dans un set, DANS L'ORDRE DES NUMÉROS — Agatha-V1 est la
 * n° 129, V2 la n° 186, V3 la n° 210 (Chilling Reign). Mesuré le 2026-09-22 :
 * 1 268 produits de cette forme, dans 535 documents, dont 519 ont EXACTEMENT
 * autant de produits que de fiches. Dans ce cas, et dans ce cas seulement, on
 * apparie par rang : Vk ↔ la k-ième fiche par numéro croissant. Un produit de
 * plus ou de moins (16 documents), et on ne devine pas.
 */
function rangParVersion(slug                           )                {
  const m = /-V(\d+)$/i.exec(slug ?? "");
  return m ? Number(m[1]) : null;
}

function ordreDesNumeros(numeros                            )           {
  const cle = (n               ) => {
    const v = parseInt(n ?? "", 10);
    return Number.isNaN(v) ? Number.POSITIVE_INFINITY : v;
  };
  return numeros.map((_, i) => i).sort((a, b) => cle(numeros[a]) - cle(numeros[b]) || a - b);
}

/** Le slug porte-t-il un numéro de carte ? Son dernier segment, la version « -Vn » ôtée, contient un chiffre. */
export function slugPorteUnNumero(slug                           )          {
  const s = (slug ?? "").replace(/-V\d+$/i, "");
  return /\d/.test(s.slice(s.lastIndexOf("-") + 1));
}

/**
 * Les produits à montrer sur une fiche.
 *
 * - Le document n'a qu'UNE fiche dans le set : ses produits sont les siens,
 *   SAUF celui dont le slug porte un numéro qui CONTREDIT celui de la fiche
 *   (2026-09-24 : 296 produits, une impression que la base n'a pas — « Lady-
 *   V2-CSM1aC182 » sur la fiche n° 136). Le reste reste, et chaque famille a
 *   été mise à l'épreuve du set et du nom avant d'être gardée : 5 532 slugs
 *   sans numéro (le seul produit d'une carte, que Cardmarket ne numérote pas —
 *   5 517 au nom de la fiche, 15 abrégés « Speed-L-Energy »), 6 969 produits
 *   numérotés sur une fiche SANS numéro (le numéro manque en base, 6 907 au
 *   nom de la fiche, 62 énergies « Lightning-Energy » pour « Basic Lightning
 *   Energy »), 531 slugs vides (joints par le serveur sur le nom ou le numéro,
 *   `detail` le dit : un slug qui manque en base, pas une fausse jointure).
 * - Il en a plusieurs : seulement les produits attribués à CETTE fiche, par le
 *   numéro du slug ou par rang de version à effectifs égaux. Aucun → AUCUN
 *   lien. Un lien absent envoie le visiteur chercher ; un lien faux lui donne
 *   un mauvais prix avec notre caution.
 */
export function produitsDeLaFiche                                (
  tous              ,
  rang        ,
  numerosDuDocument                            ,
  codeSet                ,
  options                           = { numeroFiche: NUMEROFICHE_ACTIF },
)      {
  // D'abord `numeroFiche`, quand le serveur l'a écrit ET que l'interrupteur est
  // levé (placementParNumeroFiche) ; les produits sans ce champ suivent la
  // lecture du slug, entre eux seulement.
  const parLeChamp      = [];
  const produits      = [];
  for (const p of tous) {
    const placement = options.numeroFiche ? placementParNumeroFiche(p, numerosDuDocument) : { etat: "absent"          };
    if (placement.etat === "absent") produits.push(p);
    else if (placement.etat === "fiche" && placement.rang === rang) parLeChamp.push(p);
  }
  return [...parLeChamp, ...produitsParLeSlug(produits, rang, numerosDuDocument, codeSet)];
}

function produitsParLeSlug                                (
  produits              ,
  rang        ,
  numerosDuDocument                            ,
  codeSet                ,
)      {
  if (!produits.length) return [];
  if (numerosDuDocument.length <= 1) {
    const numero = numerosDuDocument[0] ?? null;
    if (numero === null) return [...produits];
    // Détaché SEULEMENT si un numéro se lit après le code ET contredit la fiche.
    // Un slug chiffré que le code ne préfixe pas (« Falkners-TM-01 », « Abra-B265 »)
    // ne dit rien de lisible : il reste.
    return produits.filter((p) => {
      const segment = segmentApresLeCode(p.slug, codeSet);
      return segment === null || !/\d/.test(segment) || ficheDuProduit(p.slug, [numero], codeSet) === 0;
    });
  }
  const versions = produits.map((p) => rangParVersion(p.slug));
  const tousParVersion =
    produits.length > 0 &&
    produits.length === numerosDuDocument.length &&
    versions.every((v) => v !== null) &&
    new Set(versions).size === produits.length &&
    produits.every((p) => ficheDuProduit(p.slug, numerosDuDocument, codeSet) === null);
  if (tousParVersion) {
    // Vk ↔ la k-ième fiche par numéro croissant.
    const ordre = ordreDesNumeros(numerosDuDocument);
    const k = ordre.indexOf(rang) + 1;
    return produits.filter((p) => rangParVersion(p.slug) === k);
  }
  const lus = produits.filter((p) => ficheDuProduit(p.slug, numerosDuDocument, codeSet) === rang);
  return [...lus, ...parEliminationDesIllisibles(produits, rang, numerosDuDocument, codeSet)];
}

/**
 * L'ÉLIMINATION, RESTREINTE AUX SLUGS SANS AUCUN NUMÉRO (2026-09-24, seconde
 * écriture). Une première version (le matin) prenait pour « illisible » tout
 * produit que la lecture du numéro ne plaçait pas — y compris les NUMÉROTÉS
 * dont le numéro contredit la fiche (Canari-V3-ASC292, Hydrapple-V2-DRI187,
 * la famille des décalages) : elle les posait sur l'autre numéro du document.
 * Une seule fausse, la règle est sortie du commit. Un reste n'est pas une
 * preuve.
 *
 * Celle-ci ne touche que les slugs dont le dernier segment, version « -Vn »
 * ôtée, ne contient AUCUN chiffre (« Flaaffy », « Sightseer-V2ffl ») — un
 * produit qui ne dit pas de numéro ne peut en contredire aucun. Et seulement
 * quand rien n'est à deviner :
 *   · autant de produits que de fiches, tous avec un slug ;
 *   · aucun produit NUMÉROTÉ laissé sans fiche (sinon on ne sait rien) ;
 *   · un seul illisible SANS version pour une seule fiche libre numérotée → il
 *     la prend (« Flaaffy » → 052 quand « Flaaffy-V2-s8b194 » occupe la 194).
 * Mesuré avant d'être écrite : 289 illisibles sur des documents à plusieurs
 * fiches, 12 placés par cette condition ;
 *   · ou des versions « Vk » distinctes sur TOUS les produits du document →
 *     Vk ↔ la k-ième fiche par numéro croissant, comme la règle des versions
 *     (« V1 » est la première fiche même quand un produit codé l'occupe :
 *     Sightseer-V1-sm12a149 puis « Sightseer-V2 » → 192), chacune libre et
 *     numérotée. 127 placements, 20 tirés au sort dans archives/VERIFIER-RANGS.md et
 *     vérifiés à l'œil par l'éditeur avant que ce commit ne sorte.
 */
function parEliminationDesIllisibles                                (
  produits              ,
  rang        ,
  numeros                            ,
  codeSet                ,
)      {
  if (numeros[rang] == null) return [];
  if (produits.length !== numeros.length || produits.some((p) => !p.slug)) return [];
  const occupees = new Set        ();
  const illisibles      = [];
  for (const p of produits) {
    const i = ficheDuProduit(p.slug, numeros, codeSet);
    if (i !== null) occupees.add(i);
    else if (slugPorteUnNumero(p.slug)) return []; // un numéroté que rien ne place : on ne sait rien
    else illisibles.push(p);
  }
  if (!illisibles.length || occupees.has(rang)) return [];
  const ordre = ordreDesNumeros(numeros);
  const libre = (i        ) => !occupees.has(i) && numeros[i] != null;
  const libres = ordre.filter(libre);
  const versions = illisibles.map((p) => rangParVersion(p.slug));
  // Un nom nu, sans version : la seule fiche libre, s'il n'y en a qu'une.
  if (versions.every((v) => v === null)) return illisibles.length === 1 && libres.length === 1 && libres[0] === rang ? [illisibles[0]] : [];
  // Des versions : chacune à SA place par numéro, jamais « la fiche qui reste »
  // (Milo-V3 n'est pas la 078 quand Milo-V2-s1a83 occupe la 083 : V3 est la
  // troisième, déjà prise — rien).
  if (!versions.every((v) => v !== null) || new Set(versions).size !== versions.length) return [];
  // Les versions se comptent sur TOUS les produits, codés compris (la version
  // d'un slug codé précède le code : « -V1-sm1S072 ») : « Rotom-Dex-V1 » nu
  // n'est pas la première fiche quand « Rotom-Dex-V1-sm1S072 » dit déjà V1.
  const toutesVersions = produits.map((p) => /-V(\d+)(?:-[A-Za-z0-9]+)?$/i.exec(p.slug ?? "")?.[1]).filter((v) => v !== undefined);
  if (new Set(toutesVersions).size !== toutesVersions.length) return [];
  const cibles = versions.map((v) => ordre[(v          ) - 1]);
  if (cibles.some((i) => i === undefined || !libre(i))) return [];
  return illisibles.filter((_, j) => cibles[j] === rang);
}
