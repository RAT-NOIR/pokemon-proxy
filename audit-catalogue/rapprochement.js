'use strict';
// LE RAPPROCHEMENT AVEC `decider` (M3, relecture indépendante de c-audit 32b86816) : les comptes que `decider` écrit (ses dénominateurs, PAR LIGNE) et ce que l'audit a lu dans ses traces
// (une trace par ligne qui atteint choisirVisuel) doivent CONCORDER, et la fonction LÈVE sinon. Avant, `partage-incoherent` tombait par élimination : une exclusion NOUVELLE de l'API aurait
// été mal étiquetée sans bruit. Maintenant le reste (traces avec visuel, sans repli) doit valoir EXACTEMENT « écrites + partage incohérent » ; toute autre exclusion fait diverger un compte.
// Pure : elle reçoit les dénominateurs, les traces, deux totaux ; elle ne lit rien.
// ADMISSION-CATALOGUE (API 1b305419, 2026-10-27) : decider agit APRÈS choisirVisuel, là où la trace ne voit rien. (a) Il ADMET des lignes que la trace voit « aucun visuel » ou « repli »
// (scan prv d'une position, emprunt WCD : `admisCatalogue`, compté quand l'entrée est écrite) ; (b) il ÉCARTE des lignes que la trace voit servies (`positionContredite`). Les équations restent
// EXACTES : une admission ne fait que RETIRER de « aucun visuel » et du repli (par famille aussi), et le reste tombe juste sur « écrites + partage + contredites − admises de aucun/repli ».
// Une exclusion inconnue fait toujours diverger ce dernier compte. ⚠️ Limite nommée : les produits à position contredite sans autre entrée prennent le motif « partage-incohérent »
// par élimination dans etat-api.js (motifManquant) — leur NOMBRE est rendu ici (`positionContredite`), jamais sous-entendu.
/**
 * @param {{ d: object, traces: Array<{sansFiche:boolean, im:object|null, refus:string|null}>, nLignes: number, nEntrees: number }} e
 *   `d` : `denominateurs` de decider ; `traces` : TOUTES les traces (une par ligne) ; `nLignes` : les lignes cartes_produits lues ; `nEntrees` : les entrées que decider a rendues.
 * @returns {{ ok: true, comptes: object }}
 */
function rapprocher({ d, traces, nLignes, nEntrees }) {
    const ecarts = [];
    const compare = (quoi, lu, ecrit) => { if (lu !== ecrit) ecarts.push(`${quoi} : audit ${lu} ≠ decider ${ecrit}`); };
    // une version de decider qui ne porte pas ces deux compteurs n'est pas celle que cet outil sait lire : on ne suppose jamais 0
    if (!d.admisCatalogue || typeof d.admisCatalogue !== 'object' || !Number.isInteger(d.positionContredite)) throw new Error('rapprochement avec decider : admisCatalogue ou positionContredite absent — version de l\'API que cet outil ne sait pas lire');
    const admis = Object.values(d.admisCatalogue).reduce((a, n) => a + n, 0), contredit = d.positionContredite;
    const sansFiche = traces.filter(t => t.sansFiche).length;
    const aucunVisuel = traces.filter(t => !t.sansFiche && !t.im).length;
    const repli = traces.filter(t => !t.sansFiche && t.im && t.refus).length;
    const reste = traces.filter(t => !t.sansFiche && t.im && !t.refus).length;
    const sansTrace = nLignes - traces.length;
    compare('lignes lues et lignes comptées par decider (avecLigne)', nLignes, d.avecLigne);
    compare('écrites (entrées rendues par decider)', nEntrees, d.ecrites);
    compare('sans fiche du site', sansFiche, d.sansFicheDuSite);
    compare('aucun set candidat + carte absente (lignes sans trace)', sansTrace, d.aucunDetail['aucun set candidat'] + d.aucunDetail['carte absente']);
    // une admission ne fait que retirer : decider ne compte jamais PLUS que les traces, ni au total ni par famille de repli
    const prisAucun = aucunVisuel - d.aucunDetail['aucun visuel'], prisRepli = repli - d.repliRefuse.total;
    if (prisAucun < 0) ecarts.push(`aucun visuel : audit ${aucunVisuel} < decider ${d.aucunDetail['aucun visuel']} (une admission ne fait que retirer)`);
    if (prisRepli < 0) ecarts.push(`repli refusé : audit ${repli} < decider ${d.repliRefuse.total} (une admission ne fait que retirer)`);
    const parFamille = {};
    for (const t of traces) if (!t.sansFiche && t.im && t.refus) parFamille[t.refus] = (parFamille[t.refus] || 0) + 1;
    for (const [f, n] of Object.entries(d.repliRefuse.parFamille || {})) if (n > (parFamille[f] || 0)) ecarts.push(`repli refusé « ${f} » : audit ${parFamille[f] || 0} < decider ${n}`);
    // ce que les traces ont perdu en « aucun visuel » et au repli ne peut venir que d'admissions écrites (le reste des admises vient de positions contredites puis admises)
    if (prisAucun + prisRepli > admis) ecarts.push(`admissions : les traces perdent ${prisAucun + prisRepli} lignes (aucun visuel ${prisAucun}, repli ${prisRepli}) mais decider n'en admet que ${admis}`);
    compare('partage incohérent (reste − écrites + admises de aucun/repli − contredites)', reste - nEntrees + prisAucun + prisRepli - contredit, d.partageIncoherent);
    if (ecarts.length) throw new Error(`rapprochement avec decider : l'API a changé ou la lecture est fausse — ${ecarts.join(' · ')}`);
    return { ok: true, comptes: { lignes: nLignes, ecrites: nEntrees, sansFiche, aucunVisuel, sansTrace, repli, admis, admisDeAucun: prisAucun, admisDuRepli: prisRepli, positionContredite: contredit, partageIncoherent: d.partageIncoherent } };
}

module.exports = { rapprocher };
