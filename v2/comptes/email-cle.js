'use strict';
const fs = require('fs'), path = require('path');
const JETABLES = new Set(fs.readFileSync(path.join(__dirname, 'domaines-jetables.txt'), 'utf8').split(/\r?\n/).map(s => s.trim().toLowerCase()).filter(s => s && !s.startsWith('#')));
// O3 (tour 1, I-2a) — le domaine est écrit par ce qu'on AUTORISE : au moins deux étiquettes non vides (lettres ou chiffres, tirets au milieu seulement), la dernière de deux caractères au moins.
// Tout le reste — un point final (« gmail.com. » : le même domaine pour un serveur de courrier, une autre clé pour nous), un point doublé, une étiquette vide, un tiret en bordure — est une forme
// qu'on ne sait pas normaliser : refusée, jamais nettoyée en silence.
const ETIQUETTE = /^[\p{L}\p{N}]+(?:-+[\p{L}\p{N}]+)*$/u;
function domaineAdmis(domaine) {
    const e = domaine.split('.');
    return e.length >= 2 && e.every(x => ETIQUETTE.test(x)) && [...e[e.length - 1]].length >= 2;
}
/** La clé de la BOÎTE (O3 tour 1, I-2b), pour les limites de courrier seulement : l'`emailCle` sans le suffixe `+…` de la partie locale, pour TOUT domaine (les points de Gmail sont déjà ôtés par `emailCle`).
 *  Jamais la clé d'un compte : `a+b@exemple.fr` et `a@exemple.fr` restent deux comptes, mais une seule boîte. Entrée : un `emailCle` ; sortie : une chaîne (jamais null). */
function cleBoite(cle) {
    const i = String(cle).lastIndexOf('@');
    if (i < 0) return String(cle);
    const local = cle.slice(0, i).split('+')[0];
    return `${local || cle.slice(0, i)}${cle.slice(i)}`;
}
function emailCle(brut) {
    if (typeof brut !== 'string') return null;
    const s = brut.normalize('NFKC').trim().toLowerCase();
    const m = /^([^@\s]+)@([^@\s]+)$/.exec(s);
    if (!m) return null;
    let [, local, domaine] = m;
    if (!domaineAdmis(domaine)) return null;
    if (domaine === 'googlemail.com') domaine = 'gmail.com';
    if (domaine === 'gmail.com') { local = local.split('+')[0].replace(/\./g, ''); if (!local) return null; }
    return `${local}@${domaine}`;
}
function estJetable(domaine) {
    const parties = String(domaine).toLowerCase().split('.');
    for (let i = 0; i < parties.length - 1; i++) if (JETABLES.has(parties.slice(i).join('.'))) return true;
    return false;
}
module.exports = { emailCle, cleBoite, estJetable };
