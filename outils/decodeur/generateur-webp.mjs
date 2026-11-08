// GÉNÉRATEUR DIFFÉRENTIEL DE FLUX VP8 (banc seulement, jamais servi) : fabrique des WebP « avec perte » à en-têtes et syntaxe ALÉATOIRES mais valides pour libwebp, pour les comparer à Pillow.
// Principe : un ORACLE joue le rôle du lecteur booléen dans le décodeur lui-même (decoderTrame) : à chaque décision il tire un bit selon sa probabilité et l'ÉCRIT dans un encodeur booléen (RFC 6386 §7.3).
// L'en-tête, lui, est écrit à part par ecrireEntetes, symétrique de lireEntetesBruts : les drapeaux rares (filtre simple, plusieurs partitions, netteté, deltas de filtre, segments absolus ou relatifs,
// carte de segments, saut de macrobloc, mises à jour de probabilités) sont tirés au hasard. Le flux obtenu est ensuite décodé PAR PILLOW (libwebp) : si le décodeur et libwebp lisent la syntaxe
// différemment, les octets diffèrent. Les coefficients sont bornés (crochet) pour rester dans la zone où les versions SIMD de libwebp sont identiques au C.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const W = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'decodeur-webp.mjs')).href);
const T = await import(pathToFileURL(path.join(import.meta.dirname, '..', '..', 'v2', 'banc-telephone', 'public', 'decodeur-webp-tables.mjs')).href);

export function alea(graine) { let a = graine >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** L'encodeur booléen de la RFC 6386 (§7.3). */
export class Encodeur {
    constructor() { this.out = []; this.range = 255; this.bottom = 0; this.bitCount = 24; }
    carry() { let i = this.out.length - 1; while (i >= 0 && this.out[i] === 255) { this.out[i] = 0; i--; } if (i >= 0) this.out[i]++; }
    put(bit, prob) {
        const split = 1 + (((this.range - 1) * prob) >> 8);
        if (bit) { this.bottom = (this.bottom + split) >>> 0; this.range -= split; } else this.range = split;
        while (this.range < 128) {
            this.range <<= 1;
            if (this.bottom & 0x80000000) this.carry();
            this.bottom = (this.bottom << 1) >>> 0;
            if (!--this.bitCount) { this.out.push(this.bottom >>> 24); this.bottom &= 0xffffff; this.bitCount = 8; }
        }
    }
    finish() {
        for (let i = 0; i < 32; i++) this.put(0, 128);      // le remplissage de libvpx (stop_encode) : le lecteur de libwebp veut 8 bits d'avance sur le dernier symbole
        let c = this.bitCount, v = this.bottom;
        if (v & (1 << (32 - c))) this.carry();
        v = (v << (c & 7)) >>> 0; c >>= 3;
        while (--c >= 0) v = (v << 8) >>> 0;
        c = 4;
        while (--c >= 0) { this.out.push(v >>> 24); v = (v << 8) >>> 0; }
        return Uint8Array.from(this.out);
    }
}
/** L'oracle : même interface que Lecteur ; chaque bit tiré est écrit dans l'encodeur. */
class Oracle {
    constructor(enc, rnd, biais) { this.enc = enc; this.rnd = rnd; this.biais = biais; this.eof = false; }
    get(prob) { const bit = this.rnd() < ((256 - prob) / 256) * this.biais ? 1 : 0; this.enc.put(bit, prob); return bit; }
    valeur(n) { let v = 0; while (n-- > 0) v |= this.get(0x80) << n; return v; }
    signee(n) { const v = this.valeur(n); return this.get(0x80) ? -v : v; }
}

/** Écrit les champs bruts dans l'ordre de lireEntetesBruts. `r.maj*` : drapeaux « mis à jour » tirés par l'appelant. */
export function ecrireEntetes(enc, r) {
    const b = (bit, p = 128) => enc.put(bit ? 1 : 0, p);
    const val = (v, n) => { for (let i = n - 1; i >= 0; i--) b((v >> i) & 1); };
    const sig = (v, n) => { val(Math.abs(v), n); b(v < 0); };
    val(0, 2);
    const { seg, lf } = r;
    b(seg.actif);
    if (seg.actif) {
        b(seg.majMap); b(seg.majData);
        if (seg.majData) {
            b(seg.abs);
            for (let s = 0; s < 4; s++) { b(seg.q[s] !== 0); if (seg.q[s] !== 0) sig(seg.q[s], 7); }
            for (let s = 0; s < 4; s++) { b(seg.lf[s] !== 0); if (seg.lf[s] !== 0) sig(seg.lf[s], 6); }
        }
        if (seg.majMap) for (let s = 0; s < 3; s++) { b(seg.probas[s] !== 255); if (seg.probas[s] !== 255) val(seg.probas[s], 8); }
    }
    b(lf.simple); val(lf.niveau, 6); val(lf.nettete, 3); b(lf.deltas);
    if (lf.deltas) {
        b(lf.majDeltas);
        if (lf.majDeltas) {
            for (let i = 0; i < 4; i++) { b(lf.ref[i] !== 0); if (lf.ref[i] !== 0) sig(lf.ref[i], 6); }
            for (let i = 0; i < 4; i++) { b(lf.mode[i] !== 0); if (lf.mode[i] !== 0) sig(lf.mode[i], 6); }
        }
    }
    val(Math.log2(r.nparts), 2);
    val(r.base, 7);
    for (let i = 0; i < 5; i++) { b(r.dq[i] !== 0); if (r.dq[i] !== 0) sig(r.dq[i], 4); }
    b(r.refresh);
    for (let i = 0; i < 1056; i++) { b(r.upd[i], T.COEFF_UPDATE_PROBS[i]); if (r.upd[i]) val(r.P[i], 8); }
    b(r.utiliseSkip); if (r.utiliseSkip) val(r.probaSkip, 8);
}

class Rejet extends Error { }
/** Un WebP VP8 de largeur w, hauteur h, dont tous les choix de syntaxe viennent de `graine`. Rend { octets, params } ou null si le tirage a dépassé la borne des coefficients (l'appelant réessaie). */
export function genererWebp(graine, w, h, forces = {}) {
    const rnd = alea(graine), ent = (a, z) => a + Math.floor(rnd() * (z - a + 1)), pile = p => rnd() < p;
    const dernier = () => ent(0, 3);
    const abs = forces.abs !== undefined ? forces.abs : pile(0.5);
    const seg = { actif: forces.segActif !== undefined ? forces.segActif : pile(0.6), majMap: 0, majData: 0, abs: abs ? 1 : 0, q: [0, 0, 0, 0], lf: [0, 0, 0, 0], probas: [255, 255, 255] };
    if (seg.actif) {
        seg.majMap = pile(0.6) ? 1 : 0;
        seg.majData = pile(0.8) ? 1 : 0;
        if (seg.majData) for (let s = 0; s < 4; s++) { seg.q[s] = abs ? (pile(0.8) ? ent(0, 127) : 0) : (pile(0.7) ? ent(-30, 30) : 0); seg.lf[s] = abs ? (pile(0.8) ? ent(0, 63) : 0) : (pile(0.7) ? ent(-20, 20) : 0); }
        if (seg.majMap) for (let s = 0; s < 3; s++) seg.probas[s] = pile(0.7) ? ent(1, 254) : 255;
    }
    if (forces.segMajData !== undefined) seg.majData = forces.segMajData;
    if (seg.actif && !seg.majData) { seg.q = [0, 0, 0, 0]; seg.lf = [0, 0, 0, 0]; seg.abs = 1; }   // libwebp : sans mise à jour des données, les valeurs sont ABSOLUES et nulles (ResetSegmentHeader)
    if (forces.segMajMap !== undefined && seg.actif) { seg.majMap = forces.segMajMap; }
    const lf = { simple: forces.simple !== undefined ? forces.simple : (pile(0.4) ? 1 : 0), niveau: forces.niveau !== undefined ? forces.niveau : (pile(0.1) ? 0 : ent(1, 63)), nettete: forces.nettete !== undefined ? forces.nettete : (pile(0.5) ? ent(1, 7) : 0), deltas: forces.deltas !== undefined ? forces.deltas : (pile(0.5) ? 1 : 0), majDeltas: pile(0.8) ? 1 : 0, ref: [0, 0, 0, 0], mode: [0, 0, 0, 0] };
    if (lf.deltas && lf.majDeltas) for (let i = 0; i < 4; i++) { lf.ref[i] = pile(0.6) ? ent(-15, 15) : 0; lf.mode[i] = pile(0.6) ? ent(-15, 15) : 0; }
    const nparts = [1, 2, 4, 8][forces.nlog !== undefined ? forces.nlog : (pile(0.5) ? 0 : ent(1, 3))];
    const base = forces.base !== undefined ? forces.base : ent(0, 127);
    const dq = [0, 0, 0, 0, 0].map(() => (forces.sansDq ? 0 : pile(0.4) ? ent(-15, 15) : 0));
    const P = Uint8Array.from(T.COEFF_PROBS), upd = new Uint8Array(1056), tauxMaj = forces.sansMaj ? 0 : pile(0.5) ? 0 : ent(1, 30) / 100;
    for (let i = 0; i < 1056; i++) if (tauxMaj > 0 && rnd() < tauxMaj) { upd[i] = 1; P[i] = ent(1, 255); }
    const utiliseSkip = forces.skip !== undefined ? forces.skip : (pile(0.6) ? 1 : 0), probaSkip = utiliseSkip ? ent(1, 255) : 0;
    const brut = { seg, lf, nparts, base, dq, P, utiliseSkip, probaSkip, refresh: pile(0.5) ? 1 : 0, upd };
    const E = W.construireEntetes(brut);
    const enc0 = new Encodeur(); ecrireEntetes(enc0, brut);
    const biais = 0.35 + rnd() * 0.65;
    const encs = Array.from({ length: nparts }, () => new Encodeur());
    const br = new Oracle(enc0, rnd, biais), parts = encs.map(e => new Oracle(e, rnd, biais));
    const plafond = forces.plafond !== undefined ? forces.plafond : 300;      // borne PROUVÉE contre Pillow par défaut ; plus haut : mesure d'extension (RM_PLAFOND_COEFF)
    let maxCoeff = 0;
    W.definirCrochetCoeff(v => { const a = v < 0 ? -v : v; if (a > plafond) throw new Rejet(); if (a > maxCoeff) maxCoeff = a; });
    try { W.decoderTrame(E, br, parts, w, h); } catch (e) { if (e instanceof Rejet) return null; throw e; } finally { W.definirCrochetCoeff(null); }
    const p0 = enc0.finish(), jetons = encs.map(e => e.finish());
    if (p0.length >= (1 << 19)) return null;
    const tailleTrame = 10 + p0.length + 3 * (nparts - 1) + jetons.reduce((s, x) => s + x.length, 0);
    const trame = new Uint8Array(tailleTrame); let o = 0;
    const tag = (0) | (0 << 1) | (1 << 4) | (p0.length << 5);
    trame[o++] = tag & 255; trame[o++] = (tag >> 8) & 255; trame[o++] = (tag >> 16) & 255;
    trame.set([0x9d, 0x01, 0x2a, w & 255, (w >> 8) & 0x3f, h & 255, (h >> 8) & 0x3f], o); o += 7;
    trame.set(p0, o); o += p0.length;
    for (let i = 0; i < nparts - 1; i++) { trame[o++] = jetons[i].length & 255; trame[o++] = (jetons[i].length >> 8) & 255; trame[o++] = (jetons[i].length >> 16) & 255; }
    for (const j of jetons) { trame.set(j, o); o += j.length; }
    const pad = tailleTrame & 1, riff = new Uint8Array(12 + 8 + tailleTrame + pad); const dv = new DataView(riff.buffer);
    riff.set([0x52, 0x49, 0x46, 0x46]); dv.setUint32(4, 4 + 8 + tailleTrame + pad, true); riff.set([0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20], 8); dv.setUint32(16, tailleTrame, true); riff.set(trame, 20);
    return { octets: riff, params: { maxCoeff, w, h, simple: lf.simple, niveau: lf.niveau, nettete: lf.nettete, deltas: lf.deltas && lf.majDeltas ? 1 : 0, nparts, segActif: seg.actif, segAbs: seg.actif && seg.majData ? seg.abs : 0, segCarte: seg.actif ? seg.majMap : 0, skip: utiliseSkip, majProbas: tauxMaj > 0 ? 1 : 0, base } };
}
