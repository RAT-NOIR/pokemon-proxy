'use strict';
// MODELE-VISUEL-API — la VÉRIFICATION du vecteur que l'extension envoie (étude sans service, RAPPORT §3, points 1 à 4). Module PUR : ni base, ni réseau, ni fichier, ne lève jamais.
// 🔑 Écrit par ce qu'il AUTORISE (CLAUDE.md, en-tête des gardes) : un vecteur n'est admis QUE s'il est
//   1. exactement 256 nombres, encodés en fp16 petit-boutiste puis en base64 CANONIQUE (512 octets, 684 caractères, alphabet standard, une seule écriture admise par contenu) ;
//   2. tous FINIS, chacun de valeur absolue <= 0,5 (mesuré : 0,336 sur l'index, 0,277 sur les essais) ;
//   3. de norme L2 dans [0,999 ; 1,001] (mesuré : index 1,000000 ; envoyé en fp16 0,99991 à 1,00010) ;
//   4. plausible : le meilleur cosinus à l'index est >= 0,30 (vrais essais : min 0,333 ; bruit gaussien : 0,194 à 0,348 — la marge est mince, la garde ne bloque que le bruit grossier).
// Tout le reste se TAIT avec un code d'une liste fermée (forme, valeurs, norme, plausibilite) : G ne parle pas pour cette photo, rien ne lève. Le point 5 de l'étude (la cohérence avec la
// lecture : GC.contredire sur le produit que G désigne) n'est pas ici : il a besoin du catalogue, il vit dans promotion-g.js.
// La plausibilité n'est évaluée QU'APRÈS la forme, les valeurs et la norme : une recherche dans l'index ne s'offre pas à un vecteur invalide.
const DIM = 256, OCTETS = 512, BASE64_LONGUEUR = 684, ABS_MAX = 0.5, NORME_MIN = 0.999, NORME_MAX = 1.001, COSINUS_MIN = 0.30;
const CODES = Object.freeze(['forme', 'valeurs', 'norme', 'plausibilite']);

const echec = code => ({ ok: false, code });

/** Un entier fp16 (16 bits) vers un flottant ; l'exposant 31 (infini, NaN) rend une valeur NON finie, que la vérification refuse. */
function demiVersFlottant(h) {
    const s = (h & 0x8000) ? -1 : 1, e = (h >> 10) & 0x1f, m = h & 0x3ff;
    if (e === 0) return s * m * 2 ** -24;
    if (e === 31) return m === 0 ? s * Infinity : NaN;
    return s * (1 + m / 1024) * 2 ** (e - 15);
}
/** Un flottant vers le fp16 le plus proche (arrondi au plus proche) : ce que l'extension écrit. Sert aux bancs et à l'outil de mesure, jamais à une décision. */
function flottantVersDemi(x) {
    if (Number.isNaN(x)) return 0x7e00;
    const s = (x < 0 || Object.is(x, -0)) ? 0x8000 : 0, a = Math.abs(x);
    if (a === Infinity || a >= 65520) return s | 0x7c00;
    if (a < 2 ** -25) return s;
    if (a < 2 ** -14) { return s | Math.round(a / 2 ** -24); }
    let e = Math.floor(Math.log2(a)); if (2 ** e > a) e--; else if (2 ** (e + 1) <= a) e++;
    let m = Math.round((a / 2 ** e - 1) * 1024); if (m === 1024) { m = 0; e++; }
    return e + 15 >= 31 ? (s | 0x7c00) : (s | ((e + 15) << 10) | m);
}

/** Les 256 composantes en fp16 petit-boutiste, base64 : le format du contrat. */
function encoderVecteur(v) {
    const b = Buffer.alloc(OCTETS);
    for (let i = 0; i < DIM; i++) b.writeUInt16LE(flottantVersDemi(v[i]), i * 2);
    return b.toString('base64');
}

const ALPHABET = /^[A-Za-z0-9+/]{683}=$/;
/** Points 1 : la forme. @returns {{ok:true, vecteur: Float32Array} | {ok:false, code}} — ne lève jamais. */
function decoderVecteur(chaine) {
    if (typeof chaine !== 'string' || chaine.length !== BASE64_LONGUEUR || !ALPHABET.test(chaine)) return echec('forme');
    const b = Buffer.from(chaine, 'base64');
    if (b.length !== OCTETS || b.toString('base64') !== chaine) return echec('forme');          // une seule écriture admise pour un contenu (bits de bourrage nuls)
    const v = new Float32Array(DIM);
    for (let i = 0; i < DIM; i++) {
        const x = demiVersFlottant(b.readUInt16LE(i * 2));
        if (!Number.isFinite(x)) return echec('valeurs');
        v[i] = x;
    }
    return { ok: true, vecteur: v };
}

/** Points 2 et 3 sur un vecteur déjà décodé : 256 nombres finis, |x| <= 0,5, norme L2 dans la fenêtre. */
function verifierVecteur(v) {
    if (!(v instanceof Float32Array) || v.length !== DIM) return echec('forme');
    let s = 0;
    for (let i = 0; i < DIM; i++) {
        const x = v[i];
        if (!Number.isFinite(x) || Math.abs(x) > ABS_MAX) return echec('valeurs');
        s += x * x;
    }
    const n = Math.sqrt(s);
    if (!(n >= NORME_MIN && n <= NORME_MAX)) return echec('norme');
    return { ok: true, vecteur: v };
}

/**
 * Les points 1 à 4, dans cet ordre. `meilleurCosinusDe(vecteur)` est appelée SEULEMENT si la forme, les valeurs et la norme passent ; absente, qui lève, ou qui ne rend pas un nombre :
 * 'plausibilite' (on n'admet jamais sans avoir pu juger).
 * @returns {{ok:true, vecteur: Float32Array, meilleurCosinus:number} | {ok:false, code: 'forme'|'valeurs'|'norme'|'plausibilite'}}
 */
function verifier(chaine, meilleurCosinusDe) {
    try {
        const d = decoderVecteur(chaine);
        if (!d.ok) return d;
        const v = verifierVecteur(d.vecteur);
        if (!v.ok) return v;
        if (typeof meilleurCosinusDe !== 'function') return echec('plausibilite');
        let c;
        try { c = meilleurCosinusDe(d.vecteur); } catch { return echec('plausibilite'); }
        if (typeof c !== 'number' || !Number.isFinite(c) || c < COSINUS_MIN) return echec('plausibilite');
        return { ok: true, vecteur: d.vecteur, meilleurCosinus: c };
    } catch { return echec('forme'); }
}

module.exports = { verifier, verifierVecteur, decoderVecteur, encoderVecteur, demiVersFlottant, flottantVersDemi, DIM, OCTETS, BASE64_LONGUEUR, ABS_MAX, NORME_MIN, NORME_MAX, COSINUS_MIN, CODES };
