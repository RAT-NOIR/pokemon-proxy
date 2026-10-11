// ============================================================
// LA PLANCHE DES 3 HÉSITATIONS du 2026-10-11 (OR4, SM11B, SV11W) — référence Pokécardex à gauche, candidat à droite, nom du set et source
// ============================================================
//   node planche-logos-hesitation.js --cache=<dossier> [--pokecardex=<racine>] [--sortie=<fichier.png>]
// Les fichiers Pokécardex sont LUS pour être regardés, jamais collectés. Le candidat est demandé (au plus 3 requêtes, hôte billsarchive.com, robots relu,
// cadence de la collecte) à l'ADRESSE écrite sur la ligne de la table, ou relu du cache s'il y est déjà ; rien n'est écrit ailleurs que la planche.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { creerClient, verifierUrl, EXCLUS_2026_10_11 } = require('./collecter-logos-officiels');
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const cache = arg('cache'); if (!cache) { console.error('❌ --cache= requis'); process.exit(2); }
const racine = arg('pokecardex') || path.join(__dirname, '..', 'pokemon-proxy');
const sortie = arg('sortie') || path.join(__dirname, '..', 'LOGOS-HESITATION-2026-10-11.png');
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const table = require('./collecte-cartes/logos-officiels-table.json');
const NOTES = { OR4: 'contour rouge contre noir', SM11B: 'arc-en-ciel contre bleu', SV11W: 'teinte beige contre blanc/rouge' };
const [LB, HB, GAP, HR, LT] = [420, 150, 14, 200, 520], LARGEUR = LB * 2 + GAP * 3 + LT;
const case_ = async buf => {
    const img = await sharp(buf).flatten({ background: '#9aa0a6' }).resize(LB, HB, { fit: 'inside' }).png().toBuffer();
    const m = await sharp(img).metadata();
    return sharp({ create: { width: LB, height: HB, channels: 3, background: '#9aa0a6' } }).composite([{ input: img, left: Math.floor((LB - m.width) / 2), top: Math.floor((HB - m.height) / 2) }]).png().toBuffer();
};
(async () => {
    const cibles = EXCLUS_2026_10_11.filter(e => NOTES[(/\/([^/]+)\.png$/.exec(e.fichier) || [])[1]] && !/set non identifié/.test(e.raison));
    const client = creerClient();
    const comp = [];
    for (let i = 0; i < cibles.length; i++) {
        const e = cibles[i], l = table.lignes.find(x => x.part === e.part && x.fichier === e.fichier), code = /\/([^/]+)\.png$/.exec(e.fichier)[1];
        const rU = verifierUrl(l, l.urlChoisie); if (rU) throw new Error(`${code} : ${rU}`);
        const cle = path.join(cache, sha256(Buffer.from(l.urlChoisie)));
        let buf;
        if (fs.existsSync(`${cle}.bin`)) buf = fs.readFileSync(`${cle}.bin`);
        else { const r = await client.get(l.urlChoisie); if (r.status !== 200) throw new Error(`${code} : HTTP ${r.status}`); buf = r.buf; fs.writeFileSync(`${cle}.bin`, buf); fs.writeFileSync(`${cle}.json`, JSON.stringify({ url: l.urlChoisie, urlFinale: r.url, sha256: sha256(buf), le: new Date().toISOString() })); }
        const gauche = fs.readFileSync(path.join(racine, l.fichier)), y = i * HR + 8;
        comp.push({ input: await case_(gauche), left: GAP, top: y + 28 }, { input: await case_(buf), left: LB + GAP * 2, top: y + 28 });
        const txt = [`${i + 1}. ${code} — ${l.set}`, `différence : ${NOTES[code]}`, `source : billsarchive.com`, `score ${l.score}`, `fichier : ${path.posix.basename(l.urlChoisie)}`];
        const svg = `<svg width="${LARGEUR}" height="${HR}"><text x="${GAP}" y="18" font-size="16" font-family="Arial" font-weight="bold">Référence Pokécardex (lue, jamais collectée)</text><text x="${LB + GAP * 2}" y="18" font-size="16" font-family="Arial" font-weight="bold">candidat (Bill's Archive)</text>${txt.map((t, k) => `<text x="${LB * 2 + GAP * 3}" y="${40 + k * 26}" font-size="${k === 0 ? 20 : 16}" font-family="Arial" ${k === 0 ? 'font-weight="bold"' : ''}>${esc(t)}</text>`).join('')}<line x1="0" y1="${HR - 4}" x2="${LARGEUR}" y2="${HR - 4}" stroke="#444" stroke-width="2"/></svg>`;
        comp.push({ input: Buffer.from(svg), left: 0, top: y });
    }
    await sharp({ create: { width: LARGEUR, height: HR * cibles.length + 16, channels: 3, background: '#ffffff' } }).composite(comp).png().toFile(sortie);
    console.log(`${sortie} : ${cibles.length} rangées · requêtes ${JSON.stringify(client.compte)}`);
})().catch(e => { console.error(e.message); process.exit(1); });
