// BANC — poser-impressions-energies.js : l'impression d'un set manquante à une carte (Énergies de base d'Evolving Skies, d'Obsidian Flames).
// Pur pour la planification (faux objets) ; une base mongodb-memory-server pour l'écriture (jamais la production : collecte-cartes/base-banc.js).
//   node test-poser-impressions-energies.js
const { planifier, verifierAttendu, operationsVersMongo, ecrireOperations, SOURCE, PREUVE } = require('./poser-impressions-energies');
const { SOURCES_POSEES_APRES } = require('./collecte-cartes/impressions-posees');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};

// ── le monde minimal : Evolving Skies (exp 4328, TCGdex swsh7), la carte « Basic Darkness Energy » (-1), le produit 574294 au n° 236
const EXPANSION = 'Evolving Skies';
const SETS = new Map([
    ['Evolving-Skies', { _id: 'Evolving-Skies', tirage: 'intl', region: 'intl', idExpansion: [4328], bulba: { expansion: EXPANSION } }],
    ['Autre-Set', { _id: 'Autre-Set', tirage: 'intl', region: 'intl', idExpansion: [9999], bulba: { expansion: 'Autre' } }]
]);
const carte = (id, sets, impressions, nomEn = 'Basic Darkness Energy') => ({ _id: id, nomEn, sets, impressions });
const ligne = (carteId, idProduct, extra = {}) => ({ carteId, idProduct, idExpansion: 4328, slugSet: 'Evolving-Skies', numeroFiche: null, ...extra });
const CLONE = { parProduit: new Map([[574294, [{ setId: 'swsh7', localId: '236', variante: null }]]]), setsParExpansion: new Map([[4328, ['swsh7']]]) };
const nomClone = (setId, localId) => (setId === 'swsh7' && localId === '236' ? 'Darkness Energy' : null);
const monde = (o = {}) => planifier({
    lignes: o.lignes ?? [ligne(-1, 574294)],
    cartes: o.cartes ?? new Map([[-1, carte(-1, ['Evolving-Skies'], [{ tirage: 'intl', expansion: 'Base Set', numero: '98' }])]]),
    sets: o.sets ?? SETS,
    numeros: o.numeros ?? new Map([[574294, '236']]),
    clone: o.clone ?? CLONE, nomClone: o.nomClone ?? nomClone, produits: o.produits ?? [574294]
});

const bon = monde();
verifier('cas sain : une opération, l\'impression du set au n° 236', bon.operations.map(o => [o.carteId, o.idProduct, o.numeroFiche, o.impression.tirage, o.impression.expansion, o.impression.numero, o.impression.source]), [[-1, 574294, '236', 'intl', EXPANSION, '236', 'numero-cardmarket']]);
verifier('cas sain : aucun refus, la preuve nomme les deux sources', [bon.refus, /Cardmarket/.test(bon.operations[0].impression.preuveNumero), /swsh7-236/.test(bon.operations[0].impression.preuveNumero)], [[], true, true]);
verifier('la marque de conservation est une source posée après le parseur (un --reparser ne l\'efface pas)', [SOURCE, SOURCES_POSEES_APRES.includes(SOURCE)], ['numero-cardmarket', true]);
verifier('la preuve de la ligne (constante) est nommée', typeof PREUVE, 'string');

verifier('la carte a DÉJÀ une impression de ce set : ni opération ni refus, comptée « deja »', (() => { const m = monde({ cartes: new Map([[-1, carte(-1, ['Evolving-Skies'], [{ tirage: 'intl', expansion: EXPANSION, numero: '236' }])]]) }); return [m.operations, m.refus, m.deja.map(d => d.idProduct)]; })(), [[], [], [574294]]);
verifier('une impression du set à un AUTRE numéro : jamais ajoutée (refus « deja »), pas de seconde fiche', (() => { const m = monde({ cartes: new Map([[-1, carte(-1, ['Evolving-Skies'], [{ tirage: 'intl', expansion: EXPANSION, numero: '237' }])]]) }); return [m.operations.length, m.deja.length]; })(), [0, 1]);
verifier('le numéro Cardmarket n\'est pas celui de TCGdex : refus', (() => { const m = monde({ numeros: new Map([[574294, '237']]) }); return [m.operations.length, m.refus.map(r => /numéro/.test(r.raison))]; })(), [0, [true]]);
verifier('TCGdex ne nomme pas le produit : refus', (() => { const m = monde({ clone: { parProduit: new Map(), setsParExpansion: CLONE.setsParExpansion } }); return [m.operations.length, m.refus.map(r => /TCGdex ne nomme pas/.test(r.raison))]; })(), [0, [true]]);
verifier('TCGdex nomme le produit dans un autre set que l\'expansion : refus', (() => { const m = monde({ clone: { parProduit: new Map([[574294, [{ setId: 'swsh9', localId: '236', variante: null }]]]), setsParExpansion: CLONE.setsParExpansion } }); return [m.operations.length, m.refus.length]; })(), [0, 1]);
verifier('le nom TCGdex n\'est pas celui de la carte : refus', (() => { const m = monde({ nomClone: () => 'Metal Energy' }); return [m.operations.length, m.refus.map(r => /nom/.test(r.raison))]; })(), [0, [true]]);
verifier('« Basic » en tête du nom de la carte ne compte pas : « Basic Darkness Energy » = « Darkness Energy »', monde().operations.length, 1);
verifier('un nom dont seul le préfixe « Basic » diffère n\'est PAS une inclusion libre : « Darkness Energy Special » refusé', monde({ cartes: new Map([[-1, carte(-1, ['Evolving-Skies'], [], 'Darkness Energy Special')]]) }).operations.length, 0);
verifier('le produit n\'est pas dans la liste fermée demandée : ignoré (ni opération ni refus)', (() => { const m = monde({ produits: [111] }); return [m.operations, m.refus]; })(), [[], []]);
verifier('le set n\'a pas de nom d\'expansion : refus', (() => { const m = monde({ sets: new Map([['Evolving-Skies', { _id: 'Evolving-Skies', tirage: 'intl', idExpansion: [4328], bulba: {} }]]) }); return [m.operations.length, m.refus.length]; })(), [0, 1]);
verifier('le set de la ligne est inconnu : refus', (() => { const m = monde({ sets: new Map() }); return [m.operations.length, m.refus.length]; })(), [0, 1]);
verifier('la carte est introuvable : refus', (() => { const m = monde({ cartes: new Map() }); return [m.operations.length, m.refus.length]; })(), [0, 1]);
verifier('le produit n\'a pas de numéro Cardmarket appris : refus', (() => { const m = monde({ numeros: new Map() }); return [m.operations.length, m.refus.length]; })(), [0, 1]);
verifier('un numéro non entier (« R/RGB ») n\'est pas posé par cette voie : refus', (() => { const m = monde({ numeros: new Map([[574294, 'R/RGB']]) }); return [m.operations.length, m.refus.length]; })(), [0, 1]);
verifier('deux sets de la carte portent le MÊME nom d\'expansion : refus (l\'impression s\'afficherait dans les deux)', (() => {
    const sets = new Map(SETS); sets.set('Evolving-Skies-Additionals', { _id: 'Evolving-Skies-Additionals', tirage: 'intl', idExpansion: [4329], bulba: { expansion: EXPANSION } });
    const m = monde({ sets, cartes: new Map([[-1, carte(-1, ['Evolving-Skies', 'Evolving-Skies-Additionals'], [])]]) }); return [m.operations.length, m.refus.length];
})(), [0, 1]);
verifier('un autre produit de la même carte, dans le même set, à un AUTRE numéro : refus (la fiche se scinderait)', (() => {
    const m = monde({ lignes: [ligne(-1, 574294), ligne(-1, 574299)], numeros: new Map([[574294, '236'], [574299, '240']]) }); return [m.operations.length, m.refus.length];
})(), [0, 1]);
verifier('un autre produit de la même carte au MÊME numéro : accepté, les deux lignes reçoivent le numéro', (() => {
    const m = monde({ lignes: [ligne(-1, 574294), ligne(-1, 574299)], numeros: new Map([[574294, '236'], [574299, '236']]), clone: { parProduit: new Map([[574294, [{ setId: 'swsh7', localId: '236' }]], [574299, [{ setId: 'swsh7', localId: '236' }]]]), setsParExpansion: CLONE.setsParExpansion }, produits: [574294, 574299] });
    return [m.operations.map(o => o.idProduct), m.operations.filter(o => o.impression).length];
})(), [[574294, 574299], 1]);
verifier('la ligne porte déjà un numeroFiche DIFFÉRENT : refus (jamais écrasé)', (() => { const m = monde({ lignes: [ligne(-1, 574294, { numeroFiche: '999' })] }); return [m.operations.length, m.refus.length]; })(), [0, 1]);
verifier('la ligne porte déjà le MÊME numeroFiche (écrit autrement) : acceptée', monde({ lignes: [ligne(-1, 574294, { numeroFiche: '0236' })] }).operations.length, 1);
verifier('--attendu : le nombre exact passe', verifierAttendu(bon, 1), { ok: true });
verifier('--attendu : un autre nombre refuse', verifierAttendu(bon, 3).ok, false);
verifier('--attendu absent : refuse', verifierAttendu(bon, undefined).ok, false);

// ── l'écriture, sur une vraie base de banc (mémoire)
(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_energies');
        await db.collection('cartes').insertMany([carte(-1, ['Evolving-Skies'], [{ tirage: 'intl', expansion: 'Base Set', numero: '98' }]), carte(-2, ['Evolving-Skies'], [{ tirage: 'intl', expansion: EXPANSION, numero: '237' }])]);
        await db.collection('cartes_produits').insertMany([{ _id: '-1|574294', carteId: -1, idProduct: 574294, numeroFiche: null, preuve: 'setlist+nom' }, { _id: '-2|574295', carteId: -2, idProduct: 574295, numeroFiche: null, preuve: 'setlist+nom' }]);
        const ops = bon.operations;
        const r1 = await ecrireOperations(db, ops);
        verifier('écriture : une impression posée, une ligne numérotée', r1, { impressions: 1, lignes: 1 });
        const c1 = await db.collection('cartes').findOne({ _id: -1 });
        verifier('la carte garde son impression ancienne et reçoit la nouvelle (source posée)', c1.impressions.map(i => [i.expansion, i.numero, i.source ?? null]), [['Base Set', '98', null], [EXPANSION, '236', 'numero-cardmarket']]);
        verifier('la ligne a son numeroFiche, sa preuve est INTACTE', (({ numeroFiche, preuve }) => ({ numeroFiche, preuve }))(await db.collection('cartes_produits').findOne({ _id: '-1|574294' })), { numeroFiche: '236', preuve: 'setlist+nom' });
        verifier('relancée : idempotente (rien de plus)', await ecrireOperations(db, ops), { impressions: 0, lignes: 0 });
        verifier('la carte -2 (déjà une impression du set) n\'a pas bougé', (await db.collection('cartes').findOne({ _id: -2 })).impressions.length, 1);
        // une ligne dont le numeroFiche a changé entre simulation et écriture n'est JAMAIS écrasée
        await db.collection('cartes_produits').updateOne({ _id: '-1|574294' }, { $set: { numeroFiche: '999' } });
        verifier('un numeroFiche posé entre-temps n\'est pas écrasé', await ecrireOperations(db, ops), { impressions: 0, lignes: 0 });
        verifier('la forme de l\'opération Mongo est un filtre + un $push gardés', Object.keys(operationsVersMongo(ops[0]).impression.filtre).sort(), ['_id', 'impressions']);
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
