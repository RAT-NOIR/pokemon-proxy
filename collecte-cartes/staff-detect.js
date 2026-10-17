// Détecteur PUR des étiquettes Cardmarket incrustées en bas d'une vignette (« Staff Version » blanche, « Oversized Card » rouge).
// Aucune lecture disque, aucun réseau : il reçoit des pixels { data, width, height, channels } et rend un constat.
// Les constantes sont calibrées sur les exemples du testeur (Revavroom SVP 008, Mimikyu ex SVP 004), voir STAFF-DETECT-report.md.
'use strict';

const BANDE_BAS = 0.18;              // l'étiquette vit dans le dernier ~18 % de la hauteur
const PASTILLE = {
    largeurMin: 0.30, largeurMax: 0.85,  // largeur de la boîte / largeur de l'image
    hauteurMin: 0.05, hauteurMax: 0.14,
    centreMin: 0.42, centreMax: 0.58,    // centre horizontal / largeur
    remplissageMin: 0.50,                // pixels du masque / surface de la boîte (le texte fait des trous)
};
const BLANC = { min: 238, ecart: 18 };   // blanc franc : min(RGB) >= 238 et canaux voisins
const ROUGE = { r: 170, g: 90, b: 90 };  // rouge franc : r élevé, g et b bas
const BLEUE = { rMax: 40, gMax: 75, bMin: 85, bMax: 150 };  // bleu marine des étiquettes récentes (0,33,105)
const BAS_MIN = 0.91;                   // le bas de la pastille touche presque le bord : exclut les zones de texte des Dresseurs
const SEUIL_ECART_PIXEL = 60;            // somme |dR|+|dG|+|dB| au-delà de laquelle un pixel « diffère »
const PART_BAS_MIN = 0.90;               // part de l'écart qui doit tomber dans la bande du bas

function px(img, i) { const o = i * img.channels; return [img.data[o], img.data[o + 1], img.data[o + 2]]; }

function masque(img, type, y0) {
    const { width: W, height: H } = img;
    const m = new Uint8Array(W * H);
    for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, [r, g, b] = px(img, i);
        if (type === 'blanche') { if (Math.min(r, g, b) >= BLANC.min && Math.max(r, g, b) - Math.min(r, g, b) <= BLANC.ecart) m[i] = 1; }
        else if (type === 'bleue') { if (r <= BLEUE.rMax && g <= BLEUE.gMax && b >= BLEUE.bMin && b <= BLEUE.bMax) m[i] = 1; }
        else if (r >= ROUGE.r && g <= ROUGE.g && b <= ROUGE.b) m[i] = 1;
    }
    return m;
}

function composantes(m, W, H, y0) {
    const vu = new Uint8Array(W * H), res = [], pile = [];
    for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = y * W + x; if (!m[s] || vu[s]) continue;
        let aire = 0, x0 = x, x1 = x, ya = y, yb = y; pile.length = 0; pile.push(s); vu[s] = 1;
        while (pile.length) {
            const c = pile.pop(), cx = c % W, cy = (c - cx) / W; aire++;
            if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < ya) ya = cy; if (cy > yb) yb = cy;
            if (cx > 0 && m[c - 1] && !vu[c - 1]) { vu[c - 1] = 1; pile.push(c - 1); }
            if (cx < W - 1 && m[c + 1] && !vu[c + 1]) { vu[c + 1] = 1; pile.push(c + 1); }
            if (cy > y0 && m[c - W] && !vu[c - W]) { vu[c - W] = 1; pile.push(c - W); }
            if (cy < H - 1 && m[c + W] && !vu[c + W]) { vu[c + W] = 1; pile.push(c + W); }
        }
        res.push({ aire, x0, x1, y0: ya, y1: yb });
    }
    return res;
}

// Une pastille claire ou rouge, centrée, dans la bande du bas ? Rend { type, bbox, score } ; type null si rien.
function detecterEtiquette(img) {
    const { width: W, height: H } = img;
    const yBande = Math.floor(H * (1 - BANDE_BAS));
    let meilleur = { type: null, bbox: null, score: 0 };
    for (const type of ['blanche', 'rouge', 'bleue']) {
        const m = masque(img, type, yBande);
        for (const c of composantes(m, W, H, yBande)) {
            const lw = (c.x1 - c.x0 + 1) / W, lh = (c.y1 - c.y0 + 1) / H, cx = (c.x0 + c.x1 + 1) / 2 / W;
            const remplissage = c.aire / ((c.x1 - c.x0 + 1) * (c.y1 - c.y0 + 1));
            if (lw < PASTILLE.largeurMin || lw > PASTILLE.largeurMax) continue;
            if (lh < PASTILLE.hauteurMin || lh > PASTILLE.hauteurMax) continue;
            if (cx < PASTILLE.centreMin || cx > PASTILLE.centreMax) continue;
            if (remplissage < PASTILLE.remplissageMin) continue;
            if (c.y0 < yBande || (c.y1 + 1) / H < BAS_MIN) continue;
            const score = c.aire;
            if (score > meilleur.score) meilleur = { type, bbox: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 }, score, remplissage: Math.round(remplissage * 100) / 100 };
        }
    }
    return meilleur;
}

// Deux images de même taille : où diffèrent-elles ? Et laquelle porte l'étiquette ?
function comparerPaire(a, b) {
    const { width: W, height: H } = a;
    if (b.width !== W || b.height !== H) throw new Error('paire de tailles différentes : normaliser avant');
    const yBande = Math.floor(H * (1 - BANDE_BAS));
    let total = 0, bas = 0;
    for (let i = 0; i < W * H; i++) {
        const [r1, g1, b1] = px(a, i), [r2, g2, b2] = px(b, i);
        if (Math.abs(r1 - r2) + Math.abs(g1 - g2) + Math.abs(b1 - b2) > SEUIL_ECART_PIXEL) { total++; if (i >= yBande * W) bas++; }
    }
    const ea = detecterEtiquette(a), eb = detecterEtiquette(b);
    let etiquetee = null;
    if (ea.type && !eb.type) etiquetee = 'A'; else if (eb.type && !ea.type) etiquetee = 'B';
    return { ecartTotal: total, ecartBas: bas, partBas: total ? bas / total : 0, etiquetee, etiquetteA: ea, etiquetteB: eb };
}

// Texte lu par l'OCR sur la bande → 'staff' | 'jumbo' | 'autre:<texte>' | null (rien lu).
function classerTexte(lignes) {
    const txt = (lignes || []).map(s => String(s).trim()).filter(Boolean).join(' ');
    if (!txt) return null;
    const n = txt.toLowerCase();
    if (/oversiz|attention/.test(n)) return 'jumbo';
    if (/wcd\s*\d/.test(n)) return 'wcd';
    // « Staff Version », y compris fragmenté par l'OCR (« Stat ff ersion ») ; jamais « Stamped », « Holo », « Center ».
    if (/sta\s?[f]{1,2}|\bs?t?a?i?t?\s?ff\b|\baff\b/.test(n) && /ersion|vers/.test(n) && !/stamped|holo|cent[er]/.test(n)) return 'staff';
    if (/tournament/.test(n)) return 'non-legale-sans-precision';
    return 'autre:' + txt;
}

// Verdict d'une paire : l'image-seule a trouvé UNE pastille d'un côté ET l'OCR confirme son texte, sinon douteux (non séparable).
function verdictPaire(paire, etiquette, ocrType) {
    if (!paire || !paire.etiquetee) return { verdict: 'douteux', motif: 'aucune pastille unique sur la paire' };
    if (!etiquette || !etiquette.type) return { verdict: 'douteux', motif: 'pastille non confirmée' };
    if (ocrType === 'staff' && (etiquette.type === 'blanche' || etiquette.type === 'bleue')) return { verdict: 'staff-identifie', cote: paire.etiquetee };
    if (ocrType === 'jumbo' && etiquette.type === 'rouge') return { verdict: 'jumbo-identifie', cote: paire.etiquetee };
    if (ocrType === null || ocrType === undefined) return { verdict: 'douteux', motif: 'OCR : aucun texte lu' };
    return { verdict: 'douteux', motif: 'OCR : ' + ocrType + ' pour une pastille ' + etiquette.type };
}

// bbox (repère W×H du détecteur) → rectangle { left, top, width, height } sur l'image d'origine wo×ho, avec marge relative, borné.
function rectanglePastille(bbox, W, H, wo, ho, marge = 0.1) {
    const sx = wo / W, sy = ho / H;
    const mx = (bbox.x1 - bbox.x0 + 1) * marge * sx, my = (bbox.y1 - bbox.y0 + 1) * marge * sy;
    const left = Math.max(0, Math.floor(bbox.x0 * sx - mx)), top = Math.max(0, Math.floor(bbox.y0 * sy - my));
    const right = Math.min(wo, Math.ceil((bbox.x1 + 1) * sx + mx)), bas = Math.min(ho, Math.ceil((bbox.y1 + 1) * sy + my));
    return { left, top, width: right - left, height: bas - top };
}

module.exports = { rectanglePastille, detecterEtiquette, comparerPaire, classerTexte, verdictPaire, BANDE_BAS, PASTILLE, BLANC, ROUGE, SEUIL_ECART_PIXEL, PART_BAS_MIN };
