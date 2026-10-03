# Plan d'identification pour l'API — phase 2 B (2026-10-03)

**Rien n'est codé.** Ce plan fixe ce qui se construit, dans quel ordre, et à quel critère chaque étape est finie. Les chiffres sont des
mesures du 2026-09-29 au 2026-10-03, dénominateur compris.

## 0. L'objectif (testeur, 2026-09-28)

- **Bonne carte en tête sur au moins 99 % des photos nettes, et 0 réponse fausse affirmée.**
- Sortie finale : **une seule carte** quand les preuves concordent ; sinon **2 ou 3 candidats et LA question qui les sépare**
  (« reverse ou non ? », « quel symbole ? »), à trancher d'un clic. **Jamais « sous réserve » en sortie finale.**
- Les cartes **sans visuel** (chinoises notamment) s'identifient par le texte.
- Le contrat de l'extension s'**ajoute** à l'actuel : aucun champ existant ne change.

⚠️ « Photo nette » est à définir avec toi avant le banc large. Ma proposition : une seule carte, entière dans l'image, le nom et le
numéro lisibles à l'œil sur la photo.

## 1. Ce qui existe — mesuré

| brique | état | mesure |
|---|---|---|
| lecture IA (`/api/identifier`, Gemini via OpenRouter) | en production | lit nom, nom brut, numéro, total, code du set, langue, rareté, reverse, motif, symbole, attaque, illustrateur. **La marque de régulation n'est pas lue.** Médiane 3,0 s (journal, 58 lignes). |
| chaîne catalogue + scoring + départages | en production | journal, 128 lignes jugeables (2026-09-09, banc figé depuis) : fermes justes 18,0 %, faux affirmés 2,3 %, sous réserve 61,7 %, refus 18,0 % (CLAUDE.md §10) |
| index ORB (`references_image`) | en production, départage seulement | 70 214 vecteurs de vignettes ≤ 270 px ; l'index entier coûte 48 à 93 s par photo : hors de portée en ligne (§15) |
| **stock dense** (DINOv2-small, 384 dim) | labo | **46 436 images** — celles que le site sert (`cartes.images`), visuels de substitution exclus par construction ; 55 ms par image à vectoriser |
| modèle dense sur Render | **non mesuré** | le JSON de `mesure-dense-render.js` n'est pas arrivé (ton message portait « [JSON] »). Local : 280 Mo et 54 ms par requête (vecteurs synthétiques), 339 Mo et 73 ms (vrais vecteurs, int8 = float32 sur 19/20) |
| index des symboles | prêt, pas branché | 309 images, 200 sets ; 26 sets au même fichier qu'un autre, 18 indistincts (boîtes de code de 30×17), 102 sous 0,80 ; **seuils non calibrés** |
| visuels du catalogue | table maîtresse du 2026-09-29 | 46 922 des 72 926 produits servis avec visuel (64,3 %) ; ZH, ID, TH : 0 % — ~14 000 produits ne s'identifieront que par le texte |

### Le premier banc dense — 66 photos Vinted réelles du labo (vérité dans le nom du fichier), contre les 46 436 vecteurs

Dénominateurs : 66 photos · 63 vérités ont une fiche · **58 ont un vecteur pour leur IMPRESSION** (carte + set) · 63 pour leur CARTE.

| sur les 58 impressions indexées | rang 1 | top 3 | top 10 |
|---|---|---|---|
| photo brute — impression juste | 23 | 33 | 38 |
| photo brute — carte juste (tout set) | 29 | 37 | 41 |
| **photo redressée** — impression juste | **36** | **46** | 50 |
| **photo redressée** — carte juste | **45** | 48 | 54 |

Ce que ça dit, et rien de plus (66 photos, vintage japonais en majorité, ajustées à rien) :
- **le redressement est l'étape qui rapporte le plus** : rang 1 de 23 à 36 sur 58. Sans détection de la carte, le modèle regarde le fond ;
- **9 photos ont la bonne carte et le mauvais set** au rang 1 : le même dessin dans un autre set (Expedition / Skyridge), ou un set et
  ses Additionals qui partagent le même fichier (écart nul). **C'est au texte de trancher** (code du set, numéro), jamais à l'image ;
- l'image seule est très loin de 99 % : **la décision combine des preuves**, elle ne lit pas un rang ;
- quelques échecs profonds (Magmar rang 641, Banette 442, Altaria 128) sont à ouvrir : redressement faux, ou visuel d'une autre langue.

## 2. La chaîne cible

| étape | entrée → sortie | ce qui la fait échouer, et ce qui se passe alors |
|---|---|---|
| **E1. Entrée** | la photo envoyée par l'extension (fichier, ≤ 15 Mo) ; l'URL Vinted reste acceptée | fichier illisible → refus remboursé |
| **E2. Détection + redressement** | photo → carte redressée 600×825 | aucune carte trouvée → **question « recadrez la photo »**, jamais une devinette. Labo (OpenCV) : 6 faux rectangles sur 34, 9 échecs sur 43 — **le détecteur est à choisir** (voir T2) |
| **E3. Lecture du texte** (IA, l'appel actuel) | carte → nom, numéro, total, code, langue, motif, symbole, **+ marque de régulation** | champ illisible → `null`, jamais inventé (règle du prompt actuel) |
| **E4. Recherche dense** | carte redressée → top 50 sur l'index entier (~20 ms) | donne le DESSIN ; ne voit ni le motif reverse ni le tampon |
| **E5. Symbole** | zone du symbole (position selon l'époque) → classement des sets candidats | ne sert qu'à séparer des candidats de sets différents au même dessin ; jamais seul |
| **E6. Motif reverse** | lecture IA + règle du scoring (décision du 2026-09-28 : le motif lu passe devant une ligne déduite) | non résolu → question « reverse ou non ? » |
| **E7. Fusion** | candidats = top dense ∪ vivier du texte ; chacun reçoit ses preuves | — |
| **E8. Décision** | une carte, ou 2-3 candidats + une question | voir §3 |

**Cartes sans visuel** (ZH, ID, TH, réimpressions) : la recherche dense peut trouver le même dessin dans un AUTRE tirage. C'est une
preuve de CARTE, jamais d'impression : le produit vient du texte (code + numéro + langue). Sans aucun visuel du dessin, le texte seul.

## 3. La règle de décision — écrite, pas apprise

**On affirme UNE carte seulement si les trois niveaux concordent, et qu'aucune lecture ne contredit :**
1. **le dessin** — le top dense et le nom lu désignent la même carte (sans visuel : nom + numéro exact + code) ;
2. **l'impression** — une clé de set lue (code, numéro + total, symbole, marque de régulation) laisse UN seul produit parmi les candidats ;
3. **la variante** — motif résolu, ou produit sans variante.

Le dense et le texte en désaccord sur le dessin : **jamais affirmé**.

**Sinon : les candidats qui survivent (2 ou 3), et LA question qui les sépare.** Elle se choisit dans une liste fermée, dans cet ordre :
la première qui donne un candidat par réponse.

| code | question | quand |
|---|---|---|
| `reverse` | « Le motif brillant couvre-t-il toute la carte (reverse) ? » | les candidats diffèrent par la variante reverse |
| `symbole` | « Quel symbole voyez-vous en bas de la carte ? » (les 2-3 symboles affichés) | même dessin, sets différents, symboles distincts dans l'index |
| `numero` | « Quel numéro est imprimé en bas de la carte ? » | numéros différents |
| `langue` | « Dans quelle langue est la carte ? » | tirages différents |
| `premiere-edition` | « Voyez-vous le tampon “Edition 1” ? » | vintage occidental, éditions différentes |
| `visuel` | « Laquelle est votre carte ? » (les visuels côte à côte) | en dernier recours, quand rien d'autre ne sépare |

Plus de 3 candidats après fusion : on pose d'abord la question qui en élimine le plus, puis la suivante.
**Introuvable** (aucune carte au catalogue, photo inexploitable) : refus remboursé, avec sa raison — comme aujourd'hui.

🔑 **La réponse de l'utilisateur est une vérité.** Elle s'écrit au journal avec le scan : chaque question tranchée agrandit le banc
gratuitement — c'est ce qui manque depuis le 2026-09-08 (§36 : banc figé).

## 4. Le contrat de réponse — additif

Les champs actuels (`carte`, `candidats`, `classement`, `ambigu`, `niveauReserve`, `raisonReserve`, `reverse`, `guidePrix`) ne changent
pas. Un bloc s'ajoute :

```json
"identification": {
  "version": 1,
  "statut": "identifiee | a-trancher | introuvable",
  "carte": { "idProduct": 0, "nomProduit": "", "set": { "slug": "", "nom": "", "code": "", "tirage": "" }, "numero": "",
             "variante": "normale | reverse | …", "visuelUrl": "… ou null", "prix": 0, "guidePrix": { "…": "bloc de la réponse" } },
  "preuves": [{ "quoi": "dessin | nom | numero | code | symbole | regulation | motif | langue", "valeur": "", "source": "image | texte", "concorde": true }],
  "candidats": [{ "idProduct": 0, "nomProduit": "", "set": {}, "numero": "", "visuelUrl": "", "prix": 0, "prixGuideDu": "", "reponse": "" }],
  "question": { "code": "reverse", "texte": "", "choix": [{ "libelle": "", "image": "… ou null", "idProduct": 0 }] },
  "raison": "si introuvable"
}
```

Et une route : `POST /api/identifier/reponse { scanId, choix }`. Elle rend le produit choisi et son prix, sans nouveau crédit, et
journalise la réponse.
**`visuelUrl`** : le visuel admis par les règles du site, importées et jamais recopiées (§21 bis). Un visuel de substitution n'y va
jamais.

## 5. Les bancs

| banc | contenu | état |
|---|---|---|
| B0 | les 66 photos Vinted du labo | fait aujourd'hui, image seule (§1) |
| B1 | **tes 20 photos** : `labo-embedding/photos-test/`, nommées `<idProduct>_<n>.jpg` (ou un CSV photo ; URL Cardmarket) | **le dossier n'existe pas encore** |
| B2 | **le banc large que je te demande** : 200 photos nettes — 50 japonaises vintage, 50 japonaises modernes, 50 occidentales modernes, 30 occidentales vintage, 20 ZH/ID/TH ; dont 20 reverses et 10 paires « même dessin, deux sets » ; chacune avec son URL Cardmarket | à constituer |

**Critères, sur B2 :** bonne carte en tête ≥ 99 % (2 erreurs au plus sur 200), **0 faux affirmé**, et sur les « à trancher », la vérité
parmi les candidats ET la question qui la désigne (cible 100 %). Chaque étape se mesure à part (détection, dense, symbole, texte) ;
les taux ne s'additionnent jamais.

## 6. L'ordre des travaux

| # | travail | fini quand |
|---|---|---|
| T1 | **harnais de banc** : rejoue la chaîne complète sur un dossier de photos, lecture seule | B0 rejoué, dénominateurs imprimés |
| T2 | **détection** : comparer OpenCV et les 4 coins demandés à l'IA **dans le même appel** (aucun coût en plus) | rectangles justes ≥ 95 % sur B0 + B1, chaque échec signalé (jamais un faux rectangle silencieux) |
| T3 | **service dense dans l'API** : index int8 (~18 Mo) lu sur R2 au démarrage, top 50 en mémoire | après **ta mesure Render** : mémoire et p95 dans le budget du service |
| T4 | **fusion + décision + questions**, derrière un drapeau, hors du chemin actuel | B2 aux critères du §5 |
| T5 | **symboles** : découpe de la zone, index, seuils calibrés sur B2 | aucun symbole désigné à tort sur B2 |
| T6 | **marque de régulation** dans le prompt | lue juste sur les cartes de B2 qui en portent |
| T7 | route de réponse + journal des réponses | une réponse rejouée retrouve son scan |
| T8 | **extension** : affichage de la question | demande écrite à l'agent de l'extension (un autre dépôt) |

## 7. Ce qui est à toi

1. **Le JSON de la mesure Render** : il n'était pas dans ton message.
2. **Tes 20 photos**, puis le banc B2 (§5).
3. **La définition de « photo nette »** (§0).
4. **Le détecteur (T2)** : je propose de demander les 4 coins à l'IA dans l'appel qui existe déjà, et de mesurer contre OpenCV.

## Non mesuré

- le modèle dense sur Render ;
- la latence d'une identification complète sur une photo de l'outil (le journal ne porte que des annonces Vinted) ;
- l'effet du symbole et du texte combinés au dense : B0 ne mesure que l'image ;
- la langue du visuel le plus proche dans les échecs profonds de B0.
