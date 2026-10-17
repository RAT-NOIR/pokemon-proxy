// ============================================================
// LOT H-FIX — impressions numérotées SV-P id/th (liste fermée : collecte-cartes/h-fix.js)
// ============================================================
//   node poser-h-fix.js                                           (SIMULATION : plan + règle du site rejouée avant/après, lecture seule)
//   node lot-additif.js --quoi="H-FIX : 6 impressions SV-P id/th" --collections=cartes -- node poser-h-fix.js --attendu=6 --ecrire
// Écrit UN geste, additif : $push d'une impression numérotée gardée par un filtre (jamais deux fois). Aucune valeur existante n'est modifiée.
// La valeur « avant » est rejouée : une ligne dont numeroFiche/slug/detail a changé est REFUSÉE avec sa raison. Relecture après écriture.
// RAT_MARKET_RACINE : le dépôt dont le voisin `rat-market-site` porte la règle du site (défaut : ce dépôt).
const { planifier, operationsVersMongo, LISTE, SOURCE } = require('./collecte-cartes/h-fix');
const { SOURCES_POSEES_APRES } = require('./collecte-cartes/impressions-posees');
if (!SOURCES_POSEES_APRES.includes(SOURCE)) throw new Error(`${SOURCE} n'est plus conservée par impressions-posees.js : une recollecte effacerait ces impressions`);

(async () => {
    require('dotenv').config({ quiet: true });
    const AUTORISES = [/^--ecrire$/, /^--attendu=\d+$/];
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — usage : [--ecrire --attendu=<N>]`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire');
    const ATTENDU = Number((process.argv.find(a => a.startsWith('--attendu=')) || '').slice(10));
    if (ECRIRE && !ATTENDU) { console.error('❌ --ecrire exige --attendu=<N> (le nombre que la simulation a rendu)'); process.exit(2); }

    let cx, fermer;
    if (ECRIRE) { const { ouvrirConnexions } = require('./collecte-cartes/garde'); const o = await ouvrirConnexions({ production: true, buckets: [] }); cx = o.cartes; fermer = o.fermer; }
    else {
        if (!process.env.MONGODB_CARTES_LECTURE_URI) { console.error('❌ MONGODB_CARTES_LECTURE_URI absente'); process.exit(2); }
        const { MongoClient } = require('mongodb'); const a = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI); await a.connect();
        cx = { db: a.db('cartes') }; fermer = () => a.close();
        if (!(await cx.db.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('base cartes vide : grappe fausse ?');
    }
    try {
        const sets = [...new Set(LISTE.map(o => o.set))];
        const setsDocs = await cx.db.collection('sets').find({ _id: { $in: sets } }, { projection: { complet: 0, denominateurs: 0, entreesSetlist: 0 } }).toArray();
        if (setsDocs.length !== sets.length) throw new Error('un set de la liste est introuvable');
        const cartesDocs = await cx.db.collection('cartes').find({ sets: { $in: sets } }, { projection: { impressions: 1, images: 1, nomEn: 1, sets: 1 } }).toArray();
        const exps = setsDocs.flatMap(s => [].concat(s.idExpansion ?? []));
        const lignes = await cx.db.collection('cartes_produits').find({ idExpansion: { $in: exps } }, { projection: { idProduct: 1, carteId: 1, slugSet: 1, idExpansion: 1, numeroFiche: 1, slug: 1, detail: 1, visuelSubstitut: 1 } }).toArray();
        console.log(`DÉNOMINATEUR : ${setsDocs.length} sets · ${cartesDocs.length} cartes · ${lignes.length} lignes · liste fermée ${LISTE.length}`);
        if (!cartesDocs.length || !lignes.length) throw new Error('population de lecture vide : sonde cassée');
        const plan = planifier({ cartes: new Map(cartesDocs.map(c => [c._id, c])), lignes });
        for (const o of plan.operations) console.log(`   + carte ${o.carteId} ${o.tirage} n°${o.numero} (produit ${o.produit}) · ${o.vu}`);
        for (const d of plan.deja) console.log(`   = déjà posée : carte ${d.carteId} ${d.tirage} n°${d.numero}`);
        for (const r of plan.refus) console.log(`   ✗ REFUS carte ${r.carteId} ${r.tirage} n°${r.numero} : ${r.raison}`);
        console.log(`PLAN : ${plan.operations.length} à poser · ${plan.deja.length} déjà · ${plan.refus.length} refusées`);

        // la règle du site, importée, avant / après sur les sets touchés
        const H = require('./collecte-cartes/h-fix-site');
        const R = await H.chargerRegle({ racine: process.env.RAT_MARKET_RACINE || __dirname });
        const avant = H.servir(R, { sets: setsDocs, cartes: cartesDocs, lignes });
        const apres = H.servir(R, { sets: setsDocs, cartes: cartesDocs.map(c => { const ops = plan.operations.filter(o => o.carteId === c._id); return ops.length ? { ...c, impressions: [...(c.impressions || []), ...ops.map(o => o.impression)] } : c; }), lignes });
        const dif = H.diff(avant, apres), cibles = new Set(LISTE.map(o => o.produit));
        const visuels = dif.filter(d => d.nature === 'visuel changé'), perdus = dif.filter(d => d.nature.startsWith('PRODUIT PERDU'));
        const horsListe = visuels.filter(d => !cibles.has(d.a.idProduct));
        for (const d of dif) console.log(`   ${d.nature} · ${d.a.set} ${d.a.idProduct} · ${d.a.cleR2 ?? '∅'} → ${d.b.fiche ? `n°${d.b.numero} ${d.b.cleR2 ?? '∅ (visuel absent, honnête)'}` : 'AUCUNE FICHE'}`);
        console.log(`SITE : ${avant.size} produits rejoués · ${dif.length} différences · visuels changés ${visuels.length} (hors liste : ${horsListe.length}) · produits perdus ${perdus.length}`);
        if (horsListe.length || perdus.length) { console.error('🔴 ARRÊT : la correction change un produit hors liste ou en perd un.'); process.exitCode = 1; return; }
        if (!ECRIRE) { console.log('(simulation — sous lot-additif.js : --attendu=N --ecrire)'); return; }
        if (plan.refus.length || plan.operations.length !== ATTENDU) { console.error(`❌ ARRÊT : plan ${plan.operations.length}, refus ${plan.refus.length}, attendu ${ATTENDU} — rien n'est écrit`); process.exitCode = 1; return; }
        let n = 0;
        for (const o of plan.operations) { const m = operationsVersMongo(o); n += (await cx.db.collection('cartes').updateOne(m.filtre, m.maj)).modifiedCount; }
        const relues = await Promise.all(plan.operations.map(o => cx.db.collection('cartes').countDocuments({ _id: o.carteId, impressions: { $elemMatch: { tirage: o.tirage, expansion: o.expansion, numero: o.numero, source: SOURCE } } })));
        const ok = relues.filter(x => x === 1).length;
        console.log(`${n === plan.operations.length && ok === n ? '✅' : '🔴'} posées ${n}/${plan.operations.length} · relu : ${ok} impression(s) retrouvée(s)`);
        if (n !== plan.operations.length || ok !== n) process.exitCode = 1;
    } finally { await fermer(); }
})().catch(e => { console.error('❌', e.message); process.exitCode = 1; });
