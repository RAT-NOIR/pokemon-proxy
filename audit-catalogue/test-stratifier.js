// node audit-catalogue/test-stratifier.js — le tirage en strates de la planche de calibration (200 paires sur toute l'échelle des distances), déterministe par graine.
const { stratifier, binDe } = require('./stratifier');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const vrai = (nom, c, d = '') => verifier(nom + (d ? ` [${d}]` : ''), Boolean(c), true);

const BORNES = [0, 0.1, 0.2, 0.5, 1];
verifier('binDe : la borne basse est incluse, la haute exclue', [binDe(0, BORNES), binDe(0.0999, BORNES), binDe(0.1, BORNES), binDe(0.49, BORNES), binDe(0.5, BORNES)], [0, 0, 1, 2, 3]);
verifier('binDe : 1 (la distance maximale) tombe dans la DERNIÈRE strate, pas dehors', binDe(1, BORNES), 3);
verifier('binDe : une distance hors de [0, 1] ou non finie : -1', [binDe(-0.1, BORNES), binDe(1.2, BORNES), binDe(NaN, BORNES)], [-1, -1, -1]);

// une population dense près de 0, rare près de 1 (comme les vraies distances)
const pop = [];
for (let i = 0; i < 1000; i++) pop.push({ idProduct: i, distance: 0.001 * (i % 90) });          // 0 – 0,089 : 1000 paires
for (let i = 0; i < 100; i++) pop.push({ idProduct: 1000 + i, distance: 0.1 + 0.001 * i });       // 0,1 – 0,199 : 100 (la strate 0,2 – 0,5 reste VIDE)
for (let i = 0; i < 6; i++) pop.push({ idProduct: 2000 + i, distance: 0.6 + 0.05 * i });          // 0,6 – 0,85 : 6 seulement
const S = stratifier(pop, { bornes: BORNES, total: 40, graine: 7 });
verifier('le total demandé est atteint quand la population le permet', S.choisies.length, 40);
verifier('un identifiant n\'est jamais tiré deux fois', new Set(S.choisies.map(x => x.idProduct)).size, S.choisies.length);
verifier('la strate rare est ENTIÈREMENT prise (6 paires disponibles, 6 tirées)', S.choisies.filter(x => binDe(x.distance, BORNES) === 3).length, 6);
verifier('la strate vide (0,2 – 0,5) ne donne rien et le dit', [S.parStrate[2].disponibles, S.parStrate[2].tirees], [0, 0]);
vrai('le reliquat de la strate rare est reversé aux strates denses (aucune ne dépasse sa population)', S.parStrate.every(s => s.tirees <= s.disponibles));
verifier('le compte des strates retombe sur le total', S.parStrate.reduce((n, s) => n + s.tirees, 0), 40);
verifier('le résultat est TRIÉ par distance croissante', S.choisies.every((x, i, a) => i === 0 || a[i - 1].distance <= x.distance), true);
const S2 = stratifier(pop, { bornes: BORNES, total: 40, graine: 7 }), S3 = stratifier(pop, { bornes: BORNES, total: 40, graine: 8 });
verifier('même graine, même tirage', S2.choisies.map(x => x.idProduct), S.choisies.map(x => x.idProduct));
vrai('une autre graine, un autre tirage', JSON.stringify(S3.choisies.map(x => x.idProduct)) !== JSON.stringify(S.choisies.map(x => x.idProduct)));
verifier('population trop petite : on rend ce qui existe, et `manque` le dit', (() => { const p = stratifier(pop.slice(0, 5), { bornes: BORNES, total: 40, graine: 1 }); return [p.choisies.length, p.manque]; })(), [5, 35]);
let leve = false; try { stratifier([], { bornes: BORNES, total: 10, graine: 1 }); } catch { leve = true; }
verifier('une population VIDE LÈVE (un vide n\'est pas un tirage)', leve, true);
leve = false; try { stratifier([{ idProduct: 1, distance: NaN }], { bornes: BORNES, total: 10, graine: 1 }); } catch { leve = true; }
verifier('une population sans aucune distance valide LÈVE', leve, true);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
