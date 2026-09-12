# Spécification du câblage du PONT — notre base `cartes` à la place de TCGdex (2026-09-12)

À écrire, PAS à exécuter. Rien de ce fichier n'est câblé.

## 0. Ce que la mesure a dit, et ce qu'elle n'a pas dit

Mesure du 2026-09-12 (`mesure-pont.js`, lecture seule) : 140 vérités numériques du banc, **103
couvertes par les 28 sets (73,6 %)**. Sur ces 103 lignes : production 7 fermes justes · 6 faux
affirmés · 53 réserve juste · 19 réserve faux · 18 refus ; **notre base 45 · 3 · 51 · 4 · 0**.
⚠️ **Proxy du vivier, pas la chaîne** : un candidat unique compte comme ferme, le scoring, le
périmètre et les départages ne sont pas rejoués. Le chiffre réel se mesure sur la chaîne, avec
`apres()` du banc, le jour du câblage — pas avant, pas depuis ce fichier.

Les 3 faux affirmés projetés ont trois causes, toutes de notre côté (voir le message du même jour) :
deux fois le NUMÉRO DE POKÉDEX lu comme numéro de collection (L051, L102 — la clé V de la chaîne
existe déjà et n'était pas dans le proxy), une fois une jointure effacée par `--reparser` sur une
carte partagée entre deux sets (H006). Aucune n'exige une garde nouvelle.

## 1. La question que la chaîne pose au pont, et la réponse

Aujourd'hui (index.js:1537, `trouverCarteTCGdex`) : nom, numéro, setCode, langue, total, nomBrut →
`{ id, nomExact, localId, variants, variantsDetailed, ambigu, source, langueRoute }`, puis
`expansionsDuSetTCGdex` (2947) → expansions Cardmarket.

Demain, UNE fonction, `pont-cartes.js` :

```js
interrogerPont({ nom, nomBrut, numero, total, setCode, langue, attaqueLue, illustrateur })
  -> { source: 'base-cartes' | 'tcgdex' | 'aucune',
       cartes: [{ pageid, nomEn, nomJa, ndex, illustrateur, attaques, impressions }],
       expansions: [idExpansion…],          // celles des cartes rendues, tirage jp
       produits: [idProduct…],              // via cartes_produits, tirage jp
       variants: null, variantsDetailed: null,   // la base n'en a pas ; TCGdex en a sur le moderne
       raison: '…' }
```

Règles de la requête sur notre base, dans cet ordre, chacune journalisée dans `raison` :
1. **nom** : `nomBrut` en kana contre `nomJa`, sinon `nom` contre `nomEn` (normalisation de
   `jointure.js` : apostrophes, tirets, ♂♀, « Basic », LV.X depuis `level=X`) ;
2. **numéro, clé V** : sur un set numéroté, `cleNumero(numero)` contre les impressions du set
   (préfixe alphabétique gardé : S04 ≠ 004) ; sur un set SANS numéros, le numéro lu est un numéro
   de POKÉDEX et se compare à `ndex` — un `ndex` nul garde la carte (non lu ≠ différent). ⚠️ Le
   caractère « numéroté » se juge sur les impressions du set COUVERT, jamais sur la page entière :
   l'Articuno de MFO porte aussi une réimpression Classic numérotée 009, qui le faisait passer pour
   numéroté et l'écartait (mesuré le 2026-09-12) ;
3. **total** : si lu, préférer les sets dont `totalImprime` = total ; jamais un veto ;
4. **attaque lue** : si plusieurs produits, garder ceux dont le nom Cardmarket porte l'attaque
   (`departerParAttaque`, déjà en place, sur les crochets) ;
5. rendre TOUS les produits restants : le pont désigne un vivier, pas un gagnant. Le scoring et
   les départages existants (symbole, attaque, image) décident, comme aujourd'hui.

## 2. Deux sources, une seule qui répond — jamais les deux

**Règle : notre base répond D'ABORD ; si elle rend ≥ 1 carte, TCGdex n'est PAS appelé ; si elle rend
0 carte, TCGdex est appelé exactement comme aujourd'hui.** Il n'y a donc jamais deux réponses à
confronter : les deux sources sont DISJOINTES par construction, pas arbitrées.

Pourquoi c'est la base qui décide sur son périmètre : les 28 sets sont exactement ceux où le pont
TCGdex est **faux par construction** (sets-vintage-japonais.js : neo4 → N4 + NDE, base5 → ROG + TR,
ecard3 → EC4 + EC5 + SK) ou muet (E-series, VS, Web, promos). Sur ces sets, une réponse TCGdex n'est
pas une seconde opinion, c'est l'erreur qu'on remplace. Hors périmètre (37 vérités sur 140 aujourd'hui,
tout le moderne), la base ne sait rien et le dit : `source: 'aucune'` → TCGdex.

⚠️ La garde qui reste : une carte MODERNE lue avec un nom commun (« Pikachu ») ne doit pas être
tirée dans le vintage. La base n'est interrogée que si `regionAttendue` est japonaise ET que le
`setCode` lu ne contredit pas le vintage (`setCodeCompatibleVintage`, déjà en place). C'est la même
garde que le périmètre actuel, appliquée AVANT la requête et non après.

Ce que la base ne remplace pas : `variants_detailed` (routage des reverses, moderne) reste à
TCGdex hors périmètre ; sur les 28 sets il n'existait pas (0 idProduct sur les cartes japonaises,
mesuré le 15/08). Le canal prix ne change pas.

## 3. Journal et symétrie

- Nouveaux champs journalisés : `sourcePont` ('base-cartes' | 'tcgdex' | 'aucune'), `cartesPontIds`
  (pageids rendus, ≤ 20), `raisonPont`. Trois états, jamais un booléen.
- **Symétrie** : `apres()` de banc-japonais.js appelle `interrogerPont` — la MÊME fonction, le même
  module, dans le MÊME commit que la route. Un banc qui réimplémente le pont mesure autre chose.
- Où vit la base pour la chaîne : lecture directe de `cartes` par pokemon-proxy (connexion
  `MONGODB_CARTES_URI`, lecture seule, utilisateur `lecteur`) tant que l'API privée de rat-market.fr
  n'existe pas ; le jour où elle existe, `pont-cartes.js` change de transport, pas de contrat.

## 5. La trajectoire : TCGdex disparaît, code supprimé, pas désactivé

🔑 **LE COMPTEUR, PREMIÈRE LECTURE (2026-09-12, `node compteur-pont.js --n=500 --par-set`, 280 lignes
du journal, toutes antérieures au câblage).** La base aurait servi **194 lignes sur 280 (69,3 %)**.
Les 86 autres : **71 hors garde amont** (50 de région non japonaise, TCGdex les sert comme avant ;
21 à setCode incompatible vintage, dont des promos SV-P et des decks Classic) et **15 dans la garde
mais sans carte en base**. Dans le périmètre, TCGdex ne sert donc plus que 15 lignes.

**De quels sets viennent les 86 ?** 47 expansions, 79 lignes avec un produit, 7 refus sans produit.
La distribution est PLATE : la première expansion pèse 11 lignes (PBL, occidentale), les dix
premières 39, aucune dizaine ne couvre la moitié. Ce qui se collecte ENSUITE pour le périmètre
japonais, lu dans ce compteur et non dans l'ordre théorique par demande :
- **le moderne japonais** — sv8a Terastal Festival 3, m2a MEGA Dream 2, sv11B Black Bolt JP,
  s12a VSTAR Universe, sv9, sv6, 151C, sm8 : ~12 lignes, 7 sets, ~1 400 produits chez PKMJP ;
- **UNP, les promos sans numéro** (205 produits, région à établir) : 3 lignes — et c'est le set
  du promo de L070 ;
- une ligne ADV3 « base sans carte » alors que le set est collecté : une jointure manquante à
  nommer, pas un set à collecter.
Les 50 lignes occidentales ne bougeront qu'avec la collecte occidentale (Bulbapedia ≥ 2010, §5 des
images). Le compteur se relit après chaque lot : c'est lui qui donne l'ordre, pas ce paragraphe.

**Le critère de bascule, posé d'avance, sur les lignes du journal** (ce que les gens scannent),
pas sur les 752 expansions :

> Sur les **N = 500 derniers scans**, la part des lignes où TCGdex a été appelé ET a rendu quelque
> chose que la base ne rend pas — une carte identifiée hors périmètre, ou des motifs routables
> (`variantsDetailedNb > 0`) — est **< 5 %**, sur **deux lots fermés consécutifs**. Et zéro faux
> affirmé au banc sur ces lots.

Tant que la base ne couvre que 28 sets, ce seuil ne sera pas atteint : c'est voulu. Il se rapproche
à mesure que la base s'étend (japonais moderne, puis occidental) — la bascule est une conséquence
de la couverture, pas une date.

**Le compteur, une commande** : `node compteur-pont.js --n=500`. Il rend : lignes après câblage
(base / TCGdex), lignes avant (la base AURAIT servi / TCGdex, dont hors garde amont), TCGdex utile,
part servie par la base, part d'appels TCGdex. Aucune requête réseau : la base seule.

**Ce qui se supprime le jour venu** (index.js sauf mention) : `getTCGdex`, `chercherCartesTCGdex`,
`chercherCartesTCGdexNomSeul`, `genererVariantesNom`, `chargerSetsTCGdex`, `setsPourTotal`,
`langueDesSetsTCGdex`, `detailCarteTCGdex`, `identifierParTotalEtNumero`, `trouverCarteTCGdex`,
`getPrixDepuisTCGdex`, `TCGDEX_EN_PANNE` et la distinction panne/absence qui en dépend, le cache
`_setsTCGdex`, `totalHorsTailleDeSet` ; `prefill-tcgdex.js` ; `verrou/tcgdex.json`,
`verrou/faux-reseau.js` et les cellules du verrou qui simulent TCGdex ; la clé d'API si elle
existe. Ce qui se REMPLACE : `expansionsDuSetTCGdex` (lit `numeros_cartes.setTcgdex`) par les
expansions du pont ; `setsCompatiblesAvecTotal` (scoring.js) par `sets.totalImprime` de la base ;
le routage des reverses (`variants_detailed`) par une table d'impressions dans la base — c'est le
seul champ que la base ne porte pas encore, et il bloque la bascule sur le moderne.

**Ce qui ne PEUT PAS se supprimer** : les champs du journal `carteTcgdexId`, `setTcgdex`,
`langueRoute`, `variantsDetailedPresent/Nb` — le banc les RELIT sur les lignes anciennes
(`apres()`, périmètre relu au journal). Ils restent déclarés dans journal-scans.js, plus jamais
écrits, avec la date de leur dernière écriture. Même sort pour `numeros_cartes.setTcgdex` : une
colonne apprise, lue par le banc sur l'historique, jamais réécrite.

## 4. Critère de lancement, inchangé

Zéro faux affirmé sur le banc, mesuré par `apres()` sur la chaîne câblée, holdout compris. Les 3
projetés sont réparés ou reclassés AVANT le câblage ; s'il en reste un après mesure réelle, on ne
lance pas, on le nomme.
