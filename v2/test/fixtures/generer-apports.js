'use strict';
// TESTS-APPORTS (2026-10-13) — fabrique les fichiers d'apport SYNTHÉTIQUES de test-logos-sortie-identique.js, sous v2/test/fixtures/apports/ :
// des PNG générés par `sharp` (motif de bandes + couleur propre à chaque fichier), aux MÊMES dimensions que les originaux (champs w/h de la référence
// gelée logos-sortie-avant.json), à la même arborescence relative (champ `fichier` de la référence), et la table `table-apports-synthetique.json`
// au format de la table des logos lus de collecte-cartes/ avec les sha1 des fichiers synthétiques.
// JAMAIS une copie, un recadrage ni une dérivation d'un logo réel : seules les DIMENSIONS, les noms de fichier, le partage (deux codes = un même
// fichier) et le texte « lu » viennent de la référence ; les pixels sortent d'un compteur.
//   node v2/test/fixtures/generer-apports.js
const fs = require('fs'); const path = require('path'); const crypto = require('crypto');
const sharp = require('sharp');
const REF = JSON.parse(fs.readFileSync(path.join(__dirname, 'logos-sortie-avant.json'), 'utf8'));
const RACINE = path.join(__dirname, 'apports');
const TABLE = path.join(__dirname, 'table-apports-synthetique.json');

async function png(w, h, n) {
    const buf = Buffer.alloc(w * h * 3);
    const base = [(n * 53 + 40) % 256, (n * 97 + 90) % 256, (n * 29 + 150) % 256];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3, bande = ((x + y + n * 7) >> 3) & 1;
        for (let c = 0; c < 3; c++) buf[i + c] = bande ? base[c] : 255 - base[c];
    }
    return sharp(buf, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 9 }).toBuffer();
}
const sha1 = b => crypto.createHash('sha1').update(b).digest('hex');

(async () => {
    let n = 0;
    const ecrire = async (rel, w, h, cle) => {
        const b = await png(w, h, cle);
        const dest = path.join(RACINE, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, b);
        return sha1(b);
    };
    const attendus = {};   // sha1 ENGAGÉ de chaque fichier synthétique : le banc le confronte au fichier lu (un pixel changé le fait rougir)
    for (const w of REF.wcd) attendus[w.fichier] = await ecrire(w.fichier, w.w, w.h, ++n);
    // un motif par fichier ORIGINAL distinct (les codes qui partageaient un fichier le partagent encore : `partageAvec` dépend de l'égalité des sha1)
    const parOriginal = new Map(), lignes = [];
    for (const p of REF.logosPartages) {
        if (!parOriginal.has(p.sha1)) parOriginal.set(p.sha1, await ecrire(p.fichier, p.w, p.h, ++n));
        const sha = parOriginal.get(p.sha1);
        const dest = path.join(RACINE, p.fichier);
        if (!fs.existsSync(dest) || sha1(fs.readFileSync(dest)) !== sha) fs.mkdirSync(path.dirname(dest), { recursive: true }), fs.copyFileSync(path.join(RACINE, [...REF.logosPartages].find(q => q.sha1 === p.sha1).fichier), dest);
        attendus[p.fichier] = sha;
        lignes.push({ dossier: path.basename(path.dirname(p.fichier)), fichier: path.basename(p.fichier), sha1: sha, lu: p.lu });
    }
    fs.writeFileSync(TABLE, JSON.stringify({ lu: '2026-10-13', comment: 'table SYNTHÉTIQUE (format de la table des logos lus de collecte-cartes/) : sha1 des PNG générés par generer-apports.js, textes « lu » de la référence gelée', attendus, lignes }, null, 1));
    console.log(`→ ${REF.wcd.length} fichiers wcd + ${REF.logosPartages.length} partagés (${parOriginal.size} motifs distincts) sous ${RACINE} ; table ${TABLE}`);
})().catch(e => { console.error('❌', e); process.exit(1); });
