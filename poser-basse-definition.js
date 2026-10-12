// ============================================================
// LE RATTRAPAGE DE LA MARQUE `basseDefinition` — sur ce qui est DÉJÀ en base (décision du testeur, 2026-10-12)
// ============================================================
//   node poser-basse-definition.js            (mesure, c'est le défaut : aucune écriture, dénominateur imprimé, par source et par set)
//   node lot-additif.js --quoi="…" --collections=images,cartes -- node poser-basse-definition.js --ecrire     (l'écriture, sous la garde de lot)
//
// « Chaque image sous 350 px reçoit une marque basseDefinition: true, que le site lira pour ne jamais l'agrandir au-delà de sa taille réelle. »
// Les collecteurs la posent désormais à l'écriture (collecte-cartes/basse-definition.js) ; ce script la pose sur ce qui existait avant elle :
// les visuels TPC de 300 à 349 px, les PikaQian (300 px), et toute autre image dont l'ORIGINAL est sous 350 px.
//
// 🔑 LA RÈGLE N'EST PAS RECOPIÉE : `estBasseDefinition` et `largeurOriginaleDe` viennent de collecte-cartes/seuils-images.js, les mêmes que les
// collecteurs appellent (§21 bis). La largeur est celle de l'ORIGINAL (`wOriginal`) ; à défaut `w`, mais seulement s'il est sous le plafond servi
// (700 px) — un fichier plafonné a été réduit, son original est inconnu : on ne le marque pas. Une largeur inconnue n'est pas « basse », elle se COMPTE à part.
//
// ADDITIF STRICT : `$set` du seul champ `basseDefinition`, conditionné à son ABSENCE (`$exists: false`) — une relance ne réécrit rien, et ne retire
// jamais une marque. Deux collections : `images` (le document, etat ok) et `cartes` (l'ENTRÉE de `cartes.images[]`, que le site lit — entrée par
// entrée, `arrayFilters` sur `cleR2` : le worker pousse des entrées pendant ce temps, un `$set` du tableau entier effacerait les siennes).
// ⚠️ Les ENTRÉES sont ce que le site lit : marquer les documents seuls ne servirait à rien ; d'où `--collections=images,cartes` sous lot-additif.js.
// Le remplacement d'une entrée marquée par une meilleure image n'est PAS fait ici : c'est celui des collecteurs, à la jointure.
const { estBasseDefinition, largeurOriginaleDe } = require('./collecte-cartes/seuils-images');

/**
 * Pure. @param {object[]} docs  les documents `images` (etat ok) : _id, source, set, cleR2, wOriginal, w, basseDefinition
 *       @param {object[]} cartes les cartes : _id, images[] (set, source, cleR2, w, basseDefinition)
 * @returns {{docsAEcrire:object[], entreesAEcrire:{carteId:*, cleR2:string, set:string, source:string}[], compte:object}}
 */
function planifier(docs, cartes) {
    const compte = { documentsOk: 0, largeurConnue: 0, largeurInconnue: 0, basseDefinition: 0, dejaMarques: 0, parSource: {}, parSet: {},
        entrees: 0, entreesBasses: 0, entreesDejaMarquees: 0, entreesParSource: {}, entreesSansDocument: 0 };
    const docsAEcrire = [], parCle = new Map();
    for (const d of docs) {
        if (d?.etat !== 'ok') continue;                                       // seulement les documents servis : un `trop-petit` n'est jamais joint
        compte.documentsOk++;
        parCle.set(d.cleR2, d);
        const w = largeurOriginaleDe(d);
        if (w == null) { compte.largeurInconnue++; continue; }
        compte.largeurConnue++;
        if (!estBasseDefinition(w)) continue;
        compte.basseDefinition++;
        compte.parSource[d.source] = (compte.parSource[d.source] || 0) + 1;
        compte.parSet[d.set] = (compte.parSet[d.set] || 0) + 1;
        if (d.basseDefinition === true) compte.dejaMarques++; else docsAEcrire.push(d);
    }
    const entreesAEcrire = [];
    for (const c of cartes) for (const e of c.images || []) {
        compte.entrees++;
        const doc = parCle.get(e.cleR2);
        if (!doc) compte.entreesSansDocument++;
        // la largeur de l'original : celle du document ; à défaut (document sans largeur exploitable, ou entrée sans document), celle de l'entrée (`w`, servie)
        const w = largeurOriginaleDe(doc) ?? largeurOriginaleDe(e);
        if (!estBasseDefinition(w)) continue;
        compte.entreesBasses++;
        compte.entreesParSource[e.source] = (compte.entreesParSource[e.source] || 0) + 1;
        if (e.basseDefinition === true) { compte.entreesDejaMarquees++; continue; }
        entreesAEcrire.push({ carteId: c._id, cleR2: e.cleR2, set: e.set, source: e.source });
    }
    return { docsAEcrire, entreesAEcrire, compte };
}
module.exports = { planifier };

if (require.main !== module) return;

require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo, champSur } = require('./collecte-cartes/lecture-sure');

const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire (le défaut est la mesure)`); process.exit(2); }

const trier = o => Object.entries(o).sort((a, b) => b[1] - a[1]);
(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    // `lireMongo` lève sur une collection vide ou mal nommée (§41) ; `champSur` lève si le champ lu n'existe sur aucun document
    const docs = await lireMongo(cx.db.collection('images'), { etat: 'ok' }, { nom: 'images (ok)', projection: { source: 1, set: 1, cleR2: 1, etat: 1, wOriginal: 1, w: 1, basseDefinition: 1 } });
    champSur(docs, 'cleR2', { collection: 'images (ok)' });
    const cartes = await lireMongo(cx.db.collection('cartes'), { 'images.0': { $exists: true } }, { nom: 'cartes avec images', projection: { images: 1 } });
    const { docsAEcrire, entreesAEcrire, compte: C } = planifier(docs, cartes);
    console.log(`\n════ DOCUMENTS images (etat ok) : ${C.documentsOk} ════`);
    console.log(`   largeur d'origine connue : ${C.largeurConnue} · inconnue (plafonnée à 700 ou absente — jamais marquée) : ${C.largeurInconnue}`);
    console.log(`   de basse définition (original sous 350 px) : ${C.basseDefinition} sur ${C.largeurConnue} · déjà marqués : ${C.dejaMarques} · à marquer : ${docsAEcrire.length}`);
    console.log(`   par source : ${trier(C.parSource).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}`);
    console.log(`   par set (les 15 premiers sur ${Object.keys(C.parSet).length}) : ${trier(C.parSet).slice(0, 15).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}`);
    console.log(`\n════ ENTRÉES cartes.images : ${C.entrees} sur ${cartes.length} cartes (dont ${C.entreesSansDocument} sans document images) ════`);
    console.log(`   de basse définition : ${C.entreesBasses} sur ${C.entrees} · déjà marquées : ${C.entreesDejaMarquees} · à marquer : ${entreesAEcrire.length}`);
    console.log(`   par source : ${trier(C.entreesParSource).map(([k, n]) => `${k} ${n}`).join(' · ') || '—'}`);
    if (!ecrire) { console.log('\n   (mesure seule — aucune écriture ; --ecrire sous lot-additif.js --collections=images,cartes)'); await fermer(); return; }

    // ── L'ÉCRITURE : additive, le seul champ, conditionnée à son absence ────────────────────────────────────────────────────
    const d1 = docsAEcrire.length ? await cx.db.collection('images').bulkWrite(docsAEcrire.map(d => ({ updateOne: { filter: { _id: d._id, etat: 'ok', basseDefinition: { $exists: false } }, update: { $set: { basseDefinition: true } } } })), { ordered: false }) : { modifiedCount: 0 };
    const d2 = entreesAEcrire.length ? await cx.db.collection('cartes').bulkWrite(entreesAEcrire.map(e => ({ updateOne: { filter: { _id: e.carteId }, update: { $set: { 'images.$[e].basseDefinition': true } }, arrayFilters: [{ 'e.cleR2': e.cleR2, 'e.basseDefinition': { $exists: false } }] } })), { ordered: false }) : { modifiedCount: 0 };
    // relu en base, pas déduit de ce qu'on a envoyé : le même plan rejoué doit tomber à zéro
    const apres = planifier(await lireMongo(cx.db.collection('images'), { etat: 'ok' }, { nom: 'images (ok), relues', projection: { source: 1, set: 1, cleR2: 1, etat: 1, wOriginal: 1, w: 1, basseDefinition: 1 } }),
        await lireMongo(cx.db.collection('cartes'), { 'images.0': { $exists: true } }, { nom: 'cartes avec images, relues', projection: { images: 1 } }));
    console.log(`\n   ✅ images : ${d1.modifiedCount} modifiés sur ${docsAEcrire.length} · cartes : ${d2.modifiedCount} cartes modifiées pour ${entreesAEcrire.length} entrées`);
    console.log(`   RELU : documents marqués ${apres.compte.dejaMarques} / ${apres.compte.basseDefinition}, entrées marquées ${apres.compte.entreesDejaMarquees} / ${apres.compte.entreesBasses} · reste à écrire ${apres.docsAEcrire.length} + ${apres.entreesAEcrire.length} ${apres.docsAEcrire.length + apres.entreesAEcrire.length === 0 ? '✅' : '🔴'}`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
