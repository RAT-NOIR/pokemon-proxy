'use strict';
// En-têtes de sécurité des réponses v2 — et SEULEMENT v2 : une route héritée ne les reçoit pas.
// Écrit par ce qu'il AUTORISE : une réponse est « v2 » si son chemin est sous un préfixe propre à la v2, ou si resoudrePorteur a posé
// req.v2 (routes partagées /api/identifier, /api/solde… quand le porteur est v2). Les en-têtes sont posés AU MOMENT D'ENVOYER
// (writeHead) : ils couvrent donc aussi les 4xx, 5xx, 429 et les erreurs non rattrapées, quel que soit le chemin pris pour répondre.
const PREFIXES_V2 = Object.freeze(['/api/installation', '/api/compte', '/api/scanner', '/api/banc']);
const ENTETES = Object.freeze({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });

const cheminV2 = chemin => PREFIXES_V2.some(p => chemin === p || chemin.startsWith(p + '/'));

function middleware() {
    return function entetesV2(req, res, next) {
        const chemin = req.path;                              // capturé avant que les routeurs ne le raccourcissent
        const ecrireTete = res.writeHead;
        res.writeHead = function (...args) {
            if (!this.headersSent && (cheminV2(chemin) || req.v2)) for (const [k, val] of Object.entries(ENTETES)) this.setHeader(k, val);
            return ecrireTete.apply(this, args);
        };
        next();
    };
}
module.exports = { middleware, cheminV2, PREFIXES_V2, ENTETES };
