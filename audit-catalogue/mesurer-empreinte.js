'use strict';
// node audit-catalogue/mesurer-empreinte.js — MESURE les candidats d'empreinte sur une population de VÉRITÉ CONNUE, avant d'en choisir un (brief S8/AUDIT, mesure 5).
//   « vrais » : produits servis par le visuel de LEUR set (classe à comparer), fiche OK, preuve par le numéro seule — la quasi-totalité est juste ; la population est donc
//               SALIE par les quelques erreurs qu'on cherche (le rapport le dit). « faux » : la vignette d'un produit contre la copie Cardmarket d'un AUTRE produit du même set,
//               de NOM différent (même set, autre carte : le cas difficile, pas deux cartes de sets sans rapport).
//   Candidats : (A) corrélation normalisée avec recalage ±5/±4 (empreinte.js) · (B) la corrélation 32×32 SANS recalage de l'existant (index-symboles.js : normaliser/correlation, §69)
//               · (C) dHash 64 bits (rejeté au §69 sur les aplats : remesuré ici sur des cartes) · (D) ORB + RANSAC de departage-image.js (decrire/inliers, §15 : lent, fuite mémoire).
//               SIFT (§74) n'est pas rejoué : il vit dans le labo Python, et son coût (> 30 ms par paire) interdit déjà 70 000 paires dans le budget.
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const E = require('./empreinte');
const { normaliser, correlation } = require('../collecte-cartes/index-symboles');
const { lireJson, sortie, ecrireJson } = require('./ecrire');
const { lireJeu } = require('./lancer-comparaison');
const { indexerDisque } = require('../collecte-cartes/staff-detect-io');
const { decomposerNomCardmarket } = require('../collecte-cartes/jointure');

const alea = g => () => { g = (g + 0x6D2B79F5) >>> 0; let t = g; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex');

// ── (B) l'existant : corrélation normalisée de la fenêtre centrale, SANS recalage (les fonctions de index-symboles.js)
function fenetreGris(fp) { const g = E.luminance(fp), { c0, c1, r0, r1 } = E.FENETRE, out = Buffer.alloc((c1 - c0) * (r1 - r0)); let k = 0; for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) out[k++] = Math.round(g[r * E.LARGEUR + c]); return out; }
const distanceB = (a, b) => { const x = normaliser(fenetreGris(a).toString('base64')), y = normaliser(fenetreGris(b).toString('base64')); return x && y ? 1 - Math.max(correlation(x, y), 0) : NaN; };
// ── (C) dHash 64 bits sur la fenêtre centrale (9×8 par moyenne de blocs)
function dhash(fp) {
    const g = E.luminance(fp), { c0, c1, r0, r1 } = E.FENETRE, bw = (c1 - c0) / 9, bh = (r1 - r0) / 8, m = [];
    for (let by = 0; by < 8; by++) { const l = []; for (let bx = 0; bx < 9; bx++) { let s = 0, n = 0; for (let r = Math.floor(r0 + by * bh); r < Math.floor(r0 + (by + 1) * bh); r++) for (let c = Math.floor(c0 + bx * bw); c < Math.floor(c0 + (bx + 1) * bw); c++) { s += g[r * E.LARGEUR + c]; n++; } l.push(s / n); } m.push(l); }
    const bits = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits.push(m[y][x] > m[y][x + 1] ? 1 : 0); return bits;
}
const distanceC = (a, b) => { const x = dhash(a), y = dhash(b); let d = 0; for (let i = 0; i < 64; i++) d += x[i] !== y[i] ? 1 : 0; return d / 64; };

/** L'aire sous la courbe ROC : P(distance d'un vrai < distance d'un faux) — 1 : séparation parfaite, 0,5 : hasard. */
function auc(vrais, faux) {
    const tout = [...vrais.map(d => [d, 1]), ...faux.map(d => [d, 0])].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let rangVrais = 0, i = 0;
    while (i < tout.length) { let j = i; while (j < tout.length && tout[j][0] === tout[i][0]) j++; const rangMoyen = (i + 1 + j) / 2; for (let k = i; k < j; k++) if (tout[k][1] === 1) rangVrais += rangMoyen; i = j; }
    const nv = vrais.length, nf = faux.length; return 1 - (rangVrais - nv * (nv + 1) / 2) / (nv * nf);
}
const quantile = (xs, f) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(f * s.length))]; };
function bilan(nom, vrais, faux, msParPaire) {
    const v = vrais.filter(Number.isFinite), f = faux.filter(Number.isFinite);
    const t99 = quantile(v, 0.99), t95 = quantile(v, 0.95);
    return { nom, vrais: v.length, faux: f.length, auc: +auc(v, f).toFixed(4), medianeVrais: +quantile(v, 0.5).toFixed(3), p95Vrais: +t95.toFixed(3), p99Vrais: +t99.toFixed(3), medianeFaux: +quantile(f, 0.5).toFixed(3),
        fauxSousP95Vrais: +(f.filter(d => d <= t95).length / f.length).toFixed(4), fauxSousP99Vrais: +(f.filter(d => d <= t99).length / f.length).toFixed(4), msParPaire: +msParPaire.toFixed(4) };
}
async function chrono(fn, n) { const t = process.hrtime.bigint(); const r = await fn(); return { r, ms: Number(process.hrtime.bigint() - t) / 1e6 / n }; }

(async () => {
    const produits = lireJson('etat-produits.json');
    const cm = lireJeu('empreintes-cm'), nous = lireJeu('empreintes-nous');
    const fpDe = p => { const iC = cm.index.get(p.idProduct), cle = p.visuel.entree?.vignette?.cle, iN = cle ? nous.index.get(cle) : undefined; return iC === undefined || iN === undefined ? null : { cm: cm.empreinte(iC), nous: nous.empreinte(iN), iC, iN }; };
    const bons = produits.filter(p => p.copieLocale && p.visuel.classe === 'A_COMPARER' && p.fiche.classe === 'FICHE_OK' && p.preuves.length === 1 && p.preuves[0] === 'set+numero')
        .map(p => ({ p, fp: fpDe(p) })).filter(x => x.fp && x.fp.cm && x.fp.nous && !E.sansContraste(x.fp.cm) && !E.sansContraste(x.fp.nous) && E.formatDeCarte(cm.meta.infos[x.fp.iC].w, cm.meta.infos[x.fp.iC].h) && E.formatDeCarte(nous.meta.infos[x.fp.iN].w, nous.meta.infos[x.fp.iN].h));
    console.log(`DÉNOMINATEUR : produits à comparer, fiche OK, preuve set+numero seule, copie et vignette lisibles, format de carte : ${bons.length} (sur ${produits.length})`);
    const r = alea(20261024);
    const N = 3000, pas = Math.floor(bons.length / N);
    const vrais = bons.filter((_, i) => i % pas === 0).slice(0, N);
    // les faux : la vignette de p contre la copie CM d'un produit q du MÊME set, de NOM différent (fiche OK aussi : sa copie est celle d'une autre carte)
    const parSet = new Map(); for (const x of bons) (parSet.get(x.p.setId) || parSet.set(x.p.setId, []).get(x.p.setId)).push(x);
    const nomDe = p => decomposerNomCardmarket(p.name).nom.toLowerCase();
    const faux = [];
    for (const x of vrais) {
        const autres = (parSet.get(x.p.setId) || []).filter(y => nomDe(y.p) !== nomDe(x.p));
        if (!autres.length) continue;
        const y = autres[Math.floor(r() * autres.length)];
        faux.push({ nous: x.fp.nous, cm: y.fp.cm, idNous: x.p.idProduct, idCm: y.p.idProduct, iN: x.fp.iN, iC: y.fp.iC });
    }
    console.log(`VRAIS ${vrais.length} · FAUX (même set, nom différent) ${faux.length} · graine 20261024`);
    const mesures = [];
    for (const [nom, f] of [['A. NCC avec recalage ±5/±4 (empreinte.js)', (a, b) => E.distance(a, b).distance], ['B. NCC 32×32 sans recalage (index-symboles.js, §69)', distanceB], ['C. dHash 64 bits (rejeté §69)', distanceC]]) {
        const dv = [], df = [];
        const t = await chrono(async () => { for (const x of vrais) dv.push(f(x.fp.nous, x.fp.cm)); for (const x of faux) df.push(f(x.nous, x.cm)); }, vrais.length + faux.length);
        mesures.push(bilan(nom, dv, df, t.ms));
    }
    console.table(mesures);

    // ── D. ORB + RANSAC (departage-image.js) : lent et fuyard (§15) → 120 paires de chaque
    const D = require('../departage-image');
    const { cv } = await D.outils();
    const idx = indexerDisque();
    const octetsNous = i => fs.readFileSync(sortie(`cache-nos-vignettes/${sha1(nous.meta.cles[i])}.webp`)), octetsCm = id => fs.readFileSync(idx.get(id));
    const nOrb = 120, orbV = vrais.slice(0, nOrb), orbF = faux.slice(0, nOrb);
    const inl = [];
    const t0 = process.hrtime.bigint();
    let paires = 0;
    for (const lot of [orbV.map(x => [octetsNous(x.fp.iN), octetsCm(x.p.idProduct)]), orbF.map(x => [octetsNous(x.iN), octetsCm(x.idCm)])]) {
        const sc = [];
        for (const [a, b] of lot) { const da = await D.decrire(a), db = await D.decrire(b); sc.push(D.inliers(cv, da, db)); paires++; }
        inl.push(sc);
    }
    const msOrb = Number(process.hrtime.bigint() - t0) / 1e6 / paires;
    // distance ORB : plus d'inliers = plus proche ; on rend 1/(1+inliers) pour réutiliser l'AUC
    const o = { nom: 'D. ORB + RANSAC (departage-image.js)', vrais: inl[0].length, faux: inl[1].length, auc: +auc(inl[0].map(n => 1 / (1 + n)), inl[1].map(n => 1 / (1 + n))).toFixed(4), inliersMedianeVrais: quantile(inl[0], 0.5), inliersMedianeFaux: quantile(inl[1], 0.5), msParPaireAvecDescription: +msOrb.toFixed(2) };
    console.table([o]);
    // A sur le MÊME échantillon réduit, pour une comparaison à taille égale
    const aV = orbV.map(x => E.distance(x.fp.nous, x.fp.cm).distance), aF = orbF.map(x => E.distance(x.nous, x.cm).distance);
    console.log(`A sur le même échantillon de ${nOrb}+${nOrb} : AUC ${auc(aV.filter(Number.isFinite), aF.filter(Number.isFinite)).toFixed(4)}`);
    ecrireJson('mesure-empreinte.json', { le: new Date().toISOString(), denominateur: { bons: bons.length, vrais: vrais.length, faux: faux.length }, candidats: mesures, orb: o });
    // les faux qui passent sous le p95 des vrais : à REGARDER (même dessin ? deux produits au même visuel ?)
    const f95 = quantile(vrais.map(x => E.distance(x.fp.nous, x.fp.cm).distance).filter(Number.isFinite), 0.95);
    const suspects = faux.map(x => ({ ...x, d: E.distance(x.nous, x.cm).distance })).filter(x => x.d <= f95).slice(0, 15);
    console.log(`faux sous le p95 des vrais (${f95.toFixed(3)}) : ${faux.filter(x => E.distance(x.nous, x.cm).distance <= f95).length}/${faux.length} ; exemples (idProduct vignette | idProduct copie) :`, suspects.map(x => `${x.idNous}|${x.idCm} d=${x.d.toFixed(2)}`).join(' · '));
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
