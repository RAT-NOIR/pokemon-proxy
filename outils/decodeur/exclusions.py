# Les exclusions des échantillons de preuve du décodeur, EN EMPREINTES DE CONTENU (sha256 des octets), jamais en noms de fichiers :
#   · le juge : api\juge-cinq\sha256-juge.txt (une empreinte par ligne : « <sha256>  <fichier> ») ;
#   · le banc eBay (3 000 photos) et le lot de calibration (1 500) : le champ `sha256` de chaque ligne de exclusion-ebay.json ;
#   · les visuels de catalogue qui sont la RÉPONSE de ces lignes ou des juges (clé -> p8000-quant\images\sha1(clé).webp) : l'empreinte du CONTENU du fichier.
# `charger()` LÈVE si une liste est vide ; `verifier_echantillon()` LÈVE si l'échantillon tiré en contient un, et COMPTE les fichiers illisibles au lieu de les ignorer.
import hashlib, json, os

API = r'C:\Users\Yung\rat-market-travail\api'
IMAGES = API + r'\p8000-quant\images'
JUGE = API + r'\juge-cinq\sha256-juge.txt'
GARDE = API + r'\kaggle-v2\maitre-v4\ds-code\garde-juges.json'
EBAY = API + r'\kaggle-v2\maitre-v4\ds-code\exclusion-ebay.json'


def sha256_fichier(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def nom_fichier(cle):
    return hashlib.sha1(cle.encode()).hexdigest() + '.webp'


def charger():
    """-> { 'empreintes': {sha256: origine}, 'noms': set(noms de fichiers du catalogue exclus), 'comptes': {...} }"""
    juge = {}
    for ligne in open(JUGE, encoding='utf8'):
        p = ligne.split()
        if p and len(p[0]) == 64: juge[p[0]] = 'juge'
    garde = json.load(open(GARDE, encoding='utf8'))
    ebay = json.load(open(EBAY, encoding='utf8'))
    banc = {l['sha256'] for l in ebay['banc'] if l.get('sha256')}
    calib = {l['sha256'] for l in ebay['calibration'] if l.get('sha256')}
    cles = set(garde['exclus']) | {l['cle'] for l in ebay['banc']} | {l['cle'] for l in ebay['calibration']}
    for nom, liste in (('juge', juge), ('banc eBay', banc), ('calibration', calib), ('cles exclues', cles)):
        if not liste: raise SystemExit(f'LISTE D\'EXCLUSION VIDE : {nom} — refus (une exclusion vide n\'exclut rien)')
    noms = {nom_fichier(c) for c in cles}
    empreintes = dict(juge)
    for s in banc: empreintes.setdefault(s, 'banc eBay')
    for s in calib: empreintes.setdefault(s, 'calibration')
    presents = manquants = 0
    for n in noms:
        p = os.path.join(IMAGES, n)
        if os.path.exists(p):
            empreintes.setdefault(sha256_fichier(p), 'catalogue exclu'); presents += 1
        else:
            manquants += 1
    if presents == 0: raise SystemExit('AUCUN visuel de catalogue exclu retrouvé sur le disque : le nommage sha1(cle).webp ne tient plus — refus')
    return {'empreintes': empreintes, 'noms': noms, 'comptes': {'juge': len(juge), 'banc': len(banc), 'calibration': len(calib), 'cles': len(cles), 'visuelsExclusRetrouves': presents, 'visuelsExclusAbsentsDuDisque': manquants, 'empreintesTotal': len(empreintes)}}


def verifier_echantillon(chemins, exclusions):
    """Empreinte de contenu de chaque fichier tiré ; lève si l'une est exclue ; compte (et nomme) les fichiers illisibles. -> { chemin: sha256 }, illisibles"""
    sha, illisibles = {}, []
    for p in chemins:
        try: sha[p] = sha256_fichier(p)
        except Exception as e: illisibles.append((p, str(e)[:80]))
    communs = [(p, exclusions['empreintes'][s]) for p, s in sha.items() if s in exclusions['empreintes']]
    if communs: raise SystemExit(f'INTERSECTION NON VIDE avec les exclusions ({len(communs)}) : {communs[:3]} — refus')
    return sha, illisibles

def temoin_negatif(exclusions):
    """Le contrôle doit pouvoir dire NON : un fichier dont l'empreinte est PLANTÉE dans la liste du juge doit faire lever verifier_echantillon, et un fichier propre doit passer.
    LIMITE ÉCRITE : le contrôle compare des empreintes de CONTENU ; une copie ré-encodée, redimensionnée ou recadrée d'une photo exclue a une autre empreinte et ne serait PAS vue."""
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, 'temoin.bin')
        with open(p, 'wb') as f: f.write(b'temoin negatif du controle d\'exclusion')
        s = sha256_fichier(p)
        propre = dict(exclusions); propre['empreintes'] = {k: v for k, v in exclusions['empreintes'].items() if k != s}
        verifier_echantillon([p], propre)                                    # fichier propre : ne lève pas
        plante = dict(exclusions); plante['empreintes'] = {**propre['empreintes'], s: 'juge (empreinte plantée par le témoin)'}
        try: verifier_echantillon([p], plante)
        except SystemExit: return True                                       # lève : le contrôle voit une empreinte du juge dans l'échantillon
        raise SystemExit('TÉMOIN NÉGATIF RATÉ : une empreinte du juge plantée dans l\'échantillon n\'a pas fait lever le contrôle — refus')
