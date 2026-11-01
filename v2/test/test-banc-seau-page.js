'use strict';
// BANC-200 — la page locale de saisie à l'aveugle (outils/banc-200/serveur.js). Aucune base, aucun réseau hors boucle locale : l'API d'essai est une FAUSSE API sur 127.0.0.1 qui note ce qu'elle reçoit.
const H = require('./_harnais');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { creerServeur, baseAutorisee, RELAIS } = require('../../outils/banc-200/serveur');

const JETON = 'jeton-secret-du-banc-0123456789';
const essayer = async (nom, f) => { try { await f(); } catch (e) { H.v(`${nom} (exception)`, String(e && (e.stack || e.message)), 'aucune'); } };

(async () => {
    // la fausse API
    const recus = [];
    const octetsPhoto = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    const api = http.createServer((req, res) => {
        const m = []; req.on('data', c => m.push(c)); req.on('end', () => {
            recus.push({ methode: req.method, url: req.url, auth: req.headers.authorization, corps: Buffer.concat(m).toString('utf8'), type: req.headers['content-type'] });
            if (req.url.startsWith('/api/banc/seau/photo')) { res.writeHead(200, { 'content-type': 'image/jpeg', 'set-cookie': 'x=1' }); return res.end(octetsPhoto); }
            res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ success: true, eco: req.url }));
        });
    });
    await new Promise(r => api.listen(0, '127.0.0.1', r));
    const apiUrl = `http://127.0.0.1:${api.address().port}`;

    // ── l'adresse de l'API : l'essai ou la boucle locale, rien d'autre
    for (const bonne of ['https://rat-market-api-essai.onrender.com', 'http://127.0.0.1:5000', 'http://localhost:8080']) H.v(`1. base permise : ${bonne}`, baseAutorisee(bonne).length > 0, true);
    for (const mauvaise of ['https://api-v2.rat-market.fr', 'https://pokemon-proxy.onrender.com', 'https://rat-market-api-essai.onrender.com.evil.fr', 'https://evil.fr/', 'http://rat-market-api-essai.onrender.com', 'https://user:pw@rat-market-api-essai.onrender.com', 'pas une adresse', 'https://rat-market-api-essai.onrender.com/api']) {
        let code = null; try { baseAutorisee(mauvaise); } catch (e) { code = e.code; }
        H.v(`1. base refusée : ${mauvaise}`, code, 'BASE-REFUSEE');
    }
    let refusee = null; try { creerServeur({ apiBase: 'https://api-v2.rat-market.fr', jeton: JETON }); } catch (e) { refusee = e.code; }
    H.v('1. le serveur refuse de démarrer vers la production', refusee, 'BASE-REFUSEE');

    const S = creerServeur({ apiBase: apiUrl, jeton: JETON });
    const { port, url } = await S.ecouter(0);
    const hote = `127.0.0.1:${port}`;
    // un client qui peut choisir son Host / Origin (fetch interdit Host) : http brut
    const brut = (methode, chemin, { host = hote, origin, site, csrf, corps, type = 'application/json' } = {}) => new Promise((resolve, reject) => {
        const h = { host }; if (origin) h.origin = origin; if (site) h['sec-fetch-site'] = site; if (csrf) h['x-rm-csrf'] = csrf; if (corps !== undefined) { h['content-type'] = type; h['content-length'] = Buffer.byteLength(corps); }
        const r = http.request({ host: '127.0.0.1', port, path: chemin, method: methode, headers: h, agent: false }, res => { const m = []; res.on('data', c => m.push(c)); res.on('end', () => resolve({ statut: res.statusCode, entetes: res.headers, corps: Buffer.concat(m) })); });
        r.on('error', reject); r.end(corps);
    });

    await essayer('page', async () => {
        const p = await brut('GET', '/');
        const html = p.corps.toString('utf8');
        H.v('2. la page est servie, avec le jeton anti-falsification de CE démarrage', [p.statut, html.includes(`content="${S.csrf}"`), html.includes('__CSRF__')], [200, true, false]);
        H.v('2. en-têtes de sûreté : CSP sans script en ligne, no-store, nosniff', [/script-src 'self'/.test(p.entetes['content-security-policy']), !/script-src[^;]*unsafe-inline/.test(p.entetes['content-security-policy']), p.entetes['cache-control'], p.entetes['x-content-type-options']], [true, true, 'no-store', 'nosniff']);
        H.v('2. les scripts de la page sont servis (branchement et logique)', [(await brut('GET', '/app.js')).statut, (await brut('GET', '/controleur.js')).statut], [200, 200]);
        const etat = JSON.parse((await brut('GET', '/_etat')).corps.toString('utf8'));
        H.v('2. /_etat dit « un jeton est posé » sans le rendre', [etat.jeton, JSON.stringify(etat).includes(JETON)], [true, false]);
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'outils', 'banc-200', 'app.js'), 'utf8') + fs.readFileSync(path.join(__dirname, '..', '..', 'outils', 'banc-200', 'controleur.js'), 'utf8') + html;
        H.v('2. la page n\'utilise jamais innerHTML (tout passe par textContent)', /innerHTML|insertAdjacentHTML|document\.write|eval\(/.test(src), false);
    });

    await essayer('relais', async () => {
        recus.length = 0;
        let r = await brut('GET', '/api/banc/seau/courant');
        H.v('3. GET relayé avec le jeton en Bearer vers l\'API (et lui seule)', [r.statut, recus[0].auth, recus[0].url], [200, `Bearer ${JETON}`, '/api/banc/seau/courant']);
        r = await brut('GET', '/api/banc/seau/a-etiqueter?seau=0123456789abcdef');
        H.v('3. la requête d\'identifiants est relayée', recus[1].url, '/api/banc/seau/a-etiqueter?seau=0123456789abcdef');
        r = await brut('GET', '/api/banc/seau/photo?scanId=0123456789abcdef01234567&photo=0');
        H.v('3. une photo passe octet pour octet (type image), sans cookie ni en-tête de l\'API', [r.statut, r.entetes['content-type'], Buffer.compare(r.corps, octetsPhoto) === 0, r.entetes['set-cookie']], [200, 'image/jpeg', true, undefined]);
        r = await brut('POST', '/api/banc/seau/verite', { csrf: S.csrf, corps: JSON.stringify({ scanId: 'a'.repeat(24), idProduct: 1, via: 'url' }) });
        H.v('3. POST relayé avec son corps JSON', [r.statut, JSON.parse(recus[recus.length - 1].corps).idProduct, recus[recus.length - 1].type], [200, 1, 'application/json']);
        r = await brut('POST', '/api/banc/resoudre-cardmarket', { csrf: S.csrf, corps: JSON.stringify({ url: 'https://www.cardmarket.com/fr/Pokemon/Products/Singles/X/Y' }) });
        H.v('3. la résolution d\'adresse est relayée à l\'API (jamais chargée par ce serveur)', [r.statut, recus[recus.length - 1].url], [200, '/api/banc/resoudre-cardmarket']);
        // ce qui n'est pas dans la liste fermée
        for (const [m, c] of [['POST', '/api/identifier'], ['POST', '/api/banc/seau/declarer'], ['POST', '/api/banc/seau/sceller'], ['POST', '/api/banc/seau/photo'], ['DELETE', '/api/banc/contributions'], ['GET', '/api/banc/etiquette'], ['GET', '/ping'], ['GET', '/..%2f..%2fetc'], ['PUT', '/api/banc/seau/verite'], ['GET', '/api/banc/seau/verite']]) {
            const avant = recus.length;
            const x = await brut(m, c, { csrf: S.csrf, corps: m === 'GET' ? undefined : '{}' });
            H.v(`3. ${m} ${c} : non relayé (404), l'API n'est pas touchée`, [x.statut, recus.length === avant], [404, true]);
        }
        H.v('3. la liste fermée est exactement celle qui est écrite', RELAIS.length, 7);
        const avantQ = recus.length;
        H.v('3. une chaîne de requête hors des caractères d\'identifiant : 400, rien relayé', [(await brut('GET', '/api/banc/seau/photo?scanId=../../x%00&photo=0')).statut, recus.length === avantQ], [400, true]);
        H.v('3. un corps qui n\'est pas du JSON : 400, rien relayé', [(await brut('POST', '/api/banc/seau/verite', { csrf: S.csrf, corps: '{pas du json' })).statut, recus.length === avantQ], [400, true]);
        H.v('3. un corps démesuré : 413, rien relayé', [(await brut('POST', '/api/banc/seau/verite', { csrf: S.csrf, corps: JSON.stringify({ x: 'a'.repeat(20000) }) })).statut, recus.length === avantQ], [413, true]);
    });

    await essayer('garde de l\'appelant', async () => {
        const avant = recus.length;
        H.v('4. une écriture sans jeton anti-falsification : 403', (await brut('POST', '/api/banc/seau/verite', { corps: '{}' })).statut, 403);
        H.v('4. une écriture avec un faux jeton : 403', (await brut('POST', '/api/banc/seau/verite', { csrf: 'x'.repeat(48), corps: '{}' })).statut, 403);
        H.v('4. un Host étranger (rebond DNS) : 403, même en lecture', (await brut('GET', '/api/banc/seau/courant', { host: `evil.example:${port}` })).statut, 403);
        H.v('4. un Host sans port : 403', (await brut('GET', '/', { host: '127.0.0.1' })).statut, 403);
        H.v('4. une Origin étrangère : 403', (await brut('POST', '/api/banc/seau/verite', { csrf: S.csrf, origin: 'https://evil.example', corps: '{}' })).statut, 403);
        H.v('4. 🔑 un navigateur qui dit « cross-site » (page tierce chargeant une photo avec notre jeton) : 403, même en GET', [(await brut('GET', '/api/banc/seau/photo?scanId=0123456789abcdef01234567&photo=0', { site: 'cross-site' })).statut, (await brut('GET', '/api/banc/seau/courant', { site: 'same-site' })).statut], [403, 403]);
        H.v('4. same-origin (la page elle-même) : accepté', (await brut('GET', '/api/banc/seau/courant', { site: 'same-origin' })).statut, 200);
        H.v('4. l\'Origin de la page : acceptée', (await brut('GET', '/api/banc/seau/courant', { origin: `http://127.0.0.1:${port}` })).statut, 200);
        H.v('4. rien de tout cela n\'a touché l\'API (deux seules requêtes relayées : les deux acceptées)', recus.length - avant, 2);
    });

    await essayer('le jeton', async () => {
        // sans jeton : le relais refuse AVANT de contacter l'API
        const S2 = creerServeur({ apiBase: apiUrl, jeton: null });
        const l2 = await S2.ecouter(0);
        const avant = recus.length;
        const r = await fetch(`${l2.url}api/banc/seau/courant`, {});
        H.v('5. sans jeton posé : 401, l\'API n\'est pas contactée', [r.status, recus.length === avant], [401, true]);
        const e = await (await fetch(`${l2.url}_etat`)).json();
        H.v('5. /_etat : jeton faux', e.jeton, false);
        const refus = await fetch(`${l2.url}_session`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jeton: 'abcdefghijkl' }) });
        H.v('5. poser un jeton sans le jeton anti-falsification : 403', refus.status, 403);
        const html = await (await fetch(l2.url)).text();
        const csrf2 = /name="rm-csrf" content="([0-9a-f]+)"/.exec(html)[1];
        for (const mauvais of ['court', 'a b c d e f g h', 'x'.repeat(300)]) H.v(`5. jeton mal formé refusé (${mauvais.length} car.)`, (await fetch(`${l2.url}_session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rm-csrf': csrf2 }, body: JSON.stringify({ jeton: mauvais }) })).status, 400);
        const ok = await fetch(`${l2.url}_session`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-rm-csrf': csrf2 }, body: JSON.stringify({ jeton: 'jeton-saisi-dans-la-page' }) });
        const corpsOk = await ok.text();
        H.v('5. poser le jeton depuis la page : 200, et la réponse ne le rend pas', [ok.status, corpsOk.includes('jeton-saisi-dans-la-page')], [200, false]);
        await fetch(`${l2.url}api/banc/seau/courant`);
        H.v('5. le jeton posé part en Bearer vers l\'API', recus[recus.length - 1].auth, 'Bearer jeton-saisi-dans-la-page');
        await S2.fermer();
        // le jeton ne vit nulle part dans le code
        const sources = ['serveur.js', 'app.js', 'page.html'].map(f => fs.readFileSync(path.join(__dirname, '..', '..', 'outils', 'banc-200', f), 'utf8')).join('\n');
        H.v('5. aucun secret écrit dans les sources de la page (jeton, URI, clé)', /Bearer [A-Za-z0-9]{16,}|mongodb(\+srv)?:\/\/|sk_(live|test)_|eyJ[A-Za-z0-9_-]{10,}\./.test(sources), false);
        const consoles = sources.split('\n').filter(l => /console\./.test(l));
        H.v('5. le jeton n\'est jamais journalisé (aucun console.* ne cite jetonAcces, et RM_BANC_JETON n\'y paraît que testé, jamais lu)', consoles.some(l => /jetonAcces/.test(l) || (/RM_BANC_JETON/.test(l) && !/RM_BANC_JETON \?/.test(l))), false);
    });

    await S.fermer(); await new Promise(r => api.close(r));
    H.bilan();
    process.exit(process.exitCode || 0);
})().catch(e => { console.error('❌', e); process.exit(1); });
