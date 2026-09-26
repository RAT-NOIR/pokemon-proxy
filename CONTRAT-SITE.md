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

---

## Dettes connues, à ne pas rediagnostiquer

- **La DATE manque sur 11 sets de 38** : SI-JP, VS, WEB, IPB, MCDP, EXS (japonais) et PBL, ASC,
  xASC, JTG, CRI (occidentaux). Ni Cardmarket ni l'infobox ne l'ont. Onze lignes à la main, plus
  tard. Afficher le set sans date, pas « date inconnue ».
- **18 images sur 1 946 ne s'attachent à aucune carte**, gardées volontairement
  (`CLAUDE.md` §24) : 9 cartes n'ont aucune page Bulbapedia, 9 sont ambiguës. Elles n'apparaîtront
  pas au catalogue, et c'est attendu.
