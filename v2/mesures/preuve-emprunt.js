'use strict';
// PREUVE-EMPRUNT (GUICHET, passage 8) — la PREUVE À L'IMAGE des tamponnées servies empruntées (admission D, PROPOSITION-TAMPONNEES.md §3). Module pur : entrées = mesures ; le réseau et le cache sont INJECTÉS.
//
// LA RÈGLE (celle des emprunts déjà classés, e14-classes-orb.js, inchangée) : l'image refusée est comparée à CHACUN des autres scans de la même carte. Un scan CONCORDE si la fenêtre d'illustration donne
// >= 30 inliers (ORB + RANSAC de departage-image.js) OU si le cosinus p8000 est >= 0,9 ; il CONTREDIT si la fenêtre donne <= 15 inliers ET cosinus < 0,7 (ou inconnu) ; sinon il HÉSITE.
//   « meme » (admise) : TOUS les scans concordent · « different » : tous contredisent · tout le reste : indécidable (aucune référence, une référence sans aucune mesure, mixte, hésitante).
// LA 3e CONCORDANCE (un « hésitant » n'est admis que si elle passe) : la zone SOUPLE du catalogue — pHash <= 6 ET ORB >= 30 sur les images entières (catalogue : collecte-cartes/concordance-image.js, SEUIL_SOUPLE,
// calibrée par calibrer-concordance.js le 2026-10-25) — contre CHAQUE référence qui ne concorde pas déjà. Le pHash (DCT globale) est indépendant du cosinus (réseau) et de la fenêtre ORB ; elle ne rattrape jamais
// un mixte ni un « different ».
// LA LECTURE D'UNE IMAGE MANQUANTE : sur le bucket PUBLIC R2 de nos visuels, par sa cleR2, comme le fait l'extension (config.js, images.hotesPublics) ; jamais une image Cardmarket, jamais un hôte qui n'est pas
// dans la liste, jamais une clé qui sort du bucket. Un échec (404, défi HTML, réseau, taille) rend null : « non mesurable », jamais une exception.
const SEUILS = Object.freeze({ inliersConcorde: 30, cosConcorde: 0.9, inliersContredit: 15, cosContredit: 0.7 });
const SEUIL_SOUPLE = Object.freeze({ phashMax: 6, inliersMin: 30 });
const HOTES_PUBLICS = Object.freeze(['pub-7d992e666c3d4a2b870b680a920045b6.r2.dev']);
const OCTETS_MAX = 8 * 1024 * 1024;

const fini = x => typeof x === 'number' && Number.isFinite(x);
// I3 (relecture p8, tour 2) : la preuve se DURCIT — la jambe « fenêtre ORB » ne suffit plus seule : le cosinus p8000 ne doit pas être CONTRAIRE (< cosContredit) contre ce scan. Un cosinus inconnu (scan absent de
// l'index) n'est pas contraire ; la jambe « cosinus >= 0,9 » le satisfait d'elle-même. La 3e concordance ne rattrape JAMAIS un scan au cosinus contraire.
const cosinusContraire = m => fini(m.cos) && m.cos < SEUILS.cosContredit;
const concorde = m => ((fini(m.fen) && m.fen >= SEUILS.inliersConcorde) || (fini(m.cos) && m.cos >= SEUILS.cosConcorde)) && !cosinusContraire(m);
const contredit = m => fini(m.fen) && m.fen <= SEUILS.inliersContredit && (!fini(m.cos) || m.cos < SEUILS.cosContredit);
const mesurable = m => fini(m.fen) || fini(m.cos);

/** @returns {{ classe: 'meme'|'different'|'indecidable', detail: string, sous: string }} */
function classer(mesures) {
    if (!Array.isArray(mesures) || !mesures.length) return { classe: 'indecidable', detail: 'sans-reference', sous: 'la carte n\'a aucun autre scan' };
    if (!mesures.every(mesurable)) return { classe: 'indecidable', detail: 'non-mesurable', sous: 'un scan de référence non mesurable' };
    if (mesures.every(concorde)) return { classe: 'meme', detail: 'concordante', sous: `tous les scans de référence (${mesures.length}) concordent` };
    if (mesures.every(contredit)) return { classe: 'different', detail: 'contredite', sous: `tous les scans de référence (${mesures.length}) contredisent` };
    if (mesures.some(contredit)) return { classe: 'indecidable', detail: 'mixte', sous: 'mixte : la carte porte plusieurs dessins' };
    return { classe: 'indecidable', detail: 'hesitante', sous: 'mesure hésitante (ni concordance ni contradiction nette)' };
}

/** La zone souple du catalogue. @param m { phash, inliers } (nombres finis) — toute autre chose ne concorde jamais. */
function troisiemeConcordance(m) {
    return Boolean(m) && fini(m.phash) && fini(m.inliers) && m.phash <= SEUIL_SOUPLE.phashMax && m.inliers >= SEUIL_SOUPLE.inliersMin;
}

/** `classer`, puis la 3e concordance pour le seul cas « hésitante » : chaque référence qui ne concorde pas déjà doit la passer (`tierce` : { phash, inliers } mesurés sur les images entières). */
function classerAvecTroisieme(mesures) {
    const base = classer(mesures);
    if (base.detail !== 'hesitante') return base;
    const aVerifier = mesures.filter(m => !concorde(m));
    if (aVerifier.every(m => !cosinusContraire(m) && troisiemeConcordance(m.tierce)))
        return { classe: 'meme', detail: 'hesitante-3e', sous: `hésitant admis par la 3e concordance (zone souple du catalogue : pHash <= ${SEUIL_SOUPLE.phashMax} ET ORB >= ${SEUIL_SOUPLE.inliersMin}) contre ${aVerifier.length} référence(s), les autres (${mesures.length - aVerifier.length}) concordent` };
    return { ...base, sous: base.sous + ' ; la 3e concordance échoue ou manque' };
}

const CLE_OK = /^[A-Za-z0-9][A-Za-z0-9._\-\/+ ]*$/;
const cleValide = cle => typeof cle === 'string' && cle.length > 0 && cle.length <= 300 && CLE_OK.test(cle) && !cle.includes('..') && !cle.includes('//');
const pause = ms => new Promise(r => setTimeout(r, ms));

/**
 * Une image de nos visuels, par sa cleR2 : le cache d'abord, puis le bucket public. @param opts { fetch, cache: { lire(cle) -> Buffer|null, ecrire(cle, Buffer) }, attenteMs = 1000, hote }
 * @returns {Promise<Buffer|null>} Ne lève jamais.
 */
async function lireImage(cle, { fetch: f = globalThis.fetch, cache = null, attenteMs = 1000, hote = HOTES_PUBLICS[0] } = {}) {
    try {
        if (!cleValide(cle) || !HOTES_PUBLICS.includes(hote) || typeof f !== 'function') return null;
        if (cache) { const c = await cache.lire(cle); if (Buffer.isBuffer(c) && c.length) return c; }
        if (attenteMs > 0) await pause(attenteMs);
        const r = await f(`https://${hote}/${cle.split('/').map(encodeURIComponent).join('/')}`, { redirect: 'error' });      // M5 : une redirection échoue (l'hôte n'est vérifié que sur l'adresse de départ)
        if (!r || !r.ok || r.status !== 200) return null;
        const type = String(r.headers && r.headers.get ? r.headers.get('content-type') || '' : '');
        if (!/^image\//i.test(type)) return null;
        const annonce = Number(r.headers && r.headers.get ? r.headers.get('content-length') : NaN);
        if (Number.isFinite(annonce) && annonce > OCTETS_MAX) return null;          // M5 : la taille annoncée est bornée AVANT la lecture complète
        const b = Buffer.from(await r.arrayBuffer());
        if (!b.length || b.length > OCTETS_MAX) return null;
        if (cache) await cache.ecrire(cle, b);
        return b;
    } catch { return null; }
}

module.exports = { SEUILS, SEUIL_SOUPLE, HOTES_PUBLICS, OCTETS_MAX, classer, troisiemeConcordance, classerAvecTroisieme, lireImage, cleValide };
