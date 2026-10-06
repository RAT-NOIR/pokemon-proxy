// ============================================================
// UNE EXPANSION PROPRE POUR CHAQUE BATTLE ACADEMY (feu vert du testeur, 2026-10-06 : « une expansion propre pour chaque Battle Academy »)
// ============================================================
//   node poser-expansion-battle-academy.js            (simulation : ce qui serait écrit, et les refus)
//   node lot-additif.js --quoi="expansion propre des Battle Academy" --collections=sets -- node poser-expansion-battle-academy.js --ecrire
//
// POURQUOI : Battle Academy 2020, 2022 et 2024 réimpriment des cartes d'autres sets dans trois decks ; leurs sets sont nés le 2026-09-26
// par creer-sets-reimpressions.js avec `bulba.expansion: null` — une expansion DÉCLARÉE par la carte y aurait fait naître les fiches du
// tirage d'origine. Sans nom d'expansion, le site ne peut pas y rapprocher une impression : un document y reçoit UNE fiche sans numéro,
// qui mélange ses produits (C42 Potion et C17 Potion), et poser-impressions-par-numero.js les refuse à raison (une impression à
// expansion nulle s'afficherait dans tout set sans nom — 118 écrites le 2026-10-06 à 06:47 UTC, retirées à 07:14).
// LE NOM : celui de la ligne de table de chaque set (table-sets-auto.json : « Battle Academy 2020/2022/2024 », pages « … (TCG) ») — une
// collecte future du set écrirait le même. 🔑 IL NE FAIT NAÎTRE AUCUNE FICHE D'ORIGINE PAR CONSTRUCTION : aucune page de carte ne déclare
// ce tirage (0 impression « Battle Academy » occidentale sur 15 550 cartes, §65) — et l'outil le RELIT avant d'écrire : une seule carte
// portant déjà une impression à ce nom, ou un autre set déjà nommé ainsi, et rien n'est écrit.
// CE QUI EST ÉCRIT, ET SEULEMENT ÇA : `sets.<slug>.bulba.expansion`, là où il est NUL (jamais une valeur remplacée).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const TABLE_AUTO = require('./collecte-cartes/table-sets-auto.json');

const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire');
const SLUGS = ['Battle-Academy-2020', 'Battle-Academy-2022', 'Battle-Academy-2024'];

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ buckets: [] });
    const db = cx.db;
    const lignes = (Array.isArray(TABLE_AUTO) ? TABLE_AUTO : TABLE_AUTO.lignes || []).filter(l => SLUGS.includes(l.slugSet));
    console.log(`\n════ DÉNOMINATEUR : ${SLUGS.length} sets Battle Academy occidentaux · ${lignes.length} lignes de table-sets-auto.json à leur slug ════`);
    const plan = [], refus = [];
    for (const slug of SLUGS) {
        const s = await db.collection('sets').findOne({ _id: slug }, { projection: { bulba: 1, tirage: 1, region: 1, nomAffichage: 1 } });
        const l = lignes.filter(x => x.slugSet === slug);
        const nom = l.length === 1 ? l[0].bulba?.expansion : null;
        if (!s) { refus.push(`${slug} : set absent`); continue; }
        if (s.bulba?.expansion != null) { refus.push(`${slug} : bulba.expansion déjà posé (« ${s.bulba.expansion} ») — jamais remplacé`); continue; }
        if (typeof nom !== 'string' || !/^Battle Academy 20\d\d$/.test(nom)) { refus.push(`${slug} : ${l.length} ligne(s) de table, nom « ${nom} » — pas de la forme attendue`); continue; }
        // les deux témoins qui disent « ce nom ne fait rien naître d'autre » : relus, jamais supposés
        const cartesAuNom = await db.collection('cartes').countDocuments({ 'impressions.expansion': nom });
        const setsAuNom = await db.collection('sets').find({ 'bulba.expansion': nom }, { projection: { _id: 1 } }).toArray();
        if (cartesAuNom) { refus.push(`${slug} : ${cartesAuNom} carte(s) portent déjà une impression « ${nom} »`); continue; }
        if (setsAuNom.length) { refus.push(`${slug} : « ${nom} » est déjà l'expansion de ${setsAuNom.map(x => x._id).join(', ')}`); continue; }
        plan.push({ slug, nom, tirage: s.tirage ?? s.region });
    }
    for (const p of plan) console.log(`   ✅ ${p.slug} (${p.tirage}) : bulba.expansion null → « ${p.nom} » · 0 carte ni set ne porte déjà ce nom`);
    for (const r of refus) console.log(`   🔴 ${r}`);
    if (refus.length) { console.error(`🔴 ARRÊT : ${refus.length} refus — rien n'est écrit (les trois ensemble ou aucun)`); await fermer(); process.exit(1); }
    if (!ECRIRE) { console.log('\n   (simulation — lot-additif.js … -- node poser-expansion-battle-academy.js --ecrire)'); await fermer(); return; }
    let n = 0;
    for (const p of plan) n += (await db.collection('sets').updateOne({ _id: p.slug, 'bulba.expansion': null }, { $set: { 'bulba.expansion': p.nom, 'bulba.expansionSource': 'poser-expansion-battle-academy (2026-10-07) : nom de la ligne de table-sets-auto.json' } })).modifiedCount;
    const relus = await db.collection('sets').find({ _id: { $in: plan.map(p => p.slug) } }, { projection: { 'bulba.expansion': 1 } }).toArray();
    const justes = relus.filter(s => plan.find(p => p.slug === s._id)?.nom === s.bulba?.expansion).length;
    console.log(`\n   ✅ sets écrits : ${n}/${plan.length} · relus au bon nom : ${justes}/${plan.length}`);
    await fermer();
    process.exit(n === plan.length && justes === plan.length ? 0 : 1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
