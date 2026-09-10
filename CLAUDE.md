# Notes du chantier — règles de travail dans ce dépôt

Ce fichier est chargé au début de chaque session. Ce qui est écrit ici ne se
renégocie pas en cours de route.

---

## 0. Ce qu'il faut savoir avant de citer un taux d'avancement — 2026-09-09

**🔴 UN TAUX DE VERDICTS FERMES AGRÉGÉ SUR TOUS LES BUILDS EST UN ARTEFACT.** Les lignes
anciennes sont fermes parce que les réserves n'existaient pas encore, pas parce que la chaîne
était meilleure. Mesuré sur les 128 lignes jugeables :

| build | date | lignes | fermes |
|---|---|---|---|
| `b3cb941af7a1` | 04/08 | 25 | **14** |
| `7ba621d7c737` | 08/08 | 39 | 4 |
| `21a809855af4` | 06/09 | 14 | **0** |
| `93c19645143d` | 08/09 | 28 | 3 |

Le journal dit **ce que le build du jour a rendu** ; le banc rejoue **les règles
d'aujourd'hui**. Quand les deux divergent, aucun des deux n'a tort — ils ne parlent pas du
même code. **Seul le build courant compte pour un taux d'avancement, et il est aujourd'hui
trop petit pour en porter un** (3 fermes sur 28).

**🔑 L'UNITÉ DU PRODUIT EST 67,0 %, PAS 18,0 %.** Ce sont deux mesures différentes et il ne
faut jamais citer l'une pour l'autre. **18,0 %** = verdicts fermes ET justes. **67,0 %** = la
vérité est MONTRÉE à l'utilisateur — parce que sous réserve la route affiche **trois**
candidats. Sur le seau lot, 112 lignes à vérité (banc, bloc « où tombe la vérité ») :

| | n | % |
|---|---|---|
| position 1, le gagnant | 68 | 60,7 % |
| **position 2 ou 3 — montrée quand même** | **7** | **6,3 %** |
| **hors des trois** | 14 | 12,5 % |
| refus, rien montré | 23 | 20,5 % |

**L'affichage des trois candidats rattrape 7 lignes** que le verdict seul perdait.

⚠️ **LES 14 HORS DES TROIS SE COUPENT EN DEUX, ET SEULE UNE MOITIÉ EST ATTEIGNABLE** : **7
hors vivier** — aucun classement ne les sauvera, il faut le périmètre — et 7 dans le vivier
mais mal classées.

🔴 **ET C'EST UN REJEU, PAS UNE OBSERVATION.** `candidatsRendus` n'existe au journal que
depuis le 2026-09-09 : le bloc dit ce que le code d'AUJOURD'HUI montrerait, pas ce que
l'utilisateur a vu. Le bloc l'imprime lui-même à chaque exécution.

**LE PLAFOND DE LA VOIE « PLUS DE CLÉS » EST 62,5 %.** Production, 128 jugeables : 26 fermes
dont **23 justes (18,0 %)**, 79 sous réserve dont 57 justes, 23 refus. Même si TOUTE réserve
juste devenait ferme, on plafonne à 80/128 = **62,5 %**. **Les 80 % ne s'atteignent pas en
ajoutant des clés** — il faut soit rendre justes des lignes qui ne le sont pas, soit rouvrir
un arbitrage.

**ET LE PLUS GROS BLOC DE RÉSERVE N'EST PAS UN DÉFAUT.** `perimetre-vintage-suggestion` tient
**32 lignes sur 128 (25 %), dont 21 justes**. C'est un ARBITRAGE ÉCRIT (index.js:5094) : « le
périmètre restreint sans prouver, sa sortie est une suggestion, pas un verdict ». Il ne se
corrige pas, **il se rouvre par décision** — et le prix de cette décision est mesuré au §9.

⚠️ **Avant de comparer un taux avec quelqu'un d'autre, comparez les DÉNOMINATEURS.** Le
2026-09-09, deux agents annonçaient 118, 128 et 139 pour « les vérités ». Trois filtres les
séparent, et ils ne se devinent pas : les lignes HORS SERVICE sont-elles exclues ? le
DÉDOUBLONNAGE est-il appliqué (17 lignes masquées portent l'identité d'une ligne gardée, donc
« ont » une vérité si on ne dédoublonne pas : 128 avec, 145 sans) ? les vérités non
numériques (`inconnu`, `hors-perimetre`) sont-elles comptées ? **Un taux dont on ne sait pas
lequel des trois filtres il applique n'est comparable à rien.**

---

## 1. Plus jamais `git add -A`

Les fichiers sont **nommés, un par un**, à chaque commit.

**L'occurrence, le 2026-08-19.** Un `git add -A` a emporté `banc-verites.json` dans
`d7c5656` — un commit qui parlait du webhook Stripe — alors que la saisie des vérités
du holdout était **en cours** dans une autre fenêtre. Deux vérités (Spearow H001,
Growlithe H002) se sont retrouvées dans un commit qui n'a rien à voir avec elles.

⚠️ **Et le remède était pire que le mal** : un `git reset` sur ce chemin se serait
exécuté pendant que `saisir-verites.js` tenait le fichier ouvert et le réécrivait
entièrement à chaque entrée. Un commit mal rangé ne coûte rien ; une saisie perdue coûte
une heure. Le commit a été laissé tel quel.

`git add -A` n'est pas un raccourci, c'est une décision prise à l'aveugle sur un état de
travail qu'on n'a pas regardé.

---

## 2. `banc-verites.json` ne m'appartient pas

**Je ne l'ajoute pas à un commit. Je ne le réinitialise pas. Je ne le lis pas pendant
une saisie.**

C'est le **seul fichier du dépôt qu'un processus interactif réécrit pendant que je
travaille** : `saisir-verites.js` ouvre un `readline`, attend une URL Cardmarket, et
réécrit le fichier **entier** à chaque entrée (`ecrireVerites`, ligne 64). Toute
lecture pendant ce temps peut tomber sur un état intermédiaire ; toute écriture écrase
un travail humain en cours.

### Les autres fichiers écrits par un outil — et pourquoi aucun n'est dans le même cas

| fichier | écrit par | interactif ? |
|---|---|---|
| `banc-verites.json` | `saisir-verites.js` | 🔴 **OUI** — readline, réécriture complète à chaque entrée |
| `verrou/charges.json` | `verrou-charges.js` | non — je le lance moi-même, il rend la main |
| `verrou/tcgdex.json` | `verrou/enregistreur.js` | non — idem, via `verrou-charges.js` |
| `verrou/couverture-plancher.json` | `couverture-index.js --poser-plancher` | non |
| `pokedex-dexids.json` | `construire-table-pokedex.js` | non — one-shot |
| `backup-*/` | `backup-collections.js` | non — et le dossier est dans `.gitignore` |

**`banc-lots.json` et `banc-verification.json` : aucun outil ne les écrit.** Ils sont
tenus **à la main** par le testeur — une fenêtre de lot qu'on ouvre et qu'on referme,
une carte qu'on déclare en vérification avant de la scanner. Pas de course possible,
donc, mais la même règle de propriété : ce sont ses décisions de méthode, pas les
miennes. Je ne les modifie que sur demande explicite, et jamais au passage.

---

## 3. Ce qui vaut pour tout le reste

- **Base de production : `test`.** Ce n'est pas un nom de bac à sable, c'est le piège.
  Le bac est `test_scratch`, et tout script qui écrit doit nommer sa base et **refuser**
  de tourner ailleurs.
- **Tout outil qui fait écrire une collection la vide en sortant.** Une collection
  oubliée ne salit pas seulement le bac : elle rend l'outil **non reproductible**, et un
  contrôle dont le résultat dépend du nombre de fois qu'on l'a lancé ne vaut pas mieux
  que pas de contrôle. (Le compteur `remboursements` a fait mentir une assertion du
  verrou pendant six jours pour cette raison.)
- **🔑 TOUT OUTIL DE MESURE IMPRIME SON DÉNOMINATEUR, SANS EXCEPTION.** Avant tout
  pourcentage sur le journal, on imprime **sur combien de lignes le champ existe**.
  Un taux dont le dénominateur n'a pas été affiché n'est pas encore une mesure.

  **L'erreur #8 a été commise QUATRE FOIS en une semaine**, dont deux par celui qui
  venait de citer l'entrée du catalogue : « vivier vide 91,4 % des refus » (champ présent
  sur 3 lignes sur 35) et « seuls 33,1 % des scans ont un prix guide » — celle-là
  **annoncée au testeur**, puis démentie : `prixGuideRetenu` n'existe que depuis le
  2026-08-12 et il est rempli **59 fois sur 59** sur les lignes qui le portent. Le
  « trou » de 66,9 % était l'âge du champ, et cette conclusion allait orienter un chantier.

  ⚠️ Connaître la parade ne suffit pas, et la citer non plus. Ce qui marche est
  **mécanique** : le dénominateur s'imprime, il ne se sous-entend pas. Sur un journal qui
  a une HISTOIRE, `undefined` n'est ni `0`, ni `false`, ni « absent du monde ».

- **Aucune écriture en base sans accord explicite** — le testeur fait sa sauvegarde
  avec `backup-collections.js` avant, et il la lance lui-même.
  ⚠️ **Par défaut il ne sauvegarde QUE `numeros_cartes,codes_set`** — deux collections
  sur douze, ~11,7 Mo sur 473. C'est le bon défaut pour ce qu'il protégeait à l'origine
  (les tables APPRISES, seules non régénérables), et un piège pour tout autre usage :
  `--collections=` est obligatoire dès qu'on sauvegarde autre chose.
- **Jamais `Get-Content -Raw` / `Set-Content` de PowerShell sur un fichier source** :
  double encodage UTF-8 garanti. Les outils d'édition, ou rien.
- **Jamais `node -e` avec des guillemets sous PowerShell** : on écrit un `.js`.
- **git n'est pas dans le PATH.** Il se trouve sous
  `AppData\Local\GitHubDesktop\app-*\resources\app\git\cmd\git.exe`.
  🔑 **LE PUSH N'EST JAMAIS UN GESTE DE FIN DE TOUR.** Il se fait **sur demande explicite,
  qui NOMME le commit** — jamais parce que le travail est fini, jamais « pendant qu'on y
  est », jamais par lot.
  ⚠️ **ET LA RAISON N'EST PAS UNE LIMITE D'ACCÈS — c'est le RAYON D'ACTION.** Les
  identifiants sont là et `git push` fonctionne : ce texte disait « je ne peux pas pousser »
  et c'était faux, corrigé le 2026-09-10 après un push réussi. Ce qui tient, c'est la règle,
  et elle tient pour une raison mesurable : **un lot poussé sans décision rend le diagnostic
  lent quand quelque chose casse.** Quatre commits partis ensemble, c'est quatre suspects et
  aucun ordre entre eux ; un commit nommé et poussé seul se défait en une ligne. Le coût
  d'attendre une demande est nul, le coût de ne pas l'avoir attendue se paie le jour où la
  production tombe.
  🔑 **CE QUI EST ATTENDU, ÉCRIT PARCE QUE ÇA A ÉTÉ FAIT** : le 2026-09-10, trois commits
  étaient prêts et les identifiants disponibles ; rien n'est parti avant que le testeur
  nomme `dbff46f`. **C'est exactement le comportement voulu** — la capacité ne déclenche pas
  le geste, la demande le déclenche.
  ⚠️ **Ne JAMAIS écrire ce chemin en dur avec un numéro de version.** GitHub Desktop se
  met à jour tout seul et le dossier change : `app-3.6.3` a disparu le 2026-09-03 au
  profit de `app-3.6.5`, et deux commandes du dépôt ont cassé d'un coup. On le résout à
  chaque fois, en prenant la version la plus récente :
  ```powershell
  $g = (Get-ChildItem "$env:LOCALAPPDATA\GitHubDesktop" -Filter 'app-*' -Directory |
        Sort-Object Name -Descending | Select-Object -First 1).FullName +
        '\resources\app\git\cmd\git.exe'
  ```
  C'est la même faute que le compteur recopié : une valeur qui décrit un autre système
  et qu'on fige. Un chemin résolu vieillit bien, un chemin écrit en dur non.

---

## 4. La cellule d'un lot se déclare AVANT le scan, jamais après

**L'occurrence, le 2026-09-08.** Le lot `quatre-champs-30` était composé de trois cellules
décidées d'avance — A (japonaises ordinaires), B (symbole illisible sur photo), C
(abstention). Les 31 scans sont tombés dans la fenêtre, les quatre champs se sont réveillés,
et **les cellules A et B sont perdues** : rien au journal ne dit à laquelle une ligne
appartenait.

⚠️ **Et le critère de repli ne marche pas.** `estDex: false` semblait pouvoir séparer les
cartes sans attaque : il attrape **15 lignes sur 31, dont 8 sont de vrais Pokémon** dont le
nom japonais n'a simplement pas été apparié. Un critère dérivé APRÈS coup n'attrape pas la
population qu'on visait — il attrape celle qu'il décrit, et ce n'est pas la même.

**La règle.** Un lot à cellules pose un marqueur **au moment du scan** — un champ écrit par
l'outil qui scanne, pas une reconstruction. Sans marqueur, un lot à cellules ne rend qu'un
chiffre global, et fusionner ses cellules est exactement ce que sa fenêtre interdisait.

⚠️ **Corollaire mesuré le même jour** : le banc **dédoublonne sur `(nom, numero, total)` et
garde la PREMIÈRE ligne vue** (`banc-seaux.js`, `cleDeDedoublonnage`). Trois des 31 scans ne
sont donc jamais arrivés au banc, dont un Pikachu n°025 *Expansion Pack* masqué par un
Pikachu n°025 *Jungle* scanné deux minutes plus tôt — deux cartes différentes, deux
`idProduct` différents, une seule identité. **Scanner deux cartes de même nom et même numéro
dans un lot, c'est en perdre une.** À vérifier en composant le lot, pas en le dépouillant.

---

## 5. Ce que le dédoublonnage coûte — mesuré le 2026-09-08, rien de proposé

**Les dénominateurs d'abord** : 279 lignes au journal, 9 écartées « hors service » AVANT le
dédoublonnage, **270 exploitables**, 235 identités de lecture distinctes.

| | n |
|---|---|
| **lignes masquées** | **35 / 270 — 13,0 %** |
| dont même produit gagnant (rescan : rien perdu) | 20 |
| dont **produit gagnant DIFFÉRENT — une carte réellement perdue** | **5** |
| dont indécidable (la masquée est un refus, pas de gagnant) | 10 |

Par seau : **lot** 12 masquées derrière 112 retenues (dont 3 de produit différent) ·
**holdout** 13 derrière 77 (dont 0) · **entraînement** 10 derrière 45 (dont 2).

🔑 **La perte n'est pas diffuse, elle vise le chantier.** Les 5 cartes perdues :
Charmander MCDP←smP2 · Flareon EC4←m3 · **Grimer EXS←MFO** · **Hypno EXS←MFO** ·
**Pikachu EXP←PJU**. **Trois sur cinq sont EXS ou EXP** — les deux sets sur lesquels porte
la lecture du symbole.

**Ce qui séparerait les paires** : `vintedUrl` sépare **16/35** ; il manque d'un côté sur 11
(lignes antérieures au champ), et sur les 8 restantes c'est **la même annonce**, donc
masquée à juste titre. `setCode` sépare **0/35**.

🔴 **LE CONFLIT, POSÉ POUR CELUI QUI S'Y ATTAQUERA — deux besoins opposés dans une clé qu'on
vient d'unifier.** `cleDeDedoublonnage` **dérive de** `identiteDe`
(`COMPOSANTES_IDENTITE = nom, numero, total`), et `test-banc-seaux.js` échoue si on les fait
diverger — c'était la bonne correction, deux définitions de la même règle divergent toujours.
Mais les deux usages ne demandent pas la même chose :

- **ancrer une vérité** veut une clé STABLE, qui ne bouge pas quand la règle des seaux
  change. Les vérités s'ancrent sur `v.lu` = `{nom, numero, setCode, total}`, **qui ne porte
  pas `vintedUrl`** : l'ajouter à l'identité **détacherait les 89 vérités** — la faute
  d'ancre du 04/08, refaite.
- **dédoublonner** veut une clé DISCRIMINANTE, qui sépare deux annonces distinctes.

Aucune proposition ici. Le fait est posé : **on ne touche pas à cette clé sans avoir dit ce
qu'on fait des 89 vérités déjà saisies**, et sans mesurer d'abord ce que la nouvelle clé
rattache encore.

---

## 6. L'angle mort de la saisie : 1 787 produits qu'aucune URL ne désigne

**L'occurrence, le 2026-09-08.** Le testeur a retapé **plusieurs soirs de suite** l'URL
Cardmarket de Palafin ex (`Prismatic-Evolutions/Palafin-ex-PRE151`). Chaque fois :
*« aucun produit ne porte le slug — rien n'est enregistré »*, `continue`, et la carte revient
au lancement suivant. **Le message était exact et inutilisable** : il ne disait pas qu'un
autre chemin existait.

**Le produit existe pourtant** : `idProduct 805545`, exp 5944, `codeSet PRE`, `numero 151`,
`nomFr "Superdofin-ex"`, apprise le 2026-07-16. **Sa ligne `numeros_cartes` ne porte aucun
champ `slug`** — contrairement aux 14 autres Palafin ex, qui ont `slug` + `slugSet` +
`variante`. Ce n'est pas une absence de catalogue : c'est une ligne apprise par un chemin qui
n'enregistre pas le slug.

**LA MESURE, dénominateur d'abord** : sur **69 598** lignes de `numeros_cartes`,
**67 811 (97,4 %) portent un `slug`** et **1 787 (2,6 %) n'en portent pas** — 1 174 sans
`source`, 367 `tcgdex`, 246 `cardmarket`. `resoudreSaisie` ne cherche que par `slug`
(deux requêtes, exacte puis insensible à la casse) : **aucune URL ne peut désigner ces
1 787 produits.**

**CE QUE ÇA COÛTE AU BANC** : 12 lignes sur 236 (5,1 %) ont pour gagnant de production un
produit sans slug — 11 au holdout (Charizard ex, Gengar, Tangela, Zekrom, Banette, Raichu,
Cleffa, A.Z.'s Peace of Mind, Lillie's Clefairy ex, Venusaur ex, Ampharos) et `L024` au lot.
Sur les vérités déjà écrites, **1 sur 117** vise un tel produit. C'est un **plancher** : la
vérité d'une ligne peut viser un autre produit que le gagnant.

⚠️ **Le contournement existe et n'était écrit nulle part** : `resoudreSaisie` accepte un
**idProduct nu** (`/^\d+$/`, `moyen: 'idProduct'`) avant toute recherche par slug. Taper
`805545` résout ce que l'URL ne résoudra jamais.

🔑 **LA LEÇON N'EST PAS LE SLUG MANQUANT, C'EST LE MESSAGE.** Un refus exact qui ne nomme pas
la sortie fait retaper la même chose plusieurs soirs. Un outil qui refuse doit dire **ce
qu'on peut faire à la place** — sinon il transforme une donnée manquante en boucle
silencieuse, et une vérité insaisissable est une mesure impossible que rien ne signale.

---

## 7. La tentation nommée : un écart de prix n'atteste jamais une étiquette

**Le 2026-09-08, chantier du vintage occidental.** Base Set porte **102 numéros sur 102** où
plusieurs produits Cardmarket partagent le même numéro — `V1`…`V6` dans le slug, **même nom,
même `idMetacard`**. Rien chez nous ne dit lequel est la 1re édition, la shadowless ou
l'unlimited : ni `numeros_cartes` (13 champs), ni `catalogue_produits` (4 champs), ni
`guide_prix` (17 champs, tous des prix). TCGdex expose `variants.firstEdition`, mais c'est un
booléen **par carte** : il dit qu'une 1re édition existe, jamais **laquelle** des variantes
Cardmarket c'est.

**LA TENTATION.** L'écart de prix médian entre variantes du même numéro est **×7,15**, et
tout le monde sait que la 1re édition vaut plus cher. Il est donc très facile d'écrire
« la variante la plus chère est la 1re édition » et d'obtenir une table qui *a l'air* juste.

🔴 **C'EST DEVINER L'ÉTIQUETTE DEPUIS CE QU'ON VEUT PRÉDIRE.** La table servirait à estimer
un prix ; la dériver du prix la rend vraie par construction et invérifiable pour toujours.
Toute mesure faite ensuite confirmerait la règle qui l'a produite. **Une corrélation de prix
ne pourra JAMAIS attester ce lien** — pas mieux avec plus de données, pas mieux avec un
seuil, pas mieux « juste pour commencer ».

**La seule voie est une source externe qui NOMME l'impression**, avec sa question de licence.
Et l'ordre ne s'inverse pas : la source d'abord, le champ de prompt ensuite. Lire le tampon
« Edition 1 » sur la photo donne l'étiquette du côté de la CARTE ; il faut aussi celle du
côté du PRODUIT. **Deux étiquettes sont nécessaires, nous en avons zéro** — et un signal sans
colonne de jointure est mort, on l'a déjà mesuré trois fois.

⚠️ **Dette de documentation, 2026-09-09** : trois endroits disaient que `variante`
signifie « V1/V2/V3 = normale/reverse/illustration » (`apprentissage-commun.js:28`,
`diagnostic-carte.js:37`, `index.js:2678`), alors que `scoring.js:200-202` établit l'inverse
et fait autorité — **« le n° de variante V1/V2/V3 n'a pas de sémantique stable »**, et
`POIDS.variante` est un override manuel que plus rien ne dérive. Sur Base Set, où il n'existe
aucune reverse holo, la lecture « V2 = reverse » est fausse. Rien n'en dépend aujourd'hui ;
les commentaires, eux, sont périmés.

---

## 8. Deux faux affirmés, deux natures — impasse structurelle ou garde manquante

**Mesuré le 2026-09-09.** Le seau « lot » en portait deux. Ils se ressemblent — un prix
affirmé sur la mauvaise carte, aucune réserve — et ils ne se réparent pas pareil.

**HO-OH (et Rayquaza) — L'IMPASSE STRUCTURELLE.** La vérité n'est **pas dans le vivier**, et
elle ne pouvait pas y être : le périmètre l'avait exclue avant tout classement. La chaîne
choisit alors le seul survivant d'un ensemble déjà amputé et le prend pour une désignation.
🔑 **Un survivant unique après restriction n'est pas une désignation, c'est un RESTE.**
Aucune garde en aval ne répare ça : il n'y a rien à départager, la bonne réponse est absente.
Seul le périmètre — ou une clé qui le contourne — peut le lever.

**L109 SLOWPOKE — LA GARDE MANQUANTE.** La vérité est hors vivier elle aussi, mais la
différence est ailleurs : **la chaîne avait déjà le signal de son propre doute et ne l'a pas
utilisé.** `margeConfortable: false`, `ecartScore: 25`, et pourtant `carteIncertaine: false`.
Le champ existe, il est journalisé, et il n'est pas parmi les disjonctions de `carteAmbigue`
(index.js:5078).

⚠️ **ET LA RÉPARATION ÉVIDENTE A ÉTÉ MESURÉE PUIS REFUSÉE.** Sur les 50 lignes jugeables,
`margeConfortable` prédit l'erreur **à l'envers** : 66,7 % de justes quand elle est VRAIE
(18/27), **73,9 % quand elle est FAUSSE** (17/23). Écart **−7,2 points**. Il n'y a pas de
signal à câbler — la corriger n'aurait été justifié que par L109, c'est-à-dire par une ligne.
**Un correctif justifié par un cas est une hypothèse.** La garde reste absente, et c'est une
décision, pas un oubli.

🔴 **NE PAS LA REPROPOSER SANS REFAIRE CETTE MESURE.** Le coût avait l'air gratuit — 1 faux
affirmé supprimé, 0 juste ferme perdu, 5 verdicts fermes sur 68 (7,4 %) passant en
suggestion. C'est précisément ce qui rend l'idée récurrente : elle a l'air propre et son
prédicteur est vide.

⚠️ **ET LE CHAMP A TROIS ÉTATS, PAS DEUX.** Sur 280 lignes du journal, 149 le portent :
**84 `true`, 38 `false`, et 27 NI L'UN NI L'AUTRE**. Un `margeConfortable` absent n'est pas
`false` — c'est « la marge n'a pas été évaluée sur ce chemin ». Le lire comme un booléen
mettrait 27 lignes du mauvais côté de la garde, et c'est la famille d'erreurs du catalogue
(erreur #8 : sur un journal qui a une HISTOIRE, `undefined` n'est ni `0`, ni `false`, ni
« absent du monde »).

**L109 RESTE DONC UN FAUX AFFIRMÉ NON RÉPARÉ**, et c'est écrit tel quel : la réparation
évidente est mesurée fausse, on ne le corrige pas par convenance.

---

## 9. Le prix de la promotion de `perimetre-vintage-suggestion` — mesuré, non câblé

**La question est légitime et le contexte a changé.** L'arbitrage a été posé quand une sortie
sous réserve était un refus muet ; depuis le 2026-09-08, elle affiche **trois candidats avec
leur set et leur prix**. Une suggestion n'est donc plus un trou. **Mesuré le 2026-09-09 sur
les 128 lignes jugeables, ce que coûterait la promotion en verdict ferme :**

| | aujourd'hui | promu |
|---|---|---|
| verdicts FERMES | 26 | **58** |
| dont JUSTES | 23 | **44** |
| 🔴 dont FAUX ET AFFIRMÉS | **3** | **14** |
| fermes et justes, sur 128 | 18,0 % | **34,4 %** |
| **faux DANS les fermes** | **11,5 %** | **24,1 %** |

**+21 justes, +11 faux affirmés.** Le seuil de lancement est multiplié par **4,7**, et **une
affirmation ferme sur quatre serait fausse**.

⚠️ **CE N'EST PAS UN ARBITRAGE ENTRE DEUX BIENS.** Les 11 nouvelles erreurs affirmées sont
des cartes japonaises vintage dont la vérité est souvent HORS VIVIER (Ponyta, Charmander,
Victreebel, Caterpie, Slowbro, Surfing Pikachu, Berry…) : ce sont des « restes » au sens du
§8, pas des choix serrés. Les promouvoir, c'est affirmer des restes.

**🔴 DÉCISION DU 2026-09-09 : NON PROMU.** Prise par le testeur, sur ce chiffre.

**LA RAISON QUI DÉCIDE N'EST PAS LE TAUX, C'EST LA NATURE DES 11.** Leur vérité est **hors
vivier** : la chaîne n'a jamais eu la bonne carte sous la main. Les promouvoir reviendrait à
affirmer des **restes** — le motif Ho-Oh du §8, appliqué en connaissance de cause et à
l'échelle. Un faux affirmé qu'on fabrique volontairement est pire qu'un faux affirmé qu'on
découvre.

⚠️ **ET LA QUESTION ÉTAIT LÉGITIME — elle est refermée par la mesure, pas par principe.**
L'arbitrage datait d'un temps où une sortie sous réserve était un refus muet ; depuis le
2026-09-08, elle affiche trois candidats avec leur set et leur prix. **Le contexte avait
réellement changé, et il fallait donc rouvrir.** Ce qui a tranché, c'est le chiffre. Si un
jour le vivier ramenait ces 11 vérités, la question se rouvrira d'elle-même — et il faudra
alors la remesurer, pas relire cette ligne.

---

## 10. La table du produit — cinq états, jamais un taux unique

**« L'utilisateur voit-il sa carte ? » ne se répond pas par un pourcentage.** Sur les 128
lignes jugeables, 2026-09-09 :

| état | n | % |
|---|---|---|
| **ferme et JUSTE** | 23 | 18,0 % |
| 🔴 **faux et AFFIRMÉ** | 3 | 2,3 % |
| **sous réserve, gagnant juste** | 57 | 44,5 % |
| **sous réserve, gagnant faux** | 22 | 17,2 % |
| **refus remboursé** | 23 | 18,0 % |

🔴 **ET LA COLONNE QUI DÉCIDERAIT VRAIMENT MANQUE.** « La vérité est-elle dans les TROIS
candidats affichés ? » n'est **pas mesurable** : le tableau `candidats` vit dans la RÉPONSE
HTTP (index.js:5813) et **n'est pas journalisé** ; `classement` non plus. **Aucune ligne du
journal ne dit ce que l'utilisateur a vu.**

Le proxy disponible, avec son dénominateur : sur les 79 lignes sous réserve, **36 portent
`vivierIds`** (champ jeune) ; la vérité est dans le vivier sur **29/36 (80,6 %)**, hors
vivier sur 7. Parmi les 29, **15 ont un vivier de 3 ou moins — la vérité y est forcément
affichée** ; les 14 autres dépendent d'un classement non journalisé.

**CE QU'IL FAUDRAIT, ET C'EST PETIT** : journaliser les trois `idProduct` rendus. La question
serait close dès le lot suivant. ⚠️ **Rétroactivement, rien n'est récupérable** — c'est le
sixième principe (on écrit ce qui n'est pas RECALCULABLE depuis la ligne), et cette colonne
est le prochain trou de cette famille.

---

## 11. L'égalité est la NORME — et aucune n'est structurellement incassable

**Mesuré le 2026-09-09, seau lot, 84 lignes classables** (le classement est recalculé en
appelant `scorerCandidatsLocal`, la fonction de la route) :

**51 lignes sur 84 — 60,7 % — portent une ÉGALITÉ STRICTE en tête de classement.**
L'égalité n'est pas un cas limite, c'est le régime ordinaire du vintage japonais.

🔑 **ET LE CHIFFRE QUI CHANGE LE PROBLÈME : `0 / 51` opposent des produits de la MÊME
MÉTACARTE.** Les 51 opposent des **cartes différentes**. Ce ne sont donc PAS des impressions
du même dessin — cas contre lequel aucun signal de carte ne peut rien (même illustrateur,
même attaque, même symbole). **Aucune de ces 51 égalités n'est structurellement incassable.**

Ce que ces lignes portent déjà :

| signal | présent | joint ? |
|---|---|---|
| `symboleSet` exploitable | **28 / 51** | oui — `departagerParSymbole` |
| `attaqueLue` | 16 / 51 | oui — `departagerParAttaque` |
| **`illustrateur`** | **8 / 51** | 🔴 **non — lu, journalisé, jamais joint** |

⚠️ **`illustrateur` n'a pas de colonne de jointure** : notre catalogue ne porte aucun
illustrateur, seul TCGdex l'a. C'est le motif du §7 — un signal sans colonne — pour la
quatrième fois. Le brancher demande une source, pas une règle.

**LE LEVIER N'EST DONC NI LE CLASSEMENT NI LE TRI : c'est ce qui CASSE l'égalité.**

### Le tri entre égaux est FERMÉ — mesuré, pas supposé

L'ordre appliqué aujourd'hui est écrit et décidé (`scoring.js`) : score décroissant, puis
**le moins cher**, prix inconnu ou nul en dernier. Les alternatives, sur les mêmes 84 lignes,
comptées en « vérité dans le top 3 » :

| ordre à score égal | top 3 | monte | **descend** |
|---|---|---|---|
| actuel (moins cher) | **54 / 84** | — | — |
| région concordante d'abord | **54 / 84** | 0 | 0 |
| dans le périmètre d'abord | **54 / 84** | 0 | 0 |
| numéro connu d'abord | 36 / 84 | 0 | **18** |

🔴 **Région et périmètre sont INERTES PAR CONSTRUCTION** : dans un vivier déjà restreint au
périmètre, tous les candidats sont dans le périmètre et partagent la région. Le critère « non
arbitraire » qu'on cherchait n'existe pas dans ces données. **« Numéro connu d'abord » fait
DESCENDRE 18 vérités.** ⚠️ « plus cher d'abord » avait déjà été écarté (43 premiers faux et
plus chers) et « moins cher d'abord » est l'ordre en place : **ne pas les reproposer.**

---

## 12. Le plafond d'un départage est le VIVIER, mesuré sur une ligne vivante — 2026-09-10

**L084 BLASTOISE δ, LE CAS QUI BORNE LA FAMILLE ENTIÈRE.** Le repli sur nom suspect s'ouvre
et rend **45 candidats** ; `viviersAvecRangs` les garde (un produit porte le n°049 lu, donc
pas de repli « tout le catalogue ») ; le périmètre restreint **45 → 4**. **Et la vérité
saisie, `762613`, n'est dans aucun des 4.** Le refus est donc **le bon résultat**, et
**aucun signal de départage n'aurait sauvé cette ligne** — il n'y avait rien à départager.

🔑 **CE N'EST PAS UN CAS ISOLÉ, C'EST LA MOITIÉ DE LA POPULATION.** Sur les **11** appels au
départage par l'attaque où une attaque était réellement LUE (seau lot, dénominateur 33
appels au total) :

| | n | ce que ça dit |
|---|---|---|
| l'attaque désigne, **et désigne la VÉRITÉ** | **7 / 11** | la clé n'a jamais eu tort |
| **la vérité est HORS du groupe** | **4 / 11** | aucune clé ne pouvait la trouver |
| l'attaque se trompe, ou ne concorde pas | **0 / 11** | — |

Les quatre : **L069 Ho-Oh** n°250 (« Rainbow Burn », 2 ex aequo) · **L070 Slowpoke** n°079
(« Headbutt », 2) · **L078 Sandshrew** n°027 (« Poison Sting », 3) · **L084 Blastoise δ**
n°049 (« Enraged Linear Attack », 4). **Dans les quatre, la vérité n'est pas dans le
groupe.**

🔴 **ET LE CAS FONDATEUR DE LA CLÉ EST L'UN DES QUATRE.** `departage-attaque.js` a été écrit
sur Ho-Oh n°250, dont la vérité est `654129` = « Ho-Oh **[Rainbow Burn]** ». L'IA a lu
« Rainbow Burn » — **la lecture est exactement juste** — et `654129` **n'est pas dans le
vivier**. La clé aurait désigné la bonne carte si elle l'avait eue sous la main. C'est le
motif Ho-Oh du §8, retrouvé sur la ligne qui a fait naître la clé censée le résoudre.

**LA RÈGLE QUI EN SORT.** Un départage ne peut jamais faire mieux que son vivier : sur cette
population, son plafond est **7/11**, et les 4 restants ne se gagnent ni par un signal, ni
par un ordre, ni par un seuil — **seul le périmètre ou une clé qui le contourne les
ramènera**. Avant de chiffrer le gain d'une clé nouvelle, mesurer d'abord **combien de fois
la vérité est dans le groupe** : c'est ce nombre-là qui borne, pas la qualité du signal.

🔑 **ET LA CONSÉQUENCE, EN UNE LIGNE : un signal peut être PARFAIT et SANS EFFET.** Mesurer
la qualité d'un signal avant de mesurer la présence de la vérité au vivier, c'est mesurer
dans le mauvais ordre — on obtient un excellent chiffre sur une question qui ne décide rien.

---

## 13. Trois dettes ouvertes, nommées et non corrigées — 2026-09-10

- **Le `catch` de `/api/identifier` écrit au journal, mais sa trace n'est pas
  diagnostique.** **2 lignes** `erreur-serveur` sur 280 (2026-08-03, « Dragonite ») : elles
  portent route, userId, l'annonce, `cardInfo`, `motifEchec` et `rembourse` — **ni vivier,
  ni état, ni coût, ni identification**, et `messageErreur` y est **absent** (le champ est
  postérieur). Un incident laisse donc une trace qui ne permet pas de le comprendre. Ce
  n'est pas réparable par `champsIdentification()` : les variables sont déclarées **dans le
  `try`**, donc hors de portée dans le `catch`.
- **7 sorties de refus sur 10 ne portent aucun des quatre champs de chemin**
  (`voieCatalogue`, `sourceIdentification`, `carteTcgdexId`, `nomSuspect`) — dont **4 de
  `/analyser`**, où le veto du nom n'existe pas et dont les succès les journalisent déjà.
  **Choix assumé** : les mesures en cours portent sur `/identifier`. **À rouvrir seulement
  si une mesure porte sur `/analyser`.**
- **Le mot « cellule » désigne QUATRE choses dans ce dépôt.** `CELLULES`
  (`verrou-charges.js`) en a **7** — c'est ce que compte le « 7/7 » ; `verrou-cellules.js`
  imprime **3/3** ; l'en-tête de `verrou-charges.js` dit encore « LES TROIS CELLULES »
  au-dessus d'un tableau de 7 ; et `verrou-avant-push.js` appelle « **7e CELLULE** » le test
  de panne de source, dont le commentaire dit « les six autres » — écrit quand `CELLULES` en
  avait 6, c'est aujourd'hui la 8e chose. **Les JALONS, eux, sont bien 5** : `route`,
  `ia-lue`, `vivier`, `perimetre-vintage`, `verdict`.

---

## 14. Une saisie ne se rattache jamais à une ligne scannée APRÈS elle — 2026-09-10

**L'occurrence.** La vérité `606445` (Slowpoke N1) a été saisie le **2026-08-21** pour **H005**,
un vrai N1 du holdout scanné le 11/08 — la saisie est **juste**, vérifiée sur sa photo. Le
2026-09-06, **L070** est scannée : même nom, même n°079, pas de total, donc **même identité**
`(nom, numero, total)`. `rattacherVerites` ancre la vérité sur l'identité, pas sur la ligne :
L070 a hérité de `606445`. Or l'annonce de L070 est « Slowpoke [Headbutt | Amnesia] », le promo
**UNP `571765`** — l'IA avait lu l'attaque « Headbutt », le titre disait « Promo UNP », et la
photo rend 18 inliers contre le vecteur de 571765, **0** contre celui de 606445. C'est le conflit
du §5, réalisé : **une saisie juste, une ligne fausse**, et rien au banc ne le disait.

**Le compte, dénominateur d'abord** — lot de 112 lignes, 112 à vérité, 111 saisies par URL :

| | n |
|---|---|
| lignes du lot dont l'identité existe aussi dans un autre seau | **11** |
| dont la vérité rattachée a été saisie **AVANT** le scan de la ligne | **1** — L070 |

Les 11 : L004 Grimer, L019 Slowbro, L020 Gladion's Final Battle, L044 Dark Dragonite, L046
Raichu, L049 Mew, L067 Growlithe, L068 Rayquaza, L069 Ho-Oh, L070 Slowpoke, L087 Pikachu.
Sur les 10 autres, la saisie est postérieure au scan du lot : elle a pu être faite pour lui.

**La règle qui en sort.** Une saisie ne doit **jamais** se rattacher à une ligne scannée
**après** elle : une vérité saisie le 21/08 ne peut rien dire d'une photo prise le 06/09. Le
critère est mécanique — `saisiLe < le` de la ligne — et il ne demande aucune nouvelle colonne.
⚠️ **Rien n'est corrigé ici, et la correction n'est pas triviale** : avec l'ancre actuelle, une
entrée `L070 → 571765` écraserait aussi la vérité de H005 (`rattacherVerites` garde la dernière
entrée vue pour l'identité, pour TOUTES les lignes qui la portent). Corriger L070 dans le fichier
sans toucher à l'ancre casserait H005. C'est le prix du §5, désormais chiffré : **1 ligne sur
112**, et elle était dans les 43 planches. L'étalon du 2026-09-10 n'en bouge pas — 571765 est
hors du groupe de L070 comme l'était 606445.

---

## 15. La recherche par l'image sur l'index ENTIER : le signal tient, et ce qui le borne — 2026-09-10

**L'ÉTALON D'ABORD.** 43 planches à l'aveugle (égalités strictes de la recette A, seau lot, 26 à
vérité dans le groupe, 17 hors), sans prix, set, score ni rang : le testeur rend **42/43** — 25
lettres justes sur 26 et 16 « aucune » justes sur 17, une lettre fausse (L034, réimpression CP6 au
même dessin), un « aucune » à tort (L021, bord e-Reader lu comme une autre série alors que c'est
l'impression française du même produit). Sa raison sur 12 des 14 lignes hors groupe : « illustration
complètement différente ». Le départage image de la route, sur les mêmes 43 : 24 justes dedans,
**0 dehors** — il désigne toujours le moins mauvais, à 4 inliers s'il le faut.

**LA RECHERCHE RÉELLE** — 43 photos d'annonce contre les **70 214** vecteurs de l'index, sans aucun
vivier textuel, 3 019 202 appariements, fonctions de la route intactes :

| | rang 1 | rang ≤ 5 | absente |
|---|---|---|---|
| toutes, 43 | **37** (35 stricts, 2 ex aequo L009 et L011) | 41 | 0 |
| vérité DANS le groupe, 26 (départage : 24) | 22 | 25 | 0 |
| vérité HORS groupe, 17 (départage : 0) | **15** | 16 | 0 |

Les 2 perdues dedans (L026 Pichu 8 contre 9, L110 Poliwag 12 contre 16) sont des réimpressions du
même dessin : **c'est le texte qui doit les trancher, pas l'image.** Faux qui battent la vérité : même
métacarte sur 2 lignes (L005, L110), carte différente sur 4 (L021 occidental à 5 inliers, L024
moderne à 4, L026, L102 Squirtle 14 contre 26). Écart premier−second : justes [0…34], non rang 1
[0…2] — descriptif, **aucun seuil**. L070 sous ses deux vérités : 571765 rang 1 à 18 ; 606445
absente, 3 552 devant.

🔴 **DETTE MESURÉE, NON CORRIGÉE : `inliers()` (departage-image.js:356) fuit.** Les objets rendus par
`mm.get(i)` et `m.get(0|1)` ne sont jamais libérés : RSS 163 → 1 215 Mo en 120 000 appels
(≈ 8,8 Ko par appel), abandon du tas WASM vers 130 000 appels à 1 Gio. Un processus seul ne peut
pas parcourir l'index ; la mesure a tourné par lots de 500 dans des processus neufs. Sur 512 Mo,
le plafond arrive vers 40 000 appariements.

**LA FORCE BRUTE EST HORS DE PORTÉE EN LIGNE, C'EST ACQUIS** : 0,69 ms par appariement ici (1,32 dans
la note du module), 48 à 93 s par photo, 362 Mo de vecteurs contre 512 Mo sur Render. Trois mesures
sur ce qu'on perdrait à l'approcher, rendues séparément, jamais additionnées :

**Mesure 1 — l'index approché.** Arbre de vocabulaire binaire (k-majority, 16 branches × 4
niveaux, 63 946 mots, entraîné sur l'index, jamais sur les photos), tf-idf par index inversé de
79 Mo, pré-filtre en 13 à 15 ms par photo, puis re-classement des N survivants par les inliers réels.

| N | rang 1 (dur / souple) | perdues au pré-filtre (souple) | temps en ligne | mémoire |
|---|---|---|---|---|
| 50 | 22 / 24 sur 43 | 19 lignes | 66 ms | 81 Mo |
| 200 | 28 / 30 | 13 lignes | 217 ms | 82 Mo |
| 1 000 | 30 / 33 | L004, L009, L021, L024, L050, L107 | 1 023 ms | 86 Mo |
| force brute | **37** | — | 48 000 ms | 362 Mo |

**Le plus petit N sans perte est 12 935 (souple) ou 36 102 (dur) : ce n'est plus un pré-filtre.** Les
pertes commencent dès N = 1 pour des lignes que la force brute met au rang 1 à 10–25 inliers
(L009 Hitmontop rang 7 211 au pré-filtre, L050 Pidgeot 6 502, L107 Raikou 6 585) : le sac de mots
ne voit pas ce que la géométrie RANSAC voit. ⚠️ Lu sur ces 43 lignes, donc ajusté à elles.

**Mesure 2 — détection et redressement.** Détection géométrique simple avec l'OpenCV du dépôt
(gris, flou, Canny, dilatation, contours, plus grand quadrilatère convexe, sinon enveloppe convexe),
redressement perspectif 640×894, puis la même force brute sur l'index entier.

| détection, 43 photos | n |
|---|---|
| quadrilatère trouvé | 25 |
| enveloppe convexe à 4 sommets | 9 |
| échec (aucun contour ≥ 12 % de la photo) ou rapport hors borne | 7 + 2, photo brute conservée |
| **rectangle FAUX à l'œil** (l'illustration au lieu de la carte : L027, L034, L047, L049, L053, L067) | **6** |

| | rang 1 | rang ≤ 5 |
|---|---|---|
| photo brute | 37 | 41 |
| photo redressée | **35** | 40 |

Gagnées 2 (L026 Pichu 3 → 1, L110 Poliwag 4 → 1 — les deux réimpressions que le texte doit
trancher, pas cherchées, constatées), perdues 4 : L011 (ex aequo brut, 14 → 9, rang 2) et **les
trois rectangles faux L027, L053, L067** (rang 2, 143, 17). Sur les **27 rectangles justes** : rang 1
22 → 23, **inliers de la vérité en médiane 26 → 39, écart premier−second 10 → 18** — la séparation
s'élargit nettement quand la détection est juste. Sur les 9 photos brutes conservées (témoin) :
rien ne bouge, 8 → 8. 🔑 **Le redressement rend ce que la détection lui donne : +50 % d'inliers sur
un rectangle juste, une ligne cassée sur un rectangle faux.** Ce qui manque n'est pas le
redressement, c'est un détecteur qui trouve la CARTE et non son cadre d'illustration — 6 fois sur
34 le plus grand contour est le cadre intérieur, et 9 fois sur 43 rien n'est trouvé (fond clair,
sleeve, carte tenue en main).

**Mesure 3 — la source des images.** **70 017 des 70 214 vecteurs (99,7 %) viennent d'une vignette
de 270 px de large ou moins**, agrandie 2,5 fois en gris. (a) Décrite à sa taille NATIVE, la vignette
donne MOINS : inliers de la vérité en baisse sur 32 lignes sur 43, moyenne 25,0 → 15,7 —
l'agrandissement aide ORB, il n'est pas la perte. (b) Une image pleine résolution d'un AUTRE tirage
du même dessin (jumeau occidental chez TCGdex, 40 appels d'API et 36 images ce tour, pont setTcgdex)
est PIRE : 20 vérités jointes, 19 descendent, moyenne 23,6 → 5,0 ; sur les 14 jumeaux au vrai même
dessin, 21,5 → 6,8 ; 6 jointures passent par un pont faux (`sv03.5` « 151 » pour EXS, PJU…).
🔑 **L'appariement porte sur toute la carte, texte compris : seule une image pleine résolution du
MÊME tirage aiderait, et TCGdex n'en a aucune pour le vintage japonais.** Il reste la page produit
Cardmarket, en image plus grande, à collecter comme les galeries. **Aucune des 4 lignes où l'image
se trompe de carte n'est rattrapée** par une image disponible : L021 5 contre 10, L024 4 contre 8,
L026 8 contre 9, L102 14 contre 26.

---

**L'EXIGENCE POUR TOUTE CLÉ FUTURE.** Une clé qui départage doit **nommer son périmètre dans
la raison journalisée**. `departagerParSymbole` et `departagerParAttaque` le font déjà — leur
`raison` dit « est le SEUL EX AEQUO à la porter », pas « est le seul ». `departagerParNumero`
aussi (« l'expansion X » / « tout le catalogue »). C'est ce qui permet, six mois plus tard,
de relire une désignation sans la confondre avec une unicité. Une clé dont la raison ne dit
pas dans quel ensemble elle a cherché fabriquera des restes qu'on lira comme des choix.
