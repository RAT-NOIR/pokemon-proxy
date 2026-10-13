'use strict';
// B2b point 5 (M-3 de la passe 2 de B1) — CONFIGURATION v2 INVALIDE : ce que fait le code HÉRITÉ d'une requête de la v2 sur les 4 chemins qui ne sont PAS dans CHEMINS_FERMES_503
// (POST /api/identifier, /api/identifier/reponse, /api/solde, /api/retour-live). Le banc monte le VRAI serveur (index.js, base en mémoire, faux réseau, OPENROUTER_API_KEY vide) avec RM_API_V2=1 et
// V2_ACCUEIL invalide, et observe. Trois formes de requête, du contrat vers le pire :
//   A. une requête de la v2 telle que le contrat la décrit : Bearer, corps v2, ni x-jeton ni userId ;
//   B. la même avec le x-jeton public de la 1.0.x ajouté (un client qui mélange) ;
//   C. B plus un `userId` dans le corps : c'est alors une requête HÉRITÉE COMPLÈTE ; jouée AVEC et SANS Bearer v2, les deux doivent donner le MÊME résultat (le Bearer n'ajoute aucun pouvoir).
// Deux serveurs : avec JETON_API (la 401 héritée existe) et SANS (tour 1, I-1 : `verifierJeton` laisse tout passer, le refus devient le 400 « userId manquant » de `verifierAcces`).
// CE QUE LE BANC ÉTABLIT : en A et B le code hérité ne débite rien, n'écrit rien et n'appelle pas le modèle (refus avant toute consommation) ; en C il agit comme pour toute requête héritée, sur le compte
// HÉRITÉ du userId fourni, avec ou sans Bearer. /api/identifier/reponse n'a pas de route héritée : 404 d'Express. Le contrat et l'audit doivent DIRE la condition JETON_API (lus en fin de banc).
require('dotenv').config();
const fs = require('fs'), path = require('path');
const { demarrer, RACINE } = require('../../verrou/serveur');
const H = require('./_harnais');
const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js');
const CHARGES = path.join(RACINE, 'verrou', 'charges.json');
const JETON = 'jeton-config-invalide';
const BEARER = 'Bearer ' + 'A'.repeat(43);
const CORPS = {
    '/api/identifier': { contrat: 2, versionExtension: '2.0.0', marche: 'vinted.fr', imageUrls: ['https://images1.vinted.net/t/x.jpg'], title: 'Dracaufeu' },
    '/api/identifier/reponse': { scanId: '0123456789abcdef01234567', idProduct: 1 },
    '/api/solde': {},
    '/api/retour-live': { scanId: '0123456789abcdef01234567', prixLive: 12.5 }
};
const CHEMINS = Object.keys(CORPS);
const code = r => r.json && r.json.error;

async function jouer(nom, envSup, avecJeton) {
    const srv = await demarrer(FAUX, { VERROU_CHARGES: CHARGES, JETON_API: '', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: '1', V2_ACCUEIL: 'beaucoup', ...envSup });
    try {
        H.vrai(`${nom} : le serveur est connecté à la base de banc`, await srv.attendreMongo());
        const url = `http://127.0.0.1:${srv.port}`;
        const poster = (chemin, entetes, sup) => H.appel(url, chemin, { methode: 'POST', corps: { ...CORPS[chemin], ...sup }, entetes: { 'idempotency-key': 'k-' + Math.random().toString(36).slice(2), ...entetes } });
        const solde = async userId => (await H.appel(url, '/api/solde', { methode: 'POST', corps: { userId }, entetes: avecJeton ? { 'x-jeton': JETON } : {} })).json;
        const total = s => (s.soldeGratuit || 0) + (s.soldeScans || 0);
        const xj = avecJeton ? { 'x-jeton': JETON } : {};
        // A. Bearer seul
        const A = {}; for (const c of CHEMINS) A[c] = await poster(c, { authorization: BEARER }, {});
        const attenduA = avecJeton ? [401, 'Non autorisé'] : [400, 'Identifiant utilisateur manquant'];
        const attenduRL = avecJeton ? [401, 'Non autorisé'] : [400, 'userId et scanId sont requis'];
        H.v(`${nom} A. Bearer seul : identifier et solde => ${attenduA.join(' ')} héritée (jamais le 503 v2)`, ['/api/identifier', '/api/solde'].map(c => [A[c].statut, code(A[c])]), Array(2).fill(attenduA));
        H.v(`${nom} A. retour-live => ${attenduRL.join(' ')}`, [A['/api/retour-live'].statut, code(A['/api/retour-live'])], attenduRL);
        H.v(`${nom} A. /api/identifier/reponse => 404 d'Express (aucune route héritée), pas un 503 JSON`, [A['/api/identifier/reponse'].statut, A['/api/identifier/reponse'].json], [404, null]);
        H.vrai(`${nom} A. aucune réponse n'est une enveloppe v2 (ni erreur.code, ni facturation)`, Object.values(A).every(r => !r.json || (r.json.erreur === undefined && r.json.facturation === undefined)));
        // B. + x-jeton public, sans userId (sans JETON_API le x-jeton ne change rien : même 400)
        const B = {}; for (const c of CHEMINS) B[c] = await poster(c, { authorization: BEARER, ...xj }, {});
        H.v(`${nom} B. Bearer + x-jeton, sans userId : identifier et solde => 400 « Identifiant utilisateur manquant » (avant tout débit)`, ['/api/identifier', '/api/solde'].map(c => [B[c].statut, code(B[c])]), Array(2).fill([400, 'Identifiant utilisateur manquant']));
        H.v(`${nom} B. retour-live => 400 « userId et scanId sont requis »`, [B['/api/retour-live'].statut, code(B['/api/retour-live'])], [400, 'userId et scanId sont requis']);
        H.v(`${nom} B. /api/identifier/reponse => 404`, B['/api/identifier/reponse'].statut, 404);
        // C. requête héritée complète : AVEC puis SANS Bearer, deux comptes héritiers distincts, mêmes résultats
        const R = {};
        for (const [forme, u, ent] of [['avec', `heritier-avec-${nom}`, { authorization: BEARER, ...xj }], ['sans', `heritier-sans-${nom}`, { ...xj }]]) {
            const av = await solde(u); const sortie = {};
            for (const c of CHEMINS) { const r = await poster(c, ent, { userId: u }); sortie[c] = [r.statut, r.json ? (r.json.erreur === undefined && r.json.facturation === undefined) : null, r.json ? Object.keys(r.json).sort().join(',') : null]; }
            const ap = await solde(u);
            R[forme] = { sortie, delta: total(ap) - total(av), nouveau: av.soldeGratuit };
        }
        H.v(`${nom} C. la requête héritée complète donne les MÊMES statuts, formes et delta de solde AVEC et SANS Bearer v2 (le Bearer n'ajoute aucun pouvoir)`, [R.avec.sortie, R.avec.delta], [R.sans.sortie, R.sans.delta]);
        H.v(`${nom} C. /api/identifier : forme HÉRITÉE (ni enveloppe v2 ni facturation v2), /api/solde : forme héritée, /api/retour-live : « scanId inconnu » 404, /reponse : 404`,
            [R.avec.sortie['/api/identifier'][1], R.avec.sortie['/api/solde'][2], R.avec.sortie['/api/retour-live'][0], R.avec.sortie['/api/identifier/reponse'][0]], [true, 'restantSemaine,soldeGratuit,soldeScans', 404, 404]);
        H.vrai(`${nom} C. le compte héritier est un compte de l'ancien serveur (dotation d'accueil lue à son nom)`, Number.isFinite(R.avec.nouveau));
        const intact = await solde(`jamais-nomme-${nom}`);
        H.v(`${nom} : un compte jamais nommé par A ni B garde sa dotation d'accueil`, [intact.soldeScans, Number.isFinite(intact.soldeGratuit)], [0, true]);
    } finally { srv.enfant.kill(); }
}
(async () => {
    await H.ouvrirBancV2();
    await jouer('avec JETON_API', { JETON_API: JETON }, true);
    await jouer('SANS JETON_API', {}, false);
    await H.arreterBanc();
    // les textes disent la condition (tour 1, I-1)
    const contrat = fs.readFileSync(path.join(RACINE, 'CONTRAT-API-V2.md'), 'utf8'), audit = fs.readFileSync(path.join(RACINE, 'AUDIT-SECURITE-V2.md'), 'utf8');
    // Tour 2 (M-4) : regex STRICTES sur la phrase exacte (la ligne O2 est une ligne de table énorme qui contient d'autres « 400 » : une regex lâche passerait même sans la condition)
    const PH_CONTRAT = /\bConfiguration invalide, chemin par chemin\b[^\n]*?`JETON_API` est posée sur le serveur, sinon `400`/, PH_AUDIT = /SI `JETON_API` est posée sur le serveur ; sans elle `verifierJeton` laisse tout passer et c'est le 400 « userId manquant »/;
    H.vrai('le contrat (ligne O2) dit : « si la variable héritée `JETON_API` est posée sur le serveur, sinon `400` »', PH_CONTRAT.test(contrat));
    H.vrai('l\'audit dit : « SI `JETON_API` est posée sur le serveur ; sans elle `verifierJeton` laisse tout passer et c\'est le 400 « userId manquant » »', PH_AUDIT.test(audit));
    H.vrai('   la mutation « retirer sinon `400` » du contrat est vue (la même regex rend faux), de même « retirer la condition » de l\'audit', !PH_CONTRAT.test(contrat.replace('sinon `400`', '')) && !PH_AUDIT.test(audit.replace('SI `JETON_API` est posée sur le serveur ; ', '')));
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
