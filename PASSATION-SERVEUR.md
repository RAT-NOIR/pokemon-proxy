# Passation — serveur `pokemon-proxy`

Pour quelqu'un qui n'a rien lu. Les détails ne sont pas ici, ils sont référencés.

## L'état, en trois lignes

- **Ce qui tourne** : la production (Render, base Mongo nommée `test`) sert `/api/identifier`
  depuis le code de `main`. Le verrou est **vert**, cliquet à 52 assertions.
- **En attente de déploiement** : **24 commits sur `chantier-image`**, jamais fusionnés dans
  `main`. Tout ce qui suit — champs du journal, `originePrix`, règle de promotion v2, sites de
  refus corrigés — **n'est pas en production**. Le déploiement se fait par un push sur `main`,
  et c'est le testeur qui pousse.
- **Ce qui est cassé** : rien en production. Ce qui est **bloqué**, c'est l'enrichissement des
  ponts TCGdex — voir « ce qui attend », point 1.

## Décisions tranchées — ne pas les rouvrir

- **Lecture live conservée** — le cache servait une réponse périmée sur une route qui décide
  d'un prix.
- **Dérivation des ponts par la taille du set : refusée** — mesurée, 71,6 % des sets sont en
  collision de taille ; elle aurait donné un faux pont une fois sur cinq, en silence.
- **Départage par l'image maintenu en « faible »** — l'effectif observé ne soutient pas la
  promotion ; la règle v2 est dans le code, à `NIVEAU_RESERVE`.
- **Point unique de `champsDeRefus` : reporté** — huit sites, cinq corrects ; le refactor est
  décrit dans le chantier avec sa raison.
- **Alarme Cardmarket : supprimée** — elle mesurait un seuil qui n'existait plus.

## Ce qui attend, dans l'ordre

1. **L'import des ponts est à ÉCRIRE, pas à relancer.** `prefill-tcgdex.js` saute tout produit
   ayant déjà une ligne (`dejaFiables`, sans filtre sur `source`) : une relance écrirait
   **8 lignes**. Il faut un import qui attache `setTcgdex` aux produits déjà connus.
2. **`vivierDeRepli`** — drapeau à poser, rouge avant vert.
3. **Inventaire des valeurs d'un système externe figées chez nous** (chemins, versions, URLs).
4. **graphify** — cartographie du code, avec les prédictions écrites AVANT la mesure.
5. **Sauvegarde puis migration Atlas M10** — le testeur la lance lui-même.

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

## Où sont les détails

- `CLAUDE.md` — les règles de travail dans ce dépôt.
- `scoring.js`, en tête — **le catalogue des erreurs d'instrument** (19 entrées). À lire avant
  toute mesure, et à alimenter après chaque erreur.
- `PASSATION.md` — la procédure de changement de cluster Mongo.
