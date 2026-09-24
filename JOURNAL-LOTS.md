# Journal des lots additifs

Une ligne par lot : `lot-additif.js` sauvegarde, lance, compte, écrit ici.

| date (UTC) | quoi | commande | combien (avant → après) | sauvegarde | sortie |
|---|---|---|---|---|---|
| 2026-09-24 00:37:33 | remise en file TCGdex : galeries jamais lues (LOR) + incomplets sur 503 (CRE) | `node enfiler-tcgdex.js --ecrire` | file_images:etat=attente 25 → 27 ; file_images:etat=refuse 28 → 26 | backup-2026-09-24-lot-003733 | 0 |
| 2026-09-24 00:37:50 | petits formats Bulbapedia 350x495/355x500 : 37 sets en tete de file TCGdex | `node enfiler-tcgdex.js --petits-formats --en-tete --ecrire` | file_images:etat=attente 27 → 63 ; file_images:source=tcgdex 34 → 70 | backup-2026-09-24-lot-003750 | 0 |
| 2026-09-24 00:40:10 | recollecte texte ASC : 70 titres ex lus par le parseur du 15/09 (prevu 225 -> 295 joints) | `node collecteur-texte.js --set=ASC` | cartes_produits:idExpansion=6395 0 → 0 ⚠️ FAUX (filtre en chaîne sur un champ numérique, corrigé dans l'outil) — RÉEL, remesuré : 225 → 295 produits joints (sauvegarde contre base) ; cartes:sets=Ascended-Heroes 181 → 225 | backup-2026-09-24-lot-004010 | 0 |
| 2026-09-24 08:34:20 | recollecte texte xASC : 285 titres (prevu 26 -> 288 joints sur 288) | `node collecteur-texte.js --set=xASC` | cartes_produits:idExpansion=6455 26/58863 → 288/59125 ; cartes:sets=Ascended-Heroes-Additionals 10/15274 → 225/15274 | backup-2026-09-24-lot-083420 | 0 |
