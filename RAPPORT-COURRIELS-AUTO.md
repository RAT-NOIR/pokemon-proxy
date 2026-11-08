# Courriels du site : resynchronisation automatique (branche v2-courriels-auto)

## Ce qui a changé
- `v2/comptes/copier-courriels-site.js` : `verifier()` est DÉTERMINISTE. Il vérifie (1) chaque fichier de la copie contre `empreintes.json` (copie non retouchée, sans le site), puis (2) que la copie est exactement ce que produit le commit ÉPINGLÉ (`git show <commit>:lib/<nom>`, jamais l'arbre de travail du site, jamais `main`). Ce que fait `main` du site n'entre plus dans le verdict. Nouvelle `deriveDuSite()` + `avertissement()` : compare les sources de `main` aux empreintes et imprime « le site a changé N des 7 sources depuis le commit épinglé X (…) → lancer `node v2/comptes/resynchroniser-courriels-site.js` ». `ecrire()` accepte `{commit, repo}`.
- `v2/comptes/resynchroniser-courriels-site.js` (nouveau) : lit la tête de `main`, liste les sources changées, refuse si l'arbre du site a des modifications non commitées sur ces sources (rien d'écrit), réécrit la seule ligne `const COMMIT`, régénère `courriels-site/`, rejoue `test-courriels-site.js` dans un processus neuf, imprime le diff du contenu servi (sources changées, lignes `-`/`+` des `.mjs`) et la liste des fichiers à nommer au commit. Ne commite rien. `--verifier` : lecture seule (code 0 à jour, 1 avancé, 2 indéterminé).
- `v2/test/test-courriels-site.js` : utilise le verdict déterministe et imprime l'avertissement de dérive (jamais un échec).
- `v2/test/test-courriels-auto.js` (nouveau, 27 assertions) : faux dépôt de site en dossier temporaire + espion qui refuse toute écriture hors de ce dossier. Cas : épingle à jour vert ; site qui avance → verrou vert + avertissement ; copie retouchée (seule, ou avec son empreinte) → rouge, même site absent ; site/commit absent → « non vérifié » dit ; arbre du site sale → refus sans écriture ; resynchronisation → COMMIT, copie, empreintes à jour, banc vert, diff imprimé ; relance → « rien à faire » ; banc de la copie rouge → le script échoue. Rouge vu d'abord contre l'ancien copieur (`deriveDuSite` absent, épingle jugée `derive` à cause de `main`).
- `v2/test/_apports-exceptions.js` : lecture de GitHubDesktop (recherche de git) accordée au nouveau banc.

## Décision : site ou commit absent
Le test ne saute PAS en silence ; il affiche en tête « NON VÉRIFIÉ (site-absent | commit-absent) » et ne compte aucun vert « conforme à l'épingle ». Il n'échoue pas : un poste sans dépôt du site (ou un historique du site réécrit) ne doit pas bloquer un push ; la partie qui ne dépend pas du site (copie non retouchée vs empreintes) reste jugée et échoue si elle est fausse.

## Pourquoi un commit du site ne peut plus bloquer un push
Le verrou ne lit que le commit épinglé, qui est immuable : un nouveau commit du site ne change aucun octet de ce qu'il compare. La dérive devient un avertissement imprimé.

## Mode d'emploi
1. Voir la dérive : `node v2/comptes/resynchroniser-courriels-site.js --verifier`
2. Resynchroniser : `node v2/comptes/resynchroniser-courriels-site.js` (relire le diff imprimé).
3. Commiter les fichiers listés (COMMIT du copieur, `courriels-site/*`), un par un.

## État de la copie
Au 2026-11-08, `main` du site (8f51016) n'a changé aucune des 7 sources depuis l'épingle 1ee401e : aucune resynchronisation nécessaire, donc pas de commit séparé.
