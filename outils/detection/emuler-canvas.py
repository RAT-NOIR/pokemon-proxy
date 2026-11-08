"""Sonde : le canvas Chrome 'high' a 640 reproduit-il au bit un echantillonnage bilineaire sans antialias ?
  python -I emuler-canvas.py <dossier-dump> <manifeste.json> [n]
Compare, photo par photo (decodage Pillow = decodage du navigateur, prouve), des candidats d'emulation aux octets RGB postes par Chrome (dump640.mjs). Rien n'est ecrit."""
import sys, json, os
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image

dossier, fman = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 40
qual = sys.argv[4] if len(sys.argv) > 4 else 'high'
man = json.load(open(fman, encoding='utf8'))
res = json.load(open(os.path.join(dossier, 'resultat.json'), encoding='utf8'))
ids = sorted(res['photos'])[:N]


def indices(sw, dw):
    k = sw / dw
    x = (np.arange(dw, dtype=np.float64) + 0.5) * k - 0.5
    x0 = np.floor(x).astype(np.int64); f = x - x0
    i0 = np.clip(x0, 0, sw - 1); i1 = np.clip(x0 + 1, 0, sw - 1)
    return i0, i1, f


def bilin64(a, dw, dh, arrondi):
    h, w, _ = a.shape
    xi0, xi1, fx = indices(w, dw); yi0, yi1, fy = indices(h, dh)
    a = a.astype(np.float64)
    top = a[yi0][:, xi0] * (1 - fx)[None, :, None] + a[yi0][:, xi1] * fx[None, :, None]
    bot = a[yi1][:, xi0] * (1 - fx)[None, :, None] + a[yi1][:, xi1] * fx[None, :, None]
    v = top * (1 - fy)[:, None, None] + bot * fy[:, None, None]
    return np.clip(arrondi(v), 0, 255).astype(np.uint8)


def bilin32(a, dw, dh, arrondi, ordre='h'):
    h, w, _ = a.shape
    xi0, xi1, fx = indices(w, dw); yi0, yi1, fy = indices(h, dh)
    f32 = np.float32
    fx = fx.astype(f32); fy = fy.astype(f32)
    c = a.astype(f32) * f32(1 / 255)
    wx0 = (f32(1) - fx)[None, :, None]; wx1 = fx[None, :, None]; wy0 = (f32(1) - fy)[:, None, None]; wy1 = fy[:, None, None]
    s00 = c[yi0][:, xi0]; s10 = c[yi0][:, xi1]; s01 = c[yi1][:, xi0]; s11 = c[yi1][:, xi1]
    if ordre == 'h':   # d'abord x puis y
        top = s00 * wx0 + s10 * wx1; bot = s01 * wx0 + s11 * wx1
        v = top * wy0 + bot * wy1
    else:              # poids 2D produits, accumules dans l'ordre 00,10,01,11
        v = f32(0) + (wx0 * wy0) * s00
        v = v + (wx1 * wy0) * s10
        v = v + (wx0 * wy1) * s01
        v = v + (wx1 * wy1) * s11
    return np.clip(arrondi(v * f32(255)), 0, 255).astype(np.uint8)


ARR = {'demi-haut': lambda v: np.floor(v + 0.5), 'pair': lambda v: np.rint(v), 'tronque': lambda v: np.floor(v)}
CAND = {}
for an, af in ARR.items():
    CAND['f64-' + an] = (lambda a, dw, dh, af=af: bilin64(a, dw, dh, af))
    CAND['f32h-' + an] = (lambda a, dw, dh, af=af: bilin32(a, dw, dh, af, 'h'))
    CAND['f32m-' + an] = (lambda a, dw, dh, af=af: bilin32(a, dw, dh, af, 'm'))

tot = {k: [0, 0, 0] for k in CAND}   # [photos identiques, octets differents, octets]
ecart = {k: 0 for k in CAND}
for id_ in ids:
    sw, sh = res['photos'][id_]['src']; dw, dh = res['photos'][id_]['dst']
    ref = np.fromfile(os.path.join(dossier, f'{id_}.{qual}.rgb'), dtype=np.uint8).reshape(dh, dw, 3)
    a = np.asarray(Image.open(man[id_]).convert('RGB'))
    assert a.shape == (sh, sw, 3), (a.shape, sh, sw)
    for k, f in CAND.items():
        o = f(a, dw, dh)
        d = np.abs(o.astype(int) - ref.astype(int))
        tot[k][0] += int(not d.any()); tot[k][1] += int((d > 0).sum()); tot[k][2] += d.size; ecart[k] = max(ecart[k], int(d.max()))
print('photos', len(ids), 'echelle moy', np.mean([res['photos'][i]['src'][0] / res['photos'][i]['dst'][0] for i in ids]))
for k, v in sorted(tot.items(), key=lambda kv: kv[1][1]):
    print('%-18s photos identiques %3d/%d  octets differents %9d (%.4f %%)  ecart max %d' % (k, v[0], len(ids), v[1], 100 * v[1] / v[2], ecart[k]))
