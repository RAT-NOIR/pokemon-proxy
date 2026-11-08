# RAPPORT-PARCOURS-SITE — parcours automatiques du site sur l'essai (2026-11-08, mis à jour après l'arbitrage)

Branche `v2-parcours-site` depuis `origin/api-v2` (`cf85673b`). Rien poussé, rien déployé, aucune variable posée, aucun compte ni courriel réel, `lancer-tout.js` non lancé.

## 1. L'exemption existante : état avant, défaut signalé
- Avant : `cfg.mesure` s'allumait sur `V2_CIBLE=essai` + secret ≥ 32 + `RENDER_SERVICE_ID` = service de l'essai (aucune condition sur la base). Le code vivait dans `config.js` et `comptes/routes.js` : **chargé et exécutable en production**, seule une combinaison de variables l'éteignait. Liée à aucune adresse, sans l'inscription.
- **Défaut** : « absente du code servi en production » était faux (drapeau seulement). Corrigé (§2).

## 2. Garde de service
`v2/garde-essai.js` (minuscule, ne charge rien) : `MONGODB_BASE === 'rm_essai'` ET `RENDER_SERVICE_ID === 'srv-db7ticgm7kps73crjibg'` ET `V2_CIBLE === 'essai'`, tout exact. `config.js` ne fait `require('./essai-parcours')` que si elle passe ; sinon `cfg.mesure = { actif:false, raison }` sans fonction. `routes.js` et `monter.js` ne lisent que `cfg.mesure.autorise` / `.monter` (absents = NON). Retrait d'un geste : supprimer `v2/essai-parcours/` et la ligne de `config.js`.
Prouvé par `test-essai-parcours.js` : 13 environnements hors essai (module absent de `require.cache`, aussi après un montage réel sous production avec le bon secret) ; route d'administration = 404 natif identique à une route inconnue.

## 3. Périmètre de l'exemption — LISTE FERMÉE (arbitrage du coordinateur)
Défi Turnstile seul, requête portant `X-Rat-Market-Mesure` (SHA-256, `timingSafeEqual`) ET `email` exactement l'une des trois adresses de `ADRESSES_EXEMPTEES` : `ratmarket.contact+essai@gmail.com` (compte de test du site), `banc-mesure@rat-market.invalid` (compte de mesure, `compte-essai.js`), `banc-ordinaire@rat-market.invalid` (compte de test ordinaire, `exemption-banc.js`). J'ai inclus le compte « ordinaire » parce que `connexion-essai`/`serie-essai` s'y connectent aussi avec le même secret : sans lui l'outil du juge casserait. Routes : inscription, connexion, oubli, renvoi. Comparaison NFKC/trim/minuscules, **pas** `emailCle`. Origine, limites, mot de passe, limite de 24 h : inchangés. Route du lien de confirmation : l'adresse de TEST seule (les deux autres sont en `.invalid`, aucun courriel n'en part). Secret : condensé non énumérable, jamais journalisé ni rendu (banc).

## 4. Lien de confirmation
Jetons hachés, chemin normal intact. À l'essai, le pilote de courrier est enveloppé : le lien clair du courriel est retenu EN MÉMOIRE du processus, seulement pour l'adresse de test ; un seul lien (le dernier), 15 min, usage unique, jamais en base ni dans un journal. `POST /api/essai/lien-confirmation {email}` + en-tête : 200 `{lien, expire}` ; 404 JSON `INTROUVABLE` (bon secret + bonne adresse, rien en attente) ; sinon 404 natif d'Express.

## 5. Bancs (rejoués ce soir, disque vérifié avant chaque série : 2,4 à 8,5 Go libres)
- `test-essai-parcours` : **51 réussis, 0 échoué** (nouveaux : les trois adresses de la liste × connexion/oubli/renvoi sous chacune des trois conditions manquantes (base de production, autre service, `V2_CIBLE` absente) => 422 ; liste = exactement 3 adresses, cohérente avec leurs définitions ; comptes de mesure dispensés sur l'essai (401/202) et soumis au défi sans secret ; 5 adresses voisines refusées ; route du lien muette pour un compte de mesure).
- `test-comptes-defi` : 114 réussis, 0 échoué. `test-lien-ordinateur` : 148/0. `test-abus-routes` : 89/0. (Les lignes `❌ [v2 turnstile] pilote en échec` sont des journaux attendus du banc.)
- **Mutations (rouge vu)** : garde de service retirée (20 échecs) ; contrôle d'adresse retiré (8) ; comparaison du secret retirée (9) ; liste fermée ouverte à toute adresse (8 échecs, dont les « adresses voisines »). Chacune restaurée.
- Adaptés : `test-comptes-defi`, `test-lien-ordinateur` (base `rm_essai` + `V2_SECRET_EMPREINTE` de banc, adresse de test), `test-abus-routes` (3 lignes de la table des variables retirées : elles ne sont plus lues par `config.js`).

## 6. Non vérifié
- **Aucune preuve que l'essai porte `V2_CIBLE=essai` et `MONGODB_BASE=rm_essai`** : je n'ai pas interrogé Render (le MCP ne lit aucune variable d'environnement ; consigne : aucune valeur affichée). Seule preuve possible : la ligne de démarrage `dispense de mesure : active` / `inactive (raison)` dans les journaux de l'essai après déploiement, qui nomme la condition manquante sans valeur secrète.
- Bancs non rejoués : `test-banc-telephone`, `test-contrat-reel` et autres touchés par §1.12 du contrat ; verrou non lancé (consigne). Rien testé contre un vrai Render, Brevo ou Turnstile.
- 404 de la route sous essai précédé de la garde d'index `pret` (503 si l'index n'est pas prêt : fuite d'existence négligeable). Pas de limiteur propre sur la route. Lien en mémoire : perdu au redémarrage, une seule instance supposée.
- La limite d'un courriel de confirmation par boîte et par 24 h reste appliquée au compte de test (un parcours « inscription » ne se rejoue pas dans les 24 h).
