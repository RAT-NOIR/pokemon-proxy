// node test-cle-setlist-metacarte.js — LA CLÉ « MÉTACARTE ∧ SETLIST DU SET » (lot SEA-2, 2026-10-12). Pur : aucun réseau, aucune base.
// Deux éléments INDÉPENDANTS doivent désigner la MÊME carte : les autres produits de la métacarte Cardmarket (déjà joints) ET la Setlist de Bulbapedia
// pour ce set (nom + attaques) ; le numéro vient de la Setlist. Noms et attaques de la fiche tirés de produits réels (824921 Rabsca ex, 825137 Pikachu).
const { designerParSetlist, indexerSetlist } = require('./collecte-cartes/cle-setlist-metacarte');
const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const carte = (id, nomEn, attaques) => ({ _id: id, nomEn, attaques: attaques.map(nom => ({ nom })) });
const rabsca = carte(321492, 'Rabsca ex', ['Upside Down Draw', 'Psychic']);
const rabscaVieille = carte(300001, 'Rabsca ex', ['Upside Down Draw', 'Psychic']);        // un autre texte du même nom qui partage les attaques
const pikachu = carte(282788, 'Pikachu', ['Charge', 'Pika Punch']);
const produit = (idProduct, name) => ({ idProduct, name, ...decomposerNomCardmarket(name) });
const P1 = produit(824921, 'Rabsca ex [Upside Down Draw | Psychic]');
const meta = (m) => ({ metacarteDe: id => (id === 824921 ? 1 : id === 825137 ? 2 : id === 900 ? 1 : null), parMeta: new Map(Object.entries(m).map(([k, v]) => [Number(k), new Map(Object.entries(v).map(([i, cs]) => [Number(i), new Set(cs)]))])) });
const ctx = (m, entrees) => ({ ...meta(m), setlist: indexerSetlist(entrees) });

let d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabsca, numero: '184' }, { carte: pikachu, numero: '65' }]), P1);
verifier('nominal : la métacarte ET la Setlist désignent Rabsca ex ; le numéro est celui de la Setlist', [d.carte?._id, d.numero, d.raison], [321492, '184', null]);

d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabsca, numero: '184' }]), produit(824921, 'Rabsca ex'));
verifier('un produit SANS crochets ne se désigne pas (« Honey » est Sweet Honey)', [d.carte, /sans attaque/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492, 321500] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('la métacarte désigne DEUX cartes à page → refus', [d.carte, /métacarte : 2 cartes/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [-888691] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('un _id négatif (fiche simple fabriquée) n\'est pas une carte de la source : la métacarte est muette → refus', [d.carte, /aucun autre produit joint/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [-888691, 321492] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('… mais elle ne gêne pas la vraie carte (négatif + page → la page)', [d.carte?._id, d.numero], [321492, '184']);

d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabsca, numero: '184' }, { carte: rabsca, numero: '240' }]), P1);
verifier('la Setlist range la carte à DEUX numéros → refus, jamais un numéro choisi', [d.carte, /plusieurs numéros|2 entrées/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabsca, numero: '184' }, { carte: rabscaVieille, numero: '12' }]), P1);
verifier('deux cartes de la Setlist portent ce nom et ces attaques → refus (un nom qui en désigne plusieurs ne désigne rien)', [d.carte, /2 cartes/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabscaVieille, numero: '12' }]), P1);
verifier('la métacarte désigne une carte, la Setlist en désigne une autre → « désaccord », rien', [d.carte, /désaccord/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: pikachu, numero: '65' }]), P1);
verifier('le nom contredit : aucune carte de la Setlist ne porte ce nom → refus', [d.carte, /Setlist/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: {} }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('métacarte sans autre produit joint → refus (un seul élément n\'est pas une preuve)', [d.carte, /aucun autre produit joint/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabsca, numero: null }]), P1);
verifier('une entrée de Setlist sans numéro ne donne pas de numeroFiche → refus', [d.carte, /sans numéro/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabsca, numero: '184' }]), P1, { sauf: 321492 });
verifier('calibration « vraie carte retirée » : la carte retirée ne peut être désignée', [d.carte], [null]);

// `sauf` doit s'appliquer à la Setlist ET à la métacarte : ici la métacarte ne désigne que la vieille page, la Setlist porte les deux. Sans `sauf` sur la
// Setlist, deux cartes candidates → refus ; avec lui, la vieille page est la seule candidate et elle est désignée (la métacarte vidée ne suffit pas à passer).
d = designerParSetlist(ctx({ 1: { 900: [300001] } }, [{ carte: rabsca, numero: '184' }, { carte: rabscaVieille, numero: '12' }]), P1, { sauf: 321492 });
verifier('sauf est appliqué à la SETLIST : la carte retirée n\'y compte plus, la seule candidate restante est désignée', [d.carte?._id, d.numero, d.atteint], [300001, '12', true]);
d = designerParSetlist(ctx({ 1: { 900: [300001] } }, [{ carte: rabsca, numero: '184' }, { carte: rabscaVieille, numero: '12' }]), P1);
verifier('… sans sauf, la Setlist porte DEUX cartes à ce nom et ces attaques → refus, mais le cas est ATTEINT (la clé a eu à choisir)', [d.carte, d.atteint], [null, true]);

// ── le plan d'un set ──
const { planDuSet } = require('./collecte-cartes/cle-setlist-metacarte');
const bas = meta({ 1: { 900: [321492] } });
const plan = (carteDoc, lignesDuSet) => planDuSet({ base: bas, entrees: [{ carte: carteDoc, numero: '184' }], produits: [P1], lignesDuSet, jointsIds: new Set([900]), tirage: 'id', expansion: 'SV-P Promotional cards' });
let Q = plan(rabsca, []);
verifier('plan : un produit non joint désigné → une ligne, une impression à poser', [Q.retenus.length, Q.impressions.size, Q.ecartes.length], [1, 1, 0]);
Q = plan({ ...rabsca, impressions: [{ tirage: 'id', expansion: 'SV-P Promotional cards', numero: '184' }] }, []);
verifier('plan : l\'impression existe déjà au même numéro → la ligne, pas d\'impression en double', [Q.retenus.length, Q.impressions.size], [1, 0]);
Q = plan(rabsca, [{ carteId: 321492, numeroFiche: '020', slugSet: 'S' }]);
verifier('plan : la carte est déjà jointe à un AUTRE numéro de ce set → écarté (fiche mélangée), rien n\'est posé', [Q.retenus.length, Q.ecartes.length], [0, 1]);
Q = planDuSet({ base: bas, entrees: [{ carte: rabsca, numero: '184' }], produits: [P1], lignesDuSet: [], jointsIds: new Set([824921]), tirage: 'id', expansion: 'X' });
verifier('plan : un produit déjà joint n\'est pas retouché', [Q.retenus.length, Q.refus.length], [0, 0]);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
