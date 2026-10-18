# CONTRAT-STRIPE-V2 — les abonnements Pro et Fondateurs, le parrainage, le portail, les webhooks

Lot STRIPE-V2, phase **Test** (2026-10-18). Complète `CONTRAT-API-V2.md` (mêmes erreurs, mêmes cookies, même origine du site). Tout est derrière `V2_ABONNEMENTS`, **éteint par défaut** :
éteint, aucune des quatre routes ci-dessous n'existe (404 natif), le SDK Stripe n'est jamais chargé, et la v1 (`/api/webhook-stripe`, les packs de crédits) est intacte.

## 1. Les offres (valeurs décidées)

| offre | mensuel | annuel | accès |
|---|---|---|---|
| **Pro** | 4,99 € | 39 € | libre |
| **Fondateurs** | 2,99 € | 29 € | sur code seulement, nombre de places limité (100 par défaut, `V2_FONDATEURS_PLACES`) |

- Devise EUR. Les montants en centimes dans les réponses : 499 et 3 900.
- **Essai de 14 jours, UNE fois par compte** : un compte qui a déjà eu un essai ou un abonnement (en base, ou chez Stripe pour son client) n'en a plus. Carte exigée dès l'essai.
- **Parrainage — 1 mois offert aux deux** : le filleul a 30 jours d'essai au lieu de 14 ; le parrain reçoit un mois offert (coupon 100 %, `duration: once`, posé sur son abonnement) quand la
  **première facture payée** du filleul (`invoice.paid`, montant > 0) arrive. Un seul crédit par filleul ; jamais de parrainage de soi-même (même compte ou même client Stripe) ; le filleul doit être
  un client neuf. Un parrainage ne se cumule pas avec l'offre Fondateurs (le code d'un Fondateurs est le code Fondateurs).
- Les produits et les prix sont créés par `v2/admin/abonnements/provisionner.js` (idempotent, `lookup_key` : `rm_v2_pro_mois`, `rm_v2_pro_an`, `rm_v2_fondateurs_mois`, `rm_v2_fondateurs_an`). Les quatre produits de
  packs « Rat-Market — 20, 50, 100, 200 scans » ne sont jamais touchés.

## 2. Les routes du site

Identité : cookie `rm_session`, compte **vérifié** (sinon `401 SESSION`). Les écritures portent `Origin: https://rat-market.fr` et `X-Rat-Market: 1` (`403 ORIGINE`). Erreurs au format `ReponseErreur`, `facturation: null`.
**Aucun identifiant Stripe brut ne sort d'une réponse** (seulement des adresses `https://`).

### `POST /api/abonnement/checkout`
Corps : `{ offre: "pro" | "fondateurs", periode: "mois" | "an", code?: string, retour?: "/fr/…" }` — aucun autre champ (`400 ENTREE champ-inconnu`).
- `code` : le **code Fondateurs** si `offre: "fondateurs"` (obligatoire) ; un **code de parrainage** si `offre: "pro"` (facultatif). Casse et espaces ignorés.
- `retour` : un chemin du site (`/fr` suivi de 0 à 3 segments `[a-z0-9_-]`), jamais une adresse. Succès → `<site><retour ou /fr/compte>?abonnement=succes` ; abandon → `<site><retour ou /fr/tarifs>?abonnement=annule`.
- Réponse `200` : `{ "success": true, "url": "https://checkout.stripe.com/…" }` — le site envoie le navigateur à cette adresse.
- La session Stripe : `mode: subscription`, **CGV TOUJOURS exigées** (`consent_collection[terms_of_service]=required`, aucun réglage pour l'éteindre), `client_reference_id` = le compte,
  **un seul client Stripe par compte** (créé à la première session, avec une clé d'idempotence), carte exigée, aucun code promotionnel libre, durée de vie 1 heure.
- Une place Fondateurs est **réservée** (atomiquement) à l'ouverture de la session, pour sa durée + 5 minutes ; elle devient définitive quand l'abonnement existe.

| statut | `erreur.code` | `detail` | quand |
|---|---|---|---|
| 400 | `ENTREE` | `corps`, `offre-inconnue`, `periode-inconnue`, `champ-inconnu`, `retour-invalide` | entrée refusée |
| 401 | `SESSION` | — | pas de session, ou compte non vérifié |
| 403 | `ORIGINE` | — | origine ou `X-Rat-Market` absents |
| 409 | `CONFLIT` | `deja-abonne` | le compte a un abonnement vivant (essai, actif, impayé, suspendu) : proposer le portail |
| 409 | `CONFLIT` | `places-epuisees` | code Fondateurs valide, plus de place |
| 422 | `ENTREE` | `code-invalide` | code faux ; **offre Fondateurs fermée** (indiscernable d'un mauvais code) |
| 422 | `ENTREE` | `parrainage-non-eligible` | soi-même, ou compte qui n'est pas un client neuf |
| 429 | `DEBIT` | — | 20 sessions par heure et par compte ; 10 essais de code par heure et par compte |
| 503 | `INDISPONIBLE` | `abonnements-indisponibles`, `prix-non-configure`, `paiement-indisponible` | configuration incomplète ou Stripe injoignable |

### `POST /api/abonnement/portail`
Sans corps. Réponse `200` : `{ "success": true, "url": "https://billing.stripe.com/…" }` (retour : `<site>/fr/compte`). Le portail permet : résiliation **à la fin de la période**, passage mensuel ↔ annuel **dans la même offre**
(jamais Pro ↔ Fondateurs), carte, factures, adresse. `409 CONFLIT` (`aucun-abonnement`) si le compte n'a jamais eu de client Stripe.

### `GET /api/abonnement`
```json
{ "success": true,
  "abonnement": { "actif": true, "plan": "pro", "periode": "mois", "statut": "essai", "finPeriode": "2026-11-01T10:00:00.000Z", "resiliationPrevue": false,
                  "essai": { "enCours": true, "finLe": "2026-11-01T10:00:00.000Z", "disponible": false }, "paiementEchoue": false },
  "quota": { "nom": "pro", "restant": null, "remiseAZero": "2026-10-19T00:00:00+02:00" },
  "parrainage": { "code": "K7M2QX9P", "essaiFilleulJours": 30 },
  "offres": { "pro": { "mois": 499, "an": 3900 }, "devise": "EUR", "essaiJours": 14 } }
```
- `statut` : `aucun` · `en-attente` · `essai` · `actif` · `impaye` · `suspendu` · `termine`. `actif` est vrai si le compte est Pro **maintenant** (l'impayé garde Pro pendant sa grâce).
- `quota` est `offre` de `CONTRAT-API-V2.md` (le quota réel : `pro` illimité côté client, plafond technique invisible de 200 par jour, remise à zéro au minuit de Paris).
- Le code de parrainage est créé à la première lecture. L'offre Fondateurs n'est jamais annoncée ici.

### `DELETE /api/compte` (changement, tant que `V2_ABONNEMENTS` est allumé)
Supprimer le compte ne résilie pas l'abonnement chez Stripe : le client continuerait d'être débité sans compte. Un compte dont l'abonnement est vivant (essai, actif, impayé, suspendu) et dont la résiliation n'est
**pas** prévue reçoit donc `409 CONFLIT` avec `detail: "abonnement-actif"` (après la vérification du mot de passe) : le site invite à résilier par le portail d'abord. Une résiliation prévue ou un abonnement terminé laisse
supprimer. Drapeau éteint : comportement inchangé.

## 3. Le webhook : `POST /api/webhook-stripe-v2`
Route propre à la v2 (celle de la v1 reste en place), secret propre (`V2_STRIPE_WEBHOOK_SECRET`), registre propre (`abo_evenements`, jamais purgé).
- Corps **brut**, signature `Stripe-Signature` vérifiée (tolérance 300 s) ; sinon `400`, rien n'est lu ni écrit. Configuration incomplète : `503` (Stripe réessaiera).
- Les six événements : `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
- **Idempotent** : une ligne par identifiant d'événement ; déjà traité → `200` sans rien refaire ; en cours ailleurs → `409` (Stripe réessaie) ; échec de traitement → `500` et ligne « erreur » (rejouable).
- Événement pour un **compte inconnu** : enregistré (`rejete`), signalé dans les journaux, acquitté `200` ; renvoyé à la main depuis le tableau de bord, il est retraité.
- Un événement `livemode` qui ne correspond pas au mode du service (`V2_STRIPE_MODE`) est mis de côté.

### Les règles de l'état du compte (`abonnement.actif`, `abonnement.jusquAu`)
| statut Stripe | effet |
|---|---|
| `trialing`, `active` | Pro jusqu'à la fin de la période (ou de la coupure programmée si elle est plus tôt) |
| `past_due` | **Pro maintenu 3 jours après le PREMIER événement past_due**, jamais au-delà de la fin de période, **jamais prolongé** par un nouvel échec ou un nouvel événement (décision : la plus prudente pour le client — un incident de carte ne le coupe pas à la minute — sans offrir un mois gratuit pendant les relances de Stripe) |
| `canceled` / `deleted`, `unpaid`, `paused`, `incomplete`, `incomplete_expired` | plus de Pro |
| prix qui n'est pas l'un des quatre prix Rat-Market (variables, ou `lookup_key` `rm_v2_…`) | **aucun** Pro, signalé |
- **Désordre** : chaque écriture porte la date de l'événement Stripe ; un événement plus ancien que celui déjà appliqué pour le même abonnement est ignoré (égalité : le statut le plus avancé gagne). Jamais de régression.
- Une résiliation en fin de période laisse Pro jusqu'à `finPeriode`, puis le compte est gratuit (10 par jour) : la fonction des quotas (`offre.js`, inchangée) relit `jusquAu` à chaque requête.
- `invoice.payment_failed` date l'échec (`paiementEchoue`) ; le droit, lui, vient de l'abonnement.
- Un client Stripe n'appartient qu'à un compte (index unique) ; un événement dont la métadonnée désigne un autre compte que le client lié est rejeté.

## 4. Ce que le site doit afficher
Voir l'entrée du 2026-10-18 dans `DEMANDE-SERVEUR-SITE.md` (routes, retours, erreurs, textes, CGV Pro).

## 5. Les variables (noms seulement ; aucune valeur dans le dépôt)
| variable | rôle |
|---|---|
| `V2_ABONNEMENTS` | `1` allume les routes et le webhook |
| `V2_STRIPE_MODE` | `test` ou `live` (la clé doit être du même mode, sinon rien ne s'allume) |
| `V2_STRIPE_CLE` | clé secrète ou restreinte (Checkout, clients, portail, abonnements, coupons) |
| `V2_STRIPE_WEBHOOK_SECRET` | secret de l'endpoint de webhook v2 |
| `V2_STRIPE_PRIX_PRO_MOIS` · `V2_STRIPE_PRIX_PRO_AN` · `V2_STRIPE_PRIX_FONDATEURS_MOIS` · `V2_STRIPE_PRIX_FONDATEURS_AN` | les quatre `price_…` |
| `V2_STRIPE_PORTAIL_CONFIG` | la configuration du portail (`bpc_…`) |
| `V2_FONDATEURS_PLACES` | nombre de places (défaut 100, de 1 à 1000) |
| `V2_FONDATEURS_CODE` **ou** `V2_FONDATEURS_CODE_EMPREINTE` | le code (6 caractères au moins) ou son empreinte sha256 en hexadécimal — jamais les deux |

Une variable manquante ou fausse ne casse pas la v2 : les routes d'abonnement répondent `503` et le journal NOMME les variables (jamais une valeur).
