'use strict';
// MESURE SEULEMENT (banc) — chargé par `-r` DANS le serveur v2 de mesure (index.js réel, faux réseau, base en mémoire). Il charge d'abord le faux réseau du verrou (le serveur de banc ne fait
// aucun réseau réel), puis, dans CE processus, joue le chargeur de production (voie fichier : mêmes executerDepuisFichier + creerChargeur + bascule que le montage) trois fois de suite
// (premier chargement, puis deux rechargements = l'ancienne et la nouvelle version coexistent), en échantillonnant le RSS de TOUT le processus serveur toutes les 20 ms, et imprime une ligne MESURE-SERVEUR-CHARGEUR.
require(require('path').join(__dirname, '..', 'faux-reseau-v2.js'));
if (process.env.MESURE_ARCHIVE) {
    const fs = require('fs'); const path = require('path');
    const Mo = o => Math.round(o / 1048576 * 10) / 10;
    const { monitorEventLoopDelay } = require('perf_hooks');
    setTimeout(async () => {
        const C = require('../../chargeur/chargeur'); const etat = require('../../chargeur/etat');
        const ch = C.creerChargeur({ catalogue: async () => new Map(), executer: C.executerDepuisFichier({ lireFichier: () => fs.promises.readFile(process.env.MESURE_ARCHIVE) }), journal: () => { } });
        const pause = ms => new Promise(r => setTimeout(r, ms));
        const sortie = { baseRssMo: Mo(process.memoryUsage().rss), basePicMo: Mo(process.resourceUsage().maxRSS * 1024), chargements: [] };
        for (let i = 0; i < 3; i++) {
            const h = monitorEventLoopDelay({ resolution: 5 }); h.enable();
            let pic = 0; const t = setInterval(() => { pic = Math.max(pic, process.memoryUsage().rss); }, 20);
            const avant = Mo(process.memoryUsage().rss), t0 = process.hrtime.bigint();
            const r = await ch.charger();
            const ms = Number(process.hrtime.bigint() - t0) / 1e6;
            clearInterval(t); h.disable();
            const juste = Mo(process.memoryUsage().rss);
            await pause(4000);
            sortie.chargements.push({ rang: i + 1, ok: r.ok, ms: Math.round(ms), avantMo: avant, picEchantillonMo: Mo(pic), apresMo: juste, apres4sMo: Mo(process.memoryUsage().rss), retardBoucleMaxMs: Math.round(h.max / 1e6), enMemoire: etat.version() && etat.version().comptes.visuels });
        }
        sortie.picProcessusMo = Mo(process.resourceUsage().maxRSS * 1024);
        console.log('MESURE-SERVEUR-CHARGEUR ' + JSON.stringify(sortie));
    }, 3000).unref();
}
