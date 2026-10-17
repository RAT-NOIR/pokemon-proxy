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
const E1 = { idProduct: 20, carteId: 10, voie: 'impression-numero', tirage: 'intl' };
const ctx = (cartes, extra = {}) => ({ cartesDuSet: cartes, cartesPourCle: cartes, etatSetlist: null, ...extra });
const bon = prouver({ entree: E1, produit: pTog, carte: togepi, ...ctx([togepi]) });
verifier('impression-numero : nom+attaques, métacarte, témoin du nom et impression au même numéro → prouvé', [bon.ok, bon.temoins.length >= 4], [true, true]);
verifier('impression-numero : le numéro du produit est celui d\'une AUTRE impression (143 ≠ 143a) → refus', prouver({ entree: E1, produit: produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '144a'), carte: togepi, ...ctx([togepi]) }).ok, false);
verifier('la métacarte du produit n\'est pas celle de la carte → refus nommé', (() => { const r = prouver({ entree: E1, produit: produit(20, 'Togepi GX [Rolling Panic | Supreme Puff GX]', '143a', 999), carte: togepi, ...ctx([togepi]) }); return [r.ok, /métacarte/.test(r.refus.join())]; })(), [false, true]);
verifier('des attaques qui ne sont pas celles du produit → refus', prouver({ entree: E1, produit: produit(20, 'Togepi GX [Autre | Supreme Puff GX]', '143a'), carte: togepi, ...ctx([togepi]) }).ok, false);
verifier('un nom qui n\'est pas celui de la carte → refus (le témoin du nom ne dort pas)', prouver({ entree: E1, produit: produit(20, 'Pichu [Rolling Panic | Supreme Puff GX]', '143a'), carte: togepi, ...ctx([togepi]) }).ok, false);
verifier('un homonyme aux mêmes attaques déclare AUSSI le numéro 143a → deux candidates, refus (un doute est un refus)', (() => {
    const autre = carte(11, 'Togepi GX', ['Rolling Panic'], [imp('intl', 'Yellow A Alternate cards', '143a', '236')], { liens: { idProduct: [2], idMetacards: [501] } });
    const r = prouver({ entree: E1, produit: pTog, carte: togepi, cartesDuSet: [togepi, autre], cartesPourCle: [togepi, autre], etatSetlist: null });
    return [r.ok, /candidate/.test(r.refus.join())];
})(), [false, true]);

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
verifier('les voies sont une liste fermée de quatre', VOIES, ['impression-numero', 'impression-equivalente', 'setlist', 'impression-du-tirage']);

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
