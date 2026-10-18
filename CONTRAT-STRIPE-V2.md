# CONTRAT-STRIPE-V2 — les abonnements Pro et Fondateurs, le parrainage, le portail, les webhooks

Lot STRIPE-V2, phase **Test** (2026-10-18). Complète `CONTRAT-API-V2.md` (mêmes erreurs, mêmes cookies, même origine du site). Tout est derrière `V2_ABONNEMENTS`, **éteint par défaut** :
éteint, aucune des quatre routes ci-dessous n'existe (404 natif), le SDK Stripe n'est jamais chargé, et la v1 (`/api/webhook-stripe`, les packs de crédits) est intacte.

## 1. Les offres (valeurs décidées)

| offre | mensuel | annuel | accès |
|---|---|---|---|
| **Pro** | 4,99 € | 39 € | libre |
| **Fondateurs** | 2,99 € | 29 € | sur code seulement (lien réservé, jamais public — §2 quater), 100 places (`V2_FONDATEURS_PLACES`, défaut 100) |

- Devise EUR. Les montants en centimes dans les réponses : 499 et 3 900.
- **Essai de 14 jours SANS CARTE, UNE fois par personne** (décision de l'éditeur, 18/10 — remplace « carte exigée dès l'essai ») : la page de paiement ne demande aucune carte (`payment_method_collection=if_required`, la première facture est de 0 €).
  **À la fin de l'essai sans moyen de paiement, l'abonnement est RÉSILIÉ** (`trial_settings.end_behavior.missing_payment_method=cancel`) : retour au gratuit, **aucun prélèvement**, statut `termine`, quota gratuit. Une carte ajoutée pendant l'essai (par le portail) :
  l'abonnement continue, premier paiement à la fin de l'essai. L'essai n'est donné qu'à qui passe la **garde de l'essai** (§2 bis) ; un refus de l'essai ne refuse pas l'abonnement : la session part sans essai, donc avec la carte.
- **Parrainage — 1 mois offert aux deux** : le filleul a 30 jours d'essai au lieu de 14 (sans carte lui aussi, même mécanisme, même garde) ; **au plus 12 mois offerts par parrain sur 365 jours glissants** (§2 ter) ; le parrain reçoit UN MOIS offert quand la
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
  **un seul client Stripe par compte** (retrouvé par ses métadonnées avant toute création, sinon créé avec une clé d'idempotence), `payment_method_collection=if_required` (essai sans carte ; sans essai, la carte est demandée), aucun code promotionnel libre, durée de vie 1 heure.
- Les autres sessions Checkout OUVERTES du même client sont **expirées** à la création d'une session (deux pages ouvertes ne donnent jamais deux paiements).
- Une place Fondateurs est **réservée** (atomiquement) à l'ouverture de la session et **portée par cette session** : elle n'est rendue que si Stripe dit que CETTE session a expiré (`checkout.session.expired`) ou que la création échoue ; la panne ou l'échec d'une AUTRE session ne la rend jamais.
  Pendant l'**essai** elle reste réservée (elle compte contre le plafond, jusqu'à la fin de l'essai + 3 jours) ; elle devient **définitive à la première facture PAYÉE** (`invoice.paid`, montant > 0) ; elle est **rendue** si l'abonnement meurt avant tout paiement (une place payée ne se rend jamais) : 100 essais sans paiement n'épuisent pas les places.
  **Avec l'essai sans carte** la règle ne change pas, mais ce qu'elle coûte change : une place peut être tenue **jusqu'à 14 jours (+ 3 jours de marge) par un essai qui ne paiera jamais** ; à la fin de l'essai sans carte l'abonnement est résilié (`customer.subscription.deleted`) et la place est rendue **tout de suite** (pas après la marge). Le code Fondateurs étant secret et la garde de l'essai limitant chaque personne à un essai, ce délai est le prix assumé de l'essai sans carte ; une place **prise** (première facture payée) ne se rend jamais.
  Un abonnement Fondateurs qui paie sans place (réservation perdue) ne prive jamais le client : une place libre est reprise, sinon le **dépassement** est compté et signalé (`fondateurs-depassement`) — le statut public ne montre rien d'anormal.

| statut | `erreur.code` | `detail` | quand |
|---|---|---|---|
| 400 | `ENTREE` | `corps`, `offre-inconnue`, `periode-inconnue`, `champ-inconnu`, `retour-invalide` | entrée refusée |
| 401 | `SESSION` | — | pas de session, ou compte non vérifié |
| 403 | `ORIGINE` | — | origine ou `X-Rat-Market` absents |
| 409 | `CONFLIT` | `abonnement-actif` | **un seul abonnement par compte** : le compte a un abonnement vivant (essai, actif, impayé, suspendu) : renvoyer vers le portail |
| 409 | `CONFLIT` | `places-epuisees` | code Fondateurs valide, plus de place |
| 422 | `ENTREE` | `code-invalide` | code faux ; **offre Fondateurs fermée** (indiscernable d'un mauvais code) |
| 422 | `ENTREE` | `parrainage-non-eligible` | soi-même, parrain Fondateurs, parrainage réciproque, compte qui n'est pas un client neuf, **ou essai refusé par la garde** (le filleul n'aurait pas son essai de 30 jours) |
| 429 | `DEBIT` | — | 20 sessions par heure et par compte ; 10 essais de code par heure et par compte |
| 503 | `INDISPONIBLE` | `abonnements-indisponibles`, `prix-non-configure`, `paiement-indisponible` | configuration incomplète ou Stripe injoignable |

### `POST /api/abonnement/portail`
Sans corps. Réponse `200` : `{ "success": true, "url": "https://billing.stripe.com/…" }` (retour : `<site>/fr/compte`). **Une configuration de portail PAR OFFRE** : le portail Pro n'expose que les deux prix Pro, le portail
Fondateurs que les deux prix Fondateurs ; la route ouvre celle de l'offre de l'abonnement EN COURS du compte (Pro à défaut, jamais l'autre en repli : `503` `portail-indisponible` si elle manque). Il permet : résiliation **à la fin de la période**,
passage mensuel ↔ annuel **dans la même offre** (jamais Pro ↔ Fondateurs), carte, factures, adresse. Mentions légales du portail : CGV `https://rat-market.fr/cgv` et confidentialité `https://rat-market.fr/politique-confidentialite` (page confirmée).
Défense en profondeur : un abonnement qui passerait au prix Fondateurs sans place prise par le compte n'accorde rien de plus (voir §3). `409 CONFLIT` (`aucun-abonnement`) si le compte n'a jamais eu de client Stripe.

### `GET /api/abonnement`
Exemple : un essai de 14 jours **sans carte**, en cours (toutes les dates en ISO 8601 **UTC**).
```json
{ "success": true,
  "abonnement": { "actif": true, "plan": "pro", "periode": "mois", "statut": "essai",
                  "finPeriode": "2026-11-01T10:00:00.000Z", "finDePeriode": "2026-11-01T10:00:00.000Z",
                  "resiliationPrevue": true, "finPrevueLe": "2026-11-01T10:00:00.000Z", "prochaineEcheance": null,
                  "essaiFinLe": "2026-11-01T10:00:00.000Z", "debutEssai": "2026-10-18T10:00:00.000Z", "finEssai": "2026-11-01T10:00:00.000Z", "maintienJusqua": null,
                  "essai": { "enCours": true, "debutLe": "2026-10-18T10:00:00.000Z", "finLe": "2026-11-01T10:00:00.000Z", "carteEnregistree": false, "disponible": false, "refus": "essai-deja-utilise" },
                  "paiementEchoue": false },
  "quota": { "nom": "pro", "offre": "pro", "limite": null, "utilisees": 3, "restant": null, "remiseAZero": "2026-10-19T00:00:00+02:00" },
  "parrainage": { "code": "K7M2QX9P", "essaiFilleulJours": 30, "moisOfferts": 0, "plafondMois": 12, "fenetreJours": 365 },
  "offres": { "pro": { "mois": 499, "an": 3900 }, "source": "stripe", "devise": "EUR", "essaiJours": 14 } }
```
- `statut` : `aucun` · `en-attente` · `essai` · `actif` · `impaye` · `suspendu` · `termine`. `actif` est vrai si le compte est Pro **maintenant** (l'impayé garde Pro pendant sa grâce).
- `quota` : l'objet `offre` de `CONTRAT-API-V2.md` (le quota réel : `pro` illimité côté client, plafond technique invisible de 200 par jour, remise à zéro au minuit de Paris) **plus** les noms du site : `offre` (= `nom`), `limite` (analyses par jour de Paris ; `null` pour Pro), `utilisees` (analyses prises aujourd'hui) ; `restant` = `limite − utilisees`.
- Le code de parrainage est créé à la première lecture. L'offre Fondateurs n'est **jamais** annoncée ici.
- `offres.pro` : les montants sont relus des PRIX Stripe (cache de 10 minutes) ; `source: "constantes"` dit que la lecture a échoué et que les montants de repli sont servis.

**Les champs de dates et d'essai** (adoptés du lot L2 du site et des courriels du lot L4 ; chacun vient de l'abonnement Stripe du compte, écrit par le webhook) :

| champ | sens | valeur |
|---|---|---|
| `finDePeriode` | le prochain renouvellement, ou la fin si `resiliationPrevue` ; pendant un essai, la fin de l'essai | ISO UTC, `null` sans abonnement |
| `finPeriode` | **ancien nom** de `finDePeriode` (même valeur) | voir « Retrait des anciens noms » |
| `resiliationPrevue` | une fin est prévue : résiliation demandée **ou essai en cours dont la carte est connue comme absente** (`essai.carteEnregistree: false`) | booléen |
| `finPrevueLe` | « prend fin le… » : la fin de la résiliation prévue, ou la fin d'un essai sans carte | ISO UTC ou `null` |
| `prochaineEcheance` | « se renouvelle le… » : **seulement quand un prélèvement est sûr** — abonnement actif non résilié, ou essai AVEC carte. `null` pour un essai sans carte, un essai dont la carte est inconnue, une résiliation prévue, un impayé | ISO UTC ou `null` |
| `essaiFinLe` | la fin de l'essai EN COURS (nom du site) ; `null` hors essai | ISO UTC ou `null` |
| `debutEssai`, `finEssai` | les dates de l'essai de ce compte, **aussi après sa fin** (courriels du lot L4) ; `null` si jamais d'essai | ISO UTC ou `null` |
| `maintienJusqua` | impayé : la fin de la grâce (premier échec + 3 jours, jamais au-delà de la fin de période), donnée par l'API plutôt que calculée par le site ; `null` hors impayé | ISO UTC ou `null` |
| `essai.enCours`, `essai.debutLe`, `essai.finLe` | l'essai en cours (`debutLe` et `finLe` sont `null` hors essai) | |
| `essai.carteEnregistree` | pendant l'essai : une carte sera-t-elle prélevée à la fin ? | `true`, `false`, ou `null` (on ne sait pas) — **jamais une affirmation fausse** ; `null` hors essai |
| `essai.disponible`, `essai.refus` | un essai peut-il être accordé à ce compte ? Sinon la cause (les `detail` du §2 bis) : `essai-deja-utilise` · `domaine-jetable` · `boite-deja-utilisee` · `installation-deja-utilisee` | booléen, texte ou `null` |
| `parrainage.moisOfferts`, `plafondMois`, `fenetreJours` | les mois offerts à ce parrain sur les 365 derniers jours (primes appliquées, comptées à leur date d'application), le plafond (12) et la fenêtre (365) | entiers |

**Comment on sait qu'une carte est enregistrée (le choix, et ce qu'il coûte).** Une **lecture Stripe bornée et mise en cache**, faite par ce statut pendant un essai seulement : `subscriptions.retrieve(sid, expand: customer)` — la carte qui sera prélevée est celle que Stripe utilise lui-même (moyen de paiement par défaut de l'abonnement, à défaut celui du client, à défaut une source par défaut). Au plus **un appel par compte et par 30 secondes**, des lectures simultanées partagent le même appel, la table est bornée ; Stripe injoignable → `null` (mémorisé 10 s), jamais `false`. **Aucune permission de plus** pour la clé restreinte.
*Pourquoi pas un événement de plus au webhook :* il aurait changé la liste des sept événements (endpoint à reprovisionner en Test PUIS en Live) pour un champ d'affichage, et un événement perdu ou arrivé dans le désordre aurait fait afficher « sans carte » à tort. Coût de la lecture : une latence de Stripe sur le statut pendant l'essai seulement (rien hors essai) ; une carte ajoutée par le portail se voit au plus 30 secondes plus tard.

**Retrait des anciens noms.** Les anciens noms (`abonnement.finPeriode`, `abonnement.essai.finLe`, `quota.nom`) sont gardés **en plus** des nouveaux pendant la transition. **Date de retrait : le 1er décembre 2026** (le site lit les nouveaux noms d'ici là ; l'API les retire par un commit annoncé, jamais avant cette date). `essai.finLe` et `essai.debutLe` ne sont pas des anciens noms : ils restent.

**Les six questions du site (lot L2, entrée du 18/10) :**
1. *Essai : carte demandée ou non ?* **Sans carte.** Décision de l'éditeur du 18/10 ; le Checkout ne demande aucune carte pour un essai, l'essai se termine par une résiliation sans prélèvement si aucune carte n'est enregistrée.
2. *Parrainage* : 30 jours d'essai (sans carte) pour le filleul, un mois offert au parrain à la **première échéance payée** par son filleul (avoir de 4,99 €), au plus 12 mois offerts par parrain sur 365 jours glissants (`parrainage.moisOfferts`, `plafondMois`) ; jamais convertible en argent.
3. *Un compte non vérifié peut-il payer ?* Non : `401 SESSION` (seule une session de compte confirmé existe).
4. *Retour par défaut après le portail* : `<site>/fr/compte`, **sans paramètre** (le portail est ouvert avec `return_url=<site>/fr/compte`) ; le site n'a pas à lire de paramètre de retour.
5. *Le lien `/fr/fondateurs?code=…`* : oui, la page est voulue (noindex, hors sitemap) ; l'API la sert par `POST /api/abonnement/fondateurs` (§2 quater).
6. *Test de bout en bout* : le Test est prêt quand le coordinateur l'annonce ; le parcours automatisé (`parcours-test.js`, horloges d'essai de Stripe Test) joue l'essai sans carte et l'essai avec carte ajoutée ; les sélecteurs de la page de paiement hébergée restent à confirmer au premier essai du site (`verifier-paiement.mjs`).
Et sur le quota (question du site : « le contrat 2 expose-t-il déjà ces chiffres ? ») : `quota.limite` et `quota.utilisees` sont servis ICI, avec `quota.offre` ; `solde` ne parle que des crédits.

### 2 bis. La garde de l'essai (comptes multiples)
Écrite par ce qu'elle **autorise** : l'essai n'est donné que si **toutes** ces conditions tiennent ; chaque refus a son `detail` (lu par `essai.refus`) et **ne refuse pas l'abonnement** (la session part sans essai, avec la carte) :

| condition | refus (`detail`) |
|---|---|
| le compte est vérifié et n'a jamais eu d'essai ni d'abonnement (en base, et chez Stripe pour son client) | `essai-deja-utilise` |
| le domaine de l'adresse n'est pas jetable (la liste connue, **revérifiée au Checkout** : un compte créé avant une mise à jour de la liste ne passe pas) | `domaine-jetable` |
| **une boîte, un essai** : la clé de boîte (`cleBoite(emailCle)` : `a+x@` et `a@` sont une boîte, les points et le `+` de Gmail aussi) n'a pas déjà servi un essai pour un autre compte | `boite-deja-utilisee` |
| **au plus un essai par installation de l'extension** : chaque installation liée au compte, **ou qui l'a été**, n'a pas déjà servi un essai pour un autre compte (sans installation, la condition ne s'applique pas) | `installation-deja-utilisee` |

Aucune autre donnée : ni IP, ni empreinte du navigateur, ni carte. Le registre `abo_essais` ne porte que des **HMAC** (secret d'empreinte du serveur) de la clé de boîte et des identifiants d'installation — jamais une adresse ni un identifiant en clair —, il est posé au premier essai, **survit à la suppression du compte** (comme `adresses_octroyees`) pour la durée `V2_EMPREINTE_JOURS` (365 par défaut), puis un TTL le retire. Deux temps, comme les places Fondateurs : le Checkout **réserve** (insertion d'un `_id` unique : atomique, deux comptes de la même boîte au même instant ne reçoivent qu'un essai), le webhook **confirme** quand l'essai existe vraiment ; une réservation abandonnée expire seule (75 minutes) et est rendue si la création de la session échoue. La liaison d'une installation à un compte laisse une trace durable (`installations.comptesLies`) que `delier` ne retire pas.

### 2 ter. Le plafond du parrainage
**Au plus 12 mois offerts par parrain sur 365 jours glissants**, comptés à la date d'**application** de chaque prime. Au-delà, la prime est écrite `refusee` avec la raison `plafond-annuel` et le parrain n'est pas crédité (aucun avoir). La décision et l'écriture se font **sous un verrou par parrain** (le comptage n'est pas atomique : sans verrou, deux primes simultanées passeraient toutes les deux). 13 filleuls payants donnent 12 avoirs et 1 refus ; 365 jours après l'application des 12 premières, la place se libère. Le verrou introuvable pendant ~10 s fait échouer l'événement (Stripe le rejoue) : jamais un crédit hors plafond.

### 2 quater. L'offre Fondateurs réservée : `POST /api/abonnement/fondateurs`
L'offre n'est **jamais publique**. Le lien réservé (`<site>/fr/fondateurs?code=…`, page `noindex` hors sitemap, écrite par le site) appelle cette route avec le code. Session de compte vérifié, origine du site et `X-Rat-Market` comme les autres écritures. Corps : `{ "code": "…" }` (casse et espaces ignorés).
- **Code valide** → `200` `{ "success": true, "offre": { "nom": "fondateurs", "devise": "EUR", "prix": { "mois": 299, "an": 2900 }, "places": { "total": 100, "restantes": 87 }, "essaiJours": 14 } }` (`Cache-Control: no-store`, `X-Robots-Tag: noindex, nofollow`). Les prix sont ceux du catalogue (le provisionnement refuse un prix Stripe qui diffère).
- **Mauvais code, code absent ou mal typé, offre fermée** → la **même** réponse : `422 ENTREE code-invalide` (statut, corps, en-têtes identiques : un attaquant ne distingue pas « fermée » de « faux »).
- **Même limite d'essais que le Checkout** : 10 par heure et par compte, **compteur partagé**, compté **avant** de lire le code (`429 DEBIT`, même avec le bon code une fois la limite atteinte). Le code voyage dans le corps (POST), jamais dans une adresse que des journaux garderaient.
- Aucune autre réponse de l'API ne donne le prix ni le lien Fondateurs (parcours de toutes les routes de l'OpenAPI et des routes montées, sans session puis avec un compte ordinaire, par un banc qui cherche 299, 2 900, « 2,99 », « 29 € », le code et `fondateurs?code=`).
- **Le lien** est fabriqué par l'outil `v2/admin/abonnements/lien-fondateurs.js --ecrire` depuis `V2_FONDATEURS_CODE` du `.env` d'api-v2 et **écrit** dans `C:\Users\Yung\rat-market-travail\api\stripe\lien-fondateurs.txt` : jamais affiché, jamais journalisé (la sortie ne dit que le chemin). Si le `.env` ne porte que l'empreinte du code, l'outil s'arrête : une empreinte ne fait pas un lien.

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
- **Fin d'un essai sans carte** (le cas de l'essai sans carte, STRIPE-DECISIONS) : à la fin de l'essai, sans moyen de paiement, Stripe résilie l'abonnement (`trial_settings.end_behavior.missing_payment_method=cancel`) et envoie `customer.subscription.deleted` : le compte passe en `termine`, `abonnement.actif` faux, quota gratuit, aucune facture tentée ni payée, et une place Fondateurs **réservée** est rendue. Le registre de l'essai (`abo_essais`) devient définitif dès le premier événement d'abonnement portant un essai (`trial_start`/`trial_end`). *Limite assumée :* tant que ce webhook n'est pas arrivé, la marge de renouvellement de 48 h (ci-dessus) s'applique aussi à un essai sans carte (le droit Pro peut durer jusqu'à 48 h après la fin de l'essai si `customer.subscription.deleted` tarde) ; le statut, lui, affiche `termine` dès que l'événement est appliqué.
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
3. **Portails** : deux configurations (Pro, Fondateurs) ; dans le tableau de bord Live, la configuration PAR DÉFAUT du compte ne doit exposer AUCUN changement de plan (en Test l'ancienne configuration est devenue le défaut : Stripe refuse de la désactiver, elle a été neutralisée) ; vérifier aussi le lien de connexion public du portail. Les adresses `https://rat-market.fr/cgv` et `https://rat-market.fr/politique-confidentialite` doivent répondre 200 en production. **Essai sans carte (STRIPE-DECISIONS) :** chaque configuration de portail doit **permettre d'ajouter ou de changer la carte** (`features.payment_method_update.enabled=true`, posé par le provisionnement et vérifié par son banc) : c'est par là qu'un client d'essai enregistre sa carte avant la fin de l'essai. Aucune variable ni aucun événement de webhook de plus ; le Live n'a rien de nouveau à créer (le code est identique), seulement à rejouer le provisionnement pour réaligner les configurations si elles ont été créées avant ce lot.
4. **Variables Live** : les quatre `price_` Live, les deux `bpc_` Live, le `whsec_` de l'endpoint Live, le code Fondateurs, les places ; jamais une valeur Test.
5. **Webhook** : un endpoint Live distinct, les sept mêmes événements, version d'API égale à celle du SDK, secret différent ; contrôle du refus croisé (événement test sur service live et inverse → `mode-different`).
6. **Index** : `node v2/migrations/creer-index.js` sur la base Live avant d'allumer — **et sur la base de l'ESSAI après avoir déployé STRIPE-DECISIONS** : trois index de CONFORT sont créés (`abo_essais_ttl`, `abo_essais_compte`, `installations_comptes_lies`) ; ils ne sont jamais exigés (aucun ne garantit une propriété du droit), donc déployer avant de les créer ne ferme aucune route ; sauvegarde ; les comptes déjà écrits sont relus avec l'ancien format d'état (un seul abonnement).
7. **Vérification à 0 €** : CGV obligatoires dans le Checkout, essai, `invoice.paid` (0 €), un parrainage de bout en bout (l'avoir), un changement mensuel ↔ annuel par le portail Pro, une résiliation, la suppression de compte refusée avec un abonnement vivant — puis résilier l'abonnement de vérification et désactiver le code.
8. **Surveillance** : alerte sur les signaux `fondateurs-sans-place`, `fondateurs-depassement`, `double-abonnement`, `abonnement-orphelin-resilie`, `compte-inconnu`, `client-different`, `client-stripe-non-anonymise`, et sur les événements `rejete`/`erreur` du registre `abo_evenements` (aujourd'hui des lignes de journal).
9. **Dépendances** : SDK `stripe` épinglé ; la recherche de clients (`customers.search`) est à cohérence éventuelle chez Stripe.
