// Détecteur PUR de matière spéciale (lot METAL, 2026-10-17) : une carte en métal doré ou argenté, rangée chez Cardmarket comme V2 d'une carte normale.
// Aucune lecture disque, aucun réseau : il reçoit des pixels { data, width, height, channels }.
//
// 🔑 CE QUI SÉPARE LE MÉTAL DE LA CARTE NORMALE, MESURÉ SUR LA PAIRE FONDATRICE (580162 métal doré / 576772 normale, Celebrations) : la BORDURE.
// Teinte et saturation sont les mêmes (or, S ≈ 0,55-0,66) ; seule la LUMINOSITÉ change — bordure V 0,50 contre 0,95, moyenne de la carte 0,50 contre 0,86.
// Un détecteur de « teinte dorée dominante » ne sépare rien (testé : gold 0,58 contre 0,45, dominante 0,96 contre 0,94) : le jaune vif de la carte
// normale est déjà doré. La clé est donc l'OR SOMBRE (teinte or, saturée, sombre) — et elle ne se prouve que CONTRE un frère normal.
// ⚠️ Un candidat sans frère normal et clair est « douteux » : un cadre sombre à lui seul (plein cadre, Dark, Lightning mat) n'est pas du métal.
// Les constantes sont calibrées sur 580162 / 576772 et sur 20 paires normales connues (STAFF-DETECT), voir METAL-report.md.
'use strict';

const BORD = { x: 0.05, haut: 0.035, bas: 0.035 };          // la bande de bordure : 5 % à gauche/droite, 3,5 % en haut/bas
const OR = { teinteMin: 25, teinteMax: 60, satMin: 0.45, valMax: 0.62 };
const ARGENT = { satMax: 0.15, valMin: 0.35, valMax: 0.8 };
const CLAIR = { valMin: 0.8 };                              // un frère « normal clair »
const ECART_MIN = 0.25;                                      // l'écart de luminosité minimal entre le candidat et son frère

function hsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) { if (mx === r) h = ((g - b) / d + 6) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; }
    return [h, mx ? d / mx : 0, mx];
}

/** L'empreinte d'une vignette : bordure (saturation, luminosité, teinte moyenne) et luminosité moyenne. Lève sur une image vide. */
function empreinte(img) {
    const { width: W, height: H, channels: C, data } = img || {};
    if (!W || !H || !C || C < 3 || !data || data.length < W * H * C) throw new Error('empreinte : image vide ou invalide');
    let bs = 0, bv = 0, bn = 0, cx = 0, sx = 0, gv = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const o = (y * W + x) * C, [h, s, v] = hsv(data[o], data[o + 1], data[o + 2]);
        gv += v;
        if (x < W * BORD.x || x > W * (1 - BORD.x) || y < H * BORD.haut || y > H * (1 - BORD.bas)) { bs += s; bv += v; bn++; cx += Math.cos(h * Math.PI / 180); sx += Math.sin(h * Math.PI / 180); }
    }
    let bh = Math.atan2(sx, cx) * 180 / Math.PI; if (bh < 0) bh += 360;
    return { borderS: bs / bn, borderV: bv / bn, borderH: bh, meanV: gv / (W * H) };
}

/** 'or' (bordure dorée sombre) | 'argent' (bordure grise, ni claire ni noire) | null. Écrit par ce qu'il RECONNAÎT : tout le reste est null. */
function classerMatiere(e) {
    if (e.borderH >= OR.teinteMin && e.borderH <= OR.teinteMax && e.borderS >= OR.satMin && e.borderV < OR.valMax) return 'or';
    if (e.borderS < ARGENT.satMax && e.borderV > ARGENT.valMin && e.borderV < ARGENT.valMax) return 'argent';
    return null;
}

const fraterieClaire = f => classerMatiere(f) === null && f.borderV >= CLAIR.valMin && f.borderS >= 0.4;

/**
 * Le verdict proposé pour UN produit, contre les empreintes de ses frères (même idExpansion, même idMetacard).
 * 'metal' : bordure or sombre ET un frère normal clair, écart de luminosité ≥ 0,25 · 'autre-matiere' : bordure argent ET un frère coloré clair ·
 * 'douteux' : candidat sans frère clair, ou écart trop faible · 'normal' : la bordure ne ressemble à aucune matière.
 * Jamais « metal » seul : la planche du coordinateur tranche, ce verdict n'est qu'une PROPOSITION.
 */
function verdictMatiere(e, freres) {
    const classe = classerMatiere(e);
    if (!classe) return { verdict: 'normal', classe: null, score: 0 };
    const claires = (freres || []).filter(fraterieClaire);
    if (!claires.length) return { verdict: 'douteux', classe, score: 0, motif: 'aucun frère normal clair pour comparer' };
    const score = Math.max(...claires.map(f => Math.max(f.borderV - e.borderV, (f.meanV - e.meanV))));
    const ecartMeanV = Math.max(...claires.map(f => f.meanV - e.meanV));
    if (classe === 'or') {
        if (score >= ECART_MIN && ecartMeanV >= ECART_MIN) return { verdict: 'metal', classe, score };
        return { verdict: 'douteux', classe, score, motif: 'écart de luminosité trop faible avec le frère' };
    }
    return { verdict: 'autre-matiere', classe, score };
}

module.exports = { empreinte, classerMatiere, verdictMatiere, BORD, OR, ARGENT, CLAIR, ECART_MIN };
