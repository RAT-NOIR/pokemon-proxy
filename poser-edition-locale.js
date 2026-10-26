// ============================================================
// POSER `sets.editionLocale` SUR LES SETS DES ÉDITIONS LOCALES (McDonald's européens FR, 2026-10-27)
// ============================================================
//   node poser-edition-locale.js --simuler                                                         (lecture seule : plan, RIEN n'est écrit)
//   node lot-additif.js --quoi="editionLocale : N sets" --collections=sets -- node poser-edition-locale.js --ecrire --attendu=N
//
// Forme retenue par l'API (journal du 26/10 ~22:55 UTC) : un champ de SET `editionLocale: "fr"`, en liste fermée, posé sur les sets des expansions 2361 et 3354 (McDonald's 2018 / 2019 européens,
// « le produit EST français, c'est son tirage », décision du testeur du 26/10). La table est celle de collecte-cartes/preuves.js (EDITIONS_LOCALES), jamais recopiée.
// ADDITIF PUR : un `$set` du champ seul, sur un set qui ne le porte pas (`editionLocale: { $exists: false }`) ; une valeur DIFFÉRENTE déjà posée est un refus (on n'écrase jamais) ;
// une expansion portée par 0 ou plusieurs sets, ou un set non occidental, est un refus nommé.
const { EDITIONS_LOCALES } = require('./collecte-cartes/preuves');

const stable = v => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Date) ? Object.fromEntries(Object.keys(x).sort().map(c => [c, x[c]])) : x));
const sansChamp = s => { const { editionLocale: _, ...reste } = s || {}; return reste; };
const expansionsDe = s => [].concat(s?.idExpansion ?? []).map(Number).filter(Number.isInteger);

/** @param {{sets: object[]}} e  @returns {{ecrire: Array<{_id, editionLocale}>, refus: Array<{idExpansion, raison}>, deja: Array<{_id}>}} */
function planifier({ sets }) {
    const ecrire = [], refus = [], deja = [];
    for (const [cle, langue] of Object.entries(EDITIONS_LOCALES)) {
        const idExpansion = Number(cle);
        const porteurs = (sets || []).filter(s => expansionsDe(s).includes(idExpansion));
        if (porteurs.length !== 1) { refus.push({ idExpansion, raison: `expansion ${idExpansion} : ${porteurs.length ? `${porteurs.length} sets (${porteurs.map(s => s._id).join(', ')})` : 'aucun set'} — un seul attendu` }); continue; }
        const s = porteurs[0];
        if ((s.tirage ?? s.region) !== 'intl') { refus.push({ idExpansion, raison: `set ${s._id} : tirage ${s.tirage ?? s.region} — une édition locale ne se pose que sur un set occidental (intl)` }); continue; }
        if (s.editionLocale !== undefined && s.editionLocale !== null) {
            if (s.editionLocale === langue) deja.push({ _id: s._id }); else refus.push({ idExpansion, raison: `set ${s._id} : editionLocale déjà « ${s.editionLocale} », la table dit « ${langue} » — on n'écrase jamais` });
            continue;
        }
        ecrire.push({ _id: s._id, editionLocale: langue });
    }
    return { ecrire, refus, deja };
}

function verifierAttendu(plan, attendu) {
    if (!Number.isInteger(attendu)) return { ok: false, raison: '--attendu=N obligatoire pour écrire' };
    if (plan.ecrire.length !== attendu) return { ok: false, raison: `le plan compte ${plan.ecrire.length} set(s), attendu ${attendu}` };
    return { ok: true };
}

async function ecrire(db, cibles) {
    let posees = 0;
    for (const c of cibles) posees += (await db.collection('sets').updateOne({ _id: c._id, editionLocale: { $exists: false } }, { $set: { editionLocale: c.editionLocale } })).modifiedCount || 0;
    return { posees };
}

/** Le champ est là, à la valeur posée, et AUCUN autre champ du set n'a bougé. */
async function relire(db, cibles, avant) {
    const apres = await db.collection('sets').find({ _id: { $in: cibles.map(c => c._id) } }).toArray();
    const parId = new Map(apres.map(d => [d._id, d])), avantId = new Map(avant.map(d => [d._id, d]));
    const manques = [], alteres = [];
    for (const c of cibles) {
        const d = parId.get(c._id);
        if (!d || d.editionLocale !== c.editionLocale) { manques.push(c._id); continue; }
        if (stable(sansChamp(d)) !== stable(sansChamp(avantId.get(c._id)))) alteres.push(c._id);
    }
    return { ok: !manques.length && !alteres.length, presentes: `${cibles.length - manques.length}/${cibles.length}`, manques, alteres };
}

async function executer({ argv, ouvrirLecture, ouvrirEcriture, log = console.log, err = console.error, garde }) {
    const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/];
    const inconnus = argv.filter(a => !AUTORISES.some(r => r.test(a)));
    const ecrireDemande = argv.includes('--ecrire'), simuler = argv.includes('--simuler');
    if (inconnus.length || ecrireDemande === simuler) { err(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --simuler | --ecrire --attendu=N`); return 2; }
    const attenduBrut = argv.find(a => a.startsWith('--attendu='))?.slice(10);
    if (ecrireDemande) {
        garde();   // --ecrire hors de lot-additif.js : refusé avant toute connexion
        if (attenduBrut === undefined) { err('❌ ARRÊT : --attendu=N obligatoire pour écrire — rien n\'est écrit'); return 1; }
    }
    const cx = ecrireDemande ? await ouvrirEcriture() : await ouvrirLecture();
    try {
        const db = cx.cartes.db;
        const sets = await db.collection('sets').find({}).toArray();
        if (!sets.length) { err('❌ collection sets vide : grappe fausse ?'); return 2; }
        const plan = planifier({ sets });
        log(`   SETS lus : ${sets.length}`);
        for (const c of plan.ecrire) log(`   + ${c._id} : editionLocale « ${c.editionLocale} »`);
        for (const r of plan.refus) log(`   - REFUS expansion ${r.idExpansion} : ${r.raison}`);
        for (const d of plan.deja) log(`   = déjà posée ${d._id}`);
        log(`\n   PLAN : ${plan.ecrire.length} set(s) · ${plan.refus.length} refus · ${plan.deja.length} déjà`);
        if (!ecrireDemande) { log('   (simulation — rien n\'est écrit)'); return 0; }
        const v = verifierAttendu(plan, Number(attenduBrut));
        if (!v.ok) { err(`❌ ARRÊT : ${v.raison} — rien n'est écrit`); return 1; }
        if (plan.refus.length) { err(`❌ ARRÊT : ${plan.refus.length} refus au plan — rien n'est écrit`); return 1; }
        const avant = sets.filter(s => plan.ecrire.some(c => c._id === s._id));
        const r = await ecrire(db, plan.ecrire);
        const rl = await relire(db, plan.ecrire, avant);
        log(`\n   ${r.posees === plan.ecrire.length && rl.ok ? '✅' : '❌'} posées ${r.posees}/${plan.ecrire.length} · relu : ${rl.presentes}${rl.manques.length ? ` · MANQUES ${JSON.stringify(rl.manques)}` : ''}${rl.alteres.length ? ` · AUTRES CHAMPS BOUGÉS ${JSON.stringify(rl.alteres)}` : ''}`);
        return r.posees === plan.ecrire.length && rl.ok ? 0 : 1;
    } finally { await cx.fermer(); }
}

/** Lecture seule : l'utilisateur Atlas de LECTURE, jamais une URI d'écriture. */
async function ouvrirLecture() {
    const { MongoClient } = require('mongodb');
    if (!process.env.MONGODB_CARTES_LECTURE_URI) throw new Error('MONGODB_CARTES_LECTURE_URI obligatoire pour la simulation (lecture seule)');
    const a = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI); await a.connect();
    return { cartes: { db: a.db('cartes') }, fermer: () => a.close() };
}

module.exports = { EDITIONS_LOCALES, planifier, verifierAttendu, ecrire, relire, executer };

if (require.main === module) {
    require('dotenv').config({ quiet: true });
    executer({ argv: process.argv.slice(2), ouvrirLecture, ouvrirEcriture: async () => { const o = await require('./collecte-cartes/garde').ouvrirConnexions({ production: false, buckets: [] }); return { cartes: o.cartes, fermer: o.fermer }; },
        garde: () => require('./collecte-cartes/images-empruntees').garderSousLot(process.env, process.ppid) })
        .then(c => { process.exitCode = c; }).catch(e => { console.error('❌', e.message); process.exitCode = 1; });
}
