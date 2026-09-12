# Spécification de collecte — texte Bulbapedia, 28 sets vintage d'abord (2026-09-12)

> 🔴 **AGENT SERVEUR, AVANT TOUT — deux règles qui priment sur le reste du fichier.**
> 1. **PREMIER JET SUR EXP SEUL** : `--set=EXP`, 102 pages, puis ARRÊT après l'impression des quatre
>    nombres de complétude (§8 bis). Aucun autre set ne tourne avant relecture du testeur.
> 2. **QUATRE ARRÊTS DURS AVANT TOUTE ÉCRITURE** (§2), chacun `process.exit(1)` : base ≠ `cartes` ;
>    `MONGODB_CARTES_URI` absent **ou ÉGAL à `MONGODB_URI`** (notre cluster de production, 61 Mo de
>    marge) ; base connectée ≠ `cartes` ; cluster portant `test` ou `test_scratch`.
> Les prérequis (projet Atlas `rat-market-cartes`, bucket R2, variables) sont créés par le testeur,
> pas par l'agent : s'ils manquent, on s'arrête, on ne les crée pas.

Pour l'agent serveur. Rien ici n'est codé ; tout est à exécuter tel quel. Le schéma est celui de la
cible TOTALE (toute carte existant chez Bulbapedia) dès le premier set : on ne migre pas 69 598 lignes
pour un champ oublié.

## 0. Fait mesuré : Bulbapedia n'est PAS une source d'images

Relevé du 2026-09-12 sur `api.php` de Bulbapedia, 36 requêtes à 5 s d'intervalle, `prop=links` puis
`prop=images` puis `prop=imageinfo`, aucun téléchargement :

| set | pages de cartes | image du tirage ANGLAIS jumeau | image nommée JAPONAISE |
|---|---|---|---|
| EXP « Expansion Pack (TCG) » | 102 | 102, de 300 à 915 px | **2** (768 et 2 943 px) |
| PJU « Pokémon Jungle (TCG) » | 48 | 48, 350×495 | **0** |
| MFO « Mystery of the Fossils (TCG) » | 47 | 47, 350×495 | **0** |

2 visuels japonais sur 197 pages ; le tirage anglais est à 350 px sur deux sets, sous les 600×825
retenus. Bulbapedia sert le TEXTE, pas les images, ni japonaises ni occidentales. Que TCG Collector
cite cinq sources d'images dit d'où viennent les siennes, pas ce qu'on a le droit d'en faire.

## 1. Schéma — base `cartes`, deux collections plus deux tables de travail

```js
// sets — une ligne par set, ÉCRITE À LA MAIN (voir §4)
{
  _id: 'expansion-pack',                 // slug stable
  code: 'EXP',                           // code Cardmarket (sets-vintage-japonais.js)
  idExpansion: [4169],                   // TABLEAU : EXS recouvre 3 séries sous 1 expansion
  nomEn, nomJa, nomFr, region: 'jp'|'intl', serie, dateSortie, annee,
  totalImprime,                          // infobox du set, paramètre `cards`
  bulba: { titre: 'Expansion Pack (TCG)', pageid, revid,
           motifTitres: '\\((Base Set) \\d+\\)$' },   // motif des titres de cartes liés
  complet: { infobox, pagesLiees, cartesEcrites, produits, joints, restes, verifieLe },
  version: 1
}
// cartes — une ligne par PAGE Bulbapedia (tous tirages fusionnés)
{
  _id: 'base-set/044' | 'expansion-pack/bulbasaur',   // set/numéro, sinon set/nom
  nomEn, nomJa, nomFr,
  categorie: 'pokemon'|'dresseur'|'energie',
  type, pv, stade, ndex, rarete, illustrateur,
  attaques: [{ nom, nomJa, cout, degats }],            // JAMAIS d'effet
  faiblesse, resistance, retraite,
  impressions: [{ tirage: 'intl'|'jp', set, numero, total, rarete }],
  liens: { idProduct: [], idMetacard: null },          // copie dénormalisée de cartes_produits
  bulba: { titre, pageid, revid, redirigeDepuis: [] }, // Jungle 1 -> Jungle 17 : UNE carte
  image: null,                                         // dette, §7
  version: 1
}
// cartes_produits — la jointure n-n, une ligne par (carte, produit), avec sa preuve
{ carteId, idProduct, idExpansion, tirage, preuve: 'set+numero'|'set+nom+attaques'|'manuel', verifieLe }
// restes — listés, JAMAIS résolus automatiquement
{ set, type: 'produit-sans-carte'|'carte-sans-produit'|'produit-vers-plusieurs-cartes', idProduct, carteId, detail }
// collecte_etat — reprise
{ set, phase: 'liens'|'texte'|'jointure'|'verifie', pages: [{ titre, pageid, revid, etat }], requetes, debute, fini }
```

## 2. Où vit la base — et les prérequis que le TESTEUR crée (pas l'agent)

Second cluster Atlas **M0, projet séparé**, base `cartes`. Notre cluster `test` est à 451 Mo sur 512,
il n'a que 61 Mo de marge : on n'y écrit rien.

**À créer par le testeur, avant toute exécution :**

| quoi | valeur |
|---|---|
| Atlas : projet | `rat-market-cartes` (nouveau projet, pas une base de plus dans l'ancien) |
| Atlas : cluster | `cartes0`, palier M0, AWS `eu-central-1` Francfort (ou `eu-west-1` si M0 n'y est pas proposé) |
| Atlas : utilisateurs | `collecteur` (readWrite sur `cartes` seulement) · `lecteur` (read seulement, pour le site et l'API) |
| Atlas : réseau | `0.0.0.0/0` (Render et Vercel n'ont pas d'IP fixe) — la sécurité est le mot de passe, pas l'IP |
| `.env` pokemon-proxy | `MONGODB_CARTES_URI=mongodb+srv://collecteur:<mdp>@cartes0.<id>.mongodb.net/cartes?retryWrites=true&w=majority` |
| `.env` pokemon-proxy | `MONGODB_CARTES_BASE=cartes` |
| Cloudflare R2 : bucket | `rat-market-cartes-brut`, juridiction EU, **accès public désactivé** |
| R2 : jeton | « Object Read & Write », restreint à ce seul bucket |
| `.env` pokemon-proxy | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_BRUT=rat-market-cartes-brut` |
| R2 : accès | API S3, endpoint `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`, région `auto`, client `@aws-sdk/client-s3` |

Le bucket d'images publiques n'est pas créé aujourd'hui : il n'y a rien à y mettre (§10).

**La garde est un REFUS DUR, jamais un `if` silencieux.** Quatre arrêts, chacun `process.exit(1)`
avant toute écriture :

```js
const uri = process.env.MONGODB_CARTES_URI, base = process.env.MONGODB_CARTES_BASE;
if (base !== 'cartes')                       { console.error('ARRÊT : MONGODB_CARTES_BASE doit valoir "cartes"'); process.exit(1); }
if (!uri || uri === process.env.MONGODB_URI) { console.error('ARRÊT : MONGODB_CARTES_URI absent ou ÉGAL au cluster de production'); process.exit(1); }
await mongoose.connect(uri, { dbName: 'cartes' });
if (mongoose.connection.db.databaseName !== 'cartes') { console.error('ARRÊT : base connectée ≠ cartes'); await mongoose.disconnect(); process.exit(1); }
// empreinte de la production : si ce cluster héberge numeros_cartes ou references_image, ce n'est PAS le bon
const noms = (await mongoose.connection.db.admin().listDatabases()).databases.map(d => d.name);
if (noms.includes('test') || noms.includes('test_scratch')) { console.error('ARRÊT : ce cluster porte la production'); await mongoose.disconnect(); process.exit(1); }
```

## 3. Le wikitext sur R2 — l'assurance contre le champ oublié

Chaque page est archivée sous `bulba/<pageid>/<revid>.wikitext`, et reparsée depuis là, jamais
refetchée. ⚠️ Conformité (§6) : le wikitext est archivé **épuré** — paramètres `effect=` et `jtrans=`
vidés, prose hors gabarits supprimée — avant écriture. Les faits restent tous reparsables.

## 4. La table set → `idExpansion`, à la main

28 lignes, une par set de `SETS_VINTAGE_JAPONAIS` : `code`, `exp`, titre de la page Bulbapedia, motif
des titres de cartes, `cards` attendu. La liaison automatique a été mesurée : 2 appariements sur 177,
les deux faux. Chaque ligne est contrôlée par le compte (§8) avant d'être admise.

## 5. Débit et accès

`https://bulbapedia.bulbagarden.net/w/api.php`, `format=json&formatversion=2&maxlag=5`.
User-Agent `rat-market-collecte/0.1 (https://rat-market.fr ; contact)`. **Une requête toutes les 5 s,
jamais en parallèle**, un seul réessai après 5 s sur `maxlag`. Jamais l'`api.php` des Archives
(`robots.txt` : `Disallow: /w/`). Aucun téléchargement d'image dans cette phase.

## 6. Conformité — ne pas stocker ce qu'on ne publiera pas

Collectés : numéro, total, dates, noms EN/JA/FR, illustrateur, PV, type, stade, rareté, n° Pokédex,
noms d'attaques, coûts, dégâts, faiblesse, résistance, retraite, appartenance au set. **Ni effet, ni
prose, ni `jtrans`, ni trivia : ni collectés, ni stockés, nulle part.** Attribution : page « Sources »
du site nommant Bulbapedia (CC BY-NC-SA 2.5, « données factuelles, aucun texte repris ») et lien vers
la page source en pied de fiche.

## 7. Procédure, par set

1. `prop=revisions` sur la page du set → `cards` de l'infobox, archivage.
2. `prop=links&plnamespace=0&pllimit=max&redirects=1` → titres filtrés par `motifTitres`.
3. `prop=revisions&rvprop=content|ids&rvslots=main&redirects=1`, 50 titres par requête → R2 (épuré).
   Les redirections fusionnent : une page cible = UNE carte, sources dans `redirigeDepuis`.
4. Parse des gabarits `PokémoncardInfobox` et entrées `/Expansion`, `Cardtext/Attack` (nom, jname,
   cost, damage seulement), `Carddex` (ndex), `TrainercardInfobox`, `EnergycardInfobox`.
5. Jointure n-n : par entrée d'impression, expansion → `idExpansion` (table §4) ; numérotée →
   TOUS les produits `numeros_cartes` de ce numéro (V1…V6 s'attachent, `variante` non résolue) ;
   non numérotée → (idExpansion, nom EN normalisé, ensemble des noms d'attaques) contre
   `catalogue_produits.name` « Nom [Attaque | Attaque] ». Une ligne `cartes_produits` par couple.
   Restes écrits dans `restes`, jamais résolus par le code.
6. Reprise : upsert par `pageid` ; page sautée si `revid` inchangé ; aucun document partiel.

## 8. Complétude — trois comptes concordants

Un set est `complet` quand `cards` de l'infobox = pages distinctes après redirections = cartes
écrites, ET produits de l'expansion dans `numeros_cartes` = joints + restes. Les quatre nombres sont
imprimés, dénominateur en tête.

## 8 bis. 🔴 PREMIER JET SUR UN SEUL SET, puis ARRÊT

Le collecteur prend `--set=EXP` et refuse de tourner sans `--set=` tant que le testeur n'a pas
validé. Sur EXP (102 pages, 102 produits, ~6 requêtes, ~30 s) il imprime :

1. les quatre nombres de complétude (§8) : infobox · pages distinctes · cartes écrites · produits =
   joints + restes ;
2. les restes, un par ligne, avec leur type ;
3. **cinq cartes parsées au hasard, champ par champ**, à côté de leur wikitext épuré — c'est là
   qu'un défaut de parse se voit ;
4. le compte des champs NULS par champ sur les 102 (dénominateur : 102) — un `illustrateur` nul
   sur 102 est une lecture à revoir, pas une absence.

Puis il s'arrête. Rien d'autre ne tourne avant relecture du testeur. Raison : un défaut de parse vu
au 28e set ferait reparser 2 000 pages ; R2 le rend possible, autant ne pas en avoir besoin.

## 9. 🔴 Chiffres attendus — s'il obtient autre chose, il annule

- 28 sets, **~2 000 pages**, **~100 requêtes**, **~10 minutes**.
- EXP : 102 pages, 102 produits. PJU : 48 pages, 48 produits. MFO : **47 pages liées pour 48
  attendues** — un reste à NOMMER, pas à corriger.
- Sortie obligatoire : cartes écrites, produits joints, restes par type et par set.

## 10. Les images, dette écrite

Seules voies propres aujourd'hui : le scan par l'utilisateur (~2 100 cartes sur les 28 sets), ou un
accord — Pokumon est le seul candidat à DEMANDER, et un accord se demande, il ne se suppose jamais.
Le catalogue s'indexe sans image : symbole du set et mention « visuel du tirage japonais non
disponible ». Jamais le tirage occidental à la place — un visuel faux vaut moins que pas de visuel.
