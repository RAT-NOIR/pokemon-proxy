"""La tour image p8000 en ONNX, poids 8 bits (« poids8s ») : la chaine de l'extension (onnxruntime-web) et de l'etude, calculee en local par onnxruntime (processeur, 0 $).

Meme pretraitement que voisins/modele.py (G1) et que l'etude : PIL RGB -> Resize((224, 224), bicubique PIL) -> /255 -> (x - 0,5) / 0,5. Sortie : la tete 256 (« emb »), normalisee L2.
`poids.json` du dossier --poids : { "sha256": <sha256 du FICHIER onnx>, "dtype": "onnx-poids8s", "onnx": <chemin du fichier .onnx> } ; le sha256 est RECALCULE au chargement et doit etre le meme.
Meme interface que voisins.modele.Modele : empreintes(images PIL) -> (n, 256) float32.
"""
import hashlib
import json
import os

import numpy as np
from PIL import Image

TAILLE = 224


def pretraiter(im):
    im = im.resize((TAILLE, TAILLE), Image.BICUBIC)
    a = np.asarray(im, dtype=np.uint8).astype(np.float32) / 255.0
    return ((a - 0.5) / 0.5).transpose(2, 0, 1).copy()


def sha256_fichier(chemin):
    h = hashlib.sha256()
    with open(chemin, 'rb') as f:
        for bloc in iter(lambda: f.read(1 << 22), b''):
            h.update(bloc)
    return h.hexdigest()


class Modele:
    def __init__(self, dossier, fils=None):
        import onnxruntime as ort
        meta = json.load(open(os.path.join(dossier, 'poids.json'), encoding='utf8'))
        if meta.get('dtype') != 'onnx-poids8s' or not meta.get('onnx'):
            raise RuntimeError('poids.json : un modele onnx-poids8s est attendu')
        if sha256_fichier(meta['onnx']) != meta['sha256']:
            raise RuntimeError('le fichier onnx n\'a pas le sha256 de poids.json : arret')
        so = ort.SessionOptions()
        so.intra_op_num_threads = int(fils or 4)
        so.inter_op_num_threads = 1
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(meta['onnx'], so, providers=['CPUExecutionProvider'])
        self.sha256 = meta['sha256']

    def empreintes(self, images):
        x = np.stack([pretraiter(im) for im in images]).astype(np.float32)
        e = self.session.run(['emb'], {'pixel_values': x})[0].astype(np.float32)
        n = np.linalg.norm(e, axis=1, keepdims=True)
        return (e / n).astype(np.float32)
