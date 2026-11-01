// Banc de collecte-cartes/meme-illustration.js : images FABRIQUÉES (sharp), aucune image réelle, aucun réseau.
const assert = require('assert');
const sharp = require('sharp');
const MI = require('./collecte-cartes/meme-illustration');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ok  ' + nom); } catch (e) { ko++; console.log('  ECHEC ' + nom + '\n        ' + String(e.stack || e.message).split('\n').slice(0, 3).join('\n        ')); } };

const W = 300, H = 420;
/** Une « carte » fabriquée : un dessin (rectangles pleins à des positions données) dans la fenêtre d'illustration. */
const carte = async (formes, surcouche = null) => {
    const base = sharp({ create: { width: W, height: H, channels: 3, background: '#d8d0c0' } });
    const svg = `<svg width="${W}" height="${H}">${formes.map(([x, y, w, h, c]) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`).join('')}${surcouche || ''}</svg>`;
    return base.composite([{ input: Buffer.from(svg) }]).png().toBuffer();
};
const DESSIN_A = [[40, 50, 100, 60, '#c03020'], [160, 80, 90, 70, '#2040c0'], [60, 130, 150, 30, '#20a040']];
const DESSIN_B = [[200, 40, 60, 110, '#101010'], [30, 100, 60, 60, '#e0c020'], [100, 40, 40, 30, '#8020a0']];
const ETOILES = Array.from({ length: 40 }, (_, i) => `<circle cx="${(i * 37) % 280 + 10}" cy="${(i * 53) % 170 + 40}" r="4" fill="#ffffff" opacity="0.5"/>`).join('');

(async () => {
    await t('deux fois le MÊME dessin : corrélation ≈ 1', async () => {
        const a = await MI.empreinteIllustration(await carte(DESSIN_A)), b = await MI.empreinteIllustration(await carte(DESSIN_A));
        assert.ok(MI.correlation(a, b) > 0.999, String(MI.correlation(a, b)));
    });
    await t('le même dessin sous une finition holo (surcouche d\'étoiles) : la corrélation baisse mais reste haute', async () => {
        const a = await MI.empreinteIllustration(await carte(DESSIN_A)), b = await MI.empreinteIllustration(await carte(DESSIN_A, ETOILES));
        assert.ok(MI.correlation(a, b) > 0.6, String(MI.correlation(a, b)));
    });
    await t('NON : un AUTRE dessin : corrélation basse', async () => {
        const a = await MI.empreinteIllustration(await carte(DESSIN_A)), b = await MI.empreinteIllustration(await carte(DESSIN_B));
        assert.ok(MI.correlation(a, b) < 0.4, String(MI.correlation(a, b)));
    });
    await t('une empreinte est normalisée (norme 1, moyenne 0) ; des tailles d\'empreinte différentes lèvent', async () => {
        const a = await MI.empreinteIllustration(await carte(DESSIN_A));
        assert.ok(Math.abs(MI.correlation(a, a) - 1) < 1e-9);
        assert.throws(() => MI.correlation(a, a.slice(0, 10)), /tailles différentes/);
    });
    await t('séparer : un VIDE entre « mêmes » et « autres » sépare, le seuil est le milieu du vide', () => {
        const r = MI.separer([0.9, 0.8, 0.7], [0.3, 0.5]);
        assert.strictEqual(r.separe, true); assert.strictEqual(r.seuil, 0.6); assert.ok(Math.abs(r.vide - 0.2) < 1e-9);
    });
    await t('NON : des populations qui se chevauchent ne séparent pas — aucun seuil, rien n\'est prouvé', () => {
        const r = MI.separer([0.9, 0.55], [0.3, 0.6]);
        assert.strictEqual(r.separe, false); assert.strictEqual(r.seuil, null);
    });
    await t('NON : une population vide ne sépare pas (une mesure sur zéro ne prouve rien)', () => {
        assert.strictEqual(MI.separer([], [0.1]).separe, false); assert.strictEqual(MI.separer([0.9], []).separe, false);
    });
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
