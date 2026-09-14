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
- [ ] **Re-vérification des blocs 1 et 2** (4 requêtes) : les rapports entrées / produits changent, et une ligne
  proche de 1,5 peut sortir des bornes.
- [ ] **Re-collecte du bloc 1** (`collecteur-texte.js --set=…`, les titres ajoutés sont fetchés seuls). **ATTENDU :**
  - concordance 16 / 16 ;
  - **titres manquants = 0**, sinon ce sont des liens rouges, à lister ;
  - joints / produits ≥ 0,95 sur chacun des 15 sets à section : produits = gabarits sur 14 d'entre eux, moins
    8 énergies sur s8b et s12a ;
  - BXY à part : 0 gabarit dans sa section, restes non expliqués par ce défaut.
- [ ] **Puis les 10 sets occidentaux et G2, DP5c, PCG6, PCG9**, même attendu. Les jointures d'images seront
  rejouées depuis R2 au lot F.

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
