// PHASE 2 v2, volet 2 — MESURE SEULE (lecture seule, rien n'est écrit) : pour chacun des 13 produits « autre impression du même dessin », le vocabulaire de variantes de l'API
// (marques-tampon.js : marques, jumbo, normale) permet-il de le séparer d'un produit juste qui partage son entrée ? Le jeton exact, ou « aucun jeton » ; essai à blanc avec la VRAIE decider.
//   node mesure-variantes-phase2.js
// Deux scénarios, chacun rejoué sur la base ENTIÈRE : « exclusion » (le juste prend « normale », l'entrée se déclare séparée par la variante, les cibles n'ont aucun jeton : elles sortent) et
// « jeton » (en plus, une cible qui a un jeton le reçoit : elle reste servie, distinguée).
const P = require('./collecte-cartes/phase2-visuels');
const V = require('./collecte-cartes/phase2-variantes');
const GC = require('./collecte-cartes/garde-contrat-api');
require('dotenv').config({ quiet: true });
if (!process.env.MONGODB_CARTES_LECTURE_URI) require('dotenv').config({ path: 'C:/Users/Yung/Desktop/pokemon-proxy/.env', quiet: true });
const sans = u => String(u ?? '').replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>');

// CE QUI A ÉTÉ LU À L'ŒIL (lot B et lot C) : la table LU vit dans collecte-cartes/phase2-variantes.js (PHASE 3b : l'outil d'écriture separer-variantes-phase2.js la lit au même endroit).
const LU = V.LU;

(async () => {
    const api = await GC.chargerApi();
    const { jugerLecture } = require('./collecte-cartes/base-banc');
    const jc = jugerLecture(process.env, 'cartes');
    if (!jc.ok) throw new Error(jc.raison);
    const etat = await require('./collecte-cartes/phase2-lecture').lireEtat({ uri: jc.uri, dbName: 'cartes', projectionsCartes: api.projectionsEtat.cartes, projectionsLignes: api.projectionsEtat.cartesProduits });
    const decider = async e => { const I = api.interneur(); return api.decider({ sets: e.sets.map(s => api.compacterSet(s, I)), docs: e.cartes.map(d => api.compacterCarte(d, I)), lignes: e.cartesProduits.map(l => api.compacterLigne(l, I)), metacarte: new Map([[-1, 1]]), regle: api.regle, cederLaMain: false }); };
    const avant = await decider(etat);
    const servis = es => new Set(es.map(e => e.idProduct));
    const sA = servis(avant.entrees);
    console.log(`DÉNOMINATEURS : sets ${etat.sets.length} · cartes ${etat.cartes.length} · cartes_produits ${etat.cartesProduits.length} · produits servis AVANT ${sA.size}`);
    const cibles13 = P.ECARTES.filter(x => x.geste === 'emprunt');
    if (cibles13.length !== 13) throw new Error(`${cibles13.length} cibles « emprunt » au lieu de 13`);

    // les groupes : une entrée, ses cibles, ses justes ; les produits servis par la clé doivent être EXACTEMENT les cibles et les justes
    const groupes = V.construireGroupes({ cibles: cibles13, servisParCle: P.produitsServisParCle(avant.entrees), api });   // la MÊME fonction que l'outil d'écriture (PHASE 3b)
    console.log(`\n${groupes.length} entrées, ${cibles13.length} cibles, ${groupes.flatMap(g => g.justes).length} produits justes à garder.`);

    console.log('\nLE JETON, PRODUIT PAR PRODUIT (lu à l\'œil, vérifié contre la liste de l\'API) :');
    for (const g of groupes) for (const c of g.cibles) {
        const l = LU.get(c.idProduct);
        console.log(`   ${c.idProduct} : ${l.quoi} → ${c.jeton ? `jeton « ${c.jeton} » (existe)` : l.marque ? `« ${l.marque} » n'est PAS dans la liste de l'API` : 'AUCUN JETON (finition / tampon d\'un autre nom : hors vocabulaire)'}`);
    }

    const dossier = {};
    for (const scenario of ['exclusion', 'jeton']) {
        const sim = V.simulerSeparation(etat, groupes, scenario);
        const etatApres = { ...etat, cartes: sim.cartes, cartesProduits: sim.cartesProduits };
        const apres = await decider(etatApres);
        const sB = servis(apres.entrees);
        const lesCibles = cibles13.map(x => x.idProduct), lesJustes = groupes.flatMap(g => g.justes);
        const cmp = P.compareEntrees(avant.entrees, apres.entrees, scenario === 'exclusion' ? lesCibles : lesCibles.filter(id => !groupes.some(g => g.cibles.some(c => c.idProduct === id && c.jeton))));
        console.log(`\n══ SCÉNARIO « ${scenario} » — decider sur la base entière, avant → après`);
        console.log(`   produits servis ${sA.size} → ${sB.size} · partageIncoherent ${avant.denominateurs.partageIncoherent} → ${apres.denominateurs.partageIncoherent}`);
        const statut = id => sB.has(id) ? 'SERVI' : 'NON SERVI';
        for (const g of groupes) {
            console.log(`   entrée ${g.set} n°${g.numero ?? '-'} (${g.cleR2})`);
            for (const j of g.justes) { const e1 = apres.entrees.find(e => e.idProduct === j), e0 = avant.entrees.find(e => e.idProduct === j); console.log(`      juste  ${j} : ${statut(j)}${sB.has(j) ? ` · même fichier ${e1.grande?.cle === e0.grande?.cle} · variante ${e1.variante} · partageeTamponNonSepare ${e1.partageeTamponNonSepare}` : ''}`); }
            for (const c of g.cibles) { const e1 = apres.entrees.find(e => e.idProduct === c.idProduct); console.log(`      cible  ${c.idProduct} : ${statut(c.idProduct)}${sB.has(c.idProduct) ? ` · variante ${e1.variante}` : ''}`); }
        }
        const ciblesServies = lesCibles.filter(id => sB.has(id)), justesPerdus = lesJustes.filter(id => !sB.has(id));
        console.log(`   BILAN : cibles encore servies ${ciblesServies.length} (${ciblesServies.join(',') || '—'}) · justes qui ne sont plus servis ${justesPerdus.length} (${justesPerdus.join(',') || '—'}) · AUTRES produits perdus ${cmp.perdus.filter(id => !lesCibles.includes(id)).length} · gagnés ${cmp.gagnes.length}`);
        const changesHorsJustes = cmp.changes.filter(id => !lesJustes.includes(id) && !lesCibles.includes(id));
        console.log(`   produits CHANGÉS : ${cmp.changes.length} dont ${cmp.changes.filter(id => lesJustes.includes(id)).length} justes (variante + marquage, visuel identique) et ${changesHorsJustes.length} hors décision${changesHorsJustes.length ? ' : ' + changesHorsJustes.join(',') : ''}`);
        const visuelDuJusteInchange = lesJustes.every(j => { const a = avant.entrees.find(e => e.idProduct === j), b = apres.entrees.find(e => e.idProduct === j); return b && a.grande?.cle === b.grande?.cle && a.vignette?.cle === b.vignette?.cle && a.visuel === b.visuel; });
        console.log(`   visuel des justes inchangé : ${visuelDuJusteInchange ? '✅' : '🔴'}`);
        const contrat = await GC.verifierContrat({ api, avant: { sets: etat.sets, cartes: etat.cartes, cartesProduits: etat.cartesProduits }, apres: { sets: etatApres.sets, cartes: etatApres.cartes, cartesProduits: etatApres.cartesProduits } });
        console.log(`   ${GC.ligneContrat(contrat)} · CONTRAT : ${contrat.nouveaux.length ? `🔴 ${contrat.nouveaux.length} refus nouveau(x) : ${contrat.nouveaux.slice(0, 5).map(n => `${n.idProduct} ${sans(n.motif)}`).join(' ; ')}` : '✅ zéro refus nouveau'}`);
        dossier[scenario] = { ciblesServies, justesPerdus, autresPerdus: cmp.perdus.filter(id => !lesCibles.includes(id)), contratNouveaux: contrat.nouveaux.length };
    }
    const sansJeton = [...groupes.flatMap(g => g.cibles)].filter(c => !c.jeton).map(c => c.idProduct);
    console.log(`\nCONCLUSION MESURÉE : « exclusion » : cibles encore servies ${dossier.exclusion.ciblesServies.length}, justes perdus ${dossier.exclusion.justesPerdus.length}, contrat ${dossier.exclusion.contratNouveaux} · « jeton » : cibles encore servies ${dossier.jeton.ciblesServies.length} (${dossier.jeton.ciblesServies.join(',')}).`);
    console.log(`JETON EXACT : ${groupes.flatMap(g => g.cibles).filter(c => c.jeton).map(c => `${c.idProduct} « ${c.jeton} »`).join(', ')} · AUCUN JETON : ${sansJeton.join(', ')}.`);
})().catch(e => { console.error('❌', sans(e.stack || e.message)); process.exitCode = 1; });
