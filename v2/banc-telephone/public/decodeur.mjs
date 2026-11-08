// DECODEUR RAT-MARKET — octets d'une image (JPEG, PNG, WebP) -> RGB 8 bits, par NOTRE code, sans canvas, sans profil couleur, sans rien qui dépende du navigateur ni de l'appareil.
// Objectif de l'éditeur : l'entrée du modèle est IDENTIQUE AU BIT sur iPhone, Android et ordinateur. Tout est entier (32 bits) ; le résultat est celui de Pillow (libjpeg-turbo, libwebp, zlib).
//
// CONTRAT
//   decoder(octets, { orientation = 'exif', coteMax = 4096, pixelsMax = 12000000 })
//     -> { rgb: Uint8Array (largeur * hauteur * 3, RGBRGB…), largeur, hauteur, format, orientationLue, orientationAppliquee, source }
//   · les BORNES (format admis, côté, pixels) sont vérifiées dans l'en-tête AVANT tout décodage, comme calcul/entete.js de l'extension ;
//   · l'ORIENTATION EXIF (1 à 8) est appliquée par défaut (c'est ce que fait createImageBitmap par défaut dans Chrome et Safari : la photo d'un téléphone arrive droite) ;
//     { orientation: 'aucune' } rend les pixels tels que décodés (c'est ce que fait Pillow sans exif_transpose : les références du lot) ;
//   · AUCUNE gestion de couleur : le profil ICC est ignoré (équivaut à colorSpaceConversion: 'none') ; le canal alpha est ignoré (équivaut à Pillow convert('RGB')) ;
//   · toute erreur est une ErreurDecodeur à CODE fermé : FORMAT, TROP_GRAND, DECODAGE, NON_SUPPORTE. Jamais un résultat approché.
//   reduire640(rgb, largeur, hauteur) -> { rgb, largeur, hauteur } : la réduction « inside » dans un carré de 640 (dimensions640), bilinéaire à support élargi de Pillow, en entiers.
import { decoderJpeg, ErreurDecodeur } from './decodeur-jpeg.mjs';
import { decoderPng } from './decodeur-png.mjs';
import { decoderWebp, orientationWebp } from './decodeur-webp.mjs';
export { ErreurDecodeur };

export const VERSION_DECODEUR = 'rm-decodeur-1';
export const COTE_MAX = 4096;
export const PIXELS_MAX = 12000000;
export const TAILLE_REDUCTION = 640;

const u16be = (b, i) => (b[i] << 8) | b[i + 1];
const u32be = (b, i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u16le = (b, i) => b[i] | (b[i + 1] << 8);
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b, i, s) => { for (let k = 0; k < s.length; k++) if (b[i + k] !== s.charCodeAt(k)) return false; return true; };
const illisible = () => new ErreurDecodeur('FORMAT', 'en-tête illisible ou format non admis');

function dimJpeg(b) {
    let i = 2;
    while (i + 4 <= b.length) {
        if (b[i] !== 0xff) throw illisible();
        while (b[i] === 0xff && i < b.length) i++;
        const m = b[i++];
        if (m === 0x01 || (m >= 0xd0 && m <= 0xd8)) continue;
        if (m === 0xd9 || m === 0xda) throw illisible();
        if (i + 2 > b.length) throw illisible();
        const longueur = u16be(b, i);
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
            if (longueur < 8 || i + 7 > b.length) throw illisible();
            return { format: 'jpeg', largeur: u16be(b, i + 5), hauteur: u16be(b, i + 3) };
        }
        if (longueur < 2) throw illisible();
        i += longueur;
    }
    throw illisible();
}
function dimPng(b) { if (b.length < 24 || !ascii(b, 12, 'IHDR')) throw illisible(); return { format: 'png', largeur: u32be(b, 16), hauteur: u32be(b, 20) }; }
function dimWebp(b) {
    if (b.length < 30) throw illisible();
    const type = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (type === 'VP8 ') { if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) throw illisible(); return { format: 'webp', largeur: u16le(b, 26) & 0x3fff, hauteur: u16le(b, 28) & 0x3fff }; }
    if (type === 'VP8L') { if (b[20] !== 0x2f) throw illisible(); const bits = (b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24)) >>> 0; return { format: 'webp', largeur: (bits & 0x3fff) + 1, hauteur: ((bits >>> 14) & 0x3fff) + 1 }; }
    if (type === 'VP8X') return { format: 'webp', largeur: u24le(b, 24) + 1, hauteur: u24le(b, 27) + 1 };
    throw illisible();
}
/** { format, largeur, hauteur } lus dans l'en-tête seul (copie de calcul/entete.js de l'extension, erreurs à code du décodeur). */
export function lireDimensions(octets) {
    const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
    if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return dimJpeg(b);
    if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG\r\n') && b[6] === 0x1a && b[7] === 0x0a) return dimPng(b);
    if (b.length >= 12 && ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return dimWebp(b);
    throw illisible();
}
export function verifierDimensions(octets, { coteMax = COTE_MAX, pixelsMax = PIXELS_MAX } = {}) {
    const d = lireDimensions(octets);
    if (!(d.largeur >= 1 && d.hauteur >= 1)) throw new ErreurDecodeur('DECODAGE', 'dimension nulle');
    if (d.largeur > coteMax || d.hauteur > coteMax || d.largeur * d.hauteur > pixelsMax) throw new ErreurDecodeur('TROP_GRAND', `${d.largeur} x ${d.hauteur}`);
    return d;
}

/** L'orientation EXIF (1 à 8), comme Pillow ImageOps.exif_transpose : 2 miroir, 3 demi-tour, 4 miroir vertical, 5 transposition, 6 / 8 quarts de tour, 7 transversale. */
export function appliquerOrientation(rgb, w, h, o) {
    if (!(o >= 2 && o <= 8)) return { rgb, largeur: w, hauteur: h };
    const echange = o >= 5, ow = echange ? h : w, oh = echange ? w : h;
    const sortie = new Uint8Array(ow * oh * 3);
    for (let oy = 0; oy < oh; oy++) {
        for (let ox = 0; ox < ow; ox++) {
            let x, y;
            switch (o) {
                case 2: x = w - 1 - ox; y = oy; break;
                case 3: x = w - 1 - ox; y = h - 1 - oy; break;
                case 4: x = ox; y = h - 1 - oy; break;
                case 5: x = oy; y = ox; break;
                case 6: x = oy; y = h - 1 - ox; break;
                case 7: x = w - 1 - oy; y = h - 1 - ox; break;
                default: x = w - 1 - oy; y = ox; break;     // 8
            }
            const s = (y * w + x) * 3, d = (oy * ow + ox) * 3;
            sortie[d] = rgb[s]; sortie[d + 1] = rgb[s + 1]; sortie[d + 2] = rgb[s + 2];
        }
    }
    return { rgb: sortie, largeur: ow, hauteur: oh };
}

/** octets -> RGB. Voir le contrat en tête de fichier. */
export function decoder(octets, { orientation = 'exif', orientationWebp: orientationWebpAppliquee = false, coteMax = COTE_MAX, pixelsMax = PIXELS_MAX } = {}) {
    const b = octets instanceof Uint8Array ? octets : new Uint8Array(octets);
    if (orientation !== 'exif' && orientation !== 'aucune') throw new ErreurDecodeur('FORMAT', 'option orientation inconnue');
    const d = verifierDimensions(b, { coteMax, pixelsMax });                  // les bornes AVANT tout décodage
    let r;
    if (d.format === 'jpeg') r = decoderJpeg(b, { coteMax, pixelsMax });
    else if (d.format === 'png') r = decoderPng(b, { coteMax, pixelsMax });
    else r = decoderWebp(b, { coteMax, pixelsMax });
    if (r.largeur !== d.largeur || r.hauteur !== d.hauteur) throw new ErreurDecodeur('DECODAGE', 'dimensions différentes de l\'en-tête');
    const lue = d.format === 'jpeg' ? r.orientationLue : d.format === 'webp' ? orientationWebp(b) : 0;
    // Mesuré dans Chrome 157 (outils/decodeur/pilote-decodeur.js) : createImageBitmap applique l'EXIF d'un JPEG (les 8 orientations), PAS celui d'un WebP. Le défaut reproduit cette chaîne ; { orientationWebp: true } l'applique aussi.
    const appliquee = orientation === 'exif' && (d.format === 'jpeg' || (d.format === 'webp' && orientationWebpAppliquee)) ? lue : 0;
    const o = appliquerOrientation(r.rgb, r.largeur, r.hauteur, appliquee);
    return { rgb: o.rgb, largeur: o.largeur, hauteur: o.hauteur, format: d.format, orientationLue: lue, orientationAppliquee: appliquee >= 2 ? appliquee : 1, source: VERSION_DECODEUR };
}

// ── la réduction : Image.resize(BILINEAR) de Pillow (Resample.c : precompute_coeffs, normalize_coeffs_8bpc, passe horizontale puis verticale), trois canaux entrelacés
const PRECISION_BITS = 32 - 8 - 2;
function coefficients(inSize, outSize) {
    const scale = inSize / outSize, filterscale = Math.max(1, scale), support = 1.0 * filterscale;
    const ksize = Math.ceil(support) * 2 + 1;
    const bornes = new Int32Array(outSize * 2), kk = new Int32Array(outSize * ksize);
    const bil = x => { x = Math.abs(x); return x < 1 ? 1 - x : 0; };
    for (let xx = 0; xx < outSize; xx++) {
        const center = (xx + 0.5) * scale, ss = 1 / filterscale;
        let xmin = Math.trunc(center - support + 0.5); if (xmin < 0) xmin = 0;
        let xmax = Math.trunc(center + support + 0.5); if (xmax > inSize) xmax = inSize; xmax -= xmin;
        const k = new Float64Array(ksize); let ww = 0;
        for (let x = 0; x < xmax; x++) { const w = bil((x + xmin - center + 0.5) * ss); k[x] = w; ww += w; }
        for (let x = 0; x < xmax; x++) if (ww !== 0) k[x] /= ww;
        for (let x = 0; x < ksize; x++) { const v = k[x] * (1 << PRECISION_BITS); kk[xx * ksize + x] = v < 0 ? Math.trunc(-0.5 + v) : Math.trunc(0.5 + v); }
        bornes[xx * 2] = xmin; bornes[xx * 2 + 1] = xmax;
    }
    return { ksize, bornes, kk };
}
const clip8 = v => { const x = v >> PRECISION_BITS; return x < 0 ? 0 : x > 255 ? 255 : x; };

/** Image.resize((ow, oh), BILINEAR) de Pillow sur du RGB entrelacé. */
export function redimRgb(src, w, h, ow, oh) {
    const cv = coefficients(h, oh), ch = coefficients(w, ow);
    const besoinH = ow !== w, besoinV = oh !== h;
    let tmp = src, tw = w, th = h, ypremier = 0;
    const bv = Int32Array.from(cv.bornes);
    if (besoinH) {
        ypremier = besoinV ? bv[0] : 0;
        const ydernier = besoinV ? bv[(oh - 1) * 2] + bv[(oh - 1) * 2 + 1] : h;
        if (besoinV) for (let i = 0; i < oh; i++) bv[i * 2] -= ypremier;
        th = ydernier - ypremier; tw = ow;
        tmp = new Uint8Array(tw * th * 3);
        for (let y = 0; y < th; y++) {
            const ligne = (y + ypremier) * w * 3;
            for (let xx = 0; xx < ow; xx++) {
                const xmin = ch.bornes[xx * 2], xmax = ch.bornes[xx * 2 + 1], k = xx * ch.ksize, o = (y * tw + xx) * 3;
                for (let c = 0; c < 3; c++) {
                    let ss = 1 << (PRECISION_BITS - 1);
                    for (let x = 0; x < xmax; x++) ss += src[ligne + (x + xmin) * 3 + c] * ch.kk[k + x];
                    tmp[o + c] = clip8(ss);
                }
            }
        }
    }
    if (!besoinV) return tmp;
    const out = new Uint8Array(ow * oh * 3);
    for (let yy = 0; yy < oh; yy++) {
        const ymin = bv[yy * 2], ymax = bv[yy * 2 + 1], k = yy * cv.ksize;
        for (let xx = 0; xx < ow; xx++) for (let c = 0; c < 3; c++) {
            let ss = 1 << (PRECISION_BITS - 1);
            for (let y = 0; y < ymax; y++) ss += tmp[((y + ymin) * tw + xx) * 3 + c] * cv.kk[k + y];
            out[(yy * ow + xx) * 3 + c] = clip8(ss);
        }
    }
    return out;
}
/** La photo réduite « inside » dans un carré de 640 : { W, H } (même formule que calcul/pur.js : dimensions640). */
export function dimensions640(largeur, hauteur) {
    const k = Math.min(TAILLE_REDUCTION / largeur, TAILLE_REDUCTION / hauteur);
    return { W: Math.round(largeur * k), H: Math.round(hauteur * k) };
}
/** La réduction déterministe de l'entrée de la détection (remplace le canvas imageSmoothingQuality = 'high'). */
export function reduire640(rgb, largeur, hauteur) {
    const { W, H } = dimensions640(largeur, hauteur);
    if (W === largeur && H === hauteur) return { rgb: Uint8Array.from(rgb), largeur: W, hauteur: H };
    return { rgb: redimRgb(rgb, largeur, hauteur, W, H), largeur: W, hauteur: H };
}
