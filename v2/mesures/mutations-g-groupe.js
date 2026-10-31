'use strict';
// LE JEU DE MUTATIONS DE G-GROUPE (ordonner un groupe de 2 à 5 candidats par les zones mesurées par le client). Rejouable : `node v2/mesures/mutations-g-groupe.js` (tout) ou `--seulement=<fragment du nom>`.
// Même principe que mutations-lot-sans-prix.js (accroche-mutant.js) : on CASSE une garde à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché), on lance le banc qui la protège,
// et il DOIT devenir rouge. Un mutant qui reste vert est « survivant ». Jamais lancé par lancer-tout.js. Aucune base : les deux bancs sont purs.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';
const GG = 'identifier/g-groupe.js', ROUTE = 'identifier/calcul-client-route.js';
const B1 = 'test-g-groupe.js', B2 = 'test-g-groupe-route.js';

// [nom, fichier (relatif à v2/), ancre (une seule occurrence), remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    ['l\'avance exigée est stricte (le seuil n\'est plus inclus)', GG, 'if (ecart < ecartMin) return non(\'ecart-insuffisant\');', 'if (ecart <= ecartMin) return non(\'ecart-insuffisant\');', B1],
    ['aucune avance n\'est exigée', GG, 'if (ecart < ecartMin) return non(\'ecart-insuffisant\');', 'if (ecart < 0) return non(\'ecart-insuffisant\');', B1],
    ['le plancher d\'inliers de la tête n\'est plus exigé', GG, 'if (tete.inliers < plancher) return non(\'plancher\');', 'if (false) return non(\'plancher\');', B1],
    ['une mesure illisible vaut zéro inlier (au lieu d\'arrêter la règle)', GG, 'if (!zonesLisibles(zn)) return non(\'mesure-absente\');', 'if (!zonesLisibles(zn)) { mesure.set(c.cle, 0); continue; }', B1],
    ['un candidat sans visuel connu ne bloque plus', GG, 'if (groupe.some(c => typeof c.cle !== \'string\' || c.cle === \'\')) return non(\'visuel-inconnu\');', '', B1],
    ['deux candidats au visuel de tête : on en choisit un', GG, 'if (groupe.filter(c => c.cle === tete.cle).length > 1) return non(\'ex-aequo-visuel\');', '', B1],
    ['le tri est inversé (le moins aligné en tête)', GG, 'sort((a, b) => b.inliers - a.inliers || a.i - b.i)', 'sort((a, b) => a.inliers - b.inliers || a.i - b.i)', B1],
    ['un seuil nul est accepté', GG, 'ecartMin > 0)', 'ecartMin >= 0)', B1],
    ['le groupe n\'est plus borné à cinq', GG, 'groupe.length > GROUPE_MAX', 'groupe.length > 99', B1],
    ['un inliers au-delà du contrat est lisible', GG, 'zn.inliers <= INLIERS_MAX', 'zn.inliers <= 1e9', B1],
    ['l\'avance se mesure au PIRE des autres (au lieu du meilleur)', GG, 'const second = autres[0];', 'const second = autres[autres.length - 1];', B1],
    ['un visuel emprunté ou un emprunt inconnu est un visuel propre', GG, 'if (version.empruntDe(id) !== false) return null;', 'if (version.empruntDe(id) === true) return null;', B1],
    ['la demande peut dépasser le maximum du contrat d\'une mesure', GG, 'deja.length + ajout.length > max ? null : ajout', 'deja.length + ajout.length > max + 1 ? null : ajout', B1],
    ['une zone hors de [-1, 1] est lisible', GG, 'const nombre = (x, lo, hi) => typeof x === \'number\' && Number.isFinite(x) && x >= lo && x <= hi;', 'const nombre = (x, lo, hi) => typeof x === \'number\' && Number.isFinite(x);', B1],
    // le branchement
    ['le drapeau est ignoré dans la demande (toujours allumé)', ROUTE, 'if (cfg.gGroupe === true) {', 'if (true) {', B2],
    ['le drapeau est ignoré dans le jugement (toujours calculé)', ROUTE, 'args.gGroupe !== true ||', 'false ||', B2],
    ['le jeton ne signe plus la liste étendue', ROUTE, 'MC.signerJeton({ scanId: String(scanId), mesures, refs: refsJeton, exp }', 'MC.signerJeton({ scanId: String(scanId), mesures: ens.mesures, refs: refsJeton, exp }', B2],
    ['les références n\'incluent plus les visuels du groupe', ROUTE, 'refsDemande = [...refsDemande, ...gr.map(c => c.cle).filter((k, i, a) => !refsDemande.includes(k) && a.indexOf(k) === i)];', '', B2],
    ['le groupe n\'est plus stocké pour le second envoi', ROUTE, '...(groupe ? { groupe } : {}) }', '}', B2],
    ['le jugement ne valide plus les résultats avant d\'ordonner', ROUTE, 'if (!MC.validerResultats(args.cm.mesures, args.resultats).ok) return j;', '', B2],
    ['le seuil de la configuration est remplacé par une constante', ROUTE, 'ecartMin: args.ecartMin })', 'ecartMin: 100 })', B2],
    ['une demande de G vide ne peut plus porter le groupe', ROUTE, 'if (mesures.length === 0) return null;', 'if (ens.mesures.length === 0) return null;', B2],
    ['un ensemble nul de G ne porte plus le groupe (le client ne mesure plus rien)', ROUTE, 'if (!ens && cfg.gGroupe !== true) return null;', 'if (!ens) return null;', B2],
    ['le maximum du contrat n\'est plus respecté', ROUTE, 'max: MC.MESURES_MAX', 'max: 99', B2],
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-gg-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n'), ancreN = ancre.replace(/\r\n/g, '\n'), neufN = neuf.replace(/\r\n/g, '\n');
            const n = texte.split(ancreN).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`); fs.writeFileSync(copie, texte.replace(ancreN, () => neufN));
            const r = spawnSync(process.execPath, ['-r', path.join(V, BANCS, '_espion-fs-armer.js'), '-r', path.join(__dirname, 'accroche-mutant.js'), path.join(V, BANCS, banc)], {
                cwd: path.join(V, '..'), encoding: 'utf8', timeout: 200000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, RM_MUTANT_CIBLE: cible, RM_MUTANT_SOURCE: copie, NODE_OPTIONS: `--require ${path.join(__dirname, 'accroche-mutant.js')}` } });
            const m = /(\d+) réussis, (\d+) échoués/.exec(r.stdout || '');
            const rouge = r.status !== 0 || (m && Number(m[2]) > 0);
            const verdict = rouge ? 'TUÉ' : equivalent ? 'ÉQUIVALENT' : 'SURVIVANT';
            resultats.push({ nom, verdict, banc, bilan: m ? `${m[1]}/${m[2]}` : 'pas de bilan' });
            journal(`${verdict.padEnd(10)} ${nom}  [${banc}] ${m ? `${m[1]} réussis, ${m[2]} échoués` : 'pas de bilan'}${equivalent && !rouge ? ` — ${equivalent}` : ''}`);
        });
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    return resultats;
}
function ancresCassees() {
    return MUTANTS.filter(([, fichier, ancre]) => fs.readFileSync(path.join(V, fichier), 'utf8').replace(/\r\n/g, '\n').split(ancre.replace(/\r\n/g, '\n')).length - 1 !== 1).map(m => m[0]);
}
module.exports = { MUTANTS, rejouer, ancresCassees };

if (require.main === module) {
    const arg = process.argv.slice(2);
    if (arg.some(a => !/^--seulement=.{1,60}$/.test(a)) || arg.length > 1) { console.error('ARRÊT : seul --seulement=<fragment du nom> est admis'); process.exit(1); }
    const res = rejouer({ seulement: arg[0] ? arg[0].slice(12) : null });
    const compte = v => res.filter(r => r.verdict === v).length;
    console.log(`\n${res.length} mutants : ${compte('TUÉ')} tués, ${compte('ÉQUIVALENT')} équivalent(s) déclaré(s), ${compte('SURVIVANT')} survivant(s), ${compte('ANCRE')} ancre(s) cassée(s)`);
    process.exit(compte('SURVIVANT') + compte('ANCRE') ? 1 : 0);
}
