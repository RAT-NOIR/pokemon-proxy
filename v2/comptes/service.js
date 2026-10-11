'use strict';
// Service des comptes (lot B2).
//
// FORMAT ATTENDU DES `porteur` DES AUTRES LOTS (à confirmer à l'intégration avec B3) : `analyses.porteur`, `questions.porteur` et
// `plafonds.porteur` sont des chaînes `compte:<_id du compte>` (ou, à défaut, l'_id nu). La suppression d'un compte purge ces trois
// collections avec CE filtre ; si B3 écrit un autre format, rien n'est purgé en silence et c'est B3 qui doit s'aligner ou m'en informer.
// `hebdo.compteId` est l'ObjectId du compte (index du plan).
const crypto = require('crypto');
const { col } = require('../db'); const M = require('../modeles'); const L = require('../transport/limites');
const J = require('./jetons'); const P = require('./mots-de-passe'); const S = require('./sessions'); const { emailCle } = require('./email-cle');

const HEURE = 3600e3;

// ---- travail détaché de la réponse (I2) --------------------------------------------------------------------------------------------
// Inscription, mot de passe oublié et renvoi répondent 202 AVANT de travailler : le temps de réponse ne dépend ni de l'existence de
// l'adresse, ni de la lenteur du courrier. Une panne est journalisée par son NOM d'erreur seul : jamais le message du pilote (qui peut
// contenir l'adresse), jamais l'adresse.
const enCours = new Set();
function detacher(nom, fn) {
    const p = Promise.resolve().then(fn)
        .catch(e => console.error(`❌ [v2 ${nom}] travail détaché en échec (${(e && e.name) || 'Error'})`))
        .finally(() => enCours.delete(p));
    enCours.add(p);
    return p;
}
async function attendre() { while (enCours.size) await Promise.all([...enCours]); }
async function envoyer(nom, f) { try { await f(); } catch (e) { console.error(`❌ [v2 ${nom}] envoi du courrier en échec (${(e && e.name) || 'Error'})`); } }

const lienVerification = (cfg, jeton) => `${cfg.urls.verification}?jeton=${jeton}`;
async function ecrireLien(compteId, type, cfg, maintenant) {
    const jeton = J.genererJeton();
    await col('liens_email').insertOne({ empreinte: J.empreinte(jeton), type, compteId, creeLe: maintenant, expireLe: new Date(maintenant.getTime() + cfg.comptes.lienHeures * HEURE), utiliseLe: null });
    return jeton;
}

/** Crée un compte neutre + son lien de vérification. Une adresse déjà prise est SILENCIEUSE ; le hachage est calculé dans les deux cas. */
function inscrire({ email, emailCle, motDePasse, cfg, courrier, maintenant = new Date() }) {
    return detacher('inscription', async () => {
        const hash = await P.hacher(motDePasse);
        const compte = M.nouveauCompte({ email, emailCle, motDePasse: hash, now: maintenant });
        try { await col('comptes').insertOne(compte); }
        catch (e) { if (e.code === 11000) return; throw e; }
        const jeton = await ecrireLien(compte._id, 'verification', cfg, maintenant);
        await envoyer('inscription', () => courrier.envoyerVerification(email, lienVerification(cfg, jeton)));
    });
}

/** Renvoi du lien de vérification d'un compte NON vérifié (I3a). Au plus `renvoiParCompteHeure` par adresse et par heure. */
function renvoyerVerification({ email, cfg, courrier, maintenant = new Date() }) {
    return detacher('renvoi-verification', async () => {
        const cle = typeof email === 'string' && email.length <= 254 ? emailCle(email) : null;
        const compte = cle ? await col('comptes').findOne({ emailCle: cle }) : null;
        if (!compte || compte.verifie) return;
        const r = await L.consommer(`renvoi:${J.empreinte(cle)}`, { max: cfg.limites.renvoiParCompteHeure, fenetreMs: HEURE, maintenant });
        if (!r.permis) return;
        const jeton = await ecrireLien(compte._id, 'verification', cfg, maintenant);
        await envoyer('renvoi-verification', () => courrier.envoyerVerification(compte.email, lienVerification(cfg, jeton)));
    });
}

/** Mot de passe oublié : adresse inconnue = rien (ni lien, ni courrier). L'appelant répond 202 dans tous les cas, sans attendre. */
function demanderReinit({ email, cfg, courrier, maintenant = new Date() }) {
    return detacher('mot-de-passe-oublie', async () => {
        const cle = typeof email === 'string' && email.length <= 254 ? emailCle(email) : null;
        const compte = cle ? await col('comptes').findOne({ emailCle: cle }) : null;
        if (!compte) return;
        // B8 (tour 1, O1 corrigé) : le courrier n'est pas une arme — au plus `renvoiParCompteHeure` liens par ADRESSE et par heure, d'où que viennent les demandes (le plafond par IP se contourne avec des IP).
        // Le travail est DÉTACHÉ : la réponse (202) est partie avant ce calcul, elle est donc la même que la limite morde ou non — aucune énumération par la limite. Patron de renvoyerVerification.
        const r = await L.consommer(`reinit:${J.empreinte(cle)}`, { max: cfg.limites.renvoiParCompteHeure, fenetreMs: HEURE, maintenant });
        if (!r.permis) return;
        const jeton = await ecrireLien(compte._id, 'reinit', cfg, maintenant);
        await envoyer('mot-de-passe-oublie', () => courrier.envoyerReinitialisation(compte.email, `${cfg.urls.reinit}?jeton=${jeton}`));
    });
}

// ---- liens à usage unique -----------------------------------------------------------------------------------------------------------
/** Regarde un lien SANS le consommer. → { lien } | { echec: 'inconnu' | 'expire' } ; « expiré » ne se dit que d'un lien encore inutilisé. */
async function lienVivant(jeton, type, maintenant) {
    if (typeof jeton !== 'string' || !jeton || jeton.length > 128) return { echec: 'inconnu' };
    const lien = await col('liens_email').findOne({ empreinte: J.empreinte(jeton), type, utiliseLe: null });
    if (!lien) return { echec: 'inconnu' };
    return lien.expireLe > maintenant ? { lien } : { echec: 'expire' };
}
/** Brûle un lien (atomique) : vrai pour UN seul des appelants simultanés. */
async function bruler(lien, maintenant) {
    return Boolean(await col('liens_email').findOneAndUpdate({ _id: lien._id, utiliseLe: null, expireLe: { $gt: maintenant } }, { $set: { utiliseLe: maintenant } }, { returnDocument: 'after' }));
}
/** Consomme un lien d'un coup (vérifie puis brûle) : sert à la réinitialisation. */
async function consommerLien(jeton, type, maintenant) {
    const v = await lienVivant(jeton, type, maintenant);
    if (v.echec) return v;
    return (await bruler(v.lien, maintenant)) ? { lien: v.lien } : { echec: 'inconnu' };
}
const refus = echec => (echec === 'expire' ? { statut: 410, code: 'CODE_EXPIRE' } : { statut: 404, code: 'CODE_INVALIDE' });

// ---- 25 offertes : une fois par COMPTE et une fois par ADRESSE (I1) -----------------------------------------------------------------
/** HMAC-SHA256 de l'emailCle sous le secret serveur : sans le secret, l'empreinte ne se retrouve pas par dictionnaire d'adresses. */
function empreinteAdresse(cle, cfg) {
    if (!cfg.empreinte || !cfg.empreinte.secret) throw new Error('secret-empreinte-absent');   // fail-closed : jamais d'empreinte sans secret
    return crypto.createHmac('sha256', cfg.empreinte.secret).update(`octroi|${cle}`).digest('hex');
}
async function noterAdresse(cle, cfg, maintenant) {
    await col('adresses_octroyees').updateOne({ empreinte: empreinteAdresse(cle, cfg) },
        { $setOnInsert: { creeLe: maintenant }, $max: { expireLe: new Date(maintenant.getTime() + cfg.empreinte.jours * 86400e3) } }, { upsert: true });
}

/** Marque le compte vérifié et lui accorde les offertes UNE fois. Garde 1 : l'empreinte de l'adresse (un compte supprimé puis recréé ne
 *  reçoit rien) ; garde 2 : `offertesAccordeesLe: null` dans l'écriture elle-même (atomique). Idempotent : on peut le rejouer sans risque.
 *  → false si le compte n'existe plus. */
async function accorderOffertes(compteId, cfg, maintenant) {
    const compte = await col('comptes').findOne({ _id: compteId });
    if (!compte) return false;
    const dejaOctroyee = await col('adresses_octroyees').findOne({ empreinte: empreinteAdresse(compte.emailCle, cfg) });
    const r = dejaOctroyee ? { modifiedCount: 0 } : await col('comptes').updateOne({ _id: compteId, offertesAccordeesLe: null },
        { $set: { verifie: true, verifieLe: maintenant, offertesAccordeesLe: maintenant }, $inc: { 'solde.accueil': cfg.quotas.accueil } });
    if (r.modifiedCount === 1) {
        try { await noterAdresse(compte.emailCle, cfg, maintenant); } catch (e) { console.error(`❌ [v2 octroi] empreinte d'adresse non écrite (${(e && e.name) || 'Error'}) — réécrite à la suppression du compte`); }
        try {
            await col('mouvements').insertOne({ compteId, le: maintenant, surface: null, type: 'octroi', delta: cfg.quotas.accueil, poche: 'accueil',
                motif: 'octroi-accueil', scanId: null, etat: 'debite', cleIdempotence: `octroi-accueil|${compteId}`, expireLe: new Date(maintenant.getTime() + cfg.retention.octroiJours * 86400e3) });
        } catch (e) { if (e.code !== 11000) console.error(`❌ [v2 octroi] mouvement d'octroi non écrit (${(e && e.name) || 'Error'}) — la réconciliation imprimera l'écart`); }
    } else {
        await col('comptes').updateOne({ _id: compteId, verifie: false }, { $set: { verifie: true, verifieLe: maintenant } });   // jamais d'octroi hors des deux gardes
    }
    return true;
}

/** Vérification de l'adresse. Ordre : lien regardé, octroi (idempotent), PUIS lien brûlé : une panne entre les deux laisse un lien rejouable
 *  et ne perd jamais les 25. */
async function verifierAdresse({ jeton, cfg, maintenant = new Date() }) {
    const v = await lienVivant(jeton, 'verification', maintenant);
    if (v.echec) return refus(v.echec);
    if (!(await accorderOffertes(v.lien.compteId, cfg, maintenant))) return refus('inconnu');
    if (!(await bruler(v.lien, maintenant))) return refus('inconnu');   // un concurrent l'a brûlé : une seule réponse 200
    return { statut: 200 };
}

// ---- connexion ----------------------------------------------------------------------------------------------------------------------
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

/** Réinitialisation. Ordre : (1) le lien existe et est vivant (sans le consommer), (2) le mot de passe est acceptable, (3) le hachage est prêt,
 *  (4) SEULEMENT ALORS le lien est consommé (atomique) ; un refus de politique ne brûle donc pas le lien. Révoque toutes les sessions du compte.
 *  Un lien de réinitialisation consommé prouve le contrôle de la boîte : il vérifie l'adresse et déclenche le MÊME octroi unique (I3b). */
async function reinitialiser({ jeton, motDePasse, cfg, maintenant = new Date() }) {
    const v = await lienVivant(jeton, 'reinit', maintenant);
    if (v.echec) return refus(v.echec);
    const compte = await col('comptes').findOne({ _id: v.lien.compteId });
    if (!compte) return refus('inconnu');
    const faute = P.politique(motDePasse, compte.emailCle);
    if (faute) return { statut: 422, code: 'MOT_DE_PASSE_FAIBLE', detail: faute };
    const hash = await P.hacher(motDePasse);
    if (!(await bruler(v.lien, maintenant))) return refus('inconnu');
    await col('comptes').updateOne({ _id: compte._id }, { $set: { motDePasse: hash } });
    await col('liens_email').updateMany({ compteId: compte._id, type: 'reinit', utiliseLe: null }, { $set: { utiliseLe: maintenant } });
    await col('sessions').deleteMany({ compteId: compte._id });
    try { await accorderOffertes(compte._id, cfg, maintenant); }
    catch (e) { console.error(`❌ [v2 reinitialisation] octroi non fait (${(e && e.name) || 'Error'}) — le renvoi du lien de vérification le rejoue`); }
    return { statut: 200 };
}

/** Installations VIVANTES d'un compte, sous la forme publique (jamais d'empreinte). */
async function installationsDuCompte(compteId) {
    const l = await col('installations').find({ compteId, revoqueeLe: null }).sort({ creeLe: 1 }).toArray();
    return l.map(i => ({ id: i._id, libelle: i.libelle, lieeLe: i.lieeLe, derniereAnalyse: i.derniereAnalyseLe }));
}

/** Suppression : mot de passe revérifié, refus tant qu'il reste des crédits achetés sans renonciation EXPRESSE (`=== true`).
 *  Rien n'est supprimé avant que ces gardes aient passé. Un compte qui a reçu ses offertes laisse l'empreinte de son adresse (écrite AVANT
 *  la suppression : si elle échoue, rien n'est supprimé). */
async function supprimerCompte({ compte, motDePasse, renonciation, cfg, maintenant = new Date() }) {
    if (!(await P.verifier(typeof motDePasse === 'string' ? motDePasse : '', compte.motDePasse))) return { statut: 401, code: 'IDENTIFIANTS' };
    if ((compte.solde && compte.solde.achete > 0) && renonciation !== true) return { statut: 409, code: 'CREDITS_ACHETES' };
    const id = compte._id, porteurs = [`compte:${id}`, String(id)];
    if (compte.offertesAccordeesLe) await noterAdresse(compte.emailCle, cfg, maintenant);
    await col('sessions').deleteMany({ compteId: id });                               // d'abord : le cookie cesse de valoir tout de suite
    await col('installations').updateMany({ compteId: id }, { $set: { compteId: null, essais: 0 } });
    await col('mouvements').updateMany({ compteId: id }, { $unset: { compteId: '' }, $set: { supprime: true } });
    await col('analyses').deleteMany({ porteur: { $in: porteurs } });
    await col('questions').deleteMany({ porteur: { $in: porteurs } });
    await col('plafonds').deleteMany({ porteur: { $in: porteurs } });
    await col('hebdo').deleteMany({ compteId: id });
    await col('codes_liaison').deleteMany({ compteId: id });
    await col('liens_email').deleteMany({ compteId: id });
    await require('../collection/service').supprimerDuCompte(id, cfg);                      // « Ma collection » part avec le compte
    await col('comptes').deleteOne({ _id: id });                                       // en dernier : une panne en cours de route se rejoue
    return { statut: 200 };
}
module.exports = { inscrire, renvoyerVerification, demanderReinit, attendre, consommerLien, verifierAdresse, accorderOffertes, empreinteAdresse, connecter, deconnecter, reinitialiser, installationsDuCompte, supprimerCompte };
