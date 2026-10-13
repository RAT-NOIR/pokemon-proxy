// BANC — poser-lignes-ciblees.js : UNE ligne de jointure prouvée par joindre() (set+numero…), posée sans reparse, sans rien écraser.
//   node test-poser-lignes-ciblees.js
const { planifier, verifierAttendu, ecrireLignes } = require('./poser-lignes-ciblees');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
let ok = 0, ko = 0;
const verifier = (quoi, obtenu, attendu) => {
    const a = JSON.stringify(obtenu), b = JSON.stringify(attendu);
    if (a === b) { ok++; console.log(`  ✅ ${quoi}`); } else { ko++; console.log(`  ❌ ${quoi}\n     obtenu  ${a}\n     attendu ${b}`); }
};
const E = 'Paldea Evolved';
const carte = (id, nomEn, numero, extra = {}) => ({ _id: id, nomEn, attaques: [], impressions: [{ tirage: 'intl', expansion: E, numero }], liens: { idProduct: [], idMetacards: [] }, ...extra });
const produit = (idProduct, nom, numero, idMetacard = 1) => ({ idProduct, name: nom, nom, attaques: [], numero, idMetacard, idExpansion: 5318, slug: `${nom}-${numero}`, slugSet: 'Paldea-Evolved' });
const OPTS = { idExpansion: 5318, expansionBulba: E, tirage: 'intl', slugSet: 'Paldea-Evolved' };
const plan = (o = {}) => planifier({ cartes: o.cartes ?? [carte(1, 'Ghetsis', '172'), carte(2, 'Quaxly', '050')], produits: o.produits ?? [produit(10, 'Ghetsis', '172'), produit(11, 'Quaxly', '050')], optionsJoindre: OPTS, existants: o.existants ?? new Map(), visees: o.visees ?? [10] });

const bon = plan();
verifier('un produit visé, prouvé par set+numero : UNE ligne, la sienne seulement', bon.lignes.map(l => [l._id, l.preuve, l.numeroFiche]), [['1|10', 'set+numero', '172']]);
verifier('aucun refus, le produit non visé (11) n\'est pas posé', [bon.refus, bon.lignes.some(l => l.idProduct === 11)], [[], false]);
verifier('plusieurs produits visés', plan({ visees: [10, 11] }).lignes.map(l => l.idProduct), [10, 11]);
verifier('un produit visé que joindre() ne joint pas : refus nommé', (() => { const p = plan({ produits: [produit(10, 'Ghetsis', '172'), produit(12, 'Inconnu', '999')], visees: [12] }); return [p.lignes.length, p.refus.map(r => [r.idProduct, /ne joint pas/.test(r.raison)])]; })(), [0, [[12, true]]]);
verifier('un produit visé absent du catalogue de l\'expansion : refus', (() => { const p = plan({ visees: [999] }); return [p.lignes.length, p.refus.length]; })(), [0, 1]);
verifier('la ligne existe déjà (même _id, QUELLE QUE SOIT sa preuve) : jamais écrasée, comptée « deja »', (() => { const p = plan({ existants: new Map([['1|10', { preuve: 'tcgdex+pont' }]]) }); return [p.lignes.length, p.deja.map(d => [d._id, d.preuve])]; })(), [0, [['1|10', 'tcgdex+pont']]]);
verifier('un produit à DEUX cartes (nom + numéro qui désignent deux cartes) : refus, rien posé', (() => { const p = plan({ cartes: [carte(1, 'Ghetsis', '172'), carte(3, 'Ghetsis', '172')], visees: [10] }); return p.lignes.length; })(), 0);
verifier('le témoin du nom de joindre() contredit (numéro d\'une autre carte) : refus', (() => { const p = plan({ cartes: [carte(1, 'Quaxly', '172'), carte(2, 'Ghetsis', '050')], visees: [10] }); return p.lignes.length; })(), 0);
verifier('--attendu : le bon nombre passe, un autre ou l\'absence refuse', [verifierAttendu(bon, 1).ok, verifierAttendu(bon, 2).ok, verifierAttendu(bon, undefined).ok], [true, false, false]);

(async () => {
    const banc = await ouvrirBanc();
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(banc.uri);
    try {
        await client.connect();
        const db = client.db('banc_lignes');
        await db.collection('cartes').insertMany([{ _id: 1, nomEn: 'Ghetsis', liens: { idProduct: [5, 6], idMetacards: [9] } }]);
        await db.collection('cartes_produits').insertMany([{ _id: '1|5', carteId: 1, idProduct: 5, preuve: 'set+numero' }]);
        const r1 = await ecrireLignes(db, bon.lignes, new Map([[10, 77]]));
        verifier('écriture : une ligne, la carte reçoit l\'idProduct EN FIN (repère d\'adresse intact)', [r1, (await db.collection('cartes').findOne({ _id: 1 })).liens], [{ lignes: 1, cartes: 1 }, { idProduct: [5, 6, 10], idMetacards: [9, 77] }]);
        verifier('la ligne écrite porte sa preuve', (await db.collection('cartes_produits').findOne({ _id: '1|10' })).preuve, 'set+numero');
        verifier('idempotente : rien de plus', await ecrireLignes(db, bon.lignes, new Map([[10, 77]])), { lignes: 0, cartes: 0 });
        await db.collection('cartes_produits').updateOne({ _id: '1|10' }, { $set: { preuve: 'autre' } });
        await ecrireLignes(db, bon.lignes, new Map([[10, 77]]));
        verifier('une ligne posée entre-temps par un autre outil n\'est JAMAIS réécrite', (await db.collection('cartes_produits').findOne({ _id: '1|10' })).preuve, 'autre');
        verifier('la ligne voisine (1|5) est intacte', (await db.collection('cartes_produits').findOne({ _id: '1|5' })).preuve, 'set+numero');
    } finally { await client.close(); await banc.arreter(); }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
