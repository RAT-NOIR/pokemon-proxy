# PikaQian passif — mode d'emploi (préparé le 2026-10-12, jamais lancé)

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

En conséquence, ce lot ne télécharge aucune image et n'est branché sur aucun worker (aucun de ses fichiers n'est dans `REGLES` de `remettre-en-file.js`). Les adresses capturées et la mesure sont disponibles ; ce qu'on en fait est à décider, avec ces deux faits.
