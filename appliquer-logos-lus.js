// ============================================================
// APPLIQUER AUX SETS DÉJÀ EN BASE LES LOGOS LUS À L'ŒIL — couple et générique, RETIRÉS (2026-09-24, génériques depuis le 2026-09-28)
// ============================================================
//   node appliquer-logos-lus.js            (imprime ce qui changerait — rien d'écrit)
//   node appliquer-logos-lus.js --ecrire   (écrit ; la sauvegarde se fait AVANT, à part :
//        node sauvegarder-champs-cartes.js --collection=sets --champs=logo,logoRefus,logoGenerique,logoGeneriquePreuve --dossier=backup-…)
//
// Les tables vivent dans collecte-cartes/langue-logo.js, et les collecteurs les appliquent désormais eux-mêmes à l'écriture. Cet
// outil rattrape ce qu'ils ont posé AVANT elles, sans une requête : il ne lit que la base.
//   · un logo dont le FICHIER est dans la table du couple : retiré, `logoRefus` écrit avec sa cause (§46 : un refus s'écrit) ;
//   · un logo GÉNÉRIQUE — son EMPREINTE est dans la table, ou il porte déjà `logoGenerique: true` (posé avec sa preuve par un autre
//     collecteur) : RETIRÉ depuis le 2026-09-28 (décision du testeur : « les logos génériques sont retirés : ils recevront un logo
//     composé »), `logoRefus` écrit avec sa cause et l'ancien fichier (cleR2, sha1, source) — le site ne l'affichait déjà pas ;
//   · tout autre logo : `logoGenerique: false` — le site lit un booléen, jamais une absence qu'il devrait interpréter.
// Aucune revalidation : le site refusait déjà ces logos (rat-market-site/lib/visuelSet.ts, `estGenerique`), la page ne change pas.
require('dotenv').config();
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { lireMongo } = require('./collecte-cartes/lecture-sure');
const { refusDuCouple, logoGenerique, refusCopie } = require('./collecte-cartes/langue-logo');
// ➕ 2026-10-04 : les COPIES de Pokécardex (table LOGOS_COPIES, par empreinte) sont retirées comme le couple et les génériques,
// `logoRefus` écrit avec leur cause et l'ancien fichier (décision du testeur : « les 22 logos copiés de Pokécardex : retirés »).

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    const S = cx.db.collection('sets');
    const avecLogo = await lireMongo(S, { 'logo.cleR2': { $nin: [null, ''] } }, { nom: 'sets à logo', projection: { logo: 1, logoGenerique: 1, logoGeneriquePreuve: 1 } });
    const couple = [], generiques = [], copies = [], autres = [];
    for (const s of avecLogo) {
        const k = refusCopie(s.logo.sha1, s.logo.fichier);
        if (k) { copies.push({ s, motif: k }); continue; }
        const c = refusDuCouple(s.logo.fichier);
        if (c) { couple.push({ s, motif: c }); continue; }
        const g = logoGenerique(s.logo.sha1) || (s.logoGenerique === true ? (s.logoGeneriquePreuve || 'marqué générique en base, sans preuve écrite') : null);
        if (g) generiques.push({ s, motif: `logo GÉNÉRIQUE refusé (décision du testeur, 2026-09-28 : il recevra un logo composé) — ${g}` });
        else autres.push({ s });
    }
    console.log(`\n════ DÉNOMINATEUR : ${avecLogo.length} sets portent un logo ════`);
    console.log(`   🔴 logo du COUPLE, à retirer : ${couple.length}`);
    for (const x of couple) console.log(`      ${x.s._id.padEnd(34)} « ${x.s.logo.fichier} » (${x.s.logo.source}) — ${x.motif}`);
    console.log(`   🔴 logo GÉNÉRIQUE, à retirer : ${generiques.length}`);
    for (const x of generiques) console.log(`      ${x.s._id.padEnd(34)} « ${x.s.logo.fichier} » (${x.s.logo.source}) — ${x.motif.replace(/^.*? — /, '')}`);
    console.log(`   🔴 logo COPIÉ de Pokécardex, à retirer : ${copies.length}`);
    for (const x of copies) console.log(`      ${x.s._id.padEnd(34)} « ${x.s.logo.fichier} » (${x.s.logo.source})`);
    console.log(`   ✅ logos de set : ${autres.length} (logoGenerique: false)`);
    const retirer = [...couple, ...generiques, ...copies];
    if (!ecrire) { console.log('\n   (rien d\'écrit — --ecrire, après la sauvegarde des champs logo, logoRefus, logoGenerique, logoGeneriquePreuve)'); await fermer(); return; }

    let retires = 0;
    for (const x of retirer) {
        const r = await S.updateOne({ _id: x.s._id, 'logo.cleR2': x.s.logo.cleR2 }, {
            $set: { logoRefus: { motif: x.motif, fichier: x.s.logo.fichier, cleR2: x.s.logo.cleR2, sha1: x.s.logo.sha1 ?? null, le: new Date(), instrument: 'appliquer-logos-lus.js', source: x.s.logo.source } },
            $unset: { logo: 1, logoGenerique: 1, logoGeneriquePreuve: 1 }
        });
        retires += r.modifiedCount;
    }
    if (autres.length) await S.updateMany({ _id: { $in: autres.map(x => x.s._id) } }, { $set: { logoGenerique: false }, $unset: { logoGeneriquePreuve: 1 } });
    // RELU, pas supposé
    const relu = {
        logos: await S.countDocuments({ 'logo.cleR2': { $nin: [null, ''] } }),
        generiques: await S.countDocuments({ logoGenerique: true }),
        nonGeneriques: await S.countDocuments({ logoGenerique: false }),
        retiresAvecCause: await S.countDocuments({ _id: { $in: retirer.map(x => x.s._id) }, logo: { $exists: false }, 'logoRefus.instrument': 'appliquer-logos-lus.js' }),
        logoSansBooleen: await S.countDocuments({ 'logo.cleR2': { $nin: [null, ''] }, logoGenerique: { $exists: false } })
    };
    console.log(`\n   RETIRÉS : ${retires}/${retirer.length} · RELU : ${relu.logos} sets à logo · génériques encore marqués ${relu.generiques} · logos de set ${relu.nonGeneriques} · retirés avec leur cause ${relu.retiresAvecCause} · logo sans booléen ${relu.logoSansBooleen}`);
    const juste = relu.logos === avecLogo.length - retirer.length && !relu.generiques && relu.nonGeneriques === autres.length
        && relu.retiresAvecCause === retirer.length && !relu.logoSansBooleen;
    console.log(`   ${juste ? '✅ concordant' : '🔴 NE CONCORDE PAS — à ouvrir avant toute autre écriture'}`);
    await fermer();
    if (!juste) process.exit(1);
})().catch(e => { console.error('❌', e.message); process.exit(1); });
