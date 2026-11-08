"""TRANSITION : la nouvelle chaine contre la chaine servie aujourd'hui (reference ecart-safari 'ref-a' : Chrome, canvas high), sur les lignes du rejeu J.
  python -I transition.py construire <nom> <res-nom.json>        -> DD\\nav\\nav-<nom>.json (meme format que construire_nav.py de ecart-safari ; 'redressee', 'emb', 'nCartes' pris dans la sortie de la chaine)
  python -I transition.py comparer <nom> <res-nom.json> [ref=ref-a]  -> compare DD\\verdicts\\J-<nom>.json a ecart-safari\\verdicts\\J-<ref>.json
DENOMINATEURS imprimes : 862 lignes du rapport p8000-quant ; 417 ont une photo parmi les 465 du banc ; 228 ont une verite connue. Une ligne « bouge » si l'issue, le probable ou la liste de candidats differe.
Niveau : sur 3 > probable 2 > question 1 > panne/introuvable 0. Aucun seuil, aucun reglage."""
import sys, json, os
sys.dont_write_bytecode = True
import numpy as np
DD = r'C:\Users\Yung\rat-market-travail\api\detection-deterministe'
ES = r'C:\Users\Yung\rat-market-travail\api\ecart-safari'
Q = r'C:\Users\Yung\rat-market-travail\api\p8000-quant'
mode, nom, fres = sys.argv[1], sys.argv[2], sys.argv[3]
ref = sys.argv[4] if len(sys.argv) > 4 else 'ref-a'
res = json.load(open(fres, encoding='utf8'))
if mode == 'construire':
    orig = json.load(open(Q + r'\nav\nav-bancs-origine.json', encoding='utf8'))
    nav = json.loads(json.dumps(orig))
    manq = [k for k in nav['photos'] if k not in res['photos']]
    assert not manq, ('photos absentes', len(manq))
    for k, p in nav['photos'].items():
        r = res['photos'][k]; p['redressee'] = bool(r['redressee']); p['nCartes'] = r['nCartes']
        if r['redressee']: p['emb'] = r['emb']
        elif 'emb' in p and not orig['photos'][k]['redressee']: pass
    os.makedirs(DD + r'\nav', exist_ok=True)
    json.dump(nav, open(DD + r'\nav\nav-%s.json' % nom, 'w'))
    sans = [k for k, p in nav['photos'].items() if p['redressee'] and not p.get('emb')]
    print('nav ecrit', nom, 'photos', len(nav['photos']), 'redressees', sum(1 for p in nav['photos'].values() if p['redressee']), '(origine %d)' % sum(1 for p in orig['photos'].values() if p['redressee']), 'redressees sans vecteur', len(sans))
    sys.exit(0)

ex = lambda p: json.load(open(p, encoding='utf8'))
A = ex(f'{ES}\\verdicts\\J-{ref}.json'); RA = ex(f'{ES}\\res\\res-{ref}.json'); B = ex(f'{DD}\\verdicts\\J-{nom}.json')
S862 = {l['cle'] for l in ex(Q + r'\verdicts\J-origine.json')['toutes']}
a = {l['cle']: l for l in A['toutes'] if l['cle'] in S862}; b = {l['cle']: l for l in B['toutes']}
def niveau(l):
    c = l['classeOn']
    if c.startswith('s') or c == 'SÛR FAUX': return 3
    if c.startswith('probable'): return 2
    if c == 'question': return 1
    return 0
def carte(l):
    o = l['on']
    if o['issue'] == 'affirmee': return ('sur', o['id'])
    if o['issue'] == 'question': return ('probable', l['probableOn']) if l['probableOn'] is not None else ('question', tuple(o['choix']))
    return (o['issue'], None)
etat = lambda l: json.dumps([l['on'], l['probableOn']], sort_keys=True)
phot = lambda k: k.split(':')[0]
photos_banc = set(res['photos'])
avec_photo = {k for k in a if phot(k) in photos_banc}
avec_verite = {k for k in a if a[k]['verite'] is not None}
ch = [k for k in a if k not in b or etat(a[k]) != etat(b[k])]
chv = [k for k in ch if k in avec_verite]
niv = [k for k in ch if k in b and niveau(a[k]) != niveau(b[k])]
car = [k for k in ch if k in b and carte(a[k]) != carte(b[k])]
sur_moins = [k for k in ch if k in b and niveau(a[k]) == 3 and niveau(b[k]) < 3]
moins_sur = [k for k in ch if k in b and niveau(b[k]) == 3 and niveau(a[k]) < 3]
sf = [k for k, l in b.items() if k in a and l['classeOn'] == 'SÛR FAUX']
sf_av = [k for k in sf if k in avec_verite]
# photos dont la detection change
detch = []; cos = []; nvoie = {}
for k, pa in RA['photos'].items():
    pb = res['photos'].get(k)
    if pb is None: continue
    nvoie[pb.get('voie')] = nvoie.get(pb.get('voie'), 0) + 1
    if pa['redressee'] != pb['redressee']: detch.append(k); continue
    if pa['redressee']:
        d = max(np.hypot(p[0] - q[0], p[1] - q[1]) for p, q in zip(pa['quad'], pb['quad']))
        if d > 0 or pa['dim640'] != pb['dim640']: detch.append(k)
        x = np.array(pa['emb']); y = np.array(pb['emb']); cos.append(float(x @ y / np.linalg.norm(x) / np.linalg.norm(y)))
cos = np.array(cos)
lignes_voie = {}
for k in avec_photo: v = res['photos'][phot(k)].get('voie'); lignes_voie[v] = lignes_voie.get(v, 0) + 1
print(f'DENOMINATEURS : lignes {len(a)} ; avec photo du banc {len(avec_photo)} ; verite connue {len(avec_verite)} ; sûrs faux de la reference {sum(1 for l in a.values() if l["classeOn"]=="SÛR FAUX")}')
print(f'photos {len(res["photos"])} ; par voie de reduction {nvoie} ; lignes (avec photo) par voie {lignes_voie}')
print(f'photos dont le quadrilatere (a l\'octet) ou la redressee change : {len(detch)} ; cos des vecteurs min {cos.min():.10f} moy {cos.mean():.10f} sur {len(cos)} ; vecteurs strictement egaux {int((cos>=1.0).sum())}')
print(f'LIGNES QUI BOUGENT : {len(ch)} sur {len(a)} ; sur les {len(avec_verite)} a verite : {len(chv)} ; (sur les {len(avec_photo)} avec photo : {len([k for k in ch if k in avec_photo])})')
print(f'carte retenue changee {len(car)} ; niveau change {len(niv)} (sur -> moins {len(sur_moins)}, moins -> sur {len(moins_sur)}) ; SURS FAUX {len(sf)} dont sur les {len(avec_verite)} a verite {len(sf_av)}')
for k in ch[:30]: print('  ', k, 'verite', a[k]['verite'], '|', a[k]['classeOn'], '->', b[k]['classeOn'] if k in b else 'ABSENT', '| photo detection changee' if phot(k) in detch else '')
json.dump({'nom': nom, 'changees': ch, 'changeesAVerite': chv, 'detectionChangee': detch, 'sursFaux': sf}, open(f'{DD}\\transition-{nom}.json', 'w'))
