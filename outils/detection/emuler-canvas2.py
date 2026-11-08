"""Sonde 2 : sur les photos a echelle EXACTE 1,25 (800 -> 640), la valeur bilineaire exacte est un rationnel a denominateur 64 ; comment Chrome tranche-t-il les egalites ?
  python -I emuler-canvas2.py <dossier-dump> <manifeste.json> [n]"""
import sys, json, os
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image
dossier, fman = sys.argv[1], sys.argv[2]
N = int(sys.argv[3]) if len(sys.argv) > 3 else 20
man = json.load(open(fman, encoding='utf8'))
res = json.load(open(os.path.join(dossier, 'resultat.json'), encoding='utf8'))
ids = [i for i in sorted(res['photos']) if res['photos'][i]['src'][0] == res['photos'][i]['dst'][0] * 1.25 and res['photos'][i]['src'][1] == res['photos'][i]['dst'][1] * 1.25][:N]
print('photos a echelle exacte 1,25 :', len([i for i in res['photos'] if res['photos'][i]['src'][0] == res['photos'][i]['dst'][0] * 1.25 and res['photos'][i]['src'][1] == res['photos'][i]['dst'][1] * 1.25]), 'sur', len(res['photos']), '; examinees', len(ids))


def entiers(sw, dw):
    # coordonnee source en huitiemes : x = (2*dx+1)*k/2 - 1/2 avec k = sw/dw = 5/4  -> (5*(2*dx+1) - 4)/8
    dx = np.arange(dw)
    num = 5 * (2 * dx + 1) - 4        # en huitiemes
    i0 = np.floor_divide(num, 8); f = (num - 8 * i0)    # f en huitiemes (0..7)
    return np.clip(i0, 0, sw - 1), np.clip(i0 + 1, 0, sw - 1), f


stats = {'non-egalite-ok': 0, 'non-egalite-ko': 0, 'egalite-haut': 0, 'egalite-bas': 0}
parite = {'pair': 0, 'impair': 0}   # sur les egalites : la valeur retenue est-elle la valeur paire ?
pos = {}
for id_ in ids:
    sw, sh = res['photos'][id_]['src']; dw, dh = res['photos'][id_]['dst']
    ref = np.fromfile(os.path.join(dossier, f'{id_}.high.rgb'), dtype=np.uint8).reshape(dh, dw, 3).astype(np.int64)
    a = np.asarray(Image.open(man[id_]).convert('RGB')).astype(np.int64)
    xi0, xi1, fx = entiers(sw, dw); yi0, yi1, fy = entiers(sh, dh)
    s00 = a[yi0][:, xi0]; s10 = a[yi0][:, xi1]; s01 = a[yi1][:, xi0]; s11 = a[yi1][:, xi1]
    wx1 = fx[None, :, None]; wx0 = 8 - wx1; wy1 = fy[:, None, None]; wy0 = 8 - wy1
    S = s00 * wx0 * wy0 + s10 * wx1 * wy0 + s01 * wx0 * wy1 + s11 * wx1 * wy1      # /64 exact
    q, r = np.divmod(S, 64)
    haut = np.where(r > 32, q + 1, q)                       # arrondi au plus proche, egalites exclues
    egal = (r == 32)
    ok = (ref == haut) | egal
    stats['non-egalite-ok'] += int(((ref == haut) & ~egal).sum()); stats['non-egalite-ko'] += int((~ok).sum())
    e_bas = egal & (ref == q); e_haut = egal & (ref == q + 1)
    stats['egalite-bas'] += int(e_bas.sum()); stats['egalite-haut'] += int(e_haut.sum())
    pair_ = egal & (ref % 2 == 0)
    parite['pair'] += int(pair_.sum()); parite['impair'] += int((egal & ~pair_).sum())
    # structure des egalites : par poids (fx, fy)
    for ky in range(8):
        for kx in range(8):
            m = egal & (fy[:, None, None] == ky) & (fx[None, :, None] == kx)
            if m.any():
                p = pos.setdefault((kx, ky), [0, 0]); p[0] += int((m & (ref == q + 1)).sum()); p[1] += int(m.sum())
print(stats); print('egalites : valeur retenue paire / impaire', parite)
for k in sorted(pos): print('fx=%d/8 fy=%d/8 : haut %d / %d egalites' % (k[0], k[1], pos[k][0], pos[k][1]))
