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
    ['variante non exigée (n\'importe laquelle)', PV, "&& estVariantePaire(variante);", "&& true;", BANC],
    ['false non exigé (true, null passent)', PV, "m.partageeTamponNonSepare === false && ", "", BANC],
    ['une liste vide vaut « sans liste »', PV, "const sansListe = l => l === undefined || l === null;", "const sansListe = l => l === undefined || l === null || (Array.isArray(l) && l.length === 0);", BANC],
    ['le jumbo n\'est plus une variante de paire', PV, "const estVariantePaire = MT.estVariante;", "const estVariantePaire = v => MT.estVariante(v) && v !== 'jumbo';", BANC],
    // — pairePar —
    ['staff + jumbo accepté, mais pas deux identiques (RELECTURE I1 : survivait au banc du commit 320030a9)', PV, ANCRE_PAIRE, "(sa !== sb || ea.variante !== eb.variante)", BANC],
    ['un special avec un special (« sa || sb »)', PV, ANCRE_PAIRE, "(sa || sb)", BANC],
    ['le jumbo n\'est plus un special', PV, "const sa = MT.estSpeciale(ea.variante), sb = MT.estSpeciale(eb.variante);", "const sa = ea.variante === 'staff', sb = eb.variante === 'staff';", BANC],
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
    ['F1 : le jumbo déclenche la lecture', 'identifier/lecture-tampon.js', "if (!lu || lu.type !== 'marques') return refus(MOTIF_PAIRE);", "if (false) return refus(MOTIF_PAIRE);", BANC],
    ['F1 (route) : la fiche commune est toujours vraie', 'identifier/lecture-tampon-route.js', "memeFiche: typeof version.memeFiche === 'function' ? (x, y) => version.memeFiche(x, y) : undefined", "memeFiche: () => true", BANC],
    // — LOT TAMPONS : la liste fermée, la lecture des marques, la colonne des prix mélangés (chaque mutant a SON banc) —
    ...[
        ['marques : un autre ordre est admis', 'identifier/marques-tampon.js', "if (RANG.get(parts[i]) <= RANG.get(parts[i - 1])) return null;", "if (false) return null;", 'test-marques-tampon.js'],
        ['marques : la forme ancienne staff-prerelease n\'est plus lue', 'identifier/marques-tampon.js', "const canon = Object.prototype.hasOwnProperty.call(FORMES_ANCIENNES, v) ? FORMES_ANCIENNES[v] : v;", "const canon = v;", 'test-marques-tampon.js'],
        ['marques : le plafond de 4 marques est retiré', 'identifier/marques-tampon.js', "if (parts.length > MARQUES_MAX) return null;", "", 'test-marques-tampon.js'],
        ['décision : « aucune marque lue deux fois » vaut sûr', 'identifier/lecture-tampon.js', "if (k === 'm:') return r(false, 'aucune', [],", "if (false) return r(false, 'aucune', [],", 'test-lecture-tampon.js'],
        ['décision : `autre` est ignoré quand toutes les marques lues sont dans la liste', 'identifier/lecture-tampon.js', "if (r.autre === true || !m.every(MT.estMarque)) return { autre: true };", "if (!m.every(MT.estMarque)) return { autre: true };", 'test-lecture-tampon.js'],
        ['décision : deux ensembles différents ne sont plus un désaccord', 'identifier/lecture-tampon.js', "if (!cles.every(k => k === cles[0])) return r(false, 'desaccord'", "if (false) return r(false, 'desaccord'", 'test-lecture-tampon.js'],
        ['décision : deux places à la fois sont admises', 'identifier/lecture-tampon.js', "return e !== null && UNE_PLACE_AU_PLUS(e) ? { marques: e } : { autre: true };", "return e !== null ? { marques: e } : { autre: true };", 'test-lecture-tampon.js'],
        ['fournisseur : un premier essai sans marque n\'arrête plus la lecture (coût)', 'identifier/lecture-tampon.js', "if (!(x && x.marques && x.marques.length)) break;", "if (false) break;", 'test-lecture-tampon.js'],
        ['déclenchement : un tampon « non représenté » n\'est plus exigé (paire à listes)', 'identifier/lecture-tampon.js', "if (!dit()) return refus(REFUS_DIT);\n        return { ok: true, type: special.jeton", "return { ok: true, type: special.jeton", 'test-lecture-tampon.js'],
        ['route : l\'ensemble lu n\'est plus comparé à celui du produit tamponné', 'identifier/lecture-tampon-route.js', "if (MT.jetonDeMarques(lu.marques) !== paire.variante) {", "if (false) {", 'test-lecture-tampon-route.js'],
        ['route : le fournisseur décide à la place du module', 'identifier/lecture-tampon-route.js', "if (d.sur && lu.lecture === 'marques') return", "if (lu.lecture === 'marques') return", 'test-lecture-tampon-route.js'],
        ['route : l\'ensemble annoncé par le fournisseur remplace celui des essais', 'identifier/lecture-tampon-route.js', "return { issue: 'oui', appels, raison: d.raison, marques: d.marques, accord };", "return { issue: 'oui', appels, raison: d.raison, marques: lu.marques, accord };", 'test-lecture-tampon-route.js'],
        ['lecteur : un champ `unclear` manquant est admis', 'identifier/seconde-lecture-image.js', " && typeof p.other === 'boolean' && typeof p.unclear === 'boolean';", " && typeof p.other === 'boolean';", 'test-lecture-tampon-image.js'],
        ['chargeur : la variante est portée sans sa preuve', 'chargeur/decision.js', "return v !== null && texte(l.variantePreuve) ? v : null; };", "return v; };", 'test-partages-marques.js'],
        ['chargeur : le prix mélangé est coercé (« true » texte, 1…)', 'chargeur/source.js', "prixMelangeTampon: d.prixMelangeTampon === true ? true : d.prixMelangeTampon === false ? false : null,", "prixMelangeTampon: d.prixMelangeTampon ? true : null,", 'test-prix-melange-archive.js'],
        ['archive : deux entrées d\'un même produit, le dernier prix mélangé gagne', 'chargeur/version.js', "melange: unionBool(p.melange, m.melange),", "melange: m.melange,", 'test-prix-melange-archive.js'],
        ['archive : le compte « melange » de l\'en-tête n\'est plus vérifié', 'chargeur/version.js', "(dit.melange === undefined ? calc.melange !== 0 : dit.melange !== calc.melange)", "false", 'test-prix-melange-archive.js'],
        ['catalogue : l\'archive ne marque plus le prix mélangé du produit', 'identifier/catalogue.js', "prixMelangeTampon: n.prixMelangeTampon === true || v.prixMelangeTampon === true,", "prixMelangeTampon: n.prixMelangeTampon === true,", 'test-prix-melange-archive.js'],
        ['contrat : `marques` est servi sans contrôle de la forme canonique', 'identifier/produit.js', "return e !== null && e.length === x.length && e.every((m, i) => m === x[i]) ? Object.freeze(e) : null;", "return e !== null ? Object.freeze(e) : null;", 'test-identifier-produit.js']
    ].map(m => [m[0], m[1], m[2], m[3], m[4]])
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
