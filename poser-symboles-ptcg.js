// ============================================================
// LES SYMBOLES ptcg-assets DANS `sets.symbole` — le champ que le site AFFICHE (décision du testeur, 2026-09-28 : « symboles (188) :
// écris-les dans un champ symbole du set »)
// ============================================================
//   node poser-symboles-ptcg.js            (plan : ce qui serait posé, rien d'écrit)
//   node poser-symboles-ptcg.js --ecrire   (sous lot-additif.js)
// Les 188 symboles du dépôt 1niceroli/ptcg-assets vivent depuis le 2026-09-27 dans `symbolesIdentification` (poser-ptcg-assets.js : lus à
// l'œil sur planches, exclusions écrites là-bas). Ce qui s'écrit ici, et rien d'autre — écriture ADDITIVE :
//   · `symbole` d'un set QUI N'EN A PAS : une copie de son entrée `ptcg-assets` (même objet R2, même source, même commit du dépôt) ;
//   · un set qui porte déjà un `symbole` (Bulbapedia, par la convention de l'infobox — collecter-symboles-sets.js) le GARDE : remplacer
//     serait une modification, listée ici, jamais faite.
// Le site lit `sets.symbole.cleR2` comme une image de carte : `${R2_IMAGES_BASE_URL}/${cleR2}` (CONTRAT-SITE.md).
require('dotenv').config();
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
const { ouvrirConnexions } = require('./collecte-cartes/garde');

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const total = await S.countDocuments({});
    const sets = await S.find({ 'symbolesIdentification.source': 'ptcg-assets' }, { projection: { code: 1, tirage: 1, region: 1, symbole: 1, symbolesIdentification: 1 } }).toArray();
    if (!total || !sets.length) { console.error(`❌ ${total} sets en base, ${sets.length} avec un symbole ptcg-assets : rien à lire (base ou champ faux ?)`); await fermer(); process.exit(1); }
    const aPoser = [], gardes = [];
    for (const s of sets) {
        const e = s.symbolesIdentification.find(x => x.source === 'ptcg-assets');
        if (!e?.cleR2) continue;
        if (s.symbole?.cleR2) gardes.push({ slug: s._id, actuel: s.symbole.source, ptcg: e.fichier });
        else aPoser.push({ slug: s._id, tirage: s.tirage ?? s.region, e });
    }
    const parTirage = {}; for (const p of aPoser) parTirage[p.tirage] = (parTirage[p.tirage] || 0) + 1;
    console.log(`DÉNOMINATEUR : ${total} sets · ${sets.length} portent un symbole ptcg-assets · ${await S.countDocuments({ 'symbole.cleR2': { $type: 'string' } })} portent déjà un symbole affiché`);
    console.log(`PLAN : ${aPoser.length} à poser (${Object.entries(parTirage).map(([t, n]) => `${t} ${n}`).join(', ')}) · ${gardes.length} gardent leur symbole actuel (${[...new Set(gardes.map(g => g.actuel))].join(', ')})`);
    for (const p of aPoser) console.log(`   + ${p.slug.padEnd(44)} ← ${p.e.fichier} (${p.e.w}×${p.e.h})`);
    if (!ecrire) { console.log('   (plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    let ecrits = 0;
    for (const p of aPoser) {
        const valeur = { cleR2: p.e.cleR2, w: p.e.w, h: p.e.h, octets: p.e.octets, sha1: p.e.sha1, fichier: p.e.fichier, source: 'ptcg-assets', depot: p.e.depot, commit: p.e.commit,
            preuve: `copie de symbolesIdentification (${p.e.preuve}) ; le set n'avait pas de symbole affiché`, le: new Date() };
        // la condition du plan, relue dans la requête : un symbole apparu entre-temps n'est pas écrasé
        const u = await S.updateOne({ _id: p.slug, 'symbole.cleR2': { $exists: false } }, { $set: { symbole: valeur } });
        if (u.modifiedCount === 1) ecrits++; else console.log(`   ⚠️ ${p.slug} : non écrit — un symbole est apparu depuis le plan`);
    }
    const relus = await S.countDocuments({ 'symbole.source': 'ptcg-assets' });
    console.log(`\n${ecrits === aPoser.length ? '✅' : '🔴'} écrits ${ecrits} / ${aPoser.length} · RELU : ${relus} sets à symbole ptcg-assets · ${await S.countDocuments({ 'symbole.cleR2': { $type: 'string' } })} sets à symbole affiché`);
    if (ecrits !== aPoser.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
