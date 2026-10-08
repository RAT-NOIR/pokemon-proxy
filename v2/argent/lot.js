'use strict';
// Le coût d'un lot et son supplément. Lot : max(1, ceil(cartesVues / 10)), questions comprises ; cartesVues compte les introuvables.
const db = require('../db'); const { ObjectId } = require('mongoose').Types;
const { debiter, rendrePoche } = require('./ledger');
const col = nom => db.col(nom);
const coutDuLot = (cartesVues, cfg) => Math.max(1, Math.ceil(cartesVues / cfg.lot.tranche));

// Débite `unites` crédits UNITAIREMENT (une ligne de mouvements chacun, clé <cleIdempotence>#<i>), TOUT OU RIEN :
// si la k-ième manque, les k-1 prises sont rendues (sans plafond : ce n'est pas un remboursement de panne) et le résultat est le code du refus.
// ⚠️ Sans file, N suppléments concurrents d'un même porteur prennent chacun leur 1re unité, manquent la 2e et se rendent tout : 0 succès sur 25 crédits (livelock mesuré).
// La file ci-dessous sérialise les suppléments d'un même porteur DANS CE PROCESSUS ; entre processus, la CONSERVATION tient quand même (chaque unité est atomique).
const files = new Map();
function enFile(cle, tache) {
    const precedent = files.get(cle) || Promise.resolve();
    const suite = precedent.catch(() => { }).then(tache);
    const queue = suite.catch(() => { });
    files.set(cle, queue);
    queue.then(() => { if (files.get(cle) === queue) files.delete(cle); });
    return suite;
}
async function debiterSupplement(porteur, o = {}, cfg) {
    if (!Number.isInteger(o.unites) || o.unites < 0) throw new Error(`debiterSupplement : unites invalide (${o.unites})`);
    if (!o.cleIdempotence) throw new Error('debiterSupplement : cleIdempotence obligatoire (un supplément sans clé ne se rejoue pas)');
    return enFile(`${porteur.type}:${porteur.id}`, () => debiterSupplementSerie(porteur, o, cfg));
}
async function debiterSupplementSerie(porteur, { scanId, unites, cleIdempotence, maintenant = new Date() }, cfg) {
    const pris = [];
    for (let i = 0; i < unites; i++) {
        const cle = `${cleIdempotence}#${i}`;
        const r = await debiter(porteur, { scanId, cleIdempotence: cle, maintenant }, cfg);
        if (!r.ok) {
            for (const u of pris.filter(x => !x.rejoue).reverse()) await annulerUnite(porteur, u, cfg, maintenant);
            return { ok: false, code: r.code };
        }
        pris.push({ cle, credit: r.credit, rejoue: Boolean(r.rejoue) });
    }
    return { ok: true, credits: pris.map(u => u.credit) };
}
// L'annulation d'une unité prise : le crédit est rendu, la ligne de débit est marquée « annule » et libère sa clé (un échec n'est pas un succès :
// la même clé peut être rejouée), et un mouvement +1 garde la trace — somme(delta) reste égale au solde.
async function annulerUnite(porteur, u, cfg, maintenant) {
    if (!u.credit) return;                                                     // administrateur : delta 0, rien à rendre
    const { rendu } = await rendrePoche(porteur, u.credit, cfg, maintenant);
    const base = porteur.type === 'compte' ? { compteId: porteur.id } : { installationId: porteur.id };
    if (!rendu) { console.error(`🔴 [v2 supplement] unité ${u.cle} NON rendue (poche ${u.credit.poche}) : la réconciliation le dira`); return; }
    await col('mouvements').updateOne({ cleIdempotence: u.cle }, { $set: { etat: 'rembourse' }, $unset: { cleIdempotence: '' } });
    await col('mouvements').insertOne({ ...base, le: maintenant, surface: porteur.surface, type: 'remboursement', delta: 1, poche: u.credit.poche, motif: 'supplement-annule', scanId: null,
        etat: 'rembourse', cleIdempotence: `annule|${u.cle}|${new ObjectId()}`, expireLe: new Date(maintenant.getTime() + cfg.retention.mouvementsMois * 30.5 * 86400e3) });
}
module.exports = { coutDuLot, debiterSupplement };
