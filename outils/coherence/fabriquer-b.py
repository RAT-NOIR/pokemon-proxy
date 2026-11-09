"""CHEMIN B du test de coherence : la meme photo reduite a 800 px de grand cote PAR UN OUTIL INDEPENDANT de la pre-reduction de la chaine (Pillow, pas notre decodeur ni prereduire), puis encodee en WebP avec ses pertes reelles.
  python -I fabriquer-b.py <population.json> <dossier-sortie>
Deux variantes, decidees AVANT toute mesure :
  b   : decodage Pillow (libjpeg), orientation EXIF appliquee, reduction LANCZOS (un filtre qui n'est PAS celui de la pre-reduction), WebP qualite 80 (le format des photos d'annonce mesurees ; la simulation des annonces tire le WebP entre 60 et 85) ;
  bb  : meme chose avec BILINEAR (le filtre auquel la pre-reduction de la chaine est egale au bit sur 19 cas / 21) : isole la perte d'ENCODAGE et de DECODAGE de celle du filtre.
Les dimensions sont celles de la chaine : floor((2*c*800 + g) / (2*g)). Aucun reseau, aucune ecriture hors du dossier de sortie. Ecrit b-manifeste.json { sha256 : { b, bb, W, H, sourceW, sourceH } }."""
import sys, os, json
sys.dont_write_bytecode = True
from PIL import Image, ImageOps

pop, sortie = sys.argv[1], sys.argv[2]
P = json.load(open(pop, encoding='utf8'))
liste = {}
for cle in [k for k in P if k.startswith('population')]:
    for p in P[cle]['liste']: liste[p['sha256']] = p
os.makedirs(os.path.join(sortie, 'b'), exist_ok=True); os.makedirs(os.path.join(sortie, 'bb'), exist_ok=True)
man, n = {}, 0
for sha, p in sorted(liste.items()):
    im = ImageOps.exif_transpose(Image.open(p['chemin'])).convert('RGB')
    w, h = im.size; g = max(w, h)
    if g <= 800: raise SystemExit('photo de 800 px ou moins dans la population : ' + sha)
    W, H = max(1, (2 * w * 800 + g) // (2 * g)), max(1, (2 * h * 800 + g) // (2 * g))
    sorties = {}
    for nom, filtre in (('b', Image.LANCZOS), ('bb', Image.BILINEAR)):
        f = os.path.join(sortie, nom, sha + '.webp')
        im.resize((W, H), filtre).save(f, 'WEBP', quality=80)
        sorties[nom] = f
    # bp (ajoute apres la premiere mesure, pour SEPARER la perte de decodage + filtre de celle de l'encodage WebP) : decodage Pillow + BILINEAR, PNG SANS PERTE
    f = os.path.join(sortie, 'bp', sha + '.png'); os.makedirs(os.path.dirname(f), exist_ok=True)
    im.resize((W, H), Image.BILINEAR).save(f, 'PNG'); sorties['bp'] = f
    man[sha] = {**sorties, 'W': W, 'H': H, 'sourceW': w, 'sourceH': h}
    n += 1
json.dump(man, open(os.path.join(sortie, 'b-manifeste.json'), 'w'), indent=0)
print('photos', n, 'ex', next(iter(man.values())))
