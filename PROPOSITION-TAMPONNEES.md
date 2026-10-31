# PROPOSITION : les tamponnées servies EMPRUNTÉES (admission D), 01/11/2026 — à relire, rien de déployé

Décision de l'utilisateur (01/11) : une réimpression tamponnée (Prize Pack, 30th Celebration, Trick or Trade 2024, image empruntée du catalogue) reçoit le scan de la carte d'origine, EMPRUNTÉ, prouvé à l'image, avec ce qui dit ce qu'est le produit. Jamais présenté comme le scan du tirage tamponné ; le vrai scan tamponné remplace l'emprunt dès qu'il existe.

## 1. Le contrat de réponse : AUCUN type nouveau, aucune forme nouvelle
- Le bandeau qui dit ce qu'est le produit existe déjà et se DÉRIVE du set : Prize Pack → `PLAY_POKEMON` (FR « Tampon Play! Pokémon », EN « Play! Pokémon stamp »), Trick or Trade → `TRICK_OR_TRADE` (« Tampon Trick or Trade » / « Trick or Trade stamp »). La liste fermée reste à 27 types.
- Ce qui dit « emprunté » est la mention EXISTANTE `Visuel d'un autre tirage` (celle des fiches Base Set), posée sur l'entrée. Elle est déjà dans la forme servie (`mention`) ; aucun texte nouveau (le texte « visuel du tirage d'origine » reste refusé).
- 30th Celebration : AUCUN produit n'entre aujourd'hui (14 refusés, 14 indécidables à l'image). Un type `ANNIVERSAIRE_30` ne serait proposé que le jour où des produits y entrent. Rien à confirmer pour ce lot, sauf que l'extension affiche la mention d'un produit Prize Pack comme celle d'un Base Set.

## 2. Le chemin dans l'archive (v2/chargeur/decision.js, admission D)
Mécanisme des WCD ((B)), avec une liste fermée au lieu d'un lot du catalogue : un produit entre SEULEMENT s'il est dans `tamponneesEmpruntees` (Set d'idProduct, preuve nommée sur chaque ligne de la liste), si son refus est de la famille prize-packs / 30th-celebration / image-empruntee / Trick or Trade `<année>`, et si l'image est admise par la règle de langue du site pour la région du set. Entrée : `visuel: 'autre-tirage'`, mention existante, marquée EMPRUNTÉE (les règles d'image — G, départage, zone clé — ne la lisent pas, comme les WCD). WCD et Battle Academy gardent leurs règles. Sans liste : aucun effet, octet pour octet.
Le branchement en ligne de commande (`--tamponnees-empruntees=<fichier>` + empreinte épinglée, comme `--jumbos-visuel`) n'est PAS fait : il attend la relecture de cette proposition.

## 3. La preuve à l'image
La règle des emprunts déjà classés (e14-classes-orb.js), appliquée à l'image refusée contre TOUS les autres scans de la même carte (hors japonais pour un tirage non japonais) : un scan concorde si la fenêtre d'illustration donne >= 30 inliers (ORB + RANSAC de departage-image.js) OU si le cosinus d'empreinte (p8000) est >= 0,9 ; il contredit si <= 15 inliers ET cosinus < 0,7. Classe « meme » (admise) : TOUS les scans de référence concordent. Une carte sans autre scan, un scan non mesurable, une carte à plusieurs dessins, une mesure hésitante : indécidable, NON admise.

## 4. Le remplacement par le vrai scan
Automatique par construction : `choisirVisuel` donne un scan du set (non empreinté) avant le repli ; (D) ne se déclenche que s'il n'y en a pas. Test D5.

## 5. Ce que ça donne (archive candidate `candidate-2026-11-01c.rmv`, jamais publiée)
382 produits dans la portée (Prize Pack 268, image empruntée 93, 30th 14, Trick or Trade 7) : 21 prouvés « meme » et admis (Prize Pack 17, image empruntée 4) ; 361 indécidables. Entrées 68 220 -> 68 241 (+21), fiches liées 65 987 -> 65 987, 0 perdue, 0 produit changé. Mesure de l'archive (réglage 141, tamponnées 35, ordinaires 44) : FAUX 0, mêmes comptes qu'avant.
