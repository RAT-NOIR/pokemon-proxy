'use strict';
// node audit-catalogue/lancer-etat.js  — mesures 1 (sets), 2 (fiches) et 3 (visuels, sans les classes à seuil). LECTURE SEULE.
//   NODE_PATH = node_modules du dépôt principal (aucune jonction). Écrit dans S8\AUDIT\ : etat-produits.json, mesure-sets.json, resume-etat.json.
const { ouvrirLecture, chargerDonnees, rejouerApi, assembler, mesurerSets, controlerTemoin, chargerApi } = require('./etat-api');
const { ecrireJson } = require('./ecrire');
const { rapprocher } = require('./rapprochement');
const { indexerDisque } = require('../collecte-cartes/staff-detect-io');

const compter = (xs, cle) => { const m = new Map(); for (const x of xs) for (const k of [].concat(cle(x))) m.set(k, (m.get(k) || 0) + 1); return Object.fromEntries([...m].sort((a, b) => b[1] - a[1])); };

(async () => {
    const t0 = Date.now();
    const api = await chargerApi();
    console.log(`API : ${api.dossier}`);
    const base = await ouvrirLecture();
    let donnees;
    try { donnees = await chargerDonnees(base, api); } finally { await base.fermer(); }
    const rejeu = await rejouerApi({ api, sets: donnees.sets, docs: donnees.docs, lignes: donnees.lignes, catalogue: donnees.catalogue });
    // M3 : les comptes de decider et ce que l'audit lit dans ses traces doivent CONCORDER — sinon on LÈVE (jamais un motif posé par élimination sur une API qui a changé)
    const rap = rapprocher({ d: rejeu.denominateurs, traces: [...rejeu.traces.values()].flat(), nLignes: donnees.lignes.length, nEntrees: rejeu.entrees.length });
    console.log(`RAPPROCHEMENT decider ✅ ${JSON.stringify(rap.comptes)}`);
    const { produits, horsPerimetre, entreesDuPerimetre } = assembler({ api, donnees, rejeu });
    if (entreesDuPerimetre !== rejeu.entrees.length) throw new Error(`${rejeu.entrees.length - entreesDuPerimetre} entrées de decider portent sur des produits hors du périmètre (cartes-code ?) : le rapprochement des produits servis ne tient plus`);
    const N = produits.length;
    console.log(`\nDÉNOMINATEUR : catalogue ${donnees.catalogue.length} − cartes-code ${horsPerimetre.length} = ${N} produits`);

    // ── mesure 1
    const sets = mesurerSets({ donnees, produits, horsPerimetre });
    console.log(`\n══ MESURE 1 — SETS : ${sets.expansionsExport} expansions dans l'export, ${sets.expansionsHorsCartesCode} avec des produits hors cartes-code (${sets.exSeulementCartesCode.length} ne contiennent que des cartes-code)`);
    const absentes = sets.lignesSet.filter(l => l.absente), incompletes = sets.lignesSet.filter(l => l.incomplete);
    console.log(`   ABSENTES (aucun set) : ${absentes.length} expansions, ${absentes.reduce((s, l) => s + l.produits, 0)} produits`);
    console.log(`   INCOMPLÈTES (un set, des produits sans ligne) : ${incompletes.length} expansions, ${incompletes.reduce((s, l) => s + l.sansLigne, 0)} produits sans ligne / ${incompletes.reduce((s, l) => s + l.produits, 0)}`);
    ecrireJson('mesure-sets.json', sets);

    // ── mesure 2
    const fiches = { classes: compter(produits, p => p.fiche.classe), motifsDouteuses: compter(produits.filter(p => p.fiche.classe === 'FICHE_DOUTEUSE'), p => p.fiche.motifs),
        motifsSansFiche: compter(produits.filter(p => p.fiche.classe === 'LIGNE_SANS_FICHE'), p => p.fiche.motifs),
        douteusesCumul: compter(produits.filter(p => p.fiche.classe === 'FICHE_DOUTEUSE'), p => String(p.fiche.motifs.length)) };
    const sansLigne = produits.filter(p => p.fiche.classe === 'SANS_LIGNE');
    fiches.sansLigneRecents = sansLigne.filter(p => p.idProduct >= 917000).length;
    fiches.sansLigneAnciens = sansLigne.length - fiches.sansLigneRecents;
    fiches.ligneSansFicheAutreCarte = produits.filter(p => p.fiche.classe === 'LIGNE_SANS_FICHE' && p.fiche.autreCarte).length;
    fiches.temoinMuet = produits.filter(p => p.fiche.temoinMuet).length;
    fiches.preuvesDesDouteusesNomSeul = compter(produits.filter(p => p.fiche.motifs.includes('preuve-nom-seul')), p => p.preuves);
    console.log(`\n══ MESURE 2 — FICHES (dénominateur ${N}) :`, JSON.stringify(fiches.classes), '\n   motifs des douteuses (non exclusifs) :', JSON.stringify(fiches.motifsDouteuses), '· par nombre de motifs :', JSON.stringify(fiches.douteusesCumul), '\n   motifs des LIGNE_SANS_FICHE :', JSON.stringify(fiches.motifsSansFiche),
        `\n   sans ligne : ${sansLigne.length} dont récents (idProduct ≥ 917000) ${fiches.sansLigneRecents}, anciens ${fiches.sansLigneAnciens} · ligne sans fiche dont la règle attribue le produit à une AUTRE carte : ${fiches.ligneSansFicheAutreCarte}`);

    // le témoin du nom SAIT-IL refuser ? (zéro contredite n'est une mesure que si le témoin crie sur un cas fabriqué)
    const ctl = controlerTemoin({ donnees, produits });
    fiches.controleTemoin = ctl;
    console.log(`   CONTRÔLE DU TÉMOIN : sur ${ctl.essais} fiches fabriquées FAUSSES (une autre carte du set, au nom différent), il en contredit ${ctl.contredits} (${(100 * ctl.contredits / Math.max(1, ctl.essais)).toFixed(1)} %) · sur ${ctl.vraiesTestees} vraies fiches il se tait ${ctl.silenceSurLaVraie} fois`);
    // le résumé par langue, famille et type (mesure 1)
    const ventiler = (cle) => { const m = new Map(); for (const l of sets.lignesSet) { const k = cle(l); const e = m.get(k) || { expansions: 0, absentes: 0, incompletes: 0, produits: 0, sansLigne: 0 }; e.expansions++; e.absentes += l.absente ? 1 : 0; e.incompletes += l.incomplete ? 1 : 0; e.produits += l.produits; e.sansLigne += l.sansLigne; m.set(k, e); } return Object.fromEntries([...m].sort((a, b) => b[1].produits - a[1].produits)); };
    sets.resume = { parLangue: ventiler(l => l.langue), parFamille: ventiler(l => l.famille), parType: ventiler(l => l.type || 'non-type'), tamponnees: ventiler(l => (l.tamponnee ? 'tamponnee' : 'ordinaire')),
        bandesSansLigne: { 'aucune': sets.lignesSet.filter(l => !l.absente && !l.sansLigne).length, 'moins de 10 %': sets.lignesSet.filter(l => l.sansLigne && l.partSansLigne < 0.1).length, '10 à 50 %': sets.lignesSet.filter(l => l.partSansLigne >= 0.1 && l.partSansLigne < 0.5 && !l.absente).length, '50 % et plus': sets.lignesSet.filter(l => l.partSansLigne >= 0.5 && !l.absente).length } };
    ecrireJson('mesure-sets.json', sets);
    console.log('   par langue :', JSON.stringify(sets.resume.parLangue));
    console.log('   par famille :', JSON.stringify(sets.resume.parFamille));
    console.log('   bandes de produits sans ligne par expansion :', JSON.stringify(sets.resume.bandesSansLigne));

    // ── mesure 3
    const visuels = { classes: compter(produits, p => p.visuel.classe), motifsManquant: compter(produits.filter(p => p.visuel.classe === 'MANQUANT'), p => p.visuel.motifs),
        manquantRefuseNature: compter(produits.filter(p => p.visuel.classe === 'MANQUANT' && p.visuel.refuse), p => `${p.visuel.refuse.famille}/${p.visuel.refuse.nature}`),
        motifsEmprunte: compter(produits.filter(p => p.visuel.classe === 'EMPRUNTE'), p => p.visuel.motifs), nature: compter(produits.filter(p => p.visuel.entree), p => p.visuel.entree.visuel),
        basseDefinitionToutes: produits.filter(p => p.visuel.entree?.basseDefinition === true).length, plusieursEntrees: produits.filter(p => p.visuel.plusieursEntrees).length };
    console.log(`\n══ MESURE 3 — VISUELS (dénominateur ${N}) :`, JSON.stringify(visuels.classes), '\n   MANQUANT par motif :', JSON.stringify(visuels.motifsManquant), '\n   dont REFUSÉS par repli (famille/nature du visuel écarté) :', JSON.stringify(visuels.manquantRefuseNature), '\n   EMPRUNTÉ par motif :', JSON.stringify(visuels.motifsEmprunte),
        `\n   servis par nature : ${JSON.stringify(visuels.nature)} · basseDefinition (toutes classes) ${visuels.basseDefinitionToutes} · produits à plusieurs entrées ${visuels.plusieursEntrees}`);
    // rapprochement avec decider : il compte par LIGNE, nous par produit
    const d = rejeu.denominateurs;
    console.log(`   decider (par LIGNE) : avecLigne ${d.avecLigne} · écrites ${d.ecrites} (du-set ${d.duSet}, substitut ${d.substitut}, autre-tirage ${d.autreTirage}) · aucun ${d.aucun} ${JSON.stringify(d.aucunDetail)} · sans fiche du site ${d.sansFicheDuSite} · repli refusé ${d.repliRefuse.total} ${JSON.stringify(d.repliRefuse.parFamille)} · partage incohérent ${d.partageIncoherent} · sansLigne (catalogue entier, cartes-code comprises) ${d.sansLigne}`);
    const servis = produits.filter(p => p.visuel.entree).length;
    console.log(`   entrées decider ${rejeu.entrees.length} · produits servis après lireEntree ${servis} · refusées par lireEntree : ${produits.filter(p => /^entree-refusee/.test(p.visuel.motifs[0] || '')).length}`);

    // ── paires comparables : une entrée servie ET une copie locale Cardmarket (le placeholder se juge à l'empreinte, plus tard)
    const idx = indexerDisque();
    const avecCopie = produits.filter(p => p.visuel.entree && idx.has(p.idProduct));
    const comparables = { servis, avecCopieLocale: avecCopie.length, sansCopieLocale: servis - avecCopie.length, copiesLocalesIndexees: idx.size,
        parClasse: compter(avecCopie, p => p.visuel.classe), produitsSansCopieLocale: compter(produits.filter(p => !idx.has(p.idProduct)), p => (p.idProduct >= 917000 ? 'recent>=917000' : 'ancien')) };
    console.log(`\n   PAIRES COMPARABLES (entrée servie ∧ copie locale Cardmarket indexée) : ${avecCopie.length} / ${servis} servis (copies locales indexées : ${idx.size}) · par classe ${JSON.stringify(comparables.parClasse)} · produits sans copie locale ${JSON.stringify(comparables.produitsSansCopieLocale)}`);

    const resume = { le: new Date().toISOString(), api: api.dossier, denominateur: { catalogue: donnees.catalogue.length, cartesCode: horsPerimetre.length, produits: N },
        sets: { expansionsExport: sets.expansionsExport, absentes: absentes.length, produitsDesAbsentes: absentes.reduce((s, l) => s + l.produits, 0), incompletes: incompletes.length }, fiches, visuels, decider: d, comparables };
    ecrireJson('resume-etat.json', resume, { indent: 1 });
    ecrireJson('etat-produits.json', produits.map(p => ({ ...p, copieLocale: idx.has(p.idProduct) })));
    console.log(`\n✅ écrit dans S8\\AUDIT : etat-produits.json (${produits.length}), mesure-sets.json (${sets.lignesSet.length}), resume-etat.json · ${Math.round((Date.now() - t0) / 1000)} s`);
})().catch(e => { console.error(String(e && e.stack || e).replace(/mongodb(\+srv)?:\/\/\S+/g, '<uri masquée>')); process.exit(1); });
