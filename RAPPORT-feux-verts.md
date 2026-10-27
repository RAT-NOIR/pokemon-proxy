# Rapport feux verts du 2026-10-27 (implémenteur)

Bancs : test-numero-fiche-lettre.js 28/28 ; test-detacher-doublons-lus.js 27/27 (rouge vu avant : module absent). Simulations réelles en LECTURE SEULE (MONGODB_CARTES_LECTURE_URI), rien écrit.
Lancer depuis le worktree : `$env:NODE_PATH='C:\Users\Yung\Desktop\pokemon-proxy\node_modules'` (pas de node_modules ici ; le .env est lu depuis main).

## OUTIL 1 : numeroFiche avec sa lettre (poser-numero-fiche-lettre.js)
Dénominateur : 55 produits (yellow-a-base.json). Plan : 50 à écrire, 3 déjà faits, 2 refus nommés :
- 311408 Karen : numeroFiche « XY177a » déjà posé, ses chiffres ne sont pas ceux de « 177a » ;
- 358590 Tapu Koko : numéro « SM30a » pas de la forme chiffres+lettre.
Un seul « avant » non nul : Regigigas 321170 « 84 » → « 84a » ; les 49 autres sont vides. Garde de lot simulée : 0 baisse, 0 non autorisée, aucune annonce ; sets touchés (13) : Burning-Shadows, Celestial-Storm, Crimson-Invasion, Dragon-Majesty, Forbidden-Light, Guardians-Rising, Lost-Thunder, Shining-Legends, Team-Up, Ultra-Prism, Unbroken-Bonds, Unified-Minds, XY-Black-Star-Promos.
Plan complet : S8\PRIORITES\plan-numero-fiche-lettre.json.

Commandes (le coordinateur) :
1. Regigigas seul : `node lot-additif.js --quoi="numeroFiche avec lettre : Regigigas 84a" --collections=cartes_produits -- node poser-numero-fiche-lettre.js --ecrire --attendu=1 --produits=321170 --sauvegarde=<dossier>\avant-regigigas.json`
2. Tout le plan : `node lot-additif.js --quoi="numeroFiche avec lettre : 49 restants" --collections=cartes_produits -- node poser-numero-fiche-lettre.js --ecrire --attendu=49 --sauvegarde=<dossier>\avant-49.json` (attendu = 49 après l'étape 1 ; 50 si tout d'un coup)
3. Restauration : `node lot-additif.js --quoi="… RESTAURATION" --collections=cartes_produits -- node poser-numero-fiche-lettre.js --restaurer=<f>.json --ecrire --attendu=N`
Écrit : `numeroFiche`, `numeroFicheAvant` (valeur d'avant, null compris), `numeroFichePreuve`, update conditionnel `{_id, idProduct, numeroFiche: avant}`.

## OUTIL 2 : détacher les doublons M2/M6 (detacher-doublons-lus.js)
Simulation : 2 à détacher (45331 Charmander, 45339 Minun), 0 refus, les deux avec vignette. Annonce (écrite dans S8\PRIORITES\annonce-doublons-m2m6.json) :
`{"images set:EX-Trainer-Kit-2":2,"vignettes-set set:EX-Trainer-Kit-2":2}`
Commandes :
1. `node lot-additif.js --quoi="doublons M2/M6 EX Trainer Kit 2 : 2 entrées" --collections=cartes,images --annonce=C:\Users\Yung\rat-market-travail\catalogue\couverture\S8\PRIORITES\annonce-doublons-m2m6.json -- node detacher-doublons-lus.js --ecrire --attendu=2 --sauvegarde=<dossier>\doublons-m2m6.json`
2. Restauration : `node lot-additif.js --quoi="… RESTAURATION" --collections=cartes,images -- node detacher-doublons-lus.js --restaurer=<f>.json --ecrire --attendu=2`
Écrit : `$pull` de l'entrée pkc dans cartes.images ; document `images` (source pkc) passé à `etat: 'retire'` + retireLe + retireMotif. R2 intact.
