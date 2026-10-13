// ============================================================
// L'HÉRITAGE DU LOGO D'UN ADDITIONALS — x30C (décision du testeur, 2026-10-13, DEC-LOGOS n°2 : « oui, l'identifiant de page du parent pour recevoir son logo officiel,
// si le logo est bien celui de ce produit. Réversible, noté au registre. »)
// ============================================================
//   node poser-logo-additionals.js                                      SIMULATION (lecture seule) : le plan, rien d'écrit
//   node lot-additif.js --quoi="logo 30th Celebration Additionals 2026-10" --collections=sets -- node poser-logo-additionals.js --ecrire --attendu=1     (le coordinateur, depuis main)
//   node lot-additif.js --quoi="retrait logo 30th Celebration Additionals" --collections=sets -- node poser-logo-additionals.js --retirer --ecrire --attendu=1    (réversibilité)
// Écrit sur `30th-Celebration-Additionals` : `bulba.pageid` (celui du parent), `logo` (celui du parent), `logoHeritage` (le registre) — chacun SEULEMENT s'il est absent.
// Aucun autre champ, aucun objet R2 (le logo est le fichier du parent, déjà dans R2). Règles : collecte-cartes/heritage-logo.js (liste fermée, garde par ce qu'elle autorise).
require('dotenv').config();
const H = require('./collecte-cartes/heritage-logo');

if (require.main === module) (async () => {
    const A = H.analyserArguments(process.argv.slice(2));
    if (A.erreurs.length) { for (const e of A.erreurs) console.error(`❌ ${e}`); process.exit(2); }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = A.ecrire ? await ouvrirConnexions({ production: false, buckets: [] })
        : await require('./collecte-cartes/ouvrir-lecture').ouvrirSimulation({ viaEcriture: A.viaEcriture, ouvrirConnexions });
    const S = cx.cartes.db.collection('sets');
    const total = await S.countDocuments({});
    if (!total) throw new Error('collection sets vide : base fausse');
    console.log(`DÉNOMINATEUR : ${total} sets en base · ${Object.keys(H.HERITAGES).length} héritage(s) dans la liste fermée · mode ${A.retirer ? 'RETRAIT' : 'POSE'}`);
    const plans = [];
    for (const [id, h] of Object.entries(H.HERITAGES)) {
        const [additionals, parent] = await Promise.all([S.findOne({ _id: id }), S.findOne({ _id: h.parent })]);
        const p = A.retirer ? H.planifierRetrait({ id, additionals, parent }) : H.planifier({ id, additionals, parent });
        plans.push(p);
        console.log(`   ${id} ← ${h.parent} : ${p.action}${p.raison ? ` — ${p.raison}` : ''}`);
        if (p.set) console.log(`      $set : bulba.pageid=${p.set['bulba.pageid']} · logo ${p.set.logo.source} ${p.set.logo.fichier} (sha1 ${p.set.logo.sha1.slice(0, 10)}, ${p.set.logo.w}×${p.set.logo.h}, niveau ${p.set.logo.niveau}) · logoHeritage de ${p.set.logoHeritage.de}`);
        if (p.unset) console.log(`      $unset : ${Object.keys(p.unset).join(', ')}`);
    }
    const aEcrire = plans.filter(p => p.action === 'poser' || p.action === 'retirer').length;
    console.log(`PLAN : ${aEcrire} set(s) à ${A.retirer ? 'retirer' : 'écrire'} · ${plans.filter(p => p.action === 'deja').length} déjà posé(s) · ${plans.filter(p => p.action === 'refus').length} refusé(s)`);
    if (!A.ecrire) { console.log('(simulation seule — --ecrire --attendu=<n> sous lot-additif.js ; rien n\'est écrit)'); await cx.fermer(); return; }
    if (plans.some(p => p.action === 'refus')) { console.error('❌ un plan est refusé : rien n\'est écrit'); await cx.fermer(); process.exit(2); }
    if (aEcrire !== A.attendu) { console.error(`❌ le plan écrirait ${aEcrire} set(s), --attendu=${A.attendu} : refus avant toute écriture (relancer la simulation)`); await cx.fermer(); process.exit(2); }
    let ecrits = 0;
    for (const p of plans) { const r = await H.appliquer({ S, plan: p }); ecrits += r.ecrits; if (r.action === 'conflit') console.log(`   🔴 ${p.id} : la condition a changé entre la lecture et l'écriture, rien d'écrit`); }
    const relus = await Promise.all(plans.filter(p => p.id).map(async p => { const [a, par] = await Promise.all([S.findOne({ _id: p.id }), S.findOne({ _id: H.HERITAGES[p.id].parent })]); return A.retirer ? H.planifierRetrait({ id: p.id, additionals: a, parent: par }).action : H.planifier({ id: p.id, additionals: a, parent: par }).action; }));
    console.log(`ÉCRIT : ${ecrits} set(s) · RELU : ${JSON.stringify(relus)}`);
    await cx.fermer();
    const ok = ecrits === A.attendu && relus.every(r => A.retirer ? r === 'refus' : r === 'deja');
    console.log(ok ? `✅ concordant : ${ecrits} écrit(s) = ${A.attendu} attendu(s)` : '🔴 NE CONCORDE PAS');
    if (!ok) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
