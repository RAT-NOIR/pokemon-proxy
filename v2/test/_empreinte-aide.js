'use strict';
// MODELE-VISUEL-API — l'aide commune des bancs de la route et de l'isolement : un index d'empreintes FABRIQUÉ (vecteurs pseudo-aléatoires normalisés, graine fixe, clés et produits inventés), le modèle attendu, les vecteurs que
// l'extension enverrait, et l'installation de l'index dans le processus. Aucune donnée réelle, aucun identifiant d'utilisateur, aucun fichier du testeur.
const crypto = require('crypto');
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
// jeu-3 : un visuel, un produit (ID_P) · jeu-4 : ID_X (un autre numéro que celui que la chaîne lit) · jeu-5 : ID_A · jeu-8 : DEUX produits à des prix différents (ID_A, ID_B) : G pose une question
const contexte = { groupe: {}, carte: { 'banc/jeu-3.webp': [3003], 'banc/jeu-4.webp': [3004], 'banc/jeu-5.webp': [3005], 'banc/jeu-8.webp': [3008] }, invisibles: {},
    produits: { 'banc/jeu-3.webp': [[ID_P, 2.0]], 'banc/jeu-4.webp': [[ID_X, 2.0]], 'banc/jeu-5.webp': [[ID_A, 1.0]], 'banc/jeu-8.webp': [[ID_A, 1.0], [ID_B, 9.0]] } };
const ligneDe = i => Float32Array.from(matrice.subarray(i * 256, (i + 1) * 256));
/** Le scellé de l'index fabriqué (le même octet pour octet à chaque appel). */
const scelle = (over = {}) => X.sceller({ cles, matrice, contexte, modele: MODELE, chargeLe: '2026-10-17T14:14:00.000Z', ...over }, SECRET);
function installerIndex() { const o = X.ouvrir(scelle(), SECRET, { modeleAttendu: MODELE }); etat.installer(Object.freeze({ index: o.index, meta: o.meta })); return o.index; }
/** Ce que l'extension met dans le corps : une entrée par photo, le vecteur de la ligne `i` de l'index (fp16 base64). */
const entree = (photo, i, redressee = false) => ({ photo, vecteur: E.encoderVecteur(ligneDe(i)), redressee });
const modeleAnnonce = () => ({ id: MODELE.id, sha256: MODELE.sha256 });

module.exports = { SECRET, MODELE, ENV_EMPREINTE, ID_A, ID_B, ID_P, ID_X, N, cles, matrice, contexte, ligneDe, scelle, installerIndex, entree, modeleAnnonce, unitaire, graine, etat };
