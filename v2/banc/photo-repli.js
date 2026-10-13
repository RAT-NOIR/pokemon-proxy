'use strict';
// PHOTO-EXTENSION — le REPLI de téléchargement de la photo d'un scan d'ADMINISTRATEUR (quand l'extension n'a pas envoyé l'image). Une requête serveur vers Vinted par scan était la règle d'ETIQUETAGE-B ;
// c'est désormais un repli ESPACÉ et PLAFONNÉ : au plus un téléchargement toutes les `cfg.photoAdmin.intervalleS` secondes (défaut 10) et au plus `cfg.photoAdmin.maxJour` par jour UTC (défaut 400).
// 🔑 Le compte vit dans la BASE (un seul document `photo_admin_repli`), pas en mémoire : un redémarrage du processus ne remet rien à zéro, et plusieurs processus se partagent le même compte.
// La réservation est UNE écriture atomique conditionnelle (aucune lecture suivie d'une écriture) : 20 demandes simultanées ne passent qu'une fois sous un intervalle.
// Écrit par ce qu'elle AUTORISE : l'écriture réussit seulement si le dernier téléchargement est assez ancien ET si le plafond du jour n'est pas atteint ; tout le reste (refus, base muette, exception) = REFUS.
// Une réservation prise est consommée même si le téléchargement échoue : le plafond borne les REQUÊTES vers Vinted, pas les photos obtenues.
const db = require('../db');

const ID = 'repli';
const jourUTC = (d) => d.toISOString().slice(0, 10);

/** @returns {Promise<{ok: true}|{ok: false, cause: 'intervalle'|'plafond-jour'|'erreur'}>} — ne lève jamais. `colFn` : une collection injectable par les bancs. */
async function reserver({ cfg, maintenant = new Date(), colFn = () => db.col('photo_admin_repli') } = {}) {
    try {
        const { intervalleS, maxJour } = cfg.photoAdmin;
        if (maxJour <= 0) return { ok: false, cause: 'plafond-jour' };
        const jour = jourUTC(maintenant), seuil = new Date(maintenant.getTime() - intervalleS * 1000);
        const col = colFn();
        try {
            const r = await col.updateOne(
                { _id: ID, dernier: { $lte: seuil }, $or: [{ jour: { $ne: jour } }, { n: { $lt: maxJour } }] },
                [{ $set: { n: { $cond: [{ $eq: ['$jour', jour] }, { $add: ['$n', 1] }, 1] }, jour, dernier: maintenant } }],
                { upsert: true });
            if (r.modifiedCount === 1 || r.upsertedCount === 1) return { ok: true };
        } catch (e) {
            if (!(e && e.code === 11000)) throw e;                                         // document présent mais condition fausse : l'upsert tente d'insérer le même _id -> refus
        }
        const d = await col.findOne({ _id: ID });
        return { ok: false, cause: d && d.jour === jour && d.n >= maxJour ? 'plafond-jour' : 'intervalle' };
    } catch { return { ok: false, cause: 'erreur' }; }
}

module.exports = { reserver };
