"""Fabrique le lot du TEST DE DETECTION de la page de banc : des images COMPOSEES a partir de visuels publics du catalogue (p8000-quant\\images) posees sur des fonds SYNTHETIQUES.
  python -I fabriquer-lot-detection.py <sortie-lot-sans-attendus.json>
Aucune photo d'annonce, aucune photo du juge, du banc eBay ni de la calibration : les visuels sont tires au sort (graine fixe) HORS des exclusions EN EMPREINTES DE CONTENU
(outils/decodeur/exclusions.py : juge, banc eBay, calibration, et les visuels de catalogue qui sont leur reponse) ; le script LEVE si l'echantillon en contient un.
Chaque image : un fond (degrade + bandes + bruit, graine par image), le visuel redimensionne, tourne et mis en perspective (PIL), une ombre, puis JPEG / WebP / PNG.
Les ATTENDUS (quadrilatere, empreintes) sont ajoutes ensuite par ajouter-attendus.mjs, calcules par la chaine node ET verifies par Chrome."""
import sys, os, io, json, base64, hashlib, random
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'decodeur'))
import numpy as np
from PIL import Image, ImageFilter
import exclusions as X

sortie = sys.argv[1]
GRAINE = 20261108
exc = X.charger()
X.temoin_negatif(exc)
noms = sorted(f for f in os.listdir(X.IMAGES) if f.endswith('.webp') and f not in exc['noms'])
rng = random.Random(GRAINE)
tire = rng.sample(noms, 40)
chemins = [os.path.join(X.IMAGES, n) for n in tire]
sha, illisibles = X.verifier_echantillon(chemins, exc)          # LEVE si un visuel tire est exclu
print('exclusions', exc['comptes'], '; echantillon', len(chemins), 'illisibles', len(illisibles))

# (id, largeur, hauteur, format, rotation deg, perspective, fond)
PLAN = [
    ('d01', 800, 600, 'jpeg', -8, 0.00, 0), ('d02', 600, 800, 'jpeg', 5, 0.00, 1), ('d03', 800, 800, 'jpeg', 12, 0.00, 2), ('d04', 900, 700, 'jpeg', -14, 0.00, 3),
    ('d05', 800, 600, 'jpeg', 3, 0.06, 4), ('d06', 800, 640, 'webp', -6, 0.05, 5), ('d07', 700, 900, 'webp', 9, 0.04, 6), ('d08', 640, 480, 'png', -3, 0.00, 7),
    ('d09', 1000, 750, 'jpeg', 7, 0.04, 8), ('d10', 1280, 960, 'jpeg', -5, 0.03, 9), ('d11', 800, 600, 'jpeg', 0, 0.00, 10), ('d12', 560, 420, 'jpeg', 6, 0.03, 11),
]


def fond(w, h, g):
    r = np.random.default_rng(GRAINE + g)
    x = np.linspace(0, 1, w)[None, :, None]; y = np.linspace(0, 1, h)[:, None, None]
    c0 = r.integers(40, 215, 3); c1 = r.integers(40, 215, 3)
    img = (c0[None, None, :] * (1 - x) + c1[None, None, :] * x) * (0.75 + 0.25 * y) * np.ones((h, w, 3))
    bande = (np.sin((np.arange(w)[None, :, None] * 0.05 + np.arange(h)[:, None, None] * 0.02) * (1 + g % 3)) * 14)
    img = img + bande + r.normal(0, 0.0 if g == 7 else 1.5, (h, w, 3))   # le PNG (g == 7) sans bruit : un bruit est incompressible
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


def composer(chemin, w, h, rot, persp, g):
    base = fond(w, h, g).convert('RGBA')
    carte = Image.open(chemin).convert('RGB')
    cw = int(min(w, h) * 0.62); ch = int(cw * 88 / 63)
    if ch > h * 0.88: ch = int(h * 0.88); cw = int(ch * 63 / 88)
    carte = carte.resize((cw, ch), Image.LANCZOS).convert('RGBA')
    if persp:
        coef = (1, persp * 0.2, 0, 0, 1, 0, persp * 0.0006, persp * 0.0004)   # x_src = (a x + b y + c) / (g x + h y + 1) : une legere fuite
        carte = carte.transform(carte.size, Image.PERSPECTIVE, coef, Image.BICUBIC)
    carte = carte.rotate(rot, expand=True, resample=Image.BICUBIC)
    alpha = carte.split()[3]
    ombre = Image.new('RGBA', carte.size, (0, 0, 0, 0)); ombre.paste((0, 0, 0, 120), (0, 0), alpha); ombre = ombre.filter(ImageFilter.GaussianBlur(7))
    ox, oy = (w - carte.width) // 2, (h - carte.height) // 2
    base.alpha_composite(ombre, (min(max(ox + 6, 0), w - ombre.width), min(max(oy + 8, 0), h - ombre.height)))
    base.alpha_composite(carte, (ox, oy))
    return base.convert('RGB')


lot = {'version': 1, 'provenance': 'images composees : visuels publics du catalogue Rat-Market (p8000-quant/images, tirage seed %d hors exclusions) sur fonds synthetiques ; aucune photo d\'annonce' % GRAINE, 'exclusions': exc['comptes'], 'images': []}
for i, (id_, w, h, fmt, rot, persp, g) in enumerate(PLAN):
    im = composer(chemins[i], w, h, rot, persp, g)
    b = io.BytesIO()
    if fmt == 'jpeg': im.save(b, 'JPEG', quality=80, subsampling=2)
    elif fmt == 'webp': im.save(b, 'WEBP', quality=78, method=4)
    else: im.save(b, 'PNG', compress_level=6)
    octets = b.getvalue()
    lot['images'].append({'id': id_, 'format': fmt, 'largeur': w, 'hauteur': h, 'octets': len(octets), 'sha256': hashlib.sha256(octets).hexdigest(), 'source': 'catalogue:' + tire[i][:12], 'b64': base64.b64encode(octets).decode()})
    print(id_, fmt, w, h, len(octets))
json.dump(lot, open(sortie, 'w'), indent=0)
print('ecrit', sortie, sum(i['octets'] for i in lot['images']), 'octets d\'images')
