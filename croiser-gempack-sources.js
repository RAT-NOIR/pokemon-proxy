// Lit les pages en cache (SC, PC) et le relevé ppr, les croise (sources-gempack.js) et écrit croisements/<code>.json. AUCUN réseau, AUCUNE base.
// Usage : node croiser-gempack-sources.js [--codes=CBB4C,CBB5C]
const fs = require('fs'), path = require('path');
const G = require('./collecte-cartes/sources-gempack');
const RACINE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8';
const CACHE = RACINE + '/GEMPACK-SOURCES/cache', SORTIE = RACINE + '/GEMPACK-SOURCES/croisements';
const ARGS = Object.fromEntries(process.argv.slice(2).map(a => { const m = /^--([^=]+)=?(.*)$/.exec(a); return [m[1], m[2] === '' ? true : m[2]]; }));
const SETS = [
    { code: 'CBB1C', exp: 6001, slug: 'gem-pack-vol-1-card-list' }, { code: 'CBB2C', exp: 6111, slug: 'gem-pack-vol-2-card-list' }, { code: 'CBB3C', exp: 6292, slug: 'gem-pack-vol-3-card-list' },
    { code: 'CBB4C', exp: 6447, slug: 'gem-pack-vol-4-card-list' }, { code: 'CBB5C', exp: 6544, slug: 'gem-pack-vol-5-card-list' }, { code: 'CBB6C', exp: 6669, slug: 'gem-pack-vol-6-card-list' }
];
const ppr = JSON.parse(fs.readFileSync(RACINE + '/RECOLTE/releves-ppr.json', 'utf8'));
fs.mkdirSync(SORTIE, { recursive: true });
const resume = {};
for (const s of SETS) {
    if (ARGS.codes && !String(ARGS.codes).split(',').includes(s.code)) continue;
    const f = (g) => path.join(CACHE, `${g}-${s.slug}.html`);
    console.log(`\n■ ${s.code} (exp ${s.exp})`);
    let sc = null, pc = null;
    try { sc = G.lireSimplifiedCollector(fs.readFileSync(f('sc'), 'utf8')); } catch (e) { console.log('   SC : ' + e.message); }
    try { pc = G.lirePokeCottage(fs.readFileSync(f('pc'), 'utf8')); } catch (e) { console.log('   PC : ' + e.message); }
    const p = ppr[s.code] ? G.lirePpr(ppr[s.code]) : null;
    if (sc) console.log(`   SC : ${sc.cartes.length} cartes, ${new Set(sc.cartes.map(c => c.groupe)).size} groupes, anomalies ${sc.anomalies.length} ${JSON.stringify(sc.anomalies.slice(0, 6))}`);
    if (pc) console.log(`   PC : ${pc.cartes.length} cartes, anomalies ${pc.anomalies.length} ${JSON.stringify(pc.anomalies.slice(0, 8).map(a => a.type + ':' + (a.fichier || a.texte || a.position)))}`);
    if (p) console.log(`   ppr : ${p.cartes.length} cartes lues (${p.cartes.filter(c => c.cachee).length} cachées), sans groupe ${p.sansGroupe}`);
    if (!sc) continue;
    const r = G.croiserSources({ sc, pc, ppr: p });
    const types = {}; for (const d of r.discordances) types[d.type] = (types[d.type] || 0) + 1;
    console.log(`   CROISEMENT : ${r.ok ? 'OK' : 'DISCORDANT'} · couverture ${JSON.stringify(r.couverture)} · discordances ${JSON.stringify(types)}`);
    for (const d of r.discordances.slice(0, 12)) console.log('      ' + JSON.stringify(d));
    resume[s.code] = { ok: r.ok, couverture: r.couverture, discordances: types };
    fs.writeFileSync(path.join(SORTIE, `${s.code}.json`), JSON.stringify({ code: s.code, exp: s.exp, le: new Date().toISOString(), ok: r.ok, couverture: r.couverture, discordances: r.discordances, anomaliesSc: sc.anomalies, anomaliesPc: pc ? pc.anomalies : null, cartes: r.cartes }, null, 1));
}
