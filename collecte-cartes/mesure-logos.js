// Les DEUX mesures de la phase 1 des logos officiels (2026-10-08), recopiées MOT POUR MOT de leurs instruments — la collecte re-mesure avec la MÊME
// fonction que celle qui a rendu le verdict, jamais avec une copie réécrite (§21 bis, le motif en tête du catalogue : la sonde ≠ la production).
//   FR : signature de PRODUCTION (index-symboles.js : gris, rognée, 32x32, corrélation normalisée) + rapport de forme ; seuil corr ≥ 0.99.
//   JP : signature « sig2 » (couleur, boîte englobante, 80x32, flou σ = 1, corrélation) ; seuil corr ≥ 0.90 ET écart de proportion ≤ 0.15.
// (la marge ≥ 0.05 sur le deuxième meilleur logo de la source et la lecture côte à côte de la phase 1 ne se rejouent pas ici : la ligne les a déjà passées.)
const sharp = require('sharp');
const IS = require('./index-symboles');

// ── FR (comparer.js de la phase 1)
async function rognee(buf) {
    const plat = await sharp(buf).flatten({ background: '#ffffff' }).png().toBuffer();
    try { return await sharp(plat).trim({ threshold: 10 }).png().toBuffer(); } catch { return plat; }
}
async function empreinteFr(buf) {
    const sig = await IS.signatureSymbole(buf);
    const r = await rognee(buf); const m = await sharp(r).metadata();
    return { norme: IS.normaliser(sig.vecteur), aspect: m.width / m.height, w: m.width, h: m.height };
}
function comparerFr(a, b) {
    const corr = IS.correlation(a.norme, b.norme);
    const rapportAspect = Math.min(a.aspect, b.aspect) / Math.max(a.aspect, b.aspect);
    return { corr, rapportAspect };
}

// ── JP (sig2.js de la phase 1)
const W = 80, H = 32;
async function signatureJp(buf, opts = {}) {
    const sig = opts.sigma ?? 1.0;
    const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width, h = info.height;
    let semi = 0; for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { semi++; if (semi > 20) break; }
    const opaque = semi <= 20, c = [data[0], data[1], data[2]];
    const px = Buffer.alloc(w * h * 4), mk = Buffer.alloc(w * h);
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4; let a;
        if (!opaque) a = data[i + 3] / 255; else a = (Math.abs(data[i] - c[0]) + Math.abs(data[i + 1] - c[1]) + Math.abs(data[i + 2] - c[2])) > 40 ? 1 : 0;
        for (let k = 0; k < 3; k++) px[i + k] = Math.round(data[i + k] * a + 128 * (1 - a));
        px[i + 3] = 255; mk[y * w + x] = a > 0.06 ? 255 : 0;
        if (a > 0.06) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 < 0) return null;
    const box = { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
    let p = sharp(px, { raw: { width: w, height: h, channels: 4 } }).extract(box).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).removeAlpha();
    if (sig > 0) p = p.blur(sig);
    const col = await p.raw().toBuffer();
    const mask = await sharp(mk, { raw: { width: w, height: h, channels: 1 } }).extract(box).resize(W, H, { fit: 'fill' }).blur(0.6).threshold(100).raw().toBuffer();
    const f = new Float64Array(col.length); let m = 0; for (const x of col) m += x; m /= col.length;
    let s = 0; for (let i = 0; i < col.length; i++) { f[i] = col[i] - m; s += f[i] * f[i]; }
    const n = Math.sqrt(s) || 1; for (let i = 0; i < f.length; i++) f[i] /= n;
    return { v: f, mask, ratio: box.width / box.height };
}
function corrJp(a, b) { let s = 0; for (let i = 0; i < a.v.length; i++) s += a.v[i] * b.v[i]; return s; }
const ecartRatio = (a, b) => Math.abs(Math.log(a.ratio / b.ratio));

const SEUIL_FR = 0.99, SEUIL_JP = 0.90, ECART_JP = 0.15;
/**
 * La mesure d'un fichier téléchargé contre le fichier Pokécardex de sa ligne (jamais l'inverse : le Pokécardex n'est que LU).
 * Rend { corr, ok, detail } ; `ok` n'est vrai que si le seuil DE LA PARTIE est atteint. Une image illisible LÈVE (pas de verdict).
 */
async function mesurer(part, bufTelecharge, bufPokecardex) {
    if (part === 'FR') {
        const [a, b] = [await empreinteFr(bufPokecardex), await empreinteFr(bufTelecharge)];
        const { corr, rapportAspect } = comparerFr(a, b);
        return { corr, ok: corr >= SEUIL_FR, detail: `FR corr ${corr.toFixed(3)} (seuil ${SEUIL_FR}), rapport de forme ${rapportAspect.toFixed(2)}` };
    }
    if (part === 'JP') {
        const [a, b] = [await signatureJp(bufPokecardex), await signatureJp(bufTelecharge)];
        if (!a || !b) throw new Error('mesurer JP : image vide (aucun pixel visible)');
        const corr = corrJp(a, b), ecart = ecartRatio(a, b);
        return { corr, ok: corr >= SEUIL_JP && ecart <= ECART_JP, detail: `JP corr ${corr.toFixed(3)} (seuil ${SEUIL_JP}), écart de proportion ${ecart.toFixed(2)} (max ${ECART_JP})` };
    }
    throw new Error(`mesurer : partie « ${part} » inconnue`);
}
module.exports = { mesurer, empreinteFr, comparerFr, signatureJp, corrJp, ecartRatio, SEUIL_FR, SEUIL_JP, ECART_JP };
