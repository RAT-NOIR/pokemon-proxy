# RAPPORT — premier scan de la page de banc téléphone (`v2/banc-telephone/`)

Branche `v2-premier-scan`, **rebasée sur `origin/api-v2` (`6f51105c`, avec la détection)**, rien de poussé (`git log origin/api-v2..HEAD` : la liste des commits). Ce rapport sépare ce qui est MESURÉ (Chrome de bureau) de ce qui reste à PROUVER (iPhone, Android). Tour 1 (RELECTURE-PS-1.md, -2.md) et tour 2 (RELECTURE-PS-3.md) appliqués : voir §9.

> **Rien dans ce rapport n'est une mesure d'iPhone.** Chrome headless 157 sur un PC Ryzen 7 (16 cœurs), CPU ralentie par `Emulation.setCPUThrottlingRate` (ne touche que le fil principal, pas les fils WASM), réseau simulé **par hôte** par le serveur local du pilote. **Aucune phrase « sous 5 s sur iPhone » n'est permise par ces chiffres.**

## 1. Ce qui prenait le temps

**Cause ÉTABLIE sur PC, sous un débit imposé ; sur iPhone, HYPOTHÈSE compatible avec les 15,5 s relevées, non séparée de la compilation du `.wasm`.**

Ce qui est mesuré (CPU normale) :
- **ARCHIVÉ** : ancienne page, API à 1 Mo/s et modèle à 27 Mo/s : création de session **16 390 ms** et **14 285 ms** (`ps-avant-cpu1.json`, `ps-mem-avant.json`) ; nouvelle page, `.wasm` fourni par `wasmBinary` : **0,40 à 0,64 s** (`ps-froid-cpu1.json` et autres). **Le débit imposé n'est pas archivé dans ces fichiers** (`resume.debitMoS` y vaut `null` : le pilote n'écrivait que le débit réseau de Chrome, pas ceux des hôtes) ; il figure dans les commandes du §7 et le pilote le dépose désormais (`resume.debitApiMoS`, `debitModeleMoS`) pour les prochains passages.
- **NON ARCHIVÉS** (passages de réglage du pilote, faits avant que `--json` existe) : **1 228 ms** (tout en local, 27 Mo/s partout), **12 573 ms** (API limitée à 1,2 Mo/s), trois autres créations de 15,4 à 15,7 s à CPU ×1 et deux de 17,9 à 18,0 s à CPU ×4. Ils ne sont cités que comme indications : l'essai « local contre 1 Mo/s » est à rejouer avec le pilote actuel et à archiver.
- Une fois le `.wasm` (14,2 Mo) en main, graphe, préparation des poids et compilation prennent environ 0,4–0,6 s sur ce PC (archivé). C'est donc, sur PC, le téléchargement du `.wasm` que ORT va chercher lui-même *dans* `InferenceSession.create`, servi par l'API sans compression ni cache. Ni `graphOptimizationLevel`, ni les copies du modèle, ni la compilation WASM sur PC, ni la vérification sha (0,12 s) n'en sont la cause.

Ce qui n'est PAS établi : le débit de 1 Mo/s a été choisi parce qu'il redonne 15,5 s ; le raisonnement est donc circulaire pour l'iPhone. Le débit réel Render→iPhone et la part de compilation du `.wasm` sur Safari ne sont pas connus. **La source des 15,5 s et des 4,2 s** est le dépôt du **2026-11-08 à 10:17 UTC** dans la collection `banc_telephone` de la base `rm_essai` (`creationSessionMs` 15 536, `telechargementMs` 4 155, iPhone iOS 18.7, moteur WASM, `isole: true`, 2 fils) ; je n'ai pas accès en lecture à cette collection depuis cette branche, les chiffres viennent du brief du coordinateur. Le prochain dépôt iPhone tranchera, grâce aux champs ajoutés (§2, 9).

Note sur les fichiers `mesures-ios/ios-iphone-*.json` : **ce ne sont pas des mesures d'iPhone**, ce sont des passages Chrome de bureau avec un agent utilisateur iPhone (mémoire par psapi, `creationSessionMs` ≈ 800 ms).

## 2. Ce qui a été fait

1. **Moteur et modèle par un cache durable** (`public/preparation.mjs`, Cache Storage). Le sha256 du modèle est rejoué à chaque lecture. **Le moteur (`.wasm`) est maintenant vérifié de la même façon** : l'API publie le sha256 du fichier BRUT (`X-Rm-Sha256`, calculé en flux une fois par fichier, présent aussi sur le 304 et sur HEAD) ; il est rangé avec l'entrée et rejoué à chaque lecture, du cache comme du réseau ; la clé du cache porte la version d'ORT du bundle CHARGÉ (`ort.env.versions.common`) ; la revalidation compare le sha rangé à celui du serveur ; **si la session échoue alors que le modèle ou le moteur venaient du cache, les deux entrées sont retirées** avant d'abandonner. Tout échec du cache (absent, `open`/`match` qui lèvent, quota) retombe sur le téléchargement (faux Cache Storage testé).
2. **Préparation en arrière-plan à l'ouverture** : modèle (R2) et moteur (API) en parallèle (le modèle part avant même l'import du bundle d'ORT), session créée seule, moteur fourni à ORT en octets (`env.wasm.wasmBinary`), session réutilisée aux scans suivants. Décodeur, blocage de WebGPU sur iOS, `mesurer()`, `jugerMesure` et ses seuils inchangés.
3. **Progression honnête** : phases réelles (lecture du cache, téléchargement, vérification, création de session) avec octets reçus sur total, jamais de pourcentage inventé. **L'écriture du cache ne retarde plus la session** (`attendreEcriture: false`, `finEcriture`) ; quand on l'attend (échec de vérification), la phase « écriture du cache » est dite. Un clic AVANT « prêt » attend, le dit, et dépose l'attente.
4. **Fichiers servis compressés et revalidables** (`routes.js`) : brotli puis gzip à la demande, calculé une fois, `ETag`, 304, `Cache-Control: no-cache`, `Vary: Accept-Encoding`, `X-Rm-Octets` (taille décompressée), `X-Rm-Sha256`. Le `.wasm` passe de 14,24 à **2,69 Mo** (brotli q9, 1,3 s de CPU une fois), calculé au montage en tâche de fond. Le contenu décompressé est le fichier du disque, octet pour octet ; les empreintes sha des fichiers d'ORT et des copies de l'extension n'ont pas bougé.
5. **Garde de la préparation seule, écrite par ce qu'elle autorise** (arbitrage de l'éditeur) : auto SEULEMENT si le marqueur est absent ou `ferme`, `?prep` n'est pas `0`, `saveData` est absent ou exactement `false`, et `deviceMemory` est absent ou un nombre ≥ 2. Tout le reste bloque : marqueur `en-cours`/`pret` (onglet mort visible), `echec` (jamais relancé seul), marqueur inconnu ; `saveData` d'une autre valeur ; `deviceMemory` illisible ou < 2. **Safari n'expose NI `deviceMemory` NI `navigator.connection` (donc pas de `saveData`) : sur iPhone ces deux gardes sont inertes, et SEULS le marqueur et `?prep=0` protègent** — 113 Mo partent à l'ouverture, sans geste, y compris en 4G. C'est la décision de l'éditeur (la préparation à l'ouverture se mesure sur iPhone ; le marqueur protège après un onglet tué), écrite ici pour la mémoire ET pour le réseau. La `raison` de la garde est déposée avec la préparation (`ok`, `demande`, `interrompue`, `echec`, `inconnu`, `data-economie`, `memoire-faible`) : un état `manuel` dit enfin d'où il vient.
6. **Mesure déposée** (`mesure.preparation`, liste fermée dans `stockage.js`, testée) : cache touché ou non, téléchargement, lecture du cache, sha, chargement et instanciation du moteur, création de session, ouverture→prêt, attente au clic, clic→premier résultat, scans, stockage persistant, **et, ajoutés au tour 1 : octets transférés (`transferSize`) et octets du corps encodé (`encodedBodySize`) du `.wasm`, son encodage (`br`/`gzip`/`identity`/`inconnu`), octets et débit du modèle, tas JS le plus haut vu pendant la préparation et mémoire de l'agent utilisateur quand le navigateur les donne** (null sinon : absent ≠ zéro).

**Définition du « scan »** : une carte, de ses octets à son empreinte (décodage Rat-Market + redimensionnement + inférence), session prête. Temps à froid, au retour et de scan sont séparés.

## 3. Chiffres avant / après (Chrome de bureau)

« Avant » = une copie de l'état `cf85673b` servie par le même pilote (reconstruction : §7). Réseau : API 1 Mo/s, modèle 27 Mo/s, chacun limité côté serveur sur les octets réellement envoyés. 4 fils.

> **Les débits par hôte ignorent qu'un téléphone n'a qu'UN lien partagé** : sur un iPhone réel, le moteur compressé (2,7 Mo) et le modèle (113 Mo) se disputeraient la même bande passante. Les « 5,1–5,8 s » à froid sont donc plutôt une **borne basse**.

**Chaque cellule donne la médiane, le min–max et le n des mesures ARCHIVÉES** (`mesures-ios/ps-*.json`), toutes les mesures d'une page comptées (une page en dépose jusqu'à 3), pas seulement la première. `ms`, CPU ×1, 4 fils sauf mention. Le 1,5 s « tenu » ne vaut que pour la ligne CPU ×1.

| (CPU ×1) | avant (n) | après, à froid (n) | après, au retour (n) |
|---|---|---|---|
| téléchargement du modèle | 4 388 – 4 423 (n=2) | médiane 4 410, 4 380–4 460 (n=6 passages, dont les 3 passages à 1/2/3 fils) | — (lu dans le cache : lecture 100 – 259, médiane 207, n=3) |
| moteur `.wasm` | 14,2 Mo à 1 Mo/s, dans la création de session | **2 688 054 octets transférés en brotli** (`ps-t1-froid`) ; `wasmMs` médiane 3 073, 2 988–4 146 (n=6 ; **mesuré EN PARALLÈLE du modèle, sur un lien simulé distinct : ce n'est pas le débit propre du `.wasm`**) | cache (+ revalidation HEAD) ; `wasmMs` 35 – 1 030 (n=3) |
| création de session | 14 285 ; 16 390 (n=2) | médiane 468, 400–641 (n=6) | médiane 434, 416–535 (n=3) |
| ouverture → prêt | n'existe pas (tout au clic) | **médiane 5 191, 5 099–5 826 (n=7, `ps-t2-froid` compris)** | préparée SEULE à l'ouverture : **903 et 944 (n=2, `auto: true`, `ps-t2-retour` et `ps-t1-retour`)** ; préparée au clic : attente **739 et 1 567 (n=2)** |
| un scan, 1re mesure de la page | `premiereMs` 481, 494, 513, 1 345 (n=4 ; inférence SEULE, sans prétraitement) | médiane 520, 474–576 (n=5) | médiane 463, 374–539 (n=7) |
| un scan, médiane des suivants | `medianeMs` 448 – 499, médiane 478 (n=4 ; inférence seule) | médiane 510, 395–590 (n=5) | médiane 404, 381–539 (n=7) |

Les passages `ps-t2-froid` / `ps-t2-retour` (tour 2, après le refactor des décisions de B1 ; égalité au bit passée ; premiers passages dont le JSON porte `debitApiMoS: 1` et `debitModeleMoS: 27`) ne figurent que sur la ligne « ouverture → prêt » ci-dessus ; les autres cellules sont calculées sur les autres fichiers.

(CPU ×4) — n=1 à 3 selon la cellule : avant, création 16 537 (n=1) ; à froid, prêt 7 543 (n=1), 1re mesure 1 891 / 1 998 / 1 565, suivants 1 671 / 1 715 / 1 605 (n=3) ; au retour (préparation lancée au clic), attente 3 704 (n=1), 1re mesure 1 713 / 1 603 / 1 611, suivants 1 602 / 1 592 / 1 591 (n=3). Ce ralentissement ne porte pas sur les fils WASM : il ne dit pas ce que fera un iPhone.

**Ce que ces chiffres autorisent** : sur ce banc, avec ce modèle de débits, le premier scan à froid passe d'environ 21 s avant la première inférence (somme 4,4 + 0,1 + 16 **de deux passages différents, pas d'un passage unique**) à environ 5,1–5,8 s (médiane 5,2 s, n=7) ; au retour avec préparation à l'ouverture la page est prête en 0,90–0,94 s **(n=2, sous charge)**. **Ce qu'ils n'autorisent pas** : la cible « premier scan sous 5 s » n'est pas atteinte à froid, même ici : le modèle (113 Mo ; 4,2 s sur iPhone) ne se télécharge pas plus vite et le modèle 4 bits reste refusé. « Sous 1,5 s aux scans suivants » est tenue **à CPU ×1 seulement** (0,37–0,59 s sur les 12 mesures « après » archivées) ; à CPU ×4 elle ne l'est pas (1,6–2,0 s) ; sur iPhone elle dépend de l'inférence (médiane 1 089 ms le 08/11 avec 2 fils, plus le prétraitement) : **non prouvée**.

**Passages archivés** (`mesures-ios/ps-*.json`, §7) : « avant » CPU ×1 : 2 passages (`ps-avant-cpu1`, `ps-mem-avant`), CPU ×4 : 1 ; « après » à froid CPU ×1 : **6 passages** (`froid-cpu1`, `mem-froid`, `t1-froid`, `fils-2/4/6` — ces trois derniers à 1, 2 et 3 fils : ils comptent pour le prêt et le téléchargement, pas pour les temps de scan) et CPU ×4 : 1 ; « après » au retour CPU ×1 : 3 passages (`retour-cpu1`, `mem-retour`, `t1-retour`) et CPU ×4 : 1. Les autres passages (réglage du pilote, dont un avec un modèle trop ralenti par un défaut du pilote, corrigé) ne sont pas archivés. Sur un n de 1 il n'y a ni médiane ni étendue.

### Charge de la machine pendant les mesures
Un verrou complet tournait sur une autre branche : charge du processeur relevée avant les passages de 41 à 76 % (48 % pour le dernier). **Tous les temps absolus ont été pris pendant cette charge**, variable. Les rapports avant/après sont de plusieurs fois et dépassent la dispersion observée ; les valeurs absolues de scan ne valent que sous cette charge.

## 4. Égalité au bit (30 cartes)

Référence : `mesures-ios/vecs-av-wasm-1.bin` (empreintes WASM, 30 × 256 float32, **produites par Chrome de bureau**, comme tous les passages de ce rapport). **L'égalité au bit est donc Chrome contre Chrome** : elle prouve que ni le cache, ni `wasmBinary`, ni le brotli, ni la session réutilisée ne changent les octets du modèle ni du moteur sur ce Chrome ; **elle ne dit rien de Safari/iOS** (autre moteur WASM, autre arithmétique, autres fils). L'égalité iPhone↔Chrome reste celle du dépôt du 08/11 (cos 0,9999999), non rejouée ici.

| passage | résultat |
|---|---|
| ancienne page, CPU ×1 et ×4 | identiques au bit, 30 720 octets, 0 différent |
| nouvelle page à froid, CPU ×1 et ×4 ; passage tour 1 | identiques au bit |
| nouvelle page au retour (modèle ET moteur lus dans le cache), CPU ×1 et ×4 ; passage tour 1 | identiques au bit |

Le pilote **impose maintenant l'égalité** (`--ref=<fichier.bin>` : code de sortie 3 et ligne « DIFFERENT » sinon) ; les passages du tour 1 l'ont passée. Le fichier de modèle n'est pas modifié, le `.wasm` non plus : aucune publication, rien dans R2. Verdict `IDENTIQUE`, `cos min 0,9999999` partout.

## 5. Mémoire de pointe (psapi, mémoire privée, Chrome de bureau, CPU ×1, diagnostic des pixels inclus, avant le tour 1)

| | rendu | GPU | somme au même instant |
|---|---|---|---|
| ancienne page | 570 Mo | 127 Mo | 872 Mo |
| nouvelle à froid | 542 Mo | 128 Mo | 837 Mo |
| nouvelle au retour | 533 Mo | 126 Mo | 787 Mo |

Pas de hausse sur PC. **Chrome de bureau seulement : le pic d'un iPhone n'est pas mesuré.** **Non mesuré non plus** (relecture, M1) : `tee()` met en file l'excédent si l'écriture du cache est plus lente que le réseau, jusqu'à 113 Mo de plus sur un appareil au disque lent ; la préparation à froid sur iPhone est le cas à mesurer (le dépôt donne maintenant le tas JS et la mémoire de l'agent quand le navigateur les donne ; Safari probablement pas). Les mesures mémoire ci-dessus précèdent la correction M2 (écriture non attendue) et n'ont pas été rejouées.

## 6. Fils : 2 ou plus ?

Page à froid, sans diagnostic, `hardwareConcurrency` imposé (la page prend la moitié des cœurs, de 1 à `FILS_MAX = 4`, constante de la copie de l'extension) :

| fils | médiane d'une inférence | première |
|---|---|---|
| 1 | 1 390 ms | 1 365 ms |
| 2 | 679 ms | 723 ms |
| 3 | 480 ms | 506 ms |
| 4 | 440–510 ms | 480–520 ms |

Sur PC le rendement s'arrête vers 3–4 fils. **Non testé** : plus de 4 fils (cela demande de toucher la copie de l'extension) et **tout essai sur iPhone**, donc aucun avis sur le gain réel ni le risque de plantage d'un fil de plus sur Safari. Le nombre de fils n'a pas changé.

## 7. Traçabilité

- **Archive** (commitée) : `mesures-ios/ps-{avant,froid,retour}-cpu{1,4}.json` (la série), `ps-mem-{avant,froid,retour}.json`, `ps-fils-{2,4,6}.json`, `ps-t1-{froid,retour}.json` (tour 1) et les `vecs-ps-*.bin` (empreintes, 30 720 octets chacun). Chaque JSON porte le résumé du pilote, le journal de la page et le dépôt tel que `stockage.js` l'a reçu. Les passages de réglage ne sont pas archivés (§3).
- **Reconstruire la copie « avant »** (état `cf85673b` de la page) : `git archive cf85673b v2/banc-telephone` vers un fichier temporaire, extraire (`tar -x`) dans un dossier temporaire, copier le `v2/banc-telephone` obtenu vers `v2/banc-telephone-avant` (dossier FRÈRE : il lit `../erreurs`, `../transport`, `../db`), puis `node outils\banc-telephone\pilote-premier-scan.js --dossier=banc-telephone-avant --cpu=1 --port=47931 --debit-api=1 --debit-modele=27 --sans-diagnostic=1 --scans=2 --vecs=<out.bin> --ref=mesures-ios\vecs-av-wasm-1.bin --json=<out.json>`. Retirer ensuite `v2/banc-telephone-avant` (copie simple, sans jonction). Un profil conservé pour le « retour » se place dans `%TEMP%` (un profil sous le dossier temporaire de l'agent faisait échouer l'écriture du cache : « Entry already exists », cause non élucidée) avec le même `--port` et le même `--profil` ; le pilote ferme Chrome proprement (un kill perdait les dernières écritures de `localStorage`, dont le marqueur « ferme »).
- Le « retour avec préparation lancée seule » a été mesuré après correction de défauts du PILOTE (écritures de `localStorage` perdues par un kill) et d'un défaut de la page (`visibilitychange` tardif ré-écrivant « pret » après `pagehide` ; `pageshow` restaure).

## 8. Ressources tierces qui conditionnent COOP/COEP

L'isolation est déjà active. La page n'a **aucune** ressource tierce de script, de style, de police, d'image ou d'iframe : CSP `default-src 'none'`, `script-src 'self' 'wasm-unsafe-eval'`, `img-src 'self'`, `connect-src 'self'` + un hôte. Liste complète :
1. **L'hôte R2 exact du modèle** (`<compte>.r2.cloudflarestorage.com`, atteint par le 302 de `GET /api/modele-empreinte/<sha256>`). Sous `Cross-Origin-Embedder-Policy: require-corp`, sa réponse doit porter des en-têtes CORS (ou CORP `cross-origin`) : sans eux, le téléchargement échoue (`telechargement-modele-bloque:indetermine-isole`) et l'isolation tombe. **Ce chemin n'a jamais été exercé avec le vrai R2 dans ce lot** (les pilotes servent le modèle en 200 sans redirection) ; il tourne aujourd'hui sur l'essai (4 155 ms sur iPhone, isolé). Avec la préparation à l'ouverture, un échec CORS apparaîtrait à l'ouverture ; grâce au marqueur `echec` il ne se relance pas seul.
2. Les fils WASM sont des `Worker` créés depuis une URL `blob:` du bundle d'ORT (`worker-src 'self' blob:`) : rien de tiers.
3. Toute autre page qui chargerait celle-ci sous isolation (le site, l'extension) devrait elle-même porter COEP et ne charger que du `same-origin`, du CORS ou du CORP : analytique, polices, Stripe.js, images distantes de ces pages sont à vérifier de leur côté.

## 9. Tour 1 de relecture : vérifié sur le code, puis corrigé

Constats vérifiés sur le code avant correction : B1 (vérificateur du moteur = 4 octets magiques + longueur, clé sans version, entrée gardée après un échec de session), B2 (`peutPreparerSeul` refusait par énumération : marqueur `echec` ou inconnu autorisait, `saveData` ignoré), M2 (attente d'écriture muette jusqu'à 15 s avant la session) étaient **exacts**. Corrigés (§2). Tests : rouge vu pour chacun, puis vert.
- **M1** (`tee` et mémoire) : exact, non corrigé, non mesuré (§5). **M3** (marqueur confondant « rechargé » et « tué » : `interrompueAvant` compte aussi les impatients) et **M4** (deux onglets : le second ne prépare jamais seul) : exacts, à savoir en lisant les dépôts ; non corrigés.
- **Limite des 8 192 octets** : un dépôt WebGPU COMPLET (entrée, diagnostic des pixels, orientation, préparation avec tous les champs au plus long, détection) fait **4 659 octets** : accepté, sous la limite avec les deux listes.
- **OpenCV / `Content-Length`** (lecture, non exécuté en navigateur) : `detection-page.mjs` charge `opencv_js.wasm` par `fetch(...).arrayBuffer()` (décompression transparente) et le donne à Emscripten par `wasmBinary` ; aucun `locateFile` ni aucune comparaison d'une taille à un `Content-Length` n'est utilisé. `test-detection.js` (73) et `test-detection-depot.js` (14) passent avec les routes compressées.

### Tour 2 (RELECTURE-PS-3.md) : preuve et traçabilité
- **P3-1 (exact : trois mutations survivaient, le test de B1 côté page n'était qu'une regex).** Les trois décisions sont maintenant des fonctions PURES de `preparation.mjs` — `cleMoteur` (clé versionnée), `verifierMoteur` (magie + sha256 rejoué contre celui du serveur, sha absent ou mal formé refusé), `apresEchecDeSession` (éviction de modèle ET moteur si l'un venait du cache) — testées par comportement (section 1c du banc, 14 verdicts). **Le banc applique lui-même trois mutations au texte de `preparation.mjs` et vérifie qu'elles sont TUÉES** : (1) `if (false && sources.wasm === 'cache' ||` (l'éviction ne se déclenche plus), (2) `return true` à la place de la comparaison du sha, (3) clé sans version ; plus une mutation témoin sans rapport qui ne tue rien (le banc ne crie pas à tort). `app.js` ne fait plus qu'appeler ces fonctions (test de câblage : aucune copie de la règle n'y est restée). **Limite honnête** : le CÂBLAGE d'`app.js` (l'appel de `apresEchecDeSession` dans `preparerWasm`) reste vérifié par du texte ; un banc qui exécute `preparerWasm` avec une session qui lève demanderait un navigateur.
- **P3-8** : `--ref` sans `--vecs` fait sortir le pilote en code 3 avec un message, avant tout travail (testé : le banc lance le pilote avec `--ref` seul et lit le code et le message).
- **P3-2** : `saveData` aussi est écrit par ce qu'il autorise (absent ou exactement `false`). **P3-3** : Safari n'expose ni `saveData` ni `deviceMemory` : dit au §2 point 5.
- **P3-4, -5, -6** : attente « 0,74 s et 1,57 s (n=2) » ; le tableau du §3 donne médiane, min–max et n de TOUTES les mesures archivées ; le débit imposé est déposé par le pilote (`debitApiMoS`, `debitModeleMoS`) pour les prochains passages et n'est pas archivé pour les anciens ; 1 228 et 12 573 ms marqués non archivés (§1) ; « 6 passages à froid » (le 7ᵉ n'était pas archivé).
- **P3-7** : le commentaire d'`app.js` ne dit plus « c'était l'essentiel » sans réserve (testé). Le message du commit `4da0ab65` l'est encore : non réécrit, dit ici.
- Ajoutés : un test HEAD pour `X-Rm-Sha256` (présent, sans corps, même étiquette que le GET) ; `wasmMs` se mesure EN PARALLÈLE du modèle (dit au §3) ; la `raison` de la garde est déposée (`mesure.preparation.raison`, liste fermée). Non faits : la durée réseau propre du `.wasm` (`responseStart→responseEnd`), M1/M3/M4.

## 10. Ce qui manque (à prouver ou à faire)

- **Aucune mesure sur iPhone ni sur Android.** C'est la preuve finale (tests de l'éditeur). Le dépôt `mesure.preparation` porte maintenant de quoi séparer téléchargement et compilation du `.wasm` (octets transférés, encodage, instanciation) et le débit du modèle.
- **Safari / iOS : Cache Storage non éprouvé** : l'écriture du modèle de 113 Mo y réussit-elle, quel quota, éviction après 7 jours sans visite ? Le marqueur « ferme » écrit à `pagehide` survit-il dans `localStorage` de Safari ? (Sur Chrome, un kill perd les dernières écritures, mesuré ; Safari non vérifié.)
- **Brotli sur Render** : le calcul au montage n'est testé que sous node ; le pic de CPU/mémoire de q9 sur une petite instance n'est pas lu ; Render peut aussi recompresser ou non en amont. Le débit réel API→iPhone du `.wasm` compressé n'est pas mesuré.
- Temps de compilation du `.wasm` sur iPhone (≈ 17–80 ms sur PC, mesuré par un témoin autour de `WebAssembly.instantiate`).
- La voie WebGPU n'a pas été rejouée dans Chrome (seul changement : la session WASM préparée est libérée avant, `libererSessionPreparee`).
- Le verrou complet n'a pas été lancé (consigne). Suites rejouées vertes sur la base fusionnée : `test-banc-telephone` 131, `-cors` 44, `-ios` 62, `-tour1` 79, `-premier-scan` 98 (nouvelle), `test-decodeur` 1 447, `test-decodeur-page` 69, `test-detection` 73, `test-detection-depot` 14.

## 11. Fusion avec la base `6f51105c`

Rebase fait. Conflits résolus : `stockage.js` (`preparation` ET `detection` conservés, leurs deux blocs de validation conservés), `test-banc-telephone.js` et `test-banc-telephone-tour1.js` (compte de routes **23** = page + 21 fichiers + dépôt). `page.html` et `routes.js` fusionnés seuls. Bilan des tests au format « N réussis, M échoués » inchangé.
