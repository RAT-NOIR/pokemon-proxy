'use strict';
// GALERIE — la validation et la recompression d'une image déposée. Écrit par ce qu'il AUTORISE :
//   · le TYPE se lit à la SIGNATURE D'OCTETS (JPEG, PNG, WebP) : le Content-Type déclaré ne fait jamais foi, un SVG (texte) n'a aucune de ces signatures et est refusé comme tout ce qui n'en a pas ;
//   · une image ANIMÉE est refusée (PNG animé : bloc acTL ; WebP animé : drapeau d'animation de VP8X ou bloc ANIM) ;
//   · les dimensions se lisent dans l'EN-TÊTE, avant tout décodage (sharp.metadata ne décode pas) : au-delà de `pixelsMax` le décodage n'a jamais lieu ; le décodeur reçoit en plus `limitInputPixels` ;
//   · la sortie est TOUJOURS une recompression : orientation EXIF appliquée, WebP (2 000 px au plus sur le grand côté, qualité 82), vignette 480 px, AUCUNE métadonnée, couleur dominante.
// Les refus sont des FICHIER avec leur `detail` (trop-lourde 413, format 415, trop-de-pixels 422, illisible 422, animee 422). Une seule recompression à la fois par instance (le décodage coûte de la mémoire).
const sharp = require('sharp');

class RefusFichier extends Error { constructor(detail, statut) { super(detail); this.name = 'RefusFichier'; this.detail = detail; this.statut = statut; } }
const refus = (detail) => new RefusFichier(detail, { 'trop-lourde': 413, format: 415 }[detail] || 422);
const TYPES = Object.freeze({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' });
const COTE_MAX = 2000, VIGNETTE = 480, QUALITE = 82;

/** 'jpeg' | 'png' | 'webp' | null — par les OCTETS seulement. */
function formatParSignature(b) {
    if (!Buffer.isBuffer(b) || b.length < 12) return null;
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
    if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
    return null;
}
/** PNG animé : un bloc acTL avant les données d'image. WebP animé : drapeau animation (bit 0x02) de VP8X, ou un bloc ANIM / ANMF. JPEG : jamais animé. */
function estAnime(b, format) {
    if (format === 'png') {
        let o = 8;
        while (o + 8 <= b.length) {
            const longueur = b.readUInt32BE(o), type = b.subarray(o + 4, o + 8).toString('latin1');
            if (type === 'acTL') return true;
            if (type === 'IDAT' || type === 'IEND') return false;
            o += 12 + longueur;
        }
        return false;
    }
    if (format === 'webp') {
        let o = 12;
        while (o + 8 <= b.length) {
            const type = b.subarray(o, o + 4).toString('latin1'), longueur = b.readUInt32LE(o + 4);
            if (type === 'VP8X' && o + 9 <= b.length && (b[o + 8] & 0x02)) return true;
            if (type === 'ANIM' || type === 'ANMF') return true;
            o += 8 + longueur + (longueur % 2);
        }
        return false;
    }
    return false;
}

let enCours = 0;
/** Une recompression à la fois par instance : au-delà, `occupe` (la route répond INDISPONIBLE + reessayerDans). */
async function sousVerrou(travail) {
    if (enCours >= 1) return { occupe: true };
    enCours++;
    try { return { valeur: await travail() }; } finally { enCours--; }
}

/**
 * Valide et recompresse. `declare` : le type déclaré par le client au temps 1 (comparé à la signature : un désaccord est un refus `format`).
 * @returns {Promise<{ image: Buffer, vignette: Buffer, largeur: number, hauteur: number, couleur: string, format: string }>}
 */
async function traiter(octets, { pixelsMax, octetsMax, declare = null }) {
    if (!Buffer.isBuffer(octets) || octets.length === 0) throw refus('illisible');
    if (octets.length > octetsMax) throw refus('trop-lourde');
    const format = formatParSignature(octets);
    if (!format) throw refus('format');
    if (declare && TYPES[declare] !== format) throw refus('format');
    if (estAnime(octets, format)) throw refus('animee');
    let meta;
    try { meta = await sharp(octets, { limitInputPixels: false }).metadata(); } catch { throw refus('illisible'); }
    if (!meta || !(meta.width > 0) || !(meta.height > 0)) throw refus('illisible');
    if (meta.pages && meta.pages > 1) throw refus('animee');
    if (meta.width * meta.height > pixelsMax) throw refus('trop-de-pixels');
    try {
        const base = () => sharp(octets, { limitInputPixels: pixelsMax, failOn: 'error' }).rotate();          // l'orientation EXIF est APPLIQUÉE, puis l'étiquette tombe avec les métadonnées
        const principale = await base().resize({ width: COTE_MAX, height: COTE_MAX, fit: 'inside', withoutEnlargement: true }).webp({ quality: QUALITE }).toBuffer({ resolveWithObject: true });
        const vignette = await base().resize({ width: VIGNETTE, height: VIGNETTE, fit: 'inside', withoutEnlargement: true }).webp({ quality: QUALITE }).toBuffer();
        const { dominant } = await sharp(vignette).stats();
        const hex = n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
        return { image: principale.data, vignette, largeur: principale.info.width, hauteur: principale.info.height, couleur: `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`, format };
    } catch (e) {
        if (e instanceof RefusFichier) throw e;
        if (/pixel limit/i.test(String(e))) throw refus('trop-de-pixels');
        throw refus('illisible');
    }
}
module.exports = { RefusFichier, TYPES, COTE_MAX, VIGNETTE, formatParSignature, estAnime, traiter, sousVerrou };
