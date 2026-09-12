# Spécification de collecte — IMAGES, 28 sets vintage d'abord, cible totale ensuite (2026-09-12)

Pour l'agent serveur. Compagnon de `SPEC-COLLECTE-BULBAPEDIA.md` (le texte) : mêmes prérequis (§2 de
ce fichier-là), mêmes quatre arrêts durs, même base `cartes`. Rien ici n'est codé.

> 🔴 **TROIS RÈGLES QUI PRIMENT SUR LE RESTE.**
> 1. **Le silence n'est PAS une licence.** La source A ne revendique rien et n'interdit rien ; elle
>    n'autorise rien non plus. La demande à PKMJP est envoyée par le testeur ; **si la réponse est
>    non, on s'arrête, on efface le bucket, les fiches retombent sans image.** Le collecteur
>    accepte `--arreter-et-effacer` et l'exécute sans discussion.
> 2. **Une requête toutes les 5 s, jamais en parallèle**, User-Agent
>    `rat-market-collecte/0.1 (https://rat-market.fr ; contact)`. Un seul réessai sur 5xx après 30 s.
>    C'est ce qui distingue un collecteur d'un aspirateur.
> 3. **Attribution nommée dès la première fiche affichée** : « Image : The Art of Pokémon
>    (artofpkm.com), © ayants droit Pokémon » avec lien, sous chaque image, plus la page Sources.
>    Aucune image n'est servie publiquement avant que ce gabarit existe.

## 1. Source A — The Art of Pokémon (artofpkm.com) : le JAPONAIS, toutes ères

Relevé du 2026-09-12 (7 + 7 + 7 requêtes à 5 s, aucune image entière) :

- `robots.txt` : `Allow: /`, seuls `/admin/` et `/users/` interdits. `/disclaimer` : « We do not claim
  ownership over Pokémon files, images… All rights belong to their respective copyright holders. »
- Rails, HTML rendu serveur. **419 sets en 16 ères, PMCG (1996) → MEGA (2026).**
- `GET /cards` : une tuile par set, `<a class="… set" href="/sets/{id}">…<h4>NOM</h4></a>`, groupées
  sous `<h2>ÈRE</h2>` (~700 o par tuile : parser sur 2 500 o, pas 400).
- `GET /sets/{id}/cards` : une entrée par carte —
  `<a data-lightbox-title="NOM, SET" data-lightbox-url="/sets/{id}/card/{n}" href="https://cdn.artofpkm.com/{clé}"><img src="https://cdn.artofpkm.com/{clé-vignette}">`.
  **`href` = original** ; `img src` = vignette 286×400. Pas de pagination vue sur 55 entrées ;
  chercher `?page=` et suivre si présent.
- `GET /sets/{id}/card/{n}` : `<title>NNN/TTT Nom</title>` ; corps : nom EN, nom JA, `Illus. X`,
  rareté, mention `(Old Back)`. **C'est là que sont le numéro et l'illustrateur, pas dans la liste.**
- **Originaux mesurés, 3 sur 3 : WebP 593×834, 85 à 120 Ko.** Sous les 600×825 retenus de 7 px en
  largeur, au-dessus en hauteur : accepté. Vignettes 286×400.
- Contact : X `@pkm_jp` (lien sur l'accueil) ; lien « Feedback » dans la navigation du site.

### La table des 28, à la main, résolue le 2026-09-12 sur les noms du site

| code | exp CM | prod | artofpkm id — nom sur le site |
|---|---|---|---|
| EXP | 4169 | 102 | **6 « Base Set »** (pas « Expansion Pack ») |
| PJU | 4463 | 48 | 8 « Pokémon Jungle » |
| MFO | 4464 | 48 | 9 « The Secret of the Fossil » |
| ROG | 4465 | 65 | 10 « Rocket Gang » (pas 100 « Rocket Gang Strikes Back ») |
| G1 | 4466 | 96 | 18 « Gym Expansion 1: Gym Leader Stadiums » |
| G2 | 4467 | 98 | 25 « Gym Expansion 2: Challenge from the Dark » |
| SI-JP | 4357 | 18 | 27 « Southern Islands » |
| N1 | 4506 | 96 | 31 « Gold, Silver, to a New World... » |
| N2 | 4507 | 57 | 34 « Crossing the Ruins... » |
| N3 | 4508 | 57 | 40 « Awakening Legends » |
| N4 | 4509 | 113 | 43 « Darkness, and to Light... » |
| VS | 4168 | 151 | 46 « Pokémon Card★VS » |
| WEB | 4355 | 48 | 50 « Pokémon Card★web » |
| EC1 | 5021 | 157 | 51 « Base Expansion Pack » |
| EC2 | 5022 | 92 | 56 « The Town on No Map » |
| EC3 | 5023 | 90 | 57 « Wind from the Sea » |
| EC4 | 5024 | 91 | 59 « Split Earth » |
| EC5 | 5025 | 91 | 61 « Mysterious Mountains » |
| ADV2 | 5873 | 53 | 71 « Miracle of the Desert » |
| ADV3 | 5872 | 54 | 73 « Rulers of the Heavens » |
| ADVex1 | 5869 | 80 | 79 « Magma VS Aqua: Two Ambitions » |
| IPB | 5059 | 41 | 28 « Intro Pack » — ⚠️ Bulbasaur seul ou les deux decks ? le compte tranche |
| MCDP | 4178 | 24 | 54 « McDonald's Pokémon-e Minimum Pack » |
| DP5c | 4305 | 65 | 171 « Cries of Secrecy » |
| PCG6 | 5709 | 86 | 127 « Holon Research Tower » (les half decks 123/125/126 sont à part) |
| PCG9 | 5693 | 68 | 137 « Offense and Defense of the Furthest Ends » |
| DP2 | 4317 | 123 | 150 « Secret of the Lake » |
| EXS | 3781 | 125 | **11 + 14 + 17**, les trois Expansion Sheet séparées → une expansion CM |

La relation set-source ↔ expansion CM est **n-n** (EXS : 3 → 1 ; PCG6 : 1 principal + decks). Table
`sources_sets { source:'artofpkm', sourceSetId, nomSource, code, idExpansion, verifieLe }`.

## 2. Procédure, par set

1. `GET /sets/{id}/cards` (+ pages) → entrées `{n, titre, original, vignette}`. Compte imprimé.
2. **Mesure avant collecte** : Range 64 Ko sur les 3 premiers originaux, dimensions lues dans
   l'en-tête WebP/JPEG/PNG. Si largeur < 560 px sur l'un des trois : **le set est refusé**, mesure
   imprimée, on passe au suivant. Rien n'est téléchargé sous l'exigence.
3. Pour chaque entrée : `GET /sets/{id}/card/{n}` → numéro/total, nom EN, nom JA, illustrateur,
   rareté ; puis `GET original` entier → sha256, octets, dimensions → R2.
4. Jointure image → carte (`cartes` de la collecte texte) : set-source → set Bulbapedia via la table ;
   numéroté → `(set, numero)` ; non numéroté → `(set, nomEn, illustrateur)`. Une image par carte ;
   collisions et orphelins listés dans `restes` (type `image-sans-carte`, `carte-sans-image`,
   `image-vers-plusieurs-cartes`), **jamais résolus par le code**.

## 3. Nommage, stockage, empreinte, reprise

- Bucket R2 **séparé du wikitext** : `rat-market-cartes-images`, privé. Variables `R2_BUCKET_IMAGES`.
  Clé d'objet **stable, dérivée de la source** : `artofpkm/{sourceSetId}/{n}.webp` (l'original tel
  quel, aucune recompression). La vignette n'est pas collectée : on la recalcule chez nous.
- Collection `images` :
  `{ _id:'artofpkm/6/1', source, sourceSetId, n, titre, urlOriginal, cleCdn, sha256, octets, w, h,
     fmt, numero, total, nomEn, nomJa, illustrateur, rarete, carteId, cle R2, telechargeLe, etat }`.
- **Empreinte** : `cleCdn` (la clé opaque du CDN) + `sha256`. Une entrée dont `cleCdn` est déjà en
  base avec un `sha256` n'est **jamais** retéléchargée ; une clé nouvelle sur un `n` connu est une
  mise à jour de la source, journalisée avant remplacement.
- **Reprise** : `collecte_images_etat { source, sourceSetId, phase: liste|mesure|pages|originaux|
  jointure|verifie, fait, total, derniereRequete }` ; au redémarrage on reprend au premier `n` sans
  `sha256`. Aucun document partiel : la ligne `images` s'écrit après l'objet R2, pas avant.

## 4. Complétude et 🔴 chiffres attendus — sinon il annule

Un set est `complet` quand **trois comptes sont imprimés et concordent** : entrées artofpkm ·
cartes Bulbapedia du set (collecte texte) · images jointes ; plus les restes par type. Écarts
attendus et TOLÉRÉS s'ils sont NOMMÉS : doublons holo/non-holo (une carte, deux entrées source),
cartes de deck absentes de l'expansion CM.

- **Premier jet : EXP seul (`--set=EXP`, id 6)** : ~102 entrées, ~210 requêtes (1 liste + 3 mesures
  + 102 pages + 102 originaux), **~18 min**, ~10 Mo. Puis ARRÊT et relecture des trois comptes.
- **Les 28 sets** : ~2 300 entrées, **~4 700 requêtes, ~6 h 30**, **~230 Mo** sur R2.
- Résolution attendue : **593×834 WebP** sur chaque mesure. Autre chose = annuler et rapporter.

## 5. Le moderne et l'occidental — ~66 000 produits, la quasi-totalité du catalogue public

Dénominateurs (base `test`, 2026-09-12) : 351 expansions japonaises = 27 989 produits (dont les
2 234 vintage) ; 168 occidentales = 22 453 ; **229 à région NULLE = 18 789, à trier avant toute
collecte** (`deriver-region.js`, puis à la main pour le reste).

| population | source | lue ? | résolution | conditions | ordre |
|---|---|---|---|---|---|
| **japonais 2004→2026** (~25 700 produits) | **artofpkm**, mêmes ères jusqu'à MEGA, 419 sets | oui, mesurée | 593×834 (3 cartes d'un set ADV ; à remesurer par set) | idem §1 : silence, demande, attribution | après les 28 ; table set↔expansion par ère, vérifiée par comptes ; ~50 000 requêtes, ~70 h série |
| **occidental** (22 453 + part des 18 789) | **Bulbapedia** (tirage anglais, `imageinfo` par `api.php`, fichiers sur `archives…/media/` — permis, `Crawl-delay: 5`) | oui, mesurée sur l'échantillon EXP | par ère, fichiers vus le 12/09 : SV et MEE 660×920 à 735×1024 · SWSH, SM, XY, BW, HGSS 734×1024 · Expedition 574×800 · **DP 385×538 · EX 245–385 · Base Set 300–915** | fair use, aucune licence, Bulbagarden ne revendique rien : même statut, même attribution | **≥ 600 px à partir de HGSS (2010)** ; avant, mesure par set, 3 cartes ; un set sous 560 px reste **sans image**, jamais un autre tirage |
| occidental, alternative FR | Malie (malie.io) : rendus TCG Live en/fr/de/it/es/pt, « all sets up through Prismatic Evolutions » | page lue, **début de couverture et résolution NON lus** | à mesurer | attribution informelle ; images = rendus © TPC | à lire si un set occidental < 560 px chez Bulbapedia, ou pour le tirage FR |
| occidental, anglais | pokemontcg.io / pokemon-tcg-data | **403 à la lecture — NON CONCLUE** | de mémoire `_hires` 734×1024, non vérifié | non lues | ne pas utiliser avant lecture |

Une image occidentale décrit le PRODUIT Cardmarket (un produit pour toutes les langues d'un tirage
occidental) : l'anglais suffit à la fiche, le français serait mieux. **Jamais un tirage occidental
sur une fiche japonaise, ni l'inverse** — un visuel faux vaut moins que pas de visuel.

Même schéma, même bucket, même empreinte, mêmes trois comptes pour toutes les sources : on ne
collecte qu'une fois. Clé d'objet par source : `bulba/{pageid}/{fichier}` pour Bulbapedia.
