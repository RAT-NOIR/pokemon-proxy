# ENTRÉE POUR `DEMANDE-SERVEUR-EXTENSION.md` — le prix par état et par langue est réservé à Pro (PRÉPARÉE, NON DÉPOSÉE)

Critère bloquant n° 5 de l'ouverture de Pro (LISTE-LANCEMENT.md ; contrat §1.5 ; décision de l'éditeur du 08/11). À déposer au moment de l'allumage du drapeau serveur `V2_PRO_PRIX_RESERVE`. L'extension 1.0.5 de production n'est pas concernée (elle ne parle pas à la v2).

## Ce que le serveur change, quand il l'annonce

`GET /ping` annonce le jeton **`prix-pro-reserve`** (dernier de la liste `capacites`) SI ET SEULEMENT SI le serveur applique la réservation. Jeton absent : le serveur sert tout à tous, comme avant.

Jeton annoncé, pour une réponse dont l'offre (`offre.nom`) n'est pas exactement `"pro"` (sans compte, gratuit, abonnement expiré, ou offre illisible : `offre` absente de la réponse) :

| champ | ce que l'extension reçoit |
|---|---|
| `cartes[].etat` / `carte.etat` | **inchangé, toujours servi** : état estimé, confiance, défauts, état retenu. À afficher comme aujourd'hui, pour tous, sans prix. |
| `cartes[].carte.prixGuide` (et celui des impressions et des candidats) | **inchangé** : le prix du guide général (tendance, « De », moyennes), avec la date du guide. |
| `liens.cardmarket` (« Voir le prix ») | **inchangé**. |
| `cartes[].prixLive` | **`null`** (la clé reste). C'est l'instruction « lis le prix de CETTE carte, dans CES langues, à CET état » : sans elle, l'extension **ne lit rien sur Cardmarket** (ni prix par état, ni prix par langue). `prixLive.etatVise` n'est plus servi non plus : l'état à afficher est `etat.retenu`. |
| `cartes[].prixRepli` | **absent** pour les replis `etat-proche` et `fourchette` (guide absent). Le repli `tendance` qui porte une `fourchette` (état non estimable) est **servi sans la `fourchette`** : repli général, même `guide` (sous sa mention d'état non estimable, jamais fiable), causes `etat-non-retenu`, `langue-non-lue`, `lecture-ratee` ou `tendance-seule`. Le repli général `tendance` (sans fourchette ni offre lue) est **conservé** tel quel. Afficher le guide, jamais de fourchette. |
| `POST /api/retour-live` → `prixRepli` | même règle. |
| `POST /api/identifier/reponse`, `POST /api/identifier/mesures`, lot | même règle, carte par carte. |

Pour Pro (`offre.nom === "pro"`) : tout est servi comme avant, octet pour octet.

## Ce que l'extension doit faire

1. **Lire `capacites` dans `/ping`.** Si `prix-pro-reserve` est annoncé ET que `offre.nom !== "pro"` dans la dernière réponse : ne pas attendre de `prixLive` (il vaut `null`), ne pas lire Cardmarket pour un prix par état ou par langue, ne pas envoyer de `retour-live` de prix. Si `offre` est absente de la réponse : traiter comme non-Pro (le serveur ne sait pas, il ne donne pas).
2. **Afficher l'état estimé** (`etat`) exactement comme aujourd'hui : il reste gratuit, définitivement, pour tous. Ne jamais le masquer, ne jamais le conditionner à l'offre.
3. **Afficher le prix du guide** (`prixGuide`, avec sa date et ses réserves) et le lien « Voir le prix ». Si un repli `tendance` est servi, l'afficher comme avant (c'est le guide du jour).
4. **Proposer Pro** à la place du prix lu en direct : une ligne « Prix selon l'état et la langue : Pro » (texte à fixer par l'éditeur), qui renvoie vers l'offre sur le site. Pas de prix inventé, pas de fourchette calculée côté client.
5. **Un `prixLive` non nul chez un non-Pro ne doit pas arriver** : si le jeton est annoncé et que `prixLive` est un objet alors que l'offre n'est pas Pro, c'est un défaut serveur ; l'extension n'affiche rien de plus et le signale (journal), sans lire Cardmarket.
6. **Quota** : l'extension n'a rien à faire, et surtout n'a PAS à envoyer de `lectureRatee` pour obtenir un remboursement. Le serveur décide seul, à partir de ce qu'il sert :
   - un gratuit dont le guide est servi (même sous la mention d'état non estimable) garde un repli général : son scan COMPTE, comme celui de Pro ; une lecture ratée définitive n'est pas remboursée ;
   - un non-Pro dont AUCUN prix n'est servi (pas de `prixGuide`, pas de repli général, et plus de `prixLive`) : le scan est RENDU par le serveur dans la réponse même de `POST /api/identifier` (carte unique : `facturation { debite: 0, rembourse: true, motif: "sans-prix" }`) ou du lot (LOT-SANS-PRIX). Afficher « aucun prix disponible », sans rien envoyer de plus ;
   - un `POST /api/retour-live` envoyé malgré tout après ce remboursement trouve le scan déjà rendu (`raisonNonRembourse: "deja-rembourse"`, `debite: 0`) : jamais de double remboursement ; un rejeu de la même requête rend la même réponse sans rembourser une seconde fois ;
   - la réponse à une QUESTION (`POST /api/identifier/reponse`) dont le candidat tranché n'a aucun prix pour un non-Pro : le serveur rend le crédit confirmé dans cette réponse (`facturation { debite: 0, rembourse: true, motif: "sans-prix" }`, compteur des déclarations du jour) ; rejouer la même réponse redit « rendu », un seul remboursement ; une question de LOT ne rend rien par cette route ; l'historique du compte ne porte aucun champ de prix.

## Cas limites que l'extension rencontrera

- **Un rejeu** (même `Idempotency-Key`) suit l'offre ACTUELLE : abonnement expiré entre-temps, le rejeu ne porte plus de prix par état ; passé à Pro, il le porte. Exception : un lot et un `retour-live` rejouent la réponse qui a été servie (leur décision d'argent en a dépendu), seulement amputée si l'offre a baissé.
- **Une offre illisible** (erreur de lecture côté serveur) donne la réponse du gratuit : jamais un prix par défaut.
- Retirer `prixLive` retire aussi l'instruction de lire la LANGUE (pas seulement l'état) : un non-Pro n'a plus de prix par langue.

## Bancs

`v2/test/test-offre-prix-reserve-pro.js` (les six conditions du critère n° 5, vrais routeurs) ; mutations : `v2/mesures/mutations-prix-reserve-pro.js`.
