'use strict';
// LE JEU DE MUTATIONS DE LOT-SANS-PRIX (un lot dont aucune carte n'affiche de prix est rendu ; un lot dont une carte en affiche un reste compté). Rejouable : `node v2/mesures/mutations-lot-sans-prix.js` (tout) ou `... --seulement=<fragment du nom>`.
// Même principe que mutations-repli-quota.js (dont il réutilise l'accroche accroche-mutant.js) : on CASSE une garde à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais
// touché), on lance le banc qui la protège, et il DOIT devenir rouge. Un mutant qui reste vert est « survivant ». Jamais lancé par lancer-tout.js.
// Besoin : la base de banc en mémoire (MONGOMS_DOWNLOAD_DIR vers le cache de mongod, comme pour les bancs).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';
const LOT = 'identifier/lot.js';
const BANC = 'test-lot-sans-prix.js';
const BRANCHE = "} else if (!lotAfficheUnPrix(cartes, lectures)) {";

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    ['la branche n\'est jamais prise (un lot sans prix reste compté)', LOT, BRANCHE, "} else if (false) {", BANC],
    ['la branche est toujours prise (un lot qui affiche un prix est rendu)', LOT, BRANCHE, "} else if (true) {", BANC],
    ['les candidats d\'une question ne comptent plus (un candidat au guide ne suffit pas)', LOT, "c.candidats.some(k => afficheUnPrix({ prixRendu: prixServi(k) || !langueNonLue(c, lectures) }));", "c.candidats.some(k => afficheUnPrix({ prixRendu: !langueNonLue(c, lectures) }));", BANC],
    // tour 2 (I2, M2)
    ['I2 : la langue lue d\'une question ne compte plus (seuls les guides des candidats)', LOT, "prixRendu: prixServi(k) || !langueNonLue(c, lectures) }", "prixRendu: prixServi(k) }", BANC],
    ['I2 : une langue de lecture inconnue (lecture absente) est lue « langue non lue »', LOT, "return Boolean(l) && typeof l === 'object' && l.codeLangue === null;", "return !l || typeof l !== 'object' || l.codeLangue == null;", BANC],
    ['I2 : le lot ne transmet plus ses lectures à la règle', LOT, "} else if (!lotAfficheUnPrix(cartes, lectures)) {", "} else if (!lotAfficheUnPrix(cartes)) {", BANC],
    ['M2 : une question sans candidat est lue « sans prix »', LOT, "|| c.candidats.length === 0 ||", "||", BANC],
    ['le guide d\'une carte identifiée ne compte plus (seul le repli)', LOT, "prixRendu: prixServi(c.carte) || instructionEnDirect(c), repli:", "prixRendu: instructionEnDirect(c), repli:", BANC],
    ['le repli servi ne compte plus (seul le guide)', LOT, "repli: avecRepliAnalyse(c).prixRepli ?? null })", "repli: null })", BANC],
    ['un prixGuide absent (undefined) est lu « sans prix »', LOT, "p.prixGuide !== null : true", "p.prixGuide != null : true", BANC],
    ['un introuvable compte pour un prix affiché', LOT, "if (c.statut === 'introuvable') return false;", "if (c.statut === 'introuvable') return true;", BANC],
    ['un statut inconnu est lu « sans prix » (remboursement sur un doute)', LOT, "return true; // statut inconnu : un prix est supposé affiché", "return false; // statut inconnu : un prix est supposé affiché", BANC],
    ['une lecture qui lève est lue « sans prix » (remboursement sur un doute)', LOT, "} catch (_) { return true; } // on ne peut pas conclure", "} catch (_) { return false; } // on ne peut pas conclure", BANC],
    ['une liste vide est lue « sans prix »', LOT, "if (!Array.isArray(cartes) || cartes.length === 0) return true;", "if (!Array.isArray(cartes) || cartes.length === 0) return false;", BANC],
    ['le remboursement passe par le compteur des déclarations (au lieu des constats)', LOT, "const r = await rendre('sans-prix');", "const r = await rendre('sans-prix', { compteur: 'sans-prix' });", BANC],
    ['le motif du grand livre n\'est plus sans-prix', LOT, "const r = await rendre('sans-prix');", "const r = await rendre('introuvable');", BANC],
    ['le motif servi d\'un lot rendu n\'est plus sans-prix', LOT, "r.rendu ? fabriquerFacturation({ debite: 0, rembourse: true, motif: 'sans-prix' })", "r.rendu ? fabriquerFacturation({ debite: 0, rembourse: true, motif: 'lot' })", BANC],
    ['un lot non rendu (plafond) ne dit plus le lot payé en entier (debite 1)', LOT, "fabriquerFacturation({ debite: cout, rembourse: false, motif: r.cause === 'plafond-jour'", "fabriquerFacturation({ debite: 1, rembourse: false, motif: r.cause === 'plafond-jour'", BANC],
    ['un lot refusé au plafond n\'a plus le motif plafond-jour', LOT, "motif: r.cause === 'plafond-jour' ? 'plafond-jour' : 'sans-prix', raisonNonRembourse:", "motif: 'sans-prix', raisonNonRembourse:", BANC],
    ['l\'administrateur passe après le remboursement (il serait rendu)', LOT, "if (admin) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });\n        else {\n            const r = await rendre('sans-prix');", "if (false) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });\n        else {\n            const r = await rendre('sans-prix');", BANC],
    ['la réservation de question qui échoue ne sait plus que le lot est rendu', LOT, " || sansPrixRendu);", ");", BANC],
    // tour 1 (I1) : l'instruction de prix en direct
    ['I1 : une instruction de prix en direct (langue lue) ne compte plus (le lot est rendu)', LOT, "prixRendu: prixServi(c.carte) || instructionEnDirect(c), repli:", "prixRendu: prixServi(c.carte), repli:", BANC],
    ['I1 : un prixLive absent (undefined) est lu « aucune instruction »', LOT, "const instructionEnDirect = c => c.prixLive !== null;", "const instructionEnDirect = c => c.prixLive != null;", BANC],
    // tour 1 (M1) : la facturation d'une réponse sur un lot déjà rendu
    ['M1 : la décision du lot rendu n\'est plus écrite sur ses questions', LOT, "        if (sansPrixRendu) {\n            try {", "        if (false) {\n            try {", BANC],
    ['M1 : un lot rendu à l\'analyse ne redit plus son motif (lot générique)', 'argent/questions.js', "motif: r.motif === 'sans-prix' ? 'sans-prix' : 'lot' });", "motif: 'lot' });", BANC],
    ['M1 : la décision écrite ne porte plus son motif', 'argent/questions.js', "...(i.rendu && i.motif === 'sans-prix' ? { motif: 'sans-prix' } : {}), ", "", BANC],
    ['M1 : le rejeu d\'un OUI sur un lot rendu à l\'analyse sert la facturation générique', 'argent/questions.js', "if (decide) return habillerLot(corps(l), decisionDeLotIssue(decide.lotIssue));", "if (false) return habillerLot(corps(l), decisionDeLotIssue(decide.lotIssue));", BANC],
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-lsp-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n'), ancreN = ancre.replace(/\r\n/g, '\n'), neufN = neuf.replace(/\r\n/g, '\n');
            const n = texte.split(ancreN).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`); fs.writeFileSync(copie, texte.replace(ancreN, () => neufN));
            const r = spawnSync(process.execPath, ['-r', path.join(V, BANCS, '_espion-fs-armer.js'), '-r', path.join(__dirname, 'accroche-mutant.js'), path.join(V, BANCS, banc)], {
                cwd: path.join(V, '..'), encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, RM_MUTANT_CIBLE: cible, RM_MUTANT_SOURCE: copie,
                    NODE_OPTIONS: `--require ${path.join(__dirname, 'accroche-mutant.js')}` } });
            const m = /(\d+) réussis, (\d+) échoués/.exec(r.stdout || '');
            const rouge = r.status !== 0 || (m && Number(m[2]) > 0);
            const verdict = rouge ? 'TUÉ' : equivalent ? 'ÉQUIVALENT' : 'SURVIVANT';
            resultats.push({ nom, verdict, banc, bilan: m ? `${m[1]}/${m[2]}` : 'pas de bilan' });
            journal(`${verdict.padEnd(10)} ${nom}  [${banc}] ${m ? `${m[1]} réussis, ${m[2]} échoués` : 'pas de bilan'}${equivalent && !rouge ? ` — ${equivalent}` : ''}`);
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
    console.log(`\n${res.length} mutants : ${compte('TUÉ')} tués, ${compte('ÉQUIVALENT')} équivalent(s) déclaré(s), ${compte('SURVIVANT')} survivant(s), ${compte('ANCRE')} ancre(s) cassée(s)`);
    process.exit(compte('SURVIVANT') + compte('ANCRE') ? 1 : 0);
}
