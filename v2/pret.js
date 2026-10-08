'use strict';
const { repondreErreur } = require('./erreurs');
let verif = null, etat = { ok: false, lueLe: 0, manquants: ['non vérifié'] };
const TTL_MS = 30 * 1000;
function armer(f) { verif = f; etat = { ok: false, lueLe: 0, manquants: ['non vérifié'] }; }
async function pret(req, res, next) {
    try {
        if (Date.now() - etat.lueLe > TTL_MS) {
            const { manquants } = await verif();
            etat = { ok: manquants.length === 0, lueLe: Date.now(), manquants };
            if (!etat.ok) console.error(`🔴 [v2] index manquants : ${manquants.join(', ')} — routes v2 fermées (node v2/migrations/creer-index.js)`);
        }
    } catch (e) { etat = { ok: false, lueLe: Date.now(), manquants: [e.message] }; }
    if (!etat.ok) return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
    next();
}
module.exports = { pret, armer };
