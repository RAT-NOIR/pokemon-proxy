// MESURE EN LECTURE SEULE (aucune requête vers Bulbapedia ; lecture de NOTRE R2 d'images et de la base) :
// parmi les logos « Bulbapedia seule » de la table (OFFICIEL ou À REGARDER promus), le fichier du candidat est-il octet pour octet celui que nous avons DÉJÀ
// archivé comme `sets.logo` (collecter-logos-sets.js, 2026-09-26) ? Comparaison du sha256 de l'objet R2 à `ligne.cache.sha256` (le fichier que la phase 1 a comparé).
//   node mesure-bulba-logos-deja-chez-nous.js
require('dotenv').config();
const crypto = require('crypto');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const M = require('./collecter-logos-officiels');
const table = require('./collecte-cartes/logos-officiels-table.json');
(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: ['R2_BUCKET_IMAGES'] });
    await r2.verifierBucket(process.env.R2_BUCKET_IMAGES);
    const S = cx.db.collection('sets');
    const sets = new Map((await S.find({}, { projection: { tirage: 1, region: 1, nomJa: 1, code: 1 } }).toArray()).map(s => [s._id, s]));
    const lignes = [];
    for (const l of table.lignes) {
        if (l.verdict === 'OFFICIEL' && (l.bulbapediaSeule || l.source === 'bulbapedia')) lignes.push({ ...l, origine: 'OFFICIEL' });
        if (l.verdict === 'À REGARDER' && l.source === 'bulbapedia') lignes.push({ ...l, origine: 'À REGARDER' });
    }
    console.log(`DÉNOMINATEUR : ${lignes.length} lignes Bulbapedia (${lignes.filter(l => l.origine === 'OFFICIEL').length} OFFICIEL, ${lignes.filter(l => l.origine !== 'OFFICIEL').length} À REGARDER)`);
    const res = { identique: 0, different: 0, 'set sans logo': 0, 'set non identifié': 0 };
    const rows = [];
    for (const l of lignes) {
        let setId = l.set;
        if (l.origine === 'À REGARDER') { const p = M.promouvoir(l, sets); setId = p.ligne?.set ?? l.set; }
        if (!setId) { res['set non identifié']++; rows.push(`${l.part} ${l.fichier} | set ∅`); continue; }
        const d = await S.findOne({ _id: setId }, { projection: { 'logo.cleR2': 1, 'logo.fichier': 1, 'logo.source': 1, logoOfficiel: 1 } });
        if (!d?.logo?.cleR2) { res['set sans logo']++; rows.push(`${l.part} ${l.fichier} | ${setId} | pas de sets.logo`); continue; }
        const buf = await r2.lireBinaire(process.env.R2_BUCKET_IMAGES, d.logo.cleR2);
        const sha = crypto.createHash('sha256').update(buf).digest('hex');
        const egal = sha === l.cache?.sha256;
        res[egal ? 'identique' : 'different']++;
        rows.push(`${l.part} ${l.fichier.replace(/^Logo (JP|FR)\//, '')} | ${setId} | sets.logo « ${d.logo.fichier} » (${d.logo.source}) | ${egal ? 'IDENTIQUE au candidat' : `différent (R2 ${sha.slice(0, 8)} / candidat ${String(l.cache?.sha256).slice(0, 8)})`}`);
    }
    console.log(JSON.stringify(res));
    console.log(rows.join('\n'));
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
