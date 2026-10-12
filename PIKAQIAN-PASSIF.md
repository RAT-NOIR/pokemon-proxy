# PikaQian passif — mode d'emploi (préparé le 2026-10-12, jamais lancé)

Décision du testeur : pas d'arrêt définitif de PikaQian ; un bouton « Apprendre cette page » sur les pages de set que **tu ouvres toi-même**, aucune navigation
automatique, aucun navigateur automatisé, aucun cookie réutilisé. Ce lot capture ce que la page ouverte porte et mesure ce que cela donnerait. Il ne télécharge rien.

## Les trois pièces
- `userscript-pikaqian.js` (Tampermonkey) : un bouton sur `https://pikaqian.com/sets/*`. Au clic seulement, envoie l'adresse de la page et son HTML à `http://127.0.0.1:8765/apprendre`. `@connect 127.0.0.1` seulement.
- `recepteur-pikaqian.js` (node) : écoute `127.0.0.1` seulement, lit la page avec les fonctions de production (`lireTuiles`, `lireOrigines`, `verdictDePage`), écrit un fichier par page apprise. Aucune base, aucune requête sortante.
- `plan-pikaqian-appris.js` (node, lecture seule) : pour chaque set appris, les trous de nos fiches, ceux que la page apparie, les restes par motif, et combien d'appariés ont une adresse officielle déclarée.

## Pas à pas
1. **Installer** le userscript : Tampermonkey, nouveau script, coller `userscript-pikaqian.js`.
2. **Lancer le récepteur** (dans le dépôt) :
   `node recepteur-pikaqian.js` — options : `--port=8765`, `--dossier=<chemin>`. Par défaut les fichiers vont dans
   `C:\Users\Yung\rat-market-travail\catalogue\pikaqian\apprises\` ; un dossier dans le dépôt est refusé. Un argument inconnu est refusé. Arrêt : Ctrl+C.
3. **Ouvrir** une page de set (ex. `https://pikaqian.com/sets/cs1bc`) toi-même, **cliquer** « Apprendre cette page ». Le panneau affiche la réponse (tuiles lues, tuiles au code du set, adresses officielles trouvées) ou le motif du refus ; le récepteur imprime chaque page reçue.
4. **Mesurer** (lecture seule, utilisateur de lecture `MONGODB_CARTES_LECTURE_URI` dans `.env`) :
   `node plan-pikaqian-appris.js` — option `--dossier=<chemin>`.

## Ce que la garde du récepteur autorise (et rien d'autre)
`POST /apprendre` ; `Host` = `127.0.0.1:<port>` ou `localhost:<port>` ; `Origin` exactement `https://pikaqian.com` ; `Content-Type` JSON ; corps ≤ `PAGE_MAX_OCTETS` (8 Mo, compté sur le flux) ; un objet à deux clés, `url` et `html` ; `url` = `https://pikaqian.com/sets/<code>` au motif de code de `pikaqian.js` ; page acceptée par `verdictDePage`. Le HTML n'est pas gardé (sha256 seulement).

## Ce qui manque : le téléchargement
Deux faits mesurés bornent le lot, et la décision revient au testeur :
1. La page de set porte, par tuile, l'image `images.pikaqian.com/<code>/<uuid>.webp` (300 × 419), mais l'adresse **officielle** `cdn.pokemon-tcg.cn/cards/<32 hex>.png` n'y est embarquée que pour **une carte sur 315** (mesuré le 2026-10-11 sur cs1bc).
2. `cdn.pokemon-tcg.cn/robots.txt` répond **403** (serveur Tengine) au worker (sonde du 2026-10-12, 18 h 54 UTC) : nos règles s'arrêtent là pour ce CDN.

En conséquence, ce lot ne télécharge aucune image et n'est branché sur aucun worker (aucun de ses fichiers n'est dans `REGLES` de `remettre-en-file.js`). Les adresses capturées et la mesure sont disponibles ; ce qu'on en fait est à décider, avec ces deux faits.
