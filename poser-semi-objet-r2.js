// ============================================================
// MATCH BATTLE : LOGO SEMI-OFFICIEL PAR RÉEMPLOI D'UN OBJET R2 DÉJÀ LÉGAL (lot LOGOS-ECR, 2026-10-13, décision 3 du testeur)
// ============================================================
//   node poser-semi-objet-r2.js                      SIMULATION (lecture seule : base + R2) : le plan, rien d'écrit
//   node lot-additif.js --quoi="logo semi-officiel Match Battle 2026-10" --collections=sets -- node poser-semi-objet-r2.js --ecrire --attendu=2     (le coordinateur, depuis main)
//   node lot-additif.js --quoi="retrait logo semi-officiel Match Battle" --collections=sets -- node poser-semi-objet-r2.js --retirer --ecrire --attendu=2    (réversibilité : AUCUN objet R2 supprimé)
// Écrit `logoSemiOfficiel.en` sur les deux sets de la liste fermée (collecte-cartes/semi-objet-r2.js) : l'entrée pointe l'objet R2 existant. Aucune requête externe, aucun objet R2 écrit.
require('dotenv').config();
const crypto = require('crypto');
const sharp = require('sharp');
const M = require('./collecte-cartes/semi-objet-r2');

if (require.main === module) (async () => {
    const A = M.analyserArguments(process.argv.slice(2));
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
    let mesure = null;
    if (!A.retirer) { try { const buf = await r2.lireBinaire(bucket, M.OBJET.cleR2); const m = await sharp(buf).metadata(); mesure = { sha256: crypto.createHash('sha256').update(buf).digest('hex'), octets: buf.length, w: m.width, h: m.height, format: m.format }; } catch { mesure = null; } }
    console.log(`DÉNOMINATEUR : ${total} sets en base · ${Object.keys(M.SETS).length} sets dans la liste fermée · mode ${A.retirer ? 'RETRAIT' : 'POSE'}${mesure ? ` · objet R2 ${mesure.octets} octets ${mesure.w}×${mesure.h} ${mesure.format}` : ''}`);
    const lire = id => S.findOne({ _id: id });
    const plans = [];
    for (const id of Object.keys(M.SETS)) {
        const set = await lire(id);
        const pl = A.retirer ? M.planifierRetrait({ id, set }) : M.planifier({ id, set, mesure });
        plans.push(pl);
        console.log(`   ${id.padEnd(34)} ${pl.action}${pl.raison ? ` — ${pl.raison}` : ''}`);
    }
    const aEcrire = plans.filter(p => p.action === 'poser' || p.action === 'retirer').length;
    console.log(`PLAN : ${aEcrire} set(s) à ${A.retirer ? 'retirer' : 'écrire'} · ${plans.filter(p => p.action === 'deja').length} déjà posé(s) · ${plans.filter(p => p.action === 'refus').length} refusé(s)`);
    if (!A.ecrire) { console.log('(simulation seule — --ecrire --attendu=<n> sous lot-additif.js ; rien n\'est écrit)'); await cx.fermer(); return; }
    if (plans.some(p => p.action === 'refus')) { console.error('❌ un plan est refusé : rien n\'est écrit'); await cx.fermer(); process.exit(2); }
    if (aEcrire !== A.attendu) { console.error(`❌ le plan écrirait ${aEcrire} set(s), --attendu=${A.attendu} : refus avant toute écriture (relancer la simulation)`); await cx.fermer(); process.exit(2); }
    let ecrits = 0;
    for (const pl of plans) { const r = await M.appliquer({ S, plan: pl }); ecrits += r.ecrits; if (r.action === 'conflit') console.log(`   🔴 ${pl.id} : la condition a changé entre la lecture et l'écriture, rien d'écrit`); }
    let restants = 0;
    for (const id of Object.keys(M.SETS)) { const set = await lire(id); const a = A.retirer ? M.planifierRetrait({ id, set }).action : M.planifier({ id, set, mesure }).action; if (A.retirer ? a !== 'refus' : a !== 'deja') restants++; }
    console.log(`ÉCRIT : ${ecrits} set(s) · RELU : ${restants} pas dans l'état attendu`);
    await cx.fermer();
    const ok = ecrits === A.attendu && restants === 0;
    console.log(ok ? `✅ concordant : ${ecrits} écrit(s) = ${A.attendu} attendu(s)` : '🔴 NE CONCORDE PAS');
    if (!ok) process.exitCode = 1;
})().catch(e => { console.error(e); process.exit(1); });
