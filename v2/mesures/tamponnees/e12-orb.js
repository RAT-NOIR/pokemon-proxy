'use strict';
// Instrument « dessin de la fenêtre d'illustration » : ORB + RANSAC de la PRODUCTION (departage-image.js : decrire, inliers) sur le découpage central de chaque visuel, calé sur les étiquettes DE L'ŒIL.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { API } = require('C:\\Users\\Yung\\rat-market-travail\\api\\atlas\\garde-secrets');
const D = require(path.join(API, 'departage-image.js'));
const sharp = require(path.join(API, 'node_modules', 'sharp'));
const E = 'C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes-essai\\';
const DIRS = [path.join(__dirname, 'images'), E + 'images', 'C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes\\images', 'C:\\Users\\Yung\\rat-market-travail\\api\\modele-visuel-hors-ligne\\cache-archive\\img'];
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex') + '.webp';
const local = cle => { if (!cle) return null; for (const x of DIRS) { const p = path.join(x, sha1(cle)); if (fs.existsSync(p)) return p; } return null; };
const FEN = { l: 0.07, t: 0.11, w: 0.86, h: 0.41 };      // fenêtre d'illustration d'une carte standard (x 7-93 %, y 11-52 %)
async function fenetre(p) {
    const m = await sharp(p).metadata(); const W = m.width, H = m.height;
    return sharp(p).extract({ left: Math.round(W * FEN.l), top: Math.round(H * FEN.t), width: Math.round(W * FEN.w), height: Math.round(H * FEN.h) }).resize({ width: 640 }).png().toBuffer();
}
const cache = new Map();
const desc = async (cle, mode) => { const k = mode + cle; if (!cache.has(k)) { const p = local(cle); if (!p) cache.set(k, null); else cache.set(k, await D.decrire(mode === 'fen' ? await fenetre(p) : fs.readFileSync(p))); } return cache.get(k); };
module.exports = { desc, local, D };
if (require.main === module) (async () => {
    const { cv } = await D.outils();
    const L = {
        same: [867588, 902176, 743195, 860802, 869116, 850192, 557907, 886877, 860833, 902178, 743167, 860791, 902201, 744656, 902397, 902205, 744651, 743190],
        differ: [886785, 869122, 699267, 743170, 669115, 860909, 892454, 886777, 698934, 886353, 860815, 825275]
    };
    const lab = new Map(); for (const i of L.same) lab.set(i, 'same'); for (const i of L.differ) lab.set(i, 'differ');
    for (const f of ['ech-meme.json']) for (const x of JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'))) lab.set(x.id, 'same');
    for (const i of [565045, 886748, 869099, 825341, 743171, 877383, 571922, 886863, 889672, 902110, 892335, 903471, 881840, 860961, 743189, 571151, 783119, 860805, 852123, 850249, 678030, 860807, 869156, 886717, 756331, 869155]) lab.set(i, 'same');
    lab.set(902086, 'differ');
    const pairs = [...JSON.parse(fs.readFileSync(path.join(__dirname, 'ech-different.json'), 'utf8')), ...JSON.parse(fs.readFileSync(path.join(__dirname, 'ech-meme.json'), 'utf8')), ...JSON.parse(fs.readFileSync(path.join(__dirname, 'ech-indec.json'), 'utf8'))];
    const out = [];
    for (const p of pairs) {
        if (!lab.has(p.id) || !p.b) continue;
        const r = { id: p.id, tag: p.tag, eye: lab.get(p.id) };
        for (const mode of ['fen', 'full']) { const a = await desc(p.a, mode), b = await desc(p.b, mode); r[mode] = a && b ? D.inliers(cv, a, b) : null; r[mode + 'n'] = a && b ? [a.n, b.n] : null; }
        out.push(r);
    }
    fs.writeFileSync(path.join(__dirname, 'e12-calib.json'), JSON.stringify(out));
    for (const m of ['fen', 'full']) {
        const s = out.filter(x => x.eye === 'same' && x[m] !== null).map(x => x[m]).sort((a, b) => a - b), d = out.filter(x => x.eye === 'differ' && x[m] !== null).map(x => x[m]).sort((a, b) => a - b);
        console.log(m, 'same n', s.length, 'min', s[0], 'p10', s[Math.floor(s.length * 0.1)], 'médiane', s[Math.floor(s.length / 2)], '| differ n', d.length, 'max', d[d.length - 1], 'liste', d.join(','));
        console.log(m, 'same liste', s.join(','));
    }
    process.exit(0);
})().catch(e => { console.log('ERREUR', e && e.message, String(e && e.stack).split('\n').slice(1, 3).join('|')); process.exit(1); });
