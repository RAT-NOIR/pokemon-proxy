'use strict';
// LOT TEMPS-CHAINE — lit <sortie>/appels.jsonl (écrit par mesurer-temps-ia.js) et rend, par variante : le temps, le coût, les jetons, la justesse contre la VÉRITÉ du banc,
// et l'accord avec la variante actuelle (v0) sur les champs que la chaîne lit — le bruit propre à v0 (v0 contre v0b) sert de règle.
//   node v2/mesures/analyser-temps-ia.js <sortie>
const fs = require('fs');
const path = require('path');
const M = require('./mesurer-temps-ia');

const dossier = process.argv[2]; if (!dossier) { console.error('usage : node v2/mesures/analyser-temps-ia.js <sortie>'); process.exit(1); }
const lignes = fs.readFileSync(path.join(dossier, 'appels.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const variantes = [...new Set(lignes.map(l => l.variante))];
const parPhoto = new Map();
for (const l of lignes) { if (!parPhoto.has(l.photo)) parPhoto.set(l.photo, {}); parPhoto.get(l.photo)[l.variante] = l; }
const complets = [...parPhoto.entries()].filter(([, o]) => variantes.every(v => o[v] && o[v].lecture));      // une photo où TOUTES les variantes ont rendu une lecture
console.log(`appels ${lignes.length} · photos ${parPhoto.size} · photos complètes (toutes variantes lues) ${complets.length}`);
const f = x => (x === null || x === undefined) ? '—' : Math.round(x);
const resume = [];
for (const v of variantes) {
    const L = lignes.filter(l => l.variante === v), ok = L.filter(l => l.lecture), erreurs = L.filter(l => !l.lecture);
    const ms = L.map(l => l.ms);
    const verite = ok.map(l => ({ l, n: M.numeroOk(l.lecture.number, l.verite.numero), nom: M.nomOk(l.lecture.name, l.verite.produit), code: M.codeOk(l.lecture.setCode, l.verite.codeSet) }));
    const comptes = { numeroExact: verite.filter(x => x.n === 'exact').length, numeroChiffres: verite.filter(x => x.n === 'chiffres').length, numeroFaux: verite.filter(x => x.n === 'faux').length, numeroAbsent: verite.filter(x => x.n === null).length,
        nomOk: verite.filter(x => x.nom).length, codeJuge: verite.filter(x => x.code !== null).length, codeOk: verite.filter(x => x.code === true).length };
    // accord avec v0 sur les photos complètes
    const acc = (cible, champs) => complets.filter(([, o]) => M.memeLecture(o[v].lecture, o[cible].lecture, champs)).length;
    const r = { variante: v, n: L.length, erreurs: erreurs.length, msP50: f(M.pct(ms, .5)), msMoy: f(M.moy(ms)), msP90: f(M.pct(ms, .9)), msMax: f(Math.max(...ms)), cout: M.moy(L.map(l => l.cout)), entree: f(M.moy(L.map(l => l.entree))), sortie: f(M.moy(L.map(l => l.sortie))), raisonnement: f(M.moy(L.map(l => l.raisonnement))), ...comptes,
        accordV0Chaine: v === 'v0' ? null : acc('v0', M.CHAMPS_CHAINE), accordV0Decisifs: v === 'v0' ? null : acc('v0', M.CHAMPS_DECISIFS), photosComplets: complets.length };
    resume.push(r);
}
console.table(resume.map(r => ({ variante: r.variante, n: r.n, err: r.erreurs, 'ms p50': r.msP50, 'ms moy': r.msMoy, 'ms p90': r.msP90, 'ms max': r.msMax, '$ moy': r.cout === null ? '—' : r.cout.toFixed(5), 'jetons ent.': r.entree, 'jetons sort.': r.sortie, raisonn: r.raisonnement })));
console.table(resume.map(r => ({ variante: r.variante, 'n° exact': r.numeroExact, 'n° chiffres': r.numeroChiffres, 'n° FAUX': r.numeroFaux, 'n° absent': r.numeroAbsent, 'nom ok': r.nomOk, 'code ok/jugés': `${r.codeOk}/${r.codeJuge}`, 'accord v0 (champs chaîne)': r.accordV0Chaine === null ? '—' : `${r.accordV0Chaine}/${r.photosComplets}`, 'accord v0 (décisifs)': r.accordV0Decisifs === null ? '—' : `${r.accordV0Decisifs}/${r.photosComplets}` })));
// temps APPARIÉ : la différence photo par photo avec v0 (le bruit d'une photo à l'autre disparaît)
console.log('\ndifférence de temps appariée avec v0 (ms ; négatif = plus rapide), sur les photos où les deux ont répondu :');
for (const v of variantes.filter(x => x !== 'v0')) {
    const d = [...parPhoto.values()].filter(o => o.v0 && o[v] && !o.v0.erreur && !o[v].erreur).map(o => o[v].ms - o.v0.ms);
    const plusRapides = d.filter(x => x < 0).length;
    console.log(`  ${v.padEnd(4)} n=${d.length} · médiane ${f(M.pct(d, .5))} · moyenne ${f(M.moy(d))} · plus rapide ${plusRapides}/${d.length}`);
}
// les désaccords de lecture, pour qu'ils se LISENT
console.log('\nchamps différents de v0 (hors variantes v0b), par photo :');
for (const [photo, o] of parPhoto) for (const v of variantes.filter(x => x !== 'v0')) {
    if (!o.v0 || !o[v] || !o.v0.lecture || !o[v].lecture) continue;
    const d = M.champsDifferents(o[v].lecture, o.v0.lecture, M.CHAMPS_CHAINE);
    if (d.length) console.log(`  ${photo} ${v.padEnd(4)} : ${d.map(k => `${k} « ${o.v0.lecture[k]} » -> « ${o[v].lecture[k]} »`).join(' · ')}`);
}
