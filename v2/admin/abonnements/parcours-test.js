'use strict';
// LE PARCOURS TEST — MODE TEST SEULEMENT, hors banc. Il joue contre l'ESSAI déployé (le coordinateur déploie d'abord) avec la clé Test de Stripe et des horloges d'essai.
// Rien ne se lance sans --lancer : sans lui, le script décrit seulement ce qu'il ferait.
//   node v2/admin/abonnements/parcours-test.js                                  décrit le parcours et les comptes qu'il attend (aucune requête)
//   node v2/admin/abonnements/parcours-test.js --lancer [--places=2] [--seulement=a,b] [--essai=https://…]
// Il lit dans le .env d'api-v2 (par garde-secrets, qui masque toute valeur du .env à la sortie) :
//   STRIPE_TEST_SECRET_KEY    la clé Test (refusée si ce n'est pas une clé sk_test_)
//   V2_FONDATEURS_CODE        le code Fondateurs posé sur l'essai
//   V2_PARCOURS_COMPTES       un JSON : [{ "role": "essai", "id": "<id du compte>", "email": "…", "motDePasse": "…" }, …] — NEUF comptes VÉRIFIÉS et NEUFS de l'essai, un par rôle :
//                             route · essai · echec · resiliation · parrain · filleul · fond1 · fond2 · fond3
// L'identifiant d'un compte est celui de la base de l'essai (comptes._id) ; aucun mot de passe n'est affiché ni écrit. Les provisions (prix) viennent de provision-test.json.
// Pour le scénario d'épuisement des places : poser V2_FONDATEURS_PLACES=2 sur l'essai, redéployer, puis --places=2. Jamais un vrai paiement : cartes de test seulement.
const fs = require('fs'), path = require('path');
const RACINE_TRAVAIL = 'C:\\Users\\Yung\\rat-market-travail\\api';
const ROLES = Object.freeze(['route', 'essai', 'echec', 'resiliation', 'parrain', 'filleul', 'fond1', 'fond2', 'fond3']);
const SCENARIOS = Object.freeze(['essaiPuisPaiement', 'paiementEchoue', 'resiliation', 'parrainage', 'fondateurs', 'routeCheckoutEtPortail']);
const AUTORISES = /^--(lancer|places=2|seulement=[A-Za-z,]+|essai=https:\/\/[A-Za-z0-9.-]+)$/;

/** Les arguments, écrits par ce qu'ils AUTORISENT. */
function analyserArguments(argv) {
    const refus = argv.filter(a => !AUTORISES.test(a));
    if (refus.length) throw new Error(`argument(s) non admis (${refus.length}). Admis : --lancer, --places=2, --seulement=<scénarios>, --essai=https://…`);
    const v = nom => { const a = argv.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
    const seulement = v('seulement') ? v('seulement').split(',') : null;
    if (seulement && seulement.some(s => !SCENARIOS.includes(s))) throw new Error(`scénario inconnu (admis : ${SCENARIOS.join(', ')})`);
    return { lancer: argv.includes('--lancer'), places: v('places') ? Number(v('places')) : null, seulement, essai: v('essai') || 'https://rat-market-api-essai.onrender.com' };
}
/** Une ouverture de session par compte : le cookie rm_session, jamais affiché. */
async function connecter(essai, c) {
    const r = await fetch(`${essai}/api/compte/connexion`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://rat-market.fr', 'x-rat-market': '1' }, body: JSON.stringify({ email: c.email, motDePasse: c.motDePasse }), signal: AbortSignal.timeout(90000) });
    if (r.status !== 200) throw new Error(`connexion du compte « ${c.role} » refusée (HTTP ${r.status})`);
    const m = (r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || '']).join(';').match(/rm_session=([A-Za-z0-9_-]+)/);
    if (!m) throw new Error(`connexion du compte « ${c.role} » : pas de cookie de session`);
    return `rm_session=${m[1]}`;
}
module.exports = { analyserArguments, connecter, ROLES, SCENARIOS };

if (require.main === module) (async () => {
    let a; try { a = analyserArguments(process.argv.slice(2)); } catch (e) { console.error(`ARRÊT : ${e.message}`); process.exit(1); }
    if (!a.lancer) {
        console.log('Parcours Test des abonnements — DESCRIPTION (aucune requête). Pour jouer : --lancer');
        console.log(`  essai visé : ${a.essai}`);
        console.log(`  comptes attendus (V2_PARCOURS_COMPTES) : ${ROLES.join(', ')}`);
        console.log(`  scénarios : ${SCENARIOS.join(', ')}`);
        return;
    }
    const { ENV } = require(path.join(RACINE_TRAVAIL, 'atlas', 'garde-secrets'));
    const cle = ENV.STRIPE_TEST_SECRET_KEY;
    if (!cle || !/^sk_test_[A-Za-z0-9]+$/.test(cle)) { console.error('ARRÊT : STRIPE_TEST_SECRET_KEY absente ou pas une clé de test'); process.exit(1); }
    let liste; try { liste = JSON.parse(ENV.V2_PARCOURS_COMPTES || ''); } catch { console.error('ARRÊT : V2_PARCOURS_COMPTES absent ou illisible (JSON attendu)'); process.exit(1); }
    const manque = ROLES.filter(r => !Array.isArray(liste) || !liste.some(c => c && c.role === r && /^[0-9a-f]{24}$/.test(c.id) && c.email && c.motDePasse));
    if (manque.length) { console.error(`ARRÊT : comptes manquants ou mal formés dans V2_PARCOURS_COMPTES : ${manque.join(', ')}`); process.exit(1); }
    const prix = JSON.parse(fs.readFileSync(path.join(RACINE_TRAVAIL, 'stripe', 'provision-test.json'), 'utf8'));
    const ids = { proMois: prix.prix.rm_v2_pro_mois, proAn: prix.prix.rm_v2_pro_an, fondMois: prix.prix.rm_v2_fondateurs_mois, fondAn: prix.prix.rm_v2_fondateurs_an };
    const stripe = require('../../abonnements/sdk').creerClient(cle);
    const comptes = Object.fromEntries(liste.filter(c => ROLES.includes(c.role)).map(c => [c.role, { id: c.id }]));
    const cookies = {};
    for (const c of liste.filter(c => ROLES.includes(c.role))) cookies[c.role] = await connecter(a.essai, c);
    const api = async (role, methode, chemin, corps) => {
        const r = await fetch(a.essai + chemin, { method: methode, headers: { cookie: cookies[role], ...(corps !== undefined ? { 'content-type': 'application/json', origin: 'https://rat-market.fr', 'x-rat-market': '1' } : {}) }, body: corps !== undefined ? JSON.stringify(corps) : undefined, signal: AbortSignal.timeout(90000) });
        let json = null; try { json = await r.json(); } catch { /* corps non JSON */ }
        return { statut: r.status, json };
    };
    const { fabrique } = require('./parcours-lib');
    const p = fabrique({ stripe, api, comptes, prix: ids, attendre: ms => new Promise(r => setTimeout(r, ms)), trace: m => console.log(m), places: a.places, codeFondateurs: ENV.V2_FONDATEURS_CODE || null });
    let res = []; try { res = await p.jouer({ seulement: a.seulement }); } finally { await p.nettoyer(); }
    const ko = res.filter(r => !r.ok);
    console.log(`\nBilan : ${res.length - ko.length} OK, ${ko.length} échec(s)`);
    for (const r of ko) console.log(`  ÉCHEC  ${r.nom}${r.detail ? ` — ${r.detail}` : ''}`);
    process.exit(ko.length ? 1 : 0);
})().catch(e => { console.error(`ERREUR : ${String(e && e.message || e).slice(0, 300)}`); process.exit(1); });
