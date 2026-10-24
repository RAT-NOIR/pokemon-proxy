'use strict';
// Banc INDEX-EMPREINTES (tour de correction 2, I3) — `producteur.py` appelle des SCRIPTS (exporter-archive.js…) par un chemin construit avec os.path.join(…) : ce banc LIT producteur.py, extrait chaque chemin de script
// appelé, le résout comme Python le résoudrait (depuis le fichier lui-même, jamais depuis un dossier de l'utilisateur) et vérifie que le script EXISTE dans le dépôt. Rien n'est exécuté, aucun réseau.
// Une garde écrite par ce qu'elle autorise : une base qu'il ne sait pas résoudre = échec (« je ne sais pas » n'est pas « il existe »), et zéro chemin trouvé = échec (un extracteur muet n'est pas un vert).
const H = require('./_harnais');
const fs = require('fs'), path = require('path');

const PRODUCTEUR = path.join(__dirname, '..', '..', 'outils', 'producteur-index', 'producteur.py');

/** Les chemins de script (…\.js | …\.py) construits par os.path.join(BASE, 'a', 'b.js') dans un source Python.
 *  BASE connue : RACINE_SERVICE (= définie dans le source par dirname(dirname(abspath(__file__)))) ou os.path.dirname(os.path.abspath(__file__)). @returns [{ ligne, expression, resolu | null }] — resolu null = base inconnue. */
function cheminsDeScripts(source, fichier) {
    const dossier = path.dirname(fichier);
    const racineService = /^RACINE_SERVICE\s*=\s*os\.path\.dirname\(os\.path\.dirname\(os\.path\.abspath\(__file__\)\)\)\s*$/m.test(source) ? path.dirname(dossier) : null;
    const sorties = [];
    source.split(/\r?\n/).forEach((l, i) => {
        const re = /os\.path\.join\(([^()]*(?:\([^()]*(?:\([^()]*\)[^()]*)*\)[^()]*)*)\)/g; let m;
        while ((m = re.exec(l))) {
            const args = m[1];
            if (!/['"][^'"]*\.(?:js|py)['"]/.test(args)) continue;                      // pas un chemin de script
            const morceaux = [...args.matchAll(/'([^']*)'|"([^"]*)"/g)].map(x => x[1] !== undefined ? x[1] : x[2]);
            const base = args.trim().split(',')[0].trim();
            let racine = null;
            if (base === 'RACINE_SERVICE') racine = racineService;
            else if (/^os\.path\.dirname\(os\.path\.abspath\(__file__\)\)$/.test(base)) racine = dossier;
            sorties.push({ ligne: i + 1, expression: m[0], resolu: racine ? path.join(racine, ...morceaux) : null });
        }
    });
    return sorties;
}

const source = fs.readFileSync(PRODUCTEUR, 'utf8');
const trouves = cheminsDeScripts(source, PRODUCTEUR);
H.vrai(`1. 🔑 l'extracteur voit au moins un script appelé par producteur.py (dénominateur : ${trouves.length})`, trouves.length >= 1);
H.vrai('2. 🔑 chaque base de chemin est RÉSOLUE (sinon : je ne sais pas = échec)', trouves.every(t => t.resolu));
for (const t of trouves) H.vrai(`3. le script appelé à la ligne ${t.ligne} existe dans le dépôt : ${t.resolu ? path.relative(path.join(__dirname, '..', '..'), t.resolu).replace(/\\/g, '/') : '(base inconnue)'}`, t.resolu && fs.existsSync(t.resolu) && fs.statSync(t.resolu).isFile());
H.vrai('4. aucun chemin en dur d\'un dossier de l\'utilisateur dans producteur.py', !/[A-Za-z]:[\\/]+Users/i.test(source));

// ── variantes rouges : l'extracteur DOIT voir l'ancien défaut
{
    const ancien = "RACINE_SERVICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))\nexp = os.path.join(RACINE_SERVICE, 'producteur', 'exporter-archive.js')\n";
    const t = cheminsDeScripts(ancien, PRODUCTEUR);
    H.vrai('5a. 🔑 variante : l\'ancien chemin (RACINE_SERVICE/producteur/exporter-archive.js) est vu ET n\'existe pas', t.length === 1 && t[0].resolu && !fs.existsSync(t[0].resolu));
    H.vrai('5b. variante : une base inconnue n\'est pas résolue (donc le banc échouerait)', cheminsDeScripts("exp = os.path.join(AILLEURS, 'x.js')\n", PRODUCTEUR)[0].resolu === null);
    H.vrai('5c. variante : un source sans aucun chemin de script donne 0 (donc le banc échouerait)', cheminsDeScripts("x = 1\n", PRODUCTEUR).length === 0);
    H.vrai('5d. variante : le chemin résolu depuis le fichier lui-même est vu et existe', (() => { const r = cheminsDeScripts("exp = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exporter-archive.js')\n", PRODUCTEUR); return r.length === 1 && fs.existsSync(r[0].resolu); })());
}
H.bilan();
