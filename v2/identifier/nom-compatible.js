'use strict';
// CONFIRMATION-SURE (observation 5, 0 faux) — un candidat n'est MONTRÉ au client (confirmation ou départage) que si son nom est compatible avec le nom que la lecture a donné.
// Module PUR. Écrit par ce qu'il AUTORISE : un candidat n'est retiré que s'il est CONTREDIT, c'est-à-dire que le nom lu est présent, lu en confiance 'haute' (la condition qui arme le veto de
// la production, index.js:2457), que la ligne du candidat est connue, et que NI la règle de la production NI le test des mots n'y trouvent un rapport. Tout le reste reste montré :
// « je ne sais pas » n'est pas une contradiction.
//
// RÉUTILISATION, pas copie : la règle de nom de la production est `nomConcorde` (scoring.js:1813), celle du veto `nomOpposeUnVeto`. Elle est IMPORTÉE ici.
// POURQUOI ELLE NE SUFFIT PAS SEULE : `nomConcorde` répond « concorde ? » et dit elle-même que « non » ne veut pas dire « contredit » (scoring.js:1797) ; l'appelant doit ajouter la preuve.
// Rejouée seule sur les 177 questions du banc réel, elle retirait 3 VÉRITÉS : « Korrina's Focus » lu / « Korrina's Motivation » (même carte, traduction anglaise différente),
// « Zinnia's Resolve » / « Zinnia's Trust », « Palkia LV.X » / « Palkia Lv.67 » (même Pokémon, autre carte). Le complément ci-dessous est donc un test de MOTS : un mot significatif
// commun (hors mots génériques : Dark, Team, ex, Energy, Lv…) suffit à ne PAS contredire. Il est plus permissif que la règle de production, jamais plus sévère.
const { nomConcorde } = require('../../scoring');

// Les mots qui ne désignent aucune carte à eux seuls : un qualificatif, un type, une règle ou un nombre. Deux noms qui ne partagent que ceux-là n'ont aucun rapport
// (« Dark Porygon2 » / « Dark Feraligatr », « Fire Energy » / « Water Energy »).
const MOTS_GENERIQUES = new Set(['the', 'and', 'dark', 'light', 'team', 'rocket', 'rockets', 'magma', 'aqua', 'galactic', 'plasma', 'flare', 'skull', 'mega', 'shining', 'radiant', 'alolan',
    'galarian', 'hisuian', 'paldean', 'delta', 'species', 'ex', 'gx', 'vmax', 'vstar', 'vunion', 'break', 'prime', 'legend', 'star', 'lv', 'level', 'energy', 'basic', 'special', 'trainer',
    'supporter', 'stadium', 'tool', 'item', 'pokemon', 'pokémon', 'card', 'promo']);

const normaliser = s => String(s || '').toLowerCase().replace(/[’'`]/g, '');
const motsDe = s => normaliser(s).split(/[^\p{L}\p{N}]+/u).filter(m => m.length >= 3 && !/^\d+$/.test(m) && !MOTS_GENERIQUES.has(m));

/** Les formes du nom d'un candidat, comme le veto de la production les prend (index.js:2463) : le nom Cardmarket sans ses attaques entre crochets, et le nom français. */
function formesDuCandidat(ligne) {
    if (!ligne || typeof ligne !== 'object') return [];
    return [String(ligne.nomCardmarket || '').split('[')[0].trim(), ligne.nomFr].filter(x => typeof x === 'string' && x.trim());
}

/**
 * Le nom lu est-il COMPATIBLE avec ce candidat ? Vrai quand on ne peut pas affirmer le contraire.
 * @param formesLues  [nom, nomBrut] lus par la photo (les absents sont ignorés)
 * @param ligne       la ligne de catalogue du candidat ({ nomCardmarket, nomFr })
 */
function nomCompatible(formesLues, ligne) {
    const lues = (Array.isArray(formesLues) ? formesLues : []).filter(x => typeof x === 'string' && x.trim());
    const cands = formesDuCandidat(ligne);
    if (!lues.length || !cands.length) return true;                       // rien à comparer : on ne contredit pas
    if (nomConcorde(lues, cands)) return true;                            // LA règle de la production
    const motsLus = new Set(lues.flatMap(motsDe));
    return cands.flatMap(motsDe).some(m => motsLus.has(m));               // un mot significatif commun : même carte (traduite) ou même Pokémon
}

/** Les formes lues dans le corps de la chaîne héritée : `carte` (succès, index.js:6167) ou `cardInfo` (refus, index.js:5161). Rend [] si la confiance n'est pas 'haute' (veto désarmé, index.js:2457). */
function formesLuesDe(corps) {
    if (!corps || typeof corps !== 'object') return [];
    const src = corps.success === true ? corps.carte : corps.cardInfo;
    if (!src || typeof src !== 'object' || src.nomConfiance !== 'haute') return [];
    return [src.name ?? src.nom, src.nomBrut].filter(x => typeof x === 'string' && x.trim());
}

/** Les ids dont le nom n'est PAS contredit par la lecture (l'ordre est gardé). Un id sans ligne au catalogue de l'API reste (il lèvera plus loin la panne d'avant). */
function garderCompatibles(ids, corps, produits) {
    const lues = formesLuesDe(corps);
    if (!lues.length || !(produits instanceof Map)) return ids;
    return ids.filter(id => !produits.has(id) || nomCompatible(lues, produits.get(id)));
}

module.exports = { nomCompatible, formesLuesDe, garderCompatibles, formesDuCandidat, MOTS_GENERIQUES };
