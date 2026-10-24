// PHASE 3a — la table « nom japonais → noms anglais » de NOS cartes (vraies pages seulement), en lecture seule, pour lire les fiches d'une source japonaise (pokemon-card.com) comme une seconde source.
//   node lancer-a-blanc.js exporter-nomja.js --sortie=<fichier>.json
// Même normalisation que la preuve de production (tpc.js : nomCompare, NFKC et ponctuation). Un nom japonais qui désigne PLUSIEURS noms anglais est gardé avec tous (le jugement exige alors qu'un seul concorde).
const fs = require('fs');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const T = require('./collecte-cartes/tpc');
const SORTIE = (process.argv.find(a => a.startsWith('--sortie=')) || '').slice(9);
if (!/\.json$/.test(SORTIE)) { console.error('❌ --sortie=<fichier>.json obligatoire'); process.exit(2); }
(async () => {
    const { cartes, fermer } = await ouvrirConnexions({ production: false });
    try {
        const docs = await cartes.db.collection('cartes').find({ nomJa: { $type: 'string' }, nomEn: { $type: 'string' }, _id: { $gt: 0 } }).project({ nomEn: 1, nomJa: 1 }).toArray();
        if (!docs.length) throw new Error('aucune carte à nomJa : la table serait vide (§41)');
        const m = {};
        for (const c of docs) { const k = T.nomCompare(c.nomJa); if (!k) continue; (m[k] ||= new Set()).add(c.nomEn); }
        const out = Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v].sort()]));
        fs.writeFileSync(SORTIE, JSON.stringify(out));
        console.log(`   ${docs.length} cartes à nomJa → ${Object.keys(out).length} noms japonais, dont ${Object.values(out).filter(v => v.length > 1).length} à plusieurs noms anglais`);
    } finally { await fermer(); }
})().catch(e => { console.error(`❌ ${e.message}`); process.exit(1); });
