'use strict';
// PERF-SCAN P1 — PREUVE D'IDENTITÉ de la recherche du catalogue par l'index de nom. LECTURE SEULE des fichiers, 0 $, aucun réseau, base EN MÉMOIRE (collecte-cartes/base-banc.js) nommée « rm_essai ».
// Il charge l'instantané du catalogue (catalogue_produits, numeros_cartes), appelle le VRAI index.js (trouverProduitsLocaux) et le VRAI identification-locale.js (identifierEnLocal) :
//   · phase AVANT : sans champ ni index (la requête d'aujourd'hui, balayage complet) ;
//   · la pose des clés par l'outil de production (v2/migrations/poser-cles-nom.js, la même fonction `principal`) ;
//   · phase APRÈS : avec le champ et l'index. Le diff imprimé : l'ensemble ET l'ordre des produits rendus, nom par nom, puis la décision complète d'identifierEnLocal.
// Les noms rejoués : les lignes des bancs (banc-verites.json), les 468 lignes du rejeu (resultats-avecG.json → nom du produit de la vérité), les 50 de la série C, et un échantillon régulier de TOUS les noms du catalogue
// (dont leurs formes en capitales / minuscules / préfixe Mega). Le dénominateur est imprimé à chaque ligne.
// Usage : node v2/mesures/rejouer-identite-index-nom.js --instantane=<dossier> [--resultats=<resultats-avecG.json>] [--serie=<serie-C.json>] [--echantillon=<N>] [--sortie=<rapport.json>]
const fs = require('fs'), path = require('path'), readline = require('readline');
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const racine = path.join(__dirname, '..', '..');
const attendre = ms => new Promise(r => setTimeout(r, ms));
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

async function charger(client, base, dossier, nom) {
    const { EJSON } = require(path.join(racine, 'node_modules', 'bson'));
    const coll = client.db(base).collection(nom);
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(dossier, `test.${nom}.ejson`)), crlfDelay: Infinity });
    let lot = [], n = 0;
    for await (const l of rl) { if (!l) continue; lot.push(EJSON.parse(l, { relaxed: false })); n++; if (lot.length >= 2000) { await coll.insertMany(lot, { ordered: false }); lot = []; } }
    if (lot.length) await coll.insertMany(lot, { ordered: false });
    const idx = JSON.parse(fs.readFileSync(path.join(dossier, `test.${nom}.indexes.json`), 'utf8'));
    for (const i of idx) { if (i.expireAfterSeconds !== undefined) continue; const { key, name, ...opts } = i; try { await coll.createIndex(key, { name, ...opts }); } catch { /* index non recréé */ } }
    return n;
}

(async () => {
    const dossier = arg('instantane'); if (!dossier) { console.error('--instantane=<dossier> manquant'); process.exit(2); }
    const { ouvrirBanc } = require(path.join(racine, 'collecte-cartes', 'base-banc.js'));
    const banc = await ouvrirBanc({ env: {}, fichierEnv: path.join(__dirname, 'pas-de-env') });
    const { MongoClient } = require(path.join(racine, 'node_modules', 'mongodb'));
    const client = await new MongoClient(banc.uri).connect();
    let code = 0;
    try {
        const nCat = await charger(client, 'rm_essai', dossier, 'catalogue_produits'), nNum = await charger(client, 'rm_essai', dossier, 'numeros_cartes');
        await charger(client, 'rm_essai', dossier, 'codes_set').catch(() => 0); await charger(client, 'rm_essai', dossier, 'guide_prix').catch(() => 0);
        console.log(`instantané chargé dans « rm_essai » (mémoire) : catalogue_produits ${nCat} · numeros_cartes ${nNum}`);
        banc.appliquer(); process.env.MONGODB_BASE = 'rm_essai'; process.env.MONGODB_URI = banc.uri;
        const mongoose = require(path.join(racine, 'node_modules', 'mongoose'));
        const index = require(path.join(racine, 'index.js'));
        const IL = require(path.join(racine, 'identification-locale.js'));
        await mongoose.connection.asPromise();
        const dbm = mongoose.connection.db;
        const catalogue = await dbm.collection('catalogue_produits').find({}, { projection: { idProduct: 1, name: 1 } }).sort({ _id: 1 }).toArray();
        const nomDe = new Map(catalogue.map(p => [p.idProduct, p.name]));
        const numeroDe = new Map((await dbm.collection('numeros_cartes').find({}, { projection: { idProduct: 1, numero: 1, nomFr: 1 } }).toArray()).map(d => [d.idProduct, d]));
        const nu = s => String(s || '').replace(/\s*\[.*$/, '').trim();

        // ── les noms à rejouer : { origine, nom, numero }
        const cas = [], vus = new Set();
        const ajouter = (origine, nom, numero) => { if (!nom) return; const k = `${origine}|${nom}|${numero || ''}`; if (vus.has(k)) return; vus.add(k); cas.push({ origine, nom, numero: numero || null }); };
        const brutes = JSON.parse(fs.readFileSync(path.join(racine, 'banc-verites.json'), 'utf8')).verites;
        for (const v of Array.isArray(brutes) ? brutes : Object.values(brutes)) if (v.lu && v.lu.nom) ajouter('banc-verites', v.lu.nom, v.lu.numero);
        let nSerie = 0;
        if (arg('resultats')) {
            const R = JSON.parse(fs.readFileSync(arg('resultats'), 'utf8'));
            const serie = arg('serie') ? new Set(JSON.parse(fs.readFileSync(arg('serie'), 'utf8')).lignes) : new Set();
            for (const x of R.ref) {
                const id = x.verite ?? (x.et && Array.isArray(x.et.choix) ? x.et.choix[0] : null) ?? (x.et && x.et.id) ?? null;
                if (!id || !nomDe.has(id)) continue;
                const n = numeroDe.get(id);
                ajouter(serie.has(x.cle) ? 'serie-C' : 'rejeu-468', nu(nomDe.get(id)), n && n.numero);
                if (serie.has(x.cle)) nSerie++;
            }
        }
        const echant = Number(arg('echantillon') || 3000), pas = Math.max(1, Math.floor(catalogue.length / echant));
        for (let i = 0; i < catalogue.length; i += pas) {
            const nom = nu(catalogue[i].name); if (!nom) continue;
            const n = numeroDe.get(catalogue[i].idProduct);
            ajouter('catalogue', nom, n && n.numero);
            ajouter('catalogue-capitales', nom.toUpperCase(), n && n.numero);
            ajouter('catalogue-minuscules', nom.toLowerCase(), n && n.numero);
            if (/^Mega /i.test(nom)) ajouter('catalogue-mega-M', nom.replace(/^Mega /i, 'M '), n && n.numero);
        }
        // les noms français : l'échantillon des nomFr distincts (identifierEnLocal les cherche par nomFr), avec leurs formes sans accent
        const frs = [...new Set([...numeroDe.values()].map(d => d.nomFr).filter(s => typeof s === 'string' && s.trim()))];
        for (let i = 0; i < frs.length; i += Math.max(1, Math.floor(frs.length / Math.max(1, Math.floor(echant / 2))))) {
            const d = [...numeroDe.values()].find(x => x.nomFr === frs[i]);
            ajouter('nomFr', frs[i], d && d.numero); ajouter('nomFr-sans-accent', frs[i].normalize('NFD').replace(/\p{M}/gu, ''), d && d.numero); ajouter('nomFr-capitales', frs[i].toUpperCase(), d && d.numero);
        }
        const parOrigine = {}; for (const c of cas) parOrigine[c.origine] = (parOrigine[c.origine] || 0) + 1;
        console.log(`noms rejoués : ${cas.length} — ${JSON.stringify(parOrigine)}`);

        const profil = async (f) => {            // le profileur Mongo (niveau 2) : combien de requêtes de nom, combien en COLLSCAN, combien de documents examinés
            const d = dbm; await d.command({ profile: 0 }); try { await d.collection('system.profile').drop(); } catch { /* absente */ }
            await d.createCollection('system.profile', { capped: true, size: 64 * 1048576 }); await d.command({ profile: 2 });
            await f(); await d.command({ profile: 0 });
            const ops = await d.collection('system.profile').find({ ns: { $in: ['rm_essai.catalogue_produits', 'rm_essai.numeros_cartes'] }, op: { $in: ['query', 'find'] } }).toArray();
            const nomRequete = o => /nom(Cles|FrCle)|name|nomFr/.test(JSON.stringify(o.command && o.command.filter || o.command || {}));
            const noms = ops.filter(nomRequete);
            return { requetes: noms.length, collscan: noms.filter(o => /COLLSCAN/.test(o.planSummary || '')).length, ixscan: noms.filter(o => /IXSCAN/.test(o.planSummary || '')).length, docsExamines: noms.reduce((a, o) => a + (o.docsExamined || 0), 0) };
        };
        const rejouer = async (liste, etiquette) => {
            const sortie = [];
            for (const c of liste) {
                const produits = await index.trouverProduitsLocaux(c.nom);
                const r = { origine: c.origine, nom: c.nom, ids: produits.map(p => p.idProduct), formes: produits.map(p => [p.idProduct, p.name, p.idExpansion, p.idMetacard]) };
                if (c.numero) { const dec = await IL.identifierEnLocal({ nomLu: c.nom, numeroLu: c.numero, regionAttendue: null }); r.local = dec ? { gagnant: dec.gagnant && dec.gagnant.idProduct, produits: dec.produits && dec.produits.map(p => p.idProduct), scores: dec.scores, voie: dec.voie, ecart: dec.ecartScore } : null; }
                sortie.push(r);
            }
            return sortie;
        };
        const serieC = cas.filter(c => c.origine === 'serie-C');

        // ── AVANT
        const profAvantSerie = await profil(async () => { await rejouer(serieC, 'avant-serie'); });
        const t0 = Date.now(); const avant = await rejouer(cas, 'avant'); const msAvant = Date.now() - t0;
        console.log(`AVANT : ${avant.length} noms en ${Math.round(msAvant / 1000)} s · série C (${serieC.length}) : ${JSON.stringify(profAvantSerie)}`);

        // ── la pose, par l'outil de production
        const M = require(path.join(racine, 'v2', 'migrations', 'poser-cles-nom.js'));
        const lt = console.log; console.log = () => { };
        let rc; try { rc = await M.principal(['--base=rm_essai', '--appliquer', '--lot=2000'], {}, { ouvrirCible: async () => ({ ok: true, db: dbm, fermer: async () => { } }), prouverStatut: async () => ({ ok: true }), journal: () => { }, poidsCible: async () => 0 }); } finally { console.log = lt; }
        if (rc !== 0) throw new Error(`la pose a échoué (code ${rc})`);
        const stats = await dbm.command({ dbStats: 1 });
        const taille = async nom => { const s = await dbm.command({ collStats: nom }); return { donnees: s.size, index: s.totalIndexSize, nomIndex: s.indexSizes }; };
        console.log(`clés posées. catalogue_produits : ${JSON.stringify(await taille('catalogue_produits'))} · numeros_cartes : ${JSON.stringify(await taille('numeros_cartes'))} · poids base ${(stats.dataSize + stats.indexSize) / 1e6} Mo`);
        index.oublierIndexNom(); IL.oublierIndexNom();

        // ── APRÈS
        const profApresSerie = await profil(async () => { await rejouer(serieC, 'apres-serie'); });
        const t1 = Date.now(); const apres = await rejouer(cas, 'apres'); const msApres = Date.now() - t1;
        console.log(`APRÈS : ${apres.length} noms en ${Math.round(msApres / 1000)} s · série C (${serieC.length}) : ${JSON.stringify(profApresSerie)}`);

        // ── le DIFF
        let dIds = 0, dOrdre = 0, dFormes = 0, dLocal = 0, nLocal = 0, vides = 0; const exemples = [];
        for (let i = 0; i < cas.length; i++) {
            const a = avant[i], b = apres[i];
            if (!a.ids.length) vides++;
            if (!egal([...a.ids].sort((x, y) => x - y), [...b.ids].sort((x, y) => x - y))) { dIds++; if (exemples.length < 8) exemples.push({ nom: a.nom, genre: 'ensemble', avant: a.ids, apres: b.ids }); }
            else if (!egal(a.ids, b.ids)) { dOrdre++; if (exemples.length < 8) exemples.push({ nom: a.nom, genre: 'ordre', avant: a.ids, apres: b.ids }); }
            if (!egal(a.formes, b.formes)) { dFormes++; if (exemples.length < 8) exemples.push({ nom: a.nom, genre: 'forme du document', avant: a.formes[0], apres: b.formes[0] }); }
            if (a.local !== undefined) { nLocal++; if (!egal(a.local, b.local)) { dLocal++; if (exemples.length < 8) exemples.push({ nom: a.nom, genre: 'identifierEnLocal', avant: a.local, apres: b.local }); } }
        }
        console.log(`\nDIFF (dénominateur : ${cas.length} noms dont ${vides} sans aucun produit ; ${nLocal} rejeux d'identifierEnLocal) :`);
        console.log(`   ensemble des produits différent : ${dIds} · même ensemble, autre ORDRE : ${dOrdre} · forme du document différente : ${dFormes} · décision d'identifierEnLocal différente : ${dLocal}`);
        for (const e of exemples) console.log('   ↳', JSON.stringify(e).slice(0, 300));
        // ── les homonymes « commence par » de pont-cartes.js (nomMin) : la requête d'avant (regex ancrée, insensible à la casse) contre l'index, sur les noms anglais des cartes de la base de collecte
        let nPont = 0, dPont = 0, videsPont = 0, ixscanPont = 0;
        if (arg('cartes')) {
            const { EJSON } = require(path.join(racine, 'node_modules', 'bson'));
            const noms = new Set(); const rl = readline.createInterface({ input: fs.createReadStream(arg('cartes')), crlfDelay: Infinity });
            for await (const l of rl) { if (!l) continue; const d = EJSON.parse(l, { relaxed: true }); if (typeof d.nomEn === 'string' && d.nomEn.trim()) noms.add(d.nomEn); }
            const liste = [...noms]; const cp = dbm.collection('catalogue_produits');
            const IN = require(path.join(racine, 'v2', 'identifier', 'index-nom.js')), CN = require(path.join(racine, 'v2', 'identifier', 'cle-nom.js'));
            const dispo = IN.creerDisponibilite({ col: cp, champ: CN.CHAMP_NOM_MIN, nomIndex: CN.INDEX_NOM_MIN });
            const pas2 = Math.max(1, Math.floor(liste.length / echant));
            for (let i = 0; i < liste.length; i += pas2) {
                for (const nom of [liste[i], liste[i].toUpperCase()]) {
                    const rx = new RegExp('^' + nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|\\[|$)', 'i');
                    const a = await cp.find({ name: { $in: [rx] } }, { projection: { idProduct: 1, idExpansion: 1 } }).toArray();
                    const b = await IN.debutDeNom({ col: cp, dispo, nom, regex: rx });
                    nPont++; if (!a.length) videsPont++;
                    const cle = l => JSON.stringify(l.map(d => [String(d._id), d.idProduct, d.idExpansion]).sort());
                    if (b === null || cle(a) !== cle(b)) { dPont++; if (dPont <= 5) console.log('   ↳ DIFFÉRENCE (pont, commence par)', JSON.stringify(nom), a.length, b && b.length); }
                }
            }
            const ex = await cp.find({ nomMin: { $gte: 'pikachu', $lt: 'pikachu￿' } }).explain('queryPlanner'); ixscanPont = /IXSCAN/.test(JSON.stringify(ex.queryPlanner.winningPlan)) ? 1 : 0;
            console.log(`PONT (homonymes « commence par ») : ${nPont} requêtes (${videsPont} sans aucun produit), différences (ensemble des { _id, idProduct, idExpansion }) : ${dPont} · plan de l'intervalle : ${ixscanPont ? 'IXSCAN' : 'PAS d\'IXSCAN'}`);
        }
        if (arg('sortie')) fs.writeFileSync(arg('sortie'), JSON.stringify({ noms: cas.length, parOrigine, serieC: serieC.length, avant: { ms: msAvant, serie: profAvantSerie }, apres: { ms: msApres, serie: profApresSerie }, diff: { dIds, dOrdre, dFormes, dLocal, nLocal, vides }, pont: { requetes: nPont, differences: dPont, vides: videsPont }, exemples }, null, 1));
        code = dIds || dOrdre || dFormes || dLocal || dPont ? 1 : 0;
        console.log(code === 0 ? '\n✅ IDENTIQUE : mêmes produits, même ordre, mêmes documents, mêmes décisions.' : '\n🔴 DIFFÉRENCES (voir ci-dessus).');
    } finally { await client.close().catch(() => { }); await banc.arreter().catch(() => { }); }
    process.exit(code);
})().catch(e => { console.error('ERREUR', e && e.stack || e); process.exit(1); });
