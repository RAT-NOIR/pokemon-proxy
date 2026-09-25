// ============================================================
// RENOMMER L'IDENTITÉ D'UN SET — `sets._id`, et tout ce qui la porte, en un geste qui se relit
// ============================================================
//   node renommer-set.js --de=AQ --vers=Aquapolis --annonce=<fichier.json>    (simulation : compte, écrit l'annonce)
//   node lot-additif.js --quoi="…" --collections=restes,collecte_etat --annonce=<fichier.json> -- node renommer-set.js --de=AQ --vers=Aquapolis --ecrire
//
// FEU VERT DU TESTEUR (2026-09-25, soir) : « Aquapolis : renomme AQ en Aquapolis ». Le set vivait sous `_id: 'AQ'` parce que sa
// ligne « sans page » a été écrite quand aucun produit Cardmarket ne portait de slugSet (collecteur-texte.js : identité =
// `slugSet || code`) ; depuis l'apprentissage du 24/09, ses 190 lignes de jointure portent `slugSet: 'Aquapolis'`, et le site
// cherchait le set sous ce nom — « set absent de la base » dans la table maîtresse, 190 produits.
// L'identité d'un set vit à CINQ endroits (collecteur-texte.js:77) : `sets._id`, `collecte_etat._id`, `cartes.sets`,
// `restes.set`, et le verrou ; le worker y ajoute `cartes.images[].set`, `images.set`, `file_images`, `collecte_images_etat`.
// La ligne de commande s'écrit par ce qu'elle autorise (§54) ; l'outil REFUSE : si `vers` existe déjà, si le worker tient une
// référence à `de` (ses collections ne se renomment pas sous lui), et si une seule référence à `de` survit à l'écriture.
// ⚠️ La ligne de table doit porter `slugSet: vers` dans le même commit, sinon la collecte suivante refait naître `de`.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');

const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/, /^--de=[A-Za-z0-9.\/-]+$/, /^--vers=[A-Za-z0-9.-]+$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const val = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ecrire = process.argv.includes('--ecrire'), annonce = val('annonce'), DE = val('de'), VERS = val('vers');
if (inconnus.length || ecrire === !!annonce || !DE || !VERS || DE === VERS) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --de=<_id> --vers=<_id> ( --annonce=<fichier.json> | --ecrire )`); process.exit(2); }

const echapper = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
async function references(db, s) {
    const re = new RegExp(`(^|/)${echapper(s)}$`);
    return {
        sets: await db.collection('sets').countDocuments({ _id: s }),
        collecte_etat: await db.collection('collecte_etat').countDocuments({ _id: s }),
        'cartes.sets': await db.collection('cartes').countDocuments({ sets: s }),
        'cartes.images': await db.collection('cartes').countDocuments({ 'images.set': s }),
        restes: await db.collection('restes').countDocuments({ set: s }),
        'cartes_produits.slugSet': await db.collection('cartes_produits').countDocuments({ slugSet: s }),
        // tenues par le worker : jamais renommées ici
        images: await db.collection('images').countDocuments({ set: s }),
        file_images: await db.collection('file_images').countDocuments({ $or: [{ _id: re }, { set: s }] }),
        collecte_images_etat: await db.collection('collecte_images_etat').countDocuments({ _id: re })
    };
}
const DU_WORKER = ['cartes.images', 'images', 'file_images', 'collecte_images_etat'];

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const db = cx.db;
    const [rDe, rVers] = [await references(db, DE), await references(db, VERS)];
    console.log(`\n════ renommer « ${DE} » → « ${VERS} » ════\n   références à ${DE} : ${JSON.stringify(rDe)}\n   références à ${VERS} : ${JSON.stringify(rVers)}`);
    const refus = [];
    if (!rDe.sets) refus.push(`aucun set « ${DE} »`);
    if (rVers.sets || rVers.collecte_etat) refus.push(`« ${VERS} » existe déjà (sets ${rVers.sets}, collecte_etat ${rVers.collecte_etat}) : un renommage n'écrase rien`);
    const worker = DU_WORKER.filter(k => rDe[k]);
    if (worker.length) refus.push(`le worker tient des références à « ${DE} » (${worker.map(k => `${k} ${rDe[k]}`).join(', ')}) : elles ne se renomment pas sous lui`);
    if (refus.length) { console.error(`🔴 REFUSÉ — rien n'est écrit :\n   ${refus.join('\n   ')}`); await fermer(); process.exitCode = 1; return; }

    // L'annonce : compterEtat, la fonction de la garde, sur le set et les cartes avant et après le renommage simulé.
    const setDoc = await db.collection('sets').findOne({ _id: DE });
    const cartes = await db.collection('cartes').find({ sets: DE }).project({ sets: 1, nomEn: 1 }).toArray();
    const renomme = s => s === DE ? VERS : s;
    const cmp = comparer(compterEtat({ sets: [setDoc], cartes }), compterEtat({ sets: [{ ...setDoc, _id: VERS }], cartes: cartes.map(c => ({ ...c, sets: c.sets.map(renomme) })) }));
    const baisses = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    console.log(`   baisses que la garde verra : ${Object.entries(baisses).map(([k, v]) => `${k} −${v}`).join(' ; ') || 'aucune'} · hausses ${JSON.stringify(cmp.hausses)}`);
    if (!ecrire) {
        fs.writeFileSync(path.resolve(annonce), JSON.stringify(baisses, null, 1));
        console.log(`   annonce écrite : ${annonce}\n   (simulation — rien n'est écrit en base)`);
        await fermer(); return;
    }
    const le = new Date();
    await db.collection('sets').insertOne({ ...setDoc, _id: VERS, renommeDe: DE, renommeLe: le, renommePourquoi: 'feu vert du testeur 2026-09-25 : l\'identité du set est son slug Cardmarket, porté par ses lignes de jointure' });
    await db.collection('sets').deleteOne({ _id: DE });
    const etat = await db.collection('collecte_etat').findOne({ _id: DE });
    if (etat) { await db.collection('collecte_etat').insertOne({ ...etat, _id: VERS, renommeDe: DE, renommeLe: le }); await db.collection('collecte_etat').deleteOne({ _id: DE }); }
    if (rDe['cartes.sets']) { await db.collection('cartes').updateMany({ sets: DE }, { $addToSet: { sets: VERS } }); await db.collection('cartes').updateMany({ sets: DE }, { $pull: { sets: DE } }); }
    if (rDe.restes) await db.collection('restes').updateMany({ set: DE }, { $set: { set: VERS } });
    if (rDe['cartes_produits.slugSet']) await db.collection('cartes_produits').updateMany({ slugSet: DE }, { $set: { slugSet: VERS } });
    const apres = await references(db, DE), vers = await references(db, VERS);
    const survivantes = Object.entries(apres).filter(([, n]) => n);
    console.log(`\n   relu — références à ${DE} : ${JSON.stringify(apres)}\n   relu — références à ${VERS} : ${JSON.stringify(vers)}`);
    console.log(survivantes.length ? `   🔴 ${survivantes.length} référence(s) à « ${DE} » survivent : ${survivantes.map(([k, n]) => `${k} ${n}`).join(', ')}` : `   ✅ « ${DE} » n'est plus référencé nulle part ; « ${VERS} » porte le set${etat ? ' et son état de collecte' : ''}`);
    await fermer();
    if (survivantes.length || !vers.sets) process.exitCode = 1;
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
