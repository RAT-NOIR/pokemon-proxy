// node test-langue-logo.js — la règle de langue des LOGOS (collecte-cartes/langue-logo.js), sur des noms de fichiers RÉELS
// (infobox archivées, 2026-09-26). 🔴 Le cas qui l'a fait écrire : `region` vaut « intl » pour un set chinois, indonésien ou
// thaï, et la règle 1 (« set occidental : le logo lui revient ») donnait à 30thC et MA6 le logo ANGLAIS « 30th Celebration Logo EN.png ».
const { deciderLangue } = require('./collecte-cartes/langue-logo');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const S = (region, tirage, code, titre, extra = {}) => ({ region, tirage, code, bulba: { titre }, ...extra });
const D = (s, f) => deciderLangue(s, f).ok;

verifier('occidental, suffixe EN : le sien', D(S('intl', 'intl', 'HIF', 'Hidden Fates (TCG)'), 'Hidden Fates Logo EN.png'), true);
verifier('occidental, suffixe JP : refusé', D(S('intl', 'intl', 'X', 'X (TCG)'), 'X Logo JP.png'), false);
verifier('japonais, suffixe JP : le sien', D(S('jp', 'jp', 'm6', 'Storm Emeralda (TCG)'), 'M6 Logo JP.png'), true);
verifier('japonais, suffixe EN : le jumeau', D(S('jp', 'jp', 'N1', 'Neo Genesis (TCG)'), 'Neo Genesis Logo EN.png'), false);
verifier('30thC (chinois, rangé intl) : le logo EN de la page commune est REFUSÉ', D(S('intl', 'zh-hans', '30thC', '30th Celebration (TCG)'), '30th Celebration Logo EN.png'), false);
verifier('MA6 (IDTH, rangé intl) : idem', D(S('intl', 'idth', 'MA6', '30th Celebration (TCG)'), '30th Celebration Logo EN.png'), false);
verifier('chinois, fichier « … SC » : le sien', D(S('intl', 'zh-hans', 'CSV10C', 'Chasing Glory Together (ATCG)'), 'CSV10 Logo SC.png'), true);
verifier('chinois, page (ATCG), fichier sans langue : le sien (la page est celle du tirage)', D(S('intl', 'zh-hans', 'CBB2C', 'Gem Pack Vol. 2 (ATCG)'), 'CBB2 Logo.png'), true);
verifier('IDTH, fichier « Indonesian Thai » : le sien', D(S('intl', 'idth', 'MA4', 'Void Blast (TCG)'), 'MA4 Void Blast Logo Indonesian Thai.png'), true);
verifier('indonésien sur une page (ATCG), fichier muet : aucune preuve du tirage', D(S('intl', 'id', 'AC3', 'Tag Team Collection (ATCG)'), 'Tag Team Collection Logo.png'), false);
verifier('xsv8a : le fichier lu à l\'œil (katakana) est accepté', D(S('jp', 'jp', 'xsv8a', 'Terastal Fest ex (TCG)'), 'SV8a Terastal Fest ex Logo.png'), true);
verifier('SI-JP : le logo anglais lu à l\'œil est refusé', D(S('jp', 'jp', 'SI-JP', 'Southern Islands (TCG)'), 'SouthernIslandsLogo.png'), false);
verifier('11M : une planche de cartes n\'est pas un logo', D(S('jp', 'jp', '11M', '11th Movie Commemoration Set (TCG)'), 'Movie 11 Commemoration.jpg'), false);
verifier('le verdict à l\'œil ne vaut que pour un set japonais', D(S('intl', 'intl', 'SI', 'Southern Islands (TCG)'), 'SouthernIslandsLogo.png'), true);
verifier('un set sans `tirage` retombe sur la région (l\'état d\'avant)', D(S('intl', undefined, 'HIF', 'Hidden Fates (TCG)'), 'Hidden Fates Logo EN.png'), true);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
