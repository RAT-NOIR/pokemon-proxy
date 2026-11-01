// Banc de collecte-cartes/tolerance-orthographe.js (décision de l'éditeur, 2026-10-31) : UNE faute d'orthographe tolérée dans un set, sous QUATRE conditions cumulatives.
//   1. une seule lettre d'écart (distance d'édition 1) ; 2. même position dans le set (même groupe) ; 3. candidat unique ; 4. TOUT le reste du set concordant.
// AUCUNE connexion, aucune source réelle : des listes fabriquées. Chaque refus a son cas qui dit NON.
const assert = require('assert');
const TOL = require('./collecte-cartes/tolerance-orthographe');
const FPS = require('./collecte-cartes/fiches-preuve-set');
const { cleProduitParDefaut } = require('./collecte-cartes/preuve-par-set');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };

const groupeDe = n => String(n).slice(0, 2);
const pad = n => String(n).padStart(2, '0');
const traduire = z => cleProduitParDefaut(z);
/** noms[i] = nom de la source pour le groupe i+1 ; produitsNoms[i] = nom Cardmarket du groupe i+1 (défaut : le même) ; 3 variantes par groupe. */
function jeu(noms, produitsNoms = noms, n = 3) {
    const source = [], produits = []; let id = 1000;
    noms.forEach((nom, i) => { for (let r = 1; r <= n; r++) source.push({ numero: pad(i + 1) + pad(r), nomZh: nom }); });
    produitsNoms.forEach((nom, i) => { for (let r = 1; r <= n; r++) produits.push({ idProduct: id++, name: `${nom} [Attaque ${i + 1}]`, numero: pad(i + 1) }); });
    return { source, produits };
}
const P = (noms, produitsNoms, opts = {}) => { const j = jeu(noms, produitsNoms); return TOL.proposerTolerance({ ...j, traduire, cleProduit: cleProduitParDefaut, groupeDe, ...opts }); };
const BASE = ['Ponyta', 'Pinsir', 'Timburr', 'Eevee', 'Grotle'];

t('un set déjà admis : la tolérance ne s\'applique pas (rien à corriger)', () => {
    const r = P(BASE, BASE);
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /déjà admis/);
});
t('OUI : « Timbur » pour « Timburr » — 1 lettre, même groupe, candidat unique, tout le reste concorde', () => {
    const r = P(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    assert.strictEqual(r.applicable, true, r.raison);
    assert.deepStrictEqual({ de: r.correction.de, vers: r.correction.vers, groupe: r.correction.groupe }, { de: 'Timbur', vers: 'Timburr', groupe: '03' });
    assert.match(r.motif, /Timbur/); assert.match(r.motif, /Timburr/); assert.match(r.motif, /distance d'édition 1/);
    assert.strictEqual(r.source.filter(e => e.nomZh === 'Timburr').length, 3);   // la source corrigée porte le nom du produit
    assert.strictEqual(r.source.filter(e => e.nomZh === 'Timbur').length, 0);
});
t('OUI aussi pour une substitution (« Vivillon » lu « Vivillion » est une insertion ; « Minccino » lu « Minccina » une substitution)', () => {
    assert.strictEqual(P(['Ponyta', 'Minccina', 'Eevee'], ['Ponyta', 'Minccino', 'Eevee']).applicable, true);
    assert.strictEqual(P(['Ponyta', 'Vivillion', 'Eevee'], ['Ponyta', 'Vivillon', 'Eevee']).applicable, true);
});
t('NON : distance 2 (« Timbr » pour « Timburr »)', () => {
    const r = P(['Ponyta', 'Pinsir', 'Timbr', 'Eevee', 'Grotle'], BASE);
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /distance/);
});
t('NON : une transposition vaut deux lettres (« Timbrur »)', () => {
    assert.strictEqual(P(['Ponyta', 'Pinsir', 'Timbrur', 'Eevee', 'Grotle'], BASE).applicable, false);
});
t('NON : deux candidats à distance 1 (« Timbur » est à 1 lettre de « Timburr » ET de « Timbury »)', () => {
    const r = P(['Ponyta', 'Timbury', 'Timbur', 'Eevee', 'Grotle'], ['Ponyta', 'Timbury', 'Timburr', 'Eevee', 'Grotle']);
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /candidat/);
});
t('NON : candidat non unique d\'UN SEUL sens (« abcd » est à une lettre de « abce » et de « abdd », qui eux sont à deux lettres l\'un de l\'autre)', () => {
    const r = P(['Ponyta', 'Pinsir', 'Abcd', 'Eevee', 'Abdd'], ['Ponyta', 'Pinsir', 'Abce', 'Eevee', 'Abdd']);
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /candidat non unique/);
});
t('NON : candidat non unique dans l\'autre sens (« abce » du produit est à une lettre de « abcd » ET de « abee » de la source)', () => {
    const r = P(['Ponyta', 'Pinsir', 'Abcd', 'Eevee', 'Abee'], ['Ponyta', 'Pinsir', 'Abce', 'Eevee', 'Abee']);
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /candidat non unique/);
});
t('NON : une autre position (la source dit « Timbur » au groupe 3, le produit « Timburr » est au groupe 5)', () => {
    const r = P(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], ['Ponyta', 'Pinsir', 'Grotle', 'Eevee', 'Timburr']);
    assert.strictEqual(r.applicable, false);
});
t('NON : un second écart ailleurs dans le set (deux fautes : « Timbur » ET « Pinsr »)', () => {
    const r = P(['Ponyta', 'Pinsr', 'Timbur', 'Eevee', 'Grotle'], BASE);
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /UN SEUL écart/);
});
t('NON : un second écart d\'une autre nature (un nom absent d\'un côté, effectifs différents ailleurs)', () => {
    const j = jeu(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    j.produits.pop();                               // un produit de moins : un effectif différent, qui n'est PAS une faute d'orthographe
    const r = TOL.proposerTolerance({ ...j, traduire, cleProduit: cleProduitParDefaut, groupeDe });
    assert.strictEqual(r.applicable, false);
});
t('NON : un nom intraduisible ferme le set, la tolérance n\'y change rien', () => {
    const j = jeu(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    const r = TOL.proposerTolerance({ ...j, traduire: z => (z === 'Eevee' ? null : traduire(z)), cleProduit: cleProduitParDefaut, groupeDe });
    assert.strictEqual(r.applicable, false);
});
t('NON : sans groupeDe la position ne se vérifie pas — refus (une garde qui ne peut pas conclure bloque)', () => {
    const j = jeu(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    const r = TOL.proposerTolerance({ ...j, traduire, cleProduit: cleProduitParDefaut, groupeDe: null });
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /position/);
});
t('NON : les effectifs de la faute ne sont pas égaux (7 « Timbur » contre 6 « Timburr »)', () => {
    const j = jeu(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    j.produits.splice(j.produits.findIndex(p => /Timburr/.test(p.name)), 1);
    assert.strictEqual(TOL.proposerTolerance({ ...j, traduire, cleProduit: cleProduitParDefaut, groupeDe }).applicable, false);
});
t('la source corrigée est ADMISE par la règle de production (juger : 0 faux, 4 contrôles négatifs) et le motif est écrit', () => {
    const j = jeu(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    assert.strictEqual(FPS.juger({ ...j, traduire, cleProduit: cleProduitParDefaut, groupeDe }).admis, false);   // sans la tolérance : tombé
    const r = TOL.proposerTolerance({ ...j, traduire, cleProduit: cleProduitParDefaut, groupeDe });
    const v = FPS.juger({ source: r.source, produits: j.produits, traduire, cleProduit: cleProduitParDefaut, groupeDe });
    assert.strictEqual(v.admis, true, v.raison); assert.strictEqual(v.calibration.faux, 0);
});
t('distanceUneLettre : insertion, suppression, substitution = 1 ; identique, transposition et plus = pas 1', () => {
    const d = TOL.uneLettreDEcart;
    assert.strictEqual(d('timbur', 'timburr'), true); assert.strictEqual(d('timburr', 'timbur'), true); assert.strictEqual(d('minccina', 'minccino'), true);
    assert.strictEqual(d('abc', 'abc'), false); assert.strictEqual(d('abcd', 'abdc'), false); assert.strictEqual(d('abc', 'a'), false); assert.strictEqual(d('', 'a'), true);
});

t('NON (position) : des produits SANS numéro Cardmarket — la position ne se vérifie pas, et le contrôle de groupe de la preuve ne la voit pas non plus : refus', () => {
    const j = jeu(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    j.produits.forEach(p => { p.numero = null; });
    const r = TOL.proposerTolerance({ ...j, traduire, cleProduit: cleProduitParDefaut, groupeDe });
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /position/);
});
t('NON (liste corrigée refusée) : si le nom corrigé ne se traduit pas à la clé du produit, la liste corrigée n\'est pas admise — la tolérance ne s\'applique pas', () => {
    const j = jeu(['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle'], BASE);
    const trad = z => (z === 'Timburr' ? 'AUTRE-CLE' : cleProduitParDefaut(z));
    const r = TOL.proposerTolerance({ ...j, traduire: trad, cleProduit: cleProduitParDefaut, groupeDe });
    assert.strictEqual(r.applicable, false); assert.match(r.raison, /toujours pas admise/);
});

// ── branchement : jugerTout (ecrire-fiches-preuve-set.js) — la tolérance est un OPT-IN de la cible, jamais un défaut ──
const E = require('./ecrire-fiches-preuve-set');
const branche = (tolerance, noms = ['Ponyta', 'Pinsir', 'Timbur', 'Eevee', 'Grotle']) => {
    const j = jeu(noms, BASE);
    const cible = { nom: 'Set test', exp: 1, kado: [['L', '']], groupeDe, role: 'vise', ...(tolerance ? { tolerance: true } : {}) };
    const sources = { SETS: { L: { cartes: j.source } }, traduire, cleProduit: cleProduitParDefaut };
    const lecture = { produits: new Map([[1, j.produits]]) };
    return { j, ...E.jugerTout({ sources, lecture, cibles: [cible] }) };
};
t('jugerTout : sans l\'option de la cible, la faute ferme le set (la tolérance n\'est jamais un défaut)', () => {
    const { verdicts } = branche(false);
    assert.strictEqual(verdicts[0].admis, false); assert.ok(!verdicts[0].tolerance);
});
t('jugerTout : avec l\'option, le set est ADMIS, le verdict porte la correction et sa raison nomme la règle', () => {
    const { verdicts, global } = branche(true);
    assert.strictEqual(verdicts[0].admis, true, verdicts[0].raison);
    assert.strictEqual(global.regleFiable, true);
    assert.strictEqual(verdicts[0].tolerance.de, 'Timbur'); assert.strictEqual(verdicts[0].tolerance.vers, 'Timburr');
    assert.match(verdicts[0].raison, /tolérance d'orthographe/);
});
t('jugerTout : avec l\'option mais deux fautes, le set reste fermé', () => {
    const { verdicts } = branche(true, ['Ponyta', 'Pinsr', 'Timbur', 'Eevee', 'Grotle']);
    assert.strictEqual(verdicts[0].admis, false); assert.ok(!verdicts[0].tolerance);
});
t('les entrées du planificateur portent le motif de la tolérance sur CHAQUE fiche (ref de la seconde source)', () => {
    const { verdicts, j } = branche(true);
    const entrees = FPS.entreesDuSet({ verdict: verdicts[0], source: verdicts[0].source, produits: j.produits, exp: 1, slugSet: 'Set-Test', etiquette: 'liste:L' });
    assert.ok(entrees.length > 0);
    assert.ok(entrees.every(e => /tolérance d'orthographe : « Timbur » lu pour « Timburr »/.test(e.secondeSource.concordantes[0].ref)));
    const sans = branche(false).verdicts[0];
    assert.strictEqual(sans.admis, false);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
