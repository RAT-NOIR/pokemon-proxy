'use strict';
// MODELE-VISUEL-API — l'INDEX des empreintes de l'archive des visuels (≈ 57 884 × 256), tenu en MÉMOIRE EN fp16 (2 octets par composante, ≈ 29,6 Mo) ; recherche des 10 voisins par cosinus.
// Le conteneur est un objet scellé, comme l'archive des visuels (chargeur/scellement.js) mais avec SA magie (RMEI) : un fichier ne passe jamais pour l'autre. Il porte AVEC la matrice :
//   · les clés des visuels, dans l'ordre des lignes ; · le CONTEXTE de la règle G (groupes de même dessin, cartes, restes sans visuel, produits par visuel), qui doit venir de la MÊME archive que la matrice ;
//   · l'identité du MODÈLE qui a produit les empreintes (identifiant + sha256 des poids). Une matrice vit dans l'espace d'UN modèle : ouverte pour un autre, elle donnerait de faux voisins sans un mot.
//   RMEI | u32 longueurEntête | entête JSON | matrice fp16 (n × 256, petit-boutiste) | u32 | clés JSON | u32 | contexte JSON gzip | HMAC-SHA256(secret, tout ce qui précède) (32 octets)
// Écrit par ce qu'il AUTORISE : taille, magie, longueur du secret et HMAC AVANT toute lecture du contenu ; puis chaque longueur annoncée est recomptée ; puis la forme (clés distinctes, lignes finies et
// unitaires, contexte lisible) ; puis le modèle attendu. Un refus est un FormatInvalide nommé : l'ancienne version reste en place, ou G se tait. Rien n'est écrit ici, rien n'est lu sur disque.
const crypto = require('crypto');
const zlib = require('zlib');
const { FormatInvalide } = require('../chargeur/format');
const E = require('./empreinte-vecteur');
const G = require('../../ratmarket/decision-g');

const MAGIE = Buffer.from('RMEI'), TAG = 32, DIM = E.DIM, SECRET_MIN = 32;
const N_MAX = 200000, MAX_OCTETS = 96 * 1048576, CLES_MAX = 16 * 1048576, CONTEXTE_GZ_MAX = 32 * 1048576, CONTEXTE_MAX = 160 * 1048576;
const K_MAX = 100, LIGNE_NORME_MIN = 0.99, LIGNE_NORME_MAX = 1.01;
const refuser = m => { throw new FormatInvalide(m); };
const hmac = (secret, corps) => crypto.createHmac('sha256', secret).update(corps).digest();
const secretValide = s => typeof s === 'string' && s.length >= SECRET_MIN;
const MODELE_ID = /^[A-Za-z0-9._-]{1,60}$/, SHA = /^[0-9a-f]{64}$/;

// fp16 -> float, une table de 65 536 entrées (256 Ko) : la conversion d'une composante coûte une lecture
const LUT = new Float32Array(65536);
for (let i = 0; i < 65536; i++) LUT[i] = E.demiVersFlottant(i);

function verifierModele(m, ou) {
    if (!m || typeof m !== 'object' || typeof m.id !== 'string' || !MODELE_ID.test(m.id) || typeof m.sha256 !== 'string' || !SHA.test(m.sha256)) refuser(`${ou} : modèle mal formé (id et sha256 attendus)`);
}
function verifierCles(cles) {
    if (!Array.isArray(cles) || cles.length === 0) refuser('index vide (aucune clé)');
    if (cles.length > N_MAX) refuser(`trop de clés (${cles.length} > ${N_MAX})`);
    const vus = new Set();
    for (const c of cles) {
        if (typeof c !== 'string' || c.length === 0 || c.length > 300) refuser('clé mal formée');
        if (vus.has(c)) refuser('clés en double');
        vus.add(c);
    }
}
/** Les lignes de la matrice fp16 : finies, de norme proche de 1. Une ligne cassée donnerait de faux voisins sans un mot. */
function verifierLignes16(m16, n) {
    for (let r = 0; r < n; r++) {
        let s = 0; const b = r * DIM;
        for (let j = 0; j < DIM; j++) { const h = m16[b + j]; if ((h & 0x7c00) === 0x7c00) refuser(`matrice : une composante non finie (ligne ${r})`); const x = LUT[h]; s += x * x; }
        const nrm = Math.sqrt(s);
        if (!(nrm >= LIGNE_NORME_MIN && nrm <= LIGNE_NORME_MAX)) refuser(`matrice : la norme de la ligne ${r} n'est pas ~1`);
    }
}
function contexteDe(brut) {
    try {
        if (!brut || typeof brut !== 'object') throw new Error('x');
        for (const k of ['groupe', 'carte', 'invisibles', 'produits']) if (!brut[k] || typeof brut[k] !== 'object' || Array.isArray(brut[k])) throw new Error('x');
        return G.contexte(brut);
    } catch { return refuser('contexte G illisible'); }
}

/**
 * Fabrique le conteneur (le PRODUCTEUR, hors API : outils/sceller-index-empreintes.js ; les bancs).
 * @param {{cles: string[], matrice: Float32Array, contexte: object, modele: {id, sha256}, chargeLe: string}} e   matrice : n × 256 flottants, lignes unitaires
 * @returns {Buffer}
 */
function sceller(e, secret) {
    if (!secretValide(secret)) refuser(`secret HMAC absent ou trop court (${SECRET_MIN} caractères au moins)`);
    verifierCles(e && e.cles);
    const n = e.cles.length;
    if (!(e.matrice instanceof Float32Array) || e.matrice.length !== n * DIM) refuser('matrice : le nombre de lignes ne correspond pas au nombre de clés');
    verifierModele(e.modele, 'scellement');
    if (typeof e.chargeLe !== 'string' || Number.isNaN(new Date(e.chargeLe).getTime())) refuser('date de chargement illisible');
    contexteDe(e.contexte);                                                             // le contexte doit être lisible par la règle avant d'être scellé
    const m16 = new Uint16Array(n * DIM);
    for (let i = 0; i < m16.length; i++) {
        const x = e.matrice[i];
        if (!Number.isFinite(x)) refuser('matrice : une composante non finie');
        m16[i] = E.flottantVersDemi(x);
    }
    try { verifierLignes16(m16, n); } catch (err) { if (err instanceof FormatInvalide) refuser(err.motif.replace(/^matrice : /, 'matrice : ')); throw err; }
    const matriceBuf = Buffer.from(m16.buffer, m16.byteOffset, m16.byteLength);
    const clesBuf = Buffer.from(JSON.stringify(e.cles), 'utf8');
    const ctxBuf = zlib.gzipSync(Buffer.from(JSON.stringify(e.contexte), 'utf8'), { level: 6 });
    const entete = Buffer.from(JSON.stringify({ format: 1, n, dim: DIM, modele: { id: e.modele.id, sha256: e.modele.sha256 }, chargeLe: new Date(e.chargeLe).toISOString(),
        matriceOctets: matriceBuf.length, clesOctets: clesBuf.length, contexteOctets: ctxBuf.length }), 'utf8');
    const u32 = x => { const b = Buffer.alloc(4); b.writeUInt32LE(x); return b; };
    const corps = Buffer.concat([MAGIE, u32(entete.length), entete, matriceBuf, u32(clesBuf.length), clesBuf, u32(ctxBuf.length), ctxBuf]);
    return Buffer.concat([corps, hmac(secret, corps)]);
}

class IndexEmpreintes {
    constructor({ cles, m16, contexteG }) {
        this.cles = cles; this.mat16 = m16; this.contexteG = contexteG; this.n = cles.length;
        this.octetsMatrice = m16.byteLength;
    }
    /** Les similarités de q avec TOUTES les lignes (cosinus, lignes et q unitaires). */
    _sims(q) {
        if (!(q instanceof Float32Array) || q.length !== DIM) throw Object.assign(new Error('vecteur de recherche : 256 flottants attendus'), { code: 'ENTREE_INDEX' });
        const n = this.n, m = this.mat16, s = new Float64Array(n);
        for (let r = 0, b = 0; r < n; r++, b += DIM) { let d = 0; for (let j = 0; j < DIM; j++) d += LUT[m[b + j]] * q[j]; s[r] = d; }
        return s;
    }
    /** Le meilleur cosinus (non arrondi) : la plausibilité du vecteur. */
    meilleurCosinus(q) { const s = this._sims(q); let b = -Infinity; for (let r = 0; r < s.length; r++) if (s[r] > b) b = s[r]; return b; }
    /**
     * Le top k : [[clé, similarité arrondie à 4 décimales]…] par similarité décroissante ; à égalité (avant arrondi), la position la plus petite d'abord. Même forme que voisins() de l'index de l'étude.
     * @returns {{top: Array<[string, number]>, meilleur: number}}
     */
    voisins(q, k = 10) {
        if (!Number.isInteger(k) || k < 1 || k > K_MAX) throw Object.assign(new Error(`k hors de 1..${K_MAX}`), { code: 'ENTREE_INDEX' });
        const s = this._sims(q), kk = Math.min(k, this.n);
        const idx = new Int32Array(kk).fill(-1), val = new Float64Array(kk).fill(-Infinity);
        let rempli = 0;
        for (let r = 0; r < s.length; r++) {
            const v = s[r];
            if (rempli === kk && !(v > val[kk - 1])) continue;                          // strictement meilleur que le dernier : l'égalité reste derrière la position la plus petite
            let p = rempli < kk ? rempli : kk - 1;
            while (p > 0 && v > val[p - 1]) { val[p] = val[p - 1]; idx[p] = idx[p - 1]; p--; }
            val[p] = v; idx[p] = r; if (rempli < kk) rempli++;
        }
        const top = []; for (let i = 0; i < rempli; i++) top.push([this.cles[idx[i]], Math.round(val[i] * 1e4) / 1e4]);
        return { top, meilleur: rempli ? val[0] : -Infinity };
    }
}

/**
 * Ouvre un conteneur scellé. @param {{modeleAttendu: {id, sha256}, max?: number}} o — `modeleAttendu` est OBLIGATOIRE : la configuration dit quel modèle le serveur connaît.
 * @returns {{index: IndexEmpreintes, meta: {n, modele, chargeLe: Date, octets}}} — lève FormatInvalide (motif nommé, jamais une valeur).
 */
function ouvrir(scelle, secret, { modeleAttendu, max = MAX_OCTETS } = {}) {
    if (!secretValide(secret)) refuser(`secret HMAC absent ou trop court (${SECRET_MIN} caractères au moins)`);
    if (!Buffer.isBuffer(scelle)) refuser('ce n\'est pas un tampon');
    if (scelle.length > max) refuser(`objet plus grand que la taille permise (${Math.round(max / 1048576)} Mo)`);
    if (scelle.length < MAGIE.length + 4 + TAG + 1) refuser('objet trop court');
    if (!scelle.subarray(0, MAGIE.length).equals(MAGIE)) refuser('magie fausse (ce n\'est pas un index d\'empreintes)');
    const corps = scelle.subarray(0, scelle.length - TAG), tag = scelle.subarray(scelle.length - TAG);
    if (!crypto.timingSafeEqual(hmac(secret, corps), tag)) refuser('HMAC faux : objet non authentique');
    // le MAC est bon : le contenu vient du producteur. Chaque longueur est recomptée quand même (un producteur fautif ne doit pas faire lire hors du tampon).
    let o = MAGIE.length;
    const u32 = () => { if (o + 4 > corps.length) refuser('objet tronqué'); const x = corps.readUInt32LE(o); o += 4; return x; };
    const tranche = len => { if (!Number.isInteger(len) || len < 0 || o + len > corps.length) refuser('longueur annoncée hors de l\'objet'); const t = corps.subarray(o, o + len); o += len; return t; };
    let h;
    try { h = JSON.parse(tranche(u32()).toString('utf8')); } catch (e) { if (e instanceof FormatInvalide) throw e; refuser('entête illisible'); }
    if (!h || h.format !== 1 || h.dim !== DIM || !Number.isInteger(h.n) || h.n < 1 || h.n > N_MAX) refuser('entête : format, dimension ou nombre de lignes inattendu');
    verifierModele(h.modele, 'entête');
    const matriceBuf = tranche(h.matriceOctets);
    if (matriceBuf.length !== h.n * DIM * 2) refuser('matrice : taille différente de n × 256 × 2');
    const clesLen = u32(); if (clesLen > CLES_MAX) refuser('clés : plus grandes que la taille permise');
    let cles; try { cles = JSON.parse(tranche(clesLen).toString('utf8')); } catch (e) { if (e instanceof FormatInvalide) throw e; refuser('clés illisibles'); }
    if (Array.isArray(cles) && cles.length !== h.n) refuser('clés : leur nombre ne correspond pas aux lignes de la matrice');
    verifierCles(cles);
    const ctxLen = u32(); if (ctxLen > CONTEXTE_GZ_MAX) refuser('contexte : plus grand que la taille permise');
    const ctxGz = tranche(ctxLen);
    if (o !== corps.length) refuser('octets en trop après le contexte');
    // le modèle attendu : jugé APRÈS le MAC et la forme, avant tout travail coûteux
    if (!modeleAttendu || typeof modeleAttendu.id !== 'string' || typeof modeleAttendu.sha256 !== 'string') refuser('modèle attendu non donné par la configuration : l\'index n\'est pas ouvert');
    if (h.modele.id !== modeleAttendu.id || h.modele.sha256 !== modeleAttendu.sha256) refuser('modèle : l\'index vient d\'un autre modèle que celui de la configuration');
    const m16 = new Uint16Array(h.n * DIM);
    Buffer.from(m16.buffer).set(matriceBuf);                                            // une copie alignée, qui ne retient pas le tampon du fichier
    verifierLignes16(m16, h.n);
    let contexteBrut;
    try { contexteBrut = JSON.parse(zlib.gunzipSync(ctxGz, { maxOutputLength: CONTEXTE_MAX }).toString('utf8')); } catch { refuser('contexte : illisible ou trop grand une fois décompressé'); }
    const chargeLe = new Date(h.chargeLe);
    if (Number.isNaN(chargeLe.getTime())) refuser('date de chargement illisible');
    const contexteG = contexteDe(contexteBrut);
    return { index: new IndexEmpreintes({ cles, m16, contexteG }), meta: { n: h.n, modele: { id: h.modele.id, sha256: h.modele.sha256 }, chargeLe, octets: scelle.length } };
}

module.exports = { sceller, ouvrir, IndexEmpreintes, MAGIE, TAG, DIM, N_MAX, MAX_OCTETS, K_MAX, secretValide };
