'use strict';
// LE JEU DE MUTATIONS DU COMPTE DE TEST (01/11) : l'exemption d'installations du compte ordinaire (installations/exemption-banc.js), l'outil qui le crée (admin/compte-essai.js --banc --ordinaire) et le client de série
// (mesures/serie-essai.js --compte=ordinaire, mesures/serie-compte-test.js). Rejouable : `node v2/mesures/mutations-compte-test.js` (tout) ou `... --seulement=<fragment du nom>`.
// Même principe que mutations-repli-quota.js (qui réutilise accroche-mutant.js) : on CASSE une garde à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché),
// on lance le banc qui la protège, et il DOIT devenir rouge. Un mutant qui reste vert est « survivant ». Jamais lancé par lancer-tout.js. Besoin : MONGOMS_DOWNLOAD_DIR vers le cache de mongod, comme pour les bancs.
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';
const EX = 'installations/exemption-banc.js', RT = 'installations/routes.js', CE = 'admin/compte-essai.js', SE = 'mesures/serie-essai.js', SC = 'mesures/serie-compte-test.js';
const AP = 'banc/acces-photo-banc.js', MO = 'identifier/monter.js', PA = 'identifier/photo-avant-scan.js', B_PH = 'test-photo-comptes-banc.js';
const B_EX = 'test-installation-banc-ordinaire.js', B_CE = 'test-compte-ordinaire.js', B_SE = 'test-serie-compte-test.js';

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    // ── l'exemption : écrite par ce qu'elle AUTORISE, chaque condition de la liste fermée ──
    ['EX : la marque banc n\'est plus exigée', EX, 'Boolean(c) && c.banc === true && c.bancOrdinaire === true', 'Boolean(c) && c.bancOrdinaire === true', B_EX],
    ['EX : la marque bancOrdinaire n\'est plus exigée (la bonne adresse suffit)', EX, 'c.banc === true && c.bancOrdinaire === true && c.verifie === true', 'c.banc === true && c.verifie === true', B_EX],
    ['EX : la marque bancOrdinaire se lit sans être stricte (truthy)', EX, 'c.bancOrdinaire === true && c.verifie', 'Boolean(c.bancOrdinaire) && c.verifie', B_EX],
    ['EX : le compte n\'a plus à être confirmé', EX, 'c.bancOrdinaire === true && c.verifie === true &&', 'c.bancOrdinaire === true &&', B_EX],
    ['EX : un compte à rôle est admis', EX, '(c.role === undefined || c.role === null) && ', '', B_EX],
    ['EX : l\'adresse réservée n\'est plus exigée (les marques suffisent)', EX, ' && typeof c.emailCle === \'string\' && c.emailCle === emailCle(ADRESSE_ORDINAIRE)', '', B_EX],
    ['EX : l\'adresse suffit (plus de marque)', EX, 'return Boolean(c) && c.banc === true && c.bancOrdinaire === true && c.verifie === true && (c.role === undefined || c.role === null) && typeof c.emailCle === \'string\' && c.emailCle === emailCle(ADRESSE_ORDINAIRE);', 'return Boolean(c) && typeof c.emailCle === \'string\' && c.emailCle === emailCle(ADRESSE_ORDINAIRE);', B_EX],
    ['EX : la base de l\'essai n\'est plus exigée (inopérante en production perdue)', EX, 'estCompteDeTestOrdinaire(c) && baseDeLEssai(nomBase())', 'estCompteDeTestOrdinaire(c)', B_EX],
    ['EX : la base de PRODUCTION passe pour l\'essai', EX, "return nom === 'rm_essai' ||", 'return true ||', B_EX],
    ['EX : test_scratch passe sans BANC_ISOLE', EX, "(nom === 'test_scratch' && env && env.BANC_ISOLE === '1')", "(nom === 'test_scratch')", B_EX],
    ['EX : la base lue est celle de la configuration injectée, jamais celle que la route reçoit', RT, 'exemption.exemptionBanc(cfg, deps)', 'exemption.exemptionBanc(cfg)', B_EX],
    ['EX : le drapeau V2_INSTALLATION_BANC_EXEMPTE n\'est plus consulté', EX, 'if (cfg.installationBancExempte !== true) return null;', '', B_EX],
    ['EX : l\'en-tête X-Rat-Market n\'est plus exigé', EX, "req.get('x-rat-market') === '1'", 'true', B_EX],
    ['EX : un Bearer en plus est admis', EX, 'if (req.headers.authorization !== undefined) return null;', '', B_EX, 'double garde : une requête à Bearer résout un porteur d\'installation (jamais un compte de session), que `p.type !== \'compte\'` écarte ; la ligne est une défense en profondeur héritée du compte de mesure'],
    ['EX : le compte exempté change de plafond (la clé de comptage devient l\'IP)', RT, 'cle: q => exempte.get(q) || null', 'cle: q => null', B_EX],
    // ── l'outil de création ──
    ['CE : le compte de test perd sa marque bancOrdinaire à la création', CE, 'if (ord) doc.bancOrdinaire = true;', '', B_CE],
    ['CE : le compte de test reçoit le rôle administrateur', CE, '            if (!ord) {\n                const r = await roleAdmin.poserRole', '            if (true) {\n                const r = await roleAdmin.poserRole', B_CE],
    ['CE : la vérification « ajout seul » est coupée', CE, 'if (!verifierAjoutSeul(avant, apres, [nomId, nomMdp])) {', 'if (false) {', B_CE],
    ['CE : la vérification « ajout seul » accepte tout', CE, 'function verifierAjoutSeul(avant, apres, noms) {\n    try {', 'function verifierAjoutSeul(avant, apres, noms) {\n    try { return true;', B_CE],
    ['CE : le compte ordinaire écrit les variables du compte de MESURE', CE, "nomId = ord ? NOM_ORDINAIRE_IDENTIFIANT : NOM_IDENTIFIANT, nomMdp = ord ? NOM_ORDINAIRE_MOT_DE_PASSE : NOM_MOT_DE_PASSE", 'nomId = NOM_IDENTIFIANT, nomMdp = NOM_MOT_DE_PASSE', B_CE],
    ['CE : --reprendre accepte un compte qui porte un rôle', CE, "if (existant && ord && existant.role !== undefined && existant.role !== null) return refuser(", 'if (false) return refuser(', B_CE],
    ['CE : --reprendre accepte un compte sans la marque bancOrdinaire', CE, "if (existant && ord && existant.bancOrdinaire !== true) return refuser(", 'if (false) return refuser(', B_CE],
    ['CE : --ordinaire sans --banc est admis', CE, "if (ordinaire && !banc) return { ok: false", 'if (false) return { ok: false', B_CE],
    ['CE : la restauration du .env est supprimée quand l\'ajout seul échoue', CE, "if (typeof avant === 'string') { require('fs').writeFileSync(fichierEnv, avant, { encoding: 'utf8', mode: 0o600 }); restaure = true; }", 'restaure = true;', B_CE],
    ['CE : le mot de passe est affiché', CE, "ecrire(`${ord ? 'Compte de test ordinaire'", "ecrire(`${mdp} ${ord ? 'Compte de test ordinaire'", B_CE],
    // ── le client ──
    ['SE : le refus de dépôt de photo du compte ordinaire n\'arrête plus', SE, "if (ct && (up.statut !== 200 || !up.corps || typeof up.corps.photoId !== 'string')) throw new Arret(", "if (false) throw new Arret(", B_SE],
    ['SE : le client annonce la version minimale du ping au lieu de 2.0.1 (pas de probable)', SE, 'versionExtension: gp || ct ? versionClient : versionMin', 'versionExtension: gp ? versionClient : versionMin', B_SE],
    ['SE : le départ n\'est plus jugé (quota entamé accepté)', SE, 'if (invalide) throw new Arret(', 'if (false) throw new Arret(', B_SE],
    ['SE : un écart n\'arrête plus la série', SE, "arret = `ÉCART AU TABLEAU, ligne ${rang} (${l.cle}) : ${suiteCT.ecart.champ}, attendu ${suiteCT.ecart.attendu}, observé ${suiteCT.ecart.observe} (scan ${e.scanId}) : série arrêtée avant le scan suivant, sans adapter la suite`; break; }", "arret = null; }", B_SE],
    ['SE : la première réponse non conforme n\'empêche plus la déclaration', SE, '        else if (!e) {\n            const iss', '        else if (true) {\n            const iss', B_SE],
    ['SE : le client lit le couple du compte de MESURE', SE, "ct ? { identifiant: NOM_ORDINAIRE_IDENTIFIANT, motDePasse: NOM_ORDINAIRE_MOT_DE_PASSE } : undefined", 'undefined', B_SE],
    ['SE : un compte administrateur lié est accepté', SE, "lie.corps.compte.administrateur === false && lie.corps.compte.verifie === true", 'true', B_SE],
    ['SE : --g-probable se combine avec --compte (un second envoi de mesures devient possible)', SE, "if (o.gProbable === true) throw new Arret('--compte=ordinaire ne se combine pas avec --g-probable", "if (false) throw new Arret('--compte=ordinaire ne se combine pas avec --g-probable", B_SE],
    ['SE : le client n\'annonce plus capacitesClient (il ne recevrait aucun complément)', SE, "...(gp || ct ? { capacitesClient: ['mesures-1'] } : {})", "...(gp ? { capacitesClient: ['mesures-1'] } : {})", B_SE],
    ['SE : le second envoi n\'a jamais lieu', SE, "if (!(classe1.niveau === 'question' && scanId && cplt && typeof cplt === 'object'", "if (true || !(classe1.niveau === 'question' && scanId && cplt && typeof cplt === 'object'", B_SE],
    ['SE : le second envoi n\'annonce plus accepteProbable', SE, 'accepteProbable: true, resultats: prod.resultats', 'accepteProbable: false, resultats: prod.resultats', B_SE],
    ['SE : la facturation du second envoi n\'est plus relevée', SE, 'r.facturation2 = m.corps.facturation ?? null;', 'r.facturation2 = null;', B_SE],
    ['SE : la série ne passe plus la carte redressée au second envoi', SE, 'etiquette: etiquetteCle, carteB64, issue, att:', 'etiquette: etiquetteCle, issue, att:', B_SE],
    ['TB : la facturation du second envoi n\'est plus comparée', SC, "if (i.second) { const f2 = comparerFacturation('second.facturation'", "if (false) { const f2 = comparerFacturation('second.facturation'", B_SE],
    ['SE : le solde après n\'est plus relu (le quota restant reste celui d\'avant)', SE, 'await lireApres();\n            if (apres)', 'if (apres)', B_SE],
    ['SE : la lettre attendue n\'est plus vérifiée avant l\'envoi', SE, '&& (!iss.lettre || choix === iss.lettre)) {', ') {', B_SE],
    ['SE : le code de sortie d\'un écart redevient 1', SC, 'if (r.ecart) return CODE_ECART;', 'if (r.ecart) return 1;', B_SE],
    ['SE : le code de sortie d\'un dépôt refusé redevient 1', SC, "startsWith('PHOTO REFUSÉE')) return CODE_PHOTO_REFUSEE;", "startsWith('PHOTO REFUSÉE')) return 1;", B_SE],
    // ── corrections de la relecture 1 ──
    ['RL : la couture nomBase est admise hors banc (sans BANC_ISOLE=1)', EX, "deps && typeof deps.nomBase === 'function' && env && env.BANC_ISOLE === '1' ? deps.nomBase : nomBaseReelle", "deps && typeof deps.nomBase === 'function' ? deps.nomBase : nomBaseReelle", B_EX],
    ['RL : une ligne non jugée est sautée (continue) en mode compte', SE, '                if (ct) {                                                                              // COMPTE-TEST : une ligne NON JUGÉE', '                if (false) {                                                                              // COMPTE-TEST : une ligne NON JUGÉE', B_SE],
    ['RL : 8 lignes jugées sur 9 rendent 0', SC, "if (r.compteTest && !(Array.isArray(r.resultats) && r.resultats.length === TABLEAU.length)) return CODE_LIGNE_NON_JUGEE;", '', B_SE],
    ['RL : une erreur au bilan n\'empêche plus le 0', SC, "if (r.ligneNonJugee || (Array.isArray(r.erreurs) && r.erreurs.length > 0)) return CODE_LIGNE_NON_JUGEE;", '', B_SE],
    ['RL : --n est ignoré en silence avec --compte=ordinaire', SE, "if (o.n !== undefined && o.n !== null && !Number.isNaN(o.n)) throw new Arret(", 'if (false) throw new Arret(', B_SE],
    ['RL : --graine est ignorée en silence avec --compte=ordinaire', SE, "if (o.graine !== undefined && o.graine !== null && !Number.isNaN(o.graine)) throw new Arret(", 'if (false) throw new Arret(', B_SE],
    // ── POST /api/photo (commit 4) ──
    ['PH : le drapeau V2_PHOTO_COMPTES_BANC n\'est plus consulté', AP, 'if (cfg && cfg.photoComptesBanc === true) {', 'if (true) {', B_PH],
    ['PH : la liste fermée n\'est plus exigée (la base de l\'essai suffit)', AP, 'EX.estCompteDeTestOrdinaire(c) && EX.baseDeLEssai(nomBase())', 'EX.baseDeLEssai(nomBase())', B_PH],
    ['PH : la base de l\'essai n\'est plus exigée', AP, 'EX.estCompteDeTestOrdinaire(c) && EX.baseDeLEssai(nomBase())', 'EX.estCompteDeTestOrdinaire(c)', B_PH],
    ['PH : un refus ne retombe plus sur la garde d\'origine (tout passe)', AP, 'return exigerAdministrateurPhoto(req, res, next);\n    };', 'return next();\n    };', B_PH],
    ['PH : la route n\'est plus gardée du tout', MO, 'exigerInstallation, exigerPhotoAdminOuBanc(cfg, deps), parPorteurPhoto', 'exigerInstallation, (q, s, n) => n(), parPorteurPhoto', B_PH],
    ['PH : la porte n\'est plus branchée (la garde d\'origine seule)', MO, 'exigerInstallation, exigerPhotoAdminOuBanc(cfg, deps), parPorteurPhoto', 'exigerInstallation, require(\'../banc/photo\').exigerAdministrateurPhoto, parPorteurPhoto', B_PH],
    ['PH : un porteur qui n\'est pas un compte entre dans la porte', AP, "if (p && p.type === 'compte' && p.administrateur !== true) {", 'if (p) {', B_PH, 'la lecture en base du compte inexistant rend null, que estCompteDeTestOrdinaire refuse : double garde'],
    ['PH : le dépôt du compte de banc n\'est plus journalisé', PA, 'if (req.v2 && req.v2.compteBancPhoto) console.log(', 'if (false) console.log(', B_PH],
    ['PH : le journal écrit le jeton', PA, '`📷 [v2 photo-banc] compte=${req.v2.compteBancPhoto}', '`📷 [v2 photo-banc] ${req.headers.authorization} compte=${req.v2.compteBancPhoto}', B_PH],
    ['PH : le journal ne porte plus le sha256', PA, ' sha256=${require(\'crypto\').createHash(\'sha256\').update(octets).digest(\'hex\')}`', '`', B_PH],
    // ── le tableau et le juge ──
    ['TB : le quota après la ligne 6 attendu change', SC, "{ rang: 6, cle: '6ad3e9db', verite: 289788, restantApres: 6,", "{ rang: 6, cle: '6ad3e9db', verite: 289788, restantApres: 5,", B_SE],
    ['TB : le plafond du jour attendu à la ligne 8 change', SC, "const PLAFOND_PROBABLE_AUCUNE = 3;", "const PLAFOND_PROBABLE_AUCUNE = 4;", B_SE],
    ['TB : le champ « rembourse » n\'est plus comparé', SC, "['debite', 'reserve', 'rembourse', 'motif', 'raisonNonRembourse']", "['debite', 'reserve', 'motif', 'raisonNonRembourse']", B_SE],
    ['TB : le champ « raisonNonRembourse » n\'est plus comparé', SC, "['debite', 'reserve', 'rembourse', 'motif', 'raisonNonRembourse']", "['debite', 'reserve', 'rembourse', 'motif']", B_SE],
    ['TB : un probable FAUX n\'est plus un écart', SC, "if ((i.final === 'sur' || i.final === 'probable') && obs.produit !== att.verite)", "if ((i.final === 'sur') && obs.produit !== att.verite)", B_SE],
    ['TB : le quota restant n\'est plus comparé', SC, 'if (obs.restantApres !== att.restantApres) return', 'if (false) return', B_SE],
    ['TB : le statut de la réponse n\'est plus comparé', SC, 'if (obs.statutReponse !== 200) return', 'if (false) return', B_SE],
    ['TB : la déclaration redite par le serveur n\'est plus comparée', SC, "for (const k of ['rendue', 'raison', 'plafondJour']) if (d[k] !== i.declarationReponse[k])", "for (const k of []) if (d[k] !== i.declarationReponse[k])", B_SE],
    ['TB : le départ ne refuse plus un quota entamé', SC, 'if (o.restant !== QUOTA_GRATUIT) return', 'if (false) return', B_SE]
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-ct-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n'), ancreN = ancre.replace(/\r\n/g, '\n'), neufN = neuf.replace(/\r\n/g, '\n');
            const n = texte.split(ancreN).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`); fs.writeFileSync(copie, texte.replace(ancreN, () => neufN));
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
