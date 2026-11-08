"""Fabrique le lot de la page de banc telephone (v2/banc-telephone/public/lot.json).
  python -I outils\\banc-telephone\\fabriquer-lot.py
Origine des images : des VISUELS DU CATALOGUE (archive publique des visuels, copie locale p8000-quant\\images\\<sha1(cle)>.webp), tires au sort (graine fixe).
EXCLUSIONS (tour 1, G1) : tout visuel liste par garde-juges.json (juges et leurs voisins) OU par exclusion-ebay.json (banc eBay de 3 000 et lot de calibration de 1 500 : la `cle` de chaque ligne est le visuel-REPONSE)
est ecarte AVANT le tirage ; le script imprime les comptes et ASSERTE 0 recoupement entre les 30 cartes et ces listes.
Chaque visuel est ramene a 420 x 587 (la carte redressee du contrat), enregistre en JPEG 0,92 ; c'est CE JPEG que la page decode.
Reference NATIVE : onnxruntime CPU (Python), meme pretraitement que le producteur (PIL RGB -> Resize 224 bicubique -> (x/255-0,5)/0,5), sortie `emb` normalisee L2. Versions d'onnxruntime et de PIL ecrites dans le lot.
  ref : 256 float32 (petit-boutiste, base64)   px : les 224 x 224 x 3 octets PIL (HWC) — SEULEMENT pour les premieres cartes (modele seul).
Tracabilite par carte : cle source, metacartes, idProduct, nom, idExpansion (export Cardmarket local), sha256 du visuel.
Lecture seule sur les images, le modele et les listes ; ecrit un seul fichier."""
import base64, hashlib, io, json, os, random, sys
sys.dont_write_bytecode = True
import numpy as np
import PIL
from PIL import Image
import onnxruntime as ort

API = r'C:\Users\Yung\rat-market-travail\api'
MODELE = API + r'\etude-sans-service\onnx\p8000-poids8s.onnx'
SHA_ATTENDU = '857105e3eb00'
IMAGES = API + r'\p8000-quant\images'
GARDE = API + r'\kaggle-v2\maitre-v4\ds-code\garde-juges.json'
EBAY = API + r'\kaggle-v2\maitre-v4\ds-code\exclusion-ebay.json'
CLES = API + r'\index-empreintes-essai\sortie\cles.json'
CONTEXTE = API + r'\index-empreintes-essai\sortie\contexte.json'
PRODUITS = r'C:\Users\Yung\Desktop\pokemon-proxy-api-v2\products_singles_6.json'
SORTIE = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'v2', 'banc-telephone', 'public', 'lot.json')
N, N_PX, GRAINE = 30, 12, 20261108
nom_fichier = lambda cle: hashlib.sha1(cle.encode()).hexdigest() + '.webp'

h = hashlib.sha256()
with open(MODELE, 'rb') as f:
    for b in iter(lambda: f.read(1 << 20), b''):
        h.update(b)
sha = h.hexdigest()
assert sha.startswith(SHA_ATTENDU), 'le modele n\'est pas le servi : ' + sha

# ── les exclusions : des CLES, puis des noms de fichiers
garde = json.load(open(GARDE, encoding='utf8'))['exclus']
ebay = json.load(open(EBAY, encoding='utf8'))
cles_banc = {l['cle'] for l in ebay['banc']}
cles_calib = {l['cle'] for l in ebay['calibration']}
exclues = set(garde) | cles_banc | cles_calib
fichiers_exclus = {nom_fichier(c) for c in exclues}
print('exclusions : garde-juges %d cles, banc eBay %d, calibration %d, union %d' % (len(garde), len(cles_banc), len(cles_calib), len(exclues)))
assert len(cles_banc) > 1000 and len(cles_calib) > 500 and len(garde) > 100, 'une liste d\'exclusion est vide ou tronquee : refus'

cles = json.load(open(CLES, encoding='utf8'))
par_fichier = {nom_fichier(c): c for c in cles}
contexte_carte = json.load(open(CONTEXTE, encoding='utf8'))['carte']
par_metacarte = {}
for p in json.load(open(PRODUITS, encoding='utf8'))['products']:
    par_metacarte.setdefault(p['idMetacard'], p)

fichiers = sorted(x for x in os.listdir(IMAGES) if x.endswith('.webp'))
n_avant = len(fichiers)
fichiers = [x for x in fichiers if x not in fichiers_exclus]
print('visuels locaux : %d, apres exclusion : %d (%d retires)' % (n_avant, len(fichiers), n_avant - len(fichiers)))
random.Random(GRAINE).shuffle(fichiers)
choisis = []
for f in fichiers:
    if len(choisis) == N:
        break
    if f not in par_fichier:           # sans cle source connue : non tracable, ecarte
        continue
    try:
        im = Image.open(os.path.join(IMAGES, f))
        im.load()
    except Exception:
        continue
    if not (0.62 <= im.width / im.height <= 0.80) or im.height < 300:
        continue
    choisis.append((f, im))
assert len(choisis) == N, len(choisis)
# 0 recoupement, verifie sur les CLES des cartes retenues ET sur les noms de fichiers
cles_choisies = [par_fichier[f] for f, _ in choisis]
for nom, liste in (('garde-juges', set(garde)), ('banc eBay', cles_banc), ('calibration', cles_calib)):
    recoupe = [c for c in cles_choisies if c in liste]
    print('recoupement avec %s : %d' % (nom, len(recoupe)))
    assert not recoupe, 'RECOUPEMENT avec %s : %s' % (nom, recoupe)
assert not ({f for f, _ in choisis} & fichiers_exclus)

so = ort.SessionOptions()
so.intra_op_num_threads = 4
so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
s = ort.InferenceSession(MODELE, so, providers=['CPUExecutionProvider'])

cartes = []
for i, (f, im) in enumerate(choisis):
    cle = par_fichier[f]
    ids = contexte_carte.get(cle) or []
    produit = next((par_metacarte[m] for m in ids if m in par_metacarte), None)
    with open(os.path.join(IMAGES, f), 'rb') as g:
        sha_visuel = hashlib.sha256(g.read()).hexdigest()
    carte = im.convert('RGB').resize((420, 587), Image.BICUBIC)
    tampon = io.BytesIO()
    carte.save(tampon, 'JPEG', quality=92)
    jpg = tampon.getvalue()
    dec = Image.open(io.BytesIO(jpg)).convert('RGB')
    px = np.asarray(dec.resize((224, 224), Image.BICUBIC), dtype=np.uint8)
    a = px.astype(np.float32) / 255.0
    x = ((a - 0.5) / 0.5).transpose(2, 0, 1)[None].copy().astype(np.float32)
    e = s.run(['emb'], {'pixel_values': x})[0].astype(np.float32)[0]
    e = (e / np.linalg.norm(e)).astype(np.float32)
    c = {'id': 'v%02d' % i, 'origine': 'catalogue:' + f, 'cle': cle, 'sha256Visuel': sha_visuel, 'metacartes': ids[:5],
         'idProduct': produit['idProduct'] if produit else None, 'nom': produit['name'] if produit else None, 'idExpansion': produit['idExpansion'] if produit else None,
         'jpg': base64.b64encode(jpg).decode(), 'ref': base64.b64encode(e.tobytes()).decode()}
    if i < N_PX:
        c['px'] = base64.b64encode(px.tobytes()).decode()
    cartes.append(c)

os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
with open(SORTIE, 'w', encoding='utf8') as g:
    json.dump({'modeleSha256': sha, 'graine': GRAINE, 'cote': 224, 'carte': [420, 587],
               'natif': {'onnxruntime': ort.__version__, 'pillow': PIL.__version__, 'numpy': np.__version__, 'python': sys.version.split()[0]},
               'exclusions': {'gardeJuges': len(garde), 'banc': len(cles_banc), 'calibration': len(cles_calib), 'recoupement': 0}, 'cartes': cartes}, g, separators=(',', ':'))
print('lot :', len(cartes), 'cartes,', os.path.getsize(SORTIE), 'octets,', N_PX, 'avec pixels 224 ; onnxruntime', ort.__version__, 'PIL', PIL.__version__)
for c in cartes:
    print(' ', c['id'], c['cle'], c['idProduct'], c['nom'])
