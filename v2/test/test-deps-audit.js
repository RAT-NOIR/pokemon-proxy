'use strict';
// AUDIT DES DEPENDANCES (v2-audit-deps) : planchers de version des cinq paquets de `npm audit`, et comportement de la chaine reelle
// express.json() -> gestionnaire d'erreurs, sans base ni reseau (aucun harnais : ni dotenv, ni mongoose, aucun fichier hors node_modules).
//   - PLANCHERS : body-parser >= 1.20.9, qs >= 6.16.1, proxy-addr >= 2.0.8, ip-address >= 10.7.4, follow-redirects >= 1.16.2 (les versions corrigees des avis).
//     Rouge sur l'arbre d'avant (RM_DEPS_RACINE=<racine d'un arbre portant les anciennes versions>).
//   - GHSA-27r3-jxmh-p828 (octets apres un corps compresse) : le scenario est REJOUE (gzip/deflate + octets finaux, en un ou deux morceaux, y compris 2 Mo) ;
//     l'assertion porte sur ce que le cas redoute n'a pas : aucune exception non capturee, une reponse bornee, le serveur vivant ensuite.
//     ⚠️ Sur Node 24 le scenario ne tue PAS body-parser 1.20.6 (mesure faite) : ce banc est vert sur l'ancienne version pour cette partie ; seul le plancher est rouge.
//   - COMPORTEMENT : 413 au-dela de la limite (corps clair ET corps compresse gonfle), 400 sur JSON invalide, req.ip derriere `trust proxy` = 1 (un en-tete forge ne passe pas),
//     requete `?a[]=1&a[]=2` et `?a=1,2` analysee comme avant.
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const RACINE = process.env.RM_DEPS_RACINE || path.join(__dirname, '..', '..');
const dep = nom => path.join(RACINE, 'node_modules', nom);
const express = require(dep('express'));

let ok = 0, ko = 0;
const v = (nom, obtenu, attendu) => {
    const bon = JSON.stringify(obtenu) === JSON.stringify(attendu);
    console.log(`${bon ? 'OK ' : 'KO '} ${nom} : ${JSON.stringify(obtenu)}${bon ? '' : ` (attendu ${JSON.stringify(attendu)})`}`);
    bon ? ok++ : ko++;
};
const nonCapturees = [];
process.on('uncaughtException', e => { nonCapturees.push(`${e && e.code} ${e && e.message}`); });

const cmp = (a, b) => { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1; } return 0; };
const version = nom => require(path.join(dep(nom), 'package.json')).version;

function requete(port, { methode = 'POST', chemin = '/x', entetes = {}, morceaux = [], pauseMs = 80 }) {
    return new Promise(resolve => {
        const t0 = Date.now(); let fini = false;
        const fin = r => { if (!fini) { fini = true; clearTimeout(garde); resolve({ ...r, ms: Date.now() - t0 }); } };
        const garde = setTimeout(() => { fin({ statut: 'SANS-REPONSE' }); req.destroy(); }, 6000);
        const req = http.request({ port, path: chemin, method: methode, headers: entetes }, res => {
            let d = ''; res.on('data', c => d += c); res.on('end', () => { let j = null; try { j = JSON.parse(d); } catch { /* non JSON */ } fin({ statut: res.statusCode, json: j }); });
        });
        req.on('error', e => fin({ statut: `ERR ${e.code}` }));
        (async () => {
            for (let i = 0; i < morceaux.length; i++) { if (i) await new Promise(r => setTimeout(r, pauseMs)); if (!req.destroyed) req.write(morceaux[i]); }
            req.end();
        })();
    });
}

(async () => {
    // ── planchers
    for (const [nom, plancher] of [['body-parser', '1.20.9'], ['qs', '6.16.1'], ['proxy-addr', '2.0.8'], ['ip-address', '10.7.4'], ['follow-redirects', '1.16.2']]) {
        const inst = version(nom);
        v(`plancher ${nom} >= ${plancher} (installe ${inst})`, cmp(inst, plancher) >= 0, true);
    }

    // ── la chaine : express.json() (limite 100 Ko par defaut, comme index.js:187), sans route d'ecoute autre que /x et /ip, /q
    const app = express();
    app.set('trust proxy', 1); // comme index.js:114
    app.use(express.json());
    app.post('/x', (q, s) => s.json({ ok: true, body: q.body }));
    app.get('/ip', (q, s) => s.json({ ip: q.ip, ips: q.ips }));
    app.get('/q', (q, s) => s.json({ query: q.query }));
    app.use((e, q, s, n) => s.status(e.status || 500).json({ err: e.type || e.message }));
    const srv = await new Promise(r => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
    const port = srv.address().port;
    const json = '{"a":1}';
    const enc = (e, b) => ({ 'content-type': 'application/json', 'content-encoding': e, 'transfer-encoding': 'chunked', ...b });

    // ── scenario de l'avis : octets finaux apres un corps compresse
    const gz = zlib.gzipSync(json), df = zlib.deflateSync(json);
    const scenarios = [
        ['gzip + octets en 2 morceaux', 'gzip', [gz, Buffer.from('junkjunkjunk')]],
        ['gzip + zeros', 'gzip', [gz, Buffer.alloc(64)]],
        ['gzip + 2 Mo de zeros', 'gzip', [gz, Buffer.alloc(2 * 1024 * 1024)]],
        ['gzip + debut d\'un second membre invalide', 'gzip', [gz, Buffer.from([0x1f, 0x8b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])]],
        ['deflate + octets en 2 morceaux', 'deflate', [df, Buffer.from('junkjunkjunk')]],
        ['deflate + 2 Mo', 'deflate', [df, Buffer.alloc(2 * 1024 * 1024, 0x41)]],
        ['deflate + en-tete zlib invalide', 'deflate', [Buffer.concat([df, Buffer.from([0x78, 0x01])]), Buffer.alloc(8)]],
    ];
    for (const [nom, e, morceaux] of scenarios) {
        const r = await requete(port, { entetes: enc(e, {}), morceaux });
        v(`avis 27r3 : ${nom} -> reponse bornee (200 ou 400)`, [200, 400].includes(r.statut), true);
        v(`avis 27r3 : ${nom} -> aucune exception non capturee`, nonCapturees.length, 0);
    }
    const apres = await requete(port, { entetes: { 'content-type': 'application/json' }, morceaux: [Buffer.from(json)] });
    v('apres les scenarios : le serveur repond encore (200, corps lu)', [apres.statut, apres.json && apres.json.body], [200, { a: 1 }]);

    // ── comportement : limites et erreurs
    const gros = Buffer.from(JSON.stringify({ x: 'a'.repeat(120 * 1024) }));
    const r413 = await requete(port, { entetes: { 'content-type': 'application/json', 'content-length': gros.length }, morceaux: [gros] });
    v('corps clair de 120 Ko -> 413', [r413.statut, r413.json && r413.json.err], [413, 'entity.too.large']);
    const gonfle = zlib.gzipSync(gros);
    const r413g = await requete(port, { entetes: enc('gzip', {}), morceaux: [gonfle] });
    v('corps gzip de 120 Ko gonfles -> 413', [r413g.statut, r413g.json && r413g.json.err], [413, 'entity.too.large']);
    const r400 = await requete(port, { entetes: { 'content-type': 'application/json' }, morceaux: [Buffer.from('{"a":')] });
    v('JSON invalide -> 400', [r400.statut, r400.json && r400.json.err], [400, 'entity.parse.failed']);
    const r415 = await requete(port, { entetes: { 'content-type': 'application/json', 'content-encoding': 'br' }, morceaux: [Buffer.from(json)] });
    v('Content-Encoding inconnu -> 415', r415.statut, 415);

    // ── req.ip derriere trust proxy = 1 : un seul saut est cru, l'en-tete forge n'est pas l'IP du client
    const ip = await requete(port, { methode: 'GET', chemin: '/ip', entetes: { 'x-forwarded-for': '9.9.9.9, 5.6.7.8' } });
    v('req.ip = dernier saut ajoute par le proxy (5.6.7.8), pas la valeur forgee 9.9.9.9', ip.json && ip.json.ip, '5.6.7.8');
    const ipSans = await requete(port, { methode: 'GET', chemin: '/ip' });
    v('sans X-Forwarded-For : req.ip = adresse du socket', ipSans.json && ipSans.json.ip, '::ffff:127.0.0.1');

    // ── qs : analyse des requetes
    const q1 = await requete(port, { methode: 'GET', chemin: '/q?a[]=1&a[]=2&b[c]=3' });
    v('qs : a[]=1&a[]=2&b[c]=3', q1.json && q1.json.query, { a: ['1', '2'], b: { c: '3' } });
    const q2 = await requete(port, { methode: 'GET', chemin: '/q?a=1,2' });
    v('qs : a=1,2 reste une chaine (pas de decoupage sur la virgule)', q2.json && q2.json.query, { a: '1,2' });
    const q3 = await requete(port, { methode: 'GET', chemin: '/q?__proto__[x]=1&a[__proto__]=2' });
    v('qs : __proto__ ignore', [Object.prototype.x, q3.json && q3.json.query && q3.json.query.x], [undefined, undefined]);

    srv.close();
    console.log(`\n${ok} reussis, ${ko} echoues`);
    process.exit(ko ? 1 : 0);
})().catch(e => { console.log('ERREUR DU BANC', e && e.stack); process.exit(1); });
