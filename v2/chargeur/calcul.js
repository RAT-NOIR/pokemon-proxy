'use strict';
// COTES-VISUELS, tour 1 — LE calcul d'un chargement, le même dans le fil de travail (production) et en ligne (bancs) : decider range ses résultats UN À UN dans le constructeur colonnaire.
// `version` vaut null quand rien n'est admissible (0 visuel) : le chargeur en fait un échec nommé, jamais une version vide.
const { creerConstructeur } = require('./version');

// ARCHIVE-EXCLUSIONS — L'ENDROIT UNIQUE où des produits nommés sont exclus de l'identification : ICI, dans `calculer` (le `sink.entree` ci-dessous + la passe qui suit decider). `exclusions` : Map idProduct → motif (la
// liste fermée de exclusions.js), ou null. RÈGLE (tour 1) : une exclusion retire un VISUEL, jamais une marque qui empêche d'affirmer un AUTRE produit. Un SECOND constructeur (`complet`) reçoit donc TOUT, exclus compris :
// les partages, les paires de variantes et les jumeaux se calculent sur l'ensemble COMPLET. Le constructeur de l'archive (`b`) ne reçoit pas l'entrée d'un exclu (aucune entrée de visuel, comme un produit du
// catalogue sans visuel) ; chaque voisin dont un partenaire de partage est exclu l'inscrit dans sa propre liste (`b.partageAvec`), puis `comparerMarques` PROUVE que toute marque d'un produit non exclu est celle de
// la construction complète : `partagesPerdus` doit valoir 0, sinon la construction est REFUSÉE. Les liens de fiche, les jumeaux, les prix mélangés et la carte du catalogue passent par d'autres rappels du sink et
// NE BOUGENT PAS ; un voisin qui partageait la même entrée d'image garde la sienne (l'exclusion porte sur l'idProduct). Sans `exclusions`, rien n'est suivi, rien n'est ajouté aux comptes : la sortie est celle d'avant.
// JUMBO-VISUEL — `jumbosVisuel` : null, ou la Map idProduct → 'emprunt' | 'sans-visuel' du fichier du catalogue (jumbos-visuel.js). Un JUMBO « emprunt » entre dans la colonne des emprunts (sans mention, sous son bandeau) ; un JUMBO
// « sans-visuel » reste une ENTRÉE COMPLÈTE (marqueurs, partages, groupe { JUMBO, normale }) mais est inscrit dans la colonne des masqués (format 5) : aucun visuel ne lui est servi. Ce n'est PAS une exclusion : l'exclusion retirerait
// aussi le produit des partages. Un masqué EXCLU par la liste d'exclusions n'a plus d'entrée donc n'est plus masqué (la marque suit l'entrée). Un nommé sans marqueur JUMBO dans le catalogue refuse la construction.
async function calculer({ sets, docs, lignes, metacarte, regle, decider = a => require('./decision').decider(a), exclusions = null, verdictsEmprunts = null, jumbosVisuel = null }) {
    const X = require('./exclusions');
    // MARQUE-EMPRUNT / VERDICTS : « exclu » rejoint les exclusions (motif visuel-faux ; un motif explicite de la liste prime) ; « juste » rend l'emprunt VÉRIFIÉ (il ne va pas dans la colonne des emprunts) ; null ou aucune ligne : l'emprunt reste non vérifié
    const verdicts = verdictsEmprunts instanceof Map ? verdictsEmprunts : null, parVerdict = new Set(), verifies = new Set();
    if (verdictsEmprunts !== null && verdictsEmprunts !== undefined && !verdicts) throw new Error('verdictsEmprunts : une Map idProduct → verdict est attendue');
    if (verdicts) {
        for (const [id, v] of verdicts) if (!Number.isSafeInteger(id) || id <= 0 || (v !== 'juste' && v !== 'exclu' && v !== null)) throw new Error('verdictsEmprunts : ligne illisible pour ' + id);
        const m = new Map(exclusions || []);
        for (const [id, v] of verdicts) if (v === 'exclu' && !m.has(id)) { m.set(id, 'visuel-faux'); parVerdict.add(id); }
        if (m.size) exclusions = m;
    }
    const suivi = exclusions === null || exclusions === undefined ? null : X.suivre(exclusions);
    const masquesDecides = new Set();                                                                  // JUMBO-VISUEL : un masqué n'est jamais « vérifié » par un verdict d'emprunt (son scan n'est pas le sien)
    const b = creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true });       // JUMBO-VISUEL : la colonne des masqués (format 5) est toujours écrite, vide s'il n'y en a pas ; MARQUE-EMPRUNT : la colonne des emprunts (format 3) est toujours écrite, vide s'il n'y en a pas ; REPLI-REIMPRESSIONS : la colonne des marquages (format 2) est toujours écrite, même quand aucun produit n'est marqué (« aucun » est une réponse, l'absence de colonne n'en est pas une)
    const complet = suivi ? creerConstructeur({ marquages: true, emprunts: true, ecrits: true, masques: true }) : null;
    const r = await decider({ sets, docs, lignes, metacarte, regle, cederLaMain: true, ...(jumbosVisuel ? { jumbosVisuel } : {}), sink: {
        // JUMBO-VISUEL : la marque d'un masqué exclu ne va pas dans l'archive (plus d'entrée) ; le constructeur complet la garde (comparerMarques)
        masque: id => { masquesDecides.add(id); if (complet) complet.masque(id); if (!(exclusions && exclusions.has(id))) b.masque(id); },
        entree: e => { if (complet) complet.entree(e); return suivi && suivi.retenir(e) ? undefined : b.entree(e); },
        lien: (s, c, i) => { if (complet) complet.lien(s, c, i); return b.lien(s, c, i); },
        jumeau: j => { if (complet) complet.jumeau(j); return b.jumeau(j); },
        melange: id => { if (complet) complet.melange(id); return b.melange(id); },
        // MARQUE-EMPRUNT : la marque d'un produit exclu ne va pas dans l'archive (il n'y a plus d'entrée) ; le constructeur complet la garde (comparerMarques)
        emprunt: id => { if (verdicts && verdicts.get(id) === 'juste' && !masquesDecides.has(id)) { verifies.add(id); return; } if (complet) complet.emprunt(id); if (!(exclusions && exclusions.has(id))) b.emprunt(id); } } });
    // JUMBO-VISUEL : une liste incohérente avec le catalogue (un nommé sans marqueur JUMBO) ne se sert pas en silence — la validation d'entrée refuserait son entrée sans mention, et un autre repli servirait le scan d'une autre carte
    const jv = r.denominateurs.jumbosVisuel;
    if (jv && jv.sansMarqueur.length) throw Object.assign(new Error('archive refusée'), { motif: `jumbos : ${jv.sansMarqueur.length} produit(s) nommé(s) par la liste sans marqueur JUMBO dans le catalogue (${jv.sansMarqueur.slice(0, 20).join(', ')}) : aucune construction` });
    const bilan = suivi ? suivi.bilan() : null;
    let marqueesDeLArchive = null;
    if (bilan) {
        let partagesPerdus = 0;
        if (b.etat().admises > 0 && complet.etat().admises > 0) {
            const VA = complet.finir();                                                                   // l'ensemble COMPLET : partages, paires et jumeaux comme sans --exclure
            for (const x of exclusions.keys()) {
                if (!VA.entree(x)) continue;
                for (const n of VA.partagesDe(x) || []) if (!exclusions.has(n)) b.partageAvec(n, x);      // le voisin garde le partenaire que l'exclu ne peut plus porter lui-même
            }
            const VB = b.finir();                                                                         // provisoire : ne porte pas encore les compteurs d'exclusion
            const cmp = X.comparerMarques(VA, VB, exclusions);
            if (cmp.perdus) throw Object.assign(new Error('archive refusée'), { motif: `${cmp.perdus} produit(s) non exclu(s) dont une marque (partage, jumeau, prix mélangé) diffère de la construction sans exclusion (partagesPerdus ${cmp.perdus}, par ex. ${cmp.ids.join(', ')}) : aucune construction` });
            partagesPerdus = cmp.perdus;
            marqueesDeLArchive = VB.comptes.marquees;
        }
        b.exclusions({ exclus: bilan.exclus, exclusParMotif: bilan.exclusParMotif, partagesPerdus });   // les compteurs voyagent dans les comptes de la version (donc de l'en-tête de l'archive)
    }
    const e = b.etat();
    const comptes = { sets: sets.length, cartes: docs.length, produits: lignes.length, catalogue: metacarte.size, visuels: e.admises, refusees: e.refusees, doublons: e.doublons, doublonsContradictoires: e.doublonsContradictoires, motifs: e.motifs, fichesLiees: e.fiches,
        setsAvecLiens: r.denominateurs.setsAvecLiens, produitsLies: r.denominateurs.produitsLies,
        ...(bilan ? { exclus: bilan.exclus, exclusParMotif: bilan.exclusParMotif, exclusSansVisuel: bilan.sansVisuel } : {}) };
    if (bilan) comptes.partagesPerdus = 0;                                                            // prouvé ci-dessus (sinon la construction a levé)
    const version = e.admises > 0 ? b.finir() : null;
    // LOT TAMPONS (B, tour 1) : le dénominateur des prix mélangés, imprimé par le chargeur, et la construction LÈVE si la colonne n'a pas EXACTEMENT les produits marqués de cartes_produits
    const dansColonne = version ? version.comptes.melange : 0, marquesLignes = r.denominateurs.melangeProduits ?? 0;
    if (version && dansColonne !== marquesLignes) throw new Error(`prix mélangés : produits marqués dans cartes_produits ${marquesLignes} ≠ dans la colonne ${dansColonne} — aucune version construite`);
    // MARQUE-EMPRUNT : le dénominateur de la décision (produits distincts dont l'entrée écrite est empruntée) face à la colonne. Égalité exigée quand rien ne peut légitimement retirer une entrée
    // (aucune exclusion, aucune entrée refusée, aucun doublon contradictoire) ; sinon la colonne ne peut qu'être plus petite.
    const empruntsDecides = (r.denominateurs.emprunts ?? 0) - verifies.size, empruntsColonne = version ? (version.comptes.emprunts ?? 0) : 0;
    const exacte = !bilan && e.refusees === 0 && e.doublonsContradictoires === 0;
    if (version && (exacte ? empruntsColonne !== empruntsDecides : empruntsColonne > empruntsDecides)) throw new Error(`emprunts : produits empruntés par la décision ${empruntsDecides} ≠ dans la colonne ${empruntsColonne} — aucune version construite`);
    // JUMBO-VISUEL : les masqués de la décision face à la colonne. Même règle que les emprunts : égalité quand rien ne peut légitimement retirer une entrée ; sinon la colonne ne peut qu'être plus petite.
    const masquesDecidesN = jv ? jv.sansVisuel : 0, masquesColonne = version && version.comptes.masques !== undefined ? version.comptes.masques : 0;
    if (version && (exacte ? masquesColonne !== masquesDecidesN : masquesColonne > masquesDecidesN)) throw new Error(`masqués : produits masqués par la décision ${masquesDecidesN} ≠ dans la colonne ${masquesColonne} — aucune version construite`);
    // ARCHIVE-4 : les produits décidés avec des marqueurs écrits face à la colonne. Égalité exigée quand rien ne peut légitimement retirer une entrée ou un marqueur (aucune exclusion, entrée refusée, doublon, contradiction) ; sinon la colonne ne peut qu'être plus petite.
    const ecritsDecides = r.denominateurs.marqueursEcrits ? r.denominateurs.marqueursEcrits.entrees : 0, ecritsColonne = version && version.comptes.ecrits ? version.comptes.ecrits.entrees : 0;
    const exacteEcrits = exacte && e.doublons === 0 && e.ecritsContradictoires === 0;
    if (version && (exacteEcrits ? ecritsColonne !== ecritsDecides : ecritsColonne > ecritsDecides)) throw new Error(`marqueurs écrits : produits décidés ${ecritsDecides} ≠ dans la colonne ${ecritsColonne} — aucune version construite`);
    return { version, comptes: { ...comptes, marqueursEcrits: { ...r.denominateurs.marqueursEcrits, colonne: version && version.comptes.ecrits ? version.comptes.ecrits : null, contradictoires: e.ecritsContradictoires }, melangeProduits: marquesLignes, melangeColonne: dansColonne, masquesProduits: masquesDecidesN, masquesColonne, jumbosVisuel: jv || null, baseSet: r.denominateurs.baseSet || null, empruntsProduits: empruntsDecides, empruntsColonne, empruntsVerifies: verifies.size, empruntsExclusParVerdict: bilan ? [...parVerdict].filter(id => !bilan.sansVisuel.some(x => x.idProduct === id)).length : 0, verdictsSansEmprunt: verdicts ? [...verdicts].filter(([id, v]) => v === 'juste' && !verifies.has(id)).length : 0, empruntsParNature: r.denominateurs.empruntsParNature, marquees: marqueesDeLArchive || r.denominateurs.marquees, repliRefuse: r.denominateurs.repliRefuse, familleHorsListe: r.denominateurs.familleHorsListe, basseDefinitionExclue: r.denominateurs.basseDefinitionExclue, partageIncoherent: r.denominateurs.partageIncoherent, varianteSansPreuve: r.denominateurs.varianteSansPreuve, varianteHorsListe: r.denominateurs.varianteHorsListe }, denominateurs: r.denominateurs };
}
module.exports = { calculer };
