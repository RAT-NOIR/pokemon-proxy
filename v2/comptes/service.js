'use strict';
const { col } = require('../db'); const M = require('../modeles');
const J = require('./jetons'); const P = require('./mots-de-passe');

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
module.exports = { inscrire, URL_VERIFICATION };
