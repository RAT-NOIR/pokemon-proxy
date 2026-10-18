'use strict';
// Précharge (node -r) du jeu de mutations des abonnements : quand le processus charge le fichier visé (RM_MUTANT_CIBLE), il le compile depuis la COPIE MUTÉE (RM_MUTANT_SOURCE, dans le dossier
// temporaire) au lieu du fichier du dépôt. Le dépôt n'est JAMAIS modifié : un mutant meurt avec son processus. Sans les deux variables, il refuse de se charger.
const Module = require('module'), fs = require('fs'), path = require('path');
const cible = process.env.RM_MUTANT_CIBLE ? path.resolve(process.env.RM_MUTANT_CIBLE) : null, source = process.env.RM_MUTANT_SOURCE ? path.resolve(process.env.RM_MUTANT_SOURCE) : null;
if (!cible || !source) throw new Error('accroche-mutant : RM_MUTANT_CIBLE et RM_MUTANT_SOURCE sont exigées');
if (path.relative(require('os').tmpdir(), source).startsWith('..')) throw new Error('accroche-mutant : la copie mutée doit se trouver dans le dossier temporaire');
const compiler = Module.prototype._compile;
Module.prototype._compile = function (contenu, nom) {
    if (path.resolve(nom) === cible) contenu = fs.readFileSync(source, 'utf8');
    return compiler.call(this, contenu, nom);
};
