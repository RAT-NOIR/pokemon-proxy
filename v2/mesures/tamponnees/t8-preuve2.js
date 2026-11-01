'use strict';
// GUICHET (passage 8) — la preuve STRICTE refaite avec l'outil RÉPARÉ : les images manquantes sont lues sur le bucket PUBLIC R2 (v2/mesures/preuve-emprunt.js::lireImage, cache local propre à cet outil), la fenêtre ORB
// est calculée pour CHAQUE paire (elle ne l'était que pour 3 paires sur 5 300 : les caches locaux ne contiennent que ~2 000 images), la 3e concordance (zone souple du catalogue) pour les seuls « hésitants ».
// Entrée : t1-refuses.json, t2-preuve.json (cosinus de l'index du 24/10). Sorties : t8-preuve.json, tamponnees-empruntees-2026-11-01b.json (liste fermée). Lecture seule, aucune image Cardmarket.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { API } = require('C:\\Users\\Yung\\rat-market-travail\\api\\atlas\\garde-secrets');
const WT = 'C:\\Users\\Yung\\rat-market-travail\\api\\v2-guichet', ARCH = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\';
const P = require(path.join(WT, 'v2', 'mesures', 'preuve-emprunt'));
const D = require(path.join(API, 'departage-image.js'));
const sharp = require(path.join(WT, 'node_modules', 'sharp'));
const CACHE = path.join(__dirname, 'images-r2'); fs.mkdirSync(CACHE, { recursive: true });
const nomCache = cle => path.join(CACHE, crypto.createHash('sha1').update(cle).digest('hex') + '.webp');
const cache = { lire: async cle => { const p = nomCache(cle); return fs.existsSync(p) ? fs.readFileSync(p) : null; }, ecrire: async (cle, b) => fs.writeFileSync(nomCache(cle), b) };
// images déjà dans les anciens caches locaux : lues d'abord (zéro requête)
const ANCIENS = [path.join(__dirname, 'images'), 'C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes-essai\\images', 'C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes\\images'];
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex') + '.webp';
let requetes = 0, depuisAnciens = 0, nuls = 0;
const lire = async cle => {
    for (const d of ANCIENS) { const p = path.join(d, sha1(cle)); if (fs.existsSync(p)) { depuisAnciens++; return fs.readFileSync(p); } }
    const avant = fs.existsSync(nomCache(cle)); const b = await P.lireImage(cle, { cache, attenteMs: 250 }); if (!avant) requetes++; if (!b) nuls++; return b;
};
const FEN = { l: 0.07, t: 0.11, w: 0.86, h: 0.41 };
const fenetre = async buf => { const m = await sharp(buf).metadata(); const W = m.width, H = m.height; return sharp(buf).extract({ left: Math.round(W * FEN.l), top: Math.round(H * FEN.t), width: Math.round(W * FEN.w), height: Math.round(H * FEN.h) }).resize({ width: 640 }).png().toBuffer(); };
const dct1d = v => { const n = v.length, out = new Array(n); for (let k = 0; k < n; k++) { let s = 0; for (let i = 0; i < n; i++) s += v[i] * Math.cos(Math.PI * k * (2 * i + 1) / (2 * n)); out[k] = 2 * s; } return out; };
async function phash(buf) {      // reproduction de l'algorithme du catalogue (concordance-image.js) : gris 32x32, DCT 2D, bloc 8x8, médiane
    const { data } = await sharp(buf).greyscale().resize(32, 32, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    const l1 = []; for (let y = 0; y < 32; y++) l1.push(dct1d(Array.from(data.subarray(y * 32, y * 32 + 32))));
    const d = Array.from({ length: 32 }, () => new Array(32));
    for (let x = 0; x < 32; x++) { const col = dct1d(l1.map(r => r[x])); for (let y = 0; y < 32; y++) d[y][x] = col[y]; }
    const bloc = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bloc.push(d[y][x]);
    const tri = [...bloc].sort((a, b) => a - b), med = (tri[31] + tri[32]) / 2; return bloc.map(c => (c > med ? 1 : 0));
}
const ham = (a, b) => a.reduce((n, x, i) => n + (x !== b[i] ? 1 : 0), 0);
const descCache = new Map();
const desc = async (cle, mode) => { const k = mode + cle; if (descCache.has(k)) return descCache.get(k); const b = await lire(cle); let d = null; try { if (b) d = await D.decrire(mode === 'fen' ? await fenetre(b) : b); } catch { d = null; } descCache.set(k, d); return d; };
const hashCache = new Map();
const hashDe = async cle => { if (hashCache.has(cle)) return hashCache.get(cle); const b = await lire(cle); let h = null; try { if (b) h = await phash(b); } catch { h = null; } hashCache.set(cle, h); return h; };
module.exports = { phash, ham, fenetre, lire };
if (require.main === module) (async () => {
    const { cv } = await D.outils();
    const refuses = new Map(JSON.parse(fs.readFileSync(path.join(__dirname, 't1-refuses.json'), 'utf8')).map(r => [r.idProduct, r]));
    const t2 = JSON.parse(fs.readFileSync(path.join(__dirname, 't2-preuve.json'), 'utf8'));
    const res = []; let n = 0;
    for (const r of t2) {
        const rf = refuses.get(r.idProduct); const cle = rf && rf.im && rf.im.cleR2;
        if (!cle || !r.mesures.length) { res.push({ idProduct: r.idProduct, refus: r.refus, set: r.set, ancien: r.classe, classe: 'indecidable', detail: 'sans-reference', sous: 'pas d\'image ou aucune référence', mesures: [] }); continue; }
        const da = await desc(cle, 'fen');
        const mesures = [];
        for (const m of r.mesures) {
            const db = da ? await desc(m.cle, 'fen') : null;
            mesures.push({ cle: m.cle, set: m.set, tir: m.tir, cos: m.cos, fen: da && db ? D.inliers(cv, da, db) : null });
        }
        let out = P.classer(mesures);
        if (out.detail === 'hesitante') {      // 3e concordance : pHash + ORB sur les images entières, pour les seules références qui ne concordent pas déjà
            const ha = await hashCache.get(cle) ?? await hashDe(cle), fa = await desc(cle, 'plein');
            for (const m of mesures) {
                const concorde = (m.fen !== null && m.fen >= 30) || (m.cos !== null && m.cos >= 0.9); if (concorde) continue;
                const hb = await hashDe(m.cle), fb = fa ? await desc(m.cle, 'plein') : null;
                m.tierce = ha && hb && fa && fb ? { phash: ham(ha, hb), inliers: D.inliers(cv, fa, fb) } : null;
            }
            out = P.classerAvecTroisieme(mesures);
        }
        res.push({ idProduct: r.idProduct, refus: r.refus, set: r.set, ancien: r.classe, classe: out.classe, detail: out.detail, sous: out.sous, nRefs: mesures.length, mesures });
        if (++n % 25 === 0) console.log(n, 'requêtes', requetes, 'anciens', depuisAnciens, 'nuls', nuls);
    }
    fs.writeFileSync(path.join(__dirname, 't8-preuve.json'), JSON.stringify(res));
    const T = {}; for (const x of res) { const k = x.refus + (/^Trick/.test(x.set) ? ' (ToT)' : '') + ' | ' + x.classe + ' / ' + x.detail; T[k] = (T[k] || 0) + 1; }
    console.log('dénominateur', res.length, 'requêtes R2', requetes, 'images nulles', nuls); console.log(JSON.stringify(Object.entries(T).sort(), null, 1));
    const admis = res.filter(x => x.classe === 'meme').map(x => ({ idProduct: x.idProduct, preuve: `${x.sous} (fenêtre >= 30 inliers ou cosinus >= 0,9 contre chacun ; preuve-emprunt.js)` })).sort((a, b) => a.idProduct - b.idProduct);
    fs.writeFileSync(ARCH + 'tamponnees-empruntees-2026-11-01b.json', JSON.stringify({ decision: 'GUICHET 01/11 passage 8 : tamponnées servies EMPRUNTÉES, preuve stricte (outil réparé)', le: '2026-11-01', produits: admis }, null, 1));
    console.log('liste fermée :', admis.length);
    process.exit(0);
})().catch(e => { console.log('ERREUR', e && e.message, String(e && e.stack).split('\n').slice(1, 4).join('|')); process.exit(1); });
