// node test-file-apprentissage.js — la file d'apprentissage côté serveur (collecte-cartes/file-apprentissage.js) sur une VRAIE base :
// test_scratch, une collection à lui (refusée si elle existe), retirée en sortant. `apprendre` est un témoin (la route y met apprendreLot).
require('dotenv').config();
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');
const F = require('./collecte-cartes/file-apprentissage');
const COLL = 'banc_file_apprentissage';
let ok = 0, ko = 0;
const verifier = (nom, obtenu, attendu) => { const a = JSON.stringify(obtenu), b = JSON.stringify(attendu); if (a === b) { ok++; console.log(`✅ ${nom}`); } else { ko++; console.log(`❌ ${nom}\n   obtenu  ${a}\n   attendu ${b}`); } };
const muet = { error() {}, log() {} };
(async () => {
    // BASE DE BANC (2026-10-08) : plus jamais la production — base mémoire, ou MONGODB_TEST_URI hors production, sinon REFUS (base-banc.js).
    (await ouvrirBanc()).appliquer();
    const cx = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: 'test_scratch' }).asPromise();
    if (cx.db.databaseName !== 'test_scratch') throw new Error('je n\'écris que dans test_scratch');
    if ((await cx.db.listCollections({ name: COLL }).toArray()).length) throw new Error(`test_scratch porte déjà ${COLL}`);
    const C = cx.db.collection(COLL);
    try {
        const t0 = new Date('2026-09-28T00:00:00Z'), t = s => new Date(t0.getTime() + s * 1000);
        const a = await F.mettreEnFile(C, { userId: 'u1', cartes: [{ idProduct: 1 }], le: t(0) });
        const b = await F.mettreEnFile(C, { userId: 'u1', cartes: [{ idProduct: 2 }, { idProduct: 3 }], le: t(1) });
        verifier('mise en file : 202, enFile, positions 1 puis 2, le nombre de cartes dit', [a.status, a.corps.enFile, a.corps.position, b.corps.position, b.corps.recus], [202, true, 1, 2, 2]);
        const plein = await F.mettreEnFile(C, { userId: 'u1', cartes: [{ idProduct: 4 }], plafond: 2, le: t(2) });
        const autre = await F.mettreEnFile(C, { userId: 'u2', cartes: [{ idProduct: 5 }], plafond: 2, le: t(3) });
        verifier('le plafond est PAR utilisateur : u1 à 2 lots → 429 (rien inséré) ; u2 passe', [plein.status, autre.status, await C.countDocuments({ userId: 'u1' })], [429, 202, 2]);
        const vus = [];
        const r1 = await F.traiterUn(C, { apprendre: async (cartes, userId) => { vus.push([userId, cartes.length]); return { nouvelles: cartes.length, dejaExactes: 0 }; }, journal: muet });
        verifier('traiterUn prend le PLUS ANCIEN, le passe à apprendre, le marque fait avec son résultat', [vus, r1.etat, r1.resultat.nouvelles, (await C.findOne({ _id: new mongoose.Types.ObjectId(r1.id) })).etat], [[['u1', 1]], 'fait', 1, 'fait']);
        const echoue = async () => { throw new Error('Mongo tombé'); };
        const e1 = await F.traiterUn(C, { apprendre: echoue, journal: muet });
        verifier('un échec : le lot revient en attente, essais 1, l\'erreur écrite', [e1.etat, (await C.findOne({ _id: new mongoose.Types.ObjectId(e1.id) })).essais], ['attente', 1]);
        await F.traiterUn(C, { apprendre: echoue, journal: muet });
        const e3 = await F.traiterUn(C, { apprendre: echoue, journal: muet });
        verifier('trois échecs : erreur, gardé (pas retiré), jamais repris', [e3.etat, e3.id === e1.id, await C.countDocuments({ etat: 'erreur' })], ['erreur', true, 1]);
        const r2 = await F.traiterUn(C, { apprendre: async () => ({}), journal: muet });
        const vide = await F.traiterUn(C, { apprendre: async () => ({}), journal: muet });
        verifier('le lot suivant (u2) passe, puis la file est vide : traite false', [r2.etat, vide.traite], ['fait', false]);
        // un lot pris par un processus mort : en-cours depuis 11 min → rendu ; depuis 1 min → gardé
        await C.insertMany([{ userId: 'u3', cartes: [{ idProduct: 9 }], recuLe: t(10), etat: 'en-cours', prisLe: new Date(Date.now() - 11 * 60e3), essais: 0 },
            { userId: 'u3', cartes: [{ idProduct: 10 }], recuLe: t(11), etat: 'en-cours', prisLe: new Date(Date.now() - 60e3), essais: 0 }]);
        verifier('reprendreBloques : un lot pris il y a 11 min revient en attente, celui d\'il y a 1 min reste pris', [await F.reprendreBloques(C), await C.countDocuments({ userId: 'u3', etat: 'attente' })], [1, 1]);
        // ── RELECTURE DU 2026-09-28 ──
        // (a) une reprise compte comme un essai ; au 3e, le lot qui fait tomber le processus finit en erreur (il revenait sans fin)
        await C.insertOne({ userId: 'u4', cartes: [{ idProduct: 11 }], recuLe: t(12), etat: 'en-cours', prisLe: new Date(Date.now() - 11 * 60e3), essais: F.ESSAIS_MAX - 1 });
        const repris = await C.findOne({ userId: 'u3', etat: 'attente' });
        await F.reprendreBloques(C);
        verifier('(a) reprise d\'un lot bloqué : essais +1 (1) ; un lot bloqué à son dernier essai → erreur, gardé, sa raison écrite',
            [(await C.findOne({ _id: repris._id })).essais, (await C.findOne({ userId: 'u4' })).etat, /pris 3 fois/.test((await C.findOne({ userId: 'u4' })).derniereErreur)], [1, 'erreur', true]);
        await C.deleteMany({ userId: { $in: ['u3', 'u4'] } });
        // (b) un lot FAIT ne garde que son résultat : ses cartes sont retirées (la file est bornée), leur nombre reste
        const f1 = await F.mettreEnFile(C, { userId: 'u5', cartes: [{ idProduct: 12 }, { idProduct: 13 }], le: t(20) });
        await F.traiterUn(C, { apprendre: async c => ({ nouvelles: c.length }), journal: muet });
        const fait = await C.findOne({ _id: new mongoose.Types.ObjectId(f1.corps.id) });
        verifier('(b) lot fait : cartes retirées, nCartes 2, résultat gardé', [fait.etat, 'cartes' in fait, fait.nCartes, fait.resultat.nouvelles], ['fait', false, 2, 2]);
        // (c) la déduction a échoué (apprendreLot le DIT sans lever) : le lot n'est pas fait — il revient en attente, l'erreur et le résultat écrits
        const d1 = await F.mettreEnFile(C, { userId: 'u5', cartes: [{ idProduct: null, slug: 'X-1', sansImage: true }], le: t(21) });
        const rd = await F.traiterUn(C, { apprendre: async () => ({ nouvelles: 0, deduites: null, erreurDeduction: 'Mongo tombé pendant la déduction' }), journal: muet });
        const dd = await C.findOne({ _id: new mongoose.Types.ObjectId(d1.corps.id) });
        verifier('(c) erreurDeduction : attente (pas fait), essais 1, cartes gardées, erreur et dernier résultat écrits',
            [rd.etat, dd.etat, dd.essais, dd.cartes.length, /déduction des sans-image/.test(dd.derniereErreur), dd.dernierResultat?.erreurDeduction], ['attente', 'attente', 1, 1, true, 'Mongo tombé pendant la déduction']);
        // (e) un lot repris par un AUTRE processus pendant son traitement (bloqué > 10 min, puis repris) : la fin de ce processus-ci ne
        //     l'écrase pas (jeton de prise `prisLe`)
        const r1e = await F.mettreEnFile(C, { userId: 'u6', cartes: [{ idProduct: 15 }], le: t(0.5) });
        const autrePrise = new Date(Date.now() + 5000);
        const re = await F.traiterUn(C, { apprendre: async () => { await C.updateOne({ _id: new mongoose.Types.ObjectId(r1e.corps.id) }, { $set: { prisLe: autrePrise } }); return { nouvelles: 1 }; }, journal: muet });
        const de = await C.findOne({ _id: new mongoose.Types.ObjectId(r1e.corps.id) });
        verifier('(e) lot repris par un autre processus pendant le traitement : ni « fait » ni cartes retirées par celui-ci', [re.id === r1e.corps.id, de.etat, de.cartes.length, +de.prisLe === +autrePrise], [true, 'en-cours', 1, true]);
        await C.deleteOne({ _id: de._id });
        // (d) le plafond GLOBAL (tous utilisateurs, lots portant des cartes — l'erreur comprise) : un autre userId ne le contourne pas
        const nPorteurs = await C.countDocuments({ etat: { $in: ['attente', 'en-cours', 'erreur'] } });
        const g1 = await F.mettreEnFile(C, { userId: 'u-neuf', cartes: [{ idProduct: 14 }], plafondGlobal: nPorteurs, le: t(22) });
        const g2 = await F.mettreEnFile(C, { userId: 'u-neuf', cartes: [{ idProduct: 14 }], plafondGlobal: nPorteurs + 1, le: t(23) });
        verifier(`(d) plafond global (${nPorteurs} lots porteurs de cartes) : un userId neuf → 429, rien inséré ; sous le plafond → 202`,
            [g1.status, /File serveur pleine \(/.test(g1.corps.error), g2.status, await C.countDocuments({ userId: 'u-neuf' })], [429, true, 202, 1]);
        let leve = 0; for (const x of [{ userId: null, cartes: [1] }, { userId: 'u', cartes: [] }]) { try { await F.mettreEnFile(C, x); } catch (_) { leve++; } }
        verifier('mettreEnFile LÈVE sans userId ou sans cartes (la route vérifie avant : un appel mal formé est un défaut)', leve, 2);
    } finally {
        await C.drop().catch(() => {});
        console.log(`   nettoyé : ${(await cx.db.listCollections({ name: COLL }).toArray()).length ? 'ENCORE PRÉSENTE' : `${COLL} retirée de test_scratch`}`);
        await cx.close();
    }
    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
