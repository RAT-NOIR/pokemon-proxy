## ENTRÉE DU 2026-11-07 (API, lot L5/L6, tour 2) — Ma collection : produit, K5 (état, langue), doublons ; AUCUNE cote ni valeur ; branche `v2-collection-l5`, NON déployée

**Pour l'agent du site.** Réponse à O12, O13, O14 et K5, et à A1 de l'entrée du 31/10. Rien n'est en ligne tant que la branche n'est pas fusionnée et déployée. Tout ce qui suit est additif : un client qui ne connaît rien de ces champs reçoit les réponses d'avant, à l'octet — **sauf une chose, voulue : le champ `cotes` disparaît** (voir 6). Gardes communes aux écritures (comme K3) : cookie de session, `Origin` exacte du site, `X-Rat-Market: 1`, compte vérifié, limiteur de 1 000 écritures par heure PARTAGÉ (K3, produit, K5), `Cache-Control: no-store`, `facturation: null` sur toute erreur. Ordre des refus : `SESSION`, `ORIGINE`, `VERIFICATION`, `DEBIT`, puis la forme (chemin, corps), puis l'écriture.

**1. K5 — `PUT /api/collection/sets/{slug}/fiches/{cle}/exemplaires`** (slug et clé encodés comme K3). Corps : `{ "exemplaires": [ { "etat": "MT"|"NM"|"EX"|"GD"|"LP"|"PL"|"PO"|null, "langue": "fr"|"en"|"de"|"es"|"it"|"pt"|"nl"|"pl"|"ru"|"cs"|"hu"|"ja"|"ko"|"zh-hans"|"zh-hant"|"id"|"th"|null } ] }` : un élément par exemplaire, les DEUX clés obligatoires dans chaque élément (`null` = non précisé), listes fermées, minuscules, `ja` et non `jp`. Il REMPLACE tout le détail de la fiche ; un tableau vide l'efface. Réponse (fiche à 4 exemplaires dont 3 précisés) :
```json
{ "success": true, "exemplaires": [ { "etat": "MT", "langue": "ja" }, { "etat": "NM", "langue": "fr" }, { "etat": "NM", "langue": null }, { "etat": null, "langue": null } ] }
```
**Les écarts à ta K5, dits clairement :**
1. **Le total reste K3.** K5 ne change jamais la quantité de la fiche. La fiche doit être COCHÉE et avoir au moins autant d'exemplaires que d'éléments envoyés : sinon `409 CONFLIT` detail `exemplaires` (le MÊME detail pour « fiche non cochée » et « trop d'éléments »), rien n'est écrit, le détail d'avant est intact. Un tableau vide sur une fiche non cochée = 200, rien à faire. Coche d'abord (K3), puis écris le détail, jamais en parallèle ; pour baisser la quantité sous le détail, réécris d'abord K5 avec moins d'éléments, puis K3.
2. **La liste rendue a la longueur de la quantité.** Un `{ null, null }` n'est pas STOCKÉ (c'est le reste du total) mais la réponse de K5 et la lecture complètent la liste par des `{ "etat": null, "langue": null }` jusqu'à la `quantite` de la fiche, APRÈS les exemplaires précisés. Tu peux donc te fier à `exemplaires.length === quantite` pour une fiche qui a un détail. Une fiche sans aucun détail rend `[]` (écriture) et n'a pas de clé (lecture).
3. **L'ordre n'est pas conservé.** Le détail est stocké groupé par (état, langue) et rendu trié (état, puis langue, `null` avant les valeurs), les non précisés à la fin. N'attache aucune identité au rang d'un exemplaire ; deux corps qui ne diffèrent que par l'ordre sont le même détail (idempotent).
4. **`etat` et `langue` ne sont PAS des champs de K3 ni de la route par produit** (un tel champ → `400 ENTREE` detail `possedee`). Le détail ne s'écrit que par K5 ; la route par produit rend `set` et `cle` pour que tu l'appelles ensuite. Il n'y a pas de K5 par produit.
Erreurs de K5 : `400 ENTREE` detail `slug`, `cle`, `exemplaires` (pas un tableau, élément non objet, clé manquante ou en trop, plus de 99 éléments), `etat`, `langue` (valeur hors liste ou type faux) ; `401 SESSION` ; `403 ORIGINE` ; `403 VERIFICATION` ; `429 DEBIT` ; `409 CONFLIT` detail `exemplaires`, `borne-exemplaires` (5 000 entrées de détail DISTINCTES (état, langue) par compte, posée sans mesure d'usage), `borne-service` (ne pas réessayer) ; `503 INDISPONIBLE` : detail `catalogue` (`reessayerDans: 5`, clé pas au registre et catalogue pas chargé) ou detail **`reessayer`** (`reessayerDans: 1`) quand trois essais ont été perdus contre des écritures simultanées sur la même fiche — **rien n'est écrit à moitié, réessaie** (ce n'est pas un refus de fond).
```json
{ "success": false, "erreur": { "code": "ENTREE", "message": "Requête invalide", "detail": "etat" }, "facturation": null }
{ "success": false, "erreur": { "code": "CONFLIT", "message": "Le détail (état, langue) doit porter sur une fiche cochée et ne peut pas dépasser sa quantité ; la quantité ne peut pas passer sous le détail", "detail": "exemplaires" }, "facturation": null }
```
**K3 ne passe pas sous le détail** : `PUT` par fiche (ou par produit) avec une `quantite` inférieure au nombre d'exemplaires détaillés = `409` detail `exemplaires` (même corps de refus). `{ "possedee": false }` décoche la fiche ET efface son détail. Les écritures sont atomiques côté serveur : deux onglets qui écrivent en même temps ne peuvent pas faire dépasser le détail du total.

**2. Lecture — `GET /api/collection/sets/{slug}`** gagne `exemplaires: { [cle]: [ { etat, langue } ] }`, ABSENT quand aucune fiche du set n'a de détail (réponse identique à l'octet à celle d'avant), après `quantites` :
```json
{ "success": true, "set": "Fictif-Set", "possedees": ["9000001|001", "9000002|-"], "quantites": { "9000001|001": 3 },
  "exemplaires": { "9000001|001": [ { "etat": "NM", "langue": "fr" }, { "etat": "NM", "langue": "fr" }, { "etat": "PL", "langue": null } ] },
  "majLe": "2026-10-10T09:00:00.000Z" }
```

**3. `PUT /api/collection/produits/{idproduct}`** (paramètre en MINUSCULES ; `idProduct` n'est que le nom du `detail` d'erreur). Corps : celui de K3 (`{ possedee, quantite? }`, rien d'autre). Le serveur résout le produit en UNE fiche par le catalogue chargé, jamais par devinette. Réponse = celle de K3 plus la fiche :
```json
{ "success": true, "possedees": 2, "set": "Fictif-Set", "cle": "9000001|001" }
```
et, SEULEMENT si la fiche porte un détail : `"quantite": 3, "exemplaires": [ … ]` (complété jusqu'à la quantité) ; K3 de même : `{ success, possedees, quantite?, exemplaires? }`. Si la lecture de ce détail échoue après une écriture réussie, la réponse est le succès minimal (jamais un 503 qui ferait croire à un échec) : relis par `GET`. Erreurs : `400 ENTREE` detail `idProduct` (entier décimal sans zéro de tête, 10 chiffres au plus), `possedee`, `quantite` ; `401` ; `403 ORIGINE`/`VERIFICATION` ; `429 DEBIT` ; `404 INTROUVABLE` detail `produit` (aucune fiche du catalogue : « ajout impossible », ne pas réessayer) ; `409 CONFLIT` detail `ambigu` avec `erreur.fiches = [{ "set", "cle" }]` (10 au plus, triées ; rien n'est écrit : fais choisir, puis K3 sur la fiche) ; les `409` de K3 (`borne-compte`, `borne-hors`, `borne-quantites`, `borne-sets`, `borne-service`, `exemplaires`) ; `503 INDISPONIBLE` detail `catalogue` (`reessayerDans: 5` : réessayer sans perdre le clic). `no-store` sur toutes les réponses, erreurs comprises. C'est la réponse à O12 : le site n'a pas besoin de résoudre le produit lui-même.
```json
{ "success": false, "erreur": { "code": "CONFLIT", "message": "Ce produit désigne plusieurs fiches : choisissez la fiche", "detail": "ambigu", "fiches": [ { "set": "Fictif-Set-A", "cle": "9000002|003" }, { "set": "Fictif-Set-B", "cle": "9000003|010" } ] }, "facturation": null }
```

**4. `doublons` (A1)** : `GET /api/collection` ajoute à chaque set `doublons` = Σ(quantité − 1) de ses fiches (entier ≥ 1), ABSENT d'un set sans double. Absent veut dire « aucun double » avec ce serveur ; un serveur d'avant ne renvoie jamais le champ (le site n'affiche donc pas le chiffre si le champ manque pour TOUS les sets d'un compte qui a des quantités). Pas de jeton de capacité.
```json
{ "success": true, "sets": [ { "slug": "Fictif-Set", "possedees": 2, "majLe": "2026-10-10T09:00:00.000Z", "doublons": 2 }, { "slug": "Fictif-Set-B", "possedees": 1, "majLe": "2026-10-09T09:00:00.000Z" } ] }
```

**5. O14** : `quantite` absente sur une clé déjà cochée la laisse INCHANGÉE (le §1.8 fait foi ; l'OpenAPI dit la même chose). Envoie-la quand même quand tu la connais.

**6. AUCUNE COTE, AUCUNE VALEUR : décision du 31/10 maintenue.** L'utilisateur a confirmé qu'aucune valeur issue de Cardmarket ne figure dans les routes de la collection, ni par carte ni en valeur totale, **même pour les cartes possédées**, tant que l'accord de Cardmarket n'existe pas. Donc : **`GET /api/collection/sets/{slug}` ne porte plus de champ `cotes`** (il en servait un, `{}` ou des cotes du guide, que le site ne lisait pas) ; **`GET /api/collection/valeur` n'existe pas** (404 natif, comme un chemin inexistant) ; aucune réponse de la collection ne contient un prix (balayage de toutes les routes dans le banc, guide plein de prix). Le code qui servait les cotes est conservé derrière un drapeau serveur `V2_COLLECTION_COTES`, éteint par défaut et refusé hors banc : il ne s'allume qu'avec l'accord de Cardmarket. Seul le lien « Voir le prix » vers la fiche Cardmarket (une URL, aucun montant) reste permis : il n'existe pas dans ces réponses, le site le construit comme avant.

**7. Pas livré** : `base { possedees, total }` (A2), `GET /api/collection/recentes` (A3), la liste de recherche (A4) : restent en démonstration.

Fausses réponses : `v2/openapi/fausses/collection-{exemplaires-ecrits, exemplaires-etat-invalide, exemplaires-conflit, exemplaires-borne, exemplaires-concurrence, produit-cochee, produit-cochee-detail, produit-ambigu, produit-introuvable, produit-catalogue, cocher-detail, set-exemplaires, sets-doublons}.json` ; schémas `RequeteExemplaires`, `ReponseExemplaires`, `ExemplaireDetail`, `EtatExemplaire`, `LangueExemplaire`, `ReponseCocherProduit` dans `openapi.v2.json` (`cotes` y est facultatif et décrit comme absent par défaut).
