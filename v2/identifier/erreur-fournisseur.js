'use strict';
// PHOTOS-MULTIPLES (7d, m-6) — ce que le journal garde d'une erreur du fournisseur du modèle : le STATUT et un CODE COURT, jamais le corps de sa réponse ni son message. Depuis le lot, la requête au modèle porte des images en `data:`
// (la photo d'un utilisateur) ; un corps d'erreur qui citerait un morceau de la requête atterrirait dans les journaux. Écrit par ce qu'il AUTORISE : un code ne sort que s'il a la forme `[A-Za-z0-9_.-]{1,40}`.
const CODE_SUR = /^[A-Za-z0-9_.-]{1,40}$/;
function resumeErreurFournisseur(e) {
    const statut = e && e.response && Number.isInteger(e.response.status) ? e.response.status : null;
    const brut = e && typeof e.code === 'string' ? e.code : (e && e.response && e.response.data && e.response.data.error ? e.response.data.error.code : null);
    const code = (typeof brut === 'string' || Number.isInteger(brut)) && CODE_SUR.test(String(brut)) ? String(brut) : 'erreur';
    return `statut=${statut ?? '-'} code=${code}`;
}
module.exports = { resumeErreurFournisseur };
