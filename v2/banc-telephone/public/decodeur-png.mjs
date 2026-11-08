// DECODEUR PNG — code Rat-Market, JavaScript pur, entiers seulement. inflate (RFC 1951) écrit ici, filtres PNG (None, Sub, Up, Average, Paeth), entrelacement Adam7.
// Pris : 8 bits par canal, types 0 (gris), 2 (RGB), 3 (palette, 1 à 8 bits), 4 (gris + alpha), 6 (RGBA). Le canal alpha est IGNORÉ (c'est ce que fait Pillow en convert('RGB')) ; gAMA, sRGB, iCCP, tRNS : ignorés.
// CRÉDITS : l'inflate suit l'algorithme de puff.c / inftrees.c de zlib (licence zlib) pour ses refus (codes sur-souscrits ou incomplets, adler32) ; aucun code n'est copié.
// Refusés avec un CODE : 16 bits, gris 1 à 4 bits, CRC faux, flux tronqué, taille déclarée hors bornes (vérifiée AVANT d'allouer).
import { ErreurDecodeur } from './decodeur-jpeg.mjs';

const refuser = (code, detail) => { throw new ErreurDecodeur(code, detail); };
const LONG_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LONG_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const ORDRE_CL = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

/** Table de Huffman canonique de deflate. Refuse, comme zlib (inftrees.c), un jeu de longueurs SUR-SOUSCRIT, et un jeu INCOMPLET sauf le cas d'un seul code de longueur 1 pour les codes de longueur/distance. */
function tableHuffman(longueurs, codesDeLongueurs = false) {
    const compte = new Uint16Array(16), symboles = new Uint16Array(longueurs.length);
    for (const l of longueurs) compte[l]++;
    let total = 0; for (let l = 1; l < 16; l++) total += compte[l];
    compte[0] = 0;
    if (total > 0) {
        let gauche = 1;
        for (let l = 1; l < 16; l++) { gauche = (gauche << 1) - compte[l]; if (gauche < 0) refuser('DECODAGE', 'code de Huffman sur-souscrit'); }
        if (gauche > 0 && (codesDeLongueurs || total !== 1 || compte[1] !== 1)) refuser('DECODAGE', 'code de Huffman incomplet');
    }
    const offs = new Uint16Array(16);
    for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + compte[i - 1];
    for (let s = 0; s < longueurs.length; s++) if (longueurs[s]) symboles[offs[longueurs[s]]++] = s;
    return { compte, symboles };
}
const TABLE_FIXE_L = (() => { const l = new Uint8Array(288); l.fill(8, 0, 144); l.fill(9, 144, 256); l.fill(7, 256, 280); l.fill(8, 280, 288); return tableHuffman(l); })();
const TABLE_FIXE_D = tableHuffman(new Uint8Array(32).fill(5));      // 32 codes de 5 bits, comme zlib ; 30 et 31 sont refusés au décodage

/** Décompresse un flux zlib (en-tête 2 octets + deflate + adler32 ignoré mais présent) ; `attendu` : taille exacte attendue (borne dure). */
export function inflater(src, attendu) {
    if (src.length < 6) refuser('DECODAGE', 'flux zlib trop court');
    if ((src[0] & 15) !== 8 || ((src[0] << 8) | src[1]) % 31 !== 0 || (src[1] & 0x20)) refuser('DECODAGE', 'en-tête zlib invalide');
    const sortie = new Uint8Array(attendu);
    let o = 0, pos = 2, buf = 0, cnt = 0;
    const bits = k => {
        while (cnt < k) { if (pos >= src.length) refuser('DECODAGE', 'flux tronqué'); buf |= src[pos++] << cnt; cnt += 8; }
        const r = buf & ((1 << k) - 1); buf >>>= k; cnt -= k; return r;
    };
    const decoder = t => {
        let code = 0, premier = 0, index = 0;
        for (let l = 1; l < 16; l++) {
            code |= bits(1);
            const c = t.compte[l];
            if (code - c < premier) return t.symboles[index + (code - premier)];
            index += c; premier += c; premier <<= 1; code <<= 1;
        }
        return refuser('DECODAGE', 'code deflate invalide');
    };
    let dernier;
    do {
        dernier = bits(1);
        const type = bits(2);
        if (type === 0) {
            buf = 0; cnt = 0;
            if (pos + 4 > src.length) refuser('DECODAGE', 'flux tronqué');
            const len = src[pos] | (src[pos + 1] << 8), nlen = src[pos + 2] | (src[pos + 3] << 8); pos += 4;
            if ((len ^ 0xffff) !== nlen || pos + len > src.length || o + len > attendu) refuser('DECODAGE', 'bloc stocké invalide');
            sortie.set(src.subarray(pos, pos + len), o); o += len; pos += len;
        } else if (type === 1 || type === 2) {
            let tl = TABLE_FIXE_L, td = TABLE_FIXE_D;
            if (type === 2) {
                const nl = bits(5) + 257, nd = bits(5) + 1, nc = bits(4) + 4;
                if (nl > 286 || nd > 30) refuser('DECODAGE', 'nombre de codes invalide');
                const lc = new Uint8Array(19);
                for (let i = 0; i < nc; i++) lc[ORDRE_CL[i]] = bits(3);
                const tc = tableHuffman(lc, true), lens = new Uint8Array(nl + nd);
                for (let i = 0; i < nl + nd;) {
                    const s = decoder(tc);
                    if (s < 16) lens[i++] = s;
                    else {
                        let rep, v = 0;
                        if (s === 16) { if (i === 0) refuser('DECODAGE', 'répétition sans précédent'); v = lens[i - 1]; rep = 3 + bits(2); }
                        else if (s === 17) rep = 3 + bits(3); else rep = 11 + bits(7);
                        if (i + rep > nl + nd) refuser('DECODAGE', 'répétition hors table');
                        while (rep--) lens[i++] = v;
                    }
                }
                if (lens[256] === 0) refuser('DECODAGE', 'code de fin de bloc absent');
                tl = tableHuffman(lens.subarray(0, nl)); td = tableHuffman(lens.subarray(nl));
            }
            for (;;) {
                const s = decoder(tl);
                if (s < 256) { if (o >= attendu) refuser('DECODAGE', 'plus de données que déclaré'); sortie[o++] = s; }
                else if (s === 256) break;
                else {
                    const k = s - 257; if (k >= 29) refuser('DECODAGE', 'longueur invalide');
                    const len = LONG_BASE[k] + bits(LONG_EXTRA[k]);
                    const d = decoder(td); if (d >= 30) refuser('DECODAGE', 'distance invalide');
                    const dist = DIST_BASE[d] + bits(DIST_EXTRA[d]);
                    if (dist > o || o + len > attendu) refuser('DECODAGE', 'copie hors fenêtre');
                    for (let i = 0; i < len; i++, o++) sortie[o] = sortie[o - dist];
                }
            }
        } else refuser('DECODAGE', 'type de bloc invalide');
    } while (!dernier);
    if (o !== attendu) refuser('DECODAGE', `${o} octets décompressés sur ${attendu}`);
    // somme de contrôle adler32 (zlib la vérifie : un flux altéré dont le CRC de fragment a été recalculé est refusé)
    if (pos + 4 > src.length) refuser('DECODAGE', 'adler32 absent');
    let a = 1, b2 = 0;
    for (let i = 0; i < sortie.length; i++) { a = (a + sortie[i]) % 65521; b2 = (b2 + a) % 65521; }
    if ((((b2 << 16) | a) >>> 0) !== (((src[pos] << 24) | (src[pos + 1] << 16) | (src[pos + 2] << 8) | src[pos + 3]) >>> 0)) refuser('DECODAGE', 'adler32 faux');
    return sortie;
}

const TABLE_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b, a, z) { let c = 0xffffffff; for (let i = a; i < z; i++) c = TABLE_CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
const u32 = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

const PASSES = [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]];   // x0, y0, dx, dy (Adam7)

/** Décode un PNG en RGB. Rend { largeur, hauteur, rgb, orientationLue: 0 } (le PNG n'a pas d'orientation EXIF prise en compte). */
export function decoderPng(b, { coteMax = 4096, pixelsMax = 12000000 } = {}) {
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    if (b.length < 33 || b[0] !== 0x89 || b[1] !== 0x50 || b[2] !== 0x4e || b[3] !== 0x47 || b[4] !== 0x0d || b[5] !== 0x0a || b[6] !== 0x1a || b[7] !== 0x0a) refuser('FORMAT', 'pas un PNG');
    let pos = 8, ihdr = null, palette = null, fin = false;
    const idat = [];
    while (pos + 12 <= b.length && !fin) {
        const len = u32(b, pos);
        if (len > 0x7fffffff || pos + 12 + len > b.length) refuser('DECODAGE', 'fragment tronqué');
        const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
        if (u32(b, pos + 8 + len) !== crc32(b, pos + 4, pos + 8 + len)) refuser('DECODAGE', `CRC faux (${type})`);
        const d = pos + 8;
        if (type === 'IHDR') {
            if (len !== 13) refuser('DECODAGE', 'IHDR invalide');
            const largeur = u32(b, d), hauteur = u32(b, d + 4);
            if (!(largeur >= 1 && hauteur >= 1)) refuser('DECODAGE', 'dimension nulle');
            if (largeur > coteMax || hauteur > coteMax || largeur * hauteur > pixelsMax) refuser('TROP_GRAND', `${largeur} x ${hauteur}`);
            ihdr = { largeur, hauteur, profondeur: b[d + 8], type: b[d + 9], compression: b[d + 10], filtre: b[d + 11], entrelace: b[d + 12] };
            if (ihdr.compression !== 0 || ihdr.filtre !== 0 || ihdr.entrelace > 1) refuser('DECODAGE', 'IHDR invalide');
            const p = ihdr.profondeur, t = ihdr.type;
            if (![0, 2, 3, 4, 6].includes(t)) refuser('DECODAGE', 'type de couleur invalide');
            if (p === 16) refuser('NON_SUPPORTE', 'PNG 16 bits');
            if (t === 3 ? ![1, 2, 4, 8].includes(p) : p !== 8) refuser('NON_SUPPORTE', `PNG type ${t} sur ${p} bits`);
        } else if (type === 'PLTE') { if (len % 3 || len > 768) refuser('DECODAGE', 'PLTE invalide'); palette = b.subarray(d, d + len); }
        else if (type === 'IDAT') idat.push(b.subarray(d, d + len));
        else if (type === 'IEND') fin = true;
        else if (!(b[pos + 4] & 0x20) && type !== 'IHDR') refuser('NON_SUPPORTE', `fragment critique ${type}`);
        pos += 12 + len;
    }
    if (!ihdr || !idat.length || !fin) refuser('DECODAGE', 'PNG incomplet');
    const { largeur: W, hauteur: H, profondeur: prof, type: ct } = ihdr;
    if (ct === 3 && !palette) refuser('DECODAGE', 'palette absente');
    const canaux = ct === 0 ? 1 : ct === 2 ? 3 : ct === 3 ? 1 : ct === 4 ? 2 : 4;
    const bpp = Math.max(1, (canaux * prof) >> 3);          // octets par pixel (filtrage)
    const passes = ihdr.entrelace ? PASSES : [[0, 0, 1, 1]];
    const dims = passes.map(([x0, y0, dx, dy]) => { const pw = Math.floor((W - x0 + dx - 1) / dx), ph = Math.floor((H - y0 + dy - 1) / dy); return { pw: Math.max(0, pw), ph: Math.max(0, ph) }; });
    const lignes = dims.map(({ pw, ph }) => (pw && ph ? { stride: Math.ceil((pw * canaux * prof) / 8), ph } : { stride: 0, ph: 0 }));
    const attendu = lignes.reduce((s, l) => s + l.ph * (l.stride + 1), 0);
    let total = 0; for (const f of idat) total += f.length;
    const z = new Uint8Array(total); { let o = 0; for (const f of idat) { z.set(f, o); o += f.length; } }
    const brut = inflater(z, attendu);
    const rgb = new Uint8Array(W * H * 3);
    let off = 0;
    for (let ip = 0; ip < passes.length; ip++) {
        const [x0, y0, dx, dy] = passes[ip], { stride, ph } = lignes[ip], { pw } = dims[ip];
        if (!ph) continue;
        let prec = new Uint8Array(stride), cour = new Uint8Array(stride);
        for (let y = 0; y < ph; y++) {
            const f = brut[off++]; cour.set(brut.subarray(off, off + stride)); off += stride;
            if (f > 4) refuser('DECODAGE', 'filtre invalide');
            for (let i = 0; i < stride; i++) {
                const a = i >= bpp ? cour[i - bpp] : 0, up = prec[i], c = i >= bpp ? prec[i - bpp] : 0;
                let v = cour[i];
                if (f === 1) v += a; else if (f === 2) v += up; else if (f === 3) v += (a + up) >> 1;
                else if (f === 4) { const p = a + up - c, pa = Math.abs(p - a), pb = Math.abs(p - up), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c; }
                cour[i] = v & 255;
            }
            const py = y0 + y * dy;
            for (let x = 0; x < pw; x++) {
                const o = (py * W + x0 + x * dx) * 3;
                if (ct === 0) { const g = cour[x]; rgb[o] = rgb[o + 1] = rgb[o + 2] = g; }
                else if (ct === 4) { const g = cour[2 * x]; rgb[o] = rgb[o + 1] = rgb[o + 2] = g; }
                else if (ct === 2) { rgb[o] = cour[3 * x]; rgb[o + 1] = cour[3 * x + 1]; rgb[o + 2] = cour[3 * x + 2]; }
                else if (ct === 6) { rgb[o] = cour[4 * x]; rgb[o + 1] = cour[4 * x + 1]; rgb[o + 2] = cour[4 * x + 2]; }
                else {
                    const bitpos = x * prof, idx = (cour[bitpos >> 3] >> (8 - prof - (bitpos & 7))) & ((1 << prof) - 1);
                    if (idx * 3 + 2 >= palette.length) refuser('DECODAGE', 'indice hors palette');
                    rgb[o] = palette[idx * 3]; rgb[o + 1] = palette[idx * 3 + 1]; rgb[o + 2] = palette[idx * 3 + 2];
                }
            }
            const t = prec; prec = cour; cour = t;
        }
    }
    return { largeur: W, hauteur: H, rgb, orientationLue: 0 };
}
