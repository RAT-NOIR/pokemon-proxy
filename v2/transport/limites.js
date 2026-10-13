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
/**
 * « Au plus UN par `delaiMs` » avec une fenêtre GLISSANTE (O3). consommer() compte par fenêtre alignée : avec max 1 il laisserait partir deux courriels à quelques secondes
 * d'écart de part et d'autre d'une frontière de fenêtre. Ici un document par clé porte `expireLe` = dernier passage + delaiMs ; il vit dans `limites` (persistant, TTL), donc survit
 * à un redémarrage. La prise est atomique : insertion (index unique sur `cle`) ou mise à jour conditionnée à `expireLe <= maintenant` ; une seule de deux demandes simultanées gagne.
 * @returns {{permis: boolean, reessayerDans: number}}
 */
async function reserver(cle, { delaiMs, maintenant = new Date() }) {
    const k = `${cle}|reservation`, expireLe = new Date(maintenant.getTime() + delaiMs);
    for (let essai = 0; essai < 2; essai++) {   // 2 tours : le TTL de Mongo a pu retirer le document entre l'échec de l'insertion et la mise à jour
        try { await col('limites').insertOne({ cle: k, n: 1, expireLe }); return { permis: true, reessayerDans: 0 }; }
        catch (e) { if (e.code !== 11000) throw e; }
        const r = await col('limites').updateOne({ cle: k, expireLe: { $lte: maintenant } }, { $set: { expireLe }, $inc: { n: 1 } });
        if (r.modifiedCount === 1) return { permis: true, reessayerDans: 0 };
        const vu = await col('limites').findOne({ cle: k });
        if (vu) return { permis: false, reessayerDans: Math.max(1, Math.ceil((vu.expireLe.getTime() - maintenant.getTime()) / 1000)) };
    }
    return { permis: false, reessayerDans: 1 };   // ne peut pas conclure : refuse (une garde qui ne sait pas bloque)
}
// B2b point 6 — l'HORLOGE du limiteur est facultative. Par défaut (production, rien n'est posé) : `new Date()`, comportement inchangé. Un banc la fixe au milieu d'une fenêtre pour qu'une
// frontière d'heure ne tombe pas au milieu d'une série (la fenêtre est alignée sur l'époque). Deux voies : l'option `horloge` d'un limiteur, ou l'horloge COMMUNE `fixerHorloge`, lue à chaque
// requête par tous les limiteurs sans option (ceux que les routes construisent). `fixerHorloge` est réservée aux bancs isolés (BANC_ISOLE=1, posé par le harnais) : elle lève ailleurs.
let horlogeCommune = null;
function fixerHorloge(fn) {
    if (typeof fn !== 'function') throw new Error('fixerHorloge : une fonction est exigée');
    if (process.env.BANC_ISOLE !== '1') throw new Error('fixerHorloge : réservée aux bancs isolés (BANC_ISOLE=1)');
    const avant = horlogeCommune; horlogeCommune = fn;
    return () => { horlogeCommune = avant; };
}
function limiteur({ nom, max, fenetreMs, cle, horloge }) {
    return async function limiteurV2(req, res, next) {
        try {
            const k = cle(req);
            if (!k) return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');   // on ne laisse pas passer ce qu'on ne sait pas identifier
            const lire = typeof horloge === 'function' ? horloge : horlogeCommune;
            const maintenant = lire ? lire() : new Date();
            if (!(maintenant instanceof Date) || Number.isNaN(maintenant.getTime())) throw new Error('horloge invalide');   // ne sait pas dater : refus fermé
            const r = await consommer(`${nom}:${k}`, { max, fenetreMs, maintenant });
            if (!r.permis) return repondreErreur(res, 'DEBIT', 'Trop de requêtes, réessayez plus tard.', { reessayerDans: r.reessayerDans });
            next();
        } catch (e) {
            console.error(`❌ [v2 limite ${nom}] ${(e && (e.code || e.name)) || 'erreur'}`);
            repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');
        }
    };
}
module.exports = { consommer, reserver, limiteur, empreinteIp, fixerHorloge };
