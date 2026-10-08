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

const { verifierHoteBanc } = require('../collecte-cartes/garde-banc');
const BASE_BAC = 'test_scratch';
const PREFIXE_BANCS_V2 = /^rm_t/;

/** Les collections que les modèles mongoose du serveur (index.js et les modules qu'il charge) créent par autoIndex. */
const COLLECTIONS_SERVEUR = Object.freeze(['cardprices', 'catalogue_produits', 'guide_prix', 'codes_set', 'numeros_cartes', 'evenements_stripe',
    'references_image', 'credits', 'quotas_semaine', 'remboursements', 'remboursements_questions', 'questions', 'journal_scans']);

/** Les noms des collections présentes. */
async function instantane(db) {
    return new Set((await db.listCollections({}, { nameOnly: true }).toArray()).map(c => c.name));
}

// (`nomsDesModeles(mongoose)`, qui calculait la liste à l'exécution, est retiré : une liste de suppression se LIT dans le banc, elle ne se déduit pas.)

/** Les hôtes où la base VIT, lus sur son client (`db.client.options.hosts`) ; [] si on ne peut pas le dire. */
function hotesDeLaBase(db) {
    const hs = db?.client?.options?.hosts;
    return Array.isArray(hs) ? hs.map(h => h && typeof h.host === 'string' ? `${h.host}${h.port ? `:${h.port}` : ''}` : null) : [];
}

/**
 * Supprime (drop) les collections nommées dans `noms`, rien d'autre. Une collection absente n'est pas une erreur.
 * 🔴 ÉCRIT PAR CE QU'IL AUTORISE : il ne supprime QUE dans la base DE BANC — `BANC_ISOLE === '1'` ET tous les hôtes de la connexion de la base sont des hôtes du
 * banc (`BANC_HOTES`, verifierHoteBanc). Le nom `test_scratch` ne suffit pas : il existe aussi sur la grappe de production, où un appelant qui aurait oublié
 * `ouvrirBanc` viderait le vrai bac. Un doute (hôte inconnu, client absent, variable absente) est un refus.
 * @returns {Promise<{refuse:boolean, droppees:string[]}>}
 */
async function viderBac(db, { noms = [], log = console.log, env = process.env } = {}) {
    if (db?.databaseName !== BASE_BAC) {
        log(`🔴 viderBac REFUSE : base « ${db?.databaseName} », attendu ${BASE_BAC}.`);
        return { refuse: true, droppees: [] };
    }
    const hotes = hotesDeLaBase(db);
    const garde = !hotes.length || hotes.includes(null) ? { ok: false, raison: 'hôte de la base inconnu (aucun client lisible), refusé.' }
        : env.BANC_ISOLE !== '1' ? { ok: false, raison: 'BANC_ISOLE n\'est pas posé : ce n\'est pas une base de banc, refusé.' }
            : verifierHoteBanc(`mongodb://${hotes.join(',')}/`, env);
    if (!garde.ok) {
        log(`🔴 viderBac REFUSE : ${garde.raison} Rien n'est supprimé.`);
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

module.exports = { BASE_BAC, COLLECTIONS_SERVEUR, instantane, viderBac };
