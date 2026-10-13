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
    // OFFRE-QUOTA : un abonnement actif ne se DÉBITE plus (le compteur mensuel `abonnement.restant` n'est plus touché) : il fait du porteur un Pro, soumis au quota du jour (plafond technique).
    const d1 = await Lg.debiter(p1, { scanId: 'ab', cleIdempotence: 'ab1', maintenant: t }, cfg);
    H.v('   le premier débit prend le quota du jour (Pro), l\'abonnement mensuel n\'est NI rechargé NI débité', [d1.ok, d1.credit.poche, (await lire(p1)).abonnement.restant, (await lire(p1)).abonnement.moisCle], [true, 'jour', 0, null]);
    H.v('   offre : pro, restant null', (await require('../argent/offre').offre(p1, cfg, t)).restant, null);
    // 2. desactiverAbonnement : le porteur redevient un compte gratuit (vérifié), l'état de l'abonnement est conservé
    await Ab.desactiverAbonnement(p1.id);
    const c2 = await lire(p1);
    H.v('desactiverAbonnement : actif false, quota mensuel conservé', [c2.abonnement.actif, c2.abonnement.quotaMensuel], [false, 100]);
    H.v('   et le porteur est « gratuit » (10 par jour) : 10 analyses de plus passent (la 1re du Pro est déjà prise : 9 restent), puis QUOTA', await (async () => { const r = []; for (let i = 0; i < 10; i++) r.push((await Lg.debiter(p1, { scanId: `ab2${i}`, cleIdempotence: `ab2${i}`, maintenant: t }, cfg)).ok ? 'ok' : 'QUOTA'); return r; })(), [...Array(9).fill('ok'), 'QUOTA']);
    // M9 : relancer l'activation en cours de mois ne touche pas au compteur mensuel (conservé, plafonné au nouveau quota)
    await Ab.activerAbonnement(p1.id, { quotaMensuel: 100, jusquAu: new Date('2027-02-01') });
    const c2b = await lire(p1);
    H.v('réactivation : actif, mois et restant conservés (0, null), échéance prolongée', [c2b.abonnement.actif, c2b.abonnement.restant, c2b.abonnement.moisCle, c2b.abonnement.jusquAu.toISOString().slice(0, 10)], [true, 0, null, '2027-02-01']);
    await Ab.activerAbonnement(p1.id, { quotaMensuel: 50, jusquAu: new Date('2027-02-01') });
    H.v('   un quota abaissé plafonne le restant (reste 0)', (await lire(p1)).abonnement.restant, 0);
    let leve = null; try { await Ab.activerAbonnement(p1.id, { quotaMensuel: 0, jusquAu: new Date('2027-01-01') }); } catch (e) { leve = e.message; }
    H.v('quota invalide (0) : lève', typeof leve, 'string');
    let leve2 = null; try { await Ab.activerAbonnement(p1.id, { quotaMensuel: 10, jusquAu: new Date('pas une date') }); } catch (e) { leve2 = e.message; }
    H.v('date invalide : lève', typeof leve2, 'string');
    H.v('compte inconnu : ok false', (await Ab.activerAbonnement(new (require('mongoose').Types.ObjectId)(), { quotaMensuel: 10, jusquAu: new Date('2027-01-01') })).ok, false);
    // 3. crediterAchat : idempotent par référence ; packs en liste fermée
    // OFFRE-QUOTA (2026-10-13) : plus aucune vente de scans. crediterAchat REFUSE (journalisé), quelles que soient les entrées : aucune écriture, ni sur `comptes` ni dans `mouvements`.
    const p3 = await compte({ solde: { accueil: 0, achete: 1 } });
    const tout = async () => JSON.stringify([await lire(p3), await db.col('mouvements').countDocuments({})]);
    const avant3 = await tout();
    const r3 = await Pay.crediterAchat({ compteId: p3.id, scans: 50, reference: 'cs_test_A', maintenant: t }, cfg);
    H.v('crediterAchat 50 : REFUSÉ (vente-arretee), solde 1 inchangé, aucun mouvement', [r3.ok, r3.raison, (await lire(p3)).solde.achete, await db.col('mouvements').countDocuments({ type: 'achat' })], [false, 'vente-arretee', 1, 0]);
    await Promise.all(Array.from({ length: 10 }, () => Pay.crediterAchat({ compteId: p3.id, scans: 20, reference: 'cs_test_B', maintenant: t }, cfg)));
    for (const pack of [20, 50, 100, 200]) await Pay.crediterAchat({ compteId: p3.id, scans: pack, reference: `cs_pack_${pack}`, maintenant: t }, cfg);
    const refusees = []; for (const mauvais of [30, 0, -20, 20.5, '50', null]) refusees.push((await Pay.crediterAchat({ compteId: p3.id, scans: mauvais, reference: `cs_m_${String(mauvais)}`, maintenant: t }, cfg)).ok);
    refusees.push((await Pay.crediterAchat({ compteId: p3.id, scans: 20, reference: '', maintenant: t }, cfg)).ok, (await Pay.crediterAchat({ compteId: new (require('mongoose').Types.ObjectId)(), scans: 20, reference: 'cs_inconnu', maintenant: t }, cfg)).ok);
    H.v('   10 webhooks simultanés, les quatre packs, six packs hors liste, référence vide, compte inconnu : tous refusés (aucune exception), rien d\'écrit (compte et mouvements identiques)', [refusees.every(x => x === false), await tout() === avant3], [true, true]);
    // 4. POST /api/creer-recharge v2 => 410 (la vente est arrêtée), aucun appel Stripe
    const app = express(); app.use(express.json());
    app.use((req, res, next) => { if (req.headers['x-porteur']) req.v2 = { porteur: { type: 'compte', id: 'x', compte: null, installation: null, surface: 'scanner', administrateur: false } }; next(); });
    const router = express.Router(); monter.routes(router, cfg, {}); app.use(router);
    app.post('/api/creer-recharge', (req, res) => res.json({ legacy: true }));       // la route HÉRITÉE : doit rester atteinte quand l'appelant n'est pas un porteur v2
    const srv = await H.serveur(app);
    const r4 = await H.appel(srv.url, '/api/creer-recharge', { methode: 'POST', corps: { pack: 50 }, entetes: { 'x-porteur': '1' } });
    H.v('creer-recharge v2 : 410 (la vente de scans est arrêtée), aucune session', [r4.statut, r4.json.success, r4.json.erreur.code, r4.json.erreur.detail], [410, false, 'INDISPONIBLE', 'vente-arretee']);
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
