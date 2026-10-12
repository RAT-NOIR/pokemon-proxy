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
const HERITEES = Object.freeze(['credits', 'quotas_semaine', 'remboursements', 'remboursements_questions', 'questions', 'numeros_cartes', 'codes_set', 'catalogue_produits',
    'guide_prix', 'guide_prix_meta', 'evenements_stripe', 'journal_scans', 'references_image', 'cardprices', 'quotas', 'sets', 'cartes', 'cartes_produits']);
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
    const cites = citations(racine);
    const hors = cites.filter(c => !VOULUS.includes(c.nom));
    console.log(`   garde : ${fichiersV2(racine).length} fichiers v2 hors bancs lus, ${cites.length} citations d'un nom hérité (${HERITEES.length} noms), dont ${cites.length - hors.length} déclarées voulues`);
    H.v('GARDE : aucun nom de collection hérité hors des partages voulus n\'est cité par le code v2', hors.map(c => `${c.nom} (${c.fichier})`), []);
    // la garde SAIT dire non : une citation fabriquée de `questions` est vue
    const fab = path.join(racine, '_fabrique-garde.js');
    fs.writeFileSync(fab, "module.exports = (db) => db.col('questions');\n");
    let vue; try { vue = citations(racine).some(c => c.nom === 'questions' && c.fichier === '_fabrique-garde.js'); } finally { fs.unlinkSync(fab); }
    H.v('   la garde sait dire non : une citation fabriquée de \'questions\' est vue', vue, true);
    // chaque partage voulu est déclaré à l'audit, dans le tableau
    const auditTout = fs.readFileSync(path.join(__dirname, '..', '..', 'AUDIT-SECURITE-V2.md'), 'utf8');
    const debut = auditTout.indexOf('## 13. Les collections partagées');
    const audit = debut >= 0 ? auditTout.slice(debut) : '';                       // seul le §13 compte : un nom cité ailleurs dans l'audit ne déclare rien
    H.v('chaque partage VOULU figure au tableau de l\'audit', VOULUS.filter(n => !new RegExp('^\\|[^\\n]*`' + n + '`', 'm').test(audit)), []);

    await physique('questions').deleteMany({});
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error(e); process.exit(1); });
