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

🔴 **CE QU'IL FAUDRA Y CHANGER LE JOUR DE L'OCCIDENTAL, ET LE RISQUE — écrit d'avance.** La garde
amont est aujourd'hui écrite en RÉGION (« japonaise ») parce que le périmètre collecté était
japonais : les deux coïncidaient. Ils cessent de coïncider dès le premier set occidental. **La garde
doit être réécrite en COUVERTURE, pas en région** : la base est interrogée quand ce qu'on lit peut
appartenir à un set COLLECTÉ, et `setCodeCompatibleVintage` ne s'applique plus qu'au sous-ensemble
vintage. Ce changement seul est inoffensif — hors couverture, la base rend `aucune` et TCGdex prend.
⚠️ **LE DANGER N'EST PAS LÀ, IL EST DANS L'EXHAUSTIVITÉ.** `pont-cartes.js` ne compte aujourd'hui les
homonymes que dans les expansions **japonaises ou sans région** hors des 28 : les occidentales sont
ignorées parce qu'elles étaient hors sujet. Le jour où un set occidental entre dans la base, un
« Pikachu » d'un set collecté serait AFFIRMÉ alors que quarante autres Pikachu vivent dans des sets
non collectés. **La garde d'exhaustivité doit compter les homonymes de TOUTE expansion hors
couverture, quelle que soit sa région, et dans le MÊME commit que l'élargissement de la garde
amont.** Élargir l'une sans l'autre, c'est refaire le Ho-Oh à l'échelle du catalogue entier.

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

🔑 **LE GISEMENT EST OCCIDENTAL — résultat du 2026-09-12, et il renverse l'ordre de collecte.**
Sur les 86 lignes que la base ne sert pas, **51 visent une expansion occidentale**, contre 28
japonaises ou de région inconnue, éparpillées sur 21 expansions dont aucune ne pèse plus de 3 lignes.
**Collecter le japonais moderne ne fera PAS monter le pont.** Les 51 occidentales viennent de 26
expansions ; les dix premières en portent 35, et la première, PBL (120 produits), en porte 11 à elle
seule. ⚠️ **Et le bonus occidental déjà acquis n'en couvre AUCUNE : 0 sur 51.** Les 341 produits
occidentaux joints gratuitement par les pages japonaises sont ceux des jumeaux vintage (Base Set,
Base Set 2) ; les lignes non servies sont modernes, et aucune page vintage ne les nomme.
**Ce qui rend la collecte occidentale MOINS chère que la japonaise, en revanche, c'est la table** :
sur les 128 noms d'expansion occidentale que nos pages citent, **103 se retrouvent par slugification
exacte de notre `slugSet` (80 %)**, contre 2 sur 177 côté japonais — les deux côtés sont en anglais.
Les 25 restants sont des noms à esperluette ou à article (« HeartGold & SoulSilver », « Sun & Moon »,
« Diamond & Pearl »), une correspondance à la main, pas une devinette.

✅ **LES DIX SONT COLLECTÉES (2026-09-12) : compteur 69,3 % → 80,7 %, zéro faux affirmé au banc.**
Coût réel : ~50 requêtes, 10 minutes, 10 sets tous concordants, 1 400 produits joints sur 2 384.

🔴 **CE QUI RESTE, ET CE QUI NE VAUT PAS LE COUP — mesuré le 2026-09-12.**
Les 16 lignes occidentales encore non servies sont sur **16 expansions différentes, une ligne
chacune** : WP, ROS, SS, PLF, PRE, SSP, PGO, LOR, EVS, TWM, SIT, OBF, CRZ, HS, HL, BLK. Seize sets à
relever et à collecter pour seize lignes : ~130 requêtes et seize lignes de table écrites à la main.
**Le rapport est mauvais et il faut le dire avant de s'y mettre.**
🔴 **« ADDITIONAL CARDS » : PISTE MORTE, ET C'ÉTAIT MA RECOMMANDATION — mesurée, puis abandonnée le
2026-09-12.** J'avais proposé d'énumérer ces sections (280 entrées sur les dix pages : PAL 92, BRS 56,
EVO 40, MEW 29…) en concluant d'un COMPTE qu'elles apporteraient des cartes. **Elles n'en apportent
aucune** : leurs entrées reconstruisent les MÊMES titres que la section principale, parce que ce sont
des tirages alternatifs des mêmes cartes, au même numéro. Essayée sur PBL : 95 titres → 95 titres,
25 restes → 25 restes, zéro page nouvelle. 204 des 280 entrées désignent d'ailleurs des pages déjà
en base.
⚠️ **LA FAUTE EST LA MÊME QUE CELLE DU CATALOGUE (erreur #8) : j'ai conclu d'un COMPTE au lieu d'un
CONSTAT.** Deux fois dans la même journée — après les 269 entrées « récupérables », les restes
« récupérables ailleurs ». Compter des lignes ne dit pas ce qu'elles contiennent.

**CE QUE SONT VRAIMENT LES 672 RESTES** : des produits Cardmarket dont le NUMÉRO ne correspond pas à
celui que Bulbapedia donne à la même carte. Exemple : `Mega Excadrill ex` est le n°065 de Pitch Black
chez Cardmarket, et le n°065 de Bulbapedia est `Trumbeak`. Ce ne sont pas des pages manquantes, c'est
une DIVERGENCE DE NUMÉROTATION sur les cartes secrètes et alternatives. Les récupérer demande une clé
par NOM pour les restes seulement — une autre clé, plus risquée, à mesurer avant d'être écrite.

**CE QUE COÛTERAIENT LES DIX, ET CE QU'ELLES RENDENT — mesuré le 2026-09-12, rien collecté.**
2 072 produits, ~1 993 pages, **~63 requêtes de TEXTE, cinq minutes**. Le compteur passerait de
**69,3 % à 81,8 %** (229/280) ; les 51 occidentales entières le mettraient à **87,5 %**.
Résolution Bulbapedia vérifiée sur trois cartes de trois sets : **Pitch Black 744×1040, Ascended
Heroes et Journey Together 734×1024**, toutes au-dessus des 560 px. ⚠️ Mais **~1 Mo par image contre
120 Ko chez PKMJP** : ~2 Go et ~3 h pour les images des dix, c'est l'image qui coûte, pas le texte.
⚠️ **ET UN PIÈGE MESURÉ AU PASSAGE** : `|image=` d'une page est le PREMIER tirage, pas celui du set
demandé — sur trois cartes d'Ascended Heroes, l'une rendait l'image de Sword & Shield. Pour un set
occidental moderne, l'image se choisit dans `reprintN` / `TCGGallery` PAR NOM DE SET, jamais dans
`image=`. Le texte n'a pas ce problème, la Setlist désigne le bon set.

🔴 **TCGDEX NE SE DÉBRANCHE PAS CETTE SEMAINE, ET IL FAUT LE DIRE FRANCHEMENT.** Le critère de bascule
est « part utile sous 5 %, deux lots de suite ». Après les dix expansions occidentales, TCGdex serait
encore appelé sur **54 lignes de 280, soit 19,3 %** — presque QUATRE FOIS le seuil. Il faut en retirer
**40**, et on sait maintenant d'où elles NE viendront pas : ni des « Additional Cards » (piste morte,
mesurée), ni des seize expansions à une ligne (mauvais rapport, décidé). Elles viendront du japonais
moderne (~28 lignes sur 21 expansions) et du tri des 229 expansions sans région. **Aucune de ces deux
voies n'est un geste de dix minutes.**

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
