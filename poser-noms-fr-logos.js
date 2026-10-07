// ============================================================
// LE NOM FRANÇAIS LU SUR LE LOGO FRANÇAIS OFFICIEL — la règle du testeur (2026-10-07, soir) : « un nom français n'est posé que s'il
// figure sur un produit imprimé en français ; sinon, on garde l'anglais »
// ============================================================
//   node poser-noms-fr-logos.js                                  (plan : chaque lecture confrontée à la base)
//   node lot-additif.js --quoi="…" --collections=sets -- node poser-noms-fr-logos.js --attendu=<n> --ecrire
//
// La preuve : le logo français du set (`sets.logoFr`), déposé par le testeur depuis un site officiel (« Logo FR/ »), REGARDÉ — le nom
// est imprimé dessus, c'est celui du produit. La lecture vaut pour CE fichier : son sha1 doit être celui de `sets.logoFr` en base, sinon
// rien. Les sources de nom (TCGdex, Bulbapedia) sont citées en témoins ; là où elles divergeaient, le logo tranche.
// ADDITIF : un set qui porte déjà un nomFr ou un nomFrAbsent n'est jamais touché.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const AUTORISES = [/^--attendu=\d+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire'), ATTENDU = Number(process.argv.find(a => a.startsWith('--attendu='))?.slice(10) ?? NaN);
if (ECRIRE && !Number.isFinite(ATTENDU)) { console.error('❌ --ecrire exige --attendu=<n>'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');

// LU À L'ŒIL le 2026-10-07 (soir), un logo par set
const LECTURES = [
    { set: 'Triumphant', nomFr: 'Triomphe', fichier: 'Logo FR/HearthGold et Soulsilver/Triomphe.png', lu: '« HS TRIOMPHE »', temoins: 'TCGdex « Triomphant » ; Bulbapedia « Triomphe » (divergentes le 2026-09-21 : le logo tranche)' },
    { set: 'Great-Encounters', nomFr: 'Duels au Sommet', fichier: 'Logo FR/Diamant_et_perle/Duels_au_sommet.png', lu: '« DIAMANT & PERLE — DUELS AU SOMMET »', temoins: 'TCGdex « Duels au Sommets » ; Bulbapedia « Duels au Sommet »' },
    { set: 'Expedition-Base-Set', nomFr: 'Expedition Édition de Base', fichier: 'Logo FR/Wizzard/Expedition.png', lu: '« EXPEDITION — ÉDITION DE BASE »', temoins: 'TCGdex « Expedition » ; Bulbapedia « Expedition Édition de Base »' },
    { set: 'White-Flare', nomFr: 'Flamme Blanche', fichier: 'Logo FR/Ecarlate et Violet/Flamme_Blanche.png', lu: '« ÉCARLATE ET VIOLET — FLAMME BLANCHE »', temoins: 'TCGdex « Flamme Blanche » ; page Bulbapedia commune avec Black Bolt (« Foudre Noire », « Flamme Blanche »)' }
];

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const plan = [];
    for (const l of LECTURES) {
        const s = await S.findOne({ _id: l.set }, { projection: { nomFr: 1, nomFrAbsent: 1, logoFr: 1, region: 1, tirage: 1 } });
        if (!s) { console.log(`   ✗ ${l.set} : set absent`); continue; }
        if (s.nomFr || s.nomFrAbsent) { console.log(`   ✗ ${l.set} : déjà un nomFr ou un nomFrAbsent`); continue; }
        if ((s.tirage ?? s.region) !== 'intl') { console.log(`   ✗ ${l.set} : tirage ${s.tirage ?? s.region}`); continue; }
        const sha1 = crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, l.fichier))).digest('hex');
        if (!s.logoFr?.sha1 || s.logoFr.sha1 !== sha1) { console.log(`   ✗ ${l.set} : le fichier lu (${sha1.slice(0, 10)}) n'est pas le logoFr en base (${s.logoFr?.sha1?.slice(0, 10) ?? '—'})`); continue; }
        plan.push({ ...l, sha1, preuve: `nom imprimé sur le logo français officiel du produit (${l.fichier}, sha1 ${sha1.slice(0, 12)}, déposé par le testeur depuis un site officiel), lu à l'œil le 2026-10-07 : ${l.lu} ; témoins : ${l.temoins}` });
        console.log(`   ✓ ${l.set.padEnd(22)} → « ${l.nomFr} » · ${l.lu}`);
    }
    console.log(`DÉNOMINATEUR : ${LECTURES.length} lectures · à poser ${plan.length}`);
    if (!ECRIRE) { console.log('(plan seul — --attendu=<n> --ecrire sous lot-additif.js)'); await fermer(); return; }
    if (plan.length !== ATTENDU) { console.error(`❌ ARRÊT : ${plan.length} à poser, attendu ${ATTENDU}`); await fermer(); process.exit(1); }
    const le = new Date(); let n = 0;
    for (const p of plan) n += (await S.updateOne({ _id: p.set, nomFr: { $in: [null] }, nomFrAbsent: { $exists: false } }, { $set: { nomFr: p.nomFr, nomFrSource: 'logo-officiel', nomFrPreuve: p.preuve, nomFrPoseLe: le } })).modifiedCount;
    console.log(`${n === plan.length ? '✅' : '🔴'} écrits ${n} / ${plan.length}`);
    console.log(`SETS : ${plan.map(p => p.set).join(',')}`);
    if (n !== plan.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
