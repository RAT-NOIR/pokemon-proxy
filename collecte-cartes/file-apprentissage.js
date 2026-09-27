// ============================================================
// LA FILE D'APPRENTISSAGE CÔTÉ SERVEUR — /api/apprendre-lot ne refuse plus un envoi légitime (testeur, 2026-09-27)
// ============================================================
// 🔴 LE CAS (journal 1.9) : 3 envois refusés par NOTRE serveur (429, la limite de 120 envois/h de /api/apprendre-lot), 4 pages restées
// dans la file de l'userscript quand la passe s'est arrêtée. Une limite de débit protège les tables non régénérables (le jeton est
// extractible de l'extension) ; elle ne doit pas coûter une lecture que Cardmarket a déjà facturée (1015).
// 🔑 LE DÉBIT NE CHANGE PAS, SEUL LE REFUS DISPARAÎT : au-delà de la limite, un envoi authentifié est MIS EN FILE (collection
// `apprentissage_attente`, base test) et la route répond 202 ; `traiterUn` le rejoue par `apprendreLot` — EXACTEMENT ce que la route
// appelle — à la cadence que la route appelante fixe (un lot toutes les 30 s = 120/h, la limite d'avant). Un plafond PAR UTILISATEUR
// (lots en attente) reste la garde contre un abus du jeton : au-delà, 429 et le client garde sa page.
// Un lot pris par un processus mort (redéploiement) revient en attente après `BLOQUE_MS` ; trois échecs → `erreur`, gardé et dit.
const COLLECTION = 'apprentissage_attente';
const PLAFOND_PAR_UTILISATEUR = 2000;   // une passe réelle : 223 pages (journal 1.9) ; bien au-delà = abus, pas un envoi légitime
const BLOQUE_MS = 10 * 60 * 1000;
const ESSAIS_MAX = 3;

/** Met un lot en file. @returns {{ status: 202|429, corps: object }} */
async function mettreEnFile(collection, { userId, cartes, plafond = PLAFOND_PAR_UTILISATEUR, le = new Date() }) {
    if (!userId) throw new TypeError('mettreEnFile : userId obligatoire');
    if (!Array.isArray(cartes) || !cartes.length) throw new TypeError('mettreEnFile : cartes vides');
    const enAttente = await collection.countDocuments({ userId, etat: { $in: ['attente', 'en-cours'] } });
    if (enAttente >= plafond) return { status: 429, corps: { success: false, error: `File serveur pleine pour cet utilisateur (${enAttente} lots en attente) : réessaie plus tard.` } };
    const r = await collection.insertOne({ userId, cartes, recuLe: le, etat: 'attente', essais: 0 });
    const position = await collection.countDocuments({ etat: { $in: ['attente', 'en-cours'] }, recuLe: { $lte: le } });
    return { status: 202, corps: { success: true, enFile: true, id: String(r.insertedId), position, recus: cartes.length } };
}

/** Rend en attente les lots pris depuis plus de `bloqueMs` (un processus mort ne libère rien). @returns le nombre rendu */
async function reprendreBloques(collection, { bloqueMs = BLOQUE_MS, maintenant = new Date() } = {}) {
    const r = await collection.updateMany({ etat: 'en-cours', prisLe: { $lt: new Date(maintenant.getTime() - bloqueMs) } }, { $set: { etat: 'attente' }, $unset: { prisLe: '' } });
    return r.modifiedCount;
}

/**
 * Prend le plus ancien lot en attente et le passe à `apprendre(cartes, userId)` (la route y met `apprendreLot`). Ne lève pas :
 * un échec est compté sur le lot (trois → `erreur`, gardé et dit).
 * @returns {{ traite: boolean, id?: string, etat?: string, resultat?: object, erreur?: string }}
 */
async function traiterUn(collection, { apprendre, maintenant = new Date(), journal = console }) {
    if (typeof apprendre !== 'function') throw new TypeError('traiterUn : apprendre obligatoire');
    const lot = await collection.findOneAndUpdate({ etat: 'attente' }, { $set: { etat: 'en-cours', prisLe: maintenant } }, { sort: { recuLe: 1 }, returnDocument: 'after' });
    const doc = lot && lot.value !== undefined ? lot.value : lot;   // pilote 4/5 (`{ value }`) ou 6 (le document)
    if (!doc) return { traite: false };
    try {
        const r = await apprendre(doc.cartes, doc.userId);
        const resultat = Object.fromEntries(['nouvelles', 'ameliorees', 'dejaExactes', 'completees', 'sansNumero', 'ignorees', 'deduites', 'nonDeduites'].map(k => [k, r?.[k] ?? null]));
        await collection.updateOne({ _id: doc._id, etat: 'en-cours' }, { $set: { etat: 'fait', faitLe: new Date(), resultat }, $unset: { prisLe: '' } });
        return { traite: true, id: String(doc._id), etat: 'fait', resultat };
    } catch (e) {
        const essais = (doc.essais || 0) + 1, etat = essais >= ESSAIS_MAX ? 'erreur' : 'attente';
        await collection.updateOne({ _id: doc._id }, { $set: { etat, essais, derniereErreur: String(e.message).slice(0, 300) }, $unset: { prisLe: '' } });
        journal.error(`❌ [file apprentissage] lot ${doc._id} (${doc.cartes?.length ?? 0} cartes, essai ${essais}) : ${e.message}`);
        return { traite: true, id: String(doc._id), etat, erreur: e.message };
    }
}

module.exports = { COLLECTION, PLAFOND_PAR_UTILISATEUR, BLOQUE_MS, ESSAIS_MAX, mettreEnFile, reprendreBloques, traiterUn };
