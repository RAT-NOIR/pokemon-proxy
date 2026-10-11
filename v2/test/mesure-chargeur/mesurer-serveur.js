'use strict';
// COTES-VISUELS — MESURE de la mémoire de BASE du serveur v2 au repos, en mode banc (le plancher : sans chargement), et du délai jusqu'à l'écoute.
// Banc seulement : base EN MÉMOIRE, faux réseau du verrou, aucune connexion de production. Le RSS du processus enfant est lu au système (Get-Process), jamais deviné.
//   node v2/test/mesure-chargeur/mesurer-serveur.js [--v2=1|0]
const path = require('path'); const { execFileSync } = require('child_process');
const H = require('../_harnais');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const Mo = o => Math.round(o / 1048576 * 10) / 10;
const rss = pid => Number(execFileSync('powershell', ['-NoProfile', '-Command', `(Get-Process -Id ${pid}).WorkingSet64`], { encoding: 'utf8' }).trim());
(async () => {
    await H.ouvrirBancV2();
    const { demarrer, RACINE } = require('../../../verrou/serveur');
    const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js'), CHARGES = path.join(RACINE, 'verrou', 'charges.json');
    const v2 = arg('v2', '1') === '1';
    const t0 = Date.now();
    const srv = await demarrer(FAUX, { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-mesure', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: v2 ? '1' : '' });
    const ecoute = Date.now() - t0;
    const mongo = await srv.attendreMongo();
    const prete = Date.now() - t0;
    const mesures = [];
    for (let i = 0; i < 4; i++) { await new Promise(r => setTimeout(r, 2500)); mesures.push(Mo(rss(srv.enfant.pid))); }
    console.log('MESURE-SERVEUR ' + JSON.stringify({ v2, ecouteMs: ecoute, mongoPretMs: prete, mongo, rssMo: mesures }));
    srv.enfant.kill(); await H.arreterBanc();
    process.exit(0);
})().catch(e => { console.error('❌', e); process.exit(1); });
