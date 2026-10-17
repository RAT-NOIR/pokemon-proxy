// ============================================================
// LOT ENERGIES-SP — les 8 Énergies de base de Sword-Shield-Promos (module : collecte-cartes/energies-sp.js)
// ============================================================
//   node poser-energies-sp.js [--sans-douteux] [--sortie=<dossier>] [--site-lib=<lib du site>]     (SIMULATION : plan, règle du site rejouée avant/après, diff, manifeste, annonce — lecture seule)
//   node lot-additif.js --quoi="ENERGIES-SP : …" --collections=cartes,cartes_produits,images [--annonce=<annonce.json>] -- node poser-energies-sp.js --attendu=<N> --ecrire
//   node poser-energies-sp.js --retirer [--ecrire --attendu=<N>]                                  (le retrait EXACT, d'après manifeste.json)
// Écrit : un $push gardé par impression, un $set de numeroFiche là où il est nul, un $set positionnel du numéro d'une image à numéro nul (cartes.images ET le
// document images, que `--rejouer-jointure` relit). Rien d'autre. La valeur « avant » est rejouée : le lot écrit est EXACTEMENT le lot simulé (manifeste).
// La règle du SITE est importée de sa lib (branche non fusionnée : lecture seule), jamais recopiée. Un produit perdu, ou un produit d'une autre carte qui change : ARRÊT.
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const E = require('./collecte-cartes/energies-sp');

const DEFAUT_SORTIE = 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S7/ENERGIES-SP';
const DEFAUT_SITE_LIB = 'C:/Users/Yung/rat-market-travail/site/energies-sp/lib';
const AUTORISES = [/^--ecrire$/, /^--retirer$/, /^--sans-douteux$/, /^--attendu=\d+$/, /^--sortie=.+$/, /^--site-lib=.+$/];
const val = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };

async function lireEtat(dbCartes, dbProd) {
    const sets = await dbCartes.collection('sets').find({ _id: E.SET }, { projection: { complet: 0, denominateurs: 0, entreesSetlist: 0 } }).toArray();
    if (sets.length !== 1) throw new Error(`le set ${E.SET} est introuvable`);
    const exps = [].concat(sets[0].idExpansion ?? []);
    const cartesDocs = await dbCartes.collection('cartes').find({ sets: E.SET }, { projection: { impressions: 1, images: 1, nomEn: 1, sets: 1 } }).toArray();
    const lignes = await dbCartes.collection('cartes_produits').find({ idExpansion: { $in: exps } }, { projection: { idProduct: 1, carteId: 1, slugSet: 1, idExpansion: 1, numeroFiche: 1, slug: 1, detail: 1, visuelSubstitut: 1 } }).toArray();
    const ids = E.CARTES.map(c => c.id);
    const cibles = lignes.filter(l => l.slugSet === E.SET && ids.includes(l.carteId));
    const nc = new Map((await dbProd.collection('numeros_cartes').find({ idProduct: { $in: cibles.map(l => l.idProduct) } }, { projection: { idProduct: 1, numero: 1, slug: 1, slugSet: 1 } }).toArray()).map(d => [d.idProduct, d]));
    const lot = Object.values(E.DOUTEUX).flatMap(d => d.lot);
    const cat = new Map((await dbProd.collection('catalogue_produits').find({ idProduct: { $in: [...new Set([...lot, ...cibles.map(l => l.idProduct)])] } }, { projection: { idProduct: 1, dateAdded: 1, idMetacard: 1, name: 1 } }).toArray()).map(d => [d.idProduct, d]));
    const imagesDocs = new Map((await dbCartes.collection('images').find({ set: E.SET, carteId: { $in: ids } }, { projection: { carteId: 1, numero: 1, set: 1, cleR2: 1 } }).toArray()).map(d => [d.cleR2, d]));   // clé = cleR2 (« artofpkm/397/316.webp ») ; l'_id du document est la même chose sans l'extension
    return { sets, cartesDocs, cartes: new Map(cartesDocs.map(c => [c._id, c])), lignes, nc, cat, imagesDocs };
}

async function ouvrirLecture() {
    require('dotenv').config({ quiet: true });
    for (const v of ['MONGODB_CARTES_LECTURE_URI', 'MONGODB_LECTURE_URI']) if (!process.env[v]) { console.error(`❌ ${v} absente`); process.exit(2); }
    const { MongoClient } = require('mongodb');
    const a = new MongoClient(process.env.MONGODB_CARTES_LECTURE_URI), b = new MongoClient(process.env.MONGODB_LECTURE_URI);
    await a.connect(); await b.connect();
    const dbCartes = a.db('cartes'), dbProd = b.db('test');
    if (!(await dbCartes.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('base cartes vide : grappe fausse ?');
    if (!(await dbProd.listCollections({}, { nameOnly: true }).toArray()).length) throw new Error('base test vide : grappe fausse ?');
    return { dbCartes, dbProd, fermer: () => Promise.all([a.close(), b.close()]) };
}

/** La règle du site, avant / après, sur le set. @returns {{dif, avant, apres, perdus, horsCartes}} */
async function rejouerLeSite({ etat, apres, siteLib }) {
    const H = require('./collecte-cartes/h-fix-site');
    const R = await H.chargerRegle({ racine: __dirname, siteLib });
    const cartesApres = etat.cartesDocs.map(c => apres.cartes.get(c._id) || c);
    const av = H.servir(R, { sets: etat.sets, cartes: etat.cartesDocs, lignes: etat.lignes });
    const ap = H.servir(R, { sets: etat.sets, cartes: cartesApres, lignes: apres.lignes });
    const dif = H.diff(av, ap);
    const ids = new Set(E.CARTES.map(c => c.id));
    const perdus = dif.filter(d => d.nature.startsWith('PRODUIT PERDU') || d.nature === 'produit sorti de la sortie');
    const horsCartes = dif.filter(d => !ids.has(d.a.carteId));
    const C = await import(pathToFileURL(path.join(siteLib, 'cardmarket.ts')).href);
    return { H, R, av, ap, dif, perdus, horsCartes, sansNumeroSite: (l, code) => typeof C.produitSansNumeroSurLaPrincipale === 'function' ? C.produitSansNumeroSurLaPrincipale({ numeroFiche: l.numeroFiche ?? null, slug: l.slug ?? null, idProduct: l.idProduct }, code) : null };
}

(async () => {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — usage : [--sans-douteux] [--retirer] [--ecrire --attendu=<N>]`); process.exit(2); }
    const ECRIRE = process.argv.includes('--ecrire'), RETIRER = process.argv.includes('--retirer'), DOUTEUX = !process.argv.includes('--sans-douteux');
    const ATTENDU = Number(val('attendu'));
    const SORTIE = val('sortie') || DEFAUT_SORTIE, SITE_LIB = val('site-lib') || DEFAUT_SITE_LIB;
    if (ECRIRE && !ATTENDU) { console.error('❌ --ecrire exige --attendu=<N> (le nombre que la simulation a rendu)'); process.exit(2); }
    fs.mkdirSync(SORTIE, { recursive: true });
    const fichier = n => path.join(SORTIE, n);

    let cx;
    if (ECRIRE) { const { ouvrirConnexions } = require('./collecte-cartes/garde'); require('dotenv').config({ quiet: true }); const o = await ouvrirConnexions({ production: true, buckets: [] }); cx = { dbCartes: o.cartes.db, dbProd: o.prod.db, fermer: o.fermer }; }
    else cx = await ouvrirLecture();
    try {
        const etat = await lireEtat(cx.dbCartes, cx.dbProd);
        console.log(`DÉNOMINATEUR : set ${E.SET} · ${etat.cartesDocs.length} cartes du set · ${etat.lignes.length} lignes (expansion ${[].concat(etat.sets[0].idExpansion)}) · ${etat.lignes.filter(l => E.CARTES.some(c => c.id === l.carteId) && l.slugSet === E.SET).length} lignes des 8 Énergies · ${etat.nc.size} numeros_cartes · ${etat.cat.size} catalogue_produits · ${etat.imagesDocs.size} documents images · tirage du set : ${etat.sets[0].tirage ?? etat.sets[0].region}`);
        if (!etat.cartesDocs.length || !etat.lignes.length || !etat.nc.size) throw new Error('population de lecture vide : sonde cassée');
        if ((etat.sets[0].tirage ?? etat.sets[0].region) !== E.TIRAGE_ATTENDU) throw new Error(`le set n'est plus du tirage ${E.TIRAGE_ATTENDU}`);

        // ── le retrait exact
        if (RETIRER) {
            const m = JSON.parse(fs.readFileSync(fichier('manifeste.json'), 'utf8'));
            const ops = E.operationsDeRetrait(m);
            const annonce = E.annonceDeRetrait(m);   // statique : avant l'écriture du lot, la base ne porte encore rien à retirer
            require('./collecte-cartes/garde-lot').validerAnnonces(annonce);
            fs.writeFileSync(fichier('annonce-retrait.json'), JSON.stringify(annonce, null, 1));
            console.log(`RETRAIT : ${ops.length} écritures (impressions ${m.impressions.length} · numeroFiche ${m.numerosFiche.length} · images ${m.images.length * 2}) · annonce-retrait.json : ${JSON.stringify(annonce)}`);
            if (!ECRIRE) { console.log('(simulation du retrait — sous lot-additif.js : --retirer --attendu=N --ecrire, --annonce=annonce-retrait.json)'); return; }
            if (ops.length !== ATTENDU) { console.error(`❌ ARRÊT : ${ops.length} écritures, attendu ${ATTENDU} — rien n'est retiré`); process.exitCode = 1; return; }
            let touches = 0;
            for (const o of ops) touches += (await cx.dbCartes.collection(o.coll).updateOne(o.filter, o.update, o.options || {})).modifiedCount;
            console.log(`${touches === ops.length ? '✅' : '🔴'} retirées ${touches}/${ops.length}`);
            if (touches !== ops.length) process.exitCode = 1;
            return;
        }

        const plan = E.planifier(etat, { douteux: DOUTEUX });
        const ops = E.operationsVersMongo(plan);
        const manifeste = E.manifeste(plan);
        console.log(`PLAN : ${plan.impressions.length} impressions · ${plan.numerosFiche.length} numeroFiche (dont douteux ${plan.numerosFiche.filter(x => x.douteux).length}) · ${plan.images.length} numéros d'image (×2 écritures) · déjà ${plan.deja.length} · sans numéro ${plan.sansNumero.length} · refus ${plan.refus.length} · douteux refusés ${plan.douteuxRefuses.length} · ÉCRITURES ${ops.length}`);
        for (const r of plan.refus) console.log(`   ✗ REFUS ${r.idProduct ?? r.cleR2} : ${r.raison}`);
        for (const r of plan.douteuxRefuses) console.log(`   ? DOUTEUX NON POSÉ ${r.idProduct} : ${r.raison}`);

        const apres = E.appliquer(etat, plan);
        const S = await rejouerLeSite({ etat, apres, siteLib: SITE_LIB });
        const nat = {}; for (const d of S.dif) nat[d.nature] = (nat[d.nature] || 0) + 1;
        console.log(`SITE (lib ${SITE_LIB}) : ${S.av.size} produits rejoués · ${S.dif.length} différences ${JSON.stringify(nat)} · perdus ${S.perdus.length} · hors des 8 cartes ${S.horsCartes.length}`);

        // la garde de lot sur l'état simulé : une baisse (entrée d'image qui change de numéro, fiche qui disparaît) s'annonce
        const garde = require('./collecte-cartes/garde-lot');
        const cmp = garde.comparer(garde.compterEtat({ cartes: etat.cartesDocs, cartesProduits: etat.lignes }), garde.compterEtat({ cartes: etat.cartesDocs.map(c => apres.cartes.get(c._id) || c), cartesProduits: apres.lignes }));
        const annonce = Object.fromEntries(cmp.baisses.filter(b => !b.autorisee).map(b => [b.cle, b.baisse]));
        console.log(`GARDE DE LOT (simulée) : ${cmp.baisses.length} baisse(s), ${cmp.nonAutorisees.length} non autorisée(s) · hausses ${JSON.stringify(cmp.hausses)} · annonce : ${JSON.stringify(annonce)}`);

        // ── le diff produit par produit
        const ids = new Set(E.CARTES.map(c => c.id));
        const nomImage = (cartes, carteId, cleR2) => { if (!cleR2) return null; const e = (cartes.get(carteId)?.images || []).find(m => m.cleR2 === cleR2); return { cleR2, numeroImage: e?.numero ?? null }; };
        const ligneDe = new Map(etat.lignes.map(l => [`${E.SET}|${l.idProduct}|${l.carteId}`, l]));
        const produits = [];
        const cles = new Set([...S.av.keys()].filter(k => ids.has(S.av.get(k).carteId)));
        for (const d of S.dif) cles.add(d.k);
        for (const k of [...cles].sort()) {
            const a = S.av.get(k), b = S.ap.get(k), l = ligneDe.get(k), d = S.dif.find(x => x.k === k);
            const n = etat.nc.get(a.idProduct);
            const lApres = apres.lignes.find(x => x._id === l._id);
            const rep = x => x && { fiche: x.fiche, rang: x.rang, numeroAffiche: x.numero, image: nomImage(x === a ? etat.cartes : apres.cartes, a.carteId, x.cleR2) };
            produits.push({ idProduct: a.idProduct, carteId: a.carteId, nom: (etat.cartes.get(a.carteId) || {}).nomEn, slug: l.slug ?? null, slugNc: n?.slug ?? null, numeroNc: n?.numero ?? null,
                numeroFicheAvant: l.numeroFiche ?? null, numeroFicheApres: lApres.numeroFiche ?? null, nature: d ? d.nature : 'inchangé',
                avant: rep(a), apres: rep(b), sansNumeroSite: S.sansNumeroSite({ ...lApres, slug: l.slug ?? n?.slug }, 'S-P') });
        }
        const resume = { produitsRejoues: S.av.size, differences: S.dif.length, natures: nat, perdus: S.perdus.length, horsDesHuitCartes: S.horsCartes.length,
            gagnes: S.dif.filter(d => d.nature === 'produit gagné une fiche').length, visuelsChanges: S.dif.filter(d => d.nature === 'visuel changé').length,
            fichesChangeesVisuelIdentique: S.dif.filter(d => d.nature.startsWith('fiche changée')).length, produitsDesHuitCartes: produits.length };
        const sortie = { date: '2026-10-17', siteLib: SITE_LIB, plan: { impressions: plan.impressions, numerosFiche: plan.numerosFiche, images: plan.images, refus: plan.refus, douteuxRefuses: plan.douteuxRefuses, sansNumero: plan.sansNumero, deja: plan.deja }, resume, produits };
        if (ECRIRE) {
            // le lot écrit est EXACTEMENT le lot simulé : le manifeste de la simulation est relu, jamais réécrit
            const simule = fs.existsSync(fichier('manifeste.json')) ? fs.readFileSync(fichier('manifeste.json'), 'utf8') : null;
            if (simule === null || JSON.stringify(JSON.parse(simule)) !== JSON.stringify(manifeste)) { console.error('❌ ARRÊT : le lot d\'aujourd\'hui n\'est pas celui de la simulation (manifeste.json) : relancer la simulation et relire son diff — rien n\'est écrit'); process.exitCode = 1; return; }
        } else {
            fs.writeFileSync(fichier('diff.json'), JSON.stringify(sortie, null, 1));
            fs.writeFileSync(fichier('manifeste.json'), JSON.stringify(manifeste, null, 1));
            if (Object.keys(annonce).length) fs.writeFileSync(fichier('annonce.json'), JSON.stringify(annonce, null, 1));
            else if (fs.existsSync(fichier('annonce.json'))) fs.rmSync(fichier('annonce.json'));
            fs.writeFileSync(fichier('diff.md'), E.diffEnMarkdown(sortie, { annonce, garde: { baisses: cmp.baisses.length, nonAutorisees: cmp.nonAutorisees.length, hausses: cmp.hausses }, douteux: DOUTEUX }));
        }

        if (S.perdus.length || S.horsCartes.length) { console.error('🔴 ARRÊT : la correction perd un produit ou change un produit hors des 8 cartes.'); process.exitCode = 1; return; }
        if (!ECRIRE) { console.log(`(simulation — fichiers dans ${SORTIE} ; écriture : lot-additif.js … -- node poser-energies-sp.js --attendu=${ops.length} --ecrire)`); return; }

        // ── l'écriture : exactement le lot simulé
        if (plan.refus.length || ops.length !== ATTENDU) { console.error(`❌ ARRÊT : ${ops.length} écritures, ${plan.refus.length} refus, attendu ${ATTENDU} — rien n'est écrit`); process.exitCode = 1; return; }
        let touches = 0;
        for (const o of ops) touches += (await cx.dbCartes.collection(o.coll).updateOne(o.filter, o.update, o.options || {})).modifiedCount;
        const relu = E.planifier(await lireEtat(cx.dbCartes, cx.dbProd), { douteux: DOUTEUX });
        const ok = relu.impressions.length === 0 && relu.numerosFiche.length === 0 && relu.images.length === 0;
        console.log(`${touches === ops.length && ok ? '✅' : '🔴'} écrites ${touches}/${ops.length} · relu : plan restant ${relu.impressions.length + relu.numerosFiche.length + relu.images.length} (0 attendu)`);
        if (touches !== ops.length || !ok) process.exitCode = 1;
    } finally { await cx.fermer(); }
})().catch(e => { console.error('❌', e.stack || e.message); process.exitCode = 1; });
