# JPEG et PNG RÉELS pour la comparaison au bit (le catalogue n'a que des WebP) : le jeu fixe du verrou (api-v2\verrou\photos, lecture seule, jamais copié) et les PNG/JPEG du labo
# (labo-embedding, CARDMARKET IMAGE : une seule copie par empreinte de contenu). Lecture seule. Exclusion par empreinte de contenu contre le juge, le banc eBay et la calibration (exclusions.py) :
# les fichiers exclus sont retirés AVANT, puis l'échantillon est recontrôlé APRÈS (le script LÈVE si l'intersection n'est pas vide) ; les illisibles sont comptés.
# Usage : python -I references-reels.py <sortie.json>
import hashlib, json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import PIL
from PIL import Image
import exclusions as X

RACINES = [(r'C:\Users\Yung\Desktop\pokemon-proxy-api-v2\verrou\photos', 'verrou/photos'), (r'C:\Users\Yung\Desktop\labo-embedding', 'labo-embedding'), (r'C:\Users\Yung\Desktop\CARDMARKET IMAGE', 'CARDMARKET IMAGE')]
EXT = ('.jpg', '.jpeg', '.png')
ex = X.charger()
X.temoin_negatif(ex)       # le contrôle d'exclusion sait dire NON (empreinte du juge plantée) avant d'être cru
print('exclusions :', json.dumps(ex['comptes']))
candidats = []
for racine, nom in RACINES:
    for dp, _, fs in os.walk(racine):
        for f in sorted(fs):
            if f.lower().endswith(EXT): candidats.append((os.path.join(dp, f), nom))
print('candidats', len(candidats))
vus, retenus, retires, doublons, illisibles = set(), [], 0, 0, []
for p, origine in candidats:
    try: s = X.sha256_fichier(p)
    except Exception as e: illisibles.append((p, str(e)[:80])); continue
    if s in ex['empreintes']: retires += 1; continue
    if s in vus: doublons += 1; continue
    vus.add(s)
    try:
        im = Image.open(p); im.load(); fmt = im.format; mode = im.mode; rgb = im.convert('RGB')
    except Exception as e:
        illisibles.append((p, str(e)[:80])); continue
    retenus.append({'fichier': os.path.basename(p), 'chemin': p, 'origine': origine, 'format': fmt, 'mode': mode, 'w': rgb.width, 'h': rgb.height, 'sha256': hashlib.sha256(rgb.tobytes()).hexdigest(), 'sha256Fichier': s, 'octets': os.path.getsize(p), 'progressif': bool(im.info.get('progressive') or im.info.get('progression')), 'exif': 'exif' in im.info})
sha, ill2 = X.verifier_echantillon([c['chemin'] for c in retenus], ex)      # LÈVE si l'intersection n'est pas vide
illisibles += ill2
par_format = {}
for c in retenus: par_format[c['format']] = par_format.get(c['format'], 0) + 1
json.dump({'pillow': PIL.__version__, 'exclusions': ex['comptes'], 'retiresParExclusion': retires, 'doublonsDeContenu': doublons, 'illisibles': len(illisibles), 'cartes': retenus}, open(sys.argv[1], 'w', encoding='utf8'))
print(len(retenus), 'fichiers', par_format, '| retirés par exclusion', retires, '| doublons', doublons, '| illisibles comptés', len(illisibles), '| intersection finale avec les exclusions : 0')
