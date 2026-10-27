'use strict';
// PERF-SCAN P1 — POSE les clés de nom (`catalogue_produits.nomCles` et `.nomMin`, `numeros_cartes.nomFrCle`) et leurs trois index sur la base du service de TEST (`rm_essai`), pour que la recherche du catalogue
// n'examine plus que les produits qui portent la clé cherchée au lieu des 74 694 / 73 756 documents (index-nom.js, cle-nom.js).
//
//   SIMULATION (par défaut, RIEN n'est écrit) : ce qu'il y a à poser par collection, le poids que cela ajoute, le poids de la cible contre l'ARRÊT DUR.
//     node v2/migrations/poser-cles-nom.js --base=rm_essai
//   POSE :
//     node v2/migrations/poser-cles-nom.js --base=rm_essai --appliquer
//   Options : --lot=<N> (documents par écriture, 500 par défaut) · --pause-ms=<N> (pause entre deux lots : un palier gratuit plafonne les opérations par seconde ; 0 par défaut)
//   RELANCE : idempotente. Elle ne réécrit que les documents dont la clé manque ou diffère ; un produit ajouté par l'import quotidien SANS clé rend l'index indisponible au contrôle suivant du serveur
//   (index-nom.js : il retombe alors sur la requête d'avant, rien n'est amputé) — relancer cet outil, jusqu'à « à poser : 0 », le rend à nouveau disponible.
//
// CE QUE L'OUTIL AUTORISE (rien d'autre n'est possible) :
//  · UNE base : `rm_essai`. `--base=test` (la production) et toute autre base sont REFUSÉES avant la moindre connexion ; mongo-connexion.js tire l'adresse de MONGODB_ESSAI_URI, jamais de MONGODB_URI.
//  · La cible se PROUVE avant toute lecture : les hôtes de MONGODB_ESSAI_URI ne sont ni ceux de la production, ni des cartes, ni de la source de lecture (preuve-cible.js, sans connexion) ET l'utilisateur
//    authentifié n'écrit que sur rm_essai (connectionStatus, la même preuve que l'amorçage). Cas non conclu = refus.
//  · DEUX collections (`catalogue_produits`, `numeros_cartes`), TROIS champs (liste fermée PLAN), chacun posé par `$set` sur un `_id` : aucun document n'est créé, supprimé ou réécrit hors de ces champs ; trois index, rien d'autre.
//  · ARRÊT DUR : le poids de la cible (données + index) + l'estimation de ce que la pose ajoute doit rester ≤ 480 Mo (les 512 Mo du palier gratuit), sinon rien n'est écrit.
// Aucune URI n'est jamais affichée ; une erreur du pilote n'est citée que par son nom et son code.
const fs = require('fs'); const path = require('path');
const CN = require('../identifier/cle-nom');

const BASE_CIBLE = 'rm_essai';
const ARRET_DUR_MO = 480;
const TAILLE_LOT = 500;
const mo = o => Number((o / 1e6).toFixed(1));
const cause = e => (e && (e.codeName || e.code || e.name)) || 'erreur';
const JOURNAL_PAR_DEFAUT = path.join(__dirname, '..', '..', 'backup-amorcage-essai', 'journal-cles-nom.jsonl');           // backup-*/ est ignoré par git

/** Les deux champs : la collection, le champ lu pour calculer la clé, la clé, l'index. UNE liste fermée. */
const PLAN = Object.freeze([
    Object.freeze({ collection: 'catalogue_produits', lu: 'name', champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, cle: CN.clesDuProduit, sonde: { [CN.CHAMP_CATALOGUE]: { $in: ['pikachu'] } } }),
    Object.freeze({ collection: 'numeros_cartes', lu: 'nomFr', champ: CN.CHAMP_FR, nomIndex: CN.INDEX_FR, cle: CN.cleNomFr, sonde: { [CN.CHAMP_FR]: 'pikachu' } }),
    Object.freeze({ collection: 'catalogue_produits', lu: 'name', champ: CN.CHAMP_NOM_MIN, nomIndex: CN.INDEX_NOM_MIN, cle: CN.cleNomMin, sonde: { [CN.CHAMP_NOM_MIN]: { $gte: 'pikachu', $lt: 'pikachu￿' } } })
]);

function lireArguments(args) {
    const r = { appliquer: false, base: null, lot: TAILLE_LOT, pauseMs: 0 };
    for (const a of args) {
        let m;
        if (a === '--appliquer') r.appliquer = true;
        else if ((m = /^--base=(.*)$/.exec(a))) r.base = m[1];
        else if ((m = /^--lot=(\d+)$/.exec(a)) && Number(m[1]) >= 1 && Number(m[1]) <= 5000) r.lot = Number(m[1]);
        else if ((m = /^--pause-ms=(\d+)$/.exec(a)) && Number(m[1]) <= 60000) r.pauseMs = Number(m[1]);
        else return { ok: false, raison: `argument non reconnu « ${String(a).slice(0, 40)} » (admis : --base=${BASE_CIBLE}, --appliquer, --lot=<1..5000>, --pause-ms=<0..60000>).` };
    }
    if (r.base !== BASE_CIBLE) return { ok: false, raison: `la seule cible est --base=${BASE_CIBLE} (reçu : ${r.base === null ? 'rien' : `« ${String(r.base).slice(0, 30)} »`}). La production n'est jamais une cible.` };
    return { ok: true, ...r };
}

async function ouvrirCibleParDefaut(env) {
    const { connecterMongo } = require('../../mongo-connexion');
    const mongoose = require('mongoose');
    const base = await connecterMongo({ script: 'v2/migrations/poser-cles-nom.js', ecrit: true });
    return { ok: true, db: mongoose.connection.db, nomBase: base, fermer: async () => { await mongoose.disconnect(); } };
}
/** La preuve côté serveur : l'utilisateur de la cible n'écrit que sur rm_essai (preuve-cible.js::jugerStatut). Injectable pour les bancs (une base en mémoire n'a pas d'utilisateur). */
async function prouverStatutParDefaut(db) {
    const { jugerStatut } = require('./preuve-cible');
    let statut; try { statut = await db.admin().command({ connectionStatus: 1, showPrivileges: true }); } catch { return { ok: false, raison: 'connectionStatus a échoué : je ne peux pas prouver ce que l\'utilisateur de la cible peut faire.' }; }
    return jugerStatut(statut);
}
async function poidsCibleParDefaut(db) { const s = await db.command({ dbStats: 1 }); return s.dataSize + s.indexSize; }
function journalParDefaut(ligne) { fs.mkdirSync(path.dirname(JOURNAL_PAR_DEFAUT), { recursive: true }); fs.appendFileSync(JOURNAL_PAR_DEFAUT, JSON.stringify(ligne) + '\n'); }

const memes = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * L'ORDRE NATUREL de la collection est-il celui des _id ? La recherche par l'index rend les candidats dans l'ordre des _id ; le balayage d'aujourd'hui les rend dans l'ordre NATUREL. Une égalité de score se tranche à l'ordre
 * des candidats (mesuré au rejeu d'identité : 56 décisions sur 4 506 changent si les deux ordres diffèrent) : l'index n'est donc « le même ensemble, dans le même ordre » que sur une collection écrite en _id croissant — ce
 * que fait l'amorçage de rm_essai (amorcer-essai.js copie par lots triés par _id). Rend { ok, n } ou { ok: false, rang, raison } au premier écart.
 */
async function verifierOrdreNaturel(col) {
    let precedent = null, rang = 0;
    for await (const d of col.find({}, { projection: { _id: 1 } }).sort({ $natural: 1 })) {
        const h = d && d._id && typeof d._id.toHexString === 'function' ? d._id.toHexString() : null;
        if (h === null) return { ok: false, rang, raison: 'un _id qui n\'est pas un ObjectId : je ne sais pas comparer les deux ordres' };
        if (precedent !== null && h < precedent) return { ok: false, rang, raison: `le document de rang ${rang} (dans l'ordre naturel) a un _id plus petit que celui qui le précède` };
        precedent = h; rang++;
    }
    return { ok: true, n: rang };
}

/** Lit la collection ENTIÈRE par curseur et rend ce qui reste à poser : { total, aPoser, octets } — `octets` : la taille BSON des valeurs à écrire (le champ seul). `ecrire(lot)` est appelée par lots d'`_id` à poser. */
async function parcourir(col, spec, { lot, ecrire = null }) {
    const { BSON } = require('mongoose').mongo;
    let total = 0, aPoser = 0, octets = 0, ops = [];
    const vider = async () => { if (ops.length && ecrire) await ecrire(ops); ops = []; };
    const curseur = col.find({}, { projection: { [spec.lu]: 1, [spec.champ]: 1 } }).sort({ _id: 1 });
    for await (const d of curseur) {
        total++;
        const voulu = spec.cle(d[spec.lu]);
        if (d[spec.champ] !== undefined && memes(d[spec.champ], voulu)) continue;
        aPoser++; octets += BSON.calculateObjectSize({ [spec.champ]: voulu }) - 5;
        ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: { [spec.champ]: voulu } } } });
        if (ops.length >= lot) await vider();
    }
    await vider();
    return { total, aPoser, octets };
}

async function principal(args = process.argv.slice(2), env = process.env, deps = {}) {
    const say = (...a) => console.log(...a);
    const stop = m => { console.error(`❌ ARRÊT : ${m}`); return 1; };
    const A = lireArguments(args);
    if (!A.ok) return stop(A.raison);
    if (!deps.ouvrirCible) {                                   // chemin réel : les hôtes se jugent SANS connexion, avant d'ouvrir quoi que ce soit
        for (const nom of ['MONGODB_ESSAI_URI', 'MONGODB_LECTURE_URI']) if (!env[nom] || !String(env[nom]).trim()) return stop(`${nom} est absente : aucune connexion, aucun repli.`);
        const h = require('./preuve-cible').jugerHotes(env);
        if (!h.ok) return stop(h.raison);
    }
    const seuil = deps.seuilOctets !== undefined ? deps.seuilOctets : ARRET_DUR_MO * 1e6;
    const journal = deps.journal || journalParDefaut;
    const poidsCible = deps.poidsCible || poidsCibleParDefaut;
    const co = await (deps.ouvrirCible || ouvrirCibleParDefaut)(env);
    if (!co.ok) return stop(co.raison);
    try {
        const db = co.db;
        // `deps.nomBase` n'existe que pour les mesures locales (une base EN MÉMOIRE nommée autrement, jamais une URI) : par la ligne de commande, le nom attendu est toujours rm_essai.
        const attendue = deps.nomBase !== undefined ? deps.nomBase : BASE_CIBLE;
        if (db.databaseName !== attendue) return stop(`la cible est la base "${String(db.databaseName).slice(0, 30)}" et non "${attendue}" : refusé.`);
        const pr = await (deps.prouverStatut || prouverStatutParDefaut)(db);
        if (!pr || pr.ok !== true) return stop(`la cible n'est pas prouvée — ${(pr && typeof pr.raison === 'string' && pr.raison) || 'je ne sais pas'}. Rien n'est lu ni écrit.`);
        say(`🗄️  Cible : "${BASE_CIBLE}"  ·  ${A.appliquer ? '▶️  POSE' : '🔎 SIMULATION — rien n\'est écrit (--appliquer pour poser)'}`);
        for (const spec of PLAN) if (!(await db.listCollections({ name: spec.collection }, { nameOnly: true }).toArray()).length) return stop(`la collection « ${spec.collection} » est absente de la cible : rien à poser, refusé.`);

        // L'ORDRE avant tout : sans lui, l'index change le gagnant d'une égalité de score (voir verifierOrdreNaturel). Refus en simulation comme à la pose.
        for (const nom of [...new Set(PLAN.map(s => s.collection))]) {
            const o = await verifierOrdreNaturel(db.collection(nom));
            if (!o.ok) return stop(`« ${nom} » : ${o.raison}. La recherche par l'index rendrait les candidats dans l'ordre des _id, le balayage d'aujourd'hui dans l'ordre naturel : une égalité de score se tranche à cet ordre. Rien n'est écrit. Remède : recopier la collection en _id croissant (amorcer-essai.js le fait).`);
            say(`   ordre naturel de « ${nom} » = ordre des _id (${o.n} documents)`);
        }
        const poids0 = await poidsCible(db);
        say(`   poids de la cible : ${mo(poids0)} Mo (données + index) · ARRÊT DUR ${mo(seuil)} Mo`);
        // ── le plan : une lecture complète par collection (la même que fera la pose), RIEN d'écrit
        const plans = [];
        for (const spec of PLAN) {
            const col = db.collection(spec.collection);
            const p = await parcourir(col, spec, { lot: A.lot });
            const indexes = await col.indexes(); const aIndex = indexes.some(i => i.name === spec.nomIndex);
            // l'estimation : les valeurs écrites × 1,6 (MESURÉ sur l'instantané complet du 12/10 — 74 694 / 73 756 documents, collStats après la pose : valeurs 7,6 Mo, index 2,4 Mo, soit × 1,31 ; majoré d'un cinquième).
            // Sur la base du service de test (≈ 456 Mo pour 480 d'arrêt dur) une estimation à × 2,5 aurait REFUSÉ une pose qui n'ajoute que ≈ 10 Mo : le chiffre de l'arrêt se calibre sur la mesure, pas sur la peur.
            const estimation = Math.ceil(p.octets * 1.6);
            plans.push({ spec, ...p, aIndex, estimation });
            say(`   ${spec.collection.padEnd(20)} ${String(p.total).padStart(7)} documents · à poser ${String(p.aPoser).padStart(7)} · valeurs ${String(mo(p.octets)).padStart(5)} Mo · index ${aIndex ? 'présent' : 'À CRÉER'} · estimation +${mo(estimation)} Mo`);
        }
        const ajout = plans.reduce((a, p) => a + p.estimation, 0);
        say(`   → ajout estimé : +${mo(ajout)} Mo ; poids final estimé : ${mo(poids0 + ajout)} Mo`);
        if (poids0 + ajout > seuil) return stop(`le poids final estimé (${mo(poids0 + ajout)} Mo) dépasserait l'arrêt dur de ${mo(seuil)} Mo : rien n'est écrit.`);
        if (!A.appliquer) { say(`\n✅ Simulation terminée : rien n'a été écrit. Pour poser : node v2/migrations/poser-cles-nom.js --base=${BASE_CIBLE} --appliquer`); return 0; }

        // ── la pose : le champ d'abord, l'index ensuite (un index sur un champ incomplet n'est jamais utilisé par le serveur : index-nom.js exige la couverture entière)
        let lotsFaits = 0;
        for (const p of plans) {
            const col = db.collection(p.spec.collection);
            let posees = 0;
            try {
                await parcourir(col, p.spec, {
                    lot: A.lot,
                    ecrire: async ops => {
                        if ((lotsFaits++ % 20) === 0) { const m = await poidsCible(db); if (m + ops.length * 80 > seuil) throw Object.assign(new Error('arrêt dur'), { code: 'ARRET_DUR' }); }
                        await col.bulkWrite(ops, { ordered: false });
                        posees += ops.length;
                        if (deps.apresLot) await deps.apresLot({ collection: p.spec.collection, posees, lot: ops.length });
                        if (A.pauseMs) await new Promise(r => setTimeout(r, A.pauseMs));
                    }
                });
                await col.createIndex({ [p.spec.champ]: 1 }, { name: p.spec.nomIndex });
            } catch (e) {
                journal({ le: new Date().toISOString(), collection: p.spec.collection, etat: 'interrompue', posees, raison: cause(e) });
                console.error(`   Pose interrompue sur « ${p.spec.collection} » après ${posees} document(s) (${cause(e)}). La relancer reprend où elle s'est arrêtée (idempotente).`);
                return stop(e && e.code === 'ARRET_DUR' ? `ARRÊT DUR avant de franchir ${mo(seuil)} Mo.` : `écriture interrompue (${cause(e)}).`);
            }
            say(`✔️  « ${p.spec.collection} » : ${posees} clé(s) posée(s), index « ${p.spec.nomIndex} » présent.`);
            journal({ le: new Date().toISOString(), collection: p.spec.collection, etat: 'posee', posees });
        }

        // ── le contrôle : plus aucun document sans clé, l'index existe, et il sert (plan IXSCAN)
        say('\nContrôle final :');
        let ecarts = 0;
        for (const p of plans) {
            const col = db.collection(p.spec.collection);
            const sans = await col.countDocuments({ [p.spec.champ]: { $exists: false } });
            const indexes = await col.indexes(); const aIndex = indexes.some(i => i.name === p.spec.nomIndex);
            const plan = JSON.stringify((await col.find(p.spec.sonde).explain('queryPlanner')).queryPlanner.winningPlan);
            const sert = plan.includes('IXSCAN') && !plan.includes('COLLSCAN');
            const bon = sans === 0 && aIndex && sert;
            if (!bon) ecarts++;
            say(`   ${bon ? '✅' : '🔴'} ${p.spec.collection.padEnd(20)} sans clé : ${sans} · index ${aIndex ? 'présent' : 'ABSENT'} · plan de la sonde : ${sert ? 'IXSCAN' : 'PAS d\'IXSCAN'}`);
        }
        say(`\n   poids de la cible : ${mo(await poidsCible(db))} Mo (arrêt dur ${mo(seuil)} Mo).`);
        if (ecarts) return stop(`${ecarts} collection(s) en écart (🔴 ci-dessus) : relancer la simulation pour comprendre.`);
        say(`✅ Clés posées et indexées. Le serveur les utilise dans la minute qui suit son prochain contrôle de couverture (index-nom.js) ; relancer cet outil après chaque import du catalogue.`);
        return 0;
    } finally { await co.fermer(); }
}

module.exports = { principal, lireArguments, verifierOrdreNaturel, PLAN, BASE_CIBLE, ARRET_DUR_MO };

if (require.main === module) {
    require('dotenv').config();
    principal().then(code => process.exit(code)).catch(e => { console.error('❌ erreur imprévue :', cause(e)); process.exit(1); });
}
