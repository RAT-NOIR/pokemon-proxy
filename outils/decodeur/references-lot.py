# La vérité PIL des 30 cartes du lot de la page de banc : pour chaque JPEG de lot.json, l'empreinte SHA-256 de Image.open(...).convert('RGB').tobytes().
# Usage : python -I references-lot.py <lot.json> <sortie.json>
import base64, hashlib, io, json, sys
import PIL
from PIL import Image, features

lot = json.load(open(sys.argv[1], encoding='utf8'))
sortie = {'pillow': PIL.__version__, 'libjpeg_turbo': features.version('libjpeg_turbo'), 'cartes': {}}
for c in lot['cartes']:
    o = base64.b64decode(c['jpg'])
    im = Image.open(io.BytesIO(o)); im.load()
    rgb = im.convert('RGB')
    sortie['cartes'][c['id']] = {'w': rgb.width, 'h': rgb.height, 'mode': im.mode, 'sha256': hashlib.sha256(rgb.tobytes()).hexdigest(), 'jpg_sha256': hashlib.sha256(o).hexdigest()}
json.dump(sortie, open(sys.argv[2], 'w', encoding='utf8'))
print(len(sortie['cartes']), 'cartes')
