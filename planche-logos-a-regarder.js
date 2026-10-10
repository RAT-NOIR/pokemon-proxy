// ============================================================
// LA PLANCHE DES « À REGARDER » — une rangée par ligne : le fichier Pokécardex à gauche, le candidat à droite, au même gabarit
// ============================================================
//   node planche-logos-a-regarder.js --cache-jp=<dl> --cache-fr=<logos-FR> [--sortie=<dossier>]       → LOGOS-A-REGARDER-1.png, -2.png, -3.png
// Lecture seule, zéro requête. Les fichiers Pokécardex sont LUS pour être regardés, jamais collectés ; le candidat est celui que la phase 1 a téléchargé pour
// comparer (le cache) : le testeur tranche à l'œil, la collecte ne lit pas cette planche. Chaque rangée porte le fichier, le set de la ligne et le score.
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const [cacheJp, cacheFr] = [arg('cache-jp'), arg('cache-fr')];
if (!cacheJp || !cacheFr) { console.error('❌ --cache-jp= et --cache-fr= requis'); process.exit(2); }
const sortie = arg('sortie') || path.join(__dirname, '..', 'pokemon-proxy');
const table = JSON.parse(fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'logos-officiels-table.json'), 'utf8'));
const racine = arg('pokecardex') || path.join(__dirname, '..', 'pokemon-proxy');
const lignes = table.lignes.filter(l => l.verdict === 'À REGARDER');
const trouver = f => [path.join(cacheJp, 'bills', f), path.join(cacheJp, 'bulba', f), path.join(cacheFr, 'bills-logos', f), path.join(cacheFr, 'tcgdex', f)].find(fs.existsSync) ?? null;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const [LB, HB, GAP, HR, LT] = [330, 110, 14, 150, 560], LARGEUR = LB * 2 + GAP * 3 + LT, PAR_PLANCHE = 14;
const case_ = async (buf) => {
    if (!buf) return await sharp({ create: { width: LB, height: HB, channels: 3, background: '#d9d9d9' } }).png().toBuffer();
    const img = await sharp(buf).flatten({ background: '#9aa0a6' }).resize(LB, HB, { fit: 'inside' }).png().toBuffer();
    const m = await sharp(img).metadata();
    return await sharp({ create: { width: LB, height: HB, channels: 3, background: '#9aa0a6' } }).composite([{ input: img, left: Math.floor((LB - m.width) / 2), top: Math.floor((HB - m.height) / 2) }]).png().toBuffer();
};
(async () => {
    const n = Math.ceil(lignes.length / PAR_PLANCHE);
    for (let p = 0; p < n; p++) {
        const part = lignes.slice(p * PAR_PLANCHE, (p + 1) * PAR_PLANCHE), comp = [];
        for (let i = 0; i < part.length; i++) {
            const l = part[i], y = i * HR + 8, num = p * PAR_PLANCHE + i + 1;
            const gauche = fs.readFileSync(path.join(racine, l.fichier));
            const f = l.cache?.fichier ? trouver(l.cache.fichier) : null;
            const droite = f ? fs.readFileSync(f) : null;
            comp.push({ input: await case_(gauche), left: GAP, top: y + 24 });
            comp.push({ input: await case_(droite), left: LB + GAP * 2, top: y + 24 });
            const score = (/\d(?:\.\d+)?/.exec(String(l.score)) || [String(l.score).slice(0, 14)])[0], src = l.cache?.url ? new URL(l.cache.url).hostname.replace('web.archive.org', 'Bulbapedia (archive.org)') : 'aucun candidat en cache';
            const txt = [`${num}. ${l.fichier.replace(/^Logo (JP|FR)\//, '')}`, `set : ${l.set ?? '?'}${l.setSur ? '' : ' (non sûr)'}`, `score ${score}`, `candidat : ${l.cache?.fichier ?? '—'}`, `source : ${src}`];
            const svg = `<svg width="${LARGEUR}" height="${HR}"><text x="${GAP}" y="16" font-size="15" font-family="Arial" font-weight="bold">Pokécardex (lu, jamais collecté)</text><text x="${LB + GAP * 2}" y="16" font-size="15" font-family="Arial" font-weight="bold">candidat</text>${txt.map((t, k) => `<text x="${LB * 2 + GAP * 3}" y="${34 + k * 22}" font-size="${k === 0 ? 18 : 15}" font-family="Arial" ${k === 0 ? 'font-weight="bold"' : ''}>${esc(t)}</text>`).join('')}<line x1="0" y1="${HR - 4}" x2="${LARGEUR}" y2="${HR - 4}" stroke="#444" stroke-width="2"/></svg>`;
            comp.push({ input: Buffer.from(svg), left: 0, top: y - 8 + 8 });
        }
        const sortieP = path.join(sortie, `LOGOS-A-REGARDER-${p + 1}.png`);
        await sharp({ create: { width: LARGEUR, height: HR * part.length + 16, channels: 3, background: '#ffffff' } }).composite(comp).png().toFile(sortieP);
        console.log(`${sortieP} : ${part.length} rangées (${p * PAR_PLANCHE + 1} à ${p * PAR_PLANCHE + part.length}) sur ${lignes.length}`);
    }
})().catch(e => { console.error(e); process.exit(1); });
