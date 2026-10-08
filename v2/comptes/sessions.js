'use strict';
const { col } = require('../db'); const J = require('./jetons'); const { repondreErreur } = require('../erreurs');
const NOM = 'rm_session';
async function creerSession(compteId, now = new Date(), jours = 30) {
    const token = J.genererJeton(), expireLe = new Date(now.getTime() + jours * 86400e3);
    await col('sessions').insertOne({ tokenEmpreinte: J.empreinte(token), compteId, creeLe: now, vueLe: now, expireLe });
    return { token, expireLe };
}
function lireCookie(req, nom = NOM) {
    const h = req.headers && req.headers.cookie; if (!h) return null;
    for (const part of h.split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === nom) return part.slice(i + 1).trim(); }
    return null;
}
const attributs = (cfg, maxAge) => `HttpOnly; ${cfg.cookieSecure ? 'Secure; ' : ''}SameSite=Lax; Path=/; Max-Age=${maxAge}`;
const cookieSession = (token, cfg) => `${NOM}=${token}; ${attributs(cfg, cfg.comptes.sessionJours * 86400)}`;
const cookieEffacement = cfg => `${NOM}=; ${attributs(cfg, 0)}`;
// Écrit par ce qu'il AUTORISE : l'origine exacte du site ET l'en-tête X-Rat-Market ; tout le reste (absent compris) est refusé.
function exigerOrigineSite(cfg) {
    return (req, res, next) => (req.headers.origin === cfg.origines.site && req.get('x-rat-market') === '1')
        ? next() : repondreErreur(res, 'ORIGINE', 'Origine non autorisée');
}
module.exports = { creerSession, lireCookie, cookieSession, cookieEffacement, exigerOrigineSite, NOM };
