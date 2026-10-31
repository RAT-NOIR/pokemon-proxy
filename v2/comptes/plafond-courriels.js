'use strict';
// BREVO — le plafond quotidien de courriels (offre gratuite de Brevo : 300 par jour). UN compteur par jour de Paris dans `courriels_jour`, incrémenté de façon ATOMIQUE : la condition
// `n < limite` est dans le filtre de l'écriture, donc N processus ou N demandes simultanées ne dépassent jamais le plafond (le dépassement d'un upsert sur un jour déjà ouvert est une clé dupliquée = « plein »).
// Deux classes : `securite` (vérification, mot de passe oublié) va jusqu'à `max` ; `avertissement` s'arrête à `max − reserveSecurite`, de sorte qu'une rafale d'avertissements ne prive jamais un inscrit de son lien.
// Un envoi est compté À LA RÉSERVATION (avant la requête) : un échec ne rend pas la place, Brevo pouvant avoir accepté le message — le plafond est une borne, jamais un solde exact.
const { col } = require('../db');

const FORMAT_JOUR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** « 2026-11-12 » : le jour civil à Paris (Brevo remet son compteur à minuit, heure d'Europe centrale). */
const jourDeParis = (d = new Date()) => FORMAT_JOUR.format(d);
/** Réserve par défaut : 20 % du plafond, jamais le plafond entier (au moins une place d'avertissement n'est pas exigée : un plafond de 1 n'en a aucune). */
const reserveParDefaut = max => Math.min(Math.ceil(max * 0.2), max - 1);

function creerPlafondJour({ max, reserveSecurite = reserveParDefaut(max), maintenant = () => new Date() } = {}) {
    if (!Number.isInteger(max) || max < 1) throw new Error('plafond de courriels invalide');
    if (!Number.isInteger(reserveSecurite) || reserveSecurite < 0 || reserveSecurite >= max) throw new Error('réserve de courriels de sécurité invalide');
    return {
        max, reserveSecurite,
        /** → true si une place du jour est prise pour cette classe, false si le plafond de la classe est atteint. Toute autre erreur (base) remonte : « je ne sais pas » n'est pas « permis ». */
        async reserver(classe) {
            if (classe !== 'securite' && classe !== 'avertissement') throw new Error('classe de courriel inconnue');
            const limite = classe === 'securite' ? max : max - reserveSecurite;
            const jour = jourDeParis(maintenant());
            try {
                await col('courriels_jour').findOneAndUpdate({ _id: jour, n: { $lt: limite } }, { $inc: { n: 1 } }, { upsert: true });
                return true;
            } catch (e) {
                if (e && e.code === 11000) return false;       // le jour existe et son compteur a atteint la limite de la classe
                throw e;
            }
        }
    };
}
module.exports = { creerPlafondJour, jourDeParis, reserveParDefaut };
