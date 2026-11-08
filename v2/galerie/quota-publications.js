'use strict';
// GALERIE — le quota de PUBLICATIONS : `V2_PUBLICATIONS_JOUR` par compte et par JOUR CIVIL DE PARIS (la même fonction que les quotas d'analyses : argent/offre.js `jourDeParis`), classeur ou illustration : UN compteur.
//   · `verifier` (middleware, à sa place dans l'ordre des refus : après la VERIFICATION, avant le pseudo) LIT le compteur et refuse sans rien consommer : LIMITE_DEBIT quand le jour est plein ;
//   · `reserver` PREND une place, atomiquement, au moment où la publication est RÉELLEMENT faite (jamais un 404, un refus de forme, un rejeu ni une illustration déjà en attente) ; `rendre` la reprend si l'effet n'a pas eu lieu ;
//   · la fenêtre est le jour de Paris (changement d'heure compris) : la clé porte la date, et `reessayerDans` est le temps jusqu'au prochain minuit de Paris.
const G = require('./base');
const { jourDeParis } = require('../argent/offre');
const { repondreErreur } = require('../erreurs');

const cleDe = (compteId, jour) => `g-publication:${String(compteId)}:${jour}`;
/** Secondes jusqu'au prochain changement de jour de Paris (dichotomie sur jourDeParis : vrai aussi les jours de 23 h et de 25 h). */
function secondesAvantMinuitParis(maintenant) {
    const jour = jourDeParis(maintenant);
    let bas = 0, haut = 26 * 3600;
    while (haut - bas > 1) { const m = Math.floor((bas + haut) / 2); if (jourDeParis(new Date(maintenant.getTime() + m * 1000)) === jour) bas = m; else haut = m; }
    return Math.max(1, haut);
}
const estDup = e => Boolean(e) && e.code === 11000;

function creer({ max, maintenant }) {
    const quand = () => { const d = maintenant(); return d instanceof Date && !Number.isNaN(d.getTime()) ? d : new Date(); };
    /** { n, jour } : les publications faites aujourd'hui (Paris) par ce compte. */
    async function lire(compteId) {
        const jour = jourDeParis(quand());
        const doc = await G.col('limites').findOne({ cle: cleDe(compteId, jour) }, { projection: { n: 1 } });
        return { n: doc ? doc.n || 0 : 0, jour };
    }
    /** Middleware : refuse (429 LIMITE_DEBIT) si le jour est plein ; ne consomme rien. */
    async function verifier(req, res, next) {
        try {
            if (!req.v2 || !req.v2.porteur) return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
            const { n } = await lire(req.v2.porteur.id);
            if (n >= max) return repondreErreur(res, 'LIMITE_DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: secondesAvantMinuitParis(quand()) });
            return next();
        } catch (e) { console.error(`❌ [v2 galerie] quota de publications : ${(e && (e.code || e.name)) || 'erreur'}`); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }
    }
    /** { permis: true } | { permis: false, reessayerDans }. Atomique : la place n'est prise que si n < max (sur un jour plein, l'insertion de l'upsert se heurte à l'index unique de `cle`). */
    async function reserver(compteId) {
        const now = quand(), jour = jourDeParis(now), cle = cleDe(compteId, jour);
        try {
            await G.col('limites').findOneAndUpdate({ cle, n: { $lt: max } }, { $inc: { n: 1 }, $setOnInsert: { expireLe: new Date(now.getTime() + 3 * 86400e3) } }, { upsert: true, returnDocument: 'after' });
            return { permis: true };
        } catch (e) { if (estDup(e)) return { permis: false, reessayerDans: secondesAvantMinuitParis(now) }; throw e; }
    }
    /** Reprend une place (l'effet réservé n'a pas eu lieu). Jamais sous 0. */
    async function rendre(compteId) {
        const jour = jourDeParis(quand());
        await G.col('limites').updateOne({ cle: cleDe(compteId, jour), n: { $gt: 0 } }, { $inc: { n: -1 } });
    }
    return { lire, verifier, reserver, rendre, max };
}
module.exports = { creer, secondesAvantMinuitParis, cleDe };
