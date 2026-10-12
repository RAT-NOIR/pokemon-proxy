'use strict';
// Lot V8 (2026-10-12) — les lignes de table et de source des visuels artofpkm de MSM, DHD, GHD et MED. Sans réseau, sans base.
//   node test-lignes-v8.js
// Ce que le test GARDE (écrit par ce qu'il autorise) :
//   · chaque ligne existe, avec le slug, le tirage, l'expansion et le DECK que la jointure des images lit (collecteur-images.js l.361-362) ;
//   · chaque ligne a sa source artofpkm, sur la liste mesurée à l'étape 1 (140, 176, 206) ;
//   · une liste lue par DEUX lignes (176 : DHD et GHD) porte `setDeBase` sur les deux — sans lui, la ligne qui passe seconde cherche ses images
//     sous son propre slug et n'en trouve aucune (collecteur-images.js l.386-389) ;
//   · les trois Classic jp (liste 545) n'ont PAS de source active : leur liste est REFUSÉE par la règle de production (médiane des 3 premières
//     largeurs = 321 px < 350) ; leur ligne prête vit dans sources-sets-en-attente.json, que rien ne lit (voir couverture\S3\V8-report.md).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ligne, TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { sourceDe } = require('./collecte-cartes/sources-sets');

let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };

const ATTENDU = {
    MSM: { exp: 4319, slug: 'Entry-Pack-DP', expansion: "Movie Commemoration VS Pack: Sea's Manaphy", deck: undefined, liste: 140 },
    DHD: { exp: 4300, slug: 'Dialga-Half-Deck', expansion: ['Giratina vs Dialga Deck Kit', 'Giratina vs Dialga'], deck: 'Dialga Half Deck', liste: 176 },
    GHD: { exp: 4301, slug: 'Giratina-Half-Deck', expansion: ['Giratina vs Dialga Deck Kit', 'Giratina vs Dialga'], deck: 'Giratina Half Deck', liste: 176 },
    MED: { exp: 4267, slug: 'Metagross-Expert-Deck', expansion: 'Leafeon vs Metagross Expert Deck', deck: 'Metagross Deck', liste: 206 }
};

for (const [code, a] of Object.entries(ATTENDU)) {
    t(`${code} : la ligne de table porte l'expansion Cardmarket, le slug, le tirage jp et le deck`, () => {
        const l = ligne(code);
        assert.ok(l, `ligne(${code}) absente`);
        assert.strictEqual(l.exp, a.exp); assert.strictEqual(l.slugSet, a.slug); assert.strictEqual(l.region, 'japonais');
        assert.strictEqual(l.bulba.tirage, 'jp'); assert.strictEqual(l.bulba.sansPage, true); assert.strictEqual(l.bulba.titre, null);
        assert.deepStrictEqual(l.bulba.expansion, a.expansion); assert.strictEqual(l.bulba.deck, a.deck);
    });
    t(`${code} : la ligne est dans la table à la main (TABLE), seule à porter ce code`, () => {
        assert.strictEqual(TABLE.filter(l => l.code === code).length, 1, 'une ligne dans TABLE');
        assert.strictEqual([...TABLE_AUTO, ...TABLE_SANS_PAGE].filter(l => l.code === code).length, 0, 'aucune dans les tables générées (une régénération l\'effacerait)');
    });
    t(`${code} : la source artofpkm est la liste ${a.liste}`, () => {
        const s = sourceDe(code);
        assert.ok(s, `sourceDe(${code}) absente`); assert.deepStrictEqual(s.ids, [a.liste]); assert.ok(s.noms.length >= 1);
    });
}
t('la liste 176 (DHD, GHD) est partagée : setDeBase sur les DEUX lignes', () => {
    assert.ok(sourceDe('DHD').setDeBase, 'DHD'); assert.ok(sourceDe('GHD').setDeBase, 'GHD');
});
t('aucun code du lot n\'est déjà porté par une autre ligne (CLF CLL CLK restent libres)', () => {
    for (const c of ['CLF', 'CLL', 'CLK']) assert.strictEqual(ligne(c), null, `${c} est déjà pris`);
});
t('Classic jp : aucune source active (liste 545 refusée par la médiane des 3 premières largeurs) ; ligne prête en attente', () => {
    for (const c of ['CLF', 'CLL', 'CLK']) assert.strictEqual(sourceDe(c), null, `${c} a une source active`);
    const att = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'sources-sets-en-attente.json'), 'utf8'));
    for (const c of ['CLF', 'CLL', 'CLK']) {
        assert.ok(att[c], `${c} absente de sources-sets-en-attente.json`);
        assert.deepStrictEqual(att[c].source.ids, [545]); assert.ok(att[c].source.setDeBase); assert.ok(att[c].ligneDeTable && att[c].ligneDeTable.bulba.deck);
        assert.ok(/321/.test(att[c].note), 'la note dit la mesure');
    }
});
console.log(`\n${ok} réussi(s), ${ko} en échec`);
process.exit(ko ? 1 : 0);
