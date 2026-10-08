'use strict';
// B1a.4 — la règle G (RatMarket V1) rendue BRANCHABLE. Enveloppe MINCE de ratmarket/decision-g.js::decider : importé, jamais recopié.
// Le contrat 2 n'a pas d'issue « réponse commune » (§5 Q34) : elle devient une QUESTION (code visuel). La règle ne fait RIEN sans
// fournisseur de voisins (§5 Q10) : sans lui, `regleGActive` est faux et la chaîne héritée décide.
const G = require('../../ratmarket/decision-g');

const CANDIDATS_MAX = 3;
const distincts = xs => [...new Set((Array.isArray(xs) ? xs : []).filter(Number.isInteger))];

/** Vrai SEULEMENT si cfg.regleG === true ET qu'un fournisseur de voisins est branché. Tout le reste : la chaîne héritée décide. */
function regleGActive(cfg, deps) {
    return Boolean(cfg && cfg.regleG === true && deps && typeof deps.voisins === 'function');
}

/**
 * @returns null (aucun voisin : la règle ne fait rien) ou { issue:'affirmee'|'question'|'introuvable', produit?, candidats?, codeQuestion?, raison?, detail }
 * Lève si la règle a des voisins mais pas de contexte : on n'invente jamais une absence.
 */
function decisionRegleG(entree, S) {
    if (!entree || !entree.ligne || !Array.isArray(entree.ligne.top) || entree.ligne.top.length === 0) return null;
    if (!entree.contexteG) throw new Error('decisionRegleG : voisins fournis sans contexte G');
    const d = G.decider(entree.contexteG, entree.ligne, entree.nEssais, entree.mesures, S || G.SEUILS_G);
    const detail = typeof d.raison === 'string' ? d.raison : null;
    if (d.affirme === true) {
        if (!Number.isInteger(d.produit)) throw new Error('decisionRegleG : affirmation sans produit entier');
        return { issue: 'affirmee', produit: d.produit, detail };
    }
    const cands = distincts(d.reponseCommune && d.reponseCommune.length ? d.reponseCommune : d.question);   // l'ordre de la règle n'est pas servi
    if (cands.length >= 2) return { issue: 'question', candidats: cands.slice(0, CANDIDATS_MAX), codeQuestion: 'visuel', detail };
    // ni produit ni deux candidats : une question à un seul choix n'existe pas, on n'affirme rien
    return { issue: 'introuvable', raison: 'hors-catalogue', detail };
}
module.exports = { decisionRegleG, regleGActive };
