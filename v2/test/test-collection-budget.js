'use strict';
// COLLECTION-COMPACTE — le MODÈLE DE COÛT contre `collStats` (données + index, après `fsync` et une pause : sans eux `indexSizes` est faux, leçon du lot COLLECTION), sur des formes EXTRÊMES, puis les
// MESURES du contrat : un collectionneur complet du catalogue, un compte malveillant, ce que tiennent les 10 Mo, le pire cas. Base EN MÉMOIRE (INT2) ; collections de banc nommées « zz_budget_… » (supprimées).
// Le banc ÉCHOUE si une forme coûte plus que ce que le modèle réserve (couts.js), et il sait dire NON : un modèle amputé est refusé par la même comparaison.
const H = require('./_harnais');
const fs = require('fs'), crypto = require('crypto');
const mongoose = require('mongoose');
const { Long, ObjectId } = mongoose.mongo;
const C = require('../collection/couts');
const { lireConfig } = require('../config');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const attendre = ms => new Promise(r => setTimeout(r, ms));
const hex = n => crypto.randomBytes(Math.ceil(n / 2)).toString('hex').slice(0, n);
const cle45 = () => `${String(Math.floor(Math.random() * 9e11) + 1e11)}|${hex(32)}`;                  // la clé la plus longue admise : 12 chiffres + « | » + 32 caractères = 45 o
const cleReelle = () => `${Math.floor(Math.random() * 760000) + 1}|${String(Math.floor(Math.random() * 300) + 1).padStart(3, '0')}`;   // ~ la clé moyenne du catalogue réel (6 chiffres, « | », 3)
const PLEIN = Long.fromBits(-1, -1), Mo = x => (x / 1048576).toFixed(2);
const FICHIER = 'C:\\Users\\Yung\\rat-market-travail\\api\\_mesures\\collection\\mesure.json';

(async () => {
    await H.ouvrirBancV2();
    const bdd = (async () => { process.env.MONGODB_BASE = 'test_scratch'; const { connecterMongo } = require('../../mongo-connexion'); await connecterMongo({ script: 'test-collection-budget.js', ecrit: true }); return mongoose.connection.db; })();
    const B = await bdd;
    const formes = [];       // { nom, indexUnique, docs: () => iterable, modele: doc => octets }
    const fiche = (compteId, set, mots, horsL, qte) => ({ compteId, set, mots, hors: horsL, ...(qte ? { qte } : {}), majLe: new Date() });
    const motsPleins = n => Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), PLEIN]));
    const modeleFiche = d => C.coutDuDocument(d);
    const modeleRegistre = d => C.registreDocument(d._id) + d.cles.reduce((n, k) => n + C.registreEntree(k), 0);

    // ── les formes extrêmes d'un document de COMPTE
    const A = Array.from({ length: 20 }, () => new ObjectId());
    formes.push({ nom: 'A. 1 clé par document, slug de 80 caractères, 20 comptes × 150 documents', fiches: true, docs: () => A.flatMap(id => Array.from({ length: 150 }, () => fiche(id, hex(80), { 0: Long.fromBits(1, 0) }, []))) });
    const un = new ObjectId();
    formes.push({ nom: 'B. 1 clé par document, slug de 80 caractères, UN compte × 3 000 documents (le préfixe d\'index le plus partagé)', fiches: true, docs: () => Array.from({ length: 3000 }, () => fiche(un, hex(80), { 0: Long.fromBits(1, 0) }, [])) });
    formes.push({ nom: 'C. des clés HORS de 45 o avec quantité (48 o), 5 comptes × 3 documents × 2 000 clés', fiches: true, docs: () => Array.from({ length: 5 }, () => new ObjectId()).flatMap(id => Array.from({ length: 3 }, () => fiche(id, hex(20), {}, Array.from({ length: 2000 }, () => `${cle45()}\n99`)))) });
    formes.push({ nom: 'D. des mots pleins : 5 documents de 1 100 mots de 64 bits (noms de 4 chiffres)', fiches: true, docs: () => Array.from({ length: 5 }, () => fiche(new ObjectId(), hex(30), motsPleins(1100), [])) });
    formes.push({ nom: 'E. des quantités : 5 documents de 2 000 entrées `qte` (positions de 5 chiffres)', fiches: true, docs: () => Array.from({ length: 5 }, () => fiche(new ObjectId(), hex(30), { 0: Long.fromBits(1, 0) }, [], Object.fromEntries(Array.from({ length: 2000 }, (_, i) => [String(10000 + i), 99])))) });
    // ── les formes extrêmes du REGISTRE
    formes.push({ nom: 'F. registre : 3 documents de 3 000 clés de 45 o', registre: true, docs: () => Array.from({ length: 3 }, () => ({ _id: hex(60), cles: Array.from({ length: 3000 }, cle45) })) });
    formes.push({ nom: 'G. registre : 1 500 documents d\'une clé, identifiant de 80 caractères', registre: true, docs: () => Array.from({ length: 1500 }, () => ({ _id: hex(80), cles: [cle45()] })) });

    // ── le COMPTE MALVEILLANT : `hors` plein de clés de 45 o sur 1 000 sets fictifs (slug de 80 caractères), plafond horsCatalogueParCompte
    const NH = cfg.collection.horsCatalogueParCompte, NS = cfg.collection.setsParCompte;
    const malveillant = () => { const id = new ObjectId(); return Array.from({ length: NS }, (_, i) => fiche(id, hex(80), {}, Array.from({ length: Math.floor(NH / NS) + (i < NH % NS ? 1 : 0) }, cle45))); };
    formes.push({ nom: `M. compte MALVEILLANT : ${NH} clés hors de 45 o sur ${NS} sets fictifs de 80 caractères`, fiches: true, unCompte: true, docs: malveillant });

    // ── le COLLECTIONNEUR COMPLET : toutes les fiches du plus grand compte mesuré, réparties sur les vrais sets de la sauvegarde
    let mesure = null;
    if (fs.existsSync(FICHIER)) mesure = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    else console.log(`   SAUT DIT : ${FICHIER} absent de cette machine — le collectionneur complet n'est pas mesuré`);
    if (mesure) {
        const idC = new ObjectId();
        formes.push({ nom: `K. collectionneur COMPLET : ${mesure.regleDuSite.fiches} fiches (${mesure.archive.fiches} au registre + ${mesure.horsRegistre.total} hors) sur ${mesure.parSet.length} sets`, fiches: true, unCompte: true, complet: true,
            docs: () => mesure.parSet.map(([id, site, arch]) => fiche(idC, id, motsPleins(Math.ceil(arch / 64)), Array.from({ length: site - arch }, cleReelle))) });
        formes.push({ nom: `R. le REGISTRE complet de ces ${mesure.parSet.length} sets (${mesure.archive.fiches} clés)`, registre: true, complet: true,
            docs: () => mesure.parSet.map(([id, site, arch]) => ({ _id: id, cles: Array.from({ length: arch }, cleReelle) })) });
    }

    // ── tout est créé, rempli, puis UN fsync et une pause avant de lire collStats
    const suffixe = Date.now().toString(36);
    for (const f of formes) {
        f.coll = `zz_budget_${suffixe}_${formes.indexOf(f)}`;
        const c = B.collection(f.coll);
        if (f.fiches) await c.createIndex({ compteId: 1, set: 1 }, { unique: true });
        f.docsMat = f.docs(); f.modele = f.docsMat.reduce((n, d) => n + (f.fiches ? modeleFiche(d) : modeleRegistre(d)), 0);
        for (let i = 0; i < f.docsMat.length; i += 500) await c.insertMany(f.docsMat.slice(i, i + 500));
    }
    const vides = {};
    for (const [nom, uniq] of [['fiches', true], ['registre', false]]) { const c = B.collection(`zz_budget_${suffixe}_vide_${nom}`); if (uniq) await c.createIndex({ compteId: 1, set: 1 }, { unique: true }); await c.insertOne(uniq ? fiche(new ObjectId(), 'x', {}, []) : { _id: 'x', cles: [] }); }
    await B.admin().command({ fsync: 1 }); await attendre(2000);
    for (const nom of ['fiches', 'registre']) { const st = await B.command({ collStats: `zz_budget_${suffixe}_vide_${nom}` }); vides[nom] = st.size + st.totalIndexSize; await B.collection(`zz_budget_${suffixe}_vide_${nom}`).drop(); }
    for (const f of formes) {
        const st = await B.command({ collStats: f.coll });
        f.donnees = st.size; f.index = st.totalIndexSize; f.mesure = st.size + st.totalIndexSize; f.net = f.mesure - vides[f.fiches ? 'fiches' : 'registre']; f.n = f.docsMat.length;
        await B.collection(f.coll).drop(); f.docsMat = null;
    }

    // ── 1. le modèle couvre chaque forme extrême
    console.log(`   collStats (fsync + 2 s) ; base vide soustraite : ${Mo(vides.fiches)} Mo (fiches), ${Mo(vides.registre)} Mo (registre)`);
    for (const f of formes) {
        console.log(`   ${f.nom} : ${f.n} documents · mesuré ${f.net} o (données ${f.donnees} + index ${f.index}, moins la base vide) · modèle ${f.modele} o · rapport mesuré/modèle ${(f.net / f.modele).toFixed(3)}`);
        H.vrai(`1. le modèle de coût couvre la forme « ${f.nom.split(':')[0].split('.')[0]} » : modèle ≥ mesuré`, f.modele >= f.net);
    }
    // le banc sait dire NON : un modèle amputé (mot à 8 o au lieu de 16, élément de tableau à 6 o d'en-tête) ne couvre plus les formes D et C
    const D = formes.find(f => f.nom.startsWith('D.')), Cc = formes.find(f => f.nom.startsWith('C.'));
    H.vrai('   ↳ un modèle amputé (mot de 8 o) ne couvre PAS la forme D — le banc sait dire NON', D.modele - 5 * 1100 * 8 < D.net);
    H.vrai('   ↳ un modèle amputé (en-tête d\'élément de 4 o) ne couvre PAS la forme C — le banc sait dire NON', Cc.modele - 5 * 3 * 2000 * (C.ELEMENT - 4) < Cc.net);
    const A1 = formes.find(f => f.nom.startsWith('A.'));
    H.vrai('   ↳ un document modélisé à 150 o (au lieu de 300 + 2 × slug) ne couvre PAS la forme A — le banc sait dire NON', A1.n * (150 + 2 * 80 + C.mot) < A1.net);

    // ── 2. les MESURES du contrat
    const M = formes.find(f => f.nom.startsWith('M.')), K = formes.find(f => f.nom.startsWith('K.')), R = formes.find(f => f.nom.startsWith('R.'));
    const plafond = cfg.collection.octetsService;
    console.log(`   MESURE compte malveillant : ${M.net} o mesurés (modèle ${M.modele}) → ${Math.floor(plafond / M.modele)} comptes malveillants remplissent ${Mo(plafond)} Mo (au modèle) ; ${Math.floor(plafond / M.net)} au mesuré`);
    H.vrai('2. un compte malveillant (hors plein sur 1 000 sets) pèse moins que le plafond du service : une écriture refusée est possible avant qu\'il ne le dépasse', M.modele < plafond);
    if (K) {
        const registre = R.net, parCollectionneur = K.net, parCollectionneurModele = K.modele;
        const tenusMesure = Math.floor((plafond - registre) / parCollectionneur), tenusModele = Math.floor((plafond - R.modele) / parCollectionneurModele);
        console.log(`   MESURE collectionneur complet : ${K.net} o mesurés (${(K.net / 1024).toFixed(1)} Ko), modèle ${K.modele} o ; registre complet : ${R.net} o mesurés (${(R.net / 1024).toFixed(1)} Ko), modèle ${R.modele} o`);
        console.log(`   MESURE ce que tiennent ${Mo(plafond)} Mo : (plafond − registre complet) / collectionneur = ${tenusMesure} collectionneurs complets au mesuré, ${tenusModele} au modèle (le compteur réserve le modèle)`);
        console.log(`   MESURE pire cas en octets sous le plafond : le compteur refuse au-delà de ${plafond} o du MODÈLE ; la forme la plus défavorable mesurée est ${(Math.max(...formes.map(f => f.net / f.modele))).toFixed(3)} × le modèle → au plus ${Mo(plafond * Math.max(...formes.map(f => f.net / f.modele)))} Mo réels, plus le dépassement concurrent borné (écritures en vol × le coût d'une écriture au pire : ${C.document('x'.repeat(80)) + C.mot + C.registreEntree(cle45()) + C.registreDocument('x'.repeat(80)) + C.qte} o)`);
        H.vrai('   un collectionneur COMPLET tient sous le plafond du service avec de la marge (registre compris)', K.modele + R.modele < plafond && tenusModele >= 1);
        H.vrai('   le plafond par compte couvre le collectionneur complet mesuré (bits + hors)', mesure.regleDuSite.fiches <= cfg.collection.clesParCompte && mesure.horsRegistre.total <= cfg.collection.horsCatalogueParCompte);
    }
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
