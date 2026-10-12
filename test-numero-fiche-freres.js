// node test-numero-fiche-freres.js — LE NUMÉRO DE LA FICHE ET LE VISUEL d'un produit désigné par ses frères (§19, §66, lot M2) : ces produits sont des variantes
// NON NOMMÉES ; poser un numeroFiche fait servir le scan du numéro, donc un scan SANS tampon pour un produit qui en porte peut-être un.
// Fausse lecture du clone TCGdex (même interface que lireClone). TOOL_DIR=<dossier> rejoue le banc contre une copie mutée.
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const N = require(path.join(DIR, 'collecte-cartes', 'numero-fiche-freres'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const variante = (type, stamp = [], cardmarket = null) => ({ type, foil: null, stamp, cardmarket });
function clone({ produits = {}, cartes = {}, sets = { 7: ['sm3'] } } = {}) {
    return { parProduit: new Map(Object.entries(produits).map(([k, v]) => [Number(k), v])), setsParExpansion: new Map(Object.entries(sets).map(([k, v]) => [Number(k), v])),
        carte: (s, l) => cartes[`${s}|${l}`] ?? null };
}
const frere = (idProduct, numeroFiche) => ({ idProduct, numeroFiche });
const p = { idProduct: 10, idExpansion: 7 };
const sansTamponCarte = { cardmarket: 1, variantes: [{ type: 'normal', foil: null, stamp: [], cardmarket: null }, { type: 'reverse', foil: null, stamp: [], cardmarket: null }] };
const decider = (c, freres, extra = {}) => N.numeroDeLaFiche({ p, clone: c, freres, ...extra });

let r = decider(clone({ produits: { 10: [{ setId: 'sm3', localId: '10', variante: variante('reverse', ['staff'], 10) }] } }), [frere(11, '10'), frere(12, '10')]);
verifier('un produit que TCGdex nomme avec un TAMPON (staff) : la fiche oui, AUCUN numéro (le scan du numéro est sans tampon)', [r.numeroFiche, r.statut, r.tampon], [null, 'tampon', ['staff']]);
r = decider(clone({ produits: { 10: [{ setId: 'sm3', localId: '10', variante: variante('reverse', [], 10) }] } }), [frere(11, '10'), frere(12, '10')]);
verifier('un produit que TCGdex nomme SANS tampon, numéro commun à tous les frères et de TCGdex : le numéro est posé', [r.numeroFiche, r.statut], ['10', 'sans-tampon-prouve']);
r = decider(clone({ produits: { 10: [{ setId: 'sm3', localId: '10', variante: null }] } }), [frere(11, '10'), frere(12, '10')]);
verifier('   nommé au niveau de la carte (idProduct de la carte) : même issue', [r.numeroFiche, r.statut], ['10', 'sans-tampon-prouve']);
r = decider(clone({ produits: { 10: [{ setId: 'sm3', localId: '12', variante: null }] } }), [frere(11, '10'), frere(12, '10')]);
verifier('   TCGdex place le produit à un AUTRE numéro que celui des frères : aucun numéro (deux sources en désaccord)', [r.numeroFiche, /numéro/.test(r.motif)], [null, true]);
r = decider(clone({ produits: { 10: [{ setId: 'sm3', localId: '10', variante: variante('reverse', []) }, { setId: 'sm3', localId: '10', variante: variante('holo', ['prerelease']) }] } }), [frere(11, '10'), frere(12, '10')]);
verifier('   deux entrées TCGdex pour le produit dont une tamponnée : tampon (la prudence l\'emporte)', [r.numeroFiche, r.statut], [null, 'tampon']);

const cartes = { 'sm3|10': sansTamponCarte };
r = decider(clone({ cartes }), [frere(11, '10'), frere(12, '10')]);
verifier('SANS PREUVE de variante : numéro commun, aucun frère tamponné, la carte de TCGdex n\'a aucun tampon inconnu : le numéro est posé', [r.numeroFiche, r.statut, r.selonLeCahier], ['10', 'sans-preuve', true]);
r = decider(clone({ cartes, produits: { 11: [{ setId: 'sm3', localId: '10', variante: variante('reverse', ['staff'], 11) }] } }), [frere(11, '10'), frere(12, '10')]);
verifier('   un FRÈRE connu pour son tampon : aucun numéro (le produit peut être l\'autre tampon)', [r.numeroFiche, /tamponn/.test(r.motif), r.selonLeCahier], [null, true, false]);
r = decider(clone({ cartes }), [frere(11, '10'), frere(12, '11')]);
verifier('   les frères ne partagent pas le numéro : aucun numéro', [r.numeroFiche, r.selonLeCahier], [null, false]);
r = decider(clone({ cartes }), [frere(11, '10'), frere(12, null)]);
verifier('   un frère SANS numéro : aucun numéro ("tous les frères le partagent")', [r.numeroFiche, r.selonLeCahier], [null, false]);
r = decider(clone({ cartes }), [frere(11, '010'), frere(12, '10')]);
verifier('   « 010 » et « 10 » sont le même numéro (cleNumero de la production) ; le numéro écrit est celui d\'un frère, tel quel', [r.numeroFiche], ['010']);
r = decider(clone({ cartes: { 'sm3|10': { cardmarket: 1, variantes: [{ type: 'reverse', foil: null, stamp: ['staff'], cardmarket: null }] } } }), [frere(11, '10'), frere(12, '10')]);
verifier('   la carte porte un variante TAMPONNÉE que personne ne nomme : le produit peut en être une, aucun numéro — mais le cahier l\'aurait posé', [r.numeroFiche, r.selonLeCahier, /tampon/.test(r.motif)], [null, true, true]);
r = decider(clone({ cartes: { 'sm3|10': { cardmarket: 1, variantes: [{ type: 'reverse', foil: null, stamp: ['staff'], cardmarket: 999 }] } } }), [frere(11, '10'), frere(12, '10')]);
verifier('   la variante tamponnée est NOMMÉE par un autre produit : ce n\'est pas le nôtre, le numéro est posé', [r.numeroFiche], ['10']);
r = decider(clone({ cartes: {} }), [frere(11, '10'), frere(12, '10')]);
verifier('   la carte est ABSENTE du clone : on ne sait rien de ses tampons, aucun numéro — mais le cahier l\'aurait posé', [r.numeroFiche, r.selonLeCahier, /absente/.test(r.motif)], [null, true, true]);
r = decider(clone({ cartes, sets: {} }), [frere(11, '10'), frere(12, '10')]);
verifier('   l\'expansion n\'est pas dans le clone : même issue (rien de prouvé)', [r.numeroFiche, r.selonLeCahier], [null, true]);
console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
