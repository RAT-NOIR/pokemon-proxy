'use strict';
// Mutants de audit-catalogue/audit-sets.js : chacun doit faire échouer test-audit-sets.js. Restaure toujours.
const fs = require('fs'); const { spawnSync } = require('child_process');
const W = 'C:/Users/Yung/rat-market-travail/catalogue/worktrees/c-audit-sets/audit-catalogue/';
const F = W + 'audit-sets.js', T = W + 'test-audit-sets.js';
const orig = fs.readFileSync(F, 'utf8');
const M = [
 ['population vide', "if (!sets.length) throw", "if (false) throw"],
 ['cartes vides', "if (lignes.length && !cartes.length) throw", "if (false) throw"],
 ['jointure vide', "if (!lignes.some(l => ids.has(l.carteId))) throw", "if (false) throw"],
 ['cause fermée', "if (!CAUSES[type] || !CAUSES[type].includes(base)) throw", "if (false) throw"],
 ['publiés', "sets.filter(s => nonVide(s.nomAffichage))", "sets.filter(s => true)"],
 ['normaliser entrées', "imps.map(i => normaliserNumero(i.numero))", "imps.map(i => i.numero)"],
 ['règle bloquante', "ps.length > 0 && ps.every(p => p.visuel && p.visuel.classe === 'MANQUANT')", "false"],
 ['image sans numéro', "e.numero === null ? imgsSet.length > 0 :", "e.numero === null ? false :"],
 ['pas un trou', "for (const n of ex.trous) {", "for (const n of liste) {"],
 ['jumeaux', "memeCodeSaufFin(a.code, b.code))) jumeaux.add", "false)) jumeaux.add"],
 ['moitié', "attendu = total / 2; else", "attendu = total; else"],
 ['groupe de 2', "if (g.length < 2) continue;", "if (g.length < 1) continue;"],
 ['base du numéro', "baseNumero(e.numero)]));", "e.numero]));"],
 ['attaques dans la clé', "(e.c.attaques || []).join('|')", "''"],
 ['orpheline', "if (!liés.size) {", "if (false) {"],
 ['jumelle sans base', "suffixeLettre(e.numero) && baseOk)", "suffixeLettre(e.numero))"],
 ['tri', "(b.score - a.score) ||", "(a.score - b.score) ||"],
 ['formule score', "Math.log2(2 + (offres || 0))", "Math.log2(2)"],
 ['100 %', "x.trous > 0 && s.trous === 0", "s.trous === 0"],
 ['dénominateur écart', "memeDenominateur: d1.sets === d2.sets && d1.setsPublies === d2.setsPublies", "memeDenominateur: true"],
 ['écart nul', "if (!avant) return null;", "if (false) return null;"],
 ['inconnu bloque', "motif ? `regle-bloquante:${motif}` : 'cause-inconnue'", "motif ? `regle-bloquante:${motif}` : 'aucune-image-en-base'"],
 ['cause sans numéro', "imps.length ? 'impression-sans-numero' : 'aucune-impression-du-set'", "imps.length ? 'aucune-impression-du-set' : 'impression-sans-numero'"],
 ['trou nommé', "trousNommes[p.idProduct] ? `sans-ligne", "false ? `sans-ligne"],
 ['produit existe', "numerosProdSansFiche.has(n) ?", "false ?"],
 ['reste', "reste ? `reste:", "false ? `reste:"],
 ['hors set publié', "else produitsSansSetPublie++;", "else produitsSansSetPublie += 0;"],
 ['nomEn vide', "typeof c.nomEn === 'string' && c.nomEn !== ''", "true"],
 ['classes produits', "if (cl !== 'SANS_LIGNE' && cl !== 'LIGNE_SANS_FICHE') continue;", ""],
 ['aucune impression numérotée', "attendu > portes)", "false)"],
 ['md score', "**Score de tri = trous", "**Tri = trous"],
];
let tues = 0; const vivants = [];
try {
 for (const [nom, a, b] of M) {
  if (orig.split(a).length !== 2) { console.log(`INVALIDE (motif absent ou multiple) : ${nom}`); vivants.push(nom + ' (invalide)'); continue; }
  fs.writeFileSync(F, orig.replace(a, () => b));
  const r = spawnSync('node', [T], { encoding: 'utf8' });
  if (r.status !== 0) { tues++; console.log(`tué     : ${nom}`); } else { vivants.push(nom); console.log(`VIVANT  : ${nom}`); }
 }
} finally { fs.writeFileSync(F, orig); }
console.log(`\n${tues} tués sur ${M.length}; vivants : ${vivants.join(' | ') || 'aucun'}`);
const v = spawnSync('node', [T], { encoding: 'utf8' }); console.log('restauré, banc :', v.stdout.trim().split('\n').pop());
