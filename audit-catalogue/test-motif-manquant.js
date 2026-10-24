// node audit-catalogue/test-motif-manquant.js — pourquoi un produit n'a AUCUNE entrée servie (motif du MANQUANT). `decider` écarte dans cet ordre : pas de ligne → carte/set absents →
// sans fiche du site → aucun visuel → repli refusé → partage incohérent ; `lireEntree` refuse en dernier. Le motif rendu est le stade LE PLUS AVANCÉ atteint par l'une des lignes du produit.
const { motifManquant } = require('./etat-api');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const carteExiste = id => id !== 999;
const L = (carteId = 1) => ({ carteId });
const T = (o = {}) => ({ carteId: 1, sansFiche: false, im: { cleR2: 'x' }, refus: null, ...o });

verifier('aucune ligne : sans-ligne', motifManquant({ lignes: [], traces: [], carteExiste }), 'sans-ligne');
verifier('une ligne dont la carte n\'existe pas : carte-absente', motifManquant({ lignes: [L(999)], traces: [], carteExiste }), 'carte-absente');
verifier('une ligne, carte présente, aucun set candidat : aucun-set-candidat', motifManquant({ lignes: [L(1)], traces: [], carteExiste }), 'aucun-set-candidat');
verifier('la règle du site n\'attribue pas le produit : sans-fiche-du-site', motifManquant({ lignes: [L()], traces: [T({ sansFiche: true, im: null })], carteExiste }), 'sans-fiche-du-site');
verifier('une fiche mais aucun visuel : aucun-visuel', motifManquant({ lignes: [L()], traces: [T({ im: null })], carteExiste }), 'aucun-visuel');
verifier('un visuel d\'un autre tirage refusé à une famille : repli-refuse:<famille>', motifManquant({ lignes: [L()], traces: [T({ refus: 'wcd' })], carteExiste }), 'repli-refuse:wcd');
verifier('un visuel qui passe le repli mais pas la cohérence du partage : partage-incoherent', motifManquant({ lignes: [L()], traces: [T()], carteExiste }), 'partage-incoherent');
verifier('lireEntree a refusé l\'entrée : le motif de lireEntree, préfixé', motifManquant({ lignes: [L()], traces: [T()], carteExiste, entreeRefusee: 'champ "rarete" absent' }), 'entree-refusee:champ "rarete" absent');
verifier('deux lignes (sans fiche, puis aucun visuel) : le stade le plus avancé gagne', motifManquant({ lignes: [L(1), L(2)], traces: [T({ carteId: 1, sansFiche: true, im: null }), T({ carteId: 2, im: null })], carteExiste }), 'aucun-visuel');
verifier('deux lignes (aucun visuel, puis repli refusé) : le repli gagne', motifManquant({ lignes: [L(1), L(2)], traces: [T({ carteId: 1, im: null }), T({ carteId: 2, refus: 'prize-packs' })], carteExiste }), 'repli-refuse:prize-packs');
verifier('une trace d\'une AUTRE carte ne compte pas pour la ligne', motifManquant({ lignes: [L(1)], traces: [T({ carteId: 2, im: null })], carteExiste }), 'aucun-set-candidat');

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
