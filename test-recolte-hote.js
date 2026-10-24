// Banc de collecte-cartes/recolte-hote.js — le client poli des deux récoltes (pokipair, tcgcsv). Aucune requête réelle, aucune base : faux transport.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const H = require('./collecte-cartes/recolte-hote');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${e.stack.split('\n').slice(0, 3).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rh-'));
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(40, 1)]);
const HOTES = { 'www.exemple.test': { chemin: /^\/(robots\.txt|sets\/[a-z0-9-]+|sitemap\.xml)$/ }, 'media.exemple.test': { chemin: /^\/(robots\.txt|\d{4}\/\d{2}\/[A-Za-z0-9_.-]+\.png)$/ } };
const base = (o = {}) => ({ racine: 'exemple.test', hotes: HOTES, dossierCache: tmp(), plafond: 10, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), ...o });
const html = t => ({ status: 200, type: 'text/html; charset=UTF-8', texte: t });
const robotsOk = { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /wp-admin/\n' };

(async () => {
    await test('une réponse en cache n\'est jamais redemandée ; le plafond est respecté', async () => {
        let appels = 0;
        const transport = { async get() { appels++; return html('<p>ok</p>'); } };
        const cli = H.fabriquerClient(base({ plafond: 2, transport, robots: { 'www.exemple.test': null } }));
        await cli.lire('https://www.exemple.test/sets/a');
        await cli.lire('https://www.exemple.test/sets/a');
        assert.strictEqual(appels, 1);
        await cli.lire('https://www.exemple.test/sets/b');
        await assert.rejects(() => cli.lire('https://www.exemple.test/sets/c'), /plafond/);
        assert.strictEqual(cli.requetes(), 2);
        assert.strictEqual(appels, 2);
    });
    await test('hôte étranger, chemin hors de la liste fermée, http : refusés sans requête', async () => {
        let appels = 0;
        const cli = H.fabriquerClient(base({ transport: { async get() { appels++; return html('x'); } }, robots: { 'www.exemple.test': null } }));
        await assert.rejects(() => cli.lire('https://www.autre.test/x'), /hôte|hors/);
        await assert.rejects(() => cli.lire('https://www.exemple.test/wp-json/x'), /hors|chemin/);
        await assert.rejects(() => cli.lire('http://www.exemple.test/sets/a'), /https|hors/);
        await assert.rejects(() => cli.lire('https://www.exemple.test.autre.test/sets/a'), /hôte|hors/);
        assert.strictEqual(appels, 0);
    });
    await test('robots.txt jamais lu pour l\'hôte : AUCUNE requête (la garde s\'écrit par ce qu\'elle autorise)', async () => {
        let appels = 0;
        const cli = H.fabriquerClient(base({ transport: { async get() { appels++; return html('x'); } } }));
        await assert.rejects(() => cli.lire('https://www.exemple.test/sets/a'), /robots/);
        assert.strictEqual(appels, 0);
    });
    await test('robots.txt interdit le chemin : refusé sans requête de plus', async () => {
        let appels = 0;
        const hotes = { 'www.exemple.test': { chemin: /^\/(robots\.txt|wp-admin\/x)$/ } };
        const cli = H.fabriquerClient(base({ hotes, transport: { async get() { appels++; return robotsOk; } } }));
        await cli.initialiserRobots('www.exemple.test');
        assert.strictEqual(appels, 1);
        await assert.rejects(() => cli.lire('https://www.exemple.test/wp-admin/x'), /robots/);
        assert.strictEqual(appels, 1);
    });
    await test('robots.txt 404 : aucune règle, l\'hôte est lisible ; il est noté « absent » ; robots 200 est mis en cache', async () => {
        let appels = 0;
        const transport = { async get(u) { appels++; return /robots/.test(u) ? { status: 404, type: 'text/html', texte: 'Not found' } : html('<p>ok</p>'); } };
        const cli = H.fabriquerClient(base({ transport }));
        const r = await cli.initialiserRobots('media.exemple.test');
        assert.strictEqual(r.statut, 'absent');
        await cli.lire('https://media.exemple.test/robots.txt').catch(() => {});
        assert.strictEqual(appels, 1, 'le 404 de robots.txt est lui aussi au cache');
        assert.strictEqual(cli.robotsDe('media.exemple.test').statut, 'absent');
    });
    await test('robots.txt 403 : ARRÊT DÉFINITIF de la racine, écrit ; plus aucune requête vers aucun hôte de la racine', async () => {
        const pauses = tmp(); let appels = 0;
        const transport = { async get() { appels++; return { status: 403, type: 'text/html', texte: '<h1>Forbidden</h1>' }; } };
        const cli = H.fabriquerClient(base({ transport, dossierPauses: pauses }));
        const e = await cli.initialiserRobots('www.exemple.test').catch(x => x);
        assert.ok(e && e.arretDefinitif, 'arrêt définitif attendu');
        assert.ok(fs.readdirSync(pauses).some(f => /^ARRET-HOTE-exemple\.test/.test(f)), 'le fichier d\'arrêt est écrit');
        await assert.rejects(() => cli.initialiserRobots('media.exemple.test'), /ARRÊT|BLOQU/i);
        assert.strictEqual(appels, 1);
    });
    await test('401, 410, 429 : arrêt définitif à la première réponse', async () => {
        for (const statut of [401, 410, 429]) {
            const pauses = tmp(); let appels = 0;
            const cli = H.fabriquerClient(base({ transport: { async get(u) { appels++; return /robots/.test(u) ? robotsOk : { status: statut, type: 'text/html', texte: 'non' }; } }, dossierPauses: pauses }));
            await cli.initialiserRobots('www.exemple.test');
            const e = await cli.lire('https://www.exemple.test/sets/a').catch(x => x);
            assert.ok(e.arretDefinitif, `statut ${statut}`);
            await assert.rejects(() => cli.lire('https://www.exemple.test/sets/b'), /ARRÊT|BLOQU/i);
            assert.strictEqual(appels, 2, `statut ${statut}`);
        }
    });
    await test('un défi dans une page 200 (captcha, Just a moment) : arrêt définitif', async () => {
        const pauses = tmp();
        const cli = H.fabriquerClient(base({ transport: { async get(u) { return /robots/.test(u) ? robotsOk : html('<title>Just a moment...</title>'); } }, dossierPauses: pauses }));
        await cli.initialiserRobots('www.exemple.test');
        const e = await cli.lire('https://www.exemple.test/sets/a').catch(x => x);
        assert.ok(e.arretDefinitif);
    });
    await test('un arrêt déjà écrit empêche toute requête, même d\'un client neuf', async () => {
        const pauses = tmp(); let appels = 0;
        require('./collecte-cartes/reponse-hote').arretHote('exemple.test', 'test', { dossier: pauses });
        const cli = H.fabriquerClient(base({ transport: { async get() { appels++; return robotsOk; } }, dossierPauses: pauses }));
        await assert.rejects(() => cli.initialiserRobots('www.exemple.test'), /ARRÊT/i);
        assert.strictEqual(appels, 0);
    });
    await test('cadence : au moins 5 s entre deux requêtes, même pour deux hôtes, même si on demande 0', async () => {
        const attentes = []; let t = 1000;
        const transport = { async get(u) { return /robots/.test(u) ? robotsOk : html('x'); } };
        const cli = H.fabriquerClient(base({ transport, cadenceMs: 0, pause: async ms => { attentes.push(ms); t += ms; }, now: () => t }));
        await cli.initialiserRobots('www.exemple.test');
        await cli.initialiserRobots('media.exemple.test');
        await cli.lire('https://www.exemple.test/sets/a');
        assert.ok(attentes.length === 2 && attentes.every(a => a >= 5000), JSON.stringify(attentes));
    });
    await test('Crawl-delay plus grand que la cadence : on s\'arrête, sans autre requête', async () => {
        const cli = H.fabriquerClient(base({ transport: { async get() { return { status: 200, type: 'text/plain', texte: 'User-agent: *\nCrawl-delay: 30\n' }; } } }));
        await assert.rejects(() => cli.initialiserRobots('www.exemple.test'), /Crawl-delay/);
    });
    await test('redirection : jamais suivie, jamais mise au cache — pause', async () => {
        let appels = 0;
        const transport = { async get(u) { appels++; return /robots/.test(u) ? robotsOk : { status: 301, location: 'https://www.autre.test/x', type: '' }; } };
        const cli = H.fabriquerClient(base({ transport }));
        await cli.initialiserRobots('www.exemple.test');
        await assert.rejects(() => cli.lire('https://www.exemple.test/sets/a'), /redirection|inattendu|non prévue/i);
        assert.strictEqual(appels, 2);
    });
    await test('5xx : transitoire (l\'appelant décide), rien au cache', async () => {
        const dossier = tmp();
        const cli = H.fabriquerClient(base({ dossierCache: dossier, transport: { async get(u) { return /robots/.test(u) ? robotsOk : { status: 503, type: 'text/html', texte: 'indisponible' }; } } }));
        await cli.initialiserRobots('www.exemple.test');
        const e = await cli.lire('https://www.exemple.test/sets/a').catch(x => x);
        assert.ok(e.transitoire && e.status === 503);
        assert.ok(!fs.readdirSync(dossier).some(f => /sets/.test(f)));
    });
    await test('image : octets rendus et gardés au cache (.bin) ; 404 = absente ; redemande jamais', async () => {
        let appels = 0;
        const transport = { async get(u) { appels++; if (/robots/.test(u)) return { status: 404, type: 'text/html', texte: 'nf' }; return /absente/.test(u) ? { status: 404, type: 'text/html', texte: 'nf' } : { status: 200, type: 'image/png', octets: PNG }; } };
        const cli = H.fabriquerClient(base({ transport }));
        await cli.initialiserRobots('media.exemple.test');
        const a = await cli.lireImage('https://media.exemple.test/2025/01/a.png');
        assert.ok(Buffer.isBuffer(a.octets) && !a.cache);
        const b = await cli.lireImage('https://media.exemple.test/2025/01/a.png');
        assert.ok(b.cache);
        const c = await cli.lireImage('https://media.exemple.test/2025/01/absente.png');
        assert.ok(c.absente);
        assert.strictEqual(appels, 3);
        assert.ok(H.lireDuCache(cli.dossierCache(), 'https://media.exemple.test/2025/01/a.png'));
    });
    await test('image : un 200 text/html est une fausse absence (seconde preuve après 24 h), pas une image', async () => {
        const transport = { async get(u) { return /robots/.test(u) ? robotsOk : html('<p>Page non trouvée</p>'); } };
        const cli = H.fabriquerClient(base({ transport }));
        await cli.initialiserRobots('media.exemple.test');
        const r = await cli.lireImage('https://media.exemple.test/2025/01/x.png');
        assert.ok(r.absente && r.meta.statut === 'fausse-absente');
    });
    await test('le journal des requêtes compte par hôte et par code HTTP', async () => {
        const transport = { async get(u) { return /robots/.test(u) ? robotsOk : /b$/.test(u) ? { status: 404, type: 'text/html', texte: 'nf' } : html('x'); } };
        const cli = H.fabriquerClient(base({ transport }));
        await cli.initialiserRobots('www.exemple.test');
        await cli.lire('https://www.exemple.test/sets/a');
        await cli.lire('https://www.exemple.test/sets/b');
        assert.deepStrictEqual(cli.requetesParHote(), { 'www.exemple.test': 3 });
        assert.deepStrictEqual(cli.codes(), { 200: 2, 404: 1 });
    });
    await test('le journal écrit sur disque une ligne par requête, sans en-tête ni cookie', async () => {
        const dossier = tmp(); const journal = path.join(dossier, 'journal.jsonl');
        const cli = H.fabriquerClient(base({ journal, transport: { async get(u) { return /robots/.test(u) ? robotsOk : html('x'); } } }));
        await cli.initialiserRobots('www.exemple.test');
        await cli.lire('https://www.exemple.test/sets/a');
        const lignes = fs.readFileSync(journal, 'utf8').trim().split('\n').map(JSON.parse);
        assert.strictEqual(lignes.length, 2);
        assert.deepStrictEqual(Object.keys(lignes[0]).sort(), ['chemin', 'hote', 'le', 'octets', 'status', 'type']);
    });
    await test('l\'agent est celui du dépôt et le transport réel ne suit aucune redirection ni ne porte de cookie', () => {
        assert.match(H.UA, /^rat-market-catalogue\/1\.0 /);
        const src = fs.readFileSync(path.join(__dirname, 'collecte-cartes', 'recolte-hote.js'), 'utf8');
        assert.match(src, /redirect: 'manual'/);
        assert.ok(!/credentials\s*:\s*['"]include/.test(src) && !/[Cc]ookie\s*:/.test(src.replace(/\/\/.*$/gm, '')));
    });
    await test('plafondRestant : les réponses déjà au cache consomment le plafond total', () => {
        const dossier = tmp();
        const cli = H.fabriquerClient(base({ dossierCache: dossier, plafond: 3, transport: { async get() { return html('x'); } }, robots: { 'www.exemple.test': null } }));
        assert.strictEqual(H.plafondRestant(dossier, 5), 5);
        fs.writeFileSync(path.join(dossier, '0123456789abcdef-x.json'), '{}');
        assert.strictEqual(H.plafondRestant(dossier, 5), 4);
        assert.strictEqual(H.plafondRestant(dossier, 1), 0);
        void cli;
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
