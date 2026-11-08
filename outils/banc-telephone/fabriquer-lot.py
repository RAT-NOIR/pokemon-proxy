"""Fabrique le lot de la page de banc telephone (v2/banc-telephone/public/lot.json).
  python -I outils\\banc-telephone\\fabriquer-lot.py
Origine des images : des VISUELS DU CATALOGUE (archive publique des visuels, copie locale p8000-quant\\images\\<sha1>.webp), tires au sort (graine fixe).
Ce ne sont ni des photos de juge, ni du banc eBay, ni du lot de calibration : des scans de catalogue, jamais des photos d'annonce.
Chaque visuel est ramene a 420 x 587 (la carte redressee du contrat), enregistre en JPEG 0,92 (comme la carte de l'extension) ; c'est CE JPEG que la page decode.
Reference NATIVE : onnxruntime CPU (Python), meme pretraitement que le producteur (PIL RGB -> Resize 224 bicubique -> (x/255-0,5)/0,5), sortie `emb` normalisee L2.
  ref : 256 float32 (petit-boutiste, base64)   px : les 224 x 224 x 3 octets PIL (HWC) — SEULEMENT pour les premieres cartes, pour mesurer le modele seul (sans decodage ni redimensionnement navigateur).
Lecture seule sur les images et le modele ; ecrit un seul fichier."""
import base64, hashlib, io, json, os, random, sys
sys.dont_write_bytecode = True
import numpy as np
from PIL import Image
import onnxruntime as ort

MODELE = r'C:\Users\Yung\rat-market-travail\api\etude-sans-service\onnx\p8000-poids8s.onnx'
SHA_ATTENDU = '857105e3eb00'
IMAGES = r'C:\Users\Yung\rat-market-travail\api\p8000-quant\images'
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'v2', 'banc-telephone', 'public', 'lot.json')
N, N_PX, GRAINE = 30, 12, 20261108

h = hashlib.sha256()
with open(MODELE, 'rb') as f:
    for b in iter(lambda: f.read(1 << 20), b''):
        h.update(b)
sha = h.hexdigest()
assert sha.startswith(SHA_ATTENDU), 'le modele n\'est pas le servi : ' + sha

fichiers = sorted(x for x in os.listdir(IMAGES) if x.endswith('.webp'))
random.Random(GRAINE).shuffle(fichiers)
choisis = []
for f in fichiers:
    if len(choisis) == N:
        break
    try:
        im = Image.open(os.path.join(IMAGES, f))
        im.load()
    except Exception:
        continue
    # une carte portrait de proportions voisines de 63 x 88 : on ecarte les visuels aberrants (bannieres, planches)
    if not (0.62 <= im.width / im.height <= 0.80) or im.height < 300:
        continue
    choisis.append((f, im))
assert len(choisis) == N, len(choisis)

so = ort.SessionOptions()
so.intra_op_num_threads = 4
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
s = ort.InferenceSession(MODELE, so, providers=['CPUExecutionProvider'])

cartes = []
for i, (f, im) in enumerate(choisis):
    carte = im.convert('RGB').resize((420, 587), Image.BICUBIC)
    tampon = io.BytesIO()
    carte.save(tampon, 'JPEG', quality=92)
    jpg = tampon.getvalue()
    dec = Image.open(io.BytesIO(jpg)).convert('RGB')          # ce que la reference voit : le JPEG, pas la carte avant compression
    px = np.asarray(dec.resize((224, 224), Image.BICUBIC), dtype=np.uint8)
    a = px.astype(np.float32) / 255.0
    x = ((a - 0.5) / 0.5).transpose(2, 0, 1)[None].copy().astype(np.float32)
    e = s.run(['emb'], {'pixel_values': x})[0].astype(np.float32)[0]
    e = (e / np.linalg.norm(e)).astype(np.float32)
    c = {'id': 'v%02d' % i, 'origine': 'catalogue:' + f, 'jpg': base64.b64encode(jpg).decode(), 'ref': base64.b64encode(e.tobytes()).decode()}
    if i < N_PX:
        c['px'] = base64.b64encode(px.tobytes()).decode()
    cartes.append(c)

os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
with open(SORTIE, 'w', encoding='utf8') as g:
    json.dump({'modeleSha256': sha, 'graine': GRAINE, 'cote': 224, 'carte': [420, 587], 'cartes': cartes}, g, separators=(',', ':'))
print('lot :', len(cartes), 'cartes,', os.path.getsize(SORTIE), 'octets,', N_PX, 'avec pixels 224')
