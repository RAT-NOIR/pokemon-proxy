// ============================================================
// RESTAURER LES MARQUEURS « ORPHELINE » — défaire le passage de marquer-orphelines.js du 2026-10-05 (lot backup-2026-10-05-lot-203043)
// ============================================================
//   node restaurer-marqueurs-orphelines.js --sauvegarde=<dossier>                                         (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=images -- node restaurer-marqueurs-orphelines.js --sauvegarde=<dossier> --ecrire
// Ce passage, lancé pour retirer les marqueurs de deux Pidgeot enfin joints, a aussi MARQUÉ « ambiguë » 826 images sans carte que
// l'outil n'avait jamais vues : il date d'une base où `images` ne contenait que des fichiers artofpkm, et toute image sans carte
// (Bulbapedia, TCGdex, refusée, trop petite, en échec) y passait pour « plusieurs cartes, rien ne les sépare » — un motif faux.
// On rend aux quatre champs (orpheline, orphelineMotif, decision, decisionLe) leur valeur de la sauvegarde prise JUSTE AVANT :
//   · marqué maintenant, absent de la sauvegarde -> les quatre champs sont retirés ;
//   · marqué maintenant ET dans la sauvegarde    -> les quatre valeurs de la sauvegarde reviennent (decisionLe surtout) ;
//   · NON marqué maintenant                      -> rien (les deux Pidgeot joints restent sans marqueur, c'est juste).
// Aucun autre champ n'est lu ni écrit.
require('dotenv').config();
const AUTORISES = [/^--sauvegarde=.+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const fs = require('fs'), path = require('path');
const { EJSON } = require('bson');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const DOSSIER = process.argv.find(a => a.startsWith('--sauvegarde='))?.slice(13);
if (!DOSSIER || !fs.existsSync(path.join(DOSSIER, 'images.json'))) { console.error('❌ --sauvegarde=<dossier contenant images.json> requis'); process.exit(2); }
const CHAMPS = ['orpheline', 'orphelineMotif', 'decision', 'decisionLe'];

(async () => {
    const avant = EJSON.parse(fs.readFileSync(path.join(DOSSIER, 'images.json'), 'utf8'), { relaxed: false });
    const marquesAvant = new Map(avant.filter(d => d.orpheline).map(d => [d._id, Object.fromEntries(CHAMPS.map(k => [k, d[k]]))]));
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const I = cx.db.collection('images');
    const maintenant = await I.find({ orpheline: true }, { projection: { _id: 1, source: 1 } }).toArray();
    const aRetirer = maintenant.filter(d => !marquesAvant.has(d._id));
    const aRendre = maintenant.filter(d => marquesAvant.has(d._id));
    const parSource = {}; for (const d of aRetirer) parSource[d.source ?? '—'] = (parSource[d.source ?? '—'] ?? 0) + 1;
    console.log(`DÉNOMINATEUR : sauvegarde ${avant.length} images, ${marquesAvant.size} marquées · base : ${maintenant.length} marquées`);
    console.log(`   à DÉMARQUER (marquées par ce passage) : ${aRetirer.length} ${JSON.stringify(parSource)} · à RENDRE à la sauvegarde : ${aRendre.length}`);
    if (!process.argv.includes('--ecrire')) { console.log('(plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    const ops = [
        ...aRetirer.map(d => ({ updateOne: { filter: { _id: d._id, orpheline: true }, update: { $unset: Object.fromEntries(CHAMPS.map(k => [k, 1])) } } })),
        ...aRendre.map(d => ({ updateOne: { filter: { _id: d._id }, update: { $set: marquesAvant.get(d._id) } } }))
    ];
    const r = ops.length ? await I.bulkWrite(ops) : { modifiedCount: 0 };
    const relus = await I.countDocuments({ orpheline: true });
    console.log(`${relus === aRendre.length ? '✅' : '🔴'} ${r.modifiedCount} document(s) modifié(s) · RELU : ${relus} image(s) marquée(s) orpheline (attendu ${aRendre.length})`);
    if (relus !== aRendre.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
