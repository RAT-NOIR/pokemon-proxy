'use strict';
// L'identité d'une requête v2. Écrit par ce qu'il AUTORISE : tout ce qui n'est pas un jeton ou un cookie valide, en base, est « personne ».
const { col } = require('./db'); const J = require('./comptes/jetons'); const S = require('./comptes/sessions'); const { repondreErreur } = require('./erreurs');
const RE_BEARER = /^Bearer ([A-Za-z0-9_-]{20,64})$/;
async function compteDe(id) { return id ? col('comptes').findOne({ _id: id }) : null; }
function porteurDeCompte(compte, surface) { return { type: 'compte', id: compte._id, compte, installation: null, surface, administrateur: compte.role === 'administrateur' }; }
function resoudrePorteur(cfg) {
    return async function resoudre(req, res, next) {
        req.v2 = { porteur: null, echec: 'jeton-absent' };   // jamais repris d'une valeur déjà posée sur la requête
        try {
            const auth = req.get('authorization'), m = auth && RE_BEARER.exec(auth);
            if (m) {
                const inst = await col('installations').findOne({ jetonEmpreinte: J.empreinte(m[1]) });
                if (!inst) req.v2.echec = 'jeton-inconnu';
                else if (inst.revoqueeLe) req.v2.echec = 'installation-revoquee';
                else {
                    const compte = await compteDe(inst.compteId);
                    req.v2.porteur = compte ? { ...porteurDeCompte(compte, 'extension'), installation: inst } : { type: 'installation', id: inst._id, compte: null, installation: inst, surface: 'extension', administrateur: false };
                    req.v2.echec = null;
                }
            } else {
                const token = S.lireCookie(req);
                if (token) {
                    const sess = await col('sessions').findOne({ tokenEmpreinte: J.empreinte(token) });
                    const now = new Date();
                    if (!sess || !(sess.expireLe > now)) req.v2.echec = sess ? 'session-expiree' : 'session-absente';
                    else {
                        const compte = await compteDe(sess.compteId);
                        if (compte) {
                            req.v2.porteur = porteurDeCompte(compte, 'scanner'); req.v2.echec = null; req.v2.session = sess;
                            if (now.getTime() - sess.vueLe.getTime() > cfg.comptes.glissementHeures * 3600e3)   // au plus une écriture par 24 h
                                await col('sessions').updateOne({ _id: sess._id }, { $set: { vueLe: now, expireLe: new Date(now.getTime() + cfg.comptes.sessionJours * 86400e3) } });
                        } else req.v2.echec = 'session-absente';
                    }
                }   // ni Bearer ni cookie : porteur null, echec 'jeton-absent'
            }
        } catch (e) { console.error(`❌ [v2 porteur] ${(e && (e.code || e.name)) || 'erreur'}`); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }
        next();
    };
}
const exigerInstallation = (req, res, next) => (req.v2 && req.v2.porteur && req.v2.porteur.installation) ? next() : repondreErreur(res, 'JETON', 'Jeton d\'installation absent ou invalide');
const exigerSession = (req, res, next) => (req.v2 && req.v2.porteur && req.v2.porteur.type === 'compte' && req.v2.porteur.surface === 'scanner') ? next() : repondreErreur(res, 'SESSION', 'Connexion requise');
module.exports = { resoudrePorteur, exigerInstallation, exigerSession };
