'use strict';
// PHOTO-EXTENSION (recadrage du 2026-10-13 soir) — la validation de l'image que l'extension envoie à POST /api/banc/photo (corps BINAIRE, jamais dans POST /api/identifier).
// `evaluerOctets` juge des octets déjà lus : taille, format (par les OCTETS, cohérent avec le Content-Type annoncé), dimensions, une seule page, décodage entier réduit à 64 px.
// L'analyse d'image est CELLE DU SCANNER (scanner/routes.js::analyserImage) : jamais un second analyseur. Elle ne lève jamais : elle rend { octets } ou { cause }.
// Causes : 'trop-grosse' · 'format' (hors JPEG/PNG/WebP, ou octets qui ne sont pas ce que le Content-Type annonce) · 'illisible' (tronquée, corrompue, animée) · 'dimensions' · 'occupe' (déjà 2 décodages en cours) · 'erreur'.
const { typeDesOctets } = require('../scanner/multipart');

// 12 millions de pixels et 4 096 px de côté. Une photo d'annonce affichée (f800) fait ~1 Mpx ; 12 Mpx est la photo d'un téléphone (4000 × 3000), 4 096 px le côté d'un écran 4K. À 50 Mpx un PNG entrelacé ou un
// JPEG progressif coûtait +180 Mo de mémoire et 1,4 s de CPU au décodage (mesuré par la relecture 1) : la mémoire est proportionnelle aux pixels, et l'en-tête est jugé AVANT le décodage.
// Au plus 2 décodages simultanés (DECODAGES_MAX) : le suivant est refusé tout de suite (cause « occupe »), jamais une attente qui retiendrait la requête. Une seule page : pas d'image animée.
const PIXELS_MAX = 12e6, COTE_MAX = 4096, DECODAGES_MAX = 2;
let decodages = 0, pic = 0;
/** LE SÉMAPHORE des décodages d'images hostiles (DECODAGES_MAX, 2 au plus dans le processus) : la validation ET le réencodage qui la suit (photo-avant-scan.js::epurer) passent par lui. La place est prise de façon synchrone
 *  (aucun await entre le test et l'incrément) et rendue quoi qu'il arrive. Plein : { occupe: true } tout de suite, jamais une attente. */
async function sousSemaphore(f) {
    if (decodages >= DECODAGES_MAX) return { occupe: true };
    decodages++; if (decodages > pic) pic = decodages;
    try { return { valeur: await f() }; }
    finally { decodages--; }
}
const FORMATS = Object.freeze({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' });
const TYPES = Object.freeze(Object.keys(FORMATS));

/** @param {Buffer} octets  @param {{octetsMax: number, typeAnnonce?: string}} o  @returns {Promise<{octets: Buffer}|{cause: string}>} — ne lève jamais. */
async function evaluerOctets(octets, { octetsMax, typeAnnonce }) {
    try {
        if (!Buffer.isBuffer(octets) || octets.length === 0) return { cause: 'format' };
        if (octets.length > octetsMax) return { cause: 'trop-grosse' };
        const type = typeDesOctets(octets);                                                     // le format se juge sur les OCTETS, jamais sur une déclaration
        if (!type || !FORMATS[type]) return { cause: 'format' };
        if (typeAnnonce !== undefined && typeAnnonce !== type) return { cause: 'format' };      // le Content-Type annoncé doit être ce que les octets sont
        const { analyserImage } = require('../scanner/routes');                                // chargé à l'appel : routes.js du scanner requiert l'identifier (pas de cycle au chargement)
        const r = await sousSemaphore(() => analyserImage(octets, { formats: [FORMATS[type]], pixelsMax: PIXELS_MAX, coteMax: COTE_MAX, pagesMax: 1 }));
        if (r.occupe) return { cause: 'occupe' };
        return r.valeur === null ? { octets } : { cause: r.valeur };
    } catch { return { cause: 'erreur' }; }
}

let compte = {};
const noter = (cause) => { compte[cause] = (compte[cause] || 0) + 1; };
const compteurs = () => ({ ...compte });
const reinitialiser = () => { compte = {}; };

module.exports = { sousSemaphore, decodagesEnCours: () => decodages, picDecodages: () => pic, evaluerOctets, noter, compteurs, reinitialiser, PIXELS_MAX, COTE_MAX, DECODAGES_MAX, TYPES };
