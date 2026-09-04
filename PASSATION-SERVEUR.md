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

## Où sont les détails

- `CLAUDE.md` — les règles de travail dans ce dépôt.
- `scoring.js`, en tête — **le catalogue des erreurs d'instrument** (19 entrées). À lire avant
  toute mesure, et à alimenter après chaque erreur.
- `PASSATION.md` — la procédure de changement de cluster Mongo.
