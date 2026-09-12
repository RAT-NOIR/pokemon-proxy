// ============================================================
// LE COMPTEUR DU PONT — lisible en une commande, sur les N derniers scans
// ============================================================
//   node compteur-pont.js [--n=500]
//
// Combien d'appels TCGdex sur les N dernières lignes du journal, combien la base a servis (lignes
// postérieures au câblage : `sourcePont`), et combien elle AURAIT servis (lignes antérieures :
// rejeu de `interrogerPont` sur ce qui a été lu — aucune requête réseau, la base seule).
// C'est le compteur du critère de bascule (SPEC-PONT.md §5) : TCGdex disparaît quand, sur les
// N derniers scans, sa part utile passe sous le seuil, deux lots de suite.

require('dotenv').config();
const mongoose = require('mongoose');
const { interrogerPont } = require('./pont-cartes');
const SCORING = require('./scoring');
const { setCodeCompatibleVintage } = require('./sets-vintage-japonais');

const n = Number((process.argv.find(a => a.startsWith('--n=')) || '').slice(4)) || 500;
const ASIATIQUES = ['JP', 'ZH', 'KR', 'ZH-CN', 'ZH-TW', 'CN', 'TW'];

(async () => {
    await mongoose.connect(process.env.MONGODB_URI, { dbName: 'test' });
    const J = mongoose.connection.db.collection('journal_scans');
    const codesReels = (await mongoose.connection.db.collection('codes_set').find({}).project({ codeSet: 1 }).toArray()).map(c => c.codeSet).filter(Boolean);
    const lignes = await J.find({}).sort({ le: -1 }).limit(n).toArray();
    const c = { total: lignes.length, apresCablage: 0, base: 0, tcgdexApres: 0, avantCablage: 0, baseAurait: 0, tcgdexAurait: 0, horsGarde: 0, tcgdexUtile: 0 };
    for (const d of lignes) {
        if (d.sourcePont != null) {
            c.apresCablage++;
            if (d.sourcePont === 'base-cartes') c.base++; else c.tcgdexApres++;
            continue;
        }
        c.avantCablage++;
        const regionJaponaise = ASIATIQUES.includes(String(d.langue || '').toUpperCase());
        const compat = setCodeCompatibleVintage(d.setCode, SCORING, codesReels);
        if (!regionJaponaise || compat.compatible !== true) { c.horsGarde++; c.tcgdexAurait++; continue; }
        const p = await interrogerPont({ nom: d.nom, nomBrut: d.nomBrut, numero: d.numero, total: d.total, setCode: d.setCode, attaqueLue: d.attaqueLue ?? null, langue: d.langue }, { regionJaponaise: true, setCodeCompatible: true });
        if (p.source === 'base-cartes' && p.produits.length) c.baseAurait++; else c.tcgdexAurait++;
        // TCGdex « utile » = il a rendu une carte ET du routage de motifs — ce que la base ne rend pas
        if (d.carteTcgdexId && Number.isFinite(d.variantsDetailedNb) && d.variantsDetailedNb > 0) c.tcgdexUtile++;
    }
    console.log(`dénominateur : ${c.total} dernières lignes du journal`);
    console.log(`  après câblage : ${c.apresCablage} — base ${c.base}, TCGdex ${c.tcgdexApres}`);
    console.log(`  avant câblage : ${c.avantCablage} — la base AURAIT servi ${c.baseAurait}, TCGdex ${c.tcgdexAurait} (dont hors garde amont ${c.horsGarde})`);
    console.log(`  TCGdex utile (carte + motifs routables) sur les lignes anciennes : ${c.tcgdexUtile}`);
    const servies = c.base + c.baseAurait, appels = c.tcgdexApres + c.tcgdexAurait;
    console.log(`  → part servie par la base : ${servies} / ${c.total} (${(100 * servies / Math.max(1, c.total)).toFixed(1)} %) · appels TCGdex : ${appels} (${(100 * appels / Math.max(1, c.total)).toFixed(1)} %)`);
    await mongoose.disconnect();
    process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
