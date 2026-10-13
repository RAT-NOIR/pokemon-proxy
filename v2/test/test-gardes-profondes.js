'use strict';
// O3 (tour 1, I-5) — les gardes PROFONDES « compte vérifié » (collection : exigerVerifie ; scanner et identification : le refus d'argent VERIFICATION du grand livre).
// Depuis O3, porteur.js ne résout plus un compte non confirmé : aucune requête réelle n'atteint ces gardes. Ce banc les rejoue avec un RÉSOLVEUR DE PORTEUR SANS la garde (posé
// dans le banc seulement, AVANT le chargement des routes, qui destructurent `resoudrePorteur` à leur chargement) : la garde de porteur.js reste en production, et si quelqu'un
// la retirait un jour, ces trois gardes tiendraient encore. Une copie mutée d'une garde profonde fait tomber ce banc.
const P = require('../porteur'); const origResoudre = P.resoudrePorteur;
const H = require('./_harnais');
const { col } = require('../db'); const J = require('../comptes/jetons'); const S = require('../comptes/sessions');
P.resoudrePorteur = cfg => {
    const f = origResoudre(cfg);
    return async function resoudreSansGarde(req, res, next) {
        await f(req, res, () => { });
        const p = req.v2.porteur;
        if (!p || (p.type === 'installation' && p.installation && p.installation.compteId)) {   // le résolveur réel a refusé le compte : on le rend même non confirmé (c'est tout l'écart avec la production)
            const auth = req.get('authorization'), m = auth && /^Bearer ([A-Za-z0-9_-]{20,64})$/.exec(auth);
            if (m) {
                const inst = await col('installations').findOne({ jetonEmpreinte: J.empreinte(m[1]) });
                const c = inst && !inst.revoqueeLe && inst.compteId ? await col('comptes').findOne({ _id: inst.compteId }) : null;
                if (c) { req.v2.porteur = { type: 'compte', id: c._id, compte: c, installation: inst, surface: 'extension', administrateur: false }; req.v2.echec = null; }
            } else {
                const tok = S.lireCookie(req), s = tok && await col('sessions').findOne({ tokenEmpreinte: J.empreinte(tok) });
                const c = s && await col('comptes').findOne({ _id: s.compteId });
                if (c) { req.v2.porteur = { type: 'compte', id: c._id, compte: c, installation: null, surface: 'scanner', administrateur: false }; req.v2.echec = null; }
            }
        }
        next();
    };
};
const crypto = require('crypto'); const express = require('express');
const M = require('../modeles'); const pret = require('../pret'); const { lireConfig } = require('../config');
(async () => {
    await H.ouvrirBac('test-gardes-profondes.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const { assembler } = require('../index'); const cors = require('../transport/cors'); const { dansUnScan } = require('../../sources');
    let appelsChaine = 0;
    const chaine = async () => { appelsChaine++; throw new Error('la chaîne ne doit pas être atteinte'); };
    const app = express(); app.set('trust proxy', true); app.use(cors.middlewareV2(cfg)); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
    pret.armer(M.verifierIndex);
    app.use(assembler([require('../argent/monter'), require('../identifier/monter'), require('../scanner/monter'), require('../collection/monter')], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine }));
    const srv = await H.serveur(app);
    let n = 0; const ip = () => ({ 'x-forwarded-for': `10.4.${Math.floor(++n / 250)}.${n % 250 + 1}` });
    const SITE = { origin: cfg.origines.site, 'x-rat-market': '1' };
    const nv = async () => {
        const c = Object.assign(M.nouveauCompte({ email: `g${++n}@x.fr`, emailCle: `g${n}@x.fr`, motDePasse: {} }), { solde: { accueil: 25, achete: 0 } });   // verifie:false, 25 « accueil » écrits en base
        await col('comptes').insertOne(c); const s = await S.creerSession(c._id); return { c, cookie: `rm_session=${s.token}` };
    };
    const nMouv = () => col('mouvements').countDocuments({});

    // 1. collection : exigerVerifie
    {
        const a = await nv(); const n0 = await col('collection_fiches').countDocuments({}), m0 = await nMouv();
        const r = await H.appel(srv.url, '/api/collection/sets/Set-A/fiches/' + encodeURIComponent('1|001'), { methode: 'PUT', corps: { possedee: true }, entetes: { ...SITE, ...ip(), cookie: a.cookie } });
        H.v('G1. collection (résolveur sans garde) : compte non confirmé, 403 VERIFICATION, rien d\'écrit', [r.statut, r.json && r.json.erreur && r.json.erreur.code, (await col('collection_fiches').countDocuments({})) - n0], [403, 'VERIFICATION', 0]);
        void m0;
    }
    // 2. scanner : le refus d'argent du grand livre
    {
        const sharp = require('sharp'); const jpeg = await sharp(crypto.randomBytes(24 * 24 * 3), { raw: { width: 24, height: 24, channels: 3 } }).jpeg().toBuffer();
        const a = await nv(); const m0 = await nMouv();
        const f = new FormData(); f.append('source', 'camera'); f.append('image', new Blob([jpeg], { type: 'image/jpeg' }), 'photo.jpg');
        const r = await fetch(srv.url + '/api/scanner/analyses', { method: 'POST', body: f, headers: { cookie: a.cookie, origin: cfg.origines.site, 'x-rat-market': '1', ...ip() } });
        const j = await r.json().catch(() => null);
        const apres = await col('comptes').findOne({ _id: a.c._id });
        H.v('G2. scanner (résolveur sans garde) : compte non confirmé avec 25 « accueil » en base, 403 VERIFICATION, rien débité, chaîne non appelée', [r.status, j && j.erreur && j.erreur.code, apres.solde.accueil, (await nMouv()) - m0, appelsChaine], [403, 'VERIFICATION', 25, 0, 0]);
    }
    // 3. identification : installation liée à un compte non confirmé
    {
        const a = await nv(); const jeton = J.genererJeton();
        await col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 0, libelle: 'ext' }), compteId: a.c._id });
        const m0 = await nMouv();
        const r = await H.appel(srv.url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [require('../../verrou/charges.json').charges.find(c => c.cellule === 'occidentale').imageUrl],title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' },
            entetes: { origin: cfg.origines.extension, authorization: `Bearer ${jeton}`, 'idempotency-key': `prof-${Date.now()}`, ...ip() } });
        H.v('G3. identification (résolveur sans garde) : installation liée à un compte non confirmé, 403 VERIFICATION, rien débité, chaîne non appelée', [r.statut, r.json && r.json.erreur && r.json.erreur.code, (await nMouv()) - m0, appelsChaine], [403, 'VERIFICATION', 0, 0]);
    }
    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
