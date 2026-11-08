// MUTATIONS REJOUABLES du décodeur : chaque mutation modifie UNE ligne d'une copie temporaire des modules, puis rejoue un échantillon des preuves contre Pillow. Une mutation qui laisse TOUT vert est « VIVANTE » :
// la preuve ne protège pas cette ligne. Le script sort en code 1 s'il reste une vivante. Les fichiers du dépôt ne sont jamais modifiés (copie dans le dossier temporaire).
//   node outils\decodeur\mutations.mjs [--liste]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
const PUB = path.join(import.meta.dirname, '..', '..', 'v2', 'banc-telephone', 'public'), FIX = path.join(import.meta.dirname, '..', '..', 'v2', 'test', 'fixtures-decodeur');
const FICHIERS = ['decodeur.mjs', 'decodeur-jpeg.mjs', 'decodeur-png.mjs', 'decodeur-webp.mjs', 'decodeur-webp-tables.mjs'];
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
// [nom, fichier, texte à remplacer, remplacement]
const M = [
    // ── JPEG
    ['IDCT : constante FIX_1_175875602', 'decodeur-jpeg.mjs', 'C1_175 = 9633', 'C1_175 = 9634'],
    ['IDCT : constante FIX_0_541196100', 'decodeur-jpeg.mjs', 'C0_541 = 4433', 'C0_541 = 4434'],
    ['IDCT : arrondi de la passe 1', 'decodeur-jpeg.mjs', '(tmp10 + tmp3 + 1024) >> 11', '(tmp10 + tmp3 + 1023) >> 11'],
    ['IDCT : arrondi de la passe 2', 'decodeur-jpeg.mjs', 'const R = 1 << 17;', 'const R = (1 << 17) - 1;'],
    ['IDCT : décalage du raccourci DC (colonne)', 'decodeur-jpeg.mjs', 'const d = (co[i] * q[c]) << 2;', 'const d = (co[i] * q[c]) << 1;'],
    ['IDCT : table de limitation (centre 128)', 'decodeur-jpeg.mjs', '(i < 512 ? i : i - 1024) + 128', '(i < 512 ? i : i - 1024) + 127'],
    ['couleur : Cr -> R (1,40200 -> 1,41)', 'decodeur-jpeg.mjs', 'FIX(1.40200)', 'FIX(1.41)'],
    ['couleur : Cb -> B (1,77200 -> 1,78)', 'decodeur-jpeg.mjs', 'FIX(1.77200)', 'FIX(1.78)'],
    ['couleur : Cr -> G (0,71414 -> 0,72)', 'decodeur-jpeg.mjs', 'FIX(0.71414)', 'FIX(0.72)'],
    ['couleur : Cb -> G (0,34414 -> 0,35)', 'decodeur-jpeg.mjs', 'FIX(0.34414)', 'FIX(0.35)'],
    ['couleur : arrondi ONE_HALF (1<<15 -> 1<<14)', 'decodeur-jpeg.mjs', 'MOITIE = 1 << 15', 'MOITIE = 1 << 14'],
    ['suréchantillonnage h2v2 : arrondi +8 -> +7', 'decodeur-jpeg.mjs', '(ce * 3 + der + 8) >> 4); mettre(2 * i + 1', '(ce * 3 + der + 7) >> 4); mettre(2 * i + 1'],
    ['suréchantillonnage h2v2 : colonne spéciale 0', 'decodeur-jpeg.mjs', 'mettre(0, (ce * 4 + 8) >> 4)', 'mettre(0, (ce * 4 + 7) >> 4)'],
    ['suréchantillonnage h2v2 : dernière colonne', 'decodeur-jpeg.mjs', 'mettre(2 * dw - 1, (ce * 4 + 7) >> 4)', 'mettre(2 * dw - 1, (ce * 4 + 8) >> 4)'],
    ['suréchantillonnage h2v1 : arrondi +2 -> +1', 'decodeur-jpeg.mjs', 'mettre(2 * i + 1, (v + plan[l + i + 1] + 2) >> 2)', 'mettre(2 * i + 1, (v + plan[l + i + 1] + 1) >> 2)'],
    ['suréchantillonnage h2v2 : rangée voisine (haut/bas inversés)', 'decodeur-jpeg.mjs', 'v === 0 ? ir - 1 : ir + 1));\n            const a = ir * pw, d = autre * pw, o = y * W;\n            const mettre', 'v === 0 ? ir + 1 : ir - 1));\n            const a = ir * pw, d = autre * pw, o = y * W;\n            const mettre'],
    ['progressif : raffinement AC (p1)', 'decodeur-jpeg.mjs', 'const p1 = 1 << al, m1 = -1 << al;', 'const p1 = 1 << al, m1 = -2 << al;'],
    ['progressif : EOBRUN', 'decodeur-jpeg.mjs', 'eobrun = bits(r) + (1 << r) - 1; break;', 'eobrun = bits(r) + (1 << r); break;'],
    ['JPEG : verrou de la table de quantification', 'decodeur-jpeg.mjs', 'if (!c.q) { const t = qt[c.tq];', 'if (true) { const t = qt[c.tq];'],
    ['JPEG : EXIF (orientation 6 <-> 8)', 'decodeur.mjs', 'case 6: x = oy; y = h - 1 - ox; break;', 'case 6: x = w - 1 - oy; y = ox; break;'],
    // ── PNG
    ['PNG : filtre Paeth (égalité b/c)', 'decodeur-png.mjs', 'pb <= pc ? up : c', 'pb < pc ? up : c'],
    ['PNG : filtre Average', 'decodeur-png.mjs', 'v += (a + up) >> 1;', 'v += (a + up + 1) >> 1;'],
    ['PNG : passe Adam7 (4,0)', 'decodeur-png.mjs', '[4, 0, 8, 8]', '[4, 1, 8, 8]'],
    ['PNG : palette (bit de poids fort)', 'decodeur-png.mjs', '(cour[bitpos >> 3] >> (8 - prof - (bitpos & 7)))', '(cour[bitpos >> 3] >> (bitpos & 7))'],
    ['PNG : adler32', 'decodeur-png.mjs', "refuser('DECODAGE', 'adler32 faux')", "void 0"],
    // ── WebP
    ['WebP : filtre de boucle, DoFilter6 (27a+63)', 'decodeur-webp.mjs', '(27 * a + 63) >> 7', '(27 * a + 62) >> 7'],
    ['WebP : filtre de boucle, DoFilter4 (a3)', 'decodeur-webp.mjs', 'a3 = (a1 + 1) >> 1;\n  p[i - 2 * s]', 'a3 = (a1 + 0) >> 1;\n  p[i - 2 * s]'],
    ['WebP : filtre simple (seuil)', 'decodeur-webp.mjs', 'simple(Y, yo, 1, sY, 16, limite + 4)', 'simple(Y, yo, 1, sY, 16, limite + 3)'],
    ['WebP : hev', 'decodeur-webp.mjs', 'abs0(p[i - 2 * s] - p[i - s]) > t', 'abs0(p[i - 2 * s] - p[i - s]) >= t'],
    ['WebP : netteté', 'decodeur-webp.mjs', 'il >>= lf.nettete > 4 ? 2 : 1;', 'il >>= lf.nettete > 3 ? 2 : 1;'],
    ['WebP : delta de filtre par mode', 'decodeur-webp.mjs', 'if (i4) niveau += lf.mode[0];', 'if (i4) niveau += lf.ref[0];'],
    ['WebP : transformée MUL2', 'decodeur-webp.mjs', 'a * 35468', 'a * 35469'],
    ['WebP : WHT arrondi', 'decodeur-webp.mjs', 'const dc = tmp[i * 4] + 3,', 'const dc = tmp[i * 4] + 2,'],
    ['WebP : upsampling, diagonale', 'decodeur-webp.mjs', 'avg = tl + t + l + c + 8;', 'avg = tl + t + l + c + 7;'],
    ['WebP : upsampling, premier pixel', 'decodeur-webp.mjs', '(3 * un(U, 0) + cn(U, 0) + 2) >> 2', '(3 * un(U, 0) + cn(U, 0) + 1) >> 2'],
    ['WebP : YUV -> R (26149)', 'decodeur-webp.mjs', 'mh(v, 26149)', 'mh(v, 26150)'],
    ['WebP : YUV -> G (6419)', 'decodeur-webp.mjs', 'mh(u, 6419)', 'mh(u, 6420)'],
    ['WebP : YUV -> B (33050)', 'decodeur-webp.mjs', 'mh(u, 33050)', 'mh(u, 33051)'],
    ['WebP : prédiction 4x4 VR', 'decodeur-webp.mjs', 'S(1, 3, avg3(I, X, A))', 'S(1, 3, avg3(J, X, A))'],
    ['WebP : prédiction 4x4 HU', 'decodeur-webp.mjs', 'S(3, 1, avg3(K, Lq, Lq))', 'S(3, 1, avg3(K, Lq, K))'],
    ['WebP : DC 16x16 (arrondi)', 'decodeur-webp.mjs', 'dc = (s + n) >> (lg + 1);', 'dc = (s + n - 1) >> (lg + 1);'],
    ['WebP : quantification Y2 AC (101581 -> 101781)', 'decodeur-webp.mjs', '* 101581)', '* 101781)'],
    ['WebP : quantification UV DC (plafond 117)', 'decodeur-webp.mjs', 'cl(q + dquvdc, 117)', 'cl(q + dquvdc, 127)'],
    ['WebP : segments absolus par défaut', 'decodeur-webp.mjs', 'majMap: 0, majData: 0, abs: 1, q:', 'majMap: 0, majData: 0, abs: 0, q:'],
    ['WebP : contexte de saut (DC non remis à zéro)', 'decodeur-webp.mjs', 'if (!i4) { topDc[mx] = 0; leftDc = 0; }', 'if (false) { topDc[mx] = 0; leftDc = 0; }'],
    ['WebP : partitions (rangée -> partition)', 'decodeur-webp.mjs', 'parts[my & (nparts - 1)]', 'parts[0]'],
    ['WebP : option coeffMaxWebp neutralisée', 'decodeur-webp.mjs', '(w > plafondRefus || w < -plafondRefus)', '(w > plafondRefus + 100000 || w < -plafondRefus - 100000)'],
    ['WebP : option coeffMaxWebp non transmise', 'decodeur.mjs', 'coeffMax: coeffMaxWebp', 'coeffMax: 0'],
    // ── réduction
    ['réduction : précision', 'decodeur.mjs', 'const PRECISION_BITS = 32 - 8 - 2;', 'const PRECISION_BITS = 32 - 8 - 3;'],
    ['réduction : forme du filtre (triangle -> parabole)', 'decodeur.mjs', 'return x < 1 ? 1 - x : 0;', 'return x < 1 ? 1 - x * x : 0;']
];
if (process.argv.includes('--liste')) { for (const [n] of M) console.log(n); process.exit(0); }

const lot = JSON.parse(fs.readFileSync(path.join(PUB, 'lot.json'), 'utf8'));
const syn = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-synthetique.json'), 'utf8'));
const refLot = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-lot.json'), 'utf8'));
const t1 = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-t1.json'), 'utf8'));
const dif = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-webp-differentiel.json'), 'utf8')), cible = JSON.parse(fs.readFileSync(path.join(FIX, 'pil-webp-differentiel-cible.json'), 'utf8'));
const EPREUVES = [];
for (const c of lot.cartes) EPREUVES.push({ o: Buffer.from(c.jpg, 'base64'), h: refLot.cartes[c.id].sha256 });
for (const c of syn.cas) if (!/lossless/.test(c.nom)) EPREUVES.push({ o: Buffer.from(c.b64, 'base64'), h: c.pil.sha256 });
for (const c of t1.cas) if (!c.balayages) EPREUVES.push(c.refuse ? { o: Buffer.from(c.b64, 'base64'), refuse: c.refuse } : { o: Buffer.from(c.b64, 'base64'), h: c.pil.sha256 });
for (const c of [...dif.cas, ...cible.cas]) EPREUVES.push({ o: Buffer.from(c.b64, 'base64'), h: c.pil.sha256 });
{   // T1-1 : l'option de refus des coefficients hors de la zone prouvée (un WebP bruité de Pillow doit être refusé à 300, accepté sans option)
    const b = Buffer.from(syn.cas.find(x => x.nom === 'webp-q95-100x75').b64, 'base64');
    EPREUVES.push({ o: b, refuse: 'NON_SUPPORTE', opts: { coeffMaxWebp: 300 } });
}
const EXIFS = syn.cas.filter(c => /exif/.test(c.nom) && c.format === 'jpeg').map(c => ({ o: Buffer.from(c.b64, 'base64'), h: c.pil.exif.sha256 }));
const REDUC = syn.reductions;

async function rejouer(D) {
    let rouge = 0;
    for (const e of EPREUVES) {
        try { const r = D.decoder(e.o, { orientation: 'aucune', ...(e.opts || {}) }); if (e.refuse || sha(r.rgb) !== e.h) rouge++; }
        catch (err) { if (!e.refuse || err.code !== e.refuse) rouge++; }
    }
    for (const e of EXIFS) { try { if (sha(D.decoder(e.o).rgb) !== e.h) rouge++; } catch { rouge++; } }
    for (const r of REDUC) { try { if (sha(D.redimRgb(Buffer.from(r.b64, 'base64'), r.w, r.h, r.W, r.H)) !== r.sha256) rouge++; } catch { rouge++; } }
    return rouge;
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutations-'));
let n = 0;
{   // témoin : les modules non mutés sont verts
    const d = path.join(tmp, 'temoin'); fs.mkdirSync(d);
    for (const f of FICHIERS) fs.copyFileSync(path.join(PUB, f), path.join(d, f));
    const r = await rejouer(await import(pathToFileURL(path.join(d, 'decodeur.mjs')).href));
    console.log(`témoin (non muté) : ${r} épreuve(s) rouge(s) sur ${EPREUVES.length + EXIFS.length + REDUC.length} — doit être 0`);
    if (r) process.exit(2);
}
const vivantes = [];
for (const [nom, fichier, de, vers] of M) {
    const d = path.join(tmp, 'm' + (n++)); fs.mkdirSync(d);
    for (const f of FICHIERS) fs.copyFileSync(path.join(PUB, f), path.join(d, f));
    const p = path.join(d, fichier), src = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
    if (!src.includes(de)) { console.log(`❌ MUTATION SANS PRISE (texte absent) : ${nom}`); vivantes.push(nom + ' (sans prise)'); continue; }
    fs.writeFileSync(p, src.replace(de, () => vers));
    const rouge = await rejouer(await import(pathToFileURL(path.join(d, 'decodeur.mjs')).href));
    console.log(`${rouge ? 'ROUGE   ' : 'VIVANTE '} ${String(rouge).padStart(4)}  ${nom}`);
    if (!rouge) vivantes.push(nom);
}
console.log(`\n${M.length} mutations, ${M.length - vivantes.length} tuées, ${vivantes.length} vivantes`);
for (const v of vivantes) console.log('  VIVANTE :', v);
process.exit(vivantes.length ? 1 : 0);
