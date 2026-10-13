# Contrat de champs — ce que le site lit dans la base `cartes`

Ce fichier existe parce qu'un champ a été **retiré sans être annoncé**, et que le site a cherché
pendant une journée un rattachement qui était écrit sous un autre nom. Tout changement de forme d'un
champ lu par le site se note **ici**, dans le même commit que le changement.

---

## 🔴 `cartes.image` N'EXISTE PLUS. C'est `cartes.images`, une LISTE.

**0 carte sur 2 981 porte `image`. 1 901 portent `images[]`.** Sur EXP : **99 cartes sur 102**.

Le champ singulier a été retiré le 2026-09-12 (voir `CLAUDE.md` §19) et ce n'est pas un détail de
nommage. **Une page Bulbapedia est une carte tous tirages fusionnés** : 60 cartes de la base vivent
dans deux sets ou plus. « Double Colorless Energy » porte **deux** images — celle d'*Expansion Pack*
et celle d'*Intro Pack Bulbasaur*. Un champ unique lui donnait le visuel du premier set collecté, et
l'autre page affichait le mauvais dessin sans que rien ne le signale.

```js
// ✅ le site lit l'entrée dont `set` est celle de la page qu'il affiche, JAMAIS la première venue
const img = carte.images?.find(i => i.set === slugDuSetAffiche);
const url = img && `${process.env.R2_IMAGES_BASE_URL}/${img.cleR2}`;
```

Une entrée de `images[]` :

| champ | exemple | usage |
|---|---|---|
| `set` | `"Expansion-Pack"` | 🔑 **la clé** : c'est le `_id` du set, donc le `slugSet` |
| `cleR2` | `"artofpkm/6/96.webp"` | à concaténer après `R2_IMAGES_BASE_URL` |
| `w`, `h` | `593`, `834` | dimensions de l'original, pour réserver la place |
| `fmt` | `"webp"` | |
| `sha256` | | identité de l'octet |
| `urlOriginal`, `preuve`, `jointeLe` | | traçabilité, pas d'usage d'affichage |

### ➕ `basseDefinition` (2026-10-12) — ne JAMAIS agrandir l'image au-delà de `w`

| champ | valeur | sens |
|---|---|---|
| `basseDefinition` | `true`, ou **absent** | l'image **ORIGINALE** est sous 350 px de large (`LARGEUR_MIN` de `collecte-cartes/seuils-images.js`) |

**Ce que le site en fait : ne jamais afficher cette image plus large que `w`** (ni la mettre à l'échelle d'une vue pleine carte, ni l'étirer pour
remplir une grille). Pour une image marquée, `w` EST la largeur de l'original — le fichier servi n'est jamais agrandi à l'encodage
(`withoutEnlargement`, 700 px au plus), donc `w` = ce que l'image contient réellement (257 à 349 px pour les sources officielles TPC et
pokemon-card.com ; 300 px pour PikaQian ; ailleurs un original déjà sous 350). Un champ **absent** ne veut rien dire d'autre que « pas sous 350 px
ou largeur inconnue » : jamais `false`, on ne l'écrit pas.
- **Où il vit** : sur **l'entrée** de `cartes.images[]` (ce que le site lit) ET sur le document `images` qui l'a produite (traçabilité). Posé
  par les collecteurs à l'écriture (TPC Asie, pokemon-card.com, PikaQian) ; `poser-basse-definition.js` le pose sur ce qui existait avant.
- **Le remplacement est automatique** : quand une source fournit, pour la **même impression** (même carte, même `set`, même `numero`) et la **même
  `langue`** (connue, non `null`), une image **sans** la marque, l'entrée marquée **sort** de `cartes.images` — le site n'a rien à décider. Jamais
  l'inverse : une image de basse définition ne remplace jamais une image sans la marque. Le document `images` de l'entrée remplacée reste, en
  `etat: 'remplace'` (avec `remplacePar` : source et cleR2 de la remplaçante).

⚠️ **Une carte sans image n'est pas un échec** : la source ne liste pas les énergies de base. Sur
EXP, les 3 cartes sans image sont des énergies. Le catalogue affiche alors le symbole du set.

⚠️ **`sets.completImages` compte des CARTES COUVERTES, pas des cartes portant le champ.** Lire l'un
pour l'autre fait croire à un trou qui n'existe pas.

---

## `sets.nomAffichage` — le nom à écrire dans la liste

**Le champ à lire est `sets.nomAffichage`.** 38 sets sur 38 le portent, tous distincts, aucun ne
retombe sur son code.

| champ | exemple | |
|---|---|---|
| **`nomAffichage`** | `"Rocket Gang"` | 🔑 **c'est celui-là qu'on affiche** |
| `nomAffichageSource` | `"cardmarket"` | d'où il vient, pour qu'un nom faux se remonte à sa source |
| `nomCardmarket` | `"Rocket Gang"` | le nom Cardmarket de CETTE expansion |

🔴 **Ne pas afficher `nomJa`** (kana, illisible) ni **`nomEn`** sur un set japonais : `nomEn` est le
set international **homologue**, un autre produit. « Base Set » n'est pas le nom d'*Expansion Pack*.
`nomAffichage` applique déjà cette règle par région ; le site n'a pas à la rejouer.

---

## `cartes_produits.slug` et `.slugSet` — le lien Cardmarket

**3 900 lignes sur 3 932 (99,2 %)** portent les deux. L'URL se fabrique avec les deux :

```
https://www.cardmarket.com/fr/Pokemon/Products/Singles/{slugSet}/{slug}
```

Les **32 lignes sans** sont des produits appris par un chemin qui n'enregistre pas le slug
(`CLAUDE.md` §6, 1 787 sur 69 598 en production). Le site n'affiche simplement pas de lien pour
celles-là ; ce n'est pas une erreur à signaler.

---

## `sets.tirage` — la clé EXACTE des impressions d'un set (2026-09-24)

**601 sets sur 602 le portent** (le 602ᵉ n'a pas de ligne de table). `region` ne vaut que `jp` ou `intl` ;
`tirage` dit lequel des tirages de la carte ce set affiche :

| `tirage` | sets | `region` |
|---|---|---|
| `jp` | 341 | `jp` |
| `intl` | 174 | `intl` |
| `zh-hans` · `zh-hant` | 68 · 8 | `intl` |
| `id` · `th` · `idth` | 4 · 3 · 3 | `intl` |

```js
// ✅ l'impression que CE set affiche : par le tirage exact, la région n'étant qu'un repli
const cle = set.tirage ?? set.region;
const imp = carte.impressions.find(i => i.tirage === cle && expansions.includes(i.expansion));
```

🔴 **Avec `imp.tirage === set.region`, les 86 sets chinois, indonésiens et thaïs ne trouvent jamais leurs
impressions** : elles ont pour tirage `zh-hans`, `id`, `th`… — c'est ce qui laissait « fiche sans numéro »
sur 10 062 produits (`LISTE-FICHES-MANQUANTES.json`, `numerosManquants`).

## `impressions[].source: 'setlist'` — une impression posée depuis la Setlist (2026-09-24)

**10 008 impressions, 5 751 cartes, 72 expansions** (Lady 136 et 182 de Storming Emergence Radiant parmi
elles). La page de carte de Bulbapedia ne déclare pas ces tirages ; la Setlist de la page de set les range,
et l'URL Cardmarket du produit joint confirme le numéro — les deux sources sont exigées. Forme identique aux
autres impressions (`total`, `deck`, `rarete` à `null`, pas d'`illustrateur`). Une relecture de la page ne
les efface pas (`collecte-cartes/impressions-posees.js`).

---

## `cartes_produits.visuelSubstitut` — le visuel de la carte d'ORIGINE d'une réimpression (2026-09-26)

**3 219 lignes** : Prize Packs 1 218 / 1 228, WCD 1 729 / 1 769, Battle Academy 272 / 300. Décision du testeur : une réimpression
tamponnée n'a pas de visuel de SON tirage ; le site peut montrer celui de la carte d'origine, AVEC la mention.

| champ | exemple | usage |
|---|---|---|
| `cleR2` | `"tcgdex/Scarlet-Violet/180-279036.webp"` | à concaténer après `R2_IMAGES_BASE_URL`, comme `cartes.images` |
| `mention` | `"Visuel de la carte d'origine, sans le tampon Prize Pack"` | 🔑 **à afficher avec l'image, toujours** |
| `set`, `numero` | `"Scarlet-Violet"`, `"180"` | le tirage d'origine dont c'est le scan |
| `w`, `h`, `langue`, `source` | | comme une entrée de `cartes.images` |
| `preuve`, `le` | | traçabilité |

Les trois mentions : « …sans le tampon Prize Pack » · « …l'impression WCD a une bordure dorée, une signature et un dos
différent » · « …sans la marque Battle Academy ».

🔴 **Ce n'est PAS le visuel du produit.** Il vit sur la ligne produit, jamais dans `cartes.images` : aucun lecteur existant ne le
voit sans l'avoir demandé par son nom. **L'index de reconnaissance ne doit JAMAIS l'utiliser comme identité de la réimpression**
(il montrerait la carte d'origine sans tampon — l'autre produit). La table maîtresse ne le compte pas comme visuel.

## `sets.dateSortieMois` — une sortie connue au MOIS seulement (2026-09-26)

`{ iso: "2014-11", texte: "November 2014", source, le }`, sur un set qui n'a ni `dateSortie*` ni `periodeDistribution` (5 sets :
s8a-G, PCCP, sN, TK7, TK1). Règle du testeur : garder la précision au mois, sans inventer de jour — assez pour ranger. **Jamais dans
`dateSortieEn`/`dateSortieJa`**, que `dateFrancaise` imprime au jour. Ranger par `iso` (premier jour du mois, jamais affiché), afficher
« novembre 2014 » — la même logique que `periodeDistribution.debutIso`.

## `cartes_produits.preuve: 'metacarte+nom+attaques'` et `sets.reimpressions: 'metacarte'` — les Gem Packs (2026-09-26, soir)

Gem Pack Vol. 1, 3, 4, 5 et 6 (`Gem-Pack-Vol-1`, `-3`, `-4`, `Gem-Pack-Vol5`, `-6`, tirage `zh-hans`) sont des réimpressions
chinoises dont la Setlist n'est faite que de liens rouges. Leurs 579 produits sont joints par la **désignation croisée** : la
métacarte Cardmarket, le nom + les attaques, et une carte déjà imprimée en `zh-hans`, calibrée à 0 faux de la clé. Comme pour les
WCD et les Prize Packs :
- `numeroFiche: null` et `bulba.expansion: null` : la fiche est **sans numéro** (le numéro Cardmarket d'un Gem Pack est un GROUPE,
  « 01 01/15 », pas un numéro de carte), selon la règle `fichesDuDocument([])` du site ;
- aucune image.

## `sets.tirage` corrigé : SV4s…SV10s ne sont pas en chinois traditionnel (2026-09-26, soir)

Paradox Encounters, Ace Paradox et Transfiguration Mask passent en **`id`** ; Stellar Guidance, Stellar Lightning, Bonds of Destiny
et Presence of Champions en **`idth`**. Leur page source ne nomme que des sorties indonésiennes et thaïes, et le `zh-hant` posé le
15/09 n'avait pas de preuve. Les impressions `source: 'setlist'` et les lignes de jointure ont suivi dans le même lot. L'appariement
`imp.tirage === set.tirage` reste donc vrai.

## `numeros_cartes` : `source: 'cardmarket-deduit'`, `certitude: 'deduite'` (2026-09-26, soir)

Un produit lu chez Cardmarket par son LIEN et son TITRE, sans image, dont l'**idProduct est déduit** (`collecte-cartes/deduire-produit.js`)
— les 171 du journal 1.8, et ce que l'userscript 1.9 enverra. La preuve est dans `preuveDeduction` (et `deduitLe` sur une ligne
complétée). **Une déduction n'est jamais « exacte »** : `certitude: 'deduite'`, y compris sur une ligne `cardmarket` dont seul le slug a
été complété. Toute vraie lecture — l'userscript avec l'id de l'image (`/api/apprendre-lot`) comme l'extension (`/api/apprendre`) — la
réécrit `cardmarket` / `exacte` et retire `preuveDeduction`, `deduitLe` et `preuveJournal` (seconde relecture du 2026-09-26 : les deux
derniers survivaient, et `/api/apprendre` rendait « exacte » une ligne déduite en gardant son slug). **Un slug ne se garde que s'il est
LU** : une ligne déduite dit ce que la déduction y a écrit (`champsDeduits`, et `certitudeAvantDeduction` sur une ligne complétée) ;
une lecture qui ne relit pas l'un de ces champs le RETIRE, et garde les autres (un `nomFr` lu avant la déduction reste). Une ligne
`cardmarket`/`exacte` peut donc perdre son slug déduit et redevenir sans slug, jusqu'à la prochaine lecture de sa vignette. Les deux
champs disparaissent avec les autres marques à la vraie lecture. `variante` est relue du slug par le serveur (un « -V3 » en FIN de
slug, « Mewtwo-V-UNION-V3 », est une variante), jamais prise du client.
⚠️ **Deux lignes peuvent porter le même `slugSet|slug`** quand une déduction s'est trompée de produit (produit neuf absent du
catalogue) et que le vrai produit a été lu depuis avec son image : la route le détecte et le rend (`deductionsContredites`, journal de
l'userscript), mais ne défait pas la ligne déduite — un détachement attend le feu vert. Une fiche qui lit un produit par son slug
préfère la ligne `certitude: 'exacte'`.

## `sets.symbole` — le symbole du set, à afficher (2026-09-28)

```js
const url = set.symbole?.cleR2 && `${process.env.R2_IMAGES_BASE_URL}/${set.symbole.cleR2}`;   // comme une image de carte
```
| champ | exemple | usage |
|---|---|---|
| `cleR2` | `"symboles/ptcg-assets/ja_sv4a-….png"` | à concaténer après `R2_IMAGES_BASE_URL` |
| `w`, `h` | `30`, `17` | taille NATIVE, en pixels — ne pas agrandir au-delà de ×2 (les boîtes de code modernes font 30×17) |
| `source` | `"bulbapedia:convention-infobox"` · `"ptcg-assets"` | d'où vient le fichier ; `preuve` dit pourquoi c'est celui de CE set |

200 sets en portent un : 121 Bulbapedia (depuis le 2026-09-20) et 79 ptcg-assets, posés le 2026-09-28 sur les sets qui n'en avaient pas
(décision du testeur ; un symbole Bulbapedia n'est jamais remplacé). Un symbole moderne est la boîte du CODE imprimé (« sv4a »), un
symbole de promos peut être PARTAGÉ (l'étoile PROMO : 8 séries) — c'est ce que la carte porte, il s'affiche tel quel.
⚠️ **`sets.symbolesIdentification` n'est PAS à afficher** : ce sont les images que l'identification compare (index
`collecte-cartes/index-symboles.json`), et une entrée peut y exister sans `symbole`.

## `sets.logoFr` — le logo FRANÇAIS du set, à afficher sur le site français (2026-10-04)

Même format que `sets.logo` : un objet porté par le document du set, le fichier sur le bucket images, sa réduction à côté.
```js
const l = set.logoFr;                                     // absent sur les sets sans logo français
const cle = l?.vignette?.cleR2 ?? l?.cleR2;               // la vignette d'abord (400 px de large au plus), comme sets.logo
const url = cle && `${process.env.R2_IMAGES_BASE_URL}/${cle}`;
```
| champ | exemple | usage |
|---|---|---|
| `cleR2` | `"tcgdex/logos-fr/base5.png"` · `"logos/manuel/Logo-FR/…png"` | le fichier pleine résolution, à concaténer après `R2_IMAGES_BASE_URL` |
| `w`, `h` | `409`, `142` | taille du fichier |
| `vignette` | `{ cleR2: "vignettes/tcgdex/logos-fr/base5.webp", w: 400, h: 139 }` | la réduction WebP (400 px de large au plus, jamais agrandie) — même règle que `sets.logo.vignette` |
| `region` | `"intl"` | **preuve de langue STRUCTURÉE** : un logo français n'existe que sur un set occidental (tirage `intl`) |
| `langue` | `"fr"` | le logo est en français, par construction du champ |
| `sha1` | `"e2ce46…"` | l'empreinte du fichier (règle des logos génériques) ; aucun fichier n'est partagé par deux sets le 2026-10-04 |
| `source`, `preuve`, `le` | `"tcgdex:assets-fr"` · `"manuel"` | d'où vient le fichier et pourquoi c'est celui de CE set |

**117 sets en portent un, tous occidentaux et tous publiés** : 111 servis par TCGdex en langue française (SHA-256 vérifié distinct
de l'anglais, 2026-09-20), 6 déposés à la main par le testeur (dossier « Logo FR », lus à l'œil, 2026-09-28). `logoFr` ne remplace
jamais `sets.logo` : un set peut porter les deux, et le français est celui de la page française. `region`, `langue` et `sha1` ont été
posés le 2026-10-04 (`exposer-logos-fr.js`, clés absentes seulement) : la phrase de `preuve` de ces logos n'est pas de celles que
`lib/visuelSet.ts` reconnaît, et sans `region` la règle du site les aurait tous refusés.

## Le NIVEAU et la SOURCE de chaque logo (2026-10-13)

Règle du testeur : **chaque logo porte son niveau — `officiel`, `semi-officiel` ou `compose` — et sa source ; un logo composé en place est remplacé dès qu'un officiel ou un semi-officiel est trouvé.**
Champs NEUFS, additifs, sur chaque objet de logo : `sets.logo`, `sets.logoFr`, `sets.logoCompose`, `sets.logoOfficiel.<fr|ja|en>`, `sets.logoSemiOfficiel.<fr|ja|en>`.
| champ | valeurs | sens |
|---|---|---|
| `niveau` | `officiel` · `semi-officiel` · `compose` · `generique` · `inconnu` | `officiel` : le logo du set publié par TPC ou ses partenaires, tel quel (provenance PROUVÉE : TCGdex, Bill's Archive, `setlogo` de la page Bulbapedia du set). `semi-officiel` : un visuel officiel qui représente le set sur du matériel officiel (opération, événement), jamais fan. `compose` : fabriqué par le site/serveur. `generique` : le même fichier sert plusieurs sets. `inconnu` : provenance non prouvée — JAMAIS devinée (c'est le cas de tous les logos déposés à la main : aucune table lue ne dit qu'ils sont officiels). |
| `source` | `tcgdex`, `billsarchive`, `bulbapedia:setlogo`, `tcgdex:en`, `tcgdex:assets-fr`, `manuel`, `compose`… | d'où vient le fichier (déjà présente partout ; posée seulement si elle manquait et se lisait sans deviner) |
Le classement est `collecte-cartes/niveau-logos.js` (table fermée) ; il est posé par `poser-niveau-logos.js` (champs NEUFS seulement : aucune valeur existante modifiée).

**`sets.logoOfficiel.en`** — la table `logoOfficiel` accepte désormais la sous-clé `en` (logo anglais d'un set intl, langue prouvée par `/en/` chez TCGdex ; chez Bill's aucune règle de nom de fichier ne prouve l'anglais : refusé). Même forme que `fr`/`ja`, plus `niveau`. **L'export (`logosOfficiels`) porte `en` et `niveau`.** ⚠️ Côté SITE, `lib/logosOfficielsImport.ts` n'accepte que les sous-clés `fr`/`ja` (`sousCle !== "fr" && sousCle !== "ja"` → « sous-cle », l'entrée est écartée comme incomplète) et `lib/logosOfficiels.ts` ne lit que `fr`/`ja` (`TableOfficielle`, boucle `["ja","fr"]`) : tant que le site ne l'accepte pas, un `en` est ignoré sans erreur ; `niveau` et `represente` passent sans être lus.

**`sets.logoSemiOfficiel.<langue>`** — même forme que `logoOfficiel` (clé R2 `logos-semi-officiels/…`, lot `logos-semi-officiels-2026-10`) plus `niveau: "semi-officiel"` et **`represente`** (une phrase : « logo de l'opération McDonald's Match Battle 2022-2023 »), exigée à l'écriture et à l'export. Une exception à la garde « logo générique » ne vaut QUE pour ce champ et QUE si `represente` est écrit. Exporté sous la clé **`logosSemiOfficiels`** (`{ <set>: { <langue>: entrée } }`) ; le site ne la lit pas encore. Rang attendu : après `logoOfficiel`, avant tout composé.

## `sets.bulba.expansion = "reimpressions/<slug>"` — fiches par carte d'origine des sets de réimpressions (2026-10-13, lot MULTI)

Promos, Professor-Program, Prize Pack Series Three/Four/Five, Southeast-Asia-Promos et WCD 2008/2011/2012/2022/2023 (11 sets, 28 fiches) ont désormais un nom d'expansion SYNTHÉTIQUE et, sur les cartes réimprimées à plusieurs numéros d'origine, une impression par numéro d'origine (`source: 'origine-slug'`, `preuveNumero` = le slug) et `numeroFiche` sur leurs lignes : chaque lien Cardmarket va sur la fiche de SA carte. Le nom se compare par égalité et ne s'affiche jamais. ⚠️ Ces sets passent « par impression » : une image SANS `numero` posée sur l'un de leurs documents à plusieurs fiches (`documentAmbigu`, `impressionsDuSet.ts:99`) les ferait basculer en bloc en « une fiche par document » — le serveur ne le fait pas (son outil refuse), le site le subirait. Les URL de ces 28 fiches changent (le slug porte le numéro).

---

## Dettes connues, à ne pas rediagnostiquer

- **La DATE manque sur 11 sets de 38** : SI-JP, VS, WEB, IPB, MCDP, EXS (japonais) et PBL, ASC,
  xASC, JTG, CRI (occidentaux). Ni Cardmarket ni l'infobox ne l'ont. Onze lignes à la main, plus
  tard. Afficher le set sans date, pas « date inconnue ».
- **18 images sur 1 946 ne s'attachent à aucune carte**, gardées volontairement
  (`CLAUDE.md` §24) : 9 cartes n'ont aucune page Bulbapedia, 9 sont ambiguës. Elles n'apparaîtront
  pas au catalogue, et c'est attendu.
