# Plan de collecte massive : texte, images, table

> **Pour l'exécutant :** superpowers:executing-plans, lot par lot. Les cases `- [ ]` suivent l'avancement.
> Un point 🛑 attend la validation du testeur. Hors de ces points, **on n'attend personne entre deux blocs**.
> ⚠️ Les divergences entre les skills et `CLAUDE.md` sont listées au §2 et **attendent une décision** :
> ce plan ne les tranche pas.

**But :** amener en base le texte et les images des expansions japonaises modernes et occidentales restantes :
398 lignes automatiques, puis 215 lignes à la main.

**Architecture :**
- **Texte :** collecté depuis ce poste par `collecte-massive.js`, qui lance `collecteur-texte.js` bloc par bloc,
  sous le verrou `bulbapedia/__collecteur__`.
- **Images :** collectées par les **workers Render seulement**, un par source :
  - artofpkm pour le japonais, qui tourne déjà ;
  - Bulbapedia pour l'occidental, à mettre en service au lot D.

  Chacun a son verrou global et sa file d'attente dans la base `cartes`.
- **Table :** l'état d'admission vit dans `collecte-cartes/table-sets-auto.json`.

**Outils :** Node 24, MongoDB Atlas (base `cartes` ; `test` en **lecture seule**), Cloudflare R2, sharp,
worker Render.

**Spécifications :** `SPEC-COLLECTE-BULBAPEDIA.md`, `SPEC-COLLECTE-IMAGES.md`, `CLAUDE.md` (§17, §21, §21 bis,
§23, §25, §28).

---

## 1. Contraintes globales

Toute tâche les inclut sans les répéter :
- **Débit :** 1 requête / 5 s par source, jamais en parallèle, **comptée chez la source** (§17). Verrous globaux
  `artofpkm/__collecteur__` et `bulbapedia/__collecteur__`, tous deux sur `collecte-cartes/verrou-source.js`.
- **Les trois propriétés d'un verrou** (§21 bis) :
  1. la libération vérifie pid + hôte + jeton ;
  2. le verrou se rend APRÈS l'unité en cours ;
  3. le battement lit son résultat : 0 document touché = perte = arrêt.

  S'y ajoutent deux règles : la possession se revérifie avant chaque set, et un worker ne dort pas en
  tenant le verrou.
- **Aucun collecteur d'images en local.** Les workers Render sont les seuls.
- **Symétrie (§21 bis) :** une règle qui existe en deux exemplaires se corrige dans les deux, dans le même
  commit.
- **Écritures en base :** `test` jamais ; `cartes` pour la collecte ; toute nouvelle collection est nommée
  dans ce plan AVANT sa création.
- **Mesures :** `node file-a-l-arret.js` avant toute mesure sur `cartes`, `cartes_produits` ou `images`, et le
  rapport dit que c'est fait (§25). Tout compte imprime son dénominateur.
- **Git :**
  - jamais `git add -A`, fichiers nommés un par un ;
  - `banc-verites.json` n'est ni lu ni commité ;
  - `node_modules/.package-lock.json` n'est pas commité ;
  - push **sur demande nommée seulement**, `git pull --rebase` avant, `git log origin/main..main` pour savoir
    ce qui part, jamais `--force`.
- **Heures :** `git log` rend l'heure de Paris ; Mongo, les journaux et ce plan sont en **UTC**.

## 2. Méthode et divergences avec `CLAUDE.md`, en attente de décision

**La forme du TDD ici, annoncée plutôt que contournée :**
- **Logique pure** (boucle de file, verrou, priorité) : test rouge puis vert, sur un modèle en mémoire, comme
  `test-verrou-source.js`.
- **Tout ce qui frappe une source externe :** on ne simule pas Bulbapedia. Le **CHIFFRE ATTENDU** est écrit
  dans ce fichier AVANT le lancement.
  - Si le résultat obtenu diffère de l'attendu, **on arrête le lot**, on n'ajuste pas l'attendu, et on passe par
    `systematic-debugging` phase 1.
  - Trois correctifs ratés sur la même chose : arrêt et discussion d'architecture. C'est ce qui a manqué au
    verrou, corrigé quatre fois.
- **Relecture :** `requesting-code-review` après chaque tâche de code, avant commit. Le relecteur reçoit la
  liste des décisions écrites de `CLAUDE.md`.

| # | skill | ce qu'elle exige | ce que dit `CLAUDE.md` ou la pratique | ce que fait ce plan en attendant |
|---|---|---|---|---|
| **1** | executing-plans, étape 1 | un **worktree isolé** ; « never start implementation on main without explicit consent » | Tout le dépôt travaille sur `main` (§3, §18) et Render déploie `main`. `.env` n'existe pas dans un worktree. L'état de la table (`verif`, `collecte`) s'écrit dans le checkout principal. | Lot A (aucun code) sur `main`. **Lots B et D : décision 🛑1.** |
| 2 | finishing-a-development-branch, obligatoire en fin d'executing-plans | Menu de fin « merge local / **push + PR** ». Merge avec `git pull`, sans `--rebase`. | §3 : le push n'est **jamais un geste de fin**, jamais par lot, sur demande qui nomme le commit. §18 : `git pull --rebase`. | La skill n'est pas appliquée en fin de lot. Chaque commit attend sa demande nommée. |
| 3 | requesting-code-review | « Fix Critical immediately » ; ne jamais continuer avec un « Important » non corrigé | Décisions écrites de NON-correction (§8 garde de L109, §9 promotion, §13 dettes, §16 L070). « Un correctif justifié par un cas est une hypothèse » (§8). | Un Critique qui touche une décision écrite remonte au testeur et n'est jamais corrigé d'office. |
| 4 | writing-plans, systematic-debugging 4.1 | un test qui échoue avant tout code | Le testeur : sur une source externe, le rouge-vert ne prouve rien. | Chiffre attendu, voir ci-dessus. |
| 5 | writing-plans | le code complet dans chaque étape | Les lots B et D dépendent des décisions 🛑1 (où tourne le worker, ce que porte la file). | Le plan fixe interfaces, tests et chiffres. Le code final s'écrit après 🛑1, relu avant commit. |

⚠️ **Les skills ne sont pas chargées dans cette session** : `Skill("superpowers:writing-plans")` répond « Unknown
skill » alors que le plugin est activé dans `settings.json`. Elles sont appliquées en lisant leur `SKILL.md` dans
le cache du plugin. Une nouvelle session devrait les charger.

## 3. Décisions attendues 🛑1

| | question | options | recommandation |
|---|---|---|---|
| **D1** | Comment un worker Render apprend-il une ligne admise ? `table-sets-auto.json` est écrit **ici** et le worker lit **son commit déployé**. | (a) commit + push nommé + redéploiement **par bloc**, soit ~20 demandes ; (b) **l'entrée de file porte sa ligne** (`ligne`, et `sourceImages` pour artofpkm) : un changement de code, un déploiement, puis on enfile depuis ici | **(b)**. Sans elle, « images enfilées dès qu'un bloc est en base » est impossible. |
| **D2** | Où tourne la boucle Bulbapedia ? | (a) le même processus alterne les deux sources : ~2× plus lent ; (b) un lanceur dans le même service démarre deux processus : relais des signaux à écrire, mémoire à mesurer, commande Render à changer ; (c) **un second worker Render** `node collecteur-images-bulba.js --boucle` | **(c)** : aucun code de gestion de processus, isolement complet. Coût : un service de plus, à toi de juger. |
| **D3** | Le texte et les images occidentales frappent le même serveur. Qui passe d'abord ? | (a) premier arrivé ; (b) **priorité au texte** : `collecte-massive.js` tient `bulbapedia/__priorite-texte__` (verrou-source.js, battement 60 s) ; la boucle d'images **cède** tant qu'il bat, contrôle fait avant chaque set | **(b)**, voir le chiffrage ci-dessous. |
| **D4** | Le worktree (divergence 1) | worktree pour les lots de code, ou `main` comme jusqu'ici | `main` : `.env`, état de la table, Render. C'est ta décision. |
| **D5** | Une requête artofpkm `GET /cards` (liste des 419 sets) **depuis ce poste**, sous le verrou global, sans attente | oui / non ; si non, par le worker | oui : le worker dort sans le verrou depuis 5401c96. |

**Pourquoi (b) pour D3 :**
- Un set de texte dure ~1 min. Un set d'images Bulbapedia dure ~10 min : ~130 fichiers à 5 s.
- Entre deux sets de texte, le verrou est libre ~3 s (démarrage de node + connexion Mongo).
- Une boucle d'images qui interroge toutes les 30 s l'attrape donc environ une fois sur dix.
- Sur 398 sets, cela fait ~40 prises × ~10 min ≈ **+7 h de texte**. Avec la priorité : 0.

⚠️ C'est une estimation, pas une mesure.

---

## Lot A : le texte des 398 lignes automatiques (EN COURS)

**Faits au lancement :**
- Bulbapedia a répondu **503 à tout le monde** de 18:43 à ~19:00 UTC ; confirmé par un autre client que le nôtre.
- Le bloc 1 est vérifié à 19:09:08 UTC, avec **2 requêtes** :
  - **16 lignes admises sur 20**, toutes `jp` ;
  - **4 à regarder, toutes de tirage non établi et toutes des decks** : `sI100`, `svM`, `smH` (« tirage non établi,
    vus : aucun ») et `svD` (« aucune entrée de Setlist pour Ex Start Decks ») ;
  - rapport entrées / produits des 16 admises : 0,64 à 0,86.
- 🔑 **L'INCONNUE, CE QUE LE BLOC 1 EN DIT.** Le contrôle de tirage échoue sur les 4 decks, et **135 lignes
  sur 398** ont un tirage non établi.
  - Si les decks échouent tous, la pile « à regarder » s'ajoute aux 215 lignes à la main.
  - ⚠️ C'est mesuré sur **4 lignes** : une piste pour les blocs 2 et 3, pas une règle (§22). Aucune des 4 n'a
    encore été ouverte. Hypothèse non vérifiée : sur la page d'une carte, un deck se déclare ailleurs que
    dans `jpexpansion`.
- **Référence**, sets déjà collectés, lecture seule le 2026-09-14 vers 19:14 UTC :
  - japonais vintage : **28 concordants sur 28**, produits joints **2 183 / 2 237 = 97,6 %**, taux par set
    min 0,75 / médiane 1 ;
  - occidental : 10 concordants sur 10, 1 400 / 2 072 = 67,6 %.

**Lancement :** `node collecte-massive.js --blocs=1` à **19:13:02 UTC**.

⚠️ `collecte-massive.js` vérifie le bloc SUIVANT (2 requêtes) avant de collecter celui-ci : c'est le comportement
du code, sans conséquence. **Les attendus ci-dessous ont été écrits entre 19:17 et 19:20 UTC, avant la lecture de
tout journal de set.**

### Tâche A1 : bloc 1, 16 sets japonais modernes

- [ ] **Chiffre attendu, écrit avant le résultat :**
  - **16 collectes, 16 `phase: verifie`, 0 échec** ;
  - **concordance ✅ sur 16 / 16** : les trois égalités de `collecteur-texte.js:322`, soit titres manquants = 0,
    pages distinctes = cartes écrites, produits = joints + restes ;
  - **produits joints / produits ≥ 0,75 sur chaque set** (le minimum du vintage japonais) et **≥ 0,90 sur le
    bloc**.

  ⚠️ Le moderne japonais n'a **aucune référence** : ces deux seuils sont des PRÉDICTIONS tirées du vintage.
  Elles se testent, elles ne deviennent pas des règles.
- [ ] **Lire le bilan** : `collecte-cartes/rapports/massive/collecte-massive-2026-09-14.log`, ligne `BILAN bloc 1`,
  puis la complétude de chaque `texte-<CODE>.log`.
- [ ] **Obtenu = attendu** : relancer `node collecte-massive.js --blocs=1` pour le bloc 2, sans attendre le testeur.
- [ ] **Obtenu ≠ attendu** : arrêt du lot A, `systematic-debugging` phase 1 sur le premier set qui s'écarte, puis
  ouvrir 3 de ses restes (§22) avant toute hypothèse.
- [ ] **Point au testeur** toutes les 5 collectes (le journal écrit `📍 POINT`), pas à chaque set.

### Tâche A1 bis : obtenu ≠ attendu, recherche de cause (systematic-debugging)

**Obtenu au bloc 1** (bilan à 19:30:31 UTC, lu le 2026-09-14 à 23:21 UTC) :

| | attendu | obtenu | |
|---|---|---|---|
| collectes | 16, 0 échec | 16 ok, 0 échec | ✅ |
| concordance | 16 / 16 | 16 / 16 | ✅ |
| joints / produits par set | ≥ 0,75 | **5 sets en dessous** (s8b 0,62 · sm12a 0,66 · s12a 0,68 · sm8b 0,71 · BXY 0,71) | ❌ |
| joints / produits sur le bloc | ≥ 0,90 | **2 551 / 3 320 = 0,768** | ❌ |

- [x] **Phase 1 : cause racine.**
  - Sur les 11 sets dont l'infobox porte `jacards`, produits Cardmarket = `jacards` **11 fois sur 11**, et les
    entrées de Setlist sont en dessous.
  - s11 : 127 gabarits `Setlist/entry`, **98 lus, 29 écartés = 29 restes**, tous des V, VMAX ou VSTAR.
  - `sectionsSetlist` (wikitext.js) ne lisait que `{{TCG ID|A|Nom|B}}` et faisait `continue` sur tout le reste,
    sans compter.
- [x] **Phase 2 : formes**, mesurées sans requête sur les 54 sets collectés :

| population | gabarits | lus | TCG ID à 4 param. | liens `[[Titre (Set N)]]` | ni l'un ni l'autre |
|---|---|---|---|---|---|
| japonais vintage, 28 sets | 2 118 | 2 094 | 0 | 9 | 15 (énergies de base) |
| occidental, 10 sets | 1 636 | 1 318 | **153** | **165** | 0 |
| japonais moderne, bloc 1 | 3 132 | 2 432 | 52 | **632** | 16 (énergies de base) |

  - Sur 806 liens, 793 ont le nom du set entre parenthèses et 13 un numéro « TG13 ». Les 16 entrées à deux liens
    pointent deux fois vers le même titre. Les 205 TCG ID à 4 paramètres sont tous conformes.
  - 🔴 **Deux conclusions écrites sont touchées.** §22 : « 693 restes occidentaux, la carte n'est pas sur la
    page » ; au moins 318 y sont. §24 : « 9 irréductibles sans page » ; 6 sont des liens sur la page de leur set
    (G2 Blaine's Quiz 3 ; PCG6 Kyogre ☆, Groudon ☆, Metagross ☆ ; PCG9 Mew ☆ δ, Charizard ☆ δ). **L'existence de
    leur page reste à prouver** par la re-collecte : un lien peut être rouge.
- [x] **Phase 3 : hypothèse.** Lire ces deux formes rend 1 011 entrées, et leurs produits se joignent.
- [x] **Phase 4 : test rouge puis vert.**
  - `test-setlist.js`, 12 cas, chaînes réelles relevées sur R2 : **rouge 3/12** (les 3 cas de la forme déjà
    lue) puis **vert 12/12**.
  - `entreeDeSetlist` : la première référence du gabarit gagne. Les entrées sans référence sont comptées dans
    `ignorees`.
  - Symétrie : repli sur tout le wikitext et `verifier-table.js:40`, sur la même `RE_TCG_ID`.
- [x] **Rejeu sans requête, ancien parseur (HEAD) contre nouveau, sur les 54 sets. ATTENDU, écrit le
  2026-09-14 vers 23:30 UTC, avant le lancement (23:31:36 UTC) :**
  - **0 entrée perdue** : titres anciens ⊂ titres nouveaux, sur 54 sets sur 54 ;
  - gain en entrées = TCG ID à 4 paramètres + liens du tableau ci-dessus, set par set. Au total : vintage **+9**
    (G2 +1, DP5c +3, PCG6 +3, PCG9 +2), occidental **+318**, bloc 1 **+684**, soit **+1 011** ;
  - ignorées : les énergies de base seules (15 + 16), **0 ignorée hors énergie**.

  **OBTENU :**
  - **0 titre perdu, sur 54 sets sur 54** ✅ ;
  - gain égal à l'attendu sur **53 sets sur 54** ✅ : vintage +9, occidental +318 ;
  - ❌ **BXY +53 pour un attendu de 0.** L'attendu était faux par construction : la mesure d'exposition ne comptait
    que les sections NOMMÉES, et BXY passe par le repli (0 gabarit dans « The Best of XY »). 135 → 188 entrées,
    pour 188 produits. Bloc 1 : +737 et non +684 ;
  - ❌ **4 ignorées « hors énergie » pour 0.** Ce sont aussi des énergies, écrites `{{OBP|Darkness Energy|Special}}`
    (2 dans VS) et `{{OBP|Darkness Energy|Basic}}` (2 dans s12a). Le filtre ne connaissait que `{{TCG|… Energy}}`,
    et l'avertissement du collecteur est élargi à `{{OBP|… Energy|…}}`.

  Les deux écarts viennent du **périmètre de l'attendu**, pas du parseur. Ils sont écrits ici et pas corrigés
  après coup dans l'attendu.
- [x] **Relecture** (`requesting-code-review`), verdict : **à committer après corrections**. Aucun Critique. Cinq
  Importants, tous vérifiés contre le code (`receiving-code-review`), quatre corrigés :
  1. un lien générique `[[X (TCG)]]` pris pour une carte → garde des qualificatifs + compteur `horsSet` ;
  2. l'ordre des références non testé → 2 tests, **contrôle par inversion : chaque inversion fait passer un test
     au rouge** ;
  3. `sectionsVues` périmé à la re-collecte → `sectionsVues` et `lectureSetlist` écrits dans les deux branches ;
  4. le repli ne lisait pas les liens → lu sous le même filtre de nom, `chemin` et `lues` imprimés ;
  5. `--auto` ne rejuge pas une ligne qui a déjà un `verif` → **déjà couvert** : le script de remise retire
     `verif` des 40 lignes.

  Mineurs corrigés : paramètre imbriqué `{{tt|…}}` rejeté, énergie SPÉCIALE séparée de l'énergie de base
  (`natureIgnoree`), chiffres des commentaires. Test : rouge sur les nouvelles gardes, puis **vert 26/26**.
- [ ] **Second rejeu sans requête**, parseur corrigé contre HEAD. **ATTENDU, écrit avant le lancement** :
  - 0 titre perdu, **gain 1 064 inchangé**, 53 sets conformes à la prédiction (BXY comme au premier rejeu). Le
    corpus n'a aucun lien générique ni paramètre imbriqué : les gardes ne doivent rien retirer ;
  - ignorées par nature : **énergie-base 29, énergie-spéciale 2** (VS, `{{OBP|Darkness Energy|Special}}` et son
    homologue), **autre 0** ;
  - **hors set : 0** sur les 54 sets. C'est une prédiction : les pages fusionnées du vintage peuvent la faire
    mentir.
  - ⚠️ Le rejeu lit l'archive R2 **épurée**. Sans `--reparser`, la re-collecte lit la révision BRUTE courante.
    De petits écarts sont possibles, et c'est la re-collecte qui les dira.

  **OBTENU (23:49:36 UTC)** :
  - 0 perdu ✅, gain 1 064 ✅, 53 sets conformes (BXY comme prévu) ✅ ;
  - ❌ nature : **base 28, spéciale 3**, et non 29 et 2. **Le classement est juste, c'est l'attendu qui était
    faux** : VS a 6 énergies de base et 3 spéciales (Darkness Special, Metal Special, Rainbow Energy). Ces 3
    spéciales sont de vraies cartes non lues, désormais signalées par le collecteur ;
  - ❌ **hors set 143, pour 0 attendu**, dont **142 sur VS : un faux signal**. Section « Pokémon Card★VS »,
    expansion « Pokémon VS », jeton des TCG ID « VS ». Un contrôle qui crie sur un cas normal finit contourné
    (§25). Correction : le jeton de set DOMINANT de la section vaut nom, comme le motif dérivé de
    verifier-table.js. Test rouge (26/27) puis vert **27/27**.

  **TROISIÈME REJEU (23:51:06 UTC)** : 0 perdu, gain 1 064, **hors set 1**. Ce reste est « Collapsed Stadium (Star
  Birth 98) » dans la section Lost Abyss de s11 : une réimpression listée sous le lien de son premier tirage. C'est
  un vrai signal, que la re-collecte dira joint ou non.
- [ ] Commit (fichiers nommés), puis une relecture ciblée des corrections, en parallèle de la re-vérification (qui
  n'écrit que le fichier de table). **La re-collecte, qui écrit la base, attend cette relecture.**
- [x] **Re-vérification des blocs 1 et 2** (4 requêtes, 23:52:37 UTC). **OBTENU = ATTENDU** :
  - 33 OK sur 40, aucune ligne perdue ;
  - bloc 1 : rapport **de 0,97 à 1,07**, avec **entrées = produits Cardmarket, exactement, sur 13 lignes**. BXY est
    à 188 / 188 ;
  - DP1 1,93 et sv1S 2,26 restent hors bornes ; sI100, svM, smH et sD restent en « tirage non établi », svD à
    0 entrée. Ce sont deux défauts distincts du parseur, à regarder au lot F.

  Texte d'origine de la tâche : **Re-vérification des blocs 1 et 2** (4 requêtes) : les rapports entrées / produits changent, et une ligne
  proche de 1,5 peut sortir des bornes. Le script `remettre-verif-blocs-1-2.js` (scratchpad) retire `verif` et
  `verifie` des 40 lignes, et garde l'ancien jugement dans `verifAvantCorrectifSetlist`. **ATTENDU, écrit avant** :
  - **aucune ligne OK ne devient « à regarder »** : 33 OK sur 40 au moins ;
  - bloc 1 : rapport entrées / produits **entre 0,90 et 1,10** sur les 15 lignes à section, BXY compris
    (188 / 188), contre 0,64 à 0,86 avant ;
  - DP1 (1,93) et sv1S (1,98) restent hors bornes : le correctif ajoute des entrées, il n'en retire pas ;
  - l'échantillon (l'entrée du milieu) change sur la plupart des lignes. Un changement de verdict sur « tirage
    non établi » (sI100, svM, smH, sD) est **possible et non prédit**.
- [x] **Seconde relecture** (ciblée sur 5e77b47) : **« la re-collecte peut partir »**, aucun Critique. Quatre
  Importants, sans effet sur les chemins de la re-collecte (`sections-nommees`, `set-reconstruit`), **à corriger
  avant A2** :
  1. un TCG ID illisible en tête laisse gagner un lien placé plus loin ;
  2. le jeton dominant peut absorber l'erreur qu'il doit signaler → seuls les TCG ID votent, et le jeton est écrit
     dans l'état ;
  3. `horsSet` n'existe que sur 1 chemin sur 5 ;
  4. le rejeu sur l'archive épurée ne peut pas exercer le repli sur tout le wikitext → `source` et `revid` dans
     `lectureSetlist`, et une mesure sur des pages brutes.

  Elle rappelle aussi le §3 : écriture en base = accord explicite.
  - **Bloc 1** : fait partie de la collecte massive ordonnée par le testeur, pas encore d'images → re-collecté.
  - **Les 14 sets déjà collectés** (10 occidentaux, G2, DP5c, PCG6, PCG9) portent images, jointures et marqueurs
    d'orphelines → **🛑 accord du testeur, et sa sauvegarde s'il la veut**.
    ⚠️ **Corrigé le 2026-09-15 : 12 sets, pas 14.** Mesuré sans requête sur les 38 sets collectés hors bloc 1
    (`m-gain-titres-hors-bloc1.js`) : **xASC et TR n'ont aucun gain**, en entrées comme en titres. Rien à
    re-collecter sur eux.
- [x] **Re-collecte du bloc 1** (`collecteur-texte.js --set=…`, les titres ajoutés sont fetchés seuls ; la page du
  set est relue depuis l'archive R2, soit le corpus exact du rejeu). ⚠️ **Faux, corrigé le 2026-09-15** : lancée
  sans `--reparser`, la re-collecte a REFAIT la requête de la page du set (« requêtes Bulbapedia : 2 » sur s11 : la
  page du set et un lot de redirections). Le corpus était le même parce que la révision n'avait pas bougé
  (« R2 déjà là », même `revid`), pas parce qu'il avait été relu. **Titres nouveaux attendus par set = le gain
  du rejeu** : sv4a 51 · s4a 56 · s8b 103 · s12a 76 · m2a 52 · sm8b 73 · sm12a 70 · sv2a 31 · BXY 53 · sv3 21 ·
  sv8 21 · sv7 21 · sv9 24 · CP4 28 · s8 28 · s11 29 = **737**. **ATTENDU :**
  - concordance 16 / 16 ;
  - **titres manquants = 0**, sinon ce sont des liens rouges, à lister ;
  - joints / produits ≥ 0,95 sur chacun des 15 sets à section : produits = gabarits sur 14 d'entre eux, moins
    8 énergies sur s8b et s12a ;
  - BXY à part : 0 gabarit dans sa section, restes non expliqués par ce défaut.

  **OBTENU (2026-09-15, 00:06:36 → 00:13:50 UTC, 16 sets, code 0 sur les 16)** :

  | set | titres ajoutés (attendu) | produits = joints + restes | joints / produits | titres manquants |
  |---|---|---|---|---|
  | sv4a | 51 (51) | 360 = 355 + 5 | 0,986 | 0 |
  | s4a | 56 (56) | 330 = 330 + 0 | 1 | 0 |
  | s8b | 103 (103) | 293 = 284 + 9 | 0,969 | 0 |
  | s12a | 76 (76) | 262 = 254 + 8 | 0,969 | 0 |
  | m2a | 52 (52) | 250 = 250 + 0 | 1 | 0 |
  | sm8b | 73 (73) | 250 = 250 + 0 | 1 | 0 |
  | sm12a | 70 (70) | 235 = 226 + 9 | 0,962 | 0 |
  | sv2a | 31 (31) | 210 = 210 + 0 | 1 | 0 |
  | BXY | 53 (53) | 188 = 187 + 1 | 0,995 | 0 |
  | sv3 | 21 (21) | 141 = 141 + 0 | 1 | 0 |
  | sv8 | 21 (21) | 138 = 138 + 0 | 1 | 0 |
  | sv7 | 21 (21) | 135 = 135 + 0 | 1 | 0 |
  | sv9 | 24 (24) | 132 = 132 + 0 | 1 | 0 |
  | CP4 | 28 (28) | 140 = 140 + 0 | 1 | 0 |
  | s8 | 28 (28) | 129 = 129 + 0 | 1 | 0 |
  | **s11** | **12 (29) ❌** | 127 = 127 + 0 | 1 | 0 |
  | **16 sets** | **720 (737)** | **3 320 = 3 288 + 32** | **0,990** | **0** |

  - concordance **16 / 16** ✅ ; titres manquants **0 sur 16** ✅ ; joints / produits **≥ 0,96 sur 16** ✅
    (bloc 1 à 0,768 avant le correctif) ;
  - ❌ **s11 : 12 titres ajoutés pour 29 attendus. L'attendu était faux, pas le code — et je le dis au lieu de le
    corriger après coup.** Le rejeu mesurait des ENTRÉES (98 → 127), j'en ai fait des TITRES. Les deux coïncident
    quand chaque entrée a sa page ; sur s11, la Setlist lie **deux fois la même page** pour une carte et sa
    variante (`[[Delphox V (Lost Abyss 17)|Delphox]]{{TCGV}}` deux fois, de même Kyurem V 29 et Kyurem VMAX 30 :
    trois lignes ouvertes sur le document). Mesuré sans requête (`m-s11-entrees-titres.js`) : **29 entrées gagnées
    = 12 titres nouveaux + 17 répétitions de ces mêmes titres + 0 titre déjà connu**. Témoins sv4a, s8b, CP4 :
    une entrée par titre, 0 répétition. Le collecteur compte juste (une page, un titre) et la jointure passe par
    les impressions des pages : 127 / 127. **Rien n'est annulé** : les trois contrôles indépendants de l'attendu
    (concordance, titres manquants, jointure) passent, et revenir en arrière rendrait 98 entrées au lieu de 127.
    ⚠️ Le testeur peut en décider autrement. Leçon pour les attendus suivants : **un attendu s'écrit dans l'unité
    que le contrôle imprime**, pas dans celle de la mesure dont il est dérivé ;
  - **« Collapsed Stadium (Star Birth 98) »**, le seul « hors set » du troisième rejeu, **est joint** : sa page
    porte l'impression `jp` Lost Abyss 127, rattachée au produit 668245 (exp 5094) par set+numéro. C'est une
    réimpression listée sous le lien de son premier tirage : un vrai signal, et pas une carte perdue. Mesure faite
    file à l'arrêt (`file-a-l-arret.js` : 0 en cours, 0 verrou, aucune écriture depuis 39 h).
- [ ] **Corrections de la seconde relecture, AVANT le bloc 2.** Tests rouges écrits pendant la re-collecte (sans
  toucher `wikitext.js`, que chaque set rechargeait) : **28 / 37**, les 9 rouges pour la raison attendue. Code à
  écrire :
  1. un TCG ID **illisible en tête** rend l'entrée ignorée — l'index du TCG ID BRUT décide, pas celui du lisible ;
  2. seuls les **TCG ID votent** pour le jeton dominant, rendu (`jetonDominant`) et écrit dans `lectureSetlist` ;
  3. borne du nom : `^(noms)( numéro)?$`, pas `^(noms)( |$)` — « Base Set 2 87 » n'est pas un tirage de « Base Set » ;
  4. `horsSet` = **null** hors du chemin `sections-nommees` (non évalué ≠ vide, §8) ; `masquees` sur les chemins
     filtrés par gabarit (`motif`, `set-reconstruit`), null ailleurs ;
  5. `{{TCG ID` suivi d'un blanc (forme recomposée par l'épuration) lu, sur la même `RE_TCG_ID` (§21 bis) ;
  6. `natureIgnoree` : `[[Grass Energy (TCG)|…]]` et `{{TCG|Basic Grass Energy}}` sont des énergies de base ;
  7. `lectureSetlist.source` (`r2-epure` en `--reparser`, `bulbapedia` sinon) et `revid` ; le log du collecteur
     imprime « non évalué » pour un `horsSet` null.

  **ATTENDU du rejeu (nouveau parseur contre HEAD, archive R2 épurée, 54 sets), mesuré AVANT le code**
  (`m-prediction-relecture2.js`, parseur de HEAD et expressions indépendantes ; `m-ipb-recomposes.js` pour les
  lignes ouvertes) :
  - (a) TCG ID illisible en tête d'une entrée lue aujourd'hui : **0** → aucune entrée perdue ;
  - (b) 37 TCG ID recomposés dans les textes, **0 dans une entrée de Setlist**, 2 sur IPB, seul set au repli :
    « Venusaur (Bulbasaur Deck) », déjà retenu, et « Blastoise (Squirtle Deck) », hors motif. **IPB : lues 82 → 84,
    entrées 41 → 42, titres distincts 41 → 41.** Les 53 autres sets : entrées identiques ;
  - **0 titre perdu, 0 titre gagné, sur 54** ;
  - (c) hors set sur les 49 sets en `sections-nommees` : **1 → 1** (Collapsed Stadium, s11) ; jeton dominant non nul
    sur **49 / 49** ; `horsSet` null sur les **5** autres (2 `set-reconstruit` WEB et BXY, 2 `motif` MCDP et EXS,
    1 repli IPB) ;
  - (d) natures des ignorées : **inchangées** (base 28, spéciale 3, autre 0) ;
  - (e) `masquees` : **0** sur les 4 sets à chemin filtré (WEB 1 écartée, EXS 1 écartée, aucune ne porte de
    référence du set).

  Aucun effet attendu sur les données collectées, sauf IPB (+1 entrée en double, déjà dédoublonnée en titres).

  **OBTENU** — tests **37 / 37** ; **contrôle par inversion 7 / 7** (chaque correction défaite dans une copie en
  mémoire fait passer au rouge le test qui lui correspond, `m-mutations-relecture2.js`) ; rejeu
  (`m-rejeu-relecture2.js`, lancé 05:26:51 UTC) **= ATTENDU sur chaque point** :
  - 0 titre perdu, 0 gagné, 0 set dont l'écart d'entrées diffère de l'attendu, aucun chemin changé ;
  - IPB : lues 82 → 84, entrées 41 → 42, titres 41 → 41 ; lues au total 7 173 → 7 175 ;
  - hors set 1 sur 49 évalués (Collapsed Stadium, s11), null sur 5 ; jeton dominant non nul sur 49 (« Lost Abyss »
    sur s11, dont les liens seuls n'auraient pas voté) ;
  - masquées 0 sur 4 évalués ; natures energie-base 28, energie-speciale 3, autre 0.

  **TROISIÈME RELECTURE** (diff non commité contre 5f7c128), verdict : **à committer après corrections**, aucun
  Critique. Les quatre Importants ont été vérifiés contre le code (`receiving-code-review`) :
  1. `masquees` nommait un titre DÉJÀ retenu par une autre entrée (renvoi « Reprint of » vers une carte du set) →
     les titres retenus sont exclus. Test rouge, puis vert ;
  2. une ignorée à TCG ID illisible dont les notes citent `[[Lightning Energy (TCG)|…]]` était rangée
     « energie-base », or le collecteur ne signale que le reste : elle disparaissait sans un mot (§21) → nature
     `tcg-id-illisible`, testée AVANT les énergies. Test rouge, puis vert ;
  3. les trois états n'étaient testés que sur `toutes-sections`, qu'aucune ligne de table n'emprunte : deux
     contre-mutations de la relecture restaient VERTES (`horsSet = []` sur `set-reconstruit`, le repli qui ne remet
     pas les signaux à null) → 4 tests sur `set-reconstruit`, `motif`, motif puis repli, repli. **Contrôle par
     inversion : 12 / 12**, dont les deux contre-mutations ;
  4. la moitié du 4e constat de la seconde relecture, « une mesure sur des pages BRUTES », avait disparu du plan →
     **REPORTÉE, et c'est écrit** : l'épuration retire la prose, donc un rejeu sur R2 ne prédit pas ce que le repli
     lira sur la page brute. Occasion prévue, sans requête de plus : le premier set du bloc 2 qui passe par le repli
     (`lectureSetlist.source: 'bulbapedia'`) est rejoué sur son archive épurée de même `revid`, et les deux
     lectures (`lues`, `retenues`) sont comparées.

  Mineurs corrigés : 10 (trois commentaires devenus faux), 11 (la condition « page lue sur R2 » calculée une fois
  dans le collecteur, §21 bis en miniature), 12 (le log dit « jeton dominant aucun : 0 TCG ID » sur les sections
  nommées), 13 (test d'un nom coupé « Expansion » + « Pack »), 6 (le commentaire ne promet plus qu'un
  `{{ TCG ID|` entre dans la priorité). **Notés, non corrigés, avec leur occasion** :
  - 5 : `NUMERO_DE_TIRAGE = [A-Z]{0,3}` ne coupe pas `SWSH001` ni `HGSS01` et fera crier « hors set » sur les promos
    (lignes 232 à 371 de la table auto, aucune vérifiée) → mesurer les formes réelles dans l'attendu du premier
    bloc qui en contient ;
  - 7 : un jeton dominant qui n'est aucun nom attendu n'est pas signalé (VS l'est légitimement) ;
  - 8 : sur les sections nommées, la carte derrière un lien générique en tête n'est nommée nulle part ;
  - 9 : les filtres `set-reconstruit` et repli restent `( \d+)?$` (antérieur, changerait les données : mesurer
    avant).

  **ATTENDU du rejeu après ces corrections** (mesuré avant : 0 ignorée sur 31 porte un `{{TCG ID`,
  `m-ignorees-tcgid.js`) : **identique au rejeu précédent**, point par point — 0 titre perdu ou gagné, IPB 41 → 42,
  lues 7 173 → 7 175, hors set 1 sur 49 et null sur 5, jeton sur 49, masquées 0 sur 4, natures energie-base 28,
  energie-speciale 3, tcg-id-illisible 0.

  **OBTENU (05:44:25 UTC) = ATTENDU, point par point** ; tests **44 / 44**. Commit du code, puis relecture ciblée des
  corrections de la troisième relecture **avant** le bloc 2, qui écrit la base avec ce parseur.

  **QUATRIÈME RELECTURE** (ciblée, `5f7c128..ef55681`) : **« prêt pour le bloc 2 »**, aucun Important ouvert. Les
  corrections I1 à I3 sont justes, et `tcg-id-illisible` testé en premier ne range mal ni une énergie spéciale (une
  énergie en TCG ID lisible est une entrée), ni une entrée à TCG ID lisible. Trois mineurs :
  1. le début d'un TCG ID défini deux fois (`RE_TCG_ID` et `natureIgnoree`) → **corrigé** : `DEBUT_TCG_ID` unique.
     Source de `RE_TCG_ID` **identique à l'octet près** à l'ancien littéral (`m-source-re-tcg-id.js`), tests 44 / 44,
     inversion 12 / 12 : comportement inchangé par construction, pas de rejeu ;
  2. **antérieur, noté pour le lot F** : quand la colonne du nom ne porte aucune référence (`{{OBP|Darkness
     Energy|Special}}`), un TCG ID lisible des NOTES devient l'entrée (« Darkness Energy (Neo Genesis 105) »). Visible
     en `horsSet` sur les sections nommées, **silencieux sur un chemin filtré** : écarté, ni ignoré ni masqué ;
  3. la mesure sur pages brutes peut ne pas trouver son occasion au bloc 2 → **si aucun set du bloc 2 ne passe par le
     repli, elle est reportée au premier repli d'un bloc suivant, et chaque bilan de bloc dit « mesure sur page brute :
     pas d'occasion » tant qu'elle n'a pas eu lieu.** Une mesure reportée qui n'est plus rappelée disparaît.

  Rappel de la relecture : il n'existe AUCUN champ `bloc` dans la table ; le bloc 2 est la sélection de
  `collecte-massive.js:61`. Avant de collecter, le script vérifie d'abord les 20 lignes suivantes (2 requêtes).
- [ ] **Puis les 12 sets à gain — G2, DP5c, PCG6, PCG9, PBL, ASC, JTG, BRS, MEW, CRI, PAL, EVO** — 🛑 accord.
  **ATTENDU, écrit en TITRES cette fois** (mesuré sans requête le 2026-09-15 ; entrées = titres sur les 12, 0
  répétition) : G2 1 · DP5c 3 · PCG6 3 · PCG9 2 · PBL 25 · ASC 70 · JTG 32 · BRS 63 · MEW 30 · CRI 26 · PAL 49 ·
  EVO 23 = **327** ; concordance 12 / 12 ; titres manquants 0. Les jointures d'images seront rejouées depuis R2
  au lot F.

### Tâche A2 : blocs 2 à 20

- [ ] Même boucle : un bloc à la fois (`--blocs=1`), bilan comparé à l'attendu, relance.
- [ ] **Attendu par bloc :**
  - concordance sur 100 % des sets collectés ;
  - taux de jointure ≥ 0,75 par set et ≥ 0,90 par bloc pour les lignes `jp` ;
  - **pour les lignes `intl`, pas de seuil** : la référence occidentale va de 0,09 à 1. Le taux s'imprime, il ne
    décide pas.
- [ ] **Attendu sur les « à regarder » :** mesurer aux blocs 2 et 3 la part des lignes à tirage non établi qui
  échouent, ET ouvrir 3 d'entre elles, avant d'annoncer quoi que ce soit sur les 135.
- [ ] **Arrêts :**
  - `collecte-massive.js` s'arrête seul après 3 échecs de suite ;
  - un set non concordant arrête la relance au bloc suivant.
- [ ] **Bloc 2 — ATTENDU, écrit le 2026-09-15 avant le lancement** (sélection `verif && !collecte`, la même que
  `collecte-massive.js:61`, lue par `m-bloc2-lignes.js`) :
  - 20 lignes : **14 admises, toutes `jp`, 1 665 produits** — s9 127, sm4+ 125, s12 125, m4 120, s3 119, m5 118,
    sm9 118, m3 117, sm12 117, DP3 117, sm10 116, m2 116, s2 115, sm11 115 ; **6 marquées « à regarder », non
    collectées** — sI100, svM, smH, sD (tirage non établi), svD (0 entrée), DP1 (1,93) ;
  - **14 collectes, concordance 14 / 14, titres manquants 0** (sinon des liens rouges, listés) ;
  - **joints / produits ≥ 0,95 par set et ≥ 0,97 sur le bloc** : entrées = produits sur 13 lignes (1,00), DP3 à
    1,02. C'est l'ordre de grandeur du bloc 1 re-collecté (0,990, minimum 0,962), et plus haut que le seuil du plan
    (0,75 / 0,90), écrit avant le correctif Setlist ;
  - `lectureSetlist` : chemin `sections-nommees` attendu sur les 14. **Un set qui passerait par le repli est
    l'occasion de la mesure sur page brute reportée** (troisième relecture, point 4) ;
  - après le bloc : ouvrir 3 des 4 lignes à tirage non établi (tâche ci-dessus).

  **OBTENU (2026-09-15, 05:51:17 → 06:02:36 UTC)** — journal : 14 ok, 0 non concordant, 0 échec, 6 à regarder.

  | set | joints / produits | restes |
  |---|---|---|
  | s9, sm4+, s12, m4, s3, m5, sm9, sm12, m2, s2, sm11 | 1 (chacun) | — |
  | m3 | 116 / 117 = 0,991 | 1 produit sans carte, **1 produit vers plusieurs cartes** |
  | sm10 | 114 / 116 = 0,983 | 2 produits sans carte, **2 produits vers plusieurs cartes** |
  | **DP3** | **109 / 119 = 0,916 ❌** | 10 cartes sans produit, 10 produits sans carte |
  | **bloc** | **1 654 / 1 667 = 0,992** ✅ | produits 1 667, et non 1 665 : DP3 a 119 produits au catalogue, la table en attendait 117 |

  - concordance **14 / 14** ✅ ; titres manquants **0 / 14** ✅ ; chemin `sections-nommees` **14 / 14**, jeton dominant
    = nom de l'expansion sur les 14, 0 hors set, 0 ignorée → **mesure sur page brute : pas d'occasion au bloc 2** ;
  - ❌ **DP3 sous 0,95. Deux causes, écrites telles quelles** :
    1. **l'attendu était mal posé** : je l'ai écrit sans regarder que DP3 n'a **aucun produit numéroté**
       (0 / 119). La jointure y passe par le NOM, pas par le numéro. Le compte des produits numérotés figure
       désormais dans l'attendu de chaque bloc (`m-bloc-suivant.js`) ;
    2. **un vrai trou de jointure, 10 lignes ouvertes** : les 10 restes sont des **Pokémon à forme**. Bulbapedia
       nomme la carte « Burmy » (×3), « Wormadam » (×3), « Shellos » (×2), « Gastrodon » (×2) ; Cardmarket met la forme
       dans le nom du produit : « Burmy Plant Cloak Lv.10 [Wear Cloak | Plant Cloak Tackle] », « Shellos West Sea
       Lv.25 ». La clé par nom échoue avant de comparer les attaques. **Lot F**, avec la mesure du §22 : que ferait une
       clé tolérante à la forme sur les 1 223 jointures par nom qui marchent ?
  - 🔴 **NON PRÉDIT : 3 JOINTURES FAUSSES, CONCORDANTES** (sm10 ×2, m3 ×1). La Setlist dit « Kingler (Double Blaze 27) » ;
    la page vers laquelle ce titre redirige porte l'impression `jp` Double Blaze **026**. La clé `set+numero`
    (`jointure.js:131-133`) **ne compare pas le nom** : elle joint le produit 026, **Krabby**, à Kingler, et le vrai
    Kingler 027 reste sans carte. Même motif, décalé de 1, pour Dust Island → 557447 **Martial Arts Dojo**, et Wondrous
    Patch → 868113 **Poké Pad**. Le reste `produit-vers-plusieurs-cartes` était bien écrit, mais il ne décidait de rien :
    ni la concordance, ni le « ok » du journal. **Je ne l'ai vu qu'en ouvrant les restes numérotés.**
    **Étendue, mesurée sur toute la base** (`m-produits-plusieurs-cartes.js`, deux sources) : **9 357** lignes de
    jointure, dont **112** avec un nom de carte ≠ nom du produit, dont 111 par `set+numero`. Ligne par ligne :
    - **71 sont justes** : 26 notations d'énergie (« Speed [L] Energy »), 22 traductions ou notations Cardmarket (« Retry
      Badge » / « Backtrack Badge », « Gladion's Showdown » / « Gladion's Final Battle », « Nidoran [F] δ », « EXP. ALL »
      par alias…), et **23 Méga ou Primal-EX**. Ces
      dernières sont **vérifiées sur les 15 cartes** (`m-mega-titres.js`) : titre « M Lucario-EX (Furious Fists 55) »,
      stade `MegaEX`. ⚠️ Mais leur `nomEn` vaut « Lucario » : le site afficherait le nom du Pokémon de base pour une
      carte Méga. **Défaut du champ nom, lot F** ;
    - 34 sont des variantes d'écriture (TM, lettres grecques, ♀/♂, δ) ;
    - **6 sont FAUSSES** : un produit joint à la carte d'un autre nom qui a déjà sa propre carte — les 3 du bloc 2,
      Zubat ← Golbat (exp 3984), Sableye ← Shroodle (exp 5519), et Pokémon Reversal ← Energy Restore (EC1, déjà
      nommé au §24) ;
    - 1 est incertaine : « Power Charge » ← « Energy Charge » (exp 5021).

    **6 fausses sur 7 616 par numéro.** Chacune laisse aussi un produit orphelin. **Non corrigé, et c'est une
    décision** : la correction touche la clé de jointure, et la seule forme sûre (« parmi plusieurs cartes, garder
    celle dont le nom concorde ») doit d'abord être mesurée sur ce qui marche (§22). ⚠️ Et une re-jointure devra
    SUPPRIMER les lignes fausses : `collecteur-texte.js:294` ne fait que des upserts.
  - 🔴 **NON PRÉDIT : LA SÉLECTION SE BOUCHAIT.** Une ligne « à regarder » n'était jamais marquée dans le fichier
    (`continue` avant l'écriture) : resélectionnée à chaque lancement. Le bloc 2 portait les 4 du bloc 1 et n'a eu que
    **14 lignes nouvelles** ; le bloc 3 en aurait eu 10 ; à 20 lignes à regarder cumulées, chaque lancement aurait
    collecté **0 set** avec un bilan d'apparence normale. Corrigé (`marquer`, une écriture pour les deux branches) ;
    le journal imprime aussi joints/produits, les restes et un ⚠️ « produit(s) joint(s) à plusieurs cartes ».

- [ ] **Bloc 3 — ATTENDU, écrit avant le lancement** (`m-bloc-suivant.js`, même sélection que le script) :
  - 20 lignes : **10 à regarder**, dont les 6 déjà vues au bloc 2 et 4 nouvelles (sv1S 2,26, sv1V 2,39, sv5M 2,18,
    sv5K 2,18) → **marquées cette fois** ; **10 admises, toutes `jp`, 1 048 produits, 1 048 numérotés** — sm7 112,
    sm8 111, WCP 108, PCG4 106, XY3 105, sv1a 103, CP6 103, s6a 101, Pt3 100, s10a 99 ;
  - avant la collecte, le script vérifie 20 lignes de plus (2 requêtes) ;
  - **10 collectes, concordance 10 / 10, titres manquants 0, joints / produits ≥ 0,95 par set** (tous numérotés) et
    **≥ 0,97 sur le bloc** ;
  - **produits vers plusieurs cartes : 0 à 2** — le taux de la base (6 sur 7 616) donne 0,8 sur 1 048 ;
  - **preuve du correctif de sélection** : la table passe de **30 à 50** lignes marquées, et la sélection suivante ne
    contient **aucune** des 10 lignes à regarder ;
  - mesure sur page brute : attendue sans occasion (10 sets à section attendus) ;
  - après le bloc : ouvrir 3 des lignes à tirage non établi (demande des requêtes, donc hors collecte).
  - **Compléments de la cinquième relecture** (ciblée sur `collecte-massive.js`, verdict « prêt après une correction ») :
    en-tête du journal `bloc 1 : 20 lignes (10 admises, 10 à regarder)` (le compteur repart à 1 à chaque lancement) ;
    lignes vérifiées **60 → 80** (rangs 60 à 79, placés après la sélection, qui ne bouge pas) ; **0 marque `echec-…`** ;
    sélection suivante = rangs 50 à 69 (EBB, sv2D, sv2P, XY4, XY7, sv5a, Pt1, sv4M, s6h, s3a, sv7a, sv6a, s11a, s9a,
    sv3a, IFDS, m1S, m1L, XY6, s5I), **aucune des 20 lignes marquées**. Ces comptes ne tiennent que si la boucle va au
    bout.

  **CINQUIÈME RELECTURE**, les points vérifiés contre le code :
  - (A) le marquage des « à regarder » est juste. Pas de course : `marquer` relit puis écrit sans `await` entre les
    deux. Pas de `code` en double sur 398 lignes ;
  - (B) l'affichage des restes est juste ;
  - **bloquant, antérieur au diff, corrigé** : sur Ctrl+C, `collecteur-texte.js:288` sort avec le code 0 avant la
    jointure. `collecte-massive.js` le rangeait en `echec-0-…` et le marquait : **jamais repris** (§21 n°3). Il sort
    désormais de la boucle **sans marquer** ;
  - mineurs corrigés : l'écriture de la table est atomique (fichier temporaire puis renommage) ; une ligne introuvable à
    la relecture est signalée ; `produitsVersPlusieursCartes` est initialisé à 0 et cumulé ; sur un échec, les chiffres
    d'une collecte ANTÉRIEURE ne sont plus imprimés comme frais ;
  - noté, non corrigé : un `verifier-table.js --auto` lancé **à la main** pendant la boucle réécrit toute la table depuis
    sa copie de départ et effacerait les marques posées entre-temps. **Ne pas le lancer pendant une collecte massive.**
  - Ces corrections suivent la description de la relecture ; **elles n'ont pas été relues une seconde fois.** Le chemin
    d'interruption n'est pas exercé par un lancement normal.
- [ ] ⚠️ **Limite connue :** le texte tourne sur ce poste. S'il s'éteint, la collecte s'arrête. Elle reprend là où
  elle en était : la colonne `collecte` est écrite ligne par ligne.

### Tâche A3 : commit de l'état de la table

- [ ] Après chaque bloc : `git add collecte-cartes/table-sets-auto.json`, puis un commit « table : bloc N vérifié et
  collecté (x admises, y à regarder) ». **Pas de push sans demande nommée.**

---

## Lot B : le code commun aux deux workers (aucune requête)

Condition : 🛑1 (D1, D4). **Symétrie** : la boucle de file existe aujourd'hui dans `collecteur-images.js:465-495`.
La copier dans `collecteur-images-bulba.js` ferait deux exemplaires d'une même règle (§21 bis).

### Tâche B1 : `collecte-cartes/boucle-file.js`, une seule boucle de worker

**Fichiers :** créer `collecte-cartes/boucle-file.js` et `test-boucle-file.js`.

**Interfaces :**
- Produit :

```js
/** @returns {Promise<{motif: 'arret-demande'|'verrou-non-repris'|'verrou-non-tenu'|string}>} */
async function bouclerSurFile({
    File,                  // modèle mongoose de la file (file_images, file_images_bulbapedia)
    verrouGlobal,          // objet de verrou-source.js : prendre, tient, rendre, tenu, perdu
    reprendreVerrou,       // () => Promise<boolean> : attend puis reprend le verrou global ; false = arrêt
    reprendreEnCoursFiges, // () => Promise<number>
    collecterSet,          // (entree) => Promise<{ etat: string }> ; entree = document de la file, portant `ligne` (D1b)
    ceder = async () => null, // () => Promise<string|null> : motif de céder la source (D3), null sinon
    arret,                 // () => boolean
    dormir,                // (ms) => Promise<void>, interrompable
    sommeilMs = 600000, cederMs = 60000
}) { /* … */ }
const etatDeFile = resultat => resultat === 'verifie' ? 'fait'
    : /^(interrompu|refuse-verrou|refuse-texte-en-cours)$/.test(resultat) ? 'attente' : 'refuse';
module.exports = { bouclerSurFile, etatDeFile };
```

- [ ] **Étape 1 : écrire les tests, en rouge.** Modèle `File` en mémoire (findOneAndUpdate trié par `ordre`,
  updateOne) et faux verrou qui journalise ses appels. Cas :
  1. file vide : `rendre` est appelé AVANT `dormir(sommeilMs)`, et `tenu === false` pendant le sommeil ;
  2. au réveil, `reprendreVerrou` est appelé AVANT tout `findOneAndUpdate` ;
  3. entrée `attente` : elle passe à `en-cours` + `pris`, puis `collecterSet(entree)` reçoit le document entier,
     `ligne` comprise ;
  4. résultat `verifie` : `fait` + `fini` ; `refuse-resolution` : `refuse` + `fini` ;
  5. résultat `interrompu` : `attente`, `pris` retiré, la boucle RETOURNE (Render relance) ;
  6. `tient()` rend false : retour `verrou-non-tenu` SANS prendre d'entrée ;
  7. `ceder()` rend un motif : `rendre` puis `dormir(cederMs)`, AUCUNE entrée prise, pas de `tient()` avant ;
  8. `arret()` vrai : retour `arret-demande` sans prendre d'entrée ;
  9. `etatDeFile` sur les six résultats connus.
- [ ] **Étape 2 :** `node test-boucle-file.js`. Attendu : échec au `require`, le module n'existe pas.
- [ ] **Étape 3 :** écrire `boucle-file.js`, déplacé depuis `collecteur-images.js:465-495` sans changer son sens,
  plus `ceder`.
- [ ] **Étape 4 :** `node test-boucle-file.js`, attendu **9/9** ; `node test-verrou-source.js`, attendu **21/21**.

### Tâche B2 : le worker artofpkm sur `boucle-file.js`, et l'entrée qui porte sa ligne (D1b)

**Fichiers :** modifier `collecteur-images.js` : la boucle (465-495), `collecterSet` (146-160) et `--enfiler`
(448-454).

- [ ] **Code :**
  - `collecterSet(entree, M, dossierRapport)` : `L = entree.ligne ?? ligneDeTable(entree._id)` et
    `S = entree.sourceImages ?? sourceDe(entree._id, SOURCE)` ;
  - l'appel manuel `--sets=` passe `{ _id: code }`.
- [ ] **`--enfiler`, la leçon du §23** (`$setOnInsert` qui imprimait « enfilé » sans rien faire) :
  - `$set: { ligne, sourceImages }` + `$setOnInsert: { ordre, etat: 'attente', ajouteLe }` ;
  - imprime **par code** : `inséré`, ou `ligne rafraîchie, état <X> conservé` ;
  - **ne remet jamais** un `refuse` ou un `fait` en attente sans `--remettre`, qui écrit `remisEnFileLe` et
    `remisEnFileMotif`.
- [ ] **Test :** cas 3 de B1, plus un test pur de `resoudreEntree(entree, { ligneDeTable, sourceDe })` : la ligne
  portée l'emporte, sinon la table.
- [ ] **Attendu après redéploiement :** les journaux Render d'un set japonais déjà en file sont identiques en
  forme (`liste … page 1`, mesures, originaux, complétude) ; `file_images` a les mêmes transitions ; 0 erreur au
  démarrage.

### Tâche B3 : `file-a-l-arret.js`, symétrie

- [ ] Il lit aussi `file_images_bulbapedia` (en-cours, attente, tous états).
- [ ] Les verrous globaux se reconnaissent par `/\/__\w+__$/`, et non plus `/__collecteur__$/` seul : le document
  `bulbapedia/__priorite-texte__` (D3) serait sinon lu comme une écriture de set, exactement le faux cri du
  2026-09-13.

### Tâche B4 : relecture, puis commit

- [ ] `requesting-code-review` sur la plage B1..B3, avec les exigences de verrou du §1 et les décisions écrites
  (divergence 3).
- [ ] Commit, fichiers nommés : `collecte-cartes/boucle-file.js`, `test-boucle-file.js`, `collecteur-images.js`,
  `file-a-l-arret.js`.
- [ ] 🛑2 : **push sur demande nommée**, puis redéploiement du worker artofpkm par le testeur.

---

## 🔑 RÈGLE DU 2026-09-15, DÉCISION DU TESTEUR : LE WORKER NE DORT JAMAIS TANT QU'IL RESTE UN SET COLLECTÉ

**Un set dont le texte est concordant part en file d'images IMMÉDIATEMENT** : sans attendre la fin du bloc, sans
attendre l'accord du testeur. C'est une autorisation durable d'écrire dans `file_images`, donnée le 2026-09-15, et la
seule façon que les deux collectes avancent en parallèle. Les images sont le goulot (~70 h en série) : chaque heure
où le worker dort est perdue. **Le 2026-09-14 au soir, 30 sets avaient leur texte et le worker dormait, file vide.**

**Ce qui l'empêchait, et comment c'est levé** :
- le worker trouvait la source d'un set dans `sources-sets.js`, écrite à la main pour 28 sets. Une ligne automatique
  finissait en `refuse-source`, hors de la file POUR TOUJOURS (§23). Enfiler avant d'avoir levé ce point aurait
  produit 30 refus définitifs ;
- `collecte-cartes/preparer-images-auto.js` : `--lister` (1 requête, **419 sets** = attendu), `--correspondre`
  (0 requête : **152 uniques**, 2 ambiguës, 78 absentes, sur 232 lignes auto non occidentales). La correspondance est
  générée dans `sources-sets-auto.json`, que `sourceDe` lit après la table à la main. **Un seul déploiement couvre
  toutes les lignes à venir.** Cela tranche D1 autrement que (a) et (b) : ni redéploiement par bloc, ni refonte
  du worker ;
- sur les 30 sets collectés : **27 uniques** ; sv8 (« Electric Breaker », 551) et CP4 (« Premium Champion Pack EX x M
  x BREAK », 531) sont ajoutés **à la main**, avec leur note ; **sm12a « Tag All Stars » n'a aucun set chez artofpkm**,
  il n'est pas enfilé ;
- `--mesurer` écrit liste et mesures **dans l'état du worker**, qui les reprend sans requête.

**⚠️ CONFLIT À TRANCHER PAR LE TESTEUR — la mesure avant d'enfiler, en régime continu.** Pour ce premier lot, les
3 cartes par set sont mesurées d'ici avant d'enfiler, comme demandé. En continu, mesurer d'ici demande le verrou global
artofpkm, que le worker **tient pendant qu'il collecte** : la mesure attendrait la fin de son set en cours, parfois une
heure. **Proposition** : en continu, on enfile tout de suite, et c'est le worker qui mesure. Il le fait déjà en
premier geste (`collecteur-images.js:184-196` : 3 originaux, puis refus sous 480 px avant tout téléchargement), et
le refus est listé dans `file_images` (`resultat: 'refuse-resolution'`). La mesure a lieu avant le téléchargement
dans les deux cas ; seul change qui la fait.

**🔴 ET LA MESURE A TROUVÉ LA RÉPONSE DU §21 N°7 : LES LISTES ARTOFPKM S'ARRÊTAIENT À 100.** « page 2 : 100 lues, 0 nouvelles »
sur sv4a, s4a, s8b et s12a : **le serveur ignore `?page=`.** La suite se charge par un cadre Turbo
(`/sets/{id}/card_batches?offset=100`). `listerSet` le suit désormais, lot par lot : sv4a passe de **100 à 482
entrées en 5 lots**, et s'arrête seul. Les 4 listes tronquées écrites à 10:35 UTC sont retirées de l'état (mesures
gardées). ⚠️ **EC1, N4, VS et DP2 sont toujours tronqués à 100** (relus le 2026-09-14 avec l'ancien code) : après le
redéploiement, retirer leurs listes de l'état et les remettre en file. Le worker reprend au premier n sans image.
⚠️ Correction non passée par l'agent relecteur, à cause de la limite d'usage. Ce qui la prouve : le relevé lot par
lot de sv4a et l'avertissement « compte rond » ajouté à la fin de la liste.

**Reste à faire** : 🛑 **push nommé** de `artofpkm.js`, `sources-sets.js`, `sources-sets-auto.json`, `artofpkm-sets.json` et
`preparer-images-auto.js`, puis redéploiement du worker par le testeur. **Enfiler AVANT le redéploiement produirait
les refus définitifs du §23.** Ensuite : enfiler les 29 sets, et `collecte-massive.js` enfile chaque set « ok » qui
a une source.

## Lot C : les images japonaises des lignes automatiques (artofpkm, worker existant)

Conditions : lot B déployé, 🛑1 (D5).

### Tâche C1 : la liste des sets artofpkm, 1 requête

- [ ] `collecte-cartes/lister-sets-artofpkm.js` :
  - prend `artofpkm/__collecteur__` **sans attendre** ; tenu = refus, qui dit par qui ;
  - fait `GET https://www.artofpkm.com/cards` (SPEC-COLLECTE-IMAGES §1 : une tuile par set,
    `<a class="… set" href="/sets/{id}">…<h4>NOM</h4></a>`) ;
  - écrit `collecte-cartes/artofpkm-sets.json`, puis rend le verrou.
- [ ] **Attendu :** **419 sets**, le compte de la spec au 2026-09-12. Autre chose : on relit le balisage avant de
  croire le compte (un compte rond est un signal, §21 n°7).

### Tâche C2 : la correspondance ligne → set artofpkm, 0 requête

- [ ] `collecte-cartes/generer-sources-auto.js` : égalité de nom normalisé entre le set artofpkm et {`nom`
  Cardmarket, `bulba.expansion`, `auto.nomBulbapedia`}. Unique : `sourceImages: { source: 'artofpkm', ids, noms,
  cle }` dans la ligne. Ambigu ou absent : liste à la main, jamais deviné.
- [ ] **Attendu, prédiction sur les 16 admises du bloc 1 :** **≥ 14 uniques**. En dessous, le nom n'est pas la bonne
  clé : on ouvre 3 échecs avant d'en choisir une autre (§22).

### Tâche C3 : enfiler les images d'un bloc dès que son texte est en base

- [ ] `node collecteur-images.js --enfiler=<codes du bloc, admis et collectés>`, chaque entrée portant `ligne` et
  `sourceImages`.
- [ ] **Attendu par set**, complétude du collecteur :
  - largeur médiane ≥ 480 (vintage mesuré à 593) ;
  - cartes avec image / cartes du set ≥ 0,90, soit la référence des 28 sets (94,3 %) moins une marge.

  Un set sous 480 est refusé par le collecteur lui-même et **listé** ici.
- [ ] Débit : ~50 000 requêtes, ~70 h en série, pour tout le japonais 2004→2026 (spec §6). C'est le vrai goulot des
  images japonaises, et il tourne sans nous.

---

## Lot D : les images Bulbapedia sur le worker Render

Conditions : lot B déployé, 🛑1 (D2, D3).

### Tâche D1 : `collecteur-images-bulba.js --boucle`

**Fichiers :** modifier `collecteur-images-bulba.js`.

- [ ] File propre à la source : **nouvelle collection `file_images_bulbapedia`**, même forme que `file_images`.
  Elle est séparée parce que le worker artofpkm DÉPLOYÉ prend toute entrée `attente` de `file_images` : il
  refuserait une entrée Bulbapedia et la sortirait de la file.
- [ ] `--boucle` : `bouclerSurFile` (B1), verrou global `bulbapedia/__collecteur__` en ATTENTE et non en sortie
  (§17), `ceder` = D3.
- [ ] `--enfiler=` : même forme que B2, `ligne` portée.
- [ ] Le contrôle « un verrou de TEXTE frais : arrêt » (ligne 253) disparaît : le texte prend désormais le verrou
  global (c8c2ad8). ⚠️ À confirmer par la relecture.

### Tâche D2 : la priorité du texte (D3b)

**Fichiers :** modifier `collecte-massive.js` et `collecteur-images-bulba.js`.

- [ ] `collecte-massive.js` prend `bulbapedia/__priorite-texte__` par `fabriquerVerrou` (durée 3 min) au démarrage
  et le rend en sortie. S'il est tenu, refus : deux collectes massives ne tournent pas ensemble.
- [ ] `ceder()` côté images : ce document a un `verrou.depuis` de moins de 3 min, d'où le motif « la collecte de
  texte a priorité ».
- [ ] **Tests en mémoire :** priorité fraîche, la boucle cède sans prendre d'entrée ; priorité périmée, la boucle
  reprend ; priorité rendue, la boucle reprend au tour suivant.

### Tâche D3 : relecture, commit, mise en service

- [ ] `requesting-code-review` sur D1 et D2. Commit, fichiers nommés.
- [ ] 🛑3 : push nommé ; le testeur crée le service Render (D2c) avec les mêmes variables que le worker artofpkm.

### Tâche D4 : les 9 sets occidentaux déjà en texte

- [ ] **Attendu, depuis `--plan` du 2026-09-14 vers 19:16 UTC (0 requête) :**
  - 10 sets, **1 221 fichiers sur 1 319 impressions** ;
  - **TR n'est pas enfilé** : médiane mesurée 350 < 480, refus déjà connu ;
  - reste **1 153 fichiers**, ≈ 24 imageinfo + 1 153 téléchargements ≈ **98 min** à 5 s.

| set | impressions | à collecter | écartés |
|---|---|---|---|
| PBL | 95 | 95 | 0 |
| ASC | 225 | 147 | 78 (22 set-voisin, 56 absent) |
| xASC | 12 | 10 | 2 |
| JTG | 158 | 158 | 0 |
| BRS | 153 | 153 | 0 |
| MEW | 177 | 174 | 3 (2 conflit, 1 ambigu) |
| CRI | 96 | 96 | 0 |
| PAL | 230 | 230 | 0 |
| EVO | 90 | 90 | 0 |

- [ ] **PBL en premier et seul.** Attendu : **95 images ok = 95 à collecter**, concordance ✅, 76 cartes couvertes
  sur 76, médiane ≥ 480. Obtenu ≠ attendu : on n'enfile pas la suite.
- [ ] Puis les 8 autres. Attendu pour chacun : concordance ✅, images ok = à collecter au-dessus du seuil.
- [ ] Les lignes `intl` du lot A s'enfilent bloc par bloc dès que leur texte est en base.

---

## Lot E : les 215 lignes à la main

- [ ] **E1 :** liste triée par produits décroissants, 0 requête, sans les expansions chinoises (§28 : `151C`,
  `CBB*C`, promos `/CS` `/CT` `/ID` `/TH`, `PKMTCH`). Les **124 decks de moins de 30 produits en dernier**.
- [ ] **E2 :** par lots de 10, au fil de la collecte automatique. Chaque ligne est vérifiée par `verifier-table.js`
  avant son admission.
- [ ] 🛑4 : **rythme mesuré sur le premier lot de 10**, donc un calendrier chiffré. Pas d'estimation avant.

## Lot F : la fin, depuis R2 et en une fois

- [ ] **7 jointures :** G1, 6 homonymes ; EC1 n°059, deux cartes au même numéro sur la page du set.
- [ ] **11 orphelines de DP5c :** 3 formes de Castform, 8 énergies de base.
- [ ] **Pagination d'EC1, N4, VS et DP2 :** tranchée par le N de `liste 150 page 2 : N entrées lues` (journaux
  Render, lu par le testeur), ou par `pagesListe` pour tout set relu après le déploiement de 0818ae9.
- [ ] **Les lignes « à regarder » du lot A**, à commencer par les 4 decks du bloc 1.

## Hors plan

- **Le chinois** (§28) : énumération par les pages « (ATCG) », un chantier distinct.

---

## Journal d'exécution (UTC)

- 2026-09-14 19:09:08 : bloc 1 vérifié, 16/20, 2 requêtes.
- 2026-09-14 19:13:02 : `collecte-massive.js --blocs=1` lancé.
- 2026-09-14 ~19:14 : référence des 38 sets (lecture seule).
- 2026-09-14 ~19:16 : `collecteur-images-bulba.js --plan`, 0 requête, attendus du lot D. Relecture de 3fa202d..0818ae9
  lancée en arrière-plan (requesting-code-review).
- 2026-09-14 19:17 → 19:20 : attendus du lot A écrits dans ce fichier, avant la lecture de tout journal de set.
