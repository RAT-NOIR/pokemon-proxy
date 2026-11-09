"""Etape 2 : la VERITE de la pre-reduction = Image.resize((W, H), BILINEAR) de Pillow sur les sources de fabriquer-fixture-pre.mjs ; ecrit le SHA-256 des octets RGB sortis.
  python -I fixture-pre-pillow.py <dossier-sources> <sortie.json>"""
import sys, os, json, hashlib
sys.dont_write_bytecode = True
import numpy as np
import PIL
from PIL import Image
d, sortie = sys.argv[1], sys.argv[2]
cas = json.load(open(os.path.join(d, 'cas.json')))
for c in cas:
    a = np.fromfile(os.path.join(d, '%d.rgb' % c['graine']), dtype=np.uint8).reshape(c['h'], c['w'], 3)
    r = Image.fromarray(a).resize((c['W'], c['H']), Image.BILINEAR)
    c['sha256'] = hashlib.sha256(r.tobytes()).hexdigest()
    if c.get('divergente'):   # h/w >= 2 : Pillow inverse l'ordre des passes ; on mesure l'ampleur de l'ecart avec NOTRE sortie (ordre fixe : horizontal puis vertical)
        nous = np.fromfile(os.path.join(d, '%d.rm.rgb' % c['graine']), dtype=np.uint8).reshape(c['H'], c['W'], 3).astype(int)
        diff = np.abs(nous - np.asarray(r).astype(int))
        c['octetsDifferents'] = int((diff > 0).sum()); c['octetsTotal'] = int(diff.size); c['ecartMax'] = int(diff.max())
json.dump({'verite': 'Pillow %s Image.resize BILINEAR' % PIL.__version__, 'cas': cas}, open(sortie, 'w'))
print('ecrit', sortie, len(cas), 'cas, Pillow', PIL.__version__)
