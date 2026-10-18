'use strict';
// Banc MODELE-VISUEL-API (2) — l'INDEX des empreintes de l'archive : le conteneur scellé (RMEI), son ouverture refusée au moindre doute, et la recherche des voisins (top 10 par cosinus, fp16 en mémoire).
// Module PUR : un index FABRIQUÉ (vecteurs pseudo-aléatoires normalisés, graine fixe, clés inventées) ; aucun fichier, aucune base, aucun réseau. Le secret est une chaîne de banc.
const H = require('./_harnais');
const crypto = require('crypto');
const E = require('../identifier/empreinte-vecteur');
const X = require('../identifier/index-empreintes');
const SC = require('../chargeur/scellement');

function graine(s) { let x = s >>> 0; return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; }; }
function unitaire(r, n = 256) { const v = new Float32Array(n); let s = 0; for (let i = 0; i < n; i++) { v[i] = r() - 0.5; s += v[i] * v[i]; } s = Math.sqrt(s); for (let i = 0; i < n; i++) v[i] /= s; return v; }
const SECRET = 'secret-de-banc-0123456789-abcdefghijklmnop';
const MODELE = { id: 'p8000-poids8-banc', sha256: crypto.createHash('sha256').update('poids-du-banc').digest('hex') };
const N = 400;
const rng = graine(42);
const cles = Array.from({ length: N }, (_, i) => `banc/jeu-${i}.webp`);
const matrice = new Float32Array(N * 256);
for (let i = 0; i < N; i++) matrice.set(unitaire(rng), i * 256);
const contexte = { groupe: { 'banc/jeu-0.webp': 0, 'banc/jeu-1.webp': 0 }, carte: { 'banc/jeu-0.webp': [11], 'banc/jeu-1.webp': [11], 'banc/jeu-2.webp': [12] }, invisibles: { 11: [901] }, produits: { 'banc/jeu-0.webp': [[701, 1.5]], 'banc/jeu-1.webp': [[702, 1.5]], 'banc/jeu-2.webp': [[703, null]] } };
const entree = (over = {}) => ({ cles, matrice, contexte, modele: MODELE, chargeLe: '2026-10-17T14:14:00.000Z', ...over });
const refus = (nom, f, motif) => { let r; try { f(); r = 'ouvert'; } catch (e) { r = e && e.name === 'FormatInvalide' ? e.motif : `autre:${e && e.name}`; } H.vrai(`${nom} -> refus (${motif})`, typeof r === 'string' && r !== 'ouvert' && !r.startsWith('autre:') && r.includes(motif)); if (!(typeof r === 'string' && r.includes(motif))) console.log('   obtenu :', r); };

// référence BRUTE en double précision sur la matrice float32 d'origine (ce que l'étude appelle l'index fp32)
function brut(q, k = 10) {
    const s = []; for (let i = 0; i < N; i++) { let d = 0; for (let j = 0; j < 256; j++) d += matrice[i * 256 + j] * q[j]; s.push([i, d]); }
    s.sort((a, b) => b[1] - a[1] || a[0] - b[0]); return s.slice(0, k).map(([i, d]) => [cles[i], Math.round(d * 1e4) / 1e4]);
}

(async () => {
    H.v('0. constantes du conteneur : magie RMEI, étiquette HMAC de 32 octets, 256 dimensions', [X.MAGIE.toString(), X.TAG, X.DIM], ['RMEI', 32, 256]);
    H.vrai('   la magie diffère de celle de l\'archive des visuels (RMVS) : un fichier ne passe pas pour l\'autre', !X.MAGIE.equals(SC.MAGIE));

    const scelle = X.sceller(entree(), SECRET);
    H.vrai('1. un conteneur scellé est un tampon qui commence par RMEI et finit par 32 octets de HMAC', Buffer.isBuffer(scelle) && scelle.subarray(0, 4).toString() === 'RMEI' && scelle.length > 4 + 32 + N * 512);
    const ouvert = X.ouvrir(scelle, SECRET, { modeleAttendu: MODELE });
    const idx = ouvert.index;
    H.v('   l\'ouverture rend l\'index : n, version du modèle, date de chargement', [idx.n, ouvert.meta.modele, ouvert.meta.chargeLe.toISOString()], [N, MODELE, '2026-10-17T14:14:00.000Z']);
    H.vrai('   le contexte G est celui de ratmarket/decision-g (groupe, membres, carte, invisibles, produits)', idx.contexteG && idx.contexteG.groupe instanceof Map && idx.contexteG.membres instanceof Map && idx.contexteG.invisibles.get(11)[0] === 901 && idx.contexteG.produits.get('banc/jeu-2.webp')[0][0] === 703);

    // ── le refus : écrit par ce qu'il autorise (taille, magie, MAC, puis la forme, puis le modèle)
    refus('2a. secret trop court', () => X.ouvrir(scelle, 'court', { modeleAttendu: MODELE }), 'secret');
    refus('2b. secret faux', () => X.ouvrir(scelle, SECRET.replace('0123', '9999'), { modeleAttendu: MODELE }), 'HMAC');
    const alt = Buffer.from(scelle); alt[100] ^= 1;
    refus('2c. un octet de la matrice altéré (HMAC)', () => X.ouvrir(alt, SECRET, { modeleAttendu: MODELE }), 'HMAC');
    refus('2d. magie fausse (une archive des visuels RMVS scellée avec le même secret)', () => X.ouvrir(SC.sceller(Buffer.from('x'.repeat(200)), SECRET), SECRET, { modeleAttendu: MODELE }), 'magie');
    refus('2e. tronqué', () => X.ouvrir(scelle.subarray(0, scelle.length - 10), SECRET, { modeleAttendu: MODELE }), 'HMAC');
    refus('2f. trop court', () => X.ouvrir(Buffer.from('RMEI'), SECRET, { modeleAttendu: MODELE }), 'court');
    refus('2g. pas un tampon', () => X.ouvrir('RMEI', SECRET, { modeleAttendu: MODELE }), 'tampon');
    refus('2h. un autre modèle (sha256 des poids différent) : l\'index vit dans un autre espace, il ne sert à aucun vecteur', () => X.ouvrir(scelle, SECRET, { modeleAttendu: { id: MODELE.id, sha256: 'a'.repeat(64) } }), 'modèle');
    refus('2i. un autre identifiant de version', () => X.ouvrir(scelle, SECRET, { modeleAttendu: { id: 'autre', sha256: MODELE.sha256 } }), 'modèle');
    refus('2j. aucun modèle attendu (la configuration ne dit pas lequel : on ne devine pas)', () => X.ouvrir(scelle, SECRET, {}), 'modèle');
    refus('2k. un objet plus grand que la taille permise', () => X.ouvrir(scelle, SECRET, { modeleAttendu: MODELE, max: 1000 }), 'taille');
    // les défauts de FORME sont scellés par le producteur lui-même : le conteneur reste refusé même authentique
    refus('3a. clés en double', () => X.ouvrir(X.sceller(entree({ cles: cles.map((c, i) => (i === 7 ? cles[3] : c)) }), SECRET), SECRET, { modeleAttendu: MODELE }), 'double');
    refus('3b. nombre de clés différent du nombre de lignes', () => X.sceller(entree({ cles: cles.slice(0, N - 1) }), SECRET), 'clés');
    refus('3c. une composante non finie dans la matrice', () => { const m = Float32Array.from(matrice); m[5] = Infinity; X.sceller(entree({ matrice: m }), SECRET); }, 'matrice');
    refus('3d. une ligne qui n\'est pas unitaire (norme 2) : refusée à l\'ouverture comme à la fabrication', () => { const m = Float32Array.from(matrice); for (let j = 0; j < 256; j++) m[256 + j] *= 2; X.sceller(entree({ matrice: m }), SECRET); }, 'norme');
    refus('3e. un index vide', () => X.sceller(entree({ cles: [], matrice: new Float32Array(0) }), SECRET), 'vide');

    // ── la recherche : le même top 10 que la référence brute en double précision, à l'arrondi du fp16 près (mesuré ci-dessous, pas supposé)
    let memeCle1 = 0, memeEnsemble = 0, totalEcart = 0, maxEcart = 0;
    const r2 = graine(7);
    for (let t = 0; t < 40; t++) {
        const q = unitaire(r2), a = idx.voisins(q, 10).top, b = brut(q, 10);
        if (a[0][0] === b[0][0]) memeCle1++;
        if (new Set(a.map(x => x[0])).size === 10 && a.map(x => x[0]).sort().join() === b.map(x => x[0]).sort().join()) memeEnsemble++;
        for (let i = 0; i < 10; i++) { const e = Math.abs(a[i][1] - b[i][1]); totalEcart += e; maxEcart = Math.max(maxEcart, e); }
    }
    H.v('4a. 40 requêtes aléatoires : le rang 1 est celui de la référence brute dans tous les cas', memeCle1, 40);
    H.vrai(`4b. l\'écart de similarité dû au fp16 reste sous 2e-3 en maximum (mesuré : ${maxEcart.toFixed(5)})`, maxEcart < 2e-3);
    console.log(`   (ensemble du top 10 identique à la référence brute : ${memeEnsemble}/40 ; écart moyen ${(totalEcart / 400).toFixed(6)})`);
    // une ligne de l'index envoyée telle quelle : elle se retrouve, à ~1
    const ligne17 = matrice.subarray(17 * 256, 18 * 256), rr = idx.voisins(Float32Array.from(ligne17), 10);
    H.vrai('4c. un vecteur de l\'index (arrondi fp16) retrouve sa propre ligne au rang 1, similarité >= 0,9995', rr.top[0][0] === cles[17] && rr.top[0][1] >= 0.9995);
    H.vrai('4d. les similarités sont arrondies à 4 décimales et décroissantes, 10 clés distinctes', rr.top.length === 10 && rr.top.every((x, i) => Math.abs(x[1] * 1e4 - Math.round(x[1] * 1e4)) < 1e-6 && (i === 0 || x[1] <= rr.top[i - 1][1])) && new Set(rr.top.map(x => x[0])).size === 10);
    H.v('4e. meilleurCosinus = la similarité du rang 1 (non arrondie à moins de 1e-4)', Math.abs(idx.meilleurCosinus(Float32Array.from(ligne17)) - rr.top[0][1]) < 1e-4, true);
    // égalité : deux lignes identiques -> la plus petite position d'abord (ordre déterministe)
    const m2 = Float32Array.from(matrice); m2.set(matrice.subarray(0, 256), 9 * 256);
    const idx2 = X.ouvrir(X.sceller(entree({ matrice: m2 }), SECRET), SECRET, { modeleAttendu: MODELE }).index;
    const tt = idx2.voisins(Float32Array.from(matrice.subarray(0, 256)), 3).top;
    H.v('4f. deux lignes identiques (0 et 9) : à similarité égale, la position la plus petite d\'abord', [tt[0][0], tt[1][0]], [cles[0], cles[9]]);
    H.v('4g. k hors de 1..100 ou un vecteur de mauvaise taille : refusé par une exception nommée, jamais un résultat inventé', [(() => { try { idx.voisins(new Float32Array(255), 10); return 'ok'; } catch (e) { return e.code; } })(), (() => { try { idx.voisins(Float32Array.from(ligne17), 0); return 'ok'; } catch (e) { return e.code; } })()], ['ENTREE_INDEX', 'ENTREE_INDEX']);
    // la mémoire de la matrice : 2 octets par composante (fp16), le conteneur n'en garde pas une seconde copie en float32
    H.v('5. la matrice en mémoire pèse 2 octets par composante (n × 256 × 2)', idx.octetsMatrice, N * 256 * 2);
    // l'encodage de l'extension (fp16) du vecteur d'une ligne ne sort pas de la fenêtre de vérification : la chaîne entière tient
    const v = E.verifier(E.encoderVecteur(Float32Array.from(ligne17)), q => idx.meilleurCosinus(q));
    H.vrai('6. le vecteur d\'une ligne passe la vérification de l\'extension (forme, valeurs, norme, cosinus)', v.ok === true && v.meilleurCosinus >= 0.9995);
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
