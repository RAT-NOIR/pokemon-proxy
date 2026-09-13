// ============================================================
// VERROU AVEC BATTEMENT — une seule définition, pour le verrou GLOBAL d'une source et le verrou de SET
// ============================================================
// Utilisé par collecteur-images.js (artofpkm) et par le collecteur d'images Bulbapedia. Un document
// Mongo porte `verrou: { pid, hote, jeton, depuis }` ; `depuis` est rafraîchi par le battement.
//
// 🔴 L'OCCURRENCE, 2026-09-13 08:21:12 → 08:21:53 UTC. Deux pods Render ont collecté artofpkm en même
// temps (DP5c et DP2 entrelacés, écart minimal 0,6 s), et le verrou global était LIBRE à 08:00 et à
// 13:17 alors qu'un worker tournait. Le battement avait été rendu conditionnel à la possession
// (091f8d2) ; la LIBÉRATION ne l'était pas. Trois défauts, corrigés ici ensemble :
//   1. `rendre` effaçait le verrou par `_id` seul — un pod qui s'arrête effaçait celui de son
//      successeur. Un processus ne rend désormais QUE SON verrou (pid + hôte + jeton).
//   2. le verrou était rendu dans le gestionnaire SIGTERM, AVANT la fin de l'unité en cours : l'ancien
//      pod continuait ses requêtes sans verrou. Ce module ne s'accroche à AUCUN signal ; l'appelant
//      rend le verrou après l'unité.
//   3. le battement conditionnel IGNORAIT son résultat : 0 document touché = verrou perdu, et le
//      détenteur collectait sans verrou indéfiniment, sans un mot. Désormais 0 document = PERTE,
//      signalée à l'appelant, qui s'arrête.
// 🔑 C'est le §21 bis de CLAUDE.md qui se répète : on avait corrigé un exemplaire de la règle (le
// battement) et laissé son jumeau (la libération).
//
// ⚠️ LE JETON, ET POURQUOI pid + hôte NE SUFFISENT PAS : sur Render, le processus a le pid 52 dans
// TOUS les pods, et un conteneur relancé sur place garde son nom d'hôte. Un processus neuf prendrait
// alors le verrou de son prédécesseur mort pour le sien. Le jeton est tiré au démarrage du processus.

const os = require('os');
const crypto = require('crypto');

const IDENTITE = Object.freeze({ pid: process.pid, hote: os.hostname(), jeton: crypto.randomUUID() });

/**
 * @param {object} o
 * @param {import('mongoose').Model} o.Modele   collection qui porte le document de verrou
 * @param {string} o.id                          `_id` du document
 * @param {number} o.dureeMs                     au-delà, un battement absent vaut mort
 * @param {number} [o.battementMs=60000]
 * @param {object} [o.surInsertion]              `$setOnInsert` si le document n'existe pas
 * @param {(motif:string)=>void} [o.surPerte]    appelé UNE fois quand le verrou est perdu
 * @param {string} [o.nom]
 * @param {object} [o.identite]                  pour les tests seulement
 */
function fabriquerVerrou({ Modele, id, dureeMs, battementMs = 60000, surInsertion = null, surPerte = () => { }, nom = id, identite = IDENTITE }) {
    const aMoi = () => ({ _id: id, 'verrou.pid': identite.pid, 'verrou.hote': identite.hote, 'verrou.jeton': identite.jeton });
    let battement = null, tenu = false, perdu = false, echecsBattement = 0;

    function perte(motif) {
        if (perdu) return;
        perdu = true; tenu = false;
        clearInterval(battement);
        console.error(`🔴 VERROU PERDU — ${nom} : ${motif}. Un autre processus le tient ou il a été effacé : on ne travaille pas sans verrou, arrêt après l'unité en cours.`);
        surPerte(motif);
    }

    /** @returns {Promise<null|{pid,hote,depuis,ageS}>} null si PRIS, sinon le détenteur vivant. */
    async function prendre() {
        for (let essai = 0; essai < 3; essai++) {
            const perime = new Date(Date.now() - dureeMs);
            try {
                const r = await Modele.findOneAndUpdate(
                    // Libre si : aucun verrou · battement périmé · verrou sans propriétaire (zombie) · déjà le mien.
                    { _id: id, $or: [{ verrou: { $exists: false } }, { 'verrou.depuis': { $lt: perime } }, { 'verrou.pid': { $exists: false } }, { 'verrou.jeton': identite.jeton }] },
                    { $set: { verrou: { pid: identite.pid, hote: identite.hote, jeton: identite.jeton, depuis: new Date() } }, ...(surInsertion ? { $setOnInsert: surInsertion } : {}) },
                    { upsert: true, new: true }
                ).lean();
                if (r) {
                    tenu = true; perdu = false; echecsBattement = 0;
                    clearInterval(battement);
                    battement = setInterval(battre, battementMs);
                    return null;
                }
            } catch (e) {
                if (e.code !== 11000) throw e;   // le document existe et le filtre n'a pas matché : tenu par un vivant
            }
            const t = (await Modele.findById(id).lean())?.verrou;
            // ⚠️ Libéré entre l'écriture et la lecture : on RÉESSAIE. L'ancienne version rendait `null`,
            // que l'appelant lisait comme « pris » — un verrou jamais pris, cru tenu.
            if (!t || t.pid == null) continue;
            return { ...t, ageS: Math.round((Date.now() - new Date(t.depuis).getTime()) / 1000) };
        }
        return { pid: null, hote: '(libéré et repris trois fois de suite pendant la tentative)', depuis: new Date(), ageS: 0 };
    }

    async function battre() {
        try {
            const r = await Modele.updateOne(aMoi(), { $set: { 'verrou.depuis': new Date() } });
            echecsBattement = 0;
            if (r.matchedCount === 0) perte('le battement a touché 0 document');
        } catch (e) {
            // Une panne réseau n'est pas une perte : le verrou est peut-être encore à nous. Mais au-delà de
            // `dureeMs` sans battement, il est à prendre — le prochain battement réussi dira si on l'a perdu.
            echecsBattement++;
            console.warn(`⚠️ battement ${nom} en échec (${echecsBattement}×) : ${e.message}`);
        }
    }

    /**
     * Revérifie la possession ET rafraîchit le battement, en une écriture conditionnelle. À appeler
     * avant chaque unité de travail : la possession prise au démarrage ne dit rien de l'heure qui suit.
     */
    async function tient() {
        if (!tenu || perdu) return false;
        try {
            const r = await Modele.updateOne(aMoi(), { $set: { 'verrou.depuis': new Date() } });
            if (r.matchedCount === 0) { perte('revérification : 0 document'); return false; }
            return true;
        } catch (e) {
            console.warn(`⚠️ revérification ${nom} impossible : ${e.message} — traitée comme non tenue`);
            return false;
        }
    }

    /** Rend le verrou SI ET SEULEMENT SI il est encore à nous. Jamais celui d'un autre. */
    async function rendre() {
        clearInterval(battement);
        if (!tenu) return { rendu: false, motif: perdu ? 'perdu' : 'jamais pris' };
        tenu = false;
        try {
            const r = await Modele.updateOne(aMoi(), { $unset: { verrou: 1 } });
            if (r.matchedCount === 0) console.warn(`⚠️ ${nom} : rien à rendre, le verrou n'est plus à moi — je ne touche pas à celui d'un autre.`);
            return { rendu: r.matchedCount === 1 };
        } catch (e) {
            console.warn(`⚠️ ${nom} : rendu impossible (${e.message}) — il expirera dans ${Math.round(dureeMs / 1000)} s.`);
            return { rendu: false, motif: e.message };
        }
    }

    return { prendre, tient, rendre, get perdu() { return perdu; }, get tenu() { return tenu; } };
}

module.exports = { fabriquerVerrou, IDENTITE };
