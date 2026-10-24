'use strict';
// ============================================================
// L'EMPREINTE DU CENTRE DE L'ILLUSTRATION — pure, locale, sans réseau (brief S8/AUDIT, mesure 5)
// ============================================================
// 🔑 CE QUI EST RÉUTILISÉ, MESURÉ, PUIS CHOISI (voir le rapport) : la corrélation normalisée sur une petite trame est celle qui TIENT depuis le §69
// (collecte-cartes/index-symboles.js : « le dHash 64 bits est REFUSÉ PAR SON BANC — les aplats ; la corrélation normalisée 32×32 tient »). ORB/RANSAC
// (departage-image.js : 0,69 ms par appariement et une fuite mémoire §15) et SIFT/RANSAC (§74, labo) sont trop lents ou trop lourds pour 70 000 paires en
// moins de 30 minutes ; ils restent la deuxième instance pour les cas que la planche montrera douteux.
//
// 🔑 LA FENÊTRE : on ne compare ni la carte entière (le cadre d'une ère ressemble plus que le dessin, §74), ni les étiquettes incrustées (nom, PV, attaques,
// symboles) : l'empreinte est la trame 40×32 d'une région du CENTRE de la carte (x 12-88 %, y 11-53 %, le bandeau de titre et le pied EXCLUS) ;
// la comparaison porte sur la fenêtre centrale de 30×24 (x 21-79 %, y 16-48 % de la carte : des pixels d'illustration pour toutes les ères, bordure comprise
// hors fenêtre), et cherche le meilleur recalage dans ±5 colonnes / ±4 lignes (un cadrage différent d'un scan à l'autre), dans les DEUX sens (symétrie).
const sharp = require('sharp');

const LARGEUR = 40, HAUTEUR = 32;
const REGION = Object.freeze({ x0: 0.12, x1: 0.88, y0: 0.11, y1: 0.53 });      // en fraction de la carte
const FENETRE = Object.freeze({ c0: 5, c1: 35, r0: 4, r1: 28 });             // colonnes et lignes de la trame centrale comparée
const DECALAGE_MAX = Object.freeze({ dx: 5, dy: 4 });
const TAILLE = LARGEUR * HAUTEUR * 3;
const SEUIL_CONTRASTE = 6;                                                      // écart-type de la luminance (sur 255) sous lequel l'empreinte ne peut rien dire

/** Le rapport hauteur/largeur d'une carte Pokémon (63×88 mm = 1,40) : en deçà ou au-delà, l'image n'est pas une carte (produit scellé, visuel carré…). */
const formatDeCarte = (w, h) => Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && h / w >= 1.25 && h / w <= 1.6;

/** L'empreinte d'une image (Buffer d'octets de fichier). Lève si ce n'est pas une image lisible. @returns {Promise<Buffer>} TAILLE octets RVB. */
async function empreinteDe(octets) { return (await analyser(octets)).empreinte; }

/** Idem, avec les dimensions de l'image d'origine. */
async function analyser(octets) {
    const base = sharp(octets, { failOn: 'error' }).rotate();
    const m = await base.metadata();
    if (!m.width || !m.height) throw new Error('image sans dimensions');
    const rot = m.orientation && m.orientation >= 5 ? { w: m.height, h: m.width } : { w: m.width, h: m.height };
    const left = Math.floor(rot.w * REGION.x0), top = Math.floor(rot.h * REGION.y0);
    const width = Math.max(1, Math.floor(rot.w * (REGION.x1 - REGION.x0))), height = Math.max(1, Math.floor(rot.h * (REGION.y1 - REGION.y0)));
    const brut = await sharp(octets, { failOn: 'error' }).rotate().flatten({ background: '#808080' }).extract({ left, top, width, height })
        .resize(LARGEUR, HAUTEUR, { fit: 'fill' }).removeAlpha().raw().toBuffer();
    if (brut.length !== TAILLE) throw new Error(`empreinte de ${brut.length} octets au lieu de ${TAILLE}`);
    return { empreinte: brut, w: rot.w, h: rot.h };
}

const verifier = e => { if (!Buffer.isBuffer(e) && !(e instanceof Uint8Array)) throw new Error('empreinte : un Buffer est attendu'); if (e.length !== TAILLE) throw new Error(`empreinte de ${e.length} octets au lieu de ${TAILLE}`); };

/** La luminance de la trame (Float32, LARGEUR × HAUTEUR). */
function luminance(e) {
    verifier(e);
    const g = new Float32Array(LARGEUR * HAUTEUR);
    for (let i = 0, j = 0; i < g.length; i++, j += 3) g[i] = 0.299 * e[j] + 0.587 * e[j + 1] + 0.114 * e[j + 2];
    return g;
}
function ecartType(g, zone = FENETRE) {
    let s = 0, s2 = 0, n = 0;
    for (let r = zone.r0; r < zone.r1; r++) for (let c = zone.c0; c < zone.c1; c++) { const v = g[r * LARGEUR + c]; s += v; s2 += v * v; n++; }
    const m = s / n; return Math.sqrt(Math.max(0, s2 / n - m * m));
}
/** Vrai si la fenêtre centrale n'a pas de contraste : un aplat (« image non disponible », fond uni) ne dit rien d'une illustration. */
const sansContraste = e => ecartType(Array.isArray(e) || e instanceof Float32Array ? e : luminance(e)) < SEUIL_CONTRASTE;

/** NCC de la fenêtre centrale de `a` contre la fenêtre de `b` décalée de (dx, dy), pour tous les décalages : le meilleur. */
function meilleurRecalage(a, b) {
    const { c0, c1, r0, r1 } = FENETRE, n = (c1 - c0) * (r1 - r0);
    const va = new Float32Array(n); let ma = 0, k = 0;
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) { va[k] = a[r * LARGEUR + c]; ma += va[k++]; }
    ma /= n; let na = 0; for (let i = 0; i < n; i++) { va[i] -= ma; na += va[i] * va[i]; }
    let meilleur = -2, bdx = 0, bdy = 0;
    for (let dy = -DECALAGE_MAX.dy; dy <= DECALAGE_MAX.dy; dy++) for (let dx = -DECALAGE_MAX.dx; dx <= DECALAGE_MAX.dx; dx++) {
        let sb = 0, sb2 = 0, dot = 0; k = 0;
        for (let r = r0; r < r1; r++) { const base = (r + dy) * LARGEUR + dx; for (let c = c0; c < c1; c++) { const v = b[base + c]; sb += v; sb2 += v * v; dot += va[k++] * v; } }
        const varb = sb2 - (sb * sb) / n; if (varb <= 1e-6 || na <= 1e-6) continue;
        const ncc = dot / Math.sqrt(na * varb);          // va est centré : dot = Σ(a-ma)·b = Σ(a-ma)(b-mb)
        if (ncc > meilleur) { meilleur = ncc; bdx = dx; bdy = dy; }
    }
    return { ncc: meilleur, dx: bdx, dy: bdy };
}

/**
 * La distance entre deux empreintes : 1 − max(NCC, 0), dans [0, 1] — 0 : même illustration ; 1 : aucune corrélation. NaN si l'une des deux ne contraste pas (l'empreinte ne peut pas conclure).
 * Acceptent des Buffer d'empreinte OU des luminances déjà calculées (`luminance`) : le calcul de masse prépare une fois chaque côté.
 * @returns {{ distance: number, ncc: number, dx: number, dy: number }}
 */
function distance(a, b) {
    const ga = a instanceof Float32Array ? a : luminance(a), gb = b instanceof Float32Array ? b : luminance(b);
    if (ecartType(ga) < SEUIL_CONTRASTE || ecartType(gb) < SEUIL_CONTRASTE) return { distance: NaN, ncc: NaN, dx: 0, dy: 0 };
    const x = meilleurRecalage(ga, gb), y = meilleurRecalage(gb, ga);
    const ncc = Math.max(x.ncc, y.ncc);
    return { distance: 1 - Math.max(ncc, 0), ncc, dx: x.ncc >= y.ncc ? x.dx : -y.dx, dy: x.ncc >= y.ncc ? x.dy : -y.dy };
}

/**
 * LA COULEUR, à côté de la distance (jamais à sa place) : la corrélation normalisée ignore le contraste ET la teinte (une même illustration en négatif, ou virée au bleu, corrèle).
 * Moyenne, sur la fenêtre centrale découpée en 6×4 blocs, de l'écart absolu des moyennes RVB, rapporté à 255 : 0 = mêmes teintes ; ~0,3 = teintes très différentes. Pas de recalage.
 */
function couleur(a, b) {
    verifier(a); verifier(b);
    const { c0, c1, r0, r1 } = FENETRE, bw = (c1 - c0) / 6, bh = (r1 - r0) / 4;
    let somme = 0, n = 0;
    for (let by = 0; by < 4; by++) for (let bx = 0; bx < 6; bx++) {
        const ma = [0, 0, 0], mb = [0, 0, 0]; let m = 0;
        for (let r = r0 + by * bh; r < r0 + (by + 1) * bh; r++) for (let c = c0 + bx * bw; c < c0 + (bx + 1) * bw; c++) {
            const i = (r * LARGEUR + c) * 3; m++;
            for (let k = 0; k < 3; k++) { ma[k] += a[i + k]; mb[k] += b[i + k]; }
        }
        for (let k = 0; k < 3; k++) { somme += Math.abs(ma[k] / m - mb[k] / m); n++; }
    }
    return somme / n / 255;
}

module.exports = { empreinteDe, analyser, distance, couleur, luminance, sansContraste, ecartType, formatDeCarte, LARGEUR, HAUTEUR, TAILLE, REGION, FENETRE, DECALAGE_MAX, SEUIL_CONTRASTE };
