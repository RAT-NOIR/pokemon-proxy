'use strict';
// COTES-VISUELS, tour 1 — LE calcul d'un chargement, le même dans le fil de travail (production) et en ligne (bancs) : decider range ses résultats UN À UN dans le constructeur colonnaire.
// `version` vaut null quand rien n'est admissible (0 visuel) : le chargeur en fait un échec nommé, jamais une version vide.
const { creerConstructeur } = require('./version');

async function calculer({ sets, docs, lignes, metacarte, regle, decider = a => require('./decision').decider(a) }) {
    const b = creerConstructeur();
    const r = await decider({ sets, docs, lignes, metacarte, regle, cederLaMain: true, sink: { entree: e => b.entree(e), lien: (s, c, i) => b.lien(s, c, i), jumeau: j => b.jumeau(j) } });
    const e = b.etat();
    const comptes = { sets: sets.length, cartes: docs.length, produits: lignes.length, catalogue: metacarte.size, visuels: e.admises, refusees: e.refusees, doublons: e.doublons, doublonsContradictoires: e.doublonsContradictoires, motifs: e.motifs, fichesLiees: e.fiches,
        setsAvecLiens: r.denominateurs.setsAvecLiens, produitsLies: r.denominateurs.produitsLies };
    return { version: e.admises > 0 ? b.finir() : null, comptes, denominateurs: r.denominateurs };
}
module.exports = { calculer };
