'use strict';
const { col } = require('../db'); const M = require('../modeles');
const J = require('./jetons'); const P = require('./mots-de-passe'); const S = require('./sessions'); const { emailCle } = require('./email-cle');

const URL_VERIFICATION = () => process.env.V2_URL_VERIFICATION || 'https://rat-market.fr/fr/verification';

/** Crée un compte neutre + son lien de vérification. Une adresse déjà prise est SILENCIEUSE (anti-énumération) :
 *  le hachage est calculé dans les deux cas pour que le temps de réponse ne dise rien. */
async function inscrire({ email, emailCle, motDePasse, cfg, courrier, maintenant = new Date() }) {
    const hash = await P.hacher(motDePasse);
    const compte = M.nouveauCompte({ email, emailCle, motDePasse: hash, now: maintenant });
    try { await col('comptes').insertOne(compte); }
    catch (e) { if (e.code === 11000) return { cree: false }; throw e; }
    const jeton = J.genererJeton();
    await col('liens_email').insertOne({ empreinte: J.empreinte(jeton), type: 'verification', compteId: compte._id, creeLe: maintenant,
        expireLe: new Date(maintenant.getTime() + cfg.comptes.lienHeures * 3600e3), utiliseLe: null });
    try { await courrier.envoyerVerification(email, `${URL_VERIFICATION()}?jeton=${jeton}`); }
    catch (e) { console.error(`❌ [v2 inscription] envoi du courrier en échec (${e.message})`); }   // jamais l'adresse dans le journal
    return { cree: true, compteId: compte._id };
}
/** Consomme un lien à usage unique (atomique). → { lien } | { echec: 'inconnu' | 'expire' }.
 *  Un lien échu ou déjà utilisé n'est jamais consommé ; « expiré » ne se dit que d'un lien encore inutilisé. */
async function consommerLien(jeton, type, maintenant) {
    if (typeof jeton !== 'string' || !jeton || jeton.length > 128) return { echec: 'inconnu' };
    const empreinte = J.empreinte(jeton);
    const lien = await col('liens_email').findOneAndUpdate({ empreinte, type, utiliseLe: null, expireLe: { $gt: maintenant } }, { $set: { utiliseLe: maintenant } }, { returnDocument: 'after' });
    if (lien) return { lien };
    const vu = await col('liens_email').findOne({ empreinte, type, utiliseLe: null });
    return { echec: vu ? 'expire' : 'inconnu' };
}

/** Vérifie l'adresse et accorde les offertes UNE fois : le filtre `offertesAccordeesLe: null` est l'unique garde, posée dans l'écriture elle-même. */
async function verifierAdresse({ jeton, cfg, maintenant = new Date() }) {
    const c = await consommerLien(jeton, 'verification', maintenant);
    if (c.echec) return { statut: c.echec === 'expire' ? 410 : 404, code: c.echec === 'expire' ? 'CODE_EXPIRE' : 'CODE_INVALIDE' };
    const compteId = c.lien.compteId;
    const r = await col('comptes').updateOne({ _id: compteId, offertesAccordeesLe: null },
        { $set: { verifie: true, verifieLe: maintenant, offertesAccordeesLe: maintenant }, $inc: { 'solde.accueil': cfg.quotas.accueil } });
    if (r.modifiedCount === 1) {
        try {
            await col('mouvements').insertOne({ compteId, le: maintenant, surface: null, type: 'octroi', delta: cfg.quotas.accueil, poche: 'accueil',
                motif: 'octroi-accueil', scanId: null, etat: 'debite', cleIdempotence: `octroi-accueil|${compteId}`, expireLe: new Date(maintenant.getTime() + 730 * 86400e3) });
        } catch (e) { if (e.code !== 11000) console.error(`❌ [v2 verification] mouvement d'octroi non écrit (${e.message}) — la réconciliation imprimera l'écart`); }
    } else {
        const e = await col('comptes').updateOne({ _id: compteId, verifie: false }, { $set: { verifie: true, verifieLe: maintenant } });   // déjà accordé : jamais d'octroi sans le filtre
        if (e.matchedCount === 0 && await col('comptes').countDocuments({ _id: compteId }) === 0) return { statut: 404, code: 'CODE_INVALIDE' };
    }
    return { statut: 200 };
}
/** Vérifie un couple adresse/mot de passe. Une adresse inconnue ou invalide paie le même calcul scrypt (verifierFactice) : le temps ne dit rien. */
async function connecter({ email, motDePasse, cfg, maintenant = new Date() }) {
    const cle = typeof email === 'string' && email.length <= 254 ? emailCle(email) : null;
    const mdp = typeof motDePasse === 'string' && motDePasse.length <= 1000 ? motDePasse : '';
    const compte = cle ? await col('comptes').findOne({ emailCle: cle }) : null;
    if (!compte) { await P.verifierFactice(mdp); return { ok: false }; }
    if (!(await P.verifier(mdp, compte.motDePasse))) return { ok: false };
    const session = await S.creerSession(compte._id, maintenant, cfg.comptes.sessionJours);
    await col('comptes').updateOne({ _id: compte._id }, { $set: { derniereConnexionLe: maintenant } });
    return { ok: true, compte, session };
}
async function deconnecter(token) {
    if (typeof token !== 'string' || !token) return 0;
    return (await col('sessions').deleteOne({ tokenEmpreinte: J.empreinte(token) })).deletedCount;
}
const URL_REINIT = () => process.env.V2_URL_REINIT || 'https://rat-market.fr/fr/reinitialisation';

/** Mot de passe oublié : adresse inconnue = rien (ni lien, ni courrier). L'appelant répond 202 dans tous les cas. */
async function demanderReinit({ email, cfg, courrier, maintenant = new Date() }) {
    const cle = typeof email === 'string' && email.length <= 254 ? emailCle(email) : null;
    const compte = cle ? await col('comptes').findOne({ emailCle: cle }) : null;
    if (!compte) return { envoye: false };
    const jeton = J.genererJeton();
    await col('liens_email').insertOne({ empreinte: J.empreinte(jeton), type: 'reinit', compteId: compte._id, creeLe: maintenant,
        expireLe: new Date(maintenant.getTime() + cfg.comptes.lienHeures * 3600e3), utiliseLe: null });
    try { await courrier.envoyerReinitialisation(compte.email, `${URL_REINIT()}?jeton=${jeton}`); }
    catch (e) { console.error(`❌ [v2 mot-de-passe-oublie] envoi du courrier en échec (${e.message})`); }
    return { envoye: true };
}

/** Réinitialisation. Ordre : (1) le lien existe et est vivant (sans le consommer), (2) le mot de passe est acceptable, (3) le hachage est prêt,
 *  (4) SEULEMENT ALORS le lien est consommé (atomique) ; un refus de politique ne brûle donc pas le lien. Révoque toutes les sessions du compte. */
async function reinitialiser({ jeton, motDePasse, maintenant = new Date() }) {
    if (typeof jeton !== 'string' || !jeton || jeton.length > 128) return { statut: 404, code: 'CODE_INVALIDE' };
    const empreinte = J.empreinte(jeton);
    const vivant = await col('liens_email').findOne({ empreinte, type: 'reinit', utiliseLe: null });
    if (!vivant) return { statut: 404, code: 'CODE_INVALIDE' };
    if (!(vivant.expireLe > maintenant)) return { statut: 410, code: 'CODE_EXPIRE' };
    const compte = await col('comptes').findOne({ _id: vivant.compteId });
    if (!compte) return { statut: 404, code: 'CODE_INVALIDE' };
    const faute = P.politique(motDePasse, compte.emailCle);
    if (faute) return { statut: 422, code: 'MOT_DE_PASSE_FAIBLE', detail: faute };
    const hash = await P.hacher(motDePasse);
    const c = await consommerLien(jeton, 'reinit', maintenant);
    if (c.echec) return { statut: c.echec === 'expire' ? 410 : 404, code: c.echec === 'expire' ? 'CODE_EXPIRE' : 'CODE_INVALIDE' };
    await col('comptes').updateOne({ _id: compte._id }, { $set: { motDePasse: hash } });
    await col('liens_email').updateMany({ compteId: compte._id, type: 'reinit', utiliseLe: null }, { $set: { utiliseLe: maintenant } });
    await col('sessions').deleteMany({ compteId: compte._id });
    return { statut: 200 };
}
/** Installations VIVANTES d'un compte, sous la forme publique (jamais d'empreinte). */
async function installationsDuCompte(compteId) {
    const l = await col('installations').find({ compteId, revoqueeLe: null }).sort({ creeLe: 1 }).toArray();
    return l.map(i => ({ id: i._id, libelle: i.libelle, lieeLe: i.lieeLe, derniereAnalyse: i.derniereAnalyseLe }));
}

/** Suppression : mot de passe revérifié, refus tant qu'il reste des crédits achetés sans renonciation EXPRESSE (`=== true`).
 *  Rien n'est supprimé avant que ces deux gardes aient passé. */
async function supprimerCompte({ compte, motDePasse, renonciation }) {
    if (!(await P.verifier(typeof motDePasse === 'string' ? motDePasse : '', compte.motDePasse))) return { statut: 401, code: 'IDENTIFIANTS' };
    if ((compte.solde && compte.solde.achete > 0) && renonciation !== true) return { statut: 409, code: 'CREDITS_ACHETES' };
    const id = compte._id;
    await col('sessions').deleteMany({ compteId: id });                               // d'abord : le cookie cesse de valoir tout de suite
    await col('installations').updateMany({ compteId: id }, { $set: { compteId: null, essais: 0 } });
    await col('mouvements').updateMany({ compteId: id }, { $unset: { compteId: '' }, $set: { supprime: true } });
    await col('analyses').deleteMany({ porteur: { $in: [`compte:${id}`, String(id)] } });
    await col('codes_liaison').deleteMany({ compteId: id });
    await col('liens_email').deleteMany({ compteId: id });
    await col('comptes').deleteOne({ _id: id });                                       // en dernier : une panne en cours de route se rejoue
    return { statut: 200 };
}
module.exports = { inscrire, URL_VERIFICATION, consommerLien, verifierAdresse, connecter, deconnecter, demanderReinit, reinitialiser, installationsDuCompte, supprimerCompte };
