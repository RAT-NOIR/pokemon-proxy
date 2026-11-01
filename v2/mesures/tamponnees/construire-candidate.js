'use strict';
// GUICHET 01/11 — construit une archive candidate (jamais publiée, jamais --deposer) : le code de v2-guichet (admission (D) tamponnées empruntées), une LISTE FERMÉE (preuve à l'image), les mêmes exclusions et jumbos
// que candidate-2026-10-31b. Sans la liste : TÉMOIN (même code, même source) pour isoler l'effet.
// Usage : node construire-guichet-2026-11-01.js <suffixe> <liste.json>   → candidate-2026-11-01<suffixe>.rmv et temoin-2026-11-01<suffixe>-sans-liste.rmv
const path = require('path'), fs = require('fs');
const { ENV } = require('C:\\Users\\Yung\\rat-market-travail\\api\\atlas\\garde-secrets');
const WT = 'C:\\Users\\Yung\\rat-market-travail\\api\\v2-guichet', ARCH = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\';
const env = { ...process.env, ...ENV };
const JUMBOS_SHA = '194c74e0cc3367c124ac20d3d88fc7391bc3bb8d6b28eacc38df141486f3edc2';
const SUF = process.argv[2] || 'c', LISTE_FICHIER = process.argv[3] || (ARCH + 'tamponnees-empruntees-2026-11-01.json');
(async () => {
    const { principal } = require(path.join(WT, 'v2', 'migrations', 'construire-fichier-visuels.js'));
    const D = require(path.join(WT, 'v2', 'chargeur', 'decision'));
    const { sourceCartes } = require(path.join(WT, 'v2', 'chargeur', 'source'));
    const src = await sourceCartes({ env }); if (!src.ok) { console.log('ARRÊT source :', src.raison); process.exit(1); }
    const liste = new Set(JSON.parse(fs.readFileSync(LISTE_FICHIER, 'utf8')).produits.map(p => p.idProduct));
    console.log('liste fermée :', liste.size, LISTE_FICHIER);
    const commun = [`--catalogue=${ARCH}catalogue-filtre-2026-10-26.json`, `--jumbos-visuel=${ARCH}jumbos-visuel-2026-10-27.json`, `--jumbos-visuel-sha256=${JUMBOS_SHA}`, `--exclure=${ARCH}exclusions-2026-10-31.json`];
    for (const [vers, avec] of [[`candidate-2026-11-01${SUF}.rmv`, true], [`temoin-2026-11-01${SUF}-sans-liste.rmv`, false]]) {
        console.log(`=== ${vers} ===`);
        const decider = args => D.decider({ ...args, ...(avec ? { tamponneesEmpruntees: liste } : {}) });
        const code = await principal(['node', 'x', `--vers=${ARCH}${vers}`, ...commun], env, { source: async () => ({ ...src, fermer: async () => { } }), decider });
        console.log(`${vers} : code ${code}`);
        if (code !== 0) process.exit(code);
    }
    try { await src.fermer(); } catch { }
    process.exit(0);
})().catch(e => { console.log('ERREUR', e && e.message, String(e && e.stack).split('\n').slice(1, 4).join('|')); process.exit(1); });
