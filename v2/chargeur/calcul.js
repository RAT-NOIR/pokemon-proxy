'use strict';
// COTES-VISUELS, tour 1 — LE calcul d'un chargement, le même dans le fil de travail (production) et en ligne (bancs) : decider range ses résultats UN À UN dans le constructeur colonnaire.
// `version` vaut null quand rien n'est admissible (0 visuel) : le chargeur en fait un échec nommé, jamais une version vide.
const { creerConstructeur } = require('./version');

async function calculer({ sets, docs, lignes, metacarte, regle, decider = a => require('./decision').decider(a) }) {
    const b = creerConstructeur({ marquages: true });         // REPLI-REIMPRESSIONS : la colonne des marquages (format 2) est toujours écrite, même quand aucun produit n'est marqué (« aucun » est une réponse, l'absence de colonne n'en est pas une)
    const r = await decider({ sets, docs, lignes, metacarte, regle, cederLaMain: true, sink: { entree: e => b.entree(e), lien: (s, c, i) => b.lien(s, c, i), jumeau: j => b.jumeau(j), melange: id => b.melange(id) } });
    const e = b.etat();
    const comptes = { sets: sets.length, cartes: docs.length, produits: lignes.length, catalogue: metacarte.size, visuels: e.admises, refusees: e.refusees, doublons: e.doublons, doublonsContradictoires: e.doublonsContradictoires, motifs: e.motifs, fichesLiees: e.fiches,
        setsAvecLiens: r.denominateurs.setsAvecLiens, produitsLies: r.denominateurs.produitsLies };
    const version = e.admises > 0 ? b.finir() : null;
    // LOT TAMPONS (B, tour 1) : le dénominateur des prix mélangés, imprimé par le chargeur, et la construction LÈVE si la colonne n'a pas EXACTEMENT les produits marqués de cartes_produits
    const dansColonne = version ? version.comptes.melange : 0, marquesLignes = r.denominateurs.melangeProduits ?? 0;
    if (version && dansColonne !== marquesLignes) throw new Error(`prix mélangés : produits marqués dans cartes_produits ${marquesLignes} ≠ dans la colonne ${dansColonne} — aucune version construite`);
    return { version, comptes: { ...comptes, melangeProduits: marquesLignes, melangeColonne: dansColonne, marquees: r.denominateurs.marquees, repliRefuse: r.denominateurs.repliRefuse, familleHorsListe: r.denominateurs.familleHorsListe, basseDefinitionExclue: r.denominateurs.basseDefinitionExclue, partageIncoherent: r.denominateurs.partageIncoherent, varianteSansPreuve: r.denominateurs.varianteSansPreuve, varianteHorsListe: r.denominateurs.varianteHorsListe }, denominateurs: r.denominateurs };
}
module.exports = { calculer };
