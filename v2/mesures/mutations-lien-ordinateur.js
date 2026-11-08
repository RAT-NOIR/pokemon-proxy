'use strict';
// LE JEU DE MUTATIONS DE LA ROUTE LIEN-ORDINATEUR. Rejouable : `node v2/mesures/mutations-lien-ordinateur.js` (tout) ou `... --seulement=<fragment du nom>`.
// Même principe que mutations-abonnements.js (dont il reprend l'accroche, accroche-mutant.js) : on CASSE une garde à la fois dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché),
// on lance le banc qui la protège, et il DOIT devenir rouge. Un mutant qui reste vert est « survivant » : une garde que rien ne vérifie. N'est JAMAIS lancé par lancer-tout.js ; chaque ancre doit exister EXACTEMENT UNE FOIS
// (test-lien-ordinateur-mutants.js le vérifie, dans le verrou).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANC = 'test-lien-ordinateur.js';
const R = 'lien-ordinateur/routes.js', S = 'lien-ordinateur/service.js';

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    // — les gardes de la route, dans leur ordre —
    ['sans Turnstile', R, "piloteReel, defi, async (req, res) => {", "piloteReel, async (req, res) => {", BANC],
    ['Turnstile : l\'action d\'une autre route', R, "{ action: 'lien-ordinateur' }", "{ action: 'oubli' }", BANC],
    ['Turnstile : la dispense des outils de mesure s\'applique', R, "exigerDefi({ ...cfg, mesure: null }", "exigerDefi({ ...cfg }", BANC],
    ['sans contrôle d\'origine', R, "S.exigerOrigineSite(cfg), parIp", "parIp", BANC],
    ['sans limite par IP', R, "parIp, corpsLisible,", "corpsLisible,", BANC],
    ['la limite par IP porte sur l\'adresse brute (un IPv6 change d\'adresse à chaque requête)', R, "L.empreinteIp(ipKeyGenerator(String(q.ip || '?')))", "L.empreinteIp(q.ip)", BANC],
    ['la limite par IP passe APRÈS le défi', R, "parIp, corpsLisible, piloteReel, defi, async", "corpsLisible, piloteReel, defi, parIp, async", BANC],
    ['sans no-store', R, "router.post('/api/lien-ordinateur', sansStocker, ", "router.post('/api/lien-ordinateur', ", BANC],
    ['corps non lisible accepté', R, "parIp, corpsLisible, piloteReel", "parIp, piloteReel", BANC],
    ['un pilote qui n\'envoie pas répond 202', R, "corpsLisible, piloteReel, defi", "corpsLisible, defi", BANC],
    ['une adresse déjà servie répond 429', R, "if (r.issue === 'plafond')", "if (r.issue !== 'envoye')", BANC],
    ['une adresse qui n\'est pas du texte est acceptée', R, "if (typeof adresse !== 'string') return repondreErreur(res, 'ENTREE'", "if (false) return repondreErreur(res, 'ENTREE'", BANC],
    // — l'adresse : lecture, marque, empreinte —
    ['adresse jetable servie', S, "estJetable(cle.split('@')[1]) || ", "", BANC],
    ['adresse invalide servie', S, "|| !adresseValide(destinataire)", "", BANC],
    ['aucune marque : une adresse reçoit autant de courriels que de demandes', S, "if (!r.permis) return { issue: 'deja' };", "", BANC],
    ['marque NON atomique (lire, attendre, écrire)', S, "const r = await L.reserver(cleMarque, { delaiMs: JOUR_MS, maintenant: maintenant() });",
        "const r = await (async () => { const k = cleMarque + '|reservation'; if (await col('limites').findOne({ cle: k })) return { permis: false }; await new Promise(f => setTimeout(f, 20)); await col('limites').updateOne({ cle: k }, { $set: { expireLe: new Date(Date.now() + JOUR_MS) }, $inc: { n: 1 } }, { upsert: true }); return { permis: true }; })();", BANC],
    ['l\'empreinte est un SHA-256 simple (sans secret)', S, "crypto.createHmac('sha256', secret).update(", "crypto.createHash('sha256').update(", BANC],
    ['l\'empreinte n\'a pas de domaine', S, ".update(`lien-ordinateur|${boite}`)", ".update(`${boite}`)", BANC],
    ['la limite porte sur l\'adresse, pas sur la boîte (+étiquette, points de Gmail)', S, "empreinteBoite(secret, cleBoite(cle))", "empreinteBoite(secret, cle)", BANC],
    ['la marque dure 48 h', S, "const JOUR_MS = 24 * 3600e3;", "const JOUR_MS = 48 * 3600e3;", BANC],
    ['l\'adresse est écrite en clair dans la marque', S, "`${PREFIXE}${empreinteBoite(secret, cleBoite(cle))}`", "`${PREFIXE}${cle}`", BANC],
    // — le plafond du jour et les pannes —
    ['plafond du jour ignoré', S, "if (!place) { await rendre(); return { issue: 'plafond' }; }", "", BANC],
    ['plafond atteint : la marque n\'est pas rendue', S, "if (!place) { await rendre(); return", "if (!place) { return", BANC],
    ['plafond du pilote : traité comme une panne', S, "if (nom === 'BrevoPlafond') { await rendre(); return { issue: 'plafond' }; }", "", BANC],
    ['adresse refusée par Brevo (400) : traitée comme une panne', S, "if (nom === 'BrevoAdresse' || nom === 'BrevoStatut400') { await rendre(); return { issue: 'ignoree' }; }", "", BANC],
    ['Brevo répond non : la marque est gardée', S, "if (/^BrevoStatut\\d{3}$/.test(nom)) { await rendre(); throw e; }", "if (/^BrevoStatut\\d{3}$/.test(nom)) { throw e; }", BANC],
    ['réseau (peut-être parti) : la marque est rendue (doublon possible)', S, "/^BrevoStatut\\d{3}$/.test(nom)", "/^Brevo/.test(nom)", BANC],
    // — le message et le pilote —
    ['le message n\'est pas gardé (une instance par appel)', 'comptes/gabarits-courriel.js', "if (messageLien) return messageLien;", "", BANC],
    ['le courriel part en classe « sécurité » (mange la réserve de la vérification)', 'comptes/courrier-brevo.js', "poster('avertissement', email, await G.lienOrdinateur())", "poster('securite', email, await G.lienOrdinateur())", BANC],
    // — CORS, drapeau, montage —
    ['CORS : le chemin n\'est pas dans le profil du site', 'transport/cors.js', "liste.find(x => x.nom === 'site').chemins.push(LIEN_ORDINATEUR_CHEMIN);", "", BANC],
    ['CORS : le préflight annonce toutes les méthodes du site', 'transport/cors.js', "lien ? 'POST' : galerie ?", "galerie ?", BANC],
    ['drapeau : la route est montée même éteinte', 'lien-ordinateur/monter.js', "cfg.lienOrdinateur.actif !== true", "false", BANC],
    ['drapeau : toute valeur non vide l\'allume', 'config.js', "actif: env.V2_LIEN_ORDINATEUR === '1',", "actif: Boolean(env.V2_LIEN_ORDINATEUR),", BANC],
    ['le lot n\'est pas dans la liste des lots du socle', 'index.js', ", require('./lien-ordinateur/monter')]", "]", BANC]
];

function rejouer({ seulement = null, journal = console.log } = {}) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-mutants-lien-'));
    const resultats = [];
    try {
        MUTANTS.forEach(([nom, fichier, ancre, neuf, banc, equivalent], i) => {
            if (seulement && !nom.includes(seulement)) return;
            const cible = path.join(V, fichier), texte = fs.readFileSync(cible, 'utf8').replace(/\r\n/g, '\n');
            const n = texte.split(ancre).length - 1;
            if (n !== 1) { resultats.push({ nom, verdict: 'ANCRE', detail: `${n} occurrence(s)` }); journal(`?? ANCRE (${n} occurrence(s))  ${nom}`); return; }
            const copie = path.join(tmp, `m${i}.js`); fs.writeFileSync(copie, texte.replace(ancre, () => neuf));
            const r = spawnSync(process.execPath, ['-r', path.join(V, 'test', '_espion-fs-armer.js'), '-r', path.join(__dirname, 'accroche-mutant.js'), path.join(V, 'test', banc)], {
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
    const res = rejouer({ seulement: arg[0] ? arg[0].slice(12) : null });
    const compte = v => res.filter(r => r.verdict === v).length;
    console.log(`\n${res.length} mutants : ${compte('TUÉ')} tués, ${compte('ÉQUIVALENT')} équivalent(s) déclaré(s), ${compte('SURVIVANT')} survivant(s), ${compte('ANCRE')} ancre(s) cassée(s)`);
    process.exit(compte('SURVIVANT') + compte('ANCRE') ? 1 : 0);
}
