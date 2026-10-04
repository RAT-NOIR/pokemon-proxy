// ============================================================
// LE CALCUL DU DÉPARTAGE PAR L'IMAGE, HORS LIGNE — decrire, inliers, outils, lireBorne (2026-10-04)
// ============================================================
// POURQUOI MAINTENANT : le verrou ne télécharge plus de photo chez Vinted (décision du testeur, 2026-10-04 : « un jeu de photos fixe,
// conservé en local »). Aucune ligne du jeu fixe n'entre dans la condition du départage (périmètre asiatique) : la cellule « départage
// par l'image » est vide, et ces quatre fonctions n'étaient exercées QUE par elle — le cliquet les perdait. Elles le sont ici, sur des
// images SYNTHÉTIQUES fabriquées par le banc (aucune photo d'annonce, aucune base, aucun réseau), avec des assertions sur ce qu'elles
// rendent — pas une simple traversée :
//   · une image appariée à ELLE-MÊME donne beaucoup d'inliers ; à une image sans rapport, presque aucun ;
//   · une image légèrement recadrée et réduite reste appariée (la géométrie RANSAC tient) ;
//   · lireBorne rend les octets, refuse une photo au-delà du plafond, annoncé ou réel.
const assert = require('assert');
const IMG = require('./departage-image');

// un générateur à graine fixe : le banc rend le même résultat à chaque exécution
function prng(graine) { let s = graine >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
async function imageSynthetique(sharp, graine, { w = 600, h = 840 } = {}) {
    const r = prng(graine);
    const formes = [];
    for (let i = 0; i < 160; i++) {
        const x = Math.floor(r() * w), y = Math.floor(r() * h), l = 8 + Math.floor(r() * 60), t = 8 + Math.floor(r() * 60), g = Math.floor(r() * 256);
        formes.push(r() < 0.5 ? `<rect x="${x}" y="${y}" width="${l}" height="${t}" fill="rgb(${g},${255 - g},${(g * 7) % 256})"/>` : `<circle cx="${x}" cy="${y}" r="${l / 2}" fill="rgb(${(g * 3) % 256},${g},${255 - g})"/>`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="white"/>${formes.join('')}</svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
}

const cas = [];
const t = (nom, f) => cas.push([nom, f]);
let cv, sharp, A, A2, B;
t('outils charge opencv et sharp', async () => { ({ cv, sharp } = await IMG.outils()); assert.strictEqual(typeof cv.Mat, 'function'); assert.strictEqual(typeof sharp, 'function'); });
t('decrire trouve des points d\'intérêt sur une image texturée', async () => {
    const a = await imageSynthetique(sharp, 7), b = await imageSynthetique(sharp, 99);
    // A2 : la même image, recadrée de 4 % et réduite à 90 % — une « photo » de la même carte
    const m = await sharp(a).metadata();
    const a2 = await sharp(a).extract({ left: 24, top: 34, width: m.width - 48, height: m.height - 68 }).resize({ width: Math.round((m.width - 48) * 0.9) }).toBuffer();
    [A, A2, B] = [await IMG.decrire(a), await IMG.decrire(a2), await IMG.decrire(b)];
    assert.ok(A.n >= 100, `${A.n} points`); assert.strictEqual(A.desc.length, A.n * 32); assert.strictEqual(A.xy.length, A.n * 4);
});
t('decrire sur une image unie : aucun point, et pas de plantage', async () => {
    const unie = await sharp({ create: { width: 300, height: 420, channels: 3, background: '#808080' } }).png().toBuffer();
    assert.strictEqual((await IMG.decrire(unie)).n, 0);
});
t('inliers : une image contre elle-même en donne beaucoup', async () => { assert.ok(IMG.inliers(cv, A, A) >= 50, `${IMG.inliers(cv, A, A)}`); });
t('inliers : la même image recadrée et réduite reste appariée, nettement au-dessus d\'une image sans rapport', async () => {
    const meme = IMG.inliers(cv, A2, A), autre = IMG.inliers(cv, A2, B);
    assert.ok(meme >= 20 && meme > 3 * Math.max(autre, 3), `même ${meme}, autre ${autre}`);
});
t('inliers : une description vide ou dérisoire rend 0', async () => {
    assert.strictEqual(IMG.inliers(cv, { n: 0 }, A), 0); assert.strictEqual(IMG.inliers(cv, A, null), 0); assert.strictEqual(IMG.inliers(cv, { n: 1, desc: Buffer.alloc(32), xy: Buffer.alloc(4) }, A), 0);
});
t('lireBorne rend les octets d\'une réponse', async () => {
    const buf = Buffer.from('abcdef'.repeat(100));
    assert.ok((await IMG.lireBorne(new Response(buf), 10_000)).equals(buf));
});
t('lireBorne refuse une photo annoncée au-delà du plafond', async () => {
    await assert.rejects(IMG.lireBorne(new Response('x'.repeat(10), { headers: { 'content-length': '5000' } }), 1000), /plafond/);
});
t('lireBorne refuse une photo réellement au-delà du plafond, sans annonce', async () => {
    await assert.rejects(IMG.lireBorne(new Response(Buffer.alloc(5000)), 1000), /au-delà de 1000 octets/);
});

(async () => {
    let ok = 0;
    for (const [nom, f] of cas) { try { await f(); ok++; console.log(`  ✅ ${nom}`); } catch (e) { console.log(`  🔴 ${nom} : ${e.message}`); } }
    console.log(`${ok}/${cas.length}`);
    process.exit(ok === cas.length ? 0 : 1);
})();
