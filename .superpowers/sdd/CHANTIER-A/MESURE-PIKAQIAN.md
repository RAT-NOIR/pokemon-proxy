# MESURE PIKAQIAN — étape 1 (aucune collecte, aucune écriture) — 2026-10-10

Instrument : `collecte-cartes/mesure-pikaqian-requete.js` (GET, `redirect: 'manual'`, UA du dépôt `rat-market-catalogue/1.0`, ≥ 10,5 s entre deux requêtes, plafond 40, refuse `/api/`),
lectures locales `mesure-pikaqian-{texte,extrait,set,image,apparier,couverture,trous}.js`, lecture seule de la base `mesure-pikaqian-base.js` (`find` uniquement, `ouvrirConnexions`).
Journal brut avec en-têtes : `pikaqian-journal.jsonl` (même dossier).

## Conclusion

**COLLECTABLE sous la règle du testeur** (aucune condition publiée qui exige un accord ; aucun défi ; robots.txt ne ferme que `/api/`), avec UNE réserve à trancher par le testeur : les images
sont des copies des visuels officiels de pokemon.cn (champ `native_image_url` = `cdn.pokemon-tcg.cn`, que le §78 range sous des conditions « copie interdite sans accord écrit »).

## Requêtes (UTC, 2026-10-10) — 15 au total : pikaqian.com 12, images.pikaqian.com 3, aucun autre hôte, aucun `/api/`
| heure | URL | statut |
|---|---|---|
| 11:28:21 | /robots.txt | 200 |
| 11:28:31 | / | 200 |
| 11:28:42 | /about | 200 |
| 11:28:59 | /pricing | 200 |
| 11:29:09 | /sitemap.xml | 200 |
| 11:29:20 | /sets | 200 |
| 11:29:30 | /sets/csv10c | 200 |
| 11:29:50 | /cards/1c36d2d5-3931-4112-86f4-06e158af3fe0 | 200 |
| 11:30:07 | /sitemap-pages.xml | 200 |
| 11:30:18 | /docs/sitemap.xml | 200 |
| 11:30:54 | images.pikaqian.com/csv10c/612bd7d7-….webp | 200 |
| 11:31:05 | images.pikaqian.com/csv10c/1c36d2d5-….webp | 200 |
| 11:31:15 | images.pikaqian.com/csv10c/9e75f30a-….webp | 200 |
| 11:39:20 | /sets/cs1bc | 200 |
| 11:39:30 | /sets/151c | 200 |

## 1. robots.txt
`User-agent: *` / `Disallow: /api/, /admin/, /auth/, /login, /logout, /currency` / `Sitemap: https://pikaqian.com/sitemap.xml`. Pas de Crawl-delay (10 s tenu quand même). `/sets/…` et `/cards/…` ne sont pas interdits.

## 2. Conditions d'utilisation
**Aucune page de conditions ni mention légale n'existe** : pied de page = Home / Sets / Search / Contact Us / Discord / `admin@pikaqian.com` ; `sitemap-pages.xml` : seule page de ce type `/about` (« Contact Us ») ;
le seul passage de pied de page : « We are free, supported by our users. We earn an affiliate commission on any eBay links. » Rien sur la copie ni la réutilisation. 🕳️ Pas d'interdiction ≠ licence : à tenir pour ce que c'est.
Fait noté : le site vend une API (`/pricing` : palier Free « Card & set images » 500 req/mois, compte requis ; usage commercial = palier Pro 60 $/mois). Ce canal exige un compte : **écarté, non utilisé**.

## 3. Protection
`server: cloudflare` sur le site, mais aucun `cf-mitigated`, aucune page de défi, 15 réponses 200. Images : `server: AmazonS3`, `via CloudFront`, `cache-control: public, max-age=15552000`. Pas de `x-cdn` Imperva. **Pas de défi.**

## 4. Forme des pages : le HTML servi PORTE les données (rendu serveur, pas d'`/api/`)
* **Page de set** `/sets/<code minuscule>` : UNE requête rend toutes les cartes du set (csv10c : 683 tuiles, 1,5 Mo). Tuile :
  `<a href="/cards/<uuid>"> … <img alt="Shaymin Master Ball Holo" src="https://images.pikaqian.com/csv10c/<uuid>.webp"> … <h2>Shaymin Master Ball Holo</h2><p class="font-mono …">csv10c<!-- --> · 007</p>`
  → nom (`h2`/`alt`), code de set et numéro (`<p>` « csv10c · 007 »), adresse d'image (`img src`).
* **Page de carte** `/cards/<uuid>` : titre « Shaymin Master Ball Holo #007 Price | Chasing Glory Together », nom chinois, `csv10c · 007`, et le flux Remix embarqué (`window.__remixContext`) porte `card_set_id`, `card_number "007"`,
  `foiliness "masterball"`, `rarity`, `native_pokemon_name "谢米"`, `english_card_name`, `base_card_id`, `native_image_url`. La page de set suffit : la page de carte n'apporte que la preuve par `foiliness`/`base_card_id`.
* Variante : une tuile par (numéro × foil) — csv10c : base + « Pokeball Holo » + « Master Ball Holo » ; cs1bc : base + « Reverse Holo » ; 151c : base + Pokeball + Master Ball.
  Notre catalogue (une ligne Cardmarket par numéro) ne correspond qu'à la tuile SANS suffixe de foil.

## 5. Les images
`https://images.pikaqian.com/<code>/<uuid>.webp`, WebP, **300 × 419 px**, 30–35 Ko, trois sur trois. Ouvertes et regardées (PNG converti localement) : Annihilape csv10c 100 (弃世猴, texte chinois net, « 100/222 », © 2026 Pokémon/Nintendo/Creatures/GAME FREAK),
Shaymin Master Ball 007 (谢米, motif Master Ball visible), Primeape Master Ball 099 (火暴猴). **Ce sont des scans de la carte chinoise imprimée, texte lisible.**
⚠️ 300 px de large < seuil de 350 px des collecteurs d'images (§23) : un collecteur dédié devrait porter son propre minimum, justifié par cet usage (vignette 157 px), pas un seuil abaissé « pour les faire passer ».
Une clé `originals/<code>/<uuid>.png` existe dans le flux de page mais n'est liée nulle part : non touchée.

## 6. Appariement à nos trous (3 sets, base `cartes`/`test` en lecture seule)
pikaqian écrit le code de set comme le nôtre en minuscules (`CSV10C` → `csv10c`, `CS1bC` → `cs1bc`, `151C` → `151c`, `CSM2.5C` → `csm2.5c`) ; promos : `SV-P/CS` → `promo-sv-p` (idem s-p, sm-p, m-p, 30th-p).
Preuve exigée : set + numéro + variante (seule la tuile sans suffixe de foil est candidate) + nom + une seule candidate :
| set | nos produits sans visuel | tuiles pikaqian | numéros distincts pikaqian | appariés | reste |
|---|---|---|---|---|---|
| CSV10C Chasing Glory Together | 287 | 683 | 287 | **284** | 3 : nom différent (Emcee's Hype / « Iris's Fighting Spirit » ; Spikemuth / « Spikemuth Gym » ; Team Rocket's Energy / « Team Rocket Energy ») |
| CS1bC Dynamax Clash Flame | 199 | 315 | 199 | **199** | 0 |
| 151C Collect 151 | 192 | 470 | 192 | **192** | 0 |
Total échantillon : **675 / 678** (99,6 %), 0 numéro sans tuile, 0 base ambiguë, 0 numéro en double chez nous. Les 3 restes restent des trous (le doute est un trou) : numéro et set concordent, c'est le nom (traduction) qui diffère.

## 7. Le compte
Dénominateur : **12 074 produits Cardmarket zh-hans** (95 sets `tirage: zh-hans`, hors cartes-code) dont **0 avec visuel du tirage** (cohérent avec §78 : 0 sur 12 083) ; 10 879 ont une fiche.
* Sets dont le code a une page pikaqian : **91 sur 95 = 11 520 produits** (95,4 %). Sans page : CSMPC (315), CSVM1C (97), CSVM2 (97), 30thDC (45) = 554 produits → restent des trous nommés.
* Appariement mesuré sur 3 sets représentatifs (modernes, SwSh, 151) : 99,6 %. Extrapolation honnête : **≈ 11 400 à 11 520 comblables sur 12 074 (≈ 94–95 %)**, borne haute 11 520. C'est une ESTIMATION : 3 sets sur 91 sont mesurés, 88 ne le sont pas.
* Non mesurés, risque plus élevé : promos (`promo-*`, numérotation propre), coffrets, Starter Decks CSM1DC/CSM2DC (357 et 336 produits), sets Happy Set / Gem Pack.
* Restes connus : 554 sans page + ~0,4 % de noms divergents + les non mesurés.

## Forme d'un collecteur (si le testeur confirme la réserve ci-dessus)
Pages : 91 pages de set (une requête chacune) + 1 image par produit apparié ; preuve : set + numéro + tuile sans suffixe de foil unique + nom concordant, sinon trou ; cadence 1 req / 10 s, UA du dépôt, `redirect: 'manual'`, jamais `/api/`.
Requêtes ≈ 91 + 11 500 images ≈ 11 600 → ≈ 32 h de cadence pure. Chaque visuel : source `pikaqian`, mention « © Pokémon / The Pokémon Company », lot retirable en un geste ; écriture dans `cartes` (jamais `test`), `langue: 'zh-hans'`.

## Non mesuré
Conditions d'un site qui n'en publie pas (impossible de citer un passage) ; rôle de pokemon.cn comme origine (non vérifié chez eux, §78 le dit) ; les 88 autres sets ; les promos/coffrets ; la fraîcheur (images datées du 14 juillet 2026) ;
l'égalité exacte de l'illustration entre une tuile et notre tirage (preuve par numéro et nom, pas par l'image).
