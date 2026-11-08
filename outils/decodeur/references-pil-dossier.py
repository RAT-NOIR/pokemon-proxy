# Lit par Pillow chaque fichier du manifeste d'un dossier (fabriquer-differentiel-webp.mjs) et écrit le jeu de preuve : octets (base64), paramètres, empreinte SHA-256 de convert('RGB').tobytes()
# ou l'erreur de Pillow. Usage : python -I references-pil-dossier.py <dossier> <sortie.json>
import base64, hashlib, json, os, sys
import PIL
from PIL import Image, features
dossier, sortie = sys.argv[1], sys.argv[2]
m = json.load(open(os.path.join(dossier, 'manifeste.json'), encoding='utf8'))
cas = []; erreurs = 0
for c in m['cas']:
    o = open(os.path.join(dossier, c['nom']), 'rb').read()
    e = dict(c); e['b64'] = base64.b64encode(o).decode('ascii')
    try:
        im = Image.open(os.path.join(dossier, c['nom'])); im.load(); rgb = im.convert('RGB')
        e['pil'] = {'w': rgb.width, 'h': rgb.height, 'sha256': hashlib.sha256(rgb.tobytes()).hexdigest()}
    except Exception as ex:
        e['pil'] = None; e['erreurPil'] = str(ex)[:120]; erreurs += 1
    cas.append(e)
json.dump({'pillow': PIL.__version__, 'libwebp': features.version('webp'), 'rejets': m['rejets'], 'cas': cas}, open(sortie, 'w', encoding='utf8'))
print(len(cas), 'cas,', erreurs, 'erreurs Pillow')
