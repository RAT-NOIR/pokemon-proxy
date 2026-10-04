// ============================================================
// LES LOGOS FRANÇAIS POUR LE SITE — `sets.logoFr` au format de `sets.logo` (ordre du testeur, 2026-10-04 : « le site doit
// afficher mes logos FRANÇAIS ; expose logoFr au même format que le logo actuel »)
// ============================================================
//   node exposer-logos-fr.js              (mesure : ce qui manque à chaque logoFr, les fichiers partagés — rien d'écrit)
//   node lot-additif.js --quoi="logoFr : région, langue, empreinte" --collections=sets -- node exposer-logos-fr.js --ecrire
// Base : `cartes` (celle que le site lit). Aucune requête à une source : le fichier se relit sur R2, notre archive.
// Ce que le site exige d'un logo avant de l'afficher (rat-market-site/lib/visuelSet.ts, lu le 2026-10-04) : `cleR2`, `w`, `h`, une
// PREUVE DE LANGUE — `region` structurée, ou une phrase qu'il reconnaît — et, pour la règle des logos génériques, `sha1`. Les 117
// `logoFr` portent cleR2, w, h et leur vignette, mais aucun `region`, et leur phrase de preuve (« TCGdex [base5], image servie par
// la langue fr… », « déposé à la main par le testeur… ») n'est pas de celles que le site reconnaît : lus tels quels par sa règle,
// les 117 seraient REFUSÉS. Cet outil n'écrit que des clés ABSENTES — `region`, `langue`, `sha1` — et jamais une valeur existante :
//   · `region: 'intl'` : la région du SET (tirage ?? region) — un logo français n'existe que sur un set occidental ; un set d'un
//     autre tirage portant un logoFr est REFUSÉ et listé (rien n'est écrit pour lui) ;
//   · `langue: 'fr'` : le champ porte le logo français par construction (TCGdex servi par la langue fr, ou dossier « Logo FR » lu
//     à l'œil, rattacher-logos-manuels.js) ;
//   · `sha1` : l'empreinte du fichier RELU sur R2 ; un `sha1` déjà écrit est vérifié contre le fichier, jamais réécrit.
// Un fichier partagé par plusieurs sets s'imprime (le site calcule ses génériques sur l'empreinte) ; rien n'est décidé ici.
require('dotenv').config();
const crypto = require('crypto');
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : --ecrire`); process.exit(2); }
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');

/** Le plan d'un set : les clés absentes à poser, ou un refus. Pure (le sha1 du fichier est lu par l'appelant). */
function planLogoFr(set, sha1Fichier) {
    const l = set.logoFr;
    if (!l || typeof l.cleR2 !== 'string') return { refus: 'pas de logoFr.cleR2' };
    const tirage = set.tirage ?? set.region;
    if (tirage !== 'intl') return { refus: `set de tirage « ${tirage} » : un logo français n'appartient qu'à un set occidental` };
    if (l.region != null && l.region !== 'intl') return { refus: `logoFr.region déjà écrit à « ${l.region} »` };
    if (l.langue != null && l.langue !== 'fr') return { refus: `logoFr.langue déjà écrit à « ${l.langue} »` };
    if (!sha1Fichier) return { refus: 'fichier illisible sur R2' };
    if (l.sha1 != null && l.sha1 !== sha1Fichier) return { refus: `logoFr.sha1 écrit (${l.sha1.slice(0, 10)}) ≠ fichier sur R2 (${sha1Fichier.slice(0, 10)})` };
    const poser = {};
    if (l.region == null) poser.region = 'intl';
    if (l.langue == null) poser.langue = 'fr';
    if (l.sha1 == null) poser.sha1 = sha1Fichier;
    return { poser };
}

module.exports = { planLogoFr };

if (require.main === module) (async () => {
    const ecrire = process.argv.includes('--ecrire');
    const bucket = process.env.R2_BUCKET_IMAGES;
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    if (cx.db.databaseName !== 'cartes') throw new Error(`base « ${cx.db.databaseName} » : cet outil n'écrit que dans « cartes »`);
    await r2.verifierBucket(bucket);
    const S = cx.db.collection('sets');
    const total = await S.countDocuments({});
    const sets = await S.find({ 'logoFr.cleR2': { $type: 'string' } }, { projection: { logoFr: 1, tirage: 1, region: 1, nomAffichage: 1, 'bulba.pageid': 1 } }).toArray();
    console.log(`DÉNOMINATEUR : ${total} sets · ${sets.length} portent logoFr.cleR2 · ${sets.filter(s => s.logoFr.vignette?.cleR2).length} avec vignette · ${sets.filter(s => s.nomAffichage).length} publiés`);
    const plans = [];
    for (const s of sets) {
        let sha1 = null;
        try { sha1 = crypto.createHash('sha1').update(await r2.lireBinaire(bucket, s.logoFr.cleR2)).digest('hex'); } catch (e) { /* illisible : refus dans le plan */ }
        plans.push({ s, sha1, ...planLogoFr(s, sha1) });
    }
    const refus = plans.filter(p => p.refus);
    const aPoser = plans.filter(p => p.poser && Object.keys(p.poser).length);
    const parCle = {}; for (const p of aPoser) for (const k of Object.keys(p.poser)) parCle[k] = (parCle[k] ?? 0) + 1;
    console.log(`PLAN : ${aPoser.length} sets à compléter ${JSON.stringify(parCle)} · ${plans.length - aPoser.length - refus.length} déjà complets · ${refus.length} refusés`);
    for (const p of refus) console.log(`   🔴 ${p.s._id} : ${p.refus}`);
    // les fichiers partagés : le site calcule ses logos génériques sur l'empreinte (lib/visuelSet.ts, empreintesGeneriques)
    const parSha1 = new Map(); for (const p of plans.filter(p => p.sha1)) (parSha1.get(p.sha1) || parSha1.set(p.sha1, []).get(p.sha1)).push(p.s);
    const partages = [...parSha1].filter(([, ss]) => ss.length > 1);
    console.log(`FICHIERS PARTAGÉS : ${partages.length} fichier(s) portés par plusieurs sets${partages.length ? '' : ' — aucun'}`);
    for (const [sha1, ss] of partages) console.log(`   ${sha1.slice(0, 10)} ← ${ss.map(s => `${s._id} (page ${s.bulba?.pageid ?? 'aucune'})`).join(', ')}`);
    if (!ecrire) { console.log('   (mesure seule — --ecrire sous lot-additif.js)'); await fermer(); return; }
    if (refus.length) { console.error('❌ des sets sont refusés : rien n\'est écrit'); await fermer(); process.exit(1); }
    let ecrits = 0;
    for (const p of aPoser) {
        // la condition d'écriture est celle du plan, relue dans la requête : une clé apparue entre-temps n'est pas écrasée
        const filtre = { _id: p.s._id, 'logoFr.cleR2': p.s.logoFr.cleR2 };
        // `null` en filtre trouve la clé absente OU nulle — comme le plan (`== null`), sinon une clé stockée à null ferait échouer à tort
        for (const k of Object.keys(p.poser)) filtre[`logoFr.${k}`] = null;
        const u = await S.updateOne(filtre, { $set: Object.fromEntries(Object.entries(p.poser).map(([k, v]) => [`logoFr.${k}`, v])) });
        if (u.modifiedCount === 1) ecrits++; else console.log(`   ⚠️ ${p.s._id} : non écrit — logoFr a changé depuis le plan`);
    }
    const relus = await S.countDocuments({ 'logoFr.cleR2': { $type: 'string' }, 'logoFr.region': 'intl', 'logoFr.langue': 'fr', 'logoFr.sha1': { $type: 'string' }, 'logoFr.vignette.cleR2': { $type: 'string' } });
    console.log(`${ecrits === aPoser.length ? '✅' : '🔴'} écrits ${ecrits} / ${aPoser.length} · RELU : ${relus} / ${sets.length} logoFr portent cleR2, region intl, langue fr, sha1 et vignette`);
    if (ecrits !== aPoser.length || relus !== sets.length) process.exitCode = 1;
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
