// BANC — collecte-cartes/listes-de-deck.js sur des extraits RÉELS : la page « Battle Academy 2022 (TCG) » (rév. 4088821) et les
// produits Cardmarket de BA22/BA20 relevés le 2026-09-26. Aucune base.
//   node test-listes-de-deck.js
const { decksDeLaPage, prefixeDe, mesurerPrefixes, joindreParDeck, origineDuSlug } = require('./collecte-cartes/listes-de-deck');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const PAGE = `==Deck lists==
{{halfdecklist/header|title=Cinderace Deck|type=Fire|symbol=no}}
{{halfdecklist/entry|043/264|E|[[Cinderace V (Fusion Strike 43)|Cinderace]]{{TCGV}} <small>'''[Fusion Strike]'''</small>|Fire||1}}
{{halfdecklist/entry|046/264|E|{{TCG ID|Fusion Strike|Sizzlipede|46}} <small>'''[Fusion Strike]'''</small>|Fire||4}}
{{halfdecklist/entry|183/202|D|{{TCG ID|Sword & Shield|Switch|183}} <small>'''[Sword & Shield]'''</small>|Item||2}}
{{halfdecklist/entry|177/202|D|{{TCG ID|Sword & Shield|Potion|177}} <small>'''[Sword & Shield]'''</small>|Item||1}}
{{halfdecklist/entry|None|—|{{TCG|Fire Energy}}|Energy|Fire|18}}
{{halfdecklist/footer}}
{{halfdecklist/header|title=Pikachu Deck|type=Lightning|symbol=no}}
{{halfdecklist/entry|043/185|D|[[Pikachu V (Vivid Voltage 43)|Pikachu]]{{TCGV}} <small>'''[Vivid Voltage]'''</small>|Lightning||1}}
{{halfdecklist/entry|053/185|D|{{TCG ID|Vivid Voltage|Blitzle|53}} <small>'''[Vivid Voltage]'''</small>|Lightning||4}}
{{halfdecklist/entry|183/202|D|{{TCG ID|Sword & Shield|Switch|183}} <small>'''[Sword & Shield]'''</small>|Item||2}}
{{halfdecklist/entry|999/999|D|{{TCG ID|Vivid Voltage|Potion|999}}|Item||1}}
{{halfdecklist/footer}}`;
const CARTES = {
    'Cinderace V (Fusion Strike 43)': { _id: 1, nomEn: 'Cinderace V', attaques: [{ nom: 'Blaze Kick' }] },
    'Sizzlipede (Fusion Strike 46)': { _id: 2, nomEn: 'Sizzlipede', attaques: [{ nom: 'Gnaw' }, { nom: 'Ember' }] },
    'Switch (Sword & Shield 183)': { _id: 3, nomEn: 'Switch', attaques: [] },
    'Potion (Sword & Shield 177)': { _id: 4, nomEn: 'Potion', attaques: [] },
    'Pikachu V (Vivid Voltage 43)': { _id: 5, nomEn: 'Pikachu V', attaques: [{ nom: 'Charge' }, { nom: 'Thunderbolt' }] },
    'Blitzle (Vivid Voltage 53)': { _id: 6, nomEn: 'Blitzle', attaques: [{ nom: 'Flop' }] },
    'Potion (Vivid Voltage 999)': { _id: 7, nomEn: 'Potion', attaques: [] }
};
const carteDe = e => CARTES[e.titre] || null;
const P = (idProduct, nom, attaques, numero, slug) => ({ idProduct, nom, attaques, numero, slug });
const PRODUITS = [
    P(674247, 'Cinderace V', ['Blaze Kick'], 'C60', 'Cinderace-V-FST043'),
    P(833622, 'Sizzlipede', ['Gnaw', 'Ember'], 'C01', 'Sizzlipede-V1-BA22C01'),
    P(833624, 'Fire Energy', [], 'C02', 'Fire-Energy-V1-BA22C02'),
    P(900001, 'Switch', [], 'C20', 'Switch-V1-BA22C20'),
    P(900002, 'Potion', [], 'C21', 'Potion-V1-BA22C21'),
    P(674246, 'Pikachu V', ['Charge', 'Thunderbolt'], 'P60', 'Pikachu-V-VIV43'),
    P(900003, 'Blitzle', ['Flop'], 'P01', 'Blitzle-V1-BA22P01'),
    P(900004, 'Potion', [], 'P22', 'Potion-V1-BA22P22'),
    P(900005, 'Sizzlipede', ['Gnaw', 'Ember'], 'P30', 'Sizzlipede-V1-BA22P30'),
    P(900006, 'Blitzle', ['Flop'], null, null)
];
const decks = decksDeLaPage(PAGE);
verifier('deux decks lus, énergie de base non lue comme carte', decks.map(d => `${d.titre}:${d.entrees.length}:${d.ignorees}`), ['Cinderace Deck:4:1', 'Pikachu Deck:4:0']);
verifier('préfixes de numéro', ['C01', 'EVE', 'DAR05', '12', null].map(prefixeDe), ['C', 'EVE', 'DAR', null, null]);
// Le produit 900005 (un Sizzlipede numéroté « P », absent du deck Pikachu) est un PIÈGE pour la jointure ; sur trois Pokémon « P »,
// il ferait 1 contre 2 et la mesure refuserait la lettre — c'est son rôle (voir le dernier cas). L'appariement se mesure sans lui.
const m = mesurerPrefixes(decks, PRODUITS.filter(p => p.idProduct !== 900005), carteDe);
verifier('préfixe → deck mesuré sur les Pokémon', m.prefixes, { C: 'Cinderace Deck', P: 'Pikachu Deck' });
verifier('une lettre dont les Pokémon se partagent entre deux decks n\'est pas appariée', mesurerPrefixes(decks, PRODUITS, carteDe).prefixes.P ?? null, null);
const { resolus, causes } = joindreParDeck({ decks, produits: PRODUITS, carteDe, prefixes: m.prefixes, codeDuSet: 'BA22' });
const R = Object.fromEntries(resolus.map(r => [r.p.idProduct, r.carte._id]));
verifier('Sizzlipede C01 → la carte du deck Cinderace', R[833622], 2);
verifier('Switch commun aux deux decks : chaque produit prend la carte de SON deck', [R[900001]], [3]);
verifier('Potion : deux tirages DIFFÉRENTS selon le deck, le préfixe tranche', [R[900002], R[900004]], [4, 7]);
verifier('Pikachu V, origine du slug VIV43 = n°43 : joint', R[674246], 5);
verifier('énergie de base : aucun candidat, nommée', causes.sansCandidat.some(p => p.idProduct === 833624), true);
verifier('un nom absent de SON deck ne se cherche pas dans l\'autre', [R[900005] ?? null, causes.sansCandidat.some(p => p.idProduct === 900005)], [null, true]);
verifier('produit sans numéro : sans préfixe', causes.sansPrefixe.map(p => p.idProduct), [900006]);
const bad = joindreParDeck({ decks, produits: [P(1, 'Blitzle', ['Thunderbolt'], 'P02', 'Blitzle-V1-BA22P02')], carteDe, prefixes: m.prefixes, codeDuSet: 'BA22' });
verifier('attaques discordantes : refusé', bad.causes.attaquesDiscordantes.length, 1);
const bad2 = joindreParDeck({ decks, produits: [P(2, 'Pikachu V', ['Charge'], 'P60', 'Pikachu-V-VIV44')], carteDe, prefixes: m.prefixes, codeDuSet: 'BA22' });
verifier('numéro d\'origine du slug contredit par l\'entrée : refusé', bad2.causes.origineDiscordante.length, 1);
verifier('origine du slug : jamais le code du set lui-même', ['Kangaskhan-V1-DRM55', 'Charmander-V1-BA2018', 'Hau-V1-BA20120', 'Fire-Energy-V1-SUM', 'Eevee-V-SWSH065'].map(s => origineDuSlug(s, 'BA20')),
    [{ code: 'DRM', numero: '55' }, null, null, null, { code: 'SWSH', numero: '065' }]);
const deuxPrefixes = mesurerPrefixes(decks, [...PRODUITS, P(3, 'Sizzlipede', ['Gnaw'], 'X01', null), P(4, 'Cinderace V', ['Blaze Kick'], 'X02', null)], carteDe);
verifier('deux préfixes pour un même deck : aucun des deux n\'est retenu', [deuxPrefixes.prefixes.C ?? null, deuxPrefixes.prefixes.X ?? null], [null, null]);

// ── L'ORDRE IMPRIMÉ (« The Cinderace and Pikachu decks also have an order printed on their cards », même page, rév. 4088821).
const ORDRE = `${PAGE}
{{halfdecklist/header|title=Cinderace Deck|type=Fire|symbol=no}}
{{halfdecklist/entry|1|E|{{TCG ID|Fusion Strike|Sizzlipede|46}} <small>'''[Fusion Strike 046/264]'''</small>|Fire||1}}
{{halfdecklist/entry|2|—|{{TCG|Fire Energy}}|Energy|Fire|1}}
{{halfdecklist/entry|3|D|{{TCG ID|Sword & Shield|Switch|183}} <small>'''[Sword & Shield 183/202]'''</small>|Item||1}}
{{halfdecklist/entry|60|E|[[Cinderace V (Fusion Strike 43)|Cinderace]]{{TCGV}} <small>'''[Fusion Strike 043/264]'''</small>|Fire||1}}
{{halfdecklist/footer}}`;
const decksO = decksDeLaPage(ORDRE);
verifier('deux listes du même titre : un deck, son ordre imprimé lu', decksO.map(d => `${d.titre}:${d.ordre ? d.ordre.size : '—'}`), ['Cinderace Deck:4', 'Pikachu Deck:—']);
const jo = joindreParDeck({ decks: decksO, produits: [P(10, 'Sizzlipede', ['Gnaw', 'Ember'], 'C01', 'Sizzlipede-V1-BA22C01'), P(11, 'Fire Energy', [], 'C02', null),
    P(12, 'Potion', [], 'C03', null), P(13, 'Cinderace V', ['Blaze Kick'], 'C60', 'Cinderace-V-FST043'), P(14, 'Switch', [], 'C07', null), P(15, 'Blitzle', ['Flop'], 'P01', null)], carteDe, prefixes: { C: 'Cinderace Deck', P: 'Pikachu Deck' }, codeDuSet: 'BA22' });
verifier('C01 → position 1 → Sizzlipede, clé « position »', jo.resolus.filter(r => r.p.idProduct === 10).map(r => [r.carte._id, r.cle]), [[2, 'position']]);
verifier('C02 : une énergie de base à la position 2, aucun candidat', jo.causes.sansCandidat.map(p => [p.idProduct, p.raisonSans]), [[11, 'position 2 : energie-base']]);
verifier('C03 « Potion » alors que la position 3 est Switch : le nom, témoin, refuse', jo.causes.nomDiscordant.map(x => x.p.idProduct), [12]);
verifier('C07 : position absente de l\'ordre, nommée', jo.causes.positionAbsente.map(p => p.idProduct), [14]);
verifier('un deck sans ordre imprimé garde la clé (deck, nom)', jo.resolus.filter(r => r.p.idProduct === 15).map(r => r.cle), ['nom']);
// L'écart de forme (BA22 P44, BA24 DAR, relevés le 2026-09-26) — et le vrai désaccord (BA22 C42 « Hop » à la position de Potion).
const FORME = `{{halfdecklist/header|title=Pikachu Deck}}
{{halfdecklist/entry|44|D|{{TCG ID|Rebel Clash|Boss's Orders|154}}|Supporter||1}}
{{halfdecklist/entry|42|D|{{TCG ID|Sword & Shield|Potion|177}}|Item||1}}
{{halfdecklist/entry|57|D|{{TCG ID|Sword & Shield|Hop|165}}|Supporter||1}}
{{halfdecklist/footer}}
{{halfdecklist/header|title=Darkrai Deck}}
{{halfdecklist/entry|172/193|E|{{TCG ID|Paldea Evolved|Boss's Orders|172}}|Supporter||1}}
{{halfdecklist/footer}}`;
const CF = { "Boss's Orders (Rebel Clash 154)": { _id: 20, nomEn: "Boss's Orders", attaques: [] }, 'Potion (Sword & Shield 177)': CARTES['Potion (Sword & Shield 177)'], 'Hop (Sword & Shield 165)': { _id: 21, nomEn: 'Hop', attaques: [] }, "Boss's Orders (Paldea Evolved 172)": { _id: 22, nomEn: "Boss's Orders", attaques: [] } };
const jf = joindreParDeck({ decks: decksDeLaPage(FORME), produits: [P(30, "Boss's Orders - Giovanni", [], 'P44', null), P(31, 'Hop', [], 'P42', null), P(32, "Boss's Orders - Ghetsis", [], 'DAR', null)], carteDe: e => CF[e.titre] || null, prefixes: { P: 'Pikachu Deck', DAR: 'Darkrai Deck' }, codeDuSet: 'BA22' });
verifier('« Boss\'s Orders - Giovanni » à la position de Boss\'s Orders : écart de forme accepté', jf.resolus.filter(r => r.p.idProduct === 30).map(r => r.carte._id), [20]);
verifier('« Hop » à la position de Potion, Hop ailleurs dans le deck : désaccord, refusé', jf.causes.nomDiscordant.map(x => x.p.idProduct), [31]);
verifier('par le nom : « Boss\'s Orders - Ghetsis », seule carte du deck qui commence ainsi', jf.resolus.filter(r => r.p.idProduct === 32).map(r => r.carte._id), [22]);
const jh = joindreParDeck({ decks: decksDeLaPage(`{{halfdecklist/header|title=Pikachu Deck}}\n{{halfdecklist/entry|57|D|{{TCG ID|Sword & Shield|Hop|165}}|Supporter||1}}\n{{halfdecklist/footer}}`), produits: [P(33, 'Hoppip', ['Splash'], 'P57', null)], carteDe: e => CF[e.titre] || null, prefixes: { P: 'Pikachu Deck' }, codeDuSet: 'BA22' });
verifier('« Hoppip » ne commence pas par le MOT « Hop »', jh.causes.nomDiscordant.map(x => x.p.idProduct), [33]);
const doublon = decksDeLaPage(`{{halfdecklist/header|title=X Deck}}\n{{halfdecklist/entry|1|E|{{TCG ID|A|B|1}}|Fire||1}}\n{{halfdecklist/entry|1|E|{{TCG ID|A|C|2}}|Fire||1}}\n{{halfdecklist/footer}}`);
verifier('une position écrite deux fois n\'est pas un ordre', doublon[0].ordre, null);

console.log(`\n${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
