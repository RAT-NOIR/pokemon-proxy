'use strict';
// Service des comptes (lot B2).
//
// FORMAT ATTENDU DES `porteur` DES AUTRES LOTS (à confirmer à l'intégration avec B3) : `analyses.porteur`, `questions.porteur` et
// `plafonds.porteur` sont des chaînes `compte:<_id du compte>` (ou, à défaut, l'_id nu). La suppression d'un compte purge ces trois
// collections avec CE filtre ; si B3 écrit un autre format, rien n'est purgé en silence et c'est B3 qui doit s'aligner ou m'en informer.
// `hebdo.compteId` est l'ObjectId du compte (index du plan).
const crypto = require('crypto');
const { col } = require('../db'); const M = require('../modeles'); const L = require('../transport/limites');
const J = require('./jetons'); const P = require('./mots-de-passe'); const S = require('./sessions'); const { emailCle, cleBoite } = require('./email-cle'); const Pg = require('./purge');

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

/**
 * O3 — UN courriel de confirmation par adresse et par 24 h, inscription et renvoi CONFONDUS (compteur persistant `limites`, fenêtre glissante, par empreinte d'adresse). Rend vrai si le courriel est parti
 * (ou a échoué à partir : la prise est consommée, un pilote en panne ne se rattrape pas en bombardant une boîte). Appelé APRÈS la réponse (travail détaché) : la limite ne se lit jamais dans la réponse.
 */
async function confirmer(compte, cle, cfg, courrier, nom, maintenant) {
    // la limite se compte par BOÎTE (O3 tour 1, I-2) : `victime+a@outlook.com` et `victime+b@outlook.com` partagent le même compteur ; la clé du COMPTE (emailCle) ne change pas
    const r = await L.reserver(`confirmation:${J.empreinte(cleBoite(cle))}`, { delaiMs: cfg.comptes.confirmationHeures * HEURE, maintenant });
    if (!r.permis) return false;
    const jeton = await ecrireLien(compte._id, 'verification', cfg, maintenant);
    await envoyer(nom, () => courrier.envoyerVerification(compte.email, lienVerification(cfg, jeton), { purgeHeures: cfg.comptes.nonConfirmeHeures }));
    return true;
}

/**
 * Crée un compte INACTIF + son lien de vérification (l'inscription ne donne aucun porteur : voir `connecter`). Le travail est détaché de la réponse, qui est la même quelle que soit l'adresse.
 * Adresse déjà prise : confirmée = rien ; en attente = le PREMIER inscrit garde la place (ni mot de passe ni rien d'autre ne change) et un courriel part SEULEMENT si la limite le permet ;
 * en attente depuis 48 h ou plus (balayage pas encore passé) = ce compte est purgé à l'instant, l'adresse est libre. Le hachage est calculé dans tous les cas.
 */
function inscrire({ email, emailCle, motDePasse, cfg, courrier, maintenant = new Date() }) {
    return detacher('inscription', async () => {
        const hash = await P.hacher(motDePasse);
        const compte = M.nouveauCompte({ email, emailCle, motDePasse: hash, now: maintenant });
        for (let tour = 0; ; tour++) {
            try { await col('comptes').insertOne(compte); break; }
            catch (e) {
                if (e.code !== 11000) throw e;
                const existant = await col('comptes').findOne({ emailCle });
                if (!existant || existant.verifie !== false) return;                                                  // confirmé (ou illisible) : silence
                if (tour === 0 && Pg.perime(existant, cfg, maintenant)) { await Pg.purgerCompte(existant, cfg, maintenant); continue; }   // périmé : l'adresse est libre, on réessaie UNE fois
                if (tour === 0 && !(await col('comptes').findOne({ _id: existant._id }))) continue;                    // purgé entre-temps
                if (Pg.perime(existant, cfg, maintenant)) return;                                                     // périmé et non purgeable (porteur d'un crédit...) : jamais de courriel pour lui
                await confirmer(existant, emailCle, cfg, courrier, 'inscription', maintenant);
                return;
            }
        }
        await confirmer(compte, emailCle, cfg, courrier, 'inscription', maintenant);
    });
}

/** Renvoi du lien de vérification d'un compte NON vérifié et NON périmé (I3a). Mêmes limites que l'inscription : un courriel par adresse et par 24 h (O3). */
function renvoyerVerification({ email, cfg, courrier, maintenant = new Date() }) {
    return detacher('renvoi-verification', async () => {
        const cle = typeof email === 'string' && email.length <= 254 ? emailCle(email) : null;
        const compte = cle ? await col('comptes').findOne({ emailCle: cle }) : null;
        if (!compte || compte.verifie !== false) return;
        if (Pg.perime(compte, cfg, maintenant)) { await Pg.purgerCompte(compte, cfg, maintenant); return; }
        await confirmer(compte, cle, cfg, courrier, 'renvoi-verification', maintenant);
    });
}

/** Mot de passe oublié : adresse inconnue = rien (ni lien, ni courrier). L'appelant répond 202 dans tous les cas, sans attendre. */
function demanderReinit({ email, cfg, courrier, maintenant = new Date() }) {
    return detacher('mot-de-passe-oublie', async () => {
        const cle = typeof email === 'string' && email.length <= 254 ? emailCle(email) : null;
        const compte = cle ? await col('comptes').findOne({ emailCle: cle }) : null;
        if (!compte) return;
        if (Pg.perime(compte, cfg, maintenant)) { await Pg.purgerCompte(compte, cfg, maintenant); return; }   // O3 : pas de lien de réinitialisation pour un compte non confirmé de 48 h ou plus (il serait refusé)
        // B8 (tour 1, O1 corrigé) : le courrier n'est pas une arme — au plus `renvoiParCompteHeure` liens par ADRESSE et par heure, d'où que viennent les demandes (le plafond par IP se contourne avec des IP).
        // Le travail est DÉTACHÉ : la réponse (202) est partie avant ce calcul, elle est donc la même que la limite morde ou non — aucune énumération par la limite. Patron de renvoyerVerification.
        // O3 (tour 1, I-2) : la limite O1 suit la même clé de BOÎTE (sinon des alias `+x` de comptes distincts contourneraient « 3 par heure »)
        const r = await L.consommer(`reinit:${J.empreinte(cleBoite(cle))}`, { max: cfg.limites.renvoiParCompteHeure, fenetreMs: HEURE, maintenant });
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
    if (Pg.perime(compte, cfg, maintenant)) { await Pg.purgerCompte(compte, cfg, maintenant); return false; }   // O3 : un compte non confirmé de 48 h ou plus ne s'active plus (il va être, ou est déjà, purgé)
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
    // O3 : « vrai » ne se dit que d'un compte PRÉSENT et confirmé. La purge peut avoir supprimé le compte entre la lecture et les écritures ci-dessus (elles ne trouvent alors rien et ne
    // lèvent pas) : sans cette relecture, la vérification répondrait 200 pour un compte qui n'existe plus.
    return Boolean(await col('comptes').findOne({ _id: compteId, verifie: true }, { projection: { _id: 1 } }));
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
    // O3 : le scrypt est payé AVANT de regarder l'état du compte — un compte non confirmé répond comme un mauvais mot de passe (même calcul, même réponse) ; ni le statut, ni le corps, ni le temps ne disent
    // que l'adresse existe. Écrit par ce qu'il AUTORISE : seul `verifie === true` ouvre une session.
    const motDePasseBon = await P.verifier(mdp, compte.motDePasse);
    if (!motDePasseBon || compte.verifie !== true) return { ok: false };
    // O3 tour 2 (I-A) : la génération est celle lue AVEC le compte, avant le hachage ci-dessus : une réinitialisation survenue pendant le hachage rend cette session inutilisable
    const session = await S.creerSession(compte._id, maintenant, cfg.comptes.sessionJours, Number.isInteger(compte.generation) ? compte.generation : null);
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
    if (Pg.perime(compte, cfg, maintenant)) { await Pg.purgerCompte(compte, cfg, maintenant); return refus('inconnu'); }   // O3 : pas de réactivation d'un compte non confirmé de 48 h ou plus
    const faute = P.politique(motDePasse, compte.emailCle);
    if (faute) return { statut: 422, code: 'MOT_DE_PASSE_FAIBLE', detail: faute };
    const hash = await P.hacher(motDePasse);
    if (!(await bruler(v.lien, maintenant))) return refus('inconnu');
    // O3 tour 2 (I-A) : la GÉNÉRATION d'abord, dans la même écriture atomique que le nouveau mot de passe. Un ordre d'opérations (sessions, puis installations, puis codes) ne ferme pas une requête déjà
    // partie ; une génération, si : tout objet qui ouvre un accès au compte (session, code de liaison, installation liée) porte celle qu'il a lue, et n'est accepté que si elle est ÉGALE à celle du compte.
    await col('comptes').updateOne({ _id: compte._id }, { $set: { motDePasse: hash }, $inc: { generation: 1 } });
    await col('liens_email').updateMany({ compteId: compte._id, type: 'reinit', utiliseLe: null }, { $set: { utiliseLe: maintenant } });
    await col('sessions').deleteMany({ compteId: compte._id });
    // O3 (tour 1, I-1) : « ferme TOUT accès » — la session n'est qu'une porte. Les installations LIÉES (l'extension, par son jeton) et les codes de liaison vivants en sont deux autres.
    // Les installations sont DÉLIÉES (comme `delier`), pas révoquées : le jeton du tiers ne résout plus aucun porteur compte, et l'installation légitime de la victime reste utilisable comme
    // installation seule (elle se relie par un code, sans réinstaller) ; le tiers ne peut pas la relier sans session. Les essais restent inchangés (pas de nouvel essai). Les codes vivants sont supprimés.
    await col('installations').updateMany({ compteId: compte._id }, { $set: { compteId: null } });
    await col('codes_liaison').deleteMany({ compteId: compte._id });
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
    await col('scans_en_cours').deleteMany({ 'porteur.type': 'compte', 'porteur.id': id });   // O5 : les marques de livraison du compte partent avec lui (celles de ses installations restent : l'installation survit)
    await col('questions_v2').deleteMany({ porteur: { $in: porteurs } });
    await col('plafonds').deleteMany({ porteur: { $in: porteurs } });
    await col('hebdo').deleteMany({ compteId: id });
    await col('codes_liaison').deleteMany({ compteId: id });
    await col('liens_email').deleteMany({ compteId: id });
    await require('../collection/service').supprimerDuCompte(id, cfg);                      // « Ma collection » part avec le compte
    await col('comptes').deleteOne({ _id: id });                                       // en dernier : une panne en cours de route se rejoue
    return { statut: 200 };
}
module.exports = { inscrire, renvoyerVerification, demanderReinit, attendre, consommerLien, verifierAdresse, accorderOffertes, empreinteAdresse, connecter, deconnecter, reinitialiser, installationsDuCompte, supprimerCompte };
