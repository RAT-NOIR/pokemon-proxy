// ============================================================
// VÉRIFIER LES IMPRESSIONS « numero-cardmarket » APRÈS ÉCRITURE — les trois risques de la relecture du 2026-10-06 (lecture seule)
// ============================================================
//   node verifier-impressions-par-numero.js
// Pour chaque carte qui porte une impression `source: 'numero-cardmarket'`, et pour CHAQUE set de la carte où le site la montre (même
// tirage, même nom d'expansion — la règle trouverImpressionDuSet, un set et ses Additionals compris) :
//   1. DOUBLON : deux impressions de la carte au même numéro au sens du site (numeroComparable) dans ce tirage et cette expansion ;
//   2. PRODUIT SANS FICHE : un produit de la carte dans ce set dont numeroFiche n'est aucune fiche (le site ne le montre nulle part), ou
//      dont numeroFiche est nul alors que le document a désormais plusieurs fiches (le site lit alors le slug — compté à part, à regarder) ;
//   3. IMAGE ORPHELINE : une image de la carte pour ce set dont le numéro (normaliserNumero) n'est aucune fiche — elle ne s'affiche plus.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { numeroComparable, normaliserNumero } = require('./mesurer-fiches-melangees');
(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions({ buckets: [], production: false });
    const sets = new Map((await cx.db.collection('sets').find({}, { projection: { tirage: 1, region: 1, 'bulba.expansion': 1 } }).toArray()).map(s => [s._id, s]));
    const cartes = await cx.db.collection('cartes').find({ 'impressions.source': 'numero-cardmarket' }, { projection: { nomEn: 1, impressions: 1, sets: 1, 'images.set': 1, 'images.numero': 1 } }).toArray();
    const lignes = await cx.db.collection('cartes_produits').find({ carteId: { $in: cartes.map(c => c._id) } }, { projection: { carteId: 1, idProduct: 1, slugSet: 1, numeroFiche: 1 } }).toArray();
    console.log(`\n════ DÉNOMINATEUR : ${cartes.length} cartes à impression « numero-cardmarket » · ${lignes.length} lignes de jointure de ces cartes ════`);
    const r = { doublons: [], sansFiche: [], nulMultiFiches: [], imagesOrphelines: [], setsVus: 0, setsAutres: [] };
    for (const c of cartes) {
        const nc = c.impressions.filter(i => i.source === 'numero-cardmarket');
        const setsDeLaCarte = [...new Set([...(c.sets || []), ...lignes.filter(l => l.carteId === c._id).map(l => l.slugSet)])];
        for (const slug of setsDeLaCarte) {
            const s = sets.get(slug); if (!s) continue;
            const tirage = s.tirage ?? s.region, exps = [].concat(s.bulba?.expansion ?? null);
            if (!nc.some(i => i.tirage === tirage && exps.includes(i.expansion))) continue;
            r.setsVus++;
            const imps = c.impressions.filter(i => i.tirage === tirage && exps.includes(i.expansion));
            const vus = new Map();
            for (const i of imps) { const k = numeroComparable(i.numero); vus.set(k, (vus.get(k) || 0) + 1); }
            for (const [k, n] of vus) if (n > 1) r.doublons.push(`${slug} · ${c._id} « ${c.nomEn} » n°${k} ×${n}`);
            const fiches = new Set([...vus.keys()]);
            const ps = lignes.filter(l => l.carteId === c._id && l.slugSet === slug);
            for (const p of ps) {
                if (p.numeroFiche != null && p.numeroFiche !== '' && !fiches.has(numeroComparable(p.numeroFiche))) r.sansFiche.push(`${slug} · ${c._id} « ${c.nomEn} » produit ${p.idProduct} numeroFiche ${p.numeroFiche} · fiches [${[...fiches].join(', ')}]`);
                else if ((p.numeroFiche == null || p.numeroFiche === '') && fiches.size > 1) r.nulMultiFiches.push(`${slug} · ${c._id} « ${c.nomEn} » produit ${p.idProduct}`);
            }
            const fichesImg = new Set(imps.map(i => normaliserNumero(i.numero)));
            for (const im of (c.images || []).filter(m => m.set === slug)) {
                const n = normaliserNumero(im.numero);
                if (n !== null && !fichesImg.has(n)) r.imagesOrphelines.push(`${slug} · ${c._id} « ${c.nomEn} » image n°${im.numero} · fiches [${[...fichesImg].join(', ')}]`);
            }
        }
    }
    for (const [nom, t] of [['1. doublons', r.doublons], ['2. produits sans fiche (numeroFiche hors des fiches)', r.sansFiche], ['2bis. produits à numeroFiche nul sur un document à plusieurs fiches (le site lit le slug)', r.nulMultiFiches], ['3. images orphelines', r.imagesOrphelines]]) {
        console.log(`\n${nom} : ${t.length}`);
        for (const x of t.slice(0, 12)) console.log(`   ${x}`);
    }
    console.log(`\n(sets examinés : ${r.setsVus})`);
    await fermer();
})().catch(e => { console.error('❌', e.message); process.exit(1); });
