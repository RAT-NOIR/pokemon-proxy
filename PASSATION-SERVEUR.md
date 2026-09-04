# Passation — serveur `pokemon-proxy`

Pour quelqu'un qui n'a rien lu. Les détails ne sont pas ici, ils sont référencés.

## L'état, en trois lignes

- **Ce qui tourne** : la production (Render, base Mongo nommée `test`) sert `/api/identifier`
  depuis le code de `main`. Le verrou est **vert**, cliquet à 52 assertions.
- **En attente de déploiement** : **24 commits sur `chantier-image`**, jamais fusionnés dans
  `main`. Tout ce qui suit — champs du journal, `originePrix`, règle de promotion v2, sites de
  refus corrigés — **n'est pas en production**. Le déploiement se fait par un push sur `main`,
  et c'est le testeur qui pousse.
- **Ce qui est cassé** : rien en production. Ce qui est **bloqué**, c'est l'enrichissement des
  ponts TCGdex — voir « ce qui attend », point 1.

## Décisions tranchées — ne pas les rouvrir

- **Lecture live conservée** — le cache servait une réponse périmée sur une route qui décide
  d'un prix.
- **Dérivation des ponts par la taille du set : refusée** — mesurée, 71,6 % des sets sont en
  collision de taille ; elle aurait donné un faux pont une fois sur cinq, en silence.
- **Départage par l'image maintenu en « faible »** — l'effectif observé ne soutient pas la
  promotion ; la règle v2 est dans le code, à `NIVEAU_RESERVE`.
- **Point unique de `champsDeRefus` : reporté** — huit sites, cinq corrects ; le refactor est
  décrit dans le chantier avec sa raison.
- **Alarme Cardmarket : supprimée** — elle mesurait un seuil qui n'existait plus.

## Ce qui attend, dans l'ordre

1. **L'import des ponts est à ÉCRIRE, pas à relancer.** `prefill-tcgdex.js` saute tout produit
   ayant déjà une ligne (`dejaFiables`, sans filtre sur `source`) : une relance écrirait
   **8 lignes**. Il faut un import qui attache `setTcgdex` aux produits déjà connus.
2. **`vivierDeRepli`** — drapeau à poser, rouge avant vert.
3. **Inventaire des valeurs d'un système externe figées chez nous** (chemins, versions, URLs).
4. **graphify** — cartographie du code, avec les prédictions écrites AVANT la mesure.
5. **Sauvegarde puis migration Atlas M10** — le testeur la lance lui-même.

## Trois chiffres à ne pas reperdre

- **534 expansions sur 752** n'ont **aucun** pont TCGdex.
- **11 243 ms** de scoring sur **720** candidats (cas Milotic, production).
- **43 %** des scans ne finissent sur **aucun verdict ferme**.

## Où sont les détails

- `CLAUDE.md` — les règles de travail dans ce dépôt.
- `scoring.js`, en tête — **le catalogue des erreurs d'instrument** (19 entrées). À lire avant
  toute mesure, et à alimenter après chaque erreur.
- `PASSATION.md` — la procédure de changement de cluster Mongo.
