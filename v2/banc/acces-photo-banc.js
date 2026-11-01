'use strict';
// COMPTE-TEST (commit 4) — la garde de POST /api/photo : celle d'origine (exigerAdministrateurPhoto : le 404 natif, sans lire le corps, pour tout non-administrateur), plus UNE seule porte, écrite par ce qu'elle AUTORISE.
// Un compte non administrateur passe si et seulement si :
//   1. V2_PHOTO_COMPTES_BANC=1 (cfg.photoComptesBanc, éteint par défaut) ; 2. le porteur est un compte, relu EN BASE ; 3. ce compte est celui de la liste fermée (estCompteDeTestOrdinaire : adresse réservée + banc + bancOrdinaire,
//   confirmé, aucun rôle — le MÊME prédicat que l'exemption d'installations) ; 4. la base réellement connectée est celle de l'essai (baseDeLEssai : rm_essai, ou test_scratch sous BANC_ISOLE=1).
// Tout le reste — drapeau absent, base de production, lecture qui lève, compte hors liste — est renvoyé à la garde d'origine, qui répond le 404 natif. Un administrateur n'est pas jugé ici : la garde d'origine le laisse passer.
// Cette porte n'ouvre QUE l'accès à la route : ni quota, ni débit, ni plafond, ni rôle. Elle marque la requête (req.v2.compteBancPhoto) pour que le dépôt soit journalisé.
const db = require('../db');
const { exigerAdministrateurPhoto } = require('./photo');
const EX = require('../installations/exemption-banc');

/** @returns {(req, res, next) => Promise<void>} `deps.nomBase` : la lecture du nom de la base (un banc l'injecte). */
function exigerPhotoAdminOuBanc(cfg, deps = {}) {
    const nomBase = deps && typeof deps.nomBase === 'function' ? deps.nomBase : () => db.base().databaseName;
    return async function garde(req, res, next) {
        if (cfg && cfg.photoComptesBanc === true) {
            try {
                const p = req.v2 && req.v2.porteur;
                if (p && p.type === 'compte' && p.administrateur !== true) {
                    const c = await db.col('comptes').findOne({ _id: p.id });
                    if (EX.estCompteDeTestOrdinaire(c) && EX.baseDeLEssai(nomBase())) { req.v2.compteBancPhoto = String(c._id); return next(); }
                }
            } catch { /* ne sait pas conclure : la garde d'origine décide */ }
        }
        return exigerAdministrateurPhoto(req, res, next);
    };
}
module.exports = { exigerPhotoAdminOuBanc };
