'use strict';
// SAUVEGARDES — le bail en base. Un redéploiement fait coexister deux instances : c'est le cas NORMAL. Celle qui n'a pas le bail ATTEND et ne meurt pas.
//   · un seul document (`_id: 'export'`) ; `prendre` n'aboutit que s'il est libre ou EXPIRÉ (l'upsert concurrent perd sur la clé : E11000 = « tenu par une autre ») ;
//   · le détenteur BAT (repousse l'expiration de `ttlMs` = trois battements) ; son battement est refusé dès qu'un autre l'a pris : il doit s'arrêter ;
//   · il ne se libère QUE par son détenteur (jeton aléatoire par instance de bail) : ni libération, ni battement d'un autre.
const crypto = require('crypto');

const ID = 'export';
function creerBail({ col, ttlMs = 90000, maintenant = () => new Date() }) {
    const jeton = crypto.randomBytes(12).toString('hex');
    const doc = r => (r && r.value !== undefined && r.ok !== undefined ? r.value : r);
    return {
        async prendre() {
            const now = maintenant();
            try {
                const r = doc(await col.findOneAndUpdate({ _id: ID, $or: [{ detenteur: null }, { expireLe: { $lte: now } }] },
                    { $set: { detenteur: jeton, expireLe: new Date(+now + ttlMs), battementLe: now } }, { upsert: true, returnDocument: 'after' }));
                return Boolean(r && r.detenteur === jeton);
            } catch (e) { if (e && e.code === 11000) return false; throw e; }
        },
        async battre() {
            const now = maintenant();
            const r = await col.updateOne({ _id: ID, detenteur: jeton }, { $set: { expireLe: new Date(+now + ttlMs), battementLe: now } });
            return r.matchedCount === 1;
        },
        async liberer() {
            const r = await col.updateOne({ _id: ID, detenteur: jeton }, { $set: { detenteur: null, expireLe: new Date(0) } });
            return r.matchedCount === 1;
        }
    };
}
module.exports = { creerBail, ID };
