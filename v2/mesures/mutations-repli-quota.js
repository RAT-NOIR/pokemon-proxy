'use strict';
// LE JEU DE MUTATIONS DE REPLI-QUOTA (la règle « un scan qui AFFICHE un prix compte dans le quota »). Rejouable : `node v2/mesures/mutations-repli-quota.js` (tout) ou `... --seulement=<fragment du nom>`.
// Même principe que mutations-abonnements.js (dont il réutilise l'accroche accroche-mutant.js) : on CASSE une garde à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais
// touché), on lance le banc qui la protège, et il DOIT devenir rouge. Un mutant qui reste vert est « survivant » ; les équivalents sont déclarés avec leur raison. Jamais lancé par lancer-tout.js.
// Besoin : la base de banc en mémoire (MONGOMS_DOWNLOAD_DIR vers le cache de mongod, comme pour les bancs).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';
const RL = 'identifier/retour-live.js', PR = 'identifier/prix-repli.js', SC = 'scanner/routes.js';
const DECISION = "else if (afficheUnPrix({ repli: repliDecide })) facturation = fabriquerFacturation({ debite: 1, rembourse: false, motif: 'sans-prix', raisonNonRembourse: 'prix-repli' });";

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    ['un repli servi est quand même remboursé (la décision ne consulte plus le repli)', RL, DECISION, DECISION.replace('afficheUnPrix({ repli: repliDecide })', 'false'), 'test-repli-quota.js'],
    ['un scan SANS repli n\'est plus remboursé (la décision l\'affiche toujours)', RL, DECISION, DECISION.replace('afficheUnPrix({ repli: repliDecide })', 'true'), 'test-repli-quota.js'],
    ['la décision se prend sur un repli jamais calculé (null)', RL, 'afficheUnPrix({ repli: repliDecide })', 'afficheUnPrix({ repli: null })', 'test-repli-quota.js'],
    ['la raison du non-remboursement est plafond-jour', RL, "motif: 'sans-prix', raisonNonRembourse: 'prix-repli' });", "motif: 'sans-prix', raisonNonRembourse: 'plafond-jour' });", 'test-repli-quota.js'],
    ['le scan non remboursé n\'est plus débité (debite 0)', RL, "facturation = fabriquerFacturation({ debite: 1, rembourse: false, motif: 'sans-prix', raisonNonRembourse: 'prix-repli' });", "facturation = fabriquerFacturation({ debite: 0, rembourse: false, motif: 'sans-prix', raisonNonRembourse: 'prix-repli' });", 'test-repli-quota.js'],
    ['le repli consomme quand même le plafond des déclarations (un remboursement est tenté)', RL, "else if (afficheUnPrix({ repli: repliDecide })) facturation = ", "else if (afficheUnPrix({ repli: repliDecide })) facturation = (await argent.rembourser(porteur, { poche: null }, 'sans-prix', { scanId, compteur: 'sans-prix' }), null) || ", 'test-repli-quota.js'],
    ['l\'administrateur passe après le repli (il serait compté)', RL, "if (porteur.administrateur) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });\r\n                // REPLI-QUOTA", "if (false) facturation = fabriquerFacturation({ motif: 'administrateur', rembourse: false });\r\n                // REPLI-QUOTA", 'test-repli-quota.js'],
    ['le repli servi dans la réponse n\'est plus celui qui décide (second calcul sans la lecture ratée)', RL, "try { repli = await repliDuRetour(porteur, scanId, carte, b, lr); }", "try { repli = await repliDuRetour(porteur, scanId, carte, b, null); }", 'test-repli-quota.js'],
    ['la règle ignore le repli (seule la page compte)', PR, "return prixRendu === true || (repli !== null && typeof repli === 'object' && !Array.isArray(repli));", "return prixRendu === true;", 'test-prix-repli.js'],
    ['la règle affiche toujours un prix', PR, "return prixRendu === true || (repli !== null && typeof repli === 'object' && !Array.isArray(repli));", "return true;", 'test-prix-repli.js'],
    ['la règle accepte n\'importe quelle valeur vraie (1, « oui »)', PR, "return prixRendu === true || (repli !== null && typeof repli === 'object' && !Array.isArray(repli));", "return Boolean(prixRendu) || Boolean(repli);", 'test-prix-repli.js'],
    ['la valeur « prix-repli » sort de la liste fermée', '../sources.js', "    'prix-repli',             // REPLI-QUOTA", "    // REPLI-QUOTA", 'test-prix-repli.js'],
    ['A15 : le scanner ne rembourse plus une carte identifiée sans prixGuide', SC, "!afficheUnPrix({ prixRendu: k.carte.prixGuide !== null })", "!afficheUnPrix({ prixRendu: true })", 'test-scanner-routes.js'],
    ['A15 : le scanner rembourse une carte qui a un prixGuide', SC, "!afficheUnPrix({ prixRendu: k.carte.prixGuide !== null })", "!afficheUnPrix({ prixRendu: false })", 'test-scanner-routes.js'],
    ['un lot : la garde de retour-live accepte le statut « lot » (une carte de lot serait remboursée)', RL, "if (!['identifiee', 'a-trancher'].includes(an.statut)) return false;", "if (!['identifiee', 'a-trancher', 'lot'].includes(an.statut)) return false;", 'test-repli-quota.js'],
    ['le calcul du repli n\'est plus mémorisé (relu une seconde fois)', RL, "if (repliCalcule) return repli;", "", 'test-repli-quota.js'],        // plus d'équivalent déclaré : R10 compte les lectures d'appui du repli (une seule par requête) et fait échouer toute lecture suivante
    ['I1 : l\'échec du calcul du repli est avalé (le scan est remboursé comme sans prix)', RL, "if (strict) throw e; repli = null;", "repli = null;", 'test-repli-quota.js'],
    ['I1 : l\'échec du calcul du repli ne répond plus INDISPONIBLE (le scan est remboursé)', RL, "catch (e) { return repondreErreur(res, 'INDISPONIBLE'); } }\r\n                if (porteur.administrateur) facturation", "catch (e) { repliDecide = null; } }\r\n                if (porteur.administrateur) facturation", 'test-repli-quota.js'],
    ['I1 : la décision ne passe plus par le calcul strict', RL, "repliDecide = await calculerRepli({ strict: true });", "repliDecide = await calculerRepli();", 'test-repli-quota.js'],
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-rq-'));
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
                    NODE_OPTIONS: `--require ${path.join(__dirname, 'accroche-mutant.js')}` } });       // NODE_OPTIONS : le serveur ENFANT du banc (verrou/serveur.js hérite de l'environnement) charge lui aussi la copie mutée
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
