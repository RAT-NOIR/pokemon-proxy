// node test-lot-seulement.js — `--seulement=<f>.json` : la liste des SEULS idProduct à écrire (ceux que la règle des deux sources a confirmés). Fonctions PURES.
// Une garde s'écrit par ce qu'elle AUTORISE : ce qui n'est pas dans la liste n'est pas écrit, et une liste qui ne correspond pas au plan (un idProduct hors plan) refuse TOUT.
const L = require('./collecte-cartes/lot-seulement');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const leve = (nom, f, motif) => { try { f(); ko++; console.log(`❌ ${nom} : aurait dû lever`); } catch (e) { if (!motif || motif.test(e.message)) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom} : autre erreur : ${e.message}`); } } };

const plan = [{ p: { idProduct: 1 } }, { p: { idProduct: 2 } }, { p: { idProduct: 3 } }];
const cle = x => x.p.idProduct;

// ── restreindre : seuls les éléments dont l'idProduct est dans la liste
const r = L.restreindre(plan, new Set([1, 3]), cle);
verifier('restreindre : retient exactement ceux de la liste, dans l\'ordre du plan', r.retenus.map(cle), [1, 3]);
verifier('restreindre : les écartés sont nommés (le plan les proposait, la liste ne les confirme pas)', r.ecartes.map(cle), [2]);
verifier('restreindre : sans liste (null), rien n\'est filtré', L.restreindre(plan, null, cle).retenus.length, 3);
verifier('restreindre : une liste qui ne confirme rien retient zéro (jamais « tout »)', L.restreindre(plan, new Set([99]), cle).retenus.length, 0);

// ── horsPlan : un idProduct de la liste que AUCUN plan n'a proposé refuse tout
verifier('horsPlan : les ids de la liste absents des plans vus', L.horsPlan(new Set([1, 99, 98]), new Set([1, 2, 3])), [98, 99]);
verifier('horsPlan : liste couverte par le plan → aucun', L.horsPlan(new Set([1, 2]), new Set([1, 2, 3])), []);
verifier('horsPlan : sans liste → aucun', L.horsPlan(null, new Set([1])), []);

// ── lire : la liste est un tableau NON VIDE d'entiers (un fichier vide ne protège rien — il est refusé, pas ignoré)
verifier('lire : tableau d\'entiers → ensemble', [...L.lire('--seulement', () => '[3,1,2]')].sort(), [1, 2, 3]);
leve('lire : fichier vide → lève', () => L.lire('--seulement', () => '[]'), /NON VIDE/);
leve('lire : pas un tableau → lève', () => L.lire('--seulement', () => '{"a":1}'), /NON VIDE/);
leve('lire : des chaînes au lieu d\'entiers → lève', () => L.lire('--seulement', () => '["1","2"]'), /NON VIDE/);
leve('lire : illisible → lève, et nomme l\'option', () => L.lire('--seulement', () => { throw new Error('ENOENT'); }), /--seulement/);
leve('lire : doublons → lève (une liste fabriquée par un lot ne double pas un produit)', () => L.lire('--seulement', () => '[1,1,2]'), /doublon/);

// ── attendu : le nombre attendu est celui du plan RETENU (comme poser-wcd.js), jamais celui du plan brut
verifier('attendu : le compte du plan retenu égal à l\'attendu → ok', L.verifierAttendu({ retenus: 2, attendu: 2 }).ok, true);
verifier('attendu : l\'attendu du plan BRUT (3) alors que 2 sont retenus → refus', L.verifierAttendu({ retenus: 2, attendu: 3 }).ok, false);
verifier('attendu : absent → refus (--ecrire exige un attendu)', L.verifierAttendu({ retenus: 2, attendu: undefined }).ok, false);
// ── construire : la liste d'un lot = les lignes du plan CONFIRMÉES par deux sources, moins les produits détachés par décision, moins la matière spéciale
const detail = [{ idProduct: 1, ok: true }, { idProduct: 2, ok: false }, { idProduct: 3, ok: true }, { idProduct: 4, ok: true }, { idProduct: 5, ok: true }];
const C = L.construire({ detail, sauf: new Set([3]), estMatiere: id => id === 4 });
verifier('construire : confirmés moins détachés moins matière spéciale', C.ids, [1, 5]);
verifier('construire : chaque exclu est nommé avec son motif', C.refuses, [{ idProduct: 2, motif: 'non confirmé par deux sources' }, { idProduct: 3, motif: 'détaché par décision (--sauf)' }, { idProduct: 4, motif: 'matière spéciale (table fermée)' }]);
leve('construire : un détail vide lève (zéro ligne confirmée sur un plan non vide n\'est pas une liste)', () => L.construire({ detail: [], sauf: new Set(), estMatiere: () => false }), /vide/);
leve('construire : aucune ligne confirmée → lève (la liste serait vide, donc refusée à la lecture)', () => L.construire({ detail: [{ idProduct: 1, ok: false }], sauf: new Set(), estMatiere: () => false }), /aucune/);
leve('construire : un idProduct en double dans le détail lève (deux lignes d\'un même produit ne font pas une liste)', () => L.construire({ detail: [{ idProduct: 1, ok: true }, { idProduct: 1, ok: true }], sauf: new Set(), estMatiere: () => false }), /double/);
// ── filtrerParCodes : un lot par code ; un code absent du détail LÈVE (une liste vide par faute de frappe n'est pas un lot)
const det2 = [{ idProduct: 1, ok: true, code: 'A' }, { idProduct: 2, ok: true, code: 'B' }, { idProduct: 3, ok: false, code: 'B' }];
verifier('filtrerParCodes : seules les lignes des codes demandés', L.filtrerParCodes(det2, ['B']).map(d => d.idProduct), [2, 3]);
leve('filtrerParCodes : un code qu\'aucune ligne ne porte → lève', () => L.filtrerParCodes(det2, ['B', 'Z']), /Z/);console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
