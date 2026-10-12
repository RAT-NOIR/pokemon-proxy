'use strict';
// MOYENS-A (point 9) : la v2 ne partage plus la collection `questions` avec le code hérité (acces.js:120-136).
//   1. une question « héritée » (la forme qu'écrit acces.js) déposée dans `questions` n'est JAMAIS prise par le balayage v2 ni effacée par la passe BANC-12 ;
//   2. une question v2 ne se trouve plus dans `questions` : elle vit dans `questions_v2` ;
//   3. GARDE contre le retour du problème, écrite par ce qu'elle AUTORISE : tout nom de collection de production du code hérité cité par le code v2
//      doit figurer dans VOULUS (les partages déclarés à l'audit) ; tout autre nom fait échouer le banc.
const fs = require('fs'), path = require('path');
const mongoose = require('mongoose');
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Lg = require('../argent/ledger'); const Q = require('../argent/questions'); const { creerAnonymisation, ETATS_QUESTION_TERMINES } = require('../banc/anonymisation');
const { compte } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');

// Les collections de la base de production `test` utilisées par le code HÉRITÉ (modèles de acces.js, index.js, journal-scans.js, import-*.js,
// departage-image.js, apprentissage-commun.js) + les trois collections de la base `cartes` que l'API lit. Source : RAPPORT-API.md « Contrôle Atlas »
// (16 collections mesurées dans `test`) et les déclarations mongoose du dépôt.
// Les 16 collections de la base `test` : relevé de C:\Users\Yung\Desktop\pokemon-proxy\mesures\taille-bases.jsonl (ligne 1), base `test`. ÉPINGLÉ : si la
// production en gagne une, ce relevé change et ce banc doit le dire (assertion « 16 noms » plus bas).
const TEST_PROD = Object.freeze(['references_image', 'catalogue_produits', 'guide_prix', 'numeros_cartes', 'journal_scans', 'codes_set', 'credits', 'evenements_stripe',
    'cardprices', 'remboursements', 'quotas', 'catalogue_export_meta', 'quotas_semaine', 'guide_prix_meta', 'remboursements_questions', 'questions']);
const BASE_CARTES = Object.freeze(['sets', 'cartes', 'cartes_produits']);
const HERITEES = Object.freeze([...TEST_PROD, ...BASE_CARTES]);
// Les partages VOULUS, déclarés à AUDIT-SECURITE-V2.md (tableau « nom · lecture/écriture · voulu ? »). Rien d'autre.
const VOULUS = Object.freeze(['credits', 'journal_scans', 'catalogue_produits', 'guide_prix', 'numeros_cartes', 'codes_set', 'guide_prix_meta', 'references_image', 'cardprices', 'sets', 'cartes', 'cartes_produits']);

function fichiersV2(dir, acc = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') fichiersV2(p, acc); }
        else if (/\.js$/.test(e.name)) acc.push(p);
    }
    return acc;
}
// toute citation entre guillemets d'un nom hérité dans le code v2 (hors bancs) : { nom, fichier }
function citations(racine) {
    const sortie = [];
    for (const f of fichiersV2(racine)) {
        const src = fs.readFileSync(f, 'utf8');
        for (const nom of HERITEES) if (new RegExp(`(['"\`])${nom}\\1`).test(src)) sortie.push({ nom, fichier: path.relative(racine, f).replace(/\\/g, '/') });
    }
    return sortie;
}

// ── LECTURE SEULE sur toute collection partagée, sauf les couples (collection, fichier, opérations) déclarés à l'audit §13. Garde écrite par ce qu'elle AUTORISE.
const LECTURES = Object.freeze(['find', 'findOne', 'countDocuments', 'distinct', 'aggregate']);    // `aggregate` n'est une lecture que sans $out ni $merge ; collStats passe par db.command, jamais par une méthode de collection
const ECRITURES_PERMISES = Object.freeze([
    { nom: 'credits', fichier: 'argent/heritage.js', ops: ['findOneAndUpdate'] },          // migration des crédits hérités (A0), un document par userId / _id
    { nom: 'journal_scans', fichier: 'identifier/retour-live.js', ops: ['updateOne'] },     // douteux / douteuxGuide / lectureRatee sur la ligne du scan, filtrée par _id ET userId
    { nom: 'credits', fichier: 'migrations/rejouer-migration-credits.js', ops: ['insertMany'] }  // outil de rejeu (--base=test_scratch) : il écrit une sauvegarde dans un bac, jamais en production
]);
const SANS_ECRITURE = ['test', 'mesures'];                                       // les bancs et les outils de mesure (lecture) ne sont pas du code de production
function operations(racine) {
    const sortie = [];
    const fichiers = (function lister(d, a = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (!SANS_ECRITURE.includes(e.name) && e.name !== 'node_modules') lister(p, a); } else if (/\.js$/.test(e.name)) a.push(p); } return a; })(racine);
    for (const f of fichiers) {
        const src = fs.readFileSync(f, 'utf8'), fichier = path.relative(racine, f).replace(/\\/g, '/');
        for (const nom of HERITEES) {
            const re = new RegExp(`(?:col|colFn|colLue|collection)\\(\\s*(['"\`])${nom}\\1\\s*\\)\\s*\\.\\s*(\\w+)`, 'g'); let m;
            while ((m = re.exec(src))) {
                const fenetre = src.slice(m.index, m.index + 900);
                const sortant = m[2] === 'aggregate' && /\$out|\$merge/.test(fenetre);
                sortie.push({ nom, fichier, op: sortant ? 'aggregate($out/$merge)' : m[2], lecture: LECTURES.includes(m[2]) && !sortant });
            }
        }
        if (/\bmongoose\.model\(|\.model\(\s*['"]/.test(src)) sortie.push({ nom: '(modèle mongoose)', fichier, op: 'model', lecture: false });
    }
    return sortie;
}
const ecrituresRefusees = ops => ops.filter(o => !o.lecture && !ECRITURES_PERMISES.some(p => p.nom === o.nom && p.fichier === o.fichier && p.ops.includes(o.op)));

(async () => {
    await H.ouvrirBac('test-collections-partagees.js'); await M.creerIndex();
    const physique = nom => db.base().collection(db.prefixeCourant() + nom);         // le nom NU du code hérité (sous le préfixe du banc)
    const choix = [{ id: 'c1', idProduct: 111 }, { id: 'c2', idProduct: 222 }];

    // 1a. une question héritée (forme d'acces.js : _id ObjectId, userId, credit.poche, etat, poseeLe) n'est jamais prise par le balayage v2
    const vieille = new Date(t.getTime() - 48 * 3600e3);
    const heritee = { _id: new mongoose.Types.ObjectId(), userId: 'u-herite', credit: { poche: 'scans', semaineIso: '2026-W41' }, raison: 'egalite', candidats: [111], poseeLe: vieille, etat: 'en-attente', reponse: null, priseLe: null, regleeLe: null, rembourse: null, raisonNonRembourse: null, annuleePar: null };
    await physique('questions').insertOne(heritee);
    const bal = await Q.balayerQuestions({ maintenant: new Date(t.getTime() + 30 * 3600e3), max: 50 }, cfg);
    const apres = await physique('questions').findOne({ _id: heritee._id });
    H.v('balayage v2 : une question héritée en-attente depuis 48 h n\'est pas prise (0 réglée, document intact)', [bal.reglees, apres.etat, apres.priseLe, apres.rembourse], [0, 'en-attente', null, null]);

    // 1b. la passe BANC-12 n'efface pas une question héritée terminée et ancienne
    const terminee = { ...heritee, _id: new mongoose.Types.ObjectId(), etat: ETATS_QUESTION_TERMINES[0], poseeLe: new Date(t.getTime() - 800 * 24 * 3600e3) };
    await physique('questions').insertOne(terminee);
    const an = creerAnonymisation({ cfg, colFn: n => db.col(n), borner: p => p });
    const bilan = await an.anonymiser(null, t);
    H.v('passe BANC-12 : une question héritée terminée depuis plus de 2 ans reste (bilan.questions 0, document présent)', [bilan.questions, Boolean(await physique('questions').findOne({ _id: terminee._id }))], [0, true]);

    // 2. une question v2 ne se trouve plus dans `questions`, elle est dans `questions_v2`
    const p = await compte({ solde: { accueil: 0, achete: 3 } });
    const d = await Lg.debiter(p, { scanId: 'sep1', cleIdempotence: 'd|sep1', maintenant: t }, cfg);
    const r = await Q.reserverQuestion(p, d.credit, { scanId: 'sep1', carte: 0, raison: 'egalite', candidats: [111, 222], choix }, cfg, t);
    H.v('question v2 réservée : en-attente, présente dans questions_v2', [r.etat, await db.col('questions_v2').countDocuments({ _id: 'sep1:0' })], ['en-attente', 1]);
    H.v('   et ABSENTE de `questions` (seule la question héritée y reste : 2 documents hérités)', [await physique('questions').countDocuments({ _id: 'sep1:0' }), await physique('questions').countDocuments({})], [0, 2]);
    // le balayage v2, 30 h plus tard, règle la sienne et ne touche pas l'héritée
    const bal2 = await Q.balayerQuestions({ maintenant: new Date(t.getTime() + 30 * 3600e3), max: 50 }, cfg);
    H.v('balayage v2 à 30 h : la question v2 est réglée (1), l\'héritée est toujours intacte', [bal2.reglees, (await physique('questions').findOne({ _id: heritee._id })).etat], [1, 'en-attente']);
    // l'index (etat, poseeLe) est sur la collection v2
    const idx = (await db.col('questions_v2').indexes()).map(i => i.name);
    H.v('l\'index questions_etat est créé sur questions_v2 (et pas sur `questions`)', [idx.includes('questions_etat'), (await physique('questions').indexes()).some(i => i.name === 'questions_etat')], [true, false]);

    // 3. LA GARDE : le dénominateur est imprimé, tout nom hérité cité hors VOULUS échoue
    const racine = path.join(__dirname, '..');
    H.v('la liste des collections héritées de `test` compte 16 noms distincts, égale au relevé de mesures (16 collections), + 3 de la base `cartes`', [TEST_PROD.length, new Set(TEST_PROD).size, HERITEES.length], [16, 16, 19]);
    const cites = citations(racine);
    const hors = cites.filter(c => !VOULUS.includes(c.nom));
    console.log(`   garde : ${fichiersV2(racine).length} fichiers v2 hors bancs lus, ${cites.length} citations d'un nom hérité (${HERITEES.length} noms), dont ${cites.length - hors.length} déclarées voulues`);
    H.v('GARDE : aucun nom de collection hérité hors des partages voulus n\'est cité par le code v2', hors.map(c => `${c.nom} (${c.fichier})`), []);
    // la garde SAIT dire non : une citation fabriquée de `questions` est vue
    const fab = path.join(racine, '_fabrique-garde.js');
    fs.writeFileSync(fab, "module.exports = (db) => db.col('questions');\n");
    let vue; try { vue = citations(racine).some(c => c.nom === 'questions' && c.fichier === '_fabrique-garde.js'); } finally { fs.unlinkSync(fab); }
    H.v('   la garde sait dire non : une citation fabriquée de \'questions\' est vue', vue, true);
    // LECTURE SEULE : toute opération qui n'est pas une lecture, sur une collection partagée, doit être un couple (collection, fichier, opération) permis
    const ops = operations(racine), refusees = ecrituresRefusees(ops);
    console.log(`   lecture seule : ${ops.length} opérations directes sur une collection partagée (dont ${ops.filter(o => o.lecture).length} lectures, ${ops.filter(o => !o.lecture).length} écritures), ${ECRITURES_PERMISES.length} couples d'écriture permis`);
    H.v('GARDE LECTURE SEULE : aucune écriture v2 sur une collection partagée hors des couples permis', refusees.map(o => `${o.nom} ${o.op} (${o.fichier})`), []);
    H.v('   chaque couple permis est réellement utilisé (un couple devenu inutile se retire)', ECRITURES_PERMISES.filter(p => !ops.some(o => o.nom === p.nom && o.fichier === p.fichier && p.ops.includes(o.op))).map(p => `${p.nom} (${p.fichier})`), []);
    // elle SAIT dire non : des écritures fabriquées (celles de la passe 2 : guide_prix, numeros_cartes, catalogue_produits, credits hors de heritage.js) + les autres formes
    const fabEcr = path.join(racine, '_fabrique-ecritures.js');
    fs.writeFileSync(fabEcr, [
        "module.exports = async (db) => {",
        "  await db.col('guide_prix').insertOne({});", "  await db.col('numeros_cartes').updateMany({}, {});", "  await db.col('catalogue_produits').deleteMany({});",
        "  await db.col('credits').updateOne({}, {});", "  await db.col('journal_scans').insertOne({});", "  await db.col('codes_set').findOneAndDelete({});",
        "  await db.col('guide_prix').createIndex({ a: 1 });", "  await db.col('guide_prix').bulkWrite([]);", "  await db.col('numeros_cartes').drop();",
        "  await db.col('catalogue_produits').aggregate([{ $match: {} }, { $merge: 'x' }]);",
        "  await db.col('guide_prix').find({}); await db.col('guide_prix').aggregate([{ $match: {} }]);", "};\n"].join('\n'));
    let vues; try { vues = ecrituresRefusees(operations(racine)).filter(o => o.fichier === '_fabrique-ecritures.js').map(o => `${o.nom} ${o.op}`).sort(); } finally { fs.unlinkSync(fabEcr); }
    H.v('   la garde sait dire non : 10 écritures fabriquées sont vues, les 2 lectures fabriquées non', vues, ['guide_prix insertOne', 'numeros_cartes updateMany', 'catalogue_produits deleteMany', 'credits updateOne', 'journal_scans insertOne', 'codes_set findOneAndDelete', 'guide_prix createIndex', 'guide_prix bulkWrite', 'numeros_cartes drop', 'catalogue_produits aggregate($out/$merge)'].sort());
    // un couple permis ne vaut que pour SON fichier et SES opérations
    const fabCredits = path.join(racine, 'argent', '_fabrique-credits.js');
    fs.writeFileSync(fabCredits, "module.exports = async (col) => { await col('credits').updateMany({}, {}); };\n");
    let vuC; try { vuC = ecrituresRefusees(operations(racine)).filter(o => o.fichier === 'argent/_fabrique-credits.js').map(o => `${o.nom} ${o.op}`); } finally { fs.unlinkSync(fabCredits); }
    H.v('   `credits` écrit hors de heritage.js : vu', vuC, ['credits updateMany']);
    // chaque couple permis est déclaré à l'audit §13
    // chaque partage voulu est déclaré à l'audit, dans le tableau
    const auditTout = fs.readFileSync(path.join(__dirname, '..', '..', 'AUDIT-SECURITE-V2.md'), 'utf8');
    const debut = auditTout.indexOf('## 13. Les collections partagées');
    const audit = debut >= 0 ? auditTout.slice(debut) : '';                       // seul le §13 compte : un nom cité ailleurs dans l'audit ne déclare rien
    H.v('chaque partage VOULU figure au tableau de l\'audit', VOULUS.filter(n => !new RegExp('^\\|[^\\n]*`' + n + '`', 'm').test(audit)), []);

    H.v('chaque couple d\'écriture permis (collection, fichier, opération) figure à la liste des couples du §13', ECRITURES_PERMISES.filter(p => !new RegExp('^\\|[^\\n]*`' + p.nom + '`[^\\n]*`' + p.fichier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`[^\\n]*`' + p.ops.join('`[^\\n]*`') + '`', 'm').test(audit)).map(p => `${p.nom} ${p.fichier}`), []);

    await physique('questions').deleteMany({});
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
