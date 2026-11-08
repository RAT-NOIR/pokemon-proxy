// La page de PREUVE du décodeur (servie par pilote-decodeur.js, jamais par l'API) : sur les 30 cartes du lot de la page de banc, deux chaînes dans CE navigateur :
//   « navigateur » : createImageBitmap + canvas + getImageData (ce que fait app.js / l'extension aujourd'hui) ;
//   « décodeur »   : decodeur.mjs (JavaScript pur) ;
// puis, pour chacune, redimPIL -> tenseur -> le MÊME modèle (onnxruntime-web WASM, comme app.js). Elle rend les empreintes SHA-256 des octets RGB, des tenseurs et des vecteurs, et les cosinus.
import { versTenseur, normaliserL2, nombreDeFils, COTE_MODELE } from '/pub/empreinte.js';
import { cosinus } from '/pub/moteur-ort.js';
import * as D from '/pub/decodeur.mjs';

const b64vers = s => { const b = atob(s), o = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) o[i] = b.charCodeAt(i); return o; };
const hex = buf => Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
const sha = async o => hex(await crypto.subtle.digest('SHA-256', o instanceof Uint8Array ? o : new Uint8Array(o.buffer, o.byteOffset, o.byteLength)));

async function decoderNavigateur(octets) {      // la chaîne de app.js (decoderCarte)
    const blob = new Blob([octets], { type: 'image/jpeg' });
    let bmp;
    try { bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch { bmp = await createImageBitmap(blob); }
    const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height;
    const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
    const w = bmp.width, h = bmp.height, d = x.getImageData(0, 0, w, h);
    if (bmp.close) bmp.close();
    const rgb = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { rgb[i * 3] = d.data[i * 4]; rgb[i * 3 + 1] = d.data[i * 4 + 1]; rgb[i * 3 + 2] = d.data[i * 4 + 2]; }
    return { rgb, w, h };
}
const tenseurDepuisPx = px => { const n = COTE_MODELE * COTE_MODELE, t = new Float32Array(3 * n); for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) t[k * n + i] = (px[i * 3 + k] / 255 - 0.5) / 0.5; return t; };
const egalBits = (a, b) => { if (a.length !== b.length) return false; const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

window.__preuve = async function () {
    const lot = await (await fetch('/pub/lot.json')).json();
    const SHA = lot.modeleSha256;
    const modele = new Uint8Array(await (await fetch('/modele')).arrayBuffer());
    const ort = await import('/pub/ort/ort.wasm.bundle.min.mjs');
    ort.env.wasm.wasmPaths = { wasm: new URL('/pub/ort/ort-wasm-simd-threaded.wasm', location.href).href };
    ort.env.wasm.numThreads = nombreDeFils(navigator.hardwareConcurrency); ort.env.wasm.proxy = false;
    const session = await ort.InferenceSession.create(modele, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    const infer = async t => { const s = await session.run({ pixel_values: new ort.Tensor('float32', t, [1, 3, COTE_MODELE, COTE_MODELE]) }); const e = Float32Array.from(s.emb.data); try { s.emb.dispose(); } catch { /* deja */ } return normaliserL2(Array.from(e)); };
    const sorties = [], tA = performance.now();
    let tempsDecodeur = 0, tempsNavigateur = 0;
    for (const c of lot.cartes) {
        const octets = b64vers(c.jpg), refV = new Float32Array(b64vers(c.ref).buffer);
        let t0 = performance.now();
        const nav = await decoderNavigateur(octets); tempsNavigateur += performance.now() - t0;
        t0 = performance.now();
        const dec = D.decoder(octets, { orientation: 'aucune' }); tempsDecodeur += performance.now() - t0;
        let ecartsRgb = 0; if (nav.w === dec.largeur && nav.h === dec.hauteur) for (let i = 0; i < nav.rgb.length; i++) if (nav.rgb[i] !== dec.rgb[i]) ecartsRgb++; else { /* egal */ } else ecartsRgb = -1;
        const tNav = versTenseur(nav.rgb, nav.w, nav.h), tDec = versTenseur(dec.rgb, dec.largeur, dec.hauteur);
        const eNav = await infer(tNav), eDec = await infer(tDec);
        const r = { id: c.id, w: dec.largeur, h: dec.hauteur, rgbDecodeur: await sha(dec.rgb), tenseurDecodeur: await sha(tDec), tenseurNavigateur: await sha(tNav), octetsRgbDifferents: ecartsRgb,
            tenseursIdentiques: egalBits(tNav, tDec), vecteurDecodeur: await sha(Float32Array.from(eDec)), vecteurNavigateur: await sha(Float32Array.from(eNav)),
            cosDecodeurRef: cosinus(eDec, refV), cosNavigateurRef: cosinus(eNav, refV), cosDecodeurNavigateur: cosinus(eDec, eNav) };
        if (c.px) { const tpx = tenseurDepuisPx(b64vers(c.px)); r.tenseurDecodeurEgalPil = egalBits(tpx, tDec); r.tenseurNavigateurEgalPil = egalBits(tpx, tNav); }
        sorties.push(r);
    }
    try { await session.release(); } catch { /* deja */ }
    return { ua: navigator.userAgent, isole: self.crossOriginIsolated === true, fils: ort.env.wasm.numThreads, dureeMs: Math.round(performance.now() - tA), msDecodeurMedianeCarte: Math.round(tempsDecodeur / lot.cartes.length * 10) / 10, msNavigateurMedianeCarte: Math.round(tempsNavigateur / lot.cartes.length * 10) / 10, sha: SHA, cartes: sorties };
};
// Le navigateur applique-t-il l'orientation EXIF par défaut (createImageBitmap sans option), et décode-t-il comme Pillow / notre décodeur ? Cas synthétiques de Pillow (JPEG et WebP), comparés octet pour octet.
window.__exif = async function () {
    const fx = await (await fetch('/fx')).json();
    const r = { cas: 0, memeTaille: 0, memesOctets: 0, ecartsMax: 0, parNom: {} };
    for (const c of fx.cas.filter(x => (x.format === 'jpeg' || x.format === 'webp') && /(exif|420-64x48|420-37x29|webp-q75-64x48|webp-q95-100x75|444-64x48|progressif-420-64x48)/.test(x.nom) && !/lossless/.test(x.nom))) {
        const o = b64vers(c.b64), dec = D.decoder(o), type = c.format === 'jpeg' ? 'image/jpeg' : 'image/webp';
        let bmp;
        try { bmp = await createImageBitmap(new Blob([o], { type }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }); } catch { bmp = await createImageBitmap(new Blob([o], { type })); }
        const cv = document.createElement('canvas'); cv.width = bmp.width; cv.height = bmp.height; const x = cv.getContext('2d', { willReadFrequently: true }); x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
        r.cas++;
        let diff = 0, max = 0;
        if (bmp.width === dec.largeur && bmp.height === dec.hauteur) { r.memeTaille++; for (let i = 0; i < dec.largeur * dec.hauteur; i++) for (let k = 0; k < 3; k++) { const e = Math.abs(d[i * 4 + k] - dec.rgb[i * 3 + k]); if (e) { diff++; if (e > max) max = e; } } if (!diff) r.memesOctets++; }
        r.ecartsMax = Math.max(r.ecartsMax, max);
        if (diff || bmp.width !== dec.largeur) r.parNom[c.nom] = { navigateur: [bmp.width, bmp.height], decodeur: [dec.largeur, dec.hauteur], octetsDifferents: diff, ecartMax: max };
    }
    return r;
};
window.__pret = true;
