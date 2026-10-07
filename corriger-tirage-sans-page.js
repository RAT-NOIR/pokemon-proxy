// ============================================================
// CORRIGER LE TIRAGE D'UN SET SANS PAGE — le pendant de corriger-tirage.js pour les sets créés par creer-sets-sans-page.js (2026-10-07)
// ============================================================
//   node corriger-tirage-sans-page.js                                   (simulation : comptes, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="…" --collections=sets,cartes,cartes_produits --annonce=<annonce> -- node corriger-tirage-sans-page.js --ecrire
//
// 🔴 LE CAS (testeur, 2026-10-07 : « Sky Ruler : corrige sa région (indonésien et thaï), sous la garde ») : Sky Ruler (AS4, exp 6700),
// créé dans la nuit du 6 au 7 en `zh-hans` sur une preuve d'ASYMÉTRIE — fausse : l'asymétrie ne voit que les tirages déjà en base, et
// aucune carte SM n'y est imprimée en indonésien ou en thaï. La preuve vraie, zéro requête : TCGdex data-asia/SM/AS4a « Booster Pack
// Penguasa Langit » (id), et la page « Sky Ruler (ATCG) » (copie Wayback) : « exclusively available in Indonesian and Thai ».
// corriger-tirage.js ne sait corriger qu'un set qui a une LIGNE de table (`tirageCorrige`) ; un set sans page n'en a pas : la correction
// et sa preuve vivent ici, dans CORRECTIONS (une garde s'écrit par ce qu'elle autorise : un set absent de la table n'est jamais touché).
// 🔑 LE TIRAGE EST UNE CLÉ (le site apparie `imp.tirage === set.tirage ?? set.region`) : le set, les impressions des FICHES SIMPLES du set
// (posées par creer-sets-sans-page.js : `source: 'cardmarket'`, au nom d'expansion du set) et les lignes de jointure de l'expansion
// suivent dans le même lot. Une impression d'une PAGE de carte n'est jamais réécrite ; les réimpressions désignées (preuve
// `metacarte+nom+attaques`) gardent leur carte : seule leur ligne de jointure change de tirage.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const CORRECTIONS = [
    { set: 'Sky-Ruler', exp: 6700, de: 'zh-hans', vers: 'idth', preuve: 'TCGdex data-asia/SM/AS4a « Booster Pack Penguasa Langit » (id) ; page « Sky Ruler (ATCG) », copie Wayback : « exclusively available in Indonesian and Thai » — feu vert du testeur, 2026-10-07' }
];
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
const TIRAGES = new Set(['jp', 'intl', 'zh-hans', 'zh-hant', 'id', 'th', 'idth']);
const aCorriger = (i, p) => i && i.tirage === p.de && i.expansion === p.nom && i.source === 'cardmarket';

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), CP = cx.db.collection('cartes_produits'), S = cx.db.collection('sets');
    console.log(`\n════ DÉNOMINATEUR : ${CORRECTIONS.length} correction(s) dans la table ════`);
    const plan = [];
    for (const k of CORRECTIONS) {
        if (!TIRAGES.has(k.de) || !TIRAGES.has(k.vers) || k.de === k.vers || !k.preuve) throw new Error(`${k.set} : correction incohérente`);
        const s = await S.findOne({ _id: k.set }, { projection: { tirage: 1, region: 1, idExpansion: 1, 'bulba.expansion': 1, creeDepuis: 1 } });
        if (!s) { console.log(`   ✗ ${k.set} : set ABSENT`); continue; }
        const noms = [].concat(s.bulba?.expansion ?? []);
        if (noms.length !== 1) throw new Error(`${k.set} : ${noms.length} noms d'expansion — on ne devine pas lequel suit`);
        if (![].concat(s.idExpansion ?? []).includes(k.exp)) throw new Error(`${k.set} : l'expansion ${k.exp} n'est pas la sienne (${JSON.stringify(s.idExpansion)})`);
        if (!s.creeDepuis) throw new Error(`${k.set} : pas créé par creer-sets-sans-page.js (aucun creeDepuis) — corriger-tirage.js et sa ligne de table`);
        const nom = noms[0], p = { ...k, nom };
        const etat = s.tirage === k.vers ? 'déjà corrigé' : s.tirage !== k.de ? `set au tirage ${s.tirage} (ni ${k.de} ni ${k.vers}) : REFUSÉ` : s.region !== 'intl' ? `région ${s.region} : REFUSÉ` : 'à corriger';
        const cartes = await C.find({ sets: k.set, ficheSimple: { $exists: true }, impressions: { $elemMatch: { tirage: k.de, expansion: nom, source: 'cardmarket' } } }, { projection: { impressions: 1, sets: 1, nomEn: 1 } }).toArray();
        const nImp = cartes.reduce((n, c) => n + c.impressions.filter(i => aCorriger(i, p)).length, 0);
        const ailleurs = await C.countDocuments({ ficheSimple: { $exists: false }, impressions: { $elemMatch: { tirage: k.de, expansion: nom } } });
        const lignes = await CP.find({ idExpansion: k.exp, tirage: k.de }, { projection: { preuve: 1, slugSet: 1 } }).toArray();
        const horsSet = lignes.filter(l => l.slugSet !== k.set).length;
        if (horsSet) throw new Error(`${k.set} : ${horsSet} ligne(s) de l'expansion ${k.exp} rangées dans un AUTRE set — rien n'est touché`);
        const parPreuve = {}; for (const l of lignes) parPreuve[l.preuve] = (parPreuve[l.preuve] || 0) + 1;
        console.log(`   ${k.set.padEnd(14)} exp ${k.exp} « ${nom} » ${k.de} → ${k.vers} · set : ${etat} · fiches simples ${cartes.length} (impressions ${nImp}) · impressions de PAGE au même couple ${ailleurs} (non touchées) · lignes ${lignes.length} ${JSON.stringify(parPreuve)}`);
        if (etat === 'à corriger' || (etat === 'déjà corrigé' && (nImp || lignes.length))) plan.push({ ...p, id: k.set, nImp, nCp: lignes.length, cartes, corrigerSet: etat === 'à corriger' });
    }
    // l'annonce, par la fonction de la garde : l'état des cartes touchées avant, et tel qu'il sera après
    const avant = compterEtat({ cartes: plan.flatMap(p => p.cartes) });
    const apres = compterEtat({ cartes: plan.flatMap(p => p.cartes.map(c => ({ ...c, impressions: c.impressions.map(i => aCorriger(i, p) ? { ...i, tirage: p.vers } : i) }))) });
    const { baisses } = comparer(avant, apres);
    const annonce = Object.fromEntries(baisses.map(b => [b.cle, b.baisse]));
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `annonce-corriger-tirage-sans-page-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(annonce, null, 1));
    console.log(`\n   à écrire : ${plan.filter(p => p.corrigerSet).length} set(s) · ${plan.reduce((n, p) => n + p.nImp, 0)} impressions · ${plan.reduce((n, p) => n + p.nCp, 0)} lignes de jointure`);
    console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}\n   ${baisses.map(b => `${b.cle} −${b.baisse}`).join('\n   ')}`);
    if (!ecrire) { console.log('\n   (simulation — relancer par lot-additif.js --annonce=<ce fichier> … -- node corriger-tirage-sans-page.js --ecrire)'); await fermer(); return; }

    const le = new Date();
    let nS = 0, nI = 0, nL = 0;
    for (const p of plan) {
        if (p.corrigerSet) nS += (await S.updateOne({ _id: p.id, tirage: p.de }, { $set: { tirage: p.vers, tirageCorrige: { de: p.de, le, preuve: p.preuve } } })).modifiedCount;
        nI += (await C.updateMany({ sets: p.id, ficheSimple: { $exists: true }, impressions: { $elemMatch: { tirage: p.de, expansion: p.nom, source: 'cardmarket' } } },
            { $set: { 'impressions.$[i].tirage': p.vers } }, { arrayFilters: [{ 'i.tirage': p.de, 'i.expansion': p.nom, 'i.source': 'cardmarket' }] })).modifiedCount;
        nL += (await CP.updateMany({ idExpansion: p.exp, tirage: p.de }, { $set: { tirage: p.vers } })).modifiedCount;
    }
    let reste = 0;
    for (const p of plan) reste += await C.countDocuments({ sets: p.id, ficheSimple: { $exists: true }, impressions: { $elemMatch: { tirage: p.de, expansion: p.nom, source: 'cardmarket' } } }) + await CP.countDocuments({ idExpansion: p.exp, tirage: p.de }) + await S.countDocuments({ _id: p.id, tirage: p.de });
    console.log(`\n   ${reste ? '🔴' : '✅'} sets ${nS} · fiches simples modifiées ${nI} · lignes de jointure ${nL} · relu : ${reste} document(s) encore à l'ancien tirage`);
    console.log(`SETS : ${plan.map(p => p.id).join(',')}`);
    if (reste) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
