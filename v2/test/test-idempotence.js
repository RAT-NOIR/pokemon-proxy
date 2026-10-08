'use strict';
// B4.2 — Idempotency-Key : un rejeu rend la même réponse sans second débit. Un défaut ici double un débit.
const express = require('express');
const H = require('./_harnais');
const M = require('../modeles');
const { col } = require('../db');
const { lireConfig } = require('../config');
const { repondreErreur } = require('../erreurs');
const idem = require('../transport/idempotence');

const SECRET = 'CLE-SECRETE-';           // préfixe des clés d'essai : ne doit JAMAIS apparaître dans la console
const sortiesConsole = [];
for (const m of ['log', 'error', 'warn', 'info']) { const o = console[m].bind(console); console[m] = (...a) => { sortiesConsole.push(a.map(String).join(' ')); o(...a); }; }

(async () => {
    await H.ouvrirBac('test-idempotence.js'); await M.creerIndex();
    const cfg = lireConfig({ MONGODB_BASE: 'test_scratch' });
    const etat = { debits: 0, delaiMs: 0, mode: 'ok', libere: null };
    const app = express();
    app.use(express.json());
    app.use((req, res, next) => { const id = req.headers['x-porteur']; if (id) req.v2 = { porteur: { type: 'installation', id } }; next(); });   // faux resoudrePorteur
    const route = nom => async (req, res) => {
        etat.debits++;                                           // « le débit »
        if (etat.delaiMs) await new Promise(r => setTimeout(r, etat.delaiMs));
        if (etat.libere) await etat.libere;
        if (etat.mode === '503') return repondreErreur(res, 'INDISPONIBLE', 'panne');
        if (etat.mode === 'quota') return repondreErreur(res, 'QUOTA', 'plus de crédit', { solde: { total: 0 } });
        res.json({ success: true, route: nom, debit: etat.debits, corps: req.body });
    };
    app.post('/api/identifier', idem.idempotente('identifier', {}, cfg), route('identifier'));
    app.post('/api/retour-live', idem.idempotente('retour-live', {}, cfg), route('retour-live'));
    app.post('/api/facultatif', idem.idempotente('facultatif', { obligatoire: false }, cfg), route('facultatif'));
    app.post('/api/sans-porteur', idem.idempotente('sp', {}, cfg), route('sp'));
    const srv = await H.serveur(app); const u = srv.url;
    const post = (chemin, cle, corps = { a: 1 }, porteur = 'p1') => H.appel(u, chemin, { methode: 'POST', corps, entetes: { ...(cle ? { 'idempotency-key': cle } : {}), ...(porteur ? { 'x-porteur': porteur } : {}) } });
    const reset = async () => { etat.debits = 0; etat.delaiMs = 0; etat.mode = 'ok'; etat.libere = null; await col('idempotence').deleteMany({}); };
    const rejoue = r => r.entetes['idempotency-replayed'] === 'true';

    // 1. séquentiel
    await reset();
    let a = await post('/api/identifier', SECRET + 'seq00001'), b = await post('/api/identifier', SECRET + 'seq00001');
    H.v('1. deux requêtes séquentielles même clé : exécutions de la route', etat.debits, 1);
    H.v('   réponses identiques octet pour octet', a.texte === b.texte, true);
    H.v('   la 1re n\'est pas marquée rejouée, la 2e l\'est', [rejoue(a), rejoue(b)], [false, true]);
    H.v('   statut identique', [a.statut, b.statut], [200, 200]);

    // 2. concurrence
    await reset(); etat.delaiMs = 1000;
    const rs = await Promise.all(Array.from({ length: 10 }, () => post('/api/identifier', SECRET + 'conc0001')));
    const executees = rs.filter(r => r.statut === 200 && !rejoue(r)).length;
    const rejeux = rs.filter(r => r.statut === 200 && rejoue(r)).length;
    const en429 = rs.filter(r => r.statut === 429 && r.json && r.json.erreur.code === 'DEBIT' && r.json.erreur.reessayerDans === 2).length;
    console.log(`   dénominateur : ${rs.length} requêtes, ${executees} exécution(s) rendue(s), ${rejeux} rejeux, ${en429} x 429 reessayerDans`);
    H.v('2. 10 requêtes SIMULTANÉES même clé : la route s\'exécute', etat.debits, 1);
    H.v('   répartition 1 + (rejeux + 429) = 10', [executees, rejeux + en429], [1, 9]);
    await new Promise(r => setTimeout(r, 100));
    const rapres = await post('/api/identifier', SECRET + 'conc0001');
    H.v('   après la fin, un rejeu rend la réponse figée sans exécuter', [rapres.statut, rejoue(rapres), etat.debits], [200, true, 1]);

    // 3. deux porteurs
    await reset();
    await post('/api/identifier', SECRET + 'deux0001', { a: 1 }, 'porteurA'); await post('/api/identifier', SECRET + 'deux0001', { a: 1 }, 'porteurB');
    H.v('3. même clé, deux porteurs : deux exécutions', etat.debits, 2);
    await post('/api/retour-live', SECRET + 'deux0001', { a: 1 }, 'porteurA');
    H.v('   même porteur, même clé, autre route : une exécution de plus', etat.debits, 3);
    const sansP = await post('/api/sans-porteur', SECRET + 'nopo0001', { a: 1 }, null);
    H.v('   sans porteur résolu : refus fermé (pas d\'exécution)', [sansP.statut, sansP.json && sansP.json.erreur.code, etat.debits], [503, 'INDISPONIBLE', 3]);

    // 4. corps différent
    await reset();
    await post('/api/identifier', SECRET + 'corps001', { a: 1, b: 2 });
    const mem = await post('/api/identifier', SECRET + 'corps001', { b: 2, a: 1 });
    H.v('4. même corps, clés dans un autre ordre : rejeu', [mem.statut, rejoue(mem)], [200, true]);
    const autre = await post('/api/identifier', SECRET + 'corps001', { a: 2 });
    H.v('   même clé, corps différent : 422 ENTREE cle-reutilisee', [autre.statut, autre.json.erreur.code, autre.json.erreur.detail], [422, 'ENTREE', 'cle-reutilisee']);
    H.v('   ... sans exécution', etat.debits, 1);

    // 5. 503 : le claim disparaît
    await reset(); etat.mode = '503';
    const pan = await post('/api/identifier', SECRET + 'pann0001');
    H.v('5. la route répond 503', pan.statut, 503);
    H.v('   le claim a disparu', await col('idempotence').countDocuments({}), 0);
    etat.mode = 'ok';
    const re = await post('/api/identifier', SECRET + 'pann0001');
    H.v('   la requête suivante de même clé s\'exécute', [re.statut, rejoue(re), etat.debits], [200, false, 2]);

    // 6. QUOTA : pas de cache
    await reset(); etat.mode = 'quota';
    const q = await post('/api/identifier', SECRET + 'quot0001');
    H.v('6. 429 QUOTA', [q.statut, q.json.erreur.code], [429, 'QUOTA']);
    H.v('   rien n\'est conservé', await col('idempotence').countDocuments({}), 0);
    etat.mode = 'ok';
    const q2 = await post('/api/identifier', SECRET + 'quot0001');
    H.v('   après recharge, le rejeu s\'exécute pour de bon', [q2.statut, rejoue(q2), etat.debits], [200, false, 2]);

    // 7. forme de la clé
    await reset();
    const mauvaises = ['a'.repeat(7), 'a'.repeat(65), 'avec espace1', 'accentué123', 'point.point1', 'slash/slash1'];
    let refus = 0;
    for (const k of mauvaises) { const r = await post('/api/identifier', k); if (r.statut === 400 && r.json.erreur.code === 'ENTREE') refus++; }
    H.v(`7. clés invalides refusées 400 ENTREE (${mauvaises.length} cas)`, [refus, etat.debits], [mauvaises.length, 0]);
    const r8 = await post('/api/identifier', 'a'.repeat(8)), r64 = await post('/api/identifier', 'B_-' + 'c'.repeat(61));
    H.v('   clés de 8 et de 64 caractères acceptées', [r8.statut, r64.statut], [200, 200]);
    const absente = await post('/api/identifier', null);
    H.v('   clé absente et obligatoire : 400 ENTREE', [absente.statut, absente.json.erreur.code], [400, 'ENTREE']);
    const vide = await H.appel(u, '/api/identifier', { methode: 'POST', corps: {}, entetes: { 'idempotency-key': '', 'x-porteur': 'p1' } });
    H.v('   clé vide : 400 ENTREE', vide.statut, 400);
    await reset();
    await post('/api/facultatif', null); await post('/api/facultatif', null);
    H.v('   obligatoire:false et clé absente : la route s\'exécute à chaque fois', etat.debits, 2);
    const fk = await post('/api/facultatif', 'a'.repeat(5));
    H.v('   obligatoire:false mais clé fournie et invalide : 400 quand même', fk.statut, 400);

    // 8. expiration
    await reset(); let lib; etat.libere = new Promise(r => { lib = r; });
    const enVol = post('/api/identifier', SECRET + 'expi0001');
    await new Promise(r => setTimeout(r, 300));
    let doc = await col('idempotence').findOne({});
    H.v('8. claim en vol : état', doc && doc.etat, 'en-cours');
    const dMin = (doc.expireLe.getTime() - Date.now()) / 60000;
    H.vrai(`   expireLe dans ~2 min (${dMin.toFixed(2)} min)`, dMin > 1.8 && dMin <= 2.01);
    const pendant = await post('/api/identifier', SECRET + 'expi0001');
    H.v('   un rejeu pendant l\'exécution : 429 DEBIT reessayerDans 2', [pendant.statut, pendant.json.erreur.code, pendant.json.erreur.reessayerDans], [429, 'DEBIT', 2]);
    H.v('   Retry-After posé', pendant.entetes['retry-after'], '2');
    lib(); await enVol;
    doc = await col('idempotence').findOne({});
    H.v('   fini : état', doc.etat, 'fini');
    const dH = (doc.expireLe.getTime() - Date.now()) / 3600000;
    H.vrai(`   expireLe dans ~24 h (${dH.toFixed(2)} h)`, dH > 23.9 && dH <= 24.01);
    // claim abandonné (processus tué) : en-cours depuis plus de 2 min, le TTL de Mongo n'a pas encore passé
    await reset();
    await col('idempotence').insertOne({ cle: 'installation:p1|identifier|' + SECRET + 'aban0001', empreinteCorps: 'autre', etat: 'en-cours', expireLe: new Date(Date.now() - 1000) });
    const ab = await post('/api/identifier', SECRET + 'aban0001');
    H.v('   claim en-cours abandonné et expiré : repris, la route s\'exécute', [ab.statut, etat.debits], [200, 1]);
    // et l'index TTL existe
    const idx = (await col('idempotence').indexes()).find(i => i.name === 'idempotence_ttl');
    H.v('   index TTL (expireAfterSeconds 0) présent', idx && idx.expireAfterSeconds, 0);
    // un claim NON expiré n'est pas repris
    await reset();
    await col('idempotence').insertOne({ cle: 'installation:p1|identifier|' + SECRET + 'vivant01', empreinteCorps: 'autre', etat: 'en-cours', expireLe: new Date(Date.now() + 60000) });
    const vv = await post('/api/identifier', SECRET + 'vivant01');
    H.v('   claim en-cours encore vivant : jamais repris (corps différent => 422, aucune exécution)', [vv.statut, etat.debits], [422, 0]);

    // 9. jamais en clair dans la console
    H.v('9. la clé n\'apparaît jamais dans la console', sortiesConsole.filter(l => l.includes(SECRET)).length, 0);
    console.log(`   dénominateur : ${sortiesConsole.length} lignes de console examinées`);

    // 10. stockage : la route répond 200 sans json (res.send) => claim non rejoué mais pas de double exécution
    await reset();
    app.post('/api/brut', idem.idempotente('brut', {}, cfg), (req, res) => { etat.debits++; res.status(200).send('ok brut'); });
    const b1 = await post('/api/brut', SECRET + 'brut0001'), b2 = await post('/api/brut', SECRET + 'brut0001');
    H.v('10. réponse non JSON en 200 : un second appel ne ré-exécute pas (429 en attente)', [b1.statut, b2.statut, etat.debits], [200, 429, 1]);

    // 11. BATTEMENT : une route plus longue que la fenêtre garde son claim (fenêtre 3 s, battement 400 ms, route 6 s)
    await reset();
    const cfgCourt = { ...cfg, retention: { ...cfg.retention, idempotenceEnCoursMinutes: 0.05, idempotenceBattementMs: 400 } };
    let finLente; const lente = new Promise(r => { finLente = r; });
    app.post('/api/lente', idem.idempotente('lente', {}, cfgCourt), async (req, res) => { etat.debits++; await Promise.race([lente, new Promise(r => setTimeout(r, 7000))]); res.json({ ok: true }); });
    const enVolLente = post('/api/lente', SECRET + 'lent0001');
    await new Promise(r => setTimeout(r, 4500));     // > 3 s : sans battement le claim serait expiré depuis 1,5 s
    const dLente = await col('idempotence').findOne({});
    H.vrai(`11. claim encore vivant après 4,5 s (expireLe dans ${((dLente.expireLe - Date.now()) / 1000).toFixed(1)} s)`, dLente.expireLe.getTime() > Date.now());
    const rejeuLent = await post('/api/lente', SECRET + 'lent0001');
    H.v('   rejeu pendant l\'exécution : 429 DEBIT reessayerDans 2', [rejeuLent.statut, rejeuLent.json.erreur.code, rejeuLent.json.erreur.reessayerDans], [429, 'DEBIT', 2]);
    H.v('   une seule exécution', etat.debits, 1);
    finLente(); const finalLent = await enVolLente;
    H.v('   la route finit : 200, claim fini', [finalLent.statut, (await col('idempotence').findOne({})).etat], [200, 'fini']);
    // un battement ne recrée jamais un claim disparu
    await col('idempotence').deleteMany({});
    await new Promise(r => setTimeout(r, 1000));
    H.v('   battement arrêté à la réponse : aucun claim recréé', await col('idempotence').countDocuments({}), 0);

    await srv.fermer(); await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
