# Passation — état du chantier au 2026-08-29

Document écrit pour l'agent qui reprend. Il n'y a rien à deviner : ce qui est mesuré est
donné avec son chiffre, ce qui ne l'est pas est nommé comme tel.

---

## 0. À lire avant tout

**`CLAUDE.md` est chargé à chaque session et ne se renégocie pas.** Les règles qui y sont
écrites viennent d'incidents réels, pas de principes. En particulier :

- 🔴 **Jamais `git add -A`.** Les fichiers sont nommés, un par un. (Un `git add -A` a
  emporté `banc-verites.json` dans `d7c5656` pendant une saisie en cours.)
- 🔴 **`banc-verites.json` ne t'appartient pas.** Ni `banc-lots.json`, ni
  `banc-verification.json`. La saisie interactive est **arrêtée**, donc la LECTURE est
  légitime aujourd'hui — l'écriture, jamais.
- 🔴 **La base de production s'appelle `test`.** Le bac est `test_scratch`. Tout script qui
  écrit nomme sa base et refuse ailleurs (`connecterMongo({ecrit:true})`).
- 🔴 **Aucune écriture en base sans accord explicite.** Le testeur fait sa sauvegarde avec
  `backup-collections.js` et la lance lui-même.
- Jamais `Get-Content -Raw` / `Set-Content` PowerShell sur un fichier source (double
  encodage UTF-8 garanti). Jamais `node -e` avec des guillemets : on écrit un `.js`.
- **git n'est pas dans le PATH** :
  `C:\Users\Yung\AppData\Local\GitHubDesktop\app-3.6.3\resources\app\git\cmd\git.exe`.
  On peut commiter, **on ne peut pas pousser** — c'est le testeur qui pousse.
- Pas de scraping Cardmarket, pas de Referer/User-Agent falsifié, pas de proxy d'images
  tiers. **Une licence non commerciale est un refus** (appliqué à TCG Collector).
- « On ne dit plus *c'est vert*. On dit ce qui a tourné et ce qui n'a pas tourné. »

**Style de travail attendu** : la règle de décision s'écrit AVANT de lancer la mesure ; un
instrument se contrôle avant de servir ; une erreur d'instrument se consigne dans les notes
plutôt que de se corriger en silence. Le dépôt tient un **catalogue d'erreurs d'instrument**
en tête de `scoring.js` — 9 entrées. Plusieurs des notes ci-dessous y renvoient.

---

## 1. Ce que fait le projet

Serveur Node/Express qui identifie une carte Pokémon depuis une photo d'annonce Vinted et
la valorise contre Cardmarket. Consommé par une **extension Chrome dans un autre dépôt,
suivie par un autre agent** — ne pas y toucher ; ce qui la concerne se transmet au testeur.

Chaîne d'identification, dans l'ordre : IA lit la photo → nom / numéro / total / setCode →
`trouverProduitsLocaux(nom)` construit le **vivier** depuis `catalogue_produits` →
`scorerCandidatsLocal` le classe → prix depuis `guide_prix`.

---

## 2. Le verdict du chantier image — mesuré, pas supposé

**GO, et le gain est entièrement dans une seule population.**

Rejeu du banc entier (66 vérités saisies à la main, le seul matériel non biaisé du projet),
requête = photo d'annonce redressée, index = le **vivier réel** du scoring (62 candidats en
moyenne), références = **scans Cardmarket** du disque, ORB 200 points / Lowe 0,75 / RANSAC 5,0.

```
                          n     IMAGE      SCORING     D+   D−   test des signes
tout le jeu ..........   66   60 (91 %)   31 (47 %)   33    4   p < 0,0001   ✅
🔑 LA CELLULE ........   44   42 (95 %)   10 (23 %)   32    0   p < 0,0001   ✅
asiatique hors cellule   14   12 (86 %)   13 (93 %)    1    2   p = 1,00     🔴
🔑 OCCIDENTAL ........    8    6 (75 %)    8 (100 %)   0    2   p = 0,50     🔴
```

**La cellule** = asiatique, sans total lu, sans setCode. C'est là que le texte n'a aucun
signal, et c'est là que l'image remonte la vraie carte des rangs 46/38/37/36/30 au rang 1,
**32 fois, sans rien casser**.

**Sur l'occidental l'image n'apporte rien et casse 2 lignes.** 8 lignes ne décident de rien
(p = 0,50), mais la direction concorde avec trois mesures indépendantes : total lu sur
93,2 % des lignes occidentales contre 44,4 % en asiatique ; vivier occidental journalisé
= 1 candidat 10 fois sur 13 ; inliers occidentaux **9,5 contre 4,5**, là où la cellule fait
**49,5 contre 8**.

⚠️ **Les références occidentales sont des scans Cardmarket, pas des rendus TCGdex.** Le
confond du témoin ne s'applique donc pas : ce n'est pas la référence qui est en cause,
**c'est la carte**. Les cartes modernes et occidentales, brillantes et lisses, ne donnent
pas de points d'intérêt stables.

**Les 4 « casses »** : 3 désignent le même dessin dans une autre finition (rang de la CARTE
= 1). Par la définition du chantier — *juste = la bonne carte quelle que soit la finition* —
**D− vaut 1, pas 4**. La seule vraie casse est `L003` Gardevoir ex : rang 48/93, **zéro
inlier**, verdict TECHNIQUE, à regarder à l'œil.

### La règle qui en découle
> Le départage par l'image se déclenche **là où le texte n'a rien à dire** — pas de total
> lu, ou égalité au sommet. Le brancher partout dégraderait l'occidental sans rien gagner.

⚠️ **Rien de tout ça n'est branché en production.** Aucune ligne de scoring n'a été
modifiée. C'est une mesure, pas une bascule.

---

## 3. L'état de la collecte d'images

`C:\Users\Yung\Desktop\CARDMARKET IMAGE\<année>\<codeSet>\<page>_files\<idProduct>.jpg`
~1,8 Go. **Hors du dépôt, et ça reste hors du dépôt.**

```
fichiers numériques ......... 69 077      idProducts distincts ... 69 016
appariés au catalogue ....... 67 104      doublons ............... 61 (tous internes)
sans produit connu .......... 1 912       fichiers non-cartes .... 21 038
```

🔴 **RÈGLE DURE : l'index se construit sur l'idProduct du NOM DE FICHIER, jamais sur le nom
de dossier.** 41 dossiers portent un nom faux ; `CSDC` contient les 183 cartes de `CS3DC`
dont le propre dossier est vide ; `SV4A` mêle deux galeries d'expansions différentes ;
Windows interdit le `/`, donc `SV-P/ID` est rangé sous « SV-P ID ». **Cette règle sort de
mes propres erreurs** : deux passages de l'audit joignaient par dossier et allaient envoyer
le testeur réenregistrer 183 pages qu'il possède déjà.

🔴 **Le plafond Cardmarket, confirmé à l'écran** : la galerie Singles affiche « Page 1 of 10 »
même pour une expansion de 774 cartes. 15 galeries s'arrêtent à exactement 300 fichiers.
Sur 770 galeries du disque, **aucune ne dépasse 300, aucune n'a de page 11**.

**Les 300 ne sont le préfixe d'aucun ordre connu** (rang moyen normalisé des présents sur
MC : idProduct 0,348 · dateAdded 0,348 · numéro 0,348 · idMetacard 0,490 · nom 0,504 ; un
préfixe parfait vaudrait 0,194). Ce n'est pas non plus un filtre sur l'offre : 100 % des
présents ET des manquants ont une entrée `guide_prix`.

✅ **Mais la sélection est déterministe** : 15 galeries × 10 pages × 30 = 300 idProducts
**distincts**, zéro doublon, zéro trou sur 150 chargements. Réenregistrer le même tri est
stérile ; **changer le tri est la seule voie**, et pour un set de plus de 600 cartes le tri
ne suffira pas non plus — il faudra un **filtre** qui ramène la population sous 300.

**Renoncement assumé, 111 cartes marquées `non-collectee`** : PAL 37 · CSM1DC 36 · SVI 15 ·
PAR 14 · XSV2A 6 · FST 3. Le chiffre a doublé (39 → 111) quand le dénominateur a été
corrigé ; la décision a été reprise sur les bons nombres.

---

## 4. Les erreurs commises, et leur correction — à ne pas refaire

1. **Dénominateur faux.** J'ai compté les cartes d'un set avec `numeros_cartes.codeSet`.
   C'est la table de ce qu'on a **appris** ; elle ignore 1 781 produits du catalogue.
   **Le compte de Cardmarket est dans `catalogue_produits` par `idExpansion`.**
   Conséquence : deux galeries données à « 100 % » manquaient en réalité de 37 et 4
   produits. Le déficit total est passé de 97 sets / 2 720 manquants à
   **151 expansions / 3 610 manquants**.
   → ⚠️ `numeros_cartes.codeSet` sert à **nommer** un set, jamais à le **compter**.
2. **Jointure par dossier** (cf. §3). Corrigée en jointure globale sur l'idProduct.
3. **Séquences d'idProduct consécutifs** présentées comme signal de page ratée : mesuré,
   525 sets sur 542 ont des pages qui se chevauchent en idProduct. Heuristique abandonnée,
   pas raffinée.
4. **« Page tronquée = moins de 30 fichiers »** : 160 faux positifs. La taille de page est
   un réglage Cardmarket qui varie par set ; on l'infère par set (mode).
5. **Extraction du nom de galerie** ancrée en début de chaîne, alors que « PAGE n » apparaît
   aussi au milieu. L'instrument signalait alors *tous* les sets — un instrument qui trouve
   une anomalie partout n'en a trouvé aucune.
6. **« L'inverse du tri rendra les 300 derniers »** — écrit après avoir montré que les 300
   ne sont le préfixe d'aucun ordre. Retiré : **l'attente est inconnue**.
7. **Sur-lecture du témoin TCGdex** : j'ai attribué l'effondrement des inliers à la nature
   de la référence (rendu contre scan). La mesure sur 66 avec des scans Cardmarket montre
   le même effondrement sur l'occidental. **C'est la carte, pas la référence.**

---

## 5. Ce qui est en cours, dans l'ordre

### A. Le testeur fait SI100 ce soir — test du tri
Il enregistre SI100 (430 produits, 130 manquants) avec **le tri inversé**, puis compte.

```
node mesure-collecte-images.js --base=test --marquer     ← AVANT
   ... enregistrement ...
node mesure-collecte-images.js --base=test               ← 🔑 NOUVEAUX : n
```

**Les trois issues, écrites d'avance :**
| nouveaux | lecture | suite |
|---|---|---|
| **0** | le tri est appliqué APRÈS le plafond | le tri est mort, seuls les filtres restent |
| **quelques dizaines** | la fenêtre bouge partiellement | 2-3 passes, puis filtres pour MC |
| **~130** | la sélection dépend de la requête | ça rouvre la question de ce qu'étaient les premiers 300 |

⚠️ Une 4ᵉ issue : **plus de 130 est impossible** (il n'en manque que 130). Si le compteur
en annonce davantage, des fichiers d'un autre set ont atterri dans le dossier.

🔴 **NE PAS ENTREMÊLER CE TEST ET UN IMPORT DE CATALOGUE.** Si `catalogue_produits` change
entre le `--marquer` et la relecture, l'écran mêle « fichiers enregistrés » et « produits
ajoutés par l'import ». **Collecte d'abord, import ensuite, nouveau `--marquer` après.**

### B. Le testeur va chercher un export Cardmarket frais
`products_singles_6.json` local est daté du **2026-07-12** et **est déjà en base** :
0 nouveau, 0 changé, 0 des 1 912 orphelins récupérés. **Le relancer est un no-op exact.**
Il faut un nouveau téléchargement depuis son compte Cardmarket (format
`{"version":1,"createdAt":…,"products":[…]}`, suffixe `_6` = identifiant de jeu Pokémon).
Il garde l'ancien fichier — c'est lui qui porte `dateAdded`, que l'import jette.

**Avant l'import :**
```
node mesure-diff-catalogue.js --base=test <nouveau.json> products_singles_6.json
```
Il rend : nouveaux · disparus · noms changés · idExpansion changées · ce que ça résout sur
les orphelins · les divergences d'idExpansion avant/après. **Il n'importe rien.**

⚠️ `import-catalogue.js` est un `updateOne` + `upsert` : **il n'efface jamais**. Un produit
retiré du catalogue Cardmarket reste en base pour toujours, et rien ne le signale.

🔴 **Bombe à retardement : 26 lignes où `numeros_cartes.idExpansion` diverge déjà de
`catalogue_produits`** — 21 pour le seul WCD18, plus SEA, MEP, M-P/ID, FL, PR. Aucune ne
porte de `setTcgdex` appris, donc ça ne coûte rien **aujourd'hui**, et c'est exactement pour
ça que ça passera inaperçu. Relever la liste avant, la relever après, traiter tout écart
nouveau comme un défaut.

### C. Ce qui devra être RECALCULÉ après l'import
**Périmé** (tout ce qui a `catalogue_produits` au dénominateur) : A/B/C (67 104 / 3 871 /
1 912) · la liste de travail (151 expansions, 3 610) · les 15 galeries plafonnées · les
1 781 ignorés · **🔑 le coût de la règle stricte (7,6 % / 8,4 %)** — c'est lui qui a justifié
la garde d'abstention, et les produits neufs sans image le feront **monter** ; si ça passe
le quart, la règle est à rediscuter · la couverture du pont TCGdex (32,7 %) · la liste des
sets éligibles à la mesure occidentale.

**Pas touché** : le résultat du chantier image (66 vérités) · le témoin rendus TCGdex ·
les statistiques du journal · la démonstration que la sélection des 300 est déterministe.

---

## 6. Décisions adoptées, non codées

### `references_image` — adoptée telle quelle, **pas encore écrite**
Collection **dédiée**, clé `idProduct`. ⚠️ **Pas un champ de `catalogue_produits`**, que
l'import réécrit.

```
references_image : { idProduct, etat, constateLe, source }
   etat = 'indexee'        un vecteur existe
        | 'absente'        vérifié chez Cardmarket : il n'y a pas d'image. PROPRIÉTÉ DU PRODUIT.
        | 'non-collectee'  le set n'a pas été enregistré. PROPRIÉTÉ DE NOTRE TRAVAIL.
```

Un booléen mentirait : il confondrait « on a vérifié » et « on n'a pas regardé ».

🔴 **LE RACCOURCI À NE PAS PRENDRE, et il sera tentant :**
> *« ce candidat n'a pas de vecteur, il ne peut pas gagner de toute façon, donc je le
> retire du groupe et je départage les autres. »*

**C'est faux, et c'est fabriquer une victoire.** Si la carte réelle est justement celle sans
référence, l'appariement désignera un autre candidat **avec assurance**, puisque plus rien
ne lui fait concurrence. Retirer le candidat aveugle ne supprime pas l'incertitude, il
supprime **la trace** de l'incertitude. Le score monte, la justesse baisse, rien ne le
montre. **`absente` et `non-collectee` se valent devant la garde.**

⚠️ **Le grain du groupe est fixé, parce qu'il change le prix de la règle :**
vivier entier 56,4 % · (nom, codeSet) 7,6 % · **idMetacard 8,4 %**. Le groupe est ce que le
scoring laisse **à égalité**, au grain `idMetacard`. Moins d'un groupe sur dix, dont un
cinquième définitif (produits sans numéro).

---

## 7. Les outils construits ces jours-ci

| fichier | ce qu'il fait |
|---|---|
| `mesure-collecte-images.js` | état de la collecte + **combien de NOUVEAUX** depuis le dernier repère. `--marquer` écrit un seul fichier, à côté des images. |
| `mesure-diff-catalogue.js` | ce qu'un nouvel export **changerait**, avant l'import. Lecture seule. |
| `mesure-images-vintage.js` | **porte toutes les notes du chantier image en tête.** À lire en premier. |
| `pokemon-proxy-labo/justesse-66.js` | la mesure des 66 vérités (hors dépôt) |
| `pokemon-proxy-labo/temoin-rendu.js` | photo Vinted contre rendu TCGdex, avec option de dégradation d'échelle |
| `pokemon-proxy-labo/justesse-orb.js`, `preVol-orb.js` | le chantier d'origine, 11 photos |

**Le labo est hors du dépôt** (`C:\Users\Yung\Desktop\pokemon-proxy-labo`) et ses
dépendances (`sharp`, `@techstark/opencv-js`) **ne doivent jamais entrer dans
`package.json`**. Données de travail : `C:\Users\Yung\Desktop\labo-embedding\`.

---

## 8. Parqué, pas abandonné

- **La saisie des vérités du holdout** : 53 lignes, 10 avec vérité individuelle, 43 sans.
  Le testeur ne la finira pas. Bloc de clôture en tête de `banc-japonais.js`.
- **Avec elle, nommément** : la règle de branchement du **veto par le symbole** (exige
  N ≥ 12 lignes décidables ; il y en a 10 sur tout le holdout, 1 dans sa population) et la
  promotion de **`perimetre-vintage-suggestion`**.
- **Les groupes V1/V2 fabriqués** — toujours pas mesurés. La mesure des 66 les rencontre
  (3 casses sur 4) mais ne les construit pas durs.
- **Le japonais moderne** — non testé.
- **8 lignes occidentales** — une indication, pas un verdict. Il en faudrait 15.
- Différés par accord explicite : l'exclusion du plafond de remboursement · le
  `catch → return []` des cinq sources restantes · le branchement de
  `totalHorsTailleDeSet` et `setCodeResolution` · l'alarme `entretien-cardmarket` côté
  extension · le contrat d'affichage de l'extension.

---

## 9. État git

**11 commits en avance sur `origin/main`, aucun poussé.** Le testeur pousse depuis GitHub
Desktop. Les 6 derniers sont de ces deux jours :

```
f5b455c  Rejoue le banc entier contre l'image : 66 verites, D+ 33 contre D- 4
87e0269  Mesure l'angle mort de numeros_cartes et separe collecte et import
f9baa7f  Corrige le denominateur des couvertures et outille le diff de catalogue
514f454  Consigne le plafond Cardmarket et outille le suivi de collecte
a1b2b68  Ecrit la regle de l'index et adopte references_image
47271c8  Ecrit ce qui reste a mesurer sur le chantier image
```

⚠️ **`banc-verites.json` est modifié dans la copie de travail et NON INDEXÉ.** Le laisser
ainsi. Ne pas l'ajouter, ne pas le réinitialiser.

---

## 10. Ce que je ferais en reprenant

1. **Attendre le résultat de SI100** et lire les trois issues ci-dessus. C'est une heure du
   testeur et ça ne dépend de rien.
2. **Quand l'export arrive** : `mesure-diff-catalogue.js` d'abord, l'import ensuite (par le
   testeur), puis **recalculer les 7,6 %** en premier — c'est le chiffre qui a justifié la
   règle stricte.
3. **Regarder `L003` Gardevoir ex** à l'œil (`labo-embedding\photos-66-redressees\`) : zéro
   inlier, c'est la seule vraie casse de la mesure.
4. **Ne rien brancher en production** sans que le testeur le demande. La mesure dit où
   l'image sert ; elle ne dit pas que le code doit changer aujourd'hui.
