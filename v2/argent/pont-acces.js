'use strict';
// L'ADAPTATEUR vers acces.js (A0.6) : acces.js appelle `req.credit.v2.rembourser(req, motif, opts)` et `req.credit.v2.poserQuestion(req, q)` quand il existe.
// Il garde sa forme d'aujourd'hui (booléen, cause par le contexte de scan de sources.js) ; ici on n'écrit AUCUNE collection héritée.
const db = require('../db'); const { noterNonRemboursement } = require('../../sources');
const { rembourser } = require('./ledger'); const { reserverQuestion } = require('./questions'); const { raisonPublique } = require('./facturation');
const col = nom => db.col(nom);
const quand = ctx => { const m = ctx && ctx.maintenant; return (typeof m === 'function' ? m() : m) || new Date(); };

function creditV2(porteur, credit, cfg, ctx = {}) {
    const scanDe = req => (ctx.scanId && (typeof ctx.scanId === 'function' ? ctx.scanId(req) : ctx.scanId)) || (req && req.scanId) || null;
    return {
        // → true si un crédit a été RENDU ; sinon false, et la cause remonte par noterNonRemboursement (liste fermée de sources.js)
        // `compteur: 'jumeaux'` (JUMEAU-V2) : le refus est le NÔTRE (la garde des jumeaux), pas un échec du client — rendu sans plafond, `unites` (une par carte refusée) validé par le ledger.
        // L'unicité par scan reste (claim rb|scanId). Seuls `question` et `jumeaux` sont honorés : tout autre nom retombe sur `panne` (aussi constatée, sans plafond) ; seul le grand livre refuse un nom inconnu.
        async rembourser(req, motif, { compteur, jourDe, unites } = {}) {
            if (req.scanRembourse) { noterNonRemboursement('deja-rembourse'); return false; }      // un seul par requête
            req.scanRembourse = true;
            const scanId = scanDe(req), now = quand(ctx), question = compteur === 'question';
            // UNE PANNE APRÈS LA QUESTION, dans la même requête : la question est annulée D'ABORD (sinon un échec de l'annulation laisserait une question que le balayage rendrait une seconde fois)
            if (req.questionId && !question) {
                try { await col('questions_v2').updateOne({ _id: `${req.questionId}:0`, etat: 'en-attente' }, { $set: { etat: 'non-remboursee', rembourse: false, raisonNonRembourse: 'deja-rembourse', annuleePar: motif, regleeLe: now } }); }
                catch (e) { console.error(`🔴 [v2 question-annulation] ${req.questionId} : ${(e && (e.code || e.name)) || 'erreur'} — la panne n'est PAS remboursée ici`); noterNonRemboursement('erreur'); return false; }
            }
            // PLAFOND-DECLARE : tout ce qui passe par ce pont est décidé par le SERVEUR (la chaîne héritée juge un résultat incertain, une panne, un introuvable) : `constate-question` pour une question (rendu sans
            // plafond), `jumeaux` ou `panne` sinon. Les DÉCLARATIONS du client (réponse, abandon, prix illisible) ne passent jamais ici : questions.js et retour-live.js appellent le grand livre directement.
            // sans nature nommée (chaîne héritée) : seule une panne (`ia-echec`, `panne-*`) est hors plafond ; tout autre refus est un constat sur la photo (plafonné)
            const r = await rembourser(porteur, credit, motif, { scanId, compteur: question ? 'constate-question' : compteur === 'jumeaux' ? 'jumeaux' : compteur === 'indisponible' ? 'indisponible' : compteur === 'panne' || compteur === 'introuvable' ? compteur : /^(ia-echec|panne)/.test(String(motif)) ? 'panne' : 'introuvable', jourDe, ...(compteur === 'jumeaux' && Number.isInteger(unites) ? { unites } : {}), maintenant: now }, cfg);
            if (r.rendu) { req.scanRendu = true; return true; }
            noterNonRemboursement(raisonPublique(r.raisonNonRembourse));
            return false;
        },
        // → { etat: 'en-attente'|'remboursee'|'non-remboursee'|null, repli? } (la forme de acces.poserQuestion)
        async poserQuestion(req, q) {
            if (!credit) { noterNonRemboursement('aucun-debit'); return { etat: null }; }
            if (req.scanRembourse) return { etat: null };
            const candidats = (q.candidats || []).filter(Number.isFinite);
            const choix = Array.isArray(q.choix) ? q.choix : candidats.map(idProduct => ({ id: String(idProduct), idProduct }));
            const r = await reserverQuestion(porteur, credit, { scanId: q.scanId, carte: q.carte ?? 0, raison: q.raison, candidats, choix, lot: Boolean(q.lot) }, cfg, quand(ctx));
            if (r.etat === 'en-attente') req.questionId = q.scanId;
            else if (r.etat === 'remboursee') { req.scanRembourse = true; req.scanRendu = true; }                 // le repli a rendu le crédit à l'émission
            else if (r.etat === 'non-remboursee') { req.scanRembourse = true; noterNonRemboursement(raisonPublique(r.raisonNonRembourse)); }
            return r;
        }
    };
}
// Ce que B1 pose sur req.credit : la forme que acces.js lit déjà (userId pour ses journaux, poche) + le pont. Le userId est PRÉFIXÉ : il ne peut jamais désigner un portefeuille hérité.
function creditPourReq(porteur, credit, cfg, ctx = {}) {
    if (!porteur || !['compte', 'installation'].includes(porteur.type)) throw new Error('creditPourReq : porteur inconnu');
    return { userId: `v2:${porteur.type}:${porteur.id}`, poche: credit ? credit.poche : null, semaineIso: credit ? credit.semaineIso : undefined, v2: creditV2(porteur, credit, cfg, ctx) };
}
module.exports = { creditV2, creditPourReq };
