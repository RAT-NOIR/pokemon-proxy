// BANC — corriger-couts-attaques.js : pour les documents à attaque `cout: []`, recalculer le coût depuis le wikitext archivé AVEC le parseur de
// production, ne toucher QUE `attaques[i].cout` / `coutNombre`, attaque par attaque (nom + position). Plan pur ; écriture sur une base en mémoire.
//   node test-corriger-couts-attaques.js
const { planifierCouts, operationVersMongo } = require('./corriger-couts-attaques');
const { faitsDeCarte } = require('./collecte-cartes/wikitext');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const att = (nom, ...p) => `{{Cardtext/Attack|name=${nom}|${p.join('|')}|damage=10}}`;
const parser = t => faitsDeCarte(t, 'Carte (Test 1)').attaques;
const doc = (id, attaques) => ({ _id: id, bulba: { titre: `T${id}` }, attaques });

// 1. une carte : 1re attaque à coût numérique (base : []), 2e vraie gratuité (base : []), 3e des énergies
const t1 = [att('Raid', 'cost=2'), att('Libre', 'cost='), att('Plein', 'cost={{e|Fire}}')].join('\n');
const p1 = planifierCouts([{ carte: doc(1, [{ nom: 'Raid', cout: [] }, { nom: 'Libre', cout: [] }, { nom: 'Plein', cout: ['Fire'] }]), neuves: parser(t1) }]);
verifier('seul le coût numérique change : une opération, attaque 0', p1.operations.map(o => [o._id, o.index, o.nom, o.coutNombre]), [[1, 0, 'Raid', 2]]);
verifier('la gratuité vraie et les énergies : ni opération ni refus', [p1.refus.length, p1.inchangees], [0, 2]);

// 2. le nombre d'attaques diverge : le document est écarté, dit, jamais écrit
const p2 = planifierCouts([{ carte: doc(2, [{ nom: 'Raid', cout: [] }]), neuves: parser([att('Raid', 'cost=2'), att('Autre', 'cost=1')].join('\n')) }]);
verifier('nombre d\'attaques différent : écarté, aucune opération', [p2.operations.length, p2.refus.map(r => /nombre d'attaques/.test(r.raison))], [0, [true]]);

// 3. même position, autre nom : l'attaque est écartée (la correspondance est nom ET position)
const p3 = planifierCouts([{ carte: doc(3, [{ nom: 'Ancien nom', cout: [] }]), neuves: parser(att('Raid', 'cost=2')) }]);
verifier('même position, nom différent : écartée, aucune opération', [p3.operations.length, p3.refus.map(r => /nom/.test(r.raison))], [0, [true]]);

// 4. un coût NON VIDE en base n'est jamais touché, même si le parseur dit autre chose
const p4 = planifierCouts([{ carte: doc(4, [{ nom: 'Raid', cout: ['Water'] }]), neuves: parser(att('Raid', 'cost=2')) }]);
verifier('coût non vide en base : jamais touché, refus nommé', [p4.operations.length, p4.refus.map(r => /non vide/.test(r.raison))], [0, [true]]);

// 5. deux attaques à coût numérique dans un document : deux opérations
const p5 = planifierCouts([{ carte: doc(5, [{ nom: 'A', cout: [] }, { nom: 'B', cout: [] }]), neuves: parser([att('A', 'cost=1'), att('B', 'cost=3')].join('\n')) }]);
verifier('deux coûts numériques : deux opérations', p5.operations.map(o => [o.index, o.coutNombre]), [[0, 1], [1, 3]]);

// ── l'écriture, sur une base de banc (mémoire) : positionnelle par index, seul `cout`/`coutNombre` de CETTE attaque bouge
(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const col = client.db('banc_couts').collection('cartes');
        await col.insertMany([
            { _id: 1, nomEn: 'N1', categorie: 'pokemon', attaques: [{ nom: 'Raid', nomJa: 'x', cout: [], degats: '10' }, { nom: 'Libre', cout: [], degats: '10' }, { nom: 'Plein', cout: ['Fire'], degats: '10' }] },
            { _id: 5, attaques: [{ nom: 'A', cout: [] }, { nom: 'B', cout: [] }] },
            { _id: 9, attaques: [{ nom: 'Raid', cout: ['Water'] }] }
        ]);
        let n = 0;
        for (const o of p1.operations.concat(p5.operations)) { const { filtre, maj } = operationVersMongo(o); n += (await col.updateOne(filtre, maj)).modifiedCount; }
        verifier('trois attaques modifiées', n, 3);
        const c1 = await col.findOne({ _id: 1 });
        verifier('carte 1 : l\'attaque 0 perd `cout` et gagne `coutNombre`, le reste (nomJa, degats) intact', c1.attaques[0], { nom: 'Raid', nomJa: 'x', degats: '10', coutNombre: 2 });
        verifier('carte 1 : les attaques 1 et 2 intactes, et les champs de la carte aussi', [c1.attaques[1], c1.attaques[2], c1.nomEn, c1.categorie], [{ nom: 'Libre', cout: [], degats: '10' }, { nom: 'Plein', cout: ['Fire'], degats: '10' }, 'N1', 'pokemon']);
        const c5 = await col.findOne({ _id: 5 });
        verifier('carte 5 : deux attaques, deux coutNombre', c5.attaques, [{ nom: 'A', coutNombre: 1 }, { nom: 'B', coutNombre: 3 }]);
        const rejoue = await col.updateOne(operationVersMongo(p1.operations[0]).filtre, operationVersMongo(p1.operations[0]).maj);
        verifier('rejouée : plus rien à modifier (idempotent)', rejoue.modifiedCount, 0);
        const contre = await col.updateOne(operationVersMongo({ _id: 9, index: 0, nom: 'Raid', coutNombre: 2 }).filtre, operationVersMongo({ _id: 9, index: 0, nom: 'Raid', coutNombre: 2 }).maj);
        verifier('un coût non vide en base : l\'écriture ne le touche pas', [contre.modifiedCount, (await col.findOne({ _id: 9 })).attaques[0].cout], [0, ['Water']]);
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
