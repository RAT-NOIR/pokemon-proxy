// ============================================================
// VÉRIFICATION STATIQUE DES SOURCES — la classe « le fichier ne se charge pas »
// ============================================================
// POURQUOI, ET C'EST LA QUATRIÈME FOIS EN UNE SEMAINE. Un `const lignes` déclaré deux fois
// dans saisir-verites.js : SyntaxError, le fichier ne se charge pas du tout. Huit suites
// vertes, smoke vert, verrou vert — et l'outil de saisie des vérités inutilisable.
//
//   ⚠️ AUCUN DE NOS OUTILS EN LIGNE DE COMMANDE N'EST CHARGÉ PAR QUOI QUE CE SOIT.
//   saisir-verites, banc-japonais, verrou-charges, couverture-index, banc-seaux : rien ne
//   les touche. Le verrou couvre index.js et la route ; il ne peut structurellement pas
//   voir ces fichiers-là. Ils n'étaient testés que par leur usage, c'est-à-dire au pire
//   moment — quand on en a besoin.
//
// POURQUOI PAS UN `require` DE CHAQUE SCRIPT, qui serait le réflexe. Parce qu'il les
// EXÉCUTE : chacun est une IIFE de premier niveau qui ouvre une connexion Mongo, lit le
// journal de production, et pour saisir-verites ouvre un `readline` qui attend une saisie
// au clavier. Un contrôle qui fait ça n'est pas un contrôle, c'est un lancement. Il
// bloquerait, ou pire, il travaillerait.
//
// DEUX CONTRÔLES, AUCUN EFFET DE BORD :
//   1. `node --check` sur chaque fichier — il PARSE sans exécuter. Vérifié : il attrape
//      exactement le `const lignes` dupliqué, et il attrape aussi la corruption
//      d'encodage qui avait abîmé index.js.
//   2. Résolution statique des identifiants — un nom exporté par un module local, APPELÉ
//      dans un fichier, mais absent de sa ligne d'import. C'est la panne `numeroDepuisSlug`,
//      que `--check` ne peut pas voir : elle est syntaxiquement valide.
//
// ⚠️ CE QU'ILS N'ATTRAPENT PAS, et il faut le savoir : une erreur qui n'apparaît qu'à
// l'exécution d'une branche (un `undefined.foo` dans un `catch` rarement pris). Pour ça,
// il faut exécuter — c'est le rôle du verrou sur la route, et il ne couvre pas ces scripts.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RACINE = __dirname;

/** Tous les .js du projet, hors node_modules et hors dossiers cachés. */
function fichiersDuProjet() {
    const out = [];
    const parcourir = (dir, prof) => {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
            const p = path.join(dir, e.name);
            if (e.isDirectory()) { if (prof < 2) parcourir(p, prof + 1); }
            else if (e.name.endsWith('.js')) out.push(p);
        }
    };
    parcourir(RACINE, 0);
    return out.sort();
}

/**
 * `node --check` : parse sans exécuter.
 * @returns {{fichier: string, message: string}[]} les fichiers qui ne parsent pas
 */
function verifierSyntaxe(fichiers) {
    const casses = [];
    for (const f of fichiers) {
        try {
            execFileSync(process.execPath, ['--check', f], { stdio: 'pipe', timeout: 30000 });
        } catch (e) {
            const brut = String(e.stderr ?? e.message);
            const ligne = brut.split('\n').find(l => /Error/.test(l)) ?? brut.split('\n')[0];
            casses.push({ fichier: path.relative(RACINE, f), message: ligne.trim() });
        }
    }
    return casses;
}

/**
 * Un nom exporté par un module local, APPELÉ dans ce fichier, mais jamais importé.
 *
 * ⚠️ LE FILTRE `(?<![.\w])` EST INDISPENSABLE et manquait à la version d'origine (dans
 * smoke-test.js) : sans lui, `S.normaliserCodeSet(...)` comptait comme un appel de
 * `normaliserCodeSet` non importé, alors que c'est un accès de propriété parfaitement
 * légitime. Le contrôle aurait signalé des oublis qui n'en sont pas.
 *
 * @returns {{fichier: string, nom: string, module: string}[]}
 */
function verifierImports(fichier) {
    const brut = fs.readFileSync(fichier, 'utf8');
    // Commentaires retirés d'abord : ce projet en est plein, et ils contiennent des noms
    // de fonctions suivis de parenthèses. Le `[^:]` épargne les « https:// ».
    const source = brut.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

    const importes = new Set();
    for (const m of source.matchAll(/(?:const|let)\s*\{([^}]+)\}\s*=\s*require\(['"]\.\/[^'"]+['"]\)/g)) {
        for (const n of m[1].split(',')) {
            const nom = n.split(':').pop().trim();
            if (nom) importes.add(nom);
        }
    }
    const locaux = new Set();
    for (const m of source.matchAll(/(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g)) locaux.add(m[1]);
    for (const m of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) locaux.add(m[1]);
    // Les déstructurations posent aussi des noms locaux (`const { a, b } = x`).
    for (const m of source.matchAll(/(?:const|let|var)\s*\{([^}]+)\}\s*=/g)) {
        for (const n of m[1].split(',')) {
            const nom = n.split(':').pop().trim().replace(/\s*=.*$/, '');
            if (nom) locaux.add(nom);
        }
    }
    // Paramètres de fonction : ils sont locaux eux aussi.
    for (const m of source.matchAll(/function\s+[A-Za-z_$][\w$]*\s*\(([^)]*)\)/g)) {
        for (const n of m[1].split(',')) {
            const nom = n.trim().split(/[=\s]/)[0].replace(/[{}.]/g, '');
            if (nom) locaux.add(nom);
        }
    }

    // Les modules locaux réellement requis par CE fichier.
    const modules = [...new Set([...source.matchAll(/require\((['"])(\.\/[^'"]+)\1\)/g)].map(m => m[2]))];
    const oublis = [];
    for (const mod of modules) {
        let exports;
        try { exports = Object.keys(require(path.join(RACINE, mod))); }
        catch (_) { continue; }   // module à effet de bord : on ne le charge pas de force
        for (const nom of exports) {
            if (importes.has(nom) || locaux.has(nom)) continue;
            // Appelé comme FONCTION, et pas en accès de propriété (voir l'avertissement).
            if (new RegExp(`(?<![.\\w])${nom}\\s*\\(`).test(source)) {
                oublis.push({ fichier: path.relative(RACINE, fichier), nom, module: mod });
            }
        }
    }
    return oublis;
}

module.exports = { fichiersDuProjet, verifierSyntaxe, verifierImports, RACINE };
