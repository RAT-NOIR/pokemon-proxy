'use strict';
// MODELE-VISUEL-API — l'aide commune des bancs de la route et de l'isolement : un index d'empreintes FABRIQUÉ (vecteurs pseudo-aléatoires normalisés, graine fixe, clés et produits inventés), le modèle attendu, les vecteurs et
// les CARTES REDRESSÉES que l'extension enverrait (JPEG 420 × 587 fabriqués par sharp), des FAUSSES zones scénarisées, et l'installation de l'index dans le processus. Aucune donnée réelle, aucun identifiant d'utilisateur.
const crypto = require('crypto');
const sharp = require('sharp');
const E = require('../identifier/empreinte-vecteur');
const X = require('../identifier/index-empreintes');
const etat = require('../identifier/etat-empreintes');

const SECRET = 'secret-de-banc-0123456789-abcdefghijklmnop';
const MODELE = Object.freeze({ id: 'p8000-poids8-banc', sha256: crypto.createHash('sha256').update('poids-du-banc').digest('hex') });
const ENV_EMPREINTE = Object.freeze({ MONGODB_BASE: 'test_scratch', V2_EMPREINTE_EXTENSION: '1', V2_MODELE_EMPREINTE_ID: MODELE.id, V2_MODELE_EMPREINTE_SHA256: MODELE.sha256 });
// les produits du banc (semés dans le catalogue de la base en mémoire par les bancs)
const ID_A = 895789, ID_B = 895790, ID_P = 895791, ID_X = 895792;
const N = 200;
function graine(s) { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
function unitaire(r) { const v = new Float32Array(256); let s = 0; for (let i = 0; i < 256; i++) { v[i] = r() - 0.5; s += v[i] * v[i]; } s = Math.sqrt(s); for (let i = 0; i < 256; i++) v[i] /= s; return v; }
const cles = Array.from({ length: N }, (_, i) => `banc/jeu-${i}.webp`);
const matrice = new Float32Array(N * 256);
{ const r = graine(20261018); for (let i = 0; i < N; i++) matrice.set(unitaire(r), i * 256); }
// deux JUMEAUX (même dessin) = un vecteur voisin : la ligne `b` est la ligne `a` à 2 % de bruit près
function jumeau(a, b) { const r = graine(1000 + b), o = new Float32Array(256); let s = 0; for (let j = 0; j < 256; j++) { o[j] = matrice[a * 256 + j] * 0.98 + (r() - 0.5) * 0.02; s += o[j] * o[j]; } s = Math.sqrt(s); for (let j = 0; j < 256; j++) matrice[b * 256 + j] = o[j] / s; }
jumeau(10, 11); jumeau(12, 13);
// jeu-3 : un visuel, un produit (ID_P) · jeu-4 : ID_X (un autre numéro que celui que la chaîne lit) · jeu-5 : ID_A · jeu-8 : DEUX produits à des prix différents (ID_A, ID_B) : G pose une question
// jeu-10 / jeu-11 : jumeaux (ID_B / ID_X : le second CONTREDIT la lecture) · jeu-12 / jeu-13 : jumeaux (ID_P / ID_A : les deux concordent avec la lecture) — la garde des zones départage
const contexte = { groupe: { 'banc/jeu-10.webp': 7, 'banc/jeu-11.webp': 7, 'banc/jeu-12.webp': 8, 'banc/jeu-13.webp': 8 },
    carte: { 'banc/jeu-3.webp': [3003], 'banc/jeu-4.webp': [3004], 'banc/jeu-5.webp': [3005], 'banc/jeu-8.webp': [3008], 'banc/jeu-10.webp': [3010], 'banc/jeu-11.webp': [3010], 'banc/jeu-12.webp': [3012], 'banc/jeu-13.webp': [3012] }, invisibles: {},
    produits: { 'banc/jeu-3.webp': [[ID_P, 2.0]], 'banc/jeu-4.webp': [[ID_X, 2.0]], 'banc/jeu-5.webp': [[ID_A, 1.0]], 'banc/jeu-8.webp': [[ID_A, 1.0], [ID_B, 9.0]],
        'banc/jeu-10.webp': [[ID_B, 1.0]], 'banc/jeu-11.webp': [[ID_X, 1.0]], 'banc/jeu-12.webp': [[ID_P, 1.0]], 'banc/jeu-13.webp': [[ID_A, 1.0]] } };
const ligneDe = i => Float32Array.from(matrice.subarray(i * 256, (i + 1) * 256));
/** Le scellé de l'index fabriqué (le même octet pour octet à chaque appel). */
const scelle = (over = {}) => X.sceller({ cles, matrice, contexte, modele: MODELE, chargeLe: '2026-10-17T14:14:00.000Z', ...over }, SECRET);
function installerIndex() { const o = X.ouvrir(scelle(), SECRET, { modeleAttendu: MODELE }); etat.installer(Object.freeze({ index: o.index, meta: o.meta })); return o.index; }

// ── les cartes redressées : des JPEG 420 × 587 fabriqués (bruit à graine fixe, qualité 40 : sous les 200 Ko)
const bruit = (w, h, g) => { let x = g >>> 0; const b = Buffer.alloc(w * h * 3); for (let i = 0; i < b.length; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; b[i] = (x >>> 24) & 0xff; } return b; };
const jpeg = async (w, h, g, q = 40) => (await sharp(bruit(w, h, g), { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: q }).toBuffer());
let CARTE = null, CARTE_FORGEE = null, SHA_CARTE = null, SHA_FORGEE = null;
const shaPixels = async b64 => crypto.createHash('sha1').update(await sharp(Buffer.from(b64, 'base64')).removeAlpha().toColourspace('srgb').raw().toBuffer()).digest('hex');
/** À appeler une fois, au début du banc : fabrique la carte honnête et la carte FORGÉE (les pixels d'un autre produit) et leurs empreintes de pixels. */
async function preparer() {
    CARTE = (await jpeg(420, 587, 11)).toString('base64'); CARTE_FORGEE = (await jpeg(420, 587, 22)).toString('base64');
    SHA_CARTE = await shaPixels(CARTE); SHA_FORGEE = await shaPixels(CARTE_FORGEE);
}
const cartes = () => ({ CARTE, CARTE_FORGEE, SHA_CARTE, SHA_FORGEE });
/** Ce que l'extension met dans le corps : une entrée par photo, le vecteur de la ligne `i` de l'index (fp16 base64) et la carte redressée (`carte === false` : sans carte). */
const entree = (photo, i, redressee = false, carte = undefined) => ({ photo, vecteur: E.encoderVecteur(ligneDe(i)), redressee, ...(carte === false ? {} : { carte: carte === undefined ? CARTE : carte }) });
const modeleAnnonce = () => ({ id: MODELE.id, sha256: MODELE.sha256 });
/** De FAUSSES zones : la photo est reconnue par l'empreinte de ses pixels ; la carte honnête donne la victoire à jeu-10 et jeu-12, la carte forgée à jeu-11 et jeu-13 (les jumeaux). */
function fausseZones() {
    const appels = [];
    return { appels,
        photoGrise: async data => { const sha = crypto.createHash('sha1').update(data).digest('hex'); appels.push(['photo', sha]); return { sha, delete() { } }; },
        comparerPaire: async (photo, a, b) => {
            appels.push(['paire', photo.sha === SHA_FORGEE ? 'forgee' : 'honnete', a.cle, b.cle]);
            const forge = photo.sha === SHA_FORGEE, gagneA = new Set(forge ? ['banc/jeu-11.webp', 'banc/jeu-13.webp'] : ['banc/jeu-10.webp', 'banc/jeu-12.webp']);
            return [gagneA.has(a.cle) ? 0.4 : -0.4, 0.2];
        },
        scoresZones: async (photo, s) => { appels.push(['zones', photo.sha === SHA_FORGEE ? 'forgee' : 'honnete', s.cle]); return { haut: 0.9, bas: 0.9, inliers: 120, illustration: 0.9, bandeau: 0.9, texte: 0.9 }; }
    };
}
const scanBanc = async cle => Buffer.from('scan-' + cle);

module.exports = { SECRET, MODELE, ENV_EMPREINTE, ID_A, ID_B, ID_P, ID_X, N, cles, matrice, contexte, ligneDe, scelle, installerIndex, entree, modeleAnnonce, unitaire, graine, etat, preparer, cartes, jpeg, fausseZones, scanBanc };
