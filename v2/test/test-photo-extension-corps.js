'use strict';
// PHOTO-EXTENSION, tour 1 (B1 et I1 de la relecture 1) — l'analyseur de corps JSON global : la grande limite (4 Mio) n'est LUE que pour un porteur réel, un à la fois, sans s'éterniser.
// Aucune base, aucun réseau hors boucle locale : un serveur Express local avec l'analyseur de production (v2/transport/corps-json.js), un client `http` brut. Le jeton est jugé par une fonction INJECTÉE.
// 🔑 La preuve est un COMPTEUR D'OCTETS LUS : `socket.bytesRead` au moment où la réponse part. Un refus qui a lu 4 Mio d'abord n'est pas un refus.
const H = require('./_harnais');
const http = require('http');
const express = require('express');
const { json } = require('../transport/corps-json');

const MIO = 1024 * 1024, VALIDE = 'jeton_valide_0123456789abcdef', INCONNU = 'jeton_inconnu_0123456789abcdef';
const lus = new Map();                                                  // x-essai -> octets lus sur la socket quand la réponse est partie
let nEssai = 0;
const verifs = { n: 0 };                                                // combien de fois le jeton a été jugé (en base, en production) : un jeton mal formé ne coûte AUCUNE lecture
const attendre = ms => new Promise(r => setTimeout(r, ms));
const jusque = async (cond, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (cond()) return true; await attendre(15); } return false; };
const corpsDe = (n, extra = {}) => Buffer.from(JSON.stringify({ contrat: 2, ...extra, x: 'a'.repeat(n) }));

// un client brut : `octets` du corps, `contentLength` annoncé (défaut : la taille ; null = chunked), `partiel` : n'envoie que ce nombre d'octets puis se TAIT (connexion lente)
function envoyer(base, { chemin = '/api/identifier', methode = 'POST', bearer = VALIDE, auth, ip = '10.0.0.1', corps, contentLength, partiel = null, entetes = {} } = {}) {
    const essai = `e${++nEssai}`;
    const url = new URL(base + chemin);
    const h = { 'content-type': 'application/json', 'x-essai': essai, 'x-forwarded-for': ip, ...entetes };
    const a = auth !== undefined ? auth : (bearer ? `Bearer ${bearer}` : undefined); if (a) h.authorization = a;
    if (contentLength !== null) h['content-length'] = String(contentLength !== undefined ? contentLength : corps.length);
    let ferme = false, repondu = null, fin;
    const fini = new Promise(r => { fin = r; });
    const req = http.request({ host: url.hostname, port: url.port, path: url.pathname, method: methode, headers: h, agent: false }, res => {
        const m = []; res.on('data', c => m.push(c));
        res.on('end', () => { let j = null; try { j = JSON.parse(Buffer.concat(m).toString('utf8')); } catch { /* non JSON */ } repondu = { statut: res.statusCode, entetes: res.headers, json: j }; fin(repondu); });
    });
    // une coupure du serveur pendant que le client écrit encore peut précéder la fin de la réponse : on laisse 300 ms à la réponse avant de conclure à une coupure
    req.on('error', () => { ferme = true; setTimeout(() => fin(repondu || { statut: null, erreur: true }), 300); });
    req.on('close', () => { ferme = true; setTimeout(() => fin(repondu || { statut: null, ferme: true }), 300); });
    if (partiel !== null) req.write(corps.subarray(0, partiel));
    else if (contentLength === null) { req.write(corps.subarray(0, 1000)); req.end(corps.subarray(1000)); }      // deux écritures : Node envoie en chunked, sans Content-Length
    else req.end(corps);
    return { essai, req, fini, estFerme: () => ferme, lus: () => lus.get(essai) };
}

setTimeout(() => { console.error('❌ le banc a dépassé 150 s (un serveur ou une lecture est resté en suspens)'); process.exit(1); }, 150000).unref();
(async () => {
    const poser = async (options) => {
        const app = express(); app.set('trust proxy', true);
        app.use((q, s, n) => { const wh = s.writeHead; s.writeHead = function (...a) { lus.set(q.headers['x-essai'], q.socket.bytesRead); return wh.apply(this, a); }; n(); });
        const mw = json({ jetonValide: async t => { verifs.n++; return t === VALIDE; }, ...options });
        app.use(mw);
        app.use((q, s) => s.status(200).json({ taille: JSON.stringify(q.body).length }));
        app.use((e, q, s, n) => s.status(e.status || 500).json({ erreur: e.type || 'erreur' }));
        const sv = await H.serveur(app);
        return { sv, mw, url: sv.url };
    };
    const { sv, mw, url } = await poser({ delaiLectureMs: 500, globalMax: 2, parIpMax: 1 });
    const gros = corpsDe(4 * MIO - 200);                                  // ~4 Mio, tient sous la borne
    const refus = async (nom, opts, statutAttendu) => {
        // Le client annonce ~4 Mio mais n'en écrit que 16 octets puis ATTEND la réponse : la décision est prise sur les en-têtes seuls (un client qui écrit 4 Mio pendant qu'on lui répond peut perdre la réponse
        // dans une réinitialisation de la connexion : c'est de la plomberie de socket, pas le sujet).
        const c = envoyer(url, { corps: gros, partiel: 16, ...opts }); const r = await c.fini;
        H.v(`${nom} : refusé SANS lire le corps (statut ${statutAttendu}, moins de 400 ko lus sur ~4 Mio)`, [r.statut, (c.lus() ?? 1e9) < 400 * 1024], [statutAttendu, true]);
        return r;
    };

    // ── 0. le témoin : un VRAI porteur passe, et le compteur voit bien les octets ──
    {
        const c = envoyer(url, { corps: corpsDe(3 * MIO) }); const r = await c.fini;
        H.v('0. porteur réel (jeton de forme exacte ET reconnu), 3 Mio : 200, corps lu en entier (le compteur voit > 3 Mio)', [r.statut, c.lus() > 3 * MIO], [200, true]);
        H.v('0. et la place est rendue à la fin', await jusque(() => mw.etat().global === 0), true);
        for (const chemin of ['/API/Identifier', '/api/identifier/']) { const d = await envoyer(url, { chemin, corps: corpsDe(1 * MIO) }).fini; H.v(`0. variante de chemin ${chemin} : 200`, d.statut, 200); }
    }

    // ── 1. (a) la FORME exacte d'un jeton d'installation (l'expression de porteur.js) ──
    {
        const v0 = verifs.n;
        await refus('1a. « Bearer x »', { bearer: 'x' }, 413);
        await refus('1a. jeton trop court (19 caractères)', { bearer: 'a'.repeat(19) }, 413);
        await refus('1a. jeton aux caractères hors alphabet', { bearer: 'a'.repeat(30) + '!!' }, 413);
        await refus('1a. en-tête qui n\'est pas Bearer (Basic), ou absent', { auth: 'Basic ' + 'a'.repeat(30) }, 413);
        await refus('1a. sans Authorization', { bearer: null }, 413);
        H.v('1a. aucun de ces cinq jetons mal formés n\'a coûté une lecture du jeton (la forme se juge avant la base)', verifs.n - v0, 0);
        const src = require('fs').readFileSync(require.resolve('../transport/corps-json'), 'utf8');
        H.v('1a. l\'expression du jeton est IMPORTÉE de porteur.js, jamais recopiée', [/RE_BEARER\s*\}?\s*=\s*require\('\.\.\/porteur'\)|require\('\.\.\/porteur'\)/.test(src), /\[A-Za-z0-9_-\]\{20,64\}/.test(src)], [true, false]);
    }

    // ── 2. (b) Content-Length présent et ≤ la borne ──
    {
        await refus('2b. Content-Length de 5 Mio (> 4 Mio)', { contentLength: 5 * MIO }, 413);
        const c = envoyer(url, { corps: gros, contentLength: null, partiel: 16 }); const r = await c.fini;      // chunked : pas de Content-Length
        H.v('2b. SANS Content-Length (chunked) sur la route du scan : 411, rien lu (jamais la grande limite)', [r.statut, (c.lus() ?? 1e9) < 400 * 1024], [411, true]);
        const p = envoyer(url, { corps: corpsDe(50 * 1024) }); const rp = await p.fini;
        H.v('2b. un petit corps du même scan (50 ko) passe par la limite d\'avant : 200', rp.statut, 200);
    }

    // ── 3. (c) le jeton est VÉRIFIÉ avant la lecture ──
    {
        await refus('3c. jeton de forme exacte mais INCONNU', { bearer: INCONNU }, 413);
        const { sv: sv2, url: url2 } = await poser({ jetonValide: async () => { throw new Error('base muette'); } });
        const c = envoyer(url2, { corps: gros, partiel: 16 }); const r = await c.fini;
        H.v('3c. base muette : échoue fermé (413, rien lu)', [r.statut, (c.lus() ?? 1e9) < 400 * 1024], [413, true]);
        await sv2.fermer();
    }

    // ── 4. (d) plafond de lectures simultanées : 2 au total, 1 par IP ──
    {
        const lent = (ip) => envoyer(url, { corps: gros, partiel: 100 * 1024, ip });
        const A = lent('10.1.0.1');
        H.v('4d. une lecture lente d\'une IP tient UNE place', await jusque(() => mw.etat().global === 1), true);
        const A2 = envoyer(url, { corps: gros, partiel: 16, ip: '10.1.0.1' }); const rA2 = await A2.fini;
        H.v('4d. la MÊME IP, une deuxième lecture : 429 avec Retry-After, rien lu', [rA2.statut, Boolean(rA2.entetes && rA2.entetes['retry-after']), (A2.lus() ?? 1e9) < 400 * 1024], [429, true, true]);
        const B = lent('10.1.0.2');
        H.v('4d. une autre IP prend la deuxième place', await jusque(() => mw.etat().global === 2), true);
        const C = envoyer(url, { corps: gros, partiel: 16, ip: '10.1.0.3' }); const rC = await C.fini;
        H.v('4d. plafond GLOBAL atteint (2) : une troisième IP reçoit 429 + Retry-After, rien lu', [rC.statut, Boolean(rC.entetes && rC.entetes['retry-after']), (C.lus() ?? 1e9) < 400 * 1024], [429, true, true]);
        A.req.destroy(); B.req.destroy();
        H.v('4d. un client qui coupe libère sa place', await jusque(() => mw.etat().global === 0), true);
        const D = envoyer(url, { corps: corpsDe(1 * MIO), ip: '10.1.0.4' }); const rD = await D.fini;
        H.v('4d. et la lecture suivante passe', rD.statut, 200);
        H.v('4d. aucune place ni IP ne reste retenue', mw.etat(), { global: 0, ips: 0 });
    }

    // ── 5. (e) délai de lecture : une connexion lente est coupée ──
    {
        const t0 = Date.now(); const S = envoyer(url, { corps: gros, partiel: 100 * 1024, ip: '10.2.0.1' });
        const coupee = await jusque(() => S.estFerme(), 3000);
        H.v('5e. un client qui envoie 100 ko puis se tait : connexion COUPÉE par le serveur après le délai (500 ms ici), place rendue', [coupee, Date.now() - t0 < 2500, await jusque(() => mw.etat().global === 0)], [true, true, true]);
        H.v('5e. le défaut de production est un délai fini (≤ 30 s)', (() => { const d = require('../transport/corps-json').DELAI_LECTURE_MS; return Number.isFinite(d) && d > 0 && d <= 30000; })(), true);
    }

    // ── 6. I1 : la route HÉRITÉE garde ses 100 ko ──
    {
        const h = envoyer(url, { corps: Buffer.from(JSON.stringify({ title: 'a'.repeat(3 * MIO), userId: 'x' })) }); const rh = await h.fini;
        H.v('6. TOUR 1 (I1) : un corps SANS contrat: 2 de 3 Mio (un `title` géant à destination de la route héritée) : 413', rh.statut, 413);
        const h2 = envoyer(url, { corps: Buffer.from(JSON.stringify({ contrat: 1, title: 'a'.repeat(3 * MIO) })) }); const rh2 = await h2.fini;
        const h3 = envoyer(url, { corps: Buffer.from(JSON.stringify({ contrat: '2', title: 'a'.repeat(3 * MIO) })) }); const rh3 = await h3.fini;
        const h4 = envoyer(url, { corps: Buffer.from(JSON.stringify([{ contrat: 2 }, 'a'.repeat(3 * MIO)])) }); const rh4 = await h4.fini;
        H.v('6. `contrat: 1`, `contrat: "2"` (chaîne), un tableau : 413 aussi (seul le nombre 2 ouvre la grande limite)', [rh2.statut, rh3.statut, rh4.statut], [413, 413, 413]);
        const ok = envoyer(url, { corps: Buffer.from(JSON.stringify({ title: 'petit' })) }); const rok = await ok.fini;
        H.v('6. un petit corps sans contrat reste servi comme avant', rok.statut, 200);
    }

    // ── 7. les autres routes, les autres méthodes ──
    {
        await refus('7. /api/analyser avec un jeton réel', { chemin: '/api/analyser' }, 413);
        await refus('7. /api/identifier/reponse avec un jeton réel', { chemin: '/api/identifier/reponse' }, 413);
        await refus('7. PUT /api/identifier avec un jeton réel', { methode: 'PUT' }, 413);
    }

    await sv.fermer();
    H.bilan();
})().catch(e => { console.error(e); process.exit(1); });     // un serveur resté ouvert ne doit pas suspendre le banc
