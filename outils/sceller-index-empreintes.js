'use strict';
// MODELE-VISUEL-API — le PRODUCTEUR du conteneur scellé de l'index des empreintes (hors API, à la main). Il ne publie RIEN : il lit le dossier de sortie du producteur d'index (v2-service-voisins :
// producteur/producteur.py « tout » ou « assembler » + « contexte » → empreintes.npy float32 (n, 256), cles.json, index.json, contexte.json), vérifie les hachages que ce producteur a écrits, et écrit UN fichier scellé
// (v2/identifier/index-empreintes.js, magie RMEI, HMAC-SHA256) dans le chemin donné. Le dépôt de ce fichier sur R2 est un geste a part, fait par la personne (accord du testeur requis) : ce script n'ouvre aucun réseau.
//   node outils/sceller-index-empreintes.js --index <dossier> --contexte <contexte.json> --modele-id <id> --poids-sha256 <64 hex> --sortie <fichier>      (le secret : la variable V2_VISUELS_HMAC, jamais un argument, jamais imprimée)
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const X = require('../v2/identifier/index-empreintes');

const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

/** Lit un .npy float32 C-contigu à deux dimensions. @returns {{n:number, d:number, donnees: Float32Array}} — lève une Error nommée sinon. */
function lireNpy(tampon) {
    if (!Buffer.isBuffer(tampon) || tampon.length < 10 || tampon.subarray(0, 6).toString('latin1') !== '\x93NUMPY') throw new Error('npy : magie fausse');
    const major = tampon[6];
    const lenEntete = major === 1 ? tampon.readUInt16LE(8) : tampon.readUInt32LE(8);
    const debut = (major === 1 ? 10 : 12);
    const entete = tampon.subarray(debut, debut + lenEntete).toString('latin1');
    if (!/'descr':\s*'<f4'/.test(entete)) throw new Error('npy : float32 petit-boutiste attendu');
    if (!/'fortran_order':\s*False/.test(entete)) throw new Error('npy : ordre C attendu');
    const m = /'shape':\s*\((\d+),\s*(\d+)\)/.exec(entete);
    if (!m) throw new Error('npy : forme (n, d) attendue');
    const n = Number(m[1]), d = Number(m[2]), corps = tampon.subarray(debut + lenEntete);
    if (corps.length !== n * d * 4) throw new Error('npy : taille du corps différente de n × d × 4');
    const donnees = new Float32Array(n * d);
    Buffer.from(donnees.buffer).set(corps);
    return { n, d, donnees };
}

/** Construit le conteneur scellé. @returns {{scelle: Buffer, n: number, octetsMatrice: number}} */
function construire({ dossierIndex, fichierContexte, modele, secret }) {
    const meta = JSON.parse(fs.readFileSync(path.join(dossierIndex, 'index.json'), 'utf8'));
    const f = n => path.join(dossierIndex, n);
    if (sha256(f('empreintes.npy')) !== meta.sha256Empreintes) throw new Error('hachage des empreintes faux (index.json)');
    if (sha256(f('cles.json')) !== meta.sha256Cles) throw new Error('hachage des clés faux (index.json)');
    const { n, d, donnees } = lireNpy(fs.readFileSync(f('empreintes.npy')));
    if (d !== 256 || n !== meta.n) throw new Error('npy : forme différente de index.json');
    const cles = JSON.parse(fs.readFileSync(f('cles.json'), 'utf8'));
    const contexte = JSON.parse(fs.readFileSync(fichierContexte, 'utf8'));
    const scelle = X.sceller({ cles, matrice: donnees, contexte, modele, chargeLe: meta.chargeLe || meta.version }, secret);
    return { scelle, n, octetsMatrice: n * 256 * 2 };
}

function arguments_(argv) {
    const o = {};
    for (let i = 0; i < argv.length; i += 2) { const k = argv[i]; if (!/^--(index|contexte|modele-id|poids-sha256|sortie)$/.test(k) || argv[i + 1] === undefined) throw new Error(`argument inconnu ou sans valeur : ${k}`); o[k.slice(2)] = argv[i + 1]; }
    for (const k of ['index', 'contexte', 'modele-id', 'poids-sha256', 'sortie']) if (!o[k]) throw new Error(`argument manquant : --${k}`);
    return o;
}

if (require.main === module) {
    try {
        const a = arguments_(process.argv.slice(2));
        const secret = process.env.V2_VISUELS_HMAC;
        const r = construire({ dossierIndex: a.index, fichierContexte: a.contexte, modele: { id: a['modele-id'], sha256: a['poids-sha256'] }, secret });
        if (fs.existsSync(a.sortie)) throw new Error('la sortie existe déjà : ce script n\'écrase jamais');
        fs.writeFileSync(a.sortie, r.scelle, { flag: 'wx' });
        console.log(`écrit ${a.sortie} : ${r.n} visuels · ${(r.scelle.length / 1048576).toFixed(1)} Mo · matrice fp16 ${(r.octetsMatrice / 1048576).toFixed(1)} Mo · sha256 du fichier ${crypto.createHash('sha256').update(r.scelle).digest('hex')} · RIEN n'est publié`);
    } catch (e) { console.error(`❌ ${e && e.motif ? e.motif : e && e.message ? e.message : 'erreur'}`); process.exit(1); }
}
module.exports = { construire, lireNpy, arguments_ };
