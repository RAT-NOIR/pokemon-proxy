// Chrome : la chaine SERVIE aujourd'hui (createImageBitmap, reduction 640 par canvas, qualite ?qualite=high|medium|low), les octets RGB sortis sont POSTES (/bin/<id>.<qualite>.rgb) ; rien d'autre.
const Q = new URLSearchParams(location.search), QUALITE = Q.get('qualite') || 'high', LIMITE = Number(Q.get('limite') || 0);
const log = (m) => { document.getElementById('j').textContent = m; fetch('/log?m=' + encodeURIComponent(String(m).slice(0, 200))).catch(() => {}); };
(async () => {
  try {
    const liste = (await (await fetch('/liste.json')).json()).slice(0, LIMITE || 1e9);
    const res = { ua: navigator.userAgent, qualite: QUALITE, photos: {} };
    let n = 0;
    for (const id of liste) {
      log(`${++n}/${liste.length} ${id}`);
      const blob = await (await fetch('/photo/' + id)).blob();
      const bmp = await createImageBitmap(blob);
      const k = Math.min(640 / bmp.width, 640 / bmp.height), W = Math.round(bmp.width * k), H = Math.round(bmp.height * k);
      const cv640 = new OffscreenCanvas(W, H), x640 = cv640.getContext('2d', { willReadFrequently: true });
      x640.imageSmoothingEnabled = true; x640.imageSmoothingQuality = QUALITE; x640.drawImage(bmp, 0, 0, bmp.width, bmp.height, 0, 0, W, H);
      const rgba = x640.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3);
      for (let i = 0; i < W * H; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
      await fetch(`/bin/${id}.${QUALITE}.rgb`, { method: 'POST', body: rgb });
      res.photos[id] = { src: [bmp.width, bmp.height], dst: [W, H] };
      bmp.close();
    }
    await fetch('/resultat', { method: 'POST', body: JSON.stringify(res) });
    log('fini');
  } catch (e) { log('ERREUR ' + (e && e.message)); await fetch('/resultat', { method: 'POST', body: JSON.stringify({ erreur: String(e && e.message || e).slice(0, 500) }) }); }
})();
