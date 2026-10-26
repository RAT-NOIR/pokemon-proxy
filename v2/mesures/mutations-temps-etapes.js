'use strict';
// LE JEU DE MUTATIONS DE TEMPS-ETAPES (le chronomètre `analyses.durees` et les trois coupes de temps V2_TE_*). Rejouable : `node v2/mesures/mutations-temps-etapes.js` (tout) ou `... --seulement=<fragment du nom>`.
// Même principe que mutations-lot-sans-prix.js (qui réutilise accroche-mutant.js) : on CASSE une pièce à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché), on lance le banc
// qui la garde, et il DOIT devenir rouge. Un mutant qui reste vert est « survivant » ; un mutant ÉQUIVALENT est déclaré avec sa raison. Jamais lancé par lancer-tout.js (qui ne tourne jamais dans une copie de mutation).
// Besoin : la base de banc en mémoire (MONGOMS_DOWNLOAD_DIR vers le cache de mongod, comme pour les bancs).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';
const PURE = 'test-temps-etapes.js', ROUTE = 'test-temps-etapes-route.js';
const VE = 'identifier/voisins-empreinte.js', SPI = 'identifier/sur-par-image-route.js', RT = 'identifier/routes.js', TEM = 'identifier/temps-etapes.js', PR = 'identifier/photos-recues.js', PAS = 'identifier/photo-avant-scan.js', CFG = 'config.js', IDX = '../index.js';

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    // ── la recherche des voisins, UNE fois (voisinsUneFois)
    ['voisins : la mémoire n\'est jamais lue', VE, "const memoire = memo === true && typeof env === 'object' ? MEMO_VOISINS.get(env) : null;", 'const memoire = null;', PURE],
    ['voisins : un index rechargé n\'invalide plus la mémoire', VE, 'memoire.courant === courant && memoire.e0 === e0 &&', 'memoire.e0 === e0 &&', PURE],
    ['voisins : l\'entrée jugée n\'est plus comparée', VE, 'memoire.e0 === e0 && memoire.id', 'memoire.id', PURE, 'e0 est déterminé par l\'enveloppe (même objet = même entrée jugée) : la comparaison est une ceinture que rien ne peut contredire'],
    ['voisins : le modèle voulu n\'est plus comparé', VE, 'memoire.id === voulu.id && memoire.sha256 === voulu.sha256) return', 'true) return', PURE, 'le modèle est jugé AVANT la mémoire (modele-inconnu) : un modèle différent ne l\'atteint jamais'],
    ['voisins : la mémoire rend l\'objet gardé (plus de copie)', VE, 'return copieDe(memoire.resultat);', 'return memoire.resultat;', PURE],
    ['voisins : le premier appel rend l\'objet gardé (plus de copie)', VE, 'return copieDe(resultat);', 'return resultat;', PURE],
    ['voisins : la mémoire n\'est jamais écrite', VE, 'MEMO_VOISINS.set(env, { courant, e0, id: voulu.id, sha256: voulu.sha256, resultat });', '', PURE],
    ['voisins : la recherche n\'est plus mesurée', VE, "const v = chrono ? chrono.mesurerSync('voisins', chercher) : chercher();", 'const v = chercher();', ROUTE],
    ['fournisseur : le drapeau voisinsUneFois est toujours éteint', VE, "const memo = require('./temps-etapes').reglages(cfg).voisinsUneFois;", 'const memo = false;', ROUTE],
    ['fournisseur : la mémoire est toujours allumée (même drapeau éteint)', VE, "const memo = require('./temps-etapes').reglages(cfg).voisinsUneFois;", 'const memo = true;', ROUTE, 'le fournisseur ne fait qu\'ÉCRIRE la mémoire ; elle n\'est lue que par un appelant qui la demande (SUR-PAR-IMAGE, drapeau éteint : memo false) — une mémoire écrite sans lecteur ne change aucune sortie (les deux sites allumés ensemble sont couverts par le mutant « reglages : voisinsUneFois toujours vrai »)'],
    ['fournisseur : le chronomètre n\'est pas transmis à la recherche', VE, 'preparerVecteur({ entree, voulu: attendu(), etat, memo, chrono })', 'preparerVecteur({ entree, voulu: attendu(), etat, memo })', ROUTE],
    ['fournisseur : la garde des zones n\'est plus mesurée (étape orb)', VE, 'const chronoEtape = (nom, f) => (chrono ? chrono.mesurer(nom, f) : f());', 'const chronoEtape = (nom, f) => f();', ROUTE],
    ['fournisseur : le chronomètre n\'est pas transmis aux mesures', VE, 'mesurer({ ligne, ctx, carte, arret, chrono })', 'mesurer({ ligne, ctx, carte, arret })', ROUTE],
    ['SUR-PAR-IMAGE : la mémoire des voisins est toujours éteinte', SPI, "memo: require('./temps-etapes').reglages(cfg).voisinsUneFois, chrono", 'memo: false, chrono', ROUTE],
    ['SUR-PAR-IMAGE : la mémoire des voisins est toujours allumée', SPI, "memo: require('./temps-etapes').reglages(cfg).voisinsUneFois, chrono", 'memo: true, chrono', ROUTE, 'SUR-PAR-IMAGE est le DERNIER lecteur du vecteur : sa mémoire n\'a pas de lecteur après lui, et il ne lit que ce que le fournisseur a écrit (drapeau éteint : rien) — le mutant écrit sans que personne lise'],
    // ── la recherche et les zones PENDANT l'attente du modèle (empreinteTot)
    ['empreinteTot : le départ anticipé n\'a jamais lieu', RT, 'if (te.empreinteTot && fournisseurEmpreinte && entree.empreintes) {', 'if (false && te.empreinteTot && fournisseurEmpreinte && entree.empreintes) {', ROUTE],
    ['empreinteTot : le départ anticipé ignore le drapeau', RT, 'if (te.empreinteTot && fournisseurEmpreinte && entree.empreintes) {', 'if (fournisseurEmpreinte && entree.empreintes) {', ROUTE],
    ['empreinteTot : le départ anticipé a lieu sans vecteur', RT, 'if (te.empreinteTot && fournisseurEmpreinte && entree.empreintes) {', 'if (te.empreinteTot && fournisseurEmpreinte) {', ROUTE],
    ['empreinteTot : la fin de la chaîne rappelle le fournisseur au lieu d\'attendre la promesse', RT, 'const appel = prechargee === null ? normal : async () => {', 'const appel = true ? normal : async () => {', ROUTE],
    ['empreinteTot : un « indisponible » de la voie anticipée est rendu tel quel (plus de relance par la voie normale)', RT, "return r && !(r.ok === false && r.code === 'indisponible') ? r : normal();", 'return r || normal();', ROUTE],
    ['empreinteTot : la voie normale est relancée même sur une issue réussie (appel en trop)', RT, "return r && !(r.ok === false && r.code === 'indisponible') ? r : normal();", 'return normal();', ROUTE],
    ['empreinteTot : la promesse anticipée n\'est pas mesurée (étape empreinte)', RT, "new Promise(r => setImmediate(r)).then(() => T.mesurer('empreinte', () => fournisseurEmpreinte({ entree, scanId: String(scanId), chrono: T })));", 'new Promise(r => setImmediate(r)).then(() => fournisseurEmpreinte({ entree, scanId: String(scanId), chrono: T }));', ROUTE],
    ['empreinteTot : le rejet de la promesse anticipée n\'est plus capté (rejet non géré)', RT, 'empreintePrechargee.catch(() => { });', '', ROUTE],
    ['empreinteTot : le départ au tour suivant devient un départ au même tour (la chaîne n\'a pas encore émis son appel)', RT, 'new Promise(r => setImmediate(r)).then(() => T.mesurer(', 'Promise.resolve().then(() => T.mesurer(', ROUTE, 'ordonnancement seul : le résultat est le même, un banc ne peut pas séparer un micro-tour d\'un macro-tour sans fabriquer une horloge de planificateur'],
    // ── la règle G n'est pas consultée pour un introuvable (orbUtile)
    ['orbUtile : jamais appliqué', RT, 'if (te.orbUtile && resultat.issue === \'introuvable\') {', 'if (false && te.orbUtile && resultat.issue === \'introuvable\') {', ROUTE],
    ['orbUtile : ignore le drapeau (G sautée sur tout introuvable)', RT, 'if (te.orbUtile && resultat.issue === \'introuvable\') {', 'if (resultat.issue === \'introuvable\') {', ROUTE],
    ['orbUtile : G sautée aussi sur une question ou une affirmation', RT, 'if (te.orbUtile && resultat.issue === \'introuvable\') {', 'if (te.orbUtile) {', ROUTE],
    ['orbUtile : la réponse dit que G a servi alors qu\'elle n\'a pas tourné', RT, "empreinteInfo = { public: { utilisee: false, code: 'muette' }, influence: false, promotion: false, lectureConcordante: false };\n                        } else {", "empreinteInfo = { public: { utilisee: true, code: null }, influence: false, promotion: false, lectureConcordante: false };\n                        } else {", ROUTE],
    ['orbUtile : la promotion d\'un introuvable est autorisée par la route', RT, '{ garde, depuisIntrouvable: false }', '{ garde, depuisIntrouvable: true }', PURE],
    ['orbUtile : le drapeau est allumé par défaut', CFG, "booleen('V2_TE_ORB_UTILE', env.V2_TE_ORB_UTILE, false)", "booleen('V2_TE_ORB_UTILE', env.V2_TE_ORB_UTILE, true)", PURE],
    ['orbUtile : tout ce qui est « truthy » allume', TEM, 'orbUtile: t.orbUtile === true }', 'orbUtile: Boolean(t.orbUtile) }', PURE],
    // ── la fin de requête en parallèle (finParallele)
    ['finParallele : jamais allumé', RT, 'if (te.finParallele && !erreurLot && sortie && sortie.resultat && sortie.resultat.issue !== \'panne\') {', 'if (false && te.finParallele && !erreurLot && sortie && sortie.resultat && sortie.resultat.issue !== \'panne\') {', ROUTE],
    ['finParallele : ignore le drapeau (toujours allumé)', RT, 'if (te.finParallele && !erreurLot && sortie && sortie.resultat && sortie.resultat.issue !== \'panne\') {', 'if (!erreurLot && sortie && sortie.resultat && sortie.resultat.issue !== \'panne\') {', ROUTE],
    ['finParallele : lance le taux même sur une panne', RT, "if (te.finParallele && !erreurLot && sortie && sortie.resultat && sortie.resultat.issue !== 'panne') {", 'if (te.finParallele && !erreurLot && sortie && sortie.resultat) {', ROUTE],
    ['finParallele : solde, offre et taux ne partent pas ensemble', RT, 'await T.mesurer(\'base\', () => Promise.all([soldeSur(), offreP(), regleVerdict(entree.devise).then(x => ({ ok: true, x }), e => ({ ok: false, e }))]));', 'await T.mesurer(\'base\', async () => [await soldeSur(), await offreP(), await regleVerdict(entree.devise).then(x => ({ ok: true, x }), e => ({ ok: false, e }))]);', ROUTE],
    ['finParallele : le taux est relu plus bas (regleLue jamais posé)', RT, 'solde = s; offre = o; regleLue = true;', 'solde = s; offre = o; regleLue = false;', ROUTE],
    ['finParallele : l\'analyse et l\'annonce ne partent pas ensemble', RT, 'if (te.finParallele) await T.mesurer(\'base\', () => Promise.all([ecrireAnalyse(), ecrireAnnonce()]));', 'if (false) await T.mesurer(\'base\', () => Promise.all([ecrireAnalyse(), ecrireAnnonce()]));', ROUTE],
    ['finParallele : la clôture de la marque n\'attend plus les écritures', RT, 'if (te.finParallele) await T.mesurer(\'base\', () => Promise.all([ecrireAnalyse(), ecrireAnnonce()]));', 'if (te.finParallele) { T.mesurer(\'base\', () => Promise.all([ecrireAnalyse(), ecrireAnnonce()])); }', ROUTE],
    // ── le journal des durées
    ['durees : la ligne d\'analyse ne porte plus `durees`', RT, 'durees: T.exporter(),', '', ROUTE],
    ['durees : la chaîne n\'est plus mesurée', RT, "try { await T.mesurer('chaine', () => require('./photos-recues').avecArret(entree.arret && entree.arret.signal, (injecte ? chaineDepuisResultat(injecte) : deps.gererIdentifier)(reqH, fr))); }", "try { await require('./photos-recues').avecArret(entree.arret && entree.arret.signal, (injecte ? chaineDepuisResultat(injecte) : deps.gererIdentifier)(reqH, fr)); }", ROUTE],
    ['durees : seule la lecture est reprise de la chaîne', RT, "for (const k of ['lecture', 'etat', 'catalogue', 'image'])", "for (const k of ['lecture'])", ROUTE],
    ['durees : la chaîne héritée ne reçoit plus son objet de durées', RT, 'dureesChaine: {}          //', 'x: 0          //', ROUTE],
    ['durees : le dépôt de la photo n\'est plus repris', RT, "if (pd) { T.poser('photo', pd.totalMs); T.poser('photoTraitement', pd.traitementMs); }", '', ROUTE],
    ['durees : la durée du dépôt rendue par le magasin est perdue (rattacherPhotos)', RT, 'if (x.durees) dureesDepot.push(x.durees);', '', PURE],
    ['durees : la durée du dépôt est la plus COURTE des photos', RT, '.reduce((a, b) => Math.max(a, b), -1);', '.reduce((a, b) => Math.min(a, b), 1e12);', PURE],
    ['durees : la durée du dépôt devient énumérable (sérialisée avec l\'entrée)', RT, "{ value: { totalMs: maxDe('totalMs'), traitementMs: maxDe('traitementMs') }, enumerable: false, configurable: true }", "{ value: { totalMs: maxDe('totalMs'), traitementMs: maxDe('traitementMs') }, enumerable: true, configurable: true }", PURE],
    ['durees : le magasin ne garde plus la durée', PR, "durees: durees && typeof durees === 'object' ? { totalMs: nb(durees.totalMs), traitementMs: nb(durees.traitementMs) } : null };", 'durees: null };', PURE],
    ['durees : le magasin ne rend plus la durée', PR, 'depotA: p.depotA, durees: p.durees }', 'depotA: p.depotA }', PURE],
    ['durees : le magasin garde une durée fausse (texte, négatif)', PR, "const nb = x => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : null);", 'const nb = x => x;', PURE],
    ['durees : le dépôt ne transmet plus ses durées au magasin', PAS, ', { totalMs: performance.now() - debutDepot, traitementMs: performance.now() - debutTraitement });', ');', PURE],
    ['durees : index.js ne note plus le catalogue', IDX, 'if (req.dureesChaine) req.dureesChaine.catalogue = msCatalogue;', '', PURE],
    ['durees : index.js note le catalogue SANS garde (la v1 planterait)', IDX, 'if (req.dureesChaine) req.dureesChaine.catalogue = msCatalogue;', 'req.dureesChaine.catalogue = msCatalogue;', PURE],
    ['durees : index.js ne note plus la lecture ni l\'état', IDX, 'if (req.dureesChaine) { req.dureesChaine.lecture = msIA; req.dureesChaine.etat = Date.now() - debutAttenteEtat; }', '', PURE],
    ['durees : index.js ne note plus l\'image', IDX, 'if (req.dureesChaine && Number.isFinite(champsImage.imageMs)) req.dureesChaine.image = champsImage.imageMs;', '', PURE],
    // ── le chronomètre lui-même
    ['chrono : un nom d\'étape hors liste est accepté', TEM, "if (typeof n !== 'string' || !ETAPES.includes(n)) throw", 'if (false) throw', PURE],
    ['chrono : une valeur qui n\'est pas un nombre fini >= 0 est acceptée', TEM, "const bon = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;", "const bon = x => typeof x === 'number';", PURE],
    ['chrono : les durées d\'une même étape ne s\'additionnent plus', TEM, 'if (bon(dt)) ms[n] = (ms[n] || 0) + dt;', 'if (bon(dt)) ms[n] = dt;', PURE],
    ['chrono : le CPU n\'est plus compté', TEM, 'if (bon(dc) && n !== \'total\') cpuMs[n] = (cpuMs[n] || 0) + dc;', '', PURE],
    ['chrono : le ramasse-miettes n\'est plus exporté', TEM, 'if (bon(g)) sortie.gc = Math.round(g);', '', PURE],
    ['chrono : la mémoire résidente n\'est plus exportée', TEM, 'if (bon(r)) sortie.rssMo = Math.round(r / 1048576);', '', PURE],
    ['chrono : une durée d\'une fonction qui lève n\'est plus notée', TEM, 'try { return await fonction(); } finally { ajouter(n, horloge() - t0, millisCpu(c0, cpu())); }', 'return await fonction();', PURE],
    ['reglages : voisinsUneFois toujours vrai (les deux sites de la mémoire, drapeau éteint)', TEM, 'voisinsUneFois: t.voisinsUneFois === true,', 'voisinsUneFois: true,', ROUTE],
    ['reglages : empreinteTot toujours vrai', TEM, 'empreinteTot: t.empreinteTot === true,', 'empreinteTot: true,', ROUTE],
    ['reglages : finParallele toujours vrai', TEM, 'finParallele: t.finParallele === true,', 'finParallele: true,', ROUTE],
    ['drapeaux : tout ce qui est « truthy » allume (pas seulement true)', TEM, 'finParallele: t.finParallele === true,', 'finParallele: Boolean(t.finParallele),', PURE],
    ['configuration : voisinsUneFois est allumé par défaut', CFG, "booleen('V2_TE_VOISINS_UNE_FOIS', env.V2_TE_VOISINS_UNE_FOIS, false)", "booleen('V2_TE_VOISINS_UNE_FOIS', env.V2_TE_VOISINS_UNE_FOIS, true)", PURE],
    ['configuration : empreinteTot est allumé par défaut', CFG, "booleen('V2_TE_EMPREINTE_TOT', env.V2_TE_EMPREINTE_TOT, false)", "booleen('V2_TE_EMPREINTE_TOT', env.V2_TE_EMPREINTE_TOT, true)", PURE],
    ['configuration : finParallele est allumé par défaut', CFG, "booleen('V2_TE_FIN_PARALLELE', env.V2_TE_FIN_PARALLELE, false)", "booleen('V2_TE_FIN_PARALLELE', env.V2_TE_FIN_PARALLELE, true)", PURE],
    ['configuration : la valeur « true » est acceptée (booleen strict contourné)', CFG, "empreinteTot: booleen('V2_TE_EMPREINTE_TOT', env.V2_TE_EMPREINTE_TOT, false)", "empreinteTot: env.V2_TE_EMPREINTE_TOT === '1' || env.V2_TE_EMPREINTE_TOT === 'true'", PURE]
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-te-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n'), ancreN = ancre.replace(/\r\n/g, '\n'), neufN = neuf.replace(/\r\n/g, '\n');
            const n = texte.split(ancreN).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`); fs.writeFileSync(copie, texte.replace(ancreN, () => neufN));
            const r = spawnSync(process.execPath, ['-r', path.join(V, BANCS, '_espion-fs-armer.js'), '-r', path.join(__dirname, 'accroche-mutant.js'), path.join(V, BANCS, banc)], {
                cwd: path.join(V, '..'), encoding: 'utf8', timeout: 400000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, RM_MUTANT_CIBLE: cible, RM_MUTANT_SOURCE: copie, ...(fichier === IDX ? { TE_INDEX_SOURCE: copie } : {}), ...(fichier === RT ? { TE_ROUTES_SOURCE: copie } : {}),
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
    const cassees = ancresCassees();
    if (cassees.length) { console.log(`ARRÊT : ${cassees.length} ancre(s) cassée(s) : ${cassees.join(' | ')}`); process.exit(1); }
    const res = rejouer({ seulement: arg[0] ? arg[0].slice(12) : null });
    const compte = v => res.filter(r => r.verdict === v).length;
    console.log(`\n${res.length} mutants : ${compte('TUÉ')} tués, ${compte('ÉQUIVALENT')} équivalent(s) déclaré(s), ${compte('SURVIVANT')} survivant(s), ${compte('ANCRE')} ancre(s) cassée(s)`);
    process.exit(compte('SURVIVANT') + compte('ANCRE') ? 1 : 0);
}
