// ============================================================
// RETIRER EN UN SEUL LOT LES SYMBOLES POSÉS PAR poser-symboles-ptcgio.js (lot symboles-2026-10) — le symbole est `retirable: true`
// ============================================================
//   node retirer-symboles-ptcgio.js                                  (à blanc : liste les sets et les clés R2, rien n'est touché)
//   node lot-additif.js --quoi="retrait des symboles pokemontcg.io" --collections=sets -- node retirer-symboles-ptcgio.js --ecrire [--effacer-r2]
//
// Ne s'exécute QUE sur demande de l'éditeur (un retrait est une suppression : il attend toujours son feu vert). Il retire EXACTEMENT le lot :
// les sets dont `symbole.lot === 'symboles-2026-10'` (le champ `symbole` entier, que le lot avait posé sur un set qui n'en avait pas) — aucun autre symbole,
// aucun autre champ. Les objets R2 restent (un retour arrière est un rejeu) ; `--effacer-r2` supprime aussi l'image et la vignette, définitivement.
'use strict';
const LOT = 'symboles-2026-10';

/**
 * @param {object} db  la base `cartes`
 * @param {{ecrire?: boolean, effacerR2?: boolean, supprimer?: Function, verifierBucket?: Function, bucket?: string}} o
 */
const FICHIER_ORPHELINS = 'orphelins-symboles-2026-10.json';
/** Les clés R2 déposées par un passage d'écriture puis non supprimées (consignées dans le dossier du cache) : [] si le fichier n'existe pas, LÈVE s'il est illisible. */
function lireOrphelins(cache) {
    const f = require('path').join(cache, FICHIER_ORPHELINS);
    const fs = require('fs');
    if (!fs.existsSync(f)) return [];
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(j) || !j.every(o => o && typeof o.cle === 'string')) throw new Error(`${f} : pas une liste d'orphelins { slug, cle }`);
    return j;
}

async function retirerLot(db, { ecrire = false, effacerR2 = false, supprimer = null, verifierBucket = null, bucket = process.env.R2_BUCKET_IMAGES, orphelins = [] } = {}) {
    const S = db.collection('sets');
    const sets = await S.find({ 'symbole.lot': LOT }, { projection: { symbole: 1 } }).toArray();
    const duLot = sets.filter(s => s.symbole?.lot === LOT);
    const cles = [...new Set(duLot.flatMap(s => [s.symbole.cleR2, s.symbole.vignette?.cleR2].filter(Boolean)))];
    const clesOrphelines = [...new Set(orphelins.map(o => o.cle))];
    const plan = { sets: duLot.map(s => s._id), cles, orphelins: clesOrphelines };
    if (!ecrire) return plan;
    if (effacerR2 && (typeof supprimer !== 'function' || typeof verifierBucket !== 'function' || !bucket)) throw new Error('retirerLot : --effacer-r2 sans client R2, sans verifierBucket ou sans nom de bucket');
    if (effacerR2) await verifierBucket(bucket);      // juridiction UE : rien n'est retiré si le bucket ne répond pas
    let retires = 0, nR = 0;
    const retiresIds = [], nonRetires = [];
    const clesDe = new Map(duLot.map(s => [s._id, [s.symbole.cleR2, s.symbole.vignette?.cleR2].filter(Boolean)]));   // relevées AVANT le retrait
    for (const s of duLot) {
        const m = (await S.updateOne({ _id: s._id, 'symbole.lot': LOT }, { $unset: { symbole: 1 } })).modifiedCount;
        retires += m; (m === 1 ? retiresIds : nonRetires).push(s._id);
    }
    // les clés R2 d'un set ne s'effacent que si son updateOne a RÉELLEMENT retiré le champ (un symbole modifié entre-temps reste servi) ; les orphelins n'appartiennent à aucun set
    const aEffacer = [...new Set([...retiresIds.flatMap(id => clesDe.get(id)), ...clesOrphelines])];
    if (effacerR2) for (let i = 0; i < aEffacer.length; i += 500) { await supprimer(bucket, aEffacer.slice(i, i + 500)); nR += Math.min(500, aEffacer.length - i); }
    const reste = await S.countDocuments({ 'symbole.lot': LOT });
    return { ...plan, retires, nR, reste, nonRetires };
}

module.exports = { retirerLot, lireOrphelins, FICHIER_ORPHELINS, LOT };

if (require.main === module) {
    require('dotenv').config();
    const AUTORISES = [/^--ecrire$/, /^--effacer-r2$/, /^--cache=.+$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --effacer-r2, --cache=<dossier> (lit les orphelins R2 consignés)`); process.exit(2); }
    const cacheArg = process.argv.slice(2).find(a => a.startsWith('--cache='))?.slice(8) ?? null;
    const ecrire = process.argv.includes('--ecrire'), effacerR2 = process.argv.includes('--effacer-r2');
    if (effacerR2 && !ecrire) { console.error('❌ --effacer-r2 sans --ecrire n\'a pas de sens'); process.exit(2); }
    (async () => {
        const { ouvrirConnexions } = require('./collecte-cartes/garde');
        const r2 = require('./collecte-cartes/r2');
        const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: effacerR2 ? ['R2_BUCKET_IMAGES'] : [], lectureSeule: !ecrire });
        try {
            const orphelins = cacheArg ? lireOrphelins(cacheArg) : [];
            const plan = await retirerLot(cx.db, { ecrire: false, orphelins });
            console.log(`\n════ DÉNOMINATEUR : ${await cx.db.collection('sets').countDocuments({})} sets · ${plan.sets.length} portent un symbole du lot ${LOT} · ${plan.cles.length} clés R2 (images et vignettes) · ${plan.orphelins.length} orphelin(s) R2 consigné(s)${cacheArg ? '' : ' (sans --cache : aucun fichier d\'orphelins lu)'} ════`);
            for (const s of plan.sets) console.log(`   ${s}`);
            for (const o of plan.orphelins) console.log(`   orphelin R2 : ${o}`);
            if (!ecrire) { console.log('\n   (à blanc — le retrait ne part que sur demande de l\'éditeur : lot-additif.js … -- node retirer-symboles-ptcgio.js --ecrire)'); return; }
            const r = await retirerLot(cx.db, { ecrire: true, effacerR2, supprimer: (b, c) => r2.supprimer(b, c), verifierBucket: b => r2.verifierBucket(b), orphelins });
            console.log(`\n${r.reste ? '🔴' : '✅'} symboles retirés ${r.retires} · objets R2 effacés ${r.nR} · non retirés (modifiedCount 0, leurs clés R2 gardées) : ${r.nonRetires.length} · relu : ${r.reste} set(s) portent encore un symbole du lot`);
            console.log(`SETS : ${r.sets.join(',')}`);
            if (r.reste) process.exitCode = 1;
        } finally { await fermer(); }
    })().catch(e => { console.error(e); process.exit(1); });
}
