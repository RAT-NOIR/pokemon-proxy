'use strict';
// BANC-200 — la PAGE LOCALE de saisie de vérité à l'aveugle : un petit serveur Node qui sert la page (127.0.0.1 seulement) et la RELAIE vers l'API d'essai avec la session de l'administrateur.
//   $env:RM_BANC_JETON = '<jeton de l installation administrateur>'      (facultatif : sinon la page le demande, il reste EN MÉMOIRE de ce processus)
//   node outils/banc-200/serveur.js [--port=4747]                          puis ouvrir http://127.0.0.1:4747/
// Écrit par ce qu'il AUTORISE :
//   · l'API : l'essai (https://rat-market-api-essai.onrender.com) ou une adresse de boucle locale (bancs) ; RM_API_BASE vers toute autre adresse — la production v1, l'API v2 publique — est REFUSÉE au démarrage ;
//   · les chemins relayés : une liste FERMÉE de couples (méthode, chemin) — les routes /api/banc/seau/* et /api/banc/resoudre-cardmarket ; tout le reste est un 404 ;
//   · l'appelant : l'en-tête Host doit être 127.0.0.1:<port> ou localhost:<port> (contre le rebond DNS), l'Origin doit être celle de la page, et toute écriture porte le jeton anti-falsification posé dans la page à chaque démarrage ;
//   · le jeton d'accès : lu de l'environnement ou saisi dans la page, gardé en MÉMOIRE, envoyé SEULEMENT à l'API ; il n'est jamais écrit, journalisé, ni rendu à la page (la page apprend seulement « un jeton est posé »).
// Aucune requête vers Vinted ni vers Cardmarket : la résolution d'une adresse Cardmarket est faite par l'API, sur sa base, sans charger la page.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ESSAI = 'https://rat-market-api-essai.onrender.com';
const RELAIS = Object.freeze([
    ['GET', '/api/banc/seau/courant'], ['GET', '/api/banc/seau/a-etiqueter'], ['GET', '/api/banc/seau/photo'], ['GET', '/api/banc/seau/verifier'],
    ['POST', '/api/banc/seau/candidats'], ['POST', '/api/banc/seau/verite'], ['POST', '/api/banc/resoudre-cardmarket']
]);
const REQUETE_OK = /^[A-Za-z0-9=&_-]{0,200}$/;          // la chaîne de requête relayée : des identifiants, rien d'autre
const CORPS_MAX = 8 * 1024, REPONSE_MAX = 8 * 1024 * 1024, DELAI_MS = 20000;
const erreur = (code, message) => Object.assign(new Error(message || code), { code });

/** L'adresse de l'API est jugée par ce qu'elle AUTORISE : l'essai, ou la boucle locale. */
function baseAutorisee(base) {
    let u; try { u = new URL(String(base)); } catch { throw erreur('BASE-REFUSEE', 'adresse de l\'API illisible'); }
    const boucle = ['127.0.0.1', 'localhost', '[::1]'].includes(u.hostname);
    if (!(u.origin === ESSAI || (boucle && (u.protocol === 'http:' || u.protocol === 'https:')))) throw erreur('BASE-REFUSEE', 'seul le service d\'essai (ou une boucle locale) est permis');
    if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '')) throw erreur('BASE-REFUSEE', 'adresse de l\'API : origine seule');
    return u.origin;
}

// JUGE EN UN CLIC (ordre n°30) : `lanceur` (objet) dit que ce serveur est piloté par outils/banc-200/lancer-juge.js, qui se connecte à l'essai et pose le jeton EN MÉMOIRE (poserJeton) : alors la page n'a AUCUN champ « jeton » (retiré du HTML servi, /_session refusée),
// /_etat dit l'état de la connexion, et un 401 de l'API (jeton périmé) est signalé au lanceur (`surRefusJeton`). Sans `lanceur`, le comportement d'avant est intact (jeton de l'environnement ou saisi dans la page).
const IDENTITE = 'rm-juge-banc200';                       // ce que /_etat dit de lui : le lanceur reconnaît ainsi « notre » serveur déjà lancé, et rien d'autre
const SESSION_RE = /<!--SESSION-DEBUT-->[\s\S]*?<!--SESSION-FIN-->/;

function creerServeur({ apiBase = process.env.RM_API_BASE || ESSAI, jeton = process.env.RM_BANC_JETON || null, fetchFn = fetch, dossier = __dirname, lanceur = null } = {}) {
    const base = baseAutorisee(apiBase);
    const csrf = crypto.randomBytes(24).toString('hex');
    let jetonAcces = typeof jeton === 'string' && jeton.trim() ? jeton.trim() : null;
    let connexion = lanceur ? { etat: 'en-cours', message: null } : null;
    let port = null;
    const hotes = () => [`127.0.0.1:${port}`, `localhost:${port}`];
    const origines = () => hotes().map(h => `http://${h}`);
    const entetesSurs = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
    const repondre = (res, statut, corps, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(statut, { 'Content-Type': type, ...entetesSurs, ...extra }); res.end(corps); };
    const json = (res, statut, o) => repondre(res, statut, JSON.stringify(o));
    const fichier = nom => fs.readFileSync(path.join(dossier, nom));

    function lireCorps(req) {
        return new Promise((resolve, reject) => {
            const m = []; let n = 0;
            let trop = false;       // le surplus est lu et jeté (pas de coupure brutale : le client doit pouvoir lire le 413) ; la connexion se ferme après la réponse
            req.on('data', c => { n += c.length; if (trop) return; if (n > CORPS_MAX) { trop = true; m.length = 0; reject(erreur('TROP')); } else m.push(c); });
            req.on('end', () => resolve(Buffer.concat(m))); req.on('error', () => reject(erreur('COUPE')));
        });
    }

    async function relayer(req, res, chemin, requete) {
        if (!jetonAcces) return json(res, 401, { success: false, erreur: { code: 'JETON', message: 'aucun jeton posé' } });
        let corps;
        if (req.method === 'POST') {
            try { corps = await lireCorps(req); } catch { return repondre(res, 413, JSON.stringify({ success: false, erreur: { code: 'ENTREE', detail: 'corps' } }), 'application/json; charset=utf-8', { Connection: 'close' }); }
            try { JSON.parse(corps.toString('utf8')); } catch { return json(res, 400, { success: false, erreur: { code: 'ENTREE', detail: 'json' } }); }
        }
        let r;
        try {
            r = await fetchFn(`${base}${chemin}${requete ? `?${requete}` : ''}`, {
                method: req.method, redirect: 'manual', signal: AbortSignal.timeout(DELAI_MS),
                headers: { authorization: `Bearer ${jetonAcces}`, ...(corps ? { 'content-type': 'application/json' } : {}) }, ...(corps ? { body: corps } : {})
            });
        } catch { return json(res, 502, { success: false, erreur: { code: 'INDISPONIBLE', message: 'l\'API ne répond pas' } }); }
        if (lanceur && r.status === 401 && typeof lanceur.surRefusJeton === 'function') { try { lanceur.surRefusJeton(); } catch { /* le lanceur ne doit jamais faire échouer le relais */ } }
        const tampon = Buffer.from(await r.arrayBuffer());
        if (tampon.length > REPONSE_MAX) return json(res, 502, { success: false, erreur: { code: 'INDISPONIBLE', message: 'réponse trop grande' } });
        const type = r.headers.get('content-type') || 'application/octet-stream';
        return repondre(res, r.status, tampon, /^(application\/json|image\/(jpeg|png|webp))/.test(type) ? type : 'application/octet-stream');
    }

    const serveur = http.createServer(async (req, res) => {
        try {
            if (!hotes().includes(String(req.headers.host || '').toLowerCase())) return json(res, 403, { success: false, erreur: { code: 'ORIGINE' } });
            if (req.headers.origin !== undefined && !origines().includes(req.headers.origin)) return json(res, 403, { success: false, erreur: { code: 'ORIGINE' } });
            // une requête qu'un navigateur dit venir d'AILLEURS (une page tierce qui chargerait une photo avec notre jeton) : refusée ; l'absence de l'en-tête (curl, bancs, vieux navigateurs) n'est pas un refus
            const site = req.headers['sec-fetch-site'];
            if (site !== undefined && site !== 'same-origin' && site !== 'none') return json(res, 403, { success: false, erreur: { code: 'ORIGINE' } });
            const u = new URL(req.url, 'http://x'), chemin = u.pathname;
            if (req.method === 'GET' && (chemin === '/' || chemin === '/index.html')) {
                const html = fichier('page.html').toString('utf8').replace('__CSRF__', csrf);
                return repondre(res, 200, lanceur ? html.replace(SESSION_RE, '') : html.replace(/<!--SESSION-(DEBUT|FIN)-->/g, ''), 'text/html; charset=utf-8');
            }
            if (req.method === 'GET' && (chemin === '/app.js' || chemin === '/controleur.js')) return repondre(res, 200, fichier(chemin.slice(1)), 'text/javascript; charset=utf-8');
            if (req.method === 'GET' && chemin === '/_etat') return json(res, 200, { success: true, appli: IDENTITE, jeton: Boolean(jetonAcces), api: base, lanceur: Boolean(lanceur), connexion });
            if (req.method === 'POST' && chemin === '/_session') {
                if (req.headers['x-rm-csrf'] !== csrf) return json(res, 403, { success: false, erreur: { code: 'ORIGINE' } });
                if (lanceur) return json(res, 403, { success: false, erreur: { code: 'LANCEUR', message: 'le jeton est posé par le lanceur, jamais saisi' } });
                let b; try { b = JSON.parse((await lireCorps(req)).toString('utf8')); } catch { return json(res, 400, { success: false, erreur: { code: 'ENTREE' } }); }
                if (!b || typeof b.jeton !== 'string' || b.jeton.length < 8 || b.jeton.length > 200 || /\s/.test(b.jeton)) return json(res, 400, { success: false, erreur: { code: 'ENTREE', detail: 'jeton' } });
                jetonAcces = b.jeton; return json(res, 200, { success: true, jeton: true });
            }
            if (!RELAIS.some(([m, c]) => m === req.method && c === chemin)) return json(res, 404, { success: false, erreur: { code: 'CODE_INVALIDE' } });
            const requete = u.search ? u.search.slice(1) : '';
            if (!REQUETE_OK.test(requete)) return json(res, 400, { success: false, erreur: { code: 'ENTREE', detail: 'requete' } });
            if (req.method !== 'GET' && req.headers['x-rm-csrf'] !== csrf) return json(res, 403, { success: false, erreur: { code: 'ORIGINE' } });
            return await relayer(req, res, chemin, requete);
        } catch { return json(res, 500, { success: false, erreur: { code: 'SERVEUR' } }); }
    });

    return {
        serveur, csrf,
        /** Le lanceur pose le jeton (EN MÉMOIRE seulement) : la connexion passe à « ok ». */
        poserJeton: j => { jetonAcces = typeof j === 'string' && j.trim() ? j.trim() : null; if (connexion) connexion = jetonAcces ? { etat: 'ok', message: null } : { etat: 'echec', message: 'aucun jeton' }; },
        /** Le lanceur dit l'état de sa connexion : { etat: 'en-cours' | 'ok' | 'echec', message } — le message est une phrase française SANS secret, affichée telle quelle par la page. */
        poserConnexion: c => { if (connexion) connexion = { etat: c.etat, message: c.message || null }; if (connexion && connexion.etat === 'echec') jetonAcces = null; },
        ecouter: (p = 4747) => new Promise((resolve, reject) => { serveur.once('error', reject); serveur.listen(p, '127.0.0.1', () => { port = serveur.address().port; resolve({ port, url: `http://127.0.0.1:${port}/` }); }); }),
        fermer: () => new Promise(r => { serveur.close(() => r()); if (serveur.closeAllConnections) serveur.closeAllConnections(); })
    };
}

module.exports = { creerServeur, baseAutorisee, RELAIS, ESSAI, IDENTITE };

if (require.main === module) {
    const arg = process.argv.slice(2);
    const inconnu = arg.find(a => !/^--port=\d{2,5}$/.test(a));
    if (inconnu) { console.error('❌ ARRÊT : argument non reconnu. usage : node outils/banc-200/serveur.js [--port=4747]'); process.exit(1); }
    const port = arg.length ? Number(arg[0].slice(7)) : 4747;
    let s;
    try { s = creerServeur(); } catch (e) { console.error(`❌ ARRÊT : ${e.message}`); process.exit(1); }
    s.ecouter(port).then(r => console.log(`Page de saisie à l'aveugle : ${r.url}  (API : ${process.env.RM_API_BASE || ESSAI} ; jeton ${process.env.RM_BANC_JETON ? 'lu de l\'environnement' : 'à saisir dans la page'})`))
        .catch(e => { console.error(`❌ ARRÊT : ${(e && e.code) || 'erreur'}`); process.exit(1); });
}
