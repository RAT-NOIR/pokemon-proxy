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
// la mesure est COMMITÉE dans le dépôt (v2/test/mesure-chargeur/mesure-collection.json, produite par mesurer-collection.js) : jamais de saut en vert sur une autre machine
const FICHIER = require('path').join(__dirname, 'mesure-chargeur', 'mesure-collection.json');

(async () => {
    await H.ouvrirBancV2();
    const bdd = (async () => { process.env.MONGODB_BASE = 'test_scratch'; const { connecterMongo } = require('../../mongo-connexion'); await connecterMongo({ script: 'test-collection-budget.js', ecrit: true }); return mongoose.connection.db; })();
    const B = await bdd;
    const formes = [];       // { nom, indexUnique, docs: () => iterable, modele: doc => octets }
    const fiche = (compteId, set, mots, horsL, qte) => ({ compteId, set, ...(Object.keys(mots).length ? { epoque: hex(16) } : {}), mots, hors: horsL, ...(qte ? { qte } : {}), majLe: new Date() });
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
    // TOUR 2 (N26, N27) : la marge de l'ÉPOQUE (+30 o par document de compte, +30 o par registre) se MESURE — des documents IDENTIQUES avec et sans le champ, la différence par document contre collStats
    const slugsP = Array.from({ length: 3000 }, () => hex(80)), idP = new ObjectId(), idsQ = Array.from({ length: 1500 }, () => hex(80)), cleQ = cle45();
    formes.push({ nom: 'P1. 3 000 documents de compte AVEC époque', fiches: true, docs: () => slugsP.map(sl => fiche(idP, sl, { 0: Long.fromBits(1, 0) }, [])) });
    formes.push({ nom: 'P0. les mêmes 3 000 documents SANS époque', fiches: true, docs: () => slugsP.map(sl => { const d = fiche(idP, sl, { 0: Long.fromBits(1, 0) }, []); delete d.epoque; return d; }) });
    formes.push({ nom: 'Q1. 1 500 registres AVEC époque', registre: true, docs: () => idsQ.map(id => ({ _id: id, cles: [cleQ], epoque: hex(16) })) });
    formes.push({ nom: 'Q0. les mêmes 1 500 registres SANS époque', registre: true, docs: () => idsQ.map(id => ({ _id: id, cles: [cleQ] })) });

    // ── le COMPTE MALVEILLANT : `hors` plein de clés de 45 o sur 1 000 sets fictifs (slug de 80 caractères), plafond horsCatalogueParCompte
    const NH = cfg.collection.horsCatalogueParCompte, NS = cfg.collection.setsParCompte;
    const malveillant = () => { const id = new ObjectId(); return Array.from({ length: NS }, (_, i) => fiche(id, hex(80), {}, Array.from({ length: Math.floor(NH / NS) + (i < NH % NS ? 1 : 0) }, cle45))); };
    formes.push({ nom: `M. compte MALVEILLANT : ${NH} clés hors de 45 o sur ${NS} sets fictifs de 80 caractères`, fiches: true, unCompte: true, docs: malveillant });

    // ── le COLLECTIONNEUR COMPLET : toutes les fiches du plus grand compte mesuré, réparties sur les vrais sets de la sauvegarde
    const mesure = JSON.parse(fs.readFileSync(FICHIER, 'utf8'));
    {
        const idC = new ObjectId();
        formes.push({ nom: `K. collectionneur COMPLET : ${mesure.regleDuSite.fiches} fiches (${mesure.archive.fiches} au registre + ${mesure.horsRegistre.total} hors) sur ${mesure.parSet.length} sets`, fiches: true, unCompte: true, complet: true,
            docs: () => mesure.parSet.map(([id, site, arch]) => fiche(idC, id, motsPleins(Math.ceil(arch / 64)), Array.from({ length: site - arch }, cleReelle))) });
        // TOUR 1 (I3) : le compte le PLUS LOURD que TOUTES les bornes permettent — les plus gros vrais sets à mots pleins (ceux qui portent les quantités de bits), le reste en sets fictifs de 80 caractères pour atteindre 1 000 sets, `hors` plein de clés de 45 o à quantité,
        // les quantités pleines (quantitesParCompte : celles de `hors` et le reste en `qte`)
        formes.push({ nom: `W. compte le plus LOURD sous TOUTES les bornes : ${cfg.collection.setsParCompte} sets, ${cfg.collection.horsCatalogueParCompte} clés hors de 45 o, ${cfg.collection.quantitesParCompte} quantités, bits des plus gros sets`, fiches: true, unCompte: true,
            docs: () => {
                // le plus lourd : le MINIMUM de vrais sets (les plus gros, qui portent les 4 000 quantités de bits) et tout le reste en sets fictifs de 80 caractères (un slug long pèse deux fois : donnée et index)
                const id = new ObjectId(), NSet = cfg.collection.setsParCompte, parSetHors = cfg.collection.horsCatalogueParCompte / NSet; let qBits = cfg.collection.quantitesParCompte - cfg.collection.horsCatalogueParCompte;
                const hors = () => Array.from({ length: parSetHors }, () => `${cle45()}\n99`);
                const docs = [];
                for (const [sid, site, arch] of [...mesure.parSet].sort((x, y) => y[2] - x[2])) {
                    if (qBits <= 0) break;
                    const n = Math.min(arch, qBits); qBits -= n;
                    docs.push(fiche(id, sid, motsPleins(Math.ceil(arch / 64)), hors(), Object.fromEntries(Array.from({ length: n }, (_, p) => [String(p), 99]))));
                }
                while (docs.length < NSet) docs.push(fiche(id, hex(80), {}, hors()));
                return docs;
            } });
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

    // ── 1 bis. la marge de l'ÉPOQUE : mesurée par document, confrontée à ce que le modèle ajoute (DOCUMENT_BASE − 300, REGISTRE_BASE − 90)
    {
        const f = n => formes.find(x => x.nom.startsWith(n + '.'));
        const dP = (f('P1').net - f('P0').net) / f('P1').n, dQ = (f('Q1').net - f('Q0').net) / f('Q1').n;
        console.log(`   époque mesurée : +${dP.toFixed(1)} o par document de compte (le modèle ajoute ${C.DOCUMENT_BASE - 300}), +${dQ.toFixed(1)} o par registre (le modèle ajoute ${C.REGISTRE_BASE - 90})`);
        H.vrai('1 bis. l\'époque coûte une quantité POSITIVE mesurée par document de compte et par registre, que le modèle couvre (≤ sa marge)', dP > 0 && dP <= C.DOCUMENT_BASE - 300 && dQ > 0 && dQ <= C.REGISTRE_BASE - 90);
        H.vrai('   ↳ le banc sait dire NON : une marge de l\'époque retirée (document 300, registre 90) ne couvre plus ce qui est mesuré', !(dP <= 0) && !(dQ <= 0));
        H.vrai('   ↳ ... et la marge du modèle est SERRÉE (moins de 10 o de jeu par document et par registre), pas un chiffre rond posé au hasard', C.DOCUMENT_BASE - 300 - dP < 10 && C.REGISTRE_BASE - 90 - dQ < 10);
    }

    // ── 2. les MESURES du contrat
    const M = formes.find(f => f.nom.startsWith('M.')), K = formes.find(f => f.nom.startsWith('K.')), R = formes.find(f => f.nom.startsWith('R.')), W = formes.find(f => f.nom.startsWith('W.'));
    const plafond = cfg.collection.octetsService;
    console.log(`   MESURE compte malveillant : ${M.net} o mesurés (modèle ${M.modele}) → ${Math.floor(plafond / M.modele)} comptes malveillants remplissent ${Mo(plafond)} Mo (au modèle) ; ${Math.floor(plafond / M.net)} au mesuré`);
    H.vrai('2. un compte malveillant (hors plein sur 1 000 sets) pèse moins que le plafond du service : une écriture refusée est possible avant qu\'il ne le dépasse', M.modele < plafond);
    {
        const registre = R.net, parCollectionneur = K.net, parCollectionneurModele = K.modele;
        const tenusMesure = Math.floor((plafond - registre) / parCollectionneur), tenusModele = Math.floor((plafond - R.modele) / parCollectionneurModele);
        console.log(`   MESURE collectionneur complet : ${K.net} o mesurés (${(K.net / 1024).toFixed(1)} Ko), modèle ${K.modele} o ; registre complet : ${R.net} o mesurés (${(R.net / 1024).toFixed(1)} Ko), modèle ${R.modele} o`);
        console.log(`   MESURE ce que tiennent ${Mo(plafond)} Mo : (plafond − registre complet) / collectionneur = ${tenusMesure} collectionneurs complets au mesuré, ${tenusModele} au modèle (le compteur réserve le modèle)`);
        console.log(`   MESURE pire cas en octets sous le plafond : le compteur refuse au-delà de ${plafond} o du MODÈLE ; la forme la plus défavorable mesurée est ${(Math.max(...formes.map(f => f.net / f.modele))).toFixed(3)} × le modèle → au plus ${Mo(plafond * Math.max(...formes.map(f => f.net / f.modele)))} Mo réels, plus le dépassement concurrent borné (écritures en vol × le coût d'une écriture au pire : ${C.document('x'.repeat(80)) + C.mot + C.registreEntree(cle45()) + C.registreDocument('x'.repeat(80)) + C.qte} o)`);
        // I3 : le nombre MINIMAL de comptes qui remplissent le budget = le compte le plus lourd que les bornes permettent, registre complet compris (il faut le remplir pour poser les bits)
        const minMesure = Math.ceil((plafond - R.net) / W.net), minModele = Math.ceil((plafond - R.modele) / W.modele);
        console.log(`   MESURE compte le PLUS LOURD sous toutes les bornes : ${W.net} o mesurés (${(W.net / 1024).toFixed(1)} Ko), modèle ${W.modele} o ; registre complet ${R.net} o (mesuré) / ${R.modele} o (modèle)`);
        console.log(`   MESURE NOMBRE MINIMAL de comptes qui remplissent ${Mo(plafond)} Mo : ${minMesure} au mesuré ((plafond − registre) / compte le plus lourd = (${plafond} − ${R.net}) / ${W.net}), ${minModele} au modèle (ce que le compteur réserve) ; sans compter le registre : ${Math.ceil(plafond / W.net)} au mesuré`);
        H.vrai('   le compte le plus lourd sous toutes les bornes est plus lourd que le malveillant « hors seul » et que le collectionneur complet (la forme M n\'était pas le pire)', W.net > M.net && W.net > K.net);
        H.vrai('   le nombre minimal de comptes est au moins 1 et fini', Number.isFinite(minMesure) && minMesure >= 1);
        H.vrai('   un collectionneur COMPLET tient sous le plafond du service avec de la marge (registre compris)', K.modele + R.modele < plafond && tenusModele >= 1);
        H.vrai('   le plafond par compte couvre le collectionneur complet mesuré (bits + hors)', mesure.regleDuSite.fiches <= cfg.collection.clesParCompte && mesure.horsRegistre.total <= cfg.collection.horsCatalogueParCompte);
    }
    // ── 3. TOUR 2 (M2) : le nombre d'ÉCRITURES du compte le plus lourd, MESURÉ — construit PAR LE SERVICE à l'échelle 1/10 (100 sets, 600 clés hors, 1 000 quantités), chaque écriture comptée
    {
        const dbm = require('../db'), Mod = require('../modeles'); dbm.brancher(mongoose.connection.db); await Mod.creerIndex();
        const svc = require('../collection/service'), VB = require('./_visuels-banc');
        const cfgS = { ...cfg, collection: { ...cfg.collection, setsParCompte: 100, horsCatalogueParCompte: 600, quantitesParCompte: 1000 } };
        const gros = [...mesure.parSet].sort((x, y) => y[2] - x[2])[0], qBits = cfgS.collection.quantitesParCompte - cfgS.collection.horsCatalogueParCompte;
        const cles = Array.from({ length: gros[2] }, (_, j) => `${900000 + j}|${String(j + 1).padStart(3, '0')}`);
        VB.installer([VB.doc(1)], cles.map(c => [gros[0], c, [1]]));
        const id = new ObjectId(); let ecritures = 0, refus = 0;
        const put = async (slug, cle) => { const r = await svc.cocher({ cfg: cfgS, compteId: id, slug, cle, possedee: true, quantite: 99 }); if (r.refus) refus++; else ecritures++; };
        const t0 = Date.now();
        for (let j = 0; j < qBits; j++) await put(gros[0], cles[j]);
        const slugs = [gros[0], ...Array.from({ length: 99 }, () => hex(80))];
        for (let i = 0; i < cfgS.collection.horsCatalogueParCompte; i++) await put(slugs[i % 100], cle45());
        const suivante = await svc.cocher({ cfg: cfgS, compteId: id, slug: gros[0], cle: cles[qBits], possedee: true, quantite: 99 });
        await B.admin().command({ fsync: 1 }); await attendre(2000);
        const stocke = await B.collection('collection_fiches').find({ compteId: id }, { promoteLongs: false }).toArray();
        const st = await B.command({ collStats: 'collection_fiches' }), stR = await B.command({ collStats: 'collection_registre' });
        const modeleS = stocke.reduce((n, d) => n + C.coutDuDocument(d), 0);
        console.log(`   MESURE écritures du pire compte, construit PAR LE SERVICE à l'échelle 1/10 : ${ecritures} écritures acceptées (${qBits} quantités de bits + ${cfgS.collection.horsCatalogueParCompte} clés hors à quantité) en ${((Date.now() - t0) / 1000).toFixed(0)} s, ${stocke.length} documents, ${st.size + st.totalIndexSize} o de collection_fiches (modèle des documents ${modeleS}) ; la suivante : ${suivante.refus} → à l'échelle 1 : ${ecritures * 10} écritures, soit ${(ecritures * 10 / 1000).toFixed(0)} h au limiteur de 1 000 par heure`);
        H.v('3. le pire compte (toutes les bornes pleines, échelle 1/10) demande EXACTEMENT quantitesParCompte écritures (une par quantité : les clés hors à quantité comptent) ; la suivante est refusée « borne-quantites »', [ecritures, refus, suivante.refus, stocke.length], [cfgS.collection.quantitesParCompte, 0, 'borne-quantites', 100]);
        H.vrai('   ce que le service a construit tient dans le modèle (documents du compte, avant la base vide) : modèle ≥ mesuré', modeleS >= st.size + st.totalIndexSize - vides.fiches);
        void stR;
    }

    // (outil d'exploitation) RM_BUDGET_SORTIE=<fichier> : écrit les nombres mesurés, pour les citer au contrat sans les recopier à la main
    if (process.env.RM_BUDGET_SORTIE) {
        const pire = Math.max(...formes.map(f => f.net / f.modele));
        fs.writeFileSync(process.env.RM_BUDGET_SORTIE, JSON.stringify({ K: { net: K.net, modele: K.modele }, R: { net: R.net, modele: R.modele }, W: { net: W.net, modele: W.modele }, M: { net: M.net, modele: M.modele },
            collectionneursModele: Math.floor((plafond - R.modele) / K.modele), collectionneursMesure: Math.floor((plafond - R.net) / K.net), minMesure: Math.ceil((plafond - R.net) / W.net), minModele: Math.ceil((plafond - R.modele) / W.modele), minSansRegistre: Math.ceil(plafond / W.net),
            pireRapport: pire.toFixed(3), pireMo: Mo(plafond * pire), coutEcriture: C.document('x'.repeat(80)) + C.mot + C.registreEntree(cle45()) + C.registreDocument('x'.repeat(80)) + C.qte }));
    }
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌ banc en échec :', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
