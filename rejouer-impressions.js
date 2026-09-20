// ============================================================
// REJOUER LES IMPRESSIONS DEPUIS LES WIKITEXTS ARCHIVÉS — 0 requête, et jamais une impression en moins
// ============================================================
//   node rejouer-impressions.js            (mesure : gagnées / perdues / déplacées, rien d'écrit)
//   node rejouer-impressions.js --ecrire   (écrit, en REFUSANT toute carte qui perdrait une impression)
//
// 🔑 POURQUOI UN REJEU GLOBAL PLUTÔT QU'UN `--reparser` PAR SET. Une règle de parseur corrigée ne corrige
// AUCUNE ligne déjà écrite (§23), et les cartes touchées par une règle nouvelle sont dispersées dans tous
// les sets — une carte de Trainer Kit est une réimpression, elle vit dans le set d'origine. Rejouer set
// par set coûterait 526 lancements ; rejouer les cartes coûte un passage.
//
// ⚠️ LA GARDE EST LA MESURE ELLE-MÊME. Le rejeu n'écrit que si la carte GAGNE des impressions et n'en
// perd AUCUNE. Une impression qui disparaît est un défaut de parseur, pas un progrès : la carte est
// alors laissée telle quelle et COMPTÉE, pour qu'on la regarde. C'est la forme du §21 bis (le rejeu des
// deux clés de numéro sur les 19 596 images : 0 déplacée, 15 perdues, et les 15 étaient les 15 faux).
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const r2 = require('./collecte-cartes/r2');
const { faitsDeCarte } = require('./collecte-cartes/wikitext');

const cle = i => `${i.tirage}|${i.expansion}|${i.numero ?? ''}|${i.deck ?? ''}`;

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, fermer } = await ouvrirConnexions({ production: false, buckets: [] });
    await r2.verifierBucket(process.env.R2_BUCKET_BRUT);
    const total = await cx.db.collection('cartes').countDocuments({ 'bulba.cleR2': { $nin: [null, ''] } });
    const sans = await cx.db.collection('cartes').countDocuments({ 'bulba.cleR2': { $in: [null, ''] } });
    console.log(`\n════ DÉNOMINATEUR : ${total} cartes ont un wikitext archivé · ${sans} n'en ont pas (rien à rejouer) ════`);

    let vues = 0, identiques = 0, gagnantes = 0, perdantes = 0, illisibles = 0, ecrites = 0;
    let impGagnees = 0, impPerdues = 0;
    const parExpansion = {}, aRegarder = [];
    // ⚠️ PAS DE CURSEUR OUVERT PENDANT UNE HEURE. Un premier jet tenait un `find()` ouvert le temps de lire
    // 15 264 objets R2 : le curseur expire au bout de dix minutes d'inactivité et le processus meurt à
    // mi-parcours (8 000/15 264 le 2026-09-20), **sans un message** — exactement le défaut plausible du §21.
    // On pagine par `_id` : chaque page est une requête courte, et l'outil se reprend là où il en est.
    // `--depuis=<id> --max=<n>` : traiter une TRANCHE et rendre la main en imprimant où l'on s'est arrêté.
    // Un rejeu d'une heure meurt de mille façons (curseur, ordonnanceur, veille) et recommencer à zéro
    // coûte l'heure entière ; une tranche qui finit en quelques minutes se reprend à sa borne.
    const PAGE = 500;
    const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
    const MAX = Number(arg('max') || Infinity);
    let dernier = arg('depuis') ? Number(arg('depuis')) : null;
    if (dernier != null) console.log(`   reprise après l'_id ${dernier}`);
    for (; vues < MAX;) {
        const filtre = { 'bulba.cleR2': { $nin: [null, ''] } };
        if (dernier != null) filtre._id = { $gt: dernier };
        const lot = await cx.db.collection('cartes').find(filtre, { projection: { nomEn: 1, impressions: 1, bulba: 1 } }).sort({ _id: 1 }).limit(PAGE).toArray();
        if (!lot.length) break;
        dernier = lot[lot.length - 1]._id;
        for (const c of lot) {
        vues++;
        if (vues % 2000 === 0) console.log(`   … ${vues}/${total} · gagnantes ${gagnantes} · perdantes ${perdantes} · écrites ${ecrites}`);
        let txt, f;
        try { txt = await r2.lireTexte(process.env.R2_BUCKET_BRUT, c.bulba.cleR2); f = faitsDeCarte(txt, c.bulba?.titre); }
        catch (e) { illisibles++; if (illisibles <= 3) console.warn(`   ⚠️ ${c.nomEn} illisible : ${String(e.message).slice(0, 120)}`); continue; }
        const avant = new Map((c.impressions || []).map(i => [cle(i), i]));
        const apres = new Map((f.impressions || []).map(i => [cle(i), i]));
        const plus = [...apres.keys()].filter(k => !avant.has(k));
        const moins = [...avant.keys()].filter(k => !apres.has(k));
        if (!plus.length && !moins.length) { identiques++; continue; }
        if (moins.length) {
            perdantes++; impPerdues += moins.length;
            if (aRegarder.length < 12) aRegarder.push(`${String(c.nomEn).slice(0, 26).padEnd(26)} − ${JSON.stringify(moins.slice(0, 3))}`);
            continue;                       // 🔴 on n'écrit JAMAIS une carte qui perd une impression
        }
        gagnantes++; impGagnees += plus.length;
        for (const k of plus) { const e = k.split('|')[1]; parExpansion[e] = (parExpansion[e] || 0) + 1; }
        if (ecrire) { await cx.db.collection('cartes').updateOne({ _id: c._id }, { $set: { impressions: f.impressions } }); ecrites++; }
        }
    }
    console.log(`\n   vues ${vues} · identiques ${identiques} · GAGNANTES ${gagnantes} · perdantes ${perdantes} · illisibles ${illisibles}`);
    console.log(`   ✅ impressions gagnées : ${impGagnees}`);
    console.log(`   ${impPerdues ? '🔴' : '✅'} impressions qui auraient été perdues : ${impPerdues} — ces cartes ne sont PAS écrites`);
    for (const x of aRegarder) console.log(`      ${x}`);
    console.log(`\n   par expansion gagnée (20 premières) :`);
    for (const [k, v] of Object.entries(parExpansion).sort((a, b) => b[1] - a[1]).slice(0, 20)) console.log(`      ${String(v).padStart(5)} — ${k}`);
    console.log(ecrire ? `\n   ÉCRITES : ${ecrites} cartes` : `\n   (mesure seule — relancer avec --ecrire)`);
    console.log(`   REPRISE : --depuis=${dernier ?? ''}${vues >= MAX ? '  (tranche finie, il en reste)' : '  (tout vu)'}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
