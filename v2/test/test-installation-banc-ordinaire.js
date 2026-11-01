'use strict';
// COMPTE-TEST (01/11) — l'exemption de la limite « 2 installations par IP et par jour » (inst-ip) du compte de test ORDINAIRE, et RIEN d'autre. Elle touche une garde de sécurité : écrite par ce qu'elle AUTORISE.
// Un seul chemin mène à « exempté » pour ce compte : drapeau allumé + en-têtes du site + session valide + compte LU EN BASE qui est à la fois banc === true, bancOrdinaire === true, confirmé, SANS rôle, à l'adresse
// réservée banc-ordinaire@rat-market.invalid (la liste fermée : jamais l'adresse seule, jamais la marque seule) + la base de l'ESSAI (rm_essai ; test_scratch sous BANC_ISOLE=1 pour les bancs).
// Base EN MÉMOIRE, routes RÉELLES (assembleur du socle) ; la base « de l'essai » est injectée (deps.nomBase) pour jouer le refus hors essai.
const express = require('express');
const H = require('./_harnais'); const A = require('./_b2-aide'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const S = require('../comptes/sessions'); const J = require('../comptes/jetons'); const pret = require('../pret'); const { verifierIndex } = require('../modeles');
const Lg = require('../argent/ledger'); const Of = require('../argent/offre');
const EX = require('../installations/exemption-banc');

const ADR = 'banc-ordinaire@rat-market.invalid';
(async () => {
    await H.ouvrirBac('test-installation-banc-ordinaire.js'); await M.creerIndex();
    H.fixerHorlogeMilieu();
    A.registre.fournir('argent', { solde: async p => ({ total: p.installation ? p.installation.essais : 0, essai: p.installation ? p.installation.essais : 0 }), offre: () => null, reprendreHeritage: async () => ({ ok: false, raison: 'inconnu' }) });
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_INSTALLATION_BANC_EXEMPTE: '1', V2_INSTALLATION_BANC_JOUR: '4' });
    const cfgEteint = lireConfig({ MONGODB_BASE: 'test_scratch' });
    // une app dont la « base de l'essai » est celle qu'on lui dit (deps.nomBase) ; sans elle, le nom RÉEL de la base connectée
    const demarrerAvec = async (c, deps = {}) => {
        const app = express(); app.set('trust proxy', true); app.use(express.json());
        const { assembler } = require('../index'); pret.armer(verifierIndex);
        app.use(assembler([require('../installations/monter'), require('../comptes/monter')], c, deps));
        return H.serveur(app);
    };
    const srv = await demarrerAvec(cfg), srvEteint = await demarrerAvec(cfgEteint);
    const srvEssai = await demarrerAvec(cfg, { nomBase: () => 'rm_essai' });
    const srvProd = await demarrerAvec(cfg, { nomBase: () => 'test' });
    let nIp = 0; const ipNeuve = () => ++nIp;
    const code = r => r.json && r.json.erreur && r.json.erreur.code;
    const site = A.SITE;
    const poster = (url, ipn, entetes = {}) => H.appel(url, '/api/installation', { methode: 'POST', corps: { versionExtension: '2.0.0' }, entetes: { ...A.ip(ipn), ...entetes } });
    const saturer = async (ipn, url) => { const a = await poster(url, ipn), b = await poster(url, ipn); if (a.statut !== 201 || b.statut !== 201) throw new Error('saturation impossible'); return ipn; };
    let n = 0;
    const compte = async (o = {}) => {
        const adresse = o.adresse || `essai-${++n}@rat-market.invalid`; const { adresse: _a, ...reste } = o;
        const c = Object.assign(M.nouveauCompte({ email: adresse, emailCle: adresse, motDePasse: {} }), { verifie: true }, reste);
        await db.col('comptes').insertOne(c);
        const s = await S.creerSession(c._id);
        return { c, cookie: `rm_session=${s.token}`, token: s.token };
    };
    // le compte de test tel que l'outil le crée : adresse réservée, confirmé, banc, bancOrdinaire, aucun rôle. L'adresse étant unique (index), on libère l'ancien avant d'en créer un neuf.
    const exactNeuf = async (extra = {}) => { await db.col('comptes').deleteMany({ emailCle: ADR }); return compte({ adresse: ADR, banc: true, bancOrdinaire: true, ...extra }); };
    const avec = (cookie, extra = {}) => ({ cookie, ...site, ...extra });
    const refuse = async (nom, entetes, url = srvEssai.url) => { const ipn = await saturer(ipNeuve(), url), r = await poster(url, ipn, entetes); H.v(nom, [r.statut, code(r)], [429, 'DEBIT']); };

    // ═══ 1. la garde dit NON sur chaque état fabriqué (base de l'essai, IP au plafond : un NON se lit en 429, un OUI en 201) ═══
    await refuse('ORD-1a. un compte ordinaire QUELCONQUE n\'est pas exempté : 429', avec((await compte()).cookie));
    await refuse('ORD-1b. banc: true seul (sans bancOrdinaire, sans rôle) : 429', avec((await compte({ banc: true })).cookie));
    await refuse('ORD-1c. bancOrdinaire: true sans banc: true (autre adresse) : 429', avec((await compte({ bancOrdinaire: true })).cookie));
    await refuse('ORD-1d. les deux marques mais une AUTRE adresse (la liste est fermée : marques ET adresse) : 429', avec((await compte({ banc: true, bancOrdinaire: true })).cookie));
    await refuse('ORD-1e. la bonne adresse SANS marque (l\'adresse seule ne désigne rien) : 429', avec((await exactNeuf({ banc: undefined, bancOrdinaire: undefined })).cookie));
    await refuse('ORD-1f. une adresse voisine (banc-ordinaire2@…) avec les deux marques : 429', avec((await compte({ adresse: 'banc-ordinaire2@rat-market.invalid', banc: true, bancOrdinaire: true })).cookie));
    await refuse('ORD-1g. bancOrdinaire non strictement true (texte "true"), bonne adresse : 429', avec((await exactNeuf({ bancOrdinaire: 'true' })).cookie));
    await refuse('ORD-1h. banc non strictement true (texte "true"), bonne adresse : 429', avec((await exactNeuf({ banc: 'true' })).cookie));
    await refuse('ORD-1i. banc seul sur la bonne adresse (pas de bancOrdinaire) : 429', avec((await exactNeuf({ bancOrdinaire: undefined })).cookie));
    await refuse('ORD-1j. bancOrdinaire seul sur la bonne adresse (pas de banc) : 429', avec((await exactNeuf({ banc: undefined })).cookie));
    {   // le compte exact, abîmé d'un cran à la fois
        const exact = await exactNeuf();
        const etat = async (nom, $set, $unset) => { await db.col('comptes').updateOne({ _id: exact.c._id }, { ...($set ? { $set } : {}), ...($unset ? { $unset } : {}) }); await refuse(nom, avec(exact.cookie)); };
        await etat('ORD-2a. le compte exact mais NON vérifié : 429', { verifie: false });
        await etat('ORD-2b. le compte exact avec un rôle « admin » (tout rôle faux) : 429', { verifie: true, role: 'admin' });
        await etat('ORD-2c. le compte exact avec un autre rôle (moderateur) : 429 — la liste ne contient aucun compte à rôle', { role: 'moderateur' });
        await etat('ORD-2d. le compte exact avec un rôle vide ("") : 429', { role: '' });
        await etat('ORD-2e. le compte exact, bancOrdinaire: false : 429', { bancOrdinaire: false }, { role: '' });
        await db.col('comptes').updateOne({ _id: exact.c._id }, { $set: { bancOrdinaire: true }, $inc: { generation: 1 } });
        await refuse('ORD-2f. le compte exact, session d\'une génération révolue : 429', avec(exact.cookie));
        await db.col('sessions').deleteMany({ tokenEmpreinte: J.empreinte(exact.token) });
        await refuse('ORD-2g. le compte exact, session supprimée : 429', avec(exact.cookie));
    }

    // sessions, en-têtes, drapeau : comme pour le compte de mesure
    const ok1 = await exactNeuf();
    await refuse('ORD-3a. le compte exact SANS les en-têtes du site : 429', { cookie: ok1.cookie });
    await refuse('ORD-3b. origine étrangère : 429', { cookie: ok1.cookie, origin: 'https://exemple.invalid', 'x-rat-market': '1' });
    await refuse('ORD-3c. Origin du site mais X-Rat-Market absent : 429', { cookie: ok1.cookie, origin: site.origin });
    await refuse('ORD-3d. avec un Bearer en plus (la requête d\'une installation) : 429', avec(ok1.cookie, { authorization: `Bearer ${J.genererJeton()}` }));
    await refuse('ORD-3e. cookie forgé : 429', avec(`rm_session=${J.genererJeton()}`));
    await refuse('ORD-3f. marqueurs dans le corps ou les en-têtes (x-banc, x-banc-ordinaire) sur un compte ordinaire : 429', avec((await compte()).cookie, { 'x-banc': '1', 'x-banc-ordinaire': 'true' }));
    await db.col('sessions').updateOne({ tokenEmpreinte: J.empreinte(ok1.token) }, { $set: { expireLe: new Date(Date.now() - 1000) } });
    await refuse('ORD-3g. session expirée : 429', avec(ok1.cookie));
    const ok2 = await exactNeuf();
    await refuse('ORD-4a. drapeau ÉTEINT (V2_INSTALLATION_BANC_EXEMPTE absent) : 429 même pour le compte exact', avec(ok2.cookie), srvEteint.url);

    // la base : l'exemption est INOPÉRANTE hors de la base de l'essai
    await refuse('ORD-5a. base de PRODUCTION (nom « test ») : 429 — l\'exemption est inopérante en production', avec(ok2.cookie), srvProd.url);
    for (const [nom, f] of [['cartes', () => 'cartes'], ['rm_essai2', () => 'rm_essai2'], ['RM_ESSAI', () => 'RM_ESSAI'], ['undefined', () => undefined], ['un nombre', () => 42], ['une lecture qui lève', () => { throw new Error('boum'); }], ['chaîne vide', () => '']]) {
        const s = await demarrerAvec(cfg, { nomBase: f });
        await refuse(`ORD-5b. base « ${nom} » : 429`, avec(ok2.cookie), s.url);
        await s.fermer();
    }
    H.v('ORD-5c. baseDeLEssai (pure) : rm_essai oui ; test, cartes, rm_essai2, vide, non texte non ; test_scratch seulement sous BANC_ISOLE=1',
        [EX.baseDeLEssai('rm_essai', {}), EX.baseDeLEssai('test', { BANC_ISOLE: '1' }), EX.baseDeLEssai('cartes', {}), EX.baseDeLEssai('rm_essai2', {}), EX.baseDeLEssai('', {}), EX.baseDeLEssai(undefined, {}), EX.baseDeLEssai('test_scratch', {}), EX.baseDeLEssai('test_scratch', { BANC_ISOLE: '1' }), EX.baseDeLEssai('test_scratch', { BANC_ISOLE: 'true' })],
        [true, false, false, false, false, false, false, true, false]);

    {   // la liste fermée, jugée en PURE : chaque condition seule (la résolution de session en double déjà quelques-unes : confirmé, génération ; ici rien n'est supposé de la route)
        const bon = { banc: true, bancOrdinaire: true, verifie: true, emailCle: ADR };
        const cas = [['complet', bon, true], ['banc false', { ...bon, banc: false }, false], ['banc "true"', { ...bon, banc: 'true' }, false], ['banc absent', { ...bon, banc: undefined }, false], ['bancOrdinaire absent', { ...bon, bancOrdinaire: undefined }, false], ['bancOrdinaire 1', { ...bon, bancOrdinaire: 1 }, false],
            ['non confirmé', { ...bon, verifie: false }, false], ['verifie absent', { ...bon, verifie: undefined }, false], ['verifie "true"', { ...bon, verifie: 'true' }, false], ['rôle administrateur', { ...bon, role: 'administrateur' }, false], ['rôle vide', { ...bon, role: '' }, false], ['rôle null admis (absent)', { ...bon, role: null }, true],
            ['autre adresse', { ...bon, emailCle: 'autre@rat-market.invalid' }, false], ['adresse absente', { ...bon, emailCle: undefined }, false], ['adresse en majuscules (clé non normalisée)', { ...bon, emailCle: ADR.toUpperCase() }, false], ['null', null, false], ['undefined', undefined, false]];
        H.v('ORD-5d. estCompteDeTestOrdinaire (pure) : le compte complet oui ; chaque condition retirée ou abîmée non', cas.map(([nom, c]) => [nom, EX.estCompteDeTestOrdinaire(c)]), cas.map(([nom, , att]) => [nom, att]));
    }

    // ═══ 2. le SEUL état admis ═══
    {
        const bon = await exactNeuf();
        const ipn = await saturer(ipNeuve(), srvEssai.url);
        const avant = await db.col('installations').countDocuments({});
        const a = await poster(srvEssai.url, ipn, avec(bon.cookie));
        H.v('ORD-6a. le compte de test (marques + adresse + confirmé + sans rôle), base de l\'essai, IP au plafond : 201 avec un jeton', [a.statut, typeof a.json.jetonInstallation, await db.col('installations').countDocuments({}) - avant], [201, 'string', 1]);
        const anon = await poster(srvEssai.url, ipn);
        H.v('ORD-6b. APRÈS, le 3e appel anonyme de la même IP reste 429 : les compteurs ne se mélangent pas', [anon.statut, code(anon)], [429, 'DEBIT']);
        const reel = await poster(srv.url, await saturer(ipNeuve(), srv.url), avec(bon.cookie));
        H.v('ORD-6c. même compte, sur la base RÉELLE des bancs (test_scratch sous BANC_ISOLE=1) : 201 aussi', reel.statut, 201);
        const cx = await exactNeuf();
        const rs = []; for (let i = 0; i < 5; i++) rs.push(await poster(srvEssai.url, ipNeuve(), avec(cx.cookie)));
        H.v('ORD-7. le compte de test a son propre plafond (V2_INSTALLATION_BANC_JOUR) : 4 passent, le 5e est 429 DEBIT, d\'où qu\'il vienne', [rs.map(r => r.statut), code(rs[4])], [[201, 201, 201, 201, 429], 'DEBIT']);
    }

    // ═══ 3. RIEN d'autre : le compte de test n'est pas administrateur, et il est débité ═══
    const t = await exactNeuf({ solde: { accueil: 0, achete: 0 } });
    const porteur = { type: 'compte', id: t.c._id, compte: t.c, installation: null, surface: 'scanner', administrateur: t.c.role === 'administrateur' };
    H.v('ORD-8a. le compte de test n\'est pas administrateur : aucun rôle, estAdministrateur faux', [t.c.role, Of.estAdministrateur(porteur, t.c), porteur.administrateur], [undefined, false, false]);
    const cfgQuota = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const jour = new Date('2026-10-08T10:00:00Z');
    const d = await Lg.debiter(porteur, { scanId: 'ord-1', cleIdempotence: 'ord-1', maintenant: jour }, cfgQuota);
    const mv = await db.col('mouvements').findOne({ scanId: 'ord-1' });
    H.v('ORD-8b. il est DÉBITÉ comme un compte gratuit : un mouvement de débit -1 (pas « administrateur », pas 0)', [d.ok, d.administrateur === true, mv && mv.type, mv && mv.delta, mv && mv.motif === 'administrateur'], [true, false, 'debit', -1, false]);
    const adminBanc = await compte({ banc: true, role: 'administrateur', solde: { accueil: 0, achete: 0 } });
    const da = await Lg.debiter({ type: 'compte', id: adminBanc.c._id, compte: adminBanc.c, installation: null, surface: 'scanner', administrateur: true }, { scanId: 'adm-1', cleIdempotence: 'adm-1', maintenant: jour }, cfgQuota);
    H.v('   (témoin : le compte de mesure administrateur, lui, n\'est pas débité)', [da.administrateur, (await db.col('mouvements').findOne({ scanId: 'adm-1' })).delta], [true, 0]);
    const of = await Of.offre(porteur, cfgQuota, jour);
    H.v('ORD-8c. l\'exemption ne change aucun quota : l\'offre du compte de test n\'est pas celle d\'un Pro ni d\'un administrateur', [of.administrateur === true, of.nom !== 'pro'], [false, true]);
    H.v('ORD-8d. la liste fermée : une adresse réservée .invalid, exportée par exemption-banc.js et reprise telle quelle par l\'outil de création', [EX.ADRESSE_ORDINAIRE, EX.ADRESSE_ORDINAIRE === require('../admin/compte-essai').ADRESSE_ORDINAIRE], [ADR, true]);

    await srv.fermer(); await srvEteint.fermer(); await srvEssai.fermer(); await srvProd.fermer();
    H.bilan(); await H.fermerBac();
})().catch(async e => { console.error(e); process.exitCode = 1; try { await H.fermerBac(); } catch { /* sortie */ } });
