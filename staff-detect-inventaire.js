// STAFF-DETECT — inventaire des étiquettes incrustées sur TOUTES nos vignettes Cardmarket (détecteur d'image seule + OCR des candidats).
// Lecture seule du dossier du testeur. Usage : node staff-detect-inventaire.js <tmp> <sortie>
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const D = require('./collecte-cartes/staff-detect');
const IO = require('./collecte-cartes/staff-detect-io');

const { autoriser } = require('./collecte-cartes/garde-ecriture');
const [TMP_ARG, SORTIE_ARG] = process.argv.slice(2);
const TMP = autoriser(TMP_ARG), SORTIE = autoriser(SORTIE_ARG); // LÈVE avant toute écriture si hors des racines autorisées
fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(path.join(SORTIE, 'planches'), { recursive: true });

function alea(graine) { let s = graine >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

(async () => {
    const idx = IO.indexerDisque();
    const ids = [...idx.keys()].sort((a, b) => a - b);
    console.log('vignettes :', ids.length);
    const cand = [], idsEnErreur = [];
    let fait = 0, erreurs = 0;
    const CONC = 4; let k = 0;
    await Promise.all(Array.from({ length: CONC }, async () => {
        while (k < ids.length) {
            const id = ids[k++];
            try {
                const e = D.detecterEtiquette(await IO.charger(idx.get(id)));
                if (e.type) cand.push({ idProduct: id, type: e.type, bbox: e.bbox, remplissage: e.remplissage });
            } catch (err) { erreurs++; idsEnErreur.push(id); }
            if (++fait % 10000 === 0) console.log(fait, 'candidats', cand.length);
        }
    }));
    cand.sort((a, b) => a.idProduct - b.idProduct);
    console.log('candidats :', cand.length, 'erreurs de lecture :', erreurs);

    const ocr = IO.lancerOcr();
    try {
        for (const c of cand) {
            const crop = path.join(TMP, `c-${c.idProduct}.png`);
            await IO.recadrerBande(idx.get(c.idProduct), crop);
            const r = await ocr.lire(crop);
            c.ocr = (r.lignes || []).map(l => l.t);
            c.classe = D.classerTexte(c.ocr);
            fs.unlinkSync(crop);
        }
    } finally { ocr.fermer(); }

    const compte = {};
    for (const c of cand) { const cl = c.classe === null ? 'rien-lu' : c.classe.startsWith('autre:') ? 'autre' : c.classe; compte[cl] = (compte[cl] || 0) + 1; }
    const parTypeCouleur = {}; for (const c of cand) parTypeCouleur[c.type + '/' + (c.classe === null ? 'rien-lu' : c.classe.startsWith('autre:') ? 'autre' : c.classe)] = (parTypeCouleur[c.type + '/' + (c.classe === null ? 'rien-lu' : c.classe.startsWith('autre:') ? 'autre' : c.classe)] || 0) + 1;
    const autres = {}; for (const c of cand) if (c.classe && c.classe.startsWith('autre:')) autres[c.classe] = (autres[c.classe] || 0) + 1;
    const out = { date: new Date().toISOString().slice(0, 10), vignettes: ids.length, erreursLecture: erreurs, idsEnErreur, candidats: cand.length, comptes: compte, parTypeCouleur, autresTextes: autres, produits: cand };
    fs.writeFileSync(path.join(SORTIE, 'inventaire-etiquettes.json'), JSON.stringify(out, null, 1));
    console.log(JSON.stringify({ comptes: compte, parTypeCouleur }));

    // Échantillon à regarder : 30 candidats + 30 non-candidats tirés au sort (graine fixe).
    const r = alea(20261017), est = new Set(cand.map(c => c.idProduct));
    const tirer = (liste, n) => { const a = liste.slice(); const o = []; while (o.length < n && a.length) o.push(a.splice(Math.floor(r() * a.length), 1)[0]); return o; };
    const sC = tirer(cand.map(c => c.idProduct), 30), sN = tirer(ids.filter(i => !est.has(i)), 30);
    const planche = async (liste, nom, lib) => {
        const LH = 190, cols = 6, W = 135 * cols + 10, lignes = Math.ceil(liste.length / cols);
        const comp = [];
        for (let i = 0; i < liste.length; i++) {
            const b = await sharp(idx.get(liste[i])).resize({ width: 130, height: 175, fit: 'fill' }).png().toBuffer();
            const x = (i % cols) * 135 + 5, y = Math.floor(i / cols) * LH + 3;
            comp.push({ input: b, left: x, top: y });
            comp.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="130" height="14"><rect width="100%" height="100%" fill="#fff"/><text x="2" y="11" font-family="Arial" font-size="11">${i + 1}: ${liste[i]}</text></svg>`), left: x, top: y + 175 });
        }
        await sharp({ create: { width: W, height: lignes * LH + 6, channels: 3, background: '#888' } }).composite(comp).png().toFile(path.join(SORTIE, 'planches', nom));
        return liste;
    };
    const planCand = await planche(sC, 'echantillon-candidats.png'), planNon = await planche(sN, 'echantillon-non-candidats.png');
    fs.writeFileSync(path.join(SORTIE, 'echantillon-controle.json'), JSON.stringify({ graine: 20261017, candidats: planCand, nonCandidats: planNon }, null, 1));
})().catch(e => { console.error(e); process.exit(1); });
