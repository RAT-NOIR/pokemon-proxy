'use strict';
// ETIQUETAGE-B — le crochet « photo de l'administrateur » de /api/identifier. Appelé APRÈS la réponse calculée : il ne rend rien à la réponse, n'est jamais attendu par elle, ne lève jamais.
// Écrit par ce qu'il AUTORISE : la photo d'un scan n'est conservée que si (1) le porteur est un COMPTE dont le rôle `administrateur` est RELU en base à l'instant (jamais le seul drapeau du porteur),
// (2) un banc qui sait conserver est fourni, (3) la première URL d'image est https et d'un hôte de la liste blanche de la production (departage-image.HOTES_PHOTO_AUTORISES), (4) le téléchargement
// (UN SEUL GET, borné en octets et en temps, sans redirection, type image) rend une image que stockage.traiterPhoto accepte. Tout le reste : rien, sans bruit. Aucun autre client n'est jamais photographié.
// 🔑 CE TÉLÉCHARGEMENT EST UN SECOND GET de l'image de l'annonce (la route v2 ne tient aucun octet de la photo : la chaîne héritée reçoit l'URL). Un seul, par scan d'administrateur, après la réponse ;
// la photo STOCKÉE peut donc différer de celle que la chaîne a analysée si l'URL a changé entre-temps : son sha256 est écrit (analyses.photoBanc.sha256, ligne du banc) pour savoir de quelle image il s'agit.
// ⚠️ PHOTO-EXTENSION : ce SECOND GET n'est plus que le REPLI de POST /api/banc/photo (banc/photo.js, où l'extension envoie l'image qu'elle affiche). Il attend 15 s que l'extension ait envoyé la sienne
// (alors rien n'est téléchargé), puis il est espacé et plafonné (banc/photo-repli.js : 10 s, 400 par jour UTC, comptés dans la base).
// `deps.telechargerPhoto(url)` : Promise<Buffer> (injectable par les bancs ; le défaut lit l'URL).
// `deps.photoAdmin` { hotes, protocoles, delaiMs, octetsMax } : réglages INJECTABLES par les bancs (serveur HTTP local) ; absents en production, où les valeurs par défaut ci-dessous s'appliquent.
const db = require('../db');
const registre = require('../registre');

const journal = (ou, e) => console.error(`❌ [v2 banc-photo-admin] ${ou} (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message : il peut citer une URL
const OCTETS_MAX = 5 * 1024 * 1024, DELAI_MS = 8000;

/** Réglages effectifs : ceux de la production, sauf ce qu'un banc injecte explicitement. */
function reglages(deps) {
    const i = deps && deps.photoAdmin && typeof deps.photoAdmin === 'object' ? deps.photoAdmin : {};
    const { HOTES_PHOTO_AUTORISES } = require('../../departage-image');
    return {
        hotes: Array.isArray(i.hotes) ? i.hotes : HOTES_PHOTO_AUTORISES,
        protocoles: Array.isArray(i.protocoles) ? i.protocoles : ['https:'],
        delaiMs: Number.isFinite(i.delaiMs) && i.delaiMs > 0 ? i.delaiMs : DELAI_MS,
        octetsMax: Number.isFinite(i.octetsMax) && i.octetsMax > 0 ? i.octetsMax : OCTETS_MAX
    };
}

/** UN GET : pas de redirection (un 3xx est un échec), délai sur toute la requête corps compris, plafond d'octets, type image. */
async function telechargerParDefaut(url, { delaiMs = DELAI_MS, octetsMax = OCTETS_MAX, fetchFn = fetch } = {}) {
    const { lireBorne } = require('../../departage-image');
    const r = await fetchFn(url, { signal: AbortSignal.timeout(delaiMs), redirect: 'manual' });
    if (!r.ok) throw Object.assign(new Error('photo'), { code: `HTTP-${r.status}` });
    const type = r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-type') : null;
    if (type && !/^image\//i.test(type)) throw Object.assign(new Error('type'), { code: 'TYPE-NON-IMAGE' });
    return lireBorne(r, octetsMax);
}

function urlAutorisee(u, r = reglages(null)) {
    try {
        const x = new URL(String(u));
        return r.protocoles.includes(x.protocol) && r.hotes.some(re => re.test(x.hostname));
    } catch { return false; }
}

/** @returns {Promise<'ecrit'|'recu'|'ignore'|'plafonne'|'echec'>} — la route n'attend pas cette promesse ; les bancs, si.
 *  PHOTO-EXTENSION (recadrage) : le téléchargement serveur n'est plus que le REPLI de POST /api/banc/photo. Il attend `cfg.photoAdmin.delaiS` secondes (défaut 15, `deps.photoAdmin.attendre(ms)` pour les bancs)
 *  pour laisser l'extension envoyer sa photo ; si `analyses.photoBanc` existe alors ('recu'), RIEN n'est téléchargé. Sinon : espacé et plafonné (photo-repli.js), compté dans la base ; refusé => 'plafonne',
 *  pas de photo (la carte passe `banc: 'en-attente'` comme toute carte dont la photo manque). Le délai vit en mémoire : un redémarrage pendant l'attente perd ce repli (la carte sort `sans-photo` à 24 h). */
async function apresIdentifierAdmin({ cfg, deps, req, scanId, porteur }) {
    try {
        if (!porteur || porteur.type !== 'compte' || porteur.administrateur !== true) return 'ignore';
        let banc; try { banc = registre.obtenir('banc'); } catch { return 'ignore'; }
        if (!banc || typeof banc.conserverPhoto !== 'function') return 'ignore';
        const reg = reglages(deps);
        // PHOTOS-MULTIPLES (7d) : des photos ont été REÇUES pour ce scan (POST /api/photo, avant le scan) — AUCUN téléchargement, quoi qu'il arrive. L'index 0 reçu devient la photo du banc (le chemin du téléchargement,
        // sans le GET) ; sans index 0 reçu, il n'y a pas de photo du banc : rien n'est téléchargé pour la remplacer. Le rôle est relu en base, comme plus bas.
        const recues = req && req.entree && Array.isArray(req.entree.photosRecues) ? req.entree.photosRecues : [];
        if (recues.length) {
            const p0 = recues.find(p => p.index === 0);
            if (!p0 || !Buffer.isBuffer(p0.octets)) return 'ignore';
            let n0; try { n0 = await db.col('comptes').countDocuments({ _id: porteur.id, role: 'administrateur' }); } catch (e) { journal('rôle', e); return 'echec'; }
            if (!(n0 > 0)) return 'ignore';
            const r0 = await banc.conserverPhoto({ scanId: String(scanId), buffer: p0.octets });
            return r0 === 'ecrit' || r0 === 'deja' ? 'ecrit' : 'echec';
        }
        const urls = req && req.entree && Array.isArray(req.entree.imageUrls) ? req.entree.imageUrls : [];
        if (!urls.length || !urlAutorisee(urls[0], reg)) return 'ignore';
        const ms = ((cfg && cfg.photoAdmin && cfg.photoAdmin.delaiS) || 0) * 1000;
        if (ms > 0) { const attendre = deps && deps.photoAdmin && typeof deps.photoAdmin.attendre === 'function' ? deps.photoAdmin.attendre : (t => new Promise(r => setTimeout(r, t))); await attendre(ms); }
        // le rôle, relu en base : un drapeau périmé ne photographie rien (relu APRÈS l'attente)
        let n; try { n = await db.col('comptes').countDocuments({ _id: porteur.id, role: 'administrateur' }); } catch (e) { journal('rôle', e); return 'echec'; }
        if (!(n > 0)) return 'ignore';
        // la photo de l'extension est-elle arrivée pendant l'attente ?
        try { if (await db.col('analyses').countDocuments({ _id: new (require('mongoose').Types.ObjectId)(String(scanId)), photoBanc: { $exists: true } }) > 0) return 'recu'; } catch (e) { journal('photo reçue ?', e); return 'echec'; }
        const colRepli = deps && deps.photoAdmin && typeof deps.photoAdmin.colRepli === 'function' ? deps.photoAdmin.colRepli : undefined;
        const res = await require('./photo-repli').reserver({ cfg, ...(colRepli ? { colFn: colRepli } : {}) });
        if (!res.ok) { console.log(`📷 [v2 banc-photo-admin] repli refusé (${res.cause})`); return 'plafonne'; }
        const buffer = deps && typeof deps.telechargerPhoto === 'function' ? await deps.telechargerPhoto(urls[0]) : await telechargerParDefaut(urls[0], reg);
        const r = await banc.conserverPhoto({ scanId: String(scanId), buffer });
        return r === 'ecrit' || r === 'deja' ? 'ecrit' : 'echec';
    } catch (e) { journal('photo non conservée', e); return 'echec'; }
}

module.exports = { apresIdentifierAdmin, urlAutorisee, telechargerParDefaut };
