'use strict';
// COLLECTION-COMPACTE — MESURE (ruling 2 et 4) sur la sauvegarde locale, SANS base ni réseau : la sauvegarde (Extended JSON) est lue en mémoire, la décision de COTES-VISUELS (`decider`, la règle du
// site EMBARQUÉE) construit l'archive des fiches LIÉES (fiches de l'archive), et la règle du site (`fichesDuDocument`, `setParImpression`) donne les fiches de TOUS les documents de chaque set.
//   node v2/test/mesure-chargeur/mesurer-collection.js [--sauvegarde=<dossier>] [--vers=<fichier.json>]
// Rend : par set, les clés de l'archive et celles de la règle du site ; le plafond « hors registre » = les clés de la règle du site qui ne sont PAS dans l'archive (par set, additionnées) ;
// le plus grand compte = max(total des fiches de la règle du site, fiches liées de l'archive) ; les fiches simples (idInterne < 0). Dénominateurs imprimés.
const fs = require('fs'); const path = require('path');
const arg = (n, d) => { const a = process.argv.find(x => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : d; };
const SAUVEGARDE = arg('sauvegarde', 'C:\\Users\\Yung\\Desktop\\pokemon-proxy\\backup-2026-10-10-lot-075226');
const EXPORT = path.join(__dirname, '..', '..', '..', 'products_singles_6.json');

(async () => {
    const { EJSON } = require('mongoose').mongo.BSON;
    const { decider, cleFiche } = require('../../chargeur/decision');
    const { regleEmbarquee } = require('../../chargeur/regle-site');
    const { compacterSet, compacterCarte, compacterLigne, interneur } = require('../../chargeur/source');
    const lire = nom => EJSON.deserialize(JSON.parse(fs.readFileSync(path.join(SAUVEGARDE, `${nom}.json`), 'utf8')));
    const I = interneur();
    const sets = lire('sets').map(d => compacterSet(d, I)), docs = lire('cartes').map(d => compacterCarte(d, I)), lignes = lire('cartes_produits').map(d => compacterLigne(d, I));
    const metacarte = new Map(JSON.parse(fs.readFileSync(EXPORT, 'utf8')).products.map(p => [p.idProduct, p.idMetacard]));
    const regle = await regleEmbarquee();
    console.log(`sauvegarde : sets ${sets.length} · cartes ${docs.length} · cartes_produits ${lignes.length} · catalogue ${metacarte.size}`);

    // 1. l'ARCHIVE : les fiches liées à au moins un produit, par set (le même `decider` que le chargeur)
    const archive = new Map();
    await decider({ sets, docs, lignes, metacarte, regle, cederLaMain: false, sink: { entree() { }, lien(setId, cle) { if (!archive.has(setId)) archive.set(setId, new Set()); archive.get(setId).add(cle); } } });

    // 2. la RÈGLE DU SITE sur tous les documents de chaque set (fichesDuDocument ; une par impression si aucun document n'est ambigu, sinon la première)
    const parSet = new Map();
    for (const d of docs) for (const s of d.sets || []) { if (!parSet.has(s)) parSet.set(s, []); parSet.get(s).push(d); }
    const site = new Map();
    for (const s of sets) {
        const membres = (parSet.get(s._id) || []).filter(d => typeof d.nomEn === 'string' && d.nomEn !== '');
        const tir = s.tirage ?? s.region, noms = [].concat(s.bulba?.expansion ?? []);
        const documents = membres.map(d => ({ d, fiches: regle.fichesDuDocument((d.impressions || []).filter(i => i && i.tirage === tir && noms.includes(i.expansion))), images: (d.images || []).filter(m => m && m.set === s._id) }));
        const parImpression = regle.setParImpression(documents);
        const cles = new Set();
        for (const { d, fiches } of documents) for (const f of (parImpression ? fiches : fiches.slice(0, 1))) cles.add(cleFiche(d._id, f.numero));
        if (cles.size) site.set(s._id, cles);
    }

    let nArchive = 0, nSite = 0, horsRegistre = 0, negArchive = 0, negSite = 0, negHors = 0, setsSansArchive = 0;
    const tailles = [], horsParSet = [];
    for (const [id, cles] of archive) { nArchive += cles.size; for (const c of cles) if (c.startsWith('-')) negArchive++; tailles.push(cles.size); }
    for (const [id, cles] of site) {
        nSite += cles.size; const a = archive.get(id) || new Set(); if (!a.size) setsSansArchive++;
        let h = 0; for (const c of cles) { if (c.startsWith('-')) negSite++; if (!a.has(c)) { h++; if (c.startsWith('-')) negHors++; } }
        horsRegistre += h; if (h) horsParSet.push([id, h]);
    }
    // les fiches de l'archive que la règle du site ne donne pas (la règle embarquée peut différer du site)
    let archiveSansSite = 0; for (const [id, cles] of archive) { const s = site.get(id) || new Set(); for (const c of cles) if (!s.has(c)) archiveSansSite++; }
    tailles.sort((a, b) => b - a);
    const cartesNegatives = docs.filter(d => d._id < 0).length;
    const sortie = {
        denominateurs: { sets: sets.length, cartes: docs.length, lignes: lignes.length, catalogue: metacarte.size, setsAvecArchive: archive.size, setsAvecFichesDuSite: site.size },
        archive: { fiches: nArchive, plusGrosSet: tailles[0], mediane: tailles[Math.floor(tailles.length / 2)], fichesSimples: negArchive },
        regleDuSite: { fiches: nSite, setsSansFicheLiee: setsSansArchive, fichesSimples: negSite },
        horsRegistre: { total: horsRegistre, setsConcernes: horsParSet.length, fichesSimplesParmiElles: negHors, plusGrosSet: horsParSet.sort((a, b) => b[1] - a[1]).slice(0, 5) },
        archiveSansLaRegleDuSite: archiveSansSite,
        plusGrandCompte: Math.max(nSite, nArchive, nSite - 0 + 0),
        cartesAIdNegatif: cartesNegatives,
        clesSimples: [...archive.values()].flatMap(s => [...s]).filter(c => c.startsWith('-')).slice(0, 5)
    };
    console.log(JSON.stringify(sortie, null, 1));
    const vers = arg('vers', null);
    if (vers) fs.writeFileSync(vers, JSON.stringify({ ...sortie, taillesArchive: tailles, parSet: [...site].map(([id, c]) => [id, c.size, (archive.get(id) || new Set()).size]) }));
    process.exit(0);
})().catch(e => { console.error('❌ mesure :', e); process.exit(1); });
