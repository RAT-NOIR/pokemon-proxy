'use strict';
// MARQUE-EMPRUNT / VERDICTS — le fichier des verdicts de l'audit des emprunts (écrit par l'API : designation/emprunts-verdicts.json), lu à la CONSTRUCTION de l'archive (--verdicts-emprunts=<fichier>).
// Un verdict porte sur un produit dont le visuel est emprunté à un autre tirage :
//   « juste » — le catalogue a jugé l'illustration identique à la vignette Cardmarket du produit : l'emprunt est VÉRIFIÉ, la colonne des emprunts ne le porte pas (empruntDe → false) et la règle d'image peut s'en servir ;
//   « exclu » — le visuel est faux : le produit sort de l'identification, comme une exclusion (motif « visuel-faux ») ;
//   null / aucune ligne / aucun fichier — pas de verdict : l'emprunt reste NON vérifié (défaut fermé, la règle se tait).
// Écrit par ce qu'il AUTORISE : un fichier illisible, une forme inattendue, un verdict hors de { juste, exclu, null }, un idProduct qui n'est pas un entier > 0, un produit en double avec deux verdicts différents :
// REFUS NOMMÉ (la construction lève, jamais un repli silencieux). Les clés `comparaisons` et `preuve` sont informatives (non jugées au-delà de leur type).
const fs = require('fs');

const VERDICTS = Object.freeze(['juste', 'exclu']);
const TAILLE_MAX = 16 * 1048576, LIGNES_MAX = 200000;
const refus = raison => ({ ok: false, raison });
const entierPositif = x => Number.isSafeInteger(x) && x > 0;
const objetSimple = x => x !== null && typeof x === 'object' && !Array.isArray(x);

/** Juge des lignes déjà parsées. @returns {{ ok: true, verdicts: Map<idProduct, 'juste'|'exclu'|null>, comptes } | { ok: false, raison }} */
function jugerVerdicts(lignes) {
    if (!Array.isArray(lignes)) return refus('les verdicts doivent être un tableau de lignes (ou un objet { lignes: [...] })');
    if (lignes.length > LIGNES_MAX) return refus(`plus de ${LIGNES_MAX} lignes`);
    const verdicts = new Map();
    for (let i = 0; i < lignes.length; i++) {
        const l = lignes[i], ou = `ligne ${i}`;
        if (!objetSimple(l)) return refus(`${ou} : un objet { idProduct, verdict } est attendu`);
        if (!entierPositif(l.idProduct)) return refus(`${ou} : idProduct doit être un entier > 0`);
        if (l.verdict === undefined) return refus(`${ou} : \`verdict\` absent (null admis : pas de verdict, absent non)`);
        if (l.verdict !== null && !VERDICTS.includes(l.verdict)) return refus(`${ou} : verdict inconnu « ${String(l.verdict).slice(0, 30)} » (permis : ${VERDICTS.join(', ')}, null)`);
        if (l.preuve !== undefined && l.preuve !== null && typeof l.preuve !== 'string') return refus(`${ou} : \`preuve\`, quand elle est présente, doit être un texte`);
        if (verdicts.has(l.idProduct) && verdicts.get(l.idProduct) !== l.verdict) return refus(`${ou} : idProduct ${l.idProduct} porte deux verdicts différents`);
        verdicts.set(l.idProduct, l.verdict);
    }
    const comptes = { lignes: lignes.length, juste: 0, exclu: 0, sansVerdict: 0 };
    for (const v of verdicts.values()) { if (v === 'juste') comptes.juste++; else if (v === 'exclu') comptes.exclu++; else comptes.sansVerdict++; }
    return { ok: true, verdicts, comptes };
}

/** Lit et juge le fichier. Ne lève jamais. */
function lireFichierVerdicts(chemin) {
    if (typeof chemin !== 'string' || !chemin.trim()) return refus('aucun fichier nommé');
    let st; try { st = fs.statSync(chemin); } catch { return refus('le fichier est introuvable ou illisible'); }
    if (!st.isFile()) return refus('ce n\'est pas un fichier');
    if (st.size === 0) return refus('le fichier est vide');
    if (st.size > TAILLE_MAX) return refus(`le fichier dépasse ${TAILLE_MAX} octets`);
    let j; try { j = JSON.parse(fs.readFileSync(chemin, 'utf8')); } catch { return refus('le fichier n\'est pas du JSON lisible'); }
    return jugerVerdicts(Array.isArray(j) ? j : objetSimple(j) && Array.isArray(j.lignes) ? j.lignes : j);
}

module.exports = { VERDICTS, jugerVerdicts, lireFichierVerdicts };
