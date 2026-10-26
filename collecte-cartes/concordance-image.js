'use strict';
// ============================================================
// CONCORDANCE PAR L'IMAGE — « règle du 0 faux par l'image » (testeur, 2026-10-25)
// ============================================================
// Un visuel n'entre au catalogue que si DEUX sources indépendantes concordent À L'IMAGE (ou si une source concorde avec un vrai scan déjà conforme).
// Ce module est PUR : entrées = Buffers d'images, aucun réseau, aucune base. Il rend un verdict à trois états :
//   true  = concordent ; false = ne concordent pas ; null = « je ne sais pas » (illisible, trop petit…) — jamais « oui ».
// LIMITE ASSUMÉE : même illustration, tirage différent — l'image ne PEUT PAS trancher (voir calibrer-concordance.js, classe « meme-dessin-autre-tirage »).
//
// pHash : REPRODUCTION de l'algorithme de la bibliothèque Python imagededup (PHash) — imagededup n'est pas installable ici (Python 3.14, dépendance torch) :
// niveaux de gris, 32x32, DCT 2D (non normalisée, comme scipy.fftpack.dct), bloc 8x8 en haut à gauche, comparaison à la médiane des 64 coefficients, 64 bits, 16 caractères hexa.
const sharp = require('sharp');
const D = require('../departage-image');   // decrire / inliers : réutilisés tels quels (libération des objets OpenCV incluse), RIEN n'en est recopié

// ── SEUILS : viennent de la calibration (calibrer-concordance.js), jamais d'une supposition. ──
// SOURCE : calibrer-concordance.js, 2026-10-25, graine 20261025, base `cartes` (lecture) + R2 de nos visuels : 81 174 visuels images/etat ok, 18 460 clés (carte, set, numéro) à deux sources ou plus.
// Paires inter-sources : 300 positifs, 300 négatifs ordinaires (0 faux), 300 négatifs durs « autre illustration » (0 faux), 300 « même illustrateur, autre tirage » (40 acceptés : limite de l'instrument, voir ci-dessous).
// Retenu : ni pHash seul ni ORB seul n'atteignent 0 faux sans perdre davantage ; les deux ensemble, au plus strict sans faux : 131 vrais acceptés sur 300, 169 perdus (dont une part de faux positifs d'étiquette : scan japonais rangé sous un set occidental).
// ⚠️ « Même dessin, autre tirage » (réimpression, version japonaise du même dessin) : l'image NE PEUT PAS trancher — 40/300 de ces paires concordent même à ce seuil. Une concordance d'image prouve le dessin, jamais le tirage.
const SEUILS = {
    calibre: true, source: 'calibrer-concordance.js 2026-10-25 : 300 positifs / 300 ordinaires / 300 durs-illustration / 300 meme-dessin',
    phashMax: 2,        // distance de Hamming maximale
    inliersMin: 40,     // points d'appui ORB minimaux
    exiger: 'les-deux'  // 'les-deux' | 'phash' | 'orb' : un seul critère ne suffit que si la calibration montre 0 faux (elle ne le montre pas)
};
const TAILLE_MIN = 16;  // pixels : en dessous, ni pHash ni ORB ne disent rien

function dct1d(v) {
    const n = v.length, out = new Array(n);
    for (let k = 0; k < n; k++) { let s = 0; for (let i = 0; i < n; i++) s += v[i] * Math.cos(Math.PI * k * (2 * i + 1) / (2 * n)); out[k] = 2 * s; }
    return out;
}
async function phash(buf) {
    const { data } = await sharp(buf).greyscale().resize(32, 32, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
    const lignes = []; for (let y = 0; y < 32; y++) lignes.push(Array.from(data.subarray(y * 32, y * 32 + 32)));
    const l1 = lignes.map(dct1d);                                   // DCT sur chaque ligne
    const d = Array.from({ length: 32 }, () => new Array(32));
    for (let x = 0; x < 32; x++) { const col = dct1d(l1.map(r => r[x])); for (let y = 0; y < 32; y++) d[y][x] = col[y]; }   // puis sur chaque colonne
    const bloc = []; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bloc.push(d[y][x]);
    const tri = [...bloc].sort((a, b) => a - b), med = (tri[31] + tri[32]) / 2;
    let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bloc.slice(i, i + 4).map(c => (c > med ? 1 : 0)).join(''), 2).toString(16);
    return hex;
}
function distanceHamming(h1, h2) {
    if (typeof h1 !== 'string' || typeof h2 !== 'string' || h1.length !== h2.length) throw new Error('distanceHamming : deux hachages de même longueur attendus');
    let n = 0;
    for (let i = 0; i < h1.length; i++) { let x = parseInt(h1[i], 16) ^ parseInt(h2[i], 16); while (x) { n += x & 1; x >>= 1; } }
    return n;
}
async function orbInliers(bufA, bufB) {
    const { cv } = await D.outils();
    const a = await D.decrire(bufA), b = await D.decrire(bufB);
    return D.inliers(cv, a, b);
}
async function lisible(buf) {
    if (!Buffer.isBuffer(buf) || !buf.length) return false;
    try { const m = await sharp(buf).metadata(); return Boolean(m.width && m.height && m.width >= TAILLE_MIN && m.height >= TAILLE_MIN); } catch { return false; }
}
/** @returns {Promise<{concorde: true|false|null, phash: number|null, inliers: number|null, raison: string}>} */
async function concordent(a, b, seuils = {}) {
    const S = { ...SEUILS, ...seuils };
    if (!(await lisible(a)) || !(await lisible(b))) return { concorde: null, phash: null, inliers: null, raison: 'image illisible ou trop petite : je ne sais pas' };
    let ph, inl;
    try { ph = distanceHamming(await phash(a), await phash(b)); inl = await orbInliers(a, b); }
    catch (e) { return { concorde: null, phash: null, inliers: null, raison: `calcul impossible (${e.message}) : je ne sais pas` }; }
    const okPh = ph <= S.phashMax, okOrb = inl >= S.inliersMin;
    const accepte = S.exiger === 'phash' ? okPh : S.exiger === 'orb' ? okOrb : (okPh && okOrb);
    return { concorde: accepte, phash: ph, inliers: inl, raison: `pHash ${ph} (max ${S.phashMax}) ${okPh ? 'ok' : 'non'} ; ORB ${inl} (min ${S.inliersMin}) ${okOrb ? 'ok' : 'non'} ; exigé : ${S.exiger}` };
}

// ============================================================
// CASCADE DE DÉCISION (testeur, 2026-10-25 21:45) — deciderVisuel : aucune E/S, aucune écriture ; elle DÉCIDE, un autre outil écrit.
// ============================================================
// SEUILS NOMMÉS. Source des deux : calibrer-concordance.js, 2026-10-25, graine 20261025, 300 paires inter-sources par classe (voir SEUILS plus haut).
// ⚠️ MARGE : le pHash minimum des négatifs durs (« autre illustration ») vaut 2, ÉGAL au seuil : il n'y a aucune marge sous ce seuil. À (pHash 2, ORB 30) la calibration montre déjà un faux (les paires « autre illustration » à pHash 2 et ORB 35 sont des étiquettes fausses, mais l'instrument ne le sait pas).
// « 0 faux sur 300 » ne borne le taux de faux qu'à ~1 % (règle de trois : 3/300) : ce n'est PAS un taux nul, d'où les DEUX sources et le tirage vérifié avant l'image.
const SEUIL_STRICT = { phashMax: 2, inliersMin: 40 };   // retenu par la calibration : 0 faux ordinaire, 0 faux « autre illustration », 169/300 vrais perdus
const SEUIL_SOUPLE = { phashMax: 6, inliersMin: 30 };   // variante souple de la calibration : 93/300 perdus, 0 faux ordinaire, 2 « autre illustration » apparents = erreurs d'étiquette des sources (ERREURS-SOURCES.md) — d'où la TROISIÈME concordance exigée
const MOTIFS_TROU = Object.freeze(['aucune-source', 'une-seule-source', 'discordance-image', 'tirage-different', 'illisible']);
const { cleNumero } = require('./jointure');            // la clé de numéro de la production, jamais recopiée

const norm = (s) => (s == null || String(s).trim() === '' ? null : String(s).trim().toLowerCase());
/**
 * MÊME TIRAGE. Le produit fait foi ; le candidat n'est retenu que s'il est d'accord.
 *  - langue : doit être ÉGALE. Un champ ABSENT (côté candidat OU produit) EXCLUT : « je ne sais pas » n'est pas « oui ».
 *  - numéro, code de set : comparés (cleNumero / minuscules) quand les DEUX côtés les portent ; une contradiction exclut. Absent d'un côté = ne contredit pas, mais ne compte pas comme un accord. Il faut AU MOINS UN accord positif (numéro égal OU code égal) : langue seule = exclu (décision du coordinateur, 2026-10-25).
 *  - tampon : ÉGAL des deux côtés (décision du coordinateur, 2026-10-25). Produit tamponné : le candidat doit porter le même, muet = exclu. Produit SANS tampon : un candidat qui DÉCLARE un tampon est exclu ; un candidat muet reste admis (la plupart des sources ne déclarent rien).
 *  - réserves acceptées : une troisième concordance vient d'une source distincte des deux premières, reliée à l'une des deux seulement ; deux scans conformes de même source ne sont pas indépendants ; un JPEG q90 d'un aplat synthétique donne pHash 4 (« souple »), le banc utilise donc un WebP lossless pour le cas strict.
 */
function memeTirage(produit, t = {}) {
    const lp = norm(produit?.langue), lc = norm(t.langue);
    if (!lp || !lc || lp !== lc) return false;
    const aNum = produit.numero != null && String(produit.numero).trim() !== '' && t.numero != null && String(t.numero).trim() !== '';
    const aCode = norm(produit.codeSet) && norm(t.codeSet);
    if (aNum && cleNumero(produit.numero) !== cleNumero(t.numero)) return false;
    if (aCode && norm(produit.codeSet) !== norm(t.codeSet)) return false;
    if (!aNum && !aCode) return false;   // la langue est NÉCESSAIRE, pas SUFFISANTE : il faut au moins un accord POSITIF (numéro égal par cleNumero, ou code de set égal)
    if (norm(produit.tampon) !== norm(t.tampon)) return false;   // tampon ÉGAL des deux côtés ; muet des deux côtés (null = null) reste admis
    return true;
}
async function mesurerParDefaut(a, b) {
    if (a.empreintes?.phash && b.empreintes?.phash && a.empreintes.orb && b.empreintes.orb) {   // empreintes précalculées : { phash, orb: résultat de decrire() }
        const { cv } = await D.outils();
        return { phash: distanceHamming(a.empreintes.phash, b.empreintes.phash), inliers: D.inliers(cv, a.empreintes.orb, b.empreintes.orb) };
    }
    const m = await concordent(a.buf, b.buf, { phashMax: 64, inliersMin: 0 });
    return m.concorde === null ? null : { phash: m.phash, inliers: m.inliers };
}
const niveau = (m) => (m.phash <= SEUIL_STRICT.phashMax && m.inliers >= SEUIL_STRICT.inliersMin ? 'strict' : (m.phash <= SEUIL_SOUPLE.phashMax && m.inliers >= SEUIL_SOUPLE.inliersMin ? 'souple' : 'non'));

/**
 * @param {{produit:{langue,codeSet,numero,tampon}, candidats:Array<{source:string, buf?:Buffer, empreintes?:object, tirage:object}>, scansConformes?:Array<{buf?:Buffer, empreintes?:object, source?:string}>}} e
 * @param {{comparer?: (x,y)=>Promise<{phash:number,inliers:number}|null>}} [opts]  comparer injectable (bancs)
 * @returns {Promise<{decision:'ecrire'|'a-confirmer'|'trou', motif?:string, preuve:object}>}
 */
async function deciderVisuel({ produit, candidats = [], scansConformes = [] }, opts = {}) {
    const comparer = opts.comparer || mesurerParDefaut;
    // SOURCE normalisée (trim + minuscules) : « a » et « A  » sont la même source. Une source vide, absente ou non textuelle rend le candidat / le scan INADMISSIBLE (compté).
    const src = (s) => (typeof s === 'string' && s.trim() !== '' ? s.trim().toLowerCase() : null);
    const sansSource = candidats.filter(c => !src(c.source)).length;
    const admis = candidats.filter(c => src(c.source) && memeTirage(produit, c.tirage));
    const exclusTirage = candidats.length - sansSource - admis.length;
    // un scan conforme est soumis à la MÊME règle que les candidats : source lisible, tirage déclaré et accordé avec le produit ; sinon ignoré et compté
    const scansAdmis = scansConformes.filter(s => src(s.source) && s.tirage && memeTirage(produit, s.tirage));
    const preuve = { exclusTirage, sourcesInadmissibles: sansSource, candidats: candidats.length, admis: admis.length, scansConformes: scansAdmis.length, scansExclus: scansConformes.length - scansAdmis.length, paires: [] };
    // nœuds : candidats admis + scans conformes admis ; la source d'un nœud est sa source BRUTE normalisée (un scan de la même source qu'un candidat n'en est pas indépendant)
    const noeuds = [...admis.map((c, i) => ({ ref: c, source: src(c.source), conforme: false, nom: `c${i}` })), ...scansAdmis.map((s, i) => ({ ref: s, source: src(s.source), conforme: true, nom: `z${i}` }))];
    if (!candidats.length) return { decision: 'trou', motif: 'aucune-source', preuve };
    if (!admis.length || (new Set(admis.map(c => src(c.source))).size < 2 && !scansAdmis.length))
        return { decision: 'trou', motif: exclusTirage ? 'tirage-different' : 'une-seule-source', preuve };
    // arêtes : candidat–candidat de sources différentes, candidat–scan conforme (jamais scan–scan)
    const aretes = []; let illisibles = 0, comparees = 0;
    for (let i = 0; i < noeuds.length; i++) for (let j = i + 1; j < noeuds.length; j++) {
        const x = noeuds[i], y = noeuds[j];
        if (x.conforme && y.conforme) continue;
        if (x.source === y.source) continue;                               // deux fois la même source n'est pas une concordance indépendante
        const m = await comparer(x.ref, y.ref); comparees++;
        // GARDE DES MESURES : seul un NOMBRE FINI est une mesure (une chaîne, null, NaN, Infinity n'en sont pas) ; sinon « je ne sais pas », jamais « ecrire »
        if (!m || typeof m.phash !== 'number' || typeof m.inliers !== 'number' || !Number.isFinite(m.phash) || !Number.isFinite(m.inliers)) { illisibles++; continue; }
        const n = niveau(m); preuve.paires.push({ a: x.nom, b: y.nom, phash: m.phash, inliers: m.inliers, niveau: n });
        if (n !== 'non') aretes.push({ x, y, n });
    }
    // 1. une arête STRICTE (deux sources indépendantes, ou une source et un vrai scan conforme) suffit
    const stricte = aretes.find(a => a.n === 'strict');
    // `paireSources` (ADDITIF, comblement nocturne) : les deux CODES SOURCE de la paire retenue (sources normalisées) ; `paire` ne porte que des noms internes (c0, z0) qui indexent les candidats ADMIS
    if (stricte) return { decision: 'ecrire', preuve: { ...preuve, regle: 'strict', paire: [stricte.x.nom, stricte.y.nom], paireSources: [stricte.x.source, stricte.y.source] } };
    // 2. une arête SOUPLE exige une TROISIÈME concordance (au moins souple) : un nœud d'une troisième source, relié à l'un des deux
    for (const a of aretes) {
        const tierce = aretes.find(b => b !== a && [b.x, b.y].some(n => n === a.x || n === a.y)
            && [b.x, b.y].some(n => n !== a.x && n !== a.y && n.source !== a.x.source && n.source !== a.y.source));
        if (tierce) return { decision: 'ecrire', preuve: { ...preuve, regle: 'souple+tierce', paire: [a.x.nom, a.y.nom], paireSources: [a.x.source, a.y.source], tierce: [tierce.x.nom, tierce.y.nom] } };
    }
    if (aretes.length) return { decision: 'a-confirmer', preuve: { ...preuve, regle: 'souple-seule', paire: [aretes[0].x.nom, aretes[0].y.nom] } };
    return { decision: 'trou', motif: comparees && illisibles === comparees ? 'illisible' : 'discordance-image', preuve };
}

module.exports = { phash, distanceHamming, orbInliers, concordent, SEUILS, TAILLE_MIN, deciderVisuel, memeTirage, SEUIL_STRICT, SEUIL_SOUPLE, MOTIFS_TROU };
