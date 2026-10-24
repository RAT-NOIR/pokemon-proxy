'use strict';
// Le rendu des planches (une seule définition pour la planche de calibration et pour les planches du livrable) : des CELLULES [notre vignette | la copie locale Cardmarket] et leur légende,
// 3 colonnes × 4 lignes par planche. Un côté absent (aucun visuel servi, pas de copie locale) est une case sombre qui le DIT — jamais une image devinée. Écrit par la garde d'écriture, dans S8\AUDIT\ seulement.
const fs = require('fs');
const sharp = require('sharp');
const { sortie } = require('./ecrire');

const L = 200, H = 281, MARGE = 12, COLONNES = 3, LIGNES = 4;
const echapper = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

async function vignette(chemin) { return sharp(chemin).flatten({ background: '#808080' }).resize(L, H, { fit: 'contain', background: '#303030' }).jpeg({ quality: 88 }).toBuffer(); }
async function absent(texte) {
    const svg = `<svg width="${L}" height="${H}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202020"/><text x="${L / 2}" y="${H / 2}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" fill="#aaa">${echapper(texte)}</text></svg>`;
    return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

/**
 * @param {Array<{ nous: string|null, cm: string|null, absentNous?: string, absentCm?: string, titre: string, droite?: string, bas?: string, bas2?: string }>} cellules
 * @param {{ prefixe: string, dossier: string }} o   les planches sont écrites dans `<dossier>/<prefixe>-NN.jpg` (relatif à S8\AUDIT)
 * @returns {Promise<string[]>} les fichiers écrits (relatifs), dans l'ordre ; chaque cellule reçoit `.planche = { fichier, ligne, colonne }`
 */
async function rendrePlanches(cellules, { prefixe, dossier }) {
    const legende = cellules.some(c => c.bas2) ? 66 : 50;
    const parPlanche = COLONNES * LIGNES, n = Math.ceil(cellules.length / parPlanche), cW = 2 * L + 10 + MARGE, cH = H + legende + MARGE, fichiers = [];
    fs.mkdirSync(sortie(dossier), { recursive: true });
    for (let k = 0; k < n; k++) {
        const lot = cellules.slice(k * parPlanche, (k + 1) * parPlanche), comps = [];
        const rel = `${dossier}/${prefixe}-${String(k + 1).padStart(2, '0')}.jpg`;
        for (let i = 0; i < lot.length; i++) {
            const c = lot[i], col = i % COLONNES, lig = Math.floor(i / COLONNES), X = MARGE + col * cW, Y = MARGE + lig * cH;
            c.planche = { fichier: rel, ligne: lig + 1, colonne: col + 1 };
            comps.push({ input: c.nous ? await vignette(c.nous) : await absent(c.absentNous || 'aucun visuel servi'), left: X, top: Y },
                { input: c.cm ? await vignette(c.cm) : await absent(c.absentCm || 'pas de copie locale'), left: X + L + 10, top: Y });
            const svg = `<svg width="${2 * L + 10}" height="${legende}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/>`
                + `<text x="6" y="19" font-family="Arial, sans-serif" font-size="17" font-weight="bold" fill="#fff">${echapper(c.titre)}</text>`
                + (c.droite ? `<text x="${L + 16}" y="19" font-family="Arial, sans-serif" font-size="13" fill="#9cf">${echapper(c.droite)}</text>` : '')
                + (c.bas ? `<text x="6" y="41" font-family="Arial, sans-serif" font-size="13" fill="#ddd">${echapper(c.bas.slice(0, 62))}</text>` : '')
                + (c.bas2 ? `<text x="6" y="58" font-family="Arial, sans-serif" font-size="12" fill="#fc8">${echapper(c.bas2.slice(0, 70))}</text>` : '') + '</svg>';
            comps.push({ input: Buffer.from(svg), left: X, top: Y + H });
        }
        await sharp({ create: { width: MARGE + COLONNES * cW, height: MARGE + LIGNES * cH, channels: 3, background: '#4a4a4a' } }).composite(comps).jpeg({ quality: 86 }).toFile(sortie(rel));
        fichiers.push(rel);
    }
    return fichiers;
}

module.exports = { rendrePlanches, PAR_PLANCHE: COLONNES * LIGNES };
