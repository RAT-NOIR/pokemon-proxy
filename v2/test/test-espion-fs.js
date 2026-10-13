'use strict';
// B2b point 7 (relecture de TESTS-APPORTS, Important n°1) — l'ESPION des lectures et écritures de fichiers dans le harnais des suites.
// `test-garde-apports.js` ne voit que les chemins écrits en toutes lettres ; un chemin CONSTRUIT (path.join(RACINE, '..', 'pokemon-proxy', …), le vecteur de l'incident des jonctions) lui échappait.
// L'espion (_espion-fs.js) enveloppe les fonctions de `fs` (et de `fs.promises`) qui lisent ou écrivent un chemin : tout chemin HORS du dépôt, du dossier temporaire du système, de .banc-local\cache-mongod
// et des exceptions nommées de _apports-exceptions.js (fichier par fichier) lève ESPION_FS, est noté, et fait échouer la suite (code 1) en NOMMANT le chemin. Écrit par ce qu'il AUTORISE.
// Ce banc joue des suites FABRIQUÉES dans des processus enfants. Aucune écriture hors périmètre n'est tentée sur un dossier existant : l'écriture testée vise un dossier qui n'existe pas
// (espion cassé => ENOENT, pas ESPION_FS, donc rouge, sans rien créer) ; la lecture « interdite » vise un fichier qui n'existe pas.
const H = require('./_harnais');
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const E = require('./_espion-fs');
const RACINE = path.resolve(__dirname, '..', '..'), ARME = path.join(__dirname, '_espion-fs-armer.js'), LANCEUR = path.join(__dirname, 'lancer-tout.js');
const BAS = ['Lo', 'go', ' ', 'FR'].join('');               // le nom du dossier du testeur n'est jamais écrit en toutes lettres ici (test-garde-apports.js)

// ── 1. le jugement pur
const P = E.perimetre({ racine: RACINE, nomBanc: 'test-x.js', env: {} });
const ok = c => E.autorise(c, P).ok;
H.v('autorisé : un fichier du dépôt, le dossier temporaire du système, le cache mongod du dépôt', [ok(path.join(RACINE, 'package.json')), ok(path.join(os.tmpdir(), 'x.json')), ok(path.join(RACINE, '.banc-local', 'cache-mongod', 'mongod.exe'))], [true, true, true]);
H.v('autorisé : un chemin RELATIF qui reste dans le dépôt (résolu depuis le dossier courant)', ok(path.relative(process.cwd(), path.join(RACINE, 'package.json'))), true);
H.v('refusé : le dossier PARENT du dépôt, un voisin, et un chemin construit par « .. » qui ressort du dépôt', [ok(path.join(RACINE, '..', 'x.txt')), ok(path.join(RACINE, '..', 'pokemon-proxy', BAS, 'x.png')), ok(path.join(RACINE, 'v2', '..', '..', 'voisin', 'a'))], [false, false, false]);
H.v('refusé : un dossier dont le nom COMMENCE comme celui du dépôt (préfixe de chaîne, pas de dossier)', ok(RACINE + '-autre' + path.sep + 'x'), false);
H.v('refusé : un autre « .banc-local\\cache-mongod » que celui du dépôt ou de MONGOMS_DOWNLOAD_DIR', ok(path.join(path.dirname(RACINE), 'ailleurs', '.banc-local', 'cache-mongod', 'x')), false);
{
    const desktop = path.join(os.homedir(), 'Desktop');
    const Pf = nom => E.perimetre({ racine: RACINE, nomBanc: nom, env: {} });
    const site = path.join(desktop, 'rat-market-site', 'archives', 'CORRECTION-ILLUSTRATEURS.json');
    H.v('une exception NOMMÉE passe pour son fichier seulement (test-collection-forme.js : un fichier de données du site), jamais pour un autre', [E.autorise(site, Pf('test-collection-forme.js')).ok, E.autorise(site, Pf('test-autre.js')).ok], [true, false]);
    H.v('   le DOSSIER PARENT d\'une exception n\'est pas permis (le Bureau entier, ni un voisin du site)', [E.autorise(desktop, Pf('test-collection-forme.js')).ok, E.autorise(path.join(desktop, 'rat-market-site-2', 'x'), Pf('test-collection-forme.js')).ok], [false, false]);
    // Tour 3 (M-E) : test-collection-forme.js lit TROIS fichiers du site, en lecture seule ; plus la clé nue qui ouvrait le site entier (son .env compris) en lecture ET écriture
    const sj = f => path.join(desktop, 'rat-market-site', ...f.split('/')), Pcf = Pf('test-collection-forme.js');
    H.v('test-collection-forme.js : les trois fichiers lus passent en lecture, aucune ÉCRITURE, ni le .env du site, ni un autre fichier du site, ni le dossier du site',
        [['archives/CORRECTION-ILLUSTRATEURS.json', 'lib/logos-officiels.json', 'LISTE-FICHES-SANS-VISUEL.json'].map(f => E.autorise(sj(f), Pcf, { ecriture: false }).ok), E.autorise(sj('lib/logos-officiels.json'), Pcf, { ecriture: true }).ok, E.autorise(sj('.env'), Pcf).ok, E.autorise(sj('lib/autre.ts'), Pcf).ok, E.autorise(path.join(desktop, 'rat-market-site'), Pcf).ok],
        [[true, true, true], false, false, false, false]);
    const voisin = path.join(path.dirname(RACINE), 'rat-market-site', 'lib', 'x.ts');
    H.v('   le même chemin nommé, trouvé depuis le dossier PARENT du checkout (copie de travail), passe pour son fichier seulement ; un autre voisin non', [E.autorise(voisin, Pf('test-chargeur-regle-site.js')).ok, E.autorise(voisin, Pf('test-autre.js')).ok, E.autorise(path.join(path.dirname(RACINE), 'autre-voisin', 'x'), Pf('test-chargeur-regle-site.js')).ok], [true, false, false]);
    H.v('   les exceptions sont CELLES de _apports-exceptions.js (une seule définition, partagée avec test-garde-apports.js)', Object.keys(require('./_apports-exceptions').EXCEPTIONS).includes('test-collection-forme.js'), true);
    // Tour 1 (I-3) : les deux bancs chargeur n'ont droit qu'à la LECTURE de rat-market-site/lib
    const lib = path.join(desktop, 'rat-market-site', 'lib', 'x.ts'), env = path.join(desktop, 'rat-market-site', '.env');
    const Pc = Pf('test-chargeur-decision.js');
    H.v('exception en LECTURE SEULE : lire rat-market-site/lib passe, y ÉCRIRE non, lire ailleurs dans le site (.env) non, pour les deux bancs chargeur',
        [E.autorise(lib, Pc, { ecriture: false }).ok, E.autorise(lib, Pc, { ecriture: true }).ok, E.autorise(env, Pc, { ecriture: false }).ok, E.autorise(lib, Pf('test-chargeur-regle-site.js'), { ecriture: false }).ok, E.autorise(lib, Pf('test-chargeur-regle-site.js'), { ecriture: true }).ok],
        [true, false, false, true, false]);
    // Tour 1 (I-3) : une clé d'exception vide, « . », « .. », absolue, racine, le Bureau entier, ou dans un dossier d'apports est REFUSÉE au chargement (valider)
    const V = require('./_apports-exceptions');
    const leve = (ex, ls = {}) => { try { V.valider(ex, ls); return false; } catch (e) { return /exception/i.test(e.message); } };
    H.vrai('   _apports-exceptions.js exporte valider', typeof V.valider === 'function');
    if (typeof V.valider === 'function') {
        const mal = { '(vide)': '', '(blancs)': '  ', '.': '.', '..': '..', 'a/../..': 'a/../..', '/': '/', '\\': '\\', 'lecteur': 'C:/', 'absolu': ['C:', 'Users', 'x', 'Desk' + 'top', 'y'].join('/'), 'le Bureau': 'Desk' + 'top', 'sous le Bureau': 'Desk' + 'top/x', 'dans le dossier du testeur': `pokemon-proxy/${BAS}/x`, 'dossier des apports manuels': ['apport', 'manuel'].join('-'), 'photos du verrou': ['verrou', 'photos'].join('/'), 'segment vide': 'a//b', 'finit par /': 'a/',
            // Tour 2 (I-A) : un ANCÊTRE d'un dossier d'apports ouvre le dossier d'apports lui-même (le dépôt du testeur contient les dossiers du testeur)
            'ancêtre : le dépôt principal': 'pokemon-proxy', 'ancêtre : casse': 'Pokemon-Proxy', 'ancêtre : verrou': 'pokemon-proxy/verrou', 'ancêtre : le dépôt de l\'API': 'pokemon-proxy-api-v2', 'ancêtre : verrou de l\'API': 'pokemon-proxy-api-v2/verrou',
            'égal à un dossier d\'apports : LOGO': 'LOGO', 'égal : logo': 'logo', 'nom court 8.3': 'LOGOFR~1', 'joker': 'Logo*', 'point final': 'rat-market-site/lib.', 'espace final': 'rat-market-site/lib ',
            // Tour 3 (I-B) : un DESCENDANT d'un dossier protégé ouvre le dossier du testeur par le dessous (toute casse, toute profondeur)
            'descendant : LOGO/sub': 'LOGO/sub', 'descendant : casse': 'logo/x.png', 'descendant : dossier du testeur': `${BAS}/x`, 'descendant : profond': ['apport', 'manuel'].join('-') + '/a/b', 'descendant : photos du verrou': ['verrou', 'photos'].join('/') + '/y', 'descendant sous le dépôt': `pokemon-proxy/${BAS}/a/b/c`, 'descendant des photos sous le dépôt de l\'API': 'pokemon-proxy-api-v2/' + ['verrou', 'photos'].join('/') + '/y',
            // Tour 3 (M-E) : une clé qui ouvrirait un fichier .env (le sien, ou celui d'un dossier qu'elle contient) est refusée
            'la clé nue du site (contient son .env)': 'rat-market-site', 'le .env du site': 'rat-market-site/.env', 'un .env sous lib': 'rat-market-site/lib/.env', 'un .env.local': 'rat-market-site/lib/.env.local' };
        H.v('   valider REFUSE (ligne par ligne) : ' + Object.keys(mal).join(' · '), Object.fromEntries(Object.entries(mal).map(([n, k]) => [n, leve({ 'test-x.js': { [k]: 'raison' } })])), Object.fromEntries(Object.keys(mal).map(n => [n, true])));
        H.v('   valider accepte les clés légitimes et exige une raison écrite', [leve({ 'test-x.js': { 'rat-market-site/lib': 'r', 'extension v2/src/fond/fausses': 'r' } }), leve({ 'test-x.js': { 'rat-market-site/lib': '' } })], [false, true]);
        H.v('   valider accepte les clés PRÉCISES déjà en usage (sauvegarde de lot, cache mongod, journal du plan, labo)', leve({ 'test-x.js': { 'pokemon-proxy/backup-2026-10-10-lot-075226': 'r', 'pokemon-proxy-api-v2/.superpowers/sdd/PLAN-API-V2/progress.md': 'r', 'pokemon-proxy/.banc-local/cache-mongod': 'r', 'labo-embedding/rm/fixtures-g': 'r' } }), false);
        H.v('   MUTATION M1 de la relecture 2 : la liste réelle + « pokemon-proxy » ajouté à un banc chargeur est refusée au chargement ; idem « LOGO »',
            [leve({ ...V.EXCEPTIONS, 'test-chargeur-decision.js': { ...V.EXCEPTIONS['test-chargeur-decision.js'], 'pokemon-proxy': 'r' } }, V.LECTURE_SEULE), leve({ ...V.EXCEPTIONS, 'test-chargeur-decision.js': { ...V.EXCEPTIONS['test-chargeur-decision.js'], LOGO: 'r' } }, V.LECTURE_SEULE)], [true, true]);
        H.v('   la liste réelle passe valider (sinon le module ne se chargerait pas)', leve(V.EXCEPTIONS, V.LECTURE_SEULE), false);
        H.v('   une entrée LECTURE_SEULE qui ne désigne aucune exception du fichier est refusée', (() => { try { V.valider(V.EXCEPTIONS, { 'test-x.js': ['rat-market-site/lib'] }); return false; } catch { return true; } })(), true);
    }
}
{
    const ext = path.join(path.dirname(os.homedir()), 'zz-cache-b2b'), cache = path.join(ext, '.banc-local', 'cache-mongod');    // hors dépôt ET hors dossier temporaire
    H.v('MONGOMS_DOWNLOAD_DIR n\'ouvre que s\'il se termine par .banc-local\\cache-mongod (sans lui : refusé)', [E.autorise(path.join(cache, 'a'), E.perimetre({ racine: RACINE, nomBanc: 'x.js', env: { MONGOMS_DOWNLOAD_DIR: cache } })).ok,
        E.autorise(path.join(ext, 'autre', 'a'), E.perimetre({ racine: RACINE, nomBanc: 'x.js', env: { MONGOMS_DOWNLOAD_DIR: path.join(ext, 'autre') } })).ok,
        E.autorise(path.join(cache, 'a'), E.perimetre({ racine: RACINE, nomBanc: 'x.js', env: {} })).ok], [true, false, false]);
}

// ── 2. des suites FABRIQUÉES, jouées dans un processus enfant armé (-r)
const jetable = fs.mkdtempSync(path.join(__dirname, '.jetable-espion-'));
const rouler = (nom, code, { env = {} } = {}) => {
    const f = path.join(jetable, nom); fs.writeFileSync(f, code);
    const r = spawnSync(process.execPath, ['-r', ARME, f], { encoding: 'utf8', timeout: 60000, env: { ...process.env, RACINE_TEST: RACINE, BAS_TEST: BAS, HORS_TEST: path.join(path.dirname(RACINE), 'hors-espion-b2b-inexistant'), ...env } });
    let res = null; try { res = JSON.parse((r.stdout.match(/RESULTAT (\{.*\})/) || [])[1]); } catch { /* sortie sans résultat */ }
    return { status: r.status, res, sortie: `${r.stdout}${r.stderr}` };
};
const ENTETE = `const fs = require('fs'), path = require('path'), os = require('os'); const R = process.env.RACINE_TEST, BAS = process.env.BAS_TEST, HORS = process.env.HORS_TEST; const r = {};
const essai = async (k, f) => { try { await f(); r[k] = 'passe'; } catch (e) { r[k] = e.code || e.message; } };\n(async () => {\n`;
const FIN = `\nconsole.log('RESULTAT ' + JSON.stringify(r)); })();\n`;
try {
    const lit = rouler('suite-lit-dehors.js', ENTETE + `
        await essai('lecture-construite', () => fs.readFileSync(path.join(R, '..', 'pokemon-proxy', BAS, 'x.png')));
        await essai('ecriture-dehors', () => fs.writeFileSync(path.join(HORS, 'x.txt'), 'a'));
        await essai('promesse', () => fs.promises.readFile(path.join(R, '..', 'pokemon-proxy', BAS, 'y.png')));
        await essai('flux', () => fs.createReadStream(path.join(R, '..', 'pokemon-proxy', BAS, 'z.png')));
        await essai('liste', () => fs.readdirSync(path.join(R, '..', 'pokemon-proxy', BAS)));
        await essai('copie', () => fs.copyFileSync(path.join(R, 'package.json'), path.join(HORS, 'copie.json')));
        await essai('rappel', () => new Promise((ok, ko) => fs.readFile(path.join(R, '..', 'pokemon-proxy', BAS, 'w.png'), e => (e ? ko(e) : ok()))));
        await essai('suppression', () => fs.rmSync(path.join(HORS, 'x.txt'), { force: true }));` + FIN);
    const att = Object.fromEntries(['lecture-construite', 'ecriture-dehors', 'promesse', 'flux', 'liste', 'copie', 'rappel', 'suppression'].map(k => [k, 'ESPION_FS']));
    H.v('une suite qui LIT par un chemin construit (..\\pokemon-proxy\\<dossier du testeur>\\x.png) : ESPION_FS, jamais la lecture', lit.res && lit.res['lecture-construite'], 'ESPION_FS');
    H.v('   écriture hors périmètre, API à promesses, flux, listage, copie, rappel, suppression : tous ESPION_FS (espion cassé : ENOENT)', lit.res, att);
    H.v('   la suite ÉCHOUE (code 1) et la sortie NOMME le chemin refusé', [lit.status, lit.sortie.includes(path.join(path.dirname(RACINE), 'pokemon-proxy', BAS, 'x.png')), lit.sortie.includes('hors périmètre')], [1, true, true]);

    const dedans = rouler('suite-dedans.js', ENTETE + `
        await essai('depot', () => fs.readFileSync(path.join(R, 'package.json')));
        const t = fs.mkdtempSync(path.join(os.tmpdir(), 'espion-ok-')); await essai('tmp', () => { fs.writeFileSync(path.join(t, 'a.txt'), 'a'); fs.readFileSync(path.join(t, 'a.txt')); fs.rmSync(t, { recursive: true, force: true }); });
        await essai('cache-mongod', () => fs.readdirSync(path.join(R, '.banc-local', 'cache-mongod', 'inexistant')));
        await essai('descripteur', () => { const fd = fs.openSync(path.join(R, 'package.json'), 'r'); fs.closeSync(fd); });
        await essai('promesse-depot', () => fs.promises.readFile(path.join(R, 'package.json')));` + FIN);
    H.v('une suite qui reste dans le dépôt, le dossier temporaire et le cache mongod : aucune erreur de l\'espion, code 0 (le cache absent donne ENOENT, pas ESPION_FS)',
        [dedans.status, dedans.res], [0, { depot: 'passe', tmp: 'passe', 'cache-mongod': 'ENOENT', descripteur: 'passe', 'promesse-depot': 'passe' }]);

    const lireSite = `await essai('site', () => fs.readFileSync(path.join(os.homedir(), 'Desktop', 'rat-market-site', 'lib', 'logos-officiels.json')));`;
    const nommee = rouler('test-collection-forme.js', ENTETE + lireSite + FIN), autre = rouler('test-autre-banc.js', ENTETE + lireSite + FIN);
    H.v('exception nommée : test-collection-forme.js lit un fichier de données du site (lu ou ENOENT : permis), test-autre-banc.js non (ESPION_FS, code 1)', [['passe', 'ENOENT'].includes(nommee.res && nommee.res.site), nommee.status, autre.res && autre.res.site, autre.status], [true, 0, 'ESPION_FS', 1]);

    // ── 2 bis. TOUR 1 (I-2) : l'espion juge le chemin RÉEL — une JONCTION du dépôt vers l'extérieur est vue (le vecteur de l'incident du 2026-10-12).
    // Le dossier témoin est créé HORS du dépôt par cmd (le banc, lui-même espionné, ne pourrait pas) ; la jonction est retirée par `rmdir` NON récursif AVANT tout nettoyage récursif.
    const temoin = path.join(path.dirname(RACINE), '_temoin-espion-b2b'), lien = path.join(jetable, 'lien');
    const cmd = (...a) => spawnSync('cmd', ['/c', ...a], { encoding: 'utf8' });
    let jonctionPosee = false;
    // un petit script d'aide (dans le dossier temporaire, lancé SANS l'espion) crée et retire le dossier témoin HORS du dépôt ; jamais de suppression récursive
    const aide = path.join(os.tmpdir(), `espion-aide-${process.pid}.js`);
    fs.writeFileSync(aide, `const fs = require('fs'), path = require('path'); const [, , cmdAide, t] = process.argv;
        if (cmdAide === 'creer') { fs.mkdirSync(t, { recursive: true }); fs.writeFileSync(path.join(t, 'x.txt'), 'temoin'); }
        else { for (const f of ['x.txt', 'y.txt']) { try { fs.unlinkSync(path.join(t, f)); } catch { /* absent */ } } try { fs.rmdirSync(t); } catch { /* absent ou non vide */ } }`);
    const aider = (c) => spawnSync(process.execPath, [aide, c, temoin], { encoding: 'utf8' });
    try {
        aider('creer');
        jonctionPosee = cmd('mklink', '/J', lien, temoin).status === 0;
        H.vrai('(mise en place) la jonction du dépôt vers le dossier témoin existe', jonctionPosee && fs.existsSync(path.join(lien, 'x.txt')));
        const jon = rouler('suite-jonction.js', ENTETE + `
        await essai('lecture-par-jonction', () => fs.readFileSync(path.join(process.env.LIEN_TEST, 'x.txt')));
        await essai('liste-par-jonction', () => fs.readdirSync(process.env.LIEN_TEST));
        await essai('ecriture-par-jonction', () => fs.writeFileSync(path.join(process.env.LIEN_TEST, 'y.txt'), 'a'));` + FIN, { env: { LIEN_TEST: lien } });
        H.v('une jonction DANS le dépôt vers un dossier hors périmètre : lecture, listage et écriture par elle sont ESPION_FS (le chemin RÉEL est jugé), code 1', [jon.res, jon.status],
            [{ 'lecture-par-jonction': 'ESPION_FS', 'liste-par-jonction': 'ESPION_FS', 'ecriture-par-jonction': 'ESPION_FS' }, 1]);
        H.vrai('   et rien n\'a été écrit dans le dossier témoin par elle', !fs.existsSync(path.join(temoin, 'y.txt')));
    } finally {
        if (jonctionPosee) cmd('rmdir', lien);                                  // NON récursif : la cible n'est pas touchée
        aider('nettoyer'); fs.unlinkSync(aide);
    }
    H.vrai('   (nettoyage) la jonction est retirée avant tout nettoyage récursif', !fs.existsSync(lien));

    // les opérations que la première version laissait passer (openAsBlob, glob, watch, watchFile, opendir, cp) : toutes ESPION_FS sur une cible hors périmètre
    const ops = rouler('suite-ops.js', ENTETE + `
        const g = (k, f) => (f ? essai(k, f) : (r[k] = 'absent'));
        await g('openAsBlob', fs.openAsBlob && (() => fs.openAsBlob(path.join(HORS, 'a.txt'))));
        await g('globSync', fs.globSync && (() => fs.globSync('*', { cwd: HORS })));
        await g('globSync-absolu', fs.globSync && (() => fs.globSync(path.join(HORS, '*.txt'))));
        await g('glob-promesse', fs.promises.glob && (async () => { for await (const x of fs.promises.glob('*', { cwd: HORS })) { void x; } }));
        await g('watch', () => { const w = fs.watch(HORS); w.close(); });
        await g('watchFile', () => { const w = fs.watchFile(path.join(HORS, 'a.txt'), () => { }); fs.unwatchFile(path.join(HORS, 'a.txt')); return w; });
        await g('opendirSync', () => fs.opendirSync(HORS));
        await g('opendir', () => fs.promises.opendir(HORS));
        await g('cpSync', () => fs.cpSync(path.join(R, 'package.json'), path.join(HORS, 'b.json')));
        await g('cp-promesse', () => fs.promises.cp(path.join(R, 'package.json'), path.join(HORS, 'c.json')));
        await g('mkdtemp', () => fs.mkdtempSync(path.join(HORS, 'z-')));` + FIN);
    const dispo = ops.res || {};
    H.v('openAsBlob, glob (relatif et absolu, synchrone et à promesse), watch, watchFile, opendir, cp, mkdtemp hors périmètre : tous ESPION_FS (une API absente de ce Node est dite « absent »)',
        Object.fromEntries(Object.entries(dispo).map(([k, v]) => [k, v === 'absent' ? 'ESPION_FS' : v])),
        Object.fromEntries(Object.keys(dispo).map(k => [k, 'ESPION_FS'])));
    H.vrai('   au moins 9 de ces 11 opérations existent dans ce Node (le test éprouve quelque chose)', Object.values(dispo).filter(v => v !== 'absent').length >= 9);

    // Tour 2 (M-1) : un chemin donné autrement qu'en chaîne est jugé aussi — Uint8Array, Buffer, URL file: ; un objet qui n'est pas un chemin (ni descripteur) est refusé
    const formes = rouler('suite-formes.js', ENTETE + `
        const cible = path.join(HORS, 'a.txt'), { pathToFileURL } = require('url');
        await essai('uint8array', () => fs.readFileSync(new Uint8Array(Buffer.from(cible))));
        await essai('vue-sur-un-tampon', () => { const b = Buffer.from('xx' + cible); return fs.readFileSync(new Uint8Array(b.buffer, b.byteOffset + 2, b.length - 2)); });
        await essai('buffer', () => fs.readFileSync(Buffer.from(cible)));
        await essai('url-file', () => fs.readFileSync(pathToFileURL(cible)));
        await essai('promesse-uint8array', () => fs.promises.readFile(new Uint8Array(Buffer.from(cible))));
        await essai('objet-inconnu', () => fs.readFileSync({ toString: () => cible }));
        await essai('descripteur-numerique', () => fs.closeSync(fs.openSync(path.join(R, 'package.json'), 'r')));` + FIN);
    H.v('un chemin en Uint8Array (même vue sur un tampon plus grand), Buffer, URL file: ou objet quelconque hors périmètre : ESPION_FS ; un descripteur numérique reste permis',
        formes.res, { uint8array: 'ESPION_FS', 'vue-sur-un-tampon': 'ESPION_FS', buffer: 'ESPION_FS', 'url-file': 'ESPION_FS', 'promesse-uint8array': 'ESPION_FS', 'objet-inconnu': 'ESPION_FS', 'descripteur-numerique': 'passe' });
    // Tour 2 (M-2) : les cibles des jonctions node_modules d'une copie de travail sont en LECTURE seule
    {
        const reelNm = (() => { try { return fs.realpathSync(path.join(RACINE, 'node_modules')); } catch { return null; } })();
        const jonction = reelNm !== null && path.relative(RACINE, reelNm).startsWith('..');
        if (jonction) {
            const nm = rouler('suite-node-modules.js', ENTETE + `
                await essai('lit-node-modules', () => fs.readFileSync(path.join(R, 'node_modules', '.package-lock.json')));
                await essai('ecrit-node-modules', () => fs.writeFileSync(path.join(R, 'node_modules', '_inexistant-dossier-b2b', 'x.txt'), 'a'));
                await essai('supprime-node-modules', () => fs.rmSync(path.join(R, 'node_modules', '_inexistant-b2b'), { recursive: true, force: true }));
                await essai('ecrit-banc-local-nm', () => fs.writeFileSync(path.join(R, '.banc-local', 'node_modules', '_inexistant-dossier-b2b', 'x.txt'), 'a'));` + FIN);
            H.v('la copie de travail (node_modules est une jonction vers main) : la LECTURE par la jonction passe, toute ÉCRITURE ou suppression est ESPION_FS',
                [nm.res && ['passe', 'ENOENT'].includes(nm.res['lit-node-modules']), nm.res && nm.res['ecrit-node-modules'], nm.res && nm.res['supprime-node-modules'], nm.res && nm.res['ecrit-banc-local-nm']], [true, 'ESPION_FS', 'ESPION_FS', 'ESPION_FS']);
        } else console.log('   (node_modules n\'est pas une jonction hors du dépôt dans ce checkout : le cas « copie de travail » n\'est pas joué ici)');
    }

    // exceptions LECTURE SEULE (I-3) : les bancs chargeur ne lisent que rat-market-site/lib
    const site = `const SITE = path.join(os.homedir(), 'Desktop', 'rat-market-site');
        await essai('lit-lib', () => fs.readFileSync(path.join(SITE, 'lib', 'inexistant-b2b.ts')));
        await essai('ecrit-lib', () => fs.writeFileSync(path.join(SITE, 'lib', '_inexistant-dossier-b2b', 'x.txt'), 'a'));
        await essai('lit-hors-lib', () => fs.readFileSync(path.join(SITE, '.env')));
        await essai('liste-site', () => fs.readdirSync(SITE));
        await essai('copie-depuis-lib', () => fs.copyFileSync(path.join(SITE, 'lib', 'inexistant-b2b.ts'), path.join(os.tmpdir(), 'espion-copie-inexistante.ts')));
        await essai('copie-vers-lib', () => fs.copyFileSync(path.join(R, 'package.json'), path.join(SITE, 'lib', '_inexistant-dossier-b2b', 'p.json')));`;
    const ch = rouler('test-chargeur-regle-site.js', ENTETE + site + FIN);
    H.v('un banc chargeur : LIT rat-market-site/lib (ENOENT : permis), jamais d\'écriture, rien hors de lib (.env, listage du site), copie DEPUIS lib permise, VERS lib refusée',
        ch.res, { 'lit-lib': 'ENOENT', 'ecrit-lib': 'ESPION_FS', 'lit-hors-lib': 'ESPION_FS', 'liste-site': 'ESPION_FS', 'copie-depuis-lib': 'ENOENT', 'copie-vers-lib': 'ESPION_FS' });

    // ── 3. lancer-tout arme l'espion pour chaque suite qu'il lance
    fs.writeFileSync(path.join(jetable, 'test-fabrique-dehors.js'), ENTETE + `await essai('x', () => fs.readFileSync(path.join(R, '..', 'pokemon-proxy', BAS, 'x.png')));` + FIN + `console.log('1 réussis, 0 échoués');\n`);
    for (const f of fs.readdirSync(jetable)) if (f !== 'test-fabrique-dehors.js') fs.unlinkSync(path.join(jetable, f));      // la jonction est déjà retirée : il ne reste que des fichiers
    const lt = spawnSync(process.execPath, [LANCEUR, `--dossier=${jetable}`], { encoding: 'utf8', env: { ...process.env, RACINE_TEST: RACINE, BAS_TEST: BAS } });
    H.v('lancer-tout : une suite qui lit hors périmètre par un chemin construit est EN ÉCHEC (code 1, « 1 en échec ») et le chemin est nommé',
        [lt.status, /1 fichier\(s\), 1 en échec/.test(lt.stdout), lt.stdout.includes('hors périmètre')], [1, true, true]);
} finally { fs.rmSync(jetable, { recursive: true, force: true }); }
// Intégration (OUTIL-RETRAIT) : l'ouverture ÉTROITE de test-retirer-worktree.js — un voisin du dossier temporaire dont le nom commence par son préfixe, ce fichier seulement, rien d'autre
{
    const parentTemp = path.dirname(os.tmpdir()), PRE = 'rm-retrait-horstemp-';
    const Pr = E.perimetre({ racine: RACINE, nomBanc: 'test-retirer-worktree.js', env: {} }), Pa = E.perimetre({ racine: RACINE, nomBanc: 'test-autre.js', env: {} });
    H.v('test-retirer-worktree.js : le préfixe nu (argument de mkdtemp) et le dossier créé passent ; un autre nom, un dossier existant du parent du temporaire, le parent lui-même et le Bureau sont refusés ; un autre banc n\'a pas l\'ouverture', [
        E.autorise(path.join(parentTemp, PRE), Pr, { ecriture: true }).ok, E.autorise(path.join(parentTemp, `${PRE}AbC123`, 'x', 'y'), Pr, { ecriture: true }).ok,
        E.autorise(path.join(parentTemp, 'rm-retrait-autre-AbC123'), Pr, { ecriture: true }).ok, E.autorise(path.join(parentTemp, 'Programs'), Pr, { ecriture: true }).ok,
        E.autorise(parentTemp, Pr, { ecriture: true }).ok, E.autorise(path.join(os.homedir(), 'Desktop', `${PRE}x`), Pr, { ecriture: true }).ok,
        E.autorise(path.join(parentTemp, `${PRE}AbC123`), Pa, { ecriture: true }).ok], [true, true, false, false, false, false, false]);
    const LAD = path.join(os.tmpdir(), '..', 'Local-fictif'), envL = { LOCALAPPDATA: LAD };
    const Pl = E.perimetre({ racine: RACINE, nomBanc: 'test-retirer-worktree.js', env: envL }), Pn = E.perimetre({ racine: RACINE, nomBanc: 'test-autre.js', env: envL });
    H.v('test-retirer-worktree.js : %LOCALAPPDATA%\\GitHubDesktop se LIT (jamais écrit) ; le parent, un autre dossier et un autre banc sont refusés', [
        E.autorise(path.join(LAD, 'GitHubDesktop'), Pl).ok, E.autorise(path.join(LAD, 'GitHubDesktop', 'app-1'), Pl).ok, E.autorise(path.join(LAD, 'GitHubDesktop', 'app-1'), Pl, { ecriture: true }).ok,
        E.autorise(LAD, Pl).ok, E.autorise(path.join(LAD, 'Autre'), Pl).ok, E.autorise(path.join(LAD, 'GitHubDesktop'), Pn).ok], [true, true, false, false, false, false]);
    const { valider } = require('./_apports-exceptions');
    const refuse = v => { try { valider({}, {}, v); return false; } catch { return true; } };
    H.v('la liste des voisins est validée : préfixe court, sans « rm- », avec séparateur ou joker, ou nommant un dossier d\'apports : refusé ; le préfixe réel passe', [refuse({ 'x.js': ['rm-a'] }), refuse({ 'x.js': ['retrait-horstemp-'] }), refuse({ 'x.js': ['rm-retrait-horstemp-/..'] }), refuse({ 'x.js': ['rm-retrait-*-xxxxxx'] }), refuse({ 'x.js': [['rm-apport', 'manuel-xx'].join('-')] }), refuse({ 'x.js': [PRE] })], [true, true, true, true, true, false]);
}
H.bilan();
