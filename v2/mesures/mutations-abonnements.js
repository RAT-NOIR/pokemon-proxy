'use strict';
// LE JEU DE MUTATIONS DES GARDES D'ARGENT (STRIPE-V2). Rejouable : `node v2/mesures/mutations-abonnements.js` (tout) ou `... --seulement=<fragment du nom>`.
// Principe : on CASSE une garde à la fois, dans une COPIE du fichier faite dans le dossier temporaire (le dépôt n'est jamais touché : accroche-mutant.js fait compiler la copie à la place du
// fichier), on lance le banc qui la protège, et il DOIT devenir rouge. Un mutant qui reste vert est « survivant » : une garde que rien ne vérifie. Les équivalents (changement sans effet
// observable) sont déclarés avec leur raison. N'est JAMAIS lancé par lancer-tout.js (qui ne lit que v2/test) ; chaque ancre doit exister EXACTEMENT UNE fois (test-abonnements-config.js le vérifie).
// Besoin : la base de banc en mémoire (MONGOMS_DOWNLOAD_DIR vers le cache de mongod, comme pour les bancs).
const fs = require('fs'), os = require('os'), path = require('path'), { spawnSync } = require('child_process');
const V = path.join(__dirname, '..');
const BANCS = 'test';

// [nom, fichier (relatif à v2/), ancre, remplacement, banc, équivalent? (raison)]
const MUTANTS = [
    // — webhook : signature, registre, mode —
    ['signature non vérifiée', 'abonnements/webhook.js', "evt = Cl.obtenir(cfgAbo).webhooks.constructEvent(req.body, sig, cfgAbo.webhookSecret, SIGNATURE_TOLERANCE_S);", "evt = JSON.parse(req.body.toString('utf8'));", 'test-abonnements-webhook.js'],
    ['signature : mauvais secret', 'abonnements/webhook.js', "constructEvent(req.body, sig, cfgAbo.webhookSecret, SIGNATURE_TOLERANCE_S)", "constructEvent(req.body, sig, 'whsec_unautresecret', SIGNATURE_TOLERANCE_S)", 'test-abonnements-webhook.js'],
    ['signature : tolérance de plusieurs jours', 'abonnements/webhook.js', "const SIGNATURE_TOLERANCE_S = 300;", "const SIGNATURE_TOLERANCE_S = 900000;", 'test-abonnements-webhook.js'],
    ['registre : un événement déjà traité est retraité', 'abonnements/webhook.js', "if (FINAUX.has(doc.etat)) return { fait: true };", "", 'test-abonnements-webhook.js'],
    ['mode live accepté sur un service test', 'abonnements/webhook.js', "if ((cfgAbo.mode === 'live') !== (evt.livemode === true))", "if (false)", 'test-abonnements-webhook.js'],
    // — état du compte —
    ['désordre : toujours appliquer', 'abonnements/etat.js', "    if (version > entree.version) return { appliquer: true };\n    if (version === entree.version && (RANG[statut] ?? 0) >= (RANG[entree.statut] ?? 0)) return { appliquer: true };\n    return { appliquer: false, raison: 'desordre' };", "    return { appliquer: true };", 'test-abonnements-webhook.js'],
    ['impayé : la grâce se prolonge', 'abonnements/etat.js', "entree && entree.statut === 'past_due' && entree.jusquAu instanceof Date ? entree.jusquAu : ", "", 'test-abonnements-webhook.js'],
    ['prix inconnu : Pro quand même', 'abonnements/etat.js', "(s.statut === 'trialing' || s.statut === 'active') && s.offre && bornee) {", "(s.statut === 'trialing' || s.statut === 'active') && bornee) {", 'test-abonnements-webhook.js'],
    ['marge de renouvellement : supprimée', 'abonnements/offres.js', "const MARGE_RENOUVELLEMENT_HEURES = 48;", "const MARGE_RENOUVELLEMENT_HEURES = 0;", 'test-abonnements-webhook.js'],
    ['marge de renouvellement : aussi pour une résiliation', 'abonnements/etat.js', "jusquAu: s.resiliation ? bornee : new Date(", "jusquAu: false ? bornee : new Date(", 'test-abonnements-webhook.js'],
    ['grâce d\'impayé : 30 jours', 'abonnements/offres.js', "GRACE_IMPAYE_JOURS = 3;", "GRACE_IMPAYE_JOURS = 30;", 'test-abonnements-webhook.js'],
    ['plusieurs abonnements : le dernier écrase (le Pro tombe avec lui)', 'abonnements/etat.js', "return { actif: vivants.length > 0, jusquAu: principal.jusquAu, principal, double: vivants.length > 1 };", "return { actif: principal.actif === true, jusquAu: principal.jusquAu, principal: liste.sort((a, b) => (b.creeSub ?? 0) - (a.creeSub ?? 0))[0], double: vivants.length > 1 };", 'test-abonnements-webhook.js'],
    ['plusieurs abonnements : le doublon n\'est pas signalé', 'abonnements/etat.js', "if (ag.double) signaux.push('double-abonnement');", "", 'test-abonnements-webhook.js'],
    ['prix Fondateurs sans place : accordé', 'abonnements/etat.js', "&& !(await aUnePlace(compte._id, evtDate))) {", "&& false) {", 'test-abonnements-webhook.js'],
    ['prix Fondateurs sans place : une place est prise quand même', 'abonnements/etat.js', "if (effectif.offre === 'fondateurs' && VIVANTS.includes(s.statut)) await Fo.confirmer(", "if (s.offre === 'fondateurs' && VIVANTS.includes(s.statut)) await Fo.confirmer(", 'test-abonnements-webhook.js'],
    ['checkout.session.completed rejoué : la prime n\'est pas reprise', 'abonnements/webhook.js', " || (res.etat === 'ignore' && res.raison === 'deja-connu')", "", 'test-abonnements-parrainage.js'],
    // — routes : Checkout, portail, essai, places, codes —
    ['CGV non exigées', 'abonnements/routes.js', "consent_collection: { terms_of_service: 'required' },", "", 'test-abonnements-routes.js'],
    ['essai accordé à chaque fois', 'abonnements/routes.js', "if (s && (s.essaiUtilise || s.sid)) return false;", "", 'test-abonnements-routes.js'],
    ['code Fondateurs non vérifié', 'abonnements/routes.js', "if (typeof b.code !== 'string' || !Cfg.codeFondateursValide(b.code, abo().fondateurs.empreinteCode)) return entree(res, 'code-invalide', 422);", "", 'test-abonnements-routes.js'],
    ['places : plus de plafond', 'abonnements/fondateurs.js', "for (let k = 0; k < max; k++) {", "for (let k = 0; k < max + 7; k++) {", 'test-abonnements-routes.js'],
    ['places : la vérification du reste est retirée', 'abonnements/fondateurs.js', "if ((await occupees(maintenant)) >= max) return { ok: false, raison: 'epuisees' };", "", 'test-abonnements-routes.js', 'pré-contrôle d\'optimisation : la boucle d\'insertion refuse déjà au-delà du plafond'],
    ['un seul abonnement : un second Checkout est permis', 'abonnements/routes.js', "if (await dejaAbonne(stripe, compte)) return conflit(res, 'abonnement-actif');", "", 'test-abonnements-routes.js'],
    ['un seul abonnement : les sessions ouvertes ne sont pas expirées', 'abonnements/routes.js', "if (o.id !== session.id) await stripe.checkout.sessions.expire(o.id)", "if (false) await stripe.checkout.sessions.expire(o.id)", 'test-abonnements-routes.js'],
    ['un seul abonnement : la session en cours est elle-même expirée', 'abonnements/routes.js', "if (o.id !== session.id) await", "if (true) await", 'test-abonnements-routes.js'],
    ['portail : toujours la configuration Pro', 'abonnements/routes.js', "configuration = abo().portail[offre];", "configuration = abo().portail.pro;", 'test-abonnements-routes.js'],
    ['portail : repli sur la configuration Pro quand celle des Fondateurs manque', 'abonnements/routes.js', "configuration = abo().portail[offre];", "configuration = abo().portail[offre] || abo().portail.pro;", 'test-abonnements-routes.js'],
    ['clé d\'idempotence du Checkout sans le code de parrainage', 'abonnements/routes.js', "'p' + crypto.createHash('sha256').update(Pa.normaliserCodeParrainage(b.code)).digest('hex').slice(0, 12)", "'p'", 'test-abonnements-routes.js'],
    ['client Stripe : jamais retrouvé, toujours créé', 'abonnements/routes.js', "c = r && Array.isArray(r.data) && r.data[0] && !r.data[0].deleted ? r.data[0] : null;", "c = null;", 'test-abonnements-routes.js'],
    ['montants publics : toujours les constantes', 'abonnements/prix-publics.js', "if (montant(m) && montant(a) && m.recurring.interval === 'month' && a.recurring.interval === 'year') valeur =", "if (false) valeur =", 'test-abonnements-routes.js'],
    ['CORS du site : /api/abonnement retiré', 'transport/cors.js', ", /^\\/api\\/abonnement(\\/.*)?$/]", "]", 'test-abonnements-routes.js'],
    ['suppression de compte : abonnement vivant toléré', 'comptes/service.js', "&& compte.abonnement.stripe.sid && !compte.abonnement.stripe.resiliation &&", "&& false &&", 'test-abonnements-routes.js'],
    ['index des abonnements : jamais exigés', 'modeles.js', "(avecAbonnements === true ? TOUS : INDEX)", "INDEX", 'test-abonnements-routes.js'],
    ['index des abonnements : toujours exigés', 'modeles.js', "(avecAbonnements === true ? TOUS : INDEX)", "TOUS", 'test-abonnements-routes.js'],
    // — parrainage —
    ['parrainage de soi-même permis', 'abonnements/parrainage.js', "if (String(parrain._id) === String(filleul._id)) return false;", "", 'test-abonnements-parrainage.js'],
    ['prime : plusieurs par filleul', 'abonnements/primes.js', "await col('abo_primes').insertOne({ _id: filleul._id, parrainId: parrain._id, etat: 'a-appliquer', creeLe: maintenant, factureId });", "await col('abo_primes').insertOne({ parrainId: parrain._id, filleulId: filleul._id, etat: 'a-appliquer', creeLe: maintenant, factureId });", 'test-abonnements-parrainage.js'],
    ['prime : empilée sur une remise non consommée', 'abonnements/primes.js', "if (remises.length > 0 || sub.discount) return attente(filleulId, 'en-attente-remise');", "", 'test-abonnements-parrainage.js'],
    ['première facture à 0 € déclenche la prime', 'abonnements/webhook.js', "if (montant > 0) {", "if (true) {", 'test-abonnements-parrainage.js'],
    // — outils —
    ['provisionnement : le prix existant au mauvais montant est toléré', 'admin/abonnements/provisionner-lib.js', "if (ecartDe.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['provisionnement : le produit est retrouvé par son nom', 'admin/abonnements/provisionner-lib.js', "p.metadata && p.metadata.rm_cle === cle", "p.name === O.CATALOGUE[offre].nom || (p.metadata && p.metadata.rm_cle === cle)", 'test-abonnements-provisionnement.js'],
    ['provisionnement : l\'endpoint reste si la pose du secret échoue', 'admin/abonnements/provisionner-lib.js', "try { if (typeof stripe.webhookEndpoints.del === 'function') await stripe.webhookEndpoints.del(e.id);", "try { if (false) await stripe.webhookEndpoints.del(e.id);", 'test-abonnements-provisionnement.js'],
    ['portails : un seul produit par configuration → les deux produits', 'admin/abonnements/provisionner-lib.js', "products: [{ product: rapport.ids.produits[offre], prices: O.PERIODES.map(p => prix(O.lookupKey(offre, p))) }] }", "products: O.OFFRES.map(o => ({ product: rapport.ids.produits[o], prices: O.PERIODES.map(p => prix(O.lookupKey(o, p))) })) }", 'test-abonnements-provisionnement.js'],
    ['portails : l\'ancienne configuration à deux produits garde son changement de plan', 'admin/abonnements/provisionner-lib.js', "await stripe.billingPortal.configurations.update(ancienne.id, { features: { subscription_update: { enabled: false } } });", "", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : le diff trop large n\'arrête pas', 'admin/abonnements/poser-sur-render.js', "if (autres.length || d.retires.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : variable quelconque permise', 'admin/abonnements/poser-sur-render.js', "if (!VARIABLES_PERMISES.includes(nom)) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : pas de relecture', 'admin/abonnements/poser-sur-render.js', "if (ecarts.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['poserSurRender : le nombre de variables n\'est pas comparé', 'admin/abonnements/poser-sur-render.js', "if (!Array.isArray(verif) || verif.length !== avant.length) throw", "if (false) throw", 'test-abonnements-provisionnement.js'],
    ['parcours : un état jamais atteint passe pour réussi', 'admin/abonnements/parcours-lib.js', "throw new AttentePerdue(", "return dernier; throw new AttentePerdue(", 'test-abonnements-parcours.js'],
    // — configuration —
    ['configuration : la clé s\'énumère', 'abonnements/config.js', "for (const k of ['cle', 'webhookSecret']) Object.defineProperty(base, k, { value: base[k], enumerable: false,", "for (const k of ['cle', 'webhookSecret']) Object.defineProperty(base, k, { value: base[k], enumerable: true,", 'test-abonnements-config.js'],
    ['configuration : les deux portails peuvent être le même', 'abonnements/config.js', "if (base.portail.pro && base.portail.pro === base.portail.fondateurs) {", "if (false) {", 'test-abonnements-config.js']
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
