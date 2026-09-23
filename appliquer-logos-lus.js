// ============================================================
// APPLIQUER AUX SETS DÉJÀ EN BASE LES LOGOS LUS À L'ŒIL — couple (retiré) et générique (marqué) (2026-09-24)
// ============================================================
//   node appliquer-logos-lus.js            (imprime ce qui changerait — rien d'écrit)
//   node appliquer-logos-lus.js --ecrire   (écrit ; la sauvegarde se fait AVANT, à part :
//        node sauvegarder-champs-cartes.js --collection=sets --champs=logo,logoRefus,logoGenerique --dossier=backup-…)
//
// Les deux tables vivent dans collecte-cartes/langue-logo.js, et les collecteurs les appliquent désormais eux-mêmes à
// l'écriture. Cet outil rattrape ce qu'ils ont posé AVANT elles, sans une requête : il ne lit que la base.
//   · un logo dont le FICHIER est dans la table du couple : retiré, `logoRefus` écrit avec sa cause (§46 : un refus s'écrit) ;
//   · un logo dont l'EMPREINTE est dans la table des génériques : gardé, `logoGenerique: true` et sa preuve ;
//   · tout autre logo : `logoGenerique: false` — le site lit un booléen, jamais une absence qu'il devrait interpréter.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { refusDuCouple, logoGenerique } = require('./collecte-cartes/langue-logo');

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const avecLogo = await lireMongo(S, { 'logo.cleR2': { $nin: [null, ''] } }, { nom: 'sets à logo', projection: { logo: 1, logoGenerique: 1 } });
    const couple = [], generiques = [], autres = [];
    for (const s of avecLogo) {
        const c = refusDuCouple(s.logo.fichier);
        if (c) { couple.push({ s, motif: c }); continue; }
        const g = logoGenerique(s.logo.sha1);
        (g ? generiques : autres).push({ s, g });
    }
    console.log(`\n════ DÉNOMINATEUR : ${avecLogo.length} sets portent un logo ════`);
    console.log(`   🔴 logo du COUPLE, à retirer : ${couple.length}`);
    for (const x of couple) console.log(`      ${x.s._id.padEnd(34)} « ${x.s.logo.fichier} » (${x.s.logo.source}) — ${x.motif}`);
    console.log(`   ⚪ GÉNÉRIQUES, gardés et marqués : ${generiques.length}`);
    for (const x of generiques) console.log(`      ${x.s._id.padEnd(34)} ${x.g}`);
    console.log(`   ✅ logos de set : ${autres.length} (logoGenerique: false)`);
    if (!ecrire) { console.log('\n   (rien d\'écrit — --ecrire, après la sauvegarde des champs logo, logoRefus, logoGenerique)'); await fermer(); return; }

    for (const x of couple) await S.updateOne({ _id: x.s._id, 'logo.fichier': x.s.logo.fichier }, {
        $set: { logoRefus: { motif: x.motif, fichier: x.s.logo.fichier, le: new Date(), instrument: 'appliquer-logos-lus.js', source: x.s.logo.source } },
        $unset: { logo: 1, logoGenerique: 1, logoGeneriquePreuve: 1 }
    });
    for (const x of generiques) await S.updateOne({ _id: x.s._id }, { $set: { logoGenerique: true, logoGeneriquePreuve: x.g } });
    if (autres.length) await S.updateMany({ _id: { $in: autres.map(x => x.s._id) } }, { $set: { logoGenerique: false }, $unset: { logoGeneriquePreuve: 1 } });
    // RELU, pas supposé
    const relu = {
        logos: await S.countDocuments({ 'logo.cleR2': { $nin: [null, ''] } }),
        generiques: await S.countDocuments({ logoGenerique: true }),
        nonGeneriques: await S.countDocuments({ logoGenerique: false }),
        coupleEncore: await S.countDocuments({ 'logo.fichier': { $in: couple.map(x => x.s.logo.fichier) } }),
        logoSansBooleen: await S.countDocuments({ 'logo.cleR2': { $nin: [null, ''] }, logoGenerique: { $exists: false } })
    };
    console.log(`\n   RELU : ${relu.logos} sets à logo · génériques ${relu.generiques} · logos de set ${relu.nonGeneriques} · logo du couple encore posé ${relu.coupleEncore} · logo sans booléen ${relu.logoSansBooleen}`);
    const juste = relu.logos === avecLogo.length - couple.length && relu.generiques === generiques.length && relu.nonGeneriques === autres.length && !relu.coupleEncore && !relu.logoSansBooleen;
    console.log(`   ${juste ? '✅ concordant' : '🔴 NE CONCORDE PAS — à ouvrir avant toute autre écriture'}`);
    await fermer();
    if (!juste) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
