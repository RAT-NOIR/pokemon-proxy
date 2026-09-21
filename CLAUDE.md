# Notes du chantier — règles de travail dans ce dépôt

Ce fichier est chargé au début de chaque session. Ce qui est écrit ici ne se
renégocie pas en cours de route.

---

## 🎯 L'OBJECTIF DU CHANTIER : 100 % DU CATALOGUE CARDMARKET

> # **100 %. Pas 81 %, pas 95 %.**
>
> **Cardmarket est la RÉFÉRENCE DU LISTING. Un catalogue qui n'en couvre pas la totalité n'est pas une
> référence — c'est un échantillon.** Et l'unité de la cible n'est pas le set, ni l'expansion, ni le
> pourcentage : **c'est le PRODUIT**. Chaque produit absent est une carte que l'outil de
> reconnaissance ne saura jamais nommer, quel que soit le reste de la chaîne. Un modèle parfait sur un
> catalogue à 95 % se trompe sur 5 % des scans, définitivement, et aucune amélioration en aval ne le
> rattrape.
>
> 🔑 **CE QUE CET OBJECTIF CHANGE DANS LA MÉTHODE, ET C'EST LE POINT : UN TAUX QUI MONTE N'EST PLUS UNE
> BONNE NOUVELLE EN SOI.** Tant que la cible était « le plus possible », un gain se célébrait. Avec
> 100 % pour cible, **la seule question qui compte est le RESTE** : combien, où, et pourquoi. Un
> rapport qui annonce un progrès sans décomposer ce qui manque ne dit rien d'utile.
>
> ⚠️ **ET UN RESTE N'EST PAS UNE LIMITE TANT QU'ON N'A PAS NOMMÉ SA CAUSE.** Le catalogue d'erreurs
> ci-dessous existe parce que, huit fois, ce qu'on avait rangé en « impossible » était une sonde
> étroite, un filtre survivant, une source jamais interrogée ou un champ mal nommé. **La barre à
> franchir avant d'écrire « hors d'atteinte » est donc haute, et elle est écrite : dire QUEL
> instrument a cherché, QUELLES sources ont été interrogées, et à QUELLE date (§36).**
>
> 🔴 **LA SEULE CATÉGORIE QUI BORNE VRAIMENT : « aucune page chez AUCUNE source ».** Ni « refusé », ni
> « sans ligne », ni « pas encore collecté » — ceux-là sont des états de NOTRE travail, pas des
> propriétés du monde. Le plancher réel est le nombre de produits pour lesquels il n'existe, nulle
> part, de document à lire. **C'est ce chiffre-là qui dit si 100 % est atteignable, et lui seul.**

---

## 🔑 EN TÊTE DU CATALOGUE D'ERREURS — LE MOTIF DOMINANT DE CE CHANTIER

> # 🔴 LA SONDE FABRIQUE LE DÉFAUT QU'ELLE MESURE.
>
> ### « Le collecteur savait lire, c'est ma mesure écrite à côté qui ne savait pas. »
>
> **Trois fois en deux jours, l'anomalie n'était pas dans les données ni dans le code de production :
> elle était dans l'OUTIL QUI REGARDAIT.** Et chaque fois, l'outil rendait un résultat parfaitement
> plausible — un vide, une ambiguïté, un doublon — qui ressemblait à une découverte.
>
> | ce que ma sonde a annoncé | ce qu'elle faisait | la vérité |
> |---|---|---|
> | « 0 page porte un `fr` » | ne lisait que les gabarits nommés `*infobox*` | **261 pages**, le `fr` vit dans `{{Langtable}}` |
> | « 61 produits pour 30 numéros, chaque numéro désigne deux cartes » | `chiffres()` réduisait « 1N » et « 1S » à « 1 » | **61 numéros distincts, 0 ambigu** |
> | « 4 kits sans aucune carte déclarante » | appariait le slug Cardmarket au nom Bulbapedia | **10 kits sur 11 ont leurs cartes** |
>
> 🔑 **LA CONSÉQUENCE PRATIQUE, ET ELLE EST MÉCANIQUE : avant de conclure qu'une donnée est ABSENTE ou
> FAUSSE, vérifier que l'outil qui la lit lit la MÊME CHOSE que le code de production. Si les deux
> divergent, c'est l'OUTIL qu'on ouvre, pas la donnée.** `cleNumero` gardait le suffixe « N » depuis
> neuf jours, pour cette raison exacte, et ma mesure écrite à côté utilisait `chiffres()`. Le dépôt
> portait déjà la bonne lecture ; je ne m'en servais pas pour mesurer.
>
> ⚠️ **C'est le §21 bis (« corrigé d'un côté, laissé de l'autre ») déplacé d'un cran** : la règle
> n'est plus dupliquée entre deux fichiers de production, elle est dupliquée entre la PRODUCTION et
> l'INSTRUMENT. Et cette copie-là est invisible, parce qu'un outil de mesure n'a pas de tests, ne
> casse jamais, et n'est lu par personne.

---

## 🔑 LES TROIS LEÇONS DU SOIR DU 2026-09-21 — TROIS FAÇONS DE SE CROIRE COUVERT

> ### 1. « Un outil qui interroge UNE source et nomme son résultat “aucune” ment par construction. »
>
> `sourceDe(code, source)` porte `if (source !== 'artofpkm') return null`. Toute question posée à ce
> module ne peut donc recevoir qu'une réponse sur artofpkm — et le champ qu'elle remplit s'appelle
> « sans source ». **226 sets, 15 065 cartes, rangés « aucune source d'images » par une fonction qui
> n'en connaît qu'une**, pendant que `collecteur-images-bulba.js` sert une deuxième route sans jamais
> ouvrir ce module.
> 🔴 **LE DÉFAUT N'EST PAS DANS LA FONCTION, IL EST DANS LE NOM DE SON RÉSULTAT.** `sourceDe` répond
> exactement à ce qu'on lui demande ; c'est l'appelant qui a écrit « aucune » là où la seule phrase
> vraie était « pas chez artofpkm ». **Un quantificateur — “aucune”, “toutes”, “jamais” — ne peut pas
> être plus large que l'instrument qui l'a produit**, et c'est le §36 exactement (« la phrase *aucune
> source* est interdite sans la liste de celles qu'on a interrogées »), cette fois non pas dans un
> paragraphe mais dans un nom de variable. ⚠️ **Le test : si j'ajoutais une source demain, cette
> réponse changerait-elle sans que le code change ?** Si oui, le mot est trop grand.

> ### 2. « Poussé n'est pas déployé, et la question n'avait de réponse NULLE PART. »
>
> Trois gardes comparaient déjà à `origin/main` — les sources, l'aiguillage, la ligne de table. **Les
> trois étaient vertes** quand les 37 sets remis en file sont ressortis refusés en une seconde : elles
> répondaient à *« le code est-il poussé ? »* quand la question était *« le code TOURNE-t-il ? »*.
> Entre les deux il y a un redéploiement que personne ne mesurait, et il a fallu déduire le commit du
> worker d'une **distribution de largeurs d'images**.
> ✅ **CORRIGÉ, PAS SEULEMENT ÉCRIT : `verrou.commit`.** Un verrou disait qui tient, où, depuis quand —
> jamais avec quel code. Il l'écrit maintenant à la prise ET à chaque battement, et `remettre-en-file.js`
> refuse d'écrire quand le commit du worker ne contient pas le dernier changement de la règle dont la
> remise en file dépend (`git merge-base --is-ancestor`).
> 🔑 **ET LA PROPRIÉTÉ QUI REND LA GARDE UTILISABLE TOUT DE SUITE EST L'ABSENCE DU CHAMP** : un
> détenteur qui n'écrit pas son commit tourne forcément sur du code antérieur à cette ligne. **Le champ
> manquant EST la réponse**, pas un trou — on n'a donc pas à attendre que tout soit à jour pour que la
> garde serve. ⚠️ Et la bonne formulation n'est pas « le worker est-il à jour ? », qui ne veut rien
> dire, mais **« son commit contient-il la règle dont je m'apprête à dépendre ? »** — une question qui
> se prouve, fichier par fichier.

> ### 3. « Citer un paragraphe n'est pas l'appliquer. »
>
> `remettre-en-file.js` s'ouvre sur *« 🔑 ET LA RAISON D'ÊTRE EST LE §23 »* et cite la leçon en entier.
> Le §23 dit, en toutes lettres : *« un seuil vit dans le PROCESSUS, pas dans le dépôt… la remise en
> file ne vaut que si le worker a été redéployé — à vérifier, pas à supposer »*. **L'outil ne vérifiait
> pas.** Il portait la référence, le raisonnement, et pas le geste.
> 🔴 **C'EST LA FORME LA PLUS TROMPEUSE D'ERREUR DE CE DÉPÔT, ET ELLE EST DÉJÀ AU §21 bis : un
> commentaire juste rend le code d'à côté plus CRÉDIBLE, pas plus CORRECT.** Une citation de § est un
> signal de sérieux — c'est précisément pour ça qu'elle endort la relecture. ⚠️ **La règle : tout § cité
> dans un en-tête doit correspondre à une ligne EXÉCUTABLE du fichier, ou la citation se retire.** Et la
> question de relecture se formule sans ouvrir le paragraphe : *ce fichier cite un §  — quelle ligne
> l'applique ?* S'il n'y en a pas, le commentaire est une décoration qui coûte cher.

---

## 🔑 LES TROIS LEÇONS DU 2026-09-21 — TROIS FAÇONS DE PERDRE DU TRAVAIL SANS UNE SEULE ERREUR

> ### 1. « Quand une limite tombe, le geste suivant est un `grep` : QUI l'appliquait ? »
>
> **Un paragraphe corrigé ne décâble rien.** Le §28 (« le chinois est irréductible ») est tombé le
> 2026-09-20 ; le lendemain, **deux `filter()` l'appliquaient encore** dans deux générateurs —
> `langueAsiatique()` et `!/chinois|asiatique/.test(u.famille)`. Coût : **49 expansions, 4 168
> produits, jamais même CANDIDATES.**
> 🔴 **ET UN FILTRE EST LA PIRE FORME DE DÉCISION PÉRIMÉE, parce qu'il ne produit pas un refus : il
> produit une ABSENCE.** Un refus est daté, motivé, listé — donc relisible (§23). Une expansion qu'un
> filtre empêche d'exister ne figure dans aucune liste, ne réclame rien, et son absence ressemble
> exactement à un monde où elle n'a jamais existé. **Relire ses refus ne suffit pas : il faut relire
> ce qui n'a jamais eu le droit d'en devenir un.**

> ### 2. « Une sonde qui se rabat sur du vide EN SILENCE ment toujours dans le même sens. »
>
> `try { MAIN = require('./table-sets.js').TABLE_SETS || []; } catch {}` — **l'export s'appelle
> `TABLE`.** Le champ n'existe pas, `|| []` en fait un résultat plausible, le `catch` vide avalerait
> même une erreur s'il y en avait une. **Trois protections qui, ensemble, garantissent qu'aucune faute
> ne se voie.** Annoncé : « 152 expansions, 9 144 produits sans ligne ». Réel : **134 / 8 467**.
> 🔑 **ET LE BIAIS A UNE DIRECTION, CE QUI LE REND PRÉVISIBLE : un repli sur le vide gonfle toujours
> ce qui MANQUE et rabote ce qu'on POSSÈDE.** Il ne produit jamais un faux optimisme — il produit un
> faux chantier. C'est pour ça qu'il survit : le chiffre a l'air d'une découverte, et on se met au
> travail dessus. ⚠️ **Un `|| []`, un `?? 0`, un `catch {}` sur une LECTURE de configuration ne sont
> pas des précautions, ce sont des bâillons.** Sur un outil de mesure : échouer, ou imprimer le repli.
> **Le dénominateur l'aurait dit** — « table à la main : 0 ligne » se serait vu au premier coup d'œil.

> ### 3. « Une ligne à la main sans marqueur est une ligne qu'une régénération efface sans erreur. »
>
> `generer-table-auto.js` ne reconduit du fichier précédent que les lignes portant `auto.aLaMain`.
> **Les 49 lignes chinoises de septembre — dont 42 vérifiées et collectées — ne l'avaient pas**, et ce
> générateur EXCLUT le chinois : il ne les aurait pas refabriquées. La prochaine régénération les
> effaçait, sans exception, sans avertissement, avec un « ÉCRIT : 535 lignes » parfaitement normal.
> 🔑 **LA RÈGLE : tout ce qu'un outil ne sait pas REFABRIQUER doit porter la marque de sa
> conservation, et cette marque se pose DANS LE MÊME GESTE que l'écriture à la main.** Posée plus
> tard, elle dépend de quelqu'un qui se souvient. ⚠️ **Et le test se formule sans lire le code : « si
> je relance le générateur, qu'est-ce qui disparaît ? »** S'il faut ouvrir la source pour répondre, la
> réponse est déjà mauvaise.

---

## 🔑 ET LES DEUX RÉFLEXES QUI ONT LE PLUS RAPPORTÉ

> ### « Quand ton chiffre dit 251 et le mien 0, c'est le MIEN qu'on ouvre. »
>
> **L'asymétrie n'est pas une politesse envers celui qui annonce, elle est dans la NATURE des deux
> résultats.** Zéro est ce que rend un instrument cassé, un filtre trop étroit, un champ mal nommé, une
> requête qui n'a pas vu le suffixe. Un chiffre non nul a au moins dû trouver quelque chose. **Devant un
> désaccord, le vide est toujours le suspect le plus probable** — et six fois sur six dans ce dépôt, il
> l'était. (§30 les promos ID/TH · §33 `verif` contre `verification` · §28 le chinois · §27 les dates ·
> §36 le `fr` du `Langtable` · §21 n°7 les listes tronquées à 100.)

> ### 🔴 « On a écrit QUE ÇA NE SE DEVINE PAS sans vérifier qu'on n'avait pas à deviner. »
>
> **C'est le pendant exact du zéro, et c'est la pire des sept limites tombées — parce que la source
> n'était ni chez un tiers, ni sous licence, ni à collecter : ELLE ÉTAIT DÉJÀ DANS NOTRE BASE.** Le §26
> disait « la ponctuation est perdue et ne se devine pas ». Les deux moitiés sont vraies : le slug
> Cardmarket n'a pas la virgule, et inventer une ponctuation serait deviner. **Mais `bulba.expansion`
> la porte, sur 380 sets dont le nom nu est identique au nôtre, depuis la première collecte.** 28 sets
> ont attendu neuf jours un `updateOne` de zéro requête.
>
> 🔑 **LA QUESTION À POSER, ET ELLE VIENT AVANT « OÙ TROUVER ? » : QU'EST-CE QU'ON A DÉJÀ ?** Devant un
> « c'est impossible », l'inventaire de ce qui est en base passe avant la recherche d'une source. Nous
> collectons depuis des semaines des champs que personne ne relit ensuite pour répondre à une AUTRE
> question que celle qui les a fait collecter. **Une donnée collectée pour un usage ne se range pas
> toute seule à côté des questions qu'elle résout.**
>
> ⚠️ Et c'est la même asymétrie que le zéro : *« je n'ai pas trouvé »* et *« ça n'existe pas »* sont
> deux phrases différentes, et *« ça ne se devine pas »* en est une troisième — elle ne dit rien de ce
> qu'on possède déjà. **Les trois se distinguent en NOMMANT ce qui a été regardé.**

> ### « Un contrôle qui devient parfait en rétrécissant son périmètre est un FAUX, pas une réussite. »
>
> Le décalage des Trainer Kits rendait **« 100 % de couverture, 0 ambigu »** — en poussant la moitié des
> cartes hors de la plage comparée. Le contrôle n'était pas satisfait, il était **vidé**. La question à
> poser devant tout contrôle qui s'améliore après un changement : *ai-je amélioré l'appariement, ou
> retiré des candidats ?* Un dénominateur qui rétrécit pendant qu'un taux monte est le signal (§0, §34).

---

## 42. « AUCUNE SOURCE » ÉTAIT UNE FONCTION QUI N'EN CONNAÎT QU'UNE — 2026-09-21

**Le chiffre à instruire était « 179 sets, 10 421 cartes, sans AUCUNE source d'images ». Remesuré
avec son dénominateur : 226 sets, 15 065 cartes — et la phrase est fausse dans les deux moitiés.**

🔴 **D'ABORD LE 179 ÉTAIT LUI-MÊME PRODUIT PAR UN FILTRE.** Dans `remettre-en-file.js`, le test
`if (u.etat === 'attente') continue` vient AVANT le test de source : tout set déjà en file sortait
de la boucle sans jamais être compté comme « sans source ». **Un set n'était pas classé selon ce
qu'il EST, mais selon l'endroit de la boucle où il sortait.** C'est le §39 dans un outil que je
venais d'écrire, et l'ordre de deux `continue` suffit à le produire.

🔴 **ET « AUCUNE SOURCE » NE VOULAIT DIRE QUE « PAS CHEZ ARTOFPKM ».** La ligne 80 de
`sources-sets.js` est `if (source !== 'artofpkm') return null`. Une seule source interrogée, et le
résultat nommé « aucune » — la phrase que le §36 interdit explicitement. **Or `collecteur-images-
bulba.js` n'ouvre JAMAIS `sources-sets.js`** : il résout le fichier depuis le wikitext DE LA CARTE,
déjà archivé sur R2. Sa disponibilité ne se déclare nulle part, donc elle ne pouvait pas manquer à
un inventaire des déclarations. **Mesuré : les 226 sets, soit 15 065 cartes, portent leur wikitext
archivé. ZÉRO n'en manque.** La condition nécessaire de la route Bulbapedia est remplie PARTOUT.

**LA DÉCOMPOSITION DEMANDÉE — 226 sets, 15 065 cartes, dénominateur 568 lignes admises :**

| tirage | sets | cartes | la source a-t-elle été CHERCHÉE ? |
|---|---|---|---|
| **intl** (occidental) | **135** | **5 976** | 🔴 **non** — et c'est la population pour laquelle `collecteur-images-bulba.js` a été ÉCRIT (`tirage: 'intl'` en dur). Skyridge, Supreme Victors, Legends Awakened y sont, et ils sont déjà passés en file. |
| **zh-hans** | 52 | 5 534 | ⚠️ **mesurée depuis — voir l'encadré ci-dessous. Le paramètre était un blocage RÉEL mais pas LA cause.** |
| **jp** | 25 | 1 269 | ⚠️ partiellement — artofpkm couvre le japonais, ces 25 n'y ont pas de correspondance de NOM (§30 : une correspondance absente n'est pas un set absent) |
| **zh-hant** | 8 | 1 251 | 🔴 non — même paramètre en dur |
| **id · th · idth** | 6 | 1 035 | 🔴 non — les pages existent (§30 : 55 pages « Promotional cards », 1 620 produits) |

| type (§37) | sets | cartes |
|---|---|---|
| extension | 154 | 10 258 |
| promo | 34 | 2 110 |
| deck | 17 | 1 511 |
| non typé | 21 | 1 186 |

🔑 **LA RÉPONSE À LA QUESTION POSÉE, EN UNE LIGNE : SUR LES 226, LA SOURCE N'A ÉTÉ CHERCHÉE NULLE
PART.** Elle a été DÉCLARÉE absente par une table qui ne décrit qu'un fournisseur, pour une question
— « ce set peut-il recevoir des images ? » — à laquelle cette table ne répond pas. Aucun des 226
n'a fait l'objet d'une recherche chez Bulbapedia, chez PKMJP, ni ailleurs.
⚠️ **Et le plus gros bloc n'attend AUCUNE découverte : 135 sets occidentaux, 5 976 cartes, relèvent
d'une route déjà en production.** Ce n'est pas un chantier de source, c'est une file à remplir.
🕳️ **Le second bloc — 60 sets chinois, 6 785 cartes — attend UN PARAMÈTRE**, `tirage` au lieu de
`'intl'` en dur, et ensuite une vérification que Bulbapedia porte bien des fichiers pour ces
tirages. **La première moitié est gratuite ; la seconde est la vraie question, et elle n'a pas
encore été posée.**

### 🔴 LA QUESTION A ÉTÉ POSÉE LE SOIR MÊME, ET MA PRÉVISION ÉTAIT FAUSSE — 2026-09-21

**J'avais écrit « ce n'est pas une absence, c'est un paramètre ». Le paramètre existait bien, il a
été corrigé, et il ne débloque RIEN.** Deux verrous, pas un :
✅ **le premier était bien chez nous, et il était double** — `collecteur-images-bulba.js` codait
`tirage: 'intl'` en dur (l. 70) ET refusait tout set non occidental, **dans deux exemplaires de la
même règle** (l. 111 et 258), dont le message disait « ses images viennent d'artofpkm » — faux pour
60 sets chinois qu'artofpkm ne porte pas. Ils tombaient **entre les deux collecteurs**. Corrigé :
un seul prédicat, `relevedeCeCollecteur`, dont le discriminant n'est plus la RÉGION mais la
PROVENANCE DU VISUEL (« artofpkm le déclare-t-il ? »). La région n'était qu'un proxy, vrai tant que
les seuls sets sans source artofpkm étaient occidentaux.
🔴 **LE SECOND EST RÉEL, ET IL EST MESURÉ : sur les 212 cartes de Sparkling Fable, ZÉRO porte une
impression de tirage `zh-hans`.** Elles portent `intl×373` et `jp×551`, rien d'autre. Idem pour
`SV8s` en `zh-hant` : 0 sur 184. **La résolution d'images lit `carte.impressions` ; il n'y a rien à
lire.** C'est le §28 remesuré : les pages de CARTES de Bulbapedia ne déclarent pas le tirage chinois.
🔑 **ET LA RAISON EST DANS NOTRE PROPRE ARCHITECTURE, CE QUI LA REND INSTRUCTIVE : la jointure
chinoise est VIRTUELLE.** `jointure.js:115` fabrique l'impression depuis la Setlist
(`source: 'setlist'`) et l'écrit dans `cartes_produits` — **8 067 lignes en `zh-hans`, dont 7 808
par `setlist+numero`** — sans jamais la poser sur la carte. Le TEXTE chinois marche donc
parfaitement ; l'IMAGE, qui lit la carte, ne voit rien. **Deux voies, deux endroits où vit la même
impression, et une seule des deux est alimentée.**
🕳️ **CE QUI RESTE OUVERT, ET C'EST LA VRAIE QUESTION MAINTENANT : la page de SET « (ATCG) » porte-t-elle
une galerie ?** Toute la résolution actuelle part de la page de la CARTE ; personne n'a regardé la
page du SET. ⚠️ Et la voie facile est interdite : servir le fichier japonais du même dessin
violerait le §19 (« une image appartient à un TIRAGE »). **Non mesuré, nommé — et à ne pas
reformuler en « absence » avant de l'avoir énuméré (§30).**

---

## 43. UNE COUVERTURE DE 100 % SUR UNE SETLIST DE LIENS ROUGES — 2026-09-21

**Deux lignes chinoises ont collecté ZÉRO : `CSVL2C` Travel Theme Pack (139 produits) et `CSVNC`
Kitakami Theme Pack (44). Instruites, voici ce qu'elles sont.**

🔴 **LES 139 PAGES ÉNUMÉRÉES PAR LEUR SETLIST N'EXISTENT PAS.** `collecte_etat.pages` le dit sur
chaque entrée : `{"titre":"Oinkologne (Travel Theme Pack 50)","pageid":null,"revid":null,"etat":"manquant"}`
— **139 sur 139, sur les deux sets.** Ce sont des LIENS ROUGES : la Setlist de la page de set cite
des titres de cartes que Bulbapedia n'a jamais créés. La collecte a donc parfaitement fonctionné,
elle a traité 139 titres et rendu 0 carte, et sa concordance `produits = joints + restes` était
JUSTE — c'est le §21 n°8 exactement : **une concordance est une tautologie pour ce qui n'a jamais
existé.**

🔴 **ET LA VÉRIFICATION LES A ADMISES À 100 % DE COUVERTURE — C'EST LE VRAI DÉFAUT.** Le critère
d'admission des lignes `numerosDepuisSetlist` est la couverture des numéros Cardmarket par les
numéros de la Setlist. Les 44 numéros de Kitakami sont tous compris entre 1 et 139 : **couverture
100 %, `numerosAmbigus: 0`, admise.** C'est le §31 dans sa forme la plus pure — *« sur des plages
DENSES de PETITS ENTIERS, toute expansion couvre toute autre »* — et le contrôle bidirectionnel ne
l'aurait pas vue non plus, puisque le problème n'est pas l'appariement : **c'est que rien de ce qui
est apparié n'existe.**
🔑 **LA GARDE QUI MANQUE SE FORMULE EN UNE LIGNE ET NE COÛTE AUCUNE REQUÊTE DE PLUS : une ligne dont
les titres de Setlist sont tous des liens rouges ne peut rien collecter, donc elle n'est pas
admise.** L'information est déjà là — `etat: 'manquant'` est écrit par la collecte —, elle n'est
simplement jamais relue en face de la décision d'admettre. ⚠️ Et c'est la même forme que le §33 :
une ligne qui ne peut pas collecter ne doit rien réserver. **Non câblée : elle doit d'abord être
mesurée sur ce qui MARCHE (§22), car un set neuf a lui aussi des pages non encore archivées, et
« manquant » ne veut pas dire la même chose avant et après une collecte.**

✅ **ET LA ROUTE EXISTE, ELLE EST DÉJÀ DÉCRITE AU §40.** Ces deux produits sont des **packs à thème
qui RÉIMPRIMENT des cartes existantes** : « Forretress ex » est chez nous sous `_id 282519`, sets
`Shiny-Treasure-ex`, `Clay-Burst`, `Fearless-Terastal`, `Paldean-Fates`. La carte existe, seule la
page du tirage manque — **exactement la situation des WCD**, où Bulbapedia ne crée pas de page par
réimpression. 🕳️ La clé de jointure, elle, est plus faible que celle des WCD : le slug Cardmarket
ne porte pas le set d'origine, donc il reste le NOM, et le §22 a mesuré ce que vaut une clé par nom
(**31 gagnées contre 364 dérangées**). **Route nommée, pas proposée.**

---

## 41. LA PARADE AU MOTIF DOMINANT : UN VIDE DOIT COÛTER UNE EXCEPTION — 2026-09-21

**Neuf fois, ce dépôt a rangé en « absence » ce qui était une clé fausse, un champ mal nommé ou un
filtre trop étroit. CINQ le même jour, sur le seul dossier du seuil d'images, à quelques minutes
d'intervalle.** Le catalogue en a fait une leçon à chaque fois. **Une dixième leçon ne vaut rien :
il fallait un OUTIL.** `collecte-cartes/lecture-sure.js`, et son banc `test-lecture-sure.js` qui
rejoue les neuf occurrences réelles — 17 assertions, 0 échec.

🔑 **LE POINT QUI A DEMANDÉ LE PLUS DE RÉFLEXION, ET C'EST LUI QUI FAIT TENIR LA GARDE : « lever
quand une requête rend 0 » serait FAUX, et contourné dans la journée.** Un set sans carte, une file
sans unité en attente, un reste vide sont des zéros JUSTES et fréquents. Une garde qui crie sur eux
se fait retirer, pas satisfaire (§25).
**Ce qui sépare les neuf défauts des zéros légitimes n'est pas le résultat, c'est le DÉNOMINATEUR :
tous les neuf ont la forme « une population non vide, et une intersection VIDE avec elle ».**
552 documents dans `collecte_etat`, et ma clé en apparie 0. 42 sets refusés, et 0 portent le champ
que je lis. Un export de module qui existe, et le nom demandé n'y est pas.
🔴 **Zéro sur zéro est normal. Zéro sur 552 est une clé fausse.** C'est la seule frontière qui ne se
règle pas — et c'est pour ça qu'elle est tenable. **Au-dessus de zéro, `apparier` AVERTIT et ne lève
pas** : un appariement à 3 % est un jugement, et un jugement qui s'arme tout seul devient un seuil
qu'on baisse pour faire passer un cas (§23).

🔑 **CE QUE L'OUTIL FAIT ET QU'UNE RELECTURE NE PEUT PAS FAIRE : IL IMPRIME CE QUI EXISTE À CÔTÉ DE
CE QU'ON A DEMANDÉ.** « `TABLE_SETS` n'existe pas ; clés disponibles : TABLE, TABLE_AUTO,
TABLE_SANS_PAGE » ne demande aucune sagacité. **C'est la règle « tout outil de mesure imprime son
dénominateur » (§3) rendue MÉCANIQUE** : le dénominateur ne s'imprime plus à côté du résultat en
espérant que quelqu'un le lise — il est calculé, et il LÈVE. Quatre fonctions, une par forme de vide :
`champ` (un export, un champ d'objet) · `champSur` (un champ sur une population — le dénominateur est
le nombre de documents) · `apparier` (deux populations, et c'est la plus rentable : elle attrape
quatre des neuf) · `lireMongo` (un filtre, et le dénominateur est un `countDocuments({})`).

⚠️ **L'ÉCHAPPATOIRE EST DÉLIBÉRÉE, ET ELLE DOIT RESTER BON MARCHÉ : `{ videAutorise: '<raison>' }`.**
Une garde sans sortie de secours se fait retirer, et le contournement qu'on improvise sous la
pression est toujours pire que celui qu'on a prévu. Mais **`videAutorise: true` est REFUSÉ** : la
raison doit être une phrase écrite, et elle est IMPRIMÉE quand le vide survient. **Le coût du
contournement n'est pas un effort, c'est une phrase qu'on doit pouvoir écrire — et c'est exactement
le moment où l'on s'aperçoit qu'on n'en a pas.**

🕳️ **DETTE NOMMÉE, ET ELLE EST LA MOITIÉ DU TRAVAIL : le module existe, il n'est pas encore
OBLIGATOIRE.** Le dépôt compte des dizaines de lectures écrites avant lui. Les convertir toutes d'un
coup serait un grand diff non mesuré ; la règle posée est donc : **toute sonde NEUVE passe par
`lecture-sure`, et toute sonde ANCIENNE qui rend un zéro s'y convertit AVANT qu'on croie son zéro.**
⚠️ C'est le §21 bis en embuscade — une règle appliquée à la moitié d'un dépôt est une règle qui
diverge. Écrit ici pour qu'on sache que la conversion est en cours et non faite.

---

## 40. LE PLANCHER RÉEL EST 66 PRODUITS — ET LES WCD N'AVAIENT JAMAIS ÉTÉ ÉNUMÉRÉS — 2026-09-21

**La question posée était : sur les 15 598 produits manquants, combien n'ont de page chez AUCUNE
source ? Réponse mesurée : 66, sur 3 expansions.** Pas 1 240, pas 2 000. **0,42 % de l'écart,
0,10 % du catalogue.** Le plafond mesurable aujourd'hui est donc **99,90 %**, et rien de ce qui a été
mesuré ne contredit la cible de 100 %.

| nature | produits | ce que c'est |
|---|---|---|
| **TRAVAIL** — page connue, route connue | **12 933** | 6 061 lignes refusées par un contrôle (la page existe) · 4 870 lignes admises à collecter · 1 944 WCD · 58 un set chinois oublié |
| **À INSTRUIRE** — aucune page trouvée *par les écritures testées* | **2 599** | ⚠️ ce n'est PAS « n'existe pas » : 2 ou 3 orthographes de titre, c'est une requête ciblée, pas une énumération (§30) |
| 🕳️ **PLANCHER PROUVÉ** — page absente, vérifié | **66** | 3 « Starter Set ex » |

🔴 **ET LE PLUS GROS BLOC A CHANGÉ DE CAMP : LES WCD, 1 944 PRODUITS, CLASSÉS « AUCUNE PAGE
BULBAPEDIA, ÉNUMÉRÉ ».** Ils n'avaient pas été énumérés — ils avaient été CHERCHÉS, sous le nom que
**Cardmarket** leur donne : `WCD-2009`. **Bulbapedia ne nomme pas un millésime, il nomme un DECK** :
« ADP », « Bebe Deck », « Darkrai Deck », « Eeveelutions », « American Gothic »… **90 pages**, chacune
disant son année en toutes lettres (« it is one of the four 2013 World Championships Decks »).
🔑 **C'est le §30 exactement, et c'est la neuvième fois : chercher l'orthographe d'une source chez une
autre rend le même vide qu'une absence.** Le mot « énuméré » dans la classification était faux — et
c'est lui qui a fermé le dossier pendant deux jours.

✅ **ET LA CLÉ DE JOINTURE EXISTE DES DEUX CÔTÉS, CE QUI EST RARE.** Un deck de championnat réimprime
des cartes d'autres sets, donc ni le nom ni un numéro propre ne peuvent servir. Mais :
· **Bulbapedia** écrit `{{decklist/entry|4|{{TCG ID|Dark Explorers|Sableye|62}}|…}}` — **le set
d'origine et son numéro** ;
· **Cardmarket** ne numérote PAS ses WCD (**9 produits sur 111**), et son SLUG porte la même chose :
`Trapinch-Lv9-**WCD09SW-115**` = Stormfront n°115, `Palkia-LVX-**WCD09DPPR-28**` = DP Promo n°28.
**Les deux sources désignent le tirage D'ORIGINE, avec son set et son numéro.** La jointure est donc
(set d'origine, numéro), et elle est discriminante par construction.
⚠️ **Deux réserves écrites avant d'y toucher** : (1) `decklist/entry` est un gabarit que
`entreesDeLaSetlist` ne connaît pas — mais les références qu'il contient sont les DEUX formes qu'elle
lit déjà (`TCG ID` et `[[Nom (Set N)]]`), donc c'est un en-tête à ajouter, pas un parseur à écrire ;
(2) **la carte vendue est une RÉIMPRESSION non tournoi-légale**, pas le tirage d'origine — il faudra
décider si on la rattache à la page du tirage d'origine (§19 : une image appartient à un TIRAGE).
**Route proposée, pas prouvée.**

🔑 **CE QUE CE PARAGRAPHE CHANGE DANS LA FAÇON DE COMPTER, ET C'EST LE VRAI RÉSULTAT.** Jusqu'ici
l'écart était décomposé par ÉTAT DE NOTRE TRAVAIL — « sans ligne », « refusée », « admise ». Ces trois
mots décrivent ce que nous avons fait, pas ce qui est possible, et ils font passer pour des limites
des choses qui n'attendent qu'une ligne. **La décomposition qui décide n'a que trois cases : une page
existe (TRAVAIL) · on n'en a pas trouvé (À INSTRUIRE) · on a vérifié qu'il n'y en a pas (PLANCHER).**
Et la troisième case exige la même preuve que toute limite : quel instrument, quelles sources, quelle
date (§36).

---

## 39. UN FILTRE DE GÉNÉRATION EST UN REFUS QUI NE SE RELIT JAMAIS — 2026-09-21

**La règle, en une ligne : un refus est une décision datée qu'on peut relire (§23) ; un FILTRE qui
empêche la candidate d'exister ne laisse rien à relire.** Une expansion sans ligne ne réclame rien,
n'apparaît dans aucune liste de refus, et son absence ressemble à un monde où elle n'existe pas.

**L'occurrence, et elle valait 4 168 produits.** `generer-table-auto.js` porte `langueAsiatique()`,
`generer-table-sans-page.js` porte `!/chinois|asiatique/.test(u.famille)`. **Les deux ont été écrits
quand le §28 disait « le chinois est irréductible ».** Le §28 est tombé le 2026-09-20 — la route
« (ATCG) » est ouverte depuis le 2026-09-15 et produit 5 675 fiches à 92,8 %. **Les filtres, eux, sont
restés**, et 49 expansions chinoises n'ont jamais reçu ne serait-ce qu'une ligne CANDIDATE.
🔑 **Quand une limite tombe, la question suivante n'est pas « que peut-on faire maintenant ? » mais
« QUI, dans le code, appliquait cette limite ? ».** Elle se cherche par `grep`, pas de mémoire.

🔴 **ET LA CLÉ PAR LE NOM RENDAIT 0 PAIRE SUR 49 — un vide qui n'était pas une absence.** Cardmarket et
Bulbapedia **traduisent chacun le chinois de leur côté**, et le résultat ne se ressemble pas :
« Collect 151 » / « Collection 151 » · « Brilliant Fantasy » / « **Sparkling Fable** » · « Eternal
Birth » / « **Ancient Times, Future Progress** » · « Dark Crystal Blaze » / « **Ardent Obsidian** ».
⚠️ **Et une clé plus SOUPLE aurait été le §31 en pire** : « Vivid Portrayals Obsidian » et « Vivid
Portrayals Indigo » contiennent tous deux « Vivid Portrayals ». L'inclusion aurait apparié les deux au
même set, avec un total flatteur et une moitié de faux.

✅ **LE DISCRIMINANT ÉTAIT LE CODE, PARCE QU'UN CODE NE SE TRADUIT PAS.** Bulbapedia l'écrit dans
`alt=`, dans le nom du logo (« CSV10 Logo SC.png »), dans celui du symbole (« SetSymbolCS21.png »), et
pour les sous-sets **en toutes lettres dans le corps du texte** (« The Obsidian subset was assigned
expansion mark CS2a »). **44 paires, 3 866 produits, 34 admises à la vérification, 1 seul numéro
ambigu sur 44 lignes.**
🔴 **Et ma première sonde a rendu « AUCUN code » sur les cinq pages ouvertes** : elle cherchait
`CS…C` — **Cardmarket suffixe ses codes d'un « C » que Bulbapedia n'écrit pas**. `CSV6C` contre
`CSV6`. C'est le motif dominant du chantier, une sixième fois : *l'outil cherchait l'orthographe de
l'AUTRE source, et son vide avait l'air d'une absence.*

✅ **LES PAGES À DEUX MOITIÉS SONT CADRÉES, ET LE CADRAGE EST LU, PAS DEVINÉ.** Quatre pages portent
DEUX expansions Cardmarket chacune (CS2a/b, CS4a/b, CS5a/b, CS6a/b — 1 342 produits), et **trois
renumérotent chaque moitié de 1 à N** : « Vivid Portrayals » a 286 entrées pour 143 numéros distincts.
Non cadrée, chaque ligne aurait réclamé toute la Setlist — les 14 produits à deux cartes du §34, à
l'échelle. **L'en-tête de Setlist porte le code : `{{Setlist/header|title=Obsidian|…|image=SetSymbolCS2a.png}}`.**
Le couple section↔code se LIT donc sur la page, et le cadrage réutilise `bulba.setlist`, le mécanisme
déjà éprouvé par xWHT/xBLK sur leur page commune. Résultat : les 8 lignes à 100 % de couverture,
**0 numéro ambigu**.

### 🔴 ET DEUX DE MES PROPRES SONDES ONT MENTI DANS LA MÊME JOURNÉE, SUR LE MÊME FICHIER

| ce que la sonde disait | ce qu'elle lisait | la vérité |
|---|---|---|
| « 152 expansions, 9 144 produits sans ligne » | `require('./table-sets').**TABLE_SETS**` — l'export s'appelle `TABLE` | **134 / 8 467** : la table à la main était INVISIBLE |
| « 10 lignes à régénérer » (il y en avait 44) | `TABLE` comme « table à la main » | `table-sets.js:154` fait `TABLE.push(...TABLE_AUTO.filter(l => l.verifie))` — **`TABLE` = à la main + auto ADMISES** |

🔑 **LA PREMIÈRE EST LA PLUS INSTRUCTIVE, PARCE QU'ELLE ÉTAIT SILENCIEUSE PAR CONSTRUCTION** :
`try { X = require(…).TABLE_SETS || []; } catch {}`. **Un nom de champ faux ne lève pas ; le `|| []` le
transforme en résultat plausible ; le `catch` vide mangerait même l'erreur s'il y en avait une.**
Trois protections qui, ensemble, garantissent qu'aucune faute ne se voit. ⚠️ **Un repli par défaut sur
une valeur VIDE est un mensonge silencieux** : il faut soit échouer, soit imprimer ce qu'on a repli.
Et le dénominateur l'aurait dit — « table à la main : 0 ligne » se serait vu au premier coup d'œil.

⚠️ **La seconde rappelle que `TABLE_MAIN` existe précisément pour ça**, et que
`generer-table-sans-page.js` se protège du même piège avec son propre marqueur, commentaire à l'appui.
**Je ne l'avais pas transposé.** C'est le §21 bis une fois de plus : la règle était écrite, à côté, dans
le fichier voisin.

---

## 38. TOUTE SOURCE EXTERNE A UNE CADENCE ET UNE REPRISE — SANS EXCEPTION — 2026-09-21

**La règle, en une ligne : un tiers qui ne nous a rien demandé se traite au moins aussi bien qu'un
tiers qui nous a imposé un `Crawl-delay`.** L'absence de promesse explicite n'est pas une permission ;
c'est simplement l'absence d'une phrase, et une phrase absente ne change pas ce que le serveur d'en
face encaisse.

**L'occurrence.** Le collecteur de logos français a tiré **270 requêtes d'affilée** sur `api.tcgdex.net`,
sans pause et sans reprise. TCGdex a répondu **« no available server » sur 94 sets**. J'ai d'abord lu
une panne de leur côté. **Ce n'était pas leur panne, c'était moi.**

🔴 **ET LA PARADE ÉTAIT ÉCRITE DEUX FOIS DANS CE DÉPÔT, POUR DEUX AUTRES SOURCES.** `bulba.js` sérialise
tout dans une file à 5 s ; `artofpkm.js` fait de même sous un verrou global ; le §17 explique, sur une
page entière, qu'**une limite de débit se compte CHEZ LE DESTINATAIRE**. TCGdex n'avait rien, et
personne ne l'a remarqué — parce que **le déclencheur avait été le `robots.txt` de Bulbapedia, pas un
raisonnement sur ce qu'est un client.** Une règle posée en réaction à une contrainte ne se généralise
pas toute seule aux cas qui n'ont pas la contrainte. C'est le §21 bis, appliqué non plus à deux
fichiers mais à deux SOURCES.

🔑 **CE QU'UN CLIENT DOIT PORTER, ET LES TROIS SE MESURENT :**
**(1) une CADENCE** — une pause entre deux requêtes, tenue dans une file, pas dans une boucle (deux
appelants concurrents doubleraient sinon le débit sans qu'aucun ne mente) ;
**(2) un RÉESSAI BORNÉ** — un, à quelques secondes, pour qu'une coupure d'une seconde ne tue pas un
lot ; **jamais une boucle**, une panne longue doit RESTER une panne visible (§29) ;
**(3) une REPRISE** — un objet déjà obtenu ne se redemande pas. ⚠️ **Et c'est le point qu'on oublie,
parce qu'il ne ressemble pas à de la politesse : un outil qui refait tout à chaque lancement est un
outil qu'on n'ose pas relancer**, donc un outil qu'on lance en une seule fois, donc exactement celui
qui martèle. La reprise n'est pas une optimisation, c'est ce qui rend la cadence tenable.

⚠️ **LE TEST, AVANT D'ÉCRIRE LA PREMIÈRE REQUÊTE VERS UN HÔTE NOUVEAU** : *combien de requêtes cet
outil peut-il faire au maximum, et en combien de temps ?* Si la réponse est « autant qu'il y a de
lignes, aussi vite que possible », il n'est pas fini. Le compte se calcule AVANT, il ne se découvre
pas dans un message d'erreur du tiers.

---

## 37. LE NOM D'UNE CHOSE N'EST PAS LA CHOSE — `TCGPromoInfobox` NE VEUT PAS DIRE « PROMO » — 2026-09-21

**La règle, en une ligne : quand une source nomme ses catégories, le NOM est une étiquette de sa
commodité, pas une définition — et le lire comme une définition étiquette faux en masse, avec l'air
d'avoir lu la source.**

**L'occurrence.** Le site demande un champ `type` (extension / deck / coffret). Aucune page de set ne
porte de paramètre `type` — énuméré, **0 sur 463**. En revanche trois GABARITS se partagent les pages :
`TCGExpansionInfobox` 309 · `TCGPromoInfobox` 104 · `DeckInfobox` 49, et pas une page n'en porte deux.
La correspondance semblait écrite d'avance. Confrontée à la devinette par le nom que le site fait
aujourd'hui, elle rendait **133 désaccords** — un excellent chiffre, et c'était le symptôme (§32 bis).

🔴 **`TCGPromoInfobox` PORTE `VMAX Climax` (285 CARTES), `Tag All Stars` (226), `MEGA Dream ex` (250).**
Ce sont des extensions. 92 des 133 « désaccords » étaient mes propres faux. Ce que le gabarit distingue
n'est pas la nature du produit mais **le nombre de sorties régionales** : `TCGExpansionInfobox` porte
`encards` ET `jacards` (japonaise et occidentale), `TCGPromoInfobox` porte `cards` seul. Bulbapedia
l'appelle « Promo » parce que la plupart de ses mono-région sont des promos ; c'est une statistique de
sa population, pas le sens du champ.

🔑 **CE QUI L'A ARRÊTÉ N'EST PAS UNE RELECTURE, C'EST D'AVOIR OUVERT TROIS PAGES** (§22). Le compteur
disait 133 ; la page de VMAX Climax disait « High Class Pack, 285 cartes, une date de sortie ». **Un
compte ne dit pas ce qu'il compte**, et une catégorie héritée d'un tiers se vérifie sur ses membres,
jamais sur son intitulé.

🔑 **LE DISCRIMINANT RÉEL ÉTAIT DANS LES PARAMÈTRES, À CÔTÉ** : `period` (une FENÊTRE de distribution)
contre `date` (une sortie unique). Lu sur les 104 pages : tout ce qui porte `period` est une promo —
Black Star Promos, POP Series, « … Promotional cards », McDonald's ; tout ce qui porte `date` est un
pack nommé — High Class Pack, 強化拡張パック, コンセプトパック, 强化包. **371 extensions, 49 decks, 42 promos, 87 %
des sets typés**, et le gain mesuré contre la devinette au nom : **19 decks qu'elle ne voit pas**
(« Premium Trainer Box », « Zacian Zamazenta BOX », « Evolution Pack ») et 2 faux positifs retirés.

⚠️ **LE RÉSIDU EST NOMMÉ, PAS LISSÉ** : `s8a-P` s'appelle « Promo Card Pack » et porte `date` — il sera
dit « extension ». `MCRP` aussi. Deux lignes sur 104, écrites ici pour qu'on les retrouve.
🕳️ **ET « COFFRET » N'EXISTE PAS À LA SOURCE** : Bulbapedia n'a que trois gabarits, et un coffret y est
un `DeckInfobox` (`25th Anniversary Golden Box`, `Extra Regulation Box`). Le champ rend donc TROIS
valeurs et non les trois demandées. **Inventer le quatrième type depuis le nom serait exactement la
devinette qu'on remplace** — on rend moins que ce qui est demandé plutôt que de rendre du faux.

---

## 36. NOS « LIMITES DÉFINITIVES » TIENNENT À UNE SONDE, ET LA SONDE VIEILLIT — 2026-09-21

🔴 **C'EST LA SIXIÈME FOIS, ET IL FAUT L'ÉCRIRE COMME UNE LOI DU CHANTIER : une limite écrite dans ce
fichier n'est pas une propriété du monde, c'est le RÉSULTAT D'UN INSTRUMENT À UNE DATE.** Une propriété
du monde ne change pas ; un instrument, si — parce qu'une source s'ouvre, parce qu'un champ s'appelle
autrement, parce que la requête était trop étroite. Et une limite, une fois écrite ici, **ne se remesure
jamais** : c'est tout l'intérêt de ce fichier, et c'est exactement le danger.

**LES SIX OCCURRENCES, dans l'ordre, avec ce que la sonde avait raté :**

| § | la limite écrite | la sonde | ce qu'il y avait derrière |
|---|---|---|---|
| §21 n°7 | « la source s'arrête à 100 cartes » | un motif de « page suivante » deviné | 78 cartes, 4 listes tronquées |
| §22 | « PKMJP n'apporte rien » | un COMPTE d'entrées, pas un constat | mesure refaite, conclusion tenue |
| §30 | « aucune source pour les promos ID/TH » | `intitle:ITCG` — le suffixe est entre parenthèses | **55 pages, 1 620 produits** |
| §33 | « 122 candidates jamais jugées » | `l.verification?.motif` — le champ est `l.verif` | **117 avaient un verdict écrit** |
| §28 | « le chinois est irréductible » | une consigne de périmètre lue comme un fait | **5 675 produits fichés à 92,8 %** |
| **§27** | **« aucune source ne porte la date »** | **Cardmarket + infobox Bulbapedia — TCGdex jamais interrogé** | **5 des 11, et 59 sets sur 281** |
| **§26** | **« la ponctuation est perdue et ne se devine pas »** | **le seul `slugSet` de Cardmarket, où le tiret remplace tout** | **28 sets, et la source était DÉJÀ EN BASE** |
| **§39** | **« le chinois est un chantier distinct » (§28), tombé le 20/09** | **le §28 a été relu, mais pas les DEUX FILTRES qu'il avait fait écrire dans les générateurs** | **49 expansions, 4 168 produits, jamais même CANDIDATES** |

🔴 **LA HUITIÈME A UNE FORME NEUVE, ET ELLE EST PIRE QUE LES SEPT AUTRES : LA LIMITE ÉTAIT TOMBÉE
DEPUIS UN JOUR, ET SON CODE TOURNAIT ENCORE.** Les sept premières étaient des phrases qu'il fallait
remesurer. La huitième était une phrase DÉJÀ remesurée, déjà corrigée dans ce fichier — et deux
`filter()` continuaient de l'appliquer, en silence, dans deux générateurs. ⚠️ **Retirer une limite du
catalogue ne retire pas les décisions qu'elle a fait câbler** (§23), et un filtre de génération est la
pire de ces décisions : il ne produit pas un refus qu'on pourrait relire, il produit une ABSENCE.
🔑 **Quand une limite tombe, le geste suivant est un `grep` : QUI l'appliquait ?**

### ✅ L'AUDIT COMPLET DU 2026-09-21 — CE QUI TOMBE, CE QUI TIENT, ET POURQUOI

**Le §26 tombe, et sa sonde est la plus embarrassante des sept : la source n'était pas ailleurs, elle
était DÉJÀ DANS NOTRE BASE.** « La ponctuation n'est pas dans le slug » est exact ; « elle ne se devine
pas » l'est aussi. Mais on n'avait pas à la deviner : `bulba.expansion` la porte, sur **380 sets dont le
nom NU est identique au nôtre** — même set, garanti — et **28 d'entre eux gagnent une ponctuation** :
« Gold, Silver, to a New World... », « Leaders' Stadium », « Magma VS Aqua: Two Ambitions »,
« McDonald's Collection », « Champion's Path », « Jet-Black Spirit ».
🔑 **Et la clé est sûre PAR CONSTRUCTION, ce qui est rare** : elle n'accepte que des noms dont la forme
nue est identique, donc elle ne peut ni changer de set, ni créer une collision d'affichage (§26) — le
contrôle le confirme à 0 plutôt qu'il ne le découvre. **Une reponctuation n'est pas un appariement.**

**CE QUI TIENT, REMESURÉ LE MÊME JOUR — et il faut l'écrire aussi fort que ce qui tombe :**

| § | la limite | ce que la remesure a donné |
|---|---|---|
| §24 | « aucune carte portant ☆ dans la base » | **0 et 0** — cherché par le caractère, par le mot « Star », par les cinq noms nus. Les 9 irréductibles sont toujours 9. |
| §7 | « deux étiquettes sont nécessaires, nous en avons ZÉRO » | **0 produit sur 73 188** ne nomme une édition (1st, Shadowless, Unlimited). ⚠️ Ses comptes de champs sont périmés (13→16, 4→7) ; sa RAISON ne l'est pas. |
| §0 | « le plafond de la voie plus de clés est 62,5 % » | **le journal est à 280 lignes, exactement comme le 2026-09-09.** |

🔴 **ET LE §0 DONNE LE FAIT LE PLUS IMPORTANT DE L'AUDIT, QUI N'EST PAS SON PLAFOND : LA DERNIÈRE LIGNE
DU JOURNAL DATE DU 2026-09-08.** Le banc n'a pas grossi d'une ligne en treize jours. Le plafond ne peut
donc pas avoir bougé — mais surtout, **le banc ne peut plus rien trancher de neuf** : toutes les
décisions qui l'attendent (la promotion du §9, la garde du §8, le tri du §11) attendent des SCANS, pas
des mesures. ⚠️ **Une conclusion qui « tient » parce que sa population est gelée n'est pas confirmée,
elle est SUSPENDUE** — et c'est une troisième catégorie, à côté de « tombée » et « tenue ».

✅ **ET LA CATÉGORIE EST DÉSORMAIS PORTÉE PAR LES PARAGRAPHES EUX-MÊMES : les §8, §9 et §11 ouvrent sur
une bannière ⏸️.** Une catégorie qui ne vit que dans le § qui l'a inventée ne sert à rien : c'est en
tête du paragraphe concerné qu'elle doit se lire, au moment où quelqu'un s'apprête à s'en servir.
🔑 **Et la distinction qui compte dans ces trois cas : la DÉCISION tient, la MESURE est suspendue.**
Le §9 n'est pas promu — c'est un choix du testeur, il n'expire pas ; mais le chiffre sur lequel il a
été pris ne peut plus bouger, donc on ne peut pas non plus dire qu'il est confirmé. **Suspendre une
mesure n'annule pas la décision qu'elle a servi à prendre.**

🔴 **LE §27 EST TOMBÉ LE 2026-09-21, ET SA SONDE ÉTAIT PARTICULIÈREMENT COUPABLE.** Le paragraphe dit
« Aucune source DISPONIBLE ne la porte » et détaille deux vérifications — Cardmarket n'a pas de date
d'expansion, l'infobox de ces onze pages n'en porte pas. Les deux sont exactes. **TCGdex sert
`releaseDate`, il est utilisé par le dépôt depuis le premier jour (`prefill-tcgdex.js`), et personne ne
lui a posé la question.** PBL 2026-07-17, ASC 2026-01-30, JTG 2025-03-28, CRI 2026-05-22. Les six
japonais (SI-JP, VS, WEB, IPB, MCDP, EXS) restent, et c'est le vrai résidu.
⚠️ **« Disponible » était le mot qui cachait le trou** : il avait l'air d'un quantificateur sur toutes les
sources, il ne portait que sur celles qu'on venait de nommer. **Une limite doit dire QUELLES sources
ont été interrogées, et la phrase « aucune source » est interdite sans cette liste.**

✅ **ET UNE LIMITE QUI SURVIT À SA RELECTURE VAUT AUTANT QU'UNE QUI TOMBE — le §24 tient.** « Aucune carte
portant ☆ n'existe dans toute la base » : remesuré avec l'instrument refait (le caractère ☆, PUIS le mot
« Star » écrit en toutes lettres, PUIS les cinq noms nus), **0 et 0** — les deux seuls « Star » de la base
sont `Star Piece` et `Team Star Grunt`. Les neuf irréductibles sont toujours neuf. **Une relecture qui
confirme n'est pas une relecture perdue : elle transforme une supposition datée en fait mesuré deux fois.**

🔑 **LA PARADE, ET ELLE EST MÉCANIQUE.** Tout paragraphe qui écrit une limite porte désormais trois
choses, faute de quoi il n'est pas une limite mais une note : **(1) QUEL instrument a cherché, (2) QUELLES
sources ont été interrogées — nommées, pas sous-entendues, (3) à QUELLE date.** Et la question à poser
devant n'importe laquelle d'entre elles est toujours la même : *qu'est-ce que cette sonde ne pouvait pas
voir ?* — pas *est-ce que j'y crois ?*

### 🔴 ET LE MÊME SOIR, J'AI FAILLI EN ÉCRIRE UNE SEPTIÈME — SUR MON PROPRE INSTRUMENT

**L'agent du site annonçait 251 pages Bulbapedia portant un paramètre `fr`, le nom français du set.**
Mon énumération des infoboxes des 463 pages de sets archivées en a trouvé **ZÉRO**, et zéro paramètre
`type` avec. J'allais écrire « la voie est morte, l'archive ne porte pas le nom français ».

**Le chiffre ne collait pas, donc je n'ai pas conclu — et c'est la seule chose qui a marché.** Mon
instrument ne regardait que les gabarits **dont le nom contient « infobox »**. Le `fr` vit dans
`{{Langtable}}`, qui n'en est pas une. Recherché dans le TEXTE BRUT : **261 pages sur 463**, dont les 251
de l'agent. **Un filtre que j'avais écrit moi-même, trois lignes plus haut, rendait le même vide qu'une
absence** — le §30 appliqué à ma propre sonde, le jour où j'écrivais un § sur les sondes.

🔑 **LA LEÇON D'EXPLOITATION : QUAND UN TIERS ANNONCE UN CHIFFRE ET QUE LE MIEN DIT ZÉRO, C'EST LE MIEN
QU'ON OUVRE EN PREMIER.** Zéro est le résultat que produit un instrument cassé ; un chiffre non nul
demande au moins d'avoir trouvé quelque chose. **L'asymétrie n'est pas dans la confiance qu'on accorde
aux gens, elle est dans la nature des deux résultats.**

---

## 35. LE SYMBOLE DE SET N'EST ÉCRIT NULLE PART : IL EST CALCULÉ — 2026-09-20

**La question posée le 2026-09-19 était « où vit le fichier ? », et la réponse mesurée était NULLE PART** :
`setsymbol` est un **booléen** (376 « yes », 22 « no »), **447 wikitexts de sets ne citent aucun fichier de
symbole**, les pages de cartes échantillonnées non plus. Une source qui ne cite pas un fichier peut quand
même le désigner — **par une convention**, et une convention se lit dans le GABARIT, pas dans les pages.

🔑 **UNE REQUÊTE A RÉPONDU.** `Template:TCGExpansionInfobox` construit le symbole ainsi :
```
[[File:SetSymbol{{{alt|{{{setname|Base Set}}}}}}.png|{{{symbolsize|30px}}}]]
```
→ **`SetSymbol<alt, à défaut setname>.png`**, et `alt`/`setname` sont des paramètres d'infobox **déjà
archivés chez nous**. Le nom de 138 fichiers s'est donc calculé à **zéro requête supplémentaire**.

⚠️ **ET LA VÉRIFICATION AVANT COLLECTE A PAYÉ TOUT DE SUITE : 112 des 138 noms existent (81,2 %).** Les 26
absents sont **tous des promos** — et c'est cohérent : une carte promo porte un tampon, pas un symbole de
set. Sans ce contrôle, c'étaient 26 erreurs 404 découvertes une par une, au rythme d'une requête toutes
les cinq secondes chez un tiers. **Un nom calculé se confronte à la source AVANT de servir**, par lots,
et jamais en collectant.

🔑 **CE QUI CHANGE DANS LA RÈGLE DU TESTEUR.** « Le symbole seulement si le fichier porte EXACTEMENT le nom
du set » fermait le chantier tant que le fichier n'était « cité nulle part ». Dès lors qu'il est CALCULÉ
depuis un paramètre d'infobox, la règle n'a plus à être assouplie : **elle est satisfaite par
construction**, et le seul travail restant est de vérifier que le nom utilisé est celui de CE set et non
de son jumeau (§26).

---

## 34. UN CONTRÔLE QUI COMPARE DES ENSEMBLES EST AVEUGLE AUX DOUBLONS — 2026-09-20

**La règle, en une ligne : un `Set` écrase les doublons AVANT la comparaison, donc aucune mesure de couverture ne
peut voir qu'un élément désignait deux choses.** Ce n'est pas un défaut de seuil ni de sens de lecture : c'est une
information DÉTRUITE en amont du contrôle, et le contrôle ne peut pas la redemander.

**L'occurrence, et elle a battu la parade du §31.** La ligne « sans page » `Leafeon-vs-Metagross-Expert-Deck` :
15 numéros Cardmarket, 15 numéros déclarés, couverture **100 %**, couverture **inverse 100 %** — les deux sens,
le contrôle exact que le §31 prescrit pour démasquer une inclusion déguisée. Elle a produit **14 produits
rattachés à deux cartes**. La cause : c'est un **KIT À DEUX DECKS sous UN SEUL nom d'expansion**, donc le n°6
existe deux fois, une fois par moitié. **26 cartes déclarent l'expansion pour 15 numéros distincts** — et le
`Set` avait ramené les 26 à 15 avant que quoi que ce soit ne compare.

🔑 **LA PARADE N'EST PAS UN AUTRE TAUX, C'EST DE COMPTER LES MULTIPLICITÉS.** À côté de toute couverture, écrire
« combien d'éléments de la source désignent PLUSIEURS objets ». Ici : `controle.numerosAmbigus`. Mesuré sur les
53 lignes proposées — **5 en portent au moins un, 85 produits concernés, une seule est pathologique**. Et le
refus se formule comme un CONSTAT DE STRUCTURE, pas comme un seuil : si la MAJORITÉ des numéros sont doublés,
le nom ne couvre pas une numérotation mais plusieurs. Une collision isolée (1 sur 19) ne referme pas la ligne —
elle coûterait 18 produits justes pour un faux — elle s'ÉCRIT et attend la garde par numéro.

⚠️ **ET LA GARDE MANQUANTE EST LE PENDANT D'UNE GARDE QUI EXISTE : « un NOM qui désigne plusieurs cartes ne
désigne rien » est câblée depuis le 2026-09-19 ; le NUMÉRO ne l'a pas.** C'est encore le §21 bis. Elle ne se
câble pas avant d'avoir été mesurée sur ce qui MARCHE déjà (§22).

### 🔴 LES TRAINER KITS : LA CAUSE ÉCRITE ÉTAIT FAUSSE, ET C'EST LA MESURE QUI L'A DIT — 2026-09-21

**Ce que tout le monde répétait, moi le premier : « Cardmarket numérote le kit 1–60, Bulbapedia numérote
chaque demi-deck 1–30 ». D'où la question naturelle : un décalage systématique de +30 suffirait-il ?**
**Non — et il n'y a rien à décaler.** Mesuré sur les 11 kits, 527 produits : `XY Trainer Kit` a **61
produits pour 30 numéros distincts, de 1 à 30**. Cardmarket numérote 1–30 exactement comme Bulbapedia.

🔴 **ET LA PHRASE QUI SUIVAIT ÉTAIT FAUSSE AUSSI — ÉCRITE PAR MOI, CORRIGÉE LE LENDEMAIN.** J'avais écrit :
« 61 produits pour 30 numéros, donc chaque numéro désigne DEUX cartes ; aucune renumérotation ne peut le
défaire, l'information manquante est ABSENTE ». **Elle est présente, et c'est mon instrument qui l'effaçait.**
Cardmarket numérote **« 1N », « 1S », « 2N », « 2S »** — une LETTRE par moitié du kit (N = Noivern,
S = Sylveon ; a = Latias, o = Latios ; Z = Zoroark, E = Excadrill). **61 produits, 61 numéros distincts, et
`0` numéro portant plusieurs produits.** Ma fonction `chiffres()` réduisait « 1N » et « 1S » à « 1 » : les
« 30 numéros » et toute l'ambiguïté étaient fabriqués par la sonde.

🔑 **C'EST EXACTEMENT LE §21 bis n°4, ET LA PARADE ÉTAIT DÉJÀ CÂBLÉE À CÔTÉ.** `cleNumero` garde le préfixe
alphabétique depuis les 29 jointures fausses d'EC1, et sa regex `^([A-Z-]*)0*(\d+)([A-Z]*)$` **garde aussi le
suffixe**. Le collecteur savait lire « 1N » ; c'est ma mesure, écrite à côté, qui ne savait pas. ⚠️ **Deux
écritures d'une même donnée, encore** — le kit chez Cardmarket, le `deck` chez Bulbapedia. Traité comme le
préfixe de set l'est déjà : l'impression est indexée sous ses DEUX écritures, via `cible.suffixesParDeck`,
**un chemin qui ne s'ouvre que si le champ est posé** — donc gratuit sur les 528 sets collectés, non pas
parce qu'on l'a mesuré partout mais parce que le code n'y est pas atteint.

✅ **RÉSULTAT : 5 kits collectés, 234 produits, contrôle transversal INCHANGÉ à 35** — TK6, TK7, TK8 à
**60/60 = 100 %**, TK1 18/20, TK5 36/60. L'appariement suffixe → demi-deck est MESURÉ (recouvrement des noms,
écart au second imprimé), jamais deviné : « Latias » et « Latios » donneraient tous deux « L », et Cardmarket
écrit « a » et « o ».
🕳️ **Les six autres kits n'ont AUCUN suffixe** (`HS`, `EX Trainer Kit 2`, `DP`, `XY Pikachu Libre & Suicune`,
`SM Lycanroc`, `SM Alolan Sandslash`) : là, et là seulement, rien ne distingue les deux moitiés. Ils restent
refusés, et c'est le bon résultat.
🔴 **ET J'AI CORRIGÉ UN TROISIÈME CHIFFRE À MOI** : « 4 kits sans carte déclarante, 207 produits » était un
artefact de ma clé slug→nom. `BW Trainer Kit` s'appelle « Black & White Trainer Kit » chez Bulbapedia, `DP`
« Diamond & Pearl Trainer Kit », `SM Lycanroc` « Sun & Moon Trainer Kit: … ». **10 kits sur 11 ont leurs
cartes ; un seul n'en a pas.**

🔴 **ET LE DÉCALAGE ESSAYÉ RENDAIT « 100 % DE COUVERTURE, 0 AMBIGU » SUR TROIS KITS — UN FAUX SUCCÈS
PARFAIT.** En poussant un demi-deck à 31–60, il ne restait qu'un seul candidat par numéro Cardmarket :
le contrôle était satisfait **parce que la moitié des cartes avait quitté la plage comparée**. Il
attribuait les 30 produits au demi-deck classé premier par ordre alphabétique. **Un contrôle qu'on
satisfait en retirant des candidats ne mesure plus rien** — c'est le §31 (« une clé par inclusion apparie
toujours quelque chose ») déguisé en transformation arithmétique.

⚠️ **ET LA CLÉ PAR LE NOM, QUE J'AVAIS PROPOSÉE ENSUITE, AURAIT ÉTÉ UN MAUVAIS CHOIX** : mesurée à
**212/348 = 61 % avec 9 ambigus**, elle avait l'air du meilleur disponible. Le suffixe rend **234 produits
avec ZÉRO ambigu**. 🔑 **Quand une clé mesurée laisse un résidu d'ambiguïté, c'est souvent le signe qu'une
donnée discriminante existe et qu'on ne la lit pas** — le résidu n'est pas un coût à accepter, c'est une
piste. Neuf collisions sur 555, c'était le bruit exact que produit une lettre effacée.

⚠️ **OÙ CHERCHER LA MÊME FORME** : partout où le dépôt écrit `new Set(...)` puis compare des tailles ou des
appartenances — appariement de sets, couverture de numéros, `distinct()` de Mongo, `$addToSet` d'une agrégation.
**`$addToSet` est un `Set` côté base** : le contrôle transversal du §32 l'utilise (`cartes: { $addToSet: '$carteId' }`)
et ne dit donc jamais COMBIEN de lignes portent le doublon, seulement qu'il y en a deux. C'est acceptable là
parce que la question posée est booléenne ; ça ne l'est pas dès qu'on lit le résultat comme une quantité.

---

## 33. UN REFUS QUI CONTINUE DE RÉSERVER SON OBJET — 2026-09-20

**La règle, en une ligne : une candidate REFUSÉE gardait son nom d'expansion, donc elle interdisait à l'autre
voie de prendre le set qu'elle venait elle-même de renoncer à collecter.** Un refus doit LIBÉRER, pas retenir.

🔴 **ET LA PREMIÈRE VERSION DE CE PARAGRAPHE DISAIT « 122 candidates sans AUCUNE trace de vérification ».
C'ÉTAIT FAUX, ET C'EST LA SIXIÈME FOIS QUE LE MÊME INSTRUMENT MUET ME TROMPE (§30).** Mon détecteur lisait
`l.verification?.motif` ; le champ s'appelle **`l.verif`**. Sur les 118 candidates non vérifiées, **117 avaient
un verdict écrit** — `etat: 'À REGARDER'` et jusqu'à trois raisons chacune — et **5 seulement** n'avaient
jamais été jugées. Un champ absent a été lu comme « personne n'a regardé », et j'ai écrit une leçon entière
sur ce vide. ⚠️ **Une erreur de mesure qui finit dans un RAPPORT se corrige au rapport suivant ; une erreur de
mesure qui finit dans CE FICHIER devient une règle, et une règle ne se remesure jamais.** Avant d'écrire un §,
relire le détecteur qui l'a produit — pas seulement son résultat.

**L'occurrence, corrigée.** `generer-table-sans-page.js` construisait `connus` — les noms d'expansion déjà
couverts — sur `[...TABLE, ...TABLE_AUTO]`, donc sur **118 lignes qui ne collectent pas**, dont 117 refusées
pour une raison écrite (« aucune entrée de Setlist », « entrées/produits hors bornes », « l'échantillon n'a
pas ce tirage »). Résultat : **75 expansions dont nos cartes DÉCLARENT déjà l'impression, 2 999 produits,
invisibles aux DEUX voies à la fois** — la page refusée, et le retournement aveuglé par la ligne qui a refusé.

🔴 **ET LE RAISONNEMENT JUSTE ÉTAIT ÉCRIT TROIS LIGNES PLUS HAUT.** Un commentaire de six lignes explique
pourquoi une ligne non vérifiée ne prend pas son SLUG (« les compter comme pourvues les laisserait sans collecte
pour toujours ») — et la ligne d'à côté faisait exactement l'inverse pour le NOM. **Ce n'est pas une règle
dupliquée dans deux fichiers, c'est la même fonction : relire le commentaire ne suffisait pas, il fallait relire
ce que la ligne suivante FAISAIT.** Corrigé : une ligne qui ne peut pas collecter ne prend ni son slug NI son
nom. Effet immédiat, zéro requête : 24 lignes → 91, dont 52 vérifiées, **+893 fiches**.

🔑 **LA FORME À RECONNAÎTRE, ET ELLE EST PARTOUT OÙ ON ÉNUMÈRE.** Un ensemble « ce qui est déjà pris » se
construit sur ce qui PRODUIT, jamais sur ce qui EXISTE. La question mécanique : *cette ligne peut-elle faire le
travail ?* — si non, elle ne réserve rien, **et un refus est précisément la preuve écrite qu'elle ne le peut
pas.** C'est ce qui rend l'erreur contre-intuitive : plus la ligne était documentée comme inutilisable, plus
elle bloquait solidement.

⚠️ **ET LE MÊME MOTIF EXISTE AILLEURS, NOMMÉ ICI POUR QU'IL SOIT CHERCHÉ** : `ligne(code)` rend
`TABLE ?? TABLE_AUTO ?? TABLE_SANS_PAGE`, donc une candidate automatique NON JUGÉE est préférée à une ligne
« sans page » qui porte, elle, un refus MESURÉ. Le set est refusé dans les deux cas, mais le motif imprimé est
le mauvais — un refus exact qui ne nomme pas la bonne cause fait chercher au mauvais endroit (§6).

---

## 32. UNE AMBIGUÏTÉ RÉPARTIE SUR PLUSIEURS EXÉCUTIONS NE SE VOIT PAS D'UNE EXÉCUTION — 2026-09-19

**La règle, en une ligne : toutes nos gardes d'unicité tranchent à l'intérieur d'UN appel, et l'unicité que nous
promettons est une propriété de la BASE ENTIÈRE.** Une garde locale ne peut pas voir qu'une autre exécution a déjà
pris le même objet : de son point de vue, il n'y a pas d'ambiguïté — il n'y a qu'un candidat, le sien.

**L'occurrence, mesurée.** Le bonus « jumeau occidental » de `collecteur-texte.js` testait qu'**AU MOINS UNE** carte
du set déclare « Base Set », puis joignait **TOUTES** les cartes du set à ses produits — `some` puis `all`. Celles
qui ne déclaraient rien étaient prises par le repli par nom (`setlist+nom`, « appartenance par la Setlist seule »).
Et comme ce bonus rejoue depuis **chaque** set japonais dont une page déclare une réimpression, le produit
`Bulbasaur-V1-BS44` a fini rattaché à **sept** cartes Bulbasaur : Base Set, Bulbasaur Deck, Shining Legends,
Pokémon GO, SWSH Promo, BW-P, DPt-P. **279 produits, 1 993 lignes fausses, 4 % des jointures.**

🔴 **ET LE GARDE QUI AURAIT DÛ L'ATTRAPER AVAIT ÉTÉ POSÉ LE MATIN MÊME.** « Un nom qui désigne plusieurs cartes ne
désigne rien » (jointure.js) tranche produit par produit, **une fois toutes les cartes vues** — toutes les cartes
de CET appel. Chaque collecte prenait le produit seule, sans la moindre ambiguïté locale, et écrivait une ligne
parfaitement justifiée. **Sept exécutions irréprochables font un défaut.**

🔑 **LE FILET EST UN CONTRÔLE TRANSVERSAL, ET IL COÛTE UNE AGRÉGATION.** La propriété à vérifier ne se vérifie pas
au moment d'écrire, elle se vérifie **après, sur le tout** : « aucun produit n'est rattaché à plusieurs cartes ».
C'est désormais une ligne de `mesure-catalogue.js`, imprimée à chaque mesure, et `detacher-jointures-fausses.js`
la répare en gardant la carte qui **DÉCLARE** l'impression (tirage, expansion, numéro) — la donnée de la source,
pas une préférence — et en ne touchant à rien quand zéro ou plusieurs la déclarent.

⚠️ **ET LA MÊME QUESTION SE POSE POUR TOUTES LES AUTRES UNICITÉS DU DÉPÔT.** Partout où une garde dit « un seul
candidat » à l'intérieur d'une exécution, écrire le contrôle d'ensemble qui lui correspond : une image par
(carte, set), un `nomAffichage` distinct par set, une vérité par ligne de banc. **Une invariante de base de données
se contrôle dans la base, pas dans la fonction qui écrit.**

⚠️ **Corollaire, déjà connu mais jamais aussi cher (§23)** : une règle corrigée ne corrige AUCUNE ligne déjà
écrite, et `ecrireJointure` fait des upserts — rien n'efface une ligne devenue fausse. Un correctif de jointure se
livre **en deux moitiés**, le code et la reprise des lignes existantes, ou il ne se livre pas.

### 🔑 ET LE CONTRÔLE TRANSVERSAL SE VÉRIFIE CONTRE UN CAS NORMAL CONNU AVANT D'ÊTRE CRU — 2026-09-19

**Le deuxième contrôle posé le jour même a crié, et c'est LUI qui avait tort.** « Une image par (carte, set) » a
rendu **684 couples en double** — un chiffre spectaculaire, écrit noir sur rouge dans la mesure du catalogue. Les
684 ont été ouverts : **tous portent DEUX NUMÉROS DIFFÉRENTS dans le même set.** « Super Rod » est n°188 ET n°276
de Paldea Evolved, « Slowbro » n°030 et n°090 de Pitch Black — un set moderne réimprime ses cartes en secrète et en
illustration rare. **Deux tirages, deux visuels, et c'est le §19 lui-même (« une image appartient à un TIRAGE »)
qu'une clé sans numéro trahissait.** La clé est (carte, set, **numéro**).

⚠️ **CE QUI REND CE PIÈGE PARTICULIER : UN CONTRÔLE QUI SE TROMPE NE RESSEMBLE PAS À UN BOGUE, IL RESSEMBLE À UNE
DÉCOUVERTE.** Il rend un nombre élevé sur une invariante qu'on vient d'écrire, donc il a l'air de prouver qu'on
avait raison de l'écrire. Le réflexe est de réparer les données ; ici, réparer aurait effacé 684 visuels justes.

🔑 **LA PARADE, MÉCANIQUE : avant de croire un contrôle transversal, le passer sur un cas NORMAL connu.** Un set
moderne quelconque suffisait — il a des secrètes, donc il doit sortir à zéro. Un contrôle qui crie sur du légitime
finit contourné le jour où il a raison (§25), et celui-là aurait crié à chaque mesure. **Un contrôle neuf se juge
d'abord sur ce qui MARCHE**, exactement comme une clé d'appariement (§22) — et pour la même raison : les deux
fabriquent des faits qui ont l'air justes.

---

## 31. UNE CLÉ PAR INCLUSION APPARIE TOUJOURS QUELQUE CHOSE — 2026-09-19

**La règle, en une ligne : une clé d'appariement par INCLUSION trouve toujours un partenaire, donc elle ne prouve
rien.** L'égalité peut échouer et le dire ; l'inclusion, jamais : il existe presque toujours un libellé plus court
contenu dans le nôtre, et il a l'air d'un résultat.

**L'occurrence, mesurée.** Pour rattraper les libellés réordonnés (§30), la clé acceptait « les mots de A sont inclus
dans ceux de B, ou l'inverse ». « M-P Promotional cards » **contient** « P Promotional Cards » : les promos **M-P,
L-P, chinoises, thaïes et indonésiennes** ont reçu le set artofpkm des promos « P ». **9 sources fausses, dont 5 pour
des sets qu'artofpkm ne porte pas du tout** — et elles étaient déjà ÉCRITES dans `sources-sets-auto.json` quand je
les ai vues. Restaurées depuis la copie, clé resserrée à l'ÉGALITÉ des mots (l'ordre et le pluriel en moins), 29 sets
retenus, 0 ambigu.

🔑 **CE QUI L'A ATTRAPÉE N'EST PAS UN COMPTE, C'EST D'AVOIR LU LES 9 PAIRES.** Le compte, lui, disait « +54 sources » —
un excellent chiffre, et c'était le symptôme. **Une clé d'appariement se relit ligne à ligne avant de s'en servir**,
parce qu'elle ne produit pas des erreurs visibles : elle produit des faits qui ont l'air justes. Et l'unicité ne
sauve rien si le critère est laxiste — ici chaque faux appariement était parfaitement unique.

⚠️ **Corollaire d'écriture** : un outil qui apparie doit écrire son résultat APRÈS l'avoir imprimé, jamais avant.
Celui-ci écrivait le fichier puis affichait les paires ; la copie de sauvegarde prise à la main est la seule raison
pour laquelle le retour en arrière a coûté une commande.

### La SECONDE forme, le même jour : une COUVERTURE DE NUMÉROS — 2026-09-19

**C'est la version la plus claire de la leçon, parce que l'inclusion n'y porte pas sur un libellé mais sur des
ENTIERS, et que rien dans le code ne ressemble à une inclusion.** Pour apparier les expansions Cardmarket sans ligne
de table aux noms d'expansion que nos propres pages déclarent, la clé demandait : « quelle part des numéros de
l'expansion Cardmarket est couverte par les numéros de ce nom ? », et retenait le meilleur. Ce qu'elle a rendu :

| paire proposée | couverture | ce que c'est réellement |
|---|---|---|
| **`Base-Set` → « White Flare »** | **100 %** | deux sets sans le moindre rapport, 30 ans d'écart |
| `POP-Series-5` → « Blastoise + Kyurem-EX Combo Deck » | 100 % | un deck de 18 cartes « couvre » une série de 17 |

**Sur des plages DENSES de PETITS ENTIERS, toute expansion couvre toute autre** : les numéros 1…17 de POP-5 sont
inclus dans les numéros 1…18 du deck, et les 102 de Base Set dans les 173 de White Flare. La couverture ne mesure
pas l'identité, elle mesure la TAILLE du candidat — plus il est gros, plus il couvre, et la clé choisissait donc
systématiquement le plus gros. C'est exactement l'inclusion de libellés, avec des nombres à la place des mots.

🔑 **ET LE SYMPTÔME EST LE MÊME QU'AU PREMIER CAS : UN TOTAL FLATTEUR.** « 6 568 produits récupérés sans une
requête » — le chiffre que le testeur attendait, tombé du premier essai. Ce qui l'a attrapé n'est ni un test ni un
seuil : **la table des paires a été imprimée et lue ligne à ligne**, et la première ligne disait « Base Set → White
Flare ». Remplacée par l'**ÉGALITÉ du nom** (accents, `&`/`+` normalisés) : 26 paires, **677 produits** — dix fois
moins, et vraies. La couverture est gardée, mais **imprimée à côté comme CONTRÔLE**, jamais comme clé : 17 paires
sur 26 la passent à ≥ 0,9, et les 9 autres se regardent à la main.

⚠️ **LA FORME À RECONNAÎTRE, POUR LA PROCHAINE.** Une clé est une inclusion déguisée dès qu'elle peut répondre
« 100 % » sans que les deux ensembles aient la même taille. Le contrôle est mécanique et tient en une ligne :
**demander la couverture DANS LES DEUX SENS**. `Base-Set → White Flare` rend 100 % d'un côté et 59 % de l'autre ;
une vraie identité rend deux fois le même chiffre. Une clé asymétrique qu'on lit comme une preuve d'identité
appariera toujours le plus gros candidat disponible.

### 🔴 ET LA TROISIÈME FORME BAT LE CONTRÔLE BIDIRECTIONNEL LUI-MÊME — 2026-09-20

**Le contrôle prescrit ci-dessus a répondu 100 % DANS LES DEUX SENS sur un appariement faux.** La ligne « sans
page » `Leafeon-vs-Metagross-Expert-Deck` : 15 numéros Cardmarket, 15 numéros déclarés, couverture 100 %,
inverse 100 %. Elle a produit **14 produits rattachés à deux cartes**. La cause : **c'est un KIT À DEUX DECKS
sous UN SEUL nom d'expansion**, donc le n°6 existe DEUX FOIS, une fois par moitié — 26 cartes déclarent
l'expansion pour 15 numéros distincts.

🔑 **LA COUVERTURE COMPARE DES ENSEMBLES, ET UN DOUBLON S'ÉCRASE DANS UN `Set`.** Les deux sens rendent donc le
même chiffre alors que les deux populations n'ont PAS la même taille — exactement ce que le contrôle
bidirectionnel était censé interdire. **Il ne mesure pas les tailles, il mesure des appartenances**, et
l'information qui manquait (« ce numéro désigne combien de cartes ? ») avait été détruite avant qu'il ne
regarde. Un contrôle posé sur une donnée déjà dédoublonnée ne peut pas voir un doublon.

⚠️ **LE PENDANT DE LA GARDE PAR LE NOM, ET IL MANQUAIT : un NUMÉRO qui désigne plusieurs cartes ne désigne
rien.** `jointure.js` porte cette garde pour le nom depuis le 2026-09-19 ; elle n'existe pas pour le numéro.
Mesuré sur les 53 lignes proposées : **5 portent au moins un numéro ambigu, 85 produits concernés**, et une
seule est pathologique (LED, 14 numéros sur 15). La ligne de table est refusée quand la MAJORITÉ des numéros
sont doublés — ce n'est pas un seuil de réglage mais un constat de structure : **si la plupart des numéros sont
doublés, le nom ne couvre pas une numérotation mais plusieurs.** Les collisions ISOLÉES (1 sur 19) ne referment
pas la ligne — elles coûteraient 18 produits justes pour un faux — elles sont ÉCRITES dans `controle.numerosAmbigus`
et attendent la garde par numéro, qui ne se câble pas avant d'avoir été mesurée sur ce qui marche déjà (§22).

🔑 **ET LE CORRECTIF S'EST LIVRÉ EN DEUX MOITIÉS (§23), PARCE QUE LA PREMIÈRE NE SERT À RIEN SEULE.** Refuser la
ligne LED ne retire aucune des 29 jointures déjà écrites. `retirer-collecte-set.js` est la moitié manquante :
sauvegarde, puis retrait des lignes, des `liens.idProduct`, des restes et de l'état — 15 produits perdent leur
seule carte, et c'est le bon résultat, ils en montraient deux dont une fausse.

---

## 30. UNE RECHERCHE QUI NE TROUVE RIEN ET UNE DONNÉE QUI N'EXISTE PAS RENDENT LE MÊME RÉSULTAT — 2026-09-19

**L'occurrence.** Pour savoir si Bulbapedia couvrait les promos indonésiennes et thaïes, la sonde
demandait `intitle:ITCG OR intitle:TTCG OR intitle:KTCG` : **0 résultat**, et j'en ai conclu
« aucune source, 6 expansions sans voie » — écrit au plan comme un fait. Les pages existent :
**`SV-P Promotional cards (ITCG)`, `M-P Promotional cards (TTCG)`, et 15 autres**, trouvées par une
requête qui n'énumérait rien de neuf, `intitle:"Promotional cards"` — **55 pages**. Le suffixe est
entre parenthèses, et la recherche par titre ne le voyait pas. Une formulation trop étroite rend
exactement ce que rend une absence : le vide. **1 620 produits** attendaient derrière ce vide.

🔑 **LA PARADE EST L'ÉNUMÉRATION, PAS LA REFORMULATION.** On ne prouve pas une absence en cherchant
mieux : on liste la population entière (ici : toutes les pages « Promotional cards », tous les
suffixes de langue) et on regarde ce qu'elle contient. Une requête ciblée répond « je n'ai pas
trouvé » ; seule une énumération répond « ça n'existe pas ». Et tant qu'on n'a pas énuméré, on écrit
**« non trouvé par telle requête »**, jamais « n'existe pas ».

⚠️ **ET LA CINQUIÈME, LE MÊME JOUR, SUR UN LIBELLÉ** : l'appariement des sources d'images exigeait l'ÉGALITÉ EXACTE du
nom. artofpkm écrit « High Class Deck, Inteleon VMAX », Cardmarket « Inteleon VMAX High Class Deck » ; « Earth Groudon
ex » contre « Earths Groudon ex » ; « Palkia LV.X » contre « Palkia LVX ». **29 sets présents passaient pour absents.**
Même famille que les crochets d'Unown, le ☆ et le préfixe SWSH : un ordre, un pluriel ou un point qui diffère, et la clé
ne se trompe pas — elle se TAIT, ce qui coûte plus cher, parce qu'un silence ne réclame rien. La clé de secours compare
les MOTS, et c'est l'**unicité** qui remplace l'exactitude.
🔴 **ET LA VERSION LARGE DE CETTE CLÉ A ÉTÉ ÉCRITE PUIS REFUSÉE DANS L'HEURE.** Accepter l'INCLUSION d'un libellé dans
l'autre (au lieu de l'égalité) donnait « P Promotional Cards » aux promos **M-P, L-P, chinoises, thaïes et
indonésiennes** : 9 sources fausses, dont 5 pour des sets qu'artofpkm ne porte pas du tout. **Un libellé plus court n'est
pas le même set.** Ce qui l'a attrapé n'est pas un test, c'est d'avoir LU les 9 paires avant de s'en servir — une clé
d'appariement se relit ligne à ligne, toujours, parce qu'elle fabrique des faits qui ont l'air justes.

⚠️ **C'EST LA QUATRIÈME FOIS, ET LES TROIS AUTRES ONT LA MÊME FORME** : PKMJP « source de texte »
écartée sur un compte au lieu d'un constat (§22), les sections « Additional Cards » jugées sur leur
nombre d'entrées (§22), les listes artofpkm arrêtées à 100 lues comme la limite de la source
(§21 n°7). Chaque fois, **un instrument muet a été lu comme un monde vide**. Avant d'écrire qu'une
donnée n'existe pas, dire quel instrument l'a cherchée et ce qu'il aurait manqué.

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

> ⏸️ **SUSPENDU, NI TOMBÉ NI TENU — le banc n'a pas grossi d'une ligne depuis le 2026-09-08.** Ce
> paragraphe repose sur 50 lignes jugeables et sur la mesure « `margeConfortable` prédit l'erreur à
> l'envers ». Les deux dépendent d'une population GELÉE. **Une conclusion qui « tient » parce que rien
> n'a été scanné depuis n'est pas confirmée** (§36). Elle attend des SCANS, pas une relecture — et la
> consigne « ne pas la reproposer sans refaire cette mesure » reste entière, avec cette précision :
> refaire la mesure suppose d'abord de nouvelles lignes.

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

> ⏸️ **SUSPENDU, NI TOMBÉ NI TENU — mesuré sur 128 lignes jugeables, et le banc est figé depuis le
> 2026-09-08.** La DÉCISION (non promu) tient : elle a été prise par le testeur sur ce chiffre. Mais le
> chiffre, lui, ne peut plus bouger. ⚠️ Le paragraphe dit déjà la condition de réouverture — « si un
> jour le vivier ramenait ces 11 vérités » — et elle ne peut se vérifier que sur des lignes NEUVES.
> **Tant que rien n'est scanné, ce § ne peut ni se confirmer ni s'infirmer.**

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

> ⏸️ **SUSPENDU, NI TOMBÉ NI TENU — 84 lignes classables d'un seau qui n'a pas bougé depuis le
> 2026-09-08.** Le « 60,7 % d'égalités strictes » et le tableau des ordres de tri décrivent une
> population gelée. ⚠️ La consigne « ne pas reproposer plus cher / moins cher » tient — elle repose sur
> une mesure faite, pas sur une intuition — mais **le tri entre égaux ne sera réellement « fermé » que
> quand un lot neuf l'aura reconfirmé.** Il attend des SCANS.

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

## 16. La troisième vérité fausse, trouvée par le pont — et pourquoi aucun contrôle de saisie ne l'aurait attrapée — 2026-09-12

**L'occurrence.** La mesure du pont (notre base `cartes` à la place de TCGdex, 103 vérités couvertes
sur 140) rendait UN faux affirmé : **L070 Slowpoke n°079**. Le pont désignait ROG « Slowpoke
[Afternoon Nap | Headbutt] » par l'attaque lue ; la vérité du fichier disait N1 `606445`. Les deux
sont faux : la vraie carte est le promo UNP `571765`, hors des 28 sets. C'est le cas du §14, réalisé
et **mesuré comme faux affirmé** — une vérité fausse par ancre d'identité a survécu à tous nos
contrôles jusqu'à ce qu'une source INDÉPENDANTE la contredise.

**Ce qu'aucun contrôle de saisie n'aurait attrapé.** La saisie était JUSTE : `606445` pour H005,
vérifié sur sa photo, le 21/08. Le défaut n'est pas dans l'entrée, il est dans la LECTURE :
`rattacherVerites` donnait cette vérité à toute ligne de même identité, dont L070 scannée le 06/09.
Un contrôle d'URL, de slug, de produit — tout ce que `saisir-verites.js` sait faire — voit une
saisie exacte. Seule la règle du §14 le voit, et elle est maintenant câblée (`banc-seaux.js`,
`parCle`) : **une saisie ne se rattache jamais à une ligne scannée après elle**. Coût mesuré :
1 ligne sur 140, L070, qui n'a plus de vérité ; H005 garde la sienne. La clé et l'ancre n'ont pas
bougé (§5).

**DÉCISION DU 2026-09-12, PAS UNE DETTE : L070 RESTE SANS VÉRITÉ.** La récupérer demanderait un
marqueur d'exclusivité par entrée, donc de toucher à l'ancre d'identité — l'instrument qui juge
tous les autres, et qui s'est retourné trois fois cette semaine. Une vérité sur 140 ne le justifie
pas. Les quatre autres lignes écartées par la règle (H070, H008, H032, H010) sont des rescans dont
la production a rendu EXACTEMENT le produit de la vérité voisine : elles se resaisissent sans
risque, sous leur propre clé, avec le même `idProduct`.

🔑 **La leçon.** Après Berry et l'ancre du 04/08, c'est la troisième vérité fausse, et les trois ont
la même forme : une vérité exacte rattachée à la mauvaise ligne. **Ce qui les trouve n'est jamais
un contrôle interne — c'est une seconde source qui ne partage pas nos hypothèses.** Le pont en est
une ; il faut le garder aussi comme instrument de mesure du banc, pas seulement comme pont.

---

## 23. Un seuil posé sur une supposition coûte dans l'AUTRE sens — 2026-09-12

### ⬇️ 480 → 350 LE 2026-09-21, ET CE QUE LA MESURE A VRAIMENT DIT — 37 SETS, 3 320 CARTES

**Le seuil est passé de 480 à 350 px** sur autorisation conditionnelle (« si le gain dépasse 500 »).
La distribution réelle : **les archives Bulbagarden servent le vintage occidental à 350 px**, et
350 px reste **2,2× la vignette de 157 px**, le seul usage qui existe. `remettre-en-file.js` relit les
refus dans le même geste que le changement — c'est la leçon de ce § appliquée.

🔴 **MAIS LE CHIFFRE QUE J'AI ANNONCÉ D'ABORD ÉTAIT FAUX D'UN FACTEUR QUATRE, ET TOUJOURS POUR LA MÊME
RAISON.** J'ai jugé les sets sur leur largeur **MINIMALE** — 9 sets, 643 cartes. La production les
juge sur leur **MÉDIANE** (`collecteur-images-bulba.js:135`), et elle écarte déjà les fichiers isolés
trop petits un par un (l.143). Avec le bon critère : **37 sets, 3 320 cartes.** Skyridge a un minimum
de 314 et une médiane de **465** ; Diamond & Pearl, 200 et **381** ; Legends Awakened, 245 et **400**.
🔑 **Juger un ensemble sur son pire élément, c'est le refuser sur son bruit.** Et la parade est celle
du haut du catalogue, pour la quatrième fois ce jour-là : **la sonde doit lire LA MÊME CHOSE que le
code de production.** Ici elle lisait un autre agrégat du même champ — ce n'est même pas un champ mal
nommé, c'est une STATISTIQUE différente, et ça suffit à fabriquer un refus.

⚠️ **TROIS AUTRES DE MES SONDES ONT MENTI SUR CE MÊME DOSSIER, AVANT CELLE-LÀ** : `completImages.mesures`
(le champ est `mesures`), `mesures` sur les sets Bulbapedia (leur champ est **`infosListe`**), et un
appariement code↔slugSet entre deux collections qui ne partagent pas leur clé. **Quatre vides parfaits
d'affilée sur un seul sujet.** Aucun n'a levé d'erreur ; chacun rendait un tableau plausible.

🔑 **ET LA RÈGLE QUE LA MÉDIANE DONNE, ÉCRITE POUR ÊTRE REPRISE AILLEURS : JUGER UN ENSEMBLE SUR SON
PIRE ÉLÉMENT, C'EST LE REFUSER SUR SON BRUIT.** Une liste de 150 fichiers contient toujours une
miniature, un placeholder, une vignette de navigation. Un critère qui prend le MINIMUM ne mesure pas
la qualité du set, il mesure la présence d'un accident — et il devient d'autant plus sévère que
l'échantillon est GRAND, ce qui est l'inverse de ce qu'on veut. **Un agrégat sur une population se
choisit d'après ce qu'on décide : refuser un SET demande une statistique de masse (médiane), écarter
un FICHIER demande le fichier lui-même.** Les deux gestes existent déjà dans le collecteur, aux
lignes 135 et 143 ; c'est ma sonde qui confondait les deux.

### 🔑 ET LE REFUS DE DESCENDRE À 340 EST LA VRAIE LEÇON DE CE PARAGRAPHE — 2026-09-21

🕳️ **CE QUI RESTE REFUSÉ, NOMMÉ** : Supreme Victors (médiane 245), Rising Rivals (245), POP-3 (266) —
et **Secret Wonders + Platinum à 343 px, sept pixels sous le seuil**.

> # **UN SEUIL QU'ON BOUGE POUR SAUVER DEUX CAS N'EST PLUS UN SEUIL.**

**340 px se défendrait aussi bien que 350 dans l'absolu — c'est précisément ce qui rend le geste
mauvais.** La valeur n'aurait pas été choisie sur ce qu'elle protège, elle aurait été choisie sur la
liste des sets qu'on voulait dedans. Un seuil dérivé de ses propres refus ne décide plus rien : il
enregistre une préférence et lui donne l'apparence d'une mesure. **Et l'opération est reproductible à
l'infini** — deux lignes de plus à 331 px, et 330 se défendra tout aussi bien.

🔑 **LA FORME EST CELLE DU §7, APPLIQUÉE À UN RÉGLAGE AU LIEU D'UNE ÉTIQUETTE : dériver le critère de
ce qu'on veut qu'il produise le rend vrai par construction et invérifiable pour toujours.** La
différence entre 480 → 350 et 350 → 340 n'est pas la taille du pas, c'est la DIRECTION DE LA
JUSTIFICATION : 350 vient de la distribution des sources (les archives Bulbagarden servent le
vintage occidental à cette largeur) et de l'usage (2,2× la vignette de 157 px) ; 340 ne viendrait que
de Secret Wonders et Platinum.
⚠️ **Le test, avant de toucher un nombre : puis-je énoncer la nouvelle valeur SANS nommer ce qu'elle
fait passer ?** Si la seule justification disponible est une liste de cas, ce n'est pas un seuil
qu'on ajuste, c'est une exception qu'on déguise en règle. **On les écrit, on ne les rattrape pas.**

Le seuil de résolution des images était **560 px**, posé d'avance et jamais revu. Il a fait REFUSER
**DEUX sets, pas un** : `DP5c` (20:35 UTC) et `DP2` (20:47 UTC), dont les originaux sont **tous deux à
500×700** sur 3 mesures sur 3 — l'ère DP n'a pas la résolution du vintage japonais. ⚠️ Ce paragraphe
ne citait que DP5c ; DP2 n'était écrit nulle part, et c'est exactement ainsi qu'il a été oublié.
Mesure faite avant de le toucher : à **157 px de vignette**, une source de 500 px et une de 593 px
sont **indiscernables à l'œil** (bandes basses superposées, symbole illisible dans les deux). Le seuil
ne protégeait que la vue pleine carte, **qui n'existe pas encore sur le site**. Abaissé à 480 par
décision du testeur, sur cette mesure.

🔑 **LA LEÇON EST LE PENDANT DU PIÈGE HABITUEL.** On se méfie du seuil qu'on assouplit pour sauver un
chiffre ; celui-ci était l'inverse — un seuil JAMAIS RÉEXAMINÉ qui refusait du bon travail. Et il
coûtait **silencieusement** : un set refusé ne réclame rien, il disparaît de la file avec une raison
plausible. ⚠️ Un seuil doit porter **ce qu'il protège** (ici : la vue pleine carte) et non un nombre
seul, sinon personne ne peut dire quand il est devenu faux. La résolution réelle de chaque set est
conservée dans `completImages.mesures` : le jour où la vue pleine carte existera, on saura lesquels
sont bas sans recollecter.

### Et le seuil a changé sans que ses refus changent — 2026-09-13

**L'occurrence.** Le seuil passe à 480 le 2026-09-12 à **20:37 UTC** (`9b4c0bb`, 22:37 heure de Paris).
DP5c avait été refusé à **20:35 UTC**, deux minutes AVANT le commit ; DP2 à **20:47 UTC**, dix minutes
APRÈS — par un worker qui tournait encore l'ancien code. **Personne ne les a remis en file** : la
nuit s'est écoulée file vide (`fait×26 refuse×2`), 0 image après 21:07 UTC, et **185 cartes**
(62 + 123) sont restées sans visuel alors que la règle qui les excluait n'existait plus. Remis en
file le 2026-09-13 à 08:18 UTC.

⚠️ **CE PARAGRAPHE A D'ABORD MÉLANGÉ DEUX FUSEAUX** : « seuil à 22:37 » (heure de Paris, celle de
`git log`) face à « refusés à 20:35 et 20:47 » (UTC, celle de la base). Il faisait lire deux heures
d'écart là où DP2 a été refusé dix minutes après le changement de seuil. **Toute heure écrite ici
porte son fuseau** : `git log` rend l'heure locale, Mongo et les scripts de mesure rendent l'UTC.

🔑 **LA LEÇON : QUAND UN SEUIL CHANGE, LES DÉCISIONS PRISES SOUS L'ANCIEN NE SE RÉÉVALUENT PAS TOUTES
SEULES.** Un refus est une décision datée, prise sous une règle datée ; changer la règle ne touche
à aucune des décisions déjà écrites. **Il faut une LISTE de ce qui a été refusé, relue à chaque
changement de règle** — dans le même geste que le changement, pas plus tard. Ici la liste existe
déjà : `file_images` `{ etat: 'refuse' }` avec son `resultat`. Elle n'a simplement pas été lue.

⚠️ **ET LE GESTE ÉVIDENT NE MARCHE PAS.** `--enfiler=DP5c` fait un `$setOnInsert` : sur un set déjà
présent dans la file, il **ne fait rien** et imprime quand même « enfilé ». La remise en file s'est
faite par mise à jour directe, bornée à `etat: 'refuse'` et `resultat: 'refuse-resolution'`, avec
`remisEnFileLe` et `remisEnFileMotif` sur la ligne. Même famille que le §21 : un résultat plausible,
aucun effet.

⚠️ **ET UN SEUIL VIT DANS LE PROCESSUS, PAS DANS LE DÉPÔT** (§17). Un worker qui tourne sur un
commit antérieur à `9b4c0bb` a encore 560 : il relit les mesures en cache (500 px), refuse de
nouveau **sans une seule requête**, et remet les deux sets en `refuse`. La remise en file ne vaut
que si le worker a été redéployé après le changement de seuil — à vérifier, pas à supposer.

### 🔴 CE PARAGRAPHE S'EST RÉALISÉ MOT POUR MOT LE LENDEMAIN, ET J'AVAIS CITÉ LE § EN L'ÉCRIVANT

**Le 2026-09-21, j'ai abaissé le seuil à 350, remis 37 sets en file, et annoncé « la file contient
39 unités ». Une heure plus tard : `attente×1 · refuse×52`. Les 37 étaient ressortis refusés,
`refuse-resolution`, en 1 à 3 secondes chacun.**

🔑 **ET LA PREUVE QUE CE N'EST PAS LE SEUIL QUI REFUSE TIENT EN UNE LIGNE DE LA MESURE : WP a un
minimum de 353 px, une médiane de 388, et ZÉRO fichier sous 350.** Aucun critère à 350 — ni le
minimum, ni la médiane, ni le filtrage par image — ne peut refuser ce set. GH, GC, MA, NDI, NR, JU,
FO, SI sont dans le même cas. **En revanche les 36 sets refusés ont TOUS une médiane sous 480.**
Le worker applique donc 480 : il tourne sur un commit antérieur, et il a refusé les 37 **sans une
seule requête**, en relisant ses mesures en cache. `remettre-en-file.js` a écrit dans une base que
le processus ne lit pas de la même façon.

🔴 **LA FAUTE N'EST PAS D'AVOIR IGNORÉ LA RÈGLE, ELLE EST PIRE : `remettre-en-file.js` CITE CE §
DANS SON EN-TÊTE.** J'ai écrit « la leçon de ce § appliquée » au-dessus d'un outil qui ne vérifiait
pas la seule condition que le § pose. ⚠️ **Citer un paragraphe n'est pas l'appliquer, et c'est la
forme la plus trompeuse d'erreur de ce dépôt** : le commentaire rend le code d'à côté plus crédible,
pas plus correct (§21 bis). Le geste manquant tient en une question — *sur quel commit tourne le
processus qui va lire ça ?* — et elle n'a pas de réponse dans le dépôt.

⚠️ **ET L'INSTRUMENT QUI EXISTE DÉJÀ NE RÉPOND PAS À CETTE QUESTION.** `sources-deployees.js` imprime
« sources de la version poussée : origin/main 00559af » : il compare au dernier commit **POUSSÉ**, ce
qui est un autre fait. Poussé ≠ déployé. **Entre les deux il y a un redéploiement Render que
personne ne mesure**, et c'est exactement l'intervalle où les deux sets de 2026-09-12 s'étaient
déjà perdus.
🔑 **CE QU'IL FAUDRAIT, ET C'EST PETIT : que le worker ÉCRIVE SON COMMIT dans le verrou global à
chaque battement.** Un verrou dit déjà qui tient, sur quelle machine, depuis quand — il lui manque
*avec quel code*. La question « ce refus a-t-il été pris sous la règle d'aujourd'hui ? » deviendrait
lisible en base, au lieu de se déduire d'une distribution de largeurs. **Dette nommée, non faite.**

✅ **ET CINQ SETS SONT QUAND MÊME PASSÉS — DP5c, DP2, N4, VS, EC1.** Ce sont les sets **artofpkm**,
dont les mesures étaient à 500 et 593 px : au-dessus de 480 comme de 350, ils passent quel que soit
le commit. Leur succès prouve que la remise en file elle-même fonctionne, et isole la cause au seul
seuil du processus. 🕳️ Le sixième, **PCG2, reste refusé pour une AUTRE raison, et c'est la dette
nommée dans `seuils-images.js`** : 3 mesures, minimum 162 px, et `collecteur-images.js` (artofpkm)
refuse le set entier sur sa pire image. Deux causes distinctes dans une même liste de refus — c'est
pour ça qu'un refus porte un motif et qu'on ne relit jamais une liste « au global ».

## 21 bis. Corrigé d'un côté, laissé de l'autre — le même défaut, deux fois

Deux fois dans la journée, un défaut réparé à un endroit est resté intact à son jumeau :
- **le double numéro** — une carte e-Card porte deux numéros dans son set (« 123/091 ») ; la jointure
  du TEXTE a été corrigée pour les prendre tous, celle des IMAGES est restée sur le premier. L'image
  du 091 restait orpheline, sans que rien ne le dise.
- **le `$unset` du champ image** — `images[]` a remplacé `image` dans la jointure, mais l'effacement
  (`--arreter-et-effacer`) visait encore `image.source`.
- **🔴 et une troisième fois le 2026-09-13, sur le verrou** — le BATTEMENT avait été rendu conditionnel
  à la possession (`091f8d2`), la LIBÉRATION non : `$unset` par `_id` seul, lancé dès le SIGTERM. Un
  pod qui s'arrêtait effaçait le verrou de son successeur, et le battement de celui-ci, conditionnel
  mais muet, le laissait collecter sans verrou. Le pod de DP2 a tourné **de 08:21 à 13:39 UTC sans
  verrou global** (compteur cumulé 200 → 324, DP5c pris à 13:29:28 pile sur son cycle de 10 min), et
  deux pods ont frappé artofpkm ensemble de 08:21:12 à 08:21:53. Corrigé dans `d9d4767`
  (`collecte-cartes/verrou-source.js`, une seule définition pour le global et le set).
- **🔴 et une QUATRIÈME fois le 2026-09-19, sur la clé de numéro — et cette fois ça se VOYAIT à l'écran.**
  `cleNumero` (le préfixe alphabétique gardé) a été écrit le 2026-09-12 pour la jointure du TEXTE, après
  29 jointures fausses sur la sous-série S d'EC1. **La jointure des IMAGES est restée sur `chiffresDuNumero`
  pendant sept jours**, et artofpkm numérote les énergies d'un set à part : `en1`…`en8`, réduits à `1`…`8`.
  **La fiche 001 Ekans de Magma VS Aqua affichait une Énergie Plante** — 15 visuels faux (0,08 % des 19 596),
  signalés par l'agent du site, pas par nous. ⚠️ **Le défaut était dans le MÊME dépôt, sous le MÊME nom,
  exporté par le MÊME module** : `jointure.js` exporte les deux clés, et le collecteur d'images importait
  l'ancienne. Un `require` est un endroit où une règle se duplique sans qu'on la recopie.
  🔑 **Et ce qui a permis de trancher est un rejeu AVANT d'écrire** : les deux clés rejouées sur les 19 596
  images — **17 904 identiques, 0 déplacée, 0 ambiguë, 15 perdues, et les 15 perdues sont exactement les
  15 faux**. Le coût nul du §20, mesuré, pas supposé. ⚠️ **Un visuel faux ne se prouve pas par le nom** :
  artofpkm traduit autrement (« Janine's Secret Technique » = « Janine's Secret Art », 129 cas) et numérote
  autrement (`DPBP#468`, 555 cas). **Seuls les 15 où le nom ET le numéro discordent étaient faux** — un seul
  des deux critères pris isolément aurait fait détacher des centaines de jointures justes.

- **🔴 et une CINQUIÈME fois le 2026-09-20, sur ce qu'une ligne de table « prend ».** `generer-table-sans-page.js`
  porte un commentaire de six lignes qui explique pourquoi **une ligne non vérifiée ne prend pas son SLUG** : elle
  ne peut pas collecter, donc la compter comme pourvue laisserait son expansion sans collecte pour toujours. Deux
  lignes plus haut, `connus` — l'ensemble des NOMS D'EXPANSION déjà couverts — était construit sur
  `[...TABLE, ...TABLE_AUTO]`, donc **sur ces mêmes lignes non vérifiées**. Le raisonnement était écrit, appliqué
  à un des deux ensembles, et pas à l'autre. **Mesuré : 122 candidates sans la moindre trace de vérification, dont
  75 dont l'expansion est DÉJÀ DÉCLARÉE par nos cartes — 2 999 produits invisibles aux DEUX voies à la fois**,
  la page jamais vérifiée et le retournement aveuglé par la ligne qui ne fait rien. Corrigé : une ligne qui ne peut
  pas collecter ne prend ni son slug NI son nom. Effet immédiat : 24 lignes → 91, dont 52 vérifiées, **+893 fiches
  en une exécution et zéro requête**.
  ⚠️ **Et la forme est pire que les quatre autres : ce n'est pas une règle dupliquée dans deux fichiers, c'est la
  MÊME FONCTION, à trois lignes d'intervalle, avec la justification écrite au-dessus.** Relire le commentaire ne
  suffisait pas — il fallait relire ce que la ligne suivante FAISAIT.

- **🔴 et une SIXIÈME fois le 2026-09-20, dans `verifier-table.js`, avec la justification écrite au-dessus.**
  Un commentaire de trois lignes dit : « le critère est la COUVERTURE… **le ratio le refuserait, la
  couverture non** » — et la couverture n'était calculée que pour les lignes `numerosDepuisSetlist`.
  `Shining-Fates` a donc été refusé sur `entrées/produits = 0,37`, et la voie « sans page » a joint le même
  set à **196/196**. Cardmarket vend PLUSIEURS PRODUITS PAR CARTE (holo, reverse, V1/V2) : sur tout set
  occidental moderne le ratio est structurellement bas et ne dit rien de la jointure. Couverture calculée
  partout, **en ADMISSION seulement** (coût nul, §20) : +17 lignes, 782 produits.
- **🔴 et une SEPTIÈME fois le même jour, dans le parseur.** `jpdeckkit` (kit japonais) était lu depuis le
  2026-09-15 ; **`deckkit` (kit occidental) ne l'a jamais été.** Une carte de Trainer Kit déclare son tirage
  sans `expansion=` :
  `{{PokémoncardInfobox/Expansion|deckkit={{TCG|XY Trainer Kit: Latias & Latios}}|halfdeck=Latias Half Deck|cardno=4/30}}`
  L'impression était donc INVISIBLE, et les onze Trainer Kits (≈ 500 produits) restaient sans voie : la page
  existe, la Setlist énumère ses 60 entrées, et la vérification échouait sur « l'échantillon n'a pas de
  tirage intl ». ⚠️ **Ces entrées tombaient déjà dans `entreesNonRendues`** — le compteur écrit exactement
  pour ça. Il comptait, et personne ne l'a lu en face de la question (§21). Rejeu mesuré avant écriture :
  **204 impressions gagnées, 0 perdue, 0 déplacée** sur 3 000 cartes.

🔑 **Quand on corrige une règle qui existe en deux exemplaires, on corrige les deux dans le même
commit, ou on n'en corrige aucun.** C'est la règle de symétrie du banc (§9), appliquée aux jointures :
deux définitions de la même règle divergent toujours, et la seconde ne se découvre que par accident.

🔑 **ET LA FORME LA PLUS COÛTEUSE N'EST PAS LA RÈGLE DUPLIQUÉE DANS DEUX FICHIERS — C'EST CELLE QUI EST
ÉCRITE EN COMMENTAIRE À TROIS LIGNES DE L'ENDROIT OÙ ELLE N'EST PAS APPLIQUÉE.** Trois fois le 2026-09-20 :
`connus`/`slugsPris` dans la même fonction, la couverture de `verifier-table.js` sous sa propre
justification, `deckkit`/`jpdeckkit` dans le même `flatMap`. **Relire le commentaire ne suffit pas : il
faut relire ce que la ligne suivante FAIT.** Un commentaire juste rend le code d'à côté plus crédible, pas
plus correct.

## 21. Le motif du 2026-09-12 : QUATRE échecs silencieux en un jour, tous de la même famille

Quelque chose ne se fait pas, et **rien ne le signale**. Quatre fois dans la même journée, sur quatre
mécanismes différents :

1. **Le verrou par set ne protégeait pas la source.** Deux collecteurs ont tourné en parallèle sur
   deux sets, chacun à sa cadence : rien n'a prévenu, les logs des deux étaient parfaits (§17).
2. **Le verrou global ressuscité en zombie.** Un battement arrivé après la libération recréait un
   verrou sans propriétaire, frais, qui bloquait son successeur trois minutes en affichant
   « pid undefined » (§17).
3. **Les sets interrompus rangés en `refuse`.** G2 et SI-JP sortaient de la file POUR TOUJOURS, avec
   `resultat: 'interrompu'` écrit juste à côté et personne pour le lire.
4. **La table figée par l'état.** Ajouter une section à `setlist` sur un set déjà collecté ne
   produisait RIEN : `titres` était relu de l'état, la nouvelle section ignorée sans un mot.

**Et la liste s'est allongée le 2026-09-13 — même forme, trois de plus :**

5. **La libération du verrou effaçait celui d'un autre** (§21 bis) : le pod de DP2 a collecté cinq
   heures sans verrou global, son battement conditionnel échouant sans un mot.
6. **Un `en-cours` jamais repris** : DP5c immobile cinq heures, 8 originaux sur 70, parce que la boucle
   ne prenait que les `attente`.
7. **🔴 LA LISTE TRONQUÉE À 100.** `listerSet` (artofpkm.js) cherchait le lien « page suivante » par deux
   motifs devinés ; aucun ne matchait ; il rendait la page 1 comme un set complet. **4 listes sur les 30
   des 28 sets s'arrêtent à n = 1…100 pile, sans un trou** — EC1, N4, VS, DP2 — dont trois sets ont plus
   de cartes (113, 142, 123) : **78 cartes sans image** rangées en « la source ne les a pas ». Je l'ai
   d'ailleurs écrit ainsi, et le testeur allait en tirer une règle sur « tous les sets DP à venir ».
   🔑 **UN COMPTE ROND EST UN SIGNAL, PAS UN RÉSULTAT.** 100, 50, 1 000 : une valeur ronde en fin de liste
   se vérifie avant de se lire comme une limite de la source. ⚠️ Correction `69f0c8e`, **page 2 non encore
   prouvée** : la requête de vérification a été refusée par le verrou global que tenait le worker —
   c'est le correctif 5 qui fonctionne. La preuve viendra de la première relecture de ces quatre sets.
   ⚠️ **RELECTURE DU 2026-09-14, 18:43 UTC : NON CONCLUANTE.** Le worker (pod `…-6qxkh`) a fait **2 requêtes
   par set** — page 1, page 2 — et les quatre listes sont restées à 100 : la page 2 n'a apporté **aucun
   n nouveau**. Deux causes possibles, que la base ne sépare pas : le serveur ignore `?page=2` et rend
   la page 1 (100 lues, 0 nouvelle), ou la page 2 est vide (0 lue). Le compte « lues » n'est imprimé que
   dans les logs Render (`liste 150 page 2 : N entrées lues`). **Un compte qui décide et qui ne vit que
   dans un log n'est pas encore une mesure** : il faudra l'écrire dans l'état.

**Et un huitième le 2026-09-15, le plus gros :**

8. **🔴 LA SETLIST ÉCARTAIT LES CARTES À SUFFIXE, SANS UN MOT.** `entreesDeLaSetlist` ne lisait que
   `{{TCG ID|A|Nom|B}}` ; toute autre entrée faisait `continue`. Or Bulbapedia écrit une carte V, VMAX, VSTAR, ex,
   GX, EX ou ☆ par un LIEN (`[[Kyurem V (Lost Abyss 29)|Kyurem]]{{TCGV}}`) ou par un TCG ID à 4 paramètres.
   **1 064 entrées perdues sur les 54 sets collectés** : 737 au bloc 1, 318 aux dix occidentaux, 9 au vintage.
   Aucun chiffre ne criait : la concordance (`produits = joints + restes`) était juste, puisqu'une carte jamais
   énumérée tombe proprement en reste. Seul le taux de jointure du bloc 1, **0,768 pour ~1 attendu**, a fait
   chercher. Et le vintage, qui n'a presque pas de suffixes, joignait à 97,6 % : c'est ce chiffre qui a caché le
   défaut pendant des semaines. Corrigé (`5e77b47`, `ef55681`), bloc 1 re-collecté : **16 / 16 concordants,
   0 titre manquant, jointure 3 288 / 3 320 = 0,990**. Ce que la Setlist ne lit pas est désormais COMPTÉ par
   nature (`ignorees`, `natureIgnoree`) et écrit dans l'état (`lectureSetlist`). ⚠️ Les dix occidentaux, G2, DP5c,
   PCG6 et PCG9 ne sont pas encore re-collectés : les restes des §22 et §24 datent d'avant le correctif, et une
   part d'entre eux est ce défaut, pas l'absence de la carte sur la page.
   🔑 **UNE CONCORDANCE EST UNE TAUTOLOGIE POUR CE QUI N'A JAMAIS ÉTÉ ÉNUMÉRÉ.** `produits = joints + restes`
   ne dit pas si l'énumération a tout vu : il faut un compte INDÉPENDANT de l'énumération en face (ici : les
   gabarits de la section, ou les impressions portées par les pages).

🔑 **LA FORME COMMUNE, ET CE QU'ELLE COÛTE.** Aucun de ces quatre n'a jeté d'erreur, aucun n'a fait
baisser un chiffre : ils ont tous produit un résultat PLAUSIBLE. Le premier a rompu un engagement
envers un tiers, le quatrième m'a fait conclure « rien à récupérer » d'une mesure qui n'avait rien
mesuré. **Un défaut qui lève une exception se corrige le jour même ; un défaut qui rend un résultat
plausible se découvre des semaines plus tard, par accident.**

⚠️ **CE QUI LES ATTRAPE N'EST PAS LA RELECTURE, C'EST LE DÉNOMINATEUR IMPRIMÉ.** Les quatre auraient
été vus si le code avait dit ce qu'il FAISAIT et pas seulement ce qu'il rendait : « 95 titres retenus
(repris de l'état : 95) » l'a montré dès qu'on l'a imprimé. Un compteur qui affiche l'entrée ET la
sortie d'une étape rend ces défauts visibles à la première exécution. C'est la même règle que
« tout outil de mesure imprime son dénominateur », appliquée aux étapes et plus seulement aux taux.

## 28. LE CHINOIS : UN CHANTIER DISTINCT, OUVERT LE LENDEMAIN ET QUI MARCHE — 2026-09-14, corrigé le 2026-09-20

✅ **À LIRE AVANT LE RESTE DU PARAGRAPHE, QUI DATE DE LA VEILLE DE L'OUVERTURE.** La route « (ATCG) » que ce
texte décrit comme « une autre énumération, un autre chantier » a été ouverte **le 2026-09-15** et elle
produit : **40 lignes chinoises vérifiées, 38 sets collectés, 5 675 produits fichés — 92,8 %**. Ce qui reste
fermé est ce que la suite décrit : les expansions chinoises **rangées « japonais » par `codes_set`**, qu'il ne
faut pas prendre pour du japonais.

🔴 **ET CE PARAGRAPHE A FAILLI DÉTRUIRE CE TRAVAIL.** Le 2026-09-20, lisant « mis de côté » comme un périmètre
fermé, j'ai câblé dans `verifier-table.js` un refus de **toute** ligne chinoise — 40 lignes justes, 5 675
fiches. Retiré dans l'heure par la seule mesure qui décidait : *combien cette règle refuserait-elle de choses
qui marchent ?* **Un périmètre se vérifie sur ce qui marche déjà, exactement comme une clé (§22) et comme un
contrôle transversal (§32 bis) — et une consigne de périmètre vieillit plus vite qu'une leçon de méthode.**
⚠️ Un paragraphe daté qui décrit un état du monde doit dire, en tête, si cet état a changé depuis.

**Bulbapedia le couvre, mais pas là où notre jointure regarde.** Les expansions en chinois simplifié ont
des pages d'expansion suffixées **« (ATCG) »** (au moins 12 pour Scarlet & Violet : Miracle Journey, Arcane
Truth…) ; les pages de CARTES, elles, ne mentionnent le chinois que **3 fois sur 607** pages modernes.
Notre collecte énumère par la Setlist d'une page de set puis joint par l'impression déclarée sur la page
de carte : un tirage chinois absent des pages de cartes est **invisible** à cette jointure. Il faudrait
passer par les listes des pages « (ATCG) » — une autre énumération, un autre chantier. Non collecté.

🔴 **LE FAIT QUI COMPTE AUJOURD'HUI : 20 des 83 expansions chinoises de Cardmarket sont rangées « japonais »
par `codes_set.region`** (règle « code en minuscules » ; `CS1bC` Dynamax Clash Flame…), et d'autres ne
portent pas le motif `CS…C` (`151C` Collect 151, `CBB1C`–`CBB5C` Gem Pack, promos `/CS` `/CT`, `PKMTCH`).
**Une table qui les prendrait pour japonaises collecterait du faux.** Le générateur des lignes
automatiques les EXCLUT avant tout appariement (95 expansions d'une langue ni japonaise ni occidentale),
et aucune des 398 lignes générées n'en est.

⚠️ **Le même défaut existait en petit dans le parseur** : `{{ATCG|Gem Pack Vol. 1}} (Simplified Chinese)`
dans un champ `jpexpansion` devenait une impression `tirage: 'jp'` (3 pages sur 2 981). Corrigé AVANT la
collecte massive (`9f5353b`) : seul `{{TCG}}` est japonais, chaque autre gabarit rend son tirage
(`zh-hans`, `zh-hant`, `id`, `th`, `ko`).

## 29. Un échec externe se prouve par un TÉMOIN, pas par une supposition sur notre agent — 2026-09-14

**L'occurrence.** À partir de 18:43 UTC, Bulbapedia répond 503 à la génération de la table, puis à la
vérification du bloc 1 (18:58:07, et à son réessai une minute plus tard). Deux lectures étaient possibles :
notre agent refusé (User-Agent, cadence, adresse) ou le site en panne. La première menait à « corriger »
notre client — en-têtes, débit, réessais — pour un défaut qui n'existait pas. **Vérifié avec un autre client
que le nôtre : 503 aussi.** La panne était chez eux ; le bloc 1 a passé à 19:09:08 UTC sans que rien ne
change de notre côté.

🔑 **Un échec externe confirmé par un témoin vaut mieux qu'une supposition sur notre agent.** Avant de
toucher au client sur une erreur de la source, on la reproduit par un chemin qui ne partage RIEN avec le
nôtre — autre client, autre machine. ⚠️ Ce qui a été changé ce jour-là (`6c75a2a`, un réessai après 60 s)
ne répare pas une panne : il empêche une coupure d'une minute de tuer un lot, et il s'arrête au deuxième
échec. Une panne longue doit rester une panne, visible — pas une boucle de réessais qui frappe un serveur
déjà à terre.

## 20. Câbler sans chiffre : l'exception du 2026-09-12, et pourquoi elle doit le rester

Les deux gardes du pont ont été câblées **sans qu'aucune mesure du banc ne les justifie**. Le banc ne
porte que **8 lignes** dont la vérité est dans les dix expansions occidentales, dont 2 rendent un
candidat unique : la garde élargie y évite **0 faux affirmé**, et la garde étroite en produit **0**
aussi. La population est vide. C'est le §12 appliqué à nous-mêmes — mesurer la présence de la vérité
AVANT la qualité du signal — et ici la présence est nulle.

**Ce qui a décidé est l'EXPOSITION STRUCTURELLE, pas une mesure d'effet** : sur les 1 033 noms des dix
expansions, **73 seraient affirmés sans vérifier l'extérieur, et 17 ont un homonyme hors couverture**
qui pourrait être la vérité. Dix-sept restes potentiels qu'aucune ligne du banc n'a encore rencontrés.

🔑 **CE N'EST ACCEPTABLE QUE PARCE QUE LE COÛT EST NUL ET MESURÉ.** La garde par région lue coûte
**0 ligne ferme** (la garde large en coûtait 18, pour la même protection). Une garde gratuite qui
ferme un mode d'erreur connu se câble sans attendre de le rencontrer. ⚠️ **Une garde qui coûte
quelque chose, elle, attend son chiffre** — c'est la règle depuis le veto par le symbole (§8 de
sets-vintage-japonais) et elle ne bouge pas. L'exception est le coût nul, pas l'urgence.

## 22. Conclure d'un COMPTE au lieu d'un CONSTAT — deux fois dans la même journée, 2026-09-12

**Première fois.** Les sections « Additional Cards » des dix pages occidentales portent 280 entrées,
et 672 produits sont en reste : j'ai recommandé de les énumérer, en concluant du COMPTE qu'elles
apporteraient des cartes. Elles n'en apportent aucune — leurs entrées reconstruisent les MÊMES titres
que la section principale. Essai sur PBL : 95 titres → 95, 25 restes → 25.

**Deuxième fois, dans la foulée.** J'ai alors annoncé que les restes étaient une « divergence de
numérotation » récupérable par une clé par NOM, sur un exemple. Mesuré : sur 726 restes, **31 ont un
homonyme unique dans leur set** — le plafond réel est 4 %. **693 n'ont AUCUN homonyme** : la carte
n'est pas sur la page du set, ce n'est pas un problème de clé.

🔑 **LE CONTRÔLE QUI A TUÉ LA CLÉ, ET IL FAUT LE GARDER POUR TOUTE CLÉ FUTURE : que ferait-elle sur
ce qui MARCHE déjà ?** Sur les 2 814 jointures faites par le numéro, la clé par nom en rendrait 151
AMBIGUËS et en déplacerait jusqu'à 213. **31 gagnées contre 364 dérangées.** Une clé ne se juge pas
sur ce qu'elle rattrape, mais sur la somme de ce qu'elle rattrape et de ce qu'elle abîme.
⚠️ Une part des 213 vient de ma normalisation simplifiée (« Basic Fire Energy » contre « Fire
Energy »), pas de la clé : c'est une borne HAUTE. Les 151 ambiguës, elles, ne dépendent pas de ça.

**LA RÈGLE.** Un compte de lignes ne dit pas ce que les lignes contiennent. `95 = 95` ne signifie pas
« rien à récupérer », il signifie « je n'ai pas regardé ce que je comptais ». Avant de proposer une
piste tirée d'un total, **ouvrir trois de ses lignes**.

## 19. Une image appartient à un TIRAGE, pas à une carte — 2026-09-12

**LE PIÈGE DE `image=`, mesuré.** Sur une page Bulbapedia, `|image=` est le PREMIER tirage de la
carte, pas celui du set qu'on demande. Sur trois cartes d'Ascended Heroes tirées au hasard, l'une
rendait l'image de **Sword & Shield**. Pour un set occidental moderne, l'image se choisit dans
`reprintN` / `recaptionN` ou `TCGGallery`, **par nom de set**, jamais dans `image=`. Le texte n'a
pas ce défaut : la Setlist désigne le bon set, et c'est elle qui énumère.

🔴 **ET NOUS AVONS LA MÊME FAUTE, DANS NOTRE PROPRE SCHÉMA.** `cartes.image` est un champ UNIQUE par
carte, alors qu'une page Bulbapedia est une carte **tous tirages fusionnés** : **60 cartes de la base
appartiennent à deux sets ou plus, 29 portent déjà une image**. Charmeleon vit dans Expansion Pack
ET dans Pokémon Card web, et porte `artofpkm/6/15.webp` — le tirage d'Expansion Pack. Le jour où WEB
est collecté, la même carte affichera le mauvais visuel sur l'une des deux pages, et rien ne le
signalera. **L'image doit être clé par (carte, set), comme la jointure l'est déjà par (carte,
produit).** Non corrigé : nommé, chiffré, à faire avant que le catalogue public affiche quoi que ce
soit.

⚠️ **Le collecteur d'images actuel n'est PAS victime du piège de `image=`** : la page PKMJP est par
(set, rang), donc l'original qu'elle rend est bien le tirage de CE set. Il est en revanche la source
du second défaut, puisqu'il écrivait une image par CARTE.

✅ **CORRIGÉ le 2026-09-12** : `cartes.images` est une LISTE, une entrée par set
(`{set, source, cleR2, sha256, w, h, fmt, urlOriginal, preuve}`), et `image` est retiré. Rejoué
depuis la base par `collecteur-images.js --rejouer-jointure=tous` — **zéro téléchargement, zéro
requête, et aucun verrou** : le verrou global protège la bande passante d'un tiers, une jointure ne
sort pas de chez nous. 610 cartes portent leur liste, 0 l'ancien champ.

🔑 **LA LEÇON, ET ELLE EST DÉSAGRÉABLE : NOUS AVONS REPRODUIT CHEZ NOUS LA FAUTE QUE NOUS VENIONS DE
NOMMER CHEZ LA SOURCE.** Le piège de `image=` a été écrit, compris, expliqué — et notre propre schéma
faisait exactement la même chose depuis le premier jour, sans que personne le voie. **Un défaut
compris n'est pas un défaut évité.** Quand on nomme un défaut chez un tiers, le geste suivant est de
chercher la même forme chez soi, tout de suite, avant de passer à la suite.

## 18. Trois qui poussent dans le même dépôt, sans coordination — 2026-09-12

Le testeur et deux agents poussent sur `main`. Le 2026-09-12, trois commits sont apparus sur
`origin/main` entre deux de mes lectures (`46dbfa4` 18:22, `ccfd688` 18:30, `57d9dba` 18:47) ;
demander QUI avait poussé était le bon réflexe, et la réponse a évité d'en tirer une fausse alarme.
**Ce qui protégerait d'un push qui écrase un travail en cours : `git pull --rebase` avant tout push,
et jamais de `--force`** — `git push` refuse déjà un non-fast-forward, donc le seul vrai danger est
celui qu'on ajoute soi-même en le forçant. Et `git log origin/main..main` avant de pousser, pour
savoir ce qu'on emporte.

## 17. Un verrou par unité de travail ne protège pas un tiers — 2026-09-12

**L'occurrence, 16:34 → 16:41.** Deux collecteurs d'images ont tourné en même temps : le local
(pid 35556, `DESKTOP-5LDV9CG`, set G1) et le worker Render (pid 52,
`srv-dainu3bm8hqs73dklpi0`, set G2), chacun tenant sagement sa cadence de 5 s. **artofpkm.com a
donc reçu deux requêtes toutes les 5 secondes, sur 58 requêtes.** La file d'attente partagée a
fonctionné exactement comme écrit — elle donne un set à chaque demandeur — et c'est elle qui a
rendu la faute possible.

🔑 **LA RÈGLE, ET ELLE VAUT AU-DELÀ DE CE CAS : UNE LIMITE DE DÉBIT PROMISE À UNE SOURCE EXTERNE SE
COMPTE CHEZ ELLE, JAMAIS CHEZ NOUS.** Notre cadence de 5 s était parfaite dans chaque processus, et
fausse chez le destinataire, qui est le seul endroit où elle veut dire quelque chose. **Un verrou par
unité de travail protège NOS DONNÉES ; seul un verrou global protège une PROMESSE.** Il fallait les
deux, il n'y en avait qu'un. `collecte_images_etat` portait un verrou PAR SET, donc deux collecteurs
sur deux sets différents ne se voyaient pas.

⚠️ **C'est la famille de « la donnée produite puis jetée » : une garantie MESURÉE DU MAUVAIS CÔTÉ.**
Le chiffre qu'on surveillait (5 s entre deux de MES requêtes) n'était pas le chiffre promis (5 s
entre deux requêtes REÇUES). Avant d'écrire un compteur ou un verrou pour tenir un engagement, dire
**où** l'engagement se mesure — et s'il se mesure chez un tiers, tout ce qui est local est un proxy.

**La correction** : `artofpkm/__collecteur__`, un verrou GLOBAL pris avant toute collecte ; un second
collecteur nomme celui qui tient. Et un set interrompu retourne en `attente`, jamais en `refuse` —
il était sinon sorti de la file pour toujours.

🔴 **ET LE VERROU EST DEVENU LA PANNE DANS L'HEURE QUI A SUIVI.** Écrit avec une expiration de dix
minutes (celle des verrous de set) et un `process.exit(1)` quand il est tenu, il a mis le worker
Render en boucle de redémarrage au redéploiement suivant : l'ancien pod tenait encore le verrou, le
nouveau mourait, Render le relançait, et ainsi de suite. **Un processus tué ne libère rien, et sur
Render un pod est remplacé sans préavis — c'est le cas NORMAL, pas l'exception.**

🔑 **TROIS PROPRIÉTÉS, ET IL EN MANQUAIT DEUX. Un verrou qui protège une promesse envers un tiers
doit : (1) BATTRE — un détenteur vivant le rafraîchit ; (2) EXPIRER sur le rythme de ce battement,
pas sur une durée empruntée à un autre verrou (trois battements manqués, 3 min, pas 10) ; (3) FAIRE
ATTENDRE son concurrent, jamais le tuer.** Sans (2) et (3), la garantie devient l'incident : on n'a
pas protégé la source, on s'est bloqué soi-même. `--verrou` dit qui tient, `--liberer-verrou` est la
sortie de secours et REFUSE tant que le battement est frais.

🔑 **EN UNE LIGNE, POUR LA PROCHAINE FOIS : un chevauchement de rollout est le cas NORMAL, et un
`process.exit(1)` en fait une boucle. Une attente vaut mieux qu'une mort.** Le remplaçant qui meurt
parce que son prédécesseur n'est pas encore mort est un incident que le déploiement fabrique tout
seul, à chaque fois, indéfiniment.

⚠️ **Corollaire pour l'exploitation** : un verrou tenu par un pod qu'on ne reconnaît plus n'est pas
une anomalie à forcer — c'est peut-être son successeur qui travaille. On lit le BATTEMENT avant de
conclure. Le 2026-09-12, le « pod fantôme » qui bloquait tout était en fait un pod vivant qui
collectait depuis 20 secondes : le libérer aurait refait la faute du matin.

⚠️ **ELLE EST INERTE TANT QUE LE WORKER RENDER N'EST PAS REDÉPLOYÉ** : il tourne sur `46dbfa4`, qui
ne connaît pas ce verrou. Un correctif qui vit dans le dépôt et pas dans le processus ne protège
rien — c'est la même famille que le signal calculé et jamais branché (§0 de sets-vintage-japonais).

---

## 24. PKMJP n'est pas plus complet que Bulbapedia — 9 cartes sur 1 865 — 2026-09-12

**La question posée était bonne** : deux restes de PCG9 sont `Mew ☆` et `Charizard ☆`, des Gold Star.
Si la source d'images listait des cartes que Bulbapedia n'a pas, elle deviendrait une source de
**TEXTE**, et peut-être la réponse aux 693 restes occidentaux. **Les deux documents ont été
ouverts** : les deux cartes sont **absentes de `cartes`** pour ce set, et **aucune carte portant `☆`
n'existe dans TOUTE la base**. Ce n'est donc pas une jointure à réparer ni un caractère à normaliser
— c'est le trou de texte déjà connu.

🔴 **LE PREMIER COMPTE ÉTAIT FAUX, ET IL FAUT LIRE POURQUOI AVANT LE BON.** J'ai annoncé
« 52 sans carte, dont 41 jointures ratées, dont 20 Expansion Sheet ». **La file d'images tournait
pendant la mesure** : elle joignait au fur et à mesure. Trois lectures successives ont donné 44, 52
puis 24 orphelines, sur 1 857, 1 865 puis 1 946 entrées. **Expansion Sheet est à ZÉRO** — le set ne
concentrait rien, j'avais photographié un travail en cours. ⚠️ **Un dénominateur qui BOUGE pendant
qu'on le lit n'est pas un dénominateur, c'est un instantané.** Avant de conclure d'un compte, dire
si ce qui le produit est à l'arrêt — c'est le §22 (compte contre constat) avec une cause de plus.

**LE COMPTE, MESURÉ FILE À L'ARRÊT** — 1 946 entrées source, **18 sans carte (0,9 %)**, chaque cas
ouvert :

| cause | n | mécanique ? |
|---|---|---|
| **homonymes du set, source sans numéro, même rareté** (Gym) | 6 | non — rien ne les sépare |
| **deux cartes portent le MÊME numéro sur la page du set** (EC1 n°059 : Energy Restore et Pokémon Reversal) | 1 | non — conflit dans la source |
| **nom divergent sans désambiguïsateur** (« Unown » sans lettre, « Blastoise » hors du deck collecté) | 2 | non |
| **aucune page Bulbapedia** | **9** | 🕳️ jamais |

✅ **CE QUI ÉTAIT MÉCANIQUE A ÉTÉ CORRIGÉ : le départage par la RARETÉ, 24 → 18.** Les sets Gym
japonais fusionnent Gym Heroes et Gym Challenge sur une page : deux cartes y portent le même nom, le
même illustrateur (Ken Sugimori partout) et **aucun numéro**. La rareté est le seul champ qui
diffère, et la source la porte **14 fois sur 14** (« Uncommon (Old Back) » — la parenthèse est une
mention de dos, normalisée comme les apostrophes). Il ne s'exécute que sur des EX AEQUO, donc il ne
peut déplacer aucune jointure qui marche : **+6 gagnées, 0 dérangée**, le coût nul du §20. Sa preuve
nomme son périmètre : « seul ex aequo à porter cette rareté ».

## LES 9 IRRÉDUCTIBLES — limite définitive, nommée

**Ces neuf cartes n'auront ni texte ni image, jamais**, tant que Bulbapedia ne crée pas leur page :

| carte | set |
|---|---|
| **Kyogre ☆**, **Groudon ☆**, **Metagross ☆** | PCG6 Holon Research Tower |
| **Mew ☆**, **Charizard ☆** | PCG9 Offense and Defense of the Furthest Ends |
| **Pi** | Jungle |
| **Pi** | Southern Islands |
| **Team Rocket's Hitmonchan** | G1 Leaders' Stadium |
| **Blaine's Quiz #3** | G2 Challenge from the Darkness |

Les cinq Gold Star et les quatre autres ont une image chez PKMJP et **aucune page** chez Bulbapedia.
Sans page, pas de `carteId` : l'image ne s'attache à rien et le site ne l'affichera jamais.
🔴 **Une image orpheline ne comble pas un trou de texte, elle le DOUBLE.**

**DÉCISION SUR LES 18 OBJETS R2 : GARDÉS, et le motif est porté par la ligne**
(`marquer-orphelines.js` écrit `orpheline`, `orphelineMotif` = `irreductible` ou `ambigue`,
`decision: 'garder'`). Les deux coûts, comparés : garder, c'est ~0,6 Mo sur un bucket qui en prévoit
6 600 ; effacer, c'est devoir les **redemander à artofpkm.com** le jour où une clé arrive — une
requête de plus chez un tiers à qui on promet 1 requête / 5 s, pour un octet qu'on avait déjà.
⚠️ **Le marqueur se RETIRE quand l'image finit par joindre** : un marqueur qu'on ne nettoie pas
vieillit en mensonge.

## PKMJP COMME SOURCE DE TEXTE : FERMÉE, NE PAS LA REPROPOSER

🔑 **PKMJP apporte 9 cartes sur 1 946 — 0,5 % — que Bulbapedia n'a pas.** Ce n'est pas une source de
texte alternative, et ce n'est **pas** la réponse aux 693 restes occidentaux : ceux-là sont des
produits Cardmarket sans carte, une autre population, et PKMJP ne couvre pas l'occidental. La
question se rouvrira seulement si quelqu'un mesure un taux différent sur une population différente
— pas sur une intuition de complétude.

✅ **EXS N'A PAS LE DÉFAUT CRAINT.** L'`idExpansion` unique (3781) pour trois séries Bulbapedia :
Cardmarket **n'a qu'une seule expansion**, un seul `slugSet` (`Expansion-Sheet`), 125 produits, tous
sans numéro. **125 produits, 126 lignes de jointure, 125 produits distincts attachés, 0 attaché à
rien.** Les 125 cartes portent les impressions des trois séries (36 + 36 + 52). La fusion est du côté
de Cardmarket, pas du nôtre : il n'existe pas deux séries de produits orphelines.

🔑 **ET LE DÉNOMINATEUR DOIT ÊTRE CONFRONTÉ À SA PROMESSE, PAS SEULEMENT IMPRIMÉ.** `--reparser`
annonçait « 0 requête Bulbapedia » et en faisait 3 (102 pages refetchées sur EXP) : les titres
ajoutés par la table sont des alias qui redirigent vers des pages déjà archivées, donc absents de
`pages`, donc « à faire ». **Le compteur était juste et personne ne le lisait en face de la phrase
imprimée deux lignes plus haut.** Un compteur qui n'est comparé à rien ne vaut pas mieux qu'un
compteur absent.

---

## 25. UN COMPTE PRIS PENDANT QU'UN PROCESSUS ÉCRIT NE MESURE RIEN — 2026-09-12

**C'est la sixième fois en un jour qu'un chiffre trompe, et la PREMIÈRE où ce n'est ni le champ, ni
le dénominateur, ni la population : c'est le MOMENT DE LA LECTURE.**

**L'occurrence.** Trois lectures du même compte, à quelques minutes d'intervalle, pendant que la file
d'images joignait :

| lecture | entrées source | orphelines |
|---|---|---|
| 1 | 1 857 | 44 |
| 2 | 1 865 | **52** |
| 3 (file arrêtée) | 1 946 | **24**, puis 18 après correction |

J'ai rendu la deuxième comme un fait, avec une répartition détaillée — « 41 jointures ratées, dont
**20 Expansion Sheet** ». **Expansion Sheet était à zéro.** Le testeur a construit une demande entière
sur ces 41, et sur l'hypothèse que la fusion des trois séries d'EXS en était la cause. Rien de tout
cela n'existait : je photographiais un travail en cours et je l'ai décrit comme un état.

🔑 **CE QUI REND CETTE ERREUR PARTICULIÈRE : TOUS LES GARDE-FOUS ÉTAIENT RESPECTÉS.** Le dénominateur
était imprimé. La population était nommée. Chaque cas avait été ouvert (§22). Le chiffre était exact
**à l'instant où il a été lu** — et faux dès la seconde suivante. Un dénominateur imprimé ne protège
de rien si ce qui le produit bouge encore.

**LA RÈGLE, MÉCANIQUE.** Avant toute mesure sur `cartes`, `cartes_produits` ou `images` :
`node file-a-l-arret.js` — il rend 0 si la file est à l'arrêt, 1 sinon, et il regarde **trois**
signaux, parce qu'un seul mentirait : les unités `en-cours`, le verrou global, et l'âge de la
dernière écriture. **Et le rapport DIT que la vérification a été faite** — « file à l'arrêt, verrou
libre, aucune écriture depuis 25 min » est une phrase du rapport, pas une précaution privée. Une
mesure dont on ne sait pas si la source bougeait n'est pas comparable à la suivante.

⚠️ **ET L'OUTIL LUI-MÊME A FAILLI NAÎTRE FAUX.** Écrit avec les états terminaux en liste
(`$nin: [attente, fini, refuse]`), il a crié sur 26 unités `fait` — un état terminal que la liste
ignorait. **On énumère l'état ACTIF, jamais les états terminaux** : la liste des façons de finir
s'allonge avec le temps, celle des façons de travailler non. Un contrôle qui crie sur un cas normal
est contourné le jour où il a raison (§21).

🔑 **ET C'EST LA MÊME FAMILLE QUE LES SETS MARQUÉS « REFUSÉ » ALORS QU'ILS ÉTAIENT INTERROMPUS**
(§21, défaut n°3) : dans les deux cas, un état réel tombe dans une catégorie qui ne le décrit pas,
parce que l'énumération a été écrite depuis les cas qu'on avait en tête ce jour-là. **Une
énumération d'états vieillit mal par construction** — on y ajoute des états, on ne revient jamais
mettre à jour les listes qui les excluent. Énumérer le petit ensemble stable (ce qui TRAVAILLE) au
lieu du grand ensemble ouvert (ce qui a FINI) n'est pas une préférence de style, c'est la seule
forme qui survit à l'ajout d'un état.

---

## 27. DETTE NOMMÉE : la date de sortie manque sur 11 sets de 38 — 2026-09-12

**Aucune source disponible ne la porte.** Cardmarket ne donne pas de date d'expansion, et l'infobox
Bulbapedia de ces onze pages n'en porte pas non plus (vérifié sur les documents, pas supposé).

| région | sets |
|---|---|
| japonais | **SI-JP**, **VS**, **WEB**, **IPB**, **MCDP**, **EXS** |
| occidental | **PBL**, **ASC**, **xASC**, **JTG**, **CRI** |

**La résolution est onze lignes à la main**, et le testeur a décidé le 2026-09-12 que ce n'est **pas
maintenant**. En attendant, le catalogue affiche le set **sans date**, jamais « date inconnue » :
une mention d'absence occupe la place d'une information et n'en apporte aucune.

⚠️ **Onze, pas dix.** Le premier compte n'avait retenu que les sets sans `nomJa` ET sans date, ce
qui masquait VS et WEB — ils ont un nom japonais et pas de date. **Un filtre à deux conditions
répond à une autre question que celle qu'on pose** : « combien n'ont pas de date » n'est pas
« combien n'ont ni nom ni date ».

---

## 26. Le nom d'une expansion japonaise pour un lecteur francophone — 2026-09-12

**Le problème.** `/fr/sets` affichait les kana. `sets.nomEn` est écarté à juste titre : c'est le set
international **homologue**, un autre produit — « Base Set » n'est pas le nom d'*Expansion Pack*.

✅ **LA SOURCE EXISTE ET ELLE EST CHEZ NOUS : `numeros_cartes.slugSet`**, le nom que **Cardmarket**
donne à l'expansion japonaise. En anglais, et il désigne **cette** expansion : « Rocket Gang »,
« Gold Silver to a New World », « Cry from the Mysterious », « Offense and Defense of the Furthest
Ends ». **38 expansions sur 38 en portent un.** Rapatrié dans `sets.nomCardmarket` +
`sets.nomAffichage` + `sets.nomAffichageSource` par `rapatrier-noms-sets.js` — même geste que
`slug`/`slugSet`, pour que le site n'ouvre pas une seconde connexion vers la production.

**L'ordre de préférence dépend de la RÉGION, et ce n'est pas un détail** : sur un set japonais
`nomEn` est le jumeau occidental, donc **exclu** ; sur un set occidental il désigne le set lui-même,
donc **préféré**. Résultat : 28 noms Cardmarket, 8 `nomEn`, 2 départages. Aucun set ne retombe sur
son code.

🔴 **ET LE CONTRÔLE QUI A SERVI : DEUX SETS NE PEUVENT PAS PORTER LE MÊME NOM À L'ÉCRAN.** `ASC` et
`xASC` ont le même `nomEn` (« Ascended Heroes ») ; la liste en aurait affiché deux identiques, et
rien ne les aurait distingués. Cardmarket les sépare (« Ascended Heroes Additionals »). **Un nom
d'affichage doit être LISIBLE et DISCRIMINANT** — un nom qui ne désigne plus qu'un ensemble est le
motif du « reste » (§8), transposé à l'interface. 38 noms distincts sur 38.

⚠️ **LA PONCTUATION EST PERDUE ET NE SE DEVINE PAS.** « Gold-Silver-to-a-New-World » rend « Gold
Silver to a New World » ; le « & » et la virgule du nom Cardmarket réel ne sont pas dans le slug. On
rend le slug lisible, **on ne reconstruit pas une ponctuation qu'on n'a pas** — ce serait deviner.

🕳️ **CE QUI RESTE MANQUANT : LA DATE, sur 11 sets de 38** — SI-JP, VS, WEB, IPB, MCDP, EXS (japonais)
et PBL, ASC, xASC, JTG, CRI (occidentaux). Le nom est réglé, la date ne l'est pas : elle n'est ni
chez Cardmarket, ni dans l'infobox de ces pages. Il faudra une autre source ou onze lignes à la
main. **Non corrigé, nommé.**

### 🔴 LE PIÈGE DE `nomEn` A ÉTÉ TENDU TROIS FOIS EN DEUX JOURS, ET J'Y SUIS TOMBÉ DEUX FOIS — 2026-09-20

**Le même défaut, sur trois objets différents, à quelques heures d'intervalle** : un set japonais et son
homologue occidental partagent UNE page Bulbapedia, dont l'infobox porte le nom OCCIDENTAL.

| objet | ce que `nomEn` aurait donné | attrapé par |
|---|---|---|
| le **nom d'affichage** (§26) | « Base Set » pour *Expansion Pack* | la règle, écrite d'avance |
| le **logo** | **125 sets japonais sur 192** pointant le fichier du jumeau | la règle de langue, écrite d'avance |
| le **symbole** | **125 sets japonais retenus**, `Rocket Gang → SetSymbolTeam Rocket.png` | 🔴 **rien — le chiffre seul** |

🔴 **LA TROISIÈME FOIS, LA RÈGLE ÉTAIT ÉCRITE, COMPRISE, ET APPLIQUÉE TROIS HEURES PLUS TÔT AUX LOGOS —
et je l'ai quand même reproduite sur les symboles, dans un fichier qui la CITE en commentaire.** Ce qui
l'a arrêtée n'est pas la relecture : c'est **125 japonais retenus alors que les logos n'en avaient donné
que 53**. Un chiffre impossible, comparé à un chiffre connu.

⚠️ **ET LA DEUXIÈME VERSION ÉTAIT ENCORE FAUSSE.** `nomEn` retiré, il restait 25 japonais — dont **sept
passaient par le jumeau autrement** : `nomJa` et `nomJaTraduit` portent parfois le nom occidental
(« Pokémon Card 151 » a `nomJa` = « 151 », « Collection X » a `nomJa` = « XY »). **Retirer le champ
coupable ne suffit pas quand la valeur coupable vit aussi ailleurs.**

🔑 **LA RÈGLE QUI TIENT EST NÉGATIVE AUTANT QUE POSITIVE, et c'est la forme à reprendre partout : le nom
retenu doit être un nom de CE set ET ne pas être aussi celui du jumeau.** « Un nom qui désigne les deux
n'en désigne aucun » — c'est la garde par le nom de `jointure.js`, transposée aux métadonnées de set.
Résultat : **153 symboles retenus, 143 occidentaux et 10 japonais**, tous des pages de promos qui
portent leur propre nom.

🔑 **ET LA PARADE GÉNÉRALE N'EST PAS « FAIRE ATTENTION » : c'est d'avoir un chiffre COMPARABLE sous la
main.** Les logos avaient donné 53 japonais ; c'est ce 53 qui a condamné le 125. Un contrôle transversal
se vérifie contre un cas normal connu (§32 bis) — une MESURE se vérifie contre une mesure voisine déjà
faite. Quand il n'y en a pas, il faut en fabriquer une avant d'écrire.

### ✅ LA CINQUIÈME OCCURRENCE, ET LA PREMIÈRE OÙ LA RÈGLE EST STRUCTURELLE — LE NOM FRANÇAIS — 2026-09-21

**Le `{{Langtable|fr=}}` de Bulbapedia donne le nom français du set. 261 pages sur 463 en portent un, et
127 d'entre elles sont des sets JAPONAIS** : « Expansion Pack » → « Set de Base », « Rocket Gang » →
« Team Rocket », « Cry from the Mysterious » → « Éveil des Légendes ». Le piège est le même que pour
`nomEn`, `nomJa`, `dateSortieJa` et les logos — une page fusionnée, un nom occidental.

🔑 **MAIS CETTE FOIS LE REFUS NE SE FONDE PAS SUR UNE PRUDENCE, IL SE DÉMONTRE : un set japonais n'a
jamais eu de sortie française, donc il n'a pas de nom français.** Tout `fr` lu sur sa page est celui du
jumeau, par construction, sans exception possible. **C'est la forme la plus solide qu'une garde puisse
prendre** — non pas « ça se trompe souvent », mais « ça ne peut pas être autre chose ». Quand une garde
peut se formuler ainsi, elle n'a plus besoin de seuil ni d'échantillon.

⚠️ **ET LA SOURCE RETENUE N'EST PAS CELLE QUI ÉTAIT GRATUITE.** L'archive Bulbapedia coûte zéro requête
et porte la donnée ; elle est écartée quand même, parce que `rapatrier-noms-fr.js` porte depuis le
premier jour la règle qui tranche : **« les traductions de Bulbapedia sont sous licence NON COMMERCIALE
et n'ont rien à faire ici »**. Elle avait été écrite pour le nom d'une carte ; elle vaut pour celui d'un
set. ⚠️ Cardmarket ne pouvait pas servir de repli : **les 12 collections de la production ont été
énumérées champ par champ** — `numeros_cartes.nomFr` est le nom de la CARTE, `slugSet` est en anglais,
`codes_set` ne porte que code et région. **Aucun nom français d'expansion en base.** C'est TCGdex qui
sert, licence ouverte, déjà utilisé par le dépôt — et il couvre PLUS que Bulbapedia (135 contre 116).
🔑 **Une contrainte de licence se traite comme une contrainte de mesure : on cherche la TROISIÈME source,
on ne discute pas la règle.**

⚠️ **LES DEUX SOURCES ONT ÉTÉ CONFRONTÉES AVANT QUE L'UNE SOIT CRUE (§16), et c'est ce qui a fait les
trois refus les plus utiles.** Sur les 109 sets que TCGdex et Bulbapedia couvrent tous les deux :
**106 d'accord (97,2 %)**, 3 en désaccord — `EX` (« Expedition » / « Expedition Édition de Base »),
`GE` (« Duels au Sommets » / « Duels au Sommet »), `TM` (« Triomphant » / « Triomphe »). **Ces trois ne
reçoivent rien** : c'est la règle 2 de `rapatrier-noms-fr.js`, « si les sources divergent, on écrit null,
jamais l'une des deux ». Une divergence est le seul signe qu'on a que quelque chose ne va pas.

🔴 **ET LE CONTRÔLE DE DISCRIMINANCE A ATTRAPÉ TROIS APPARIEMENTS FAUX QUE LA RÉGION NE VOYAIT PAS.**
`SV11s` s'appelle chez nous « Black White **IDTH** » et porte `nomEn` = « Black & White » ; `MA1` est
« Mega Evolution IDTH » ; `HSP` est « Beginning Set Pikachu » avec `bulba.expansion` = « HGSS Black Star
Promos ». Tous trois sont `region: 'intl'`, donc la garde de région les laissait passer — et tous trois
s'appariaient par un nom **EMPRUNTÉ à un autre set**. Ce qui les a vus : « ce nom français désigne-t-il
plusieurs de nos sets ? ». **Le piège du jumeau ne se limite pas au couple jp/occidental : une réimpression
régionale (Indonésie, Thaïlande) porte elle aussi le nom anglais de l'original.** La parade est la même
qu'au §26 : la clé se bâtit sur `nomAffichage`, le seul nom qu'on ait établi comme unique par set.

🔴 **ET LE REPLI A ÉTÉ ÉCRIT D'ABORD EN ANNULATION MUTUELLE — C'ÉTAIT LE §33, DEUX JOURS APRÈS.** Les
extras Cardmarket « Additionals » (`xPBL`, `xJTG`, `xCRI`…) n'ont pas de `nomAffichage` ; en repliant sur
`nomEn` ils réclamaient le nom de leur primaire, et le contrôle de discriminance **abattait les deux** —
`PBL` perdu à cause de `xPBL`. Bilan de cette version : 6 sets gagnés, **8 justes perdus**. Un extra qui
ne peut rien afficher ne doit pas réserver le nom du set qui le peut. **La priorité remplace
l'annihilation** : la passe 1 possède le nom, la passe 2 ne prend que ce qui reste libre. 135 retenus,
**0 collision sur les deux contrôles**.

---

**L'EXIGENCE POUR TOUTE CLÉ FUTURE.** Une clé qui départage doit **nommer son périmètre dans
la raison journalisée**. `departagerParSymbole` et `departagerParAttaque` le font déjà — leur
`raison` dit « est le SEUL EX AEQUO à la porter », pas « est le seul ». `departagerParNumero`
aussi (« l'expansion X » / « tout le catalogue »). C'est ce qui permet, six mois plus tard,
de relire une désignation sans la confondre avec une unicité. Une clé dont la raison ne dit
pas dans quel ensemble elle a cherché fabriquera des restes qu'on lira comme des choix.
