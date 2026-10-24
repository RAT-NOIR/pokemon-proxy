# CONTRAT-API-V2 — l'API du serveur RatMarket, pour l'extension et pour le site

**Écrit par :** l'agent du serveur · **le :** 2026-10-08 · **pour :** l'agent de l'extension (`extension v2`) et l'agent du site (`rat-market-site`).
**Statut :** rien de tout cela n'est en production. L'API v2 ne répond que si le serveur est lancé avec `RM_API_V2=1` ; éteinte, le serveur répond comme aujourd'hui, octet pour octet.

Ce document accompagne **`v2/openapi/openapi.v2.json`** (OpenAPI 3.1, le schéma qui fait foi pour les formes) et **`v2/openapi/fausses/*.json`** (une fausse réponse par état, valeurs fictives). Les formes viennent de `CONTRAT-2.md` ; les comptes et la facturation de `PLAN-COMPTES.md`.

> **Les exemples ne mentent pas.** Chaque bloc `json` de ce document porte le nom du schéma contre lequel il est vérifié (`json schema=Nom`), et `v2/test/test-openapi-fausses.js` le valide à chaque lancement. Chaque liste fermée du schéma est comparée au code du serveur par `v2/test/test-openapi.js`. Si un exemple ou une liste change, un banc échoue.
> **Toutes les valeurs d'exemple sont fictives** : tout `idProduct` y vaut 9 000 000 ou plus, toute image est sous `/fictif/`, tout `scanId` commence par `fausse-`.

---

## 1. Les routes

Deux adresses pour le même serveur, même base, mêmes réponses : `https://api.rat-market.fr` (principal) et `https://pokemon-proxy-ratnoir666.onrender.com` (secours). **Le secours est une adresse du serveur, pas une origine CORS.**

| route | qui l'appelle | identité | `Idempotency-Key` | corps → réponse |
|---|---|---|---|---|
| `POST /api/installation` | extension | aucune | facultative (§5 : un rejeu rend la MÊME installation et le MÊME jeton) | `RequeteInstallation` → `201 ReponseInstallation` (le jeton n'est rendu qu'ICI) |
| `POST /api/identifier` (avec `contrat: 2`) | extension | Bearer | **oui** | `RequeteIdentifier` → `ReponseAnalyse` |
| `POST /api/identifier/reponse` | extension | Bearer | facultative | `RequeteReponse` → `ReponseQuestion` |
| `POST /api/retour-live` (avec Bearer) | extension | Bearer | facultative | `RequeteRetourLive` → `ReponseRetourLive` |
| `POST /api/solde` (avec Bearer) | extension | Bearer | non | rien → `ReponseSolde` |
| `POST /api/compte/lier` | extension | Bearer | facultative (§5 : un rejeu, même avec l'ANCIEN jeton, rend le MÊME nouveau jeton) | `RequeteLier` → `ReponseLier` |
| `POST /api/compte/delier` | extension | Bearer | non | rien → `ReponseSolde` |
| `POST /api/compte/inscription` | site | aucune (+ Turnstile) | non | `RequeteInscription` → `202 ReponseSimple` (toujours, que l'adresse existe ou non) |
| `POST /api/compte/verification` | site | aucune (jeton du lien) | non | `RequeteVerification` → `ReponseVerification` |
| `POST /api/compte/connexion` | site | aucune | non | `RequeteConnexion` → `ReponseConnexion` + cookie `rm_session` |
| `POST /api/compte/deconnexion` | site | cookie | non | rien → `ReponseSimple` |
| `POST /api/compte/mot-de-passe-oublie` | site | aucune | non | `RequeteMotDePasseOublie` → `202 ReponseSimple` (toujours) |
| `POST /api/compte/reinitialiser` | site | aucune (jeton du lien) | non | `RequeteReinitialisation` → `ReponseSimple` |
| `GET /api/abonnement` | site | cookie | non | → `ReponseAbonnement` (STRIPE-V2, derrière `V2_ABONNEMENTS` : voir `CONTRAT-STRIPE-V2.md`) |
| `POST /api/abonnement/checkout` | site | cookie | non | `RequeteCheckout` → `ReponseUrlPaiement` (voir `CONTRAT-STRIPE-V2.md`) |
| `POST /api/abonnement/fondateurs` | site | cookie | non | `RequeteFondateurs` → `ReponseOffreFondateurs` (l'offre Fondateurs, à qui présente le code de la page réservée ; mauvais code et offre fermée : la même réponse ; voir `CONTRAT-STRIPE-V2.md` §2 quater) |
| `POST /api/abonnement/portail` | site | cookie | non | rien → `ReponseUrlPaiement` (voir `CONTRAT-STRIPE-V2.md`) |
| `POST /api/compte/renvoyer-verification` | site | aucune | non | `RequeteRenvoiVerification` → `202 ReponseSimple` (toujours, que l'adresse existe, soit vérifiée ou non) |
| `POST /api/banc/correction` | extension | Bearer | non | `RequeteCorrectionBanc` → `ReponseSimple` (200 quoi qu'il arrive après les contrôles) |
| `DELETE /api/banc/contributions` | extension | Bearer | non | `RequeteEffacementBanc` → `ReponseEffacementBanc` |
| `POST /api/banc/etiquette` | extension | Bearer (compte ADMINISTRATEUR seulement) | facultative | `RequeteEtiquetteBanc` → `ReponseEtiquetteBanc` |
| `POST /api/banc/resoudre-cardmarket` | extension | Bearer (compte ADMINISTRATEUR seulement), derrière `V2_RESOLUTION_CARDMARKET=1` | aucune | `RequeteResoudreCardmarketBanc` → `ReponseResoudreCardmarketBanc` |
| `POST /api/banc/photo` | extension | Bearer (compte ADMINISTRATEUR seulement) | non (la même photo pour le même scan rend `deja`) | octets bruts JPEG/PNG/WebP + `?scanId=` → `ReponsePhotoBanc` (§1.7 ter) |
| `POST /api/photo` | extension | Bearer (compte ADMINISTRATEUR seulement), derrière `V2_PHOTOS_MULTIPLES=1` | non | octets bruts JPEG/PNG/WebP, sans paramètre (`?index=` ignoré) → `ReponsePhotoAvantScan` (§1.7 quater) |
| `POST /api/compte/code` | site | cookie | non | rien → `ReponseCodeLiaison` |
| `GET /api/compte` | site | cookie | non | rien → `ReponseCompte` |
| `DELETE /api/compte` | site | cookie | non | `RequeteSuppressionCompte` → `ReponseSimple` |
| `DELETE /api/compte/installations/{id}` | site | cookie | non | rien → `ReponseSimple` |
| `POST /api/scanner/analyses` *(conditionnelle, lot B9)* | site | cookie | non | multipart `RequeteScanner` → `ReponseAnalyse` |
| `POST /api/scanner/analyses/{id}/reponse` *(conditionnelle, lot B9)* | site | cookie | non | `RequeteReponse` → `ReponseQuestion` |
| `GET /api/collection` | site | cookie | non | rien → `ReponseMesSets` (§1.8) |
| `GET /api/collection/sets/{slug}` | site | cookie | non | rien → `ReponseCollectionSet` (§1.8) |
| `GET /api/modele-empreinte/{sha256}` | extension | aucune, derrière `V2_EMPREINTE_EXTENSION=1` | non | rien → `302` vers une adresse R2 présignée (§1.2 ter) |
| `PUT /api/collection/sets/{slug}/fiches/{cle}` | site | cookie, **compte vérifié** | non (idempotent par nature) | `RequeteCocher` → `ReponseCocher` (§1.8) |
| `GET /ping` | les deux | aucune | non | santé → `ReponsePing` ; v2 allumée, ajoute `versionMinExtension` et `capacites` (§1.9) |

**Sans `contrat: 2` dans le corps, `POST /api/identifier` répond comme aujourd'hui** (la 1.0.x continue de marcher). De même `POST /api/solde` et `POST /api/retour-live` sans `Authorization: Bearer` gardent leur forme d'aujourd'hui.
Les deux routes du scanner sont **conditionnelles** : elles ne seront livrées que si l'éditeur le confirme (lot B9). Le schéma les promet, marquées `x-conditionnel: B9`.

### 1.1 Créer une installation

```json schema=RequeteInstallation
{ "versionExtension": "2.0.0", "libelle": "Chrome · Windows" }
```

```json schema=ReponseInstallation
{
  "success": true,
  "installationId": "0123456789abcdef0123456789abcdef",
  "jetonInstallation": "FICTIF-jeton-0123456789abcdefghijklmnopqrst",
  "solde": {
    "total": 3,
    "essai": 3,
    "accueil": 0,
    "hebdo": 0,
    "achete": 0,
    "hebdoMax": 0,
    "prochainHebdo": null,
    "compte": {
      "lie": false,
      "emailMasque": null,
      "verifie": false
    },
    "partage": false,
    "abonnement": null
  },
  "heritage": "absent"
}
```

**`heritage`** (additif ; toujours présent dans un `201`) dit ce qu'est devenu le `userIdHerite` de la 1.0.x, sans silence :

| valeur | sens | ce que fait l'extension |
|---|---|---|
| `"repris"` | le portefeuille gratuit 1.0.x a été déplacé vers cette installation (jamais plus que la dotation d'une installation neuve) | effacer l'ancien `userId` |
| `"deja-migre"` | ce portefeuille a déjà été déplacé (vers cette installation-ci ou vers une autre) | effacer l'ancien `userId` : rien à reprendre |
| `"inconnu"` | aucun portefeuille 1.0.x ne répond à ce `userIdHerite` — ou la valeur envoyée est inutilisable (non-texte, vide, plus de 80 caractères) | effacer l'ancien `userId` |
| `"plafond-global"` | *valeur additive* : le plafond global des essais du jour est atteint ; la reprise est refusée, le portefeuille 1.0.x reste INTACT | garder l'ancien `userId` (rien n'est consommé) ; aucune route ne rejoue la reprise sur une installation existante aujourd'hui |
| `"absent"` | aucun `userIdHerite` n'a été envoyé (absent ou `null`) | — |

**Si l'héritage échoue** (exception côté serveur), l'installation qui vient d'être créée est **défaite** et la route répond `503 INDISPONIBLE` : aucune installation orpheline, aucun jeton perdu, le portefeuille 1.0.x est intact (l'héritage est transactionnel). Un nouvel essai crée UNE installation. Choix : défaire plutôt que rendre un `201` avec un héritage « en erreur » — l'extension n'a aucune route pour réessayer la reprise sur une installation existante, un `201` aurait donc perdu les crédits hérités pour de bon. Exception unique : si l'héritage avait VALIDÉ avant que sa réponse ne se perde (l'installation porte alors les crédits déplacés), l'installation est gardée et la réponse est `201` avec `heritage: "repris"`. L'essai raté compte dans le plafond de `2` installations par IP et par jour (comme tout `POST` admis par le limiteur).

### 1.2 Identifier une annonce

```json schema=RequeteIdentifier
{
  "contrat": 2,
  "imageUrls": ["https://images1.vinted.net/t/01_00000_fictif/f800/1.jpeg"],
  "title": "Lokhlass 30th Celebration 017/128",
  "description": "Carte en bon état, envoi soigné.",
  "prixVinted": 12.5,
  "devise": "EUR",
  "vintedEtat": "Bon état",
  "vintedUrl": "https://www.vinted.fr/items/0000000000-fictif",
  "marche": "vinted.fr",
  "langueInterface": "fr",
  "versionExtension": "2.0.0"
}
```

#### 1.2 bis — L'état d'une carte ne vient JAMAIS du vendeur (décision de l'utilisateur, 2026-10-18)

> **L'état déclaré par le vendeur est reçu et ignoré : il n'entre ni dans l'état retenu, ni dans le prix, ni dans le verdict.**

- `vintedEtat` (requête) est accepté (chaîne, 100 caractères au plus, sinon `400 ENTREE`) et journalisé comme une information. Il n'est lu par aucune décision : ni `etat.retenu`, ni `prixLive.etatVise`, ni aucun prix, ni aucun verdict, ni le classement, ni la question de départage.
- `etat.declare` (réponse) n'est que l'**écho** du texte reçu (`null` si absent). La clé reste servie parce que le contrat l'exige (E12, §7.3 bis) ; **ne pas l'afficher comme l'état de la carte**, et ne rien en déduire.
- `etat.retenu` ne vient **que de l'avis du modèle sur la photo**, avec la porte de confiance inchangée : l'avis (`etat.estime`) est retenu si `etat.confiance` est `haute` ou `moyenne`. Sinon `etat.retenu` vaut `null` et la chaîne fait ce qu'elle fait sans état. Avant cette date, `retenu` valait « le pire de l'avis du modèle et du texte du vendeur » : les analyses journalisées d'avant le 2026-10-18 portent l'ancienne règle.
- Cela vaut pour la route héritée `POST /api/identifier` **sans** `contrat: 2` (celle que l'extension 1.0.x appelle) : même règle, même réponse, qu'un `vintedEtat` soit absent, connu (« Neuf avec étiquette », « Très bon état », « Bon état », « Satisfaisant ») ou inconnu. Sa réponse garde les échos `etat.declareVendeur` et `etat.declareCardmarket` (transposition Cardmarket du texte du vendeur) : ce sont des échos d'information, jamais des entrées. Banc : `v2/test/test-etat-vendeur.js` (la réponse entière est identique, hors écho et identifiant de scan, pour six valeurs de `vintedEtat` et trois lectures du modèle).
- `POST /api/analyser` (héritée) : le texte du vendeur n'entrait déjà dans aucun prix ; ses échos `etatVinted` et `etatCardmarket` restent des échos.
- Il n'existe pas de route `/api/identifier-lot` : le lot est un crochet interne (`identifierLot`), non branché en production aujourd'hui ; quand il le sera, il transmet `vintedEtat` à la chaîne héritée, qui l'ignore.

**Et le TITRE de l'annonce ? (réponse à l'entrée « lot L3 » de `DEMANDE-SERVEUR-SITE.md`, mesurée sur le code du 2026-10-18.)** On ne peut **pas** écrire aujourd'hui que l'état n'est lu que sur les photos.
- Le titre (`title`, expurgé par l'extension) part dans **le même appel au modèle** que l'estimation de l'état : `getCardIdFromAI` (`index.js`) envoie un seul message qui porte le prompt, le titre (« Titre de l'annonce (contexte) : … », dernière ligne du prompt) et toutes les photos ; `etatEstime`, `etatConfiance` et `defautsVus` sortent de ce même appel.
- Le prompt **ne dit pas d'où vient l'état** : son paragraphe « ÉVALUATION DE L'ÉTAT » décrit un barème et parle de faces et de photos (« la PIRE face observée », « si aucune photo du verso n'est fournie »), mais aucune ligne n'interdit au modèle de tirer l'état du titre (« neuf », « excellent état »). Il interdit le titre ailleurs (« la langue se déduit du texte visible sur la carte, pas du titre »), jamais pour l'état.
- Le prompt n'a **pas** été modifié : le changer demande une mesure payante (appels au modèle). Tant qu'elle n'est pas faite, la formulation vraie est « l'état est estimé par le modèle, à partir des photos et du contexte de l'annonce », pas « à partir des photos seules ». La lecture de secours (modèle en panne) lit le titre pour le nom et le numéro seulement : elle rend `etatEstime: null`.
- L'extension v2 n'envoie aucun `vintedEtat` (constat du site). L'extension 1.0.x : la route héritée lit `req.body.vintedEtat` s'il est envoyé et le journalise ; ce dépôt ne contient pas le code de la 1.0.5, on ne peut donc pas dire d'ici si elle l'envoie. Sa conséquence est la même dans tous les cas : ignoré.

La réponse a **trois issues par carte**, jamais une quatrième. Une carte identifiée :

```json schema=ReponseAnalyse
{
  "success": true,
  "contrat": 2,
  "scanId": "fausse-identifiee-0001",
  "analyse": {
    "statut": "identifiee",
    "cartes": [
      {
        "index": 0,
        "statut": "identifiee",
        "carte": {
          "idProduct": 9000001,
          "nom": "Lokhlass",
          "nomCardmarket": "Lapras",
          "set": {
            "slug": "30th-Celebration",
            "nom": "30th Celebration",
            "code": "30C",
            "tirage": "intl",
            "annee": 2026,
            "symbole": null
          },
          "numero": "017",
          "total": "128",
          "langue": "EN",
          "variante": "normale",
          "rarete": "Common",
          "visuel": {
            "url": "https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/fictif/vignettes/9000001.webp",
            "w": 255,
            "h": 356,
            "grande": {
              "url": "https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/fictif/grandes/9000001.webp",
              "w": 600,
              "h": 825
            }
          },
          "visuelMention": null,
          "prixGuide": {
            "tendance": 15.2,
            "de": 12.4,
            "moyenne30": 14,
            "date": "2026-10-04"
          },
          "liens": {
            "cardmarket": "https://www.cardmarket.com/fr/Pokemon/Products?idProduct=9000001",
            "fiche": null
          },
          "impressions": []
        },
        "candidats": [],
        "question": null,
        "raison": null,
        "etat": {
          "estime": "EX",
          "confiance": "haute",
          "defauts": [
            "coins légèrement blanchis au verso"
          ],
          "declare": "Neuf sans étiquette",
          "retenu": "EX"
        },
        "prixLive": {
          "idProduct": 9000001,
          "langues": [
            1
          ],
          "reverseHolo": false,
          "etatVise": "EX"
        },
        "zone": null
      }
    ],
    "lot": null,
    "regleVerdict": {
      "bonneAffaireSous": -30,
      "cherAuDela": 15,
      "versEUR": 1,
      "tauxDate": null
    },
    "raison": null
  },
  "facturation": {
    "debite": 1,
    "reserve": 0,
    "rembourse": false,
    "motif": "affirmee",
    "raisonNonRembourse": null
  },
  "solde": {
    "total": 21,
    "essai": 0,
    "accueil": 16,
    "hebdo": 2,
    "achete": 3,
    "hebdoMax": 2,
    "prochainHebdo": "2026-10-12",
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": true
    },
    "partage": true,
    "abonnement": null
  },
  "offre": {
    "nom": "gratuit",
    "restant": 9,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

Une carte à trancher : 1 à 3 candidats **sans ordre de classement** (rangés par `idProduct`), une question dont **chaque choix désigne exactement un candidat**, et un crédit **réservé** (`debite: 0, reserve: 1`). Un candidat UNIQUE est une question de confirmation (§3.3, fausse `a-trancher-1.json`) ; ci-dessous, la forme à deux candidats :

```json schema=ReponseAnalyse
{
  "success": true,
  "contrat": 2,
  "scanId": "fausse-question-0002",
  "analyse": {
    "statut": "a-trancher",
    "cartes": [
      {
        "index": 0,
        "statut": "a-trancher",
        "carte": null,
        "candidats": [
          {
            "idProduct": 9000031,
            "nom": "Master Ball",
            "nomCardmarket": "Master Ball",
            "set": {
              "slug": "Base-Expansion-Pack",
              "nom": "Base Expansion Pack",
              "code": "BEP",
              "tirage": "jp",
              "annee": 1996,
              "symbole": null
            },
            "numero": null,
            "total": null,
            "langue": "JP",
            "variante": null,
            "rarete": null,
            "visuel": {
              "url": "https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/fictif/vignettes/9000031.webp",
              "w": 255,
              "h": 356,
              "grande": null
            },
            "visuelMention": null,
            "prixGuide": {
              "tendance": 3.2,
              "de": 2.6,
              "moyenne30": 3,
              "date": "2026-10-04"
            },
            "liens": {
              "cardmarket": null,
              "fiche": null
            },
            "impressions": []
          },
          {
            "idProduct": 9000032,
            "nom": "Master Ball",
            "nomCardmarket": "Master Ball",
            "set": {
              "slug": "Pokemon-VS",
              "nom": "Pokémon VS",
              "code": "VS",
              "tirage": "jp",
              "annee": 2001,
              "symbole": null
            },
            "numero": null,
            "total": null,
            "langue": "JP",
            "variante": null,
            "rarete": null,
            "visuel": {
              "url": "https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/fictif/vignettes/9000032.webp",
              "w": 255,
              "h": 356,
              "grande": null
            },
            "visuelMention": null,
            "prixGuide": {
              "tendance": 4.5,
              "de": 3.9,
              "moyenne30": 4.2,
              "date": "2026-10-04"
            },
            "liens": {
              "cardmarket": null,
              "fiche": null
            },
            "impressions": []
          }
        ],
        "question": {
          "code": "symbole",
          "texte": "Sur les photos, quel logo voyez-vous en bas à gauche de la carte ?",
          "aide": null,
          "zone": {
            "x": 0,
            "y": 0.8,
            "w": 0.34,
            "h": 0.2
          },
          "choix": [
            {
              "id": "a",
              "libelle": "Base Expansion Pack",
              "idProduct": 9000031
            },
            {
              "id": "b",
              "libelle": "Pokémon VS",
              "idProduct": 9000032
            }
          ]
        },
        "raison": null,
        "etat": {
          "estime": "EX",
          "confiance": "moyenne",
          "defauts": [],
          "declare": "Bon état",
          "retenu": "EX"
        },
        "prixLive": null,
        "zone": null
      }
    ],
    "lot": null,
    "regleVerdict": {
      "bonneAffaireSous": -30,
      "cherAuDela": 15,
      "versEUR": 1,
      "tauxDate": null
    },
    "raison": null
  },
  "facturation": {
    "debite": 0,
    "reserve": 1,
    "rembourse": false,
    "motif": "question",
    "raisonNonRembourse": null
  },
  "solde": {
    "total": 21,
    "essai": 0,
    "accueil": 16,
    "hebdo": 2,
    "achete": 3,
    "hebdoMax": 2,
    "prochainHebdo": "2026-10-12",
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": true
    },
    "partage": true,
    "abonnement": null
  },
  "offre": {
    "nom": "gratuit",
    "restant": 9,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

Une carte introuvable (remboursée, `motif: introuvable`) :

```json schema=ReponseAnalyse
{
  "success": true,
  "contrat": 2,
  "scanId": "fausse-introuvable-hors-catalogue",
  "analyse": {
    "statut": "introuvable",
    "cartes": [
      {
        "index": 0,
        "statut": "introuvable",
        "carte": null,
        "candidats": [],
        "question": null,
        "raison": "hors-catalogue",
        "etat": null,
        "prixLive": null,
        "zone": null
      }
    ],
    "lot": null,
    "regleVerdict": {
      "bonneAffaireSous": -30,
      "cherAuDela": 15,
      "versEUR": 1,
      "tauxDate": null
    },
    "raison": "hors-catalogue"
  },
  "facturation": {
    "debite": 0,
    "reserve": 0,
    "rembourse": true,
    "motif": "introuvable",
    "raisonNonRembourse": null
  },
  "solde": {
    "total": 3,
    "essai": 3,
    "accueil": 0,
    "hebdo": 0,
    "achete": 0,
    "hebdoMax": 0,
    "prochainHebdo": null,
    "compte": {
      "lie": false,
      "emailMasque": null,
      "verifie": false
    },
    "partage": false,
    "abonnement": null
  },
  "offre": {
    "nom": "sans-compte",
    "restant": 2,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

Les autres états sont publiés dans `v2/openapi/fausses/` (§9) : trois candidats, lot de 4 cartes, une fausse `introuvable` par raison, les pannes, les refus.

### 1.2 bis L'empreinte visuelle calculée par l'extension (lot MODELE-VISUEL-API, facultatif, ÉTEINT par défaut)

**Rien ne change tant que le serveur n'a pas `V2_EMPREINTE_EXTENSION=1`** : les champs ci-dessous ne sont pas lus (même une enveloppe monstrueuse), la réponse, le débit et le journal sont ceux d'avant, octet pour octet. Allumé, l'extension peut joindre à `POST /api/identifier` le vecteur d'UN essai par photo ; le serveur cherche les voisins dans l'index de l'archive et la règle visuelle (règle G) peut **promouvoir** une question en affirmation (mesure : 138 justes, 5 variantes, 0 faux, 144 sûrs sur 303 cartes). Le prétraitement exact, le format, la version du modèle et les temps mesurés sont dans `CONTRAT-EMPREINTE-EXTENSION.md`.

```json schema=RequeteIdentifier
{
  "contrat": 2,
  "imageUrls": ["https://images1.vinted.net/t/01_00000_fictif/f800/1.jpeg"],
  "title": "Lokhlass 30th Celebration 017/128",
  "prixVinted": 12.5,
  "devise": "EUR",
  "marche": "vinted.fr",
  "langueInterface": "fr",
  "versionExtension": "2.0.0",
  "empreintes": [
    {
      "photo": 0,
      "redressee": true,
      "vecteur": "+aEuLTShhy0Rq/wthaR+qUwujyCRqLmiKCrULB0utKr/LUCtQZWrLXmnVyoHrgyun6fAJy+uwiQoqVEpUiu/LSAoNytCqFAoDCipIVQlMBXfqoiqe6obqDiqjKaBLlYigKoXrsqs7qURrE2iQ59crqOs3SWcrSslMip1oe6e+J0MKaQm0qw7rSSuuq39na4oDiYrLJIo16SorMQq7q2sKnUqaKkhKuanNixvrlyudao0K22tOqHlKmIq9ymJKDKuaCDhrXsjCq77pymtVa1hLTYtu60prlOjOatvKPSi/6q5rI4aAyHpqoetGioapmatKS5wrIynOyrbqiStsCWbm1+tRatuLXUuXyq3rEOpPKpfqq0sryp/pFUufK2XKoUsf655LUioZ6xILTsq7a27K4ksVq5pLmKmBSvunmQqPKwjrTYtsC0JrLCQwqEPKSMqp6o4rJmo4SKnIX+prSxXLQcsO6lepuIt76QaLuuqMyZPLTctISQ+KjUfLK4tLB4tPKo+pHQtzyA4rsislydKqSMsyq2Wq1OpDymZLdwsH6x4LSOua57qrB0s+KvhLVYq7K2arJWna63apnOoaizcLBut/ihOKNgo9SyprJapuyzeqB4mTi1jqwws9C0orAwtaSS4rXwtSy0cGT6u/S3wqFQhXqxWI/EsdCqeqp2tCSw="
    }
  ],
  "modeleEmpreinte": {
    "id": "p8000-poids8s-1",
    "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

- **`empreintes`** : au plus **une entrée par photo** envoyée, 8 au plus. `photo` = l'index dans `imageUrls` ; `vecteur` = **256 nombres en float16 petit-boutiste, base64 standard avec bourrage, exactement 684 caractères** (512 octets) ; `redressee` = vrai si le vecteur est celui de la première carte redressée de la photo, faux (défaut) s'il est celui de la photo entière. **Un seul essai par photo** : la première carte redressée, sinon la photo entière. Le serveur ne juge qu'UN vecteur (celui de la photo de plus petit index).
- **`carte`** (dans la même entrée, facultatif pour le schéma, **nécessaire pour que le vecteur serve**) : la carte redressée dont le vecteur est tiré — un **JPEG 420 × 587 exactement**, qualité 0,92, sans métadonnées, **200 Ko au plus = 204 800 octets de JPEG, comptés après décodage du base64** (273 068 caractères base64) ; un EXIF éventuel est accepté, jamais conservé ; ce sont les pixels de la garde des zones. Absente, trop lourde, d'une autre taille, pas un JPEG décodable, ou jointe à l'entrée d'une autre photo : la règle visuelle se tait (empreinte.code: muette), la requête n'est pas refusée. Le serveur ne télécharge jamais la photo. **Taille du corps** : 8 photos ≈ 1,2 Mo mesuré, 2,14 Mo au maximum autorisé ; la limite de POST /api/identifier passe de 100 Ko à 2 400 Ko quand le serveur a V2_EMPREINTE_EXTENSION=1 (au-delà : 413, corps `{ success: false, error: "Requête illisible" }`), inchangée sinon ; le relèvement n'est accordé qu'avec un `Authorization: Bearer` et un `Content-Length`, et seulement si l'API v2 est montée (sans jeton : 413 sans lecture du corps au-delà de 100 Ko). `photo` vaut 0 à 7 (et reste inférieur au nombre d'`imageUrls`) ; une clé inconnue dans une entrée rejette cette entrée seulement (la règle visuelle se tait si c'est la photo jugée), pas l'enveloppe. Une carte forgée ne peut jamais produire un sûr que la lecture de la photo contredit (garde sur le produit désigné) et ne touche aucun autre utilisateur.
- **`modeleEmpreinte`** : l'`id` et le `sha256` reçus dans `analyse.regleVerdict.modeleEmpreinte` d'une réponse précédente (le serveur n'attend QU'UNE version). Une autre version, ou aucune : les vecteurs sont ignorés.
- **La vérification du serveur est écrite par ce qu'elle autorise** : 256 nombres finis, chacun de valeur absolue au plus 0,5 ; une norme L2 dans [0,999 ; 1,001] ; un meilleur cosinus à l'index d'au moins 0,30. Tout le reste : le vecteur ne sert pas, **la requête n'est JAMAIS refusée** (200, la chaîne décide, le débit est celui d'une analyse ordinaire) et la réponse le dit.
- **`empreinte`** (réponse, racine, facultatif) : présent SEULEMENT quand la requête portait `empreintes` ET que le serveur les accepte. `{ "utilisee": true, "code": null }` : le vecteur a été vérifié et la règle visuelle a rendu une décision (cela ne dit pas qu'elle a changé la réponse). `{ "utilisee": false, "code": … }` avec `code` parmi les valeurs fermées : `modele-inconnu` (une autre version du modèle, ou aucune annoncée), `invalide` (enveloppe ou vecteur refusé), `indisponible` (index absent, délai dépassé ou panne), `muette` (vecteur valide, la règle ne peut pas conclure — p. ex. la carte redressée est absente ou refusée).
- **`analyse.regleVerdict.modeleEmpreinte`** (facultatif) : `{ id, sha256, url, octets }` — la version attendue, l'adresse de téléchargement du modèle (**`null` tant que la publication sur R2 n'est pas faite** : l'extension n'envoie alors aucun vecteur) et sa taille. Servi dans `regleVerdict` plutôt que dans `/ping` : l'extension le lit déjà à chaque réponse, il est versionné avec le contrat, et `/ping` reste un sondage de santé sans configuration.
- **Ce que le vecteur peut changer** : une affirmation de la chaîne qui contredit la règle visuelle devient une **question** (jamais tranchée en silence) ; une **question** de la chaîne peut devenir une **affirmation** si la règle visuelle affirme et que la garde sur le produit désigné (`garde-contradiction`) laisse passer ; l'**introuvable** de la chaîne n'est jamais promu (le crédit est déjà rendu). Une promotion est facturée comme une affirmation (`debite: 1`), le crédit réservé par la question est réglé comme une réponse.
- **Isolement entre utilisateurs** : un résultat que le vecteur a changé n'entre jamais dans une donnée partagée (banc réel, statistiques) sans une lecture concordante ; il est marqué dans la ligne `analyses` (`empreinteExtension`, interne, jamais servi). Un vecteur forgé ne change le résultat d'aucun autre utilisateur (`v2/test/test-empreinte-isolement.js`).

### 1.2 ter Le fichier du modèle d'empreinte (lot INDEX-EMPREINTES, tour de correction 1 ; ÉTEINT avec `V2_EMPREINTE_EXTENSION`)

`GET /api/modele-empreinte/<sha256>` — sans `Authorization` — répond `302` avec `Location` : une adresse R2 PRÉSIGNÉE (lecture seule, **valable 600 s au plus** ; un nouvel appel en donne une autre) de l'objet du modèle (ONNX poids 8 bits, 118 202 501 octets). **Le modèle ne transite jamais par l'API** (Render n'inclut que 5 Go de bande passante par mois) et il n'existe aucun repli en flux. Le `<sha256>` est exactement celui de `V2_MODELE_EMPREINTE_SHA256` (le sha256 du fichier), sinon `404` ; drapeau éteint : la route n'existe pas (`404`). Avant de signer, l'API fait un `HEAD` de l'objet : métadonnée `sha256` et taille différentes de la configuration ⇒ `502`, rien n'est signé. La réponse `302` porte `Cache-Control: no-store` et aucun corps. Autres refus : `429` (plafond par IP `V2_MODELE_EMPREINTE_IP_HEURE`, `Retry-After`), `503` (R2 indisponible ou route non configurée, `Retry-After`). `Range` et la revalidation se font auprès de R2, pas de l'API. L'intégrité du fichier reçu se vérifie côté extension (`CONTRAT-EMPREINTE-EXTENSION.md` §0.1). Bancs : `test-modele-empreinte.js` ; OpenAPI `modeleEmpreinte`.
### 1.3 Répondre à une question

`choix` est l'`id` d'un choix (`a`, `b` ou `c`), `aucune` ou `ne-sait-pas`. Sur une question de confirmation (un seul candidat, §3.3), `a` est OUI et `aucune` est NON.

```json schema=RequeteReponse
{ "scanId": "fausse-question-0003", "carte": 0, "choix": "b" }
```

```json schema=ReponseQuestion
{
  "success": true,
  "carte": {
    "index": 0,
    "statut": "identifiee",
    "carte": {
      "idProduct": 9000012,
      "nom": "Évoli",
      "nomCardmarket": "Eevee",
      "set": {
        "slug": "Pokemon-Jungle",
        "nom": "Pokémon Jungle",
        "code": null,
        "tirage": "jp",
        "annee": 1997,
        "symbole": null
      },
      "numero": null,
      "total": null,
      "langue": "JP",
      "variante": null,
      "rarete": null,
      "visuel": {
        "url": "https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/fictif/vignettes/9000012.webp",
        "w": 255,
        "h": 356,
        "grande": null
      },
      "visuelMention": null,
      "prixGuide": {
        "tendance": 6.2,
        "de": 5,
        "moyenne30": 5.8,
        "date": "2026-10-04"
      },
      "liens": {
        "cardmarket": null,
        "fiche": null
      },
      "impressions": []
    },
    "candidats": [],
    "question": null,
    "raison": null,
    "etat": {
      "estime": "EX",
      "confiance": "moyenne",
      "defauts": [],
      "declare": "Bon état",
      "retenu": "EX"
    },
    "prixLive": {
      "idProduct": 9000012,
      "langues": [
        7
      ],
      "reverseHolo": false,
      "etatVise": "EX"
    },
    "zone": null
  },
  "facturation": {
    "debite": 1,
    "reserve": 0,
    "rembourse": false,
    "motif": "question",
    "raisonNonRembourse": null
  },
  "solde": {
    "total": 21,
    "essai": 0,
    "accueil": 16,
    "hebdo": 2,
    "achete": 3,
    "hebdoMax": 2,
    "prochainHebdo": "2026-10-12",
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": true
    },
    "partage": true,
    "abonnement": null
  },
  "offre": {
    "nom": "gratuit",
    "restant": 9,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

« `aucune` » rend la carte `introuvable`/`hors-catalogue` et rend le crédit ; « `ne-sait-pas` » laisse la carte à trancher (mêmes candidats, sans verdict) et rend le crédit ; sans réponse sous 24 h, le crédit est rendu par un balayage. Une réponse **différente** sur une carte déjà tranchée : `409 CONFLIT`.

### 1.4 Le retour du prix lu (extension)

```json schema=RequeteRetourLive
{ "scanId": "fausse-identifiee-0001", "carte": 0, "prixLive": 11.9, "prixLiveEtat": "EX", "prixLiveCodeLangue": 1, "originePrix": "grille", "verdictAffiche": "correct" }
```

`grilleLive` (facultatif) est la grille des prix lue sur la page, un prix par état : un objet `{ "NM": 14.2, "EX": 11.9 }` dont les clés sont les états de la liste (`MT`, `NM`, `EX`, `GD`, `LP`, `PL`, `PO`) et les valeurs des nombres strictement positifs, en euros. Le serveur met les clés en majuscules ; une entrée dont la clé n'est pas un des sept états, ou dont la valeur n'est pas strictement positive, est écartée sans refuser la requête. Le nombre d'états et le nombre de valeurs distinctes se déduisent de la grille.

```json schema=RequeteRetourLive
{ "scanId": "fausse-identifiee-0001", "carte": 0, "prixLive": 11.9, "prixLiveEtat": "EX", "prixLiveCodeLangue": 1, "originePrix": "grille", "grilleLive": { "NM": 14.2, "EX": 11.9, "GD": 9.5 }, "verdictAffiche": "correct" }
```

Une lecture ratée **définitive** dont la réponse **ne sert aucun `prixRepli`** (aucun prix n'est affiché) est remboursée une fois par scan, motif `sans-prix`, **dans la limite des déclarations du jour** (REPLI-QUOTA : avec un `prixRepli` servi, le scan n'est PAS remboursé, voir §2 bis (f) ; `facturation { debite: 1, rembourse: false, motif: "sans-prix", raisonNonRembourse: "prix-repli" }`, sans `declaration`) (sans compte 1, gratuit 3, Pro 30 ; compteur COMMUN avec `aucune`, `ne-sait-pas` et l'abandon, voir §3.1) ; au-delà, **aucun remboursement** : la réponse reste `200`, avec `facturation { debite: 1, rembourse: false, motif: "plafond-jour", raisonNonRembourse: "plafond-jour" }` ET `declaration { rendue: false, raison: "plafond-declarations", plafondJour }`. Une lecture ratée non définitive (défi Cloudflare) ne rembourse rien :

```json schema=RequeteRetourLive
{ "scanId": "fausse-identifiee-0001", "carte": 0, "verdictAffiche": "aucun", "lectureRatee": { "cause": "grille-vide", "definitive": true } }
```

```json schema=ReponseRetourLive
{
  "success": true,
  "facturation": {
    "debite": 0,
    "reserve": 0,
    "rembourse": true,
    "motif": "sans-prix",
    "raisonNonRembourse": null
  },
  "solde": {
    "total": 22,
    "essai": 0,
    "accueil": 17,
    "hebdo": 2,
    "achete": 3,
    "hebdoMax": 2,
    "prochainHebdo": "2026-10-12",
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": true
    },
    "partage": true,
    "abonnement": null
  },
  "offre": {
    "nom": "gratuit",
    "restant": 9,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

Un prix lu à plus de 100 fois sous le guide du même produit (le défaut des milliers de la 1.0.5) est gardé avec `douteux: true` et n'entre dans aucun verdict.

### 1.5 Le solde

```json schema=ReponseSolde
{
  "success": true,
  "solde": {
    "total": 3,
    "essai": 3,
    "accueil": 0,
    "hebdo": 0,
    "achete": 0,
    "hebdoMax": 0,
    "prochainHebdo": null,
    "compte": {
      "lie": false,
      "emailMasque": null,
      "verifie": false
    },
    "partage": false,
    "abonnement": null
  },
  "offre": {
    "nom": "sans-compte",
    "restant": 2,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

### 1.6 Les comptes (site)

```json schema=RequeteInscription
{ "email": "vous@exemple.fr", "turnstile": "jeton-turnstile-fictif" }
```

Le mot de passe ne se donne PAS à l'inscription (décision D6, voir §1.6 ter) : il se choisit au clic de confirmation.

```json schema=RequeteVerification
{ "jeton": "jeton-du-lien-recu-par-courriel", "motDePasse": "un mot de passe choisi à ce moment" }
```

```json schema=RequeteConnexion
{ "email": "vous@exemple.fr", "motDePasse": "un mot de passe long" }
```

**`compte.administrateur` (additif, ADMIN-DRAPEAU).** L'objet `compte` du Solde (`solde.compte`, présent dans toutes les réponses qui portent un Solde : `POST /api/solde`, `POST /api/compte/lier`, `POST /api/compte/delier`, `POST /api/identifier`, `GET /api/compte`…) et l'objet `compte` de `ReponseLier` portent un booléen optionnel `administrateur`. Il vaut `true` quand le porteur est un compte au rôle administrateur — le rôle est relu en base, par la MÊME règle que le motif `administrateur` de la `facturation` (`offre.estAdministrateur`) — et `false` sinon : compte ordinaire, installation sans compte lié (l'objet `compte` reste présent, `lie: false`). Il ne donne **aucun droit** : il ne fait que refléter un rôle déjà jugé côté serveur, et aucune route ne lit un drapeau venant du client (un corps ou un en-tête qui porte `administrateur: true` ne change rien). Une réponse qui ne le porte pas (anciennes fausses réponses) se lit comme `false`.

`POST /api/compte/code` rend un code de liaison à afficher dans la page du compte ; l'extension le saisit :

```json schema=ReponseCodeLiaison
{
  "success": true,
  "code": "A1B2C3",
  "expire": "2026-10-08T10:10:00.000Z"
}
```

```json schema=RequeteLier
{ "code": "A1B2C3" }
```

```json schema=ReponseLier
{
  "success": true,
  "compte": {
    "emailMasque": "v•••@exemple.fr",
    "verifie": true
  },
  "jetonInstallation": "FICTIF-renouvele-0123456789abcdefghijklmnop",
  "solde": {
    "total": 22,
    "essai": 0,
    "accueil": 17,
    "hebdo": 2,
    "achete": 3,
    "hebdoMax": 2,
    "prochainHebdo": "2026-10-12",
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": true
    },
    "partage": true,
    "abonnement": null
  },
  "offre": {
    "nom": "gratuit",
    "restant": 9,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

`GET /api/compte` rend le compte, son solde, ses installations et son historique (paginé par `suite`, curseur opaque) :

```json schema=ReponseCompte
{
  "success": true,
  "compte": {
    "email": "vous@exemple.fr",
    "verifie": true,
    "creeLe": "2026-10-01T08:00:00.000Z"
  },
  "solde": {
    "total": 22,
    "essai": 0,
    "accueil": 17,
    "hebdo": 2,
    "achete": 3,
    "hebdoMax": 2,
    "prochainHebdo": "2026-10-12",
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": true
    },
    "partage": true,
    "abonnement": null
  },
  "installations": [
    {
      "id": "0123456789abcdef0123456789abcdef",
      "libelle": "Chrome · Windows",
      "lieeLe": "2026-10-02T09:00:00.000Z",
      "derniereAnalyse": "2026-10-07T09:14:00.000Z"
    }
  ],
  "historique": {
    "lignes": [
      {
        "genre": "analyse",
        "le": "2026-10-07T09:14:00.000Z",
        "surface": "extension",
        "statut": "identifiee",
        "carte": {
          "nom": "Lokhlass",
          "set": "30th Celebration",
          "numero": "017"
        },
        "cartesVues": 1,
        "facturation": {
          "debite": 1,
          "reserve": 0,
          "rembourse": false,
          "motif": "affirmee",
          "raisonNonRembourse": null
        }
      },
      {
        "genre": "analyse",
        "le": "2026-10-06T18:02:00.000Z",
        "surface": "scanner",
        "statut": "introuvable",
        "carte": null,
        "cartesVues": 1,
        "facturation": {
          "debite": 0,
          "reserve": 0,
          "rembourse": true,
          "motif": "introuvable",
          "raisonNonRembourse": null
        }
      },
      {
        "genre": "credits",
        "le": "2026-10-02T09:30:00.000Z",
        "motif": "accueil",
        "credits": 25
      }
    ],
    "suite": null
  }
}
```

**Les lignes de l'historique** (tour 1 de B7b.1 : le serveur sert exactement cette forme) : une ligne `analyse` porte toujours `surface`, `statut` et une `facturation` réelle (jamais `null`) ; `carte` est `{ nom, set, numero }` pour une analyse identifiée, `null` sinon (lot compris) ; `cartesVues` est le nombre de cartes lues. Une ligne `credits` porte `motif` ∈ `accueil` · `hebdo` · `achat` (le motif de **sa poche** ; une migration prend celui de sa poche d'origine) et `credits`. **Deux sortes de lignes sont omises de l'historique, jamais inventées** : une analyse ancienne sans facturation complète ou sans surface, et un crédit d'une poche que le contrat ne nomme pas (`abonnement`, `essai`). Le contrat n'a pas de motif pour ces crédits-là ; c'est dit au §7.4 (X1). Une ligne dont la `raisonNonRembourse` n'est pas dans la liste fermée est omise de la même façon. **La pagination ne perd jamais une ligne servie** : la page se remplit de lignes servies en relisant plus loin tant que les sources ne sont pas épuisées (une longue série de lignes omises ne l'arrête pas), et `suite` n'est nul que lorsqu'il ne reste plus rien à servir. **Le paramètre de requête `suite`** (le curseur opaque de la page précédente) est déclaré ; un curseur illisible, falsifié, vide, répété ou de plus de 200 caractères rend `400 ENTREE` (detail `suite`) — jamais `503`, jamais la première page en silence.

### 1.6 bis Une adresse inscrite par un tiers : compte inactif, un courriel par 24 h, purge à 48 h (audit O3)

Décision du testeur : « le compte reste inactif jusqu'au clic de confirmation. Un seul courriel de confirmation par adresse et par 24 h. Les comptes non confirmés sont purgés après 48 h, et l'adresse redevient libre. La réponse est identique à l'octet, que l'adresse existe ou non. »

- **Inactif jusqu'au clic.** Un compte non confirmé n'a **aucun porteur** : `POST /api/compte/connexion` le refuse avec la réponse **exacte** d'un mauvais mot de passe (`401 IDENTIFIANTS`, même corps, mêmes en-têtes, aucun cookie) **après le même calcul de hachage** — ni le statut, ni le corps, ni l'ordre de grandeur du temps ne disent que l'adresse existe. Aucune liaison d'installation, aucun crédit, aucune route qui exige un compte ne lui répond (`401 SESSION` / installation seule). Le clic (`POST /api/compte/verification`) est l'unique activation par le site ; le lien de réinitialisation du mot de passe en est la seconde (il prouve la boîte et fait CHOISIR le mot de passe à son titulaire). Les 25 offertes sont accordées comme avant (une fois par compte, une fois par adresse).
- **Un courriel de confirmation par adresse et par 24 h**, `inscription` et `renvoyer-verification` **confondus**. Compteur persistant (collection `limites`, un document par empreinte d'adresse, fenêtre glissante de 24 h, prise atomique) : il survit à un redémarrage. La limite du mot de passe oublié (3 par adresse et par heure) est une **autre** limite (même clé de boîte, compteur distinct) et ne change pas de valeur. **Les deux limites se comptent par BOÎTE, pas par compte :** clé = minuscules, suffixe `+…` de la partie locale retiré pour tout domaine, points retirés pour Gmail ; `victime+a@outlook.com` et `victime+b@outlook.com` restent deux comptes (la clé du compte ne change pas) mais partagent un seul courriel par 24 h. **L'adresse est validée par ce qu'on sait normaliser :** un domaine terminé par un point, à étiquette vide, à tiret de bordure ou à extension d'une lettre est refusé comme toute adresse invalide (`422 ENTREE`, `adresse-invalide`). **Deux règles de plus sur la clé de boîte (et du compte)** : (1) **le domaine se compare en Punycode** (conversion en ASCII, après la normalisation NFKC, les minuscules et le découpage en partie locale et domaine, avant la liste des domaines admis et la clé) : `bücher.example` et `xn--bcher-kva.example` donnent la MÊME clé ; un domaine que la conversion ne sait pas rendre est refusé ; (2) **une partie locale qui contient, à l'intérieur, un caractère invisible, de format ou d'espacement** (catégories Unicode Cc, Cf, Zs, Zl, Zp : par exemple U+200B, espace de largeur nulle) est refusée comme toute adresse invalide (elle donnerait une autre clé pour la même boîte). Les blancs et U+FEFF **en bordure de l'adresse** sont retirés avant (`trim` / NFKC), sans refus.
- **Réponse identique à l'octet.** `POST /api/compte/inscription` et `POST /api/compte/renvoyer-verification` rendent le **même** `202 { success: true }` (statut, en-têtes à l'exception de la date, corps) que l'adresse soit neuve, confirmée, en attente (courriel de moins ou de plus de 24 h) ou purgée. Le travail (base, courriel) est détaché, après la réponse ; l'inscription ne hache plus rien (D6).
- **Une adresse déjà inscrite et non confirmée garde sa place** jusqu'à la purge : une nouvelle inscription ne change rien (le compte n'a de toute façon pas de mot de passe avant le clic, §1.6 ter) ; un courriel (vers le premier inscrit) ne part que si la limite ci-dessus le permet.
- **Purge à 48 h.** Un compte non confirmé de **48 heures ou plus** est supprimé avec ses liens de courriel ; l'adresse redevient libre (une nouvelle inscription marche, et sa confirmation reçoit les 25 offertes : un compte jamais confirmé n'a jamais reçu d'offertes, l'empreinte d'octroi ne l'en prive pas). La purge est un balayage (une passe différée de 60 s au démarrage du serveur, puis toutes les heures : un compte vit au plus 49 h) qui ne supprime que ce qu'elle peut prouver vierge (`verifie: false`, 0 crédit, 0 abonnement, ni installation ni mouvement). Entre 48 h et le prochain balayage le compte est **déjà inactif** : son lien de confirmation et son lien de réinitialisation sont refusés, et une nouvelle inscription le remplace. *Nuance :* le compteur d'un courriel de confirmation (24 h) survit à la purge — une adresse libérée à 49 h dont le dernier courriel date de 47 h ne reçoit un nouveau courriel qu'à 71 h (le compte neuf vit 48 h, ce courriel reste utilisable).
- **Le texte du courriel de confirmation** dit que celui qui n'est pas à l'origine de l'inscription peut l'ignorer, et que le compte sera supprimé sous 48 heures.
- **FERMÉ par la décision D6 (voir §1.6 ter)** : le cas où la victime cliquait le lien d'une inscription faite par un tiers avec SON mot de passe n'existe plus — l'inscription ne prend aucun mot de passe, il est choisi au clic. **La réinitialisation (compte dont le mot de passe a fuité par ailleurs) ferme tout accès au compte, y compris pour une requête déjà en vol :** elle incrémente d'abord la **génération** du compte (`comptes.generation`, `$inc` atomique, dans la même écriture que le nouveau mot de passe), puis supprime ses sessions, DÉLIE les installations liées au compte et supprime ses codes de liaison vivants. Une session, un code de liaison et une installation liée portent la génération lue à leur création ; un porteur n'est résolu que si elle est ÉGALE à celle du compte (champ absent : jamais égal) — session : `401` ; installation liée : traitée comme anonyme ; un code d'une génération révolue ne lie rien (`404 CODE_INVALIDE`) même vivant. **L'installation déliée** (celle du tiers, comme celle de la victime : l'extension se relie par un nouveau code, créé depuis une session de site, donc après une nouvelle connexion) n'a plus aucun accès au compte — ni solde, ni crédits, ni mouvements, ni Ma collection, ni courriel — et retombe exactement sur les droits d'une installation anonyme, sans rien hériter : elle garde SA poche telle qu'elle est (vidée par la fusion à la liaison) et ne reçoit aucun essai neuf (les 3 essais d'une installation naissent une fois, à sa création). Prouvé par `test-comptes-delie.js`, `test-comptes-generation.js`.
- **La liaison fusionne réellement** (tour 2, I-B) : à la liaison, les crédits achetés de l'installation passent au compte et ses essais tombent à 0 (`fusionnerALaLiaison({ compteId, installationId })`) ; un retour `ok !== true` (ou une exception) DÉFAIT la liaison (`503 INDISPONIBLE`, le client garde son ancien jeton, le code est rendu). Avant ce tour la fusion était appelée avec une mauvaise forme et ne tournait jamais.

### 1.6 ter CHANGEMENT POUR LE SITE (décision D6) : le mot de passe se choisit AU CLIC de confirmation

**Pourquoi.** Avant D6, un tiers pouvait inscrire l'adresse d'une victime avec SON mot de passe ; la victime qui cliquait le lien activait un compte dont le tiers connaissait le secret. Désormais un compte non confirmé **n'a aucun mot de passe** (rien à voler, rien à pré-poser).

**Ce que le site doit changer (quatre pages : l'inscription, la vérification, la demande de mot de passe oublié, la réinitialisation) :**
1. **Formulaire d'inscription** : retirer le champ mot de passe. Corps : `{ email, turnstile }`. Si le site envoie encore `motDePasse` (même vide), le serveur répond **`422 ENTREE`, `detail: "mot-de-passe-non-attendu"`** et ne crée rien (il ne lit, ne hache et ne stocke jamais ce champ). Succès inchangé : `202 { success: true }`, identique à l'octet quelle que soit l'adresse.
2. **Page `/fr/verification?jeton=…`** : afficher un formulaire « choisissez votre mot de passe » et **ne rien envoyer à l'ouverture de la page** (un aperçu de lien ne doit pas consommer le jeton). Le formulaire attendu : **un seul champ** `motDePasse` (type mot de passe, masqué, 10 à 200 caractères, différent de l'adresse du compte, pas seulement des espaces ; les espaces comptent et ne sont jamais rognés), un bouton de soumission, et la zone d'affichage du motif `detail` d'un refus 422. Le jeton est lu dans l'URL (`?jeton=`), retiré de l'URL, gardé en mémoire de la page. À la soumission : `POST /api/compte/verification` avec **`{ jeton, motDePasse }`** (`Origin` exacte + `X-Rat-Market`, comme avant) ; réponses : tableau ci-dessous.
3. **Page de demande de mot de passe oublié** (nouvelle ; c'est l'issue de repli des lignes 404 et 410 ci-dessous, elle doit exister avant tout renvoi vers elle) : un champ adresse, un bouton ; `POST /api/compte/mot-de-passe-oublie { email }` (`Origin` exacte + `X-Rat-Market`) rend **toujours** `202 { success: true }` (la réponse ne dit rien de l'existence de l'adresse : afficher « si cette adresse a un compte, un lien vient de partir »). Un compte non confirmé non périmé reçoit aussi ce lien (c'est la seconde voie d'activation, §1.6 bis). Limites : 3 courriels par boîte et par heure (silencieux), `429 DEBIT` par adresse IP (avec `Retry-After`), `403 ORIGINE`, `503`.
4. **Page `/fr/reinitialisation?jeton=…`** (nouvelle) : **même formulaire et mêmes protections du jeton que la page de vérification** (voir ci-dessous : `Referrer-Policy: no-referrer`, aucune ressource tierce, jeton retiré de l'URL dès sa lecture, corps jamais journalisé, bouton désactivé après la première soumission, rien d'envoyé à l'ouverture). Un champ `motDePasse` (mêmes règles : 10 à 200 caractères, différent de l'adresse). `POST /api/compte/reinitialiser { jeton, motDePasse }` (`Origin` exacte + `X-Rat-Market`) : `200 { success: true }` (mot de passe changé, **toutes les sessions et liaisons du compte sont fermées** : renvoyer vers la connexion, aucune session n'est ouverte ; un compte non confirmé est activé par ce chemin et reçoit ses 25 offertes une fois) ; `422 MOT_DE_PASSE_FAIBLE` avec `detail` ∈ `trop-court` · `trop-long` · `egal-a-l-adresse` (lien non consommé, réessayer ; `espaces-seulement` n'est refusé qu'à la vérification) ; `400 ENTREE` (`motDePasse` absent ou non texte) ; `404 CODE_INVALIDE` (lien inconnu, déjà utilisé, ou compte périmé) ; `410 CODE_EXPIRE` (lien échu, 24 h : proposer une nouvelle demande de mot de passe oublié) ; `403` · `429` · `503` inchangés.

| réponse | quand | à afficher |
|---|---|---|
| `200 { success: true, verifie: true }` | lien vivant + mot de passe accepté : compte activé avec CE mot de passe, 25 offertes (une fois par adresse) | « compte activé », puis page de connexion (aucune session n'est ouverte par la confirmation) |
| `422 MOT_DE_PASSE_FAIBLE`, `detail` ∈ `trop-court` · `trop-long` · `egal-a-l-adresse` · `espaces-seulement` | politique refusée (moins de 10 ou plus de 200 caractères, identique à l'adresse, ou **fait seulement d'espaces, de tabulations ou de blancs Unicode**) ; **le lien n'est pas consommé** | le motif, et le formulaire reste ouvert (réessayer avec le même lien) |
| `400 ENTREE` | `motDePasse` absent ou non texte | erreur de formulaire (ne devrait pas arriver) |
| `404 CODE_INVALIDE` | lien inconnu, **déjà utilisé** (y compris par un double clic), d'un compte **déjà vérifié**, d'un compte supprimé ou périmé (48 h) | « ce lien a déjà servi ou n'est plus valable. **Si vous avez déjà confirmé votre adresse : connectez-vous** ; si vous avez oublié votre mot de passe : **mot de passe oublié**. » Ne PAS proposer « renvoi » ou « réinscription » comme issue : pour un compte actif ils répondent 202 sans rien envoyer (impasse), et le renvoi est limité à un courriel par adresse et par 24 h. |
| `410 CODE_EXPIRE` | lien échu (24 h), jamais utilisé | « lien expiré » : proposer le renvoi (`renvoyer-verification`), et, si le renvoi tarde (un courriel par 24 h), **mot de passe oublié** |
| `403 ORIGINE` · `429 DEBIT` · `503 INDISPONIBLE` | inchangés | inchangés |

**Règles que le site ne doit pas contourner.** Le lien est à usage unique : en cas de clics simultanés un seul gagne (les autres reçoivent `404`) et c'est SON mot de passe qui est posé. Le lien d'un compte déjà vérifié ne change jamais son mot de passe (`404`) : un second lien de renvoi, cliqué après la confirmation, est refusé. Un mot de passe oublié passe par la réinitialisation, inchangée. Le renvoi (`renvoyer-verification`), la limite d'un courriel par adresse et par 24 h, la purge à 48 h et les limites par IP sont **inchangés**.

**Comptes créés avant D6** (non confirmés, avec le hachage du mot de passe d'un tiers) : leur lien de confirmation, ouvert avec un mot de passe, **remplace** ce hachage par celui du clic ; tant qu'ils ne sont pas confirmés ils ne peuvent pas se connecter. Un lien déjà envoyé avant D6 fonctionne donc, à condition que la page envoie le mot de passe. Les comptes déjà confirmés ne changent pas.

**Le jeton du lien vaut désormais « choisir le mot de passe de ce compte » : la page le protège (obligations du site).** Avant D6, un lien divulgué ne donnait rien (le mot de passe existait déjà). Maintenant, qui lit le lien AVANT la victime choisit le mot de passe et prend le compte (neuf, 25 offertes, tout ce que la victime y déposera). La page `/fr/verification` **et la page `/fr/reinitialisation`** (son lien porte la même capacité : choisir le mot de passe du compte) doivent donc :
- être servie avec l'en-tête **`Referrer-Policy: no-referrer`** ;
- ne charger **AUCUNE ressource tierce** (ni police, ni pixel, ni script d'analytique, ni image distante) : un tiers recevrait l'URL, jeton compris, dans le `Referer` ;
- **retirer le jeton de l'URL dès sa lecture** (`history.replaceState`) et le garder en mémoire de la page seulement ;
- ne **jamais journaliser le corps** de la requête de confirmation (ni le mot de passe, ni le jeton), ni côté serveur du site, ni dans un outil d'erreurs ou d'analytique ;
- désactiver le bouton dès la première soumission : la première réponse fait foi (deux soumissions simultanées donnent un 200 et un 404 ; l'écran ne doit pas afficher l'erreur après le succès).

**Ordre de mise en service : l'API portant D6 AVANT le site qui l'appelle.** Le site ne passe à la nouvelle forme (inscription sans mot de passe, vérification avec mot de passe) qu'après avoir CONSTATÉ en ligne que l'API D6 répond (une requête de vérification sans `motDePasse` doit rendre `400`, et non `404`).
- *Un NOUVEAU site sur une ANCIENNE API (le cas dangereux, silencieux)* : l'ancienne API ignore le `motDePasse` de la vérification et active le compte avec le hachage du tiers ; la victime croit avoir choisi son mot de passe et le tiers peut se connecter. C'est exactement le trou que D6 ferme, rouvert sans aucune erreur visible.
- *Un ANCIEN site sur la NOUVELLE API (le cas sûr, bruyant)* : l'inscription répond `422 mot-de-passe-non-attendu` et l'ancienne page de confirmation (sans mot de passe) répond `400 ENTREE` : rien ne s'active, tout échoue visiblement.
- Interrupteur du site (`API_V2_BRANCHEE`) : seulement après DÉPLOIEMENT des quatre pages — vérification, **demande de mot de passe oublié et `/fr/reinitialisation`** (les lignes 404 et 410 renvoient le client vers elles : sans elles, l'impasse que ces lignes voulaient supprimer reste entière) — chacune avec la protection du jeton ci-dessus (les deux pages à lien). Un lien de courriel vers une page absente laisse les comptes jamais confirmés (purge à 48 h). En TEST, `V2_URL_VERIFICATION` et `V2_URL_REINIT` doivent pointer vers une page de test, jamais le site de production.

### 1.7 Le banc réel, et le renvoi du lien de vérification

- `POST /api/compte/renvoyer-verification { email }` (site : `Origin` exacte + `X-Rat-Market`) rend **toujours** `202 { success: true }` : la réponse ne dépend ni de l'existence de l'adresse ni de son état. Un courriel par adresse et par 24 h, inscription comprise (§1.6 bis). `403 ORIGINE`, `429 DEBIT` (par adresse IP, avec `Retry-After`), `503`.
- `POST /api/banc/correction { scanId, carte?, idProduct, consentementBanc? }` (Bearer) rend `200 { success: true }` quand les contrôles passent — **elle ne dit pas** si une image a été conservée. `400 ENTREE`, `401 JETON`, `404 CODE_INVALIDE` (scan inconnu ou d'un autre porteur), `503`.
- `DELETE /api/banc/contributions { jeton }` (Bearer) efface tout de suite toutes les images versées sous ce jeton de contribution :

```json schema=ReponseEffacementBanc
{
  "success": true,
  "supprimees": 3,
  "echecs": 0
}
```

  Un jeton inconnu rend aussi `200` avec `supprimees: 0`. `400 ENTREE` (forme du jeton), `401 JETON`, `503`.
- **Le lien dure 10 à 11 mois, STRICTEMENT moins de 12, puis il est coupé pour toujours (BANC-12).** L'image versée au banc reste 24 mois au plus ; mais le LIEN entre une contribution et un compte ne dure que **12 mois au maximum** (`V2_BANC_LIEN_MOIS`, jamais plus, au moins 3), par **cohortes mensuelles** : une fois par jour, le serveur anonymise toute contribution antérieure au **premier jour du mois courant moins 10 mois** (moins `V2_BANC_LIEN_MOIS` − 2 mois). Une contribution est donc anonymisée **entre 10 et 11 mois** après son dépôt (mois calendaires UTC), et tout un mois de contributions bascule le même jour. **Âge maximal : 11 mois + la passe quotidienne (~1 jour) + la grâce en cas d'échec (7 jours par défaut) + l'étalement d'une cohorte de plus de 2 000 lignes sur quelques passes — toujours sous 12 mois, à condition que la grâce reste dans sa borne : `V2_BANC_GRACE_JOURS` vaut 21 jours AU PLUS (configuration invalide au-delà), parce que février, mois le plus court, ne laisse que 28 jours de marge : 27 jours est la limite, 28 jours atteignent les 12 mois, 21 laissent 6 jours (environ 12 000 lignes d'étalement). L'engagement vaut passes en marche : si le service est arrêté plus d'un jour, la marge d'un mois l'absorbe.** Anonymiser = la ligne n'a plus d'identifiant calculable, ni jeton, ni jour (au plus le mois), et plus rien ne la relie à un scan, à une installation ou à un compte, même avec le sel du serveur ; l'objet est réécrit sous une clé neuve (sa date de réécriture dit le mois de la cohorte, pas plus). **Conséquences pour le client** : `POST /api/banc/correction` n'a plus d'effet sur une contribution dont la cohorte a basculé (il rend toujours `200`, comme avant : il ne dit pas si une image est conservée) ; `DELETE /api/banc/contributions` ne trouve plus ces images (`supprimees: 0`) — elles ne sont plus rattachables à ce jeton, et partent seules à 24 mois ; l'historique (`GET /api/compte`) ne remonte plus qu'à **10 à 11 mois** d'analyses (la passe les supprime à la bascule ; la politique du site dit « douze mois au plus » pour le journal des analyses, la TTL de 12 mois n'est que le filet). **Si la réécriture échoue** (stockage en panne), la ligne reste `V2_BANC_GRACE_JOURS` jours (7 par défaut, 21 au plus) puis est SUPPRIMÉE : on préfère perdre une image que garder un lien. **Effacement par jeton** : il supprime aussi la copie anonyme d'une réécriture interrompue ; la réponse ne compte `supprimees` que pour ce qui a vraiment disparu.
- **Le scanner du site n'écrit jamais dans le banc** : sa route de réponse (`/api/scanner/analyses/{id}/reponse`) ne transmet au traitement que `scanId`, `choix` et `carte` ; un `consentementBanc` présenté au scanner est ignoré. Cette règle est tenue **deux fois** : à l'entrée du scanner (liste blanche) et dans le crochet du banc lui-même, qui ne CONSERVE (écriture d'objet, confirmation d'une ligne) que pour une surface autorisée — l'extension et l'installation — jamais pour `scanner`, ni pour une surface inconnue ou absente.
- **Effacer n'est jamais conserver** : un abandon (`choix` = `aucune` ou `ne-sait-pas`) **efface** la ligne `attente` et son objet depuis **toute surface du même porteur** — y compris le scanner qui répond à un scan de l'extension sur le même compte. Aucun consentement n'est requis pour effacer.

#### 1.7 bis Étiqueter un scan (administrateur) — lot ETIQUETAGE-A, 2026-10-13

**Pour le propriétaire de l'extension.** Un mode « étiquetage » réservé à l'administrateur : après un scan, il dit **« juste »** ou **corrige**, en deux secondes, et l'étiquette s'enregistre **à côté** de la réponse d'origine de la chaîne, qui n'est jamais modifiée. C'est la base de la mesure « le modèle contre Gemini seul » (à l'allumage de test, la chaîne appelle Gemini à 100 %).

- `POST /api/banc/etiquette { scanId, carte?, verdict, idProduct?, aucune?, rev }` (Bearer d'une installation **liée à un compte administrateur**). Liste fermée : tout autre champ, tout autre type ⇒ `400 ENTREE` (`detail`).
  - **`carte` est le champ `index` de la carte DANS LA RÉPONSE de `POST /api/identifier`** (la position d'ENTRÉE de la carte dans la photo ou le lot), **jamais sa position dans le tableau `analyse.cartes`** : pour un lot, la réponse range les cartes par valeur décroissante, et l'étiquette de `index: 2` se pose sur la carte d'entrée 2 quel que soit son rang d'affichage. Absent, `carte` vaut 0 (une seule carte). Prouvé par un lot de trois cartes rangé en `[1, 0, 2]` (`test-identifier-lot.js`).
  - **L'étiquette juge la réponse D'ORIGINE de la chaîne, pas la réponse de l'administrateur à une question.** « Affirmation » veut dire `statut: "identifiee"` dans la réponse INITIALE de `POST /api/identifier`. Répondre à une question (`POST /api/identifier/reponse`) ne la transforme pas : après un OUI, la carte rendue est `identifiee`, mais l'analyse garde le statut d'origine `a-trancher` et `cartes[i].idProduct` nul, donc `juste` rend toujours `409`. L'extension envoie `corrige` avec le candidat (voir plus bas).
  - `verdict: "juste"` : sans `idProduct` ni `aucune`. Valable **seulement** si la réponse de la chaîne pour cette carte est une affirmation (`statut: "identifiee"`) ; l'étiquette reprend l'`idProduct` affirmé. Sur une question (`a-trancher`) ou un introuvable : `409 CONFLIT` (`detail: "juste-sans-affirmation"`) — l'extension n'affiche alors **pas** le bouton « juste ». Une **panne n'écrit aucune analyse** : « juste » comme « corrige » sur un scan en panne rend `404 CODE_INVALIDE` (aucun scan n'existe), jamais 409.
  - `verdict: "corrige"` : **exactement un** de `idProduct` (entier ≥ 1) ou `aucune` (`"pas-une-carte"` | `"hors-catalogue"`). L'`idProduct` est validé au catalogue de l'API : inconnu ⇒ `422 ENTREE` (`detail: "id-product-inconnu"`), catalogue injoignable ⇒ `503 INDISPONIBLE` ; rien n'est écrit dans les deux cas. `aucune` ne lit pas le catalogue.
  - `rev` (entier de **1 à 1 000 000**, `400` au-delà : un rev démesuré figerait l'étiquette de la carte) : **strictement croissant par (scan, carte)**. L'extension le garde par carte (1 à la première étiquette, +1 à chaque changement d'avis) et renvoie **le même** `rev` pour rejouer une étiquette. Même `rev` et même contenu ⇒ `200 { etat: "rejoue" }` (rien n'est écrit) ; même `rev` et contenu différent, ou `rev` inférieur au dernier ⇒ `409 CONFLIT` (`rev-contredit` / `rev-perimee`) ; `rev` plus grand ⇒ l'étiquette est **remplacée**. Deux requêtes concurrentes de même `rev` : une seule gagne (l'autre reçoit `rejoue` si le contenu est identique, `409` sinon).
- **Réponse** : `200 { success: true, etat: "ecrit" | "rejoue", rev, banc: "ecrit" | "en-attente" }`. Jamais un `200` qui n'a rien écrit sans le dire. `banc` (lot ETIQUETAGE-B) dit si la **ligne du banc réel** de cette carte est écrite avec sa photo (`ecrit`) ou si elle attend (`en-attente` : bucket injoignable, banc non configuré, scan sans photo, objet disparu). **L'étiquette, elle, est toujours écrite** (`etat`) ; `en-attente` est repris plus tard par le serveur (passe quotidienne) et n'appelle aucune action de l'extension, qui peut afficher « enregistré » dans les deux cas. Rejouer la même étiquette (même `rev`) retente la ligne.
- **Qui y entre** : seul un compte dont le rôle `administrateur` est **relu en base à chaque requête**. Un compte sans le rôle, un rôle retiré depuis la dernière requête, une installation non liée : **le `404` natif d'une route inexistante** (même statut, même corps non JSON, mêmes en-têtes ; ce n'est PAS un corps `CODE_INVALIDE`) et rien n'est écrit — pas de 429 non plus, même au-delà de 600 requêtes, et aucune ligne d'idempotence même si le porteur envoie une `Idempotency-Key`. **Ce que cela cache, et ce que cela ne cache pas** : seul un porteur **authentifié** (jeton valide) non administrateur est leurré par ce 404. Sans jeton la route rend `401 JETON`, et la garde de forme de la v2 (clé interdite dans le corps, index non prêts) peut rendre `400` ou `503` avant la route : ces réponses-là la distinguent d'une route inexistante. Le coût d'un faux secret est nul ; la route n'est pas secrète, elle est inutilisable sans le rôle.
- **Rejeu par clé d'idempotence** : une `Idempotency-Key` rejouée rend la réponse **d'ORIGINE** (en-tête `Idempotency-Replayed: true`), même si l'état a changé depuis, et **n'écrit rien**. Exemple : `rev: 1` avec la clé K1 (`ecrit`), puis `rev: 2` avec la clé K2 (`ecrit`) ; rejouer K1 rend `200 { etat: "ecrit", rev: 1 }` alors que l'étiquette est au `rev` 2. La vérité est le `rev` : le même corps sans clé rend `409 rev-perimee`. Pour savoir où en est une étiquette, l'extension renvoie son dernier `rev` sans clé.
- **Le scan** doit être **du même porteur** : scan inconnu, scan d'un autre porteur, carte absente du scan ⇒ `404 CODE_INVALIDE` (jamais distingués). `401 JETON` sans Bearer.
- **Limites** : `Idempotency-Key` facultative (une clé rejouée rend la même réponse, `422 cle-reutilisee` avec un autre corps) ; 600 requêtes par heure et par porteur (`V2_ETIQUETTE_HEURE`, 1 à 100 000), `429 DEBIT` avec `Retry-After` au-delà. Un administrateur qui étiquette ~400 annonces reste largement sous le plafond ; `identifierParCompteHeure` (120 par heure pour `POST /api/identifier`) n'est pas modifié ici et reste à relever à l'allumage de test.
- **Argent** : aucun. La route ne débite ni ne rembourse rien ; le solde et les mouvements sont inchangés.
- **Les questions, en un clic (c'est ce qui tient l'étiquetage à 2 s : la majorité des réponses sont des questions).** Sur une carte `a-trancher`, l'extension **PROPOSE chaque candidat de la réponse** (`candidats[i].idProduct`) **en un clic** : chaque proposition envoie `verdict: "corrige"` avec l'`idProduct` du candidat, **déjà rempli**. Pour une question de **confirmation** (un seul candidat, `question.code: "confirmation"`, §3.3) : un bouton « c'est celui-là » (`corrige` + l'`idProduct` du candidat), « autre produit » (saisie), « pas une carte » et « hors catalogue ». Le bouton « juste » n'existe que pour une affirmation. L'administrateur n'a pas besoin de répondre OUI à la question pour l'étiqueter, et l'étiqueter ne répond pas à la question.
- **Pour la mesure (lot ETIQUETAGE-B)** : pour une carte `a-trancher`, la proposition d'origine de la chaîne se lit dans `analyses.cartes[i].question` (`code`, `choix[].idProduct`) ; l'affirmation d'une carte `identifiee` dans `cartes[i].idProduct` (nul pour une question). **Un `corrige` dont l'`idProduct` est l'un des candidats de `question.choix` signifie « la chaîne avait la bonne carte parmi ses candidats »** (un accord, pas une correction) ; la réponse de l'administrateur à la question, si elle existe, est dans `cartes[i].reponse`, à côté.
- **Ce que l'extension affiche** : la réponse de la chaîne pour la carte (affirmée : le produit ; question : les candidats ; introuvable : la raison) ; un bouton **« juste »** (affirmation seulement) ; un bouton **« corriger »** qui ouvre la saisie d'un `idProduct` **ou d'une URL Cardmarket résolue en `idProduct`** (par `POST /api/banc/resoudre-cardmarket`, §1.7 bis-b, quand le drapeau est allumé ; l'étiquette elle-même ne reçoit jamais d'URL) et propose **« pas une carte »** / **« hors catalogue »** ; puis l'état rendu : « enregistré » (`ecrit`), « déjà enregistré » (`rejoue`), « une étiquette plus récente existe » (`rev-perimee`), « produit inconnu du catalogue » (`422`), « catalogue indisponible, réessayer » (`503`).
- **Durée** : l'étiquette vit **dans la ligne d'analyse** (12 mois, `analysesMois`) et disparaît avec elle : passe quotidienne d'anonymisation, suppression du compte. Elle ne prolonge pas la vie de l'analyse et ne contient aucune photo ni aucun identifiant nouveau. Elle porte `{ verdict, idProduct | aucune, rev, le, versionModele, versionChaine }` ; `versionChaine` (commit du service) et `versionModele` (`V2_VERSION_MODELE`, facultative) sont ceux **qui ont répondu au scan**, relevés à l'écriture de l'analyse (`null` pour une analyse d'avant ce lot). Aucune de ces valeurs n'est servie au client.
- **La photo et la ligne du banc (lot ETIQUETAGE-B, 2026-10-13)** — **rien de neuf pour l'extension, sauf le champ `banc` ci-dessus.** Côté serveur : pour un scan d'un **administrateur seul** (rôle relu en base), la première photo de l'annonce (`imageUrls[0]`, hôte de la liste blanche) est téléchargée après la réponse, convertie en WebP sans métadonnées (côté le plus grand ≤ 1600 px) et rangée dans le bucket privé du banc ; la réponse de `POST /api/identifier` ne change pas d'un octet. À l'étiquetage, **une ligne `banc_lignes` par carte** (`source: "etiquette-admin"`) porte la vérité (`idProduct` ou `aucune`), la clé de la photo, les versions et la réponse d'origine de la chaîne ; une étiquette de `rev` plus grand met la ligne à jour, la photo n'est jamais dupliquée (un lot : plusieurs lignes, une photo). Aucun autre client n'est photographié, et la ligne ne porte ni compte, ni `scanId`, ni URL, ni titre, ni vendeur. Durées : celles du banc (photo 24 mois **comptés depuis le SCAN**, c'est-à-dire la date de capture de la photo et non celle de l'étiquetage ; lien 12 mois). Un administrateur déchu perd la photo de ses scans non étiquetés à la passe suivante. L'export vers l'outil de mesure (`v2/mesures/exporter-banc-admin.js`) est local, en lecture seule.
  - **Une requête vers l'hébergeur de l'annonce (tour 1).** La route v2 ne tient aucun octet de la photo (la chaîne reçoit l'URL) : le serveur fait donc **un seul `GET` de `imageUrls[0]`** par scan d'administrateur, **après la réponse, jamais attendu par le client**, vers un hôte de la liste blanche de la production, en `https`, sans suivre de redirection, au plus **8 s** (corps compris) et **5 Mo**, type `image/*` ; un échec n'est pas réessayé et ne change rien à la réponse. **La photo stockée peut différer de celle que la chaîne a analysée** si l'URL a changé entre-temps : son `sha256` est écrit sur l'analyse et sur la ligne du banc (`sha256`) pour savoir de quelle image il s'agit.
  - **Reprise (tour 1).** `banc: "en-attente"` n'est répondu que s'il existe une reprise : l'étiquette est écrite avec une marque de reprise dans la MÊME écriture, et la passe quotidienne réécrit la ligne à la `rev` de l'étiquette. Une carte sort de l'attente par `ecrit`, `sans-photo` (aucune photo 24 h après le scan) ou `role-retire` (le compte n'est plus administrateur : la photo n'est plus gardée). Pendant l'attente, l'export du banc le DIT (`etiquettesEnAttente` dans son manifeste) : une ligne peut porter une vérité plus ancienne que l'étiquette.

#### 1.7 bis-b Résoudre une adresse Cardmarket (administrateur, derrière un drapeau) — lot RESOUDRE-CARDMARKET, 2026-10-17

**Pour le propriétaire de l'extension.** Dans la saisie « corriger » (§1.7 bis), l'administrateur colle l'adresse d'une page produit Cardmarket ; l'extension l'envoie ici et reçoit l'`idProduct`, **exact, sans charger la page** (le catalogue de l'API connaît le `slug` et le `slugSet` de chaque produit). Cas réel qu'une page chargée ne sait pas résoudre : `https://www.cardmarket.com/fr/Pokemon/Products/Singles/30th-Celebration-JP/Dark-Tyranitar-m6aTRR-144` (une page de réimpression montre aussi les autres versions de la carte) ⇒ `907909`. L'`idProduct` rendu s'envoie ensuite tel quel à `POST /api/banc/etiquette` (`corrige`).

- `POST /api/banc/resoudre-cardmarket { url }` (Bearer d'une installation **liée à un compte administrateur**). Le corps est `url` seul, une chaîne de **2 048 caractères au plus** ; tout autre champ ou type ⇒ `400 ENTREE` (`detail` : `corps` | `champ-inconnu` | `url`).
- **Drapeau** : `V2_RESOLUTION_CARDMARKET=1`, lu avec les réglages (`v2/config.js`). Absent, ou toute autre valeur : **la route n'existe pas** — le `404` natif d'une route inexistante pour **tous**, administrateur compris, sans qu'aucun autre réglage devienne invalide.
- **Qui y entre** : la garde de `POST /api/banc/etiquette`, la même et dans le même ordre (identité `401 JETON`, rôle `administrateur` relu en base ⇒ sinon le `404` natif, limiteur, corps).
- **L'adresse** (écrite par ce qu'elle autorise) : seulement `https://[www.]cardmarket.com/<en|fr|de|es|it>/Pokemon/Products/Singles/<slugSet>/<slug>`, les segments suivant le motif de `v2/identifier/lien-cardmarket.js`. **La requête (`?language=…`, `?sellerCountry=…`) et l'ancre sont ignorées.** Une recherche (`Search`), une liste, un autre jeu, un autre domaine, `http`, `..`, `%`, un port, des identifiants dans l'adresse : `422 ENTREE` (`detail: "adresse-non-produit"`). **La casse compte** (le couple est cherché tel quel).
- **Réponse** : `200 { success: true, idProduct, nom, set: { slug, nom }, numero, lien }`. `nom` est le nom Cardmarket du produit ; `set.slug` le `slugSet` ; `lien` l'adresse canonique (`/fr/`, sans requête) servie par la même garde que `liens.cardmarket`.
- **Refus** : `404 CODE_INVALIDE` (`detail: "produit-inconnu"`) — aucun produit ne porte ce couple, ou le catalogue ne sait pas nommer celui qui le porte (le code `INTROUVABLE` n'existe pas dans la liste fermée : la route prend `CODE_INVALIDE`, comme les routes du banc) ; `409 CONFLIT` (`detail: "ambigu"`) — plusieurs produits portent le couple, le message en dit le nombre et **aucun `idProduct` n'est rendu** (l'extension demande alors de choisir ou de saisir l'identifiant) ; `503 INDISPONIBLE` — catalogue ou base injoignable.
- **Limite** : 600 requêtes par heure et par porteur (le limiteur des routes du banc, `V2_ETIQUETTE_HEURE`), `429 DEBIT` avec `Retry-After`. **Aucun argent, aucune écriture en base, aucune requête vers Cardmarket.** CORS : celui des autres routes du banc (origine de l'extension).
- **Source** : `numeros_cartes` (`slug`, `slugSet`), la collection que le catalogue de la chaîne lit déjà (liste fermée de `v2/identifier/catalogue.js`), puis la lecture du catalogue pour le nom, le set et le numéro.

#### 1.7 ter Envoyer la photo d'un scan (administrateur) — lot PHOTO-EXTENSION, recadrage du 2026-10-13

**Décision du testeur.** `POST /api/identifier` n'a **aucun champ d'image** : son corps garde sa limite de 100 ko, et la route héritée est inchangée. L'image que l'extension de l'administrateur affiche déjà part par une route à part, réservée à l'administrateur, où l'identité et le rôle sont jugés **avant** la lecture du moindre octet du corps. La seconde lecture pour tous les clients attendra un autre contrat.

- `POST /api/banc/photo?scanId=<24 hexadécimaux>&photo=0`, `Authorization: Bearer <jeton d'installation liée à un compte administrateur>`, `Content-Type: image/jpeg | image/png | image/webp`, `Content-Length` obligatoire, **corps = les octets bruts de l'image** (ni base64, ni JSON, ni préfixe `data:`). `photo` = l'index dans les `imageUrls` du scan, **0 par défaut et seule valeur admise** (le banc ne garde que la première photo de l'annonce ; `photo=1` rend `400 photo`). Aucun autre paramètre (`400 champ-inconnu`).
- **Ordre des gardes, tous AVANT de lire un octet du corps** (prouvé par un compteur d'octets lus : moins de 100 ko lus sur plusieurs centaines annoncés) : (1) identité : `401 JETON` ; (2) rôle `administrateur` relu en base : **tout autre porteur** (compte ordinaire, installation seule ou non liée) reçoit **le 404 natif d'une route inexistante** (même statut, même corps non JSON, mêmes en-têtes que `/api/banc/etiquette` : prouvé par comparaison avec une route inexistante) ; (3) plafond horaire par porteur (le même que l'étiquette, 600 par heure, `429 DEBIT`) ; (4) la requête (`400 scan-id | photo | champ-inconnu`) ; (5) `Content-Type` (`415 type`) ; (6) `Content-Length` entier, non nul (`400 content-length`), ≤ **2 Mio** (`413 trop-lourde`) — une photo d'annonce affichée (`f800`) pèse 100 à 300 ko ; (7) le scan existe ET est de **ce** porteur (`404 CODE_INVALIDE`, un scan inconnu et le scan d'un autre ne se distinguent pas) ; si le scan a déjà sa photo : `200 deja`, rien lu, rien réécrit ; (8) une place de lecture : **4 au total, 1 par porteur** (`429 DEBIT` + `Retry-After: 2`) ; (9) un **délai de lecture de 15 s** (une connexion lente est coupée, la place rendue). Un refus décidé avant la lecture laisse le serveur vider le corps comme pour une route inexistante (bande passante identique à n'importe quelle route, ni place ni mémoire) ; le corps n'est jamais gardé.
- **Le contenu** (après lecture, une seule analyse d'image : celle du scanner) : les octets doivent être ce que le `Content-Type` annonce (`415 type`) ; l'image doit se décoder entièrement (`422 illisible`), tenir en **12 millions de pixels et 4 096 px de côté** (`422 dimensions` ; une photo de téléphone de 4000 × 3000 passe) et n'avoir qu'une page (une image animée est `422 illisible`) ; **au plus 2 décodages simultanés** dans le service, le suivant reçoit `429 DEBIT` (réessayer), jamais une attente. Ces bornes sont refusées sur l'en-tête de l'image, avant le décodage complet.
- **L'effet.** La photo est conservée comme celle que le serveur télécharge lui-même : WebP sans métadonnées, 1 600 px au plus, `sha256` sur `analyses.photoBanc` ; les cartes du scan en attente de photo (`banc: "en-attente"`, §1.7 bis) en sortent et **leur ligne du banc naît**. Réponse : `200 { success: true, etat: "ecrit" | "deja", photo: 0, banc?: "ecrit" | "en-attente" }` (`banc` seulement si une carte attendait). **Idempotente** : la même photo pour le même scan rend `deja`, rien de plus (pas d'`Idempotency-Key`). Aucune erreur ne débite ni ne rembourse rien (la route est hors argent). Autres réponses : `503 INDISPONIBLE` (base ou bucket injoignable, rien de conservé). Les erreurs ont l'enveloppe v2 (`success: false, erreur: { code, message, detail }`).
- **Le repli : le téléchargement serveur.** Pour un scan d'**administrateur** seulement, le serveur attend **15 s** après avoir répondu au scan (`V2_PHOTO_ADMIN_DELAI_S`, de 0 à 300) que l'extension ait envoyé sa photo ; si `analyses.photoBanc` existe alors, **rien n'est téléchargé**. Sinon il télécharge `imageUrls[0]` (§1.7 bis), **espacé** (`V2_PHOTO_ADMIN_INTERVALLE_S`, défaut 10 s) et **plafonné** (`V2_PHOTO_ADMIN_MAX_JOUR`, défaut 400 par jour UTC), comptés dans la base ; au-delà, pas de photo (`banc: "en-attente"`). Le délai vit en mémoire du processus : un redémarrage pendant l'attente perd ce repli (la carte sort `sans-photo` à 24 h).
- **Pour l'extension.** (1) **Obtenir les octets** : `fetch` de la même adresse que celle de l'`<img>` affichée (`imageUrls[0]`), lu en `arrayBuffer()` — servi **en pratique par le cache du navigateur, sans garantie**. Si le `fetch` échoue (réseau, CORS, hors cache), **n'envoyer rien** : le repli serveur prend le relais ; l'extension ne doit jamais, de son côté, lancer une requête nouvelle vers Vinted si elle s'y refuse (son manifeste promet « rien n'est requêté vers Vinted »). Un canvas ne convient pas si le CDN n'envoie pas les en-têtes CORS (image souillée). (2) **Jamais de préfixe `data:`** et pas de base64 : le corps est binaire (`fetch(url, { method: 'POST', headers: { 'Content-Type': <le type de la réponse>, Authorization }, body: blob })` — le navigateur pose `Content-Length`). (3) **Mesurer avant d'envoyer** : ≤ 2 Mio, ≤ 4 096 px de côté, ≤ 12 millions de pixels, non animée ; sinon ne rien envoyer. (4) **Quand** : après la réponse du scan, **dans les 15 s** (le repli serveur part ensuite) ; l'extension connaît le `scanId` par la réponse de `POST /api/identifier`. Elle sait être administrateur par `facturation.motif === "administrateur"` d'une réponse précédente ; un non-administrateur qui appelle la route reçoit un 404 natif et ne doit pas réessayer. (5) **Réponses** : `200` (`ecrit` ou `deja`) = fini ; `429` = réessayer après `Retry-After` ; `413`, `415`, `422`, `400`, `404` = ne pas réessayer (le repli serveur couvre) ; `503` = réessayer une fois.

#### 1.7 quater Toutes les photos de l'annonce, envoyées AVANT le scan (administrateur, derrière un drapeau) — lot PHOTOS-MULTIPLES (7d), 2026-10-17, aligné le 2026-10-18

**Décision de l'éditeur.** L'extension lit les images depuis le navigateur de l'utilisateur (permission sur les hôtes d'images de Vinted). **Dès que le serveur a reçu une photo pour un scan, il ne télécharge plus aucune image chez Vinted pour ce scan.** Le modèle et la seconde lecture lisent les OCTETS reçus.

- **A. `POST /api/photo`, SANS paramètre** (Bearer d'une installation **liée à un compte administrateur**). `?index=` est **facultatif et IGNORÉ**, quelle que soit sa valeur : l'index de chaque photo vient de `photoIds` (`POST /api/identifier`). Tout autre paramètre ⇒ `400 ENTREE` (`detail: "champ-inconnu"`). Une photo par appel, jusqu'à 8 par scan, l'une après l'autre. Corps **binaire** : les octets bruts de l'image, `Content-Type: image/jpeg | image/png | image/webp` (jugé aussi sur les octets), `Content-Length` obligatoire, **2 Mio, 4 096 px, 12 millions de pixels, une seule image** — la validation est celle de `POST /api/banc/photo` (§1.7 ter).
- **Drapeau** : `V2_PHOTOS_MULTIPLES=1`, lu avec les réglages (`v2/config.js`). Absent, ou toute autre valeur : **la route n'existe pas** (le `404` natif, mêmes en-têtes et même corps qu'un chemin inexistant, pour **tous**, administrateur compris), la pré-requête CORS n'est pas servie, et `photoIds` / `photoId` dans `POST /api/identifier` sont des champs inconnus, ignorés comme aujourd'hui ; aucun autre réglage ne devient invalide. **Phase 1** : seul l'administrateur (rôle relu en base) y entre ; tout autre porteur reçoit le `404` natif. La phase 2 (tous les porteurs) s'ouvrira par un réglage du serveur (`V2_PHOTOS_MULTIPLES_TOUS`, lu et non branché), **sans changement de ton côté**.
- **B. Débit.** Ordre des gardes, tous AVANT de lire un octet : identité (`401 JETON`), rôle (le `404` natif), plafond horaire par porteur, requête, `Content-Type` (`415 type`), `Content-Length` (`400 content-length`, `413 trop-lourde`), une place de lecture, un délai de lecture de 15 s. **Une seule lecture à la fois par porteur** (au plus 4 dans le service) : huit envois l'un après l'autre passent, un second envoi SIMULTANÉ reçoit `429 DEBIT` + `Retry-After: 2` pendant la lecture du corps ; la place est rendue avant la validation et le réencodage, donc deux envois d'un même porteur peuvent décoder en parallèle, et c'est le sémaphore global (2 décodages) qui répond `429 DEBIT` à l'excédent. **Le plafond horaire est d'au moins 600 par porteur** (75 scans de 8 photos) : `max(600, V2_ETIQUETTE_HEURE)`, compteur à part de `/api/banc/photo`. Puis le contenu : `415 type`, `422 illisible | dimensions`, `429 DEBIT` (2 décodages en cours : la validation ET le réencodage passent par le même sémaphore). CORS : `Content-Type` et `Authorization` pour l'origine de l'extension, comme `POST /api/banc/photo`.
- **Réponse** : `200 { success: true, photoId, expireDans: 30 }` (`expireDans` : les secondes pendant lesquelles le `photoId` peut être servi). `photoId` : 32 hexadécimaux tirés au hasard. `success: true` est la convention de toutes les routes v2. **Aucun argent** : cette route ne débite ni ne rembourse rien.
- **C. `POST /api/identifier` (et un lot)** accepte `photoIds: [{ index, photoId }]` : de **1 à 8** couples, des index de `imageUrls` tels qu'ils sont envoyés, **uniques**. `400 ENTREE` (`detail: "photo-ids"`) : `photoId` et `photoIds` ensemble, un doublon d'index, un index hors de `imageUrls` (ou de 0..7), plus de 8 couples (ou aucun), **un `photoId` mal formé DANS `photoIds`** (pas 32 hexadécimaux minuscules), une clé inconnue dans un couple, ou toute autre forme absurde. L'ancien **`photoId` seul vaut l'index 0** ; mal formé, il garde `400 ENTREE` (`detail: "photo-id"`). Ces refus précèdent tout débit. Le corps de `/api/identifier` **garde sa limite de 100 ko** : les octets ne passent jamais par lui. `/api/identifier` facture comme aujourd'hui.
- **D. Ce que dit l'analyse.** Quand `photoIds` (ou `photoId`) est envoyé : `analyse.photosRecues` = les index REÇUS, en ordre croissant (`[]` si aucune photo n'a été retrouvée), et `analyse.photoRecue` = **vrai si et seulement si l'index 0 est reçu**. Sans `photoIds` ni `photoId` (ou drapeau éteint) : ni l'un ni l'autre n'existe dans la réponse.
- **E. Durée de vie — la règle de l'éditeur, mot pour mot (c'est la phrase que le site publie).** « Une photo reçue avant le scan vit uniquement dans la mémoire du serveur : elle sert une seule fois, à son seul porteur, dans les 30 secondes qui suivent son envoi, et elle est libérée à la fin de l'analyse — 120 secondes au plus en tout. Elle n'est jamais écrite : ni sur disque, ni dans un stockage, ni en base, ni dans un journal. Elle n'est transmise qu'au modèle d'analyse, pour cette analyse. Seule une photo envoyée par le compte administrateur peut être conservée, pour le banc de mesure. » Le code la tient : 30 s de service + 90 s de scan au plus = 120 s (trois constantes, un banc échoue si la somme dépasse) ; une photo non servie est retirée à l'échéance exacte par son propre minuteur ; une photo servie est libérée (octets, version réduite, base64 mémorisé) à la fin de la réponse, et aucune tâche après réponse ne garde celle d'un utilisateur ordinaire. Un `photoId` inconnu, expiré, d'un autre porteur ou déjà servi est **ignoré sans erreur** (le scan se fait avec les URLs). **Une requête REFUSÉE avant l'analyse (400, quota, plafond, clé d'idempotence en cours) ne consomme pas ses photos** : la relance de la même clé les retrouve, dans les 30 s ; les photos ne sortent du magasin qu'une fois la requête ACCEPTÉE. Un `photoId` ne se garde pas d'un scan à l'autre. **Bornes par porteur : 8 photos et 8 Mio** retenus ; au-delà, la plus ancienne est oubliée. Exception, phase 1 : l'index 0 reçu pour un scan d'administrateur devient **sa photo du banc** (§1.7 ter, même traitement) ; sans index 0, il n'y a pas de photo du banc et rien n'est téléchargé pour la remplacer.
- **F. `identifier-lot`** (plusieurs cartes sur la photo) accepte `photoIds` comme `identifier`, avec les index de SES `imageUrls`. **`zone.photo` d'une carte est un index d'`imageUrls`** : le lecteur du lot ne voit que les photos reçues, en liste compacte, et le serveur traduit sa N-ième image vers l'index d'`imageUrls` qu'elle porte (`zone.photo` hors de la liste : zone sans photo, jamais un index deviné).
- **G. Facturation et temps.** Un scan reste **UNE analyse**, quel que soit le nombre de photos. Les photos partent au modèle **réduites à 800 px de grand côté** (jamais agrandies : la définition f800 d'aujourd'hui), donc ni plus de coût ni plus de temps qu'avec les URLs ; la photo du banc garde 1 600 px. Elles ne comptent pas dans les 100 ko du corps. La borne de 90 s ne bouge pas. Octets transmis réencodés **sans métadonnées**.
- **Dès qu'au moins une photo est reçue pour un scan** : le modèle ne reçoit que les photos reçues (les index non reçus ne sont pas téléchargés pour compléter), le départage par l'image et la photo du banc ne téléchargent rien. **La seconde lecture reçoit les octets de la photo d'INDEX LE PLUS BAS reçue** (pas forcément l'index 0 : avec le seul index 3, elle lit cette photo ; la seconde lecture ne fait que confirmer, une non-confirmation est possible).
- **Pour l'extension.** (1) Obtenir les octets par `fetch` de l'adresse de l'`<img>` (cache du navigateur, sans garantie) ; si cela échoue ou dépasse les bornes, **n'envoyer rien** pour cet index. (2) `POST /api/photo` pour chaque photo, **une à la fois**, puis `POST /api/identifier` **aussitôt** avec `photoIds` (le `photoId` n'est servi que dans les 30 s qui suivent l'envoi). (3) Réponses : `200` ⇒ garder le `photoId` ; `429` ⇒ un seul nouvel essai après `Retry-After` ; `404`, `400`, `413`, `415`, `422`, `503` ⇒ sauter cette photo. **Une photo ne bloque jamais un scan.**

### 1.8 Ma collection (site) — lot COLLECTION

Un compte coche, set par set, les fiches qu'il possède. **Trois routes, sur la session du compte** (cookie, comme le scanner). La forme est celle que le site a proposée (`DEMANDE-COLLECTION.md`, `collectionContrat.ts`) ; les écarts sont listés plus bas.

```json schema=ReponseMesSets
{
  "success": true,
  "sets": [
    { "slug": "Fictif-Set", "possedees": 2, "majLe": "2026-10-10T09:00:00.000Z" }
  ]
}
```

```json schema=ReponseCollectionSet
{
  "success": true,
  "set": "Fictif-Set",
  "possedees": ["9000001|001", "9000002|-"],
  "cotes": {},
  "majLe": "2026-10-10T09:00:00.000Z"
}
```

```json schema=RequeteCocher
{ "possedee": true }
```

```json schema=ReponseCocher
{ "success": true, "possedees": 3 }
```

- `GET /api/collection` : les seuls sets où **au moins une fiche** est cochée, triés par slug. `GET /api/collection/sets/{slug}` : les clés cochées (triées, union sans doublon), `quantites` (`{ cle: n }`, seulement les clés à n ≥ 2 ; **champ ABSENT** quand il n'y en a aucune : la réponse est alors identique, à l'octet, à celle d'avant l'extension), les `cotes` et `majLe` (nul si rien n'est coché). `PUT /api/collection/sets/{slug}/fiches/{cle}` avec `{ "possedee": true | false }` — ou, extension facultative, `{ "possedee": true, "quantite": n }` — rend le **nombre de fiches cochées du set après l'écriture**. Seuls ces champs sont admis (un autre champ, un autre type, une quantité hors 1…99 : `400 ENTREE`, detail `possedee` ou `quantite`). Les trois réponses portent `Cache-Control: no-store`.
- **Idempotent.** Écrire deux fois la même chose rend le même nombre et ne change rien. `majLe` est la date de la dernière écriture **qui a changé quelque chose** (cocher une clé déjà cochée avec la même quantité ne la bouge pas ; changer la quantité d'une clé cochée la bouge). Un set qui n'a plus aucun bit ni aucune clé hors registre est supprimé. **Quantité (extension facultative et rétrocompatible)** : `quantite` entier de 1 à 99 ; **absente, elle vaut 1 sur une clé NEUVE et laisse la quantité INCHANGÉE sur une clé déjà cochée** (un ancien onglet qui ne connaît pas `quantite` ne rétrograde plus un double ; seule une `quantite` explicite la change, `quantite: 1` la remet à 1) ; `{ "possedee": false }` efface la quantité ; `quantite` avec `possedee: false` est refusée. **La valeur 99 est posée SANS mesure d'usage réel** (le site ne l'envoie pas encore) ; elle se desserre par décision.
- **Identité.** Cookie de session seulement (un jeton d'installation rend `401 SESSION`). **Lire** demande une session. **Écrire** demande en plus `Origin: https://rat-market.fr` + `X-Rat-Market: 1` (`403 ORIGINE`) **et un compte vérifié** (`403 VERIFICATION`, sans `solde` : aucun crédit n'est en jeu). Raison : ces données sont stockées sur la grappe de production. *(O3 : un compte non confirmé n'est plus un porteur — sa session est refusée, `401 SESSION`, en lecture comme en écriture ; la garde `VERIFICATION` reste en profondeur.)* Une session valide ne lit que ses propres clés cochées et les cotes du guide du set, jamais une donnée d'un autre compte. L'ordre des refus : `SESSION`, `ORIGINE`, `VERIFICATION`, `DEBIT`, puis la forme (`slug`, `cle`, `possedee`), puis l'écriture.
- **La clé d'une fiche** est `idInterne|numero` : `idInterne` est un entier sans zéro de tête (12 chiffres au plus), **négatif pour une fiche simple** (`-286142|001` ; jamais `-0`, jamais `+`) ; `numero` est le numéro de l'impression dans le set, ou `-` pour une fiche sans numéro. **Le serveur ne juge pas si une clé désigne une fiche réelle à l'écriture** (le lien fiche → produits n'est chargé qu'en mémoire, après le démarrage, et peut manquer) : il en juge la **forme**, et la garde est écrite par ce qu'elle **autorise**. Un numéro : lettres, chiffres, espace, `( ) . ! ? -`, 32 caractères au plus, ni espace de tête ni de queue ; **jamais `|`**. Un slug : lettres, chiffres, `-` et `/`, 80 caractères au plus, ni début ni fin sur `-` ou `/`, jamais `//`. Ce jeu est **dérivé des données du site** (`CORRECTION-ILLUSTRATEURS.json`, `logos-officiels.json`, `LISTE-FICHES-SANS-VISUEL.json`, en lecture seule) : **39 648 clés et 410 slugs examinés, 39 646 clés et 410 slugs admis**. **Oubli corrigé (COLLECTION-COMPACTE, ruling 8 bis) : `cartes` compte 1 512 documents à `_id` NÉGATIF (les « fiches simples », sur 17 096 cartes, mesuré le 2026-10-11 ; l'archive des visuels en porte aussi 1 512), que le site clé par `cleFiche(e.idInterne, e.numero)` (`entreesDuSet.ts` : `idInterne: d._id`) — la forme d'avant les refusait (`400 ENTREE`, detail `cle`), donc PERSONNE ne pouvait les cocher. Cause : le dénominateur ci-dessus ne venait que de fichiers du site qui ne portent pas ces fiches.** Les deux clés refusées (`295618|102<!--`, `294172|092<!--`) ont un numéro **corrompu à la source** (reste de commentaire wikitext) : elles rendent `400 ENTREE`, detail `cle`, et sont à corriger dans le catalogue. Une forme refusée rend `400 ENTREE` avec le champ nommé dans `detail` (`slug`, `cle`, `possedee`).
- **Un slug peut contenir `/`** (les codes de set comme `S-P/ID`) : il s'envoie **encodé** (`S-P%2FID`) et arrive entier dans le paramètre. Le `/` non encodé est un autre chemin (404) ; un `%2F` encodé deux fois reste littéral (`%` refusé).
- **Bornes**, écrites par ce qu'elles protègent (la grappe de production) et **jugées AVANT l'écriture** : **100 000 fiches cochées par compte** (bits + clés hors registre, tous sets confondus) — le catalogue complet plus 45 % de marge —, **6 000 fiches hors catalogue par compte** (`borne-hors`, +52 % sur la mesure), **10 000 fiches à quantité ≥ 2 par compte** (`borne-quantites` ; celles de `hors` comptent aussi : sans elle un compte pèse environ trois fois plus) et **1 000 sets par compte** (le coût d'un document dépasse celui d'une clé). Un dépassement rend **`409 CONFLIT`**, detail `borne-compte`, `borne-hors`, `borne-quantites`, `borne-sets` ou `borne-service`, le message nomme la borne ; rien n'est écrit, **rien n'est perdu** (une case refusée se dit). Cocher une clé **déjà** cochée n'est jamais refusé, décocher libère de la place. Deux écritures simultanées d'un même compte peuvent franchir ensemble la borne : **le dépassement est borné par le nombre d'écritures en vol** (au plus la limite d'écriture ci-dessous, chacune n'ajoutant qu'une clé), et l'écriture suivante voit le vrai total et est refusée. **Il n'y a plus de borne par set** : le registre d'un set est borné par le catalogue, et `hors` par son plafond.
  **Mesure des bornes (2026-10-11, sauvegarde locale du 2026-10-10, `v2/test/mesure-chargeur/mesurer-collection.js` ; dénominateurs : 761 sets, 17 096 cartes, 69 515 lignes `cartes_produits`, catalogue Cardmarket de 70 975 produits).** La règle du site (`fichesDuDocument`, copie embarquée) donne **68 792 fiches** réparties sur 761 sets ; l'archive construite sur la même base (`decider`, les fiches LIÉES à au moins un produit) en porte **64 858** (le plus gros set : 766, médiane 68) ; **3 934 fiches** de la règle du site ne sont PAS dans l'archive (128 sets, le plus gros : Tag-Team-Collection, 320) et 0 fiche de l'archive est absente de la règle du site. Le plus grand compte du catalogue complet est donc **68 792 fiches**, d'où **100 000 (+45 %** : le catalogue grandit — 141 fiches simples au lot 6, un set récent compte 200 à 300 fiches — et la place est de toute façon bornée par le budget d'octets) ; **6 000 hors catalogue** couvrent le **plafond hors registre mesuré (3 934)** avec +52 %. Un banc échoue si l'un des défauts passe sous 1,4 × ces nombres (la mesure est commitée : `v2/test/mesure-chargeur/mesure-collection.json`). **Le « 39 648 clés » du contrat précédent était un dénominateur qui ne contenait pas ces fiches** (fichiers du site : `CORRECTION-ILLUSTRATEURS.json`, `logos-officiels.json`, `LISTE-FICHES-SANS-VISUEL.json`).
- **Budget du SERVICE, en OCTETS** (toutes les données de « Ma collection » de tous les comptes, **registre compris**) : un compteur unique `compteurs`, document `collection-octets`, qui remplace l'ancien compteur de places. **Valeur provisoire : 10 485 760 o (10 Mo)**, « relevée au passage en Flex ». Un `PUT true` **réserve, AVANT d'écrire et au pire cas**, le coût en octets du modèle mesuré (`v2/collection/couts.js` : un document neuf, un mot de 64 bits neuf, une clé `hors`, une quantité, une entrée de registre et son document), d'un seul `$inc` **conditionnel** (`n + coût ≤ plafond`) : atomique, aucune écriture simultanée ne dépasse jamais le plafond. Au plafond : **`409 CONFLIT`**, detail `borne-service`, un message qui dit que la limite est **celle du service, pas celle du compte**, rien n'est écrit (ni le compte, ni le registre). Le surplus est rendu quand l'écriture n'a rien ajouté (la clé était déjà là, le mot ou le document existait) ; un retrait réel rend ce qu'il a retiré (la clé `hors`, la quantité) ; la suppression d'un document vidé et celle d'un compte rendent le **modèle de ce qui était stocké**. Le registre est partagé : il se compte à l'ajout et ne se rend jamais.
  **Mesuré par `collStats`.** Au **montage** du lot, le compteur est **recompté** depuis `collStats` (`size` + `totalIndexSize`) des **deux** collections `collection_fiches` et `collection_registre` (le registre est partagé mais il occupe la grappe). `collStats` est une action du rôle Atlas `read` (liste littérale épinglée par `test-chargeur-lecture-seule.js`) donc du rôle `readWrite` de l'utilisateur d'écriture de l'API ; elle est déjà lancée sur la production par `mesurer-taille-bases.js` — **non lancée ici sur la grappe réelle**. Une collection pas encore créée pèse 0 ; toute autre erreur FERME les écritures.
  **Le modèle de coût est vérifié CONTRE `collStats`** (`v2/test/test-collection-budget.js`) : le banc crée dans la base en mémoire des documents des formes extrêmes (1 clé par document avec un slug de 80 caractères, un seul compte sur 3 000 documents, des clés `hors` de 45 o avec quantité, 1 100 mots pleins, 2 000 quantités, un registre de 3 000 clés de 45 o, 1 500 registres d'une clé), fait un `fsync`, attend 2 s (sans eux `indexSizes` est faux, leçon du lot COLLECTION), lit `collStats` (données + index, moins la base vide) et **ÉCHOUE si une forme coûte plus que ce que le modèle réserve** ; il échoue aussi sur un modèle amputé (mot de 8 o, en-tête d'élément de 4 o, document de 150 o). Rapport mesuré/modèle : de 0,64 (collectionneur complet) à 0,975 (registre de grosses clés) — le modèle est un majorant, jamais une moyenne.
  **Ce que le banc a MESURÉ (2026-10-11, une exécution : les clés des formes synthétiques sont aléatoires, ±1 %).** **Un collectionneur COMPLET** (68 792 fiches : 64 858 au registre et 3 934 hors, sur les 761 sets réels, mots pleins) pèse **258 472 o** mesurés par `collStats` (252 Ko), **391 643 o** au modèle ; le **registre complet** de ces sets (64 858 clés) pèse **1 296 983 o** mesurés (1.24 Mo), **1 540 432 o** au modèle. **Les 10 Mo tiennent donc 22 collectionneurs complets au modèle** (le compteur réserve le modèle), 35 au mesuré. **Le compte le PLUS LOURD que TOUTES les bornes permettent** (1 000 sets dont les plus gros vrais sets à mots pleins, 6 000 clés `hors` de 45 o à quantité, 10 000 quantités, le reste en sets fictifs de 80 caractères) pèse **689 690 o** mesurés (674 Ko), **897 796 o** au modèle. **Le NOMBRE MINIMAL de comptes qui remplissent les 10 Mo : 14 au mesuré** ((10 485 760 − registre complet 1 296 983) / 689 690, registre compris puisqu'il faut le remplir pour poser les bits), **10 au modèle** — c'est ce nombre-là qui FERME le service, le compteur réservant le modèle —, 16 au mesuré sans compter le registre. L'ancien « 14 comptes » était celui du seul `hors` plein (640 460 o mesurés) : ce n'était pas le plus petit. Chaque compte exige environ **10 000 écritures** — `quantitesParCompte` compte AUSSI les clés `hors` qui portent une quantité, donc 6 000 `hors` à quantité plus 4 000 bits à quantité, une écriture chacune — soit, MESURÉ sur un compte construit par le service à l'échelle 1/10 (1 000 écritures acceptées, la suivante refusée `borne-quantites`), 10 000 à pleine échelle, environ 10 h au limiteur de 1 000 par heure ; un compte vérifié chacun. **Pire cas en octets sous le plafond** : le compteur refuse au-delà de 10 485 760 o du MODÈLE et la forme la plus défavorable mesurée pèse 0.975 × le modèle, soit **au plus 9.75 Mo réels**, plus le dépassement concurrent borné (écritures en vol × 855 o, le coût d'une écriture au pire).
  **Les gardes du compteur** : un recompte au montage qui échoue **ferme les écritures** (503, l'erreur n'est pas avalée) et la première écriture suivante le rejoue, les écritures attendent sa fin ; le compteur ne descend jamais sous 0 ; **un compteur ABSENT ferme les écritures** (503) jusqu'au prochain recompte — l'incrément conditionnel ne crée jamais le compteur, seul le recompte le fait ; un coût réel plus grand que la réservation (un concurrent a supprimé le document entre la lecture et l'écriture) est compté quand même (la dérive va vers le HAUT, donc vers la fermeture) ; la suppression d'un compte se fait document par document et rend le modèle de ce que chaque suppression a réellement retiré, jamais une lecture d'avant.
  **Limite connue, inchangée (une seule instance aujourd'hui)** : le recompte est absolu ; avec plusieurs instances, un recompte lancé pendant que l'autre écrit peut écraser des réservations en vol (dérive basse d'au plus le nombre d'écritures en vol). À traiter avant d'avoir plusieurs instances (liste « avant l'allumage »).
- **Limite d'écriture** : 1 000 `PUT` par compte et par heure (le limiteur existant, clé `collection`) ; au-delà `429 DEBIT` avec `reessayerDans` et `Retry-After`. La lecture n'est pas limitée.
- **Stockage COMPACT** (pas de migration : la v2 n'a jamais été allumée, l'ancien format `cles: [chaînes]` est remplacé). Deux collections de la base de l'API :
  · **`collection_registre`** : un document par set, `{ _id: slug, cles: [idInterne|numero…] }`. **La position d'une clé est son indice dans `cles`, et une position ne bouge JAMAIS** : un bit qui glisserait d'une case montrerait au client une carte qu'il n'a pas (une ERREUR au sens du chantier, pas un trou), et l'ordre du catalogue change chaque jour. **Ajout seulement** (jamais de retrait, de réordonnancement ni de réutilisation d'une case, même pour une fiche que le catalogue a retirée), **atomique et unique** (`$push` filtré sur `cles: { $ne: cle }`, puis relecture de l'indice ; 50 ajouts simultanés de la même clé donnent UNE position, et la création simultanée du registre d'un set neuf par des clés distinctes n'en perd aucune). Le registre ne porte aucun compte, ni date, ni IP.
  · **`collection_fiches`** : un document par (compte, set), `{ compteId, set, epoque, mots, hors, qte, majLe }`, index unique `collection_cle` (gardé par la garde d'index : sans lui, `503`). Ni adresse, ni nom, ni IP. **`mots`** : le bitmap des positions du registre, en mots de 64 bits, un **objet** `{ indiceDuMot: Long }` plutôt qu'un tableau, parce que `$bit` (`or` pour cocher, `and` pour décocher) est atomique, idempotent, **crée le mot absent** et ne demande aucune prolongation préalable (un tableau se prolonge avant l'écriture, « lire, prolonger, écrire » étant une course, et `$bit` sur un `null` de remplissage échoue) — vérifié sur mongod 8.2 ; Atlas est au moins en 4.2, version qui porte `$bit` et les mises à jour par pipeline employées. **`hors`** : les clés que le registre n'a pas (chaînes). **`qte`** : `{ position: n }` pour une clé du registre à n ≥ 2 ; une clé `hors` à n ≥ 2 porte sa quantité à côté d'elle (`cle\nN` : un saut de ligne ne peut pas figurer dans une clé), de sorte qu'une clé n'a qu'UN endroit.
  · **Qui entre au registre, et ce que devient Ma collection SANS catalogue chargé** : une clé n'entre au registre que si le **catalogue chargé en mémoire** (COTES-VISUELS, `fichesDuSet(slug)`) la connaît pour CE set — personne ne peut remplir le registre d'un set avec des clés inventées, ce qui bloquerait les autres comptes. **Ordre de décision d'un cochage : (1) la clé est déjà dans `hors` du compte → elle y reste ; (2) elle est déjà au registre du set (sa position est en base) → bit ; (3) sinon le catalogue CHARGÉ tranche : il la connaît → ajout au registre, il ne la connaît pas (une fiche sans produit : l'archive ne porte que les fiches **liées** à un produit) → `hors`.** **Aucun catalogue chargé** (démarrage de l'instance, échec du chargement, variables `V2_VISUELS_*` absentes) **et la clé n'est pas déjà au registre : `503 INDISPONIBLE`, detail `catalogue`, avec `reessayerDans` (5 s) et `Retry-After`, RIEN n'est écrit** — `hors` ne reçoit donc jamais une clé par accident, et la course entre deux PUT de la même clé pendant un changement de version du catalogue est ARBITRÉE : **`hors` GAGNE** — si la clé est déjà dans `hors` on ne pose pas de bit, et la seule reprise qui existe retire le **BIT**, sous condition (le bit est encore posé ET `hors` porte encore la clé), jamais une clé de `hors` (deux reprises qui se retiraient l'une l'autre perdaient la coche, cas reproduit par le relecteur). **Garanti** : après N cochages concurrents de la même clé, quel que soit l'ordre, la clé est cochée à EXACTEMENT UN endroit et `possedees` la compte une fois (bancs : la sonde du relecteur et une rafale de 50 cochages pendant un changement de version). **Décocher reste TOUJOURS permis, ainsi que cocher une clé déjà au registre et lire** (les positions sont en base). **Dépendance à écrire dans la liste d'allumage : sans catalogue chargé, « Ma collection » ne peut plus ENREGISTRER de fiche neuve** (le site doit traiter ce `503` comme « réessayez dans quelques secondes » et ne pas perdre le clic).
  · **Une clé ne vit qu'à UN endroit pour un compte.** Cocher une clé déjà présente (bit ou `hors`) ne change rien ; décocher la retire des deux endroits ; une clé rangée dans `hors` puis apprise par le registre **reste dans `hors`** (pas de migration) ; la lecture rend l'union triée sans doublon ; `possedees` = bits à 1 + longueur de `hors`. Si la clé arrive en `hors` entre la lecture et l'écriture du bit, le bit est repris (conditionnellement) : `hors` gagne.
  · **L'ÉPOQUE du registre : la perte ou la recréation du registre ne montre JAMAIS d'autres cartes.** Chaque document de registre porte une `epoque` aléatoire (16 caractères hexadécimaux) posée à sa création (`$setOnInsert`) ; chaque document de compte porte l'époque du registre contre lequel ses bits ont été écrits. Un registre supprimé, vidé ou recréé seul change d'époque : à la **lecture comme à l'écriture**, les bits d'un document dont l'époque diffère de celle du registre (ou dont le registre est absent, ou dont un bit dépasse les cases du registre) sont **ILLISIBLES** — la route rend `503 INDISPONIBLE`, un journal dit « registre recréé ou corrompu : bits illisibles » (sans compte ni clé), et **rien n'est écrit** ; `GET /api/collection` et `GET /api/collection/sets/{slug}` ne divergent jamais. Une garde qui ne peut pas conclure BLOQUE. **`collection_registre` et `collection_fiches` se sauvegardent, se restaurent et se vident ENSEMBLE** (note d'exploitation, dans la liste « avant l'allumage »). Le document de compte qui n'a que du `hors` n'a pas d'époque et ne dépend pas du registre.
  · **Runbook (opérateur).** Un SEUL set illisible fait répondre `503` à `GET /api/collection` tout entier — c'est voulu : on ne montre pas une liste partielle comme si elle était complète. Un document illisible ne se décoche plus (ni ne se coche) : le client est bloqué sur ce set. **Sortie, par un geste d'opérateur avec feu vert** : (a) restaurer `collection_registre` DEPUIS LA MÊME SAUVEGARDE que `collection_fiches` (les deux ensemble), ou (b) supprimer les documents de compte du set concerné (`collection_fiches`, filtre `set`) — les bits de ces comptes sont perdus, leurs clés `hors` aussi ; le journal « registre recréé ou corrompu : bits illisibles (set …) » nomme le set.
  · **Version de MongoDB : 4.2 au minimum** (mise à jour par pipeline avec `upsert`, `findOneAndUpdate` avec un tableau) ; les autres opérateurs sont plus anciens (`$bit` et `$bitsAllSet` 3.2, `$expr` 3.6, `$objectToArray` 3.4.4, `$indexOfArray` et `$split` 3.4). Le banc tourne sur 8.2.6 seulement. **`collStats` est gardée** (et non `$collStats`, l'agrégation qui la remplace depuis la 6.2) : c'est la commande que la liste littérale du rôle Atlas `read` épingle (`test-chargeur-lecture-seule.js`) et que `mesurer-taille-bases.js` lance déjà sur la production ; `$collStats` demande un rôle de plus et n'est pas assurée sur les paliers partagés. À vérifier sur la grappe à l'allumage (lecture seule) : si `collStats` y est refusée, les écritures de la collection ferment en 503 (comportement voulu).
- **Suppression du compte** : `DELETE /api/compte` supprime aussi toute sa collection (les seuls chemins qui suppriment un compte sont celui-là et la purge des comptes non confirmés à 48 h, §1.6 bis, qui appelle aussi `supprimerDuCompte` ; `test-collection.js` le vérifie par le texte de la production).
- **CORS** : le préflight du site sur `/api/collection…` autorise `GET, PUT` (jamais `POST` ni `DELETE`), avec `Allow-Credentials`. Le profil du site ailleurs ne change pas.

**Les cotes** (lot COTES-VISUELS). `cotes` porte, **pour chaque fiche du set connue du lien fiche → produits**, `{ tendance, date }` ou `null`. **D'où vient le lien** (décision du testeur, 2026-10-11 : aucun import dans la grappe de production) : l'API le charge **EN MÉMOIRE**, avec la décision du visuel de chaque produit, depuis une archive compacte (`v2/chargeur/format.js`) **précalculée hors de l'API** à partir de la base `cartes` : un objet R2 **PRIVÉ** (jamais l'hôte public : il contient la jointure fiche ↔ produit ↔ visuel), lu avec des **clés de lecture dédiées** (variables `V2_VISUELS_R2_*`, **fermées par défaut** : l'une absente ⇒ « sans visuel » et un journal qui les nomme) et **authentifié par un HMAC-SHA256** (`V2_VISUELS_HMAC`) vérifié **avant** toute décompression ; plafonds : **16 Mo compressée, 48 Mo décompressée** (l'archive réelle fait 2,8 et 11 Mo) ; chaque entrée est rejugée par la validation d'entrée au chargement, et un hachage interne, la structure et les comptes de l'en-tête sont contrôlés ; le **producteur** refuse de publier une archive que l'API refuserait, ou une chute de plus de 10 % des visuels ou des fiches liées par rapport à la dernière archive publiée (une archive précédente qui ne se lit pas est un « je ne sais pas » : aucune publication, sauf l'acte explicite `--ignorer-precedente`) ; quand deux entrées d'un même produit portent des visuels **différents**, **aucun visuel n'est servi pour ce produit** (un visuel absent est honnête, celui d'un autre tirage ne l'est pas ; deux entrées identiques n'en font qu'une) — compté et journalisé par le producteur ; le dépôt sur R2 n'existe que dans le producteur, le code que charge l'API n'écrit rien sur R2 — ou, si `V2_VISUELS_SOURCE=calcul`, calculée dans un fil plafonné par une **lecture seule** de `cartes` (`MONGODB_CARTES_LECTURE_URI`, privilèges prouvés par `connectionStatus`). Le chargement se fait **après** le démarrage (le serveur écoute avant ; aucune requête n'attend) puis **une fois par jour** ; la nouvelle version remplace l'ancienne d'un seul geste. Un échec (fil tué, fichier refusé, 0 visuel, 0 lien, plus de 10 % d'entrées perdues) **garde la version précédente**, se journalise avec ses comptes, et **n'est jamais rejoué en boucle** (décision du testeur) : **aucun nouvel essai après un échec, même quand aucune version n'est en place** ; le prochain essai est **le prochain réveil de l'instance** (≈ 11 par jour sur l'offre gratuite, la mémoire repart vide à chaque réveil) ou le rechargement quotidien suivant. Le chargement part **dès le démarrage** sans attendre la base de l'API ; **aucune réponse n'attend jamais le chargement** : la requête qui réveille l'instance est servie « sans visuel » / `cotes: {}` tant que l'archive n'est pas en place. **Avant le premier chargement réussi** (ou si aucun n'est possible), l'API rend `cotes: {}` — le site lit `{}` comme « `null` pour toute fiche » — et les produits n'ont **pas de visuel** : l'état « sans visuel » d'avant. Les cotes sont lues dans `guide_prix` (base de l'API), **une seule requête par appel**, bornée aux produits du set, à **5 000 produits** au plus, trois champs, 2 s (`maxTimeMS`) et l'index `idProduct`. **Au-delà de 5 000 produits, les cotes sont PARTIELLES** : les premières fiches du set (dans l'ordre du lien) jusqu'à la borne ; les autres fiches sont **absentes** de `cotes`, ce que le site lit comme `null` (« on ne sait pas »), et l'API le journalise. Le plus gros set réel compte 766 produits (médiane 79, p95 252) : la borne n'est atteinte par aucun set aujourd'hui. La **règle** : la cote d'une fiche (`{ tendance, date }`, la tendance du guide et la date **du guide**, jamais celle de l'import)
- est celle de son produit si la fiche **n'a qu'un produit** ;
- si elle en a **plusieurs**, n'existe que si **tous** ont la même tendance **et** la même date de guide ;
- vaut `null` dans tous les autres cas. **Jamais une moyenne, un minimum ou un maximum.**

**Écarts avec la forme proposée par le site** (le site s'alignera) : (1) l'écriture exige un **compte vérifié** (`403 VERIFICATION`) — la demande ne le disait pas ; (2) les **bornes** (`409 CONFLIT`) et le **limiteur** (`429 DEBIT`) sont des refus que le faux serveur du site ne connaît pas ; (3) la **forme** de la clé et du slug est contrôlée (`400 ENTREE`, detail `slug` / `cle` / `possedee` / `quantite`) ; le faux serveur renvoyait `400 SERVEUR` pour un corps invalide ; (4) `possedees` de la liste est ≥ 1 (un set vidé disparaît) ; (5) `cotes` porte la cote du guide de chaque fiche du set (`{}` avant le premier chargement) ; (6) le site doit envoyer un slug encodé (`encodeURIComponent`, ce qu'il fait déjà) et traiter `409` sans réessayer ; **(7) COLLECTION-COMPACTE : la quantité facultative des doubles** — `PUT` accepte `{ "possedee": true, "quantite": n }` (n de 1 à 99, 99 posé sans mesure d'usage réel) et `GET` d'un set ajoute `quantites: { cle: n }` pour les seules clés à n ≥ 2, **champ absent quand il n'y en a aucune** ; **(8) le detail `borne-set` disparaît** (plus de borne par set) et `borne-hors` apparaît ; **(9) les clés de fiche simple** (`idInterne` négatif) sont admises, voir plus haut ; **(11) `PUT` rend `503 INDISPONIBLE`, detail `catalogue` (avec `reessayerDans`), quand aucun catalogue n'est chargé et que la clé n'est pas déjà au registre** — rien n'est écrit, le site réessaie ; **(12) `409 CONFLIT`, detail `borne-quantites`** (10 000 fiches à plusieurs exemplaires par compte) ; **(13) `quantite` absente sur une clé déjà cochée laisse la quantité inchangée** ; **(14)** les plafonds deviennent 100 000 fiches et 6 000 hors catalogue ; **(10)** `GET /api/collection/sets/{slug}` n'est plus borné à 2 000 clés : il rend les clés cochées du set, au plus celles du set (le plus gros du catalogue en compte 766) plus les clés hors registre du compte pour ce set.

### 1.9 `GET /ping` : la santé du serveur, et ce que la v2 sert (lot CAPACITES-PING)

`GET /ping` est un sondage de santé (keep-alive) : sans authentification, sans lecture en base de plus, le même temps de réponse. La route est héritée ; la v2 n'y ajoute que deux champs, **sous la même condition** : la v2 est allumée **et** sa configuration est valide. Sinon (serveur d'avant, v2 éteinte, configuration invalide), `/ping` rend ses trois clés d'aujourd'hui et rien d'autre.

```json schema=ReponsePing
{ "ok": true, "mongo": true, "version": "fictif-0.0.0", "versionMinExtension": "2.0.0", "capacites": ["langue-impression", "marques", "prix-incertains", "prix-repli", "achete-avant-jour"] }
```

- **`versionMinExtension`** (chaîne) : la plus ancienne version de l'extension que le serveur prend en charge (sinon `426 VERSION`). Un `/ping` 200 avec ce champ = v2 annoncée ; sans, v2 non annoncée.
- **`capacites`** (tableau de chaînes, **liste fermée**, dans l'ordre ci-dessous, sans doublon) : les parties du contrat que **ce serveur sert, et dont tout ce qui les rend vraies est allumé**. Un jeton est vrai seulement si le code du serveur le sert ; il n'est jamais annoncé « pour plus tard ». La liste vit en un seul endroit du code (`v2/capacites.js`), le schéma `ReponsePing` la reprend (le banc compare les deux).

| jeton | sens : présent seulement si… |
|---|---|
| `langue-impression` | `impressions[].langue` est servi (le code fermé de la langue de l'impression, `null` si elle n'est pas prouvée). **Condition : l'archive des visuels est chargée** en mémoire **et** porte la colonne des jumeaux (sans archive, `impressions` est vide ; avec une archive d'avant la colonne, `langue` vaut `null` partout) |
| `marques` | `Produit.marques` et `Impression.marques` sont servis. **Condition : l'archive des visuels est chargée** en mémoire (sans archive, `Produit.marques` vaut `null` et `impressions` est vide) |
| `prix-incertains` | `prixGuide.{fiable, reserves, moyenne7, moyenne30, deBase}`, `version`, `set.badge` et `regleVerdict.ecartTendanceMax` sont servis |
| `prix-repli` | `carte.prixRepli` est servi **et** la règle REPLI-QUOTA est en place : un scan dont la réponse sert un repli compte dans le quota (`raisonNonRembourse: "prix-repli"`) |
| `achete-avant-jour` | `facturation.poche` est servi : les analyses achetées sont débitées avant le quota du jour |

**Les deux jetons de l'archive suivent l'état du service, à chaque appel.** L'archive des visuels vit en mémoire du processus : un service qui se réveille à froid, ou dont les clés de lecture de l'archive sont fermées, ne la porte pas, et `/ping` ne dit alors ni `langue-impression` ni `marques` ; ils reviennent à l'appel qui suit son chargement, et retombent si elle disparaît. `/ping` lit cet état en mémoire (jamais la base) : une fonction pure de ce qui est chargé. Un client lit donc `capacites` à chaque sondage et ne garde pas un jeton annoncé il y a une heure.

**`prix-repli` dit que la RÈGLE est en place, pas que chaque carte a un repli.** `prixRepli` reste absent sur une carte dont la fiche n'a aucune donnée de prix (et sur une carte à trancher) : le jeton ne promet pas un repli par carte. L'extension qui ouvre la page sans état visé et ne déclare pas de lecture ratée doit exiger le `prixRepli` de CETTE carte, pas seulement le jeton : sans repli sur la carte, un scan débité sans prix affiché n'est pas remboursé.

**Les jetons décrivent le code et l'état chargé ; un `503` reste une panne.** Un jeton annoncé n'empêche pas une route de répondre `503 INDISPONIBLE` (index manquants, base injoignable) : le client traite ce `503` comme une panne passagère.

**Ce que fait le client.** Un jeton inconnu est **ignoré**. Un champ `capacites` **absent, ou qui n'est pas un tableau, vaut « on s'en tient aux champs servis »** : la présence des champs dans les réponses reste l'annonce, leur absence l'affichage d'avant. Un jeton absent d'un tableau présent = cette partie n'est pas servie par ce serveur (par exemple un serveur d'avant REPLI-QUOTA ne dit pas `prix-repli`). `capacites` ne remplace pas `versionMinExtension` : l'un dit « la v2 est là et quelle version il faut », l'autre « ce qu'elle sert ».

**Comment le serveur décide.** Une fonction **pure** de la configuration et de l'état chargé en mémoire (aucune lecture en base, aucune exception possible : une archive illisible fait tomber le jeton) : un jeton sort si et seulement s'il est dans la liste fermée **et** si sa condition rend exactement `true` ; une condition absente, qui lève ou qui rend autre chose que le booléen vrai fait tomber le jeton. Aucun des cinq jetons ne dépend d'un drapeau de configuration aujourd'hui (le banc balaie toutes les variables `V2_*` que la configuration lit). Trois sont servis par le code seul ; deux (`langue-impression`, `marques`) dépendent de l'archive des visuels chargée en mémoire, lue par un lecteur injecté (preuve ligne à ligne en tête de `v2/capacites.js`, rejouée par `v2/test/test-capacites-ping.js`). Le jour où une partie sera derrière un drapeau, le jeton suivra ce drapeau, lu dans la même configuration que la route.

---

## 2. Les règles du contrat

1. **Additif.** Sans `contrat: 2` dans la requête, la réponse d'aujourd'hui, octet pour octet : la 1.0.x publiée continue de marcher.
2. **Trois issues par carte** : `identifiee` · `a-trancher` · `introuvable`. Jamais « sous réserve » en sortie. (`lot` est un statut d'ENSEMBLE, jamais d'une carte.) Une carte n'est `identifiee` que si son produit n'a aucun jumeau (§3.2).
3. **Listes fermées** pour tout ce qui pilote un comportement (§3). Une valeur inconnue d'un client tombe sur un défaut **qui n'affirme rien**.
4. **Aucun score, aucune confiance chiffrée.** `etat.confiance` est une chaîne de liste fermée.
5. **`null` = « on ne sait pas »**, jamais zéro ni non. Un prix à 0 n'existe pas ; une variante inconnue est `null`, jamais `normale` deviné.
6. **Une image servie vient de NOTRE R2** (vignette + grande), jamais de Cardmarket : `https`, hôte exact du bucket public (`pub-7d992e666c3d4a2b870b680a920045b6.r2.dev`) ou `rat-market.fr`.

7. **Les limites d'une IP sur la v2 (lot LIMITEUR-HERITE, 2026-10-13).** Le limiteur de l'ancien serveur (60 requêtes par heure et par IP sur `/api/identifier*` et `/api/analyser*`) ne compte que ce que la v2 ne traite pas elle-même : il saute une requête SEULEMENT si elle est `POST /api/identifier` avec `contrat: 2` (nombre) ou `POST /api/identifier/reponse`, ET que son jeton d'installation est reconnu. Un en-tête `Authorization` seul n'exempte rien. Ce qui borne une IP sur la v2 : 120 identifications par heure et par porteur (`identifierParCompteHeure`), 600 réponses par heure et par porteur (`V2_REPONSE_HEURE`), les plafonds du jour et d'argent de la v2, et 2 installations par IP et par jour ; une requête de contrat 2 sans jeton reconnu reste comptée à 60 par heure et par IP, et son refus a la forme v2 : `429`, `erreur.code: "DEBIT"`, `reessayerDans` (secondes) et `Retry-After` de la même valeur. **Un refus d'une requête qui n'est pas de la v2** (sans `contrat: 2`, ou sur `/api/analyser`) garde la forme héritée, `{ "success": false, "error": "Trop de requêtes, réessaie plus tard." }`, octet pour octet : l'extension 1.0.x en dépend. **Un chemin en majuscules** (`/API/IDENTIFIER`), servi par la v2 parce qu'Express ignore la casse, reste compté par le limiteur hérité et n'est jamais exempté : c'est conservateur et voulu, de même que la barre finale et tout sous-chemin. **Un plafond par IP, en mémoire, protège la base** : les requêtes candidates à l'exemption (POST `/api/identifier` avec `contrat: 2`, POST `/api/identifier/reponse`) ne sont acceptées que dans la limite de 3600 par heure et par IP (la clé est celle du limiteur hérité : IPv4 telle quelle, IPv6 regroupée par /56 ; saturer la table de 100 000 compteurs demande 100 000 préfixes distincts dans l'heure) ; au-delà, `429 DEBIT` v2 (`reessayerDans` = `Retry-After`) sans aucune lecture ni écriture en base. 3600 = 5 porteurs derrière une même IP (foyer, petit bureau, NAT) × (120 identifications + 600 réponses par heure, le maximum d'un porteur) ; il suit les deux limites par porteur de `config.js`. Une seule instance sur Render : la mémoire suffit ; avec plusieurs instances chacune aurait son compteur (plafond réel multiplié par le nombre d'instances, borne de coût plus lâche) et il faudrait un magasin partagé.

Les réponses du serveur sont **fermées** : une clé que le schéma ne nomme pas n'est jamais servie (`additionalProperties: false`). Un client qui reçoit une clé inconnue la tolère ; un banc du serveur, lui, l'aurait refusée.

**Le prix.** L'extension lit le prix EN DIRECT sur Cardmarket (`prixLive` dit quoi lire). Le scanner affiche **le guide du jour** (`prixGuide` : `tendance`, `de` = le prix le plus bas **tous états** (§2 bis), `moyenne7`, `moyenne30`, et `date`, celle du GUIDE) ; il n'y a **pas de `prixParEtat`**, le serveur ne va jamais chercher un prix par état.
**Un lot** coûte `max(1, ceil(cartesVues / 10))` crédits, questions comprises ; `cartesVues` compte les cartes introuvables. Il est **rendu en entier** quand aucune de ses cartes n'affiche de prix (LOT-SANS-PRIX, §2 bis (f) et §3.1).

### 2 bis. Les prix qui ne sont pas présentés comme sûrs (lot F4-PRIX, 2026-10-18)

Règle du projet : « tout ce qui donne un chiffre au client se compte dans les faux ». **Un prix présenté comme sûr qui ne l'est pas est un faux.** Tous les champs ci-dessous sont des **AJOUTS FACULTATIFS** du schéma (un client d'avant ne casse pas) que le serveur sert **toujours** ; les valeurs sont des codes fermés, jamais du texte libre.

**(a) « Prix illisible » n'est permis que si AUCUNE offre n'est reçue.** Écrite par ce qu'elle autorise :
- l'extension peut dire « prix illisible » (`lectureRatee`, ou un prix `originePrix: "tendance"` sans verdict) **seulement** si la page Cardmarket, une fois chargée, ne porte **aucune** ligne d'offre ; si elle en porte et qu'aucune ne se lit, c'est un **échec de lecture** (`lectureRatee { cause: "grille-vide", definitive: false }`, jamais remboursé, à retenter), **pas** un « prix illisible » ;
- une tendance (`originePrix: "tendance"`) n'est **jamais** un prix d'offre et ne porte **jamais** de verdict (elle ne l'a jamais fait : `src/commun/prix.js`) ;
- le serveur ne fait **aucune** requête Cardmarket : il ne voit des offres que si l'extension les lui envoie (`prixLive`, `prixLiveEtat`, `originePrix: "grille"`). Le cas Arcanin [G] Lv.60 (Supreme Victors 15/147, scan `6ad3eaf22fdf39af3f1a8b24`) : le serveur a reçu `prixLive: 7,67`, `originePrix: "tendance"`, ni `prixLiveEtat`, ni `prixLiveNM`, ni grille. **Il n'a reçu aucune offre** ; elles se perdent dans la lecture de la page par l'extension (voir `REPONSE-API-EXTENSION-F4.md`). **Depuis le lot PRIX-LISIBLE, une aucune-offre n'est plus non plus un « prix illisible » quand la fiche a une donnée de prix : voir (f), le champ `prixRepli`.**

**(b) Le « De » est l'offre la plus basse, TOUS ÉTATS.** `prixGuide.de` (et le « ≈ 1,00 € » d'une impression) est l'offre la plus basse de la fiche, tous états et toutes langues confondus : une carte Poor suffit. Le guide ne porte **aucun prix par état** : seul `prixLive`, lu en direct par l'extension dans `etat.retenu`, donne un prix dans l'état. Le champ fermé `prixGuide.deBase` le dit : `tous-etats` (la seule valeur servie). **Le « De » n'est jamais présenté comme le prix de l'état de l'annonce**, et n'entre dans aucun verdict.

**(c) Deux impressions au même set et au même numéro se séparent par leur `version`.** `Produit.version` et `Impression.version` : `V1`, `V2`… (forme `V<1 à 99>`), la version Cardmarket du produit, lue sur la même ligne que le slug (« Arcanine-G-Lv60-**V1**-SV15 » et « …-**V2**-SV15 »). Elle **n'a aucune signification** (ni reverse, ni holo, ni édition : `variante` le dit quand on le sait, sinon `null`) et ne se devine pas ; `null` = Cardmarket n'a qu'un produit à ce numéro, ou on ne le sait pas. À afficher à côté de « set · n° ». Quand deux lignes ont le même set, le même numéro **et** la même `version` (ou aucune), **rien ne les sépare dans nos données** : ne rien inventer.

**(d) Le badge du set.** `set.badge` + `set.badgeSource` (`code` ou `nom`). Le **code** du set quand il ne se confond avec aucune série ; sinon le **nom** du set. « SV » est Supreme Victors, pas Scarlet & Violet (qui commence par `SV1`) : `badge: "Supreme Victors"`, `badgeSource: "nom"`. Mesuré sur les 783 codes du catalogue (2026-10-18) : 13 sont égaux au préfixe d'une série connue (`SV`, `SWSH`, `SM`, `XY`, `BW`, `DP`, `PL`, `HS`, `EX`, `HGSS`, `BS`, `NP`, `SS`) et passent donc par le nom ; 65 sont le préfixe strict d'un autre code (par exemple `BK` et `BKP`), ce qui n'est pas une confusion avec une série. `set.code` n'est jamais modifié. L'extension affiche `badge` ; le nom est long : à tronquer à l'affichage, pas à raccourcir ici.

**(e) L'écart de la tendance.** Si la tendance s'écarte de **plus de 30 %** (constante nommée `ECART_TENDANCE_MAX`, 0,3) de la moyenne sur 7 jours **ou** de celle sur 30 jours, le prix n'est **pas** présenté comme sûr et un verdict de bonne affaire n'est **jamais** certain. L'écart se mesure à la moyenne : `|tendance − moyenne| / moyenne`, sur une moyenne valide seulement (une moyenne absente ne se devine pas). **`fiable` s'écrit par ce qu'il autorise : il vaut `true` seulement si l'écart a été MESURÉ (une tendance ET au moins une moyenne valide) et tient dans la borne, et qu'aucune autre réserve n'est posée.** Sans comparaison possible (pas de tendance, aucune moyenne), ou sur une ligne de produit ou d'impression non lue (absente de `numeros_cartes`, lecture en panne ; la panne de cette lecture ne casse jamais l'identification), `fiable` vaut `false` avec la réserve fermée `ecart-non-mesurable`. **La tendance et les moyennes du guide sont, comme `de`, des prix TOUS ÉTATS** (le guide n'a aucun prix par état) : `fiable: true` ne dit jamais que c'est le prix de l'état retenu de l'annonce. Deux endroits :
- **le guide** (`prixGuide`, servi par le serveur) : `moyenne7`, `moyenne30`, `fiable` (booléen), `reserves` (liste) ; `ecart-tendance` est dans `reserves` quand l'écart dépasse 30 %, `ecart-non-mesurable` quand il n'a pas pu être mesuré ;
- **la fiche lue en direct** (l'extension) : elle applique **la même constante**, servie dans `analyse.regleVerdict.ecartTendanceMax` (0,3), aux valeurs qu'elle lit sur la page (cas réel : tendance 7,67 € contre 13,45 € à 30 jours et 14,35 € à 7 jours : écart 43 % et 47 %).

```json schema=PrixGuide
{
  "tendance": 10.18,
  "de": 1,
  "moyenne30": 13.15,
  "date": "2026-10-12",
  "deBase": "tous-etats",
  "moyenne7": 14.59,
  "fiable": false,
  "reserves": ["ecart-tendance"]
}
```

**(f) Le repli honnête : `prixRepli` (lot PRIX-LISIBLE, 2026-10-24).** Règle de l'éditeur : **jamais « prix illisible » quand la fiche a une donnée de prix.** **Phrase que l'extension doit suivre : jamais « prix illisible » quand `prixRepli` est servi** (ni « Aucune offre dans l'état de la carte » : ce texte dit qu'une page a été lue et qu'elle n'a pas d'offre, ce que le repli contredit). AJOUT FACULTATIF du schéma (`PrixRepli`), sur trois réponses :
- la **carte identifiée** (jamais une question en attente ou abandonnée, ni un candidat : un repli est celui du produit que l'analyse a CONFIRMÉ) de l'analyse (`POST /api/identifier`) et de la réponse à une question (`POST /api/identifier/reponse`), quand l'analyse n'a **rien dicté à lire** : `prixLive` null (`langue-non-lue`, la langue n'a pas été lue) ou `prixLive.etatVise` null (`etat-non-retenu`, l'état estimé a une confiance « basse » : la porte de confiance de l'état le met de côté). Dans ces deux cas l'extension n'a **aucune page à ouvrir** : elle ne lit rien, donc elle ne peut pas dire « aucune offre » ;
- la **réponse de `POST /api/retour-live`**, pour une carte identifiée (ou une question répondue par un candidat), quand l'extension a envoyé une lecture ratée (`lecture-ratee`, définitive ou non), un prix d'origine `tendance` (`tendance-seule`), ou une offre `grille` lue dans un état **pire** que l'état retenu (`offre-autre-etat`, avec `prixLiveEtat`).

La mention `repli` est fermée : **`tendance`** (la tendance et les moyennes du guide du jour, `guide`, qui est le `prixGuide` de la fiche, tous états) ou **`etat-proche`** (l'offre que l'extension a lue dans l'état pire le plus proche : `offre { etat, prix }`, avec le guide s'il existe). **`fiable` vaut toujours `false`** (un repli n'est jamais un prix sûr, même si `guide.fiable` vaut `true`), et **le serveur ne sert aucun verdict** : le client n'en calcule aucun sur un repli (ni bonne affaire, ni cher). Une offre lue dans l'état retenu ou dans un meilleur état est un prix dans l'état : **aucun repli**, la réponse est celle d'avant, octet pour octet. **Sans AUCUNE donnée de prix** (aucun guide servi et aucune offre), la clé est **absente** (jamais `null`) : alors seulement « prix illisible » est vrai. Le scanner du site ne sert jamais ce champ. Le schéma dit les couples admis (deux formes exclusives) : `tendance` a toujours un `guide` non nul et une `offre` nulle, avec les causes `langue-non-lue`, `etat-non-retenu`, `lecture-ratee`, `tendance-seule` ; `etat-proche` a toujours une `offre` non nulle (le `guide` peut être nul) et la seule cause `offre-autre-etat`.

**Ce que le repli ne change pas (tour de correction 1).**
- **Un scan qui AFFICHE un prix compte dans le quota (REPLI-QUOTA, décision de l'éditeur du 2026-10-24).** « Un scan qui AFFICHE un prix (même un repli avec mention) est une analyse rendue, donc il COMPTE dans le quota. Seuls les scans sans aucun prix affiché gardent le remboursement « prix illisible ». » L'extension continue d'envoyer `lectureRatee` **exactement comme aujourd'hui** (y compris `definitive: true`), et c'est le SERVEUR qui juge, par UNE seule règle (`afficheUnPrix`) : un scan affiche un prix quand **(a)** la page a rendu un prix, ou **(b)** le serveur sert, dans CETTE réponse, un `prixRepli` non nul. Pour une lecture ratée **définitive** :
  - **`prixRepli` servi dans la réponse** : le scan **n'est PAS remboursé**, il reste compté — `facturation { debite: 1, reserve: 0, rembourse: false, motif: "sans-prix", raisonNonRembourse: "prix-repli" }` (valeur NOUVELLE de la liste fermée `raisonNonRembourse`). Aucun remboursement n'est tenté : le plafond des déclarations du jour n'est **pas** consommé, la réponse ne porte pas de champ `declaration`, `offre.restant` ne remonte pas. Un second envoi rend la même décision. Fausse réponse : `retour-live-repli-non-rembourse.json`. Le client ne dit alors ni « Prix illisible » ni « remboursé » : il affiche le repli avec sa mention, et l'analyse compte ;
  - **aucun `prixRepli`** (la fiche n'a aucune donnée de prix) : le remboursement `sans-prix` d'avant, inchangé — une fois par scan, sous le plafond des déclarations du jour, `plafond-jour` au-delà (voir §3.1).
  - Une lecture ratée **non définitive** ne change pas : aucune facturation, le repli est servi, la relecture reste proposée.
  - **Une carte identifiée d'emblée sans `prixGuide`** (A15, §5) reste remboursée : elle n'a pas de repli (un repli naît d'un guide servi), donc elle n'affiche aucun prix.
  - **Un lot (LOT-SANS-PRIX, décision de l'éditeur du 2026-10-24 : « Lot sans prix : OUI, rembourse-le, comme le contrat le promettait. Un scan qui n'affiche aucun prix ne compte pas dans le quota. »)** se juge UNE fois, à l'analyse, par la MÊME règle (`afficheUnPrix`) appliquée à l'ensemble de ses cartes : **dès qu'UNE carte affiche un prix, le lot reste compté** — un `prixGuide` servi sur une carte identifiée, un `prixRepli` servi, une instruction de prix en direct (`prixLive` objet : la langue de la carte est lue, l'extension peut donc montrer un prix lu sur Cardmarket), ou un `prixGuide` sur l'un des candidats d'une question (le client le voit) — quel que soit le nombre de cartes sans prix ; **si AUCUNE carte n'affiche de prix** (identifiées sans guide, sans repli et à langue non lue — `prixLive: null` —, à trancher dont aucun candidat n'a de guide ET dont la langue n'est pas lue — une question à langue lue recevra une instruction `prixLive` après un OUI, donc compte comme un prix possiblement affiché, de même qu'une question sans candidat —, et introuvables), le lot est **remboursé en entier**, comme un lot entièrement introuvable : toutes ses unités, une fois par scan, chacune dans sa poche (§3.1). Un champ de prix absent, un statut inconnu ou une lecture qui échoue valent « un prix est affiché » : jamais un remboursement sur un doute. `POST /api/retour-live` sur une carte de lot répond toujours `409 CONFLIT` `carte-non-identifiee` (le lot ne se rembourse pas carte par carte). **Le prix lu en direct par l'extension sur une carte de lot, le serveur ne le voit jamais** (ce retour est refusé pour un lot) : la règle regarde donc ce que la réponse SERT, y compris l'instruction de lecture en direct, et dès qu'une carte en porte une le lot reste compté. Fausse réponse : `lot-sans-prix.json`.
- **La relecture de la page reste proposée** : une lecture ratée qui peut se retenter (défi Cloudflare, blocage, onglet fermé) garde son bouton de relecture, repli affiché ou non.
- **`lecture-ratee` regroupe toutes les causes d'échec** que l'extension a envoyées (`defi`, `blocage`, `onglet`, `grille-vide`, `sans-prix`, `sans-offre-reverse`) et leur définitivité : le serveur ne les sépare pas dans le repli (il ne ferait que recopier ce que l'extension sait déjà de sa propre lecture). Le client sépare un défi ou un blocage d'un échec définitif par la `cause` et la `definitive` qu'il a lui-même envoyées.
- **`sans-offre-reverse`** : le repli sert le guide de la FICHE, c'est-à-dire de toutes les versions du produit (pour une reverse lue par filtre d'adresse, le produit est le même que la version normale). **Ce n'est PAS le prix de la reverse** : le texte doit dire « tous états, toutes versions ».
- **Les `reserves` du guide voyagent avec le repli** (`guide.reserves`, dont `ecart-tendance`, `prix-indicatif-tampons-melanges`, `peut-etre-gonfle-par-tampons`) : le client les affiche avec le repli, comme avec n'importe quel prix du guide. Une fiche marquée ne se présente jamais sans ses réserves.

| code | `repli` | texte proposé (à valider par l'éditeur) |
|---|---|---|
| `langue-non-lue` | `tendance` | « La langue de la carte n'a pas pu être lue : voici la tendance et les moyennes Cardmarket du jour (tous états, toutes langues), à titre indicatif. » |
| `etat-non-retenu` | `tendance` | « L'état de la carte n'est pas estimé avec assez de certitude : voici la tendance et les moyennes Cardmarket du jour (tous états), à titre indicatif. » |
| `lecture-ratee`, `tendance-seule` | `tendance` | « Aucune offre lisible dans l'état : voici la tendance et les moyennes Cardmarket du jour (tous états), pas un prix d'offre. » |
| `offre-autre-etat` | `etat-proche` | « Aucune offre dans l'état estimé : la moins chère lue est en {offre.etat} ({offre.prix} €). » |

À chaque texte s'ajoutent les mentions de `guide.reserves` quand il y en a.

Réponse de `POST /api/retour-live` à une lecture ratée définitive dont le repli est servi (REPLI-QUOTA : non remboursée, le scan compte) :

```json schema=ReponseRetourLive
{
  "success": true,
  "facturation": { "debite": 1, "reserve": 0, "rembourse": false, "motif": "sans-prix", "raisonNonRembourse": "prix-repli" },
  "offre": { "nom": "gratuit", "restant": 8, "remiseAZero": "2026-10-14T00:00:00+02:00" },
  "prixRepli": {
    "repli": "tendance", "cause": "lecture-ratee", "fiable": false,
    "guide": { "tendance": 1.49, "de": 0.02, "deBase": "tous-etats", "moyenne7": 1.55, "moyenne30": 1.26, "date": "2026-10-12", "fiable": true, "reserves": [] },
    "offre": null
  }
}
```

```json schema=PrixRepli
{
  "repli": "tendance",
  "cause": "etat-non-retenu",
  "fiable": false,
  "guide": {
    "tendance": 1.49,
    "de": 0.02,
    "deBase": "tous-etats",
    "moyenne7": 1.55,
    "moyenne30": 1.26,
    "date": "2026-10-12",
    "fiable": true,
    "reserves": []
  },
  "offre": null
}
```

```json schema=PrixRepli
{
  "repli": "etat-proche",
  "cause": "offre-autre-etat",
  "fiable": false,
  "guide": null,
  "offre": { "etat": "GD", "prix": 0.9 }
}
```

**Les prix mélangés.** Certaines promos existent en version Staff, Prerelease, League… mais Cardmarket n'a **qu'un produit** pour la carte : le guide mélange les versions. Le catalogue marque ces fiches `prixMelangeTampon` (67 le 2026-10-18). Pour un produit marqué, `prixGuide.fiable` est `false`, **le prix n'est jamais présenté comme sûr**, et `prixGuide.reserves` porte les deux codes fermés ci-dessous (règles 1 et 3 de l'éditeur ; la règle 2 remplace la 3 quand le tampon STAFF est lu). Les champs internes (`prixMelangeTampon`, `tamponsConnus`, la preuve) ne sortent **jamais**.

| code de `reserves` | texte à afficher (celui de l'éditeur) | quand |
|---|---|---|
| `ecart-tendance` | « La tendance s'écarte de plus de 30 % des moyennes sur 7 et 30 jours : ce prix n'est pas sûr. » (texte proposé par l'implémenteur, non fourni par l'éditeur) | la tendance s'écarte de plus de 30 % de `moyenne7` ou de `moyenne30` |
| `ecart-non-mesurable` | « Écart non vérifiable : prix indicatif. » (texte proposé par l'implémenteur, **à valider par le testeur**) | aucun écart mesurable (tendance absente, aucune moyenne valide) ou ligne du produit ou de l'impression non lue |
| `prix-indicatif-tampons-melanges` | « prix indicatif : versions tamponnées vendues sous la même fiche Cardmarket » | fiche marquée `prixMelangeTampon` (règle 1) |
| `peut-etre-gonfle-par-tampons` | « peut être gonflé par les ventes de versions tamponnées » | fiche marquée et **aucun tampon de la liste fermée lu** sur la photo (règle 3). Tant que la lecture du tampon est éteinte, aucun tampon n'est lu : toujours avec la précédente |

| `version-tamponnee-prix-sous-estime` | « version tamponnée : le prix Cardmarket sous-estime sa valeur » | fiche à produit unique marquée `prixMelangeTampon` ET une marque de la liste fermée lue sur la photo, deux fois à l'identique (règle 2, lots F1-TAMPON et TAMPONS) : servi **à la place** de `peut-etre-gonfle-par-tampons`, avec `prix-indicatif-tampons-melanges` |

**Règle 2 — CODÉE, derrière un interrupteur ÉTEINT (lots F1-TAMPON puis TAMPONS).** Quand UNE marque de la liste fermée (voir « Les marques » ci-dessous) est lue sur la photo (deux essais indépendants qui lisent le même ensemble NON VIDE, sans « autre ») d'une fiche à produit unique marquée `prixMelangeTampon`, le verdict reste sur l'`idProduct` et la mention « version tamponnée : le prix Cardmarket sous-estime sa valeur » (`version-tamponnee-prix-sous-estime`) remplace la règle 3 (jamais une bonne affaire présentée comme certaine : `fiable` reste `false`). **La donnée `prixMelangeTampon` est désormais une COLONNE PROPRE de l'ARCHIVE** : la liste triée des `idProduct` que `cartes_produits.prixMelangeTampon` marque, émise pour CHAQUE ligne marquée avant tout écartement — elle ne dépend d'AUCUN visuel (un produit sans entrée d'archive la porte aussi) ; le chargeur imprime « produits marqués dans cartes_produits : N · dans la colonne : N » et la construction lève si les deux diffèrent. `numeros_cartes.prixMelangeTampon` continue de marquer aussi : une source qui dit « vrai » suffit, aucune ne dit « faux » pour l'autre. Une archive d'avant la colonne reste lisible (« inconnu »). **La mention de la règle 2 exige la même preuve qu'un sûr** : l'ensemble lu doit être exactement la variante prouvée d'un produit de la fiche, sinon aucune mention (la règle 3 reste). **Inerte en service tant que** la lecture est éteinte (`V2_LECTURE_TAMPON=0`). `peut-etre-gonfle-par-tampons` reste servi tant qu'aucune marque n'est lue.

**Les marques (lot TAMPONS, 2026-10-18) — champ ADDITIF `marques`.** `Produit.marques` et `Impression.marques` : un tableau de jetons de la liste **fermée** `staff`, `prerelease`, `league`, `championship`, `toys-r-us`, `gamestop`, `kfc`, `indomilk`, `professor`, `cosmo`, `snowflake`, `play-pokemon`, `place-1`, `place-2`, `place-3`, `place-4`, **dans cet ordre** (`["staff","prerelease"]`, `["league","place-2"]`). Servi **toujours** ; il vient de la `variante` PROUVÉE du produit dans l'archive (jamais déduit d'un nom) : `[]` = prouvé sans tampon de la liste (variante `normale` prouvée) ; `null` = on ne sait pas (jumbo, variante absente, hors liste). **`variante` ne change PAS** : son énumération (`normale`, `reverse`, `holo`, `premiere-edition`, `tampon`, `jumbo`) est lue par l'extension et le site ; un client d'avant ignore `marques`. Les jetons de la `variante` de l'archive (côté catalogue) sont : une marque, un ensemble joint par `+` dans l'ordre de la liste (`staff+prerelease`), `jumbo`, `normale` ; la forme ancienne `staff-prerelease` se lit `staff+prerelease` ; toute autre valeur est écartée et comptée (`varianteHorsListe`).

**La lecture des marques (derrière `V2_LECTURE_TAMPON` ET `V2_EMPREINTE_EXTENSION`, ÉTEINTS).** Une question dont les candidats sont EXACTEMENT une paire « ensemble de marques / normale » que l'archive prouve séparée (même visuel, même fiche, ou listes) est tranchée **uniquement** si deux lectures indépendantes de la carte redressée donnent le **même ensemble NON VIDE** de marques de la liste, sans « autre », et que cet ensemble est **exactement** celui du produit tamponné de la paire. Rien lu, une marque hors liste, « autre », un sous-ensemble, un sur-ensemble, un ensemble différent d'une lecture à l'autre, incertain, panne, délai : la **question reste**. **La version normale n'est jamais affirmée** par une lecture (un tampon manqué n'est pas un tampon absent). Un jumbo reste une question. Le journal (`analyses.lectureTampon`, jamais servi) porte `type` (le jeton de la paire), `marques` (lues) et `accord`.

---

## 3. Les listes fermées

Toutes sont des `enum` du schéma, comparées au code du serveur par `test-openapi.js`.

| liste | valeurs |
|---|---|
| issue d'une carte (`CarteAnalysee.statut`) | `identifiee` · `a-trancher` · `introuvable` |
| statut d'analyse (`analyse.statut`) | `identifiee` · `a-trancher` · `introuvable` · `lot` |
| `raison` d'un introuvable | `photo-illisible` · `pas-une-carte` · `hors-catalogue` · `plusieurs-cartes-non-separees` · `panne-lecture` · `impression-indeterminee` |
| `question.code` | `reverse` · `symbole` · `numero` · `langue` · `premiere-edition` · `visuel` · `confirmation` (additive, UN-CANDIDAT, §3.3) |
| `choix[].id` | `a` · `b` · `c` |
| `variante` (nullable) | `normale` · `reverse` · `holo` · `premiere-edition` · `tampon` · `jumbo` |
| `etat.confiance` (nullable) | `haute` · `moyenne` · `basse` |
| états Cardmarket (`estime`, `retenu`, `etatVise`, `prixLiveEtat`) | `MT` · `NM` · `EX` · `GD` · `LP` · `PL` · `PO` |
| `facturation.motif` | `affirmee` · `question` · `lot` · `introuvable` · `sans-prix` · `panne` · `plafond-jour` · `administrateur` |
| `facturation.raisonNonRembourse` (nullable) | `aucun-debit` · `deja-rembourse` · `deja-livre` · `mongo-absent` · `plafond-jour` · `accueil-au-plafond` · `hebdo-semaine-changee` · `poche-introuvable` · `prix-repli` (REPLI-QUOTA : un repli est affiché, le scan compte) · `erreur` |
| `devise` | `EUR` · `GBP` · `USD` · `PLN` · `CZK` · `HUF` · `RON` · `SEK` · `DKK` · `AUD` (ajoutée avec `vinted.com.au`) |
| `verdictAffiche` | `bonne-affaire` · `correct` · `cher` · `aucun` |
| `lectureRatee.cause` | `defi` · `blocage` · `grille-vide` · `sans-prix` · `sans-offre-reverse` · `onglet` |
| `originePrix` | `grille` · `plancher-toutes-langues` · `tendance` |
| `surface` d'une ligne d'historique | `extension` · `scanner` |
| `source` du scanner | `camera` · `fichier` · `collage` |
| code d'erreur (`erreur.code`) | voir §6 |

`code-maitre` **n'existe plus** : le motif `administrateur` le remplace (rôle tenu en base sur le compte de l'éditeur, `debite: 0`).
Le serveur ne produit pas encore les raisons `pas-une-carte`, `plusieurs-cartes-non-separees` et `panne-lecture` (la chaîne actuelle ne lit qu'une carte et distingue une panne d'une absence) ; elles restent dans la liste pour que les clients aient un texte prêt. `impression-indeterminee` (additive, JUMEAU-V2) est, elle, PRODUITE, mais seulement par le repli du §3.2 (une ligne de jumeau manque) : au-delà de 3 produits la garde pose maintenant une question à 3.
La liste des marchés (`marche`) n'est pas un `enum` du schéma : elle vient de la configuration du serveur (`V2_MARCHES`) ; un marché hors liste reçoit `422 MARCHE`.

### 3.1 Ce que chaque issue coûte (`facturation`)

Une unité = une analyse du quota du jour (`offre.restant`), ou de la poche `achete` tant qu'elle n'est pas vide (ACHETE-AVANT-JOUR, plus bas) ; `facturation.poche` dit laquelle.

| issue | `debite` | `reserve` | rembourse ? | `motif` |
|---|---|---|---|---|
| carte affirmée | 1 | 0 | non | `affirmee` |
| question posée | 0 | **1** | — | `question` |
| · répondue par un candidat | 1 | 0 | non | `question` |
| · `aucune`, `ne-sait-pas`, sans réponse sous 24 h | 0 | 0 | oui, sous le plafond des DÉCLARATIONS du jour (sans compte 1, gratuit 3, Pro 30 : voir ci-dessous) | `question` |
| lot de N cartes (N ≤ 20, `V2_LOT_CARTES_MAX`) | `max(1, ceil(N/10))` | 0 | seulement si aucune carte n'est identifiée (`introuvable`), ou si aucune carte n'affiche de prix (ligne suivante) ; **jamais carte par carte** : `POST /api/retour-live` refuse une carte de lot (`409` `carte-non-identifiee`), et UNE carte qui affiche un prix (guide, repli, candidat de question) suffit à garder le lot compté | `lot` |
| lot de N cartes dont **aucune** n'affiche de prix (LOT-SANS-PRIX, 2026-10-24 : ni `prixGuide`, ni `prixRepli`, ni instruction de prix en direct — `prixLive: null`, langue non lue —, aucun candidat de question au guide, aucune question à langue lue) | `max(1, ceil(N/10))` à l'analyse | 0 (toutes les unités rendues, chacune dans la poche où elle a été prise ; `facturation.poche` comme pour un lot introuvable) | **oui**, en entier, UNE fois par scan, sous le plafond des CONSTATS du jour (sans compte 20, gratuit 50, Pro 100 : le serveur seul constate qu'aucun prix n'est servi, le client ne déclare rien — le compteur d'un lot introuvable, jamais celui des déclarations) ; au-delà : facturé en entier (`debite: ceil(N/10)`, `raisonNonRembourse: "plafond-jour"`, motif `plafond-jour`), exactement comme un lot introuvable | `sans-prix` |
| lot refusé (`lot-trop-grand` : plus de 20 cartes, ou supplément impayable) | 0 (crédit initial rendu) | 0 | oui, jusqu'à **10 refus par jour et par compte** (`V2_LOT_TROP_GRAND_JOUR`) ; **au-delà, la lecture est facturée** (`debite: 1`, `raisonNonRembourse: "plafond-jour"`), la réponse restant le refus ; le supplément n'est jamais pris | `lot` |
| aucune carte trouvée | 0 | 0 | oui, sous le plafond des CONSTATÉS du jour (FREIN-CONSTATES, ci-dessous) ; au-delà : facturé (`debite: 1`, `raisonNonRembourse: "plafond-jour"`) | `introuvable` |
| aucun prix affiché (`lectureRatee` définitive, **aucun `prixRepli` servi**) | 0 | 0 | oui, une fois par scan, sous le plafond des DÉCLARATIONS du jour (compteur commun, voir ci-dessous) ; au-delà : facturé (`debite: 1`, `raisonNonRembourse: "plafond-jour"`) | `sans-prix` |
| prix illisible mais **repli affiché** (`lectureRatee` définitive, `prixRepli` servi dans la réponse) | 1 | 0 | **non** (REPLI-QUOTA : un prix est affiché, le scan compte) : `raisonNonRembourse: "prix-repli"`, aucun remboursement tenté, le plafond des déclarations n'est pas consommé | `sans-prix` |
| panne (lecture, base, source) | 0 | 0 | oui, **toujours, hors plafond** (toute panne de NOTRE côté : `INDISPONIBLE`, `SERVEUR`, `IA` ; FREIN-CONSTATES, ci-dessous) | `panne` |
| remboursement refusé (plafond atteint) | 1 | 0 | non, et `raisonNonRembourse` dit pourquoi | `plafond-jour` |
| compte administrateur | 0 | 0 | — | `administrateur` |

**Arrêt du serveur pendant un scan (O5).** Un scan dont le serveur MEURT avant d'avoir produit son résultat (déploiement, arrêt brutal) est **rendu en entier, toutes ses unités, sans compter dans aucun plafond du client**, par une passe du serveur qui se joue quand le processus ne donne plus signe de vie (90 s sans battement, et au moins 5 minutes après le débit) ; une requête longue mais vivante n'est jamais rendue. Il est **confirmé** (rien n'est rendu) seulement quand sa **réponse complète est rejouable** : stockée avec la même `Idempotency-Key` pendant 24 heures. Une ligne d'analyse écrite ne suffit pas (l'historique ne donne ni le prix ni les candidats) : si le serveur meurt après l'avoir écrite et avant d'avoir stocké la réponse, le scan est rendu, pour une extension comme pour un compte. **Un client qui coupe la connexion avant la réponse n'est jamais remboursé** : le serveur, vivant, va au bout, le résultat est produit, le crédit couvre le travail fait. Le motif interne de ce remboursement est `arret-serveur`; il n'apparaît ni dans la réponse ni dans `historique` (qui ne sert que les analyses et les octrois, achats et migrations de crédits). Un client qui rejoue sa requête avant cette passe reçoit `DEBIT` (« en cours », `reessayerDans: 2`), jamais une lecture gratuite ni un second débit ; après le remboursement, la même clé est une nouvelle tentative payée.

**Plafonds de remboursement (lot PLAFOND-DECLARE, décision du testeur 2026-10-14 ; remplace les quatre compteurs du lot PLAFONDS ; complété le 2026-10-17 par les CONSTATÉS, voir plus bas).** Deux sortes sont plafonnées par la liste ci-dessous, par **jour de Paris** et par **porteur** (le compte quand l'installation en a un ; sinon l'installation non liée) :
- **les DÉCLARATIONS du client** — réponse `aucune` ou `ne-sait-pas`, question restée sans réponse sous 24 h (déclaration par l'absence), prix illisible définitif SANS repli servi (`lectureRatee.definitive` de `POST /api/retour-live` ; avec un `prixRepli` servi, aucun remboursement n'est tenté et le compteur n'est pas touché), et le lot dont toutes les confirmations sont refusées. **UN seul compteur** pour les trois, plafonné par l'**offre lue au moment du remboursement** : **sans compte 1, gratuit 3, Pro 30** par jour (`V2_DECLARES_SANS_COMPTE`, `V2_DECLARES_GRATUIT`, `V2_DECLARES_PRO`). Pour un Pro la déclaration rendue rend l'unité à la garde anti-abus de 200 comme avant (le 200 ne bouge pas). Une installation liée est jugée à l'offre de son compte ; une offre illisible (compte supprimé) reçoit le plafond le plus étroit. Le compteur est celui du porteur présenté : un sans-compte qui se lie à un compte gratuit en cours de journée repart d'un compteur neuf côté compte (au plus 1 + 3 déclarations rendues ce jour-là) ;
- **les refus de lot `lot-trop-grand`** : 10 par jour, inchangé (`V2_LOT_TROP_GRAND_JOUR`), indépendant de l'offre.

**FREIN-CONSTATES (décision du testeur, 2026-10-17) : ce que le SERVEUR constate est plafonné lui aussi** — introuvable, garde des jumeaux, carte AFFIRMÉE par le serveur dont le prix du guide est absent (`sans-prix` côté scanner, sans question), question qui n'a pas pu s'écrire. **UN seul compteur « constatés »** par porteur et par jour de Paris, plafonné par l'**offre lue au moment du remboursement** : **sans compte 20, gratuit 50, Pro 100** (`V2_CONSTATES_SANS_COMPTE`, `V2_CONSTATES_GRATUIT`, `V2_CONSTATES_PRO` ; entiers ≥ 0, une valeur invalide rend la configuration invalide). Un scan (un lot compris, dont les cartes refusées par la garde des jumeaux sont toutes rendues ensemble) prend UNE unité du compteur. Une offre illisible reçoit le plafond le plus étroit. **Au-delà** : aucun remboursement, l'analyse compte (`facturation { debite: 1, rembourse: false, motif: "plafond-jour", raisonNonRembourse: "plafond-jour" }`, contrat stable) ; pas de champ `declaration` (ce n'est pas une déclaration du client). Le compte administrateur n'est pas concerné (aucun crédit pris). **Toute panne de NOTRE côté est TOUJOURS rendue, hors plafond et sans compteur** (`INDISPONIBLE` 503 : base, catalogue, archive des jumeaux illisibles, coupure de la dépense du modèle ci-dessous ; `SERVEUR` 500, exception de notre code ; `IA` : le fournisseur du modèle en PANNE PROUVÉE, c'est-à-dire une erreur classée comme panne du service ou un 200 au corps d'erreur) : elle ne se facture jamais au client ; le plafond ne porte que sur les constats sur la photo. **Une photo sans carte** (le modèle répond du texte non JSON, un JSON sans nom, un contenu non textuel) n'est PAS une panne : c'est `introuvable` / `photo-illisible`, **plafonnée** comme tout introuvable (motif `ia-sans-lecture`, `introuvable` côté client, aucun code nouveau). **Un refus « carte introuvable » ou « aucun candidat » prononcé alors qu'une source est tombée pendant le scan** est une absence non constatée : panne `INDISPONIBLE`, rendue hors plafond. **Les motifs de remboursement hors plafond** (liste FERMÉE de VALEURS EXACTES, une seule fonction `natureDuMotif` dans `v2/argent/nature-du-motif.js`, aucun préfixe ouvert) : `ia-echec`, `depense-modele-plafond`, `erreur-serveur`, `tcgdex-injoignable`, `arret-serveur`, `panne-SERVEUR`, `panne-INDISPONIBLE`, `panne-IA`, `lot-supplement-verification`, `lot-supplement-en_reconciliation`, `lot-supplement-indisponible`, et `carte-introuvable` / `aucun-candidat` avec une source tombée. **Les motifs plafonnés** : `introuvable`, `ia-sans-lecture`, `numero-illisible`, `carte-introuvable`, `aucun-prix`, `aucun-candidat`, `nom-contredit-egalite`, `nom-contredit-sans-repli`, `egalite-parfaite`, `sans-prix`, `question:*` ; **un motif INCONNU (un futur `panne-XXX` compris) est plafonné** (jamais illimité), compté (`motif-inconnu`) et journalisé sans donnée de scan. **Exception (tour 1) : si la carte sans prix a été tranchée par la RÉPONSE du client (il a choisi ce candidat), le remboursement `sans-prix` du scanner est une DÉCLARATION** : même compteur commun, même plafond par offre, même champ `declaration`. Variables devenues sans objet (ignorées, un seul avertissement au démarrage qui les nomme, jamais un 503) : `V2_PLAFOND_PANNES`, `V2_PLAFOND_QUESTIONS`, `V2_SANS_PRIX_JOUR`, `V2_JUMEAUX_REMBOURSES_JOUR`.

**Au-delà du plafond des déclarations** : aucun remboursement, l'analyse compte normalement (le quota ne remonte pas). `facturation` reste tel quel (`debite: 1, rembourse: false, motif: "plafond-jour", raisonNonRembourse: "plafond-jour"` — contrat stable) ET la réponse porte un champ ADDITIF à la racine, à côté de `offre`, **`declaration`** `{ rendue: boolean, raison: null | "plafond-declarations", plafondJour: entier }`, présent sur la réponse qui a JUGÉ un remboursement de déclaration (`POST /api/retour-live` lectureRatee définitive, `POST /api/identifier/reponse` `aucune` / `ne-sait-pas`, y compris le `410 CODE_EXPIRE` d'un abandon) ; absent pour tout remboursement constaté, un rejeu (déjà rendu) et une réponse par un candidat. `raison` est un CODE, jamais une phrase : à l'extension de le dire à l'utilisateur. Fausse réponse : `retour-live-declaration-plafond.json`. Le refus reste dit par `raisonNonRembourse: "plafond-jour"` (liste publique fermée, aucun code nouveau). Le compte administrateur ne paie rien et ne compte dans aucun.

**Plafond GLOBAL de dépense du modèle (FREIN-CONSTATES, 2026-10-17).** Tous porteurs confondus, par jour de Paris, le serveur compte ce que coûtent les appels au modèle de lecture (la lecture principale et la seconde lecture) et en plafonne le total : `V2_DEPENSE_MODELE_JOUR_USD` (nombre décimal > 0, défaut **5** dollars ; une valeur invalide rend la configuration invalide). Le coût est celui que la réponse du fournisseur rend (`usage.cost`, demandé par `usage: { include: true }`) ; sans coût lisible (ou si l'appel échoue), une estimation prudente est comptée, `V2_COUT_APPEL_ESTIME_USD` (défaut **0,004** $, le coût mesuré d'une identification étant de 0,0032 à 0,0037 $). Le compte est tenu en base (collection `depense_modele`, incrément atomique : plusieurs instances partagent le même compte, un redémarrage ne le remet pas à zéro). **Quand le plafond est atteint, l'appel au modèle n'a pas lieu** : tout scan reçoit `503 INDISPONIBLE` (la même panne que les autres, réessayable, sans détail), **remboursé et hors plafond des constatés** (`facturation { debite: 0, rembourse: true, motif: "panne" }`) ; le client ne voit rien de plus (aucun code nouveau, aucun champ nouveau). Le compte repart à zéro à minuit de Paris. Côté serveur seulement : le motif interne `depense-modele-plafond`, une ligne de journal au PASSAGE du seuil (pas une par scan), et une alerte en base (`alertes`, document `alerte/depense-modele`, `active: true` jusqu'au premier appel du jour suivant). Le plafond vaut aussi pour les scans d'un administrateur.

**Question B5 de l'extension : une analyse dont le prix reste illisible (`lectureRatee` définitive) compte-t-elle dans le quota ?** Elle compte **sauf si** le remboursement de déclaration est accordé — et il n'est tenté que si la réponse ne sert **aucun** `prixRepli` (REPLI-QUOTA : un repli affiché est un prix affiché, le scan compte, `raisonNonRembourse: "prix-repli"`, sans `declaration`) : sous le plafond du jour (1 sans compte, 3 gratuit, 30 Pro), l'unité est rendue au quota (`declaration.rendue: true`, `offre.restant` relu après le rendu) ; au-delà, elle COMPTE (`declaration.rendue: false, raison: "plafond-declarations"`, `facturation.motif: "plafond-jour"`). Une lecture ratée non définitive ne rembourse rien et ne porte pas de `declaration`.

**Taille d'un lot : 20 cartes au plus** (`V2_LOT_CARTES_MAX`, entier de 2 à 100 ; au-delà, la configuration est invalide). `POST /api/banc/correction` suit la même borne (`carte` de 0 à taille − 1 ; `maximum: 99` du schéma est le plafond absolu). `carte` (`/api/identifier/reponse`, `/api/retour-live`) va de 0 à 19 (même variable : une seule source). Un lot de plus de 20 cartes est **refusé, jamais tronqué** : `400 ENTREE` + `detail: "lot-trop-grand-taille"` (le supplément impayable reste `429 QUOTA` + `detail: "lot-trop-grand"`). Dans les deux cas : crédit initial rendu jusqu'à 10 refus par jour de Paris et par compte, `facturation { debite: 0, rembourse: true, motif: "lot" }` ; au 11e, `facturation { debite: 1, rembourse: false, motif: "lot", raisonNonRembourse: "plafond-jour" }`, le refus restant la réponse.

**OFFRE-QUOTA (décision du testeur, 2026-10-13) : plus de scans payants, plus de poches de crédits.** Chaque porteur a un QUOTA QUOTIDIEN d'analyses selon son offre, servi dans l'objet `offre` `{ nom: "sans-compte"|"gratuit"|"pro", restant: entier ≥ 0 (null pour Pro), remiseAZero: ISO 8601 avec décalage du prochain minuit de Paris }` : installation sans compte 3 par jour (`V2_QUOTA_SANS_COMPTE`), compte gratuit **vérifié** 10 par jour (`V2_QUOTA_GRATUIT`), Pro (abonnement actif et `jusquAu` futur) illimité en apparence (`restant: null`) avec un plafond technique invisible (`V2_QUOTA_PRO_PLAFOND`, 200). Un compte non vérifié, un compte ou une installation inconnus, une installation liée n'ont AUCUNE offre plus large : le refus d'avant. L'administrateur est inchangé (débit 0, motif `administrateur`). Ce qui compte : une analyse RENDUE (carte affirmée ou question = 1 ; lot = ⌈N/10⌉) ; un introuvable, une panne et un prix illisible définitif sans repli servi sont RENDUS au quota du jour où ils ont été pris. La remise à zéro est à minuit, heure de Paris (jours de 23 h et 25 h compris). `offre` est servi par la MÊME fonction sur : `POST /api/solde`, toute réponse de `POST /api/identifier` (succès, question, introuvable, refus `QUOTA` avec `restant: 0`, sauf `detail: "lot-trop-grand"` qui sert le VRAI restant : les unités du lot sont rendues), `POST /api/identifier/reponse` (y compris le `410 CODE_EXPIRE`), `POST /api/retour-live`, `POST /api/compte/lier` et `/api/compte/delier`. **Un prix illisible définitif SANS repli servi ne compte pas, dans la limite des déclarations du jour ; AVEC un `prixRepli` servi, il compte** (REPLI-QUOTA, voir §2 bis (f), §3.1 et la question B5) : `POST /api/retour-live` avec `lectureRatee.definitive` rend l'unité au jour où elle a été prise et sert l'`offre` relue APRÈS ce rendu. **L'administrateur** reçoit `nom: "pro"` et `restant: null` (débit 0). **`offre` peut manquer** dans un 200 si sa lecture échoue côté serveur (l'erreur est journalisée, l'analyse n'est pas perdue) : l'extension garde alors la dernière `offre` connue sans la décrémenter et la relit par `POST /api/solde` ; elle n'invente jamais un `restant`. `Solde` garde ses champs ; seule la poche `achete` se débite encore (voir « ACHETE-AVANT-JOUR » ci-dessous), les autres anciennes poches sont en LECTURE SEULE (ni débitées, ni remboursées, ni effacées). `solde.total` compte déjà les réserves en moins pour ces anciens crédits.

**ACHETE-AVANT-JOUR (décision de l'éditeur, 2026-10-17) : les analyses achetées avec la 1.0.5 se consomment AVANT le quota du jour.** Une unité = une analyse du quota du jour (`offre.restant`), ou de la poche `achete` tant qu'elle n'est pas vide.
- **Débit** : `achete` d'abord (tant que `solde.achete ≥ 1`), puis le quota du jour. L'ordre est FIXÉ dans le code ; `V2_ORDRE_POCHES` ne peut toujours pas nommer `achete`. La prise est atomique (jamais sous 0, jamais un double débit : la clé d'idempotence est celle d'aujourd'hui). Une analyse payée sur `achete` ne consomme PAS le quota du jour : `offre.restant` ne baisse pas. Un compte non vérifié n'a aucune poche débitable (il reste refusé comme avant) ; une installation liée à un compte n'a pas de poche propre (ses achats ont migré vers le compte à la liaison) ; l'administrateur ne paie rien, `achete` reste intacte.
- **Un lot** de N cartes (⌈N/10⌉ unités) peut chevaucher les deux poches : chaque unité est prise sur `achete` tant qu'elle n'est pas vide, puis sur le quota du jour, et rendue à SA poche. Tout ou rien comme avant : un supplément impayable annule les unités déjà prises, chacune dans sa poche.
- **Remboursement** : toute unité est rendue dans la poche où elle a été prise (constaté, panne, déclaration, abandon à 24 h, balayage, réparation), TOUJOURS sous les plafonds de remboursement du §3.1 (déclarations 1 / 3 / 30, constats 20 / 50 / 100, refus de lot 10 : ils comptent des analyses rendues, quelle que soit la poche). Un remboursement refusé par un plafond laisse l'analyse achetée consommée.
- **Servi** : `solde.achete` (entier ≥ 0 ; une valeur corrompue en base est servie arrondie vers le bas, ou 0, et comptée) dans chaque `solde` (déjà le cas) et `facturation.poche` (`"achete"` | `"jour"`), champ ADDITIF de la réponse qui débite `POST /api/identifier` (y compris remboursée : il dit où l'analyse avait été prise ; un lot dont toutes les unités sont sur `achete` dit `achete`, sinon `jour`). Absent quand rien n'est débité (administrateur, refus `QUOTA`) et sur les autres routes.
- **Suppression du compte** : `409 CREDITS_ACHETES` tant que `solde.achete > 0` (sans `renonciation: true`).

### 3.2 Quand une carte est affirmée — et quand elle ne l'est PAS (lots JUMEAU-V2)

Une carte n'est `identifiee` que si le produit désigné n'a **aucun jumeau** : aucun autre produit de même métacarte, de même langue de tirage, d'un autre créneau (expansion, numéro). Un champ que le catalogue ne connaît pas compte comme « même ». Le serveur ne devine jamais : la lecture du code et du numéro sur la photo peut désigner un vrai produit qui n'est pas celui de la carte (même fiche de jeu, autre set).

| le produit désigné a… | issue | `statut` | `raison` / `erreur.code` | facturation |
|---|---|---|---|---|
| aucun jumeau | affirmée | `identifiee` | — | `affirmee`, `debite: 1` |
| 1 ou 2 jumeaux (3 produits au plus) | question de départage entre le produit et ses jumeaux | `a-trancher` | — | `question`, `reserve: 1` (comme toute question) |
| plus de 3 produits avec ses jumeaux (JUMEAUX-QUESTION, 2026-10-17) | question de départage à **3** candidats choisis dans le groupe (le produit de la chaîne d'abord, ci-dessous) | `a-trancher` | — | `question`, `reserve: 1` (comme toute question) |
| plus de 3 produits dont une ligne de catalogue d'un jumeau manque (ou plus de 60 jumeaux) : le repli d'avant | introuvable | `introuvable` | `impression-indeterminee` | rembourse (`introuvable`), `debite: 0`, dans le plafond des constatés (FREIN-CONSTATES) |
| la liste des jumeaux ne peut pas être établie pour CE produit (colonne absente, produit plus récent que l'archive sous sa métacarte, jumeau sans ligne au catalogue, démarrage à froid) | **panne** | — | `erreur.code: INDISPONIBLE` (503) | rembourse (`panne`), `debite: 0`, hors plafond (panne `INDISPONIBLE` de NOTRE infrastructure, jamais facturée) |

- **Plus de 3 produits : une question à 3, jamais une affirmation (JUMEAUX-QUESTION).** Le serveur ne rend plus `impression-indeterminee` dès qu'un produit a plus de 2 jumeaux : il pose la question de départage habituelle (même forme, mêmes codes de question que §3.2) avec **3 candidats** : le produit désigné par la chaîne (TOUJOURS), puis deux de ses jumeaux, choisis par des critères nommés dans cet ordre : (1) le rang dans le classement de la chaîne, (2) le numéro lu sur la photo, identique au numéro du produit, (3) le numéro du produit inconnu, (4) l'`idProduct` (ordre stable) ; **jamais le prix**. Un jumeau dont le nom est contredit par le nom lu en confiance haute n'est pas montré (filtre de CONFIRMATION-SURE). L'ordre d'affichage des 3 choix reste celui du contrat (`idProduct`), pas celui du classement. **Facturation : celle d'une question ordinaire** (crédit réservé ; `aucune` et `ne-sait-pas` sont des DÉCLARATIONS, dans le plafond des déclarations du jour). **Ce que ça change pour le client** : avant, ce scan était un introuvable constaté par le serveur, rendu SANS plafond ; désormais le client reçoit la question, et s'il répond « aucune », le crédit lui est rendu SEULEMENT dans la limite des déclarations du jour (sans compte : 1 par jour) ; au-delà, il est débité (`plafond-jour`). `impression-indeterminee` reste produite, mais seulement par le repli ci-dessus.
- **`impression-indeterminee`** est une valeur **additive** de la liste fermée des `raison` d'un introuvable. Ce que le client doit afficher : *« plusieurs impressions de cette carte existent ; la photo ne permet pas de dire laquelle »* (et inviter à photographier le bas de la carte, code du set et numéro). Elle ne veut **pas** dire « photo illisible » : la carte est reconnue, c'est son impression qui ne se tranche pas. Un client qui ne la connaît pas la traite comme toute raison inconnue (repli sur un texte générique d'introuvable).
- La panne `INDISPONIBLE` est un échec de NOTRE côté (la photo n'y est pour rien) : le client peut réessayer plus tard.
- **Les refus de la garde des jumeaux.** Ces deux refus sont NOS refus, pas des échecs du client : ils sont CONSTATÉS par le serveur et rendus **dans le plafond des constatés** (20 / 50 / 100 par jour, FREIN-CONSTATES, 2026-10-17 ; PLAFOND-DECLARE les avait rendus sans plafond, 2026-10-14 ; l'ancien compteur dédié de 20 et son repli sur le plafond de pannes n'existent plus, `V2_JUMEAUX_REMBOURSES_JOUR` est sans objet). L'unicité par scan reste (un scan ne se rembourse qu'une fois).
- Le serveur n'affirme **jamais** un choix « 3 parmi N » : il le **montre** comme une question, et le client tranche. Mesure (banc réel, 72 cartes qui étaient des `impression-indeterminee`) : la bonne carte figure parmi les candidats montrés dans 67 cas sur 71 étiquetés (nom lu en confiance haute, repli de chargement compris). **Le filtre de nom vaut pour tous les candidats, le produit de la chaîne compris** (un nom contredit n'est jamais proposé), et la question exige **au moins 2 candidats restants** : s'il n'en reste **aucun** (le nom lu contredit le produit de la chaîne et tous ses jumeaux), la carte est `introuvable` / `photo-illisible` (remboursée sans plafond, comme tout introuvable) ; s'il n'en reste **qu'un**, jamais une confirmation à 1 candidat dans ce chemin : c'est le repli `introuvable` / `impression-indeterminee`. La même issue de repli vaut quand une ligne de catalogue de jumeau manque ou que le groupe dépasse 60 jumeaux. Si le produit de la chaîne est contredit mais que 2 jumeaux au moins restent, la question est posée sans lui.
- **La péremption se juge par produit.** La colonne des jumeaux porte le plus grand `idProduct` qu'elle connaît. Pour un produit que la chaîne affirme, le serveur cherche, par une requête indexée, un produit **plus récent que l'archive** de **la même métacarte** : s'il en existe un, ce produit-là ne conclut pas pour ce scan (panne `INDISPONIBLE`) ; un produit ajouté sous une autre métacarte ne bloque rien. Si la requête échoue, la garde ne conclut pas.
- Les motifs internes précis (`jumeaux-trop-nombreux`, `jumeaux-indisponibles`, `jumeaux-perimes`, `jumeaux-incomplets`) ne sont **pas servis** ; ils sont écrits côté serveur (`analyses.cartes[i].motifJumeaux`, par carte, y compris dans un lot) et comptés. Une panne n'écrit pas d'analyse : sa trace est le journal et le compteur.
- Dans un **lot**, la garde s'applique carte par carte : une carte à jumeaux devient une question de lot, une carte à plus de 3 produits devient une question de lot à 3 candidats (sauf repli : `introuvable / impression-indeterminee`), une carte dont la liste de jumeaux ne s'établit pas est `introuvable / panne-lecture`. Le lot est remboursé en entier seulement si **toutes** ses cartes sont des refus de la garde (une unité par carte) ou si aucune carte n'est lue ; un lot **mixte** (une carte refusée par la garde parmi d'autres introuvables) suit les règles ordinaires (introuvable, rendu sans plafond). Une carte refusée par la garde dans un lot partiellement lu est facturée avec le lot (sauf si aucune carte du lot n'affiche de prix : le lot est alors rendu en entier, §2 bis (f)).
- **GARDE-CONTRADICTION (2026-10-17).** Une carte n'est jamais `identifiee` quand un champ lu sur la photo (numéro, code de set, total, attaque, set TCGdex de la carte) contredit le produit de la chaîne ET concorde avec un autre candidat du vivier qu'aucun champ lu ne contredit : le client reçoit une question `a-trancher` entre le produit et ce que les champs désignent (3 choix au plus, le plus étayé d'abord). Un champ inconnu d'un côté ou non lu ne contredit rien ; une contradiction que personne n'étaye ne fabrique pas de question. Elle précède la garde des jumeaux (`v2/identifier/garde-contradiction.js`, appelable seule) ; son résumé reste côté serveur, jamais servi.
- **CRITÈRE A (2026-10-17, décision D2 rouverte).** Quand la garde des jumeaux refuserait d'affirmer le produit P (question de départage, ou plus de 3 produits), P est tout de même `identifiee` si, la garde contradiction étant passée en premier, le code de set ET le numéro lus concordent avec P et avec lui seul parmi ses jumeaux (aucun champ lu ne le contredit, aucun jumeau n'a un numéro inconnu ou identique, le nom lu ne le contredit pas) ; un code non lu, un numéro porté par deux produits, un jumeau dont le numéro est inconnu : la réponse d'avant, inchangée. Le nom seul ne tranche jamais (`v2/identifier/critere-a.js`, constante `CRITERE_A`). Le motif reste côté serveur (`critere`), jamais servi. Conséquence pour les clients : certaines cartes qui revenaient en `a-trancher` sont désormais `identifiee`.
- **LANGUE DÉCISIVE (2026-10-17, nuit, cas réel Dark Tyranitar 30th Celebration JP n° 144/103).** `v2/identifier/langue-decisive.js` réduit une QUESTION de la garde contradiction ou des jumeaux par ce que la photo dit, règle par règle, chacune mesurée sur tout le banc étiqueté (0 faux ou éteinte). **R1 (allumée)** : la langue lue est « certaine » seulement si la langue du modèle ET l'écriture du nom brut concordent (kana ⇒ ja, hangul ⇒ ko, idéogrammes sans kana ⇒ zh, cyrillique ⇒ ru, latin ⇒ une langue occidentale) ; un candidat dont la langue de TIRAGE est connue et différente (`langueCompatible`, une seule fonction) est retiré de la question ; un tirage inconnu (id, th, idth) ne retire rien ; si tous seraient retirés, la question d'origine reste. **R4 (allumée)** : un code lu qui ne désigne AUCUN produit du vivier (vivier entièrement chargé) ne bloque plus le critère A ni la résolution ; un code qui désigne un autre produit bloque toujours. **R2** (illustration : score d'image de la photo, deux seuils bas 4 / haut 20) et **R2 bis** (attaque lue en confiance haute, avec repli) sont codées, mesurées à 0 faux et **ÉTEINTES** (voir le rapport du lot) ; R2 attend que la route fournisse `ctx.scoresImage`. Quand il ne reste qu'UN candidat et qu'il tient les conditions du critère A (numéro lu exactement concordant, aucun champ veto — numéro, total, set TCGdex, langue — ne le contredit, code concordant ou R4, nom non contredit), la carte est `identifiee` (chemin d'argent inchangé : une affirmation née d'une question déjà réservée règle la réservation comme une réponse) ; s'il en reste 2 ou 3, la question ne porte que sur eux. **R3 (le numéro de la photo prime sur le titre)** : mesuré, aucun cas où le titre l'emporte (110 annonces au titre « N/T », 106 d'accord, 4 divergences dont 3 Dark Tyranitar 143 contre 144 où la chaîne a gardé la photo, juste) : rien n'est changé. **Contrat 7a, AJOUT seulement** : `impressions[].langue` = code fermé minuscule (`fr en de es it pt nl pl ru cs hu ja ko zh-hans zh-hant`) ou `null` (jamais devinée : un tirage `intl` regroupe plusieurs langues, `id`/`th`/`idth` ne sont pas dans la liste) ; `carte.langue` NE CHANGE PAS (texte libre `EN`/`JP`/`ZH` : un changement de format publié, à coordonner avec l'extension, le site et le scanner).
- **LANGUE DÉCISIVE, tour de correction 1 (2026-10-18).** (B1) Le candidat que la photo laisse SEUL passe par la même garde des jumeaux que toute affirmation (groupe lu dans la colonne des jumeaux et le catalogue, pas dans le vivier) : un jumeau de même numéro ⇒ pas de sûr ; la route et le lot chargent donc, avant l'adaptation, les jumeaux des candidats que la garde contradiction désigne (`langue-decisive-charge.js`). (M1) Il faut TOUTES les conditions du critère A (`critere-a.conditions`, une seule définition) : aucun champ lu en « ko » (l'attaque lue contredisant le restant ou le symbole bloquent), sauf le code sous R4. (M2) R4 se juge sur le CATALOGUE ENTIER : un code lu qui désigne un produit du catalogue au même numéro (index code × numéro, `catalogue.indexCodeNumero()`, construit une fois, gardé 6 h) bloque ; index absent ou en panne : R4 fermée. (R5, ÉTEINTE depuis le 2026-10-18 : elle ne passe qu'à 0 faux sur le banc de réglage ET sur le banc de contrôle, et le second est vide) Un candidat d'un set SANS numérotation (liste figée de 9 `idExpansion` : EXP 4169, ROG 4465, PJU 4463, MFO 4464, SI-JP 4357, N1 4506, N2 4507, N3 4508, N4 4509) est retiré de la question quand le numéro ET le total sont lus (jamais un numéro seul : les cartes DP impriment un « DPBP#nnn ») et qu'un autre candidat, hors liste, a un total concordant ; jamais tous retirés. Un restant refusé laisse la question réduite par la langue seule.
- **LANGUE DÉCISIVE, tour de correction 2 (2026-10-18).** (M-A) R4 ne joue que si le code lu est CONTREDIT par tous les produits du vivier (hors le candidat testé) ET par tous ceux de l'index au même numéro (hors le code du candidat testé) : un code tronqué ou de sous-set (« SV-P » face à SV-P/CS, « sv4 » face à SV4A), que `comparer` ne juge pas contredit, DÉSIGNE un produit et bloque ; un code de 2 caractères (« m6 ») est jugé contredit par `comparer` (sous LONGUEUR_MIN_PARENTE) et R4 suit la production. (M-B) L'index code × numéro a un plancher nommé (`INDEX_CODE_NUMERO_MIN` = 10 000 couples ; le catalogue en porte ~62 000) : en dessous il est tenu pour en panne, R4 est fermée, compté et journalisé sans valeur. (M-C) `preparer` ne prépare que le SURVIVANT UNIQUE de la réduction, sous un plafond de 200 produits lus et un délai de 3 s ; sinon rien n'est préparé et la question reste réduite par la langue. La variante « attaque tolérée pour le seul restant » est RETIRÉE du code (un faux sûr prouvé en relecture) : le cas Dark Tyranitar reste une question à deux choix jusqu'à l'index nom × attaque (lot R6, à part).
- **PRODUITS PARTAGÉS (REPLI-REIMPRESSIONS, 2026-10-17, étape 6 du testeur).** Quand le catalogue marque un visuel « partagé » (`partageeHoloNonHolo` : le même scan sert le produit holo et le non-holo, Prize Packs S1-S4 ; `partageeTamponNonSepare` : le même scan sert une paire dont l'une est tamponnée, les 64 paires Black Star ; `produitsPartages` : les produits concernés), l'IMAGE ne départage jamais ces produits. Les autres produits du groupe comptent comme les jumeaux de la garde ci-dessus, **bien qu'ils soient du même créneau (expansion, numéro)** : un produit marqué n'est donc jamais `identifiee` par la comparaison d'images de la chaîne, ni par la règle G ; le client reçoit la question de départage entre les produits partagés (2 à 3 choix, mêmes codes que §3.2 : `visuel` quand rien d'autre ne les sépare). Seul le CRITÈRE A, c'est-à-dire le code ET le numéro lus, peut encore affirmer l'un d'eux, et seulement quand il le désigne SEUL (deux produits au même numéro et au même code ne sont jamais séparés). Une paire **séparée** par l'étiquette Cardmarket (`partageeTamponNonSepare: false`, `variante` : une marque ou un ensemble de marques de la liste fermée — `staff`, `league`, `staff+prerelease`… —, `jumbo`, `normale`) est traitée comme une paire non séparée TANT QUE la lecture des marques sur la photo (ci-dessous) ne l'a pas tranchée : l'image ne prouve jamais le tampon ni le Jumbo. **Le partenaire d'un produit partagé n'est jamais coupé d'une question** : pour une question de départage à plus de 3 produits, le produit et ses partenaires passent en premier ; pour une question de la chaîne, les partenaires de ses candidats sont ajoutés ; au-delà de 3 produits, jamais une question tronquée : l'introuvable `impression-indeterminee`. **Texte d'aide (code `visuel` inchangé, la liste des codes est fermée et aucun autre ne convient)** : quand deux des produits proposés se partagent la même image, l'aide ne renvoie pas à l'illustration mais dit « Ces cartes ont la même illustration : regardez la brillance (holo ou non) ou le tampon sur les photos de l'annonce » (en anglais : « These cards share the same artwork: look at the shine (holo or not) or the stamp in the listing photos. »). Aucun champ de réponse ne change ; `variante` (`normale`, `jumbo`) peut apparaître sur un produit du catalogue dès que les lignes la portent (`staff` n'est pas servi : hors liste fermée de `Produit.variante`).
- **AUCUNE IMAGE D'UN AUTRE TIRAGE AUX RÉIMPRESSIONS (REPLI-REIMPRESSIONS).** L'archive des visuels ne porte plus d'entrée pour un produit des familles suivantes dont le visuel serait celui d'un autre tirage (`autre-tirage`, ou `substitut` d'un autre set) : les 8 sets 30th Celebration (toutes langues), les 9 Prize Packs, les 20 WCD, les Battle Academy 2020/2022/2024 et Trick or Trade 2024 (nommés « tamponnées sans source » par la décision du testeur), et tout produit dont le slug Cardmarket nomme `Staff` ou `Prerelease`. Une image que le catalogue marque `imageEmprunteeTirage: true` (l'image du tirage normal, pour l'affichage du site seulement) n'est jamais servie non plus. Le produit reste au catalogue, sans visuel : l'absence est honnête, le visuel d'un autre tirage ne l'est pas. La liste est fermée (`FAMILLES_SANS_REPLI`, `v2/chargeur/decision.js`) ; un set qui lui ressemble sans y figurer est signalé à la construction (`familleHorsListe`), imprimé par la construction de l'archive et par le journal du chargeur. Une image marquée partagée dont le produit n'est pas dans sa liste n'est pas servie (compteur `partageIncoherent`) ; `variante` n'est portée que si la ligne a sa `variantePreuve` (compteur `varianteSansPreuve`).
- **DÉSIGNATION PAR LE NUMÉRO LU (DESIGNATION, 2026-10-18).** Sur une question (de la chaîne, de la garde ou des jumeaux) qui a déjà passé la garde contradiction, le critère A et LANGUE-DECISIVE, le candidat que le NUMÉRO lu est seul à satisfaire est affirmé (`identifiee`, critère « désignation (numero) »). Il l'est seulement si :
  - tous les autres candidats sont contredits par ce numéro ;
  - aucun champ lu ne contredit le candidat désigné : le veto de l'attaque et du symbole est GARDÉ ;
  - tout jumeau du désigné est dans la question et contredit lui aussi ;
  - aucun produit de la même famille (même métacarte ou même nom) hors de la question n'est aussi peu contredit dans le catalogue entier ;
  - ce n'est pas une paire partagée.
  La facturation suit l'issue retenue, comme pour le critère A. Les règles par l'attaque seule et par le critère A sans veto de l'attaque ou du symbole ont été RETIRÉES : elles affirmaient un rival quand l'attaque ou le numéro est mal lu (contre-exemples construits, et 2 cas réels sur 116). **Une désignation n'a pas de second témoin** quand la question est réduite à des jumeaux de même dessin (la seconde lecture ne s'y applique pas) : elle est la dernière garde. Aucun champ de réponse ne change.
- **LECTURE DES MARQUES (F1-TAMPON puis TAMPONS, 2026-10-18), derrière `V2_LECTURE_TAMPON` ET `V2_EMPREINTE_EXTENSION` (ÉTEINTS par défaut ; le fournisseur du modèle est branché au montage, sous le plafond global de dépense).** Une question — de la chaîne, de la garde des jumeaux ou des partenaires de partage — dont les candidats sont EXACTEMENT une paire que l'archive prouve séparée (`partageeTamponNonSepare: false` des deux côtés, la paire nommée par les listes OU séparée par la variante — même visuel, même fiche —, `variante` : un ensemble de marques de la liste fermée d'un côté, `normale` de l'autre, `tamponNonRepresente` non vide) déclenche une lecture ciblée ; aucune autre question ne lit rien (0 coût inutile). Un appel au modèle ne pose qu'UNE question sur la carte : quelles marques de la liste fermée (`staff`, `prerelease`, `league`, `championship`, enseignes, `professor`, `cosmo`, `snowflake`, `play-pokemon`, `place-1` à `place-4`) sont visibles, avec les issues « autre » (une marque hors liste) et « incertain » ? **Deux essais indépendants (deux préparations de l'image) doivent lire le MÊME ensemble NON VIDE, sans « autre »,** et cet ensemble doit être EXACTEMENT la variante prouvée du produit tamponné de la paire : ce produit est alors `identifiee` (critère « tampon (<jeton>) », réservation de la chaîne réglée comme une réponse : même argent qu'une affirmation). Tout autre résultat — rien lu, « autre », marque hors liste, sous-ensemble, sur-ensemble, ensemble différent d'une lecture à l'autre, incertain, panne, délai, pas d'octets, deuxième passage pour le même scan, un champ lu qui contredit le produit tamponné — laisse la question d'avant, sans débit ni remboursement de plus. **On n'affirme JAMAIS la version normale sur une absence de lecture** : un tampon manqué n'est pas un tampon absent. Une question à plus de deux candidats (la paire et un tiers) ne déclenche rien. **Jumbo : une question.** La règle « jumbo par le titre » est RETIRÉE (elle ne se défend pas contre la négation : « pas de jumbo », « not a jumbo »…) ; une paire jumbo / normale reste une question. La réponse ne change que par l'issue (une affirmation de plus) et, pour une fiche marquée `prixMelangeTampon`, par la mention de la règle 2 ci-dessus ; le motif et le coût (`analyses.lectureTampon` : `declenchee`, `appels`, `type`, `issue`) restent côté serveur. **Ce que l'extension doit envoyer pour que la lecture ait lieu** : RIEN de plus que pour l'empreinte. La lecture ne lit que `empreintes[i].carte`, la carte redressée jointe au vecteur et validée par MODELE-VISUEL-API (JPEG, exactement 420 × 587, 200 Ko au plus) ; pas de photo pleine, pas de géométrie, le serveur ne télécharge jamais la photo. Sans carte valide, ou avec `V2_EMPREINTE_EXTENSION` éteint, la lecture ne se déclenche pas (0 appel) et la question reste. Chaque appel au modèle est compté dans le plafond global de dépense (`V2_DEPENSE_MODELE_JOUR_USD`) : plafond atteint, aucune lecture, la question reste. Lecture des prix de la règle 2 : voir « Les prix mélangés ».
- **Ce qui change RÈGLE ÉTEINTE (TAMPONS, tour 1).** La lecture, elle, ne change rien interrupteur éteint (réponse identique octet pour octet pour cette étape). Deux choses changent dès qu'une archive du nouveau code est servie : (1) `marques` est TOUJOURS servi (champ additif, `null` tant que la variante n'est pas prouvée) ; (2) F4 lit la colonne des prix mélangés de l'archive dès qu'elle la porte : un produit marqué sort `fiable: false` avec les deux mentions, indépendamment de la lecture. **Conditions BLOQUANTES de publication** : (a) l'archive du nouveau code n'est publiée qu'APRÈS le déploiement du code (l'ancien code refuse en entier une archive qui porte une section ou un jeton qu'il ne connaît pas) ET après la correction par le catalogue de Doublade MEP 067 (877546) et Delphox MEP 074 (884752), dont la variante `normale` donnerait `marques: []` (« prouvé sans tampon ») à tort ; (b) retour arrière : le code et l'archive reculent ensemble.
- **Ordre de déploiement (REPLI-REIMPRESSIONS).** L'archive qui porte les marquages est du **format 2** (colonne `mar.*`) : le CODE qui la lit doit être déployé AVANT sa publication (un lecteur d'avant refuse un format inconnu, il ne l'ignore pas). Une archive d'avant (format 1) reste lisible par le nouveau code, sans marquage : le comportement d'avant, rien n'est conclu.
- Limite connue de la donnée : un produit dont la métacarte n'est pas renseignée au catalogue ne peut pas être affirmé (le client reçoit la panne `INDISPONIBLE`, pas un introuvable), et il ne peut être le jumeau de personne.
- Conséquence pour les clients : une carte qui s'affirmait auparavant peut désormais revenir en `a-trancher` (2 ou 3 choix), en `introuvable`, ou le scan peut répondre `503 INDISPONIBLE`. Rien d'autre ne change dans la forme des réponses.
- **Ordre de déploiement (JUMEAU-V2).** L'archive des visuels **avec la colonne des jumeaux** doit être publiée AVANT le code qui la lit : sans elle, toute affirmation répond `503 INDISPONIBLE` (remboursée). L'API réessaie le chargement de l'archive toutes les 5 minutes tant que la colonne manque (au lieu d'attendre le réveil suivant), et écrit une alerte en base (`alertes`, document `alerte/archive-visuels`) quand il n'y a aucune archive, qu'elle n'a pas la colonne, ou qu'elle a plus de 48 h. **Au premier démarrage de l'allumage, vérifier** que la voie « fichier » est ouverte (les variables de lecture de l'archive privée et son secret HMAC sont présents) et que la colonne des jumeaux est chargée : une voie fermée par défaut ne démarre pas le chargeur et ne pose AUCUNE alerte, toute affirmation répond alors `503 INDISPONIBLE` sans reprise.
- **Limite de la garde de péremption, et ce qui la rend acceptable.** La garde ne voit un produit ajouté depuis l'archive que si son `idProduct` est supérieur au plus grand `idProduct` de l'archive (`maxArchive`) : un produit ajouté avec un identifiant plus petit, sous la métacarte du produit affirmé, passerait sans être vu. **Mesure** (`products_singles_6.json` du 12/07, 62 579 produits datés) : sur les 60 derniers jours, aucun des 5 467 produits ajoutés n'a un identifiant inférieur à celui d'un ajout antérieur ; les identifiants croissent avec la date d'ajout. Cette hypothèse n'est pas gardée par un contrôle : elle est mesurée, pas prouvée.
- **Durée et ampleur du refus de péremption.** Un produit refusé pour cette raison l'est (panne `INDISPONIBLE`, remboursée, jamais une affirmation) jusqu'au chargement par l'API d'une archive refabriquée : environ **12 h en moyenne, 24 h au pire** pour une instance éveillée en continu (rechargement quotidien), jusqu'au prochain réveil après le dépôt pour une instance qui dort. La reprise toutes les 5 minutes ne couvre que « colonne absente », pas « colonne en retard ». **Ampleur**, par métacarte touchée : pour 30 à 100 produits neufs, **0,4 à 0,5 %** du catalogue (269 à 358 produits anciens sur 70 975) ; pour 300 produits neufs, **1,5 %** (1 058). Ces produits sont des réimpressions de cartes courantes : la part du trafic est plus grande que la part du catalogue, sans que ce soit chiffré.

### 3.3 Un seul candidat : la question « est-ce cette carte ? » (lot UN-CANDIDAT, décision D1 du testeur, 2026-10-13)

**Règle : ce qui n'est pas affirmé devient une question, jamais un « sous réserve ».** Quand la chaîne désigne UN SEUL produit sans l'affirmer (une ambiguë à un candidat, ou une égalité dont les candidats se réduisent à un), le serveur ne répond plus `introuvable` : il passe d'abord ce produit par la garde des jumeaux (§3.2), puis :

| la garde dit… | issue | `candidats` / `question` |
|---|---|---|
| aucun jumeau | `a-trancher` | UN candidat ; question de code `confirmation`, UN choix `a` (« Oui, c'est cette carte »), `zone: null` |
| 1 ou 2 jumeaux | `a-trancher` | la question de départage ordinaire à 2 ou 3 (§3.2) |
| plus de 3 produits | `a-trancher` si au moins 2 candidats restent après le filtre de nom | la question à 3 du §3.2 (JUMEAUX-QUESTION) ; **0 restant** : `introuvable` / `photo-illisible` ; **1 restant** ou une ligne de jumeau manquante : repli `introuvable` / `impression-indeterminee` (jamais une confirmation à 1 candidat) |
| ne peut pas conclure | panne `INDISPONIBLE` (503), remboursée | jamais une question ni une affirmation |

Exception inchangée : `nom-contredit-sans-repli` reste `introuvable` / `photo-illisible` (le nom CONTREDIT les candidats). Zéro candidat reste `introuvable`.

Candidats contredits par le nom lu (CONFIRMATION-SURE) : avant toute question (confirmation ou départage), un candidat dont le nom est contredit par le nom lu sur la photo (lu en confiance `haute`, règle `nomConcorde` de la chaîne héritée complétée par un test de mots communs hors propriétaire, puis par l'espèce) est retiré ; un nom lu absent ou de confiance non `haute` ne retire rien. Il en reste 0 : `introuvable` / `photo-illisible` — y compris pour `egalite-parfaite`, dont les candidats tous contredits ne rendent plus `hors-catalogue` (jamais une absence affirmée) ; 1 : la règle du candidat unique ; 2 ou 3 : la question de départage. Un propriétaire en préfixe partagé (« Whitney's », « Team Magma's ») ne suffit pas à rapprocher deux cartes.

- **Ce que l'extension affiche** : la fiche du candidat (`candidats[0]` : visuel, nom, set, numéro) et DEUX boutons : OUI (réponse `choix: "a"`, l'`id` du seul choix) et NON (réponse `choix: "aucune"`, qui existe déjà : aucune valeur nouvelle dans `RequeteReponse`). Le texte de la question (`texte`, `aide`) est fourni dans la langue de l'interface.
- **Étiquetage administrateur (§1.7 bis)** : pour la confirmation comme pour une question à 2 ou 3 candidats, l'extension PROPOSE chaque candidat en un clic ; ce clic envoie `POST /api/banc/etiquette` avec `verdict: "corrige"` et l'`idProduct` du candidat (prérempli). `juste` ne vaut que pour une affirmation initiale (`409` sinon, même après un OUI).
- **OUI** : la carte est `identifiee` (le candidat), facturée comme toute question répondue (`debite: 1, motif: "question"`). **NON** : la carte est `introuvable` / `hors-catalogue`, le crédit réservé est rendu (`debite: 0, rembourse: true`), une seule fois par scan. **Abandon** (`ne-sait-pas`, ou sans réponse sous 24 h) : crédit rendu, la carte reste à trancher.
- **L'argent est celui de toute question** : crédit RÉSERVÉ à l'émission (`debite: 0, reserve: 1`), même claim d'unicité par scan, même balayage à 24 h. Le remboursement d'un NON ou d'un abandon passe par le compteur des DÉCLARATIONS du client (sans compte 1, gratuit 3, Pro 30 par jour de Paris, §3.1) : au-delà l'analyse compte (décision PLAFOND-DECLARE du testeur, 2026-10-14, qui remplace l'ancien « un client ne paie jamais plus qu'avant »).
- **Dans un lot**, une carte à candidat unique est une question de lot comme les autres (`lot: true`) : répondre NON ne rend rien carte par carte, le lot ayant été payé d'un seul bloc (§3.1). **Le client ne paie jamais plus qu'avant** : le LOT ENTIER est rendu, UNE fois, quand sa dernière question de confirmation est réglée (NON, `ne-sait-pas` ou abandon au balayage de 24 h) et que CHACUNE de ses cartes est alors un `introuvable` ou une confirmation non confirmée. Une carte affirmée, une confirmation OUI ou une question à 2 ou 3 candidats (quelle que soit sa réponse) : le lot n'est pas rendu par cette règle. Le remboursement est celui d'un lot entièrement introuvable, mais compté comme une DÉCLARATION (compteur des déclarations, même unicité par scan : deux NON simultanés ne rendent qu'une fois). Un lot sans question reste remboursé comme avant s'il est entièrement introuvable. **Un lot dont aucune carte n'affiche de prix (LOT-SANS-PRIX, §2 bis (f)) est déjà rendu en entier à l'analyse**, questions comprises (elles restent posées et répondables) : sa décision est écrite sur ses questions : toute réponse (OUI, NON, rejeu) sert `facturation { debite 0, rembourse true, motif sans-prix }` et ne rend rien de plus ni ne touche le compteur des déclarations. Réserve assumée : un OUI sur une confirmation dans un lot de confirmations est une carte reconnue, le lot est alors payé. **`ne-sait-pas` dans un lot est une réponse FINALE** : elle compte comme une confirmation non confirmée pour cette règle, et un OUI qui la suit sur la même carte répond `409 CONFLIT`. Si le plafond des déclarations du jour est atteint, le lot n'est pas rendu et la réponse du dernier NON le dit (avec `declaration`) (`facturation { debite, rembourse: false, motif: "plafond-jour", raisonNonRembourse: "plafond-jour" }`, redite à l'identique au rejeu). **Ce que fait le serveur quand le remboursement d'un lot ne peut pas se faire tout de suite** (erreur du ledger, analyse absente, arrêt du processus) : (1) si le remboursement échoue, l'état « lot à rendre » est écrit en base et la réponse porte le champ additif `remboursementEnAttente: true` (`facturation.rembourse` reste faux : lire le solde plus tard) ; (2) le JUGEMENT du lot est un état dérivé : à chaque passage, le balayage (toutes les minutes) rejuge les lots dont toutes les questions sont réglées sans décision ni marque, et reprend les lots « à rendre », du plus ancien, **au plus `V2_LOT_REPRISES_PASSAGE` lots (défaut 200) par phase et par passage** ; (3) le rejeu d'un NON de lot rejuge aussi, idempotent (même claim `rb|scanId`, jamais deux remboursements) et relit le grand livre : « déjà rendu » répond `rembourse: true` ; la REPRISE d'un remboursement partiel déjà commencé pour ce scan (une claim « fait » de ce scan existe) ne recompte pas le plafond de pannes, qui a été compté à la première tentative ; et le plafond n'est jamais écrit comme décision définitive quand des unités du lot sont déjà rendues (le lot reste « à rendre » et listé) ; (4) « rendu » se juge sur les MOUVEMENTS du grand livre (un remboursement de `delta 1` par unité débitée), pas sur l'état du débit : l'état ne s'efface que lorsque TOUT le montant du lot (`ceil(N/10)` unités) est rendu ; un débit marqué rendu SANS mouvement correspondant est ambigu, jamais pris pour rendu : le lot est aussitôt marqué « à rendre » (donc listé par `lotsARendre`, jamais décidé « plafond-jour » ni « rendu »), et le débit est listé par la réconciliation (`debitsRembourseSansMouvement`) au-delà de `V2_CLAIM_ORPHELINE_MIN` minutes (60 à 10080, défaut 60) mesurées depuis la dernière tentative de remboursement du scan (à défaut de toute ligne de remboursement pour ce scan, depuis la date du débit) ; **MOYENS-B2a, l'ordre du grand livre** : la prise d'une unité écrit `rendu-en-cours` AVANT de rendre le crédit, puis le crédit est rendu, sa trace (`delta 1`) est écrite, et SEULEMENT alors la ligne passe `rembourse` (même règle pour une unité rendue seule, `rembourserLigne`) ; un arrêt n'importe où dans cette séquence laisse une ligne `rendu-en-cours`, listée AUSSITÔT par la réconciliation (`rendusEchoues`, sans attendre de délai), jamais reprise seule ni rendue deux fois, et comptée comme « prise sans trace » par le jugement du lot. **Tant qu'une unité est `rendu-en-cours`, le remboursement répond « remboursement-en-cours » (cause interne, publiée comme `erreur` : le client lit `rembourse: false`, jamais « remboursé » pour un crédit non écrit) ; le lot reste « à rendre » et listé.** **Issue : un geste d'OPÉRATEUR, pas automatique** (décision du coordinateur, réversible) : l'outil `v2/argent/reparer-debit.js` (AUDIT-SECURITE-V2.md §15) refait la preuve par le grand livre et, selon l'écart de poche, rend le crédit et écrit la trace, ou écrit la trace seule, ou clôt la ligne en `rembourse` quand la trace existe déjà ; jamais un second crédit. Il refuse tant qu'un mouvement du porteur sur la même poche date de moins de `V2_REPARATION_AGE_MIN` minutes (entier de 5 à 1440, **défaut 15**). Un débit `rembourse` sans mouvement n'existe que d'AVANT ce lot (même outil). **Tour 2 : un crédit se reconnaît par son DÉBIT** — l'identité du débit est posée sur le document de la poche dans la MÊME écriture atomique que le crédit (`creditsRendus`, les 200 derniers), et la trace +1 porte `debitId` sous un index unique : deux chemins qui rendent le même débit (balayage, remboursement d'une unité, annulation d'un supplément, réparation, compensation de `debiter`) n'écrivent qu'UN crédit et UNE trace **tant que l'identité du débit est dans le marqueur, c'est-à-dire pour les 200 derniers débits rendus par DOCUMENT de poche** (`comptes` : accueil, acheté ET abonnement partagent un marqueur ; `installations` : essai et acheté ; `hebdo` : un par semaine). **Limite exacte : au-delà, l'identité la plus ancienne sort ; la réparation REFUSE alors (`marqueur-sature`) un débit pris dont l'identité n'est pas dans un marqueur plein — elle ne crédite jamais sans preuve, `reconcilier` liste la ligne avec son geste (vérifier à la main le grand livre).** Une unité hebdomadaire ne survit pas à sa semaine : sans marqueur ni document hebdo, la ligne se CLÔT sans crédit (`semaine-expiree`). La réparation lit ce marqueur et cette trace, l'écart de poche n'est plus qu'un témoin (il ne juge que les débits d'avant le tour 2, sans marqueur ni trace). Un débit pris depuis moins de `V2_REPARATION_AGE_MIN` minutes (`priseLe`) est tenu par un remboursement vivant : la réparation attend. `poche-deja-compensee` (le crédit de CE débit est déjà sur la poche : compensation puis écriture tardive) est une cause interne : la passe de rattrapage la lit, et un client peut la lire si la réponse du crédit s'est perdue (`rendu-echoue` dont le crédit EST écrit) puis qu'il rejoue le remboursement ; publiée, elle est `erreur` avec `rembourse: false` alors que le crédit est écrit — la réparation prouve ce crédit par son marqueur, écrit la trace et clôt la ligne ; (5) la réconciliation liste les lots « à rendre » (avec leur nombre d'essais) et les lots réglés mais non jugés (plus de 10 minutes après la DERNIÈRE réponse du lot) et n'est pas « propre » tant qu'il en reste ; (6) **UN-CANDIDAT-2** : une ligne de lot restée `en-reglement` (arrêt du processus, erreur de base pendant le règlement) est REPRISE par le balayage au-delà de `V2_LOT_REGLEMENT_REPRISE_MIN` minutes (entier de 1 à 1440, défaut 15), de façon idempotente (aucun crédit n'a bougé avant l'écriture d'état, le remboursement du lot passe par son claim), et listée par la réconciliation (`lotsEnReglement`) tant qu'elle ne l'est pas ; le même délai déclenche la CONTINUATION d'un remboursement de lot interrompu entre deux unités (la claim `rb|scanId` portant une unité rendue est renommée et les unités restantes sont rendues, chacune une seule fois) ; (7) un lot qui échoue passe derrière les autres au balayage (compteur d'essais, jamais d'affamement) ; (8) si une question du lot ne peut pas être réservée, le client est rendu et les lignes déjà posées finissent terminales (`lotIssue`) : la réconciliation ne les liste plus ; (9) une claim `rb|scanId` sans aucune unité rendue (arrêt entre la claim et la première unité), ou portant une unité rendue alors que des débits restent ouverts après la continuation du balayage, n'est reprise par aucun mécanisme du grand livre : la réconciliation la LISTE (elle n'est PAS reprise) avec son âge (`claimsOrphelines`) au-delà de `V2_CLAIM_ORPHELINE_MIN` minutes (entier de 60 à 10080, défaut 60, réglage distinct de la reprise des `en-reglement`), et le verdict n'est pas « propre » ; sa libération est une procédure manuelle (AUDIT-SECURITE-V2.md §15) ; (10) **un refus de plafond n'est pas toujours définitif** : un lot dont une unité est DÉJÀ rendue (ou prise sans trace) et dont le plafond de pannes du jour est plein n'est jamais décidé « plafond-jour » : il reste « à rendre » et listé. **Deux cas, deux issues** : (a) la trace « fait » d'une unité rendue est perdue (aucune claim `…|fait|…` pour ce scan) : le balayage le rend LE LENDEMAIN (le jour UTC suivant), sur le compteur de CE jour-là (rejoué, RR-6 de la relecture d'UN-CANDIDAT-2) ; (b) la claim `rb|scanId` porte déjà un `delta 1` et n'a seulement pas été renommée (arrêt entre deux unités) : au bout de `V2_LOT_REGLEMENT_REPRISE_MIN` minutes la continuation du balayage la renomme et rend le reste LE JOUR MÊME, sans recompter le plafond (`sansPlafond` ; banc 18a de `test-un-candidat-route.js` : plafond 5 avant et après, tout rendu au balayage suivant). Le plafond de chaque jour est respecté, mais dans le cas (a) un refus du jour J devient un remboursement du jour J+1 (comportement gardé sur décision du coordinateur, question au testeur ; le code n'a pas changé). Seul un lot dont RIEN n'est rendu ni pris reçoit `plafond-jour` comme décision définitive. Limites dites : si la base est muette au point que même l'état ne peut pas s'écrire, le jugement dérivé du balayage le retrouvera quand elle revient, mais rien n'est instantané ; une analyse qui reste absente laisse le lot payé et listé.
- Il n'existe **aucune** issue « sous réserve » dans le contrat 2 : trois issues par carte (§2), listes fermées (§3).

---

## 4. L'identité

| surface | comment | détail |
|---|---|---|
| extension | `Authorization: Bearer <jetonInstallation>` | le jeton (32 octets, base64url, 43 caractères) est rendu UNE fois par `POST /api/installation` ; le serveur n'en garde que l'empreinte SHA-256 ; **renouvelé à la liaison** (l'ancien est révoqué). Le `x-jeton` public de la 1.0.x ne débite plus rien en v2 : sans Bearer, `401 JETON`. |
| site | cookie `rm_session` | `HttpOnly; Secure; SameSite=Lax; Path=/`, **sans attribut `Domain`** (cookie d'hôte : `api.rat-market.fr`), 30 jours glissants, révocable. Le site appelle l'API avec `credentials: "include"`. |

- **Toute écriture authentifiée par cookie** exige `Origin: https://rat-market.fr` **et** l'en-tête `X-Rat-Market: 1` (un formulaire tiers ne sait pas le poser). Sinon `403 ORIGINE`.
- **CORS de l'extension** : origine exacte `chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb` ; `Allow-Methods: GET, POST` ; `Allow-Headers: Authorization, Content-Type, Idempotency-Key` ; `Max-Age: 600` ; **sans** `Allow-Credentials`.
- **CORS du site** : origine exacte `https://rat-market.fr`, **avec** `Allow-Credentials: true` ; `Allow-Methods: GET, POST, DELETE` (sur `/api/collection…` : `GET, PUT`) ; `Allow-Headers: Content-Type, X-Rat-Market, Idempotency-Key` ; `Max-Age: 600`.
- Jamais `*`. `Vary: Origin` partout. **Les en-têtes CORS figurent aussi sur les 4xx, 5xx et 429.** Aucune origine `*.onrender.com` n'est autorisée.
- **Limites** : 2 installations par IP et par jour (au-delà de 500 installations dotées d'essais par jour, une installation naît à 0 essai) ; les essais hérités d'un `userIdHerite` ne dépassent jamais la dotation d'une installation (`V2_ESSAIS`, 3) et une installation que l'héritage dote compte dans ces 500 (plafond atteint : héritage refusé, portefeuille 1.0.x intact) ; 5 essais faux de code de liaison par installation et par heure (20 par IP) ; 10 essais de connexion par compte et par heure ; 120 identifications par compte et par heure ; 1 000 écritures de collection par compte et par heure.
- **Plafonds horaires par porteur (MOYENS-B1, O4)** : par heure et par porteur (le compte, ou l'installation), `GET /api/compte` 600 par défaut (`V2_COMPTE_HEURE`, réglable ; les autres valeurs ci-dessous sont aussi des défauts), `POST /api/solde` 1 200 (`V2_SOLDE_HEURE`), `POST /api/identifier/reponse` 600 (`V2_REPONSE_HEURE`), `POST /api/retour-live` 600 (`V2_RETOUR_LIVE_HEURE`). Chaque route a son compteur ; au-delà : `429 DEBIT` avec `reessayerDans` et `Retry-After`. **La fenêtre est FIXE** : une heure alignée sur l'heure UTC (pas une durée glissante). Un client peut donc passer jusqu'à 2N requêtes à cheval sur la frontière de deux fenêtres (N juste avant, N juste après) ; `Retry-After` (et `reessayerDans`) désigne la FIN de la fenêtre courante, jamais moins d'une seconde. **Un plafond borne un porteur, pas une flotte** : les installations liées à un même compte se résolvent toutes en ce compte et partagent UN plafond par route ; une installation non liée est un porteur à part, avec son propre plafond. La multiplication des porteurs n'est bornée que par la création d'installations : 2 installations par adresse IP et par jour, et au-delà de 500 installations dotées d'essais par jour (global), une installation naît à 0 essai (voir la ligne « Limites » ci-dessus). O4 n'ajoute aucun plafond global. **Ces valeurs sont posées SANS mesure d'usage réel** : si elles sont trop basses, un client très actif reçoit des 429 et la valeur se relève par la variable d'environnement.
- **Essais hérités (HERITAGE-GRATUIT, D7 b)** : le `userIdHerite` de `POST /api/installation` ne donne jamais plus d'essais que la dotation d'une installation neuve (`V2_ESSAIS`, 3) ; toute élévation des essais d'une installation par l'héritage passe par le plafond global `V2_ESSAIS_GLOBAUX_JOUR` (plafond atteint : héritage refusé, portefeuille 1.0.x intact, réponse `201` sans signal de refus). Les crédits achetés ne suivent pas ce `userId`.
- **Ordre des poches (O2)** : `V2_ORDRE_POCHES` doit contenir `achete` ET `abonnement` ; sinon la configuration est invalide. **Configuration invalide, chemin par chemin** (`test-config-invalide-heritage.js`) : `GET/POST /api/installation…`, `/api/compte…`, `/api/scanner…`, `/api/banc…` et `/api/collection…` répondent `503 INDISPONIBLE` (enveloppe v2). Les quatre chemins qui recouvrent ou jouxtent l'ancien serveur ne sont PAS fermés en 503 : (a) `POST /api/identifier`, `/api/solde` et `/api/retour-live` retombent sur la route HÉRITÉE ; une requête de la v2 (Bearer, corps v2, ni `x-jeton` ni `userId`) y reçoit `401 « Non autorisé »` (forme héritée, pas l'enveloppe v2) **si la variable héritée `JETON_API` est posée sur le serveur, sinon `400`** (`verifierJeton` laisse alors tout passer et le refus devient celui de `userId` manquant, ci-après) ; avec le `x-jeton` public mais sans `userId` elle reçoit `400` (« Identifiant utilisateur manquant » ; « userId et scanId sont requis » pour `/api/retour-live`), les deux refus avant tout débit, toute écriture et tout appel au modèle ; (b) une requête qui est AUSSI une requête héritée complète (`x-jeton` public et `userId` dans le corps) est servie comme l'ancien serveur l'aurait servie sans le Bearer, sur le compte HÉRITÉ de ce `userId` (un Bearer n'ajoute aucun pouvoir, aucun compte v2 n'est touché, la v2 n'étant pas montée) ; (c) `POST /api/identifier/reponse` n'a aucune route héritée : `404` d'Express (page HTML), pas un `503` JSON. Le client v2 doit donc traiter un `401`, un `400` ou un `404` de ces quatre chemins, avec une configuration serveur invalide, comme « service v2 indisponible ».
- **Mot de passe** : 10 caractères au moins. **Liens** de vérification et de réinitialisation : 24 h, usage unique. **Code de liaison** : 6 caractères `[A-Z0-9]`, 10 minutes, usage unique, 3 vivants au plus par compte.
- `libelle` d'une installation : texte libre de 60 caractères au plus, affiché sur la page du compte, **jamais interprété**.

---

## 5. L'idempotence

`Idempotency-Key` est **obligatoire** sur la route qui débite : `POST /api/identifier`. Elle est **facultative** sur `POST /api/identifier/reponse` et `POST /api/retour-live` : une clé donnée est honorée, mais un rejeu sans clé est déjà sûr (l'état de la question, ou la garde « un second retour est refusé », rend le même résultat sans second débit ni second remboursement). Motif : `^[A-Za-z0-9_-]{8,64}$` (8 à 64 caractères). Un identifiant aléatoire par action de l'utilisateur ; **le même** pour un nouvel essai de la même action.

| situation | réponse |
|---|---|
| première fois | traitement normal |
| rejeu (même clé, même corps) | **même réponse, même statut**, en-tête `Idempotency-Replayed: true`, **aucun second débit**, aucun second appel de la chaîne d'identification |
| même clé, corps différent | `422 ENTREE` (`detail: "cle-reutilisee"`) |
| même clé, première requête encore en cours | `429 DEBIT` avec `reessayerDans: 2` |
| clé absente | `400 ENTREE` — **seulement sur `POST /api/identifier`** ; sur `/api/identifier/reponse` et `/api/retour-live` une clé absente est acceptée (la requête se traite sans protection de rejeu par clé) |
| clé mal formée (présente) | `400 ENTREE`, sur les trois routes |

La clé est conservée **24 h**, par porteur et par route : elle vaut par l'une ou l'autre adresse du serveur.

### 5.1 Ce que rend un rejeu de `POST /api/identifier` : les trois cas de l'extension (quota du jour)

Règle garantie et jouée par `test-idempotence-analyse.js` : **pour UNE clé, le client ne perd jamais plus d'UNE unité de son quota du jour ; une unité prise pour une analyse jamais rendue est rendue par le serveur.**

| cas | réponse exacte | quota |
|---|---|---|
| **pendant** la première requête | `429 DEBIT`, `reessayerDans: 2`, en-tête `Retry-After: 2`. La première continue et se termine normalement. | une seule unité prise (par la première) |
| **après un succès** (`200`, identifiée, question, ou « introuvable » remboursé : tout statut < 300) | la MÊME réponse, octet pour octet, même statut, `Idempotency-Replayed: true` ; la chaîne n'est pas rappelée | inchangé |
| **après une erreur qui a compté ET rendue** (`500 SERVEUR` par exception, `503 INDISPONIBLE` par panne du catalogue : `facturation.rembourse: true`) | l'erreur n'est jamais conservée : le rejeu de la même clé **s'exécute pour de bon** (pas de `Idempotency-Replayed`). Il reprend UNE unité si son analyse aboutit, aucune si elle échoue de nouveau (elle est rendue à chaque fois) | au total : 1 unité si une analyse est enfin rendue, 0 sinon |
| ~~après une erreur qui a compté et dont l'unité n'a PAS pu être rendue~~ | **N'arrive plus sur cette route depuis PLAFOND-DECLARE** : une panne ou une exception est CONSTATÉE par le serveur, donc toujours rendue, sans plafond (§ facturation). Règle de prudence gardée pour l'extension : si elle reçoit un jour `429 DEBIT` sur un rejeu après une réponse qui disait `facturation.rembourse: false`, elle prend une CLÉ NEUVE (rejouer la même clé ne finirait jamais) | — |

### 5.2 `POST /api/installation` et `POST /api/compte/lier` : `Idempotency-Key` facultative, réponse scellée

Même motif de clé, même durée (24 h), mêmes règles que ci-dessus (`422 cle-reutilisee` pour un autre corps, `429 DEBIT reessayerDans: 2` si la première requête est en cours, `400 ENTREE` si la clé est mal formée). Sans clé : le comportement d'avant. **Comme ces deux réponses portent un jeton, la base ne les conserve jamais en clair** (AES-256-GCM, clé dérivée de `V2_SECRET_EMPREINTE`) ; une réponse conservée illisible (secret changé) rend `503 INDISPONIBLE`, sans rien ré-exécuter.

- **`POST /api/installation` : la clé tient lieu de SECRET** (personne n'a encore de jeton, le rejeu rend le jeton à qui présente la clé et le même corps). Sur cette route, et elle seule, la clé doit avoir **32 à 64 caractères** `[A-Za-z0-9_-]` : `400 ENTREE` sinon, avec un `detail` exact par cause : `"cle-caractere-interdit"` (un caractère hors `[A-Za-z0-9_-]`, contrôlé en premier), `"cle-trop-longue"` (plus de 64) ou `"cle-trop-courte"` (moins de 32). Les limiteurs par IP de cette route (créations par jour, requêtes par heure) regroupent l'IPv6 par /56, comme le limiteur hérité ; une IPv4 compte telle quelle. **L'extension tire un UUID v4 ou 32 octets aléatoires (base64url ou hex)**, jamais une clé prévisible (horodatage, compteur). Un limiteur par IP, placé AVANT la recherche de la clé, compte TOUTES les requêtes de la route, rejeux compris (`V2_INSTALLATION_REQUETES_HEURE`, 30 par heure, `429 DEBIT`) : les devinettes sont bornées ; le plafond de 2 créations par IP et par jour ne change pas. L'en-tête n'est écrit dans aucun journal du serveur. **Risque restant, accepté** : le rejeu n'est pas lié à l'IP (une IP mobile change) ; qui lirait la clé dans un journal d'intermédiaire (CDN, proxy) dans les 24 h ET connaîtrait le corps exact obtiendrait le jeton. `422 cle-reutilisee` est gardé (avec 32 caractères aléatoires il ne révèle rien d'exploitable). La clé vaut sans jeton ; l'idempotence précède le plafond de 2 installations par IP et par jour : un rejeu ne le consomme pas. Un rejeu rend la même installation, le même `jetonInstallation`, le même `heritage` (`201`, `Idempotency-Replayed: true`) — jamais une deuxième installation, jamais un deuxième passage de l'héritage, même si la première réponse s'est perdue. Un `503` (héritage en échec) n'est pas conservé : le même `userIdHerite` peut être renvoyé avec la même clé.
- **`POST /api/compte/lier`** : la liaison fait tourner le jeton ; si la réponse se perd, le client n'a plus que l'**ancien** jeton. Un rejeu (même clé, même code, ancien jeton dans `Authorization`) rend `200` avec **le même nouveau jeton**, `Idempotency-Replayed: true` : une seule rotation, une seule fusion, le code n'est consommé qu'une fois. **L'ancien jeton reste révoqué partout ailleurs** : avec une autre clé, sans clé, pour une autre route, ou après 24 h il rend `401 JETON` ; la clé n'ouvre jamais que ce rejeu-là, et jamais pour une autre installation. Un échec (`404` code invalide, `503` fusion refusée) n'est pas conservé et ne laisse aucune fenêtre de rejeu : la liaison défaite, l'ancien jeton reste le jeton courant. La réponse rejouée est celle d'origine : son `solde` et son `offre` sont ceux du moment de la liaison. **Une fois la rotation écrite, le nouveau jeton n'est jamais perdu** : si une lecture qui précède la réponse (`solde`, `offre`) échoue, la route répond `503 INDISPONIBLE` et remet l'**ancien** jeton en vigueur ; la liaison au compte et le déplacement des crédits restent faits (ils ne se défont pas sans risque pour l'argent). Le client garde donc un jeton qui marche, et un nouvel essai (même clé ou non) rend `409 DEJA_LIE` : le client le lit comme « déjà lié : garde ton jeton, relis ton compte ». Cas restant : un processus qui meurt entre la rotation et la remise de l'ancien jeton perd le jeton, comme avant le lot.

---

## 6. Les erreurs, et ce que chaque client doit faire

Tout refus a la forme `ReponseErreur` : `{ success: false, erreur: { code, message, detail?, reessayerDans? }, facturation, solde?, offre? }`. `facturation` est toujours présent (`null` quand rien n'a été analysé). `solde` et `offre` accompagnent `QUOTA` et `VERIFICATION`, et les pannes remboursées. `achat` n'est plus servi (la vente est arrêtée).

| code | statut | quand | ce que le client doit faire |
|---|---|---|---|
| `JETON` | 401 | Bearer absent, inconnu ou révoqué | extension : recréer une installation (`POST /api/installation`) |
| `VERIFICATION` | 403 | compte lié dont l'adresse n'est pas confirmée | afficher « **confirmez votre adresse** » (pas « crédits épuisés ») |
| `QUOTA` | 429 | plus aucune analyse disponible | **proposer un compte** (installation non liée) ou l'offre Pro (compte gratuit) ; afficher le retour du quota à `offre.remiseAZero` (minuit de Paris). Plus de recharge |
| `DEBIT` | 429 | trop vite, ou requête identique en cours | **attendre `reessayerDans` secondes** (en-tête `Retry-After` aussi), puis rejouer avec la MÊME `Idempotency-Key` |
| `INDISPONIBLE` | 503 | base, catalogue ou index injoignables | rien n'est débité (remboursé) ; réessayer plus tard |
| `IMAGE` | 200 | aucune image exploitable | statut 200 conservé comme la route héritée ; au scanner, `detail` : `trop-lourde` (413) · `format` (415) · `aucune-carte` (422) |
| `IA` | 200 | la lecture de l'image a échoué | remboursé ; **une panne n'est jamais un introuvable** |
| `SERVEUR` | 500 | erreur interne | remboursé (sans plafond : constaté par le serveur) ; défaut sûr pour un code inconnu |
| `VERSION` | 426 | `versionExtension` sous `versionMinExtension` | **demander la mise à jour** de l'extension |
| `MARCHE` | 422 | marché hors liste | message « ce marché n'est pas pris en charge » |
| `SESSION` | 401 | cookie absent, expiré ou révoqué | site : renvoyer vers la connexion |
| `ORIGINE` | 403 | `Origin` ou `X-Rat-Market` manquant sur une écriture par cookie | bug du site : jamais montré à l'utilisateur |
| `IDENTIFIANTS` | 401 | adresse ou mot de passe incorrects | « adresse ou mot de passe incorrect » (le message ne dit jamais si l'adresse existe) |
| `MOT_DE_PASSE_FAIBLE` | 422 | mot de passe refusé à la confirmation (ou à la réinitialisation) : `detail` ∈ `trop-court` (moins de 10 caractères), `trop-long` (plus de 200), `egal-a-l-adresse`, et, à la confirmation seulement, `espaces-seulement` (D6) | afficher la règle |
| `CODE_INVALIDE` | 404 | code de liaison ou jeton de lien inconnu ou déjà utilisé | redemander un code / un lien |
| `CODE_EXPIRE` | 410 | code (10 min), lien (24 h) ou question (24 h) échu | redemander |
| `DEJA_LIE` | 409 | l'installation est déjà liée | **juste après un `503` de `POST /api/compte/lier`** (§5.2) : la liaison a réussi, c'est « déjà lié : garde ton jeton, relis ton compte » — ne PAS proposer de délier. Dans les autres cas : proposer de la délier d'abord |
| `CONFLIT` | 409 | réponse différente sur une carte déjà tranchée ; **ou** `/api/retour-live` : prix live déjà renvoyé pour ce scan (sans `detail`) | ne pas rejouer ; afficher le résultat déjà obtenu |
| `CONFLIT` + `detail: "borne-compte"` · `"borne-hors"` · `"borne-quantites"` · `"borne-sets"` · `"borne-service"` | 409 | `PUT /api/collection/…` : une borne de la collection est atteinte (§1.8) ; le message la nomme | **ne pas réessayer** : décocher d'abord, ou afficher le message |
| `INDISPONIBLE` + `detail: "catalogue"` | 503 | `PUT /api/collection/…` : aucun catalogue de fiches n'est chargé (ou il ne répond pas) et la clé n'est pas encore au registre du set — rien n'est écrit ; avec `reessayerDans` (5 s) et `Retry-After` | **réessayer** dans quelques secondes (décocher, lire et recocher une clé déjà au registre passent) |
| `CONFLIT` + `detail: "carte-non-identifiee"` | 409 | `/api/retour-live`, lecture ratée définitive (`sans-prix`) sur une carte qui n'est pas identifiée (question en attente, abandonnée, introuvable, lot, analyse absente) | **refus définitif** : rien n'a été remboursé, ne pas réessayer ; à distinguer du 409 « déjà complété » (celui-ci n'a pas de `detail`) |
| `INDISPONIBLE` + `detail: "analyse-absente"` | 503 | `/api/identifier/reponse` : l'analyse du scan n'est pas enregistrée côté serveur, la question existe | la question est **intacte**, la réponse n'a pas été prise : **réessayer** plus tard (ce n'est pas un 404 « scan d'un autre porteur ») |
| `CREDITS_ACHETES` | 409 | suppression d'un compte qui porte des crédits achetés | demander une renonciation explicite (`renonciation: true`) |
| `ENTREE` | 400 (422 pour une clé réutilisée) | corps invalide ; `detail` précise (`image-hote`, `cle-reutilisee`, `adresse-invalide`, `adresse-refusee`, `defi-anti-robot`, `lot-trop-grand-taille` (plus de 20 cartes, §3.1)…) ; `lot-trop-grand` est le `detail` du `QUOTA` d'un supplément impayable | corriger la requête ; pour `lot-trop-grand-taille`, **lire `facturation`** : les 10 premiers refus par jour et par compte ne coûtent rien (crédit rendu), à partir du 11e la lecture est facturée (`debite: 1`) |
| `EN_RECONCILIATION` | 409 | clé d'idempotence rejouée dont la ligne de débit attend la réconciliation : ni rejouée ni redébitée (B3) | réessayer plus tard ; aucun crédit ni remboursement associé |

Les 21 codes ci-dessus sont ceux de `v2/erreurs.js`. Un code inconnu d'un client (ajout futur) doit tomber sur `SERVEUR` : un défaut qui n'affirme rien. `RESEAU` et `EXTENSION` (côté extension) sont des codes **du client**, jamais servis.

```json schema=ReponseErreur
{
  "success": false,
  "erreur": {
    "code": "QUOTA",
    "message": "Plus aucune analyse disponible."
  },
  "facturation": null,
  "solde": {
    "total": 0,
    "essai": 0,
    "accueil": 0,
    "hebdo": 0,
    "achete": 0,
    "hebdoMax": 2,
    "prochainHebdo": "2026-10-12",
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": true
    },
    "partage": true,
    "abonnement": null
  },
  "offre": {
    "nom": "gratuit",
    "restant": 0,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

```json schema=ReponseErreur
{
  "success": false,
  "erreur": {
    "code": "VERIFICATION",
    "message": "Confirmez votre adresse e-mail pour recevoir vos analyses offertes."
  },
  "facturation": null,
  "solde": {
    "total": 0,
    "essai": 0,
    "accueil": 0,
    "hebdo": 0,
    "achete": 0,
    "hebdoMax": 0,
    "prochainHebdo": null,
    "compte": {
      "lie": true,
      "emailMasque": "v•••@exemple.fr",
      "verifie": false
    },
    "partage": true,
    "abonnement": null
  },
  "offre": {
    "nom": "gratuit",
    "restant": 0,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

```json schema=ReponseErreur
{
  "success": false,
  "erreur": {
    "code": "IA",
    "message": "La lecture de l'image a échoué."
  },
  "facturation": {
    "debite": 0,
    "reserve": 0,
    "rembourse": true,
    "motif": "panne",
    "raisonNonRembourse": null
  },
  "solde": {
    "total": 3,
    "essai": 3,
    "accueil": 0,
    "hebdo": 0,
    "achete": 0,
    "hebdoMax": 0,
    "prochainHebdo": null,
    "compte": {
      "lie": false,
      "emailMasque": null,
      "verifie": false
    },
    "partage": false,
    "abonnement": null
  },
  "offre": {
    "nom": "sans-compte",
    "restant": 2,
    "remiseAZero": "2026-10-14T00:00:00+02:00"
  }
}
```

```json schema=ReponseErreur
{
  "success": false,
  "erreur": {
    "code": "DEBIT",
    "message": "Une requête identique est déjà en cours.",
    "reessayerDans": 2
  },
  "facturation": null
}
```

---

## 7. Ce que les clients doivent aligner

Les documents précédents (`CONTRAT-2.md`, `DEMANDE-SERVEUR-EXTENSION.md`, `scannerContrat.ts`, `compteContrat.ts`, les fausses de l'extension) divergent du serveur sur les points ci-dessous. **Le schéma et ce document font foi.** Les références `C…` et `Q…` sont celles du plan de l'API v2 (§5 bis et §5) ; chaque ligne est un écart mesuré en validant les fichiers des clients contre le schéma.

### 7.1 Les deux clients

| # | ce que les documents disaient | ce que le serveur sert | réf. |
|---|---|---|---|
| A1 | motif `code-maitre` (CONTRAT-2 tableau, PLAN-COMPTES §6) | **`administrateur`** ; `code-maitre` disparaît de la v2 (le site l'a déjà retiré de `MOTIFS_FACTURATION`) | C1, Q14 |
| A2 | `confiance` chiffrée (maquette du scanner) | une chaîne `haute` / `moyenne` / `basse`, ou `null` ; **jamais de score** | C11 |
| A3 | `prixParEtat` / `prix.parEtat` au scanner | n'existe pas : `prixGuide` seul (tendance, plus bas, moyenne 30 jours, daté) | C8 |
| A4 | question « débitée à la réponse, 0 à l'émission » | **réservée** à l'émission : `debite: 0, reserve: 1`, débitée à la réponse, rendue à l'abandon | C2 |
| A5 | `POST /api/repondre-question { userId, scanId, idProduct }`, `POST /scanner/analyses/:id/choix { index, idInterne }` | **`POST /api/identifier/reponse`** et **`POST /api/scanner/analyses/{id}/reponse`**, même corps `{ scanId, carte, choix }` | C3 |
| A6 | liaison `{ userId, code }` | `{ code }` + Bearer : le `userId` ne suffit plus à rien | C4 |
| A7 | description « non conservée » / « 3 mois » | expurgée côté serveur, **non conservée par défaut** (depuis le 2026-10-14 ; **90 jours** puis effacée seulement avec `V2_DESCRIPTION_CONSERVEE=1`) (§8) | C5, C6 |
| A8 | « secours `onrender.com` » listé parmi les origines CORS | adresse de secours du **serveur**, pas une origine | C18, Q6 |
| A9 | `variante` toujours une valeur de la liste | **`null`** quand l'édition n'est pas connue (jamais `normale` deviné) | Q31 |
| A10 | `liens.cardmarket` toujours une adresse | **`null`** tant que le **numéro** n'est pas connu ; dès qu'il l'est, l'adresse de la **page exacte du produit** (`/<langue>/Pokemon/Products/Singles/<set>/<produit>`, idProduct connu, slug et slugSet présents), **jamais** une recherche ni une liste ; la rareté n'est plus exigée (décision du testeur, 2026-10-17). **Étiquette à afficher : « set + numéro », sans rareté** (le client la compose depuis `set` et `numero`, déjà servis). Même règle pour `impressions[].lien` | Q31 |
| A11 | « réponse commune » (banc RatMarket) | pas d'issue de ce nom : une carte `a-trancher` avec la question `visuel` | Q34 |
| A12 | `IMAGE` et `IA` en erreur HTTP | `IMAGE` et `IA` gardent le statut **200** (`success: false`) ; `VERSION` 426, `MARCHE` 422 | Q12 |
| A13 | 24 marchés (extension) / 16 domaines (CORS hérité) | la liste est celle du serveur (`V2_MARCHES`, 27 domaines Vinted par défaut depuis le 2026-10-14 : `vinted.uk`, qui n'existe pas, est remplacé par `vinted.co.uk`, et `ie hu ro si hr gr lv ee dk fi com.au` s'ajoutent) ; hors liste : `422 MARCHE` | C13, Q26 |
| A15 | « une carte identifiée absente du guide » : rien de dit côté clients | une carte identifiée dont `prixGuide` est `null` est **remboursée**, `motif: sans-prix` (règle de l'éditeur « un résultat sans aucun prix lisible est remboursé », valable aux deux surfaces ; à confirmer par l'éditeur ; REPLI-QUOTA : elle reste remboursée tant qu'aucun `prixRepli` n'est servi — et un repli naît d'un guide servi, donc une carte sans `prixGuide` n'en a jamais) | CONTRAT-2 §6 |
| A16 | valeur d'un lot au scanner : fourchette ou total inventé | la **somme des tendances du guide** des cartes chiffrées, avec sa **couverture** (« 2 cartes sur 3 ») ; une carte à trancher ou sans tendance n'est pas comptée ; aucune fourchette inventée | CONTRAT-2 §6 |
| A14 | codes d'erreur propres à chaque document | l'union, 20 codes (§6) | C9, Q13 |

### 7.2 Le site (`scannerContrat.ts`, `compteContrat.ts`)

| # | dans le code du site | ce que le serveur sert | à faire |
|---|---|---|---|
| S1 | `CODES_ERREUR` : 10 codes | 20 codes : en plus `SESSION`, `ORIGINE`, `IDENTIFIANTS`, `MOT_DE_PASSE_FAIBLE`, `CODE_INVALIDE`, `CODE_EXPIRE`, `DEJA_LIE`, `CONFLIT`, `CREDITS_ACHETES`, `ENTREE` | ajouter les dix (C9, C17, Q13) |
| S2 | `CODES_ERREUR_COMPTE` : `NON_VERIFIE`, `JETON_EXPIRE` | **`VERIFICATION`** (403) et **`CODE_EXPIRE`** (410, et `CODE_INVALIDE` 404 pour un lien déjà utilisé) | renommer / ajouter (C9) |
| S3 | `Produit.variante: Variante` | `Variante \| null` | typer le null (Q31) |
| S4 | `Produit.liens.cardmarket: string` | `string \| null` | typer le null (Q31) |
| S4b | `Produit.set.tirage: string` | `string \| null` : `null` = on ne sait pas (les collections de l'API ne portent pas le tirage ; ruling du 2026-10-10) | typer le null |
| S5 | `Produit` sans `impressions` | `impressions: Impression[]` toujours présent (`[]` par défaut) ; chaque impression : `idProduct`, `numero`, `total`, `rarete`, `variante`, `set: { nom }`, `lien`, `prixGuide` | ajouter le type |
| S6 | `Solde` sans `abonnement` | `abonnement: { restant, quotaMensuel, renouvelleLe } \| null` | ajouter (C17, Q3) |
| S7 | `ReponseErreur.erreur.detail` : trois valeurs de `IMAGE` | une chaîne libre (`image-hote`, `cle-reutilisee`, `lot-trop-grand`, `adresse-invalide`…) en plus de `trop-lourde`, `format`, `aucune-carte` | typer `string` (C17) |
| S8 | `ErreurCompte` sans `facturation` | toute erreur porte `facturation` (`null` si rien n'a été analysé) | tolérer la clé |
| S9 | l'erreur de `GET /api/compte` | `SESSION` (401), pas `NON_VERIFIE` | aligner |

### 7.3 L'extension (`src/commun/contrat.js`, `src/fond/fausses/*.json`)

| # | dans l'extension | ce que le serveur sert |
|---|---|---|
| E1 | fausses : `solde` avec `soldeGratuit`, `restantSemaine`, `soldeScans`, sans `essai`, `abonnement`, `compte.verifie` | le `Solde` v2 n'a **pas** les trois premières clés (elles n'existent que dans la forme **héritée** de `POST /api/solde` sans Bearer) et porte `essai`, `abonnement`, `compte.verifie` (C17) |
| E2 | fausses : `facturation` sans `reserve` (et, dans `reponses.json`, sans `raisonNonRembourse`) | les cinq clés sont **toujours** présentes |
| E3 | fausses : `solde: null` (a-trancher, lot, introuvable) | `solde` est **toujours** présent après une analyse |
| E4 | fausses a-trancher : une clé `question: { etat, delaiHeures }` à la racine | **non servie** ; le délai est de 24 h, fixe |
| E5 (fermé le 24/10, lot H de l'extension) | fausses : `Produit` sans `impressions` ; `prixGuide` sans `moyenne30` ; impressions : `prixGuide: { de, tendance }` | `impressions` toujours présent ; `prixGuide` toujours `{ tendance, de, moyenne30, date }` (null pour une valeur absente), y compris dans les impressions |
| E6 | fausse introuvable : `etat` rempli de `null` | `etat: null` pour un introuvable |
| E7 | fausse quota : `facturation` avec `motif: null` | `facturation: null` (aucune analyse) ; un `motif` n'est jamais `null` |
| E8 | fausses : images `https://pub-fictif.r2.dev/…` | l'hôte exact du bucket public (`pub-7d992e666c3d4a2b870b680a920045b6.r2.dev`) ou `rat-market.fr` |
| E9 | fausses : `variante: "normale"` partout, `liens.cardmarket` rempli sans numéro, ou menant à une recherche | `variante: null` et `liens.cardmarket: null` dans ces cas (A9, A10) |
| E10 | `CODES_ERREUR` de l'extension : 10 codes du serveur + `RESEAU` + `EXTENSION` | 20 codes serveur ; `RESEAU` et `EXTENSION` restent côté client |
| E11 (fermé le 24/10, lot H de l'extension) | `reels.js` : `set.slug: null` | `set.slug` est une chaîne (jamais `null`) |

#### 7.3 bis — Les écarts de forme MESURÉS (B7b.1, `v2/test/test-contrat-extension.js`)

Les dix fichiers de `extension v2\src\fond\fausses\` ont été rejoués contre le schéma (les six réponses d'analyse et les quatre de `reels.js` — module de données pur, lu en texte — contre `ReponseAnalyse`, carte par carte contre la branche de leur statut ; `quota.json` contre `ReponseErreur` ; chacune des 16 réponses de `reponses.json` RECONSTRUITE en entier — carte, facturation, solde — et jugée contre `ReponseQuestion`). Le banc échoue si un écart n'est pas listé ici avec son chemin JSON exact. **Rien n'a été corrigé ni dans l'extension (lecture seule) ni dans le schéma** : le schéma décrit ce que le serveur rend, et c'est l'extension qui doit changer. Colonne « fichiers » : ceux qui portent l'écart. **Fermés par l'extension le 24/10 (son lot H, `afbbe58`) et retirés d'ici** : E5 (`impressions` du `Produit` et des candidats, `prixGuide.moyenne30` de la carte, des candidats et des impressions, `prixGuide.date` des impressions) et E11 (`set.slug`) ; les fausses de l'extension portent aussi `version`, `marques`, `set.badge`, `set.badgeSource`, `langue` des impressions et les cinq clés de prix des candidats, que `test-identifier-adaptateur.js` compare désormais comme toutes les autres clés (sauf `marques` du `Produit` de `identifiee.json`, épinglé dans les deux sens).

| réf. | route et statut | chemin JSON | l'extension attend (fausse) | le serveur rend (schéma) | fichiers | qui doit changer |
|---|---|---|---|---|---|---|
| E2 | `POST /api/identifier` 200 | `$.facturation` | absent (l'extension ne lit plus `facturation`, sauf `motif === "administrateur"` : DEMANDE-SERVEUR-EXTENSION §B5 et B8) | clé requise : objet à cinq clés, **toujours** présent après une analyse | identifiee, identifiee-impressions, a-trancher, lot, introuvable, reels | l'extension |
| E2 | `POST /api/identifier/reponse` 200 | `$.<scanId>[].<choix>.facturation` | absent (même décision) | clé requise : objet à cinq clés | reponses | l'extension |
| E3 | `POST /api/identifier` 200 | `$.solde` | absent (l'extension ne lit plus que `compte` et `offre` : §B5) | objet, **toujours** présent après une analyse | identifiee, identifiee-impressions, a-trancher, lot, introuvable, reels | l'extension |
| E12 | `POST /api/identifier` 200 | `$.analyse.cartes[].etat.declare` | absent (l'état d'une carte ne vient jamais du vendeur : §B7) | clé requise (`null` ou l'état déclaré) ; le serveur la sert toujours | identifiee, identifiee-impressions, a-trancher, lot, reels | l'extension |
| E4 | `POST /api/identifier` 200 | `$.question` | `{ etat, delaiHeures }` à la racine | clé **non servie** (le délai est de 24 h, fixe) | a-trancher | l'extension |
| E6 | `POST /api/identifier` 200 | `$.analyse.cartes[].etat` | objet rempli de `null` (introuvable) | `null` pour un introuvable | introuvable | l'extension |
| E7 | `POST /api/identifier` 429 | `$.facturation` | absent (plus de `facturation` dans la fausse quota : §B5) | `null` (aucune analyse) : clé requise, valeur `null` | quota | l'extension |
| E8 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.visuel.url` | `https://pub-fictif.r2.dev/…` | `https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/…` ou `https://rat-market.fr/…` | identifiee, identifiee-impressions | l'extension |
| E8 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.visuel.grande` | objet dont l'URL est fictive | objet `Image` de l'hôte public, ou `null` | identifiee | l'extension |
| E8 | `POST /api/identifier` 200 | `$.analyse.cartes[].candidats[].visuel.url` | `https://pub-fictif.r2.dev/…` | l'hôte public exact | a-trancher, lot | l'extension |
| E13 | `POST /api/identifier` 200 | `$.offre` | absent | clé requise : `{ nom, restant, remiseAZero }` (OFFRE-QUOTA, §1.5) | identifiee, identifiee-impressions, a-trancher, lot, introuvable, reels.js | l'extension (B5 de sa `DEMANDE-SERVEUR-EXTENSION.md`) |

Non mesuré par cette lecture de forme (aucune faute de FORME, la faute est de sens) : E9 (`variante` et `liens.cardmarket` remplis alors que le serveur rend `null` quand l'édition ou le numéro est inconnu — les valeurs `normale` / une adresse sont de forme valide), E10 (codes d'erreur : le fichier `quota.json` n'en porte qu'un). `lectures.json` n'est pas une réponse du serveur (les grilles de la lecture live simulée ne sont jamais envoyées : le serveur ne reçoit que `prixLive` et `prixLiveEtat`) ; ses états `MT`…`PO` et ses prix (`null` ou > 0) tiennent la liste fermée du contrat.

### 7.4 Ce que le SERVEUR doit aligner ou documenter (mesuré par B7b.1, `v2/test/test-contrat-reel.js`)

Le banc joue chaque route de `paths` dans chaque état contre le serveur v2 réel. Ces constats ne sont **pas** des écarts de client ; ils sont écrits ici pour que le coordinateur et les agents du serveur les tranchent. **Chaque ligne porte, dans la même ligne, la route, le statut et le chemin** : le banc les cherche ainsi (une mention quelque part dans la section ne prouve rien).

*Réglés au tour 1 de B7b.1 :* l'historique de `GET /api/compte` est servi dans la forme du contrat (ancien défaut du serveur, `type` / `scanId` / `cartes[]` / `delta` / `poche`) ; les routes `POST /api/compte/renvoyer-verification`, `POST /api/banc/correction` et `DELETE /api/banc/contributions` sont **publiées** ; `Facturation.raisonNonRembourse` est resserrée à la liste fermée de `sources.js` (additif côté serveur : il ne rend déjà que ces valeurs ou `null`) ; le statut `429` de `verification` / `reinitialiser` et le `400` de `reinitialiser` sont documentés.

| # | route · statut · chemin | constat | décision à prendre |
|---|---|---|---|
| X1 | `GET /api/compte` · `200` · `$.historique.lignes[]` | **trou du contrat, pas du serveur** : le contrat n'a pas de motif de crédit pour une poche `abonnement` ni `essai`. Ces lignes sont **omises de l'historique, jamais inventées sous un autre motif**, et le banc compte celles qu'il omet. De même une analyse ancienne sans `facturation` complète ou sans `surface` est omise (rien n'est fabriqué). | ajouter des motifs (`abonnement`, `essai`) au contrat si le site veut les montrer |
| X2 | `POST /api/creer-recharge` · `501` · `404` · `410` | **OFFRE-QUOTA : la vente de scans est arrêtée.** Le `501 INDISPONIBLE` / `paiement-non-branche` d'avant est RETIRÉ (jamais rendu) ; dans le montage du banc, sans route héritée, la route passe la main (`404`). `index.js` répond `410 { success:false, error:"La vente de scans est arrêtée" }` sans créer de session Stripe ; le chemin v2 (`creerRecharge`) répond `410 INDISPONIBLE` (detail `vente-arretee`). Le crédit Stripe (`crediterAchat`) et le rattachement des achats (`rattacherAchats`) refusent et journalisent. | rien : la route disparaît quand le site n'y appelle plus |
| X4 | `POST /api/identifier` · `200` · `pas-une-carte` | listée au contrat, **jamais produite** par le code du serveur (seules `photo-illisible`, `hors-catalogue`, `panne-lecture` et `impression-indeterminee` sortent) | les clients ne comptent pas dessus |
| X4 | `POST /api/identifier` · `200` · `plusieurs-cartes-non-separees` | idem | idem |
| X4 | `POST /api/identifier` · `200` · `$.analyse.cartes[].carte.set.tirage` | `Produit.set.tirage` est **toujours `null`** (le catalogue ne porte pas le tirage) | les clients ne comptent pas dessus |
| X5 | `DELETE /api/compte` · `400` | documenté, jamais rendu : aucun chemin de `v2/comptes/routes.js` l.117-125 ne le produit | laisser documenté (inoffensif) ou retirer |
| X5 | `POST /api/compte/deconnexion` · `401` | documenté, jamais rendu : la déconnexion rend 200 même sans cookie (l.63-69) | idem |
| X5 | `POST /api/compte/mot-de-passe-oublie` · `400` | documenté, jamais rendu : un corps illisible vaut une adresse absente, 202 neutre (l.71-77) | idem |
| X7 | `POST /api/identifier` · `403` | **documenté, plus atteignable (O3)** : un compte non confirmé n'est plus un porteur (`v2/porteur.js` : sa session est refusée, une installation qui lui serait liée redevient une installation seule). Le `403` `VERIFICATION` reste documenté (garde en profondeur de la chaîne, du scanner et de la collection) mais aucune requête ne l'atteint plus. | laisser documenté (inoffensif) ou retirer ; les clients traitent `VERIFICATION` comme avant |
| X8 | `POST /api/identifier` · `413` | documenté, non joué par ce banc : le `413` est rendu par l'analyseur de corps de `index.js`, en amont de l'API v2 que ce banc monte seule ; il est joué sur le vrai `index.js` (serveurs enfants) par `test-corps-identifier-empreinte.js` | rien |
| X9 | `GET /api/modele-empreinte/{sha256}` · `302` | documenté, non joué par ce banc : route derrière `V2_EMPREINTE_EXTENSION=1`, absente de ce montage (drapeau éteint) ; joué sur un serveur réel par `test-modele-empreinte.js` | rien |
| X9 | `GET /api/modele-empreinte/{sha256}` · `404` | documenté, non joué par ce banc : route derrière `V2_EMPREINTE_EXTENSION=1`, absente de ce montage (drapeau éteint) ; joué sur un serveur réel par `test-modele-empreinte.js` | rien |
| X9 | `GET /api/modele-empreinte/{sha256}` · `429` | documenté, non joué par ce banc : route derrière `V2_EMPREINTE_EXTENSION=1`, absente de ce montage (drapeau éteint) ; joué sur un serveur réel par `test-modele-empreinte.js` | rien |
| X9 | `GET /api/modele-empreinte/{sha256}` · `502` | documenté, non joué par ce banc : route derrière `V2_EMPREINTE_EXTENSION=1`, absente de ce montage (drapeau éteint) ; joué sur un serveur réel par `test-modele-empreinte.js` | rien |
| X9 | `GET /api/modele-empreinte/{sha256}` · `503` | documenté, non joué par ce banc : route derrière `V2_EMPREINTE_EXTENSION=1`, absente de ce montage (drapeau éteint) ; joué sur un serveur réel par `test-modele-empreinte.js` | rien |
| X6 | code `EN_RECONCILIATION` | n'est produit que sur une clé de débit rejouée dont la ligne attend la réconciliation (état fabriqué par `test-argent-tour4.js`) ; le banc de contrat le déclare non produit et échoue si un état courant le produit | rien |

---

## 8. Les conditions de conservation

| donnée | durée | à l'échéance |
|---|---|---|
| titre et description d'annonce, **expurgés** des coordonnées du vendeur | **aucune par défaut** (`V2_DESCRIPTION_CONSERVEE` éteinte depuis le 2026-10-14 : la description reçue n'est écrite nulle part) ; avec `V2_DESCRIPTION_CONSERVEE=1` : **90 jours** | effacés (purge testée) ; ce sont des données, jamais des consignes ; la description ne part pas au modèle par défaut ; l'extension ne l'envoie plus, une requête sans description reste valide |
| image redressée versée au banc (avec consentement explicite) | **24 mois** au plus ; son LIEN à un compte ou une installation : **10 à 11 mois** (cohorte mensuelle décalée d'un mois, toujours sous 12 mois, BANC-12) | effacée à 24 mois ; à la bascule de sa cohorte la ligne est anonymisée (identifiant aléatoire, plus de jeton ni de jour, objet réécrit) ; effacement à la demande par le jeton (immédiat) **seulement avant la bascule** |
| analyses (sans texte d'annonce) | **10 à 11 mois** en pratique (supprimées à la bascule du mois ; TTL de 12 mois = filet, `V2_BANC_LIEN_MOIS` ; la politique du site : « douze mois au plus ») | effacées |
| mouvements de crédits | **24 mois**, mais leur `scanId` (champ et clé) est retiré à la bascule (10 à 11 mois), sauf un débit encore utile (marque de livraison non close, question ouverte, rendu non confirmé) | le mouvement RESTE jusqu'à 24 mois (somme des deltas = solde), sans `scanId` ; effacé à 24 mois |
| clés d'idempotence | 24 h | effacées |
| sessions | 30 jours glissants | expirées, révocables |
| liens de vérification et de réinitialisation | 24 h, usage unique | expirés |
| codes de liaison | 10 minutes, usage unique | expirés |

Un compte supprimé : ses sessions, codes et liens disparaissent, ses analyses sont supprimées, ses mouvements perdent leur lien au compte, ses installations redeviennent non liées **sans essai**. La suppression est refusée (`409 CREDITS_ACHETES`) tant qu'il reste des crédits achetés, sauf renonciation explicite.

---

## 9. Les fausses réponses publiées

`v2/openapi/fausses/` contient une fausse réponse par état, **valeurs fictives** (`idProduct` ≥ 9 000 000), chacune validée contre le schéma ; `_index.json` dit pour chacune la route, le statut HTTP et le schéma. Elles sont dérivées de celles de l'extension, complétées de ce que le serveur ajoute (`reserve`, `essai`, `compte.verifie`, `abonnement`, `impressions`, `moyenne30`). Les clients peuvent les copier telles quelles pour leurs maquettes et leurs tests.

| état | fichier(s) |
|---|---|
| identifiée | `identifiee`, `identifiee-impressions`, `identifiee-hors-euro`, `identifiee-sans-taux`, `identifiee-administrateur`, `identifiee-scanner` |
| à trancher (2 et 3 candidats), lot | `a-trancher-2`, `a-trancher-3`, `lot`, `lot-sans-prix` (LOT-SANS-PRIX : 3 cartes identifiées sans aucun prix, lot rendu en entier, motif `sans-prix`) |
| introuvable (une par raison) | `introuvable-photo-illisible`, `introuvable-pas-une-carte`, `introuvable-hors-catalogue`, `introuvable-plusieurs-cartes-non-separees`, `introuvable-panne-lecture`, `introuvable-impression-indeterminee` |
| pannes | `panne-ia`, `panne-indisponible`, `panne-serveur`, `panne-plafond-jour` |
| refus | `quota-compte`, `quota-installation`, `verification`, `debit`, `cle-reutilisee-identifier`, `cle-reutilisee-reponse`, `cle-reutilisee-retour-live`, `cle-en-cours-reponse`, `cle-en-cours-retour-live`, `jeton`, `version`, `marche`, `entree`, `image` |
| questions | `question-repondue`, `question-abandonnee-aucune`, `question-abandonnee-ne-sait-pas`, `question-plafond` |
| prix lu | `retour-live`, `retour-live-sans-prix`, `retour-live-repli-non-rembourse` (REPLI-QUOTA : lecture ratée, repli servi, non remboursée) |
| solde de chaque porteur | `solde-installation-non-liee`, `solde-installation-liee`, `solde-compte-non-verifie`, `solde-abonnement` |
| comptes | `installation-creee`, `lier`, `code-liaison`, `compte`, `compte-non-verifie` |
| santé | `ping` (`GET /ping`, v2 configurée : `versionMinExtension` et `capacites`, la liste fermée complète, archive des visuels chargée — CAPACITES-PING) |

---

## 9 bis. Les taux de change de la BCE : `V2_TAUX_BCE` (additif, aucun champ de réponse ne change)

Une annonce hors euro n'a de verdict que si un taux du jour est en base (`versEUR` non nul, `tauxDate` renseigné) ; sinon `versEUR: null` et l'état `identifiee-sans-taux`, comme avant. Le déclencheur qui remplit la collection `taux` est **éteint par défaut** : la variable `V2_TAUX_BCE` (`0` ou `1`, toute autre valeur rend la configuration invalide) l'allume.

- À `1`, rien ne part tant que la base n'est pas réellement connectée (le déclencheur attend la connexion ; attendre ne compte pas comme une tentative). Puis, au démarrage : une lecture tout de suite si aucun taux n'est en base ou si le plus récent a plus de 7 jours (`AGE_MAX_JOURS`) — la « graine » d'un service de test neuf ou réveillé après sommeil, sans copie de données. Un taux récent en base (y compris celui du jour) : aucune requête.
- Puis une lecture par jour (jour de Paris) après 16 h 00 Paris. Le jour n'est clos que si le fichier lu porte la date du jour de Paris ; un fichier plus ancien (publication pas encore faite, week-end, jour férié) est gardé, puis UN réessai une heure plus tard, puis arrêt jusqu'au lendemain, écrit au journal. Plafonds réels : par processus 2 requêtes comptées par jour, plus la graine si elle part ; par base, `rafraichirTaux` est borné à 3 essais par jour (marque du jour). Un fichier non plausible (date future, aucune devise valable) n'est jamais écrit.
- Une seule source : le fichier public de la BCE. Le journal dit la date lue et le nombre de devises, ou le code de l'échec — jamais d'URL ni de message d'erreur.
- À `0` ou absente : aucune minuterie, aucune lecture. À poser à `1` sur le service de test (variable à ajouter sur Render par le testeur).

---

## 10. Ce qui n'est pas encore garanti

- Les routes du scanner (`/api/scanner/…`) ne seront livrées que sur confirmation de l'éditeur.
- Le schéma est vérifié contre les **fausses** réponses, contre le **code** (listes fermées, routes) et (B7b.1, `v2/test/test-contrat-reel.js`) contre les réponses **réelles** du serveur : chaque route de `paths` dans chaque état que le serveur sait produire, avec un seul écart connu (X1, §7.4). Ce que le banc ne prouve pas : le comportement réel du modèle de lecture (le faux réseau rejoue des lectures enregistrées) et les routes du scanner sur un navigateur réel.
- La valeur du quota mensuel d'un abonnement (`quotaMensuel`) est une valeur de configuration (100 par défaut, inventée faute de source) : elle viendra de l'éditeur.
