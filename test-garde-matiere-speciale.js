// node test-garde-matiere-speciale.js — la GARDE DE LOT arrête tout lot qui POSE une ligne cartes_produits (ou un liens.idProduct) sur un produit de PRODUITS_MATIERE_SPECIALE (lot METAL, correction 1, I1).
// Point de passage COMMUN de toute écriture (lot-additif.js → garde-lot.js) : elle couvre les chemins d'écriture présents ET futurs. Documents FABRIQUÉS : aucune base.
'use strict';
const G = require('./collecte-cartes/garde-lot');
const M = require('./collecte-cartes/matiere-speciale');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const ligne = (carteId, idProduct, idExpansion = 4347) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion });
const carte = (id, idProducts) => ({ _id: id, nomEn: 'X', sets: ['Banc'], liens: { idProduct: idProducts } });
const juger = (avantDocs, apresDocs) => G.comparer(G.compterEtat(avantDocs), G.compterEtat(apresDocs));

const AVANT = { cartesProduits: [ligne(60348, 576772)], cartes: [carte(60348, [576772])] };

// 1. un lot qui POSE une ligne sur 580162 : arrêt (non autorisé), nommé
const APRES_LIGNE = { cartesProduits: [ligne(60348, 576772), ligne(60348, 580162)], cartes: [carte(60348, [576772])] };
let c = juger(AVANT, APRES_LIGNE);
verifier('lot posant une ligne sur 580162 : ARRÊT (une non-autorisée)', c.nonAutorisees.map(b => [b.compteur, b.groupe]), [['matiere-speciale', 'prod:580162 ligne:60348|580162']]);
// 2. un lot qui pose le liens.idProduct seul
c = juger(AVANT, { cartesProduits: AVANT.cartesProduits, cartes: [carte(60348, [576772, 580162])] });
verifier('lot posant liens.idProduct = 580162 : ARRÊT', c.nonAutorisees.map(b => [b.compteur, b.groupe]), [['matiere-speciale', 'prod:580162 lien:60348']]);
// 3. un lot qui ne touche pas la table passe (y compris avec des hausses ordinaires)
c = juger(AVANT, { cartesProduits: [ligne(60348, 576772), ligne(60348, 576750)], cartes: [carte(60348, [576772, 576750])] });
verifier('lot ordinaire : passe', c.nonAutorisees.length, 0);
// 4. une ligne DÉJÀ présente avant le lot et inchangée n'est pas le fait du lot : il passe (c'est le lot de retrait qui la retire)
const DEJA = { cartesProduits: [ligne(60348, 580162)], cartes: [carte(60348, [580162])] };
verifier('ligne préexistante inchangée : le lot passe', juger(DEJA, DEJA).nonAutorisees.length, 0);
// 5. le lot de RETRAIT lui-même (la ligne disparaît) ne déclenche pas la garde matière (la baisse « fiches » se gère par l'annonce)
c = juger(DEJA, { cartesProduits: [], cartes: [carte(60348, [])] });
verifier('retrait : aucune non-autorisée du compteur matiere-speciale', c.nonAutorisees.filter(b => b.compteur === 'matiere-speciale').length, 0);
// 6. un lot qui pose une ligne sur 580161 (second produit de la table) est arrêté aussi : la table est lue, pas recopiée
const APRES_161 = { cartesProduits: [...AVANT.cartesProduits, ligne(1, 580161)], cartes: AVANT.cartes };
verifier('580161 aussi', juger(AVANT, APRES_161).nonAutorisees.map(b => b.groupe), ['prod:580161 ligne:1|580161']);

// M-1 (correction 2) : le compte est par _id de LIGNE (et par couple carte/produit pour les liens), pas par produit : retirer la ligne X et poser la ligne Y sur le même produit (1 → 1) = ARRÊT
const X = { cartesProduits: [ligne(60348, 580162)], cartes: [carte(60348, [580162])] };
const Y = { cartesProduits: [ligne(77, 580162)], cartes: [carte(77, [580162])] };
c = juger(X, Y);
verifier('M-1 : remplacer la ligne X par la ligne Y sur 580162 (1 → 1) : ARRÊT', c.nonAutorisees.map(b => b.groupe).sort(), ['prod:580162 lien:77', 'prod:580162 ligne:77|580162']);
verifier('M-1 : le retrait seul (la ligne X disparaît) ne déclenche pas la garde matière', juger(X, { cartesProduits: [], cartes: [carte(60348, [])] }).nonAutorisees.filter(b => b.compteur === 'matiere-speciale').length, 0);
verifier('M-1 : aucun changement passe', juger(X, X).nonAutorisees.length, 0);

// I-1 (correction 2) : l'état passe par la VRAIE projection de lot-additif (constante partagée PROJECTION_ETAT), jamais par des documents fabriqués avec `liens`
const projeter = (doc, proj) => { const o = { _id: doc._id };   /* MongoDB garde _id par défaut */ for (const k of Object.keys(proj)) { const [tete, ...reste] = k.split('.'); if (!(tete in doc)) continue; if (!reste.length) { o[tete] = doc[tete]; continue; } const v = doc[tete]; const f = x => reste.reduce((a, p) => (a == null ? a : a[p]), x); const mettre = (obj, chemin, val) => { let cur = obj; chemin.slice(0, -1).forEach(p => { cur = cur[p] = cur[p] || {}; }); cur[chemin[chemin.length - 1]] = val; }; if (Array.isArray(v)) { o[tete] = o[tete] || v.map(() => ({})); v.forEach((e, i) => { if (f(e) !== undefined) mettre(o[tete][i], reste, f(e)); }); } else { o[tete] = o[tete] || {}; if (f(v) !== undefined) mettre(o[tete], reste, f(v)); } } return o; };
verifier('la projection partagée existe (PROJECTION_ETAT.cartes et .cartesProduits)', [typeof (G.PROJECTION_ETAT || {}).cartes, typeof (G.PROJECTION_ETAT || {}).cartesProduits], ['object', 'object']);
const PC = (G.PROJECTION_ETAT || {}).cartes || {}, PL = (G.PROJECTION_ETAT || {}).cartesProduits || {};
const pris = docs => ({ cartes: docs.cartes.map(d => projeter(d, PC)), cartesProduits: docs.cartesProduits.map(d => projeter(d, PL)) });
c = G.comparer(G.compterEtat(pris(AVANT)), G.compterEtat(pris({ cartesProduits: AVANT.cartesProduits, cartes: [carte(60348, [576772, 580162])] })));
verifier('I-1 : un lien posé sur 580162 est VU à travers la projection réelle', c.nonAutorisees.map(b => b.groupe), ['prod:580162 lien:60348']);
verifier('I-1 : lot-additif.js lit l\'état par la constante partagée (aucune projection recopiée)', /PROJECTION_ETAT\.cartes/.test(require('fs').readFileSync(require('path').join(__dirname, 'lot-additif.js'), 'utf8')) && !/\.project\(\{ sets: 1, nomEn: 1/.test(require('fs').readFileSync(require('path').join(__dirname, 'lot-additif.js'), 'utf8')), true);
// 7. la table lue est CELLE du module (aucune copie dans la garde)
verifier('aucune copie de la table dans garde-lot.js', /580162|580161/.test(require('fs').readFileSync(require('path').join(__dirname, 'collecte-cartes', 'garde-lot.js'), 'utf8')), false);
verifier('et le module de table est bien importé par la garde', /require\('\.\/matiere-speciale'\)/.test(require('fs').readFileSync(require('path').join(__dirname, 'collecte-cartes', 'garde-lot.js'), 'utf8')), true);
// 8. restauré : le plan de restauration de la garde SUPPRIME la ligne posée par le lot arrêté (état après → état de la sauvegarde)
const sauves = new Map([[G.cleDoc('60348|576772'), ligne(60348, 576772)]]);
const actuels = new Map([[G.cleDoc('60348|576772'), ligne(60348, 576772)], [G.cleDoc('60348|580162'), ligne(60348, 580162)]]);
const plan = G.planRestauration(sauves, actuels);
verifier('restauration : la ligne posée sur 580162 est à supprimer', plan.supprimer.length, 1);
verifier('la table utilisée est celle de matiere-speciale.js (580162 y est)', M.estMatiereSpeciale(580162), true);

console.log(`\ntest-garde-matiere-speciale : ${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
