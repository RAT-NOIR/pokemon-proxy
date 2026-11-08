# Jeux de preuve du tour de correction T1 : cas que Pillow ne sait pas ÉCRIRE mais sait LIRE (PNG entrelacé Adam7, PNG palette 1/2/4 bits écrit à la main, tRNS), JPEG progressif dont la table de
# quantification est redéfinie entre deux balayages (libjpeg verrouille la table au premier balayage), et fichiers fautifs qui doivent être refusés (progressif incomplet, adler32 faux).
# La vérité est toujours Pillow qui LIT le fichier : Image.open(...).convert('RGB').tobytes() -> sha256. Aucun téléchargement, aucun fichier du testeur.
# Usage : python -I fabriquer-fixtures-t1.py <sortie.json>
import base64, hashlib, io, json, struct, sys, zlib
import numpy as np
import PIL
from PIL import Image

rng = np.random.default_rng(20261109)
cas = []


def sha(b):
    return hashlib.sha256(b).hexdigest()


def ref(octets):
    im = Image.open(io.BytesIO(octets)); im.load(); rgb = im.convert('RGB')
    return {'w': rgb.width, 'h': rgb.height, 'sha256': sha(rgb.tobytes())}


def ajouter(nom, octets, refuse=None, **extra):
    c = {'nom': nom, 'b64': base64.b64encode(octets).decode('ascii')}
    c.update(extra)
    if refuse: c['refuse'] = refuse
    else: c['pil'] = ref(octets)
    cas.append(c)


def chunk(t, d):
    return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)


def filtrer(brut, prec, bpp, f):
    """Applique le filtre PNG f à la ligne `brut` (bytes) ; prec : ligne précédente (bytes de même longueur)."""
    out = bytearray(len(brut))
    for i in range(len(brut)):
        a = brut[i - bpp] if i >= bpp else 0; b = prec[i]; c = prec[i - bpp] if i >= bpp else 0
        if f == 0: p = 0
        elif f == 1: p = a
        elif f == 2: p = b
        elif f == 3: p = (a + b) >> 1
        else:
            pp = a + b - c; pa, pb, pc = abs(pp - a), abs(pp - b), abs(pp - c)
            p = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
        out[i] = (brut[i] - p) & 255
    return bytes(out)


def empaqueter(ligne, prof):
    """ligne : liste d'entiers de `prof` bits -> octets, bit de poids fort d'abord."""
    if prof == 8: return bytes(ligne)
    bits = ''.join(format(v, '0%db' % prof) for v in ligne)
    bits += '0' * (-len(bits) % 8)
    return bytes(int(bits[i:i + 8], 2) for i in range(0, len(bits), 8))


PASSES = [(0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)]


def png(pix, ct, prof, entrelace, palette=None, trns=None, adler_faux=False, filtre=None):
    """pix : tableau (h, w, canaux) d'entiers ; ct : type de couleur PNG ; renvoie les octets du fichier."""
    h, w, canaux = pix.shape
    bpp = max(1, (canaux * prof) >> 3)
    passes = PASSES if entrelace else [(0, 0, 1, 1)]
    brut = bytearray()
    for (x0, y0, dx, dy) in passes:
        sous = pix[y0::dy, x0::dx]
        if sous.shape[0] == 0 or sous.shape[1] == 0: continue
        prec = None
        for y in range(sous.shape[0]):
            ligne = empaqueter([int(v) for v in sous[y].reshape(-1)], prof)
            if prec is None: prec = bytes(len(ligne))
            f = filtre if filtre is not None else int(rng.integers(0, 5))
            brut += bytes([f]) + filtrer(ligne, prec, bpp, f)
            prec = ligne
    z = zlib.compress(bytes(brut), 9)
    if adler_faux: z = z[:-1] + bytes([z[-1] ^ 1])
    ihdr = struct.pack('>IIBBBBB', w, h, prof, ct, 0, 0, 1 if entrelace else 0)
    out = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
    if palette is not None: out += chunk(b'PLTE', bytes(palette))
    if trns is not None: out += chunk(b'tRNS', bytes(trns))
    return out + chunk(b'IDAT', z) + chunk(b'IEND', b'')


tailles = [(1, 1), (2, 2), (3, 5), (5, 3), (7, 9), (8, 8), (9, 17), (13, 6), (37, 29)]
for (w, h) in tailles:
    rgb = rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8)
    for entrelace in (0, 1):
        e = 'adam7' if entrelace else 'plein'
        ajouter(f'png-{e}-rgb-{w}x{h}', png(rgb, 2, 8, entrelace))
        ajouter(f'png-{e}-gris-{w}x{h}', png(rgb[:, :, :1], 0, 8, entrelace))
        ajouter(f'png-{e}-rgba-{w}x{h}', png(np.concatenate([rgb, rng.integers(0, 256, size=(h, w, 1), dtype=np.uint8)], axis=2), 6, 8, entrelace))
        ajouter(f'png-{e}-grisalpha-{w}x{h}', png(np.concatenate([rgb[:, :, :1], rgb[:, :, 1:2]], axis=2), 4, 8, entrelace))
        for prof in (1, 2, 4, 8):
            n = 1 << prof
            pal = rng.integers(0, 256, size=(n, 3), dtype=np.uint8).reshape(-1)
            idx = rng.integers(0, n, size=(h, w, 1), dtype=np.uint8)
            ajouter(f'png-{e}-palette{prof}-{w}x{h}', png(idx, 3, prof, entrelace, palette=pal))
            if prof == 4 and w >= 9:
                ajouter(f'png-{e}-palette{prof}-trns-{w}x{h}', png(idx, 3, prof, entrelace, palette=pal, trns=rng.integers(0, 256, size=(min(n, 5),), dtype=np.uint8)))
                ajouter(f'png-{e}-palette{prof}-courte-{w}x{h}', png(np.minimum(idx, 6), 3, prof, entrelace, palette=pal[:7 * 3]))
# dégradés lisses : les égalités du filtre Paeth (|p-a| == |p-b|) y sont fréquentes, pas dans le bruit ; chaque filtre forcé sur toutes les lignes
for (w, h) in ((64, 48), (37, 29)):
    x, y = np.meshgrid(np.arange(w), np.arange(h))
    deg = np.stack([(x * 255 // max(1, w - 1)), (y * 255 // max(1, h - 1)), ((x + y) * 255 // max(1, w + h - 2))], axis=-1).astype(np.uint8)
    for f in range(5):
        for entrelace in (0, 1):
            ajouter(f'png-degrade-filtre{f}-{'adam7' if entrelace else 'plein'}-{w}x{h}', png(deg, 2, 8, entrelace, filtre=f))
# palette écrite par Pillow lui-même (bits=)
for (w, h) in ((13, 6), (37, 29)):
    base = Image.fromarray(rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8), 'RGB')
    for bits in (1, 2, 4, 8):
        im = base.quantize(1 << bits)
        b = io.BytesIO(); im.save(b, 'PNG', bits=bits); ajouter(f'png-pillow-palette-bits{bits}-{w}x{h}', b.getvalue())
# flux zlib à somme adler32 fausse : zlib (donc Pillow) le refuse
ajouter('png-adler-faux-9x17', png(rng.integers(0, 256, size=(17, 9, 3), dtype=np.uint8), 2, 8, 0, adler_faux=True), refuse='DECODAGE')

# ── JPEG : table de quantification redéfinie ENTRE deux balayages (libjpeg verrouille la table de chaque composante à son premier balayage)
def segments_jpeg(o):
    i = 2; segs = []
    while i < len(o):
        assert o[i] == 0xff
        m = o[i + 1]
        if m in (0xd9,): segs.append((m, i, i + 2)); break
        n = (o[i + 2] << 8) | o[i + 3]
        fin = i + 2 + n
        if m == 0xda:                      # données entropiques jusqu'au prochain marqueur non RST
            j = fin
            while True:
                k = o.index(b'\xff', j)
                if o[k + 1] == 0 or 0xd0 <= o[k + 1] <= 0xd7: j = k + 2; continue
                fin = k; break
        segs.append((m, i, fin)); i = fin
    return segs


def jpeg_progressif(w, h, **kw):
    pix = rng.integers(0, 256, size=(h, w, 3), dtype=np.uint8)
    pix = (pix // 2 + 64).astype(np.uint8)
    im = Image.fromarray(pix, 'RGB'); b = io.BytesIO(); im.save(b, 'JPEG', quality=85, progressive=True, **kw)
    return b.getvalue()


for (w, h) in ((64, 48), (37, 29)):
    o = jpeg_progressif(w, h, subsampling=2)
    segs = segments_jpeg(o)
    sos = [s for s in segs if s[0] == 0xda]
    assert len(sos) >= 4, len(sos)
    # 1. table 0 (luminance) redéfinie avant le DEUXIÈME balayage : sans effet avec libjpeg (latch)
    dqt = b'\xff\xdb' + struct.pack('>H', 67) + bytes([0]) + bytes([1 + (k % 7) for k in range(64)])
    modif = o[:sos[1][1]] + dqt + o[sos[1][1]:]
    ajouter(f'jpeg-progressif-dqt-redefinie-{w}x{h}', modif)
    # 2. progressif INCOMPLET : on coupe avant le dernier balayage et on ferme (libjpeg lisse les blocs : on refuse)
    tronque = o[:sos[-1][1]] + b'\xff\xd9'
    ajouter(f'jpeg-progressif-incomplet-sans-dernier-{w}x{h}', tronque, refuse='NON_SUPPORTE')
    tronque2 = o[:sos[len(sos) // 2][1]] + b'\xff\xd9'
    ajouter(f'jpeg-progressif-incomplet-moitie-{w}x{h}', tronque2, refuse='NON_SUPPORTE')
    # le nombre de balayages d'un progressif de Pillow (pour le plafond)
    cas.append({'nom': f'jpeg-progressif-balayages-{w}x{h}', 'balayages': len(sos), 'b64': base64.b64encode(o).decode('ascii'), 'pil': ref(o)})

json.dump({'pillow': PIL.__version__, 'cas': cas}, open(sys.argv[1], 'w', encoding='utf-8'))
print(len(cas), 'cas')
