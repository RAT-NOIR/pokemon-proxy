# Audit des dependances, branche v2-audit-deps (depuis origin/api-v2 cf85673b ; l'audit initial portait sur f43544e2, package*.json identiques)

Commits : e7e65a3e (test), bea9ca8f (test, correction d'une attente a moi), daf1cee8 (package-lock.json seul). package.json inchange. Rien n'est pousse.

## Versions

| paquet | avant | apres | tire par |
|---|---|---|---|
| body-parser | 1.20.6 | 1.20.9 | express (dependance directe du depot) |
| express | 4.22.2 | 4.22.3 | direct (^4.19.2, reste dans la plage) |
| qs | 6.15.3 | 6.16.2 | express (query), body-parser |
| proxy-addr | 2.0.7 | 2.0.8 | express |
| ip-address | 10.2.0 | 10.7.6 | express-rate-limit 8.6.0 |
| follow-redirects | 1.16.0 | 1.16.3 | axios 1.20.0 |

Le diff du verrou touche exactement ces six entrees (+ `qs`/`path-to-regexp` dans les `dependencies` de body-parser et express, et un champ `funding` sur proxy-addr) : 25 insertions, 21 suppressions, voir PAQUET-RELECTURE-AUDIT.diff.txt.
`npm audit fix` a corrige quatre paquets mais laisse `qs` : express 4.22.2 exige `qs ~6.15.1` (plafond 6.15.4, encore vulnerable, plage <= 6.16.0). La seule mise a jour qui le leve est `npm update express` (4.22.3, `qs ~6.16.0`), un patch dans la plage declaree. Pas de --force, pas de saut majeur.
`npm audit` (sortie obtenue juste apres `npm update express`, verrou identique a celui commite) : « found 0 vulnerabilities ». La relance finale a ete REFUSEE par la porte reseau (« npm audit : ... refuse »), je ne l'ai pas contournee : ce resultat est celui d'avant les commits, sur le meme arbre.

## Atteignabilite (code servi)

- proxy-addr (GHSA-jqcg-44mw-7w3h) : NON ATTEIGNABLE, revu sans te croire. index.js:114 `app.set('trust proxy', 1)` ; express/lib/application.js:388-389 compile via `compileTrust` ; express/lib/utils.js:223-226 : un nombre devient `function(a,i){return i<val}`, `proxyaddr.compile` n'est appele (utils.js:234) que pour une chaine ou un tableau ; request.js:351 et 368 passent cette fonction a `proxyaddr()`/`proxyaddr.all`, et proxy-addr/index.js:64-66 ne recompile que si `trust` n'est pas une fonction. Aucun autre `trust proxy`/`.enable(` dans le code servi (grep hors tests). Les bancs utilisent `trust proxy true` (fonction constante, pas non plus de compile). Mise a jour faite quand meme.
- body-parser (GHSA-27r3-jxmh-p828) : CHEMIN ATTEIGNABLE, DENI DE SERVICE NON REPRODUIT. `express.json()` (index.js:187, et index.js:172 pour la grande limite) a `inflate: true` par defaut : body-parser/lib/read.js:165-175 accepte gzip et deflate sur toutes les routes sans corps brut ; aucun code du depot ne filtre `Content-Encoding` (grep). Le correctif 1.20.9 (diff read.js) detache le flux de decompression, y ajoute un ecouteur d'erreur vide et reprend le flux de la requete une fois le corps lu : le defaut est donc une erreur de decompression emise apres coup sur un flux sans ecouteur (exception non capturee probable). J'ai rejoue 12 variantes (gzip/deflate valides + octets finaux en un ou deux morceaux, zeros, 2 Mo, second membre invalide, flux tronque, Content-Length et chunked) sur 1.20.6 et 1.20.9 : reponses 200/400 bornees, 0 exception non capturee, dans les deux cas, sous Node v24.18.0. Je n'ai pas pu lire le texte de l'avis (WebFetch ferme par la porte) ; le declencheur exact reste donc inconnu, et je ne peux pas affirmer qu'il ne se produit pas sous Node 22.x (engines du depot, non disponible ici).
- qs : ATTEIGNABLE (parse). express/lib/middleware/query.js:17 passe l'URL de toute requete par `qs.parse` (analyseur `extended` par defaut) ; aucune route n'utilise `express.urlencoded`, et le depot n'appelle pas `qs.stringify` (les avis stringify/arrayFormat comma ne sont pas atteints). L'avis « isBuffer » porte sur le parse : traite comme atteignable. Parsing verifie inchange (a[]=1&a[]=2, b[c], a=1,2, __proto__).
- ip-address : ATTEIGNABLE, ENTREE NON CHOISIE PAR L'ATTAQUANT. Seul usage : express-rate-limit/dist/index.cjs:47-56 `ipKeyGenerator` (isIPv6 puis Address6, is4, to4, networkForm), appele avec `req.ip` (v2/limiteur-heritage.js:61, v2/installations/routes.js:34, v2/banc-telephone/routes.js:88, v2/lien-ordinateur/routes.js:27). `req.ip` est l'adresse du pair TCP ou celle ajoutee par le proxy de confiance (1 saut), pas une chaine libre ; les fonctions de classification SSRF (isLinkLocal, isInSubnet...) ne sont jamais appelees.
- follow-redirects : ATTEIGNABLE EN PRINCIPE, CONDITIONNEL. axios 1.20.0 suit 5 redirections par defaut ; appels servis vers hotes fixes : api.tcgdex.net (index.js:1248, 1253, 1352, 1519, 1799, 1886) et openrouter.ai avec `Authorization: Bearer` (index.js:322, 1097-1100). Les trois avis exigent des en-tetes en forme de tableau ou une option `sensitiveHeaders` personnalisee : aucune n'est utilisee (en-tetes en chaines, pas de beforeRedirect/maxRedirects), et il faudrait en plus qu'openrouter.ai redirige vers une autre origine. Risque residuel faible.

## Test

v2/test/test-deps-audit.js (sans base, sans dotenv, sans fichier hors node_modules) : 29 assertions. Sur l'arbre d'avant (RM_DEPS_RACINE=copie des anciennes versions) : 23 reussis, 6 echoues (les 5 planchers de version + une attente fausse de ma part, corrigee ensuite). Sur l'arbre apres : 29/0. ROUGE REEL SEULEMENT SUR LES PLANCHERS de version ; le scenario de l'avis body-parser est vert aussi sur l'ancienne version (non reproduit). Verifie aussi : 413 corps clair et corps gzip gonfle, 400 JSON invalide, 415 encodage inconnu, `req.ip` = 5.6.7.8 pour `X-Forwarded-For: 9.9.9.9, 5.6.7.8` avec trust proxy 1.
Suites rejouees une par une, apres mise a jour : test-limites 31, test-limiteur-herite 51, test-limites-porteur 36, test-corps-identifier-empreinte 17, test-cors 80, test-contrat-routes 5, test-abus-routes 89, test-banc-telephone-cors 44, test-scanner-multipart 79 : 0 echoue. (test-limites imprime une ligne rouge « horloge-faux », c'est une injection de panne du banc, code de sortie 0.) `v2/test/lancer-tout.js` non lance.

## Non verifie

- Texte de l'avis body-parser (WebFetch refuse par la porte) et comportement sous Node 22.
- Relance finale de `npm audit` (refusee par la porte).
- test-index*, test-contrat-reel/extension, test-galerie-contrat-tour1 non rejoues (suites a base ou inutiles ici).

## Hors perimetre, liste seule, aucun code

- Empreinte d'IP sans cle : `L.empreinteIp` de v2/transport/limites.js, utilisee par v2/installations/routes.js:34 et v2/banc-telephone/routes.js:88 ; une IPv4 se retrouve par dictionnaire (v2/lien-ordinateur/routes.js:27 est deja a cle HMAC).
- Dependances utilisees non declarees dans package.json : `finalhandler` (v2/banc/photo.js, transitive d'express) ; `mongodb` (v2/banc/reparer-seau.js, v2/migrations/rejouer-migration-credits.js, collecte-cartes/facade-lecture.js et un autre fichier, transitive de mongoose). Une mise a jour de mongoose/express peut les retirer ou les changer de version sans prevenir.
- Engines `22.x` : les installations et essais de cette nuit ont tourne sous Node 24.18.0 (avertissement EBADENGINE).
