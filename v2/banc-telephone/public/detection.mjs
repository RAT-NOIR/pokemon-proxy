// ============================================================
// LA DETECTION DE LA CARTE, INDEPENDANTE DU NAVIGATEUR (rm-detection-1)
// ============================================================
// octets de la photo -> decoder() [decodeur.mjs : JavaScript pur, entiers] -> reduction a 640 [ICI : arithmetique flottante 32 bits emulee a la main, voir plus bas]
// -> quadrilateres() [OpenCV.js injecte : le build REDUIT de l'extension] -> redresser() -> la carte 420 x 587 (RGB).
// AUCUN canvas, AUCUN createImageBitmap, AUCUN getImageData, AUCUN encodeur du navigateur : tout ce qui depend d'un navigateur a ete retire de la route de la detection.
//
// Ce que ce fichier recopie, geste pour geste, de l'extension (`src/calcul/pur.js` et `moteur.js`, lus et jamais modifies) : ordonner, aireQuad, evaluerQuadrilatere, retenirCandidats, quadPourRedressement,
// quadrilateres, redresser. UN SEUL ecart voulu : la distance. L'extension appelle `Math.hypot`, dont l'arrondi n'est PAS fixe par la specification (V8, JavaScriptCore et SpiderMonkey n'ont pas le meme
// algorithme) ; ici `Math.sqrt(dx*dx + dy*dy)` (la racine est correctement arrondie partout). Les decisions comparees sont des seuils (ratio 63/88 a 15 %, quasi-doublon a 3 % de la diagonale) :
// l'ecart d'un ulp ne les change que sur un cas exactement au seuil ; la transition le mesure (RAPPORT-DETECTION-DETERMINISTE.md).
//
// LA REDUCTION A 640 : la chaine servie aujourd'hui reduit par un canvas `imageSmoothingQuality = 'high'`, donc par Skia (Chrome), CoreGraphics (Safari) : des pixels qui dependent du navigateur, et la
// detection (Canny + contours) deplace le quadrilatere pour un seul niveau de gris de difference. MESURE dans Chrome 157 (outils/detection/emuler-canvas*.py) : pour un facteur de reduction dans [1 ; racine de 2[
// le canvas « high » est un echantillonnage BILINEAIRE du niveau 0, sans antialiasing, evalue en flottants 32 bits par la file de rasterisation de Skia (poids wx*wy, accumulation par multiplication-addition
// FUSIONNEE dans l'ordre (0,0) (1,0) (0,1) (1,1), arrondi final au plus proche PAIR). `reduireCanvasHigh` reproduit EXACTEMENT cette arithmetique (Math.fround pour chaque operation flottante 32 bits,
// fma32 exact pour la multiplication-addition fusionnee) : les octets sortent identiques a ceux de Chrome, et IDENTIQUES d'un moteur JavaScript a l'autre puisque chaque operation est un +, -, *, / IEEE.
// Hors de ce domaine (facteur >= racine de 2, ou agrandissement), `reduire640` du decodeur (bilineaire de Pillow en entiers) prend le relais ET LE DIT (`voie: 'pillow'`).
import { decoder, dimensions640, reduire640, redimRgb, ErreurDecodeur } from './decodeur.mjs';
export { ErreurDecodeur, dimensions640 };

export const VERSION_DETECTION = 'rm-detection-2';   // 2 : la pre-reduction a 800 px des photos plus grandes (grandes photos de telephone)
export const RATIO = 63 / 88, L_RED = 420, H_RED = 587;

// ------------------------------------------------------------
// Arithmetique flottante 32 bits, a la main
// ------------------------------------------------------------
const f32 = Math.fround;
const INV255 = f32(1 / 255);
const LUT = new Float32Array(256); for (let s = 0; s < 256; s++) LUT[s] = f32(s * INV255);
const TAMPON = new Float64Array(1), BAS = new Uint32Array(TAMPON.buffer);
// Les cibles (x86-64, ARM64) sont petit-boutistes : le mot BAS d'un double est a l'indice 0. Verifie au chargement plutot que suppose.
TAMPON[0] = 1; if (BAS[0] !== 0) throw new Error('detection : plateforme gros-boutiste non prevue');

/** fma(a, b, c) en float32, EXACTEMENT (un seul arrondi). a, b, c : float32 deja arrondis. a*b est exact en double (24 + 24 bits) ; l'unique piege est le double arrondi quand la somme double tombe pile au milieu de deux float32. */
export function fma32(a, b, c) {
  const p = a * b, s = p + c;
  TAMPON[0] = s;
  if ((BAS[0] & 0x1fffffff) !== 0x10000000) return f32(s);
  // la somme double est au milieu exact de deux float32 : on cherche de quel cote est la vraie somme (erreur de TwoSum, exacte)
  const bb = s - p, err = (p - (s - bb)) + (c - bb);
  if (err === 0) return f32(s);                       // vrai milieu : fround arrondit au pair, comme le materiel
  if ((err > 0) === (s > 0)) BAS[0] += 1; else BAS[0] -= 1;   // un cran de double vers l'erreur : fround arrondit alors du bon cote
  return f32(TAMPON[0]);
}
/** Arrondi au plus proche, PAIR a egalite (celui de l'instruction vectorielle de Skia) ; v : un float32 >= 0. */
function pair(v) {
  const f = Math.floor(v), d = v - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1);
}

/** Coordonnees d'echantillonnage d'un axe : indices gauche/droite (bornes) et poids de droite (float32), comme la matrice inverse de Skia (echelle = 1 / float32(dst / src)). */
function axe(src, dst) {
  const inv = f32(1 / f32(dst / src));
  const i0 = new Int32Array(dst), i1 = new Int32Array(dst), fx = new Float32Array(dst);
  for (let d = 0; d < dst; d++) {
    const cx = f32(f32(d + 0.5) * inv);
    const t = f32(cx + 0.5);
    fx[d] = f32(t - Math.floor(t));
    const g = Math.floor(f32(cx - 0.5));
    i0[d] = g < 0 ? 0 : g > src - 1 ? src - 1 : g;
    i1[d] = g + 1 < 0 ? 0 : g + 1 > src - 1 ? src - 1 : g + 1;
  }
  return { i0, i1, fx };
}

/** Le facteur de reduction (largeur ou hauteur) est-il dans le domaine mesure : [1 ; racine de 2[ sur les deux axes ? */
export function dansLeDomaineCanvas(w, h, W, H) { return W <= w && H <= h && w < W * Math.SQRT2 && h < H * Math.SQRT2; }

/** La reduction du canvas Chrome « high » (voir l'en-tete) : rgb w*h*3 -> { rgb, largeur, hauteur, voie } ; `null` hors du domaine mesure. */
export function reduireCanvasHigh(rgb, w, h) {
  const { W, H } = dimensions640(w, h);
  if (!dansLeDomaineCanvas(w, h, W, H)) return null;
  return { rgb: bilineaire32(rgb, w, h, W, H), largeur: W, hauteur: H, voie: 'canvas-high' };
}
/** Le coeur : echantillonnage bilineaire 32 bits de w x h vers W x H (W <= w, H <= h), octets RGB. Exporte pour les bancs (cibles de tailles quelconques). */
export function bilineaire32(rgb, w, h, W, H) {
  const X = axe(w, W), Y = axe(h, H), out = new Uint8Array(W * H * 3);
  const cx0 = new Int32Array(W), cx1 = new Int32Array(W);
  for (let x = 0; x < W; x++) { cx0[x] = X.i0[x] * 3; cx1[x] = X.i1[x] * 3; }
  const wx0 = new Float32Array(W), wx1 = X.fx;
  for (let x = 0; x < W; x++) wx0[x] = f32(1 - wx1[x]);
  for (let y = 0; y < H; y++) {
    const l0 = Y.i0[y] * w * 3, l1 = Y.i1[y] * w * 3, wy1 = Y.fx[y], wy0 = f32(1 - wy1);
    for (let x = 0; x < W; x++) {
      const w00 = f32(wx0[x] * wy0), w10 = f32(wx1[x] * wy0), w01 = f32(wx0[x] * wy1), w11 = f32(wx1[x] * wy1);
      const a = l0 + cx0[x], b = l0 + cx1[x], c = l1 + cx0[x], d = l1 + cx1[x], o = (y * W + x) * 3;
      for (let k = 0; k < 3; k++) {
        let acc = f32(w00 * LUT[rgb[a + k]]);
        acc = fma32(w10, LUT[rgb[b + k]], acc);
        acc = fma32(w01, LUT[rgb[c + k]], acc);
        acc = fma32(w11, LUT[rgb[d + k]], acc);
        const v = pair(f32(acc * 255));
        out[o + k] = v < 0 ? 0 : v > 255 ? 255 : v;
      }
    }
  }
  return out;
}
/** Une source synthetique reproductible (graine -> octets RGB w*h*3) : plages lisses + bruit, donc beaucoup d'egalites d'arrondi. Pour les bancs : le meme code engendre l'image dans Chrome et dans node. */
export function sourceSynthetique(graine, w, h) {
  let s = graine >>> 0;
  const alea = () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = new Uint8Array(w * h * 3), a = alea() * 255, b = alea() * 255;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let k = 0; k < 3; k++) {
    const base = (a * x / w + b * y / h + k * 60) % 256, bruit = alea() < 0.5 ? 0 : Math.floor(alea() * 12) - 6;
    out[(y * w + x) * 3 + k] = Math.max(0, Math.min(255, Math.floor(base) + bruit));
  }
  return out;
}

/** Le grand cote vers lequel les photos plus grandes sont ramenees avant la reduction a 640 : 800 px, la taille des photos mesurees (facteur 1,25 ensuite). */
export const COTE_PRE = 800;
export const PIXELS_MAX_PHOTO = 16000000, COTE_MAX_PHOTO = 4608;
/** Les options passees au decodeur pour une photo : bornes de photo de telephone (16 Mpx, 4 608 px) y compris pour un JPEG PROGRESSIF (le plafond du decodeur etait 4 Mpx : 92 des 386 vraies grandes photos du poste, des progressifs 3000 x 4000,
 *  etaient refusees TROP_GRAND ; mesure : un progressif de 12 Mpx se decode en 650 ms pour ~100 Mo de tampons, 4 000 000 -> 16 000 000). */
export function optionsDecodeur(options = {}) {
  return { orientation: options.orientation || 'exif', orientationWebp: Boolean(options.orientationWebp), pixelsMax: options.pixelsMax || PIXELS_MAX_PHOTO, coteMax: options.coteMax || COTE_MAX_PHOTO, pixelsMaxProgressif: options.pixelsMaxProgressif || PIXELS_MAX_PHOTO };
}
/** Les dimensions apres pre-reduction, EN ENTIERS (arrondi au plus proche, demi vers le haut : floor((2*c*800 + g) / (2*g))) ; null si le grand cote est deja <= 800. */
export function dimensionsPre(w, h) {
  const g = Math.max(w, h);
  if (g <= COTE_PRE) return null;
  const arr = (c) => Math.max(1, Math.floor((2 * c * COTE_PRE + g) / (2 * g)));
  return { W: arr(w), H: arr(h) };
}
/**
 * La PRE-REDUCTION : Image.resize(BILINEAR) de Pillow (decodeur.mjs : redimRgb), arithmetique des pixels en ENTIERS (poids en virgule fixe 22 bits, passe horizontale puis verticale, toujours dans cet ordre),
 * support elargi au facteur de reduction (donc un vrai filtre anti-repliement, pas un echantillonnage). Les coefficients se calculent en double avec +, -, *, /, trunc seulement (arrondi exact IEEE partout :
 * aucune fonction transcendante, aucun Math.hypot). Ni canvas, ni flottant 32 bits, ni dependance au moteur. rgb w*h*3 -> { rgb, largeur, hauteur } ; null si le grand cote est deja <= 800.
 */
export function prereduire(rgb, w, h) {
  const d = dimensionsPre(w, h);
  if (!d) return null;
  return { rgb: redimRgb(rgb, w, h, d.W, d.H), largeur: d.W, hauteur: d.H };
}

/** La reduction a 640 de la chaine : le canvas « high » emule s'il est dans son domaine, sinon Pillow (entiers). `voie` dit laquelle a servi. */
export function reduire(rgb, w, h, { voie = 'auto' } = {}) {
  if (voie !== 'pillow') { const r = reduireCanvasHigh(rgb, w, h); if (r) return r; }
  const r = reduire640(rgb, w, h);
  return { ...r, voie: 'pillow' };
}

// ------------------------------------------------------------
// La geometrie de la detection (recopie de pur.js ; ecart voulu : la distance)
// ------------------------------------------------------------
export const dist = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); };
/** La diagonale d'une image W x H : la meme racine que dist, jamais Math.hypot. */
export const diagonale = (W, Ht) => Math.sqrt(W * W + Ht * Ht);
export function ordonner(pts) { const s = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y)); const d = [...pts].sort((a, b) => (a.x - a.y) - (b.x - b.y)); return [s[0], d[3], s[3], d[0]]; }
export function aireQuad(q) { let a = 0; for (let i = 0; i < 4; i++) { const p = q[i], r = q[(i + 1) % 4]; a += p.x * r.y - r.x * p.y; } return Math.abs(a) / 2; }
export function evaluerQuadrilatere(pts, W, Ht) {
  const q = ordonner(pts);
  const largeur = (dist(q[0], q[1]) + dist(q[3], q[2])) / 2, hauteur = (dist(q[0], q[3]) + dist(q[1], q[2])) / 2;
  const ratio = Math.min(largeur, hauteur) / Math.max(largeur, hauteur);
  if (Math.abs(ratio - RATIO) / RATIO > 0.15) return null;
  return { quad: q, aire: aireQuad(q) / (W * Ht), paysage: largeur > hauteur };
}
export function retenirCandidats(cands, W, Ht) {
  const diag = diagonale(W, Ht), gardes = [];
  for (const c of [...cands].sort((a, b) => b.aire - a.aire)) {
    if (c.aire > 0.985) continue;
    if (gardes.some((g) => g.quad.every((p, j) => dist(p, c.quad[j]) < 0.03 * diag))) continue;
    gardes.push(c);
  }
  return gardes;
}
export function quadPourRedressement(cand) { const q = cand.quad; return cand.paysage ? [q[3], q[0], q[1], q[2]] : q; }

// ------------------------------------------------------------
// OpenCV (injecte) : quadrilateres, redresser (recopie de moteur.js, sans l'effacement de session)
// ------------------------------------------------------------
function pile() {
  const objets = [];
  const p = (o) => { objets.push(o); return o; };
  p.liberer = () => { for (let i = objets.length - 1; i >= 0; i--) { try { const o = objets[i]; if (o && !o.isDeleted()) o.delete(); } catch { /* deja libere */ } } objets.length = 0; };
  return p;
}
export function quadrilateres(cv, rgb, W, Ht) {
  const p = pile();
  try {
    const src = p(new cv.Mat(Ht, W, cv.CV_8UC3)); src.data.set(rgb);
    const gris = p(new cv.Mat()); cv.cvtColor(src, gris, cv.COLOR_RGB2GRAY);
    const flou = p(new cv.Mat()); cv.GaussianBlur(gris, flou, new cv.Size(5, 5), 0);
    const hsv = p(new cv.Mat()); cv.cvtColor(src, hsv, cv.COLOR_RGB2HSV);
    const canaux = p(new cv.MatVector()); cv.split(hsv, canaux);
    const sat = p(canaux.get(1)); const satFlou = p(new cv.Mat()); cv.GaussianBlur(sat, satFlou, new cv.Size(5, 5), 0);
    const cartes = [[flou, 20, 60], [flou, 40, 120], [flou, 70, 200], [satFlou, 30, 90]];
    const cands = [];
    const noyau = p(cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3)));
    for (const [img, lo, hi] of cartes) {
      const bords = p(new cv.Mat()); cv.Canny(img, bords, lo, hi);
      cv.dilate(bords, bords, noyau, new cv.Point(-1, -1), 2);
      const contours = p(new cv.MatVector()), hier = p(new cv.Mat());
      cv.findContours(bords, contours, hier, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = p(contours.get(i));
        const a = cv.contourArea(c);
        if (a < 0.06 * W * Ht) continue;
        const peri = cv.arcLength(c, true);
        const approx = p(new cv.Mat()); cv.approxPolyDP(c, approx, 0.02 * peri, true);
        let pts;
        if (approx.rows === 4 && cv.isContourConvex(approx)) { pts = []; for (let j = 0; j < 4; j++) pts.push({ x: approx.data32S[j * 2], y: approx.data32S[j * 2 + 1] }); }
        else { const r = cv.minAreaRect(c); pts = cv.RotatedRect.points(r).map((q) => ({ x: q.x, y: q.y })); }
        const cand = evaluerQuadrilatere(pts, W, Ht);
        if (cand) cands.push(cand);
      }
    }
    return { gardes: retenirCandidats(cands, W, Ht) };
  } finally { p.liberer(); }
}
export function redresser(cv, rgb, W, Ht, cand) {
  const p = pile();
  try {
    const src = p(new cv.Mat(Ht, W, cv.CV_8UC3)); src.data.set(rgb);
    const q = quadPourRedressement(cand);
    const s = p(cv.matFromArray(4, 1, cv.CV_32FC2, q.flatMap((pt) => [pt.x, pt.y])));
    const d = p(cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, L_RED, 0, L_RED, H_RED, 0, H_RED]));
    const M = p(cv.getPerspectiveTransform(s, d));
    const out = p(new cv.Mat()); cv.warpPerspective(src, out, M, new cv.Size(L_RED, H_RED), cv.INTER_LINEAR, cv.BORDER_REPLICATE);
    return new Uint8Array(out.data);
  } finally { p.liberer(); }
}

// ------------------------------------------------------------
// Empreintes (SHA-256 ecrit ici : crypto.subtle n'existe pas sur une page en http hors localhost, et le banc est ouvert depuis un telephone)
// ------------------------------------------------------------
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
/** SHA-256 d'un Uint8Array -> 64 hexadecimaux. */
export function sha256(octets) {
  const n = octets.length, total = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
  m.set(octets); m[n] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(total - 8, Math.floor((n * 8) / 4294967296)); dv.setUint32(total - 4, (n * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
  for (let o = 0; o < total; o += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = (W[i - 16] + (((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3)) + W[i - 7] + (((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return Array.from(H, (x) => x.toString(16).padStart(8, '0')).join('');
}
/** L'empreinte d'un quadrilatere (les coordonnees TELLES QUE rendues par OpenCV, en texte : un bit de difference la change). */
export function empreinteQuads(gardes) {
  const t = gardes.map((g) => g.quad.map((p) => `${p.x},${p.y}`).join(';') + `|${g.paysage ? 1 : 0}|${g.aire}`).join('#');
  return sha256(new TextEncoder().encode(`${gardes.length}#${t}`));
}

// ------------------------------------------------------------
// La chaine
// ------------------------------------------------------------
/**
 * octets de la photo -> { redressee, nCartes, quad, paysage, largeur, hauteur, dim640, voie, carte (RGB 420x587 | null), rgb640, empreintes }.
 * `cv` : OpenCV.js deja initialise. Options : { voie: 'auto' | 'pillow', orientation: 'exif' | 'aucune', orientationWebp }.
 * Rien n'est lu dans le navigateur ; une erreur du decodeur sort en ErreurDecodeur (code ferme).
 */
export function detecter(cv, octets, options = {}) {
  // Bornes : 16 Mpx et 4 608 px de cote par defaut. Le decodeur (et entete.js de l'extension) plafonne a 12 000 000 px : une photo d'iPhone 4032 x 3024 = 12 192 768 px serait refusee TROP_GRAND.
  const t00 = performance.now();
  const dec = decoder(octets, optionsDecodeur(options));
  const t0 = performance.now();
  // LA PRE-REDUCTION (grandes photos) : au-dela de 800 px de grand cote, un premier passage entier ramene la photo a 800 px, puis la chaine suit la voie deja prouvee (canvas-high, facteur 1,25).
  // `options.pre === false` la coupe (mesures de comparaison seulement).
  const t1 = t0;
  let rgb = dec.rgb, w = dec.largeur, h = dec.hauteur, pre = null;
  if (options.pre !== false && Math.max(w, h) > COTE_PRE) { pre = [w, h]; const p = prereduire(rgb, w, h); rgb = p.rgb; w = p.largeur; h = p.hauteur; }
  const t2 = performance.now();
  // `options.reducteur` n'existe que pour les mutations des bancs (remplacer la reduction par un chemin qui depend du navigateur) ; la production ne le passe jamais.
  const r = options.reducteur ? options.reducteur(rgb, w, h) : reduire(rgb, w, h, { voie: options.voie || 'auto' });
  const t3 = performance.now();
  const det = quadrilateres(cv, r.rgb, r.largeur, r.hauteur);
  // `candidats` : TOUS les quadrilateres retenus, dans l'ordre de la detection (le rang 1 est celui qui est redresse) ; sert aux mesures, jamais a la decision.
  const sortie = { largeur: dec.largeur, hauteur: dec.hauteur, format: dec.format, orientationAppliquee: dec.orientationAppliquee, prereduction: pre, dim640: [r.largeur, r.hauteur], voie: r.voie, nCartes: det.gardes.length, candidats: det.gardes.map((g) => ({ quad: g.quad.map((p) => [p.x, p.y]), aire: g.aire })), redressee: false, quad: null, paysage: null, carte: null, rgb640: r.rgb,
    empreintes: { rgb640: sha256(r.rgb), quads: empreinteQuads(det.gardes), carte: null }, ms: { decodage: 0, pre: Math.round(t2 - t1), reduction: Math.round(t3 - t2), detection: 0 } };
  if (det.gardes.length) {
    const cand = det.gardes[0];
    sortie.redressee = true; sortie.quad = cand.quad.map((p) => [p.x, p.y]); sortie.paysage = cand.paysage;
    sortie.carte = redresser(cv, r.rgb, r.largeur, r.hauteur, cand);
    sortie.empreintes.carte = sha256(sortie.carte);
  }
  sortie.ms.decodage = Math.round(t0 - t00); sortie.ms.detection = Math.round(performance.now() - t3);
  return sortie;
}
