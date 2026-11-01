// BANC — collecte-cartes/regle-e-svp.js : la règle E-SVP (Énergies de base des promos japonaises SV-P), pure, sans base ni réseau.
// La règle DOIT SAVOIR DIRE NON : chaque condition a son cas fabriqué qui la fait refuser, y compris l'UNICITÉ (condition 4) sur une ambiguïté réelle.
//   node test-regle-e-svp.js
const E = require('./collecte-cartes/regle-e-svp');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};

const IMP = { tirage: 'jp', expansion: E.EXPANSION, numero: '037', total: 'SV-P' };
const carte = (id, nomEn, impressions = [IMP]) => ({ _id: id, nomEn, impressions });
const GRASS = { idProduct: 731904, name: 'Basic Grass Energy' };
const NOMME = [{ setId: 'SV-P', localId: '100', variante: null }];
const JA = { 100: '基本草エネルギー', 101: '基本炎エネルギー' };
const monde = (o = {}) => E.juger({
    produit: o.produit ?? GRASS,
    numeroAppris: 'numeroAppris' in o ? o.numeroAppris : '100',
    nommes: o.nommes ?? NOMME,
    nomJa: o.nomJa ?? (n => JA[n] ?? null),
    cartes: o.cartes ?? [carte(60754, 'Basic Grass Energy'), carte(13682, 'Basic Fire Energy')]
});

// ── le cas sain
const bon = monde();
verifier('cas sain : la carte unique, le numéro 100, le type Grass', [bon.ok, bon.carteId, bon.numero, bon.type, bon.tcgdex], [true, 60754, '100', 'Grass', 'SV-P/100']);

// ── condition 0 : seul un « Basic <Type> Energy » est jugé
verifier('un produit qui n\'est pas une énergie de base : non', (() => { const r = monde({ produit: { idProduct: 1, name: 'Nemona' } }); return [r.ok, r.condition]; })(), [false, 0]);
verifier('« Basic Grass Energy » seul compte : « Grass Energy » (sans Basic) est refusé', monde({ produit: { idProduct: 1, name: 'Grass Energy' } }).ok, false);
verifier('un type inconnu (« Basic Dragon Energy ») : non', monde({ produit: { idProduct: 1, name: 'Basic Dragon Energy' } }).ok, false);

// ── condition 1 : TCGdex nomme le produit à SV-P/<n>
verifier('idProduct absent de TCGdex : non (condition 1)', (() => { const r = monde({ nommes: [] }); return [r.ok, r.condition]; })(), [false, 1]);
verifier('TCGdex nomme le produit, mais dans un AUTRE set que SV-P : non', monde({ nommes: [{ setId: 'SV-D', localId: '100', variante: null }] }).ok, false);
verifier('TCGdex nomme le produit à DEUX numéros de SV-P : on ne choisit pas', monde({ nommes: [{ setId: 'SV-P', localId: '100' }, { setId: 'SV-P', localId: '175' }] }).ok, false);
verifier('TCGdex nomme deux fois le MÊME numéro de SV-P (doublon de fichier) : accepté', monde({ nommes: [{ setId: 'SV-P', localId: '100' }, { setId: 'SV-P', localId: '100' }] }).ok, true);

// ── condition 2 : n = le numéro appris
verifier('numéro différent (Cardmarket 101, TCGdex 100) : non (condition 2)', (() => { const r = monde({ numeroAppris: '101' }); return [r.ok, r.condition]; })(), [false, 2]);
verifier('numéro appris absent : non', monde({ numeroAppris: null }).ok, false);
verifier('numéro appris « 0100 » = 100 (zéros de tête ignorés) : accepté', monde({ numeroAppris: '0100' }).ok, true);

// ── condition 3 : le type japonais
verifier('type japonais contradictoire (基本炎 pour un produit Grass) : non (condition 3)', (() => { const r = monde({ nomJa: () => '基本炎エネルギー' }); return [r.ok, r.condition]; })(), [false, 3]);
verifier('nom japonais absent : non', monde({ nomJa: () => null }).ok, false);
verifier('nom japonais qui n\'est pas « 基本<type>エネルギー » (Nemona) : non', monde({ nomJa: () => 'ネモ' }).ok, false);
verifier('nom japonais à type inconnu (基本竜エネルギー) : non', monde({ nomJa: () => '基本竜エネルギー' }).ok, false);

// ── condition 4 : UNE SEULE carte candidate
const doublon = carte(99999, 'Basic Grass Energy');
verifier('DEUX cartes de même nom portant une impression SV-P : non (unicité, condition 4)', (() => { const r = monde({ cartes: [carte(60754, 'Basic Grass Energy'), doublon] }); return [r.ok, r.condition, r.candidates]; })(), [false, 4, [60754, 99999]]);
verifier('TROIS cartes candidates : non', monde({ cartes: [carte(1, 'Basic Grass Energy'), carte(2, 'Basic Grass Energy'), carte(3, 'Basic Grass Energy')] }).ok, false);
verifier('aucune carte candidate : non', (() => { const r = monde({ cartes: [carte(13682, 'Basic Fire Energy')] }); return [r.ok, r.condition]; })(), [false, 4]);
verifier('un homonyme SANS impression SV-P ne compte pas : une SV-P + un homonyme d\'ailleurs = accepté', monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(7, 'Basic Grass Energy', [{ tirage: 'intl', expansion: 'Base Set', numero: '98' }])] }).carteId, 60754);
verifier('un homonyme SANS impression du tout ne compte pas non plus', monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(8, 'Basic Grass Energy', [])] }).ok, true);
verifier('une carte sans champ impressions ne casse pas la règle', monde({ cartes: [carte(60754, 'Basic Grass Energy'), { _id: 9, nomEn: 'Basic Grass Energy' }] }).ok, true);
verifier('un nom voisin (« Grass Energy ») n\'est pas un candidat', monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(5, 'Grass Energy')] }).ok, true);
verifier('l\'impression doit être celle de SV-P (« SV-P Promotional cards »), pas « SV-P2 »', monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(6, 'Basic Grass Energy', [{ tirage: 'jp', expansion: 'SV-P2 Promotional cards', numero: '1' }])] }).ok, true);
verifier('la même carte listée deux fois (même _id) reste UNE candidate', monde({ cartes: [carte(60754, 'Basic Grass Energy'), carte(60754, 'Basic Grass Energy')] }).ok, true);

// ── le jugement est total : jamais d'exception sur une entrée pauvre
verifier('entrées vides : non, sans exception', (() => { try { const r = E.juger({ produit: { idProduct: 1, name: null }, numeroAppris: undefined, nommes: undefined, nomJa: () => null, cartes: [] }); return r.ok; } catch (e) { return 'exception ' + e.message; } })(), false);

// ── la lecture du nom japonais depuis un fichier TCGdex
verifier('lireNomJaDuTexte lit la ligne ja du fichier de carte', E.nomJaDuTexte('export default {\n\tname: {\n\t\ten: "Grass Energy",\n\t\tja: "基本草エネルギー"\n\t}\n}'), '基本草エネルギー');
verifier('lireNomJaDuTexte rend null sans ligne ja', E.nomJaDuTexte('name: { en: "X" }'), null);

// ── la calibration : ligne cachée, comparée ; elle voit un faux
const lignes = [{ idProduct: 731904, carteId: 60754 }];
const cal = E.calibrer({ produits: [GRASS, { idProduct: 5, name: 'Nemona' }], lignes, nums: new Map([[731904, '100'], [5, '9']]), clone: { parProduit: new Map([[731904, NOMME]]) }, nomJa: n => JA[n] ?? null, cartes: [carte(60754, 'Basic Grass Energy')] });
verifier('calibration : 1 jugé, 1 juste, 0 faux (Nemona, sans ligne, n\'est pas calibré)', [cal.jugees, cal.justes, cal.faux], [1, 1, 0]);
const calFaux = E.calibrer({ produits: [GRASS], lignes: [{ idProduct: 731904, carteId: 11111 }], nums: new Map([[731904, '100']]), clone: { parProduit: new Map([[731904, NOMME]]) }, nomJa: n => JA[n] ?? null, cartes: [carte(60754, 'Basic Grass Energy')] });
verifier('calibration : une règle qui désigne une autre carte que la ligne est comptée FAUSSE', [calFaux.jugees, calFaux.justes, calFaux.faux, calFaux.fauxListe.map(f => f.idProduct)], [1, 0, 1, [731904]]);
const calNon = E.calibrer({ produits: [GRASS], lignes: [{ idProduct: 731904, carteId: 60754 }], nums: new Map([[731904, '100']]), clone: { parProduit: new Map([[731904, NOMME]]) }, nomJa: n => JA[n] ?? null, cartes: [carte(60754, 'Basic Grass Energy'), doublon] });
verifier('calibration : une ambiguïté de carte est un REFUS compté, pas un jugement', [calNon.jugees, calNon.faux, calNon.refus], [0, 0, 1]);

// ── la SONDE d'unicité : conditions 1, 2 et 4 SANS le type, sur n'importe quel produit joint (ligne cachée) — éprouve l'unicité sur de vraies ambiguïtés
const NEM = n => ({ idProduct: n, name: 'Nemona' });
const six = [1, 2, 3, 4, 5, 6].map(i => carte(100 + i, 'Nemona'));
const sonde = E.sonder({
    produits: [NEM(813950), { idProduct: 813951, name: 'Pikachu' }, { idProduct: 813952, name: 'Mew [Psy | Blast]' }, { idProduct: 813953, name: 'Eevee' }, { idProduct: 813954, name: 'Absent' }],
    lignes: [{ idProduct: 813950, carteId: 101 }, { idProduct: 813951, carteId: 200 }, { idProduct: 813952, carteId: 300 }, { idProduct: 813953, carteId: 401 }, { idProduct: 813954, carteId: 1 }],
    nums: new Map([[813950, '9'], [813951, '10'], [813952, '11'], [813953, '12'], [813954, '13']]),
    clone: { parProduit: new Map([[813950, [{ setId: 'SV-P', localId: '9' }]], [813951, [{ setId: 'SV-P', localId: '10' }]], [813952, [{ setId: 'SV-P', localId: '11' }]], [813953, [{ setId: 'SV-P', localId: '12' }]]]) },
    cartes: [...six, carte(200, 'Pikachu'), carte(300, 'Mew'), carte(402, 'Eevee')]   // Pikachu : unique et juste ; Mew : unique et juste ; Eevee : unique mais FAUSSE (la ligne dit 401, absente)
});
verifier('sonde : 6 homonymes = ambigu (refus), et la vérité est parmi eux', [sonde.ambigus, sonde.ambigusAvecVerite], [1, 1]);
verifier('sonde : un seul candidat et c\'est la ligne = unique juste (le nom est décomposé : « Mew [Psy | Blast] » = Mew)', [sonde.uniques, sonde.uniquesJustes], [3, 2]);
verifier('sonde : un seul candidat qui N\'EST PAS la ligne = unique FAUX (l\'unicité seule ne suffit pas)', [sonde.uniquesFaux, sonde.fauxListe.map(f => f.idProduct)], [1, [813953]]);
verifier('sonde : un produit non nommé par TCGdex ne passe pas les conditions 1-2 (dénominateur imprimé)', [sonde.joints, sonde.passent12], [5, 4]);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
