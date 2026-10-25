// node test-poser-numerotation.js — la NUMÉROTATION des fiches sans numéro : une impression « numero-cardmarket » sur la carte (tirage, expansion, numéro Cardmarket) + le numeroFiche de la ligne, pour les produits
// que la règle des deux sources a confirmés. FAUSSE BASE : aucune connexion. TOOL_DIR=<dossier> rejoue le banc contre une copie MUTÉE de l'outil (le rouge se voit en cassant le code).
const path = require('path');
const DIR = process.env.TOOL_DIR || __dirname;
const M = require(path.join(DIR, 'poser-numerotation.js'));

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };

const SET = { _id: 'SetZ', tirage: 'zh-hans', region: 'intl', bulba: { expansion: 'Exp Z' } };
const SET2 = { _id: 'SetZ-Add', tirage: 'zh-hans', region: 'intl', bulba: { expansion: 'Exp Z' } };            // un set jumeau : même tirage, même nom d'expansion
const SYN = { _id: 'SetS', tirage: 'zh-hans', region: 'intl', bulba: { expansion: 'reimpressions/xx' } };
const IMP = (numero, expansion = 'Exp Z') => ({ tirage: 'zh-hans', expansion, numero });
const carte = (id, over = {}) => [id, { _id: id, nomEn: `C${id}`, impressions: [], images: [], sets: ['SetZ'], ...over }];
const ligne = (idProduct, carteId, over = {}) => ({ _id: `${carteId}|${idProduct}`, carteId, idProduct, idExpansion: 7, slugSet: 'SetZ', tirage: 'zh-hans', preuve: 'metacarte+nom+attaques', numeroFiche: null, ...over });
const nc = (idProduct, numero) => [idProduct, { idProduct, numero: String(numero), slug: `X-CSZ${numero}`, codeSet: 'CSZ' }];
const sets = new Map([SET, SET2, SYN].map(s => [s._id, s]));
const base = () => ({ NC: new Map(), cartes: new Map(), sets, declarants: new Map(), lignesParCarte: new Map() });
function monde(lignes, ncs, cartes, over = {}) {
    const m = { ...base(), ...over }; m.lignes = lignes; for (const x of ncs) m.NC.set(...x); for (const c of cartes) m.cartes.set(...c);
    for (const l of [...lignes, ...(over.autresLignes || [])]) (m.lignesParCarte.get(l.carteId) || m.lignesParCarte.set(l.carteId, []).get(l.carteId)).push(l);
    return m;
}

// 1. le cas simple : une carte sans impression dans le set, un produit à numéro Cardmarket connu
let P = M.planifier(monde([ligne(1, 10)], [nc(1, '023')], [carte(10)]));
verifier('une carte sans impression dans le set : une impression « numero-cardmarket » au numéro Cardmarket', P.aPoser.get(10), [{ tirage: 'zh-hans', expansion: 'Exp Z', numero: '023', total: null, deck: null, rarete: null, source: 'numero-cardmarket' }]);
verifier('… et le numeroFiche de la ligne', P.numerosFiche, [{ _id: '10|1', carteId: 10, idProduct: 1, numeroFiche: '023' }]);
// 2. deux produits de la même carte au même numéro : UNE impression
P = M.planifier(monde([ligne(1, 10), ligne(2, 10)], [nc(1, '023'), nc(2, '023')], [carte(10)]));
verifier('deux produits au même numéro : une impression, deux numeroFiche', [P.aPoser.get(10).length, P.numerosFiche.length], [1, 2]);
// 3. déjà une impression au même numéro : pas de doublon, seulement le numeroFiche
P = M.planifier(monde([ligne(1, 10)], [nc(1, '023')], [carte(10, { impressions: [IMP('23')] })]));
verifier('l\'impression existe déjà (23 = 023 au sens du site) : rien sur la carte, seulement le numeroFiche', [P.aPoser.size, P.numerosFiche.length], [0, 1]);
// 4. refus
const refus = (nom, m, motif) => { const R = M.planifier(m); verifier(`refus : ${nom}`, [R.aPoser.size, R.numerosFiche.length, R.refus.length === 1 && motif.test(R.refus[0].motif)], [0, 0, true]); };
refus('la carte porte déjà un AUTRE numéro dans ce set (fiches mélangées : un autre outil)', monde([ligne(1, 10)], [nc(1, '023')], [carte(10, { impressions: [IMP('99')] })]), /autre numéro/);
refus('la carte porte une impression SANS numéro dans ce set', monde([ligne(1, 10)], [nc(1, '023')], [carte(10, { impressions: [IMP(null)] })]), /SANS numéro/);
refus('aucun numéro Cardmarket', monde([ligne(1, 10)], [[1, { idProduct: 1, numero: null }]], [carte(10)]), /aucun numéro/);
refus('le numeroFiche de la ligne contredit le numéro Cardmarket', monde([ligne(1, 10, { numeroFiche: '24' })], [nc(1, '023')], [carte(10)]), /contredit/);
refus('le nom d\'expansion du set est synthétique', monde([ligne(1, 10, { slugSet: 'SetS' })], [nc(1, '023')], [carte(10, { sets: ['SetS'] })]), /synthétique/);
refus('une VRAIE carte déclare déjà (tirage, expansion, numéro) : doublon', monde([ligne(1, 10)], [nc(1, '023')], [carte(10), carte(20, { impressions: [IMP('023')] })], { declarants: new Map([['zh-hans|Exp Z|23', new Set([20])]]) }), /déclare déjà/);
refus('une image du set SANS numéro sur la carte (le set entier basculerait)', monde([ligne(1, 10)], [nc(1, '023')], [carte(10, { images: [{ set: 'SetZ', numero: null }] })]), /image/);
refus('une image du set à un AUTRE numéro ne retrouverait aucune fiche', monde([ligne(1, 10)], [nc(1, '023')], [carte(10, { images: [{ set: 'SetZ', numero: '77' }] })]), /image/);
// la preuve « setlist+numero » (impression chinoise VIRTUELLE) est numérotée par le même geste : le numeroFiche de la ligne est celui de la Setlist, il doit SE CONFONDRE avec le numéro Cardmarket (sinon : contredit)
P = M.planifier(monde([ligne(1, 10, { preuve: 'setlist+numero', numeroFiche: '23' })], [nc(1, '023')], [carte(10)]));
verifier('setlist+numero : le numeroFiche (23) est le numéro Cardmarket (023) : l\'impression s\'écrit, le numeroFiche existant n\'est pas réécrit', [P.aPoser.get(10).length, P.numerosFiche.length], [1, 0]);
refus('setlist+numero dont le numeroFiche de la Setlist n\'est pas le numéro Cardmarket', monde([ligne(1, 10, { preuve: 'setlist+numero', numeroFiche: '90' })], [nc(1, '089')], [carte(10)]), /contredit/);
// 5. deux cartes différentes au même numéro dans le plan : ambigu, aucune n'est écrite
P = M.planifier(monde([ligne(1, 10), ligne(2, 11)], [nc(1, '023'), nc(2, '023')], [carte(10), carte(11)]));
verifier('deux cartes au même numéro dans le plan : AUCUNE n\'est écrite (0 ambigu ≠ 0 faux)', [P.aPoser.size, P.refus.length], [0, 2]);
// 6. le groupe : un set jumeau (même tirage, même expansion) montre l'impression aussi ; son produit doit retrouver une fiche
P = M.planifier(monde([ligne(1, 10)], [nc(1, '023'), nc(3, '099')], [carte(10, { sets: ['SetZ', 'SetZ-Add'] })], { autresLignes: [ligne(3, 10, { slugSet: 'SetZ-Add', numeroFiche: '099' })] }));
verifier('un produit du set jumeau à un autre numéro (sans impression) ne retrouverait aucune fiche : la carte est refusée', [P.aPoser.size, P.refus.length], [0, 1]);
P = M.planifier(monde([ligne(1, 10)], [nc(1, '023'), nc(3, '023')], [carte(10, { sets: ['SetZ', 'SetZ-Add'] })], { autresLignes: [ligne(3, 10, { slugSet: 'SetZ-Add', numeroFiche: '023' })] }));
verifier('le produit du set jumeau au MÊME numéro est servi par la même impression : écrite', P.aPoser.size, 1);

// la restriction : un groupe (carte, tirage, expansion) ne s'écrit que si TOUS ses produits sont confirmés
P = M.planifier(monde([ligne(1, 10), ligne(2, 10), ligne(5, 11)], [nc(1, '023'), nc(2, '023'), nc(5, '024')], [carte(10), carte(11)]));
let R = M.restreindre(P, new Set([1, 5]));
verifier('restreindre : carte 10 (produit 2 non confirmé) écartée, carte 11 gardée', [[...R.aPoser.keys()], R.ecartees.length, R.numerosFiche.map(n => n.idProduct)], [[11], 1, [5]]);
verifier('restreindre sans liste : rien n\'est filtré', [...M.restreindre(P, null).aPoser.keys()], [10, 11]);
verifier('horsPlan : un idProduct de la liste qu\'aucun produit du plan ne porte', M.horsPlan(P, new Set([1, 999])), [999]);

// le plan
const plan = M.construirePlan(M.restreindre(P, null), new Map([[1, 'CSZ'], [2, 'CSZ'], [5, 'CSZ']]), new Map([[1, ligne(1, 10)], [2, ligne(2, 10)], [5, ligne(5, 11)]]));
verifier('le plan : une ligne par produit (numeroFiche = le numéro écrit, code, set), les impressions, les numéros de fiche', [plan.lignes.map(l => [l.idProduct, l.numeroFiche, l.code, l.slugSet]), plan.impressions.length, plan.numerosFiche.length], [[[1, '023', 'CSZ', 'SetZ'], [2, '023', 'CSZ', 'SetZ'], [5, '024', 'CSZ', 'SetZ']], 2, 3]);
verifier('les lignes du plan portent l\'_id des lignes EXISTANTES (jamais ajoutées)', plan.lignes.map(l => l._id), ['10|1', '10|2', '11|5']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
