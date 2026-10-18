'use strict';
// PHOTOS-MULTIPLES (7d) — POST /api/photo (SANS paramètre : `?index=` est facultatif et IGNORÉ, l'index vient de `photoIds`) : l'extension de l'ADMINISTRATEUR envoie, en OCTETS BRUTS (JPEG, PNG ou WebP tels que Vinted les sert), une photo de l'annonce AVANT le scan. Le serveur la garde 120 s
// EN MÉMOIRE (identifier/photos-recues.js) et rend un `photoId` que POST /api/identifier désigne ensuite (`photoIds`). Dès qu'une photo est reçue, aucune image n'est téléchargée chez Vinted pour ce scan.
// 🔑 Écrit par ce qu'il AUTORISE. L'ordre est celui de POST /api/banc/photo (banc/photo.js, qu'on lira d'abord), jugé AVANT de lire un seul octet du corps :
//   1. porteur v2 authentifié (401 JETON) ; 2. compte `administrateur` RELU en base (le 404 natif de la route inexistante sinon : exigerAdministrateurPhoto, monté AVANT ce gestionnaire) ; 3. un plafond horaire par porteur (429 DEBIT) ;
//   4. la requête : aucun paramètre, sauf `index` (facultatif, ignoré) ; tout autre paramètre est refusé (400) ; 5. `Content-Type` ∈ JPEG, PNG, WebP (415) ; 6. `Content-Length` entier, > 0 et ≤ 2 Mio (400 / 413) ;
//   7. une place de lecture : 4 au total, 1 par porteur (429 DEBIT + Retry-After) ; 8. un délai de lecture (15 s : une connexion lente est coupée, banc/lecture-corps.js).
// Puis le corps : validé par identifier/photo-extension.js::evaluerOctets (la validation de /api/banc/photo, jamais recopiée), PUIS réencodé sans métadonnées (EXIF, XMP, ICC : sharp n'en écrit aucune), orientation appliquée, 1 600 px
// au plus : c'est CETTE image-là qui est retenue et transmise au modèle. Rien n'est écrit en base, rien au bucket, rien dans un journal ; aucun argent.
const { repondreErreur } = require('../erreurs');
const PE = require('./photo-extension');
const { lireCorpsBorne } = require('../banc/lecture-corps');
const { magasin } = require('./photos-recues');
const { TTL_S } = require('./photos-recues').creerPhotosRecues;

const PLACES_MAX = 4, DELAI_LECTURE_MS = 15000, COTE_MODELE = 800;
const journal = (ou, e) => console.error(`❌ [v2 photo-avant-scan] ${ou} (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message

/** Réencode l'image validée en JPEG sans métadonnées, orientation appliquée, 1 600 px au plus (jamais agrandie) ; si elle dépasse encore `max`, une seconde fois plus petite. null si rien ne tient. */
// Rend { octets, modele } : `octets` (1 600 px au plus) sert la photo du banc de l'administrateur et la seconde lecture ; `modele` (800 px de grand côté au plus, jamais agrandie : la définition f800 que Vinted sert) est la seule
// version qui part au modèle, pour que le coût du modèle reste celui d'aujourd'hui. TOUT le réencodage (jusqu'à trois décodages) tient dans UNE place du sémaphore des décodages de photo-extension.js (2 au plus dans le processus) :
// plein, il lève { code: 'occupe' } tout de suite (la route répond 429 DEBIT, jamais une attente).
async function epurer(octets, max) {
    const r = await PE.sousSemaphore(async () => {
        const sharp = require('sharp');
        const base = () => sharp(octets, { failOn: 'error', limitInputPixels: PE.PIXELS_MAX }).rotate().flatten({ background: '#ffffff' });
        let grande = null;
        for (const [cote, qualite] of [[1600, 85], [1200, 60]]) {
            const sortie = await base().resize({ width: cote, height: cote, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: qualite }).toBuffer();
            if (sortie.length <= max) { grande = sortie; break; }
        }
        if (!grande) return null;
        const modele = await base().resize({ width: COTE_MODELE, height: COTE_MODELE, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
        return { octets: grande, modele };
    });
    if (r.occupe) throw Object.assign(new Error('occupe'), { code: 'occupe' });
    return r.valeur;
}

function traiterPhotoAvantScan(cfg, deps = {}) {
    const octetsMax = cfg.images.photoExtensionOctetsMax;
    const reglage = (deps && deps.photoAvantScan) || {};
    const placesMax = Number.isInteger(reglage.placesMax) && reglage.placesMax > 0 ? reglage.placesMax : PLACES_MAX;
    const delaiMs = Number.isFinite(reglage.delaiLectureMs) && reglage.delaiLectureMs > 0 ? reglage.delaiLectureMs : DELAI_LECTURE_MS;
    let enCours = 0; const porteurs = new Set();

    return async function traiterPhotoAvantScanV2(req, res) {
        const porteur = req.v2 && req.v2.porteur;
        if (!porteur) return repondreErreur(res, 'INDISPONIBLE');
        // un refus ordinaire envoie `Connection: close` : le corps non lu n'est jamais avalé (Node le vide lui-même à la fin de la réponse)
        const refus = (code, message, detail, statut, extra = {}) => { res.setHeader('Connection', 'close'); return repondreErreur(res, code, message, { detail, ...extra }, statut); };

        // 4. la requête
        const q = req.query || {};
        if (Object.keys(q).some(k => k !== 'index')) return refus('ENTREE', undefined, 'champ-inconnu');
        // (A, C1) `index` est ignoré, quelle que soit sa valeur : c'est `photoIds` de POST /api/identifier qui dit la position de chaque photo ; le magasin ne garde qu'un rang de dépôt, sans effet
        const index = 0;
        // 5. le type annoncé
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (!PE.TYPES.includes(type)) return refus('IMAGE', 'Format d\'image non pris en charge', 'type', 415);
        // 6. la longueur
        const cl = req.headers['content-length'];
        if (typeof cl !== 'string' || !/^\d{1,10}$/.test(cl) || Number(cl) === 0) return refus('ENTREE', undefined, 'content-length');
        if (Number(cl) > octetsMax) return refus('IMAGE', 'Image trop lourde', 'trop-lourde', 413);
        const longueur = Number(cl);
        // 7. une place de lecture
        const cle = `${porteur.type}:${porteur.id}`;
        if (enCours >= placesMax || porteurs.has(cle)) return refus('DEBIT', 'Une photo est déjà en cours d\'envoi', undefined, undefined, { reessayerDans: 2 });
        enCours++; porteurs.add(cle);
        let libre = false;
        const liberer = () => { if (libre) return; libre = true; enCours--; porteurs.delete(cle); };
        res.once('close', liberer);
        // 8. le corps, borné par la longueur annoncée et par un délai
        let octets;
        try { octets = await lireCorpsBorne(req, longueur, delaiMs); }
        catch (e) {
            liberer();
            if (e && (e.code === 'LENT' || e.code === 'COUPE')) { console.warn(`⚠️ [v2 photo-avant-scan] lecture interrompue (${e.code})`); return; }       // plus personne à qui répondre
            return repondreErreur(res, e && e.code === 'TROP' ? 'IMAGE' : 'ENTREE', undefined, { detail: e && e.code === 'TROP' ? 'trop-lourde' : 'content-length' }, e && e.code === 'TROP' ? 413 : 400);
        }
        liberer();
        // la validation (UNE analyse d'image : celle de /api/banc/photo), puis l'épuration des métadonnées, puis le magasin
        const v = await PE.evaluerOctets(octets, { octetsMax, typeAnnonce: type });
        if (!v.octets) {
            PE.noter(v.cause);
            console.log(`📷 [v2 photo-avant-scan] refusée (${v.cause})`);                                // un code, jamais l'image
            if (v.cause === 'trop-grosse') return repondreErreur(res, 'IMAGE', 'Image trop lourde', { detail: 'trop-lourde' }, 413);
            if (v.cause === 'format') return repondreErreur(res, 'IMAGE', 'Format d\'image non pris en charge', { detail: 'type' }, 415);
            if (v.cause === 'illisible' || v.cause === 'dimensions') return repondreErreur(res, 'IMAGE', 'Image illisible', { detail: v.cause }, 422);
            if (v.cause === 'occupe') return repondreErreur(res, 'DEBIT', 'Trop de photos en cours de traitement', { reessayerDans: 2 });
            return repondreErreur(res, 'INDISPONIBLE');
        }
        let propre;
        try { propre = await epurer(v.octets, octetsMax); }
        catch (e) {
            if (e && e.code === 'occupe') return repondreErreur(res, 'DEBIT', 'Trop de photos en cours de traitement', { reessayerDans: 2 });
            journal('épuration', e); return repondreErreur(res, 'IMAGE', 'Image illisible', { detail: 'illisible' }, 422);
        }
        if (!propre) return repondreErreur(res, 'IMAGE', 'Image illisible', { detail: 'illisible' }, 422);
        let photoId;
        try { photoId = magasin(deps).deposer(cle, index, propre.octets, propre.modele); }
        catch (e) { journal('magasin', e); return repondreErreur(res, 'INDISPONIBLE'); }
        PE.noter('ok');
        return res.status(200).json({ success: true, photoId, expireDans: TTL_S });
    };
}

module.exports = { traiterPhotoAvantScan, epurer, PLACES_MAX, DELAI_LECTURE_MS };
