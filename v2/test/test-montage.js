'use strict';
require('dotenv').config();
const path = require('path');
const { demarrer, appeler, RACINE } = require('../../verrou/serveur');
const H = require('./_harnais');
const FAUX = path.join(RACINE, 'verrou', 'faux-reseau.js');
const CHARGES = path.join(RACINE, 'verrou', 'charges.json');
const JETON = process.env.JETON_API || 'jeton-montage';

// CALCUL-CLIENT : le jeton `mesures-client` suit la MÊME condition que le code (v2/capacites.js::CONDITIONS) ; le banc la rejoue sur la configuration lue des MÊMES variables que le serveur enfant.
const { CAPACITES, capacitesServies } = require('../capacites');
const { lireConfig } = require('../config');
const ENV_BASE = { VERROU_CHARGES: CHARGES, JETON_API: JETON, MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '' };
const configDe = envSup => lireConfig({ ...process.env, ...ENV_BASE, ...envSup });
async function avec(envSup, fn) {
    const srv = await demarrer(FAUX, { ...ENV_BASE, ...envSup });
    try { if (!await srv.attendreMongo()) throw new Error('Mongo non connecté'); return await fn(srv); }
    finally { srv.enfant.kill(); }
}
// Le CORS HÉRITÉ (index.js, ORIGINES_AUTORISEES) : une origine interdite reçoit le refus d'aujourd'hui (403 JSON court),
// une origine autorisée reçoit ses en-têtes d'aujourd'hui. Observé avec l'interrupteur éteint PUIS allumé : les deux doivent coïncider.
const ORIGINE_INTERDITE = 'https://evil.example', ORIGINE_VINTED = 'https://www.vinted.fr', ORIGINE_EXTENSION = 'chrome-extension://abcdefghijklmnop';
async function observerCors(srv) {
    const url = `http://127.0.0.1:${srv.port}`;
    const vu = async origine => {
        const r = await H.appel(url, '/ping', { entetes: { Origin: origine } });
        // le corps de /ping gagne versionMinExtension quand la v2 est allumée (voulu) : seul le corps du REFUS se compare
        return { statut: r.statut, acao: r.entetes['access-control-allow-origin'] ?? null, vary: r.entetes['vary'] ?? null, corps: r.statut === 403 ? r.texte : null };
    };
    return { interdite: await vu(ORIGINE_INTERDITE), vinted: await vu(ORIGINE_VINTED), extension: await vu(ORIGINE_EXTENSION) };
}
const cors = {};
(async () => {
    // INT2 : le serveur enfant hérite de process.env ; sans base de banc il lirait MONGODB_URI du .env (la production). Banc ou refus, avant tout enfant.
    await H.ouvrirBancV2();
    // INTERRUPTEUR ÉTEINT : /ping a EXACTEMENT les clés d'aujourd'hui, et aucune route v2 n'existe
    await avec({ RM_API_V2: '' }, async srv => {
        cors.eteint = await observerCors(srv);
        const p = await appeler(srv.port, 'GET', '/ping');
        H.v('éteint : /ping a les clés d\'aujourd\'hui', Object.keys(p.json).sort(), ['mongo', 'ok', 'version']);
        const c = await appeler(srv.port, 'GET', '/api/compte');
        H.v('éteint : /api/compte n\'existe pas (404)', c.status, 404);
        const i = await appeler(srv.port, 'POST', '/api/installation', { libelle: 'x' });
        H.v('éteint : /api/installation n\'existe pas (404)', i.status, 404);
    });
    // INTERRUPTEUR ALLUMÉ : aucun lot ne monte encore de route (A0) ; la garde d'index qui ferme les routes v2 en 503 est
    // prouvée par test-pret.js (assembler + routes factices). Ici : l'ancien chemin n'est pas cassé.
    await avec({ RM_API_V2: '1' }, async srv => {
        cors.allume = await observerCors(srv);
        const p = await appeler(srv.port, 'GET', '/ping');
        H.vrai('allumé : /ping garde ses clés et AJOUTE versionMinExtension', ['mongo', 'ok', 'version', 'versionMinExtension'].every(k => k in p.json));
        // CAPACITES-PING : de bout en bout (le vrai serveur, la vraie route héritée) — `capacites` s'ajoute sous la même condition, tirée de la liste fermée du code
        // TOUR 1 : ce serveur démarre SANS archive des visuels en mémoire (réveil à froid, aucune clé de lecture) : `langue-impression` et `marques` ne sont PAS annoncés, les trois autres le sont
        // CALCUL-CLIENT : sans drapeau (V2_MESURES_CLIENT éteint, V2_ORB_SERVEUR allumé par défaut) et sans index d'empreintes, ni `empreinte` ni `mesures-client` ne sont annoncés
        H.v('allumé, sans archive des visuels : /ping AJOUTE capacites (la liste fermée de v2/capacites.js, dans l\'ordre, SANS les deux jetons de l\'archive, SANS `empreinte` ni `mesures-client` : drapeaux éteints, aucun index) et rien d\'autre', [Object.keys(p.json).sort(), p.json.capacites],
            [['capacites', 'mongo', 'ok', 'version', 'versionMinExtension'], CAPACITES.filter(j => !['langue-impression', 'marques', 'empreinte', 'mesures-client'].includes(j))]);
        H.v('   … et c\'est exactement ce que la condition du CODE rend sur la configuration de ce serveur (sans archive ni index injectés)', p.json.capacites, capacitesServies(configDe({ RM_API_V2: '1' }), undefined, null, null));
        const s = await appeler(srv.port, 'POST', '/api/solde', { userId: 'montage' }, JETON);
        H.vrai('allumé, sans Bearer : /api/solde garde la forme d\'AUJOURD\'HUI', ['soldeGratuit', 'soldeScans', 'restantSemaine'].every(k => k in s.json));
    });
    // CALCUL-CLIENT, les deux cas du jeton `mesures-client` (contrat : « présent quand le service est en marche », DEMANDE-SERVEUR-EXTENSION.md, « API — 27/10 (nuit) ») : le service est en marche si
    // V2_MESURES_CLIENT=1, V2_ORB_SERVEUR=0 ET le jeton `empreinte` (drapeau, modèle complet, index d'empreintes CHARGÉ en mémoire). Un serveur enfant démarre sans index : drapeaux allumés, il se tait ;
    // la même configuration avec un index chargé (lecteur injecté, comme le fait index.js) l'annonce, en dernier. Drapeau éteint (défaut) : absent, index chargé ou non.
    {
        const ENV_CC = { RM_API_V2: '1', V2_MESURES_CLIENT: '1', V2_ORB_SERVEUR: '0', V2_EMPREINTE_EXTENSION: '1', V2_MODELE_EMPREINTE_ID: 'p-montage-1', V2_MODELE_EMPREINTE_SHA256: 'cd'.repeat(32), V2_MODELE_EMPREINTE_OBJET: 'objets/fictif-modele' };
        const CHARGE = Object.freeze({ index: Object.freeze({}), meta: Object.freeze({ n: 1 }) });
        await avec(ENV_CC, async srv => {
            const p = await appeler(srv.port, 'GET', '/ping');
            H.vrai('drapeaux allumés mais AUCUN index chargé (serveur qui démarre) : ni `empreinte` ni `mesures-client` dans /ping', Array.isArray(p.json.capacites) && !p.json.capacites.includes('empreinte') && !p.json.capacites.includes('mesures-client'));
            H.v('   … la condition du code rend la même liste sur cette configuration', p.json.capacites, capacitesServies(configDe(ENV_CC), undefined, null, null));
        });
        const allume = capacitesServies(configDe(ENV_CC), undefined, null, () => CHARGE);
        H.v('même configuration, index CHARGÉ : `mesures-client` est annoncé, en DERNIER, après `empreinte`', [allume.includes('mesures-client'), allume.slice(-2)], [true, ['empreinte', 'mesures-client']]);
        H.vrai('   drapeau V2_MESURES_CLIENT éteint (défaut), index chargé : `mesures-client` absent, `empreinte` présent', (() => { const c = capacitesServies(configDe({ ...ENV_CC, V2_MESURES_CLIENT: '0' }), undefined, null, () => CHARGE); return c.includes('empreinte') && !c.includes('mesures-client'); })());
        H.vrai('   V2_ORB_SERVEUR allumé (le serveur mesure lui-même), index chargé : `mesures-client` absent', !capacitesServies(configDe({ ...ENV_CC, V2_ORB_SERVEUR: '1' }), undefined, null, () => CHARGE).includes('mesures-client'));
    }
    // CONFIGURATION INVALIDE avec l'interrupteur allumé : les chemins PROPRES à la v2 répondent 503 INDISPONIBLE, l'ancien serveur sert toujours
    await avec({ RM_API_V2: '1', V2_ACCUEIL: 'beaucoup' }, async srv => {
        const c = await appeler(srv.port, 'GET', '/api/compte');
        H.v('configuration invalide : /api/compte => 503 INDISPONIBLE', [c.status, c.json && c.json.erreur && c.json.erreur.code], [503, 'INDISPONIBLE']);
        const p = await appeler(srv.port, 'GET', '/ping');
        H.v('configuration invalide : /ping reste celui d\'aujourd\'hui', Object.keys(p.json).sort(), ['mongo', 'ok', 'version']);
    });
    // CORS hérité inchangé
    for (const [nom, o] of [['éteint', cors.eteint], ['allumé', cors.allume]]) {
        H.v(`CORS hérité (${nom}) : origine interdite => 403`, o.interdite.statut, 403);
        H.vrai(`   le refus n'expose ni stack ni en-tête CORS (${nom})`, !o.interdite.acao && !/\bat \w|node_modules/.test(o.interdite.corps || ''));
        H.v(`CORS hérité (${nom}) : Vinted autorisé`, [o.vinted.statut, o.vinted.acao], [200, ORIGINE_VINTED]);
        H.v(`CORS hérité (${nom}) : extension autorisée`, [o.extension.statut, o.extension.acao], [200, ORIGINE_EXTENSION]);
        H.vrai(`   Vary: Origin présent (${nom})`, /origin/i.test(o.vinted.vary || ''));
    }
    // Écart ASSUMÉ (ruling B4, progress.md) : l'interrupteur allumé ajoute `Vary: Origin` au refus 403 des routes héritées
    // (éteint : aucun Vary). Seul ce champ diffère ; tout le reste doit être identique.
    H.v('CORS hérité (allumé) : le refus 403 porte Vary: Origin (écart assumé B4)', [cors.eteint.interdite.vary, cors.allume.interdite.vary], [null, 'Origin']);
    const sansVary = o => ({ ...o, interdite: { ...o.interdite, vary: undefined } });
    H.v('CORS hérité : éteint et allumé rendent les mêmes réponses (hors Vary du refus 403, écart assumé B4)', sansVary(cors.allume), sansVary(cors.eteint));
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
