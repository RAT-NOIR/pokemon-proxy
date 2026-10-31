// ============================================================
// MÊME ILLUSTRATION DE BASE ? (module PUR sur des octets d'image, sharp seulement) — la preuve à l'image de la décision de l'éditeur du 2026-10-31 (Gem Pack)
// ============================================================
// Les sept cartes d'un groupe Gem Pack montrent la MÊME illustration en six finitions (rangs 1 à 6) ; la septième (illustration rare) en a une AUTRE. On le PROUVE à l'image, on ne le suppose pas :
// la fenêtre d'illustration (bandeau haut de la carte, hors cadre, hors texte) est réduite en niveaux de gris, floutée, normalisée ; la corrélation de deux fenêtres mesure l'identité du dessin,
// que les finitions holo (étoiles, motifs) atténuent sans la détruire. Une corrélation n'est jamais lue seule : `separer` exige un VIDE entre les paires « même dessin » et les paires « autre dessin ».
const sharp = require('sharp');

const L = 64, H = 40;                        // la fenêtre réduite
/** Le vecteur normalisé (moyenne 0, norme 1) de la fenêtre d'illustration d'une carte (octets). La fenêtre : x 8 %–92 %, y 8 %–46 % de la carte entière. */
async function empreinteIllustration(octets) {
    const meta = await sharp(octets).metadata();
    const x = Math.round(meta.width * 0.08), y = Math.round(meta.height * 0.08), w = Math.round(meta.width * 0.84), h = Math.round(meta.height * 0.38);
    const { data } = await sharp(octets).extract({ left: x, top: y, width: w, height: h }).greyscale().blur(1.2).resize(L, H, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    const v = Float64Array.from(data), m = v.reduce((a, b) => a + b, 0) / v.length;
    let n = 0; for (let i = 0; i < v.length; i++) { v[i] -= m; n += v[i] * v[i]; }
    n = Math.sqrt(n) || 1; for (let i = 0; i < v.length; i++) v[i] /= n;
    return v;
}
/** Corrélation de deux empreintes (−1 à 1). */
function correlation(a, b) { if (a.length !== b.length) throw new Error('empreintes de tailles différentes'); let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
/**
 * Sépare deux populations de corrélations : `memes` (paires qui doivent montrer le même dessin) et `autres` (paires qui doivent en montrer un autre). Il doit exister un VIDE entre elles (min des memes > max des autres)
 * — sinon la mesure ne sépare pas et RIEN n'est prouvé. Le seuil est le milieu du vide, écrit avec ses deux bornes.
 * @returns {{separe: boolean, seuil: number|null, minMemes: number, maxAutres: number, vide: number}}
 */
function separer(memes, autres) {
    if (!memes.length || !autres.length) return { separe: false, seuil: null, minMemes: memes.length ? Math.min(...memes) : NaN, maxAutres: autres.length ? Math.max(...autres) : NaN, vide: NaN };
    const minMemes = Math.min(...memes), maxAutres = Math.max(...autres);
    return { separe: minMemes > maxAutres, seuil: minMemes > maxAutres ? (minMemes + maxAutres) / 2 : null, minMemes, maxAutres, vide: minMemes - maxAutres };
}
module.exports = { empreinteIllustration, correlation, separer };
