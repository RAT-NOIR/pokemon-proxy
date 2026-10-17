// Banc pur du détecteur d'étiquettes Cardmarket incrustées (STAFF-DETECT). Aucune lecture disque, aucun réseau.
'use strict';
const D = require('./collecte-cartes/staff-detect');

let ok = 0, ko = 0;
function t(nom, cond, detail) { if (cond) ok++; else { ko++; console.log('ECHEC', nom, detail === undefined ? '' : JSON.stringify(detail)); } }

const W = 256, H = 360;
function image(fond = [170, 170, 175]) {
    const data = Buffer.alloc(W * H * 3);
    for (let i = 0; i < W * H; i++) { data[i * 3] = fond[0]; data[i * 3 + 1] = fond[1]; data[i * 3 + 2] = fond[2]; }
    return { data, width: W, height: H, channels: 3 };
}
function rect(img, x0, y0, x1, y1, c) {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const o = (y * img.width + x) * 3; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; }
}
function pastille(img, x0, y0, x1, y1, c, encre) {
    rect(img, x0, y0, x1, y1, c);
    // « texte » : traits sombres/clairs à l'intérieur
    for (let k = 0; k < 8; k++) rect(img, x0 + 8 + k * 11, y0 + 6, x0 + 12 + k * 11, y1 - 6, encre);
}
const BLANC = [252, 252, 252], NOIR = [20, 20, 20], ROUGE = [225, 20, 25], BLANC_TXT = [250, 250, 250];

// 1. pastille blanche centrée en bas
{
    const a = image(); pastille(a, 70, 322, 186, 350, BLANC, NOIR);
    const r = D.detecterEtiquette(a);
    t('blanche centrée → blanche', r.type === 'blanche', r);
    t('bbox dans la bande du bas', r.bbox && r.bbox.y0 >= Math.floor(H * 0.8), r);
}
// 2. pastille rouge centrée
{
    const a = image(); pastille(a, 40, 318, 216, 352, ROUGE, BLANC_TXT);
    const r = D.detecterEtiquette(a);
    t('rouge centrée → rouge', r.type === 'rouge', r);
}
// 2 bis. pastille bleue marine (style récent MEP 74+) centrée
{
    const a = image(); pastille(a, 70, 318, 186, 346, [0, 33, 105], BLANC_TXT);
    t('bleue centrée → bleue', D.detecterEtiquette(a).type === 'bleue', D.detecterEtiquette(a));
}
// 2 ter. zone blanche centrée mais trop haute (zone de texte d'un Dresseur) → null
{
    const a = image(); pastille(a, 70, 295, 186, 324, BLANC, NOIR);
    t('blanche trop haute → null', D.detecterEtiquette(a).type === null, D.detecterEtiquette(a));
}
// 3. rien
t('image unie → null', D.detecterEtiquette(image()).type === null);
// 4. pastille décentrée
{
    const a = image(); pastille(a, 4, 322, 120, 350, BLANC, NOIR);
    t('blanche décentrée → null', D.detecterEtiquette(a).type === null);
}
// 5. blanche en haut
{
    const a = image(); pastille(a, 70, 20, 186, 48, BLANC, NOIR);
    t('blanche en haut → null', D.detecterEtiquette(a).type === null);
}
// 6. bande blanche pleine largeur (bord de carte / fond de Dresseur)
{
    const a = image(); rect(a, 0, 322, W, 352, BLANC);
    t('bande pleine largeur → null', D.detecterEtiquette(a).type === null);
}
// 7. petite tache blanche centrée (symbole, texte)
{
    const a = image(); rect(a, 120, 330, 136, 336, BLANC);
    t('petite tache → null', D.detecterEtiquette(a).type === null);
}
// 8. rouge d'illustration en haut → null
{
    const a = image(); pastille(a, 40, 100, 216, 134, ROUGE, BLANC_TXT);
    t('rouge hors bande → null', D.detecterEtiquette(a).type === null);
}
// 9. paire : un seul côté porte l'étiquette
{
    const a = image(), b = image(); pastille(b, 70, 322, 186, 350, BLANC, NOIR);
    const p = D.comparerPaire(a, b);
    t('paire : écart concentré en bas', p.partBas >= 0.9, p);
    t('paire : étiquetée = B', p.etiquetee === 'B', p);
}
// 10. paire : écart partout (deux photos différentes)
{
    const a = image(), b = image(); rect(b, 20, 40, 200, 200, [30, 30, 30]); pastille(b, 70, 322, 186, 350, BLANC, NOIR);
    const p = D.comparerPaire(a, b);
    t('paire : écart diffus → partBas < 0.9', p.partBas < 0.9, p);
}
// 11. paire identique
{
    const p = D.comparerPaire(image(), image());
    t('paire identique : aucun écart', p.ecartTotal === 0 && p.etiquetee === null, p);
}
// 12. OCR → type
t('ocr staff', D.classerTexte(['Staff Version']) === 'staff');
t('ocr staff bruité', D.classerTexte(['Staff Versian']) === 'staff');
t('ocr jumbo', D.classerTexte(['Attention: Oversized Card', 'Not Tournament Legal']) === 'jumbo');
t('ocr jumbo ligne Attention seule', D.classerTexte(['Attention: Oversized Card']) === 'jumbo');
t('ocr WCD n est pas jumbo', D.classerTexte(['WCD2007 Akira Miyazaki', 'Not Tournament Legal']) === 'wcd');
t('ocr Not Tournament Legal seul = ni jumbo ni wcd', D.classerTexte(['Not Tournament Legal']) === 'non-legale-sans-precision');
t('ocr Staff Stamped n est pas Staff Version', D.classerTexte(['Staff Stamped']) === 'autre:Staff Stamped');
for (const s of ['Stat ff ersion', 'ff Sta ersion', 'aff Stai ersion', 'Staff ersion', 'Staff /ersion', 'Sta ff ersion TO']) t('ocr staff fragmenté « ' + s + ' »', D.classerTexte([s]) === 'staff', D.classerTexte([s]));
t('ocr Pokemon Center Stamped Version', D.classerTexte(['Pokemon Center Stamped Version']) === 'autre:Pokemon Center Stamped Version');
t('ocr Version holo seul', D.classerTexte(['Version Holo']) === 'autre:Version Holo');
t('ocr Holo Version', D.classerTexte(['Holo Version']) === 'autre:Holo Version');
t('ocr autre', D.classerTexte(['Prerelease']) === 'autre:Prerelease');
t('ocr rien', D.classerTexte([]) === null);
// 12 bis. bbox normalisée → rectangle d'extraction sur l'image d'origine (marge, bornes)
{
    const r = D.rectanglePastille({ x0: 70, y0: 322, x1: 185, y1: 349 }, 256, 360, 510, 722, 0.1);
    t('rect : dans l image', r.left >= 0 && r.top >= 0 && r.left + r.width <= 510 && r.top + r.height <= 722, r);
    t('rect : contient la pastille', r.left <= 70 * 510 / 256 && r.left + r.width >= 186 * 510 / 256 && r.top <= 322 * 722 / 360, r);
    const b = D.rectanglePastille({ x0: 0, y0: 340, x1: 255, y1: 359 }, 256, 360, 255, 361, 0.5);
    t('rect : borné au bord', b.left === 0 && b.top + b.height <= 361 && b.left + b.width <= 255, b);
}
// 13. verdict de paire
t('verdict staff', D.verdictPaire({ etiquetee: 'B', partBas: 1 }, { type: 'blanche' }, 'staff').verdict === 'staff-identifie');
t('verdict staff bleue', D.verdictPaire({ etiquetee: 'B', partBas: 0.2 }, { type: 'bleue' }, 'staff').verdict === 'staff-identifie');
t('verdict jumbo', D.verdictPaire({ etiquetee: 'B', partBas: 1 }, { type: 'rouge' }, 'jumbo').verdict === 'jumbo-identifie');
t('verdict douteux sans ocr', D.verdictPaire({ etiquetee: 'B', partBas: 1 }, { type: 'blanche' }, null).verdict === 'douteux');
t('verdict douteux ocr autre', D.verdictPaire({ etiquetee: 'B', partBas: 1 }, { type: 'blanche' }, 'autre:X').verdict === 'douteux');

console.log(`${ok} passes, ${ko} en echec`);
process.exit(ko ? 1 : 0);
