'use strict';
// Banc LIMITEUR-HERITE — le limiteur hérité (60 requêtes/h/IP sur /api/identifier* et /api/analyser*) ne compte plus les requêtes que la v2 traite ELLE-MÊME
// et dont elle garantit qu'elles ne parviennent pas au gestionnaire hérité sans un porteur v2 authentifié ; tout le reste reste limité comme avant.
// Base : la base EN MÉMOIRE du banc. Deux serveurs ENFANTS (index.js réel, faux réseau — le modèle payant est factice) : v2 allumée / éteinte. Aucune requête hors boucle locale.
const H = require('./_harnais');
const path = require('path');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const R = path.join(__dirname, '..', '..');
const CHARGES = path.join(R, 'verrou', 'charges.json');
const ORIGINE = require('../config').lireConfig({ MONGODB_BASE: 'test_scratch', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1' }).origines.extension;
let nIp = 0, nCle = 0;
const ipUnique = () => `10.9.${Math.floor(++nIp / 250)}.${nIp % 250 + 1}`;
const cle = () => `banc-lh-${Date.now().toString(36)}-${++nCle}`;
const appelsIA = srv => (srv.lire().match(/lecture rejouée/g) || []).length;
const attendre = ms => new Promise(r => setTimeout(r, ms));
const LEGACY_429 = '{"success":false,"error":"Trop de requêtes, réessaie plus tard."}';

async function inst() {
    const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc-lh' });
    await db.col('installations').insertOne(i); return jeton;
}
const faux = () => J.genererJeton();   // un Bearer de bonne forme, qu'aucune installation ne porte

// N requêtes POST de la même IP, séquentielles ; rend les réponses.
async function serie(url, chemin, n, { ip, jeton, corps, cleIdem = false }) {
    const rs = [];
    for (let k = 0; k < n; k++)
        rs.push(await H.appel(url, chemin, { methode: 'POST', corps, entetes: { origin: ORIGINE, 'x-forwarded-for': ip, 'x-jeton': 'jeton-verrou', ...(jeton ? { authorization: `Bearer ${jeton}` } : {}), ...(cleIdem ? { 'idempotency-key': cle() } : {}) } }));
    return rs;
}
const nb429 = rs => rs.filter(r => r.statut === 429).length;

(async () => {
    // ── 0. unitaire : sans configuration valide / route non montée, rien n'est exempté, et le refus garde la forme héritée
    const LH = require('../limiteur-heritage');
    const reponseFausse = () => { const r = { entetes: {}, statut: null, corps: null, setHeader(k, v) { this.entetes[k] = v; }, status(s) { this.statut = s; return this; }, json(c) { this.corps = c; return this; }, send(c) { this.corps = c; return this; } }; return r; };
    const requete = (o = {}) => ({ method: 'POST', originalUrl: '/api/identifier', body: { contrat: 2 }, get: () => 'Bearer x', ...o });
    const resolvantInstallation = () => async (req, res, next) => { req.v2 = { porteur: { installation: { _id: 1 } } }; next(); };
    const sansCfg = LH.fabrique(() => null, { resoudre: resolvantInstallation });
    H.v('0a. sans configuration v2 valide : jamais exempté, même pour une requête de contrat 2 dont le porteur serait reconnu', await sansCfg.sauter(requete()), false);
    const avecCfg = (resoudre) => LH.fabrique(() => ({}), { resoudre });
    H.v('0c. configuration valide + porteur avec installation + route de la v2 : exempté', await avecCfg(resolvantInstallation).sauter(requete()), true);
    H.v('0d. porteur sans installation (anonyme) : compté', await avecCfg(() => async (req, res, next) => { req.v2 = { porteur: null }; next(); }).sauter(requete()), false);
    H.v('0e. la lecture du porteur lève : compté (échec fermé)', await avecCfg(() => async () => { throw new Error('mongo'); }).sauter(requete()), false);
    H.v('0f. la lecture du porteur répond elle-même une erreur : compté', await avecCfg(() => async (req, res) => { res.status(503).json({}); }).sauter(requete()), false);
    H.v('0g. contrat 2 sur /api/analyser, GET, ou corps sans contrat : compté', [await avecCfg(resolvantInstallation).sauter(requete({ originalUrl: '/api/analyser' })), await avecCfg(resolvantInstallation).sauter(requete({ method: 'GET' })), await avecCfg(resolvantInstallation).sauter(requete({ body: {} }))], [false, false, false]);
    H.v('0d2. (C-1) un porteur de compte résolu SANS installation (session de scanner, porteur.js:32-33) : compté', await avecCfg(() => async (req, res, next) => { req.v2 = { porteur: { type: 'compte', id: 1, compte: { _id: 1 }, installation: null, surface: 'scanner' } }; next(); }).sauter(requete()), false);
    H.v('0h. (C-3) sous-chemin /api/identifier/reponse/x, GET /api/identifier/reponse, barre finale, majuscules : non candidats', [LH.requeteDeLaV2(requete({ originalUrl: '/api/identifier/reponse/x' })), LH.requeteDeLaV2(requete({ originalUrl: '/api/identifier/reponse', method: 'GET' })), LH.requeteDeLaV2(requete({ originalUrl: '/api/identifier/' })), LH.requeteDeLaV2(requete({ originalUrl: '/API/IDENTIFIER' }))], [false, false, false, false]);
    H.v('0i. (C-3) /api/identifier?x=1 avec contrat 2 et POST /api/identifier/reponse?y=2 : candidats', [LH.requeteDeLaV2(requete({ originalUrl: '/api/identifier?x=1' })), LH.requeteDeLaV2(requete({ originalUrl: '/api/identifier/reponse?y=2', body: {} }))], [true, true]);
    // ── 0j. le PLAFOND EN MÉMOIRE par IP (candidates seulement), unitaire, horloge injectée
    {
        const cfgLimites = { limites: { identifierParCompteHeure: 120, reponseParPorteurHeure: 600 } };
        H.v('0j. le plafond se dérive : 5 porteurs × (120 identifications + 600 réponses) par heure = 3600', [LH.PORTEURS_PAR_IP, LH.plafondDe(cfgLimites)], [5, 3600]);
        let t = 1_000_000_000_000; const f = LH.fabrique(() => cfgLimites, { maintenant: () => t });
        const passer = (req) => { const res = reponseFausse(); let suite = false; f.plafondIp(req, res, () => { suite = true; }); return { suite, res }; };
        const plafond = LH.plafondDe(cfgLimites), ipA = { ip: '1.1.1.1' };
        let derniere, refusees = 0;
        for (let k = 0; k < plafond; k++) derniere = await passer(requete(ipA));
        H.v('0k. les `plafond` premières requêtes candidates d\'une IP passent', derniere.suite, true);
        const r = await passer(requete(ipA)); refusees += r.suite ? 0 : 1;
        H.v('0l. la suivante est refusée : 429 DEBIT, reessayerDans = Retry-After dans ]3000, 3600]', [r.suite, r.res.statut, (r.res.corps && r.res.corps.erreur || {}).code, r.res.entetes['Retry-After'] === String((r.res.corps && r.res.corps.erreur || {}).reessayerDans), ((r.res.corps && r.res.corps.erreur || {}).reessayerDans) > 3000 && ((r.res.corps && r.res.corps.erreur || {}).reessayerDans) <= 3600], [false, 429, 'DEBIT', true, true]);
        H.v('0m. une autre IP est intacte ; une requête NON candidate (héritée, GET, /api/analyser) de l\'IP saturée passe sans être comptée', [(await passer(requete({ ip: '2.2.2.2' }))).suite, (await passer(requete({ ...ipA, body: {} }))).suite, (await passer(requete({ ...ipA, method: 'GET' }))).suite, (await passer(requete({ ...ipA, originalUrl: '/api/analyser' }))).suite], [true, true, true, true]);
        t += 3600e3 + 1;
        H.v('0n. la fenêtre écoulée remet le compteur à zéro', (await passer(requete(ipA))).suite, true);
        const sans = LH.fabrique(() => null, { maintenant: () => t });
        let passe = false; sans.plafondIp(requete({ ip: '9.9.9.9' }), reponseFausse(), () => { passe = true; });
        H.v('0o. sans configuration v2 valide : le plafond ne s\'applique pas', passe, true);
        // mémoire bornée : 100 000 IP distinctes ne dépassent jamais MAX_IPS entrées, la purge retire les fenêtres écoulées
        const g = LH.fabrique(() => cfgLimites, { maintenant: () => t });
        for (let k = 0; k < LH.MAX_IPS + 50; k++) g.plafondIp(requete({ ip: `ip${k}` }), reponseFausse(), () => { });
        H.v('0p. mémoire : MAX_IPS + 50 IP distinctes ⇒ jamais plus de MAX_IPS entrées', [LH.MAX_IPS, g.taillePlafond()], [100000, 100000]);
        t += 3600e3 + 1; g.purger();
        H.v('0q. la purge retire les fenêtres écoulées', g.taillePlafond(), 0);
        // I-1 : la clé du plafond est celle du limiteur hérité (ipKeyGenerator d'express-rate-limit, /56 pour l'IPv6), pas req.ip brut
        const { ipKeyGenerator } = require('express-rate-limit');
        const h = LH.fabrique(() => cfgLimites, { maintenant: () => t });
        const passerH = (ip) => { const res = reponseFausse(); let suite = false; h.plafondIp(requete({ ip }), res, () => { suite = true; }); return suite; };
        const a56 = '2001:db8:1:aa00::1', b56 = '2001:db8:1:aaff:1234::9', c56 = '2001:db8:1:bb00::1';   // a et b : même /56 (2001:db8:1:aa..) ; c : un autre /56
        H.v('0r. (I-1) précondition : a et b ont la même clé du limiteur hérité, c une autre', [ipKeyGenerator(a56) === ipKeyGenerator(b56), ipKeyGenerator(a56) === ipKeyGenerator(c56)], [true, false]);
        for (let k = 0; k < plafond; k++) passerH(a56);
        H.v('0s. (I-1) deux adresses du MÊME /56 partagent un compteur : la 2e (autre adresse) est refusée au-delà du plafond', [passerH(a56), passerH(b56)], [false, false]);
        H.v('0t. (I-1) une adresse d\'un /56 différent a son propre compteur', passerH(c56), true);
        const v4 = LH.fabrique(() => cfgLimites, { maintenant: () => t });
        const passerV4 = (ip) => { let suite = false; v4.plafondIp(requete({ ip }), reponseFausse(), () => { suite = true; }); return suite; };
        for (let k = 0; k < plafond; k++) passerV4('203.0.113.7');
        H.v('0u. (I-1) une IPv4 se comporte comme avant : refusée au-delà du plafond, une autre IPv4 intacte', [passerV4('203.0.113.7'), passerV4('203.0.113.8')], [false, true]);
        H.vrai('0v. (M-2) le plafond couvre au moins UN porteur au maximum de ses deux routes (identifications + réponses)', LH.plafondDe(cfgLimites) >= cfgLimites.limites.identifierParCompteHeure + cfgLimites.limites.reponseParPorteurHeure && LH.PORTEURS_PAR_IP >= 1);
    }
    const r0 = reponseFausse(); sansCfg.refuser(requete(), r0, () => { }, { statusCode: 429, message: { success: false, error: 'Trop de requêtes, réessaie plus tard.' } });
    H.v('0b. sans configuration : le refus garde la forme héritée', [r0.statut, JSON.stringify(r0.corps)], [429, LEGACY_429]);

    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-limiteur-herite.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    const { demarrer } = require('../../verrou/serveur');
    const FAUX = path.join(__dirname, 'faux-reseau-v2.js');
    const base = { VERROU_CHARGES: CHARGES, JETON_API: 'jeton-verrou', MONGODB_BASE: 'test_scratch', OPENROUTER_API_KEY: '' };
    const srvOn = await demarrer(FAUX, { ...base, RM_API_V2: '1', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1' });
    const srvOff = await demarrer(FAUX, { ...base, RM_API_V2: '' });
    if (!await srvOn.attendreMongo() || !await srvOff.attendreMongo()) throw new Error('Mongo non connecté');
    const on = `http://127.0.0.1:${srvOn.port}`, off = `http://127.0.0.1:${srvOff.port}`;
    const IMG = require(CHARGES).charges.find(c => c.cellule === 'occidentale').imageUrl;
    const corps2 = { contrat: 2, imageUrls: [], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' };   // refusée par la v2 (entrée) AVANT tout débit : bon marché, aucun modèle
    const corpsHerite = { userId: 'banc-lh', imageUrls: [IMG], title: null, vintedEtat: null };

    // ── 1. 61 requêtes v2 AUTHENTIFIÉES (contrat 2) de la même IP : aucune refusée par le limiteur hérité
    {
        const jeton = await inst(), ia0 = appelsIA(srvOn);
        const rs = await serie(on, '/api/identifier', 61, { ip: ipUnique(), jeton, corps: corps2, cleIdem: true });
        H.v('1a. 61 requêtes contrat 2 authentifiées, même IP : aucune refusée par le limiteur hérité (aucun 429)', nb429(rs), 0);
        H.v('   toutes répondues par la v2 (enveloppe v2, jamais l\'enveloppe héritée)', rs.filter(r => r.json && r.json.erreur && r.json.success === false).length, 61);
        H.v('   aucun appel au modèle', appelsIA(srvOn) - ia0, 0);
        const jeton2 = await inst();
        const rr = await serie(on, '/api/identifier/reponse', 61, { ip: ipUnique(), jeton: jeton2, corps: {} });
        H.v('1b. 61 requêtes /api/identifier/reponse authentifiées, même IP : aucun 429', nb429(rr), 0);
        H.v('   toutes en enveloppe v2', rr.filter(r => r.json && r.json.erreur).length, 61);
    }

    // ── 2. 61 requêtes HÉRITÉES : la 61e est refusée, comme avant (v2 allumée ET v2 éteinte, même corps exact)
    {
        const a = await serie(on, '/api/identifier', 61, { ip: ipUnique(), corps: corpsHerite });
        H.v('2a. v2 allumée, 61 héritées : 60 non limitées puis la 61e refusée', [a.slice(0, 60).some(r => r.texte === LEGACY_429), a[60].statut, a[60].texte], [false, 429, LEGACY_429]);
        const b = await serie(off, '/api/identifier', 61, { ip: ipUnique(), corps: corpsHerite });
        H.v('2b. v2 éteinte (RM_API_V2 absente), 61 héritées : identique à aujourd\'hui', [b.slice(0, 60).some(r => r.texte === LEGACY_429), b[60].statut, b[60].texte], [false, 429, LEGACY_429]);
        const forme = r => [r.entetes['ratelimit-policy'], r.entetes['x-ratelimit-limit'] === undefined, r.entetes['ratelimit-limit']];
        H.v('2b2. (C-2) v2 éteinte ET allumée, route héritée : ratelimit-policy 60;w=3600, ratelimit-limit 60, aucun x-ratelimit-limit', [forme(a[0]), forme(b[0]), forme(a[60]), forme(b[60])], [['60;w=3600', true, '60'], ['60;w=3600', true, '60'], ['60;w=3600', true, '60'], ['60;w=3600', true, '60']]);
        const c = await serie(off, '/api/identifier', 61, { ip: ipUnique(), corps: { ...corpsHerite, contrat: 2 } });
        H.v('2c. v2 éteinte, « contrat: 2 » : limité comme une héritée (la 61e refusée, forme héritée)', [c[60].statut, c[60].texte], [429, LEGACY_429]);
    }

    // ── 3. 61 requêtes « contrat 2 » avec un FAUX Bearer : jamais le gestionnaire hérité, jamais le modèle ; refus v2 ; la 61e en 429 v2 (DEBIT + Retry-After)
    {
        const ia0 = appelsIA(srvOn), ip = ipUnique(), f = faux();
        const rs = await serie(on, '/api/identifier', 61, { ip, jeton: f, corps: { ...corps2, imageUrls: [IMG] }, cleIdem: true });
        H.v('3a. 60 premières : refus v2 JETON (401), enveloppe v2', [rs.slice(0, 60).every(r => r.statut === 401 && r.json && r.json.erreur && r.json.erreur.code === 'JETON')], [true]);
        H.v('3b. la 61e : 429 en enveloppe v2 (erreur.code DEBIT), Retry-After présent et entier', [rs[60].statut, rs[60].json && rs[60].json.erreur && rs[60].json.erreur.code, rs[60].json && rs[60].json.success, /^\d+$/.test(String(rs[60].entetes['retry-after'])) && Number(rs[60].entetes['retry-after']) === (rs[60].json.erreur || {}).reessayerDans && Number.isInteger((rs[60].json.erreur || {}).reessayerDans) && (rs[60].json.erreur || {}).reessayerDans > 3000 && (rs[60].json.erreur || {}).reessayerDans <= 3600], [429, 'DEBIT', false, true]);
        H.v('3c. aucun appel au modèle, aucune réponse héritée', [appelsIA(srvOn) - ia0, rs.filter(r => r.texte === LEGACY_429 || (r.json && typeof r.json.error === 'string')).length], [0, 0]);
    }

    // ── 4. un Bearer VALIDE ne suffit pas à exempter une requête qui n'est pas de contrat 2 ; un faux contrat 2 sur /api/analyser reste limité
    {
        const jeton = await inst();
        const a = await serie(on, '/api/identifier', 61, { ip: ipUnique(), jeton, corps: corpsHerite });
        H.v('4a. Bearer valide + corps héritée (sans contrat 2) sur /api/identifier : la 61e refusée, forme héritée', [a[60].statut, a[60].texte], [429, LEGACY_429]);
        const b = await serie(on, '/api/analyser', 61, { ip: ipUnique(), jeton, corps: { ...corpsHerite, contrat: 2 } });
        H.v('4b. faux « contrat: 2 » sur /api/analyser, Bearer valide : la 61e refusée, forme héritée', [b[60].statut, b[60].texte], [429, LEGACY_429]);
        const c = await serie(on, '/api/identifier', 61, { ip: ipUnique(), jeton, corps: { ...corps2, contrat: '2' } });
        H.v('4c. contrat: "2" (chaîne) : pas de contrat 2, donc limité (61e en 429)', c[60].statut, 429);
        const d = await serie(on, '/api/identifier/', 61, { ip: ipUnique(), jeton, corps: corps2, cleIdem: true });
        H.v('4d. chemin avec barre finale : jamais exempté (la 61e en 429)', d[60].statut, 429);
    }

    // ── 5. le PLAFOND EN MÉMOIRE par IP : au-delà, ni lecture ni écriture en base. Serveur enfant ESPIONNÉ (_espion-base.js : une ligne par appel sur installations, limites, comptes, sessions).
    // V2_REPONSE_HEURE=1 ramène le plafond à 5 × (120 + 1) = 605 : la série de 700 le franchit sans 3600 requêtes.
    {
        const srvP = await demarrer(path.join(__dirname, '_espion-base.js'), { ...base, RM_API_V2: '1', V2_REPONSE_HEURE: '1', RENDER_GIT_COMMIT: '0123456789abcdef0123456789abcdef01234567', V2_VERSION_MODELE: 'modele-test.1' });
        if (!await srvP.attendreMongo()) throw new Error('Mongo non connecté (plafond)');
        const url = `http://127.0.0.1:${srvP.port}`, PLAFOND = 5 * (120 + 1), N = 700;
        const lignes = () => (srvP.lire().match(/^ESPION (installations|limites|comptes|sessions)\.\w+/gm) || []).length;
        const lectures = () => (srvP.lire().match(/^ESPION installations\.findOne/gm) || []).length;
        const ecrituresLimites = () => (srvP.lire().match(/^ESPION limites\.(findOneAndUpdate|insertOne|updateOne)/gm) || []).length;
        // joue N requêtes, mesure ce que la base a vu pendant les requêtes AU-DELÀ du plafond
        async function jouer(nom, chemin, opts) {
            const rs = [];
            let avantQueue = 0;
            for (let k = 0; k < N; k++) {
                if (k === PLAFOND) { await attendre(150); avantQueue = lignes(); }
                rs.push((await serie(url, chemin, 1, opts))[0]);
            }
            await attendre(150);
            const queue = rs.slice(PLAFOND);
            H.v(`5. ${nom} : les ${N - PLAFOND} requêtes au-delà du plafond (${PLAFOND}) sont toutes refusées en 429 DEBIT v2`, queue.every(r => r.statut === 429 && r.json && r.json.erreur && r.json.erreur.code === 'DEBIT' && String(r.entetes['retry-after']) === String(r.json.erreur.reessayerDans)), true);
            H.v(`   ${nom} : AUCUNE lecture ni écriture en base pendant ces ${N - PLAFOND} requêtes (appels espionnés)`, lignes() - avantQueue, 0);
            return rs;
        }
        const l0 = lectures();
        await jouer('200+ faux Bearer, contrat 2, /api/identifier', '/api/identifier', { ip: ipUnique(), jeton: faux(), corps: { ...corps2, imageUrls: [IMG] }, cleIdem: true });
        H.v('   lectures `installations` : au plus plafond + les 60 requêtes que le limiteur hérité compte encore (la route relit)', lectures() - l0 <= PLAFOND + 60, true);
        await jouer('faux Bearer, /api/identifier/reponse', '/api/identifier/reponse', { ip: ipUnique(), jeton: faux(), corps: {} });
        const jetonValide = await inst(), e0 = ecrituresLimites();
        await jouer('porteur VALIDE au-delà des limites v2, /api/identifier/reponse', '/api/identifier/reponse', { ip: ipUnique(), jeton: jetonValide, corps: {} });
        H.v('   écritures sur `limites` : au plus le plafond (sans plafond : 700)', ecrituresLimites() - e0 <= PLAFOND, true);
        const jetonValide2 = await inst(), e1 = ecrituresLimites();
        await jouer('porteur VALIDE, contrat 2, /api/identifier', '/api/identifier', { ip: ipUnique(), jeton: jetonValide2, corps: corps2, cleIdem: true });
        H.v('   écritures sur `limites` : au plus le plafond', ecrituresLimites() - e1 <= PLAFOND, true);
        // une requête HÉRITÉE reste comptée par le limiteur hérité, comme avant, et le plafond ne la touche jamais (700 > plafond)
        const ipH = ipUnique();
        const h = [];
        for (let k = 0; k < N; k++) h.push((await serie(url, '/api/identifier', 1, { ip: ipH, corps: corpsHerite }))[0]);
        H.v(`5. ${N} requêtes HÉRITÉES d'une IP : à partir de la 61e, toutes refusées par le limiteur hérité (corps hérité), jamais par le plafond v2`, [h.slice(0, 60).some(r => r.texte === LEGACY_429), h.slice(60).every(r => r.texte === LEGACY_429)], [false, true]);
        srvP.enfant.kill();
    }

    srvOn.enfant.kill(); srvOff.enfant.kill();
    H.bilan();
    await new Promise(r => setTimeout(r, 200));
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
