'use strict';
// LECTURE SEULE : rejoue `documentAmbigu` du site (règle importée) sur l'état ACTUEL de la base `cartes` — quels documents sont ambigus aujourd'hui, dans quels sets.
//   node controle-ambiguite-site.js            (aucune écriture ; ouvre la base en lecture seule comme lot-additif.js)
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '.env') });
if (!process.env.MONGODB_CARTES_URI) dotenv.config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env' });
const GA = require('./collecte-cartes/garde-ambiguite-site');
const { PROJECTION_ETAT } = require('./collecte-cartes/garde-lot');
(async () => {
    const t0 = Date.now();
    const regle = await GA.chargerRegleAmbiguite();
    const { ouvrirConnexions } = require('./collecte-cartes/garde');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [], lectureSeule: true });
    try {
        const cartes = await cx.db.collection('cartes').find({}).project({ ...PROJECTION_ETAT.cartes }).toArray();
        const sets = await cx.db.collection('sets').find({}).toArray();
        const t1 = Date.now();
        const slugs = sets.map(s => s._id);
        const etat = GA.etatAmbiguite({ cartes, sets }, slugs, regle);
        const t2 = Date.now();
        const ambigus = [...etat].filter(([, e]) => e.ambigus.length);
        const parImp = [...etat.values()].filter(e => e.parImpression).length;
        console.log(`lecture ${t1 - t0} ms · rejeu de la règle sur ${etat.size} sets (${cartes.length} cartes) : ${t2 - t1} ms`);
        console.log(`sets « par impression » : ${parImp} · sets avec au moins un document ambigu : ${ambigus.length} · documents ambigus : ${ambigus.reduce((n, [, e]) => n + e.ambigus.length, 0)}`);
        const nom = new Map(cartes.map(c => [c._id, c.nomEn]));
        for (const [slug, e] of ambigus) console.log(`  ${slug} : ${e.ambigus.length} sur ${e.documents} — ${e.ambigus.slice(0, 8).map(id => `${id} ${nom.get(id)}`).join(' ; ')}${e.ambigus.length > 8 ? ' ; …' : ''}`);
    } finally { await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exit(1); });
