'use strict';
const crypto = require('crypto');
const { col } = require('../db');
const { repondreErreur } = require('../erreurs');
const empreinteIp = ip => crypto.createHash('sha256').update(`rm-ip|${ip || '?'}`).digest('hex').slice(0, 24);

async function consommer(cle, { max, fenetreMs, maintenant = new Date() }) {
    const debut = Math.floor(maintenant.getTime() / fenetreMs) * fenetreMs;
    const k = `${cle}|${debut}`;
    const filtre = { cle: k }, maj = { $inc: { n: 1 }, $setOnInsert: { expireLe: new Date(debut + fenetreMs * 2) } };
    let doc;
    try { doc = await col('limites').findOneAndUpdate(filtre, maj, { upsert: true, returnDocument: 'after' }); }
    catch (e) { if (e.code !== 11000) throw e; doc = await col('limites').findOneAndUpdate(filtre, { $inc: { n: 1 } }, { returnDocument: 'after' }); } // deux premiers appels simultanés
    const n = doc.n;
    return { permis: n <= max, n, max, reessayerDans: Math.max(1, Math.ceil((debut + fenetreMs - maintenant.getTime()) / 1000)) };
}
function limiteur({ nom, max, fenetreMs, cle }) {
    return async function limiteurV2(req, res, next) {
        try {
            const k = cle(req);
            if (!k) return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');   // on ne laisse pas passer ce qu'on ne sait pas identifier
            const r = await consommer(`${nom}:${k}`, { max, fenetreMs });
            if (!r.permis) return repondreErreur(res, 'DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: r.reessayerDans });
            next();
        } catch (e) {
            console.error(`❌ [v2 limite ${nom}] ${e.message}`);
            repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
        }
    };
}
module.exports = { consommer, limiteur, empreinteIp };
