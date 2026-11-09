'use strict';
// BANC-TELEPHONE — la validation (liste FERMÉE de champs, à chaque niveau) et le stockage BORNÉ des résultats.
// Rien de personnel : ni IP, ni identifiant de compte ; l'agent utilisateur (ASCII imprimable, 300 caractères au plus) est la seule donnée de l'appareil, avec des mesures.
// Le stockage vit dans la base de l'essai (v2/db.js : la base du service, jamais la production — et le montage n'existe que sur le service d'essai, voir garde.js).
const { col } = require('../db');
const { BASE_ESSAI } = require('./garde');

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
    ecartChaineModele: ouNul(nombre(-2, 2)),                                       // m3 : cosMinModeleSeul − cosMin (le décodeur et le redimensionnement du navigateur, séparés du modèle)
    webgpuUtilise: ouNul(booleen),                                                 // M7 : ort.env.webgpu.device non nul après création de la session
    gardeExtension: ouNul(parmi('PASSE', 'ECHOUE', 'NON_EVALUEE')),                // M8 : cosinus >= 0,998 (la garde de l'extension)
    jsHeapApresCreationMo: ouNul(nombre(0, 1e5)), jsHeapFinMo: ouNul(nombre(0, 1e5)), uaApresCreationMo: ouNul(nombre(0, 1e5)), uaFinMo: ouNul(nombre(0, 1e5)),
    erreur: ouNul(chaine(200)),
    // lot iOS : WebGPU demandé puis désactivé sur iOS (le moteur déposé est celui qui a servi), forcé par ?webgpu=forcer, options de session demandées (diagnostic mémoire), et le diagnostic des pixels
    moteurDemande: ouNul(parmi('wasm', 'webgpu')), webgpuDesactive: ouNul(booleen), webgpuForce: ouNul(booleen), optionsSession: ouNul(chaine(60)),
    diagnosticPixels: ouNul(objetSimple),
    // décodeur Rat-Market : le chemin qui a servi d'entrée au modèle (rm / mixte / navigateur), ses refus, le témoin du navigateur, et l'orientation EXIF des WebP/JPEG vue par ce navigateur
    entree: ouNul(objetSimple), orientationNavigateur: ouNul(objetSimple),
    // test de detection deterministe (detection-page.mjs) : liste fermee, comptes et durees
    detection: ouNul(objetSimple),
    // test des grandes photos (grandes-page.mjs) : jusqu'a 6 photos par depot, des empreintes SHA-256 et des nombres, jamais une image
    grandesPhotos: ouNul(objetSimple)
};
const GRANDES = { version: chaine(30), photos: v => Array.isArray(v) && v.length >= 1 && v.length <= 6 };
const GRANDE_PHOTO = {
    sha256Fichier: hexN(64), format: parmi('jpeg', 'png', 'webp', 'heic', 'autre'), octets: entier(0, 1e9), largeur: ouNul(entier(0, 100000)), hauteur: ouNul(entier(0, 100000)), orientation: ouNul(entier(1, 8)),
    prereduit: ouNul(booleen), voie: ouNul(parmi('canvas-high', 'pillow')), rm: objetSimple, nav: objetSimple, ecartQuadPct: ouNul(nombre(0, 1000)), memeQuad: ouNul(booleen)
};
const GRANDE_MOTEUR = { ok: booleen, code: ouNul(chaine(30)), redressee: booleen, nCartes: entier(0, 100), rgb640: ouNul(hexN(64)), quads: ouNul(hexN(64)), carte: ouNul(hexN(64)), dim640: ouNul(chaine(12)), ms: ouNul(nombre(0, 1e7)) };
const DETECTION = {
    version: chaine(30), nImages: entier(0, 100), nIdentiques: entier(0, 100), nRgb640: entier(0, 100), nQuads: entier(0, 100), nCartes: entier(0, 100), voieCanvas: entier(0, 100), voiePillow: entier(0, 100),
    ecarts: chaine(200), empreinteLot: ouNul(hexN(64)), msOpencv: ouNul(nombre(0, 1e7)), msMediane: ouNul(nombre(0, 1e7)), msTotal: ouNul(nombre(0, 1e7)),
    jsHeapMo: ouNul(nombre(0, 1e5)), jsHeapApresMo: ouNul(nombre(0, 1e5)), wasmHeapMo: ouNul(nombre(0, 1e5)), erreur: ouNul(chaine(200))
};
const STAT = { n: entier(0, 1e8), max: entier(0, 255), somme: entier(0, 1e11), nDiff: entier(0, 1e8), moy: nombre(0, 255), pctDiff: nombre(0, 100) };
const DIAGNOSTIC = {
    cause: parmi('decodeur', 'autre-etape', 'aucune', 'non-etablie', 'indetermine'), cartesDecodage: entier(0, 100), cartesChaine: entier(0, 100),
    decodage: ouNul(objetSimple), redimensionnement: ouNul(objetSimple), chaine: ouNul(objetSimple), bitmapSansConversion: ouNul(objetSimple), bitmapAvecConversion: ouNul(objetSimple),
    couleurCanvas: ouNul(chaine(20))
};
const ENTREE = {
    chemin: parmi('rm', 'mixte', 'navigateur'), source: chaine(20), cartesRm: entier(0, 100), cartesRepli: entier(0, 100), refus: ouNul(objetSimple), identiqueAuBit: ouNul(booleen),
    rgbIdentiquesPil: ouNul(entier(0, 100)), rgbMesureesPil: ouNul(entier(0, 100)), cartesComparees: ouNul(entier(0, 100)), rgbIdentiquesNavigateur: ouNul(entier(0, 100)), tenseursIdentiquesNavigateur: ouNul(entier(0, 100)), ecartMaxNavigateur: ouNul(entier(0, 255)), cosMinNavigateur: ouNul(nombre(-1, 1.0001)),
    msRmMediane: ouNul(nombre(0, 1e6)), msNavigateurMediane: ouNul(nombre(0, 1e6)), cartes640: ouNul(entier(0, 100)), ms640: ouNul(nombre(0, 1e7)), empreinte640: ouNul(hexN(12))
};
const REFUS = { FORMAT: entier(0, 100), TROP_GRAND: entier(0, 100), DECODAGE: entier(0, 100), NON_SUPPORTE: entier(0, 100), 'entree-invalide': entier(0, 100), memoire: entier(0, 100), autre: entier(0, 100) };
const ORIENTATION = { webp: parmi('tourne', 'non-tourne', 'indetermine'), jpeg: parmi('tourne', 'non-tourne', 'indetermine') };
const GPU = { vendor: chaine(40), architecture: chaine(40) };
// M9 : le téléchargement du modèle — redirigé (302 vers R2) ou non, l'hôte final, et, en cas de blocage, la cause nommée par une sonde « no-cors »
const RESEAU = { redirige: ouNul(booleen), hoteFinal: ouNul(chaine(80)), blocage: ouNul(parmi('cors-manquant', 'reseau-ou-csp', 'indetermine-isole')) };
const RACINE = {
    v: v => v === 1, runId: hexN(16), modeleSha: hexN(64), ua: chaine(300),
    isole: booleen, coeurs: ouNul(entier(1, 1024)), memoireAppareilGo: ouNul(nombre(0, 1024)),
    gpuDispo: booleen, gpu: ouNul(objetSimple), reseau: ouNul(objetSimple),
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
    if (corps.reseau !== null && corps.reseau !== undefined) { d = defaut(corps.reseau, RESEAU, 'reseau.'); if (d) return { ok: false, detail: d }; }
    d = defaut(corps.mesure, MESURE, 'mesure.'); if (d) return { ok: false, detail: d };
    const diag = corps.mesure.diagnosticPixels;
    if (diag !== null && diag !== undefined) {
        d = defaut(diag, DIAGNOSTIC, 'mesure.diagnosticPixels.'); if (d) return { ok: false, detail: d };
        for (const k of ['decodage', 'redimensionnement', 'chaine', 'bitmapSansConversion', 'bitmapAvecConversion']) {
            if (diag[k] !== null && diag[k] !== undefined) { d = defaut(diag[k], STAT, `mesure.diagnosticPixels.${k}.`); if (d) return { ok: false, detail: d }; }
        }
    }
    const ent = corps.mesure.entree;
    if (ent !== null && ent !== undefined) {
        d = defaut(ent, ENTREE, 'mesure.entree.'); if (d) return { ok: false, detail: d };
        if (ent.refus !== null && ent.refus !== undefined) { d = defaut(ent.refus, REFUS, 'mesure.entree.refus.'); if (d) return { ok: false, detail: d }; }
    }
    const ori = corps.mesure.orientationNavigateur;
    if (ori !== null && ori !== undefined) { d = defaut(ori, ORIENTATION, 'mesure.orientationNavigateur.'); if (d) return { ok: false, detail: d }; }
    const det = corps.mesure.detection;
    if (det !== null && det !== undefined) { d = defaut(det, DETECTION, 'mesure.detection.'); if (d) return { ok: false, detail: d }; }
    const gp = corps.mesure.grandesPhotos;
    if (gp !== null && gp !== undefined) {
        d = defaut(gp, GRANDES, 'mesure.grandesPhotos.'); if (d) return { ok: false, detail: d };
        if (!('photos' in gp)) return { ok: false, detail: 'manque:mesure.grandesPhotos.photos' };
        for (const p of gp.photos) {
            d = defaut(p, GRANDE_PHOTO, 'mesure.grandesPhotos.photos.'); if (d) return { ok: false, detail: d };
            for (const m of ['rm', 'nav']) { d = defaut(p[m], GRANDE_MOTEUR, `mesure.grandesPhotos.photos.${m}.`); if (d) return { ok: false, detail: d }; }
        }
    }
    for (const k of ['moteur', 'verdict']) if (!(k in corps.mesure)) return { ok: false, detail: `manque:mesure.${k}` };
    return { ok: true, doc: corps };
}

/**
 * Stocke le document puis RAMÈNE la collection à DOCUMENTS_MAX au plus (le plus ancien est remplacé : on retire les plus anciens par `_id`).
 * Le retrait se fait après l'insertion : deux dépôts simultanés peuvent dépasser un instant la borne, jamais durablement.
 */
async function stocker(doc, { max = DOCUMENTS_MAX, maintenant = new Date(), collection = null, baseAttendue = BASE_ESSAI, nomBase = undefined } = {}) {
    // M2 : on n'écrit QUE dans la base attendue (rm_essai), lue sur la connexion elle-même ; un nom différent (« test » : la production) ou illisible REFUSE, avant toute écriture
    let nom; try { nom = nomBase !== undefined ? nomBase : require('../db').base().databaseName; } catch { nom = null; }
    if (typeof nom !== 'string' || nom !== baseAttendue) throw Object.assign(new Error('base-refusee'), { code: 'BASE_REFUSEE' });
    if (!collection) collection = col(COLLECTION);
    const r = await collection.insertOne({ ...doc, recuLe: maintenant });
    const n = await collection.countDocuments({});
    if (n > max) {
        const anciens = await collection.find({}, { projection: { _id: 1 } }).sort({ _id: 1 }).limit(n - max).toArray();
        if (anciens.length) await collection.deleteMany({ _id: { $in: anciens.map(a => a._id) } });
    }
    return String(r.insertedId);
}

module.exports = { valider, stocker, OCTETS_MAX, DOCUMENTS_MAX, COLLECTION, MESURE, RACINE };
