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

/**
 * La liste FERMÉE de ce que l'outil pose, par collection : le champ lu (`lu`), le TÉMOIN de la source (`temoin` : la valeur de `lu` au moment de la pose, écrite dans le MÊME `$set` que les clés — un produit renommé ensuite
 * par l'import a `lu` ≠ `temoin`, et le serveur refuse alors l'index : index-nom.js), et les clés (`champs`), chacune avec son index, sa forme attendue et une sonde de plan.
 */
const PLAN = Object.freeze([
    Object.freeze({
        collection: 'catalogue_produits', lu: 'name', temoin: CN.CHAMP_SOURCE_CATALOGUE,
        champs: Object.freeze([
            Object.freeze({ champ: CN.CHAMP_CATALOGUE, nomIndex: CN.INDEX_CATALOGUE, cle: CN.clesDuProduit, forme: v => Array.isArray(v) && v.every(x => typeof x === 'string'), sonde: { [CN.CHAMP_CATALOGUE]: { $in: ['pikachu'] } } }),
            Object.freeze({ champ: CN.CHAMP_NOM_MIN, nomIndex: CN.INDEX_NOM_MIN, cle: CN.cleNomMin, forme: v => typeof v === 'string', sonde: { [CN.CHAMP_NOM_MIN]: { $gte: 'pikachu', $lt: 'pikachu￿' } } })
        ])
    }),
    Object.freeze({
        collection: 'numeros_cartes', lu: 'nomFr', temoin: CN.CHAMP_SOURCE_FR,
        champs: Object.freeze([Object.freeze({ champ: CN.CHAMP_FR, nomIndex: CN.INDEX_FR, cle: CN.cleNomFr, forme: v => typeof v === 'string', sonde: { [CN.CHAMP_FR]: 'pikachu' } })])
    })
]);
const champsDe = spec => [...spec.champs.map(c => c.champ), spec.temoin];

function lireArguments(args) {
    const r = { appliquer: false, retirer: false, base: null, lot: TAILLE_LOT, pauseMs: 0 };
    const vus = new Set();
    for (const a of args) {
        let m;
        const nom = typeof a === 'string' ? (a.match(/^(--[a-z-]+)/) || [])[1] : null;
        // I2 : un argument RÉPÉTÉ est refusé (lireArguments gardait le dernier --base, mongo-connexion.js le premier : `--base=test --base=rm_essai` ouvrait la production avant de refuser)
        if (nom && vus.has(nom)) return { ok: false, raison: `l'argument « ${nom} » est répété : refusé avant toute connexion (une seule fois chacun).` };
        if (nom) vus.add(nom);
        if (a === '--appliquer') r.appliquer = true;
        else if (a === '--retirer') r.retirer = true;
        else if ((m = /^--base=(.*)$/.exec(a))) r.base = m[1];
        else if ((m = /^--lot=(\d+)$/.exec(a)) && Number(m[1]) >= 1 && Number(m[1]) <= 5000) r.lot = Number(m[1]);
        else if ((m = /^--pause-ms=(\d+)$/.exec(a)) && Number(m[1]) <= 60000) r.pauseMs = Number(m[1]);
        else return { ok: false, raison: `argument non reconnu « ${String(a).slice(0, 40)} » (admis : --base=${BASE_CIBLE}, --appliquer, --retirer, --lot=<1..5000>, --pause-ms=<0..60000>).` };
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
async function poidsCibleParDefaut(db) { const s = await db.command({ dbStats: 1 }); return Math.max(s.dataSize + s.indexSize, (s.storageSize || 0) + s.indexSize); }   // I4 : le plus GRAND des deux (le palier compte le fichier, pas le logique)
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

/**
 * Lit la collection ENTIÈRE par curseur et rend ce qui reste à poser : { total, aPoser, octets, etrangers } — `octets` : la taille BSON de ce qui sera écrit (clés et témoin) ; `etrangers` : les documents qui portent
 * déjà un champ de l'outil sous une FORME qui n'est pas la sienne (l'outil n'écrase pas ce qui n'est pas à lui). Un document est « à poser » dès qu'une clé OU son témoin manque ou diffère de ce que le nom donne
 * aujourd'hui — c'est ce qui rattrape un produit RENOMMÉ par l'import. `ecrire(lot)` est appelée par lots d'`_id` à poser.
 */
async function parcourir(col, spec, { lot, ecrire = null }) {
    const { BSON } = require('mongoose').mongo;
    let total = 0, aPoser = 0, octets = 0, etrangers = 0, ops = [];
    const vider = async () => { if (ops.length && ecrire) await ecrire(ops); ops = []; };
    const projection = { [spec.lu]: 1, [spec.temoin]: 1 }; for (const c of spec.champs) projection[c.champ] = 1;
    for await (const d of col.find({}, { projection }).sort({ _id: 1 })) {
        total++;
        const voulu = { [spec.temoin]: CN.sourceDe(d[spec.lu]) };
        for (const c of spec.champs) voulu[c.champ] = c.cle(d[spec.lu]);
        if (spec.champs.some(c => d[c.champ] !== undefined && !c.forme(d[c.champ]))) etrangers++;
        if (Object.keys(voulu).every(k => d[k] !== undefined && memes(d[k], voulu[k]))) continue;
        aPoser++; octets += BSON.calculateObjectSize(voulu) - 5;
        ops.push({ updateOne: { filter: { _id: d._id }, update: { $set: voulu } } });
        if (ops.length >= lot) await vider();
    }
    await vider();
    return { total, aPoser, octets, etrangers };
}

/** I3 : le RETOUR ARRIÈRE — retire les champs que l'outil pose (clés et témoins) et ses index, et rien d'autre. Simulation par défaut. */
async function retirer(db, A, { say, stop, journal }) {
    let aFaire = 0;
    const etat = [];
    for (const spec of PLAN) {
        const col = db.collection(spec.collection);
        const champs = champsDe(spec);
        const avecChamps = await col.countDocuments({ $or: champs.map(c => ({ [c]: { $exists: true } })) });
        const presents = (await col.indexes()).map(i => i.name).filter(n => spec.champs.some(c => c.nomIndex === n));
        etat.push({ spec, col, champs, presents }); aFaire += avecChamps + presents.length;
        say(`   ${spec.collection.padEnd(20)} documents portant au moins un champ de l'outil : ${String(avecChamps).padStart(7)} · index à retirer : ${presents.length ? presents.join(', ') : 'aucun'}`);
    }
    if (!A.appliquer) { say(`\n✅ Simulation terminée : rien n'a été retiré. Pour retirer : node v2/migrations/poser-cles-nom.js --base=${BASE_CIBLE} --retirer --appliquer`); return 0; }
    for (const { spec, col, champs, presents } of etat) {
        try {
            for (const n of presents) await col.dropIndex(n);                                   // l'index d'abord : le retrait des champs n'a plus à le maintenir
            await col.updateMany({ $or: champs.map(c => ({ [c]: { $exists: true } })) }, { $unset: Object.fromEntries(champs.map(c => [c, ''])) });
        } catch (e) { journal({ le: new Date().toISOString(), collection: spec.collection, etat: 'retrait-interrompu', raison: cause(e) }); return stop(`retrait interrompu sur « ${spec.collection} » (${cause(e)}) : relancer --retirer --appliquer (idempotent).`); }
        journal({ le: new Date().toISOString(), collection: spec.collection, etat: 'retiree' });
    }
    say('\nContrôle final :');
    let ecarts = 0;
    for (const { spec, col, champs } of etat) {
        const restants = await col.countDocuments({ $or: champs.map(c => ({ [c]: { $exists: true } })) });
        const idx = (await col.indexes()).map(i => i.name).filter(n => spec.champs.some(c => c.nomIndex === n));
        const bon = restants === 0 && idx.length === 0;
        if (!bon) ecarts++;
        say(`   ${bon ? '✅' : '🔴'} ${spec.collection.padEnd(20)} documents avec un champ de l'outil : ${restants} · index restants : ${idx.length}`);
    }
    if (ecarts) return stop(`${ecarts} collection(s) en écart : relancer --retirer --appliquer.`);
    say(`✅ Champs et index de l'outil retirés. Le serveur retombe sur la requête d'avant dès son prochain contrôle (≤ 60 s).`);
    return 0;
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
        say(`🗄️  Cible : "${BASE_CIBLE}"  ·  ${A.retirer ? (A.appliquer ? '↩️  RETRAIT' : '🔎 SIMULATION du retrait') : A.appliquer ? '▶️  POSE' : '🔎 SIMULATION — rien n\'est écrit (--appliquer pour poser)'}`);
        for (const spec of PLAN) if (!(await db.listCollections({ name: spec.collection }, { nameOnly: true }).toArray()).length) return stop(`la collection « ${spec.collection} » est absente de la cible : rien à faire, refusé.`);
        if (A.retirer) return await retirer(db, A, { say, stop, journal });

        // L'ORDRE n'est plus une condition (B2, tour 1) : toutes les recherches du serveur trient par _id, le repli d'avant comme l'index. Il reste une INFORMATION.
        for (const nom of [...new Set(PLAN.map(s => s.collection))]) {
            const o = await verifierOrdreNaturel(db.collection(nom));
            say(o.ok ? `   ordre naturel de « ${nom} » = ordre des _id (${o.n} documents) — information : les recherches trient par _id de toute façon`
                : `   information : l'ordre naturel de « ${nom} » n'est pas l'ordre des _id (${o.raison}) — sans effet : toutes les recherches trient par _id`);
        }
        const poids0 = await poidsCible(db);
        say(`   poids de la cible : ${mo(poids0)} Mo (le plus grand de données+index et stockage+index) · ARRÊT DUR ${mo(seuil)} Mo`);
        // ── le plan : une lecture complète par collection (la même que fera la pose), RIEN d'écrit
        const plans = [];
        for (const spec of PLAN) {
            const col = db.collection(spec.collection);
            const p = await parcourir(col, spec, { lot: A.lot });
            const presents = (await col.indexes()).map(i => i.name);
            const manquants = spec.champs.filter(c => !presents.includes(c.nomIndex)).map(c => c.nomIndex);
            // l'estimation : les valeurs écrites × 1,6 (MESURÉ sur l'instantané complet du 12/10 — 74 694 / 73 756 documents, collStats après la pose : valeurs 7,6 Mo, index 2,4 Mo, soit × 1,31 ; majoré d'un cinquième).
            // Sur la base du service de test (≈ 456 Mo pour 480 d'arrêt dur) une estimation à × 2,5 aurait REFUSÉ une pose qui n'ajoute que ≈ 10 Mo : le chiffre de l'arrêt se calibre sur la mesure, pas sur la peur.
            const estimation = Math.ceil(p.octets * 1.6);
            plans.push({ spec, ...p, manquants, estimation });
            say(`   ${spec.collection.padEnd(20)} ${String(p.total).padStart(7)} documents · à poser ${String(p.aPoser).padStart(7)} · valeurs ${String(mo(p.octets)).padStart(5)} Mo · index ${manquants.length ? `À CRÉER (${manquants.join(', ')})` : 'présents'} · estimation +${mo(estimation)} Mo`);
            if (p.etrangers) return stop(`« ${spec.collection} » : ${p.etrangers} document(s) portent déjà un champ de l'outil (${champsDe(spec).join(', ')}) sous une forme qui n'est pas la sienne : l'outil n'écrase pas ce qui n'est pas à lui. Rien n'est écrit.`);
        }
        const ajout = plans.reduce((a, p) => a + p.estimation, 0);
        say(`   → ajout estimé : +${mo(ajout)} Mo ; poids final estimé : ${mo(poids0 + ajout)} Mo`);
        if (poids0 + ajout > seuil) return stop(`le poids final estimé (${mo(poids0 + ajout)} Mo) dépasserait l'arrêt dur de ${mo(seuil)} Mo : rien n'est écrit.`);
        if (!A.appliquer) { say(`\n✅ Simulation terminée : rien n'a été écrit. Pour poser : node v2/migrations/poser-cles-nom.js --base=${BASE_CIBLE} --appliquer`); return 0; }

        // ── la pose : les champs d'abord (clés ET témoin dans le même $set), les index ensuite (un index sur un champ incomplet n'est jamais utilisé par le serveur : index-nom.js exige la couverture entière et fraîche)
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
                for (const c of p.spec.champs) await col.createIndex({ [c.champ]: 1 }, { name: c.nomIndex });
            } catch (e) {
                journal({ le: new Date().toISOString(), collection: p.spec.collection, etat: 'interrompue', posees, raison: cause(e) });
                console.error(`   Pose interrompue sur « ${p.spec.collection} » après ${posees} document(s) (${cause(e)}). La relancer reprend où elle s'est arrêtée (idempotente).`);
                return stop(e && e.code === 'ARRET_DUR' ? `ARRÊT DUR avant de franchir ${mo(seuil)} Mo.` : `écriture interrompue (${cause(e)}).`);
            }
            say(`✔️  « ${p.spec.collection} » : ${posees} document(s) posé(s) (${champsDe(p.spec).join(', ')}), index ${p.spec.champs.map(c => `« ${c.nomIndex} »`).join(', ')} présents.`);
            journal({ le: new Date().toISOString(), collection: p.spec.collection, etat: 'posee', posees });
        }

        // ── le contrôle : plus aucun document sans clé ni à témoin périmé, les index existent, et ils servent (plan IXSCAN)
        say('\nContrôle final :');
        let ecarts = 0;
        for (const p of plans) {
            const col = db.collection(p.spec.collection);
            const indexes = (await col.indexes()).map(i => i.name);
            const perimes = await col.countDocuments({ $expr: { $ne: [{ $ifNull: ['$' + p.spec.lu, ''] }, { $ifNull: ['$' + p.spec.temoin, ''] }] } });
            for (const c of p.spec.champs) {
                const sans = await col.countDocuments({ [c.champ]: { $exists: false } });
                const aIndex = indexes.includes(c.nomIndex);
                const plan = JSON.stringify((await col.find(c.sonde).explain('queryPlanner')).queryPlanner.winningPlan);
                const sert = plan.includes('IXSCAN') && !plan.includes('COLLSCAN');
                const bon = sans === 0 && perimes === 0 && aIndex && sert;
                if (!bon) ecarts++;
                say(`   ${bon ? '✅' : '🔴'} ${(p.spec.collection + '.' + c.champ).padEnd(32)} sans clé : ${sans} · témoin périmé : ${perimes} · index ${aIndex ? 'présent' : 'ABSENT'} · plan de la sonde : ${sert ? 'IXSCAN' : 'PAS d\'IXSCAN'}`);
            }
        }
        say(`\n   poids de la cible : ${mo(await poidsCible(db))} Mo (arrêt dur ${mo(seuil)} Mo).`);
        if (ecarts) return stop(`${ecarts} contrôle(s) en écart (🔴 ci-dessus) : relancer la simulation pour comprendre.`);
        say(`✅ Clés posées et indexées. Le serveur les utilise dans la minute qui suit son prochain contrôle de couverture et de fraîcheur (index-nom.js) ; relancer cet outil après chaque import du catalogue.`);
        return 0;
    } finally { await co.fermer(); }
}

module.exports = { principal, lireArguments, verifierOrdreNaturel, poidsCibleParDefaut, PLAN, BASE_CIBLE, ARRET_DUR_MO };

if (require.main === module) {
    require('dotenv').config();
    principal().then(code => process.exit(code)).catch(e => { console.error('❌ erreur imprévue :', cause(e)); process.exit(1); });
}