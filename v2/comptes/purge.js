'use strict';
// O3 — la purge des comptes NON CONFIRMÉS (décision du testeur : « purgés après 48 h, et l'adresse redevient libre »).
//
// POURQUOI UN BALAYAGE ET PAS UN INDEX TTL PARTIEL. Un TTL ne vise un document que par un marqueur (`purgeLe`) qu'il faudrait retirer AU CLIC : tout chemin qui active un compte
// sans le retirer (aujourd'hui `verifierAdresse` ET `reinitialiser`, demain un autre) ferait supprimer un compte CONFIRMÉ, en silence. Le balayage lit l'ÉTAT — il ne supprime que ce qui est
// `verifie: false` au moment même de la suppression, dans le filtre de la suppression : il ne peut pas frapper un compte confirmé, quel que soit le chemin qui l'a confirmé. Écrit par ce
// qu'il AUTORISE (un compte vierge, non confirmé, périmé), jamais par ce qu'il refuse.
// Passe différée au démarrage (un processus redéployé tous les jours ne verrait jamais un intervalle long) PUIS toutes les heures : un compte vit au plus 49 h. Même schéma que banc/monter.js.
const mongoose = require('mongoose');
const { col } = require('../db');

const HEURE = 3600e3;
const DIFFERE_MS = 60 * 1000, INTERVALLE_MS = HEURE;

const limite = (cfg, maintenant) => new Date(maintenant.getTime() - cfg.comptes.nonConfirmeHeures * HEURE);
/** Vrai SEULEMENT pour un compte explicitement non confirmé (`verifie === false`) créé il y a `nonConfirmeHeures` ou plus. Tout le reste (confirmé, champ absent, date illisible) : faux. */
function perime(compte, cfg, maintenant = new Date()) {
    return Boolean(compte) && compte.verifie === false && compte.creeLe instanceof Date && compte.creeLe.getTime() <= limite(cfg, maintenant).getTime();
}

/**
 * Supprime UN compte non confirmé périmé, avec ses liens de courriel. → 'purge' | 'garde' (pas périmé, déjà confirmé, ou porteur d'un crédit / d'une installation / d'un mouvement).
 * La suppression porte l'état dans son FILTRE : un clic qui confirme le compte entre la lecture et la suppression la fait ne rien supprimer (course clic / purge).
 * Un compte qui porterait autre chose que du vide (crédit, abonnement, installation liée, mouvement) n'est jamais purgé : « rien ne disparaît avec lui » est vérifié, pas supposé.
 */
async function purgerCompte(compte, cfg, maintenant = new Date()) {
    if (!perime(compte, cfg, maintenant)) return 'garde';
    const id = compte._id;
    if (await col('installations').countDocuments({ compteId: id }) || await col('mouvements').countDocuments({ compteId: id })) return 'garde';
    const r = await col('comptes').deleteOne({
        _id: id, verifie: false, offertesAccordeesLe: null, creeLe: { $lte: limite(cfg, maintenant) },
        'solde.accueil': 0, 'solde.achete': 0, 'abonnement.actif': false, stripeClient: null
    });
    if (r.deletedCount !== 1) return 'garde';
    await col('liens_email').deleteMany({ compteId: id });
    await col('sessions').deleteMany({ compteId: id });          // aucune ne devrait exister (un compte non confirmé n'a pas de porteur) ; une session orpheline ne vaudrait rien
    await col('codes_liaison').deleteMany({ compteId: id });
    await require('../collection/service').supprimerDuCompte(id, cfg);   // §21 bis : tout fichier qui supprime un compte supprime sa collection (vide ici : un compte non confirmé n'a pas de porteur pour en écrire une)
    return 'purge';
}

/** Une passe : tous les comptes non confirmés périmés. → { examines, purges, gardes }. Ne journalise jamais une adresse. */
async function purgerNonConfirmes({ cfg, maintenant = new Date() }) {
    const sortie = { examines: 0, purges: 0, gardes: 0 };
    const curseur = col('comptes').find({ verifie: false, creeLe: { $lte: limite(cfg, maintenant) } });
    for await (const compte of curseur) {
        sortie.examines++;
        if ((await purgerCompte(compte, cfg, maintenant)) === 'purge') sortie.purges++; else sortie.gardes++;
    }
    if (sortie.purges || sortie.gardes) console.log(`🧹 [v2 comptes] comptes non confirmés : ${sortie.purges} purgé(s), ${sortie.gardes} gardé(s) sur ${sortie.examines} examiné(s)`);
    return sortie;
}

async function purgerUneFois({ cfg, etatMongo = () => mongoose.connection.readyState, purge = purgerNonConfirmes } = {}) {
    try {
        if (etatMongo() !== 1) return false;                       // rien sans Mongo prêt
        await purge({ cfg, maintenant: new Date() });
        return true;
    } catch (e) { console.error(`❌ [v2 comptes-purge] passe échouée (${(e && (e.code || e.name)) || 'erreur'})`); return false; }   // jamais e.message
}

let minuteur = null, differe = null, minuteursEnCours = null;
function arreterPurge() {
    const m = minuteursEnCours || global;
    if (minuteur) { m.clearInterval(minuteur); minuteur = null; }
    if (differe) { m.clearTimeout(differe); differe = null; }
    minuteursEnCours = null;
}
/** UN différé et UN intervalle par processus, même si le montage est refait ; aucun des deux ne retient le processus (unref). */
function demarrerPurge({ cfg, minuteurs = global, differeMs = DIFFERE_MS, intervalleMs = INTERVALLE_MS, etatMongo, purge } = {}) {
    arreterPurge();
    minuteursEnCours = minuteurs;
    const passe = () => purgerUneFois({ cfg, ...(etatMongo ? { etatMongo } : {}), ...(purge ? { purge } : {}) });
    differe = minuteurs.setTimeout(passe, differeMs); differe.unref();
    minuteur = minuteurs.setInterval(passe, intervalleMs); minuteur.unref();
    return minuteur;
}
module.exports = { perime, purgerCompte, purgerNonConfirmes, purgerUneFois, demarrerPurge, arreterPurge, DIFFERE_MS, INTERVALLE_MS };
