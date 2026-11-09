"""Fabrique des JPEG de 12 Mpx SYNTHETIQUES (degrade + bruit + un rectangle de carte) pour mesurer le decodeur (temps, memoire, EXIF, ICC, progressif, limite de pixels) : le CONTENU n'a aucune valeur de justesse.
  python -I fabriquer-12mpx.py <dossier-sortie>
Sorties : j12-base.jpg (4032x3024, 4:2:0), j12-exif6.jpg (EXIF orientation 6), j12-icc.jpg (profil ICC embarque), j12-prog.jpg (progressif), j12-3024x4032.jpg, j12-4080x3072.jpg, j50.jpg (8160x6120 : refus attendu)."""
import sys, os, io
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image, ImageCms
sortie = sys.argv[1]; os.makedirs(sortie, exist_ok=True)
rng = np.random.default_rng(20261109)


def image(w, h):
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]; y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    a = (np.array([200, 120, 60], np.float32)[None, None, :] * (1 - x) + np.array([40, 90, 190], np.float32)[None, None, :] * x) * (0.7 + 0.3 * y)
    a = a + rng.normal(0, 2.0, (h, w, 3)).astype(np.float32)
    cw, ch = int(h * 0.55 * 63 / 88 * 1.0), int(h * 0.55)
    x0, y0 = (w - cw) // 2, (h - ch) // 2
    a[y0:y0 + ch, x0:x0 + cw] = np.array([235, 220, 120], np.float32)
    a[y0 + ch // 8:y0 + ch // 2, x0 + cw // 10:x0 + cw - cw // 10] = np.array([70, 140, 90], np.float32)
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))


base = image(4032, 3024)
base.save(os.path.join(sortie, 'j12-base.jpg'), 'JPEG', quality=90, subsampling=2)
ex = Image.Exif(); ex[0x0112] = 6
base.save(os.path.join(sortie, 'j12-exif6.jpg'), 'JPEG', quality=90, subsampling=2, exif=ex)
icc = ImageCms.ImageCmsProfile(ImageCms.createProfile('sRGB')).tobytes()
base.save(os.path.join(sortie, 'j12-icc.jpg'), 'JPEG', quality=90, subsampling=2, icc_profile=icc)
base.save(os.path.join(sortie, 'j12-prog.jpg'), 'JPEG', quality=90, subsampling=2, progressive=True)
image(3024, 4032).save(os.path.join(sortie, 'j12-3024x4032.jpg'), 'JPEG', quality=90, subsampling=2)
image(4080, 3072).save(os.path.join(sortie, 'j12-4080x3072.jpg'), 'JPEG', quality=90, subsampling=2)
image(8160, 6120).save(os.path.join(sortie, 'j50.jpg'), 'JPEG', quality=85, subsampling=2)
for f in sorted(os.listdir(sortie)): print(f, os.path.getsize(os.path.join(sortie, f)))
