'use strict';
// BANC-200 (tour 1) — l'empreinte de différence (dHash 64 bits) d'une photo : de quoi reconnaître la RE-PHOTO d'une carte du juge (autre taille, autre compression, léger recadrage), que ni le sha256 ni l'annonce ne voient.
// Image réduite à 9 × 8 gris, un bit par couple de voisins (gauche < droite). Deux photos du même cliché sont à quelques bits ; deux images sans rapport à ~32.
// Coût mesuré au banc : un décodage de plus par photo reçue (quelques ms) ; seuil d'exclusion de l'export d'entraînement : distance ≤ 8 (exporter-seau.js).
async function dhash(octets) {
    const sharp = require('sharp');
    const px = await sharp(octets, { failOn: 'error', limitInputPixels: 50e6 }).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
    if (px.length !== 72) throw Object.assign(new Error('dhash'), { code: 'DHASH' });
    let bits = '';
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) bits += px[r * 9 + c] < px[r * 9 + c + 1] ? '1' : '0';
    return BigInt('0b' + bits).toString(16).padStart(16, '0');
}
const FORME = /^[0-9a-f]{16}$/;
/** La distance de Hamming entre deux dHash (16 hexadécimaux). */
function distance(a, b) {
    if (!FORME.test(String(a)) || !FORME.test(String(b))) throw Object.assign(new Error('dhash illisible'), { code: 'DHASH' });
    let x = BigInt('0x' + a) ^ BigInt('0x' + b), n = 0;
    while (x) { n += Number(x & 1n); x >>= 1n; }
    return n;
}
module.exports = { dhash, distance, FORME, SEUIL_RE_PHOTO: 8 };
