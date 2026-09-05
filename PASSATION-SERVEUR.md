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

## Où sont les détails

- `CLAUDE.md` — les règles de travail dans ce dépôt.
- `scoring.js`, en tête — **le catalogue des erreurs d'instrument** (20 entrées). À lire avant
  toute mesure, et à alimenter après chaque erreur.
- `PASSATION.md` — la procédure de changement de cluster Mongo.
