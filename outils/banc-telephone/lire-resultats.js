'use strict';
// Lecture SEULE des résultats de la page de banc téléphone (collection `banc_telephone` de la base de l'essai `rm_essai`).
//   node outils\banc-telephone\lire-resultats.js [--json] [--depuis=<date ISO>] [--max=<n>]
// Se connecte avec l'URI de LECTURE de l'essai (MONGODB_ESSAI_LECTURE_URI, utilisateur Atlas `read`) : l'outil ne contient aucune écriture — seulement `find`. L'URI n'est jamais affichée.
// Sortie : un tableau par dépôt (le plus récent en dernier), groupé par `runId` (une mesure WASM et une mesure WebGPU de la même exécution portent le même).
require('dotenv').config();
const { MongoClient } = require('mongoose').mongo;

const arg = n => { const a = process.argv.find(x => x === `--${n}` || x.startsWith(`--${n}=`)); return a === undefined ? null : a.includes('=') ? a.slice(n.length + 3) : true; };
const BASE = 'rm_essai', COLLECTION = 'banc_telephone';
const f = (x, d = 0) => (typeof x === 'number' && Number.isFinite(x) ? x.toFixed(d) : '—');
const court = ua => {
    const s = String(ua || '');
    const nav = /(Edg|OPR|SamsungBrowser|CriOS|FxiOS|Chrome|Firefox|Version)\/([\d.]+)/.exec(s), os = /(iPhone OS [\d_]+|iPad|Android [\d.]+|Windows NT [\d.]+|Mac OS X [\d_]+|Linux)/.exec(s), modele = /;\s*([^;)]+)\sBuild\//.exec(s);
    return `${os ? os[1] : '?'}${modele ? ' ' + modele[1] : ''} / ${nav ? nav[1] + ' ' + nav[2].split('.')[0] : s.slice(0, 40)}`;
};

(async () => {
    const uri = process.env.MONGODB_ESSAI_LECTURE_URI;
    if (!uri) { console.error('❌ MONGODB_ESSAI_LECTURE_URI absente du .env : rien à lire (aucune connexion de repli).'); process.exit(1); }
    const depuis = arg('depuis'); const max = Math.max(1, Math.min(200, Number(arg('max')) || 200));
    let filtre = {}; if (depuis) { const d = new Date(depuis); if (Number.isNaN(d.getTime())) { console.error('❌ --depuis : date illisible'); process.exit(1); } filtre = { recuLe: { $gte: d } }; }
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
    try {
        await client.connect();
        const db = client.db(BASE);
        const noms = (await db.listCollections({ name: COLLECTION }, { nameOnly: true }).toArray()).map(c => c.name);
        if (!noms.length) { console.log(`Aucune collection « ${COLLECTION} » dans « ${BASE} » : aucun dépôt reçu (la page n'est pas allumée, ou personne ne l'a encore utilisée).`); return; }
        const total = await db.collection(COLLECTION).countDocuments({});
        const docs = await db.collection(COLLECTION).find(filtre).sort({ _id: -1 }).limit(max).toArray(); docs.reverse();
        if (arg('json')) { console.log(JSON.stringify(docs, null, 1)); return; }
        console.log(`Base « ${BASE} », collection « ${COLLECTION} » : ${total} document(s) au total, ${docs.length} affiché(s).\n`);
        for (const d of docs) {
            const m = d.mesure || {};
            const mem = m.uaFinMo != null ? `${m.uaFinMo} Mo navigateur` : m.jsHeapFinMo != null ? `${f(m.jsHeapFinMo, 0)} Mo tas JS` : 'mémoire non disponible';
            console.log(`${d.recuLe ? new Date(d.recuLe).toISOString() : '?'}  run ${d.runId}  ${String(m.moteur || '?').toUpperCase().padEnd(6)}  ${String(m.verdict || '?').padEnd(9)}  ${court(d.ua)}`);
            console.log(`    cos min ${m.cosMin == null ? '—' : m.cosMin}  moy ${m.cosMoy == null ? '—' : m.cosMoy}  modèle seul ${m.cosMinModeleSeul == null ? '—' : m.cosMinModeleSeul}  contre WASM ${m.cosMinContreWasm == null ? '—' : m.cosMinContreWasm}  (${m.nEmpreintes == null ? '?' : m.nEmpreintes} cartes, ${m.nVecteursRefuses == null ? '?' : m.nVecteursRefuses} refusés)`);
            console.log(`    ${m.fils == null ? '?' : m.fils} fil(s) (demandés ${m.filsDemandes == null ? '?' : m.filsDemandes}), isolé ${d.isole ? 'oui' : 'non'}, ${d.coeurs || '?'} cœurs, appareil ${d.memoireAppareilGo == null ? '? Go' : d.memoireAppareilGo + ' Go'}, WebGPU ${d.gpuDispo ? 'présent' : 'absent'}${d.gpu ? ` (${d.gpu.vendor}/${d.gpu.architecture})` : ''}`);
            console.log(`    session ${f(m.creationSessionMs)} ms · 1re ${f(m.premiereMs)} · médiane ${f(m.medianeMs)} · p95 ${f(m.p95Ms)} · prétraitement ${f(m.pretraitementMedianeMs)} ms · modèle reçu en ${f(d.telechargementMs)} ms (sha ${d.shaVerifie === null ? 'non vérifié' : d.shaVerifie ? 'ok' : 'DIFFÉRENT'}) · ${mem}`);
            if (m.erreur) console.log(`    ERREUR : ${m.erreur}`);
            console.log('');
        }
    } finally { await client.close(); }
})().catch(e => { console.error('❌', (e && (e.code || e.name)) || 'erreur'); process.exit(1); });   // jamais e.message : il pourrait citer l'URI
