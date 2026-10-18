"""Le PRODUCTEUR de l'index : tourne a chaque republication de l'archive des visuels (je reconstruis, je mesure, puis je publie ou je bloque).

Entrees  : l'archive (.rmv, ouverte par exporter-archive.js comme l'API l'ouvre), les fichiers des visuels (<sha1(cle)>.webp dans un dossier), les poids (poids.json).
Sorties  : l'INDEX que le service charge (empreintes.npy, cles.json, index.json) et le CONTEXTE de la regle G (groupes de meme dessin, produits par visuel).

  python -I producteur.py tout        --archive A.rmv --images DIR --travail DIR --poids DIR --sortie DIR [--fils 4]
  python -I producteur.py empreintes  --entrees E.json --images DIR --cache DIR --poids DIR [--fils 4] [--paquet 512]
  python -I producteur.py groupes     --entrees E.json --images DIR --cache DIR
  python -I producteur.py assembler   --entrees E.json --cache DIR --poids DIR --sortie DIR [--ordre liste.json]
  python -I producteur.py contexte    --entrees E.json --catalogue C.json --groupes G.json --sortie CONTEXTE.json [--prix produits.json]
  python -I producteur.py importer-cache --emb DIR --images DIR --cache DIR --poids DIR     (premiere fois : reprend les empreintes deja calculees)
  python -I producteur.py manifeste   --dossier DIR      (DIR contient poids/ et index/ : ecrit manifeste.json pour le telechargeur ; rien n'est televerse)

CACHE DES EMPREINTES : une empreinte n'est reutilisee que si la cle ET le contenu (sha256 des octets du fichier) sont les memes, ET si elle vient des memes poids
(le cache porte le sha256 des poids : d'autres poids, cache refuse). Un fichier republie avec les memes pixels mais d'autres octets est RECALCULE (le §0 du rapport de parite :
0 sur 200 fichiers publies identiques en octets a ceux du cache du labo -> tout est recalcule la premiere fois).
REPRISE : les empreintes s'ecrivent par paquets (un paquet termine est un fichier complet, ecrit puis renomme), les aretes de groupes par metacarte (une ligne). Coupe puis relance :
seul ce qui manque est refait. Rien n'est ecrit hors des dossiers donnes ; aucun secret n'est lu ici (l'ouverture de l'archive est faite par Node, qui lit V2_VISUELS_HMAC).
"""
import argparse
import collections
import hashlib
import json
import os
import subprocess
import sys
import time

sys.dont_write_bytecode = True
RACINE_SERVICE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, RACINE_SERVICE)
import numpy as np
from PIL import Image

VERSION_PRODUCTEUR = 1
nom_fichier = lambda cle: hashlib.sha1(cle.encode()).hexdigest() + '.webp'


def chemin_image(images, cle):
    """Le fichier d'un visuel : d'abord le dossier de travail (images), puis les dossiers DEJA la, en lecture seule (variable VOISINS_IMAGES_DEJA, chemins separes par « ; »). Premier trouve, sinon le chemin du dossier de travail (inexistant)."""
    n = nom_fichier(cle)
    for d in [images] + [x for x in os.environ.get('VOISINS_IMAGES_DEJA', '').split(';') if x]:
        p = os.path.join(d, n)
        if os.path.exists(p):
            return p
    return os.path.join(images, n)


def ecrire_json(chemin, obj):
    tmp = chemin + '.tmp'
    json.dump(obj, open(tmp, 'w', encoding='utf8'), separators=(',', ':'))
    os.replace(tmp, chemin)


def sha256_octets_fichier(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest()


class Hachages:
    """sha256 des fichiers de visuels, memorise par (taille, date de modification) : relire 11 Go a chaque passe serait du temps perdu, mais un fichier change est TOUJOURS rehache."""

    def __init__(self, chemin):
        self.chemin = chemin
        self.d = json.load(open(chemin, encoding='utf8')) if os.path.exists(chemin) else {}
        self.modifie = False

    def de(self, fichier):
        st = os.stat(fichier)
        cle = os.path.basename(fichier)
        e = self.d.get(cle)
        if e and e[0] == st.st_size and e[1] == st.st_mtime_ns:
            return e[2]
        h = sha256_octets_fichier(fichier)
        self.d[cle] = [st.st_size, st.st_mtime_ns, h]
        self.modifie = True
        return h

    def sauver(self):
        if self.modifie:
            ecrire_json(self.chemin, self.d)
            self.modifie = False


class Cache:
    """Paquets d'empreintes : emb-<id>.npy (m, 256) float32 + emb-<id>.json [[cle, sha256], ...]. meta.json : sha256 des poids."""

    def __init__(self, dossier, poids_sha):
        self.dossier = dossier
        os.makedirs(dossier, exist_ok=True)
        fm = os.path.join(dossier, 'meta.json')
        if os.path.exists(fm):
            meta = json.load(open(fm, encoding='utf8'))
            if meta.get('poidsSha256') != poids_sha:
                raise SystemExit('le cache vient d\'AUTRES poids (sha256 different) : il ne peut pas servir. Arret (choisir un autre dossier de cache).')
        else:
            ecrire_json(fm, {'poidsSha256': poids_sha, 'dim': 256, 'producteur': VERSION_PRODUCTEUR})
        self.poids_sha = poids_sha
        self.index = {}
        self.paquets = {}
        for f in sorted(os.listdir(dossier)):
            if f.startswith('emb-') and f.endswith('.json'):
                base = f[:-5]
                if not os.path.exists(os.path.join(dossier, base + '.npy')):
                    continue
                paire = json.load(open(os.path.join(dossier, f), encoding='utf8'))
                self.paquets[base] = None
                for r, (cle, sha) in enumerate(paire):
                    self.index[(cle, sha)] = (base, r)

    def vecteur(self, cle, sha):
        base, r = self.index[(cle, sha)]
        if self.paquets[base] is None:
            self.paquets[base] = np.load(os.path.join(self.dossier, base + '.npy'))
        return self.paquets[base][r]

    def ecrire_paquet(self, paire, E):
        ident = hashlib.sha1(json.dumps(paire).encode()).hexdigest()[:12]
        base = f'emb-{int(time.time())}-{ident}'
        chemin = os.path.join(self.dossier, base)
        np.save(chemin + '.tmp.npy', E.astype(np.float32))
        os.replace(chemin + '.tmp.npy', chemin + '.npy')
        ecrire_json(chemin + '.json', paire)             # le .json arrive EN DERNIER : un paquet sans .json est ignore (coupure au milieu)
        for r, (cle, sha) in enumerate(paire):
            self.index[(cle, sha)] = (base, r)
        self.paquets[base] = E.astype(np.float32)


def lire_entrees(chemin):
    return json.load(open(chemin, encoding='utf8'))['entrees']


def cles_distinctes(entrees):
    return sorted({e['g'] for e in entrees})


def poids_sha(dossier):
    return json.load(open(os.path.join(dossier, 'poids.json'), encoding='utf8'))['sha256']


# ───────────────────────── empreintes ─────────────────────────
def charger_modele(poids, fils):
    """poids.json porte onnx : le modele ONNX poids8s (modele_onnx.py, ce dossier) ; sinon la tour torch fp32 de G1 (voisins.modele)."""
    meta = json.load(open(os.path.join(poids, 'poids.json'), encoding='utf8'))
    if meta.get('onnx'):
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from modele_onnx import Modele
    else:
        from voisins.modele import Modele
    return Modele(poids, fils=fils)


def cmd_empreintes(a):
    entrees = lire_entrees(a.entrees)
    cles = cles_distinctes(entrees)
    cache = Cache(a.cache, poids_sha(a.poids))
    hach = Hachages(os.path.join(a.cache, 'hachages.json'))
    manquants = [c for c in cles if not os.path.exists(chemin_image(a.images, c))]
    if manquants:
        raise SystemExit(f'{len(manquants)} visuels pas telecharges (ex. {manquants[0]}) : telecharger-visuels.js d\'abord. Arret.')
    paires = [(c, hach.de(chemin_image(a.images, c))) for c in cles]
    hach.sauver()
    a_faire = [p for p in paires if p not in cache.index]
    print(f'visuels {len(cles)} · empreintes deja au cache (cle ET contenu identiques) {len(cles) - len(a_faire)} · a calculer {len(a_faire)}', flush=True)
    if not a_faire:
        return
    m = charger_modele(a.poids, a.fils)
    t0 = time.perf_counter()
    faits = 0
    for p in range(0, len(a_faire), a.paquet):
        lot = a_faire[p:p + a.paquet]
        E = []
        for k in range(0, len(lot), 8):          # lots de 8 comme embedder-archive.py
            ims = [Image.open(chemin_image(a.images, c)).convert('RGB') for c, _ in lot[k:k + 8]]
            E.append(m.empreintes(ims))
        cache.ecrire_paquet([[c, s] for c, s in lot], np.concatenate(E))
        faits += len(lot)
        print(f'{faits}/{len(a_faire)} empreintes · {(time.perf_counter() - t0) / faits * 1000:.0f} ms par image', flush=True)
    print('fini')


def cmd_importer_cache(a):
    """Premiere fois : reprend les empreintes deja calculees (liste-tous-*.npy + .json) en les associant au sha256 du fichier PUBLIE qui les a produites."""
    import glob
    cache = Cache(a.cache, poids_sha(a.poids))
    hach = Hachages(os.path.join(a.cache, 'hachages.json'))
    n = 0
    for f in sorted(glob.glob(os.path.join(a.emb, '*.npy'))):
        cles = json.load(open(f[:-4] + '.json', encoding='utf8'))
        E = np.load(f)
        assert E.shape[0] == len(cles), 'paquet incoherent'
        paire = []
        garder = []
        for r, c in enumerate(cles):
            fic = chemin_image(a.images, c)
            if not os.path.exists(fic):
                continue
            sha = hach.de(fic)
            if (c, sha) in cache.index:
                continue
            paire.append([c, sha]); garder.append(r)
        if paire:
            cache.ecrire_paquet(paire, E[garder])
            n += len(paire)
        hach.sauver()
    print(f'importees {n} empreintes (cache : {len(cache.index)})')


# ───────────────────────── groupes de meme dessin ─────────────────────────
# Fonctions copiees de pokemon-proxy-labo/rm/jumeaux.py (descr, verifier, gris) : MEME construction que le labo (SIFT sur la fenetre d'illustration a 300x419,
# similitude RANSAC, >= 25 inliers, fermeture transitive). Deux ecarts, ecrits (ceux de groupes-archive.py) : cle de regroupement = idMetacard ; pas de pre-filtre cosinus.
L, H = 300, 419
ART = (0.08, 0.92, 0.10, 0.54)
INLIERS = 25


def _outils_cv():
    import cv2
    return cv2, cv2.SIFT_create(nfeatures=500), cv2.BFMatcher(cv2.NORM_L2)


def gris(chemin):
    return np.array(Image.open(chemin).convert('L').resize((L, H), Image.BILINEAR))


def descr(g, cv, sift):
    x0, x1, y0, y1 = ART
    art = g[int(y0 * H):int(y1 * H), int(x0 * L):int(x1 * L)]
    a_ = cv.resize(art, None, fx=1.6, fy=1.6, interpolation=cv.INTER_CUBIC)
    k, d = sift.detectAndCompute(a_, None)
    return (np.float32([p.pt for p in k]) / 1.6 if k else np.zeros((0, 2), np.float32)), d


def verifier(da, db, cv, flann):
    (pa, a), (pb, b) = da, db
    if a is None or b is None or len(a) < 8 or len(b) < 8:
        return 0, None
    m = [x[0] for x in flann.knnMatch(a, b, k=2) if len(x) == 2 and x[0].distance < 0.8 * x[1].distance]
    if len(m) < 6:
        return 0, None
    p1 = pa[[x.queryIdx for x in m]]
    p2 = pb[[x.trainIdx for x in m]]
    A, mk = cv.estimateAffinePartial2D(p1, p2, method=cv.RANSAC, ransacReprojThreshold=4.0)
    if A is None:
        return 0, None
    k = mk.ravel().astype(bool)
    if k.sum() < 6:
        return 0, None
    echelle = float(np.sqrt(abs(np.linalg.det(A[:, :2]))))
    aire_art = (ART[1] - ART[0]) * L * (ART[3] - ART[2]) * H
    couv = min(cv.contourArea(cv.convexHull(p1[k])), cv.contourArea(cv.convexHull(p2[k]))) / aire_art
    if not (0.6 <= echelle <= 1.7) or couv < 0.15:
        return 0, None
    return int(k.sum()), None


def cmd_groupes(a):
    cv, sift, flann = _outils_cv()
    entrees = lire_entrees(a.entrees)
    hach = Hachages(os.path.join(a.cache, 'hachages.json'))
    par_meta = collections.defaultdict(set)
    for e in entrees:
        par_meta[e['meta']].add(e['g'])
    cibles = {m: sorted(s) for m, s in par_meta.items() if len(s) >= 2}
    chemin_aretes = os.path.join(a.cache, 'aretes.jsonl')
    faits = {}
    if os.path.exists(chemin_aretes):
        for l in open(chemin_aretes, encoding='utf8'):
            if l.strip():
                r = json.loads(l)
                faits[(r['meta'], r['sig'])] = r['aretes']
    print(f'metacartes a >= 2 visuels {len(cibles)} · deja faites (memes cles ET memes contenus) a verifier ci-dessous', flush=True)
    sortie = open(chemin_aretes, 'a', encoding='utf8')
    toutes = []
    t0 = time.time(); nouvelles = 0; paires = 0
    for k, (m, cles) in enumerate(sorted(cibles.items(), key=lambda x: len(x[1]))):
        manque = [c for c in cles if not os.path.exists(chemin_image(a.images, c))]
        if manque:
            raise SystemExit(f'visuel non telecharge : {manque[0]} : arret')
        sig = hashlib.sha1(json.dumps([[c, hach.de(chemin_image(a.images, c))] for c in cles]).encode()).hexdigest()
        if (m, sig) in faits:
            toutes += faits[(m, sig)]
            continue
        dd = {c: descr(gris(chemin_image(a.images, c)), cv, sift) for c in cles}
        aretes = []
        for i in range(len(cles)):
            for j in range(i + 1, len(cles)):
                paires += 1
                inl, _ = verifier(dd[cles[i]], dd[cles[j]], cv, flann)
                if inl >= INLIERS:
                    aretes.append([cles[i], cles[j]])
        sortie.write(json.dumps({'meta': m, 'sig': sig, 'aretes': aretes}) + '\n'); sortie.flush()
        toutes += aretes; nouvelles += 1
        if (k + 1) % 500 == 0:
            print(f'   {k + 1}/{len(cibles)} metacartes · {paires} paires · {time.time() - t0:.0f} s', flush=True)
    sortie.close(); hach.sauver()
    tous = sorted({c for l in cibles.values() for c in l})
    pere = {c: c for c in tous}

    def tr(x):
        while pere[x] != x:
            pere[x] = pere[pere[x]]; x = pere[x]
        return x
    for ci, cj in toutes:
        ri, rj = tr(ci), tr(cj)
        if ri != rj:
            pere[ri] = rj
    gr = collections.defaultdict(list)
    for c in tous:
        gr[tr(c)].append(c)
    gr = [sorted(g) for g in gr.values() if len(g) > 1]
    groupe = {c: i for i, g in enumerate(gr) for c in g}
    comptes = {'metacartes': len(cibles), 'metacartesCalculees': nouvelles, 'paires': paires, 'aretes': len(toutes), 'groupes': len(gr), 'visuelsGroupes': len(groupe), 'plusGrand': max((len(g) for g in gr), default=0)}
    ecrire_json(os.path.join(a.cache, 'groupes.json'), {'groupe': groupe, 'comptes': comptes})
    print('GROUPES', json.dumps(comptes))


# ───────────────────────── contexte G ─────────────────────────
def construire_contexte(entrees, catalogue, groupes, prix_par_visuel=None):
    """Port de contexte-archive.js : { groupe, carte, invisibles, produits }.
    groupe : visuel -> id de groupe ; carte : visuel -> [idMetacard] ; invisibles : idMetacard -> [idProduct SANS visuel] ; produits : visuel -> [[idProduct, prix|null]]."""
    prix = {}
    for lst in (prix_par_visuel or {}).values():
        for i, p in lst:
            if p is not None and int(i) not in prix:
                prix[int(i)] = p
    produits = {}
    carte = {}
    for e in entrees:
        produits.setdefault(e['g'], []).append([e['id'], prix.get(e['id'])])
        carte.setdefault(e['g'], set()).add(e['meta'])
    carte = {k: sorted(v) for k, v in carte.items()}
    for k in produits:
        produits[k].sort(key=lambda x: x[0])
    dans = {e['id'] for e in entrees}
    invisibles = {}
    for c in catalogue:
        if c['id'] not in dans and c['meta'] >= 0:
            invisibles.setdefault(str(c['meta']), []).append(c['id'])
    for k in invisibles:
        invisibles[k].sort()
    return {'groupe': dict(groupes), 'carte': carte, 'invisibles': invisibles, 'produits': produits}


def cmd_contexte(a):
    entrees = lire_entrees(a.entrees)
    cat = json.load(open(a.catalogue, encoding='utf8'))['cat']
    g = json.load(open(a.groupes, encoding='utf8'))['groupe']
    prix = json.load(open(a.prix, encoding='utf8'))['parVisuel'] if a.prix else None
    ctx = construire_contexte(entrees, cat, g, prix)
    ecrire_json(a.sortie, ctx)
    sans = sum(1 for l in ctx['produits'].values() for x in l if x[1] is None)
    print(f"visuels {len(ctx['produits'])} · en groupe {len(ctx['groupe'])} · metacartes avec restes {len(ctx['invisibles'])} ({sum(len(v) for v in ctx['invisibles'].values())} produits sans visuel) · produits sans prix {sans}/{len(entrees)}")


# ───────────────────────── assemblage de l'index ─────────────────────────
def cmd_assembler(a, entrees_meta=None):
    entrees_doc = json.load(open(a.entrees, encoding='utf8'))
    entrees = entrees_doc['entrees']
    cles = json.load(open(a.ordre, encoding='utf8')) if a.ordre else cles_distinctes(entrees)
    if sorted(cles) != cles_distinctes(entrees):
        raise SystemExit('l\'ordre donne ne contient pas exactement les visuels de l\'archive : arret')
    cache = Cache(a.cache, poids_sha(a.poids))
    hach = Hachages(os.path.join(a.cache, 'hachages.json'))
    if a.images:                                       # le contenu ACTUEL des fichiers designe l'empreinte a prendre
        lignes = [(c, hach.de(chemin_image(a.images, c))) for c in cles]
        hach.sauver()
    else:                                              # sans les fichiers : seulement si le cache ne porte qu'UNE empreinte par cle
        par_cle = collections.defaultdict(list)
        for (c, s) in cache.index:
            par_cle[c].append(s)
        for c in cles:
            if len(par_cle[c]) != 1:
                raise SystemExit(f'--images est requis (la cle {c} a {len(par_cle[c])} empreintes au cache)')
        lignes = [(c, par_cle[c][0]) for c in cles]
    manque = [c for c, s in lignes if (c, s) not in cache.index]
    if manque:
        raise SystemExit(f'{len(manque)} empreintes manquantes au cache (ex. {manque[0]}) : lancer « empreintes » d\'abord. Arret.')
    mat = np.stack([cache.vecteur(c, s) for c, s in lignes]).astype(np.float32)
    os.makedirs(a.sortie, exist_ok=True)
    np.save(os.path.join(a.sortie, 'empreintes.npy'), mat)
    ecrire_json(os.path.join(a.sortie, 'cles.json'), cles)
    meta = {'version': entrees_doc.get('chargeLe'), 'chargeLe': entrees_doc.get('chargeLe'), 'n': len(cles), 'dim': int(mat.shape[1]), 'produits': len(entrees),
            'sha256Empreintes': sha256_octets_fichier(os.path.join(a.sortie, 'empreintes.npy')), 'sha256Cles': sha256_octets_fichier(os.path.join(a.sortie, 'cles.json')),
            'poidsSha256': poids_sha(a.poids), 'producteur': VERSION_PRODUCTEUR}
    ecrire_json(os.path.join(a.sortie, 'index.json'), meta)
    print(f"index ecrit : {a.sortie} · {meta['n']} visuels · {mat.nbytes / 2**20:.0f} Mo · archive {meta['version']}")


def cmd_manifeste(a):
    """Ecrit <dossier>/manifeste.json (noms, taille, sha256) pour le telechargeur du service. Rien n'est televerse : le depot dans le bucket est un geste a part, fait par la personne."""
    fichiers = []
    for nom in ('poids/poids.safetensors', 'poids/poids.json', 'index/empreintes.npy', 'index/cles.json', 'index/index.json'):
        chemin = os.path.join(a.dossier, *nom.split('/'))
        fichiers.append({'nom': nom, 'taille': os.path.getsize(chemin), 'sha256': sha256_octets_fichier(chemin)})
    idx = json.load(open(os.path.join(a.dossier, 'index', 'index.json'), encoding='utf8'))
    ecrire_json(os.path.join(a.dossier, 'manifeste.json'), {'version': idx.get('version'), 'fichiers': fichiers})
    print('manifeste ecrit :', ', '.join(f"{f['nom']} ({f['taille'] / 2**20:.1f} Mo)" for f in fichiers))


def cmd_tout(a):
    os.makedirs(a.travail, exist_ok=True)
    node = os.environ.get('VOISINS_NODE', 'node')
    exp = os.path.join(RACINE_SERVICE, 'producteur', 'exporter-archive.js')
    r = subprocess.run([node, exp, a.archive, a.travail])
    if r.returncode != 0:
        raise SystemExit('l\'export de l\'archive a echoue : arret')
    entrees = os.path.join(a.travail, 'entrees.json')
    cache = os.path.join(a.travail, 'cache')
    base = dict(entrees=entrees, images=a.images, cache=cache, poids=a.poids, fils=a.fils, paquet=512)
    cmd_empreintes(argparse.Namespace(**base))
    cmd_groupes(argparse.Namespace(**base))
    cmd_assembler(argparse.Namespace(entrees=entrees, cache=cache, poids=a.poids, sortie=a.sortie, ordre=None, images=a.images))
    cmd_contexte(argparse.Namespace(entrees=entrees, catalogue=os.path.join(a.travail, 'catalogue.json'), groupes=os.path.join(cache, 'groupes.json'), sortie=os.path.join(a.sortie, 'contexte.json'), prix=a.prix))


def main(argv=None):
    ap = argparse.ArgumentParser()
    sp = ap.add_subparsers(dest='cmd', required=True)
    for nom in ('tout', 'empreintes', 'groupes', 'assembler', 'contexte', 'importer-cache', 'manifeste'):
        p = sp.add_parser(nom)
        if nom == 'manifeste':
            p.add_argument('--dossier', required=True)
        if nom == 'tout':
            p.add_argument('--archive', required=True); p.add_argument('--travail', required=True); p.add_argument('--prix')
        if nom in ('tout', 'empreintes', 'groupes', 'importer-cache'):
            p.add_argument('--images', required=(nom != 'assembler'))
        if nom == 'assembler':
            p.add_argument('--images')
        if nom in ('empreintes', 'groupes', 'assembler', 'importer-cache'):
            p.add_argument('--cache', required=True)
        if nom in ('empreintes', 'groupes', 'assembler', 'contexte'):
            p.add_argument('--entrees', required=True)
        if nom in ('tout', 'empreintes', 'assembler', 'importer-cache'):
            p.add_argument('--poids', required=True)
        if nom in ('tout', 'empreintes'):
            p.add_argument('--fils', type=int, default=4)
        if nom == 'empreintes':
            p.add_argument('--paquet', type=int, default=512)
        if nom in ('tout', 'assembler'):
            p.add_argument('--sortie', required=True)
        if nom == 'assembler':
            p.add_argument('--ordre')
        if nom == 'contexte':
            p.add_argument('--catalogue', required=True); p.add_argument('--groupes', required=True); p.add_argument('--sortie', required=True); p.add_argument('--prix')
        if nom == 'importer-cache':
            p.add_argument('--emb', required=True)
    a = ap.parse_args(argv)
    {'tout': cmd_tout, 'empreintes': cmd_empreintes, 'groupes': cmd_groupes, 'assembler': cmd_assembler, 'contexte': cmd_contexte, 'importer-cache': cmd_importer_cache, 'manifeste': cmd_manifeste}[a.cmd](a)


if __name__ == '__main__':
    main()
