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
- **Parrainage — 1 mois offert aux deux** : le filleul a 30 jours d'essai au lieu de 14 ; le parrain reçoit UN MOIS offert quand la
  **première facture payée** du filleul (`invoice.paid`, montant > 0) arrive. « Un mois » vaut UN mois **quelle que soit la période du parrain** : la prime est un **AVOIR au solde du client Stripe** du parrain,
  égal au prix MENSUEL Pro lu chez Stripe (499 centimes), que Stripe déduit de sa prochaine facture — mensuelle (499 → 0) ou annuelle (3 900 → 3 401), jamais plus (un coupon à 100 % aurait offert une ANNÉE à un
  parrain annuel). Les avoirs s'additionnent. Un seul crédit par filleul (et avant de poser l'avoir on relit chez Stripe les transactions de solde du client : jamais un second après l'oubli de la clé d'idempotence) ;
  le filleul doit être un client neuf. **Refusés** : le parrainage de soi-même (même compte ou même client Stripe), celui d'un **Fondateurs** (le parrainage est sur Pro seulement ; son code est refusé au Checkout), et le
  **parrainage réciproque** (A parrainé par B, puis B par A : deux comptes d'une même personne s'offriraient mutuellement l'essai et le mois ; refusé au Checkout et à la prime). La prime **attend** tant que
  l'abonnement du parrain n'est pas vivant ou est en **résiliation programmée** (posée s'il reprend, ABANDONNÉE et dite s'il finit). Jamais de remboursement ni de virement.
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
  **un seul client Stripe par compte** (retrouvé par ses métadonnées avant toute création, sinon créé avec une clé d'idempotence), carte exigée, aucun code promotionnel libre, durée de vie 1 heure.
- Les autres sessions Checkout OUVERTES du même client sont **expirées** à la création d'une session (deux pages ouvertes ne donnent jamais deux paiements).
- Une place Fondateurs est **réservée** (atomiquement) à l'ouverture de la session et **portée par cette session** : elle n'est rendue que si Stripe dit que CETTE session a expiré (`checkout.session.expired`) ou que la création échoue ; la panne ou l'échec d'une AUTRE session ne la rend jamais.
  Pendant l'**essai** elle reste réservée (elle compte contre le plafond, jusqu'à la fin de l'essai + 3 jours) ; elle devient **définitive à la première facture PAYÉE** (`invoice.paid`, montant > 0) ; elle est **rendue** si l'abonnement meurt avant tout paiement (une place payée ne se rend jamais) : 100 essais sans paiement n'épuisent pas les places.
  Un abonnement Fondateurs qui paie sans place (réservation perdue) ne prive jamais le client : une place libre est reprise, sinon le **dépassement** est compté et signalé (`fondateurs-depassement`) — le statut public ne montre rien d'anormal.

| statut | `erreur.code` | `detail` | quand |
|---|---|---|---|
| 400 | `ENTREE` | `corps`, `offre-inconnue`, `periode-inconnue`, `champ-inconnu`, `retour-invalide` | entrée refusée |
| 401 | `SESSION` | — | pas de session, ou compte non vérifié |
| 403 | `ORIGINE` | — | origine ou `X-Rat-Market` absents |
| 409 | `CONFLIT` | `abonnement-actif` | **un seul abonnement par compte** : le compte a un abonnement vivant (essai, actif, impayé, suspendu) : renvoyer vers le portail |
| 409 | `CONFLIT` | `places-epuisees` | code Fondateurs valide, plus de place |
| 422 | `ENTREE` | `code-invalide` | code faux ; **offre Fondateurs fermée** (indiscernable d'un mauvais code) |
| 422 | `ENTREE` | `parrainage-non-eligible` | soi-même, ou compte qui n'est pas un client neuf |
| 429 | `DEBIT` | — | 20 sessions par heure et par compte ; 10 essais de code par heure et par compte |
| 503 | `INDISPONIBLE` | `abonnements-indisponibles`, `prix-non-configure`, `paiement-indisponible` | configuration incomplète ou Stripe injoignable |

### `POST /api/abonnement/portail`
Sans corps. Réponse `200` : `{ "success": true, "url": "https://billing.stripe.com/…" }` (retour : `<site>/fr/compte`). **Une configuration de portail PAR OFFRE** : le portail Pro n'expose que les deux prix Pro, le portail
Fondateurs que les deux prix Fondateurs ; la route ouvre celle de l'offre de l'abonnement EN COURS du compte (Pro à défaut, jamais l'autre en repli : `503` `portail-indisponible` si elle manque). Il permet : résiliation **à la fin de la période**,
passage mensuel ↔ annuel **dans la même offre** (jamais Pro ↔ Fondateurs), carte, factures, adresse. Mentions légales du portail : CGV `https://rat-market.fr/cgv` et confidentialité `https://rat-market.fr/politique-confidentialite` (page confirmée).
Défense en profondeur : un abonnement qui passerait au prix Fondateurs sans place prise par le compte n'accorde rien de plus (voir §3). `409 CONFLIT` (`aucun-abonnement`) si le compte n'a jamais eu de client Stripe.

### `GET /api/abonnement`
```json
{ "success": true,
  "abonnement": { "actif": true, "plan": "pro", "periode": "mois", "statut": "essai", "finPeriode": "2026-11-01T10:00:00.000Z", "resiliationPrevue": false,
                  "essai": { "enCours": true, "finLe": "2026-11-01T10:00:00.000Z", "disponible": false }, "paiementEchoue": false },
  "quota": { "nom": "pro", "restant": null, "remiseAZero": "2026-10-19T00:00:00+02:00" },
  "parrainage": { "code": "K7M2QX9P", "essaiFilleulJours": 30 },
  "offres": { "pro": { "mois": 499, "an": 3900 }, "source": "stripe", "devise": "EUR", "essaiJours": 14 } }
```
- `statut` : `aucun` · `en-attente` · `essai` · `actif` · `impaye` · `suspendu` · `termine`. `actif` est vrai si le compte est Pro **maintenant** (l'impayé garde Pro pendant sa grâce).
- `quota` est `offre` de `CONTRAT-API-V2.md` (le quota réel : `pro` illimité côté client, plafond technique invisible de 200 par jour, remise à zéro au minuit de Paris).
- Le code de parrainage est créé à la première lecture. L'offre Fondateurs n'est jamais annoncée ici.
- `offres.pro` : les montants sont relus des PRIX Stripe (cache de 10 minutes) ; `source: "constantes"` dit que la lecture a échoué et que les montants de repli sont servis.

### `DELETE /api/compte` (changement, tant que `V2_ABONNEMENTS` est allumé)
Supprimer le compte ne résilie pas l'abonnement chez Stripe : le client continuerait d'être débité sans compte. La garde vaut **avec ou sans** `V2_ABONNEMENTS`. Un compte dont l'abonnement est vivant (essai, actif, impayé, suspendu) et dont la résiliation n'est
**pas** prévue reçoit donc `409 CONFLIT` avec `detail: "abonnement-actif"` (après la vérification du mot de passe) : le site invite à résilier par le portail d'abord. Une résiliation prévue ou un abonnement terminé laisse
supprimer. La suppression **expire d'abord toutes les sessions Checkout ouvertes** du client puis **anonymise** le client Stripe (adresse e-mail, nom, téléphone, adresses, lien avec le compte effacés) — anonymisé et non supprimé : supprimer un client résilie ses abonnements sans prorata et fait perdre
les factures que la comptabilité conserve. Stripe en panne pendant ce nettoyage : `503` (`paiement-indisponible`), à rejouer. Stripe non configuré du tout : la suppression passe et le journal dit `client-stripe-non-anonymise`.

## 3. Le webhook : `POST /api/webhook-stripe-v2`
Route propre à la v2 (celle de la v1 reste en place), secret propre (`V2_STRIPE_WEBHOOK_SECRET`), registre propre (`abo_evenements`, jamais purgé).
- Corps **brut**, signature `Stripe-Signature` vérifiée (tolérance 300 s) ; sinon `400`, rien n'est lu ni écrit. Configuration incomplète : `503` (Stripe réessaiera).
- Les sept événements : `checkout.session.completed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.paid`, `invoice.payment_failed`.
- **Idempotent** : une ligne par identifiant d'événement ; déjà traité → `200` sans rien refaire ; en cours ailleurs → `409` (Stripe réessaie) ; échec de traitement → `500` et ligne « erreur » (rejouable).
- Événement pour un **compte inconnu** : enregistré (`rejete`), signalé dans les journaux, acquitté `200` ; renvoyé à la main depuis le tableau de bord, il est retraité. Si c'est un abonnement VIVANT qui porte un `compteId` bien formé (le nôtre) — un compte supprimé pendant que la page de paiement était ouverte —, il est **RÉSILIÉ chez Stripe tout de suite, sans prorata ni facture finale**, et signalé (`abonnement-orphelin-resilie`). **Jamais de remboursement automatique** : toute question de remboursement reste une décision humaine.
- Un événement `livemode` qui ne correspond pas au mode du service (`V2_STRIPE_MODE`) est mis de côté.

### Les règles de l'état du compte (`abonnement.actif`, `abonnement.jusquAu`)
| statut Stripe | effet |
|---|---|
| `trialing`, `active` | Pro jusqu'à la fin de la période **plus 48 heures** (marge de renouvellement : un client qui paie ne perd pas le Pro parce qu'un webhook arrive tard) ; **aucune marge** pour une résiliation programmée (fin exacte, ou de la coupure programmée si elle est plus tôt) ni pour un abonnement supprimé |
| `past_due` | **Pro maintenu 3 jours après le PREMIER événement past_due**, jamais au-delà de la fin de période, **jamais prolongé** par un nouvel échec ou un nouvel événement (décision : la plus prudente pour le client — un incident de carte ne le coupe pas à la minute — sans offrir un mois gratuit pendant les relances de Stripe) |
| `canceled` / `deleted`, `unpaid`, `paused`, `incomplete`, `incomplete_expired` | plus de Pro |
| prix qui n'est pas l'un des quatre prix Rat-Market (variables, ou `lookup_key` `rm_v2_…`) | **aucun** Pro, signalé |
- **Plusieurs abonnements** : l'état de chacun est gardé ; le Pro tient tant qu'**au moins un** est vivant (résilier l'un ne coupe jamais le Pro que l'autre paie) ; le doublon est signalé (`double-abonnement`) ; rien n'est annulé ni remboursé automatiquement.
- **Prix Fondateurs sans place** : un abonné **Pro** qui passerait au prix Fondateurs sans place (prise ou réservée) pour le compte n'accorde rien de plus : il reste Pro, signalé (`fondateurs-sans-place`), aucune place n'est prise. Un NOUVEL abonnement Fondateurs sans place est servi (voir §2 : une place libre est reprise, sinon dépassement signalé).
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
| `V2_STRIPE_CLE` | clé secrète ou restreinte (Checkout, clients et leur solde, portail, abonnements, prix en lecture) |
| `V2_STRIPE_WEBHOOK_SECRET` | secret de l'endpoint de webhook v2 |
| `V2_STRIPE_PRIX_PRO_MOIS` · `V2_STRIPE_PRIX_PRO_AN` · `V2_STRIPE_PRIX_FONDATEURS_MOIS` · `V2_STRIPE_PRIX_FONDATEURS_AN` | les quatre `price_…` |
| `V2_STRIPE_PORTAIL_CONFIG_PRO` · `V2_STRIPE_PORTAIL_CONFIG_FONDATEURS` | les deux configurations du portail (`bpc_…`), une par offre, distinctes ; celle des Fondateurs est facultative (sans elle l'offre Fondateurs reste fermée) |
| `V2_FONDATEURS_PLACES` | nombre de places (défaut 100, de 1 à 1000) |
| `V2_FONDATEURS_CODE` **ou** `V2_FONDATEURS_CODE_EMPREINTE` | le code (6 caractères au moins) ou son empreinte sha256 en hexadécimal — jamais les deux |

Une variable manquante ou fausse ne casse pas la v2 : les routes d'abonnement répondent `503` et le journal NOMME les variables (jamais une valeur).

## 6. Passage en Live (phase B) — à vérifier, À 0 € SEULEMENT
Rien de ce chapitre n'est à faire dans la phase Test. **En Live, jamais un vrai paiement** : la vérification se fait à **0 €**, par un **code promotionnel à 100 % à usage unique**, avec `payment_method_collection=if_required`, puis la résiliation de l'abonnement de vérification et la **désactivation du code** (décision du testeur).
1. **Mode et clé** : `V2_STRIPE_MODE=live` sur le service Live seulement ; clé `rk_live_…` restreinte (la configuration refuse une clé du mauvais mode). Permissions minimales : Customers (écriture et lecture, recherche comprise, transactions de solde), Checkout Sessions (écriture, lecture, expiration), Customer portal (sessions), Subscriptions (lecture, annulation), Prices (lecture). Le provisionnement exige une clé DISTINCTE (Products, Prices, Webhook Endpoints, Portal configurations) : jamais sur le service.
2. **Provisionnement Live** : produits retrouvés par `rm_cle`, prix par `lookup_key`, refus si un prix existe avec un autre montant, simulation d'abord, endpoint créé en dernier avec pose du secret (et retrait si la pose échoue) ; une seconde exécution ne crée RIEN (à prouver avant tout trafic). Il ne crée QUE les **deux portails par offre** : jamais de portail unique.
3. **Portails** : deux configurations (Pro, Fondateurs) ; dans le tableau de bord Live, la configuration PAR DÉFAUT du compte ne doit exposer AUCUN changement de plan (en Test l'ancienne configuration est devenue le défaut : Stripe refuse de la désactiver, elle a été neutralisée) ; vérifier aussi le lien de connexion public du portail. Les adresses `https://rat-market.fr/cgv` et `https://rat-market.fr/politique-confidentialite` doivent répondre 200 en production.
4. **Variables Live** : les quatre `price_` Live, les deux `bpc_` Live, le `whsec_` de l'endpoint Live, le code Fondateurs, les places ; jamais une valeur Test.
5. **Webhook** : un endpoint Live distinct, les sept mêmes événements, version d'API égale à celle du SDK, secret différent ; contrôle du refus croisé (événement test sur service live et inverse → `mode-different`).
6. **Index** : `node v2/migrations/creer-index.js` sur la base Live avant d'allumer ; sauvegarde ; les comptes déjà écrits sont relus avec l'ancien format d'état (un seul abonnement).
7. **Vérification à 0 €** : CGV obligatoires dans le Checkout, essai, `invoice.paid` (0 €), un parrainage de bout en bout (l'avoir), un changement mensuel ↔ annuel par le portail Pro, une résiliation, la suppression de compte refusée avec un abonnement vivant — puis résilier l'abonnement de vérification et désactiver le code.
8. **Surveillance** : alerte sur les signaux `fondateurs-sans-place`, `fondateurs-depassement`, `double-abonnement`, `abonnement-orphelin-resilie`, `compte-inconnu`, `client-different`, `client-stripe-non-anonymise`, et sur les événements `rejete`/`erreur` du registre `abo_evenements` (aujourd'hui des lignes de journal).
9. **Dépendances** : SDK `stripe` épinglé ; la recherche de clients (`customers.search`) est à cohérence éventuelle chez Stripe.
