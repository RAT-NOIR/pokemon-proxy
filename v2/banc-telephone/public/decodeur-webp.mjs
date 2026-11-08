// DECODEUR WEBP (VP8, avec perte) — code Rat-Market, JavaScript pur, entiers seulement : aucun canvas, aucun profil couleur, aucune API du navigateur.
// Écrit d'après la spécification VP8 (RFC 6386 : arbres, ordre des en-têtes, filtres) dont les TABLES numériques sont LUES dans le texte de la RFC (outils/decodeur/extraire-tables-vp8.js, comptées),
// et d'après le comportement de libwebp (celui de Pillow et de Chrome) pour tout ce que la norme laisse à l'implémentation : lecteur booléen et son drapeau de fin de flux, transformée entière,
// filtres de boucle, sur-échantillonnage « fancy » des chromas et conversion YUV -> RGB en virgule fixe.
// Pris : WebP avec perte, image fixe (RIFF « WEBP » avec un seul chunk « VP8 », ou « VP8X » sans animation ; un chunk « ALPH » est ignoré : Pillow convert('RGB') ignore l'alpha).
// Refusés avec un CODE : sans perte (VP8L), animation, image tronquée, partitions incohérentes. Jamais un résultat approché.
import { ErreurDecodeur, orientationExif } from './decodeur-jpeg.mjs';
import { DC_Q, AC_Q, KF_BMODE_PROBS, COEFF_UPDATE_PROBS, COEFF_PROBS } from './decodeur-webp-tables.mjs';

const refuser = (code, detail) => { throw new ErreurDecodeur(code, detail); };
const u24le = (b, i) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32le = (b, i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
const tag = (b, i) => String.fromCharCode(b[i], b[i + 1], b[i + 2], b[i + 3]);
const clip8 = v => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Les chunks du conteneur RIFF : [{ type, debut, taille }] ; refuse un conteneur incohérent. */
function chunks(b) {
    if (b.length < 20 || tag(b, 0) !== 'RIFF' || tag(b, 8) !== 'WEBP') refuser('FORMAT', 'pas un WebP');
    const riff = u32le(b, 4);
    if (riff + 8 > b.length || riff < 12) refuser('DECODAGE', 'conteneur tronqué');
    const fin = riff + 8, liste = [];
    for (let i = 12; i + 8 <= fin;) {
        const taille = u32le(b, i + 4);
        if (i + 8 + taille > fin) refuser('DECODAGE', 'chunk tronqué');
        liste.push({ type: tag(b, i), debut: i + 8, taille });
        i += 8 + taille + (taille & 1);
    }
    return liste;
}
/** L'orientation EXIF d'un WebP (chunk « EXIF », avec ou sans le préfixe « Exif\0\0 ») ; 0 si absente. */
export function orientationWebp(b) {
    try {
        const c = chunks(b).find(x => x.type === 'EXIF');
        if (!c) return 0;
        let p = b.subarray(c.debut, c.debut + c.taille);
        if (!(p.length >= 6 && p[0] === 0x45 && p[1] === 0x78 && p[2] === 0x69 && p[3] === 0x66)) { const q = new Uint8Array(p.length + 6); q.set([0x45, 0x78, 0x69, 0x66, 0, 0]); q.set(p, 6); p = q; }
        return orientationExif(p, 0, p.length);
    } catch { return 0; }
}

// ── le lecteur booléen de libwebp (octet par octet : mêmes décisions, même drapeau de fin de flux `eof`)
class Lecteur {
    constructor(b, debut, fin) { this.b = b; this.pos = debut; this.fin = fin; this.range = 254; this.value = 0; this.bits = -8; this.eof = false; this.charger(); }
    charger() {
        if (this.pos < this.fin) { this.bits += 8; this.value = (this.value * 256) + this.b[this.pos++]; }
        else if (!this.eof) { this.value *= 256; this.bits += 8; this.eof = true; }
        else this.bits = 0;
    }
    get(prob) {
        let range = this.range;
        if (this.bits < 0) this.charger();
        const pos = this.bits, split = (range * prob) >> 8, v = Math.floor(this.value / (1 << pos));
        let bit;
        if (v > split) { range -= split; this.value -= (split + 1) * (1 << pos); bit = 1; } else { range = split + 1; bit = 0; }
        const shift = 7 ^ (31 - Math.clz32(range));
        range <<= shift; this.bits -= shift; this.range = range - 1;
        return bit;
    }
    valeur(n) { let v = 0; while (n-- > 0) v |= this.get(0x80) << n; return v; }
    signee(n) { const v = this.valeur(n); return this.get(0x80) ? -v : v; }
}

const BANDS = Uint8Array.from([0, 1, 2, 3, 6, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 7, 0]);
const ZIGZAG = Uint8Array.from([0, 1, 4, 8, 5, 2, 3, 6, 9, 12, 13, 10, 7, 11, 14, 15]);
const CAT3 = [173, 148, 140], CAT4 = [176, 155, 140, 135], CAT5 = [180, 157, 141, 134, 130], CAT6 = [254, 254, 243, 230, 196, 177, 153, 140, 133, 130, 129];
const CATS = [CAT3, CAT4, CAT5, CAT6];

// modes (numérotation de la RFC) : sous-blocs 0..9, macroblocs DC 0, V 1, H 2, TM 3, B 4
const B_DC = 0, B_TM = 1, B_VE = 2, B_HE = 3, B_LD = 4, B_RD = 5, B_VR = 6, B_VL = 7, B_HD = 8, B_HU = 9;
const DC_PRED = 0, V_PRED = 1, H_PRED = 2, TM_PRED = 3;
const B_TREE = [-B_DC, 2, -B_TM, 4, -B_VE, 6, 8, 12, -B_HE, 10, -B_RD, -B_VR, -B_LD, 14, -B_VL, 16, -B_HD, -B_HU];
const VERS_B = [B_DC, B_VE, B_HE, B_TM];     // DC_PRED, V_PRED, H_PRED, TM_PRED -> mode de sous-bloc impliqué

function grandeValeur(br, P, p) {
    let v;
    if (!br.get(P[p + 3])) { if (!br.get(P[p + 4])) v = 2; else v = 3 + br.get(P[p + 5]); }
    else if (!br.get(P[p + 6])) {
        if (!br.get(P[p + 7])) v = 5 + br.get(159);
        else { v = 7 + 2 * br.get(165); v += br.get(145); }
    } else {
        const bit1 = br.get(P[p + 8]), bit0 = br.get(P[p + 9 + bit1]), cat = 2 * bit1 + bit0;
        v = 0;
        for (const pr of CATS[cat]) v += v + br.get(pr);
        v += 3 + (8 << cat);
    }
    return v;
}
/** GetCoeffs de libwebp : rend l'indice (dans l'ordre zigzag) qui suit le dernier coefficient non nul ; écrit dans `sortie` en ordre raster, déquantifié. */
function lireCoeffs(br, P, t, ctx, dq0, dq1, n, sortie, so) {
    let p = ((t * 8 + BANDS[n]) * 3 + ctx) * 11;
    for (; n < 16; n++) {
        if (!br.get(P[p])) return n;
        while (!br.get(P[p + 1])) { n++; p = (t * 8 + BANDS[n]) * 33; if (n === 16) return 16; }
        const pn = (t * 8 + BANDS[n + 1]) * 33;
        let v;
        if (!br.get(P[p + 2])) { v = 1; p = pn + 11; } else { v = grandeValeur(br, P, p); p = pn + 22; }
        sortie[so + ZIGZAG[n]] = (br.get(0x80) ? -v : v) * (n > 0 ? dq1 : dq0);
    }
    return 16;
}

// ── transformées entières (dsp/dec.c)
const MUL1 = a => (((a * 20091) >> 16) + a), MUL2 = a => ((a * 35468) >> 16);
function transformeWHT(inn, io, sortie) {   // inn : 16 valeurs ; sortie : les DC des 16 blocs (pas de 16)
    const tmp = new Int32Array(16);
    for (let i = 0; i < 4; i++) {
        const a0 = inn[io + i] + inn[io + 12 + i], a1 = inn[io + 4 + i] + inn[io + 8 + i], a2 = inn[io + 4 + i] - inn[io + 8 + i], a3 = inn[io + i] - inn[io + 12 + i];
        tmp[i] = a0 + a1; tmp[8 + i] = a0 - a1; tmp[4 + i] = a3 + a2; tmp[12 + i] = a3 - a2;
    }
    for (let i = 0; i < 4; i++) {
        const dc = tmp[i * 4] + 3, a0 = dc + tmp[3 + i * 4], a1 = tmp[1 + i * 4] + tmp[2 + i * 4], a2 = tmp[1 + i * 4] - tmp[2 + i * 4], a3 = dc - tmp[3 + i * 4];
        sortie[(i * 4) * 16] = (a0 + a1) >> 3; sortie[(i * 4 + 1) * 16] = (a3 + a2) >> 3; sortie[(i * 4 + 2) * 16] = (a0 - a1) >> 3; sortie[(i * 4 + 3) * 16] = (a3 - a2) >> 3;
    }
}
const C16 = new Int32Array(16);
function ajouterTransformee(co, co0, plan, po, stride) {   // TransformOne : ajoute la transformée inverse au bloc 4x4 déjà prédit
    for (let i = 0; i < 4; i++) {
        const a = co[co0 + i] + co[co0 + 8 + i], b = co[co0 + i] - co[co0 + 8 + i];
        const c = MUL2(co[co0 + 4 + i]) - MUL1(co[co0 + 12 + i]), d = MUL1(co[co0 + 4 + i]) + MUL2(co[co0 + 12 + i]);
        C16[4 * i] = a + d; C16[4 * i + 1] = b + c; C16[4 * i + 2] = b - c; C16[4 * i + 3] = a - d;
    }
    for (let i = 0; i < 4; i++) {
        const dc = C16[i] + 4, a = dc + C16[8 + i], b = dc - C16[8 + i];
        const c = MUL2(C16[4 + i]) - MUL1(C16[12 + i]), d = MUL1(C16[4 + i]) + MUL2(C16[12 + i]);
        const o = po + i * stride;
        plan[o] = clip8(plan[o] + ((a + d) >> 3)); plan[o + 1] = clip8(plan[o + 1] + ((b + c) >> 3));
        plan[o + 2] = clip8(plan[o + 2] + ((b - c) >> 3)); plan[o + 3] = clip8(plan[o + 3] + ((a - d) >> 3));
    }
}

/** Décode un WebP avec perte en RGB. Rend { largeur, hauteur, rgb, orientationLue }. */
export function decoderWebp(b, { coteMax = 4096, pixelsMax = 12000000 } = {}) {
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    const liste = chunks(b);
    let vp8 = null, canvas = null;
    for (const c of liste) {
        if (c.type === 'VP8L') refuser('NON_SUPPORTE', 'WebP sans perte (VP8L)');
        if (c.type === 'ANIM' || c.type === 'ANMF') refuser('NON_SUPPORTE', 'WebP animé');
        if (c.type === 'VP8 ') { if (vp8) refuser('DECODAGE', 'deux images'); vp8 = c; }
        if (c.type === 'VP8X') { if (c.taille < 10) refuser('DECODAGE', 'VP8X invalide'); if (b[c.debut] & 2) refuser('NON_SUPPORTE', 'WebP animé'); canvas = { w: u24le(b, c.debut + 4) + 1, h: u24le(b, c.debut + 7) + 1 }; }
    }
    if (!vp8) refuser('DECODAGE', 'aucune image VP8');
    const f = b.subarray(vp8.debut, vp8.debut + vp8.taille);
    if (f.length < 10) refuser('DECODAGE', 'trame trop courte');
    const bits = f[0] | (f[1] << 8) | (f[2] << 16);
    if (bits & 1) refuser('NON_SUPPORTE', 'trame non clé');
    if (((bits >> 1) & 7) > 3) refuser('NON_SUPPORTE', 'profil VP8 inconnu');
    if (!((bits >> 4) & 1)) refuser('NON_SUPPORTE', 'trame non affichable');
    const part0 = bits >>> 5;
    if (f[3] !== 0x9d || f[4] !== 0x01 || f[5] !== 0x2a) refuser('DECODAGE', 'signature VP8 invalide');
    const W = (f[6] | (f[7] << 8)) & 0x3fff, H = (f[8] | (f[9] << 8)) & 0x3fff;
    if (!(W >= 1 && H >= 1)) refuser('DECODAGE', 'dimension nulle');
    if (W > coteMax || H > coteMax || W * H > pixelsMax) refuser('TROP_GRAND', `${W} x ${H}`);
    if (canvas && (canvas.w !== W || canvas.h !== H)) refuser('DECODAGE', 'canevas différent de la trame');
    if (part0 > f.length - 10) refuser('DECODAGE', 'première partition tronquée');
    const mbw = (W + 15) >> 4, mbh = (H + 15) >> 4;
    const br = new Lecteur(f, 10, 10 + part0);

    // ── en-têtes
    if (br.valeur(2)) refuser('NON_SUPPORTE', 'bits réservés (espace colorimétrique / écrêtage)');
    const seg = { actif: br.get(0x80), majMap: 0, abs: 0, q: [0, 0, 0, 0], lf: [0, 0, 0, 0], probas: [255, 255, 255] };
    if (seg.actif) {
        seg.majMap = br.get(0x80);
        if (br.get(0x80)) {
            seg.abs = br.get(0x80);
            for (let s = 0; s < 4; s++) seg.q[s] = br.get(0x80) ? br.signee(7) : 0;
            for (let s = 0; s < 4; s++) seg.lf[s] = br.get(0x80) ? br.signee(6) : 0;
        }
        if (seg.majMap) for (let s = 0; s < 3; s++) seg.probas[s] = br.get(0x80) ? br.valeur(8) : 255;
    }
    const lf = { simple: br.get(0x80), niveau: br.valeur(6), nettete: br.valeur(3), deltas: br.get(0x80), ref: [0, 0, 0, 0], mode: [0, 0, 0, 0] };
    if (lf.deltas && br.get(0x80)) {
        for (let i = 0; i < 4; i++) if (br.get(0x80)) lf.ref[i] = br.signee(6);
        for (let i = 0; i < 4; i++) if (br.get(0x80)) lf.mode[i] = br.signee(6);
    }
    const filtre = lf.niveau === 0 ? 0 : lf.simple ? 1 : 2;
    // partitions de jetons
    const nparts = 1 << br.valeur(2);
    let off = 10 + part0;
    const tailleFin = f.length;
    const tailles = 3 * (nparts - 1);
    if (off + tailles > tailleFin) refuser('DECODAGE', 'tailles de partitions tronquées');
    let debutPart = off + tailles;
    const parts = [];
    for (let i = 0; i < nparts; i++) {
        const sz = i < nparts - 1 ? u24le(f, off + 3 * i) : Math.max(0, tailleFin - debutPart);
        if (debutPart + sz > tailleFin) refuser('DECODAGE', 'partition tronquée');
        parts.push(new Lecteur(f, debutPart, debutPart + sz));
        debutPart += sz;
    }
    // quantification
    const base = br.valeur(7);
    const dqy1dc = br.get(0x80) ? br.signee(4) : 0, dqy2dc = br.get(0x80) ? br.signee(4) : 0, dqy2ac = br.get(0x80) ? br.signee(4) : 0, dquvdc = br.get(0x80) ? br.signee(4) : 0, dquvac = br.get(0x80) ? br.signee(4) : 0;
    const cl = (v, m) => (v < 0 ? 0 : v > m ? m : v);
    const dqm = [];
    for (let i = 0; i < 4; i++) {
        let q;
        if (seg.actif) { q = seg.q[i]; if (!seg.abs) q += base; } else q = base;
        const y2ac = Math.floor((AC_Q[cl(q + dqy2ac, 127)] * 101581) / 65536);
        dqm.push({ y1: [DC_Q[cl(q + dqy1dc, 127)], AC_Q[cl(q, 127)]], y2: [DC_Q[cl(q + dqy2dc, 127)] * 2, y2ac < 8 ? 8 : y2ac], uv: [DC_Q[cl(q + dquvdc, 117)], AC_Q[cl(q + dquvac, 127)]] });
    }
    br.get(0x80);        // refresh_entropy_probs : sans effet sur une image fixe
    const P = new Uint8Array(1056);
    for (let i = 0; i < 1056; i++) P[i] = br.get(COEFF_UPDATE_PROBS[i]) ? br.valeur(8) : COEFF_PROBS[i];
    const utiliseSkip = br.get(0x80), probaSkip = utiliseSkip ? br.valeur(8) : 0;
    if (br.eof) refuser('DECODAGE', 'en-tête tronqué');

    // forces de filtrage par segment
    const forces = [];
    for (let s = 0; s < 4; s++) {
        let niveauBase;
        if (seg.actif) { niveauBase = seg.lf[s]; if (!seg.abs) niveauBase += lf.niveau; } else niveauBase = lf.niveau;
        const deux = [];
        for (let i4 = 0; i4 <= 1; i4++) {
            let niveau = niveauBase;
            if (lf.deltas) { niveau += lf.ref[0]; if (i4) niveau += lf.mode[0]; }
            niveau = niveau < 0 ? 0 : niveau > 63 ? 63 : niveau;
            const info = { limite: 0, ilevel: 0, hev: 0, interne: i4 };
            if (niveau > 0) {
                let il = niveau;
                if (lf.nettete > 0) { il >>= lf.nettete > 4 ? 2 : 1; if (il > 9 - lf.nettete) il = 9 - lf.nettete; }
                if (il < 1) il = 1;
                info.ilevel = il; info.limite = 2 * niveau + il; info.hev = niveau >= 40 ? 2 : niveau >= 15 ? 1 : 0;
            }
            deux.push(info);
        }
        forces.push(deux);
    }

    // ── macroblocs : modes, jetons, reconstruction (prédiction + résidu) sur des plans NON filtrés, puis filtre de boucle sur l'image entière
    const sY = mbw * 16, sC = mbw * 8, Y = new Uint8Array(sY * mbh * 16), U = new Uint8Array(sC * mbh * 8), V = new Uint8Array(sC * mbh * 8);
    const topModes = new Uint8Array(mbw * 4), leftModes = new Uint8Array(4);
    const topY = new Uint8Array(mbw * 4), leftY = new Uint8Array(4), topC = [new Uint8Array(mbw * 2), new Uint8Array(mbw * 2)], leftC = [new Uint8Array(2), new Uint8Array(2)];
    const topDc = new Uint8Array(mbw);
    const infos = new Array(mbw * mbh);
    const co = new Int16Array(384), dcw = new Int16Array(16), imodes = new Uint8Array(16);
    const T8 = new Uint8Array(8), L4 = new Uint8Array(4);
    for (let my = 0; my < mbh; my++) {
        const token = parts[my & (nparts - 1)];
        let leftDc = 0;
        leftModes.fill(B_DC); leftY.fill(0); leftC[0].fill(0); leftC[1].fill(0);
        for (let mx = 0; mx < mbw; mx++) {
            // 1. modes (première partition)
            let segment = 0, skip = 0;
            if (seg.majMap) segment = !br.get(seg.probas[0]) ? br.get(seg.probas[1]) : br.get(seg.probas[2]) + 2;
            if (utiliseSkip) skip = br.get(probaSkip);
            const i4 = !br.get(145);
            let ymode = 0;
            if (!i4) {
                ymode = br.get(156) ? (br.get(128) ? TM_PRED : H_PRED) : (br.get(163) ? V_PRED : DC_PRED);
                for (let i = 0; i < 4; i++) { topModes[mx * 4 + i] = VERS_B[ymode]; leftModes[i] = VERS_B[ymode]; }
            } else {
                for (let y = 0; y < 4; y++) {
                    let m = leftModes[y];
                    for (let x = 0; x < 4; x++) {
                        const pr = ((topModes[mx * 4 + x] * 10) + m) * 9;
                        let i = 0;
                        do { i = B_TREE[i + br.get(KF_BMODE_PROBS[pr + (i >> 1)])]; } while (i > 0);
                        m = -i; topModes[mx * 4 + x] = m; imodes[y * 4 + x] = m;
                    }
                    leftModes[y] = m;
                }
            }
            const uvmode = !br.get(142) ? DC_PRED : !br.get(114) ? V_PRED : br.get(183) ? TM_PRED : H_PRED;
            // 2. jetons (partition de jetons de cette rangée)
            co.fill(0);
            let nonNul = 0;
            if (!skip) {
                const q = dqm[segment];
                let first = 0, tY = 3;
                if (!i4) {
                    dcw.fill(0);
                    const nz = lireCoeffs(token, P, 1, topDc[mx] + leftDc, q.y2[0], q.y2[1], 0, dcw, 0);
                    topDc[mx] = leftDc = nz > 0 ? 1 : 0;
                    if (nz > 1) transformeWHT(dcw, 0, co);
                    else { const dc0 = (dcw[0] + 3) >> 3; for (let i = 0; i < 256; i += 16) co[i] = dc0; }
                    first = 1; tY = 0;
                }
                for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
                    const bo = (y * 4 + x) * 16;
                    const nz = lireCoeffs(token, P, tY, leftY[y] + topY[mx * 4 + x], q.y1[0], q.y1[1], first, co, bo);
                    leftY[y] = topY[mx * 4 + x] = nz > first ? 1 : 0;
                    if (nz > 1 || co[bo] !== 0) nonNul = 1;
                }
                for (let pl = 0; pl < 2; pl++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
                    const bo = 256 + (pl * 4 + y * 2 + x) * 16;
                    const nz = lireCoeffs(token, P, 2, leftC[pl][y] + topC[pl][mx * 2 + x], q.uv[0], q.uv[1], 0, co, bo);
                    leftC[pl][y] = topC[pl][mx * 2 + x] = nz > 0 ? 1 : 0;
                    if (nz > 1 || co[bo] !== 0) nonNul = 1;
                }
            } else {
                for (let i = 0; i < 4; i++) { leftY[i] = 0; topY[mx * 4 + i] = 0; }
                for (let pl = 0; pl < 2; pl++) for (let i = 0; i < 2; i++) { leftC[pl][i] = 0; topC[pl][mx * 2 + i] = 0; }
                if (!i4) { topDc[mx] = 0; leftDc = 0; }
            }
            if (token.eof) refuser('DECODAGE', 'données de jetons tronquées');
            infos[my * mbw + mx] = { segment, i4: i4 ? 1 : 0, skip, nonNul };

            // 3. reconstruction
            const x0 = mx * 16, y0 = my * 16;
            if (!i4) {
                predireBloc(Y, sY, x0, y0, 16, ymode, mx, my);
                for (let b = 0; b < 16; b++) if (blocNonNul(co, b * 16)) ajouterTransformee(co, b * 16, Y, (y0 + (b >> 2) * 4) * sY + x0 + (b & 3) * 4, sY);
            } else {
                for (let b = 0; b < 16; b++) {
                    const bx = b & 3, by = b >> 2, x = x0 + bx * 4, y = y0 + by * 4;
                    // voisins : haut (8 pixels, dont le haut-droite), haut-gauche, gauche
                    for (let i = 0; i < 4; i++) T8[i] = y === 0 ? 127 : Y[(y - 1) * sY + x + i];
                    if (by === 0 || bx < 3) {
                        for (let i = 4; i < 8; i++) {
                            if (y === 0) T8[i] = 127;
                            else if (by === 0 && bx === 3 && mx === mbw - 1) T8[i] = Y[(y - 1) * sY + x + 3];
                            else T8[i] = Y[(y - 1) * sY + x + i];
                        }
                    } else {      // by > 0, bx === 3 : le haut-droite du macrobloc, répété
                        for (let i = 4; i < 8; i++) {
                            if (y0 === 0) T8[i] = 127;
                            else if (mx === mbw - 1) T8[i] = Y[(y0 - 1) * sY + x0 + 15];
                            else T8[i] = Y[(y0 - 1) * sY + x0 + 16 + (i - 4)];
                        }
                    }
                    const tl = y === 0 ? 127 : x === 0 ? 129 : Y[(y - 1) * sY + x - 1];
                    for (let i = 0; i < 4; i++) L4[i] = x === 0 ? 129 : Y[(y + i) * sY + x - 1];
                    predire4(imodes[b], Y, y * sY + x, sY, T8, tl, L4);
                    if (blocNonNul(co, b * 16)) ajouterTransformee(co, b * 16, Y, y * sY + x, sY);
                }
            }
            const cx = mx * 8, cy = my * 8;
            for (let pl = 0; pl < 2; pl++) {
                const plan = pl ? V : U;
                predireBloc(plan, sC, cx, cy, 8, uvmode, mx, my);
                for (let b = 0; b < 4; b++) { const bo = 256 + (pl * 4 + b) * 16; if (blocNonNul(co, bo)) ajouterTransformee(co, bo, plan, (cy + (b >> 1) * 4) * sC + cx + (b & 1) * 4, sC); }
            }
        }
        if (br.eof) refuser('DECODAGE', 'modes tronqués');
    }

    // ── filtre de boucle, macroblocs en ordre raster
    if (filtre) {
        for (let my = 0; my < mbh; my++) for (let mx = 0; mx < mbw; mx++) {
            const inf = infos[my * mbw + mx], f = forces[inf.segment][inf.i4];
            if (f.limite === 0) continue;
            const interne = f.interne || (!inf.skip && inf.nonNul) ? 1 : 0;
            filtrerMb(filtre, Y, U, V, sY, sC, mx, my, f, interne);
        }
    }
    return { largeur: W, hauteur: H, rgb: yuvVersRgb(Y, sY, U, V, sC, W, H), orientationLue: 0 };
}

const blocNonNul = (co, o) => { for (let i = 0; i < 16; i++) if (co[o + i] !== 0) return true; return false; };

// ── prédiction 16x16 (luma) ou 8x8 (chroma) : DC, V, H, TM ; bords : 127 en haut, 129 à gauche (libwebp)
function predireBloc(plan, stride, x0, y0, n, mode, mx, my) {
    const base = y0 * stride + x0;
    if (mode === DC_PRED) {
        const lg = n === 16 ? 4 : 3;
        let s = 0, dc;
        if (my > 0 && mx > 0) { for (let i = 0; i < n; i++) s += plan[base - stride + i] + plan[base + i * stride - 1]; dc = (s + n) >> (lg + 1); }
        else if (my > 0) { for (let i = 0; i < n; i++) s += plan[base - stride + i]; dc = (s + (n >> 1)) >> lg; }
        else if (mx > 0) { for (let i = 0; i < n; i++) s += plan[base + i * stride - 1]; dc = (s + (n >> 1)) >> lg; }
        else dc = 128;
        for (let y = 0; y < n; y++) plan.fill(dc, base + y * stride, base + y * stride + n);
    } else if (mode === V_PRED) {
        for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) plan[base + y * stride + x] = my > 0 ? plan[base - stride + x] : 127;
    } else if (mode === H_PRED) {
        for (let y = 0; y < n; y++) plan.fill(mx > 0 ? plan[base + y * stride - 1] : 129, base + y * stride, base + y * stride + n);
    } else {      // TM_PRED
        const tl = my === 0 ? 127 : mx === 0 ? 129 : plan[base - stride - 1];
        for (let y = 0; y < n; y++) {
            const l = mx > 0 ? plan[base + y * stride - 1] : 129;
            for (let x = 0; x < n; x++) plan[base + y * stride + x] = clip8(l + (my > 0 ? plan[base - stride + x] : 127) - tl);
        }
    }
}
// ── prédiction 4x4 (RFC 6386 §12.3, formules de libwebp) : T = 8 pixels du haut (A..H), tl = X, L = 4 pixels de gauche (I..L)
function predire4(mode, plan, o, stride, T, X, L) {
    const A = T[0], B = T[1], C = T[2], D = T[3], E = T[4], F = T[5], G = T[6], H = T[7], I = L[0], J = L[1], K = L[2], Lq = L[3];
    const avg3 = (a, b, c) => (a + 2 * b + c + 2) >> 2, avg2 = (a, b) => (a + b + 1) >> 1;
    const S = (x, y, v) => { plan[o + x + y * stride] = v; };
    switch (mode) {
        case B_DC: { const dc = (A + B + C + D + I + J + K + Lq + 4) >> 3; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) S(x, y, dc); break; }
        case B_TM: for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) S(x, y, clip8(L[y] + T[x] - X)); break;
        case B_VE: { const v = [avg3(X, A, B), avg3(A, B, C), avg3(B, C, D), avg3(C, D, E)]; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) S(x, y, v[x]); break; }
        case B_HE: { const r = [avg3(X, I, J), avg3(I, J, K), avg3(J, K, Lq), avg3(K, Lq, Lq)]; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) S(x, y, r[y]); break; }
        case B_LD:
            S(0, 0, avg3(A, B, C)); S(1, 0, avg3(B, C, D)); S(0, 1, avg3(B, C, D));
            S(2, 0, avg3(C, D, E)); S(1, 1, avg3(C, D, E)); S(0, 2, avg3(C, D, E));
            S(3, 0, avg3(D, E, F)); S(2, 1, avg3(D, E, F)); S(1, 2, avg3(D, E, F)); S(0, 3, avg3(D, E, F));
            S(3, 1, avg3(E, F, G)); S(2, 2, avg3(E, F, G)); S(1, 3, avg3(E, F, G));
            S(3, 2, avg3(F, G, H)); S(2, 3, avg3(F, G, H)); S(3, 3, avg3(G, H, H));
            break;
        case B_RD:
            S(0, 3, avg3(J, K, Lq));
            S(1, 3, avg3(I, J, K)); S(0, 2, avg3(I, J, K));
            S(2, 3, avg3(X, I, J)); S(1, 2, avg3(X, I, J)); S(0, 1, avg3(X, I, J));
            S(3, 3, avg3(A, X, I)); S(2, 2, avg3(A, X, I)); S(1, 1, avg3(A, X, I)); S(0, 0, avg3(A, X, I));
            S(3, 2, avg3(B, A, X)); S(2, 1, avg3(B, A, X)); S(1, 0, avg3(B, A, X));
            S(3, 1, avg3(C, B, A)); S(2, 0, avg3(C, B, A));
            S(3, 0, avg3(D, C, B));
            break;
        case B_VR:
            S(0, 0, avg2(X, A)); S(1, 2, avg2(X, A));
            S(1, 0, avg2(A, B)); S(2, 2, avg2(A, B));
            S(2, 0, avg2(B, C)); S(3, 2, avg2(B, C));
            S(3, 0, avg2(C, D));
            S(0, 3, avg3(K, J, I));
            S(0, 2, avg3(J, I, X));
            S(0, 1, avg3(I, X, A)); S(1, 3, avg3(I, X, A));
            S(1, 1, avg3(X, A, B)); S(2, 3, avg3(X, A, B));
            S(2, 1, avg3(A, B, C)); S(3, 3, avg3(A, B, C));
            S(3, 1, avg3(B, C, D));
            break;
        case B_VL:
            S(0, 0, avg2(A, B));
            S(1, 0, avg2(B, C)); S(0, 2, avg2(B, C));
            S(2, 0, avg2(C, D)); S(1, 2, avg2(C, D));
            S(3, 0, avg2(D, E)); S(2, 2, avg2(D, E));
            S(0, 1, avg3(A, B, C));
            S(1, 1, avg3(B, C, D)); S(0, 3, avg3(B, C, D));
            S(2, 1, avg3(C, D, E)); S(1, 3, avg3(C, D, E));
            S(3, 1, avg3(D, E, F)); S(2, 3, avg3(D, E, F));
            S(3, 2, avg3(E, F, G));
            S(3, 3, avg3(F, G, H));
            break;
        case B_HD:
            S(0, 0, avg2(I, X)); S(2, 1, avg2(I, X));
            S(0, 1, avg2(J, I)); S(2, 2, avg2(J, I));
            S(0, 2, avg2(K, J)); S(2, 3, avg2(K, J));
            S(0, 3, avg2(Lq, K));
            S(3, 0, avg3(A, B, C));
            S(2, 0, avg3(X, A, B));
            S(1, 0, avg3(I, X, A)); S(3, 1, avg3(I, X, A));
            S(1, 1, avg3(J, I, X)); S(3, 2, avg3(J, I, X));
            S(1, 2, avg3(K, J, I)); S(3, 3, avg3(K, J, I));
            S(1, 3, avg3(Lq, K, J));
            break;
        default:      // B_HU
            S(0, 0, avg2(I, J));
            S(2, 0, avg2(J, K)); S(0, 1, avg2(J, K));
            S(2, 1, avg2(K, Lq)); S(0, 2, avg2(K, Lq));
            S(1, 0, avg3(I, J, K));
            S(3, 0, avg3(J, K, Lq)); S(1, 1, avg3(J, K, Lq));
            S(3, 1, avg3(K, Lq, Lq)); S(1, 2, avg3(K, Lq, Lq));
            S(3, 2, Lq); S(2, 2, Lq); S(0, 3, Lq); S(1, 3, Lq); S(2, 3, Lq); S(3, 3, Lq);
    }
}

// ── filtres de boucle (dsp/dec.c)
const sclip1 = v => (v < -128 ? -128 : v > 127 ? 127 : v), sclip2 = v => (v < -16 ? -16 : v > 15 ? 15 : v);
const abs0 = v => (v < 0 ? -v : v);
function doFilter2(p, i, s) {
  const p1 = p[i - 2 * s], p0 = p[i - s], q0 = p[i], q1 = p[i + s];
  const a = 3 * (q0 - p0) + sclip1(p1 - q1), a1 = sclip2((a + 4) >> 3), a2 = sclip2((a + 3) >> 3);
  p[i - s] = clip8(p0 + a2); p[i] = clip8(q0 - a1);
}
function doFilter4(p, i, s) {
  const p1 = p[i - 2 * s], p0 = p[i - s], q0 = p[i], q1 = p[i + s];
  const a = 3 * (q0 - p0), a1 = sclip2((a + 4) >> 3), a2 = sclip2((a + 3) >> 3), a3 = (a1 + 1) >> 1;
  p[i - 2 * s] = clip8(p1 + a3); p[i - s] = clip8(p0 + a2); p[i] = clip8(q0 - a1); p[i + s] = clip8(q1 - a3);
}
function doFilter6(p, i, s) {
  const p2 = p[i - 3 * s], p1 = p[i - 2 * s], p0 = p[i - s], q0 = p[i], q1 = p[i + s], q2 = p[i + 2 * s];
  const a = sclip1(3 * (q0 - p0) + sclip1(p1 - q1)), a1 = (27 * a + 63) >> 7, a2 = (18 * a + 63) >> 7, a3 = (9 * a + 63) >> 7;
  p[i - 3 * s] = clip8(p2 + a3); p[i - 2 * s] = clip8(p1 + a2); p[i - s] = clip8(p0 + a1); p[i] = clip8(q0 - a1); p[i + s] = clip8(q1 - a2); p[i + 2 * s] = clip8(q2 - a3);
}
const hev = (p, i, s, t) => abs0(p[i - 2 * s] - p[i - s]) > t || abs0(p[i + s] - p[i]) > t;
const besoin = (p, i, s, t) => 4 * abs0(p[i - s] - p[i]) + abs0(p[i - 2 * s] - p[i + s]) <= t;
function besoin2(p, i, s, t, it) {
  if (4 * abs0(p[i - s] - p[i]) + abs0(p[i - 2 * s] - p[i + s]) > t) return false;
  return abs0(p[i - 4 * s] - p[i - 3 * s]) <= it && abs0(p[i - 3 * s] - p[i - 2 * s]) <= it && abs0(p[i - 2 * s] - p[i - s]) <= it && abs0(p[i + 3 * s] - p[i + 2 * s]) <= it && abs0(p[i + 2 * s] - p[i + s]) <= it && abs0(p[i + s] - p[i]) <= it;
}
function simple(p, i, hs, vs, n, thresh) { const t2 = 2 * thresh + 1; for (let k = 0; k < n; k++, i += vs) if (besoin(p, i, hs, t2)) doFilter2(p, i, hs); }
function boucle26(p, i, hs, vs, n, thresh, ithresh, hthresh) { const t2 = 2 * thresh + 1; for (let k = 0; k < n; k++, i += vs) if (besoin2(p, i, hs, t2, ithresh)) { if (hev(p, i, hs, hthresh)) doFilter2(p, i, hs); else doFilter6(p, i, hs); } }
function boucle24(p, i, hs, vs, n, thresh, ithresh, hthresh) { const t2 = 2 * thresh + 1; for (let k = 0; k < n; k++, i += vs) if (besoin2(p, i, hs, t2, ithresh)) { if (hev(p, i, hs, hthresh)) doFilter2(p, i, hs); else doFilter4(p, i, hs); } }
function filtrerMb(type, Y, U, V, sY, sC, mx, my, f, interne) {
  const yo = my * 16 * sY + mx * 16, co = my * 8 * sC + mx * 8, limite = f.limite, il = f.ilevel, ht = f.hev;
  if (type === 1) {
    if (mx > 0) simple(Y, yo, 1, sY, 16, limite + 4);
    if (interne) for (let k = 4; k <= 12; k += 4) simple(Y, yo + k, 1, sY, 16, limite);
    if (my > 0) simple(Y, yo, sY, 1, 16, limite + 4);
    if (interne) for (let k = 4; k <= 12; k += 4) simple(Y, yo + k * sY, sY, 1, 16, limite);
    return;
  }
  if (mx > 0) { boucle26(Y, yo, 1, sY, 16, limite + 4, il, ht); boucle26(U, co, 1, sC, 8, limite + 4, il, ht); boucle26(V, co, 1, sC, 8, limite + 4, il, ht); }
  if (interne) {
    for (let k = 4; k <= 12; k += 4) boucle24(Y, yo + k, 1, sY, 16, limite, il, ht);
    boucle24(U, co + 4, 1, sC, 8, limite, il, ht); boucle24(V, co + 4, 1, sC, 8, limite, il, ht);
  }
  if (my > 0) { boucle26(Y, yo, sY, 1, 16, limite + 4, il, ht); boucle26(U, co, sC, 1, 8, limite + 4, il, ht); boucle26(V, co, sC, 1, 8, limite + 4, il, ht); }
  if (interne) {
    for (let k = 4; k <= 12; k += 4) boucle24(Y, yo + k * sY, sY, 1, 16, limite, il, ht);
    boucle24(U, co + 4 * sC, sC, 1, 8, limite, il, ht); boucle24(V, co + 4 * sC, sC, 1, 8, limite, il, ht);
  }
}

// ── YUV 4:2:0 -> RGB : sur-échantillonnage « fancy » (upsampling.c) et conversion en virgule fixe (yuv.h)
const mh = (v, c) => (v * c) >> 8;
function yuvVersRgb(Y, sY, U, V, sC, W, H) {
    const rgb = new Uint8Array(W * H * 3), uvw = (W + 1) >> 1, uvh = (H + 1) >> 1;
    const pixel = (y, u, v, o) => {
        const m = mh(y, 19077);
        rgb[o] = clip8((m + mh(v, 26149) - 14234) >> 6); rgb[o + 1] = clip8((m - mh(u, 6419) - mh(v, 13320) + 8708) >> 6); rgb[o + 2] = clip8((m + mh(u, 33050) - 17685) >> 6);
    };
    for (let y = 0; y < H; y++) {
        let top, cur, rolehaut;
        if (y === 0) { top = cur = 0; rolehaut = true; }
        else if (y & 1) { const k = (y + 1) >> 1; top = k - 1; cur = k < uvh ? k : k - 1; rolehaut = true; }
        else { const k = y >> 1; top = k - 1; cur = k; rolehaut = false; }
        const yo = y * sY, to = top * sC, cu = cur * sC, ro = y * W * 3;
        const un = (plan, i) => plan[to + i], cn = (plan, i) => plan[cu + i];
        // pixel 0
        {
            const u = rolehaut ? (3 * un(U, 0) + cn(U, 0) + 2) >> 2 : (3 * cn(U, 0) + un(U, 0) + 2) >> 2, v = rolehaut ? (3 * un(V, 0) + cn(V, 0) + 2) >> 2 : (3 * cn(V, 0) + un(V, 0) + 2) >> 2;
            pixel(Y[yo], u, v, ro);
        }
        const dernierePaire = (W - 1) >> 1;
        for (let x = 1; x <= dernierePaire; x++) {
            const f2 = (plan) => {
                const tl = un(plan, x - 1), t = un(plan, x), l = cn(plan, x - 1), c = cn(plan, x), avg = tl + t + l + c + 8;
                const d12 = (avg + 2 * (t + l)) >> 3, d03 = (avg + 2 * (tl + c)) >> 3;
                return rolehaut ? [(d12 + tl) >> 1, (d03 + t) >> 1] : [(d03 + l) >> 1, (d12 + c) >> 1];
            };
            const [u0, u1] = f2(U), [v0, v1] = f2(V);
            pixel(Y[yo + 2 * x - 1], u0, v0, ro + (2 * x - 1) * 3);
            pixel(Y[yo + 2 * x], u1, v1, ro + (2 * x) * 3);
        }
        if (!(W & 1)) {
            const last = dernierePaire;
            const g = plan => (rolehaut ? (3 * un(plan, last) + cn(plan, last) + 2) >> 2 : (3 * cn(plan, last) + un(plan, last) + 2) >> 2);
            pixel(Y[yo + W - 1], g(U), g(V), ro + (W - 1) * 3);
        }
    }
    void uvw;
    return rgb;
}
