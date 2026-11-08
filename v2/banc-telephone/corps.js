'use strict';
// BANC-TELEPHONE (tour 1, M1) — l'analyseur de corps de POST /api/banc/telephone/resultat : 8 Ko, pas 100 Ko.
// L'analyseur JSON global (index.js : express.json(), 100 Ko) lit son corps AVANT la route : la limite de 8 Ko n'y était contrôlée qu'après lecture. Cet analyseur, monté AVANT lui et seulement pour CE chemin exact :
//   · refuse en 413 un corps ANNONCÉ au-delà de 8 Ko, sans en lire un octet ;
//   · lit lui-même un corps sans Content-Length (chunked) et s'ARRÊTE dès que 8 Ko sont dépassés : body-parser, lui, ne rend son erreur de taille qu'après avoir VIDÉ (lu en entier) le corps refusé — un client enverrait 50 Mo pour un 413 ;
//   · dans les deux cas répond « Connection: close » puis ferme la socket ; un client lent (15 s) est coupé.
// Il pose req.body et req._body : l'analyseur global saute alors ce corps (body-parser ne relit pas un corps déjà lu). N'existe que si la page est allumée (garde.lire) :
// sinon index.js ne le monte pas et la réponse reste celle d'avant, octet pour octet.
const { repondreErreur } = require('../erreurs');
const OCTETS = 8192, CHEMIN = '/api/banc/telephone/resultat', DELAI_MS = 15000;

function analyseur({ delaiMs = DELAI_MS } = {}) {
    return function corpsBancTelephone(req, res, next) {
        // Express route sans casse et sans barre finale : le chemin se compare de même (sinon /Resultat ou /resultat/ atteindrait la route sans passer par la limite de 8 Ko)
        if (req.method !== 'POST' || String(req.path).toLowerCase().replace(/\/+$/, '') !== CHEMIN) return next();
        let fini = false;
        const refuser = (statut, detail) => {
            if (fini) return; fini = true;
            if (!res.headersSent) {
                res.setHeader('Connection', 'close');
                res.once('finish', () => { try { req.socket.destroySoon(); } catch { /* socket déjà fermée */ } });
                repondreErreur(res, 'ENTREE', undefined, { detail }, statut);
            }
        };
        const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
        if (type !== 'application/json') return refuser(415, 'type');
        const cl = req.headers['content-length'];
        if (cl !== undefined && (!/^\d{1,10}$/.test(String(cl)) || Number(cl) > OCTETS)) return refuser(413, 'trop-gros');
        const morceaux = []; let total = 0;
        const minute = setTimeout(() => { if (fini) return; fini = true; try { req.socket.destroy(); } catch { /* déjà fermée */ } }, delaiMs); minute.unref();
        const nettoyer = () => { clearTimeout(minute); req.removeListener('data', surDonnee); req.removeListener('end', surFin); req.removeListener('error', surCoupe); req.removeListener('aborted', surCoupe); };
        const surDonnee = c => {
            if (fini) return;
            total += c.length;
            if (total > OCTETS) { req.pause(); nettoyer(); return refuser(413, 'trop-gros'); }      // la lecture S'ARRÊTE ici : rien de plus n'est tiré de la socket
            morceaux.push(c);
        };
        const surFin = () => {
            if (fini) return; nettoyer();
            const texte = Buffer.concat(morceaux, total).toString('utf8');
            let corps = {};
            if (texte.trim() !== '') {
                if (!/^\s*[{[]/.test(texte)) return refuser(400, 'json');                        // JSON strict : un objet ou un tableau (comme express.json)
                try { corps = JSON.parse(texte); } catch { return refuser(400, 'json'); }
            }
            fini = true; req.body = corps; req._body = true;
            return next();
        };
        const surCoupe = () => { fini = true; nettoyer(); };
        req.on('data', surDonnee); req.on('end', surFin); req.on('error', surCoupe); req.on('aborted', surCoupe);
    };
}
module.exports = { analyseur, OCTETS, CHEMIN };
