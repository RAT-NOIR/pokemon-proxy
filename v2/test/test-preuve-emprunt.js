'use strict';
// PREUVE-EMPRUNT (GUICHET, passage 8) — la preuve à l'image des tamponnées empruntées : la règle des emprunts déjà classés (>= 30 inliers de la fenêtre d'illustration OU cosinus >= 0,9 contre CHACUN des autres scans),
// la LECTURE d'une image manquante sur le bucket public R2 (hôte public seulement, jamais Cardmarket) et la 3e concordance (zone SOUPLE du catalogue : pHash <= 6 ET ORB >= 30) exigée d'un « hésitant ».
// Pas de réseau, pas de base : le fetch est injecté.
const H = require('./_harnais');
const P = require('../mesures/preuve-emprunt');

(async () => {
    const m = (o = {}) => ({ cle: 'x/a.webp', cos: null, fen: null, ...o });
    // ── la règle (inchangée) ────────────────────────────────────────────────────────────────
    H.v('R1. tous les scans concordent (fenêtre >= 30 ou cosinus >= 0,9) : « meme »', P.classer([m({ fen: 31 }), m({ cos: 0.9 }), m({ fen: 12, cos: 0.95 })]).classe, 'meme');
    H.v('R2. le seuil est >= : 30 inliers concordent, 29 non (sans cosinus : hésitant)', [P.classer([m({ fen: 30 })]).classe, P.classer([m({ fen: 29 })]).classe], ['meme', 'indecidable']);
    H.v('R3. tous contredisent (fenêtre <= 15 ET cosinus < 0,7 ou inconnu) : « different »', P.classer([m({ fen: 15, cos: 0.69 }), m({ fen: 3 })]).classe, 'different');
    H.v('R4. une référence sans AUCUNE mesure : indécidable (jamais admis), nommé « non mesurable »', [P.classer([m({ fen: 40 }), m({})]).classe, /non mesurable/.test(P.classer([m({})]).sous)], ['indecidable', true]);
    H.v('R5. aucune référence : indécidable', P.classer([]).classe, 'indecidable');
    H.v('R6. mixte (une concorde, une contredit) : indécidable', P.classer([m({ fen: 40 }), m({ fen: 5, cos: 0.1 })]).classe, 'indecidable');
    H.v('R7. une mesure hésitante (cosinus 0,8 sans fenêtre) : « hesitante », pas « meme »', P.classer([m({ cos: 0.8 })]).detail, 'hesitante');
    // ── la lecture sur R2 public ────────────────────────────────────────────────────────────
    const appels = []; const octets = Buffer.from('RIFFxxxxWEBPfake');
    const rep = (status, type = 'image/webp', corps = octets) => ({ ok: status === 200, status, headers: { get: k => (k.toLowerCase() === 'content-type' ? type : null) }, arrayBuffer: async () => corps.buffer.slice(corps.byteOffset, corps.byteOffset + corps.length) });
    const fetchOk = async (url) => { appels.push(url); return rep(200); };
    const c = new Map();
    const cache = { lire: async k => c.get(k) ?? null, ecrire: async (k, b) => { c.set(k, b); } };
    const b1 = await P.lireImage('tcgdex/Set-A/001-123.webp', { fetch: fetchOk, cache, attenteMs: 0 });
    H.v('L1. une image absente du cache est lue sur l\'hôte PUBLIC par sa cleR2, puis rangée', [Buffer.isBuffer(b1), appels.length, appels[0]], [true, 1, 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/tcgdex/Set-A/001-123.webp']);
    await P.lireImage('tcgdex/Set-A/001-123.webp', { fetch: fetchOk, cache, attenteMs: 0 });
    H.v('L2. la seconde lecture vient du cache : aucune requête de plus', appels.length, 1);
    H.v('L3. un 404 rend null (« non mesurable »), jamais une exception', await P.lireImage('x/absent.webp', { fetch: async () => rep(404), cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 }), null);
    H.v('L4. une réponse qui n\'est pas une image (HTML d\'un défi) : null', await P.lireImage('x/y.webp', { fetch: async () => rep(200, 'text/html'), cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 }), null);
    H.v('L5. une clé dangereuse (.., chemin absolu, schéma, requête) : refusée AVANT toute requête', await Promise.all(['../secret', '/etc/x', 'https://evil.example/x.webp', 'a/b.webp?x=1', ''].map(k => P.lireImage(k, { fetch: async u => { appels.push(u); return rep(200); }, cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 }))), [null, null, null, null, null]);
    H.v('L5b. aucune requête n\'est partie pour les clés refusées', appels.length, 1);
    H.v('L6. un hôte hors de la liste publique est refusé (jamais Cardmarket, jamais un hôte passé en paramètre)', await P.lireImage('x/y.webp', { fetch: fetchOk, cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0, hote: 'www.cardmarket.com' }), null);
    H.v('L7. une exception réseau rend null', await P.lireImage('x/z.webp', { fetch: async () => { throw new Error('réseau'); }, cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 }), null);
    // ── la 3e concordance ────────────────────────────────────────────────────────────────────
    H.v('T1. zone souple du catalogue : pHash <= 6 ET ORB >= 30', [P.troisiemeConcordance({ phash: 6, inliers: 30 }), P.troisiemeConcordance({ phash: 7, inliers: 80 }), P.troisiemeConcordance({ phash: 0, inliers: 29 })], [true, false, false]);
    H.v('T2. une mesure absente ou non finie ne concorde jamais', [P.troisiemeConcordance(null), P.troisiemeConcordance({ phash: NaN, inliers: 99 }), P.troisiemeConcordance({ phash: 1, inliers: undefined })], [false, false, false]);
    // un hésitant n'est admis que si la 3e concordance passe contre CHAQUE référence non déjà concordante
    const h1 = P.classerAvecTroisieme([m({ cos: 0.8, tierce: { phash: 4, inliers: 50 } }), m({ fen: 40 })]);
    H.v('T3. hésitant dont chaque référence non concordante passe la 3e concordance : « meme » (preuve nommée)', [h1.classe, /3e concordance/.test(h1.sous)], ['meme', true]);
    const h2 = P.classerAvecTroisieme([m({ cos: 0.8, tierce: { phash: 4, inliers: 50 } }), m({ cos: 0.75, tierce: { phash: 9, inliers: 50 } })]);
    H.v('T4. une seule référence qui échoue la 3e concordance : le produit reste indécidable (sans visuel)', h2.classe, 'indecidable');
    H.v('T5. sans mesure de 3e concordance (image illisible) : reste indécidable', P.classerAvecTroisieme([m({ cos: 0.8 })]).classe, 'indecidable');
    H.v('T6. la 3e concordance ne rattrape JAMAIS un « mixte » ou un « different » : seul un hésitant', [P.classerAvecTroisieme([m({ fen: 40 }), m({ fen: 5, cos: 0.1, tierce: { phash: 2, inliers: 90 } })]).classe, P.classerAvecTroisieme([m({ fen: 3, tierce: { phash: 1, inliers: 99 } })]).classe], ['indecidable', 'different']);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
