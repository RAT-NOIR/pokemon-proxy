# Apprentissage Cardmarket du 2026-09-25 — l'ordre, expansion par expansion

Mesuré le 2026-09-24 sur `catalogue_produits` (export du 23/09) contre `numeros_cartes` : **782 expansions, 752 apprises
au moins en partie, 30 jamais apprises (2 863 produits, dont 33 cartes-code)**. Ordre : la priorité acceptée le 24/09
(30th Celebration international, versions, Premium Deck Set, 6700), puis 1537, puis le reste par nombre de produits.
Un arrêt au premier refus : le lendemain, on reprend à la ligne qui a refusé.

| # | idExpansion | produits | ce que c'est (preuve ou repère) |
|---|---|---|---|
| 1 | 6601 | 191 (100 appris) | 30th Celebration, anglais — slug `30th-Celebration`, code `30C` : **à compléter** |
| 2 | 6604 | 203 | 30th Celebration, version aux 158 cartes + 8 énergies (langue à prouver par le slug) |
| 3 | 6628 | 49 | Premium Deck Set Espeon & Umbreon, version 1 |
| 4 | 6774 | 45 | Premium Deck Set Espeon & Umbreon, version 2 |
| 5 | 6602 | 176 | 30th Celebration, version aux 135 cartes (+ Espeon ex) |
| 6 | 6603 | 176 | 30th Celebration, version aux 135 cartes |
| 7 | 6700 | 122 | set chinois de l'ère Soleil et Lune (nom inconnu) |
| 8 | 6767 | 9 | 30th Celebration Live Code Card : 7 cartes-code, 2 vraies cartes (Mewtwo, Eevee) |
| 9 | 1537 | 190 (177 appris **sans slug**) | Aquapolis — la relecture pose les slugs : ses 177 produits rejoignent le set `AQ` |
| 10 | 6673 | 380 | ajoutée 2026-07-28 · ex. Grookey [Full On], Rillaboom V |
| 11 | 6633 | 287 | 2026-07-17 · Crustle, Ethan's Pinsir |
| 12 | 6699 | 266 | 2026-08-19 · Pheromosa & Buzzwole GX, TAG TEAM |
| 13 | 6669 | 196 | 2026-08-07 · Applin, Alolan Dugtrio |
| 14 | 6694 | 187 | 2026-08-12 · Detective Pikachu |
| 15 | 6672 | 146 | 2026-07-27 · Scorbunny, Grookey |
| 16 | 6634 | 141 | 2026-07-22 · Lugia ex, Kecleon |
| 17 | 6636 | 113 | 2026-07-29 · Heracross, Surskit |
| 18 | 6635 | 97 | 2026-07-22 · Teal Mask Ogerpon ex |
| 19 | 6637 | 20 | 2026-07-24 · Jolteon, Rotom, Pawmi |
| 20 | 6638 | 20 | 2026-07-24 · Carvanha, Liepard, Darkrai |
| 21 | 6639 | 18 | 2026-07-24 · Shaymin, Sprigatito |
| 22 | 6683 | 2 | 2026-08-05 · Pikachu [Scrappy Spark], Paradise Resort |
| 23 | 6697 | 80 | énergies de base (les 60 `idExpansion` déplacés le 23/09 y sont) |
| 24 | 5874 | 19 | 2024-08-21 · Lapras ex, Mudkip |
| 25 | 5875 | 19 | 2024-08-21 · Magmar ex, Torchic |
| 26 | 5876 | 19 | 2024-08-21 · Scyther ex, Treecko |
| 27 | 5716 | 15 | 2024-04-09 · Staryu, Ditto, Vaporeon ex |
| 28 | 5717 | 15 | 2024-04-09 · Ponyta, Rapidash, Ditto |
| 29 | 5415 | 9 | 2025-05-27 · énergies de base |
| 30 | 6354 | 8 | 2025-10-16 · Raihan, Bea, Leon |

**Inutiles à apprendre** (que des cartes-code, hors du dénominateur) : 6231 (20), 5798 (6).
**Ensuite**, les 12 expansions connues qui ont reçu 29 produits neufs : 6324 6514 6232 3143 1745 6393 6392 6391 6230 1539 4290 4170.

La même liste pour `apprendre-set.js`, si elle sert :
```
node apprendre-set.js --base=test 6601 6604 6628 6774 6602 6603 6700 6767 1537 6673 6633 6699 6669 6694 6672 6634 6636 6635 6637 6638 6639 6683 6697 5874 5875 5876 5716 5717 5415 6354 6324 6514 6232 3143 1745 6393 6392 6391 6230 1539 4290 4170
```
