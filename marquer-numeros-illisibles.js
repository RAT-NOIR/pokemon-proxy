// ============================================================
// MARQUER LES VISUELS DONT LE NUMÉRO N'A PAS PU ÊTRE LU — règle R4 (décision du testeur, 2026-10-05 : « garde les 1 539 visuels
// qui portent leur numéro, marque les 192 illisibles sans rien retirer »)
// ============================================================
//   node marquer-numeros-illisibles.js --liste=<r4-illisibles.json>                                                  (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=images -- node marquer-numeros-illisibles.js --liste=<…> --ecrire
// La liste vient du labo (pokemon-proxy-labo/rm/regles-a-valider.js : OCR local des deux bandes du bas, sans requête payante) :
// [{ cle, regle: 'R4a'|'R4b', lus: [bande 1, bande 2], lu, accord }]. R4a : la carte a des produits dans ce set ; R4b : aucun.
// ÉCRITURE ADDITIVE, sur `images` seulement : controleNumero = { etat: 'illisible', regle, lus, le, source }. Rien n'est retiré, rien
// n'est servi autrement (ni le site ni la jointure ne lisent ce champ) : la liste de travail vit en base au lieu d'un fichier du labo.
// LA GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE : chaque clé désigne exactement UN document `images` qui ne porte pas encore de
// `controleNumero` ; une seule clé hors de ce cas, et rien n'est écrit.
require('dotenv').config();
const AUTORISES = [/^--liste=.+\.json$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --liste=<fichier.json> [--ecrire]`); process.exit(2); }
const LISTE = process.argv.find(a => a.startsWith('--liste='))?.slice(8);
if (!LISTE) { console.error('❌ --liste requis'); process.exit(2); }
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');

(async () => {
    const liste = JSON.parse(fs.readFileSync(LISTE, 'utf8'));
    const regles = new Set(['R4a', 'R4b']);
    if (!Array.isArray(liste) || !liste.length || liste.some(x => !x.cle || !regles.has(x.regle))) {
        console.error('❌ liste vide ou mal formée (attendu : [{ cle, regle: R4a|R4b, lus }])'); process.exit(1);
    }
    if (new Set(liste.map(x => x.cle)).size !== liste.length) { console.error('❌ une clé apparaît deux fois dans la liste'); process.exit(1); }
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const I = cx.db.collection('images');
    const docs = await I.find({ cleR2: { $in: liste.map(x => x.cle) } }, { projection: { cleR2: 1, etat: 1, set: 1, controleNumero: 1 } }).toArray();
    const parCle = new Map();
    for (const d of docs) parCle.set(d.cleR2, [...(parCle.get(d.cleR2) || []), d]);
    const refus = liste.filter(x => (parCle.get(x.cle) || []).length !== 1 || parCle.get(x.cle)[0].controleNumero);
    const etats = {}; for (const d of docs) etats[d.etat ?? '—'] = (etats[d.etat ?? '—'] ?? 0) + 1;
    console.log(`DÉNOMINATEUR : ${liste.length} clés dans la liste (${liste.filter(x => x.regle === 'R4a').length} R4a, ${liste.filter(x => x.regle === 'R4b').length} R4b) · ${docs.length} documents images trouvés · états ${JSON.stringify(etats)}`);
    if (refus.length) {
        for (const x of refus.slice(0, 10)) console.error(`   ❌ ${x.cle} : ${(parCle.get(x.cle) || []).length} document(s)${parCle.get(x.cle)?.[0]?.controleNumero ? ', controleNumero déjà posé' : ''}`);
        console.error(`❌ ${refus.length} clé(s) hors garde (pas exactement un document, ou déjà marquée) : rien n'est écrit`); await fermer(); process.exit(1);
    }
    if (!process.argv.includes('--ecrire')) { console.log('(plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    const le = new Date();
    const r = await I.bulkWrite(liste.map(x => ({ updateOne: {
        filter: { _id: parCle.get(x.cle)[0]._id, cleR2: x.cle, controleNumero: { $exists: false } },
        update: { $set: { controleNumero: { etat: 'illisible', regle: x.regle, lus: Array.isArray(x.lus) ? x.lus : [], le, source: 'ocr-local (rm/regles-a-valider.js)' } } }
    } })));
    const relus = await I.countDocuments({ cleR2: { $in: liste.map(x => x.cle) }, 'controleNumero.etat': 'illisible' });
    console.log(`${r.modifiedCount === liste.length && relus === liste.length ? '✅' : '🔴'} marqués ${r.modifiedCount}/${liste.length} · RELU : ${relus} document(s) images portent controleNumero.etat = « illisible »`);
    if (r.modifiedCount !== liste.length || relus !== liste.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
