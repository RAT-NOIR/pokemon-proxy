// BANC — poser-fiches-prouvees.js : une fiche (ligne cartes_produits) posée d'une LISTE FERMÉE, prouvée par DEUX éléments indépendants + le témoin du nom de joindre().
//   node test-poser-fiches-prouvees.js
const { prouver, VOIES } = require('./collecte-cartes/fiches-prouvees');
const { planifier, verifierAttendu, ecrireFiches, DECISIONS } = require('./poser-fiches-prouvees');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const carte = (id, nomEn, attaques, impressions, extra = {}) => ({ _id: id, nomEn, niveau: null, attaques: attaques.map(nom => ({ nom })), impressions, sets: [], liens: { idProduct: [1], idMetacards: [500] }, ...extra });
const produit = (idProduct, name, numero, idMetacard = 500) => {
    const { decomposerNomCardmarket } = require('./collecte-cartes/jointure');
    const d = decomposerNomCardmarket(name);
    return { idProduct, idExpansion: 9, idMetacard, name, nom: d.nom, attaques: d.attaques, niveau: d.niveau, numero, slug: `s-${idProduct}`, slugSet: 'Le-Set' };
};
const imp = (tirage, expansion, numero, total = null) => ({ tirage, expansion, numero, total });

// ── voie « impression-numero » : la carte déclare, dans CE tirage, une impression au MÊME numéro que le produit (suffixe gardé)
const togepi = carte(10, 'Togepi GX', ['Rolling Panic'], [imp('intl', 'Cosmic', '143', '236'), imp('intl', 'Yellow A Alternate cards', '143a', '236')]);
const pTog = produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '143a');
const E1 = { idProduct: 20, carteId: 10, voie: 'impression-numero', tirage: 'intl', expansionImpression: ['Cosmic', 'Yellow A', 'Yellow A Alternate cards'] };
const ctx = (cartes, extra = {}) => ({ cartesDuSet: cartes, cartesPourCle: cartes, etatSetlist: null, ...extra });
const bon = prouver({ entree: E1, produit: pTog, carte: togepi, ...ctx([togepi]) });
verifier('impression-numero : nom+attaques, métacarte, témoin du nom et impression au même numéro → prouvé', [bon.ok, bon.temoins.length >= 4], [true, true]);
// (tour 2, 2026-11-02) la TABLE FERMÉE des produits en matière spéciale (metal, lenticulaire) : jamais la fiche de la carte normale, quelle que soit la voie
verifier('matière spéciale : 859012 (lenticulaire, MEP) refusé « matiere-speciale » même quand tout le reste concorde', (() => { const r = prouver({ entree: { ...E1, idProduct: 859012 }, produit: produit(859012, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '143a'), carte: togepi, ...ctx([togepi]) }); return [r.ok, /matiere-speciale/.test(r.refus.join())]; })(), [false, true]);
verifier('matière spéciale : 580162 (métal doré) refusé aussi par la voie du tirage', (() => { const pal = carte(70, 'Palkia', ['Spacial Rend'], [imp('jp', 'Palkia Deck', null)], { liens: { idProduct: [4], idMetacards: [500] } }); const r = prouver({ entree: { idProduct: 580162, carteId: 70, voie: 'impression-du-tirage', tirage: 'jp', expansionImpression: 'Palkia Deck' }, produit: produit(580162, 'Palkia [Spacial Rend]', null), carte: pal, ...ctx([pal]) }); return [r.ok, /matiere-speciale/.test(r.refus.join())]; })(), [false, true]);
verifier('matière spéciale : le même cas avec un produit ordinaire (20) reste prouvé', prouver({ entree: E1, produit: pTog, carte: togepi, ...ctx([togepi]) }).ok, true);
verifier('impression-numero : le numéro du produit est celui d\'une AUTRE impression (143 ≠ 143a) → refus', prouver({ entree: E1, produit: produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '144a'), carte: togepi, ...ctx([togepi]) }).ok, false);
verifier('la métacarte du produit n\'est pas celle de la carte → refus nommé', (() => { const r = prouver({ entree: E1, produit: produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '143a', 999), carte: togepi, ...ctx([togepi]) }); return [r.ok, /métacarte/.test(r.refus.join())]; })(), [false, true]);
verifier('des attaques qui ne sont pas celles du produit → refus', prouver({ entree: E1, produit: produit(20, 'Togepi GX [Autre | Supreme Puff GX]', '143a'), carte: togepi, ...ctx([togepi]) }).ok, false);
verifier('un nom qui n\'est pas celui de la carte → refus (le témoin du nom ne dort pas)', prouver({ entree: E1, produit: produit(20, 'Pichu [Rolling Panic | Supreme Puff GX]', '143a'), carte: togepi, ...ctx([togepi]) }).ok, false);
verifier('un homonyme aux mêmes attaques déclare AUSSI le numéro 143a → deux candidates, refus (un doute est un refus)', (() => {
    const autre = carte(11, 'Togepi GX', ['Rolling Panic'], [imp('intl', 'Yellow A Alternate cards', '143a', '236')], { liens: { idProduct: [2], idMetacards: [501] } });
    const r = prouver({ entree: E1, produit: pTog, carte: togepi, cartesDuSet: [togepi, autre], cartesPourCle: [togepi, autre], etatSetlist: null });
    return [r.ok, /candidate/.test(r.refus.join())];
})(), [false, true]);

// ── (tour 1 du coordinateur, 2026-11-02) « impression-numero » compare AUSSI l'EXPANSION : un numéro qui est celui d'une impression d'un AUTRE set du même tirage ne prouve rien
//    (les 4 cas vus au lot b-lignes : Mareep svB n°009, Poké Ball s8a-G n°011, Energy Switch SV-P/CS n°031, Teal Mask Ogerpon ex CSV9.5C n°256)
{
    const cas = [
        ['Mareep svB', 'jp', 'Premium Trainer Box ex', 'Mareep [Rear Kick | Electro Ball]', '009', ['Rear Kick', 'Electro Ball'], [imp('jp', 'Premium Trainer Box ex', '008', '028'), imp('jp', 'Sword & Shield Family Pokémon Card Game', '009')]],
        ['Poké Ball s8a-G', 'jp', '25th Anniversary Golden Box', 'Poké Ball', '011', [], [imp('jp', '25th Anniversary Golden Box', '002', '015'), imp('jp', 'Autre set', '011')]],
        ['Energy Switch SV-P/CS', 'zh-hans', 'SV-P Promotional cards', 'Energy Switch', '031', [], [imp('zh-hans', 'SV-P Promotional cards', '293'), imp('zh-hans', 'Gem Pack Vol. 1', '031')]],
        ['Ogerpon ex CSV9.5C', 'zh-hans', 'Terastal Gathering', 'Teal Mask Ogerpon ex [Teal Dance | Myriad Leaf Shower]', '256', ['Teal Dance', 'Myriad Leaf Shower'], [imp('zh-hans', 'Terastal Gathering', '222'), imp('zh-hans', 'Autre set', '256')]]
    ];
    cas.forEach(([quoi, tirage, expo, nom, numero, attaques, imps], i) => {
        const c = carte(300 + i, nom.replace(/ \[.*$/, ''), attaques, imps), p = produit(310 + i, nom, numero);
        const r = prouver({ entree: { idProduct: 310 + i, carteId: 300 + i, voie: 'impression-numero', tirage, expansionImpression: expo }, produit: p, carte: c, ...ctx([c]) });
        verifier(`impression-numero : ${quoi} — le numéro ${numero} est celui d'une impression d'un AUTRE set du tirage → refus « impression-autre-expansion »`, [r.ok, /impression-autre-expansion/.test(r.refus.join())], [false, true]);
        const bonne = prouver({ entree: { idProduct: 310 + i, carteId: 300 + i, voie: 'impression-numero', tirage, expansionImpression: expo }, produit: p, carte: { ...c, impressions: [...imps, imp(tirage, expo, numero)] }, ...ctx([c]) });
        verifier(`impression-numero : ${quoi} — la même carte avec une impression de CE set au n°${numero} → prouvé`, bonne.ok, true);
    });
    verifier('impression-numero : une entrée SANS expansion déclarée est refusée (une garde s\'écrit par ce qu\'elle autorise)', (() => { const { expansionImpression, ...nue } = E1; const r = prouver({ entree: nue, produit: pTog, carte: togepi, ...ctx([togepi]) }); return [r.ok, /expansion/.test(r.refus.join())]; })(), [false, true]);
    verifier('impression-numero : l\'expansion déclarée peut être une liste (les noms d\'expansion d\'un set)', prouver({ entree: { ...E1, expansionImpression: ['Cosmic', 'Yellow A Alternate cards'] }, produit: pTog, carte: togepi, ...ctx([togepi]) }).ok, true);
}

// ── voie « impression-equivalente » : S01 ↔ 001/029 d'une AUTRE extension de la carte (calibrée)
const bulba = carte(30, 'Bulbasaur', ['Tackle', 'Poison Seed'], [imp('jp', 'Pokémon-e Starter Deck', '001', '029')], { liens: { idProduct: [7], idMetacards: [212830] } });
const voisine = carte(31, 'Bulbasaur', ['First Aid', 'Poison Seed'], [imp('jp', 'Quick Starter Gift Set', null)], { liens: { idProduct: [8], idMetacards: [335496] } });
const E2 = { idProduct: 40, carteId: 30, voie: 'impression-equivalente', tirage: 'jp', expansionImpression: 'Pokémon-e Starter Deck', prefixe: 'S', total: '029' };
const pBul = produit(40, 'Bulbasaur [Tackle | Poison Seed]', 'S01', 212830);
verifier('impression-equivalente : S01 ↔ 001/029 de « Pokémon-e Starter Deck », une voisine qui partage une attaque ne bloque PAS (la clé n\'est pas le nom seul)', prouver({ entree: E2, produit: pBul, carte: bulba, ...ctx([bulba, voisine]) }).ok, true);
verifier('impression-equivalente : S02 contre la carte 001 → refus', prouver({ entree: E2, produit: produit(40, 'Bulbasaur [Tackle | Poison Seed]', 'S02', 212830), carte: bulba, ...ctx([bulba, voisine]) }).ok, false);
verifier('impression-equivalente : le total imprimé diffère (028 ≠ 029) → refus', prouver({ entree: { ...E2, total: '028' }, produit: pBul, carte: bulba, ...ctx([bulba, voisine]) }).ok, false);

// ── faute de frappe de Cardmarket (« Hyptnotic Gaze »), DÉCLARÉE par la décision et vérifiée : la même attaque à une lettre près, sur une carte dont la métacarte concorde
const chiko = carte(35, 'Chikorita', ['Hypnotic Gaze', 'Double Scratch'], [imp('jp', 'Pokémon-e Starter Deck', '005', '029')], { liens: { idProduct: [3], idMetacards: [212835] } });
const pChiko = produit(45, 'Chikorita [Hyptnotic Gaze | Double Scratch]', 'S05', 212835);
const E2b = { idProduct: 45, carteId: 35, voie: 'impression-equivalente', tirage: 'jp', expansionImpression: 'Pokémon-e Starter Deck', prefixe: 'S', total: '029' };
verifier('faute de frappe NON déclarée : le produit ne désigne pas la carte → refus (la clé ne devine pas)', prouver({ entree: E2b, produit: pChiko, carte: chiko, ...ctx([chiko]) }).ok, false);
verifier('faute de frappe déclarée et vérifiée (distance 1) : prouvé, la faute est écrite dans les témoins', (() => { const r = prouver({ entree: { ...E2b, fautesDeFrappe: [['Hyptnotic Gaze', 'Hypnotic Gaze']] }, produit: pChiko, carte: chiko, ...ctx([chiko]) }); return [r.ok, r.temoins.some(t => /faute de frappe/.test(t))]; })(), [true, true]);
verifier('faute déclarée mais l\'écart dépasse UNE lettre → refus (ce n\'est plus une faute de frappe)', prouver({ entree: { ...E2b, fautesDeFrappe: [['Hyptnotic Gaze', 'Sleep Powder']] }, produit: pChiko, carte: { ...chiko, attaques: [{ nom: 'Sleep Powder' }, { nom: 'Double Scratch' }] }, ...ctx([chiko]) }).ok, false);
verifier('faute déclarée que le produit ne porte pas → refus nommé', (() => { const r = prouver({ entree: { ...E2b, fautesDeFrappe: [['Gaze Hypnotic', 'Hypnotic Gaze']] }, produit: pChiko, carte: chiko, ...ctx([chiko]) }); return [r.ok, /faute de frappe/.test(r.refus.join())]; })(), [false, true]);
verifier('la métacarte reste exigée avec une faute de frappe (le témoin n\'est pas levé)', prouver({ entree: { ...E2b, fautesDeFrappe: [['Hyptnotic Gaze', 'Hypnotic Gaze']] }, produit: produit(45, 'Chikorita [Hyptnotic Gaze | Double Scratch]', 'S05', 1), carte: chiko, ...ctx([chiko]) }).ok, false);

// ── voie « setlist » : la Setlist lue porte CE nom à CE numéro (page réelle = la carte, ou lien rouge sans page réelle ailleurs)
const drif = carte(50, 'Drifblim FB', ['Shadow Ball'], [imp('jp', 'Beat', '038', '100')], { niveau: '50', liens: { idProduct: [9], idMetacards: [216555, 216554] } });
const pDrif = produit(51, 'Drifblim [FB] Lv.50 [Pump Up | Shadow Ball]', '050', 216554);
const E3 = { idProduct: 51, carteId: 50, voie: 'setlist', tirage: 'jp', slugSetlist: 'Beat' };
const setlist = pages => ({ pages });
verifier('setlist : [FB] est un suffixe du nom, Lv.50 = niveau de la carte, la Setlist nomme la page de la carte au n°50 → prouvé', prouver({ entree: E3, produit: pDrif, carte: drif, ...ctx([drif], { etatSetlist: setlist([{ titre: 'Drifblim FB (Beat 50)', pageid: 50, etat: 'ok' }]) }) }).ok, true);
verifier('setlist : la page nommée au n°50 est celle d\'une AUTRE carte → refus', prouver({ entree: E3, produit: pDrif, carte: drif, ...ctx([drif], { etatSetlist: setlist([{ titre: 'Drifblim FB (Beat 50)', pageid: 77, etat: 'ok' }]) }) }).ok, false);
verifier('setlist : aucune entrée à ce numéro → refus', prouver({ entree: E3, produit: pDrif, carte: drif, ...ctx([drif], { etatSetlist: setlist([{ titre: 'Drifblim FB (Beat 51)', pageid: 50, etat: 'ok' }]) }) }).ok, false);
verifier('setlist : pas de Setlist lue → refus nommé', (() => { const r = prouver({ entree: E3, produit: pDrif, carte: drif, ...ctx([drif]) }); return [r.ok, /Setlist/.test(r.refus.join())]; })(), [false, true]);
verifier('setlist : le niveau du produit contredit celui de la carte (Lv.50 ≠ 51) → refus', prouver({ entree: E3, produit: pDrif, carte: { ...drif, niveau: '51' }, ...ctx([drif], { etatSetlist: setlist([{ titre: 'Drifblim FB (Beat 50)', pageid: 50, etat: 'ok' }]) }) }).ok, false);
const tox = carte(60, 'Toxtricity ex', ['Strumming Thunder'], [imp('intl', 'SVP', '215')], { liens: { idProduct: [3], idMetacards: [445718] } });
const pTox = produit(61, 'Toxtricity ex [Strumming Thunder]', '253', 445718);
const E4 = { idProduct: 61, carteId: 60, voie: 'setlist', tirage: 'th', slugSetlist: 'Thai' };
verifier('setlist : lien rouge au bon nom et au bon numéro, aucune page réelle de ce nom dans la liste → prouvé', prouver({ entree: E4, produit: pTox, carte: tox, ...ctx([tox], { etatSetlist: setlist([{ titre: 'Toxtricity ex (SV-P Promo 253)', pageid: null, etat: 'manquant' }]) }) }).ok, true);
verifier('setlist : lien rouge, mais une page réelle du même nom existe ailleurs dans la liste → refus', prouver({ entree: E4, produit: pTox, carte: tox, ...ctx([tox], { etatSetlist: setlist([{ titre: 'Toxtricity ex (SV-P Promo 253)', pageid: null, etat: 'manquant' }, { titre: 'Toxtricity ex (SV-P Promo 100)', pageid: 60, etat: 'ok' }]) }) }).ok, false);

// ── voie « impression-du-tirage » : produit SANS numéro ; la carte déclare l'expansion du set ; elle est la SEULE candidate à la déclarer
const pal = carte(70, 'Palkia', ['Spacial Rend', 'Transback'], [imp('jp', 'Palkia Deck', null)], { niveau: '67', liens: { idProduct: [4], idMetacards: [215371] } });
const palX = carte(71, 'Palkia', ['Spacial Rend', 'Transback'], [imp('jp', 'Autre', '030')], { liens: { idProduct: [5], idMetacards: [215371] } });
const pPal = produit(72, 'Palkia Lv.67 [Spacial Rend | Transback]', null, 215371);
const E5 = { idProduct: 72, carteId: 70, voie: 'impression-du-tirage', tirage: 'jp', expansionImpression: 'Palkia Deck' };
verifier('impression-du-tirage : produit sans numéro, la carte déclare l\'expansion et est la seule des candidates à la déclarer → prouvé', prouver({ entree: E5, produit: pPal, carte: pal, ...ctx([pal, palX]) }).ok, true);
verifier('impression-du-tirage : DEUX candidates déclarent l\'expansion → refus', prouver({ entree: E5, produit: pPal, carte: pal, ...ctx([pal, { ...palX, impressions: [imp('jp', 'Palkia Deck', null)] }]) }).ok, false);
verifier('impression-du-tirage : le produit porte un numéro → refus (ce n\'est pas cette voie)', prouver({ entree: E5, produit: { ...pPal, numero: '12' }, carte: pal, ...ctx([pal, palX]) }).ok, false);
verifier('une voie inconnue → refus nommé (liste fermée)', (() => { const r = prouver({ entree: { ...E5, voie: 'devine' }, produit: pPal, carte: pal, ...ctx([pal]) }); return [r.ok, /voie/.test(r.refus.join())]; })(), [false, true]);
verifier('les voies sont une liste fermée de cinq (la 5e, « deux-sources », est bancée par test-voie-deux-sources.js)', VOIES, ['impression-numero', 'impression-equivalente', 'setlist', 'impression-du-tirage', 'deux-sources']);

// ── API-52 L3 : deux déclarations FERMÉES, par entrée de décision, jamais par défaut
// (1) `prefixeNumero` : la carte écrit son numéro AVEC le préfixe du set (« XY177a »), Cardmarket le sien SANS (« 177a ») — comme `prefixe` de la voie « impression-equivalente », le préfixe est DÉCLARÉ.
const karen = carte(80, 'Karen', [], [imp('intl', 'XY Black Star Promos', 'XY177'), imp('intl', 'Yellow A Alternate cards', 'XY177a')], { liens: { idProduct: [1], idMetacards: [223881] } });
const pKaren = produit(81, 'Karen', '177a', 223881);
const EK = { idProduct: 81, carteId: 80, voie: 'impression-numero', tirage: 'intl', expansionImpression: 'Yellow A Alternate cards' };
verifier('prefixeNumero : sans la déclaration, « 177a » ne désigne pas « XY177a » (refus, rien n\'est deviné)', prouver({ entree: EK, produit: pKaren, carte: karen, ...ctx([karen]) }).ok, false);
verifier('prefixeNumero : déclaré « XY », « 177a » = « XY177a » et la lettre compte (XY177 ≠ XY177a) → prouvé', [prouver({ entree: { ...EK, prefixeNumero: 'XY' }, produit: pKaren, carte: karen, ...ctx([karen]) }).ok, prouver({ entree: { ...EK, prefixeNumero: 'XY' }, produit: pKaren, carte: { ...karen, impressions: [imp('intl', 'XY Black Star Promos', 'XY177')] }, ...ctx([karen]) }).ok], [true, false]);
verifier('prefixeNumero : un mauvais préfixe (« SM ») refuse', prouver({ entree: { ...EK, prefixeNumero: 'SM' }, produit: pKaren, carte: karen, ...ctx([karen]) }).ok, false);
verifier('prefixeNumero : une homonyme qui déclare AUSSI XY177a → deux candidates, refus (la concurrence se juge avec le même préfixe)', (() => {
    const autre = carte(82, 'Karen', [], [imp('intl', 'Yellow A Alternate cards', 'XY177a')], { liens: { idProduct: [2], idMetacards: [223881] } });
    return prouver({ entree: { ...EK, prefixeNumero: 'XY' }, produit: pKaren, carte: karen, ...ctx([karen, autre]) }).ok;
})(), false);
// (2) `metacarteAbsenteDeLaCarte` : la carte ne porte AUCUNE métacarte (rien à contredire) ; le témoin parle alors par les deux autres éléments et la seconde source de la décision. Une carte qui en porte une, fausse, refuse toujours.
const lusa = carte(90, 'Lusamine', [], [imp('intl', 'Yellow A Alternate cards', '153a', '156')], { liens: { idProduct: [1], idMetacards: [] } });
const pLusa = produit(91, 'Lusamine', '153a', 234656);
const EL = { idProduct: 91, carteId: 90, voie: 'impression-numero', tirage: 'intl', expansionImpression: 'Yellow A Alternate cards' };
verifier('metacarteAbsenteDeLaCarte : sans la déclaration, la carte sans métacarte refuse (le témoin ne peut pas parler)', (() => { const r = prouver({ entree: EL, produit: pLusa, carte: lusa, ...ctx([lusa]) }); return [r.ok, /métacarte/.test(r.refus.join())]; })(), [false, true]);
verifier('metacarteAbsenteDeLaCarte : déclarée et la carte n\'en porte aucune → prouvé, le témoin DIT qu\'il n\'a pas parlé', (() => { const r = prouver({ entree: { ...EL, metacarteAbsenteDeLaCarte: true }, produit: pLusa, carte: lusa, ...ctx([lusa]) }); return [r.ok, r.temoins.some(t => /aucune métacarte/.test(t))]; })(), [true, true]);
verifier('metacarteAbsenteDeLaCarte : déclarée mais la carte porte UNE AUTRE métacarte → refus (la déclaration ne lève pas une contradiction)', prouver({ entree: { ...EL, metacarteAbsenteDeLaCarte: true }, produit: pLusa, carte: { ...lusa, liens: { idProduct: [1], idMetacards: [999] } }, ...ctx([lusa]) }).ok, false);
verifier('metacarteAbsenteDeLaCarte : n\'ouvre que la métacarte — un nom ou des attaques faux refusent toujours', prouver({ entree: { ...EL, metacarteAbsenteDeLaCarte: true }, produit: produit(91, 'Gladion', '153a', 234656), carte: lusa, ...ctx([lusa]) }).ok, false);

// ═════ TOUR 1 — les trois mutants qui survivaient ═════
// (a) LE TÉMOIN DU NOM DE PRODUCTION : par construction il ne contredit jamais une carte que la clé vient de désigner (mêmes clés de nom) ; il ne se prouve donc qu'en
//     l'observant : `prouver` reçoit la fonction (par défaut la fonction de PRODUCTION, vérifiée par identité) et un espion voit ce qu'on lui demande.
const { TEMOIN_PRODUCTION } = require('./collecte-cartes/fiches-prouvees');
verifier('le témoin par défaut EST temoinDuNom de joindre(), pas une copie', TEMOIN_PRODUCTION === require('./collecte-cartes/jointure').temoinDuNom, true);
verifier('un témoin qui contredit refuse, et le dit', (() => { const r = prouver({ entree: E1, produit: pTog, carte: togepi, ...ctx([togepi]), temoin: () => () => [{ _id: 99, nomEn: 'Autre' }] }); return [r.ok, /témoin du nom/.test(r.refus.join())]; })(), [false, true]);
verifier('le témoin est APPELÉ avec l\'expansion du produit, la carte et la variante du nom ; sans contradiction → prouvé', (() => {
    const vu = []; const r = prouver({ entree: E1, produit: pTog, carte: togepi, ...ctx([togepi]), temoin: (jeu, exp) => (c, p) => { vu.push([jeu.map(x => x._id), exp, c._id, p.nom]); return null; } });
    return [r.ok, vu];
})(), [true, [[[10], 9, 10, 'Togepi GX']]]);
// (b) LE SUFFIXE DU NUMÉRO : 143a n'est jamais 143, dans aucun sens
const seule143 = carte(10, 'Togepi GX', ['Rolling Panic'], [imp('intl', 'Cosmic', '143', '236')]);
const seule143a = carte(10, 'Togepi GX', ['Rolling Panic'], [imp('intl', 'Yellow A', '143a', '236')]);
verifier('le produit 143a ne s\'accroche JAMAIS à une carte qui ne déclare que 143', prouver({ entree: E1, produit: pTog, carte: seule143, ...ctx([seule143]) }).ok, false);
verifier('le produit 143 ne s\'accroche JAMAIS à une carte qui ne déclare que 143a', prouver({ entree: E1, produit: produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '143'), carte: seule143a, ...ctx([seule143a]) }).ok, false);
verifier('les zéros de tête ne comptent pas (0143a = 143a), la lettre compte', [prouver({ entree: E1, produit: produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '0143a'), carte: seule143a, ...ctx([seule143a]) }).ok, prouver({ entree: E1, produit: produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '143b'), carte: seule143a, ...ctx([seule143a]) }).ok], [true, false]);
// (c) LA BORNE DE LA FAUTE DE FRAPPE : une lettre passe, deux lettres refusent, zéro (déclarée à tort) passe
const faute = (mal, bien) => prouver({ entree: { ...E2b, fautesDeFrappe: [[mal, bien]] }, produit: produit(45, `Chikorita [${mal} | Double Scratch]`, 'S05', 212835), carte: chiko, ...ctx([chiko]) }).ok;
verifier('faute : distance 1 passe, distance 2 refuse (Hyptntic ≠ Hypnotic), distance 0 passe', [faute('Hyptnotic Gaze', 'Hypnotic Gaze'), faute('Hyptntic Gaze', 'Hypnotic Gaze'), faute('Hypnotic Gaze', 'Hypnotic Gaze')], [true, false, true]);

// (d) L'APPARTENANCE AU SET : seulement quand la règle R de PRODUCTION l'autorise ; les lignes s'écrivent quand même
const { appartenances, relire } = require('./poser-fiches-prouvees');
const RR = require('./collecte-cartes/regle-r-fiches');
const lignesP = [{ _id: '1|10', carteId: 1, idProduct: 10, slugSet: 'S-A' }, { _id: '2|11', carteId: 2, idProduct: 11, slugSet: 'S-B' }, { _id: '3|12', carteId: 3, idProduct: 12, slugSet: 'S-C' }];
const ents = [{ idProduct: 10, carteId: 1, code: 'A', slugSet: 'S-A', ajoutSet: true }, { idProduct: 11, carteId: 2, code: 'B', slugSet: 'S-B', ajoutSet: true }, { idProduct: 12, carteId: 3, code: 'C', slugSet: 'S-C', ajoutSet: false }];
const jugeStub = (e) => (e.code === 'A' ? { autorise: true, regle: 'R2', cause: 'C3a', raison: 'ok' } : { autorise: false, regle: null, cause: 'C4a', raison: 'non' });
const ap = appartenances({ entrees: ents, lignes: lignesP, juger: jugeStub });
verifier('appartenance : seule la décision AUTORISÉE par R ajoute le set ; l\'autre est refusée avec sa cause ; sans ajoutSet, R n\'est pas consultée', [[...ap.ajouts].map(([c, s]) => [c, [...s]]), ap.decisions.map(d => [d.idProduct, d.autorise, d.cause])], [[[1, ['S-A']]], [[10, true, 'C3a'], [11, false, 'C4a']]]);
verifier('appartenance : les compteurs sont séparés (autorisées / refusées par cause)', [ap.autorisees, ap.refusees, ap.parCause], [1, 1, { C4a: 1 }]);
// la règle R RÉELLE (jugerRegleR de regle-r-fiches.js), sur un contexte fabriqué : Setlist vide → C4b, lien rouge au bon nom et numéro → C3a (R2), jamais une copie
const siteFaux = { tirageDuSet: s => s.tirage, expansionsDuSet: s => [].concat(s.bulba.expansion), normaliserNumero: n => (n == null ? null : String(n).replace(/^0+/, '')) };
const setDoc = { _id: 'S-T', tirage: 'th', bulba: { expansion: 'Promo' } };
const ctxR = (pages) => RR.construireContexte({ cartes: [{ _id: 60, nomEn: 'Toxtricity ex', sets: [], impressions: [] }], lignes: [], etats: pages ? [{ _id: 'S-T', pages }] : [], sets: [setDoc] }, siteFaux);
const LR = { code: 'T', slugSet: 'S-T', bulba: { tirage: 'th', expansion: 'Promo' }, verifie: { le: '2026-10-17', page: 'P' } };
const jr = pages => RR.jugerRegleR(ctxR(pages), { L: LR, p: { numero: '253' }, X: { _id: 60, nomEn: 'Toxtricity ex', sets: [] }, numDe: new Map() });
verifier('R réelle : aucune Setlist lue → bloque (C4b)', [jr(null).autorise, jr(null).cause], [false, 'C4b']);
verifier('R réelle : lien rouge au bon nom et au bon numéro → R2 autorise', [jr([{ titre: 'Toxtricity ex (Promo 253)', etat: 'manquant', pageid: null }]).autorise, jr([{ titre: 'Toxtricity ex (Promo 253)', etat: 'manquant', pageid: null }]).regle], [true, 'R2']);

// ── planifier : une ligne par produit prouvé, des REFUS nommés, des « déjà » jamais réécrits
const entrees = [E1, { ...E5, idProduct: 72 }];
const lecture = { cartes: [togepi, pal, palX], produits: new Map([[9, [pTog, pPal]]]), existants: new Map(), etats: new Map() };
const p1 = planifier({ entrees: [{ ...E1, idExpansion: 9, slugSet: 'Le-Set', numeroFiche: '143a' }], lecture });
verifier('planifier : la ligne posée porte ses témoins, sa route, son numeroFiche', p1.lignes.map(l => [l._id, l.carteId, l.idProduct, l.idExpansion, l.slugSet, l.tirage, l.numeroFiche, l.preuve, typeof l.detail]), [['10|20', 10, 20, 9, 'Le-Set', 'intl', '143a', 'fiche-prouvee', 'string']]);
verifier('planifier : un produit prouvé fautif est un REFUS, jamais une ligne', (() => { const p = planifier({ entrees: [{ ...E1, idExpansion: 9, slugSet: 'Le-Set', numeroFiche: null, idProduct: 20, carteId: 70 }], lecture }); return [p.lignes.length, p.refus.length]; })(), [0, 1]);
verifier('planifier : une ligne qui existe déjà n\'est pas réécrite (comptée « deja »)', (() => { const p = planifier({ entrees: [{ ...E1, idExpansion: 9, slugSet: 'Le-Set', numeroFiche: '143a' }], lecture: { ...lecture, existants: new Map([['10|20', { preuve: 'autre' }]]) } }); return [p.lignes.length, p.deja.map(d => d.preuve)]; })(), [0, ['autre']]);
verifier('planifier : un produit qui a DÉJÀ une ligne (autre carte) → refus : on ne pose que des lignes absentes', (() => { const p = planifier({ entrees: [{ ...E1, idExpansion: 9, slugSet: 'Le-Set', numeroFiche: '143a' }], lecture: { ...lecture, lignesDuProduit: new Map([[20, ['99|20']]]) } }); return [p.lignes.length, p.refus.length]; })(), [0, 1]);
verifier('planifier : un produit absent du catalogue de l\'expansion → refus', (() => { const p = planifier({ entrees: [{ ...E1, idProduct: 404, idExpansion: 9, slugSet: 'Le-Set', numeroFiche: null }], lecture }); return [p.lignes.length, p.refus.length]; })(), [0, 1]);
verifier('--attendu : le bon nombre passe, un autre ou l\'absence refuse', [verifierAttendu(p1, 1).ok, verifierAttendu(p1, 2).ok, verifierAttendu(p1, undefined).ok], [true, false, false]);
verifier('la décision du jour est une liste fermée de 8 produits distincts', (() => { const d = DECISIONS['2026-10-17']; return [d.length, new Set(d.map(x => x.idProduct)).size]; })(), [8, 8]);
// lot c-0211 (chasseur niveau c, 2026-11-02) : 24 EC1 S-xx (voie impression-equivalente, comme S01/S05/S07/S19) + Blaine's Quiz #3 G2 (impression-du-tirage) ; Moo-Moo Milk 654791 EXCLU (métacarte absente de la carte)
verifier('décision 2026-11-02-c-0211 : liste fermée de 25 produits distincts (24 EC1 + 605406), 654791 exclu, voies déclarées avec leur extension',
    (() => { const d = DECISIONS['2026-11-02-c-0211'] || []; return [d.length, new Set(d.map(x => x.idProduct)).size, d.some(x => x.idProduct === 654791), d.filter(x => x.code === 'EC1').every(x => x.voie === 'impression-equivalente' && x.expansionImpression === 'Pokémon-e Starter Deck' && x.prefixe === 'S' && x.total === '029'), d.find(x => x.idProduct === 605406)?.carteId]; })(),
    [25, 25, false, true, 25392]);
// lot d-0211 (chasseur niveau d, 2026-11-02) : 104 lignes (Unnumbered-Promos 54, XY-Promos 13, six Gym japonais 28, …), voies impression-du-tirage (extension déclarée) et impression-numero (extension lue de la ligne de table)
// 554185 (→ carte 192356) RETIRÉ : ligne détachée par décision du testeur (reste « fiche-contredite-par-la-vue ») ; le filet de lignes-detachees l'a refusée au lot du 02/11
verifier('décision 2026-11-02-d-0211 : liste fermée de 103 produits distincts ; toute voie impression-du-tirage nomme son extension ; Vivillon, les 2 Mewtwo ambigus (576706, 654096) et 554185 (détachée par le testeur) exclus',
    (() => { const d = DECISIONS['2026-11-02-d-0211'] || []; return [d.length, new Set(d.map(x => x.idProduct)).size, d.filter(x => x.voie === 'impression-du-tirage').every(x => typeof x.expansionImpression === 'string' && x.expansionImpression !== ''), d.every(x => ['impression-du-tirage', 'impression-numero'].includes(x.voie)), d.some(x => [576706, 654096, 554185].includes(x.idProduct))]; })(),
    [103, 103, true, true, false]);
// (décision de l'utilisateur, 2026-11-02) les 4 « a » posés avant la garde d'expansion DÉCLARENT l'impression « Yellow A Alternate cards » que leur carte porte (numéro suffixé « a »)
verifier('les 4 Yellow A Alternate (Togepi 143a, Karen XY177a, Lusamine 153a ×2) déclarent expansionImpression « Yellow A Alternate cards »',
    [582672, 311408, 449878, 449883].map(id => Object.values(DECISIONS).flat().find(x => x.idProduct === id)?.expansionImpression ?? null),
    ['Yellow A Alternate cards', 'Yellow A Alternate cards', 'Yellow A Alternate cards', 'Yellow A Alternate cards']);

// ── API-52 L3 (décision 2026-10-25) : seulement les produits à DEUX sources concordantes ; Jirachi 877355 et Sonia 653505 (Cardmarket seul) en sont EXCLUS
verifier('décision 2026-10-25 : liste fermée de 3 produits exactement (Karen, 2 Lusamine) ; Jirachi, Sonia (une seule source) et Entei (les deux sources ne concordent pas sur le SET) exclus', (() => { const d = DECISIONS['2026-10-25'] || []; return [d.map(x => [x.idProduct, x.carteId]), new Set(d.map(x => x.idProduct)).size]; })(), [[[311408, 214539], [449878, 225372], [449883, 225372]], 3]);
verifier('décision 2026-10-25 : chaque entrée porte sa preuve (au moins 2 sources, références) et une voie connue', (() => { const { VOIES } = require('./collecte-cartes/fiches-prouvees'); return (DECISIONS['2026-10-25'] || []).map(x => [Array.isArray(x.preuve?.sources) && x.preuve.sources.length >= 2, Array.isArray(x.preuve?.references) && x.preuve.references.every(r => typeof r === 'string' && r.length > 10), VOIES.includes(x.voie)]); })(), [[true, true, true], [true, true, true], [true, true, true]]);
verifier('décision 2026-10-25 : les entrées passent le planificateur sans champ inconnu (la preuve ne fuit pas dans la ligne écrite)', (() => { const e = DECISIONS['2026-10-25'] || []; if (!e.length) return 'vide'; const x = e[0]; const lec = { cartes: [{ _id: x.carteId, nomEn: 'K', sets: [], liens: {} }], produits: new Map([[x.idExpansion, [{ idProduct: x.idProduct, name: 'Karen', numero: '177a', idMetacard: 1 }]]]), existants: new Map(), etats: new Map() }; const p = planifier({ entrees: [x], lecture: lec }); return p.lignes.every(l => !('preuve_sources' in l) && l.preuve === 'fiche-prouvee') ? 'ok' : 'fuite'; })(), 'ok');

// ── lot a-ebauches (2026-11-01) : Wartortle S19 et Bayleef S07 d'EC1 — les cartes EXISTENT et déclarent elles-mêmes « Pokémon-e Starter Deck » 019/029 et 007/029 (la voie de Bulbasaur S01) :
//    ce sont deux LIGNES qui manquent, pas deux fiches simples (une fiche simple ferait doublon avec la vraie carte)
const D11 = DECISIONS['2026-11-01-a-ebauches'] || [];
verifier('décision 2026-11-01-a-ebauches : liste fermée de 2 produits exactement (Wartortle S19 → 41112, Bayleef S07 → 30518), voie impression-equivalente d\'EC1', [D11.map(x => [x.idProduct, x.carteId, x.voie, x.slugSet, x.expansionImpression, x.prefixe, x.total, x.tirage]), new Set(D11.map(x => x.idProduct)).size],
    [[[654781, 41112, 'impression-equivalente', 'Base-Expansion-Pack', 'Pokémon-e Starter Deck', 'S', '029', 'jp'], [654769, 30518, 'impression-equivalente', 'Base-Expansion-Pack', 'Pokémon-e Starter Deck', 'S', '029', 'jp']], 2]);
verifier('décision 2026-11-01-a-ebauches : chaque entrée porte sa preuve écrite (≥ 2 sources, références)', D11.map(x => [Array.isArray(x.preuve?.sources) && x.preuve.sources.length >= 2, Array.isArray(x.preuve?.references) && x.preuve.references.length >= 1]), [[true, true], [true, true]]);
{
    // les fixtures reproduisent la base réelle lue le 2026-11-01 : cartes 41112 / 30518 et métacartes 212828 / 212807
    const wart = carte(41112, 'Wartortle', ['Doubleslap', 'Giant Wave'], [imp('intl', 'Expedition Base Set', '92', '165'), imp('jp', 'Pokémon-e Starter Deck', '019', '029')], { sets: ['Expedition-Base-Set'], liens: { idProduct: [274967], idMetacards: [212828] } });
    const bay = carte(30518, 'Bayleef', ['Mysterious Powder', 'Razor Leaf'], [imp('intl', 'Expedition Base Set', '71', '165'), imp('jp', 'Pokémon-e Starter Deck', '007', '029')], { sets: ['Expedition-Base-Set'], liens: { idProduct: [274946], idMetacards: [212807] } });
    const autreWart = carte(15236, 'Wartortle', ['Withdraw', 'Bite'], [imp('intl', 'Base Set', '42', '102')], { liens: { idProduct: [1], idMetacards: [9] } });
    const prodW = { ...produit(654781, 'Wartortle [Doubleslap | Giant Wave]', 'S19', 212828), idExpansion: 5021, slugSet: 'Base-Expansion-Pack' }, prodB = { ...produit(654769, 'Bayleef [Mysterious Powder | Razor Leaf]', 'S07', 212807), idExpansion: 5021, slugSet: 'Base-Expansion-Pack' };
    const lec = { cartes: [wart, bay, autreWart], produits: new Map([[5021, [prodW, prodB]]]), existants: new Map(), etats: new Map() };
    const p = planifier({ entrees: D11, lecture: lec });
    verifier('décision 2026-11-01-a-ebauches : planifiée sur la base lue, DEUX lignes « fiche-prouvee » (41112|654781, 30518|654769), aucun refus', [p.lignes.map(l => [l._id, l.preuve, l.slugSet, l.numeroFiche]), p.refus.length], [[['41112|654781', 'fiche-prouvee', 'Base-Expansion-Pack', null], ['30518|654769', 'fiche-prouvee', 'Base-Expansion-Pack', null]], 0]);
    verifier('décision 2026-11-01-a-ebauches : le numéro S19 contre la carte 007 (ou l\'autre total) est refusé — la voie ne se laisse pas tromper', planifier({ entrees: [{ ...D11[0], carteId: 30518 }], lecture: lec }).lignes.length, 0);
}

// ── lot b-lignes (2026-11-02) : 51 produits SANS LIGNE dont UNE carte, désignée par nom + attaques + métacarte, déclare elle-même l'impression du set (voie impression-du-tirage pour un produit
//    sans numéro, voie impression-numero pour un produit numéroté DONT LE NUMÉRO est celui d'une impression de l'expansion du set — vérifié à la main, la voie ne regarde que le tirage)
{
    const D12 = DECISIONS['2026-11-02-b-lignes'] || [];
    verifier('décision 2026-11-02-b-lignes : liste fermée de 43 produits distincts (les 8 produits en matière spéciale, retirés au tour 2, n\'y sont plus)', [D12.length, new Set(D12.map(x => x.idProduct)).size, D12.some(x => [859012, 873722, 851066, 873720, 873718, 580162, 720951, 804205].includes(x.idProduct))], [43, 43, false]);
    verifier('décision 2026-11-02-b-lignes : chaque entrée porte sa preuve écrite (≥ 2 sources, références) et aucune appartenance de set n\'est demandée', D12.length > 0 && D12.every(x => Array.isArray(x.preuve?.sources) && x.preuve.sources.length >= 2 && Array.isArray(x.preuve?.references) && x.preuve.references.length >= 1 && x.ajoutSet === false), true);
    verifier('décision 2026-11-02-b-lignes : seulement les deux voies par l\'impression que la carte déclare, jamais la Setlist ni une seconde source tierce', [...new Set(D12.map(x => x.voie))].sort(), ['impression-du-tirage', 'impression-numero']);
    verifier('décision 2026-11-02-b-lignes : une voie « impression-du-tirage » nomme l\'extension de l\'impression (sans elle la voie ne compare rien)', D12.length > 0 && D12.filter(x => x.voie === 'impression-du-tirage').every(x => typeof x.expansionImpression === 'string' && x.expansionImpression !== ''), true);
    verifier('décision 2026-11-02-b-lignes : les 7 Énergies de base de M-P (quatre séries de numéros possibles, ambiguës) et les 5 produits dont le slug porte un code d\'origine (Paldean Fates SVP 072/073, Pikachu CELBS-58 : route des réimpressions, la carte du slug n\'est pas celle du set) sont absents', D12.length > 0 && !D12.some(x => [912735, 912736, 912737, 912738, 912740, 912741, 912742, 866035, 866036, 866037, 580161, 605985].includes(x.idProduct)), true);
}

// l'argument --decision accepte le nom d'une décision à lettres (« 2026-11-01-a-ebauches ») : l'ancien motif ([\d-]+) la refusait comme « argument inconnu » AVANT de la chercher
(async () => {
    const { executer } = require('./poser-fiches-prouvees');
    const sorties = [];
    const code = await executer({ argv: ['--decision=2026-11-01-zzz-inconnue'], ouvrirLecture: async () => { throw new Error('ne doit pas ouvrir'); }, ouvrirEcriture: async () => { throw new Error('ne doit pas ouvrir'); }, log: () => { }, err: m => sorties.push(m) });
    verifier('--decision à lettres : acceptée par la ligne de commande (refusée ensuite comme DÉCISION inconnue, jamais comme argument inconnu)', [code, /argument inconnu/.test(sorties.join()), /décision « 2026-11-01-zzz-inconnue » inconnue/.test(sorties.join())], [2, false, true]);
    // clés héritées d'Object.prototype : DECISIONS[nom] y rend un objet truthy ; seule une clé PROPRE est une décision
    for (const nom of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
        const s = [];
        const c = await executer({ argv: [`--decision=${nom}`], ouvrirLecture: async () => { throw new Error('ne doit pas ouvrir'); }, ouvrirEcriture: async () => { throw new Error('ne doit pas ouvrir'); }, log: () => { }, err: m => s.push(m) });
        verifier(`--decision=${nom} : refusée comme décision inconnue, code 2, sans connexion`, [c, /inconnue/.test(s.join())], [2, true]);
    }
})();

(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_fiches_prouvees');
        await db.collection('cartes').insertMany([{ _id: 10, nomEn: 'Togepi GX', sets: ['A'], liens: { idProduct: [1, 2], idMetacards: [500] } }, { _id: 70, nomEn: 'Palkia', sets: ['B'], liens: { idProduct: [4], idMetacards: [215371] } }]);
        const lignes = [{ _id: '10|20', carteId: 10, idProduct: 20, idExpansion: 9, slugSet: 'A', tirage: 'intl', numeroFiche: '143a', preuve: 'fiche-prouvee' }, { _id: '70|72', carteId: 70, idProduct: 72, idExpansion: 9, slugSet: 'B', tirage: 'jp', numeroFiche: null, preuve: 'fiche-prouvee' }];
        const r = await ecrireFiches(db, lignes, new Map([[20, 500], [72, 215371]]), new Map([[70, ['B-neuf']]]));
        verifier('écriture : 2 lignes, 2 cartes touchées', r, { lignes: 2, cartes: 2 });
        const t = await db.collection('cartes').findOne({ _id: 10 });
        verifier('la carte reçoit l\'idProduct EN FIN (repère d\'adresse intact), sa métacarte déjà là n\'est pas doublée', t.liens, { idProduct: [1, 2, 20], idMetacards: [500] });
        verifier('l\'appartenance au set s\'AJOUTE (carte demandée), l\'autre carte garde ses sets', [(await db.collection('cartes').findOne({ _id: 70 })).sets, t.sets], [['B', 'B-neuf'], ['A']]);
        verifier('idempotente', await ecrireFiches(db, lignes, new Map([[20, 500], [72, 215371]]), new Map([[70, ['B-neuf']]])), { lignes: 0, cartes: 0 });
        await db.collection('cartes_produits').updateOne({ _id: '10|20' }, { $set: { preuve: 'autre' } });
        await ecrireFiches(db, lignes, new Map([[20, 500]]), new Map());
        verifier('une ligne posée entre-temps par un autre outil n\'est JAMAIS réécrite', (await db.collection('cartes_produits').findOne({ _id: '10|20' })).preuve, 'autre');
        // la RELECTURE après écriture : lignes, liens ET sets sur cartes, et le repère d'adresse (liens.idProduct[0]) inchangé
        const ok1 = await relire(db, lignes, new Map([[20, 500], [72, 215371]]), new Map([[70, ['B-neuf']]]), new Map([[10, 1], [70, 4]]));
        verifier('relecture : tout concorde (lignes, liens, métacartes, sets, repère)', [ok1.ok, ok1.lignes, ok1.cartes, ok1.reperesBouges], [true, '2/2', '2/2', []]);
        verifier('relecture : un repère d\'adresse qui a bougé est signalé', (await relire(db, lignes, new Map([[20, 500]]), new Map(), new Map([[10, 999]]))).ok, false);
        verifier('relecture : un set attendu mais absent est signalé', (await relire(db, lignes, new Map([[20, 500], [72, 215371]]), new Map([[70, ['jamais-pose']]]), new Map())).ok, false);
        verifier('l\'écriture sur cartes ne nomme ni nomEn ni autre champ que liens/sets (garde du site)', (await db.collection('cartes').findOne({ _id: 10 })).nomEn, 'Togepi GX');
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
