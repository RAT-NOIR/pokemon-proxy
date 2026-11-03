'use strict';
// ============================================================
// COMPLETER-SLUGS-PRODUITS — pose sur cartes_produits (base `cartes`) le slug que numeros_cartes (production `test`, LECTURE SEULE) porte aujourd'hui
//   node completer-slugs-produits.js --simuler
//   node completer-slugs-produits.js --ecrire --attendu=<N>      (sous lot-additif.js seulement : LOT_ADDITIF_PID)
// Sans lien Cardmarket, un produit n'a pas de bouton : le slug était nul à la jointure (sept. 2026), appris depuis. Aucun slug n'est deviné ni réécrit :
// la règle est collecte-cartes/slug-produit.js (pure). --ecrire recalcule sur l'état VIVANT (jamais le plan), refuse si le compte ≠ N,
// n'écrit que { _id, slug: null } (un slug posé entre-temps n'est jamais écrasé), puis relit.
// Ligne de commande écrite par ce qu'elle autorise : argument inconnu = refus avant toute connexion.
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { slugAPoser, consolider, RAISONS } = require('./collecte-cartes/slug-produit');

const DOSSIER = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\liens';
const AUTORISES = [/^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const simuler = args.includes('--simuler'), ecrire = args.includes('--ecrire');
const attendu = args.find(a => a.startsWith('--attendu='))?.slice(10);
const attenduN = attendu !== undefined ? Number(attendu) : null;
if (inconnus.length || simuler === ecrire || (ecrire && attenduN === null) || (simuler && attenduN !== null)) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --simuler | --ecrire --attendu=<N> (exactement un des deux ; --attendu seulement avec --ecrire). Rien n'a été ouvert.`);
    process.exit(2);
}
if (ecrire && !process.env.LOT_ADDITIF_PID) { console.error('❌ --ecrire refusé : se lance sous lot-additif.js (LOT_ADDITIF_PID absent). Rien n\'a été ouvert.'); process.exit(2); }

const morceaux = (l, n) => { const r = []; for (let i = 0; i < l.length; i += n) r.push(l.slice(i, i + n)); return r; };
const masquer = f => async () => { const o = console.log; console.log = (...a) => o(...a.map(x => (typeof x === 'string' ? x.replace(/ sur \S+/g, ' sur <hôte masqué>') : x))); try { return await f(); } finally { console.log = o; } };

// Relit l'état vivant et applique la règle : { lignes, apprisN, aPoser, refus }
async function calculer(colL, colN) {
    const lignes = await lireMongo(colL, { slug: null }, { nom: 'cartes_produits', projection: { _id: 1, idProduct: 1, slug: 1, slugSet: 1, idExpansion: 1 }, videAutorise: 'aucune ligne à slug nul : tout est déjà complété' });
    const ids = [...new Set(lignes.map(l => l.idProduct).filter(v => v != null))];
    const docsParId = new Map();
    for (const m of morceaux(ids, 1000)) {
        const docs = await lireMongo(colN, { idProduct: { $in: m } }, { nom: 'numeros_cartes', projection: { idProduct: 1, slug: 1, slugSet: 1, idExpansion: 1 }, videAutorise: 'un lot d\'idProducts peut n\'avoir aucun produit appris' });
        for (const d of docs) { if (!docsParId.has(d.idProduct)) docsParId.set(d.idProduct, []); docsParId.get(d.idProduct).push(d); }
    }
    // plusieurs documents pour un idProduct : slugs (ou slugSets) distincts = ambigu, refusé (consolider)
    const appris = new Map();
    for (const [id, docs] of docsParId) appris.set(id, consolider(docs));
    const refus = Object.fromEntries(RAISONS.map(r => [r, 0]));
    const aPoser = [];
    for (const l of lignes) {
        const r = slugAPoser(l, appris.get(l.idProduct));
        if (r.refus) refus[r.refus]++; else aPoser.push({ _id: l._id, set: r.set, slugSet: l.slugSet || r.set.slugSet || null, slugSetLu: l.slugSet == null ? null : l.slugSet });
    }
    return { lignes, apprisN: appris.size, idsN: ids.length, aPoser, refus };
}

(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await masquer(() => ouvrirConnexions({ production: true, buckets: [], lectureSeule: simuler }))();
    try {
        const colL = cx.cartes.db.collection('cartes_produits');
        const colN = cx.prod.db.collection('numeros_cartes');   // production : LECTURE SEULE, un find seulement
        const r = await calculer(colL, colN);
        console.log(`dénominateurs : ${r.lignes.length} lignes cartes_produits à slug nul · ${r.idsN} idProducts distincts · ${r.apprisN} produits appris trouvés dans numeros_cartes`);
        console.log(`produits ambigus (plusieurs slugs ou slugSets distincts dans numeros_cartes) : ${r.refus['produit-ambigu']} lignes refusées`);
        console.log('refus par raison :');
        for (const [k, v] of Object.entries(r.refus)) console.log(`   ${k.padEnd(24)} ${v}`);
        const parSet = {};
        for (const a of r.aPoser) parSet[a.slugSet || '(sans slugSet)'] = (parSet[a.slugSet || '(sans slugSet)'] || 0) + 1;
        const tri = Object.entries(parSet).sort((a, b) => b[1] - a[1]);
        console.log(`À POSER : ${r.aPoser.length} (somme refus ${Object.values(r.refus).reduce((a, b) => a + b, 0)} + à poser = ${Object.values(r.refus).reduce((a, b) => a + b, 0) + r.aPoser.length} / ${r.lignes.length} lignes)`);
        for (const [s, n] of tri.slice(0, 30)) console.log(`   ${String(n).padStart(6)}  ${s}`);
        if (tri.length > 30) console.log(`   … (+${tri.length - 30} autres slugSets)`);

        if (simuler) {
            fs.mkdirSync(DOSSIER, { recursive: true });
            const f = autoriser(path.join(DOSSIER, 'plan-slugs.json'), [DOSSIER]);
            fs.writeFileSync(f, JSON.stringify({ le: new Date().toISOString(), lignes: r.lignes.length, aPoser: r.aPoser.map(a => ({ _id: a._id, set: a.set })), refus: r.refus }, null, 1));
            console.log(`SIMULATION (rien d'écrit en base) · plan écrit : ${f}`);
            return;
        }

        if (r.aPoser.length !== attenduN) { console.error(`❌ REFUS (code 1, rien d'écrit) : ${r.aPoser.length} à poser sur l'état vivant, attendu ${attenduN}`); process.exitCode = 1; return; }
        const maintenant = new Date();
        let modifie = 0;
        for (const m of morceaux(r.aPoser, 500)) {
            const ops = m.map(a => ({ updateOne: { filter: { _id: a._id, slug: null, slugSet: a.slugSetLu }, update: { $set: { ...a.set, slugPoseLe: maintenant, slugPosePar: 'completer-slugs-produits.js' } } } }));
            const res = await colL.bulkWrite(ops, { ordered: true });
            modifie += res.modifiedCount;
        }
        console.log(`ÉCRIT : modifiedCount ${modifie} (attendu ${attenduN})`);
        const reste = await colL.countDocuments({ slug: null });
        console.log(`relu : ${reste} lignes à slug nul restantes (avant : ${r.lignes.length}, attendu ${r.lignes.length - modifie})`);
        if (modifie !== attenduN) { console.error(`❌ modifiedCount ${modifie} ≠ attendu ${attenduN}`); process.exitCode = 1; }
        if (reste !== r.lignes.length - modifie) { console.error(`❌ reste ${reste} ≠ ${r.lignes.length} - ${modifie} = ${r.lignes.length - modifie}`); process.exitCode = 1; }
        // relecture des lignes écrites : le slug lu doit valoir le slug appris
        let fautes = 0, lues = 0;
        for (const m of morceaux(r.aPoser, 1000)) {
            const rel = await colL.find({ _id: { $in: m.map(a => a._id) } }, { projection: { slug: 1 } }).toArray();
            const parId = new Map(rel.map(d => [String(d._id), d.slug]));
            for (const a of m) { lues++; if (parId.get(String(a._id)) !== a.set.slug) fautes++; }
        }
        console.log(`relecture des lignes écrites : ${lues} lues, ${fautes} dont le slug ≠ slug appris`);
        if (fautes) { console.error(`❌ ${fautes} lignes relues ne portent pas le slug appris`); process.exitCode = 1; }
    } finally { await cx.fermer(); }
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exitCode = 1; });
