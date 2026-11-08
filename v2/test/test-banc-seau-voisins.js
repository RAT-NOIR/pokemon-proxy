'use strict';
// JUGE À CINQ — le POOL de candidats-5 ne dépend plus de la seule décision : décision, PUIS `analyses.voisinsModele` (capturé à l'identification pour le compte de mesure), PUIS `banc_seau_scans.candidatsModele`
// (posé après coup par POST /api/banc/seau/candidats-modele pour les scans déjà faits). Base EN MÉMOIRE, stockage MÉMOIRE, aucun réseau hors boucle locale.
// Rien d'autre ne change : mêmes champs servis, liste fermée du clic, mode, ordre affiché, chaîne du seau.
const H = require('./_harnais');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const S = require('../banc/stockage');
const { creerCatalogue } = require('../identifier/catalogue');

const cfgOn = lireConfig({ MONGODB_BASE: 'test_scratch', V2_BANC_SEAU: '1' });
const cfgOff = lireConfig({ MONGODB_BASE: 'test_scratch' });
const detail = r => r.json && r.json.erreur && r.json.erreur.detail;
const oid = () => new mongoose.Types.ObjectId();
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };
const PHOTO = () => sharp(crypto.randomBytes(400 * 560 * 3), { raw: { width: 400, height: 560, channels: 3 } }).jpeg({ quality: 80 }).toBuffer();
const sansMelange = l => l.slice();         // l'ordre servi = l'ordre du pool : on lit le POOL lui-même

(async () => {
    await H.ouvrirBac('test-banc-seau-voisins.js'); await M.creerIndex();
    const { creerSeaux } = require('../banc/seau');
    const memoire = S.creerStockageMemoire(S.CLE_SEAU);
    const reel = creerCatalogue({ cfg: cfgOn, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const IDS = [2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008];
    for (const [i, id] of IDS.entries()) {
        await db.col('catalogue_produits').insertOne({ idProduct: id, name: 'Pikachu', idMetacard: id });
        await db.col('numeros_cartes').insertOne({ idProduct: id, slugSet: `Set-${i}`, slug: `Pikachu-${id}`, numero: String(10 + i) });
        await db.col('guide_prix').insertOne({ idProduct: id, trend: 50 - i, low: 50 - i, avg7: 50 - i, avg30: 50 - i, guideDu: new Date() });
    }
    const ancres = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-ancres-'));
    const monterAvec = async (cfg = cfgOn) => {
        const seaux = creerSeaux({ cfg, stockage: memoire, horloge: () => new Date(), catalogue: reel, ancresDir: ancres, melanger: sansMelange });
        const app = express(); app.use(express.json());
        const router = express.Router();
        monterBanc.routes(router, cfg, { banc: {}, purge: { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) }, seaux });
        app.use(router);
        return H.serveur(app);
    };
    const sv = await monterAvec(), svOff = await monterAvec(cfgOff);
    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie: true }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), compteId: c._id, generation: 0 });
        return { c, jeton, porteur: `compte:${c._id}` };
    }
    const ADM = await acteur({ role: 'administrateur' }), ADM2 = await acteur({ role: 'administrateur' }), USR = await acteur({});
    const auth = a => (a ? { authorization: `Bearer ${a.jeton}` } : {});
    const post = (s, a, chemin, corps) => H.appel(s.url, chemin, { methode: 'POST', corps, entetes: auth(a) });
    const envoyer = async (s, a, chemin, corps) => { const r = await fetch(s.url + chemin, { method: 'POST', headers: { 'content-type': 'image/jpeg', ...auth(a) }, body: corps }); return r.status; };
    // un scan dont la DÉCISION enregistrée est celle donnée (idProduct de la carte, choix de la question) et, éventuellement, les voisins capturés
    const semerScan = async (a, { carteId = null, choix = [], voisinsModele } = {}) => {
        const _id = oid();
        const carte = { idProduct: carteId, statut: carteId ? 'identifiee' : 'introuvable', raison: null, etat: null, question: choix.length ? { code: 'q', choix: choix.map(idProduct => ({ idProduct })) } : null, zone: null };
        await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: carteId ? 'identifiee' : 'introuvable', cartes: [carte], produits: [], facturation: { motif: 'administrateur' }, versionChaine: 'abc123def456', versionModele: 'modele-x', creeLe: new Date(), expireLe: new Date(Date.now() + 864e5), ...(voisinsModele ? { voisinsModele } : {}) });
        return String(_id);
    };
    let juge;
    await essayer('mise en place', async () => {
        const r = await post(sv, ADM, '/api/banc/seau/declarer', { nom: 'juge-voisins', type: 'juge', cible: 12 });
        juge = r.json.seau; H.v('0. le juge est déclaré', [r.statut, juge.type], [201, 'juge']);
    });
    const ranger = async (a, o) => { const s = await semerScan(a, o); await envoyer(sv, a, `/api/banc/seau/photo?scanId=${s}&photo=0&seau=${juge.id}&annonce=${sha(s)}`, await PHOTO()); return s; };
    const ids = async (s, a = ADM) => { const r = await post(sv, a, '/api/banc/seau/candidats-5', { scanId: s }); return r.json && r.json.candidats ? r.json.candidats.map(c => c.idProduct) : null; };

    // ══ 1. le POOL : décision d'abord, puis les voisins du modèle capturés
    await essayer('pool', async () => {
        const sIntrouvable = await ranger(ADM, { voisinsModele: [2005, 2003, 2001, 2004, 2002, 2006] });
        H.v('1a. 🔑 une analyse INTROUVABLE (aucune décision) qui porte voisinsModele : 5 candidats, les 5 premiers des voisins dans l\'ordre', await ids(sIntrouvable), [2005, 2003, 2001, 2004, 2002]);
        const sAffirmee = await ranger(ADM, { carteId: 2007, voisinsModele: [2001, 2002, 2003, 2004, 2005] });
        H.v('1b. 🔑 la DÉCISION passe avant les voisins : 2007 (décision) puis 2001..2004', await ids(sAffirmee), [2007, 2001, 2002, 2003, 2004]);
        const sDoublon = await ranger(ADM, { carteId: 2002, choix: [2002, 2003], voisinsModele: [2003, 2002, 2005, 2004, 2001, 2006, 2007] });
        H.v('1c. dédoublonné : décision 2002, choix 2003, puis voisins 2005, 2004, 2001', await ids(sDoublon), [2002, 2003, 2005, 2004, 2001]);
        const sInconnu = await ranger(ADM, { voisinsModele: [999991, 2004, 999992, 2003, 2002, 2001, 2005] });
        H.v('1d. un produit absent du catalogue est filtré (puis les 5 premiers restants)', await ids(sInconnu), [2004, 2003, 2002, 2001, 2005]);
        const sCourt = await ranger(ADM, { voisinsModele: [2001, 2002] });
        H.v('1e. 🔑 un pool de 2 reste de 2 : aucun candidat inventé', await ids(sCourt), [2001, 2002]);
        const sVide = await ranger(ADM, {});
        H.v('1f. sans décision, sans voisins, sans rétro : 0 candidat (comme avant)', await ids(sVide), []);
        const sMal = await ranger(ADM, { voisinsModele: ['2001', null, 1.5, -3, 2002] });
        H.v('1g. des voisins mal formés (chaîne, null, flottant, négatif) sont ignorés ; seul l\'entier valide reste', await ids(sMal), [2002]);
        const r = await post(sv, ADM, '/api/banc/seau/candidats-5', { scanId: sIntrouvable });
        H.v('1h. la réponse garde ses clés et ses champs (rien de voisinsModele n\'est servi)', [Object.keys(r.json).sort(), r.json.candidats.map(c => Object.keys(c).sort().join()), JSON.stringify(r.json).includes('voisinsModele')], [['candidats', 'mode', 'success'], Array(5).fill('idProduct,nom,numero,set,version,visuel'), false]);
        const vue = await db.col('banc_seau_vues').find({ scanId: sIntrouvable }).toArray();
        H.v('1i. la vue enregistrée porte l\'ordre servi, comme avant', [vue[vue.length - 1].mode, vue[vue.length - 1].ids], ['candidats-5', [2005, 2003, 2001, 2004, 2002]]);
        const v = await post(sv, ADM, '/api/banc/seau/verite', { scanId: sIntrouvable, idProduct: 2003, via: 'candidat5', mode: 'candidats-5' });
        H.v('1j. le clic sur un candidat venu des voisins est accepté (la liste fermée est la vue servie)', [v.statut, (await db.col('banc_seau_verites').findOne({ scanId: sIntrouvable })).ordreAffiche], [200, [2005, 2003, 2001, 2004, 2002]]);
        const hors = await post(sv, ADM, '/api/banc/seau/verite', { scanId: sAffirmee, idProduct: 2005, via: 'candidat5', mode: 'candidats-5' });
        H.v('1k. 2005 est un voisin mais le 6e du pool de ce scan : hors liste', [hors.statut, detail(hors)], [409, 'candidat-hors-liste']);
    });

    // ══ 2. la RÉTRO : POST /api/banc/seau/candidats-modele
    await essayer('rétro', async () => {
        const natif = (await H.appel(sv.url, '/api/banc/route-qui-nexiste-pas', { entetes: auth(ADM) })).statut;
        const s = await ranger(ADM, {});
        const poser = (corps, a = ADM, serveur = sv) => post(serveur, a, '/api/banc/seau/candidats-modele', corps);
        H.v('2a. simple utilisateur : 404 natif', (await poser({ scanId: s, ids: [2001] }, USR)).statut, natif);
        H.v('2b. sans jeton : 401', (await poser({ scanId: s, ids: [2001] }, null)).statut, 401);
        H.v('2c. drapeau éteint (même l\'administrateur) : 404 natif', (await poser({ scanId: s, ids: [2001] }, ADM, svOff)).statut, natif);
        H.v('2d. le scan d\'un AUTRE administrateur : 404, rien d\'écrit', [(await poser({ scanId: s, ids: [2001] }, ADM2)).statut, (await db.col('banc_seau_scans').findOne({ scanId: s })).candidatsModele], [404, undefined]);
        for (const [nom, corps] of [['ids absent', { scanId: s }], ['ids vide', { scanId: s, ids: [] }], ['21 ids', { scanId: s, ids: Array.from({ length: 21 }, (_, i) => 3000 + i) }], ['id chaîne', { scanId: s, ids: ['2001'] }], ['id flottant', { scanId: s, ids: [1.5] }], ['id nul', { scanId: s, ids: [0] }], ['id négatif', { scanId: s, ids: [-4] }],
            ['id null', { scanId: s, ids: [null] }], ['ids non tableau', { scanId: s, ids: 2001 }], ['champ inconnu', { scanId: s, ids: [2001], rang: 1 }], ['scanId mal formé', { scanId: 'zz', ids: [2001] }], ['doublon', { scanId: s, ids: [2001, 2001] }]]) {
            H.v(`2e. ${nom} : 400, rien d'écrit`, [(await poser(corps)).statut, (await db.col('banc_seau_scans').findOne({ scanId: s })).candidatsModele], [400, undefined]);
        }
        const ok = await poser({ scanId: s, ids: [2004, 2002, 2006, 2001, 2003, 2005] });
        const ligne = await db.col('banc_seau_scans').findOne({ scanId: s });
        H.v('2f. 🔑 posé : 200, candidatsModele + candidatsModeleLe sur la ligne du scan', [ok.statut, ligne.candidatsModele, ligne.candidatsModeleLe instanceof Date], [200, [2004, 2002, 2006, 2001, 2003, 2005], true]);
        H.v('2g. 🔑 le pool de candidats-5 lit la rétro : les 5 premiers', await ids(s), [2004, 2002, 2006, 2001, 2003]);
        const memeLe = ligne.candidatsModeleLe.getTime();
        const encore = await poser({ scanId: s, ids: [2004, 2002, 2006, 2001, 2003, 2005] });
        H.v('2h. 🔑 idempotent si identique : 200, la date posée ne bouge pas', [encore.statut, (await db.col('banc_seau_scans').findOne({ scanId: s })).candidatsModeleLe.getTime()], [200, memeLe]);
        const autre = await poser({ scanId: s, ids: [2001, 2002] });
        H.v('2i. 🔑 différent : 409 deja-pose, la liste posée est intacte', [autre.statut, detail(autre), (await db.col('banc_seau_scans').findOne({ scanId: s })).candidatsModele], [409, 'deja-pose', [2004, 2002, 2006, 2001, 2003, 2005]]);
        // l'ordre : décision, puis voisins capturés, puis rétro
        const t = await ranger(ADM, { carteId: 2008, voisinsModele: [2001, 2002] });
        await poser({ scanId: t, ids: [2003, 2004, 2005, 2006] });
        H.v('2j. 🔑 ordre du pool : décision (2008), voisins capturés (2001, 2002), puis rétro (2003, 2004)', await ids(t), [2008, 2001, 2002, 2003, 2004]);
        const unique = await ranger(ADM, {});
        const [a1, a2] = await Promise.all([poser({ scanId: unique, ids: [2001, 2002] }), poser({ scanId: unique, ids: [2003, 2004] })]);
        H.v('2k. deux poses concurrentes différentes : exactement une gagne (200 et 409)', [a1.statut, a2.statut].sort(), [200, 409]);
        const ver = await H.appel(sv.url, `/api/banc/seau/verifier?seau=${juge.id}`, { entetes: auth(ADM) });
        H.v('2l. 🔑 la chaîne du seau se relit sans problème : la rétro n\'entre dans aucune empreinte', [ver.statut, ver.json.problemes.map(p => p.cause).filter(c => c !== 'non-ancre')], [200, []]);
    });

    await sv.fermer(); await svOff.fermer();
    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
