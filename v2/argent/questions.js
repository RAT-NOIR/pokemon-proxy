'use strict';
// LA QUESTION RÉSERVÉE. Même machine à états que acces.js (poserQuestion / repondreQuestion / rembourserQuestionsAbandonnees), clé (porteur, scanId:carte) :
//   en-attente → repondue                       (réponse par un candidat : le débit initial EST la facture, rien de plus)
//   en-attente → en-reglement → remboursee | non-remboursee   (« aucune », « ne-sait-pas », ou sans réponse sous 24 h)
// ⚠️ Un « en-reglement » d'une question HORS LOT n'est JAMAIS repris seul : un processus tué entre la prise et l'état final a pu rendre le crédit, le reprendre risquerait de le rendre deux fois.
// UN-CANDIDAT-2 : pour une carte de LOT cette raison n'existe pas (aucun crédit ne bouge avant l'écriture d'état ; le remboursement du lot est idempotent par son claim) : une ligne de lot restée
// « en-reglement » au-delà de `cfg.lot.reglementBloqueMs` (15 min) est REPRISE par le balayage, et listée par la réconciliation tant qu'elle ne l'est pas.
const db = require('../db'); const { rembourser, rembourserLigne } = require('./ledger');
const col = nom => db.col(nom);
const base = p => (p.type === 'compte' ? { compteId: p.id } : { installationId: p.id });
const idQuestion = (scanId, carte) => `${scanId}:${carte}`;
const BLOQUEE_MS = 15 * 60e3;
const ATTENTE_GAGNANT_MS = 40;
const ABANDONS = ['aucune', 'ne-sait-pas'];
const { facturation } = require('./facturation');
const nu = q => q;   // la question rendue telle que stockée (aucun champ secret)

// La facturation d'une question RÉGLÉE : réponse par un candidat = débitée ; abandon rendu = rendu ; abandon refusé = reste débitée, la cause est dite ; lot = rien de plus.
function facturationDe(q) {
    if (q.lot) return facturation({ motif: 'lot' });
    if (q.etat === 'remboursee') return facturation({ rembourse: 1, motif: 'question' });
    if (q.etat === 'non-remboursee') {
        const raison = require('./facturation').raisonPublique(q.raisonNonRembourse);
        return facturation({ debite: 1, motif: raison === 'plafond-jour' ? 'plafond-jour' : 'question', raisonNonRembourse: raison });
    }
    if (q.etat === 'repondue') return facturation({ debite: 1, motif: 'question' });
    return facturation({ reserve: 1, motif: 'question' });                         // en-attente / en-reglement : le crédit est réservé
}

async function reserverQuestion(porteur, credit, { scanId, carte = 0, raison, candidats = [], choix = [], lot = false, cleDebit = null } = {}, cfg, maintenant = new Date()) {
    if (!credit) return { etat: null };                       // administrateur, ou rien de débité : rien à régler
    const repli = async cause => {
        console.warn(`⚠️ [v2 question-repli] ${scanId} : ${cause} -> remboursée à l'émission`);
        const r = await rembourser(porteur, credit, `question:${raison}`, { scanId, compteur: 'question', maintenant }, cfg);
        return { etat: r.rendu ? 'remboursee' : 'non-remboursee', repli: cause, raisonNonRembourse: r.rendu ? null : r.raisonNonRembourse };
    };
    if (!scanId) return repli('aucun identifiant de scan');
    const _id = idQuestion(scanId, carte);
    try {
        await col('questions_v2').insertOne({ _id, scanId, carte, porteur: { type: porteur.type, id: porteur.id }, surface: porteur.surface ?? null,
            credit, raison: raison ?? null, choix, candidats: (candidats || []).filter(Number.isFinite), poseeLe: maintenant, etat: 'en-attente', reponse: null,
            priseLe: null, regleeLe: null, rembourse: null, raisonNonRembourse: null, lot: Boolean(lot) });
    } catch (e) {
        // I3 — une réservation REJOUÉE pour la même (scanId, carte) est IDEMPOTENTE : elle rend l'état existant, ne touche ni au crédit ni à la question.
        // Seule une ligne qui n'est pas CELLE de ce porteur et de ce scan (corrompue, étrangère) part au repli.
        if (e.code === 11000) {
            const ex = await col('questions_v2').findOne({ _id });
            if (ex && ex.scanId === scanId && ex.porteur && ex.porteur.type === porteur.type && String(ex.porteur.id) === String(porteur.id)) {
                // N2 — la clé rejouée après un remboursement a REDÉBITÉ (I2) : aucun débit sans livraison, ce débit neuf est rendu dans le même geste (hors plafond : ce n'est pas une panne)
                if (ex.etat === 'remboursee') {
                    // UNIQUEMENT la ligne du débit neuf, désignée par `cleDebit` (= `cle` rendue par debiter) — OBLIGATOIRE : on ne devine jamais une ligne
                    // (une unité de lot ré-essayée et LIVRÉE porte aussi un cleOrigine). Sans elle, rien n'est rendu et la cause est dite.
                    if (!cleDebit) {
                        console.error(`🔴 [v2 question-rejeu] ${scanId} : cleDebit absente — le débit neuf d'une question remboursee N'EST PAS rendu (aucune ligne devinée)`);
                        return { etat: 'non-remboursee', rejoue: true, remboursee: false, raisonNonRembourse: 'cle-debit-absente' };
                    }
                    const r = await rembourserLigne(porteur, cleDebit, `question:${raison}`, { maintenant }, cfg);
                    if (r.rendu) return { etat: 'remboursee', rejoue: true, remboursee: true };
                    console.error(`🔴 [v2 question-rejeu] ${scanId} : le débit neuf d'une question remboursee n'a pas été rendu (${r.raisonNonRembourse})`);
                    return { etat: 'non-remboursee', rejoue: true, remboursee: false, raisonNonRembourse: r.raisonNonRembourse };
                }
                return { etat: ex.etat, rejoue: true };
            }
        }
        return repli(`écriture refusée (${(e && (e.code || e.name)) || 'erreur'})`);   // jamais e.message : une E11000 cite la collection et la clé
    }
    try {
        if (!lot) await col('mouvements').updateOne({ ...base(porteur), type: 'debit', scanId, etat: 'debite' }, { $set: { etat: 'reserve' } });   // débité à la réponse, rendu à l'abandon
    } catch (e) {
        try { await col('questions_v2').deleteOne({ _id, etat: 'en-attente' }); } catch (_) { /* le repli rend le crédit : la question orpheline ne peut plus être répondue */ }
        return repli(`réserve refusée (${(e && (e.code || e.name)) || 'erreur'})`);
    }
    return { etat: 'en-attente' };
}

// Règle une question PRISE (en-reglement) : rend le crédit (compteur QUESTION, au jour de pose) puis pose l'état final. Lève si l'état final ne s'écrit pas : la question reste en-reglement, comptée « bloquée ».
async function regler(q, motif, cfg, maintenant) {
    const porteur = { type: q.porteur.type, id: q.porteur.id, surface: q.surface };
    if (q.lot) {
        const fin = await col('questions_v2').findOneAndUpdate({ _id: q._id, etat: 'en-reglement' }, { $set: { etat: 'non-remboursee', rembourse: false, raisonNonRembourse: 'lot', regleeLe: maintenant } }, { returnDocument: 'after' });
        await rendreLotSiConfirmationsRefusees(q.scanId, porteur, q.credit, cfg, maintenant);      // l'abandon d'une confirmation peut être la DERNIÈRE du lot
        return fin;
    }
    const r = await rembourser(porteur, q.credit, motif, { scanId: q.scanId, compteur: 'question', jourDe: q.poseeLe, maintenant }, cfg);
    return col('questions_v2').findOneAndUpdate({ _id: q._id, etat: 'en-reglement' },
        { $set: { etat: r.rendu ? 'remboursee' : 'non-remboursee', rembourse: r.rendu, raisonNonRembourse: r.rendu ? null : r.raisonNonRembourse, regleeLe: maintenant } }, { returnDocument: 'after' });
}
// UN-CANDIDAT, tour 1 — un LOT est rendu UNE fois si, une fois tout réglé, CHACUNE de ses cartes est un `introuvable` OU une question de CONFIRMATION (un seul choix) non confirmée
// (NON = `aucune`, `ne-sait-pas`, ou abandonnée au balayage). Avant D1 ces cartes étaient des introuvables : un lot qui n'avait que cela était rendu ; le client ne paie jamais plus qu'avant.
// Toute carte affirmée, toute confirmation OUI, toute question à 2 ou 3 candidats : pas rendu par cette règle (règle des lots inchangée). Le remboursement est le MÊME que celui d'un lot
// entièrement introuvable (ledger.rembourser, compteur `panne`, claim `rb|scanId`).
// TOUR 2 — un remboursement de lot qui ÉCHOUE laisse une trace : l'état « lot à rendre » (`lotARendre: { depuis, cause }`) est ÉCRIT sur les lignes `questions_v2` du lot, le BALAYAGE le reprend et
// `reconcilier()` le liste. La décision finale est écrite (`lotIssue`) pour que le rejeu d'un NON redise le même résultat.
// TOUR 3 — le JUGEMENT du lot est un état DÉRIVÉ, recalculé par le balayage : tout lot dont toutes les questions sont réglées et qui ne porte ni `lotIssue` ni `lotARendre` est rejugé (un arrêt entre
// « repondue » et le jugement ne perd donc rien), TRIÉ du plus ancien et BORNÉ par passage (V2_LOT_REPRISES_PASSAGE). Le jugement est idempotent (claim `rb|scanId`). « Déjà rendu » RELIT le grand livre.
// Sont DÉFINITIFS (rien à reprendre) : plafond du jour, aucun débit, déjà livré, non éligible. Sont À REPRENDRE : analyse absente, exception, erreur du ledger, remboursement partiel.
const REGLEE = ['repondue', 'remboursee', 'non-remboursee'];
const RAISONS_DEFINITIVES = ['plafond-jour', 'aucun-debit', 'deja-livre'];
// 'attente' (une question n'est pas réglée) | 'non' (le lot n'est pas rendu par cette règle) | { doute } (on ne peut pas juger) | 'rendre'
async function jugerLot(scanId, qs) {
    if (!qs.length) return 'non';
    if (qs.some(q => !REGLEE.includes(q.etat))) return 'attente';
    for (const q of qs) {
        if (!Array.isArray(q.choix) || q.choix.length !== 1) return 'non';                                  // une question à 2 ou 3 candidats
        if (q.reponse && q.reponse.aucune !== true) return 'non';                                           // OUI : une carte reconnue, le lot est payé
    }
    const an = await col('analyses').findOne({ _id: scanId }, { projection: { cartes: 1 } });
    if (!an || !Array.isArray(an.cartes) || !an.cartes.length) return { doute: 'analyse-absente' };
    for (let i = 0; i < an.cartes.length; i++) {
        const c = an.cartes[i];
        if (c && c.statut === 'introuvable') continue;
        if (!c || c.statut !== 'a-trancher' || !qs.some(x => x.carte === i)) return 'non';                   // carte affirmée, ou sans confirmation
    }
    return 'rendre';
}
// Le grand livre du lot : combien d'unités débitées, combien rendues (jamais l'objet `credit` d'un appelant).
async function grandLivreDuLot(scanId, porteur) {
    const debits = await col('mouvements').find({ ...base(porteur), type: 'debit', scanId, delta: -1 }).toArray();
    // TOUR 1 — « rendu » se juge sur les MOUVEMENTS du grand livre (`remboursement`, delta 1, écrits APRÈS le crédit), jamais sur `debit.etat` : la prise atomique met le débit à « rembourse » AVANT de créditer,
    // et un crédit qui échoue restitue l'état. Un débit « rembourse » SANS mouvement correspondant est AMBIGU (ni rendu, ni rendu à nouveau) : compté à part (`ambigus`) et listé par la réconciliation.
    const mouvements = await col('mouvements').countDocuments({ type: 'remboursement', scanId, delta: 1 });
    const prises = debits.filter(d => d.etat === 'rembourse').length;
    return { total: debits.length, rendues: mouvements, ambigus: Math.max(0, prises - mouvements) };
}
// TOUR 1 — un arrêt du processus ENTRE deux unités d'un grand lot laisse la claim `rb|scan` (delta ≠ 0) sans son renommage `…|fait|…` : le remboursement ne reprendrait jamais (« deja-rembourse » à chaque passage).
// Au-delà du délai de reprise, la claim est renommée (même geste que le ledger en fin de partiel) et le remboursement CONTINUE sur les unités restantes ; chaque unité ne se rend que par sa prise atomique.
// Une claim sans aucune unité rendue (delta 0) n'est JAMAIS libérée ici : elle est listée par la réconciliation (procédure manuelle).
async function reprendreClaimInterrompue(scanId, cfg, maintenant) {
    const lignes = await col('mouvements').find({ type: 'remboursement', scanId }).toArray();
    const limite = new Date(maintenant).getTime() - cfg.lot.reglementBloqueMs;
    const claim = lignes.find(m => typeof m.cleIdempotence === 'string' && m.cleIdempotence.startsWith(`rb|${scanId}`) && !m.cleIdempotence.includes('#') && !m.cleIdempotence.includes('|fait|') && m.delta !== 0 && new Date(m.le).getTime() < limite);
    if (!claim) return false;
    const r = await col('mouvements').updateOne({ _id: claim._id, cleIdempotence: claim.cleIdempotence }, { $set: { cleIdempotence: `${claim.cleIdempotence}|fait|${claim._id}` } });
    return (r.modifiedCount ?? 0) > 0;
}
const toutRendu = gl => gl.total > 0 && gl.rendues >= gl.total;
// UN-CANDIDAT-2 : `depuis` est posé UNE fois (l'âge réel du lot à rendre) ; `essais` compte les jugements ratés — la reprise passe DERRIÈRE les lots qui ont échoué le plus (jamais d'affamement)
const marquerLot = async (scanId, cause, maintenant) => { try {
    await col('questions_v2').updateMany({ scanId, lot: true, 'lotARendre.depuis': { $exists: false } }, { $set: { 'lotARendre.depuis': maintenant } });
    await col('questions_v2').updateMany({ scanId, lot: true }, { $set: { 'lotARendre.cause': cause }, $inc: { 'lotARendre.essais': 1 } });
} catch (e) { console.error(`🔴 [v2 lot-confirmations] ${scanId} : état « lot à rendre » NON écrit (${(e && (e.code || e.name)) || 'erreur'}) — le balayage le rejugera`); } };
// la décision FINALE (jamais écrasée) ; la marque tombe
async function ecrireIssue(scanId, issue) {
    await col('questions_v2').updateMany({ scanId, lot: true, lotIssue: { $exists: false } }, { $set: { lotIssue: issue } });
    await col('questions_v2').updateMany({ scanId, lot: true }, { $unset: { lotARendre: '' } });
}
const decisionDeLotIssue = i => ({ rendu: Boolean(i.rendu), ...(i.raison === 'plafond-jour' ? { raisonNonRembourse: 'plafond-jour', debite: i.debite || 1 } : {}) });
// Rend { rendu, raisonNonRembourse?, debite?, aRendre?, attente? }. Appelée quand une question de LOT est réglée, au rejeu d'un NON, et par le balayage.
async function rendreLotSiConfirmationsRefusees(scanId, porteur, credit, cfg, maintenant) {
    try {
        if (!credit || !scanId) return { rendu: false };
        const qs = await col('questions_v2').find({ scanId, lot: true }).toArray();
        const decide = qs.find(q => q.lotIssue);
        if (decide) { if (qs.some(q => q.lotARendre)) await col('questions_v2').updateMany({ scanId, lot: true }, { $unset: { lotARendre: '' } }); return decisionDeLotIssue(decide.lotIssue); }
        const verdict = await jugerLot(scanId, qs);
        if (verdict === 'attente') return { rendu: false, attente: true };
        if (verdict === 'non') { await ecrireIssue(scanId, { rendu: false, raison: 'non-eligible', le: maintenant }); return { rendu: false }; }
        if (verdict !== 'rendre') { await marquerLot(scanId, verdict.doute, maintenant); console.error(`🔴 [v2 lot-confirmations] ${scanId} : lot jugé impossible (${verdict.doute}) — écrit « lot à rendre », repris par le balayage`); return { rendu: false, aRendre: true }; }
        let r = await rembourser(porteur, credit, 'lot-confirmations-refusees', { scanId, compteur: 'panne', maintenant }, cfg);
        let raison = (r && r.raisonNonRembourse) || 'erreur';
        if (!(r && r.rendu) && raison === 'deja-rembourse' && await reprendreClaimInterrompue(scanId, cfg, maintenant)) {
            r = await rembourser(porteur, credit, 'lot-confirmations-refusees', { scanId, compteur: 'panne', maintenant }, cfg);
            raison = (r && r.raisonNonRembourse) || 'erreur';
        }
        if ((r && r.rendu) || raison === 'deja-rembourse') {          // « déjà rendu » : on RELIT le grand livre ; le lot n'est rendu que si TOUT son montant l'est
            let gl = await grandLivreDuLot(scanId, porteur);
            // UN-CANDIDAT-2 : le PERDANT d'une course a pu relire le grand livre avant que le gagnant du claim ait fini de rendre : il relit (courte pause, 3 fois au plus) avant d'écrire une marque
            for (let i = 0; i < 3 && raison === 'deja-rembourse' && !toutRendu(gl); i++) { await new Promise(fin => setTimeout(fin, ATTENTE_GAGNANT_MS)); gl = await grandLivreDuLot(scanId, porteur); }
            if (toutRendu(gl)) { await ecrireIssue(scanId, { rendu: true, le: maintenant }); return { rendu: true }; }
            await marquerLot(scanId, gl.ambigus ? `ambigu:${gl.ambigus}:${gl.rendues}/${gl.total}` : `partiel:${gl.rendues}/${gl.total}`, maintenant);
            console.error(`🔴 [v2 lot-confirmations] ${scanId} : lot rendu en partie (${gl.rendues}/${gl.total}${gl.ambigus ? `, ${gl.ambigus} débit(s) « rembourse » sans mouvement` : ''}) — écrit « lot à rendre », repris par le balayage`);
            return { rendu: false, aRendre: true };
        }
        if (RAISONS_DEFINITIVES.includes(raison)) {
            let debite = 0;
            if (raison === 'plafond-jour') {
                const gl = await grandLivreDuLot(scanId, porteur);
                // UN-CANDIDAT-2 : « plafond du jour » n'est JAMAIS définitif quand des unités du lot sont déjà rendues (un partiel antérieur) : le client a été rendu en partie, le reste est à rendre
                if (gl.rendues > 0) {
                    await marquerLot(scanId, `partiel:${gl.rendues}/${gl.total}`, maintenant);
                    console.error(`🔴 [v2 lot-confirmations] ${scanId} : plafond atteint alors que ${gl.rendues}/${gl.total} unité(s) sont déjà rendues — écrit « lot à rendre », jamais « plafond-jour » définitif`);
                    return { rendu: false, aRendre: true };
                }
                debite = gl.total;
            }
            await ecrireIssue(scanId, { rendu: false, raison, debite, le: maintenant });
            return { rendu: false, raisonNonRembourse: raison, debite };
        }
        await marquerLot(scanId, `rembourser:${raison}`, maintenant);
        console.error(`🔴 [v2 lot-confirmations] ${scanId} : remboursement du lot en échec (${raison}) — écrit « lot à rendre », repris par le balayage`);
        return { rendu: false, aRendre: true };
    } catch (e) {
        console.error(`🔴 [v2 lot-confirmations] ${scanId} : exception (${(e && (e.code || e.name)) || 'erreur'}) — écrit « lot à rendre », repris par le balayage`);
        await marquerLot(scanId, 'exception', maintenant);
        try { if (toutRendu(await grandLivreDuLot(scanId, porteur))) return { rendu: true, aRendre: true }; } catch (_) { /* le grand livre ne répond pas : on ne dit rien de plus */ }   // le remboursement a eu lieu, seule l'écriture d'état a échoué
        return { rendu: false, aRendre: true };
    }
}
// Le balayage : (1) reprend les lots « à rendre », du plus ancien ; (2) juge les lots RÉGLÉS mais NON JUGÉS (arrêt entre « repondue » et le jugement), du plus ancien. Chaque phase est bornée à
// `cfg.lot.reprisesParPassage` lots JUGÉS par passage. Même fonction, même claim : une reprise ne rend jamais deux fois. Rend { repris, juges } = lots rendus par chaque phase.
async function reprendreLots(cfg, maintenant) {
    const max = cfg.lot.reprisesParPassage, sortie = { repris: 0, juges: 0 };
    const phase = async (filtre, tri, cle) => {
        let docs = [];
        try { docs = await col('questions_v2').find(filtre).sort(tri).limit(max * 5).toArray(); } catch (e) { console.error(`🔴 [v2 lot-confirmations] lecture des lots à juger : ${(e && (e.code || e.name)) || 'erreur'}`); return; }
        const vus = new Set(); let jugesN = 0;
        for (const q of docs) {
            const k = String(q.scanId);
            if (vus.has(k)) continue;
            vus.add(k);
            if (jugesN >= max) break;
            const r = await rendreLotSiConfirmationsRefusees(q.scanId, { type: q.porteur.type, id: q.porteur.id, surface: q.surface }, q.credit, cfg, maintenant);
            if (r.attente) continue;                                      // pas encore réglé : ne consomme pas la borne
            jugesN++;
            if (r.rendu) sortie[cle]++;
        }
    };
    await phase({ lot: true, lotARendre: { $exists: true } }, { 'lotARendre.essais': 1, 'lotARendre.depuis': 1 }, 'repris');     // les lots qui ont échoué le moins d'abord, puis le plus ancien
    await phase({ lot: true, etat: { $in: REGLEE }, lotIssue: { $exists: false }, lotARendre: { $exists: false } }, { regleeLe: 1 }, 'juges');
    return sortie;
}
// Les lots RÉGLÉS mais NON JUGÉS d'un porteur (ni décision ni marque), assez anciens pour que le jugement immédiat ait eu lieu : listés par la réconciliation.
async function lotsNonJuges(filtrePorteur, maintenant, graceMs = 10 * 60e3) {
    const limite = new Date(new Date(maintenant).getTime() - graceMs);
    const docs = await col('questions_v2').find({ ...filtrePorteur, lot: true, etat: { $in: REGLEE }, lotIssue: { $exists: false }, lotARendre: { $exists: false }, regleeLe: { $lt: limite } }).toArray();
    const sortie = new Map(), vus = new Set();
    for (const q of docs) {
        const k = String(q.scanId);
        if (vus.has(k)) continue;
        vus.add(k);
        // UN-CANDIDAT-2 : le délai de grâce part de la DERNIÈRE réponse du lot (la ligne la plus récente), pas de la plus ancienne
        const lignes = await col('questions_v2').find({ scanId: q.scanId, lot: true }).toArray();
        if (lignes.some(l => !REGLEE.includes(l.etat))) continue;
        const derniere = Math.max(...lignes.map(l => l.regleeLe ? new Date(l.regleeLe).getTime() : 0));
        if (derniere >= limite.getTime()) continue;
        sortie.set(k, { scanId: q.scanId, porteur: `${q.porteur.type}:${q.porteur.id}`, regleeLe: new Date(derniere) });
    }
    return [...sortie.values()];
}
// UN-CANDIDAT-2 : les lignes de LOT restées « en-reglement » (arrêt du processus, erreur de base pendant le règlement) depuis plus de `ms` : listées par la réconciliation avec leur âge.
async function lotsEnReglement(filtrePorteur, maintenant, ms) {
    const t = new Date(maintenant).getTime();
    const docs = await col('questions_v2').find({ ...filtrePorteur, lot: true, etat: 'en-reglement', priseLe: { $lt: new Date(t - ms) } }).toArray();
    return docs.map(q => ({ scanId: q.scanId, carte: q.carte, porteur: `${q.porteur.type}:${q.porteur.id}`, priseLe: q.priseLe, ageMinutes: Math.floor((t - new Date(q.priseLe).getTime()) / 60e3) }));
}
// Reprend le règlement d'une ligne de LOT restée « en-reglement » au-delà de `cfg.lot.reglementBloqueMs`. Pour un lot AUCUN crédit n'a bougé dans `regler` avant son écriture d'état (le remboursement du lot passe par le claim
// `rb|scanId`, idempotent) : la reprise ne peut pas rendre deux fois. La prise est conditionnelle (priseLe rafraîchi) : un règlement vivant n'est jamais doublé, un échec est retenté après le même délai.
async function reprendreReglementsDeLots(cfg, maintenant, bilan) {
    const limite = new Date(new Date(maintenant).getTime() - cfg.lot.reglementBloqueMs);
    for (let i = 0; i < cfg.lot.reprisesParPassage; i++) {
        const q = await col('questions_v2').findOneAndUpdate({ lot: true, etat: 'en-reglement', priseLe: { $lt: limite } }, { $set: { priseLe: maintenant } }, { sort: { priseLe: 1 }, returnDocument: 'after' });
        if (!q) break;
        try { await regler(q, 'question-abandonnee', cfg, maintenant); bilan.lotsReglementsRepris++; }
        catch (e) { bilan.erreurs++; bilan.lotsReglementsEnEchec++; console.error(`🔴 [v2 question-balayage] ${q._id} : reprise du règlement d'une ligne de LOT restée « en-reglement » depuis plus de ${Math.round(cfg.lot.reglementBloqueMs / 60e3)} min : ${(e && (e.code || e.name)) || 'erreur'} — retentée après le même délai (aucun crédit n'a bougé : la reprise d'un lot est idempotente)`); }
    }
}
// La facturation d'un lot JUGÉ (réponse et rejeu) : rendu, ou refusé au plafond ; rien pour le reste (le lot reste payé à juste titre).
function facturationDuLot(r) {
    if (!r) return null;
    if (r.rendu) return facturation({ rembourse: 1, motif: 'lot' });
    if (r.raisonNonRembourse === 'plafond-jour') return facturation({ debite: r.debite || 1, motif: 'plafond-jour', raisonNonRembourse: 'plafond-jour' });
    return null;
}
// La réponse d'une question de LOT réglée : sa facturation, et `remboursementEnAttente` tant qu'un remboursement dû n'est pas fait.
function habillerLot(c, r) {
    const f = facturationDuLot(r);
    return { ...c, ...(f ? { facturation: f } : {}), ...(r && r.aRendre && !r.rendu ? { remboursementEnAttente: true } : {}) };
}
const limiteDe = (maintenant, cfg) => new Date(maintenant.getTime() - cfg.questionDelaiMs);

async function repondreQuestion(porteur, { scanId, carte = 0, choix } = {}, cfg, maintenant = new Date()) {
    const id = idQuestion(scanId, carte), limite = limiteDe(maintenant, cfg);
    const sien = { _id: id, 'porteur.type': porteur.type, 'porteur.id': porteur.id };
    const q0 = await col('questions_v2').findOne(sien);
    if (!q0) return { statut: 404 };                                                     // inconnue OU d'un autre porteur : on ne révèle pas l'existence
    const cand = (q0.choix || []).find(c => c.id === choix);
    if (!cand && !ABANDONS.includes(choix)) return { statut: 400, code: 'ENTREE' };      // une liste fermée : tout le reste est refusé
    const abandon = !cand;
    const corps = (q, statut = 200) => ({ statut, etat: q.etat, question: nu(q), facturation: facturationDe(q) });
    // la prise conditionnelle : un seul gagnant, quel que soit le nombre de requêtes et de balayages
    const reponse = { choix, idProduct: cand ? cand.idProduct : null, aucune: abandon, le: maintenant };
    if (q0.lot) {
        const q = await col('questions_v2').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $gt: limite } }, { $set: { etat: 'repondue', reponse, regleeLe: maintenant } }, { returnDocument: 'after' });
        if (q) {                                                                          // un lot : on n'enregistre que la vérité ; seul le LOT ENTIER peut être rendu (confirmations refusées)
            const lot = await rendreLotSiConfirmationsRefusees(q.scanId, porteur, q.credit, cfg, maintenant);
            return habillerLot(corps(q), lot);
        }
    } else if (cand) {
        const q = await col('questions_v2').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $gt: limite } }, { $set: { etat: 'repondue', reponse, regleeLe: maintenant } }, { returnDocument: 'after' });
        if (q) {
            await col('mouvements').updateOne({ ...base(porteur), type: 'debit', scanId, etat: 'reserve' }, { $set: { etat: 'debite' } });
            return corps(q);
        }
    } else {
        const q = await col('questions_v2').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $gt: limite } }, { $set: { etat: 'en-reglement', priseLe: maintenant, reponse } }, { returnDocument: 'after' });
        if (q) {
            const fin = await regler(q, 'question-aucune', cfg, maintenant);
            return corps(fin || (await col('questions_v2').findOne(sien)));
        }
    }
    // rien n'a été pris : on relit pour dire LAQUELLE des gardes a mordu
    const l = await col('questions_v2').findOne(sien);
    if (!l) return { statut: 404 };
    if (l.etat === 'en-attente') {                                                       // seule la limite de 24 h reste : la question est abandonnée
        const pris = await col('questions_v2').findOneAndUpdate({ ...sien, etat: 'en-attente', poseeLe: { $lte: limite } }, { $set: { etat: 'en-reglement', priseLe: maintenant } }, { returnDocument: 'after' });
        if (pris) { const fin = await regler(pris, 'question-abandonnee', cfg, maintenant); return corps(fin || (await col('questions_v2').findOne(sien)), 410); }
        return { statut: 409, etat: (await col('questions_v2').findOne(sien))?.etat, code: 'CONFLIT' };   // quelqu'un l'a prise entre-temps
    }
    const memeReponse = l.reponse && l.reponse.choix === choix;
    if (memeReponse && ['repondue', 'remboursee', 'non-remboursee'].includes(l.etat)) {               // rejeu de la même réponse : même corps, rien de plus
        if (l.lot && !(l.reponse && l.reponse.aucune === false)) {                                    // un NON de lot : le jugement est IDEMPOTENT, il redit sa décision (ou la prend, s'il n'a pas eu lieu)
            const lot = await rendreLotSiConfirmationsRefusees(l.scanId, porteur, l.credit, cfg, maintenant);
            return habillerLot(corps(l), lot);
        }
        return corps(l);
    }
    if (l.reponse == null && l.poseeLe <= limite) return corps(l, 410);                  // abandonnée par le balayage : le délai est passé
    return { statut: 409, etat: l.etat, code: 'CONFLIT', question: nu(l) };
}

async function balayerQuestions({ maintenant = new Date(), max = 500 } = {}, cfg) {
    // `abandonnees` : les questions NON-lot qu'on vient d'abandonner (scanId en chaîne) — le banc réel en supprime l'image en attente (B6.4)
    const bilan = { reglees: 0, remboursees: 0, nonRemboursees: 0, erreurs: 0, bloquees: 0, lots: 0, abandonnees: [] };
    const limite = limiteDe(maintenant, cfg);
    for (let i = 0; i < max; i++) {
        const q = await col('questions_v2').findOneAndUpdate({ etat: 'en-attente', poseeLe: { $lte: limite } }, { $set: { etat: 'en-reglement', priseLe: maintenant } }, { sort: { poseeLe: 1 }, returnDocument: 'after' });
        if (!q) break;
        let fin = null;
        try { fin = await regler(q, 'question-abandonnee', cfg, maintenant); }
        catch (e) { bilan.erreurs++; console.error(`🔴 [v2 question-balayage] ${q._id} : ${(e && (e.code || e.name)) || 'erreur'} — reste « en-reglement », à vérifier à la main`); continue; }
        if (q.lot) { bilan.lots++; continue; }
        bilan.reglees++;
        bilan.abandonnees.push({ scanId: String(q.scanId), carte: q.carte });
        if (fin && fin.rembourse) bilan.remboursees++; else bilan.nonRemboursees++;
    }
    bilan.lotsReglementsRepris = 0; bilan.lotsReglementsEnEchec = 0;
    await reprendreReglementsDeLots(cfg, maintenant, bilan);            // UN-CANDIDAT-2 : une ligne de lot restée « en-reglement » est reprise (jamais une question hors lot)
    const lots = await reprendreLots(cfg, maintenant);                  // TOURS 2-3 : lots « à rendre » repris, lots réglés mais non jugés jugés (bornés, du plus ancien)
    bilan.lotsRepris = lots.repris; bilan.lotsJuges = lots.juges;
    // `bloquees` ne compte que les questions HORS LOT (jamais reprises seules) ; les lignes de lot ont leur propre reprise et leur propre compte (`lotsReglementsEnEchec`)
    bilan.bloquees = await col('questions_v2').countDocuments({ etat: 'en-reglement', lot: { $ne: true }, priseLe: { $lt: new Date(maintenant.getTime() - BLOQUEE_MS) } });
    if (bilan.bloquees) console.error(`🔴 [v2 question-balayage] ${bilan.bloquees} question(s) bloquée(s) « en-reglement » depuis plus de 15 min : crédit rendu ou non, à vérifier à la main (jamais reprise seule)`);
    return bilan;
}
module.exports = { reserverQuestion, repondreQuestion, balayerQuestions, facturationDe, lotsNonJuges, lotsEnReglement };
