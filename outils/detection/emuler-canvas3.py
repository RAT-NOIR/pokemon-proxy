"""Sonde 3 : l'arithmetique flottante exacte de la file de Skia (bilineaire highp) reproduit-elle les egalites de Chrome ?
  python -I emuler-canvas3.py <dossier-dump> <manifeste.json> [n]"""
import sys, json, os, itertools
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image
dossier, fman = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 12
man = json.load(open(fman, encoding='utf8'))
res = json.load(open(os.path.join(dossier, 'resultat.json'), encoding='utf8'))
ids = [i for i in sorted(res['photos']) if res['photos'][i]['src'][0] == res['photos'][i]['dst'][0] * 1.25 and res['photos'][i]['src'][1] == res['photos'][i]['dst'][1] * 1.25][:N]
f32 = np.float32
INV255 = f32(1 / 255)


def fma(a, b, c):   # a*b exact en f64 (24+24 bits), somme f64, un seul arrondi f32 (double arrondi possible, tres rare)
    return (a.astype(np.float64) * b.astype(np.float64) + c.astype(np.float64)).astype(f32)


def coords(sw, dw):
    dx = np.arange(dw, dtype=np.float64)
    cx = ((dx + 0.5) * (sw / dw)).astype(f32)               # centre en coordonnees source
    x = cx - f32(0.5)
    fx = (cx + f32(0.5)) - np.floor(cx + f32(0.5))           # fract
    i0 = np.floor(x).astype(np.int64)
    return np.clip(i0, 0, sw - 1), np.clip(i0 + 1, 0, sw - 1), fx.astype(f32)


def variante(a, dw, dh, acc_fma, fin, ordre_poids):
    h, w, _ = a.shape
    xi0, xi1, fx = coords(w, dw); yi0, yi1, fy = coords(h, dh)
    c = a.astype(f32) * INV255
    wx = [(f32(1) - fx)[None, :, None], fx[None, :, None]]; wy = [(f32(1) - fy)[:, None, None], fy[:, None, None]]
    S = {(0, 0): c[yi0][:, xi0], (1, 0): c[yi0][:, xi1], (0, 1): c[yi1][:, xi0], (1, 1): c[yi1][:, xi1]}
    acc = np.zeros((dh, dw, 3), f32)
    ordre = [(0, 0), (1, 0), (0, 1), (1, 1)] if ordre_poids == 'jouter' else [(0, 0), (0, 1), (1, 0), (1, 1)]
    for (i, j) in ordre:
        wgt = (wx[i] * wy[j]).astype(f32)
        acc = fma(wgt, S[(i, j)], acc) if acc_fma else (acc + (wgt * S[(i, j)]).astype(f32)).astype(f32)
    if fin == 'fma-demi':
        v = fma(acc, np.full_like(acc, 255), np.full_like(acc, 0.5))
        return np.clip(np.floor(v), 0, 255).astype(np.uint8)
    if fin == 'mul-demi':
        v = (((acc * f32(255)).astype(f32)) + f32(0.5)).astype(f32)
        return np.clip(np.floor(v), 0, 255).astype(np.uint8)
    if fin == 'pair':
        return np.clip(np.rint((acc * f32(255)).astype(f32)), 0, 255).astype(np.uint8)


tot = {}
for id_ in ids:
    sw, sh = res['photos'][id_]['src']; dw, dh = res['photos'][id_]['dst']
    ref = np.fromfile(os.path.join(dossier, f'{id_}.high.rgb'), dtype=np.uint8).reshape(dh, dw, 3)
    a = np.asarray(Image.open(man[id_]).convert('RGB'))
    for acc_fma, fin, op in itertools.product([True, False], ['fma-demi', 'mul-demi', 'pair'], ['jouter', 'iouter']):
        o = variante(a, dw, dh, acc_fma, fin, op)
        k = (acc_fma, fin, op); t = tot.setdefault(k, [0, 0, 0])
        t[0] += int((o != ref).sum()); t[1] += o.size; t[2] += int(not (o != ref).any())
print('photos', len(ids))
for k, v in sorted(tot.items(), key=lambda kv: kv[1][0]):
    print('acc_fma=%-5s fin=%-9s ordre=%-7s : octets differents %8d (%.5f %%), photos identiques %d/%d' % (k[0], k[1], k[2], v[0], 100 * v[0] / v[1], v[2], len(ids)))
