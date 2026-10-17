'use strict';
// Banc FREIN-CONSTATES, 2e moitié : le plafond GLOBAL de dépense quotidienne du modèle (v2/argent/depense-modele.js). Un FAUX FOURNISSEUR compte ses appels : plafond atteint, il n'en reçoit AUCUN.
// Base EN MÉMOIRE, aucun réseau.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const D = require('../argent/depense-modele');
const cfgDe = o => lireConfig({ MONGODB_BASE: 'test_scratch', V2_DEPENSE_MODELE_JOUR_USD: '0.01', V2_COUT_APPEL_ESTIME_USD: '0.004', ...o });
const t = new Date('2026-10-08T10:00:00Z'), JOUR = '2026-10-08';
const capter = async f => { const l = []; const w = console.warn, e = console.error; console.warn = console.error = (...a) => { l.push(a.join(' ')); }; try { return { r: await f(), lignes: l }; } finally { console.warn = w; console.error = e; } };
// un faux fournisseur : compte ses appels, garde les corps reçus, rend le coût demandé (ou aucun)
const fournisseur = (cout) => { const f = { appels: 0, corps: [] }; f.post = async (url, corps) => { f.appels++; f.corps.push(corps); return { data: { choices: [], ...(cout === undefined ? {} : { usage: { cost: cout } }) } }; }; return f; };
const attraper = async p => { try { await p; return null; } catch (e) { return e; } };

(async () => {
    await H.ouvrirBac('test-depense-modele.js'); await M.creerIndex();
    const cfg = cfgDe();
    const nouvelle = (o = {}) => D.creer({ cfg, maintenant: () => t, ...o });

    // ════════ le coût que la réponse rend sert ; le plafond coupe ; le fournisseur ne reçoit plus rien ════════
    {
        const A = nouvelle(), f = fournisseur(0.004);
        for (let i = 0; i < 3; i++) await A.appeler(f.post, 'u', { model: 'm' }, {});
        H.v('D1. trois appels à 0,004 $ pour un plafond de 0,01 $ : les trois partent (0,008 < 0,01 avant le 3e)', f.appels, 3);
        const { r: e, lignes } = await capter(async () => attraper(A.appeler(f.post, 'u', { model: 'm' }, {})));
        H.v('D2. le 4e appel : AUCUN appel au fournisseur, erreur DEPENSE_MODELE_PLAFOND', [f.appels, e && e.code], [3, 'DEPENSE_MODELE_PLAFOND']);
        const dej = await db.col('depense_modele').findOne({ _id: `jour:${JOUR}` });
        H.v('    le compte du jour : 0,012 $ en micro-dollars, 3 appels (le refus ne compte pas)', [dej.microUsd, dej.appels], [12000, 3]);
        for (let i = 0; i < 5; i++) await attraper(A.appeler(f.post, 'u', {}, {}));
        H.v('D3. cinq refus de plus : toujours 3 appels reçus par le fournisseur, compte inchangé', [f.appels, (await db.col('depense_modele').findOne({ _id: `jour:${JOUR}` })).microUsd], [3, 12000]);
        H.v('D4. le corps envoyé demande le coût (usage.include) sans modifier le corps de l\'appelant', [f.corps[0].usage, f.corps[0].model], [{ include: true }, 'm']);
        const al = await db.col('alertes').findOne({ _id: 'alerte/depense-modele' });
        H.v('D5. l\'alerte en base : active, jour, plafond et dépense', [al && al.active, al && al.jour, al && al.plafondUsd, al && al.depenseUsd], [true, JOUR, 0.01, 0.012]);
    }

    // ════════ une ligne de journal par PASSAGE du seuil, pas une par scan ════════
    {
        await db.col('depense_modele').deleteMany({}); await db.col('alertes').deleteMany({});
        const A = nouvelle(), f = fournisseur(0.004);
        const { lignes } = await capter(async () => { for (let i = 0; i < 8; i++) await attraper(A.appeler(f.post, 'u', {}, {})); });
        const passages = lignes.filter(l => /depense-modele-plafond/.test(l));
        H.v('J1. 8 tentatives (3 passent, 5 refusées) : UNE seule ligne « depense-modele-plafond »', passages.length, 1);
        H.v('    compteurs : 3 réservations, 5 coupures, 1 passage', [A.compteurs().reservations, A.compteurs().coupures, A.compteurs().passages], [3, 5, 1]);
    }

    // ════════ concurrence : plusieurs appels simultanés ne franchissent pas le plafond de plus d'un appel, et ne journalisent qu'une fois ════════
    {
        await db.col('depense_modele').deleteMany({}); await db.col('alertes').deleteMany({});
        const A = nouvelle(), f = fournisseur(0.004);
        const { lignes } = await capter(async () => Promise.all(Array.from({ length: 12 }, () => attraper(A.appeler(f.post, 'u', {}, {})))));
        H.v('K1. 12 appels SIMULTANÉS pour un plafond de 0,01 $ (0,004 par appel) : 3 au plus partent', f.appels, 3);
        H.v('    et un seul passage journalisé', lignes.filter(l => /depense-modele-plafond/.test(l)).length, 1);
    }

    // ════════ sans coût lisible : l'estimation prudente sert ════════
    {
        await db.col('depense_modele').deleteMany({});
        const A = nouvelle(), f = fournisseur(undefined);
        await A.appeler(f.post, 'u', {}, {}); await A.appeler(f.post, 'u', {}, {});
        const d = await db.col('depense_modele').findOne({ _id: `jour:${JOUR}` });
        H.v('E1. réponse sans usage.cost : chaque appel compte l\'estimation (0,004 $) — 2 appels = 8000 µ$', [d.microUsd, A.compteurs().coutsEstimes, A.compteurs().coutsLus], [8000, 2, 0]);
        const g = fournisseur(0.001); await db.col('depense_modele').deleteMany({});
        await A.appeler(g.post, 'u', {}, {});
        H.v('E2. coût lu (0,001 $) : la réservation de 0,004 est CORRIGÉE à 0,001', (await db.col('depense_modele').findOne({ _id: `jour:${JOUR}` })).microUsd, 1000);
        for (const mauvais of [null, -1, 'x', NaN, Infinity]) { await db.col('depense_modele').deleteMany({}); const h = fournisseur(mauvais); await A.appeler(h.post, 'u', {}, {}); if ((await db.col('depense_modele').findOne({ _id: `jour:${JOUR}` })).microUsd !== 4000) H.v('E3. coût illisible ' + String(mauvais), 'non estimé', 'estimé'); }
        H.v('E3. un coût illisible (null, négatif, texte, NaN, infini) = l\'estimation, jamais 0', true, true);
        await db.col('depense_modele').deleteMany({});
        const echec = async () => { throw Object.assign(new Error('délai'), { code: 'ECONNABORTED' }); };
        const err = await attraper(A.appeler(echec, 'u', {}, {}));
        H.v('E4. un appel qui ÉCHOUE (délai) a pu être facturé : l\'estimation reste, l\'erreur est relancée telle quelle', [err && err.code, (await db.col('depense_modele').findOne({ _id: `jour:${JOUR}` })).microUsd], ['ECONNABORTED', 4000]);
    }

    // ════════ deux « instances » (deux modules sur la même base) partagent le même compte ════════
    {
        await db.col('depense_modele').deleteMany({});
        const A = nouvelle(), B = nouvelle(), fa = fournisseur(0.004), fb = fournisseur(0.004);
        await A.appeler(fa.post, 'u', {}, {}); await B.appeler(fb.post, 'u', {}, {}); await A.appeler(fa.post, 'u', {}, {});
        const e = await attraper(B.appeler(fb.post, 'u', {}, {}));
        H.v('I1. A, B, A consomment 0,012 $ ; l\'instance B est refusée (fournisseur de B : 1 appel seulement)', [e && e.code, fa.appels, fb.appels], ['DEPENSE_MODELE_PLAFOND', 2, 1]);
        const C = nouvelle();   // « redémarrage » : un module neuf, aucun état en mémoire
        const fc = fournisseur(0.004); const ec = await attraper(C.appeler(fc.post, 'u', {}, {}));
        H.v('R1. après un redémarrage (module neuf) le compte du jour est RELU : refusé, aucun appel', [ec && ec.code, fc.appels, (await C.lire()).usd], ['DEPENSE_MODELE_PLAFOND', 0, 0.012]);
        H.v('    autorise() (lecture seule, pour la route) dit non, et ne compte rien', [(await C.autorise()).ok, (await db.col('depense_modele').findOne({ _id: `jour:${JOUR}` })).microUsd], [false, 12000]);
    }

    // ════════ le jour de PARIS remet à zéro ; l'alerte d'un jour passé est résolue ════════
    {
        const A = nouvelle({ maintenant: () => new Date('2026-10-08T21:59:00Z') }), f = fournisseur(0.004);
        const demain = D.creer({ cfg, maintenant: () => new Date('2026-10-08T22:00:00Z') });
        const e1 = await attraper(A.appeler(f.post, 'u', {}, {}));
        await demain.appeler(f.post, 'u', {}, {});
        H.v('P1. 23:59 Paris : refusé (plafond atteint) ; 00:00 Paris : le compte repart à zéro, l\'appel part', [e1 && e1.code, f.appels], ['DEPENSE_MODELE_PLAFOND', 1]);
        const al = await db.col('alertes').findOne({ _id: 'alerte/depense-modele' });
        H.v('    l\'alerte du 8 est résolue au premier appel du 9', [al.active, Boolean(al.resolueLe)], [false, true]);
    }

    // ════════ échec FERMÉ : un compte illisible ou non écrit refuse l'appel ════════
    {
        const cassee = D.creer({ cfg, maintenant: () => t, col: () => ({ findOne: async () => { throw new Error('panne'); }, findOneAndUpdate: async () => { throw new Error('panne'); } }) });
        const f = fournisseur(0.004);
        const { r } = await capter(async () => ({ e: await attraper(cassee.appeler(f.post, 'u', {}, {})), a: await cassee.autorise() }));
        H.v('X1. base en panne : l\'appel n\'a pas lieu (échec fermé), autorise() dit non avec la cause', [r.e && r.e.code, f.appels, r.a.ok, r.a.cause], ['DEPENSE_MODELE_PLAFOND', 0, false, 'lecture']);
    }

    // ════════ envelopper : la seconde lecture et tout autre client passent sous le même plafond ════════
    {
        await db.col('depense_modele').deleteMany({});
        const A = nouvelle(), f = fournisseur(0.005), post = A.envelopper(f.post);
        await post('u', { a: 1 }, {}); await post('u', { a: 1 }, {});
        const e = await attraper(post('u', { a: 1 }, {}));
        H.v('S1. client enveloppé (seconde lecture) : 2 appels à 0,005 $ puis refus, le fournisseur n\'en reçoit que 2', [f.appels, e && e.code], [2, 'DEPENSE_MODELE_PLAFOND']);
        const { creerLecteur } = require('../identifier/seconde-lecture-image');
        await db.col('depense_modele').deleteMany({});
        const g = fournisseur(0.006), lecteur = creerLecteur({ post: nouvelle().envelopper(g.post), modele: 'm', cle: 'k'.repeat(8) });
        await lecteur(Buffer.from('x')).catch(() => { }); await lecteur(Buffer.from('x')).catch(() => { });
        const r3 = await lecteur(Buffer.from('x')).catch(x => x);
        H.v('    le vrai lecteur de seconde lecture : 2 appels partent, le 3e est refusé (code APPEL_MODELE ou plafond), le fournisseur n\'en reçoit que 2', g.appels, 2);
    }

    // ════════ la configuration du processus (index.js racine) : sans configuration, rien ne change ════════
    {
        const V2 = require('../index');
        const f = fournisseur(0.004);
        const r = await V2.depenseModele.appeler(f.post, 'u', { b: 1 }, {});
        H.v('Z1. v2 sans configuration valide (cfg absente) : l\'appel part tel quel, corps inchangé', [f.appels, f.corps[0]], [1, { b: 1 }]);
    }

    await H.arreterBanc(); H.bilan();
})().catch(async e => { console.error('❌', e); try { await H.arreterBanc(); } catch (_) { } process.exit(1); });
