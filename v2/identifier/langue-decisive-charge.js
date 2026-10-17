'use strict';
// LANGUE-DECISIVE — ce que la route (une carte) et le lot chargent EN PLUS pour que la résolution d'un candidat SEUL passe par la garde des jumeaux (B1) et que R4 se juge sur le catalogue entier (M2).
// Sans cette préparation la garde des jumeaux ne concluait que pour le produit AFFIRMÉ par la chaîne (fournisseurParDefaut ne vérifie que ceux-là) : le candidat que la photo laisse seul n'est presque
// jamais le produit affirmé, donc la résolution se serait toujours refusée. Aucun changement à jumeaux.js : on rappelle `fournisseurParDefaut` avec une liste d'ids plus longue.
const { fournisseurParDefaut, idsAffirmes, MAX_CHARGE } = require('./jumeaux');
const { candidatsDeReduction } = require('./langue-decisive');

/**
 * @param corpsListe  les réponses de la chaîne (success true ou non) dont la résolution pourrait laisser un candidat seul
 * @param produits    Map déjà chargée (vivier compris)
 * @param jumeaux     le fournisseur déjà construit pour les produits affirmés
 * @returns { jumeaux, produits, codeNumeroExiste } — les mêmes objets si rien n'est à ajouter. Une panne de lecture ne lève jamais : on garde l'état d'avant (R4 fermée sans index, garde sans conclure).
 */
async function preparer({ corpsListe, produits, jumeaux, catalogue, version, deps = {} } = {}) {
    let codeNumeroExiste;
    try {
        if (catalogue && typeof catalogue.indexCodeNumero === 'function') { const idx = await catalogue.indexCodeNumero(); codeNumeroExiste = (c, n) => idx.existe(c, n); }
    } catch (e) { console.warn('⚠️ [langue-decisive-v2] index code × numéro indisponible : R4 fermée'); }
    if (deps.jumeaux || !(produits instanceof Map)) return { jumeaux, produits, codeNumeroExiste };            // banc : le fournisseur injecté fait foi
    try {
        const poss = [...new Set((corpsListe || []).flatMap(c => candidatsDeReduction({ corps: c, produits })))];
        if (!poss.length) return { jumeaux, produits, codeNumeroExiste };
        const affirmes = (corpsListe || []).flatMap(c => idsAffirmes(c));
        const j2 = await fournisseurParDefaut(catalogue, version, [...new Set([...affirmes, ...poss])]);
        const manquants = [...new Set(poss.flatMap(id => {
            const r = j2(id);
            return r && r.conclu === true && Array.isArray(r.ids) && r.ids.length <= MAX_CHARGE ? r.ids : [];
        }))].filter(i => Number.isInteger(i) && !produits.has(i));
        const p2 = new Map(produits);
        if (manquants.length) for (const [k, v] of await catalogue.lire(manquants)) p2.set(k, v);
        return { jumeaux: j2, produits: p2, codeNumeroExiste };
    } catch (e) {
        console.warn('⚠️ [langue-decisive-v2] préparation des jumeaux impossible : la résolution se refusera');
        return { jumeaux, produits, codeNumeroExiste };
    }
}

module.exports = { preparer };
