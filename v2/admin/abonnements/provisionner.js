'use strict';
// LE SCRIPT DE PROVISIONNEMENT STRIPE — MODE TEST SEULEMENT dans ce lot. Idempotent (relancé, il ne crée rien de plus).
//   node v2/admin/abonnements/provisionner.js --mode=test                 SIMULATION : lit, dit ce qu'il ferait, n'écrit RIEN
//   node v2/admin/abonnements/provisionner.js --mode=test --ecrire        crée ou retrouve produits, prix, portail, puis l'endpoint de webhook (et pose son secret sur l'ESSAI) ; écrit provision-test.json
//   node v2/admin/abonnements/provisionner.js --mode=test --ecrire --sans-webhook    comme ci-dessus SANS l'endpoint : aucun secret créé, aucune écriture sur Render
// La clé Test vient du .env d'api-v2 par garde-secrets (qui masque toute valeur du .env à la sortie). Le secret de l'endpoint va sur le service d'ESSAI de Render par poser-sur-render.js,
// et nulle part ailleurs. La clé Live ne sert à RIEN ici. Aucun argument inconnu n'est toléré.
const fs = require('fs'), path = require('path');
const RACINE_TRAVAIL = 'C:\\Users\\Yung\\rat-market-travail\\api';
const SORTIE = path.join(RACINE_TRAVAIL, 'stripe', 'provision-test.json');
const AUTORISES = /^--(mode=test|ecrire|sans-webhook|site=https:\/\/[A-Za-z0-9.-]+|url-essai=https:\/\/[A-Za-z0-9.-]+)$/;

(async () => {
    const args = process.argv.slice(2);
    const refus = args.filter(a => !AUTORISES.test(a));
    if (refus.length) { console.error(`ARRÊT : argument(s) non admis (${refus.length}). Admis : --mode=test (obligatoire), --ecrire, --sans-webhook, --site=https://…, --url-essai=https://…`); process.exit(1); }
    if (!args.includes('--mode=test')) { console.error('ARRÊT : --mode=test est obligatoire (le mode Live est un autre lot)'); process.exit(1); }
    const ecrire = args.includes('--ecrire'), avecWebhook = !args.includes('--sans-webhook');
    const valeur = nom => { const a = args.find(x => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : null; };
    const site = valeur('site') || 'https://rat-market.fr', essai = valeur('url-essai') || 'https://rat-market-api-essai.onrender.com';
    const { ENV } = require(path.join(RACINE_TRAVAIL, 'atlas', 'garde-secrets'));      // charge le .env d'api-v2 et masque toute sortie
    const cle = ENV.STRIPE_TEST_SECRET_KEY;
    if (!cle || !/^sk_test_[A-Za-z0-9]+$/.test(cle)) { console.error('ARRÊT : STRIPE_TEST_SECRET_KEY absente ou pas une clé de test'); process.exit(1); }
    const sdk = require('../../abonnements/sdk'), stripe = sdk.creerClient(cle);
    const trace = m => console.log(`  ${m}`);
    const { provisionner, fichierDeSortie } = require('./provisionner-lib');
    let poserSurRender;
    if (ecrire && avecWebhook) poserSurRender = require('./poser-sur-render').fabriquer(require(path.join(RACINE_TRAVAIL, 'render', 'render-garde.js')), trace);
    console.log(`Provisionnement Stripe — mode TEST — ${ecrire ? 'ÉCRITURE' : 'SIMULATION'}`);
    const rapport = await provisionner({ stripe, site, urlWebhook: `${essai}/api/webhook-stripe-v2`, versionApi: sdk.versionApi(), ecrire, avecWebhook, poserSurRender, trace });
    console.log(`Bilan : ${rapport.crees.length} créé(s), ${rapport.retrouves.length} retrouvé(s), ${rapport.miseAJour.length} mis à jour`);
    if (ecrire) {
        const texte = fichierDeSortie({ rapport, urlWebhook: `${essai}/api/webhook-stripe-v2`, mode: 'test', le: new Date().toISOString() });
        fs.writeFileSync(SORTIE, texte + '\n');
        console.log(`Fichier écrit : ${SORTIE} (identifiants seulement)`);
        console.log(`Variables à poser sur le service d'essai (valeurs dans le fichier, sauf la clé et le secret) : V2_ABONNEMENTS, V2_STRIPE_MODE=test, V2_STRIPE_CLE, V2_STRIPE_WEBHOOK_SECRET (${rapport.secretPose ? 'posée par ce passage' : "PAS ENCORE posée : passage avec l'endpoint à faire"}), V2_STRIPE_PRIX_*, V2_STRIPE_PORTAIL_CONFIG, V2_FONDATEURS_CODE, V2_FONDATEURS_PLACES`);
    }
})().catch(e => { console.error(`ERREUR : ${String(e && e.message || e).slice(0, 300)}`); process.exit(1); });
