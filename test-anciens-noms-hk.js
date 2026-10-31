// Banc de collecte-cartes/anciens-noms-hk.js (anciens noms de Hong Kong par n° de Pokédex, deux sources). Aucune base, aucun réseau.
// Les extraits sont RÉELS : fixtures-anciens-noms-hk/52poke-025-pikachu.html = bloc du n° national + tableau des noms de la page https://wiki.52poke.com/wiki/皮卡丘 lue le 2026-10-31.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const A = require('./collecte-cartes/anciens-noms-hk');
const TZ = require('./collecte-cartes/table-zh');
let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.message).split('\n')[0]); } };
const PIKACHU = fs.readFileSync(path.join(__dirname, 'fixtures-anciens-noms-hk', '52poke-025-pikachu.html'), 'utf8');
const src = (source, parDex) => ({ source, licence: 'CC BY-NC-SA 3.0', luLe: '2026-10-31', parDex });

t('52poke : la page réelle de Pikachu donne le n° 25 et ses noms de Hong Kong (比卡超 inclus, le nom latin « Pikachu » de la chaîne câblée exclu)', () => {
    const r = A.lirePage52poke(PIKACHU);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.dex, 25);
    assert.deepStrictEqual(r.hk, ['皮卡丘', '比卡超']);
});
t('52poke : une ligne « 大陸 » ou « 台灣 » n\'est jamais un nom de Hong Kong (mutation du libellé de région : plus aucun nom)', () => {
    const r = A.lirePage52poke(PIKACHU.replace(/香港/g, '澳門'));
    assert.strictEqual(r.ok, true);
    assert.deepStrictEqual(r.hk, []);
});
t('52poke : le n° vient de la page (mutation #0025 -> #0026 : 26) ; sans n° national la page est REFUSÉE', () => {
    assert.strictEqual(A.lirePage52poke(PIKACHU.replace('#0025', '#0026')).dex, 26);
    const r = A.lirePage52poke(PIKACHU.replace(/#0025/g, ''));
    assert.strictEqual(r.ok, false);
    assert.match(r.raison, /numéro national/);
});
t('52poke : sans tableau des noms (page tronquée) -> refus nommé, jamais une liste vide silencieuse', () => {
    const r = A.lirePage52poke(PIKACHU.slice(0, PIKACHU.indexOf('<table')));
    assert.strictEqual(r.ok, false);
    assert.match(r.raison, /tableau des noms/);
});
t('croisement : un nom n\'est admis que s\'il est donné par les DEUX sources pour le MÊME n° ; le nom d\'une seule source est écarté', () => {
    const r = A.croiserAnciensNomsHk(src('52poke', { 25: ['比卡超', '皮卡丘'] }), src('zhwiki', { 25: ['比卡超'] }));
    assert.deepStrictEqual(r.table, { 比卡超: 'D25' });
    assert.strictEqual(r.entrees.length, 1);
    assert.deepStrictEqual(r.entrees[0].sources.map(s => s.source).sort(), ['52poke', 'zhwiki']);
    assert.ok(r.entrees[0].sources.every(s => s.licence && s.luLe));
});
t('croisement : le même nom donné pour deux n° différents par les deux sources = CONTRADICTION, retrait (jamais arbitré)', () => {
    const r = A.croiserAnciensNomsHk(src('52poke', { 25: ['比卡超'] }), src('zhwiki', { 26: ['比卡超'] }));
    assert.deepStrictEqual(r.table, {});
    assert.deepStrictEqual(r.contestes, ['比卡超']);
    assert.match(r.retraits[0].motif, /contradiction/);
});
t('croisement : un nom ambigu sur deux n° DANS UNE source est retiré même si l\'autre source le donne pour l\'un des deux (contesté)', () => {
    const r = A.croiserAnciensNomsHk(src('52poke', { 1: ['同'], 2: ['同'] }), src('zhwiki', { 1: ['同'] }));
    assert.deepStrictEqual(r.table, {});
    assert.deepStrictEqual(r.contestes, ['同']);
    assert.match(r.retraits[0].motif, /ambigu/);
});
t('croisement : une seule source disponible (ou sans nom) n\'admet RIEN et le dit', () => {
    const r = A.croiserAnciensNomsHk(src('52poke', { 25: ['比卡超'] }), null);
    assert.deepStrictEqual(r.table, {});
    assert.match(r.message, /deux sources/);
});
t('croisement : une source sans licence ou sans date de lecture est refusée (la provenance n\'est pas facultative)', () => {
    assert.throws(() => A.croiserAnciensNomsHk({ source: 'x', parDex: { 25: ['比卡超'] } }, src('zhwiki', { 25: ['比卡超'] })), /licence/);
});
t('CALIBRATION QUI SAIT DIRE NON : la page réelle de Pikachu croisée avec une seconde source dont le n° est faux n\'admet aucun nom ; avec le bon n°, 比卡超 est admis', () => {
    const p = A.lirePage52poke(PIKACHU);
    const vrai = A.croiserAnciensNomsHk(src('52poke', { [p.dex]: p.hk }), src('zhwiki', { 25: ['比卡超'] }));
    assert.strictEqual(vrai.table['比卡超'], 'D25');
    const faux = A.croiserAnciensNomsHk(src('52poke', { [p.dex]: p.hk }), src('zhwiki', { 26: ['比卡超'] }));
    assert.strictEqual(faux.table['比卡超'], undefined);
    const inverse = A.croiserAnciensNomsHk(src('52poke', { [p.dex + 1]: p.hk }), src('zhwiki', { 25: ['比卡超'] }));
    assert.deepStrictEqual(inverse.table, {});
});
t('fichier de table : lireAnciensNomsHk relit la table croisée (provenance obligatoire) et fusionnerEspeces retire les noms contestés AUSSI de PokeAPI', () => {
    const r = A.croiserAnciensNomsHk(src('52poke', { 25: ['比卡超'], 1: ['同'], 2: ['同'] }), src('zhwiki', { 25: ['比卡超'], 1: ['同'] }));
    const f = A.lireAnciensNomsHk(JSON.parse(JSON.stringify(A.versFichier(r))));
    assert.strictEqual(f.table['比卡超'], 'D25');
    assert.deepStrictEqual(f.contestes, ['同']);
    const m = TZ.fusionnerEspeces({ 同: 'D1', 皮卡丘: 'D25' }, f.table, f.contestes);
    assert.strictEqual(m.table['同'], undefined);
    assert.strictEqual(m.table['比卡超'], 'D25');
    assert.throws(() => A.lireAnciensNomsHk({ entrees: [{ dex: 25, nom: '比卡超', sources: [] }] }), /provenance|source/);
});
t('branchement : chargerSources lit anciens-noms-hk.json quand il existe, et un nom HK contredit par PokeAPI/Wikidata (autre n°) est retiré', () => {
    const FPS = require('./collecte-cartes/fiches-preuve-set');
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ahk-'));
    for (const s of ['cache/sets', 'pokeapi']) fs.mkdirSync(path.join(d, s), { recursive: true });
    fs.writeFileSync(path.join(d, 'cache/sets/a.json'), JSON.stringify({ etiquette: 'a', cartes: [] }));
    fs.writeFileSync(path.join(d, 'table-zh-tw.json'), JSON.stringify({ table: {} }));
    fs.writeFileSync(path.join(d, 'pokeapi/pokemon_species_names.csv'), 'pokemon_species_id,local_language_id,name,genus\n25,4,皮卡丘,x\n58,4,卡蒂狗,x\n133,4,伊布,x\n');
    fs.writeFileSync(path.join(d, 'pokeapi/LU-LE.txt'), '2026-10-31');
    const r = A.croiserAnciensNomsHk(src('52poke', { 25: ['比卡超'], 58: ['護主犬'], 133: ['卡蒂狗'] }), src('zhwiki', { 25: ['比卡超'], 58: ['護主犬'], 133: ['卡蒂狗'] }));
    fs.mkdirSync(path.join(d, 'anciens-noms-hk'), { recursive: true });
    fs.writeFileSync(path.join(d, 'anciens-noms-hk', 'anciens-noms-hk.json'), JSON.stringify(A.versFichier(r)));
    const c = FPS.chargerSources(d);
    assert.strictEqual(c.ESPECES.table['比卡超'], 'D25');
    assert.strictEqual(c.ESPECES.table['護主犬'], 'D58');
    assert.strictEqual(c.ESPECES.table['卡蒂狗'], undefined);   // PokeAPI : D58, les deux sources HK : D133 -> contradiction, retiré
    assert.ok(c.journal.some(l => /anciens noms de Hong Kong/.test(l)));
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
