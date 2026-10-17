// Garde d'écriture de STAFF-DETECT, écrite par ce qu'elle AUTORISE : on n'écrit, crée ou supprime un fichier que sous les racines listées.
// Tout autre chemin (après résolution complète, liens compris) LÈVE avant la moindre écriture. Le dossier source du testeur n'y figure pas.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const RACINES_AUTORISEES = ['C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\STAFF-DETECT'];

// realpath du plus profond ancêtre existant + le reste (le chemin cible peut ne pas exister encore).
function resoudre(chemin) {
    let p = path.resolve(chemin), reste = [];
    while (!fs.existsSync(p)) { const parent = path.dirname(p); if (parent === p) break; reste.unshift(path.basename(p)); p = parent; }
    let reel = p; try { reel = fs.realpathSync.native(p); } catch (e) { /* inexistant jusqu'à la racine */ }
    return path.join(reel, ...reste);
}
const norm = s => (process.platform === 'win32' ? s.toLowerCase() : s);

function autoriser(chemin, racines) {
    if (typeof chemin !== 'string' || !chemin.trim()) throw new Error('garde d\'écriture : chemin vide');
    const liste = racines || [...RACINES_AUTORISEES, os.tmpdir()];
    const cible = resoudre(chemin);
    const dedans = liste.some(r => {
        const racine = norm(resoudre(r));
        const c = norm(cible);
        return c === racine || c.startsWith(racine.endsWith(path.sep) ? racine : racine + path.sep);
    });
    if (!dedans) throw new Error('garde d\'écriture : chemin hors des racines autorisées : ' + cible);
    return cible;
}

module.exports = { autoriser, RACINES_AUTORISEES };
