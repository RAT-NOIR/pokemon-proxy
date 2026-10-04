// ============================================================
// RÉTABLIR LE LOGO QU'UN SET PORTAIT DANS UNE SAUVEGARDE — après le retrait d'un logo qui l'avait REMPLACÉ (2026-10-04)
// ============================================================
//   node retablir-logo-sauvegarde.js --set=<slug> --sauvegarde=<dossier backup-…>            (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=sets -- node retablir-logo-sauvegarde.js --set=<slug> --sauvegarde=<dossier> --ecrire
// L'occurrence : la copie Pokécardex de Trick-or-Trade-2023 (« jap_071 », 2026-09-27 22:41 UTC) avait REMPLACÉ le logo Bulbagarden
// « Trick or Trade 2023.png » (309×147, « même logo, meilleure définition ») ; la copie retirée, le set restait sans logo alors qu'il
// en avait un juste avant elle. Base : `cartes`. La garde s'écrit par ce qu'elle autorise — tout le reste refuse, rien n'est écrit :
//   · le set n'a PLUS de logo, et son `logoRefus` est celui d'une copie retirée (appliquer-logos-lus.js, motif « logo COPIÉ ») ;
//   · la sauvegarde porte un logo pour ce set (cleR2), que les tables de refus n'écartent pas (copie, couple, générique) ;
//   · le fichier est sur R2 (notre archive, aucune requête à une source).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const AUTORISES = [/^--set=[\w.-]+$/, /^--sauvegarde=backup-[\w-]+$/, /^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const arg = n => process.argv.find(a => a.startsWith(`--${n}=`))?.slice(n.length + 3);
if (inconnus.length || !arg('set') || !arg('sauvegarde')) { console.error(`❌ usage : --set=<slug> --sauvegarde=<backup-…> [--ecrire]${inconnus.length ? ` — inconnu : ${inconnus.join(' ')}` : ''}`); process.exit(2); }
const { EJSON } = require('mongodb').BSON;
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const { refusCopie, refusDuCouple, logoGenerique } = require('./collecte-cartes/langue-logo');

(async () => {
    const slug = arg('set'), dossier = path.join(__dirname, arg('sauvegarde')), ecrire = process.argv.includes('--ecrire');
    const f = path.join(dossier, 'sets.json');
    if (!fs.existsSync(f)) throw new Error(`${f} absent`);
    const avant = EJSON.parse(fs.readFileSync(f, 'utf8')).find(s => s._id === slug);
    if (!avant) throw new Error(`le set « ${slug} » n'est pas dans la sauvegarde`);
    const logo = avant.logo;
    if (!logo || typeof logo.cleR2 !== 'string') throw new Error(`la sauvegarde ne porte aucun logo pour « ${slug} »`);
    const refus = refusCopie(logo.sha1, logo.fichier) || refusDuCouple(logo.fichier) || logoGenerique(logo.sha1)
        || (avant.logoGenerique === true ? `marqué générique dans la sauvegarde (${avant.logoGeneriquePreuve ?? 'sans preuve écrite'})` : null);
    if (refus) throw new Error(`le logo de la sauvegarde est lui-même refusé par les tables : ${refus}`);
    const bucket = process.env.R2_BUCKET_IMAGES;
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    if (cx.db.databaseName !== 'cartes') throw new Error(`base « ${cx.db.databaseName} » : cet outil n'écrit que dans « cartes »`);
    await r2.verifierBucket(bucket);
    const S = cx.db.collection('sets');
    const actuel = await S.findOne({ _id: slug }, { projection: { logo: 1, logoRefus: 1 } });
    if (!actuel) throw new Error(`set « ${slug} » absent de la base`);
    if (actuel.logo) throw new Error(`« ${slug} » porte un logo (${actuel.logo.cleR2}) : rien n'est rétabli par-dessus`);
    if (!/^logo COPIÉ/.test(actuel.logoRefus?.motif ?? '')) throw new Error(`« ${slug} » : son logoRefus n'est pas celui d'une copie retirée (« ${String(actuel.logoRefus?.motif).slice(0, 80)} »)`);
    if (!(await r2.existe(bucket, logo.cleR2))) throw new Error(`le fichier ${logo.cleR2} n'est plus sur R2`);
    console.log(`PLAN : ${slug} ← logo de ${arg('sauvegarde')} : ${logo.source} « ${logo.fichier} » ${logo.w}×${logo.h} (${logo.cleR2})${logo.vignette ? ' avec vignette' : ' SANS vignette (generer-vignettes.js --logos)'} · retire logoRefus « ${actuel.logoRefus.motif.slice(0, 60)}… »`);
    if (!ecrire) { console.log('   (plan seul — --ecrire sous lot-additif.js)'); await fermer(); return; }
    const u = await S.updateOne({ _id: slug, logo: { $exists: false }, 'logoRefus.motif': actuel.logoRefus.motif }, { $set: { logo, logoGenerique: false }, $unset: { logoRefus: 1 } });
    const relu = await S.findOne({ _id: slug }, { projection: { logo: 1, logoRefus: 1 } });
    const ok = u.modifiedCount === 1 && relu.logo?.cleR2 === logo.cleR2 && !relu.logoRefus;
    console.log(`${ok ? '✅' : '🔴'} rétabli ${u.modifiedCount}/1 · RELU : logo ${relu.logo?.cleR2 ?? '—'} · logoRefus ${relu.logoRefus ? 'présent' : 'retiré'}`);
    await fermer();
    if (!ok) process.exit(1);
})().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
