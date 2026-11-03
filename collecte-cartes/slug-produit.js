'use strict';
// Règle PURE : quel slug poser sur une ligne cartes_produits à slug nul, d'après le produit APPRIS (numeros_cartes).
// Jamais de slug deviné ni fabriqué, jamais de slug existant réécrit. Chaque refus porte une raison de la liste fermée RAISONS.
// Les slugs pollués (« ?language=2 ») ont existé : voir nettoyer-slugs.js.

const RAISONS = Object.freeze([
    'slug-deja-pose',
    'produit-non-appris',
    'slug-non-appris',
    'slug-pollue',
    'expansion-differente',
    'slugSet-different',
    'produit-ambigu',
]);

// Forme réelle d'un slug Cardmarket (« Bosss-Orders-Cyrus-SWSH251 »), écrite par ce qu'elle AUTORISE : tout le reste est pollué.
const FORME_SLUG = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;

// Réunit les documents numeros_cartes d'un même idProduct : plusieurs valeurs DISTINCTES de slug (ou de slugSet) = ambigu.
// Deux documents au même slug ne sont pas ambigus ; un document sans slug cède devant celui qui en porte un.
function consolider(docs) {
    if (!Array.isArray(docs) || !docs.length) return undefined;
    const slugs = new Set(docs.map(d => d.slug).filter(v => typeof v === 'string' && v.length));
    const sets = new Set(docs.map(d => d.slugSet).filter(v => typeof v === 'string' && v.length));
    if (slugs.size > 1 || sets.size > 1) return { ambigu: true };
    const base = docs.find(d => d.slug) || docs[0];
    return { ...base, slug: slugs.size ? [...slugs][0] : base.slug, slugSet: sets.size ? [...sets][0] : base.slugSet };
}

const plein = v => typeof v === 'string' && v.length > 0;

function slugAPoser(ligne, appris) {
    if (plein(ligne && ligne.slug)) return { refus: 'slug-deja-pose' };
    if (!appris) return { refus: 'produit-non-appris' };
    if (appris.ambigu) return { refus: 'produit-ambigu' };
    if (!plein(appris.slug)) return { refus: 'slug-non-appris' };
    if (!FORME_SLUG.test(appris.slug)) return { refus: 'slug-pollue' };
    if (appris.idExpansion != null && appris.idExpansion !== ligne.idExpansion) return { refus: 'expansion-differente' };
    const sLigne = plein(ligne.slugSet) ? ligne.slugSet : null;
    const sAppris = plein(appris.slugSet) ? appris.slugSet : null;
    if (sLigne && sAppris && sLigne !== sAppris) return { refus: 'slugSet-different' };
    const set = { slug: appris.slug };
    if (!sLigne && sAppris) set.slugSet = sAppris;
    return { set };
}

module.exports = { slugAPoser, consolider, RAISONS };
