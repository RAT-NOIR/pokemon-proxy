// node test-tcgdex-compagnons.js — les sous-sets que TCGdex range À PART (Trainer Gallery, Galarian Gallery) et que
// Bulbapedia range DANS l'expansion, numérotés TG01…, GG01…. La route s'ouvre par le NOM exact « <set> <suffixe> »,
// jamais par l'inclusion (§31), et la clé de numéro garde son préfixe : TG07 n'est pas 007.
const { compagnonsDuSet } = require('./collecte-cartes/tcgdex-cache');
const { apparierExpansion } = require('./collecte-cartes/tcgdex-appariement');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
// la liste réelle de TCGdex, telle que le cache la porte (noms recopiés du cache `tcgdex_sets`, 2026-09-24)
const liste = [
    { id: 'swsh9', name: 'Brilliant Stars' }, { id: 'swsh9tg', name: 'Brilliant Stars Trainer Gallery' },
    { id: 'swsh11', name: 'Lost Origin' }, { id: 'swsh11tg', name: 'Lost Origin Trainer Gallery' },
    { id: 'swsh12.5', name: 'Crown Zenith' }, { id: 'swsh12.5gg', name: 'Crown Zenith Galarian Gallery' },
    { id: 'swsh3', name: 'Darkness Ablaze' }, { id: 'x', name: 'Stars' }
];
const ids = s => compagnonsDuSet(s, liste).map(c => c.id);
verifier('Brilliant Stars → sa Trainer Gallery', ids(liste[0]), ['swsh9tg']);
verifier('Crown Zenith → sa Galarian Gallery', ids(liste[4]), ['swsh12.5gg']);
verifier('un set sans galerie → rien', ids(liste[6]), []);
verifier('« Stars » ne prend pas « Brilliant Stars Trainer Gallery » (l\'inclusion n\'est pas une clé)', ids(liste[7]), []);
verifier('une galerie n\'a pas elle-même de galerie', ids(liste[1]), []);

// l'appariement sur la liste fusionnée : TG07 va à la galerie, 7 au set principal, sans ambiguïté
const cartes = [
    { _id: 1, nomEn: 'Kirlia', impressions: [{ tirage: 'intl', expansion: 'Brilliant Stars', numero: '068' }, { tirage: 'intl', expansion: 'Brilliant Stars', numero: 'TG07' }] },
    { _id: 2, nomEn: 'Charizard V', impressions: [{ tirage: 'intl', expansion: 'Brilliant Stars', numero: '017' }] }
];
const tcg = [
    { id: 'swsh9-068', localId: '068', name: 'Kirlia', image: 'i/068' }, { id: 'swsh9-017', localId: '017', name: 'Charizard V', image: 'i/017' },
    { id: 'swsh9tg-TG07', localId: 'TG07', name: 'Kirlia', image: 'i/TG07' }
];
const R = apparierExpansion('Brilliant Stars', cartes, tcg);
verifier('TG07 → swsh9tg-TG07, 068 → swsh9-068, 017 → swsh9-017', R.map(r => `${r.numero}→${r.tcg?.id ?? r.motif}`), ['068→swsh9-068', 'TG07→swsh9tg-TG07', '017→swsh9-017']);
verifier('sans la galerie, TG07 est un reste nommé, pas un silence', apparierExpansion('Brilliant Stars', cartes, tcg.slice(0, 2)).map(r => r.tcg?.id ?? r.motif), ['swsh9-068', 'absente-de-tcgdex', 'swsh9-017']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
