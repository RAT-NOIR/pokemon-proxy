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

let d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabsca, numero: '184' }, { carte: pikachu, numero: '65' }]), P1);
verifier('nominal : la métacarte ET la Setlist désignent Rabsca ex ; le numéro est celui de la Setlist', [d.carte?._id, d.numero, d.raison], [321492, '184', null]);

d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabsca, numero: '184' }]), produit(824921, 'Rabsca ex'));
verifier('un produit SANS crochets ne se désigne pas (« Honey » est Sweet Honey)', [d.carte, /sans attaque/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492, 321500], 901: [321492, 321500] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('la métacarte désigne DEUX cartes à page → refus', [d.carte, /métacarte : 2 cartes/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [-888691], 901: [-888691] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('un _id négatif (fiche simple fabriquée) n\'est pas une carte de la source : la métacarte est muette → refus', [d.carte, /aucun autre produit joint/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [-888691, 321492], 901: [-888691, 321492] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('… mais elle ne gêne pas la vraie carte (négatif + page → la page)', [d.carte?._id, d.numero], [321492, '184']);

d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabsca, numero: '184' }, { carte: rabsca, numero: '240' }]), P1);
verifier('la Setlist range la carte à DEUX numéros → refus, jamais un numéro choisi', [d.carte, /plusieurs numéros|2 entrées/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabsca, numero: '184' }, { carte: rabscaVieille, numero: '12' }]), P1);
verifier('deux cartes de la Setlist portent ce nom et ces attaques → refus (un nom qui en désigne plusieurs ne désigne rien)', [d.carte, /2 cartes/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabscaVieille, numero: '12' }]), P1);
verifier('la métacarte désigne une carte, la Setlist en désigne une autre → « désaccord », rien', [d.carte, /désaccord/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: pikachu, numero: '65' }]), P1);
verifier('le nom contredit : aucune carte de la Setlist ne porte ce nom → refus', [d.carte, /Setlist/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: {} }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('métacarte sans autre produit joint → refus (un seul élément n\'est pas une preuve)', [d.carte, /aucun autre produit joint/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabsca, numero: null }]), P1);
verifier('une entrée de Setlist sans numéro ne donne pas de numeroFiche → refus', [d.carte, /sans numéro/.test(d.raison)], [null, true]);

d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabsca, numero: '184' }]), P1, { sauf: 321492 });
verifier('calibration « vraie carte retirée » : la carte retirée ne peut être désignée', [d.carte], [null]);

// `sauf` doit s'appliquer à la Setlist ET à la métacarte : ici la métacarte ne désigne que la vieille page, la Setlist porte les deux. Sans `sauf` sur la
// Setlist, deux cartes candidates → refus ; avec lui, la vieille page est la seule candidate et elle est désignée (la métacarte vidée ne suffit pas à passer).
d = designerParSetlist(ctx({ 1: { 900: [300001], 901: [300001] } }, [{ carte: rabsca, numero: '184' }, { carte: rabscaVieille, numero: '12' }]), P1, { sauf: 321492 });
verifier('sauf est appliqué à la SETLIST : la carte retirée n\'y compte plus, la seule candidate restante est désignée', [d.carte?._id, d.numero, d.atteint], [300001, '12', true]);
d = designerParSetlist(ctx({ 1: { 900: [300001], 901: [300001] } }, [{ carte: rabsca, numero: '184' }, { carte: rabscaVieille, numero: '12' }]), P1);
verifier('… sans sauf, la Setlist porte DEUX cartes à ce nom et ces attaques → refus, mais le cas est ATTEINT (la clé a eu à choisir)', [d.carte, d.atteint], [null, true]);

// ── tour 2 : le mécanisme de « SM-P Vikavolt » (relecture du danger) ──
// Deux pages du même texte, orthographe d'attaque différente (« Electro Cannon » / « Electricannon »), Cardmarket les range sous UNE métacarte. Le frère joint
// ne désigne que la page A ; la page B n'est pas « compatible » (orthographe), donc l'ancienne clé choisissait A pour un produit qui était B.
const vikavolt = carte(216902, 'Vikavolt', ['Electro Cannon']), vikavoltB = carte(234669, 'Vikavolt', ['Electricannon']);
const PV = produit(470104, 'Vikavolt [Strong Charge | Electro Cannon]');
d = designerParSetlist(ctx({ 1: { 900: [216902], 901: [216902] } }, [{ carte: vikavolt, numero: '007' }, { carte: vikavoltB, numero: '309' }]), { ...PV, idProduct: 824921 });
verifier('homonyme à attaque d\'orthographe VOISINE (Electricannon / Electro Cannon) dans la Setlist → refus (jamais la page « compatible » par chance)', [d.carte, /attaque voisine/.test(d.raison)], [null, true]);
d = designerParSetlist(ctx({ 1: { 900: [216902], 901: [216902] } }, [{ carte: vikavolt, numero: '007' }, { carte: carte(234670, 'Vikavolt', ['Thunder Shock']), numero: '309' }]), { ...PV, idProduct: 824921 });
verifier('… un homonyme aux attaques SANS rapport (Thunder Shock) ne gêne pas', [d.carte?._id, d.numero], [216902, '007']);
// le témoin des attaques du produit contre celles de la carte (cleAttaque de la production) : un désaccord contredit ; l'absence n'est pas un désaccord
const { temoinAttaques } = require('./collecte-cartes/cle-setlist-metacarte');
verifier('témoin : Zacian V [Roar of the Sword | Storm Slash] contre une carte dont l\'attaque est Brave Blade → CONTREDIT', temoinAttaques(carte(244903, 'Zacian V', ['Brave Blade']), produit(1, 'Zacian V [Roar of the Sword | Storm Slash]')), 'contredit');
verifier('témoin : au moins une attaque commune (le talent entre crochets ne compte pas) → concorde', temoinAttaques(carte(264744, 'Zacian V', ['Storm Slash']), produit(1, 'Zacian V [Roar of the Sword | Storm Slash]')), 'concorde');
verifier('témoin : produit sans crochets, ou carte sans attaque lisible → NON contredit (inconnu)', [temoinAttaques(carte(1, 'Switch', []), produit(1, 'Switch')), temoinAttaques(carte(2, 'Mew', []), produit(1, 'Mew [Psychic]')), temoinAttaques(carte(3, 'Mew', ['Psychic']), produit(1, 'Mew'))], ['inconnu', 'inconnu', 'inconnu']);

// ── tour 2 : la FORME du numéro, par les fonctions de la production (cleNumero, chiffresDuNumero) ──
const { comparerNumeros } = require('./collecte-cartes/calibration-setlist-metacarte');
verifier('numéros : « 22 » et « 022 » = égaux ; « SWSH022 » et « 22 » = même numéro, FORME différente ; « SWSH022 » et « SM022 » = différents ; « 22 » et « 23 » = différents',
    [comparerNumeros('22', '022'), comparerNumeros('SWSH022', '22'), comparerNumeros('22', 'SWSH022'), comparerNumeros('SWSH022', 'SWSH022'), comparerNumeros('SWSH022', 'SM022'), comparerNumeros('22', '23')], ['egal', 'forme', 'forme', 'egal', 'different', 'different']);
const { planDuSet: planDuSet2 } = require('./collecte-cartes/cle-setlist-metacarte');
const bas2 = meta({ 1: { 900: [321492], 901: [321492] } });
const planForme = (lignesDuSet, numero) => planDuSet2({ base: bas2, entrees: [{ carte: rabsca, numero }], produits: [P1], lignesDuSet, jointsIds: new Set([900]), tirage: 'id', expansion: 'X' });
let QF = planForme([{ carteId: 5, numeroFiche: 'SWSH001' }, { carteId: 6, numeroFiche: 'SWSH002' }], '184');
verifier('plan : les lignes du set écrivent « SWSH001 », la Setlist « 184 » → refusé « forme du numéro », rien n\'est posé', [QF.retenus.length, QF.refus.length, /forme du numéro/.test(QF.refus[0]?.raison || '')], [0, 1, true]);
QF = planForme([{ carteId: 5, numeroFiche: '001' }, { carteId: 6, numeroFiche: '002' }], '184');
verifier('plan : les lignes du set écrivent des numéros nus comme la Setlist → posé', [QF.retenus.length], [1]);

// ── tour 3 : la clé ne désigne pas un cas que sa calibration (population D : métacarte à >= 2 frères) ne mesure pas ──
d = designerParSetlist(ctx({ 1: { 900: [321492] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('UN seul frère joint (la calibration du danger exige >= 2) → refus « frère(s) joint(s) », la clé ne désigne pas', [d.carte, /1 frère\(s\) joint\(s\), il en faut 2/.test(d.raison)], [null, true]);
d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [321492] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('… deux frères joints à la même carte → désignée', [d.carte?._id, d.numero], [321492, '184']);
d = designerParSetlist(ctx({ 1: { 900: [321492], 901: [-888691] } }, [{ carte: rabsca, numero: '184' }]), P1);
verifier('… un frère joint à une fiche simple (_id négatif) ne compte pas comme frère → refus', [d.carte, /1 frère\(s\) joint\(s\)/.test(d.raison)], [null, true]);

// ── le plan d'un set ──
const { planDuSet } = require('./collecte-cartes/cle-setlist-metacarte');
const bas = meta({ 1: { 900: [321492], 901: [321492] } });
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
