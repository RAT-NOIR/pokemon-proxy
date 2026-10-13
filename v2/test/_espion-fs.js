'use strict';
// MOYENS-B2b point 7 — L'ESPION des lectures et écritures de fichiers, dans le harnais des suites (armé par _harnais.js ET par `lancer-tout` : node -r _espion-fs-armer.js <suite>).
// Pourquoi : test-garde-apports.js ne voit que les chemins écrits EN TOUTES LETTRES dans les fichiers de banc ; un chemin CONSTRUIT (path.join(RACINE, '..', 'pokemon-proxy', …)) lui échappe, et c'est le vecteur
// de l'incident des jonctions (2026-10-12). L'espion juge le chemin au moment où `fs` l'ouvre — et, tour 1 (I-2), le chemin RÉEL : le plus long préfixe existant est résolu par `realpathSync.native`
// (jonctions et liens suivis), le reste est ajouté tel quel, et c'est CE chemin qui est jugé ; une jonction du dépôt vers l'extérieur est donc vue.
// 🔑 ÉCRIT PAR CE QU'IL AUTORISE (tout le reste est refusé, y compris ce qu'on n'a pas prévu). Sont permis :
//   (a) le dépôt (la racine de ce checkout : v2/test/../..) — le jeu de photos du verrou y est (copie fournie, jamais une jonction) ;
//   (b) le dossier temporaire du système ;
//   (c) .banc-local\cache-mongod du dépôt, et MONGOMS_DOWNLOAD_DIR s'il se termine par .banc-local\cache-mongod ;
//   (d) les cibles réelles de node_modules et de .banc-local\node_modules du dépôt (jonctions d'une copie de travail : le chargeur de modules lit le fichier RÉEL) ;
//   (e) les exceptions NOMMÉES de _apports-exceptions.js, fichier de banc par fichier de banc (la MÊME définition que test-garde-apports.js), sous le Bureau de l'utilisateur et sous le dossier parent du
//       checkout ; certaines (LECTURE_SEULE) ne s'ouvrent qu'en LECTURE : une écriture, ou la destination d'une copie, y est refusée.
// Un accès hors de cela : l'appel lève une erreur de code ESPION_FS (le fichier n'est jamais ouvert), l'accès est noté, et à la sortie du processus la suite ÉCHOUE (code 1) en NOMMANT chaque chemin.
// COUVERT : les appels de `fs` et de `fs.promises` qui lisent, écrivent, listent, copient, déplacent, suppriment, créent, lient, surveillent ou ouvrent un chemin (readFile, writeFile, appendFile, open,
// openAsBlob, readdir, opendir, cp, copyFile, rename, link, symlink, mkdir, mkdtemp, rm, rmdir, unlink, truncate, chmod/chown/utimes, glob/globSync, watch, watchFile, statfs, createRead/WriteStream).
// ⚠️ PAS VU, et il faut le savoir : (1) un PROCESSUS ENFANT qui lit à la place du banc (spawn de cmd, d'un autre node sans l'armeur : `type`, `copy`, un serveur lancé par un banc) ; (2) le code natif
// (dlopen, bibliothèques) ; (3) un descripteur ou un FileHandle déjà ouvert ; (4) les métadonnées seules (stat, exists, access, realpath, lstat) ; (5) un `const { readFileSync } = require('fs')` extrait
// AVANT l'armement (le harnais est le premier require ; `-r` arme avant tout) ; (6) une suite qui retire elle-même ses écouteurs de sortie (elle perd le code 1 ; l'erreur ESPION_FS levée à l'accès reste).
const fs = require('fs'), os = require('os'), path = require('path'), { fileURLToPath } = require('url');
const { EXCEPTIONS, LECTURE_SEULE } = require('./_apports-exceptions');
const realpathNative = fs.realpathSync.native;             // l'original, pris avant tout armement

const norm = p => path.resolve(String(p)).replace(/[\\/]+/g, '/').toLowerCase();
const sous = (p, base) => p === base || p.startsWith(base.endsWith('/') ? base : `${base}/`);
/** Le chemin RÉEL : le plus long préfixe existant résolu par realpath.native (jonctions suivies), le reste ajouté tel quel. Toujours une chaîne normalisée (« / », sans casse). */
function cheminReel(chemin) {
    let abs = path.resolve(String(chemin)); const reste = [];
    for (;;) {
        try { const r = realpathNative(abs); return norm(reste.length ? path.join(r, ...reste.reverse()) : r); }
        catch { const parent = path.dirname(abs); if (parent === abs) return norm(path.resolve(String(chemin))); reste.push(path.basename(abs)); abs = parent; }
    }
}

/** Le périmètre autorisé pour UN fichier de banc : une liste de { base, lecture } ; `lecture: true` = ouverte en lecture seule. `env` : seule MONGOMS_DOWNLOAD_DIR est lue. */
function perimetre({ racine = path.resolve(__dirname, '..', '..'), nomBanc = '', env = process.env } = {}) {
    const bases = new Map();
    const ajouter = (p, lecture = false) => { for (const b of new Set([norm(p), cheminReel(p)])) if (!bases.has(b) || (bases.get(b) === true && !lecture)) bases.set(b, lecture); };
    ajouter(racine);
    ajouter(os.tmpdir());
    ajouter(path.join(racine, '.banc-local', 'cache-mongod'));
    const dl = env && env.MONGOMS_DOWNLOAD_DIR ? norm(env.MONGOMS_DOWNLOAD_DIR) : null;
    if (dl && dl.endsWith('/.banc-local/cache-mongod')) ajouter(env.MONGOMS_DOWNLOAD_DIR);
    // cibles de jonctions : le chargeur lit le fichier RÉEL ; tour 2 (M-2) : en LECTURE seule (une écriture ou une suppression par la jonction toucherait les modules de main — le geste de l'incident du 2026-10-12)
    for (const nm of [path.join(racine, 'node_modules'), path.join(racine, '.banc-local', 'node_modules')]) ajouter(nm, true);
    // les exceptions sont écrites depuis le Bureau ; un banc trouve ses voisins depuis la racine du checkout (`..`), qui est le Bureau pour le dépôt principal mais le dossier PARENT d'une copie de travail :
    // chaque exception est donc permise sous le Bureau ET sous le parent de la racine — le même chemin nommé, jamais le dossier parent lui-même.
    const parents = [path.join(os.homedir(), 'Desktop'), path.dirname(path.resolve(racine))];
    for (const e of Object.keys(EXCEPTIONS[nomBanc] || {})) for (const b of parents) ajouter(path.join(b, e), (LECTURE_SEULE[nomBanc] || []).includes(e));
    return { bases: [...bases.entries()].map(([base, lecture]) => ({ base, lecture })) };
}
/** @returns {{ ok: boolean, chemin: string }} le chemin RÉEL qui a été JUGÉ (absolu, séparateurs « / », sans casse). `ecriture` : l'accès modifie (les exceptions en lecture seule ne l'ouvrent pas). */
function autorise(chemin, p, { ecriture = false } = {}) {
    const c = cheminReel(chemin);
    return { ok: p.bases.some(b => sous(c, b.base) && !(ecriture && b.lecture)), chemin: c };
}

const violations = [];
let armee = false;
// Tour 2 (M-1) : un chemin peut être une chaîne, un Buffer, n'importe quelle vue d'octets (Uint8Array, même sur un tampon plus grand), une URL file: — tous jugés. Un descripteur (nombre), un FileHandle (objet
// à `fd` numérique) et l'absence de valeur ne sont pas des chemins. Tout AUTRE objet est refusé (écrit par ce qu'on reconnaît : on n'en devine pas le sens).
const INCONNU = Symbol('argument-non-reconnu');
const cheminDe = a => {
    if (typeof a === 'string') return a;
    if (a === undefined || a === null || typeof a === 'number' || typeof a === 'boolean' || typeof a === 'bigint') return null;
    if (ArrayBuffer.isView(a) && !(a instanceof DataView)) return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString();
    if (typeof a === 'object' && typeof a.fd === 'number') return null;                       // un FileHandle
    if (a instanceof URL) { if (a.protocol !== 'file:') return INCONNU; try { return fileURLToPath(a); } catch { return INCONNU; } }
    return INCONNU;
};
const lecteSeule = flags => flags === undefined || flags === null || (typeof flags === 'string' ? /^r(s)?$/.test(flags) : flags === 0);   // « r » / « rs » / O_RDONLY seuls ; tout le reste modifie
const META = /[*?[\]{}()!]/;

function armer({ racine, nomBanc } = {}) {
    if (armee) return false;
    armee = true;
    const banc = nomBanc || path.basename((require.main && require.main.filename) || process.argv[1] || '');
    const P = perimetre({ racine, nomBanc: banc });
    const verifier = (op, a, ecriture = false) => {
        const c = cheminDe(a);
        if (c === INCONNU) { violations.push({ op, chemin: `(argument qui n'est pas un chemin reconnu : ${Object.prototype.toString.call(a)})` }); const e = new Error(`ESPION-FS : ${op} : argument qui n'est pas un chemin reconnu (hors périmètre)`); e.code = 'ESPION_FS'; throw e; }
        if (c === null || c === '') return;
        const r = autorise(c, P, { ecriture });
        if (r.ok) return;
        const abs = path.resolve(c);
        violations.push({ op, chemin: abs === r.chemin ? abs : `${abs} (chemin réel : ${r.chemin})` });
        const e = new Error(`ESPION-FS : ${op} hors périmètre${ecriture ? ' (écriture)' : ''} : ${abs}${abs.toLowerCase().replace(/\\/g, '/') === r.chemin ? '' : ` (chemin réel : ${r.chemin})`}`); e.code = 'ESPION_FS';
        throw e;
    };
    // glob : le dossier de départ (option cwd, sinon le dossier courant) ET la partie fixe de chaque motif (un motif absolu ou qui remonte par « .. » sort du dossier de départ)
    const verifierGlob = (op, args) => {
        const motifs = Array.isArray(args[0]) ? args[0] : [args[0]], opts = args[1] && typeof args[1] === 'object' ? args[1] : {};
        const cwd = opts.cwd ? (cheminDe(opts.cwd) || process.cwd()) : process.cwd();
        verifier(op, cwd);
        for (const m of motifs) {
            if (typeof m !== 'string') continue;
            const i = m.search(META), fixe = i < 0 ? m : m.slice(0, i), dossier = i < 0 ? fixe : fixe.replace(/[^\\/]*$/, '');
            verifier(op, path.resolve(cwd, dossier || '.'));
        }
    };
    // [nom, droits des premiers arguments : 'l' lire, 'e' écrire, 'o' ouvrir (selon les drapeaux, 2e argument)]
    const OPS = [['readFile', 'l'], ['writeFile', 'e'], ['appendFile', 'e'], ['open', 'o'], ['readdir', 'l'], ['opendir', 'l'], ['truncate', 'e'], ['unlink', 'e'], ['rm', 'e'], ['rmdir', 'e'], ['mkdir', 'e'], ['mkdtemp', 'e'],
        ['copyFile', 'le'], ['cp', 'le'], ['rename', 'ee'], ['link', 'le'], ['symlink', 'le'], ['readlink', 'l'], ['chmod', 'e'], ['lchmod', 'e'], ['chown', 'e'], ['lchown', 'e'], ['utimes', 'e'], ['lutimes', 'e'],
        ['openAsBlob', 'l'], ['watch', 'l'], ['watchFile', 'l'], ['statfs', 'l']];
    const juger = (op, droits, args) => { for (let i = 0; i < droits.length; i++) verifier(op, args[i], droits[i] === 'e' || (droits[i] === 'o' && !lecteSeule(args[1]))); };
    for (const [nom, droits] of OPS) {
        for (const cle of [nom, `${nom}Sync`]) {
            const orig = fs[cle]; if (typeof orig !== 'function') continue;
            fs[cle] = function espionne(...args) { juger(cle, droits, args); return orig.apply(this, args); };
        }
        const po = fs.promises && fs.promises[nom];
        if (typeof po === 'function') {
            const synchrone = nom === 'watch';                 // fs.promises.watch rend un itérateur asynchrone : l'erreur se lève à l'appel
            fs.promises[nom] = function espionnePromesse(...args) { try { juger(`promises.${nom}`, droits, args); } catch (e) { if (synchrone) throw e; return Promise.reject(e); } return po.apply(this, args); };
        }
    }
    for (const cle of ['glob', 'globSync']) { const orig = fs[cle]; if (typeof orig === 'function') fs[cle] = function espionne(...args) { verifierGlob(cle, args); return orig.apply(this, args); }; }
    if (fs.promises && typeof fs.promises.glob === 'function') { const po = fs.promises.glob; fs.promises.glob = function espionnePromesse(...args) { verifierGlob('promises.glob', args); return po.apply(this, args); }; }
    for (const [cle, ecriture] of [['createReadStream', false], ['createWriteStream', true]]) { const orig = fs[cle]; fs[cle] = function espionne(...args) { verifier(cle, args[0], ecriture); return orig.apply(this, args); }; }
    process.on('exit', () => {
        if (!violations.length) return;
        const lignes = violations.map(v => `   - ${v.op} : ${v.chemin}`).join('\n');
        fs.writeSync(1, `\n🔴 ESPION-FS : ${violations.length} accès hors périmètre dans ${banc}, refusés (le fichier n'a pas été ouvert) :\n${lignes}\n   permis : le dépôt, le dossier temporaire, .banc-local\\cache-mongod, les exceptions nommées de _apports-exceptions.js (certaines en lecture seule)\n`);
        process.exitCode = 1;
    });
    return true;
}
module.exports = { armer, perimetre, autorise, cheminReel, violations };
