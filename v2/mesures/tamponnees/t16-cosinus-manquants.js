'use strict';
// GUICHET (tour 3) — le cosinus p8000 MANQUANT, calculé localement avec le MÊME modèle que l'index d'empreintes (p8000-poids8s) et le MÊME prétraitement (réduction bicubique « comme PIL » en 224 x 224 sur l'image entière,
// (px/255 - 0,5)/0,5, normalisation L2 : celui de modele-torch-reference.py et de la chaîne de l'extension, page.mjs). onnxruntime-web est lu EN PLACE dans le dépôt de l'extension (jamais copié ni modifié) ; les images sont NOS
// scans (caches locaux, puis bucket PUBLIC R2 via preuve-emprunt.js::lireImage) : aucune requête externe, aucune image Cardmarket.
// ÉTAPE 1 — VALIDATION : le vecteur recalculé d'images déjà dans l'index doit retrouver le vecteur de l'index (cosinus >= 0,98) ; sinon ARRÊT (le calcul n'est pas le même, aucun cosinus n'est rendu).
// ÉTAPE 2 — les produits donnés en argument (idProduct,...) : pour chaque référence sans cosinus, cosinus entre l'image refusée et la référence ; écrit t16-cosinus.json.
//   node t16-cosinus-manquants.js 894087,894097,...
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { ENV } = require('C:\\Users\\Yung\\rat-market-travail\\api\\atlas\\garde-secrets');
const WT = 'C:\\Users\\Yung\\rat-market-travail\\api\\v2-guichet', ESS = 'C:\\Users\\Yung\\rat-market-travail\\api\\archives\\essais-repli\\';
const ORT = 'C:\\Users\\Yung\\Desktop\\extension v2\\node_modules\\onnxruntime-web';
const MODELE_ONNX = 'C:\\Users\\Yung\\rat-market-travail\\api\\etude-sans-service\\onnx\\p8000-poids8s.onnx';
const sharp = require(path.join(WT, 'node_modules', 'sharp'));
const X = require('C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\v2\\identifier\\index-empreintes.js');
const EV = require('C:\\Users\\Yung\\Desktop\\pokemon-proxy-api-v2\\v2\\identifier\\empreinte-vecteur.js');
const P = require(path.join(WT, 'v2', 'mesures', 'preuve-emprunt'));
const MODELE = { id: 'p8000-poids8s-1', sha256: '857105e3eb0035c5e0b6eab88f898a134d171321eb00e90452f4d37f7df28ec2' };
const sha1 = s => crypto.createHash('sha1').update(s).digest('hex') + '.webp';
const DIRS = [path.join(ESS, 'images'), path.join(ESS, 'images-r2'), 'C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes-essai\\images', 'C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes\\images'];
const local = cle => { for (const d of DIRS) { const p = path.join(d, sha1(cle)); if (fs.existsSync(p)) return p; } return null; };
const cache = { lire: async cle => { const p = path.join(ESS, 'images-r2', sha1(cle)); return fs.existsSync(p) ? fs.readFileSync(p) : null; }, ecrire: async (cle, b) => fs.writeFileSync(path.join(ESS, 'images-r2', sha1(cle)), b) };
const image = async cle => { const p = local(cle); if (p) return fs.readFileSync(p); return P.lireImage(cle, { cache, attenteMs: 250 }); };

// réduction « comme PIL » (bicubique à support élargi), copie de la chaîne de l'extension (page.mjs::redimPIL), sur du RGB
const bicubique = x => { x = Math.abs(x); return x < 1 ? ((1.5 * x - 2.5) * x) * x + 1 : x < 2 ? ((-0.5 * x + 2.5) * x - 4) * x + 2 : 0; };
function coefficients(entree, sortie) {
    const echelle = entree / sortie, fe = Math.max(echelle, 1), support = 2 * fe, out = [];
    for (let i = 0; i < sortie; i++) {
        const centre = (i + 0.5) * echelle, xmin = Math.max(0, Math.floor(centre - support + 0.5)), xmax = Math.min(entree, Math.floor(centre + support + 0.5));
        const w = []; let s = 0; for (let x = xmin; x < xmax; x++) { const v = bicubique((x - centre + 0.5) / fe); w.push(v); s += v; }
        out.push({ xmin, w: w.map(v => v / s) });
    }
    return out;
}
function redimPIL(rgb, w, h, W2, H2) {
    const ch = coefficients(w, W2), cv_ = coefficients(h, H2), inter = new Uint8ClampedArray(W2 * h * 3);
    for (let y = 0; y < h; y++) for (let x = 0; x < W2; x++) { const { xmin, w: ws } = ch[x]; let r = 0, g = 0, b = 0; for (let k = 0; k < ws.length; k++) { const p = (y * w + xmin + k) * 3; r += rgb[p] * ws[k]; g += rgb[p + 1] * ws[k]; b += rgb[p + 2] * ws[k]; } const o = (y * W2 + x) * 3; inter[o] = Math.round(r); inter[o + 1] = Math.round(g); inter[o + 2] = Math.round(b); }
    const out = new Uint8ClampedArray(W2 * H2 * 3);
    for (let y = 0; y < H2; y++) { const { xmin, w: ws } = cv_[y]; for (let x = 0; x < W2; x++) { let r = 0, g = 0, b = 0; for (let k = 0; k < ws.length; k++) { const p = ((xmin + k) * W2 + x) * 3; r += inter[p] * ws[k]; g += inter[p + 1] * ws[k]; b += inter[p + 2] * ws[k]; } const o = (y * W2 + x) * 3; out[o] = Math.round(r); out[o + 1] = Math.round(g); out[o + 2] = Math.round(b); } }
    return out;
}
let session = null, ort = null;
async function ouvrir() {
    if (session) return;
    ort = require(ORT); ort.env.wasm.numThreads = 1;
    session = await ort.InferenceSession.create(new Uint8Array(fs.readFileSync(MODELE_ONNX)), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
}
const dansLeCache = new Map();
async function vecteur(cle) {
    if (dansLeCache.has(cle)) return dansLeCache.get(cle);
    const buf = await image(cle); let v = null;
    if (buf) {
        try {
            await ouvrir();
            const { data, info } = await sharp(buf).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
            const px = redimPIL(data, info.width, info.height, 224, 224), t = new Float32Array(3 * 224 * 224);
            for (let i = 0; i < 224 * 224; i++) for (let k = 0; k < 3; k++) t[k * 224 * 224 + i] = (px[i * 3 + k] / 255 - 0.5) / 0.5;
            const e = Array.from((await session.run({ pixel_values: new ort.Tensor('float32', t, [1, 3, 224, 224]) })).emb.data);
            const n = Math.sqrt(e.reduce((s, x) => s + x * x, 0)); v = Float32Array.from(e.map(x => x / n));
        } catch { v = null; }
    }
    dansLeCache.set(cle, v); return v;
}
const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
module.exports = { vecteur, dot, image };

if (require.main === module) (async () => {
    const o = X.ouvrir(fs.readFileSync('C:\\Users\\Yung\\rat-market-travail\\api\\index-empreintes-essai\\sortie\\index-empreintes-2026-10-24.rmei'), ENV.V2_VISUELS_HMAC, { modeleAttendu: MODELE });
    const idx = o.index, ligne = new Map(idx.cles.map((c, i) => [c, i]));
    const vecIdx = c => { const r = ligne.get(c); if (r === undefined) return null; const v = new Float32Array(256); for (let j = 0; j < 256; j++) v[j] = EV.demiVersFlottant(idx.mat16[r * 256 + j]); return v; };
    // ÉTAPE 1 — validation sur des images de l'index présentes dans les caches locaux
    const valid = []; for (const c of idx.cles) { if (local(c)) valid.push(c); if (valid.length >= 40) break; }
    const cosv = []; for (const c of valid) { const v = await vecteur(c); if (v) cosv.push(+dot(v, vecIdx(c)).toFixed(4)); }
    cosv.sort((a, b) => a - b);
    console.log('VALIDATION : images de l\'index recalculées', cosv.length, '| cosinus recalculé/index : min', cosv[0], 'médiane', cosv[Math.floor(cosv.length / 2)], 'max', cosv[cosv.length - 1]);
    if (!cosv.length || cosv[0] < 0.98) { console.log('ARRÊT : le calcul local ne retrouve pas le vecteur de l\'index (minimum < 0,98) ; aucun cosinus n\'est rendu'); process.exit(1); }
    // ÉTAPE 2
    const ids = (process.argv[2] || '').split(',').map(Number).filter(Boolean);
    const t8 = new Map(JSON.parse(fs.readFileSync(path.join(ESS, 't8-preuve.json'), 'utf8')).map(r => [r.idProduct, r]));
    const t1 = new Map(JSON.parse(fs.readFileSync(path.join(ESS, 't1-refuses.json'), 'utf8')).map(r => [r.idProduct, r]));
    const res = {};
    for (const id of ids) {
        const r = t8.get(id), rf = t1.get(id); if (!r || !rf) { res[id] = { erreur: 'produit inconnu des mesures' }; continue; }
        const va = await vecteur(rf.im.cleR2); const refs = [];
        for (const m of r.mesures) {
            if (m.cos !== null) { refs.push({ cle: m.cle, cos: m.cos, source: 'index' }); continue; }
            const vb = await vecteur(m.cle);
            refs.push({ cle: m.cle, cos: va && vb ? +dot(va, vb).toFixed(4) : null, source: va && vb ? 'calcule' : 'non-calculable' });
        }
        res[id] = { refusee: rf.im.cleR2, imageRefuseeLue: Boolean(va), refs };
        console.log(id, rf.set, JSON.stringify(refs.map(x => [x.source[0], x.cos])));
    }
    fs.writeFileSync(path.join(ESS, 't16-cosinus.json'), JSON.stringify({ validation: { n: cosv.length, min: cosv[0], mediane: cosv[Math.floor(cosv.length / 2)] }, res }));
    process.exit(0);
})().catch(e => { console.log('ERREUR', e && e.message, String(e && e.stack).split('\n').slice(1, 3).join('|')); process.exit(1); });
