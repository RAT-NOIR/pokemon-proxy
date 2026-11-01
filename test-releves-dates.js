// BANC — la lecture d'un relevé de dates SOURCÉ hors Bulbapedia (collecte-cartes/releves-dates.js), branchée dans poser-dates-sets.js par --releves=.
//   node test-releves-dates.js
// Le relevé exige DEUX sources lues et concordantes ; tout le reste n'écrit rien et le dit (une garde s'écrit par ce qu'elle AUTORISE).
const fs = require('fs');
const { jourComplet, isoPartiel, majorite, contradictionsAvecBase } = require('./poser-dates-sets');
const { lireReleves, rangDe } = require('./collecte-cartes/releves-dates');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const L = brut => lireReleves(brut, { jourComplet, isoPartiel });
const BON = { jour: 'January 25, 2019', url: 'https://thegeekiary.com/x', sources2: ['https://tocage.jp/y'], citation: '« released on January 25, 2019 » ; « 2019年1月25日 »', lu: '2026-11-01' };
const A = o => L({ X: { ...BON, ...o } }).admis.X ?? null;
const R = o => L({ X: { ...BON, ...o } }).refus.map(r => r.raison);

console.log('— cas OUI');
verifier('deux sources tierces concordantes : admis, rang tiers, iso', (() => { const a = A({}); return a && [a.iso, a.rang, a.sources.length]; })(), ['2019-01-25', 'tierce', 2]);
verifier('une source officielle (pokemon.cn) : rang officielle', A({ url: 'https://www.pokemon.cn/tcg/product/1.html', sources2: ['https://pokezentrum.de/z'] })?.rang, 'officielle');
verifier('asia.pokemon-card.com est officielle', rangDe(['https://asia.pokemon-card.com/id/archive/special/card/sv3s/index.html']), 'officielle');
verifier('un domaine qui CONTIENT « pokemon.com » sans l\'être n\'est pas officiel', rangDe(['https://pokemon.com.evil.example/x', 'https://pokemon-card.com.fake.io/']), 'tierce');
verifier('la source écrite dit url, citation et lecture de chacune', (() => { const a = A({}); return a.sources.every(s => s.url && s.citation && s.lu); })(), true);
verifier('sources2 en objets, avec son propre jour concordant', (() => { const a = A({ sources2: [{ url: 'https://tocage.jp/y', jour: 'January 25, 2019', citation: 'c2', lu: '2026-11-01' }] }); return a && a.iso; })(), '2019-01-25');

console.log('— cas NON : l\'écriture n\'a pas lieu et la raison est dite');
verifier('une seule source (sources2 absent)', R({ sources2: undefined }).some(r => /deux sources/.test(r)), true);
verifier('une seule source (sources2 vide)', R({ sources2: [] }).some(r => /deux sources/.test(r)), true);
verifier('deux fois la même adresse = une seule source', R({ sources2: [BON.url] }).some(r => /deux sources/.test(r)), true);
verifier('discordance au jour près entre les deux sources', R({ sources2: [{ url: 'https://tocage.jp/y', jour: 'January 26, 2019' }] }).some(r => /discord/.test(r)), true);
verifier('jour manquant', R({ jour: undefined }).some(r => /jour/.test(r)), true);
verifier('un mois seul n\'est pas un jour complet', R({ jour: 'January 2019' }).some(r => /jour complet/.test(r)), true);
verifier('citation manquante', R({ citation: '' }).some(r => /citation/.test(r)), true);
verifier('date de lecture manquante', R({ lu: undefined }).some(r => /lecture/.test(r)), true);
verifier('lecture mal formée', R({ lu: 'hier' }).some(r => /lecture/.test(r)), true);
verifier('url manquante', R({ url: undefined }).some(r => /url/.test(r)), true);
verifier('url non https', R({ url: 'http://thegeekiary.com/x' }).some(r => /https/.test(r)), true);
verifier('une entrée qui n\'est pas un objet', L({ X: 'January 25, 2019' }).refus.length, 1);
verifier('un refus ne laisse rien d\'admis', L({ X: { ...BON, lu: undefined } }).admis.X ?? null, null);

console.log('— le bloc _EN_ATTENTE et les clés « _ » sont ignorés, et comptés');
(() => {
    const r = L({ _format: 'texte', _EN_ATTENTE: { Y: { jour: 'January 14, 2022', sources: ['https://a.example/'], motif: 'm' } }, X: BON });
    verifier('_EN_ATTENTE n\'écrit rien', [Object.keys(r.admis), r.refus.length], [['X'], 0]);
    verifier('le dénominateur est dit', [r.denominateur.entrees, r.denominateur.ignorees, r.denominateur.admises, r.denominateur.refusees], [1, 2, 1, 0]);
})();
verifier('un relevé qui n\'est pas un objet lève', (() => { try { L(null); return 'rien'; } catch (e) { return 'leve'; } })(), 'leve');
verifier('un relevé SANS aucune entrée lève (instrument muet)', (() => { try { L({ _format: 'x' }); return 'rien'; } catch (e) { return 'leve'; } })(), 'leve');

console.log('— contradiction avec une date déjà en base : signalée, jamais écrite');
(() => {
    const adm = L({ X: BON, Y: { ...BON, jour: 'March 3, 2020' }, Z: BON }).admis;
    const sets = [{ _id: 'X', region: 'jp', dateSortieJa: 'January 25, 2019' }, { _id: 'Y', region: 'jp', dateSortieJa: 'March 4, 2020' }, { _id: 'Z', region: 'jp', dateSortieJa: null }];
    const champDe = s => s.region === 'jp' ? 'dateSortieJa' : 'dateSortieEn';
    const r = contradictionsAvecBase(adm, sets, champDe, [null, '', 'N/A']);
    verifier('même date : daté, sans contradiction', r.dejaDates.map(x => x.id), ['X']);
    verifier('date différente : contradiction nommée', r.contradictions.map(x => [x.id, x.enBase, x.releve]), [['Y', 'March 4, 2020', 'March 3, 2020']]);
    verifier('un set sans date n\'est ni l\'un ni l\'autre', [r.contradictions, r.dejaDates].flat().some(x => x.id === 'Z'), false);
})();

console.log('— le vote : un relevé admis est UNE voix, officielle ou tierce, et ne passe pas outre la majorité');
verifier('relevé officiel + Bulbapedia contre TCGdex : le relevé l\'emporte avec Bulbapedia', (() => { const r = majorite([{ source: 'officielle', iso: '2025-09-12' }, { source: 'bulbapedia', iso: '2025-09-12' }, { source: 'tcgdex', iso: '2025-09-01' }]); return [r.iso, r.voix]; })(), ['2025-09-12', 2]);
verifier('relevé tiers seul contre TCGdex une clé (témoin) : une voix', (() => { const r = majorite([{ source: 'releve-tiers', iso: '2019-01-25' }]); return [r.iso, r.voix]; })(), ['2019-01-25', 1]);

console.log('— le fichier réel : les cinq entrées prêtes sont admises, le bloc _EN_ATTENTE ne l\'est pas');
(() => {
    const f = 'C:/Users/Yung/rat-market-travail/catalogue/chasse/RELEVES-dates-entree.json';
    if (!fs.existsSync(f)) { console.log('  (fichier absent : cellule non jouée)'); return; }
    const r = L(JSON.parse(fs.readFileSync(f, 'utf8')));
    verifier('cinq admises, aucun refus', [Object.keys(r.admis).sort(), r.refus.length], [['30th-Celebration-Simplified-Chinese-Premium-Deck-Set', 'Black-Sparkle', 'Dark-Crystal-Blaze', 'Gem-Pack-Vol-3', 'Trainer-Battle-Decks'], 0]);
    verifier('rangs : Trainer-Battle-Decks tierce, les quatre autres officielle', Object.fromEntries(Object.entries(r.admis).map(([k, v]) => [k, v.rang])),
        { 'Trainer-Battle-Decks': 'tierce', 'Dark-Crystal-Blaze': 'officielle', 'Gem-Pack-Vol-3': 'officielle', '30th-Celebration-Simplified-Chinese-Premium-Deck-Set': 'officielle', 'Black-Sparkle': 'officielle' });
    verifier('aucune des clés _EN_ATTENTE n\'est admise', ['Premium-Trainer-Box-VSTAR', 'VMAX-Starter-Decks', 'Sun-Moon-Family-Pokemon-Card-Game'].some(k => r.admis[k]), false);
})();

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
