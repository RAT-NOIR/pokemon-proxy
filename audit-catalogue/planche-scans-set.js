'use strict';
// ============================================================
// PLANCHE DE SCANS D'UN SET — lecture seule (cache de l'audit + R2 en GetObject) — agent catalogue, 2026-11-08
//   node audit-catalogue/planche-scans-set.js <setId> <dossierSortie> [n=4]
// Choisit n visuels du set répartis sur toute la liste (jamais les n premiers), les lit dans R2 (lecture-r2.js : lire(cle) seul) et écrit UNE planche PNG :
// chaque carte en entier à gauche, et sa BANDE BASSE (là où s'imprime le numéro) agrandie à droite. Sert à VÉRIFIER SUR SCANS qu'un set n'imprime aucun
// numéro de collection avant de l'inscrire à la table SANS_NUMERO_IMPRIME. N'écrit que dans <dossierSortie>.
// ============================================================
const fs = require('fs');
const path = require('path');

async function main() {
    const [set, sortie, nArg] = process.argv.slice(2);
    if (!set || !sortie) { console.error('usage : planche-scans-set.js <setId> <dossierSortie> [n]'); process.exit(2); }
    const n = Number(nArg || 4);
    const lecture = JSON.parse(fs.readFileSync('C:/Users/Yung/rat-market-travail/catalogue/audit-cache/lecture.json', 'utf8'));
    const vus = [];
    for (const c of lecture.cartes) for (const i of c.images || []) if (i.set === set && i.cleR2) vus.push({ nom: c.nomEn, numero: i.numero, cle: i.cleR2, w: i.w, h: i.h });
    if (!vus.length) { console.error(`${set} : aucun visuel en cache (population vide : on n'invente pas)`); process.exit(3); }
    const pas = vus.length / n;
    const choix = Array.from({ length: Math.min(n, vus.length) }, (_, k) => vus[Math.floor(k * pas + pas / 2)]);
    const { ouvrirR2Lecture } = require('./lecture-r2');
    const sharp = require('sharp');
    const r2 = await ouvrirR2Lecture();
    const H = 560, tuiles = [];
    for (const v of choix) {
        const buf = await r2.lire(v.cle);
        const m = await sharp(buf).metadata();
        const carte = await sharp(buf).resize({ height: H }).png().toBuffer();
        const cm = await sharp(carte).metadata();
        const bandeH = Math.round(m.height * 0.2), bande = await sharp(buf).extract({ left: 0, top: m.height - bandeH, width: m.width, height: bandeH }).resize({ width: 520 }).png().toBuffer();
        const bm = await sharp(bande).metadata();
        tuiles.push({ carte, cw: cm.width, bande, bw: bm.width, bh: bm.height, v });
    }
    const largeur = tuiles.reduce((a, t) => a + t.cw + 520 + 20, 0), W = Math.min(largeur, 5200);
    // une rangée par tuile : carte | bande basse
    const rangees = tuiles.map(t => sharp({ create: { width: t.cw + 520 + 20, height: H, channels: 3, background: '#ffffff' } }).composite([{ input: t.carte, left: 0, top: 0 }, { input: t.bande, left: t.cw + 20, top: Math.max(0, H - t.bh) }]).png().toBuffer());
    const bufs = await Promise.all(rangees);
    const wMax = Math.max(...tuiles.map(t => t.cw + 540));
    const planche = await sharp({ create: { width: wMax * 2, height: H * Math.ceil(bufs.length / 2), channels: 3, background: '#ffffff' } })
        .composite(bufs.map((b, k) => ({ input: b, left: (k % 2) * wMax, top: Math.floor(k / 2) * H }))).png().toBuffer();
    fs.mkdirSync(sortie, { recursive: true });
    const f = path.join(sortie, `${set}.png`);
    fs.writeFileSync(f, planche);
    console.log(`${set} : ${vus.length} visuels, ${choix.length} choisis -> ${f}`);
    console.log(choix.map(v => `  ${v.nom} (images.numero=${v.numero ?? 'null'}) ${v.w}x${v.h} ${v.cle}`).join('\n'));
    void W;
}
main().catch(e => { console.error(String(e && e.stack || e)); process.exit(1); });
