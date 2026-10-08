// ============================================================================
// LE VIDAGE DE SORTIE DE test_scratch — UNE SEULE FONCTION, `drop`, JAMAIS `deleteMany`
// ============================================================================
// 🔴 `deleteMany` vide une collection mais GARDE son fichier et ses index alloués (verrou/tranche.js, « deleteMany ne rend pas la place »).
// test_scratch vit sur la grappe de PRODUCTION (MONGODB_URI) : le 2026-10-08, elle a dépassé DEUX fois l'arrêt dur de 480 Mo, et la
// place était prise par des collections VIDES laissées par les outils du dépôt principal (numeros_cartes 7,6 Mo, guide_prix, questions…).
// Deux sources de collections vides, et ce module répond aux deux :
//   1. l'outil vide ses collections par `deleteMany` en sortant        -> `viderBac(db, { noms })`
//   2. l'outil (ou le serveur qu'il lance) fait CRÉER des collections par autoIndex de mongoose dès la connexion, sans y écrire une ligne
//      (cardprices, evenements_stripe…)                                -> `viderBac(db, { avant })` avec `avant = await instantane(db)` pris
//      AVANT de lancer le serveur / de se connecter : tout ce qui est né depuis part.
// 🔑 Une garde s'écrit par ce qu'elle AUTORISE : seule la base `test_scratch` est acceptée (tout le reste refuse, y compris un nom absent),
// et jamais une collection `rm_t…` (les bancs de l'API v2 y créent les leurs, supprimées par eux-mêmes en sortant).

const BASE_BAC = 'test_scratch';
const PREFIXE_BANCS_V2 = /^rm_t/;

/** Les noms des collections présentes. Pris AVANT de lancer l'outil ou son serveur. */
async function instantane(db) {
    return new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
}

/** Les collections de tous les modèles mongoose chargés dans CE processus (celles que l'autoIndex a créées). */
function nomsDesModeles(mongoose) {
    return mongoose.modelNames().map(m => mongoose.model(m).collection.collectionName);
}

/**
 * Supprime (drop) les collections nommées dans `noms`, plus — si `avant` est donné — toute collection née depuis cet instantané
 * (hors rm_t…). Refuse hors test_scratch. Une collection déjà absente n'est pas une erreur.
 * @returns {Promise<{refuse:boolean, droppees:string[]}>}
 */
async function viderBac(db, { noms = [], avant = null, log = console.log } = {}) {
    if (db?.databaseName !== BASE_BAC) {
        log(`🔴 viderBac REFUSE : base « ${db?.databaseName} », attendu ${BASE_BAC}.`);
        return { refuse: true, droppees: [] };
    }
    const cibles = new Set(noms);
    if (avant) for (const nom of await instantane(db)) if (!avant.has(nom) && !PREFIXE_BANCS_V2.test(nom)) cibles.add(nom);
    const presentes = await instantane(db);
    const droppees = [];
    for (const nom of cibles) {
        if (PREFIXE_BANCS_V2.test(nom) || !presentes.has(nom)) continue;
        try { await db.dropCollection(nom); droppees.push(nom); }
        catch (e) { if (e?.codeName !== 'NamespaceNotFound' && e?.code !== 26) log(`🔴 drop de ${nom} : ${e.message}`); }
    }
    log(`🧹 test_scratch : ${droppees.length} collection(s) supprimée(s) (drop) — ${droppees.join(', ') || 'aucune'}.`);
    return { refuse: false, droppees };
}

module.exports = { BASE_BAC, instantane, nomsDesModeles, viderBac };
