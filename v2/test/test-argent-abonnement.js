'use strict';
const fs = require('fs'); const path = require('path'); const Module = require('module'); const express = require('express'); const { spawnSync } = require('child_process');
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config');
const Ab = require('../argent/abonnement'); const Pay = require('../argent/paiement'); const Lg = require('../argent/ledger'); const monter = require('../argent/monter');
const { compte, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
// l'ESPION Stripe : tout chargement du module de paiement tiers pendant le banc est compté (et lève)
let tentativesStripe = 0; const requireOrigine = Module.prototype.require;
Module.prototype.require = function (id) { if (id === 'stripe') { tentativesStripe++; throw new Error('stripe : appel interdit pendant le banc'); } return requireOrigine.apply(this, arguments); };
(async () => {
    const prefixe = await H.ouvrirBac('test-argent-abonnement.js'); await M.creerIndex();
    // 1. activerAbonnement
    const p1 = await compte({ solde: { accueil: 0, achete: 0 } });
    const a1 = await Ab.activerAbonnement(p1.id, { quotaMensuel: 100, jusquAu: new Date('2027-01-01') });
    const c1 = await lire(p1);
    H.v('activerAbonnement : forme posée', [a1.ok, c1.abonnement.actif, c1.abonnement.quotaMensuel, c1.abonnement.moisCle, c1.abonnement.restant, c1.abonnement.jusquAu.toISOString().slice(0, 10)], [true, true, 100, null, 0, '2027-01-01']);
    const d1 = await Lg.debiter(p1, { scanId: 'ab', cleIdempotence: 'ab1', maintenant: t }, cfg);
    H.v('   le premier débit du mois recharge puis débite (99 restants)', [d1.ok, d1.credit.poche, (await lire(p1)).abonnement.restant, (await lire(p1)).abonnement.moisCle], [true, 'abonnement', 99, '2026-10']);
    // 2. desactiverAbonnement : restant conservé, inutilisable
    await Ab.desactiverAbonnement(p1.id);
    const c2 = await lire(p1);
    H.v('desactiverAbonnement : actif false, restant conservé', [c2.abonnement.actif, c2.abonnement.restant], [false, 99]);
    H.v('   et inutilisable : QUOTA', (await Lg.debiter(p1, { scanId: 'ab2', cleIdempotence: 'ab2', maintenant: t }, cfg)).code, 'QUOTA');
    let leve = null; try { await Ab.activerAbonnement(p1.id, { quotaMensuel: 0, jusquAu: new Date('2027-01-01') }); } catch (e) { leve = e.message; }
    H.v('quota invalide (0) : lève', typeof leve, 'string');
    let leve2 = null; try { await Ab.activerAbonnement(p1.id, { quotaMensuel: 10, jusquAu: new Date('pas une date') }); } catch (e) { leve2 = e.message; }
    H.v('date invalide : lève', typeof leve2, 'string');
    H.v('compte inconnu : ok false', (await Ab.activerAbonnement(new (require('mongoose').Types.ObjectId)(), { quotaMensuel: 10, jusquAu: new Date('2027-01-01') })).ok, false);
    // 3. crediterAchat : idempotent par référence ; packs en liste fermée
    const p3 = await compte({ solde: { accueil: 0, achete: 1 } });
    const r3 = await Pay.crediterAchat({ compteId: p3.id, scans: 50, reference: 'cs_test_A', maintenant: t }, cfg);
    H.v('crediterAchat 50 : solde 51, mouvement achat clé achat|<référence>', [r3.ok, (await lire(p3)).solde.achete, (await db.col('mouvements').findOne({ cleIdempotence: 'achat|cs_test_A' })).type], [true, 51, 'achat']);
    const r3b = await Pay.crediterAchat({ compteId: p3.id, scans: 50, reference: 'cs_test_A', maintenant: t }, cfg);
    H.v('   rejouée avec la même référence : UN seul crédit (webhook rejoué)', [r3b.rejoue, (await lire(p3)).solde.achete, await db.col('mouvements').countDocuments({ type: 'achat' })], [true, 51, 1]);
    await Promise.all(Array.from({ length: 10 }, () => Pay.crediterAchat({ compteId: p3.id, scans: 20, reference: 'cs_test_B', maintenant: t }, cfg)));
    H.v('   10 webhooks simultanés de même référence : +20 une seule fois', (await lire(p3)).solde.achete, 71);
    for (const pack of [20, 100, 200]) await Pay.crediterAchat({ compteId: p3.id, scans: pack, reference: `cs_pack_${pack}`, maintenant: t }, cfg);
    H.v('   les quatre packs (20, 50, 100, 200) passent : 71 + 20 + 100 + 200', (await lire(p3)).solde.achete, 391);
    for (const mauvais of [30, 0, -20, 20.5, '50', null]) { let e = null; try { await Pay.crediterAchat({ compteId: p3.id, scans: mauvais, reference: `cs_m_${String(mauvais)}`, maintenant: t }, cfg); } catch (x) { e = x.message; } H.v(`   scans=${JSON.stringify(mauvais)} hors liste : lève`, typeof e, 'string'); }
    H.v('   solde inchangé par les refus', (await lire(p3)).solde.achete, 391);
    let e4 = null; try { await Pay.crediterAchat({ compteId: p3.id, scans: 20, reference: '', maintenant: t }, cfg); } catch (x) { e4 = x.message; }
    H.v('   référence vide : lève (une clé vide ne serait pas idempotente)', typeof e4, 'string');
    const m0 = await db.col('mouvements').countDocuments({});
    const rI = await Pay.crediterAchat({ compteId: new (require('mongoose').Types.ObjectId)(), scans: 20, reference: 'cs_inconnu', maintenant: t }, cfg);
    H.v('   compte inconnu : ok false et AUCUN mouvement orphelin', [rI.ok, await db.col('mouvements').countDocuments({})], [false, m0]);
    // 4. POST /api/creer-recharge v2 => 501 INDISPONIBLE paiement-non-branche, aucun appel Stripe
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-porteur']) req.v2 = { porteur: { type: 'compte', id: 'x', compte: null, installation: null, surface: 'scanner', administrateur: false } }; next(); });
    const router = express.Router(); monter.routes(router, cfg, {}); app.use(router);
    app.post('/api/creer-recharge', (req, res) => res.json({ legacy: true }));       // la route HÉRITÉE : doit rester atteinte quand l'appelant n'est pas un porteur v2
    const srv = await H.serveur(app);
    const r4 = await H.appel(srv.url, '/api/creer-recharge', { methode: 'POST', corps: { pack: 50 }, entetes: { 'x-porteur': '1' } });
    H.v('creer-recharge v2 : 501 INDISPONIBLE', [r4.statut, r4.json.success, r4.json.erreur.code, r4.json.erreur.detail], [501, false, 'INDISPONIBLE', 'paiement-non-branche']);
    const r4b = await H.appel(srv.url, '/api/creer-recharge', { methode: 'POST', corps: { userId: 'ancien' } });
    H.v('   sans porteur v2 (ancienne extension) : la route HÉRITÉE répond, v2 ne la capte pas', r4b.json, { legacy: true });
    await srv.fermer();
    H.v('   AUCUN appel à Stripe (espion sur le chargement du module)', tentativesStripe, 0);
    // emplacements nommés
    H.v('emplacements Stripe : fonctions nommées, non branchées', [typeof Pay.creerSessionPaiement, typeof Pay.traiterWebhookStripe], ['function', 'function']);
    let e5 = null; try { await Pay.creerSessionPaiement({ compteId: 'x', scans: 50 }); } catch (x) { e5 = x.code || x.message; }
    H.v('   creerSessionPaiement lève INDISPONIBLE tant que non branché', e5, 'INDISPONIBLE');
    // 6. aucun chargement du module de paiement tiers dans v2/ (le motif est assemblé pour ne pas se trouver lui-même)
    const motif = new RegExp(["require\\(\\s*['\"]", "str", "ipe['\"]"].join(''));
    const rec = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? rec(path.join(d, e.name)) : [path.join(d, e.name)]);
    const fichiers = rec(path.join(__dirname, '..')).filter(f => f.endsWith('.js'));
    const touches = fichiers.filter(f => motif.test(fs.readFileSync(f, 'utf8')));
    H.v(`0 chargement du module de paiement tiers dans v2/ (${fichiers.length} fichiers .js lus)`, touches.map(f => path.basename(f)), []);
    // 5. le script administrateur
    const pa = await compte({ email: 'abonne@exemple.fr', emailCle: 'abonne@exemple.fr', solde: { accueil: 0, achete: 0 } });
    const cli = path.join(__dirname, '..', 'admin', 'poser-abonnement.js');
    const lance = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: 'utf8', env: process.env });
    const ok = lance('--base=test_scratch', `--prefixe=${prefixe}`, '--email=abonne@exemple.fr', '--quota=40', '--jusqu-au=2027-03-31');
    const ca = await lire(pa);
    H.v('script : abonnement posé, adresse masquée imprimée', [ok.status, ca.abonnement.actif, ca.abonnement.quotaMensuel, /a•••@exemple\.fr/.test(ok.stdout), ok.stdout.includes('abonne@exemple.fr')], [0, true, 40, true, false]);
    const inconnu = lance('--base=test_scratch', `--prefixe=${prefixe}`, '--email=personne@exemple.fr', '--quota=40', '--jusqu-au=2027-03-31');
    H.v('   e-mail inconnu : refusé, code 1', inconnu.status, 1);
    H.v('   --base=test sans --confirmer-production : refusé AVANT toute connexion', [lance('--base=test', '--email=abonne@exemple.fr', '--quota=40', '--jusqu-au=2027-03-31').status, /Base :/.test(lance('--base=test', '--email=abonne@exemple.fr', '--quota=40', '--jusqu-au=2027-03-31').stdout)], [1, false]);
    H.v('   quota ou date manquants : refusé', [lance('--base=test_scratch', `--prefixe=${prefixe}`, '--email=abonne@exemple.fr').status, lance('--base=test_scratch', `--prefixe=${prefixe}`, '--email=abonne@exemple.fr', '--quota=40', '--jusqu-au=pasunedate').status], [1, 1]);
    Module.prototype.require = requireOrigine;
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
