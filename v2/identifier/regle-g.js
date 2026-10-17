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

// REPLI-REIMPRESSIONS : les produits que l'IMAGE ne sépare pas d'un produit (colonne des marquages de l'archive EN PLACE, comme visuels.js lit la version en place) ; [] sans archive ni colonne.
const partagesDeLaVersionEnPlace = id => { try { return require('./jumeaux').partagesDeLaVersion(require('../chargeur/etat').version(), id); } catch { return []; } };

/**
 * @returns null (aucun voisin, OU la règle ne tranche pas : la chaîne héritée décide) ou
 *          { issue:'affirmee'|'question'|'introuvable', produit?, candidats?, codeQuestion?, raison?, detail }  (jamais 'introuvable' : plus de 3 indiscernables => null aussi)
 * Lève si la règle a des voisins mais pas de contexte : on n'invente jamais une absence.
 * REPLI-REIMPRESSIONS : `entree.partages` (idProduct → les autres produits que l'image ne sépare pas ; défaut : l'archive en place). La règle départage par l'IMAGE : sur des produits partagés elle ne le peut pas.
 * Un produit qu'elle AFFIRMERAIT et qui a un partenaire devient une QUESTION entre eux ; une question ou réponse commune qui nomme un produit sans son partenaire l'obtient ; à plus de 3 produits, la règle
 * ne tranche pas (null : la chaîne héritée décide, comme pour les indiscernables).
 */
function decisionRegleG(entree, S) {
    if (!entree || !entree.ligne || !Array.isArray(entree.ligne.top) || entree.ligne.top.length === 0) return null;
    if (!entree.contexteG) throw new Error('decisionRegleG : voisins fournis sans contexte G');
    const partagesDe = typeof entree.partages === 'function' ? entree.partages : partagesDeLaVersionEnPlace;
    const avecPartenaires = ids => {
        const tous = [...ids];
        for (const id of ids) for (const q of distincts(partagesDe(id))) if (!tous.includes(q)) tous.push(q);
        return tous;
    };
    const d = G.decider(entree.contexteG, entree.ligne, entree.nEssais, entree.mesures, S || G.SEUILS_G);
    const detail = typeof d.raison === 'string' ? d.raison : null;
    if (d.affirme === true) {
        if (!Number.isInteger(d.produit)) throw new Error('decisionRegleG : affirmation sans produit entier');
        const groupe = avecPartenaires([d.produit]);
        if (groupe.length === 1) return { issue: 'affirmee', produit: d.produit, detail };
        if (groupe.length > CANDIDATS_MAX) return null;
        return { issue: 'question', candidats: groupe, codeQuestion: 'visuel', detail: `${detail ?? ''} — produit partagé : l'image ne le sépare pas de ses partenaires`.trim() };
    }
    const communes = distincts(d.reponseCommune);
    // Plus de 3 indiscernables (courant en vintage : V1 à V6 par numéro) : ni question à 3 choix (couper ferait disparaître la vraie
    // réponse), ni cause inventée (la photo est lisible) : la règle ne tranche pas, la chaîne héritée décide.
    if (communes.length > CANDIDATS_MAX) return null;
    const brutes = communes.length >= 2 ? communes : distincts(d.question);
    if (brutes.length >= 2) {
        const cands = avecPartenaires(brutes);
        if (cands.length > CANDIDATS_MAX) return null;        // les partenaires ne tiennent pas tous dans une question : couper ferait disparaître la vraie réponse
        return { issue: 'question', candidats: cands, codeQuestion: 'visuel', detail };
    }
    // La règle G ne tranche pas : rien à dire. La chaîne héritée décide (une règle remplace une décision par une décision,
    // jamais par une affirmation d'absence du catalogue).
    return null;
}
module.exports = { decisionRegleG, regleGActive };
