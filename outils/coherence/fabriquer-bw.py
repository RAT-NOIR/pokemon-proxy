"""Isole le DECODEUR WebP : les MEMES fichiers WebP de B (LANCZOS) et BB (BILINEAR) sont decodes par libwebp (Pillow) et ecrits en PNG sans perte ; la chaine les lit alors sans decodeur WebP JavaScript.
  python -I fabriquer-bw.py <dossier-donnees>      (lit <dossier>\\b-manifeste.json ; ecrit <dossier>\\bw\\<sha>.png, bbw\\<sha>.png, bw-manifeste.json)
A contre BW = effet du ré-encodage WebP + du filtre LANCZOS ; B contre BW = effet du decodeur WebP JavaScript. Aucun reseau."""
import sys, os, json
sys.dont_write_bytecode = True
from PIL import Image
d = sys.argv[1]
man = json.load(open(os.path.join(d, 'b-manifeste.json'), encoding='utf8'))
os.makedirs(os.path.join(d, 'bw'), exist_ok=True); os.makedirs(os.path.join(d, 'bbw'), exist_ok=True)
out = {}
for sha, m in sorted(man.items()):
    fb, fbb = os.path.join(d, 'bw', sha + '.png'), os.path.join(d, 'bbw', sha + '.png')
    Image.open(m['b']).convert('RGB').save(fb, 'PNG'); Image.open(m['bb']).convert('RGB').save(fbb, 'PNG')
    out[sha] = {'bw': fb, 'bbw': fbb}
json.dump(out, open(os.path.join(d, 'bw-manifeste.json'), 'w'))
print('bw', len(out))
