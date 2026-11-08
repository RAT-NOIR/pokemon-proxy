'use strict';
// BANC-TELEPHONE — la page de mesure sur téléphone (GET /api/banc/telephone) et son dépôt de résultats (POST /api/banc/telephone/resultat).
// Écrite par ce qu'elle AUTORISE : TROIS conditions positives, toutes requises, sinon les routes N'EXISTENT PAS (404 natif, octet pour octet comme avant) —
//   V2_BANC_TELEPHONE exactement « 1 » ; V2_CIBLE exactement « essai » ; ET RENDER_SERVICE_ID exactement le service Render de l'essai (variable posée par Render lui-même :
//   un copier-coller des variables de l'essai vers un autre service ne l'emporte pas). Même motif que `cfg.mesure` (v2/config.js, lot L1 : SERVICE_ESSAI) ;
//   la constante est RECOPIÉE ici parce que cette branche ne contient pas encore L1 — test-banc-telephone.js la compare à celle de config.js dès qu'elle y existe.
// Lue dans l'environnement AU MONTAGE (jamais dans config.js : aucune variable de plus à déclarer côté configuration), et injectable pour les bancs.
const SERVICE_ESSAI = 'srv-db7ticgm7kps73crjibg';
// Tour 1 (M2) : la base où les résultats s'écrivent est celle de l'essai, par son NOM (mongo-connexion.js : rm_essai), vérifiée au montage (MONGODB_BASE) ET à chaque écriture (databaseName de la connexion).
const BASE_ESSAI = 'rm_essai';

/** @returns {{actif: boolean, raison: string}} */
function lire(env = process.env) {
    if (!env || env.V2_BANC_TELEPHONE !== '1') return { actif: false, raison: 'V2_BANC_TELEPHONE absent ou différent de « 1 »' };
    if (env.V2_CIBLE !== 'essai') return { actif: false, raison: 'V2_CIBLE n\'est pas « essai »' };
    if (env.RENDER_SERVICE_ID !== SERVICE_ESSAI) return { actif: false, raison: 'ce service n\'est pas celui de l\'essai (RENDER_SERVICE_ID)' };
    return { actif: true, raison: 'essai' };
}

/** L'hôte EXACT du bucket R2 (celui vers lequel /api/modele-empreinte/<sha256> redirige), pour la seule directive connect-src de la page ; null si la configuration ne le permet pas. Aucun joker. */
function hoteR2(env = process.env) {
    const brut = (typeof env.V2_VISUELS_R2_ENDPOINT === 'string' && env.V2_VISUELS_R2_ENDPOINT.trim())
        || (typeof env.V2_VISUELS_R2_COMPTE === 'string' && /^[0-9a-zA-Z-]{1,64}$/.test(env.V2_VISUELS_R2_COMPTE.trim()) ? `https://${env.V2_VISUELS_R2_COMPTE.trim()}.r2.cloudflarestorage.com` : '');
    try { const u = new URL(brut); return u.protocol === 'https:' && /^[a-z0-9.-]+$/i.test(u.hostname) ? u.host : null; } catch { return null; }
}

module.exports = { lire, hoteR2, SERVICE_ESSAI, BASE_ESSAI };
