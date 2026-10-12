// Banc PUR (T4b, 2026-10-12) : les dates relevées des 7 sets créés par le lot « sets14 » sont dans RELEVES_BULBAPEDIA, avec une copie datée (ou la révision R2) et une citation.
const assert = require('assert');
const { RELEVES_BULBAPEDIA, isoPartiel } = require('./poser-dates-sets');
let ok = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { console.error('  ÉCHEC  ' + nom + '\n     ' + e.message); process.exitCode = 1; } };
const ATTENDU = { 'Entry-Pack-DP': '2006-07-15', 'Dialga-Half-Deck': '2008-07-10', 'Giratina-Half-Deck': '2008-07-10', 'Metagross-Expert-Deck': '2009-11-20', 'Arceus-LVX-Deck-Grass-Fire': '2009-07-08' };
for (const [slug, iso] of Object.entries(ATTENDU)) t(`${slug} : relevé ${iso}, copie datée ou révision R2, citation`, () => {
    const r = RELEVES_BULBAPEDIA[slug]; assert.ok(r, 'relevé absent');
    assert.strictEqual(isoPartiel(r.jour), iso);
    assert.ok(/web\.archive\.org\/web\/\d{14}|r2:\/\/bulba\/\d+\/\d+\.wikitext/.test(r.url), r.url);
    assert.ok(r.citation && r.citation.length > 20);
});
t('Classic (« Late October 2023 ») : AUCUN relevé — une date non prouvée reste absente', () => {
    for (const s of ['Pokemon-Card-Game-Classic-Venusaur-Lugia-ex-Deck', 'Pokemon-Card-Game-Classic-Charizard-Ho-Oh-ex-Deck', 'Pokemon-Card-Game-Classic-Blastoise-Suicune-ex-Deck']) assert.strictEqual(RELEVES_BULBAPEDIA[s], undefined);
});
console.log(process.exitCode ? `\n${ok} ok, ÉCHECS ci-dessus` : `\n${ok}/${ok} passés, 0 échec`);
