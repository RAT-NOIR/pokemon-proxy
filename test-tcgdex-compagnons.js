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

// ── 2026-09-26 (soir) : l'audit occidental a trouvé deux autres découpages de TCGdex, rangés en « aucune source » (§30).
// Le Shiny Vault (SV1…SV94) est un set TCGdex À PART (« Hidden Fates Shiny Vault », « Shining Fates Shiny Vault ») que Bulbapedia
// range dans l'expansion ; et Bulbapedia écrit « Platinum: Arceus » quand TCGdex écrit « Arceus » (pl4). Noms recopiés du cache.
const { fabriquerAppariement } = require('./collecte-cartes/tcgdex-cache');
const liste2 = [
    { id: 'sm115', name: 'Hidden Fates' }, { id: 'sma', name: 'Hidden Fates Shiny Vault' },
    { id: 'swsh4.5', name: 'Shining Fates' }, { id: 'swsh4.5sv', name: 'Shining Fates Shiny Vault' },
    { id: 'pl4', name: 'Arceus' }, { id: 'pl1', name: 'Platinum' }, { id: 'ex13', name: 'Holon Phantoms' }
];
verifier('Hidden Fates → son Shiny Vault', compagnonsDuSet(liste2[0], liste2).map(c => c.id), ['sma']);
verifier('Shining Fates → son Shiny Vault', compagnonsDuSet(liste2[2], liste2).map(c => c.id), ['swsh4.5sv']);
verifier('un Shiny Vault n\'a pas lui-même de compagnon', compagnonsDuSet(liste2[1], liste2).map(c => c.id), []);
const ap2 = fabriquerAppariement(liste2);
verifier('« Platinum: Arceus » → pl4, et la variante se DIT', ap2('Platinum: Arceus'), { set: liste2[4], variante: 'sans le préfixe « Platinum: »' });
verifier('« Platinum » seul reste le set Platinum (égalité exacte d\'abord)', ap2('Platinum')?.set?.id, 'pl1');
verifier('« EX Holon Phantoms » → ex13 (la variante EX inchangée)', ap2('EX Holon Phantoms'), { set: liste2[6], variante: 'sans le préfixe « EX »' });
verifier('« Platinum: Inconnu » → rien', ap2('Platinum: Inconnu'), null);
const cartesHif = [{ _id: 9, nomEn: 'Fisherman', impressions: [{ tirage: 'intl', expansion: 'Hidden Fates', numero: 'SV83' }] }];
verifier('SV83 → sma-SV83 sur la liste fusionnée', apparierExpansion('Hidden Fates', cartesHif, [{ id: 'sma-SV83', localId: 'SV83', name: 'Fisherman', image: 'i/SV83' }]).map(r => r.tcg?.id ?? r.motif), ['sma-SV83']);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
