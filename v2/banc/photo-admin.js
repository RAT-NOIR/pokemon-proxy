'use strict';
// ETIQUETAGE-B — le crochet « photo de l'administrateur » de /api/identifier. Appelé APRÈS la réponse calculée : il ne rend rien à la réponse, n'est jamais attendu par elle, ne lève jamais.
// Écrit par ce qu'il AUTORISE : la photo d'un scan n'est conservée que si (1) le porteur est un COMPTE dont le rôle `administrateur` est RELU en base à l'instant (jamais le seul drapeau du porteur),
// (2) un banc qui sait conserver est fourni, (3) la première URL d'image est https et d'un hôte de la liste blanche de la production (departage-image.HOTES_PHOTO_AUTORISES), (4) le téléchargement
// (borné en octets et en temps, sans redirection) rend une image que stockage.traiterPhoto accepte. Tout le reste : rien, sans bruit. Aucun autre client n'est jamais photographié.
// `deps.telechargerPhoto(url)` : Promise<Buffer> (injectable par les bancs ; le défaut lit l'URL).
const db = require('../db');
const registre = require('../registre');

const journal = (ou, e) => console.error(`❌ [v2 banc-photo-admin] ${ou} (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message : il peut citer une URL
const OCTETS_MAX = 5 * 1024 * 1024, DELAI_MS = 8000;

async function telechargerParDefaut(url) {
    const { lireBorne } = require('../../departage-image');
    const r = await fetch(url, { signal: AbortSignal.timeout(DELAI_MS), redirect: 'manual' });
    if (!r.ok) throw Object.assign(new Error('photo'), { code: `HTTP-${r.status}` });
    return lireBorne(r, OCTETS_MAX);
}

function urlAutorisee(u) {
    try {
        const { HOTES_PHOTO_AUTORISES } = require('../../departage-image');
        const x = new URL(String(u));
        return x.protocol === 'https:' && HOTES_PHOTO_AUTORISES.some(re => re.test(x.hostname));
    } catch { return false; }
}

/** @returns {Promise<'ecrit'|'ignore'|'echec'>} — la route n'attend pas cette promesse ; les bancs, si. */
async function apresIdentifierAdmin({ cfg, deps, req, scanId, porteur }) {
    try {
        if (!porteur || porteur.type !== 'compte' || porteur.administrateur !== true) return 'ignore';
        let banc; try { banc = registre.obtenir('banc'); } catch { return 'ignore'; }
        if (!banc || typeof banc.conserverPhoto !== 'function') return 'ignore';
        const urls = req && req.entree && Array.isArray(req.entree.imageUrls) ? req.entree.imageUrls : [];
        if (!urls.length || !urlAutorisee(urls[0])) return 'ignore';
        // le rôle, relu en base : un drapeau périmé ne photographie rien
        let n; try { n = await db.col('comptes').countDocuments({ _id: porteur.id, role: 'administrateur' }); } catch (e) { journal('rôle', e); return 'echec'; }
        if (!(n > 0)) return 'ignore';
        const telecharger = deps && typeof deps.telechargerPhoto === 'function' ? deps.telechargerPhoto : telechargerParDefaut;
        const buffer = await telecharger(urls[0]);
        const r = await banc.conserverPhoto({ scanId: String(scanId), buffer });
        return r === 'ecrit' || r === 'deja' ? 'ecrit' : 'echec';
    } catch (e) { journal('photo non conservée', e); return 'echec'; }
}

module.exports = { apresIdentifierAdmin, urlAutorisee };
