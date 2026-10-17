'use strict';
// LIEN-CARDMARKET — LA garde du lien Cardmarket servi (un seul exemplaire : decision.js, visuels.js et produit.js l'appellent, §21 bis du dépôt principal).
// Écrite par ce qu'elle AUTORISE : https, hôte www.cardmarket.com ou cardmarket.com, sans identifiants ni port, chemin EXACTEMENT
// /<langue>/Pokemon/Products/Singles/<segment>/<segment> (deux segments non vides), sans ? ni # ni « .. ». Tout le reste (recherche, liste d'expansion,
// autre jeu, chemin plus court ou plus long) rend null : un lien mène à la page EXACTE d'un produit, jamais à une recherche.
const FORME = /^\/[A-Za-z]{2}(?:-[A-Za-z]{2})?\/Pokemon\/Products\/Singles\/([^/?#]+)\/([^/?#]+)$/;

/** L'URL elle-même si elle est la page exacte d'un produit Pokémon chez Cardmarket, sinon null. */
function lienExact(u) {
    if (typeof u !== 'string') return null;
    if (u.includes('?') || u.includes('#') || u.includes('..')) return null;
    let p; try { p = new URL(u); } catch { return null; }
    if (p.protocol !== 'https:' || p.username || p.password || p.port) return null;
    if (p.hostname !== 'www.cardmarket.com' && p.hostname !== 'cardmarket.com') return null;
    return FORME.test(p.pathname) ? u : null;
}

/** Le lien servi pour un produit : le numéro doit être connu (la rareté n'est plus exigée) ET l'URL doit être la page exacte. */
function lienServi(u, numero) {
    return typeof numero === 'string' && numero.trim() && lienExact(u) ? u : null;
}

module.exports = { lienExact, lienServi };
