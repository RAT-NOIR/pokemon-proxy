"""Liste les visuels de l'archive a (re)telecharger : ceux dont le fichier manque, ET ceux dont le fichier deja la n'a pas la taille (largeur x hauteur) que l'archive declare (un visuel remplace depuis).
  python -I liste-a-telecharger.py --entrees entrees.json --images DIR --sortie liste.json      (les dossiers DEJA la : variable VOISINS_IMAGES_DEJA, lecture seule)
Une taille ne prouve pas l'identite des octets : elle attrape le remplacement d'un visuel par un autre de definition differente, pas une recompression. Le cache des empreintes, lui, est cle par le sha256 du fichier.
"""
import argparse
import json
import os
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image
from producteur import chemin_image

ap = argparse.ArgumentParser()
ap.add_argument('--entrees', required=True)
ap.add_argument('--images', required=True)
ap.add_argument('--sortie', required=True)
a = ap.parse_args()
entrees = json.load(open(a.entrees, encoding='utf8'))['entrees']
dims = {}
for e in entrees:
    dims.setdefault(e['g'], set()).add((e['gw'], e['gh']))
manque, taille, ok, illisible = [], [], 0, []
for c in sorted(dims):
    p = chemin_image(a.images, c)
    if not os.path.exists(p):
        manque.append(c); continue
    try:
        with Image.open(p) as im:
            wh = im.size
    except Exception:
        illisible.append(c); continue
    if wh in dims[c] or any(w is None or h is None for w, h in dims[c]):
        ok += 1
    else:
        taille.append(c)
liste = sorted(set(manque) | set(taille) | set(illisible))
json.dump(liste, open(a.sortie, 'w', encoding='utf8'))
print(f'visuels {len(dims)} · bons {ok} · manquants {len(manque)} · taille differente de l\'archive {len(taille)} · illisibles {len(illisible)} · a telecharger {len(liste)}')
