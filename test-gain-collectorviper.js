// node test-gain-collectorviper.js — la liste des sets japonais triée par GAIN pour Collectorviper (collecte-cartes/gain-collectorviper.js).
// Pur : des lignes fabriquées, aucune base, aucun réseau, aucun fichier du testeur.
const path = require('path');
const G = require(process.env.GAIN_MODULE ? path.resolve(process.env.GAIN_MODULE) : './collecte-cartes/gain-collectorviper');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const ere = (slug, code, nom = slug) => { const r = G.ereDe({ slug, code, nom }); return [r.ere, r.couvert]; };

// ── l'ère se lit sur nos données (code de la table, puis forme du slug) ; ce qui ne se prouve pas reste « ère inconnue »
verifier('DP1 : DP/DPt, annoncée', ere('Space-Time-Creation', 'DP1'), ['DP/DPt', true]);
verifier('Pt4 : DP/DPt', ere('Advent-of-Arceus', 'Pt4'), ['DP/DPt', true]);
verifier('DP5c : DP/DPt', ere('Cry-from-the-Mysterious', 'DP5c'), ['DP/DPt', true]);
verifier('L2 : Legend', ere('Reviving-Legends', 'L2'), ['Legend', true]);
verifier('L1HG : Legend', ere('HeartGold-Collection', 'L1HG'), ['Legend', true]);
verifier('EC1 : e', ere('Base-Expansion-Pack', 'EC1'), ['e', true]);
verifier('N2 : Neo', ere('Crossing-the-Ruins', 'N2'), ['Neo', true]);
verifier('VS : VS', ere('Pokemon-CardVS', 'VS'), ['VS', true]);
verifier('ADV1 : ADV', ere('ADV-Expansion-Pack', 'ADV1'), ['ADV', true]);
verifier('PCG6 : PCG', ere('Holon-Research-Tower', 'PCG6'), ['PCG', true]);
verifier('BW9 : BW', ere('Megalo-Cannon', 'BW9'), ['BW', true]);
verifier('XY5t : XY', ere('Tidal-Storm', 'XY5t'), ['XY', true]);
verifier('sm12a : SM', ere('Tag-All-Stars', 'sm12a'), ['SM', true]);
verifier('sm1+ : SM', ere('Strength-Expansion-Pack-Sun-Moon', 'sm1+'), ['SM', true]);
verifier('XY-P : promos 1996-2017, annoncée', ere('XY-Promos', 'XY-P'), ['promos 1996-2017', true]);
verifier('ADV-P, PCG-P, L-P, BW-P, SM-P : promos 1996-2017', ['ADV-P', 'PCG-P', 'L-P', 'BW-P', 'SM-P'].map(c => ere('x', c)[0]), Array(5).fill('promos 1996-2017'));
verifier('SV-P, S-P, M-P : promos modernes, NON annoncées', ['SV-P', 'S-P', 'M-P'].map(c => ere('x', c)), Array(3).fill(['promos modernes', false]));
verifier('s8a (Sword & Shield) : ère moderne, NON annoncée', ere('25th-Anniversary-Collection', 's8a'), ['moderne (S, SV, M)', false]);
verifier('sv4a, m6a : ère moderne, NON annoncée', [ere('Shiny-Treasure-ex', 'sv4a'), ere('30th-Celebration-JP', 'm6a')], Array(2).fill(['moderne (S, SV, M)', false]));
verifier('EXP, G1, CGK : avant Neo (Base, Gym), NON annoncée', [ere('Expansion-Pack', 'EXP'), ere('Leaders-Stadium', 'G1'), ere('Kuchiba-City-Gym', 'CGK')], Array(3).fill(['avant Neo (Base, Gym)', false]));
verifier('UNP (promos sans ère) : ère inconnue, couvert null', ere('Unnumbered-Promos', 'UNP'), ['ère inconnue', null]);
verifier('sans code et sans forme reconnue : ère inconnue', ere('PokePark-Forest', undefined), ['ère inconnue', null]);
verifier('code absent de la table : « sm » dans le NOM ne prouve rien', ere('Sun-Moon-Foo', undefined), ['ère inconnue', null]);
// decks : groupe « decks », sous-ère prouvée par le code
const deck = (slug, code) => { const r = G.ereDe({ slug, code, nom: slug }); return [r.ere, r.sousEre, r.couvert]; };
verifier('Intro Pack Neo : decks / Neo, annoncé', deck('Intro-Pack-Neo-Totodile', 'IPNT'), ['decks', 'Neo', true]);
verifier('Constructed Starter Deck pcgJ : decks / PCG', deck('Feraligatr-Constructed-Starter-Deck', 'pcgJ'), ['decks', 'PCG', true]);
verifier('Half Deck PtG : decks / DP/DPt', deck('Garchomp-SP-Half-Deck', 'PtG'), ['decks', 'DP/DPt', true]);
verifier('Palkia LV.X deck DP3p : decks / DP/DPt', deck('Palkia-LVX-Constructed-Standard-Deck', 'DP3p'), ['decks', 'DP/DPt', true]);
verifier('Deck Kit XYe : decks / XY', deck('Emboar-EX-vs-Togekiss-EX-Deck-Kit', 'XYe'), ['decks', 'XY', true]);
verifier('Deck smG : decks / SM', deck('Ultra-Sun-Ultra-Moon-Deck-Build-Boxes', 'smG'), ['decks', 'SM', true]);
verifier('Deck moderne (svK) : decks / moderne, NON annoncé', deck('Stellar-Miracle-Deck-Build-Box', 'svK'), ['decks', 'moderne (S, SV, M)', false]);
verifier('Deck sans code, nom moderne (Sword-Shield-Starter-Decks) : NON annoncé', deck('Sword-Shield-Starter-Decks', undefined), ['decks', 'moderne (S, SV, M)', false]);
verifier('Deck sans code ni indice d\'ère : decks / ère inconnue, couvert null', deck('Bastiodon-the-Defender-Deck', undefined), ['decks', 'ère inconnue', null]);

// ── le calcul du gain, sur des lignes fabriquées
const L = (slug, nomSet, cause, o = {}) => ({ idProduct: Math.floor(Math.random() * 1e9), slug, langue: 'jp', nomSet, servi: false, cause, sousCause: 'x', ...o });
const lignes = [
    L('Space-Time-Creation', 'Space-Time Creation', 9), L('Space-Time-Creation', 'Space-Time Creation', 4), L('Space-Time-Creation', 'Space-Time Creation', 7), L('Space-Time-Creation', 'Space-Time Creation', 8),
    L('Space-Time-Creation', 'Space-Time Creation', 2),
    L('Space-Time-Creation', 'Space-Time Creation', 3),
    L('Space-Time-Creation', 'Space-Time Creation', null, { servi: true }),
    L('Space-Time-Creation', 'Space-Time Creation', 9, { langue: 'intl' }),
    L('Scarlet-Violet-Promos', 'Scarlet Violet Promos', 9), L('Scarlet-Violet-Promos', 'Scarlet Violet Promos', 9),
    L('Unnumbered-Promos', 'Unnumbered Promos', 2), L('Unnumbered-Promos', 'Unnumbered Promos', 2),
    L('Tidal-Storm', 'Tidal Storm', 4), L('Tidal-Storm', 'Tidal Storm', 4), L('Tidal-Storm', 'Tidal Storm', 4)
];
const codes = new Map([['Space-Time-Creation', 'DP1'], ['Scarlet-Violet-Promos', 'SV-P'], ['Unnumbered-Promos', 'UNP'], ['Tidal-Storm', 'XY5t']]);
const R = G.calculer(lignes, codes);
verifier('le dénominateur : jp seulement, non servis seulement', [R.denominateur.jpTotal, R.denominateur.jpNonServis], [14, 13]);
verifier('causes du gain : 9, 4, 7, 8 — et rien d\'autre', G.CAUSES_GAIN, [9, 4, 7, 8]);
verifier('totaux : gain 9, sans fiche (cause 2) 3 à part, hors gain (cause 3) 1', [R.totaux.gain, R.totaux.sansFiche, R.totaux.horsGain, R.totaux.sansCause], [9, 3, 1, 0]);
verifier('concordance : gain + sans fiche + hors gain + sans cause = non servis', R.totaux.gain + R.totaux.sansFiche + R.totaux.horsGain + R.totaux.sansCause, R.denominateur.jpNonServis);
verifier('tri par gain décroissant', R.sets.map(s => [s.slug, s.gain]), [['Space-Time-Creation', 4], ['Tidal-Storm', 3], ['Scarlet-Violet-Promos', 2], ['Unnumbered-Promos', 0]]);
verifier('un set porte son nom, son code, son ère, son couvert, son sans-fiche', R.sets[0] && [R.sets[0].nom, R.sets[0].code, R.sets[0].ere, R.sets[0].couvert, R.sets[0].sansFiche, R.sets[0].horsGain], ['Space-Time Creation', 'DP1', 'DP/DPt', true, 1, 1]);
verifier('répartition du gain par statut d\'ère : annoncé 7, non annoncé 2, inconnu 0', [R.totaux.gainCouvert, R.totaux.gainHorsAnnonce, R.totaux.gainEreInconnue], [7, 2, 0]);
verifier('répartition par ère, triée par gain', R.eres.map(e => [e.ere, e.gain]), [['DP/DPt', 4], ['XY', 3], ['promos modernes', 2], ['ère inconnue', 0]]);
verifier('le gain d\'une ère inconnue est compté à part du « non annoncé »', G.calculer([L('Foo-Bar', 'Foo Bar', 9)], new Map([['Autre', 'DP1']])).totaux.gainEreInconnue, 1);
const mixte = G.calculer([L('Sword-Shield-Starter-Decks', 'x', 9), L('Feraligatr-Constructed-Starter-Deck', 'y', 9)], new Map([['Feraligatr-Constructed-Starter-Deck', 'pcgJ'], ['Z', 'DP1']]));
verifier('des decks de sous-ères différentes ne se confondent pas : « annoncée » se décide par sous-ère', mixte.eres.map(e => [e.ere, e.couvert, e.gain]).sort(), [['decks / PCG', true, 1], ['decks / moderne (S, SV, M)', false, 1]]);
const sansCode = G.calculer([L('Sun-Moon-Foo', 'Sun Moon Foo', 9)], new Map([['Autre', 'DP1']]));
verifier('calculer : un set dont le seul indice est son NOM reste « ère inconnue »', [sansCode.sets[0].ere, sansCode.sets[0].couvert], ['ère inconnue', null]);
// les gardes : un instrument qui ne mord sur rien ne rend pas un résultat plausible
let leve = null; try { G.calculer([L('a', 'a', 9, { langue: 'intl' })], codes); } catch (e) { leve = e.message; }
verifier('aucune ligne jp : lève (population vide, pas un zéro)', /aucune ligne jp/i.test(leve || ''), true);
leve = null; try { G.calculer(lignes, new Map()); } catch (e) { leve = e.message; }
verifier('table des codes vide alors que des sets existent : lève', /table des codes/i.test(leve || ''), true);
const sc = G.calculer([L('Space-Time-Creation', 'x', null)], codes);
verifier('un non-servi sans cause est compté « sans cause », pas rangé dans le gain', [sc.totaux.sansCause, sc.totaux.gain], [1, 0]);
verifier('le rendu markdown imprime le dénominateur', /non servis jp\D+13/i.test(G.rendreMd(R)) && /couverts par une ère annoncée/i.test(G.rendreMd(R)), true);

console.log(`\n${ok} réussis, ${ko} en échec`);
process.exit(ko ? 1 : 0);
