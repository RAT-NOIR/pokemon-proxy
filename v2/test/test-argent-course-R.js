'use strict';
// ROUGE ATTENDU — défaut garé R, à rouvrir en B8.
// R : course entre la RÉPONSE d'une question par un candidat et le REMBOURSEMENT d'une panne (contrôle M2 de rendreLeScan). M2 lit « question repondue ? » AVANT de poser le claim `rb|scanId` ;
// une réponse qui s'écrit entre cette lecture et le rendu passe la garde : le client reçoit son résultat ET son crédit lui est rendu (un scan gratuit).
// L'entrelacement est FORCÉ de façon déterministe : la réponse est jouée au moment exact où le claim s'écrit (après M2, avant le rendu). Ce fichier est EXCLU de lancer-tout.js (liste EXCLUS) et attendu rouge.
const H = require('./_harnais'); const db = require('../db'); const M = require('../modeles'); const { lireConfig } = require('../config'); const Lg = require('../argent/ledger'); const Q = require('../argent/questions');
const { compte, lire } = require('./_aide-argent');
const cfg = lireConfig({ MONGODB_BASE: 'test_scratch', V2_HEBDO: '0' });
const t = new Date('2026-10-08T10:00:00Z');
(async () => {
    await H.ouvrirBac('test-argent-course-R.js'); await M.creerIndex();
    const p = await compte({ solde: { accueil: 0, achete: 3 } });
    const d = await Lg.debiter(p, { scanId: 'courseR', cleIdempotence: 'd|courseR', maintenant: t }, cfg);
    await Q.reserverQuestion(p, d.credit, { scanId: 'courseR', carte: 0, raison: 'egalite', candidats: [111], choix: [{ id: 'c1', idProduct: 111 }] }, cfg, t);
    const colReel = db.col; let reponse = null;
    db.col = n => {
        const c = colReel(n);
        if (n !== 'mouvements') return c;
        return new Proxy(c, { get: (cible, k) => k !== 'insertOne' ? cible[k].bind ? cible[k].bind(cible) : cible[k] : async doc => {
            if (doc && doc.cleIdempotence === 'rb|courseR' && !reponse) { reponse = 'en cours'; db.col = colReel; reponse = await Q.repondreQuestion(p, { scanId: 'courseR', carte: 0, choix: 'c1' }, cfg, t); }
            return cible.insertOne(doc);
        } });
    };
    let r; try { r = await Lg.rembourser(p, d.credit, 'ia-echec', { scanId: 'courseR', maintenant: t }, cfg); } finally { db.col = colReel; }
    const q = await db.col('questions_v2').findOne({ _id: 'courseR:0' }), solde = (await lire(p)).solde.achete;
    H.v('la réponse du candidat a bien été écrite pendant le remboursement (l\'entrelacement est réel)', [reponse && reponse.statut, q.etat], [200, 'repondue']);
    H.v('INVARIANT : un résultat livré n\'est jamais remboursé (repondue => crédit gardé, solde 2 ; sinon rendu, solde 3)', [q.etat, r.rendu, solde], ['repondue', false, 2]);
    await H.fermerBac(); H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
