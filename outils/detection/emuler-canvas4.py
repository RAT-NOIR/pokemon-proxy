"""Sonde 4 : la meilleure emulation (fma, ordre y puis x, arrondi au pair) sur LES 465 photos, par categorie d'echelle ; liste les photos qui different.
  python -I emuler-canvas4.py <dossier-dump> <manifeste.json> [qualite]"""
import sys, json, os
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image
dossier, fman = sys.argv[1], sys.argv[2]
qual = sys.argv[3] if len(sys.argv) > 3 else 'high'
man = json.load(open(fman, encoding='utf8'))
res = json.load(open(os.path.join(dossier, 'resultat.json'), encoding='utf8'))
f32 = np.float32; INV255 = f32(1 / 255)
fma = lambda a, b, c: (a.astype(np.float64) * b.astype(np.float64) + c.astype(np.float64)).astype(f32)


def coords(sw, dw, mode):
    dx = np.arange(dw, dtype=np.float64)
    k = sw / dw
    if mode == 'f64':
        cx = ((dx + 0.5) * k).astype(f32)
    elif mode == 'f32':
        cx = (np.arange(dw, dtype=f32) + f32(0.5)) * f32(k)
    elif mode == 'f32inv':     # k via l'inverse f32 de (dw/sw)
        cx = (np.arange(dw, dtype=f32) + f32(0.5)) * (f32(1) / f32(dw / sw))
    t = cx + f32(0.5); fx = (t - np.floor(t)).astype(f32)
    i0 = np.floor(cx - f32(0.5)).astype(np.int64)
    return np.clip(i0, 0, sw - 1), np.clip(i0 + 1, 0, sw - 1), fx


def emuler(a, dw, dh, mode):
    h, w, _ = a.shape
    xi0, xi1, fx = coords(w, dw, mode); yi0, yi1, fy = coords(h, dh, mode)
    c = a.astype(f32) * INV255
    wx = [(f32(1) - fx)[None, :, None], fx[None, :, None]]; wy = [(f32(1) - fy)[:, None, None], fy[:, None, None]]
    S = {(0, 0): c[yi0][:, xi0], (1, 0): c[yi0][:, xi1], (0, 1): c[yi1][:, xi0], (1, 1): c[yi1][:, xi1]}
    acc = np.zeros((dh, dw, 3), f32)
    for (i, j) in [(0, 0), (1, 0), (0, 1), (1, 1)]:
        acc = fma((wx[i] * wy[j]).astype(f32), S[(i, j)], acc)
    return np.clip(np.rint((acc * f32(255)).astype(f32)), 0, 255).astype(np.uint8)


cats = {}
liste = []
for id_ in sorted(res['photos']):
    sw, sh = res['photos'][id_]['src']; dw, dh = res['photos'][id_]['dst']
    ref = np.fromfile(os.path.join(dossier, f'{id_}.{qual}.rgb'), dtype=np.uint8).reshape(dh, dw, 3)
    a = np.asarray(Image.open(man[id_]).convert('RGB'))
    cat = 'montee' if sw < dw or sh < dh else ('1,25 exact' if sw == dw * 1.25 and sh == dh * 1.25 else ('1,25 en x ou y' if sw == dw * 1.25 or sh == dh * 1.25 else 'autre echelle'))
    for mode in ['f64', 'f32', 'f32inv']:
        o = emuler(a, dw, dh, mode)
        d = int((o != ref).sum()); mx = int(np.abs(o.astype(int) - ref.astype(int)).max())
        c = cats.setdefault((cat, mode), {'n': 0, 'id': 0, 'oct': 0, 'max': 0}); c['n'] += 1; c['id'] += int(d == 0); c['oct'] += d; c['max'] = max(c['max'], mx)
        if mode == 'f64' and d: liste.append((id_, cat, sw, sh, dw, dh, d, mx))
for k, v in sorted(cats.items()): print('%-16s %-7s photos %3d identiques %3d octets differents %7d ecart max %d' % (k[0], k[1], v['n'], v['id'], v['oct'], v['max']))
print('photos differentes (f64) :', len(liste))
for l in liste[:25]: print(l)
