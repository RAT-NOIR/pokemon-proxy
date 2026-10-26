// ============================================================
// LA 5e VOIE DES FICHES PROUVÉES : « DEUX SOURCES SANS SETLIST » — l'outil (V5, 2026-10-26)
// ============================================================
//   node poser-fiches-voie-deux-sources.js --simuler --liste=<scan>.json [--seulement=<ids>.json] [--plan=<f>.json] [--resume=<f>.json] [--pret=<f>.json]     (LECTURE SEULE : rien n'est écrit)
//   node lot-additif.js --quoi="V5 : N lignes deux-sources" --collections=cartes,cartes_produits -- node poser-fiches-voie-deux-sources.js --ecrire --liste=<scan>.json --seulement=<pret>.json --attendu=N
//
// `--liste` : la sortie de scanner-deux-sources.js (idProduct → { exp, set, ok, concordantes, refusees, … }). Un produit non confirmé (ok faux) est REFUSÉ, nommé. Le jugement et le plan sont ceux de
// collecte-cartes/voie-deux-sources.js (fiches-prouvees.js::prouver, voie « deux-sources », puis poser-numerotation.planifier pour l'impression) : cet outil ne décide rien, il lit et écrit.
// `--simuler` écrit le plan (`--plan`, le format de simuler-abc.js et simuler-lot-api.js), le résumé (`--resume`) et la liste PRÊTE (`--pret` : les idProduct dont la ligne passe) ; `--ecrire` exige `--seulement`
// (= cette liste prête), `--attendu` (= son compte) ET d'être lancé sous lot-additif.js. Un refus dans le périmètre de `--seulement` (la base a bougé depuis la simulation) arrête tout.
// ADDITIF PUR : une ligne `cartes_produits` en `$setOnInsert`, `liens.idProduct` en `$addToSet` EN FIN (le repère d'adresse ne bouge pas), une impression `numero-cardmarket` en `$push` gardé par `$not $elemMatch`.
const fs = require('fs');
const path = require('path');
const V = require('./collecte-cartes/voie-deux-sources');
const LOT = require('./collecte-cartes/lot-seulement');

const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--liste=.+\.json$/, /^--seulement=.+\.json$/, /^--attendu=\d+$/, /^--plan=.+\.json$/, /^--resume=.+\.json$/, /^--pret=.+\.json$/];

/** La lecture (UNE définition pour la simulation et l'écriture) : { cartes, sets, produits, NC, lignes }. `cartesDb` = base `cartes`, `prodDb` = base `test`. */
async function lire({ cartesDb, prodDb, expansions }) {
    const { produitsDeLExpansion } = require('./collecte-cartes/jointure');
    const cartes = await cartesDb.collection('cartes').find({}, { projection: { nomEn: 1, niveau: 1, 'attaques.nom': 1, impressions: 1, sets: 1, liens: 1, 'images.set': 1, 'images.numero': 1, ficheSimple: 1, 'bulba.titre': 1 } }).toArray();
    if (!cartes.length) throw new Error('lecture vide : aucune carte (grappe fausse ?)');
    const sets = new Map((await cartesDb.collection('sets').find({}, { projection: { tirage: 1, region: 1, idExpansion: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    if (!sets.size) throw new Error('lecture vide : aucun set (grappe fausse ?)');
    const lignes = await cartesDb.collection('cartes_produits').find({}, { projection: { carteId: 1, idProduct: 1, slugSet: 1, numeroFiche: 1, preuve: 1 } }).toArray();
    if (!lignes.length) throw new Error('lecture vide : aucune ligne cartes_produits (grappe fausse ?)');
    const NC = new Map((await prodDb.collection('numeros_cartes').find({}, { projection: { idProduct: 1, numero: 1, codeSet: 1 } }).toArray()).map(n => [n.idProduct, { numero: n.numero ?? null, codeSet: n.codeSet ?? null }]));
    if (!NC.size) throw new Error('lecture vide : aucun numéro Cardmarket (grappe fausse ?)');
    const produits = new Map();
    for (const exp of expansions) produits.set(exp, await produitsDeLExpansion({ db: prodDb }, exp));
    return { cartes, sets, produits, NC, lignes };
}

/** Les entrées du plan, tirées de la liste du scanner. Un produit non confirmé est un refus d'ENTRÉE (il ne passe pas dans le planificateur). */
function entreesDeLaListe(liste, seulement) {
    const entrees = [], refus = [];
    for (const [id, d] of Object.entries(liste)) {
        const idProduct = Number(id);
        if (seulement && !seulement.has(idProduct)) continue;
        if (!d.ok) { refus.push({ idProduct, raison: `non confirmé par deux sources (${d.raison || 'raison non écrite'})` }); continue; }
        if (!d.set || !Number.isInteger(d.exp)) { refus.push({ idProduct, raison: 'la liste ne dit ni le set ni l\'expansion du produit' }); continue; }
        entrees.push({ idProduct, idExpansion: d.exp, slugSet: d.set, secondeSource: { concordantes: d.concordantes || [], refusees: d.refusees || [] } });
    }
    return { entrees, refus };
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, lireListe = f => JSON.parse(fs.readFileSync(f, 'utf8')), ecrireFichier = (f, t) => fs.writeFileSync(f, t), log = console.log, err = console.error, env = process.env, ppid = process.ppid }) {
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const arg = n => argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
    const ecrire = argv.includes('--ecrire'), simuler = argv.includes('--simuler');
    if (inconnus.length || !arg('liste') || ecrire === simuler) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}exactement UN mode (--simuler | --ecrire) et --liste=<scan>.json obligatoires`); return 2; }
    if (ecrire) {
        try { require('./collecte-cartes/phase2-visuels').garderSousLot(env, ppid, 'node lot-additif.js --quoi="V5 : N lignes deux-sources" --collections=cartes,cartes_produits -- node poser-fiches-voie-deux-sources.js --ecrire --liste=<scan>.json --seulement=<pret>.json --attendu=N'); } catch (e) { err(`❌ ${e.message}`); return 2; }
        if (!arg('seulement') || arg('attendu') === undefined) { err('❌ --ecrire exige --seulement=<liste prête>.json ET --attendu=<N> — rien n\'est écrit'); return 2; }
    }
    let liste, seulement = null;
    try { liste = lireListe(arg('liste')); } catch (e) { err(`❌ liste illisible (${String(e.message).slice(0, 120)}) — rien n'est écrit`); return 2; }
    if (!liste || typeof liste !== 'object' || !Object.keys(liste).length) { err('❌ la liste est vide ou mal formée — rien n\'est écrit'); return 2; }
    if (arg('seulement')) { try { seulement = LOT.lire('--seulement', () => JSON.stringify(lireListe(arg('seulement')))); } catch (e) { err(`❌ ${e.message} — rien n'est écrit`); return 2; } }
    if (seulement) { const absents = [...seulement].filter(id => !(String(id) in liste)); if (absents.length) { err(`❌ ARRÊT : ${absents.length} idProduct de --seulement ne sont pas dans la liste (${absents.slice(0, 8).join(', ')}) — rien n'est écrit`); return 1; } }
    const { entrees, refus: refusEntree } = entreesDeLaListe(liste, seulement);
    const cx = ecrire ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const cartesDb = cx.cartes.db, prodDb = cx.prod.db;
        const lecture = await lire({ cartesDb, prodDb, expansions: [...new Set(entrees.map(e => e.idExpansion))] });
        const plan = V.planifierVoie({ entrees, lecture });
        plan.refus = [...refusEntree, ...plan.refus].sort((a, b) => a.idProduct - b.idProduct);
        const codes = new Map([...lecture.NC].map(([id, n]) => [id, n.codeSet ?? null]));
        log(`   DÉNOMINATEURS : ${Object.keys(liste).length} produits dans la liste${seulement ? ` · ${seulement.size} retenus par --seulement` : ''} · ${entrees.length} confirmés par deux sources · ${lecture.cartes.length} cartes · ${lecture.sets.size} sets · ${lecture.lignes.length} lignes cartes_produits`);
        for (const l of plan.lignes) log(`   + ${l._id} (${l.slugSet}, numeroFiche ${l.numeroFiche}) ${l.detail}`);
        for (const r of plan.refus) log(`   - REFUS ${r.idProduct} : ${r.raison}`);
        const parSet = {}; for (const l of plan.lignes) parSet[l.slugSet] = (parSet[l.slugSet] || 0) + 1;
        log(`\n   PLAN : ${plan.lignes.length} ligne(s) · ${plan.impressions.length} impression(s) numero-cardmarket à poser sur ${new Set(plan.impressions.map(x => x.carteId)).size} carte(s) · ${plan.refus.length} refus · par set ${JSON.stringify(parSet)}`);
        const causes = {}; for (const r of plan.refus) { const c = r.raison.replace(/\(.*?\)/g, '(…)').replace(/«[^»]*»/g, '«…»').replace(/\d+/g, '#').slice(0, 110); causes[c] = (causes[c] || 0) + 1; }
        for (const [c, n] of Object.entries(causes).sort((a, b) => b[1] - a[1])) log(`      ${String(n).padStart(4)} · ${c}`);
        if (arg('plan')) ecrireFichier(arg('plan'), JSON.stringify(V.planJson(plan, codes)));
        if (arg('pret')) ecrireFichier(arg('pret'), JSON.stringify(plan.lignes.map(l => l.idProduct)));
        if (arg('resume')) ecrireFichier(arg('resume'), JSON.stringify({ lignes: plan.lignes.map(l => ({ idProduct: l.idProduct, carteId: l.carteId, slugSet: l.slugSet, numeroFiche: l.numeroFiche, sources: l.confirmation.sources, refs: l.confirmation.refs })), impressions: plan.impressions, refus: plan.refus }, null, 1));
        if (simuler) { log('   (simulation — rien n\'est écrit ; l\'écriture exige lot-additif.js, --seulement=<liste prête> et --attendu)'); return 0; }
        const metaDe = new Map([...lecture.produits.values()].flat().map(p => [p.idProduct, p.idMetacard]));
        const parId = new Map(lecture.cartes.map(c => [c._id, c]));
        const repereAvant = new Map(plan.lignes.map(l => [l.carteId, parId.get(l.carteId)?.liens?.idProduct?.[0]]).filter(([, v]) => v !== undefined));
        return await V.ecrire({ db: cartesDb, plan, attendu: Number(arg('attendu')), nomListe: path.basename(arg('seulement')), metaDe, repereAvant, log, err });
    } finally { await cx.fermer(); }
}

/** Connexions de LECTURE SEULE (utilisateurs Atlas de lecture) : la simulation n'ouvre jamais une URI d'écriture. */
async function ouvrirLecture() {
    const { MongoClient } = require('mongodb');
    const u1 = process.env.MONGODB_CARTES_LECTURE_URI, u2 = process.env.MONGODB_LECTURE_URI;
    if (!u1 || !u2) throw new Error('MONGODB_CARTES_LECTURE_URI et MONGODB_LECTURE_URI obligatoires pour la simulation (lecture seule)');
    const a = new MongoClient(u1), b = new MongoClient(u2);
    await Promise.all([a.connect(), b.connect()]);
    const cartes = a.db('cartes'), prod = b.db('test');
    for (const [nom, db] of [['cartes', cartes], ['test', prod]]) if (!(await db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error(`base « ${nom} » vide : grappe fausse ?`);
    return { cartes: { db: cartes }, prod: { db: prod }, fermer: async () => { await Promise.allSettled([a.close(), b.close()]); } };
}

module.exports = { executer, entreesDeLaListe, lire, ouvrirLecture, AUTORISES };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    executer({ argv: process.argv.slice(2), ouvrirLecture, ouvrirEcriture: () => require('./collecte-cartes/garde').ouvrirConnexions({ production: true, buckets: [] }) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
