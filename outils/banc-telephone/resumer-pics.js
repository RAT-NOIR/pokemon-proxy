'use strict';
// Résume des sorties de pilote-memoire.js (--json=) : les PICS EXACTS du système (psapi : PeakPagefileUsage = la mémoire PRIVÉE au plus haut ; PeakWorkingSet64 = la mémoire résidente au plus haut), tenus par Windows lui-même,
// sans échantillonnage, pour le plus gros processus de rendu (la page) et le processus GPU. Les tailles de mémoire linéaire WebAssembly et le recensement des tampons WebGPU sont rappelés quand ils sont là.
//   node outils\banc-telephone\resumer-pics.js a.json b.json …
const fs = require('fs');
const med = a => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const lignes = [];
for (const f of process.argv.slice(2)) {
    const r = JSON.parse(fs.readFileSync(f, 'utf8')).resume, p = r.picsSysteme || {}, rd = p.renderer || {}, g = p.GPU || {};
    lignes.push({ priv: rd.memoirePriveeMo, ws: rd.workingSetMo, gpu: g.memoirePriveeMo });
    console.log(`${f.split(/[\\/]/).pop()} : rendu privé ${rd.memoirePriveeMo} Mo (résident ${rd.workingSetMo}) · GPU privé ${g.memoirePriveeMo} Mo (résident ${g.workingSetMo})` + (r.memoiresLineaires ? ` · mémoires WASM ${JSON.stringify(r.memoiresLineaires)}` : '') + (r.tamponsGpu ? ` · tampons WebGPU n=${r.tamponsGpu.n} total ${r.tamponsGpu.totalMo} Mo plus gros ${r.tamponsGpu.maxMo} Mo pic vivants ${r.tamponsGpu.picVivantsMo} Mo` : ''));
}
if (lignes.length > 1) console.log(`médiane : rendu privé ${med(lignes.map(l => l.priv))} Mo (min-max ${Math.min(...lignes.map(l => l.priv))}-${Math.max(...lignes.map(l => l.priv))}) · rendu résident ${med(lignes.map(l => l.ws))} Mo · GPU privé ${med(lignes.map(l => l.gpu))} Mo`);
