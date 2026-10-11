'use strict';
// O5 — LA MARQUE DE LIVRAISON D'UN SCAN. Invariant : aucun crédit n'est pris sans marque. La marque s'ouvre AVANT le premier débit d'un scan (une carte ou un lot, extension ou scanner),
// se CLÔT quand la réponse est remise au transport (événement `finish`), et se retire quand le débit n'a rien pris (refus, rejeu, administrateur).
// Une marque encore `en-suspens` au-delà du SEUIL est un scan dont la réponse n'est peut-être jamais partie (arrêt du processus : déploiement, OOM, coupure) :
// la passe de RATTRAPAGE la PREND (une écriture conditionnelle : un seul gagnant, même entre deux processus) puis
//   · la CONFIRME seulement si un fait DURABLE, écrit avant que la réponse parte, prouve que le client peut l'obtenir : la réponse finale stockée par `idempotente`
//     (v2/transport/idempotence.js : `etat: 'fini'`, statut < 300, corps portant CE scanId, non expirée — rejouable avec la même Idempotency-Key) ;
//   · sinon la REND par la primitive existante `argent.rembourser` (v2/argent/ledger.js : claim `rb|scanId`, prise atomique de chaque unité, garde des états clos) —
//     sans plafond (une faute du SERVEUR ne consomme aucun plafond du client), motif `arret-serveur`.
// ⚠️ LE SENS FAVORABLE AU CLIENT : la fenêtre « réponse partie, marque pas encore close » (le processus meurt entre l'envoi et l'écriture de `livre`) rend un scan OFFERT,
// borné à UN scan (jusqu'à 10 crédits pour un lot), si la réponse finale n'est pas stockée (route ≥ 300, scanner sans Idempotency-Key). Sinon la passe confirme.
// BORNE DE DURÉE : /api/identifier n'a pas de délai total propre ; la borne qui existe est celle de l'idempotence (battement du claim au plus 10 min, puis 2 min de claim sans
// battement = 12 min, config.retention) — le plafond de 5 min de B9.2 ne vaut que pour la PRISE du scanner (corps en mémoire), pas pour la requête. Le SEUIL est de 15 min : au-dessus.
// Pendant un déploiement Render l'ancien processus tourne encore à côté du nouveau (CLAUDE.md §17 : un chevauchement est le cas NORMAL) : la passe ne touche qu'une marque PLUS VIEILLE.
// Aucune panne injectable ici : pas de process.exit, pas de lecture d'environnement. Les bancs de coupure arrêtent leur propre processus par leurs propres moyens (voir test-coupure-processus.js).
const db = require('../db');
const registre = require('../registre');

const MIN = 60e3;
const SEUIL_MS = 15 * MIN;          // une marque en-suspens plus jeune est un scan qui peut encore répondre
const INTERVALLE_MS = 5 * MIN;      // ≤ SEUIL_MS : une marque trop jeune au démarrage est traitée au tour suivant, jamais oubliée
const DIFFERE_MS = 30 * 1000;       // la passe de démarrage attend que Mongo soit prêt (comme la purge du banc, B6.4)
const REPRISE_MS = 10 * MIN;        // une marque `en-reprise` dont la passe est morte se reprend après ce délai
const TTL_JOURS = 7;                // une marque close expire (30 jours au plus) ; une marque non close n'expire JAMAIS (pas d'expireLe)
const REPRISES_MAX = 5;             // après quoi une erreur persistante devient un `echec` listé, plus une boucle
const PAR_PASSE_MAX = 200;
const col = () => db.col('scans_en_cours');
const journal = (ou, e) => console.error(`❌ [v2 marque-scan] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);   // jamais e.message : il peut citer une clé ou un hôte
const journalScan = (scanId, texte) => console.error(`🔴 [v2 marque-scan] scan ${scanId} : ${texte}`);

// ── la marque : petite (6 champs à l'ouverture), sans adresse, sans IP, sans contenu d'annonce
async function ouvrir({ scanId, porteur, cleDebit, cleClaim = null, maintenant = new Date() }) {
    await col().insertOne({ _id: scanId, porteur: { type: porteur.type, id: porteur.id }, cleDebit, cleClaim, etat: 'en-suspens', ouverteLe: maintenant });
}
// Le débit n'a rien pris : la marque n'a plus de raison d'être. Conditionnel : jamais une marque déjà prise par la passe.
async function retirer(scanId) { return (await col().deleteOne({ _id: scanId, etat: 'en-suspens' })).deletedCount === 1; }
// La réponse est remise au transport : `livre`. Rend true si CETTE écriture a clos la marque (false : la passe l'avait prise, ou rien à clore).
async function clore(scanId, { maintenant = new Date() } = {}) {
    const r = await col().updateOne({ _id: scanId, etat: 'en-suspens' }, { $set: { etat: 'livre', closLe: maintenant, expireLe: new Date(maintenant.getTime() + TTL_JOURS * 86400e3) } });
    return r.modifiedCount === 1;
}

// ── le fait durable : la réponse finale de CE scan, stockée par idempotente, rejouable
async function reponseStockee(m, maintenant) {
    if (!m.cleClaim) return false;
    const d = await db.col('idempotence').findOne({ cle: m.cleClaim });
    if (!d || d.etat !== 'fini' || !(d.statut < 300) || typeof d.reponse !== 'string' || !(d.expireLe > maintenant)) return false;
    let j; try { j = JSON.parse(d.reponse); } catch { return false; }
    return Boolean(j) && typeof j === 'object' && String(j.scanId) === String(m._id);
}

async function prendre(maintenant, vus) {
    const vieux = new Date(maintenant.getTime() - SEUIL_MS), perime = new Date(maintenant.getTime() - REPRISE_MS);
    return col().findOneAndUpdate({ _id: { $nin: vus }, $or: [{ etat: 'en-suspens', ouverteLe: { $lte: vieux } }, { etat: 'en-reprise', priseLe: { $lte: perime } }] },
        { $set: { etat: 'en-reprise', priseLe: maintenant }, $inc: { reprises: 1 } }, { sort: { ouverteLe: 1 }, returnDocument: 'after' });
}
// L'état final se pose seulement si la marque est ENCORE à nous (en-reprise) ; un echec n'expire jamais.
const finir = (m, etat, issue, maintenant) => col().updateOne({ _id: m._id, etat: 'en-reprise' },
    { $set: { etat, issue, closLe: maintenant, ...(etat === 'echec' ? {} : { expireLe: new Date(maintenant.getTime() + TTL_JOURS * 86400e3) }) } });
const rendreALaPasse = (m, issue) => col().updateOne({ _id: m._id, etat: 'en-reprise' }, { $set: { etat: (m.reprises || 1) >= REPRISES_MAX ? 'echec' : 'en-suspens', issue } });

async function traiter(m, argent, maintenant, bilan) {
    const porteur = { type: m.porteur.type, id: m.porteur.id, surface: null };
    try {
        if (await reponseStockee(m, maintenant)) { await finir(m, 'confirme', 'reponse-stockee', maintenant); bilan.confirmees++; return; }
        // une question encore en attente sur ce scan est annulée D'ABORD (comme creditV2.rembourser) : un crédit rendu ne doit plus pouvoir être « répondu »
        await db.col('questions').updateMany({ scanId: m._id, 'porteur.type': porteur.type, 'porteur.id': porteur.id, etat: 'en-attente' },
            { $set: { etat: 'non-remboursee', rembourse: false, raisonNonRembourse: 'deja-rembourse', annuleePar: 'arret-serveur', regleeLe: maintenant } });
        const r = await argent.rembourser(porteur, { rattrapage: true }, 'arret-serveur', { scanId: m._id, compteur: 'panne', sansPlafond: true, maintenant });   // `credit` ne sert qu'à passer la garde : les unités se lisent au journal
        if (r && r.rendu) { await finir(m, 'rendu', 'rendu', maintenant); bilan.rendues++; return; }
        const raison = (r && r.raisonNonRembourse) || 'erreur';
        if (raison === 'deja-rembourse') { await finir(m, 'rendu', 'deja-rembourse', maintenant); bilan.dejaRendues++; return; }      // le scan s'est remboursé lui-même : rien de plus
        if (raison === 'aucun-debit') { await finir(m, 'sans-debit', 'aucun-debit', maintenant); bilan.sansDebit++; return; }          // la marque a précédé un débit qui n'a jamais eu lieu
        if (raison === 'deja-livre') { await finir(m, 'livre', 'question-repondue', maintenant); bilan.confirmees++; return; }          // une question a été répondue : un résultat A été livré
        if (raison === 'erreur') { await rendreALaPasse(m, 'erreur'); bilan.erreurs++; journalScan(m._id, 'remboursement en erreur, repris à la prochaine passe'); return; }
        await finir(m, 'echec', raison, maintenant); bilan.echecs++;                                                                  // la poche ne peut pas être rendue : listé par la réconciliation
        journalScan(m._id, `NON rendu (${raison}) — marque en échec, à voir par la réconciliation`);
    } catch (e) {
        journal('passe', e); bilan.erreurs++;
        try { await rendreALaPasse(m, 'erreur'); } catch (e2) { journal('reprise', e2); }
    }
}

/** Une passe. @returns { examinees, rendues, confirmees, dejaRendues, sansDebit, echecs, erreurs } */
async function rattraper({ argent = registre.obtenir('argent'), maintenant = new Date() } = {}) {
    const bilan = { examinees: 0, rendues: 0, confirmees: 0, dejaRendues: 0, sansDebit: 0, echecs: 0, erreurs: 0 };
    const vus = [];
    for (let i = 0; i < PAR_PASSE_MAX; i++) {
        let m;
        try { m = await prendre(maintenant, vus); } catch (e) { journal('prise', e); bilan.erreurs++; break; }
        if (!m) break;
        vus.push(m._id); bilan.examinees++;
        await traiter(m, argent, maintenant, bilan);
    }
    if (bilan.examinees) console.error(`🔴 [v2 marque-scan] passe : ${bilan.examinees} scan(s) en suspens examiné(s) — rendus ${bilan.rendues}, confirmés ${bilan.confirmees}, déjà remboursés ${bilan.dejaRendues}, sans débit ${bilan.sansDebit}, échecs ${bilan.echecs}, erreurs ${bilan.erreurs}`);
    return bilan;
}

// ── la réconciliation les liste : en-suspens / en-reprise PLUS VIEILLES que le seuil, et tout `echec`
async function enSuspens({ porteur = null, maintenant = new Date() } = {}) {
    const filtre = { $or: [{ etat: { $in: ['en-suspens', 'en-reprise'] }, ouverteLe: { $lte: new Date(maintenant.getTime() - SEUIL_MS) } }, { etat: 'echec' }],
        ...(porteur ? { 'porteur.type': porteur.type, 'porteur.id': porteur.id } : {}) };
    const l = await col().find(filtre).sort({ ouverteLe: 1 }).toArray();
    return l.map(m => ({ scanId: m._id, porteur: `${m.porteur.type}:${m.porteur.id}`, etat: m.etat, ouverteLe: m.ouverteLe, issue: m.issue ?? null }));
}

// ── la passe de démarrage (différée) ET périodique : même schéma que la purge du banc (v2/banc/monter.js). Rien sans Mongo prêt ; un seul différé et un seul intervalle par processus ; unref.
async function rattrapageUneFois({ etatMongo = () => require('mongoose').connection.readyState, argent = () => registre.obtenir('argent') } = {}) {
    try {
        if (etatMongo() !== 1) return false;
        await rattraper({ argent: argent() });
        return true;
    } catch (e) { journal('rattrapage', e); return false; }
}
let differe = null, intervalle = null, minuteursEnCours = null;
function arreterRattrapage() {
    const m = minuteursEnCours || global;
    if (intervalle) { m.clearInterval(intervalle); intervalle = null; }
    if (differe) { m.clearTimeout(differe); differe = null; }
    minuteursEnCours = null;
}
function demarrerRattrapage({ differeMs = DIFFERE_MS, intervalleMs = INTERVALLE_MS, minuteurs = global, etatMongo, argent } = {}) {
    arreterRattrapage();
    minuteursEnCours = minuteurs;
    const passe = () => rattrapageUneFois({ ...(etatMongo ? { etatMongo } : {}), ...(argent ? { argent } : {}) });
    differe = minuteurs.setTimeout(passe, differeMs); differe.unref();
    intervalle = minuteurs.setInterval(passe, intervalleMs); intervalle.unref();
    return intervalle;
}

module.exports = { ouvrir, retirer, clore, rattraper, enSuspens, rattrapageUneFois, demarrerRattrapage, arreterRattrapage, SEUIL_MS, INTERVALLE_MS, DIFFERE_MS, REPRISE_MS, TTL_JOURS };
