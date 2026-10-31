// ============================================================
// LES MOYENS DU STOCK — rattrapage du scan « moyen » (400 px) de chaque visuel servi d'au moins 471 px (demande du site, DEMANDE-CATALOGUE.md)
// ============================================================
//   node generer-moyens.js                                   (SIMULATION : aucune écriture ni lecture R2 ; imprime son dénominateur et ce qu'elle ferait)
//   node generer-moyens.js --ecrire [--sets=A,B] [--limite=N] [--parallele=N] [--reverifier]
// Par défaut la simulation. `--ecrire` est explicite. `--sets=` : une vague limitée (slugs de sets, séparés par des virgules). `--limite=` : au plus N images
// distinctes. `--reverifier` : compare aussi l'empreinte de l'original des entrées qui ONT un moyen (remplacement sous la même clé -> moyen refait).
// À lancer SOUS lot-additif.js (sauvegarde, garde, journal) ; la revalidation, c'est CET outil qui la fait (la garde de lot ne voit pas `images[].moyen`) :
//   node lot-additif.js --quoi="moyens 400 px" --collections=images -- node generer-moyens.js --ecrire [--sets=…]
// Aucune requête à une source : l'original se relit sur R2 (notre archive), le moyen s'y dépose (clé `moyens/…`, idempotente).
// 🔑 La règle (clé, taille, format, seuil, exclusions) vit dans collecte-cartes/moyen.js, appelée aussi par la chaîne des vignettes des lots (§21 bis).
require('dotenv').config();
const AUTORISES = [/^--ecrire$/, /^--sets=[\w.,-]+$/, /^--limite=\d+$/, /^--parallele=\d+$/, /^--reverifier$/, /^--sans-revalidation$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --sets=A,B, --limite=, --parallele=, --reverifier, --sans-revalidation`); process.exit(2); }
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const ecrire = process.argv.includes('--ecrire');
// le secret se vérifie AVANT d'écrire : découvert après des heures d'écriture, il laissait des sets changés sans revalidation
const revalider = ecrire && !process.argv.includes('--sans-revalidation');
if (revalider && !process.env.REVALIDATION_SECRET) { console.error('❌ REVALIDATION_SECRET absent : les sets touchés ne pourraient pas être revalidés — rien écrit (ou --sans-revalidation, en le disant)'); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { assurerMoyens, decisionMoyen } = require('./collecte-cartes/moyen');

(async () => {
    const bucket = process.env.R2_BUCKET_IMAGES, t0 = Date.now();
    const sets = arg('sets') ? arg('sets').split(',').filter(Boolean) : null;
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'], ...(ecrire ? {} : { lectureSeule: true }) });
    const db = cx.db;
    // LE DÉNOMINATEUR, imprimé avant tout : chaque entrée de cartes.images tombe dans UNE case (decisionMoyen, la définition du module)
    const D = { entrees: 0, avecCle: 0, 'basse-definition': 0, 'trop-petite': 0, 'largeur-inconnue': 0, ok: 0, okAvecMoyen: 0, okSansMoyen: 0, moyenSurExclue: 0 };
    const cles = { ok: new Set(), a_faire: new Set() };
    for await (const c of db.collection('cartes').find(sets ? { 'images.set': { $in: sets } } : { 'images.0': { $exists: true } }, { projection: { images: 1 } })) {
        for (const e of c.images || []) {
            if (sets && !sets.includes(e.set)) continue;
            D.entrees++;
            const dec = decisionMoyen(e);
            if (dec.raison === 'sans-cle') continue;
            D.avecCle++;
            if (!dec.faire) { D[dec.raison]++; if (e.moyen) D.moyenSurExclue++; continue; }
            D.ok++; cles.ok.add(e.cleR2);
            if (e.moyen) D.okAvecMoyen++; else { D.okSansMoyen++; cles.a_faire.add(e.cleR2); }
        }
    }
    console.log(`DÉNOMINATEUR${sets ? ` (sets : ${sets.join(', ')})` : ''} : ${D.entrees} entrées cartes.images · ${D.avecCle} avec cleR2`);
    console.log(`   exclues : ${D['basse-definition']} basseDefinition · ${D['trop-petite']} sous le seuil de largeur · ${D['largeur-inconnue']} à largeur inconnue (non traitées : le site compare à w)`);
    console.log(`   éligibles : ${D.ok} entrées (${cles.ok.size} images distinctes) · ${D.okAvecMoyen} portent déjà un moyen · ${D.okSansMoyen} à faire (${cles.a_faire.size} images distinctes) · ${D.moyenSurExclue} entrées exclues portent un moyen (à retirer)`);
    const R = await assurerMoyens(db, { bucket, sets, limite: arg('limite') ? Number(arg('limite')) : Infinity, parallele: Number(arg('parallele') || 6), ecrire, reverifier: process.argv.includes('--reverifier') });
    const duree = ((Date.now() - t0) / 1000).toFixed(0);
    if (!ecrire) {
        console.log(`   SIMULATION (rien lu sur R2, rien écrit) : ${R.cles} images à examiner, dont ${R.depuisDocument} à recopier depuis leur document · ${R.perimees} moyens périmés à refaire · ${R.retirees} à retirer · ${R.sets.length} sets touchés`);
        if (R.sets.length) console.log(`   sets : ${R.sets.slice(0, 30).join(', ')}${R.sets.length > 30 ? ` … (+${R.sets.length - 30})` : ''}`);
    } else {
        console.log(`   ✅ ${R.entrees} entrées · ${R.cles} images · fabriquées ${R.fabriquees} (${(R.octets / 1e6).toFixed(1)} Mo) · refaites ${R.refaites} · reprises du document ${R.depuisDocument} · retirées ${R.retirees} · déjà sur R2 ${R.deja} · échecs ${R.echecs.length} · ${R.sets.length} sets · ${duree} s`);
        if (R.sets.length && !revalider) console.log(`   ⚠️ --sans-revalidation : ${R.sets.length} sets changés NON revalidés — ${R.sets.join(', ')}`);
        if (R.sets.length && revalider) {
            const { revaliderSets, mettreEnAttente } = require('./collecte-cartes/revalider-site');
            try {
                const rv = await revaliderSets(R.sets, { journal: console });
                console.log(`   revalidation : ${rv.appels} appel(s), ${rv.sets} set(s)`);
            } catch (e) {
                // les sets ne se perdent pas : ils attendent dans revalidations-en-attente.json, rejoué par `node collecte-cartes/revalider-site.js --en-attente`
                const n = mettreEnAttente({ le: new Date().toISOString(), quoi: 'generer-moyens', sets: R.sets, erreur: e.message.slice(0, 200) });
                console.error(`   🔴 revalidation ÉCHOUÉE (${e.message.slice(0, 90)}) : ${R.sets.length} sets mis en attente (${n} lot(s) en attente)`);
                process.exitCode = 1;
            }
        }
        const apres = await db.collection('cartes').aggregate([{ $unwind: '$images' }, { $group: { _id: null, n: { $sum: 1 }, avec: { $sum: { $cond: [{ $ifNull: ['$images.moyen', false] }, 1, 0] } } } }]).toArray();
        console.log(`   RELU : ${apres[0]?.avec}/${apres[0]?.n} entrées portent un moyen`);
        if (R.echecs.length) process.exitCode = 1;
    }
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
