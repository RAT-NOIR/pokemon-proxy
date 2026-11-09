// GRANDES PHOTOS dans Chrome : pour chaque photo, DEUX chaines sur les memes octets.
//   A = la chaine Rat-Market (detecter() : decodeur, pre-reduction entiere a 800 px, canvas « high » emule, OpenCV, redressement),
//   B = la chaine SERVIE aujourd'hui (createImageBitmap, reduction a 640 par le canvas imageSmoothingQuality='high' du navigateur sur la photo ENTIERE, puis la meme OpenCV et le meme redressement).
// Chaque chaine rend quadrilateres, carte redressee, vecteur (modele p8000 servi). Resultat poste (/resultat). ?fils=4 ?limite=N ?sans-modele=1
const Q = new URLSearchParams(location.search);
const FILS = Number(Q.get('fils') || 4), LIMITE = Number(Q.get('limite') || 0), SANS_MODELE = Q.get('sans-modele') === '1', A0 = Q.get('a0') === '1';
const log = (m) => { document.getElementById('j').textContent = m; fetch('/log?m=' + encodeURIComponent(String(m).slice(0, 200))).catch(() => {}); };
window.addEventListener('error', (e) => log('ERREUR-JS ' + e.message));
const D = await import('/m/detection.mjs');
const E = await import('/m/empreinte.js');
async function chargerOpenCV() {
  window.Module = { wasmBinary: new Uint8Array(await (await fetch('/opencv_js.wasm')).arrayBuffer()) };
  await new Promise((ok, ko) => { const s = document.createElement('script'); s.src = '/opencv.js'; s.onload = ok; s.onerror = () => ko(new Error('opencv.js')); document.head.appendChild(s); });
  return await window.cv;
}
let ort = null, session = null;
async function vecteur(carte) {
  if (!session) return null;
  const t = E.versTenseur(carte, D.L_RED, D.H_RED);
  const out = await session.run({ pixel_values: new ort.Tensor('float32', t, [1, 3, 224, 224]) });
  const e = Array.from(out.emb.data); let s = 0; for (let j = 0; j < 256; j++) s += e[j] ** 2; s = Math.sqrt(s); for (let j = 0; j < 256; j++) e[j] /= s;
  return e;
}
/** La chaine B : le navigateur decode et reduit. */
async function chaineB(cv, octets) {
  const t0 = performance.now();
  const bmp = await createImageBitmap(new Blob([octets]));
  const { W, H } = D.dimensions640(bmp.width, bmp.height);
  const c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, W, H);
  const rgba = x.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3);
  for (let i = 0; i < W * H; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
  const src = [bmp.width, bmp.height]; bmp.close();
  const det = D.quadrilateres(cv, rgb, W, H);
  const r = { src, dim640: [W, H], nCartes: det.gardes.length, cands: det.gardes.map((g) => ({ quad: g.quad.map((p) => [p.x, p.y]), aire: g.aire })), redressee: false, quad: null, empreintes: { rgb640: D.sha256(rgb), quads: D.empreinteQuads(det.gardes), carte: null }, emb: null };
  if (det.gardes.length) { const carte = D.redresser(cv, rgb, W, H, det.gardes[0]); r.redressee = true; r.quad = det.gardes[0].quad.map((p) => [p.x, p.y]); r.empreintes.carte = D.sha256(carte); r.emb = await vecteur(carte); }
  r.ms = Math.round(performance.now() - t0);
  return r;
}
(async () => {
  try {
    const cv = await chargerOpenCV();
    if (!SANS_MODELE) {
      ort = await import('/m/ort/ort.wasm.bundle.min.mjs');
      ort.env.wasm.wasmPaths = { wasm: new URL('/m/ort/ort-wasm-simd-threaded.wasm', location.href).href }; ort.env.wasm.numThreads = FILS; ort.env.wasm.proxy = false;
      session = await ort.InferenceSession.create(new Uint8Array(await (await fetch('/modele.onnx')).arrayBuffer()), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      await session.run({ pixel_values: new ort.Tensor('float32', new Float32Array(3 * 224 * 224), [1, 3, 224, 224]) });
    }
    const liste = (await (await fetch('/liste.json')).json()).slice(0, LIMITE || 1e9);
    const res = { parametres: { moteur: navigator.userAgent, fils: FILS, version: D.VERSION_DETECTION }, photos: {}, B: {} };
    let n = 0;
    for (const id of liste) {
      log(`${++n}/${liste.length} ${id}`);
      const octets = new Uint8Array(await (await fetch('/photo/' + id)).arrayBuffer());
      try {
        const ta = performance.now();
        const r = D.detecter(cv, octets);
        const ms = Math.round(performance.now() - ta);
        const p = { redressee: r.redressee, nCartes: r.nCartes, quad: r.quad, cands: r.candidats, dim640: r.dim640, voie: r.voie, pre: r.prereduction, src: [r.largeur, r.hauteur], empreintes: r.empreintes, ms, emb: null };
        if (r.redressee) p.emb = await vecteur(r.carte);
        res.photos[id] = p;
        if (A0) { // A SANS pre-reduction (sonde) : la reduction 640 se fait directement depuis la photo decodee (voie Pillow au-dela de racine de 2)
          try { const r0 = D.detecter(cv, octets, { pre: false }); (res.A0 = res.A0 || {})[id] = { redressee: r0.redressee, nCartes: r0.nCartes, quad: r0.quad, cands: r0.candidats, dim640: r0.dim640, voie: r0.voie }; } catch (e) { (res.A0 = res.A0 || {})[id] = { erreur: String((e && (e.code || e.name)) || e) }; }
        }
      } catch (e) { res.photos[id] = { erreur: String((e && (e.code || e.name)) || e), redressee: false, nCartes: 0, quad: null, dim640: null, voie: null, src: null, empreintes: { rgb640: null, quads: null, carte: null }, emb: null }; }
      try { res.B[id] = await chaineB(cv, octets); } catch (e) { res.B[id] = { erreur: String((e && (e.code || e.name)) || e), redressee: false, nCartes: 0, quad: null, empreintes: { rgb640: null, quads: null, carte: null }, emb: null }; }
    }
    if (performance.memory) res.parametres.jsHeapMo = Math.round(performance.memory.usedJSHeapSize / 1048576);
    await fetch('/resultat', { method: 'POST', body: JSON.stringify(res) });
    log('fini');
  } catch (e) { log('ERREUR ' + (e && e.message)); await fetch('/resultat', { method: 'POST', body: JSON.stringify({ erreur: String(e && (e.stack || e.message) || e).slice(0, 800) }) }); }
})();
