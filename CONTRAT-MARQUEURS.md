# CONTRAT « MARQUEURS » — les bandeaux d'affichage d'un produit (v1, 2026-10-27)

**Propriétaire du contrat et de sa validation : l'agent API.** Lecteurs : le site (dessin des bandeaux), l'extension (réponses de l'API), le catalogue (producteur des marqueurs explicites).
Décision de l'éditeur (27/10, nuit) : des bandeaux comme les petites banderoles de Cardmarket (« Oversized »…), qui disent concrètement ce qu'est le produit.

## 1. Le principe
- **Les images stockées restent PROPRES.** Elles servent de références au scanner : un bandeau imprimé dans l'image fausserait l'empreinte et l'ORB. Aucun outil n'écrit un bandeau dans un fichier d'image, jamais.
- **Le bandeau est une DONNÉE du produit**, dessinée par le site (et l'extension) AU-DESSUS du visuel.
- **Liste FERMÉE.** Un type absent de la table du §3 n'existe pas : il est refusé à la validation (jamais deviné, jamais « corrigé » en silence). Ajouter un type = une nouvelle version de ce contrat, annoncée dans les journaux.
- La source qui fait foi est le module de l'API `v2/identifier/marqueurs.js` ; un banc vérifie que la table du §3 et le module disent la même chose.

## 2. La forme
Champ produit `marqueurs` : un tableau (0 à 4 éléments), dans l'ORDRE de la table du §3, sans doublon de type.
```json
"marqueurs": [
  { "type": "WCD", "params": { "annee": 2018, "joueur": "Magnus Pedersen" },
    "libelle": { "fr": "Deck Mondiaux 2018 · Magnus Pedersen", "en": "Worlds Deck 2018 · Magnus Pedersen" } },
  { "type": "NON_LEGAL", "params": {}, "libelle": { "fr": "Non autorisée en tournoi", "en": "Not tournament legal" } }
]
```
- `type` : un des types du §3. `params` : les seuls paramètres de ce type (objet vide sinon) ; un paramètre inconnu ou hors forme rend l'élément INVALIDE.
- `libelle.fr` et `libelle.en` : **40 caractères au plus**, rendus par l'API depuis les gabarits du §3. Le site peut les afficher tels quels ; s'il compose lui-même, il utilise les mêmes gabarits.
- **`[]` = prouvé sans marqueur** ; **`null` = on ne sait pas** (jamais « aucun marqueur »). Un produit dont la variante n'est pas prouvée et dont le set ne porte aucune règle du §4 vaut `null`.

### Les paramètres
| paramètre | forme |
|---|---|
| `annee` | entier de 1996 à 2099 |
| `joueur` | chaîne de 1 à 24 caractères (lettres, espaces, `'`, `-`, `.`), facultatif |
| `rang` | entier 1, 2, 3 ou 4 |

### Le rendu à 40 caractères
Un gabarit à paramètre facultatif a trois formes, essayées dans l'ordre ; la première qui tient en 40 caractères est rendue : **complète**, **courte**, **sans le paramètre facultatif** (qui reste dans `params`).

## 3. La table des types (liste fermée, ordre d'affichage)
| type | params | libellé FR | libellé EN | dérivé par l'API (§4) |
|---|---|---|---|---|
| `JUMBO` | — | Carte Jumbo | Jumbo card | variante `jumbo` prouvée |
| `WCD` | `annee`, `joueur`? | Deck Championnats du monde {annee} · {joueur} — courte : Deck Mondiaux {annee} · {joueur} — sans joueur : Deck Championnats du monde {annee} | World Championships Deck {annee} · {joueur} — courte : Worlds Deck {annee} · {joueur} — sans joueur : World Championships Deck {annee} | set `WCD-<aaaa>` |
| `NON_LEGAL` | — | Non autorisée en tournoi | Not tournament legal | set `WCD-<aaaa>` ; `JUMBO` |
| `EDITION_1` | — | 1re édition | 1st Edition | variante `premiere-edition` prouvée |
| `SHADOWLESS` | — | Sans ombre | Shadowless | catalogue seulement |
| `STAFF` | — | Tampon Staff | Staff stamp | marque `staff` prouvée |
| `PRERELEASE` | — | Tampon Avant-première | Prerelease stamp | marque `prerelease` prouvée |
| `LEAGUE` | — | Tampon Ligue | League stamp | marque `league` prouvée |
| `CHAMPIONSHIP` | — | Tampon Championnat | Championship stamp | marque `championship` prouvée |
| `PLACE` | `rang` | Tampon {rang}re place (1) / Tampon {rang}e place (2–4) | {rang}st / nd / rd / th Place stamp | marques `place-1` à `place-4` prouvées |
| `PROFESSOR` | — | Tampon Professor Program | Professor Program stamp | marque `professor` prouvée |
| `PLAY_POKEMON` | — | Tampon Play! Pokémon | Play! Pokémon stamp | marque `play-pokemon` prouvée ; set `Play-Pokemon-Prize-Pack-Series-*` |
| `TRICK_OR_TRADE` | — | Tampon Trick or Trade | Trick or Trade stamp | set `Trick-or-Trade`, `Trick-or-Trade-<aaaa>` |
| `BATTLE_ACADEMY` | — | Battle Academy | Battle Academy | set `Battle-Academy-<aaaa>` |
| `ANNIVERSAIRE_25` | — | Logo 25e anniversaire | 25th Anniversary logo | catalogue seulement |
| `POKEMON_CENTER` | — | Tampon Pokémon Center | Pokémon Center stamp | catalogue seulement |
| `GAMESTOP` | — | Tampon GameStop | GameStop stamp | marque `gamestop` prouvée |
| `TOYS_R_US` | — | Tampon Toys"R"Us | Toys"R"Us stamp | marque `toys-r-us` prouvée |
| `KFC` | — | Tampon KFC | KFC stamp | marque `kfc` prouvée |
| `INDOMILK` | — | Tampon Indomilk | Indomilk stamp | marque `indomilk` prouvée |
| `ORIGINS` | — | Tampon Origins Game Fair | Origins Game Fair stamp | catalogue seulement |
| `SNOWFLAKE` | — | Tampon Flocon | Snowflake stamp | marque `snowflake` prouvée |
| `COSMO` | — | Holo Cosmos | Cosmos holo | marque `cosmo` prouvée |
| `MCDONALDS` | — | Promo McDonald's | McDonald's promo | set `McDonalds-*` |

Les types viennent de la demande de l'éditeur (JUMBO, WCD, STAFF, PRERELEASE, LEAGUE, CHAMPIONSHIP, EDITION_1, NON_LEGAL), de la liste fermée des marques de l'API (`v2/identifier/marques-tampon.js`) et des familles relevées par le catalogue dans `couverture\S8\TAMPONS\` (play-pokemon, trick-or-trade, battle-academy, celebrations-25, mcdonalds, pokemon-center, origins, edition-1, wcd). `SHADOWLESS` est la banderole Cardmarket du vintage occidental.

## 4. Qui produit les marqueurs
1. **L'API les DÉRIVE** de ce qui est déjà prouvé, et de rien d'autre : la variante prouvée (`varianteAvecPreuve`, `marques`), et le set (`slugSet`) pour les seules familles du §3 où TOUS les produits du set portent ce marqueur. Elle ne lit **jamais** une image pour poser un marqueur.
2. **Le catalogue peut les ÉCRIRE** dans `cartes_produits.marqueurs` (même forme, sans `libelle`) avec `marqueursPreuve` (une phrase : la source et ce qu'elle montre). L'API valide chaque élément contre la table du §3 : un élément invalide est écarté et compté, jamais réparé. **Un marqueur dérivé l'emporte** sur un marqueur écrit du même type qui le contredit (année WCD différente, par ex.) ; la contradiction est comptée et signalée au catalogue.
3. Les « catalogue seulement » (`SHADOWLESS`, `ANNIVERSAIRE_25`, `POKEMON_CENTER`, `ORIGINS`) n'existent que par une écriture du catalogue avec sa preuve.

## 5. Ce que l'API en fait (décision de l'éditeur, 27/10) — SANS RIEN LIRE DANS L'IMAGE pour les poser
- Deux produits **au même dessin** (même fiche, même visuel, ou visuel emprunté l'un à l'autre) **qui ne diffèrent que par leurs marqueurs** forment un **groupe à départager**.
- **Jamais de SÛR sur un groupe tant que le marqueur n'est pas tranché par un signal réel :**
  - `JUMBO` : par le **titre de l'annonce** (jumbo, oversize(d), XXL, géant(e), et leurs équivalents de, es, it, nl, pt, pl, cs), **par LISTE BLANCHE (JUMBO-LB, 27/10)** : le titre n'affirme le Jumbo que si CHACUN de ses mots est un terme jumbo, un mot du produit JUMBO candidat (nom, set, numéro) ou un mot neutre de la liste fermée (pokemon, carte, card, holo…) ; un seul mot hors de ces ensembles, une ponctuation hors de l'ensemble fermé ou un titre de plus de 200 caractères / 12 mots ne tranche rien. Un titre qui NIE (« pas jumbo », « not oversized », « taille normale »…), qui doute, cite une contrefaçon ou un accessoire contient un mot hors liste : la question { normale, jumbo } reste, les deux versions ; l'absence du mot ne prouve jamais la version normale ;
  - tampons (`STAFF`… `PLACE`) : par la lecture des marques déjà en place (deux lectures identiques de l'ensemble exact) ;
  - `WCD` : par la lecture de zone « signature WCD » dès qu'elle existera ; d'ici là, le groupe reste une question.
- Une carte servie porte ses marqueurs dans la réponse (`carte.marqueurs`, `candidats[].marqueurs`, `impressions[].marqueurs`) : champ ADDITIF, `variante` et `marques` ne changent pas.

## 6. Le cas des WCD empruntés (décision de l'éditeur, 27/10)
Un produit WCD dont le visuel est celui de la carte d'origine (emprunt du catalogue, lot `emprunt-2026-10`) s'affiche **avec le marqueur `WCD` (et `NON_LEGAL`), SANS la mention « visuel d'un autre tirage »**. La classe EMPRUNTÉ reste en interne (l'API ne s'en sert jamais comme référence d'image).

## 6 bis. Les JUMBO et Base Set : plus aucun visuel d'un autre tirage sans le dire (décision du coordinateur, 27/10 ; lot JUMBO-VISUEL)
Un produit JUMBO partage la fiche de la carte normale de son set, donc son scan. Le catalogue a comparé à l'œil chaque JUMBO à ce scan (liste jugée par `v2/chargeur/jumbos-visuel.js`, construction `--jumbos-visuel=<fichier>`) :
- **JUMBO identique à sa carte** (illustration, texte, numéro) : classe EMPRUNTÉ (interne : exclue des règles d'image) ; il s'affiche avec le visuel de la carte **et** les bandeaux `JUMBO` + `NON_LEGAL`, **SANS la mention** « visuel d'un autre tirage » (comme les WCD empruntés, §6).
- **JUMBO différent** (logo de set imprimé, badge, trame holo…), **illisible** (traité comme différent) ou **joint à tort à une autre fiche** : le scan de la carte normale n'est PAS le sien, **aucun visuel ne lui est servi** (`visuel: null`, `visuelMention: null` ; un visuel absent est honnête). Il reste candidat, avec ses bandeaux `JUMBO` + `NON_LEGAL` : le groupe { JUMBO, normale } et la garde des groupes (§5) tiennent. **Ce n'est pas une exclusion** (une exclusion retirerait aussi le produit des partages : la carte normale redeviendrait affirmable sur la photo d'un Jumbo). Archive : colonne des masqués, format 5.
- **Base Set, fiches Pokémon n° 1 à 69** : leur scan est « Édition 1 » (TCGdex), servi à tous les produits de la fiche (Cardmarket ne dit pas lequel des V1…Vn est la 1re édition). Ces produits affichent la mention `visuelMention` = « Visuel d'un autre tirage », **sauf** un produit PROUVÉ 1re édition (marqueur `EDITION_1`, dérivé ou écrit avec sa preuve), qui l'affiche sans mention. Aucune exclusion : l'identification ne change pas.
- Un JUMBO que la liste du catalogue ne nomme pas est servi comme avant (compté, listé à la construction).

## 7. Historique
- v1.1 (2026-10-27) : §6 bis (JUMBO identiques empruntés sans mention, JUMBO différents sans visuel, mention Base Set). Aucun type ni paramètre ajouté.
- v1 (2026-10-27) : première version.
