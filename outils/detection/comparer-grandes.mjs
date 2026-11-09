// MESURE SUR GRANDES PHOTOS : chaine A (Rat-Market : pre-reduction entiere + canvas emule) contre chaine B (servie aujourd'hui : canvas du navigateur sur la photo entiere), dans Chrome ; et A node contre A Chrome (invariance).
//   node comparer-grandes.mjs <chrome-grandes.json> [--node=<node.json>] [--verites=<verites.json>] [--meta=<meta.json>] [--avec-sans-licence]
// Imprime les DENOMINATEURS : photos, erreurs de decodage par code, redressees par chaine, deplacement des quadrilateres (en % de la diagonale 640), cosinus des vecteurs A/B, erreur a la verite de position si fournie.
// « meme quadrilatere de rang 1 » = les quatre coins a moins de 3 % de la diagonale (le seuil de quasi-doublon de la detection) : JAMAIS une identite de carte. AUCUN verdict n'est rejoue ici : pas d'idProduct de verite, donc pas de « sur faux » mesurable.
import fs from 'node:fs';
const args = process.argv.slice(2), arg = (n) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const C = JSON.parse(fs.readFileSync(args.find((a) => !a.startsWith('--')), 'utf8'));
if (!C.photos) { console.error('sortie sans photos :', C.erreur); process.exit(2); }
const N = arg('node') ? JSON.parse(fs.readFileSync(arg('node'), 'utf8')) : null, V = arg('verites') ? JSON.parse(fs.readFileSync(arg('verites'), 'utf8')) : null, M = arg('meta') ? JSON.parse(fs.readFileSync(arg('meta'), 'utf8')) : null;
let ids = Object.keys(C.photos).sort();
if (M && !args.includes('--avec-sans-licence')) ids = ids.filter((i) => M[i] && !/non declaree/.test(M[i].licence));   // PAR DEFAUT la mesure PRINCIPALE : sans les photos sans licence declaree ; --avec-sans-licence les remet (chiffres « a part »)
const cnt = (f) => ids.filter(f).length;
const q = (v, p) => { const s = [...v].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : null; };
const f3 = (x) => (x === null || x === undefined ? '-' : x.toFixed(3));
const cos = (x, y) => { let s = 0, a = 0, b = 0; for (let i = 0; i < x.length; i++) { s += x[i] * y[i]; a += x[i] * x[i]; b += y[i] * y[i]; } return s / Math.sqrt(a * b); };
const depl = (qa, qb, dim) => { const diag = Math.hypot(dim[0], dim[1]); return Math.max(...qa.map((p, i) => Math.hypot(p[0] - qb[i][0], p[1] - qb[i][1]))) / diag; };
const erreurs = (src) => ids.reduce((a, i) => { const e = src[i] && src[i].erreur; if (e) a[e] = (a[e] || 0) + 1; return a; }, {});
console.log(`PHOTOS ${ids.length} ; erreurs de decodage A (Rat-Market) ${JSON.stringify(erreurs(C.photos))} ; B (navigateur) ${JSON.stringify(erreurs(C.B))}`);
const avecA = ids.filter((i) => !C.photos[i].erreur), avecB = ids.filter((i) => !C.B[i].erreur);
console.log(`redressees : A ${cnt((i) => C.photos[i].redressee)} / ${avecA.length} lisibles ; B ${cnt((i) => C.B[i].redressee)} / ${avecB.length} lisibles`);
const voies = ids.reduce((a, i) => { const p = C.photos[i]; const k = p.erreur ? 'erreur' : (p.pre ? 'pre+' : '') + p.voie; a[k] = (a[k] || 0) + 1; return a; }, {});
console.log(`voies A : ${JSON.stringify(voies)}`);
if (M) { const par = {}; for (const i of ids) { const m = M[i]; if (!m) continue; const k = m.source.split(':')[1].split('/')[0] + ' (' + m.licence + ')'; const p = par[k] || (par[k] = { n: 0, rA: 0, rB: 0 }); p.n++; if (C.photos[i].redressee) p.rA++; if (C.B[i].redressee) p.rB++; } console.log('par source :', JSON.stringify(par)); }
// A contre B
const les2 = ids.filter((i) => C.photos[i].redressee && C.B[i].redressee);
const d = les2.map((i) => depl(C.photos[i].quad, C.B[i].quad, C.photos[i].dim640)), cs = les2.filter((i) => C.photos[i].emb && C.B[i].emb).map((i) => cos(C.photos[i].emb, C.B[i].emb));
const memeQuad = d.filter((x) => x < 0.03).length;
console.log(`A contre B, ${les2.length} photos redressees par les deux : deplacement du quadrilatere de rang 1 (% de la diagonale) mediane ${f3(100 * q(d, 0.5))} p90 ${f3(100 * q(d, 0.9))} max ${f3(100 * Math.max(...d))} ; meme quadrilatere de rang 1 (< 3 %) ${memeQuad}/${les2.length} ; AUTRE quadrilatere de rang 1 (>= 3 %) ${les2.length - memeQuad} (ce n'est pas une identite de carte)`);
console.log(`   dimensions 640 differentes d'un pixel entre A et B (double arrondi : dimensions de la pre-reduction puis 640) : ${ids.filter((i) => C.photos[i].dim640 && C.B[i].dim640 && (C.photos[i].dim640[0] !== C.B[i].dim640[0] || C.photos[i].dim640[1] !== C.B[i].dim640[1])).length} photos`);
console.log(`   cosinus des vecteurs A/B (${cs.length} photos) : min ${f3(Math.min(...cs))} mediane ${f3(q(cs, 0.5))} ; < 0,99 : ${cs.filter((x) => x < 0.99).length} ; < 0,95 : ${cs.filter((x) => x < 0.95).length}`);
const seulA = ids.filter((i) => C.photos[i].redressee && !C.B[i].redressee && !C.B[i].erreur), seulB = ids.filter((i) => !C.photos[i].redressee && !C.photos[i].erreur && C.B[i].redressee);
console.log(`redressee par A seulement ${seulA.length} ; par B seulement ${seulB.length} ; par aucune ${cnt((i) => !C.photos[i].redressee && !C.B[i].redressee)}`);
// invariance node / Chrome pour A
if (N) {
  const com = ids.filter((i) => N.photos[i]);
  const diff = { quads: [], carte: [], rgb640: [], emb: [], erreur: [] };
  for (const i of com) { const a = N.photos[i], b = C.photos[i]; if (a.erreur !== b.erreur) diff.erreur.push(i); if (a.erreur || b.erreur) continue; if (a.empreintes.rgb640 !== b.empreintes.rgb640) diff.rgb640.push(i); if (a.empreintes.quads !== b.empreintes.quads) diff.quads.push(i); if (a.empreintes.carte !== b.empreintes.carte) diff.carte.push(i); if (a.emb && b.emb && JSON.stringify(a.emb) !== JSON.stringify(b.emb)) diff.emb.push(i); }
  console.log(`INVARIANCE A node / A Chrome sur ${com.length} photos : erreurs differentes ${diff.erreur.length}, rgb640 ${diff.rgb640.length}, quadrilateres ${diff.quads.length}, cartes ${diff.carte.length}, vecteurs ${diff.emb.length} (nombre de photos qui DIFFERENT)`);
}
// verite de position (simulation)
if (V) {
  const tour = (src, nom) => {
    const e = []; let trouvees = 0, bonnes = 0; const ok = new Set();
    for (const i of ids) { const p = src[i]; if (!V[i] || p.erreur || !p.redressee) continue; trouvees++; const dim = p.dim640; const k = dim[0] / V[i].affichee[0]; const verite = V[i].quad.map(([x, y]) => [x * k, y * k]);
      // l'ordre des coins du detecteur : on prend la meilleure rotation cyclique des coins (le detecteur ordonne par somme et difference de coordonnees)
      let m = 1e9; for (let r = 0; r < 4; r++) m = Math.min(m, depl(p.quad, verite.map((_, j) => verite[(j + r) % 4]), dim)); e.push(m); if (m < 0.03) { bonnes++; ok.add(i); } }
    console.log(`VERITE DE POSITION ${nom} : ${trouvees} redressees sur ${ids.length} ; coins a moins de 3 % de la diagonale de la vraie carte : ${bonnes} ; erreur mediane ${f3(100 * q(e, 0.5))} % p90 ${f3(100 * q(e, 0.9))} % max ${f3(100 * Math.max(...e))} %`);
    return ok;
  };
  const okA = tour(C.photos, 'A (Rat-Market)'), okB = tour(C.B, 'B (navigateur)');
  console.log(`   croisement a la verite de position : A et B justes ${ids.filter((i) => okA.has(i) && okB.has(i)).length} ; A seule juste ${ids.filter((i) => okA.has(i) && !okB.has(i)).length} ; B seule juste ${ids.filter((i) => !okA.has(i) && okB.has(i)).length} ; aucune juste ${ids.filter((i) => !okA.has(i) && !okB.has(i)).length}`);
}
