// ANALYSE du test de coherence : lit les verdicts de chaque variante (jsonl) et compare. AUCUNE verite lue, aucun compte de juste ou de faux.
//   node analyser.mjs <population.json> <dossier-donnees> <sortie.json> [--prefixe=verdicts2|verdicts]
// verdicts2 = decision de PRODUCTION (decisionRegleG) ; verdicts = sortie BRUTE de G (annexe). Les denominateurs sont ASSERTES (controles.cjs) : comparees = attendues - erreurs de A ; photo absente d'une variante, doublon, photo inattendue = ECHEC.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CMP = require('./comparateur.cjs');
const CTL = require('./controles.cjs');
const args = process.argv.slice(2), pos = args.filter((a) => !a.startsWith('--')), opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
const [fPop, dossier, fSortie] = pos;
const PREFIXE = opt.prefixe || 'verdicts2';
const P = JSON.parse(fs.readFileSync(fPop, 'utf8'));
const lire = (v) => {
  const fichiers = fs.readdirSync(dossier).filter((x) => new RegExp(`^${PREFIXE}-${v}(-\\d+)?\\.jsonl$`).test(x)).sort();
  if (!fichiers.length) return null;
  return CTL.indexerSansDoublon(fichiers.map((f) => ({ fichier: f, lignes: fs.readFileSync(path.join(dossier, f), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) })));       // un doublon LEVE
};
const V = {}; for (const v of ['A', 'B', 'BB', 'BP', 'B0', 'BW', 'BBW']) { const m = lire(v); if (m) V[v] = m; }
if (!V.A) throw new Error('aucun verdict de A');
const pops = {};
for (const k of Object.keys(P).filter((x) => /^population/.test(x))) pops[k] = new Set(P[k].liste.map((p) => p.sha256));
const dimsDe = new Map(Object.keys(P).filter((x) => /^population/.test(x)).flatMap((k) => P[k].liste.map((p) => [p.sha256, `${p.largeur}x${p.hauteur}`])));
const toutesAttendues = new Set(Object.values(pops).flatMap((s) => [...s]));
if (Object.keys(pops).length > 1) pops['union'] = toutesAttendues;
// muette d'INSTRUMENT : la regle n'a pas conclu (scan absent, delai, exception) ; ni une erreur de decodage, ni l'absence de carte redressee
const muetteInstrument = (r) => r.verdict.issue === 'muette' && r.verdict.code !== 'non-redressee' && !/^erreur:/.test(r.verdict.code || '');
const classeRaison = (r) => { const d = r.decision; if (!d) return 'aucune'; if (d.muette) return 'muette:' + d.muette; if (d.affirme) return 'affirmee'; const t = String(d.raison || ''); if (/^marge carte/.test(t)) return 'marge-carte'; if (/carte des différences/.test(t)) return 'zones-paire'; if (/zone clé ne confirme/.test(t)) return 'zone-cle'; if (/sans visuel/.test(t)) return 'produit-sans-visuel'; if (/même visuel, même prix/.test(t)) return 'commune'; if (/même visuel/.test(t)) return 'question-images'; if (/aucune carte redressée/.test(t)) return 'non-redressee'; if (/similarité/.test(t)) return 'similarite'; return 'autre:' + t.slice(0, 40); };
const enr = (r) => ({ sha256: r.sha256, redressee: r.redressee, nCartes: r.nCartes, quad: r.quad, dim640: r.dim640, emb: r.emb, verdict: r.verdict, score: r.score, marge: r.marge, nCandidats: r.nCandidats });
const mediane = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const PAIRES = [['A', 'B'], ['A', 'BB'], ['A', 'BW'], ['A', 'BBW'], ['A', 'BP'], ['A', 'B0'], ['B', 'BW'], ['BB', 'BBW']].filter(([x, y]) => V[x] && V[y]);
const sortie = { analyseLe: new Date().toISOString(), prefixe: PREFIXE, comptes: Object.fromEntries(Object.entries(V).map(([k, m]) => [k, m.size])), populations: {} };
for (const [nomPop, set] of Object.entries(pops)) {
  const erreursA = new Set([...set].filter((s) => V.A.has(s) && V.A.get(s).erreur));
  // LES DENOMINATEURS, ASSERTES : A complet ; toute variante complete (hors photos refusees par le decodeur de A) ; aucune photo inattendue ; comparees = attendues - erreurs
  const sansTemoin = {}; for (const v of Object.keys(V)) if (v === 'B0') sansTemoin[v] = erreursA;           // B0 n'a pas de temoin pour les photos que le decodeur de A refuse : elles sont deja hors du denominateur
  const { comparees } = CTL.controlerDenominateurs({ attendues: set, toutesAttendues, erreursA, parVariante: V, sansTemoin });
  const erreursDecodage = {}; for (const s of erreursA) { const e = V.A.get(s).erreur; erreursDecodage[e] = (erreursDecodage[e] || 0) + 1; }
  const shas = comparees;
  const sp = { attendues: set.size, photos: shas.length, erreursDeDecodageDeA: erreursDecodage, issuesA: {}, raisonsA: {}, causesMuetteA: {}, nonRedresseesA: shas.filter((s) => !V.A.get(s).redressee).length, redresseesA: shas.filter((s) => V.A.get(s).redressee).length, comparaisons: {} };
  for (const s of shas) { const a = V.A.get(s); sp.issuesA[a.verdict.issue] = (sp.issuesA[a.verdict.issue] || 0) + 1; const c = classeRaison(a); sp.raisonsA[c] = (sp.raisonsA[c] || 0) + 1; }
  for (const v of Object.keys(V)) for (const s of shas) { const r = V[v].get(s); if (r && muetteInstrument(r)) { const k = `${v}: ${String(r.cause || 'cause non journalisee').replace(/artofpkm\/.*|tcgdex\/.*|pikaqian\/.*/, '<cle>')}`; sp.causesMuetteA[k] = (sp.causesMuetteA[k] || 0) + 1; } }
  for (const [x, y] of PAIRES) {
    const nom = x === 'A' ? y : `${x}~${y}`;
    const A = shas.map((s) => enr(V[x].get(s))), B = shas.map((s) => enr(V[y].get(s)));
    const c = CMP.comparer(A, B);
    if (A.length !== sp.photos || c.total !== sp.photos) throw new Error('denominateur de la comparaison incoherent');
    const dep = [], cos = [];
    let rang1Deplace3 = 0, redresseeUnSeulCote = 0, memeRaisonClasse = 0, nCartesDiff = 0, bitIdentiques = 0;
    for (const s of shas) {
      const a = V[x].get(s), b = V[y].get(s);
      if (a.redressee !== b.redressee) redresseeUnSeulCote++;
      if (a.nCartes !== b.nCartes) nCartesDiff++;
      if (a.redressee && b.redressee) { const d = CMP.deplacementQuadPct(a.quad, b.quad, a.dim640); dep.push(d); if (d >= 3) rang1Deplace3++; cos.push(CMP.cosinus(a.emb, b.emb)); }
      if (classeRaison(a) === classeRaison(b)) memeRaisonClasse++;
      if (a.empreintes && b.empreintes && a.empreintes.rgb640 === b.empreintes.rgb640 && a.empreintes.carte === b.empreintes.carte && JSON.stringify(a.emb) === JSON.stringify(b.emb)) bitIdentiques++;
    }
    const aMuette = (s) => muetteInstrument(V[x].get(s)) || muetteInstrument(V[y].get(s));
    const deuxRedressees = shas.filter((s) => V[x].get(s).redressee && V[y].get(s).redressee), setDR = new Set(deuxRedressees);
    const nonIdentiquesAuBit = deuxRedressees.filter((s) => { const a = V[x].get(s), b = V[y].get(s); return !(a.empreintes.rgb640 === b.empreintes.rgb640 && a.empreintes.carte === b.empreintes.carte && JSON.stringify(a.emb) === JSON.stringify(b.emb)); }).map((s) => ({ sha: s.slice(0, 8), dims: dimsDe.get(s) }));
    const photosAvecMuette = shas.filter(aMuette).length;
    const diffSansMuette = c.differences.filter((d) => !aMuette(d.sha256));
    const parSevSansMuette = {}; for (const d of diffSansMuette) parSevSansMuette[d.severite] = (parSevSansMuette[d.severite] || 0) + 1;
    const un = new Set(shas.filter((s) => V[x].get(s).nCartes <= 1 && V[y].get(s).nCartes <= 1));
    const formes = {}; for (const d of nonIdentiquesAuBit) formes[d.dims] = (formes[d.dims] || 0) + 1;
    sp.comparaisons[nom] = { photosComparees: shas.length, differences: c.differences.length, identiques: c.identiques, parSeverite: c.parSeverite, parClasse: c.parClasse,
      versOuDepuisAffirmee: (c.parSeverite['vers-affirmee'] || 0) + (c.parSeverite['depuis-affirmee'] || 0), deuxProduits: c.parSeverite['affirmee-autre-produit'] || 0,
      top3DifferentsMemeVerdict: c.top3Differents, listeTop3Differents: c.top3Liste,
      issuesCote2: shas.reduce((o, s) => { const i = V[y].get(s).verdict.issue; o[i] = (o[i] || 0) + 1; return o; }, {}),
      candidatsDetection: { photosAUnSeulCandidatDesDeuxCotes: un.size, differencesParmiElles: c.differences.filter((d) => un.has(d.sha256)).length, photosAPlusieursCandidats: shas.length - un.size, differencesParmiElles2: c.differences.filter((d) => !un.has(d.sha256)).length, nCartesMedianCote1: mediane(shas.map((s) => V[x].get(s).nCartes)) },
      nonRedresseesCote1: shas.filter((s) => !V[x].get(s).redressee).length, nonRedresseesCote2: shas.filter((s) => !V[y].get(s).redressee).length, redresseesDesDeuxCotes: deuxRedressees.length, differencesParmiRedresseesDesDeuxCotes: c.differences.filter((d) => setDR.has(d.sha256)).length,
      nonIdentiquesAuBit: nonIdentiquesAuBit.length, nonIdentiquesAuBitParForme: formes, photosAvecMuette, differencesSansMuette: diffSansMuette.length, parSeveriteSansMuette: parSevSansMuette,
      detail: { rang1Deplace3PctOuPlus: rang1Deplace3, redresseeUnSeulCote, nCartesDifferent: nCartesDiff, deplacementMedianPct: mediane(dep), deplacementP90Pct: quantile(dep, 0.9), deplacementMaxPct: dep.length ? Math.max(...dep) : null, cosinusMedian: mediane(cos), cosinusMin: cos.length ? Math.min(...cos) : null, cosinusSous0_99: cos.filter((v2) => v2 < 0.99).length, memeClasseDeRaisonDeDecision: memeRaisonClasse, identiquesAuBit_rgb640_carte_vecteur: bitIdentiques },
      listeDifferences: c.differences };
  }
  sortie.populations[nomPop] = sp;
}
fs.writeFileSync(fSortie, JSON.stringify(sortie, null, 1));
for (const [n, sp] of Object.entries(sortie.populations)) {
  console.log(`\n== ${n} : ${sp.photos} comparees sur ${sp.attendues} attendues (erreurs de decodage de A ${JSON.stringify(sp.erreursDeDecodageDeA)}) ; issues de A ${JSON.stringify(sp.issuesA)} ; non redressees A ${sp.nonRedresseesA} ; causes muette ${JSON.stringify(sp.causesMuetteA)}`);
  for (const [v, c] of Object.entries(sp.comparaisons)) console.log(`  ${v} : ${c.differences}/${c.photosComparees} diff ; vers/depuis ${c.versOuDepuisAffirmee} ; deux produits ${c.deuxProduits} ; severite ${JSON.stringify(c.parSeverite)} ; classe ${JSON.stringify(c.parClasse)} ; top3 different ${c.top3DifferentsMemeVerdict} ; non identiques au bit ${c.nonIdentiquesAuBit} ; issues cote 2 ${JSON.stringify(c.issuesCote2)}`);
}
