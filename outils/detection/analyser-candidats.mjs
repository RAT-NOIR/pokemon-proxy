// SONDES DU RANG 1 : pourquoi le quadrilatere de rang 1 de la chaine A differe-t-il de celui de la chaine B (navigateur) ? Deux sondes a cout quasi nul sur la sortie de grandes.mjs (?a0=1) :
//   (1) A0 = la chaine Rat-Market SANS pre-reduction (options.pre === false) : la pre-reduction est-elle la cause ?
//   (2) TOUS les candidats de chaque chaine, pas seulement gardes[0] : le rang 1 de l'une figure-t-il parmi les candidats de l'autre, et a quel rang ?
//   node analyser-candidats.mjs <chrome.json> [--meta=<meta.json>] [--avec-sans-licence]
// « different » = deplacement maximal des quatre coins >= 3 % de la diagonale 640 : un AUTRE QUADRILATERE de rang 1, jamais une identite de carte.
import fs from 'node:fs';
const args = process.argv.slice(2), arg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const C = JSON.parse(fs.readFileSync(args.find((a) => !a.startsWith('--')), 'utf8'));
const M = arg('meta') ? JSON.parse(fs.readFileSync(arg('meta'), 'utf8')) : null;
let ids = Object.keys(C.photos).sort();
// PAR DEFAUT (avec --meta) : sans les photos sans licence declaree (la mesure principale) ; --avec-sans-licence les remet (chiffres « a part »)
const AVEC_SANS_LICENCE = args.includes('--avec-sans-licence');
if (M && !AVEC_SANS_LICENCE) ids = ids.filter((i) => M[i] && !/non declaree/.test(M[i].licence));
const src = (i) => (M && M[i] ? M[i].source.split(':')[1].split('/')[0] : 'sim');
const SEUIL = 0.03;
const depl = (qa, qb, dim) => Math.max(...qa.map((p, i) => Math.sqrt((p[0] - qb[i][0]) ** 2 + (p[1] - qb[i][1]) ** 2))) / Math.sqrt(dim[0] * dim[0] + dim[1] * dim[1]);
const med = (v) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const f2 = (x) => (x === null ? '-' : x.toFixed(2));
const ok = (p) => p && !p.erreur && p.redressee && p.cands && p.cands.length;
const X = { A: (i) => C.photos[i], A0: (i) => C.A0 && C.A0[i], B: (i) => C.B[i] };
function rangDans(p, quad, dim) { for (let r = 0; r < p.cands.length; r++) if (depl(p.cands[r].quad, quad, dim) < SEUIL) return r + 1; return 0; }
function comparer(nx, ny) {
  const both = ids.filter((i) => ok(X[nx](i)) && ok(X[ny](i)));
  const dim = (i) => X[nx](i).dim640;
  const diff = both.filter((i) => depl(X[nx](i).cands[0].quad, X[ny](i).cands[0].quad, dim(i)) >= SEUIL);
  const unique = both.filter((i) => X[nx](i).cands.length === 1 && X[ny](i).cands.length === 1), multi = both.filter((i) => !unique.includes(i));
  const diffU = diff.filter((i) => unique.includes(i)), diffM = diff.filter((i) => multi.includes(i));
  const yDansX = diff.map((i) => rangDans(X[nx](i), X[ny](i).cands[0].quad, dim(i))), xDansY = diff.map((i) => rangDans(X[ny](i), X[nx](i).cands[0].quad, dim(i)));
  const compte = (v, f) => v.filter(f).length;
  const r12 = (nom, liste) => med(liste.filter((i) => X[nom](i).cands.length > 1).map((i) => X[nom](i).cands[1].aire / X[nom](i).cands[0].aire));
  console.log(`${nx} contre ${ny} : ${both.length} photos redressees par les deux ; rang 1 DIFFERENT (>= 3 %) ${diff.length} (${(100 * diff.length / both.length).toFixed(1)} %)`);
  console.log(`   photos a UN SEUL candidat des deux cotes : ${unique.length}, dont different ${diffU.length} ; photos a plusieurs candidats : ${multi.length}, dont different ${diffM.length} (${(100 * diffM.length / Math.max(1, multi.length)).toFixed(1)} %)`);
  console.log(`   parmi les ${diff.length} differents : le rang 1 de ${ny} figure parmi les candidats de ${nx} : ${compte(yDansX, (r) => r > 0)} (rang 2 ou plus : ${compte(yDansX, (r) => r > 1)}) ; le rang 1 de ${nx} figure parmi ceux de ${ny} : ${compte(xDansY, (r) => r > 0)} (rang 2 ou plus : ${compte(xDansY, (r) => r > 1)}) ; ni l'un ni l'autre : ${diff.filter((_, k) => !yDansX[k] && !xDansY[k]).length}`);
  console.log(`   marge d'aire rang 2 / rang 1 de ${nx} (mediane, photos a >= 2 candidats) : differents ${f2(r12(nx, diff))} contre concordants ${f2(r12(nx, multi.filter((i) => !diff.includes(i))))}`);
  const ps = {}; for (const i of both) { const k = src(i); const p = ps[k] || (ps[k] = { n: 0, diff: 0, multi: 0 }); p.n++; if (diff.includes(i)) p.diff++; if (multi.includes(i)) p.multi++; }
  console.log(`   par source (photos / a plusieurs candidats / differents) : ${Object.entries(ps).map(([k, p]) => `${k} ${p.n}/${p.multi}/${p.diff}`).join(' ; ')}`);
  return { both, diff };
}
console.log(`PHOTOS ${ids.length}${M ? (AVEC_SANS_LICENCE ? ' (AVEC les photos sans licence declaree : chiffres a part)' : ' (SANS les photos sans licence declaree : mesure principale)') : ''} ; candidats : A ${f2(med(ids.filter((i) => ok(X.A(i))).map((i) => X.A(i).cands.length)))} (mediane) B ${f2(med(ids.filter((i) => ok(X.B(i))).map((i) => X.B(i).cands.length)))}`);
comparer('A', 'B');
if (C.A0) { comparer('A0', 'B'); comparer('A', 'A0'); }
