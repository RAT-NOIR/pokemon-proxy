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
    // --par-set : les lignes que la base ne sert pas, par EXPANSION du produit rendu (ou de la
    // vérité saisie si elle existe). C'est le chiffre qui dit quoi collecter ENSUITE.
    const nonServies = [];
    for (const d of lignes) {
        if (d.sourcePont != null) {
            c.apresCablage++;
            if (d.sourcePont === 'base-cartes') c.base++; else { c.tcgdexApres++; nonServies.push({ d, raison: 'tcgdex-apres-cablage' }); }
            continue;
        }
        c.avantCablage++;
        const regionJaponaise = ASIATIQUES.includes(String(d.langue || '').toUpperCase());
        const compat = setCodeCompatibleVintage(d.setCode, SCORING, codesReels);
        if (!regionJaponaise || compat.compatible !== true) { c.horsGarde++; c.tcgdexAurait++; nonServies.push({ d, raison: regionJaponaise ? 'setCode-incompatible' : 'region-non-japonaise' }); continue; }
        const p = await interrogerPont({ nom: d.nom, nomBrut: d.nomBrut, numero: d.numero, total: d.total, setCode: d.setCode, attaqueLue: d.attaqueLue ?? null, langue: d.langue }, { regionJaponaise: true, setCodeCompatible: true });
        if (p.source === 'base-cartes' && p.produits.length) c.baseAurait++; else { c.tcgdexAurait++; nonServies.push({ d, raison: 'base-sans-carte' }); }
        // TCGdex « utile » = il a rendu une carte ET du routage de motifs — ce que la base ne rend pas
        if (d.carteTcgdexId && Number.isFinite(d.variantsDetailedNb) && d.variantsDetailedNb > 0) c.tcgdexUtile++;
    }
    if (process.argv.includes('--par-set')) {
        const CP = mongoose.connection.db.collection('catalogue_produits');
        const CS = mongoose.connection.db.collection('codes_set');
        const NC = mongoose.connection.db.collection('numeros_cartes');
        let verites = {};
        try { verites = require('./banc-verites.json').verites || {}; } catch (_) { }
        const { identiteDe } = require('./banc-seaux');
        const veriteParIdentite = new Map(Object.values(verites).filter(v => v.lu && typeof v.idProduct === 'number').map(v => [identiteDe(v.lu), v.idProduct]));
        const parExp = new Map(); let sansProduit = 0;
        for (const { d, raison } of nonServies) {
            const id = veriteParIdentite.get(identiteDe(d)) ?? d.idProduct ?? null;
            if (id == null) { sansProduit++; continue; }
            const p = await CP.findOne({ idProduct: id }, { projection: { idExpansion: 1 } });
            const e = p?.idExpansion ?? null;
            if (e == null) { sansProduit++; continue; }
            if (!parExp.has(e)) parExp.set(e, { n: 0, raisons: {} });
            const x = parExp.get(e); x.n++; x.raisons[raison] = (x.raisons[raison] || 0) + 1;
        }
        const exps = [...parExp.keys()];
        const codes = new Map((await CS.find({ idExpansion: { $in: exps } }).project({ idExpansion: 1, codeSet: 1, region: 1 }).toArray()).map(x => [x.idExpansion, x]));
        const slugs = new Map((await NC.aggregate([{ $match: { idExpansion: { $in: exps } } }, { $group: { _id: '$idExpansion', slug: { $first: '$slugSet' }, produits: { $sum: 1 } } }]).toArray()).map(x => [x._id, x]));
        const tri = [...parExp.entries()].sort((a, b) => b[1].n - a[1].n);
        console.log(`\n--par-set : ${nonServies.length} lignes non servies par la base, ${nonServies.length - sansProduit} avec un produit (vérité ou rendu), ${sansProduit} sans produit (refus) ; ${tri.length} expansions`);
        let cumul = 0;
        for (const [e, x] of tri) {
            cumul += x.n;
            const cs = codes.get(e), s = slugs.get(e);
            console.log(`   ${String(cs?.codeSet || '?').padEnd(8)} exp ${String(e).padEnd(5)} ${String(cs?.region || 'région ?').padEnd(10)} ${String(s?.slug || '?').padEnd(36)} ${String(s?.produits ?? '?').padStart(4)} produits · lignes ${String(x.n).padStart(3)} · cumul ${String(cumul).padStart(3)} · ${Object.entries(x.raisons).map(([k, v]) => `${k} ${v}`).join(', ')}`);
        }
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
