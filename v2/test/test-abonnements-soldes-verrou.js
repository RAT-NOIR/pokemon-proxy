'use strict';
// STRIPE-PARCOURS-FIN, tour de correction 1 (relecture A-M2) — UNE LECTURE DES SOLDES NE SERT QUE PENDANT UNE MÊME TENUE DU VERROU DU PARRAIN. Un avoir peut être posé chez Stripe par un autre processus qui meurt
// (ou échoue) avant d'écrire sa marque en base : entre deux tenues du verrou, seule une RELECTURE le compte dans le plafond des 12 mois. Ce banc rejoue la fenêtre sur le faux Stripe : le parrain a 11 mois offerts,
// deux primes en attente (A, puis B) ; l'autre processus pose l'avoir de B chez Stripe sans sa marque, ENTRE les deux tenues. Le plafond doit tenir (jamais un 13e avoir).
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { ObjectId } = require('mongoose').Types;
const A = require('./_aide-abonnements'); const { creerFauxStripe } = require('./_faux-stripe');
const Cl = require('../abonnements/client'); const Pr = require('../abonnements/primes'); const Pub = require('../abonnements/prix-publics');
const logs = []; const errOrig = console.error; console.error = (...a) => { logs.push(a.join(' ')); };

(async () => {
    await H.ouvrirBac('test-abonnements-soldes-verrou.js'); await M.creerIndex();
    const faux = creerFauxStripe(); A.semerPrix(faux); Cl.brancher(faux);
    const cfg = A.cfgAbo().abonnements;
    const compte = await A.compteConnecte();
    const cu = await faux.customers.create({ email: 'p@exemple.fr' });
    const dans = jours => new Date(Date.now() + jours * 86400e3);
    await db.col('comptes').updateOne({ _id: compte.id }, { $set: { stripeClient: cu.id, 'abonnement.stripe': { sid: 'sub_banc', statut: 'active', offre: 'pro', periode: 'mois', jusquAu: dans(20), resiliation: false, version: 1 } } });
    const poserAvoirMort = async filleul => faux.customers.createBalanceTransaction(cu.id, { amount: -499, currency: 'eur', description: 'posé par un processus mort', metadata: { rm_prime: String(filleul), rm_parrain: String(compte.id) } }, { idempotencyKey: `prime-${String(filleul)}` });
    const avoirsDistincts = () => new Set((faux.E.customers.get(cu.id).transactions || []).filter(t => t.amount < 0).map(t => t.metadata.rm_prime)).size;
    const semer = async () => {
        await db.col('abo_primes').deleteMany({}); faux.E.customers.get(cu.id).transactions = []; faux.E.customers.get(cu.id).balance = 0; faux.E.idem.clear(); Pub.vider();
        for (let i = 0; i < 11; i++) await db.col('abo_primes').insertOne({ _id: new ObjectId(), parrainId: compte.id, etat: 'applique', appliqueLe: new Date(Date.now() - (i + 1) * 86400e3), montant: 499, creeLe: new Date(Date.now() - (i + 2) * 86400e3) });
        const a = new ObjectId(), b = new ObjectId();
        await db.col('abo_primes').insertOne({ _id: a, parrainId: compte.id, etat: 'a-appliquer', creeLe: new Date(Date.now() - 2000) });
        await db.col('abo_primes').insertOne({ _id: b, parrainId: compte.id, etat: 'a-appliquer', creeLe: new Date(Date.now() - 1000) });
        return { a, b };
    };
    const etatDe = id => db.col('abo_primes').findOne({ _id: id }).then(x => x && x.etat);

    // ── 1. témoin : l'avoir mort existe AVANT la reprise → compté (A refusée, B reconnue appliquée), un seul avoir en tout ──
    let { a, b } = await semer();
    await poserAvoirMort(b);
    await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() });
    H.v('témoin : l\'avoir d\'un processus mort, posé AVANT la reprise, est compté ; le plafond tient (A refusée, B appliquée, un seul avoir)', [await etatDe(a), await etatDe(b), avoirsDistincts()], ['refusee', 'applique', 1]);

    // ── 2. la fenêtre : l'autre processus pose l'avoir de B ENTRE les deux tenues (à la libération du verrou de A) ──
    ({ a, b } = await semer());
    const proto = Object.getPrototypeOf(db.col('abo_primes_verrous')); const supprimer = proto.deleteOne; let tire = 0;
    proto.deleteOne = async function (filtre, ...r) {
        const res = await supprimer.call(this, filtre, ...r);
        if (filtre && typeof filtre._id === 'string' && filtre._id.startsWith('parrain:') && !tire && (await etatDe(b)) === 'a-appliquer') { tire++; await poserAvoirMort(b); }       // l'autre processus passe dans l'intervalle, et meurt avant sa marque
        return res;
    };
    try { await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() }); } finally { proto.deleteOne = supprimer; }
    H.v('la fenêtre : un avoir posé par un autre processus entre deux tenues ne dépasse JAMAIS le plafond (au plus UN avoir pour le seul mois restant : jamais un 13e)', avoirsDistincts() <= 1, true);
    console.log(`   (autre processus intervenu entre deux tenues : ${tire} fois ; avoirs distincts chez Stripe : ${avoirsDistincts()} ; états A/B : ${await etatDe(a)}/${await etatDe(b)})`);

    // ── 3. une NOUVELLE reprise relit les soldes (la lecture ne survit pas à une reprise) ──
    ({ a, b } = await semer());
    faux.E.appels.length = 0;
    const verrousVus = []; const liste = faux.customers.listBalanceTransactions;
    faux.customers.listBalanceTransactions = async (...x) => { verrousVus.push(await db.col('abo_primes_verrous').countDocuments({ _id: `parrain:${String(compte.id)}` })); return liste.apply(faux.customers, x); };
    await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() });
    faux.customers.listBalanceTransactions = liste;
    H.v('la reprise TIENT le verrou du parrain pendant qu\'elle lit ses soldes (une tenue pour toutes ses primes)', verrousVus, [1]);
    const lectures1 = faux.E.appels.filter(x => x.nom === 'customers.listBalanceTransactions').length;
    await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() });
    H.v('les primes d\'une même tenue partagent UNE lecture des soldes ; une reprise sans prime en attente ne lit rien', [lectures1, faux.E.appels.filter(x => x.nom === 'customers.listBalanceTransactions').length], [1, 1]);
    await db.col('abo_primes').updateOne({ _id: a }, { $set: { etat: 'a-appliquer' } });
    await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() });
    H.v('   et une nouvelle reprise (nouvelle tenue) RELIT les soldes', faux.E.appels.filter(x => x.nom === 'customers.listBalanceTransactions').length, 2);
    await H.fermerBac(); Cl.debrancher(); H.bilan();
})().catch(e => { errOrig('❌', e); process.exit(1); });
