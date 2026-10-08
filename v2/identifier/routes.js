'use strict';
// Lot B1b — routes de /api/identifier (contrat 2). PREMIÈRE PARTIE (B1b.1) : l'entrée est validée AVANT tout débit.
// `validerEntree` n'écrit nulle part : un refus ici ne touche ni `mouvements` ni aucune autre collection.
const { repondreErreur } = require('../erreurs');
const { HOTES_PHOTO_AUTORISES } = require('../../departage-image');   // la liste blanche de la production, pas une copie

const TITRE_MAX = 300, DESCRIPTION_MAX = 4000;

// Comparaison numérique `a.b.c` ('2.0.10' > '2.0.9'). Illisible => null (jamais un ordre inventé).
function comparerVersions(a, b) {
    const lire = v => (typeof v === 'string' && /^\d+(\.\d+){0,2}$/.test(v.trim())) ? v.trim().split('.').map(Number) : null;
    const x = lire(a), y = lire(b);
    if (!x || !y) return null;
    for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d < 0 ? -1 : 1; }
    return 0;
}

const refus = (code, message, detail) => ({ erreur: { code, message, ...(detail !== undefined ? { detail } : {}) } });
const hoteHttps = (u) => {
    if (typeof u !== 'string') return null;
    let p; try { p = new URL(u); } catch { return null; }
    return p.protocol === 'https:' ? p.hostname.toLowerCase() : null;     // le nom d'hôte PARSÉ, jamais la chaîne
};

// Fonction pure : { entree } ou { erreur: { code, message, detail? } }. Ordre : forme, version, marché, champs, images.
function verifierEntree(corps, cfg) {
    if (!corps || typeof corps !== 'object' || Array.isArray(corps)) return refus('ENTREE', 'corps de requête invalide');
    const cmp = comparerVersions(corps.versionExtension, cfg.versionMinExtension);
    if (cmp === null) return refus('ENTREE', 'versionExtension illisible', 'version');
    if (cmp < 0) return refus('VERSION', `extension trop ancienne (minimum ${cfg.versionMinExtension})`);
    if (typeof corps.marche !== 'string' || !cfg.marches.includes(corps.marche)) return refus('MARCHE', 'marché non pris en charge');
    if (corps.title != null && typeof corps.title !== 'string') return refus('ENTREE', 'title invalide', 'title');
    if (corps.description != null && typeof corps.description !== 'string') return refus('ENTREE', 'description invalide', 'description');
    const prix = corps.prixVinted ?? null;
    if (prix !== null && !(typeof prix === 'number' && Number.isFinite(prix) && prix > 0)) return refus('ENTREE', 'prixVinted invalide', 'prix');
    const devise = corps.devise ?? null;
    if (devise !== null && !cfg.devises.includes(devise)) return refus('ENTREE', 'devise hors liste', 'devise');
    if (prix !== null && devise === null) return refus('ENTREE', 'devise manquante', 'devise');
    let vintedUrl = corps.vintedUrl ?? null;
    if (vintedUrl !== null) {
        const h = hoteHttps(vintedUrl);
        if (!h || !cfg.marches.includes(h.replace(/^www\./, ''))) return refus('ENTREE', 'vintedUrl invalide', 'vinted-url');
    }
    const urls = corps.imageUrls;
    if (urls !== undefined && urls !== null && !Array.isArray(urls)) return refus('ENTREE', 'imageUrls doit être un tableau', 'image-urls');
    if (Array.isArray(urls) && urls.length > cfg.images.imageUrlsMax) return refus('ENTREE', `au plus ${cfg.images.imageUrlsMax} images`, 'image-urls');
    for (const u of urls || []) {
        if (typeof u !== 'string') return refus('ENTREE', 'imageUrls : chaîne attendue', 'image-url');
        const h = hoteHttps(u);
        if (!h) return refus('ENTREE', 'imageUrls : URL https attendue', 'image-url');
        if (!HOTES_PHOTO_AUTORISES.some(re => re.test(h))) return refus('ENTREE', 'imageUrls : hôte non autorisé', 'image-hote');
    }
    if (!urls || !urls.length) return refus('IMAGE', 'aucune image à analyser', 'aucune-image');
    return { entree: {
        imageUrls: [...urls], title: (corps.title || '').slice(0, TITRE_MAX), description: (corps.description || '').slice(0, DESCRIPTION_MAX),
        prixVinted: prix, devise, marche: corps.marche, vintedUrl,
        langueInterface: corps.langueInterface === 'en' ? 'en' : 'fr', versionExtension: corps.versionExtension.trim()
    } };
}

// Middleware : à placer APRÈS idempotente('identifier') et AVANT traiterIdentifier. Pose req.entree ; rien n'est débité ici.
function validerEntree(cfg) {
    return (req, res, next) => {
        const r = verifierEntree(req.body, cfg);
        if (r.erreur) return repondreErreur(res, r.erreur.code, r.erreur.message, r.erreur.detail !== undefined ? { detail: r.erreur.detail } : {});
        req.entree = r.entree;
        return next();
    };
}

module.exports = { validerEntree, verifierEntree, comparerVersions };
