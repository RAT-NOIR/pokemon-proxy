'use strict';
// PHOTO-EXTENSION — l'image que l'extension affiche déjà, envoyée avec le scan (champ OPTIONNEL `photoBase64` de POST /api/identifier) : le serveur n'a plus à la télécharger chez Vinted.
// Forme : le JSON du scan porte `photoBase64`, du base64 standard SANS préfixe `data:`, de 2 Mio décodés au plus (config.images.photoExtensionOctetsMax), JPEG, PNG ou WebP.
// 🔑 JAMAIS UNE ERREUR DE SCAN : un champ absent, mal formé, trop gros, illisible ou hors format est traité comme ABSENT — le scan, sa facturation et sa réponse sont les mêmes avec ou sans lui.
// La CAUSE est comptée (un code, jamais l'image, jamais l'URL) et journalisée en une ligne.
// Ce que le serveur en fait : `req.entree.imageOctets` (un Buffer en MÉMOIRE de la requête, rien d'autre). Un administrateur : banc/photo-admin.js la conserve (mêmes traitements que la photo téléchargée).
// Tout autre porteur : elle est passée à la seconde lecture sous `image` SI celle-ci est branchée (V2_SECONDE_LECTURE=1 et un fournisseur) ; sinon elle n'est même pas décodée (cause « inutilisee »).
// Jamais conservée (ni base, ni bucket, ni disque), jamais journalisée, jamais dans la réponse. L'analyse d'image est CELLE DU SCANNER (scanner/routes.js::analyserImage) : jamais un second analyseur.
const { typeDesOctets } = require('../scanner/multipart');

const PIXELS_MAX = 50e6, COTE_MAX = 8000;                     // les bornes de la photo conservée (banc/stockage.js : limitInputPixels 50e6)
const FORME_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const FORMATS = Object.freeze({ 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' });
const CAUSES = Object.freeze(['absente', 'type-invalide', 'base64-invalide', 'trop-grosse', 'format', 'illisible', 'dimensions', 'inutilisee', 'erreur', 'ok']);

let compte = {};
const noter = (cause) => { const c = CAUSES.includes(cause) ? cause : 'erreur'; compte[c] = (compte[c] || 0) + 1; };
const compteurs = () => ({ ...compte });
const reinitialiser = () => { compte = {}; };

/** @returns {Promise<{octets: Buffer}|{cause: string}>} — ne lève jamais. */
async function evaluer(valeur, { octetsMax }) {
    try {
        if (valeur === undefined || valeur === null) return { cause: 'absente' };
        if (typeof valeur !== 'string') return { cause: 'type-invalide' };
        if (valeur.length > 4 * Math.ceil(octetsMax / 3)) return { cause: 'trop-grosse' };      // jugée sur la CHAÎNE : rien n'est décodé au-delà de la borne
        if (valeur.length % 4 !== 0 || !FORME_BASE64.test(valeur)) return { cause: 'base64-invalide' };
        const octets = Buffer.from(valeur, 'base64');
        if (octets.length > octetsMax) return { cause: 'trop-grosse' };
        const type = typeDesOctets(octets);                                                     // le format se juge sur les OCTETS, jamais sur une déclaration
        if (!type || !FORMATS[type]) return { cause: 'format' };
        const { analyserImage } = require('../scanner/routes');                                // chargé à l'appel : routes.js du scanner requiert l'identifier (pas de cycle au chargement)
        const c = await analyserImage(octets, { formats: [FORMATS[type]], pixelsMax: PIXELS_MAX, coteMax: COTE_MAX });
        return c === null ? { octets } : { cause: c };
    } catch { return { cause: 'erreur' }; }
}

/** Middleware, APRÈS validerEntree et AVANT traiterIdentifier. Ne répond jamais, ne passe jamais d'erreur à next : le scan continue quoi qu'il arrive. */
function lirePhotoExtension(cfg, deps = {}) {
    return async function lirePhotoExtensionV2(req, res, next) {
        let cause = 'absente';
        try {
            const corps = req.body && typeof req.body === 'object' ? req.body : null;
            const valeur = corps ? corps.photoBase64 : undefined;
            if (corps && 'photoBase64' in corps) delete corps.photoBase64;                      // la chaîne ne reste pas accrochée à la requête
            if (valeur !== undefined && valeur !== null) {
                const porteur = req.v2 && req.v2.porteur;
                const admin = Boolean(porteur && porteur.type === 'compte' && porteur.administrateur === true);
                const seconde = cfg.secondeLecture === true && typeof deps.secondeLecture === 'function';
                if (!admin && !seconde) cause = 'inutilisee';
                else {
                    const r = await evaluer(valeur, { octetsMax: cfg.images.photoExtensionOctetsMax });
                    if (r.octets && req.entree) { req.entree.imageOctets = r.octets; cause = 'ok'; }
                    else cause = r.cause || 'erreur';
                }
            }
        } catch { cause = 'erreur'; }
        noter(cause);
        if (cause !== 'absente') console.log(`📷 [v2 photo-extension] ${cause}`);                 // un code, jamais l'image ni l'URL
        return next();
    };
}

module.exports = { evaluer, lirePhotoExtension, noter, compteurs, reinitialiser, CAUSES, PIXELS_MAX, COTE_MAX };
