// Banc pur du détecteur de matière spéciale (lot METAL). Images FABRIQUÉES ; aucun disque, aucun réseau, aucun chemin du testeur.
'use strict';
const D = require('./collecte-cartes/metal-detect');

let ok = 0, ko = 0;
function t(nom, cond, detail) { if (cond) ok++; else { ko++; console.log('ECHEC', nom, detail === undefined ? '' : JSON.stringify(detail)); } }

const W = 64, H = 90;
function image(bordure, interieur) {
    const data = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const bord = x < W * 0.06 || x > W * 0.94 || y < H * 0.05 || y > H * 0.95;
        const c = bord ? bordure : interieur(x, y);
        const o = (y * W + x) * 3; data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2];
    }
    return { data, width: W, height: H, channels: 3 };
}
const colore = (x, y) => [[220, 60, 40], [40, 90, 200], [250, 240, 200], [120, 60, 160]][(x + y) % 4];
const dore = (x, y) => [[140, 100, 30], [155, 115, 35], [125, 90, 28]][(x + y) % 3];
const JAUNE_VIF = [255, 225, 60], OR_SOMBRE = [130, 95, 30], ARGENT = [150, 150, 156], NOIR = [20, 20, 20];

const normale = D.empreinte(image(JAUNE_VIF, colore));
const metal = D.empreinte(image(OR_SOMBRE, dore));
const argent = D.empreinte(image(ARGENT, () => [160, 160, 165]));
const noire = D.empreinte(image(NOIR, colore));

// 1. la classe de bordure
t('jaune vif → rien', D.classerMatiere(normale) === null, normale);
t('or sombre → or', D.classerMatiere(metal) === 'or', metal);
t('gris → argent', D.classerMatiere(argent) === 'argent', argent);
t('bordure noire → rien (ni or ni argent)', D.classerMatiere(noire) === null, noire);

// 2. le verdict : un candidat se prouve CONTRE un frère normal, jamais seul
const v1 = D.verdictMatiere(metal, [normale]);
t('or sombre + frère jaune vif → metal', v1.verdict === 'metal', v1);
t('le score du métal est positif', v1.score > 0.25, v1);
t('or sombre sans frère → douteux', D.verdictMatiere(metal, []).verdict === 'douteux', D.verdictMatiere(metal, []));
t('or sombre + frère aussi sombre → douteux', D.verdictMatiere(metal, [metal]).verdict === 'douteux', D.verdictMatiere(metal, [metal]));
t('argent + frère coloré vif → autre-matiere', D.verdictMatiere(argent, [normale]).verdict === 'autre-matiere', D.verdictMatiere(argent, [normale]));
t('argent sans frère → douteux', D.verdictMatiere(argent, []).verdict === 'douteux');
t('normale + frère normal → normal', D.verdictMatiere(normale, [normale]).verdict === 'normal');
t('normale + frère métal → normal (la normale ne devient pas candidate)', D.verdictMatiere(normale, [metal]).verdict === 'normal');
t('bordure noire → normal', D.verdictMatiere(noire, [normale]).verdict === 'normal');

// 2 bis. un frère clair mais PEU plus clair : l'écart de luminosité est insuffisant, la proposition reste « douteux » (jamais « metal »)
const orPale = D.empreinte(image([150, 110, 35], dore));          // bordure V ≈ 0,59 : « or » à la limite
const presqueClair = D.empreinte(image([215, 165, 60], dore));    // frère à bordure V ≈ 0,84 mais intérieur aussi sombre : même luminosité moyenne
t('or limite + frère clair mais écart de luminosité faible → douteux', D.verdictMatiere(orPale, [presqueClair]).verdict === 'douteux', { orPale, presqueClair, v: D.verdictMatiere(orPale, [presqueClair]) });

// 3. entrées invalides : on lève, on ne rend pas « normal »
let leve = false; try { D.empreinte({ data: Buffer.alloc(0), width: 0, height: 0, channels: 3 }); } catch (e) { leve = true; }
t('image vide → lève', leve);
t('empreinte à 4 canaux = à 3 canaux', (() => {
    const a = image(OR_SOMBRE, dore), d4 = Buffer.alloc(W * H * 4);
    for (let i = 0; i < W * H; i++) { d4[i * 4] = a.data[i * 3]; d4[i * 4 + 1] = a.data[i * 3 + 1]; d4[i * 4 + 2] = a.data[i * 3 + 2]; d4[i * 4 + 3] = 255; }
    return JSON.stringify(D.empreinte({ data: d4, width: W, height: H, channels: 4 })) === JSON.stringify(metal);
})());

console.log(`test-metal-detect : ${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
