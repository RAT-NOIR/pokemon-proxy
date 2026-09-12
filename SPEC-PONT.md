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

## 4. Critère de lancement, inchangé

Zéro faux affirmé sur le banc, mesuré par `apres()` sur la chaîne câblée, holdout compris. Les 3
projetés sont réparés ou reclassés AVANT le câblage ; s'il en reste un après mesure réelle, on ne
lance pas, on le nomme.
