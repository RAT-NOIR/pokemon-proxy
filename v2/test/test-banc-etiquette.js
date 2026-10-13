'use strict';
// ETIQUETAGE-A — POST /api/banc/etiquette : l'administrateur dit « juste » ou corrige la réponse de la chaîne ; la réponse d'origine reste à côté, intacte.
// Base : la base EN MÉMOIRE du banc. Aucun réseau, aucune base réelle. Les acteurs sont de vraies lignes (comptes, installations liées ou non).
const H = require('./_harnais');
const express = require('express');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons'); const P = require('../comptes/mots-de-passe');
const { lireConfig } = require('../config');
const monterBanc = require('../banc/monter');
const { creerCatalogue } = require('../identifier/catalogue');
const { creerStockage } = require('../banc/stockage');
const { supprimerCompte } = require('../comptes/service');

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
const code = r => r.json && r.json.erreur && r.json.erreur.code;
const oid = () => new mongoose.Types.ObjectId();

(async () => {
    // Les limiteurs comptent par fenêtre fixe (l'heure UTC) : on n'enjambe pas la frontière en pleine série.
    { const FEN = 3600e3, reste = FEN - (Date.now() % FEN); if (reste < 60e3) { console.log(`   frontière de fenêtre (1 h) dans ${Math.round(reste / 1000)} s : attente`); await new Promise(r => setTimeout(r, reste + 2000)); } }

    // ── la configuration : 600 par heure par défaut, réglable, borné
    H.v('config : défaut 600 par heure', cfg.limites.etiquetteParPorteurHeure, 600);
    H.v('config : V2_ETIQUETTE_HEURE=7 s\'applique', lireConfig({ MONGODB_BASE: 'test_scratch', V2_ETIQUETTE_HEURE: '7' }).limites.etiquetteParPorteurHeure, 7);
    for (const mal of ['abc', '0', '-1', '1.5', '100001']) { let e = null; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_ETIQUETTE_HEURE: mal }); } catch (x) { e = x.message; } H.vrai(`config : V2_ETIQUETTE_HEURE="${mal}" rend la configuration invalide`, /configuration invalide/.test(e || '')); }

    await H.ouvrirBac('test-banc-etiquette.js'); await M.creerIndex();
    const reel = creerCatalogue({ cfg, visuels: { instantane: () => ({ entree: () => ({}), resoudre: async () => null, impressions: async () => [] }) } });
    const etat = { catalogueEnPanne: false };
    const catalogue = { lire: async ids => { if (etat.catalogueEnPanne) throw Object.assign(new Error('catalogue HS'), { code: 'CAT_HS' }); return reel.lire(ids); } };
    for (const [id, nom] of [[4242, 'Pikachu'], [4343, 'Raichu'], [4444, 'Pichu']]) {
        await db.col('catalogue_produits').insertOne({ idProduct: id, name: nom, idMetacard: id });
        await db.col('numeros_cartes').insertOne({ idProduct: id, slugSet: 'Base-Set', numero: String(id % 100) });
    }

    const purgeStub = { purgerBanc: async () => ({}), anonymiserLiens: async () => ({}) };
    const app = express(); app.use(express.json());
    const router = express.Router(); monterBanc.routes(router, cfg, { banc: {}, purge: purgeStub, catalogue }); app.use(router);
    const srv = await H.serveur(app);

    // ── les acteurs
    const mdp = await P.hacher('mot-de-passe-du-banc');
    async function acteur({ role = null, lie = true, verifie = true } = {}) {
        const email = `a${oid()}@exemple.fr`;
        const c = Object.assign(M.nouveauCompte({ email, emailCle: email, motDePasse: mdp }), { verifie }, role ? { role } : {});
        await db.col('comptes').insertOne(c);
        const jeton = J.genererJeton();
        await db.col('installations').insertOne({ ...M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }), ...(lie ? { compteId: c._id, generation: 0 } : {}) });
        return { c, jeton, porteur: lie ? `compte:${c._id}` : null };
    }
    const ADM = await acteur({ role: 'administrateur' }), AUT = await acteur({ role: 'administrateur' }), USR = await acteur({}), NON_LIE = await acteur({ role: 'administrateur', lie: false });
    const instNonLiee = async () => { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'seule' }); await db.col('installations').insertOne(i); return { jeton, porteur: `installation:${i._id}` }; };
    const SEUL = await instNonLiee();

    const CARTES = () => [
        { idProduct: 4242, statut: 'identifiee', raison: null, etat: { retenu: 'NM' }, question: null, zone: null, lecture: { codeLangue: 2 } },
        { idProduct: null, statut: 'a-trancher', raison: null, etat: null, question: { choix: [{ id: 'a', idProduct: 4242 }, { id: 'b', idProduct: 4343 }] }, zone: null },
        { idProduct: null, statut: 'introuvable', raison: 'hors-catalogue', etat: null, question: null, zone: null },
        { idProduct: null, statut: 'panne', raison: null, etat: null, question: null, zone: null }
    ];
    const semer = async (a, o = {}) => { const _id = oid(); await db.col('analyses').insertOne({ _id, porteur: a.porteur, surface: 'extension', statut: 'identifiee', cartes: o.cartes || CARTES(), produits: [], facturation: { motif: 'administrateur' }, versionChaine: 'abc123def456', versionModele: 'gemini-x', creeLe: new Date(), expireLe: new Date(Date.now() + 864e5) }); return String(_id); };
    const lire = async id => db.col('analyses').findOne({ _id: new mongoose.Types.ObjectId(id) });
    const sansEtiquette = an => JSON.stringify({ ...an, cartes: an.cartes.map(({ etiquetteAdmin, ...r }) => r) });
    let n = 0; const ip = () => ({ 'x-forwarded-for': `10.9.${Math.floor(++n / 250)}.${n % 250 + 1}` });
    const post = (a, corps, entetes = {}) => H.appel(srv.url, '/api/banc/etiquette', { methode: 'POST', corps, entetes: { ...(a ? { authorization: `Bearer ${a.jeton}` } : {}), ...entetes } });
    const etiq = async (id, i = 0) => (await lire(id)).cartes[i].etiquetteAdmin;
    const snapAnalyses = async () => JSON.stringify(await db.col('analyses').find({}).sort({ _id: 1 }).toArray());

    // ═══ 1. qui entre : seul un compte administrateur RELU en base ; tout le reste est 404, rien d'écrit ═══
    {
        const S = await semer(ADM), SU = await semer(USR), SS = await semer(SEUL), SN = await semer(NON_LIE);
        const avant = await snapAnalyses();
        let r = await post(null, { scanId: S, verdict: 'juste', rev: 1 });
        H.v('1. sans Bearer ⇒ 401', r.statut, 401);
        r = await post(USR, { scanId: SU, verdict: 'juste', rev: 1 });
        H.v('1. compte non administrateur ⇒ 404 (celui d\'une route inexistante : corps non JSON), rien d\'écrit', [r.statut, code(r), await snapAnalyses() === avant], [404, undefined, true]);
        r = await post(SEUL, { scanId: SS, verdict: 'juste', rev: 1 });
        H.v('1. installation sans compte ⇒ 404, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === avant], [404, undefined, true]);
        r = await post(NON_LIE, { scanId: SN, verdict: 'juste', rev: 1 });
        H.v('1. installation NON LIÉE à un compte administrateur ⇒ 404, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === avant], [404, undefined, true]);
        r = await post(USR, { n_importe: 'quoi' });
        H.v('1. un non-administrateur au corps invalide reçoit aussi 404 (la route n\'existe pas pour lui, jamais 400)', [r.statut, code(r)], [404, undefined]);
        // F-1 : EXACTEMENT la réponse d'une route réellement inexistante (chemin normalisé : le corps natif cite le chemin demandé)
        {
            const brut = async (a, chemin) => { const x = await fetch(srv.url + chemin, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${a.jeton}` }, body: JSON.stringify({ scanId: S, verdict: 'juste', rev: 1 }) }); const texte = await x.text(); const h = Object.fromEntries(x.headers); delete h.date; delete h['content-length']; delete h.etag; return { statut: x.status, texte: texte.split(chemin).join('<CHEMIN>'), h }; };
            const vraie = await brut(USR, '/api/banc/route-inexistante');
            for (const [nom, a] of [['compte non administrateur', USR], ['installation seule', SEUL], ['installation non liée', NON_LIE]]) {
                const m = await brut(a, '/api/banc/etiquette');
                H.v(`1. F-1 ${nom} : même statut, même corps, mêmes en-têtes qu'une route inexistante`, m, vraie);
            }
            H.vrai('1. F-1 instrument : la route inexistante rend bien un 404 non JSON qui cite le chemin (le test compare quelque chose)', vraie.statut === 404 && vraie.texte.includes('<CHEMIN>'));
        }
        // rôle retiré ENTRE deux requêtes : le drapeau du porteur est relu en base à chaque requête
        const A2 = await acteur({ role: 'administrateur' }); const S2 = await semer(A2);
        r = await post(A2, { scanId: S2, verdict: 'juste', rev: 1 });
        H.v('1. administrateur : 200 écrit', [r.statut, r.json && r.json.etat], [200, 'ecrit']);
        await db.col('comptes').updateOne({ _id: A2.c._id }, { $unset: { role: '' } });
        const mid = await snapAnalyses();
        r = await post(A2, { scanId: S2, verdict: 'corrige', idProduct: 4343, rev: 2 });
        H.v('1. rôle retiré entre deux requêtes ⇒ 404 et rien d\'écrit', [r.statut, code(r), await snapAnalyses() === mid], [404, undefined, true]);
    }

    // ═══ 2. le scan : du MÊME porteur, la carte existe ═══
    {
        const SA = await semer(AUT), S = await semer(ADM);
        const avant = await snapAnalyses();
        let r = await post(ADM, { scanId: SA, verdict: 'juste', rev: 1 });
        H.v('2. scan d\'un autre porteur ⇒ 404, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === avant], [404, 'CODE_INVALIDE', true]);
        r = await post(ADM, { scanId: String(oid()), verdict: 'juste', rev: 1 });
        H.v('2. scan inconnu ⇒ 404', [r.statut, code(r)], [404, 'CODE_INVALIDE']);
        r = await post(ADM, { scanId: S, carte: 9, verdict: 'juste', rev: 1 });
        H.v('2. carte hors bornes (absente du scan) ⇒ 404, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === avant], [404, 'CODE_INVALIDE', true]);
        r = await post(ADM, { scanId: S, carte: 19, verdict: 'juste', rev: 1 });
        H.v('2. carte 19 absente ⇒ 404', r.statut, 404);
    }

    // ═══ 3. le corps : liste fermée ═══
    {
        const S = await semer(ADM); const avant = await snapAnalyses();
        const mauvais = [['corps vide', {}], ['scanId absent', { verdict: 'juste', rev: 1 }], ['scanId mal formé', { scanId: 'abc', verdict: 'juste', rev: 1 }], ['verdict inconnu', { scanId: S, verdict: 'peut-etre', rev: 1 }],
            ['verdict absent', { scanId: S, rev: 1 }], ['rev absent', { scanId: S, verdict: 'juste' }], ['rev 0', { scanId: S, verdict: 'juste', rev: 0 }], ['rev décimal', { scanId: S, verdict: 'juste', rev: 1.5 }], ['rev texte', { scanId: S, verdict: 'juste', rev: '1' }], ['rev au-delà de 1 000 000', { scanId: S, verdict: 'juste', rev: 1000001 }], ['rev énorme (9e15)', { scanId: S, verdict: 'juste', rev: 9e15 }],
            ['carte négative', { scanId: S, carte: -1, verdict: 'juste', rev: 1 }], ['carte décimale', { scanId: S, carte: 0.5, verdict: 'juste', rev: 1 }], ['champ inconnu', { scanId: S, verdict: 'juste', rev: 1, extra: 1 }],
            ['juste avec idProduct', { scanId: S, verdict: 'juste', idProduct: 4242, rev: 1 }], ['juste avec aucune', { scanId: S, verdict: 'juste', aucune: 'pas-une-carte', rev: 1 }],
            ['corrige sans rien', { scanId: S, verdict: 'corrige', rev: 1 }], ['corrige avec les DEUX', { scanId: S, verdict: 'corrige', idProduct: 4242, aucune: 'pas-une-carte', rev: 1 }],
            ['aucune hors liste', { scanId: S, verdict: 'corrige', aucune: 'autre', rev: 1 }], ['idProduct texte', { scanId: S, verdict: 'corrige', idProduct: '4242', rev: 1 }], ['idProduct 0', { scanId: S, verdict: 'corrige', idProduct: 0, rev: 1 }],
            ['idProduct négatif', { scanId: S, verdict: 'corrige', idProduct: -4, rev: 1 }], ['idProduct décimal', { scanId: S, verdict: 'corrige', idProduct: 1.5, rev: 1 }], ['idProduct null', { scanId: S, verdict: 'corrige', idProduct: null, rev: 1 }]];
        for (const [nom, corps] of mauvais) {
            const r = await post(ADM, corps);
            H.v(`3. ${nom} ⇒ 400 ENTREE, rien d'écrit`, [r.statut, code(r), await snapAnalyses() === avant], [400, 'ENTREE', true]);
        }
        const r = await post(ADM, [1, 2]);
        H.v('3. corps tableau ⇒ 400', r.statut, 400);
    }

    // ═══ 4. « juste » : seulement sur une AFFIRMATION, avec l'idProduct affirmé ═══
    {
        const S = await semer(ADM); const avant = await lire(S);
        let r = await post(ADM, { scanId: S, verdict: 'juste', rev: 1 });
        const e = await etiq(S, 0);
        H.v('4. juste sur une affirmation ⇒ 200 ecrit rev 1', [r.statut, r.json.etat, r.json.rev], [200, 'ecrit', 1]);
        H.v('4. l\'étiquette reprend l\'idProduct affirmé et porte les versions de la chaîne qui a répondu', [e.verdict, e.idProduct, 'aucune' in e, e.rev, e.versionModele, e.versionChaine, e.le instanceof Date], ['juste', 4242, false, 1, 'gemini-x', 'abc123def456', true]);
        H.v('4. la réponse d\'origine est intacte, champ par champ (tout le document sauf etiquetteAdmin)', sansEtiquette(await lire(S)), sansEtiquette(avant));
        for (const [i, nom] of [[1, 'une question'], [2, 'un introuvable'], [3, 'une panne']]) {
            const av = await snapAnalyses();
            r = await post(ADM, { scanId: S, carte: i, verdict: 'juste', rev: 1 });
            H.v(`4. juste sur ${nom} ⇒ 409 CONFLIT, rien d'écrit`, [r.statut, code(r), await snapAnalyses() === av], [409, 'CONFLIT', true]);
        }
    }

    // ═══ 5. « corrige » : l'idProduct est validé au catalogue ═══
    {
        const S = await semer(ADM); const avant = await snapAnalyses();
        let r = await post(ADM, { scanId: S, carte: 1, verdict: 'corrige', idProduct: 999999, rev: 1 });
        H.v('5. corrige avec un idProduct inconnu du catalogue ⇒ 422, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === avant], [422, 'ENTREE', true]);
        etat.catalogueEnPanne = true;
        r = await post(ADM, { scanId: S, carte: 1, verdict: 'corrige', idProduct: 4343, rev: 1 });
        H.v('5. catalogue en panne ⇒ 503 INDISPONIBLE, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === avant], [503, 'INDISPONIBLE', true]);
        r = await post(ADM, { scanId: S, carte: 1, verdict: 'corrige', aucune: 'pas-une-carte', rev: 1 });
        H.v('5. corrige « pas une carte » : aucune lecture du catalogue nécessaire, même en panne ⇒ 200', [r.statut, r.json.etat], [200, 'ecrit']);
        etat.catalogueEnPanne = false;
        H.v('5.    l\'étiquette porte `aucune` et pas d\'idProduct', await etiq(S, 1).then(e => [e.verdict, e.aucune, 'idProduct' in e]), ['corrige', 'pas-une-carte', false]);
        r = await post(ADM, { scanId: S, carte: 1, verdict: 'corrige', idProduct: 4343, rev: 2 });
        H.v('5. corrige avec un idProduct connu, rev plus grand ⇒ 200 ecrit rev 2 (écrase)', [r.statut, r.json.etat, r.json.rev], [200, 'ecrit', 2]);
        H.v('5.    l\'étiquette est remplacée : idProduct, plus de `aucune`', await etiq(S, 1).then(e => [e.verdict, e.idProduct, 'aucune' in e, e.rev]), ['corrige', 4343, false, 2]);
        r = await post(ADM, { scanId: S, carte: 2, verdict: 'corrige', aucune: 'hors-catalogue', rev: 1 });
        H.v('5. corrige « hors catalogue » sur un introuvable ⇒ 200', [r.statut, r.json.etat], [200, 'ecrit']);
        r = await post(ADM, { scanId: S, carte: 0, verdict: 'corrige', idProduct: 4444, rev: 1 });
        H.v('5. corrige sur une affirmation (contredit la chaîne) ⇒ 200 ; la réponse d\'origine reste idProduct 4242', [r.statut, (await lire(S)).cartes[0].idProduct, (await etiq(S, 0)).idProduct], [200, 4242, 4444]);
    }

    // ═══ 6. versions : rejeu, écrasement, conflit, concurrence ═══
    {
        const S = await semer(ADM);
        let r = await post(ADM, { scanId: S, verdict: 'juste', rev: 3 });
        const e1 = await etiq(S);
        H.v('6. première étiquette rev 3 ⇒ ecrit', [r.statut, r.json.etat, r.json.rev], [200, 'ecrit', 3]);
        r = await post(ADM, { scanId: S, verdict: 'juste', rev: 3 });
        H.v('6. rejeu exact (même rev, même contenu) ⇒ 200 rejoue, rien d\'écrit (même `le`)', [r.statut, r.json.etat, r.json.rev, (await etiq(S)).le.getTime() === e1.le.getTime()], [200, 'rejoue', 3, true]);
        const av = await snapAnalyses();
        r = await post(ADM, { scanId: S, verdict: 'corrige', idProduct: 4343, rev: 3 });
        H.v('6. même rev, contenu différent ⇒ 409, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === av], [409, 'CONFLIT', true]);
        r = await post(ADM, { scanId: S, verdict: 'corrige', idProduct: 4343, rev: 2 });
        H.v('6. rev inférieur ⇒ 409, rien d\'écrit', [r.statut, code(r), await snapAnalyses() === av], [409, 'CONFLIT', true]);
        r = await post(ADM, { scanId: S, verdict: 'corrige', idProduct: 4343, rev: 4 });
        H.v('6. rev plus grand ⇒ écrase', [r.statut, r.json.etat, (await etiq(S)).idProduct, (await etiq(S)).rev], [200, 'ecrit', 4343, 4]);
        // C-5 : le rejeu SÉQUENTIEL au même rev mais avec un autre idProduct est un conflit (le contenu compare l'idProduct, pas seulement le verdict)
        r = await post(ADM, { scanId: S, verdict: 'corrige', idProduct: 4444, rev: 4 });
        H.v('6. même rev 4, même verdict `corrige`, autre idProduct ⇒ 409 (sans concurrence), l\'étiquette garde 4343', [r.statut, code(r), (await etiq(S)).idProduct], [409, 'CONFLIT', 4343]);
        r = await post(ADM, { scanId: S, verdict: 'corrige', idProduct: 4343, rev: 4 });
        H.v('6. même rev 4, même idProduct ⇒ rejoue', [r.statut, r.json.etat], [200, 'rejoue']);
        // M-2 (tour 3) : la comparaison porte aussi sur `aucune` — même rev, autre `aucune` ⇒ 409 ; identique ⇒ rejoue
        const SN = await semer(ADM);
        r = await post(ADM, { scanId: SN, carte: 2, verdict: 'corrige', aucune: 'pas-une-carte', rev: 1 });
        H.v('6. corrige `pas-une-carte` rev 1 ⇒ ecrit', [r.statut, r.json.etat], [200, 'ecrit']);
        r = await post(ADM, { scanId: SN, carte: 2, verdict: 'corrige', aucune: 'hors-catalogue', rev: 1 });
        H.v('6. même rev 1, même verdict, `aucune` DIFFÉRENT ⇒ 409 rev-contredit, l\'étiquette garde `pas-une-carte`', [r.statut, r.json.erreur.detail, (await etiq(SN, 2)).aucune], [409, 'rev-contredit', 'pas-une-carte']);
        r = await post(ADM, { scanId: SN, carte: 2, verdict: 'corrige', aucune: 'pas-une-carte', rev: 1 });
        H.v('6. même rev 1, même `aucune` ⇒ rejoue', [r.statut, r.json.etat], [200, 'rejoue']);
        // C-6 : la borne haute du rev (1 000 000) passe, 1 000 001 est refusé (plus haut)
        const SB = await semer(ADM);
        r = await post(ADM, { scanId: SB, verdict: 'juste', rev: 1000000 });
        H.v('6. rev 1 000 000 (la borne) ⇒ ecrit', [r.statut, r.json.etat], [200, 'ecrit']);
        // concurrence : deux requêtes simultanées de même rev
        const S2 = await semer(ADM);
        let rs = await Promise.all([post(ADM, { scanId: S2, verdict: 'corrige', idProduct: 4343, rev: 1 }), post(ADM, { scanId: S2, verdict: 'corrige', idProduct: 4444, rev: 1 })]);
        const e2 = await etiq(S2);
        H.v('6. deux requêtes concurrentes de même rev, contenus différents ⇒ une seule gagne (200 + 409), l\'étiquette est celle du gagnant', [rs.map(x => x.statut).sort(), [4343, 4444].includes(e2.idProduct)], [[200, 409], true]);
        const S3 = await semer(ADM);
        rs = await Promise.all([post(ADM, { scanId: S3, verdict: 'juste', rev: 1 }), post(ADM, { scanId: S3, verdict: 'juste', rev: 1 }), post(ADM, { scanId: S3, verdict: 'juste', rev: 1 })]);
        H.v('6. trois requêtes concurrentes identiques ⇒ exactement un `ecrit`, deux `rejoue`', [rs.map(x => x.statut), rs.map(x => x.json.etat).sort()], [[200, 200, 200], ['ecrit', 'rejoue', 'rejoue']]);
        // rev croissant par (scan, carte) : une autre carte a sa propre suite
        r = await post(ADM, { scanId: S, carte: 1, verdict: 'corrige', aucune: 'pas-une-carte', rev: 1 });
        H.v('6. la suite des rev est propre à chaque carte (carte 1 : rev 1 accepté après rev 4 sur la carte 0)', [r.statut, r.json.etat], [200, 'ecrit']);
    }

    // ═══ 7. l'argent : ni débit ni remboursement ═══
    {
        const S = await semer(ADM);
        const mv = async () => JSON.stringify(await db.col('mouvements').find({}).sort({ _id: 1 }).toArray());
        const avant = [await mv(), JSON.stringify((await db.col('comptes').findOne({ _id: ADM.c._id })).solde), await db.col('mouvements').countDocuments({})];
        for (const corps of [{ scanId: S, verdict: 'juste', rev: 1 }, { scanId: S, carte: 1, verdict: 'corrige', idProduct: 4343, rev: 1 }, { scanId: S, verdict: 'juste', rev: 1 }, { scanId: S, verdict: 'corrige', idProduct: 4444, rev: 2 }]) await post(ADM, corps);
        const apres = [await mv(), JSON.stringify((await db.col('comptes').findOne({ _id: ADM.c._id })).solde), await db.col('mouvements').countDocuments({})];
        H.v('7. mouvements (contenu), solde et nombre de mouvements inchangés après écriture, rejeu et écrasement', apres, avant);
    }

    // ═══ 8. idempotence : une clé rejouée rend la même réponse ═══
    {
        const S = await semer(ADM); const cle = { 'idempotency-key': 'etiquette-cle-0001' };
        const a = await post(ADM, { scanId: S, verdict: 'juste', rev: 1 }, cle), b = await post(ADM, { scanId: S, verdict: 'juste', rev: 1 }, cle);
        H.v('8. même Idempotency-Key, même corps ⇒ réponse rejouée', [a.statut, b.statut, b.entetes['idempotency-replayed'], JSON.stringify(b.json) === JSON.stringify(a.json)], [200, 200, 'true', true]);
        const c = await post(ADM, { scanId: S, verdict: 'corrige', idProduct: 4343, rev: 2 }, cle);
        H.v('8. même clé, autre corps ⇒ 422 cle-reutilisee', [c.statut, c.json.erreur.detail], [422, 'cle-reutilisee']);
        const d = await post(ADM, { scanId: S, verdict: 'juste', rev: 1 }, { 'idempotency-key': 'mauvaise cle' });
        H.v('8. Idempotency-Key malformée ⇒ 400', d.statut, 400);

        // C-4 : le rejeu par clé rend la réponse D'ORIGINE, même périmée, et n'écrit RIEN (le rev, lui, dit la vérité)
        const S4 = await semer(ADM), k1 = { 'idempotency-key': 'etiquette-rev1-0001' }, k2 = { 'idempotency-key': 'etiquette-rev2-0001' };
        const p1 = await post(ADM, { scanId: S4, verdict: 'juste', rev: 1 }, k1);
        const p2 = await post(ADM, { scanId: S4, verdict: 'corrige', idProduct: 4343, rev: 2 }, k2);
        const avant4 = await snapAnalyses();
        const rej = await post(ADM, { scanId: S4, verdict: 'juste', rev: 1 }, k1);
        H.v('8. après un rev 2, rejouer la clé du rev 1 rend la réponse d\'origine `ecrit` rev 1 (rejeu de clé), SANS rien écrire : l\'étiquette reste rev 2',
            [p1.json.etat, p2.json.etat, rej.statut, rej.entetes['idempotency-replayed'], rej.json, await snapAnalyses() === avant4, (await etiq(S4)).rev, (await etiq(S4)).idProduct], ['ecrit', 'ecrit', 200, 'true', { success: true, etat: 'ecrit', rev: 1 }, true, 2, 4343]);
        const sansCle = await post(ADM, { scanId: S4, verdict: 'juste', rev: 1 });
        H.v('8.    le même corps SANS clé rend la vérité : 409 rev-perimee', [sansCle.statut, sansCle.json.erreur.detail], [409, 'rev-perimee']);

        // C-5 : un non-administrateur qui envoie une Idempotency-Key reçoit le 404 natif, et RIEN n'est enregistré dans `idempotence` (la garde passe avant l'idempotence)
        const nIdem = () => db.col('idempotence').countDocuments({});
        const avantIdem = await nIdem();
        const SU = await semer(USR);
        const rb1 = await post(USR, { scanId: SU, verdict: 'juste', rev: 1 }, { 'idempotency-key': 'etiquette-intrus-0001' });
        const rb2 = await post(USR, { scanId: SU, verdict: 'juste', rev: 1 }, { 'idempotency-key': 'mauvaise cle' });
        const rb3 = await post(SEUL, { scanId: SU, verdict: 'juste', rev: 1 }, { 'idempotency-key': 'etiquette-intrus-0002' });
        H.v('8. non-administrateur avec une clé valide, une clé malformée, installation seule avec une clé ⇒ 404 natif (jamais 400), aucune ligne `idempotence` créée', [rb1.statut, rb2.statut, rb3.statut, await nIdem() === avantIdem, (await lire(SU)).cartes[0].etiquetteAdmin], [404, 404, 404, true, undefined]);
    }

    // ═══ 9. durées : l'étiquette vit avec l'analyse ═══
    {
        // 9a. l'effacement d'un compte efface ses analyses, donc leurs étiquettes
        const A = await acteur({ role: 'administrateur' }); const S = await semer(A);
        await post(A, { scanId: S, verdict: 'juste', rev: 1 });
        H.v('9a. avant : l\'étiquette est là', (await etiq(S)).verdict, 'juste');
        const compte = await db.col('comptes').findOne({ _id: A.c._id });
        const sup = await supprimerCompte({ compte, motDePasse: 'mot-de-passe-du-banc', renonciation: true, cfg });
        H.v('9a. suppression du compte : 200, l\'analyse et son étiquette ont disparu', [sup.statut, await lire(S)], [200, null]);
        // 9b. la passe quotidienne (anonymiserLiens) supprime les analyses de plus de bancLienMois, étiquette comprise
        const client = { objets: new Map(), async deposerBinaire() { return { ecrit: true }; }, async supprimer() { return 0; }, async lireBinaire() { throw new Error('absent'); }, async listerObjets() { return []; } };
        const stockage = creerStockage({ client, bucket: 'bucket-banc-test', env: { V2_BANC_BUCKET: 'bucket-banc-test' } }); stockage.verifierBucket = async () => { };
        const maintenant = new Date();
        const purge = require('../banc/purge').creerPurge({ cfg, env: { V2_BANC_BUCKET: 'bucket-banc-test', V2_BANC_SEL: 'sel-etiquette' }, stockage, horloge: () => maintenant });
        const B = await acteur({ role: 'administrateur' }); const vieux = await semer(B), recent = await semer(B);
        await post(B, { scanId: vieux, verdict: 'juste', rev: 1 }); await post(B, { scanId: recent, verdict: 'juste', rev: 1 });
        const LIEN_MS = cfg.retention.bancLienMois * 31 * 86400e3;
        await db.col('analyses').updateOne({ _id: new mongoose.Types.ObjectId(vieux) }, { $set: { creeLe: new Date(maintenant.getTime() - LIEN_MS) } });
        const bilan = await purge.anonymiserLiens(maintenant);
        H.v('9b. la passe d\'anonymisation supprime l\'analyse vieille (et son étiquette) et garde la récente avec la sienne', [await lire(vieux), (await etiq(recent)).verdict, bilan.analyses >= 1], [null, 'juste', true]);
        // 9c. la TTL de la collection existe sur analyses (expireLe) : l'étiquette ne prolonge rien
        const exp = (await lire(recent)).expireLe;
        await post(B, { scanId: recent, verdict: 'corrige', idProduct: 4343, rev: 2 });
        H.v('9c. écrire une étiquette ne touche ni creeLe ni expireLe (elle ne prolonge pas la vie de l\'analyse)', (await lire(recent)).expireLe.getTime(), exp.getTime());
    }

    // ═══ 10. le limiteur : 600 par heure par porteur, la 601e rend 429 ═══
    {
        const L = await acteur({ role: 'administrateur' }), L2 = await acteur({ role: 'administrateur' });
        const corps = { scanId: 'x', verdict: 'juste', rev: 1 };   // 400 : le limiteur compte tout ce qui l'atteint
        let non400 = 0;
        for (let i = 0; i < 600; i++) { const r = await post(L, corps); if (r.statut !== 400) non400++; }
        const r601 = await post(L, corps);
        H.v('10. 600 requêtes passent (toutes atteignent la route : 400), la 601e du même porteur ⇒ 429 DEBIT', [non400, r601.statut, code(r601)], [0, 429, 'DEBIT']);
        H.vrai('10.    Retry-After présent et égal à reessayerDans', Number(r601.entetes['retry-after']) >= 1 && r601.json.erreur.reessayerDans === Number(r601.entetes['retry-after']));
        const rb = await post(L2, corps);
        H.v('10.    un AUTRE administrateur n\'est pas touché', rb.statut, 400);
        // I-1 : le limiteur est par porteur, donc c'est le NON-administrateur lui-même qui doit dépasser 600 : 601 requêtes, toutes 404, aucune 429 (sinon la route se révèle)
        for (const [nom, a] of [['compte non administrateur', USR], ['installation sans compte', SEUL]]) {
            const statuts = new Map();
            for (let i = 0; i < 601; i++) { const r = await post(a, corps); statuts.set(r.statut, (statuts.get(r.statut) || 0) + 1); }
            H.v(`10.    ${nom} : 601 requêtes ⇒ 601 × 404, aucune 429 (la garde de rôle passe avant le limiteur)`, [...statuts], [[404, 601]]);
        }
    }

    // ═══ 11. M-1 / I-2 (tour 3) : ce que `analyses` garde d'une question de CONFIRMATION (un seul candidat), produite par la VRAIE route /api/identifier (chaîne fabriquée) ═══
    // La base « Gemini seul » de la mesure d'une question se lit dans `cartes[i].question` (code + choix[].idProduct), pas dans `cartes[i].idProduct` (nul : rien n'est affirmé).
    {
        const path = require('path'), pret = require('../pret'), { dansUnScan } = require('../../sources'), { assembler } = require('../index');
        const IMAGE = require(path.join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl;
        const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
        const chaine = async (req, res) => {
            await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite-sans-enjeu', candidats: [4242] });
            return res.json({ success: true, question: { etat: 'en-attente', delaiHeures: 24 }, carte: { idProduct: 4242, nomProduit: 'Pikachu', nom: 'Pikachu', numero: '58', total: '102', setCode: 'BS', rarete: null, langue: 'FR', ambigu: true }, etat: ETAT,
                candidats: [{ idProduct: 4242, nom: 'Pikachu', numero: '58', set: 'Base Set', prix: 1, photoUrl: null }], classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2, scanId: String(req.scanIdImpose) });
        };
        const app2 = express(); app2.set('trust proxy', true); app2.use(express.json()); app2.use((q, s, n) => dansUnScan(n));
        pret.armer(M.verifierIndex);
        app2.use(assembler([require('../argent/monter'), require('../identifier/monter'), monterBanc], cfg, { jumeaux: () => ({ conclu: true, ids: [] }), gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), banc: {}, purge: purgeStub, catalogue }));
        const sv2 = await H.serveur(app2);
        try {
            const A = await acteur({ role: 'administrateur' });
            const ent = { origin: cfg.origines.extension, authorization: `Bearer ${A.jeton}` };
            const sc = await H.appel(sv2.url, '/api/identifier', { methode: 'POST', corps: { contrat: 2, imageUrls: [IMAGE], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr' }, entetes: { ...ent, 'x-forwarded-for': '10.7.7.7', 'idempotency-key': 'etiq-confirmation-0001' } });
            const c0 = sc.json && sc.json.analyse && sc.json.analyse.cartes[0];
            H.v('11. la route rend une question de confirmation : a-trancher, un candidat, code `confirmation`', [sc.statut, c0 && c0.statut, c0 && c0.candidats.length, c0 && c0.question.code], [200, 'a-trancher', 1, 'confirmation']);
            const an = await lire(sc.json.scanId);
            H.v('11. analyses FIGE la donnée d\'origine de la question : statut a-trancher, idProduct nul, question.code `confirmation`, question.choix[0] = le candidat', [an.cartes[0].statut, an.cartes[0].idProduct, an.cartes[0].question && an.cartes[0].question.code, an.cartes[0].question && an.cartes[0].question.choix.map(c => c.idProduct)], ['a-trancher', null, 'confirmation', [4242]]);
            const etiqueter = corps => H.appel(sv2.url, '/api/banc/etiquette', { methode: 'POST', corps: { scanId: sc.json.scanId, ...corps }, entetes: { ...ent, 'x-forwarded-for': '10.7.7.8' } });
            let r = await etiqueter({ verdict: 'juste', rev: 1 });
            H.v('11. « juste » sur la confirmation ⇒ 409 (la réponse d\'origine n\'est pas une affirmation)', [r.statut, r.json.erreur.detail], [409, 'juste-sans-affirmation']);
            const oui = await H.appel(sv2.url, '/api/identifier/reponse', { methode: 'POST', corps: { scanId: sc.json.scanId, carte: 0, choix: 'a' }, entetes: { ...ent, 'x-forwarded-for': '10.7.7.9' } });
            r = await etiqueter({ verdict: 'juste', rev: 1 });
            H.v('11. I-2 : après un OUI (la réponse rendue est `identifiee`), « juste » rend TOUJOURS 409 : l\'étiquette juge la réponse d\'ORIGINE', [oui.statut, oui.json.carte.statut, r.statut, (await lire(sc.json.scanId)).cartes[0].statut], [200, 'identifiee', 409, 'a-trancher']);
            r = await etiqueter({ verdict: 'corrige', idProduct: 4242, rev: 1 });
            const fin = (await lire(sc.json.scanId)).cartes[0];
            H.v('11. « corrige » avec l\'idProduct du candidat ⇒ ecrit ; la proposition d\'origine (question.choix) et le choix de l\'administrateur (reponse) restent à côté', [r.statut, r.json.etat, fin.etiquetteAdmin.idProduct, fin.question.choix.map(c => c.idProduct), fin.reponse && fin.reponse.idProduct], [200, 'ecrit', 4242, [4242], 4242]);
        } finally { await sv2.fermer(); }
    }

    await srv.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
