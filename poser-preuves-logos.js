// ============================================================
// LOGOS DÉPOSÉS : DE « INCONNU » À « OFFICIEL » SUR PREUVE DE PROVENANCE (lot LOGOS-ECR, 2026-10-13)
// ============================================================
//   node poser-preuves-logos.js                      SIMULATION (lecture seule : base + R2) : le plan, rien d'écrit
//   node lot-additif.js --quoi="preuves de provenance des logos 2026-10" --collections=sets -- node poser-preuves-logos.js --ecrire --attendu=<n>     (le coordinateur, depuis main)
//   node lot-additif.js --quoi="retrait des preuves de provenance des logos" --collections=sets -- node poser-preuves-logos.js --retirer --ecrire --attendu=<n>    (réversibilité)
// Les règles et la liste fermée : collecte-cartes/preuves-logos.js. Écrit, par champ nommé : `<champ>.niveau` = officiel (valeur actuelle exigée : inconnu) et `<champ>.niveauPreuve` (neuf). Rien d'autre.
// Les octets du logo sont relus dans R2 (lecture seule) : le sha256 est calculé ici, jamais supposé.
require('dotenv').config();
const crypto = require('crypto');
const P = require('./collecte-cartes/preuves-logos');

if (require.main === module) (async () => {
    const A = P.analyserArguments(process.argv.slice(2));
    if (A.erreurs.length) { for (const e of A.erreurs) console.error(`❌ ${e}`); process.exit(2); }
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = A.ecrire ? await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] })
        : await require('./collecte-cartes/ouvrir-lecture').ouvrirSimulation({ viaEcriture: A.viaEcriture, ouvrirConnexions });
    const S = cx.cartes.db.collection('sets');
    const total = await S.countDocuments({});
    if (!total) throw new Error('collection sets vide : base fausse');
    const r2 = require('./collecte-cartes/r2'), bucket = process.env.R2_BUCKET_IMAGES;
    if (!bucket) throw new Error('R2_BUCKET_IMAGES absente');
    await r2.verifierBucket(bucket);
    console.log(`DÉNOMINATEUR : ${total} sets en base · ${P.PREUVES.length} preuves dans la liste fermée (${P.PREUVES.filter(p => p.type === 'a').length} a, ${P.PREUVES.filter(p => p.type === 'b').length} b) · mode ${A.retirer ? 'RETRAIT' : 'POSE'}`);
    const sha = new Map();
    const sha256De = async cleR2 => { if (!sha.has(cleR2)) { try { sha.set(cleR2, crypto.createHash('sha256').update(await r2.lireBinaire(bucket, cleR2)).digest('hex')); } catch { sha.set(cleR2, null); } } return sha.get(cleR2); };
    const lire = async p => S.findOne({ _id: p.set }, { projection: { [p.champ.split('.')[0]]: 1 } });
    const plans = [];
    for (const p of P.PREUVES) {
        const set = await lire(p);
        const pl = A.retirer ? P.planifierRetrait({ preuve: p, set }) : P.planifier({ preuve: p, set, sha256Octets: set?.[p.champ]?.cleR2 ? await sha256De(set[p.champ].cleR2) : null });
        plans.push(pl);
        console.log(`   ${p.set.padEnd(60)} ${p.type} ${pl.action}${pl.raison ? ` — ${pl.raison}` : ''}`);
    }
    const aEcrire = plans.filter(p => p.action === 'poser' || p.action === 'retirer').length;
    console.log(`PLAN : ${aEcrire} champ(s) à ${A.retirer ? 'retirer' : 'écrire'} · ${plans.filter(p => p.action === 'deja').length} déjà posé(s) · ${plans.filter(p => p.action === 'refus').length} refusé(s)`);
    if (!A.ecrire) { console.log('(simulation seule — --ecrire --attendu=<n> sous lot-additif.js ; rien n\'est écrit)'); await cx.fermer(); return; }
    if (plans.some(p => p.action === 'refus')) { console.error('❌ un plan est refusé : rien n\'est écrit'); await cx.fermer(); process.exit(2); }
    if (aEcrire !== A.attendu) { console.error(`❌ le plan écrirait ${aEcrire} champ(s), --attendu=${A.attendu} : refus avant toute écriture (relancer la simulation)`); await cx.fermer(); process.exit(2); }
    let ecrits = 0;
    for (const pl of plans) { const r = await P.appliquer({ S, plan: pl }); ecrits += r.ecrits; if (r.action === 'conflit') console.log(`   🔴 ${pl.id} : la condition a changé entre la lecture et l'écriture, rien d'écrit`); }
    let restants = 0;
    for (const p of P.PREUVES) {
        const set = await lire(p);
        const apres = A.retirer ? P.planifierRetrait({ preuve: p, set }).action : P.planifier({ preuve: p, set, sha256Octets: await sha256De(set[p.champ].cleR2) }).action;
        if (A.retirer ? apres !== 'refus' : apres !== 'deja') restants++;
    }
    console.log(`ÉCRIT : ${ecrits} champ(s) · RELU : ${restants} preuve(s) pas dans l'état attendu`);
    await cx.fermer();
    const ok = ecrits === A.attendu && restants === 0;
    console.log(ok ? `✅ concordant : ${ecrits} écrit(s) = ${A.attendu} attendu(s)` : '🔴 NE CONCORDE PAS');
    if (!ok) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
