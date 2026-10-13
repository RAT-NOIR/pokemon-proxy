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
    const site = path.join(desktop, 'rat-market-site', 'lib', 'x.ts');
    H.v('une exception NOMMÉE passe pour son fichier seulement (test-collection-forme.js : le site), jamais pour un autre', [E.autorise(site, Pf('test-collection-forme.js')).ok, E.autorise(site, Pf('test-autre.js')).ok], [true, false]);
    H.v('   le DOSSIER PARENT d\'une exception n\'est pas permis (le Bureau entier, ni un voisin du site)', [E.autorise(desktop, Pf('test-collection-forme.js')).ok, E.autorise(path.join(desktop, 'rat-market-site-2', 'x'), Pf('test-collection-forme.js')).ok], [false, false]);
    const voisin = path.join(path.dirname(RACINE), 'rat-market-site', 'lib', 'x.ts');
    H.v('   le même chemin nommé, trouvé depuis le dossier PARENT du checkout (copie de travail), passe pour son fichier seulement ; un autre voisin non', [E.autorise(voisin, Pf('test-chargeur-regle-site.js')).ok, E.autorise(voisin, Pf('test-autre.js')).ok, E.autorise(path.join(path.dirname(RACINE), 'autre-voisin', 'x'), Pf('test-chargeur-regle-site.js')).ok], [true, false, false]);
    H.v('   les exceptions sont CELLES de _apports-exceptions.js (une seule définition, partagée avec test-garde-apports.js)', Object.keys(require('./_apports-exceptions').EXCEPTIONS).includes('test-collection-forme.js'), true);
}
{
    const ext = path.join(path.dirname(os.homedir()), 'zz-cache-b2b'), cache = path.join(ext, '.banc-local', 'cache-mongod');    // hors dépôt ET hors dossier temporaire
    H.v('MONGOMS_DOWNLOAD_DIR n\'ouvre que s\'il se termine par .banc-local\\cache-mongod (sans lui : refusé)', [E.autorise(path.join(cache, 'a'), E.perimetre({ racine: RACINE, nomBanc: 'x.js', env: { MONGOMS_DOWNLOAD_DIR: cache } })).ok,
        E.autorise(path.join(ext, 'autre', 'a'), E.perimetre({ racine: RACINE, nomBanc: 'x.js', env: { MONGOMS_DOWNLOAD_DIR: path.join(ext, 'autre') } })).ok,
        E.autorise(path.join(cache, 'a'), E.perimetre({ racine: RACINE, nomBanc: 'x.js', env: {} })).ok], [true, false, false]);
}

// ── 2. des suites FABRIQUÉES, jouées dans un processus enfant armé (-r)
const jetable = fs.mkdtempSync(path.join(__dirname, '.jetable-espion-'));
const rouler = (nom, code, { lanceur = false } = {}) => {
    const f = path.join(jetable, nom); fs.writeFileSync(f, code);
    const r = spawnSync(process.execPath, ['-r', ARME, f], { encoding: 'utf8', env: { ...process.env, RACINE_TEST: RACINE, BAS_TEST: BAS, HORS_TEST: path.join(path.dirname(RACINE), 'hors-espion-b2b-inexistant') } });
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

    const lireSite = `await essai('site', () => fs.readFileSync(path.join(os.homedir(), 'Desktop', 'rat-market-site', 'lib', 'inexistant-b2b.ts')));`;
    const nommee = rouler('test-collection-forme.js', ENTETE + lireSite + FIN), autre = rouler('test-autre-banc.js', ENTETE + lireSite + FIN);
    H.v('exception nommée : test-collection-forme.js lit le site (ENOENT : permis), test-autre-banc.js non (ESPION_FS, code 1)', [nommee.res && nommee.res.site, nommee.status, autre.res && autre.res.site, autre.status], ['ENOENT', 0, 'ESPION_FS', 1]);

    // ── 3. lancer-tout arme l'espion pour chaque suite qu'il lance
    fs.writeFileSync(path.join(jetable, 'test-fabrique-dehors.js'), ENTETE + `await essai('x', () => fs.readFileSync(path.join(R, '..', 'pokemon-proxy', BAS, 'x.png')));` + FIN + `console.log('1 réussis, 0 échoués');\n`);
    fs.unlinkSync(path.join(jetable, 'suite-lit-dehors.js')); fs.unlinkSync(path.join(jetable, 'suite-dedans.js')); fs.unlinkSync(path.join(jetable, 'test-collection-forme.js')); fs.unlinkSync(path.join(jetable, 'test-autre-banc.js'));
    const lt = spawnSync(process.execPath, [LANCEUR, `--dossier=${jetable}`], { encoding: 'utf8', env: { ...process.env, RACINE_TEST: RACINE, BAS_TEST: BAS } });
    H.v('lancer-tout : une suite qui lit hors périmètre par un chemin construit est EN ÉCHEC (code 1, « 1 en échec ») et le chemin est nommé',
        [lt.status, /1 fichier\(s\), 1 en échec/.test(lt.stdout), lt.stdout.includes('hors périmètre')], [1, true, true]);
} finally { fs.rmSync(jetable, { recursive: true, force: true }); }
H.bilan();
