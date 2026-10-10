# AUDIT DE SÉCURITE DE LA BRANCHE API v2 (lot B8)

Date : 2026-10-10. Base : `011a638` (tête d'api-v2 après la fusion de B7b), branche `v2-b8`. Auditeur : un relecteur qui n'a écrit aucun lot de la branche.
Périmètre des correctifs : `v2/` seulement. Aucune base réelle, aucun R2, aucun réseau sortant : tous les bancs tournent sur la base EN MÉMOIRE (INT2), la chaîne héritée,
Turnstile et le courrier sont fabriqués. Aucun secret n'est écrit dans ce document : seuls des NOMS de variables y figurent.

**Verdict : aucun défaut Critique ni Élevé ouvert.** 8 défauts corrigés (6 Moyens, 2 Faibles), 4 Moyens ouverts (§5, chacun avec son coût), 4 décisions du testeur (§7),
dettes assumées (§6). Un constat Élevé CONDITIONNEL sur une variable héritée (`JETON_API`, §4) ne peut pas être levé ici : il demande une lecture de l'environnement de production.

## 1. Skills joués

| skill (ordre du plan) | joué ? | résultat |
|---|---|---|
| `insecure-defaults:audit` | joué À LA MAIN | l'outil `Workflow` qui pilote le pipeline du skill n'existe pas dans cette session ; le corpus (`references/*.md`, 6 familles) est présent et a été suivi à la main : table des défauts (§4), fail-open, secrets de repli, cookies, CORS, débug. Écart déclaré : pas de balayage parallèle ni de vérificateur réfutant. |
| `sharp-edges:sharp-edges` | joué (lecture) | §3 bis |
| `static-analysis:semgrep` | non joué, absent | `semgrep` n'est pas installé ; ses rulesets sont de toute façon à télécharger (réseau) |
| `static-analysis:codeql` | non joué, absent | `codeql` n'est pas installé ; base et paquets à télécharger (réseau) |
| `differential-review:differential-review` | joué (manuel, ciblé) | §8 : `git diff 63cce6d..HEAD` sur `index.js` et `acces.js`, rayon d'action compté |
| `supply-chain-risk-auditor:supply-chain-risk-auditor` | non joué, réseau | `collect.py` interroge npm, OSV et GitHub. Constat LOCAL seulement : voir §9 |
| `superpowers:test-driven-development`, `superpowers:verification-before-completion` | invoqués | chaque défaut a été vu ROUGE avant son correctif (fichiers de sortie du banc conservés dans le scratchpad), puis vert |

## 2. Le banc d'abus (`v2/test/test-abus-routes.js`, 40 vérifications, 0 échec)

- Les routes sont dérivées de `router.stack` de l'assembleur réel : 23 routes montées, dont **22 qui écrivent** (19 POST et 3 DELETE ; la liste est imprimée par le banc) et 1 en lecture (`GET /api/compte`). Le banc ÉCHOUE si une route qui écrit n'a pas de cible déclarée, ou si une cible déclarée n'est plus montée (aucun PUT/PATCH n'existe aujourd'hui ; « Ma collection » devra recevoir sa cible, le banc le lui rappellera).
- **22 routes × 5 charges (a-e) = 110 cellules : 91 jouées, 19 « sans objet » déclarées avec leur raison** (par exemple `POST /api/solde` n'a aucun champ texte ; `DELETE /api/compte` n'a aucun identifiant de ressource dans le corps). 299 envois d'injection pour (a)(b)(c), plus ceux de (d)(e).
- (a) chaque champ texte du corps remplacé par `{"$ne":""}`, `{"$gt":""}`, `{"$where":"1"}`, un tableau, un nombre, `null` ; (b) `{"__proto__":{"role":"administrateur"},"constructor":{"prototype":{"x":1}}}` seul puis ajouté à un corps valide (envoyé en TEXTE : un littéral JS changerait le prototype de l'objet au lieu de créer la clé) ; (c) un corps JSON de 5 Mo et, pour le scanner, un formulaire dont l'image fait 5 Mo d'octets quelconques ; (d) un `Idempotency-Key` d'un autre porteur, joué par A puis par B (5 routes qui lisent la clé) ou envoyé à une route qui ne la lit pas (aucun claim, aucun rejeu) ; (e) l'identifiant d'une ressource d'autrui (scan, question, installation, code de liaison, jeton de consentement, héritage 1.0.x).
- Verdicts vérifiés sur CHAQUE réponse : jamais 5xx ; jamais de succès sur (a)(b)(c) sauf tolérance NOMMÉE (liste ci-dessous) ; compte des documents de TOUTES les collections avant/après (seul `limites`, les compteurs de débit, est exclu) ; `Object.prototype` intact ; aucun corps d'erreur ne contient une pile, un chemin, un nom de collection ni une erreur de pilote ; (d)(e) : jamais les données d'autrui, la ressource de la victime reste intacte (comparaison d'un instantané).
- Un 200 dont le corps dit `success: false` (codes `IMAGE` et `IA` du contrat) est un refus métier, pas un succès.
- **Tolérances nommées** (acceptations qui ne stockent ni n'interrogent la valeur) : `identifier.langueInterface` (contrat : « toute autre valeur rend l'anglais »), `identifier.title` et `identifier.description` à `null` (le serveur est plus tolérant que le contrat, qui les type `string`), `vintedEtat`/`vintedUrl` à `null` (admis par le contrat), `installation.libelle` et `userIdHerite` de type non-texte (libellé par défaut « Navigateur » : comportement voulu et épinglé par `test-installations.js`), `mot-de-passe-oublie.email` et `renvoyer-verification.email` de type tableau/nombre/null (202 identique par construction, anti-énumération, aucun traitement). Les OBJETS d'opérateur sont refusés partout. Aucun document de la base ne porte de clé `$ne`/`$gt`/`$where` à la fin du banc.
- **Étape 2 (temps, énumération)** : connexion, adresse inconnue 89,9 ms / mot de passe faux 94,1 ms sur 20 essais chacun (écart 4,2 ms < 50) ; inscription (adresse neuve / déjà prise), mot de passe oublié (connue / inconnue) et renvoi de vérification (non vérifié / vérifié / inconnu) : 202 et mêmes OCTETS (corps et en-têtes, hors `Date`).
- **Étape 3 (secrets)** : 945 secrets fabriqués par le banc (jetons d'installation, jetons de session, codes de liaison, `Idempotency-Key`, e-mails, IP, jeton de consentement) cherchés dans les 71 lignes de journal captées : 0 trouvé ; le détecteur est vérifié sur un secret planté. Plus : une règle STATIQUE (aucun `console.*` de `v2/`, hors outils en ligne de commande et message de configuration, n'imprime `e.message`) sur 69 fichiers, et le chemin d'erreur `EN_RECONCILIATION` du ledger joué pour de bon.
- **Étape 4** : 16 URL d'images hostiles (`http://127.0.0.1`, `https://vinted.net@evil.example`, `https://x.vinted.net.evil.example`, `https://[::1]`, métadonnées `169.254.169.254`, `file:`, `data:`, `images1.vinted.net@evil…`, `\@`, etc.) → 400 sans écriture, contrôle positif 200 ; `expurger` et `preparerAnnonce` sur 16 entrées pathologiques de 1 Mo → toutes sous 500 ms ; client Turnstile : un seul appel, `https://challenges.cloudflare.com`, secret dans le corps POST, redirections refusées, échéance, lève sans secret.
- **Étape 5 (parqués B7b, M-5)** : l'effacement du banc est joué en 200 avec `supprimees: 2` (deux lignes réelles, deux objets du stockage factice supprimés) et la correction en 200 avec le banc ACTIF (la ligne passe à `source: correction`), les deux réponses validées contre le schéma publié.

## 3. Défauts trouvés et corrigés

Gravités : Critique/Élevé (argent ou données d'autrui exposés, exploitable tel quel), Moyen (exploitable sous condition ou défense en profondeur exigée), Faible. **Aucun Critique, aucun Élevé.**
Chaque ligne a été vue ROUGE : le banc a d'abord tourné sur le code de la base (fichiers `abus-2` à `abus-7` du scratchpad), puis vert après le correctif.

| # | gravité | scénario concret | fichier:ligne | correctif | test vu rouge |
|---|---|---|---|---|---|
| D1 | Moyen | `POST /api/compte/code` avec `{"__proto__":{"role":"administrateur"},…}` rendait 200 ET écrivait un code de liaison ; `POST /api/identifier` avec le même ajout rendait 200 et débitait ; `mot-de-passe-oublie` acceptait `{"$ne":""}` en 202. Aucun fusionneur d'objets ni filtre Mongo n'est atteint aujourd'hui (les champs sont typés avant usage), mais la clé reste en propre dans `req.body` : un fusionneur ou un filtre futur la prendrait pour une consigne | `v2/index.js:41-58` (`cleInterdite`), `:93` (appel dans la garde de l'assembleur, APRÈS les aiguilleurs : la route héritée d'une requête 1.0.x n'est pas touchée) | refus 400 `ENTREE` / `cle-interdite` de tout corps portant `__proto__`, `constructor`, `prototype` ou une clé en `$`, de plus de 8 niveaux ou de 5 000 nœuds ; posé UNE fois dans l'assembleur : aucun lot ne peut l'oublier | (b) : 22 écarts rouges ; (a) opérateurs : 24 rouges ; 0 après |
| D2 | Faible | `vintedEtat: {"$ne":""}` (ou tableau, nombre) donnait 200 et un débit, la valeur étant jetée en silence | `v2/identifier/routes.js:41` | 400 `ENTREE` / `vinted-etat` si non-chaîne et non-null | 10 écarts rouges |
| D3 | Moyen | `imageUrls: ["https://images1.vinted.net\\@evil.example/x.jpg"]` rendait 200 : l'analyseur WHATWG lit `\` comme `/` (hôte autorisé), d'autres analyseurs le lisent comme la fin d'un identifiant (hôte `evil.example`) ; l'URL part chez le fournisseur du modèle | `v2/identifier/routes.js:27-33` (`urlAmbigue`), `:60` | URL d'un hôte autorisé refusée si elle porte `\`, espace, caractère de contrôle, identifiant, mot de passe ou port (détail `image-url`) ; un hôte hostile garde `image-hote` (banc hérité `test-identifier-entree.js` inchangé) | step 4 : 1/16 URL rouge |
| D4 | Moyen | une panne de Cloudflare suspendait chaque requête d'inscription jusqu'à ~5 min (aucune échéance) ; une redirection 307 aurait emmené le secret POST ailleurs | `v2/comptes/turnstile.js:11` | `redirect: 'error'` et `AbortSignal.timeout(5000)` (la panne devient `indispo` → 503, comportement existant) | 2 rouges |
| D5 | Moyen | sans `BREVO_API_KEY`, la production monte le pilote de courrier MÉMOIRE (`comptes/monter.js:12`) dont le tableau grossissait à chaque inscription ou oubli : adresses et liens à jeton gardés sans fin (fuite de mémoire atteignable de l'extérieur, jusqu'au redémarrage) | `v2/comptes/courrier.js:5-12` | tableau borné à 1 000 entrées (les plus anciennes partent) | 5 000 envois → 5 000 entrées (rouge) |
| D6 | Moyen | le ledger journalisait `clé scan\|installation:<id>\|<Idempotency-Key du client>` en clair (rejeu refusé, écriture du mouvement en erreur, remboursement de ligne) et, en six endroits, le MESSAGE d'une erreur de pilote (une E11000 cite la clé) | `v2/argent/ledger.js:10-11` (`cleJournal`, `codeErr`) et 11 sites ; `argent/pont-acces.js:20`, `argent/questions.js:133`, `transport/limites.js:26`, `porteur.js:37`, `installations/liaison.js:48` | empreinte SHA-256 (16 hex) au lieu de la clé, code ou nom d'erreur au lieu du message ; règle statique « jamais `e.message` » dans le banc | secret planté retrouvé dans le journal (rouge) ; règle statique rouge |
| D7 | Moyen | `V2_COOKIE_SECURE=0` était admis sur une production allumée : cookie de session sans `Secure` (même famille que `V2_TURNSTILE=off`, déjà refusé hors banc) | `v2/config.js:36-38` | configuration invalide hors `MONGODB_BASE=test_scratch` | step 6 rouge |
| D8 | Faible | `test-scanner-multipart.js` (« client lent, vrai serveur ») recopiait la fermeture de socket sans le délai de 50 ms de la production et échouait 1 fois sur 4 : un banc instable, le serveur n'était pas en cause | `v2/scanner/routes.js:235` (export de `repondreEtFermer`), `v2/test/test-scanner-multipart.js:219-232` | le banc appelle la fonction de production (§21 bis) | `TypeError: repondreEtFermer is not a function` avant l'export ; **20 exécutions sur 20 vertes** après |

Preuve que chaque garde sait dire NON : le banc a été exécuté sur le code de la base (rouge, fichiers `abus-2` : 63 écarts, `abus-4-rouge`, `abus-6-rouge`, `abus-7-rouge`) puis sur le code corrigé (vert) ; pour le ledger et les `e.message`, les six fichiers touchés ont été remis à l'état de la base par `git stash` (aucune retouche de la garde elle-même), le banc a échoué, puis le `git stash pop` a rendu la version corrigée.
Le banc hérité `test-comptes-temps.js` et `test-installations.js` ont d'abord échoué sous deux correctifs trop larges (limite par adresse, typage strict de `libelle`) : les correctifs ont été RETIRÉS ou réduits (D3 est jugé après la liste blanche d'hôtes), aucun banc hérité n'a été modifié pour passer, hormis `test-scanner-multipart.js` (D8, autorisé par le brief : c'est sa propre copie qui échoue).

### 3 bis. Arêtes vives (sharp-edges)

| objet | constat | verdict |
|---|---|---|
| `Idempotency-Key` | la clé est liée à `porteur\|route\|valeur` (jamais partagée), forme `[A-Za-z0-9_-]{8,64}`, empreinte du corps ; une clé mal formée sur le scanner est REMPLACÉE par une clé fabriquée (un POST = un scan) ; une réponse `success:false` en 200 (codes `IMAGE`, `IA`) est rejouée figée 24 h | prouvé par (d) ; la sémantique « même clé, même réponse, une panne se retente avec une nouvelle clé » est un ruling (B1b.3) à écrire dans la doc OpenAPI |
| `V2_ORDRE_POCHES` | la validation refuse une poche inconnue et un doublon, mais accepte un SOUS-ENSEMBLE : `essai` seul rendrait `QUOTA` à qui a des crédits achetés | **Moyen ouvert O2** |
| `V2_TURNSTILE` | défaut `on`, vide = `on`, une faute de frappe lève (v2 → 503), `off` refusé hors `test_scratch` | ferme |
| `rembourser(…, {sansPlafond})` | une option booléenne qui contourne le plafond du jour ; un seul appelant (`identifier/lot.js:105`, lot trop grand, borné par le débit initial) ; `jourDe` (date fournie par l'appelant) choisit le compteur du plafond | dette assumée : appelants internes, aucun champ de requête n'y mène |
| `entier()` de la configuration | aucun plafond HAUT (`V2_ACCUEIL=1000000` serait accepté) ; `V2_PLAFOND_PANNES=0` refuse tout remboursement de panne | Faible : variables d'opérateur, pas de requête |
| `MONGODB_BASE=test_scratch` | ce NOM seul ouvre quatre assouplissements (secret d'empreinte constant écrit dans `config.js:30`, Turnstile `off`, cookie sans `Secure`, origine d'extension de développement) ; `test_scratch` existe aussi sur la grappe de production (commentaire de `v2/db.js:23`) | Faible : à ne JAMAIS poser sur Render ; noté au déploiement |
| aiguilleurs | `RM_API_V2` n'allume que sur `'1'` strict ; un prédicat qui lève, rend une Promise ou un non-booléen laisse répondre la route héritée | ferme (par A0) |

## 4. Table des valeurs par défaut (B8.2) — chaque défaut doit FERMER

Source de la liste : `v2/config.js` (les 30 variables sont DÉRIVÉES du fichier par le banc (étape 6, première vérification) : une variable ajoutée sans ligne dans la table fait échouer le banc), plus tout `process.env` / `env.` sous `v2/` et ce que `index.js` et `acces.js` lisent pour la v2.
« Mal formée » : ce que fait le banc quand la valeur est `abc`, `0` (là où le minimum est 1), `2` (booléens : seuls `0` et `1`), etc.

| variable | défaut | si elle manque | si elle est mal formée | ferme ? |
|---|---|---|---|---|
| `RM_API_V2` | éteinte | v2 jamais chargée (`require('./v2')` n'a pas lieu) | tout sauf `'1'` = éteinte | oui : retombe sur le serveur d'avant |
| `MONGODB_BASE` | aucune | aucun assouplissement de banc ; secret d'empreinte exigé si v2 allumée | blanc = aucune | oui |
| `V2_SECRET_EMPREINTE` | aucun | v2 allumée sans secret = configuration invalide (503) hors `test_scratch` | moins de 16 caractères = invalide | oui |
| `V2_TURNSTILE` | `on` | `on` | autre que `on`/`off` = invalide ; `off` + production = invalide | oui |
| `V2_COOKIE_SECURE` | `1` | cookie `Secure` | autre que `0`/`1` = invalide ; `0` + production = invalide (D7) | oui |
| `V2_DESCRIPTION_AU_MODELE` | `0` | rien de l'annonce n'est envoyé au modèle | invalide | oui |
| `V2_DESCRIPTION_CONSERVEE` | `1` (90 jours) | conservation 90 jours | invalide | oui (purge quotidienne) |
| `V2_REGLE_G` | `0` | la chaîne héritée décide | invalide | oui |
| `V2_ESSAIS` / `V2_ACCUEIL` / `V2_HEBDO` / `V2_ABO_MENSUEL` | 3 / 25 / 2 / 100 | défauts | invalide (non entier, négatif) | oui ; `0` = aucune dotation |
| `V2_PLAFOND_PANNES` / `V2_PLAFOND_QUESTIONS` | 5 / 30 | défauts | invalide | oui ; `0` refuse tout remboursement (le client paie) |
| `V2_LECTURE_LIVE_MAX` | 5 | 5 | invalide | oui |
| `V2_ESSAIS_GLOBAUX_JOUR` | 500 | 500 (au-delà, une installation neuve naît avec 0 essai) | invalide | oui |
| `V2_INSCRIPTION_IP_HEURE`, `V2_OUBLI_IP_HEURE`, `V2_REINIT_IP_HEURE` | 10 | 10 par IP et par heure | `0` ou non entier = invalide (minimum 1) | oui |
| `V2_VERIFICATION_IP_HEURE`, `V2_CONNEXION_IP_HEURE` | 30 | 30 | idem | oui |
| `V2_SUPPRESSION_COMPTE_HEURE`, `V2_RENVOI_COMPTE_HEURE` | 10 / 3 | défauts | idem | oui |
| `V2_EMPREINTE_JOURS` | 365 | 365 | minimum 1 | oui |
| `V2_URL_VERIFICATION`, `V2_URL_REINIT` | `https://rat-market.fr/fr/…` | défauts | tout sauf `https://…` = invalide | oui (une URL https d'un autre hôte est admise : variable d'opérateur) |
| `V2_ORDRE_POCHES` | `essai,accueil,hebdo,abonnement,achete` | défaut | poche inconnue ou doublon = invalide ; **sous-ensemble admis** | partiel : voir O2 |
| `V2_MARCHES` | 16 marchés Vinted | défaut | texte libre : un marché mal écrit = aucun marché réel (422 pour tous) | oui (tout refuse) |
| `V2_VERSION_MIN_EXTENSION` | `2.0.0` | `2.0.0` | illisible = 400 pour tous | oui |
| `V2_ORIGINE_EXTENSION_DEV` | aucune | ignorée | honorée SEULEMENT sur `test_scratch`, ignorée en production même posée | oui |
| `TURNSTILE_SECRET` | aucun | le pilote réel lève `turnstile-non-configure` : l'inscription répond 503, jamais « accepté » | — | oui |
| `BREVO_API_KEY` | aucune | pilote MÉMOIRE : aucun courrier ne part, borné à 1 000 entrées (D5) ; avec la clé et sans pilote écrit : 503 | — | oui |
| `V2_BANC_SEL`, `V2_BANC_BUCKET` | aucun | banc réel désactivé pour le processus, aucune écriture, dit une fois (`routes.js:36-48`, banc `test-banc-ecriture`) ; le bucket du banc ne peut pas être celui de `R2_BUCKET_IMAGES/BRUT/BANC` | — | oui |
| `BANC_ISOLE` | harnais de test seulement | pas de contrôle d'hôte (voulu en production, `db.js:36`) | — | sans objet en production |
| `CODE_ILLIMITE` | hérité (`acces.js`) | code maître inactif | — | oui. Lectures à retirer à l'allumage (mémo du testeur), NON retirées ici : `acces.js:26` (commentaire), `:31` (lecture), `:180` (comparaison), `:189-190` (lecture du corps) ; tests `test-acces.js:29,183-204`, `v2/test/test-acces-delegation.js:3`, `v2/test/test-argent-pont.js:3` ; `README.md:20`. Aucune lecture dans `v2/` de production : la v2 ne consulte jamais le code maître. La comparaison `===` du code maître n'est pas à temps constant (hérité, Faible) |
| `JETON_API` | hérité (`index.js:259-268`) | **`verifierJeton` laisse TOUT passer** (avertissement console) : les routes héritées sont ouvertes | — | **NON : défaut qui OUVRE.** Hérité, hors du diff de la v2 (la v2 s'authentifie par jeton d'installation ou session et n'en dépend pas) ; le nom est présent dans le `.env` local ; la valeur sur Render n'est pas lisible ici (le MCP Render ne lit aucune variable). **Constat Élevé conditionnel : le testeur doit confirmer que `JETON_API` est posée sur Render.** Non corrigé (changer ce défaut changerait la production quand la v2 est éteinte) |

## 5. Défauts Moyens OUVERTS (avec leur coût)

| # | scénario | coût du correctif | pourquoi pas ici |
|---|---|---|---|
| O1 | `POST /api/compte/mot-de-passe-oublie` n'a aucune limite par ADRESSE (le renvoi de vérification en a une, 3/h). 8 demandes depuis 8 IP : 8 courriers de réinitialisation envoyés à la même victime (mesuré, épinglé par le banc). Pas de Turnstile sur cette route. Harcèlement, réputation de l'expéditeur, quota du fournisseur | 3 lignes dans `demanderReinit` (`L.consommer('reinit:'+empreinte, {max: renvoiParCompteHeure…})`, patron de `renvoyerVerification`) + adapter `test-comptes-temps.js`, hérité, qui envoie 21 demandes pour UNE adresse et attend 21 courriers | le correctif a été écrit, a fait échouer ce banc hérité, et a été retiré : on ne modifie pas un banc hérité pour le faire passer. Le banc d'abus échouera le jour où la limite existera (il épingle `8`) |
| O2 | `V2_ORDRE_POCHES=essai` (faute de configuration) rend `QUOTA` à un compte qui a des crédits achetés : ses poches payées deviennent inutilisables | exiger `achete` et `abonnement` dans la liste (1 ligne dans `config.js`) + adapter `test-argent-debit.js:74` et `test-argent-poches.js:6`, hérités, qui utilisent `achete,accueil` | idem |
| O3 | pré-inscription d'une adresse tierce : l'attaquant s'inscrit avec l'adresse de la victime et SON mot de passe ; la victime reçoit un lien de vérification, le clique, et le compte devient vérifié (25 offertes) avec le mot de passe de l'attaquant ; la victime ne peut plus s'inscrire (202 neutre). Une réinitialisation par la victime révoque toutes les sessions et ferme l'accès | décision de flux : exiger le mot de passe à la vérification, ou ne vérifier qu'avec une réinitialisation, ou invalider le mot de passe d'un compte non vérifié au clic ; touche l'expérience d'inscription et trois bancs hérités | décision du testeur sur le flux |
| O4 | aucun limiteur v2 sur les lectures et réponses : `GET /api/compte` (4 requêtes Mongo + historique), `POST /api/solde`, `POST /api/identifier/reponse`, `POST /api/retour-live` (la limite héritée de 60/h par IP vise `/api/identifier` et ses sous-chemins, pas `retour-live` v2). Un porteur authentifié peut charger la base. Coût élevé seulement pour `historique` (voir B7b) | un limiteur par porteur (`L.limiteur`) sur 4 routes, avec un plafond horaire à choisir : l'extension appelle `/api/solde` et le site `/api/compte` à chaque affichage, le débit normal n'est pas mesuré | plafond à décider avec les usages réels |

## 6. Dettes assumées

- **Limites de l'expurgation** (en tête de `annonce/expurger.js`) : numéros écrits en lettres, numéros sans zéro initial, pseudos sans séparateur ; les numéros de certification de 9 à 15 chiffres sont retirés. Le texte reste une donnée ; l'entrée est plafonnée à 5 000 caractères avant les expressions (16 entrées pathologiques de 1 Mo testées, toutes sous 500 ms).
- **`Domain` du cookie** : absent (cookie lié à l'hôte de l'API). Le cookie ne voyage pas vers `rat-market.fr`. `HttpOnly; Secure; SameSite=Lax; Path=/`, durée 30 jours glissante par 24 h ; les écritures du site exigent l'`Origin` exacte ET `X-Rat-Market: 1`.
- **Traitement du titre par le modèle non prouvé** : le titre (300 caractères, expurgé, `<` `>` neutralisés) part vers la chaîne héritée ; `V2_DESCRIPTION_AU_MODELE=0` garde la description chez nous. Le comportement réel du modèle devant une consigne dans un titre n'est pas prouvé hors ligne.
- **Double dotation** : l'empreinte HMAC de l'adresse est gardée 365 jours (`V2_EMPREINTE_JOURS`) : au-delà, un compte supprimé puis recréé reçoit de nouveau les 25 offertes. Les adresses à alias `+` hors Gmail sont des adresses distinctes (la normalisation de `email-cle.js` ne couvre que Gmail) et un domaine perso à adresses illimitées donne des comptes illimités : la dotation n'est pas un contrôle anti-abus fort, elle est bornée par le Turnstile et les 10 inscriptions par heure et par IP.
- **Verrouillage ciblé** : 10 mauvaises connexions par heure sur une adresse connue la bloquent une heure (la limite par IP passe d'abord). Compromis classique, sans recours.
- **Défaut R** (`test-argent-course-R.js`, exclu de `lancer-tout`, rouge attendu) : la course réponse / remboursement de panne n'est atteignable par aucun client (l'identifiant du scan n'est connu qu'avec la réponse qui clôt la requête dont le remboursement fait partie). Laissé tel quel.
- **Jeton de consentement faible** : la forme `[A-Za-z0-9_-]{16,64}` admet `aaaaaaaaaaaaaaaa` ; `DELETE /api/banc/contributions` efface les lignes du jeton présenté par n'importe quelle installation vivante. Le jeton est produit par le client ; une entropie minimale ne peut pas être imposée sans casser des clients.
- **Poches `achete` et `abonnement` sans contrôle `verifie`**, clé d'idempotence du scanner fabriquée côté serveur, limite par IP au scanner, porte de concurrence et « un corps par compte » propres à UN processus (plusieurs instances = plusieurs portes), mémoire du décodage réduit PNG/WebP de 80 Mpx non mesurée : tous bornés par le plafond de 5 minutes et le quota de la porte (B9.2), non corrigés.
- **Messages d'exception de l'adaptateur** (`identifier/adaptateur.js:129`) : le diagnostic d'une exception interne est imprimé ; il ne contient pas de donnée de requête (noms de propriétés et motifs de la chaîne).
- **Exposition CORS de `/api/creer-recharge`** : les profils CORS v2 (extension et site) listent ce chemin (`transport/cors.js:12,15`) alors que la route v2 n'est jamais atteinte (aucun `resoudrePorteur`, B7b M-7). Avec la v2 allumée, l'origine du site reçoit donc des en-têtes CORS pour la route HÉRITÉE ; la route reste protégée par `verifierJeton` / `JETON_API`, et CORS ne protège aucun client non navigateur. Aucune écriture de la v2 (vérifié par le banc : 404 ici, aucune écriture).

## 7. Décisions du testeur (non corrigées, scénario et coût des deux voies)

1. **Les lectures d'un lot refusées par QUOTA.** Scénario : un porteur qui a 1 crédit envoie un lot de 20 images ; le débit initial passe, la chaîne LIT les 20 photos (coût du modèle supporté par l'exploitant, de l'ordre de 0,003 à 0,004 $ par lecture, mesuré), puis le supplément (`ceil(20/10) - 1 = 1`) est refusé, le crédit est rendu SANS compter dans les plafonds (`lot.js:105`, plan Q25) et le client reçoit 429. Il peut recommencer 120 fois par heure. Aujourd'hui LATENT : `deps.identifierLot` (le crochet réel) n'existe pas en production. Voie A : débiter le coût complet (`coutDuLot(imageUrls.length)`) AVANT la lecture et rendre la différence ; coût : une lecture de moins à perdre, mais la facturation d'un lot partiellement lu change (une ligne d'argent, un banc de B1b.8 à réécrire). Voie B : garder le remboursement sans plafond et compter les `lot-trop-grand` dans un plafond du jour ; coût : un compteur de plus, la dépense IA du premier tour reste.
2. **« Sans prix » déclaré par le client.** Scénario : après une identification, l'extension envoie `lectureRatee { cause: 'sans-prix', definitive: true }` : le serveur ne peut pas vérifier que la lecture a échoué, il rembourse (une fois par scan, 30 par jour au total avec les abandons de questions). Un client malveillant se fait rembourser jusqu'à 30 scans par jour et par porteur. Voie A : garder (le gain est borné, l'IA a déjà été payée par l'exploitant) ; voie B : exiger que le prix du guide soit réellement nul côté serveur (`prixGuide === null`), ce que le serveur sait déjà pour le scanner ; coût : une relecture du catalogue par remboursement et un contrat extension à resserrer.
3. **Reliabilité par le sel du banc.** `_id` d'une ligne du banc = SHA-256(scanId, carte, sel) ; `analyses` et `mouvements` portent le scanId pendant 24 mois : qui détient `V2_BANC_SEL` relie toute ligne du banc à un porteur pendant toute sa vie (sans le sel, non). Voie A : l'écrire dans la politique de confidentialité et garder le sel hors de portée (un secret d'exploitation) ; voie B : re-clé aléatoire à la confirmation, ce qui perd la correction par scanId (la fonction « corriger ma réponse »).
4. **Une installation révoquée ne peut plus effacer.** Le droit d'effacement passe par `DELETE /api/banc/contributions` avec un Bearer d'installation vivante : une installation révoquée (ou désinstallée) n'efface plus ses lignes. Voie A : garder (effacer exige d'avoir une installation, le support efface à la main) ; voie B : accepter le seul jeton de consentement comme capacité d'effacement, avec une limite par IP ; coût : une route sans authentification, la devinette de jeton (16 à 64 caractères) devenant la seule barrière.

## 8. Revue différentielle (`git diff 63cce6d..HEAD`, `index.js` et `acces.js`)

`index.js` (7 hunks) et `acces.js` (2 hunks) n'ont pas été touchés par ce lot (`git diff --stat 011a638 -- . ':!v2'` est vide).

| changement | rayon d'action | v2 éteinte |
|---|---|---|
| `const V2 = process.env.RM_API_V2 === '1' ? require('./v2') : null` (`index.js:107`) | chargé une fois au démarrage ; `require` conditionnel | `null`, `v2/` n'est jamais chargé |
| `cors({…})` → `corsHeritage`, `app.use((req, res, next) => (req.origineV2 ? next() : corsHeritage(req, res, next)))` (`:121-133`) | **toutes les requêtes** de l'application (une couche) | `req.origineV2` est `undefined` : `corsHeritage` est appelé comme avant |
| `if (V2) V2.monterEnTete(app)` / `V2.monter(app, …)` (`:132`, `:206`) | une fois ; les lots v2 | non appelés |
| `gererIdentifier` et `gererRetourLive` extraits en fonctions nommées, `scanIdPrevu = req.scanIdImpose \|\| …` | 2 routes héritées (`/api/identifier`, `/api/retour-live`), 1 appelant chacun + la v2 | déplacement pur ; `req.scanIdImpose` n'est posé que par la v2 |
| `/ping` : `…(V2 ? V2.ping() : {})` | 1 route | `{}` |
| `acces.js` : `rembourserScan` et `poserQuestion` délèguent si `req.credit.v2` existe | 16 appels (6 dans `acces.js`, 10 dans `index.js`) | `req.credit.v2` n'existe que si la v2 le pose : aucun chemin de requête ne l'écrit |

Couverture : `test-acces.js` (85 assertions), `test-retour-live.js` (30 vérifications), `v2/test/test-heritage.js` (34), `test-acces-delegation.js` (5), `test-montage.js` (19) couvrent ces points ; `test-identifier-inchange.js` exige une référence externe écrite AVANT le changement (`RM_REFERENCE_IDENTIFIER`) et refuse sans catalogue : non joué.

## 9. Chaîne d'approvisionnement

- `git diff 63cce6d -- package.json package-lock.json` : **le seul changement est le script `test:v2`** (zéro dépendance nouvelle, aucune version de verrou modifiée).
- Non joué, réseau : `npm audit`, OSV, GitHub, l'état des mainteneurs (le collecteur du skill interroge ces trois services). Aucun avis n'a donc été vérifié ; ce document ne dit pas « sans avis ».
- Constat LOCAL (verrou) : dépendances directes `@aws-sdk/client-s3` 3.1131.0, `@techstark/opencv-js`, `axios` 1.20.0, `cors` 2.8.6, `dotenv` 16.6.1, `express` 4.22.2 (`body-parser` 1.20.6, `qs` 6.15.3, `path-to-regexp` 0.1.13, `cookie` 0.7.2, `send` 0.19.2, `serve-static` 1.16.3), `express-rate-limit` 8.6.0, `mongoose` 8.24.1 (`mongodb` 6.20.0), `sharp` 0.35.5, `stripe` 22.3.2. Un seul paquet exécute un script à l'installation : `puppeteer` 22.15.0 (dépendance OPTIONNELLE, marquée « deprecated : < 24.15.0 is no longer supported » dans le verrou), absente de `v2/` (0 occurrence hors tests).

## 10. Dettes parquées par les lots : un verdict chacune

Source : les lignes de `progress.md` qui portent `minor (deferred`, `parked`, `Parqués`, `POUR L'AUDIT B8`, `audit B8`, `DÉCISION PRODUIT`. Verdicts : **corrigé** (avec son test), **vérifié** (preuve jouée par le banc d'abus), **Moyen ouvert** (§5), **assumée** (aucune donnée ni argent d'autrui exposé, raison donnée), **décision du testeur** (§7).

| lot | dette | verdict |
|---|---|---|
| A0 | journal d'aiguilleur borné à 5 lignes, aucun compteur lisible | assumée : bruit de journal, aucune route recouvrante n'est montée sans aiguilleur (l'assembleur le refuse) |
| A0 | seul `true` mène à la v2 | vérifié : `RM_API_V2='true'` retombe sur « éteinte » (table des défauts, étape 6) |
| A0 | aiguilleur placé après un handler ; formes de montage non vues par `test-heritage` (`app.head`, alias, préfixe en variable) | assumée : l'assembleur refuse `use()`, `router.param` et tout chemin hors liste blanche ; le banc d'abus lit la PILE montée, pas le texte |
| B3 | le partiel P consomme deux fois le plafond du jour ; crash entre restitution et renommage du claim ; chemins non testés | assumée : aucun crédit perdu ni gagné, le compteur est conservateur |
| B3 | balayage `$unset expireLe` des lignes `rendu-*` | sans objet (jamais déployé) |
| B3 / B1b.3 | message par défaut de `MESSAGES[code]` | vérifié : `erreurs.js:18` (aucun `undefined` dans un corps d'erreur) |
| B1b.3 | une panne IA rejouée est figée par l'idempotence (même clé = même réponse) | assumée : c'est la sémantique voulue ; à écrire dans la doc OpenAPI |
| FUITE | `retenir` et `exitCode`, minuterie `unref`, délai de nettoyage non borné | assumée : outillage de test, hors surface |
| B9.1 | `req.destroy()` nécessaire ? | assumée ; la fermeture de production est désormais celle que le banc appelle (D8) |
| B1b.5 | `douteux` non lu ; minuteur de balayage non prouvé en réel | assumée : donnée de calibrage, le balayage est joué par les bancs de B1b.5 et B6.4 (déclenchement par minuterie réelle non prouvé) |
| B1b.5 | aucun limiteur v2 sur `/api/retour-live` | **Moyen ouvert O4** |
| B1b.5 | (2) rejeu de `/reponse` après un sans-prix affiche `debite:1` ; (5) un prix après un sans-prix remboursé ; (6) deux réponses contraires d'administrateurs concurrentes ; (7) carte non fabricable = 500 répété | assumée : le solde est juste, un administrateur ne débite rien, un seul prix est écrit |
| B1b.5 | `sans-prix` déclaré par le client | **décision du testeur 2** |
| B1b.7 | `desaccordRegleG` perdu sur panne finale ; introuvable de repli de G compté au plafond des pannes ; fournisseur de voisins non annulable ; registre `annonce/visuels/taux` sans consommateur | assumée : la règle G est éteinte par défaut (`V2_REGLE_G=0`), le fournisseur est borné à 2 s |
| B1b.8 | ternaire `injecte ? … : …` (la garantie vit dans `lot.js`) ; question à zéro candidat ; crochet réel de lot | assumée / latente : aucun crochet de lot n'existe en production |
| B1b.8 | lectures gratuites d'un lot par QUOTA | **décision du testeur 1** |
| B1b.4b | restauration d'un fichier dans `try` ; lecture de `test` par `MONGODB_URI` | assumée : outillage ; la façade de lecture reste la défense |
| B6.2 | `creerStockageReel` doit être suivi de `await verifierBucket()` | vérifié par lecture : `banc/routes.js:45` et `banc/purge.js:32` |
| B6.3 | pas de limiteur ni d'idempotence sur `POST /api/banc/correction` | limiteur : **O4** ; idempotence : assumée (`confirmer` n'agit que sur une ligne `attente`, une seconde correction réécrit la même vérité) |
| B6.3 | reliabilité par le sel du banc | **décision du testeur 3** |
| B6.4 | entropie du jeton de consentement | assumée (§6) |
| B6.4 | réponse tardive avant le balayage sans `apresAbandon` ; détecteur sans plafond ni délai | assumée : le filet de 24-48 h couvre ; `deps.detection` est absent en production |
| B6.4 | installation révoquée ne peut plus effacer | **décision du testeur 4** |
| B6.4 | `banc_lignes_ttl` à supprimer à la main au déploiement ; `lancerCLI` ignore `base` | assumée : note de déploiement (un TTL ancien supprimerait des lignes avant la purge) ; l'outil refuse déjà toute base hors `test_scratch` / `test` confirmé |
| B6.4 | `sessions` lue par `compteId` sans index | assumée : suppression de compte et garde du jeton de consentement seulement ; un index grossit une grappe à 457/480 Mo |
| B9.2 | poches `achete`/`abonnement` sans contrôle `verifie` ; sans-prix sous le compteur des questions | assumée (conception B3, ruling) |
| B9.2 | écho de l'image dans les erreurs de l'IA ; 413 sans `Content-Length` vu comme coupure ; mutations « par exception » sans assertion nommée | assumée : la vraie chaîne n'est pas rejouable hors ligne ; le journal du banc d'abus ne contient aucune image |
| B9.2 | `lancer` saute sans répondre si le plafond de 5 min tombe avant lui ; mémoire du décodage de 80 Mpx ; drain sans quota global ; limite par IP au scanner ; porte et « un corps par compte » par processus ; course du rejeu `/reponse` sans clé ; test C1 | assumée (§6) |
| B7b | coût de `historique` non plafonné (3 000 lignes omises : 70 `find`, 300 ms) | assumée : une ligne omise vient d'un scan payé ou d'un octroi, ou d'une ligne ancienne (poches abonnement et essai, sans surface ni facturation) ; un client ne fabrique pas des milliers de lignes omises (120 scans par heure, chacun SERVI) |
| B7b | `test-scanner-multipart.js` instable | **corrigé D8** (20/20 vertes) |
| B7b | `POST /api/banc/correction` sans garde de surface | **vérifié** : une session du site reçoit 401 `JETON` (`exigerInstallation` suffit), banc d'abus étape 5 |
| B7b | curseur bien formé mais absurde = page vide en 200 | assumée : un curseur falsifié mais bien formé ne se distingue pas sans signature ; aucune donnée d'autrui n'est lue (le curseur filtre le porteur) |
| B7b | M-5 : états B6 minces | **corrigé** : effacement `supprimees: 2` et correction avec le banc actif, joués en 200 et validés contre le schéma (banc d'abus étape 5) |
| B7b | M-6 : la déclaration X1 ne vieillit pas dans le banc de contrat | assumée : le garde-fou existant est `test-argent-solde` (motifs projetés et lignes omises comptées) ; si le contrat gagne les motifs abonnement/essai, la déclaration X1 du §7.4 devient fausse sans faire échouer le banc de contrat |
| B7b | M-7 : `POST /api/creer-recharge` en v2 jamais atteint | **vérifié** : avec un jeton v2 valide la requête sort du routeur sans écriture ; exposition CORS notée en §6 |

## 11. Réserves

- `insecure-defaults:audit` joué à la main (outil `Workflow` absent) ; semgrep et codeql non installés ; le skill de chaîne d'approvisionnement non joué (réseau).
- Aucune mesure de la grappe : aucun banc n'écrit en production, et la mesure interroge le réseau.
- `JETON_API` en production : non vérifiable ici (§4).
- Le banc d'abus rejoue le gestionnaire d'erreurs final d'`index.js` par une COPIE (il n'est pas importable sans démarrer le serveur) ; le comportement réel d'un corps de 5 Mo (413 « Requête illisible ») dépend de cette copie fidèle à `index.js:7147`.
- Les extensions du site (CORS, cookie `Secure` derrière le proxy de Render) ne sont pas prouvées hors ligne.
