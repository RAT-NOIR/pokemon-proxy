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
    // ── 4. (M5) L'AUTRE PROCESSUS INTERVIENT POUR DE BON entre deux tenues, sur le code actuel : son avoir (clé d'idempotence oubliée par Stripe) pour C, sans marque en base. La seconde tenue relit les soldes
    //      et le compte ; une lecture gardée de la première tenue poserait un SECOND avoir pour C. ──
    await db.col('abo_primes').deleteMany({}); faux.E.customers.get(cu.id).transactions = []; faux.E.customers.get(cu.id).balance = 0; faux.E.idem.clear(); Pub.vider();
    for (let i = 0; i < 10; i++) await db.col('abo_primes').insertOne({ _id: new ObjectId(), parrainId: compte.id, etat: 'applique', appliqueLe: new Date(Date.now() - (i + 1) * 86400e3), montant: 499, creeLe: new Date(Date.now() - (i + 20) * 86400e3) });
    const pa = new ObjectId(), pc = new ObjectId(), pd = new ObjectId();
    await db.col('abo_primes').insertOne({ _id: pa, parrainId: compte.id, etat: 'a-appliquer', creeLe: new Date(Date.now() - 3000) });
    await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() });         // première tenue : A prend le 11e mois
    let interventions = 0;
    await db.col('abo_primes').insertOne({ _id: pc, parrainId: compte.id, etat: 'a-appliquer', creeLe: new Date(Date.now() - 2000) });
    await faux.customers.createBalanceTransaction(cu.id, { amount: -499, currency: 'eur', description: 'posé par un processus mort', metadata: { rm_prime: String(pc), rm_parrain: String(compte.id) } }, { idempotencyKey: 'cle-oubliee-par-stripe' }); interventions++;
    await db.col('abo_primes').insertOne({ _id: pd, parrainId: compte.id, etat: 'a-appliquer', creeLe: new Date(Date.now() - 1000) });
    await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() });         // seconde tenue
    const avoirsDe = id => (faux.E.customers.get(cu.id).transactions || []).filter(t => t.amount < 0 && t.metadata.rm_prime === String(id)).length;
    H.v('M5 : l\'autre processus est intervenu entre deux tenues (compté)', interventions, 1);
    H.v('   la seconde tenue RELIT : l\'avoir mort de C est compté (C appliquée, UN seul avoir pour C, aucun doublon), et le plafond tient (D refusée, aucun avoir pour D)', [await etatDe(pa), await etatDe(pc), avoirsDe(pc), await etatDe(pd), avoirsDe(pd)], ['applique', 'applique', 1, 'refusee', 0]);

    // ── 5. (M6) LE VERROU, ORDONNÉ SANS COURSE : A est suspendue ENTRE la décision du plafond et l'écriture de son avoir (le crochet est dans le faux Stripe), puis B est lancée. Avec le verrou, B attend et voit
    //      l'avoir de A (refusée) ; sans verrou, B voit 11 mois, pose le sien, puis A reprend : 13 mois. Aucune course au hasard : l'ordre est celui du banc. ──
    const dormir = ms => new Promise(r => setTimeout(r, ms));
    await db.col('abo_primes').deleteMany({}); faux.E.customers.get(cu.id).transactions = []; faux.E.customers.get(cu.id).balance = 0; faux.E.idem.clear(); Pub.vider();
    for (let i = 0; i < 11; i++) await db.col('abo_primes').insertOne({ _id: new ObjectId(), parrainId: compte.id, etat: 'applique', appliqueLe: new Date(Date.now() - (i + 1) * 86400e3), montant: 499, creeLe: new Date(Date.now() - (i + 20) * 86400e3) });
    const ma = new ObjectId(), mb = new ObjectId();
    for (const [id, age] of [[ma, 2000], [mb, 1000]]) await db.col('abo_primes').insertOne({ _id: id, parrainId: compte.id, etat: 'a-appliquer', creeLe: new Date(Date.now() - age) });
    const creer = faux.customers.createBalanceTransaction; let suspendue = null, reveil = null;
    const aAtteint = new Promise(r => { suspendue = r; }), lacher = new Promise(r => { reveil = r; });
    let premiere = true;
    faux.customers.createBalanceTransaction = async (...x) => { if (premiere) { premiere = false; suspendue(); await lacher; } return creer.apply(faux.customers, x); };
    const execA = Pr.appliquer({ stripe: faux, cfgAbo: cfg, filleulId: ma, maintenant: new Date() });
    await aAtteint;                                                                                     // A a décidé (11 mois < 12) et attend d'écrire
    const execB = Pr.appliquer({ stripe: faux, cfgAbo: cfg, filleulId: mb, maintenant: new Date() });
    await dormir(500);                                                                                 // B a tout le temps de passer si rien ne la retient
    reveil(); await Promise.all([execA, execB]); faux.customers.createBalanceTransaction = creer;
    H.v('M6 : deux traitements ordonnés (A suspendue entre la décision et l\'écriture, B lancée pendant) : le verrou retient B, qui voit l\'avoir de A et est REFUSÉE ; jamais 13 mois', [await etatDe(ma), await etatDe(mb), avoirsDe(ma), avoirsDe(mb)], ['applique', 'refusee', 1, 0]);

    // ── 6. (M4) LA TENUE S'ARRÊTE À MI-EXPIRATION : trois primes en attente, l'horloge de la tenue dépasse la moitié du verrou après la première ⇒ une traitée, deux restent EN ATTENTE, le verrou est rendu,
    //      et la reprise suivante les traite avec une lecture NEUVE. ──
    await db.col('abo_primes').deleteMany({}); faux.E.customers.get(cu.id).transactions = []; faux.E.customers.get(cu.id).balance = 0; faux.E.idem.clear(); Pub.vider();
    const trois = [new ObjectId(), new ObjectId(), new ObjectId()];
    for (let i = 0; i < 3; i++) await db.col('abo_primes').insertOne({ _id: trois[i], parrainId: compte.id, etat: 'a-appliquer', creeLe: new Date(Date.now() - (3 - i) * 1000) });
    let ms = 1000; const creer2 = faux.customers.createBalanceTransaction;
    faux.customers.createBalanceTransaction = async (...x) => { const r = await creer2.apply(faux.customers, x); ms += 200000; return r; };         // la première prime « dure » 200 s sur l'horloge de la tenue
    faux.E.appels.length = 0;
    const r1 = await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date(), maintenantMs: () => ms });
    faux.customers.createBalanceTransaction = creer2;
    H.v('M4 : passé la moitié du verrou, la tenue s\'arrête : 1 prime traitée, 2 restent EN ATTENTE (jamais traitées sans verrou), le verrou est rendu', [r1.faites, await etatDe(trois[0]), await etatDe(trois[1]), await etatDe(trois[2]), await db.col('abo_primes_verrous').countDocuments({})], [1, 'applique', 'a-appliquer', 'a-appliquer', 0]);
    const lectures0 = faux.E.appels.filter(x => x.nom === 'customers.listBalanceTransactions').length;
    const r2 = await Pr.reprendre({ stripe: faux, cfgAbo: cfg, parrainId: compte.id, maintenant: new Date() });
    H.v('   la reprise suivante traite les deux restantes avec une lecture NEUVE des soldes, sans doublon', [r2.faites, await etatDe(trois[1]), await etatDe(trois[2]), faux.E.appels.filter(x => x.nom === 'customers.listBalanceTransactions').length - lectures0, avoirsDe(trois[0]) + avoirsDe(trois[1]) + avoirsDe(trois[2])], [2, 'applique', 'applique', 1, 3]);
    await H.fermerBac(); Cl.debrancher(); H.bilan();
})().catch(e => { errOrig('❌', e); process.exit(1); });
