// node test-jointure-setlist.js — le numéro porté par la SETLIST, quand la page de carte ne déclare pas le tirage (2026-09-15).
// Cas relevés : « Transfiguration Mask (ATCG) » liste `Venipede (Transfiguration Mask 115)`, qui REDIRIGE vers
// `Venipede (Twilight Masquerade 115)` ; la page de carte n'a aucune impression chinoise. Cardmarket SV6s numérote 168…229
// (62 produits, la plage des rares), CSV7C « Blade Awakening » 001…259 (259 produits pour 259 entrées).
// Liens relevés le 2026-09-15 (pages sauvées) : une carte à suffixe s'écrit en LIEN, et sa parenthèse porte le numéro chinois :
// `[[Sinistcha ex (Transfiguration Mask 23)|Sinistcha]]{{ex}}`. Sans eux, SV6s couvrait 39/62 et CS3aC 134/184.
const { joindre, impressionsDepuisSetlist, numeroDeSetlist } = require('./collecte-cartes/jointure');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const cible = { idExpansion: 6597, expansionBulba: 'Transfiguration Mask', tirage: 'zh-hant' };
const entrees = [
    { titre: 'Venipede (Transfiguration Mask 115)', b: '115', forme: 'tcg-id' },
    { titre: 'Pinsir (Transfiguration Mask 168)', b: '168', forme: 'tcg-id' },
    { titre: 'Pinsir (Transfiguration Mask 201)', b: '201', forme: 'tcg-id' },
    { titre: 'Pokémon Card 151 (lien)', a: 'Pokémon Card', b: '151', forme: 'lien' },
    { titre: 'Absente (Transfiguration Mask 9)', b: '9', forme: 'tcg-id' },
    { titre: 'Sinistcha ex (Transfiguration Mask 23)', a: 'Transfiguration Mask', b: '23', forme: 'lien' }
];
const pages = [
    { titre: 'Venipede (Transfiguration Mask 115)', pageid: 11, etat: 'ok' },
    { titre: 'Pinsir (Transfiguration Mask 168)', pageid: 12, etat: 'ok' },
    { titre: 'Pinsir (Transfiguration Mask 201)', pageid: 12, etat: 'ok' },
    { titre: 'Pokémon Card 151 (lien)', pageid: 13, etat: 'ok' },
    { titre: 'Absente (Transfiguration Mask 9)', pageid: null, etat: 'manquant' },
    { titre: 'Sinistcha ex (Transfiguration Mask 23)', pageid: 14, etat: 'ok' }
];
const S = impressionsDepuisSetlist(entrees, pages, cible);
verifier('Venipede : impression virtuelle n°115, tirage et expansion de la cible', S.parCarte.get(11), [{ tirage: 'zh-hant', expansion: 'Transfiguration Mask', numero: '115', total: null, deck: null, rarete: null, source: 'setlist' }]);
verifier('Pinsir listé deux fois : deux numéros sur la même carte', (S.parCarte.get(12) || []).map(i => i.numero), ['168', '201']);
verifier('un LIEN vers une autre expansion ne donne pas de numéro (le sien est indicatif)', [S.parCarte.has(13), S.sansNumero], [false, ['Pokémon Card 151 (lien)']]);
verifier('un LIEN dont la parenthèse est « <expansion de la cible> N » donne N (Sinistcha ex n°23)', (S.parCarte.get(14) || []).map(i => i.numero), ['23']);
const noms = ['Storming Emergence Verdant'];
verifier('numeroDeSetlist : lien du set → numéro', numeroDeSetlist({ a: 'Storming Emergence Verdant', b: '14', forme: 'lien' }, noms), '14');
verifier('numeroDeSetlist : coquille de la source (« Emergrnce ») → rien, jamais deviné', numeroDeSetlist({ a: 'Storming Emergrnce Verdant', b: '27', forme: 'lien' }, noms), null);
verifier('numeroDeSetlist : TCG ID → son numéro, quelle que soit la parenthèse', numeroDeSetlist({ a: 'Autre', b: '7', forme: 'tcg-id' }, noms), '7');
verifier('numeroDeSetlist : lien sans numéro → rien', numeroDeSetlist({ a: 'Storming Emergence Verdant', b: null, forme: 'lien' }, noms), null);
verifier('entrée sans page : listée', S.sansPage, ['Absente (Transfiguration Mask 9)']);

const carte = (id, nomEn) => ({ _id: id, nomEn, attaques: [], impressions: [{ tirage: 'intl', expansion: 'Twilight Masquerade', numero: '115' }, ...(S.parCarte.get(id) || [])] });
const produit = (idProduct, nom, numero) => ({ idProduct, name: nom, nom, attaques: [], numero });
const J = joindre([carte(11, 'Venipede'), carte(12, 'Pinsir')], [produit(20, 'Pinsir', '168'), produit(21, 'Pinsir', '201'), produit(22, 'Scream Tail ex', '200')], cible);
verifier('SV6s : seuls les numéros présents chez Cardmarket joignent', J.lignes.map(l => `${l.carteId}|${l.idProduct}`), ['12|20', '12|21']);
verifier('preuve « setlist+numero », jamais « set+numero »', [...new Set(J.lignes.map(l => l.preuve))], ['setlist+numero']);
verifier('Venipede n°115 hors de la plage Cardmarket : reste, pas de repli par nom', J.restes.filter(r => r.type === 'carte-sans-produit').map(r => r.carteId), [11]);

console.log(`\n${ok}/${ok + ko} ${ko ? '❌' : '✅'}`);
process.exit(ko ? 1 : 0);
