// node audit-catalogue/test-correctifs.js — les correctifs de la relecture indépendante (c-audit 32b86816) : M3 (le rapprochement avec `decider` LÈVE), M4 (entrées contradictoires),
// L1 (le motif `format` se pose dès que le nom correspond), et les motifs finaux. Fonctions PURES.
const C = require('./classement');
const { rapprocher } = require('./rapprochement');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const leve = (f, re) => { try { f(); return false; } catch (e) { return re.test(e.message); } };

// ── M4 : UN produit, UNE entrée (version.js:276-283) — deux entrées aux visuels IDENTIQUES ⇒ une seule ; DIFFÉRENTS ⇒ aucun visuel servi
const e1 = { idProduct: 1, vignette: { cle: 'v/a.webp', w: 200, h: 281 }, grande: { cle: 'g/a.webp', w: 600, h: 840 }, mention: null, numero: '12' };
verifier('aucune entrée valide : rien', C.departagerEntrees([]), { servi: null, contradictoire: false, doublons: 0 });
verifier('une entrée : servie', C.departagerEntrees([e1]), { servi: e1, contradictoire: false, doublons: 0 });
const e2 = { ...e1, numero: '13' };
verifier('deux entrées au MÊME visuel (le reste diffère) : une seule servie, la dernière, un doublon compté', C.departagerEntrees([e1, e2]), { servi: e2, contradictoire: false, doublons: 1 });
verifier('deux entrées à des visuels DIFFÉRENTS (vignette) : AUCUN visuel, contradictoire', C.departagerEntrees([e1, { ...e1, vignette: { cle: 'v/b.webp', w: 200, h: 281 } }]), { servi: null, contradictoire: true, doublons: 0 });
verifier('deux entrées dont les dimensions de la grande diffèrent : contradictoires', C.departagerEntrees([e1, { ...e1, grande: { cle: 'g/a.webp', w: 300, h: 420 } }]).contradictoire, true);
verifier('une grande présente, l\'autre absente : contradictoires', C.departagerEntrees([e1, { ...e1, grande: null }]).contradictoire, true);
verifier('trois entrées, deux identiques et une différente : contradictoire (la contradiction l\'emporte)', C.departagerEntrees([e1, e2, { ...e1, vignette: { cle: 'v/c.webp', w: 200, h: 281 } }]).contradictoire, true);

// ── M3 : le rapprochement avec decider LÈVE s'il diverge
const traceSansFiche = { sansFiche: true, im: null, refus: null }, traceRepli = { sansFiche: false, im: { cleR2: 'x' }, refus: 'wcd' }, traceVisuel = { sansFiche: false, im: { cleR2: 'x' }, refus: null }, traceAucun = { sansFiche: false, im: null, refus: null };
const traces = [traceSansFiche, traceSansFiche, traceRepli, ...Array(6).fill(traceVisuel), traceAucun];
const d = () => ({ avecLigne: 11, ecrites: 5, aucun: 2, aucunDetail: { 'carte absente': 0, 'aucun set candidat': 1, 'aucun visuel': 1 }, sansFicheDuSite: 2, repliRefuse: { total: 1 }, partageIncoherent: 1 });
const base = () => ({ d: d(), traces, nLignes: 11, nEntrees: 5 });
verifier('un état cohérent : le rapprochement rend ses comptes, sans lever', rapprocher(base()).ok, true);
verifier('« sans fiche » qui diverge : LÈVE', leve(() => rapprocher({ ...base(), d: { ...d(), sansFicheDuSite: 3 } }), /sans fiche/), true);
verifier('« aucun visuel » qui diverge : LÈVE', leve(() => rapprocher({ ...base(), d: { ...d(), aucunDetail: { 'carte absente': 0, 'aucun set candidat': 1, 'aucun visuel': 0 } } }), /aucun visuel/), true);
verifier('« aucun set candidat / carte absente » qui diverge : LÈVE', leve(() => rapprocher({ ...base(), nLignes: 12, d: { ...d(), avecLigne: 12 } }), /aucun set candidat|carte absente/), true);
verifier('le repli qui diverge : LÈVE', leve(() => rapprocher({ ...base(), d: { ...d(), repliRefuse: { total: 2 } } }), /repli/), true);
verifier('PARTAGE INCOHÉRENT : le reste (écrites + partage) ne tombe plus juste, LÈVE — une nouvelle exclusion de l\'API n\'est plus étiquetée par élimination', leve(() => rapprocher({ ...base(), d: { ...d(), partageIncoherent: 2 } }), /partage/), true);
verifier('une exclusion NOUVELLE de l\'API (une trace de plus écartée, aucun compteur ne bouge) : LÈVE', leve(() => rapprocher({ ...base(), nEntrees: 4, d: { ...d(), ecrites: 4 } }), /partage/), true);
verifier('écrites ≠ entrées reçues : LÈVE', leve(() => rapprocher({ ...base(), nEntrees: 6 }), /écrites/), true);
verifier('lignes comptées par decider ≠ lignes lues : LÈVE', leve(() => rapprocher({ ...base(), nLignes: 10 }), /lignes/), true);

// ── L1 : le motif `format` dès que le nom correspond, y compris sur un MANQUANT ; la finition ne se pose que sur une comparaison CONFORME
const mf = o => C.motifsFinaux({ motifs: [], nom: 'Pikachu', comparaison: null, classeVisuel: 'MANQUANT', finition: null, ...o });
verifier('MANQUANT au nom V-UNION : le motif `format` est posé', mf({ motifs: ['sans-ligne'], nom: 'Greninja V-UNION [Union Gain]' }).motifs, ['sans-ligne', 'format']);
verifier('MANQUANT sans format : rien de plus', mf({ motifs: ['sans-ligne'] }).motifs, ['sans-ligne']);
verifier('le motif `format` n\'est jamais posé deux fois', mf({ motifs: ['format'], nom: 'Ho-Oh LEGEND [Top]' }).motifs, ['format']);
verifier('INVÉRIFIABLE par un autre motif : ce motif est écrit une fois', mf({ classeVisuel: 'INVERIFIABLE', comparaison: { classe: 'INVERIFIABLE', motif: 'pas-de-copie-locale' } }).motifs, ['pas-de-copie-locale']);
const fin = { concerne: true, raisons: ['set-tamponnee'] };
verifier('comparaison CONFORME avec finition : motif finition-ou-tampon-non-verifie et raisons', mf({ classeVisuel: 'CONFORME', comparaison: { classe: 'CONFORME', motif: null }, finition: fin }), { motifs: ['finition-ou-tampon-non-verifie'], finitionRaisons: ['set-tamponnee'] });
verifier('comparaison PROBABLEMENT FAUX avec finition : pas de motif finition', mf({ classeVisuel: 'PROBABLEMENT_FAUX', comparaison: { classe: 'PROBABLEMENT_FAUX', motif: null }, finition: fin }).motifs, []);
verifier('classe principale EMPRUNTÉ à comparaison CONFORME : le motif finition se pose aussi', mf({ classeVisuel: 'EMPRUNTE', motifs: ['autre-tirage'], comparaison: { classe: 'CONFORME', motif: null }, finition: fin }).motifs, ['autre-tirage', 'finition-ou-tampon-non-verifie']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
