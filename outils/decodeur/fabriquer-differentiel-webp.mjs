// Fabrique N flux WebP VP8 aléatoires (generateur-webp.mjs) dans un dossier + manifeste.json ; references-pil-dossier.py les fait lire par Pillow et écrit le jeu de preuve.
//   node fabriquer-differentiel-webp.mjs <N> <dossier> [graine0]        flux aléatoires
//   node fabriquer-differentiel-webp.mjs cible <dossier> [graine0]      flux CIBLÉS : netteté 1..7 x niveaux, filtre simple x niveaux, saut de macrobloc, deltas (images 40 à 64 px)
import fs from 'node:fs';
import path from 'node:path';
import { genererWebp, alea } from './generateur-webp.mjs';
const [, , n, dossier, g0 = '1000'] = process.argv;
fs.mkdirSync(dossier, { recursive: true });
const rnd = alea(Number(g0) + 7);
const manifeste = [];
let graine = Number(g0), rejets = 0;
const ecrire = (r, extra = {}) => { const nom = `d${String(manifeste.length).padStart(4, '0')}.webp`; fs.writeFileSync(path.join(dossier, nom), r.octets); manifeste.push({ nom, graine: graine - 1, ...extra, ...r.params }); };
if (n === 'cible') {
    const base = { sansDq: 0, sansMaj: 0 };
    const liste = [];
    for (let ne = 1; ne <= 7; ne++) for (const niv of [8, 16, 30, 50, 63]) liste.push({ nettete: ne, niveau: niv, simple: 0, deltas: 0 });
    for (const niv of [4, 10, 20, 35, 50, 63]) for (let k = 0; k < 3; k++) liste.push({ simple: 1, niveau: niv, nettete: 0, deltas: 0 });
    for (let k = 0; k < 60; k++) liste.push({ skip: 1, nlog: 0, niveau: 20, simple: 0 });
    for (const niv of [10, 25, 40, 63]) for (let k = 0; k < 5; k++) liste.push({ deltas: 1, niveau: niv, simple: k % 2 });
    for (let k = 0; k < 60; k++) liste.push({ base: Math.floor(rnd() * 15), segActif: 0, sansDq: k % 2, skip: 0, niveau: 10 + (k % 5) * 10, nlog: 0 });     // petite quantification : des coefficients de Y2 (AC) acceptables pour la borne
    for (const f of liste) {
        for (;;) {
            const w = 40 + Math.floor(rnd() * 25), h = 40 + Math.floor(rnd() * 25);
            const r = genererWebp(graine++, w, h, { ...base, ...f });
            if (!r) { rejets++; continue; }
            ecrire(r, { cible: JSON.stringify(f) }); break;
        }
    }
} else {
    // des cas forcés d'abord : chaque drapeau rare est sûr d'être exercé, seul puis combiné
    const forces = [{ simple: 1 }, { simple: 0 }, { nlog: 1 }, { nlog: 2 }, { nlog: 3 }, { skip: 1 }, { skip: 0 }, { abs: 0, segActif: 1 }, { abs: 1, segActif: 1 }, { segActif: 0 }];
    while (manifeste.length < Number(n)) {
        const f = manifeste.length < forces.length * 3 ? forces[manifeste.length % forces.length] : {};
        const grand = rnd() < 0.08;
        const w = 1 + Math.floor(rnd() * (grand ? 120 : 70)), h = 1 + Math.floor(rnd() * (grand ? 90 : 70));
        const r = genererWebp(graine, w, h, { ...f, plafond: Number(process.env.RM_PLAFOND_COEFF || 300), gros: Boolean(process.env.RM_GROS) });
        graine++;
        if (!r) { rejets++; continue; }
        ecrire(r);
    }
}
fs.writeFileSync(path.join(dossier, 'manifeste.json'), JSON.stringify({ rejets, cas: manifeste }));
console.log(manifeste.length, 'flux,', rejets, 'tirages rejetés (coefficient hors borne)');
