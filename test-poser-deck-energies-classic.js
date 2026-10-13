// BANC — poser-deck-energies-classic.js : les six énergies de base des decks « Pokémon Card Game Classic » reçoivent `impressions[].deck`
// (celui de leur set), par mise à jour POSITIONNELLE. Pur pour la planification (faux objets) ; une base mongodb-memory-server pour l'écriture
// (jamais la production : collecte-cartes/base-banc.js).
//   node test-poser-deck-energies-classic.js
const { planifier, operationVersMongo, ENERGIES, EXPANSION } = require('./poser-deck-energies-classic');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const imp = (numero, extra = {}) => ({ tirage: 'jp', expansion: EXPANSION, numero, source: 'cardmarket', ...extra });
const SETS = { A: { _id: 'A', deck: 'Deck A' }, B: { _id: 'B', deck: 'Deck B' } };
const ATTENDU = { [-1]: 'PSY', [-2]: 'WAT' };
const carte = (id, sets, impressions) => ({ _id: id, nomEn: `c${id}`, sets, impressions });
const plan = (cartes, sets = SETS, attendu = ATTENDU) => planifier({ cartes, setsParId: sets, energies: attendu });

const bon = plan([carte(-1, ['A'], [imp('PSY')]), carte(-2, ['B'], [imp('WAT')])]);
verifier('deux fiches saines : deux opérations, le deck de CHAQUE set', [bon.operations.map(o => [o._id, o.numero, o.deck]), bon.refus], [[[-1, 'PSY', 'Deck A'], [-2, 'WAT', 'Deck B']], []]);
verifier('une impression au numéro voulu mais d\'une AUTRE expansion : refus (aucune correspondante)', plan([carte(-1, ['A'], [imp('PSY', { expansion: 'Autre' })]), carte(-2, ['B'], [imp('WAT')])]).refus.map(r => r._id), [-1]);
verifier('deux impressions correspondantes : refus', plan([carte(-1, ['A'], [imp('PSY'), imp('PSY')]), carte(-2, ['B'], [imp('WAT')])]).refus.map(r => [r._id, /plus d'une/.test(r.raison)]), [[-1, true]]);
verifier('le set n\'a pas de deck : refus', plan([carte(-1, ['A'], [imp('PSY')])], { A: { _id: 'A' } }, { [-1]: 'PSY' }).refus.map(r => [r._id, /sets\.deck absent/.test(r.raison)]), [[-1, true]]);
verifier('le set est inconnu : refus', plan([carte(-1, ['Z'], [imp('PSY')])], SETS, { [-1]: 'PSY' }).refus.map(r => r._id), [-1]);
verifier('une carte dans deux sets : refus (le deck serait deviné)', plan([carte(-1, ['A', 'B'], [imp('PSY')])], SETS, { [-1]: 'PSY' }).refus.map(r => r._id), [-1]);
verifier('une carte absente : refus', plan([carte(-1, ['A'], [imp('PSY')])]).refus.map(r => [r._id, /introuvable/.test(r.raison)]), [[-2, true]]);
const deja = plan([carte(-1, ['A'], [imp('PSY', { deck: 'Deck A' })]), carte(-2, ['B'], [imp('WAT')])]);
verifier('un deck déjà posé : ni opération ni refus, compté « déjà »', [deja.operations.map(o => o._id), deja.refus, deja.deja], [[-2], [], [-1]]);
verifier('les six fiches de production sont nommées, avec leur numéro', ENERGIES, { '-744658': 'PSY', '-744659': 'WAT', '-743198': 'GRA', '-743197': 'FIG', '-744624': 'LIG', '-744625': 'FIR' });

// ── l'écriture, sur une vraie base de banc (mémoire)
(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const col = client.db('banc_deck').collection('cartes');
        await col.insertMany([
            carte(-1, ['A'], [imp('PSY'), imp('WAT')]),                                  // la bonne impression est la 1re de deux : le positionnel doit viser LA bonne
            carte(-2, ['B'], [imp('XXX'), imp('WAT')]),                                  // la bonne est la 2e
            carte(-3, ['A'], [imp('PSY', { deck: 'Posé avant' })]),                      // déjà un deck : jamais écrasé
            carte(-4, ['A'], [imp('PSY', { expansion: 'Autre' })])                       // autre expansion : intacte
        ]);
        const ecrire = async (id, numero, deck) => { const { filtre, maj } = operationVersMongo({ _id: id, numero, deck }); return (await col.updateOne(filtre, maj)).modifiedCount; };
        verifier('-1 : une modification', await ecrire(-1, 'PSY', 'Deck A'), 1);
        verifier('-2 : une modification', await ecrire(-2, 'WAT', 'Deck B'), 1);
        verifier('-3 : un deck déjà posé n\'est pas réécrit', await ecrire(-3, 'PSY', 'Deck A'), 0);
        verifier('-4 : une autre expansion n\'est pas touchée', await ecrire(-4, 'PSY', 'Deck A'), 0);
        verifier('-1 : seule l\'impression PSY a reçu le deck', (await col.findOne({ _id: -1 })).impressions.map(i => [i.numero, i.deck ?? null]), [['PSY', 'Deck A'], ['WAT', null]]);
        verifier('-2 : seule l\'impression WAT a reçu le deck', (await col.findOne({ _id: -2 })).impressions.map(i => [i.numero, i.deck ?? null]), [['XXX', null], ['WAT', 'Deck B']]);
        verifier('-3 intacte', (await col.findOne({ _id: -3 })).impressions[0].deck, 'Posé avant');
        verifier('-4 intacte', (await col.findOne({ _id: -4 })).impressions[0].deck ?? null, null);
        verifier('relancée : plus rien à modifier (idempotent)', [await ecrire(-1, 'PSY', 'Deck A'), await ecrire(-2, 'WAT', 'Deck B')], [0, 0]);
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
