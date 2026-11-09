'use strict';
// AUDIT DES DEPENDANCES (v2-audit-deps, tour 1 de correction) : express / body-parser / qs / proxy-addr / ip-address / follow-redirects, EN L'ETAT OU ILS SONT CHARGES.
// Sans base ni dotenv ni harnais (aucun fichier lu hors du dépôt : package.json de chaque paquet résolu, v2/index.js pour `requeteRefusee`, test-deps-audit.requetes.json).
// RM_DEPS_RACINE=<racine d'un arbre portant les anciennes versions> rejoue le banc sur cet arbre (c'est ainsi que le rouge est vu) ; RM_DEPS_DUMP=1 imprime le tableau des requêtes.
//
//  A. VERSIONS RÉSOLUES ET CHARGÉES (D5) : pour chacun des cinq paquets, le fichier résolu DEPUIS SON CONSOMMATEUR (express, express-rate-limit, axios), puis chargé (require.cache),
//     et toute copie chargée (une copie imbriquée compte) est au moins à la version corrigée. package.json du dépôt n'est pas la preuve : node_modules l'est.
//  B. CORPS COMPRESSÉS (D1, D2, D4) : les 4 analyseurs de corps réels du serveur — express.json() (index.js:187), express.json({limit:'2400kb'}) (index.js:172),
//     express.raw({type:'application/json'}) (index.js:164) et la route RÉELLE v2/abonnements/webhook.js:173 (express.raw({type:()=>true, limit:'256kb'})) — reçoivent gzip et deflate
//     (inflate:true par défaut) : écriture TCP unique, deux morceaux, octets finaux, zéros, dépassement de limite + octets, charset inconnu, flot de 32 Mo, abandon en cours de corps, keep-alive.
//     Les exceptions non capturées se lisent APRÈS la fermeture réelle du socket + 300 ms, jamais à la réponse (D4).
//     🔑 LE ROUGE ne vient PAS d'un plantage (le scénario de l'avis GHSA-27r3-jxmh-p828 ne tue pas 1.20.6, ni sous Node 22.23.3 ni sous 24 : mesuré) mais de l'ÉTAT que le correctif change :
//     une fois la réponse partie, le décodeur gzip/deflate est DÉTRUIT et la requête n'y est plus reliée (body-parser 1.20.9, read.js). En 1.20.6 il reste relié (octets finaux, zéros)
//     ou vivant (corps seul) : c'est la précondition SUPPOSÉE de l'avis (le texte de l'avis n'a pas été lu), avec un seul écouteur d'erreur (celui de pipe). Ces assertions d'état DÉCRIVENT 1.20.9 :
//     elles ne prouvent pas que la faille est fermée. De même (D3), les options des quatre limiteurs sont des copies : elles ne sont pas verrouillées sur index.js.
//  C. req.ip DERRIÈRE `trust proxy` = 1 (index.js:114) et les QUATRE limiteurs d'index.js (limiteurIA l.224, limiteurApprentissage l.243, limiteurLot l.254, limiteurRetourLive l.265, mêmes options
//     que le fichier, max réduit à 3) : clé = dernier saut de X-Forwarded-For (celui qu'ajoute le proxy de Render), les valeurs forgées à gauche sont ignorées, une IPv6 se regroupe par /56 (ip-address).
//  D. REQUÊTES (D6) : ce que l'analyseur de requête d'Express (qs, allowPrototypes) rend pour 53 formes, et le verdict de `requeteRefusee` (v2/index.js:68), par la vraie chaîne HTTP.
const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const zlib = require('zlib');
const RACINE = process.env.RM_DEPS_RACINE || path.join(__dirname, '..', '..');
const dep = nom => path.join(RACINE, 'node_modules', nom);

// Le décodeur créé pour chaque corps compressé est capturé AVANT le chargement d'Express (observation seule : le flux rendu est le vrai).
const decodeurs = [];
for (const nom of ['createGunzip', 'createInflate']) {
    const o = zlib[nom];
    Object.defineProperty(zlib, nom, { value: function (...a) { const s = o.apply(this, a); decodeurs.push(s); return s; }, configurable: true, writable: true, enumerable: true });
}
const express = require(dep('express'));

let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? 'OK ' : 'KO '} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
};
const attendre = ms => new Promise(r => setTimeout(r, ms));
const nonCapturees = [];
process.on('uncaughtException', e => { nonCapturees.push(`${e && e.code} ${e && e.message}`); });
process.on('unhandledRejection', e => { nonCapturees.push(`rejet ${e && e.message}`); });

// ── A. versions résolues et chargées
const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; } return 0; };
function racinePaquet(fichier, nom) {
    for (let d = path.dirname(fichier); ; d = path.dirname(d)) {
        const pj = path.join(d, 'package.json');
        if (fs.existsSync(pj)) { const j = JSON.parse(fs.readFileSync(pj, 'utf8')); if (j.name === nom) return { dir: d, version: j.version }; }
        if (path.dirname(d) === d) return null;
    }
}
const resoudreDepuis = (nom, consommateur) => require.resolve(nom, { paths: [path.dirname(require.resolve(dep(consommateur)))] });
const PLANCHERS = [['body-parser', 'express', '1.20.9'], ['qs', 'express', '6.16.1'], ['proxy-addr', 'express', '2.0.8'], ['ip-address', 'express-rate-limit', '10.7.4'], ['follow-redirects', 'axios', '1.16.2']];

const requeteBrute = (port, texte, { finMs = 3000, apres = null } = {}) => new Promise(resolve => {
    const t0 = Date.now(); const c = net.connect(port, '127.0.0.1'); const morceaux = [];
    let fini = false; const fin = () => { if (!fini) { fini = true; clearTimeout(g); resolve({ brut: Buffer.concat(morceaux).toString('latin1'), ms: Date.now() - t0, c }); } };
    const g = setTimeout(() => { c.destroy(); fin(); }, finMs);
    c.on('data', d => morceaux.push(d)); c.on('error', () => {}); c.on('close', fin);
    c.on('connect', () => { if (apres) apres(c); else c.write(texte); });
});
const statut = brut => { const m = /^HTTP\/1\.1 (\d{3})/.exec(brut); return m ? Number(m[1]) : (brut ? 'ILLISIBLE' : 'AUCUNE REPONSE'); };
const corpsJson = brut => { const i = brut.indexOf('\r\n\r\n'); if (i < 0) return null; try { return JSON.parse(brut.slice(i + 4)); } catch { return null; } };
const chunk = b => Buffer.concat([Buffer.from(b.length.toString(16) + '\r\n'), b, Buffer.from('\r\n')]);
const fermer = async res => { if (!res.c.destroyed) res.c.destroy(); await attendre(300); };   // D4 : fin RÉELLE = socket fermé, puis 300 ms

(async () => {
    console.log(`Node ${process.version} ; arbre ${RACINE}`);
    const axios = require(dep('axios'));
    const rl = require(dep('express-rate-limit'));
    const cle6 = rl.ipKeyGenerator('2001:db8:aaaa:bb00::1');
    const chargees = Object.keys(require.cache);
    v('ipKeyGenerator charge ip-address et regroupe une IPv6 par /56', cle6, '2001:db8:aaaa:bb00::/56');
    v('axios chargé (suit les redirections par follow-redirects)', typeof axios.get, 'function');
    for (const [nom, consommateur, plancher] of PLANCHERS) {
        const resolu = resoudreDepuis(nom, consommateur);
        const r = racinePaquet(resolu, nom);
        const copies = chargees.filter(f => f.includes(`${path.sep}node_modules${path.sep}${nom}${path.sep}`)).map(f => racinePaquet(f, nom)).filter(Boolean);
        const distinctes = [...new Map(copies.map(c => [c.dir, c])).values()];
        v(`${nom} résolu depuis ${consommateur} >= ${plancher} (${r && r.version})`, Boolean(r) && cmp(r.version, plancher) >= 0, true);
        v(`${nom} : ${distinctes.length} copie(s) CHARGÉE(S), toutes >= ${plancher} (${distinctes.map(c => c.version).join(', ')})`, distinctes.length >= 1 && distinctes.every(c => cmp(c.version, plancher) >= 0), true);
        v(`${nom} : la copie résolue est une copie chargée`, distinctes.some(c => r && c.dir === r.dir), true);
    }

    // ── B. le serveur : les analyseurs de corps du serveur réel
    const app = express();
    app.set('trust proxy', 1);                                                                              // index.js:114
    let derniere = null;
    app.use((q, s, n) => { s.on('finish', () => { const p = q._readableState.pipes; const d = decodeurs[decodeurs.length - 1]; derniere = { pipesReq: Array.isArray(p) ? p.length : (p ? 1 : 0), detruit: d ? d.destroyed : null }; }); n(); });
    app.post('/json', express.json(), (q, s) => s.json({ ok: 1 }));                                         // index.js:187
    app.post('/json-grand', express.json({ limit: '2400kb' }), (q, s) => s.json({ ok: 1 }));                // index.js:172
    app.post('/raw', express.raw({ type: 'application/json' }), (q, s) => s.json({ ok: 1 }));               // index.js:164
    // webhook.js:173, la route RÉELLE (503 : configuration inactive, APRÈS l'analyseur de corps). Sur l'arbre du dépôt, un chargement qui échoue LÈVE (le banc s'arrête) : aucun repli silencieux.
    // La copie de la ligne 173 est réservée au rejeu sur un ancien arbre (RM_DEPS_RACINE), parce que webhook.js charge l'express du dépôt, pas celui de l'arbre rejoué.
    const arbreDuDepot = RACINE === path.join(__dirname, '..', '..');
    let webhookReel = false;
    if (arbreDuDepot) { require('../abonnements/webhook').monterWebhook(app, () => ({ actif: false }), '/webhook'); webhookReel = true; }
    else { app.post('/webhook', express.raw({ type: () => true, limit: '256kb' }), (q, s) => s.status(503).json({ recu: false })); console.log('(arbre de rejeu : la route webhook est la copie de la ligne 173)'); }
    v('route webhook : la route RÉELLE (monterWebhook) sur l\'arbre du dépôt, la copie seulement sur un arbre de rejeu', webhookReel, arbreDuDepot);
    app.get('/ip', (q, s) => s.json({ ip: q.ip, ips: q.ips }));
    const { requeteRefusee } = require('../index');                                                         // v2/index.js:68, la vraie fonction
    app.get('/q', (q, s) => { let refus; try { refus = requeteRefusee(q.query); } catch (e) { refus = `THROW ${e.message}`; } s.json({ query: q.query, refus }); });
    // les quatre limiteurs d'index.js, mêmes options (max réduit à 3)
    const opt = (extra = {}) => ({ windowMs: 60 * 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false, ...extra });
    const limiteurs = {
        '/ia': rl.rateLimit(opt({ message: { success: false, error: 'Trop de requêtes, réessaie plus tard.' } })),                                            // index.js:224
        '/apprentissage': rl.rateLimit(opt({ message: { success: false, error: 'Trop de requêtes d\'apprentissage, réessaie plus tard.' } })),            // index.js:243
        '/lot': rl.rateLimit(opt({ handler: (q, s, n) => { q.enFileServeur = true; n(); } })),                                                              // index.js:254
        '/retour': rl.rateLimit(opt({ message: { success: false, error: 'Trop de retours de prix, réessaie plus tard.' } })),                              // index.js:265
    };
    for (const [chemin, l] of Object.entries(limiteurs)) app.get(chemin, l, (q, s) => s.json({ ok: 1, enFile: q.enFileServeur === true, ip: q.ip }));
    app.use((e, q, s, n) => s.status(e.status || 500).json({ err: e.type || e.message }));
    const srv = http.createServer(app);
    let dernierSocket = null; srv.on('connection', s => { dernierSocket = s; });
    await new Promise(r => srv.listen(0, '127.0.0.1', r)); const port = srv.address().port;

    const J = '{"a":1}';
    const gz = zlib.gzipSync(J), df = zlib.deflateSync(J);
    const gros = Buffer.from(JSON.stringify({ x: 'a'.repeat(300000) })), grosGz = zlib.gzipSync(gros), grosDf = zlib.deflateSync(gros);
    const junk = Buffer.from('junkjunkjunk');
    const entete = (route, enc, extra = '') => `POST ${route} HTTP/1.1\r\nHost: x\r\nContent-Type: application/json${extra}\r\n${enc === 'identity' ? '' : `Content-Encoding: ${enc}\r\n`}Connection: close\r\n`;
    const unique = (route, enc, corps, extra) => Buffer.concat([Buffer.from(`${entete(route, enc, extra)}Content-Length: ${corps.length}\r\n\r\n`), corps]);
    const ROUTES = [['/json', 'json (index.js:187)'], ['/json-grand', 'json 2400kb (index.js:172)'], ['/raw', 'raw application/json (index.js:164)'], ['/webhook', `webhook ${webhookReel ? 'RÉEL' : 'copie'} (webhook.js:173)`]];
    const reponseOk = { '/json': 200, '/json-grand': 200, '/raw': 200, '/webhook': 503 };

    for (const [route, lib] of ROUTES) {
        for (const [enc, ok1, groB] of [['gzip', gz, grosGz], ['deflate', df, grosDf]]) {
            const cas = [
                ['corps seul', unique(route, enc, ok1), [reponseOk[route]], true],
                ['corps + zéros', unique(route, enc, Buffer.concat([ok1, Buffer.alloc(100)])), [reponseOk[route]], true],
                ['corps + octets (écriture TCP unique)', unique(route, enc, Buffer.concat([ok1, junk])), enc === 'gzip' ? [400] : [reponseOk[route]], enc === 'deflate'],
                ['dépasse la limite (300 Ko décompressés) + octets', unique(route, enc, Buffer.concat([groB, junk])), route === '/json-grand' ? (enc === 'gzip' ? [400] : [reponseOk[route]]) : [413], false],   // 2400 Ko : 300 Ko passent ; les octets finaux font échouer le gzip
                ['charset inconnu, corps valide', unique(route, enc, ok1, '; charset=bogus'), route === '/raw' || route === '/webhook' ? [reponseOk[route]] : [415], false],
            ];
            for (const [nom, requete, statuts, etat] of cas) {
                derniere = null; const avant = nonCapturees.length;
                const res = await requeteBrute(port, requete);
                await fermer(res);
                const s = statut(res.brut);
                v(`${lib} ${enc} ${nom} -> ${statuts.join('|')} (obtenu ${s})`, statuts.includes(s), true);
                v(`${lib} ${enc} ${nom} : aucune exception non capturée (lu 300 ms après la fermeture du socket)`, nonCapturees.slice(avant), []);
                if (etat) v(`${lib} ${enc} ${nom} : décodeur détruit et requête détachée à la fin de la réponse (état de body-parser 1.20.9)`, derniere, { pipesReq: 0, detruit: true });
            }
            {   // deux morceaux : le corps, puis les octets 100 ms plus tard (chunked)
                const avant = nonCapturees.length;
                const res = await requeteBrute(port, null, { apres: c => { c.write(`${entete(route, enc)}Transfer-Encoding: chunked\r\n\r\n`); c.write(chunk(ok1)); setTimeout(() => c.write(Buffer.concat([chunk(junk), Buffer.from('0\r\n\r\n')])), 100); } });
                await fermer(res);
                const s = statut(res.brut);
                v(`${lib} ${enc} deux morceaux (corps puis octets à 100 ms) -> réponse bornée (obtenu ${s})`, [reponseOk[route], 400].includes(s), true);
                v(`${lib} ${enc} deux morceaux : aucune exception non capturée`, nonCapturees.slice(avant), []);
            }
            {   // abandon en cours de corps (RST)
                const avant = nonCapturees.length;
                const res = await requeteBrute(port, null, { finMs: 600, apres: c => { c.write(`${entete(route, enc)}Transfer-Encoding: chunked\r\n\r\n`); c.write(chunk(ok1.subarray(0, 4))); setTimeout(() => (c.resetAndDestroy ? c.resetAndDestroy() : c.destroy()), 100); } });
                await fermer(res);
                v(`${lib} ${enc} abandon (RST) en cours de corps : aucune exception non capturée`, nonCapturees.slice(avant), []);
            }
        }
    }
    // flot de 32 Mo après un corps deflate complet : la requête est consommée jusqu'au bout, la réponse part
    for (const [route, lib] of [ROUTES[0], ROUTES[2]]) {
        const avant = nonCapturees.length; const total = 32 * 1024 * 1024;
        const res = await requeteBrute(port, null, { finMs: 4000, apres: c => {             // sans « Connection: close » : un serveur qui ferme avec un corps non lu fait perdre la réponse au client (RST), quelle que soit la version
            c.write(`${entete(route, 'deflate').replace('Connection: close\r\n', '')}Transfer-Encoding: chunked\r\n\r\n`); c.write(chunk(df));
            const bloc = chunk(Buffer.alloc(65536, 0x41)); let ecrit = 0;
            const pomper = () => { while (ecrit < total) { const o = c.write(bloc); ecrit += 65536; if (!o) return c.once('drain', pomper); } c.write('0\r\n\r\n'); };
            setTimeout(pomper, 100);
        } });
        const lu = dernierSocket ? dernierSocket.bytesRead : -1;
        await fermer(res);
        v(`${lib} deflate + flot de 32 Mo : réponse ${reponseOk[route]} et la requête est lue jusqu'au bout`, [statut(res.brut), lu >= total], [reponseOk[route], true]);
        v(`${lib} deflate + flot de 32 Mo : aucune exception non capturée`, nonCapturees.slice(avant), []);
    }
    // keep-alive : une requête compressée avec zéros finaux, puis une seconde sur le MÊME socket (ou socket fermé proprement), puis une troisième sur un socket neuf
    for (const enc of ['gzip', 'deflate']) {
        const avant = nonCapturees.length; const corps = Buffer.concat([enc === 'gzip' ? gz : df, Buffer.alloc(20)]);
        const r1 = `POST /json HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Encoding: ${enc}\r\nContent-Length: ${corps.length}\r\n\r\n`;
        const res = await requeteBrute(port, null, { finMs: 1500, apres: c => { c.write(Buffer.concat([Buffer.from(r1), corps])); setTimeout(() => c.write(`POST /json HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 7\r\nConnection: close\r\n\r\n${J}`), 300); } });
        const reponses = res.brut.split('HTTP/1.1 ').filter(Boolean).map(x => Number(x.slice(0, 3)));
        await fermer(res);
        v(`keep-alive ${enc} : première réponse 200, seconde (même socket) 200 ou socket fermé (obtenu ${reponses.join(',')})`, reponses[0] === 200 && (reponses.length === 1 || reponses[1] === 200), true);
        const neuf = await requeteBrute(port, unique('/json', 'identity', Buffer.from(J)));
        await fermer(neuf);
        v(`keep-alive ${enc} : un socket neuf est servi ensuite`, statut(neuf.brut), 200);
        v(`keep-alive ${enc} : aucune exception non capturée`, nonCapturees.slice(avant), []);
    }
    {   // limites et erreurs, sans compression
        const clair = Buffer.from(JSON.stringify({ x: 'a'.repeat(120 * 1024) }));
        const r = await requeteBrute(port, unique('/json', 'identity', clair)); await fermer(r);
        v('corps clair de 120 Ko -> 413', [statut(r.brut), (corpsJson(r.brut) || {}).err], [413, 'entity.too.large']);
        const r2 = await requeteBrute(port, unique('/json', 'identity', Buffer.from('{"a":'))); await fermer(r2);
        v('JSON invalide -> 400', [statut(r2.brut), (corpsJson(r2.brut) || {}).err], [400, 'entity.parse.failed']);
        const r3 = await requeteBrute(port, unique('/json', 'br', Buffer.from(J))); await fermer(r3);
        v('Content-Encoding inconnu -> 415', statut(r3.brut), 415);
    }
    v('à la fin des scénarios de corps : aucune exception non capturée', nonCapturees, []);

    // ── C. req.ip et les quatre limiteurs
    const get = async (chemin, xff) => { const r = await requeteBrute(port, `GET ${chemin} HTTP/1.1\r\nHost: x\r\n${xff ? `X-Forwarded-For: ${xff}\r\n` : ''}Connection: close\r\n\r\n`); await fermer(r); return { s: statut(r.brut), j: corpsJson(r.brut) }; };
    v('req.ip = dernier saut (5.6.7.8), pas la valeur forgée 9.9.9.9', (await get('/ip', '9.9.9.9, 5.6.7.8')).j.ip, '5.6.7.8');
    v('req.ip sans X-Forwarded-For = adresse du socket', (await get('/ip')).j.ip, '127.0.0.1');
    for (const [chemin, ligne] of [['/ia', 'index.js:224 limiteurIA'], ['/apprentissage', 'index.js:243 limiteurApprentissage'], ['/lot', 'index.js:254 limiteurLot'], ['/retour', 'index.js:265 limiteurRetourLive']]) {
        const etat = r => (chemin === '/lot' ? (r.j && r.j.enFile ? 'file' : r.s) : r.s);
        const serie = [];
        for (let i = 0; i < 4; i++) serie.push(etat(await get(chemin, `forge${i}.1.1.1, 5.6.7.8`)));
        v(`${ligne} : 4 requêtes aux X-Forwarded-For forgés différents, même dernier saut = UN compteur`, serie, chemin === '/lot' ? [200, 200, 200, 'file'] : [200, 200, 200, 429]);
        v(`${ligne} : un autre dernier saut ouvre un compteur neuf`, (await get(chemin, 'forge.1.1.1, 5.6.7.9')).s, 200);
        const v6 = [];
        for (let i = 0; i < 4; i++) v6.push(etat(await get(chemin, `x, 2001:db8:aaaa:bb00::${i + 1}`)));
        v(`${ligne} : IPv6 d'un même /56 = UN compteur`, v6, chemin === '/lot' ? [200, 200, 200, 'file'] : [200, 200, 200, 429]);
        v(`${ligne} : un autre /56 compte à part`, (await get(chemin, 'x, 2001:db8:aaaa:bc00::1')).s, 200);
    }

    // ── D. formes de requête, par la vraie chaîne HTTP
    const long = n => Array.from({ length: n }, (_, i) => i);
    const FORMES = [
        'a=1', 'a=1&a=2', 'a=1,2', 'a[]=1&a[]=2', 'a[0]=1&a[1]=2', 'a[]=1,2', 'a[]=', 'a=', '=1', 'a', 'a[b]=1', 'a[b][c]=1', 'a[b][c][d][e][f][g][h]=1',
        '__proto__[x]=1', 'a[__proto__][x]=1', 'constructor[prototype][x]=1', 'a[constructor]=1', 'a[isBuffer]=1', 'a[toString]=1', 'a[hasOwnProperty]=1', 'isBuffer=1',
        'a.b=1', '$ne=1', 'a[$ne]=1', 'a%5B%5D=1', 'a%5Bb%5D=1', 'a[=1', 'a]=1', 'a[b=1', '%ZZ=1', 'a=%ZZ', 'a=%E0%A4%A', 'a[1000]=1', 'a[101]=x', 'a[200]=x&a[]=y',
        `a=${long(150).join('&a=')}`, `a[]=${long(150).join('&a[]=')}`, long(30).map(i => `k${i}=v`).join('&'), long(1200).map(i => `k${i}=v`).join('&'),
        'a[b]=1&a=2', 'a=2&a[b]=1', 'a[]=1&a[b]=2', 'a=1&a[]=2', 'a[]=%20x', 'a+b=c+d', 'a=1;b=2', 'a[b][]=1', 'a[][b]=1', 'valueOf=1', '__defineGetter__=1', 'a%00=1', '%C3%A9=1', 'a=%C3%A9',
    ];
    const tableau = {};
    for (const f of FORMES) {
        const r = await requeteBrute(port, `GET /q?${f} HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n`); await fermer(r);
        const j = corpsJson(r.brut);
        const cle = f.length > 60 ? `${f.slice(0, 40)}...(${f.length} car.)` : f;
        const q = j && j.query ? JSON.stringify(j.query) : null;
        tableau[cle] = { statut: statut(r.brut), refus: j ? j.refus : null, nCles: j && j.query ? Object.keys(j.query).length : null, query: q && q.length > 100 ? `${q.slice(0, 60)}...(${q.length} car.)` : q };
    }
    if (process.env.RM_DEPS_DUMP) console.log(`DUMPJSON ${JSON.stringify(tableau)}`);
    let attendu = {};
    try { attendu = JSON.parse(fs.readFileSync(path.join(__dirname, 'test-deps-audit.requetes.json'), 'utf8')); } catch { /* le fichier manque : tous les cas échouent */ }
    const ecarts = Object.keys(tableau).filter(k => JSON.stringify(tableau[k]) !== JSON.stringify(attendu[k]));
    v(`requêtes : ${Object.keys(tableau).length} formes, chaque résultat (statut, verdict de requeteRefusee, forme analysée) égal au tableau mesuré sur l'ancien arbre ET le nouveau`, ecarts, []);
    v('requêtes : aucune forme ne répond autre chose que 200', Object.values(tableau).every(t => t.statut === 200), true);
    v('requêtes : Object.prototype non pollué', [Object.prototype.x, ({}).isBuffer, ({}).polluted], [undefined, undefined, undefined]);
    v('requêtes : `a[isBuffer]=1` répond 200 (avis qs isBuffer) et est refusé par requeteRefusee (objet imbriqué)', [tableau['a[isBuffer]=1'].statut, tableau['a[isBuffer]=1'].refus], [200, 'a']);

    await new Promise(r => srv.close(r));
    await attendre(300);
    v('après la fermeture du serveur : aucune exception non capturée', nonCapturees, []);
    console.log(`\n${ok} réussis, ${ko} échoués`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.log('ERREUR DU BANC', e && e.stack); process.exit(1); });
