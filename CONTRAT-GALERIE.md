# CONTRAT-GALERIE — PROPOSITION de l'API (guichet, 31/10) pour la galerie, l'atelier et la modération du site

> 🔁 **REMPLACÉ (2026-11-08) par `CONTRAT-API-V2.md` §1.10 (A à G) et l'OpenAPI, qui seuls font foi.** Document gardé pour l'historique des décisions. Écarts connus : un seul stockage `/api/classeurs` (page `{ nb, blocs }`, ni `michi` ni `fonds`) ; `Publication.nb` à la place de `n` ; `cartes[]` = `{ cle, setSlug }` (plus de `nom`) ; quota de publications au jour civil de Paris ; pas de route `/reprise`.

**Statut d'origine : PROPOSITION, pas de code.** À relire par le coordinateur. Rien ici n'est dans `CONTRAT-API-V2.md` ni dans l'OpenAPI tant que le lot d'implémentation (trois relectures dont sécurité) n'est pas fait.
**Point de départ** : la demande du site, `C:\Users\Yung\Desktop\rat-market-site\DEMANDE-SERVEUR-SITE.md` §2 à §10 (classeurs, illustrations, galerie, signalements, modération, stockage). Ce document en reprend les routes et les formes TELLES QUELLES sauf là où il écrit « **amendement API** ». Là où il ne dit rien, la demande du site fait foi.
**Modèle de code existant** : « Ma collection » (`v2/collection/`, CONTRAT §1.8), les comptes (`v2/comptes/`, sessions, `turnstile.js`), l'idempotence (`v2/transport/idempotence.js`).

## 0. Ce qui doit être arbitré AVANT le lot (remonté au coordinateur)
1. **La place en base.** La grappe de production est à ~439 Mo sur 512 (dont `references_image` ~372 Mo). Le site estime ~40 Ko par compte typique, ~200 Mo à 1 000 comptes actifs. **Rien de ce lot ne peut s'écrire dans la grappe de production en l'état.** Options : (a) libérer de la place (le levier est `references_image`), (b) une grappe dédiée « communauté » (gratuite, séparée, avec sa propre variable), (c) passage en Flex. L'API recommande **(b)** : la communauté ne partage pas le sort de la reconnaissance. **À l'arbitrage de l'éditeur** (remonté par le coordinateur).
2. **La recompression côté serveur** (§4) charge la mémoire du service (offre gratuite, 512 Mo). Amendement proposé ci-dessous (bornes de pixels plus basses) : **proposition à mesurer, rien d'écrit ni de figé** ; à confirmer par une mesure.
3. **Limite de débit : code `LIMITE_DEBIT` (arbitrage du coordinateur).** `DEBIT` est refusé pour une limite de débit : il reste réservé à ce qui facture ou débite. Ces routes ne facturent RIEN (`facturation: null`) ; une limite de débit rend un **`429` avec le code propre `LIMITE_DEBIT`** et `reessayerDans`. Nouveau code à ajouter à la liste fermée du §6 du contrat et à `CODES_ERREUR` du site au lot d'implémentation. Partout où le texte ci-dessous dit « DEBIT » pour une limite, lire `LIMITE_DEBIT`.
4. **Aucune de ces routes ne touche la facturation ni le « sûr »** de l'identification. Si l'éditeur veut un jour lier l'atelier à un quota payant, c'est un autre lot.

## 1. Principes communs (inchangés par rapport à la demande du site)
- Session `rm_session`, `credentials: "include"`, `Origin` + `X-Rat-Market` sur toute écriture. Ordre des refus : `SESSION` → `ORIGINE` → `VERIFICATION` → `LIMITE_DEBIT`.
- Erreurs : la forme `ReponseErreur` du §6 du contrat, `facturation: null`. Nouveaux codes : `INTROUVABLE` (404), `INTERDIT` (403), `FICHIER` (413/415/422), `LIMITE_DEBIT` (429), plus les `detail` listés par le site.
- **404 uniforme** : un objet privé, en attente, refusé, retiré ou absent répond le même `INTROUVABLE` à tout lecteur qui n'en est pas l'auteur (jamais un 403 qui dit qu'il existe).
- CORS : une liste fermée d'origines (celles du site), `Allow-Credentials`, jamais `*` avec les cookies. Le fichier `v2/transport/cors.js` est un chantier en cours : le lot l'étendra APRÈS sa fusion.
- Lectures publiques : sans cookie, `Cache-Control: public, max-age=60` (le délai « 1 h après un lot » du site ne concerne pas ces routes), aucune donnée du lecteur.
- Tout texte libre (titre, étiquette, précision, artiste déclaré) est du **texte brut** : stocké tel quel, borné, jamais interprété ; contrôle de forme à l'entrée (pas de `data:`, pas de caractère de contrôle). Le rendu HTML reste l'affaire du site (échappement).

## 2. Routes et formes
Reprises à l'identique de la demande du site (§2 pseudo, §3 classeurs, §4.3 banque, §4.4 enregistrés, §5 galerie/profils, §6 signalements, §7 modération). **Amendements API** seulement :

### 2.1 Classeurs (§3)
- `PUT /api/classeurs/{id}` : **`version` obligatoire** (comparer-et-écrire atomique, `409 CONFLIT detail "version"` avec `versionActuelle`), corps ≤ 64 Ko vérifié sur `Content-Length` ET sur la longueur lue (flux borné).
- Id de classeur : 128 bits aléatoires (≥ 22 caractères base64url), jamais séquentiel.
- Un classeur `public` modifié repasse `en-attente` ET l'API garde la **dernière version acceptée** (second document), comme le site le propose : c'est ce document qui est servi publiquement jusqu'à la décision.
- Les attributs de filtre de la galerie ne sont indexés que pour les classeurs PUBLICS (demande du site §9.1 point 4, acceptée).
- Une `Cle` dans un classeur n'est PAS vérifiée au catalogue (une fiche disparue reste) ; sa forme l'est (`idInterne|numero`).

### 2.2 Pseudo (§2)
Forme `[a-z0-9_-]{3,20}`, unique (index unique sur la forme normalisée), liste de pseudos réservés tenue par le serveur. Le pseudo est le SEUL identifiant public.

## 3. Authentification, Turnstile, rôles
- **Session du site** pour toute écriture, sauf `POST /api/signalements` (session facultative).
- **Vérification (compte vérifié)** exigée pour : publier, aimer, enregistrer, reprendre, téléverser.
- **Turnstile côté serveur** : obligatoire sur `POST /api/signalements` SANS session. Le jeton est vérifié auprès du fournisseur par `v2/comptes/turnstile.js` (même module que l'inscription), à usage unique ; le jeton n'est **jamais stocké**. Fournisseur injoignable : refus `INDISPONIBLE` (jamais « laisser passer »). Un signalement avec session n'exige pas Turnstile.
- **Rôle `admin`** : posé sur un compte par une opération serveur seule (script d'exploitation, journalisée), **aucune route ne le donne ni ne le retire**. `GET /api/compte` rend `role`. Chaque route d'administration relit le rôle EN BASE à chaque appel (jamais dans le cookie).

## 4. Dépôt des images (R2) — amendement API majeur
La demande du site envoie l'image BRUTE à `POST /api/illustrations` (octets via l'API). **Amendement API : dépôt par URL présignée, en deux temps, les octets du client ne transitent pas par l'API.**
1. `POST /api/illustrations/depot` `{ type: "image/jpeg"|"image/png"|"image/webp", octets: <entier> }` → `201 { depotId, urlDepot, expireDans: 300 }`. Refus avant tout : `octets` > borne (`413 FICHIER trop-lourde`), type hors liste (`415 FICHIER format`), `CONFLIT borne-illustrations` (30 stockées + dépôts en cours), `LIMITE_DEBIT`.
   - `urlDepot` : URL R2 présignée en **PUT**, valable **5 minutes**, **une seule clé** `depot/<ref compte>/<depotId>` dans le bucket privé, avec `Content-Type` et `Content-Length` **signés** (R2 ne propose pas de politique de taille en POST : la taille déclarée est signée, donc exacte, et revérifiée au temps 2).
   - Le préfixe `depot/` porte une **règle de cycle de vie R2 de 24 h** : un dépôt jamais finalisé s'efface seul.
2. `POST /api/illustrations/depot/{depotId}/finaliser` : l'API lit l'objet **depuis R2** (jamais depuis le client), vérifie taille réelle = taille déclarée, **signature binaire du format** (le `Content-Type` du client ne fait pas foi), refuse l'image animée (WebP/PNG animés), **40 Mpx** au plus (lu dans l'en-tête avant décodage, `limitInputPixels` du décodeur), puis **recompresse obligatoirement** : orientation EXIF appliquée, réencodage WebP (2 400 px grand côté, qualité ~82), vignette 480 px, **toutes métadonnées retirées**, couleur dominante. Écrit `prive/<ref compte>/<id>.webp` et `-480.webp`, **supprime l'objet brut**, répond `201 { illustration }` de la demande du site.
   - Refus : `FICHIER` `trop-lourde` / `format` / `trop-de-pixels` / `illisible` / `animee` ; objet brut effacé dans tous les cas de refus.
   - Idempotent par `depotId` (une finalisation rejouée rend la même illustration).
- **Amendement mémoire** : le décodage d'une image de 40 Mpx coûte ~160 Mo en pixels bruts sur un service à 512 Mo. L'API **propose 24 Mpx et 8 Mio** (au lieu de 40 Mpx et 12 Mio), et **une seule finalisation à la fois par instance** (file en mémoire, `INDISPONIBLE` + `reessayerDans` au-delà). Chiffres à confirmer par une mesure du lot ; si l'éditeur tient à 40 Mpx / 12 Mio, il faut un autre hébergement du traitement.
- **Buckets** (demande du site §9) : privé `rat-market-classeurs` (URL signées en lecture, **GET, 1 h**, pour l'auteur et l'admin seulement), public `rat-market-classeurs-public` (copie à l'acceptation, `pub/<id>.webp`). Clés d'écriture limitées à ces deux buckets, jamais la clé des visuels de reconnaissance. CORS du bucket public : lecture depuis les origines du site seulement.
- Aucune image envoyée par un utilisateur ne va en base (règle de l'éditeur du 18/10) : la base garde la référence (clé, dimensions, couleur, poids).
- **Ce que l'API ne fait pas** : récupérer une image à partir d'une URL fournie par l'utilisateur (SSRF), accepter du SVG, du GIF ou tout format hors JPEG/PNG/WebP, conserver l'octet reçu.

## 5. Quotas (par compte et par IP)
Même mécanisme que « Ma collection » (limiteur existant, fenêtre glissante, `429 LIMITE_DEBIT` + `reessayerDans`). Défauts proposés (variables, réglables, posés sans mesure d'usage, comme dans la demande du site) :
| geste | par compte | par IP |
|---|---|---|
| écritures de classeur (`POST`/`PUT`/`DELETE`) | 120 / heure | 300 / heure |
| dépôts d'illustration (`depot`) | 20 / heure, 30 stockées au plus | 40 / heure |
| publications (classeur ou illustration) | 5 / jour (`V2_PUBLICATIONS_JOUR`) | — |
| j'aime / enregistrer | 600 / heure (demande du site) | 1 200 / heure |
| signalements | 30 / jour | **10 / heure** (`V2_SIGNALEMENTS_IP_HEURE`) |
| pseudo (`PUT`) | 5 / jour | 20 / jour |
| lectures publiques | — | 600 / heure |
- **L'IP n'est jamais stockée en clair** : le compteur utilise une empreinte salée (sel tournant), conservée le temps de la fenêtre seulement. Un signalement ne porte pas l'IP de son auteur.
- Bornes de stockage : 20 classeurs, 50 doubles pages, 30 illustrations, **5 000 j'aime et 5 000 enregistrés par compte et par genre** (demande du site §9.1) ; au-delà `CONFLIT borne-…`.

## 6. Les votes (j'aime / enregistrer)
- `PUT /api/classeurs/{id}/jaime` et `…/illustrations/{id}/jaime` (et `DELETE`) : **un seul j'aime par (compte, cible)**, garanti par un **index unique** `{ compte, genre, cible }`. `PUT` répété = `200` sans effet (idempotent) ; `DELETE` d'un j'aime absent = `200` sans effet. Le compteur n'est modifié (`$inc ±1`) **que si la ligne a réellement été créée ou supprimée**, jamais sur un rejeu : pas de dérive par réessai.
- Refusés : voter sur sa propre création (`INTERDIT pas-l-auteur`), voter sur une cible non publique (`404 INTROUVABLE`), voter sans pseudo (`INTERDIT pseudo-requis`).
- Compteur public **arrondi tant qu'il est sous 5** (affiché « < 5 », la valeur exacte reste côté serveur). Le tri `en-ce-moment` (7 jours) se calcule sur les lignes de vote datées.
- Les comptes supprimés emportent leurs votes ; les compteurs sont recalculés par un passage d'exploitation (pas à chaque suppression).

## 7. La modération
- **États** d'une publication (classeur, illustration) : `prive` → `en-attente` → `public` | `refuse` ; `public` → `retire` (par l'admin ou sur signalement) ; `public` modifié → `en-attente` (l'ancienne version acceptée reste servie). L'auteur peut repasser en `prive` à tout moment (retrait de la copie publique).
- **Files** : `publications` (les `en-attente`, plus anciennes d'abord) et `signalements` (échéance **24 h** après réception, affichée) ; les routes de la demande du site §7, avec le rôle `admin` relu en base.
- **Qui modère** : l'éditeur seul au lancement (un ou quelques comptes `admin` posés par script). Aucune auto-modération : un `admin` ne peut pas décider sur sa propre publication (`INTERDIT pas-l-auteur`).
- **Décisions** : `accepter` / `refuser` / `retirer` / `classer`, avec un `motif` de la liste fermée du site (`droits`, `illustration-officielle`, `scan-de-carte`, `choquant`, `donnees-personnelles`, `harcelement`, `hors-sujet`, `autre`). Le motif est écrit sur la cible et montré à l'auteur (exposé des motifs, DSA art. 17). **Accepter** copie l'image vers le bucket public AVANT de passer `public` (la copie échoue : la publication reste `en-attente`, jamais `public` sans fichier).
- **Journal des décisions** (qui, quand, quoi, motif) : append-only, TTL 12 mois.
- **Certification d'auteur** : à la publication, `{ certifieAuteur: true, cgu: <version> }` ; la version des CGU acceptée est stockée avec la date. L'API ne peut PAS vérifier l'originalité : la certification et la modération humaine sont les seuls garde-fous, et le contrat le dit.

## 8. Données personnelles et rétention
| donnée | où | qui la lit | conservation |
|---|---|---|---|
| pseudo | profil | public | jusqu'à suppression du compte |
| classeurs, illustrations (références) | base | auteur ; public si `public` | jusqu'à suppression ou retrait |
| images privées | R2 privé | auteur, admin (URL signée 1 h) | idem ; effacées à la suppression |
| copie publique | R2 public | public | effacée au retrait / à la suppression, **sous 24 h** |
| j'aime / enregistrés | base | l'auteur du vote (liste) ; compteurs agrégés au public | jusqu'à suppression du compte |
| signalement (cible, motif, précision, date) | base | admin | **12 mois**, TTL de base |
| `contact` du signalant (facultatif) | base | admin | 12 mois, puis effacé ; **jamais** repris dans une réponse publique |
| compte du signalant (si connecté) | base | admin | anonymisé à la suppression du compte (le signalement reste) |
| journal des décisions | base | admin | 12 mois |
| IP | compteurs de débit seulement | personne | durée de la fenêtre, empreinte salée |
| jeton Turnstile | nulle part | — | vérifié, jamais stocké |
- Aucune réponse publique ne porte l'adresse, l'identifiant de compte, une date d'inscription, une installation ou un solde ; `auteur.ref` (récidives) n'est servi qu'à l'admin.
- **Suppression du compte** : classeurs, illustrations, votes, enregistrés, pseudo effacés avec leurs objets R2 (copies publiques sous 24 h) ; les reprises d'autrui gardent leurs cartes et lisent `null` pour les illustrations effacées ; les signalements déposés sont anonymisés.
- Les durées sont à reporter dans la politique de confidentialité (déjà demandé par le site).

## 9. Ce que l'API refuse (liste fermée, écrite par ce qu'elle autorise)
- tout octet d'image dans un corps JSON, tout champ texte commençant par `data:` (`400 ENTREE donnee-binaire`) ;
- toute URL d'image fournie par l'utilisateur à récupérer côté serveur ;
- tout format autre que JPEG, PNG, WebP ; toute image animée ; toute image au-dessus des bornes de taille et de pixels ;
- toute écriture sans `Origin` du site, sans `X-Rat-Market`, ou sans session (sauf signalement) ;
- publier sans compte vérifié, sans pseudo, sans certification d'auteur, ou au-delà de 5 par jour ;
- voter plusieurs fois, voter sur sa propre création, voter sur une cible non publique ;
- toute route qui donne ou retire le rôle `admin` ; toute décision de modération par un compte sans le rôle (relu en base) ou sur sa propre publication ;
- modifier un classeur sans la bonne `version` ;
- toute réponse publique qui permettrait de savoir si un objet privé existe (toujours `INTROUVABLE`) ;
- stocker un fichier d'utilisateur en base, l'IP en clair, ou un jeton Turnstile ;
- facturer quoi que ce soit : ces routes ont `facturation: null`.

## 10. Observabilité et exploitation
- Compteurs (sans donnée personnelle) : dépôts, finalisations réussies/refusées par motif, publications, décisions par motif, délai médian de modération, signalements hors échéance de 24 h.
- Alerte d'exploitation si un signalement dépasse **24 h** sans décision.
- Place en base : lecture de la taille réellement comptée par Atlas, alerte au seuil proposé par le site (400 Mo) — voir §0.1.
- Index TTL 12 mois sur `signalements` et `journal-moderation`.

## 11. Découpage proposé du lot d'implémentation (après arbitrage, trois relectures dont sécurité)
1. pseudo + classeurs (CRUD, version, quotas) ; 2. dépôt R2 présigné + finalisation + illustrations ; 3. publication + modération + copie publique ; 4. galerie, banque, profils, filtres ; 5. votes ; 6. signalements (Turnstile) ; 7. suppression de compte étendue ; 8. OpenAPI + `CONTRAT-API-V2.md` + fausses réponses pour le site.
La relecture de sécurité porte en priorité : le dépôt (taille/format/pixels), les URL présignées (durée, clé, en-têtes signés), le rôle `admin`, l'unicité des votes, le 404 uniforme, la rétention.
