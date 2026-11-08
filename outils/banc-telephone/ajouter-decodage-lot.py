"""Ajoute au lot de la page de banc telephone (v2/banc-telephone/public/lot.json) le CHAMP `dec` des N_DEC premieres cartes : les pixels 420 x 587 x 3 (RGB, HWC) tels que PIL decode le JPEG de la carte.
  python -I outils\\banc-telephone\\ajouter-decodage-lot.py
Pourquoi : la page compare le decodage JPEG du navigateur (createImageBitmap + canvas) a CE decodage de reference, pour dire si l'ecart de la chaine complete vient du decodeur du navigateur ou d'ailleurs.
Aucune autre donnee du lot ne change (references, pixels 224, JPEG, sha) : le script le VERIFIE (le redimensionnement PIL du decodage retrouve exactement `px`). Idempotent.
Lecture + ecriture du seul fichier lot.json."""
import base64, io, json, os, sys
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image

LOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'v2', 'banc-telephone', 'public', 'lot.json')
N_DEC = 2

lot = json.load(open(LOT, encoding='utf8'))
for i, c in enumerate(lot['cartes']):
    if i >= N_DEC:
        c.pop('dec', None)
        continue
    dec = Image.open(io.BytesIO(base64.b64decode(c['jpg']))).convert('RGB')
    assert dec.size == tuple(lot['carte']), dec.size
    # controle : le decodage ecrit ici redonne les pixels 224 du lot, au bit pres (sinon le lot n'a pas ete fait avec ce decodeur : refus)
    px = np.asarray(dec.resize((224, 224), Image.BICUBIC), dtype=np.uint8)
    assert px.tobytes() == base64.b64decode(c['px']), 'le decodage PIL de la carte %d ne redonne pas px' % i
    c['dec'] = base64.b64encode(np.asarray(dec, dtype=np.uint8).tobytes()).decode()
with open(LOT, 'w', encoding='utf8') as g:
    json.dump(lot, g, separators=(',', ':'))
print('lot :', len(lot['cartes']), 'cartes,', os.path.getsize(LOT), 'octets,', N_DEC, 'avec decodage de reference ; pillow', __import__('PIL').__version__)
