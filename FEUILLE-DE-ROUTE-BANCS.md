# Feuille de route des bancs — ce qui tourne, ce qui est arrêté, et ce qui reste à faire

Tenue depuis le 2026-10-08. Règle du testeur : **aucun banc n'écrit dans la production** — ni la grappe (`test`, `test_scratch`, `cartes`), ni R2.
Les bancs tournent sur une base EN MÉMOIRE (`collecte-cartes/base-banc.js`, mongodb-memory-server 11.3.0 installé dans `.banc-local/` depuis son
lockfile : `npm ci --prefix .banc-local`). La production ne charge aucun module de banc (`collecte-cartes/garde-banc.js`, inerte sans `BANC_ISOLE`).

## 0. L'installation de la base de banc, dans CHAQUE copie du dépôt
`npm ci --prefix .banc-local` (lockfile `.banc-local/package-lock.json`, mongodb-memory-server 11.3.0 épinglé, 49 paquets). npm 11 ne lance pas
son `postinstall`, qui ne sert qu'à télécharger mongod : le binaire (8.2.6) est pris dans le cache de l'utilisateur au premier démarrage.
**main est autonome depuis le 2026-10-08 (décision 9 du testeur)** : l'ancienne jonction vers le worktree `a-fuite-main` est retirée (`rmdir`,
cible intacte) et l'installation est dans main lui-même. **Prouvé avec le worktree `a-fuite-main` RENOMMÉ** (19:41 UTC) : test-base-banc 108/108,
test-fuite-main 20/20, test-garde-prod 7/7, test-acces 85/85 sur la base en mémoire. Les worktrees de lot pointent par jonction vers
`main\.banc-local\node_modules` (jamais vers un autre worktree).

## 1. Les bancs selon ce qu'il leur faut (état après le lot LECTURE-SEULE, branche `a-lecture-seule`)
| exigence | bancs | état tant que la variable manque |
|---|---|---|
| base en mémoire seule | test-acces, test-webhook-stripe, test-remboursement-catch, test-retour-live, test-journal-echecs, test-import-price-guide, test-lot-garde-scratch, test-deduction-ecritures-scratch, test-file-apprentissage, test-sources, smoke-test, capture-reponse, test-fuite-main, test-garde-prod, test-base-banc, test-lecture-seule | tournent |
| `MONGODB_LECTURE_URI` (utilisateur Atlas en lecture seule, grappe `test`) | test-table-vintage, verrou-cellules, verrou/constituer-photos, verrou-charges, verrou-avant-push, test-identification-locale | refusent avant toute connexion, en nommant la variable |
| `MONGODB_CARTES_LECTURE_URI` (lecture seule, grappe `cartes`) | test-vignette-scratch | refuse |
| `R2_BUCKET_BANC` (bucket vide `rat-market-banc`, jamais égal à un bucket de production) | test-import-catalogue-quotidien, test-import-guide-quotidien | refusent |
| (arrêtés, quelle que soit la configuration) | banc-japonais, test-setcode-numero, verrou/sonde-image-jeu | refusent : ils passent par `index.js`, qui se connecte à la production au chargement |
Le jour où le testeur crée les utilisateurs de lecture : `node verifier-utilisateurs-lecture.js` AVANT tout banc (privilèges réels, sans écrire ;
un refus inattendu se lit, il ne se contourne pas).

## 2. À faire, dans l'ordre
1. **Les trois bancs via `index.js`** (décision 8 du testeur) : un lot après INT2, avec une tranche de données copiée dans la base de banc, pour qu'ils
   ne dépendent plus de la production. Tant qu'ils sont arrêtés, `couverture-index.js` et `verrou/couverture-plancher.json` sont rouges.
2. **Le coût du contrôle des tampons** (reporté par le testeur le 2026-10-08) : `sortieSure` vérifie qu'un tampon binaire n'a aucune clé propre hors
   de ses indices, par `Reflect.ownKeys`, qui énumère chaque indice — 17,0 s pour 6 000 documents à deux Binary de 4 et 32 Ko (mesuré par la
   relecture finale de FUITE-MAIN). Bancs seulement, jamais la production. Piste : garder isUint8Array + prototype exact + non-Proxy (le pilote ne
   produit jamais de tampon à clé propre) et retirer l'énumération, ou ne l'appliquer que sous 64 octets — à mesurer avant de choisir.
3. **Deux regex sur le texte brut** dans `test-base-banc.js` (l.125, l.131) : un commentaire contenant `.appliquer()` les satisferait ; réutiliser
   `code(f)` (commentaires retirés).
4. **`verrou-avant-push.js`** reste rouge pour des raisons antérieures (CLAUDE.md §70) et, désormais, faute de `MONGODB_LECTURE_URI`.
