// ============================================================
// RESTAURER les logos composés écrits le 2026-10-07 — décision du testeur : « STOP sur la composition des logos : c'est désormais le SITE qui
// compose ; si tu as déjà écrit quelque chose, restaure l'état d'avant depuis ta sauvegarde, sous la garde, et revalide les sets touchés »
// ============================================================
//   node restaurer-logos-composes-2026-10-07.js                       (plan : ce qui est en base, ce qui sera remis)
//   node lot-additif.js --quoi="…" --collections=sets -- node restaurer-logos-composes-2026-10-07.js --attendu=22 --ecrire
//
// CE QUI A ÉTÉ ÉCRIT, ET SA SAUVEGARDE (JOURNAL-LOTS.md) :
//   · 09:43 UTC — 15 sets, `logoCompose` REMPLACÉ (l'ancien sous `logoComposeRemplace`) : sauvegarde backup-2026-10-07-lot-094314 ;
//   · 10:17 UTC — 7 sets, `logoCompose` POSÉ là où il n'y en avait pas, puis sa vignette (10:17:44) : sauvegarde backup-2026-10-07-lot-101710.
// LA RESTAURATION, CHAMP PAR CHAMP (jamais le document entier : des dates ont été posées depuis sur certains de ces sets, à 10:10 et 10:15) :
// `logoCompose` reprend la valeur de la sauvegarde (ou disparaît si elle n'y était pas), `logoComposeRemplace` disparaît. Le filtre exige que
// `logoCompose.sha1` soit encore celui écrit aujourd'hui : un set touché par quelqu'un d'autre depuis n'est pas restauré, il est listé.
// Les fichiers PNG et vignettes déposés sur R2 restent (orphelins, aucun lecteur) : les supprimer serait une suppression, non demandée.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { EJSON } = require('bson');
const AUTORISES = [/^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire'), ATTENDU = Number(process.argv.find(a => a.startsWith('--attendu='))?.slice(10) ?? NaN);
if (ECRIRE && !Number.isFinite(ATTENDU)) { console.error('❌ --ecrire exige --attendu=<n>'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');

const LOTS = [
    { sauvegarde: 'backup-2026-10-07-lot-094314', sets: ['Dialga-DPt-Half-Deck', 'Giratina-DPt-Half-Deck', 'Palkia-DPt-Half-Deck', 'Chimchar-DPt-Half-Deck', 'Pikachu-DPt-Half-Deck', 'Piplup-DPt-Half-Deck',
        'Turtwig-DPt-Half-Deck', 'Gift-Box-Latias-ex', 'Gift-Box-Latios-ex', 'Intro-Pack-Bulbasaur', 'Intro-Pack-Squirtle', 'Charizard-SP-Half-Deck', 'Garchomp-SP-Half-Deck', 'Gallade-SP-Half-Deck', 'Infernape-SP-Half-Deck'] },
    { sauvegarde: 'backup-2026-10-07-lot-101710', sets: ['30th-Celebration-Additionals', 'Black-Sparkle', 'McDonalds-Collection-2019-2', 'My-First-Battle', 'P-Promos', 'PLAY-Promos', 'PPP-Promos'] }
];

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const plan = [];
    for (const lot of LOTS) {
        const docs = EJSON.parse(fs.readFileSync(path.join(__dirname, lot.sauvegarde, 'sets.json'), 'utf8'), { relaxed: false });
        if (!Array.isArray(docs) || docs.length < 500) throw new Error(`${lot.sauvegarde}/sets.json : ${docs?.length} documents — sauvegarde illisible`);
        const avant = new Map(docs.map(d => [d._id, d]));
        for (const id of lot.sets) {
            const b = avant.get(id), a = await S.findOne({ _id: id }, { projection: { logoCompose: 1, logoComposeRemplace: 1 } });
            if (!b) { plan.push({ id, refus: `absent de ${lot.sauvegarde}` }); continue; }
            if (!a?.logoCompose?.sha1) { plan.push({ id, refus: 'aucun logoCompose en base : rien à restaurer' }); continue; }
            if (b.logoCompose?.sha1 === a.logoCompose.sha1) { plan.push({ id, refus: 'déjà dans l\'état de la sauvegarde' }); continue; }
            plan.push({ id, sauvegarde: lot.sauvegarde, sha1Aujourdhui: a.logoCompose.sha1, avant: b.logoCompose ?? null, remplace: !!a.logoComposeRemplace });
        }
    }
    const ok = plan.filter(p => !p.refus);
    for (const p of plan) console.log(p.refus ? `   ✗ ${p.id} : ${p.refus}` : `   ${p.id} : logoCompose ${p.sha1Aujourdhui.slice(0, 10)} (aujourd'hui) → ${p.avant ? `${p.avant.sha1?.slice(0, 10)} « ${p.avant.elements?.etiquette ?? ''} » (${p.sauvegarde})` : 'AUCUN (absent de la sauvegarde)'}${p.remplace ? ' · logoComposeRemplace retiré' : ''}`);
    console.log(`DÉNOMINATEUR : ${plan.length} sets écrits aujourd'hui · à restaurer ${ok.length} · refusés ${plan.length - ok.length}`);
    if (!ECRIRE) { console.log('(plan seul — --attendu=<n> --ecrire sous lot-additif.js)'); await fermer(); return; }
    if (ok.length !== ATTENDU) { console.error(`❌ ARRÊT : ${ok.length} à restaurer, attendu ${ATTENDU}`); await fermer(); process.exit(1); }
    let n = 0;
    for (const p of ok) {
        const maj = p.avant ? { $set: { logoCompose: p.avant }, $unset: { logoComposeRemplace: 1 } } : { $unset: { logoCompose: 1, logoComposeRemplace: 1 } };
        const r = await S.updateOne({ _id: p.id, 'logoCompose.sha1': p.sha1Aujourdhui }, maj);
        if (r.modifiedCount === 1) n++; else console.log(`   ⚠️ ${p.id} : non restauré — le logoCompose a changé depuis le plan`);
    }
    const relus = await S.find({ _id: { $in: ok.map(p => p.id) } }, { projection: { logoCompose: 1, logoComposeRemplace: 1 } }).toArray();
    const conformes = relus.filter(d => { const p = ok.find(x => x.id === d._id); return !d.logoComposeRemplace && (p.avant ? d.logoCompose?.sha1 === p.avant.sha1 : !d.logoCompose); }).length;
    console.log(`${n === ok.length && conformes === ok.length ? '✅' : '🔴'} restaurés ${n} / ${ok.length} · RELU conformes à la sauvegarde ${conformes} / ${ok.length}`);
    console.log(`SETS : ${ok.map(p => p.id).join(',')}`);
    if (n !== ok.length || conformes !== ok.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
