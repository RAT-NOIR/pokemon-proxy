'use strict';
// Résume des séries mémoire (pilote-memoire.js --serie=, colonnes t_ms;renduPriveMo;renduResidentMo;gpuPriveMo;etape) : pic ÉCHANTILLONNÉ du rendu (privé), pic GPU, niveau final du rendu (médiane du dernier quart), et les paliers par étape.
// Le pic exact (psapi) est dans le JSON du pilote, lu par resumer-pics.js : l'échantillonnage (~50 ms) peut manquer un pic plus court.
//   node outils\banc-telephone\resumer-series.js a.csv [b.csv …]
const fs = require('fs');
const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
for (const f of process.argv.slice(2)) {
    const l = fs.readFileSync(f, 'utf8').trim().split('\n').slice(1).map(x => x.split(';')), n = l.map(x => ({ t: Number(x[0]), priv: Number(x[1]), res: Number(x[2]), gpu: Number(x[3]), etape: x[4] }));
    const fin = n.slice(Math.floor(n.length * 0.75));
    console.log(`${f.split(/[\\/]/).pop()} : pic échantillonné rendu ${Math.max(...n.map(x => x.priv))} Mo (résident ${Math.max(...n.map(x => x.res))}) · pic GPU ${Math.max(...n.map(x => x.gpu))} Mo · niveau final rendu ${med(fin.map(x => x.priv))} Mo · ${n.length} points`);
    const parEtape = {}; for (const x of n) { const e = (/carte|modele-seul/.test(x.etape) ? x.etape.split('-')[0] + ' : mesures' : x.etape) || '(avant)'; parEtape[e] = Math.max(parEtape[e] || 0, x.priv); }
    console.log('  max rendu privé par étape :', JSON.stringify(parEtape));
}
