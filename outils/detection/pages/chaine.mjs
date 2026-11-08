// La MEME chaine que chaine-node.mjs, dans Chrome : octets (fetch -> ArrayBuffer, jamais createImageBitmap) -> detecter() -> tenseur -> modele. Le resultat est poste (/resultat) dans le meme format.
//   ?fils=4  ?limite=N  ?voie=auto|pillow  ?sans-modele=1  ?mutation=canvas-low|canvas-high (la reduction passe par le canvas du navigateur : une DEPENDANCE au navigateur remise exprès, pour la mutation du banc)
const Q = new URLSearchParams(location.search);
const FILS = Number(Q.get('fils') || 4), LIMITE = Number(Q.get('limite') || 0), VOIE = Q.get('voie') || 'auto', MUTATION = Q.get('mutation') || '', SANS_MODELE = Q.get('sans-modele') === '1';
const log = (m) => { document.getElementById('j').textContent = m; fetch('/log?m=' + encodeURIComponent(String(m).slice(0, 200))).catch(() => {}); };
window.addEventListener('error', (e) => log('ERREUR-JS ' + e.message));
window.addEventListener('unhandledrejection', (e) => log('REJET ' + (e.reason && e.reason.message || e.reason)));
const D = await import('/m/detection.mjs');
const E = await import('/m/empreinte.js');
function chargerOpenCV() {
  return new Promise(async (ok, ko) => {
    window.Module = { wasmBinary: new Uint8Array(await (await fetch('/opencv_js.wasm')).arrayBuffer()) };
    const s = document.createElement('script'); s.src = '/opencv.js';
    s.onload = async () => { try { const c = await window.cv; ok(c && c.Mat ? c : window.cv); } catch (e) { ko(e); } };
    s.onerror = () => ko(new Error('opencv.js'));
    document.head.appendChild(s);
  });
}
function reducteurCanvas(qualite) {
  return (rgb, w, h) => {
    const { W, H } = D.dimensions640 ? D.dimensions640(w, h) : { W: Math.round(w * Math.min(640 / w, 640 / h)), H: Math.round(h * Math.min(640 / w, 640 / h)) };
    const src = new OffscreenCanvas(w, h), sx = src.getContext('2d'), id = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) { id.data[i * 4] = rgb[i * 3]; id.data[i * 4 + 1] = rgb[i * 3 + 1]; id.data[i * 4 + 2] = rgb[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
    sx.putImageData(id, 0, 0);
    const c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = qualite; x.drawImage(src, 0, 0, w, h, 0, 0, W, H);
    const rgba = x.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) { out[i * 3] = rgba[i * 4]; out[i * 3 + 1] = rgba[i * 4 + 1]; out[i * 3 + 2] = rgba[i * 4 + 2]; }
    return { rgb: out, largeur: W, hauteur: H, voie: 'canvas-navigateur-' + qualite };
  };
}
(async () => {
  try {
    const t0 = performance.now();
    log('opencv…'); const cv = await chargerOpenCV(); const tCV = performance.now() - t0;
    let ort = null, session = null, tSession = 0;
    if (!SANS_MODELE) {
      log('modele…');
      ort = await import('/m/ort/ort.wasm.bundle.min.mjs');
      ort.env.wasm.wasmPaths = { wasm: new URL('/m/ort/ort-wasm-simd-threaded.wasm', location.href).href }; ort.env.wasm.numThreads = FILS; ort.env.wasm.proxy = false;
      const octets = await (await fetch('/modele.onnx')).arrayBuffer();
      const t2 = performance.now();
      session = await ort.InferenceSession.create(new Uint8Array(octets), { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      tSession = performance.now() - t2;
      await session.run({ pixel_values: new ort.Tensor('float32', new Float32Array(3 * 224 * 224), [1, 3, 224, 224]) });
    }
    const liste = (await (await fetch('/liste.json')).json()).slice(0, LIMITE || 1e9);
    const res = { parametres: { moteur: navigator.userAgent, voie: VOIE, mutation: MUTATION, version: D.VERSION_DETECTION, fils: FILS, isole: self.crossOriginIsolated }, chargement_ms: { opencv: Math.round(tCV), session: Math.round(tSession) }, photos: {} };
    const t1 = performance.now(); let n = 0;
    for (const id of liste) {
      log(`${++n}/${liste.length} ${id}`);
      const octets = new Uint8Array(await (await fetch('/photo/' + id)).arrayBuffer());
      const ta = performance.now();
      const opts = { voie: VOIE };
      if (MUTATION === 'canvas-low') opts.reducteur = reducteurCanvas('low');
      if (MUTATION === 'canvas-high') opts.reducteur = reducteurCanvas('high');
      const r = D.detecter(cv, octets, opts);
      const ms = Math.round(performance.now() - ta);
      const p = { redressee: r.redressee, nCartes: r.nCartes, quad: r.quad, dim640: r.dim640, voie: r.voie, src: [r.largeur, r.hauteur], empreintes: r.empreintes, ms, emb: null };
      if (r.redressee && session) {
        const t = E.versTenseur(r.carte, D.L_RED, D.H_RED);
        const out = await session.run({ pixel_values: new ort.Tensor('float32', t, [1, 3, 224, 224]) });
        const e = Array.from(out.emb.data); let s = 0; for (let j = 0; j < 256; j++) s += e[j] ** 2; s = Math.sqrt(s); for (let j = 0; j < 256; j++) e[j] /= s;
        p.emb = e;
      }
      res.photos[id] = p;
    }
    res.parametres.totalMs = Math.round(performance.now() - t1);
    if (performance.memory) res.parametres.jsHeapMo = Math.round(performance.memory.usedJSHeapSize / 1048576);
    await fetch('/resultat', { method: 'POST', body: JSON.stringify(res) });
    log('fini');
  } catch (e) { log('ERREUR ' + (e && e.message)); await fetch('/resultat', { method: 'POST', body: JSON.stringify({ erreur: String(e && (e.stack || e.message) || e).slice(0, 800) }) }); }
})();
