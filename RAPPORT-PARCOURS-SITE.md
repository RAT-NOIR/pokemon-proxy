# RAPPORT-PARCOURS-SITE — parcours automatiques du site sur l'essai (2026-11-08)

Branche `v2-parcours-site` depuis `origin/api-v2` (`cf85673b`). Rien poussé, rien déployé, aucune variable posée, aucun compte ni courriel réel.

## 1. L'exemption existante : état avant, défaut signalé
- Avant : `cfg.mesure` s'allumait sur `V2_CIBLE=essai` + secret ≥ 32 + `RENDER_SERVICE_ID` = service de l'essai (pas de condition sur la base). Le code (calcul du condensé, comparaison, `mesureAutorisee`) vivait dans `config.js` et `comptes/routes.js`, donc **chargé et exécutable en production** ; seule la combinaison de trois variables d'environnement l'éteignait.
- Elle n'était liée à AUCUNE adresse (tout compte, dès qu'on portait le secret) et ne couvrait pas l'inscription.
- **Défaut à signaler** : « absente du code servi en production » était faux (drapeau seulement). Corrigé ici : voir §2.

## 2. La garde de service retenue
`v2/garde-essai.js` (minuscule, ne charge rien) : liste permise de trois conditions, toutes exactes, sinon refus : `MONGODB_BASE === 'rm_essai'` ET `RENDER_SERVICE_ID === 'srv-db7ticgm7kps73crjibg'` ET `V2_CIBLE === 'essai'`. Absente, vide, casse, espace de bord : refus. `config.js` ne fait `require('./essai-parcours')` que si elle passe ; sinon `cfg.mesure = { actif:false, raison }` sans aucune fonction. `routes.js` et `monter.js` ne lisent que `cfg.mesure.autorise` / `.monter` (absents hors essai = NON). Retrait d'un geste : supprimer `v2/essai-parcours/` et la ligne de `config.js`.
Prouvé par `test-essai-parcours.js` : 13 environnements hors essai (base test, absente, test_scratch, casse, espace ; service autre/absent/majuscules ; cible absente/prod ; secret seul ; vide) → exemption inactive, aucune fonction, `require.cache` sans le module après les 13 lectures ET après un montage réel de routes sous environnement de production portant le bon secret + la bonne adresse ; route d'administration = 404 natif identique à une route inconnue.

## 3. Périmètre de l'exemption
Défi Turnstile seul, requête portant l'en-tête `X-Rat-Market-Mesure` (SHA-256 comparés par `timingSafeEqual`) ET `email` exactement `ratmarket.contact+essai@gmail.com` (NFKC, trim, minuscules ; **pas** `emailCle`, qui effacerait points et « + » de Gmail), sur inscription (nouveau), connexion, oubli, renvoi. Origine, limites IP/adresse, mot de passe, limite de 24 h : inchangés. Secret : jamais gardé en clair (condensé non énumérable), jamais journalisé ni rendu (banc : journal, réponses, `JSON.stringify`/`util.inspect` de la configuration).

## 4. Comment le lien est reconstitué
Les jetons sont hachés dans `liens_email` et le chemin normal n'est PAS touché. Le module enveloppe le pilote de courrier (registre) à l'essai : `envoyerVerification` retient, EN MÉMOIRE du processus, le lien clair (celui du courriel) seulement si le destinataire est l'adresse exacte de test. Un seul lien gardé (le dernier remplace), 15 min (`DUREE_LIEN_MS`), usage unique (effacé à la lecture), jamais en base ni dans un journal. Route `POST /api/essai/lien-confirmation {email}` + même en-tête : 200 `{lien, expire}` ; 404 JSON `INTROUVABLE` si rien (bon secret + bonne adresse seulement) ; sinon 404 natif d'Express (sans secret, mauvais secret, autre adresse, sans corps, GET).

## 5. Bancs
`v2/test/test-essai-parcours.js` : 42 réussis, 0 échoué (avant l'incident de disque). Couvre : sans secret / mauvais secret / secret vide / adresse non texte / 7 adresses voisines (bon secret) sur les 4 routes ; 13 environnements hors essai ; montage réel sous production ; parcours complet inscription → lien → confirmation → connexion ; usage unique ; expiration 14 min 59 s / 15 min 0,001 s sur horloge fausse ; autre adresse ne laisse aucun lien ; secret absent des journaux et réponses ; un seul fichier nomme le module (`config.js`) ; le module ne journalise rien.
**Mutations (rouge vu)** : (a) `refusEssai === null ?` → `true ?` (garde de service retirée) : 20 échecs ; (b) contrôle d'adresse retiré de `autorise` : 8 échecs ; (c) comparaison du secret remplacée par `true` : 9 échecs. Chacune restaurée, 42/42 revérifié.
Bancs existants adaptés (l'exemption exige désormais la base `rm_essai` et l'adresse de test) : `test-comptes-defi.js` (bloc mesure rejoué sur l'adresse de test, cas base de production et autre adresse ajoutés, inscription), `test-lien-ordinateur.js` (témoin de configuration), `test-abus-routes.js` (3 lignes de la table des variables retirées : elles ne sont plus lues par `config.js`).

## 6. Non vérifié, et pourquoi
- **Disque plein sur ce poste** (`C:` ~160 Mo libres, le mongod local exige 500 Mo : `OutOfDiskSpace` 14031) à partir de la dernière série : `test-comptes-defi`, `test-lien-ordinateur`, `test-abus-routes` n'ont **pas été rejoués après leur adaptation** (avant adaptation, leurs seuls échecs étaient les attendus liés au changement : 5, 1 et 1). `test-banc-telephone`, `test-contrat-reel` et les autres bancs touchés par l'ajout de §1.12 au contrat non rejoués. Verrou `lancer-tout.js` non lancé (consigne).
- Pas de test contre un vrai Render, un vrai Brevo ni un vrai Turnstile.
- Le 404 de la route sous essai est précédé de la garde d'index `pret` : si l'index n'est pas prêt, la route (existante) répond 503 : fuite d'existence négligeable, non corrigée.
- Pas de limiteur sur la route d'administration (le secret fait ≥ 32 caractères, comparaison en temps constant).

## 7. Points de décision pour le coordinateur
1. Les outils de mesure existants (`connexion-essai.js`, `parcours-test.js`, juge en un clic) se connectent avec leur PROPRE compte : ils **perdent l'exemption** (liée à l'adresse de test, décision « aucune autre exemption »). À arbitrer si on veut l'étendre (ex. liste d'adresses de mesure).
2. La limite d'un courriel de confirmation par boîte et par 24 h reste appliquée au compte de test : un parcours « inscription » ne se rejoue pas dans les 24 h (levée possible mais ce serait une exemption de plus).
3. À poser par vous sur l'essai : `V2_SECRET_MESURE` (déjà prévue), `MONGODB_BASE=rm_essai` et `V2_CIBLE=essai` doivent y être exacts (sinon la ligne de démarrage `dispense de mesure : inactive (raison)` le dit).
4. Mémoire du lien : un redémarrage de l'essai l'efface ; une seule instance suppose (aucun partage entre instances).
