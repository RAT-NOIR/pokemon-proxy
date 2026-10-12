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
        v('rechargement en panne, table encore récente : l\'ancienne sert, la cause est dite', [r.etat, g.etatTable().derniereErreur != null], ['jumeaux', true]);
        t += 24 * 3600 * 1000;
        r = await g.chercher(10);
        v('rechargement en panne ET table périmée (> 4 TTL) : echec, jamais d\'affirmation', r.etat, 'echec');
        pannes = false;
        r = await g.chercher(10);
        v('la panne passée : la table revient', r.etat, 'jumeaux');
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
        v('index.js appelle la garde sur le verdict ferme seulement', /ambigueAvantGarde[\s\S]{0,400}gardeJumeaux\.chercher\(/.test(src), true);
        v('index.js : carteAmbigue inclut la garde', /const carteAmbigue = Boolean\(\s*ambigueAvantGarde \|\| decisionGarde\.incertain/.test(src), true);
        v('index.js : le refus passe par champsDeRefus', /if \(decisionGarde\.refus\)[\s\S]{0,900}rembourserScan\(req, decisionGarde\.motifRefus\)[\s\S]{0,900}champsDeRefus\(decisionGarde\.motifRefus, rendu\)/.test(src), true);
        v('NATURE_REFUS classe le motif en refus délibéré', /'jumeaux-trop-nombreux': 'refus-delibere'/.test(src), true);
        v('NIVEAU_RESERVE classe les deux raisons en faible', /'jumeaux-garde': 'faible'/.test(src) && /'jumeaux-recherche-echec': 'faible'/.test(src), true);
        v('journal : champ gardeJumeaux déclaré au schéma', /gardeJumeaux: String/.test(j), true);
        v('journal : champ écrit par enregistrerScan', /gardeJumeaux: d\.gardeJumeaux/.test(j), true);
    }

    await mongoose.disconnect();
    await banc.arreter();
    console.log(`\n${total - echecs}/${total} assertions passées, ${echecs} en échec.`);
    process.exit(echecs ? 1 : 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
