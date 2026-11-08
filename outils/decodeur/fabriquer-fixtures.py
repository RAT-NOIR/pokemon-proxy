# FABRIQUE LES JEUX DE PREUVE DU DECODEUR : des images synthétiques (graine fixe) encodées par Pillow sous toutes les formes que le décodeur doit lire,
# et, pour chacune, l'EMPREINTE SHA-256 de la sortie de Pillow (Image.open(...).convert('RGB').tobytes()) : la vérité du décodeur.
# Usage : python -I fabriquer-fixtures.py <sortie.json>
# Les octets des fichiers vont dans le JSON (base64) : le banc node n'a besoin ni de Python ni de Pillow pour REJOUER la preuve ; Pillow ne sert qu'ici.
import base64, hashlib, io, json, sys
import numpy as np
import PIL
from PIL import Image, ImageOps, features

rng = np.random.default_rng(20261108)


def image(w, h, mode='RGB'):
    y, x = np.mgrid[0:h, 0:w]
    r = (x * 255 // max(1, w - 1)) ^ (y * 7)
    g = (y * 255 // max(1, h - 1) + (x * 3)) % 256
    b = ((x + y) * 5) % 256
    a = np.stack([r, g, b], axis=-1).astype(np.int32)
    a += rng.integers(-40, 40, size=a.shape)
    # des aplats et des bords francs : cassent les approximations des filtres
    a[h // 4: h // 2, w // 3: w // 2] = [250, 8, 120]
    a = np.clip(a, 0, 255).astype(np.uint8)
    im = Image.fromarray(a, 'RGB')
    return im.convert('L') if mode == 'L' else im


def sha(b):
    return hashlib.sha256(b).hexdigest()


def reference(octets):
    im = Image.open(io.BytesIO(octets)); im.load()
    rgb = im.convert('RGB')
    r = {'w': rgb.width, 'h': rgb.height, 'sha256': sha(rgb.tobytes())}
    t = ImageOps.exif_transpose(Image.open(io.BytesIO(octets)))
    t = t.convert('RGB')
    r['exif'] = {'w': t.width, 'h': t.height, 'sha256': sha(t.tobytes())}
    return r


def exif_orientation(o):
    e = Image.Exif(); e[0x0112] = o
    return e


cas = []


def ajouter(nom, im, fmt, **kw):
    b = io.BytesIO(); im.save(b, fmt, **kw); o = b.getvalue()
    cas.append({'nom': nom, 'format': fmt.lower(), 'b64': base64.b64encode(o).decode('ascii'), 'octets': len(o), 'pil': reference(o)})


tailles = [(64, 48), (37, 29), (17, 9), (8, 8), (1, 1), (2, 2), (3, 5), (16, 16), (31, 33), (100, 75), (257, 129)]
for (w, h) in tailles:
    im = image(w, h)
    for sous, nomsous in ((0, '444'), (1, '422'), (2, '420')):
        ajouter(f'jpeg-{nomsous}-{w}x{h}', im, 'JPEG', quality=90, subsampling=sous)
    ajouter(f'jpeg-420-q40-{w}x{h}', im, 'JPEG', quality=40, subsampling=2)
    ajouter(f'jpeg-gris-{w}x{h}', image(w, h, 'L'), 'JPEG', quality=85)
for (w, h) in ((64, 48), (37, 29), (257, 129)):
    im = image(w, h)
    ajouter(f'jpeg-progressif-420-{w}x{h}', im, 'JPEG', quality=88, subsampling=2, progressive=True)
    ajouter(f'jpeg-progressif-444-{w}x{h}', im, 'JPEG', quality=88, subsampling=0, progressive=True)
    ajouter(f'jpeg-progressif-gris-{w}x{h}', image(w, h, 'L'), 'JPEG', quality=88, progressive=True)
    ajouter(f'jpeg-optimise-{w}x{h}', im, 'JPEG', quality=75, optimize=True)
    ajouter(f'jpeg-redemarrage-{w}x{h}', im, 'JPEG', quality=80, subsampling=2, restart_marker_blocks=3)
    ajouter(f'jpeg-redemarrage-progressif-{w}x{h}', im, 'JPEG', quality=80, subsampling=2, progressive=True, restart_marker_rows=1)
    ajouter(f'jpeg-rgb-brut-{w}x{h}', im, 'JPEG', quality=90, keep_rgb=True)
    ajouter(f'jpeg-q100-{w}x{h}', im, 'JPEG', quality=100, subsampling=0)
    ajouter(f'jpeg-q1-{w}x{h}', im, 'JPEG', quality=1)
for o in range(1, 9):
    ajouter(f'jpeg-exif{o}-64x48', image(64, 48), 'JPEG', quality=90, exif=exif_orientation(o))
    ajouter(f'jpeg-exif{o}-37x29', image(37, 29), 'JPEG', quality=90, subsampling=2, exif=exif_orientation(o))
ajouter('jpeg-icc-64x48', image(64, 48), 'JPEG', quality=90, icc_profile=b'\x00' * 128)
# WebP : avec perte (suréchantillonnage « fancy » de libwebp), sans perte, avec alpha, méthodes d'encodage différentes
for (w, h) in ((64, 48), (37, 29), (17, 9), (1, 1), (2, 3), (100, 75)):
    im = image(w, h)
    for q in (30, 75, 95):
        ajouter(f'webp-q{q}-{w}x{h}', im, 'WEBP', quality=q, method=4)
    ajouter(f'webp-lossless-{w}x{h}', im, 'WEBP', lossless=True)
    ajouter(f'webp-q80-m6-{w}x{h}', im, 'WEBP', quality=80, method=6)
    ajouter(f'webp-gris-{w}x{h}', image(w, h, 'L').convert('RGB'), 'WEBP', quality=80)
    ajouter(f'webp-exif-{w}x{h}', im, 'WEBP', quality=80, exif=exif_orientation(6))
    rgba = im.convert('RGBA'); rgba.putalpha(Image.fromarray(rng.integers(0, 256, size=(h, w), dtype=np.uint8), 'L'))
    ajouter(f'webp-alpha-{w}x{h}', rgba, 'WEBP', quality=80)
# PNG : tous les filtres, 8 bits RGB, RGBA, gris, palette, entrelacé (Adam7)
for (w, h) in ((64, 48), (37, 29), (1, 1), (100, 75)):
    im = image(w, h)
    ajouter(f'png-rgb-{w}x{h}', im, 'PNG')
    ajouter(f'png-rgb-optimise-{w}x{h}', im, 'PNG', optimize=True, compress_level=9)
    ajouter(f'png-gris-{w}x{h}', image(w, h, 'L'), 'PNG')
    ajouter(f'png-palette-{w}x{h}', im.quantize(64), 'PNG')
    rgba = im.convert('RGBA'); rgba.putalpha(Image.fromarray(rng.integers(0, 256, size=(h, w), dtype=np.uint8), 'L'))
    ajouter(f'png-rgba-{w}x{h}', rgba, 'PNG')
    ajouter(f'png-gris-alpha-{w}x{h}', Image.merge('LA', (image(w, h, 'L'), Image.fromarray(rng.integers(0, 256, size=(h, w), dtype=np.uint8), 'L'))), 'PNG')

# les réductions de référence : Image.resize BILINEAR sur du RGB (la réduction « 640 » proposée)
reductions = []
for (w, h, W, H) in ((120, 150, 512, 640), (150, 100, 640, 427), (80, 60, 640, 480), (170, 106, 640, 401), (700, 30, 640, 27), (30, 700, 27, 640), (641, 40, 640, 40), (64, 48, 640, 480), (100, 100, 640, 640), (1, 1, 640, 640), (900, 25, 640, 18), (37, 29, 640, 502)):
    im = image(w, h)
    # La vérité : les deux passes de Pillow BILINEAR, HORIZONTALE puis VERTICALE (chacune est un Image.resize d'une seule dimension, donc exactement la passe de Resample.c).
    # Pillow, de lui-même, inverse parfois l'ordre des passes (règle non documentée, mesurée : portraits à h/w >= 2, ~12 % des formes aléatoires) ; l'écart est d'un niveau de gris sur quelques pixels.
    # Notre réduction fixe l'ordre : c'est ce qui la rend identique d'un appareil à l'autre, et elle n'a pas à copier Pillow ici.
    if W != w and H != h: r = im.resize((W, h), Image.BILINEAR).resize((W, H), Image.BILINEAR)
    else: r = im.resize((W, H), Image.BILINEAR)
    reductions.append({'w': w, 'h': h, 'W': W, 'H': H, 'src': sha(im.tobytes()), 'sha256': sha(r.tobytes()), 'b64': base64.b64encode(im.tobytes()).decode('ascii')})

sortie = {'pillow': PIL.__version__, 'libjpeg_turbo': features.version('libjpeg_turbo'), 'libwebp': features.version('webp'), 'zlib': features.version('zlib'), 'graine': 20261108, 'cas': cas, 'reductions': reductions}
with open(sys.argv[1], 'w', encoding='utf-8') as f:
    json.dump(sortie, f)
print(len(cas), 'cas,', len(reductions), 'réductions')
