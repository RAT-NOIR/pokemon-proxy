'use strict';
// Lot V8 (2026-10-12, tour 1) — les lignes de table et de source des visuels artofpkm de MSM, DHD, GHD, MED, CLL, CLK. Sans réseau, sans base.
//   node test-lignes-v8.js
// Ce que le test GARDE (écrit par ce qu'il autorise) :
//   · chaque ligne existe, avec le slug, le tirage, l'expansion et le DECK que la jointure des images lit (collecteur-images.js l.361-362) ;
//   · chaque ligne a sa source artofpkm, sur la liste mesurée à l'étape 1, et — pour un kit à sous-sections — SA sous-section déclarée ;
//   · une liste lue par plusieurs lignes (176, 545) porte `setDeBase` sur toutes (sans lui, la seconde cherche ses images sous son propre slug) ;
//   · CLF (Classic Venusaur, sous-section 676) n'a PAS de source active : ses 3 premières largeurs (321, 321, 500) donnent une médiane de 321 < 350, refus certain ;
//     sa ligne prête vit dans sources-sets-en-attente.json, que rien ne lit (voir couverture\S3\V8-report.md) ;
//   · aucune ligne EXISTANTE ne déclare `sousSection` : les règles du tour 1 n'ont donc aucun effet rétroactif (mesuré : retro-tour1.js).
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ligne, TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./collecte-cartes/table-sets');
const { sourceDe, ARTOFPKM, ARTOFPKM_AUTO } = require('./collecte-cartes/sources-sets');

let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };

const GVD = ['Giratina vs Dialga Deck Kit', 'Giratina vs Dialga'];
const ATTENDU = {
    MSM: { exp: 4319, slug: 'Entry-Pack-DP', expansion: "Movie Commemoration VS Pack: Sea's Manaphy", deck: undefined, liste: 140, sous: undefined },
    DHD: { exp: 4300, slug: 'Dialga-Half-Deck', expansion: GVD, deck: 'Dialga Half Deck', liste: 176, sous: 649 },
    GHD: { exp: 4301, slug: 'Giratina-Half-Deck', expansion: GVD, deck: 'Giratina Half Deck', liste: 176, sous: 648 },
    MED: { exp: 4267, slug: 'Metagross-Expert-Deck', expansion: 'Leafeon vs Metagross Expert Deck', deck: 'Metagross Deck', liste: 206, sous: 643 },
    CLL: { exp: 5528, slug: 'Pokemon-Card-Game-Classic-Charizard-Ho-Oh-ex-Deck', expansion: 'Pokémon Card Game Classic', deck: 'Charizard & Ho-Oh ex Deck', liste: 545, sous: 677 },
    CLK: { exp: 5529, slug: 'Pokemon-Card-Game-Classic-Blastoise-Suicune-ex-Deck', expansion: 'Pokémon Card Game Classic', deck: 'Blastoise & Suicune ex Deck', liste: 545, sous: 678 }
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
    t(`${code} : la source artofpkm est la liste ${a.liste}${a.sous ? `, sous-section ${a.sous}` : ''}`, () => {
        const s = sourceDe(code);
        assert.ok(s, `sourceDe(${code}) absente`); assert.deepStrictEqual(s.ids, [a.liste]); assert.ok(s.noms.length >= 1);
        assert.strictEqual(s.sousSection, a.sous);
    });
    t(`${code} : « verifie » dit la source lue (pages, numéro ET nom, date), pas la création du set`, () => {
        const v = ligne(code).verifie;
        assert.ok(/artofpkm/.test(v.note) && /pages? lues?/.test(v.note) && !/creer-sets-sans-page|créé par/.test(v.note), v.note);
        assert.strictEqual(v.le, '2026-10-12');
    });
}
t('(tour 2, A-I1) les largeurs ne sont citées que pour la sous-section où elles ont été lues ; le numéro imprimé hors pages lues est dit MODÉLISÉ', () => {
    for (const c of ['DHD', 'MED']) { const n = sourceDe(c).note, v = ligne(c).verifie.note; assert.ok(/non mesurées/.test(n) && /non mesurées/i.test(v), c); assert.ok(!/originaux 500 px|originaux 444-500 px/.test(n), c); }
    for (const c of ['CLL', 'CLK']) assert.ok(/une seule largeur lue/.test(sourceDe(c).note) && /UNE seule largeur lue/.test(ligne(c).verifie.note), c);
    for (const c of ['MSM', 'DHD', 'GHD', 'MED', 'CLL', 'CLK']) assert.ok(/MODÉLISÉS?/.test(ligne(c).verifie.note) || /modélisé/.test(sourceDe(c).note), c);
    for (const c of ['MSM', 'DHD', 'GHD', 'MED', 'CLL', 'CLK']) assert.ok(!/(?<!prévue )\b\d+ numéros ET noms concordants/.test(ligne(c).verifie.note), `${c} : « N concordants » sans dire que c'est une prévision`);
});
t('(tour 2, A-I2) tout module de la jointure artofpkm est dans REGLES (la garde du commit du worker)', () => {
    const txt = fs.readFileSync(path.join(__dirname, 'remettre-en-file.js'), 'utf8');
    const bloc = txt.slice(txt.indexOf('const REGLES'), txt.indexOf('];', txt.indexOf('const REGLES')));
    for (const f of ['echantillon-mesure', 'sous-section-image', 'images-cle-partagee', 'image-fiche-simple', 'jointure', 'artofpkm', 'schemas', 'verrou-source', 'alimentateur']) assert.ok(bloc.includes(`collecte-cartes/${f}.js`), f);
    const src = fs.readFileSync(path.join(__dirname, 'collecteur-images.js'), 'utf8');
    for (const m of ['echantillon-mesure', 'sous-section-image', 'images-cle-partagee', 'image-fiche-simple']) assert.ok(src.includes(`./collecte-cartes/${m}`) && fs.existsSync(path.join(__dirname, 'collecte-cartes', `${m}.js`)), m);
});
t('une liste lue par plusieurs lignes porte setDeBase sur toutes (176 : DHD, GHD ; 545 : CLL, CLK)', () => {
    for (const c of ['DHD', 'GHD', 'CLL', 'CLK']) assert.ok(sourceDe(c).setDeBase, c);
});
t('CLF : ligne de table sans source active (refus certain de sa sous-section 676) ; ligne prête en attente', () => {
    assert.ok(ligne('CLF'), 'la ligne de table existe'); assert.strictEqual(ligne('CLF').bulba.deck, 'Venusaur & Lugia ex Deck');
    assert.strictEqual(sourceDe('CLF'), null, 'CLF a une source active');
    const att = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'sources-sets-en-attente.json'), 'utf8'));
    assert.ok(att.CLF, 'CLF absente de sources-sets-en-attente.json');
    assert.deepStrictEqual(att.CLF.source.ids, [545]); assert.strictEqual(att.CLF.source.sousSection, 676); assert.ok(att.CLF.source.setDeBase);
    assert.ok(/321/.test(att.CLF.note), 'la note dit la mesure');
});
t('seules les lignes du lot déclarent sousSection (aucune ligne EXISTANTE : zéro effet rétroactif)', () => {
    const declarent = Object.entries({ ...ARTOFPKM_AUTO, ...ARTOFPKM }).filter(([, s]) => s.sousSection != null).map(([c]) => c).sort();
    assert.deepStrictEqual(declarent, ['CLK', 'CLL', 'DHD', 'GHD', 'MED']);
});
console.log(`\n${ok} réussi(s), ${ko} en échec`);
process.exit(ko ? 1 : 0);
