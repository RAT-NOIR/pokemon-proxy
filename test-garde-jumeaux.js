// ============================================================================
// D2 — GARDE PROVISOIRE CONTRE LES FAUX PRIX DES JUMEAUX (chaîne héritée)
// ============================================================================
// CE QUI EST TESTÉ : `garde-jumeaux.js`, le module que la route /api/identifier appelle au moment
// de rendre un verdict FERME. Les accès aux données sont ceux de la production
// (`accesMongoose`, branché sur les trois modèles de la route), joués sur la base EN MÉMOIRE
// (collecte-cartes/base-banc.js) : AUCUNE écriture ni lecture de la production, aucune R2.
//
// LE CAS FONDATEUR : IMG_3237, une Roaring Moon ex qui imprime PRE 162. Le modèle a lu « PAR 251 »,
// la chaîne n'a trouvé qu'un candidat (740794) et l'a affirmé : 29,84 € au lieu de 135,98 €.
// Les deux produits ont la même métacarte (426438) : la même carte de jeu dans deux créneaux.
// ⚠️ L'idProduct du créneau PRE 162 est INVENTÉ ici (900162) : seul 740794 / 426438 vient du cas réel.
//
// USAGE : $env:MONGOMS_DOWNLOAD_DIR='…\.banc-local\cache-mongod'; node test-garde-jumeaux.js
process.env.MONGODB_BASE = 'test_scratch';
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { ouvrirBanc } = require('./collecte-cartes/base-banc');

let echecs = 0, total = 0;
const v = (nom, obtenu, attendu) => {
    total++;
    const ok = JSON.stringify(obtenu) === JSON.stringify(attendu);
    if (!ok) echecs++;
    console.log(`${ok ? '✅' : '❌'} ${nom} : ${JSON.stringify(obtenu)}${ok ? '' : `  (attendu ${JSON.stringify(attendu)})`}`);
};

(async () => {
    const banc = await ouvrirBanc();
    banc.appliquer();
    const { creerGardeJumeaux, accesMongoose, verdictApresGarde, PLAFOND_PRODUITS } = require('./garde-jumeaux');

    await mongoose.connect(banc.uri, { dbName: 'test_scratch', autoIndex: false });
    const base = mongoose.connection.db.databaseName;
    if (base !== 'test_scratch') { console.error(`❌ REFUS : base « ${base} »`); process.exit(1); }

    // Les trois modèles, avec les mêmes noms de champs et de collections que index.js.
    const CatalogueProduit = mongoose.model('CatalogueProduit', new mongoose.Schema({ idProduct: Number, name: String, idExpansion: Number, idMetacard: Number }), 'catalogue_produits');
    const NumeroCarte = mongoose.model('NumeroCarte', new mongoose.Schema({ idProduct: Number, idExpansion: Number, numero: String, numeroUrl: String }), 'numeros_cartes');
    const CodeSet = mongoose.model('CodeSet', new mongoose.Schema({ idExpansion: Number, codeSet: String }), 'codes_set');
    const raz = async () => { await CatalogueProduit.deleteMany({}); await NumeroCarte.deleteMany({}); await mongoose.connection.db.collection('codes_set').deleteMany({}); };
    const produit = (idProduct, idExpansion, idMetacard) => ({ idProduct, idExpansion, idMetacard, name: `P${idProduct}` });
    const numero = (idProduct, idExpansion, n) => ({ idProduct, idExpansion, numero: n });
    // `region` n'est pas dans le schéma de CodeSet (comme en production) : écrit en brut.
    const region = (idExpansion, r) => mongoose.connection.db.collection('codes_set').insertOne({ idExpansion, codeSet: `X${idExpansion}`, ...(r ? { region: r } : {}) });
    const garde = (opts = {}) => creerGardeJumeaux({ ...accesMongoose({ CatalogueProduit, NumeroCarte, CodeSet, mongoose }), ...opts });

    v('plafond : 3 produits en tout', PLAFOND_PRODUITS, 3);

    // ── 1. IMG_3237 : deux créneaux, une métacarte -> JUMEAUX ───────────
    await raz();
    await CatalogueProduit.insertMany([produit(740794, 100, 426438), produit(900162, 200, 426438), produit(1, 100, 5)]);
    await NumeroCarte.insertMany([numero(740794, 100, '251'), numero(900162, 200, '162')]);
    await region(100, 'intl'); await region(200, 'intl');
    {
        const g = garde();
        const r = await g.chercher(740794);
        v('IMG_3237 : état', r.etat, 'jumeaux');
        v('IMG_3237 : le jumeau est le PRE 162', r.jumeaux, [900162]);
        v('IMG_3237 : décision = incertain, pas de refus', (({ incertain, refus }) => ({ incertain, refus }))(verdictApresGarde(r)), { incertain: true, refus: false });
        v('IMG_3237 : candidats à montrer = le gagnant puis le jumeau', verdictApresGarde(r).candidatsExtra, [900162]);
        v('IMG_3237 : raison de réserve', verdictApresGarde(r).raison, 'jumeaux-garde');
        const rj = await g.chercher(900162);
        v('symétrie : le PRE 162 voit le PAR 251', rj.jumeaux, [740794]);
    }

    // ── 2. AUCUN JUMEAU -> RIEN NE CHANGE ───────────────────────────────
    {
        const r = await garde().chercher(1);
        v('métacarte à un seul produit : aucun', r.etat, 'aucun');
        v('   décision : ni réserve ni refus', (({ incertain, refus }) => ({ incertain, refus }))(verdictApresGarde(r)), { incertain: false, refus: false });
    }

    // ── 3. LES VARIANTES DU MÊME CRÉNEAU NE SONT PAS DES JUMEAUX ────────
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 100, 7), produit(12, 100, 7)]);
    await NumeroCarte.insertMany([numero(10, 100, '025'), numero(11, 100, '25'), numero(12, 100, '025')]);
    await region(100, 'intl');
    {
        const r = await garde().chercher(10);
        v('V1/V2/reverse (même expansion, même numéro normalisé « 025 »=« 25 ») : aucun', r.etat, 'aucun');
    }

    // ── 4. MÊME EXPANSION, NUMÉRO INCONNU -> FERMÉ : jumeau ─────────────
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 100, 7)]);
    await NumeroCarte.insertMany([numero(10, 100, '25')]);   // 11 : aucune ligne numeros_cartes
    await region(100, 'intl');
    {
        const r = await garde().chercher(10);
        v('créneau inconnu d\'un voisin : il reste un jumeau', r.jumeaux, [11]);
    }

    // ── 5. MÊME EXPANSION, DEUX NUMÉROS -> deux créneaux ────────────────
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 100, 7)]);
    await NumeroCarte.insertMany([numero(10, 100, '188'), numero(11, 100, '276')]);   // Super Rod 188 et 276
    await region(100, 'intl');
    {
        const r = await garde().chercher(10);
        v('même expansion, numéros différents : jumeau', r.jumeaux, [11]);
    }

    // ── 6. LA LANGUE DU TIRAGE ──────────────────────────────────────────
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 200, 7), produit(12, 300, 7)]);
    await NumeroCarte.insertMany([numero(10, 100, '1'), numero(11, 200, '1'), numero(12, 300, '1')]);
    await region(100, 'intl'); await region(200, 'jp'); await region(300, null);   // 300 : région inconnue
    {
        const r = await garde().chercher(10);
        v('région jp ≠ intl : pas un jumeau ; région inconnue : reste un jumeau', r.jumeaux, [12]);
        const rj = await garde().chercher(11);
        v('le produit jp voit le voisin de région inconnue seulement', rj.jumeaux, [12]);
    }

    // ── 7. 2 JUMEAUX = 3 PRODUITS EN TOUT : encore une réserve ; 3 JUMEAUX : REFUS ──
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 200, 7), produit(12, 300, 7)]);
    await NumeroCarte.insertMany([numero(10, 100, '1'), numero(11, 200, '1'), numero(12, 300, '1')]);
    for (const e of [100, 200, 300]) await region(e, 'intl');
    {
        const r = await garde().chercher(10);
        v('2 jumeaux (3 produits en tout) : réserve', [r.etat, r.jumeaux], ['jumeaux', [11, 12]]);
        v('   candidats extra dans l\'ordre des idProduct', verdictApresGarde(r).candidatsExtra, [11, 12]);
    }
    await CatalogueProduit.insertMany([produit(13, 400, 7)]);
    await NumeroCarte.insertMany([numero(13, 400, '1')]); await region(400, 'intl');
    {
        const r = await garde({ ttlMs: 0 }).chercher(10);
        v('3 jumeaux (4 produits en tout) : REFUS', r.etat, 'trop');
        const d = verdictApresGarde(r);
        v('   décision : refus, motif jumeaux-trop-nombreux, aucun candidat montré', { refus: d.refus, motif: d.motifRefus, extra: d.candidatsExtra }, { refus: true, motif: 'jumeaux-trop-nombreux', extra: [] });
        v('   le nombre total est dit', r.nbProduits, 4);
        v('   M4 : les jumeaux sont rendus (pour le journal)', r.jumeaux, [11, 12, 13]);
        v('   M4 : la décision porte nbProduits et les ids, mais aucun candidat à montrer', [d.nbProduits, d.jumeauxIds, d.candidatsExtra], [4, [11, 12, 13], []]);
    }

    // ── 8. LA RECHERCHE ÉCHOUE -> JAMAIS D'AFFIRMATION ──────────────────
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 200, 7), produit(20, 100, null), produit(21, 100, 0), produit(30, 100, 8), produit(31, 100, 8)]);
    await NumeroCarte.insertMany([numero(10, 100, '1'), numero(11, 200, '1'), numero(30, 100, '5'), numero(31, 100, '5')]);
    await region(100, 'intl'); await region(200, 'intl');
    {
        const d = r => (({ incertain, refus, candidatsExtra, raison }) => ({ incertain, refus, candidatsExtra, raison }))(verdictApresGarde(r));
        const attendu = { incertain: true, refus: false, candidatsExtra: [], raison: 'jumeaux-recherche-echec' };
        let r = await garde({ lireRegions: async () => { throw new Error('base injoignable'); } }).chercher(10);
        v('lecture des régions en panne : echec', [r.etat, /base injoignable/.test(r.cause)], ['echec', true]);
        v('   décision', d(r), attendu);
        r = await garde({ lireNumeros: async () => { throw new Error('numéros en panne'); } }).chercher(30);
        v('lecture des numéros en panne (voisin de la même expansion) : echec', r.etat, 'echec');
        r = await garde().chercher(30);
        v('   témoin : sans panne, les deux variantes (même numéro) ne sont pas jumelles', r.etat, 'aucun');
        r = await garde({ lireCatalogue: async function* () { throw new Error('catalogue en panne'); } }).chercher(10);
        v('chargement du catalogue en panne : echec', [r.etat, /catalogue en panne/.test(r.cause)], ['echec', true]);
        r = await garde({ lireCatalogue: async function* () { } }).chercher(10);
        v('catalogue VIDE (population non vide attendue) : echec', [r.etat, /vide/.test(r.cause)], ['echec', true]);
        r = await garde({ lireCatalogue: async function* () { yield { idProduct: 10, idExpansion: 100 }; } }).chercher(10);
        v('aucune ligne ne porte idMetacard (champ absent) : echec', [r.etat, /idMetacard/.test(r.cause)], ['echec', true]);
        r = await garde().chercher(20);
        v('produit sans métacarte (null) : echec', [r.etat, /metacarte/.test(r.cause)], ['echec', true]);
        r = await garde().chercher(21);
        v('produit à métacarte 0 : echec', r.etat, 'echec');
        r = await garde().chercher(999999);
        v('produit absent de la table : echec', [r.etat, /absent/.test(r.cause)], ['echec', true]);
        r = await garde().chercher(undefined);
        v('idProduct absent : echec', r.etat, 'echec');
    }

    // ── 9. LA TABLE : TAILLE, RECHARGEMENT, PANNE DE RECHARGEMENT ───────
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 100, 7)]);
    await NumeroCarte.insertMany([numero(10, 100, '1'), numero(11, 100, '1')]);
    await region(100, 'intl');
    {
        let t = 1000;
        let pannes = false;
        const lire = accesMongoose({ CatalogueProduit, NumeroCarte, CodeSet, mongoose }).lireCatalogue;
        const g = garde({ maintenant: () => t, ttlMs: 60000, reessaiMs: 0, lireCatalogue: () => { if (pannes) throw new Error('catalogue en panne'); return lire(); } });
        let r = await g.chercher(10);
        v('chargement : 2 lignes lues', g.etatTable().lignes, 2);
        v('   poids annoncé (octets) = 16 par ligne (4 tableaux Int32)', g.etatTable().octets, 32);
        v('   avant l\'import : aucun jumeau', r.etat, 'aucun');
        await CatalogueProduit.insertMany([produit(12, 200, 7)]); await NumeroCarte.insertMany([numero(12, 200, '1')]); await region(200, 'intl');
        t += 1000;
        r = await g.chercher(10);
        v('dans le TTL : la table n\'est pas relue', r.etat, 'aucun');
        t += 61000;
        r = await g.chercher(10);
        v('TTL écoulé : la table est relue, le nouveau jumeau apparaît', r.jumeaux, [12]);
        pannes = true; t += 61000;
        r = await g.chercher(10);
        v('I1 : TTL écoulé ET rechargement en panne : echec tout de suite (l\'ancienne table ne sert plus), la cause est dite', [r.etat, /catalogue en panne/.test(r.cause), g.etatTable().derniereErreur != null], ['echec', true, true]);
        t += 24 * 3600 * 1000;
        r = await g.chercher(10);
        v('   24 h plus tard, toujours en panne : echec', r.etat, 'echec');
        pannes = false;
        r = await g.chercher(10);
        v('la panne passée : la table revient', r.etat, 'jumeaux');
    }

    // ── 9 bis. I1 — LA FRAÎCHEUR PAR LE COMPTE DU CATALOGUE ─────────────
    await raz();
    await CatalogueProduit.insertMany([produit(10, 100, 7), produit(11, 100, 7)]);
    await NumeroCarte.insertMany([numero(10, 100, '1'), numero(11, 100, '1')]);
    await region(100, 'intl');
    {
        let t = 0, comptes = 0, rechargements = 0, comptePanne = false;
        const acces = accesMongoose({ CatalogueProduit, NumeroCarte, CodeSet, mongoose });
        const g = garde({
            maintenant: () => t, ttlMs: 6 * 3600 * 1000, reessaiMs: 0,
            lireCatalogue: () => { rechargements++; return acces.lireCatalogue(); },
            lireCompte: async () => { comptes++; if (comptePanne) throw new Error('compte en panne'); return acces.lireCompte(); }
        });
        let r = await g.chercher(10);
        v('chargement initial : 1 lecture du catalogue, aucune lecture du compte', [rechargements, comptes, r.etat], [1, 0, 'aucun']);
        await CatalogueProduit.insertMany([produit(12, 200, 7)]); await NumeroCarte.insertMany([numero(12, 200, '1')]); await region(200, 'intl');
        t += 30000;
        r = await g.chercher(10);
        v('moins de 60 s : le compte n\'est pas relu, la table sert (le jumeau neuf attend)', [comptes, rechargements, r.etat], [0, 1, 'aucun']);
        t += 31000;
        r = await g.chercher(10);
        v('61 s : le compte a changé -> rechargement AVANT de juger, le jumeau du produit neuf est vu', [comptes, rechargements, r.jumeaux], [1, 2, [12]]);
        t += 61000;
        r = await g.chercher(10);
        v('compte inchangé : lu, mais pas de rechargement', [comptes, rechargements, r.jumeaux], [2, 2, [12]]);
        r = await g.chercher(10);
        v('   deux scans dans la même minute : une seule lecture du compte', comptes, 2);
        comptePanne = true; t += 61000;
        r = await g.chercher(10);
        v('lecture du compte en panne : echec (jamais une affirmation sur une fraîcheur inconnue)', [r.etat, /compte en panne/.test(r.cause)], ['echec', true]);
        comptePanne = false;
        r = await g.chercher(10);
        v('   la panne passée : la garde revient', r.etat, 'jumeaux');
    }

    // ── 10. UNE SEULE LECTURE POUR PLUSIEURS SCANS SIMULTANÉS ──────────
    {
        let lectures = 0;
        const lire = accesMongoose({ CatalogueProduit, NumeroCarte, CodeSet, mongoose }).lireCatalogue;
        const g = garde({ lireCatalogue: () => { lectures++; return lire(); } });
        await Promise.all([g.chercher(10), g.chercher(11), g.chercher(10)]);
        v('3 scans simultanés au démarrage : UNE lecture du catalogue', lectures, 1);
    }

    // ── 11. LA RÈGLE DE DÉCISION, SANS BASE ─────────────────────────────
    {
        v('non jouée / aucun : rien ne change', verdictApresGarde({ etat: 'aucun' }).incertain, false);
        v('état inconnu : FERMÉ (réserve), jamais d\'affirmation', (({ incertain, raison }) => ({ incertain, raison }))(verdictApresGarde({ etat: 'inventé' })), { incertain: true, raison: 'jumeaux-recherche-echec' });
        v('résultat absent : FERMÉ', verdictApresGarde(undefined).incertain, true);
    }

    // ── 11 ter. I3 — LA DÉCISION DE LA ROUTE, FONCTION PURE : ferme / reserve / refus ──
    {
        const { appliquerGarde } = require('./garde-jumeaux');
        const a = (r, o) => verdictApresGarde(r, o).action;
        v('aucun -> ferme', a({ etat: 'aucun' }), 'ferme');
        v('jumeaux (1 ou 2) -> reserve, raison jumeaux-garde', [a({ etat: 'jumeaux', jumeaux: [11] }), verdictApresGarde({ etat: 'jumeaux', jumeaux: [11, 12] }).raison], ['reserve', 'jumeaux-garde']);
        v('jumeaux avec 0 ou 3 ids -> reserve d\'échec, jamais ferme', [a({ etat: 'jumeaux', jumeaux: [] }), a({ etat: 'jumeaux', jumeaux: [1, 2, 3] })], ['reserve', 'reserve']);
        v('trop -> refus, motif et nbProduits', (({ action, motifRefus, nbProduits }) => ({ action, motifRefus, nbProduits }))(verdictApresGarde({ etat: 'trop', jumeaux: [11, 12, 13], nbProduits: 4 })), { action: 'refus', motifRefus: 'jumeaux-trop-nombreux', nbProduits: 4 });
        v('echec -> reserve, raison jumeaux-recherche-echec', [a({ etat: 'echec', cause: 'x' }), verdictApresGarde({ etat: 'echec' }).raison], ['reserve', 'jumeaux-recherche-echec']);
        const inattendus = [undefined, null, {}, { etat: 'inventé' }, { etat: 'AUCUN' }, { etat: '' }, { etat: 42 }, 'aucun', 0, []];
        v('valeurs inattendues (' + inattendus.length + ') -> jamais ferme', inattendus.map(x => a(x)).filter(x => x === 'ferme').length, 0);
        v('déjà sous réserve avant la garde : reserve, non-jouee, la garde n\'est pas consultée', (({ action, issue, raison }) => ({ action, issue, raison }))(verdictApresGarde({ etat: 'trop' }, { ambigueAvantGarde: true })), { action: 'reserve', issue: 'non-jouee', raison: null });
        let appels = 0;
        const faux = { chercher: async id => { appels++; return { etat: 'aucun', jumeaux: [], nbProduits: 1, cause: null }; } };
        let x = await appliquerGarde({ ambigueAvantGarde: true, idProduct: 5, garde: faux });
        v('appliquerGarde : déjà ambigu -> 0 appel', [appels, x.decision.action], [0, 'reserve']);
        x = await appliquerGarde({ ambigueAvantGarde: false, idProduct: 5, garde: faux });
        v('appliquerGarde : verdict ferme -> 1 appel, ferme', [appels, x.decision.action], [1, 'ferme']);
        x = await appliquerGarde({ ambigueAvantGarde: false, idProduct: 5, garde: { chercher: async () => { throw new Error('boum'); } } });
        v('appliquerGarde : la garde LÈVE -> reserve d\'échec, jamais ferme', [x.decision.action, x.resultat.etat, /boum/.test(x.resultat.cause)], ['reserve', 'echec', true]);
        x = await appliquerGarde({ ambigueAvantGarde: false, idProduct: 5, garde: { chercher: async () => undefined } });
        v('appliquerGarde : la garde rend undefined -> reserve', x.decision.action, 'reserve');
    }

    // ── 11 quater. I2 — LE REMBOURSEMENT HORS PLAFOND, UNE SEULE FOIS PAR SCAN ──
    {
        const { rembourserScan, Credit } = require('./acces');
        const u = `T-jumeaux-${Date.now()}`;
        await Credit.deleteOne({ userId: u });
        await Credit.create({ userId: u, soldeGratuit: 5, soldePayant: 0 });
        const resultats = [];
        for (let i = 0; i < 6; i++) {
            const req = { credit: { userId: u, poche: 'accueil' } };
            resultats.push(await rembourserScan(req, 'jumeaux-trop-nombreux', { sansPlafond: true }));
        }
        v('6 refus jumeaux-trop-nombreux le même jour, même client : 6 remboursements', resultats, [true, true, true, true, true, true]);
        v('   le solde a monté de 6', (await Credit.findOne({ userId: u }).lean()).soldeGratuit, 11);
        const req2 = { credit: { userId: u, poche: 'accueil' } };
        const un = await rembourserScan(req2, 'jumeaux-trop-nombreux', { sansPlafond: true });
        const deux = await rembourserScan(req2, 'jumeaux-trop-nombreux', { sansPlafond: true });
        v('un 2e remboursement du MÊME scan est refusé', [un, deux, (await Credit.findOne({ userId: u }).lean()).soldeGratuit], [true, false, 12]);
        // témoin : sans l'option, le plafond des refus s'applique encore (les autres appelants ne changent pas)
        const u2 = `T-jumeaux-plafond-${Date.now()}`;
        await Credit.create({ userId: u2, soldeGratuit: 5, soldePayant: 0 });
        const sans = [];
        for (let i = 0; i < 6; i++) sans.push(await rembourserScan({ credit: { userId: u2, poche: 'accueil' } }, 'egalite-parfaite'));
        v('témoin : les autres appelants gardent le plafond (5 par jour)', sans, [true, true, true, true, true, false]);
        await Credit.deleteMany({ userId: { $in: [u, u2] } });
        await mongoose.connection.db.collection('remboursements').deleteMany({ userId: { $in: [u, u2] } });
    }

    // ── 11 quinquies. M3 — LA NORMALISATION DU NUMÉRO VIENT DE LA PRODUCTION ──
    {
        const { cleNumero } = require('./collecte-cartes/jointure');
        v('cleNumero : « 025 » = « 25 »', cleNumero('025') === cleNumero('25'), true);
        v('   un préfixe alphabétique est gardé (SWSH294 ≠ 294, TG16 ≠ 16)', [cleNumero('SWSH294') !== cleNumero('294'), cleNumero('TG16') !== cleNumero('16')], [true, true]);
        v('   un suffixe est gardé (1N ≠ 1S)', cleNumero('1N') !== cleNumero('1S'), true);
    }

    // ── 11 bis. LES CANDIDATS MONTRÉS ───────────────────────────────────
    {
        const { tetesDesCandidats } = require('./garde-jumeaux');
        const classement = [{ idProduct: 10, prix: 29.84, idExpansion: 100 }, { idProduct: 77, prix: 1, idExpansion: 300 }, { idProduct: 78, prix: 2 }, { idProduct: 79, prix: 3 }];
        const acces = { lireNoms: async ids => new Map(ids.map(i => [i, `Nom ${i}`])), lirePrix: async id => ({ 11: 135.98 })[id] ?? null };
        const jum = { issue: 'jumeaux', candidatsExtra: [11, 12] };
        let t = await tetesDesCandidats({ decision: jum, classement, carteAmbigue: true, ...acces });
        v('jumeaux : le gagnant puis les jumeaux, rien d\'autre du classement', t.tetes.map(x => x.idProduct), [10, 11, 12]);
        v('   prix du jumeau lu à part, inconnu = null (jamais inventé)', t.tetes.map(x => x.prix), [29.84, 135.98, null]);
        v('   noms des jumeaux', [...t.noms.entries()], [[11, 'Nom 11'], [12, 'Nom 12']]);
        t = await tetesDesCandidats({ decision: jum, classement, carteAmbigue: true, lireNoms: async () => { throw new Error('x'); }, lirePrix: async () => { throw new Error('y'); }, journal: {} });
        v('   noms et prix en panne : les jumeaux restent montrés, sans prix', t.tetes.map(x => [x.idProduct, x.prix]), [[10, 29.84], [11, null], [12, null]]);
        t = await tetesDesCandidats({ decision: { issue: 'echec', candidatsExtra: [] }, classement, carteAmbigue: true, ...acces });
        v('échec : le seul produit', t.tetes.map(x => x.idProduct), [10]);
        t = await tetesDesCandidats({ decision: { issue: 'aucun', candidatsExtra: [] }, classement, carteAmbigue: false, ...acces });
        v('aucun jumeau, verdict ferme : le gagnant seul (inchangé)', t.tetes.map(x => x.idProduct), [10]);
        t = await tetesDesCandidats({ decision: { issue: 'non-jouee', candidatsExtra: [] }, classement, carteAmbigue: true, ...acces });
        v('déjà sous réserve : le top 3 du classement (inchangé)', t.tetes.map(x => x.idProduct), [10, 77, 78]);
    }

    // ── 12. LE BRANCHEMENT DANS LA ROUTE (lecture du source : la route entière exige IA + TCGdex) ──
    {
        const src = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8');
        const j = fs.readFileSync(path.join(__dirname, 'journal-scans.js'), 'utf8');
        v('index.js appelle la garde par appliquerGarde, avec ambigueAvantGarde', /appliquerGarde\(\{\s*ambigueAvantGarde,\s*idProduct: classement\[0\]\?\.idProduct,\s*garde: gardeJumeaux/.test(src), true);
        v('index.js : carteAmbigue = ambigu avant la garde OU décision « reserve »', /const carteAmbigue = Boolean\(ambigueAvantGarde \|\| decisionGarde\.action === 'reserve'\)/.test(src), true);
        v('index.js : le refus passe par champsDeRefus, remboursé hors plafond', /if \(decisionGarde\.action === 'refus'\)[\s\S]{0,900}rembourserScan\(req, decisionGarde\.motifRefus, \{ sansPlafond: true \}\)[\s\S]{0,900}champsDeRefus\(decisionGarde\.motifRefus, rendu\)/.test(src), true);
        v('NATURE_REFUS classe le motif en refus délibéré', /'jumeaux-trop-nombreux': 'refus-delibere'/.test(src), true);
        v('NIVEAU_RESERVE classe les deux raisons en faible', /'jumeaux-garde': 'faible'/.test(src) && /'jumeaux-recherche-echec': 'faible'/.test(src), true);
        v('journal : champ gardeJumeaux déclaré au schéma', /gardeJumeaux: String/.test(j), true);
        v('journal (M4) : gardeJumeauxNb et gardeJumeauxIds déclarés, écrits, et passés par enregistrerEchec', /gardeJumeauxNb: Number/.test(j) && /gardeJumeauxNb: Number\.isFinite/.test(j) && (j.match(/gardeJumeauxIds, gardeJumeauxNb/g) || []).length === 2, true);
        v('journal : champ écrit par enregistrerScan',/gardeJumeaux: d\.gardeJumeaux/.test(j), true);
    }

    await mongoose.disconnect();
    await banc.arreter();
    console.log(`\n${total - echecs}/${total} assertions passées, ${echecs} en échec.`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
