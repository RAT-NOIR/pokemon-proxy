// Banc de collecte-cartes/lien-par-cles-210.js : lien carte <-> carte TCGdex par CLES qui n'utilisent pas l'identifiant produit Cardmarket
// (A : nom d'expansion + numero d'une impression intl ; B : idExpansion Cardmarket du set + numeroFiche ; C : slugSet + numeroFiche).
// Le NOM n'entre dans aucune cle : il est le temoin, et il peut contredire. Aucune base, aucun reseau.
let ok = 0, ko = 0;
const egal = (n, a, b) => { const sa = JSON.stringify(a), sb = JSON.stringify(b); if (sa === sb) ok++; else { ko++; console.log(`❌ ${n} : ${sa} ≠ ${sb}`); } };
const M = require('./collecte-cartes/lien-par-cles-210');

const T = (setId, localId, en, fr, extra = {}) => ({ famille: 'data', setId, localId, noms: { en, fr }, dex: [], cardmarket: [], ...extra });
const clone = {
    sets: [
        { famille: 'data', id: 'ex6', noms: { en: 'EX Unseen Forces' }, cardmarket: 1548 },
        { famille: 'data', id: 'ex13', noms: { en: 'Holon Phantoms' }, cardmarket: 1551 },
        { famille: 'data', id: 'dp1', noms: { en: 'Diamond & Pearl' }, cardmarket: 1700 },
        { famille: 'data', id: 'dp1b', noms: { en: 'Diamond & Pearl' }, cardmarket: 1701 },
    ],
    cartes: [
        T('ex6', 'T', 'Unown', 'Zarbi'), T('ex6', 'X', 'Unown', 'Zarbi'),
        T('ex13', '80', 'Poochyena', 'Medhyena'), T('ex13', '081', 'Mightyena', 'Gradhyena'),
        T('dp1', '1', 'Abomasnow', 'Blizzaroi'), T('dp1b', '1', 'Leafeon', 'Phyllali'),
    ],
};
const ix = M.indexCles(clone);
const imp = (expansion, numero, tirage = 'intl') => ({ tirage, expansion, numero });
const ref = r => r.ok ? r.preuves.map(p => p.carteTcgdex).sort() : r.raison;

// A : nom d'expansion + numero (impression intl), zeros de tete ignores
let r = M.lierParCles({ _id: 1, nomEn: 'Unown', impressions: [imp('EX Unseen Forces', 'T')] }, [], ix);
egal('A1 cle A : une carte', ref(r), ['data|ex6|T']);
egal('A2 temoin et cles', [r.preuves[0].temoin, r.cles], ['nom-en', ['A']]);
r = M.lierParCles({ _id: 2, nomEn: 'Mightyena', impressions: [imp('Holon Phantoms', '81')] }, [], ix);
egal('A3 zeros de tete ignores (81 = 081)', ref(r), ['data|ex13|081']);
r = M.lierParCles({ _id: 3, nomEn: 'Unown', impressions: [imp('EX Unseen Forces', 'T', 'jp')] }, [], ix);
egal('A4 une impression jp ne sert pas de cle', ref(r), 'aucune-cle');

// B : idExpansion Cardmarket du set + numeroFiche ; C : slugSet + numeroFiche
r = M.lierParCles({ _id: 4, nomEn: 'Poochyena', impressions: [] }, [{ idExpansion: 1551, numeroFiche: '80', slugSet: 'Holon-Phantoms' }], ix);
egal('B1 cles B et C d\'accord sur la meme carte', [ref(r), r.cles], [['data|ex13|80'], ['B', 'C']]);
r = M.lierParCles({ _id: 5, nomEn: 'Poochyena', impressions: [] }, [{ idExpansion: 1551, numeroFiche: '80' }], ix);
egal('B2 cle B seule', [ref(r), r.cles], [['data|ex13|80'], ['B']]);
r = M.lierParCles({ _id: 6, nomEn: 'Unown', impressions: [] }, [{ numeroFiche: 'X', slugSet: 'EX-Unseen-Forces' }], ix);
egal('C1 cle C seule (tirets du slug = espaces)', [ref(r), r.cles], [['data|ex6|X'], ['C']]);

// refus : on enumere ce qui autorise, tout le reste bloque
r = M.lierParCles({ _id: 7, nomEn: 'Abomasnow', impressions: [imp('Diamond & Pearl', '1')] }, [], ix);
egal('R1 une cle qui designe DEUX cartes (deux sets au meme nom) : refus', ref(r), 'cle-multiple');
r = M.lierParCles({ _id: 8, nomEn: 'Mightyena', impressions: [imp('Holon Phantoms', '80')] }, [], ix);
egal('R2 le nom contredit la cle (Poochyena au n°80, on attend Mightyena) : refus, jamais de repli sur une autre', ref(r), 'cle-contredite-par-le-nom');
r = M.lierParCles({ _id: 9, nomEn: 'Unown', impressions: [imp('EX Unseen Forces', 'T')] }, [{ idExpansion: 1551, numeroFiche: '80' }], ix);
egal('R3 deux cles qui designent deux cartes differentes : refus', ref(r), 'cles-en-conflit');
r = M.lierParCles({ _id: 10, nomEn: 'Unown', impressions: [imp('Set Inconnu', 'T')] }, [], ix);
egal('R4 aucune cle ne repond : refus', ref(r), 'aucune-cle');
r = M.lierParCles({ _id: 11, nomEn: null, impressions: [imp('EX Unseen Forces', 'T')] }, [], ix);
egal('R5 sans nom anglais, pas de temoin : refus', ref(r), 'nom-en-absent');
r = M.lierParCles({ _id: 12, nomEn: 'Unown', ndex: 201, impressions: [imp('EX Unseen Forces', 'T')] }, [], { ...ix, cartesParSet: new Map(ix.cartesParSet) });
egal('R6 le n° de Pokedex ne contredit pas quand il est absent de la carte TCGdex', ref(r), ['data|ex6|T']);
const cloneDex = { sets: clone.sets, cartes: [T('ex6', 'T', 'Unown', 'Zarbi', { dex: [25] })] };
r = M.lierParCles({ _id: 13, nomEn: 'Unown', ndex: 201, impressions: [imp('EX Unseen Forces', 'T')] }, [], M.indexCles(cloneDex));
egal('R7 le Pokedex contredit : refus', ref(r), 'dex-contredit');
r = M.lierParCles({ _id: 14, nomEn: 'Unown', impressions: [imp('EX Unseen Forces', 'T')] }, [{ idExpansion: 1548, numeroFiche: 'X' }], ix);
egal('R8 les cles A (T) et B (X) designent deux cartes du meme nom : refus', ref(r), 'cles-en-conflit');

// multiplicites comptees : deux clones du MEME set et numero = multiple
const cloneDouble = { sets: clone.sets, cartes: [T('ex6', 'T', 'Unown', 'Zarbi'), T('ex6', 'T', 'Unown', 'Zarbi')] };
r = M.lierParCles({ _id: 15, nomEn: 'Unown', impressions: [imp('EX Unseen Forces', 'T')] }, [], M.indexCles(cloneDouble));
egal('R9 deux fichiers TCGdex au meme (set, numero) : refus (multiplicites comptees, pas de Set)', ref(r), 'cle-multiple');

console.log(`${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
