'use strict';
// B2b point 5 (M-3 de la passe 2 de B1) — CONFIGURATION v2 INVALIDE : ce que fait le code HÉRITÉ d'une requête de la v2 sur les 4 chemins qui ne sont PAS dans CHEMINS_FERMES_503
// (POST /api/identifier, /api/identifier/reponse, /api/solde, /api/retour-live). Le banc monte le VRAI serveur (index.js, base en mémoire, faux réseau, OPENROUTER_API_KEY vide) avec RM_API_V2=1 et
// V2_ACCUEIL invalide, et observe. Trois formes de requête, du contrat vers le pire :
//   A. une requête de la v2 telle que le contrat la décrit : Bearer, corps v2, ni x-jeton ni userId ;
//   B. la même avec le x-jeton public de la 1.0.x ajouté (un client qui mélange) ;
//   C. B plus un `userId` dans le corps : c'est alors une requête HÉRITÉE COMPLÈTE qui porte en plus un Bearer — le code hérité la sert comme il l'aurait servie sans Bearer.
// CE QUE LE BANC ÉTABLIT (établi par l'observation, rejouée à chaque lancement) : en A et B le code hérité ne débite rien, n'écrit rien et n'appelle pas le modèle (refus 401 ou 400 avant toute
// consommation) ; en C il agit comme pour toute requête héritée, sur le compte HÉRITÉ du userId fourni — jamais sur un compte v2, la v2 n'étant pas montée — et un Bearer n'ajoute aucun pouvoir.
// /api/identifier/reponse n'a pas de route héritée : 404 d'Express.
require('dotenv').config();
const path = require('path');
const { demarrer, RACINE } = require('../../verrou/serveur');
const H = require('./_harnais');
const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js');
const CHARGES = path.join(RACINE, 'verrou', 'charges.json');
const JETON = 'jeton-config-invalide';
const BEARER = 'Bearer ' + 'A'.repeat(43);
(async () => {
    await H.ouvrirBancV2();
    const srv = await demarrer(FAUX, { VERROU_CHARGES: CHARGES, JETON_API: JETON, MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: '1', V2_ACCUEIL: 'beaucoup' });
    try {
        H.vrai('le serveur est connecté à la base de banc', await srv.attendreMongo());
        const url = `http://127.0.0.1:${srv.port}`;
        const corps = {
            '/api/identifier': { contrat: 2, versionExtension: '2.0.0', marche: 'vinted.fr', imageUrls: ['https://images1.vinted.net/t/x.jpg'], title: 'Dracaufeu' },
            '/api/identifier/reponse': { scanId: '0123456789abcdef01234567', idProduct: 1 },
            '/api/solde': {},
            '/api/retour-live': { scanId: '0123456789abcdef01234567', prixLive: 12.5 }
        };
        const poster = async (chemin, entetes, sup) => H.appel(url, chemin, { methode: 'POST', corps: { ...corps[chemin], ...sup }, entetes: { authorization: BEARER, 'idempotency-key': 'k-' + Math.random().toString(36).slice(2), ...entetes } });
        const solde = async userId => H.appel(url, '/api/solde', { methode: 'POST', corps: { userId }, entetes: { 'x-jeton': JETON } });
        const avant = await solde('compte-heritier-b2b');
        H.v('témoin : le compte héritier neuf porte sa dotation d\'accueil', [avant.statut, avant.json.soldeScans], [200, 0]);

        // A. la requête de la v2 telle que le contrat la décrit
        const A = {};
        for (const c of Object.keys(corps)) A[c] = await poster(c, {}, {});
        H.v('A. Bearer seul : /api/identifier, /api/solde, /api/retour-live => 401 « Non autorisé » HÉRITÉ (jamais le 503 v2)', ['/api/identifier', '/api/solde', '/api/retour-live'].map(c => [A[c].statut, A[c].json && A[c].json.error]), Array(3).fill([401, 'Non autorisé']));
        H.v('A. /api/identifier/reponse => 404 d\'Express (aucune route héritée), pas un 503 JSON', [A['/api/identifier/reponse'].statut, A['/api/identifier/reponse'].json], [404, null]);
        H.vrai('A. aucune réponse n\'est une enveloppe v2 (ni erreur.code, ni facturation)', Object.values(A).every(r => !r.json || (r.json.erreur === undefined && r.json.facturation === undefined)));

        // B. + x-jeton public, sans userId
        const B = {};
        for (const c of Object.keys(corps)) B[c] = await poster(c, { 'x-jeton': JETON }, {});
        H.v('B. Bearer + x-jeton, sans userId : /api/identifier et /api/solde => 400 « Identifiant utilisateur manquant » (avant tout débit)', ['/api/identifier', '/api/solde'].map(c => [B[c].statut, B[c].json && B[c].json.error]), Array(2).fill([400, 'Identifiant utilisateur manquant']));
        H.v('B. /api/retour-live => 400 « userId et scanId sont requis »', [B['/api/retour-live'].statut, B['/api/retour-live'].json && B['/api/retour-live'].json.error], [400, 'userId et scanId sont requis']);
        H.v('B. /api/identifier/reponse => 404', B['/api/identifier/reponse'].statut, 404);

        // C. requête héritée complète portant un Bearer : servie comme l'héritée, sur le compte HÉRITÉ
        const C = {};
        for (const c of Object.keys(corps)) C[c] = await poster(c, { 'x-jeton': JETON }, { userId: 'compte-heritier-b2b' });
        H.vrai('C. /api/identifier : réponse de forme HÉRITÉE (200, ni enveloppe v2 ni facturation v2)', C['/api/identifier'].statut === 200 && C['/api/identifier'].json && C['/api/identifier'].json.erreur === undefined && C['/api/identifier'].json.facturation === undefined);
        H.v('C. /api/solde : forme héritée (soldeGratuit, soldeScans, restantSemaine)', ['soldeGratuit', 'soldeScans', 'restantSemaine'].every(k => k in C['/api/solde'].json), true);
        H.v('C. /api/retour-live : « scanId inconnu » héritée (aucune ligne écrite : le scan n\'existe pas)', [C['/api/retour-live'].statut, C['/api/retour-live'].json && C['/api/retour-live'].json.error], [404, 'scanId inconnu']);
        H.v('C. /api/identifier/reponse => 404', C['/api/identifier/reponse'].statut, 404);
        const apres = await solde('compte-heritier-b2b');
        H.vrai('C. le seul compte touché est le compte HÉRITÉ du userId fourni (le scan débité a été rendu ou reste dans la dotation héritée : solde lisible)', apres.statut === 200 && ['soldeGratuit', 'soldeScans'].every(k => Number.isFinite(apres.json[k])));
        // A et B n'ont consommé AUCUN crédit hérité : un userId qu'elles n'ont jamais nommé reste intact
        const intact = await solde('compte-jamais-nomme-b2b');
        H.v('A et B n\'ont créé ni consommé aucun compte : un compte jamais nommé garde sa dotation d\'accueil', [intact.statut, intact.json.soldeGratuit === avant.json.soldeGratuit], [200, true]);
    } finally { srv.enfant.kill(); }
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
