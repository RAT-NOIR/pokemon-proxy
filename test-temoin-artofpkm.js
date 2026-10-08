// node test-temoin-artofpkm.js — BANC PUR (aucune base, aucun réseau).
// Le témoin du nom dans la jointure des images artofpkm (audit Celebrations du 2026-10-08) : 5 visuels d'AUTRES cartes avaient été
// posés parce que le nom de l'image ne servait qu'en départage. Fragments : les cas de l'audit (ids et noms RELEVÉS dans la base
// `cartes`, numéros et decks idem) ; les noms japonais sont des étiquettes de fixture (le test porte sur la LOGIQUE du témoin).
// Chaque cas est vu rouge sur main (module absent) puis vert.
const { fabriquerTemoinImages, appliquerTemoin } = require('./collecte-cartes/temoin-images-artofpkm');

let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); }
};
const carte = (id, nomEn, nomJa, expansion, numero, deck, extra = {}) => ({ _id: id, nomEn, nomJa, attaques: [], impressions: [{ tirage: 'jp', expansion, numero, ...(deck ? { deck } : {}) }], ...extra });
const im = (cleR2, numero, nomEn, nomJa) => ({ _id: cleR2, cleR2, numero, nomEn, nomJa });
const refus = v => v ? v.regle : null;

// ── 1. LISTE À DEUX DECKS : Intro Pack (liste artofpkm 28 numérote Bulbasaur ET Squirtle) ─────────────────────────────────────
const IP = 'Intro Pack';
const ligneIP = { bulba: { expansion: IP, tirage: 'jp', deck: 'Bulbasaur Deck' } };
const grass = carte(60754, 'Basic Grass Energy', '基本草エネルギー', IP, '25', 'Bulbasaur Deck');
const dcSquirtle = carte(11408, 'Double Colorless Energy', 'ダブル無色エネルギー', IP, '25', 'Squirtle Deck');          // HORS slug de la ligne
const psy = carte(13685, 'Basic Psychic Energy', '基本超エネルギー', IP, '27', 'Bulbasaur Deck');
const waterSq = carte(13683, 'Basic Water Energy', '基本水エネルギー', IP, '27', 'Squirtle Deck');
const pikachu = carte(20368, 'Pikachu', 'ピカチュウ', IP, '40', 'Bulbasaur Deck');
const squirtle = carte(39472, 'Squirtle', 'ゼニガメ', IP, '40', 'Squirtle Deck');
{
    const T = fabriquerTemoinImages({ ligne: ligneIP, cartes: [grass, dcSquirtle, psy, waterSq, pikachu, squirtle] });
    verifier('Intro Pack 28/25 : « Double Colorless Energy » sur Basic Grass Energy (témoin : l\'autre deck au n°25) -> refusé', refus(T(im('artofpkm/28/25.webp', '25', 'Double Colorless Energy', 'ダブル無色エネルギー'), grass)), 'nom-contredit-par-une-carte-au-meme-numero');
    verifier('Intro Pack 28/27 : « Basic Water Energy » sur Basic Psychic Energy -> refusé', refus(T(im('artofpkm/28/27.webp', '27', 'Basic Water Energy', '基本水エネルギー'), psy)), 'nom-contredit-par-une-carte-au-meme-numero');
    verifier('Intro Pack 28/40 : « Squirtle » sur Pikachu -> refusé', refus(T(im('artofpkm/28/40.webp', '40', 'Squirtle', 'ゼニガメ'), pikachu)), 'nom-contredit-par-une-carte-au-meme-numero');
    // le témoin n'est JAMAIS receveur : la carte de l'autre deck, jugée comme porteuse de SA propre image, passe
    verifier('Intro Pack : la carte de l\'autre deck est témoin, la même image sur elle n\'est pas contredite', refus(T(im('artofpkm/28/25.webp', '25', 'Double Colorless Energy', 'ダブル無色エネルギー'), dcSquirtle)), null);
    verifier('Intro Pack : le bon visuel sur la bonne carte passe', refus(T(im('artofpkm/28/40.webp', '40', 'Pikachu', 'ピカチュウ'), pikachu)), null);
}

// ── 2. HORS SLUG, AUTRE EXPANSION DE LA MÊME PAGE : Premium Trainer Box ex n°008 (Mareep / Lumineon V) ─────────────────────────
{
    const PT = 'Premium Trainer Box ex';
    const mareep = carte(262554, 'Mareep', 'メリープ', PT, '008');
    const lumineon = carte(267492, 'Lumineon V', 'ネオラントV', PT, '008', null, { sets: [] });
    const T = fabriquerTemoinImages({ ligne: { bulba: { expansion: PT, tirage: 'jp' } }, cartes: [mareep, lumineon] });
    verifier('Premium Trainer Box ex 538/8 : « Lumineon V » sur Mareep (témoin hors slug au n°008) -> refusé', refus(T(im('artofpkm/538/8.webp', '008', 'Lumineon V', 'ネオラントV'), mareep)), 'nom-contredit-par-une-carte-au-meme-numero');
    verifier('Premium Trainer Box ex : « Lumineon V » sur Lumineon V passe', refus(T(im('artofpkm/538/8.webp', '008', 'Lumineon V', 'ネオラントV'), lumineon)), null);
}

// ── 3. CE QUI DOIT RESTER SERVI (§55 : un témoin ne vaut que sa donnée) ───────────────────────────────────────────────────────
{
    const X = 'Expansion X';
    const lele = carte(1, 'Tapu Lele', 'カプ・コケコ', X, '020');
    const fini = carte(2, 'Tapu Fini', 'カプ・レヒレ', X, '021');
    const T = fabriquerTemoinImages({ ligne: { bulba: { expansion: X, tirage: 'jp' } }, cartes: [lele, fini] });
    // le nom ANGLAIS d'artofpkm est faux (カプ・テテフ nommée « Tapu Fini ») mais le nom JAPONAIS concorde avec la porteuse : le témoin se tait
    verifier('nom EN faux chez la source mais nom JA égal à la porteuse -> servi (précédent Tapu Fini)', refus(T(im('artofpkm/9/20.webp', '020', 'Tapu Fini', 'カプ・コケコ'), lele)), null);
    // le nom diverge, mais aucune AUTRE carte ne porte ce nom au même numéro (écart de forme, ou nom d'une carte d'un autre numéro) -> muet
    verifier('nom divergent qui ne désigne aucune carte du même numéro -> servi', refus(T(im('artofpkm/9/20.webp', '020', 'Tapu Fini', 'カプ・ヒヒダルマ'), lele)), null);
    verifier('nom égal -> servi', refus(T(im('artofpkm/9/20.webp', '020', 'Tapu Lele', 'カプ・コケコ'), lele)), null);
    verifier('image sans nom -> le témoin n\'a rien à dire', refus(T(im('artofpkm/9/20.webp', '020', null, null), lele)), null);
}

// ── 4. LE JUSTE VOISIN : même nom à un AUTRE numéro n'est pas un témoin du numéro ────────────────────────────────────────────
{
    const X = 'Expansion Y';
    const a = carte(1, 'Pikachu', 'ピカチュウ', X, '005');
    const b = carte(2, 'Raichu', 'ライチュウ', X, '006');
    const autrePikachu = carte(3, 'Pikachu', 'ピカチュウ', X, '050');
    const T = fabriquerTemoinImages({ ligne: { bulba: { expansion: X, tirage: 'jp' } }, cartes: [a, b, autrePikachu] });
    verifier('« Pikachu » sur Raichu n°006 : le seul Pikachu est ailleurs (n°005 et 050), pas au n°006 -> servi (le témoin ne contredit que par le NUMÉRO)', refus(T(im('artofpkm/1/6.webp', '006', 'Pikachu', 'ピカチュウ'), b)), null);
}

// ── 4 bis. NUMÉRO SANS CHIFFRE (« SV-P ») : le numéro ne désigne rien, le nom est la seule clé -> les DEUX noms doivent être disjoints ─
{
    const SVP = 'SV-P Promotional cards';
    const ogerpon = carte(306527, 'Teal Mask Ogerpon', 'オーガポン みどりのめん', SVP, 'SV-P');
    const T = fabriquerTemoinImages({ ligne: { bulba: { expansion: SVP, tirage: 'jp' } }, cartes: [ogerpon] });
    verifier('SV-P 478/323 : « Paradise Resort » (Stade) sur Teal Mask Ogerpon, aucun témoin en base, EN et JA disjoints -> refusé', refus(T(im('artofpkm/478/323.webp', 'SV-P', 'Paradise Resort', 'パラダイスリゾート'), ogerpon)), 'numero-sans-chiffre-et-noms-disjoints');
    verifier('SV-P : le bon nom passe', refus(T(im('artofpkm/478/1.webp', 'SV-P', 'Teal Mask Ogerpon', 'オーガポン みどりのめん'), ogerpon)), null);
    verifier('SV-P : nom EN disjoint mais JA qui partage des kana avec la porteuse -> servi (les deux doivent diverger)', refus(T(im('artofpkm/478/2.webp', 'SV-P', 'Ogerpon ex', 'オーガポン ex'), ogerpon)), null);
    verifier('SV-P : JA absent d\'un côté -> servi (le témoin ne devine pas)', refus(T(im('artofpkm/478/3.webp', 'SV-P', 'Paradise Resort', null), ogerpon)), null);
    // la règle ne vaut QUE pour un numéro sans chiffre : un numéro chiffré dont le nom est disjoint, sans carte au même numéro, reste servi
    // (ADV-Promos 019 Mudkip <- « Larvitar » : suspect non tranché, cf. rapport — le coût de la règle large est mesuré à part)
    const ADV = 'ADV Promotional cards';
    const mudkip = carte(49195, 'Mudkip', 'ミズゴロウ', ADV, '019');
    const T2 = fabriquerTemoinImages({ ligne: { bulba: { expansion: ADV, tirage: 'jp' } }, cartes: [mudkip] });
    verifier('numéro chiffré, noms disjoints, aucun témoin : non refusé par ce lot', refus(T2(im('artofpkm/64/64.webp', '019', 'Larvitar', 'ヨーギラス'), mudkip)), null);
}

// ── 5. appliquerTemoin : ne retire que les contredites, nomme les autres ─────────────────────────────────────────────────────
{
    const T = fabriquerTemoinImages({ ligne: ligneIP, cartes: [grass, dcSquirtle, pikachu, squirtle] });
    const resolues = [
        { im: im('artofpkm/28/25.webp', '25', 'Double Colorless Energy', 'ダブル無色エネルギー'), c: grass, carteId: grass._id, preuve: 'numero' },
        { im: im('artofpkm/28/40.webp', '40', 'Pikachu', 'ピカチュウ'), c: pikachu, carteId: pikachu._id, preuve: 'numero' }];
    const r = appliquerTemoin(resolues, T);
    verifier('appliquerTemoin : 1 gardée (Pikachu), 1 contredite (Basic Grass Energy)', [r.gardees.map(x => x.carteId), r.contredites.map(x => x.carteId)], [[20368], [60754]]);
    verifier('appliquerTemoin : la contredite porte sa raison et ses témoins', [r.contredites[0].verdict.regle, r.contredites[0].verdict.autres.map(a => a._id)], ['nom-contredit-par-une-carte-au-meme-numero', [11408]]);
    verifier('appliquerTemoin sans témoin (null) : rien ne change', appliquerTemoin(resolues, null).gardees.length, 2);
}

// ── 6. CÂBLAGE : la jointure appelle le témoin, et l'unité surveillée par la garde du worker est déclarée ────────────────────────
{
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('./collecteur-images.js'), 'utf8');
    verifier('collecteur-images.js importe et applique le témoin', [/temoin-images-artofpkm/.test(src), /appliquerTemoin\(/.test(src), /image-contredite-par-le-nom/.test(src)], [true, true, true]);
    const regles = fs.readFileSync(require.resolve('./remettre-en-file.js'), 'utf8');
    verifier('remettre-en-file.js surveille collecte-cartes/temoin-images-artofpkm.js', /'collecte-cartes\/temoin-images-artofpkm\.js'/.test(regles), true);
}

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
