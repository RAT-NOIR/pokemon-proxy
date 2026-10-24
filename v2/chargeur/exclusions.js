'use strict';
// ARCHIVE-EXCLUSIONS — des produits NOMMÉS (idProduct) sont exclus de l'archive d'identification, par une liste, au moment de la construction. Ils restent servis pour l'affichage et rien n'est écrit en base.
// Ce module porte trois choses, et rien d'autre (une seule définition, §21 bis) :
//   · MOTIFS — la liste FERMÉE des motifs ;
//   · lireFichierExclusions(chemin) — la GARDE du fichier de liste, écrite par ce qu'elle AUTORISE : tout ce qui n'est pas exactement la forme prévue est refusé, avec sa raison ;
//   · suivre(exclusions) — le suivi de l'exclusion à l'endroit où elle s'applique (calcul.js, à la sortie de decider) : quels exclus avaient VRAIMENT un visuel (retirés) et lesquels n'en avaient déjà pas (listés).
// verifierComptes(comptes) est le jugement du FORMAT sur les compteurs d'exclusion d'une archive reçue (version.js).
const fs = require('fs');
const { lireEntree } = require('../identifier/visuels');

const MOTIFS = Object.freeze(['visuel-faux', 'en-attente', 'entree-partagee-autre-dessin', 'entree-partagee-autre-impression']);
const TAILLE_MAX = 1048576, PRODUITS_MAX = 10000, DECISION_MAX = 2000;
const CLES_FICHIER = Object.freeze(['decision', 'source', 'le', 'produits']);
const objetSimple = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const entierPositif = x => Number.isSafeInteger(x) && x > 0;
const refus = raison => ({ ok: false, raison });
const dateValide = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const parMotifVide = () => Object.fromEntries(MOTIFS.map(m => [m, 0]));

/**
 * Lit et JUGE un fichier de liste d'exclusions. @returns {{ ok: true, decision, le, source, produits: [{ idProduct, motif }], exclusions: Map<idProduct, motif> } | { ok: false, raison }}
 * Autorisé : un objet portant `decision` (texte non vide), `le` (date AAAA-MM-JJ), `produits` (tableau NON VIDE de { idProduct: entier > 0, motif: un des MOTIFS }, sans doublon d'idProduct) et,
 * facultatif, `source` (texte). Toute autre clé, à n'importe quel niveau, est refusée. Ne lève jamais.
 */
function lireFichierExclusions(chemin) {
    if (typeof chemin !== 'string' || !chemin.trim()) return refus('aucun fichier nommé');
    let st; try { st = fs.statSync(chemin); } catch { return refus('le fichier est introuvable ou illisible'); }
    if (!st.isFile()) return refus('ce n\'est pas un fichier');
    if (st.size === 0) return refus('le fichier est vide');
    if (st.size > TAILLE_MAX) return refus(`le fichier dépasse ${TAILLE_MAX} octets`);
    let j; try { j = JSON.parse(fs.readFileSync(chemin, 'utf8')); } catch { return refus('le fichier n\'est pas du JSON lisible'); }
    if (!objetSimple(j)) return refus('le fichier doit être un objet { decision, le, produits }');
    for (const k of Object.keys(j)) if (!CLES_FICHIER.includes(k)) return refus(`clé inconnue « ${String(k).slice(0, 40)} » (permises : ${CLES_FICHIER.join(', ')})`);
    if (typeof j.decision !== 'string' || !j.decision.trim()) return refus('`decision` doit être un texte non vide');
    if (j.decision.length > DECISION_MAX) return refus(`\`decision\` dépasse ${DECISION_MAX} caractères`);
    if (j.source !== undefined && typeof j.source !== 'string') return refus('`source`, quand il est présent, doit être un texte');
    if (!dateValide(j.le)) return refus('`le` doit être une date AAAA-MM-JJ valide');
    if (!Array.isArray(j.produits)) return refus('`produits` doit être un tableau');
    if (j.produits.length === 0) return refus('`produits` est vide : une liste sans produit n\'exclut rien et n\'a pas de raison d\'être');
    if (j.produits.length > PRODUITS_MAX) return refus(`\`produits\` dépasse ${PRODUITS_MAX} éléments`);
    const exclusions = new Map(), produits = [];
    for (let i = 0; i < j.produits.length; i++) {
        const p = j.produits[i], ou = `produits[${i}]`;
        if (!objetSimple(p)) return refus(`${ou} doit être un objet { idProduct, motif }`);
        for (const k of Object.keys(p)) if (k !== 'idProduct' && k !== 'motif') return refus(`${ou} : clé inconnue « ${String(k).slice(0, 40)} »`);
        if (!entierPositif(p.idProduct)) return refus(`${ou} : idProduct doit être un entier > 0`);
        if (typeof p.motif !== 'string' || !MOTIFS.includes(p.motif)) return refus(`${ou} : motif hors de la liste fermée (${MOTIFS.join(', ')})`);
        if (exclusions.has(p.idProduct)) return refus(`${ou} : idProduct ${p.idProduct} en double`);
        exclusions.set(p.idProduct, p.motif); produits.push({ idProduct: p.idProduct, motif: p.motif });
    }
    return { ok: true, decision: j.decision, le: j.le, source: j.source ?? null, produits, exclusions };
}

/** Les compteurs d'exclusion d'une archive reçue : absents ensemble, ou présents ensemble et COHÉRENTS (entiers, quatre motifs exactement, somme = total). @returns {string|null} le refus, ou null */
function verifierComptes(c) {
    if (!c || typeof c !== 'object') return null;
    if (c.exclus === undefined && c.exclusParMotif === undefined) return null;
    if (c.exclus === undefined || c.exclusParMotif === undefined) return 'exclusions : `exclus` et `exclusParMotif` vont ensemble';
    if (!Number.isInteger(c.exclus) || c.exclus < 0) return 'exclusions : `exclus` doit être un entier ≥ 0';
    const p = c.exclusParMotif;
    if (!objetSimple(p)) return 'exclusions : `exclusParMotif` illisible';
    const cles = Object.keys(p);
    if (cles.length !== MOTIFS.length || !MOTIFS.every(m => cles.includes(m))) return 'exclusions : `exclusParMotif` doit porter exactement les quatre motifs de la liste fermée';
    if (!MOTIFS.every(m => Number.isInteger(p[m]) && p[m] >= 0)) return 'exclusions : chaque nombre par motif doit être un entier ≥ 0';
    if (MOTIFS.reduce((s, m) => s + p[m], 0) !== c.exclus) return 'exclusions : la somme par motif diffère du total `exclus`';
    return null;
}

/**
 * Le SUIVI de l'exclusion. `retenir(e)` est appelé pour CHAQUE entrée que decider émet : vrai = l'entrée est celle d'un produit exclu, elle ne va pas plus loin (le constructeur ne la voit jamais).
 * `bilan()` : un exclu est RETIRÉ s'il avait un visuel dans l'archive, c'est-à-dire des entrées VALIDES (lireEntree) toutes au même visuel ; sinon il n'en avait déjà pas (aucune entrée, entrées rejetées par
 * la validation d'entrée, ou visuels contradictoires — le constructeur n'en aurait servi aucun) et il est LISTÉ avec sa raison : une liste périmée se dit.
 */
function suivre(exclusions) {
    if (!(exclusions instanceof Map)) throw new Error('exclusions : une Map idProduct → motif est attendue');
    if (exclusions.size === 0) throw new Error('exclusions : la Map est vide (une liste sans produit n\'exclut rien)');
    for (const [id, motif] of exclusions) {
        if (!entierPositif(id)) throw new Error('exclusions : idProduct entier > 0 attendu');
        if (typeof motif !== 'string' || !MOTIFS.includes(motif)) throw new Error(`exclusions : motif hors de la liste fermée pour ${id}`);
    }
    const vus = new Map();            // idProduct → { visuels: Set (clés de visuel des entrées valides), invalides: nombre d'entrées rejetées }
    const cleVisuel = d => JSON.stringify([d.vignette.cle, d.vignette.w, d.vignette.h, d.grande ? [d.grande.cle, d.grande.w, d.grande.h] : null]);
    return {
        retenir(e) {
            const id = e && e.idProduct;
            if (!exclusions.has(id)) return false;
            const s = vus.get(id) || { visuels: new Set(), invalides: 0 }; vus.set(id, s);
            const r = lireEntree(e);
            if (r.ok) s.visuels.add(cleVisuel(r.doc)); else s.invalides++;
            return true;
        },
        bilan() {
            const exclusParMotif = parMotifVide(), sansVisuel = [];
            let exclus = 0;
            for (const id of [...exclusions.keys()].sort((a, b) => a - b)) {
                const motif = exclusions.get(id), s = vus.get(id);
                if (s && s.visuels.size === 1) { exclus++; exclusParMotif[motif]++; continue; }
                sansVisuel.push({ idProduct: id, motif, raison: !s ? 'aucune entrée de visuel (absent du jeu, sans carte, sans image ou sans fiche du site)'
                    : s.visuels.size > 1 ? 'visuels contradictoires (le constructeur n\'en aurait servi aucun)' : `${s.invalides} entrée(s) rejetée(s) par la validation d'entrée` });
            }
            return { exclus, exclusParMotif, sansVisuel };
        }
    };
}

module.exports = { MOTIFS, lireFichierExclusions, verifierComptes, suivre };
