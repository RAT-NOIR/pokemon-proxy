"""Fixture d'un JPEG PROGRESSIF de plus de 4 Mpx (le plafond progressif du decodeur) : le fichier et le SHA-256 des octets RGB que Pillow en tire.
  python -I fixture-progressif.py <dossier-fixtures>   ->  prog-5mpx.jpg, prog-5mpx.json"""
import sys, os, json, hashlib
sys.dont_write_bytecode = True
import numpy as np
import PIL
from PIL import Image
d = sys.argv[1]; os.makedirs(d, exist_ok=True)
rng = np.random.default_rng(20261109)
w, h = 2560, 2000
x = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]; y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
a = (np.array([220, 140, 60], np.float32)[None, None, :] * (1 - x) + np.array([30, 80, 200], np.float32)[None, None, :] * x) * (0.6 + 0.4 * y)
a[500:1500, 800:1700] = np.array([235, 215, 110], np.float32)
a += rng.normal(0, 1.0, (h, w, 3)).astype(np.float32)
im = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
f = os.path.join(d, 'prog-5mpx.jpg')
im.save(f, 'JPEG', quality=80, subsampling=2, progressive=True)
rgb = Image.open(f).convert('RGB')
json.dump({'verite': 'Pillow %s Image.open().convert(RGB)' % PIL.__version__, 'largeur': w, 'hauteur': h, 'octets': os.path.getsize(f), 'sha256': hashlib.sha256(rgb.tobytes()).hexdigest()}, open(os.path.join(d, 'prog-5mpx.json'), 'w'))
print('ecrit', f, os.path.getsize(f), 'octets')
# un JPEG 900x600 range avec EXIF orientation 6 (affiche en 600x900) : la chaine doit l'appliquer puis pre-reduire (grand cote 900 > 800)
w2, h2 = 900, 600
x2 = np.linspace(0, 1, w2, dtype=np.float32)[None, :, None]; y2 = np.linspace(0, 1, h2, dtype=np.float32)[:, None, None]
b = (np.array([200, 100, 50], np.float32)[None, None, :] * (1 - x2) + np.array([40, 150, 220], np.float32)[None, None, :] * x2) * (0.6 + 0.4 * y2)
b[150:450, 300:600] = np.array([240, 230, 120], np.float32)
ex = Image.Exif(); ex[0x0112] = 6
Image.fromarray(np.clip(b, 0, 255).astype(np.uint8)).save(os.path.join(d, 'exif6-900x600.jpg'), 'JPEG', quality=85, subsampling=2, exif=ex)
print('ecrit exif6-900x600.jpg', os.path.getsize(os.path.join(d, 'exif6-900x600.jpg')), 'octets')
