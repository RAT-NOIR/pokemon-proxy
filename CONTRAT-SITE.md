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

## Dettes connues, à ne pas rediagnostiquer

- **La DATE manque sur 11 sets de 38** : SI-JP, VS, WEB, IPB, MCDP, EXS (japonais) et PBL, ASC,
  xASC, JTG, CRI (occidentaux). Ni Cardmarket ni l'infobox ne l'ont. Onze lignes à la main, plus
  tard. Afficher le set sans date, pas « date inconnue ».
- **18 images sur 1 946 ne s'attachent à aucune carte**, gardées volontairement
  (`CLAUDE.md` §24) : 9 cartes n'ont aucune page Bulbapedia, 9 sont ambiguës. Elles n'apparaîtront
  pas au catalogue, et c'est attendu.
