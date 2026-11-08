// ============================================================
// L'EMPREINTE CALCULEE PAR L'EXTENSION (lot N1) : fonctions PURES (aucun DOM, aucun OpenCV, aucun ORT) — le contrat du 25/10
// ============================================================
// Pipeline (DEMANDE-SERVEUR-EXTENSION.md, « CONTRAT DE L'EMPREINTE ») : la carte REDRESSEE 420 x 587 (RGB) -> redimPIL 224 x 224 (bicubique « facon PIL »,
// support elargi a la reduction, antialias) -> tenseur float32 NCHW RGB `(p/255 - 0,5)/0,5` -> [le modele, dans le Worker] -> `emb` [1, 256] -> L2 -> fp16
// petit-boutiste -> base64 standard avec `=` (684 caracteres, 512 octets).
// `bicubique`, `coefficients` et `redimPIL` sont recopiees TELLES QUELLES de la reference de l'API (navigateur/page.mjs, l. 82-115) :
// « un autre redimensionnement donne un autre vecteur ». Ne pas « simplifier » ces trois fonctions.

export const COTE_MODELE = 224;
export const COMPOSANTES = 256;
export const VECTEUR_BASE64 = 684;
export const FILS_MAX = 4;

/**
 * E2 : le nombre de fils WebAssembly d'ORT (mesure : 1 fil 1 383 ms, 2 fils 678 ms, 4 fils 362 ms par inference, memes vecteurs). La moitie des coeurs logiques (les autres
 * servent au navigateur et a la page), de 1 a FILS_MAX ; 1 si le nombre est inconnu ou n'est pas un nombre fini positif.
 */
export function nombreDeFils(coeursLogiques) {
  if (typeof coeursLogiques !== 'number' || !Number.isFinite(coeursLogiques) || coeursLogiques < 1) return 1;
  return Math.max(1, Math.min(FILS_MAX, Math.floor(coeursLogiques / 2)));
}

// ---- recopie de page.mjs (l. 82-115), sans changement ----
const bicubique = x => { x = Math.abs(x); return x < 1 ? ((1.5 * x - 2.5) * x) * x + 1 : x < 2 ? ((-0.5 * x + 2.5) * x - 4) * x + 2 : 0; };
function coefficients(entree, sortie) {
    const echelle = entree / sortie, fe = Math.max(echelle, 1), support = 2 * fe, out = [];
    for (let i = 0; i < sortie; i++) {
        const centre = (i + 0.5) * echelle;
        const xmin = Math.max(0, Math.floor(centre - support + 0.5)), xmax = Math.min(entree, Math.floor(centre + support + 0.5));
        const w = []; let s = 0;
        for (let x = xmin; x < xmax; x++) { const v = bicubique((x - centre + 0.5) / fe); w.push(v); s += v; }
        out.push({ xmin, w: w.map(v => v / s) });
    }
    return out;
}
export function redimPIL(rgba, w, h, W2, H2, effacer = null) { // effacer (lot W) : appelee sur le tampon intermediaire avant le retour (session de scans : rien de la photo ne reste)
    const ch = coefficients(w, W2), cv_ = coefficients(h, H2);
    const inter = new Uint8ClampedArray(W2 * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < W2; x++) {
        const { xmin, w: ws } = ch[x]; let r = 0, g = 0, b = 0;
        for (let k = 0; k < ws.length; k++) { const p = (y * w + xmin + k) * 4; r += rgba[p] * ws[k]; g += rgba[p + 1] * ws[k]; b += rgba[p + 2] * ws[k]; }
        const o = (y * W2 + x) * 3; inter[o] = Math.round(r); inter[o + 1] = Math.round(g); inter[o + 2] = Math.round(b);
    }
    const out = new Uint8ClampedArray(W2 * H2 * 4);
    for (let y = 0; y < H2; y++) { const { xmin, w: ws } = cv_[y]; for (let x = 0; x < W2; x++) {
        let r = 0, g = 0, b = 0;
        for (let k = 0; k < ws.length; k++) { const p = ((xmin + k) * W2 + x) * 3; r += inter[p] * ws[k]; g += inter[p + 1] * ws[k]; b += inter[p + 2] * ws[k]; }
        const o = (y * W2 + x) * 4; out[o] = Math.round(r); out[o + 1] = Math.round(g); out[o + 2] = Math.round(b); out[o + 3] = 255;
    } }
    if (effacer) effacer(inter);
    return out;
}
// ---- fin de la recopie ----

/** RGB (w*h*3) -> RGBA opaque : la forme que redimPIL lit (page.mjs lisait un canvas : le meme alpha 255). */
export function rgbVersRgba(rgb, w, h) {
  const n = w * h, rgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { rgba[i * 4] = rgb[i * 3]; rgba[i * 4 + 1] = rgb[i * 3 + 1]; rgba[i * 4 + 2] = rgb[i * 3 + 2]; rgba[i * 4 + 3] = 255; }
  return rgba;
}

/** page.mjs `versTenseur`, sur une carte RGB deja en memoire : ecrit `dst` (Float32Array 3*224*224, NCHW). */
export function versTenseur(rgb, w, h, dst = new Float32Array(3 * COTE_MODELE * COTE_MODELE), { effacer = null } = {}) {
  const rgba = rgbVersRgba(rgb, w, h);
  const px = redimPIL(rgba, w, h, COTE_MODELE, COTE_MODELE, effacer);
  for (let i = 0; i < COTE_MODELE * COTE_MODELE; i++) for (let k = 0; k < 3; k++) dst[k * COTE_MODELE * COTE_MODELE + i] = (px[i * 4 + k] / 255 - 0.5) / 0.5;
  if (effacer) { effacer(rgba); effacer(px); } // lot W : les tampons derives de la photo sont efface a la fin de SA demande
  return dst;
}

/** Normalisation L2 (page.mjs : en double, `e[j] /= s`). Une norme nulle ou non finie n'est pas normalisable : null. */
export function normaliserL2(emb) {
  const e = Array.from(emb);
  let s = 0; for (let j = 0; j < e.length; j++) s += e[j] ** 2;
  s = Math.sqrt(s);
  if (!(s > 0) || !Number.isFinite(s)) return null;
  for (let j = 0; j < e.length; j++) e[j] /= s;
  return e;
}

// ---- fp16 petit-boutiste, arrondi au plus proche, pair en cas d'egalite (comme numpy `astype(float16)`) ----
const f32 = new Float32Array(1), u32 = new Uint32Array(f32.buffer);
/** Les 16 bits IEEE binary16 d'une valeur (d'abord ramenee en float32, comme un tableau float32 de numpy). */
export function versFp16(x) {
  f32[0] = x;
  const b = u32[0], signe = (b >>> 16) & 0x8000, exp = (b >>> 23) & 0xff, mant = b & 0x7fffff;
  if (exp === 0xff) return signe | 0x7c00 | (mant ? 0x200 : 0); // infini, NaN
  const e = exp - 127 + 15;
  if (e >= 31) return signe | 0x7c00;                           // trop grand : infini
  if (e <= 0) {                                                   // sous-normal, ou zero
    if (e < -10) return signe;                                    // sous 2^-25 : zero (signe garde)
    const m = mant | 0x800000, decalage = 14 - e, moitie = 1 << (decalage - 1);
    let demi = m >>> decalage; const reste = m & ((1 << decalage) - 1);
    if (reste > moitie || (reste === moitie && (demi & 1))) demi++; // au plus proche, pair a egalite ; une retenue passe au plus petit normal
    return signe | demi;
  }
  let demi = (e << 10) | (mant >>> 13); const reste = mant & 0x1fff;
  if (reste > 0x1000 || (reste === 0x1000 && (demi & 1))) demi++; // la retenue monte l'exposant, jusqu'a l'infini si besoin
  return signe | demi;
}
/** binary16 -> nombre (pour controler apres l'arrondi). */
export function depuisFp16(h) {
  const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
  if (e === 0) return s * m * 2 ** -24;
  if (e === 31) return m ? NaN : s * Infinity;
  return s * (1 + m / 1024) * 2 ** (e - 15);
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** base64 standard avec `=` (ecrit ici : aucun btoa, aucun Buffer, donc identique en node et dans un Worker). */
export function base64(octets) {
  let s = '';
  for (let i = 0; i < octets.length; i += 3) {
    const a = octets[i], b = i + 1 < octets.length ? octets[i + 1] : 0, c = i + 2 < octets.length ? octets[i + 2] : 0, n = (a << 16) | (b << 8) | c;
    s += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + (i + 1 < octets.length ? ALPHABET[(n >> 6) & 63] : '=') + (i + 2 < octets.length ? ALPHABET[n & 63] : '=');
  }
  return s;
}

/** Les composantes (normalisees) -> les 512 octets fp16 petit-boutiste. */
export function octetsFp16(composantes) {
  const o = new Uint8Array(composantes.length * 2);
  for (let i = 0; i < composantes.length; i++) { const h = versFp16(composantes[i]); o[i * 2] = h & 255; o[i * 2 + 1] = h >> 8; }
  return o;
}

/**
 * Les regles du §5, controlees AVANT l'envoi : 256 composantes finies, |x| <= 0,5, norme dans [0,999 ; 1,001] APRES le passage en fp16.
 * Rend { vecteur (base64, 684 car.), norme } ou null (un vecteur qui les viole n'est pas rendu).
 */
export function encoderVecteur(composantes) {
  if (!composantes || composantes.length !== COMPOSANTES) return null;
  const f = Array.from(composantes, Math.fround); // le float32 du contrat
  if (!f.every((x) => Number.isFinite(x))) return null; // |x| <= 0,5 est controle sur la valeur que le serveur DECODE (apres fp16) : 0,5001 s'arrondit a 0,5 et passe
  const o = octetsFp16(f);
  let s = 0;
  for (let i = 0; i < COMPOSANTES; i++) {
    const x = depuisFp16(o[i * 2] | (o[i * 2 + 1] << 8));
    if (!Number.isFinite(x) || Math.abs(x) > 0.5) return null;
    s += x * x;
  }
  const norme = Math.sqrt(s);
  if (!(norme >= 0.999 && norme <= 1.001)) return null;
  const vecteur = base64(o);
  return vecteur.length === VECTEUR_BASE64 ? { vecteur, norme } : null;
}

/** Du `emb` brut du modele (256 float32) au vecteur a envoyer, ou null. */
export function vecteurDepuisSortie(emb) {
  const n = normaliserL2(emb);
  return n ? encoderVecteur(n) : null;
}
