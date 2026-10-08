// ============================================================================
// LE VIDAGE DE SORTIE DE test_scratch — UNE SEULE FONCTION, `drop`, JAMAIS `deleteMany`
// ============================================================================
// 🔴 `deleteMany` vide une collection mais GARDE son fichier et ses index alloués (verrou/tranche.js, « deleteMany ne rend pas la place »).
// test_scratch vit sur la grappe de PRODUCTION (MONGODB_URI) : le 2026-10-08, elle a dépassé DEUX fois l'arrêt dur de 480 Mo, et la
// place était prise par des collections VIDES laissées par les outils du dépôt principal (numeros_cartes 7,6 Mo, guide_prix, questions…).
// La garde principale est collecte-cartes/base-banc.js (un banc n'ouvre plus la production) ; ce module est la défense en profondeur.
// 🔑 Ce module ne supprime QUE ce que l'outil DÉCLARE (sa liste `noms`) : jamais « tout ce qui est né depuis un instantané » — un banc
// concurrent dont les collections ne portent pas le préfixe rm_t y passerait. Un outil qui lance le serveur déclare `COLLECTIONS_SERVEUR`
// (les collections que l'autoIndex des modèles de index.js crée dès la connexion, sans y écrire une ligne).
// 🔑 Une garde s'écrit par ce qu'elle AUTORISE : seule la base `test_scratch` est acceptée, et jamais une collection `rm_t…` (bancs de l'API v2).

const BASE_BAC = 'test_scratch';
const PREFIXE_BANCS_V2 = /^rm_t/;

/** Les collections que les modèles mongoose du serveur (index.js et les modules qu'il charge) créent par autoIndex. */
const COLLECTIONS_SERVEUR = Object.freeze(['cardprices', 'catalogue_produits', 'guide_prix', 'codes_set', 'numeros_cartes', 'evenements_stripe',
    'references_image', 'credits', 'quotas_semaine', 'remboursements', 'remboursements_questions', 'questions', 'journal_scans']);

/** Les noms des collections présentes. */
async function instantane(db) {
    return new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
}

/** Les collections de tous les modèles mongoose chargés dans CE processus. */
function nomsDesModeles(mongoose) {
    return mongoose.modelNames().map(m => mongoose.model(m).collection.collectionName);
}

/**
 * Supprime (drop) les collections nommées dans `noms`, rien d'autre. Refuse hors test_scratch. Une collection absente n'est pas une erreur.
 * @returns {Promise<{refuse:boolean, droppees:string[]}>}
 */
async function viderBac(db, { noms = [], log = console.log } = {}) {
    if (db?.databaseName !== BASE_BAC) {
        log(`🔴 viderBac REFUSE : base « ${db?.databaseName} », attendu ${BASE_BAC}.`);
        return { refuse: true, droppees: [] };
    }
    const presentes = await instantane(db);
    const droppees = [];
    for (const nom of new Set(noms)) {
        if (PREFIXE_BANCS_V2.test(nom) || !presentes.has(nom)) continue;
        try { await db.dropCollection(nom); droppees.push(nom); }
        catch (e) { if (e?.codeName !== 'NamespaceNotFound' && e?.code !== 26) log(`🔴 drop de ${nom} : ${e.message}`); }
    }
    log(`🧹 test_scratch : ${droppees.length} collection(s) supprimée(s) (drop) — ${droppees.join(', ') || 'aucune'}.`);
    return { refuse: false, droppees };
}

module.exports = { BASE_BAC, COLLECTIONS_SERVEUR, instantane, nomsDesModeles, viderBac };
