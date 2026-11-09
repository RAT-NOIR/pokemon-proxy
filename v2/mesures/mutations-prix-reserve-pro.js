'use strict';
// LE JEU DE MUTATIONS DE PRO-PRIX-RESERVE (critère n° 5 de l'ouverture de Pro : le prix par état et par langue est réservé à Pro). Rejouable : `node v2/mesures/mutations-prix-reserve-pro.js` (tout) ou `... --seulement=<fragment du nom>`.
// Même principe que mutations-lot-sans-prix.js (dont il réutilise l'accroche accroche-mutant.js) : on RETIRE la garde d'UNE sortie à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché),
// on lance le banc qui la protège, et il DOIT devenir rouge. Un mutant qui reste vert est « SURVIVANT ».
// 🔑 LA MORT SE PROUVE : l'accroche écrit une trace (RM_MUTANT_TRACE) quand la copie mutée est COMPILÉE ; un mutant dont la copie n'a jamais été chargée par le banc est « NON-CHARGÉ » (jamais « TUÉ ») : le banc ne monte pas ce fichier,
// donc il ne prouve rien (c'était le défaut du mutant des mesures). Un mutant déclaré ÉQUIVALENT porte sa raison écrite (6e colonne) et doit être chargé et resté vert.
// Jamais lancé par lancer-tout.js. Besoin : la base de banc en mémoire (MONGOMS_DOWNLOAD_DIR), et 1,5 Go de disque libre.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';
const BANC = 'test-offre-prix-reserve-pro.js', BANC_MES = 'test-offre-prix-reserve-pro-mesures.js', BANC_SCANNER = 'test-scanner-routes.js';
const ROUTES = 'identifier/routes.js', LOT = 'identifier/lot.js', RL = 'identifier/retour-live.js', MES = 'identifier/calcul-client-route.js', RES = 'identifier/reserve-pro-prix.js', IDEM = 'transport/idempotence.js', MONTER = 'identifier/monter.js', SCANNER = 'scanner/routes.js';

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison écrite)] — `fichier` est AUSSI la sortie que le banc exige de couvrir (test-offre-prix-reserve-pro.js, C2)
const MUTANTS = [
    ['/api/identifier (une carte et un lot) : la garde est retirée (tout le monde reçoit)', ROUTES, "const acces = await PRO.accesPour({ cfg, porteur, argent });\n        // ACHETE-AVANT-JOUR", "const acces = true;\n        // ACHETE-AVANT-JOUR", BANC],
    ['/api/identifier/reponse : la garde est retirée (tout le monde reçoit)', ROUTES, "const acces = await PRO.accesPour({ cfg, porteur, argent });      // PRO-PRIX-RESERVE (réponse)", "const acces = true;      // PRO-PRIX-RESERVE (réponse)", BANC],
    ['/api/identifier/reponse : le remboursement reprend le compteur des DÉCLARATIONS (un porteur au plafond reste compté sans prix)', ROUTES, "compteur: 'constate-question' });      // le compteur des CONSTATS", "compteur: 'sans-prix' });      // le compteur des CONSTATS", BANC],
    ['/api/identifier/reponse : la garde « question de lot » est retirée (le lot serait rendu par cette route)', ROUTES, "&& !questionDeLot && porteur.surface", "&& porteur.surface", BANC],
    ['/api/identifier/reponse : la garde « administrateur » est retirée (un administrateur à offre illisible serait remboursé)', ROUTES, "if (!acces && !admin && !questionDeLot && porteur.surface !== 'scanner' && PRO.carteSansPrixPourGratuit(resolueComplete)) {", "if (!acces && !questionDeLot && porteur.surface !== 'scanner' && PRO.carteSansPrixPourGratuit(resolueComplete)) {", BANC],
    ['/api/identifier/reponse : la garde « scanner » est retirée (la route rembourse à la place du scanner, sans le champ declaration)', ROUTES, "&& !questionDeLot && porteur.surface !== 'scanner' && PRO.carteSansPrixPourGratuit(resolueComplete)) {", "&& !questionDeLot && PRO.carteSansPrixPourGratuit(resolueComplete)) {", BANC_SCANNER],
    ['/api/identifier/reponse (résidu de F2) : une carte tranchée sans prix du gratuit n\'est plus rendue (scan compté sans prix affiché)', ROUTES, "&& PRO.carteSansPrixPourGratuit(resolueComplete)) {", "&& false) {", BANC],
    ['/api/identifier/reponse : la carte du gratuit garde son prix (la réduction n\'est plus appliquée)', ROUTES, "const resolue = PRO.carteSelonOffre(resolueComplete, acces);", "const resolue = resolueComplete;", BANC],
    ['/api/identifier : l\'analyse du gratuit garde son prix (la réduction n\'est plus appliquée)', ROUTES, "{ ...PRO.analyseSelonOffre(analysePleine0, false), regleVerdict: regle, ...(photosDites || {}) };", "{ ...analysePleine0, regleVerdict: regle, ...(photosDites || {}) };", BANC],
    ['F2 : une carte unique sans prix du gratuit n\'est plus rendue (scan compté sans prix affiché)', ROUTES, "scanSansPrix = true;", "scanSansPrix = false;", BANC],
    ['lot (quota) : la garde est retirée (le lot du gratuit compte encore un prix en direct)', LOT, "const acces = typeof p.acces === 'boolean' ? p.acces : await PRO.accesPour({ cfg, porteur, argent });", "const acces = true;", BANC],
    ['retour-live : la garde est retirée (repli d\'état servi au gratuit, scan compté)', RL, "const acces = await PRO.accesPour({ cfg, porteur, argent });", "const acces = true;", BANC],
    ['retour-live : le repli du gratuit n\'est plus réduit', RL, "repli = PRO.repliSelonOffre(await repliDuRetour(porteur, scanId, carte, b, lr), acces);", "repli = await repliDuRetour(porteur, scanId, carte, b, lr);", BANC],
    ['mesures (promotion) : la garde est retirée (tout le monde reçoit)', MES, "const acces = PRO.accesPrixParEtat(cfg, offre), carte =", "const acces = true, carte =", BANC_MES],
    ['mesures (promotion) : la carte du gratuit garde son prix (la réduction n\'est plus appliquée)', MES, "carte = PRO.carteSelonOffre(carteComplete, acces);", "carte = carteComplete;", BANC_MES],
    ['mesures (probable de groupe) : la garde est retirée', MES, "acces = PRO.accesPrixParEtat(cfg, offre); carteComplete = carte;", "acces = true; carteComplete = carte;", BANC_MES,
        'ÉQUIVALENT : la carte « probable de groupe » est une QUESTION (a-trancher, candidats gardés) : elle ne porte jamais prixLive ni prixRepli (prix-repli.js::avecRepliAnalyse ne pose aucun repli sur une question), donc la réduction y est sans effet ; la garde existe pour qu\'une évolution future ne fuie pas.'],
    ['scanner : la route n\'est plus branchée sur `sansPrix` (prixLive et prixRepli servis à la surface du site)', SCANNER, "sansPrix, lancer(traiterIdentifier(cfg, depsScanner)));", "lancer(traiterIdentifier(cfg, depsScanner)));", BANC_SCANNER],
    ['rejeu : le transformeur n\'est pas branché sur les routes', MONTER, "rejeuSelonOffre(cfg, () => registre.obtenir('argent'))", "null", BANC],
    ['rejeu : une réponse conservée sous Pro est rejouée telle quelle à un gratuit (fuite)', RES, "        if (acces) return texte;\n        let corps;", "        return texte;\n        let corps;", BANC],
    ['rejeu : la réponse complète n\'est plus conservée (un Pro rejoue la réponse du gratuit)', IDEM, "typeof this.locals.reponseAConserver === 'string' ? this.locals.reponseAConserver : corps;", "typeof this.locals.reponseAConserver === 'string' ? corps : corps;", BANC],
    ['la décision : un nom d\'offre quelconque reçoit', RES, "return Boolean(offre) && typeof offre === 'object' && !Array.isArray(offre) && offre.nom === 'pro';", "return Boolean(offre) && typeof offre === 'object' && !Array.isArray(offre);", BANC],
    ['la décision : une offre illisible (undefined) reçoit', RES, "    return Boolean(offre) && typeof offre === 'object' && !Array.isArray(offre) && offre.nom === 'pro';", "    return offre === undefined || (Boolean(offre) && typeof offre === 'object' && !Array.isArray(offre) && offre.nom === 'pro');", BANC],
    ['le repli général est retiré avec les autres (le guide général change)', RES, "    if (repliGeneral(repli)) return repli;\n    if (repliTendanceAFourchette(repli))", "    if (repliTendanceAFourchette(repli))", BANC],
    ['F1 : le repli à fourchette n\'est plus dégradé, il est retiré entier (le scan compté devient rendu)', RES, "if (repliTendanceAFourchette(repli)) { const { fourchette, ...general } = repli; return general; }", "if (false) { return null; }", BANC],
    ['un repli d\'état est gardé pour le gratuit', RES, "const changeRepli = aPropre(c, 'prixRepli') && repli !== c.prixRepli;", "const changeRepli = false;", BANC],
    ['prixLive reste servi au gratuit', RES, "const retireLive = c.prixLive !== null && c.prixLive !== undefined;", "const retireLive = false;", BANC],
    ['F2 : une carte avec un guide servi est rendue au gratuit (la règle ne regarde plus le guide)', RES, "c.carte.prixGuide !== null) return false;", "false) return false;", BANC]
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-ppr-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n'), ancreN = ancre.replace(/\r\n/g, '\n'), neufN = neuf.replace(/\r\n/g, '\n');
            const n = texte.split(ancreN).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`), trace = path.join(tmp, `trace${i}.txt`); fs.writeFileSync(copie, texte.replace(ancreN, () => neufN));
            const r = spawnSync(process.execPath, ['-r', path.join(V, BANCS, '_espion-fs-armer.js'), '-r', path.join(__dirname, 'accroche-mutant.js'), path.join(V, BANCS, banc)], {
                cwd: path.join(V, '..'), encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, RM_MUTANT_CIBLE: cible, RM_MUTANT_SOURCE: copie, RM_MUTANT_TRACE: trace,
                    NODE_OPTIONS: `--require ${path.join(__dirname, 'accroche-mutant.js')}` } });
            const m = /(\d+) réussis, (\d+) échoués/.exec(r.stdout || '');
            const charge = fs.existsSync(trace);
            const rouge = r.status !== 0 || (m && Number(m[2]) > 0);
            // la mort ne compte que si la copie mutée a été COMPILÉE par le banc
            const verdict = !charge ? 'NON-CHARGÉ' : rouge ? 'TUÉ' : equivalent ? 'ÉQUIVALENT' : 'SURVIVANT';
            resultats.push({ nom, verdict, banc, bilan: m ? `${m[1]}/${m[2]}` : 'pas de bilan' });
            journal(`${verdict.padEnd(10)} ${nom}  [${banc}] ${m ? `${m[1]} réussis, ${m[2]} échoués` : 'pas de bilan'}${equivalent && !rouge ? ' — équivalent déclaré' : ''}`);
        });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return resultats;
}
/** Les mutants dont l'ancre n'existe plus EXACTEMENT une fois dans le code actuel (le jeu a pourri). */
function ancresCassees() {
    return MUTANTS.filter(([, fichier, ancre]) => fs.readFileSync(path.join(V, fichier), 'utf8').replace(/\r\n/g, '\n').split(ancre.replace(/\r\n/g, '\n')).length - 1 !== 1).map(m => m[0]);
}
module.exports = { MUTANTS, rejouer, ancresCassees };

if (require.main === module) {
    const arg = process.argv.slice(2);
    if (arg.some(a => !/^--seulement=.{1,60}$/.test(a)) || arg.length > 1) { console.error('ARRÊT : seul --seulement=<fragment du nom> est admis'); process.exit(1); }
    if (!process.env.MONGOMS_DOWNLOAD_DIR) console.log('⚠️ MONGOMS_DOWNLOAD_DIR n\'est pas posée : la base de banc en mémoire peut vouloir télécharger mongod');
    const res = rejouer({ seulement: arg[0] ? arg[0].slice(12) : null });
    const compte = v => res.filter(r => r.verdict === v).length;
    console.log(`\n${res.length} mutants : ${compte('TUÉ')} tués, ${compte('ÉQUIVALENT')} équivalent(s) déclaré(s), ${compte('SURVIVANT')} survivant(s), ${compte('NON-CHARGÉ')} non chargé(s), ${compte('ANCRE')} ancre(s) cassée(s)`);
    process.exit(compte('SURVIVANT') + compte('NON-CHARGÉ') + compte('ANCRE') ? 1 : 0);
}
