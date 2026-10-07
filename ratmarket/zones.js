// ============================================================================
// RATMARKET V1 — LA GARDE DES ZONES, PORTÉE DANS L'API (OpenCV.js) — pendant de pokemon-proxy-labo/rm/garde_zones.py
// ============================================================================
// Ce que la règle G (ratmarket/decision-g.js) demande quand le premier voisin a des JUMEAUX :
//   · comparerPaire(photo, a, b) : les deux scans alignés l'un sur l'autre, on garde les pixels où ILS diffèrent (gradients dilatés : le
//     numéro, le symbole, le tampon, la langue) ; sur ces pixels seulement, la photo alignée ressemble-t-elle plus à a ou à b ? Rend
//     [score a − score b, part de la carte couverte par le masque] ; [0, 0] si l'alignement échoue (rien n'est conclu) ;
//   · scoresZones(photo, v) : la photo alignée sur le scan de v, la corrélation des gradients zone par zone (haut, illustration, bandeau,
//     texte, bas) et le nombre de points d'appui de l'alignement — la ZONE CLÉ (bas, haut) confirme ou non.
// FIDÉLITÉ AU LABO, et c'est le point : la règle a été calibrée sur les mesures de garde_zones.py ; une mesure qui s'en écarte déplace les
// seuils sans le dire. Donc les mêmes gestes, dans le même ordre :
//   · un SCAN est lu comme Pillow le lit : RGB → gris par la formule de Pillow (L24, virgule fixe, arrondi), puis redimensionné en
//     420 × 586 par le BILINÉAIRE de Pillow (deux passes, coefficients en virgule fixe sur 22 bits) — recopiés de Resample.c, pas
//     approchés par sharp, dont le noyau linéaire n'est pas celui de Pillow ;
//   · la PHOTO redressée passe par OpenCV comme au labo (cvtColor RGB2GRAY, resize linéaire si besoin) ;
//   · ORB 1 500 points, appariement Hamming croisé, les 300 meilleurs (tri STABLE par distance, comme `sorted`), homographie RANSAC 6 px ;
//   · gradients : flou gaussien 3 × 3, Sobel en float32, norme ; corrélation normalisée ; percentile 97 interpolé comme numpy.
// Le banc ratmarket/test-zones.js mesure l'écart à garde_zones.py sur les appels réels des bancs, et la décision qui en sort.
// ⚠️ OpenCV.js ne libère rien tout seul (la fuite d'inliers(), PLAN-API.md §1.2) : chaque Mat et chaque vecteur est libéré ici.
'use strict';
const fs = require('fs');

const L = 420, H = 586;
const ZONES = { haut: [0.0, 0.12], illustration: [0.12, 0.55], bandeau: [0.55, 0.62], texte: [0.62, 0.88], bas: [0.88, 1.0] };
const PRECISION_BITS = 32 - 8 - 2;
// L'ALIGNEMENT STABLE (2026-10-07), le pendant de garde_zones.py « stable » (labo, 2026-10-06 soir) : OpenCV.js rend les mêmes points ORB
// que Python dans un AUTRE ORDRE (et ~2 % de descripteurs différents) ; l'appariement croisé départage les distances égales par l'indice
// du point, et RANSAC tire selon l'ordre de ses entrées — la mesure dépendait d'un ordre sans aucun sens (« bas » s'écartait jusqu'à 0,61).
// (1) les points dans un ORDRE CANONIQUE (y, x, niveau, taille) ; (2) les appariements triés par (distance, requête, cible) ; (3) l'homographie
// RANSAC AFFINÉE par moindres carrés sur ses points d'appui, recomptés jusqu'à ce qu'ils ne bougent plus. RM_ALIGNEMENT=v1 rejoue l'ancien.
const ALIGNEMENT = process.env.RM_ALIGNEMENT === 'v1' ? 'v1' : 'stable';
// LES CACHES BORNÉS (2026-10-07) : un scan (gris, gradient float32, descripteurs) pèse ~1,3 Mo, une paire (masque, gradient) ~1,2 Mo ; le
// labo en gardait 3 000 et 5 000 — ~10 Go, sur un serveur de 512 Mo. Ici 32 de chaque (~80 Mo au plus), le moins récemment servi part.
const CACHE_SCANS = 32, CACHE_PAIRES = 32;
const servir = (m, k) => { const v = m.get(k); m.delete(k); m.set(k, v); return v; };

let _cv = null, _sharp = null;
async function outils() {
    if (!_cv) {
        _sharp = require('sharp');
        const cv = await require('@techstark/opencv-js');
        if (typeof cv.Mat !== 'function') throw new Error('opencv-js chargé mais non initialisé');
        _cv = cv;
    }
    return { cv: _cv, sharp: _sharp };
}

// ── Pillow, recopié (src/libImaging/Convert.c : L24 ; Resample.c : precompute_coeffs, normalize_coeffs_8bpc, les deux passes)
function grisPillow(rgb, n) {
    const g = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 3) g[i] = (rgb[j] * 19595 + rgb[j + 1] * 38470 + rgb[j + 2] * 7471 + 0x8000) >>> 16;
    return g;
}
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
        for (let x = 0; x < ksize; x++) {
            const v = k[x] * (1 << PRECISION_BITS);
            kk[xx * ksize + x] = v < 0 ? Math.trunc(-0.5 + v) : Math.trunc(0.5 + v);
        }
        bornes[xx * 2] = xmin; bornes[xx * 2 + 1] = xmax;
    }
    return { ksize, bornes, kk };
}
const clip8 = v => { const x = v >> PRECISION_BITS; return x < 0 ? 0 : x > 255 ? 255 : x; };
/** Image.resize((ow, oh), BILINEAR) de Pillow sur une image 8 bits à un canal : horizontal d'abord, sur les seules lignes utiles. */
function redimPillow(src, w, h, ow, oh) {
    const cv = coefficients(h, oh), ch = coefficients(w, ow);
    const besoinH = ow !== w, besoinV = oh !== h;
    let tmp = src, tw = w, th = h, ypremier = 0;
    const bv = Int32Array.from(cv.bornes);
    if (besoinH) {
        ypremier = besoinV ? bv[0] : 0;
        const ydernier = besoinV ? bv[(oh - 1) * 2] + bv[(oh - 1) * 2 + 1] : h;
        if (besoinV) for (let i = 0; i < oh; i++) bv[i * 2] -= ypremier;
        th = ydernier - ypremier; tw = ow;
        tmp = new Uint8Array(tw * th);
        for (let y = 0; y < th; y++) {
            const ligne = (y + ypremier) * w;
            for (let xx = 0; xx < ow; xx++) {
                const xmin = ch.bornes[xx * 2], xmax = ch.bornes[xx * 2 + 1], k = xx * ch.ksize;
                let ss = 1 << (PRECISION_BITS - 1);
                for (let x = 0; x < xmax; x++) ss += src[ligne + x + xmin] * ch.kk[k + x];
                tmp[y * tw + xx] = clip8(ss);
            }
        }
    }
    if (!besoinV) return tmp;
    const out = new Uint8Array(ow * oh);
    for (let yy = 0; yy < oh; yy++) {
        const ymin = bv[yy * 2], ymax = bv[yy * 2 + 1], k = yy * cv.ksize;
        for (let xx = 0; xx < ow; xx++) {
            let ss = 1 << (PRECISION_BITS - 1);
            for (let y = 0; y < ymax; y++) ss += tmp[(y + ymin) * tw + xx] * cv.kk[k + y];
            out[yy * ow + xx] = clip8(ss);
        }
    }
    return out;
}

/** Les points ORB et leurs descripteurs dans l'ordre CANONIQUE (y, x, niveau, taille) — `_canonique` du labo. Libère `kp` et `d`. */
function canonique(cv, kp, d) {
    const n = kp.size(), p = new Array(n);
    for (let i = 0; i < n; i++) { const k = kp.get(i); p[i] = { i, x: k.pt.x, y: k.pt.y, o: k.octave, s: k.size }; }
    if (ALIGNEMENT === 'stable') p.sort((a, b) => a.y - b.y || a.x - b.x || a.o - b.o || a.s - b.s);
    const c = d.cols, src = d.data, dst = new Uint8Array(n * c);
    for (let j = 0; j < n; j++) dst.set(src.subarray(p[j].i * c, p[j].i * c + c), j * c);
    const D = n ? cv.matFromArray(n, c, cv.CV_8U, dst) : new cv.Mat();
    kp.delete(); d.delete();
    return { pts: p.map(x => ({ x: x.x, y: x.y })), d: D };
}

// ── les scans : gris Pillow 420 × 586, points ORB (ordre canonique), gradient — gardés en mémoire, CACHE_SCANS au plus
const _scans = new Map();
async function scan(source) {
    if (_scans.has(source.cle)) return servir(_scans, source.cle);
    const { cv, sharp } = await outils();
    const tampon = source.octets || fs.readFileSync(source.chemin);
    const { data, info } = await sharp(tampon).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
    if (info.channels !== 3) throw new Error(`scan ${source.cle} : ${info.channels} canaux après conversion`);
    const g = redimPillow(grisPillow(data, info.width * info.height), info.width, info.height, L, H);
    const mat = cv.matFromArray(H, L, cv.CV_8UC1, g);
    const kp = new cv.KeyPointVector(), d = new cv.Mat(), vide = new cv.Mat();
    const orb = new cv.ORB(1500);
    orb.detectAndCompute(mat, vide, kp, d);
    orb.delete(); vide.delete();
    const c = canonique(cv, kp, d);
    const s = { mat, pts: c.pts, d: c.d, grad: gradient(cv, mat) };
    _scans.set(source.cle, s);
    // le moins récemment servi part (un scan en cours d'usage vient d'être servi : il n'est jamais le premier à partir)
    while (_scans.size > CACHE_SCANS) { const [k0, v0] = _scans.entries().next().value; _scans.delete(k0); liberer(v0); }
    return s;
}
function liberer(s) { for (const k of ['mat', 'd', 'grad']) try { s[k].delete(); } catch (_) {} }

function gradient(cv, gris) {
    const f = new cv.Mat(); gris.convertTo(f, cv.CV_32F);
    const b = new cv.Mat(); cv.GaussianBlur(f, b, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);
    const gx = new cv.Mat(), gy = new cv.Mat(), m = new cv.Mat();
    cv.Sobel(b, gx, cv.CV_32F, 1, 0); cv.Sobel(b, gy, cv.CV_32F, 0, 1); cv.magnitude(gx, gy, m);
    f.delete(); b.delete(); gx.delete(); gy.delete();
    return m;
}

/** La photo redressée (RGB, w × h) en gris OpenCV 420 × 586, comme garde_zones.scores_zones la prépare. */
async function photoGrise(rgb, w, h) {
    const { cv } = await outils();
    const src = cv.matFromArray(h, w, cv.CV_8UC3, rgb), g = new cv.Mat();
    cv.cvtColor(src, g, cv.COLOR_RGB2GRAY); src.delete();
    if (w !== L || h !== H) { const r = new cv.Mat(); cv.resize(g, r, new cv.Size(L, H), 0, 0, cv.INTER_LINEAR); g.delete(); return r; }
    return g;
}

/** Le point (x, y) par l'homographie H (9 nombres, ligne par ligne). */
const projeter = (Hh, x, y) => { const w = Hh[6] * x + Hh[7] * y + Hh[8]; return [(Hh[0] * x + Hh[1] * y + Hh[2]) / w, (Hh[3] * x + Hh[4] * y + Hh[5]) / w]; };
/** findHomography sur des tableaux plats [x0, y0, x1, y1…] : 9 nombres, ou null ; `masque` (Uint8Array) rempli pour RANSAC. */
function homographie(cv, P1, P2, methode, seuil = 6.0) {
    const n = P1.length / 2, s1 = cv.matFromArray(n, 1, cv.CV_32FC2, P1), s2 = cv.matFromArray(n, 1, cv.CV_32FC2, P2), m = new cv.Mat();
    const Hm = methode === 'ransac' ? cv.findHomography(s1, s2, cv.RANSAC, seuil, m) : cv.findHomography(s1, s2, 0);
    s1.delete(); s2.delete();
    const r = Hm.empty() ? null : { H: Array.from(Hm.data64F), masque: m.rows ? Uint8Array.from(m.data) : null };
    Hm.delete(); m.delete();
    return r;
}
/** `_homographie` du labo : RANSAC 6 px, puis moindres carrés sur les points d'appui, recomptés à 6 px, jusqu'à ce qu'ils ne bougent plus. */
function homographieStable(cv, P1, P2, seuil = 6.0, tours = 5) {
    const r = homographie(cv, P1, P2, 'ransac', seuil);
    if (!r) return { H: null, inliers: 0 };
    const n = P1.length / 2;
    const dedans = Hh => { const o = new Array(n); for (let i = 0; i < n; i++) { const [u, v] = projeter(Hh, P1[2 * i], P1[2 * i + 1]); o[i] = Math.hypot(u - P2[2 * i], v - P2[2 * i + 1]) < seuil; } return o; };
    let Hh = r.H, inl = Array.from(r.masque, x => x !== 0);
    for (let t = 0; t < tours; t++) {
        const idx = inl.flatMap((b, i) => b ? [i] : []);
        if (idx.length < 8) break;
        const r2 = homographie(cv, idx.flatMap(i => [P1[2 * i], P1[2 * i + 1]]), idx.flatMap(i => [P2[2 * i], P2[2 * i + 1]]), 'moindres-carres');
        if (!r2) break;
        Hh = r2.H;
        const inl2 = dedans(Hh);
        if (inl2.every((b, i) => b === inl[i])) break;
        inl = inl2;
    }
    return { H: Hh, inliers: dedans(Hh).filter(Boolean).length };
}

/** aligner(gris, scan) → { mat (à libérer), inliers } : la photo ramenée dans le repère du scan. */
async function aligner(gris, sc) {
    const { cv } = await outils();
    const orb = new cv.ORB(1500), kp1 = new cv.KeyPointVector(), d1 = new cv.Mat(), vide = new cv.Mat();
    orb.detectAndCompute(gris, vide, kp1, d1); orb.delete(); vide.delete();
    const copie = () => { const c = new cv.Mat(); gris.copyTo(c); return c; };
    if (d1.rows === 0 || sc.d.rows === 0 || kp1.size() < 8 || sc.pts.length < 8) { kp1.delete(); d1.delete(); return { mat: copie(), inliers: 0 }; }
    const { pts: pts1, d: D1 } = canonique(cv, kp1, d1);
    const bf = new cv.BFMatcher(cv.NORM_HAMMING, true), mv = new cv.DMatchVector();
    bf.match(D1, sc.d, mv);
    const m = [];
    for (let i = 0; i < mv.size(); i++) { const x = mv.get(i); m.push({ q: x.queryIdx, t: x.trainIdx, d: x.distance, i }); }
    mv.delete(); bf.delete(); D1.delete();
    if (ALIGNEMENT === 'stable') m.sort((a, b) => a.d - b.d || a.q - b.q || a.t - b.t);   // (distance, requête, cible)
    else m.sort((a, b) => a.d - b.d || a.i - b.i);                                         // v1 : `sorted(..., key=distance)`, stable
    const pris = m.slice(0, 300);
    if (pris.length < 8) return { mat: copie(), inliers: 0 };
    const p1 = [], p2 = [];
    for (const x of pris) { const a = pts1[x.q], b = sc.pts[x.t]; p1.push(a.x, a.y); p2.push(b.x, b.y); }
    let Hh, inl;
    if (ALIGNEMENT === 'stable') ({ H: Hh, inliers: inl } = homographieStable(cv, p1, p2));
    else { const r = homographie(cv, p1, p2, 'ransac', 6.0); Hh = r?.H ?? null; inl = r ? r.masque.reduce((s, x) => s + (x ? 1 : 0), 0) : 0; }
    if (!Hh) return { mat: copie(), inliers: 0 };
    // une homographie aberrante (écrasement, retournement) est pire que pas d'alignement — l'aire du quadrilatère des coins (contourArea)
    const c = [[0, 0], [L, 0], [L, H], [0, H]].map(([x, y]) => projeter(Hh, x, y));
    const aire = Math.abs(c.reduce((s, [x, y], i) => { const [x2, y2] = c[(i + 1) % 4]; return s + x * y2 - x2 * y; }, 0)) / 2;
    // (2026-10-07) une homographie ABERRANTE n'aligne rien : ses points ne comptent pas (garde_zones.py, même règle) — sinon deux scans non
    // alignés passaient pour alignés (≥ 12) et la carte des différences était fausse. v1 : l'ancien compte, pour rejouer le 2026-10-06.
    if (inl < 12) return { mat: copie(), inliers: inl };
    if (!(0.6 * L * H < aire && aire < 1.6 * L * H)) return { mat: copie(), inliers: ALIGNEMENT === 'v1' ? inl : 0 };
    const al = new cv.Mat(), Hm = cv.matFromArray(3, 3, cv.CV_64F, Hh);
    cv.warpPerspective(gris, al, Hm, new cv.Size(L, H), cv.INTER_LINEAR, cv.BORDER_REPLICATE, new cv.Scalar());
    Hm.delete();
    return { mat: al, inliers: inl };
}

function ncc(a, b) {
    let ma = 0, mb = 0; const n = a.length;
    for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    let sab = 0, saa = 0, sbb = 0;
    for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    const d = Math.sqrt(saa * sbb);
    return d > 0 ? sab / d : 0;
}
function bande(grad, y0, y1, m = 8) {
    const r0 = Math.trunc(y0 * H), r1 = Math.trunc(y1 * H), out = new Float32Array((r1 - r0) * (L - 2 * m));
    let k = 0; const d = grad.data32F;
    for (let y = r0; y < r1; y++) for (let x = m; x < L - m; x++) out[k++] = d[y * L + x];
    return out;
}

/** garde_zones.scores_zones : { haut, illustration, bandeau, texte, bas, inliers }. */
async function scoresZones(photo, source) {
    const { cv } = await outils();
    const sc = await scan(source);
    const { mat: al, inliers } = await aligner(photo, sc);
    const ga = gradient(cv, al); al.delete();
    const out = {};
    for (const [z, [y0, y1]] of Object.entries(ZONES)) out[z] = ncc(bande(ga, y0, y1), bande(sc.grad, y0, y1));
    ga.delete();
    out.inliers = inliers;
    return out;
}

// la carte des différences d'une PAIRE de scans : (masque, gradient de b aligné) ou null — gardée, comme au labo (5 000 au plus)
const _paires = new Map();
async function cartePaire(sa, sb, cle) {
    if (_paires.has(cle)) return servir(_paires, cle);
    const { cv } = await outils();
    const { mat: al, inliers } = await aligner(sb.mat, sa);
    let P = null;
    if (inliers >= 12) {
        const gb = gradient(cv, al);
        const A = sa.grad.data32F, B = gb.data32F, n = L * H, d = new Float32Array(n);
        for (let i = 0; i < n; i++) d[i] = Math.abs(A[i] - B[i]);
        const seuil = Math.max(25.0, percentile97(d));
        const brut = new cv.Mat(H, L, cv.CV_8UC1);
        for (let i = 0; i < n; i++) brut.data[i] = d[i] > seuil ? 1 : 0;
        const noyau = cv.Mat.ones(5, 5, cv.CV_8U), dil = new cv.Mat();
        cv.dilate(brut, dil, noyau); brut.delete(); noyau.delete();
        const masque = new Uint8Array(dil.data); dil.delete();
        for (let y = 0; y < H; y++) for (let x = 0; x < L; x++) if (y < 8 || y >= H - 8 || x < 8 || x >= L - 8) masque[y * L + x] = 0;
        P = { masque, gb: new Float32Array(gb.data32F) }; gb.delete();
    }
    al.delete();
    _paires.set(cle, P);
    while (_paires.size > CACHE_PAIRES) _paires.delete(_paires.keys().next().value);
    return P;
}
function percentile97(d) {
    const s = Float32Array.from(d).sort(), pos = 0.97 * (s.length - 1), i = Math.floor(pos), f = pos - i;
    return i + 1 < s.length ? s[i] + (s[i + 1] - s[i]) * f : s[i];
}

/** garde_zones.comparer_paire : [score a − score b, part couverte par le masque] ; [0, 0] si les scans ne s'alignent pas. */
async function comparerPaire(photo, sourceA, sourceB) {
    const { cv } = await outils();
    const sa = await scan(sourceA), sb = await scan(sourceB);
    const P = await cartePaire(sa, sb, `${sourceA.cle}|${sourceB.cle}`);
    if (!P) return [0, 0];
    let nm = 0; for (let i = 0; i < P.masque.length; i++) nm += P.masque[i];
    if (nm < 200) return [0, 0];
    const couv = nm / P.masque.length;
    const { mat: al, inliers } = await aligner(photo, sa);
    if (inliers < 12) { al.delete(); return [0, couv]; }
    const gq = gradient(cv, al); al.delete();
    const Q = gq.data32F, A = sa.grad.data32F;
    const q = new Float32Array(nm), a = new Float32Array(nm), b = new Float32Array(nm);
    for (let i = 0, k = 0; i < P.masque.length; i++) if (P.masque[i]) { q[k] = Q[i]; a[k] = A[i]; b[k] = P.gb[i]; k++; }
    gq.delete();
    return [ncc(q, a) - ncc(q, b), couv];
}

// (relecture, 2026-10-07) LES APPELS PUBLICS PASSENT UN PAR UN. Sous des requêtes concurrentes, une E/S de sharp au milieu de comparerPaire
// (scan(A), puis la LECTURE de B) laissait une autre requête insérer plus de CACHE_SCANS scans : A était évincé, ses Mats détruites, puis
// utilisées — et deux chargements simultanés d'une même clé fuyaient un scan (~1,3 Mo de tas WASM). OpenCV.js est monofil de toute façon :
// la file ne coûte rien en débit, et elle rend l'éviction sûre (un scan en usage est toujours parmi les deux derniers servis).
let fileZones = Promise.resolve();
const unParUn = f => (...a) => { const p = fileZones.then(() => f(...a)); fileZones = p.catch(() => { }); return p; };

module.exports = { L, H, ZONES, ALIGNEMENT, CACHE_SCANS, CACHE_PAIRES, outils, grisPillow, redimPillow, scan, photoGrise, aligner,
    scoresZones: unParUn(scoresZones), comparerPaire: unParUn(comparerPaire), _scans, _paires };
