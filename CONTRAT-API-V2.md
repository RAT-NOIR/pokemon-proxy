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
| `POST /api/installation` | extension | aucune | non | `RequeteInstallation` → `201 ReponseInstallation` (le jeton n'est rendu qu'ICI) |
| `POST /api/identifier` (avec `contrat: 2`) | extension | Bearer | **oui** | `RequeteIdentifier` → `ReponseAnalyse` |
| `POST /api/identifier/reponse` | extension | Bearer | facultative | `RequeteReponse` → `ReponseQuestion` |
| `POST /api/retour-live` (avec Bearer) | extension | Bearer | facultative | `RequeteRetourLive` → `ReponseRetourLive` |
| `POST /api/solde` (avec Bearer) | extension | Bearer | non | rien → `ReponseSolde` |
| `POST /api/compte/lier` | extension | Bearer | non | `RequeteLier` → `ReponseLier` |
| `POST /api/compte/delier` | extension | Bearer | non | rien → `ReponseSolde` |
| `POST /api/compte/inscription` | site | aucune (+ Turnstile) | non | `RequeteInscription` → `202 ReponseSimple` (toujours, que l'adresse existe ou non) |
| `POST /api/compte/verification` | site | aucune (jeton du lien) | non | `RequeteVerification` → `ReponseVerification` |
| `POST /api/compte/connexion` | site | aucune | non | `RequeteConnexion` → `ReponseConnexion` + cookie `rm_session` |
| `POST /api/compte/deconnexion` | site | cookie | non | rien → `ReponseSimple` |
| `POST /api/compte/mot-de-passe-oublie` | site | aucune | non | `RequeteMotDePasseOublie` → `202 ReponseSimple` (toujours) |
| `POST /api/compte/reinitialiser` | site | aucune (jeton du lien) | non | `RequeteReinitialisation` → `ReponseSimple` |
| `POST /api/compte/renvoyer-verification` | site | aucune | non | `RequeteRenvoiVerification` → `202 ReponseSimple` (toujours, que l'adresse existe, soit vérifiée ou non) |
| `POST /api/banc/correction` | extension | Bearer | non | `RequeteCorrectionBanc` → `ReponseSimple` (200 quoi qu'il arrive après les contrôles) |
| `DELETE /api/banc/contributions` | extension | Bearer | non | `RequeteEffacementBanc` → `ReponseEffacementBanc` |
| `POST /api/banc/etiquette` | extension | Bearer (compte ADMINISTRATEUR seulement) | facultative | `RequeteEtiquetteBanc` → `ReponseEtiquetteBanc` |
| `POST /api/banc/photo` | extension | Bearer (compte ADMINISTRATEUR seulement) | non (la même photo pour le même scan rend `deja`) | octets bruts JPEG/PNG/WebP + `?scanId=` → `ReponsePhotoBanc` (§1.7 ter) |
| `POST /api/compte/code` | site | cookie | non | rien → `ReponseCodeLiaison` |
| `GET /api/compte` | site | cookie | non | rien → `ReponseCompte` |
| `DELETE /api/compte` | site | cookie | non | `RequeteSuppressionCompte` → `ReponseSimple` |
| `DELETE /api/compte/installations/{id}` | site | cookie | non | rien → `ReponseSimple` |
| `POST /api/scanner/analyses` *(conditionnelle, lot B9)* | site | cookie | non | multipart `RequeteScanner` → `ReponseAnalyse` |
| `POST /api/scanner/analyses/{id}/reponse` *(conditionnelle, lot B9)* | site | cookie | non | `RequeteReponse` → `ReponseQuestion` |
| `GET /api/collection` | site | cookie | non | rien → `ReponseMesSets` (§1.8) |
| `GET /api/collection/sets/{slug}` | site | cookie | non | rien → `ReponseCollectionSet` (§1.8) |
| `PUT /api/collection/sets/{slug}/fiches/{cle}` | site | cookie, **compte vérifié** | non (idempotent par nature) | `RequeteCocher` → `ReponseCocher` (§1.8) |
| `GET /ping` | les deux | aucune | non | santé ; v2 allumée, ajoute `versionMinExtension` |

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
  }
}
```

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
  }
}
```

Les autres états sont publiés dans `v2/openapi/fausses/` (§9) : trois candidats, lot de 4 cartes, une fausse `introuvable` par raison, les pannes, les refus.

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
  }
}
```

« `aucune` » rend la carte `introuvable`/`hors-catalogue` et rend le crédit ; « `ne-sait-pas` » laisse la carte à trancher (mêmes candidats, sans verdict) et rend le crédit ; sans réponse sous 24 h, le crédit est rendu par un balayage. Une réponse **différente** sur une carte déjà tranchée : `409 CONFLIT`.

### 1.4 Le retour du prix lu (extension)

```json schema=RequeteRetourLive
{ "scanId": "fausse-identifiee-0001", "carte": 0, "prixLive": 11.9, "prixLiveEtat": "EX", "prixLiveCodeLangue": 1, "originePrix": "grille", "verdictAffiche": "correct" }
```

Une lecture ratée **définitive** (aucun prix lisible) est remboursée une fois par scan, motif `sans-prix`, **dans la limite de 5 par jour et par compte** (`V2_SANS_PRIX_JOUR`, compteur propre : il ne vide ni n'est vidé par les 30 abandons de questions) ; au-delà, **aucun remboursement** : la réponse reste `200`, avec `facturation { debite: 1, rembourse: false, motif: "plafond-jour", raisonNonRembourse: "plafond-jour" }`. Une lecture ratée non définitive (défi Cloudflare) ne rembourse rien :

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
  }
}
```

### 1.6 Les comptes (site)

```json schema=RequeteInscription
{ "email": "vous@exemple.fr", "motDePasse": "un mot de passe long", "turnstile": "jeton-turnstile-fictif" }
```

```json schema=RequeteConnexion
{ "email": "vous@exemple.fr", "motDePasse": "un mot de passe long" }
```

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
- **Réponse identique à l'octet.** `POST /api/compte/inscription` et `POST /api/compte/renvoyer-verification` rendent le **même** `202 { success: true }` (statut, en-têtes à l'exception de la date, corps) que l'adresse soit neuve, confirmée, en attente (courriel de moins ou de plus de 24 h) ou purgée. Le travail coûteux (hachage, base, courriel) est détaché, après la réponse.
- **Une adresse déjà inscrite et non confirmée garde sa place** jusqu'à la purge : une nouvelle inscription ne change ni le mot de passe ni rien d'autre ; un courriel (vers le premier inscrit) ne part que si la limite ci-dessus le permet.
- **Purge à 48 h.** Un compte non confirmé de **48 heures ou plus** est supprimé avec ses liens de courriel ; l'adresse redevient libre (une nouvelle inscription marche, et sa confirmation reçoit les 25 offertes : un compte jamais confirmé n'a jamais reçu d'offertes, l'empreinte d'octroi ne l'en prive pas). La purge est un balayage (une passe différée de 60 s au démarrage du serveur, puis toutes les heures : un compte vit au plus 49 h) qui ne supprime que ce qu'elle peut prouver vierge (`verifie: false`, 0 crédit, 0 abonnement, ni installation ni mouvement). Entre 48 h et le prochain balayage le compte est **déjà inactif** : son lien de confirmation et son lien de réinitialisation sont refusés, et une nouvelle inscription le remplace. *Nuance :* le compteur d'un courriel de confirmation (24 h) survit à la purge — une adresse libérée à 49 h dont le dernier courriel date de 47 h ne reçoit un nouveau courriel qu'à 71 h (le compte neuf vit 48 h, ce courriel reste utilisable).
- **Le texte du courriel de confirmation** dit que celui qui n'est pas à l'origine de l'inscription peut l'ignorer, et que le compte sera supprimé sous 48 heures.
- **Ce qui n'est PAS fermé** (écrit pour être tranché par le testeur, voir `AUDIT-SECURITE-V2.md` O3) : si la victime clique le lien d'une inscription faite par un tiers avec SON mot de passe, le compte s'active avec le mot de passe du tiers jusqu'à ce que la victime réinitialise son mot de passe. **La réinitialisation ferme alors tout accès au compte, y compris pour une requête déjà en vol :** elle incrémente d'abord la **génération** du compte (`comptes.generation`, `$inc` atomique, dans la même écriture que le nouveau mot de passe), puis supprime ses sessions, DÉLIE les installations liées au compte et supprime ses codes de liaison vivants. Une session, un code de liaison et une installation liée portent la génération lue à leur création ; un porteur n'est résolu que si elle est ÉGALE à celle du compte (champ absent : jamais égal) — session : `401` ; installation liée : traitée comme anonyme ; un code d'une génération révolue ne lie rien (`404 CODE_INVALIDE`) même vivant. **L'installation déliée** (celle du tiers, comme celle de la victime : l'extension se relie par un nouveau code, créé depuis une session de site, donc après une nouvelle connexion) n'a plus aucun accès au compte — ni solde, ni crédits, ni mouvements, ni Ma collection, ni courriel — et retombe exactement sur les droits d'une installation anonyme, sans rien hériter : elle garde SA poche telle qu'elle est (vidée par la fusion à la liaison) et ne reçoit aucun essai neuf (les 3 essais d'une installation naissent une fois, à sa création). Prouvé par `test-comptes-delie.js`, `test-comptes-generation.js`.
- **La liaison fusionne réellement** (tour 2, I-B) : à la liaison, les crédits achetés de l'installation passent au compte et ses essais tombent à 0 (`fusionnerALaLiaison({ compteId, installationId })`) ; un retour `ok !== true` (ou une exception) DÉFAIT la liaison (`503 INDISPONIBLE`, le client garde son ancien jeton, le code est rendu). Avant ce tour la fusion était appelée avec une mauvaise forme et ne tournait jamais.

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
- **Ce que l'extension affiche** : la réponse de la chaîne pour la carte (affirmée : le produit ; question : les candidats ; introuvable : la raison) ; un bouton **« juste »** (affirmation seulement) ; un bouton **« corriger »** qui ouvre la saisie d'un `idProduct` **ou d'une URL Cardmarket que l'EXTENSION résout** en `idProduct` (l'API ne résout pas d'URL) et propose **« pas une carte »** / **« hors catalogue »** ; puis l'état rendu : « enregistré » (`ecrit`), « déjà enregistré » (`rejoue`), « une étiquette plus récente existe » (`rev-perimee`), « produit inconnu du catalogue » (`422`), « catalogue indisponible, réessayer » (`503`).
- **Durée** : l'étiquette vit **dans la ligne d'analyse** (12 mois, `analysesMois`) et disparaît avec elle : passe quotidienne d'anonymisation, suppression du compte. Elle ne prolonge pas la vie de l'analyse et ne contient aucune photo ni aucun identifiant nouveau. Elle porte `{ verdict, idProduct | aucune, rev, le, versionModele, versionChaine }` ; `versionChaine` (commit du service) et `versionModele` (`V2_VERSION_MODELE`, facultative) sont ceux **qui ont répondu au scan**, relevés à l'écriture de l'analyse (`null` pour une analyse d'avant ce lot). Aucune de ces valeurs n'est servie au client.
- **La photo et la ligne du banc (lot ETIQUETAGE-B, 2026-10-13)** — **rien de neuf pour l'extension, sauf le champ `banc` ci-dessus.** Côté serveur : pour un scan d'un **administrateur seul** (rôle relu en base), la première photo de l'annonce (`imageUrls[0]`, hôte de la liste blanche) est téléchargée après la réponse, convertie en WebP sans métadonnées (côté le plus grand ≤ 1600 px) et rangée dans le bucket privé du banc ; la réponse de `POST /api/identifier` ne change pas d'un octet. À l'étiquetage, **une ligne `banc_lignes` par carte** (`source: "etiquette-admin"`) porte la vérité (`idProduct` ou `aucune`), la clé de la photo, les versions et la réponse d'origine de la chaîne ; une étiquette de `rev` plus grand met la ligne à jour, la photo n'est jamais dupliquée (un lot : plusieurs lignes, une photo). Aucun autre client n'est photographié, et la ligne ne porte ni compte, ni `scanId`, ni URL, ni titre, ni vendeur. Durées : celles du banc (photo 24 mois **comptés depuis le SCAN**, c'est-à-dire la date de capture de la photo et non celle de l'étiquetage ; lien 12 mois). Un administrateur déchu perd la photo de ses scans non étiquetés à la passe suivante. L'export vers l'outil de mesure (`v2/mesures/exporter-banc-admin.js`) est local, en lecture seule.
  - **Une requête vers l'hébergeur de l'annonce (tour 1).** La route v2 ne tient aucun octet de la photo (la chaîne reçoit l'URL) : le serveur fait donc **un seul `GET` de `imageUrls[0]`** par scan d'administrateur, **après la réponse, jamais attendu par le client**, vers un hôte de la liste blanche de la production, en `https`, sans suivre de redirection, au plus **8 s** (corps compris) et **5 Mo**, type `image/*` ; un échec n'est pas réessayé et ne change rien à la réponse. **La photo stockée peut différer de celle que la chaîne a analysée** si l'URL a changé entre-temps : son `sha256` est écrit sur l'analyse et sur la ligne du banc (`sha256`) pour savoir de quelle image il s'agit.
  - **Reprise (tour 1).** `banc: "en-attente"` n'est répondu que s'il existe une reprise : l'étiquette est écrite avec une marque de reprise dans la MÊME écriture, et la passe quotidienne réécrit la ligne à la `rev` de l'étiquette. Une carte sort de l'attente par `ecrit`, `sans-photo` (aucune photo 24 h après le scan) ou `role-retire` (le compte n'est plus administrateur : la photo n'est plus gardée). Pendant l'attente, l'export du banc le DIT (`etiquettesEnAttente` dans son manifeste) : une ligne peut porter une vérité plus ancienne que l'étiquette.

#### 1.7 ter Envoyer la photo d'un scan (administrateur) — lot PHOTO-EXTENSION, recadrage du 2026-10-13

**Décision du testeur.** `POST /api/identifier` n'a **aucun champ d'image** : son corps garde sa limite de 100 ko, et la route héritée est inchangée. L'image que l'extension de l'administrateur affiche déjà part par une route à part, réservée à l'administrateur, où l'identité et le rôle sont jugés **avant** la lecture du moindre octet du corps. La seconde lecture pour tous les clients attendra un autre contrat.

- `POST /api/banc/photo?scanId=<24 hexadécimaux>&photo=0`, `Authorization: Bearer <jeton d'installation liée à un compte administrateur>`, `Content-Type: image/jpeg | image/png | image/webp`, `Content-Length` obligatoire, **corps = les octets bruts de l'image** (ni base64, ni JSON, ni préfixe `data:`). `photo` = l'index dans les `imageUrls` du scan, **0 par défaut et seule valeur admise** (le banc ne garde que la première photo de l'annonce ; `photo=1` rend `400 photo`). Aucun autre paramètre (`400 champ-inconnu`).
- **Ordre des gardes, tous AVANT de lire un octet du corps** (prouvé par un compteur d'octets lus : moins de 100 ko lus sur plusieurs centaines annoncés) : (1) identité : `401 JETON` ; (2) rôle `administrateur` relu en base : **tout autre porteur** (compte ordinaire, installation seule ou non liée) reçoit **le 404 natif d'une route inexistante** (même statut, même corps non JSON, mêmes en-têtes que `/api/banc/etiquette` : prouvé par comparaison avec une route inexistante) ; (3) plafond horaire par porteur (le même que l'étiquette, 600 par heure, `429 DEBIT`) ; (4) la requête (`400 scan-id | photo | champ-inconnu`) ; (5) `Content-Type` (`415 type`) ; (6) `Content-Length` entier, non nul (`400 content-length`), ≤ **2 Mio** (`413 trop-lourde`) — une photo d'annonce affichée (`f800`) pèse 100 à 300 ko ; (7) le scan existe ET est de **ce** porteur (`404 CODE_INVALIDE`, un scan inconnu et le scan d'un autre ne se distinguent pas) ; si le scan a déjà sa photo : `200 deja`, rien lu, rien réécrit ; (8) une place de lecture : **4 au total, 1 par porteur** (`429 DEBIT` + `Retry-After: 2`) ; (9) un **délai de lecture de 15 s** (une connexion lente est coupée, la place rendue). Un refus décidé avant la lecture ferme la connexion ; le corps non lu est jeté (jamais gardé).
- **Le contenu** (après lecture, une seule analyse d'image : celle du scanner) : les octets doivent être ce que le `Content-Type` annonce (`415 type`) ; l'image doit se décoder entièrement (`422 illisible`), tenir en **12 millions de pixels et 4 096 px de côté** (`422 dimensions` ; une photo de téléphone de 4000 × 3000 passe) et n'avoir qu'une page (une image animée est `422 illisible`) ; **au plus 2 décodages simultanés** dans le service, le suivant reçoit `429 DEBIT` (réessayer), jamais une attente. Ces bornes sont refusées sur l'en-tête de l'image, avant le décodage complet.
- **L'effet.** La photo est conservée comme celle que le serveur télécharge lui-même : WebP sans métadonnées, 1 600 px au plus, `sha256` sur `analyses.photoBanc` ; les cartes du scan en attente de photo (`banc: "en-attente"`, §1.7 bis) en sortent et **leur ligne du banc naît**. Réponse : `200 { success: true, etat: "ecrit" | "deja", photo: 0, banc?: "ecrit" | "en-attente" }` (`banc` seulement si une carte attendait). **Idempotente** : la même photo pour le même scan rend `deja`, rien de plus (pas d'`Idempotency-Key`). Aucune erreur ne débite ni ne rembourse rien (la route est hors argent). Autres réponses : `503 INDISPONIBLE` (base ou bucket injoignable, rien de conservé). Les erreurs ont l'enveloppe v2 (`success: false, erreur: { code, message, detail }`).
- **Le repli : le téléchargement serveur.** Pour un scan d'**administrateur** seulement, le serveur attend **15 s** après avoir répondu au scan (`V2_PHOTO_ADMIN_DELAI_S`, de 0 à 300) que l'extension ait envoyé sa photo ; si `analyses.photoBanc` existe alors, **rien n'est téléchargé**. Sinon il télécharge `imageUrls[0]` (§1.7 bis), **espacé** (`V2_PHOTO_ADMIN_INTERVALLE_S`, défaut 10 s) et **plafonné** (`V2_PHOTO_ADMIN_MAX_JOUR`, défaut 400 par jour UTC), comptés dans la base ; au-delà, pas de photo (`banc: "en-attente"`). Le délai vit en mémoire du processus : un redémarrage pendant l'attente perd ce repli (la carte sort `sans-photo` à 24 h).
- **Pour l'extension.** (1) **Obtenir les octets** : `fetch` de la même adresse que celle de l'`<img>` affichée (`imageUrls[0]`), lu en `arrayBuffer()` — servi **en pratique par le cache du navigateur, sans garantie**. Si le `fetch` échoue (réseau, CORS, hors cache), **n'envoyer rien** : le repli serveur prend le relais ; l'extension ne doit jamais, de son côté, lancer une requête nouvelle vers Vinted si elle s'y refuse (son manifeste promet « rien n'est requêté vers Vinted »). Un canvas ne convient pas si le CDN n'envoie pas les en-têtes CORS (image souillée). (2) **Jamais de préfixe `data:`** et pas de base64 : le corps est binaire (`fetch(url, { method: 'POST', headers: { 'Content-Type': <le type de la réponse>, Authorization }, body: blob })` — le navigateur pose `Content-Length`). (3) **Mesurer avant d'envoyer** : ≤ 2 Mio, ≤ 4 096 px de côté, ≤ 12 millions de pixels, non animée ; sinon ne rien envoyer. (4) **Quand** : après la réponse du scan, **dans les 15 s** (le repli serveur part ensuite) ; l'extension connaît le `scanId` par la réponse de `POST /api/identifier`. Elle sait être administrateur par `facturation.motif === "administrateur"` d'une réponse précédente ; un non-administrateur qui appelle la route reçoit un 404 natif et ne doit pas réessayer. (5) **Réponses** : `200` (`ecrit` ou `deja`) = fini ; `429` = réessayer après `Retry-After` ; `413`, `415`, `422`, `400`, `404` = ne pas réessayer (le repli serveur couvre) ; `503` = réessayer une fois.

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

---

## 2. Les règles du contrat

1. **Additif.** Sans `contrat: 2` dans la requête, la réponse d'aujourd'hui, octet pour octet : la 1.0.x publiée continue de marcher.
2. **Trois issues par carte** : `identifiee` · `a-trancher` · `introuvable`. Jamais « sous réserve » en sortie. (`lot` est un statut d'ENSEMBLE, jamais d'une carte.) Une carte n'est `identifiee` que si son produit n'a aucun jumeau (§3.2).
3. **Listes fermées** pour tout ce qui pilote un comportement (§3). Une valeur inconnue d'un client tombe sur un défaut **qui n'affirme rien**.
4. **Aucun score, aucune confiance chiffrée.** `etat.confiance` est une chaîne de liste fermée.
5. **`null` = « on ne sait pas »**, jamais zéro ni non. Un prix à 0 n'existe pas ; une variante inconnue est `null`, jamais `normale` deviné.
6. **Une image servie vient de NOTRE R2** (vignette + grande), jamais de Cardmarket : `https`, hôte exact du bucket public (`pub-7d992e666c3d4a2b870b680a920045b6.r2.dev`) ou `rat-market.fr`.

Les réponses du serveur sont **fermées** : une clé que le schéma ne nomme pas n'est jamais servie (`additionalProperties: false`). Un client qui reçoit une clé inconnue la tolère ; un banc du serveur, lui, l'aurait refusée.

**Le prix.** L'extension lit le prix EN DIRECT sur Cardmarket (`prixLive` dit quoi lire). Le scanner affiche **le guide du jour** (`prixGuide` : `tendance`, `de` = le prix le plus bas, `moyenne30`, et `date`, celle du GUIDE) ; il n'y a **pas de `prixParEtat`**, le serveur ne va jamais chercher un prix par état.
**Un lot** coûte `max(1, ceil(cartesVues / 10))` crédits, questions comprises ; `cartesVues` compte les cartes introuvables.

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
| `devise` | `EUR` · `GBP` · `USD` · `PLN` · `CZK` · `HUF` · `RON` · `SEK` · `DKK` |
| `verdictAffiche` | `bonne-affaire` · `correct` · `cher` · `aucun` |
| `lectureRatee.cause` | `defi` · `blocage` · `grille-vide` · `sans-prix` · `sans-offre-reverse` · `onglet` |
| `originePrix` | `grille` · `plancher-toutes-langues` · `tendance` |
| `surface` d'une ligne d'historique | `extension` · `scanner` |
| `source` du scanner | `camera` · `fichier` · `collage` |
| code d'erreur (`erreur.code`) | voir §6 |

`code-maitre` **n'existe plus** : le motif `administrateur` le remplace (rôle tenu en base sur le compte de l'éditeur, `debite: 0`).
Le serveur ne produit pas encore les raisons `pas-une-carte`, `plusieurs-cartes-non-separees` et `panne-lecture` (la chaîne actuelle ne lit qu'une carte et distingue une panne d'une absence) ; elles restent dans la liste pour que les clients aient un texte prêt. `impression-indeterminee` (additive, JUMEAU-V2) est, elle, PRODUITE : voir §3.2.
La liste des marchés (`marche`) n'est pas un `enum` du schéma : elle vient de la configuration du serveur (`V2_MARCHES`) ; un marché hors liste reçoit `422 MARCHE`.

### 3.1 Ce que chaque issue coûte (`facturation`)

| issue | `debite` | `reserve` | rembourse ? | `motif` |
|---|---|---|---|---|
| carte affirmée | 1 | 0 | non | `affirmee` |
| question posée | 0 | **1** | — | `question` |
| · répondue par un candidat | 1 | 0 | non | `question` |
| · `aucune`, `ne-sait-pas`, sans réponse sous 24 h | 0 | 0 | oui, sous le plafond de 30 par jour | `question` |
| lot de N cartes (N ≤ 20, `V2_LOT_CARTES_MAX`) | `max(1, ceil(N/10))` | 0 | si aucune carte n'est identifiée (`introuvable`), ou aucune sans prix lisible (`sans-prix`) | `lot` |
| lot refusé (`lot-trop-grand` : plus de 20 cartes, ou supplément impayable) | 0 (crédit initial rendu) | 0 | oui, jusqu'à **10 refus par jour et par compte** (`V2_LOT_TROP_GRAND_JOUR`) ; **au-delà, la lecture est facturée** (`debite: 1`, `raisonNonRembourse: "plafond-jour"`), la réponse restant le refus ; le supplément n'est jamais pris | `lot` |
| aucune carte trouvée | 0 | 0 | oui | `introuvable` |
| aucun prix lisible (`lectureRatee` définitive) | 0 | 0 | oui, une fois par scan, sous le plafond PROPRE de **5 par jour et par compte** (`V2_SANS_PRIX_JOUR`) ; au-delà : facturé (`debite: 1`, `raisonNonRembourse: "plafond-jour"`) | `sans-prix` |
| panne (lecture, base, source) | 0 | 0 | oui, sous le plafond de 5 par jour | `panne` |
| remboursement refusé (plafond atteint) | 1 | 0 | non, et `raisonNonRembourse` dit pourquoi | `plafond-jour` |
| compte administrateur | 0 | 0 | — | `administrateur` |

**Arrêt du serveur pendant un scan (O5).** Un scan dont le serveur MEURT avant d'avoir produit son résultat (déploiement, arrêt brutal) est **rendu en entier, toutes ses unités, sans compter dans aucun plafond du client**, par une passe du serveur qui se joue quand le processus ne donne plus signe de vie (90 s sans battement, et au moins 5 minutes après le débit) ; une requête longue mais vivante n'est jamais rendue. Il est **confirmé** (rien n'est rendu) seulement quand sa **réponse complète est rejouable** : stockée avec la même `Idempotency-Key` pendant 24 heures. Une ligne d'analyse écrite ne suffit pas (l'historique ne donne ni le prix ni les candidats) : si le serveur meurt après l'avoir écrite et avant d'avoir stocké la réponse, le scan est rendu, pour une extension comme pour un compte. **Un client qui coupe la connexion avant la réponse n'est jamais remboursé** : le serveur, vivant, va au bout, le résultat est produit, le crédit couvre le travail fait. Le motif interne de ce remboursement est `arret-serveur`; il n'apparaît ni dans la réponse ni dans `historique` (qui ne sert que les analyses et les octrois, achats et migrations de crédits). Un client qui rejoue sa requête avant cette passe reçoit `DEBIT` (« en cours », `reessayerDans: 2`), jamais une lecture gratuite ni un second débit ; après le remboursement, la même clé est une nouvelle tentative payée.

**Plafonds de remboursement (lot PLAFONDS, 2026-10-11).** Quatre compteurs INDÉPENDANTS, par **jour UTC** et par **porteur** : le compte quand l'installation en a un (deux installations d'un même compte partagent le même compteur), sinon l'installation non liée : pannes 5 (`V2_PLAFOND_PANNES`), abandons de questions 30 (`V2_PLAFOND_QUESTIONS`), « prix illisible, définitif » 5 (`V2_SANS_PRIX_JOUR`), refus de lot 10 (`V2_LOT_TROP_GRAND_JOUR`). Un refus de remboursement est toujours dit par `raisonNonRembourse: "plafond-jour"` (liste publique fermée, aucun code nouveau). Le compte administrateur ne paie rien et ne compte dans aucun.

**Taille d'un lot : 20 cartes au plus** (`V2_LOT_CARTES_MAX`, entier de 2 à 100 ; au-delà, la configuration est invalide). `POST /api/banc/correction` suit la même borne (`carte` de 0 à taille − 1 ; `maximum: 99` du schéma est le plafond absolu). `carte` (`/api/identifier/reponse`, `/api/retour-live`) va de 0 à 19 (même variable : une seule source). Un lot de plus de 20 cartes est **refusé, jamais tronqué** : `400 ENTREE` + `detail: "lot-trop-grand-taille"` (le supplément impayable reste `429 QUOTA` + `detail: "lot-trop-grand"`). Dans les deux cas : crédit initial rendu jusqu'à 10 refus par jour et par compte, `facturation { debite: 0, rembourse: true, motif: "lot" }` ; au 11e, `facturation { debite: 1, rembourse: false, motif: "lot", raisonNonRembourse: "plafond-jour" }`, le refus restant la réponse.

`solde.total` compte déjà les réserves en moins. Le solde se débite dans l'ordre `essai` → `accueil` → `hebdo` → `abonnement` → `achete` (réglable côté serveur). Une installation non liée n'a que ses 3 essais ; un compte **vérifié** reçoit 25 analyses offertes une seule fois, plus 2 par semaine ISO (non cumulables).

### 3.2 Quand une carte est affirmée — et quand elle ne l'est PAS (lots JUMEAU-V2)

Une carte n'est `identifiee` que si le produit désigné n'a **aucun jumeau** : aucun autre produit de même métacarte, de même langue de tirage, d'un autre créneau (expansion, numéro). Un champ que le catalogue ne connaît pas compte comme « même ». Le serveur ne devine jamais : la lecture du code et du numéro sur la photo peut désigner un vrai produit qui n'est pas celui de la carte (même fiche de jeu, autre set).

| le produit désigné a… | issue | `statut` | `raison` / `erreur.code` | facturation |
|---|---|---|---|---|
| aucun jumeau | affirmée | `identifiee` | — | `affirmee`, `debite: 1` |
| 1 ou 2 jumeaux (3 produits au plus) | question de départage entre le produit et ses jumeaux | `a-trancher` | — | `question`, `reserve: 1` (comme toute question) |
| plus de 3 produits avec ses jumeaux | introuvable | `introuvable` | `impression-indeterminee` | rembourse (`introuvable`), `debite: 0`, dans la limite du compteur des jumeaux (ci-dessous) |
| la liste des jumeaux ne peut pas être établie pour CE produit (colonne absente, produit plus récent que l'archive sous sa métacarte, jumeau sans ligne au catalogue, démarrage à froid) | **panne** | — | `erreur.code: INDISPONIBLE` (503) | rembourse (`panne`), `debite: 0`, dans la limite du compteur des jumeaux (ci-dessous) |

- **`impression-indeterminee`** est une valeur **additive** de la liste fermée des `raison` d'un introuvable. Ce que le client doit afficher : *« plusieurs impressions de cette carte existent ; la photo ne permet pas de dire laquelle »* (et inviter à photographier le bas de la carte, code du set et numéro). Elle ne veut **pas** dire « photo illisible » : la carte est reconnue, c'est son impression qui ne se tranche pas. Un client qui ne la connaît pas la traite comme toute raison inconnue (repli sur un texte générique d'introuvable).
- La panne `INDISPONIBLE` est un échec de NOTRE côté (la photo n'y est pour rien) : le client peut réessayer plus tard.
- **Le compteur des jumeaux.** Ces deux refus sont NOS refus, pas des échecs du client : ils se remboursent dans un compteur DÉDIÉ, séparé du plafond de pannes, par jour UTC et par porteur, à raison d'**UNE unité par carte refusée** (un lot de 3 cartes toutes refusées consomme 3 unités). Plafond par défaut : **20** (`V2_JUMEAUX_REMBOURSES_JOUR`) ; ce chiffre est posé **sans mesure d'usage réel** et se règle à la lumière du trafic. Compteur plein, le refus est jugé comme un introuvable ordinaire au plafond de pannes (§3.1), avec les mêmes règles de facturation : `facturation { debite: 1, rembourse: false, raisonNonRembourse: "plafond-jour" }`. Un refus de la garde n'est donc jamais gratuit sans limite. L'unicité par scan reste (un scan ne se rembourse qu'une fois).
- Le serveur ne tronque **jamais** les candidats (« 3 parmi N ») : la question pourrait exclure la vraie carte.
- **La péremption se juge par produit.** La colonne des jumeaux porte le plus grand `idProduct` qu'elle connaît. Pour un produit que la chaîne affirme, le serveur cherche, par une requête indexée, un produit **plus récent que l'archive** de **la même métacarte** : s'il en existe un, ce produit-là ne conclut pas pour ce scan (panne `INDISPONIBLE`) ; un produit ajouté sous une autre métacarte ne bloque rien. Si la requête échoue, la garde ne conclut pas.
- Les motifs internes précis (`jumeaux-trop-nombreux`, `jumeaux-indisponibles`, `jumeaux-perimes`, `jumeaux-incomplets`) ne sont **pas servis** ; ils sont écrits côté serveur (`analyses.cartes[i].motifJumeaux`, par carte, y compris dans un lot) et comptés. Une panne n'écrit pas d'analyse : sa trace est le journal et le compteur.
- Dans un **lot**, la garde s'applique carte par carte : une carte à jumeaux devient une question de lot, une carte à plus de 3 produits est `introuvable / impression-indeterminee`, une carte dont la liste de jumeaux ne s'établit pas est `introuvable / panne-lecture`. Le lot est remboursé en entier seulement si **toutes** ses cartes sont des refus de la garde (compteur des jumeaux, une unité par carte) ou si aucune carte n'est lue ; un lot **mixte** (une carte refusée par la garde parmi d'autres introuvables) suit les règles ordinaires du plafond de pannes. Une carte refusée par la garde dans un lot partiellement lu est facturée avec le lot.
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
| plus de 3 produits | `introuvable` / `impression-indeterminee` | comme avant |
| ne peut pas conclure | panne `INDISPONIBLE` (503), remboursée | jamais une question ni une affirmation |

Exception inchangée : `nom-contredit-sans-repli` reste `introuvable` / `photo-illisible` (le nom CONTREDIT les candidats). Zéro candidat reste `introuvable`.

- **Ce que l'extension affiche** : la fiche du candidat (`candidats[0]` : visuel, nom, set, numéro) et DEUX boutons : OUI (réponse `choix: "a"`, l'`id` du seul choix) et NON (réponse `choix: "aucune"`, qui existe déjà : aucune valeur nouvelle dans `RequeteReponse`). Le texte de la question (`texte`, `aide`) est fourni dans la langue de l'interface.
- **Étiquetage administrateur (§1.7 bis)** : pour la confirmation comme pour une question à 2 ou 3 candidats, l'extension PROPOSE chaque candidat en un clic ; ce clic envoie `POST /api/banc/etiquette` avec `verdict: "corrige"` et l'`idProduct` du candidat (prérempli). `juste` ne vaut que pour une affirmation initiale (`409` sinon, même après un OUI).
- **OUI** : la carte est `identifiee` (le candidat), facturée comme toute question répondue (`debite: 1, motif: "question"`). **NON** : la carte est `introuvable` / `hors-catalogue`, le crédit réservé est rendu (`debite: 0, rembourse: true`), une seule fois par scan. **Abandon** (`ne-sait-pas`, ou sans réponse sous 24 h) : crédit rendu, la carte reste à trancher.
- **L'argent est celui de toute question** : crédit RÉSERVÉ à l'émission (`debite: 0, reserve: 1`), même claim d'unicité par scan, même balayage à 24 h. Le remboursement d'un NON ou d'un abandon passe par le compteur existant des abandons de questions (30 par jour et par porteur, `V2_PLAFOND_QUESTIONS`, §3.1) : aucun compteur nouveau. Avant D1 ces scans étaient des `introuvable` remboursés sous le plafond de pannes (5 par jour) : un client ne paie donc jamais plus qu'avant.
- **Dans un lot**, une carte à candidat unique est une question de lot comme les autres (`lot: true`) : répondre NON ne rend rien carte par carte, le lot ayant été payé d'un seul bloc (§3.1). **Le client ne paie jamais plus qu'avant** : le LOT ENTIER est rendu, UNE fois, quand sa dernière question de confirmation est réglée (NON, `ne-sait-pas` ou abandon au balayage de 24 h) et que CHACUNE de ses cartes est alors un `introuvable` ou une confirmation non confirmée. Une carte affirmée, une confirmation OUI ou une question à 2 ou 3 candidats (quelle que soit sa réponse) : le lot n'est pas rendu par cette règle. Le remboursement est celui d'un lot entièrement introuvable (même compteur de pannes, même unicité par scan : deux NON simultanés ne rendent qu'une fois). Un lot sans question reste remboursé comme avant s'il est entièrement introuvable. Réserve assumée : un OUI sur une confirmation dans un lot de confirmations est une carte reconnue, le lot est alors payé. **`ne-sait-pas` dans un lot est une réponse FINALE** : elle compte comme une confirmation non confirmée pour cette règle, et un OUI qui la suit sur la même carte répond `409 CONFLIT`. Si le plafond de pannes du jour est atteint, le lot n'est pas rendu et la réponse du dernier NON le dit (`facturation { debite, rembourse: false, motif: "plafond-jour", raisonNonRembourse: "plafond-jour" }`, redite à l'identique au rejeu). **Ce que fait le serveur quand le remboursement d'un lot ne peut pas se faire tout de suite** (erreur du ledger, analyse absente, arrêt du processus) : (1) si le remboursement échoue, l'état « lot à rendre » est écrit en base et la réponse porte le champ additif `remboursementEnAttente: true` (`facturation.rembourse` reste faux : lire le solde plus tard) ; (2) le JUGEMENT du lot est un état dérivé : à chaque passage, le balayage (toutes les minutes) rejuge les lots dont toutes les questions sont réglées sans décision ni marque, et reprend les lots « à rendre », du plus ancien, **au plus `V2_LOT_REPRISES_PASSAGE` lots (défaut 200) par phase et par passage** ; (3) le rejeu d'un NON de lot rejuge aussi, idempotent (même claim `rb|scanId`, jamais deux remboursements) et relit le grand livre : « déjà rendu » répond `rembourse: true` ; la REPRISE d'un remboursement partiel déjà commencé pour ce scan (une claim « fait » de ce scan existe) ne recompte pas le plafond de pannes, qui a été compté à la première tentative ; et le plafond n'est jamais écrit comme décision définitive quand des unités du lot sont déjà rendues (le lot reste « à rendre » et listé) ; (4) « rendu » se juge sur les MOUVEMENTS du grand livre (un remboursement de `delta 1` par unité débitée), pas sur l'état du débit : l'état ne s'efface que lorsque TOUT le montant du lot (`ceil(N/10)` unités) est rendu ; un débit marqué rendu SANS mouvement correspondant est ambigu, jamais pris pour rendu : le lot est aussitôt marqué « à rendre » (donc listé par `lotsARendre`, jamais décidé « plafond-jour » ni « rendu »), et le débit est listé par la réconciliation (`debitsRembourseSansMouvement`) au-delà de `V2_CLAIM_ORPHELINE_MIN` minutes (60 à 10080, défaut 60) mesurées depuis la dernière tentative de remboursement du scan (à défaut de toute ligne de remboursement pour ce scan, depuis la date du débit) ; **MOYENS-B2a, l'ordre du grand livre** : la prise d'une unité écrit `rendu-en-cours` AVANT de rendre le crédit, puis le crédit est rendu, sa trace (`delta 1`) est écrite, et SEULEMENT alors la ligne passe `rembourse` (même règle pour une unité rendue seule, `rembourserLigne`) ; un arrêt n'importe où dans cette séquence laisse une ligne `rendu-en-cours`, listée AUSSITÔT par la réconciliation (`rendusEchoues`, sans attendre de délai), jamais reprise seule ni rendue deux fois, et comptée comme « prise sans trace » par le jugement du lot. **Tant qu'une unité est `rendu-en-cours`, le remboursement répond « remboursement-en-cours » (cause interne, publiée comme `erreur` : le client lit `rembourse: false`, jamais « remboursé » pour un crédit non écrit) ; le lot reste « à rendre » et listé.** **Issue : un geste d'OPÉRATEUR, pas automatique** (décision du coordinateur, réversible) : l'outil `v2/argent/reparer-debit.js` (AUDIT-SECURITE-V2.md §15) refait la preuve par le grand livre et, selon l'écart de poche, rend le crédit et écrit la trace, ou écrit la trace seule, ou clôt la ligne en `rembourse` quand la trace existe déjà ; jamais un second crédit. Il refuse tant qu'un mouvement du porteur sur la même poche date de moins de `V2_REPARATION_AGE_MIN` minutes (entier de 5 à 1440, **défaut 15**). Un débit `rembourse` sans mouvement n'existe que d'AVANT ce lot (même outil). **Tour 2 : un crédit se reconnaît par son DÉBIT** — l'identité du débit est posée sur le document de la poche dans la MÊME écriture atomique que le crédit (`creditsRendus`, les 200 derniers), et la trace +1 porte `debitId` sous un index unique : deux chemins qui rendent le même débit (balayage, remboursement d'une unité, annulation d'un supplément, réparation, compensation de `debiter`) n'écrivent qu'UN crédit et UNE trace **tant que l'identité du débit est dans le marqueur, c'est-à-dire pour les 200 derniers débits rendus par DOCUMENT de poche** (`comptes` : accueil, acheté ET abonnement partagent un marqueur ; `installations` : essai et acheté ; `hebdo` : un par semaine). **Limite exacte : au-delà, l'identité la plus ancienne sort ; la réparation REFUSE alors (`marqueur-sature`) un débit pris dont l'identité n'est pas dans un marqueur plein — elle ne crédite jamais sans preuve, `reconcilier` liste la ligne avec son geste (vérifier à la main le grand livre).** Une unité hebdomadaire ne survit pas à sa semaine : sans marqueur ni document hebdo, la ligne se CLÔT sans crédit (`semaine-expiree`). La réparation lit ce marqueur et cette trace, l'écart de poche n'est plus qu'un témoin (il ne juge que les débits d'avant le tour 2, sans marqueur ni trace). Un débit pris depuis moins de `V2_REPARATION_AGE_MIN` minutes (`priseLe`) est tenu par un remboursement vivant : la réparation attend. `poche-deja-compensee` (le crédit de CE débit est déjà sur la poche : compensation puis écriture tardive) est une cause interne : la passe de rattrapage la lit, et un client peut la lire si la réponse du crédit s'est perdue (`rendu-echoue` dont le crédit EST écrit) puis qu'il rejoue le remboursement ; publiée, elle est `erreur` avec `rembourse: false` alors que le crédit est écrit — la réparation prouve ce crédit par son marqueur, écrit la trace et clôt la ligne ; (5) la réconciliation liste les lots « à rendre » (avec leur nombre d'essais) et les lots réglés mais non jugés (plus de 10 minutes après la DERNIÈRE réponse du lot) et n'est pas « propre » tant qu'il en reste ; (6) **UN-CANDIDAT-2** : une ligne de lot restée `en-reglement` (arrêt du processus, erreur de base pendant le règlement) est REPRISE par le balayage au-delà de `V2_LOT_REGLEMENT_REPRISE_MIN` minutes (entier de 1 à 1440, défaut 15), de façon idempotente (aucun crédit n'a bougé avant l'écriture d'état, le remboursement du lot passe par son claim), et listée par la réconciliation (`lotsEnReglement`) tant qu'elle ne l'est pas ; le même délai déclenche la CONTINUATION d'un remboursement de lot interrompu entre deux unités (la claim `rb|scanId` portant une unité rendue est renommée et les unités restantes sont rendues, chacune une seule fois) ; (7) un lot qui échoue passe derrière les autres au balayage (compteur d'essais, jamais d'affamement) ; (8) si une question du lot ne peut pas être réservée, le client est rendu et les lignes déjà posées finissent terminales (`lotIssue`) : la réconciliation ne les liste plus ; (9) une claim `rb|scanId` sans aucune unité rendue (arrêt entre la claim et la première unité), ou portant une unité rendue alors que des débits restent ouverts après la continuation du balayage, n'est reprise par aucun mécanisme du grand livre : la réconciliation la LISTE (elle n'est PAS reprise) avec son âge (`claimsOrphelines`) au-delà de `V2_CLAIM_ORPHELINE_MIN` minutes (entier de 60 à 10080, défaut 60, réglage distinct de la reprise des `en-reglement`), et le verdict n'est pas « propre » ; sa libération est une procédure manuelle (AUDIT-SECURITE-V2.md §15) ; (10) **un refus de plafond n'est pas toujours définitif** : un lot dont une unité est DÉJÀ rendue (ou prise sans trace) et dont le plafond de pannes du jour est plein n'est jamais décidé « plafond-jour » : il reste « à rendre » et listé. **Deux cas, deux issues** : (a) la trace « fait » d'une unité rendue est perdue (aucune claim `…|fait|…` pour ce scan) : le balayage le rend LE LENDEMAIN (le jour UTC suivant), sur le compteur de CE jour-là (rejoué, RR-6 de la relecture d'UN-CANDIDAT-2) ; (b) la claim `rb|scanId` porte déjà un `delta 1` et n'a seulement pas été renommée (arrêt entre deux unités) : au bout de `V2_LOT_REGLEMENT_REPRISE_MIN` minutes la continuation du balayage la renomme et rend le reste LE JOUR MÊME, sans recompter le plafond (`sansPlafond` ; banc 18a de `test-un-candidat-route.js` : plafond 5 avant et après, tout rendu au balayage suivant). Le plafond de chaque jour est respecté, mais dans le cas (a) un refus du jour J devient un remboursement du jour J+1 (comportement gardé sur décision du coordinateur, question au testeur ; le code n'a pas changé). Seul un lot dont RIEN n'est rendu ni pris reçoit `plafond-jour` comme décision définitive. Limites dites : si la base est muette au point que même l'état ne peut pas s'écrire, le jugement dérivé du balayage le retrouvera quand elle revient, mais rien n'est instantané ; une analyse qui reste absente laisse le lot payé et listé.
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
- **Limites** : 2 installations par IP et par jour (au-delà de 500 installations dotées d'essais par jour, une installation naît à 0 essai) ; 5 essais faux de code de liaison par installation et par heure (20 par IP) ; 10 essais de connexion par compte et par heure ; 120 identifications par compte et par heure ; 1 000 écritures de collection par compte et par heure.
- **Plafonds horaires par porteur (MOYENS-B1, O4)** : par heure et par porteur (le compte, ou l'installation), `GET /api/compte` 600 par défaut (`V2_COMPTE_HEURE`, réglable ; les autres valeurs ci-dessous sont aussi des défauts), `POST /api/solde` 1 200 (`V2_SOLDE_HEURE`), `POST /api/identifier/reponse` 600 (`V2_REPONSE_HEURE`), `POST /api/retour-live` 600 (`V2_RETOUR_LIVE_HEURE`). Chaque route a son compteur ; au-delà : `429 DEBIT` avec `reessayerDans` et `Retry-After`. **La fenêtre est FIXE** : une heure alignée sur l'heure UTC (pas une durée glissante). Un client peut donc passer jusqu'à 2N requêtes à cheval sur la frontière de deux fenêtres (N juste avant, N juste après) ; `Retry-After` (et `reessayerDans`) désigne la FIN de la fenêtre courante, jamais moins d'une seconde. **Un plafond borne un porteur, pas une flotte** : les installations liées à un même compte se résolvent toutes en ce compte et partagent UN plafond par route ; une installation non liée est un porteur à part, avec son propre plafond. La multiplication des porteurs n'est bornée que par la création d'installations : 2 installations par adresse IP et par jour, et au-delà de 500 installations dotées d'essais par jour (global), une installation naît à 0 essai (voir la ligne « Limites » ci-dessus). O4 n'ajoute aucun plafond global. **Ces valeurs sont posées SANS mesure d'usage réel** : si elles sont trop basses, un client très actif reçoit des 429 et la valeur se relève par la variable d'environnement.
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

---

## 6. Les erreurs, et ce que chaque client doit faire

Tout refus a la forme `ReponseErreur` : `{ success: false, erreur: { code, message, detail?, reessayerDans? }, facturation, solde?, achat? }`. `facturation` est toujours présent (`null` quand rien n'a été analysé). `solde` accompagne `QUOTA` et `VERIFICATION`, et les pannes remboursées. `achat.url` accompagne `QUOTA` pour un compte.

| code | statut | quand | ce que le client doit faire |
|---|---|---|---|
| `JETON` | 401 | Bearer absent, inconnu ou révoqué | extension : recréer une installation (`POST /api/installation`) |
| `VERIFICATION` | 403 | compte lié dont l'adresse n'est pas confirmée | afficher « **confirmez votre adresse** » (pas « crédits épuisés ») |
| `QUOTA` | 429 | plus aucune analyse disponible | **proposer un compte** (installation non liée) ou la recharge (`achat.url`, compte) ; afficher le jour du retour de l'hebdomadaire (`solde.prochainHebdo`) |
| `DEBIT` | 429 | trop vite, ou requête identique en cours | **attendre `reessayerDans` secondes** (en-tête `Retry-After` aussi), puis rejouer avec la MÊME `Idempotency-Key` |
| `INDISPONIBLE` | 503 | base, catalogue ou index injoignables | rien n'est débité (remboursé) ; réessayer plus tard |
| `IMAGE` | 200 | aucune image exploitable | statut 200 conservé comme la route héritée ; au scanner, `detail` : `trop-lourde` (413) · `format` (415) · `aucune-carte` (422) |
| `IA` | 200 | la lecture de l'image a échoué | remboursé ; **une panne n'est jamais un introuvable** |
| `SERVEUR` | 500 | erreur interne | remboursé (sous le plafond de 5 pannes par jour) ; défaut sûr pour un code inconnu |
| `VERSION` | 426 | `versionExtension` sous `versionMinExtension` | **demander la mise à jour** de l'extension |
| `MARCHE` | 422 | marché hors liste | message « ce marché n'est pas pris en charge » |
| `SESSION` | 401 | cookie absent, expiré ou révoqué | site : renvoyer vers la connexion |
| `ORIGINE` | 403 | `Origin` ou `X-Rat-Market` manquant sur une écriture par cookie | bug du site : jamais montré à l'utilisateur |
| `IDENTIFIANTS` | 401 | adresse ou mot de passe incorrects | « adresse ou mot de passe incorrect » (le message ne dit jamais si l'adresse existe) |
| `MOT_DE_PASSE_FAIBLE` | 422 | moins de 10 caractères | afficher la règle |
| `CODE_INVALIDE` | 404 | code de liaison ou jeton de lien inconnu ou déjà utilisé | redemander un code / un lien |
| `CODE_EXPIRE` | 410 | code (10 min), lien (24 h) ou question (24 h) échu | redemander |
| `DEJA_LIE` | 409 | l'installation est déjà liée | proposer de la délier d'abord |
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
  "achat": {
    "url": "https://rat-market.fr/fr/compte#recharge"
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
| A7 | description « non conservée » / « 3 mois » | expurgée côté serveur, **conservée 90 jours** puis effacée (§8) | C5, C6 |
| A8 | « secours `onrender.com` » listé parmi les origines CORS | adresse de secours du **serveur**, pas une origine | C18, Q6 |
| A9 | `variante` toujours une valeur de la liste | **`null`** quand l'édition n'est pas connue (jamais `normale` deviné) | Q31 |
| A10 | `liens.cardmarket` toujours une adresse | **`null`** tant que numéro ET rareté ne sont pas connus (jamais de lien anonyme) ; même règle pour `impressions[].lien` | Q31 |
| A11 | « réponse commune » (banc RatMarket) | pas d'issue de ce nom : une carte `a-trancher` avec la question `visuel` | Q34 |
| A12 | `IMAGE` et `IA` en erreur HTTP | `IMAGE` et `IA` gardent le statut **200** (`success: false`) ; `VERSION` 426, `MARCHE` 422 | Q12 |
| A13 | 24 marchés (extension) / 16 domaines (CORS hérité) | la liste est celle du serveur (`V2_MARCHES`, 16 domaines Vinted + `vinted.com` par défaut) ; hors liste : `422 MARCHE` | C13, Q26 |
| A15 | « une carte identifiée absente du guide » : rien de dit côté clients | une carte identifiée dont `prixGuide` est `null` est **remboursée**, `motif: sans-prix` (règle de l'éditeur « un résultat sans aucun prix lisible est remboursé », valable aux deux surfaces ; à confirmer par l'éditeur) | CONTRAT-2 §6 |
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
| E5 | fausses : `Produit` sans `impressions` ; `prixGuide` sans `moyenne30` ; impressions : `prixGuide: { de, tendance }` | `impressions` toujours présent ; `prixGuide` toujours `{ tendance, de, moyenne30, date }` (null pour une valeur absente), y compris dans les impressions |
| E6 | fausse introuvable : `etat` rempli de `null` | `etat: null` pour un introuvable |
| E7 | fausse quota : `facturation` avec `motif: null` | `facturation: null` (aucune analyse) ; un `motif` n'est jamais `null` |
| E8 | fausses : images `https://pub-fictif.r2.dev/…` | l'hôte exact du bucket public (`pub-7d992e666c3d4a2b870b680a920045b6.r2.dev`) ou `rat-market.fr` |
| E9 | fausses : `variante: "normale"` partout, `liens.cardmarket` rempli sans numéro ni rareté | `variante: null` et `liens.cardmarket: null` dans ces cas (A9, A10) |
| E10 | `CODES_ERREUR` de l'extension : 10 codes du serveur + `RESEAU` + `EXTENSION` | 20 codes serveur ; `RESEAU` et `EXTENSION` restent côté client |
| E11 | `reels.js` : `set.slug: null` | `set.slug` est une chaîne (jamais `null`) |

#### 7.3 bis — Les écarts de forme MESURÉS (B7b.1, `v2/test/test-contrat-extension.js`)

Les dix fichiers de `extension v2\src\fond\fausses\` ont été rejoués contre le schéma (les six réponses d'analyse et les quatre de `reels.js` — module de données pur, lu en texte — contre `ReponseAnalyse`, carte par carte contre la branche de leur statut ; `quota.json` contre `ReponseErreur` ; chacune des 13 réponses de `reponses.json` RECONSTRUITE en entier — carte, facturation, solde — et jugée contre `ReponseQuestion`). Le banc échoue si un écart n'est pas listé ici avec son chemin JSON exact. **Rien n'a été corrigé ni dans l'extension (lecture seule) ni dans le schéma** : le schéma décrit ce que le serveur rend, et c'est l'extension qui doit changer. Colonne « fichiers » : ceux qui portent l'écart.

| réf. | route et statut | chemin JSON | l'extension attend (fausse) | le serveur rend (schéma) | fichiers | qui doit changer |
|---|---|---|---|---|---|---|
| E1 | `POST /api/identifier` 200 | `$.solde.essai` | absent | clé requise (entier) | identifiee, lot, a-trancher | l'extension |
| E1 | `POST /api/identifier` 200 | `$.solde.abonnement` | absent | clé requise (objet ou `null`) | identifiee, lot, a-trancher | l'extension |
| E1 | `POST /api/identifier` 200 | `$.solde.soldeGratuit` | présent | **n'existe pas** (forme héritée seulement) | identifiee, lot, a-trancher, quota | l'extension |
| E1 | `POST /api/identifier` 200 | `$.solde.restantSemaine` | présent | **n'existe pas** | idem | l'extension |
| E1 | `POST /api/identifier` 200 | `$.solde.soldeScans` | présent | **n'existe pas** | idem | l'extension |
| E1 | `POST /api/identifier` 200 | `$.solde.compte.verifie` | absent | clé requise (booléen) | idem | l'extension |
| E1 | `POST /api/identifier` 429 | `$.solde.essai` | absent | clé requise (entier) | quota | l'extension |
| E1 | `POST /api/identifier` 429 | `$.solde.abonnement` | absent | clé requise (objet ou `null`) | quota | l'extension |
| E1 | `POST /api/identifier` 429 | `$.solde.soldeGratuit` | présent | **n'existe pas** | quota | l'extension |
| E1 | `POST /api/identifier` 429 | `$.solde.restantSemaine` | présent | **n'existe pas** | quota | l'extension |
| E1 | `POST /api/identifier` 429 | `$.solde.soldeScans` | présent | **n'existe pas** | quota | l'extension |
| E1 | `POST /api/identifier` 429 | `$.solde.compte.verifie` | absent | clé requise (booléen) | quota | l'extension |
| E2 | `POST /api/identifier` 200 | `$.facturation.reserve` | absent | clé requise (0 ou 1) | identifiee, lot, a-trancher, introuvable | l'extension |
| E2 | `POST /api/identifier/reponse` 200 | `$.<scanId>[].<choix>.facturation.raisonNonRembourse` | absent | clé requise (`null` ou une raison) | reponses | l'extension |
| E3 | `POST /api/identifier` 200 | `$.solde` | `null` | objet, **toujours** présent après une analyse | a-trancher, lot, introuvable | l'extension |
| E4 | `POST /api/identifier` 200 | `$.question` | `{ etat, delaiHeures }` à la racine | clé **non servie** (le délai est de 24 h, fixe) | a-trancher | l'extension |
| E5 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.impressions` | absent | clé requise (`[]` par défaut) | identifiee, lot | l'extension |
| E5 | `POST /api/identifier` 200 | `$.analyse.cartes[].candidats[].impressions` | absent | clé requise | a-trancher, lot | l'extension |
| E5 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.prixGuide.moyenne30` | absent | clé requise (nombre ou `null`) | identifiee, lot | l'extension |
| E5 | `POST /api/identifier` 200 | `$.analyse.cartes[].candidats[].prixGuide.moyenne30` | absent | clé requise | a-trancher, lot | l'extension |
| E5 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.impressions[].prixGuide.moyenne30` | absent | clé requise | identifiee-impressions | l'extension |
| E5 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.impressions[].prixGuide.date` | absent (`{ de, tendance }`) | clé requise (date du guide) | identifiee-impressions | l'extension |
| E6 | `POST /api/identifier` 200 | `$.analyse.cartes[].etat` | objet rempli de `null` (introuvable) | `null` pour un introuvable | introuvable | l'extension |
| E7 | `POST /api/identifier` 429 | `$.facturation` | `{ debite:0, rembourse:false, motif:null, … }` | `null` (aucune analyse) | quota | l'extension |
| E8 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.visuel.url` | `https://pub-fictif.r2.dev/…` | `https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/…` ou `https://rat-market.fr/…` | identifiee, identifiee-impressions | l'extension |
| E8 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.visuel.grande` | objet dont l'URL est fictive | objet `Image` de l'hôte public, ou `null` | identifiee | l'extension |
| E8 | `POST /api/identifier` 200 | `$.analyse.cartes[].candidats[].visuel.url` | `https://pub-fictif.r2.dev/…` | l'hôte public exact | a-trancher, lot | l'extension |
| E11 | `POST /api/identifier` 200 | `$.analyse.cartes[].carte.set.slug` | `null` (set sans slug) | chaîne : le slug du set est toujours connu | reels.js | l'extension |

Non mesuré par cette lecture de forme (aucune faute de FORME, la faute est de sens) : E9 (`variante` et `liens.cardmarket` remplis alors que le serveur rend `null` quand l'édition ou le numéro est inconnu — les valeurs `normale` / une adresse sont de forme valide), E10 (codes d'erreur : le fichier `quota.json` n'en porte qu'un). `lectures.json` n'est pas une réponse du serveur (les grilles de la lecture live simulée ne sont jamais envoyées : le serveur ne reçoit que `prixLive` et `prixLiveEtat`) ; ses états `MT`…`PO` et ses prix (`null` ou > 0) tiennent la liste fermée du contrat.

### 7.4 Ce que le SERVEUR doit aligner ou documenter (mesuré par B7b.1, `v2/test/test-contrat-reel.js`)

Le banc joue chaque route de `paths` dans chaque état contre le serveur v2 réel. Ces constats ne sont **pas** des écarts de client ; ils sont écrits ici pour que le coordinateur et les agents du serveur les tranchent. **Chaque ligne porte, dans la même ligne, la route, le statut et le chemin** : le banc les cherche ainsi (une mention quelque part dans la section ne prouve rien).

*Réglés au tour 1 de B7b.1 :* l'historique de `GET /api/compte` est servi dans la forme du contrat (ancien défaut du serveur, `type` / `scanId` / `cartes[]` / `delta` / `poche`) ; les routes `POST /api/compte/renvoyer-verification`, `POST /api/banc/correction` et `DELETE /api/banc/contributions` sont **publiées** ; `Facturation.raisonNonRembourse` est resserrée à la liste fermée de `sources.js` (additif côté serveur : il ne rend déjà que ces valeurs ou `null`) ; le statut `429` de `verification` / `reinitialiser` et le `400` de `reinitialiser` sont documentés.

| # | route · statut · chemin | constat | décision à prendre |
|---|---|---|---|
| X1 | `GET /api/compte` · `200` · `$.historique.lignes[]` | **trou du contrat, pas du serveur** : le contrat n'a pas de motif de crédit pour une poche `abonnement` ni `essai`. Ces lignes sont **omises de l'historique, jamais inventées sous un autre motif**, et le banc compte celles qu'il omet. De même une analyse ancienne sans `facturation` complète ou sans `surface` est omise (rien n'est fabriqué). | ajouter des motifs (`abonnement`, `essai`) au contrat si le site veut les montrer |
| X2 | `POST /api/creer-recharge` · `501` · `404` | **servie, jamais publiée** : montée derrière un aiguilleur dont le prédicat exige un porteur v2 que rien ne résout sur cette route ; elle passe donc toujours la main à la route héritée (404 dans le banc, qui n'en a pas). Son `501 INDISPONIBLE` / `paiement-non-branche` est **inatteignable en l'état**. Publiée quand elle sera implémentée ; l'alignement 501 / `INDISPONIBLE` est parqué pour la tâche de paiement. | publier avec le paiement |
| X4 | `POST /api/identifier` · `200` · `pas-une-carte` | listée au contrat, **jamais produite** par le code du serveur (seules `photo-illisible`, `hors-catalogue`, `panne-lecture` et `impression-indeterminee` sortent) | les clients ne comptent pas dessus |
| X4 | `POST /api/identifier` · `200` · `plusieurs-cartes-non-separees` | idem | idem |
| X4 | `POST /api/identifier` · `200` · `$.analyse.cartes[].carte.set.tirage` | `Produit.set.tirage` est **toujours `null`** (le catalogue ne porte pas le tirage) | les clients ne comptent pas dessus |
| X5 | `DELETE /api/compte` · `400` | documenté, jamais rendu : aucun chemin de `v2/comptes/routes.js` l.117-125 ne le produit | laisser documenté (inoffensif) ou retirer |
| X5 | `POST /api/compte/deconnexion` · `401` | documenté, jamais rendu : la déconnexion rend 200 même sans cookie (l.63-69) | idem |
| X5 | `POST /api/compte/mot-de-passe-oublie` · `400` | documenté, jamais rendu : un corps illisible vaut une adresse absente, 202 neutre (l.71-77) | idem |
| X7 | `POST /api/identifier` · `403` | **documenté, plus atteignable (O3)** : un compte non confirmé n'est plus un porteur (`v2/porteur.js` : sa session est refusée, une installation qui lui serait liée redevient une installation seule). Le `403` `VERIFICATION` reste documenté (garde en profondeur de la chaîne, du scanner et de la collection) mais aucune requête ne l'atteint plus. | laisser documenté (inoffensif) ou retirer ; les clients traitent `VERIFICATION` comme avant |
| X6 | code `EN_RECONCILIATION` | n'est produit que sur une clé de débit rejouée dont la ligne attend la réconciliation (état fabriqué par `test-argent-tour4.js`) ; le banc de contrat le déclare non produit et échoue si un état courant le produit | rien |

---

## 8. Les conditions de conservation

| donnée | durée | à l'échéance |
|---|---|---|
| titre et description d'annonce, **expurgés** des coordonnées du vendeur | **90 jours** | effacés (purge testée) ; ce sont des données, jamais des consignes ; la description ne part pas au modèle par défaut |
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
| à trancher (2 et 3 candidats), lot | `a-trancher-2`, `a-trancher-3`, `lot` |
| introuvable (une par raison) | `introuvable-photo-illisible`, `introuvable-pas-une-carte`, `introuvable-hors-catalogue`, `introuvable-plusieurs-cartes-non-separees`, `introuvable-panne-lecture`, `introuvable-impression-indeterminee` |
| pannes | `panne-ia`, `panne-indisponible`, `panne-serveur`, `panne-plafond-jour` |
| refus | `quota-compte`, `quota-installation`, `verification`, `debit`, `cle-reutilisee-identifier`, `cle-reutilisee-reponse`, `cle-reutilisee-retour-live`, `cle-en-cours-reponse`, `cle-en-cours-retour-live`, `jeton`, `version`, `marche`, `entree`, `image` |
| questions | `question-repondue`, `question-abandonnee-aucune`, `question-abandonnee-ne-sait-pas`, `question-plafond` |
| prix lu | `retour-live`, `retour-live-sans-prix` |
| solde de chaque porteur | `solde-installation-non-liee`, `solde-installation-liee`, `solde-compte-non-verifie`, `solde-abonnement` |
| comptes | `installation-creee`, `lier`, `code-liaison`, `compte`, `compte-non-verifie` |

---

## 10. Ce qui n'est pas encore garanti

- Les routes du scanner (`/api/scanner/…`) ne seront livrées que sur confirmation de l'éditeur.
- Le schéma est vérifié contre les **fausses** réponses, contre le **code** (listes fermées, routes) et (B7b.1, `v2/test/test-contrat-reel.js`) contre les réponses **réelles** du serveur : chaque route de `paths` dans chaque état que le serveur sait produire, avec un seul écart connu (X1, §7.4). Ce que le banc ne prouve pas : le comportement réel du modèle de lecture (le faux réseau rejoue des lectures enregistrées) et les routes du scanner sur un navigateur réel.
- La valeur du quota mensuel d'un abonnement (`quotaMensuel`) est une valeur de configuration (100 par défaut, inventée faute de source) : elle viendra de l'éditeur.
