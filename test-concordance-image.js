'use strict';
// Banc de collecte-cartes/concordance-image.js : images FABRIQUÉES (graine fixe), aucun fichier, aucun réseau, aucune base.
const sharp = require('sharp');
const C = require('./collecte-cartes/concordance-image');

let ok = 0, ko = 0;
function v(nom, obtenu, attendu) {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? 'OK ' : 'KO '} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
}
const vrai = (nom, cond) => v(nom, Boolean(cond), true);

const graine = s => { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; };
function fabriquer(seed, l = 420, h = 587) {
    const r = graine(seed), b = Buffer.alloc(l * h * 3, 128);
    for (let k = 0; k < 260; k++) {
        const x0 = Math.floor(r() * (l - 20)), y0 = Math.floor(r() * (h - 20)), w = 8 + Math.floor(r() * 70), hh = 8 + Math.floor(r() * 70), c = Math.floor(r() * 256);
        for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = x0; x < Math.min(l, x0 + w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = c; }
    }
    return sharp(b, { raw: { width: l, height: h, channels: 3 } });
}

(async () => {
    const A = await fabriquer(11).png().toBuffer();
    const Apetite = await sharp(A).resize({ width: 250 }).jpeg({ quality: 70 }).toBuffer();
    const Ajpeg = await fabriquer(11).jpeg({ quality: 40 }).toBuffer();
    const B = await fabriquer(99).png().toBuffer();

    // phash
    const h = await C.phash(A);
    vrai('phash : 16 caractères hexadécimaux', /^[0-9a-f]{16}$/.test(h));
    v('phash : déterministe', await C.phash(A), h);
    v('distanceHamming : identique = 0', C.distanceHamming(h, h), 0);
    v('distanceHamming : 0000000000000000 / 000000000000000f = 4', C.distanceHamming('0000000000000000', '000000000000000f'), 4);
    v('distanceHamming : tout à 1 = 64', C.distanceHamming('0000000000000000', 'ffffffffffffffff'), 64);
    vrai('phash : une version redimensionnée est proche', C.distanceHamming(h, await C.phash(Apetite)) <= 10);
    vrai('phash : deux images différentes sont loin', C.distanceHamming(h, await C.phash(B)) >= 12);

    // orb
    vrai('orbInliers : même image redimensionnée, beaucoup de points d\'appui', (await C.orbInliers(A, Apetite)) >= 12);
    vrai('orbInliers : deux images différentes, peu de points d\'appui', (await C.orbInliers(A, B)) < 12);

    // concordent
    const r1 = await C.concordent(A, Apetite);
    v('concordent : image et sa version redimensionnée/recompressée', r1.concorde, true);
    v('concordent : image et sa version recompressée JPEG q40', (await C.concordent(A, Ajpeg)).concorde, true);
    const r2 = await C.concordent(A, B);
    v('concordent : deux images différentes', r2.concorde, false);
    vrai('concordent : rend phash, inliers, raison', r2.phash !== undefined && r2.inliers !== undefined && typeof r2.raison === 'string');
    const r3 = await C.concordent(A, Buffer.from('ceci n\'est pas une image'));
    v('concordent : image illisible = null (je ne sais pas)', r3.concorde, null);
    v('concordent : buffer vide = null', (await C.concordent(Buffer.alloc(0), A)).concorde, null);
    const minuscule = await sharp({ create: { width: 6, height: 6, channels: 3, background: '#888' } }).png().toBuffer();
    v('concordent : image trop petite = null', (await C.concordent(minuscule, A)).concorde, null);
    v('concordent : un seul critère favorable ne suffit pas sans calibration (seuils inversés)', (await C.concordent(A, B, { phashMax: 64, inliersMin: 1000 })).concorde, false);

    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error('ERREUR', e); process.exit(1); });
