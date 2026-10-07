// ============================================================
// LA NOTE INTERNE D'artofpkm CHANGE DE NOM : `mention` -> `noteVariante` (cartes.images, et images s'il y en a)
// ============================================================
//   node renommer-note-variante.js                                   (simulation : les comptes, rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=images -- node renommer-note-variante.js --ecrire --attendu=<N>
//
// FEU VERT DU TESTEUR (2026-10-08) : « RENOMMAGE mention -> noteVariante (artofpkm, 1 045 documents) : FEU VERT, sous garde ».
// POURQUOI (site, 2026-10-07) : `mention` est le texte PUBLIC qu'un visuel doit porter (« © Pokémon / The Pokémon Company », sources
// TPC) ; la note des Additionals (« la source ne distingue pas le motif ») portait le même nom — un lecteur qui afficherait « toute
// entrée à mention » l'aurait publiée. L'écrivain (collecteur-images.js) écrit `noteVariante` depuis le même commit.
// CE QUI EST AUTORISÉ, ET RIEN D'AUTRE : une entrée `source: 'artofpkm'` dont `mention` est EXACTEMENT le texte de la note. Une
// autre mention sur une entrée artofpkm est inconnue : RIEN ne s'écrit. Les mentions TPC ne sont pas touchées (comptées avant et
// après). Le texte ne change pas, seul le nom du champ.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const NOTE = 'variante Cardmarket : la source ne distingue pas le motif — une image par numéro';
const TPC = ['tpc-asie', 'pokemon-card-com'];

const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const ECRIRE = process.argv.includes('--ecrire');
const ATTENDU = Number(process.argv.find(a => a.startsWith('--attendu='))?.slice(10) ?? NaN);
if (inconnus.length || (ECRIRE && !Number.isInteger(ATTENDU))) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : [--ecrire --attendu=<N annoncé par la simulation>]`); process.exit(2); }

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), I = cx.db.collection('images');
    const total = await C.estimatedDocumentCount();
    if (!total) throw new Error('« cartes » est VIDE (§41)');
    // les comptes, par la même fonction avant et après
    const compter = async () => {
        const [e = {}] = await C.aggregate([
            { $match: { $or: [{ 'images.mention': { $exists: true } }, { 'images.noteVariante': { $exists: true } }] } },
            { $unwind: '$images' },
            { $group: {
                _id: null,
                cartes: { $addToSet: '$_id' },
                note: { $sum: { $cond: [{ $and: [{ $eq: ['$images.source', 'artofpkm'] }, { $eq: ['$images.mention', NOTE] }] }, 1, 0] } },
                noteVariante: { $sum: { $cond: [{ $eq: [{ $type: '$images.noteVariante' }, 'string'] }, 1, 0] } },
                artofpkmAutreMention: { $sum: { $cond: [{ $and: [{ $eq: ['$images.source', 'artofpkm'] }, { $eq: [{ $type: '$images.mention' }, 'string'] }, { $ne: ['$images.mention', NOTE] }] }, 1, 0] } },
                tpcAvecMention: { $sum: { $cond: [{ $and: [{ $in: ['$images.source', TPC] }, { $eq: [{ $type: '$images.mention' }, 'string'] }] }, 1, 0] } },
                autresMentions: { $sum: { $cond: [{ $and: [{ $not: [{ $in: ['$images.source', [...TPC, 'artofpkm']] }] }, { $eq: [{ $type: '$images.mention' }, 'string'] }] }, 1, 0] } }
            } }
        ]).toArray();
        const tpcSansMention = await C.countDocuments({ images: { $elemMatch: { source: { $in: TPC }, mention: { $exists: false } } } });
        const docsImages = await I.countDocuments({ source: 'artofpkm', mention: NOTE });
        const cartesNote = await C.countDocuments({ images: { $elemMatch: { source: 'artofpkm', mention: NOTE } } });
        return { cartesAMention: (e.cartes || []).length, cartesNote, note: e.note || 0, noteVariante: e.noteVariante || 0, artofpkmAutreMention: e.artofpkmAutreMention || 0, tpcAvecMention: e.tpcAvecMention || 0, tpcSansMention, autresMentions: e.autresMentions || 0, docsImages };
    };
    const avant = await compter();
    console.log(`cartes : ${total} documents · AVANT : ${JSON.stringify(avant)}`);
    if (avant.artofpkmAutreMention || avant.autresMentions) { console.error(`🔴 une mention INCONNUE (artofpkm autre que la note : ${avant.artofpkmAutreMention} ; autre source : ${avant.autresMentions}) : rien ne s'écrit, elle se regarde d'abord`); await fermer(); process.exit(1); }
    if (!ECRIRE) { console.log(`simulation : ${avant.note} entrées à renommer (+ ${avant.docsImages} documents images) — pour écrire, sous lot-additif.js : --ecrire --attendu=${avant.note}`); await fermer(); return; }
    if (avant.note !== ATTENDU) { console.error(`🔴 ${avant.note} entrées à renommer, ${ATTENDU} annoncées : rien ne s'écrit (relancer la simulation)`); await fermer(); process.exit(1); }

    const filtre = [{ 'e.source': 'artofpkm', 'e.mention': NOTE }];
    const r = await C.updateMany({ images: { $elemMatch: { source: 'artofpkm', mention: NOTE } } }, { $set: { 'images.$[e].noteVariante': NOTE }, $unset: { 'images.$[e].mention': '' } }, { arrayFilters: filtre });
    const ri = avant.docsImages ? await I.updateMany({ source: 'artofpkm', mention: NOTE }, { $set: { noteVariante: NOTE }, $unset: { mention: '' } }) : { modifiedCount: 0 };
    const apres = await compter();
    console.log(`ÉCRIT : ${r.modifiedCount} cartes modifiées (attendu ${avant.cartesNote}), ${ri.modifiedCount} documents images · APRÈS : ${JSON.stringify(apres)}`);
    // la relecture : plus aucune note sous `mention`, autant de `noteVariante` que d'entrées renommées (plus celles d'avant), les
    // mentions TPC intactes (le worker peut en AJOUTER pendant le lot, jamais en perdre)
    const ok = r.modifiedCount === avant.cartesNote && apres.note === 0 && apres.cartesNote === 0 && apres.noteVariante === avant.noteVariante + avant.note && apres.docsImages === 0 && apres.tpcAvecMention >= avant.tpcAvecMention && apres.tpcSansMention === 0 && apres.artofpkmAutreMention === 0;
    console.log(`${ok ? '✅' : '🔴'} relecture : ${ok ? 'conforme' : 'NON CONFORME'}`);
    await fermer();
    if (!ok) process.exit(1);
})().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
