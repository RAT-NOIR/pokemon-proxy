// ============================================================
// RETIRER LE LOT DES LOGOS OFFICIELS — d'un geste, exactement ce lot (champs `sets.logoOfficiel.*` du lot + objets R2 + vignettes)
// ============================================================
//   node retirer-logos-officiels.js                       (SIMULATION : liste les sets et les clés, ne retire rien)
//   node retirer-logos-officiels.js --ecrire              (retire : une SUPPRESSION, donc feu vert nommé du testeur + sauvegarde `backup-collections.js --base=cartes --collections=sets` avant)
// Un logoOfficiel d'un AUTRE lot, et tous les champs existants du set (logo, logoFr, logoCompose…), ne sont jamais touchés ; une clé hors du préfixe
// `logos-officiels/` ou `vignettes/logos-officiels/` arrête tout (collecter-logos-officiels.js : retirerLot).
require('dotenv').config();
const { LOT, LOT_SEMI, retirerLot } = require('./collecter-logos-officiels');
const AUTORISES = [/^--ecrire$/, /^--lot=[\w.-]+$/, /^--semi-officiel$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisés : --ecrire, --lot=, --semi-officiel (le champ logoSemiOfficiel, lot ${LOT_SEMI} par défaut)`); process.exit(2); }
const ECRIRE = process.argv.includes('--ecrire');
const SEMI = process.argv.includes('--semi-officiel');
const racine = SEMI ? 'logoSemiOfficiel' : 'logoOfficiel';
const lot = process.argv.find(a => a.startsWith('--lot='))?.slice(6) || (SEMI ? LOT_SEMI : LOT);
(async () => {
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const cx = await ouvrirConnexions({ production: false, buckets: ECRIRE ? ['R2_BUCKET_IMAGES'] : [] });
    const S = cx.cartes.db.collection('sets');
    console.log(`DÉNOMINATEUR : ${await S.countDocuments({})} sets en base · lot ${lot}`);
    const r2 = require('./collecte-cartes/r2'), bucket = process.env.R2_BUCKET_IMAGES;
    if (ECRIRE) await r2.verifierBucket(bucket);
    const r = await retirerLot({ S, r2, bucket, lot, racine, ecrire: ECRIRE });
    console.log(`${ECRIRE ? 'RETIRÉ' : 'SIMULATION'} : ${r.sets.length} sets · ${r.cles.length} objets R2`);
    if (ECRIRE) console.log(`RELU : ${await S.countDocuments({ $or: ['fr', 'ja', 'en'].map(c => ({ [`${racine}.${c}.lot`]: lot })) })} sets portent encore ce lot`);
    await cx.fermer();
})().catch(e => { console.error(e); process.exit(1); });
