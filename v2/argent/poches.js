'use strict';
// Les poches et leur ordre de consommation. L'ordre vient de la configuration (V2_ORDRE_POCHES), jamais d'une constante locale.
// Écrit par ce qu'il AUTORISE : un type de porteur inconnu n'a aucune poche.
// OFFRE-QUOTA (2026-10-13) : la seule poche débitable est `jour` (quota quotidien, v2/argent/offre.js) ; l'ordre configuré ne peut contenir qu'elle (config.js).
// Un compte ET une installation ont la même poche : c'est l'OFFRE du porteur (relue en base au débit) qui fixe la limite, jamais le type de porteur.
// ACHETE-AVANT-JOUR (2026-10-17) : les analyses achetées avec la 1.0.5 (poche `achete`) se consomment AVANT le quota du jour. Cet ordre est FIXÉ ICI, dans le code : V2_ORDRE_POCHES ne peut toujours pas
// nommer `achete` (config.js) et ne décide que de ce qui vient APRÈS elle (la seule poche configurable est `jour`).
const ORDRE_FIXE_AVANT = Object.freeze(['achete']);
function ordreDe(porteur, cfg) {
    if (porteur && (porteur.type === 'compte' || porteur.type === 'installation')) return [...ORDRE_FIXE_AVANT, ...cfg.ordrePoches.filter(p => p === 'jour')];
    return [];
}
// LA poche `achete` d'un porteur : où elle vit et comment on la prend. UNE seule définition, lue par le débit (ledger.essayerPoche) et par le contrôle sans débit (solde.peutPayer) — §21 bis.
//   · compte : `comptes.solde.achete` ; installation : `installations.achete`, et SEULEMENT tant qu'elle n'est pas liée (une installation liée n'a pas de poche propre : ses achats ont migré vers le compte à la
//     liaison, et un débit pris sur elle serait rendu au COMPTE par rendreUnite) — même prédicat que offre.etatDe (`compteId` nul ou absent) ;
//   · une unité s'ajoute au filtre de la prise (`>= 1`) : la poche ne descend jamais sous 0, une valeur négative ou fractionnaire (< 1) n'est jamais débitée.
function acheteDe(porteur) {
    if (!porteur) return null;
    if (porteur.type === 'compte') return { collection: 'comptes', filtre: { _id: porteur.id }, champ: 'solde.achete' };
    if (porteur.type === 'installation') return { collection: 'installations', filtre: { _id: porteur.id, compteId: null }, champ: 'achete' };
    return null;
}
const moisCle = d => d.toISOString().slice(0, 7);
// le lundi STRICTEMENT suivant (UTC) : depuis un lundi, le lundi d'après (gardé : le Solde ancien l'annonce encore pour l'hebdo)
function prochainLundi(d) {
    const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    x.setUTCDate(x.getUTCDate() + (8 - (x.getUTCDay() || 7)));
    return x.toISOString().slice(0, 10);
}
// Le code d'un débit refusé faute de quota : un compte non vérifié se voit demander de CONFIRMER son adresse, tout autre porteur est à court (une seule définition :
// le débit et le contrôle sans débit du scanner, solde.peutPayer, la lisent ici).
const codeRefus = porteur => (porteur && porteur.compte && !porteur.compte.verifie ? 'VERIFICATION' : 'QUOTA');
module.exports = { ordreDe, acheteDe, moisCle, prochainLundi, codeRefus };
