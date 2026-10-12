// MESURE EN LECTURE SEULE : parmi les logos que la simulation dit « collectables », combien sont déjà posés (même sha256 → « deja », aucune écriture),
// combien sont NEUFS (champ absent → écrit), combien seraient REFUSÉS (un logoOfficiel différent est déjà là : rien n'est remplacé) — preuve « 0 logo déjà posé réécrit ».
//   node mesure-reecriture-logos-s3.js --rapport=<rapport-simulation.json> --cache=<dossier>
require('dotenv').config();
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const rapport = JSON.parse(fs.readFileSync(arg('rapport'), 'utf8')), cache = arg('cache');
const table = require('./collecte-cartes/logos-officiels-table.json');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const M = require('./collecter-logos-officiels');
const h = s => crypto.createHash('sha256').update(Buffer.from(s)).digest('hex');
(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const sets = new Map((await S.find({}, { projection: { tirage: 1, region: 1, nomJa: 1, code: 1 } }).toArray()).map(s => [s._id, s]));
    const coll = rapport.lignes.filter(r => r.action === 'collectable');
    const res = { collectables: coll.length, neufs: [], deja: [], refuses: [], doublonsDansLeLot: 0 };
    const vus = new Set();
    const tcgdexJa = (await cx.db.collection('tcgdex_sets').findOne({ _id: 'ja/__liste__' }))?.sets ?? null;
    for (const r of coll) {
        let l = table.lignes.find(x => x.fichier === r.fichier);
        if (l.verdict === 'À REGARDER') l = M.promouvoir(l, sets, { tcgdexJa }).ligne;
        const j = JSON.parse(fs.readFileSync(path.join(cache, h(l.urlChoisie)) + '.json', 'utf8'));
        const doc = await S.findOne({ _id: l.set }, { projection: { logoOfficiel: 1 } });
        const deja = doc?.logoOfficiel?.[l.cible];
        const cle = `${l.cible}:${l.set}`;
        if (vus.has(cle)) res.doublonsDansLeLot++; vus.add(cle);
        const ligne = `${l.cible} ${l.set} (${l.fichier})`;
        if (!deja) res.neufs.push(ligne);
        else if (deja.sha256 === j.sha256) res.deja.push(ligne);
        else res.refuses.push(`${ligne} : base ${deja.sha256.slice(0, 8)} lot ${deja.lot} ≠ candidat ${j.sha256.slice(0, 8)}`);
    }
    console.log(JSON.stringify({ collectables: res.collectables, neufs: res.neufs.length, deja: res.deja.length, refuses: res.refuses.length, doublonsDansLeLot: res.doublonsDansLeLot }));
    console.log('NEUFS :\n  ' + res.neufs.join('\n  '));
    if (res.refuses.length) console.log('REFUSÉS :\n  ' + res.refuses.join('\n  '));
    const poses = await S.countDocuments({ $or: [{ 'logoOfficiel.fr.lot': M.LOT }, { 'logoOfficiel.ja.lot': M.LOT }] });
    console.log(`sets qui portent déjà un logoOfficiel du lot : ${poses}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
