'use strict';
// LE JEU DE MUTATIONS DE LA FORME « PAIRE SÉPARÉE PAR LA VARIANTE » (PARTAGES-VARIANTE). Rejouable : `node v2/mesures/mutations-partages-variante.js` (tout) ou `... --seulement=<fragment du nom>`.
// Même principe et même mécanique que mutations-abonnements.js (accroche-mutant.js) : on CASSE une garde à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché),
// on lance le banc qui la protège (test-partages-variante.js), et il DOIT devenir rouge. « SURVIVANT » = une garde que rien ne vérifie ; un mutant équivalent se déclare avec sa raison.
// N'est JAMAIS lancé par lancer-tout.js (qui ne lit que v2/test). Chaque ancre doit exister EXACTEMENT UNE fois dans le code actuel (ancresCassees()).
// Besoin : la base de banc en mémoire (MONGOMS_DOWNLOAD_DIR vers le cache de mongod, comme pour les bancs).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';
const BANC = 'test-partages-variante.js';
const PV = 'identifier/partage-variante.js';
const ANCRE_PAIRE = "(sa !== sb && (sa ? eb : ea).variante === 'normale')";

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    // — la définition commune : separeeParVariante —
    ['holo/non-holo ignoré', PV, "m.partageeHoloNonHolo !== true && ", "", BANC],
    ['variante non exigée (n\'importe laquelle)', PV, "&& VARIANTES_PAIRE.includes(variante);", "&& true;", BANC],
    ['false non exigé (true, null passent)', PV, "m.partageeTamponNonSepare === false && ", "", BANC],
    ['une liste vide vaut « sans liste »', PV, "const sansListe = l => l === undefined || l === null;", "const sansListe = l => l === undefined || l === null || (Array.isArray(l) && l.length === 0);", BANC],
    ['le jumbo n\'est plus une variante de paire', PV, "Object.freeze(['staff', 'jumbo', 'normale'])", "Object.freeze(['staff', 'normale'])", BANC],
    // — pairePar —
    ['staff + jumbo accepté, mais pas deux identiques (RELECTURE I1 : survivait au banc du commit 320030a9)', PV, ANCRE_PAIRE, "(sa !== sb || ea.variante !== eb.variante)", BANC],
    ['un special avec un special (« sa || sb »)', PV, ANCRE_PAIRE, "(sa || sb)", BANC],
    ['le jumbo n\'est plus un special', PV, "const VARIANTES_SPECIALES = Object.freeze(['staff', 'jumbo']);", "const VARIANTES_SPECIALES = Object.freeze(['staff']);", BANC],
    ['« l\'autre côté est normale » retiré', PV, ANCRE_PAIRE, "(sa !== sb)", BANC, 'équivalent : separeeParVariante ne laisse passer que staff|jumbo|normale des deux côtés, donc exactement un special implique que l\'autre est normale'],
    ['le même visuel n\'est plus exigé', PV, "if (!memeFichier(ea.vignette, eb.vignette) || !memeFichier(ea.grande, eb.grande, true)) return", "if (false) return", BANC],
    ['deux vignettes absentes = le même visuel (RELECTURE M1)', PV, "? absenteAdmise === true :", "? true :", BANC],
    ['deux grandes absentes ≠ le même visuel', PV, "!memeFichier(ea.grande, eb.grande, true)", "!memeFichier(ea.grande, eb.grande, false)", BANC],
    ['la même fiche n\'est plus exigée', PV, "if (!meme) return", "if (false) return", BANC],
    // — la décision, la structure et la colonne des partages —
    ['décision : la forme admise ne l\'est plus que pour une variante quelconque', 'chargeur/decision.js', "if (separeeParVariante(im, variante)) return false;", "if (variante) return false;", BANC],
    ['décision : les marquages ne sont pas servis à la paire séparée', 'chargeur/decision.js', "const concerne = liste || paire;", "const concerne = liste;", BANC],
    ['structure : un drapeau de partage sans liste est toujours admis', 'chargeur/version.js', "const parVariante = partage && taille === 0 && separeeParVariante(", "const parVariante = partage && taille === 0 && (() => true)(", BANC],
    ['colonne des partages : le partenaire de la paire n\'est pas rendu', 'chargeur/version.js', "p = pairesParVariante().partenaires.get(id);", "p = undefined;", BANC],
    // — F1 —
    ['F1 : le jumbo déclenche la lecture', 'identifier/lecture-tampon.js', "if (p.variante !== 'staff') return refus", "if (false) return refus", BANC],
    ['F1 (route) : la fiche commune est toujours vraie', 'identifier/lecture-tampon-route.js', "memeFiche: typeof version.memeFiche === 'function' ? (x, y) => version.memeFiche(x, y) : undefined", "memeFiche: () => true", BANC]
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n');
            const n = texte.split(ancre).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`); fs.writeFileSync(copie, texte.replace(ancre, () => neuf));
            const r = spawnSync(process.execPath, ['-r', path.join(V, BANCS, '_espion-fs-armer.js'), '-r', path.join(__dirname, 'accroche-mutant.js'), path.join(V, BANCS, banc)], {
                cwd: path.join(V, '..'), encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, RM_MUTANT_CIBLE: cible, RM_MUTANT_SOURCE: copie } });
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
function ancresCassees() { return MUTANTS.filter(([, fichier, ancre]) => fs.readFileSync(path.join(V, fichier), 'utf8').replace(/\r\n/g, '\n').split(ancre).length - 1 !== 1).map(m => m[0]); }
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
