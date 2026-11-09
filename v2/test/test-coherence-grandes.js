'use strict';
// TEST DE COHERENCE DES GRANDES PHOTOS : la selection de la population (figee avant tout verdict) et le comparateur de verdicts A (photo entiere) / B (photo reduite a 800 px).
// Node pur, aucune base, aucun reseau, aucun fichier de photo. Le comparateur doit SAVOIR dire non : photo differente injectee, verdict altere, issue qui change.
const path = require('path');
const SEL = require(path.join('..', '..', 'outils', 'coherence', 'selection.cjs'));
const CMP = require(path.join('..', '..', 'outils', 'coherence', 'comparateur.cjs'));
let ok = 0, ko = 0;
const vrai = (nom, cond, detail) => { if (cond) ok++; else { ko++; console.log(`❌ ${nom}${detail ? ' — ' + detail : ''}`); } };
const egal = (nom, a, b) => vrai(nom, JSON.stringify(a) === JSON.stringify(b), `obtenu ${JSON.stringify(a)} attendu ${JSON.stringify(b)}`);
const leve = (nom, f, motif) => { try { f(); vrai(nom, false, 'aurait du lever'); } catch (e) { vrai(nom, !motif || motif.test(String(e.message)), String(e.message)); } };
const sha = n => n.toString(16).padStart(64, '0');

// ── 1. LA SELECTION ─────────────────────────────────────────────────────────────────────────────────────────────────
const ph = (n, pixels, extra = {}) => ({ sha256: sha(n), pixels, chemin: `p${n}.jpg`, ...extra });
const brut = [ph(1, 1920000), ph(2, 1920000), ph(3, 5000000), ph(4, 640000), ph(5, 1920000), ph(6, 12000000), ph(7, 1920000)];
egal('1. tri : pixels decroissants, a egalite sha256 croissant', SEL.ordonner(brut).map(p => p.sha256 === sha(6) ? 6 : parseInt(p.sha256, 16)), [6, 3, 1, 2, 5, 7, 4]);
egal('1. le tri ne modifie pas l\'entree', brut.map(p => parseInt(p.sha256, 16)), [1, 2, 3, 4, 5, 6, 7]);
const ex = new Map([[sha(3), 'juge']]);
const r = SEL.choisir(brut, { exclus: ex, n: 3 });
egal('2. une photo du juge (par sha256 du contenu) n\'est jamais retenue', r.retenues.map(p => parseInt(p.sha256, 16)), [6, 1, 2]);
egal('2. l\'exclusion est comptee et nommee', r.exclues, [{ sha256: sha(3), motif: 'juge' }]);
egal('2. le denominateur imprime : candidates, exclues, retenues', [r.candidates, r.exclues.length, r.retenues.length], [7, 1, 3]);
egal('3. les photos de 800 px ou moins ne sont pas des grandes photos (retirees et comptees)', SEL.choisir(brut, { exclus: new Map(), n: 99, cote: [[1200, 1600], [1200, 1600], [3000, 4000], [640, 480], [1200, 1600], [4000, 3000], [1200, 1600]].map(d => d) }).petites, 0);
const brut2 = [ph(1, 1920000, { largeur: 1200, hauteur: 1600 }), ph(2, 307200, { largeur: 640, hauteur: 480 }), ph(3, 640000, { largeur: 800, hauteur: 800 }), ph(4, 1920000, { largeur: 1600, hauteur: 1200 })];
const r3 = SEL.choisir(brut2, { exclus: new Map(), n: 10, plusDe: 800 });
egal('3. plusDe 800 : le grand cote doit depasser 800 (800 x 800 refusee)', [r3.retenues.length, r3.petites], [2, 2]);
egal('4. n plus grand que la population : toute la population, jamais complete', SEL.choisir(brut, { exclus: new Map(), n: 500 }).retenues.length, 7);
const rb = SEL.choisir(brut, { exclus: new Map(), n: 99, garder: new Set([sha(1), sha(6)]) });
egal('5. garder : seulement les photos de la liste (le banc), le reste compte « hors liste »', [rb.retenues.map(p => parseInt(p.sha256, 16)), rb.horsListe], [[6, 1], 5]);
egal('6. empreinte de la liste : stable, independante de l\'ordre d\'entree', SEL.empreinte(SEL.ordonner(brut)), SEL.empreinte(SEL.ordonner([...brut].reverse())));
vrai('6. empreinte de la liste : change si une photo change', SEL.empreinte(SEL.ordonner(brut)) !== SEL.empreinte(SEL.ordonner([...brut.slice(0, 6), ph(8, 1920000)])));
leve('7. une liste d\'exclusion vide leve (une exclusion vide n\'exclut rien)', () => SEL.choisir(brut, { exclus: new Map(), n: 3, exigerExclusions: true }), /exclusion vide/);
leve('7. des sha256 dupliques dans l\'entree levent', () => SEL.choisir([ph(1, 10), ph(1, 10)], { exclus: new Map(), n: 3 }), /doublon/);
// temoin negatif : l'exclusion doit pouvoir dire OUI sur une empreinte plantee, et NON sur une propre
vrai('8. temoin : une empreinte plantee est exclue', SEL.choisir([ph(9, 1)], { exclus: new Map([[sha(9), 'juge (plantee)']]), n: 1 }).retenues.length === 0);
vrai('8. temoin : une empreinte propre passe', SEL.choisir([ph(9, 1)], { exclus: new Map([[sha(10), 'juge']]), n: 1 }).retenues.length === 1);
egal('9. la distribution des dimensions par classes de grand cote', SEL.distribution([{ largeur: 1200, hauteur: 1600 }, { largeur: 3000, hauteur: 4000 }, { largeur: 640, hauteur: 480 }, { largeur: 4032, hauteur: 3024 }, { largeur: 900, hauteur: 700 }]),
    { '<=800': 1, '801-1200': 1, '1201-2000': 1, '2001-4000': 1, '>4000': 1 });

// ── 2. LE COMPARATEUR ───────────────────────────────────────────────────────────────────────────────────────────────
const aff = (id, extra = {}) => ({ issue: 'affirmee', produit: id, candidats: [id], ...extra });
const que = (ids, extra = {}) => ({ issue: 'question', produit: null, candidats: ids, ...extra });
const com = (ids, extra = {}) => ({ issue: 'commune', produit: null, candidats: ids, ...extra });
const mut = (code, extra = {}) => ({ issue: 'muette', produit: null, candidats: [], code, ...extra });
vrai('10. meme verdict : affirmee, meme produit', CMP.memeVerdict(aff(5), aff(5)));
vrai('10. NON : affirmee, autre produit', !CMP.memeVerdict(aff(5), aff(6)));
vrai('10. NON : affirmee contre question', !CMP.memeVerdict(aff(5), que([5, 6])));
vrai('10. NON : question contre reponse commune', !CMP.memeVerdict(que([5, 6]), com([5, 6])));
vrai('10. meme verdict : deux questions de candidats differents (meme issue, pas de gagnant)', CMP.memeVerdict(que([5, 6]), que([5, 7])));
vrai('10. NON : muette contre question', !CMP.memeVerdict(mut('muette'), que([1, 2])));
vrai('10. NON : deux muettes de codes differents', !CMP.memeVerdict(mut('muette'), mut('indisponible')));
vrai('11. top3 different mais meme verdict : compte a part', CMP.memeVerdict(que([5, 6]), que([5, 7])) && CMP.top3Different(que([5, 6]), que([5, 7])));
vrai('11. top3 egal quel que soit l\'ordre', !CMP.top3Different(que([5, 6]), que([6, 5])));
egal('12. severite : affirmee des deux cotes, produits differents = la pire', CMP.severite(aff(5), aff(6)), 'affirmee-autre-produit');
egal('12. severite : depuis affirmee (A affirme, B non)', CMP.severite(aff(5), que([5, 6])), 'depuis-affirmee');
egal('12. severite : vers affirmee (A n\'affirme pas, B oui)', CMP.severite(que([5, 6]), aff(5)), 'vers-affirmee');
egal('12. severite : sans affirmee', CMP.severite(que([5, 6]), com([5, 6])), 'sans-affirmee');
egal('12. severite : identiques = null', CMP.severite(aff(5), aff(5)), null);
// deplacement du quadrilatere
const quad = d => [[100 + d, 100], [500 + d, 100], [500 + d, 600], [100 + d, 600]];
vrai('13. deplacement : 0 pour deux quadrilateres egaux', CMP.deplacementQuadPct(quad(0), quad(0), [640, 800]) === 0);
vrai('13. deplacement : 10 px sur 640 x 480 (diagonale 800) = 1,3 %', CMP.deplacementQuadPct(quad(0), quad(10), [640, 480]) === 1.3, String(CMP.deplacementQuadPct(quad(0), quad(10), [640, 480])));
vrai('13. deplacement : null si un quadrilatere manque', CMP.deplacementQuadPct(null, quad(0), [640, 480]) === null);
// classes
const enr = (id, extra = {}) => ({ sha256: sha(id), redressee: true, nCartes: 1, quad: quad(0), dim640: [480, 640], emb: [1, 0, 0], ...extra });
egal('14. classe detection : le rang 1 se deplace de 3 % ou plus', CMP.classer(enr(1), enr(1, { quad: quad(40) })), 'detection');
egal('14. classe cadrage : meme carte, redressement decale (0,5 % a moins de 3 %)', CMP.classer(enr(1), enr(1, { quad: quad(8) })), 'cadrage');
egal('14. classe decision : quadrilatere a moins de 0,5 %', CMP.classer(enr(1), enr(1, { quad: quad(1) })), 'decision');
egal('14. classe autre : redressee d\'un seul cote', CMP.classer(enr(1), enr(1, { redressee: false, quad: null })), 'autre');
egal('14. classe autre : aucun quadrilatere des deux cotes', CMP.classer(enr(1, { redressee: false, quad: null }), enr(1, { redressee: false, quad: null })), 'autre');
// comparer des listes
const rec = (id, verdict, extra = {}) => ({ ...enr(id), verdict, ...extra });
const A = [rec(1, aff(10)), rec(2, que([20, 21])), rec(3, com([30, 31])), rec(4, aff(40))];
const resId = CMP.comparer(A, JSON.parse(JSON.stringify(A)));
egal('15. listes identiques : 0 difference sur 4', [resId.total, resId.differences.length, resId.identiques], [4, 0, 4]);
const Balt = JSON.parse(JSON.stringify(A)); Balt[0].verdict = aff(11);
const resAlt = CMP.comparer(A, Balt);
egal('16. verdict altere injecte : 1 difference, severite affirmee-autre-produit', [resAlt.differences.length, resAlt.differences[0].severite, resAlt.parSeverite['affirmee-autre-produit']], [1, 'affirmee-autre-produit', 1]);
const Bq = JSON.parse(JSON.stringify(A)); Bq[3].verdict = que([40, 41]);
egal('16. une affirmee qui devient question : depuis-affirmee compte', CMP.comparer(A, Bq).parSeverite['depuis-affirmee'], 1);
const Bph = JSON.parse(JSON.stringify(A)); Bph[1].emb = [0, 1, 0]; Bph[1].quad = quad(60); Bph[1].verdict = que([22, 23]);
const rP = CMP.comparer(A, Bph);
vrai('17. photo differente injectee (meme issue, autres candidats) : pas de difference de verdict mais top3 different compte', rP.differences.length === 0 && rP.top3Differents === 1, JSON.stringify([rP.differences.length, rP.top3Differents]));
const Bph2 = JSON.parse(JSON.stringify(A)); Bph2[1].emb = [0, 1, 0]; Bph2[1].quad = quad(60); Bph2[1].verdict = aff(22);
const rP2 = CMP.comparer(A, Bph2);
egal('17. photo differente qui change l\'issue : cosinus 0 et classe detection ecrits sur la difference', [rP2.differences.length, rP2.differences[0].cosinus, rP2.differences[0].classe], [1, 0, 'detection']);
leve('18. deux listes qui ne portent pas les memes photos : le comparateur refuse', () => CMP.comparer(A, A.slice(0, 3)), /memes photos/);
leve('18. une photo remplacee par une autre (sha256 different) : il refuse', () => { const B2 = JSON.parse(JSON.stringify(A)); B2[2].sha256 = sha(99); CMP.comparer(A, B2); }, /memes photos/);
const resDet = CMP.comparer([rec(1, aff(10))], [rec(1, aff(10), { redressee: false, quad: null, verdict: mut('invalide') })]);
egal('19. redressee d\'un seul cote : difference, classe autre, depuis-affirmee', [resDet.differences[0].classe, resDet.differences[0].severite], ['autre', 'depuis-affirmee']);
vrai('19. chaque difference porte score, marge, candidats et cosinus des deux cotes', (() => { const d = CMP.comparer([rec(1, aff(10), { score: 0.8, marge: 0.3, nCandidats: 2 })], [rec(1, aff(11), { score: 0.7, marge: 0.25, nCandidats: 3 })]).differences[0]; return d.a.score === 0.8 && d.b.marge === 0.25 && d.a.nCandidats === 2 && d.b.nCandidats === 3 && d.cosinus === 1; })());

// ── 3. LE VERDICT DE PRODUCTION (decisionRegleG) : issue « aucun » quand la regle ne tranche pas (la chaine heritee decide) ───────────────────────────
egal('20. production : null (la regle ne tranche pas) = issue aucun', CMP.issueDeProduction(null), { issue: 'aucun', produit: null, candidats: [] });
egal('20. production : affirmee', CMP.issueDeProduction({ issue: 'affirmee', produit: 5 }), { issue: 'affirmee', produit: 5, candidats: [5] });
egal('20. production : question (candidats tries)', CMP.issueDeProduction({ issue: 'question', candidats: [7, 5] }), { issue: 'question', produit: null, candidats: [5, 7] });
egal('20. production : muette (code ferme)', CMP.issueDeProduction({ muette: 'indisponible' }), { issue: 'muette', produit: null, candidats: [], code: 'indisponible' });
vrai('21. deux « aucun » = meme verdict', CMP.memeVerdict(CMP.issueDeProduction(null), CMP.issueDeProduction(null)));
vrai('21. NON : aucun contre question', !CMP.memeVerdict(CMP.issueDeProduction(null), que([5, 6])));
egal('21. severite : aucun contre affirmee = vers-affirmee', CMP.severite(CMP.issueDeProduction(null), aff(5)), 'vers-affirmee');
// ── 4. LES CONTROLES DE DENOMINATEUR de l'analyse ──────────────────────────────────────────────────────────────────────────────────────────────────
const CTL = require(path.join('..', '..', 'outils', 'coherence', 'controles.cjs'));
leve('22. un doublon de sha256 (meme fichier ou deux fichiers) est un echec', () => CTL.indexerSansDoublon([{ fichier: 'a', lignes: [{ sha256: sha(1) }, { sha256: sha(1) }] }]), /doublon/);
leve('22. un doublon entre deux series est un echec', () => CTL.indexerSansDoublon([{ fichier: 'a', lignes: [{ sha256: sha(1) }] }, { fichier: 'b', lignes: [{ sha256: sha(1) }] }]), /doublon/);
vrai('22. sans doublon : une carte par sha256', CTL.indexerSansDoublon([{ fichier: 'a', lignes: [{ sha256: sha(1) }] }, { fichier: 'b', lignes: [{ sha256: sha(2) }] }]).size === 2);
const m = (...ns) => new Map(ns.map(n => [sha(n), { sha256: sha(n) }]));
const base = () => ({ attendues: new Set([sha(1), sha(2), sha(3)]), toutesAttendues: new Set([sha(1), sha(2), sha(3)]), erreursA: new Set([sha(3)]), parVariante: { A: m(1, 2, 3), B: m(1, 2) }, sansTemoin: {} });
egal('23. denominateurs justes : comparees = attendues - erreurs de A', CTL.controlerDenominateurs(base()).comparees.map(s => parseInt(s, 16)), [1, 2]);
leve('23. une photo absente d\'une variante est un echec', () => { const b = base(); b.parVariante.B = m(1); CTL.controlerDenominateurs(b); }, /absente de la variante B/);
leve('23. une photo absente de A est un echec', () => { const b = base(); b.parVariante.A = m(1, 3); CTL.controlerDenominateurs(b); }, /absente de A/);
leve('23. une photo inattendue dans une variante est un echec', () => { const b = base(); b.parVariante.B = m(1, 2, 9); CTL.controlerDenominateurs(b); }, /inattendue/);
leve('23. une erreur de A hors de la population est un echec', () => { const b = base(); b.erreursA = new Set([sha(9)]); CTL.controlerDenominateurs(b); }, /erreur de A hors/);
vrai('23. sansTemoin : une photo sans temoin B0 declaree est admise', (() => { const b = base(); b.erreursA = new Set(); b.parVariante.B0 = m(1, 2); b.sansTemoin = { B0: new Set([sha(3)]) }; b.parVariante.B = m(1, 2, 3); return CTL.controlerDenominateurs(b).comparees.length === 3; })());
leve('23. sansTemoin : une photo manquante NON declaree reste un echec', () => { const b = base(); b.erreursA = new Set(); b.parVariante.B0 = m(1, 2); b.parVariante.B = m(1, 2, 3); CTL.controlerDenominateurs(b); }, /absente de la variante B0/);

console.log(`${ok} réussis, ${ko} échoués`);
process.exit(ko ? 1 : 0);
