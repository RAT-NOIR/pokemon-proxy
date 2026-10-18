// METAL — ÉTAPE 1 bis : les PLANCHES pour le coordinateur (le candidat à gauche, son frère normal à droite, le verdict PROPOSÉ en légende).
// node metal-planches.js   -> couverture/S7/METAL/planches/planche-NN.png + index.json. Lecture des vignettes du testeur ; écriture seulement sous la racine METAL (garde d'écriture).
// Le verdict est une PROPOSITION : le coordinateur regarde et tranche ; un « douteux » n'est jamais tranché ici.
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { RACINE_METAL } = require('./metal-reperage');

const PAR_PLANCHE = 8, VW = 200, VH = 280, LEG = 64;

/** Ce qui entre en planche : les métaux et autres matières proposés, et les douteux qui ont un indice (frère clair, ou bordure or et indice de nom). Le reste est compté, pas dessiné. */
function retenuPourPlanche(c) {
    if (c.verdict === 'metal' || c.verdict === 'autre-matiere') return true;
    return c.verdict === 'douteux' && (c.score > 0 || (c.classe === 'or' && c.indiceNom));
}
const echapper = s => String(s ?? '').replace(/[<>&"]/g, ' ');

async function main() {
    const { candidats } = JSON.parse(fs.readFileSync(path.join(RACINE_METAL, 'candidats.json'), 'utf8'));
    const liste = candidats.filter(retenuPourPlanche);
    const dossier = autoriser(path.join(RACINE_METAL, 'planches'), [RACINE_METAL]);
    fs.mkdirSync(dossier, { recursive: true });
    const index = [];
    for (let n = 0; n * PAR_PLANCHE < liste.length; n++) {
        const lot = liste.slice(n * PAR_PLANCHE, (n + 1) * PAR_PLANCHE);
        const compos = [];
        const lignes = Math.ceil(lot.length / 2), largeur = 2 * (2 * VW + 24), hauteur = lignes * (VH + LEG);
        for (let i = 0; i < lot.length; i++) {
            const c = lot[i], col = i % 2, lig = Math.floor(i / 2), x0 = col * (2 * VW + 24), y0 = lig * (VH + LEG);
            for (const [k, f] of [[0, c.vignette], [1, c.vignetteFrere]]) {
                if (!f) continue;
                compos.push({ input: await sharp(f).resize({ width: VW, height: VH, fit: 'contain', background: '#202020' }).png().toBuffer(), left: x0 + k * VW, top: y0 });
            }
            const l1 = `#${n * PAR_PLANCHE + i + 1}  ${c.idProduct}  ${c.verdict.toUpperCase()}${c.classe ? ' (' + c.classe + ')' : ''}  s=${c.score}`;
            const l2 = `${echapper(c.name).slice(0, 44)}`, l3 = `${echapper(c.expansion).slice(0, 30)}  frere ${c.frereRef ?? '—'}`;
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${2 * VW}" height="${LEG}"><rect width="100%" height="100%" fill="#101010"/>` +
                `<text x="4" y="16" font-family="Arial" font-size="13" fill="#ffd54a">${echapper(l1)}</text><text x="4" y="33" font-family="Arial" font-size="12" fill="#ffffff">${l2}</text>` +
                `<text x="4" y="50" font-family="Arial" font-size="11" fill="#bbbbbb">${l3}</text></svg>`;
            compos.push({ input: Buffer.from(svg), left: x0, top: y0 + VH });
            index.push({ planche: n + 1, rang: n * PAR_PLANCHE + i + 1, idProduct: c.idProduct, frere: c.frereRef, verdict: c.verdict, classe: c.classe, score: c.score, motif: c.motif, expansion: c.expansion, name: c.name });
        }
        const sortie = autoriser(path.join(dossier, `planche-${String(n + 1).padStart(2, '0')}.png`), [RACINE_METAL]);
        await sharp({ create: { width: largeur, height: hauteur, channels: 3, background: '#000000' } }).composite(compos).png().toFile(sortie);
    }
    fs.writeFileSync(autoriser(path.join(dossier, 'index.json'), [RACINE_METAL]), JSON.stringify(index, null, 1));
    const parVerdict = liste.reduce((o, c) => (o[c.verdict] = (o[c.verdict] || 0) + 1, o), {});
    console.log(`planches : ${Math.ceil(liste.length / PAR_PLANCHE)} pour ${liste.length} candidats ${JSON.stringify(parVerdict)} (sur ${candidats.length} listés au total)`);
}
if (require.main === module) main().catch(e => { console.error(e); process.exit(1); });
module.exports = { retenuPourPlanche };
