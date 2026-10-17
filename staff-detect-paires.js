// STAFF-DETECT — verdict des 64 paires + planches de contrôle. Lecture seule du dossier du testeur, aucun réseau, aucune base.
// Usage : node staff-detect-paires.js <dossier-temporaire> <dossier-sortie>
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const D = require('./collecte-cartes/staff-detect');
const IO = require('./collecte-cartes/staff-detect-io');

const PAIRES = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\couverture\\S7\\CM-PASSIF\\ADRESSES-64-PAIRES.json';
const [TMP, SORTIE] = process.argv.slice(2);
if (!TMP || !SORTIE) { console.error('usage : node staff-detect-paires.js <tmp> <sortie>'); process.exit(1); }
fs.mkdirSync(TMP, { recursive: true }); fs.mkdirSync(path.join(SORTIE, 'planches'), { recursive: true });

function svg(texte, w, h, taille = 14, fond = '#fff') {
    const e = String(texte).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const lignes = e.split('\n').map((l, i) => `<text x="6" y="${taille + 4 + i * (taille + 4)}" font-family="Arial" font-size="${taille}" fill="#000">${l}</text>`).join('');
    return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${fond}"/>${lignes}</svg>`);
}

(async () => {
    const idx = IO.indexerDisque();
    const P = JSON.parse(fs.readFileSync(PAIRES, 'utf8'));
    const ocr = IO.lancerOcr();
    const res = [];
    try {
        for (const p of P) {
            const [v1, v2] = p.versions;
            const f1 = idx.get(v1.idProduct), f2 = idx.get(v2.idProduct);
            const a = await IO.charger(f1), b = await IO.charger(f2);
            const cmp = D.comparerPaire(a, b);
            const cote = cmp.etiquetee;
            let ocrType = null, lignes = [], etq = null, fEtq = null;
            if (cote) {
                etq = cote === 'A' ? cmp.etiquetteA : cmp.etiquetteB;
                fEtq = cote === 'A' ? f1 : f2;
                const crop = path.join(TMP, `bande-${p.n}.png`);
                await IO.recadrerPastille(fEtq, etq.bbox, crop);
                const r = await ocr.lire(crop);
                lignes = (r.lignes || []).map(l => l.t);
                ocrType = D.classerTexte(lignes);
            }
            const v = D.verdictPaire(cmp, etq, ocrType);
            const idEtq = cote ? (cote === 'A' ? v1.idProduct : v2.idProduct) : null;
            const idNorm = cote ? (cote === 'A' ? v2.idProduct : v1.idProduct) : null;
            const dEtq = cote ? (cote === 'A' ? v1 : v2).dateAdded : null, dNorm = cote ? (cote === 'A' ? v2 : v1).dateAdded : null;
            const o = {
                n: p.n, set: p.set, numero: p.numero, nom: p.nom, tamponAttendu: p.tampon, verdict: v.verdict, motif: v.motif || null,
                idEtiquete: v.verdict === 'douteux' ? null : idEtq, idNormale: v.verdict === 'douteux' ? null : idNorm,
                etiquetteVue: cote ? { cote, type: etq.type, bbox: etq.bbox } : null, ocr: lignes, ocrType,
                partBas: Math.round(cmp.partBas * 100) / 100, ecartTotal: cmp.ecartTotal,
                etiqueteeEstV2: cote ? cote === 'B' : null, etiqueteeEstLaPlusRecente: cote ? new Date(dEtq) >= new Date(dNorm) : null,
                dateAdded: { V1: v1.dateAdded, V2: v2.dateAdded }, idV1: v1.idProduct, idV2: v2.idProduct,
            };
            if (v.verdict === 'douteux' && !cote) o.motif = 'aucune pastille Cardmarket sur aucune des deux (STAFF éventuellement imprimé sur la carte elle-même)';
            res.push(o);
        }
    } finally { ocr.fermer(); }
    fs.writeFileSync(path.join(SORTIE, 'verdicts-64-paires.json'), JSON.stringify(res, null, 1));

    // Planches : 8 paires par planche — V1, V2, bande du bas de chaque côté agrandie, verdict.
    const PAR = 8, LH = 210;
    for (let pl = 0; pl * PAR < res.length; pl++) {
        const lignes = [];
        for (const o of res.slice(pl * PAR, pl * PAR + PAR)) {
            const th = async id => sharp(idx.get(id)).resize({ height: LH - 10 }).png().toBuffer();
            const bd = async id => { const m = await sharp(idx.get(id)).metadata(); const top = Math.floor(m.height * 0.8); return sharp(idx.get(id)).extract({ left: 0, top, width: m.width, height: m.height - top }).resize({ width: 380 }).png().toBuffer(); };
            const t1 = await th(o.idV1), t2 = await th(o.idV2), b1 = await bd(o.idV1), b2 = await bd(o.idV2);
            const txt = `#${o.n} ${o.set.replace('-Black-Star-Promos', '')} ${o.numero}\n${o.nom.slice(0, 26)}\nVERDICT : ${o.verdict}\n${o.motif ? o.motif.slice(0, 40) : 'etiquette = ' + (o.etiqueteeEstV2 ? 'V2' : 'V1') + ' ' + (o.etiquetteVue ? o.etiquetteVue.type : '')}\nOCR : ${(o.ocr || []).join(' / ').slice(0, 36)}\nV1 ${o.idV1} ${o.dateAdded.V1.slice(0, 10)}\nV2 ${o.idV2} ${o.dateAdded.V2.slice(0, 10)}`;
            const w1 = (await sharp(t1).metadata()).width, w2 = (await sharp(t2).metadata()).width;
            const W = 300 + w1 + w2 + 380 + 30;
            const ligne = await sharp({ create: { width: W, height: LH, channels: 3, background: '#ddd' } }).composite([
                { input: svg(txt, 300, LH, 13), left: 0, top: 0 },
                { input: t1, left: 305, top: 5 }, { input: t2, left: 305 + w1 + 5, top: 5 },
                { input: b1, left: 305 + w1 + w2 + 10, top: 5 }, { input: b2, left: 305 + w1 + w2 + 10, top: 5 + 75 },
            ]).png().toBuffer();
            lignes.push({ input: ligne, w: W });
        }
        const Wm = Math.max(...lignes.map(l => l.w));
        let y = 0;
        await sharp({ create: { width: Wm, height: lignes.length * LH, channels: 3, background: '#999' } })
            .composite(lignes.map(l => { const o = { input: l.input, left: 0, top: y }; y += LH; return o; }))
            .png().toFile(path.join(SORTIE, 'planches', `paires-${String(pl + 1).padStart(2, '0')}.png`));
    }
    const cnt = {}; for (const o of res) cnt[o.verdict] = (cnt[o.verdict] || 0) + 1;
    console.log(JSON.stringify(cnt));
    console.log('etiquetee == V2 :', res.filter(o => o.etiqueteeEstV2).length, '/', res.filter(o => o.etiquetteVue).length);
    console.log('douteux :', res.filter(o => o.verdict === 'douteux').map(o => o.n + ':' + o.motif).join(' ; '));
})().catch(e => { console.error(e); process.exit(1); });
