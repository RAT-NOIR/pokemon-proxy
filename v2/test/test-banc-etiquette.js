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
            ['verdict absent', { scanId: S, rev: 1 }], ['rev absent', { scanId: S, verdict: 'juste' }], ['rev 0', { scanId: S, verdict: 'juste', rev: 0 }], ['rev décimal', { scanId: S, verdict: 'juste', rev: 1.5 }], ['rev texte', { scanId: S, verdict: 'juste', rev: '1' }],
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

    await srv.fermer(); monterBanc.arreterPurge();
    H.bilan();
    await H.fermerBac();
})().catch(e => { console.error(e); process.exitCode = 1; });
