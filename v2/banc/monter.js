'use strict';
// Emplacement du lot B6. B6.3 monte POST /api/banc/correction ; B6.4 y ajoute DELETE /api/banc/contributions (l'effacement par jeton) et arme la purge quotidienne.
// (La purge : 1re passe différée de 10 min après le montage, puis toutes les 24 h.) Le banc est fabriqué ici (stockage réel paresseux : rien n'est chargé, aucun réseau, tant qu'une écriture consentie n'a pas lieu) et fourni au registre
// SEULEMENT si personne ne l'a fourni avant (un banc de test injecte le sien). Le crochet du banc dans /api/identifier est v2/banc/crochet.js (B6.4).
const mongoose = require('mongoose');
const registre = require('../registre');
const { repondreErreur } = require('../erreurs');
const { resoudrePorteur, exigerInstallation } = require('../porteur');
const { creerBanc, traiterCorrection } = require('./routes');
const { creerPurge, FORME_JETON } = require('./purge');

// ── DELETE /api/banc/contributions { jeton } (Bearer) : toutes les lignes du jeton et leurs objets, tout de suite. Un jeton inconnu : 200, supprimees 0 (on ne révèle rien).
function traiterEffacement(purge) {
    return async function traiterEffacementV2(req, res) {
        if (!(req.v2 && req.v2.porteur)) return repondreErreur(res, 'INDISPONIBLE');
        const b = req.body;
        if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.jeton !== 'string' || !FORME_JETON.test(b.jeton)) return repondreErreur(res, 'ENTREE', undefined, { detail: 'jeton' });
        let r;
        try { r = await purge.effacerParJeton(b.jeton); }
        catch (e) { console.error(`❌ [v2 banc-effacement] ${(e && (e.code || e.name)) || 'erreur'}`); return repondreErreur(res, 'INDISPONIBLE'); }
        return res.status(200).json({ success: true, supprimees: r.supprimees, echecs: r.echecs });
    };
}

// ── La purge quotidienne : toutes les 24 h, rien sans Mongo prêt, UN minuteur par processus, unref. Pas de passe au démarrage (la prochaine est dans 24 h ;
// le worker peut la lancer à la main : node v2/banc/purge.js --base=test_scratch).
const INTERVALLE_PURGE_MS = 24 * 3600 * 1000;
let minuteurPurge = null;
async function purgerUneFois({ etatMongo = () => mongoose.connection.readyState, purge } = {}) {
    try {
        if (etatMongo() !== 1) return false;
        await purge.purgerBanc(new Date());
        return true;
    } catch (e) { console.error(`❌ [v2 banc-purge] passe échouée (${(e && (e.code || e.name)) || 'erreur'})`); return false; }   // jamais e.message
}
// Une passe DIFFÉRÉE au démarrage (10 min : le temps que Mongo soit prêt) puis toutes les 24 h : un processus redéployé chaque jour ne verrait jamais l'intervalle de 24 h
// se déclencher, et la purge (le seul effaceur) ne tournerait jamais. Même schéma que la purge des annonces (B1b.7). Un seul différé et un seul intervalle par processus.
const DIFFERE_PURGE_MS = 10 * 60 * 1000;
let differePurge = null, minuteursEnCours = null;
function arreterPurge() {
    const m = minuteursEnCours || global;
    if (minuteurPurge) { m.clearInterval(minuteurPurge); minuteurPurge = null; }
    if (differePurge) { m.clearTimeout(differePurge); differePurge = null; }
    minuteursEnCours = null;
}
function demarrerPurge(purge, intervalleMs = INTERVALLE_PURGE_MS, etatMongo, { differeMs = DIFFERE_PURGE_MS, minuteurs = global } = {}) {
    arreterPurge();                                                  // un seul différé et un seul intervalle par processus, même si le montage est refait
    minuteursEnCours = minuteurs;
    const passe = () => purgerUneFois({ purge, ...(etatMongo ? { etatMongo } : {}) });
    differePurge = minuteurs.setTimeout(passe, differeMs); differePurge.unref();
    minuteurPurge = minuteurs.setInterval(passe, intervalleMs); minuteurPurge.unref();
    return minuteurPurge;
}

module.exports = {
    enTete(app, cfg) { },
    routes(router, cfg, deps = {}) {
        const banc = deps.banc || creerBanc({ cfg });
        try { registre.obtenir('banc'); } catch { registre.fournir('banc', banc); }
        const purge = deps.purge || creerPurge({ cfg });
        router.post('/api/banc/correction', resoudrePorteur(cfg), exigerInstallation, traiterCorrection(cfg, banc));
        router.delete('/api/banc/contributions', resoudrePorteur(cfg), exigerInstallation, traiterEffacement(purge));
        demarrerPurge(purge);
    },
    purgerUneFois, demarrerPurge, arreterPurge, minuteurPurge: () => minuteurPurge, differePurge: () => differePurge, INTERVALLE_PURGE_MS, DIFFERE_PURGE_MS
};
