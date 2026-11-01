// Banc de ecrire-gempack-rattachement.js : la ligne de commande et l'ORDRE des écritures. AUCUNE connexion : des dépendances espionnes. Chaque garde a son cas qui dit NON.
//   ordre voulu par l'éditeur : 1. l'appartenance au set (cartes.sets) · 2. l'impression Gem Pack · 3. la fiche (cartes_produits) · 4. le trou « variantes indiscernables » — chacun RELU avant le suivant.
const assert = require('assert');
const C = require('./ecrire-gempack-rattachement');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };

const plan = (extra = {}) => ({
    lignes: [{ _id: '10|101', carteId: 10, idProduct: 101, slugSet: 'Gem-Pack-Vol-T', numeroFiche: '01' }, { _id: '10|102', carteId: 10, idProduct: 102, slugSet: 'Gem-Pack-Vol-T', numeroFiche: '01' }],
    impressions: [{ carteId: 10, imp: { tirage: 'zh-hans', expansion: 'Gem Pack Vol. T', numero: '01', source: 'numero-cardmarket' } }],
    R: { aPoser: new Map([[10, [{ tirage: 'zh-hans', expansion: 'Gem Pack Vol. T', numero: '01', source: 'numero-cardmarket' }]]]), groupes: new Map(), refus: [] }, detail: [],
    ajoutsSets: new Map([[10, ['Gem-Pack-Vol-T']]]),
    trous: [{ idProduct: 101, motif: 'variantes-indiscernables', preuve: { rang: 'indiscernable' } }, { idProduct: 102, motif: 'variantes-indiscernables', preuve: { rang: 'indiscernable' } }],
    refus: [], ...extra });
const espions = (cas = {}) => {
    const journal = [];
    const dep = {
        ecrireAppartenances: async (db, ajouts) => { journal.push(['appartenance', [...ajouts]]); return cas.appartenance ?? { ok: true, n: ajouts.size }; },
        ecrireImpressions: async () => { journal.push(['impression']); return cas.impression ?? 0; },
        ecrireFiches: async (db, lignes) => { journal.push(['fiches', lignes.length]); return { lignes: lignes.length, cartes: 1 }; },
        relireFiches: async () => { journal.push(['relire-fiches']); return cas.relire ?? { ok: true, lignes: '2/2', cartes: '1/1', reperesBouges: [], manques: [] }; },
        ecrireTrous: async (db, trous) => { journal.push(['trous', trous.length]); return { nouveaux: trous.length, changes: 0, inchanges: 0, resolus: 0, rouverts: 0 }; }
    };
    return { journal, dep };
};
const lancer = async (p, attendu, cas, extra = {}) => {
    const e = espions(cas), sorties = [], erreurs = [];
    const code = await C.ecrireRattachement({ db: {}, plan: p, attendu, nomListe: 'pret.json', metaDe: new Map(), repereAvant: new Map(), dep: e.dep, log: l => sorties.push(l), err: l => erreurs.push(l), ...extra });
    return { code, journal: e.journal.map(x => x[0]), brut: e.journal, sorties, erreurs };
};

(async () => {
    await t('l\'ordre : appartenance, impression, fiches (puis relues), trous — et un code de sortie 0', async () => {
        const r = await lancer(plan(), 2);
        assert.strictEqual(r.code, 0, r.erreurs.join('|'));
        assert.deepStrictEqual(r.journal, ['appartenance', 'impression', 'fiches', 'relire-fiches', 'trous']);
    });
    await t('NON : --attendu absent ou différent du plan — rien n\'est écrit', async () => {
        for (const a of [undefined, 1, 3]) { const r = await lancer(plan(), a); assert.strictEqual(r.code, 1); assert.deepStrictEqual(r.journal, []); }
    });
    await t('NON : un refus dans le plan (la liste --seulement n\'est pas EXACTEMENT la simulation) — rien n\'est écrit', async () => {
        const r = await lancer(plan({ refus: [{ idProduct: 5, raison: 'x' }] }), 2);
        assert.strictEqual(r.code, 1); assert.deepStrictEqual(r.journal, []);
    });
    await t('NON : l\'appartenance n\'est pas relue — ni l\'impression ni la fiche ne s\'écrivent', async () => {
        const r = await lancer(plan(), 2, { appartenance: { ok: false, n: 0, manque: 'sets Gem-Pack-Vol-T' } });
        assert.strictEqual(r.code, 1); assert.deepStrictEqual(r.journal, ['appartenance']);
    });
    await t('NON : l\'impression échoue — la fiche ne s\'écrit pas', async () => {
        const r = await lancer(plan(), 2, { impression: 1 });
        assert.strictEqual(r.code, 1); assert.deepStrictEqual(r.journal, ['appartenance', 'impression']);
    });
    await t('NON : la fiche n\'est pas relue — le trou ne s\'écrit pas', async () => {
        const r = await lancer(plan(), 2, { relire: { ok: false, lignes: '1/2', cartes: '1/1', reperesBouges: [], manques: [[10, ['x']]] } });
        assert.strictEqual(r.code, 1); assert.deepStrictEqual(r.journal, ['appartenance', 'impression', 'fiches', 'relire-fiches']);
    });
    await t('un plan SANS appartenance à poser (cartes déjà membres) saute l\'étape sans échouer', async () => {
        const r = await lancer(plan({ ajoutsSets: new Map() }), 2);
        assert.strictEqual(r.code, 0); assert.deepStrictEqual(r.journal, ['impression', 'fiches', 'relire-fiches', 'trous']);
    });
    await t('un plan sans trou (produits uniques) n\'écrit aucun trou', async () => {
        const r = await lancer(plan({ trous: [] }), 2);
        assert.strictEqual(r.code, 0); assert.ok(!r.journal.includes('trous'));
    });
    await t('la ligne de commande : écrite par ce qu\'elle AUTORISE (argument inconnu refusé, --ecrire seul sans lot refusé)', async () => {
        assert.ok(C.verifierArguments(['--ecrire', '--attendu=3', '--seulement=a.json']) == null);
        assert.match(C.verifierArguments(['--ecrire', '--nimportequoi']), /argument inconnu/);
        assert.match(C.verifierArguments(['--ecrire', '--simuler']), /un seul mode/);
        assert.match(C.verifierArguments(['--ecrire', '--attendu=3']), /--seulement/);
        assert.match(C.verifierArguments(['--ecrire', '--seulement=a.json']), /--attendu/);
        assert.ok(C.verifierArguments(['--simuler', '--codes=CBB4C,CBB6C', '--pret=p.json']) == null);
        assert.match(C.verifierArguments(['--attendu=2']), /--ecrire/);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
