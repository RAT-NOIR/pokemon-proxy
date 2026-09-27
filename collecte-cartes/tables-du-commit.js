// ============================================================
// LES TABLES DE SETS TELLES QU'UN COMMIT LES PORTE — pour juger une unité avec la ligne que le WORKER lira (2026-09-26, soir)
// ============================================================
// 🔴 LE TROU DE LA GARDE DU COMMIT : `etatDuWorker` compare l'HISTOIRE COMMITÉE des fichiers de règles. Une ligne de table
// ajoutée dans l'arbre de travail, pas encore commitée (EX Holon Phantoms, 2026-09-26), passe la garde — et l'unité
// `tcgdex/HP` choisie sur cette ligne sortirait `refuse-table` du worker, pour toujours (§23, §53). La garde répondait à
// « le worker porte-t-il les règles COMMITÉES ? » quand la question était « porte-t-il la ligne que JE lis ? ».
// 🔑 On relit donc les tables DU COMMIT DU WORKER (`git show <commit>:<fichier>`) et on compare, ligne par ligne, à celles de
// l'arbre de travail : une unité dont la ligne diffère ou manque chez le worker n'est pas enfilée, et la raison le dit.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const FICHIERS = ['collecte-cartes/table-sets.js', 'collecte-cartes/table-sets-auto.json', 'collecte-cartes/table-sets-sans-page.json', 'sets-vintage-japonais.js'];

function gitExe() {
    const base = path.join(process.env.LOCALAPPDATA || '', 'GitHubDesktop');
    const app = fs.readdirSync(base).filter(d => /^app-/.test(d)).sort().reverse()[0];
    if (!app) throw new Error('git introuvable (GitHubDesktop\\app-*)');
    return path.join(base, app, 'resources', 'app', 'git', 'cmd', 'git.exe');
}

/** Charge `ligne(code)` des tables du commit donné. Lève si un fichier manque : sans les tables du worker, je ne conclus rien. */
function tablesDuCommit(commit, { racine = path.join(__dirname, '..') } = {}) {
    if (!/^[0-9a-f]{7,40}$/.test(String(commit || ''))) throw new Error(`commit du worker illisible : « ${commit} »`);
    const git = gitExe();
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), `tables-${commit.slice(0, 12)}-`));
    for (const f of FICHIERS) {
        const contenu = execFileSync(git, ['show', `${commit}:${f}`], { cwd: racine, maxBuffer: 256 * 1024 * 1024 });
        fs.mkdirSync(path.join(dossier, path.dirname(f)), { recursive: true });
        fs.writeFileSync(path.join(dossier, f), contenu);
    }
    // table-sets.js lit ses deux JSON au CHARGEMENT (et rien ensuite) : le dossier se supprime dès le `require` fait
    let T;
    try { T = require(path.join(dossier, 'collecte-cartes', 'table-sets.js')); }
    finally { fs.rmSync(dossier, { recursive: true, force: true }); }
    if (typeof T.ligne !== 'function') throw new Error('les tables du commit n\'exportent pas `ligne`');
    return { ligne: T.ligne, dossier };
}

/**
 * Les fichiers de `fichiers` dont le contenu diffère entre l'arbre de travail et `commit` (absent du commit = différent).
 * 🔴 revue du 2026-09-26 : le juge des LIGNES ne dit rien du CODE — une mesure faite avec un code que le worker n'a pas
 * enfile ce que ce code-là voit à faire. Aucune conclusion possible = exception, jamais « identique ».
 */
function reglesDifferentes(commit, fichiers, { racine = path.join(__dirname, '..') } = {}) {
    if (!/^[0-9a-f]{7,40}$/.test(String(commit || ''))) throw new Error(`commit du worker illisible : « ${commit} »`);
    const git = gitExe();
    const diff = [];
    for (const f of fichiers) {
        try { execFileSync(git, ['cat-file', '-e', `${commit}:${f}`], { cwd: racine, stdio: 'ignore' }); }
        catch { diff.push(`${f} (absent du commit)`); continue; }
        try { execFileSync(git, ['diff', '--quiet', commit, '--', f], { cwd: racine, stdio: 'ignore' }); }
        catch (e) { if (e.status === 1) diff.push(f); else throw new Error(`git diff ${f} : ${e.message}`); }
    }
    return diff;
}

/** Une unité est-elle exécutable par le worker avec la MÊME ligne que celle de l'arbre de travail ? null si oui, sinon la raison. */
function fabriquerJuge(ligneLocale, ligneWorker, commit) {
    return code => {
        const a = ligneLocale(code), b = ligneWorker(code);
        if (!b) return `la ligne ${code} n'existe pas dans le commit du worker (${commit.slice(0, 12)}) — il la refuserait (refuse-table)`;
        if (JSON.stringify(a) !== JSON.stringify(b)) return `la ligne ${code} diffère entre l'arbre de travail et le commit du worker (${commit.slice(0, 12)})`;
        return null;
    };
}

/**
 * La fermeture des `require('./…')` LOCAUX depuis des fichiers d'entrée (chemins relatifs au dépôt, séparateur « / »).
 * 🔴 revue du 2026-09-26 : une liste de fichiers ÉNUMÉRÉE à la main vieillit — `jointure.js` (cleNumero, témoin du nom du plan
 * TCGdex) n'y était pas, et différait déjà du commit du worker. La liste se CALCULE depuis ce que le code charge réellement.
 * Un `require` dont la cible est introuvable LÈVE : je ne compare pas ce que je ne sais pas lire.
 */
function dependancesLocales(entrees, { racine = path.join(__dirname, '..') } = {}) {
    const vus = new Set(), pile = entrees.map(f => path.join(racine, f));
    const resoudre = (de, rel) => {
        const base = path.resolve(path.dirname(de), rel);
        for (const c of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
        throw new Error(`${path.relative(racine, de)} : require('${rel}') introuvable`);
    };
    while (pile.length) {
        const f = pile.pop();
        if (vus.has(f)) continue;
        vus.add(f);
        if (!f.endsWith('.js')) continue;
        // les commentaires se retirent d'abord (un en-tête cite « require('./collecte-cartes/revalider-site') » en exemple) ;
        // `//` précédé de « : » ou d'un guillemet est une URL dans une chaîne, pas un commentaire
        const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
        for (const m of code.matchAll(/require\(\s*['"`](\.{1,2}\/[^'"`]+)['"`]\s*\)/g)) pile.push(resoudre(f, m[1]));
    }
    return [...vus].map(f => path.relative(racine, f).split(path.sep).join('/')).sort();
}

module.exports = { tablesDuCommit, fabriquerJuge, reglesDifferentes, dependancesLocales, FICHIERS };
