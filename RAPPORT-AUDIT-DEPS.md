# Audit des dependances, branche v2-audit-deps (depuis origin/api-v2 cf85673b ; l'audit initial portait sur f43544e2, package*.json identiques)

Commits : e7e65a3e puis 70b568ef/683b42b0 (banc), daf1cee8 (package-lock.json seul), rapport. package.json inchange. Rien n'est pousse.
Tour 1 de correction (RELECTURE-AUDIT-1, D1 a D6) : fait, voir « Test » ci-dessous.

## Versions

| paquet | avant | apres | tire par |
|---|---|---|---|
| body-parser | 1.20.6 | 1.20.9 | express (dependance directe du depot) |
| express | 4.22.2 | 4.22.3 | direct (^4.19.2, reste dans la plage) |
| qs | 6.15.3 | 6.16.2 | express (query), body-parser |
| proxy-addr | 2.0.7 | 2.0.8 | express |
| ip-address | 10.2.0 | 10.7.6 | express-rate-limit 8.6.0 |
| follow-redirects | 1.16.0 | 1.16.3 | axios 1.20.0 |

Le diff du verrou touche exactement ces six entrees (+ `qs`/`path-to-regexp` dans les `dependencies` de body-parser et express, et un champ `funding` sur proxy-addr) : 25 insertions, 21 suppressions.
`npm audit fix` a corrige quatre paquets mais laisse `qs` : express 4.22.2 exige `qs ~6.15.1` (plafond 6.15.4, encore vulnerable, plage <= 6.16.0). La seule mise a jour qui le leve est `npm update express` (4.22.3, `qs ~6.16.0`), un patch dans la plage declaree. Pas de --force, pas de saut majeur.
`npm audit` (sortie obtenue juste apres `npm update express`, verrou identique a celui commite) : « found 0 vulnerabilities ». La relance finale a ete REFUSEE par la porte reseau, je ne l'ai pas contournee.

## Atteignabilite (code servi)

- proxy-addr (GHSA-jqcg-44mw-7w3h) : NON ATTEIGNABLE, revu sans te croire. index.js:114 `app.set('trust proxy', 1)` ; express/lib/application.js:388-389 compile via `compileTrust` ; express/lib/utils.js:223-226 : un nombre devient `function(a,i){return i<val}`, `proxyaddr.compile` n'est appele (utils.js:234) que pour une chaine ou un tableau ; request.js:351 et 368 passent cette fonction a `proxyaddr()`/`proxyaddr.all`, et proxy-addr/index.js:64-66 ne recompile que si `trust` n'est pas une fonction. Aucun autre `trust proxy`/`.enable(` dans le code servi. Mise a jour faite quand meme.
- body-parser (GHSA-27r3-jxmh-p828) : CHEMIN ATTEIGNABLE sur QUATRE analyseurs, DENI DE SERVICE NON REPRODUIT. `inflate: true` par defaut : body-parser/lib/read.js:165-175 accepte gzip et deflate pour `express.json()` (index.js:187), `express.json({limit:'2400kb'})` (index.js:172), `express.raw({type:'application/json'})` (index.js:164, webhook Stripe) et `express.raw({type:()=>true, limit:'256kb'})` (v2/abonnements/webhook.js:173). Aucun code du depot ne filtre `Content-Encoding`. Le correctif 1.20.9 (diff de read.js) detache le decodeur de la requete, le detruit, lui pose un ecouteur d'erreur vide et reprend la requete (`req.resume()`). Rejoue sur ces quatre routes, sur 1.20.6 et 1.20.9, sous Node 22.23.3 ET 24.18.0 : gzip/deflate + octets/zeros finaux (ecriture TCP unique, deux morceaux a 100 ms), depassement de limite + octets, charset inconnu, flot de 32 Mo, abandon RST, keep-alive : AUCUNE exception non capturee dans aucun cas, lue apres la fermeture du socket + 300 ms. Le texte de l'avis n'a pas pu etre lu (WebFetch ferme par la porte) : le declencheur exact reste inconnu. CE QUI DIFFERE entre les versions est l'etat a la fin de la reponse : en 1.20.6 le decodeur n'est pas detruit et la requete lui reste reliee (zeros finaux : gzip et deflate ; octets finaux : deflate), en 1.20.9 il est detruit et detache dans tous les cas. Les analyseurs de webhook sont exposes au meme titre (corps brut signe, mais decompresse avant la verification de signature).
- qs : ATTEIGNABLE (parse). express/lib/middleware/query.js:17 passe l'URL de toute requete par `qs.parse` avec `allowPrototypes: true` ; aucune route n'utilise `express.urlencoded`, et le depot n'appelle pas `qs.stringify` (les avis stringify/arrayFormat comma ne sont pas atteints). Le garde `requeteRefusee` (v2/index.js:68, applique l.125) ne laisse passer que des chaines ou des listes de chaines : sur 53 formes de requete (imbriquees, `a[isBuffer]`, `constructor[prototype]`, `__proto__`, plus de 100 elements, 1 200 cles, encodages invalides...) le resultat (statut, verdict, forme analysee) est identique entre 6.15.3 et 6.16.2 ; aucune pollution de `Object.prototype`.
- ip-address : ATTEIGNABLE, ENTREE NON CHOISIE PAR L'ATTAQUANT. Seul usage : express-rate-limit/dist/index.cjs:47-56 `ipKeyGenerator` (isIPv6 puis Address6, is4, to4, networkForm). Les quatre limiteurs d'index.js (limiteurIA l.224, limiteurApprentissage l.243, limiteurLot l.254, limiteurRetourLive l.265) utilisent la cle par defaut = ipKeyGenerator(req.ip) ; la v2 l'appelle aussi (v2/limiteur-heritage.js:61, v2/installations/routes.js:34, v2/banc-telephone/routes.js:88, v2/lien-ordinateur/routes.js:27). Mesure (mêmes options, max 3, trust proxy 1) : pour chacun des quatre, 4 requetes aux `X-Forwarded-For` forges differents mais au meme dernier saut partagent UN compteur (200,200,200 puis 429 ; limiteurLot : la 4e est marquee `enFileServeur`), un autre dernier saut ouvre un compteur neuf, deux IPv6 d'un meme /56 partagent un compteur, un autre /56 compte a part. `req.ip` = dernier saut ajoute par le proxy (5.6.7.8 pour `9.9.9.9, 5.6.7.8`), adresse du socket sans en-tete. Les fonctions de classification SSRF (isLinkLocal, isInSubnet...) ne sont jamais appelees. ⚠️ Cette cle suppose que le dernier saut est celui du proxy de Render ; un acces direct au pod permettrait de le forger.
- follow-redirects : ATTEIGNABLE EN PRINCIPE, CONDITIONNEL. axios 1.20.0 suit 5 redirections par defaut ; appels servis vers hotes fixes : api.tcgdex.net (index.js:1248, 1253, 1352, 1519, 1799, 1886) et openrouter.ai avec `Authorization: Bearer` (index.js:322, 1097-1100). Les trois avis exigent des en-tetes en forme de tableau ou une option `sensitiveHeaders` personnalisee : aucune n'est utilisee, et il faudrait en plus qu'openrouter.ai redirige vers une autre origine. Risque residuel faible.

## Test

v2/test/test-deps-audit.js (+ test-deps-audit.requetes.json, le tableau des 53 formes de requete) : 178 assertions, sans base, sans dotenv. Rejoue par `RM_DEPS_RACINE=<arbre des anciennes versions>` :
- arbre NOUVEAU : 178/0 sous Node 24.18.0 ET sous Node 22.23.3 (api\node22).
- arbre ANCIEN : 156 reussis, 22 echoues, identique sous Node 24 et Node 22 : 10 echecs de versions (cinq paquets x « résolu depuis le consommateur » et « copies chargées », depuis le fichier réellement résolu puis chargé, pas package.json) et 12 echecs d'etat du decodeur (json 187, json 172, raw 164 : gzip+zeros, deflate+zeros, deflate+octets). ⚠️ Le rouge est un ROUGE D'ETAT, pas un plantage : le scenario de l'avis ne plante pas 1.20.6. Sur l'arbre ancien, la route webhook est une copie de la ligne 173 (le module reel charge l'express du depot) ; sur l'arbre du depot c'est la route reelle `monterWebhook`, qui passe.
- Portee des assertions (tour 2) : les assertions d'etat du decodeur DECRIVENT body-parser 1.20.9, elles ne prouvent pas que la faille est fermee (avis non lu, precondition supposee). D3 reste tel que declare : les options des quatre limiteurs sont des copies, non verrouillees sur index.js. Sur l'arbre du depot, le banc n'a plus de repli silencieux pour la route webhook : le chargement leve, et une assertion exige la route reelle.
- D4 : les exceptions non capturees se lisent apres la fermeture reelle du socket + 300 ms, et a la fermeture du serveur.
Suites rejouees une par une, apres les changements : test-limites 31, test-limiteur-herite 51, test-limites-porteur 36, test-corps-identifier-empreinte 17, test-cors 80, test-contrat-routes 5, test-abus-routes 89, test-banc-telephone-cors 44, test-scanner-multipart 79, test-abonnements-webhook 77 : 0 echoue. (test-limites imprime une ligne rouge « horloge-faux », injection de panne du banc, code de sortie 0.) `v2/test/lancer-tout.js` non lance. Disque : 15 Go libres a la fin, aucun mongod ni Chrome lance.

## Node de Render (prouvable)

Service srv-db7ticgm7kps73crjibg (rat-market-api-essai) : `env: node`, build `npm install`, branche api-v2, plan free, Frankfurt. Aucun `.node-version`, `.nvmrc`, `render.yaml` ni `.tool-versions` dans le depot ; package.json `engines.node` = `22.x`. Les variables d'environnement ne se lisent pas par l'outil Render : une eventuelle NODE_VERSION n'est pas verifiable. Prouve : une branche 22.x (derniere 22 resolue par Render a la construction) ; NON prouve : la version exacte. Le banc a ete joue sous 22.23.3.

## Non verifie

- Le texte de l'avis body-parser (WebFetch ferme par la porte) : declencheur exact inconnu, deni de service non reproduit sous Node 22.23.3 ni 24.18.0.
- Relance finale de `npm audit` (refusee par la porte) : le « 0 vulnerabilite » date de l'arbre juste avant les commits, verrou identique.
- Les limiteurs sont rejoues par des copies de leurs options (index.js ne se charge pas sans base) ; le branchement exact (`app.use` aux lignes 234-235, routes l.6594-6712) n'est pas rejoue.
- test-index*, test-contrat-reel/extension, test-galerie-contrat-tour1 non rejoues.

## Hors perimetre, liste seule, aucun code

- Empreinte d'IP sans cle : `L.empreinteIp` de v2/transport/limites.js, utilisee par v2/installations/routes.js:34 et v2/banc-telephone/routes.js:88 ; une IPv4 se retrouve par dictionnaire (v2/lien-ordinateur/routes.js:27 est deja a cle HMAC).
- Dependances utilisees non declarees dans package.json : `finalhandler` (v2/banc/photo.js, transitive d'express) ; `mongodb` (v2/banc/reparer-seau.js, v2/migrations/rejouer-migration-credits.js, collecte-cartes/facade-lecture.js et un autre fichier, transitive de mongoose).
