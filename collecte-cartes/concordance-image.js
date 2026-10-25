'use strict';
// ============================================================
// CONCORDANCE PAR L'IMAGE — « règle du 0 faux par l'image » (testeur, 2026-10-25)
// ============================================================
// Un visuel n'entre au catalogue que si DEUX sources indépendantes concordent À L'IMAGE (ou si une source concorde avec un vrai scan déjà conforme).
// Ce module est PUR : entrées = Buffers d'images, aucun réseau, aucune base. Il rend un verdict à trois états :
//   true  = concordent ; false = ne concordent pas ; null = « je ne sais pas » (illisible, trop petit…) — jamais « oui ».
// LIMITE ASSUMÉE : même illustration, tirage différent — l'image ne PEUT PAS trancher (voir calibrer-concordance.js, classe « meme-dessin-autre-tirage »).
//
// pHash : REPRODUCTION de l'algorithme de la bibliothèque Python imagededup (PHash) — imagededup n'est pas installable ici (Python 3.14, dépendance torch) :
// niveaux de gris, 32x32, DCT 2D (non normalisée, comme scipy.fftpack.dct), bloc 8x8 en haut à gauche, comparaison à la médiane des 64 coefficients, 64 bits, 16 caractères hexa.
const sharp = require('sharp');
const D = require('../departage-image');   // decrire / inliers : réutilisés tels quels (libération des objets OpenCV incluse), RIEN n'en est recopié

// ── SEUILS : viennent de la calibration (calibrer-concordance.js), jamais d'une supposition. ──
// SOURCE : calibrer-concordance.js, 2026-10-25, graine 20261025, base `cartes` (lecture) + R2 de nos visuels : 81 174 visuels images/etat ok, 18 460 clés (carte, set, numéro) à deux sources ou plus.
// Paires inter-sources : 300 positifs, 300 négatifs ordinaires (0 faux), 300 négatifs durs « autre illustration » (0 faux), 300 « même illustrateur, autre tirage » (40 acceptés : limite de l'instrument, voir ci-dessous).
// Retenu : ni pHash seul ni ORB seul n'atteignent 0 faux sans perdre davantage ; les deux ensemble, au plus strict sans faux : 131 vrais acceptés sur 300, 169 perdus (dont une part de faux positifs d'étiquette : scan japonais rangé sous un set occidental).
// ⚠️ « Même dessin, autre tirage » (réimpression, version japonaise du même dessin) : l'image NE PEUT PAS trancher — 40/300 de ces paires concordent même à ce seuil. Une concordance d'image prouve le dessin, jamais le tirage.
const SEUILS = {
    calibre: true, source: 'calibrer-concordance.js 2026-10-25 : 300 positifs / 300 ordinaires / 300 durs-illustration / 300 meme-dessin',
    phashMax: 2,        // distance de Hamming maximale
    inliersMin: 40,     // points d'appui ORB minimaux
    exiger: 'les-deux'  // 'les-deux' | 'phash' | 'orb' : un seul critère ne suffit que si la calibration montre 0 faux (elle ne le montre pas)
};
const TAILLE_MIN = 16;  // pixels : en dessous, ni pHash ni ORB ne disent rien

function dct1d(v) {
    const n = v.length, out = new Array(n);
    for (let k = 0; k < n; k++) { let s = 0; for (let i = 0; i < n; i++) s += v[i] * Math.cos(Math.PI * k * (2 * i + 1) / (2 * n)); out[k] = 2 * s; }
    return out;
}
async function phash(buf) {
    const { data } = await sharp(buf).greyscale().resize(32, 32, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    const lignes = []; for (let y = 0; y < 32; y++) lignes.push(Array.from(data.subarray(y * 32, y * 32 + 32)));
    const l1 = lignes.map(dct1d);                                   // DCT sur chaque ligne
    const d = Array.from({ length: 32 }, () => new Array(32));
    for (let x = 0; x < 32; x++) { const col = dct1d(l1.map(r => r[x])); for (let y = 0; y < 32; y++) d[y][x] = col[y]; }   // puis sur chaque colonne
    const bloc = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bloc.push(d[y][x]);
    const tri = [...bloc].sort((a, b) => a - b), med = (tri[31] + tri[32]) / 2;
    let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bloc.slice(i, i + 4).map(c => (c > med ? 1 : 0)).join(''), 2).toString(16);
    return hex;
}
function distanceHamming(h1, h2) {
    if (typeof h1 !== 'string' || typeof h2 !== 'string' || h1.length !== h2.length) throw new Error('distanceHamming : deux hachages de même longueur attendus');
    let n = 0;
    for (let i = 0; i < h1.length; i++) { let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16); while (x) { n += x & 1; x >>= 1; } }
    return n;
}
async function orbInliers(bufA, bufB) {
    const { cv } = await D.outils();
    const a = await D.decrire(bufA), b = await D.decrire(bufB);
    return D.inliers(cv, a, b);
}
async function lisible(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return false;
    try { const m = await sharp(buf).metadata(); return Boolean(m.width && m.height && m.width >= TAILLE_MIN && m.height >= TAILLE_MIN); } catch { return false; }
}
/** @returns {Promise<{concorde: true|false|null, phash: number|null, inliers: number|null, raison: string}>} */
async function concordent(a, b, seuils = {}) {
    const S = { ...SEUILS, ...seuils };
    if (!(await lisible(a)) || !(await lisible(b))) return { concorde: null, phash: null, inliers: null, raison: 'image illisible ou trop petite : je ne sais pas' };
    let ph, inl;
    try { ph = distanceHamming(await phash(a), await phash(b)); inl = await orbInliers(a, b); }
    catch (e) { return { concorde: null, phash: null, inliers: null, raison: `calcul impossible (${e.message}) : je ne sais pas` }; }
    const okPh = ph <= S.phashMax, okOrb = inl >= S.inliersMin;
    const accepte = S.exiger === 'phash' ? okPh : S.exiger === 'orb' ? okOrb : (okPh && okOrb);
    return { concorde: accepte, phash: ph, inliers: inl, raison: `pHash ${ph} (max ${S.phashMax}) ${okPh ? 'ok' : 'non'} ; ORB ${inl} (min ${S.inliersMin}) ${okOrb ? 'ok' : 'non'} ; exigé : ${S.exiger}` };
}

module.exports = { phash, distanceHamming, orbInliers, concordent, SEUILS, TAILLE_MIN };
