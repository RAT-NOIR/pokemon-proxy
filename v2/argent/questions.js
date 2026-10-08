'use strict';
// LA QUESTION RÉSERVÉE. Même machine à états que acces.js (poserQuestion / repondreQuestion / rembourserQuestionsAbandonnees), clé (porteur, scanId:carte) :
//   en-attente → repondue                       (réponse par un candidat : le débit initial EST la facture, rien de plus)
//   en-attente → en-reglement → remboursee | non-remboursee   (« aucune », « ne-sait-pas », ou sans réponse sous 24 h)
// ⚠️ Un « en-reglement » n'est JAMAIS repris seul : un processus tué entre la prise et l'état final a pu rendre le crédit, le reprendre risquerait de le rendre deux fois.
const db = require('../db'); const { rembourser } = require('./ledger');
const col = nom => db.col(nom);
const base = p => (p.type === 'compte' ? { compteId: p.id } : { installationId: p.id });
const idQuestion = (scanId, carte) => `${scanId}:${carte}`;
const BLOQUEE_MS = 15 * 60e3;
const ABANDONS = ['aucune', 'ne-sait-pas'];
const nu = q => q;   // la question rendue telle que stockée (aucun champ secret)

async function reserverQuestion(porteur, credit, { scanId, carte = 0, raison, candidats = [], choix = [], lot = false } = {}, cfg, maintenant = new Date()) {
    if (!credit) return { etat: null };                       // administrateur, ou rien de débité : rien à régler
    const repli = async cause => {
        console.warn(`⚠️ [v2 question-repli] ${scanId} : ${cause} -> remboursée à l'émission`);
        const r = await rembourser(porteur, credit, `question:${raison}`, { scanId, compteur: 'question', maintenant }, cfg);
        return { etat: r.rendu ? 'remboursee' : 'non-remboursee', repli: cause };
    };
    if (!scanId) return repli('aucun identifiant de scan');
    try {
        if (!lot) await col('mouvements').updateOne({ ...base(porteur), type: 'debit', scanId, etat: 'debite' }, { $set: { etat: 'reserve' } });   // débité à la réponse, rendu à l'abandon
        await col('questions').insertOne({ _id: idQuestion(scanId, carte), scanId, carte, porteur: { type: porteur.type, id: porteur.id }, surface: porteur.surface ?? null,
            credit, raison: raison ?? null, choix, candidats: (candidats || []).filter(Number.isFinite), poseeLe: maintenant, etat: 'en-attente', reponse: null,
            priseLe: null, regleeLe: null, rembourse: null, raisonNonRembourse: null, lot: Boolean(lot) });
    } catch (e) { return repli(`écriture refusée (${e.message})`); }
    return { etat: 'en-attente' };
}

// Règle une question PRISE (en-reglement) : rend le crédit (compteur QUESTION, au jour de pose) puis pose l'état final. Lève si l'état final ne s'écrit pas : la question reste en-reglement, comptée « bloquée ».
async function regler(q, motif, cfg, maintenant) {
    if (q.lot) return col('questions').findOneAndUpdate({ _id: q._id, etat: 'en-reglement' }, { $set: { etat: 'non-remboursee', rembourse: false, raisonNonRembourse: 'lot', regleeLe: maintenant } }, { returnDocument: 'after' });
    const porteur = { type: q.porteur.type, id: q.porteur.id, surface: q.surface };
    const r = await rembourser(porteur, q.credit, motif, { scanId: q.scanId, compteur: 'question', jourDe: q.poseeLe, maintenant }, cfg);
    return col('questions').findOneAndUpdate({ _id: q._id, etat: 'en-reglement' },
        { $set: { etat: r.rendu ? 'remboursee' : 'non-remboursee', rembourse: r.rendu, raisonNonRembourse: r.rendu ? null : r.raisonNonRembourse, regleeLe: maintenant } }, { returnDocument: 'after' });
}
const limiteDe = (maintenant, cfg) => new Date(maintenant.getTime() - cfg.questionDelaiMs);

async function repondreQuestion(porteur, { scanId, carte = 0, choix } = {}, cfg, maintenant = new Date()) {
    const id = idQuestion(scanId, carte), limite = limiteDe(maintenant, cfg);
    const sien = { _id: id, 'porteur.type': porteur.type, 'porteur.id': porteur.id };
    const q0 = await col('questions').findOne(sien);
    if (!q0) return { statut: 404 };                                                     // inconnue OU d'un autre porteur : on ne révèle pas l'existence
    const cand = (q0.choix || []).find(c => c.id === choix);
    if (!cand && !ABANDONS.includes(choix)) return { statut: 400, code: 'ENTREE' };      // une liste fermée : tout le reste est refusé
    const abandon = !cand;
    const corps = (q, statut = 200) => ({ statut, etat: q.etat, question: nu(q) });
    // la prise conditionnelle : un seul gagnant, quel que soit le nombre de requêtes et de balayages
    const reponse = { choix, idProduct: cand ? cand.idProduct : null, aucune: abandon, le: maintenant };
    if (q0.lot) {
        const q = await col('questions').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $gt: limite } }, { $set: { etat: 'repondue', reponse, regleeLe: maintenant } }, { returnDocument: 'after' });
        if (q) return corps(q);                                                           // un lot : on n'enregistre que la vérité, aucun mouvement, aucun remboursement
    } else if (cand) {
        const q = await col('questions').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $gt: limite } }, { $set: { etat: 'repondue', reponse, regleeLe: maintenant } }, { returnDocument: 'after' });
        if (q) {
            await col('mouvements').updateOne({ ...base(porteur), type: 'debit', scanId, etat: 'reserve' }, { $set: { etat: 'debite' } });
            return corps(q);
        }
    } else {
        const q = await col('questions').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $gt: limite } }, { $set: { etat: 'en-reglement', priseLe: maintenant, reponse } }, { returnDocument: 'after' });
        if (q) {
            const fin = await regler(q, 'question-aucune', cfg, maintenant);
            return corps(fin || (await col('questions').findOne(sien)));
        }
    }
    // rien n'a été pris : on relit pour dire LAQUELLE des gardes a mordu
    const l = await col('questions').findOne(sien);
    if (!l) return { statut: 404 };
    if (l.etat === 'en-attente') {                                                       // seule la limite de 24 h reste : la question est abandonnée
        const pris = await col('questions').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $lte: limite } }, { $set: { etat: 'en-reglement', priseLe: maintenant } }, { returnDocument: 'after' });
        if (pris) { const fin = await regler(pris, 'question-abandonnee', cfg, maintenant); return corps(fin || (await col('questions').findOne(sien)), 410); }
        return { statut: 409, etat: (await col('questions').findOne(sien))?.etat, code: 'CONFLIT' };   // quelqu'un l'a prise entre-temps
    }
    const memeReponse = l.reponse && l.reponse.choix === choix;
    if (memeReponse && ['repondue', 'remboursee', 'non-remboursee'].includes(l.etat)) return corps(l);   // rejeu de la même réponse : même corps, rien de plus
    if (l.reponse == null && l.poseeLe <= limite) return corps(l, 410);                  // abandonnée par le balayage : le délai est passé
    return { statut: 409, etat: l.etat, code: 'CONFLIT', question: nu(l) };
}

async function balayerQuestions({ maintenant = new Date(), max = 500 } = {}, cfg) {
    const bilan = { reglees: 0, remboursees: 0, nonRemboursees: 0, erreurs: 0, bloquees: 0, lots: 0 };
    const limite = limiteDe(maintenant, cfg);
    for (let i = 0; i < max; i++) {
        const q = await col('questions').findOneAndUpdate({ etat: 'en-attente', poseeLe: { $lte: limite } }, { $set: { etat: 'en-reglement', priseLe: maintenant } }, { sort: { poseeLe: 1 }, returnDocument: 'after' });
        if (!q) break;
        let fin = null;
        try { fin = await regler(q, 'question-abandonnee', cfg, maintenant); }
        catch (e) { bilan.erreurs++; console.error(`🔴 [v2 question-balayage] ${q._id} : ${e.message} — reste « en-reglement », à vérifier à la main`); continue; }
        if (q.lot) { bilan.lots++; continue; }
        bilan.reglees++;
        if (fin && fin.rembourse) bilan.remboursees++; else bilan.nonRemboursees++;
    }
    bilan.bloquees = await col('questions').countDocuments({ etat: 'en-reglement', priseLe: { $lt: new Date(maintenant.getTime() - BLOQUEE_MS) } });
    if (bilan.bloquees) console.error(`🔴 [v2 question-balayage] ${bilan.bloquees} question(s) bloquée(s) « en-reglement » depuis plus de 15 min : crédit rendu ou non, à vérifier à la main (jamais reprise seule)`);
    return bilan;
}
module.exports = { reserverQuestion, repondreQuestion, balayerQuestions };
