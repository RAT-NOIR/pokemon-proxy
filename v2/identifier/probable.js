'use strict';
// PROBABLE (31/10) — le niveau « probable » : une question dont UN candidat se détache est montrée avec ce candidat en tête, son prix, « à confirmer ». Module PUR (ni base, ni réseau).
// LE SIGNAL A (mesuré, lot PROBABLE-MESURE, 25/10) : le 1er candidat — celui dont le visuel est le plus proche de la photo (cosinus de l'empreinte), puis le moins contredit par la lecture — concorde avec la lecture
// sur AU MOINS UN champ du veto {numéro, total, set TCGdex, langue} et n'est contredit par aucun, ET chacun des autres candidats est contredit par au moins un de ces champs. Jamais d'ex aequo exact en tête.
// Les statuts sont ceux de la PRODUCTION (garde-contradiction.js::statuts, VETOS) : jamais une copie (§21 bis).
// 🔑 UNE QUESTION DE GROUPE (même dessin, marqueur différent : garde-marqueurs.js) ne devient JAMAIS probable par l'image : l'image ne prouve pas un marqueur. `groupe: true` retire le cosinus du classement,
// seule la lecture départage — donc seul un signal réel (la lecture contredit l'autre version) peut la rendre probable.
const GC = require('./garde-contradiction');

const VERSION_MIN_PROBABLE = '2.0.1';
const SIGNAL = 'A';
const EPS = 1e-9;
const COSINUS_MIN_DEFAUT = 0.38;      // la garde retenue sur le RÉGLAGE seul (tour 2) ; la même valeur que le défaut de v2/config.js

/** Les versions « x.y.z » comparées numériquement. null si l'une est illisible (une garde s'écrit par ce qu'elle autorise : illisible = pas servi). */
function versionAuMoins(version, minimum = VERSION_MIN_PROBABLE) {
    const lire = v => { const m = /^(\d{1,4})\.(\d{1,4})\.(\d{1,4})$/.exec(typeof v === 'string' ? v.trim() : ''); return m ? [+m[1], +m[2], +m[3]] : null; };
    const a = lire(version), b = lire(minimum);
    if (!a || !b) return false;
    for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; }
    return true;
}

/**
 * LES GARDES DU COSINUS, UNE SEULE DÉFINITION (decider() et la désignation de G-GROUPE les lisent) : le vecteur est exigé SAUF si `vecteurExige === false` (un cosinus MESURÉ, fini, pour le désigné),
 * et un cosinus connu sous le minimum (0,38 par défaut, un nombre fini de [0, 1] sinon ; 0 explicite = éteint) refuse. Rend vrai SEULEMENT si les deux gardes passent.
 */
function cosinusAdmis(cos, { cosinusMin, vecteurExige } = {}) {
    const exige = vecteurExige !== false, minimum = Number.isFinite(cosinusMin) && cosinusMin >= 0 && cosinusMin <= 1 ? cosinusMin : COSINUS_MIN_DEFAUT;
    const connu = Number.isFinite(cos);
    if (exige && !connu) return false;
    if (minimum > 0 && connu && cos < minimum) return false;
    return true;
}

/**
 * @param ids       les idProduct de la question (2 ou 3)
 * @param produits  Map<idProduct, ligne de catalogue>
 * @param lu        garde-contradiction.lectureDe(corps) (la lecture de la photo), ou null
 * @param cosinus   (idProduct) => number | null — le cosinus photo ↔ visuel du candidat ; absent ou null : pas de visuel comparable
 * @param groupe    vrai pour une question de GROUPE (même dessin) : le cosinus n'entre pas dans le classement
 * @returns null (aucun probable) | { idProduct, signal, contredits }
 */
function decider({ ids, produits, lu, cosinus = null, groupe = false, cosinusMin, vecteurExige } = {}) {
    try {
        // GARDES FERMÉES PAR DÉFAUT (une garde s'écrit par ce qu'elle AUTORISE) : le vecteur est exigé SAUF si `vecteurExige === false` (explicite) ; le seuil est 0,38 SAUF si `cosinusMin` est un nombre fini (0 explicite l'éteint).
        // Un champ absent, null, NaN ou illisible ne lève jamais une garde.
        if (!lu || !Array.isArray(ids) || ids.length < 2 || ids.length > 3 || !ids.every(Number.isInteger) || new Set(ids).size !== ids.length || !(produits instanceof Map)) return null;
        const cands = ids.map(id => {
            const ligne = produits.get(id) || null, st = ligne ? GC.statuts(lu, ligne) : null;
            let ok = 0, ko = 0;
            if (st) for (const k of GC.VETOS) { if (st[k] === 'ok') ok++; else if (st[k] === 'ko') ko++; }
            const c = groupe || typeof cosinus !== 'function' ? null : cosinus(id);
            return { id, cos: Number.isFinite(c) ? c : null, ok, ko };
        });
        const cle = c => [c.cos === null ? -Infinity : c.cos, -c.ko, c.ok];
        const cmp = (a, b) => {
            const ka = cle(a), kb = cle(b);
            for (let i = 0; i < 3; i++) {
                const da = ka[i], db = kb[i];
                if (da === db) continue;
                if (i === 0 && Number.isFinite(da) && Number.isFinite(db) && Math.abs(da - db) < EPS) continue;
                return db - da;
            }
            return 0;
        };
        const tri = [...cands].sort(cmp);
        const [premier, second] = tri;
        if (cmp(premier, second) === 0) return null;                                       // ex aequo exact en tête : aucun candidat ne se détache
        if (!(premier.ko === 0 && premier.ok >= 1)) return null;                           // la lecture concorde avec le 1er et ne le contredit pas
        if (!tri.slice(1).every(c => c.ko >= 1)) return null;                              // ... et contredit TOUS les autres
        // VECTEUR EXIGÉ (un probable demande un cosinus MESURÉ pour le 1er candidat, sinon la question reste réservée) ET COSINUS MINIMAL (un 1er candidat dont le visuel est trop loin de la photo n'est pas désigné) : cosinusAdmis
        if (!cosinusAdmis(premier.cos, { cosinusMin, vecteurExige })) return null;
        return { idProduct: premier.id, signal: SIGNAL, contredits: tri.slice(1).map(c => c.id), detail: { nCand: cands.length, ok: premier.ok, ko: premier.ko, cosPremier: premier.cos, cosSecond: second.cos } };
    } catch { return null; }
}

/** Les cosinus des candidats : `cosinus(id)` à partir d'une fonction de similarité de l'index en place. null partout si la photo n'est pas redressée (comme la mesure) ou sans vecteur. */
function cosinusDes({ ids, cles, similarites, redressee }) {
    if (redressee !== true || typeof similarites !== 'function' || !(cles instanceof Map)) return () => null;
    const ordre = [...new Set(ids.map(id => cles.get(id)).filter(c => typeof c === 'string' && c))];
    if (!ordre.length) return () => null;
    const r = similarites(ordre), par = new Map(ordre.map((c, i) => [c, r[i]]));
    return id => { const c = cles.get(id); return par.has(c) ? par.get(c) : null; };
}

module.exports = { decider, cosinusDes, cosinusAdmis, versionAuMoins, VERSION_MIN_PROBABLE, SIGNAL };
