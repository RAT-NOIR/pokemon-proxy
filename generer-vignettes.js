// ============================================================
// LES VIGNETTES DU STOCK — rattrapage (demande du site, DEMANDE-VIGNETTES.md) ; le worker, lui, les pose après chaque jointure
// ============================================================
//   node generer-vignettes.js                          (mesure : combien d'entrées sans vignette, combien déjà faites — rien d'écrit)
//   node generer-vignettes.js --ecrire [--slug=<set>] [--limite=N] [--parallele=N]   (cartes)
//   node generer-vignettes.js --ecrire --logos         (logos de sets, 400 px)
// À lancer SOUS lot-additif.js (sauvegarde, garde, journal) ; la revalidation, c'est CET outil qui la fait (la garde de lot compare
// (set, cleR2, numero) et ne voit pas le champ `vignette` — garde-lot.js) :
//   node lot-additif.js --quoi="vignettes 200 px" --collections=images -- node generer-vignettes.js --ecrire
// Aucune requête à une source : l'original se relit sur R2 (notre archive), la vignette s'y dépose (clé à elle, idempotente).
require('dotenv').config();
//   [--sans-revalidation]  (par défaut les sets touchés SONT revalidés ici : la garde de lot ne voit pas `images[].vignette` et n'en
//                           revaliderait aucun — revue du 2026-09-27, 501 sets revalidés à la main après le premier rattrapage)
//   node generer-vignettes.js --ecrire --logos --champ=logoFr   (les logos français, 2026-09-28 ; le site ne lit pas encore `logoFr`)
//   node generer-vignettes.js --ecrire --symboles   (symboles de sets, 64 px de haut — demande du site du 2026-09-28 ; sans revalidation :
//                                                    le site ne lit pas encore `vignette` sur les symboles)
const AUTORISES = [/^--ecrire$/, /^--logos$/, /^--symboles$/, /^--champ=(logo|logoFr)$/, /^--slug=[\w.-]+$/, /^--limite=\d+$/, /^--parallele=\d+$/, /^--sans-revalidation$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --logos [--champ=logo|logoFr], --symboles, --slug=, --limite=, --parallele=, --sans-revalidation`); process.exit(2); }
if (process.argv.includes('--symboles') && (process.argv.includes('--logos') || process.argv.some(a => /^--(slug|limite|parallele|champ)=/.test(a)))) { console.error('❌ --symboles traite tous les symboles sans vignette, seul'); process.exit(2); }
if (process.argv.some(a => a.startsWith('--champ=')) && !process.argv.includes('--logos')) { console.error('❌ --champ ne vaut qu\'avec --logos'); process.exit(2); }
if (process.argv.includes('--logos') && process.argv.some(a => /^--(slug|limite|parallele)=/.test(a))) { console.error('❌ --logos traite tous les logos sans vignette : --slug, --limite et --parallele ne s\'y appliquent pas'); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
// le secret se vérifie AVANT d'écrire : découvert après deux heures d'écriture, il laissait des sets changés sans revalidation, et une
// relance ne les retrouve plus (tout est déjà vignetté) — revue du 2026-09-27
const revalider = process.argv.includes('--ecrire') && !process.argv.includes('--logos') && !process.argv.includes('--symboles') && !process.argv.includes('--sans-revalidation');
if (revalider && !process.env.REVALIDATION_SECRET) { console.error('❌ REVALIDATION_SECRET absent : les sets vignettés ne pourraient pas être revalidés — rien écrit (ou --sans-revalidation, en le disant)'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { assurerVignettes, assurerVignettesLogos, assurerVignettesSymboles } = require('./collecte-cartes/vignette');

(async () => {
    const ecrire = process.argv.includes('--ecrire'), logos = process.argv.includes('--logos');
    const bucket = process.env.R2_BUCKET_IMAGES;
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    const db = cx.db, t0 = Date.now();
    if (logos) {
        const champ = arg('champ') || 'logo';
        const L = await assurerVignettesLogos(db, { bucket, ecrire, champ });
        console.log(`LOGOS (${champ}) : ${L.sets} sets à logo sans vignette${ecrire ? ` · fabriquées ${L.fabriquees} · déjà sur R2 ${L.deja} · écrites ${L.touches.length} · échecs ${L.echecs.length} · poids ${(L.octetsAvant / 1e6).toFixed(1)} Mo → ${(L.octetsApres / 1e6).toFixed(1)} Mo` : ' (mesure seule)'}`);
        await fermer(); return;
    }
    if (process.argv.includes('--symboles')) {
        const Y = await assurerVignettesSymboles(db, { bucket, ecrire });
        console.log(`SYMBOLES : ${Y.sets} sets, ${Y.fichiers} fichiers sans vignette${ecrire ? ` · fabriquées ${Y.fabriquees} · déjà sur R2 ${Y.deja} · sets écrits ${Y.touches.length} · échecs ${Y.echecs.length} · poids ${(Y.octetsAvant / 1e6).toFixed(2)} Mo → ${(Y.octetsApres / 1e6).toFixed(2)} Mo` : ' (mesure seule)'}`);
        if (ecrire) {
            const S = db.collection('sets');
            const reste = await S.countDocuments({ $or: [{ symbolesIdentification: { $elemMatch: { cleR2: { $type: 'string' }, vignette: { $exists: false } } } }, { 'symbole.cleR2': { $type: 'string' }, 'symbole.vignette': { $exists: false } }] });
            console.log(`   RELU : ${reste} sets portent encore un symbole sans vignette`);
            if (Y.echecs.length || reste) process.exitCode = 1;
        }
        await fermer(); return;
    }
    const totalEntrees = (await db.collection('cartes').aggregate([{ $unwind: '$images' }, { $group: { _id: null, n: { $sum: 1 }, avec: { $sum: { $cond: [{ $ifNull: ['$images.vignette', false] }, 1, 0] } } } }]).toArray())[0] || { n: 0, avec: 0 };
    console.log(`DÉNOMINATEUR : ${totalEntrees.n} entrées cartes.images · ${totalEntrees.avec} portent déjà une vignette${arg('slug') ? ` · périmètre : ${arg('slug')}` : ''}`);
    const R = await assurerVignettes(db, { bucket, slug: arg('slug') || null, limite: arg('limite') ? Number(arg('limite')) : Infinity, parallele: Number(arg('parallele') || 6), ecrire });
    const duree = ((Date.now() - t0) / 1000).toFixed(0);
    if (!ecrire) console.log(`   à faire : ${R.entrees} entrées, ${R.cles} images distinctes (dont ${R.depuisDocument} déjà vignettées sur leur document), ${R.sets.length} sets — mesure seule`);
    else console.log(`   ✅ ${R.entrees} entrées · ${R.cles} images · fabriquées ${R.fabriquees} (${(R.octets / 1e6).toFixed(1)} Mo) · déjà sur R2 ${R.deja} · reprises du document ${R.depuisDocument} · échecs ${R.echecs.length} · ${R.sets.length} sets · ${duree} s`);
    if (ecrire) {
        // la revalidation part JUSTE APRÈS les écritures, avant la relecture (un $unwind complet sur une grappe bridée) : un échec ou
        // une interruption de la relecture ne perd plus les sets (revue du 2026-09-27)
        if (R.sets.length && !revalider) console.log(`   ⚠️ --sans-revalidation : ${R.sets.length} sets changés NON revalidés — ${R.sets.join(', ')}`);
        if (R.sets.length && revalider) {
            const { revaliderSets, mettreEnAttente } = require('./collecte-cartes/revalider-site');
            try {
                const rv = await revaliderSets(R.sets, { journal: console });
                console.log(`   revalidation : ${rv.appels} appel(s), ${rv.sets} set(s)`);
            } catch (e) {
                // les sets ne se perdent pas : ils attendent dans revalidations-en-attente.json (même geste que lot-additif.js),
                // rejoué par `node collecte-cartes/revalider-site.js --en-attente`
                const n = mettreEnAttente({ le: new Date().toISOString(), quoi: 'generer-vignettes', sets: R.sets, erreur: e.message.slice(0, 200) });
                console.error(`   🔴 revalidation ÉCHOUÉE (${e.message.slice(0, 90)}) : ${R.sets.length} sets mis en attente (${n} lot(s) en attente) — ${R.sets.slice(0, 8).join(', ')}${R.sets.length > 8 ? '…' : ''}`);
                process.exitCode = 1;
            }
        }
        const apres = (await db.collection('cartes').aggregate([{ $unwind: '$images' }, { $group: { _id: null, n: { $sum: 1 }, avec: { $sum: { $cond: [{ $ifNull: ['$images.vignette', false] }, 1, 0] } } } }]).toArray())[0];
        console.log(`   RELU : ${apres.avec}/${apres.n} entrées portent une vignette`);
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
