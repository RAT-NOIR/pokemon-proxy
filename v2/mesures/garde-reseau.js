'use strict';
// MESURE-2A — LA GARDE RÉSEAU DE L'OUTIL DE MESURE. Écrite par ce qu'elle AUTORISE : un seul hôte du monde, openrouter.ai.
// Tout le reste LÈVE une exception « GARDE-RESEAU » AVANT la connexion, et la tentative est COMPTÉE (refus()) : « la chaîne a voulu appeler TCGdex 37 fois »
// est une mesure, pas un détail. Quatre portes, parce que le trafic sortant en a quatre : http.request/get, https.request/get, fetch (undici), et la
// connexion TCP elle-même (net.Socket.connect), qui rattrape tout client qui contournerait les trois premières.
// Une exception, NOMMÉE : la BOUCLE LOCALE (127.x, ::1, localhost) — la base en mémoire du banc (mongod) ; ce n'est pas un hôte du monde. Toujours ouverte à la
// couche TCP (mongod), fermée par défaut aux couches HTTP/fetch (option `boucleLocale`).
const http = require('http');
const https = require('https');
const net = require('net');

const HOTE_AUTORISE = 'openrouter.ai';
const hoteAutorise = (h) => typeof h === 'string' && h.trim().toLowerCase().replace(/\.$/, '') === HOTE_AUTORISE;
const estBoucle = (h) => typeof h === 'string' && (/^127(\.\d{1,3}){3}$/.test(h) || h === '::1' || h === '[::1]' || h.toLowerCase() === 'localhost');

function erreurGarde(hote, via) {
    const e = new Error(`GARDE-RESEAU : l'hôte « ${hote || '(illisible)'} » n'est pas autorisé (${via}) — seul ${HOTE_AUTORISE} l'est dans cet outil de mesure`);
    e.code = 'GARDE-RESEAU';
    return e;
}

// L'hôte visé par les arguments de http(s).request/get : (url|URL, options?, cb?) ou (options, cb?). Illisible => null => refusé.
function hoteDesArguments(args, protocoleParDefaut) {
    const [a, b] = args;
    try {
        if (typeof a === 'string') return new URL(a).hostname;
        if (a instanceof URL) return a.hostname;
        const o = (a && typeof a === 'object') ? a : (b && typeof b === 'object' ? b : null);
        if (!o) return null;
        const h = o.hostname || o.host;
        return typeof h === 'string' && h ? h.replace(/:\d+$/, '') : null;
    } catch { return null; }
}
// L'hôte visé par net.Socket.connect : (options) | (port, host?) | (path)
function hoteTcp(args) {
    // net.connect(...) passe déjà ses arguments NORMALISÉS à Socket.connect : un tableau [options, rappel] ; on lit alors ses options
    if (Array.isArray(args[0])) return hoteTcp([args[0][0]]);
    const [a, b] = args;
    if (a && typeof a === 'object' && !Array.isArray(a)) { if (a.path) return null; return a.host || a.hostname || 'localhost'; }
    if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) return typeof b === 'string' ? b : 'localhost';
    return null;                                               // un chemin (socket unix, pipe) : jamais autorisé
}

/**
 * Installe la garde. Rend { retirer(), refus(), photoLocale(url, octets, type?) }.
 * Idempotence : une seconde installation sans retrait lève (deux couches de patch ne se retirent plus dans l'ordre).
 */
let installee = false;
// L'ÉLARGISSEMENT, par une LISTE FERMÉE : une décision écrite peut ajouter api.tcgdex.net (source en LECTURE SEULE de la chaîne héritée) — rien d'autre. Cardmarket, Vinted,
// ou n'importe quel autre nom : l'installation LÈVE. Par défaut, aucun hôte supplémentaire (le banc de cet outil le vérifie).
const SUPPLEMENTAIRES_ADMISSIBLES = Object.freeze(['api.tcgdex.net']);
function installerGardeReseau({ boucleLocale = false, hotesSupplementaires = [] } = {}) {
    for (const h of hotesSupplementaires) if (!SUPPLEMENTAIRES_ADMISSIBLES.includes(String(h).toLowerCase())) throw new Error(`GARDE-RESEAU : l'hôte « ${h} » ne peut pas être ajouté (admissibles : ${SUPPLEMENTAIRES_ADMISSIBLES.join(', ')})`);
    if (installee) throw new Error('garde réseau déjà installée');
    installee = true;
    const supplementaires = hotesSupplementaires.map(h => String(h).toLowerCase());
    const refus = [];
    const noter = (hote, via) => { refus.push({ hote: hote || '(illisible)', via }); return erreurGarde(hote, via); };
    const original = { httpRequest: http.request, httpGet: http.get, httpsRequest: https.request, httpsGet: https.get, fetch: globalThis.fetch, connect: net.Socket.prototype.connect };
    const permis = (h) => hoteAutorise(h) || (boucleLocale && estBoucle(h)) || (typeof h === 'string' && supplementaires.includes(h.toLowerCase()));

    const envelopper = (fn, via) => function gardee(...args) { const h = hoteDesArguments(args); if (!permis(h)) throw noter(h, via); return fn.apply(this, args); };
    http.request = envelopper(original.httpRequest, 'http.request');
    http.get = envelopper(original.httpGet, 'http.get');
    https.request = envelopper(original.httpsRequest, 'https.request');
    https.get = envelopper(original.httpsGet, 'https.get');

    globalThis.fetch = function fetchGarde(entree, init) {
        let u = null;
        try { u = new URL(typeof entree === 'string' ? entree : (entree && entree.url) || String(entree)); } catch { /* illisible : refusé plus bas */ }
        const h = u ? u.hostname : null;
        if (!permis(h)) return Promise.reject(noter(h, 'fetch'));
        return original.fetch.call(globalThis, entree, init);
    };

    net.Socket.prototype.connect = function connectGardee(...args) {
        const h = hoteTcp(args);
        if (!(h && (hoteAutorise(h) || estBoucle(h) || supplementaires.includes(h.toLowerCase())))) throw noter(h, 'net.connect');
        return original.connect.apply(this, args);
    };

    return {
        refus: () => refus.slice(),
        retirer() {
            http.request = original.httpRequest; http.get = original.httpGet; https.request = original.httpsRequest; https.get = original.httpsGet;
            globalThis.fetch = original.fetch; net.Socket.prototype.connect = original.connect;
            installee = false;
        }
    };
}

module.exports = { installerGardeReseau, hoteAutorise, estBoucle, HOTE_AUTORISE };
