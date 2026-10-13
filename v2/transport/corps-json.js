'use strict';
// PHOTO-EXTENSION — l'analyseur JSON GLOBAL de l'API. Avant : `express.json()` (100 ko pour toutes les routes). Une image en base64 (jusqu'à 2 Mio décodés, soit ~2,7 Mio) ne tient pas dans 100 ko.
// 🔑 TOUR 1 (relecture 1, B1) : la grande limite (4 Mio) est ÉCRITE PAR CE QU'ELLE AUTORISE, et chaque condition se juge AVANT de lire un seul octet du grand corps. Le corps est lu AVANT les limiteurs
// d'`index.js` (l'ordre du fichier hérité) : n'importe quel « Bearer x » faisait donc lire 4 Mio à l'inconnu (≈ 24 requêtes simultanées ou ≈ 52 connexions lentes suffisaient à dépasser 512 Mo).
// POST /api/identifier (sans casse ni barre finale, comme Express le route) :
//   · pas de `Content-Length` entier (chunked, absent, illisible) => 411 sans rien lire ; plus de 4 Mio => 413 sans rien lire ;
//   · 100 ko ou moins => l'analyseur d'avant ;
//   · de 100 ko à 4 Mio : la grande limite n'est donnée que si TOUT ceci est vrai, jugé avant la lecture, sinon 413 sans rien lire :
//       (a) l'en-tête a la forme EXACTE d'un jeton d'installation (l'expression de porteur.js, importée) ;
//       (b) le jeton est VÉRIFIÉ en base (installation vivante, par la même lecture que le porteur : porteur.installationParJeton) ; base muette => refus (échoue fermé) ;
//       (c) une place libre parmi les lectures de grand corps SIMULTANÉES : 4 au total, 1 par IP (`req.ip` : `trust proxy` est posé par index.js). Plein : 429 + Retry-After, RIEN lu ;
//       (d) un DÉLAI de lecture (20 s) : une connexion lente est coupée (socket détruite), la place est rendue ; elle l'est aussi à la fin, au refus ou quand le client coupe.
// Toute autre route : un `Content-Length` de plus de 100 ko est refusé (413) sans lecture ; sinon l'analyseur d'avant. (body-parser, lui, VIDE tout le corps d'une requête trop grosse avant de répondre 413 :
// refuser nous-mêmes évite de lire 4 Mio pour refuser.) Un jeton vérifié ne vaut pas authentification : `resoudrePorteur` recommence, dans la route.
// 🔑 TOUR 1 (relecture 1, I1) : la grande limite ne sert qu'au CONTRAT 2. Le corps est jugé après lecture : s'il fait plus de 100 ko et que `contrat` n'est pas le nombre 2, c'est un 413 (comme avant),
// donc la route HÉRITÉE ne voit jamais un corps plus gros qu'avant. La lecture a eu lieu (≤ 4 Mio, derrière les places), le corps est jeté.
const express = require('express');
const { RE_BEARER } = require('../porteur');

const PETITE_LIMITE_OCTETS = 100 * 1024;                 // celle d'express.json() par défaut
const LIMITE_SCAN_OCTETS = 4 * 1024 * 1024;
const DELAI_LECTURE_MS = 20000;
const PLACES_MAX = 4, PLACES_PAR_IP_MAX = 1;
const estRouteScan = (req) => req.method === 'POST' && String(req.path || '').toLowerCase().replace(/\/+$/, '') === '/api/identifier';
const erreurHttp = (status, message) => Object.assign(new Error(message), { status, statusCode: status, type: status === 413 ? 'entity.too.large' : 'length.required' });
const longueurDe = (req) => { const cl = req.headers && req.headers['content-length']; return typeof cl === 'string' && /^\d{1,9}$/.test(cl) ? Number(cl) : null; };

function json({ jetonValide, delaiLectureMs = DELAI_LECTURE_MS, globalMax = PLACES_MAX, parIpMax = PLACES_PAR_IP_MAX } = {}) {
    const verifier = jetonValide || (async (t) => { const i = await require('../porteur').installationParJeton(t); return Boolean(i && !i.revoqueeLe); });
    const petit = express.json();
    const grand = express.json({ limit: LIMITE_SCAN_OCTETS, verify: (req, res, buf) => { req.rmTailleCorps = buf.length; } });
    let enCours = 0; const parIp = new Map();
    const prendre = (ip) => { if (enCours >= globalMax || (parIp.get(ip) || 0) >= parIpMax) return false; enCours++; parIp.set(ip, (parIp.get(ip) || 0) + 1); return true; };
    const rendre = (ip) => { enCours--; const n = (parIp.get(ip) || 1) - 1; if (n > 0) parIp.set(ip, n); else parIp.delete(ip); };
    // un refus décidé AVANT la lecture : la réponse part, la connexion est fermée ensuite (le corps non lu n'est jamais avalé)
    // Après la réponse, le corps non lu est JETÉ (jamais gardé, aucune mémoire) jusqu'à 8 Mio ou 2 s, puis la connexion est détruite : fermer tout de suite une socket qui a encore du corps à lire la réinitialiserait
    // (RST) et le client perdrait la réponse. La mesure « octets lus » des bancs est prise quand la RÉPONSE part (avant ce rejet).
    const fermerApres = (req, res) => {
        res.setHeader('Connection', 'close');
        res.once('finish', () => {
            let jete = 0; const arret = () => { try { req.destroy(); } catch { /* déjà fermée */ } };
            const t = setTimeout(arret, 2000); t.unref();
            req.on('data', c => { jete += c.length; if (jete > 8 * 1024 * 1024) { clearTimeout(t); arret(); } });
            req.resume();
        });
    };
    const refuser = (req, res, next, erreur) => { fermerApres(req, res); return next(erreur); };

    const mw = function corpsJson(req, res, next) {
        const n = longueurDe(req);
        if (!estRouteScan(req)) return n !== null && n > PETITE_LIMITE_OCTETS ? refuser(req, res, next, erreurHttp(413, 'request entity too large')) : petit(req, res, next);
        if (n === null) return refuser(req, res, next, erreurHttp(411, 'content-length required'));
        if (n > LIMITE_SCAN_OCTETS) return refuser(req, res, next, erreurHttp(413, 'request entity too large'));
        if (n <= PETITE_LIMITE_OCTETS) return petit(req, res, next);
        // de 100 ko à 4 Mio : (a) la forme du jeton, (b) le jeton vérifié, (c) une place, (d) un délai
        const m = RE_BEARER.exec(String((req.headers && req.headers.authorization) || ''));
        if (!m) return refuser(req, res, next, erreurHttp(413, 'request entity too large'));
        Promise.resolve().then(() => verifier(m[1])).then(v => v === true, () => false).then(ok => {
            if (!ok) return refuser(req, res, next, erreurHttp(413, 'request entity too large'));
            const ip = String(req.ip || (req.socket && req.socket.remoteAddress) || 'inconnue');
            if (!prendre(ip)) {
                res.setHeader('Retry-After', '2');
                console.warn('⚠️ [v2 corps-json] lecture refusée : trop de grands corps en cours');
                fermerApres(req, res);
                return res.status(429).json({ success: false, error: 'Trop de requêtes, réessaie plus tard.' });
            }
            let libre = false, fini = false;
            const liberer = () => { if (libre) return; libre = true; clearTimeout(minute); rendre(ip); };
            res.once('close', liberer);
            const minute = setTimeout(() => {
                if (fini) return;
                fini = true; console.warn('⚠️ [v2 corps-json] lecture trop lente : connexion coupée');
                try { req.socket.destroy(); } catch { /* déjà fermée */ }
                liberer();
            }, delaiLectureMs);
            minute.unref();
            grand(req, res, (err) => {
                if (fini) return;                                                                         // coupé par le délai : plus personne à qui répondre
                fini = true; clearTimeout(minute);
                if (err) return next(err);
                const b = req.body;
                if (req.rmTailleCorps > PETITE_LIMITE_OCTETS && !(b && typeof b === 'object' && !Array.isArray(b) && b.contrat === 2)) { req.body = undefined; return next(erreurHttp(413, 'request entity too large')); }   // I1 : la route héritée garde ses 100 ko
                return next();
            });
        });
    };
    mw.etat = () => ({ global: enCours, ips: parIp.size });
    return mw;
}

module.exports = { json, estRouteScan, LIMITE_SCAN_OCTETS, PETITE_LIMITE_OCTETS, DELAI_LECTURE_MS, PLACES_MAX, PLACES_PAR_IP_MAX };
