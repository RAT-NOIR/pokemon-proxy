// DECODEUR JPEG — code Rat-Market, JavaScript pur, entiers seulement : aucun canvas, aucun profil couleur, aucune API du navigateur, aucune bibliothèque tierce.
// Il reproduit, opération par opération, le décodage de libjpeg-turbo (celui de Pillow et de Chrome) avec ses réglages par défaut :
//   · IDCT « ISLOW » (jidctint.c : 13 bits de constantes, 2 bits de passe 1, table de limitation à masque 1023) ;
//   · suréchantillonnage « fancy » (jdsample.c : h2v1, h2v2, h1v2 ; les bords comme libjpeg : colonnes spéciales, rangées dupliquées) ;
//   · YCbCr -> RGB en virgule fixe 16 bits (jdcolor.c : tables Cr_r, Cb_b, Cr_g, Cb_g).
// Formats pris : JPEG séquentiel (SOF0, SOF1) et progressif (SOF2), 8 bits, 1 ou 3 composantes, Huffman, intervalles de redémarrage.
// Refusés avec un CODE (jamais un résultat approché) : arithmétique, sans perte, 12 bits, 4 composantes (CMYK / YCCK), fichier tronqué, plusieurs images.
// Aucune dépendance de l'appareil : tout est entier 32 bits ; le même fichier donne les mêmes octets partout.
// CRÉDITS : l'IDCT (idctBloc) est une transposition de jpeg_idct_islow de jidctint.c ; ce code est « based in part on the work of the Independent JPEG Group » (licence IJG, libjpeg-turbo).
// Les tables YCC->RGB et le suréchantillonnage suivent jdcolor.c et jdsample.c (IJG / libjpeg-turbo, BSD-3-Clause). Aucun code n'est copié, aucun binaire n'est servi.
// RÈGLE : tout ce qui est accepté a été comparé à Pillow au bit près ; le reste est refusé par un code (NON_SUPPORTE, DECODAGE, TROP_GRAND).
export class ErreurDecodeur extends Error {
    constructor(code, detail) { super(detail ? `${code}: ${detail}` : code); this.name = 'ErreurDecodeur'; this.code = code; this.detail = detail || ''; }
}
const ZZ = Int32Array.from([0, 1, 8, 16, 9, 2, 3, 10, 17, 24, 32, 25, 18, 11, 4, 5, 12, 19, 26, 33, 40, 48, 41, 34, 27, 20, 13, 6, 7, 14, 21, 28, 35, 42, 49, 56, 57, 50, 43, 36, 29, 22, 15, 23, 30, 37, 44, 51, 58, 59, 52, 45, 38, 31, 39, 46, 53, 60, 61, 54, 47, 55, 62, 63]);
const ceilDiv = (a, b) => Math.floor((a + b - 1) / b);
const refuser = (code, detail) => { throw new ErreurDecodeur(code, detail); };

// ── Huffman : table canonique + recherche sur 9 bits
const LOOK = 9;
function construireHuffman(longueurs /* 16 */, valeurs) {
    const t = { vals: valeurs, maxcode: new Int32Array(18).fill(-1), mincode: new Int32Array(17), valptr: new Int32Array(17), look: new Int32Array(1 << LOOK) };
    let code = 0, k = 0;
    for (let l = 1; l <= 16; l++) {
        t.valptr[l] = k; t.mincode[l] = code;
        for (let i = 0; i < longueurs[l - 1]; i++) {
            if (l <= LOOK) {
                const debut = code << (LOOK - l), n = 1 << (LOOK - l);
                for (let j = 0; j < n; j++) t.look[debut + j] = (l << 8) | valeurs[k];
            }
            code++; k++;
        }
        t.maxcode[l] = longueurs[l - 1] ? code - 1 : -1;
        if (code > (1 << l)) refuser('DECODAGE', 'table de Huffman invalide');
        code <<= 1;
    }
    return t;
}

// ── lecture de l'orientation EXIF (balise 0x0112) dans un segment APP1 ; 0 si absente ou illisible
export function orientationExif(b, debut, fin) {
    try {
        if (fin - debut < 14 || b[debut] !== 0x45 || b[debut + 1] !== 0x78 || b[debut + 2] !== 0x69 || b[debut + 3] !== 0x66 || b[debut + 4] !== 0 || b[debut + 5] !== 0) return 0;
        const t = debut + 6, le = b[t] === 0x49 && b[t + 1] === 0x49;
        if (!le && !(b[t] === 0x4d && b[t + 1] === 0x4d)) return 0;
        const u16 = i => (i + 2 > fin ? -1 : le ? b[i] | (b[i + 1] << 8) : (b[i] << 8) | b[i + 1]);
        const u32 = i => (i + 4 > fin ? -1 : le ? (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0 : ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0);
        if (u16(t + 2) !== 42) return 0;
        const decalage = u32(t + 4);
        if (decalage < 8 || t + decalage + 2 > fin) return 0;          // le IFD doit tenir dans le segment
        const ifd = t + decalage;
        const n = u16(ifd);
        if (n < 0 || n > 512 || ifd + 2 + 12 * n > fin) return 0;
        for (let i = 0; i < n; i++) {
            const e = ifd + 2 + 12 * i;
            if (u16(e) === 0x0112 && u16(e + 2) === 3 && u32(e + 4) === 1) { const v = u16(e + 8); return v >= 1 && v <= 8 ? v : 0; }
        }
    } catch { /* illisible */ }
    return 0;
}

/** Décode un JPEG en RGB. Rend { largeur, hauteur, rgb (Uint8Array l*h*3), orientationLue (0 si absente), transformeAdobe, espace }. L'orientation EXIF n'est PAS appliquée ici. */
export function decoderJpeg(b, { coteMax = 4096, pixelsMax = 12000000, pixelsMaxProgressif = 4000000, balayagesMax = 64 } = {}) {
    if (!(b instanceof Uint8Array)) b = new Uint8Array(b);
    const n = b.length;
    if (n < 4 || b[0] !== 0xff || b[1] !== 0xd8) refuser('FORMAT', 'pas un JPEG');
    let pos = 2, frame = null, restart = 0, jfif = false, adobe = -1, orientation = 0, fini = false, scans = 0;
    const qt = [null, null, null, null], dc = [null, null, null, null], ac = [null, null, null, null];

    while (!fini) {
        // le prochain marqueur
        while (pos < n && b[pos] !== 0xff) pos++;
        while (pos < n && b[pos] === 0xff) pos++;
        if (pos >= n) refuser('DECODAGE', 'fin de fichier avant EOI');
        const m = b[pos++];
        if (m === 0 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
        if (m === 0xd8) refuser('DECODAGE', 'SOI répété');
        if (m === 0xd9) { fini = true; break; }
        if (pos + 2 > n) refuser('DECODAGE', 'segment tronqué');
        const len = (b[pos] << 8) | b[pos + 1];
        if (len < 2 || pos + len > n) refuser('DECODAGE', 'segment tronqué');
        const s0 = pos + 2, s1 = pos + len;
        if (m === 0xe0) { if (len >= 16 && b[s0] === 0x4a && b[s0 + 1] === 0x46 && b[s0 + 2] === 0x49 && b[s0 + 3] === 0x46 && b[s0 + 4] === 0) jfif = true; }
        else if (m === 0xe1) { if (!orientation) orientation = orientationExif(b, s0, s1); }
        else if (m === 0xee) { if (len >= 14 && b[s0] === 0x41 && b[s0 + 1] === 0x64 && b[s0 + 2] === 0x6f && b[s0 + 3] === 0x62 && b[s0 + 4] === 0x65) adobe = b[s0 + 11]; }
        else if (m === 0xdb) {
            let i = s0;
            while (i < s1) {
                const pq = b[i] >> 4, tq = b[i] & 15; i++;
                if (tq > 3 || pq > 1) refuser('DECODAGE', 'DQT invalide');
                if (pq) refuser('NON_SUPPORTE', 'table de quantification 16 bits (non éprouvée contre Pillow)');
                const t = new Int32Array(64);
                for (let k = 0; k < 64; k++) { if (pq) { t[ZZ[k]] = (b[i] << 8) | b[i + 1]; i += 2; } else t[ZZ[k]] = b[i++]; }
                if (i > s1) refuser('DECODAGE', 'DQT tronquée');
                qt[tq] = t;
            }
        } else if (m === 0xc4) {
            let i = s0;
            while (i < s1) {
                const tc = b[i] >> 4, th = b[i] & 15; i++;
                if (tc > 1 || th > 3 || i + 16 > s1) refuser('DECODAGE', 'DHT invalide');
                const longueurs = b.subarray(i, i + 16); i += 16;
                let total = 0; for (let k = 0; k < 16; k++) total += longueurs[k];
                if (total > 256 || i + total > s1) refuser('DECODAGE', 'DHT invalide');
                const valeurs = Uint8Array.from(b.subarray(i, i + total)); i += total;
                (tc === 0 ? dc : ac)[th] = construireHuffman(longueurs, valeurs);
            }
        } else if (m === 0xdd) { if (len !== 4) refuser('DECODAGE', 'DRI invalide'); restart = (b[s0] << 8) | b[s0 + 1]; }
        else if (m === 0xc0 || m === 0xc1 || m === 0xc2) {
            if (frame) refuser('DECODAGE', 'plusieurs images');
            if (b[s0] !== 8) refuser('NON_SUPPORTE', `précision ${b[s0]} bits`);
            const hauteur = (b[s0 + 1] << 8) | b[s0 + 2], largeur = (b[s0 + 3] << 8) | b[s0 + 4], nc = b[s0 + 5];
            if (!(largeur >= 1 && hauteur >= 1)) refuser('DECODAGE', 'dimension nulle');
            if (largeur > coteMax || hauteur > coteMax || largeur * hauteur > pixelsMax) refuser('TROP_GRAND', `${largeur} x ${hauteur}`);
            if (nc !== 1 && nc !== 3) refuser('NON_SUPPORTE', `${nc} composantes`);
            // un progressif garde TOUS ses coefficients en mémoire (2 octets chacun, 3 composantes) jusqu'au dernier balayage : plafond plus bas, vérifié AVANT toute allocation
            if (m === 0xc2 && largeur * hauteur > pixelsMaxProgressif) refuser('TROP_GRAND', `progressif ${largeur} x ${hauteur} (plafond ${pixelsMaxProgressif} px)`);
            if (s1 - s0 < 6 + 3 * nc) refuser('DECODAGE', 'SOF tronqué');
            const comps = [];
            for (let i = 0; i < nc; i++) {
                const id = b[s0 + 6 + 3 * i], h = b[s0 + 7 + 3 * i] >> 4, v = b[s0 + 7 + 3 * i] & 15, tq = b[s0 + 8 + 3 * i];
                if (h < 1 || h > 4 || v < 1 || v > 4 || tq > 3) refuser('DECODAGE', 'SOF invalide');
                if (comps.some(x => x.id === id)) refuser('DECODAGE', 'identifiants de composantes répétés');
                comps.push({ id, h, v, tq, q: null, vu: false, bits: new Int8Array(64).fill(-1) });
            }
            // seuls les échantillonnages que Pillow sait écrire (donc éprouvés) : gris 1x1 ; couleur 4:4:4, 4:2:2 (Y 2x1), 4:2:0 (Y 2x2), chromas 1x1
            if (nc === 1) { if (comps[0].h !== 1 || comps[0].v !== 1) refuser('NON_SUPPORTE', 'gris échantillonné'); }
            else {
                const [y, cb, cr] = comps;
                if (cb.h !== 1 || cb.v !== 1 || cr.h !== 1 || cr.v !== 1 || !((y.h === 1 && y.v === 1) || (y.h === 2 && y.v === 1) || (y.h === 2 && y.v === 2))) refuser('NON_SUPPORTE', 'échantillonnage non éprouvé contre Pillow');
            }
            frame = { progressif: m === 0xc2, largeur, hauteur, comps };
            const maxH = Math.max(...comps.map(c => c.h)), maxV = Math.max(...comps.map(c => c.v));
            frame.maxH = maxH; frame.maxV = maxV;
            frame.mcusParLigne = ceilDiv(largeur, 8 * maxH); frame.mcusParColonne = ceilDiv(hauteur, 8 * maxV);
            for (const c of comps) {
                c.dw = ceilDiv(largeur * c.h, maxH); c.dh = ceilDiv(hauteur * c.v, maxV);                 // « downsampled_width / height » de libjpeg
                c.blocsParLigne = ceilDiv(c.dw, 8); c.blocsParColonne = ceilDiv(c.dh, 8);
                c.blocsParLigneMcu = frame.mcusParLigne * c.h; c.blocsParColonneMcu = frame.mcusParColonne * c.v;
                c.coef = new Int16Array(c.blocsParLigneMcu * c.blocsParColonneMcu * 64);
                c.pred = 0;
            }
        } else if ((m >= 0xc3 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) refuser('NON_SUPPORTE', `SOF ${m.toString(16)} (arithmétique ou sans perte)`);
        else if (m === 0xda) {
            if (!frame) refuser('DECODAGE', 'SOS avant SOF');
            const ns = b[s0];
            if (ns < 1 || ns > frame.comps.length || s1 - s0 < 4 + 2 * ns) refuser('DECODAGE', 'SOS invalide');
            const dansScan = [];
            for (let i = 0; i < ns; i++) {
                const cid = b[s0 + 1 + 2 * i], tables = b[s0 + 2 + 2 * i];
                const c = frame.comps.find(x => x.id === cid);
                if (!c || dansScan.includes(c)) refuser('DECODAGE', 'composante de SOS inconnue');
                c.tDC = tables >> 4; c.tAC = tables & 15; dansScan.push(c);
            }
            const ss = b[s0 + 1 + 2 * ns], se = b[s0 + 2 + 2 * ns], ah = b[s0 + 3 + 2 * ns] >> 4, al = b[s0 + 3 + 2 * ns] & 15;
            // plafond du nombre de balayages : chacun parcourt tous les blocs (un fichier de quelques Ko peut en empiler des milliers)
            if (++scans > balayagesMax) refuser('TROP_GRAND', `plus de ${balayagesMax} balayages`);
            if (!frame.progressif && frame.comps.length > 1 && dansScan.length !== frame.comps.length) refuser('NON_SUPPORTE', 'séquentiel non entrelacé (non éprouvé contre Pillow)');
            // libjpeg verrouille la table de quantification de chaque composante à son PREMIER balayage : une redéfinition ultérieure est sans effet
            for (const c of dansScan) {
                if (!c.q) { const t = qt[c.tq]; if (!t) refuser('DECODAGE', 'table de quantification absente'); c.q = t; }
                if (!frame.progressif) { if (c.vu) refuser('DECODAGE', 'composante lue deux fois'); c.vu = true; }
            }
            if (frame.progressif) {
                // jdphuff.c start_pass : bandes valides, raffinement d'un seul bit, progression cohérente (libjpeg ne fait qu'avertir ; refuser est plus sûr)
                if (ss === 0) { if (se !== 0) refuser('DECODAGE', 'scan DC invalide'); }
                else if (ss > se || se > 63 || dansScan.length !== 1) refuser('DECODAGE', 'scan AC invalide');
                if (al > 13 || (ah !== 0 && al !== ah - 1)) refuser('DECODAGE', 'approximation successive invalide');
                for (const c of dansScan) for (let k = ss; k <= se; k++) {
                    const attendu = c.bits[k] < 0 ? 0 : c.bits[k];
                    if (ah !== attendu) refuser('DECODAGE', 'progression incohérente');
                    c.bits[k] = al;
                }
            }
            pos = decoderScan(b, s1, frame, dansScan, restart, frame.progressif ? { ss, se, ah, al } : { ss: 0, se: 63, ah: 0, al: 0 }, dc, ac);
            continue;
        }
        pos = s1;
    }
    if (!frame || !scans) refuser('DECODAGE', 'aucune image');
    // complétude : libjpeg-turbo LISSE les blocs d'un progressif dont des coefficients n'ont pas reçu leur dernier balayage (do_block_smoothing) ; ce lissage n'est pas reproduit, donc ces fichiers sont refusés
    for (const c of frame.comps) {
        if (frame.progressif) { for (let k = 0; k < 64; k++) if (c.bits[k] !== 0) refuser('NON_SUPPORTE', 'JPEG progressif incomplet (libjpeg le lisserait)'); }
        else if (!c.vu) refuser('DECODAGE', 'composante sans balayage');
    }

    // IDCT de chaque bloc, puis suréchantillonnage, puis couleur
    const { largeur: W, hauteur: H } = frame;
    const pleins = frame.comps.map(c => {
        const q = c.q;
        const plan = idctPlan(c, q);
        return suréchantillonner(plan, c, frame);
    });
    const rgb = new Uint8Array(W * H * 3);
    let espace;
    if (pleins.length === 1) {
        espace = 'gris';
        const g = pleins[0];
        for (let i = 0, j = 0; i < W * H; i++, j += 3) { rgb[j] = rgb[j + 1] = rgb[j + 2] = g[i]; }
    } else {
        const ids = frame.comps.map(c => c.id);
        let ycc;
        if (jfif) ycc = true;
        else if (adobe >= 0) { if (adobe !== 0 && adobe !== 1) refuser('NON_SUPPORTE', `Adobe transform ${adobe}`); ycc = adobe === 1; }
        else if (ids[0] === 1 && ids[1] === 2 && ids[2] === 3) ycc = true;
        else if (ids[0] === 0x52 && ids[1] === 0x47 && ids[2] === 0x42) ycc = false;
        else ycc = true;
        espace = ycc ? 'ycbcr' : 'rgb';
        const [Y, Cb, Cr] = pleins;
        if (ycc) {
            for (let i = 0, j = 0; i < W * H; i++, j += 3) {
                const y = Y[i], cb = Cb[i], cr = Cr[i];
                let r = y + CR_R[cr], g = y + ((CB_G[cb] + CR_G[cr]) >> 16), bl = y + CB_B[cb];
                rgb[j] = r < 0 ? 0 : r > 255 ? 255 : r; rgb[j + 1] = g < 0 ? 0 : g > 255 ? 255 : g; rgb[j + 2] = bl < 0 ? 0 : bl > 255 ? 255 : bl;
            }
        } else for (let i = 0, j = 0; i < W * H; i++, j += 3) { rgb[j] = Y[i]; rgb[j + 1] = Cb[i]; rgb[j + 2] = Cr[i]; }
    }
    return { largeur: W, hauteur: H, rgb, orientationLue: orientation, espace, progressif: frame.progressif };
}

// jdcolor.c : build_ycc_rgb_table
const CR_R = new Int32Array(256), CB_B = new Int32Array(256), CR_G = new Int32Array(256), CB_G = new Int32Array(256);
{
    const FIX = x => Math.floor(x * 65536 + 0.5), MOITIE = 1 << 15;
    for (let i = 0; i < 256; i++) {
        const x = i - 128;
        CR_R[i] = (FIX(1.40200) * x + MOITIE) >> 16;
        CB_B[i] = (FIX(1.77200) * x + MOITIE) >> 16;
        CR_G[i] = -FIX(0.71414) * x;
        CB_G[i] = -FIX(0.34414) * x + MOITIE;
    }
}

// ── le décodage entropique d'un scan ; rend la position du marqueur qui suit
function decoderScan(b, debut, frame, comps, restart, { ss, se, ah, al }, dcT, acT) {
    const n = b.length;
    let pos = debut, buf = 0, cnt = 0, marqueur = false, faux = 0, eobrun = 0;
    const remplir = () => {
        while (cnt <= 24) {
            let v;
            if (marqueur) { v = 0; faux++; }
            else if (pos >= n) { marqueur = true; v = 0; faux++; }
            else {
                v = b[pos];
                if (v === 0xff) { if (b[pos + 1] === 0) pos += 2; else { marqueur = true; v = 0; faux++; } } else pos++;
            }
            buf |= v << (24 - cnt); cnt += 8;
        }
    };
    const bits = k => { if (k === 0) return 0; if (cnt < k) remplir(); const r = buf >>> (32 - k); buf <<= k; cnt -= k; return r; };
    const bit = () => { if (cnt < 1) remplir(); const r = buf >>> 31; buf <<= 1; cnt--; return r; };
    const huff = t => {
        if (!t) refuser('DECODAGE', 'table de Huffman absente');
        if (cnt < 16) remplir();
        const e = t.look[buf >>> (32 - LOOK)];
        if (e) { const l = e >> 8; buf <<= l; cnt -= l; return e & 255; }
        const code16 = buf >>> 16;
        for (let l = LOOK + 1; l <= 16; l++) {
            const c = code16 >>> (16 - l);
            if (c <= t.maxcode[l]) { buf <<= l; cnt -= l; return t.vals[t.valptr[l] + c - t.mincode[l]]; }
        }
        return refuser('DECODAGE', 'code de Huffman invalide');
    };
    const etendre = s => { if (s > 15) refuser('DECODAGE', 'catégorie invalide'); if (s === 0) return 0; const v = bits(s); return v < (1 << (s - 1)) ? v - (1 << s) + 1 : v; };
    const verifierSansFaux = () => { if (faux && cnt < faux * 8) refuser('DECODAGE', 'données tronquées'); };

    let decoder;
    if (!frame.progressif) {
        decoder = (c, off) => {
            const co = c.coef, t = huff(c.dcT);
            c.pred += t === 0 ? 0 : etendre(t); co[off] = c.pred;
            for (let k = 1; k < 64;) {
                const rs = huff(c.acT), s = rs & 15, r = rs >> 4;
                if (s === 0) { if (r < 15) break; k += 16; continue; }
                k += r; if (k > 63) refuser('DECODAGE', 'coefficient hors bloc');
                co[off + ZZ[k]] = etendre(s); k++;
            }
        };
    } else if (ss === 0) {
        if (se !== 0) refuser('DECODAGE', 'scan DC invalide');
        decoder = ah === 0
            ? (c, off) => { const t = huff(c.dcT); c.pred += t === 0 ? 0 : etendre(t); c.coef[off] = c.pred * (1 << al); }
            : (c, off) => { if (bit()) c.coef[off] |= 1 << al; };
    } else {
        if (se < ss || se > 63 || comps.length !== 1) refuser('DECODAGE', 'scan AC invalide');
        if (ah === 0) {
            decoder = (c, off) => {
                if (eobrun > 0) { eobrun--; return; }
                const co = c.coef;
                for (let k = ss; k <= se;) {
                    const rs = huff(c.acT), s = rs & 15, r = rs >> 4;
                    if (s === 0) { if (r < 15) { eobrun = bits(r) + (1 << r) - 1; break; } k += 16; continue; }
                    k += r; if (k > 63) refuser('DECODAGE', 'coefficient hors bloc');
                    co[off + ZZ[k]] = etendre(s) * (1 << al); k++;
                }
            };
        } else {
            const p1 = 1 << al, m1 = -1 << al;
            decoder = (c, off) => {
                const co = c.coef;
                let k = ss;
                if (eobrun === 0) {
                    for (; k <= se; k++) {
                        const rs = huff(c.acT); let r = rs >> 4, s = rs & 15;
                        if (s) { if (s !== 1) refuser('DECODAGE', 'raffinement invalide'); s = bit() ? p1 : m1; }
                        else if (r !== 15) { eobrun = 1 << r; if (r) eobrun += bits(r); break; }
                        do {
                            const idx = off + ZZ[k];
                            if (co[idx] !== 0) { if (bit()) { if ((co[idx] & p1) === 0) co[idx] += co[idx] >= 0 ? p1 : m1; } }
                            else if (--r < 0) break;
                            k++;
                        } while (k <= se);
                        if (s) { if (k > se) refuser('DECODAGE', 'coefficient hors bande'); co[off + ZZ[k]] = s; }
                    }
                }
                if (eobrun > 0) {
                    for (; k <= se; k++) {
                        const idx = off + ZZ[k];
                        if (co[idx] !== 0) { if (bit()) { if ((co[idx] & p1) === 0) co[idx] += co[idx] >= 0 ? p1 : m1; } }
                    }
                    eobrun--;
                }
            };
        }
    }

    const seul = comps.length === 1;
    const total = seul ? comps[0].blocsParLigne * comps[0].blocsParColonne : frame.mcusParLigne * frame.mcusParColonne;
    for (const c of comps) { c.pred = 0; c.dcT = dcT[c.tDC]; c.acT = acT[c.tAC]; }
    for (let mcu = 0; mcu < total; mcu++) {
        if (restart > 0 && mcu > 0 && mcu % restart === 0) {
            verifierSansFaux();
            buf = 0; cnt = 0; faux = 0; eobrun = 0;
            if (!marqueur) { while (pos + 1 < n && !(b[pos] === 0xff && b[pos + 1] !== 0 && b[pos + 1] !== 0xff)) pos++; }
            if (!(pos + 1 < n && b[pos] === 0xff && b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) refuser('DECODAGE', 'marqueur de redémarrage absent');
            pos += 2; marqueur = false;
            for (const c of comps) c.pred = 0;
        }
        if (seul) {
            const c = comps[0], ligne = (mcu / c.blocsParLigne) | 0, col = mcu - ligne * c.blocsParLigne;
            decoder(c, 64 * (ligne * c.blocsParLigneMcu + col));
        } else {
            const mr = (mcu / frame.mcusParLigne) | 0, mc = mcu - mr * frame.mcusParLigne;
            for (const c of comps) for (let j = 0; j < c.v; j++) for (let k = 0; k < c.h; k++) decoder(c, 64 * ((mr * c.v + j) * c.blocsParLigneMcu + mc * c.h + k));
        }
    }
    verifierSansFaux();
    if (!marqueur) { while (pos + 1 < n && !(b[pos] === 0xff && b[pos + 1] !== 0 && b[pos + 1] !== 0xff)) pos++; }
    return pos;
}

// ── jidctint.c : jpeg_idct_islow
const C0_298 = 2446, C0_390 = 3196, C0_541 = 4433, C0_765 = 6270, C0_899 = 7373, C1_175 = 9633, C1_501 = 12299, C1_847 = 15137, C1_961 = 16069, C2_053 = 16819, C2_562 = 20995, C3_072 = 25172;
const ws = new Int32Array(64);
const limiter = v => { const i = v & 1023; const x = (i < 512 ? i : i - 1024) + 128; return x < 0 ? 0 : x > 255 ? 255 : x; };
function idctBloc(co, off, q, sortie, so, stride) {
    for (let c = 0; c < 8; c++) {
        const i = off + c;
        if (co[i + 8] === 0 && co[i + 16] === 0 && co[i + 24] === 0 && co[i + 32] === 0 && co[i + 40] === 0 && co[i + 48] === 0 && co[i + 56] === 0) {
            const d = (co[i] * q[c]) << 2;
            for (let r = 0; r < 8; r++) ws[c + 8 * r] = d;
            continue;
        }
        let z2 = co[i + 16] * q[c + 16], z3 = co[i + 48] * q[c + 48];
        let z1 = (z2 + z3) * C0_541;
        let tmp2 = z1 + z3 * -C1_847, tmp3 = z1 + z2 * C0_765;
        z2 = co[i] * q[c]; z3 = co[i + 32] * q[c + 32];
        let tmp0 = (z2 + z3) << 13, tmp1 = (z2 - z3) << 13;
        const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
        tmp0 = co[i + 56] * q[c + 56]; tmp1 = co[i + 40] * q[c + 40]; tmp2 = co[i + 24] * q[c + 24]; tmp3 = co[i + 8] * q[c + 8];
        z1 = tmp0 + tmp3; z2 = tmp1 + tmp2; z3 = tmp0 + tmp2; let z4 = tmp1 + tmp3;
        const z5 = (z3 + z4) * C1_175;
        tmp0 *= C0_298; tmp1 *= C2_053; tmp2 *= C3_072; tmp3 *= C1_501;
        z1 *= -C0_899; z2 *= -C2_562; z3 *= -C1_961; z4 *= -C0_390;
        z3 += z5; z4 += z5;
        tmp0 += z1 + z3; tmp1 += z2 + z4; tmp2 += z2 + z3; tmp3 += z1 + z4;
        ws[c] = (tmp10 + tmp3 + 1024) >> 11; ws[c + 56] = (tmp10 - tmp3 + 1024) >> 11;
        ws[c + 8] = (tmp11 + tmp2 + 1024) >> 11; ws[c + 48] = (tmp11 - tmp2 + 1024) >> 11;
        ws[c + 16] = (tmp12 + tmp1 + 1024) >> 11; ws[c + 40] = (tmp12 - tmp1 + 1024) >> 11;
        ws[c + 24] = (tmp13 + tmp0 + 1024) >> 11; ws[c + 32] = (tmp13 - tmp0 + 1024) >> 11;
    }
    for (let r = 0; r < 8; r++) {
        const w = 8 * r, o = so + r * stride;
        if (ws[w + 1] === 0 && ws[w + 2] === 0 && ws[w + 3] === 0 && ws[w + 4] === 0 && ws[w + 5] === 0 && ws[w + 6] === 0 && ws[w + 7] === 0) {
            const d = limiter((ws[w] + 16) >> 5);
            for (let k = 0; k < 8; k++) sortie[o + k] = d;
            continue;
        }
        let z2 = ws[w + 2], z3 = ws[w + 6];
        let z1 = (z2 + z3) * C0_541;
        let tmp2 = z1 + z3 * -C1_847, tmp3 = z1 + z2 * C0_765;
        let tmp0 = (ws[w] + ws[w + 4]) << 13, tmp1 = (ws[w] - ws[w + 4]) << 13;
        const tmp10 = tmp0 + tmp3, tmp13 = tmp0 - tmp3, tmp11 = tmp1 + tmp2, tmp12 = tmp1 - tmp2;
        tmp0 = ws[w + 7]; tmp1 = ws[w + 5]; tmp2 = ws[w + 3]; tmp3 = ws[w + 1];
        z1 = tmp0 + tmp3; z2 = tmp1 + tmp2; z3 = tmp0 + tmp2; let z4 = tmp1 + tmp3;
        const z5 = (z3 + z4) * C1_175;
        tmp0 *= C0_298; tmp1 *= C2_053; tmp2 *= C3_072; tmp3 *= C1_501;
        z1 *= -C0_899; z2 *= -C2_562; z3 *= -C1_961; z4 *= -C0_390;
        z3 += z5; z4 += z5;
        tmp0 += z1 + z3; tmp1 += z2 + z4; tmp2 += z2 + z3; tmp3 += z1 + z4;
        const R = 1 << 17;
        sortie[o] = limiter((tmp10 + tmp3 + R) >> 18); sortie[o + 7] = limiter((tmp10 - tmp3 + R) >> 18);
        sortie[o + 1] = limiter((tmp11 + tmp2 + R) >> 18); sortie[o + 6] = limiter((tmp11 - tmp2 + R) >> 18);
        sortie[o + 2] = limiter((tmp12 + tmp1 + R) >> 18); sortie[o + 5] = limiter((tmp12 - tmp1 + R) >> 18);
        sortie[o + 3] = limiter((tmp13 + tmp0 + R) >> 18); sortie[o + 4] = limiter((tmp13 - tmp0 + R) >> 18);
    }
}
function idctPlan(c, q) {
    const pw = c.blocsParLigneMcu * 8, ph = c.blocsParColonneMcu * 8, plan = new Uint8Array(pw * ph);
    const co = c.coef;
    for (let br = 0; br < c.blocsParColonneMcu; br++) for (let bc = 0; bc < c.blocsParLigneMcu; bc++) {
        const o = 64 * (br * c.blocsParLigneMcu + bc);
        // un produit coefficient x quantificateur hors d'un entier 16 bits : libjpeg-turbo SIMD (Pillow) et son C scalaire divergent ; ni l'un ni l'autre n'est éprouvé, le fichier est refusé
        for (let i = 0; i < 64; i++) { const p = co[o + i] * q[i]; if (p > 32767 || p < -32768) refuser('DECODAGE', 'coefficient hors plage 16 bits'); }
        idctBloc(co, o, q, plan, br * 8 * pw + bc * 8, pw);
    }
    c.coef = null;
    return { plan, pw };
}

// ── jdsample.c : le plan d'une composante ramené à largeur x hauteur de l'image
function suréchantillonner({ plan, pw }, c, frame) {
    const { largeur: W, hauteur: H, maxH, maxV } = frame;
    const sortie = new Uint8Array(W * H);
    const { dw, dh } = c;
    if (maxH % c.h || maxV % c.v) refuser('NON_SUPPORTE', 'échantillonnage fractionnaire');
    const hx = maxH / c.h, vx = maxV / c.v;
    if (hx === 1 && vx === 1) { for (let y = 0; y < H; y++) sortie.set(plan.subarray(y * pw, y * pw + W), y * W); return sortie; }
    if (hx === 2 && vx === 1 && dw > 2) {
        for (let y = 0; y < H; y++) {
            const l = y * pw, o = y * W;
            const mettre = (x, v) => { if (x < W) sortie[o + x] = v; };
            mettre(0, plan[l]); mettre(1, (plan[l] * 3 + plan[l + 1] + 2) >> 2);
            for (let i = 1; i < dw - 1; i++) { const v = plan[l + i] * 3; mettre(2 * i, (v + plan[l + i - 1] + 1) >> 2); mettre(2 * i + 1, (v + plan[l + i + 1] + 2) >> 2); }
            const v = plan[l + dw - 1];
            mettre(2 * dw - 2, (v * 3 + plan[l + dw - 2] + 1) >> 2); mettre(2 * dw - 1, v);
        }
        return sortie;
    }
    // h1v2 (4:4:0) : libjpeg-turbo 2.x et 3.x l'élargissent en « fancy » ; aucun JPEG 4:4:0 n'a pu être fabriqué avec Pillow 13 pour le prouver au bit : REFUSÉ plutôt que deviné
    if (hx === 1 && vx === 2) refuser('NON_SUPPORTE', 'JPEG 4:4:0 (h1v2) non prouvé contre Pillow');
    if (hx === 2 && vx === 2 && dw > 2) {
        for (let y = 0; y < H; y++) {
            const ir = y >> 1, v = y & 1, autre = Math.min(dh - 1, Math.max(0, v === 0 ? ir - 1 : ir + 1));
            const a = ir * pw, d = autre * pw, o = y * W;
            const mettre = (x, val) => { if (x < W) sortie[o + x] = val; };
            let ce = plan[a] * 3 + plan[d], suiv = plan[a + 1] * 3 + plan[d + 1], der = ce;
            mettre(0, (ce * 4 + 8) >> 4); mettre(1, (ce * 3 + suiv + 7) >> 4);
            der = ce; ce = suiv;
            for (let i = 1; i < dw - 1; i++) {
                suiv = plan[a + i + 1] * 3 + plan[d + i + 1];
                mettre(2 * i, (ce * 3 + der + 8) >> 4); mettre(2 * i + 1, (ce * 3 + suiv + 7) >> 4);
                der = ce; ce = suiv;
            }
            mettre(2 * dw - 2, (ce * 3 + der + 8) >> 4); mettre(2 * dw - 1, (ce * 4 + 7) >> 4);
        }
        return sortie;
    }
    // duplication entière (h2v1 / h2v2 sans « fancy » quand la composante a 2 colonnes ou moins). Les autres rapports (4:1:1, 4:1:0…) : non éprouvés contre Pillow, refusés
    if (!(hx === 2 && vx <= 2)) refuser('NON_SUPPORTE', `échantillonnage ${hx}x${vx} non prouvé contre Pillow`);
    for (let y = 0; y < H; y++) { const l = Math.floor(y / vx) * pw, o = y * W; for (let x = 0; x < W; x++) sortie[o + x] = plan[l + Math.floor(x / hx)]; }
    return sortie;
}
