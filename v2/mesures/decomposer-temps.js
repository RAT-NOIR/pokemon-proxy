'use strict';
// TEMPS-ETAPES — la DÉCOMPOSITION du temps d'un scan, par étape (p50, p95, dénominateur), LECTURE SEULE (aucune écriture, aucun appel payant).
//   1. --extraire --env=<.env> --dossier=<dir>      lit rm_essai (MONGODB_ESSAI_LECTURE_URI) : les lignes `banc: true` de journal_scans et d'analyses, seulement des champs numériques, des dates et des statuts ; écrit
//                                                    <dir>/journal-banc.json et <dir>/analyses-banc.json. L'adresse de la base n'est jamais imprimée.
//   2. --journal=<j.json> --analyses=<a.json> --logs=<l.json> --series=<s1.json,s2.json>        la décomposition d'une série du CLIENT (serie-essai.js) avec le journal d'AVANT l'instrumentation :
//        · client : dépôt de la photo + identifier, vu du client ; · chaîne héritée : du message « 📷 [identifier] N photo(s) reçue(s) » (logs Render, ms) à journal.le, dont msIA / msCatalogue / imageMs ;
//        · route v2 après la chaîne : journal.le -> analyses.creeLe ; · hors : ce qui reste (dépôt de la photo, réseau, avant la chaîne, après l'écriture de l'analyse).
//        --logs = { serie1: ["HH:MM:SS.mmm", …], serie2: […] } (UTC, jour = --jour=AAAA-MM-JJ), à relever par list_logs sur le message ci-dessus.
//   3. --durees=<a.json>                            la décomposition d'APRÈS l'instrumentation : analyses.durees (photo, lecture, empreinte, voisins, orb, base, total) et le CPU, le ramasse-miettes, la mémoire.
// Les fonctions pures (quantile, decomposerJournal, decomposerDurees) sont testées par v2/test/test-temps-etapes.js.
const fs = require('fs'), path = require('path');

/** nearest-rank, comme serie-essai.js ; null si la liste est vide ou sans nombre fini. */
function quantile(valeurs, q) {
    const s = valeurs.filter(Number.isFinite).sort((a, b) => a - b);
    if (!s.length) return null;
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
const resume = valeurs => { const v = valeurs.filter(Number.isFinite); return { n: v.length, p50: quantile(v, 0.5), p90: quantile(v, 0.9), p95: quantile(v, 0.95), max: v.length ? Math.max(...v) : null }; };

/**
 * @param {{journal: object[], analyses: object[], debuts: number[], clients: number[]}} o — les quatre listes DOIVENT avoir la même longueur (une ligne par scan, triées par heure) ; sinon LÈVE (un appariement
 *   qui ne tombe pas juste donnerait des étapes fausses sans le dire). `debuts` : l'heure (ms epoch) du message de début de chaîne ; `clients` : la durée vue du client (ms).
 * @returns {{lignes: object[], etapes: object}}
 */
function decomposerJournal({ journal, analyses, debuts, clients }) {
    if (![analyses, debuts, clients].every(l => Array.isArray(l) && l.length === journal.length)) throw new Error(`appariement impossible : journal ${journal.length}, analyses ${analyses && analyses.length}, débuts ${debuts && debuts.length}, clients ${clients && clients.length}`);
    const lignes = journal.map((j, i) => {
        const B = +new Date(j.le), C = +new Date(analyses[i].creeLe), L = debuts[i];
        const chaine = B - L, ia = j.msIA, cat = j.msCatalogue, img = Number.isFinite(j.imageMs) ? j.imageMs : 0;
        return { i, client: clients[i], chaine, ia, etat: j.msEtat, catalogue: cat, image: img, resteChaine: chaine - ia - cat - img, apresChaine: C - B, hors: clients[i] - (C - L) };
    });
    const etapes = {};
    for (const k of ['client', 'chaine', 'ia', 'etat', 'catalogue', 'image', 'resteChaine', 'apresChaine', 'hors']) etapes[k] = resume(lignes.map(l => l[k]));
    return { lignes, etapes };
}

/** analyses.durees (après l'instrumentation) : p50 / p95 par étape, le CPU par étape, le ramasse-miettes et la mémoire. */
function decomposerDurees(analyses) {
    const lignes = analyses.map(a => a && a.durees).filter(d => d && typeof d === 'object');
    const noms = new Set(); for (const d of lignes) for (const k of Object.keys(d)) if (k !== 'cpu') noms.add(k);
    const etapes = {}, cpu = {};
    for (const k of noms) etapes[k] = resume(lignes.map(d => d[k]));
    const nomsCpu = new Set(); for (const d of lignes) if (d.cpu) for (const k of Object.keys(d.cpu)) nomsCpu.add(k);
    for (const k of nomsCpu) cpu[k] = resume(lignes.map(d => (d.cpu ? d.cpu[k] : undefined)));
    return { n: lignes.length, etapes, cpu };
}

const imprimer = (nom, r) => console.log(`${nom.padEnd(44)} n=${String(r.n).padStart(3)}  p50 ${String(r.p50).padStart(5)}  p90 ${String(r.p90).padStart(5)}  p95 ${String(r.p95).padStart(5)}  max ${r.max}`);
module.exports = { quantile, resume, decomposerJournal, decomposerDurees };

const arg = (nom, d = null) => { const a = process.argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : d; };
const lire = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const triee = (l, champ) => [...l].sort((a, b) => new Date(a[champ]) - new Date(b[champ]));

async function extraire() {
    const env = fs.readFileSync(arg('env'), 'utf8');
    const m = env.match(/^\s*MONGODB_ESSAI_LECTURE_URI\s*=\s*(.*)\s*$/m);
    if (!m) throw new Error('MONGODB_ESSAI_LECTURE_URI absente');
    const { MongoClient } = require(path.join(__dirname, '..', '..', 'node_modules', 'mongodb'));
    const c = new MongoClient(m[1].replace(/^["']|["']$/g, ''), { serverSelectionTimeoutMS: 20000 });
    await c.connect();
    try {
        const db = c.db('rm_essai'), dossier = arg('dossier');
        const jChamps = { le: 1, msIA: 1, msCatalogue: 1, msEtat: 1, imageMs: 1, imageStatut: 1, voieCatalogue: 1, nbPhotos: 1, resultat: 1, banc: 1 };
        const j = (await db.collection('journal_scans').find({ banc: true }, { projection: jChamps }).toArray()).map(x => ({ ...x, _id: String(x._id) }));
        const a = (await db.collection('analyses').find({ banc: true }, { projection: { creeLe: 1, statut: 1, durees: 1, banc: 1 } }).toArray()).map(x => ({ ...x, _id: String(x._id) }));
        fs.writeFileSync(path.join(dossier, 'journal-banc.json'), JSON.stringify(j)); fs.writeFileSync(path.join(dossier, 'analyses-banc.json'), JSON.stringify(a));
        console.log(`extrait : ${j.length} lignes de journal_scans, ${a.length} d'analyses (banc: true) -> ${dossier}`);
    } finally { await c.close(); }
}

if (require.main === module) {
    (async () => {
        if (process.argv.includes('--extraire')) return extraire();
        if (arg('durees')) {
            const d = decomposerDurees(lire(arg('durees')));
            console.log(`analyses.durees : ${d.n} lignes (dénominateur)`);
            for (const [k, r] of Object.entries(d.etapes)) imprimer(k, r);
            console.log('CPU (ms de calcul du processus pendant l\'étape) :');
            for (const [k, r] of Object.entries(d.cpu)) imprimer('  cpu.' + k, r);
            return;
        }
        const J = triee(lire(arg('journal')), 'le'), A = triee(lire(arg('analyses')), 'creeLe'), LG = lire(arg('logs')), jour = arg('jour', '2026-10-25');
        const debuts = [...LG.serie1, ...(LG.serie2 || [])].map(h => +new Date(`${jour}T${h}Z`));
        const clients = arg('series').split(',').flatMap(f => lire(f).resultats.map(r => r.ms));
        const { etapes } = decomposerJournal({ journal: J, analyses: A, debuts, clients });
        console.log(`journal_scans banc:true : ${J.length} lignes (dénominateur) ; source : journal + analyses (rm_essai, lecture seule), débuts de chaîne des logs Render, durées du client`);
        for (const [k, r] of Object.entries(etapes)) imprimer(k, r);
    })().catch(e => { console.error('❌', e.message); process.exit(1); });
}
