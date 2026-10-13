'use strict';
// L'OFFRE d'un porteur et son quota QUOTIDIEN (lot OFFRE-QUOTA, décision du testeur 2026-10-13). UNE SEULE fonction calcule `{ nom, restant, remiseAZero }` : toutes les routes
// qui servent un `offre` l'appellent ici (registre « argent » → offre), jamais une copie par route (§21 bis).
//
// Ce qui compte : une analyse RENDUE (un débit, rendu au compteur quand l'analyse n'a rien livré — introuvable, panne, prix illisible définitif).
// Le jour est le JOUR CIVIL DE PARIS (Europe/Paris, par Intl : jamais un décalage fixe, donc 23 h et 25 h aux changements d'heure) ; la remise à zéro est le prochain minuit de Paris.
//
// L'offre est écrite par ce qu'elle AUTORISE et se RELIT EN BASE (jamais l'instantané du porteur, qui peut être périmé ou forgé) :
//   · installation non liée (compteId nul, relu)                              → « sans-compte » (cfg.quotas.sansCompte)
//   · compte VÉRIFIÉ (relu), sans abonnement actif et en cours                → « gratuit »     (cfg.quotas.gratuit)
//   · compte VÉRIFIÉ avec abonnement `actif: true` ET `jusquAu` > maintenant  → « pro »        (plafond technique cfg.quotas.proPlafond, jamais montré : `restant: null`)
//   · administrateur (rôle relu en base)                                      → « pro », illimité (le débit reste 0, motif « administrateur »)
//   · tout autre cas (compte non vérifié, compte ou installation introuvable, installation liée, type inconnu) → AUCUNE offre utilisable : le refus d'aujourd'hui, jamais une offre plus large.
const db = require('../db');
const col = nom => db.col(nom);
const FUSEAU = 'Europe/Paris';

const formatParis = new Intl.DateTimeFormat('en-CA', { timeZone: FUSEAU, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
const parties = d => {
    const o = {};
    for (const p of formatParis.formatToParts(d)) if (p.type !== 'literal') o[p.type] = Number(p.value);
    return o;
};
const deux = n => String(n).padStart(2, '0');
function valide(d) { if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new Error('offre : date invalide'); return d; }
/** Le jour civil de Paris de l'instant `d`, « AAAA-MM-JJ ». */
function jourDeParis(d) { const p = parties(valide(d)); return `${p.year}-${deux(p.month)}-${deux(p.day)}`; }
/** Le décalage de Paris à l'instant `d`, en minutes (60 ou 120). */
function decalageParis(d) {
    const p = parties(valide(d));
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(d.getTime() / 1000) * 1000) / 60000);
}
const iso = (y, m, j, dec) => `${y}-${deux(m)}-${deux(j)}T00:00:00${dec < 0 ? '-' : '+'}${deux(Math.floor(Math.abs(dec) / 60))}:${deux(Math.abs(dec) % 60)}`;
/** Le prochain minuit de Paris STRICTEMENT après `d` : { instant: Date, iso: « AAAA-MM-JJT00:00:00+01:00|+02:00 » }. Le minuit de Paris n'est jamais ambigu (les bascules ont lieu à 2 h / 3 h). */
function prochainMinuitParis(d) {
    const p = parties(valide(d)), suivant = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    const y = suivant.getUTCFullYear(), m = suivant.getUTCMonth() + 1, j = suivant.getUTCDate();
    for (const dec of [60, 120]) {
        const t = new Date(Date.UTC(y, m - 1, j) - dec * 60000), q = parties(t);
        if (q.year === y && q.month === m && q.day === j && q.hour === 0 && q.minute === 0 && q.second === 0) return { instant: t, iso: iso(y, m, j, dec) };
    }
    throw new Error('offre : minuit de Paris introuvable');   // ne peut pas arriver (jamais deux minuits, jamais aucun) ; échoue fermé plutôt que d'inventer une heure
}

// L'état d'un porteur, relu EN BASE. { nom, limite, nonVerifie?, administrateur? } — `limite` : ce que le compteur du jour autorise (0 = aucun débit). null = aucune offre.
async function etatDe(porteur, cfg, maintenant = new Date()) {
    if (!porteur || typeof porteur !== 'object') return null;
    if (porteur.type === 'compte') {
        const c = await col('comptes').findOne({ _id: porteur.id }, { projection: { role: 1, verifie: 1, abonnement: 1 } });
        if (!c) return null;
        if (porteur.administrateur === true && c.role === 'administrateur') return { nom: 'pro', limite: null, administrateur: true };
        if (c.verifie !== true) return { nom: 'gratuit', limite: 0, nonVerifie: true };
        const a = c.abonnement;
        if (a && a.actif === true && a.jusquAu instanceof Date && a.jusquAu.getTime() > valide(maintenant).getTime()) return { nom: 'pro', limite: cfg.quotas.proPlafond };
        return { nom: 'gratuit', limite: cfg.quotas.gratuit };
    }
    if (porteur.type === 'installation') {
        const i = await col('installations').findOne({ _id: porteur.id }, { projection: { compteId: 1 } });
        if (!i || i.compteId != null) return null;      // introuvable, ou liée : son porteur est le compte (une installation liée n'a plus de quota propre)
        return { nom: 'sans-compte', limite: cfg.quotas.sansCompte };
    }
    return null;
}
const cleDe = porteur => `${porteur.type}:${porteur.id}`;
/** Combien d'analyses ce porteur a déjà PRISES le jour de Paris `jour` (0 si aucun compteur). */
async function prisAuJour(porteur, jour) {
    const doc = await col('quota_jour').findOne({ porteur: cleDe(porteur), jour }, { projection: { count: 1 } });
    return doc && Number.isInteger(doc.count) ? Math.max(0, doc.count) : 0;
}
/** `{ nom, restant, remiseAZero }` — l'objet `offre` des réponses. `restant` : limite − compteur du jour (jamais négatif), null pour Pro (le plafond technique ne se montre jamais). */
async function offre(porteur, cfg, maintenant = new Date()) {
    const remiseAZero = prochainMinuitParis(maintenant).iso;
    const e = await etatDe(porteur, cfg, maintenant);
    // aucune offre utilisable (compte non vérifié, porteur introuvable ou inconnu) : jamais une offre plus large — « sans-compte » ne s'affiche que pour une VRAIE installation non liée
    if (!e) return { nom: 'sans-compte', restant: 0, remiseAZero };
    if (e.nom === 'pro') return { nom: 'pro', restant: null, remiseAZero };
    if (e.nonVerifie) return { nom: e.nom, restant: 0, remiseAZero };
    return { nom: e.nom, restant: Math.max(0, e.limite - await prisAuJour(porteur, jourDeParis(maintenant))), remiseAZero };
}
module.exports = { offre, etatDe, prisAuJour, jourDeParis, decalageParis, prochainMinuitParis, cleDe, FUSEAU };
