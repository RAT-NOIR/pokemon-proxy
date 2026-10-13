'use strict';
// Lot JA-2 (2026-10-13) — neuf sources artofpkm de sets japonais jamais rattachés : les cinq Gyms (CGN Nivi, CGK Kuchiba, CGT Tamamushi, CGY Yamabuki, GTG Guren), HRDK (Heatran vs Regigigas Deck Kit),
// pcgG (Quick Construction Packs, six listes) et les deux decks d'Intro Pack Neo (IPNC, IPNT : une liste, deux plages de rangs). Sans réseau, sans base.
//   node test-lignes-ja2.js
// Ce que le test GARDE (écrit par ce qu'il autorise) :
//   · chaque set a une ligne de table (slug, tirage jp) ET UNE source artofpkm à la main, sur SA liste (ou ses six listes, ou sa plage), avec une note qui dit ce qui a été LU (date, pages, largeur) ;
//   · aucune autre ligne (à la main ou automatique) ne lit ces listes, sauf les deux lignes d'Intro Pack Neo qui se partagent la liste 42 par des plages DISJOINTES ;
//   · `plageDeRangs` n'est déclarée que par IPNC [1,40] et IPNT [41,80] ; `numerosPartages` que par pcgG ; aucune de ces lignes ne déclare `gardeSansNumero` (mesuré inutile : 0 image refusée) ;
//   · les trois fichiers regardés à l'œil le 2026-10-13 sont des corrections (Mewtwo LV.X et Gliscor LV.X que la page nomme « Mewtwo » et « Gliscor », Milotic ex nommé « Milotic ») ;
//   · rien d'autre ne bouge : ARTOFPKM ne gagne que neuf lignes, les lignes du lot JA gardent leur source.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ligne, TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { sourceDe, ARTOFPKM, ARTOFPKM_AUTO } = require('./collecte-cartes/sources-sets');
const { correctionDe } = require('./collecte-cartes/corrections-images');

const BASE_ARTOFPKM = 106;   // lignes de ARTOFPKM (table à la main) après le lot JA, sur main d446c782
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };

const ATTENDU = {
    CGN: { exp: 5681, slug: 'Nivi-City-Gym', ids: [12] },
    CGK: { exp: 5683, slug: 'Kuchiba-City-Gym', ids: [15] },
    CGT: { exp: 5684, slug: 'Tamamushi-City-Gym', ids: [16] },
    CGY: { exp: 5685, slug: 'Yamabuki-City-Gym', ids: [21] },
    GTG: { exp: 5686, slug: 'Guren-Town-Gym', ids: [22] },
    HRDK: { exp: 4303, slug: 'Heatran-vs-Regigigas-Deck-Kit', ids: [173] },
    pcgG: { exp: 5723, slug: 'Quick-Construction-Packs', ids: [103, 104, 105, 106, 107, 108], numerosPartages: true },
    IPNC: { exp: 5061, slug: 'Intro-Pack-Neo-Chikorita', ids: [42], plageDeRangs: [1, 40] },
    IPNT: { exp: 5062, slug: 'Intro-Pack-Neo-Totodile', ids: [42], plageDeRangs: [41, 80] }
};
const TOUTES = { ...ARTOFPKM_AUTO, ...ARTOFPKM };

for (const [code, a] of Object.entries(ATTENDU)) {
    t(`${code} : la ligne de table porte le slug, l'expansion Cardmarket et le tirage jp que la jointure des images lit`, () => {
        const l = ligne(code);
        assert.ok(l, `ligne(${code}) absente`);
        assert.strictEqual(l.exp, a.exp); assert.strictEqual(l.slugSet, a.slug); assert.strictEqual(l.bulba.tirage || 'jp', 'jp', 'tirage : celui de la ligne, ou jp par défaut comme joindreImages'); assert.ok(l.bulba.expansion);
    });
    t(`${code} : la source artofpkm est ${a.ids.length > 1 ? 'les listes ' : 'la liste '}${a.ids.join(', ')}, sans sous-section ni setDeBase`, () => {
        const s = sourceDe(code);
        assert.ok(s, `sourceDe(${code}) absente`); assert.deepStrictEqual(s.ids, a.ids); assert.ok(s.noms.length === a.ids.length && s.noms.every(n => typeof n === 'string' && n), 'un nom artofpkm par liste');
        assert.strictEqual(s.sousSection, undefined); assert.strictEqual(s.setDeBase, undefined);
    });
    t(`${code} : la source est dans la table à la main (ARTOFPKM), pas dans la table générée (une régénération l'effacerait)`, () => {
        assert.ok(ARTOFPKM[code], 'absente de ARTOFPKM'); assert.strictEqual(ARTOFPKM_AUTO[code], undefined);
    });
    t(`${code} : la note dit ce qui a été LU (date, pages, largeur)`, () => {
        const n = sourceDe(code).note || '';
        assert.ok(/2026-10-13/.test(n), 'date de la lecture'); assert.ok(/pages? lues?/.test(n), 'pages lues'); assert.ok(/\d{3} px/.test(n), 'largeur lue');
    });
    t(`${code} : ne déclare ni la parade gardeSansNumero (mesurée inutile) ni une déclaration qui n'est pas la sienne`, () => {
        const s = sourceDe(code);
        assert.strictEqual(s.gardeSansNumero, undefined);
        assert.deepStrictEqual(s.plageDeRangs, a.plageDeRangs); assert.strictEqual(s.numerosPartages, a.numerosPartages);
    });
}
t('une liste n\'est lue que par ses lignes : seules IPNC et IPNT partagent la liste 42, par des plages DISJOINTES', () => {
    for (const [code, a] of Object.entries(ATTENDU)) for (const id of a.ids) {
        const lisent = Object.entries(TOUTES).filter(([, s]) => (s.ids || []).includes(id)).map(([c]) => c).sort();
        assert.deepStrictEqual(lisent, id === 42 ? ['IPNC', 'IPNT'] : [code], `liste ${id}`);
    }
    const [c, t2] = [sourceDe('IPNC').plageDeRangs, sourceDe('IPNT').plageDeRangs];
    assert.ok(c[1] < t2[0] || t2[1] < c[0], 'plages disjointes');
});
t('`plageDeRangs` et `numerosPartages` n\'existent que sur les lignes qui les ont mesurées', () => {
    assert.deepStrictEqual(Object.entries(TOUTES).filter(([, s]) => s.plageDeRangs).map(([c]) => c).sort(), ['IPNC', 'IPNT']);
    assert.deepStrictEqual(Object.entries(TOUTES).filter(([, s]) => s.numerosPartages).map(([c]) => c), ['pcgG']);
});
t('la note d\'Intro Pack Neo dit la mesure du rang (35 produits sur 35) et celle de Quick dit les clés partagées', () => {
    for (const c of ['IPNC', 'IPNT']) assert.ok(/rang/.test(sourceDe(c).note) && /(20|15) produits sur \1/.test(sourceDe(c).note) && /aucun numéro imprimé/.test(sourceDe(c).note), c);
    assert.ok(/clés? partagées?/.test(sourceDe('pcgG').note) && /fiches simples/.test(sourceDe('pcgG').note));
});
t('Kuchiba dit sa vignette de 322 px et HRDK sa vignette de 162 px (écartées une à une au téléchargement, jamais le set)', () => {
    assert.ok(/322 px/.test(sourceDe('CGK').note)); assert.ok(/162 px/.test(sourceDe('HRDK').note));
});
t('trois corrections LUES À L\'ŒIL le 2026-10-13 : Mewtwo LV.X, Gliscor LV.X, Milotic ex (la page artofpkm les nomme sans leur suffixe)', () => {
    const attendu = { 'artofpkm/173/15.webp': 50861, 'artofpkm/173/16.webp': 51213, 'artofpkm/105/4.webp': 51875 };
    for (const [cle, carteId] of Object.entries(attendu)) {
        const c = correctionDe(cle);
        assert.ok(c, `${cle} absente`); assert.strictEqual(c.carteId, carteId); assert.strictEqual(c.le, '2026-10-13'); assert.ok(c.lu && c.cause, 'ce qui a été lu et pourquoi');
    }
});
t('sources-sets-en-attente.json : CGY (prouvée) et IPN (plage mesurée) en sortent ; HRDK, Gyms, Quick n\'y sont pas', () => {
    const att = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'sources-sets-en-attente.json'), 'utf8'));
    for (const c of ['CGY', 'IPN', 'HRDK', 'CGN', 'CGK', 'CGT', 'GTG', 'pcgG']) assert.strictEqual(att[c], undefined, c);
});
t('le lot ne touche aucune source existante : ARTOFPKM ne gagne que neuf lignes, et les six du lot JA gardent leur liste', () => {
    assert.strictEqual(Object.keys(ARTOFPKM).length, BASE_ARTOFPKM + 9, `ARTOFPKM compte ${Object.keys(ARTOFPKM).length} lignes`);
    const ja = { 'sm1+': [332], 'sm2+': [335], ADV1: [65], MCRP: [200], MEDK: [165], CGH: [13] };
    for (const [c, ids] of Object.entries(ja)) assert.deepStrictEqual(sourceDe(c).ids, ids, c);
});
t('(les lignes de table existantes ne sont pas réécrites) chaque code du lot est dans au moins une table', () => {
    for (const c of Object.keys(ATTENDU)) assert.ok([TABLE, TABLE_AUTO, TABLE_SANS_PAGE].some(T => T.some(l => l.code === c)), `${c} dans aucune table`);
});
console.log(`\n${ok} réussi(s), ${ko} en échec`);
process.exit(ko ? 1 : 0);
