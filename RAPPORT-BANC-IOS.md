# RAPPORT — banc téléphone sur iPhone : plantage WebGPU, pic mémoire, écart de la chaîne WASM

Branche `v2-banc-ios` (worktree `C:\Users\Yung\rat-market-travail\api\v2-banc-ios`), depuis `origin/api-v2` d2c28b30. Rien n'est poussé. Extension 1.0.5 et prod v1 : aucun fichier touché ; `empreinte.js`, `moteur-ort.js`, les bundles ORT et les `.wasm`
sont les copies de l'extension, inchangées (le banc `m5` compare leurs sha256 : vert). Le modèle et ses poids ne sont pas touchés.

Tout ce qui suit a été **mesuré dans Chrome 157 headless sur le PC de développement (Windows, GPU AMD RDNA2)**, avec les fonctions de production de la page. **Rien n'a été mesuré sur un iPhone** : ce qui ne vaut que pour iOS est écrit « supposé ».

---

## 1. La cause du plantage WebGPU

**Cause la plus probable : l'onglet est tué par manque de mémoire, par CUMUL — pas par une limite de tampon WebGPU.** Dans la page d'origine, « WASM puis WebGPU » dans le même onglet empile : le tas WASM de la première
session (qui ne se rend jamais), un SECOND moteur ORT avec son propre tas, 113 Mo d'octets du modèle conservés ou retéléchargés, et ~290 Mo de tampons GPU qui transitent par la mémoire du processus.

### Ce qui est mesuré

| fait | mesure | instrument |
|---|---|---|
| Une instance d'ORT = une mémoire linéaire WebAssembly de **254 Mo**, qui **ne rétrécit pas** quand `session.release()` est appelé : `[254]` après la mesure WASM (session libérée) | `WebAssembly.Memory` interposée, taille lue après chaque mesure | `pilote-memoire.js --sonde-wasm=1` |
| Importer ORT-WebGPU (un second module : `ort.webgpu.bundle` + `asyncify.wasm`) crée **une SECONDE mémoire de 254 Mo** : `[254, 254]` après « WASM puis WebGPU » | idem | idem |
| La session WASM est bien libérée (`finally { session.release() }`, déjà présent) : ce que ça libère est dans le tas, qui reste réservé | lecture du code `app.js` + la mesure ci-dessus | |
| Mémoire privée du processus de rendu, **pic exact** (psapi `PeakPagefileUsage`, sans échantillonnage), page d'origine : WASM seul **715-741 Mo** (médiane 727) · WebGPU seul **799-865 Mo** · WASM puis WebGPU **1 116-1 139 Mo** | 3 / 2 / 3 essais | `pilote-memoire.js` |
| Processus GPU en plus : **~510-530 Mo** (privé), les mêmes avant et après mes changements | idem | idem |
| Tampons WebGPU créés par ORT pour ce modèle : **729 tampons, 287 Mo créés au total, le plus gros 8 Mo, 151 Mo vivants au plus haut** | `GPUDevice.createBuffer` / `GPUBuffer.destroy` interposés avant les scripts de la page | `pilote-memoire.js --sonde-gpu=1` |
| Le modèle (lecture protobuf sans dépendance) : 286 initialiseurs, 112,5 Mo ; **74 poids `uint8` (89,7 Mo) lus par 74 nœuds `MatMulNBits`** (8 bits, bloc 32), 212 tenseurs `float32` (28,3 Mo) ; **plus gros tenseur 2,36 Mo** (9 Mo s'il était déquantifié en float32) | | `outils/banc-telephone/lire-onnx.js` |
| Limites WebGPU demandées par ORT à ce PC : `maxBufferSize` = `maxStorageBufferBindingSize` = limites **de l'adaptateur** (2 Gio ici) | lecture de `requestDevice` | `--sonde-gpu=1` |

### Les hypothèses de la demande, une par une

* **« La session WASM est-elle libérée ? »** Oui (`release()` dans un `finally`). Mais son tas WASM de 254 Mo reste (propriété de WebAssembly), et le second ORT en crée un autre. C'est le premier contributeur.
* **« Combien de copies du modèle ? »** Dans la page d'origine : **une côté JS** (tableau préalloué rempli par morceaux — le chargement « en flux » existait déjà — conservé dans `E.modele` pour toute la page), une copie transitoire de WebCrypto pendant le `sha256`
  (`crypto.subtle.digest` copie le tampon ; libérée juste après), **une copie dans le tas ORT** (`_malloc` + `HEAPU8.set` dans `createSession`, vue dans le code servi : `Lt`), puis les poids parsés par ORT. Pour WebGPU, `creerSessionGpu` fait
  `new Uint8Array(buffer)` : **une vue, pas une copie**.
* **« Poids déquantifiés en fp32 sur le GPU (~450 Mo) ? »** **Réfuté sur Chrome desktop** : le total de tampons créés (287 Mo) est inférieur à la déquantification complète (370 Mo) et le pic de tampons vivants est de 151 Mo, soit ≈ poids `uint8` (90 Mo) + `float32` (28 Mo) + activations.
  Les noeuds sont des `MatMulNBits` que le fournisseur WebGPU lit quantifiés. **Supposé sur iOS** : que Safari choisisse les mêmes noyaux (il peut en choisir d'autres sans certaines fonctions WebGPU).
* **« Le plus gros tampon contre `maxBufferSize` / `maxStorageBufferBindingSize` d'iOS ? »** Le plus gros tampon est de **8 Mo**, très en dessous des minimums de la norme WebGPU (256 Mo et 128 Mo). ORT demande au périphérique les limites de l'adaptateur, pas plus : un refus de
  `requestDevice` n'est pas attendu. **Une limite de tampon n'est pas la cause** ; ce que je ne peux pas exclure sans iPhone : une limite propre à Safari que Chrome n'a pas.

### Ce qui reste supposé (rien de tout cela n'est mesuré sur iOS)

1. Le plafond mémoire de l'onglet sur l'iPhone testé (non publié ; l'onglet est tué sans erreur JavaScript, c'est le comportement de Jetsam).
2. Que l'ordre « WASM puis WebGPU » soit le déclencheur : sur Chrome PC il coûte +300 à +400 Mo de mémoire privée par rapport à WebGPU seul (1 116-1 139 contre 799-865). **Diagnostic à faire sur l'iPhone (`?webgpu=forcer`)** : recharger la page, taper
  « Mesurer en WebGPU » SANS avoir lancé WASM avant. Si ça passe, la cause est bien le cumul ; sinon WebGPU seul est déjà trop pour l'appareil.
3. L'usage de la mémoire unifiée par les tampons GPU (sur Apple, ils comptent dans l'empreinte de l'appareil ; le processus GPU de Chrome PC, 520 Mo privés, ne dit pas la même chose).

---

## 2. WebGPU désactivé sur iOS / iPadOS

* `detecterIOS` (verdict.mjs, pure, testée) : iPhone / iPad / iPod dans l'agent utilisateur, **ou** `navigator.platform === 'MacIntel'` avec `maxTouchPoints > 1` (iPad en mode bureau). **Un agent illisible BLOQUE** (« indetermine ») : la garde ne conclut pas vers « tout va bien ».
  Un Mac de bureau (0 point tactile) garde son WebGPU.
* `choisirMoteur` : WebGPU demandé sur iOS ⇒ moteur WASM, texte « WebGPU désactivé sur iOS (plantage mémoire) : WASM utilisé » affiché (zone `avisMoteur`) et journalisé ; le bouton WebGPU est désactivé (« WebGPU désactivé sur iOS »), y compris après une mesure.
  `?webgpu=forcer` (valeur exacte seulement) rouvre le bouton : texte « WebGPU forcé sur iOS (diagnostic) : plantage mémoire possible ».
* Le résultat déposé porte le moteur **réellement** utilisé (`moteurRealise`, inchangé) ; nouveaux champs déposés (liste fermée, bornes testées) : `moteurDemande`, `webgpuDesactive`, `webgpuForce`, `optionsSession`, `diagnosticPixels`.
* **Rejoué dans Chrome headless avec l'agent d'un iPhone, puis celui d'un iPad en mode bureau (MacIntel, 5 points tactiles)** (`pilote-memoire.js --ua=iphone|ipad-bureau --moteur=webgpu`) : bouton désactivé, texte affiché, `lancer('webgpu')` exécute WASM, dépôt
  `moteur: wasm, moteurDemande: webgpu, webgpuDesactive: true` ; avec `?webgpu=forcer` : bouton actif, WebGPU réellement utilisé (`moteur: webgpu, webgpuForce: true`). Fichiers `mesures-ios/ios-*.json`.

## 3. Pic mémoire réduit, sans changer une empreinte

### Égalité au bit près (critère absolu)

`outils/banc-telephone/comparer-empreintes.js` compare les 30 empreintes WASM (Float32Array 30 × 256, normalisées L2, sorties de la page : `E.vecWasm`) **octet par octet** (30 720 octets) ; vu rouge sur un seul bit muté (code de sortie 1).
Référence : le code d'origine, 1er essai. **Identiques au bit près** : le code d'origine (essais 2 et 3), le nouveau code (3 essais), le nouveau code avec `?session=arena0,pattern0` (3 essais), le nouveau code après « WASM puis WebGPU » (2 essais) — 10 comparaisons sur 10, 0 octet différent.
Les empreintes WASM sont donc déterministes d'un lancement à l'autre (4 fils) et mes changements n'y touchent pas.

### Les deux chiffres

Mémoire **privée** du processus de rendu de la page, **pic exact** du système (psapi), Chrome headless :

| scénario | page d'origine (d2c28b30) | après ce lot | écart |
|---|---|---|---|
| **WASM seul** (cas de l'iPhone) | **727 Mo** (715 / 727 / 741) | **687 Mo** (739 / 676 / 687) | −40 Mo (−5,5 %), dans la dispersion d'un essai à l'autre (676-741) |
| **WASM puis WebGPU**, même page | **1 139 Mo** (1 116 / 1 139 ; série : 1 122) | **1 034 Mo** (1 033 / 1 034 ; série : 1 039) | −105 Mo (−9 %), stable |
| WebGPU seul | 832 Mo (865 / 799) | 749 Mo (756 / 742) | −83 Mo |
| niveau de la page à la fin (série « WASM puis WebGPU ») | 861 Mo | 729 Mo | −132 Mo |
| processus GPU (privé) | 525-530 Mo | 524-527 Mo | inchangé |

**Le pic de création de la session WASM n'a pas baissé de façon mesurable** (−5 % au milieu d'un écart de ±5 %) : il est dominé par la mémoire d'ORT (254 Mo de tas, le code WebAssembly compilé, les fils), pas par ce que la page tient. Ce que le lot réduit réellement,
c'est ce que la page **garde** : les 113 Mo du modèle ne sont plus conservés. **Le « pic » résident (working set) du système n'est pas fiable** : le même code donne 813 puis 1 123 Mo d'un essai à l'autre (le système rogne le working set quand il veut) ; je ne le cite pas.

### Ce qui a été fait

1. **Une seule copie côté JS, rendue tout de suite** : `E.modele` n'existe plus (la page d'origine gardait les 113 Mo pour toute sa vie) ; la fonction `chargerModele()` rend le tableau, l'appelant le jette dès que la session est créée et le **détache par
   `ArrayBuffer.prototype.transfer(0)`** (le stockage est rendu au système sans attendre le ramasse-miettes ; sans `transfer` — Safari l'a depuis la 17.4, à confirmer sur l'iPhone — repli sur le ramasse-miettes, donc sans ce gain). Le détachement n'a lieu que si la session est créée (sur un échec ou un délai dépassé, la création peut encore lire).
   **Contrepartie dite** : une seconde mesure dans la même page retélécharge (et revérifie) le modèle.
   *Premier essai écarté* : jeter la référence sans détacher donnait **+300 Mo** sur « WASM puis WebGPU » (deux copies de 113 Mo coexistent tant que le ramasse-miettes n'a pas tourné) ; c'est le `transfer(0)` qui a rendu le gain.
2. **Chargement en flux** : il existait déjà (lecture du corps par morceaux dans un tableau préalloué de la taille annoncée, pas d'`arrayBuffer()`) ; rien à changer. Le `sha256` reste fait par WebCrypto (la série montre ~70 Mo de plus pendant cette étape, que j'attribue à une copie du tampon : supposé ; ce n'est pas le pic de la mesure WASM ;
   un sha256 incrémental en JavaScript l'éviterait mais coûterait du temps sur téléphone : non fait).
3. **Session libérée** entre deux mesures et avant WebGPU : déjà le cas, conservé. Les tampons d'entrée sont de petits `Float32Array` jetés à chaque carte ; les chaînes base64 du lot sont supprimées après décodage ; un seul canvas de décodage pour toute la page.
4. **Options d'ORT** `enableCpuMemArena: false` / `enableMemPattern: false` : essayées (paramètre `?session=arena0,pattern0`, liste fermée) : **empreintes identiques au bit près, mais aucun gain** (pic 730-820, médiane **757 Mo** contre 687) → **non adoptées**. Le paramètre reste, pour le diagnostic.
5. **Le diagnostic des pixels est calculé APRÈS la mesure**, pour ne jamais coexister avec le modèle ni avec une session (sa première version, avant la mesure, ajoutait de la mémoire au pic).
6. **Reste hors de portée de la page** : un tas WASM ne se rend qu'en fermant la page. Un seul moyen de séparer vraiment WASM et WebGPU dans une même séance : recharger la page entre les deux moteurs (non fait : ça change le parcours, et le pilote enchaîne les deux dans une page). Proposition.

## 4. L'écart WASM de l'iPhone : « modèle seul » 1, chaîne complète 0,99987

**Ce qui dépend du navigateur dans la chaîne** (lecture de `app.js` et `empreinte.js`) : (1) le **décodage du JPEG** (`createImageBitmap` : libjpeg-turbo dans Chrome/Firefox, ImageIO chez Apple — IDCT, suréchantillonnage des chrominances, arrondis différents) ;
(2) la **conversion de couleur** (`colorSpaceConversion: 'none'`, profil ICC, espace du canvas) ; (3) `drawImage` + `getImageData` (octets 8 bits, alpha 255). Tout le reste est du JavaScript déterministe : `redimPIL` (doubles, `Math.round`), `versTenseur` (float32).
Et « modèle seul » = 1 prouve que le moteur WASM de l'iPhone rend les mêmes sorties que le natif à pixels égaux. **Le soupçon se porte donc sur le décodage ou la couleur — mais ce n'est pas encore démontré** : c'est ce que la nouvelle ligne mesure.

**La ligne 4 de la page** (affichée, journalisée, déposée dans `mesure.diagnosticPixels`), calculée une fois par page, contre les pixels de **PIL** (le lot porte maintenant le décodage PIL pleine taille `dec` de ses 2 premières cartes ; `ajouter-decodage-lot.py`, qui vérifie que ce décodage
redonne exactement les 224 × 224 du lot ; rien d'autre du lot n'a changé, vérifié) :

* **décodage** (2 cartes, 420 × 587) : pixels décodés par le navigateur contre `dec` → *le décodeur seul* ;
* **redimensionnement de référence** : `redimPIL(dec de PIL)` contre les 224 de PIL → *le plancher du redimensionnement JS, indépendant du navigateur* ;
* **chaîne** (12 cartes) : `redimPIL(décodage du navigateur)` contre les 224 de PIL ;
* et les mêmes décodages avec `colorSpaceConversion: 'none'` (sans repli, `null` si le navigateur le refuse) et par défaut, plus l'espace couleur du canvas.

Cause rendue (`causeEcart`) : **decodeur** (le décodage diffère déjà), **autre-etape** (décodage identique, chaîne pire que le plancher : couleur, alpha, bitmap), **aucune**, **indetermine** (une mesure manque : jamais « aucune » par défaut).

**Valeurs de Chrome PC** (pour lire celles du téléphone) : décodage max 0 (Chrome = PIL au pixel près, 0 octet sur 1 479 240) ; plancher du redimensionnement max 1, 38 octets sur 301 056 (0,0126 %) ; chaîne max 1, 124 octets sur 1 806 336 (0,0069 %) ; bitmaps avec et sans conversion : 0 ;
canvas `srgb` ⇒ cause « aucune », cos min 0,9999999. Sur l'iPhone, un `decodage.max` > 0 dira « decodeur ».

**Ce que je propose pour l'extension (à décider par l'agent extension ; je n'ai rien modifié)** :
1. Ne rien changer au prétraitement tant que la ligne 4 n'a pas parlé sur un téléphone. Si la cause est « decodeur » : l'écart est celui du décodeur du navigateur sur la photo, qui précède de toute façon la chaîne de l'extension (la carte vient d'une `<img>` déjà décodée par la page) —
   il est hors de son contrôle, et **0,99987 reste au-dessus de la garde 0,998 avec une marge de 0,0019**.
2. Le seuil « IDENTIQUE » du banc (0,9999) est un seuil de banc contre une référence PIL, pas une exigence de l'extension : le banc peut garder « ÉCART » comme information sans que ce soit un défaut du produit.
3. Si l'on voulait malgré tout l'égalité au pixel sur tous les navigateurs pour les JPEG du lot, il faudrait un décodeur JPEG déterministe en JavaScript (équivalent à libjpeg-turbo ISLOW + suréchantillonnage « fancy ») pour le BANC seulement : à n'envisager que si la ligne 4 dit « decodeur » ET que l'écart gêne.
4. Si la cause est « autre-etape » : tester `ImageDecoder` (WebCodecs) ou un décodage via `<img>` + `canvas` avec `colorSpace: 'srgb'` explicite ; le diagnostic de la page compare déjà les deux variantes de bitmap.

## 5. Vérifications

* `v2/test/test-banc-telephone-ios.js` : **51 assertions**, rouge vu avant l'écriture du code (`V.detecterIOS is not a function`), verte ensuite.
* Bancs existants du banc téléphone : `test-banc-telephone.js` 110/110, `test-banc-telephone-tour1.js` 79/79, `test-banc-telephone-cors.js` 44/44.
* Verrou complet `node v2/test/lancer-tout.js` (aucun `.env` dans le worktree) sur les commits 77f295b1, dabeab99, a72cd98c : **321 fichier(s), 0 en échec** (323 fichiers `test-*.js`, 2 exclus par le lanceur lui-même). Aucune suite instable n'a eu besoin d'être rejouée.
* Pilote réel Chrome headless : IDENTIQUE en WASM (cos min 0,9999999, « modèle seul » 1) et en WebGPU (IDENTIQUE) après les changements.

## 6. À faire sur l'iPhone (ordre conseillé)

1. Ouvrir la page (WebGPU est désormais désactivé, le texte le dit), « Mesurer en WASM » : lire la **ligne 4**. Elle dit si l'écart de 0,99987 vient du décodeur.
2. Pour le diagnostic de la cause du plantage : ouvrir `…/api/banc/telephone?webgpu=forcer`, **sans** lancer WASM, taper « Mesurer en WebGPU ». Réponse « passe » ⇒ le cumul WASM + WebGPU est la cause ; « plante » ⇒ WebGPU seul est déjà trop pour l'appareil.
3. Facultatif, pour la mémoire : `?session=arena0,pattern0` (le dépôt porte `optionsSession`).

## 7. Fichiers

* Page : `v2/banc-telephone/public/{app.js,verdict.mjs,page.html,lot.json}`, `v2/banc-telephone/stockage.js`.
* Banc : `v2/test/test-banc-telephone-ios.js`.
* Outils (`outils/banc-telephone/`) : `pilote-memoire.js`, `echantillonneur-memoire.ps1`, `comparer-empreintes.js`, `lire-onnx.js`, `resumer-series.js`, `resumer-pics.js`, `ajouter-decodage-lot.py`.
* Mesures brutes : `mesures-ios/` (`av-*.json` avant, `ap-*.json` après, `vecs-*.bin` les empreintes, `serie-*.csv`, `ios-*.json`, `serie-complete.ps1`).
* Poste : le worktree contient des COPIES (jamais des jonctions) de `node_modules`, `.banc-local` et `verrou/photos` prises dans `v2-atelier` (tous ignorés par git) pour faire tourner les bancs.
