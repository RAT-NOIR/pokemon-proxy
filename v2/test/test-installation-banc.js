'use strict';
// LOT INST-BANC — l'exemption de la limite « 2 installations par IP et par jour » (inst-ip), réservée au compte de mesure (banc: true, administrateur, confirmé), reconnu par sa SESSION.
// Base EN MÉMOIRE, aucun réseau. Les routes sont les VRAIES (installations + comptes, par l'assembleur du socle) ; seules les pannes sont fabriquées.
// La garde s'écrit par ce qu'elle AUTORISE : on la fait dire NON sur chaque état fabriqué (IP déjà au plafond, donc un NON se lit en 429 et un OUI en 201), puis OUI sur le seul cas autorisé.
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const S = require('../comptes/sessions'); const J = require('../comptes/jetons');

(async () => {
    await H.ouvrirBac('test-installation-banc.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    A.registre.fournir('argent', { solde: async p => ({ total: p.installation ? p.installation.essais : 0, essai: p.installation ? p.installation.essais : 0 }), offre: () => null, reprendreHeritage: async () => ({ ok: false, raison: 'inconnu' }) });
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSTALLATION_BANC_EXEMPTE: '1', V2_INSTALLATION_BANC_JOUR: '4' });
    const cfgEteint = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const srv = await A.demarrer(cfg), srvEteint = await A.demarrer(cfgEteint);
    let nIp = 0; const ipNeuve = () => ++nIp;
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    const site = A.SITE;
    const poster = (url, ipn, entetes = {}, corps = { versionExtension: '2.0.0' }) => H.appel(url, '/api/installation', { methode: 'POST', corps, entetes: { ...A.ip(ipn), ...entetes } });
    const anonyme = (ipn, url = srv.url) => poster(url, ipn);
    /** Remplit le plafond de l'IP : deux installations anonymes (la 3e est refusée) — après quoi un 201 ne peut venir que de l'exemption. */
    const saturer = async ipn => { const a = await anonyme(ipn), b = await anonyme(ipn); if (a.statut !== 201 || b.statut !== 201) throw new Error('saturation impossible'); return ipn; };

    // ── les comptes et leurs sessions (écrits en base comme le service les écrirait ; le token ne sort jamais) ──
    let n = 0;
    const compte = async (o = {}) => {
        const adresse = `essai-${++n}@rat-market.invalid`;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true }, o);
        await db.col('comptes').insertOne(c);
        const s = await S.creerSession(c._id);
        return { c, cookie: `rm_session=${s.token}`, token: s.token };
    };
    const BANC = { banc: true, role: 'administrateur', verifie: true };
    const avec = (cookie, extra = {}) => ({ cookie, ...site, ...extra });
    const refuse = async (nom, entetes, o = {}) => {
        const ipn = await saturer(ipNeuve()), r = await poster(o.url || srv.url, ipn, entetes, o.corps);
        H.v(nom, [r.statut, code(r)], [429, 'DEBIT']);
        return ipn;
    };

    // ═══ 1. les états refusés : la limite d'aujourd'hui s'applique ═══
    await refuse('INST-BANC-1a. sans session : 429', {});
    const ordinaire = await compte();
    await refuse('INST-BANC-1b. session d\'un compte ordinaire : 429', avec(ordinaire.cookie));
    const admin = await compte({ role: 'administrateur' });
    await refuse('INST-BANC-1c. administrateur non banc : 429', avec(admin.cookie));
    const bancOrdinaire = await compte({ banc: true });
    await refuse('INST-BANC-1d. banc: true mais pas administrateur : 429', avec(bancOrdinaire.cookie));
    const bancFaux = await compte({ ...BANC, banc: 'true' });
    await refuse('INST-BANC-1e. banc non strictement true ("true" en texte) : 429', avec(bancFaux.cookie));
    const bancNonVerifie = await compte({ ...BANC, verifie: false });
    await refuse('INST-BANC-1f. banc administrateur NON vérifié : 429', avec(bancNonVerifie.cookie));
    const bancRoleAutre = await compte({ ...BANC, role: 'admin' });
    await refuse('INST-BANC-1g. rôle « admin » (pas exactement administrateur) : 429', avec(bancRoleAutre.cookie));

    const expiree = await compte(BANC);
    await db.col('sessions').updateOne({ tokenEmpreinte: J.empreinte(expiree.token) }, { $set: { expireLe: new Date(Date.now() - 1000) } });
    await refuse('INST-BANC-2a. session expirée : 429', avec(expiree.cookie));
    const supprimee = await compte(BANC);
    await db.col('sessions').deleteMany({ tokenEmpreinte: J.empreinte(supprimee.token) });
    await refuse('INST-BANC-2b. session supprimée (déconnexion) : 429', avec(supprimee.cookie));
    const revoquee = await compte(BANC);
    await db.col('comptes').updateOne({ _id: revoquee.c._id }, { $inc: { generation: 1 } });
    await refuse('INST-BANC-2c. session d\'une génération révolue (mot de passe réinitialisé) : 429', avec(revoquee.cookie));
    await refuse('INST-BANC-2d. cookie forgé (jeton jamais émis) : 429', avec(`rm_session=${J.genererJeton()}`));
    await refuse('INST-BANC-2e. cookie vide / absurde : 429', avec('rm_session='));

    // un compte banc VALIDE, mais aucun marqueur dans la requête ne le remplace
    const marqueurs = await compte();     // ordinaire : seuls les champs de la requête tentent de se faire passer pour le banc
    await refuse('INST-BANC-3a. banc: true dans le corps : 429', avec(marqueurs.cookie), { corps: { versionExtension: '2.0.0', banc: true, administrateur: true, role: 'administrateur' } });
    await refuse('INST-BANC-3b. banc dans les en-têtes (x-banc, x-rat-market-banc, x-admin) : 429', avec(marqueurs.cookie, { 'x-banc': '1', 'x-rat-market-banc': 'true', 'x-admin': '1' }));
    const valide = await compte(BANC);
    await refuse('INST-BANC-3c. session banc valide mais SANS les en-têtes du site : 429', { cookie: valide.cookie });
    await refuse('INST-BANC-3d. session banc valide, origine étrangère : 429', { cookie: valide.cookie, origin: 'https://exemple.invalid', 'x-rat-market': '1' });
    await refuse('INST-BANC-3e. session banc valide, Origin du site mais X-Rat-Market absent : 429', { cookie: valide.cookie, origin: site.origin });
    await refuse('INST-BANC-3f. session banc valide avec un Bearer en plus (la requête d\'une installation) : 429', avec(valide.cookie, { authorization: `Bearer ${J.genererJeton()}` }));
    const sansCookie = await refuse('INST-BANC-3g. banc dans l\'URL (?banc=1) : 429', {});
    {
        const ipn = await saturer(ipNeuve()), r = await H.appel(srv.url, '/api/installation?banc=1&exempte=1', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: A.ip(ipn) });
        H.v('     (idem, requête réelle avec paramètres)', [r.statut, code(r)], [429, 'DEBIT']);
    }
    void sansCookie;

    // le drapeau éteint : la session banc la plus valide ne change rien
    await refuse('INST-BANC-4a. drapeau éteint (V2_INSTALLATION_BANC_EXEMPTE absent) : 429 même avec la session banc valide', avec(valide.cookie), { url: srvEteint.url });
    H.v('INST-BANC-4b. le drapeau est éteint par défaut, et seul « 1 » l\'allume', [cfgEteint.installationBancExempte, lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSTALLATION_BANC_EXEMPTE: 'true' }).installationBancExempte, lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSTALLATION_BANC_EXEMPTE: '0' }).installationBancExempte, cfg.installationBancExempte], [false, false, false, true]);
    H.v('     plafond du compte banc : 50 par jour par défaut', lireConfig({ MONGODB_BASE: 'test_scratch' }).limites.installationBancJour, 50);

    // la lecture du compte qui lève : la garde ne sait pas conclure, donc la limite d'aujourd'hui s'applique (et la route ne tombe pas en 503)
    {
        const ipn = await saturer(ipNeuve());
        const proto = Object.getPrototypeOf(db.col('comptes')), vraie = proto.findOne;
        proto.findOne = function (...a) { if (String(this.collectionName).endsWith('comptes')) return Promise.reject(new Error('lecture en panne')); return vraie.apply(this, a); };
        let r; try { r = await poster(srv.url, ipn, avec(valide.cookie)); } finally { proto.findOne = vraie; }
        H.v('INST-BANC-5. lecture du compte qui lève : 429 (la limite d\'aujourd\'hui, pas un 201 ni un 503)', [r.statut, code(r)], [429, 'DEBIT']);
    }

    // ═══ 2. le SEUL état admis ═══
    {
        const ipn = await saturer(ipNeuve());
        const avant = await db.col('installations').countDocuments({});
        const a = await poster(srv.url, ipn, avec(valide.cookie));
        H.v('INST-BANC-6a. session banc valide (banc, administrateur, confirmé), en-têtes du site, IP au plafond : 201 avec un jeton', [a.statut, typeof a.json.jetonInstallation, await db.col('installations').countDocuments({}) - avant], [201, 'string', 1]);
        const b = await poster(srv.url, ipn, avec(valide.cookie));
        H.v('     une 2e et une 3e série depuis la même IP : 201 aussi (les mesures n\'attendent plus minuit)', [b.statut, (await poster(srv.url, ipn, avec(valide.cookie))).statut], [201, 201]);
        const apres = await anonyme(ipn);
        H.v('INST-BANC-6b. APRÈS les appels de banc, le 3e appel anonyme de la même IP reste 429 : les compteurs ne se mélangent pas', [apres.statut, code(apres)], [429, 'DEBIT']);
    }
    {
        // l'autre sens : deux appels de banc d'abord, l'IP garde ses deux installations anonymes (les appels de banc n'ont pas consommé inst-ip)
        const ipn = ipNeuve(), b6 = await compte(BANC);
        const m1 = await poster(srv.url, ipn, avec(b6.cookie)), m2 = await poster(srv.url, ipn, avec(b6.cookie));
        const a = await anonyme(ipn), b = await anonyme(ipn), c = await anonyme(ipn);
        H.v('INST-BANC-6c. deux appels de banc n\'entament pas le plafond de l\'IP : puis 2 anonymes passent, le 3e est 429', [m1.statut, m2.statut, a.statut, b.statut, c.statut, code(c)], [201, 201, 201, 201, 429, 'DEBIT']);
    }
    {
        // le plafond du compte banc lui-même (4 ici) : le 5e est refusé, 429 DEBIT ; il vaut par COMPTE, pas par IP
        const banc2 = await compte(BANC);
        const ips = [ipNeuve(), ipNeuve(), ipNeuve(), ipNeuve(), ipNeuve()], rs = [];
        for (const i of ips) rs.push(await poster(srv.url, i, avec(banc2.cookie)));
        H.v('INST-BANC-7. le compte banc a son propre plafond (V2_INSTALLATION_BANC_JOUR) : 4 passent, le 5e est 429 DEBIT, d\'où qu\'il vienne', [rs.map(r => r.statut), code(rs[4])], [[201, 201, 201, 201, 429], 'DEBIT']);
        const autre = await compte(BANC), ok = await poster(srv.url, ipNeuve(), avec(autre.cookie));
        H.v('     un autre compte banc a son propre compteur', ok.statut, 201);
    }
    {
        // le limiteur horaire reste pour tout le monde, banc compris (inst-req-ip : 30 par heure, rejeux compris)
        const cfg2 = lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSTALLATION_BANC_EXEMPTE: '1', V2_INSTALLATION_REQUETES_HEURE: '3', V2_INSTALLATION_BANC_JOUR: '50' });
        const s2 = await A.demarrer(cfg2), b3 = await compte(BANC), ipn = ipNeuve(), rs = [];
        for (let i = 0; i < 4; i++) rs.push(await poster(s2.url, ipn, avec(b3.cookie)));
        H.v('INST-BANC-8. inst-req-ip (requêtes par heure) reste pour le banc : la 4e requête de l\'heure est 429', [rs.map(r => r.statut), code(rs[3])], [[201, 201, 201, 429], 'DEBIT']);
        await s2.fermer();
    }
    {
        // l'idempotence reste pour le banc : le rejeu d'une même clé rend la même installation
        const b4 = await compte(BANC), cle = `banc-inst-${Date.now().toString(36)}-`.padEnd(40, 'x'), ipn = ipNeuve();
        const a = await poster(srv.url, ipn, avec(b4.cookie, { 'idempotency-key': cle })), b = await poster(srv.url, ipn, avec(b4.cookie, { 'idempotency-key': cle }));
        H.v('INST-BANC-9. l\'idempotence reste pour le banc : même clé, même installation, rejeu marqué', [a.statut, b.statut, b.json.installationId === a.json.installationId, b.entetes['idempotency-replayed']], [201, 201, true, 'true']);
    }

    await srv.fermer(); await srvEteint.fermer();
    H.bilan(); await H.fermerBac();
})().catch(async e => { console.error(e); process.exitCode = 1; try { await H.fermerBac(); } catch { /* sortie */ } });
