'use strict';
// B6.1 — le consentement du banc réel : FERMÉ par défaut. Seul un objet complet, dont chaque champ est PROPRE à l'objet
// (jamais hérité du prototype) et satisfait sa forme, ouvre. Tout le reste ferme, sans dire pourquoi.
const crypto = require('crypto');

const FERME = Object.freeze({ valide: false });
const JETON = /^[A-Za-z0-9_-]{16,64}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const JOUR_MS = 86400000, TROIS_ANS_MS = 3 * 365 * JOUR_MS;

const propre = (o, k) => Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

function lireConsentement(corps, cfg, maintenant = new Date()) {
    try {
        if (corps === null || typeof corps !== 'object' || Array.isArray(corps)) return FERME;
        const c = propre(corps, 'consentementBanc');
        if (c === null || typeof c !== 'object' || Array.isArray(c)) return FERME;
        const version = propre(c, 'version'), le = propre(c, 'le'), jeton = propre(c, 'jeton');
        const versions = cfg && cfg.banc && cfg.banc.versionsTexte;
        if (!Array.isArray(versions) || typeof version !== 'string' || !versions.includes(version)) return FERME;
        if (typeof le !== 'string' || !ISO.test(le)) return FERME;
        const t = Date.parse(le), now = +new Date(maintenant);
        if (!Number.isFinite(t) || !Number.isFinite(now)) return FERME;
        if (t > now + JOUR_MS || t < now - TROIS_ANS_MS) return FERME;
        if (typeof jeton !== 'string' || !JETON.test(jeton)) return FERME;
        return { valide: true, version, le, jetonEmpreinte: crypto.createHash('sha256').update(jeton).digest('hex') };
    } catch { return FERME; }
}

module.exports = { lireConsentement };
