'use strict';
// INST-BANC-CORS — l'exemption du compte de mesure doit pouvoir SERVIR en intégration : le profil CORS `site` admet POST /api/installation (et ce chemin-là seulement).
// Le vrai montage : cors v2 (middlewareV2) AVANT un stand-in du cors() hérité (même règle que index.js:138 : req.origineV2 ? suite : origine hors liste = 403), puis les routes RÉELLES installations + comptes.
// Une garde s'écrit par ce qu'elle AUTORISE : on la fait dire NON sur les chemins voisins et les origines voisines, puis OUI sur le seul cas admis.
const express = require('express');
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const S = require('../comptes/sessions'); const J = require('../comptes/jetons'); const cors = require('../transport/cors'); const pret = require('../pret');

const SITE = 'https://rat-market.fr', EXT = 'chrome-extension://fgibgdgmadfejkaapeohbhaoolhgpkhb', ACAO = 'access-control-allow-origin';

function appIntegration(cfg) {
    const app = express();
    app.set('trust proxy', true);
    app.use(cors.middlewareV2(cfg));
    app.use((req, res, next) => {                    // stand-in du cors() hérité : une origine non reconnue par v2 et hors liste hérité est refusée en 403
        const o = req.headers.origin;
        if (req.origineV2 || !o || /^chrome-extension:\/\/[a-p]+$/.test(o)) return next();
        return res.status(403).json({ erreur: 'Origine non autorisée' });
    });
    app.use(express.json());
    const { assembler } = require('../index');
    pret.armer(require('../modeles').verifierIndex);
    app.use(assembler([require('../installations/monter'), require('../comptes/monter')], cfg, {}));
    return app;
}

(async () => {
    await H.ouvrirBac('test-installation-banc-cors.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    A.registre.fournir('argent', { solde: async p => ({ total: p.installation ? p.installation.essais : 0, essai: p.installation ? p.installation.essais : 0 }), offre: () => null, reprendreHeritage: async () => ({ ok: false, raison: 'inconnu' }) });
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSTALLATION_BANC_EXEMPTE: '1', V2_INSTALLATION_BANC_JOUR: '10' });
    const srv = await H.serveur(appIntegration(cfg));
    let nIp = 0; const ip = () => A.ip(++nIp);
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    let n = 0;
    const compteBanc = async () => {
        const adresse = `cors-${++n}@rat-market.invalid`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true, banc: true, role: 'administrateur' });
        await db.col('comptes').insertOne(c);
        return `rm_session=${(await S.creerSession(c._id)).token}`;
    };
    const post = (chemin, entetes) => H.appel(srv.url, chemin, { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...ip(), ...entetes } });
    const preflight = (chemin, origine, methode = 'POST', entetes = 'content-type, x-rat-market') => H.appel(srv.url, chemin, { methode: 'OPTIONS', entetes: { origin: origine, 'access-control-request-method': methode, 'access-control-request-headers': entetes } });

    // ── 1. le préflight depuis l'origine du site ──
    let r = await preflight('/api/installation', SITE);
    H.v('CORS-1a. OPTIONS /api/installation depuis le site : 204, origine exacte', [r.statut, r.entetes[ACAO]], [204, SITE]);
    H.v('     credentials autorisés, POST permis, X-Rat-Market et Content-Type permis', [r.entetes['access-control-allow-credentials'], /POST/.test(r.entetes['access-control-allow-methods'] || ''), /x-rat-market/i.test(r.entetes['access-control-allow-headers'] || ''), /content-type/i.test(r.entetes['access-control-allow-headers'] || '')], ['true', true, true, true]);
    r = await preflight('/api/installation', 'https://exemple.invalid');
    H.v('CORS-1b. le même préflight depuis une origine quelconque : refusé (403), aucun en-tête CORS', [r.statut, ACAO in r.entetes], [403, false]);
    r = await preflight('/api/installation', SITE + '.evil.invalid');
    H.v('     origine voisine (suffixe) : refusée', [r.statut, ACAO in r.entetes], [403, false]);

    // ── 2. le POST avec la session banc : exempté, depuis le site ──
    const banc = await compteBanc();
    const sature = async () => { const e = ip(); await H.appel(srv.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: e }); await H.appel(srv.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: e }); return e; };
    {
        const e = await sature();
        const avant = await db.col('installations').countDocuments({});
        const a = await H.appel(srv.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...e, origin: SITE, 'x-rat-market': '1', cookie: banc } });
        H.v('CORS-2a. POST /api/installation depuis le site avec la session banc (IP au plafond) : 201, une installation exemptée, en-têtes CORS posés', [a.statut, typeof a.json.jetonInstallation, await db.col('installations').countDocuments({}) - avant, a.entetes[ACAO], a.entetes['access-control-allow-credentials']], [201, 'string', 1, SITE, 'true']);
        const sans = await H.appel(srv.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...e, origin: SITE, 'x-rat-market': '1' } });
        H.v('CORS-2b. depuis le site SANS session banc : la règle ordinaire (2 par IP) s\'applique', [sans.statut, code(sans)], [429, 'DEBIT']);
        const bearer = await H.appel(srv.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...e, origin: SITE, 'x-rat-market': '1', cookie: banc, authorization: `Bearer ${J.genererJeton()}` } });
        H.v('CORS-2c. avec un Bearer : pas d\'exemption', [bearer.statut], [429]);
        const etrangere = await H.appel(srv.url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...e, origin: 'https://exemple.invalid', 'x-rat-market': '1', cookie: banc } });
        H.v('CORS-2d. le même POST depuis une origine quelconque : refusé (403), aucune installation', [etrangere.statut, ACAO in etrangere.entetes], [403, false]);
    }

    // ── 3. le profil `extension` est inchangé ──
    r = await preflight('/api/installation', EXT, 'POST', 'authorization, content-type, idempotency-key');
    H.v('CORS-3a. l\'extension garde son préflight : 204, sans credentials, GET et POST', [r.statut, r.entetes[ACAO], 'access-control-allow-credentials' in r.entetes, r.entetes['access-control-allow-methods']], [204, EXT, false, 'GET, POST']);
    H.v('CORS-3b. profils : le profil extension n\'a pas bougé (mêmes chemins qu\'avant)', cors.profils(cfg).find(p => p.nom === 'extension').chemins.length, 4 + 0);

    // ── 4. rien d'autre n'est élargi : chemins voisins ──
    for (const chemin of ['/api/installation/x', '/api/installations', '/api/installation/', '/api/installationx', '/api/installation/abc/def', '/api/Installation']) {
        r = await preflight(chemin, SITE);
        H.v(`CORS-4. site, préflight ${chemin} : aucun en-tête CORS du profil site`, [ACAO in r.entetes, r.entetes['access-control-allow-credentials'] === 'true'], [false, false]);
    }
    const siteChemins = cors.profils(cfg).find(p => p.nom === 'site').chemins;
    H.v('CORS-4b. le profil site admet /api/installation et ces chemins-là seulement parmi les voisins', ['/api/installation', '/api/installation/x', '/api/installations', '/api/installation/'].map(c => siteChemins.some(re => re.test(c))), [true, false, false, false]);
    r = await preflight('/api/identifier', SITE);
    H.v('CORS-4c. /api/identifier n\'est pas admis pour le site', ACAO in r.entetes, false);

    await srv.fermer();
    H.bilan(); await H.fermerBac();
})().catch(async e => { console.error(e); process.exitCode = 1; try { await H.fermerBac(); } catch { /* sortie */ } });
