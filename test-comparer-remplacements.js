// Banc de comparer-remplacements.js : la mesure d'une paire (ancienne / nouvelle) avec l'empreinte de l'audit IMPORTÉE, les classes aux seuils du coordinateur, les paires d'un plan. Images fabriquées, aucun réseau.
'use strict';
const assert = require('assert');
const fs = require('fs');
const sharp = require('sharp');
const C = require('./comparer-remplacements');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 6).join('\n   ')}`); } };
const prng = g => () => { g = (g * 1664525 + 1013904223) >>> 0; return g / 4294967296; };
/** Une « illustration » : des blocs colorés pseudo-aléatoires (graine), à une taille donnée — la même graine à deux tailles est la même image. */
async function image(graine, w, h) {
    const a = prng(graine), n = 12, brut = Buffer.alloc(n * n * 3);
    for (let i = 0; i < brut.length; i++) brut[i] = Math.floor(a() * 256);
    return sharp(brut, { raw: { width: n, height: n, channels: 3 } }).resize(w, h, { kernel: 'nearest' }).png().toBuffer();
}

(async () => {
    if (!fs.existsSync(C.AUDIT)) { console.log(`⚪ banc ignoré : l'empreinte de l'audit est absente (${C.AUDIT})`); return; }
    const E = require(C.AUDIT);
    await test('classes aux seuils du coordinateur : < 0,55 conforme, 0,55–0,65 incertain, ≥ 0,65 probablement faux ; NaN = sans contraste', () => {
        assert.deepStrictEqual([0, 0.549, 0.55, 0.649, 0.65, 0.918, NaN].map(C.classe), ['conforme', 'conforme', 'incertain', 'incertain', 'probablement-faux', 'probablement-faux', 'sans-contraste']);
    });
    await test('la MÊME image à deux largeurs (300 et 350 px) est conforme, très proche', async () => {
        const m = await C.mesurer({ E, ancien: await image(7, 300, 419), nouveau: await image(7, 350, 482) });
        assert.strictEqual(m.classe, 'conforme'); assert.ok(m.distance < 0.2, String(m.distance)); assert.strictEqual(m.formatAncien && m.formatNouveau, true);
    });
    await test('une AUTRE image est probablement fausse (distance au-dessus du seuil)', async () => {
        const m = await C.mesurer({ E, ancien: await image(7, 300, 419), nouveau: await image(8, 350, 482) });
        assert.strictEqual(m.classe, 'probablement-faux'); assert.ok(m.distance >= C.SEUIL_FAUX, String(m.distance));
    });
    await test('un aplat ne dit rien (sans contraste), une image carrée n\'est pas une carte, des octets quelconques sont « illisible » — jamais une exception', async () => {
        const plat = await sharp({ create: { width: 350, height: 482, channels: 3, background: '#808080' } }).png().toBuffer();
        const m = await C.mesurer({ E, ancien: plat, nouveau: await image(7, 350, 482) });
        assert.strictEqual(m.classe, 'sans-contraste'); assert.strictEqual(m.distance, null);
        assert.strictEqual((await C.mesurer({ E, ancien: await image(7, 400, 400), nouveau: await image(7, 350, 482) })).classe, 'format-non-carte');
        assert.strictEqual((await C.mesurer({ E, ancien: Buffer.from('pas une image'), nouveau: await image(7, 350, 482) })).classe, 'illisible');
    });
    await test('les paires d\'un plan : une par entrée REMPLACÉE d\'une unité à ajouter (ni les cédées, ni les ajouts purs)', () => {
        const plan = { unites: [{ produits: [1], decision: { action: 'ajouter', remplace: [{ cleR2: 'a' }] } }, { produits: [2], decision: { action: 'ajouter', remplace: [] } }, { produits: [3], decision: { action: 'cede', remplace: [] } }, { produits: [4], decision: { action: 'ajouter', remplace: [{ cleR2: 'b' }, { cleR2: 'c' }] } }] };
        assert.deepStrictEqual(C.paires(plan).map(x => [x.u.produits[0], x.e.cleR2]), [[1, 'a'], [4, 'b'], [4, 'c']]);
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
