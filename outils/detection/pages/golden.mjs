// Fabrique la FIXTURE DOREE du banc : Chrome (canvas imageSmoothingQuality='high') reduit des sources synthetiques reproductibles ; on poste le SHA-256 des octets RGB sortis.
// Le banc node rejoue sourceSynthetique() + bilineaire32() et compare. Cas : facteurs de 1 a < racine de 2, sur chaque axe independamment.
const D = await import('/m/detection.mjs');
const CAS = [[100, 80, 100, 80], [100, 80, 80, 64], [101, 77, 81, 62], [123, 91, 100, 74], [90, 90, 70, 70], [64, 48, 51, 38], [133, 100, 100, 75], [131, 97, 100, 100], [100, 131, 100, 100], [129, 129, 100, 100],
  [141, 100, 100, 71], [200, 150, 160, 120], [199, 151, 160, 121], [97, 130, 78, 104], [57, 41, 45, 33], [320, 240, 256, 192], [301, 223, 241, 178], [64, 64, 64, 64], [65, 64, 64, 64], [500, 375, 400, 300]];
(async () => {
  const sortie = { ua: navigator.userAgent, cas: [] };
  let n = 0;
  for (const [w, h, W, H] of CAS) {
    const graine = 1000 + (++n);
    const rgb = D.sourceSynthetique(graine, w, h);
    const id = new ImageData(w, h);
    for (let i = 0; i < w * h; i++) { id.data[i * 4] = rgb[i * 3]; id.data[i * 4 + 1] = rgb[i * 3 + 1]; id.data[i * 4 + 2] = rgb[i * 3 + 2]; id.data[i * 4 + 3] = 255; }
    const bmp = await createImageBitmap(id, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    const c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; x.drawImage(bmp, 0, 0, w, h, 0, 0, W, H);
    const rgba = x.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) { out[i * 3] = rgba[i * 4]; out[i * 3 + 1] = rgba[i * 4 + 1]; out[i * 3 + 2] = rgba[i * 4 + 2]; }
    sortie.cas.push({ graine, w, h, W, H, sha256: D.sha256(out) });
  }
  await fetch('/resultat', { method: 'POST', body: JSON.stringify(sortie) });
})();
