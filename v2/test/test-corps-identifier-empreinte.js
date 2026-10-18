'use strict';
// Banc MODELE-VISUEL-API tour 1 (2) — LA TAILLE DU CORPS de POST /api/identifier. L'extension joint une carte redressée (JPEG 420 × 587, <= 200 Ko, soit <= 273 068 caractères base64) à chaque entrée, 8 entrées au plus :
// jusqu'à ≈ 2,19 Mo. `express.json()` plafonne à 100 Ko : la limite est relevée POUR CETTE ROUTE SEULEMENT et SEULEMENT si V2_EMPREINTE_EXTENSION=1 (éteint : le plafond de 100 Ko est inchangé).
// Deux serveurs ENFANTS (index.js réel, faux réseau, base en mémoire), jamais la production.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const QA = require('./_aide-quota');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');

(async () => {
    await H.ouvrirBancV2();
    await QA.eviterMinuit();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-corps-identifier-empreinte.js', ecrit: true });
    const { demarrer, appeler } = require('../../verrou/serveur');
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '', RM_API_V2: '1' };
    const off = await demarrer(FAUX, { ...base, V2_EMPREINTE_EXTENSION: '0' });
    const on = await demarrer(FAUX, { ...base, V2_EMPREINTE_EXTENSION: '1' });
    if (!await off.attendreMongo() || !await on.attendreMongo()) throw new Error('Mongo non connecté');
    const corps = n => ({ contrat: 2, imageUrls: ['https://images1.vinted.net/a.jpg'], versionExtension: '2.0.0', marche: 'vinted.fr', bourrage: 'A'.repeat(n) });
    const statut = async (srv, chemin, n) => (await appeler(srv.port, 'POST', chemin, corps(n), null)).status;
    const un = 1024 * 1024;
    H.v('1a. éteint : un corps de 1 Mo sur /api/identifier est refusé 413 (le plafond de 100 Ko est inchangé)', await statut(off, '/api/identifier', un), 413);
    H.vrai('1b. éteint : un corps de 90 Ko passe la lecture du corps (n\'est PAS un 413)', await statut(off, '/api/identifier', 90 * 1024) !== 413);
    H.vrai('2a. allumé : un corps de 1 Mo sur /api/identifier passe la lecture du corps (jamais un 413 ; la suite le refuse faute de jeton)', await statut(on, '/api/identifier', un) !== 413);
    H.vrai('2b. allumé : le corps maximal de 8 entrées (8 × 273 068 caractères + enveloppe ≈ 2,19 Mo) passe', await statut(on, '/api/identifier', 8 * 273068 + 20000) !== 413);
    H.v('2c. allumé : au-delà de la borne (2,4 Mo de limite, ici 2,6 Mo) : 413', await statut(on, '/api/identifier', 2600 * 1024), 413);
    H.v('3. allumé : la limite relevée ne vaut QUE pour /api/identifier — un corps de 1 Mo sur /api/solde reste un 413', await statut(on, '/api/solde', un), 413);
    for (const s of [off, on]) { try { s.enfant.kill(); } catch { /* déjà arrêté */ } }
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
