'use strict';
// LANGUE-DECISIVE — ce que la route (une carte) et le lot chargent EN PLUS pour que la résolution d'un candidat SEUL passe par la garde des jumeaux (B1) et que R4 se juge sur le catalogue entier (M2).
// Sans cette préparation la garde des jumeaux ne concluait que pour le produit AFFIRMÉ par la chaîne (fournisseurParDefaut ne vérifie que ceux-là) : le candidat que la photo laisse seul n'est presque
// jamais le produit affirmé, donc la résolution se serait toujours refusée. Aucun changement à jumeaux.js pour cela : on rappelle `fournisseurParDefaut` avec une liste d'ids plus longue.
// M-C (tour de correction 2) : ce module ne prépare QUE le SURVIVANT UNIQUE de la réduction (`survivantUnique`, les règles livrées) — jamais tous les candidats désignés — sous un PLAFOND de produits lus
// (PLAFOND_CHARGE) et un TEMPS borné (DELAI_PREPARATION_MS). Pas de survivant unique, jumeaux au-delà du plafond, lecture en panne ou trop lente : il ne prépare rien (l'état d'avant, la résolution se refuse, la
// question reste réduite par la langue). Une panne de lecture ne lève jamais.
const { fournisseurParDefaut, idsAffirmes } = require('./jumeaux');
const LD = require('./langue-decisive');

const apresDelai = (p, ms) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('délai de préparation dépassé')), ms); p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); }); });

/**
 * @param corpsListe  les réponses de la chaîne dont la résolution pourrait laisser un candidat seul
 * @param produits    Map déjà chargée (vivier compris) ; @param jumeaux le fournisseur déjà construit pour les produits affirmés ; @param version la version de la colonne lue UNE fois par la requête
 * @returns { jumeaux, produits, codeNumeroExiste } — les mêmes objets si rien n'est à ajouter.
 */
async function preparer({ corpsListe, produits, jumeaux, catalogue, version, deps = {}, delaiMaxMs = LD.DELAI_PREPARATION_MS } = {}) {
    let codeNumeroExiste;
    try {
        if (catalogue && typeof catalogue.indexCodeNumero === 'function') { const idx = await catalogue.indexCodeNumero(); codeNumeroExiste = (c, n, exclure) => idx.existe(c, n, exclure); }
    } catch (e) { console.warn('⚠️ [langue-decisive-v2] index code × numéro indisponible : R4 fermée'); }
    const avant = { jumeaux, produits, codeNumeroExiste };
    if (deps.jumeaux || !(produits instanceof Map)) return avant;                                  // banc : le fournisseur injecté fait foi
    try {
        const survivants = [...new Set((corpsListe || []).map(c => LD.survivantUnique({ corps: c, produits })).filter(Number.isInteger))];
        if (!survivants.length) return avant;
        const affirmes = (corpsListe || []).flatMap(c => idsAffirmes(c));
        const r = await apresDelai((async () => {
            const j2 = await fournisseurParDefaut(catalogue, version, [...new Set([...affirmes, ...survivants])]);
            const manquants = [...new Set(survivants.flatMap(id => { const g = j2(id); return g && g.conclu === true && Array.isArray(g.ids) ? g.ids : []; }))].filter(i => Number.isInteger(i) && !produits.has(i));
            if (manquants.length > LD.PLAFOND_CHARGE) return null;                                 // au-delà du plafond : rien n'est lu
            const p2 = new Map(produits);
            if (manquants.length) for (const [k, v] of await catalogue.lire(manquants)) p2.set(k, v);
            return { jumeaux: j2, produits: p2, codeNumeroExiste };
        })(), delaiMaxMs);
        LD.noterPreparation(r !== null);
        return r || avant;
    } catch (e) {
        LD.noterPreparation(false);
        console.warn('⚠️ [langue-decisive-v2] préparation des jumeaux impossible : la résolution se refusera');
        return avant;
    }
}

module.exports = { preparer };
