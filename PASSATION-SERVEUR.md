# Passation — serveur `pokemon-proxy`

Pour quelqu'un qui n'a rien lu. Les détails ne sont pas ici, ils sont référencés.

## 🔑 CE QU'IL FAUT POUR DÉBLOQUER CE CHANTIER — et rien d'autre

1. **Des scans qui portent `attaqueLue`.** Le champ est né le 2026-09-05 : **1 ligne sur 225**
   en porte une, et ce n'est pas une ligne du banc. Tant qu'il n'y en a pas, toute règle
   fondée sur l'attaque est **inerte** et aucun juste/faux/refus n'est calculable.
2. **La vérité du Ho-Oh n°250, saisie.** Deux désignations concurrentes, non tranché. Sans
   elle, le seul cas d'école du départage par l'attaque ne peut ni le valider ni l'infirmer.

Aucun raisonnement, aucune relecture des mêmes lignes sous un autre angle ne remplace ces
deux données. Le chantier attend des MESURES, pas des idées.

## L'état, au soir du 2026-09-05

**EN PRODUCTION** (poussé aujourd'hui, `main` = `a94f193`, Render déployé) :
- La fusion `chantier-image` → `main` : les 24 commits qui dormaient sont **en ligne**.
- **Le départage par l'attaque** — `departage-attaque.js`, quatre verrous, décide sur
  `idMetacard`. Prompt : `attaqueBrute` + `attaque` + `attaqueConfiance`.
  Réserve `attaque-departage`, niveau **faible**. ✅ Contrôlé en vrai le 2026-09-05 :
  katakana lus, rendus en anglais officiel, confiance haute, **phrase écrite alors qu'il n'a
  pas tranché**. C'était le critère.
- **`/ping` rend `version`** — `VERSION` exportée par `journal-scans.js`, jamais recalculée.
  On peut enfin dater le déploiement **sans consommer un scan**.
- Verrou vert (7 cellules + injection de panne), cliquet **52 couvertes, plancher 47**.

**ÉCARTÉ, AVEC SON CHIFFRE** — ne pas rouvrir sans donnée nouvelle :
- **Régime « sans périmètre »** : JUSTE 63 → **56** (−7), FAUX 8 → **25** (+17), REFUS 17 → 7.
  *Il retire 10 refus et crée 17 faux.* Son zéro de faux-et-affirmés est **tautologique**
  (toute sortie pose `incertain: true`). Mode `--sans-perimetre` gardé HORS SERVICE, pour
  que le chiffre soit rejouable.
- **Règle « attaque sur le vivier complet », niveau produit** : sur son propre cas d'école,
  **6 porteurs**, pas un. Au niveau métacarte elle s'active et rend un **groupe de six
  réimpressions** — elle déplace le problème d'un cran.
- **Piste « image de repli »** : 5 lignes Slowbro n°090 **justes par la route**, une seule
  photo hors forme. Les 3 faux-et-affirmés d'« image d'abord » sont un défaut du **régime**.
- **Piste « les `imageUrl` expirent »** : **0 morte sur 175**, la plus ancienne du 2026-08-02.
  Le `not-found` venait d'une **signature `?s=` tronquée** (catalogue, entrée 24).
- **Famille « l'image lit le physique »** : contrôle sec référence contre référence,
  `inliers(A,A)` médiane **150**, `inliers(A,B)` médiane **50**, contre **4 à 48** pour une
  vraie photo. Cas 3 de la clause : la **MÉTHODE** échoue, aucune technique ne séparera deux
  impressions par l'image. 157/157 paires mesurées, aucune vérité, aucune photo, aucun appel IA.
- **Test de lecture holo/mat** : **annulé sans être lancé, 0 € dépensé** — sans direction de
  vérité il mesurait la discrimination, pas la justesse, et la jointure le rendait sans objet.
- **`departagerParNumero` sur le vintage** : la jointure sépare **156/157 paires au
  CATALOGUE**, et ne peut **pas** s'appliquer aux SCANS — sur **0 clé sur 15**, le numéro lu
  correspond à un `numero` catalogue de la paire. Ces cartes n'impriment pas de numéro de
  collection ; c'est `numero: null` est FIDÈLE, vu du côté de l'usage.
- **Rareté comme discriminant** : `catalogue_produits` n'a aucune colonne de rareté.
- **Retrait du terme `prix`**, **dérivation des ponts par la taille du set**, **alarme
  Cardmarket**, **suffixe δ** (en attente d'une population où il ait un effet mesurable).

**EN ATTENTE DE DONNÉES** — rien à décider, seulement à mesurer :
- Les deux points en tête de ce fichier.
- **La mesure d'intervalle** : possible, **vide**. `prixVinted` non nul **0/224** —
  `/api/retour-live` n'avait pas de serveur pour l'écouter avant ce matin. Relancer
  `ad-intervalle.js` quand des scans auront porté un prix.
- **`écart ≥ 2`** et le plancher `i1` : hypothèses choisies APRÈS avoir vu les données, à
  confirmer sur des lignes fraîches.
- **Le raffinement de `imageStatut`** dans `departage-image.js` : seulement quand un
  dénominateur existera.
- 🔑 **Généraliser `egalite-sans-enjeu`** — verdict FERME quand tous les membres du groupe
  donnent le même verdict contre le prix de l'annonce. **La meilleure voie connue vers un
  verdict ferme**, bloquée par `prixVinted` non nul **0/225**. Même cause que l'intervalle.
- **Le régime « l'image propose la métacarte »** : 68 justes / 5 faux / 16 refus contre
  37/7/45 pour le texte, faux-et-affirmés 0 (tautologique). **73 % des sorties deviennent
  des fourchettes**, médiane 3 produits, 71 % sous 5. La décision n'est pas technique :
  c'est **« accepte-t-on de rendre une fourchette au lieu d'un produit »**, côté extension.

**DÉFAUTS CONFIRMÉS, correctif écrit mais NON APPLIQUÉ** :
- 🔴 **`MOTS_VIDES` détruit le « aucun » de `symboleSet`** — le prompt le déclare vraie
  réponse ([index.js:678](index.js)), la boucle de [index.js:786](index.js) le met à `null`.
  Journal : `"aucun"` **0/225**. ⚠️ Le correctif fabrique **deux instruments**, pas une
  correction : les mesures de symbole futures ne seront pas comparables aux anciennes.
- 🔴 **`rarete` affirme dans le doute** — *« Si tu n'es pas sûr, réponds "normale" »*
  ([:681](index.js)) plus le forçage serveur ([:813](index.js)). Journal : 157/225 `"normale"`,
  `null` jamais.
- ⚠️ **Trous en amont sur `number` et `total`** : le prompt n'offre aucune façon de dire
  « rien d'imprimé », alors que `numero: null` est FIDÈLE.
- ⚠️ **Un futur champ `finition` doit valoir `mat`, JAMAIS `aucun`** — `MOTS_VIDES`
  l'écraserait et on referait le défaut de `symboleSet` sur un champ neuf.
- **holo/mat est INEXPRIMABLE** : `reverse` défini contre l'holo, `motif:"aucun"` couvre
  mate ET holo, [:833](index.js) re-force `reverse:false`, `raretesElevees` sans holo.

**DETTES OUVERTES** :
- 🔴 **`apres()` du banc ≠ la route, depuis le 2026-08-08.** Toute colonne APRÈS lue d'ici
  sa correction est **suspecte** ; le seul chiffre lisible est FAUX ET AFFIRMÉ.
- **La branche reverse n'a jamais été vue vivante** — aucune ligne n'a jamais porté
  `strategieReverse` ; la 7e cellule du verrou reste inexerçable.
- **L'import des ponts est à ÉCRIRE, pas à relancer** : `prefill-tcgdex.js` saute tout
  produit ayant déjà une ligne, une relance écrirait **8 lignes**.
- **`vivierDeRepli`** — drapeau à poser, rouge avant vert.
- **Inventaire des valeurs d'un système externe figées chez nous** (chemins, versions, URLs).
- **Sauvegarde puis migration Atlas M10** — le testeur la lance lui-même.

## Décisions tranchées — ne pas les rouvrir

- **Lecture live conservée** — le cache servait une réponse périmée sur une route qui décide
  d'un prix.
- **Départage par l'image maintenu en « faible »** — l'effectif observé ne soutient pas la
  promotion.
- **`numero: null` est FIDÈLE** — ces cartes ne portent pas de numéro imprimé ; le chantier
  de collecte est abandonné.
- **Point unique de `champsDeRefus` : reporté** — huit sites, cinq corrects.
- **graphify : désinstallé** — 0 point sur 5 contre les défauts connus.

## Trois chiffres à ne pas reperdre

- **534 expansions sur 752** n'ont **aucun** pont TCGdex.
- **11 243 ms** de scoring sur **720** candidats (cas Milotic, production).
- **43 %** des scans ne finissent sur **aucun verdict ferme**.

## Mesures du 2026-09-04 — lecture seule sur `test`, aucune écriture

### A. Le cas Milobellus : le verdict est CLASSEMENT, pas vivier

**L'image tranche BIEN en production.** Le branchement est daté du 2026-08-29 et il est
**dans `main`** (tête `1445178`, index.js L4303-4327) : `chantier-image` n'a rien à voir
avec sa présence. Et il n'est **plus inerte** : `references_image` porte **70 214 vecteurs
`indexee` à 150 points** sur 73 188 produits (97,7 % de couverture ; 1 251 `hors-perimetre`,
24 `absente`). `imageStatut` est écrit sur **25 lignes du journal sur 222**.

**Les deux refus Milobellus** (`6a9939352d1b97d8f5f9f777` et `6a9938b12d1b97d8f5f9f767`,
2026-09-03, version `144517812f61`) : nom lu « Milotic » (`nomBrut` « Milobellus »,
`nomConfiance: haute`), numéro **5**, total **101**, **setCode `null`**, langue **FR**,
`symboleSet: null`, motif `egalite-parfaite`, `nbCandidats: 720`, **92 ex aequo**,
`raisonReserve: null`, `natureRefus` **absent du document** (le champ n'existe pas sur
`main`), `imageStatut: null`.

🔑 **La bonne carte EST candidate.** `277210` — *Milotic δ Delta Species*, exp 1553 (DF),
`numero: 5`, `codeSet: DF` — figure dans les `vivierIds` écrits (200 des 720). Elle n'est
**pas** dans les 92 ex aequo : elle a donc été **classée strictement en dessous** du sommet.
Les 92 ex aequo sont des cartes sans rapport entre elles (Tangrowth, Hoothoot, Blissey…),
**zéro** vient de Dragon Frontiers.

Ce qui l'a fait perdre est en amont : son nom catalogue est
`Milotic δ Delta Species [Sharing | Flare]`, qui ne se normalise pas en `milotic`. Le vivier
par le NOM ne contient que **45 produits sur les 81** qui portent « Milotic », et 277210 n'y
est pas ; le repli par le NUMÉRO a donc construit un vivier de 720 où elle n'a plus aucun
bonus de nom. **Le pont TCGdex n'y est pour rien** (exp 1553 : 0 ligne pontée sur 102 — c'est
vrai, mais ce n'est pas la cause : la carte est candidate).

Et l'image ne pouvait pas la sauver, pour deux raisons **indépendantes** :
la sortie `egalite-parfaite` se fait **avant** le bloc image (L4482 contre L4303), et la
langue est FR → `GARDE_PERIMETRE_ASIATIQUE` aurait rendu `hors-condition`. Accessoirement
la garde « tous ou abstention » aurait échoué de peu : **91 des 92** ex aequo ont un vecteur.

### B. Le vivier vide : la recherche globale par l'image, mesurée

**Population.** 10 refus sur 40 (222 lignes au journal) ont un vivier vide
(`motifEchec` ∈ {`aucun-candidat`, `carte-introuvable`}) — **tous japonais**, tous entre le
2026-08-02 et le 2026-08-15. **10 sur 10 portent une `imageUrl`, et les 10 se
retéléchargent aujourd'hui** (HTTP 200, webp, 56 à 187 ko, 177-393 ms). ⚠️ Sur ces 10 lignes
`vivierTaille` est **absent** (le champ n'existe que sur 50 lignes sur 222) : le vivier vide
se lit par le motif, pas par le compteur.

**Recherche ORB contre les 70 214 vecteurs**, réglages de production (150 points, 640 px,
Lowe 0,75, RANSAC 5,0), code recopié de `departage-image.js` :

| carte lue | 1er | 2e | écart | le 1er porte-t-il le nom lu ? |
|---|---|---|---|---|
| Mewtwo 150 | **42** | 7 | +35 | oui |
| Dragonite 149 | **39** | 14 | +25 | oui |
| Flaaffy 180 | **38** | 15 | +23 | oui |
| Marowak 105 | **34** | 20 | +14 | oui |
| Koga's Ditto 132 | **29** | 12 | +17 | oui |
| Dark Kadabra 064 | **29** | 15 | +14 | oui |
| Pidgeotto 017 | **25** | 9 | +16 | oui |
| Abra 063 | **20** | 7 | +13 | oui |
| Dragonite 180 | **14** | 10 | +4 | oui |
| Natu 177 | **63** | **62** | **+1** | oui — mais les deux sont des « Natu [Confuse Ray] » |

**10 sur 10** : le premier porte le nom que l'IA avait lu. ⚠️ **Ce n'est PAS 10/10 de
justesse** : rien ici ne vérifie le TIRAGE (le set, la variante). Le cas Natu le montre —
63 contre 62 entre deux cartes homonymes. La vérification demanderait le banc de vérités,
qui n'a pas été touché.

**Distribution, pas moyenne.** Sur les 70 214, pour chacune des 10 : `p50 = 0`,
`p90 ∈ {0, 4}`, `p99 ∈ {4, 5, 6}`, `p99.9 ∈ {5, 6, 8}`. Le fond est écrasé ; le signal est
un pic isolé. Combien de vecteurs au-dessus d'un seuil, selon la carte :
`≥4` : 2 727 à 13 199 · `≥8` : 1 à 132 · `≥12` : 1 à 5 · `≥15` : **0 à 3**.
Un seuil à **15** laisse 0 ou 1 candidat sur 8 des 10 — mais **rate Dragonite 180**, dont le
maximum est 14. Un seuil à **12** l'attrape et laisse ≤5 candidats partout. Aucun seuil
mesuré ici ne sépare les deux Natu.

**Coût.** Chargement de l'index : 7,1 s / **597 Mo de RSS**. Recherche : **43 841 à
52 229 ms** (médiane ~47 s), soit **0,62 à 0,74 ms par vecteur**, sur le poste du testeur.
À comparer aux **11 243 ms** de scoring du cas Milotic : la recherche globale coûte **~4×
le budget total d'un scan**, avant même de compter que Render est plus lent. Elle ne double
pas le budget, elle le quintuple.

⚠️ **Deux limites d'instrument à ne pas oublier.** (1) Le premier passage a tenté les 10
photos dans un seul processus et **a planté** (abort WASM, `1073716656`) après la première :
les 9 autres ont tourné un processus par photo. (2) Deux lots ont tourné **en parallèle** ;
seule la première mesure (50 029 ms) est isolée, les autres peuvent être contaminées — elles
sont du même ordre, ce qui rend la contamination faible mais non nulle.

**B5 — un pont « code de set imprimé » sans TCGdex.** `numeros_cartes` porte un `codeSet`
sur **534 des 534** expansions sans pont. Sur 750 `codeSet` distincts, **2 seulement** sont
portés par plusieurs expansions (`30th-P`, `WCD18`), et 2 expansions portent plusieurs codes.
Donc **532 des 534 seraient couvertes sans ambiguïté**, hors ligne, sans TCGdex.
⚠️ Ce chiffre dit que le code est une CLÉ dans notre table. Il ne dit pas qu'il est **lisible
sur la carte**, ni que le code Cardmarket est celui **imprimé** — c'est la mesure qui manque.

### C. graphify — 1 point sur 5, seuil 3 non atteint

Installé (`uv tool install graphifyy`, déjà présent, `graphify.exe` dans `~/.local/bin`).
Extraction locale sans LLM : `graphify extract . --code-only --out <hors dépôt>` →
91 fichiers, **869 nœuds, 1 399 arêtes**, en une passe. Les 5 questions ont été écrites
avant le lancement.

1. Sites d'appel de `champsDeRefus(` dans `index.js` → **0**. Il rend « degree 4 » et un
   `indirect_call` à L6121 (l'export). Les **6 vrais appels** (3401, 3722, 4196, 4302, 4482,
   5474) sont dans des corps de `app.post`, que l'extracteur AST ne descend pas.
2. Qui mute `setTcgdex` en base → **0**. Rend `expansionsDuSetTCGdex`, `apprendreUnSet`,
   `{ execFileSync }` ; manque `prefill-tcgdex.js:448` et `corriger-lien-base1.js:88`.
3. `departage-image.js` atteignable depuis `/api/identifier` → **0** (partiel). Il donne
   l'import (`index.js:L78`) mais aucune route n'est un nœud : la chaîne demandée n'existe pas.
4. Exports de `index.js` + consommateurs → **0** (partiel). Les 14 consommateurs sont justes,
   la liste des exports n'est pas rendue.
5. Qui requiert `./scoring` → **1**, et il a **corrigé ma propre mesure** : mon grep
   `require('./scoring')` rendait 21 fichiers, graphify en rend **22** — `banc-japonais.js:131`
   écrit `require('./scoring.js')`. 🔑 20e erreur d'instrument, de mon côté : un motif de grep
   trop étroit, exactement la faute du dénominateur mal pris.

**Ce qu'il vaut, en une phrase** : bon sur les arêtes de MODULE (imports, et plus complet
qu'un grep naïf), aveugle aux appels à l'intérieur des handlers Express — c'est-à-dire
aveugle à tout le chemin d'un scan.

## Mesures du 2026-09-04, second tour — le terme manquant, et ce qu'il coûte de le corriger

### 0. Ce qui est réellement déployé

`git log main --since=2025-08-25` : **255 commits**, tête `1445178` du 2026-08-30.
`6b74061 Branche le departage par l'image, inerte tant que references_image est vide` **est
dessus**. `natureRefus`, `originePrix` et les champs d'état ne le sont pas : ils sont sur
`chantier-image`, jamais fusionné. Constaté, pas déduit.

### 1. 🔑 LE TERME MANQUANT EST **`prix`**, ET IL VAUT 25 POINTS

Rejeu de la ligne `6a9939352d1b97d8f5f9f777` avec les fonctions **exportées de production**
(`trouverProduitsParNumeroPartout`, `scorerCandidatsLocal`), aucune réimplémentation. Le
rejeu **reproduit la production à l'identique** : 720 candidats, 92 ex aequo, tête à 120.

| terme | 277210 — Milotic δ, DF | 691722 — Tangrowth, CRZ (sommet) |
|---|---|---|
| numero | **+50** (match 5) | **+50** (match 5) |
| set | 0 (set non déterminé) | 0 (set non déterminé) |
| variante | 0 | 0 |
| motif | 0 | 0 |
| image | 0 (pas d'image) | 0 (pas d'image) |
| **prix** | **0** — prix **4,42 €** « incohérent avec rareté lue » | **+25** — « carte normale, prix bas **0,08 €** » |
| region | +45 (occidental) | +45 (occidental) |
| secret | 0 | 0 |
| **TOTAL** | **95** — rang **103 / 720** | **120** |

**Réponse à la question posée.** Aucun des deux ne gagne de points de nom — parce que
**`scorerCandidat` n'a AUCUN terme de nom**. Le nom ne sert qu'à construire le VIVIER ; une
fois le repli par le numéro déclenché, il ne pèse plus rien. Ce qui sépare les deux cartes
est le seul terme où elles diffèrent : **le prix**. La règle « carte normale → prix bas
(< 3 €) → +25 » récompense la carte **banale** et abstient la carte **chère**. Milotic δ
cote 4,42 € : elle est punie d'être une carte de valeur. Paliers observés :
`120→92 · 95→83 · 75→128 · 50→90 · 30→262 · 5→63`. Les 92 du sommet sont exactement les
« n°5 à moins de 3 € en région occidentale ».

**Le total lu (101) ne sert à rien, mesuré.** Sur les 92 ex aequo, **1 seul** appartient à
une expansion de 101 lignes. Et Dragon Frontiers, dans notre base, compte **102** lignes,
pas 101 : même une règle par la taille du set n'atteindrait pas DF.
⚠️ `setsPourTotal(101)` a rendu `[]` pendant le rejeu **parce que TCGdex était injoignable**
(`ECONNREFUSED`) — ce résultat-là n'est pas une mesure de la production. Ce qui l'est : le
rejeu a reproduit 720/92/120 exactement, donc le total ne restreignait rien non plus ce
jour-là.

### 2. Le suffixe FERMÉ « δ Delta Species » : mesuré, et il tient

Le catalogue porte **388 produits sur 73 188 (0,53 %)** dont le nom nu finit par
« δ Delta Species ». (Le dépôt notait « +39 candidats » sur **41** noms ; ici c'est sur
**149**, les deux ne se comparent pas.)

Sur les **222 lignes du journal / 149 noms distincts** :
- **+110 candidats au total**, **médiane 0**, **pire cas 8** (« Pikachu ») ; 41 noms sur 149
  gagnent au moins un candidat. Vivier médian actuel : 46.
- **+81 ms par scan** (médiane) — et c'est une **borne HAUTE** : la mesure ajoute une
  seconde requête Mongo, là où une implémentation élargirait la comparaison déjà faite.
- **9 lignes changent sur 76 concernées** : 5 ne gagnent qu'un ex aequo (même gagnant),
  et **4 changent de gagnant, toutes au profit d'un produit δ** :

| ligne | avant | après |
|---|---|---|
| **Milotic n°5 FR** (×2) | 769224 — **70 pts, 11 ex aequo → refus** | **277210 Milotic δ — 95 pts, 1 ex aequo** |
| Pikachu n°112 ZH | 784396 — 5 pts, **76 ex aequo → refus** | 570663 Pikachu δ — 10 pts, 1 ex aequo |
| Altaria ex n°019 JP | 787601 — 70 pts, 24 ex aequo | 761858 Altaria ex δ — 95 pts, 1 ex aequo |

🔑 **La mesure ne contredit pas la règle du suffixe fermé, elle la confirme** : contrairement
au préfixe refusé (Charizard 84→281, +3 s), le suffixe **fusionne** — médiane 0, pire cas 8.
Et il transforme **trois refus en identifications à un seul candidat**.
⚠️ **Le cas qui doit être tranché avant tout câblage** : Altaria ex passe d'un scan ABOUTI à
un **autre** gagnant (le journal disait 784363). Sans vérité, on ne sait pas si c'est un gain
ou une régression — et c'est le seul des quatre qui touche une ligne qui marchait.

### 3. Les 10 tirages ORB : **INVÉRIFIABLES** — le banc est vide

`banc-verites.json` a été lu **en lecture seule**, hors saisie (aucun processus node en
cours, fichier inchangé depuis le 2026-08-21). Il contient deux clés : `_lisezMoi` et
`verites`. **`verites` est un tableau VIDE — 0 entrée.**
Les 66 vérités du commit `f5b455c` ne sont donc plus dans ce fichier ; où qu'elles soient,
elles ne sont pas là. **Dénominateur : 0 des 10 scans a une vérité au banc.**

Le tableau demandé ne peut donc porter que la colonne « inliers », pas la colonne
« juste/faux » :

| carte | ORB #1 | i1 | i2 | écart | juste ? |
|---|---|---|---|---|---|
| Mewtwo 150 | 549051 Mewtwo | 42 | 7 | 35 | **inconnu** |
| Dragonite 149 | 654099 Dragonite | 39 | 14 | 25 | **inconnu** |
| Flaaffy 180 | 606441 Flaaffy | 38 | 15 | 23 | **inconnu** |
| Marowak 105 | 584681 Marowak | 34 | 20 | 14 | **inconnu** |
| Koga's Ditto 132 | 605387 Koga's Ditto | 29 | 12 | 17 | **inconnu** |
| Dark Kadabra 064 | 585101 Dark Kadabra | 29 | 15 | 14 | **inconnu** |
| Pidgeotto 017 | 549081 Pidgeotto | 25 | 9 | 16 | **inconnu** |
| Abra 063 | 585095 Abra | 20 | 7 | 13 | **inconnu** |
| Dragonite 180 | 698502 Dragonite Lv.61 | 14 | 10 | 4 | **inconnu** |
| Natu 177 | 606563 Natu | 63 | 62 | 1 | **inconnu** |

**L'écart sépare mieux qu'un seuil absolu — sur ces deux cas, et c'est tout ce qu'on peut
dire.** Les deux cas qui décident : Dragonite 180 (**14 inliers, écart 4, +40 %**) doit être
ACCEPTÉ, Natu (**63 inliers, écart 1, +1,6 %**) doit être REFUSÉ.
- Un seuil **ABSOLU sur les inliers** échoue par construction : il faudrait un seuil
  ≤ 14 pour garder Dragonite, et Natu est à 63. **Aucun seuil absolu ne traite les deux.**
- Un seuil sur l'**ÉCART** les traite : « écart ≥ 2 » accepte Dragonite (4) et refuse Natu (1).
  Un seuil **RELATIF** aussi : « 1er ≥ 1,2 × 2e » accepte Dragonite (+40 %) et refuse Natu (+1,6 %).

🔑 **Et c'est exactement pourquoi il ne faut pas le poser aujourd'hui** : le seuil serait
choisi APRÈS avoir vu les deux seuls points qu'il doit séparer, sur 10 scans dont **aucun
n'est vérifié**. Ce serait ajuster un paramètre sur l'échantillon qui sert à le valider —
la faute d'instrument classique, en plus grave, parce qu'ici la mesure de justesse
n'existe même pas. **Pas de seuil tant que le banc est vide** ; ce qui est acquis, c'est
que la forme de la règle est un ÉCART, pas un niveau.

### 4. Le coût, séparé

**(a) Le matching domine, largement.** Chargement de l'index : **7,1 à 8,1 s**. Matching :
**43 841 à 52 229 ms**. Facteur **~6**, et seul le matching croît avec la taille de l'index.
Le chargement, lui, est amortissable ; le matching non.

**(b) Borner par la langue.** Sur les 70 214 vecteurs, `regionDuCodeSet` (fonction de
production) rend **japonais pour 25 109**, **occidental pour 0**, **indéterminé pour 42 986**,
et **2 119** vecteurs n'ont aucune ligne `numeros_cartes`.
- borne **honnête** (on garde l'indéterminé, comme on garde un candidat sans vecteur) :
  **70 214 vecteurs, 47,3 s — aucun gain.**
- borne **agressive** (japonais positif seulement) : **25 109 vecteurs, ~16,9 s.**

**(c) Fenêtre d'années : NON CALCULABLE.** `dateAdded` existe bien en production
(**61 826 des 70 214 vecteurs, 88,1 %**) — mais sa distribution est
`2015:270 · … · 2021:12957 · 2025:14520 · 2026:9985` et **commence en 2015**. C'est la date
d'entrée au catalogue **Cardmarket**, pas l'année d'impression : une carte de 1999 y est
datée 2015. Toute fenêtre « vintage » rend **0**. 🔑 J'ai failli l'annoncer utilisable parce
que le champ est présent à 88 % — le dénominateur était juste, le SENS du champ ne l'était
pas. Aucun autre champ d'année n'existe (`annee`, `year`, `dateSortie`, `releaseDate` : 0
partout, sur les trois collections).

### 5. graphify contre les cinq défauts connus : **0 / 5**

Graphe : `graphify extract . --code-only` (AST local, sans LLM), 91 fichiers,
**869 nœuds / 1 399 arêtes**, sorti hors du dépôt.

| # | défaut | requête exacte | rendu | pt | angle mort |
|---|---|---|---|---|---|
| 1 | `departagerParImage` : refus ou succès ? | `graphify explain "departagerParImage"` puis `graphify affected "departager" --depth 1` | « Ambiguous, 2 nœuds » ; puis seulement `index.js [imports] L78`. Ne voit ni **L4454** (refus) ni **L4663** (succès). | 0 | **corps `app.post`** |
| 2 | `symboleSet` → `enregistrerEchec` ? | `graphify path "symboleSet" "enregistrerEchec"` | `No node matching 'symboleSet' found` | 0 | **autre classe** : le graphe n'a pas de nœud de CHAMP, seulement des fonctions |
| 3 | appelants de `lireCache`/`ecrireCache` | `graphify affected "lireCache" --depth 2` · `graphify explain "ecrireCache"` | `No affected nodes found` ; et pour `ecrireCache` : `contains` + `calls cleKey`, **aucun appelant**. Vérité : un seul appel chacune, **L2803** et **L2974**, dans `/api/analyser`. | 0 | **corps `app.post`** |
| 4 | qui appelle `/api/retour-live` | `graphify query "who calls the /api/retour-live endpoint"` | 4 nœuds choisis par ressemblance de NOM (`live-cardmarket.js`, `test-retour-live.js`, `mesure-retours-live.js`) + un nœud parasite (un bloc `require` entier pris pour un nœud). Vérité : la route est déclarée **L5507** et le seul appelant du dépôt est `test-retour-live.js`. | 0 | **autre classe** : un appel HTTP n'est pas une arête de code — il n'y a rien à trouver |
| 5 | bloc `etat` L5176 → `enregistrerScan` ? | `graphify explain "enregistrerScan"` | 7 arêtes, dont `<-- index.js [imports] L59` et `<-- enregistrerEchec [calls]`. **Aucune arête depuis `/api/identifier`**, alors que L5176 est littéralement *à l'intérieur* de l'appel ouvert L5173. | 0 | **corps `app.post`** |

**D'où vient l'échec** : **3 des 5** (1, 3, 5) tombent dans l'angle mort **déjà mesuré** — les
appels écrits dans un corps de `app.post`. Les **2 autres** sont d'une classe différente :
le n°2 demande un CHAMP (le graphe est fonction-à-fonction), le n°4 demande un lien HTTP
(aucune arête de code ne l'exprime). Donc : l'outil échoue là où il a déjà été mesuré
aveugle, et deux des questions ne sont pas des questions de graphe d'appel.

**Ce qu'il a rendu de juste, à ne pas jeter** : `enregistrerEchec → enregistrerScan`
(journal-scans.js:1120), et les 22 fichiers qui requièrent `./scoring` — un de plus que mon
grep.

## Mesures du 2026-09-04, troisième tour

### 0. 🔴 CORRECTION — les 71 vérités n'ont JAMAIS été perdues, je les avais mal lues

`verites` est un **OBJET** (clés `H001…H033`, `L026…L065`), pas un tableau. Mon script
cherchait `Object.values(...).find(Array.isArray)` et retombait sur `|| []` : d'où le
« 0 entrée » annoncé au tour précédent. **21e erreur d'instrument, et la plus coûteuse de la
série** : elle a fait déclarer un instrument détruit alors qu'il était intact, et elle a
conclu « invérifiable » sur une question qui ne l'était pas.
Aucun commit n'a vidé le fichier : les quatre versions de l'historique
(`f7c3183` 32 clés, puis `3a5bfc1`, `d7c5656`, `3ffdc1e` = HEAD, 71 clés chacune) sont
cohérentes. **Rien à récupérer, rien à restaurer.**

**Ce que le banc couvre vraiment.** Les vérités s'attachent par ce qui a été LU
(`lu.nom` + `lu.numero`), pas par un identifiant de scan. Sur ce rattachement :
**89 des 222 lignes du journal ont une vérité**, et les 71 servent toutes au moins une fois.
Sur ces 89 : **57 justes · 17 faux · 15 refus**.

**Et les 10 tirages ORB restent invérifiables — pour une raison corrigeable.** Aucun des 10
scans à vivier vide n'a de vérité : ce sont des scans du 2026-08-02 au 08-15, le holdout a
été saisi sur d'autres. Le seul quasi-appariement (`L044 Dark Dragonite/149`) est un AUTRE
scan (2026-08-08, abouti) que le nôtre (2026-08-03, `aucun-candidat`). 🔑 **Il manque
10 saisies, pas un instrument.**

### 1. Retrait du terme `prix` : il coûte 6 refus et en rend 1

Méthode : les deux bras partagent le **même vivier** (par le nom) ; la contribution du terme
est **retranchée du score à partir de `detail.prix`**, le code n'est pas touché. Le départage
« à score égal, le moins cher » n'est PAS retiré — c'est le TERME qu'on mesure, pas le tri.
Sur **221 lignes scorables** (1 vivier vide) :

| transition | n |
|---|---|
| même gagnant qu'avant | **219 / 221** — seulement **2** changent |
| abouti → abouti | 133 |
| **abouti → REFUS** | **6** 🔴 |
| **refus → abouti** | **1** ✅ |
| refus → refus | 81 |

Taille du sommet : médiane **1 avant, 1 après** ; max **76 avant, 76 après**. Le retrait ne
fabrique donc **pas** de grands groupes — les six nouvelles égalités sont minuscules :

| ligne | groupe | l'image peut-elle trancher ? |
|---|---|---|
| Bayleef n°007 JP | 2 | **oui**, tous vectorisés |
| Erika's Victreebel n°071 JP | 2 | **oui**, tous vectorisés |
| Cynthia's Ambition n°236 KR | 2 | **oui**, tous vectorisés |
| Azurill n°086 JP | 5 | **oui**, tous vectorisés |
| Mewtwo n°51 FR | 2 | non — hors périmètre asiatique |
| Zekrom n°TG05 FR | 2 | non — hors périmètre asiatique |

**4 départageables · 0 bloquées par la garde · 2 hors condition.** Le solde brut est −5 ;
si l'image tranchait ses 4, il serait **−1** (2 refus FR nouveaux contre 1 gain).

🔴 **ET LE POINT QUI DÉCIDE : le retrait du prix NE RÉPARE PAS MILOBELLUS.** Sur le vivier
par le nom, Milotic δ n'est pas candidate — c'est le défaut de vivier, pas celui du barème.
Les deux défauts sont **indépendants** et le prix n'est la cause que du RANG de 277210 une
fois le repli par le numéro déclenché.

### 2. La garde d'abstention : elle ne bloque QUE les grands groupes

Sur les 221 lignes, l'image ne se déclenche pas 119 fois (`le scoring sépare` 58 ·
`hors périmètre asiatique` 53 · `un seul candidat` 8). Sur les **102 restantes** :

| taille du groupe | groupes | bloqués | taux |
|---|---|---|---|
| 1-3 | 19 | 0 | **0 %** |
| 4-10 | 12 | 0 | **0 %** |
| 11-30 | 2 | 0 | **0 %** |
| **31+** | **69** | **33** | **48 %** |

🔑 La garde est **gratuite en dessous de 31 candidats et coûte la moitié au-dessus** — et
**68 % des groupes déclenchés sont des 31+**. Le compteur d'abstentions mesure donc surtout
des viviers malades, exactement ce qui était écrit dans `departage-image.js`.

**Le 42/44 a-t-il été mesuré sur des groupes de la même taille ? OUI pour la taille, NON
pour le régime.** Population du banc (89 lignes) contre le reste (132) :

| | vivier (médiane / p90 / max) | groupe départagé (médiane / p90 / max) | garde sur les 31+ |
|---|---|---|---|
| **avec vérité** (le banc) | 50 / 132 / 455 | **46 / 98 / 455** | 15 bloqués sur 41 — **37 %** |
| sans vérité | 56 / 103 / 455 | **56 / 455 / 455** | 18 bloqués sur 28 — **64 %** |

Les tailles sont du même ordre. **L'écart est ailleurs, et il est entier** : le 42/44 vient
du régime « vivier COMPLÉTÉ » — la vérité est **injectée** dans le vivier, tous les scores
sont mis à 0, et le classement est calculé **sans passer par `departager`**. Dans ce régime
**la garde ne s'exécute jamais**. Le 42/44 répond donc à « la vérité étant présente et la
garde neutralisée, l'image la classe-t-elle première ? » ; la production pose « la garde
laisse-t-elle l'image parler ? » — et la réponse mesurée est **non, une fois sur deux, sur
les 68 % de groupes qui comptent**.

### 4. graphify est désinstallé

Retiré (`graphify uninstall` puis `uv tool uninstall graphifyy`, 2 exécutables supprimés).
**Il n'avait rien écrit dans le dépôt** : aucune section dans `CLAUDE.md`, aucun hook git,
aucun `graphify-out/` — l'extraction était sortie hors du dépôt. **`.claudeignore` n'existe
pas dans ce dépôt**, il n'y avait donc rien à en retirer.

> **Pourquoi il sort** : 0/5 sur les cinq défauts connus — 3 tombent dans l'angle mort mesuré
> (les appels écrits dans un corps `app.post` ne sont pas des arêtes), et 2 sont hors de sa
> portée par construction (un CHAMP, un lien HTTP).

## Mesures du 2026-09-04, quatrième tour

### 0. Catalogue des erreurs d'instrument — `|| []` sur une lecture est un `catch → []`

> **`|| []` et `|| {}` sur une lecture de fichier sont le MÊME défaut que `catch → return []` :
> « je n'ai pas su lire » rendu comme « il n'y a rien ». `sources.js` protège la ROUTE ; il ne
> protège aucun script de mesure, et c'est là que le défaut est passé.**

**Recensement des outils, sans correction.** Quatre lectures de fichier tenu à la main portent
le motif :

| fichier | ligne | ce qu'il lit | verdict |
|---|---|---|---|
| `mesure-cloture-pages.js` | 115 | `banc-verites.json .verites \|\| []` | **type menteur, sans dégât ici** : le consommateur (`banc-seaux.js:197`) fait `Object.entries(verites \|\| {})`, qui marche sur un objet |
| `mesure-separation-illustration.js` | 80 | `banc-verites.json .verites \|\| []` | **type menteur**, même forme, à vérifier au consommateur |
| `banc-japonais.js` | 265 | `.verites \|\| {}` dans `try {} catch (_) {}` | **type juste**, mais le `catch` VIDE transforme une lecture ratée en « aucune vérité » |
| `banc-seaux.js` | 50, 69 | `banc-verification.json .cartes \|\| []` · `banc-lots.json .fenetres \|\| []` | mêmes fichiers tenus à la main, même motif |

Les autres `|| []` du dépôt portent sur des **retours d'API ou de requête** (`r.data?.cards`,
`brut.products`, `st.indexSizes`), où l'absence est une vraie information — ce n'est pas le
même cas. `mesure-cloture-pages.js:115` est le seul à avoir un `catch` qui PARLE
(« banc-verites.json illisible : on ne conclut pas ») : c'est la bonne forme.

### 1. 🔴 LE PRIX SUR LE VIVIER PAR LE NUMÉRO : IL NE CHANGE **RIEN**, ET L'IMAGE COÛTE 12 FAUX

Population : les **87 lignes** qui ont une vérité **et** un numéro lu, viviers reconstruits par
`trouverProduitsParNumeroPartout` — le chemin de REPLI, celui où Milobellus a échoué.

| transition | n |
|---|---|
| **même gagnant dans les deux bras** | **87 / 87** |
| juste → juste | 18 |
| faux → faux | 4 |
| **juste → refus** | 1 |
| refus → refus | 64 |
| **« faux gagnant » → ÉGALITÉ PARFAITE** | **0** |

🔑 **Le retrait du terme `prix` ne déplace aucun gagnant sur cette population.** Sur le vivier
par le numéro, les candidats sont si nombreux que le sommet est déjà une égalité (64 refus sur
87) : retirer 25 points à tout le monde ne réordonne rien.

**Et le défaut qui domine tout le reste : la vérité est ABSENTE du vivier sur 59 des 87 lignes.**
Aucun barème, aucune image ne rattrape ça.

**Solde final, APRÈS l'image** (l'image appliquée aux égalités du bras sans prix) :

| | justes | faux | refus |
|---|---|---|---|
| avant (barème actuel) | **19** | 4 | 64 |
| après (prix retiré + image) | **19** | **16** | 52 |
| delta | **0** | **+12** | −12 |

**1 juste gagné** (`Fisherman n°079`, refus → juste), **1 juste perdu** (`Mewtwo n°51`,
juste → refus), et **12 refus convertis en FAUX**. Sur cette population l'image ne trouve pas
ce qui n'est pas là : elle transforme une abstention honnête en affirmation fausse.

**🔴 MILOBELLUS N'EST PAS RÉPARÉ — IL EMPIRE.** Sur les deux lignes : avant, tête 120 et
**92 ex aequo** ; après retrait du prix, tête 95 et **175 ex aequo**. 277210 est bien remonté
au sommet — *avec 174 autres*. Le résultat reste un refus, sur un groupe deux fois plus gros.

### 2. La justesse de l'image, enfin mesurée — 57 lignes du banc

Rejeu ORB sur les lignes du banc où l'image se déclenche, code de production
(`conditionDeclenchement`, `chargerVecteurs`, `decrire`, `inliers`), photos retéléchargées.

| régime | justes | fausses | n |
|---|---|---|---|
| **garde PAR GROUPE** (production) — groupes non bloqués | **39** | **4** | 43 (**90,7 %**) |
| *les groupes bloqués : la production s'abstient* | — | — | **14 lignes perdues** |
| **garde PAR CANDIDAT** — toutes les lignes déclenchées | **49** | **8** | 57 (**86,0 %**) |
| ↳ dont celles que la garde par GROUPE bloquait | **10** | **4** | 14 |

### 3. La garde par CANDIDAT : +10 justes, +4 fausses, −14 abstentions

Sur les **102 groupes** de la production, la garde par groupe en bloque **33** ; une garde par
candidat les débloque tous (il reste au moins un vecteur). Sur les **14 lignes vérifiables**
concernées, elle produit **10 justes et 4 fausses**. Le taux global passe de **90,7 % sur 43**
à **86,0 % sur 57** : on perd 4,7 points de justesse pour gagner **14 lignes servies**.
Chiffres seuls — la décision est un arbitrage produit, pas une mesure.

### 3bis. 🔴 AUCUNE RÈGLE SUR L'ÉCART NE SÉPARE LES JUSTES DES FAUSSES

Distributions, pas moyennes, sur les 57 lignes :

| | n | min | p10 | médiane | p90 | max |
|---|---|---|---|---|---|---|
| **écart** · justes | 49 | 2 | 3 | **16** | 31 | 37 |
| **écart** · fausses | 8 | 0 | 0 | **17** | 22 | 22 |
| i1 · justes | 49 | 6 | 12 | 26 | 40 | 62 |
| i1 · fausses | 8 | 4 | 4 | 25 | 39 | 39 |

**La médiane des fausses (17) est AU-DESSUS de celle des justes (16).** Les deux populations
se recouvrent presque entièrement, sur l'écart comme sur le niveau.

| seuil | justes gardées | fausses gardées | justes perdues |
|---|---|---|---|
| écart ≥ 1 | 49 | 7 | 0 |
| **écart ≥ 2** | **49** | **5** | **0** |
| écart ≥ 3 | 46 | 5 | 3 |
| écart ≥ 10 | 35 | 5 | 14 |
| écart ≥ 20 | 21 | 2 | 28 |

🔑 **Le seul seuil gratuit est `écart ≥ 2`** : il retire 3 des 8 fausses sans perdre une seule
juste (ce sont les cas à écart 0 ou 1, dont Natu). **Au-delà, chaque fausse retirée coûte des
justes.** Et il reste 5 fausses à fort écart (jusqu'à 22) qu'aucune règle d'écart n'atteint.
Le ratio ne fait pas mieux (`ratio ≥ 2` : 37 justes / 4 fausses).
**Réponse : non, il n'existe pas de règle sur l'écart qui sépare.**

⚠️ Les 10 scans à vivier vide restent **NON MESURÉS** et ne sont pas dans ces chiffres.

### 4. Ce que le 42/44 mesure vraiment — correction, pas suppression

> **Le 42/44 n'est PAS un taux de justesse de production.** Il a été obtenu en régime « vivier
> COMPLÉTÉ » : la vérité est **injectée** dans le vivier, tous les scores sont mis à 0, et le
> classement est calculé **sans passer par `departager`** — donc **la garde d'abstention ne
> s'exécute jamais**. Il répond à « la vérité étant présente et la garde neutralisée, l'image
> la classe-t-elle première ? ».
> **Le chiffre qui le remplace** : **39/43 (90,7 %) en garde par GROUPE**, ou **49/57 (86,0 %)
> en garde par CANDIDAT**, mesurés le 2026-09-04 sur les lignes du banc, garde comprise et
> vivier non truqué — avec, à côté, le chiffre que le 42/44 cachait : **la vérité est absente
> du vivier sur 59 des 87 lignes du chemin par le numéro**.

## Mesures du 2026-09-05

### 0. Les 12 faux sortent SOUS RÉSERVE FAIBLE — et la vérité n'est dans AUCUN des 12 groupes

État de sortie, **déterminé par le code, pas par une mesure** : `departageParImage = true` entre
dans `carteAmbigue` (index.js L4695+) → `carteIncertaine = true` ; `raisonReserve` =
`'image-departage'` (L4829) ; `niveauReserve` = `'faible'` (L4976). Les seules raisons
prioritaires atteignables ici — `impression-corrigee`, `impression-contredite`,
`nom-seul-vintage` — sont **toutes `'faible'`** aussi ; `symbole-departage` (`'forte'`) est
exclu par construction, l'image **s'abstient** quand le symbole a tranché.
**Aucune des 12 n'est affirmée.**

⚠️ **Ce que l'utilisateur LIT n'est PAS dans ce dépôt.** Le serveur n'émet que
`niveauReserve` + `raisonReserve` ; le texte est construit par l'extension, qui est un autre
dépôt (« le NIVEAU pilote le comportement de l'extension, la RAISON alimente son texte »,
index.js L5354). Je ne peux pas le donner mot pour mot d'ici.

Les 12, toutes en `refus` avant, **vérité absente du groupe 12/12** :

| carte | groupe | i1 | i2 | écart | l'image désigne |
|---|---|---|---|---|---|
| Hitmontop n°237 | 44 | 4 | 4 | 0 | Electivire ex |
| Hitmontop n°237 | 44 | 4 | 4 | 0 | Quick Ball |
| Blissey n°242 | 37 | 5 | 4 | 1 | Durant ex |
| Porygon2 n°233 | 48 | 4 | 4 | 0 | Heatran |
| Light Togetic n°176 | 110 | 6 | 4 | 2 | Unown V |
| Larvitar n°246 | 33 | 4 | 0 | 4 | Noivern ex |
| Girafarig n°203 | 67 | 4 | 0 | 4 | Poncho-wearing Pikachu |
| Dark Dragonite n°149 (×2) | 145 | 4 | 4 | 0 | Giratina V |
| Dark Dragonite n°149 | 145 | 5 | 4 | 1 | Varoom |
| Remoraid n°223 | 52 | 0 | 0 | 0 | Vibrava |
| Mew n°151 | 144 | 4 | 4 | 0 | Eternatus |

🔑 **`i1` va de 0 à 6.** Sur les lignes JUSTES du banc, `i1` a pour médiane 26 et pour
minimum 6. Un plancher absolu séparerait donc ici — **mais c'est une hypothèse trouvée après
coup, sur une population différente (vivier par le NUMÉRO), et elle ne compte pas comme
mesure.** Elle s'ajoute à `écart ≥ 2` dans la liste de ce qui reste à confirmer.

### 2. 🔴 UNE SEULE CAUSE, ET CE N'EST NI LE NOM NI LE PONT : `numero` EST NULL

Sur les **59 lignes** où la vérité est absente du vivier par le numéro :

| classe | n |
|---|---|
| **B. la vérité A une ligne `numeros_cartes`, mais son `numero` y vaut `null`** | **58** |
| G. autre | 1 |
| A. pas de ligne du tout · C. suffixe δ · D. nom · E. set sans pont · F. région | **0** |

**58 sur 58 de la classe B ont `numero: null`** — pas un autre numéro, pas un numéro mal lu :
**aucun numéro**. Le chemin par le numéro ne peut structurellement pas atteindre ces produits.
Exemples : `548556 Charmander`, `571770 Mew`, `584721 Raichu`, `606813 Light Arcanine`,
`584720 Articuno`, `605356 Sabrina's Jynx`, `606579 Hitmontop`.

🔑 **Un correctif de cette seule classe rendrait 58 lignes sur 59 candidates.** C'est un
chantier de COLLECTE (apprendre les numéros manquants), pas de barème. Le nom, le pont TCGdex,
la région et la variante n'expliquent **aucune** ligne ici.

### 3. Le suffixe δ évite le repli par numéro — sur 2 lignes, et ce sont les deux Milobellus

Sur les 222 lignes : **50 déclenchent le repli par numéro aujourd'hui**, **48 le
déclencheraient encore** avec le suffixe retiré. **2 évitées : `Milotic n°5 (FR)` ×2.**
Le suffixe n'est donc pas un correctif de masse — c'est un correctif **exactement ciblé sur le
cas qui a ouvert le chantier**.

**Les 4 lignes que le suffixe fait changer de gagnant** (vivier par le nom) :

| ligne | avant | après | journal | vérité au banc |
|---|---|---|---|---|
| **Milotic n°5 FR** (×2) | 769224 — 70 pts, **11 ex aequo** | **277210 — 95 pts, 1 ex aequo** | refus | **aucune** |
| Pikachu n°112 ZH | 784396 — 5 pts, **76 ex aequo** | 570663 — 10 pts, 1 ex aequo | refus | **aucune** |
| **Altaria ex n°019 JP** | 787601 — 70 pts, 24 ex aequo | 761858 — 95 pts, 1 ex aequo | **784363** | **aucune** |

⚠️ **Les quatre sont hors banc.** Altaria ex change un scan ABOUTI (le journal disait 784363,
le suffixe donne 761858) et **rien ne dit lequel est juste**. Trois refus deviennent des
identifications à candidat unique, une identification en remplace une autre — et aucune des
quatre n'est vérifiable aujourd'hui.

### 4. `écart ≥ 2` : HYPOTHÈSE, pas gain acquis

> **`écart ≥ 2` a été choisi APRÈS avoir vu les données.** Les 3 fausses qu'il retire ne sont
> **pas une mesure** : elles sont l'échantillon sur lequel le seuil a été ajusté. Il ne compte
> comme gain que le jour où il tient sur des lignes NEUVES, saisies après sa formulation.
> Même statut pour le plancher `i1` suggéré par les 12 faux du vivier par le numéro.

### 5. La garde reste PAR GROUPE — décision

> **DÉCISION : on garde la garde PAR GROUPE.** Mesuré le 2026-09-04 : le régime par candidat
> rend **+14 lignes servies** contre **−4,7 points de justesse** (90,7 % sur 43 → 86,0 % sur
> 57), et sur les 14 lignes débloquées il produit **4 fausses pour 10 justes**.
> **Refusé au nom du critère de lancement** — « quand l'outil affirme, il a raison » : servir
> quatorze lignes de plus ne vaut pas quatre affirmations fausses de plus. La mesure reste
> écrite ; la décision se rouvrira si le critère change, pas avant.

### 0 bis. Le suffixe δ : EN ATTENTE, PAS ENTERRÉ — et ce n'est PAS le chantier de la collecte

> **Statut : dominé, pas invalidé.** Le suffixe évite le repli par numéro sur **2 lignes sur
> 222**, et sur **0 des 59 lignes à vérité absente**. En face, `numero: null` explique
> **58 de ces 59**. Il est donc dominé d'un facteur ~29 sur la population mesurable
> aujourd'hui — ce qui ne dit rien de sa justesse, seulement de son EFFECTIF.
> **Il repasse dès que les numéros manquants sont collectés** : la collecte fera entrer dans
> les viviers des produits que le suffixe pourra alors départager, sur une population où il
> aura enfin un effet mesurable. Ne pas le relire comme « refusé ».

**Et la question qui décide s'ils sont le même chantier : NON.** Mesuré sur les
**388 produits** dont le nom nu finit par « δ Delta Species » (0,53 % du catalogue) :

| | n | % |
|---|---|---|
| `numero` renseigné | **323** | **83,2 %** |
| `numero` nul mais `numeroUrl` présent | 9 | 2,3 % |
| aucune ligne `numeros_cartes` | 56 | 14,4 % |
| ligne présente avec `numero` ET `numeroUrl` nuls | **0** | — |
| **atteignables par le chemin du numéro** | **332** | **85,6 %** |

Repère, sans lequel ce chiffre ne veut rien dire : sur **tout** le catalogue, **86,4 %**
des produits ont un `numero` non nul (63 231 / 73 188). **La classe δ est à 83,2 % — au
niveau du catalogue, pas en dessous.** Et les trois produits du chantier ont tous leur
numéro : `277210` (5), `761858` (019), `570663` (112).

🔑 **Les deux chantiers sont DISTINCTS.** Le blocage δ est un défaut de **normalisation du
NOM** ; les 58 lignes sont un défaut de **collecte du NUMÉRO**. Corriger l'un ne corrige pas
l'autre, et ils ne se réordonnent pas l'un l'autre.
(Note au passage : **0 des 332 lignes δ portant un numéro ne porte un `setTcgdex`** — elles
sont sur 25 expansions, toutes du côté des 534 sans pont.)

### Vérités à SAISIR — la liste, tenue ici parce que je n'écris pas dans `banc-verites.json`

Aucune de ces lignes n'a de vérité au banc, et chacune bloque une décision en cours. Le
testeur les saisit lui-même avec `saisir-verites.js` ; je ne le lance pas.

| ligne du journal | pourquoi elle bloque |
|---|---|
| 🔴 **`Ho-Oh` n°250 JP — EN ATTENTE : DEUX DÉSIGNATIONS CONCURRENTES, NON TRANCHÉ. NE PAS SAISIR.** | **Deux sources externes désignent deux cartes DIFFÉRENTES**, et le prix (~15 €) ne les sépare pas. ① le concurrent dit « Neo Premium File 3 · n°007 » → chez nous `274593` (`NR`, n°7, `setTcgdex: neo3`, `setPartage: true`, idMetacard **212454**), carte *« Stoke \| Sacred Fire \| Dive Bomb »*, **ORB rang 12 / 0 inlier**. ② la fiche Cardmarket ouverte à la main dit « Ho-Oh (UNP) · Unnumbered Promos · From 15,00 € » → `654129` (idMetacard **266314**), carte *« Rainbow Burn »*, **ORB rang 1 / 29 inliers**. **Métacartes différentes, attaques différentes : ce ne sont pas deux impressions d'une même carte, ce sont deux cartes.** L'une des deux sources se trompe. ⚠️ **Une vérité fausse au banc contaminerait toutes les mesures futures — c'est pire que pas de vérité.** Ni `606685` ni `654000` (les deux survivants du périmètre) ne sont candidats. |
| 🔴 **`Slowbro` n°090 ×3** | **les SEULES AFFIRMÉES mesurées** : la route les livre aujourd'hui sans aucune réserve (`carteIncertaine: false`, `raisonReserve: null`, `niveauReserve: null`), et le régime « image d'abord » les enverrait sur `888632` au lieu de la vérité `895874`, avec des écarts de **1, 2 et 0**. Ce sont elles qui interdisent le câblage. |
| **`Altaria ex` n°019 JP** | le suffixe δ y remplace un scan ABOUTI (journal `784363`) par `761858` — **on ne peut pas dire lequel est juste**, et c'est le seul des 4 cas δ qui touche une ligne qui marchait |
| `Milotic` n°5 FR (×2) | le suffixe les fait passer de refus à `277210`, 95 pts, 1 ex aequo — le cas qui a ouvert le chantier, jamais vérifié |
| `Pikachu` n°112 ZH | refus à 76 ex aequo → `570663`, 1 ex aequo |
| les **10 scans à vivier vide** (Mewtwo 150, Dragonite 149 et 180, Flaaffy 180, Marowak 105, Koga's Ditto 132, Dark Kadabra 064, Pidgeotto 017, Abra 063, Natu 177) | la recherche ORB globale les classe 10/10 sur le bon NOM, mais le TIRAGE n'est vérifié sur aucune |

## 🔴 2026-09-05 — `numero: null` EST FIDÈLE. Le chantier de collecte est ABANDONNÉ

**Vérifié à la main par le testeur, sur 4 fiches Cardmarket** — pas déduit d'une mesure :

> **Ces cartes ne portent pas de numéro de carte imprimé.** Elles ne portent que le numéro
> **Pokédex de l'espèce**. `numero: null` n'est donc **pas un trou de collecte : c'est la
> valeur juste.** Cardmarket lui-même n'a pas d'autre discriminant et les désigne **par leurs
> attaques** — `Charmander [Growl | Flame Tail]`, `Light Arcanine [Drive Off | Gentle Flames]`.

**⇒ Le chantier de collecte des numéros est abandonné AVANT d'être ouvert.** Aucune passe
Tampermonkey, aucun import, aucun scraping ne ramènera **ce qui n'est pas imprimé sur la
carte**. C'était la conclusion du tour précédent (« 58 lignes sur 59 tiennent à `numero:
null` ») ; elle était juste sur le CONSTAT et fausse sur la CAUSE.

🔑 **La 21e erreur d'instrument, et elle est de forme neuve** : j'ai lu une absence en base
comme une donnée manquante, alors qu'elle décrivait fidèlement une absence **dans le monde**.
Le dénominateur était imprimé, la population était la bonne, la requête était juste — et la
conclusion inversait le sens du champ. Ce que la parade « imprimer le dénominateur » n'attrape
pas : **elle dit combien de documents portent le champ, jamais ce que le champ VEUT DIRE.**
Seules quatre fiches ouvertes à la main l'ont attrapée.

**⇒ Le discriminant est le SYMBOLE**, dispositif **déjà écrit et déjà mesuré** :
**28/28 prononcées** au banc, **12/12 en production** (`symbole-departage`, la seule
`raisonReserve` classée `'forte'`). Il n'y a rien à construire, seulement à mesurer sa portée
sur cette population.

⚠️ **LE CONTRE-EXEMPLE À GARDER, il borne la sortie** : **Charmander Expansion Sheet** porte
une **Pokéball commune à toute la série Vending**. Le symbole n'y départage **rien**. Une
solution par le symbole ne peut donc pas être annoncée comme générale avant d'avoir compté
les cartes qui tombent dans ce cas.

**Prochain sujet, non mesuré ce tour** : sur les 58 lignes, combien le symbole départagerait-il,
et combien tombent dans le cas Vending ?

## 2026-09-05 — `imageStatut` : ce qui est décidé, et le geste interdit

**Décidé, à faire quand il y aura un dénominateur — RIEN N'EST ÉCRIT AUJOURD'HUI :**

1. **Le raffinement du statut descend dans `departage-image.js`**, là où le statut est posé,
   au lieu de vivre chez l'appelant de la voie du succès. `departager()` reçoit déjà
   `classement` : il peut comparer `scores[0].idProduct` à `classement[0]?.idProduct` sans
   paramètre neuf. Les deux voies — succès ET refus — seront alors servies par une seule
   source, au lieu que le refus journalise `champs` brut et ne puisse jamais dire
   `confirme-le-scoring`.

2. > 🔴 **LE GESTE INTERDIT.** On ne touche **QUE** `champs.imageStatut`. Renvoyer
   > `departage: false` sur une confirmation **changerait une décision** : le branchement de
   > index.js:4674 teste `avis.departage` et `avis.gagnant`, jamais le statut. Tant qu'on
   > n'écrit que la chaîne, le déplacement est **inerte** ; dès qu'on touche au booléen ou au
   > gagnant, il ne l'est plus. Cette ligne est la limite, et elle ne se renégocie pas.

3. **`egalite-inliers` sera une VALEUR DISTINCTE**, pas une extension d'`abstention-signal`.
   « Je n'ai rien vu » et « j'ai vu autant des deux côtés » appellent des suites opposées —
   collecter de meilleurs vecteurs d'un côté, resserrer le groupe de l'autre. Les confondre
   effacerait la seule distinction utile.

4. **`abstention-symbole-prioritaire` RESTE chez l'appelant.** Sa migration exigerait de
   passer `departageParSymbole` à `departager()`, donc une signature neuve. Le gain ne le
   justifie pas aujourd'hui.

⚠️ **Et le coût, à payer les yeux ouverts** : `controle-departage-image.js:207` et
`mesure-justesse-production.js:253` consomment la chaîne. Leur table attendue **se déplacera**
— elle **se relit**, elle ne se corrige jamais en douce. C'est exactement la faute de
l'entrée 19 : un changement juste chez l'un, qui casse l'autre en silence.

## 🔴 Le scan Ho-Oh : le défaut est le **PÉRIMÈTRE**, pas l'image

Ho-Oh n°250, JP, promo, aucun total, aucun setCode lu. Le vivier par le nom rend
**39 candidats**, **tous les 39 ont un vecteur indexé**. La règle du périmètre
(index.js:4040-4049) en garde **2** — `606685` (N3) et `654000` (EC4) — au seul motif de
l'appartenance à la table close des 24 sets vintage. **Elle ne regarde ni le numéro, ni
l'image, ni le prix. Le reste est jeté avant que quoi que ce soit ait pu le départager.**

**ORB sur les 39, avec la photo du journal :**

| rang | inliers | idProduct | codeSet | périmètre |
|---|---|---|---|---|
| **1** | **29** | **654129** | **UNP** | **ÉCARTÉ** |
| 2 | 4 | 274604 | NR | écarté |
| 4 | 4 | 606685 | N3 | *gardé* |
| 5 | 4 | 654000 | EC4 | *gardé* |

**Écart 1er-2e : 25.** Les deux survivants du périmètre sont à **4 inliers**, à égalité avec
huit autres. 🔑 **L'image désigne franchement un candidat que le périmètre avait déjà jeté** —
`654129`, « Ho-Oh [Rainbow Burn] », expansion 4170 `UNP` (*Unnumbered Promos*), ce qui est
cohérent avec `rarete: promo` sur une carte sans numéro imprimé.
Le départage 4 contre 4 de la production n'était donc pas un mauvais départage : c'était un
départage entre deux cartes dont **aucune** n'était vraisemblablement la bonne.

⚠️ **Ce que cette mesure N'ÉTABLIT PAS** : `654129` n'a **aucune vérité au banc**. « Le premier
en inliers avec un écart de 25 » n'est pas « la bonne carte ». À saisir.
⚠️ **Et ORB n'a tourné que sur UNE photo sur 5** : le journal ne stocke qu'une `imageUrl`.
C'est une borne BASSE.

**TCGdex n'aide pas ici** : 16 impressions proposées pour Ho-Oh #250, **zéro `idProduct`
Cardmarket** — aucune jointure possible, la trouvaille sort `ambigu: true`.

## L'IMAGE EN PREMIER, LE TEXTE ENSUITE — mesuré sur les 89 lignes du banc

Deux bras sur **le même vivier par le NOM** (pas le périmètre), même photo, même vérité.
Bras A : `scorerCandidatsLocal`, refus si égalité au sommet. Bras B : ORB sur tout le vivier.

| régime | justes | faux | refus |
|---|---|---|---|
| **A. TEXTE** (régime actuel) | **37** | 7 | **45** |
| **B. IMAGE D'ABORD** | **69** | **16** | **4** |

Transitions : `refus → juste` **37** · `juste → juste` 29 · `juste → faux` **8** ·
`refus → faux` **7** · `faux → juste` 3 · `faux → refus` 3 · `faux → faux` 1 · `refus → refus` 1.

**L'image d'abord double presque les identifications justes (37 → 69) et fait fondre les
abstentions (45 → 4) — au prix de 7 faux de plus (7 → 16).**

**Et cette fois l'écart SÉPARE** — contrairement à la mesure du 2026-09-04, qui portait sur les
groupes déjà restreints par le scoring :

| | n | min | p10 | médiane | p90 | max |
|---|---|---|---|---|---|---|
| écart · vérité en TÊTE | 69 | 1 | 2 | **15** | 32 | 48 |
| écart · vérité PERDUE | 16 | 0 | 0 | **2** | 21 | 22 |

| seuil | justes gardées | fausses gardées |
|---|---|---|
| écart ≥ 1 | 69 | 13 |
| écart ≥ 2 | 66 | 9 |
| **écart ≥ 3** | **61** | **6** |
| écart ≥ 8 | 47 | 5 |
| écart ≥ 20 | 26 | 2 |

À `écart ≥ 3` : **61 justes, 6 faux, 22 abstentions** — meilleur que le texte **sur les deux
axes à la fois** (37 justes, 7 faux). ⚠️ Mais le seuil est encore choisi APRÈS avoir vu les
données : même statut que `écart ≥ 2`, une hypothèse à confirmer sur des lignes neuves.

### ⚠️ CE QUE CETTE MESURE NE DIT PAS — la population n'est pas le trafic

- **Langue : JP 76, FR 13.** Zéro EN, zéro autre. C'est un banc **japonais vintage**, pas un
  échantillon du trafic.
- **Rareté lue : normale 67, promo 11, IR 4, SIR 4, AR 3.** Les cartes BRILLANTES —
  holo, reverse, full art — sont quasi absentes, et ce sont précisément celles où le reflet
  détruit les points ORB.
- **Le moderne occidental n'est pas mesuré du tout**, et nos propres chiffres l'y donnent
  PERDANTE : la note de `GARDE_PERIMETRE_ASIATIQUE` (departage-image.js) relève **4/8 pour
  l'image contre 8/8 pour le scoring** sur ce chemin. La garde asiatique existe pour ça.
- La vérité est absente du vivier par le nom sur **1 ligne sur 89** — ce défaut-là n'est pas
  en cause ici.

🔑 **Donc : « l'image d'abord » est mesurée gagnante LÀ OÙ LA GARDE ASIATIQUE S'APPLIQUE
DÉJÀ, et nulle part ailleurs.** Ce n'est pas un argument pour inverser l'ordre partout ; c'en
est un pour l'inverser **dans le périmètre asiatique**, et la mesure du chemin occidental
reste entièrement à faire.

## DOSSIER CONCURRENCE — les erreurs mesurées chez eux

⚠️ **Ce dossier n'existait pas avant le 2026-09-05** ; il est ouvert ici. Chaque entrée dit sa
PROVENANCE, parce qu'aucune n'est produite par notre chaîne.

| # | date | ce qu'ils ont rendu | ce qui est vrai | provenance |
|---|---|---|---|---|
| 4 | 2026-09-05 | **« Neo Premium File 3 · n°007 · 15 € » annoncé à 94,9 %** sur le scan Ho-Oh n°250 JP — chez nous `274593`, idMetacard **212454**, attaque *« Stoke \| Sacred Fire \| Dive Bomb »* | la carte porte **レインボーバーン / Rainbow Burn**, donc l'idMetacard **266314** — une **AUTRE métacarte**, pas une autre impression | **lecture de l'attaque sur la photo par le testeur** + fiche Cardmarket « Ho-Oh (UNP) · From 15,00 € » ouverte à la main |

🔑 **Ce qui rend cette erreur intéressante et pas anecdotique** : ils ne se sont pas trompés
d'IMPRESSION (même carte, autre set) — ils se sont trompés de **CARTE**. Et ils l'ont affiché à
**94,9 %**. C'est la démonstration en une ligne de l'entrée 23 du catalogue : *un pourcentage de
confiance mesure la force d'un appariement, jamais la probabilité d'avoir raison.*
Le prix ne les départageait pas non plus : ~15 € des deux côtés.

⚠️ **Aucune capture n'est jointe** : je n'en ai pas reçu et je n'en fabrique pas. Le champ est
laissé ouvert — la capture est à déposer par le testeur à côté de cette ligne.
⚠️ Entrées 1 à 3 : non reprises ici, elles sont antérieures à ce dossier.

## CE QUE L'ATTAQUE ACHÈTERAIT — mesuré, aucun prompt touché

**Le catalogue s'y prête** : `idMetacard` est présent sur **73 188 / 73 188** produits (100 %).
**55 307 noms (75,6 %)** finissent par `[...]`, dont **44 034 (60,2 %)** par `[... | ...]`.
Sur **16 768** métacartes distinctes, `[...]` en couvre **14 168** et `[... | ...]` **11 113**.

**Sur les 89 lignes du banc**, 45 produisent une égalité au sommet (groupe médian **3**, max 25) :

| | n / 45 |
|---|---|
| 🎯 **métacartes DIFFÉRENTES dans le groupe** — ce que l'attaque trancherait | **16 (36 %)** |
| 🔒 **toutes à la MÊME métacarte** — aucune lecture ne les sépare | **29 (64 %)** |

Et là où c'est décisif : la vérité est dans le groupe **12 fois sur 45**, et **l'attaque
isolerait un candidat unique 10 fois sur 12**.

🔑 **Ce que ça dit** : l'attaque est un discriminant fort **là où elle s'applique** — mais elle
ne s'applique qu'à un tiers des égalités. **Les deux tiers restants sont des impressions
différentes de la MÊME carte** : même nom, mêmes attaques, et rien dans le texte ne pourra
jamais les séparer. C'est la population de l'image et du symbole, pas celle de la lecture.

## 2026-09-05 — LE DÉPARTAGE PAR L'ATTAQUE : écrit, symétrique, NON MESURABLE

### La règle de symétrie est tenue — et le compte passe de SEPT à HUIT, pas de six à sept

`departagerParAttaque` est dans `apres()` du banc (banc-japonais.js, derrière le symbole,
devant l'écart de prix) **au même commit** qu'en production. L'en-tête de la règle est
corrigé : les décisions présentes aux deux endroits étaient **déjà sept** — Pokédex,
périmètre vintage, setCode+numéro, veto par le nom, règle d'égalité, symbole, image — elles
sont maintenant **HUIT**.

### 🔴 ET LE BANC NE PEUT PAS LA MESURER : elle est INERTE dessus

`d.attaque` vient du prompt écrit aujourd'hui. **Aucune des 224 lignes du journal ne le
porte.** `departagerParAttaque` sort donc systématiquement au verrou 1 (« aucune attaque
lue »), et **aucune ligne du banc n'emprunte `voie=attaque-departage`**.
C'est exactement l'état du départage par l'image le 2026-08-29, inerte tant que
`references_image` était vide. La colonne APRÈS prouve que la décision **ne casse rien** ;
elle ne prouve **rien de son gain**. Seul un scan réel le pourra.

### Ce que le banc dit quand même, et qui n'est PAS de mon fait

Sur les 11 lignes à vérité individuelle : `JUSTE 8 → 6`, `FAUX 1 → 3`, `REFUS 2 → 2`.
Sur les 54 lignes validées en bloc : 51 inchangées, **3 déplacées, dont 2 deviennent fausses**.
🔑 **`FAUX ET AFFIRMÉ : 0 → 0` — le seuil de lancement tient.**
⚠️ Toutes les lignes qui bougent portent `voie=perimetre-vintage`,
`REFUS-egalite-perimetre`, `perimetre-egalite-sans-enjeu`, `numero-pokedex-neutralise` ou
`REFUS-egalite`. **Aucune ne porte `attaque-departage`.** Cette régression est antérieure et
appartient à l'écart déjà connu entre `apres()` et la route — elle reste à traiter, elle
n'est pas produite par ce commit.

### Le scan de contrôle — PRÉPARÉ, PAS LANCÉ

Comme pour le symbole le 2026-08-08 : le dispositif n'a **jamais tranché sur une vraie carte**.

1. ⚠️ **D'ABORD** : ouvrir la fenêtre de lot dans `banc-lots.json` et **la commiter**. Sans
   ça le scan tombe dans le holdout et brûle une ligne d'évaluation. C'est le fichier du
   testeur, je n'y touche pas.
2. Scanner le **Ho-Oh n°250 JP** (deux ex aequo, métacartes 266314 et 212454 — le cas type).
3. Vérifier au journal, sur la ligne neuve :

| champ | attendu |
|---|---|
| `attaqueLue` | le nom **anglais** rendu par l'IA, ou `null` |
| `attaqueBrute` | les katakana tels qu'imprimés (レインボーバーン), ou `null` |
| `attaqueConfiance` | `haute` / `moyenne` / `basse` |
| `attaqueDepartage` | **une phrase, TOUJOURS** — même « aucune attaque lue » |
| `raisonReserve` | `attaque-departage` **si et seulement si** il a tranché |
| `niveauReserve` | `faible` — jamais d'affirmation |

🔑 **Le contrôle qui compte n'est pas « a-t-il tranché »**, c'est : `attaqueDepartage`
est-il **non nul** ? Un champ vide voudrait dire que le dispositif n'a pas été consulté du
tout — la faute déjà payée trois fois (`symboleSet`, `vivierIds`, les champs d'état).

## MESURE D'INTERVALLE — NON MESURABLE, et c'est l'âge des champs

Définition appliquée telle quelle : un candidat = un des **deux entrants de `pireEtat`**
(index.js L3380 : l'avis de l'IA *si* `etatConfianceIA` ≥ moyenne, et `etatMin`), jamais une
pastille de grille ; ligne comptée seulement si les deux portent une cote **non nulle et
distincte**.

**Les noms du contrat sont ceux de la RÉPONSE, pas du journal** — les confondre rendrait 0
en croyant mesurer :

| contrat | journal | présent | non nul |
|---|---|---|---|
| `grilleEtats` | `prixParEtat` | **2 / 224** | **0 / 224** |
| `etatCardmarket` | `etatMin` | 2 / 224 | 2 / 224 |
| `etatEstimeIA` | `etatEstimeIA` | 2 / 224 | 2 / 224 |
| `etatVinted` | `etatVinted` | 2 / 224 | 2 / 224 |
| `vintedPrice` | `prixVinted` | 224 / 224 | **0 / 224** |

Sur les **89 lignes du banc** : grille non vide **0**, deux entrants renseignés **0**, deux
cotes non nulles **0**, **deux cotes distinctes : 0**.
**Largeur médiane : aucune ligne à mesurer. Dedans 0, dehors 0.**

🔑 **Ce n'est pas « l'intervalle est étroit », c'est « l'intervalle n'existe pas encore ».**
Les quatre champs d'état ont été déployés **aujourd'hui** (2 lignes les portent), et
`prixVinted` est **non nul zéro fois sur 224** — l'extension n'a jamais envoyé de prix.
L'intervalle sera mesurable quand ces deux conditions seront réunies, pas avant. Aucun
chiffre n'est produit ici, et c'est la seule réponse honnête.

## La mesure d'intervalle : POSSIBLE, mais VIDE — et c'est l'âge du champ

**Le code est là, la mesure ne l'est pas.** `pireEtat` existe, `prixParEtat` existe, le
script de mesure tourne et rend ses dénominateurs. Ce qui manque, ce sont les **lignes**.

| champ du contrat | au journal | présent | non nul |
|---|---|---|---|
| `grilleEtats` | `prixParEtat` | 2/224 | **0/224** |
| `etatCardmarket` | `etatMin` | 2/224 | 2/224 |
| `etatEstimeIA` | `etatEstimeIA` | 2/224 | 2/224 |
| `etatVinted` | `etatVinted` | 2/224 | 2/224 |
| `vintedPrice` | `prixVinted` | **224/224** | **0/224** |

Sur les 89 lignes du banc : deux entrants de `pireEtat` renseignés **0**, deux cotes non
nulles **0**, deux cotes **distinctes 0**. Largeur médiane : rien à mesurer. Dedans 0,
dehors 0.

🔑 **`prixVinted` présent 224/224 et non nul 0/224 : le champ existe depuis toujours, il
n'a jamais été rempli.** Il arrive par `/api/retour-live`, et **il n'y avait pas de serveur
pour l'écouter avant ce matin** — la route est dans les 24 commits qui dormaient sur
`chantier-image`. Ce n'est pas un défaut de l'instrument ni une propriété du monde :
c'est l'âge du champ, exactement l'erreur #8 du catalogue prise à l'envers.

**À relancer** — `ad-intervalle.js`, tel quel — **quand des scans auront porté un prix.**
Avant, tout chiffre produit sur cette population serait une mesure sur zéro ligne
déguisée en résultat.

## DETTE OUVERTE — `apres()` du banc ne dit pas ce que dit la route

**Origine : 2026-08-08.** Depuis cette date, la fonction `apres()` de `banc-japonais.js`
**réimplémente** l'enchaînement de décisions de la route au lieu de l'appeler. Les deux
ont divergé : la colonne APRÈS a montré, au commit du départage par l'attaque, des lignes
qui se déplacent (`perimetre-vintage`, `REFUS-egalite-perimetre`,
`perimetre-egalite-sans-enjeu`, `numero-pokedex-neutralise`) **sans qu'aucune décision de
ce commit ne les touche**. 8 justes → 6, 1 faux → 3, sur les 11 lignes à vérité
individuelle. Ces mouvements sont **antérieurs au commit**, ils ne sont pas produits par lui.

⚠️ **Conséquence, à tenir jusqu'à correction : toute colonne APRÈS lue d'ici là est
suspecte.** Le seul chiffre du banc qui reste lisible est **FAUX ET AFFIRMÉ** — il vaut 0
avant comme après, et c'est à ce titre seul que le commit est parti. Un delta de justesse
lu sur cette colonne ne prouve rien tant que la dette n'est pas soldée.

**Non corrigée volontairement ce tour** : la corriger déplace les chiffres du banc dans le
même commit qu'une décision de production, et on ne saurait plus lequel des deux a bougé.

## L'IMAGE DE REPLI — de combien nos mesures ORB sont-elles bornées

Trouvaille de l'agent extension : `extraireImage` peut rendre **« la plus grande image de
la page »** en repli, **sans marquer sa provenance**. Mesuré ici, côté serveur.

**1. Le journal ne permet pas de distinguer un repli d'un sélecteur. Franchement : non.**
Le seul champ de provenance possible serait un drapeau, et il n'y en a aucun — la liste
exhaustive des champs du journal commençant par `image` **au moment de l'écriture de
l'URL** se réduit à `imageUrl`. Aucun `imageSource`, aucun `imageSelecteur`.

**Le seul indice indirect est la forme de l'URL**, et il est faible : **175/175** des URL
sont `images1.vinted.net` avec le gabarit `/f800/`. Cela **exclut** les bannières et les
avatars, qui portent d'autres gabarits de taille — cela **n'exclut pas** la photo d'une
**autre annonce** du carrousel « articles similaires », qui porte exactement le même.

**2. Les images sont toutes chargeables : 175/175, zéro illisible.** Le journal ne porte
aucune ligne à 0 inlier : `imageInliers` est **non nul 5/224** (valeurs 4, 4, 12, 22, 23) —
les « 0 inlier » de nos mesures viennent des passes ORB **hors ligne**, sur ces mêmes URL.

⚠️ **Le ratio attendu n'est PAS 63/88.** Le fichier porte le ratio de la **photo**, pas de
la carte : une photo de téléphone tenu en portrait rend 3:4 (0,750) avec la carte au milieu
et des marges. 137/175 valent exactement 600×800. Le ratio ne peut donc **pas** dire « c'est
une carte » ; il ne peut flaguer que les formes qu'aucune photo de carte tenue en main n'a :
le **paysage** (> 1,00) et l'**ultra-étroit** (< 0,60).

**3. Ce que ça borne : 14 / 175 = 8,0 %, dont 7 AU BANC.**

| forme | dimensions | carte | sort |
|---|---|---|---|
| ÉTROIT | 451×800 | Raichu n°026 | REFUS `egalite-parfaite` · 🎯 banc |
| ÉTROIT | 450×800 | Pichu n°172 | succès · 🎯 banc |
| ÉTROIT | 360×800 | Lapras n°131 | REFUS `egalite-parfaite` · 🎯 banc |
| ÉTROIT | 451×800 | Entei n°244 | succès · 🎯 banc |
| ÉTROIT | 370×800 | Erika's Victreebel n°071 | succès · 🎯 banc |
| PAYSAGE | 800×755 | **Slowbro n°090** | succès · 🎯 banc |
| PAYSAGE | 800×600 | Gladion's Final n°118 | succès · 🎯 banc |
| PAYSAGE | 800×790 | Cinccino ex n°119 | succès |
| ÉTROIT | 451×800 | N's Zekrom n°210 | succès |
| PAYSAGE | 800×600 | Altaria n°087 | succès |
| PAYSAGE | 800×600 | Azurill n°086 | succès |
| ÉTROIT | 369×800 | Froslass n°275 | succès |
| ÉTROIT | 451×800 | Pikachu n°020/M-P | succès |
| PAYSAGE | 800×600 | Dwebble n°135 | succès |

**Le verdict du banc en face des 14 — et il dément l'intuition.**

| | hors forme (14) | témoin, dans la forme (161) |
|---|---|---|
| JUSTE | 5 | 52 (32,3 %) |
| **FAUX** | **0** | **13 (8,1 %)** |
| REFUS | 2 | 40 (24,8 %) |
| hors banc | 7 | 56 (34,8 %) |

🔑 **Zéro faux parmi les 14.** Les fausses ne sont donc **pas** surreprésentées chez les
images hors forme — c'est l'inverse. ⚠️ Mais le dénominateur au banc n'est que de **7**
lignes : 0/7 ne réfute pas un taux de 12,4 % (13/105 au témoin), il ne le mesure pas. La
conclusion honnête est **« aucun biais mesurable, faute de lignes »**, ni un biais, ni son
absence.

**Et `Slowbro n°090` : correction de ce qui était écrit plus haut.** Le journal en porte
**5 lignes, toutes JUSTES par la route** (895874 = vérité H027, voie `setcode-numero`), et
**une seule** a une photo hors forme (800×755, le 2026-08-12). Les faux-et-affirmés Slowbro
ne sont donc **pas** des faux de la route : ce sont des faux du **régime « image d'abord »**,
qui classe mal une carte que le texte identifie correctement. L'image de repli **ne les
explique pas** — au mieux elle explique une des lignes sur les cinq.

### 🔒 PISTE FERMÉE — Slowbro n°090 n'est pas une image de repli

**Close le 2026-09-05, sur données, pas sur avis.** Le journal porte **5 lignes** Slowbro
n°090, **toutes JUSTES par la route** (idProduct 895874 = vérité H027, voie
`setcode-numero`), et **une seule** des cinq photos est hors forme (800×755, le 12/08).

**Donc : les trois faux-et-affirmés qui bloquent « image d'abord » sont un défaut du
RÉGIME, pas un artefact de sourcing.** Le régime classe mal une carte que le texte
identifie correctement. Une image de repli n'expliquerait, au mieux, qu'une ligne sur cinq.

⛔ **Ne pas rouvrir cette piste.** Elle a été ouverte par une hypothèse plausible et fermée
par le compte. La rouvrir demanderait une donnée NOUVELLE — pas une relecture des mêmes
lignes sous un autre angle.

### Vérification à l'œil du 2026-09-05 : **aucun repli constaté**

Le testeur a ouvert les images hors forme. **Lapras n°131 (360×800) et Raichu n°026
(451×800) sont bien des cartes.** Aucune bannière, aucun avatar, aucune photo d'une autre
annonce sur les lignes vérifiées. L'hypothèse du repli n'est donc **pas confirmée** — elle
n'est pas non plus réfutée sur les 12 lignes non ouvertes, et le majorant de 8,0 % reste
ce qu'il est : un majorant.

### Les `imageUrl` expirent-elles ? **Non. 0 morte sur 175.**

**L'alerte.** La photo Slowbro 800×755 (12/08), ouverte à la main, rendait
`{"result":"not-found"}`. Lecture naturelle : l'image a été supprimée, donc les URL du
journal **expirent**, donc toute mesure d'image rejouée à froid porte une borne qui
**grandit silencieusement avec le temps**. C'eût été grave : ça bornait toutes les mesures
ORB passées et interdisait de rejouer les anciennes lignes.

**La mesure — les 175 URL, une par une, statut + content-type + SHA-256 du corps :**

| | |
|---|---|
| HTTP 200 `image/webp` | **175 / 175** |
| corps JSON `not-found` | **0** |
| **MORTES** | **0 / 175 (0,0 %)** |
| plus ancienne encore vivante | **2026-08-02T08:14:31Z** (Raichu n°026) |
| mortalité août 2026 | 0 / 161 |
| mortalité septembre 2026 | 0 / 14 |

**Et le test du placeholder, qui aurait pu me piéger** : 175 URL distinctes → **163 corps
distincts**. Les 12 doublons ne sont pas une image de remplacement servie plusieurs fois,
ce sont des **re-scans de la même annonce** (Dragonite ×3, Rayquaza ×3, Haunter ×3,
Ho-Oh ×2 aujourd'hui). Aucun corps partagé entre deux cartes différentes.

**🔑 LA CAUSE DU `not-found`, isolée par variantes sur la MÊME URL :**

| requête | réponse |
|---|---|
| URL complète, `node fetch` nu | **200** `image/webp` · 800×755 · 152 666 o |
| URL complète, en-têtes de navigateur | **200**, octet pour octet identique |
| **signature `?s=` tronquée** | **404** `{"result":"not-found"}` |
| **sans signature du tout** | **404** `{"result":"not-found"}` |

Ces URL sont **signées** (`?s=<40 hexa>`). `not-found` ne dit pas « cette image n'existe
plus », il dit **« cette signature ne vaut pas »**. Une URL coupée en la copiant — d'un
tableau, d'un terminal, d'une bulle de chat — produit exactement le symptôme d'une
suppression. **L'annonce Vinted elle-même répond 200.** L'image est vivante.

⚠️ **La photo Slowbro 800×755 n'est donc ni un repli, ni une image supprimée.** Elle est
en ligne, et c'est une photo en paysage. Ce qui ne change rien à la conclusion du dessus :
les 5 lignes Slowbro sont justes par la route, la piste reste fermée.

**Ce que ça laisse ouvert, honnêtement** : ces signatures pourraient expirer plus tard.
Aujourd'hui, à 34 jours de recul, **aucune n'a expiré**. La mesure est à refaire de temps
en temps — `ad-expiration.js` — pas à supposer.

→ **Catalogue des erreurs d'instrument, entrée 24** : « UN 404 QUI RESSEMBLE À UNE
SUPPRESSION ». Un message d'erreur d'un service tiers décrit ce que **ce service a refusé
de faire**, jamais l'état du monde.

### Parade retenue : `/ping` rend la version

**Écrite, non poussée** (elle partira avec ce fichier, après le scan de contrôle — la
pousser maintenant redéclencherait un déploiement et changerait la version sous le scan).

```js
app.get('/ping', (req, res) => res.json({ ok: true, mongo: …, version: VERSION }));
```

`VERSION` est **exportée par `journal-scans.js`**, pas recalculée dans `index.js` : deux
`String(process.env.RENDER_GIT_COMMIT || …).slice(0, 12)` dans deux fichiers créeraient
deux versions du même fait, qui divergeraient au premier changement.

**Pourquoi elle existe.** Le 2026-09-05, après un push, il était impossible de savoir si
Render avait fini de déployer : Render laisse l'**ancienne** instance servir pendant que la
neuve build, donc une réponse rapide de `/ping` ne distingue pas « déployé » de « pas
encore ». La seule façon de lire la version en ligne était de **lancer un scan** — consommer
une mesure pour dater l'instrument qui allait la produire, et risquer de mesurer l'ancien
code dans une fenêtre de lot ouverte pour le nouveau.

### ⛔ ET LE 0/7 N'EST PAS UN RÉSULTAT — à ne pas citer plus tard comme s'il l'était

Le tableau ci-dessus dit **0 faux sur 14 hors forme, contre 8,1 % au témoin**. C'est
tentant, et **ça ne mesure rien** : le banc n'a que **7** de ces lignes, et `0/7` est
compatible avec un taux de 12,4 % comme avec un taux de zéro. Aucune conclusion n'en sort,
**dans aucun sens**. Le jour où quelqu'un écrira « les images hors forme ne sont pas plus
fausses », il citera ce tableau : c'est précisément ce qu'il ne dit pas.

**Ce que cette mesure NE dit pas** : que ces 14 sont des replis. Une photo en paysage peut
être un lot de cartes posé à plat, un ultra-étroit peut être une capture d'écran recadrée.
**8,0 % est un MAJORANT du soupçon**, et le vrai taux de repli est quelque part entre 0 et
lui — indéterminable côté serveur, parce que l'information a été **perdue à la source**.

**La borne, dite en une phrase : toute mesure d'image produite jusqu'ici — 39/43 (90,7 %),
49/57 (86,0 %), le « image d'abord » 69/16/4 — a un dénominateur dont jusqu'à 8 % des
lignes pourraient ne pas être la carte annoncée, et 7 de ces lignes sont au banc.**
Les taux restent les meilleurs disponibles ; ils ne sont pas plus précis que ça.

**Pas de correctif, pas de câblage.** La parade est côté extension et tient en un champ :
que `extraireImage` rende sa provenance, et que le journal l'écrive. Tant qu'elle n'existe
pas, aucune mesure d'image ne peut être resserrée au-delà de cette borne.

## Le scan de contrôle du 2026-09-05 — le dispositif lit, dit, et s'abstient

Fenêtre `attaque-controle` `[11:30:09Z, 11:45:03Z[`, **1 scan attrapé**, Ho-Oh n°250 JP,
version **`f08757ec4a27`**.

| champ | valeur |
|---|---|
| `attaqueBrute` | `レインボーバーン` |
| `attaqueLue` | `Rainbow Burn` |
| `attaqueConfiance` | `haute` |
| `attaqueDepartage` | *« attaque « Rainbow Burn » lue, mais aucun des 2 ex aequo ne la porte — elle ne prouve rien ici »* |
| `raisonReserve` | `null` (la ligne sort en REFUS `egalite-parfaite`) |

🔑 **Le champ est NON NUL alors que le départage n'a PAS tranché.** C'était le critère, et
il est rempli : la lecture non latine passe (katakana → anglais officiel, confiance haute),
le verrou 2 refuse de désigner faute de correspondant, et **la phrase est écrite quand
même**. Un instrument muet qui note pourquoi il s'est tu est mesurable ; un instrument muet
qui n'écrit rien ne l'est pas.

## 🔑 TROIS DISPOSITIFS INDÉPENDANTS DÉSIGNENT LA MÊME CAUSE

« Rainbow Burn » est l'attaque de **654129**, qui est **hors périmètre**. Le départage a
donc cherché parmi **2 candidats dont aucun ne pouvait la porter**. Ce n'est pas un échec
du départage : c'est un vivier amputé avant qu'il n'ouvre les yeux.

| dispositif | ce qu'il a dit sur Ho-Oh n°250 |
|---|---|
| **image** | désigne 654129, **29 inliers contre 4** |
| **attaque** | lit `Rainbow Burn` en confiance haute — **absente des 2 ex aequo** |
| **symbole** | *« aucun symbole lu — rien à départager »* (illisible) |

Trois instruments qui ne partagent **ni entrée, ni code, ni méthode** — un appariement de
points ORB, une lecture de texte par l'IA, une lecture de pictogramme — et deux d'entre eux
pointent **la même carte hors périmètre**, le troisième ne dit rien. **Le filtre des 24 sets
écarte la vérité AVANT tout départage.** Aucun départage ne peut réparer un vivier dont la
bonne réponse a déjà été retirée.

⚠️ **Ce que ça ne dit pas** : que 654129 est la vérité. La carte reste **EN ATTENTE**, deux
désignations concurrentes, non tranché (voir catalogue, entrée 23). Ce qui est établi, c'est
la **CAUSE du refus**, pas l'identité de la carte.

## La mesure du régime « périmètre désactivé » — `banc-japonais.js --sans-perimetre`

**Régime mesuré** : périmètre retiré (vivier = le NOM ENTIER), puis **attaque → image →
symbole**, toute sortie `incertain: true` donc **SOUS RÉSERVE**.
⚠️ **L'ordre demandé n'est pas celui de la production** (symbole d'abord, mesuré 12/12) :
toute promotion devra rejouer la mesure dans l'ordre de la route.

**Sur les 88 lignes à vérité individuelle, colonne APRÈS des deux régimes :**

| | référence | sans périmètre |
|---|---|---|
| JUSTE | **63** | **56** |
| FAUX | **8** | **25** |
| REFUS | **17** | **7** |
| **FAUX ET AFFIRMÉS** | **0** | **0** |

Détail par cellule (individuelles) — réf. → sans périmètre :
· 13 lignes : 11 / 0 / 2 → 10 / 1 / 2 · 64 lignes : 46 / 5 / 13 → 39 / 21 / 4
· **holdout, 11 lignes : 6 / 3 / 2 → 7 / 3 / 1**
Bloc du holdout (54) : 51 inchangées / 2 fausses → **45 inchangées / 6 fausses**.

### 🔴 FAUX ET AFFIRMÉS = 0, ET CE ZÉRO NE PROUVE RIEN

**Il est vrai PAR CONSTRUCTION.** Toute sortie de ce bloc pose `incertain: true` — le
régime ne PEUT PAS produire un faux affirmé, quel que soit son comportement. Le critère de
lancement est donc **satisfait sans discriminer**. Un critère qu'un régime satisfait par sa
définition ne mesure pas ce régime : il mesure sa définition.

### Ce que les chiffres disent, eux

**Les refus tombent : 17 → 7.** C'était l'objectif, et il est atteint.
**Mais 17 faux apparaissent et 7 justes disparaissent.** Le régime ne convertit pas des
refus en bonnes réponses : il convertit **des refus ET des justes** en suggestions fausses
sous réserve. Sur le holdout seul le solde est meilleur (un refus de moins, un juste de
plus), mais le bloc de 54 passe de 2 à **6** régressions.

⚠️ **Et une suggestion fausse sous réserve reste fausse.** Le contrat du projet est
« quand l'outil AFFIRME, il a raison » — il ne dit pas que ce qui est réservé peut être
n'importe quoi. Multiplier les faux par trois pour retirer dix refus n'est pas gratuit,
même sous réserve.

**Rien n'est câblé.** `--sans-perimetre` est un MODE DE MESURE, hors service par défaut,
qui appelle les mêmes fonctions que la route plutôt que d'en refaire une version.

## 🔒 ÉCARTÉ LE 2026-09-05 — le régime « sans périmètre »

**Écarté sur son chiffre, pas sur une impression.** Sur les 88 lignes à vérité
individuelle, colonne APRÈS, référence → régime :

| | référence | sans périmètre | delta |
|---|---|---|---|
| JUSTE | 63 | **56** | **−7** |
| FAUX | 8 | **25** | **+17** |
| REFUS | 17 | **7** | −10 |
| FAUX ET AFFIRMÉS | 0 | 0 | — |

**Le motif du rejet, en une phrase : il retire 10 refus et crée 17 faux.** Il ne convertit
pas des refus en bonnes réponses, il convertit des refus **et sept justes** en suggestions
fausses. Et son zéro de faux-et-affirmés est **tautologique** — toute sortie du bloc pose
`incertain: true`, donc le critère de lancement est satisfait par la DÉFINITION du régime,
pas par son comportement.

⛔ **Ne pas rouvrir sans une donnée nouvelle.** Le mode `--sans-perimetre` reste dans
`banc-japonais.js`, hors service, pour que le chiffre soit rejouable — pas pour être promu.

## La règle « attaque sur le vivier COMPLET » — mesurée, et le cas d'école la dément

**Règle proposée** : le périmètre reste ; si **exactement UN** candidat du vivier par le nom
porte l'attaque lue, il est retenu même hors des 24 sets, sous réserve. Sinon rien ne change.

### 🔴 Elle touche 0 ligne sur 89, et ce n'est pas discutable

| champ | présent | non nul |
|---|---|---|
| `attaqueLue` | 1/225 | **1/225** |
| `attaqueBrute` · `attaqueConfiance` · `attaqueDepartage` | 1/225 | 1/225 |

**Lignes du banc portant une attaque lue : 0 sur 89.** La seule ligne qui en porte une est
le scan de contrôle du Ho-Oh, **qui n'est pas au banc** (aucune vérité, carte EN ATTENTE).
**Justes / faux / refus ne sont donc pas calculables** — la règle est inerte exactement comme
le départage par l'attaque l'était ce matin. Le champ a l'âge d'une journée.

### Le cas d'école la dément au niveau où elle est écrite

`trouverProduitsLocaux("Ho-Oh")` — **la fonction de la route**, pas une requête de
circonstance — rend **39 produits, 12 métacartes**. Et « Rainbow Burn » y est portée par :

| niveau | porteurs | la règle |
|---|---|---|
| **idProduct** | **6** (274604, 365796, 559198, **654129**, 853200, 888918) | **NE DÉSIGNE RIEN** |
| **idMetacard** | **1** (266314) | désigne 266314 |

🔴 **LA RÈGLE, TELLE QU'ÉNONCÉE, EST FAUSSE — et il faut le dire avant de la garder comme
piste.** « Un seul candidat porte l'attaque » et « une seule métacarte porte l'attaque » ne
sont pas la même phrase, et sur son propre cas d'école les deux ne donnent pas le même
résultat : **six produits**, **une métacarte**. Au niveau du PRODUIT — le niveau où la règle
est écrite — elle **ne s'active pas**. Sur le cas qui l'a inspirée.

**Au niveau MÉTACARTE elle s'active** — et c'est le bon niveau, celui où
`departagerParAttaque` décide déjà. Elle désigne 266314, qui **contient 654129**. Mais
266314 compte **6 produits** : la règle ne rend pas une carte, elle rend un **groupe de six
réimpressions**, et il faut encore en choisir une — par le set, par l'image, par le prix,
c'est-à-dire par les instruments qui ont déjà échoué ici.
**Elle déplace le problème d'un cran, elle ne le résout pas.**
⛔ **Ne pas garder cette piste sans cette correction attachée.** Écrite « un seul candidat »,
elle promet une carte et rend un groupe ; celui qui la relira dans un mois croira qu'elle
tranche.

⚠️ **Et rien ici ne dit que c'est juste.** Ho-Oh n°250 reste **EN ATTENTE**, deux
désignations concurrentes (voir catalogue, entrée 23). Le cas d'école montre que la règle
**tire**, il ne montre pas qu'elle **vise bien** — et il ne peut pas le montrer tant que la
vérité n'est pas tranchée.

### Le majorant de portée, si l'attaque était lue à chaque fois

Sur 86 lignes du banc au vivier ≥ 2 : **81** ont au moins une attaque qui ne désigne qu'une
seule métacarte, **5** n'en ont aucune. ⚠️ **Ce n'est pas la portée de la règle** : c'est le
pouvoir discriminant du CATALOGUE, à supposer que l'IA lise justement, à chaque fois,
l'attaque qui discrimine. Sur ce point on a **une** lecture, en confiance haute, et elle
était juste. Une.

**Ce qu'il faut pour trancher, et rien d'autre** : des scans qui portent `attaqueLue`, et
une vérité saisie pour Ho-Oh n°250.

## 🔴 DÉFAUT CONFIRMÉ — `MOTS_VIDES` détruit le « aucun » de `symboleSet`

**Ce n'est pas une piste, c'est un défaut, et il est localisé.**

| | |
|---|---|
| [index.js:678](index.js) | `"aucun"` : *« rien à cet emplacement. C'est une VRAIE réponse, pas une absence de réponse »* |
| [index.js:679](index.js) | `"illisible"` : *« C'est la bonne réponse dans le doute »* |
| [index.js:780](index.js) | `MOTS_VIDES` contient `'aucun'` |
| [index.js:786](index.js) | la boucle applique `MOTS_VIDES` à `symboleSet` |

**Le prompt construit la distinction sur deux lignes ; le parseur la détruit cent lignes
plus bas.** Au journal : `"aucun"` **0 fois sur 225**, `null` 111, `"illisible"` 43.

**Ce que ça coûte : non mesurable, et l'information n'est pas récupérable.** Le journal ne
garde aucune réponse IA brute (seulement `nomBrut` et `nomConfiance`), et le `console.warn`
de [index.js:789](index.js) ne se déclenche que pour `setCode`. Sur les 111 `null`, **rien**
ne distingue un « aucun » écrasé d'un champ jamais rendu. Détruite à la source.

### ⚠️ LE CORRECTIF FABRIQUE DEUX INSTRUMENTS, PAS UNE CORRECTION

Retirer `'aucun'` de `MOTS_VIDES` pour `symboleSet` **change ce que le champ signifie**.
Les mesures de symbole antérieures gardent leur sens ; **les futures ne leur seront pas
comparables** — exactement comme au changement de prompt du lot `symbole-40`, où il avait
fallu écrire « ne pas additionner aux 7 lignes lues sous l'ancien prompt : deux instruments ».
**À écrire dans le commit du correctif, pas après.**

### Les neuf champs que la liste traverse — `'aucun'` est-il une vraie réponse ?

| champ | verdict |
|---|---|
| `setCode` | **NON** — le prompt dit *« réponds null, n'invente rien »* ([:656](index.js)). Écrasement correct. |
| `name` | **NON** — une carte porte toujours un nom ; « aucun » = lecture ratée. |
| `nomBrut` | **NON** — même raison, c'est le nom tel qu'imprimé. |
| `number` | **NON tel quel** — mais ⚠️ le prompt ([:645](index.js)) n'offre **aucune** façon de dire « rien d'imprimé », alors qu'on a établi que `numero: null` est **FIDÈLE**. Le manque est en amont. |
| `total` | **NON tel quel** — même trou : la cellule « SANS total » existe (55 lignes du banc), le prompt ne prévoit pas de la déclarer. |
| `rarete` | **sans objet** — le prompt force `"normale"` dans le doute, « aucun » n'arrive jamais. |
| `symboleSet` | 🔴 **OUI** — déclaré vraie réponse à [:678](index.js). **C'est le défaut.** |
| `attaque` | **OUI en droit** (Dresseur/Énergie n'ont pas d'attaque) — mais l'écrasement est **correct** : c'est une clé de jointure, « aucun » irait chercher une attaque nommée « aucun ». L'information « pas d'attaque » est perdue, et elle discriminerait Dresseur/Pokémon. |
| `attaqueBrute` | idem `attaque`. |

**Bilan : un champ à corriger (`symboleSet`), deux trous en amont (`number`, `total`), un
champ où la perte est assumée mais non écrite (`attaque`).**

## 🔒 ÉCARTÉ — la rareté comme discriminant

**Correctif du champ : noté, à faire.** Le prompt dit *« Si tu n'es pas sûr, réponds
"normale" »* ([index.js:681](index.js)) et [index.js:813](index.js) refait le forçage
serveur (`parsed.rarete = parsed.rarete || 'normale'`). Journal : **157/225 `"normale"`**,
`null` **0 fois**. Le doute devient une affirmation sur la carte.

🔴 **Mais le DISCRIMINANT est écarté, et voici pourquoi : il n'y a rien à joindre.**
`catalogue_produits` ne porte que `idProduct · idExpansion · idMetacard · name`.
**Aucune colonne de rareté.** `numeros_cartes` porte `variante`, pas la rareté non plus.
Une lecture honnête de la rareté — « aucune marque », donc premier tirage japonais — n'aurait
**aucune contrepartie** au catalogue à comparer. Il faudrait d'abord importer une colonne de
rareté par produit, c'est-à-dire un chantier d'import, pas un correctif de prompt.

⛔ **Ne pas reproposer « la rareté départage les tirages » sans cette colonne.** Le correctif
du champ reste utile pour lui-même (ne plus affirmer dans le doute), il ne débloque pas le
départage.

## 🔑 LA JOINTURE QU'ON NE FAIT PAS — recalculé sur `catalogue_produits` EN BASE

⚠️ **Recalculé en base, pas sur un export.** L'œil extérieur avait mesuré sur l'export local
du 12/07. Les chiffres tombent identiques, mais ils sont désormais vérifiés à la source.

| | |
|---|---|
| produits dans les 24 expansions closes | **1 835** (0 sans `idMetacard`) |
| métacartes distinctes | 1 645 |
| métacartes à ≥ 2 produits | **151** |
| **métacartes à ≥ 2 produits dans la MÊME expansion** | **103** |
| dont dans les cinq e-Card (5021-5025) | **96** (32+16+16+16+16) |
| le reste | 5059 : 6 · 4507 : 1 |

**Sur les 219 produits de ces 103 groupes :**

| | |
|---|---|
| présents dans `numeros_cartes` | **219 / 219 — 100 %** |
| paires | 157 |
| **paires à `numero` DISTINCTS** | **156 / 157 — 99,4 %** |
| paires au même numéro | **1** (Ruin Wall, méta 212446 : les deux `numero` sont **vides**) |

### 🔴 CE QUE ÇA ÉTABLIT : ce n'est pas un problème de perception

**Dans le périmètre vintage, 156 paires sur 157 sont déjà séparables par un numéro que nous
avons en base.** Désigner l'impression n'y demande ni une meilleure photo, ni un meilleur
prompt, ni un seuil : **c'est une jointure `numeros_cartes` qu'on ne fait pas.** Le correctif
est dans le code.

⚠️ **ET LA LIMITE, QUI EST GRANDE : cette population n'est PAS celle du problème Slowbro.**
Les 103 groupes sont **dans les 24 expansions closes** ; la métacarte 463324 (Slowbro n°090)
vit en expansions **6556/6569**, modernes, hors table. Les deux mesures ne se recouvrent pas.
Ce résultat débloque le **vintage**, il ne dit rien du cas qui a ouvert le dossier.
⚠️ Et les exemples sont dominés par des **Énergies** (`Psychic Energy`, `Lightning Energy`) :
des cartes qui partagent une métacarte sans être « la même carte en deux finitions ».

## 🔒 LE CONTRÔLE SEC — la famille « lire le physique » est FERMÉE

Référence contre référence. **Aucune photo, aucune vérité, aucun appel IA.** La clause écrite
à [mesure-images-vintage.js:126-130](mesure-images-vintage.js) et jamais exercée, enfin exercée.

**Dénominateur : 219/219 produits `indexee`, 157/157 paires exploitables.**

| | |
|---|---|
| `inliers(A,A)` — auto-appariement | min 131 · **médiane 150** · max 150 |
| `inliers(A,B)` — croisé | min **14** · p25 39 · **médiane 50** · p75 62 · max 95 |
| ratio A→B / A→A | min 0,093 · **médiane 0,333** · max 0,633 |
| paires à `inliers(A,B) == 0` | **0 / 157** |
| paires à ≥ 20 | **149 / 157** |

**VERDICT : cas 3 de la clause — `inliers(bon) ≈ inliers(mauvais) ≫ 0`, la MÉTHODE échoue.**
Aucune technique ne séparera deux impressions d'une même métacarte par l'image : **c'est au
reste de la chaîne de trancher la finition, pas à l'image.** Et le chiffre qui le rend
concret : la médiane croisée vaut **50 inliers**, alors que les scores gagnants observés
contre de vraies photos vont de **4 à 48**. Deux références de la même métacarte se
ressemblent **plus** que ne ressemble une photo à sa propre référence.

**Prédictions écrites avant la mesure — trois justes, une fausse, et la fausse est dite :**
P1 (auto ≈ nombre de points) ✅ · P2 (médiane croisée ≥ 20) ✅ **50** · P3 (cas 3) ✅ ·
🔴 **P4 FAUSSE** : j'attendais peu de paires exploitables, il y en a **157 sur 157**.

⛔ **Ne pas rouvrir « et si l'image lisait le physique / la finition ».** La question est
tranchée par une mesure qui ne dépend d'aucune vérité et d'aucune photo.

## ⚠️ LE CHAMP ABSENT — holo/mat est INEXPRIMABLE, et le piège du futur `finition`

**Constat, pas correctif.** Trois champs décrivent la finition et **aucun ne peut dire
« holo »** :

| lieu | ce qu'il fait |
|---|---|
| [index.js:684](index.js) | `reverse` est défini **contre** l'holo — *« sur une holo normale c'est l'ILLUSTRATION qui brille »*. L'holo n'est décrite que pour être **exclue**, jamais demandée. |
| [index.js:687](index.js) | `motif: "aucun"` = *« la carte est mate/normale, aucun fond brillant »*. Une holo n'a **pas** de fond brillant : elle répond `"aucun"`, **comme une mate**. |
| [index.js:833](index.js) | `parsed.reverse = parsed.motif !== 'aucun'` — l'holo est donc **re-forcée** à `reverse: false`, indiscernable d'une mate. |
| [index.js:839](index.js) | `raretesElevees` = IR, SR, SIR, UR, AR, SAR, CHR, CSR — **pas d'holo**. |

**Une carte holo et une carte mate rendent exactement la même réponse sur les trois champs.**

### 🔴 À ÉCRIRE MAINTENANT, AVANT QUE LE CHAMP N'EXISTE

Si un champ `finition` naît un jour, **sa valeur « pas de brillance » doit s'appeler `mat`,
JAMAIS `aucun`.** `MOTS_VIDES` ([index.js:780](index.js)) contient `'aucun'` : le jour où
quelqu'un ajoutera `finition` à la boucle de [index.js:786](index.js) — et il l'ajoutera, la
liste s'allonge à chaque champ neuf — la valeur **vraie** « la carte est mate » deviendrait
`null`, fusionnée avec « pas lu ». **On referait sur un champ neuf le défaut de
`symboleSet`**, dix lignes plus bas, en croyant faire une hygiène.

**Le nom du champ est la parade.** Un mot qui n'est pas dans `MOTS_VIDES` ne peut pas être
écrasé par elle.

## NON RETENUES CE TOUR — nommées pour ne pas les reperdre

- **`departagerParFinition`** — c'est du **câblage**, et il est **sans objet** tant que la
  jointure `numeros_cartes` et le contrôle sec n'ont pas répondu. **Ne pas l'écrire.**
- **Généraliser `egalite-sans-enjeu`** — rendre un verdict **FERME** quand tous les membres
  du groupe donnent le même verdict contre le prix de l'annonce. 🔑 **C'est la meilleure voie
  connue vers un verdict ferme**, et elle est **non mesurable aujourd'hui** : `prixVinted`
  est non nul **0 fois sur 225**. **À rouvrir dès que des scans porteront un prix**, pas
  avant — voir la mesure d'intervalle, même cause, même blocage.
- **Les 7 métacartes hors e-Card** — expansion **5059 : 6 groupes**, expansion **4507 : 1**.
  Aucune piste à ce jour. **Nommées plutôt qu'absorbées dans un taux** : « 103 groupes »
  cacherait qu'ils ne sont pas de la même famille que les 96 e-Card.

## 🔒 ANNULÉ — le test de lecture holo/mat (2026-09-05, jamais lancé, 0 € dépensé)

**La dépense, chiffrée avant d'être engagée** : **219 images** distinctes (un appel par
image), **7,5 Mo**, moyenne 35 Ko. **219/219 scans sont sur le disque**, **157/157 paires
complètes**, **103/103 groupes exploitables**. Rien ne manque.

🔴 **MAIS LA VÉRITÉ DE LA PAIRE N'A PAS DE DIRECTION, et il faut le dire avant de dépenser.**
Vérifié : sur les 219 produits, `numero` vaut **217 fois « chiffres seuls »** et 2 fois vide
— **aucun préfixe H**. `numeros_cartes.variante` porte **V1/V2/V3…**, une étiquette de
position, **pas une finition**. Sur les 100 groupes de taille 2 : **100 « deux du même
genre »**, zéro couple orienté.

**Conséquence sur ce que le test peut mesurer** : il mesure la **DISCRIMINATION** — « le
modèle donne-t-il deux réponses différentes aux deux membres ? » — **pas la JUSTESSE**. On ne
sait pas laquelle des deux est l'holo.

⚠️ **L'écart de numéro est constant (+32 sur l'expansion 5021 : 065↔097, 066↔098, 067↔099…),
ce qui SUGGÈRE que le second bloc est le bloc holo. C'est une inférence, pas une mesure.**
La transformer en vérité serait exactement l'erreur de l'entrée 23 du catalogue : inscrire
une vérité tirée d'une source unique non recoupée.

### La raison de l'annulation, en deux points

1. **Sans direction de vérité, le test mesure la DISCRIMINATION, pas la JUSTESSE.** Un
   résultat « le modèle donne deux réponses différentes » ne dirait pas laquelle est juste.
   On aurait dépensé 219 appels pour un demi-résultat.
2. **Et il est devenu SANS OBJET** : si la jointure par le numéro fonctionne, on n'a plus
   besoin de lire la finition — le numéro imprimé sépare les impressions sans regarder la
   brillance. On ne paie pas pour un signal dont on n'a plus l'usage.

⛔ **Ne pas le relancer sans (a) une vérité orientée — quel produit est l'holo — et (b) une
raison de vouloir la finition alors que le numéro suffirait.**

## 🔴 LA PORTÉE DE LA JOINTURE PAR LE NUMÉRO — elle ne peut pas s'appliquer

**Mesuré avant tout câblage, sur les 89 lignes du banc.**

| | |
|---|---|
| lignes sans groupe d'ex aequo (≥ 2) | 42 |
| lignes AVEC un groupe d'ex aequo | **47** |
| dont aucune paire même-métacarte/même-expansion | 29 |
| **dont ≥ 1 paire départageable par le numéro** | **18** |

**18 lignes sur 89. Et parmi elles, 15 clés distinctes — donc sous le seuil de 12 en
vérités individuelles utiles. On connaîtra la portée, jamais la justesse, sans scans neufs.**

### 🔑 D'OÙ VIENDRAIT LE NUMÉRO ? De la lecture IA. Et il ne correspond à RIEN.

| | |
|---|---|
| numéro lu et EXPLOITABLE | **6 / 18** |
| numéro lu mais **NEUTRALISÉ par la règle du Pokédex** | **12 / 18** |
| aucun numéro lu | 0 |
| couverture `numeros_cartes` des membres appariés | **44 / 44 — 100 %** |

**Le catalogue est complet ; c'est la LECTURE qui manque.** Et pire que « elle manque » :

🔴 **SUR 15 CLÉS SUR 15, LE NUMÉRO LU NE CORRESPOND À AUCUN `numero` CATALOGUE DES MEMBRES
APPARIÉS.**

| clé | lu | numéros catalogue de la paire |
|---|---|---|
| L049 Mew | 151 | 087 / 119 |
| L046 Raichu | 026 | 081 / 113 / 034 / 035 |
| H009 Ninetales | 110 | 072 / 104 / 022 / 023 |
| H010 Tyranitar | 079 | 095 / 127 / 070 / 071 |
| H013 · H026 Articuno | 144 · 17 | 030 / 031 |
| H030 Vaporeon | 20 | 026 / 027 |
| H031 Mewtwo | 51 | 086 / 118 |
| L026 Pichu | 172 | 082 / 114 |
| L034 Beedrill | 015 | 004 / 005 |
| L040 Hypno | 097 | 041 / 042 |
| L050 Pidgeot | 018 | 091 / 123 |
| L051 Charmander | 004 | **S09 / S10** |
| L052 Entei | 244 | 026 / 027 |
| H004 Pikachu | 123/PCG-P | 13 / 40 |

**Correspondance : 0 / 15.** Ce que l'IA lit sur ces cartes est un **numéro de Pokédex**
(Mew 151, Articuno 144, Entei 244, Charmander 004…), pas un numéro de collection. La règle
du Pokédex le neutralise à juste titre sur 12 des 18 — et sur les 6 restantes, où il n'est
pas neutralisé, **il ne correspond pas davantage**.

### Ce que ça veut dire, sans détour

**La jointure fonctionne sur le CATALOGUE (156/157 paires séparables) et ne peut PAS
s'appliquer sur les SCANS**, parce que la carte ne porte pas le numéro qui sépare. C'est
exactement le résultat « `numero: null` est FIDÈLE », vu du côté de l'usage : ces cartes
n'impriment pas de numéro de collection, donc aucune lecture, si bonne soit-elle, ne le
rendra.

⛔ **Ne pas câbler `departagerParNumero` sur cette population.** Le correctif est dans le
code pour les cartes QUI PORTENT un numéro ; sur les 24 expansions closes, la donnée
d'entrée n'existe pas sur la carte.

**Ce qu'il faudrait pour rouvrir** : une source du numéro de collection qui ne soit pas la
photo — un pont TCGdex par expansion, ou le titre de l'annonce. Les deux sont hors de ce
tour et hors de l'image.

## 🔴 PIÈGE — DEUX CLÉS POUR LE MÊME CHAMP, ET UNE ROUTE MORTE

**Pour qui lira ce code plus tard.** Le prix de l'annonce entre par **deux noms différents
selon la route**, et l'une des deux routes ne reçoit **rien** :

| route | clé lue | trafic réel |
|---|---|---|
| `/api/identifier` | **`req.body?.prixVinted`** ([index.js:3335](index.js)) | **225 / 225** |
| `/api/analyser` | `vintedPrice` ([index.js:2806](index.js)) | **0 / 225 — TRAFIC MORT** |
| `/api/retour-live` | `prixLive` / `prixLiveEtat` ([index.js:5638](index.js)) | autre canal, autre champ |

**La clé attendue par la route réellement empruntée est `prixVinted`.** Un client qui
poste `vintedPrice` à `/api/identifier` **ne déclenche aucune erreur** : le champ est
simplement absent, et `prixVinted` reste non nul **0 fois sur 225**.

⚠️ **Ce que le serveur NE peut PAS prouver** : que l'extension envoie bien la mauvaise clé.
D'ici on ne voit qu'une **absence**, compatible avec « mauvaise clé » comme avec « aucun prix
envoyé ». Transmis à l'agent extension le 2026-09-05 ; c'est lui qui tranche en regardant ce
qu'il poste. **La divergence des deux clés, elle, est un fait du code.**

## 🔒 LA PISTE 2 (e-Card) NE TOUCHE AUCUNE LIGNE DU BANC — 0 sur 55

**Dénominateur : 55 lignes de cellule portant une vérité individuelle** (les 71 vérités de
`banc-verites.json` sont toutes des saisies à l'aveugle ; toute ligne de cellule appariée en
porte donc une).

| | |
|---|---|
| vérités en expansion **e-Card (5021-5025)** | **0 / 55** |
| vérités dans les 24 sets, **hors** e-Card | **41** |
| vérités hors des 24 sets | 14 |

Expansions réellement représentées : 4465 (8), 4170 (7), 4463 (6), 3781 (6), 4464 (5),
4508/4509 (4 chacune)… **La partition e-Card et le banc ne se recouvrent pas.** Les 96 groupes
e-Card du chantier « jointure » ne peuvent donc être vérifiés sur aucune ligne existante.

## 🎯 LE PLAFOND DE L'ATTAQUE — 66,7 % sur la cellule, et ma prédiction était INVERSE

Mesuré au **catalogue seul** : aucune lecture, aucune vérité de lecture, aucun appel IA.
**C'est un PLAFOND — il suppose une lecture parfaite — jamais une performance.**

| | tout le banc (89) | **la cellule (55)** |
|---|---|---|
| vérité AVEC attaque | 81 | **42** |
| vérité SANS attaque (Énergie, Dresseur) | 5 | 1 |
| vivier partiellement sans attaque *(population séparée)* | 5 | 1 |
| isole un sous-ensemble **strict** | 71/81 — 87,7 % | **34/42 — 81,0 %** |
| **isole UNE SEULE métacarte** | 24/81 — **29,6 %** | **28/42 — 66,7 %** |
| fraction du vivier retenue, médiane | 13,2 % | 28,6 % |

⚠️ **Rappel du contexte, sans quoi le chiffre ment** : **17 881 produits sur 73 188 (24,4 %)**
n'ont aucun crochet dans `name`. **Une absence d'attaque n'est pas une non-correspondance** —
c'est pourquoi les trois populations sont comptées séparément et jamais additionnées.

🔴 **PRÉDICTION P3 FAUSSE, et c'est le résultat.** J'avais prédit un plafond **plus bas** sur
la cellule (« vivier déjà réduit, beaucoup de candidats sont la même carte »). Il est **plus
du double** : **66,7 % contre 29,6 % hors cellule**, prédiction exactement inverse.
**Le test de mise à mort n'est pas déclenché : c'est le meilleur signal mesuré sur cette
population.**

## LA RELECTURE — le seul chemin qui rende l'attaque mesurable sans vérité nouvelle

**Le problème n'est pas les vérités (55 existent), ce sont les LECTURES** : `attaqueLue` est
non nul **1 fois sur 225**, et **0 fois sur les 89 lignes du banc**.

**Test de mise à mort passé, zéro appel IA** — un HEAD par URL :

| | |
|---|---|
| lignes de cellule portant une `imageUrl` | **54 / 55** *(1 non relisable par aucun moyen)* |
| **photos VIVANTES** | **54 / 54 — 100 %** |
| la plus ancienne | 2026-08-02, **35 jours** |

*(Le « mort à trois semaines » du 12/08 était une signature `?s=` tronquée, pas une
suppression — catalogue, entrée 24.)*

**Coût, chiffré avant d'être engagé : 54 appels** au modèle de production, un par image.

### ⚠️ GARDE D'INSTRUMENT, NON NÉGOCIABLE

**La relecture est une COLONNE À PART, déclarée. Elle ne remplace JAMAIS la lecture d'origine
au journal, et ne s'écrit pas dans `journal_scans`.** Substituer l'une à l'autre referait
« la simulation dit 12, la production dit 0 » : on croirait mesurer la production alors qu'on
mesurerait un prompt d'aujourd'hui rejoué sur des photos d'hier.

### ⚠️ ET LA MESURE QUI COMPTE N'EST PAS LE PLAFOND

Le plafond (66,7 %) suppose que l'IA lit **l'attaque qui discrimine**. La relecture mesure
autre chose, et c'est la vraie question : **combien de fois, sur une vraie photo d'annonce,
l'IA lit-elle celle-là ?** Un plafond haut avec une lecture faible ne vaut rien.

## Le troisième état de l'attaque — DÉCRIT, NON ÉCRIT

`departagerParAttaque` rend aujourd'hui **une seule sortie muette pour deux causes
distinctes**. Sur le modèle exact du troisième état de `nomOpposeUnVeto`
([index.js:2214-2242](index.js)) :

| cas | ce que ça prouve | sortie |
|---|---|---|
| l'attaque lue n'existe **nulle part** dans le vivier | rien — *« la preuve est impossible »* | bruit, on se tait |
| elle est portée par **≥ 1 produit du vivier** mais par **zéro ex aequo** | **preuve positive** que le groupe ne contient pas la carte lue | `incoherent: true`, verdict supprimé, **aucun candidat accusé** |

⚠️ **Désarmé si `attaqueConfiance !== 'haute'`**, comme le veto par le nom.

### Le contrôle qui le validerait

**Le régime doit rester INVARIANT : 37 justes / 7 faux / 45 refus, à l'unité près. Seule la
COLONNE DES MOTIFS bouge** — des refus aujourd'hui étiquetés « rien lu » deviennent
« groupe contredit par l'attaque ». **Si un seul juste, faux ou refus se déplace, l'état a
été écrit trop large et il faut s'arrêter.** Il ne désigne rien, il ne change aucun verdict :
il sépare deux causes de refus confondues.

## LA RELECTURE DU 2026-09-05 — 54 appels, colonne à part

**54 photos, 54 réponses exploitables, 0 échec.** Résultats persistés dans
`aj-relecture.json`. **RIEN n'a été écrit en base.**

🔴 **COLONNE À PART, ET DEUX ÉCARTS DÉCLARÉS AVEC LA PRODUCTION** : la relecture n'a **pas
le titre de l'annonce** et ne voit **qu'une seule photo** au lieu de toutes. Elle voit donc
**moins** que la production — elle ne peut pas la flatter, et elle ne mesure pas sa justesse.
Le prompt n'est pas recopié : il est **extrait de `index.js`** à l'exécution (13 325
caractères), pour qu'il n'en existe pas une seconde version qui divergerait.

### 1. L'attaque — 55,8 % réel contre 66,7 % de plafond

| | 54 lignes |
|---|---|
| `attaque` rendue | **52 — 96,3 %** |
| non rendue | 2, **toutes deux en confiance `basse`** → désarmées par le verrou 1 |
| confiance | haute **52** · basse 2 — rien entre les deux |
| c'est l'attaque du produit-**VÉRITÉ** | **37 / 52 — 71,2 %** |
| **isole une seule métacarte** du vivier | **29 / 52 — 55,8 %** |
| **et c'est la BONNE métacarte** | **27 / 52 — 51,9 %** |
| isole une métacarte **fausse** | **2** |

**La lecture réelle perd 11 points sur le plafond, pas la moitié.** Une carte sur deux serait
ramenée à la bonne métacarte.

### 2. 🔴 LES 2 FAUSSES NE SONT SÉPARABLES PAR AUCUN CRITÈRE QU'ON AIT DÉJÀ

| | L046 Raichu | H019 Jynx |
|---|---|---|
| attaque lue | « Quick Attack » (でんこうせっか) | « Ice Punch » (れいとうパンチ) |
| attaque de la vérité | `gigashock` | `icepunch | coldbreath` |
| métacarte désignée | 407388 (produit 654243) | 212819 (produit 650627) |
| métacarte de la vérité | 211736 (584721) | 335761 (571895) |
| `attaqueConfiance` | **haute** | **haute** |
| taille du vivier | 9 | 5 |
| porteurs de l'attaque | 1 | 1 |

**Comparé aux 27 justes** : confiance **haute des deux côtés** · taille du vivier des justes
**min 1 · médiane 2 · max 9** — les deux fausses (9 et 5) sont **dedans** · porteurs des
justes **min 1 · médiane 1 · max 2** — les deux fausses valent **1**, comme la médiane.

**Aucun des trois critères ne sépare. Il n'y a pas de verrou supplémentaire à poser avec ce
qu'on a.** La règle coûte donc **2 erreurs pour 27 justes**, et c'est ainsi qu'il faut
l'écrire — pas « 2 erreurs qu'un verrou écartera ».

⚠️ **Et le cas Jynx est instructif** : l'attaque lue **EST** celle de la vérité
(`icepunch`), mais elle est aussi portée par un autre produit du vivier, seul de sa
métacarte. **Lire juste ne suffit pas** : c'est le catalogue qui décide si la lecture isole.

⚠️ **Tout critère trouvé APRÈS avoir vu ces deux lignes serait une HYPOTHÈSE, pas un gain**
— même statut que `écart ≥ 2` : à confirmer sur des lignes fraîches, jamais à câbler sur
les lignes qui l'ont suggéré.

### 3. Les échecs sans porteur : **20, pas 4** — et trois causes distinctes

⚠️ **Correction** : j'avais nommé 4 échecs, c'était ce que ma sortie tronquée montrait. Il y
en a **20** sur les 52 (les 3 restants portent l'attaque sur plusieurs métacartes).

Test : l'attaque lue existe-t-elle ailleurs dans les 73 188 produits ?
⚠️ **C'est une recherche par SOUS-CHAÎNE, elle sur-compte** (« Zzap » attrape « Buzzap »).

| cause | exemple | ce que ça dit |
|---|---|---|
| **quasi-lecture, à une lettre** | L026 Pichu : lu **« Zzap »**, la vérité porte **« Zzzap »** | la jointure exacte échoue sur **un caractère** |
| **nom anglais plausible mais faux** | H015 Farfetch'd : lu « Leek Strike », la vérité porte **« Leek Slap »** ; « Leek Strike » existe, sur *Galarian Sirfetch'd* | le modèle produit un nom qui EXISTE, appartenant à une autre carte |
| **lecture JUSTE, vivier amputé** | L029 Rattata : lu « Scratch », qui **EST** l'attaque de la vérité — 0 porteur au vivier | ce n'est pas la lecture qui échoue, c'est le **vivier** |
| **orthographe inconnue** | H016 Sabrina's Jynx : « Good Manners », **0 produit** au catalogue | translittération probablement fausse |

🔑 **Les quatre tombent aujourd'hui dans le MÊME silence.** C'est exactement ce que le
troisième état (décrit plus haut) sépare — et la cause « vivier amputé » n'est pas une cause
de lecture du tout.

### 4. Le symbole : **9 sur 54 — 16,7 %, une carte sur six**

Lu **en BRUT**, hors du parseur de production. `R` 9 · **`aucun` 9** · `gym` 6 ·
`feuilles` 5 · `pokeball` 5 · `etoile` 4 · `couronne` 4 · `fossile` 3 ·
**`illisible` 3** · `ruines` 2 · `e1`/`e3`/`palmier`/`promo-etoile` 1 chacun.

🔴 **`MOTS_VIDES` détruit 9 lectures sur 54 — une carte sur six.** Ces 9 « j'ai vu
l'emplacement et il est VIDE » deviennent `null`, indiscernables de « je n'ai pas lu ».
C'est le compte que le journal ne pouvait pas donner : au journal, `"aucun"` vaut **0/225**.

**Ce qu'une règle d'élimination par l'absence de symbole écarterait — le chiffre :**
**0 set sur 24** porte `symbole: 'aucun'` dans la table close. Les 24 se répartissent en
22 sets À symbole (`logo-tcg` EXP/WEB, `gym` G1/G2, `feuilles` PJU, `fossile` MFO,
`R` ROG, `palmier` SI-JP, `etoile` N1, `ruines` N2, `couronne` N3, `eclair` N4,
`vs` VS, `e1`-`e5`, `empreintes` ADV2, `croix` ADV3, `cercle-chiffre` IPB,
`mcdo` MCDP) et **2 sets non relevés** (ADVex1, DP5c — `symbole: null`).

**Donc : une lecture « aucun » honnête écarterait AU MIEUX les candidats des 22 sets à
symbole — la quasi-totalité du vivier vintage.** La règle serait **très forte**, et elle est
**aujourd'hui inapplicable** : il n'existe aucune contrepartie `'aucun'` dans la table. Elle
ne le deviendrait qu'après un relevé de terrain set par set. *(Les 9 lignes concernées
portent 35 candidats au total, médiane 4 par ligne.)*

### 5. Numéro et total : non mesurable, dénominateur **0**

`number` rendu **51/54 (94,4 %)** · `total` rendu **0/54** (la cellule est *sans total*).
🔴 Les **47 produits-vérité distincts** ont tous un document `numeros_cartes` avec
`numero: null` **ET** `numeroUrl: null` (source cardmarket, codeSet EXS/EXP/N3…).
**La justesse du numéro a un dénominateur de 0.** La partition « e-Card mal lue » contre
« carte sans numéro » se tranche entièrement du second côté : **Cardmarket ne publie aucun
numéro pour ces cartes.** C'est `numero: null` est FIDÈLE, une troisième fois.

### 6. Stabilité — le modèle ne bouge presque pas

`name` **54/54 — 100 %** · `number` **50/51 — 98 %** · `symboleSet` 32/36.
Un écart mesure la **variance du modèle** et les deux différences déclarées, jamais un
progrès. Il est faible : **nos mesures de lecture ne sont pas bornées par l'instabilité.**

### 🔴 MES DEUX PRÉDICTIONS FAUSSES, NOMMÉES

- **P-b FAUSSE** : je prédisais `"aucun"` **< 10 %** et `illisible` dominant. C'est
  **16,7 %**, et `illisible` ne fait que 3 sur 54. Je sous-estimais à quel point ces cartes
  portent un emplacement vide, et donc à quel point `MOTS_VIDES` coûte cher.
- **P-d FAUSSE** : je prédisais le `number` identique **~70 %** entre journal et relecture.
  C'est **98 %**. Je surestimais la variance du modèle — et cette erreur-là aurait borné à
  tort toutes nos mesures de lecture.

*(Deux prédictions justes au passage : `attaque` rendue ≥ 85 % → 96,3 % ; `number` rendu
> 80 % → 94,4 %. Et une largement sous-estimée : je donnais « la moitié du plafond » pour
l'isolement, c'est **84 % du plafond**.)*

## LA QUASI-LECTURE — les deux colonnes, jamais la première seule

**Tolérance de distance d'édition ≤ 2 sur la clé de jointure, mesurée sur la relecture.**
⚠️ Une tolérance orthographique sur une clé de jointure peut transformer un **silence
honnête** en **désignation fausse**. Les deux colonnes sont rendues ensemble ou pas du tout.

| COLONNE A — ce qu'elle rattrape | dénominateur : **20** échecs sans porteur |
|---|---|
| à distance ≤ 2 d'une attaque **du vivier** | **2 / 20** |
| dont elle désigne la **BONNE** métacarte | **2** |
| dont elle désigne une **FAUSSE** métacarte | **0** |
| dont elle reste ambiguë (> 1 métacarte) | **0** |

Les deux : **Pichu** « Zzap » → « zzzap » (**d = 1**) · **Cool Porygon** « Texture Magic » →
« textures magic » (**d = 1**). Les deux sont des **quasi-lectures à un caractère**.

| COLONNE B — ce qu'elle casse | dénominateur : **27** justes |
|---|---|
| justes **conservées** | **27 / 27** |
| justes **détruites** | **0 / 27** |

**BILAN NET : +2 rattrapées, −0 perdues, 0 nouvelle désignation fausse.**

⚠️ **ET CE QUE CE BILAN NE PROUVE PAS.** 27 justes est un dénominateur **trop petit pour
certifier une tolérance**. L'absence de collision ici n'est pas une preuve d'innocuité à
l'échelle du catalogue : sur 73 188 produits, des noms d'attaque à un caractère l'un de
l'autre existent forcément. **Le gain est de 2 lignes ; le risque n'est pas mesuré.** À ce
titre, la tolérance est une **hypothèse**, au même statut que `écart ≥ 2` — jamais un gain
acquis, et surtout pas à câbler sur les lignes qui l'ont suggérée.

## « VIVIER AMPUTÉ » — 7 des 20 ne sont PAS des échecs de lecture

| | |
|---|---|
| échecs sans porteur | **20** |
| dont l'attaque lue est **JUSTE** (celle de la vérité) et le vivier n'a **aucun** porteur | **7** |
| **vrais échecs de LECTURE** | **13** |

Les sept : **Rattata** « Scratch » · **Brock's Rhyhorn** « Horn Toss » · **Mew** « Pound » ·
**Charmander** « Growl » · **Caterpie** « Tackle » · **Growlithe** « Errand-Running » (×2).
Sur les sept, **la vérité est ABSENTE du vivier**.

🔑 **Ces 7 lignes doivent être comptées avec le défaut de VIVIER, pas avec l'attaque.**
L'IA a lu juste ; c'est le vivier qui ne contenait pas la carte. Les additionner aux échecs
de lecture ferait porter à l'attaque un défaut qui n'est pas le sien.

**Le compte du défaut de vivier, sur la même population** : **11 des 52** lignes à attaque
rendue ont leur vérité **absente du vivier** — aucun départage, quel qu'il soit, ne peut les
rattraper.

## LE TROISIÈME ÉTAT — sa portée réelle : 19 lignes

Mesuré sur des **lectures vraies**, pas sur une hypothèse.

| | |
|---|---|
| lignes à attaque rendue | 52 |
| sans groupe d'ex aequo (≥ 2), écartées | 20 |
| **examinées** | **32** |
| 🎯 **CONTRADICTION POSITIVE** — ≥ 1 porteur au vivier, **0 dans les ex aequo** | **19** |
| BRUIT — aucun porteur nulle part, on se tait | 13 |

**19 lignes sur 32 (59 %) porteraient la contradiction positive** : Raichu, Grimer, Articuno,
Hitmontop, Porygon2, Cyndaquil, Dratini, Beedrill, Spearow, Lapras, Paras, Larvitar,
Girafarig, Pidgeot, Snorlax, Dark Charizard… Sur chacune, l'attaque lue **existe dans le
vivier** mais **aucun ex aequo ne la porte** — preuve que le groupe ne contient pas la carte
lue.

**Aujourd'hui ces 19 lignes rendent le MÊME silence que les 13 lignes de bruit.** Le
troisième état sépare deux causes que rien ne distingue en sortie. Il ne désigne rien et ne
change aucun verdict : **le contrôle reste que 37/7/45 doit rester invariant à l'unité près,
seule la colonne des motifs bouge.**

## LA RÈGLE, ÉCRITE TELLE QU'ELLE EST

**27 justes pour 2 fausses.** Aucun verrou supplémentaire n'est posable :
les deux fausses (L046 Raichu, H019 Jynx) sont **indiscernables a priori** des 27 justes sur
les trois critères qu'on possède —

| critère | les 2 fausses | les 27 justes |
|---|---|---|
| `attaqueConfiance` | **haute**, haute | **haute** |
| taille du vivier | 9, 5 | min 1 · médiane 2 · **max 9** |
| nombre de porteurs | 1, 1 | min 1 · **médiane 1** · max 2 |

**Pas d'adoucissement : la règle coûte 2 erreurs pour 27 justes, et rien de ce qu'on mesure
aujourd'hui ne permet de les éviter.**

## 🔑 LA DISTRIBUTION DES RANGS — le classement n'est PAS le problème

> 🔴 **CHIFFRES CORRIGÉS LE 2026-09-06 — lire d'abord « CORRECTION MAJEURE — LE VIVIER DE LA
> ROUTE » plus bas.** Trois chiffres de cette section sont FAUX et restent écrits pour que la
> correction soit relisible : **29 absences → 14**, **67,4 % → 84,3 %**, **52,9 % hors cellule
> → 100 %**, **15 fermes sans vérité au vivier → 1**. Ils venaient d'un vivier de MA
> construction, pas de celui de la route.
> 🔑 **CE QUI LES A RATTRAPÉS EST LA RÉSERVE ÉCRITE DANS CETTE SECTION MÊME** (« le 52,9 %
> hors cellule est un minorant », « à reprendre avec le vivier exact de la route »). Elle a
> été posée AVANT qu'on demande la vérification, et elle désignait la bonne cause. **Une
> réserve écrite au moment de la mesure vaut plus qu'une correction écrite après coup** :
> c'est elle qui a empêché ces chiffres de servir de base à une décision.
> ⚠️ **Ce qui reste VRAI dans cette section** : la distribution des rangs elle-même — quand la
> vérité est au vivier, elle est dans le top 3. C'est l'instrument « vivier par le nom », et il
> reste valable **contre lui-même** (avant/après un changement de périmètre).

**Nouvelle règle d'affichage** : verdict FERME → une seule carte · SOUS RÉSERVE → les
**3 meilleurs candidats avec leur photo**. L'objectif devient « la vérité dans le TOP 3 »,
un problème de **CLASSEMENT**, pas d'identification. Rien n'est affirmé, le critère de
lancement n'est pas en jeu.

⚠️ **VIVIER DÉCLARÉ** : vivier par le NOM, restreint aux 24 sets quand la restriction est
non vide, sinon le nom entier — le même que `apres()` sur la cellule, et le même que toutes
les mesures d'aujourd'hui.

### Le résultat, et il est net

| dénominateur **89** lignes à vérité individuelle | tout le banc | **cellule (55)** | hors cellule (34) |
|---|---|---|---|
| **ABSENTE DU VIVIER** *(pas un rang — le plafond)* | **29** | **13** | **16** |
| rang 1 | 54 | 36 | 18 |
| rang 2-3 | 6 | 6 | 0 |
| rang 4-10 | **0** | **0** | **0** |
| rang 11+ | **0** | **0** | **0** |
| 🎯 **TOP 3 parmi les PRÉSENTES** | **60/60 — 100 %** | **42/42 — 100 %** | **18/18 — 100 %** |
| top 3 sur toutes les lignes | 67,4 % | **76,4 %** | 52,9 % |

🔴 **QUAND LA VÉRITÉ EST DANS LE VIVIER, ELLE EST TOUJOURS DANS LE TOP 3. Zéro exception sur
60 lignes.** Le classement ne perd jamais la carte au-delà du rang 3. **Le seul obstacle à
la nouvelle règle d'affichage est le VIVIER**, et c'est le plafond de tout le reste : 29
vérités sur 89 n'y sont pas.

⚠️ **RÉSERVE SUR LES 16 ABSENCES HORS CELLULE.** Sur la cellule, le vivier mesuré **est**
celui de la route (`apres()`), donc les 13 absences y sont réelles. Hors cellule, la route
emprunte aussi `trouverParSetCodeEtNumero` : une partie des 16 absences peut venir de **ma**
construction de vivier, pas de la production. **Le 76,4 % de la cellule est solide ; le
52,9 % hors cellule est un minorant.**

### Par régime d'affichage

| | n | absente du vivier | rang 1 | rang 2-3 | top 3 sur n |
|---|---|---|---|---|---|
| **SOUS RÉSERVE** (les 3 s'y affichent) | 48 | 7 | 35 | **6** | **85,4 %** |
| REFUS (aucun verdict aujourd'hui) | 15 | 7 | 8 | 0 | 53,3 % |
| **FERME** (une seule carte) | 26 | **15** | 11 | 0 | 42,3 % |

**Sur les lignes SOUS RÉSERVE — celles où les 3 candidats s'afficheront — le top 3 vaut
85,4 %, et 100 % des présentes.** Les 6 lignes de rang 2-3 sont **exactement** celles que la
nouvelle règle rattrape : aujourd'hui invisibles, demain affichées.

### 🔴 LE SEUL CAS GRAVE, ET IL N'EST PAS CELUI QU'ON ATTENDAIT

| | |
|---|---|
| FERMES où la vérité est présente mais **pas au rang 1** | **0 / 11** |
| **FERMES dont la vérité est ABSENTE DU VIVIER** | **15 / 26** |

**Aucun verdict ferme ne se trompe de rang.** Quand la carte est là, le ferme la met
première, 11 fois sur 11. **Le danger est ailleurs : 15 fermes sur 26 portent sur une ligne
où la vérité n'est même pas candidate.** Aucune règle d'affichage — top 3 ou non — ne peut
rattraper ça. ⚠️ Sous la réserve ci-dessus : une partie de ces 15 relève de mon vivier hors
cellule, pas de la route. **À reprendre avec le vivier exact de la route avant d'en tirer une
décision.**

### Le terme PRIX ne coûte AUCUNE place de top 3

**0 ligne au-delà du rang 3** — il n'y a donc **rien** à récupérer, et l'écart au 3e n'a pas
de population à mesurer. Neutralisé par la voie de production (`rarete: 'promo'`,
[scoring.js:1861](scoring.js)) : **top 3 avec le terme 60, sans lui 60, net +0.** Aucune
ligne n'entre, aucune ne sort.

🔑 **Ce que ça règle** : on savait que le terme `prix` déclasse à tort sur le **rang 1**.
**Sur l'objectif TOP 3, il ne coûte rien.** Le corriger reste utile pour le verdict ferme ;
ce n'est **pas** un levier pour la nouvelle règle d'affichage.

## Statut des deux pistes de l'attaque — HYPOTHÈSES, pas acquis

- **Tolérance orthographique (distance ≤ 2)** : +2 rattrapées, −0 perdues, 0 nouvelle fausse
  désignation. **Le gain est mesuré, le risque ne l'est pas** — 27 justes est un dénominateur
  trop petit pour certifier une tolérance sur une clé de jointure. ⛔ **Ne jamais la câbler
  sur les lignes qui l'ont suggérée** ; elle se confirme sur des lignes fraîches ou pas du tout.
- **Troisième état (contradiction positive)** : **19 / 32** lignes à groupe d'ex aequo.
  Portée réelle mesurée sur des lectures vraies, mais **la même population que celle qui l'a
  suggéré**. ⛔ Même règle : hypothèse jusqu'à confirmation ailleurs. Son contrôle reste
  **37/7/45 invariant à l'unité près, seule la colonne des motifs bouge**.

## 🔴 CORRECTION MAJEURE — LE VIVIER DE LA ROUTE, MESURÉ AVEC SON PROPRE CODE

**Mon chiffre précédent était faux, et de beaucoup.** J'avais rendu « 29 absences sur 89 »
et « 52,9 % hors cellule » avec un vivier de MA construction. Rejoué avec les fonctions
**exportées de production** — `trouverParSetCodeEtNumero` + `nomOpposeUnVeto`,
`trouverCarteTCGdex` → union des deux `trouverProduitsLocaux` (ce que fait `viviersUnis`),
puis `trouverProduitsParNumero` :

| | ancien (mon vivier) | **route** |
|---|---|---|
| vérité présente, tout le banc | 60 / 89 | **75 / 89 — 84,3 %** |
| **hors cellule** | 18 / 34 — 52,9 % | **34 / 34 — 100 %** |
| cellule | 42 / 55 | **41 / 55 — 74,5 %** |
| **absences** | 29 | **14** |

**Hors cellule, la route ne perd JAMAIS la vérité. 34 sur 34.** Les voies : `nom` 15,
`setcode-numero` 17, `nom-uni` 2.

🔴 **ET LE « CAS GRAVE » S'EFFONDRE AVEC** : fermes dont la vérité est absente du vivier —
**1, pas 15**. C'est **L049 Mew** (rendu 819217, vérité 571770), et elle sort **FAUSSE**.
Les 14 autres étaient un artefact de ma construction. **La réserve que j'avais écrite était
la bonne, et elle a servi.**

⚠️ **CE QUI MANQUE ENCORE** : `viviersAvecRangs` n'est pas exportée et peut REMPLACER le
vivier par nom. Je ne la réimplémente pas. **84,3 % reste un minorant**, mais serré.

### Les 14 absences, par cause — une seule classe domine

| | |
|---|---|
| **SET HORS PÉRIMÈTRE** — la vérité EST au vivier par le nom, le filtre des 24 sets la retire | **13 / 14** |
| NOM — le nom lu ne ramène pas la vérité (H003 « The Rocket's Trap » → *Imposter Oak's Revenge*) | 1 / 14 |
| langue · variante · autre | **0** |

Les treize : Mew (exp 4170) ×2, Farfetch'd (4170), Jynx (4170) ×2, Rattata (3781),
Paras (3781), Brock's Rhyhorn (**5681**), Charmander (3781), Caterpie (3781),
Growlithe (3781) ×2, Cool Porygon (4170).

🔑 **UNE SEULE CLASSE, UN SEUL CORRECTIF : le périmètre. Il rendrait candidates 13 des 14
absences.** Les expansions en cause sont **3781, 4170, 5681** — toutes hors de la table
close des 24. C'est le même verdict que le scan Ho-Oh, sur une population de 89 lignes au
lieu d'une.

⚠️ **Et le régime « sans périmètre » a déjà été mesuré et ÉCARTÉ** (JUSTE 63 → 56, FAUX
8 → 25). Le correctif n'est donc **pas** « retirer le périmètre » : c'est **l'élargir aux
bonnes expansions**, ce qui demande de savoir lesquelles — et c'est un travail de table,
pas de code.

## LE TITRE DE L'ANNONCE — INERTE là où il déciderait

**DÉNOMINATEUR D'ABORD**, et il tranche seul :

| | |
|---|---|
| `titreAnnonce` au journal | présent **73 / 227** · **NON NUL 57 / 227** |
| premier titre journalisé | **2026-08-13** |
| lignes du **BANC** portant un titre | **4 / 89** |
| 🔴 lignes à **VÉRITÉ ABSENTE DU VIVIER** portant un titre | **0 / 17** |

🔴 **LA POPULATION QUI DÉCIDE EST VIDE.** Aucune des lignes que le titre aurait dû rattraper
n'en porte un : elles datent toutes d'**avant le 2026-08-13**. **Le test de mise à mort ne
peut pas se déclencher** — la piste n'est pas réfutée, elle est **INERTE**, exactement comme
le départage par l'attaque ce matin. Écrire « le titre n'aurait rien rattrapé » serait
inventer un résultat sur zéro ligne.

**Ce que contiennent les 4 titres du banc** (comptes séparés, jamais additionnés) :
set/expansion **1** · année **0** · numéro `NNN/NNN` **3** · mention d'édition **0** ·
langue explicite **1**.

### Ce que les 57 titres montrent quand même — un INDICE, pas une mesure

**27 des 57 sont en langue asiatique**, et plusieurs portent exactement l'information de
périmètre qui manque : *« Dragonite Holo 149 **Mystère des Fossiles** JAP Vintage »*,
*« Tadmorv **Banned Rocket Gang** 088/065 JAP »*, *« Kaiminus **Neo** Jap »*,
*« Carte Pikachu **Expansion pack** »*, *« Pokémon **e séries 2** jap »*,
*« Altaria ex – 019/068 – **Espèce Delta** »*.

⚠️ **C'est un indice sur 57 lignes hors banc, pas une mesure.** Et le risque est visible à
l'œil sur la même liste : *« Pikachu non officiel »*, *« Lisez bien l'annonce ! »*,
*« Carte pokemon »* (titre vide de sens), *« Grolem/Golem Holo »* (deux noms). **Un vendeur
n'est pas une source fiable** — le titre ne pourrait être qu'un **indice d'élargissement du
vivier**, jamais un filtre.

⚠️ **ET IL AGIRAIT SUR LE VIVIER, PAS SUR LE DÉPARTAGE.** Le branchant ailleurs, il ne
pourrait jamais tirer : les 13 absences sont des exclusions de périmètre, décidées **avant**
tout classement.

### 🔴 CE QU'IL FAUDRA POUR LE MESURER : DES SCANS NEUFS, ET RIEN D'AUTRE

Pas une requête, pas un rejeu : **des scans neufs**. La population qui décide est « lignes du
banc dont la vérité est absente du vivier ET portant un `titreAnnonce` » ; elle vaut **0**
aujourd'hui parce que les deux conditions ne se recouvrent pas dans le temps — le champ naît
le **2026-08-13**, les lignes concernées sont toutes antérieures. Aucun traitement a
posteriori ne peut fabriquer un titre sur un scan qui n'en portait pas.

⚠️ **ET LE PÉRIMÈTRE ÉLARGI VIDERAIT CETTE POPULATION PLUS VITE QUE LES SCANS NEUFS NE LA
REMPLIRAIENT** : mesuré ci-dessus, les 14 absences tombent à **1**. Le titre était censé
servir là où le vivier perd la vérité ; si le périmètre règle 13 des 14 cas, **il ne reste
presque plus rien à rattraper**. La piste ne meurt pas de ses chiffres — elle peut mourir de
ce que l'autre piste corrige avant elle. **On la garde INERTE, on ne la relance pas avant que
le périmètre soit tranché.**

**À rouvrir quand des lignes du banc porteront un titre** — même condition que l'attaque,
l'intervalle et `egalite-sans-enjeu`. Quatre pistes, un seul blocage : **le journal est
plus jeune que les champs qu'on veut mesurer.**

## 🔑 LES TROIS EXPANSIONS — ce que l'admission exigerait, et ce qu'elle coûterait

**2026-09-06.** 3781, 4170 et 5681 portent **13 des 14 absences** du vivier de la route.
Réparties : **3781 → 6 lignes · 4170 → 6 · 5681 → 1**. La 14e (H003) est un problème de nom,
pas de périmètre. ⚠️ **RIEN N'A ÉTÉ AJOUTÉ. La table n'est pas touchée.**

### La fiche des trois, lue en base

| | **3781** | **4170** | **5681** |
|---|---|---|---|
| `codes_set.codeSet` | **EXS** | **UNP** | **CGN** |
| `slugSet` | `Expansion-Sheet` | `Unnumbered-Promos` | `Nivi-City-Gym` |
| nom | Expansion Sheet (feuilles distributeur) | « Unnumbered Promos » | Nivi City Gym |
| produits au catalogue | **125** | **207** | **25** |
| lignes `numeros_cartes` | 125 | 205 | **9** (sur 25) |
| **région** (`codes_set.region`) | **japonais** | 🔴 **absente** | 🔴 **absente** |
| source de la région | `place-internationale-prise-par-MEW` | `nom-hors-catalogue` | `nom-hors-catalogue` |
| symbole de set attesté | 🔴 **aucun relevé** | 🔴 aucun relevé | 🔴 aucun relevé |
| période | 🔴 **inconnue en base** | 🔴 inconnue | 🔴 inconnue |

⚠️ **LA PÉRIODE N'EST PAS UN OUBLI, ELLE EST ABSENTE DU MONDE MESURABLE ICI.** Mesuré sur les
**73 188** produits du catalogue : `dateSortie` **0**, `releaseDate` **0**, `annee` **0**,
`year` **0** — et `langue` / `idLanguage` / `language` **0** aussi. Le catalogue ne porte
que `idProduct`, `idExpansion`, `idMetacard`, `name`. **Une année pour ces trois sets
viendrait forcément d'une source EXTERNE**, par le même chemin que l'Intro Pack — attestation
rapportée, provenance écrite, vérification impossible de mon côté.

### La règle d'admission, appliquée telle qu'elle est écrite

Les trois critères de `sets-vintage-japonais.js` : (1) le `slugSet` existe exactement dans
`numeros_cartes` ; (2) il ne désigne qu'UNE expansion ; (3) la région lue dans `codes_set`
est « japonais » — **pas inconnue**, pas occidentale.

| | crit. 1 | crit. 2 | crit. 3 | verdict |
|---|---|---|---|---|
| **3781 EXS** | ✅ | ✅ (slug → `[3781]`) | ✅ **japonais** | ✅ **LES TROIS SONT REMPLIS** |
| **4170 UNP** | ✅ | ✅ (slug → `[4170]`) | 🔴 **absente** | ❌ **il manque le 3** |
| **5681 CGN** | ✅ | ✅ (slug → `[5681]`) | 🔴 **absente** | ❌ **il manque le 3** |

🔴 **DEUX SUR TROIS ÉCHOUENT SUR LE MÊME CRITÈRE, ET C'EST LE TROISIÈME.** `regionSource:
'nom-hors-catalogue'` veut dire que la dérivation **n'a rien conclu** — « je ne sais pas », pas
« occidental ». La règle exige « japonais », donc **l'admission de 4170 et 5681 demande une
attestation de région venue d'ailleurs**, avec sa provenance écrite. C'est exactement le
précédent de l'Intro Pack, et le fichier dit déjà de cette ligne-là que la provenance est
écrite « pour que ce soit relisible, pas pour faire croire à une vérification ».

### 🔴 ET 3781 EST DÉJÀ DANS `SETS_NON_PROUVES` — refusée pour une raison HORS RÈGLE

Elle remplit les trois critères et elle est pourtant en bas du fichier, avec :
`preuveManquante: 'trois séries chez pokesymbols, un seul slug en base'`. **La règle écrite
l'admettrait ; c'est un quatrième critère, non écrit, qui la bloque — que DÉSIGNE ce slug
unique quand la source en liste trois (bleue, rouge, verte, 1998) ?** Il faut le dire comme
ça : soit ce critère entre dans la règle, soit il n'a pas à décider seul.

⚠️ **UN SECOND SIGNAL, MESURÉ, VA DANS LE MÊME SENS** : le `setTcgdex` de 3781 est **`sv03.5`**,
partagé avec les expansions **5328, 5402, 6099**. `sv03.5` est un set de 2023. C'est
littéralement le pont « FAUX PAR CONSTRUCTION » que la table close existe pour contourner,
et il est branché sur cette expansion. Ce n'est pas un critère d'admission — c'est un avertissement.

⚠️ **ET 4170 N'EST PAS UN SET.** « Unnumbered Promos » est un **seau**, pas une expansion
identifiée : 207 produits sans numéro. Le fichier note déjà que « toutes les lignes promo
japonaises partagent la même étoile PROMO — le symbole ne les séparera jamais entre elles ».
Admise, elle entrerait avec `symbole: null` et **le verrou 4 la rendrait inerte** pour
`departagerParSymbole`. Elle élargit le vivier ; elle n'aide aucun départage.

### 🔑 LE COÛT, MESURÉ AVANT TOUTE DÉCISION — banc rejoué, périmètre élargi en mémoire

⚠️ **AUCUN FICHIER TOUCHÉ.** `EXPANSIONS_VINTAGE` est un `Set` partagé par tous les modules :
un script du bac l'élargit **en mémoire** avant de charger `banc-japonais.js`, qui tourne
ensuite tel quel. Rien ne survit au process. Deux variantes mesurées — **`+3 expansions`**
(le vivier s'ouvre) et **`+3 lignes de table`** (les codes EXS/UNP/CGN cessent aussi d'être
« un set réel hors table » pour `setCodeCompatibleVintage`).

| colonne APRÈS, les 4 seaux cumulés | **JUSTE** | **FAUX** | 🔑 **FAUX ET AFFIRMÉ** | REFUS |
|---|---|---|---|---|
| référence — 24 sets | 63 | 8 | **0** | 17 |
| **+3 expansions** | **64** | **8** | **0** | **16** |
| +3 lignes de table | 64 | 8 | **0** | 16 |
| *(rappel — « sans périmètre », ÉCARTÉ)* | *56* | *25* | *0* | *—* |

🔑 **ZÉRO FAUX ET AFFIRMÉ. ZÉRO RÉGRESSION. Le bloc de contrôle ne bouge pas** (80 justes,
2 faux, 3 refus, identique aux trois régimes). **Une seule ligne change d'issue sur tout le
banc** — et elle est dans le **HOLDOUT**, le seul seau qui décide :

    H007  « Cool Porygon » n°137   REFUS ⛔  ->  605998 ✅ JUSTE   voie=perimetre-vintage
    (référence : voie=numero-pokedex-neutralise, aucun candidat retenu)

**Holdout : JUSTE 6 → 7, REFUS 2 → 1, FAUX inchangé à 3.** Les deux variantes donnent le même
résultat : **ajouter les trois CODES à la table ne change rien de plus** que d'ajouter les
trois expansions au périmètre. Le levier est le périmètre, pas la garde du `setCode`.

**Ce n'est pas le même effet réduit que « sans périmètre » — c'est un gain net, petit.**

### ⚠️ MAIS LE VRAI EFFET N'EST PAS DANS LE VERDICT, IL EST DANS LA CANDIDATURE

Rejoué avec le **vivier exact de la route** (mêmes fonctions exportées que la correction
ci-dessus), périmètre élargi :

| vivier de la route | référence | **+3 expansions** |
|---|---|---|
| vérité présente, tout le banc | 75 / 89 — 84,3 % | **88 / 89 — 98,9 %** |
| cellule | 41 / 55 | **54 / 55** |
| hors cellule | 34 / 34 | 34 / 34 |
| **absences** | **14** | **1** |
| **fermes dont la vérité est absente du vivier** | **1** | **0** |

🔑 **LES 13 ABSENCES DEVIENNENT CANDIDATES. UNE SEULE DEVIENT UN VERDICT.** Le périmètre est
une condition **nécessaire et pas suffisante** : la vérité entre au vivier, puis le départage
ne va pas la chercher — la plupart de ces lignes finissent en `REFUS-egalite-perimetre`, et
un vivier plus large rend l'égalité **plus** probable, pas moins.
**Il ne reste qu'une absence : H003, un problème de NOM** (« The Rocket's Trap » →
*Imposter Oak's Revenge*, exp 4465 — déjà dans la table).

### Ce que ça coûte au CLASSEMENT — l'instrument « vivier par le nom », contre lui-même

| dénominateur 89 · vivier par le nom | référence | **+3 expansions** |
|---|---|---|
| absente du vivier | 29 | **14** |
| rang 1 | 54 | 55 |
| rang 2-3 | 6 | 13 |
| 🔴 **rang 4-10** | **0** | **7** |
| top 3 parmi les présentes | 60/60 — **100 %** | 68/75 — **90,7 %** |
| **top 3 sur les 89 lignes** | 67,4 % | **76,4 %** |
| FERMES où la vérité n'est pas au rang 1 | **0 / 11** | **4 / 15** *(dont 3 lignes de la même carte, L051)* |

⚠️ **LE CLASSEMENT SE DÉGRADE, ET IL FAUT L'ÉCRIRE : 100 % → 90,7 % de top 3 parmi les
présentes.** Sept lignes tombent au-delà du rang 3 — elles n'existaient pas avant parce que
leur vérité n'était pas candidate. **Le solde reste largement positif** (top 3 sur les 89 :
67,4 % → 76,4 %), mais « la vérité est toujours dans le top 3 » **cesse d'être vrai** dès que
le périmètre s'élargit. Ce n'était pas une propriété du classement, c'était une propriété
d'un vivier étroit.

🔑 **ET LE TERME PRIX SE RÉVEILLE.** Il ne coûtait **rien** au top 3 avec 24 sets (0 ligne
au-delà du rang 3). Élargi, il en coûte **2** : `L029 Rattata` rang 4 → **1** et
`L037 Paras` rang 4 → **1** quand on le neutralise par la voie de production
(`rarete: 'promo'`, [scoring.js:1861](scoring.js)) — **0 ligne n'en sort**. Top 3 : 68 → 70.
**Le défaut du terme prix redevient un levier dès que le vivier s'ouvre. Les deux chantiers
sont liés.**

### Ce que l'admission exigerait — la liste, sans rien y ajouter

1. **4170 et 5681 : une attestation de RÉGION**, source nommée, comme l'Intro Pack. Sans elle
   la règle les refuse, et la refuser est le comportement correct.
2. **3781 : trancher le quatrième critère non écrit** — ce que désigne un slug unique quand la
   source liste trois séries. Soit on l'écrit dans la règle, soit on ne s'en sert pas.
3. **Un symbole relevé, ou `symbole: null` assumé.** Les trois entreraient inertes pour
   `departagerParSymbole` (verrou 4). Aucun risque ajouté de ce côté, aucun gain non plus.
4. **Rejouer `test-table-vintage.js` et le verrou** : la table passerait de 24 à 27 lignes et
   plusieurs assertions comptent les lignes.
5. ⚠️ **4170 reste discutable même avec une région** : un seau de 207 promos sans numéro n'est
   pas « un set japonais vintage identifié », qui est ce que cette table prétend contenir.
   L'admettre changerait la NATURE de la table, pas seulement sa taille.

**RIEN N'EST CÂBLÉ. La table est intacte. Le chiffre qui décide est écrit : +1 juste, −1 refus,
0 faux et affirmé, 0 régression, et +13 vérités rendues candidates.**

## 🔴 DÉCISION 2026-09-06 — LES TROIS EXPANSIONS RESTENT DEHORS

**La table n'est pas touchée.** 4170 et 5681 échouent sur le critère 3 — `codes_set.region`
est **absente**, `regionSource: 'nom-hors-catalogue'`, c'est-à-dire **« je ne sais pas »**, pas
« occidental ». 3781 remplit les trois critères écrits et reste bloquée par un critère **NON
ÉCRIT**. Le gain mesuré est réel et il est consigné ici pour ne pas être reperdu ; il ne suffit
pas à faire entrer une ligne sans preuve.

### Le gain, mesuré (périmètre élargi EN MÉMOIRE, aucun fichier modifié)

| | référence — 24 sets | **+3 expansions** |
|---|---|---|
| banc, colonne APRÈS | 63 justes · 8 faux · **0 F&A** · 17 refus | **64** · 8 · **0** · **16** |
| ligne qui bouge | — | **H007 « Cool Porygon » REFUS → JUSTE, dans le HOLDOUT** |
| vivier de la route — vérité présente | 75 / 89 — **84,3 %** | **88 / 89 — 98,9 %** |
| absences | **14** | **1** (H003, un problème de NOM) |
| fermes sans vérité au vivier | 1 | **0** |
| 🔴 **top 3 parmi les PRÉSENTES** | **60/60 — 100 %** | **68/75 — 90,7 %** |

### 🔑 L'ÉCHANGE, NOMMÉ EN TOUTES LETTRES

**ON TROQUE UN PROBLÈME DE VIVIER CONTRE UN PROBLÈME DE CLASSEMENT.** Le vivier cesse d'être le
plafond (98,9 % de vérités candidates) et le classement cesse d'être parfait (90,7 % de top 3).
⚠️ **Et la règle d'affichage repose ENTIÈREMENT sur le top 3** : FERME → une carte, SOUS RÉSERVE
→ les 3 meilleurs. Déplacer le défaut du vivier vers le classement, c'est le déplacer **de là
où il est invisible vers là où il décide de ce qui s'affiche.**

🔴 **ET « la vérité est toujours dans le top 3 » N'ÉTAIT PAS UNE PROPRIÉTÉ DU CLASSEMENT.**
C'était une propriété d'un vivier étroit : quand le vivier ne contient presque que des candidats
plausibles, le premier est souvent le bon. Le 100 % tombe dès qu'on l'ouvre. **Un taux mesuré
sous une contrainte disparaît avec la contrainte** — c'est la même forme d'erreur que le zéro
tautologique de « sans périmètre ».

### 🔑 MAIS L'ÉCHANGE N'EST PAS FORCÉ — mesuré avec 3781 SEULE

3781 est la seule des trois qui remplit les trois critères écrits. Rejoué avec **elle seule** :

| | référence | **+3781 seule** | +3 expansions |
|---|---|---|---|
| banc, colonne APRÈS | 63 · 8 · 0 · 17 | **63 · 8 · 0 · 17 — IDENTIQUE** | 64 · 8 · 0 · 16 |
| vivier de la route | 75 / 89 — 84,3 % | **81 / 89 — 91,0 %** | 88 / 89 |
| absences | 14 | **8** | 1 |
| top 3 parmi les présentes | 100 % | **97,1 %** | 90,7 % |
| 🔑 **SOUS RÉSERVE — top 3 des présentes** | **100 %** | **100 % (43/43)** | 97,8 % |
| lignes au-delà du rang 3 | 0 | **2** | 7 |

⚠️ Le banc est **strictement identique** : 60 lignes de sortie diffèrent, toutes des comptes de
candidats et des logs, **zéro verdict changé**. 3781 seule n'achète aucun juste — elle achète
**6 candidatures** et ne coûte rien au verdict.

🔑 **TOUTE LA DÉGRADATION DU CLASSEMENT VIENT DE 4170** — celle qui échoue au critère 3 de toute
façon. **L'échange vivier ↔ classement est causé par la ligne qu'on refuse déjà.**

## 🔑 LE CRITÈRE NON ÉCRIT — la formulation exacte, et ce qu'elle coûterait rétroactivement

3781 remplit les trois critères et reste dans `SETS_NON_PROUVES` avec
`preuveManquante: 'trois séries chez pokesymbols, un seul slug en base'`. **Ce motif n'est nulle
part dans la règle.** Les trois critères écrits vérifient tous le côté BASE — le slug existe, le
slug ne désigne qu'une expansion, la région est japonaise. **Aucun ne vérifie que le slug désigne
UN SEUL SET RÉEL DANS LE MONDE.** C'est le trou par lequel 3781 passe.

### La formulation qu'il faudrait — un 4e critère, pas un veto au cas par cas

> **4. Le `slugSet` doit désigner UN SEUL set attesté chez la source qui le date.** Si la source
> en liste plusieurs pour ce slug — séries, tirages, rééditions — la ligne part dans
> `SETS_NON_PROUVES` en NOMMANT le nombre de sets listés et la source. ⚠️ L'ABSENCE de source
> n'est pas un échec de ce critère : c'est un échec du critère 3. Les deux ne se confondent pas.

### Combien des 24 l'auraient échoué

🔴 **NON MESURABLE DIRECTEMENT, ET IL FAUT LE DIRE** : pokesymbols n'est pas en base. Je ne peux
pas rejouer « la source liste-t-elle plusieurs sets ? » sur les 24. **Ce que je peux mesurer,
ce sont les symptômes que ce défaut laisse DANS LA BASE**, et les trois sont propres :

| sur les 24 admises | |
|---|---|
| expansions portant **plusieurs `slugSet`** | **0 / 24** |
| expansions portant **plusieurs `setTcgdex`** | **0 / 24** |
| lignes dont `prod` ne colle plus au catalogue | **0 / 24** *(24/24 exactes, au produit près)* |

**Sur tout ce qui est mesurable, le 4e critère ne serait PAS une exception rétroactive : les 24
le passeraient.** ⚠️ Ce n'est pas une preuve qu'aucune ne l'échouerait chez la source — c'est
une preuve qu'aucune ne porte le symptôme. Et les `prod` exactes 24 fois sur 24 disent que ces
lignes ont bien été vérifiées une par une.

### 🔑 ET LE CRITÈRE 3, LUI, EST TENU — 24 / 24, sans exception

Vérifié dans `codes_set` : **les 24 admises portent `region: 'japonais'`.** Aucune exception
rétroactive. Refuser 4170 et 5681 pour « région absente » est donc **cohérent avec tout ce qui
est déjà entré**, pas un durcissement improvisé.

🔑 **ET LE CHEMIN DE SORTIE EXISTE DÉJÀ, IL A DÉJÀ SERVI.** Le commentaire de `IPB` dit encore
« codes_set dit INCONNUE (regionSource 'nom-hors-catalogue') ». **C'est périmé** : `codes_set`
porte aujourd'hui `region: 'japonais'`,
`regionSource: 'sources-multiples-concordantes-rapportees-par-testeur'`. **Quelqu'un a attesté,
la provenance a été écrite, la base l'a enregistrée.** C'est exactement ce qui manque à 4170 et
5681 — et ça s'est déjà fait proprement une fois.
⚠️ **PETITE DETTE** : le commentaire de `sets-vintage-japonais.js` sur IPB décrit un état de la
base qui n'existe plus. À corriger quand on rouvrira le fichier, pas ce tour.

### La seule exception rétroactive trouvée, et ce n'est pas un critère

**`DP5c` « Cry from the Mysterious » est de 2007**, alors que l'en-tête de la table annonce
« LA TABLE CLOSE DES SETS JAPONAIS VINTAGE (1996-2003) ». Elle remplit les trois critères ; c'est
le **titre** qui promet une période que la table ne tient pas. Aucune décision là-dessus — c'est
noté pour que personne ne s'appuie sur « 1996-2003 » comme sur une garantie.

## 🔴 LE PONT `setTcgdex` — ce qui est mesurable, et ce qui ne l'est pas

**La question posée** : combien d'expansions portent un `setTcgdex` dont la période est
incompatible avec la leur ? **RÉPONSE : LITTÉRALEMENT NON MESURABLE.** Mesuré sur les **73 188**
produits du catalogue — `dateSortie` **0**, `releaseDate` **0**, `annee` **0**, `year` **0**,
et `langue` / `idLanguage` / `language` **0**. **La période n'existe nulle part en base.**
Le catalogue ne porte que `idProduct`, `idExpansion`, `idMetacard`, `name`.

### Alors on mesure le PARTAGE, qui majore le soupçon

| dénominateurs d'abord | |
|---|---|
| expansions distinctes au catalogue | **773** |
| expansions portant au moins un `setTcgdex` | **218** *(28,2 %)* |
| identifiants `setTcgdex` distincts | **139** |
| partagés par **plus d'UNE** expansion | **69 / 139 — 49,6 %** |
| 🔴 partagés par **plus de DEUX** expansions | **6 / 139 — 4,3 %** ← le majorant |
| expansions touchées par ces 6 | **22 / 218** |

Les six : `sv10.5w` (5 exp) · **`sv03.5` (4 : 3781, 5328, 5402, 6099)** · `sv10.5b` (4) ·
`ecard3` (3 : 1538, **5024**, **5025**) · `sv08.5` (3) · `xy11` (3).

🔑 **ET LE PLUS IMPORTANT : 16 DES 24 ADMISES PORTENT DÉJÀ UN `setTcgdex` PARTAGÉ.** `base2`,
`base3`, `base5`, `gym1`, `gym2`, `si1`, `neo1..neo4`, `ecard1`, `ecard2`, `ex2`, `ex3` sont
tous à 2 expansions ; **EC4 et EC5 partagent `ecard3` à trois**. Le pont faux n'est pas une
anomalie de 3781 : **c'est le régime normal du vintage japonais, et c'est précisément pourquoi
cette table existe.** `sv03.5` sur 3781 est le même défaut, un degré plus grave (4 expansions,
et l'identifiant désigne un set de 2023).

⚠️ **CE QUE ÇA NE PROUVE PAS** : qu'un partage soit une erreur. `ecard3 → EC4 + EC5 + SK` est
un partage **attendu et documenté** (le jumeau occidental). Le majorant est **6 identifiants /
22 expansions**, pas 6 fautes.

## 🔑 LES 7 LIGNES HORS TOP 3 — deux familles, et une seule est un problème de classement

Ce sont **5 cartes distinctes** (Mew ×2, Jynx ×2, Farfetch'd, Rattata, Paras — deux d'entre elles
portent deux lignes de journal). Écarts au 3e, triés : **25 · 25 · 45 · 45 · 45 · 45 · 45**.

| famille | n | écart | vérité | ce que c'est |
|---|---|---|---|---|
| **écart 25 — exp 3781** | **2** | **25** *(= `POIDS.prix`)* | score **45** vs 3e **70** | 🔑 **le terme PRIX, seul** |
| **écart 45 — exp 4170** | **5** | 45 | score **0** | 🔴 **la vérité ne marque RIEN** |

🔑 **LES DEUX À ÉCART 25 SONT ENTIÈREMENT RATTRAPABLES, ET LE DÉFAUT EST DÉJÀ DIAGNOSTIQUÉ.**
`L029 Rattata` et `L037 Paras` : écart **exactement 25**, la valeur de `POIDS.prix`. Neutralisé
par la voie de production (`rarete: 'promo'`, [scoring.js:1861](scoring.js)), **les deux passent
au RANG 1**, et **aucune ligne n'en sort**. Top 3 : 67 → 69.

🔴 **LES CINQ À ÉCART 45 NE SONT PAS UN PROBLÈME DE CLASSEMENT.** Leur vérité score **ZÉRO** —
pas « un peu derrière » : rien. Elles viennent toutes de **4170**, le seau « Unnumbered Promos »,
dont les produits ne portent **ni numéro ni code de set** : aucun terme du scoring ne peut
s'accrocher. **Aucun réglage de classement ne les rattrape** ; il faudrait leur donner de la
matière à noter. Et 4170 est refusée au critère 3 de toute façon.

### Ce que ça change pour la question « l'élargissement est-il jouable »

**OUI, et il l'est déjà — avec 3781 seule, une fois le terme prix corrigé.** Les 2 lignes
au-delà du rang 3 sont exactement la paire à écart 25 : **top 3 des présentes 97,1 % → 100 %**,
et **SOUS RÉSERVE reste à 100 % (43/43)** dans les deux cas. Ce qui reste à payer d'avance :
**le critère 4, écrit**, et **le terme prix, corrigé**. Ni l'un ni l'autre n'est fait.

**RIEN N'EST CÂBLÉ. LA TABLE EST INTACTE.**

## ✅ 2026-09-06 — LE 4e CRITÈRE EST ÉCRIT DANS `sets-vintage-japonais.js`

**Un critère non écrit qui refuse une ligne n'est pas une règle, c'est une décision au cas par
cas — et une décision au cas par cas ne se relit pas.** Il était déjà appliqué (c'est lui qui
tient 3781 dehors), il n'était nulle part. Il l'est maintenant :

> **4. Le `slugSet` doit désigner UN SEUL SET ATTESTÉ chez la source qui le date.** Si la
> source en liste PLUSIEURS pour ce slug — séries, tirages, rééditions — la ligne part dans
> `SETS_NON_PROUVES` en NOMMANT le nombre de sets listés et la source.
> ⚠️ **L'ABSENCE de source n'est pas un échec de ce critère : c'est un échec du 3.** « Je ne
> sais pas d'où elle vient » et « je sais qu'elle en désigne trois » sont deux refus
> différents, et **seul le second peut être levé en choisissant laquelle des trois.**

**Écrits avec** : les trois symptômes vérifiables en base — `slugSet` multiples **0/24**,
`setTcgdex` multiples **0/24**, `prod` divergent **0/24** (les 24 comptes exacts au produit
près : ces lignes ont bien été vérifiées une par une, et le fichier ne le dit plus seulement,
il le prouve). **C'est ce qui permet de dire que le critère 4 n'est PAS une exception
rétroactive** — aucune des 24 n'en porte le symptôme. Et le critère 3 non plus : **24/24**
portent `region: 'japonais'`.

**Les deux dettes sont consignées dans le fichier**, non corrigées : le commentaire d'`IPB` est
**périmé** (codes_set porte aujourd'hui `japonais` /
`sources-multiples-concordantes-rapportees-par-testeur`) — laissé tel quel pour garder la trace
du moment où on ne savait pas, mais il ne doit plus servir d'exemple ; et **`DP5c` est de 2007**
alors que l'en-tête promet « 1996-2003 » — **la période n'est pas un critère d'admission, et
personne ne doit s'appuyer sur ce titre comme sur une garantie.**

⚠️ **AUCUNE DÉCISION DE PRODUCTION NE CHANGE — la règle de symétrie ne s'applique pas.** Rien
n'est ajouté à la table, `EXPANSIONS_VINTAGE` est inchangée. Contrôle : `test-table-vintage.js`
**52/52**, banc inchangé.

## 🔑 CE QUE LE TESTEUR DOIT VÉRIFIER À LA MAIN — 3781, et rien d'autre

**3781 est le seul gain sans contrepartie mesurée** : banc **strictement identique** (63 · 8 ·
**0 faux et affirmé** · 17 — zéro verdict changé), vivier de la route **84,3 % → 91,0 %**,
absences **14 → 8**, **top 3 des lignes SOUS RÉSERVE 100 % (43/43)**. ⚠️ **Et ce n'est PAS une
raison de l'admettre.** Une mesure ne remplace pas une attestation — c'est exactement l'échange
que la règle refuse depuis le premier jour. **L'entrée exige une ATTESTATION.**

### 🔴 Le test que j'espérais est INAPPLICABLE, et il faut le dire avant de demander le travail

Je comptais trancher en base : *si plusieurs produits de 3781 portent le MÊME numéro,
l'expansion fusionne des séries.* **Impossible — sur les 125 lignes `numeros_cartes` de 3781,
`numero` est non nul 0 fois, `numeroUrl` 0 fois.** Il n'y a aucun numéro à comparer. *(Idem
4170 : 0/205, et 5681 : 0/9.)* **La base ne peut ni confirmer ni infirmer la fusion.** Et 125
produits pour trois séries de sheets est compatible avec la fusion **comme** avec une série
unique : un compte n'est pas une preuve.

### Les trois vérifications, dans l'ordre — la première réponse décide

| | où | ce qui décide |
|---|---|---|
| **a)** | **Cardmarket**, la page « Expansion Sheet » japonaise | **UNE expansion, ou TROIS** (bleue / rouge / verte) ? C'est la seule source qui parle le même langage que `idExpansion 3781`. **Si Cardmarket n'en a qu'une et qu'elle contient les trois séries → le slug FUSIONNE → elle reste dehors**, et le critère aura fait son travail. |
| **b)** | **pokesymbols.com/tcg/japanese-sets** | combien de lignes « Expansion Sheet ». **C'est la source du refus d'origine, elle dit TROIS.** À **reconfirmer**, pas à croire sur parole d'un commentaire écrit ici il y a des semaines. |
| **c)** | *(si a et b se contredisent)* | **c'est (a) qui décide POUR NOTRE TABLE.** Nos expansions sont des identifiants **Cardmarket**, pas des sets du monde. |

**Contre-source recherchée** : aucune source ne dit aujourd'hui que `Expansion-Sheet` désigne
un set unique. Le seul élément en sa faveur est **négatif** — Cardmarket n'a qu'un slug — et un
slug unique côté catalogue **ne prouve pas** un set unique côté monde : c'est précisément la
confusion que le critère 4 existe pour empêcher.

## 🔴 4170 — CE N'EST PAS UN DÉFAUT DE PÉRIMÈTRE, C'EST UNE ABSENCE DE SIGNAL

Les 5 lignes hors top 3 dont la vérité est en 4170 ne scorent pas « un peu moins » : elles
scorent **ZÉRO**, et le détail de production le dit terme par terme. Mesuré sur `L049 Mew` :

    🎯 VÉRITÉ 571770 exp 4170  région (absente)  prix 109.64  SCORE 0
       numero 0 · set 0 · variante 0 · motif 0 · image 0 · prix 0 · RÉGION 0 · secret 0
          584730 exp 4464  région japonais       prix 136.22  SCORE 45
          … tous les autres candidats : 45, et le 45 est la RÉGION, seule.

🔑 **LE TERME QUI SÉPARE EST `POIDS.region` = 45, ET IL VAUT 0 PARCE QUE `codes_set.region` EST
ABSENTE POUR 4170.** [scoring.js:1876](scoring.js) — `else detail.region = '0 (région
indéterminée)'` : le scoring **ne pénalise pas une donnée absente**, il ne la récompense pas non
plus. **La même donnée manquante produit les deux refus** : le critère 3 refuse l'admission, le
scoring refuse les points. **Deux dispositifs indépendants, une seule cause — l'absence
d'attestation de région.** Ce n'est pas un défaut de périmètre : le périmètre l'a laissée entrer
au vivier, et elle n'avait **rien à faire valoir une fois dedans**.

⚠️ **AUCUN RÉGLAGE DE CLASSEMENT NE LES RATTRAPE.** Il n'y a pas de pondération à ajuster quand
tous les termes valent zéro ; il faudrait leur **donner de la matière à noter**. Sur cette ligne,
même les candidats en tête ne marquent que sur **un seul terme** — numéro, set, variante, motif,
image, prix, secret sont tous à 0 pour **tout le monde**. **Une ligne décidée par un terme unique
n'est pas classée, elle est tirée au sort entre égaux.**

## 🔴 TROISIÈME OCCURRENCE — LE TERME PRIX DÉCLASSE LA BONNE CARTE

Les 2 lignes à écart 25 (`L029 Rattata`, `L037 Paras`, vérités en 3781). Détail de production :

    🎯 VÉRITÉ 548611 exp 3781  prix 23.08 €  ->  prix "0 (incohérent avec rareté lue)"  SCORE 45
             557711 exp 4169  prix  0.69 €  ->  prix "+25 (carte normale, prix bas)"    SCORE 70

🔑 **LA VÉRITÉ EST DÉCLASSÉE PARCE QU'ELLE EST CHÈRE.** Le Rattata des vending sheets cote
**23,08 €**, celui de l'Expansion Pack **0,69 €**. Le terme applique « carte normale ⇒ prix bas »
et **récompense de 25 points le candidat bon marché**, exactement quand la carte rare est la
bonne réponse. L'écart au 3e vaut **25**, la valeur de `POIDS.prix` — **au point près**.
Neutralisé par la voie de production (`rarete: 'promo'`, [scoring.js:1861](scoring.js)) : les
deux passent au **RANG 1**, **0 ligne n'en sort**.

**C'est la TROISIÈME fois que ce terme est pris en flagrant délit** — après le Magikarp promo
chinois (114,80 € contre 0,29 €, qui a fait écrire la neutralisation promo) et le déclassement
mesuré au rang 1 sur le banc. ⛔ **NON CORRIGÉ CE TOUR, et c'est délibéré** : il n'est pas dans
le périmètre de ce chantier, et le corriger sous le coup d'une troisième occurrence, c'est le
corriger sur les lignes qui l'ont suggéré. **Il est consigné, daté, et il attend son propre tour
de mesure.**

🔑 **CE QUE ÇA LIE** : le terme prix ne coûtait **rien** au top 3 tant que le périmètre était
étroit (0 ligne au-delà du rang 3). Il en coûte **2 sur 2** dès que 3781 entre. **Les deux
chantiers ne sont pas indépendants : élargir le périmètre réveille le défaut du prix.**

## 🔑 2026-09-06 — LES DEUX SOURCES SE CONTREDISENT SUR 3781, ET CE QUE J'EN RETIENS

**Constat rapporté par le testeur** : Cardmarket expose **UNE** expansion « Expansion Sheet »
(fil d'Ariane unique, `Charmander (EXS)`, tous les produits sous EXS) ; pokesymbols en liste
**TROIS** (Expansion Sheet 1 blue, 2 red, 3 green). **3781 fusionne donc trois séries réelles —
et Cardmarket ne les distingue pas non plus.** Il n'y a rien à résoudre de son côté.

### La question posée : contre QUOI le critère 4 protège-t-il ?

**LECTURE A — « le slug désigne plusieurs sets DU MONDE ».** La table est une table de SETS.
Chaque ligne déclare `nom`, `annee`, `symbole` : ce sont des affirmations sur **un** set. Une
ligne fusionnée ferait dire au fichier « Expansion Sheet, 1998, symbole X » d'une chose qui en
est trois. La discipline fondatrice — vingt lignes vérifiées valent mieux que 177 devinées —
tombe si une ligne peut recouvrir un ensemble non résolu.

**LECTURE B — « le catalogue ne sait pas résoudre le slug ».** La table sert à mapper **NOS**
expansions vers région + époque + symbole. Cardmarket n'expose qu'un ensemble, tous nos produits
y sont, **aucun scan ne peut jamais tomber « entre » les trois séries** : la distinction n'existe
pas dans nos données. Un critère qui refuse une ligne pour une ambiguïté **qui ne peut pas se
manifester** ne protège rien.

### 🔴 CE QUE JE RETIENS : LA LECTURE A — ET LA RAISON EST DÉCISIVE

**LA LECTURE B RÉCOMPENSERAIT L'IGNORANCE.** « Cardmarket ne les sépare pas » est une **absence
de donnée dans notre source**, pas une preuve qu'il n'y a rien à séparer. Sous la lecture B, un
slug devient admissible **parce qu'on en sait moins** : plus notre catalogue est grossier, plus
la ligne passe. C'est exactement le renversement que ce projet passe son temps à fermer —
« je ne sais pas » n'est pas « je sais que non ». **Le critère 4 reste écrit comme il l'est.**

### ⚠️ MAIS LE CRITÈRE, BIEN LU, NE DEVRAIT PAS REFUSER LA LIGNE ENTIÈRE — mesuré

**Quels champs de `SETS_VINTAGE_JAPONAIS` le CODE lit-il réellement ?** Relevé sur tout le
dépôt :

| champ | lu par | portée |
|---|---|---|
| `exp` | `EXPANSIONS_VINTAGE` (le périmètre) | **par EXPANSION** |
| `code` | `CODES_VINTAGE`, `setCodeCompatibleVintage`, `departagerParSymbole`, verrous | **par EXPANSION** |
| `symbole`, `symboleFiable` | `departagerParSymbole` (verrous 2 et 4) | 🔴 **par SET** |
| `nom` | une chaîne de `raison`, jamais une décision | affichage |
| `annee`, `slug`, `prod`, `regionSource` | **RIEN** | documentation |

🔑 **LA FUSION NE PEUT ENDOMMAGER QU'UNE SEULE COLONNE LUE : `symbole`.** `exp` et `code` sont
des attributs de l'EXPANSION, et ils sont **exacts** sur une ligne fusionnée — les trois séries
sont japonaises, vintage, 1998, sous un seul code Cardmarket. **Et la table a déjà DEUX
mécanismes pour un symbole qui ne désigne pas** : `symbole: null` (verrou 4, « non relevé n'est
pas une correspondance ») et `symboleFiable: false` (verrou 2, « porté par plusieurs sets »).

**CE QUE JE PROPOSE, ET JE NE LE FAIS PAS** : une **clause bornée**, écrite comme clause
générale et non comme dérogation au cas par cas —

> *Un `slugSet` dont la source atteste qu'il recouvre PLUSIEURS sets peut entrer **à condition
> que la ligne ne déclare AUCUN attribut par-set** : `symbole: null`, `symboleFiable: null`,
> `annee` en intervalle ou nulle, et la fusion NOMMÉE sur la ligne (« recouvre N séries selon
> <source> »). La ligne sert alors le périmètre et la garde du `setCode`, et **jamais** le
> départage par le symbole.*

⚠️ **TROIS GARDE-FOUS SANS LESQUELS CETTE CLAUSE EST UNE RENÉGOCIATION** :
1. **Elle s'écrit AVANT la réponse de pokesymbols sur les symboles**, sinon c'est le résultat
   qui choisit la règle. Elle est d'ailleurs **robuste à cette réponse** : les champs par-set
   sont nuls dans tous les cas.
2. **Son coût se mesure sur les 24 AVANT de s'appliquer** : aucune ligne existante ne doit
   devenir éligible ou inéligible par son effet.
3. ⛔ **Elle ne rend pas 4170 admissible pour autant** — 4170 échoue au critère **3**, pas au 4,
   et aucune clause sur la fusion ne fabrique une attestation de région.

**Tant qu'elle n'est pas écrite et mesurée, 3781 reste dehors. La table n'est pas touchée.**

## LE TEST DES SYMBOLES — ce qu'il tranche vraiment, et ce qu'il ne tranche pas

⚠️ **CORRECTION DE CADRAGE : ce test NE DÉCIDE PAS L'ADMISSION.** Sous la clause bornée, EXS
entrerait avec `symbole: null` **quelle que soit** la réponse. Ce que le test décide, c'est si
la colonne `symbole` pourra **un jour** être remplie pour EXS — et si un symbole lu sur une
carte de vending sheet pourrait **mal désigner**. Ça vaut un coup d'œil, pas un blocage.

### Ce qu'il faut regarder sur pokesymbols.com/tcg/japanese-sets

Les **trois lignes « Expansion Sheet »** portent chacune une vignette de symbole. **Comparer les
trois dessins**, et rapporter lequel des trois cas :

| ce qu'on voit | ce que ça veut dire | déclaration |
|---|---|---|
| **trois dessins DIFFÉRENTS** | la fusion est visible : une ligne EXS unique ne peut porter qu'un des trois | `symbole: null` — verrou 4, inerte. **La colonne restera vide.** |
| **un seul dessin partagé** | la fusion est sans conséquence pour nous | déclarable — ⚠️ **puis vérifier la collision** avec les 24 déjà déclarés (`logo-tcg`, `feuilles`, `fossile`, `R`, `gym`, `palmier`, `etoile`, `ruines`, `couronne`, `eclair`, `vs`, `e1`–`e5`, `empreintes`, `croix`, `mcdo`, `cercle-chiffre`). Collision -> `symboleFiable: false`. |
| **aucun symbole** sur les sheets | c'est `symbole: 'aucun'`, **une VALEUR**, pas `null` | 🔴 **inutilisable aujourd'hui** : `MOTS_VIDES` ([index.js:780](index.js), appliqué [index.js:786](index.js)) détruit le `'aucun'` lu — DÉFAUT CONFIRMÉ déjà au chantier. |

## 🔴 QUATRIÈME SIGNE — NOS REFUS SE CONCENTRENT SUR LA VALEUR. MESURÉ.

Le testeur a nommé le cas : **`Charmander` EXS — plancher 49,93 € · tendance 222,01 €**. Ce
n'est pas une impression, et voici le chiffre. *(Dénominateur : `guide_prix.trend` non nul sur
**68 936 / 73 188** produits — 94,2 %. Une expansion sans guide n'est pas « sans valeur », elle
est sans donnée.)*

| `trend` en € | n | p25 | **MÉDIANE** | p75 | p90 |
|---|---|---|---|---|---|
| **3 expansions ÉCARTÉES** | 315 / 357 | 14,10 | **36,32** | 122,32 | 354,72 |
| 24 ADMISES (table close) | 1 835 | 1,80 | **6,39** | 26,19 | 99,03 |
| catalogue entier | 68 936 | 0,12 | **0,92** | 5,99 | 37,09 |

**Les écartées valent 5,7× la médiane de la table close et 39× celle du catalogue.** Et les
**10 vérités** que le périmètre écarte : **médiane 67,34 €**, max **222,01 €** (le Charmander),
contre **0,92 €** au catalogue. *(Mew 109,64 · Jynx 82,12 · Growlithe 83,51 · Farfetch'd 67,34 ·
Caterpie 23,51 · Rattata 23,08 · Cool Porygon 22,76 · Paras 7,38 · Brock's Rhyhorn 1,24.)*

⚠️ **CE QUE ÇA N'EST PAS : une causalité.** Le périmètre ne regarde jamais le prix. Ce qui est
mesuré, c'est que **rareté et absence de documentation ont la même cause** — les sheets de
distributeur et les promos non numérotées sont chères **parce qu'**elles sont rares et mal
répertoriées, et mal répertoriées **parce que** rares. Nos refus ne visent pas la valeur : ils
tombent là où elle est.
⚠️ **Et ce n'est pas uniforme** : **5681 est BON MARCHÉ** (médiane **1,14 €**). La concentration
est dans 3781 (28,73 €) et 4170 (67,34 €). Deux sur trois, pas trois sur trois.

🔑 **LE LIEN QUI COMPTE, ET IL EST NOUVEAU** : le terme `POIDS.prix` récompense de 25 points le
candidat **bon marché**. Il frappe donc **exactement cette population** — les vérités écartées
sont les plus chères de la base. **Les deux défauts se composent sur les mêmes cartes** : le
périmètre les retire du vivier, et si on les y remet, le terme prix les déclasse. `Rattata` en
est la démonstration : 23,08 € contre 0,69 €, écart de rang causé par 25 points **au point près**.

## ✅ 2026-09-06 — LA CLAUSE BORNÉE EST ÉCRITE (critère 4 bis), APRÈS MESURE

**Le coût a été mesuré AVANT l'écriture, et les quatre chiffres attendus tiennent au point près.**
Rejeu du banc avec **3781 admise SOUS LA CLAUSE** — ligne de table complète, code `EXS` versé
dans `CODES_VINTAGE` et dans `setCodeCompatibleVintage`, **attributs par-set tous nuls** :

| | référence | **3781 sous clause** |
|---|---|---|
| banc, colonne APRÈS | 63 · 8 · **0 F&A** · 17 | **63 · 8 · 0 F&A · 17 — IDENTIQUE** |
| bloc de contrôle | 80 justes · 2 faux · 3 refus | **identique** |
| vivier de la route | 75 / 89 — 84,3 % | **81 / 89 — 91,0 %** |
| absences | 14 | **8** |
| top 3 des PRÉSENTES | 60/60 — 100 % | **67/69 — 97,1 %** |
| 🔑 **top 3 SOUS RÉSERVE** | 100 % (41/41) | **100 % (43/43)** |

⚠️ **Contrôle d'identité du banc : 60 lignes de sortie diffèrent, ZÉRO hors bruit** (comptes de
candidats, logs de vivier). **Aucun verdict n'a changé.** Verser le CODE `EXS` dans la garde
`setCodeCompatibleVintage` — ce que l'ajout au seul périmètre ne faisait pas — **ne change rien
non plus**. `test-table-vintage.js` : **52/52**.

**La clause est écrite dans `sets-vintage-japonais.js` avec ses trois garde-fous nommés** :
(a) **écrite AVANT la réponse de pokesymbols**, et robuste à elle — les attributs par-set sont
nuls dans les trois cas de figure ; (b) **coût mesuré sur les 24** : la clause est **strictement
additive**, aucune des 24 ne déclare de fusion, aucune ne peut devenir inéligible ; (c) **sans
effet sur 4170**, qui échoue au critère **3** — aucune clause sur la fusion ne fabrique une
attestation de région.

⚠️ **ET 3781 N'EST TOUJOURS PAS DANS LA TABLE.** La clause dit à quelle condition une ligne
fusionnée peut entrer ; **elle ne l'y met pas**. `EXPANSIONS_VINTAGE` reste à 24. Rien n'est
poussé.

## 🔑 LA COMPOSITION DE DEUX DÉFAUTS — le fait le plus utile du 2026-09-06

**Deux défauts indépendants frappent la MÊME population : les cartes qui ont de la valeur.**

| | |
|---|---|
| **défaut 1 — le PÉRIMÈTRE** écarte du vivier les sets non attestés | médiane `trend` des 3 expansions écartées **36,32 €** contre **6,39 €** pour les 24 admises et **0,92 €** au catalogue entier |
| **défaut 2 — `POIDS.prix`** récompense de +25 le candidat BON MARCHÉ | `Rattata` : vérité **23,08 €** -> `0 (incohérent)`, concurrent **0,69 €** -> `+25`. Écart de rang = 25, **au point près** |
| **la population commune** | les **10 vérités** écartées par le périmètre : médiane **67,34 €**, max **222,01 €** (`Charmander` EXS, plancher 49,93 €) |

*(Dénominateur : `guide_prix.trend` non nul sur **68 936 / 73 188** produits — 94,2 %. Une
expansion sans guide n'est pas « sans valeur », elle est **sans donnée**.)*

### 🔴 C'EST UNE COMPOSITION, PAS UNE CAUSALITÉ — et la distinction n'est pas un détail

**Le périmètre ne regarde jamais le prix, et le terme prix ne regarde jamais le périmètre.**
Aucun des deux ne cause l'autre. Ce qui est mesuré, c'est qu'ils **atterrissent au même endroit**,
pour une raison qui leur est extérieure : **rareté et absence de documentation ont la même
origine.** Les sheets de distributeur et les promos non numérotées sont chères **parce qu'elles**
sont rares, et mal répertoriées **parce que** rares. Deux instruments aveugles l'un à l'autre
tombent sur la même population parce que le monde l'a construite ainsi.

⚠️ **ET LE CONTRE-EXEMPLE EXISTE, IL EST DANS NOS PROPRES CHIFFRES : `5681` (Nivi City Gym) est
BON MARCHÉ — médiane 1,14 €.** Écartée comme les deux autres, sans valeur particulière. La
concentration est dans **3781** (28,73 €) et **4170** (67,34 €) : **deux sur trois, pas trois sur
trois.** Écrire « nos refus visent la valeur » serait faux ; **« nos refus tombent là où elle
est, deux fois sur trois »** est ce que la mesure autorise.

### 🔑 CE QUE ÇA COÛTE VRAIMENT, ET POURQUOI ÇA REMONTE EN TÊTE DU CHANTIER

**Le produit existe pour repérer les cartes qui valent quelque chose.** Une erreur sur un
Caterpie à 0,20 € et une erreur sur un Charmander à 222 € ne coûtent pas la même chose à
l'utilisateur, et **le banc les compte pareil** — une ligne juste, une ligne fausse. **Nos deux
défauts se composent précisément là où l'erreur coûte le plus cher, et aucun de nos instruments
ne le voit**, parce qu'aucun ne pondère par la valeur.

⛔ **RIEN N'EST DÉCIDÉ ICI, ET SURTOUT PAS UNE PONDÉRATION PAR LE PRIX.** Noter que l'erreur
coûte plus cher sur les cartes chères **n'autorise pas** à faire entrer le prix dans le
classement — c'est le défaut n°2 qu'on essaierait de soigner avec lui-même. Ce qui est consigné
est un **fait de mesure** : les deux défauts partagent une population, et cette population est
celle qui compte. La conséquence, s'il y en a une, est un **critère d'évaluation** (mesurer le
banc pondéré par la valeur), pas un terme de scoring.

## ✅ 2026-09-06 — 3781 EST ADMISE, SOUS LE CRITÈRE 4 bis. LA TABLE PASSE À 25.

### La collision, vérifiée AVANT tout le reste

**Vignettes relevées à la main par le testeur** : les trois séries « Expansion Sheet » portent
**LE MÊME symbole, une pokéball**. La fusion n'abîmerait donc pas la colonne — un symbole lu
désignerait l'expansion entière, pas une série.

| | |
|---|---|
| lignes admises portant un `symbole` non nul | **22 / 24** *(ADVex1 et DP5c sont déjà à null)* |
| symboles distincts déclarés | **20** |
| déjà partagés | `gym` (G1+G2) et `logo-tcg` (EXP+WEB) — les deux `symboleFiable: false` |
| 🔑 **`pokeball` chez les 24 admises** | ✅ **AUCUNE collision — la valeur est libre** |
| `pokeball` chez les non prouvées | ✅ aucune : le champ `symbole` **n'existe pas** dans `SETS_NON_PROUVES` |

⚠️ **ET LE FAIT QUI COMPTE PLUS QUE LA COLLISION, RAPPORTÉ PAR LE TESTEUR : la pokéball est
commune à TOUTE la série Vending.** Elle ne départage donc **jamais** à l'intérieur d'EXS.
Déclarée, elle serait au mieux `symboleFiable: false` — le statut de `gym` et `logo-tcg`.

🔑 **ELLE N'EST PAS DÉCLARÉE POUR AUTANT, ET C'EST LE POINT.** La clause 4 bis interdit tout
attribut par-set sur une ligne fusionnée, et la réponse est **favorable**. On s'y tient quand
même. **Une règle qu'on suspend quand le résultat arrange n'a jamais protégé personne** — c'est
la même discipline que le veto par le symbole refusé sur un 4 contre 1, et que la promotion de
`perimetre-vintage-suggestion` refusée sur un 4/4.

### La ligne, telle qu'elle entre

    { nom: 'Expansion Sheet', annee: null, slug: 'Expansion-Sheet', exp: 3781, code: 'EXS',
      prod: 125, regionSource: 'place-internationale-prise-par-MEW',
      symbole: null, symboleFiable: null,
      fusion: 'recouvre 3 séries — Expansion Sheet 1 (blue) / 2 (red) / 3 (green) —
               Cardmarket n'expose qu'UNE expansion (code EXS, 125 produits), pokesymbols
               en liste TROIS ; les trois portent le MÊME symbole (pokéball, commune à
               toute la série Vending). Admise sous le critère 4 bis, attributs par-set nuls.' }

**Le champ `fusion` n'est lu par aucun code.** Il existe pour qu'on ne redécouvre pas dans six
mois que cette ligne n'est pas atomique. L'entrée de `SETS_NON_PROUVES` est **conservée en
commentaire** : un refus levé sans trace se relit comme s'il n'avait jamais existé.

### LES QUATRE CONTRÔLES — les quatre sont verts, et les chiffres ne bougent pas d'un point

| | |
|---|---|
| **1. `test-table-vintage.js`** | ✅ **54 / 54** *(52 avant : +2 assertions pour EXS — région écrite dans `codes_set`, slug unique)* |
| **2. banc complet** | ✅ **63 justes · 8 faux · 0 FAUX ET AFFIRMÉ · 17 refus** — **identique**. 60 lignes de sortie diffèrent, **ZÉRO hors bruit**. Bloc de contrôle 80 · 2 · 3, identique. |
| **3. `verrou-avant-push.js`** | ✅ **exit 0** — 7 cellules + 7e cellule (panne du catalogue) |
| **4. cliquet de couverture** | ✅ **52 couvertes · 17 jamais exécutées · plancher 47** — il tient, +5 nouvelles fonctions couvertes |

**Et les trois chiffres du rejeu, reconfirmés sur la table réelle** : vivier de la route
**81/89 = 91,0 %** (absences **8**), top 3 des présentes **97,1 %**, 🔑 **top 3 des lignes SOUS
RÉSERVE 100 % (43/43)**. **Aucun ne diverge du rejeu en mémoire.**

⚠️ **UN FAUX ÉCHEC, ET IL VIENT DE MOI, PAS DU CHANGEMENT.** Le premier passage du verrou a
échoué sur `test-journal-echecs.js` (code 1). Cause : j'avais laissé `MONGODB_BASE=test` dans
l'environnement du shell, et les processus fils en héritent — ce test ÉCRIT et n'accepte que
`test_scratch`. **Le refus était correct, c'est la garde qui a fonctionné.** Relancé dans un
environnement propre : vert. 🔑 **À retenir : ne jamais lancer le verrou avec `MONGODB_BASE`
posé dans le shell.** Il lance des suites qui écrivent, et elles doivent choisir leur base
elles-mêmes.

### La règle de symétrie, et pourquoi elle est tenue sans geste

**Aucune décision nouvelle n'est ajoutée.** Le périmètre existe déjà des deux côtés —
[index.js:4072](index.js) et `apres()` de `banc-japonais.js` lisent **le même objet**
`EXPANSIONS_VINTAGE`, importé du même module. Une ligne ajoutée à la table se propage aux deux
**par construction**, et le banc mesure donc exactement ce que la route fera. C'est le cas
favorable : la symétrie n'a pas à être écrite parce qu'il n'y a pas deux copies.

### Ce qui reste vrai, et ne doit pas être relu comme un gain

⚠️ **3781 N'ACHÈTE AUCUN JUSTE.** Elle rend **6 vérités CANDIDATES** (absences 14 → 8) et ne
change **aucun verdict**. Le bénéfice est un **plafond relevé**, pas un résultat : il ne se
réalisera que si le départage sait ensuite trancher — et sur ces lignes il finit aujourd'hui en
`REFUS-egalite-perimetre`. **Le vivier n'était pas le seul obstacle ; il était le premier.**

## Où sont les détails

- `CLAUDE.md` — les règles de travail dans ce dépôt.
- `scoring.js`, en tête — **le catalogue des erreurs d'instrument** (20 entrées). À lire avant
  toute mesure, et à alimenter après chaque erreur.
- `PASSATION.md` — la procédure de changement de cluster Mongo.
