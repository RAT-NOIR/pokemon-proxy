'use strict';
// JUGE À CINQ — les produits des visuels voisins du vecteur de l'extension, pour le seul COMPTE DE MESURE. Les 10 voisins de l'index (la même recherche, la même vérification du vecteur et du modèle que la règle G et les
// leviers : `preparerVecteur`, mémo « une fois par requête » si demandé) sont convertis en produits comme `leviers-abde.js` (« les produits des visuels voisins », `produitsParCle`) : dans l'ordre des voisins, dédoublonnés,
// 20 au plus. INTERNE : écrit dans `analyses.voisinsModele`, jamais servi, aucune influence sur la décision. Ne lève jamais : tout ce qui n'est pas sûr rend null.
const { preparerVecteur } = require('./voisins-empreinte');
const { produitsParCle } = require('./leviers-abde');

const VOISINS = 10, MAX = 20;

/**
 * @returns {number[]|null} les idProduct (entiers > 0, distincts, 20 au plus) ; null si le vecteur, le modèle, l'index ou la version des visuels ne permettent pas de conclure (ou si rien n'est trouvé)
 */
function voisinsDuModele({ cfg, entree, version, etat = require('./etat-empreintes'), memo = false } = {}) {
    try {
        if (version === undefined) version = require('../chargeur/etat').version();           // la version en place (la route ne la lit qu'une fois : m-1, test-langue-decisive-charge.js)
        if (!(cfg && cfg.empreinteExtension === true) || !entree || !entree.empreintes) return null;
        const voulu = cfg.modeleEmpreinte && cfg.modeleEmpreinte.id && cfg.modeleEmpreinte.sha256 ? { id: cfg.modeleEmpreinte.id, sha256: cfg.modeleEmpreinte.sha256 } : null;
        if (!voulu) return null;
        const p = preparerVecteur({ entree, voulu, etat, memo });
        if (!p.ok) return null;
        const parCle = produitsParCle(version);
        const ids = [], vus = new Set();
        for (const l of p.trouve.top.slice(0, VOISINS)) {
            for (const id of parCle.get(l[0]) || []) {
                if (!Number.isSafeInteger(id) || id <= 0 || vus.has(id)) continue;
                vus.add(id); ids.push(id);
                if (ids.length >= MAX) return ids;
            }
        }
        return ids.length ? ids : null;
    } catch { return null; }
}

module.exports = { voisinsDuModele, VOISINS, MAX };
