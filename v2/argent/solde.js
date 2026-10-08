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

// ── historique : une ligne « analyse » par scan, une ligne « credits » par octroi / achat / migration ; la suite est opaque ─────────────────────
const NATURES = ['octroi', 'achat', 'migration'];
const cleDe = l => `${l.type}:${l.scanId ?? l.reference}`;
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
    let lignes = [
        ...analyses.map(a => ({ type: 'analyse', scanId: String(a._id), le: a.creeLe, surface: a.surface ?? null, statut: a.statut ?? null, cartes: a.cartes ?? [], facturation: a.facturation ?? null })),
        ...mouv.map(m => ({ type: 'credits', reference: m.cleIdempotence ?? String(m._id), le: m.le, nature: m.type, delta: m.delta, poche: m.poche ?? null, motif: m.motif ?? null }))
    ];
    // tri total décroissant (date, puis clé) : la suite désigne une position exacte, une égalité de date ne duplique ni ne perd une ligne
    const apres = (l, c) => { const ms = new Date(l.le).getTime(); return ms < c.ms || (ms === c.ms && cleDe(l) < c.k); };
    if (cur) lignes = lignes.filter(l => apres(l, cur));
    lignes.sort((a, b) => (new Date(b.le) - new Date(a.le)) || (cleDe(a) < cleDe(b) ? 1 : -1));
    const page = lignes.slice(0, taille);
    return { lignes: page, suite: lignes.length > taille ? ecrireSuite(page[page.length - 1]) : null };
}
module.exports = { solde, historique, masquer };
