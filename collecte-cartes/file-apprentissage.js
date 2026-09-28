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
// 🔴 RELECTURE DU 2026-09-28 (sous-agent, commit da717a3 déjà déployé) — trois défauts, corrigés ici :
// · RIEN NE BORNAIT LA FILE : le plafond était par `userId`, lu dans le CORPS (contournable), et un lot fait gardait ses cartes. Avant
//   la file, ces requêtes recevaient un 429 et rien n'était écrit. La garde s'écrit par ce qu'elle AUTORISE : au plus
//   `PLAFOND_GLOBAL` lots PORTANT des cartes (attente, en cours, erreur ; ≤ 100 Ko chacun, la limite d'express.json), et un lot fait
//   ne garde que son résultat ;
// · UN ÉCHEC DE LA DÉDUCTION SE PERDAIT : `apprendreLot` ne lève pas quand la déduction échoue, il le DIT (`erreurDeduction`) — le lot
//   passait « fait ». C'est désormais un échec compté (le rejeu est sans risque : les cartes lues se réécrivent « déjà exactes ») ;
// · un lot qui fait TOMBER le processus revenait toutes les 10 min, sans fin : la reprise d'un lot bloqué compte comme un essai.
const COLLECTION = 'apprentissage_attente';
const PLAFOND_PAR_UTILISATEUR = 500;    // une passe réelle : 223 pages (journal 1.9), dont une part au-delà de 120/h ; bien au-delà = abus
const PLAFOND_GLOBAL = 800;             // lots portant des cartes, tous utilisateurs : au pire 80 Mo, en pratique ~8 Ko par page
const BLOQUE_MS = 10 * 60 * 1000;
const ESSAIS_MAX = 3;
const PORTE_DES_CARTES = { etat: { $in: ['attente', 'en-cours', 'erreur'] } };

/** Met un lot en file. @returns {{ status: 202|429, corps: object }} */
async function mettreEnFile(collection, { userId, cartes, plafond = PLAFOND_PAR_UTILISATEUR, plafondGlobal = PLAFOND_GLOBAL, le = new Date() }) {
    if (!userId) throw new TypeError('mettreEnFile : userId obligatoire');
    if (!Array.isArray(cartes) || !cartes.length) throw new TypeError('mettreEnFile : cartes vides');
    const total = await collection.countDocuments(PORTE_DES_CARTES);
    if (total >= plafondGlobal) return { status: 429, corps: { success: false, error: `File serveur pleine (${total} lots) : réessaie plus tard.` } };
    const enAttente = await collection.countDocuments({ userId, etat: { $in: ['attente', 'en-cours'] } });
    if (enAttente >= plafond) return { status: 429, corps: { success: false, error: `File serveur pleine pour cet utilisateur (${enAttente} lots en attente) : réessaie plus tard.` } };
    const r = await collection.insertOne({ userId, cartes, nCartes: cartes.length, recuLe: le, etat: 'attente', essais: 0 });
    const position = await collection.countDocuments({ etat: { $in: ['attente', 'en-cours'] }, recuLe: { $lte: le } });
    return { status: 202, corps: { success: true, enFile: true, id: String(r.insertedId), position, recus: cartes.length } };
}

/**
 * Rend en attente les lots pris depuis plus de `bloqueMs` (un processus mort ne libère rien) — chaque reprise COMPTE comme un essai :
 * un lot qui tue le processus finit en `erreur` au bout de `ESSAIS_MAX`, au lieu de revenir toutes les 10 min. @returns le nombre repris
 */
async function reprendreBloques(collection, { bloqueMs = BLOQUE_MS, maintenant = new Date() } = {}) {
    const bloque = { etat: 'en-cours', prisLe: { $lt: new Date(maintenant.getTime() - bloqueMs) } };
    const fin = await collection.updateMany({ ...bloque, essais: { $gte: ESSAIS_MAX - 1 } },
        { $set: { etat: 'erreur', derniereErreur: `pris ${ESSAIS_MAX} fois sans être fini (processus arrêté pendant le lot ?)` }, $inc: { essais: 1 }, $unset: { prisLe: '' } });
    const r = await collection.updateMany(bloque, { $set: { etat: 'attente' }, $inc: { essais: 1 }, $unset: { prisLe: '' } });
    return fin.modifiedCount + r.modifiedCount;
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
    let resultat = null;
    try {
        const r = await apprendre(doc.cartes, doc.userId);
        resultat = Object.fromEntries(['nouvelles', 'ameliorees', 'dejaExactes', 'completees', 'sansNumero', 'ignorees', 'deduites', 'nonDeduites', 'raisonsNonDeduites', 'erreurDeduction', 'idsDeduits'].map(k => [k, r?.[k] ?? null]));
        // la déduction des sans-image a ÉCHOUÉ (elle ne lève pas, elle le dit) : ce n'est pas un lot fait — ses sans-image se perdraient
        if (r?.erreurDeduction) throw new Error(`déduction des sans-image : ${r.erreurDeduction}`);
        // fait : le lot ne garde que son résultat (ses cartes sont écrites dans numeros_cartes — les garder ne bornerait pas la file)
        // la fin s'écrit sous le JETON de prise (`prisLe`) : un lot repris entre-temps par un autre processus (bloqué > 10 min) est à lui
        const f = await collection.updateOne({ _id: doc._id, etat: 'en-cours', prisLe: maintenant }, { $set: { etat: 'fait', faitLe: new Date(), resultat }, $unset: { prisLe: '', cartes: '' } });
        if (!f.modifiedCount) journal.error(`⚠️ [file apprentissage] lot ${doc._id} : repris par un autre processus pendant son traitement — sa fin n'est pas écrite ici`);
        return { traite: true, id: String(doc._id), etat: 'fait', resultat };
    } catch (e) {
        const essais = (doc.essais || 0) + 1, etat = essais >= ESSAIS_MAX ? 'erreur' : 'attente';
        const f = await collection.updateOne({ _id: doc._id, etat: 'en-cours', prisLe: maintenant }, { $set: { etat, essais, derniereErreur: String(e.message).slice(0, 300), ...(resultat ? { dernierResultat: resultat } : {}) }, $unset: { prisLe: '' } });
        journal.error(`❌ [file apprentissage] lot ${doc._id} (${doc.cartes?.length ?? 0} cartes, essai ${essais}) : ${e.message}${f.modifiedCount ? '' : ' — repris entre-temps par un autre processus : échec non écrit ici'}`);
        return { traite: true, id: String(doc._id), etat, erreur: e.message };
    }
}

module.exports = { COLLECTION, PLAFOND_PAR_UTILISATEUR, PLAFOND_GLOBAL, BLOQUE_MS, ESSAIS_MAX, mettreEnFile, reprendreBloques, traiterUn };
