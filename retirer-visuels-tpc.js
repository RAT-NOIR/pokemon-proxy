// ============================================================
// RETIRER EN UN SEUL LOT LES VISUELS DES SOURCES OFFICIELLES TPC — la condition de leur ouverture (éditeur, 2026-10-07 soir)
// ============================================================
//   node retirer-visuels-tpc.js [--sites=tpc-asie,pokemon-card-com]          (simulation : comptes par set, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="retrait des visuels TPC" --collections=cartes,images --annonce=<annonce> -- node retirer-visuels-tpc.js --ecrire [--sites=…]
//
// 🔑 « Chaque image garde sa source, avec la mention « © Pokémon / The Pokémon Company », et doit pouvoir être retirée en un lot sur
// demande. » Ce fichier est ce lot. Il ne s'exécute QUE sur demande de l'éditeur (une suppression attend toujours son feu vert), et
// ce qu'il fait tient en trois gestes, dans cet ordre :
//   1. les entrées `cartes.images` dont la source est TPC sortent (planRetrait, collecte-cartes/tpc.js) — le site ne les sert plus ;
//   2. les documents `images` passent à l'état « retire » (avec la date et le motif) : ni le rejeu de la jointure ni une recollecte ne
//      les reprennent (le collecteur saute un document « retire ») ;
//   3. chaque site retiré porte l'alerte « source-bloquee » : l'alimentateur n'enfile plus rien, le collecteur ne demande plus rien.
// Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` les supprime aussi, et c'est alors définitif.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const T = require('./collecte-cartes/tpc');
const r2 = require('./collecte-cartes/r2');

const AUTORISES = [/^--ecrire$/, /^--effacer-r2$/, /^--sites=[a-z-]+(,[a-z-]+)*$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --effacer-r2, --sites=a,b`); process.exit(2); }
const ecrire = process.argv.includes('--ecrire');
const sites = process.argv.find(a => a.startsWith('--sites='))?.slice(8).split(',') ?? [...T.SOURCES_TPC];
const horsListe = sites.filter(s => !T.SOURCES_TPC.includes(s));
if (horsListe.length) { console.error(`❌ ${horsListe.join(', ')} : pas une source TPC (${T.SOURCES_TPC.join(', ')})`); process.exit(2); }
if (process.argv.includes('--effacer-r2') && !ecrire) { console.error('❌ --effacer-r2 sans --ecrire n\'a pas de sens'); process.exit(2); }

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const C = cx.db.collection('cartes'), I = cx.db.collection('images'), E = cx.db.collection('collecte_images_etat');
    // ce que compterEtat lit (garde-lot.js) : sets, nomEn, impressions, images
    const cartes = await C.find({ 'images.source': { $in: sites } }, { projection: { sets: 1, nomEn: 1, impressions: 1, images: 1 } }).toArray();
    const R = T.planRetrait(cartes.map(c => ({ ...c, images: (c.images || []).filter(e => !T.SOURCES_TPC.includes(e.source) || sites.includes(e.source)) })));
    const docs = await I.countDocuments({ source: { $in: sites }, etat: { $ne: 'retire' } });
    const parSet = {};
    for (const c of cartes) for (const e of c.images || []) if (sites.includes(e.source)) parSet[`${e.source} ${e.set}`] = (parSet[`${e.source} ${e.set}`] || 0) + 1;
    console.log(`\n════ DÉNOMINATEUR : sites ${sites.join(', ')} · ${R.cartes.length} cartes portent ${R.entrees} entrées · ${docs} documents « images » non retirés ════`);
    for (const [k, n] of Object.entries(parSet).sort((a, b) => b[1] - a[1])) console.log(`   ${k.padEnd(60)} ${n}`);
    // l'annonce, par la fonction de la garde : ce qui baisse, groupe par groupe
    const avant = compterEtat({ cartes });
    const apres = compterEtat({ cartes: cartes.map(c => ({ ...c, images: (c.images || []).filter(e => !sites.includes(e.source)) })) });
    const { baisses } = comparer(avant, apres);
    const fichier = path.join(__dirname, 'collecte-cartes', 'rapports', `annonce-retirer-visuels-tpc-${new Date().toISOString().slice(0, 10)}.json`);
    fs.mkdirSync(path.dirname(fichier), { recursive: true });
    fs.writeFileSync(fichier, JSON.stringify(Object.fromEntries(baisses.map(b => [b.cle, b.baisse])), null, 1));
    console.log(`   annonce des baisses (${baisses.length} groupes) → ${fichier}`);
    if (!ecrire) { console.log('\n   (simulation — le retrait ne part que sur demande de l\'éditeur : lot-additif.js --annonce=<ce fichier> … -- node retirer-visuels-tpc.js --ecrire)'); await fermer(); return; }

    const le = new Date(), motif = 'retrait en un lot des visuels des sources officielles TPC, sur demande de l\'éditeur';
    const nC = (await C.updateMany({ 'images.source': { $in: sites } }, { $pull: { images: { source: { $in: sites } } } })).modifiedCount;
    const nI = (await I.updateMany({ source: { $in: sites }, etat: { $ne: 'retire' } }, { $set: { etat: 'retire', retireLe: le, retireMotif: motif } })).modifiedCount;
    for (const s of sites) await E.updateOne({ _id: T.idAlerteBloquee(s) }, { $set: { active: true, constateLe: le, motif, retrait: true }, $setOnInsert: { depuis: le } }, { upsert: true });
    let nR = 0;
    if (process.argv.includes('--effacer-r2')) { for (let i = 0; i < R.cles.length; i += 500) { await r2.supprimer(process.env.R2_BUCKET_IMAGES, R.cles.slice(i, i + 500)); nR += Math.min(500, R.cles.length - i); } }
    const reste = await C.countDocuments({ 'images.source': { $in: sites } });
    console.log(`\n   ${reste ? '🔴' : '✅'} cartes modifiées ${nC} · documents retirés ${nI} · objets R2 effacés ${nR} · sites fermés ${sites.join(', ')} · relu : ${reste} carte(s) portent encore une entrée TPC`);
    console.log(`SETS : ${[...new Set(Object.keys(parSet).map(k => k.split(' ')[1]))].join(',')}`);
    if (reste) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
