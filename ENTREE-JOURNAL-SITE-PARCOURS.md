## ESSAI SEUL — parcours automatiques du site : exemption du défi et lien de confirmation (à poser au journal du site ; décision de l'éditeur, 2026-11-08)

**Où ça vaut.** Sur le service Render de l'ESSAI uniquement (`rat-market-api-essai`, base `rm_essai`). Sur la production (v1 et v2), ces deux choses n'existent pas : le code n'y est même pas chargé, la route répond le 404 natif d'Express et l'exemption ne dispense rien. Ne rien tenter hors de l'essai : l'hôte exact est `https://rat-market-api-essai.onrender.com`.

**Le compte de test.** Une seule adresse : `ratmarket.contact+essai@gmail.com`. Comparaison exacte (casse et espaces de bord tolérés, comme partout) : `ratmarket.contact@gmail.com`, `ratmarketcontact+essai@gmail.com`, `…+essai2@…`, `@googlemail.com` NE comptent PAS. Toute autre adresse reste soumise au défi Turnstile.

**Le secret.** En-tête exact : `X-Rat-Market-Mesure: <secret>` (la valeur de `V2_SECRET_MESURE` de l'essai, 32 caractères au moins ; elle vous est transmise par l'éditeur, jamais dans un fichier du dépôt ni dans un journal). Il ne se pose que depuis un script de test (Node, Playwright côté test), jamais dans le code du site : il n'est pas dans `Access-Control-Allow-Headers`, un navigateur ne peut pas l'envoyer en cross-origin.

**Ce que l'exemption dispense : le défi Turnstile, et rien d'autre.** Elle s'applique à la requête qui porte le secret ET `email` = l'adresse de test, sur ces quatre routes seulement :
- `POST /api/compte/inscription`
- `POST /api/compte/connexion`
- `POST /api/compte/mot-de-passe-oublie`
- `POST /api/compte/renvoyer-verification`

Le champ `turnstile` n'est alors pas lu. Restent appliqués : l'en-tête d'origine du site (`Origin` + `X-Rat-Market: 1`, sinon 403), les limites par IP et par adresse (429), le mot de passe (401 à la connexion), la limite d'**un courriel de confirmation par boîte et par 24 h** (voir « À savoir »), et toutes les réponses indistinguables d'avant.

**Sans secret, avec un mauvais secret, ou avec le bon secret et une autre adresse : exactement comme avant.** `422 { success:false, erreur:{ code:'ENTREE', detail:'defi-anti-robot' } }` (sauf pour l'inscription d'une adresse illisible ou invalide, qui répond `422 adresse-invalide` avant le défi, comme avant). Aucune de ces réponses ne dit si le secret existe.

**Le lien de confirmation (route d'administration, essai seulement).**
- `POST /api/essai/lien-confirmation`, corps JSON `{ "email": "ratmarket.contact+essai@gmail.com" }`, en-tête `X-Rat-Market-Mesure`.
- `200 { success:true, lien:"https://…/…?jeton=…", expire:"<ISO>" }` avec `Cache-Control: no-store`. `lien` est l'adresse que contient le courriel de confirmation ; son paramètre `jeton` se passe à `POST /api/compte/verification` avec `{ jeton, motDePasse }` (le mot de passe se choisit à ce moment, D6).
- **Usage unique** : une fois rendu, le lien est effacé de la mémoire du serveur (une seconde lecture : `404 { success:false, erreur:{ code:'INTROUVABLE' } }`).
- **Durée de vie : 15 minutes** à partir de l'envoi, puis `404 INTROUVABLE`. Un nouveau courriel de confirmation REMPLACE le précédent (un seul lien gardé).
- **Seulement pour l'adresse de test** : le serveur ne retient rien pour une autre adresse.
- **Refus** : sans secret, avec un mauvais secret, avec une autre adresse, sans corps, ou par une autre méthode que POST : la route ne répond pas elle-même, c'est le **404 natif d'Express** (« Cannot POST /api/essai/lien-confirmation » ; pour GET : « Cannot GET … »), identique à une route qui n'existe pas — **avec deux exceptions** : les gardes communes de toutes les routes v2 passent avant elle, donc un corps dont une clé est interdite (`{"$ne":1}`, `__proto__`) rend `400 ENTREE cle-interdite`, et un serveur dont l'index n'est pas encore prêt rend `503`. Ne pas écrire de test qui exige le 404 natif dans ces deux cas. Le seul 404 JSON `INTROUVABLE` n'est rendu qu'à qui porte le bon secret ET la bonne adresse.
- Le lien n'est gardé qu'en mémoire du processus (jamais en base, jamais dans un journal) : un redémarrage de l'essai l'efface ; lisez-le juste après l'inscription (le courriel part sans attendre la réponse : `202` est rendu avant l'envoi, comptez 1 à 3 secondes, relisez au besoin jusqu'à 15 minutes).

**Le parcours, de bout en bout.** (1) `POST /api/compte/inscription` `{ email }` + secret → `202`. (2) `POST /api/essai/lien-confirmation` → le lien. (3) `POST /api/compte/verification` `{ jeton, motDePasse }` → `200 { verifie:true }`. (4) `POST /api/compte/connexion` `{ email, motDePasse }` + secret → `200` et le cookie de session `rm_session`. Puis Ma collection et l'Atelier avec ce cookie.

**À savoir.**
1. **Un courriel de confirmation par boîte et par 24 h** : cette limite s'applique aussi à l'adresse de test (elle n'est pas levée, pas d'autre exemption). Un parcours « inscription » rejoué dans les 24 h après une première inscription ne produira pas de nouveau lien ; le compte déjà confirmé persiste et la connexion suffit pour tester Ma collection et l'Atelier. Pour rejouer l'inscription, il faut supprimer le compte (`DELETE /api/compte` avec le mot de passe) puis attendre la fin des 24 h, ou en convenir avec l'éditeur.
2. Le compte de test confirmé garde ses 25 offertes une seule fois par adresse (règle d'origine).
3. La clé de compte d'une adresse Gmail ignore points et « +… » : `ratmarket.contact+essai@gmail.com` et `ratmarketcontact@gmail.com` désignent le MÊME compte côté serveur ; seule la première reçoit l'exemption.
4. Les outils de mesure de l'API qui se connectent avec leur propre compte (`connexion-essai`, `parcours-test`) ne bénéficient plus de l'exemption : elle est désormais liée à l'adresse du compte de test (décision de l'éditeur : aucune autre exemption).
