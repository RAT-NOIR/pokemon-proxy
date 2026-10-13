'use strict';
// O5 — LA MARQUE DE LIVRAISON D'UN SCAN. Invariant : aucun crédit n'est pris sans marque. La marque s'ouvre AVANT le premier débit d'un scan (une carte ou un lot, extension ou scanner),
// se retire quand le débit n'a rien pris (refus, rejeu, administrateur), et se CLÔT (`livre`) quand le gestionnaire de la requête a PRODUIT le résultat — que le client soit encore là ou non.
// Le résultat produit (analyse écrite, ou erreur déjà remboursée par la route) vaut livraison : le crédit couvre le travail fait. Une coupure du client ne déclenche JAMAIS de remboursement.
// Tant qu'il traite, le gestionnaire BAT : il rafraîchit la marque (`batLe`) toutes les 30 s (`suivre`). La marque d'un processus MORT ne bat plus.
// La passe de RATTRAPAGE ne prend donc qu'une marque `en-suspens` dont le battement est PÉRIMÉ (trois battements manqués = 90 s, sur le modèle du verrou de CLAUDE.md §17), et qui a au moins
// 5 min d'âge. Une requête longue mais vivante n'est jamais rendue : il n'y a plus de seuil de durée à deviner (la requête n'a pas de délai total, voir le rapport O5).
// ⚙️ Les deux horloges : le battement et les comparaisons de la passe se font à l'heure du SERVEUR MONGO (`$$NOW`), jamais à celle d'une instance : un décalage d'horloge entre deux instances Render
// ne fait pas paraître périmée la marque d'une instance vivante. Seule la 1re valeur de `batLe` (à l'ouverture) vient de l'horloge de l'instance : le PLANCHER D'ÂGE (5 min sur `ouverteLe`) écarte ce
// risque pendant le premier intervalle (avant le 1er battement), et un décalage de plus de 5 min entre une instance et la base n'est pas couvert (NTP).
// La passe PREND la marque (une écriture conditionnelle : un seul gagnant, même entre deux processus) puis
//   · CONFIRME seulement si la RÉPONSE COMPLÈTE est rejouable : stockée par `idempotente` (`etat: 'fini'`, statut < 300, corps portant CE scanId, non expirée — rejouable avec la même
//     Idempotency-Key). Une ligne `analyses` écrite n'est PAS un résultat livré (l'historique ne donne ni le prix ni les candidats) : une marque d'un processus mort sans réponse stockée est rendue.
//     (Le gestionnaire VIVANT, lui, ferme `livre` quand il a produit le résultat : une coupure du client ne rend rien.)
//   · sinon REND par la primitive existante `argent.rembourser` (claim `rb|scanId`, prise atomique de chaque unité) — sans plafond (faute du SERVEUR), motif `arret-serveur` —, PUIS VÉRIFIE
//     unité par unité, dans le ledger, que chaque unité est effectivement rendue : un claim orphelin (passe ou scan tués entre le claim et le rendu) n'est jamais lu comme une preuve ; les unités
//     restantes sont reprises une à une par `rembourserLigne` (prise atomique par unité : idempotent).
// Aucune panne injectable ici : pas de process.exit, pas de lecture d'environnement. Les bancs de coupure arrêtent leur propre processus par leurs propres moyens (test-coupure-processus.js).
const db = require('../db');
const registre = require('../registre');

const MIN = 60e3;
const BATTEMENT_MS = 30 * 1000;     // le gestionnaire rafraîchit la marque toutes les 30 s
const PERIME_MS = 3 * BATTEMENT_MS; // trois battements manqués : le processus est mort
const PLANCHER_MS = 5 * MIN;        // âge minimal d'une marque pour être prise (horloge décalée entre instances, premier intervalle)
const SUIVI_MAX_MS = 30 * MIN;      // filet : un gestionnaire qui oublie d'arrêter son battement ne rend pas sa marque immortelle
const INTERVALLE_MS = 5 * MIN;      // ≤ PLANCHER_MS : une marque trop jeune au démarrage est traitée au tour suivant, jamais oubliée
const DIFFERE_MS = 30 * 1000;       // la passe de démarrage attend que Mongo soit prêt (comme la purge du banc, B6.4)
const REPRISE_MS = 10 * MIN;        // une marque `en-reprise` dont la passe est morte se reprend après ce délai
const TTL_JOURS = 7;                // une marque close expire (30 jours au plus) ; une marque non close n'expire JAMAIS (pas d'expireLe)
const REPRISES_MAX = 5;             // après quoi une erreur persistante devient un `echec` listé, plus une boucle
const PAR_PASSE_MAX = 200;
const col = () => db.col('scans_en_cours');
const journal = (ou, e) => console.error(`❌ [v2 marque-scan] ${ou} : ${(e && (e.code || e.name)) || 'erreur'}`);   // jamais e.message : il peut citer une clé ou un hôte
const journalScan = (scanId, texte) => console.error(`🔴 [v2 marque-scan] scan ${scanId} : ${texte}`);

// Les conditions « périmée », évaluées à l'heure du serveur Mongo. Une seule définition pour la passe ET la réconciliation.
const PERIMEE = Object.freeze({ $expr: { $and: [
    { $lte: [{ $ifNull: ['$batLe', '$ouverteLe'] }, { $subtract: ['$$NOW', PERIME_MS] }] },
    { $lte: ['$ouverteLe', { $subtract: ['$$NOW', PLANCHER_MS] }] }] } });
const filtrePrenable = vus => ({ _id: { $nin: vus }, $or: [{ etat: 'en-suspens', ...PERIMEE }, { etat: 'en-reprise', $expr: { $lte: ['$priseLe', { $subtract: ['$$NOW', REPRISE_MS] }] } }] });

// ── la marque : petite (7 champs à l'ouverture), sans adresse, sans IP, sans contenu d'annonce
async function ouvrir({ scanId, porteur, cleDebit, cleClaim = null, maintenant = new Date() }) {
    await col().insertOne({ _id: scanId, porteur: { type: porteur.type, id: porteur.id }, cleDebit, cleClaim, etat: 'en-suspens', ouverteLe: maintenant, batLe: maintenant });
}
// Le débit n'a rien pris : la marque n'a plus de raison d'être. Conditionnel : jamais une marque déjà prise par la passe.
async function retirer(scanId) { return (await col().deleteOne({ _id: scanId, etat: 'en-suspens' })).deletedCount === 1; }
// Le résultat est produit : `livre`. Rend true si CETTE écriture a clos la marque (false : la passe l'avait prise, ou rien à clore). Un second essai couvre une erreur transitoire.
async function clore(scanId, { maintenant = new Date() } = {}) {
    const ecrire = () => col().updateOne({ _id: scanId, etat: 'en-suspens' }, { $set: { etat: 'livre', closLe: maintenant, expireLe: new Date(maintenant.getTime() + TTL_JOURS * 86400e3) } });
    let r;
    try { r = await ecrire(); } catch (e) { journal('clôture (2e essai)', e); r = await ecrire(); }
    return r.modifiedCount === 1;
}
// Un battement : l'heure du serveur Mongo, jamais celle de l'instance.
const battre = scanId => col().updateOne({ _id: scanId, etat: 'en-suspens' }, [{ $set: { batLe: '$$NOW' } }]);
// Le suivi d'un gestionnaire vivant : bat tant qu'on ne l'a pas arrêté (et au plus SUIVI_MAX_MS). unref : il ne retient jamais le processus.
function suivre(scanId, { intervalleMs = BATTEMENT_MS, minuteurs = global } = {}) {
    const t = minuteurs.setInterval(() => { battre(scanId).catch(e => journal('battement', e)); }, intervalleMs); t.unref();
    const fin = minuteurs.setTimeout(() => minuteurs.clearInterval(t), SUIVI_MAX_MS); fin.unref();
    return { arreter() { minuteurs.clearInterval(t); minuteurs.clearTimeout(fin); } };
}

// ── le fait durable : la réponse COMPLÈTE de CE scan, stockée par idempotente (rejouable)
async function resultatPersiste(m, maintenant) {
    if (!m.cleClaim) return null;
    const d = await db.col('idempotence').findOne({ cle: m.cleClaim });
    if (!d || d.etat !== 'fini' || !(d.statut < 300) || typeof d.reponse !== 'string' || !(d.expireLe > maintenant)) return null;
    let j; try { j = JSON.parse(d.reponse); } catch { return null; }
    return Boolean(j) && typeof j === 'object' && String(j.scanId) === String(m._id) ? 'reponse-stockee' : null;
}

const prendre = (maintenant, vus) => col().findOneAndUpdate(filtrePrenable(vus), { $set: { etat: 'en-reprise', priseLe: maintenant }, $inc: { reprises: 1 } }, { sort: { ouverteLe: 1 }, returnDocument: 'after' });
// L'état final se pose seulement si la marque est ENCORE à nous (en-reprise) ; un echec n'expire jamais.
const finir = (m, etat, issue, maintenant) => col().updateOne({ _id: m._id, etat: 'en-reprise' },
    { $set: { etat, issue, closLe: maintenant, ...(etat === 'echec' ? {} : { expireLe: new Date(maintenant.getTime() + TTL_JOURS * 86400e3) }) } });
const rendreALaPasse = (m, issue) => col().updateOne({ _id: m._id, etat: 'en-reprise' }, { $set: { etat: (m.reprises || 1) >= REPRISES_MAX ? 'echec' : 'en-suspens', issue } });

// Les unités de ce scan dont le crédit n'est PAS rendu : le ledger, ligne par ligne (jamais le claim). `rendu-en-cours` n'est pas reprise seule (le crédit a pu être rendu) : la réconciliation la liste.
const unitesNonRendues = (m) => db.col('mouvements').find({ ...(m.porteur.type === 'compte' ? { compteId: m.porteur.id } : { installationId: m.porteur.id }),
    type: 'debit', scanId: m._id, credit: { $ne: null }, etat: { $nin: ['rembourse', 'rendu-en-cours'] } }).toArray();

// R4 — avant MOYENS-B2a, le ledger (rendreLeScan) posait `rembourse` sur une unité AVANT de lui rendre son crédit : un arrêt entre les deux laissait une unité « rendue » sans crédit. Il pose maintenant
// `rendu-en-cours` à la prise (puis `rembourse` après le crédit ET sa trace) ; les lignes déjà « rembourse » sans trace d'AVANT ce lot existent encore en base. On compare donc, pour ce scan, les unités
// `rembourse` ou `rendu-en-cours` (avec leur clé : une unité ANNULÉE par le supplément n'en a plus et a sa propre trace sans scanId) aux lignes de remboursement +1 de CE scan.
// Aucun recrédit automatique : la réparation d'un cas ancien est `reparerDebitRembourseSansMouvement` (ledger.js), lancée à la main.
async function creditsManquants(m) {
    const unites = await db.col('mouvements').countDocuments({ ...(m.porteur.type === 'compte' ? { compteId: m.porteur.id } : { installationId: m.porteur.id }),
        type: 'debit', scanId: m._id, credit: { $ne: null }, etat: { $in: ['rembourse', 'rendu-en-cours'] }, cleIdempotence: { $type: 'string' } });   // MOYENS-B2a : « rendu-en-cours » = prise avant le crédit
    const credits = await db.col('mouvements').countDocuments({ type: 'remboursement', scanId: m._id, $or: [{ delta: 1 }, { motif: 'semaine-expiree' }] });
    return Math.max(0, unites - credits);
}

async function traiter(m, argent, maintenant, bilan) {
    const porteur = { type: m.porteur.type, id: m.porteur.id, surface: null };
    // « rendu » ne s'écrit que si chaque unité rendue a SA ligne de crédit : sinon `echec` (issue unite-sans-credit), listé par la réconciliation
    const conclureRendu = async (issue) => {
        const manque = await creditsManquants(m);
        if (manque > 0) { await finir(m, 'echec', 'unite-sans-credit', maintenant); bilan.echecs++; journalScan(m._id, `${manque} unité(s) marquée(s) remboursée(s) SANS ligne de crédit +1 — crédit peut-être NON rendu, marque en échec`); return; }
        await finir(m, 'rendu', issue, maintenant);
        if (issue === 'deja-rembourse') bilan.dejaRendues++; else bilan.rendues++;
    };
    try {
        const fait = await resultatPersiste(m, maintenant);
        if (fait) { await finir(m, 'confirme', fait, maintenant); bilan.confirmees++; return; }
        // une question encore en attente sur ce scan est annulée D'ABORD (comme creditV2.rembourser) : un crédit rendu ne doit plus pouvoir être « répondu »
        await db.col('questions_v2').updateMany({ scanId: m._id, 'porteur.type': porteur.type, 'porteur.id': porteur.id, etat: 'en-attente' },
            { $set: { etat: 'non-remboursee', rembourse: false, raisonNonRembourse: 'deja-rembourse', annuleePar: 'arret-serveur', regleeLe: maintenant } });
        const r = await argent.rembourser(porteur, { rattrapage: true }, 'arret-serveur', { scanId: m._id, compteur: 'panne', sansPlafond: true, maintenant });   // `credit` ne sert qu'à passer la garde : les unités se lisent au journal
        const raison = (r && r.raisonNonRembourse) || 'erreur';
        if ((r && r.rendu) || raison === 'deja-rembourse') {
            // « deja-rembourse » (claim `rb|scanId` présent) n'est JAMAIS une preuve : un claim orphelin laisse des unités prises. On relit le ledger unité par unité et on reprend le reste.
            const restantes = await unitesNonRendues(m);
            if (!restantes.length) { await conclureRendu(r && r.rendu ? 'rendu' : 'deja-rembourse'); return; }
            let repris = 0, echec = null;
            for (const d of restantes) {
                const u = await argent.rembourserLigne(porteur, d.cleIdempotence, 'arret-serveur');
                if (u && (u.rendu || u.raisonNonRembourse === 'deja-rembourse')) repris++;      // rendue entre la lecture et la reprise (par le scan lui-même) : rendue
                else echec = echec || (u && u.raisonNonRembourse) || 'erreur';
            }
            bilan.reprises += repris;
            if (echec === 'erreur') { await rendreALaPasse(m, 'erreur'); bilan.erreurs++; journalScan(m._id, `${restantes.length - repris} unité(s) non rendue(s) (erreur), reprises à la prochaine passe`); return; }
            if (echec) { await finir(m, 'echec', echec, maintenant); bilan.echecs++; journalScan(m._id, `${restantes.length - repris} unité(s) NON rendue(s) (${echec}) — marque en échec, à voir par la réconciliation`); return; }
            await conclureRendu('repris'); return;
        }
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

/** Une passe. @returns { examinees, rendues, confirmees, dejaRendues, sansDebit, echecs, erreurs, reprises } */
async function rattraper({ argent = registre.obtenir('argent'), maintenant = new Date() } = {}) {
    const bilan = { examinees: 0, rendues: 0, confirmees: 0, dejaRendues: 0, sansDebit: 0, echecs: 0, erreurs: 0, reprises: 0 };
    const vus = [];
    for (let i = 0; i < PAR_PASSE_MAX; i++) {
        let m;
        try { m = await prendre(maintenant, vus); } catch (e) { journal('prise', e); bilan.erreurs++; break; }
        if (!m) break;
        vus.push(m._id); bilan.examinees++;
        await traiter(m, argent, maintenant, bilan);
    }
    if (bilan.examinees) console.error(`🔴 [v2 marque-scan] passe : ${bilan.examinees} scan(s) en suspens examiné(s) — rendus ${bilan.rendues} (dont ${bilan.reprises} unité(s) reprise(s)), confirmés ${bilan.confirmees}, déjà remboursés ${bilan.dejaRendues}, sans débit ${bilan.sansDebit}, échecs ${bilan.echecs}, erreurs ${bilan.erreurs}`);
    return bilan;
}

// ── la réconciliation les liste : en-suspens PÉRIMÉES (même définition que la passe), en-reprise anciennes, et tout `echec`
async function enSuspens({ porteur = null } = {}) {
    const filtre = { $and: [{ $or: [{ etat: 'en-suspens', ...PERIMEE }, { etat: 'en-reprise', $expr: { $lte: ['$ouverteLe', { $subtract: ['$$NOW', PLANCHER_MS] }] } }, { etat: 'echec' }] },
        ...(porteur ? [{ 'porteur.type': porteur.type, 'porteur.id': porteur.id }] : [])] };
    const l = await col().find(filtre).sort({ ouverteLe: 1 }).toArray();
    // MOYENS-B2a tour 2 (N-5) : une marque en `echec` dont l'unité a un crédit déjà écrit ou une ligne à clore a un GESTE nommé (l'outil de réparation prouve par le débit, puis clôt) — elle n'est plus un « non propre » muet
    const GESTE = 'node v2/argent/reparer-debit.js --base=<nom> --porteur=<type:id> --scan=<id> (simulation, puis --executer --sauvegarde=<dossier>) — audit §15';
    return l.map(m => ({ scanId: m._id, porteur: `${m.porteur.type}:${m.porteur.id}`, etat: m.etat, ouverteLe: m.ouverteLe, issue: m.issue ?? null,
        ...(m.etat === 'echec' && ['poche-deja-compensee', 'unite-sans-credit', 'remboursement-en-cours'].includes(m.issue) ? { geste: GESTE } : {}) }));
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

module.exports = { ouvrir, retirer, clore, battre, suivre, rattraper, enSuspens, rattrapageUneFois, demarrerRattrapage, arreterRattrapage,
    BATTEMENT_MS, PERIME_MS, PLANCHER_MS, SUIVI_MAX_MS, INTERVALLE_MS, DIFFERE_MS, REPRISE_MS, TTL_JOURS };
