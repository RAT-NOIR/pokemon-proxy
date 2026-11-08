# Un échantillon de VISUELS DU CATALOGUE (webp, copie locale p8000-quant\images), tirés au sort (graine fixe), HORS juges, banc eBay et lot de calibration (mêmes listes d'exclusion que fabriquer-lot.py),
# avec la vérité Pillow : Image.open(...).convert('RGB').tobytes() -> sha256. Écrit un manifeste ; ne copie aucun visuel.
# Usage : python -I references-catalogue.py <N> <sortie.json>
import hashlib, json, os, random, sys
import PIL
from PIL import Image

API = r'C:\Users\Yung\rat-market-travail\api'
IMAGES = API + r'\p8000-quant\images'
GARDE = API + r'\kaggle-v2\maitre-v4\ds-code\garde-juges.json'
EBAY = API + r'\kaggle-v2\maitre-v4\ds-code\exclusion-ebay.json'
nom_fichier = lambda cle: hashlib.sha1(cle.encode()).hexdigest() + '.webp'
garde = json.load(open(GARDE, encoding='utf8'))['exclus']
ebay = json.load(open(EBAY, encoding='utf8'))
exclues = set(garde) | {l['cle'] for l in ebay['banc']} | {l['cle'] for l in ebay['calibration']}
assert len(exclues) > 3000, 'listes d\'exclusion tronquees : refus'
exclus = {nom_fichier(c) for c in exclues}
fichiers = sorted(x for x in os.listdir(IMAGES) if x.endswith('.webp'))
restants = [x for x in fichiers if x not in exclus]
print('visuels', len(fichiers), 'exclus', len(fichiers) - len(restants), 'restants', len(restants))
random.Random(20261108).shuffle(restants)
n = int(sys.argv[1]); sortie = []
for f in restants:
    if len(sortie) == n: break
    p = os.path.join(IMAGES, f)
    try:
        im = Image.open(p); im.load(); fmt = im.format; rgb = im.convert('RGB')
    except Exception as e:
        continue
    sortie.append({'fichier': f, 'chemin': p, 'format': fmt, 'mode': im.mode, 'w': rgb.width, 'h': rgb.height, 'sha256': hashlib.sha256(rgb.tobytes()).hexdigest(), 'octets': os.path.getsize(p)})
json.dump({'pillow': PIL.__version__, 'cartes': sortie}, open(sys.argv[2], 'w', encoding='utf8'))
print(len(sortie), 'visuels dans le manifeste')
