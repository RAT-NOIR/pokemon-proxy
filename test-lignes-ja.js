'use strict';
// Lot JA (2026-10-13) — les sources artofpkm des sets japonais jamais rattachés : sm1+, sm2+, ADV1, MCRP, MEDK, CGH. Sans réseau, sans base.
//   node test-lignes-ja.js
// Ce que le test GARDE (écrit par ce qu'il autorise) :
//   · chaque set PROUVÉ a une ligne de table (slug, tirage jp, expansion lue par la jointure) et UNE source artofpkm sur SA liste, sans sous-section ni setDeBase ;
//   · aucune autre ligne (à la main ou automatique) ne lit la même liste : une liste partagée sans `setDeBase` cherche ses images sous le mauvais slug ;
//   · la note de la source DIT ce qui a été lu (pages, date, largeur, clé de jointure) et ce qui est MODÉLISÉ ;
//   · les sets NON prouvés n'ont AUCUNE source active : CGY (aucune page lue, plafond de requêtes), IPNC/IPNT (une liste, deux decks, aucun numéro, aucune sous-section),
//     pcgG (six listes dont deux jamais lues), HRDK (liste jamais lue) ; les deux « PROBABLE » devenus actifs (sm2+, MCRP) sortent de sources-sets-en-attente.json ;
//   · aucune source existante n'a bougé (le nombre de lignes de ARTOFPKM n'augmente que de six).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ligne, TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { sourceDe, ARTOFPKM, ARTOFPKM_AUTO } = require('./collecte-cartes/sources-sets');

const BASE_ARTOFPKM = 100;   // lignes de ARTOFPKM (table à la main) avant le lot, sur main 3f3e28eb
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };

const ATTENDU = {
    'sm1+': { exp: 3961, slug: 'Strength-Expansion-Pack-Sun-Moon', liste: 332, cle: 'numero' },
    'sm2+': { exp: 3946, slug: 'Facing-a-New-Trial', liste: 335, cle: 'numero' },
    ADV1: { exp: 5877, slug: 'ADV-Expansion-Pack', liste: 65, cle: 'numero' },
    MCRP: { exp: 4276, slug: 'Movie-Commemoration-Random-Pack', liste: 200, cle: 'numero' },
    MEDK: { exp: 4307, slug: 'Magmortar-vs-Electivire-Deck-Kit', liste: 165, cle: 'nom' },
    CGH: { exp: 5682, slug: 'Hanada-City-Gym', liste: 13, cle: 'nom' }
};

for (const [code, a] of Object.entries(ATTENDU)) {
    t(`${code} : la ligne de table porte le slug, l'expansion Cardmarket et le tirage jp que la jointure des images lit`, () => {
        const l = ligne(code);
        assert.ok(l, `ligne(${code}) absente`);
        assert.strictEqual(l.exp, a.exp); assert.strictEqual(l.slugSet, a.slug); assert.strictEqual(l.bulba.tirage, 'jp'); assert.ok(l.bulba.expansion);
    });
    t(`${code} : la source artofpkm est la liste ${a.liste}, sans sous-section ni setDeBase`, () => {
        const s = sourceDe(code);
        assert.ok(s, `sourceDe(${code}) absente`); assert.deepStrictEqual(s.ids, [a.liste]); assert.ok(s.noms.length >= 1 && s.noms.every(n => typeof n === 'string' && n));
        assert.strictEqual(s.sousSection, undefined); assert.strictEqual(s.setDeBase, undefined);
    });
    t(`${code} : la source est dans la table à la main (ARTOFPKM), pas dans la table générée (une régénération l'effacerait)`, () => {
        assert.ok(ARTOFPKM[code], 'absente de ARTOFPKM'); assert.strictEqual(ARTOFPKM_AUTO[code], undefined);
    });
    t(`${code} : seule cette ligne lit la liste ${a.liste}`, () => {
        const lisent = Object.entries({ ...ARTOFPKM_AUTO, ...ARTOFPKM }).filter(([, s]) => (s.ids || []).includes(a.liste)).map(([c]) => c);
        assert.deepStrictEqual(lisent, [code]);
    });
    t(`${code} : la note dit ce qui a été LU (pages, date, largeur) et la clé de jointure (${a.cle})`, () => {
        const n = sourceDe(code).note || '';
        assert.ok(/2026-10-13/.test(n), 'date de la lecture'); assert.ok(/pages? lues?/.test(n), 'pages lues'); assert.ok(/\d{3} px/.test(n), 'largeur lue');
        assert.ok(a.cle === 'numero' ? /numéro ET nom/.test(n) && /MODÉLISÉS?/.test(n) : /nom seul|par le nom/.test(n), `clé ${a.cle} non dite`);
    });
}
t('les trois sets à numéro lu sur 3 pages disent 3 pages (premier, milieu, dernier) ; MCRP et les sets au nom en disent le nombre exact', () => {
    for (const c of ['sm1+', 'sm2+', 'ADV1']) assert.ok(/3 pages lues/.test(sourceDe(c).note), c);
    assert.ok(/2 pages lues/.test(sourceDe('MCRP').note) && /2 pages lues/.test(sourceDe('MEDK').note) && /1 page lue/.test(sourceDe('CGH').note));
});
t('(tour 2) les six lignes DÉCLARENT la parade `gardeSansNumero` ; aucune autre ligne de source ne la porte (IPB, déjà servi, reste inerte)', () => {
    for (const c of Object.keys(ATTENDU)) assert.strictEqual(sourceDe(c).gardeSansNumero, true, c);
    const autres = Object.entries({ ...ARTOFPKM_AUTO, ...ARTOFPKM }).filter(([c, s]) => s.gardeSansNumero && !ATTENDU[c]).map(([c]) => c);
    assert.deepStrictEqual(autres, []); assert.strictEqual(sourceDe('IPB').gardeSansNumero, undefined);
});
// (lot JA-2, 2026-10-13) les neuf sets que ce banc gardait « non prouvés » (CGY, CGN, CGK, CGT, GTG, HRDK, pcgG, IPNC, IPNT) ont leur source, prouvée : leur banc est test-lignes-ja2.js.
t('sources-sets-en-attente.json : sm2+ et MCRP (actifs depuis le lot JA) en sortent ; CGY et IPN (actifs depuis le lot JA-2) aussi', () => {
    const att = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'sources-sets-en-attente.json'), 'utf8'));
    assert.strictEqual(att['sm2+'], undefined); assert.strictEqual(att.MCRP, undefined);
    assert.strictEqual(att.CGY, undefined); assert.strictEqual(att.IPN, undefined);
});
t('le lot ne touche aucune source existante : ARTOFPKM ne gagne que six lignes (neuf de plus depuis, au lot JA-2)', () => {
    const attendu = ['ADV1', 'CGH', 'MCRP', 'MEDK', 'sm1+', 'sm2+'];
    const txt = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'sources-sets.js'), 'utf8');
    for (const c of attendu) assert.ok(txt.includes(c.includes('+') ? `'${c}'` : c), c);
    assert.strictEqual(Object.keys(ARTOFPKM).length, BASE_ARTOFPKM + 6 + 9, `ARTOFPKM compte ${Object.keys(ARTOFPKM).length} lignes`);
});
t('(les lignes de table existantes ne sont pas réécrites) chaque code du lot est dans une seule des trois tables', () => {
    for (const c of Object.keys(ATTENDU)) {
        const n = [TABLE, TABLE_AUTO, TABLE_SANS_PAGE].filter(T => T.some(l => l.code === c)).length;
        assert.ok(n >= 1, `${c} dans aucune table`);
    }
});
console.log(`\n${ok} réussi(s), ${ko} en échec`);
process.exit(ko ? 1 : 0);
