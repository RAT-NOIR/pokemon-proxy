# RAPPORT-DECODEUR — décoder et redimensionner dans NOTRE code (2026-11-08, branche `v2-decodeur`)

Demande de l'éditeur : entrée du modèle identique au bit sur iPhone, Android et ordinateur, sans le décodeur ni le canvas du navigateur.

## 1. Choix, et pourquoi pas un décodeur WASM

- `opencv.js` de l'extension : AUCUN décodeur (0 occurrence de `imdecode`, de libjpeg ou de libwebp dans le JS ni dans le .wasm de 2,8 Mo). Le réduit ne sait pas lire une image.
- Un décodeur WASM (libjpeg-turbo, libwebp : `@jsquash/*`) était la voie demandée. **Elle est fermée dans cet environnement** : aucune chaîne d'outils (emcc, clang, cmake, cargo : absents) et le hook du dépôt refuse tout accès au registre npm (`npm pack` refusé : « seuls test, run, start… »). Aucun contournement tenté.
- Choix : **JavaScript pur, entiers 32 bits seulement, code Rat-Market**, qui reproduit libjpeg-turbo (IDCT ISLOW, suréchantillonnage « fancy », YCC->RGB 16 bits) et libwebp (lecteur booléen, transformées, filtres de boucle, upsampling « fancy », YUV->RGB). Plus sûr qu'un WASM pour l'objectif : aucun SIMD, aucune dérivation d'un moteur à l'autre, la même arithmétique entière partout. Aucun `.wasm` de plus : la CSP (`script-src 'self' 'wasm-unsafe-eval'`) n'a pas à changer.
- Licences de CHAQUE fichier servi : **code Rat-Market** (aucune ligne copiée d'une bibliothèque ; comportements de libjpeg-turbo / libwebp / zlib réimplémentés d'après leur algorithme). `decodeur-webp-tables.mjs` : 5 tables numériques du format VP8 (quantification, probabilités) LUES dans le texte de la RFC 6386 (code de référence sous licence BSD, constantes du format) par `outils/decodeur/extraire-tables-vp8.js` (comptées : 128, 128, 900, 1056, 1056 valeurs), source `https://www.rfc-editor.org/rfc/rfc6386.txt` lue par la porte réseau le 2026-11-08 (sha256 du texte : `0463fb554a928673f3f843f77eb2a58b2616035b6ced35b2a606204c6c3df67f`). Ni AGPL ni licence non commerciale. Dépendances : aucune.

| fichier servi | octets | sha256 |
|---|---|---|
| decodeur.mjs | 13 924 | a08c8d566abe676be0ce1686e9fee85ef33cd675b622ec8b8d8db5a74f387132 |
| decodeur-jpeg.mjs | 29 497 | 8338d016d891ae9e4c3fa7e71d4c06d9c914869eebb4a662899ef31e17bc00ca |
| decodeur-png.mjs | 13 358 | 661bca9829519d3ecba9f5a5c8a3f1f0d8511b1ccb4474ffd88a0fd5e496564c |
| decodeur-webp.mjs | 34 268 | a0a671744c4e213ae96d733992e7e85c53588df5b3320cb5c6d68810f3148627 |
| decodeur-webp-tables.mjs | 13 166 | d34d39249a0020c1fdc1815f234514e8285de8dd92fa7ca9a5a4465c80be60b5 |

**Poids ajouté au téléchargement : 104,2 Ko (non compressé, après le tour T1), ~28 Ko compressé. Aucun .wasm.** (sha256 mesurés sur les fichiers du disque, fins de ligne LF.)

## 2. Contrat (`public/decodeur.mjs`)

```
decoder(octets, { orientation = 'exif' | 'aucune', orientationWebp = false, coteMax = 4096, pixelsMax = 12000000 })
  -> { rgb: Uint8Array (l*h*3, RGBRGB…), largeur, hauteur, format, orientationLue, orientationAppliquee, source: 'rm-decodeur-1' }
reduire640(rgb, largeur, hauteur) -> { rgb, largeur, hauteur }      // « inside » dans 640, dimensions640 de l'extension
redimRgb, dimensions640, lireDimensions, verifierDimensions, appliquerOrientation, ErreurDecodeur
```
- Formats : JPEG (séquentiel et progressif, 8 bits, gris ou YCbCr/RGB, 4:4:4, 4:2:2, 4:2:0, redémarrages), PNG (8 bits ; gris, RGB, palette 1-8 bits, gris+alpha, RGBA ; Adam7), WebP AVEC perte (VP8, image fixe ; l'alpha est ignoré).
- Aucun canvas, aucun profil couleur (ICC ignoré = `colorSpaceConversion: 'none'`), alpha ignoré (= Pillow `convert('RGB')`).
- Bornes dans l'en-tête AVANT tout décodage (copie de `entete.js` : 4 096 px de côté, 12 Mpx, formats jpeg/png/webp) ; les décodeurs les revérifient.
- Erreurs : `ErreurDecodeur` à code fermé `FORMAT | TROP_GRAND | DECODAGE | NON_SUPPORTE`. **Jamais un résultat approché.** Refusés : JPEG arithmétique/sans perte/12 bits/CMYK/4:4:0/4:1:1, PNG 16 bits et gris < 8 bits, WebP SANS perte (VP8L) et animé, fichier tronqué.
- **Orientation EXIF, mesurée dans Chrome 157 (headless) : `createImageBitmap` sans option applique l'EXIF d'un JPEG (8 orientations sur 8), PAS celui d'un WebP.** Le défaut du décodeur reproduit cette chaîne : JPEG tourné, WebP lu (`orientationLue`) mais non tourné ; `{ orientationWebp: true }` l'applique. `{ orientation: 'aucune' }` = pixels décodés (les références du lot). Safari non mesuré ici (à confirmer sur l'iPhone ; si Safari tourne les WebP, mettre `orientationWebp: true` pour tous : la chaîne unique reste identique entre appareils, c'est le but).
- Réduction 640 (`reduire640`) : bilinéaire à support élargi de Pillow, en entiers, passe horizontale PUIS verticale, toujours dans cet ordre. Pillow inverse parfois l'ordre (règle non documentée, mesurée sur 1 077 formes aléatoires : portraits h/w >= 2) : écart d'un niveau sur quelques pixels ; notre ordre fixe est ce qui garantit l'identité d'un appareil à l'autre. Proposée, pas branchée : l'entrée de la détection (aujourd'hui `imageSmoothingQuality = 'high'`) changerait de quelques niveaux de gris par rapport au canvas ; la quadrilatère de la détection n'a pas été remesurée sur le banc (hors périmètre de la mesure d'empreinte, qui n'en dépend pas).

## 3. Preuve au bit

Vérité : Pillow 13.0.0, libjpeg-turbo 3.2.0, libwebp 1.6.0, zlib-ng 1.3.1 (Image.open().convert('RGB').tobytes() -> sha256).

| épreuve | résultat |
|---|---|
| 30 JPEG du lot de la page de banc (`v2/banc-telephone/public/lot.json`) | **30/30 identiques à Pillow** (banc node) |
| 99 JPEG synthétiques de Pillow (tailles 1x1 à 257x129, 4:4:4/4:2:2/4:2:0, qualité 1 à 100, gris, progressif, optimisé, redémarrages, RGB brut, EXIF 1-8, ICC) | **99/99** |
| 24 PNG (RGB, gris, palette, RGBA, gris+alpha, optimisé niveau 9) | **24/24** |
| 42 WebP avec perte (q30/75/95, méthodes 4 et 6, gris, EXIF, alpha ; 1x1 à 100x75) | **42/42** |
| **1 500 visuels réels du catalogue** (`p8000-quant\images`, tirés au sort graine 20261108 HORS juges, banc eBay et calibration : 53 951 restants sur 57 878) | **1 500/1 500 identiques à Pillow, 0 refus** (873 Mpx, 51 ms par image en moyenne sous node) |
| réduction 640 (12 formes, hausse et baisse, 1x1 à 900x25) | 12/12 identiques à `resize(BILINEAR)` de Pillow H puis V |
| 4 mutations du décodeur (constante IDCT, arrondi IDCT, arrondi du suréchantillonnage, ...) | **ROUGE** : 30/30, 26/30, 30/30 cartes ; la mutation `FIX(1.40201)` ne change aucun entier (`FIX` arrondit) : sans effet, notée |
| comparateur sur un bit muté | ROUGE (octet 0, 12345, dernier : empreinte et premier écart trouvés) |

**Chrome headless 157 (PC, isolé, 4 fils), 30 cartes, modèle p8000 WASM** (`outils/decodeur/pilote-decodeur.js`) :
- octets RGB du décodeur == octets du navigateur : **30/30** ; tenseurs identiques bit à bit : **30/30** ; vecteurs (256 flottants) identiques bit à bit : **30/30** ; cos mini décodeur/navigateur = **1** ; cos mini contre la référence native = 0,99999988 (les deux chaînes) ;
- **node et Chrome calculent les MÊMES octets et le MÊME tenseur avec le décodeur : 30/30** (deux moteurs JavaScript différents, même résultat : la preuve de la portabilité qu'on peut faire sans téléphone) ;
- temps : décodeur 14,7 ms par carte (420x587) contre 8,4 ms pour le navigateur ; 12 Mpx sous node : JPEG 366 ms, WebP 1 162 ms, réduction 640 177-303 ms. Sur un téléphone, compter 3 à 5 fois plus (non mesuré).
- Note hors décodeur : `redimPIL` de l'extension (224 x 224) diffère de la référence PIL native de 1 niveau sur 124 valeurs de 1,8 M (0,007 %) ; c'est antérieur et indépendant du décodeur.

**Ce qui n'est PAS prouvé** : l'iPhone et l'Android eux-mêmes. Le décodeur étant en entiers 32 bits et sans API du navigateur, l'égalité node = Chrome est la preuve disponible ; l'égalité sur l'iPhone se constate en rejouant la page (voir 4). Les JPEG 4:4:0 et 4:1:1 (Pillow 13 ne sait pas en fabriquer) sont refusés plutôt que devinés.

## 4. Intégration (attend le message « `v2-banc-ios` poussée »)

Rien n'est branché : `app.js` et `verdict.mjs` intacts. À faire ensuite : `decoderCarte` appelle `decoder()` par défaut (`orientation: 'aucune'` pour le lot), le chemin navigateur reste mesuré à côté pour la ligne « décodeur du navigateur contre décodeur Rat-Market » ; `routes.js` sert déjà les cinq fichiers (liste fermée, `JS`, mêmes en-têtes). `v2/test/test-banc-telephone*.js` n'ont pas pu tourner ici (pas de `node_modules` dans ce worktree, aucune jonction autorisée) : le verrou du coordinateur les jouera ; ils parcourent `routes.FICHIERS` sans liste codée en dur.

## 5. Ce que l'extension et le site auront à adopter

1. Copier `decodeur*.mjs` à l'octet (comme `empreinte.js`) ; remplacer `createImageBitmap` + canvas + `getImageData` de `worker.js` (`redresserPhoto`, `decoderReference`) par `decoder(octets)` ; l'entête `verifierDimensions` devient celui du décodeur (mêmes bornes).
2. Entrée de la détection : `reduire640` à la place du canvas `imageSmoothingQuality = 'high'` — à remesurer sur le banc de détection avant de s'y fier (quadrilatère, taux de redressement).
3. Fixer UNE politique d'orientation pour tous les appareils (JPEG : EXIF appliqué ; WebP : non, comme Chrome, ou oui partout) — le décodeur la rend identique ; Safari à mesurer.
4. Les fichiers WebP sans perte et les JPEG exotiques lèvent `NON_SUPPORTE` : prévoir le repli sur le chemin navigateur (marqué « non identique au bit ») ou refuser l'image.
5. Temps : décoder une photo de 12 Mpx coûte plusieurs centaines de ms ; dans le Worker (comme aujourd'hui).

## 6. Fichiers

- `v2/banc-telephone/public/decodeur.mjs`, `decodeur-jpeg.mjs`, `decodeur-png.mjs`, `decodeur-webp.mjs`, `decodeur-webp-tables.mjs` ; `v2/banc-telephone/routes.js` (5 entrées).
- `v2/test/test-decodeur.js` (304 assertions, node pur, rouge vu avant le WebP : 49 échecs sans lui) ; `v2/test/fixtures-decodeur/pil-synthetique.json` (1,7 Mo), `pil-lot.json`.
- `outils/decodeur/` : `fabriquer-fixtures.py`, `references-lot.py`, `references-catalogue.py`, `comparer-catalogue.mjs`, `extraire-tables-vp8.js`, `pilote-decodeur.js`, `preuve-page.js`.
- Texte de la RFC 6386 lu : `C:\Users\Yung\rat-market-travail\catalogue\decodeur-rfc6386.txt` (hors dépôt).

## 7. TOUR DE CORRECTION T1 (2026-11-08, après RELECTURE-1 et RELECTURE-2)

Règle qui tranche tout : **ce que le décodeur accepte est comparé à Pillow au bit près, sinon il le refuse par un code. Rien d'accepté sans preuve.** Version du module : `rm-decodeur-2`. Banc `v2/test/test-decodeur.js` : **1 140 assertions, 0 échec** (304 avant).

### Robustesse
- **JPEG progressif, balayages** : plafond `balayagesMax` (64 par défaut, option), refus `TROP_GRAND` avant le décodage du balayage suivant. Maximum observé sur les **9 069 JPEG progressifs réels** du corpus : **14 balayages** (plus grand progressif : 146 700 px) : le plafond n'en refuse aucun. Banc : un progressif de Pillow suivi de 70 balayages « spectral seul » (Ah = Al = 0, cohérents, donc non arrêtés par la cohérence de progression) est refusé ; 40 empilés passent le plafond.
- **Pic mémoire** : plafond progressif `pixelsMaxProgressif` = 4 Mpx par défaut, vérifié **dans le SOF, avant toute allocation** (banc : un progressif qui annonce 4000 x 3000 est refusé sans qu'`arrayBuffers` ne bouge de 1 Mo ; le même format en séquentiel garde le plafond de 12 Mpx). **Côté page : un refus est un code, jamais un écran vide** ; la page (au branchement) passe au chemin navigateur et le marque « non identique au bit » dans la ligne de diagnostic, ou refuse l'image avec le code ; un progressif de plus de 4 Mpx est rare (aucun dans les 9 069 du corpus ; les photos de téléphone sont séquentielles).
- **`decoder()` n'enveloppe plus rien d'à moitié** : argument invalide (`decoder(-1)`, `null`, texte, objet, nombre, options absurdes) -> `entree-invalide` ; `RangeError` d'allocation -> `memoire` ; toute autre exception interne -> `DECODAGE`. Codes fermés : `FORMAT, TROP_GRAND, DECODAGE, NON_SUPPORTE, entree-invalide, memoire` (les deux nouveaux en minuscules, comme demandé). Banc **vu rouge** d'abord contre la version précédente (`RM_DECODEUR_PUB` rejoue le banc contre une autre version des modules) : `decoder(-1)` et 10 autres assertions rouges.
- Mineurs : tables de Huffman deflate **sur-souscrites ou incomplètes refusées comme zlib** (banc : deux flux fabriqués à la main) ; **adler32 vérifié** (PNG à somme fausse : refusé) ; IFD EXIF borné au segment ; JFIF exigé à 16 octets comme libjpeg ; assertion `|| true` remplacée par `=== 'DECODAGE'`.

### Justesse : ce qui était accepté sans preuve est maintenant prouvé ou refusé
- **JPEG progressif incomplet** (D3 et les 8 fichiers coupés puis fermés par EOI) : libjpeg-turbo lisse les blocs quand des coefficients n'ont pas reçu leur dernier balayage ; nous ne lissons pas, donc **refus `NON_SUPPORTE`** de tout progressif dont chaque coefficient de chaque composante n'est pas à Al = 0 à la fin (suivi `coef_bits` par composante). Banc : 4 fichiers coupés à des frontières de balayage, rouge puis vert. Un séquentiel qui ne couvre pas toutes ses composantes est refusé aussi, de même qu'un balayage séquentiel non entrelacé (non éprouvé), une progression incohérente (Ah différent du dernier Al), une approximation successive invalide.
- **Table de quantification** : verrouillée au **premier balayage** de la composante comme libjpeg (D9) : un JPEG dont la table est redéfinie entre deux balayages était décodé FAUX (2 fichiers rouges), il est maintenant identique à Pillow. Tables 16 bits **refusées** (D8) ; tout produit coefficient x quantificateur hors de 16 bits **refusé** (SIMD et C scalaire de libjpeg-turbo divergent).
- **Échantillonnages** : seuls 1x1 (gris), 4:4:4, 4:2:2, 4:2:0 (chromas 1x1) sont acceptés ; 4:4:0, 4:1:1 et mixtes -> `NON_SUPPORTE` (D11).
- **PNG Adam7 (D1) et palettes 1, 2, 4 bits (D2)** : Pillow ne les écrit pas mais **les lit** : `fabriquer-fixtures-t1.py` écrit à la main (zlib, filtres 0 à 4 forcés ou tirés) 173 fichiers, dont Adam7 sur 9 tailles non multiples de 8 (1x1, 2x2, 3x5, 5x3, 7x9, 9x17, 13x6, 37x29), RGB/gris/RGBA/gris+alpha/palette 1-2-4-8 bits, tRNS, palette plus courte que l'indice, des dégradés lisses pour les égalités du filtre Paeth, et la palette écrite par Pillow (`bits=`). Référence = Pillow qui LIT le fichier : **tous identiques**. Rien n'a été téléchargé.
- **WebP (D4)** : décompte sur les **57 878** en-têtes du catalogue (`outils/decodeur/compter-drapeaux-webp.mjs`) : filtre simple **0**, plusieurs partitions **0**, netteté > 0 **0**, deltas de filtre **0**, saut de macrobloc utilisé **0** ; segmentation avec données absolues et carte : **57 878** (l'encodeur de libwebp). Donc tous les drapeaux rares n'étaient exercés par AUCUN visuel réel : d'où un **générateur différentiel** (`generateur-webp.mjs`, banc seulement) : un encodeur booléen (RFC 6386 §7.3, remplissage de libvpx) et un ORACLE qui joue le lecteur dans `decoderTrame` (chaque décision tirée au hasard selon sa probabilité est écrite dans le flux), plus un écrivain d'en-têtes symétrique de `lireEntetesBruts` ; filtre simple, 1/2/4/8 partitions, netteté 0-7, deltas de filtre, segments absolus et relatifs, carte de segments, saut de macrobloc, mises à jour de probabilités, niveaux 0-63, quantificateurs delta, 1x1 à 120x90. **593 flux (400 aléatoires + 193 ciblés) lus par Pillow : 593/593 identiques**, 0 refus de Pillow (216 filtre simple, 241 multi-partitions, 306 netteté, 227 deltas, 132 segments absolus, 209 relatifs, 359 sauts, 291 mises à jour). Le banc rejoue ces 593 fichiers sans Python. **Trouvaille** : sans mise à jour des données de segment, libwebp prend des valeurs ABSOLUES et nulles (`ResetSegmentHeader`) alors que la RFC (dixie) les prend relatives : nous suivons libwebp (la mutation correspondante est tuée). Autre trouvaille du générateur : le lecteur de libwebp veut 8 bits d'avance sur le dernier symbole (l'encodeur RFC nu produisait des flux que Pillow refuse).
- Le décodeur refuse toujours : bits réservés du WebP (espace colorimétrique, écrêtage), VP8L, animation, trame non clé.

### Corpus réel (D5) et exclusions (RELECTURE-1 §5)
- **81 223 JPEG/PNG/WebP réels identiques à Pillow, 0 écart, 96 refus** (tous `NON_SUPPORTE PNG 16 bits`, des PNG nommés .jpg par Cardmarket) : 59 221 JPEG (dont 9 069 progressifs), 22 014 PNG, 84 WebP ; sources en lecture seule : `verrou/photos` (jeu fixe), `labo-embedding`, `CARDMARKET IMAGE` (une copie par empreinte de contenu : 6 316 doublons écartés). 6 ms par image. Et **1 500/1 500 visuels de catalogue**.
- **Exclusion par empreinte de contenu** (`outils/decodeur/exclusions.py`) : le juge (`sha256-juge.txt`, 180), le banc eBay (3 000 `sha256`), la calibration (1 500), et le contenu des 3 927 visuels de catalogue qui sont la réponse de ces lignes ou des juges (33 clés sans fichier sur le disque, comptées) : 8 606 empreintes. Le script **lève** si une liste est vide, si aucun visuel exclu n'est retrouvé, ou si l'échantillon tiré a une empreinte exclue ; les fichiers illisibles sont comptés (1 sur 87 636 candidats). Intersection mesurée : **0**.

### Mutations (D6/D7) : rejouables
`node outils/decodeur/mutations.mjs` (copie temporaire des modules, une ligne changée à la fois, 1 007 épreuves Pillow rejouées) : **48 mutations, 48 tuées, 0 vivante**. Dont la couleur (constantes 1,41 / 1,78 / 0,72 / 0,35 et arrondi ONE_HALF), l'IDCT, les suréchantillonnages, le progressif, le verrou de table, l'EXIF, les filtres PNG (Paeth, Average), Adam7, la palette, l'adler32, les filtres de boucle WebP (strong, simple, hev, netteté, deltas), les transformées, l'upsampling, la conversion YUV, les prédictions 4x4, la quantification, les segments, les partitions, la réduction. Ses survivantes initiales ont été traitées, pas ignorées : 3 mutations ÉQUIVALENTES remplacées (arrondi de FIX sans effet, égalité a/b de Paeth impossible, support élargi du filtre bilinéaire sans effet) et 4 vraies lacunes comblées par des jeux ciblés (netteté 4, seuil du filtre simple, contexte de saut, quantification Y2 AC : `pil-webp-differentiel-cible.json`).

### Non fait, avec la raison
- Chrome headless n'a pas été rejoué après le tour T1 (le verrou tourne jusqu'à environ 15:30 UTC) ; la preuve Chrome du § 3 date du décodeur `rm-decodeur-1`. À rejouer : `node outils/decodeur/pilote-decodeur.js`.
- Le banc `test-banc-telephone*.js` ne tourne toujours pas dans ce worktree (pas de `node_modules`).
- Safari/iPhone non mesuré.
