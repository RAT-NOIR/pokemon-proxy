# PLAN-COMPTES — un seul système de comptes pour l'extension et le scanner

**Écrit par :** l'agent du serveur (`pokemon-proxy`) · **le :** 2026-10-06 · **pour :** l'éditeur, l'agent du site
(`rat-market-site`), l'agent de l'extension (`extension v2`).
**Lu avant d'écrire** : `extension v2/DEMANDE-SERVEUR-EXTENSION.md` (§0 bis, §3 à §10), `rat-market-site/DEMANDE-SERVICE-PRODUITS.md`
(sections du 2026-10-05 et du 2026-10-06), `rat-market-site/lib/compteContrat.ts`, `lib/scannerContrat.ts`, `acces.js`,
`index.js` (`/api/creer-recharge`, `/api/solde`, webhook Stripe). Le contrat de réponse commun est dans **`CONTRAT-2.md`**.

> **Rien de ce plan n'est en production, ni ne le sera sans le feu vert de l'éditeur.** Il décrit ce qui sera construit, dans
> quel ordre, et comment on le prouve. Les décisions déjà prises sont marquées ✅ ; ce qui reste à trancher, ❓ (§10).

---

## 1. Les décisions de l'éditeur (2026-10-06)

| | décision |
|---|---|
| ✅ essai | **3 analyses d'essai par installation**, sans compte |
| ✅ offertes | **25 analyses offertes, une seule fois par compte gratuit VÉRIFIÉ** — jamais par installation, jamais deux fois pour une même adresse |
| ✅ paiement | **réservé à un compte** : aucune recharge depuis une installation non liée |
| ✅ solde | **un seul solde par compte**, débité par l'extension comme par le scanner |
| ✅ question | facturée **une fois, quand l'utilisateur y répond** ; une question **abandonnée** (« aucune », « je ne sais pas », sans réponse 24 h) est **remboursée** |
| ✅ sans prix | un résultat **sans aucun prix lisible est remboursé** |
| ✅ lot | **1 crédit jusqu'à 10 cartes, puis 1 par tranche de 10** : `max(1, ceil(cartesVues / 10))` |
| ✅ devises | **le taux de change du jour est fourni par le serveur** (`regleVerdict.versEUR`, `tauxDate`) |

## 2. Ce qui existe aujourd'hui, et pourquoi ça ne suffit pas

- L'identité est un `userId` **tiré au hasard par l'extension** ; la route est gardée par `x-jeton`, **le même pour tous et lisible
  dans le paquet**. `acces.js` l'écrit en toutes lettres : *« toute identité produite par le client est FORGEABLE. Une identité neuve
  = une dotation d'accueil neuve »*.
- Le portefeuille est `credits` (clé `userId`) : `soldeGratuit` (accueil, 25), `soldeScans` (achetés), `email` (posé par Stripe).
  L'allocation hebdomadaire (2) vit dans `quotas_semaine`, les plafonds de remboursement dans `remboursements` et
  `remboursements_questions`, les questions en attente dans `questions`. **Tout est indexé par `userId`, donc tout se renouvelle
  avec lui** — y compris les plafonds anti-abus.
- **Désinstaller fait perdre les crédits achetés** : ils sont attachés à un identifiant que seule l'installation connaît.
- **Mesuré le 2026-10-06 en production** : 10 portefeuilles, **1 seul porte des crédits achetés (160)**, 1 seul un e-mail Stripe,
  203 analyses d'accueil restantes au total. La migration est petite ; elle n'en doit pas moins être exacte au crédit près.

## 3. Le modèle

Quatre collections neuves en production (`test`), aucune modifiée :

| collection | une ligne = | champs |
|---|---|---|
| `comptes` | un compte | `_id`, `email` (tel que saisi), `emailCle` (normalisé, **index unique**, §7), `motDePasse` (scrypt, sel par compte), `verifie`, `verifieLe`, `creeLe`, `offertesAccordeesLe` (null tant que les 25 n'ont pas été données), `solde: { accueil, achete }`, `stripeClient` |
| `installations` | une extension installée | `_id` (aléatoire, 16 octets), `jetonEmpreinte` (SHA-256 du jeton, jamais le jeton), `compteId` (null : non liée), `essais` (3 à la création), `libelle` (« Chrome · Windows »), `creeLe`, `lieeLe`, `revoqueeLe`, `userIdHerite` (le `userId` de la 1.0.x, §8) |
| `codes_liaison` | un code court | `codeEmpreinte`, `compteId`, `expire` (10 min, **index TTL**), `utiliseLe` |
| `mouvements` | un débit ou un crédit | `compteId` ou `installationId`, `le`, `surface` (`extension` · `scanner`), `delta`, `poche` (`essai` · `accueil` · `hebdo` · `achete`), `motif` (liste fermée de `CONTRAT-2.md`), `scanId`, `cleIdempotence` (**index unique** : un même événement ne s'écrit jamais deux fois) |

- **Le solde reste un compteur atomique** (`findOneAndUpdate` conditionnel, comme aujourd'hui dans `verifierAcces`) : c'est ce qui
  empêche deux analyses simultanées de consommer le même crédit. `mouvements` est le **journal** qui le justifie (l'historique de
  `/api/compte`, l'audit, la réconciliation nocturne : `somme(mouvements) = solde`, écart imprimé, jamais corrigé en silence).
- L'allocation hebdomadaire et les plafonds de remboursement changent de clé : **`compteId`** (ou `installationId` pour une
  installation non liée). Un plafond qui se renouvelle avec l'identité ne borne rien (`acces.js`, l'en-tête de `verifierAcces`).
- Une seule implémentation du chemin argent : `acces.js` reste le module, `test-acces.js` l'importe (la raison écrite en tête du
  fichier vaut toujours).

## 4. Les parcours

### 4.1 Une installation sans compte — 3 essais

1. Premier lancement de l'extension v2 : `POST /api/installation` `{ versionExtension, libelle }` → `{ installationId,
   jetonInstallation, solde }`. Le jeton (32 octets aléatoires, base64url) **n'est rendu qu'une fois** ; le serveur n'en garde que
   l'empreinte.
2. Chaque appel porte `Authorization: Bearer <jetonInstallation>`. **C'est lui, et plus le `x-jeton` public, qui autorise un débit.**
3. Les 3 essais se consomment ; ensuite `QUOTA` (429) avec `compte.lie: false` : l'extension propose de créer un compte.
4. Une installation non liée **n'a ni hebdomadaire ni paiement** (❓ §10.2 pour l'hebdomadaire).

### 4.2 Un compte — inscription, vérification, 25 offertes

1. Sur le site (`/fr/inscription`) : e-mail + mot de passe (**10 caractères au moins**, la règle de `compteContrat.ts`) + défi
   anti-robot (Cloudflare Turnstile, vérifié côté serveur). → `POST /api/compte/inscription`.
2. Un **lien de vérification** part par e-mail : jeton signé, à usage unique, valable 24 h. Le cliquer pose `verifie: true`.
3. **Les 25 offertes s'accordent à ce moment, une fois** : `updateOne({ _id, offertesAccordeesLe: null }, { $set:
   { offertesAccordeesLe: maintenant }, $inc: { 'solde.accueil': 25 } })`. Le filtre fait l'unicité : une seconde vérification ne
   donne rien. Et l'**index unique sur `emailCle`** empêche une seconde inscription de la même adresse sous une autre écriture (§7).
4. Un compte non vérifié peut se connecter, mais n'a pas encore ses 25 : l'erreur est `VERIFICATION` (403), proposée par le site
   (`scannerContrat.ts`) — sinon la page dirait « crédits épuisés » à quelqu'un qui n'en a jamais reçu.

### 4.3 La connexion sur le site — une session

- `POST /api/compte/connexion` → cookie de session **`HttpOnly; Secure; SameSite=Lax`**, 30 jours glissants, révocable
  (`POST /api/compte/deconnexion`). Le serveur est servi sous **`api.rat-market.fr`** (domaine personnalisé Render) : même site que
  `rat-market.fr`, le cookie passe avec `credentials: 'include'`, et le CORS n'autorise que `https://rat-market.fr`.
- Contre la falsification de requête : `SameSite=Lax`, **contrôle de l'en-tête `Origin`** sur toute requête qui écrit, et un en-tête
  maison obligatoire (`X-Rat-Market: 1`) qu'un formulaire tiers ne sait pas poser.

### 4.4 Lier l'extension — le code court

1. Le site, au compte connecté : `POST /api/compte/code` → `{ code: "A1B2C3", expire }` — 6 caractères `[A-Z0-9]`, **usage unique,
   10 minutes**, au plus 3 codes vivants par compte.
2. L'extension : `POST /api/compte/lier` `{ code }` avec son `Bearer` → `{ success, compte: { emailMasque }, jetonInstallation,
   solde }`. **Le jeton est renouvelé** à la liaison (l'ancien est révoqué) : un jeton volé avant la liaison ne débite jamais le compte.
   Erreurs : `CODE_INVALIDE` · `CODE_EXPIRE` · `DEJA_LIE`.
3. À la liaison, ce que l'installation portait **rejoint le compte** : crédits achetés **additionnés** ; essais restants **perdus**
   (le compte a mieux : ses 25) ; jamais deux dotations d'accueil (§8 pour les installations 1.0.x).
4. `POST /api/compte/delier` → l'installation redevient non liée, **sans nouvel essai** ; le solde reste au compte.
5. La page du compte liste les installations (`GET /api/compte` → `installations`) et peut en révoquer une (`DELETE
   /api/compte/installations/:id`).

### 4.5 Le scanner

La session du site, pas de jeton d'installation. Il débite **le même solde** que l'extension (`partage: true`). Une analyse sans
session → 401 `connexion-requise`.

### 4.6 Payer

`POST /api/creer-recharge` exige **un compte** : une session (site) ou une installation **liée** (extension). La session Stripe porte
`metadata: { compteId, scans }` (et `client_reference_id: compteId`) ; le webhook crédite `comptes.solde.achete`. Le chemin des
métadonnées `userId` reste en place pour les sessions anciennes, les remboursements et les litiges qui les visent.

## 5. L'ordre de débit — une seule fonction

| porteur | ordre |
|---|---|
| installation non liée | essais (3) → `QUOTA` |
| compte (installation liée, ou scanner) | accueil (25, une fois) → hebdomadaire (2/semaine, non cumulable, ❓ §10.2) → acheté → `QUOTA` |
| code maître (`CODE_ILLIMITE`) | rien n'est débité (inchangé) |

Le gratuit passe avant le payant (règle actuelle, inchangée) ; un remboursement rend **à la poche débitée** (`req.credit.poche`,
inchangé).

## 6. Ce que chaque issue coûte — la table que `facturation` dit à chaque réponse

| issue | débit | remboursé ? | `facturation.motif` |
|---|---|---|---|
| carte affirmée | 1 | non | `affirmee` |
| question posée | **réservé** à l'émission (`debite: 0`, `reserve: 1`) | — | `question` |
| · répondue par un candidat | la réserve devient le débit (`debite: 1`) | non | `question` |
| · « aucune », « je ne sais pas », sans réponse 24 h | — | **oui**, sous le plafond des questions (30/jour/compte) | `question` |
| lot de N cartes | `max(1, ceil(N / 10))` à l'identification ; ses questions comprises | si **aucune** carte n'est identifiée (`introuvable`) ou si **aucune** n'a de prix live lisible (`sans-prix`) | `lot` |
| aucun prix lisible (`lectureRatee` définitive) | — | **oui**, une fois par scan, sous le plafond de 30/jour | `sans-prix` |
| panne (lecture, base, source) | — | **oui**, sous le plafond des pannes (5/jour/compte) | `panne` |
| plafond de remboursement atteint | reste débité | non, et la cause s'écrit | `plafond-jour` |
| code maître | 0 | — | `code-maitre` |

- **Pourquoi réserver à l'émission plutôt que débiter à la réponse** : débiter à la réponse laisserait répondre avec un solde vide
  (les candidats déjà montrés, impossibles à payer). La réserve est ce que fait aujourd'hui `acces.js` (débit à l'émission, rendu à
  l'abandon) ; ce plan ne change que ce que la réponse **affiche** : `debite: 0, reserve: 1` — l'utilisateur lit « rien n'est débité
  sans réponse », comme l'extension le demande (§3.4).
- **Idempotence** : `/api/identifier/reponse` et `/api/retour-live` rejoués rendent le même résultat, sans second débit ni second
  remboursement (`mouvements.cleIdempotence` : `scanId|carte|reponse`, `scanId|sans-prix`).

## 7. La protection contre l'abus

| ouverture | parade |
|---|---|
| fabriquer des installations pour leurs 3 essais | `POST /api/installation` : **2 par IP et par jour**, et un **plafond global d'essais** par jour (500, réglable) au-delà duquel une installation neuve naît à 0 essai et se voit proposer un compte. Le coût d'un abus = 3 appels de lecture par IP et par jour. |
| fabriquer des comptes pour leurs 25 | **adresse vérifiée** (lien), **Turnstile** à l'inscription, **domaines jetables refusés** (liste tenue à jour), **`emailCle`** : minuscules ; chez Gmail, points et `+étiquette` ôtés (`a.b+x@gmail.com` = `ab@gmail.com`) ; index unique |
| deviner un code de liaison | 36⁶ ≈ 2,2 milliards ; **5 essais faux par installation et par heure**, 20 par IP ; code à usage unique, 10 min, empreinte seule en base |
| voler un jeton d'installation | empreinte seule en base ; renouvelé à la liaison ; révocable depuis la page du compte ; jamais journalisé |
| deviner un mot de passe | scrypt (sel par compte) ; **10 essais par compte et par heure**, puis attente ; le message ne dit jamais si l'adresse existe |
| se faire rembourser en boucle | plafonds **par compte** (et non plus par `userId`) : pannes 5/jour, questions et sans-prix 30/jour |
| saturer l'identification | limiteurs par IP existants (60/h sur les routes IA), plus un plafond **par compte** (120/h) |
| secrets dans les journaux | ni mot de passe, ni jeton, ni code, ni lien de vérification n'est journalisé ; les e-mails n'apparaissent que masqués (`v•••@exemple.fr`) |

## 8. La migration des soldes actuels — au crédit près

1. **Rien ne bouge tant que la v2 n'est pas là** : la 1.0.x (`x-jeton` + `userId`) continue de débiter `credits` comme aujourd'hui.
   Le contrat 2 est additif (`CONTRAT-2.md`, règle 1).
2. **Premier appel d'une v2 qui porte encore son ancien `userId`** : `POST /api/installation { userIdHerite }`. Le serveur crée
   l'installation, y reporte le portefeuille (`credits` de ce `userId`) : achetés → `achete` de l'installation, accueil restant →
   `essais` (au plus 25), et marque le document `credits` **`migreVers: installationId`**. Dès lors, l'ancien `userId` ne débite plus
   rien sans le jeton (la 1.0.x de la même machine est remplacée par la v2).
3. **À la liaison** : achetés additionnés au compte ; l'accueil hérité n'est **pas** ajouté aux 25 du compte (jamais deux
   dotations) — le compte garde `max(25 restants, accueil hérité)` (❓ §10.4).
4. **Le seul portefeuille à crédits achetés (160)** : il sera suivi nommément jusqu'à sa liaison ; si son détenteur crée un compte
   avec l'**adresse de son paiement Stripe** et la vérifie, le serveur peut proposer de rattacher ces 160 crédits même sans
   l'installation (❓ §10.5 — c'est une preuve par l'adresse, pas par l'installation).
5. **Contrôle** : avant et après la migration, `somme(achetés)` sur `credits` + `installations` + `comptes` **ne baisse jamais** ;
   un écart arrête la migration (même principe que la garde de lot de la base `cartes`).

## 9. L'ordre de construction et les preuves

Sur la branche `comptes`, jamais sur `main` ; `test_scratch` pour tous les essais ; le verrou des routes (`verrou-charges.js
--base=test`, puis `verrou-avant-push.js --base=test`) avant tout merge.

1. `acces.js` : le porteur (compte ou installation) remplace `userId` ; les poches, l'ordre, les plafonds par porteur ;
   `mouvements` et son index d'idempotence. **Banc** : `test-acces.js` étendu (essais, 25 une fois, liaison, plafonds par
   compte, rejeu idempotent).
2. Les routes de compte (§4) et leur banc (inscription, vérification, connexion, code, liaison, déliaison, révocation).
3. Le contrat 2 sur `/api/identifier` (`CONTRAT-2.md`), `/api/identifier/reponse`, les ajouts à `/api/retour-live`, le scanner.
4. Le taux du jour (§10.6) : une lecture par jour de la source retenue, gardée en base avec sa date ; `versEUR: null` si la lecture
   du jour manque (l'extension n'affiche alors aucun verdict, c'est son contrat).
5. Stripe en mode test : une recharge de compte, un remboursement, un litige — les trois chemins existants rejoués avec `compteId`.
6. La migration (§8) rejouée sur une copie des 10 portefeuilles dans `test_scratch`, puis le feu vert.

**Critères de fin** (ceux de l'extension, §8 de sa demande, plus) : une installation non liée ne reçoit que 3 essais ; un compte
vérifié reçoit 25 une fois, quel que soit le nombre d'installations liées ou de vérifications cliquées ; le même e-mail sous une
autre écriture est refusé ; aucun crédit acheté ne disparaît à la migration ; le `x-jeton` public seul ne débite plus aucun compte.

## 10. Ce qui reste à trancher par l'éditeur

1. ❓ **« Compte vérifié » = adresse confirmée par lien + Turnstile à l'inscription.** Suffisant ? (Proposé : oui.)
2. ❓ **L'allocation hebdomadaire (2/semaine)** : réservée aux comptes vérifiés ? (Proposé : oui — par installation, elle se fabrique.)
3. ❓ **`cartesVues` compte-t-il les cartes introuvables d'un lot ?** (Lu par l'extension : oui ; proposé : oui.)
4. ❓ **Un utilisateur 1.0.x qui avait encore des analyses d'accueil** : le compte garde `max(25, restant hérité)` ? (Proposé : oui.)
5. ❓ **Rattacher des crédits achetés par l'adresse Stripe**, sans l'installation (un seul cas aujourd'hui, 160 crédits) ?
6. ❓ **La source du taux du jour.** Proposé : les **taux de référence de la BCE** (publics, une lecture par jour ouvré ; le week-end,
   le dernier taux publié, avec sa date). Une source externe neuve : sa cadence se pose AVANT la première requête (§38).
7. ✅ **Tranché (rapporté par le site le 2026-10-06 après-midi) : voie (a)** — le scanner affiche le guide (tendance, prix le plus bas,
   moyenne 30 jours), daté ; jamais un prix par état. Ce qui suit était la question posée. **Le prix par état du scanner (`prixParEtat`)** : le serveur **n'a pas** de grille par état. Le guide quotidien de Cardmarket
   donne la tendance, des moyennes et le prix le plus bas — sans état ; et le serveur ne fait aucune requête à Cardmarket. Deux voies :
   (a) le scanner affiche la **tendance et le prix le plus bas du guide, datés**, sans grille par état ; (b) la grille par état vient
   du navigateur de l'utilisateur, comme dans l'extension — impossible depuis une page web. **Proposé : (a)**, et le contrat le dit
   (`prixParEtat: null`, `prixGuide` rempli).
8. ❓ **La promesse « Aucun compte à créer »** de l'accueil du site devient fausse : à reformuler (« 3 analyses d'essai sans compte »).
9. ❓ **Mot de passe seul, ou aussi un lien magique ?** Proposé : le mot de passe seul (les pages du site sont écrites pour lui) ; un lien
   magique double la surface d'attaque par e-mail pour un gain faible.
10. ❓ **Le service d'envoi des e-mails** (vérification, mot de passe oublié) : il entre dans la politique de confidentialité — à choisir
    par l'éditeur (un service transactionnel hébergé dans l'UE).
11. ❓ **Durées de conservation** (compte inactif, historique des analyses, journaux) : à fixer par l'éditeur, la politique de
    confidentialité les dira. Proposé : historique 24 mois, compte sans connexion 36 mois puis suppression annoncée.
12. ❓ **Un compte supprimé qui portait des crédits ACHETÉS** : remboursables, perdus, ou la suppression les refuse tant qu'il en reste ?
    C'est une question de conditions de vente, pas de code.

## 11. Recommandations de l'agent du serveur, une ligne par question (2026-10-06, soir) — à valider ou corriger

| # | recommandation |
|---|---|
| 1 | **Oui** : lien de vérification (24 h, usage unique) + Turnstile à l'inscription, plus l'index unique `emailCle` et le refus des domaines jetables (§7). |
| 2 | **Oui** : l'hebdomadaire réservé aux comptes vérifiés ; une installation non liée n'a que ses 3 essais. |
| 3 | **Oui** : `cartesVues` compte les introuvables (le travail de lecture a eu lieu), et le lot entièrement introuvable reste remboursé (§6). |
| 4 | **Oui** : `max(25, accueil hérité)`, une seule dotation, jamais une somme. |
| 5 | **Oui, une fois** : rattacher les 160 crédits si le compte est créé ET vérifié avec l'adresse exacte du paiement Stripe. Le mouvement `migration-stripe` est journalisé ; sans cette adresse, rien ne se rattache. |
| 6 | **Les taux de référence de la BCE** (`eurofxref-daily.xml`) : une lecture par jour ouvré après 16 h 00 (heure de Paris), gardée en base avec sa date ; le week-end et les jours fériés, le dernier taux publié, daté. |
| 7 | ✅ tranché (voie a). |
| 8 | **Reformuler** : « 3 analyses d'essai sans compte, 25 offertes à l'inscription ». |
| 9 | **Le mot de passe seul**, avec la réinitialisation par lien (24 h, usage unique) ; pas de lien magique. |
| 10 | **Brevo** (société française, données dans l'UE, accord de traitement RGPD) : son palier gratuit couvre les e-mails de vérification et de mot de passe oublié ; Scaleway TEM en second choix. |
| 11 | **Historique des analyses 24 mois** ; compte sans connexion 36 mois, puis suppression annoncée par e-mail 30 jours avant ; journaux techniques 12 mois. La description d'annonce que l'extension envoie n'est **pas conservée**, sauf les lignes versées au banc (90 jours, puis effacées). |
| 12 | **La suppression est refusée tant qu'il reste des crédits achetés**, sauf si l'utilisateur choisit l'une de deux sorties : le remboursement Stripe des crédits non consommés, ou une renonciation cochée explicitement. Les crédits offerts sont perdus sans question. |

## 12. Les demandes des deux autres agents, intégrées (2026-10-06, soir) — rien en production

**L'extension** (`extension v2/DEMANDE-SERVEUR-EXTENSION.md` §12-§13, lus ; `ETAT-EXTENSION.md`, ses 14 points) :
- **Jeton par installation** et **3 analyses d'essai par installation** : c'est déjà le §4.1 (`POST /api/installation`, jeton rendu une
  fois, empreinte seule en base). `libelle` (« Chrome · Windows ») est **libre** : 60 caractères au plus, affiché sur la page du compte,
  jamais interprété. La reprise par `userIdHerite` est **unique** (`migreVers`), refusée pour un `userId` déjà migré, et le `userId` ne
  se journalise qu'en empreinte. Pour le seul portefeuille à crédits achetés (160), la reprise exige en plus la preuve par l'adresse
  Stripe (§10.5), comme l'extension le recommande (§13.3).
- **Le code maître est supprimé, remplacé par un rôle administrateur** sur le compte de l'éditeur : `comptes.role: 'administrateur'`,
  posé à la main en base, jamais par une route. Ses analyses ne débitent rien et s'écrivent dans `mouvements` (`delta: 0`) ; la réponse
  porte `facturation: { debite: 0, motif: "administrateur" }`, qui remplace `code-maitre` dans la liste fermée de `CONTRAT-2.md`. Le
  chemin `CODE_ILLIMITE` se retire à la bascule (aucun utilisateur régulier de la 1.0.x).
- **CORS, sans permission nouvelle dans le manifeste** : `api.rat-market.fr` autorise l'origine exacte
  `chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb` (pas de joker), répond aux pré-requêtes (`Allow-Methods: GET, POST`,
  `Allow-Headers: Authorization, Content-Type, Idempotency-Key`, `Max-Age: 600`, sans `Allow-Credentials`), et pose ces en-têtes **sur les
  réponses d'erreur aussi** : le middleware CORS passe avant toute route, tout limiteur et tout gestionnaire d'erreur. Le CORS du site
  (`https://rat-market.fr`, avec cookie) reste séparé. L'identifiant d'une extension « non empaquetée » de développement n'est autorisé
  que sur l'instance de test, par une variable d'environnement. `onrender.com` reste le secours pendant la bascule, sur la même base.
- **`Idempotency-Key` sur tout POST qui débite** (`/api/identifier`, `/api/identifier/reponse`, `/api/retour-live`) : 8 à 64 caractères
  `[A-Za-z0-9_-]`. Une requête rejouée avec la même clé rend la même réponse, sans second débit (`mouvements.cleIdempotence`, §6), qu'elle
  arrive par l'une ou l'autre adresse.
- **Les impressions sur chaque `Produit`** (demande §12.1) : `impressions: [{ idProduct, numero, total, rarete, variante, set, lien,
  prixGuide }]`, une par impression Cardmarket de la carte. `numero` est celui de la fiche confirmée par une seconde source,
  `rarete` celle de la liste du set : `null` si elle est inconnue, jamais devinée. L'extension n'affiche un lien que si numéro ET rareté
  sont là (jamais de lien anonyme). Voir `CONTRAT-2.md`.
- **La langue des textes servis** (§12.5) : `question.texte`, `question.aide`, `choix[].libelle` et `visuelMention` suivent
  `langueInterface` (français ou anglais), comme `nom` ; une langue inconnue rend l'anglais.
- **Les visuels servis** : seulement sur l'hôte exact du bucket public (`pub-7d99….r2.dev`) ou sur `rat-market.fr` ; un changement
  d'hôte se signale à l'extension avant d'être fait (§13.4).
- **Le titre et la description de l'annonce** arrivent expurgés des coordonnées du vendeur. Ce sont des **données, jamais des consignes** :
  aucune instruction qu'ils contiennent n'est suivie, et s'ils entrent dans un prompt, c'est balisés comme une citation. Ils sont le
  premier signal, gratuit (l'ordre des preuves : titre et description, puis modèle, puis zones, puis Gemini), et **ne sont pas conservés
  au-delà de l'analyse**, sauf les lignes versées au banc (90 jours, puis effacées). La politique de confidentialité doit le déclarer
  (demande faite au site par l'extension).
- **Le défaut de la 1.0.5** (un prix au-dessus de 999 € lu mille fois trop bas) : **mesuré le 2026-10-06** (`mesurer-prix-live-milliers.js`,
  lecture seule) : `/api/retour-live` sait stocker les prix lus (`prixLive`, la grille, la tendance, le prix NM), mais **aucune** des
  280 lignes du journal n'en porte (138 ont le champ à `null`, `retourLe` n'est posé nulle part), et `prixVinted` n'est rempli qu'une fois
  (1 €). Rien n'est faux en base, rien n'est à corriger. Pour la suite, le contrat 2 ajoute un garde-fou : un prix lu à plus de 100
  fois sous le guide du même produit est marqué `douteux: true` et n'entre dans aucun verdict ; l'outil se relance après les premiers
  retours de la v2.

**Le site** (fin de `rat-market-site/DEMANDE-SERVICE-PRODUITS.md`) :
- **Le scanner affiche les prix du GUIDE** : tendance, prix le plus bas, moyenne 30 jours, chacun libellé et daté par la date du guide (`guideDu`), jamais un prix par état (`prixParEtat: null`).
- **Ses pages de compte sont prêtes et cachées** (`/fr/connexion`, `/fr/inscription`, `/fr/compte`, le code de liaison) : elles parleront aux routes du §4 dès leur mise en service, et pas avant.
- **`/fr/p/<idProduct>` est prêt pour l'extension** : `Produit.lien` du contrat 2 pointe vers cette page quand le produit y est servi, sinon vers Cardmarket.
