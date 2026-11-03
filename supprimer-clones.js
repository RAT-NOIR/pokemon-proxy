'use strict';
// ============================================================
// SUPPRIMER-CLONES — retire les fiches hors composition (clones) de cartes.sets, sous la garde de lot (agent catalogue, 2026-11-03)
//   node supprimer-clones.js --decision=<CLONES.json> --simuler|--ecrire --attendu=<N clones> --attendu-images=<M entrées retirées> [--base=cartes]
// --simuler : base ouverte EN LECTURE SEULE ; relit l'état vivant, refuse si une condition a changé, imprime les comptes, écrit clones/annonce.json
//             (format de lot-additif.js --annonce=, fabriqué par la fonction de comptage de la garde, puis rejoué avec elle : 0 baisse non annoncée).
// --ecrire  : exige d'être lancé SOUS lot-additif.js (LOT_ADDITIF_PID) ; relit l'état vivant, REFUSE (code 1, rien d'écrit) si une seule condition a changé, écrit le
//             journal des anciennes valeurs AVANT d'écrire, puis bulkWrite sur `cartes` : $push de la copie, $pull de l'image du set, $pull du slug dans sets. Rien d'autre.
// Une garde s'écrit par ce qu'elle autorise : argument inconnu = refus avant toute connexion. Ligne de lot attendue :
//   node lot-additif.js --quoi="clones : N fiches hors composition retirées de cartes.sets" --collections=cartes --annonce=<clones\annonce.json> -- node supprimer-clones.js --decision=<CLONES.json> --ecrire --attendu=N --attendu-images=M
// Restauration d'une carte depuis le journal : $addToSet sets <set> ; $pull images {set: copie} ; $push images <imagesRetirees>.
// ============================================================
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { EJSON } = require('mongodb').BSON;
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const { verifierEtat, annoncer, appliquer } = require('./collecte-cartes/clones');
const { validerAnnonces } = require('./collecte-cartes/garde-lot');

const DOSSIER_CLONES = 'C:\\Users\\Yung\\rat-market-travail\\catalogue\\clones';
const AUTORISES = [/^--decision=.+\.json$/, /^--simuler$/, /^--ecrire$/, /^--attendu=\d+$/, /^--attendu-images=\d+$/, /^--base=cartes$/];
const args = process.argv.slice(2);
const inconnus = args.filter(a => !AUTORISES.some(r => r.test(a)));
const val = nom => args.find(a => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const simuler = args.includes('--simuler'), ecrire = args.includes('--ecrire');
const decisionArg = val('decision'), attendu = val('attendu') !== undefined ? Number(val('attendu')) : null, attenduImages = val('attendu-images') !== undefined ? Number(val('attendu-images')) : null;
if (inconnus.length || simuler === ecrire || !decisionArg || attendu === null || attenduImages === null) {
    console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --decision=<CLONES.json> (--simuler | --ecrire) --attendu=<N> --attendu-images=<M> [--base=cartes] (exactement un de --simuler / --ecrire). Rien n'a été ouvert.`);
    process.exit(2);
}
if (ecrire && !process.env.LOT_ADDITIF_PID) { console.error('❌ --ecrire refusé hors lot-additif.js (LOT_ADDITIF_PID absent) : sauvegarde, garde et journal passent par le lot. Rien n\'a été ouvert.'); process.exit(2); }

const masquer = f => async () => { const o = console.log; console.log = (...a) => o(...a.map(x => (typeof x === 'string' ? x.replace(/ sur \S+/g, ' sur <hôte masqué>') : x))); try { return await f(); } finally { console.log = o; } };
const morceaux = (l, n) => { const r = []; for (let i = 0; i < l.length; i += n) r.push(l.slice(i, i + n)); return r; };

(async () => {
    const decision = JSON.parse(fs.readFileSync(path.resolve(decisionArg), 'utf8'));
    if (!Array.isArray(decision.clones) || !decision.clones.length) throw new Error('décision sans clones (tableau vide ou absent) : rien à faire — un zéro n\'est pas une instruction');
    const clones = decision.clones;
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await masquer(() => ouvrirConnexions({ production: false, buckets: [], lectureSeule: simuler }))();
    try {
        const col = cx.cartes.db.collection('cartes'), colL = cx.cartes.db.collection('cartes_produits');
        const ids = [...new Set(clones.map(c => c.carteId))];
        const docs = new Map(), lignes = [];
        for (const m of morceaux(ids, 500)) {
            for (const d of await col.find({ _id: { $in: m } }).toArray()) docs.set(d._id, d);
            lignes.push(...await colL.find({ carteId: { $in: m } }, { projection: { carteId: 1, idProduct: 1, slugSet: 1 } }).toArray());
        }
        console.log(`état vivant relu : ${docs.size}/${ids.length} cartes · ${lignes.length} lignes cartes_produits de ces cartes · ${clones.length} clones décidés`);
        const erreurs = verifierEtat({ clones, docs, lignes, attendu, attenduImages });
        if (erreurs.length) {
            console.error(`❌ REFUS (code 1, rien d'écrit) : ${erreurs.length} condition(s) changée(s)`);
            for (const e of erreurs.slice(0, 25)) console.error(`   ${e}`);
            if (erreurs.length > 25) console.error(`   … (+${erreurs.length - 25})`);
            process.exitCode = 1; return;
        }
        const nImages = clones.reduce((a, c) => a + c.images.length, 0), nCopies = clones.reduce((a, c) => a + c.images.filter(i => i.action === 'copier').length, 0);
        console.log(`conditions rejouées : ✅ ${clones.length} clones (attendu ${attendu}) · ${nImages} entrées d'images retirées (attendu ${attenduImages}), dont ${nCopies} copiées d'abord`);

        if (simuler) {
            const { annonce, nonAutorisees } = annoncer(docs, clones);
            if (nonAutorisees.length) throw new Error(`l'annonce fabriquée laisse ${nonAutorisees.length} baisse(s) non autorisée(s) : ${nonAutorisees.slice(0, 3).map(b => b.cle).join(' ; ')}`);
            validerAnnonces(annonce);
            fs.mkdirSync(DOSSIER_CLONES, { recursive: true });
            const f = autoriser(path.join(DOSSIER_CLONES, 'annonce.json'), [DOSSIER_CLONES]);
            fs.writeFileSync(f, JSON.stringify(annonce, null, 1));
            console.log(`SIMULATION (rien d'écrit en base) : ${Object.keys(annonce).length} clés d'annonce, rejouées avec la garde : 0 baisse non annoncée · écrit ${f}`);
            return;
        }

        // ── écriture : le journal des anciennes valeurs d'abord
        const horodatage = new Date().toISOString().replace(/:/g, '');
        const journal = clones.map(c => { const d = docs.get(c.carteId), r = appliquer(d, c); return { carteId: c.carteId, set: c.set, setsAvant: d.sets, imagesRetirees: r.retirees, imagesCopiees: r.copiees }; });
        fs.mkdirSync(DOSSIER_CLONES, { recursive: true });
        const fj = autoriser(path.join(DOSSIER_CLONES, `journal-${horodatage}.json`), [DOSSIER_CLONES]);
        fs.writeFileSync(fj, EJSON.stringify(journal, { relaxed: false }));
        console.log(`journal des anciennes valeurs écrit : ${fj} (${journal.length} entrées)`);
        const ops = [];
        clones.forEach((c, k) => {
            ops.push({ updateOne: { filter: { _id: c.carteId, sets: c.set }, update: { $pull: { sets: c.set } } } });
            for (const e of journal[k].imagesCopiees) ops.push({ updateOne: { filter: { _id: c.carteId, 'images.set': { $ne: e.set } }, update: { $push: { images: e } } } });
            if (journal[k].imagesRetirees.length) ops.push({ updateOne: { filter: { _id: c.carteId }, update: { $pull: { images: { set: c.set } } } } });
        });
        const res = await col.bulkWrite(ops, { ordered: true });
        console.log(`ÉCRIT : ${ops.length} opérations · modifiés ${res.modifiedCount}`);
    } finally { await cx.fermer(); }
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exitCode = 1; });
