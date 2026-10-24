'use strict';
// LE RAPPROCHEMENT AVEC `decider` (M3, relecture indépendante de c-audit 32b86816) : les comptes que `decider` écrit (ses dénominateurs, PAR LIGNE) et ce que l'audit a lu dans ses traces
// (une trace par ligne qui atteint choisirVisuel) doivent CONCORDER, et la fonction LÈVE sinon. Avant, `partage-incoherent` tombait par élimination : une exclusion NOUVELLE de l'API aurait
// été mal étiquetée sans bruit. Maintenant le reste (traces avec visuel, sans repli) doit valoir EXACTEMENT « écrites + partage incohérent » ; toute autre exclusion fait diverger un compte.
// Pure : elle reçoit les dénominateurs, les traces, deux totaux ; elle ne lit rien.
/**
 * @param {{ d: object, traces: Array<{sansFiche:boolean, im:object|null, refus:string|null}>, nLignes: number, nEntrees: number }} e
 *   `d` : `denominateurs` de decider ; `traces` : TOUTES les traces (une par ligne) ; `nLignes` : les lignes cartes_produits lues ; `nEntrees` : les entrées que decider a rendues.
 * @returns {{ ok: true, comptes: object }}
 */
function rapprocher({ d, traces, nLignes, nEntrees }) {
    const ecarts = [];
    const compare = (quoi, lu, ecrit) => { if (lu !== ecrit) ecarts.push(`${quoi} : audit ${lu} ≠ decider ${ecrit}`); };
    const sansFiche = traces.filter(t => t.sansFiche).length;
    const aucunVisuel = traces.filter(t => !t.sansFiche && !t.im).length;
    const repli = traces.filter(t => !t.sansFiche && t.im && t.refus).length;
    const reste = traces.filter(t => !t.sansFiche && t.im && !t.refus).length;
    const sansTrace = nLignes - traces.length;
    compare('lignes lues et lignes comptées par decider (avecLigne)', nLignes, d.avecLigne);
    compare('écrites (entrées rendues par decider)', nEntrees, d.ecrites);
    compare('sans fiche du site', sansFiche, d.sansFicheDuSite);
    compare('aucun visuel', aucunVisuel, d.aucunDetail['aucun visuel']);
    compare('aucun set candidat + carte absente (lignes sans trace)', sansTrace, d.aucunDetail['aucun set candidat'] + d.aucunDetail['carte absente']);
    compare('repli refusé', repli, d.repliRefuse.total);
    compare('partage incohérent (reste − écrites)', reste - nEntrees, d.partageIncoherent);
    if (ecarts.length) throw new Error(`rapprochement avec decider : l'API a changé ou la lecture est fausse — ${ecarts.join(' · ')}`);
    return { ok: true, comptes: { lignes: nLignes, ecrites: nEntrees, sansFiche, aucunVisuel, sansTrace, repli, partageIncoherent: reste - nEntrees } };
}

module.exports = { rapprocher };
