"""SIMULATION (jamais appelee « vraies photos ») : des images de 12 Mpx COMPOSEES de visuels haute definition sur des fonds synthetiques, avec le quadrilatere de la carte CONNU (verite de position, pas d'idProduct).
  python -I fabriquer-simulation.py <dossier-sortie> [n=40]
Visuels : tampons-web (scans officiels, les plus grands), tires au sort (graine fixe) HORS exclusions en empreintes de contenu (juge, banc eBay, calibration : outils/decodeur/exclusions.py ; le script leve si l'intersection est non vide).
Formats : 4032x3024 (paysage), 3024x4032 (portrait), et 3024x4032 rangee en 4032x3024 avec EXIF orientation 6 (comme un iPhone en portrait) ; JPEG qualite 90, 4:2:0.
Sortie : <dossier>\\sim-NN.jpg + verites.json { id: { quad: [[x,y]x4] dans l'image AFFICHEE (EXIF applique), affichee: [w,h], exif: 0|6, visuel } } + manifeste.json { id: fichier }."""
import sys, os, json, random, hashlib
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'decodeur'))
import numpy as np
from PIL import Image, ImageFilter
import exclusions as X

sortie = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 40
os.makedirs(sortie, exist_ok=True)
SRC = r'C:\Users\Yung\rat-market-travail\api\tampons-web'
GRAINE = 20261109
exc = X.charger(); X.temoin_negatif(exc)
fichiers = sorted(os.path.relpath(os.path.join(r, f), SRC) for r, _, fs in os.walk(SRC) for f in fs if f.lower().endswith(('.webp', '.png')))
grands = []
for f in fichiers:
    try:
        with Image.open(os.path.join(SRC, f)) as im:
            if max(im.size) >= 1000: grands.append(f)
    except Exception: pass
avant = len(grands)
grands = [f for f in grands if X.sha256_fichier(os.path.join(SRC, f)) not in exc['empreintes']]     # on RETIRE d'abord les visuels exclus (reponses du banc, du juge, de la calibration) ; la verification finale reste
print('visuels grands', avant, '-> hors exclusions', len(grands))
rng = random.Random(GRAINE)
tire = rng.sample(grands, N)
sha, ill = X.verifier_echantillon([os.path.join(SRC, f) for f in tire], exc)
print('exclusions', exc['comptes'], '; visuels grands', len(grands), '; tires', len(tire), '; illisibles', len(ill))


def coefficients(dst, src):
    """Perspective PIL : coefficients (a..h) qui envoient les points DESTINATION vers la SOURCE."""
    A = []; B = []
    for (x, y), (u, v) in zip(dst, src):
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    return np.linalg.solve(np.array(A, float), np.array(B, float))


def fond(w, h, g):
    r = np.random.default_rng(GRAINE + g)
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :, None]; y = np.linspace(0, 1, h, dtype=np.float32)[:, None, None]
    c0 = r.integers(30, 220, 3).astype(np.float32); c1 = r.integers(30, 220, 3).astype(np.float32)
    img = (c0[None, None, :] * (1 - x) + c1[None, None, :] * x) * (0.75 + 0.25 * y)
    img = img + np.sin((np.arange(w, dtype=np.float32)[None, :, None] * 0.02 + np.arange(h, dtype=np.float32)[:, None, None] * 0.008) * (1 + g % 4)) * 12
    img = img + r.normal(0, 2.0, (h, w, 3)).astype(np.float32)
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))


verites, manifeste = {}, {}
for i, f in enumerate(tire):
    mode = i % 5    # 0..2 paysage, 3 portrait, 4 portrait range en paysage avec EXIF 6
    portrait = mode >= 3
    w, h = (3024, 4032) if portrait else (4032, 3024)
    base = fond(w, h, i)
    carte = Image.open(os.path.join(SRC, f)).convert('RGB')
    r = random.Random(GRAINE + i)
    ch = int(min(w, h) * r.uniform(0.62, 0.90)); cw = int(ch * 63 / 88)
    ang = r.uniform(-22, 22) * np.pi / 180
    cx, cy = w / 2 + r.uniform(-0.06, 0.06) * w, h / 2 + r.uniform(-0.06, 0.06) * h
    dst = []
    for dx, dy in [(-cw / 2, -ch / 2), (cw / 2, -ch / 2), (cw / 2, ch / 2), (-cw / 2, ch / 2)]:
        dx += r.uniform(-1, 1) * cw * 0.02 * (i % 3); dy += r.uniform(-1, 1) * ch * 0.02 * (i % 3)    # une legere fuite en perspective sur 2 images sur 3
        dst.append((cx + dx * np.cos(ang) - dy * np.sin(ang), cy + dx * np.sin(ang) + dy * np.cos(ang)))
    cs = carte.resize((1500, int(1500 * 88 / 63)), Image.LANCZOS)
    src = [(0, 0), (cs.width, 0), (cs.width, cs.height), (0, cs.height)]
    coef = coefficients(dst, src)
    gauchi = cs.convert('RGBA').transform((w, h), Image.PERSPECTIVE, tuple(coef), Image.BICUBIC)
    masque = Image.new('L', (cs.width, cs.height), 255).transform((w, h), Image.PERSPECTIVE, tuple(coef), Image.BILINEAR)
    ombre = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ombre.paste((0, 0, 0, 110), (0, 0), masque); ombre = ombre.filter(ImageFilter.GaussianBlur(14))
    comp = base.convert('RGBA'); comp.alpha_composite(ombre, (10, 14)); comp.paste(gauchi, (0, 0), masque)
    im = comp.convert('RGB')
    id_ = 'sim%02d' % i
    chemin = os.path.join(sortie, id_ + '.jpg')
    if mode == 4:
        ex = Image.Exif(); ex[0x0112] = 6
        im.transpose(Image.ROTATE_90).save(chemin, 'JPEG', quality=90, subsampling=2, exif=ex)        # rangee en paysage, EXIF 6 : affichee en portrait
    else:
        im.save(chemin, 'JPEG', quality=90, subsampling=2)
    verites[id_] = { 'quad': [[float(x), float(y)] for x, y in dst], 'affichee': [w, h], 'exif': 6 if mode == 4 else 0, 'visuel': f }
    manifeste[id_] = chemin
    if i % 8 == 0: print(id_, w, h, 'exif', verites[id_]['exif'], os.path.getsize(chemin))
json.dump(verites, open(os.path.join(sortie, 'verites.json'), 'w')); json.dump(manifeste, open(os.path.join(sortie, 'manifeste.json'), 'w'))
print('ecrit', len(manifeste), 'images, total', sum(os.path.getsize(p) for p in manifeste.values()) // 1048576, 'Mo')
