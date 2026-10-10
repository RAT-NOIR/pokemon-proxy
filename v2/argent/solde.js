'use strict';
// Le Solde (CONTRAT-2 §3.5) et l'historique. Tout est relu EN BASE (jamais l'instantané du porteur) ; chaque poche annoncée est une poche UTILISABLE :
// un compte non vérifié n'a ni accueil ni hebdo, même si la base porte un nombre (la garde s'écrit par ce qu'elle autorise).
const db = require('../db'); const { semaineISO } = require('../../acces'); const P = require('./poches');
const col = nom => db.col(nom);

const masquer = email => { const i = typeof email === 'string' ? email.indexOf('@') : -1; return i < 1 ? null : `${email[0]}•••${email.slice(i)}`; };
const premierDuMoisSuivant = d => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);

async function solde(porteur, cfg, maintenant = new Date()) {
    const vide = { essai: 0, accueil: 0, hebdo: 0, achete: 0 };
    let p = { ...vide }, hebdoMax = 0, prochainHebdo = null, lie = null, abonnement = null;
    if (porteur.type === 'installation') {
        const i = await col('installations').findOne({ _id: porteur.id });
        if (i) { p.essai = Math.max(0, i.essais ?? 0); p.achete = Math.max(0, i.achete ?? 0); }
    } else if (porteur.type === 'compte') {
        const c = await col('comptes').findOne({ _id: porteur.id });
        if (c) {
            lie = { lie: true, emailMasque: masquer(c.email), verifie: Boolean(c.verifie) };
            p.achete = Math.max(0, c.solde?.achete ?? 0);
            if (c.verifie) {
                p.accueil = Math.max(0, c.solde?.accueil ?? 0);
                if (cfg.quotas.hebdo > 0) {
                    hebdoMax = cfg.quotas.hebdo; prochainHebdo = P.prochainLundi(maintenant);
                    const h = await col('hebdo').findOne({ compteId: c._id, semaine: semaineISO(maintenant) });
                    p.hebdo = Math.max(0, hebdoMax - (h ? h.count : 0));
                }
            }
            const a = c.abonnement;
            if (a && a.actif && a.jusquAu && a.jusquAu > maintenant) {
                const restant = a.moisCle === P.moisCle(maintenant) ? a.restant : a.quotaMensuel;   // le mois a changé : le prochain débit recharge, on annonce ce rechargement
                abonnement = { restant: Math.max(0, restant), quotaMensuel: a.quotaMensuel, renouvelleLe: premierDuMoisSuivant(maintenant) };
            }
        }
    }
    const total = p.essai + p.accueil + p.hebdo + p.achete + (abonnement ? abonnement.restant : 0);
    return { total, ...p, hebdoMax, prochainHebdo, compte: lie || { lie: false, emailMasque: null, verifie: false }, partage: true, abonnement };
}

// Contrôle SANS DÉBIT : ce porteur a-t-il au moins un crédit UTILISABLE (les mêmes poches que le débit, lues comme `solde` les annonce) ? Un administrateur (relu en base,
// comme le débit) passe. Rien n'est écrit : le débit reste seul juge — ce contrôle ne fait qu'éviter de lire 12 Mo pour un refus d'argent certain.
async function peutPayer(porteur, cfg, maintenant = new Date()) {
    if (porteur.administrateur === true && porteur.type === 'compte' && (await col('comptes').countDocuments({ _id: porteur.id, role: 'administrateur' })) > 0) return { ok: true };
    const s = await solde(porteur, cfg, maintenant);
    return s.total > 0 ? { ok: true } : { ok: false, code: P.codeRefus(porteur) };
}

// ── historique : une ligne « analyse » par scan, une ligne « credits » par octroi / achat / migration ; la suite est opaque ─────────────────────
const NATURES = ['octroi', 'achat', 'migration'];
// La forme servie est celle du CONTRAT (LigneAnalyse / LigneCredits, CONTRAT-API-V2.md §1.6 ; ruling A du 2026-10-10). La clé de pagination vit à côté de la ligne servie (jamais dedans).
// Une ligne que le contrat ne sait pas dire est OMISE, jamais inventée, et COMPTÉE (`omises`) :
//   · analyse sans surface connue, sans statut du contrat, ou sans facturation complète (ligne ancienne) ;
//   · crédit dont la poche n'a pas de motif au contrat (abonnement, essai…) : le contrat ne connaît que accueil · hebdo · achat.
const MOTIF_DE_POCHE = Object.freeze({ accueil: 'accueil', hebdo: 'hebdo', achete: 'achat' });
const STATUTS = ['identifiee', 'a-trancher', 'introuvable', 'lot'];
function facturationServie(f) {
    const { MOTIFS } = require('./facturation');
    if (!f || typeof f !== 'object') return null;
    const entier = x => Number.isInteger(x) && x >= 0;
    if (!entier(f.debite) || !entier(f.reserve) || !MOTIFS.includes(f.motif)) return null;
    if (f.raisonNonRembourse !== null && f.raisonNonRembourse !== undefined && typeof f.raisonNonRembourse !== 'string') return null;
    // `rembourse` est un booléen au contrat ; une ligne ancienne le portait en 0 / 1 : même valeur, autre écriture (aucune valeur n'est créée)
    return { debite: f.debite, reserve: f.reserve, rembourse: Boolean(f.rembourse), motif: f.motif, raisonNonRembourse: f.raisonNonRembourse ?? null };
}
function ligneAnalyse(a) {
    const facturation = facturationServie(a.facturation);
    if (!facturation || !['extension', 'scanner'].includes(a.surface) || !STATUTS.includes(a.statut) || !(a.creeLe instanceof Date)) return null;
    const cartes = Array.isArray(a.cartes) ? a.cartes : [];
    let carte = null;
    if (a.statut === 'identifiee' && cartes[0]) {
        const p = (a.produits || []).find(x => x && x.idProduct === cartes[0].idProduct);
        if (p && typeof p.nom === 'string' && p.set && typeof p.set.nom === 'string') carte = { nom: p.nom, set: p.set.nom, numero: typeof p.numero === 'string' ? p.numero : null };
    }
    return { genre: 'analyse', le: a.creeLe.toISOString(), surface: a.surface, statut: a.statut, carte, cartesVues: cartes.length, facturation };
}
function ligneCredits(m) {
    const motif = MOTIF_DE_POCHE[m.poche];                      // une migration prend le motif de sa poche d'origine
    if (!motif || !Number.isInteger(m.delta) || !(m.le instanceof Date)) return null;
    return { genre: 'credits', le: m.le.toISOString(), motif, credits: m.delta };
}
const cleDe = x => x.k;
function lireSuite(suite) {
    if (suite == null) return null;
    try { const o = JSON.parse(Buffer.from(String(suite), 'base64url').toString('utf8')); if (Number.isFinite(o.ms) && typeof o.k === 'string') return o; } catch (_) { /* refusé plus bas */ }
    throw new Error('historique : suite invalide');
}
const ecrireSuite = l => Buffer.from(JSON.stringify({ ms: new Date(l.le).getTime(), k: cleDe(l) }), 'utf8').toString('base64url');
async function historique(porteur, { suite = null, limite = 20 } = {}, cfg) {
    const cur = lireSuite(suite), porteurCle = `${porteur.type}:${porteur.id}`, taille = Math.min(Math.max(1, limite), 50);
    const borne = cur ? new Date(cur.ms) : null, marge = taille + 25;
    const analyses = await col('analyses').find({ porteur: porteurCle, ...(borne ? { creeLe: { $lte: borne } } : {}) }).sort({ creeLe: -1 }).limit(marge).toArray();
    const mouv = await col('mouvements').find({ ...(porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id }), type: { $in: NATURES }, ...(borne ? { le: { $lte: borne } } : {}) }).sort({ le: -1 }).limit(marge).toArray();
    // chaque élément : { ligne (la forme du contrat, ou null = omise), le (date), k (clé de pagination) }
    let tous = [
        ...analyses.map(a => ({ le: a.creeLe, k: `analyse:${String(a._id)}`, ligne: ligneAnalyse(a) })),
        ...mouv.map(m => ({ le: m.le, k: `credits:${m.cleIdempotence ?? String(m._id)}`, ligne: ligneCredits(m) }))
    ];
    // tri total décroissant (date, puis clé) : la suite désigne une position exacte, une égalité de date ne duplique ni ne perd une ligne
    const apres = (x, c) => { const ms = new Date(x.le).getTime(); return ms < c.ms || (ms === c.ms && cleDe(x) < c.k); };
    if (cur) tous = tous.filter(x => apres(x, cur));
    tous.sort((a, b) => (new Date(b.le) - new Date(a.le)) || (cleDe(a) < cleDe(b) ? 1 : -1));
    // la page se remplit de lignes SERVIES ; les omises rencontrées en chemin sont comptées (une absence se compte)
    const page = []; let omises = 0, i = 0;
    for (; i < tous.length && page.length < taille; i++) { if (tous[i].ligne) page.push(tous[i]); else omises++; }
    const resteServi = tous.slice(i).some(x => x.ligne);
    const fenetrePleine = analyses.length === marge || mouv.length === marge;       // une source a pu être coupée : il peut rester des lignes au-delà de ce qu'on a lu
    const suiteNeuve = page.length && (resteServi || fenetrePleine) ? ecrireSuite(page[page.length - 1]) : null;
    if (!suiteNeuve) omises += tous.length - i;                                     // plus rien après : les omises de la queue appartiennent à cette dernière page
    return { lignes: page.map(x => x.ligne), suite: suiteNeuve, omises };
}
module.exports = { solde, peutPayer, historique, masquer };
