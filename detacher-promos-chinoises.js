// ============================================================
// DÉTACHER LES PROMOS CHINOISES MAL JOINTES PAR LE NOM — Scarlet-Violet-Simplified-Chinese-Promos (exp 6328), liste FERMÉE de 8 lignes
// ============================================================
//   node detacher-promos-chinoises.js --annonce=<fichier.json>    (simulation : rejuge chaque ligne, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="…" --collections=restes --annonce=<fichier.json> -- node detacher-promos-chinoises.js --ecrire
//
// FEU VERT DU TESTEUR (2026-10-06) : « détacher les promos chinoises mal jointes par le nom (sous la garde, avec la liste) ».
// LA MESURE (2026-10-07, lecture seule) : les 241 lignes du set sont TOUTES jointes par le nom (setlist+nom 85, setlist+nom+attaques 156).
// Jugées par la MÉTACARTE Cardmarket — les autres produits de la même métacarte, joints par une preuve qui N'EST PAS le nom (64 302 lignes
// de la base) : 211 confirmées, 22 où le témoin se contredit (Dresseurs et Énergies : Switch, Super Rod… — rien n'est décidé), 8 contredites.
// Sur les 8, le témoin des ATTAQUES dit la même chose : aucune attaque que Cardmarket écrit entre crochets n'est sur la carte jointe
// (« Sprigatito [Mini Drain] » joint à Paldea Evolved 12 [Gather Sunlight | Seed Bomb] ; la métacarte désigne SVP Promo 1).
// La liste est FERMÉE : l'outil ne décide pas ce qui est faux, il applique la décision prise sur cette preuve, et la REJOUE à l'écriture —
// les DEUX témoins, indépendants du nom qui a fabriqué la ligne. Si une seule ligne ne se rejuge plus contredite, rien n'est écrit.
// Ce qui est écrit : la ligne de jointure retirée, l'idProduct retiré des liens de la carte, un reste « fiche-contredite-par-la-metacarte »
// pour le produit resté sans ligne. `cartes.sets` n'est PAS touché (la carte peut être listée par la Setlist pour un autre produit — même
// geste que detacher-lignes-prouvees.js et temoin-nom.js).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { decomposerNomCardmarket, normaliserNom } = require('./collecte-cartes/jointure');

const SET = 'Scarlet-Violet-Simplified-Chinese-Promos';
// [ligne, produit à la mesure, carte que la métacarte désigne]
const LIGNES = [
    ['282785|851922', 'Bulbasaur [Vine Whip]', 283753],
    ['282785|851925', 'Bulbasaur [Vine Whip]', 283753],
    ['281226|877613', 'Sprigatito [Mini Drain]', 279454],
    ['281265|877615', 'Quaxly [Water Splash]', 279457],
    ['280460|877628', 'Pachirisu [Crackling Charge | Tiny Bolt]', 303318],
    ['321396|889497', 'Kecleon [Stealth Attack]', 323672],
    ['329616|897897', 'Yanmega [Gyro Shockwave]', 317499],
    ['286155|877640', 'Kangaskhan [Call for Family | Mega Punch]', 321258]
];
const PAR_NOM = p => /(^|\+)nom/.test(p || '');
// (relecture) un témoin s'écrit par ce qu'il AUTORISE : une ligne sans preuve écrite n'est pas « hors nom », elle est inconnue
const HORS_NOM = p => typeof p === 'string' && p.length > 0 && !PAR_NOM(p);

const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const ecrire = process.argv.includes('--ecrire');
const annonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
if (inconnus.length || ecrire === !!annonce) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --annonce=<fichier.json> (simulation) | --ecrire`); process.exit(2); }

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const L = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes');
    const lignes = await L.find({ _id: { $in: LIGNES.map(x => x[0]) } }).toArray();
    const parId = new Map(lignes.map(l => [l._id, l]));
    const ids = LIGNES.map(x => Number(x[0].split('|')[1]));
    const cat = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, name: 1, idMetacard: 1 } }).toArray()).map(p => [p.idProduct, p]));
    // le témoin de la métacarte : les produits de la même métacarte, dans le catalogue de production, et leurs lignes HORS preuve par le nom
    const metas = [...new Set([...cat.values()].map(p => p.idMetacard).filter(m => m != null))];
    const freres = await prod.db.collection('catalogue_produits').find({ idMetacard: { $in: metas } }, { projection: { idProduct: 1, idMetacard: 1 } }).toArray();
    const lignesFreres = await L.find({ idProduct: { $in: freres.map(f => f.idProduct) } }, { projection: { idProduct: 1, carteId: 1, preuve: 1 } }).toArray();
    const metaDe = new Map(freres.map(f => [f.idProduct, f.idMetacard]));
    const toutes = await L.find({ idProduct: { $in: ids } }).toArray();
    console.log(`\n════ ${LIGNES.length} lignes nommées · ${lignes.length} trouvées en base · ${metas.length} métacartes · ${freres.length} produits frères · ${lignesFreres.length} de leurs lignes ════`);
    const fautes = [], plan = [];
    for (const [id, attendu, autre] of LIGNES) {
        const l = parId.get(id);
        if (!l) { fautes.push(`${id} : absente de la base`); continue; }
        if (l.slugSet !== SET || !PAR_NOM(l.preuve)) { fautes.push(`${id} : ${l.slugSet} / ${l.preuve} — pas une ligne de ce set jointe par le nom`); continue; }
        const p = cat.get(l.idProduct);
        if (!p?.name || p.idMetacard == null) { fautes.push(`${id} : produit sans nom ou sans métacarte au catalogue`); continue; }
        // témoin 1 : la métacarte, hors preuve par le nom, désigne UNE carte, et pas celle de la ligne
        const temoins = new Set(lignesFreres.filter(x => x.idProduct !== l.idProduct && metaDe.get(x.idProduct) === p.idMetacard && HORS_NOM(x.preuve)).map(x => x.carteId));
        const t1 = temoins.size === 1 && !temoins.has(l.carteId) && temoins.has(autre);
        // témoin 2 : aucune attaque entre crochets n'est sur la carte jointe
        const d = decomposerNomCardmarket(p.name);
        const att = d.attaques.map(normaliserNom).filter(Boolean);
        const notre = await C.findOne({ _id: l.carteId }, { projection: { nomEn: 1, attaques: 1, 'bulba.titre': 1 } });
        const sur = (notre?.attaques || []).map(a => normaliserNom(a.nom));
        const t2 = att.length > 0 && !att.some(a => sur.includes(a));
        const verdict = t1 && t2 ? `métacarte ${p.idMetacard} → ${[...temoins][0]} (hors nom) ; attaques [${d.attaques.join(' | ')}] absentes de « ${notre?.bulba?.titre ?? notre?.nomEn} » [${(notre?.attaques || []).map(a => a.nom).join(' | ')}]` : null;
        if (!verdict) fautes.push(`${id} « ${p.name} » : ne se rejuge plus contredite (métacarte ${[...temoins].join(',') || '—'}, attaques ${t2 ? 'absentes' : 'présentes ou aucune'})`);
        else plan.push({ l, nom: p.name, verdict, autres: toutes.filter(t => t.idProduct === l.idProduct && t._id !== l._id).length });
        console.log(`   ${verdict ? '✅' : '🔴'} ${id} « ${p.name} »${p.name !== attendu ? ` (mesuré « ${attendu} »)` : ''} → ${verdict ?? 'NON CONTREDITE'}`);
    }
    if (fautes.length) { console.error(`\n🔴 ${fautes.length} ligne(s) ne se rejugent pas comme à la mesure — RIEN n'est écrit :\n   ${fautes.join('\n   ')}`); await fermer(); process.exitCode = 1; return; }

    const avant = await L.find({ idExpansion: { $in: [...new Set(lignes.map(l => l.idExpansion))] } }).project({ idExpansion: 1, idProduct: 1 }).toArray();
    const retirees = new Set(plan.map(p => p.l._id));
    const cmp = comparer(compterEtat({ cartesProduits: avant }), compterEtat({ cartesProduits: avant.filter(l => !retirees.has(l._id)) }));
    const baisses = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    console.log(`   baisses que la garde verra : ${Object.entries(baisses).map(([k, v]) => `${k} −${v}`).join(' ; ') || 'aucune'}`);
    if (!ecrire) {
        fs.writeFileSync(path.resolve(annonce), JSON.stringify(baisses, null, 1));
        console.log(`   annonce écrite : ${annonce}\n   (simulation — rien n'est écrit en base)`);
        await fermer(); return;
    }
    const r = await L.deleteMany({ _id: { $in: plan.map(p => p.l._id) } });
    for (const p of plan) await C.updateOne({ _id: p.l.carteId }, { $pull: { 'liens.idProduct': p.l.idProduct } });
    let restes = 0;
    for (const p of plan.filter(p => !p.autres)) {
        restes++;
        await cx.db.collection('restes').updateOne({ set: SET, type: 'fiche-contredite-par-la-metacarte', idProduct: p.l.idProduct, carteId: p.l.carteId },
            { $set: { detail: `${p.l.idProduct} « ${p.nom} » : joint par ${p.l.preuve} à ${p.l.carteId} — ${p.verdict} ; détachée par detacher-promos-chinoises.js (feu vert du testeur, 2026-10-06)`, le: new Date() } }, { upsert: true });
    }
    const encore = await L.countDocuments({ _id: { $in: plan.map(p => p.l._id) } });
    console.log(`\n   ✅ détachées : ${r.deletedCount} (attendu ${plan.length}) · encore présentes : ${encore} · restes écrits : ${restes}`);
    await fermer();
    if (r.deletedCount !== plan.length || encore) process.exitCode = 1;
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
