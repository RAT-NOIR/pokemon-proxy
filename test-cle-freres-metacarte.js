// node test-cle-freres-metacarte.js — LA CLÉ « FRÈRES DE MÉTACARTE DANS LE MÊME SET » (lot M2) : objets purs, aucun réseau, aucune base.
// Monde : un set SetX (expansion 7) ; deux cartes à nom unique (Mon1 n°1 et Mon2 n°2) ; des produits de même métacarte joints ou non.
// TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE (le rouge se voit en cassant le code, pas en supposant).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const K = require(path.join(DIR, 'collecte-cartes', 'cle-freres-metacarte'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const carte = (id, nomEn, attaques = [], extra = {}) => ({ _id: id, nomEn, attaques: attaques.map(nom => ({ nom })), niveau: null, sets: ['SetX'], impressions: [], ...extra });
const C1 = carte(1, 'Mon1', ['Aa1', 'Bb1']), C2 = carte(2, 'Mon2', ['Aa2', 'Bb2']);
const ligne = (idProduct, carteId, extra = {}) => ({ idProduct, carteId, slugSet: 'SetX', numeroFiche: '1', preuve: 'set+numero', ...extra });
// export : idProduct -> { idMetacard, idExpansion }
const exp = lst => new Map(lst.map(([id, meta, ex = 7]) => [id, { idMetacard: meta, idExpansion: ex }]));
const metaDe = exp([[10, 100], [11, 100], [12, 100], [13, 100], [20, 200], [21, 200], [22, 200], [30, 300], [31, 300], [40, 100, 8], [41, 100, 8]]);
const prod = (idProduct, nom, attaques = []) => ({ idProduct, nom, attaques, idMetacard: metaDe.get(idProduct)?.idMetacard ?? null, idExpansion: metaDe.get(idProduct)?.idExpansion ?? null });
const ctx = (lignes, cartes = [C1, C2], sauf = null) => ({ freres: K.indexerFreres(lignes, metaDe), set: K.preparerSet(cartes, { slugSet: 'SetX', sauf }) });

// ── le cas qui passe ──
let r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)]), prod(10, 'Mon1', ['Aa1', 'Bb1']));
verifier('deux frères joints à la MÊME carte, nom unique dans le set, témoins muets : la carte est désignée', [r.carte?._id, r.raison, r.niveau, r.atteint], [1, null, 3, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)]), prod(10, 'Mon1'));
verifier('   un produit sans attaque (Dresseur) est désigné aussi : la clé ne lit pas le nom du produit', [r.carte?._id, r.raison], [1, null]);

// ── les refus, chacun nommé ──
r = K.designerParFreres(ctx([ligne(11, 1)]), prod(10, 'Mon1'));
verifier('UN seul frère joint : refus (la calibration du danger ne mesure pas moins)', [r.carte, /2/.test(r.raison), r.niveau], [null, true, 0]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 2)]), prod(10, 'Mon1'));
verifier('deux frères sur DEUX cartes : refus, la clé a évalué les frères (niveau 1)', [r.carte, /plusieurs cartes|2 cartes/.test(r.raison), r.niveau], [null, true, 1]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1), ligne(13, -5)]), prod(10, 'Mon1'));
verifier('un frère joint à une FICHE SIMPLE (carteId <= 0) : refus', [r.carte, /fiche simple/.test(r.raison)], [null, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1, { slugSet: 'AutreSet' })]), prod(10, 'Mon1'));
verifier('un frère joint dans un AUTRE set : refus (« frères du même set »)', [r.carte, /autre set/.test(r.raison)], [null, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)], [C1, C2, carte(3, 'Mon1', ['Cc'])]), prod(10, 'Mon1'));
verifier('un HOMONYME dans le set : refus, nommé ; la clé a atteint le test du nom (niveau 2)', [r.carte, /homonyme/.test(r.raison), r.niveau, r.atteint], [null, true, 2, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)], [C2]), prod(10, 'Mon1'));
verifier('la carte des frères n\'est pas parmi les cartes du set : refus', [r.carte, /hors du set/.test(r.raison)], [null, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)]), prod(10, 'Mon2', ['Aa2', 'Bb2']));
verifier('TÉMOIN DU NOM : le produit porte le nom d\'une AUTRE carte du set (Mon2) alors que les frères désignent Mon1 : refus', [r.carte, /nom/.test(r.raison)], [null, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)]), prod(10, 'Mon1', ['Zz', 'Yy']));
verifier('TÉMOIN DES ATTAQUES : les attaques du produit contredisent celles de la carte : refus', [r.carte, /attaques/.test(r.raison)], [null, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)]), { ...prod(10, 'Mon1'), idMetacard: null });
verifier('produit sans métacarte : refus', [r.carte, /métacarte/.test(r.raison)], [null, true]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1), ligne(41, 2)]), prod(10, 'Mon1'));
verifier('un « frère » d\'une AUTRE expansion (même métacarte) ne compte pas, ne contredit pas', [r.carte?._id], [1]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1), ligne(10, 2)]), prod(10, 'Mon1'));
verifier('les propres lignes du produit ne comptent pas comme frères', [r.carte?._id], [1]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1, { preuve: K.PREUVE })]), prod(10, 'Mon1'));
verifier('une ligne posée par CET outil (preuve circulaire) n\'est pas un frère', [r.carte, /2/.test(r.raison)], [null, true]);

// ── « vraie carte retirée » (sauf) ──
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1)], [C2], 1), prod(10, 'Mon1'), { sauf: 1 });
verifier('B : la vraie carte retirée des frères ET du set : personne n\'est désigné', [r.carte, r.niveau], [null, 0]);
r = K.designerParFreres(ctx([ligne(11, 1), ligne(12, 1), ligne(13, 2)]), prod(10, 'Mon1'));
verifier('(contrôle) frères 11, 12 sur Mon1 et 13 sur Mon2 : désaccord, refus', [r.carte], [null]);
// le danger de B : deux frères sur la carte 1 ET deux sur la carte 2 ; la clé refuse (désaccord) ; la carte 1 retirée, elle désignerait la carte 2
const metaB = exp([[10, 100], [11, 100], [12, 100], [13, 100], [14, 100]]);
const lgB = [ligne(11, 1), ligne(12, 1), ligne(13, 2), ligne(14, 2)];
const fB = K.indexerFreres(lgB, metaB), pB = { idProduct: 10, nom: 'Mon1', attaques: [], idMetacard: 100, idExpansion: 7 };
const rA = K.designerParFreres({ freres: fB, set: K.preparerSet([C1, C2], { slugSet: 'SetX' }) }, pB);
const rB = K.designerParFreres({ freres: fB, set: K.preparerSet([C2], { slugSet: 'SetX', sauf: 1 }) }, pB, { sauf: 1 });
verifier('le danger de l\'épreuve B existe : désaccord (refus) vraie carte présente, désignation de la voisine vraie carte retirée', [rA.carte, rB.carte?._id], [null, 2]);
let leve = null; try { K.designerParFreres({ freres: fB, set: K.preparerSet([C2], { slugSet: 'SetX', sauf: 1 }) }, pB); } catch (e) { leve = e.message; }
verifier('un set préparé avec `sauf` mais une désignation SANS `sauf` (ou l\'inverse) LÈVE : la calibration ne peut pas mélanger', /sauf/.test(leve || ''), true);

// ── l'index ──
const idx = K.indexerFreres([ligne(11, 1), ligne(12, 1), ligne(99, 1)], metaDe);
verifier('indexerFreres : clé « métacarte|expansion », produit -> cartes ; un produit absent de l\'export n\'entre pas', [[...idx.keys()], [...idx.get('100|7').keys()]], [['100|7'], [11, 12]]);
verifier('   chaque ligne garde son numeroFiche (la règle du numéro de la fiche lit celui des frères)', idx.get('100|7').get(11), [{ carteId: 1, slugSet: 'SetX', numeroFiche: '1' }]);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
