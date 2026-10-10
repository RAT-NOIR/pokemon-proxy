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
| `POST /api/identifier/reponse` | extension | Bearer | **oui** | `RequeteReponse` → `ReponseQuestion` |
| `POST /api/retour-live` (avec Bearer) | extension | Bearer | **oui** | `RequeteRetourLive` → `ReponseRetourLive` |
| `POST /api/solde` (avec Bearer) | extension | Bearer | non | rien → `ReponseSolde` |
| `POST /api/compte/lier` | extension | Bearer | non | `RequeteLier` → `ReponseLier` |
| `POST /api/compte/delier` | extension | Bearer | non | rien → `ReponseSolde` |
| `POST /api/compte/inscription` | site | aucune (+ Turnstile) | non | `RequeteInscription` → `202 ReponseSimple` (toujours, que l'adresse existe ou non) |
| `POST /api/compte/verification` | site | aucune (jeton du lien) | non | `RequeteVerification` → `ReponseVerification` |
| `POST /api/compte/connexion` | site | aucune | non | `RequeteConnexion` → `ReponseConnexion` + cookie `rm_session` |
| `POST /api/compte/deconnexion` | site | cookie | non | rien → `ReponseSimple` |
| `POST /api/compte/mot-de-passe-oublie` | site | aucune | non | `RequeteMotDePasseOublie` → `202 ReponseSimple` (toujours) |
| `POST /api/compte/reinitialiser` | site | aucune (jeton du lien) | non | `RequeteReinitialisation` → `ReponseSimple` |
| `POST /api/compte/code` | site | cookie | non | rien → `ReponseCodeLiaison` |
| `GET /api/compte` | site | cookie | non | rien → `ReponseCompte` |
| `DELETE /api/compte` | site | cookie | non | `RequeteSuppressionCompte` → `ReponseSimple` |
| `DELETE /api/compte/installations/{id}` | site | cookie | non | rien → `ReponseSimple` |
| `POST /api/scanner/analyses` *(conditionnelle, lot B9)* | site | cookie | non | multipart `RequeteScanner` → `ReponseAnalyse` |
| `POST /api/scanner/analyses/{id}/reponse` *(conditionnelle, lot B9)* | site | cookie | non | `RequeteReponse` → `ReponseQuestion` |
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

Une carte à trancher : 2 ou 3 candidats **sans ordre de classement** (rangés par `idProduct`), une question dont **chaque choix désigne exactement un candidat**, et un crédit **réservé** (`debite: 0, reserve: 1`) :

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

`choix` est l'`id` d'un choix (`a`, `b` ou `c`), `aucune` ou `ne-sait-pas`.

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

Une lecture ratée **définitive** (aucun prix lisible) est remboursée une fois par scan, motif `sans-prix` ; une lecture ratée non définitive (défi Cloudflare) ne rembourse rien :

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

---

## 2. Les règles du contrat

1. **Additif.** Sans `contrat: 2` dans la requête, la réponse d'aujourd'hui, octet pour octet : la 1.0.x publiée continue de marcher.
2. **Trois issues par carte** : `identifiee` · `a-trancher` · `introuvable`. Jamais « sous réserve » en sortie. (`lot` est un statut d'ENSEMBLE, jamais d'une carte.)
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
| `raison` d'un introuvable | `photo-illisible` · `pas-une-carte` · `hors-catalogue` · `plusieurs-cartes-non-separees` · `panne-lecture` |
| `question.code` | `reverse` · `symbole` · `numero` · `langue` · `premiere-edition` · `visuel` |
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
Le serveur ne produit pas encore les raisons `pas-une-carte`, `plusieurs-cartes-non-separees` et `panne-lecture` (la chaîne actuelle ne lit qu'une carte et distingue une panne d'une absence) ; elles restent dans la liste pour que les clients aient un texte prêt.
La liste des marchés (`marche`) n'est pas un `enum` du schéma : elle vient de la configuration du serveur (`V2_MARCHES`) ; un marché hors liste reçoit `422 MARCHE`.

### 3.1 Ce que chaque issue coûte (`facturation`)

| issue | `debite` | `reserve` | rembourse ? | `motif` |
|---|---|---|---|---|
| carte affirmée | 1 | 0 | non | `affirmee` |
| question posée | 0 | **1** | — | `question` |
| · répondue par un candidat | 1 | 0 | non | `question` |
| · `aucune`, `ne-sait-pas`, sans réponse sous 24 h | 0 | 0 | oui, sous le plafond de 30 par jour | `question` |
| lot de N cartes | `max(1, ceil(N/10))` | 0 | si aucune carte n'est identifiée (`introuvable`), ou aucune sans prix lisible (`sans-prix`) | `lot` |
| aucune carte trouvée | 0 | 0 | oui | `introuvable` |
| aucun prix lisible (`lectureRatee` définitive) | 0 | 0 | oui, une fois par scan, sous le plafond de 30 par jour | `sans-prix` |
| panne (lecture, base, source) | 0 | 0 | oui, sous le plafond de 5 par jour | `panne` |
| remboursement refusé (plafond atteint) | 1 | 0 | non, et `raisonNonRembourse` dit pourquoi | `plafond-jour` |
| compte administrateur | 0 | 0 | — | `administrateur` |

`solde.total` compte déjà les réserves en moins. Le solde se débite dans l'ordre `essai` → `accueil` → `hebdo` → `abonnement` → `achete` (réglable côté serveur). Une installation non liée n'a que ses 3 essais ; un compte **vérifié** reçoit 25 analyses offertes une seule fois, plus 2 par semaine ISO (non cumulables).

---

## 4. L'identité

| surface | comment | détail |
|---|---|---|
| extension | `Authorization: Bearer <jetonInstallation>` | le jeton (32 octets, base64url, 43 caractères) est rendu UNE fois par `POST /api/installation` ; le serveur n'en garde que l'empreinte SHA-256 ; **renouvelé à la liaison** (l'ancien est révoqué). Le `x-jeton` public de la 1.0.x ne débite plus rien en v2 : sans Bearer, `401 JETON`. |
| site | cookie `rm_session` | `HttpOnly; Secure; SameSite=Lax; Path=/`, **sans attribut `Domain`** (cookie d'hôte : `api.rat-market.fr`), 30 jours glissants, révocable. Le site appelle l'API avec `credentials: "include"`. |

- **Toute écriture authentifiée par cookie** exige `Origin: https://rat-market.fr` **et** l'en-tête `X-Rat-Market: 1` (un formulaire tiers ne sait pas le poser). Sinon `403 ORIGINE`.
- **CORS de l'extension** : origine exacte `chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb` ; `Allow-Methods: GET, POST` ; `Allow-Headers: Authorization, Content-Type, Idempotency-Key` ; `Max-Age: 600` ; **sans** `Allow-Credentials`.
- **CORS du site** : origine exacte `https://rat-market.fr`, **avec** `Allow-Credentials: true` ; `Allow-Methods: GET, POST, DELETE` ; `Allow-Headers: Content-Type, X-Rat-Market, Idempotency-Key` ; `Max-Age: 600`.
- Jamais `*`. `Vary: Origin` partout. **Les en-têtes CORS figurent aussi sur les 4xx, 5xx et 429.** Aucune origine `*.onrender.com` n'est autorisée.
- **Limites** : 2 installations par IP et par jour (au-delà de 500 installations dotées d'essais par jour, une installation naît à 0 essai) ; 5 essais faux de code de liaison par installation et par heure (20 par IP) ; 10 essais de connexion par compte et par heure ; 120 identifications par compte et par heure.
- **Mot de passe** : 10 caractères au moins. **Liens** de vérification et de réinitialisation : 24 h, usage unique. **Code de liaison** : 6 caractères `[A-Z0-9]`, 10 minutes, usage unique, 3 vivants au plus par compte.
- `libelle` d'une installation : texte libre de 60 caractères au plus, affiché sur la page du compte, **jamais interprété**.

---

## 5. L'idempotence

`Idempotency-Key` est **obligatoire** sur les trois routes qui débitent : `POST /api/identifier`, `POST /api/identifier/reponse`, `POST /api/retour-live`. Motif : `^[A-Za-z0-9_-]{8,64}$` (8 à 64 caractères). Un identifiant aléatoire par action de l'utilisateur ; **le même** pour un nouvel essai de la même action.

| situation | réponse |
|---|---|
| première fois | traitement normal |
| rejeu (même clé, même corps) | **même réponse, même statut**, en-tête `Idempotency-Replayed: true`, **aucun second débit**, aucun second appel de la chaîne d'identification |
| même clé, corps différent | `422 ENTREE` (`detail: "cle-reutilisee"`) |
| même clé, première requête encore en cours | `429 DEBIT` avec `reessayerDans: 2` |
| clé absente ou mal formée | `400 ENTREE` |

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
| `CONFLIT` | 409 | réponse différente sur une carte déjà tranchée | ne pas rejouer ; afficher le résultat déjà obtenu |
| `CREDITS_ACHETES` | 409 | suppression d'un compte qui porte des crédits achetés | demander une renonciation explicite (`renonciation: true`) |
| `ENTREE` | 400 (422 pour une clé réutilisée) | corps invalide ; `detail` précise (`image-hote`, `cle-reutilisee`, `adresse-invalide`, `adresse-refusee`, `defi-anti-robot`, `lot-trop-grand`…) | corriger la requête |
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

---

## 8. Les conditions de conservation

| donnée | durée | à l'échéance |
|---|---|---|
| titre et description d'annonce, **expurgés** des coordonnées du vendeur | **90 jours** | effacés (purge testée) ; ce sont des données, jamais des consignes ; la description ne part pas au modèle par défaut |
| image redressée versée au banc (avec consentement explicite) | **24 mois** | effacée ; effacement à la demande par le jeton de contribution (immédiat) |
| analyses (sans texte d'annonce) et mouvements de crédits | **24 mois** | effacés |
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
| introuvable (une par raison) | `introuvable-photo-illisible`, `introuvable-pas-une-carte`, `introuvable-hors-catalogue`, `introuvable-plusieurs-cartes-non-separees`, `introuvable-panne-lecture` |
| pannes | `panne-ia`, `panne-indisponible`, `panne-serveur`, `panne-plafond-jour` |
| refus | `quota-compte`, `quota-installation`, `verification`, `debit`, `cle-reutilisee-identifier`, `cle-reutilisee-reponse`, `cle-reutilisee-retour-live`, `cle-en-cours-reponse`, `cle-en-cours-retour-live`, `jeton`, `version`, `marche`, `entree`, `image` |
| questions | `question-repondue`, `question-abandonnee-aucune`, `question-abandonnee-ne-sait-pas`, `question-plafond` |
| prix lu | `retour-live`, `retour-live-sans-prix` |
| solde de chaque porteur | `solde-installation-non-liee`, `solde-installation-liee`, `solde-compte-non-verifie`, `solde-abonnement` |
| comptes | `installation-creee`, `lier`, `code-liaison`, `compte`, `compte-non-verifie` |

---

## 10. Ce qui n'est pas encore garanti

- Les routes du scanner (`/api/scanner/…`) ne seront livrées que sur confirmation de l'éditeur.
- Le schéma est vérifié contre les **fausses** réponses et contre le **code** (listes fermées, routes) ; sa vérification contre les réponses **réelles** du serveur est le lot suivant (B7b).
- La valeur du quota mensuel d'un abonnement (`quotaMensuel`) est une valeur de configuration (100 par défaut, inventée faute de source) : elle viendra de l'éditeur.
