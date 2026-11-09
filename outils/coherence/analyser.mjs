// ANALYSE du test de coherence : lit les verdicts A, B, BB, B0 (jsonl) et compare A a chacun. AUCUNE verite lue, aucun compte de juste ou de faux.
//   node analyser.mjs <population.json> <dossier-donnees> <sortie.json>
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const CMP = require('./comparateur.cjs');
const [fPop, dossier, fSortie] = process.argv.slice(2);
const P = JSON.parse(fs.readFileSync(fPop, 'utf8'));
const lire = (v) => { const m = new Map(); for (const f of fs.readdirSync(dossier).filter((x) => new RegExp(`^verdicts-${v}(-\\d+)?\\.jsonl$`).test(x))) for (const l of fs.readFileSync(path.join(dossier, f), 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l); m.set(r.sha256, r); } return m; };
const V = { A: lire('A'), B: lire('B'), BB: lire('BB'), B0: lire('B0'), BP: lire('BP') };
const pops = {};
for (const k of Object.keys(P).filter((x) => /^population/.test(x))) pops[k] = new Set(P[k].liste.map((p) => p.sha256));
const dimsDe = new Map(Object.keys(P).filter((x) => /^population/.test(x)).flatMap((k) => P[k].liste.map((p) => [p.sha256, `${p.largeur}x${p.hauteur}`])));
if (Object.keys(pops).length > 1) pops['union'] = new Set(Object.values(pops).flatMap((s) => [...s]));
// muette d'INSTRUMENT : la regle n'a pas conclu (scan absent, delai) ; ni une erreur de decodage, ni l'absence de carte redressee
const muetteInstrument = (r) => r.verdict.issue === 'muette' && r.verdict.code !== 'non-redressee' && !/^erreur:/.test(r.verdict.code || '');
const classeRaison = (r) => { const d = r.decision; if (!d) return 'aucune'; if (d.muette) return 'muette:' + d.muette; if (d.affirme) return 'affirmee'; const t = String(d.raison || ''); if (/^marge carte/.test(t)) return 'marge-carte'; if (/carte des différences/.test(t)) return 'zones-paire'; if (/zone clé ne confirme/.test(t)) return 'zone-cle'; if (/sans visuel/.test(t)) return 'produit-sans-visuel'; if (/même visuel, même prix/.test(t)) return 'commune'; if (/même visuel/.test(t)) return 'question-images'; if (/aucune carte redressée/.test(t)) return 'non-redressee'; if (/similarité/.test(t)) return 'similarite'; return 'autre:' + t.slice(0, 40); };
const enr = (r) => ({ sha256: r.sha256, redressee: r.redressee, nCartes: r.nCartes, quad: r.quad, dim640: r.dim640, emb: r.emb, verdict: r.verdict, score: r.score, marge: r.marge, nCandidats: r.nCandidats });
const mediane = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : null; };
const sortie = { analyseLe: new Date().toISOString(), comptes: Object.fromEntries(Object.entries(V).map(([k, m]) => [k, m.size])), populations: {} };
for (const [nomPop, set] of Object.entries(pops)) {
  const presentsA = [...set].filter((s) => V.A.has(s)).sort();
  const erreursDecodage = {}; for (const s of presentsA) { const e = V.A.get(s).erreur; if (e) erreursDecodage[e] = (erreursDecodage[e] || 0) + 1; }
  const shasA = presentsA.filter((s) => !V.A.get(s).erreur);          // les photos que A ne sait pas decoder (TROP_GRAND...) sont comptees a part et ne comparent rien
  const sp = { photos: shasA.length, attendues: set.size, erreursDeDecodageDeA: erreursDecodage, issuesA: {}, raisonsA: {}, nonRedresseesA: shasA.filter((s) => !V.A.get(s).redressee).length, redresseesA: shasA.filter((s) => V.A.get(s).redressee).length, comparaisons: {} };
  for (const s of shasA) { const a = V.A.get(s); sp.issuesA[a.verdict.issue] = (sp.issuesA[a.verdict.issue] || 0) + 1; const c = classeRaison(a); sp.raisonsA[c] = (sp.raisonsA[c] || 0) + 1; }
  for (const v of ['B', 'BB', 'BP', 'B0']) {
    const shas = shasA.filter((s) => V[v].has(s));      // B0 : pas de temoin pour les photos que le decodeur refuse (aucune ici hors erreurs de A)
    const A = shas.map((s) => enr(V.A.get(s))), B = shas.map((s) => enr(V[v].get(s)));
    const c = CMP.comparer(A, B);
    // ecarts plus fins que le verdict, pour comprendre : rang 1 de la detection, vecteur, raison de la decision
    const dep = [], cos = [];
    let rang1Deplace3 = 0, redresseeUnSeulCote = 0, memeRaisonClasse = 0, nCartesDiff = 0, bitIdentiques = 0;
    for (const s of shas) {
      const a = V.A.get(s), b = V[v].get(s);
      if (a.redressee !== b.redressee) redresseeUnSeulCote++;
      if (a.nCartes !== b.nCartes) nCartesDiff++;
      if (a.redressee && b.redressee) { const d = CMP.deplacementQuadPct(a.quad, b.quad, a.dim640); dep.push(d); if (d >= 3) rang1Deplace3++; cos.push(CMP.cosinus(a.emb, b.emb)); }
      if (classeRaison(a) === classeRaison(b)) memeRaisonClasse++;
      if (a.empreintes && b.empreintes && a.empreintes.rgb640 === b.empreintes.rgb640 && a.empreintes.carte === b.empreintes.carte && JSON.stringify(a.emb) === JSON.stringify(b.emb)) bitIdentiques++;
    }
    // « muette » = la regle n'a pas conclu parce qu'un scan de l'archive manque SUR LE DISQUE (la route le lirait au bucket) : une limite de l'instrument, pas une difference de produit. Comptee a part.
    const aMuette = (s) => muetteInstrument(V.A.get(s)) || muetteInstrument(V[v].get(s));
    const deuxRedressees = shas.filter((s) => V.A.get(s).redressee && V[v].get(s).redressee), setDR = new Set(deuxRedressees);
    const nonIdentiquesAuBit = shas.filter((s) => { const a = V.A.get(s), b = V[v].get(s); return a.redressee && b.redressee && !(a.empreintes.rgb640 === b.empreintes.rgb640 && a.empreintes.carte === b.empreintes.carte && JSON.stringify(a.emb) === JSON.stringify(b.emb)); }).map((s) => ({ sha: s.slice(0, 8), dims: dimsDe.get(s) }));
    const nbNonRedresseeB = shas.filter((s) => !V[v].get(s).redressee).length;
    const photosAvecMuette = shas.filter(aMuette).length;
    const diffSansMuette = c.differences.filter((d) => !aMuette(d.sha256));
    const parSevSansMuette = {}; for (const d of diffSansMuette) parSevSansMuette[d.severite] = (parSevSansMuette[d.severite] || 0) + 1;
    const un = new Set(shas.filter((s) => V.A.get(s).nCartes <= 1 && V[v].get(s).nCartes <= 1));
    const candidatsDetection = { photosAUnSeulCandidatDesDeuxCotes: un.size, differencesParmiElles: c.differences.filter((d) => un.has(d.sha256)).length, photosAPlusieursCandidats: shas.length - un.size, differencesParmiElles2: c.differences.filter((d) => !un.has(d.sha256)).length, nCartesMedianA: mediane(shas.map((s) => V.A.get(s).nCartes)) };
    const formes = {}; for (const d of nonIdentiquesAuBit) formes[d.dims] = (formes[d.dims] || 0) + 1;
    sp.comparaisons[v] = { candidatsDetection, photosComparees: shas.length, nonRedresseesA: shas.length - shas.filter((s) => V.A.get(s).redressee).length, nonRedresseesB: nbNonRedresseeB, redresseesDesDeuxCotes: deuxRedressees.length, differencesParmiRedresseesDesDeuxCotes: c.differences.filter((d) => setDR.has(d.sha256)).length, nonIdentiquesAuBit: nonIdentiquesAuBit.length, nonIdentiquesAuBitParForme: formes, photosAvecMuette, differencesSansMuette: diffSansMuette.length, photosSansMuette: shas.length - photosAvecMuette, parSeveriteSansMuette: parSevSansMuette, total: c.total, identiques: c.identiques, differences: c.differences.length, parSeverite: c.parSeverite, parClasse: c.parClasse, top3DifferentsMemeVerdict: c.top3Differents,
      versOuDepuisAffirmee: (c.parSeverite['vers-affirmee'] || 0) + (c.parSeverite['depuis-affirmee'] || 0) + (c.parSeverite['affirmee-autre-produit'] || 0),
      issuesB: shas.reduce((o, s) => { const i = V[v].get(s).verdict.issue; o[i] = (o[i] || 0) + 1; return o; }, {}),
      detail: { rang1Deplace3PctOuPlus: rang1Deplace3, redresseeUnSeulCote, nCartesDifferent: nCartesDiff, deplacementMedianPct: mediane(dep), deplacementP90Pct: quantile(dep, 0.9), deplacementMaxPct: dep.length ? Math.max(...dep) : null, cosinusMedian: mediane(cos), cosinusMin: cos.length ? Math.min(...cos) : null, cosinusSous0_99: cos.filter((x) => x < 0.99).length, memeClasseDeRaisonDeDecision: memeRaisonClasse, identiquesAuBit_rgb640_carte_vecteur: bitIdentiques },
      listeDifferences: c.differences };
  }
  sortie.populations[nomPop] = sp;
}
fs.writeFileSync(fSortie, JSON.stringify(sortie, null, 1));
for (const [n, sp] of Object.entries(sortie.populations)) {
  console.log(`\n== ${n} : ${sp.photos} photos (attendues ${sp.attendues}) ; issues de A ${JSON.stringify(sp.issuesA)} ; redressees ${sp.redresseesA} ; raisons A ${JSON.stringify(sp.raisonsA)}`);
  for (const [v, c] of Object.entries(sp.comparaisons)) console.log(`  A contre ${v} : ${c.differences} differences sur ${c.total} (vers/depuis affirmee ${c.versOuDepuisAffirmee}) ; severite ${JSON.stringify(c.parSeverite)} ; classe ${JSON.stringify(c.parClasse)} ; top3 different ${c.top3DifferentsMemeVerdict} ; issues B ${JSON.stringify(c.issuesB)} ; detail ${JSON.stringify(c.detail)}`);
}
