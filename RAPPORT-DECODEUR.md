# RAPPORT-DECODEUR — décoder et redimensionner dans NOTRE code (2026-11-08, branche `v2-decodeur`)

Demande de l'éditeur : entrée du modèle identique au bit sur iPhone, Android et ordinateur, sans le décodeur ni le canvas du navigateur.

## 1. Choix, et pourquoi pas un décodeur WASM

- `opencv.js` de l'extension : AUCUN décodeur (0 occurrence de `imdecode`, de libjpeg ou de libwebp dans le JS ni dans le .wasm de 2,8 Mo). Le réduit ne sait pas lire une image.
- Un décodeur WASM (libjpeg-turbo, libwebp : `@jsquash/*`) était la voie demandée. **Elle est fermée dans cet environnement** : aucune chaîne d'outils (emcc, clang, cmake, cargo : absents) et le hook du dépôt refuse tout accès au registre npm (`npm pack` refusé : « seuls test, run, start… »). Aucun contournement tenté.
- Choix : **JavaScript pur, entiers 32 bits seulement, code Rat-Market**, qui reproduit libjpeg-turbo (IDCT ISLOW, suréchantillonnage « fancy », YCC->RGB 16 bits) et libwebp (lecteur booléen, transformées, filtres de boucle, upsampling « fancy », YUV->RGB). Plus sûr qu'un WASM pour l'objectif : aucun SIMD, aucune dérivation d'un moteur à l'autre, la même arithmétique entière partout. Aucun `.wasm` de plus : la CSP (`script-src 'self' 'wasm-unsafe-eval'`) n'a pas à changer.
- Licences de CHAQUE fichier servi : **code Rat-Market** (aucune ligne copiée d'une bibliothèque ; comportements de libjpeg-turbo / libwebp / zlib réimplémentés d'après leur algorithme). `decodeur-webp-tables.mjs` : 5 tables numériques du format VP8 (quantification, probabilités) LUES dans le texte de la RFC 6386 (code de référence sous licence BSD, constantes du format) par `outils/decodeur/extraire-tables-vp8.js` (comptées : 128, 128, 900, 1056, 1056 valeurs), source `https://www.rfc-editor.org/rfc/rfc6386.txt` lue par la porte réseau le 2026-11-08 (sha256 du texte : `0463fb554a928673f3f843f77eb2a58b2616035b6ced35b2a606204c6c3df67f`). Ni AGPL ni licence non commerciale. Dépendances : aucune.

| fichier servi | octets | sha256 |
|---|---|---|
| decodeur.mjs | 11 664 | 54aacaf49e7819e7aeba13538a30a90ad63d8806e7872a8d449cfcb41b7f35e9 |
| decodeur-jpeg.mjs | 25 061 | a2929dbf1dae44f674bfb5fc846ed5cac56e1e7d1df6c5201f02168f98ac71e8 |
| decodeur-png.mjs | 11 899 | 469e57fe6bd2b124a4bc36df2e26c0b6bdeccbf7b19ca890b2d1de3fadeff076 |
| decodeur-webp.mjs | 32 232 | 48a9bc2d4f6a9ff2e6c5e99ea43fd4487896c566b071eddfe974257b3a09ff24 |
| decodeur-webp-tables.mjs | 12 692 | 4f5142cdf32ad69ec67bb6562d979b5b6b6aad3e48dd8993d65c56778ca6c1dd |

**Poids ajouté au téléchargement : 93,5 Ko (non compressé), ~25 Ko compressé. Aucun .wasm.** (sha256 mesurés sur les fichiers du disque, fins de ligne LF.)

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
