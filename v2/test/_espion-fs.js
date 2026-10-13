'use strict';
// MOYENS-B2b point 7 — L'ESPION des lectures et écritures de fichiers, dans le harnais des suites (armé par _harnais.js ET par `lancer-tout` : node -r _espion-fs-armer.js <suite>).
// Pourquoi : test-garde-apports.js ne voit que les chemins écrits EN TOUTES LETTRES dans les fichiers de banc ; un chemin CONSTRUIT (path.join(RACINE, '..', 'pokemon-proxy', …)) lui échappe, et c'est le vecteur
// de l'incident des jonctions (2026-10-12). L'espion juge le chemin au moment où `fs` l'ouvre.
// 🔑 ÉCRIT PAR CE QU'IL AUTORISE (tout le reste est refusé, y compris ce qu'on n'a pas prévu). Sont permis :
//   (a) le dépôt (la racine de ce checkout : v2/test/../..) — le jeu de photos du verrou y est (copie fournie, jamais une jonction) ;
//   (b) le dossier temporaire du système ;
//   (c) .banc-local\cache-mongod du dépôt, et MONGOMS_DOWNLOAD_DIR s'il se termine par .banc-local\cache-mongod ;
//   (d) les cibles réelles de node_modules et de .banc-local\node_modules du dépôt (jonctions d'une copie de travail : le chargeur de modules lit le fichier RÉEL) ;
//   (e) les exceptions NOMMÉES de _apports-exceptions.js, fichier de banc par fichier de banc (la MÊME définition que test-garde-apports.js), sous le Bureau de l'utilisateur.
// Un accès hors de cela : l'appel lève une erreur de code ESPION_FS (le fichier n'est jamais ouvert), l'accès est noté, et à la sortie du processus la suite ÉCHOUE (code 1) en NOMMANT chaque chemin.
// PORTÉE, dite honnêtement : l'espion couvre les appels de `fs` et de `fs.promises` qui LISENT ou ÉCRIVENT un chemin du processus de la suite (lecture, écriture, ajout, ouverture, flux, listage, copie, déplacement,
// suppression, création de dossier, lien). Il ne couvre PAS : les métadonnées seules (stat, exists, access, realpath), les processus ENFANTS (un serveur lancé par un banc), le code natif (dlopen), ni un
// descripteur déjà ouvert. Un module qui a extrait `const { readFileSync } = require('fs')` AVANT l'armement garde l'original (le harnais est le premier require ; `-r` arme avant tout).
const fs = require('fs'), os = require('os'), path = require('path'), { fileURLToPath } = require('url');
const { EXCEPTIONS } = require('./_apports-exceptions');
const realpath = fs.realpathSync;                          // l'original, pris avant tout armement

const norm = p => path.resolve(String(p)).replace(/[\\/]+/g, '/').toLowerCase();
const sous = (p, base) => p === base || p.startsWith(base.endsWith('/') ? base : `${base}/`);
const reel = p => { try { return norm(realpath(p)); } catch { return null; } };

/** Le périmètre autorisé pour UN fichier de banc. `env` : seule MONGOMS_DOWNLOAD_DIR est lue. */
function perimetre({ racine = path.resolve(__dirname, '..', '..'), nomBanc = '', env = process.env } = {}) {
    const bases = new Set();
    const ajouter = p => { if (p) bases.add(p); };
    ajouter(norm(racine)); ajouter(reel(racine));
    ajouter(norm(os.tmpdir())); ajouter(reel(os.tmpdir()));
    ajouter(norm(path.join(racine, '.banc-local', 'cache-mongod')));
    const dl = env && env.MONGOMS_DOWNLOAD_DIR ? norm(env.MONGOMS_DOWNLOAD_DIR) : null;
    if (dl && dl.endsWith('/.banc-local/cache-mongod')) ajouter(dl);
    for (const nm of [path.join(racine, 'node_modules'), path.join(racine, '.banc-local', 'node_modules')]) ajouter(reel(nm));   // cibles de jonctions : le chargeur lit le fichier RÉEL
    // les exceptions sont écrites depuis le Bureau ; un banc trouve ses voisins depuis la racine du checkout (`..`), qui est le Bureau pour le dépôt principal mais le dossier PARENT d'une copie de travail :
    // chaque exception est donc permise sous le Bureau ET sous le parent de la racine — le même chemin nommé, jamais le dossier parent lui-même.
    const parents = [norm(path.join(os.homedir(), 'Desktop')), norm(path.dirname(path.resolve(racine)))];
    for (const e of Object.keys(EXCEPTIONS[nomBanc] || {})) for (const b of parents) ajouter(norm(path.join(b, e)));
    return { bases: [...bases] };
}
/** @returns {{ ok: boolean, chemin: string }} le chemin est celui qui a été JUGÉ (absolu, séparateurs « / », sans casse). */
function autorise(chemin, p) {
    const c = norm(chemin);
    return { ok: p.bases.some(b => sous(c, b)), chemin: c };
}

const violations = [];
let armee = false;
const cheminDe = a => {
    if (typeof a === 'string') return a;
    if (Buffer.isBuffer(a)) return a.toString();
    if (a && typeof a === 'object' && a.protocol === 'file:' && typeof a.pathname === 'string') { try { return fileURLToPath(a); } catch { return null; } }
    return null;                                           // un descripteur, un FileHandle, undefined : pas un chemin
};

function armer({ racine, nomBanc } = {}) {
    if (armee) return false;
    armee = true;
    const banc = nomBanc || path.basename((require.main && require.main.filename) || process.argv[1] || '');
    const P = perimetre({ racine, nomBanc: banc });
    const verifier = (op, a) => {
        const c = cheminDe(a);
        if (c === null || c === '') return;
        const r = autorise(c, P);
        if (r.ok) return;
        const abs = path.resolve(c);
        violations.push({ op, chemin: abs });
        const e = new Error(`ESPION-FS : ${op} hors périmètre : ${abs}`); e.code = 'ESPION_FS';
        throw e;
    };
    // [nom, nombre de chemins vérifiés (les premiers arguments)]
    const OPS = [['readFile', 1], ['writeFile', 1], ['appendFile', 1], ['open', 1], ['readdir', 1], ['opendir', 1], ['truncate', 1], ['unlink', 1], ['rm', 1], ['rmdir', 1], ['mkdir', 1],
        ['copyFile', 2], ['cp', 2], ['rename', 2], ['link', 2], ['symlink', 2], ['readlink', 1], ['chmod', 1], ['utimes', 1]];
    for (const [nom, n] of OPS) {
        for (const cle of [nom, `${nom}Sync`]) {
            const orig = fs[cle]; if (typeof orig !== 'function') continue;
            fs[cle] = function espionne(...args) { for (let i = 0; i < n; i++) verifier(cle, args[i]); return orig.apply(this, args); };
        }
        const po = fs.promises && fs.promises[nom];
        if (typeof po === 'function') fs.promises[nom] = function espionnePromesse(...args) { try { for (let i = 0; i < n; i++) verifier(`promises.${nom}`, args[i]); } catch (e) { return Promise.reject(e); } return po.apply(this, args); };
    }
    for (const cle of ['createReadStream', 'createWriteStream']) { const orig = fs[cle]; fs[cle] = function espionne(...args) { verifier(cle, args[0]); return orig.apply(this, args); }; }
    process.on('exit', () => {
        if (!violations.length) return;
        const lignes = violations.map(v => `   - ${v.op} : ${v.chemin}`).join('\n');
        fs.writeSync(1, `\n🔴 ESPION-FS : ${violations.length} accès hors périmètre dans ${banc}, refusés (le fichier n'a pas été ouvert) :\n${lignes}\n   permis : le dépôt, le dossier temporaire, .banc-local\\cache-mongod, les exceptions nommées de _apports-exceptions.js\n`);
        process.exitCode = 1;
    });
    return true;
}
module.exports = { armer, perimetre, autorise, violations };
