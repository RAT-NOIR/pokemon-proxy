// ============================================================================
// ⚠️⚠️ DISCIPLINE DES OUTILS DE MESURE — LIRE AVANT D'AJOUTER UNE LIGNE
// ============================================================================
// Septième principe (scoring.js) : un instrument qui se trompe coûte plus cher qu'un bug.
// Huit erreurs d'instrument sont recensées à ce jour, en deux familles :
//   - FABRIQUER UNE ENTRÉE que le système n'a jamais produite (clé positionnelle,
//     endpoint, identifiant reconstruit, champ lu hors de son moment) ;
//   - LIRE UNE ABSENCE COMME UNE VALEUR CONTRAIRE (`resultat !== 'succes'` sur un journal
//     où le champ n'existait pas encore).
// D'où les règles appliquées ICI :
//   1. ON N'INTERROGE QUE PAR IDENTIFIANT DE SET, jamais par recherche de nom. La
//      recherche par nom nous a induits en erreur trois fois.
//   2. ON NE SE FIE PAS À LA PRÉSENCE D'UN CHAMP `image` : on fait une requête HEAD et on
//      exige un 200 avec un content-type d'image. Un champ n'est pas un octet servi.
//   3. L'APPARIEMENT EST MONTRÉ, PAS AFFIRMÉ. Chaque ligne dit sur quelle PREUVE le set
//      japonais a été apparié, et les cas ambigus sont listés SANS être tranchés.
//
// ⚠️ CE QU'ON N'UTILISE SURTOUT PAS : le champ `setTcgdex` de numeros_cartes. Mesuré le
// 2026-08-15 — nos liens appris pour ces 24 sets pointent vers les JUMEAUX OCCIDENTAUX
// (Pokémon Jungle JP -> `base2`, qui rend 404 en /v2/ja et « Jungle » en /v2/en), et deux
// de nos sets partagent le même identifiant (`ecard3` pour EC4 ET EC5). S'en servir pour
// énumérer des cartes japonaises mesurerait le catalogue anglais.
//
// LECTURE SEULE : aucune écriture, aucune base touchée (cet outil n'ouvre même pas Mongo).
//
// ============================================================================
// CE QUE CET OUTIL MESURE : la reconnaissance par l'illustration est-elle possible ?
// ============================================================================
// Pour chacun des 24 sets de la table close vintage japonaise : combien de cartes TCGdex
// possède-t-il, et combien ont une image RÉELLEMENT SERVIE.
// USAGE : node mesure-images-vintage.js  [--tout]
//   --tout : mesure aussi les sets japonais NON appariés à la table close.
//
// ============================================================================
// ⚠️⚠️ CE QUI RESTE À MESURER SUR LE CHANTIER IMAGE — 2026-08-28
// ============================================================================
// Le verdict du chantier est un GO, et il faut le lire avec sa portée exacte :
// 10 requêtes sur 11 sortent au RANG 1 sur 449 références, 6 sur 6 dans la cellule
// « japonaise vintage sans total ni setCode », où le scoring plaçait la vraie carte
// aux rangs 15 à 23. C'est acquis. Ce qui suit ne l'est pas.
//
// ============================================================================
// ✅ 2026-08-29 — LA MESURE SUR LE BANC ENTIER. 66 VÉRITÉS, PLUS 11.
// ============================================================================
// Les 71 vérités saisies à la main ont TOUTES une image sur le disque : le banc a donc pu
// être rejoué contre l'architecture image sans une collecte de plus. 70 rattachées à une
// ligne de journal, 70 photos encore servies, 66 recevables après R1 (4 écartées : 3 pour
// vivier d'un seul candidat, 1 parce que la vraie carte n'était pas au vivier — défaut de
// périmètre, pas de classement).
//
// ⚠️ CE QUI SÉPARE CE JEU DES 11, ET QUI DOIT SE LIRE AVANT LES CHIFFRES :
//   · LES 11 SONT DEDANS. Le jeu les absorbe, il ne les confirme pas.
//   · L'INDEX EST LE VIVIER RÉEL (62 candidats en moyenne), pas les 449 du chantier. Le
//     hasard passe de 1/449 à 1/62 : un rang 1 vaut MOINS ici.
//   · le rang du scoring est celui d'AUJOURD'HUI, rejoué sur l'entrée enregistrée.
//
// LE RÉSULTAT — rang 1 par l'image contre rang 1 par le scoring, D+ = l'image sauve :
//                            n     IMAGE      SCORING     D+    D−    test des signes
//   tout le jeu ...........  66   60 (91 %)   31 (47 %)   33     4    p < 0,0001  ✅
//   🔑 LA CELLULE .........  44   42 (95 %)   10 (23 %)   32     0    p < 0,0001  ✅
//   asiatique hors cellule .  14   12 (86 %)   13 (93 %)    1     2    p = 1,00    🔴
//   🔑 OCCIDENTAL .........   8    6 (75 %)    8 (100 %)    0     2    p = 0,50    🔴
//
// 🔑 LE GAIN EST ENTIÈREMENT DANS LA CELLULE : 32 des 33 lignes sauvées y sont, et l'image
// n'y casse RIEN. Le scoring y tombe à 23 % de rang 1 — et seulement 18 % sans ex aequo,
// c'est-à-dire qu'un « rang 1 » du scoring y est le plus souvent un tirage au sort entre
// égaux. C'est exactement la population sans total ni setCode, celle qui n'a aucun signal
// texte : l'image y remplace un signal absent, elle ne concurrence pas un signal existant.
//
// 🔴 ET SUR L'OCCIDENTAL, L'IMAGE N'APPORTE RIEN. Le scoring y fait 8/8 ; l'image 6/8, et
// elle casse deux lignes. 8 lignes ne décident de rien statistiquement (p = 0,50), mais la
// direction concorde avec trois mesures indépendantes : le total est lu sur 93,2 % des
// lignes occidentales du journal contre 44,4 % en asiatique ; le vivier occidental
// journalisé vaut 1 candidat 10 fois sur 13 ; et les inliers occidentaux sont à ras du
// bruit, 9,5 médian contre 4,5 pour le premier faux — contre 49,5 contre 8 dans la cellule.
// ⚠️ Et les références sont ici des SCANS Cardmarket, pas des rendus TCGdex : le confond du
// témoin ne s'applique pas. Ce n'est donc pas la référence qui est en cause, c'est LA CARTE
// — les cartes modernes et occidentales, brillantes et lisses, ne donnent pas de points
// d'intérêt stables. C'est une découverte de cette mesure et elle disculpe TCGdex.
//
// ⚠️ LES 4 « CASSES », REGARDÉES UNE PAR UNE. Trois désignent LE MÊME DESSIN dans une autre
// finition (rang de la CARTE = 1) : L017 Mega Gardevoir ex, L023 Mewtwo, H004 Pikachu.
// Par la définition du chantier — « juste = la bonne CARTE quelle que soit la finition » —
// D− ne vaut donc pas 4 mais 1. La seule vraie casse est L003 Gardevoir ex : rang 48/93 et
// ZÉRO inlier sur la vraie carte, verdict TECHNIQUE. Un cas isolé, à regarder à l'œil.
//
// LA CONSÉQUENCE, ÉCRITE COMME UNE RÈGLE : le départage par l'image se déclenche là où le
// texte n'a rien à dire — pas de total lu, ou égalité au sommet. Le brancher partout
// dégraderait l'occidental sans rien gagner ailleurs.
//
// ── 1. RIEN NE TESTE ENCORE L'OCCIDENTAL NI LE MODERNE ──────────────────────
// ⚠️ CE PARAGRAPHE EST DÉPASSÉ DEPUIS LE 2026-08-29 pour sa première moitié : l'occidental
// EST testé, sur 8 lignes, et le verdict est ci-dessus. Il reste vrai pour le MODERNE
// japonais et pour tout volume sérieux d'occidental. On le garde tel quel : une note qu'on
// réécrit perd la trace de ce qu'on croyait avant de mesurer.
// Les 11 requêtes sont onze photos de cartes JAPONAISES VINTAGE, tirées de cinq sets
// (EXP, EC1, EC2, N3, IPB). Elles ne disent rien de l'anglais, du français, ni d'aucune
// carte postérieure à 2003 — c'est-à-dire de l'essentiel du catalogue.
// ⚠️ BASCULER L'ARCHITECTURE SUR CE SEUL CHIFFRE REMPLACERAIT UN CHEMIN QUI MARCHE PAR
// UN CHEMIN NON MESURÉ. Il faut LE MÊME chiffre sur du moderne avant toute bascule.
//
// Et deux choses changeront EN MÊME TEMPS le jour où on mesurera l'occidental, ce qui
// doit être déclaré en tête de cette mesure-là :
//   · l'ÈRE des cartes (1999-2003 -> 2010-2025) ;
//   · la NATURE DE LA RÉFÉRENCE — les 449 du vintage sont des SCANS Cardmarket, avec
//     grain et brillance ; l'occidental viendra de RENDUS TCGdex, propres et plats.
// Un chiffre plus bas sur l'occidental serait donc indiscernable entre « la méthode ne
// tient pas hors du vintage » et « les rendus ne s'apparient pas ». D'où le témoin
// `pokemon-proxy-labo/temoin-rendu.js`, qui pose la seconde question seule.
//
// ⚠️ ET LA POPULATION À MESURER N'EST PAS « DES ANNONCES OCCIDENTALES AU HASARD ».
// Mesuré ce jour sur les 44 lignes occidentales du journal : le total est lu sur 93,2 %
// d'entre elles (contre 44,4 % en asiatique), le vivier journalisé vaut 1 candidat sur
// 10 lignes sur 13, et il n'y a que 3 échecs — tous `egalite-parfaite`. Un vivier de 1
// n'a RIEN à réordonner : y mesurer l'image mesurerait le néant et rendrait « l'image
// n'apporte rien » là où c'est le PROBLÈME qui n'existe pas. La population qui a un sens
// est celle où un départage existe : `egalite-parfaite`, `carteIncertaine`, ou vivier ≥ 2.
//
// ── 2. LES GROUPES V1/V2 NE SONT TOUJOURS PAS MESURÉS ───────────────────────
// Trois cas serrés ont été rencontrés (Fearow, Machamp, Electrode) : à chaque fois, le
// candidat qui talonne la vraie carte porte LE MÊME DESSIN dans une autre finition.
// Trois cas ne sont pas une mesure. Les groupes durs — même set, même illustration,
// seule la finition change — restent à construire et à passer, ET À DÉCLARER FABRIQUÉS.
// C'est là, et seulement là, que se tranche pour de bon la clause écrite avant l'essai :
//     inliers(bon) ≈ inliers(mauvais) ≈ 0   -> la TECHNIQUE échoue, on a le droit de réessayer
//     inliers(bon) ≫ inliers(mauvais)       -> ça marche
//     inliers(bon) ≈ inliers(mauvais) ≫ 0   -> la MÉTHODE échoue, aucune technique ne les
//                                              séparera, et c'est au reste de la chaîne
//                                              de trancher la finition, pas à l'image.
//
// ── 3. CE QUI EST DÉJÀ SU DU PONT, ET QUI CONTRAINT LA SUITE ────────────────
// Mesuré ce jour sur les 750 codeSet de `numeros_cartes` :
//   · 0 codeSet sur 750 pointe vers DEUX identifiants TCGdex — le pont, là où il existe,
//     est UNIQUE. C'est la bonne nouvelle, et elle n'était pas acquise (côté japonais,
//     EC4 et EC5 partagent `ecard3`).
//   · mais il n'existe que pour 213 sets sur 750, soit 22 626 cartes sur 69 231 (32,7 %).
//     Les 46 605 autres ne sont pas absentes DE TCGdex : elles sont absentes de NOTRE
//     table de correspondance, qui s'apprend carte par carte.
// ⚠️ CONSÉQUENCE POUR TOUTE MESURE D'IMAGE OCCIDENTALE : un candidat sans référence ne
// peut jamais gagner. Mesurer sur un vivier à moitié ponté classerait la vraie carte
// contre un vivier amputé EN NOTRE FAVEUR. Une ligne n'est recevable que si son vivier
// est ponté à ≥ 80 %, et la proportion doit être rendue ligne par ligne.
//
// ============================================================================
// 🔴🔴 RÈGLE DURE — L'INDEX SE CONSTRUIT SUR L'idProduct DU NOM DE FICHIER,
//      JAMAIS SUR LE NOM DE DOSSIER. 2026-08-29
// ============================================================================
// Le nom de dossier est de la DÉCORATION. La clé est dans le fichier.
//
// Ce que l'audit de la collecte a trouvé, et qui interdit de faire autrement :
//   · 41 dossiers portent un nom qui n'est pas le codeSet de leur contenu ;
//     ✅ CORRIGÉ LE 2026-08-29 PAR LE TESTEUR, pour deux d'entre eux — il en reste 39.
//     SV4A a été séparé : « Pikachu Legendary Celebration » est passé sous CSDC, et le
//     contenu qui était sous CSDC a rejoint CS3DC, jusque-là vide. Constaté sur le
//     disque : SV4A 300 fichiers, CSDC 25, CS3DC 183.
//     ⚠️ ET AUCUN COMPTE DE CE FICHIER N'A BOUGÉ — c'est la règle dure qui le garantit,
//     et ça a été vérifié plutôt que supposé : 69 146 idProducts distincts avant comme
//     après le déplacement, aucune collision, aucun fichier perdu. Un renommage de
//     dossier ne PEUT pas déplacer un chiffre ici ; le jour où il le fait, c'est que
//     quelqu'un a rebranché un index sur le nom de dossier.
//     ⚠️ En revanche le compte des GALERIES PLAFONNÉES, lui, passe de 15 à 14 : SV4A en
//     portait deux, dont une seule était à 300. Le plafond n'a pas changé, la façon de
//     compter les galeries si.
//   · « CSDC » contenait les 183 cartes de CS3DC — corrigé le 2026-08-29, voir ci-dessus ;
//   · « SV4A » mélangeait deux galeries Cardmarket, « Shiny Treasure ex » (expansion 5519)
//     et « Pikachu Legendary Celebration » (expansion 6348, codeSet CSDC en base) —
//     séparé le 2026-08-29 ;
//   · « WCD12 » contient WCD12 ET WCD13 ; « XY10 » contient aussi le MAudino EX Mega
//     Battle Deck (codeSet XYH) ;
//   · Windows interdit le « / » : SV-P/ID est rangé sous « SV-P ID », S-P/CS sous
//     « SVP-P CS ». Ce n'est pas une faute de rangement, c'est le système de fichiers.
//
// ⚠️ ET ÇA A DÉJÀ COÛTÉ, DANS L'AUDIT LUI-MÊME. Mes deux premiers passages cherchaient,
// pour chaque dossier, les produits de son codeSet absents DE CE DOSSIER. CS3DC est donc
// sorti à « 183 manquants » alors que ses 183 fichiers sont sur le disque. Le rapport
// aurait envoyé le testeur réenregistrer 183 pages qu'il possède. La présence se juge sur
// L'ENSEMBLE du disque, par jointure sur l'identifiant, jamais dossier par dossier.
// Même chose au comptage des galeries : par dossier, SV4A paraissait dépasser 300 et
// renversait une hypothèse juste. Par galerie, il ne la dépassait pas.
//
// ============================================================================
// 🔴 CORRECTION DU 2026-08-30 — LE PLAFOND EST EN PAGES, PAS EN ARTICLES.
//    ET CE QUI LE LÈVE EST LA TAILLE DE PAGE, PAS LE TRI.
// ============================================================================
// LA CONCLUSION ÉCRITE CI-DESSOUS LE 2026-08-29 EST FAUSSE, et elle est laissée en place
// exprès, avec cette correction devant : une erreur se consigne, elle ne s'efface pas.
//
// CE QUE J'AI ÉCRIT : « le tri s'applique AVANT le plafond ». J'avais vu SI100 passer de
// 300 à 430 après un passage en tri inversé, et j'ai attribué le gain à la SEULE variable
// qu'on avait décidé de tester. C'est la faute classique : on ne teste jamais une
// variable, on teste un changement — et le changement en portait deux.
//
// CE QUE LE DISQUE DIT, mesuré le 2026-08-30 :
//   · MC a pris 766 cartes EN UNE SEULE PASSE de 8 pages, toutes datées entre 22:32 et
//     22:34 le 2026-08-29. Pages de ~100 cartes. Aucun tri inversé n'a été nécessaire.
//   · La seconde passe de SI100 utilisait des pages de 80, pas de 30. Neuf pages à 80
//     donnent 720 places pour 430 cartes : le tri n'avait rien à lever.
//   · 🔑 SUR 767 GALERIES DU DISQUE, ZÉRO NE DÉPASSE 10 PAGES. Aucune exception.
//   · Les tailles de page rencontrées vont de 2 à 100. 510 galeries ont été prises à
//     30/page — le réglage hérité — et 19 d'entre elles butent à 10 pages.
//
// LA RÈGLE, RÉÉCRITE : LE PLAFOND EST DE 10 PAGES. Le nombre d'articles récupérables vaut
// 10 × la taille de page choisie. Le « 300 » n'a jamais été un plafond d'articles, c'était
// 10 × 30. À 100 par page, le plafond est de 1 000.
//
// CE QUE ÇA CHANGE POUR LE CHANTIER, et c'est considérable :
//   · aucun set du catalogue ne dépasse 1 000 produits (vérifié : 0). Tout set est donc
//     récupérable EN UNE PASSE à 100 par page.
//   · MC n'était pas un cas particulier, c'était la démonstration du cas général.
//   · la conclusion « pour un set de plus de 600 cartes, le tri ne suffira pas, il faudra
//     un filtre » tombe avec le reste. Aucun filtre n'est nécessaire, donc aucun paramètre
//     d'URL maison, donc aucun risque Cloudflare.
//   · les 19 galeries prises à 30/page et butant à 10 pages sont à refaire, une passe
//     chacune. Ce n'est pas un rattrapage, c'est un changement de réglage.
//
// ⚠️ CE QUI RESTE VRAI DE LA MESURE D'HIER : SI100 est bien passé de 300 à 430, et il est
// bien complet. Seule la CAUSE était mal attribuée. Le chiffre n'a pas menti, la lecture
// du chiffre si.
//
// ============================================================================
// 🔑 LE TEST SI100 EST TOMBÉ — 2026-08-29. LE TRI S'APPLIQUE AVANT LE PLAFOND.
//    🔴 CONCLUSION FAUSSE — voir la correction du 2026-08-30 juste au-dessus.
// ============================================================================
// Les trois issues étaient écrites AVANT de lancer, et c'est la troisième qui sort :
//   0 nouveau         -> le tri s'applique après le plafond, le tri est mort
//   quelques dizaines -> la fenêtre bouge partiellement, rendement décroissant
//   ~130              -> LA SÉLECTION DÉPEND DE LA REQUÊTE          ← celle-là
//
// MESURÉ : SI100 portait 300 idProducts sur le disque, il en porte 430. Le catalogue en
// compte 430 pour l'expansion 4388. COUVERTURE 100,0 %, zéro manquant.
// Sur le disque entier : 69 016 -> 69 146 idProducts distincts, soit +130, et 322
// idProducts apparaissent désormais dans deux dossiers de page — le recouvrement entre
// l'ordre normal et l'ordre inversé. Ce recouvrement est la raison pour laquelle on ne
// compte JAMAIS des fichiers ici, seulement des identifiants distincts : compter les
// fichiers aurait annoncé un gain gonflé de tout ce que les deux passes ont en commun.
//
// CE QUE ÇA OUVRE : deux passes (ordre normal + ordre inversé) suffisent pour tout set
// d'au plus 600 cartes, sans aucun paramètre d'URL — donc sans le risque Cloudflare.
//
// 🔴 CE QUE ÇA N'OUVRE PAS, ET C'ÉTAIT DÉJÀ ÉCRIT : deux tris plafonnés à 300 donnent AU
// PLUS 600 cartes. MC (774 produits) ne sera pas couvert par le tri, quel qu'il soit. Il
// faudra un filtre — et SI100, à 430, ne dit rien de ce cas. Une réussite sous le seuil
// ne prouve rien au-dessus.
//
// ============================================================================
// LE POIDS EN BASE, MESURÉ ET NON ESTIMÉ — 2026-08-29
// ============================================================================
// Trois chiffres ont décidé du réglage à 150 points, et aucun n'est une extrapolation.
//
//   1. LA BASE OCCUPE DÉJÀ 58,8 Mo FACTURÉS (Atlas gratuit = 512 Mo). Le détail est utile
//      pour une raison inattendue : `catalogue_produits` pèse 6,7 Mo de données pour
//      26,3 Mo D'INDEX. Ce n'est pas le sujet du jour, mais c'est le plus gros poste de la
//      base et personne ne l'avait regardé.
//
//   2. LE SURCOÛT BSON EST ×1,012 (mesuré sur 1 000 documents réels échantillonnés dans
//      toute l'arborescence), pas ×1,08 comme je l'avais estimé. Mon estimation était trop
//      prudente de sept points.
//
//   3. 🔴 LA COMPRESSION AGRANDIT. C'est le chiffre qui élimine 200 points. 1 000
//      documents écrits puis relus dans `test_scratch` : storageSize/BSON = ×1,022. Un
//      descripteur ORB est une signature binaire construite pour maximiser l'entropie —
//      gzip -9, plus fort que le snappy de WiredTiger, ne fait que ×0,997 dessus (×0,667
//      sur les seules coordonnées, ×0,960 sur la charge entière). Le ratio ×0,545 du reste
//      de la base vient de textes répétitifs et NE S'Y APPLIQUE PAS.
//        200 points -> 577 Mo au total  🔴 au-dessus de 512
//        150 points -> 455 Mo au total  ✅ 57 Mo de marge
//
//   ⚠️ ERREUR D'INSTRUMENT ATTRAPÉE AU PASSAGE, la dixième du catalogue. Premier essai :
//   `fsync` + 3 s d'attente -> storageSize = 0,0 Mo, ratio ×0,001. Ce n'était pas une
//   compression miraculeuse, c'était WiredTiger qui n'avait pas encore fait son point de
//   reprise (60 s par défaut ; `fsync` n'est pas autorisé sur un cluster Atlas partagé).
//   UN INSTRUMENT QUI REND « MILLE FOIS PLUS PETIT » N'A PAS TROUVÉ UN MIRACLE, IL N'A
//   RIEN MESURÉ. Corrigé en attendant un checkpoint réel, et en refusant de conclure s'il
//   ne vient pas.
//
// ============================================================================
// 🔑 LES INDEX — 17,9 Mo QUE RIEN N'INTERROGE, ET DEUX QUI MANQUENT. 2026-08-30
// ============================================================================
// `catalogue_produits` porte 26,3 Mo d'index pour 8,5 Mo de données — un rapport de ×3,1
// que personne n'avait regardé. Relevé, avec la preuve par `explain(executionStats)` et
// non par lecture du schéma :
//
//   index              poids      interrogé par                        verdict
//   name_text        14 384 Ko    RIEN — 0 occurrence de `$text` dans   🔴 INUTILE
//                                 tout le dépôt. Créé par
//                                 import-catalogue.js:28.
//   idMetacard_1      3 076 Ko    RIEN — `idMetacard` n'est jamais un   🔴 INUTILE
//                                 critère de requête ; il est lu comme
//                                 CHAMP de documents ramenés autrement
//                                 (index.js:739, groupement en mémoire).
//                                 Déclaré deux fois : index.js:246 ET
//                                 import-catalogue.js:30.
//   idProduct_1       2 832 Ko    lireNumeros, getPrixGuideLocalLot,    ✅ utilisé
//                                 le chemin le plus chaud. ×1 mesuré.
//   idExpansion_1     2 364 Ko    couverture-index, /api/apprendre.     ✅ utilisé
//                                 ×1 mesuré.
//   _id_              2 984 Ko    obligatoire.                          ✅
//
// 🔴 ET LE PIÈGE DU `name_text` : il FONCTIONNE (802 résultats, 4 ms). Ce n'est pas un
// index cassé, c'est un index que personne n'appelle. La distinction décide de tout —
// « il ne marche pas » se corrige, « il marche et ne sert à rien » se supprime.
// Les recherches par nom du serveur sont des regex INSENSIBLES À LA CASSE : mesuré,
// `{name: /^Pikachu/i}` fait un COLLSCAN de 70 975 documents en 70 ms. Un index texte n'y
// répond jamais, un btree classique non plus. Le commentaire d'index.js:242 avait raison
// depuis le début ; c'est l'importeur qui contredit le serveur.
//
// ⚠️ ET LE RELEVÉ VA DANS LES DEUX SENS — `numeros_cartes` a le problème INVERSE :
//   `{idExpansion: …}`  -> COLLSCAN, 69 598 lus pour 244 rendus, 71 ms  (trouverProduitsParNumero)
//   `{setTcgdex: …}`    -> COLLSCAN, 69 598 lus pour 152 rendus, 42 ms  (expansionsDuSetTCGdex)
// Deux requêtes du chemin d'identification lisent la collection ENTIÈRE à chaque scan.
// La collection ne porte que `_id_` et `idProduct_1` (2,4 Mo au total, ×0,1 des données).
// Ce n'est pas une marge à récupérer, c'est une latence à supprimer — et les deux index
// manquants coûteraient environ 1 à 2 Mo, à comparer aux 17,9 Mo à rendre.
//
// `guide_prix` : rien à signaler, `idProduct_1` est utilisé, ×0,4 est normal.
//
// ⚠️ `$indexStats` N'A PAS SERVI À CE RELEVÉ, ET C'EST DÉLIBÉRÉ. Son compteur d'accès
// repart à zéro à chaque redémarrage de mongod, qu'on ne contrôle pas sur un Atlas
// partagé, et l'uptime n'est pas lisible depuis ce compte. Un index à « 0 accès » n'aurait
// prouvé qu'une chose : que mongod a redémarré. C'est la lecture du CODE, plus `explain`,
// qui décide — jamais un compteur dont on ne connaît pas la fenêtre.
//
// RIEN N'EST SUPPRIMÉ : le relevé est rendu, le testeur tranche.
//
// ── `autoIndex` RESTE ACTIF — décidé le 2026-08-30, et voici pourquoi ───────
// La pratique courante est de désactiver `autoIndex` en production. Ici, NON, et
// l'argument tient en une observation : sur les 17 index déclarés dans des schémas,
// QUATRE ne sont pas des accélérateurs mais des VERROUS D'UNICITÉ —
// `credits.userId`, `quotas_semaine{userId,semaine}`, `remboursements{userId,jour}`,
// `evenements_stripe.eventId`. Sans ce dernier, un webhook Stripe rejoué crédite DEUX
// FOIS, et rien ne le signale.
// `autoIndex` est aujourd'hui le seul mécanisme qui garantit leur existence sur une base
// neuve. Le défaut du 2026-08-30 n'était pas le mécanisme, c'était DEUX DÉCLARATIONS EN
// TROP (`idMetacard_1`, `name_text`). On corrige la déclaration, pas le mécanisme.
//
// 🔑 LA PARADE À ÉCRIRE, ET ELLE VAUT INDÉPENDAMMENT DE CETTE DÉCISION :
//     UNE CELLULE DU VERROU QUI LISTE LES INDEX ATTENDUS ET ÉCHOUE S'IL EN MANQUE UN.
//   Aujourd'hui RIEN ne le vérifie, et le jour où quelqu'un touchera à `autoIndex` — ou
//   supprimera une déclaration par mégarde — un webhook Stripe rejoué créditerait deux
//   fois sans que rien ne le signale.
//   C'est le même motif que la 7e cellule pour la panne Mongo : une défaillance HORS du
//   code, qu'aucun test unitaire ne peut voir. Non fait dans la fenêtre du 2026-08-30.
//
// ── LA REPRISE PAR LA BASE, PAS PAR UN FICHIER D'AVANCEMENT ─────────────────
// `ecrire-descripteurs.js` ne tient aucun fichier d'avancement : il relit les `idProduct`
// déjà écrits au réglage courant et les retire de sa liste.
//     UN FICHIER SÉPARÉ POURRAIT MENTIR — il se désynchronise dès qu'une écriture échoue
//     après avoir été comptée. LA BASE NE PEUT PAS MENTIR SUR CE QU'ELLE CONTIENT.
// Le corollaire qui rend ça sûr : chaque document part d'un seul `$set` (`etat`, `pts`,
// `desc`, `xy` ensemble). Une interruption laisse des documents ENTIERS ou rien — jamais
// un demi-vecteur, donc jamais un `indexee` sans buffers.
//
// ── 🔴 `import-catalogue.js` JETTE `dateAdded`, ET ÇA SE PAIE ───────────────
// L'export Cardmarket porte `dateAdded` par produit. L'importeur ne conserve que
// `name`, `idExpansion`, `idMetacard` : l'année de sortie d'un set N'A JAMAIS ÉTÉ EN BASE.
// Conséquence CONSTATÉE le 2026-08-30 : cinq sets de la liste de travail (SM2L, SVIBA,
// SV-P/CS, SV-P/ID, M-P/CT) n'ont pas pu être datés autrement que par ENCADREMENT des
// idProduct — une estimation, là où la donnée existait dans le fichier source. Seul TK10 a
// pu être lu, via TCGdex.
// `codes_set.apprisLe` ne remplace rien : c'est la date où NOUS avons appris le code.
// 🔑 AU PROCHAIN IMPORT : garder `dateAdded`. Trois lignes, et plus jamais d'estimation.
//
// ============================================================================
// 🔴 UNE COLONNE RETIRÉE : « CAUSE » (PLAFOND / INCOMPLET). 2026-08-30
// ============================================================================
// Les listes de travail rendues pendant ce chantier portaient une colonne « cause », qui
// disait si un set manquait des produits PARCE QUE Cardmarket avait plafonné la galerie, ou
// PARCE QUE l'enregistrement s'était arrêté. Elle se déduisait du NOMBRE de dossiers de
// page (`pages.length >= 10` -> plafond) et de la TAILLE DE PAGE lue comme le mode.
//
// ELLE EST FAUSSE DEPUIS QUE LES PAGES SONT RÉENREGISTRÉES EN DOUBLE. Le testeur garde les
// anciens dossiers (« PAGE 1 » à 30) en ajoutant les nouveaux (« PAGE 1B » à 100). Mesuré
// le 2026-08-30 : 3 galeries dépassent 10 dossiers (SIT 12, SV-P 13, XM2A 11) — ce qui est
// IMPOSSIBLE puisque le plafond est de 10 pages — et 25 galeries mélangent du 30 et du ≥80,
// ce qui rend le mode ininterprétable.
//
// 🔑 LA PARADE EST CELLE DE SV4A, ET ELLE S'ÉLARGIT :
//     ON NE CONCLUT JAMAIS UNE CAUSE D'UN NOM NI D'UN COMPTE DE DOSSIER.
// La règle dure disait « l'index se construit sur l'idProduct du nom de fichier ». Elle
// vaut aussi pour les DIAGNOSTICS : seul le compte d'idProduct distincts contre
// `catalogue_produits` dit si un set est complet. Le reste est de la décoration.
//
// CE QU'ON RENDAIT ET QU'ON NE REND PLUS : la colonne « cause ». Le risque n'était pas un
// scan faux — ces outils ne servent qu'à piloter la collecte — c'était un « PLAFOND »
// annoncé à tort, qui aurait envoyé retaper une galerie entière pour rien.
// ⚠️ Et ça ne manque à personne : depuis que le plafond est compris (10 pages, pas 300
// articles) et qu'aucun set ne dépasse 1 000 produits, LE GESTE EST LE MÊME dans les deux
// cas — une passe à 100 par page. La cause n'avait plus de conséquence pratique.
//
// LA LISTE QUI VAUT est celle de `mesure-justesse-production.js` : les sets classés par
// D+ DÉBLOQUÉS. Elle ne regarde aucun dossier, et elle a fait ses preuves — 12 cartes
// visées, 12 D+ délivrés, là où une passe au hasard sur bien plus de volume en avait
// délivré ZÉRO.
//
// ============================================================================
// LA CROISSANCE DE LA BASE — 2026-08-30, mesurée avant d'en avoir besoin
// ============================================================================
//   par scan ........... 956 o aujourd'hui + 262 o des 11 champs image = 1 218 o
//                        -> 1,2 Mo pour 1 000 scans
//   par produit ........ catalogue 464 o + numéros 158 o + guide 183 o = 805 o
//                        + descripteur 5 734 o -> 6,5 Mo pour 1 000 produits
//   🔑 LE DESCRIPTEUR PÈSE 7 FOIS TOUT LE RESTE RÉUNI. La croissance de cette base n'est
//      plus pilotée par les scans ni par le catalogue, mais par les images.
//
//   après l'écriture des descripteurs : 455,3 Mo, marge 56,7 Mo
//   la marge tombe à zéro après ~8 664 produits neufs, ou ~46 504 scans, ou un mélange.
//   un import Cardmarket de 2 000 produits en consomme 13,1 Mo.
//   ⚠️ Le rythme observé (6,9 scans/jour sur 29 jours) est celui d'un testeur seul. Il ne
//   prédit RIEN d'un produit lancé et n'est rendu que comme repère.
//   🔑 Supprimer les deux index inutiles rend 17,9 Mo — soit 2 733 produits neufs de plus,
//      et ça ne coûte rien d'autre qu'une décision.
//
// ============================================================================
// L'INDEX RESTREINT EST MORT — 2026-08-29, et la raison est structurelle
// ============================================================================
// La question posée était bonne : pourquoi indexer 69 016 produits quand le départage ne
// tire que sur la cellule ? Réponse mesurée, et elle est sans appel.
//
//   · L'union des viviers des 65 noms de cellule déjà vus = 2 854 produits (2 785 avec une
//     image). 15 Mo à 150 points, contre 378 Mo pour l'index complet. La tentation est
//     réelle.
//   · 🔑 LAISSER-UN-DEHORS : 0 nom sur 65. Zéro. Pour chaque nom, l'index bâti sur tous
//     les autres ne couvre AUCUN de ses candidats.
//   · POURQUOI : `trouverProduitsLocaux` bâtit le vivier PAR LE NOM. Vérifié sur les
//     2 080 paires de noms : 0 partagent le moindre produit. Les viviers PARTITIONNENT le
//     catalogue. Un index restreint aux noms vus n'est donc pas « restreint au domaine
//     utile », c'est un MÉMO DES NOMS DÉJÀ VUS — et pour un nom neuf c'est 0 %, jamais
//     partiellement.
//   · CE QUE ÇA COÛTERAIT : 76,7 % des scans de cellule portent un nom jamais vu (57,9 %
//     sur le dernier quart du journal — ça ne décroît pas). Les 65 noms vus font 1,0 % des
//     6 692 cœurs de nom du catalogue.
//   · 🔴 ET ÇA NE SE RÉPARE PAS TOUT SEUL. Les 1,8 Go d'images sont sur le Bureau du
//     testeur et n'iront jamais sur Render : le serveur ne PEUT PAS indexer un nom neuf à
//     la volée. Chaque nom inconnu serait une abstention DÉFINITIVE jusqu'à un lot local
//     et un téléversement. La restriction ne fait pas gagner de la place, elle crée une
//     dette d'exploitation.
//
// ============================================================================
// LA COLLECTE DE RÉFÉRENCES — CE QUI EST SU AU 2026-08-29
// ============================================================================
// 69 016 idProducts distincts sur le disque, 67 104 appariés au catalogue, 1 912 fichiers
// dont le produit nous est inconnu — TOUS d'idProduct supérieur à 895 905, notre maximum.
// Ce ne sont pas des images en trop : c'est le catalogue qui est en retard.
//
// ⚠️⚠️ TOUT POURCENTAGE DE COUVERTURE CI-DESSOUS SE LIT « CONTRE NOTRE CATALOGUE DU
// 12/07/2026 », JAMAIS « CONTRE CARDMARKET ». L'export a six semaines. Ce n'est pas une
// précaution de style : les 1 912 fichiers orphelins prouvent que Cardmarket a publié des
// produits que notre catalogue ignore, donc nos dénominateurs sont trop petits et nos
// couvertures trop belles. Aucun de ces chiffres ne vaut après un nouvel export.
//
// 🔴 ET LE DÉNOMINATEUR A DÉJÀ ÉTÉ FAUX UNE FOIS — l'erreur mérite d'être écrite.
// J'ai compté les cartes d'un set avec `numeros_cartes.codeSet`. Mais `numeros_cartes` est
// la table de ce qu'on a APPRIS ; elle IGNORE 1 781 produits du catalogue, dont 884 ont
// pourtant une image sur le disque. La liste de Cardmarket, c'est `catalogue_produits`, et
// son découpage à lui est `idExpansion`.
// Le cas qui l'a révélé : Cardmarket affiche 336 cartes pour CSM1DC ; `numeros_cartes` en
// connaissait 301 et je rendais « 99,7 % de couverture ». `catalogue_produits` en compte
// 336 — le vrai chiffre est 300/336 = 89,3 %. Deux galeries entières (PAL, SVP) étaient
// même données à 100 % alors qu'il leur manque 37 et 4 produits.
// ⚠️ RÈGLE : le compte des produits d'un set se prend dans `catalogue_produits` par
// `idExpansion`. `numeros_cartes.codeSet` sert à NOMMER un set, jamais à le compter.
//
// Après correction, contre `catalogue_produits` du 12/07 :
//   · 15 galeries plafonnées (et non 13) : 5 628 produits, 4 500 pris, 1 128 manquants,
//     couverture 80,0 %
//   · le déficit total : 151 expansions incomplètes, 3 610 produits manquants
//     (le chiffre faux disait 97 sets et 2 720 manquants)
//
// ── RENONCEMENT ASSUMÉ : 111 CARTES MARQUÉES `non-collectee` LE 2026-08-29 ──
// Six galeries plafonnées dont le reliquat ne vaut pas un rechargement complet. Ce n'est
// pas un oubli, c'est une décision, et le chiffre est écrit pour qu'on sache ce qu'on a
// renoncé à chercher :
//     PAL     37 · CSM1DC 36 · SVI 15 · PAR 14 · XSV2A  6 · FST  3     -> 111 cartes
// ⚠️ Le chiffre a doublé quand le dénominateur a été corrigé (39 -> 111) : la décision a
// été reprise sur les bons nombres, pas reconduite par inertie. Si un jour un filtre
// permet de reprendre ces galeries à moindres frais, ces 111 sont les premières à
// repasser en `non-collectee` -> `indexee`.
//
// ── L'ANGLE MORT DE `numeros_cartes` — MESURÉ, ET PLUS PETIT QU'IL N'EN A L'AIR ──
// 1 781 produits du catalogue n'ont aucune ligne dans `numeros_cartes`. Décomposés :
//     566 Code Cards  ·  7 scellés  ·  🔑 1 208 cartes ordinaires
// dont 487 ont une image sur le disque.
//
// ✅ CE N'EST PAS UN ANGLE MORT DE PÉRIMÈTRE. `trouverProduitsLocaux` interroge
// `catalogue_produits` (index.js:1772), pas `numeros_cartes` : ces cartes ENTRENT dans les
// viviers. Vérifié en appelant la vraie fonction — 120 sur 120 rendues sur leur propre nom.
//
// ⚠️ MAIS ELLES Y ENTRENT AVEUGLES. Sans ligne dans `numeros_cartes`, un candidat n'a ni
// `numero`, ni `codeSet`, ni `slug` : le chemin du numéro ne l'atteint pas, le scoring ne
// peut pas lui accorder le signal du numéro ni du setCode, et aucune URL Cardmarket n'est
// constructible pour lui. 1 198 des 1 208 partagent leur nom avec un produit bien
// renseigné, donc elles peuplent des viviers réels sans pouvoir y être notées.
//
// 🔑 L'EXPOSITION RÉELLE, PONDÉRÉE PAR LE TRAFIC et non par le catalogue — sur les 141
// noms du journal, 133 viviers de 2 candidats ou plus, 6 587 candidats vus :
//     viviers contenant au moins une carte sans numéro ....... 22 / 133  (16,5 %)
//     candidats sans numéro .................................. 48 / 6 587 (0,7 %)
//     candidats SANS NUMÉRO MAIS AVEC IMAGE .................. 21 / 6 587 (0,3 %)
// Et sur les 71 vérités saisies à la main — le seul matériel non biaisé — ZÉRO est une
// carte sans numéro. L'angle mort ne s'est jamais réalisé sur ce matériel.
// ⚠️ 71 vérités ne peuvent pas exclure un événement à 0,3 % : ça borne l'importance de
// l'angle mort, ça ne le nie pas. Ce n'est pas l'argument chiffré d'une bascule
// d'architecture — la cellule japonaise vintage, elle, l'est.
//
// ✅ AU PASSAGE, UN CHIFFRE QUI COMPTE POUR LA SUITE : les 71 vérités ont TOUTES une image
// sur le disque. Le banc peut donc être rejoué contre l'architecture image sans qu'une
// seule référence manque.
//
// 🔴 BOMBE À RETARDEMENT POUR LE JOUR DU VRAI IMPORT — 26 LIGNES DIVERGENTES.
// `numeros_cartes` porte SA PROPRE copie d'`idExpansion`, sur 69 231 lignes. Elle diverge
// déjà de `catalogue_produits` sur 26 d'entre elles, et un réimport creusera l'écart en
// silence : `import-catalogue.js` met à jour UNE collection, jamais l'autre.
//   WCD18 = 21 lignes (numeros_cartes dit 1645, le catalogue dit 2396)
//   SEA=1 (5834/5802) · MEP=1 (6232/6443) · M-P/ID=1 (6393/6392) · FL=1 (1544/1543)
//   PR=1 (2107/6395)
// ⚠️ AUCUNE DES 26 NE PORTE DE `setTcgdex` APPRIS : la divergence ne coûte rien
// aujourd'hui, et c'est précisément pour ça qu'elle passera inaperçue jusqu'au jour où
// elle coûtera. Le jour du vrai import : relever la liste AVANT, la relever APRÈS, et
// traiter tout écart nouveau comme un défaut, pas comme une surprise.
// `mesure-diff-catalogue.js` le fait, et prédit les divergences nouvelles avant l'import.
//
// ============================================================================
// ⚠️ CE QUI DEVRA ÊTRE RECALCULÉ APRÈS UN NOUVEL EXPORT DU CATALOGUE
// ============================================================================
// À relire avant de raisonner sur un chiffre de ces deux journées.
//
// PÉRIMÉ DÈS L'IMPORT — tout ce qui a `catalogue_produits` au dénominateur :
//   · A / B / C de l'audit (67 104 / 3 871 / 1 912). C tombera, A montera, et B MONTERA
//     aussi : les produits nouveaux arrivent sans image.
//   · la liste de travail (151 expansions, 3 610 manquants) et les 15 galeries plafonnées.
//   · les 1 781 produits ignorés par `numeros_cartes`, et les 906 « sans numéro ».
//   · 🔑 LE COÛT DE LA RÈGLE STRICTE — 7,6 % / 8,4 % de groupes touchés. C'est le chiffre
//     qui a justifié d'adopter la garde d'abstention telle quelle. Des produits neufs et
//     sans image le feront MONTER. Il doit être repris, et la règle rediscutée s'il passe
//     le quart.
//   · la couverture du pont TCGdex (213 sets, 22 626 cartes, 32,7 %) : les produits neufs
//     arrivent sans `setTcgdex`, donc la part pontée baisse mécaniquement.
//   · la liste des sets éligibles à la mesure occidentale, et ses colonnes « pontés/total ».
//
// PAS TOUCHÉ — ne pas le recalculer par excès de zèle :
//   · le résultat du chantier image : 10/11 au rang 1 sur 449, 6/6 dans la cellule.
//   · le témoin rendus TCGdex : 14/18 au rang 1, inliers médians 9 contre 7,5.
//   · les statistiques du journal (total lu 93,2 % en occidental contre 44,4 % en
//     asiatique, 3 échecs occidentaux tous `egalite-parfaite`) : elles portent sur des
//     scans passés, pas sur le catalogue.
//   · la démonstration que la sélection des 300 est déterministe : elle repose sur les
//     fichiers, pas sur la base.
//
// 🔴 LE PLAFOND À 300. Quinze galeries s'arrêtent à EXACTEMENT 300 fichiers et 10 pages.
// Sur les 770 galeries du disque, AUCUNE ne dépasse 300, AUCUNE n'a de page 11. Les
// produits manquants de ces quinze sets sont dispersés dans l'alphabet (rang moyen 0,44
// à 0,53), donc ce n'est pas « il a pris le début de la liste ». Et cinq de ces galeries
// s'arrêtent à 300 alors qu'il ne restait qu'entre 1 et 15 cartes à prendre.
// L'explication qui tient est un PLAFOND DE LA GALERIE CARDMARKET, pas une lassitude du
// testeur. CONFIRMÉ À L'ÉCRAN le 2026-08-29 : la galerie Singles de MC affiche
// « Page 1 of 10 » quand l'expansion en annonce 774.
//
// ⚠️ MAIS LES 300 NE SONT PAS « LES 300 PREMIERS ». C'est la contradiction que le testeur
// a relevée et elle tient : si la galerie servait un préfixe, les manquants seraient la
// queue de l'ordre. Testé sur MC (le seul set assez déséquilibré pour que le test ait de
// la puissance : 300 pris, 474 laissés), rang moyen normalisé des PRÉSENTS —
//   préfixe parfait vaudrait 0,194 · une sélection sans ordre vaudrait 0,500
//   idProduct 0,348 · dateAdded 0,348 · numéro 0,348 · idMetacard 0,490 · nom 0,504
// Aucun ordre connu de la base ne produit ces 300. Ni le nom, ni le numéro, ni
// l'identifiant, ni la date d'ajout, ni le regroupement des impressions.
// ⚠️ ET CE N'EST PAS NON PLUS UN FILTRE SUR L'OFFRE : 100 % des présents ET 100 % des
// manquants ont une entrée dans `guide_prix`. L'hypothèse « la galerie ne montre que ce
// qui est en vente » est morte.
//
// ✅ EN REVANCHE LA SÉLECTION EST DÉTERMINISTE, et ça se prouve sans rien ouvrir : sur les
// 15 galeries plafonnées, 10 pages de 30 rendent 300 idProducts DISTINCTS — 150
// chargements de page, zéro doublon, zéro trou. Si l'ordre avait bougé entre deux pages,
// un produit serait revenu et un autre serait passé à travers. Deux passages identiques
// rendraient donc les mêmes 300 : réenregistrer ne sert à rien, CHANGER LE TRI est la
// seule voie — et pour un set de plus de 600 cartes, le tri ne suffira pas non plus,
// parce que le MILIEU de tous les ordres reste hors d'atteinte. Là, il faut un FILTRE
// qui ramène la population sous 300.
//
// ============================================================================
// `references_image` — LA COLLECTION QUI DIT CE QU'ON PEUT INDEXER. ADOPTÉE.
// ============================================================================
// Collection DÉDIÉE, clé `idProduct`. ⚠️ PAS un champ de `catalogue_produits` :
// `import-catalogue.js` réécrit cette collection à chaque import et le constat serait
// perdu sans que personne ne s'en aperçoive.
//
//   references_image : { idProduct, etat, constateLe, source }
//      etat = 'indexee'        un vecteur existe
//           | 'absente'        vérifié chez Cardmarket : il n'y a pas d'image.
//                              PROPRIÉTÉ DU PRODUIT.
//           | 'non-collectee'  le set n'a pas été enregistré. PROPRIÉTÉ DE NOTRE TRAVAIL.
//
// Un booléen mentirait : il confondrait « on a vérifié, il n'y en a pas » et « on n'a pas
// regardé ». Ce sont deux choses différentes et une seule se répare.
//
// 🔴🔴 LE RACCOURCI QU'IL NE FAUT PAS PRENDRE, ÉCRIT EN TOUTES LETTRES.
// Le départage par l'image ne se déclenche QUE SI TOUS les candidats du groupe sont
// `indexee`. Un seul candidat en `absente` ou en `non-collectee` -> ABSTENTION.
//
// Il sera tentant, dans six mois, d'écrire ceci en croyant optimiser :
//     « ce candidat n'a pas de vecteur, il ne peut pas gagner de toute façon,
//       donc je le retire du groupe et je départage les autres. »
// C'EST FAUX, ET C'EST FABRIQUER UNE VICTOIRE. Si la carte réelle est justement celle
// qui n'a pas de référence, l'appariement ne peut pas la désigner : il désignera un
// AUTRE candidat, et il le désignera AVEC ASSURANCE, puisque plus rien ne lui fait
// concurrence. Retirer le candidat aveugle ne supprime pas l'incertitude, il supprime
// la trace de l'incertitude. Le score monte, la justesse baisse, et rien dans les
// chiffres ne le montre.
// `absente` et `non-collectee` se valent donc DEVANT LA GARDE. Leur différence sert à la
// liste de travail — retaper ou ne pas retaper — et à rien d'autre.
//
// ⚠️ ET « LE GROUPE » DOIT ÊTRE DÉFINI, SINON LA RÈGLE CHANGE DE PRIX. Mesuré ce jour :
//     groupe = le VIVIER ENTIER du nom ....... 56,4 % des groupes touchés (trafic réel)
//     groupe = (nom, codeSet) ................  7,6 %
//     groupe = idMetacard (Cardmarket) .......  8,4 %
// Le vivier n'est pas le groupe de départage : c'est la présélection, et 58 viviers sur
// 133 y dépassent 50 candidats. Exiger une référence pour chacun des 80 « Arcanine » du
// catalogue reviendrait à exiger la collecte complète pour séparer deux finitions.
// LE GROUPE EST L'ENSEMBLE QUE LE SCORING LAISSE À ÉGALITÉ, au grain de `idMetacard` —
// les tirages d'une même carte. À ce grain la règle stricte coûte moins d'un groupe sur
// dix, et environ un cinquième de ce coût est définitif (produits sans numéro, scellés
// et cartes-codes, qui n'auront jamais d'image). Le reste diminue à mesure que la
// collecte se termine.
const axios = require('axios');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');

const TOUT = process.argv.includes('--tout');
const CONCURRENCE = 12;
const pc = (n, d) => d ? `${(100 * n / d).toFixed(1)} %` : '—';

async function jsonTCGdex(chemin) {
    try { return (await axios.get(`https://api.tcgdex.net/v2/${chemin}`, { timeout: 25000 })).data; }
    catch (e) { return null; }
}

// UNE IMAGE EXISTE QUAND UN OCTET EST SERVI, pas quand un champ est présent.
// TCGdex sert ses assets sous `{image}/{qualite}.{extension}` : on essaie les formes
// documentées dans l'ordre, et la PREMIÈRE qui rend 200 suffit.
const FORMES = ['/high.png', '/low.png', '/high.webp', '/low.webp'];
async function imageServie(base) {
    if (!base) return { ok: false, forme: null, raison: 'aucun champ image' };
    for (const forme of FORMES) {
        try {
            const r = await axios.head(`${base}${forme}`, { timeout: 12000 });
            const ct = String(r.headers['content-type'] || '');
            if (r.status === 200 && ct.startsWith('image/')) return { ok: true, forme, ct };
        } catch (_) { /* forme suivante */ }
    }
    return { ok: false, forme: null, raison: 'aucune forme ne rend 200' };
}

// Petit ordonnanceur : `CONCURRENCE` requêtes en vol, pas plus. Sans lui, un set de 157
// cartes ouvre 157 connexions d'un coup et TCGdex répond 429 — ce qui produirait des
// « images absentes » qui sont en réalité notre propre impatience.
async function enParallele(items, n, travail) {
    const out = new Array(items.length);
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
        while (true) {
            const k = i++;
            if (k >= items.length) return;
            out[k] = await travail(items[k], k);
        }
    }));
    return out;
}

(async () => {
    const setsJa = await jsonTCGdex('ja/sets');
    if (!Array.isArray(setsJa)) { console.error('❌ /v2/ja/sets injoignable.'); process.exit(1); }
    console.log(`espace des sets JAPONAIS chez TCGdex : ${setsJa.length} sets\n`);

    // ─── APPARIEMENT, MONTRÉ ET NON AFFIRMÉ ──────────────────────────────
    // La seule clé numérique disponible des deux côtés est le NOMBRE DE CARTES. Notre
    // table porte `prod` (produits Cardmarket de l'expansion), TCGdex porte
    // `cardCount.total` / `.official`. Ce ne sont pas la même grandeur — d'où l'affichage
    // des candidats plutôt qu'un choix silencieux.
    const nb = s => [s.cardCount?.total, s.cardCount?.official].filter(x => Number.isFinite(x));
    const apparies = [], ambigus = [], sansCandidat = [];
    for (const notre of SETS_VINTAGE_JAPONAIS) {
        const cands = setsJa.filter(s => nb(s).includes(notre.prod));
        if (cands.length === 1) apparies.push({ notre, ja: cands[0], preuve: `cardCount == prod (${notre.prod})` });
        else if (cands.length > 1) ambigus.push({ notre, cands });
        else sansCandidat.push(notre);
    }
    // ⚠️ L'AMBIGUÏTÉ SE LIT DANS LES DEUX SENS, ET LA PREMIÈRE VERSION N'EN VOYAIT QU'UN.
    // Elle demandait « combien de sets japonais ont ce nombre de cartes ? » et déclarait
    // « sans ambiguïté » dès qu'il n'y en avait qu'un. Elle ne demandait jamais « combien
    // de NOS sets tombent sur le MÊME set japonais ? » — d'où deux lignes fausses dans le
    // premier tableau : ROG et DP5c appariés tous les deux à PMCG4 (65 cartes chacun), et
    // MCDP (24) apparié à SMP2 « 名探偵ピカチュウ » (Detective Pikachu), qui n'a rien à voir.
    // Une bijection ne se vérifie pas d'un seul côté.
    const parJa = new Map();
    for (const a of apparies) parJa.set(a.ja.id, [...(parJa.get(a.ja.id) || []), a]);
    const collisions = [...parJa.values()].filter(v => v.length > 1);
    const retenus = apparies.filter(a => (parJa.get(a.ja.id) || []).length === 1);
    for (const groupe of collisions) ambigus.push({ notre: groupe[0].notre, cands: [groupe[0].ja], collision: groupe.map(g => g.notre.code) });

    console.log('═'.repeat(96));
    console.log(`APPARIEMENT DES ${SETS_VINTAGE_JAPONAIS.length} SETS DE LA TABLE CLOSE`);
    console.log('═'.repeat(96));
    console.log(`   appariés en BIJECTION (un seul candidat, et personne d'autre dessus) : ${retenus.length}`);
    console.log(`   AMBIGUS : ${ambigus.length}`);
    for (const a of ambigus) {
        console.log(`      ${String(a.notre.code).padEnd(8)} prod=${String(a.notre.prod).padEnd(4)} "${a.notre.nom}" -> ${a.cands.map(c => `${c.id}(${c.name})`).join(' | ')}` +
            (a.collision ? `   ⚠️ COLLISION : ${a.collision.join(' et ')} visent le même set japonais` : ''));
    }
    console.log(`   SANS CANDIDAT : ${sansCandidat.length}`);
    for (const s of sansCandidat) console.log(`      ${String(s.code).padEnd(8)} prod=${String(s.prod).padEnd(4)} "${s.nom}"`);
    console.log('   ⚠️ Les ambigus et les sans-candidat NE SONT PAS MESURÉS ci-dessous : les');
    console.log('      trancher demanderait un appariement par le nom, et c\'est exactement');
    console.log('      ce que cette mesure s\'interdit.');

    // ─── LA MESURE D'IMAGES ──────────────────────────────────────────────
    const aMesurer = TOUT
        ? setsJa.map(s => ({ notre: null, ja: s, preuve: '--tout' }))
        : retenus;

    console.log('\n' + '═'.repeat(96));
    console.log('COUVERTURE D\'IMAGES, SET PAR SET (HEAD sur l\'asset, pas la présence du champ)');
    console.log('═'.repeat(96));
    console.log(`${'code'.padEnd(8)} ${'set TCGdex'.padEnd(12)} ${'cartes'.padStart(6)} ${'champ img'.padStart(10)} ${'SERVIES'.padStart(8)} ${'couverture'.padStart(11)}   nom`);
    console.log('─'.repeat(96));

    let totalCartes = 0, totalChamp = 0, totalServies = 0;
    const lignes = [];
    for (const { notre, ja, preuve } of aMesurer) {
        const detail = await jsonTCGdex(`ja/sets/${encodeURIComponent(ja.id)}`);
        const cartes = Array.isArray(detail?.cards) ? detail.cards : [];
        const avecChamp = cartes.filter(k => k.image);
        const res = await enParallele(avecChamp, CONCURRENCE, k => imageServie(k.image));
        const servies = res.filter(r => r.ok).length;
        totalCartes += cartes.length; totalChamp += avecChamp.length; totalServies += servies;
        lignes.push({ notre, ja, cartes: cartes.length, champ: avecChamp.length, servies, preuve });
        console.log(
            `${String(notre?.code ?? '—').padEnd(8)} ${String(ja.id).padEnd(12)} ${String(cartes.length).padStart(6)} ` +
            `${String(avecChamp.length).padStart(10)} ${String(servies).padStart(8)} ${pc(servies, cartes.length).padStart(11)}   ${ja.name}`
        );
    }

    console.log('─'.repeat(96));
    console.log(`${'TOTAL'.padEnd(21)} ${String(totalCartes).padStart(6)} ${String(totalChamp).padStart(10)} ${String(totalServies).padStart(8)} ${pc(totalServies, totalCartes).padStart(11)}`);

    console.log('\n' + '═'.repeat(96));
    console.log('CE QUE ÇA DIT DU CHANTIER « RECONNAISSANCE PAR L\'ILLUSTRATION »');
    console.log('═'.repeat(96));
    console.log(`   sets mesurés            : ${lignes.length} / ${SETS_VINTAGE_JAPONAIS.length} de la table close`);
    console.log(`   cartes couvertes        : ${totalServies} / ${totalCartes}  (${pc(totalServies, totalCartes)})`);
    const vides = lignes.filter(l => l.servies === 0);
    const partiels = lignes.filter(l => l.servies > 0 && l.servies < l.cartes);
    console.log(`   sets SANS AUCUNE image  : ${vides.length}${vides.length ? ' -> ' + vides.map(l => l.notre?.code ?? l.ja.id).join(', ') : ''}`);
    console.log(`   sets PARTIELS           : ${partiels.length}${partiels.length ? ' -> ' + partiels.map(l => `${l.notre?.code ?? l.ja.id} (${l.servies}/${l.cartes})`).join(', ') : ''}`);
    console.log('\n   ⚠️ CE CHIFFRE NE COUVRE QUE LES SETS APPARIÉS SANS AMBIGUÏTÉ. Les autres ne');
    console.log('      sont pas « sans images » : ils sont NON MESURÉS. Ne pas les compter comme');
    console.log('      des zéros — ce serait relire une absence comme une valeur contraire, la');
    console.log('      huitième erreur d\'instrument de la semaine.');
})().catch(e => { console.error(e.stack); process.exit(1); });
