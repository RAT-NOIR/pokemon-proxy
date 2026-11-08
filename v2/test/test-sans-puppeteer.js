'use strict';
// SANS-PUPPETEER (ménage du 08/11) — le build Render de l'essai (`npm install`) ne doit plus télécharger puppeteer ni Chromium, et rien de servi ne doit en dépendre.
// Quatre choses : (1) AUCUNE déclaration de puppeteer dans package.json (dependencies, optionalDependencies, devDependencies) ni dans la racine de package-lock.json, et aucun paquet
// puppeteer/chromium-bidi/@puppeteer dans le lock ; (2) le démarrage réel du serveur (require de index.js, v2 montée) ne charge ni puppeteer ni live-cardmarket.js (require.cache ET
// toute demande de module, relevées dans un processus enfant) ; (3) le TÉMOIN : le même relevé voit puppeteer quand live-cardmarket.js est chargé (sans lui, (2) serait vert par construction) ;
// (4) sans puppeteer installé, live-cardmarket.js échoue en disant comment l'installer à la main (outils locaux apprendre-*.js seulement).
const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const RACINE = path.join(__dirname, '..', '..');

if (process.argv[2]) {
    const mode = process.argv[2];
    const Module = require('module'); const demandes = [];
    const orig = Module._load;
    Module._load = function (request, parent, estMain) {
        if (/puppeteer/i.test(request)) {
            demandes.push(request);
            if (mode === 'absent') { const e = new Error(`Cannot find module '${request}'`); e.code = 'MODULE_NOT_FOUND'; throw e; }
            if (mode === 'temoin') return { launch() { } };
        }
        return orig.apply(this, arguments);
    };
    const rapport = (extra) => {
        const charges = Object.keys(require.cache).filter(k => /node_modules\/(@puppeteer|puppeteer)|\/live-cardmarket\.js$/i.test(k.replace(/\\/g, '/')));
        console.log('RAPPORT ' + JSON.stringify({ demandes, charges, ...extra }));
    };
    if (mode === 'serveur') { require(path.join(RACINE, 'index.js')); setTimeout(() => { rapport({}); process.exit(0); }, 500); }
    else {
        try { require(path.join(RACINE, 'live-cardmarket.js')); rapport({ erreur: null }); }
        catch (e) { rapport({ erreur: String(e && e.message || e) }); }
        process.exit(0);
    }
    return;
}

let ok = 0, ko = 0;
const verifier = (cond, msg) => { console.log(`${cond ? '✅' : '🔴'} ${msg}`); cond ? ok++ : ko++; };
const lancer = (mode, env) => {
    const r = spawnSync(process.execPath, [__filename, mode], { cwd: RACINE, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: '0', NODE_ENV: 'test', ...env }, encoding: 'utf8', timeout: 60000 });
    const m = /^RAPPORT (.+)$/m.exec(String(r.stdout || ''));
    return m ? JSON.parse(m[1]) : { illisible: `${r.stdout || ''}\n${r.stderr || ''}`.slice(0, 400) };
};

// (1) déclarations
const pkg = JSON.parse(fs.readFileSync(path.join(RACINE, 'package.json'), 'utf8'));
for (const bloc of ['dependencies', 'optionalDependencies', 'devDependencies', 'peerDependencies']) verifier(!pkg[bloc] || !('puppeteer' in pkg[bloc]), `package.json : puppeteer absent de ${bloc}`);
const lock = JSON.parse(fs.readFileSync(path.join(RACINE, 'package-lock.json'), 'utf8'));
const racineLock = (lock.packages || {})[''] || {};
for (const bloc of ['dependencies', 'optionalDependencies', 'devDependencies']) verifier(!racineLock[bloc] || !('puppeteer' in racineLock[bloc]), `package-lock.json (racine) : puppeteer absent de ${bloc}`);
const residus = Object.keys(lock.packages || {}).filter(k => /node_modules\/(@puppeteer\/|puppeteer(-core)?$|chromium-bidi)/.test(k));
verifier(residus.length === 0, `package-lock.json : aucun paquet puppeteer / puppeteer-core / chromium-bidi / @puppeteer (${residus.length} trouvé(s) ${residus.slice(0, 3).join(', ')})`);

// (2) le démarrage réel, v2 montée et non montée
for (const [nom, env] of [['v2 montée (RM_API_V2=1)', { RM_API_V2: '1' }], ['routes héritées seules', {}]]) {
    const r = lancer('serveur', env);
    verifier(Array.isArray(r.demandes) && r.demandes.length === 0 && r.charges.length === 0, `démarrage de index.js, ${nom} : aucune demande de puppeteer, ni live-cardmarket.js dans require.cache ${r.illisible ? '(sortie illisible : ' + r.illisible + ')' : ''}`);
}

// (3) le témoin : le relevé voit puppeteer quand on le charge
const t = lancer('temoin', {});
verifier(Array.isArray(t.demandes) && t.demandes.includes('puppeteer') && t.charges.some(c => /live-cardmarket/.test(c)), 'témoin : charger live-cardmarket.js est vu par le relevé (le contrôle (2) peut échouer)');

// (4) puppeteer absent : message clair
const a = lancer('absent', {});
verifier(typeof a.erreur === 'string' && /npm install --no-save puppeteer/.test(a.erreur) && /apprendre|outil/i.test(a.erreur), `sans puppeteer, live-cardmarket.js dit comment l'installer à la main (« ${String(a.erreur || a.illisible).slice(0, 160)} »)`);

console.log(`${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
