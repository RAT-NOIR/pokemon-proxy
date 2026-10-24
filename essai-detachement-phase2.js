// PHASE 2 v2 — ESSAI À BLANC du détachement des 20 lignes « autre dessin » (décision '2026-10-24' de detacher-lignes-prouvees.js). LECTURE SEULE : rien n'est écrit en base.
//   node essai-detachement-phase2.js [--sortie=<dossier>] [--site-lib=<lib du site>]
// Rejoue : (1) la preuve de CHAQUE ligne (jugerLigne, la fonction de l'outil d'écriture) sur les noms du catalogue et les cartes lues en base ; (2) la vraie décision de l'API (decider) sur la base ENTIÈRE avant
// et après : seuls les 20 produits perdent leur entrée, 0 autre produit perdu / changé / gagné ; (3) le contrat de l'API ; (4) la règle du site ; (5) la garde de lot (annonce exacte).
// L'écriture réelle (le coordinateur, sous lot-additif.js) :
//   node lot-additif.js --quoi="PHASE 2 v2 : détacher 20 lignes fausses" --collections=restes --annonce=<annonce-lot-D.json> -- node detacher-lignes-prouvees.js --decision=2026-10-24 --ecrire
const fs = require('fs');
const path = require('path');
require('dotenv').config({ quiet: true });
if (!process.env.MONGODB_CARTES_LECTURE_URI) require('dotenv').config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });
const P = require('./collecte-cartes/phase2-visuels');
const DL = require('./detacher-lignes-prouvees');
const GC = require('./collecte-cartes/garde-contrat-api');
const { autoriser } = require('./collecte-cartes/garde-ecriture');
const sans = u => String(u ?? '').replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');
const arg = n => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : null; };
const AUTORISES = [/^--sortie=.+$/, /^--site-lib=.+$/];
const SORTIE = arg('sortie') || 'C:/Users/Yung/rat-market-travail/catalogue/couverture/S8/PHASE2', SITE_LIB = arg('site-lib') || 'C:/Users/Yung/Desktop/rat-market-site/lib';
const DECISION = '2026-10-24';

(async () => {
    const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
    if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')}`); process.exit(2); }
    const ecrireFichier = (nom, contenu) => { const p = autoriser(path.join(SORTIE, nom), [path.resolve(SORTIE)]); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, contenu); return p; };
    const D = DL.DECISIONS[DECISION];
    P.verifierTables();
    const api = await GC.chargerApi();
    const { jugerLecture } = require('./collecte-cartes/base-banc');
    const jc = jugerLecture(process.env, 'cartes'), jp = jugerLecture(process.env, 'production');
    if (!jc.ok) throw new Error(jc.raison);
    if (!jp.ok) throw new Error(jp.raison);
    const etat = await require('./collecte-cartes/phase2-lecture').lireEtat({ uri: jc.uri, dbName: 'cartes', projectionsCartes: api.projectionsEtat.cartes, projectionsLignes: api.projectionsEtat.cartesProduits });
    // les noms du catalogue (production, lecture seule) des 20 produits
    const { MongoClient } = require('mongodb');
    const cp = new MongoClient(jp.uri); await cp.connect();
    let noms;
    try { noms = new Map((await cp.db('test').collection('catalogue_produits').find({ idProduct: { $in: D.map(x => Number(x.id.split('|')[1])) } }, { projection: { idProduct: 1, name: 1 } }).toArray()).map(p => [p.idProduct, p.name])); } finally { await cp.close(); }
    const decider = async e => { const I = api.interneur(); return api.decider({ sets: e.sets.map(s => api.compacterSet(s, I)), docs: e.cartes.map(d => api.compacterCarte(d, I)), lignes: e.cartesProduits.map(l => api.compacterLigne(l, I)), metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false }); };
    const avant = await decider(etat);
    const servis = es => new Set(es.map(e => e.idProduct)).size;
    console.log(`DÉNOMINATEURS : sets ${etat.sets.length} · cartes ${etat.cartes.length} · cartes_produits ${etat.cartesProduits.length} · noms du catalogue lus ${noms.size}/${D.length} · produits servis par l'API AVANT : ${servis(avant.entrees)}`);
    if (noms.size !== D.length) throw new Error(`${D.length - noms.size} nom(s) de catalogue introuvable(s) : rien ne se juge`);

    // ── 1. la preuve de chaque ligne, rejouée par la fonction de l'outil d'écriture
    const lignes = new Map(etat.cartesProduits.map(l => [l._id, l])), cartes = new Map(etat.cartes.map(c => [c._id, c]));
    const fautes = [], rangs = [];
    console.log(`\nPREUVE REJOUÉE (jugerLigne, ${D.length} lignes) :`);
    for (const x of D) {
        const idp = Number(x.id.split('|')[1]), l = lignes.get(x.id);
        if (!l) { fautes.push(`${x.id} : absente de la base`); continue; }
        const autres = etat.cartesProduits.filter(t => t.idProduct === idp && t._id !== x.id).length;
        const verdict = DL.jugerLigne(x, noms.get(idp), cartes.get(l.carteId), null, { autres }).verdict;
        const justes = x.justes.map(j => ({ j, ligne: etat.cartesProduits.some(t => t.idProduct === j && t.carteId === l.carteId) }));
        const sansLigneJuste = justes.filter(j => !j.ligne);
        if (!verdict) fautes.push(`${x.id} « ${noms.get(idp)} » : la preuve ne tient plus (produit ou carte différents de ceux regardés)`);
        if (sansLigneJuste.length) fautes.push(`${x.id} : produit(s) juste(s) sans ligne sur la carte : ${sansLigneJuste.map(j => j.j).join(',')}`);
        if (autres) fautes.push(`${x.id} : le produit a ${autres} AUTRE(S) ligne(s) : il ne serait pas « sans ligne »`);
        console.log(`   ${verdict && !sansLigneJuste.length && !autres ? '✅' : '🔴'} ${x.id} ${noms.get(idp)} · carte « ${cartes.get(l.carteId)?.nomEn} » (${l.slugSet} n°${l.numeroFiche ?? '-'}) · ligne posée par ${l.preuve} · justes gardés : ${x.justes.join(', ')}`);
        rangs.push({ idProduct: idp, ligne: x.id, carteId: l.carteId, carteNom: cartes.get(l.carteId)?.nomEn, set: l.slugSet, numero: l.numeroFiche ?? null, preuveLigne: l.preuve, nomCm: noms.get(idp), justes: x.justes, vu: x.vu });
    }
    if (fautes.length) { console.error(`\n🔴 ${fautes.length} faute(s) :\n   ${fautes.join('\n   ')}`); process.exitCode = 1; return; }

    // ── 2. la décision de l'API, avant / après
    const sim = P.detacherEnMemoire(etat, D.map(x => x.id));
    const etatApres = { ...etat, cartes: sim.cartes, cartesProduits: sim.cartesProduits };
    const apres = await decider(etatApres);
    const cibles = D.map(x => Number(x.id.split('|')[1]));
    const cmp = P.compareEntrees(avant.entrees, apres.entrees, cibles);
    const dA = avant.denominateurs, dB = apres.denominateurs;
    console.log(`\nSIMULATION DE L'API (decider, base entière) — avant → après`);
    console.log(`   produits servis ${servis(avant.entrees)} → ${servis(apres.entrees)} · entrées ${dA.ecrites} → ${dB.ecrites}`);
    console.log(`   produits PERDUS : ${cmp.perdus.length} (${cmp.perdus.join(', ')}) · les ${cibles.length} cibles toutes perdues : ${cibles.every(c => cmp.perdus.includes(c))} · AUTRES perdus : ${cmp.autresPerdus.length ? cmp.autresPerdus.join(',') : '0'} · CHANGÉS : ${cmp.changes.length ? cmp.changes.join(',') : '0'} · GAGNÉS : ${cmp.gagnes.length ? cmp.gagnes.join(',') : '0'}`);
    console.log(`   refus de famille : ${JSON.stringify(dB.repliRefuse.parFamille)} (avant : ${JSON.stringify(dA.repliRefuse.parFamille)}) · partageIncoherent ${dA.partageIncoherent} → ${dB.partageIncoherent}`);
    console.log(`   VERDICT : ${cmp.ok ? '✅ exactement les 20 perdent leur ligne (donc leur visuel), aucun autre produit ne bouge' : '🔴 ÉCHEC : un autre produit bouge'}`);
    const justes = [...new Set(D.flatMap(x => x.justes))];
    const justesIntacts = justes.every(j => JSON.stringify(avant.entrees.filter(e => e.idProduct === j)) === JSON.stringify(apres.entrees.filter(e => e.idProduct === j)));
    console.log(`   les ${justes.length} produits JUSTES nommés : entrées identiques avant / après : ${justesIntacts ? '✅' : '🔴'}`);
    const contrat = await GC.verifierContrat({ api, avant: { sets: etat.sets, cartes: etat.cartes, cartesProduits: etat.cartesProduits }, apres: { sets: etatApres.sets, cartes: etatApres.cartes, cartesProduits: etatApres.cartesProduits } });
    console.log(`   ${GC.ligneContrat(contrat)}`);
    console.log(`   CONTRAT : ${contrat.nouveaux.length ? `🔴 ${contrat.nouveaux.length} refus NOUVEAU(X) : ${contrat.nouveaux.map(n => `${n.idProduct} ${sans(n.motif)}`).join(' ; ')}` : '✅ zéro refus nouveau'}`);

    // ── 3. la règle du site, rejouée sur les sets touchés
    const H = require('./collecte-cartes/h-fix-site');
    const R = await H.chargerRegle({ racine: __dirname, siteLib: SITE_LIB });
    const sTouches = [...new Set(D.map(x => lignes.get(x.id).slugSet))];
    const setsT = etat.sets.filter(s => sTouches.includes(s._id)), exps = new Set(setsT.flatMap(s => [].concat(s.idExpansion ?? [])));
    const servSite = (cs, ls) => H.servir(R, { sets: setsT, cartes: cs, lignes: ls.filter(l => exps.has(l.idExpansion)) });
    const sa = servSite(etat.cartes, etat.cartesProduits), sb = servSite(sim.cartes, sim.cartesProduits), dif = H.diff(sa, sb);
    const perdusSite = dif.filter(d => d.nature.startsWith('PRODUIT PERDU') || d.nature === 'produit sorti de la sortie');
    const autresSite = dif.filter(d => !(d.nature.startsWith('PRODUIT PERDU') || d.nature === 'produit sorti de la sortie'));
    const dansD = k => cibles.some(c => k.split('|')[1] === String(c));
    console.log(`   SITE (règle importée, ${sTouches.length} sets) : ${sa.size} produits rejoués · ${dif.length} différence(s) : ${perdusSite.length} produit(s) qui perdent leur fiche (${perdusSite.every(d => dansD(d.k)) ? 'tous dans la décision' : '🔴 HORS décision : ' + perdusSite.filter(d => !dansD(d.k)).map(d => d.k).join(' ; ')}) · autres différences : ${autresSite.length}${autresSite.length ? ' → ' + autresSite.slice(0, 10).map(d => `${d.k} ${d.nature}`).join(' ; ') : ''}`);
    const siteOk = !autresSite.length && perdusSite.every(d => dansD(d.k)) && cibles.every(c => perdusSite.some(d => d.k.split('|')[1] === String(c)));
    console.log(`   SITE : ${siteOk ? '✅ seuls les 20 produits quittent leur fiche ; aucune autre fiche ne change' : '🔴 ÉCART INATTENDU (voir ci-dessus)'}`);

    // ── 4. la garde de lot : ce qu'elle compterait, et l'annonce exacte
    const GL = require('./collecte-cartes/garde-lot');
    const cm = GL.comparer(GL.compterEtat({ cartes: etat.cartes, cartesProduits: etat.cartesProduits, sets: etat.sets }), GL.compterEtat({ cartes: sim.cartes, cartesProduits: sim.cartesProduits, sets: etat.sets }));
    const annonce = Object.fromEntries(cm.baisses.filter(b => !b.autorisee).map(b => [b.cle, b.baisse]));
    GL.validerAnnonces(annonce);
    console.log(`   GARDE DE LOT (simulée) : ${cm.baisses.length} baisse(s), ${cm.nonAutorisees.length} non autorisée(s) → annonce ${JSON.stringify(annonce)} · hausses ${JSON.stringify(cm.hausses)}`);
    if (!cmp.ok || !justesIntacts || contrat.nouveaux.length || !siteOk) { console.error('🔴 ARRÊT : l\'essai ne tient pas ; rien ne s\'écrit.'); process.exitCode = 1; return; }
    const f = ecrireFichier('annonce-lot-D.json', JSON.stringify(annonce, null, 1));
    ecrireFichier('essai-lot-D.json', JSON.stringify({ decision: DECISION, lignes: rangs, api: { servisAvant: servis(avant.entrees), servisApres: servis(apres.entrees), perdus: cmp.perdus, autresPerdus: cmp.autresPerdus, changes: cmp.changes, gagnes: cmp.gagnes }, contrat: { nouveaux: contrat.nouveaux.length, persistants: contrat.persistants.length }, site: { differences: dif.length, perdus: perdusSite.length, autres: autresSite.length }, annonce }, null, 1));
    console.log(`\n(essai à blanc : annonce écrite dans ${f} ; écriture sous lot-additif : node lot-additif.js --quoi="PHASE 2 v2 : détacher 20 lignes fausses" --collections=restes --annonce=${f} -- node detacher-lignes-prouvees.js --decision=${DECISION} --ecrire)`);
})().catch(e => { console.error('❌', sans(e.stack || e.message)); process.exitCode = 1; });
