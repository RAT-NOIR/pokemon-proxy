# Un échantillon de VISUELS DU CATALOGUE (webp, copie locale p8000-quant\images), tirés au sort (graine fixe), HORS juges, banc eBay et lot de calibration,
# avec la vérité Pillow : Image.open(...).convert('RGB').tobytes() -> sha256. Écrit un manifeste ; ne copie aucun visuel.
# Exclusion : par nom (pré-filtre) PUIS contrôle APRÈS tirage par empreinte de contenu (exclusions.py) : l'intersection doit être vide, sinon le script LÈVE ; les fichiers illisibles sont comptés.
# Usage : python -I references-catalogue.py <N> <sortie.json>
import hashlib, json, os, random, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import PIL
from PIL import Image
import exclusions as X

ex = X.charger()
X.temoin_negatif(ex)       # le contrôle d'exclusion sait dire NON (empreinte du juge plantée) avant d'être cru
print('exclusions :', json.dumps(ex['comptes']))
fichiers = sorted(x for x in os.listdir(X.IMAGES) if x.endswith('.webp'))
restants = [x for x in fichiers if x not in ex['noms']]
print('visuels', len(fichiers), 'exclus par nom', len(fichiers) - len(restants), 'restants', len(restants))
random.Random(20261108).shuffle(restants)
n = int(sys.argv[1]); sortie = []; illisibles = []
for f in restants:
    if len(sortie) == n: break
    p = os.path.join(X.IMAGES, f)
    try:
        im = Image.open(p); im.load(); fmt = im.format; rgb = im.convert('RGB')
    except Exception as e:
        illisibles.append((f, str(e)[:80])); continue
    sortie.append({'fichier': f, 'chemin': p, 'format': fmt, 'mode': im.mode, 'w': rgb.width, 'h': rgb.height, 'sha256': hashlib.sha256(rgb.tobytes()).hexdigest(), 'octets': os.path.getsize(p)})
sha, ill2 = X.verifier_echantillon([c['chemin'] for c in sortie], ex)     # LÈVE si l'intersection n'est pas vide
illisibles += ill2
for c in sortie: c['sha256Fichier'] = sha[c['chemin']]
json.dump({'pillow': PIL.__version__, 'exclusions': ex['comptes'], 'illisibles': len(illisibles), 'cartes': sortie}, open(sys.argv[2], 'w', encoding='utf8'))
print(len(sortie), 'visuels dans le manifeste ; intersection avec les exclusions : 0 (contrôlée par contenu) ; fichiers illisibles comptés :', len(illisibles))
