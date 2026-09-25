// ============================================================
// DÉTACHER DES LIGNES DE JOINTURE PROUVÉES FAUSSES — nommées une à une, rejugées au moment d'écrire
// ============================================================
//   node detacher-lignes-prouvees.js --annonce=<fichier.json>    (simulation : rejuge chaque ligne, écrit l'annonce des baisses)
//   node lot-additif.js --quoi="…" --collections=restes --annonce=<fichier.json> -- node detacher-lignes-prouvees.js --ecrire
//
// FEU VERT DU TESTEUR (2026-09-25, soir) : « détacher uniquement les 3 lignes prouvées (Alolan Sandslash SM18, Volcanion,
// Exeggutor H10) » et « Aquapolis : détache les 24 homonymes croisés » — Exeggutor H10 est l'un des 24 : 26 lignes en tout.
// La liste est FERMÉE : un outil de détachement ne décide pas ce qui est faux, il applique une décision prise sur une preuve.
// 🔑 Et la preuve se REJOUE à l'écriture : si une seule ligne n'est plus contredite par son témoin (la base a bougé depuis la
// mesure), rien n'est écrit. Deux témoins, tous deux indépendants de la clé par le numéro qui a fabriqué la ligne :
//   · `attaques` : les attaques que Cardmarket écrit entre crochets désignent une AUTRE carte (score strictement supérieur) ;
//   · `nom`      : le nom du produit n'est pas le nom de la carte (« Volcanion » joint à Volcanion-EX).
// Les 24 d'Aquapolis ont été écrites le 20/09 par le bonus « jumeau » des sets e-Card japonais, avant que le témoin n'entre
// dans joindre() ; rejoué avec la jointure d'aujourd'hui (2026-09-25), le bonus ne les refait pas (190 lignes justes, 0 croisée).
// Un produit qui garde une autre ligne ne reçoit pas de reste ; un produit qui n'en garde aucune reçoit le reste de sa preuve.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
const { decomposerNomCardmarket, normaliserNom } = require('./collecte-cartes/jointure');

// `autre` : la carte que le témoin désigne à la place (attaques). Pour Aquapolis, c'est la carte de la ligne juste du même
// produit (slugSet « Aquapolis »), lue en base à l'exécution.
const AQUAPOLIS = ['41765|275087', '42177|275187', '42198|275191', '42499|275161', '42684|275125', '43524|275135', '43556|275137',
    '43558|275139', '48556|275193', '41499|275086', '41938|275165', '42500|275160', '41494|275085', '41517|275092', '41807|275093',
    '41926|275141', '41993|275182', '42269|275117', '42297|275144', '42298|275143', '42497|275159', '42498|275158', '43324|275130',
    '41764|275051'];
const LIGNES = [
    { id: '221206|358427', preuve: 'attaques', autre: 228226, type: 'fiche-contredite-par-les-attaques',
        pourquoi: 'Alolan Sandslash SM18 : les attaques du produit désignent le document 228226 (TCGdex smp-SM127), pas 221206' },
    { id: '213157|553958', preuve: 'nom', type: 'fiche-contredite-par-le-nom',
        pourquoi: 'produit « Volcanion » joint à Volcanion-EX (TCGdex désigne deux autres documents Volcanion)' },
    ...AQUAPOLIS.map(id => ({ id, preuve: 'attaques', autre: 'aquapolis', type: 'fiche-contredite-par-les-attaques',
        pourquoi: 'homonyme croisé d\'Aquapolis (bonus jumeau du 20/09) : les attaques désignent la carte de la ligne Aquapolis' }))
];

const AUTORISES = [/^--ecrire$/, /^--annonce=.+\.json$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
const ecrire = process.argv.includes('--ecrire');
const annonce = process.argv.find(a => a.startsWith('--annonce='))?.slice(10);
if (inconnus.length || ecrire === !!annonce) { console.error(`❌ ${inconnus.length ? `argument inconnu : ${inconnus.join(' ')} — ` : ''}usage : --annonce=<fichier.json> (simulation) | --ecrire`); process.exit(2); }

(async () => {
    const { cartes: cx, prod, fermer } = await ouvrirConnexions({ production: true, buckets: [] });
    const L = cx.db.collection('cartes_produits'), C = cx.db.collection('cartes');
    const lignes = await L.find({ _id: { $in: LIGNES.map(x => x.id) } }).toArray();
    const parId = new Map(lignes.map(l => [l._id, l]));
    const ids = [...new Set(lignes.map(l => l.idProduct))];
    const nomCat = new Map((await prod.db.collection('catalogue_produits').find({ idProduct: { $in: ids } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name]));
    const toutes = await L.find({ idProduct: { $in: ids } }).toArray();
    console.log(`\n════ ${LIGNES.length} lignes nommées · ${lignes.length} trouvées en base · ${ids.length} produits · ${toutes.length} lignes de ces produits ════`);
    const fautes = [], plan = [];
    for (const x of LIGNES) {
        const l = parId.get(x.id);
        if (!l) { fautes.push(`${x.id} : absente de la base`); continue; }
        const nom = nomCat.get(l.idProduct);
        if (!nom) { fautes.push(`${x.id} : produit ${l.idProduct} absent du catalogue`); continue; }
        const d = decomposerNomCardmarket(nom);
        const notre = await C.findOne({ _id: l.carteId }, { projection: { nomEn: 1, attaques: 1 } });
        let autreId = x.autre;
        if (autreId === 'aquapolis') autreId = toutes.find(t => t.idProduct === l.idProduct && t.slugSet === 'Aquapolis')?.carteId;
        const autres = toutes.filter(t => t.idProduct === l.idProduct && t._id !== l._id);
        let verdict;
        if (x.preuve === 'attaques') {
            const att = d.attaques.map(normaliserNom).filter(Boolean);
            const autre = autreId != null ? await C.findOne({ _id: autreId }, { projection: { nomEn: 1, attaques: 1 } }) : null;
            const score = c => (c?.attaques || []).filter(a => att.includes(normaliserNom(a.nom))).length;
            const [sN, sA] = [score(notre), score(autre)];
            verdict = att.length && autre && sA > sN ? `attaques [${d.attaques.join(' | ')}] : ${autreId} ${sA} contre ${l.carteId} ${sN}` : null;
            if (!verdict) fautes.push(`${x.id} « ${nom} » : le témoin des attaques ne contredit plus la ligne (autre ${autreId ?? '—'}, ${sA} contre ${sN})`);
        } else {
            verdict = normaliserNom(d.nom) !== normaliserNom(notre?.nomEn) ? `nom « ${d.nom} » ≠ carte « ${notre?.nomEn} »` : null;
            if (!verdict) fautes.push(`${x.id} « ${nom} » : le nom ne contredit plus la carte « ${notre?.nomEn} »`);
        }
        if (verdict) plan.push({ x, l, nom, verdict, autres: autres.length });
        console.log(`   ${verdict ? '✅' : '🔴'} ${x.id} « ${nom} » exp ${l.idExpansion} ${l.slugSet ?? 'slugSet null'} (${l.preuve}) → ${verdict ?? 'NON CONTREDITE'} · le produit garde ${autres.length} autre(s) ligne(s)`);
    }
    if (fautes.length) { console.error(`\n🔴 ${fautes.length} ligne(s) ne se rejugent pas comme à la mesure — RIEN n'est écrit :\n   ${fautes.join('\n   ')}`); await fermer(); process.exitCode = 1; return; }

    // L'annonce : ce que la garde verra, comptée par SA fonction sur les expansions touchées, avant et après le retrait.
    const exps = [...new Set(lignes.map(l => l.idExpansion))];
    const avant = await L.find({ idExpansion: { $in: exps } }).project({ idExpansion: 1, idProduct: 1 }).toArray();
    const retirees = new Set(plan.map(p => p.l._id));
    const cmp = comparer(compterEtat({ cartesProduits: avant }), compterEtat({ cartesProduits: avant.filter(l => !retirees.has(l._id)) }));
    const baisses = Object.fromEntries(cmp.baisses.map(b => [b.cle, b.baisse]));
    console.log(`   baisses que la garde verra : ${Object.entries(baisses).map(([k, v]) => `${k} −${v}`).join(' ; ') || 'aucune'} (un produit qui garde une autre ligne ne fait rien baisser)`);

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
        await cx.db.collection('restes').updateOne({ set: p.l.slugSet, type: p.x.type, idProduct: p.l.idProduct, carteId: p.l.carteId },
            { $set: { detail: `${p.l.idProduct} « ${p.nom} » : joint par ${p.l.preuve} à ${p.l.carteId} — ${p.x.pourquoi} ; ${p.verdict} ; détachée par detacher-lignes-prouvees.js (feu vert du testeur, 2026-09-25)`, le: new Date() } }, { upsert: true });
    }
    const encore = await L.countDocuments({ _id: { $in: plan.map(p => p.l._id) } });
    console.log(`\n   ✅ détachées : ${r.deletedCount} (attendu ${plan.length}) · encore présentes : ${encore} · restes écrits : ${restes} (produits restés sans ligne)`);
    await fermer();
    if (r.deletedCount !== plan.length || encore) process.exitCode = 1;
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
