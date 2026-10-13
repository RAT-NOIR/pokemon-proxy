# PikaQian passif — mode d'emploi (préparé le 2026-10-12, jamais lancé)

## ➕ 2026-10-13 (lot PQ-SANSNUM) — la garde des ancres compte à part les cartes SANS NUMÉRO
**Décision du testeur (2026-10-13 ~19:10 UTC), mot pour mot :** « Oui pour la garde des ancres, à cette condition stricte : la page reste complète si tuiles = ancres AVEC numéro, à l'unité près. Les ancres sans numéro sont listées une par une dans le diagnostic (nom, lien), comptées dans le panneau, et jamais importées : un doute est un trou. Aucun autre assouplissement. Test rouge puis vert sur une copie anonymisée de sv-p. »
- **Le fait** : `promo-sv-p`, 758 ancres, 701 tuiles, refus `GARDE:ancres` ; les 57 ancres en trop ont une image du dossier `promo-sv-p/`, un nom, le code des tuiles (`sv-p`) et aucun numéro (« 758 of 758 cards »).
- **La règle (une fonction, trois lecteurs)** : `jugerCompletude` (`collecte-cartes/pikaqian.js`) — la page est complète si et seulement si `tuiles = ancres − ancres sans numéro`, à l'unité près. Lue par le récepteur (`GARDE:ancres`), l'import (`importer-pikaqian-passif.js`, état `page-partielle`) et la mesure passive (`plan-pikaqian-appris.js`). Le motif d'un refus dit les trois nombres : « N ancres, M tuiles, K sans numéro ».
- **Définition fermée d'une ancre sans numéro** (`ancresSansNumero`) : une ancre `/cards/<uuid>` qui n'est pas une tuile ET qui a exactement un `<h2>` non vide, exactement une `<img>` dont la `src` est `https://images.pikaqian.com/<code de la page>/<son uuid>.webp`, exactement un `<p>` dont le texte est le code des tuiles (le code de la page, ou `codeDesTuilesPromo` pour une page promo) sans « · numéro ». Toute autre ancre sans tuile compte comme une ancre AVEC numéro manquante : la page est refusée comme avant.
- **Écrit** : la fiche apprise et le fichier de page portent `sansNumero: [{ nom, lien }]` (toutes, nom tronqué à 60 caractères) ; le diagnostic d'un refus les liste aussi (`diagnostic.sansNumero`) ; une fiche ou un fichier ANCIEN sans `sansNumero` se rejuge comme avant (absent = 0). **Jamais importées** : ce ne sont pas des tuiles, `/images` refuse leur uuid (« tuile inconnue de la page apprise »), l'import ne les voit pas.
- **Panneau** : la réponse 200 porte `sansNumero: N`, le userscript affiche « N cartes sans numéro sur la page : jamais importées » ; il ne lit ni n'envoie plus l'image d'une carte du DOM sans numéro.
- **À faire** : **relancer le récepteur**, **réinstaller le userscript** (Tampermonkey), recliquer sur `promo-sv-p`. Bancs : `test-pikaqian-sansnumero.js` ; `rouge-recepteur-pikaqian.js` (mutants de la nouvelle garde).

## ➕ 2026-10-13 (lot US23) — userscript 2.3 : lecture par paquets en parallèle, arrêt partagé
Le userscript du dépôt est la **2.3** écrite par le testeur (panneau au style Cardmarket) ; le mode d'emploi ne change pas : **relancer le récepteur** (inchangé, aucune garde nouvelle), **réinstaller** le script dans Tampermonkey, **un clic par page**.
- **Cadence** : les images prêtes se lisent par paquets de `CONCURRENCE = 8` en parallèle ; une pause de `PAUSE_MS = 150` ms sépare deux paquets quand le précédent a émis au moins une requête (aucune après le dernier paquet, aucune quand tout se lit au canvas). Au plus **2 requêtes par image** (cache puis navigateur, jamais les deux en même temps pour une même image), seulement vers `images.pikaqian.com`, URL finale vérifiée, redirections refusées. À aucun instant plus de 8 requêtes vers l'hôte des images ne sont en vol (mesuré par le banc).
- **Fait mesuré par le banc, à connaître** : quand le canvas est refusé et que le cache échoue (CORS), le **premier paquet émet jusqu'à 2 × 8 = 16 requêtes** — 8 caches, puis 8 navigateurs — avant que la voie cache soit abandonnée (après deux échecs de suite) ; les paquets suivants n'émettent plus que des navigateurs (au plus 8 en vol). Ce n'est pas un défaut corrigé : c'est le comportement de la 2.3.
- **Arrêt partagé `lecture.arret`** : posé au premier 403, 429 ou 5xx, à la troisième réponse 404 de suite, ou à une URL finale qui n'est pas celle de la tuile (la redirection est un arrêt partagé comme les autres : correctif du tour 1, une ligne dans `arretDe`). Ensuite **aucune requête nouvelle** ne part (ni navigateur pour les images du même paquet, ni paquet suivant) ; au plus 7 requêtes déjà en vol à cet instant ; les images du paquet déjà lues avec succès **sont envoyées au récepteur**, puis le panneau affiche l'arrêt. Dans la 2.3 telle que livrée par le testeur, la branche redirection ne posait pas `lecture.arret` (les autres images du paquet continuaient au navigateur) : corrigé au tour 1, le banc le prouve.
- **Durée** : mesurée par le testeur avec la 2.2 (4 en parallèle) sur csv9c : 620/620 images reçues, 0 refus, 0 illisible, ≈ 78 s. **La 2.3 (8 en parallèle, 150 ms entre paquets) n'est pas encore mesurée.** Le panneau donne une estimation avant le clic (`≈ N s de lecture`), sans l'avoir mesurée.
- **Diagnostic d'une page refusée** (lot PQ-PROMO) : conservé dans la 2.3, affiché sous le motif du refus.
- Bancs : `test-userscript-pikaqian.js` (monde fabriqué, aucune requête réelle), `rouge-userscript-pikaqian.js` (mutants).

## ➕ 2026-10-13 (lot PQ-PROMO) — les pages promo : le refus se mesure, puis la ligne se déclare
Le récepteur refusait promo-sv-p (« 0 tuiles sur 701 portent le code promo-sv-p ») : les tuiles d'une page promo portent d'autres codes que celui de l'adresse. Rien n'est deviné.
- **Relancer le récepteur** (inchangé) : `node recepteur-pikaqian.js` (options `--port`, `--dossier`, `--dossier-images`, et `--dossier-refusees` si besoin). Il faut le **relancer** : l'ancien processus ne connaît pas le diagnostic.
- **Au prochain clic sur promo-sv-p** : la page est refusée (HTTP 422) comme avant, mais le panneau du userscript (à réinstaller aussi, il affiche maintenant le diagnostic) et le journal du récepteur montrent « ce que la page portait » :
  les codes lus sur les tuiles (10 au plus), les dossiers des adresses d'images (10 au plus), le titre (`<h1>` et `<title>`), toute annonce « N cartes » lisible. Le même diagnostic est écrit dans
  `C:\Users\Yung\rat-market-travail\catalogue\pikaqian\refusees\promo-sv-p--<date>.json` (jamais écrasé, ni HTML ni tuile).
- **Ensuite**, le coordinateur lit ce fichier et écrit dans `collecte-cartes/pikaqian-sets.json`, pour la ligne concernée et à partir de la mesure : `mesure` (la preuve écrite), `codesTuiles`, `dossiersImages`, `titrePk`
  (le titre exact : le `<h1>`, à défaut le `<title>`), `tuiles` (le nombre relevé). Tout ou rien : une déclaration incomplète refuse la page. La page n'est alors acceptée que si le titre est exact, si la majorité
  stricte des tuiles porte un code déclaré (ou celui du set), si elle a au moins `tuiles` tuiles, et chaque image n'est reçue que dans un dossier déclaré, à l'adresse `images.pikaqian.com/<dossier>/<id>.webp`.
  Une ligne qui ne déclare rien se comporte exactement comme avant. Une seule fonction lit ces champs : `declarationsDeCode` (`collecte-cartes/pikaqian-sets.js`).

## ➕ 2026-10-13 (lot P2) — le worker ne touche plus PikaQian ; le script envoie les IMAGES que ton navigateur affiche
Décision du testeur : « PikaQian : A. Le script passif envoie l'image telle que mon navigateur l'affiche, avec la carte et le numéro ; le worker ne touche jamais le CDN. Mêmes preuves exigées
(numéro, nom, set) ; un doute est un trou. Arrête les tentatives automatiques depuis le worker : la source n'est plus interrogée que par mes visites. »
- **Worker** : PikaQian est PASSIVE (`collecte-cartes/source-passive.js`, retirée de `SOURCES_EN_SERVICE`) : aucune unité ne s'insère ni ne se reprend, une unité en file se clôt (`refuse-source-passive`,
  « source passive : visites du testeur seulement »), le réessai espacé et la sonde du CDN ne partent plus, le transport réel du client est fermé. Banc : `test-source-passive.js`.
- **Userscript 2.0** : au clic, la page part comme avant ; puis, pour chaque tuile dont l'image est DÉJÀ chargée (le script ne défile pas, ne force rien : les autres sont comptées et dites), il envoie à
  `POST /images` du récepteur, par lots de 10 au plus, le nom et le numéro que le DOM affiche et les octets. Trois voies, dans l'ordre : `canvas` (aucune requête, mais refuse les images d'une autre origine
  non CORS), `cache` (`fetch` en `force-cache` depuis la page : cache HTTP de la page s'il y a une entrée, sinon une requête de TON navigateur), `navigateur` (`GM_xmlhttpRequest`, anonyme, vers l'adresse de la tuile
  seulement : une requête de TON navigateur par image, pendant TA visite). Chaque image dit sa voie. `@connect` ajoute `images.pikaqian.com`.
- **Récepteur** : `--dossier-images=<chemin>` (défaut `C:\Users\Yung\rat-market-travail\catalogue\pikaqian-passif`, hors dépôt) ; une image par fichier `<codePk>\<idTuile>--<sha12>.<ext>`, jamais écrasée ; un fichier de page
  `page--<fiche>.json` par visite (tuiles, reçues avec empreinte et dimensions, refusées avec motif, tuiles sans image).
- **Import** : `importer-pikaqian-passif.js` (simulation par défaut, `--ecrire` sous `lot-additif.js`), voir son en-tête.

Décision du testeur : pas d'arrêt définitif de PikaQian ; un bouton « Apprendre cette page » sur les pages de set que **tu ouvres toi-même**, aucune navigation
automatique, aucun navigateur automatisé, aucun cookie réutilisé. Ce lot capture ce que la page ouverte porte et mesure ce que cela donnerait. Il ne télécharge rien.

## Les trois pièces
- `userscript-pikaqian.js` (Tampermonkey) : un bouton sur `https://pikaqian.com/sets/*`. Au clic seulement, envoie l'adresse de la page et son HTML à `http://127.0.0.1:<PORT>/apprendre`. `@connect 127.0.0.1` seulement.
- `recepteur-pikaqian.js` (node) : écoute `127.0.0.1` seulement, lit la page avec les fonctions de production (`lireTuiles`, `lireOrigines`, `verdictDePage`, `compterAncresCartes`), écrit un fichier par page apprise. Aucune base, aucune requête sortante.
- `plan-pikaqian-appris.js` (node, lecture seule) : pour chaque set appris, les trous de nos fiches, ceux que la page apparie, les restes par motif, et combien d'appariés ont une adresse officielle déclarée.

## Pas à pas
1. **Installer** le userscript : Tampermonkey, nouveau script, coller `userscript-pikaqian.js`. Le port est la constante `PORT` en tête du script (8765) : c'est la valeur de `--port` du récepteur ; si tu changes l'un, change l'autre (un test compare les deux valeurs par défaut).
2. **Lancer le récepteur** (dans le dépôt) :
   `node recepteur-pikaqian.js` — options : `--port=8765`, `--dossier=<chemin>`. Par défaut les fichiers vont dans
   `C:\Users\Yung\rat-market-travail\catalogue\pikaqian\apprises\` ; un dossier dans le dépôt est refusé. Un argument inconnu est refusé. Arrêt : Ctrl+C.
3. **Ouvrir** une page de set (ex. `https://pikaqian.com/sets/cs1bc`) toi-même, **cliquer** « Apprendre cette page ». Le panneau affiche la réponse (ancres, tuiles lues, tuiles au code du set, adresses officielles, état du flux) ou le motif du refus ; le récepteur imprime chaque page reçue.
4. **Mesurer** (lecture seule, utilisateur de lecture `MONGODB_CARTES_LECTURE_URI` dans `.env`) :
   `node plan-pikaqian-appris.js` — option `--dossier=<chemin>`.

## Le premier clic réel est le test de la forme hydratée
Aucun banc n'a vu une vraie page ouverte dans un navigateur (`outerHTML` après exécution de la page) : les bancs lisent du HTML écrit à la main. Le premier clic sur une
vraie page de set (cs1bc : 315 tuiles attendues) répond à trois questions, à lire dans le panneau et dans le journal du récepteur :
1. **Ancres = tuiles ?** Le récepteur compte les ancres `href="/cards/<uuid>"` et les tuiles lues. Si la page est virtualisée, paginée ou à images paresseuses, il refuse (422 « page partielle ou forme changée : N ancres, M tuiles ») et n'écrit rien. Un refus n'est pas une panne : c'est ce que le clic devait apprendre ; ne pas insister, le dire.
2. **Le flux de données est-il là ?** Réponse `flux présent` + `0 ou 1 adresse officielle` = le résultat normal mesuré (1 carte sur 315 déclare son adresse officielle). Réponse `FLUX DE DONNÉES ABSENT` = **anomalie** : aucun bloc de données Remix (`__reactRouterContext`, `streamController.enqueue`, `"loaderData"`) dans la page ; les adresses officielles ne peuvent alors pas être lues, et « 0 adresse officielle » ne veut plus rien dire. À signaler avant de croire le moindre chiffre de la mesure.
3. **Le récepteur accepte-t-il le clic ?** La garde ne dépend pas d'un en-tête `Origin` (Tampermonkey ne documente pas qu'il transmette celui qu'on pose). Un refus 403 se lit dans le panneau ; la raison s'imprime aussi côté récepteur.
Si la page est refusée comme « incomplète » (moins de tuiles que la mesure du 2026-10-10 : cs1bc 315, 151c 470), recharger la page entièrement avant de recliquer.

## Ce que la garde du récepteur autorise (et rien d'autre)
`POST /apprendre` ; `Host` = `127.0.0.1:<port>` ou `localhost:<port>` ; `Content-Type` JSON (obligatoire : une page web ne peut pas l'envoyer à un autre site sans prévol, et `OPTIONS` répond 405 sans en-tête CORS) ; en-tête fixe `X-Rat-Market` posé par le userscript ; `Origin` = `https://pikaqian.com`, **absente**, ou d'une extension (`chrome-extension://`, `moz-extension://`) — toute autre origine web et `null` sont refusées ; corps ≤ `PAGE_MAX_OCTETS` (8 Mo, compté sur le flux) ; un objet à deux clés, `url` et `html` ; `url` = `https://pikaqian.com/sets/<code>` au motif `CODE_PK` de `pikaqian.js` ; page acceptée par `verdictDePage` ; page complète (ancres = tuiles ; tuiles ≥ le nombre relevé pour le set quand `pikaqian-sets.json` le connaît). Le HTML n'est pas gardé (sha256 seulement). `rouge-recepteur-pikaqian.js` retire ces gardes une à une et exige que le banc échoue.

## Ce que la mesure rejoue du collecteur
Par les fonctions du collecteur : la ligne de table (`releve`), le tirage du set en base (`gardeTirage`), les produits joints (`gardeProduits`), puis `planifier`. Un set que le collecteur refuserait est imprimé « REFUSÉ PAR LE COLLECTEUR » et n'entre pas dans les totaux. Non rejoué, et dit dans la sortie : le seuil de taille (« jugé au téléchargement »), la taille de la base, l'alerte de blocage. « Apparié » s'imprime toujours suivi de « téléchargement non décidé ».

## Ce qui manque : le téléchargement
Deux faits mesurés bornent le lot, et la décision revient au testeur :
1. La page de set porte, par tuile, l'image `images.pikaqian.com/<code>/<uuid>.webp` (300 × 419), mais l'adresse **officielle** `cdn.pokemon-tcg.cn/cards/<32 hex>.png` n'y est embarquée que pour **une carte sur 315** (mesuré le 2026-10-11 sur cs1bc).
2. `cdn.pokemon-tcg.cn/robots.txt` répond **403** (serveur Tengine) au worker (sonde du 2026-10-12, 18 h 54 UTC) : nos règles s'arrêtent là pour ce CDN.

En conséquence, le lot d'origine (2026-10-12) ne téléchargeait aucune image. Depuis le 2026-10-13 les images viennent du navigateur du testeur (voir en tête) ; le worker n'est branché à rien de ce lot.
