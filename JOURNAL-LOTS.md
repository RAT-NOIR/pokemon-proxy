# Journal des lots additifs

Une ligne par lot : `lot-additif.js` sauvegarde, lance, compte, écrit ici.

| date (UTC) | quoi | commande | combien (avant → après) | sauvegarde | sortie |
|---|---|---|---|---|---|
| 2026-09-24 00:37:33 | remise en file TCGdex : galeries jamais lues (LOR) + incomplets sur 503 (CRE) | `node enfiler-tcgdex.js --ecrire` | file_images:etat=attente 25 → 27 ; file_images:etat=refuse 28 → 26 | backup-2026-09-24-lot-003733 | 0 |
| 2026-09-24 00:37:50 | petits formats Bulbapedia 350x495/355x500 : 37 sets en tete de file TCGdex | `node enfiler-tcgdex.js --petits-formats --en-tete --ecrire` | file_images:etat=attente 27 → 63 ; file_images:source=tcgdex 34 → 70 | backup-2026-09-24-lot-003750 | 0 |
