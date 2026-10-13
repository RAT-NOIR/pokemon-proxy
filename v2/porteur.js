'use strict';
// L'identité d'une requête v2. Écrit par ce qu'il AUTORISE : tout ce qui n'est pas un jeton ou un cookie valide, en base, est « personne ».
const { col } = require('./db'); const J = require('./comptes/jetons'); const S = require('./comptes/sessions'); const { repondreErreur } = require('./erreurs');
const RE_BEARER = /^Bearer ([A-Za-z0-9_-]{20,64})$/;
// PHOTO-EXTENSION tour 1 : LA lecture d'une installation par son jeton, partagée avec l'analyseur de corps (transport/corps-json.js) qui doit savoir, AVANT de lire 4 Mio, que le jeton est celui d'une installation vivante.
async function installationParJeton(token) { return col('installations').findOne({ jetonEmpreinte: J.empreinte(token) }); }
// O3 : seul un compte CONFIRMÉ (`verifie === true`) est un porteur. Un compte non confirmé est inactif : une session ou une installation qui le désignerait (héritage, écriture directe) ne donne rien.
async function compteDe(id) { const c = id ? await col('comptes').findOne({ _id: id }) : null; return c && c.verifie === true ? c : null; }
// O3 tour 2 (I-A) : une session ou une installation liée n'ouvre le compte que si sa GÉNÉRATION est égale à celle du compte, les deux présentes (entiers) ; un champ absent n'est jamais égal.
const memeGeneration = (objet, compte) => Boolean(objet) && Boolean(compte) && Number.isInteger(objet.generation) && Number.isInteger(compte.generation) && objet.generation === compte.generation;
function porteurDeCompte(compte, surface) { return { type: 'compte', id: compte._id, compte, installation: null, surface, administrateur: compte.role === 'administrateur' }; }
function resoudrePorteur(cfg) {
    return async function resoudre(req, res, next) {
        req.v2 = { porteur: null, echec: 'jeton-absent' };   // jamais repris d'une valeur déjà posée sur la requête
        try {
            const auth = req.get('authorization'), m = auth && RE_BEARER.exec(auth);
            if (m) {
                const inst = await installationParJeton(m[1]);
                if (!inst) req.v2.echec = 'jeton-inconnu';
                else if (inst.revoqueeLe) req.v2.echec = 'installation-revoquee';
                else {
                    const lue = await compteDe(inst.compteId), compte = memeGeneration(inst, lue) ? lue : null;   // génération révolue : traitée comme non liée, donc anonyme
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
                        const lue = await compteDe(sess.compteId), compte = memeGeneration(sess, lue) ? lue : null;   // génération révolue : 401
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
module.exports = { resoudrePorteur, exigerInstallation, exigerSession, RE_BEARER, installationParJeton };
