// Relit par OCR le recadrage SERRÉ de chaque pastille candidate de l'inventaire (au lieu de la bande entière), puis reclasse.
// Usage : node staff-detect-ocr-pastilles.js <tmp> <inventaire-etiquettes.json>
'use strict';
const fs = require('fs');
const path = require('path');
const D = require('./collecte-cartes/staff-detect');
const IO = require('./collecte-cartes/staff-detect-io');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const [TMP_ARG, F_ARG] = process.argv.slice(2);
const TMP = autoriser(TMP_ARG), F = autoriser(F_ARG); // LÈVE avant toute écriture si hors des racines autorisées
fs.mkdirSync(TMP, { recursive: true });
(async () => {
    const inv = JSON.parse(fs.readFileSync(F, 'utf8'));
    const idx = IO.indexerDisque();
    const ocr = IO.lancerOcr();
    let n = 0;
    try {
        for (const c of inv.produits) {
            const crop = path.join(TMP, `p-${c.idProduct}.png`);
            await IO.recadrerPastille(idx.get(c.idProduct), c.bbox, crop);
            const r = await ocr.lire(crop);
            c.ocr = (r.lignes || []).map(l => l.t);
            fs.unlinkSync(crop);
            if (++n % 500 === 0) console.log(n);
        }
    } finally { ocr.fermer(); }
    inv.ocrSur = 'pastille (recadrage serré)';
    fs.writeFileSync(F, JSON.stringify(inv, null, 1));
    console.log('ok', n);
})().catch(e => { console.error(e); process.exit(1); });
