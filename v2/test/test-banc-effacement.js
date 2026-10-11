'use strict';
// B6.4 — effacement par jeton, purge à 24 mois, filet des orphelins, abandon à 24 h, câblage du crochet (fin du lot B6).
// Base : la base EN MÉMOIRE du banc (INT2). R2 : un FAUX client (il lève si le bucket n'est pas `bucket-banc-test`). Aucun réseau, aucune base réelle,
// et le CLI de la purge n'est exercé QUE sur la base en mémoire avec un faux R2 (jamais `--base=test`, jamais `test_scratch` réel).
// Chaque section est isolée : une section qui plante (fonction absente...) compte un échec nommé, elle n'arrête pas les suivantes.
const H = require('./_harnais');
const crypto = require('crypto');
const express = require('express');
const sharp = require('sharp');
const mongoose = require('mongoose');
const db = require('../db'); const M = require('../modeles'); const J = require('../comptes/jetons');
const registre = require('../registre');
const { lireConfig } = require('../config');
const { creerStockage, creerStockageMemoire } = require('../banc/stockage');
const { creerBanc } = require('../banc/routes');
const monterBanc = require('../banc/monter');
const { compte } = require('./_aide-argent');
// chargés APRÈS creerIndex (comme les bancs voisins) : ces modules tirent du code hérité qui crée ses propres index
let Lg, Q;

const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const ORIGINE = cfg.origines.extension;
const BUCKET = 'bucket-banc-test', SEL = 'sel-de-banc-A';
// T0 = maintenant (et non une date figée) : le consentement du banc porte `le: new Date()`, et une horloge figée au 2026-10-10 12:00Z le refusait dès le 2026-10-11 12:00Z (bombe à retardement du banc, sans rapport avec O5).
const T0 = new Date(), H1 = 3600e3, JOUR = 86400e3;
const attendre = ms => new Promise(r => setTimeout(r, ms));
const jusque = async (cond, ms = 3000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await cond()) return true; await attendre(25); } return false; };
const empreinte = j => crypto.createHash('sha256').update(j).digest('hex');
const raw = n => mongoose.connection.db.collection(n);
const lignes = () => db.col('banc_lignes').find({}).toArray();
const vider = () => db.col('banc_lignes').deleteMany({});
const consentement = (jeton = 'jeton-test-abcdefghij1234') => ({ consentementBanc: { version: '2026-10-07-v1', le: new Date().toISOString(), jeton } });
const carteImg = () => sharp({ create: { width: 640, height: 894, channels: 3, background: { r: 30, g: 120, b: 60 } } }).jpeg().toBuffer();
const hex = () => crypto.randomBytes(16).toString('hex');
const scanHex = n => `6500000000000000000${String(n).padStart(5, '0')}`;
let nIp = 0; const ip = () => { nIp++; return { 'x-forwarded-for': `10.13.${Math.floor(nIp / 250)}.${nIp % 250 + 1}` }; };
let nCle = 0; const cle = () => `banc-b64-${Date.now().toString(36)}-${++nCle}`;

function capturer() {
    const vus = [], o = { e: console.error, w: console.warn, l: console.log };
    const f = (...a) => { vus.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(' ')); };
    console.error = f; console.warn = f; console.log = f;
    return { vus, rendre() { console.error = o.e; console.warn = o.w; console.log = o.l; } };
}

// Un faux R2 : les mêmes méthodes que collecte-cartes/r2.js, plus `listerObjets` (cle + date de l'objet) ; lève si le bucket n'est pas celui du banc de test.
function fauxClient() {
    const commandes = [], objets = new Map(), dates = new Map(), panne = { put: false, del: false, lister: false };
    const garde = b => { if (b !== BUCKET) throw new Error('mauvais bucket ' + b); };
    const c = {
        commandes, objets, dates, panne, dateObjet: T0, listeTout: false, avantSuppression: null,
        async deposerBinaire(bucket, k, buf) { garde(bucket); commandes.push({ op: 'put', cle: k }); if (panne.put) throw new Error('R2 en panne'); objets.set(k, buf); dates.set(k, c.dateObjet); return { ecrit: true, cle: k }; },
        async supprimer(bucket, cles) { garde(bucket); commandes.push({ op: 'del', cles }); if (c.avantSuppression) await c.avantSuppression(cles); if (panne.del) throw new Error('R2 suppression en panne'); for (const k of cles) { objets.delete(k); dates.delete(k); } return cles.length; },
        async lireBinaire(bucket, k) { garde(bucket); if (!objets.has(k)) throw new Error('absent'); return objets.get(k); },
        async listerObjets(bucket, prefixe) { garde(bucket); commandes.push({ op: 'list', prefixe }); if (panne.lister) throw new Error('R2 liste en panne'); return [...objets.keys()].filter(k => c.listeTout || k.startsWith(prefixe)).map(k => ({ cle: k, modifieLe: dates.get(k) })); },
    };
    return c;
}
const dels = c => c.commandes.filter(x => x.op === 'del').flatMap(x => x.cles);

function nouveauBanc(client, colFn) {
    const stockage = creerStockage({ client, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } });
    stockage.verifierBucket = async () => { };
    const banc = creerBanc({ cfg, env: { V2_BANC_BUCKET: BUCKET, V2_BANC_SEL: SEL }, stockage, horloge: () => T0, ...(colFn ? { colFn } : {}) });
    return { banc, stockage };
}
// Une collection « rassise » : la LECTURE des lignes (find().toArray() SANS projection) rend ce qu'elle a lu, mais `pendant()` s'exécute entre cette lecture et ce
// qui suit (le scénario de la relecture : une ligne d'attente lue par la purge, puis confirmée avant sa suppression). `compte` compte les find / findOne.
function colRassise(pendant, compte = {}) {
    return n => {
        const r = db.col(n);
        return {
            find: (q, o) => { compte.find = (compte.find || 0) + 1; compte.projections = [...(compte.projections || []), Boolean(o && o.projection)]; const c = r.find(q, o);
                return { toArray: async () => { const l = await c.toArray(); if (!(o && o.projection) && pendant) await pendant(); return l; } }; },
            findOne: (...a) => { compte.findOne = (compte.findOne || 0) + 1; return r.findOne(...a); },
            deleteOne: (...a) => r.deleteOne(...a), insertOne: (...a) => r.insertOne(...a), updateOne: (...a) => r.updateOne(...a),
        };
    };
}
const P = () => require('../banc/purge');
function nouvellePurge(client, o = {}) {
    const stockage = creerStockage({ client, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } });
    stockage.verifierBucket = o.verifierBucket || (async () => { });
    return P().creerPurge({ cfg, env: { V2_BANC_BUCKET: BUCKET }, stockage, horloge: () => T0, delaiMs: o.delaiMs, colFn: o.colFn });
}
let nScan = 0;
const nouveauScan = () => scanHex(++nScan);
// écrit une VRAIE ligne (banc.apresVerdict), jeton et état au choix
async function ecrireLigne(banc, image, { jeton, issue = 'affirmee', scanId = nouveauScan(), idProduct = 4242 } = {}) {
    await banc.apresVerdict({ corps: consentement(jeton), scanId, carte: 0, issue, idProduct, imageRedressee: image, detectionSure: true, versionModele: 'm1' });
    return scanId;
}

const resultats = [];
async function section(nom, f) {
    try { await f(); }
    catch (e) { H.v(`${nom} : la section s'exécute jusqu'au bout (${e && e.message})`, false, true); }
}

(async () => {
    await H.ouvrirBancV2();
    process.env.MONGODB_BASE = 'test_scratch';
    const { connecterMongo } = require('../../mongo-connexion');
    await connecterMongo({ script: 'test-banc-effacement.js', ecrit: true });
    db.brancher(mongoose.connection.db);
    await M.creerIndex();
    Lg = require('../argent/ledger'); Q = require('../argent/questions');
    const image = await carteImg();

    // ═══ RULING 1 — la purge est le SEUL effaceur : aucun TTL Mongo sur banc_lignes ═══
    await section('ruling 1', async () => {
        const decl = M.INDEX.filter(i => i.c === 'banc_lignes' && i.cle.expireLe === 1);
        H.v('1. modeles.js déclare UN index sur banc_lignes.expireLe, SANS expireAfterSeconds', [decl.length, decl.map(i => i.opts.expireAfterSeconds)], [1, [undefined]]);
        const idx = (await db.col('banc_lignes').indexes()).filter(i => i.key.expireLe === 1);
        H.v('   l\'index créé en base : { expireLe: 1 } présent, sans expireAfterSeconds (Mongo ne supprime rien seul)', [idx.length, idx.map(i => i.expireAfterSeconds)], [1, [undefined]]);
        H.v('   verifierIndex : rien ne manque', (await M.verifierIndex()).manquants, []);
        const cles = await db.col('banc_lignes').indexes();
        H.v('   l\'index sur jetonEmpreinte (effacement par jeton) existe toujours', cles.some(i => i.key.jetonEmpreinte === 1), true);
    });

    // ═══ le stockage sait LISTER, avec les mêmes gardes ═══
    await section('stockage.lister', async () => {
        const c = fauxClient();
        const st = creerStockage({ client: c, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } });
        const k1 = `banc-reel/v2/${hex()}.webp`, k2 = `banc-reel/v2/attente/${hex()}.webp`;
        c.objets.set(k1, Buffer.from('a')); c.dates.set(k1, T0); c.objets.set(k2, Buffer.from('b')); c.dates.set(k2, T0);
        c.objets.set('banc-reel/v2/notes.txt', Buffer.from('x')); c.dates.set('banc-reel/v2/notes.txt', T0);
        c.objets.set(`autre/${hex()}.webp`, Buffer.from('y')); c.dates.set(`autre/${hex()}.webp`, T0);
        c.listeTout = true;       // le faux client ignore le préfixe demandé : le STOCKAGE doit filtrer lui-même
        const l = await st.lister();
        H.v('lister : seules les clés banc-reel/v2/<hex>.webp (et attente/) sont rendues, avec leur date ; ni notes.txt ni hors préfixe', [l.map(x => x.cle).sort(), l.every(x => x.modifieLe instanceof Date)], [[k1, k2].sort(), true]);
        let code = null; try { await creerStockage({ client: { deposerBinaire() { }, supprimer() { } }, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } }).lister(); } catch (e) { code = e.code; }
        H.v('   un client qui ne sait pas lister : refus client-invalide', code, 'client-invalide');
        c.dateObjet = null; c.objets.set(`banc-reel/v2/${hex()}.webp`, Buffer.from('z'));    // sans date lisible
        H.v('   un objet sans date lisible n\'est pas rendu (on ne juge pas l\'âge de ce qu\'on ne sait pas dater)', (await st.lister()).length, 2);
        const mem = creerStockageMemoire();
        const km = `banc-reel/v2/${hex()}.webp`; await mem.ecrire(km, Buffer.from('m'));
        const lm = await mem.lister();
        H.v('   le stockage mémoire liste aussi (mêmes clés, une date)', [lm.map(x => x.cle), lm[0].modifieLe instanceof Date], [[km], true]);
    });

    // ═══ (1)(2)(3)(4) — effacement par jeton (la fonction) ═══
    await section('effacement', async () => {
        const client = fauxClient(); const { banc } = nouveauBanc(client); const purge = nouvellePurge(client);
        const A = 'jeton-A-abcdefghij1234', B = 'jeton-B-abcdefghij5678';
        for (let i = 0; i < 5; i++) await ecrireLigne(banc, image, { jeton: A, issue: i === 4 ? 'question' : 'affirmee' });
        for (let i = 0; i < 3; i++) await ecrireLigne(banc, image, { jeton: B });
        H.v('(1) départ : 8 lignes (5 de A dont une en attente, 3 de B), 8 objets', [(await lignes()).length, client.objets.size], [8, 8]);
        const r = await purge.effacerParJeton(A);
        const ls = await lignes();
        H.v('(1) effacer A : supprimees 5, echecs 0 ; il reste 3 lignes, toutes de B ; 3 objets (8 → 3)', [r, ls.length, ls.every(l => l.jetonEmpreinte === empreinte(B)), client.objets.size], [{ supprimees: 5, echecs: 0 }, 3, true, 3]);
        H.v('   les objets restants sont ceux des lignes de B', [...client.objets.keys()].sort(), ls.map(l => l.cleR2).sort());
        const apres = await purge.effacerParJeton('jeton-inconnu-abcdefghij99');
        H.v('(2) jeton inconnu : supprimees 0, echecs 0, rien ne bouge (3 lignes, 3 objets)', [apres, (await lignes()).length, client.objets.size], [{ supprimees: 0, echecs: 0 }, 3, 3]);
        const rejeu = await purge.effacerParJeton(A);
        H.v('   effacer A une seconde fois : 0', rejeu.supprimees, 0);
        // (4) la suppression R2 d'un objet échoue : la ligne est CONSERVÉE
        client.panne.del = true; const cap = capturer();
        const echec = await purge.effacerParJeton(B); cap.rendre(); client.panne.del = false;
        H.v('(4) suppression R2 en panne : supprimees 0, echecs 3, les 3 lignes et les 3 objets sont GARDÉS ; journal sans contenu (ni jeton, ni clé)',
            [echec, (await lignes()).length, client.objets.size, cap.vus.length > 0, [B, 'banc-reel', empreinte(B)].map(x => cap.vus.join('\n').includes(x))], [{ supprimees: 0, echecs: 3 }, 3, 3, true, [false, false, false]]);
        // un objet sur trois échoue : les deux autres partent, la ligne de l'échec reste
        const [l0] = await lignes(); const cleEchec = l0.cleR2;
        client.avantSuppression = async cles => { if (cles.includes(cleEchec)) throw new Error('R2 : un objet récalcitrant'); };
        const capM = capturer(); const mixte = await purge.effacerParJeton(B); capM.rendre(); client.avantSuppression = null;
        H.v('   un objet récalcitrant sur trois : supprimees 2, echecs 1 ; seule la ligne de l\'objet encore vivant reste, avec son objet', [mixte, (await lignes()).map(l => l.cleR2), [...client.objets.keys()]], [{ supprimees: 2, echecs: 1 }, [cleEchec], [cleEchec]]);
        await purge.effacerParJeton(B);
        // objets d'abord, lignes ensuite : au moment où R2 supprime, la ligne existe encore
        const k = await ecrireLigne(banc, image, { jeton: A }); let vue = null;
        client.avantSuppression = async () => { vue = (await lignes()).length; };
        await purge.effacerParJeton(A); client.avantSuppression = null;
        H.v('   objets d\'abord : à l\'instant de la suppression R2 la ligne existe encore (1), puis plus rien', [vue, (await lignes()).length, client.objets.size], [1, 0, 0]);
        void k;
        // un R2 qui ne répond jamais : la fonction rend la main, la ligne est gardée
        await ecrireLigne(banc, image, { jeton: A });
        const pendu = nouvellePurge(Object.assign(client, { supprimer: () => new Promise(() => { }) }), { delaiMs: 60 });
        const capP = capturer(); const t0 = Date.now(); const rp = await pendu.effacerParJeton(A); capP.rendre();
        H.v('   un R2 qui pend : rend la main (< 1 s), échec compté, ligne gardée', [Date.now() - t0 < 1000, rp, (await lignes()).length], [true, { supprimees: 0, echecs: 1 }, 1]);
        await vider();
    });

    // ═══ (1)(2)(3) — DELETE /api/banc/contributions par HTTP ═══
    await section('route DELETE', async () => {
        const client = fauxClient(); const { banc } = nouveauBanc(client); const purge = nouvellePurge(client);
        const app = express(); app.use(express.json());
        const router = express.Router(); monterBanc.routes(router, cfg, { banc, purge }); app.use(router);
        const srv = await H.serveur(app);
        const mk = async () => { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 3, libelle: 'banc' }); await db.col('installations').insertOne(i); return { i, jeton }; };
        const X = await mk();
        const del = (x, corps, plus = {}) => H.appel(srv.url, '/api/banc/contributions', { methode: 'DELETE', corps, entetes: { ...(x ? { authorization: `Bearer ${x.jeton}` } : {}), ...plus } });
        const A = 'jeton-A-abcdefghij1234', B = 'jeton-B-abcdefghij5678';
        for (let i = 0; i < 5; i++) await ecrireLigne(banc, image, { jeton: A });
        for (let i = 0; i < 3; i++) await ecrireLigne(banc, image, { jeton: B });
        const avant = JSON.stringify(await lignes());
        let r = await del(null, { jeton: A });
        H.v('sans Bearer : 401, rien ne change', [r.statut, JSON.stringify(await lignes()) === avant], [401, true]);
        for (const [nom, corps] of [['jeton absent', {}], ['jeton null', { jeton: null }], ['jeton nombre', { jeton: 123456789012345678 }], ['jeton trop court', { jeton: 'court' }], ['jeton 65 caractères', { jeton: 'a'.repeat(65) }],
            ['jeton hors alphabet', { jeton: 'jeton avec espace!!!' }], ['jeton tableau', { jeton: [A] }], ['jeton objet', { jeton: { $ne: 'x' } }], ['corps absent', undefined]]) {
            r = await del(X, corps);
            H.v(`(3) ${nom} ⇒ 400 ENTREE, rien ne change`, [r.statut, r.json && r.json.erreur && r.json.erreur.code, JSON.stringify(await lignes()) === avant], [400, 'ENTREE', true]);
        }
        r = await del(X, { jeton: 'jeton-inconnu-abcdefghij99' });
        H.v('(2) jeton inconnu ⇒ 200 { success:true, supprimees:0, echecs:0 } (pas de 404), rien ne change', [r.statut, r.json, JSON.stringify(await lignes()) === avant], [200, { success: true, supprimees: 0, echecs: 0 }, true]);
        r = await del(X, { jeton: A });
        H.v('(1) effacer A par HTTP : 200 { supprimees:5, echecs:0 } ; 8 → 3 lignes, 8 → 3 objets', [r.statut, r.json, (await lignes()).length, client.objets.size], [200, { success: true, supprimees: 5, echecs: 0 }, 3, 3]);
        H.v('   le jeton de B est intact : 3 lignes de B', (await lignes()).every(l => l.jetonEmpreinte === empreinte(B)), true);
        client.panne.del = true; const cap = capturer();
        r = await del(X, { jeton: B }); cap.rendre(); client.panne.del = false;
        H.v('(4) R2 en panne : 200 { supprimees:0, echecs:3 }, lignes conservées', [r.statut, r.json, (await lignes()).length], [200, { success: true, supprimees: 0, echecs: 3 }, 3]);
        // la route n'efface QUE par le jeton : un porteur n'a aucun accès à autre chose (pas de filtre fourni par le corps)
        r = await del(X, { jeton: B, jetonEmpreinte: empreinte(A), _id: { $ne: null } });
        H.v('   des champs supplémentaires du corps (jetonEmpreinte, _id) sont ignorés : seul le jeton compte', [r.json.supprimees, (await lignes()).length], [3, 0]);
        await srv.fermer(); await db.col('installations').deleteMany({}); await vider();
    });

    // ═══ (5) la purge ═══
    await section('purge', async () => {
        const client = fauxClient(); const { banc } = nouveauBanc(client); const purge = nouvellePurge(client);
        await ecrireLigne(banc, image, { jeton: 'jeton-P1-abcdefghij1234' }); await ecrireLigne(banc, image, { jeton: 'jeton-P2-abcdefghij1234' });
        await ecrireLigne(banc, image, { jeton: 'jeton-P3-abcdefghij1234', issue: 'question' });
        const l0 = await lignes();
        H.v('départ : 3 lignes (2 confirmées, 1 en attente), 3 objets ; expireLe = le + 732 j', [l0.length, client.objets.size, l0.every(l => (l.expireLe - l.le) / JOUR === 732)], [3, 3, true]);
        const vingtTrois = new Date(T0.getTime() + 23 * 30.5 * JOUR);
        let b = await purge.purgerBanc(vingtTrois);
        H.v('(5) à 23 mois : rien des confirmées (2 lignes, 2 objets) ; la ligne en attente (plus de 24 h) part avec son objet', [(await lignes()).map(l => l.etat), client.objets.size, b.lignes], [['confirmee', 'confirmee'], 2, 1]);
        const apres24 = new Date(l0[0].expireLe.getTime() + JOUR);
        b = await purge.purgerBanc(new Date(Math.min(...l0.map(l => +l.expireLe)) - JOUR));
        H.v('   à 24 mois moins 1 jour : toujours rien', [(await lignes()).length, client.objets.size, b.lignes], [2, 2, 0]);
        b = await purge.purgerBanc(apres24);
        H.v('   à 24 mois et 1 jour : tout (0 ligne, 0 objet), bilan 2 lignes 2 objets', [(await lignes()).length, client.objets.size, b.lignes, b.objets], [0, 0, 2, 2]);
        // la limite exacte : expireLe <= maintenant
        await ecrireLigne(banc, image, { jeton: 'jeton-P4-abcdefghij1234' });
        const [l4] = await lignes();
        await purge.purgerBanc(new Date(l4.expireLe.getTime() - 1));
        const reste = (await lignes()).length;
        await purge.purgerBanc(new Date(l4.expireLe.getTime()));
        H.v('   expireLe <= maintenant : une milliseconde avant ⇒ garde (1) ; pile à expireLe ⇒ supprime (0)', [reste, (await lignes()).length], [1, 0]);
        // attente : 24 h au jour (cf. balayerAttente)
        await ecrireLigne(banc, image, { jeton: 'jeton-P5-abcdefghij1234', issue: 'question' });
        await purge.purgerBanc(new Date(T0.getTime() + 25 * H1));
        const garde25 = (await lignes()).length;
        await purge.purgerBanc(new Date(T0.getTime() + 49 * H1));
        H.v('   ligne en attente : à 25 h elle reste (le jour n\'a pas 24 h d\'avance), à 49 h elle part avec son objet', [garde25, (await lignes()).length, client.objets.size], [1, 0, 0]);
        // objets d'abord, lignes ensuite, et un objet qui ne part pas garde sa ligne
        await ecrireLigne(banc, image, { jeton: 'jeton-P6-abcdefghij1234' });
        let vue = null; client.avantSuppression = async () => { vue = (await lignes()).length; };
        await purge.purgerBanc(new Date(T0.getTime() + 800 * JOUR)); client.avantSuppression = null;
        H.v('   objets d\'abord : à l\'instant où R2 supprime, la ligne existe encore ; ensuite plus rien', [vue, (await lignes()).length, client.objets.size], [1, 0, 0]);
        await ecrireLigne(banc, image, { jeton: 'jeton-P7-abcdefghij1234' });
        client.panne.del = true; const cap = capturer();
        b = await purge.purgerBanc(new Date(T0.getTime() + 800 * JOUR)); cap.rendre(); client.panne.del = false;
        H.v('   suppression R2 en panne : la ligne est conservée avec son objet, échec compté', [(await lignes()).length, client.objets.size, b.echecs >= 1, b.lignes], [1, 1, true, 0]);
        b = await purge.purgerBanc(new Date(T0.getTime() + 800 * JOUR));
        H.v('   R2 revenu : la purge suivante termine', [(await lignes()).length, client.objets.size], [0, 0]);
        await vider();
    });

    // ═══ RULING 2 — le filet des orphelins ═══
    await section('orphelins', async () => {
        const client = fauxClient(); const { banc } = nouveauBanc(client); const purge = nouvellePurge(client);
        const cle1 = () => `banc-reel/v2/${hex()}.webp`, cleAtt = () => `banc-reel/v2/attente/${hex()}.webp`;
        const poser = (k, date) => { client.objets.set(k, Buffer.from('o')); client.dates.set(k, date); return k; };
        client.dateObjet = new Date(T0.getTime() - 100 * H1);          // les objets écrits par le banc sont VIEUX : seule la référence les protège
        await ecrireLigne(banc, image, { jeton: 'jeton-O1-abcdefghij1234' }); await ecrireLigne(banc, image, { jeton: 'jeton-O2-abcdefghij1234', issue: 'question' });
        const refs = (await lignes()).map(l => l.cleR2);
        const vieuxOrph = poser(cle1(), new Date(T0.getTime() - 49 * H1)), vieuxAtt = poser(cleAtt(), new Date(T0.getTime() - 49 * H1));
        const jeune = poser(cle1(), new Date(T0.getTime() - 47 * H1)), jeuneAtt = poser(cleAtt(), new Date(T0.getTime() - 1 * H1));
        const notes = poser('banc-reel/v2/notes.txt', new Date(T0.getTime() - 500 * H1)), dehors = poser(`autre/${hex()}.webp`, new Date(T0.getTime() - 500 * H1));
        const hors2 = poser(`banc-reel/${hex()}.webp`, new Date(T0.getTime() - 500 * H1));
        client.listeTout = true;
        const b = await purge.purgerBanc(T0);
        const restent = [...client.objets.keys()];
        H.v('(R2) orphelins de plus de 48 h (y compris sous attente/) supprimés : 2 ; les objets référencés par une ligne restent (2)', [b.orphelins, refs.every(k => restent.includes(k)), restent.includes(vieuxOrph), restent.includes(vieuxAtt)], [2, true, false, false]);
        H.v('   jamais un objet de moins de 48 h (jeune, jeune/attente), jamais un fichier du préfixe qui n\'a pas la forme d\'une clé, jamais hors préfixe', [restent.includes(jeune), restent.includes(jeuneAtt), restent.includes(notes), restent.includes(dehors), restent.includes(hors2)], [true, true, true, true, true]);
        H.v('   aucune commande R2 de suppression ne vise une clé référencée, jeune, ou hors du préfixe', dels(client).filter(k => refs.includes(k) || [jeune, jeuneAtt, notes, dehors, hors2].includes(k)), []);
        H.v('   les lignes n\'ont pas bougé (2)', (await lignes()).length, 2);
        // la ligne de l'objet référencé reste lue : un objet ancien MAIS référencé survit même si la ligne est en attente depuis peu
        // le lister qui échoue : pas d'orphelin supprimé, mais la purge des lignes se fait quand même
        const o2 = poser(cle1(), new Date(T0.getTime() - 60 * H1));
        client.panne.lister = true; const cap = capturer();
        const b2 = await purge.purgerBanc(new Date(T0.getTime() + 800 * JOUR)); cap.rendre(); client.panne.lister = false;
        H.v('   lister en panne : l\'orphelin reste ; les 2 lignes échues sont purgées quand même ; l\'échec du filet est compté', [client.objets.has(o2), (await lignes()).length, b2.lignes, b2.echecsOrphelins >= 1], [true, 0, 2, true]);
        // Mongo qui ne répond pas à la question « cette clé est-elle référencée ? » : on ne supprime JAMAIS sans conclure
        const o3 = poser(cle1(), new Date(T0.getTime() - 60 * H1));
        // la lecture des références (find à PROJECTION) échoue ; la lecture des lignes échues, elle, répond (vide)
        const colCassee = () => ({ find: (q, o) => ({ toArray: async () => { if (o && o.projection) throw Object.assign(new Error('Mongo HS'), { code: 'MONGO_HS' }); return []; } }), findOne: async () => null, deleteOne: async () => ({ deletedCount: 0 }) });
        const p3 = nouvellePurge(client, { colFn: () => colCassee() }); const cap3 = capturer();
        await p3.purgerBanc(T0); cap3.rendre();
        H.v('   Mongo qui lève sur la recherche de référence : l\'orphelin n\'est PAS supprimé (« je ne sais pas » n\'est jamais « personne »)', client.objets.has(o3), true);
        // (I3) pas de N² : les références sont lues par UNE requête à projection, jamais une requête par objet
        for (let i = 0; i < 6; i++) poser(cle1(), new Date(T0.getTime() - 60 * H1));
        await ecrireLigne(banc, image, { jeton: 'jeton-O3-abcdefghij1234' }); await ecrireLigne(banc, image, { jeton: 'jeton-O4-abcdefghij1234' });
        const compteurs = {}; const p4 = nouvellePurge(client, { colFn: colRassise(null, compteurs) });
        const b4 = await p4.purgerBanc(T0);
        H.v('(I3) filet sur 6 orphelins + 2 référencés (+ le reste du préfixe) : 0 findOne ; 2 find (lignes échues, puis références AVEC projection) ; 8 orphelins supprimés (les 6 + o2 et o3 restés des cas précédents)',
            [compteurs.findOne || 0, compteurs.find, compteurs.projections, b4.orphelins], [0, 2, [false, true], 8]);
        // la sauvegarde de la garde : le seul chemin vers la suppression d'un orphelin est (préfixe, forme de clé, >48 h, aucune ligne)
        const refVieille = poser(cle1(), new Date(T0.getTime() - 900 * H1));
        await db.col('banc_lignes').insertOne({ _id: 'fab', cleR2: refVieille, etat: 'confirmee', source: 'affirme', verite: 1, expireLe: new Date(T0.getTime() + 400 * JOUR), le: T0, jetonEmpreinte: 'x', versionTexte: 'v', versionModele: null });
        await purge.purgerBanc(T0);
        H.v('   un objet de 900 h référencé par une ligne (fabriquée) survit', client.objets.has(refVieille), true);
        await vider();
    });

    // ═══ I4 — UNE définition de « échue » et de « objet puis ligne » : une ligne confirmée entre la lecture et la suppression n'est JAMAIS supprimée ═══
    await section('I4', async () => {
        const C = 'jeton-I4-abcdefghij1234';
        const monter = async () => {
            const client = fauxClient(); const { banc: ecrivain } = nouveauBanc(client);
            const scanId = await ecrireLigne(ecrivain, image, { jeton: C, issue: 'question' });
            const l0 = (await lignes())[0];
            const pendant = async () => { await ecrivain.corriger({ corps: consentement(C), scanId, carte: 0, idProduct: 55 }); };
            return { client, l0, pendant };
        };
        const etat = async (client, l0) => { const ls = await lignes(); return [ls.length, ls[0] && ls[0].etat, ls[0] && ls[0].source, ls[0] && ls[0].cleR2 !== l0.cleR2, ls[0] ? client.objets.has(ls[0].cleR2) : null, client.objets.has(l0.cleR2)]; };
        const ATTENDU = [1, 'confirmee', 'correction', true, true, false];
        let m = await monter();
        const b = await nouvellePurge(m.client, { colFn: colRassise(m.pendant) }).purgerBanc(new Date(T0.getTime() + 49 * H1));
        H.v('(I4) purgerBanc : une ligne d\'attente lue puis CONFIRMÉE (correction) avant sa suppression reste, avec sa copie finale ; l\'ancien objet est parti', [await etat(m.client, m.l0), b.lignes], [ATTENDU, 0]);
        await vider(); m = await monter();
        const bb = await nouveauBanc(m.client, colRassise(m.pendant)).banc.balayerAttente(new Date(T0.getTime() + 49 * H1));
        H.v('   balayerAttente : idem (même définition)', [await etat(m.client, m.l0), bb.supprimees], [ATTENDU, 0]);
        await vider(); m = await monter();
        const be = await nouvellePurge(m.client, { colFn: colRassise(m.pendant) }).effacerParJeton(C);
        H.v('   effacerParJeton : idem — la ligne devenue autre n\'est pas supprimée, et l\'effacement le DIT (echecs 1 : il reste une ligne du jeton)', [await etat(m.client, m.l0), be], [ATTENDU, { supprimees: 0, echecs: 1 }]);
        await vider();
        // les trois entrées appellent les définitions partagées
        const K = require('../banc/commun');
        H.v('   le module commun exporte lignesEchues, supprimerObjetPuisLigne, jourUTC, creerBorner, JOUR_MS', ['lignesEchues', 'supprimerObjetPuisLigne', 'jourUTC', 'creerBorner', 'JOUR_MS'].map(k => k in K), Array(5).fill(true));
    });

    // ═══ M5 — effacerParJeton défend aussi sa propre entrée ═══
    await section('M5', async () => {
        const purge = nouvellePurge(fauxClient());
        const code = async j => { try { await purge.effacerParJeton(j); return null; } catch (e) { return e.code; } };
        H.v('(M5) effacerParJeton avec un jeton mal formé (court, 65 car., espace, nombre, null, objet) ⇒ ENTREE', [await code('court'), await code('a'.repeat(65)), await code('jeton avec espace!!!'), await code(12345678901234567), await code(null), await code({})], Array(6).fill('ENTREE'));
    });

    // ═══ M3 — listerObjets suit la pagination (plus de 1 000 clés) ═══
    await section('M3', async () => {
        const r2 = require('../../collecte-cartes/r2');
        const tailles = [1000, 1000, 500]; const envois = []; let prefixeVu = null;
        r2._poserClient({ send: async cmd => { const t = cmd.input.ContinuationToken; const i = t ? Number(t) : 0; envois.push(i); prefixeVu = cmd.input.Prefix;
            return { Contents: Array.from({ length: tailles[i] }, (_, k) => ({ Key: `banc-reel/v2/${String(i * 1000 + k).padStart(32, '0')}.webp`, LastModified: new Date(T0) })), IsTruncated: i < 2, NextContinuationToken: String(i + 1) }; } });
        let l; try { l = await r2.listerObjets(BUCKET, 'banc-reel/v2/'); } finally { r2._poserClient(null); }
        H.v('(M3) listerObjets : 2 500 clés sur 3 pages (1 000 + 1 000 + 500), toutes avec leur date, préfixe transmis', [l.length, envois, l.every(o => o.modifieLe instanceof Date), prefixeVu, new Set(l.map(o => o.cle)).size], [2500, [0, 1, 2], true, 'banc-reel/v2/', 2500]);
    });

    // ═══ M1 — un scanId se normalise en minuscules à UN seul endroit (le calcul de l'_id de la ligne) ═══
    await section('M1', async () => {
        const client = fauxClient(); const { banc } = nouveauBanc(client);
        const sid = '65000000000000000000abcd', MAJ = sid.toUpperCase();
        await banc.apresVerdict({ corps: consentement(), scanId: sid, carte: 0, issue: 'question', imageRedressee: image, detectionSure: true });
        await banc.apresReponse({ corps: consentement(), scanId: MAJ, carte: 0, choix: 'a', idProduct: 777 });
        let l = (await lignes())[0] || {};
        H.v('(M1) apresReponse avec le scanId en MAJUSCULES retrouve la ligne : confirmee / reponse / 777', [(await lignes()).length, l.etat, l.source, l.verite], [1, 'confirmee', 'reponse', 777]);
        await banc.corriger({ corps: consentement(), scanId: MAJ, carte: 0, idProduct: 888 });
        l = (await lignes())[0] || {};
        H.v('   corriger (MAJUSCULES) retrouve la ligne : correction / 888', [l.source, l.verite], ['correction', 888]);
        await vider(); client.objets.clear();
        await banc.apresVerdict({ corps: consentement(), scanId: MAJ, carte: 0, issue: 'question', imageRedressee: image, detectionSure: true });
        await banc.apresAbandon({ scanId: sid, carte: 0 });
        H.v('   écrite en MAJUSCULES, abandonnée en minuscules : la même ligne (0 ligne, 0 objet)', [(await lignes()).length, client.objets.size], [0, 0]);
        await vider();
    });

    // ═══ I1 étendu — le jeton de consentement ne doit être AUCUNE empreinte d'accès du porteur (toutes les installations / sessions du compte) ═══
    await section('I1 étendu', async () => {
        const K = require('../banc/commun');
        const compteId = new mongoose.Types.ObjectId();
        const [jA, jB, jH, jC, jS, jSans, jD, jDH] = Array.from({ length: 8 }, () => J.genererJeton());
        const inst = (j, plus = {}) => Object.assign(M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(j), essais: 3, libelle: 'x' }), plus);
        const iA = inst(jA, { compteId }), iB = inst(jB, { compteId, heriteEmpreinte: J.empreinte(jH) }), iC = inst(jC, { compteId, revoqueeLe: new Date() });
        const iD = inst(jD, { heriteEmpreinte: J.empreinte(jDH) });
        await db.col('installations').insertMany([iA, iB, iC, iD]);
        await db.col('sessions').insertOne({ tokenEmpreinte: J.empreinte(jS), compteId, creeLe: new Date(), vueLe: new Date(), expireLe: new Date(Date.now() + 86400e3) });
        const reqCompte = jeton => ({ body: consentement(jeton), v2: { porteur: { type: 'compte', id: compteId, installation: iA, compte: { _id: compteId } } } });
        const reqInst = jeton => ({ body: consentement(jeton), v2: { porteur: { type: 'installation', id: iD._id, compte: null, installation: iD } } });
        const a = (req, colFn) => K.consentementAutorise(req, cfg, colFn);
        H.v('(I1+) compte : jeton d\'accès de l\'installation COURANTE ⇒ refusé', await a(reqCompte(jA)), false);
        H.v('   le jeton d\'une AUTRE installation du même compte ⇒ refusé', await a(reqCompte(jB)), false);
        H.v('   le jeton HÉRITÉ (heriteEmpreinte) d\'une installation du compte ⇒ refusé', await a(reqCompte(jH)), false);
        H.v('   le jeton d\'une installation RÉVOQUÉE du compte ⇒ refusé', await a(reqCompte(jC)), false);
        H.v('   le jeton d\'une SESSION du compte ⇒ refusé', await a(reqCompte(jS)), false);
        H.v('   un jeton sans rapport ⇒ autorisé', await a(reqCompte(jSans)), true);
        H.v('   installation sans compte : son jeton, son jeton hérité ⇒ refusés ; un jeton sans rapport ⇒ autorisé', [await a(reqInst(jD)), await a(reqInst(jDH)), await a(reqInst(jSans))], [false, false, true]);
        const panne = () => ({ find: () => ({ toArray: async () => { throw Object.assign(new Error('Mongo HS'), { code: 'MONGO_HS' }); } }), findOne: async () => { throw new Error('Mongo HS'); } });
        const cap = capturer(); const rp = await a(reqCompte(jSans), panne); cap.rendre();
        H.v('   lecture Mongo en panne ⇒ refusé (« je ne sais pas » ne conserve pas), même pour un jeton sans rapport', rp, false);
        H.v('   consentement invalide ⇒ refusé, sans aucune lecture', await a({ body: {}, v2: reqCompte(jSans).v2 }, () => { throw new Error('lecture interdite'); }), false);
        H.v('   (la fonction ne vit plus dans le crochet) crochet.consentementAutorise n\'est plus exporté', 'consentementAutorise' in require('../banc/crochet'), false);
        await db.col('installations').deleteMany({}); await db.col('sessions').deleteMany({});
    });

    // ═══ N2 / N3 — apresAbandon : la définition commune « objet puis ligne », deleteOne porteur de la cleR2 ═══
    await section('N2/N3', async () => {
        const client = fauxClient(); const filtres = [];
        const colEspion = n => { const r = db.col(n); return { findOne: (...x) => r.findOne(...x), find: (...x) => r.find(...x), insertOne: (...x) => r.insertOne(...x), updateOne: (...x) => r.updateOne(...x), deleteOne: (f, ...x) => { filtres.push(f); return r.deleteOne(f, ...x); } }; };
        const ecr = nouveauBanc(client).banc, sp = nouveauBanc(client, colEspion).banc;
        const scanId = await ecrireLigne(ecr, image, { jeton: 'jeton-N2-abcdefghij1234', issue: 'question' });
        await sp.apresAbandon({ scanId, carte: 0 });
        H.v('(N2) apresAbandon : le deleteOne porte _id, cleR2 ET etat (le filtre d\'attente est gardé)', [filtres.length, Object.keys(filtres[0] || {}).sort(), (filtres[0] || {}).etat], [1, ['_id', 'cleR2', 'etat'], 'attente']);
        H.v('   ligne et objet supprimés', [(await lignes()).length, client.objets.size], [0, 0]);
        // la ligne est confirmée entre la lecture et la suppression : elle reste, avec sa copie finale
        const s2 = await ecrireLigne(ecr, image, { jeton: 'jeton-N2-abcdefghij1234', issue: 'question' }); const l0 = (await lignes())[0];
        const colStale = n => { const r = db.col(n); return { findOne: async (...x) => { const l = await r.findOne(...x); await ecr.corriger({ corps: consentement('jeton-N2-abcdefghij1234'), scanId: s2, carte: 0, idProduct: 55 }); return l; }, find: (...x) => r.find(...x), insertOne: (...x) => r.insertOne(...x), updateOne: (...x) => r.updateOne(...x), deleteOne: (...x) => r.deleteOne(...x) }; };
        await nouveauBanc(client, colStale).banc.apresAbandon({ scanId: s2, carte: 0 });
        const ls = await lignes();
        H.v('(N3) abandon d\'une ligne confirmée entre-temps : la ligne confirmée et sa copie finale restent', [ls.length, ls[0] && ls[0].etat, ls[0] && client.objets.has(ls[0].cleR2), client.objets.has(l0.cleR2)], [1, 'confirmee', true, false]);
        // le code ne garde plus sa propre copie : la suppression passe par la fonction commune
        const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'banc', 'routes.js'), 'utf8');
        const bloc = src.slice(src.indexOf('async apresAbandon'), src.indexOf('async corriger'));
        H.v('   apresAbandon appelle supprimerObjetPuisLigne (pas de s.supprimer / deleteOne propres)', [/supprimerObjetPuisLigne/.test(bloc), /\.deleteOne\(|\bs\.supprimer\(/.test(bloc)], [true, false]);
        await vider(); client.objets.clear();
    });

    // ═══ (6) la purge tourne chaque jour dans monter.js ═══
    await section('minuterie', async () => {
        H.v('(6) la périodicité est de 24 h', monterBanc.INTERVALLE_PURGE_MS, 24 * 3600 * 1000);
        let appels = 0; const faux = { purgerBanc: async () => { appels++; return {}; } };
        H.v('   Mongo pas prêt : la passe ne fait rien (false), 0 appel', [await monterBanc.purgerUneFois({ etatMongo: () => 0, purge: faux }), appels], [false, 0]);
        H.v('   Mongo prêt : une passe (true), 1 appel', [await monterBanc.purgerUneFois({ etatMongo: () => 1, purge: faux }), appels], [true, 1]);
        const cap = capturer(); let leve = null, r;
        try { r = await monterBanc.purgerUneFois({ etatMongo: () => 1, purge: { purgerBanc: async () => { throw new Error('boum https://secret.exemple'); } } }); } catch (e) { leve = e; }
        cap.rendre();
        H.v('   une passe qui échoue ne lève pas (false) et son journal ne cite pas le message', [leve, r, cap.vus.length > 0, /secret\.exemple/.test(cap.vus.join())], [null, false, true, false]);
        const m = monterBanc.demarrerPurge(faux, 20, () => 1); await attendre(130); monterBanc.arreterPurge();
        H.v('   demarrerPurge(…, 20 ms) : le minuteur se déclenche plusieurs fois, ne retient pas le processus (unref), s\'arrête', [appels >= 3, m.hasRef(), monterBanc.minuteurPurge()], [true, false, null]);
        // (I2) une passe DIFFÉRÉE au démarrage (10 min, unref, seulement si Mongo est prêt), puis toutes les 24 h ; un seul de chaque par processus
        const fabrique = () => { const t = []; const mk = type => (fn, ms) => { const h = { type, fn, ms, annule: false, unrefd: false, unref() { h.unrefd = true; return h; } }; t.push(h); return h; };
            return { t, setTimeout: mk('timeout'), setInterval: mk('interval'), clearTimeout: h => { if (h) h.annule = true; }, clearInterval: h => { if (h) h.annule = true; }, actifs: type => t.filter(h => h.type === type && !h.annule) }; };
        const mn = fabrique(); let passes = 0; const fp = { purgerBanc: async () => { passes++; return {}; } };
        H.v('(I2) le différé par défaut est de 10 min', monterBanc.DIFFERE_PURGE_MS, 600000);
        monterBanc.demarrerPurge(fp, 1000, () => 1, { minuteurs: mn }); monterBanc.demarrerPurge(fp, 1000, () => 1, { minuteurs: mn });
        const dif = mn.actifs('timeout')[0], iv = mn.actifs('interval')[0];
        H.v('   deux montages ⇒ UN seul différé et UN seul intervalle actifs (4 minuteurs créés, 2 annulés)', [mn.actifs('timeout').length, mn.actifs('interval').length, mn.t.length], [1, 1, 4]);
        H.v('   le différé dure 10 min et ne retient pas le processus ; l\'intervalle suit la cadence donnée, unref', [dif && dif.ms, dif && dif.unrefd, iv && iv.ms, iv && iv.unrefd], [600000, true, 1000, true]);
        if (dif) { await dif.fn(); await attendre(30); }
        H.v('   à l\'échéance du différé, Mongo prêt : UNE passe', passes, 1);
        const mn2 = fabrique(); monterBanc.demarrerPurge(fp, 1000, () => 0, { minuteurs: mn2 }); const d2 = mn2.actifs('timeout')[0]; if (d2) { await d2.fn(); await attendre(30); }
        H.v('   Mongo pas prêt à l\'échéance : aucune passe de plus', passes, 1);
        monterBanc.arreterPurge();
        H.v('   arreterPurge annule le différé ET l\'intervalle', [mn2.actifs('timeout').length, mn2.actifs('interval').length], [0, 0]);
        const router = express.Router(); monterBanc.routes(router, cfg, { banc: nouveauBanc(fauxClient()).banc, purge: faux });
        H.v('   routes() arme aussi le différé réel (unref)', [monterBanc.differePurge() !== null, monterBanc.differePurge() && monterBanc.differePurge().hasRef()], [true, false]);
        const arme = monterBanc.minuteurPurge();
        H.v('   routes() arme UN minuteur unref ; remonter ne duplique pas', [arme !== null, arme && arme.hasRef()], [true, false]);
        const avant = appels; monterBanc.routes(express.Router(), cfg, { banc: nouveauBanc(fauxClient()).banc, purge: faux });
        H.v('   (remonté : toujours un seul minuteur, aucune passe immédiate au démarrage)', [appels === avant, monterBanc.minuteurPurge() !== arme], [true, true]);
        monterBanc.arreterPurge();
    });

    // ═══ (6) le CLI : node v2/banc/purge.js --base=… ═══
    await section('CLI', async () => {
        const { analyserArgs, lancerCLI } = P();
        const ok = (...a) => analyserArgs(a);
        H.v('(6) --base=test sans --confirmer-production : refusé', !!ok('--base=test').erreur, true);
        H.v('   --base=test --confirmer-production : accepté (base test)', [ok('--base=test', '--confirmer-production').erreur, ok('--base=test', '--confirmer-production').base], [undefined, 'test']);
        H.v('   --base=test_scratch : accepté sans confirmation', [ok('--base=test_scratch').erreur, ok('--base=test_scratch').base], [undefined, 'test_scratch']);
        H.v('   écrit par ce qu\'on AUTORISE : base absente, vide, `cartes`, inconnue, argument inconnu, base en double ⇒ refus', [[], ['--base='], ['--base=cartes'], ['--base=autre'], ['--base=test_scratch', '--ecrire'], ['--base=test_scratch', '--base=test'], ['--confirmer-production']].map(a => !!ok(...a).erreur), Array(7).fill(true));
        // refus : aucune connexion tentée
        let connexions = 0; const connecter = async base => { connexions++; return base; };
        const cap = capturer();
        const c1 = await lancerCLI(['--base=test'], { connecter }); const c2 = await lancerCLI([], { connecter });
        cap.rendre();
        H.v('   un refus rend un code non nul et n\'ouvre AUCUNE connexion', [c1 !== 0, c2 !== 0, connexions], [true, true, 0]);
        // exécution sur la base EN MÉMOIRE et un faux R2 (jamais une base réelle)
        const client = fauxClient(); const { banc } = nouveauBanc(client);
        await ecrireLigne(banc, image, { jeton: 'jeton-C1-abcdefghij1234' }); await ecrireLigne(banc, image, { jeton: 'jeton-C2-abcdefghij1234' });
        const stockage = creerStockage({ client, bucket: BUCKET, env: { V2_BANC_BUCKET: BUCKET } }); stockage.verifierBucket = async () => { };
        const sortie = []; const cap2 = capturer();
        const code = await lancerCLI(['--base=test_scratch'], { connecter, stockage, horloge: () => new Date(T0.getTime() + 800 * JOUR), journal: l => sortie.push(l), env: { V2_BANC_BUCKET: BUCKET } });
        cap2.rendre();
        H.v('   --base=test_scratch (base en mémoire, faux R2) : code 0, une connexion, les 2 lignes échues et leurs objets supprimés, bilan imprimé avec son dénominateur', [code, connexions, (await lignes()).length, client.objets.size, /2 ligne/.test(sortie.join('\n'))], [0, 1, 0, 0, true]);
        H.v('   le bilan imprimé ne contient ni clé R2 ni empreinte', [/banc-reel|[0-9a-f]{40}/.test(sortie.join('\n'))], [false]);
    });

    // ═══ RULING 3 — l'abandon à 24 h exactes ═══
    await section('abandon 24 h', async () => {
        await db.col('questions').deleteMany({});
        const p = await compte({ solde: { accueil: 0, achete: 9 } });
        const t = new Date('2026-10-08T10:00:00Z'); let n = 0;
        const poser = async lot => { const scanId = `scQ${++n}x`; const d = await Lg.debiter(p, { scanId, cleIdempotence: `d|${scanId}`, maintenant: t }, cfg);
            await Q.reserverQuestion(p, d.credit, { scanId, carte: 0, raison: 'egalite', candidats: [111, 222], choix: [{ id: 'a', idProduct: 111 }, { id: 'b', idProduct: 222 }], lot }, cfg, t); return scanId; };
        const s1 = await poser(false), s2 = await poser(false), sl = await poser(true);
        const bil = await Q.balayerQuestions({ maintenant: new Date(t.getTime() + 24 * H1 + 1000), max: 50 }, cfg);
        H.v('balayerQuestions : le bilan liste les questions NON-lot abandonnées { scanId: String, carte } (2 sur 3 ; le lot est compté à part)',
            [bil.reglees, bil.lots, (bil.abandonnees || []).map(x => `${x.scanId}:${x.carte}:${typeof x.scanId}`).sort()], [2, 1, [`${s1}:0:string`, `${s2}:0:string`].sort()]);
        H.v('   les autres compteurs du bilan sont inchangés (remboursees 2, nonRemboursees 0, erreurs 0)', [bil.remboursees, bil.nonRemboursees, bil.erreurs], [2, 0, 0]);
        void sl;
        const bil2 = await Q.balayerQuestions({ maintenant: new Date(t.getTime() + 25 * H1), max: 50 }, cfg);
        H.v('   un second balayage ne les redonne pas', (bil2.abandonnees || []).length, 0);
        const jeune = await poser(false);
        const bil3 = await Q.balayerQuestions({ maintenant: new Date(t.getTime() + 23 * H1), max: 50 }, cfg);
        H.v('   à 23 h : rien d\'abandonné', (bil3.abandonnees || []).length, 0); void jeune;
        // monter.js : balayerQuestionsUneFois appelle apresAbandon pour chacune, sans jamais lever ni retarder
        const monterId = require('../identifier/monter');
        const vus = []; const fauxBanc = { apresAbandon: async o => { vus.push(o); } };
        const faux = { balayerQuestions: async () => ({ abandonnees: [{ scanId: 'aaa', carte: 0 }, { scanId: 'bbb', carte: 1 }] }) };
        const ret = await monterId.balayerQuestionsUneFois({ etatMongo: () => 1, argent: () => faux, banc: () => fauxBanc });
        await jusque(() => vus.length === 2, 500);
        H.v('balayerQuestionsUneFois : apresAbandon appelé pour chaque abandonnée, avec { scanId, carte }', [ret, vus], [true, [{ scanId: 'aaa', carte: 0 }, { scanId: 'bbb', carte: 1 }]]);
        const pendu = { apresAbandon: () => new Promise(() => { }) }; const t0 = Date.now();
        const r2 = await monterId.balayerQuestionsUneFois({ etatMongo: () => 1, argent: () => faux, banc: () => pendu });
        H.v('   un banc qui ne répond jamais ne retarde pas le balayage (< 500 ms)', [r2, Date.now() - t0 < 500], [true, true]);
        const cap = capturer(); let leve = null, r3;
        try { r3 = await monterId.balayerQuestionsUneFois({ etatMongo: () => 1, argent: () => faux, banc: () => ({ apresAbandon: async () => { throw new Error('boum'); } }) }); await attendre(60); } catch (e) { leve = e; }
        cap.rendre();
        H.v('   un banc qui lève : le balayage ne lève pas et reste vrai', [leve, r3], [null, true]);
        const cap4 = capturer(); const r4 = await monterId.balayerQuestionsUneFois({ etatMongo: () => 1, argent: () => faux, banc: () => { throw new Error('banc non fourni'); } }); cap4.rendre();
        H.v('   banc absent du registre : le balayage réussit quand même', r4, true);
        const r5 = await monterId.balayerQuestionsUneFois({ etatMongo: () => 1, argent: () => ({ balayerQuestions: async () => ({}) }), banc: () => fauxBanc });
        H.v('   un bilan sans `abandonnees` ({}) : rien appelé, pas d\'erreur', r5, true);
        await db.col('questions').deleteMany({});
    });

    // ═══ (7)(8) le crochet câblé, de bout en bout par HTTP ═══
    await section('crochet', async () => {
        const { dansUnScan } = require('../../sources'); const { assembler } = require('../index'); const pret = require('../pret');
        const EXP = 990003, ID_A = 895801, ID_B = 895802;
        for (const c of ['catalogue_produits', 'numeros_cartes', 'guide_prix', 'codes_set', 'visuels']) await raw(c).deleteMany({});
        await raw('codes_set').insertOne({ idExpansion: EXP, codeSet: 'PBL', apprisLe: new Date() });
        for (const [id, variante] of [[ID_A, 'normale'], [ID_B, 'reverse']]) {
            await raw('catalogue_produits').insertOne({ idProduct: id, name: 'Tropius (PBL 001)', idExpansion: EXP, idMetacard: 990301 });
            await raw('numeros_cartes').insertOne({ idProduct: id, idExpansion: EXP, numero: '001', numeroUrl: 'PBL001', codeSet: 'PBL', nomFr: 'Tropius', slug: 'Tropius-PBL001', slugSet: 'Banc-Set', source: 'cardmarket', certitude: 'exacte', ...(id === ID_B ? { variante: 'V2' } : {}) });
            await raw('guide_prix').insertOne({ idProduct: id, avg: 1.1, low: 0.5, trend: 1.0, avg1: 1.0, avg7: 1.0, avg30: 1.1, guideDu: new Date('2026-10-04') });
            await raw('visuels').insertOne({ idProduct: id, vignette: { cle: `banc/${id}-v.webp`, w: 300, h: 420 }, grande: null, mention: null, idMetacard: 990301, numero: '001', rarete: 'Common', total: '064', variante, setNom: 'Banc Set', lien: null });
        }
        const carteCorps = (id, ambigu) => ({ idProduct: id, nomProduit: 'Tropius', nom: 'Tropius', numero: '001', total: '064', setCode: 'PBL', rarete: null, langue: 'FR', ambigu });
        const ETAT = { estimeIA: null, confianceIA: null, defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: null };
        const cand = id => ({ idProduct: id, nom: 'Tropius', numero: '001', set: 'Banc Set', prix: 1, photoUrl: null });
        const base = { success: true, etat: ETAT, classement: [], guidePrix: {}, reverse: { attendue: false, motif: null, etat: 'aucun-motif', strategie: null }, codeLangue: 2 };
        const aff = id => ({ ...base, question: null, carte: carteCorps(id, false), candidats: [cand(id)] });
        const qst = ids => ({ ...base, question: { etat: 'en-attente', delaiHeures: 24 }, carte: carteCorps(ids[0], true), candidats: ids.map(cand) });
        let mode = 'affirmee';
        const chaine = async (req, res) => {
            if (mode === 'question') { await req.credit.v2.poserQuestion(req, { scanId: req.scanIdImpose, raison: 'egalite', candidats: [ID_A, ID_B] }); return res.json(qst([ID_A, ID_B])); }
            return res.json(aff(ID_A));
        };
        const identifierLot = async () => [{ statutHttp: 200, corps: aff(ID_A) }, { statutHttp: 200, corps: aff(ID_B) }, { statutHttp: 200, corps: aff(ID_A) }];
        let enLot = false;
        let appelsDetection = 0, detectionImpl = async () => ({ imageRedressee: image, detectionSure: true, versionModele: 'm1' });
        const detection = async arg => { appelsDetection++; return detectionImpl(arg); };
        const client = fauxClient(); const { banc } = nouveauBanc(client);
        registre.fournir('banc', banc);
        const monter = async deps => {
            const app = express(); app.set('trust proxy', true); app.use(require('../transport/cors').middlewareV2(cfg)); app.use(express.json()); app.use((q, s, n) => dansUnScan(n));
            pret.armer(M.verifierIndex);
            app.use(assembler([require('../argent/monter'), require('../identifier/monter'), monterBanc], cfg, { gererIdentifier: chaine, gererRetourLive: async (q, s) => s.json({ success: true }), banc, purge: nouvellePurge(client), ...deps, ...(enLot ? { identifierLot } : {}) }));
            return H.serveur(app);
        };
        const avecDet = await monter({ detection });
        enLot = true; const avecLot = await monter({ detection }); enLot = false;
        const sansDet = await monter({});
        const mkInst = async () => { const jeton = J.genererJeton(); const i = M.nouvelleInstallation({ jetonEmpreinte: J.empreinte(jeton), essais: 50, libelle: 'banc' }); await db.col('installations').insertOne(i); return { i, jeton }; };   // assez d'essais pour toutes les requêtes d'un scénario
        const ent = (jeton, plus = {}) => ({ origin: ORIGINE, ...ip(), authorization: `Bearer ${jeton}`, ...plus });
        const identifier = (srv, x, consent) => H.appel(srv.url, '/api/identifier', { methode: 'POST', entetes: ent(x.jeton, { 'idempotency-key': cle() }),
            corps: { contrat: 2, imageUrls: [require(require('path').join(__dirname, '..', '..', 'verrou', 'charges.json')).charges.find(c => c.cellule === 'occidentale').imageUrl], title: null, description: null, prixVinted: null, devise: null, marche: 'vinted.fr', versionExtension: '2.0.0', langueInterface: 'fr', ...(consent || {}) } });
        const repondre = (srv, x, corps) => H.appel(srv.url, '/api/identifier/reponse', { methode: 'POST', entetes: ent(x.jeton), corps });
        const normaliser = r => JSON.stringify(r.json).replace(/"scanId":"[0-9a-f]{24}"/g, '"scanId":"<id>"');
        const reset = async () => { await vider(); client.objets.clear(); client.commandes.length = 0; appelsDetection = 0; detectionImpl = async () => ({ imageRedressee: image, detectionSure: true, versionModele: 'm1' }); client.panne.put = false; client.dateObjet = T0; };

        // (7) sans consentement : la détection n'est même pas appelée
        await reset(); mode = 'affirmee';
        let x = await mkInst(); let r = await identifier(avecDet, x, null); await attendre(150);
        H.v('(7) sans consentement : 200 identifiée ; zéro ligne, zéro objet, zéro appel du détecteur', [r.statut, r.json.analyse.statut, (await lignes()).length, client.objets.size, appelsDetection], [200, 'identifiee', 0, 0, 0]);
        r = await identifier(avecDet, x, { consentementBanc: { version: 'inconnue', le: new Date().toISOString(), jeton: 'jeton-test-abcdefghij1234' } }); await attendre(150);
        H.v('   consentement invalide (version inconnue) : idem', [(await lignes()).length, appelsDetection], [0, 0]);
        // production d'aujourd'hui : pas de crochet detection
        r = await identifier(sansDet, x, consentement()); await attendre(150);
        H.v('(7) consentement valide mais AUCUN crochet `deps.detection` (la production d\'aujourd\'hui) : rien n\'est conservé', [r.statut, (await lignes()).length, client.objets.size, client.commandes.length], [200, 0, 0, 0]);
        // détecteur qui ne fournit pas de quoi conserver
        for (const [nom, impl] of [['detectionSure:false', async () => ({ imageRedressee: image, detectionSure: false })], ['image absente', async () => ({ detectionSure: true })], ['image non-Buffer', async () => ({ imageRedressee: 'texte', detectionSure: true })],
            ['résultat null', async () => null], ['détecteur qui lève', async () => { throw new Error('boum'); }], ['détecteur qui rend detectionSure:"true"', async () => ({ imageRedressee: image, detectionSure: 'true' })]]) {
            detectionImpl = impl; appelsDetection = 0;
            const cap = capturer(); r = await identifier(avecDet, x, consentement()); await attendre(150); cap.rendre();
            H.v(`   détecteur : ${nom} ⇒ réponse 200, rien conservé (appelé ${appelsDetection} fois)`, [r.statut, (await lignes()).length, client.objets.size], [200, 0, 0]);
        }
        // avec consentement + détecteur : une ligne
        await reset();
        r = await identifier(avecDet, x, consentement());
        const ecrite = await jusque(async () => (await lignes()).length === 1);
        const l = (await lignes())[0] || {};
        H.v('(7) consentement valide + détecteur sûr : une ligne confirmee / affirme, vérité = l\'idProduct affiché, un objet, détecteur appelé 1 fois', [r.statut, ecrite, l.etat, l.source, l.verite, client.objets.size, appelsDetection], [200, true, 'confirmee', 'affirme', ID_A, 1, 1]);
        H.v('   le document n\'a que les clés du plan et ne contient ni scanId ni installationId', [Object.keys(l).sort(), JSON.stringify(l).includes(r.json.scanId), JSON.stringify(l).includes(x.i._id)], [['_id', 'cleR2', 'etat', 'expireLe', 'jetonEmpreinte', 'le', 'source', 'verite', 'versionModele', 'versionTexte'], false, false]);
        H.v('   l\'identifiant du scan passé au détecteur est une CHAÎNE (String(scanId)) : la ligne a pour _id sha256(scanId|0|sel)', l._id, crypto.createHash('sha256').update(`${r.json.scanId}|0|${SEL}`).digest('hex'));

        // un LOT ne conserve rien : la détection juge une carte
        await reset();
        const lotR = await identifier(avecLot, x, consentement()); await attendre(200);
        H.v('(7) un LOT + consentement valide + détecteur sûr : analyse.statut lot (3 cartes), zéro ligne, zéro objet, détecteur JAMAIS appelé', [lotR.json.analyse.statut, lotR.json.analyse.cartes.length, (await lignes()).length, client.objets.size, appelsDetection], ['lot', 3, 0, 0, 0]);

        // question puis réponse
        await reset(); mode = 'question';
        r = await identifier(avecDet, x, consentement());
        await jusque(async () => (await lignes()).length === 1);
        const att = (await lignes())[0] || {}; const scanId = r.json.scanId;
        const ids = Object.fromEntries(r.json.analyse.cartes[0].question.choix.map(c => [c.id, c.idProduct]));
        H.v('(7) question + consentement + détecteur : une ligne `attente`, vérité vide, objet sous attente/', [r.json.analyse.statut, att.etat, att.verite, /\/attente\//.test(att.cleR2 || ''), client.objets.has(att.cleR2)], ['a-trancher', 'attente', null, true, true]);
        // un AUTRE porteur ne peut pas abandonner ni confirmer cette question : 404, la ligne ne bouge pas
        const y = await mkInst(); const avantY = JSON.stringify(await lignes());
        const rY = await repondre(avecDet, y, { scanId, carte: 0, choix: 'aucune', ...consentement() }); await attendre(150);
        H.v('(7) /reponse par un autre porteur : 404 et le crochet n\'est PAS appelé (la ligne en attente est intacte)', [rY.statut, JSON.stringify(await lignes()) === avantY, client.objets.has(att.cleR2)], [404, true, true]);
        // réponse sans le consentement ou avec un autre jeton : pas de confirmation
        const rSans = await repondre(avecDet, x, { scanId, carte: 0, choix: 'a' }); await attendre(150);
        H.v('   réponse `a` SANS consentement : la question est répondue (200) mais la ligne reste en attente (rien n\'est confirmé sans consentement)', [rSans.statut, (await lignes())[0].etat], [200, 'attente']);
        await reset(); mode = 'question';
        r = await identifier(avecDet, x, consentement()); await jusque(async () => (await lignes()).length === 1);
        const sid = r.json.scanId; const idc = Object.fromEntries(r.json.analyse.cartes[0].question.choix.map(c => [c.id, c.idProduct]));
        const cleAtt = (await lignes())[0].cleR2;
        const rA = await repondre(avecDet, x, { scanId: sid, carte: 0, choix: 'a', ...consentement() });
        const confirmee = await jusque(async () => { const q = (await lignes())[0]; return q && q.etat === 'confirmee'; });
        const lc = (await lignes())[0] || {};
        H.v('(7) réponse `a` avec le même consentement : 200 identifiée ; la ligne passe à confirmee / reponse, vérité = idProduct du choix, l\'objet quitte attente/', [rA.statut, confirmee, lc.source, lc.verite, client.objets.has(cleAtt), client.objets.has(lc.cleR2), client.objets.size], [200, true, 'reponse', idc.a, false, true, 1]);
        void ids;
        // abandon : aucune / ne-sait-pas
        for (const choix of ['aucune', 'ne-sait-pas']) {
            await reset(); mode = 'question';
            r = await identifier(avecDet, x, consentement()); await jusque(async () => (await lignes()).length === 1);
            const rr = await repondre(avecDet, x, { scanId: r.json.scanId, carte: 0, choix });   // SANS consentement : effacer n'est jamais conserver
            const parti = await jusque(async () => (await lignes()).length === 0);
            H.v(`   \`${choix}\` (sans consentement dans la réponse) : 200, ligne ET objet supprimés`, [rr.statut, parti, client.objets.size], [200, true, 0]);
        }
        // réponse rejouée : pas d'effet de plus
        await reset(); mode = 'question';
        r = await identifier(avecDet, x, consentement()); await jusque(async () => (await lignes()).length === 1);
        const corpsR = { scanId: r.json.scanId, carte: 0, choix: 'a', ...consentement() };
        await repondre(avecDet, x, corpsR); await jusque(async () => (await lignes())[0].etat === 'confirmee');
        const avantRejeu = JSON.stringify(await lignes()); const rej = await repondre(avecDet, x, corpsR); await attendre(200);
        H.v('   la même réponse rejouée : 200, ligne et objet inchangés (1, 1)', [rej.statut, JSON.stringify(await lignes()) === avantRejeu, client.objets.size], [200, true, 1]);

        // (M1) /reponse avec le scanId en MAJUSCULES retrouve la ligne
        await reset(); mode = 'question';
        r = await identifier(avecDet, x, consentement()); await jusque(async () => (await lignes()).length === 1);
        const rMaj = await repondre(avecDet, x, { scanId: r.json.scanId.toUpperCase(), carte: 0, choix: 'a', ...consentement() });
        const okMaj = await jusque(async () => (await lignes())[0].etat === 'confirmee');
        H.v('(M1) /reponse avec le scanId en MAJUSCULES : 200 et la ligne passe à confirmee', [rMaj.statut, okMaj], [200, true]);

        // (I1) le jeton de consentement ne doit pas être le jeton d'ACCÈS : sinon jetonEmpreinte = installations.jetonEmpreinte et la ligne se rattache à l'installation
        await reset(); mode = 'affirmee';
        const xa = await mkInst(); const AUTRE = 'un-autre-jeton-abcdefghij1234';
        let ri = await identifier(avecDet, xa, consentement(xa.jeton)); await attendre(250);
        H.v('(I1) /identifier : consentementBanc.jeton = le jeton Bearer ⇒ 200, 0 ligne, 0 objet, détecteur jamais appelé', [ri.statut, (await lignes()).length, client.objets.size, appelsDetection], [200, 0, 0, 0]);
        ri = await identifier(avecDet, xa, consentement(AUTRE)); const un = await jusque(async () => (await lignes()).length === 1);
        H.v('   un jeton de consentement DIFFÉRENT du jeton d\'accès ⇒ 1 ligne', [un, (await lignes())[0] && (await lignes())[0].jetonEmpreinte === empreinte(AUTRE), (await lignes())[0] && (await lignes())[0].jetonEmpreinte === xa.i.jetonEmpreinte], [true, true, false]);
        // /reponse : une ligne en attente portant l'empreinte du jeton d'accès (fabriquée en direct, hors crochet) n'est pas confirmée
        await reset(); mode = 'question';
        ri = await identifier(avecDet, xa, null);
        await banc.apresVerdict({ corps: consentement(xa.jeton), scanId: ri.json.scanId, carte: 0, issue: 'question', imageRedressee: image, detectionSure: true });
        const avantI1 = JSON.stringify(await lignes());
        const rI1 = await repondre(avecDet, xa, { scanId: ri.json.scanId, carte: 0, choix: 'a', ...consentement(xa.jeton) }); await attendre(250);
        H.v('   /reponse avec le jeton d\'accès comme jeton de consentement : 200 (question répondue) mais la ligne n\'est pas confirmée', [rI1.statut, (await lignes())[0].etat, JSON.stringify(await lignes()) === avantI1], [200, 'attente', true]);
        // /api/banc/correction
        await reset(); mode = 'affirmee';
        ri = await identifier(avecDet, xa, null);
        await banc.apresVerdict({ corps: consentement(xa.jeton), scanId: ri.json.scanId, carte: 0, issue: 'affirmee', idProduct: ID_A, imageRedressee: image, detectionSure: true });
        const postCorr = (corps) => H.appel(avecDet.url, '/api/banc/correction', { methode: 'POST', corps, entetes: ent(xa.jeton) });
        const rc = await postCorr({ scanId: ri.json.scanId, idProduct: 31, ...consentement(xa.jeton) }); await attendre(150);
        H.v('   /api/banc/correction avec le jeton d\'accès comme jeton de consentement : 200, vérité inchangée', [rc.statut, (await lignes())[0].verite, (await lignes())[0].source], [200, ID_A, 'affirme']);
        // contrôle positif : la même ligne portant un AUTRE jeton se corrige bien
        await reset();
        ri = await identifier(avecDet, xa, null);
        await banc.apresVerdict({ corps: consentement(AUTRE), scanId: ri.json.scanId, carte: 0, issue: 'affirmee', idProduct: ID_A, imageRedressee: image, detectionSure: true });
        await postCorr({ scanId: ri.json.scanId, idProduct: 31, ...consentement(AUTRE) }); await attendre(150);
        H.v('   (contrôle positif) un jeton de consentement différent : la correction s\'applique', [(await lignes())[0].verite, (await lignes())[0].source], [31, 'correction']);

        // (M6 + CORS) DELETE /api/banc/contributions par l'assembleur RÉEL (garde d'index, CORS) ; préflight DELETE pour ce seul chemin
        await reset();
        const ACAO = 'access-control-allow-origin', METH = 'access-control-allow-methods';
        const Cdel = 'jeton-del-abcdefghij123456';
        for (let i = 0; i < 2; i++) await banc.apresVerdict({ corps: consentement(Cdel), scanId: scanHex(900 + i), carte: 0, issue: 'affirmee', idProduct: ID_A, imageRedressee: image, detectionSure: true });
        const delH = (corps, bearer) => H.appel(avecDet.url, '/api/banc/contributions', { methode: 'DELETE', corps, entetes: { origin: ORIGINE, ...ip(), ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) } });
        let rd = await delH({ jeton: Cdel }, null);
        H.v('(M6) DELETE par l\'assembleur réel, sans Bearer : 401, en-têtes CORS présents, rien effacé (2 lignes)', [rd.statut, rd.entetes[ACAO], (await lignes()).length], [401, ORIGINE, 2]);
        rd = await delH({ jeton: 'court' }, xa.jeton);
        H.v('   jeton mal formé : 400 ENTREE', [rd.statut, rd.json && rd.json.erreur && rd.json.erreur.code], [400, 'ENTREE']);
        rd = await delH({ jeton: Cdel }, xa.jeton);
        H.v('   DELETE valide : 200 { supprimees: 2, echecs: 0 }, 0 ligne, 0 objet, en-têtes CORS présents', [rd.statut, rd.json, (await lignes()).length, client.objets.size, rd.entetes[ACAO]], [200, { success: true, supprimees: 2, echecs: 0 }, 0, 0, ORIGINE]);
        const pre = (chemin, origine) => H.appel(avecDet.url, chemin, { methode: 'OPTIONS', entetes: { origin: origine, 'access-control-request-method': 'DELETE' } });
        let p = await pre('/api/banc/contributions', ORIGINE);
        H.v('(CORS) préflight extension sur /api/banc/contributions : 204 et DELETE autorisé', [p.statut, /\bDELETE\b/.test(p.entetes[METH] || ''), p.entetes[ACAO]], [204, true, ORIGINE]);
        const autres = [];
        for (const chemin of ['/api/banc/correction', '/api/identifier', '/api/identifier/reponse', '/api/solde', '/api/banc/contributions/x']) { p = await pre(chemin, ORIGINE); autres.push(p.entetes[METH]); }
        H.v('   tout autre chemin de l\'extension : GET, POST inchangé (le sous-chemin /contributions/x n\'est PAS /contributions)', autres, ['GET, POST', 'GET, POST', 'GET, POST', 'GET, POST', 'GET, POST']);
        p = await pre('/api/compte/connexion', cfg.origines.site);
        H.v('   profil du site inchangé : GET, POST, DELETE', p.entetes[METH], 'GET, POST, DELETE');
        p = await pre('/api/banc/contributions', cfg.origines.site);
        H.v('   le site n\'a pas ce chemin : aucun en-tête CORS', p.entetes[ACAO], undefined);

        // (8) les corps de B1b sont identiques avec et sans banc — la sortie du crochet n'entre dans aucune réponse
        mode = 'affirmee';
        const variantes = [];
        await reset(); const x0 = await mkInst(); variantes.push(['sans consentement', normaliser(await identifier(avecDet, x0, null))]);
        await reset(); const x1 = await mkInst(); variantes.push(['consentement + détecteur (une ligne écrite)', normaliser(await identifier(avecDet, x1, consentement()))]); await jusque(async () => (await lignes()).length === 1);
        await reset(); client.panne.put = true; const x2 = await mkInst(); const cap2 = capturer(); variantes.push(['consentement + détecteur, R2 qui lève', normaliser(await identifier(avecDet, x2, consentement()))]); await attendre(200); cap2.rendre();
        await reset(); detectionImpl = () => new Promise(() => { }); const x3 = await mkInst(); const t0 = Date.now(); variantes.push(['consentement + détecteur qui ne rend jamais la main', normaliser(await identifier(avecDet, x3, consentement()))]); const dt = Date.now() - t0;
        await reset(); detectionImpl = async () => { throw new Error('boum'); }; const x4 = await mkInst(); const cap4 = capturer(); variantes.push(['consentement + détecteur qui lève', normaliser(await identifier(avecDet, x4, consentement()))]); await attendre(100); cap4.rendre();
        await reset(); const x5 = await mkInst(); variantes.push(['sans crochet `detection` (production)', normaliser(await identifier(sansDet, x5, consentement()))]);
        const hors = variantes.filter(([, c]) => c !== variantes[0][1]).map(([n]) => n);
        H.v(`(8) corps de /api/identifier : ${variantes.length} variantes comparées à « ${variantes[0][0]} » — écarts (scanId normalisé)`, hors, []);
        H.v('   le détecteur qui ne rend jamais la main ne retarde pas la réponse (< 2 s)', dt < 2000, true);
        // même propriété pour /reponse
        mode = 'question';
        const reps = [];
        for (const [nom, srv, consent, impl] of [['sans consentement', avecDet, null, null], ['consentement + banc', avecDet, consentement(), null], ['consentement, R2 qui lève', avecDet, consentement(), 'panne']]) {
            await reset(); if (impl === 'panne') client.panne.put = true;
            const xr = await mkInst(); const cap = capturer(); const ra = await identifier(srv, xr, consent); await attendre(100); client.panne.put = false;
            const rb = await repondre(srv, xr, { scanId: ra.json.scanId, carte: 0, choix: 'a', ...(consent || {}) }); await attendre(100); cap.rendre();
            reps.push([nom, JSON.stringify(rb.json), rb.statut]);
        }
        H.v('(8) corps de /api/identifier/reponse identiques avec et sans banc (3 variantes)', [reps.every(r => r[2] === 200), reps.filter(r => r[1] !== reps[0][1]).map(r => r[0])], [true, []]);
        await reset();
        await avecDet.fermer(); await avecLot.fermer(); await sansDet.fermer();
        await db.col('installations').deleteMany({}); await raw('analyses').deleteMany({}); await raw('questions').deleteMany({});
    });

    monterBanc.arreterPurge();
    await mongoose.disconnect();
    await H.arreterBanc();
    H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
