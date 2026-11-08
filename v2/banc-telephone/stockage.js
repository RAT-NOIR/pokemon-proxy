'use strict';
// BANC-TELEPHONE — la validation (liste FERMÉE de champs, à chaque niveau) et le stockage BORNÉ des résultats.
// Rien de personnel : ni IP, ni identifiant de compte ; l'agent utilisateur (ASCII imprimable, 300 caractères au plus) est la seule donnée de l'appareil, avec des mesures.
// Le stockage vit dans la base de l'essai (v2/db.js : la base du service, jamais la production — et le montage n'existe que sur le service d'essai, voir garde.js).
const { col } = require('../db');

const OCTETS_MAX = 8192, DOCUMENTS_MAX = 200, COLLECTION = 'banc_telephone';
const ASCII = /^[\x20-\x7E]*$/;

// Chaque règle rend true si la valeur est permise. Une clé absente de la spec = refusée.
const entier = (min, max) => v => Number.isInteger(v) && v >= min && v <= max;
const nombre = (min, max) => v => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const chaine = max => v => typeof v === 'string' && v.length <= max && ASCII.test(v);
const booleen = v => typeof v === 'boolean';
const parmi = (...vals) => v => vals.includes(v);
const ouNul = r => v => v === null || r(v);
const hexN = n => v => typeof v === 'string' && new RegExp(`^[0-9a-f]{${n}}$`).test(v);
function objetSimple(o) { return o !== null && typeof o === 'object' && !Array.isArray(o); }

const MESURE = {
    moteur: parmi('wasm', 'webgpu'), verdict: parmi('IDENTIQUE', 'ECART', 'ERREUR'),
    fils: ouNul(entier(0, 64)), filsDemandes: ouNul(entier(0, 64)),
    creationSessionMs: ouNul(nombre(0, 1e7)), premiereMs: ouNul(nombre(0, 1e7)), medianeMs: ouNul(nombre(0, 1e7)), p95Ms: ouNul(nombre(0, 1e7)), pretraitementMedianeMs: ouNul(nombre(0, 1e7)),
    nEmpreintes: ouNul(entier(0, 100)), nVecteursRefuses: ouNul(entier(0, 100)),
    cosMin: ouNul(nombre(-1, 1.0001)), cosMoy: ouNul(nombre(-1, 1.0001)), cosMinModeleSeul: ouNul(nombre(-1, 1.0001)), nModeleSeul: ouNul(entier(0, 100)),
    cosMinContreWasm: ouNul(nombre(-1, 1.0001)),
    jsHeapApresCreationMo: ouNul(nombre(0, 1e5)), jsHeapFinMo: ouNul(nombre(0, 1e5)), uaApresCreationMo: ouNul(nombre(0, 1e5)), uaFinMo: ouNul(nombre(0, 1e5)),
    erreur: ouNul(chaine(200))
};
const GPU = { vendor: chaine(40), architecture: chaine(40) };
const RACINE = {
    v: v => v === 1, runId: hexN(16), modeleSha: hexN(64), ua: chaine(300),
    isole: booleen, coeurs: ouNul(entier(1, 1024)), memoireAppareilGo: ouNul(nombre(0, 1024)),
    gpuDispo: booleen, gpu: ouNul(objetSimple), decodeurOptions: ouNul(booleen),
    modeleOctets: ouNul(entier(0, 2e9)), telechargementMs: ouNul(nombre(0, 1e8)), verifShaMs: ouNul(nombre(0, 1e8)), shaVerifie: ouNul(booleen),
    mesure: objetSimple
};

/** Contrôle `o` contre `spec` ; rend le nom du premier défaut (« champ-inconnu:x », « champ:x »…) ou null. */
function defaut(o, spec, ou = '') {
    if (!objetSimple(o)) return `forme${ou ? ':' + ou : ''}`;
    for (const k of Object.keys(o)) if (!Object.prototype.hasOwnProperty.call(spec, k)) return `champ-inconnu:${ou}${k}`;
    for (const [k, regle] of Object.entries(spec)) {
        if (!(k in o)) continue;                                         // un champ absent est permis (une mesure en erreur n'a pas tout) ; `v`, `runId`, `modeleSha`, `ua`, `mesure` sont exigés plus bas
        if (typeof regle === 'function' && !regle(o[k])) return `champ:${ou}${k}`;
    }
    return null;
}
/** @returns {{ok: true, doc: object} | {ok: false, detail: string}} — jamais d'exception, jamais de valeur d'entrée dans le détail. */
function valider(corps) {
    if (!objetSimple(corps)) return { ok: false, detail: 'forme' };
    let taille; try { taille = Buffer.byteLength(JSON.stringify(corps), 'utf8'); } catch { return { ok: false, detail: 'forme' }; }
    if (taille > OCTETS_MAX) return { ok: false, detail: 'trop-gros' };
    let d = defaut(corps, RACINE); if (d) return { ok: false, detail: d };
    for (const k of ['v', 'runId', 'modeleSha', 'ua', 'mesure']) if (!(k in corps)) return { ok: false, detail: `manque:${k}` };
    if (corps.gpu !== null && corps.gpu !== undefined) { d = defaut(corps.gpu, GPU, 'gpu.'); if (d) return { ok: false, detail: d }; }
    d = defaut(corps.mesure, MESURE, 'mesure.'); if (d) return { ok: false, detail: d };
    for (const k of ['moteur', 'verdict']) if (!(k in corps.mesure)) return { ok: false, detail: `manque:mesure.${k}` };
    return { ok: true, doc: corps };
}

/**
 * Stocke le document puis RAMÈNE la collection à DOCUMENTS_MAX au plus (le plus ancien est remplacé : on retire les plus anciens par `_id`).
 * Le retrait se fait après l'insertion : deux dépôts simultanés peuvent dépasser un instant la borne, jamais durablement.
 */
async function stocker(doc, { max = DOCUMENTS_MAX, maintenant = new Date(), collection = col(COLLECTION) } = {}) {
    const r = await collection.insertOne({ ...doc, recuLe: maintenant });
    const n = await collection.countDocuments({});
    if (n > max) {
        const anciens = await collection.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(n - max).toArray();
        if (anciens.length) await collection.deleteMany({ _id: { $in: anciens.map(a => a._id) } });
    }
    return String(r.insertedId);
}

module.exports = { valider, stocker, OCTETS_MAX, DOCUMENTS_MAX, COLLECTION, MESURE, RACINE };
