// ============================================================
// L'INDEX DES SYMBOLES DE SETS, POUR L'IDENTIFICATION (décision du testeur, 2026-09-28 : « prépare leur usage pour l'identification »)
// ============================================================
// Une règle unique, pour l'outil qui CONSTRUIT l'index (construire-index-symboles.js) et pour l'API qui le LIRA : la signature d'une
// image de symbole, et la recherche du symbole le plus proche. Rien n'est branché dans la route : il faut d'abord découper le symbole
// sur une photo réelle, et MESURER sur des photos à vérité (les 20 photos du testeur) — les deux seuils ci-dessous n'ont été dérivés
// d'aucune distribution (§23 : un seuil porte ce qu'il protège ; ceux-ci sont à calibrer avant tout branchement).
//
// LA SIGNATURE : aplatie sur blanc, en niveaux de gris, rognée de ses bords uniformes, ramenée dans un carré 32×32 (proportions
// gardées, fond blanc) : 1 024 octets, en base64. ⚠️ Un hachage dHash 64 bits a été essayé d'abord et REJETÉ par le banc : sur une
// boîte noire à texte blanc (« sv4a »), ses bits se tirent dans les aplats — une simple réduction à 60×40 l'éloignait de 16 bits de
// lui-même, plus que de « s12a ». La corrélation NORMALISÉE (moyenne et écart-type retirés) ne dépend ni du contraste ni du fond.
// LA RECHERCHE s'écrit par ce qu'elle AUTORISE : elle ne DÉSIGNE un set que si le plus proche corrèle à SEUIL_NON_MESURE au moins ET
// qu'aucun AUTRE set n'est à ECART_NON_MESURE de lui — un symbole porté par plusieurs sets (l'étoile PROMO de 8 séries de promos) ne
// désigne rien (le verrou 2 de departagerParSymbole, sets-vintage-japonais.js, transposé aux images). Elle rend toujours le classement.
const sharp = require('sharp');

const COTE = 32;
const SEUIL_NON_MESURE = 0.80;   // corrélation minimale pour désigner — posée à l'estime, À CALIBRER
const ECART_NON_MESURE = 0.03;   // un autre set à moins de cet écart du premier : ex aequo, rien n'est désigné — À CALIBRER

async function signatureSymbole(buf) {
    const gris = await sharp(buf).flatten({ background: '#ffffff' }).toColourspace('b-w').png().toBuffer();
    let rogne = gris;
    try { rogne = await sharp(gris).trim({ threshold: 10 }).png().toBuffer(); } catch (_) { /* image uniforme : gardée entière */ }
    const v = await sharp(rogne).resize(COTE, COTE, { fit: 'contain', background: '#ffffff' }).flatten({ background: '#ffffff' }).toColourspace('b-w').raw().toBuffer();
    if (v.length !== COTE * COTE) throw new Error(`signature : ${v.length} octets, ${COTE * COTE} attendus`);
    return { vecteur: Buffer.from(v).toString('base64') };
}

/** Le vecteur centré réduit (moyenne 0, norme 1) — null pour une image uniforme, qui ne corrèle avec rien. */
function normaliser(b64) {
    const v = Buffer.from(b64, 'base64');
    let m = 0; for (const x of v) m += x; m /= v.length;
    const c = new Float64Array(v.length); let s = 0;
    for (let i = 0; i < v.length; i++) { c[i] = v[i] - m; s += c[i] * c[i]; }
    if (s === 0) return null;
    const n = Math.sqrt(s); for (let i = 0; i < c.length; i++) c[i] /= n;
    return c;
}
function correlation(a, b) {
    if (!a || !b || a.length !== b.length) return -1;
    let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
}
// le vecteur normé de chaque entrée, calculé une fois — gardé À CÔTÉ de l'entrée (jamais écrit sur elle : une entrée gelée lèverait),
// et recalculé si son vecteur a changé (relecture du 2026-09-28)
const CACHE = new WeakMap();
function normeDe(e) {
    const c = CACHE.get(e);
    if (c && c.v === e.vecteur) return c.n;
    const n = normaliser(e.vecteur); CACHE.set(e, { v: e.vecteur, n }); return n;
}

/**
 * Le symbole de l'index le plus proche d'une signature.
 * @param {{entrees: {slug, code, idExpansion, vecteur}[]}} index
 * @param {{vecteur: string}} sig
 * @param {{parmi?: string[]}} options  `parmi` : ne chercher que parmi ces sets (les candidats d'un vivier, par exemple)
 * @returns {{designe: object|null, raison: string, classement: {slug, code, correlation}[]}}
 */
function chercherSymbole(index, sig, { parmi = null } = {}) {
    const q = normaliser(sig.vecteur);
    if (!q) return { designe: null, raison: 'image uniforme : aucun dessin à comparer', classement: [] };
    const pool = parmi ? index.entrees.filter(e => parmi.includes(e.slug)) : index.entrees;
    // le PÉRIMÈTRE de la recherche, dit dans chaque raison (CLAUDE.md, « l'exigence pour toute clé future ») : restreinte à un vivier,
    // une désignation peut être un RESTE (§8) — le vrai set était peut-être hors du vivier
    const perimetre = parmi ? `parmi les ${new Set(pool.map(e => e.slug)).size} sets demandés` : `dans tout l'index (${new Set(index.entrees.map(e => e.slug)).size} sets)`;
    // la meilleure corrélation PAR SET (un set peut avoir deux images : le symbole affiché et celui de ptcg-assets)
    const parSet = new Map();
    for (const e of pool) {
        const r = Math.round(correlation(q, normeDe(e)) * 1000) / 1000;
        const p = parSet.get(e.slug);
        if (!p || r > p.correlation) parSet.set(e.slug, { slug: e.slug, code: e.code, idExpansion: e.idExpansion, correlation: r, sha1: e.sha1 ?? null });
    }
    const classement = [...parSet.values()].sort((a, b) => b.correlation - a.correlation || a.slug.localeCompare(b.slug));
    if (!classement.length) return { designe: null, raison: `aucune image ${perimetre}`, classement };
    const [premier] = classement;
    if (premier.correlation < SEUIL_NON_MESURE) return { designe: null, raison: `aucun symbole à ${SEUIL_NON_MESURE} de corrélation ${perimetre} (le plus proche : ${premier.slug} à ${premier.correlation})`, classement: classement.slice(0, 5) };
    const proches = classement.filter(c => premier.correlation - c.correlation < ECART_NON_MESURE);
    if (proches.length > 1) {
        // deux causes, qui ne se disent pas pareil : le MÊME fichier porté par plusieurs sets (l'étoile PROMO) — le symbole est
        // partagé ; des fichiers DIFFÉRENTS que la signature ne sépare pas (les boîtes de code « sv4a » / « sv6a » de 30×17) — c'est
        // l'instrument qui ne voit pas la différence, pas le monde (relecture du 2026-09-28)
        const memeFichier = premier.sha1 && proches.every(c => c.sha1 === premier.sha1);
        return { designe: null, raison: `${proches.length} sets à moins de ${ECART_NON_MESURE} du premier ${perimetre} (${proches.slice(0, 6).map(c => `${c.slug} ${c.correlation}`).join(', ')}) : ${memeFichier ? 'le même fichier — le symbole est partagé, il ne désigne rien' : 'des symboles différents que la signature 32×32 ne sépare pas — rien n\'est désigné'}`, classement: classement.slice(0, 5) };
    }
    return { designe: premier, raison: `« ${premier.code} » (${premier.slug}) est le SEUL set à ${premier.correlation} ${perimetre} ; le suivant à ${classement[1]?.correlation ?? '—'}`, classement: classement.slice(0, 5) };
}

module.exports = { signatureSymbole, normaliser, normeDe, correlation, chercherSymbole, COTE, SEUIL_NON_MESURE, ECART_NON_MESURE };
