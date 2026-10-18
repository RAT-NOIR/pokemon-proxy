// Banc du collecteur CLI : jugement d'une image, relevé des pages (12 pages réelles en fixture), téléchargement, planches, ligne de commande. Transport injecté : AUCUNE requête, AUCUNE base.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const CT = require('./collecte-cartes/cardtrader');
const RH = require('./collecte-cartes/reponse-hote');
const COLL = (process.env.CTR_COLLECTEUR || './collecteur-images-cardtrader').replace(/(\.js)?$/, '.js');       // (les mutants pointent une copie)
const COLL_FILE = path.join(__dirname, COLL);
const K = require(COLL_FILE);
const RETIRER = require('./retirer-visuels-cardtrader');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${e.message}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ctr3-'));
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cardtrader-pages.json'), 'utf8'));
const jpeg = (w, h, couleur = { r: 200, g: 60, b: 60 }) => sharp({ create: { width: w, height: h, channels: 3, background: couleur } }).jpeg().toBuffer();
const mkCli = (transport, dossier, plafond = 50) => CT.fabriquerClient({ dossierCache: dossier, plafond, transport, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), robots: null, suivi: RH.suiviHote() });

(async () => {
    await test('juger : 500x698 ok ; 349 de large trop-petit AVEC sa largeur ; carré = forme inattendue ; octets quelconques = illisible', async () => {
        assert.strictEqual((await K.juger(await jpeg(500, 698))).statut, 'ok');
        assert.deepStrictEqual((({ statut, w }) => ({ statut, w }))(await K.juger(await jpeg(349, 487))), { statut: 'trop-petit', w: 349 });
        assert.strictEqual((await K.juger(await jpeg(350, 489))).statut, 'ok');
        assert.strictEqual((await K.juger(await jpeg(500, 500))).statut, 'forme-inattendue');
        assert.strictEqual((await K.juger(Buffer.from('<html>pas une image</html>'))).statut, 'illisible');
    });

    const unites = pages.map((p, i) => ({ blueprint: Number(/cards\/(\d+)-/.exec(p.url)[1]), page: p.url, famille: ['wcd', 'pp', 'ba'][i % 3], groupe: 'G', slugCM: `S-${i}`, carteNom: `N${i}`, numero: String(i), temoins: i % 4 === 0 ? ['absent'] : ['confirme'], cles: [] }));
    await test('relevé : l\'adresse est lue sur la page, reprise sans nouvelle requête, plafond respecté', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'releves.json');
        const html = new Map(pages.map(p => [p.url, p.html]));
        let n = 0;
        const transport = { async get(url) { n++; if (url.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: 'User-agent: *\nAllow: /\n' }; return { status: 200, type: 'text/html', texte: html.get(url) }; } };
        const cli = mkCli(transport, dossier);
        const r = await K.releve({ unites, cli, fichier });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(r.avecImage, 12); assert.strictEqual(n, 13);
        const rel = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        for (const u of unites) assert.ok(rel[u.blueprint].url.includes(`/image/${u.blueprint}/`), JSON.stringify(rel[u.blueprint]));
        const r2 = await K.releve({ unites, cli: mkCli(transport, dossier), fichier });
        assert.strictEqual(n, 13); assert.strictEqual(r2.avecImage, 12);
        // plafond : 5 requêtes au total (robots compris) -> 4 pages
        const court = await K.releve({ unites, cli: mkCli(transport, tmp(), 5), fichier: path.join(tmp(), 'r.json') });
        assert.strictEqual(court.etat, 'plafond'); assert.strictEqual(court.relevees, 4); assert.strictEqual(court.restantes, 8);
    });
    await test('relevé : un 403 arrête tout (arret-definitif) ; une page 404 est « absente » ; une page sans image est un refus listé', async () => {
        const f1 = path.join(tmp(), 'r1.json');
        const r1 = await K.releve({ unites, cli: mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: f1 });
        assert.strictEqual(r1.etat, 'arret-definitif'); assert.strictEqual(r1.relevees, 0);
        const r2 = await K.releve({ unites: unites.slice(0, 2), cli: mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : u === unites[0].page ? { status: 404, type: 'text/html', texte: 'nf' } : { status: 200, type: 'text/html', texte: '<html>rien</html>' }; } }, tmp()), fichier: path.join(tmp(), 'r2.json') });
        assert.strictEqual(r2.absentes, 1); assert.strictEqual(r2.refus, 1); assert.strictEqual(r2.etat, 'termine');
    });

    const releves = Object.fromEntries(unites.map(u => [u.blueprint, { page: u.page, url: `https://www.cardtrader.com/uploads/blueprints/image/${u.blueprint}/x.jpg`, via: 'og' }]));
    await test('téléchargement : vraie image au cache + index ; trop-petit gardé avec sa largeur ; 404 absent ; reprise sans requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'images.json');
        const bon = await jpeg(500, 698), petit = await jpeg(340, 475);
        let n = 0;
        const transport = { async get(url) {
            n++;
            if (url.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: 'User-agent: *\nDisallow: /uploads/\nAllow: /uploads/blueprints/\n' };
            const id = Number(/image\/(\d+)\//.exec(url)[1]);
            if (id === unites[1].blueprint) return { status: 404, type: 'text/html', texte: 'nf' };
            return { status: 200, type: 'image/jpeg', octets: id === unites[2].blueprint ? petit : bon };
        } };
        const r = await K.telecharger({ unites, releves, cli: mkCli(transport, dossier), fichier });
        assert.strictEqual(r.etat, 'termine'); assert.deepStrictEqual(r.parStatut, { ok: 10, absent: 1, 'trop-petit': 1 });
        assert.deepStrictEqual(r.tropPetits.map(t => t.largeur), [340]);
        const avant = n;
        await K.telecharger({ unites, releves, cli: mkCli(transport, dossier), fichier });
        assert.strictEqual(n, avant);
        assert.ok(CT.lireDuCache(dossier, releves[unites[0].blueprint].url).octets.length > 100);
    });
    await test('téléchargement : une page HTML servie à la place d\'une image (200 text/html) = absente ; JSON = pause de l\'hôte, rien au cache', async () => {
        const mk = rep => mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : rep; } }, tmp());
        const r1 = await K.telecharger({ unites: unites.slice(0, 1), releves, cli: mk({ status: 200, type: 'text/html', texte: '<html>introuvable</html>' }), fichier: path.join(tmp(), 'a.json') });
        assert.deepStrictEqual(r1.parStatut, { absent: 1 });
        const r2 = await K.telecharger({ unites: unites.slice(0, 1), releves, cli: mk({ status: 200, type: 'application/json', texte: '{}' }), fichier: path.join(tmp(), 'b.json') });
        assert.strictEqual(r2.etat, 'pause-hote');
    });
    await test('planches : au moins 15 « clé seule », lisibles (15 vignettes par planche), un fichier de description', async () => {
        const dossier = tmp(), sortie = tmp();
        const grand = [];
        const bon = await jpeg(500, 698);
        const cli = mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : { status: 200, type: 'image/jpeg', octets: bon }; } }, dossier, 400);
        const us = [], rels = {}, idx = {};
        for (let i = 0; i < 120; i++) {
            const u = { blueprint: 5000 + i, page: `https://www.cardtrader.com/en-US/cards/${5000 + i}-x`, famille: ['wcd', 'pp', 'ba'][i % 3], groupe: 'G', slugCM: `S-${i}`, carteNom: `N${i}`, numero: String(i), temoins: i % 6 === 0 ? ['non-applicable'] : ['confirme'], cles: [] };
            us.push(u);
            const url = `https://www.cardtrader.com/uploads/blueprints/image/${u.blueprint}/x.jpg`;
            rels[u.blueprint] = { url };
            await cli.initialiserRobots().catch(() => {});
            const r = await cli.lireImage(url); idx[url] = { statut: 'ok', w: 500, h: 698, sha256: r.meta.sha256 };
        }
        void grand;
        const p = await K.planches({ unites: us, releves: rels, indexImages: idx, dossierCache: dossier, sortieDossier: sortie, n: 50 });
        assert.strictEqual(p.images, 50); assert.ok(p.cleSeule >= 15, String(p.cleSeule)); assert.strictEqual(p.planches.length, 4);
        for (const f of p.planches) assert.ok(fs.statSync(f).size > 1000);
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sortie, 'planche.json'), 'utf8')).length, 50);
    });
    await test('ligne de commande : argument inconnu, mode manquant ou double, plafond manquant, --ecrire sans --attendu : refus (code 2) sans connexion', () => {
        const lance = (...a) => spawnSync(process.execPath, [COLL_FILE, ...a], { encoding: 'utf8', timeout: 20000 });
        for (const a of [['--inconnu'], [], ['--plan', '--releve'], ['--releve'], ['--telecharger'], ['--ecrire'], ['--plan', '--attendu=3'], ['--releve', '--plafond=5', '--echantillon=3'], ['--plan', '--plafond=5']]) assert.strictEqual(lance(...a).status, 2, JSON.stringify(a));
    });
    await test('--ecrire hors de lot-additif.js : refusé avant toute connexion (garde de lot)', () => {
        const lot = tmp();
        fs.writeFileSync(path.join(lot, 'lot.json'), JSON.stringify({ unites: [] }));
        const r = spawnSync(process.execPath, [COLL_FILE, '--ecrire', '--attendu=1', `--lot=${lot}`], { encoding: 'utf8', timeout: 20000 });
        assert.notStrictEqual(r.status, 0); assert.ok(/lot-additif\.js/.test(r.stderr), r.stderr);
    });
    await test('retrait : à blanc par défaut ; le plan compte les entrées, les documents et les clés R2 (vignettes comprises) de la seule source', () => {
        const cartes = [{ _id: 1, images: [{ source: 'ctr', set: 'A', cleR2: 'ctr/A/1', vignette: { cleR2: 'vignettes/ctr/A/1' } }, { source: 'autre', set: 'A', cleR2: 'x' }] }, { _id: 2, images: [{ source: 'ctr', set: 'B', cleR2: 'ctr/B/2' }] }];
        const docs = [{ source: 'ctr', etat: 'ok', cleR2: 'ctr/A/1' }, { source: 'ctr', etat: 'retire', cleR2: 'ctr/B/2' }, { source: 'autre', etat: 'ok', cleR2: 'x' }];
        const p = RETIRER.planDeRetrait(cartes, docs);
        assert.deepStrictEqual([p.entrees, p.docs, p.cartes, p.parSet], [2, 1, [1, 2], { A: 1, B: 1 }]);
        assert.deepStrictEqual(p.cles.sort(), ['ctr/A/1', 'ctr/B/2', 'vignettes/ctr/A/1']);
        const lance = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'retirer-visuels-cardtrader.js'), ...a], { encoding: 'utf8', timeout: 20000 });
        assert.strictEqual(lance('--inconnu').status, 2); assert.strictEqual(lance('--effacer-r2').status, 2);
    });
    await test('chemins : un dossier d\'apports manuels du testeur est refusé', () => {
        for (const p of ['C:\\Users\\Yung\\Desktop\\Logo FR\\x', 'C:\\x\\apport-manuel', 'C:\\Users\\Yung\\Desktop\\LOGO']) assert.throws(() => K.verifierChemin(p), /refusé/);
        assert.doesNotThrow(() => K.verifierChemin(tmp()));
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
