'use strict';
// LIEN-CARDMARKET — LA garde du lien Cardmarket servi (un seul exemplaire : decision.js, visuels.js et produit.js l'appellent, §21 bis du dépôt principal).
// Écrite par ce qu'elle AUTORISE, et seulement la forme CANONIQUE : la chaîne reçue doit être exactement `new URL(u).href` (ni espace, ni retour ligne, ni majuscules d'hôte
// ou de schéma, ni port, même :443 — rien n'est normalisé, on ne sert que la chaîne reçue quand elle est déjà canonique), et correspondre EXACTEMENT à
// https://[www.]cardmarket.com/<langue>/Pokemon/Products/Singles/<expansion>/<produit>, la langue venant d'une liste fermée (celles de Cardmarket),
// chaque segment étant ^[A-Za-z0-9][A-Za-z0-9._-]*$ (donc aucun %, aucun espace, aucun ? ni #), sans « .. », et l'expansion ne valant pas « Search ».
// Tout le reste (recherche, liste d'expansion, autre jeu, chemin plus court ou plus long) rend null : un lien mène à la page EXACTE d'un produit, jamais à une recherche.
// Le motif des segments a été vérifié en lecture sur les 73 708 couples slug/slugSet réels de numeros_cartes : 0 refusé.
const LANGUES = 'en|fr|de|es|it';
const SEG = '[A-Za-z0-9][A-Za-z0-9._-]*';
const FORME = new RegExp(`^https://(?:www\\.)?cardmarket\\.com/(?:${LANGUES})/Pokemon/Products/Singles/(${SEG})/(${SEG})$`);

/** L'URL elle-même si elle est la page exacte, canonique, d'un produit Pokémon chez Cardmarket, sinon null. */
function lienExact(u) {
    if (typeof u !== 'string' || u.includes('..')) return null;
    let p; try { p = new URL(u); } catch { return null; }
    if (p.href !== u) return null;
    const m = FORME.exec(u);
    return m && m[1] !== 'Search' ? u : null;
}

/** Le lien servi pour un produit : le numéro doit être connu (la rareté n'est plus exigée) ET l'URL doit être la page exacte. */
function lienServi(u, numero) {
    return typeof numero === 'string' && numero.trim() && lienExact(u) ? u : null;
}

/** RESOUDRE-CARDMARKET : { slugSet, slug } d'une adresse collée, ou null. La requête (?…) et l'ancre (#…) sont COUPÉES d'abord (elles ne désignent pas le produit) ; le reste doit être la page
 *  exacte d'un produit au sens de `lienExact` (une seule garde, pas de seconde copie du motif). Rien d'autre n'est lu. */
function couplePourLien(u) {
    if (typeof u !== 'string') return null;
    const i = u.search(/[?#]/);
    const nu = i === -1 ? u : u.slice(0, i);
    if (!lienExact(nu)) return null;
    const m = FORME.exec(nu);
    return m ? { slugSet: m[1], slug: m[2] } : null;
}

/** L'adresse canonique servie pour un couple (langue /fr/, comme chargeur/regle-site/cardmarket.mjs), passée par la même garde. */
const lienCanonique = (slugSet, slug) => lienExact(`https://www.cardmarket.com/fr/Pokemon/Products/Singles/${slugSet}/${slug}`);

module.exports = { lienExact, lienServi, couplePourLien, lienCanonique, SEG, LANGUES };
