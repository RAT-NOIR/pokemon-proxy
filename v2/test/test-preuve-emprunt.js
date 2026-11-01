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
    // ── tour 2 (relecture p8) : les seuils sont TENUS par un test de chaque côté ─────────────
    H.v('R8. inliersContredit = 15 : 15 contredit (cosinus < 0,7), 16 NE contredit PAS (mutation 16..20)', [P.classer([m({ fen: 15, cos: 0.1 })]).detail, P.classer([m({ fen: 16, cos: 0.1 })]).detail, P.classer([m({ fen: 20, cos: 0.1 })]).detail], ['contredite', 'hesitante', 'hesitante']);
    H.v('R9. cosContredit = 0,7 : 0,69 contredit, 0,7 et 0,72 non (mutation 0,75)', [P.classer([m({ fen: 5, cos: 0.69 })]).detail, P.classer([m({ fen: 5, cos: 0.7 })]).detail, P.classer([m({ fen: 5, cos: 0.72 })]).detail], ['contredite', 'hesitante', 'hesitante']);
    H.v('R10. cosConcorde = 0,9 : 0,9 concorde, 0,89 et 0,87 non (mutation 0,85)', [P.classer([m({ cos: 0.9 })]).classe, P.classer([m({ cos: 0.89 })]).detail, P.classer([m({ cos: 0.87 })]).detail], ['meme', 'hesitante', 'hesitante']);
    // I3 (relecture p8) : la fenêtre ORB ne suffit PLUS seule si le cosinus p8000 est CONTRAIRE (< 0,7) ; un cosinus inconnu n'est pas contraire
    H.v('R11. fenêtre 40 face à un cosinus 0,46 : NE concorde PAS (le réseau dit « différent »), le produit n\'est pas admis', [P.classer([m({ fen: 40, cos: 0.46 })]).classe, P.classer([m({ fen: 40, cos: 0.46 })]).detail], ['indecidable', 'hesitante']);
    H.v('R11b. la frontière : fenêtre 40 avec cosinus 0,69 refusée, avec 0,7 ou sans cosinus admise', [P.classer([m({ fen: 40, cos: 0.69 })]).classe, P.classer([m({ fen: 40, cos: 0.7 })]).classe, P.classer([m({ fen: 40 })]).classe], ['indecidable', 'meme', 'meme']);
    H.v('R11c. UNE seule référence au cosinus contraire suffit à refuser (les autres concordent)', P.classer([m({ fen: 80, cos: 0.95 }), m({ fen: 45, cos: 0.4 })]).classe, 'indecidable');
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
    const avantTraversee = appels.length;
    H.v('L5c. (relecture p8) une traversée au MILIEU de la clé (a/../b), qui passe l\'alphabet permis, est refusée AVANT toute requête ; la validation seule la refuse', [await P.lireImage('a/../b.webp', { fetch: async u => { appels.push(u); return rep(200); }, cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 }), appels.length === avantTraversee, P.cleValide('a/../b.webp'), P.cleValide('a/b..c.webp'), P.cleValide('a//b.webp'), P.cleValide('tcgdex/Set-A/001-123.webp')], [null, true, false, false, false, true]);
    // M5 (relecture p8) : jamais de redirection suivie, et la taille est bornée AVANT la lecture complète
    let option = null; await P.lireImage('x/redir.webp', { fetch: async (u, o) => { option = o; return rep(200); }, cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 });
    H.v('L8. la requête est faite avec redirect: "error" (l\'hôte n\'est vérifié que sur l\'adresse de départ)', option && option.redirect, 'error');
    let lu = false; const gros = { ok: true, status: 200, headers: { get: k => (k.toLowerCase() === 'content-type' ? 'image/webp' : k.toLowerCase() === 'content-length' ? String(P.OCTETS_MAX + 1) : null) }, arrayBuffer: async () => { lu = true; return new ArrayBuffer(8); } };
    H.v('L9. un Content-Length au-dessus du plafond : null, SANS avoir lu le corps', [await P.lireImage('x/gros.webp', { fetch: async () => gros, cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 }), lu], [null, false]);
    const sansLongueur = { ok: true, status: 200, headers: { get: k => (k.toLowerCase() === 'content-type' ? 'image/webp' : null) }, arrayBuffer: async () => new ArrayBuffer(P.OCTETS_MAX + 1) };
    H.v('L9b. sans Content-Length, un corps plus gros que le plafond est refusé après lecture', await P.lireImage('x/gros2.webp', { fetch: async () => sansLongueur, cache: { lire: async () => null, ecrire: async () => { } }, attenteMs: 0 }), null);
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
    H.v('T7. (relecture p8) la 3e concordance ne rattrape JAMAIS un scan au cosinus contraire (fenêtre 40, cosinus 0,46, pHash 2)', P.classerAvecTroisieme([m({ fen: 40, cos: 0.46, tierce: { phash: 2, inliers: 90 } })]).classe, 'indecidable');
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
