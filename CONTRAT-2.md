# CONTRAT 2 — la réponse commune à l'extension et au scanner

**Écrit par :** l'agent du serveur · **le :** 2026-10-06 · **pour :** l'agent de l'extension (`extension v2`), l'agent du site
(`rat-market-site`, `lib/scannerContrat.ts`). Les comptes et la facturation : **`PLAN-COMPTES.md`**.
**Ce document fait foi pour les formes.** Il reprend la demande de l'extension (`DEMANDE-SERVEUR-EXTENSION.md`, §1 à §6) et les
types déjà écrits par le site (`scannerContrat.ts`, `compteContrat.ts`) ; il dit oui, non ou « autrement » à chaque point, et pourquoi.
**Rien n'est en production** : ce contrat se construit sur la branche `comptes` (PLAN-COMPTES §9).

## 1. Les règles

1. **Additif.** Sans `contrat: 2` dans la requête, la réponse d'aujourd'hui, octet pour octet : la 1.0.x publiée continue de marcher.
2. **Trois issues par carte** : `identifiee` · `a-trancher` · `introuvable`. Jamais « sous réserve » en sortie.
3. **Listes fermées** pour tout ce qui pilote un comportement. Une valeur inconnue d'un client tombe sur un défaut **qui n'affirme rien**.
4. **Aucun score, aucune confiance chiffrée.** (Le `confiance: 0.97` de la première maquette du scanner disparaît.)
5. **`null` = « on ne sait pas »**, jamais zéro ni non.
6. **Une image servie vient de NOTRE R2** (vignette + grande), jamais de Cardmarket.

## 2. Les deux requêtes

| | extension | scanner |
|---|---|---|
| route | `POST /api/identifier` (`contrat: 2`) | `POST /api/scanner/analyses` (multipart) |
| identité | `Authorization: Bearer <jetonInstallation>` | cookie de session du compte |
| entrée | `imageUrls` (≤ 20), `title`, `description`, `prixVinted`, `devise`, `vintedEtat`, `vintedUrl`, `marche`, `langueInterface`, `versionExtension` | `image` (JPEG, PNG, WebP, HEIC ; 12 Mo au plus), `source` : `camera` · `fichier` · `collage` |
| prix | lu EN DIRECT par l'extension sur Cardmarket (`prixLive`) | **le guide du jour** (`prixGuide`) — PLAN-COMPTES §10.7 |

## 3. La réponse

```json
{
  "success": true,
  "contrat": 2,
  "scanId": "6702f…",
  "analyse": {
    "statut": "identifiee | a-trancher | lot | introuvable",
    "cartes": [ CarteAnalysee ],
    "lot": Lot | null,
    "regleVerdict": { "bonneAffaireSous": -30, "cherAuDela": 15, "versEUR": 1, "tauxDate": null },
    "raison": null
  },
  "facturation": Facturation,
  "solde": Solde
}
```

- `regleVerdict` (extension seulement ; `null` au scanner) : les seuils du verdict viennent du serveur. Hors euro, `versEUR` est le
  taux du jour et `tauxDate` sa date ; **`versEUR: null` ⇒ aucun verdict affiché**.
- `analyse.raison` : la raison d'un `introuvable` d'ensemble (aucune carte vue), sinon `null`.

### 3.1 `CarteAnalysee`

| champ | `identifiee` | `a-trancher` | `introuvable` |
|---|---|---|---|
| `index` | ✓ | ✓ | ✓ |
| `carte` (`Produit`) | ✓ | `null` | `null` |
| `candidats` (`Produit[]`) | `[]` | **2 ou 3, sans ordre de classement** | `[]` |
| `question` (`Question`) | `null` | ✓ | `null` |
| `raison` | `null` | `null` | `photo-illisible` · `pas-une-carte` · `hors-catalogue` · `plusieurs-cartes-non-separees` · `panne-lecture` |
| `etat` | `{ estime, confiance, defauts, declare, retenu }` — `confiance` : `haute` · `moyenne` · `basse` · `null` | idem | `null` |
| `prixLive` (extension) | `{ idProduct, langues, reverseHolo, etatVise }` | `null` | `null` |
| ~~`prixParEtat`~~ (scanner) | **n'existe pas** — décision de l'éditeur rapportée par le site le 2026-10-06 (après-midi, DEMANDE-SERVICE-PRODUITS.md) : « le scanner affiche les prix du guide Cardmarket (tendance, prix le plus bas, moyenne sur 30 jours), clairement libellés et datés ; le serveur ne va jamais chercher le prix par état chez Cardmarket ». Le seul prix du scanner est `prixGuide`, sur le `Produit` | — | — |
| `zone` | `{ photo, x, y, w, h }` en fractions, ou `null` | idem | idem |

### 3.2 `Produit`

`{ idProduct, nom, nomCardmarket, set: { slug, nom, code, tirage, annee, symbole }, numero, total, langue, variante, rarete, visuel,
visuelMention, prixGuide, liens: { cardmarket, fiche } }` — la forme de la demande de l'extension (§3.2), sans changement :

- `nom` : `nomFr` quand `langueInterface` est `fr` et qu'on l'a, sinon le nom Cardmarket. C'est le **produit tarifé** qui est nommé.
- `variante` : `normale` · `reverse` · `holo` · `premiere-edition` · `tampon` · `jumbo`.
- `rarete` : la rareté **de l'impression de ce numéro en base** (`cartes.impressions[].rarete`), `null` sinon — jamais devinée.
- `visuel` : le visuel **admis par les règles du site** (la garde de langue), sinon `null` ; un visuel de substitution n'y va
  qu'avec `visuelMention`.
- `liens.fiche` : `https://rat-market.fr/fr/p/<idProduct>` dès que le site sert cette redirection ; `null` avant.
- `prixGuide` : `{ tendance, de, moyenne30, date }` — le guide quotidien de Cardmarket (`trend`, `low`, `avg30`, et la date du
  GUIDE, `guideDu`, jamais celle de l'import) ; `null` si le produit n'y est pas. Sur la carte comme sur chaque candidat. **Le scanner
  les affiche libellés** (« tendance », « prix le plus bas », « moyenne 30 jours ») **et datés** ; jamais un prix par état.
- **`impressions` (ajout du 2026-10-06, demande de l'extension §12.1)** : `[{ idProduct, numero, total, rarete, variante, set, lien,
  prixGuide }]`, une par impression Cardmarket de la carte (le cas réel : 4 impressions, dont une à 950 €). `numero` est celui de la
  fiche Cardmarket confirmée par une seconde source ; `rarete` celle de la liste du set, `null` si elle est inconnue — jamais devinée.
  **Un lien n'est servi que si numéro ET rareté sont connus** : sinon `lien: null` (décision de l'éditeur : jamais de lien Cardmarket
  anonyme).
- **La langue des textes** : `nom`, `question.texte`, `question.aide`, `choix[].libelle` et `visuelMention` suivent `langueInterface`
  (`fr` ou `en`) ; une langue inconnue rend l'anglais (demande §12.5).

### 3.3 `Question`

`{ code, texte, aide, zone, choix: [{ id, libelle, idProduct }] }` — `code` : `reverse` · `symbole` · `numero` · `langue` ·
`premiere-edition` · `visuel`. **Chaque choix désigne exactement un candidat.** Chaque client a sa phrase par code (l'extension parle
des photos du vendeur, le scanner de la carte en main) ; `texte` est le repli. `zone` : la région des visuels où la différence se
voit, couvrant une marque d'au moins 25 px dans la source, sinon `null`.

### 3.4 `Lot`

`{ cartesVues, identifiees, aTrancher, introuvables, lectureLiveMax }`. `cartes` est rangé par **valeur décroissante du guide**.
`cartesVues` compte toutes les cartes repérées, introuvables comprises (PLAN-COMPTES §10.3).

### 3.5 `Facturation` et `Solde`

```json
"facturation": { "debite": 0, "reserve": 1, "rembourse": false, "motif": "question", "raisonNonRembourse": null }
"solde": { "total": 22, "essai": 0, "accueil": 17, "hebdo": 2, "achete": 3, "hebdoMax": 2, "prochainHebdo": "2026-10-12",
           "compte": { "lie": true, "emailMasque": "v•••@exemple.fr", "verifie": true }, "partage": true }
```

- `motif` : `affirmee` · `question` · `lot` · `introuvable` · `sans-prix` · `panne` · `plafond-jour` · `administrateur` (la table de
  PLAN-COMPTES §6). **`administrateur` remplace `code-maitre`** (décision de l'éditeur du 2026-10-06, DEMANDE §13.2) : le rôle tenu en
  base sur le compte de l'éditeur, `debite: 0`, écrit dans `mouvements` avec `delta: 0` ; le code maître disparaît de la v2.
- **`reserve` (ajout du serveur)** : le crédit tenu pour une question posée, débité seulement si l'on y répond. `total` le compte
  déjà en moins ; un abandon le rend.
- **`essai` (ajout du serveur)** : les analyses d'essai d'une installation non liée (3 au départ). `compte.verifie` aussi : un compte
  non vérifié n'a pas encore ses 25.

## 4. Les autres routes

| route | qui | corps → réponse |
|---|---|---|
| `POST /api/identifier/reponse` | extension | `{ scanId, carte, choix }` (`choix` : un `id`, `aucune`, `ne-sait-pas`) → `{ success, carte: CarteAnalysee, facturation, solde }` ; idempotente ; une réponse **différente** sur une carte tranchée → 409 |
| `POST /api/scanner/analyses/:id/reponse` | scanner | même corps, même réponse (le « choix » de la première maquette du site, aligné) |
| `POST /api/retour-live` | extension | ajoute `carte`, `verdictAffiche` (`bonne-affaire` · `correct` · `cher` · `aucun`) et `lectureRatee: { cause, definitive }` ; une lecture ratée **définitive** → `{ success, facturation: { motif: "sans-prix", rembourse: true }, solde }`, une fois par scan |
| `POST /api/solde` · `GET /api/compte` | les deux | `Solde` ; le compte, ses installations, son historique (`compteContrat.ts`) |
| `/api/installation`, `/api/compte/*` | — | PLAN-COMPTES §4 |
| `GET /ping` | les deux | ajoute `versionMinExtension` |

### 4.1 Le transport (décisions de l'éditeur du 2026-10-06, DEMANDE §13.1)

- **`api.rat-market.fr` par CORS**, sans permission nouvelle dans le manifeste : origine exacte
  `chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb` ; pré-requêtes `OPTIONS` (`Allow-Methods: GET, POST`, `Allow-Headers:
  Authorization, Content-Type, Idempotency-Key`, `Max-Age: 600`, sans `Allow-Credentials`) ; **les en-têtes CORS aussi sur les réponses
  d'erreur** (4xx, 5xx, limiteurs). Le CORS du site (`https://rat-market.fr`, avec cookie) reste séparé. `onrender.com` reste le secours
  pendant la bascule, sur la même base.
- **`Idempotency-Key`** (8 à 64 caractères `[A-Za-z0-9_-]`) sur tout POST qui débite (`/api/identifier`, `/api/identifier/reponse`,
  `/api/retour-live`) : rejouée, la requête rend la même réponse sans second débit (`mouvements.cleIdempotence`), par l'une ou l'autre
  adresse.
- **Le titre et la description** de l'annonce sont des données, jamais des consignes ; ils ne sont pas conservés au-delà de l'analyse,
  sauf les lignes versées au banc (90 jours).
- **Un prix lu par l'extension** à plus de 100 fois sous le guide du même produit (le défaut des milliers de la 1.0.5) est gardé avec
  `douteux: true` et n'entre dans aucun verdict. Mesuré le 2026-10-06 : aucun prix lu n'est encore en base.

## 5. Les erreurs

Les statuts HTTP ne changent pas ; le corps porte `{ success: false, erreur: { code, message }, facturation, solde? }`.
`code` : `JETON` (401) · `VERIFICATION` (403, ajout du site accepté) · `QUOTA` (429, avec `solde` et, pour un compte, `achat.url`) ·
`DEBIT` (429, `reessayerDans`) · `INDISPONIBLE` (503) · `IMAGE` · `IA` · `SERVEUR` · `VERSION` · `MARCHE`. Le scanner garde ses
refus de forme (413 `image-trop-lourde`, 415 `format-refuse`, 422 `aucune-carte`) **sous ces codes** : `IMAGE` porte alors
`erreur.detail` (`trop-lourde` · `format` · `aucune-carte`).

## 6. Ce qui diffère de la demande de l'extension, et pourquoi

| demande | réponse du serveur |
|---|---|
| la question « débitée à la réponse, 0 à l'émission » | **réservée à l'émission** (`debite: 0, reserve: 1`), débitée à la réponse, rendue à l'abandon — sinon on répondrait avec un solde vide (PLAN-COMPTES §6). L'utilisateur lit la même chose : rien n'est débité sans réponse. |
| `confiance` chiffrée (première maquette du scanner) | **retirée** (règle 4) |
| `prix.parEtat` au scanner | **non** — décision de l'éditeur du 2026-10-06 (rapportée par le site) : le guide, daté ; le prix par état reste l'avantage de l'extension, qui le lit dans le navigateur de l'utilisateur |
| un lot au scanner : sa valeur | la SOMME des tendances du guide des cartes chiffrées, avec sa couverture (« 2 cartes sur 3 ») ; une carte à trancher ou sans tendance n'est pas comptée |
| une carte identifiée absente du guide (`prixGuide: null`) | **remboursée**, `motif: "sans-prix"` — la règle de l'éditeur « un résultat sans aucun prix lisible est remboursé » vaut aux deux surfaces (à confirmer par l'éditeur) |
| `POST /scanner/analyses/:id/choix { index, idInterne }` | **`…/reponse { carte, choix }`**, la forme de l'extension : un seul contrat |
