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
        assert.deepStrictEqual(r1.parStatut, { 'fausse-absente': 1 });
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
        for (const a of [['--inconnu'], [], ['--plan', '--releve'], ['--releve'], ['--telecharger'], ['--ecrire'], ['--plan', '--attendu=3'], ['--releve', '--plafond=5', '--echantillon=3'], ['--plan', '--plafond=5'], ['--plan', '--cle-seule'], ['--releve', '--plafond=5', '--fichier-plan=a.json'], ['--plan', '--fichier-lot=a\\b.json'], ['--plan', '--fichier-plan=../x.json']]) assert.strictEqual(lance(...a).status, 2, JSON.stringify(a));
    });
    await test('--ecrire hors de lot-additif.js : refusé avant toute connexion (garde de lot)', () => {
        const lot = tmp();
        fs.writeFileSync(path.join(lot, 'lot.json'), JSON.stringify({ unites: [] }));
        const r = spawnSync(process.execPath, [COLL_FILE, '--ecrire', '--attendu=1', `--lot=${lot}`], { encoding: 'utf8', timeout: 20000 });
        assert.notStrictEqual(r.status, 0); assert.ok(/lot-additif\.js/.test(r.stderr), r.stderr);
    });
    // ───────── I3 : `ecrire` / `decider` sur de FAUX modèles (en mémoire), faux R2 ─────────
    const { fauxModeles } = require('./faux-modeles-cardtrader');
    process.env.R2_BUCKET_IMAGES = process.env.R2_BUCKET_IMAGES || 'banc-sans-bucket-reel';
    const SET_PP = 'Play-Pokemon-Prize-Pack-Series-Five';
    async function preparer(n, { statuts = {}, larges = {} } = {}) {
        const dossier = tmp(), octetsParId = {};
        const cli = mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : { status: 200, type: 'image/jpeg', octets: octetsParId[Number(/image\/(\d+)\//.exec(u)[1])] }; } }, dossier, 200);
        await cli.initialiserRobots();
        const us = [], rels = {}, idx = {};
        for (let i = 0; i < n; i++) {
            const u = { carteId: 100 + i, slugSet: SET_PP, numero: String(70 + i), blueprint: 900 + i, blueprintSlug: `x-${i}`, page: `https://www.cardtrader.com/en-US/cards/${900 + i}-x-${i}`, produits: [7000 + i], famille: 'pp', groupe: 'PP S5', slugCM: `S-${i}`, carteNom: `N${i}`, temoins: ['confirme'], cles: [] };
            const url = `https://www.cardtrader.com/uploads/blueprints/image/${900 + i}/x.jpg`;
            const larg = larges[i] ?? 500, haut = Math.round(larg * 1.4);
            octetsParId[900 + i] = await jpeg(larg, haut);
            const r = await cli.lireImage(url);
            us.push(u); rels[u.blueprint] = { url };
            // l'index tel que `juger` l'écrit : `ok` à partir de 350, sinon `trop-petit` AVEC sa largeur (le jugement basse définition se rejoue depuis cette largeur)
            idx[url] = statuts[i] ? { statut: statuts[i] } : { statut: larg >= 350 ? 'ok' : 'trop-petit', w: larg, h: haut, sha256: r.meta.sha256 };
        }
        const deposes = [];
        return { dossier, us, rels, idx, deposes, deposer: async (b, c) => { deposes.push(c); }, vignetter: async () => ({ vg: { entrees: 0, fabriquees: 0, echecs: 0 } }) };
    }
    const lancerEcrire = (p, M, o = {}) => K.ecrire(p.us, M, { dossierCache: p.dossier, releves: p.rels, indexImages: p.idx, deposer: p.deposer, vignetter: p.vignetter, ...o });
    const cartesVides = n => Array.from({ length: n }, (_, i) => ({ _id: 100 + i, images: [] }));
    const SILENCE = async f => { const l = console.log, e = console.error; const sortie = []; console.log = (...a) => sortie.push(a.join(' ')); console.error = (...a) => sortie.push(a.join(' ')); try { return [await f(), sortie]; } finally { console.log = l; console.error = e; } };

    await test('I3 écriture : un ajout (document, entrée neutre, objet R2, bilan du set vérifié)', async () => {
        const p = await preparer(1), { M, etat } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.reel, 1); assert.strictEqual(r.resultats[0].etat, 'verifie');
        const c = etat.carte(100);
        assert.strictEqual(c.images.length, 1); assert.strictEqual(c.images[0].source, 'ctr'); assert.strictEqual(c.images[0].lot, 'ctr-2026-10'); assert.strictEqual(c.images[0].retirable, true);
        assert.deepStrictEqual(p.deposes, [`ctr/${SET_PP}/70-100-en.webp`]);
        assert.strictEqual(etat.image(`ctr/${SET_PP}/100/70/en`).etat, 'ok');
        assert.deepStrictEqual(r.orphelins, []);
    });
    await test('I3 écriture : une image empruntée d\'un Prize Pack est REMPLACÉE par le vrai scan tamponné', async () => {
        const p = await preparer(1);
        const emprunt = { set: SET_PP, numero: '70', langue: 'en', source: 'emprunt', cleR2: 'e', w: 600, imageEmprunteeTirage: true, tamponNonRepresente: 'Play! Pokémon' };
        const { M, etat } = fauxModeles({ cartes: [{ _id: 100, images: [emprunt] }], sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.resultats[0].remplacees, 1);
        assert.deepStrictEqual(etat.carte(100).images.map(e => e.source), ['ctr']);
    });
    await test('I3 écriture : une basse définition de même impression est REMPLACÉE, son document passe à « remplace »', async () => {
        const p = await preparer(1);
        const bas = { set: SET_PP, numero: '70', langue: 'en', source: 'pokumon', cleR2: 'a', w: 245, wOriginal: 245, basseDefinition: true, tampon: 'Play! Pokémon' };
        const { M, etat } = fauxModeles({ cartes: [{ _id: 100, images: [bas] }], images: [{ _id: 'pk1', source: 'pokumon', set: SET_PP, cleR2: 'a', carteId: 100, etat: 'ok', tampon: 'Play! Pokémon' }], sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.deepStrictEqual(etat.carte(100).images.map(e => e.source), ['ctr']);
        assert.strictEqual(etat.image('pk1').etat, 'remplace');
    });
    await test('I3 écriture : devant une entrée correcte au-dessus du seuil, l\'unité CÈDE (rien déposé, rien écrit, entrée intacte)', async () => {
        const p = await preparer(1);
        const bonne = { set: SET_PP, numero: '70', langue: 'en', source: 'tcgdex', cleR2: 't', w: 600, wOriginal: 600 };
        const { M, etat, journal } = fauxModeles({ cartes: [{ _id: 100, images: [bonne] }], sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 0 }));
        assert.strictEqual(r.reel, 0); assert.strictEqual(r.cedees, 1); assert.deepStrictEqual(p.deposes, []);
        assert.deepStrictEqual(etat.carte(100).images.map(e => e.source), ['tcgdex']); assert.deepStrictEqual(journal.filter(j => j[0] === 'carte'), []);
    });
    await test('I3 écriture : un échec R2 n\'écrit RIEN en base ; le set sort « incomplet », code 1, aucun orphelin', async () => {
        const p = await preparer(2);
        const { M, etat, journal } = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 2, deposer: async () => { throw new Error('R2 en panne'); } }));
        assert.strictEqual(r.code, 1); assert.strictEqual(r.resultats[0].etat, 'incomplet'); assert.match(r.resultats[0].erreurJointure, /R2 en panne/);
        assert.deepStrictEqual(r.orphelins, []); assert.strictEqual(etat.carte(100).images.length, 0); assert.deepStrictEqual(journal.filter(j => j[0] === 'carte'), []);
    });
    await test('I3 écriture : R2 réussit puis Mongo échoue -> l\'objet R2 est un ORPHELIN, compté et LISTÉ ; la relance le reprend', async () => {
        const p = await preparer(2);
        let panne = true;
        const { M, etat } = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SET_PP, tirage: 'intl' }], echecs: { carte: (f, u) => (panne && u.$push ? 'Mongo en panne' : undefined) } });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 2 }));
        assert.strictEqual(r.code, 1); assert.strictEqual(r.resultats[0].etat, 'incomplet');
        assert.deepStrictEqual(r.orphelins, [`ctr/${SET_PP}/70-100-en.webp`]); assert.strictEqual(r.resultats[0].orphelins.length, 1);
        assert.strictEqual(etat.carte(100).images.length, 0);
        panne = false;
        const [r2] = await SILENCE(() => lancerEcrire(p, M, { attendu: 2 }));
        assert.strictEqual(r2.code, 0); assert.deepStrictEqual(r2.orphelins, []);
        assert.strictEqual(etat.carte(100).images.length, 1); assert.strictEqual(etat.carte(101).images.length, 1);
    });
    await test('I3/I4 écriture : --attendu faux REFUSÉ (rien déposé, rien écrit) et le nombre réel d\'unités est imprimé AVANT de refuser', async () => {
        const p = await preparer(3, { statuts: { 2: 'absent' } });
        const { M, journal } = fauxModeles({ cartes: cartesVides(3), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r, sortie] = await SILENCE(() => lancerEcrire(p, M, { attendu: 5 }));
        assert.strictEqual(r.code, 2); assert.strictEqual(r.etat, 'refuse-attendu'); assert.strictEqual(r.reel, 2); assert.strictEqual(r.unitesAAjouter, 2);
        assert.deepStrictEqual(p.deposes, []); assert.deepStrictEqual(journal.filter(j => j[0] !== 'set'), []);
        assert.ok(sortie.some(l => /unités à ajouter dont l'image est ok : 2/.test(l)), sortie.join('|'));
        assert.strictEqual((await SILENCE(() => lancerEcrire(p, fauxModeles({ cartes: cartesVides(3), sets: [{ _id: SET_PP, tirage: 'intl' }] }).M, { attendu: 2 })))[0].code, 0);
    });
    await test('I4 — --compter : le nombre d\'unités à ajouter (la valeur de --attendu) sans rien déposer ni écrire, sans lot-additif, sans R2', async () => {
        const p = await preparer(3, { statuts: { 2: 'absent' } });
        const { M, journal } = fauxModeles({ cartes: cartesVides(3), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r, sortie] = await SILENCE(() => K.ecrire(p.us, M, { dossierCache: p.dossier, releves: p.rels, indexImages: p.idx, compterSeulement: true }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.etat, 'compte'); assert.strictEqual(r.reel, 2);
        assert.deepStrictEqual(p.deposes, []); assert.deepStrictEqual(journal.filter(j => j[0] !== 'set'), []);
        assert.ok(sortie.some(l => /unités à ajouter dont l'image est ok : 2/.test(l)));
    });
    await test('I4/M4 — --attendu compte des UNITÉS à ajouter ; une unité déjà posée au rejeu n\'y entre pas ; une image écartée (absent) n\'est pas une erreur (code 0)', async () => {
        const p = await preparer(3, { statuts: { 2: 'absent' } });
        const { M } = fauxModeles({ cartes: cartesVides(3), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 2 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.ecartees, 1); assert.strictEqual(r.horsCache, 0);
        const [r2] = await SILENCE(() => lancerEcrire(p, M, { attendu: 0 }));
        assert.strictEqual(r2.reel, 0); assert.strictEqual(r2.code, 0);
    });
    await test('M4 — une image « ok » dont le fichier manque au cache est une vraie erreur (hors cache, code 1)', async () => {
        const p = await preparer(1);
        p.idx[p.rels[900].url] = { statut: 'ok', w: 500, h: 698, sha256: 'a'.repeat(64) };
        const { M } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { dossierCache: tmp(), attendu: 0 }));
        assert.strictEqual(r.horsCache, 1); assert.strictEqual(r.code, 1);
    });

    // ───────── BASSE DÉFINITION (décision du testeur, 18/10) : « Les 589 images CardTrader en 255 px : OUI, en basseDefinition: true » ─────────
    await test('BASSE juger : l\'index garde « trop-petit » AVEC la largeur (255 comme 199) ; le jugement basse définition se REJOUE depuis cette largeur (jugementDe)', async () => {
        assert.deepStrictEqual((({ statut, w }) => ({ statut, w }))(await K.juger(await jpeg(255, 357))), { statut: 'trop-petit', w: 255 });
        assert.deepStrictEqual((({ statut, w }) => ({ statut, w }))(await K.juger(await jpeg(199, 279))), { statut: 'trop-petit', w: 199 });
        const j = K.jugementDe;
        assert.deepStrictEqual([j({ statut: 'trop-petit', w: 255 }), j({ statut: 'trop-petit', w: 200 }), j({ statut: 'trop-petit', w: 349 }), j({ statut: 'trop-petit', w: 199 }), j({ statut: 'trop-petit' }), j({ statut: 'ok', w: 500 }), j({ statut: 'absent' }), j(undefined)],
            ['basse-definition', 'basse-definition', 'basse-definition', 'trop-petit', 'trop-petit', 'ok', 'absent', undefined]);
    });
    const lotBasse = { statuts: { 3: 'absent' }, larges: { 0: 255, 1: 500, 2: 150, 4: 349 } };       // 0 : 255 (basse), 1 : 500 (ok), 2 : 150 (< 200), 3 : absent, 4 : 349 (basse)
    await test('BASSE --compter : seules les basses définitions sont comptées (255 et 349) ; l\'ok est « hors mode », le 150 « trop petit » ; SANS le drapeau, le compte est exactement celui d\'avant (1 ok, 3 trop petits)', async () => {
        const p = await preparer(5, lotBasse);
        const { M, journal } = fauxModeles({ cartes: cartesVides(5), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [b, sortieB] = await SILENCE(() => K.ecrire(p.us, M, { dossierCache: p.dossier, releves: p.rels, indexImages: p.idx, compterSeulement: true, basseDefinition: true }));
        assert.strictEqual(b.reel, 2); assert.strictEqual(b.horsMode, 1); assert.strictEqual(b.tropPetits, 1); assert.strictEqual(b.ecartees, 1); assert.strictEqual(b.horsCache, 0);
        assert.ok(sortieB.some(l => /basse définition à ajouter : 2/.test(l)), sortieB.join('|'));
        const [n] = await SILENCE(() => K.ecrire(p.us, M, { dossierCache: p.dossier, releves: p.rels, indexImages: p.idx, compterSeulement: true }));
        assert.strictEqual(n.reel, 1); assert.strictEqual(n.tropPetits, 3); assert.strictEqual(n.ecartees, 1); assert.strictEqual(n.horsMode, undefined);
        assert.deepStrictEqual(journal.filter(j => j[0] !== 'set'), []);
    });
    await test('BASSE --ecrire : sans le drapeau, une basse définition n\'est JAMAIS écrite (comportement d\'avant, octet pour octet)', async () => {
        const p = await preparer(2, { larges: { 0: 255, 1: 500 } });
        const { M, etat } = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.deepStrictEqual(p.deposes, [`ctr/${SET_PP}/71-101-en.webp`]);
        assert.strictEqual(etat.carte(100).images.length, 0); assert.strictEqual(etat.carte(101).images[0].basseDefinition, undefined);
    });
    await test('BASSE --ecrire --basse-definition : face à RIEN, l\'entrée ET le document sont ajoutés et marqués basseDefinition ; la webp n\'est jamais agrandie ; bilan à part', async () => {
        const p = await preparer(2, { larges: { 0: 255, 1: 500 } });
        const { M, etat } = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 1, basseDefinition: true }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.reel, 1); assert.strictEqual(r.resultats[0].etat, 'verifie');
        assert.deepStrictEqual(p.deposes, [`ctr/${SET_PP}/70-100-en.webp`]);
        const e = etat.carte(100).images[0];
        assert.strictEqual(e.source, 'ctr'); assert.strictEqual(e.basseDefinition, true); assert.strictEqual(e.wOriginal, 255); assert.strictEqual(e.w, 255);
        const d = etat.image(`ctr/${SET_PP}/100/70/en`);
        assert.strictEqual(d.basseDefinition, true); assert.strictEqual(d.etat, 'ok'); assert.strictEqual(d.w, 255); assert.strictEqual(d.wOriginal, 255);
        assert.strictEqual(etat.carte(101).images.length, 0);                                  // l'image « ok » n'est pas du mode
        assert.ok(etat.set(SET_PP).bilanLotCtrBasse && !etat.set(SET_PP).bilanLotCtr, 'le bilan du lot basse définition ne recouvre pas celui du lot des ok');
    });
    await test('BASSE --ecrire : une basse définition ne remplace JAMAIS une image correcte (elle CÈDE : rien déposé, rien écrit, entrée intacte)', async () => {
        const p = await preparer(1, { larges: { 0: 255 } });
        const bonne = { set: SET_PP, numero: '70', langue: 'en', source: 'tcgdex', cleR2: 't', w: 600, wOriginal: 600 };
        const { M, etat, journal } = fauxModeles({ cartes: [{ _id: 100, images: [bonne] }], sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 0, basseDefinition: true }));
        assert.strictEqual(r.reel, 0); assert.strictEqual(r.cedees, 1); assert.deepStrictEqual(p.deposes, []);
        assert.deepStrictEqual(etat.carte(100).images.map(e => e.source), ['tcgdex']); assert.deepStrictEqual(journal.filter(j => j[0] === 'carte' || j[0] === 'image'), []);
    });
    await test('BASSE --ecrire : ni une autre basse définition, ni une image empruntée ne sont remplacées par une basse définition (elle cède)', async () => {
        const p = await preparer(2, { larges: { 0: 255, 1: 255 } });
        const bas = { set: SET_PP, numero: '70', langue: 'en', source: 'pokumon', cleR2: 'a', w: 245, wOriginal: 245, basseDefinition: true, tampon: 'Play! Pokémon' };
        const emprunt = { set: SET_PP, numero: '71', langue: 'en', source: 'emprunt', cleR2: 'e', w: 600, imageEmprunteeTirage: true, tamponNonRepresente: 'Play! Pokémon' };
        const { M, etat } = fauxModeles({ cartes: [{ _id: 100, images: [bas] }, { _id: 101, images: [emprunt] }], images: [{ _id: 'pk1', source: 'pokumon', set: SET_PP, cleR2: 'a', carteId: 100, etat: 'ok', tampon: 'Play! Pokémon' }], sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 0, basseDefinition: true }));
        assert.strictEqual(r.reel, 0); assert.strictEqual(r.cedees, 2); assert.deepStrictEqual(p.deposes, []);
        assert.deepStrictEqual([etat.carte(100).images.map(e => e.source), etat.carte(101).images.map(e => e.source)], [['pokumon'], ['emprunt']]); assert.strictEqual(etat.image('pk1').etat, 'ok');
    });
    await test('BASSE --ecrire : --attendu faux REFUSÉ (rien déposé) ; une copie altérée du cache (sha256) n\'est pas écrite ; une basse définition SANS octets au cache reste hors lot (comptée)', async () => {
        const p = await preparer(3, { larges: { 0: 255, 1: 255, 2: 255 } });
        const { M, journal } = fauxModeles({ cartes: cartesVides(3), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r1] = await SILENCE(() => lancerEcrire(p, M, { attendu: 9, basseDefinition: true }));
        assert.strictEqual(r1.code, 2); assert.strictEqual(r1.etat, 'refuse-attendu'); assert.deepStrictEqual(p.deposes, []); assert.deepStrictEqual(journal.filter(j => j[0] !== 'set'), []);
        p.idx[p.rels[901].url].sha256 = 'b'.repeat(64);
        p.idx[p.rels[902].url].statut = 'trop-petit'; for (const ext of ['.json', '.bin']) fs.rmSync(path.join(p.dossier, CT.nomCache(p.rels[902].url).replace(/\.json$/, ext)), { force: true });
        const [r2] = await SILENCE(() => lancerEcrire(p, M, { attendu: 1, basseDefinition: true }));
        assert.strictEqual(r2.reel, 1); assert.strictEqual(r2.altere, 1); assert.strictEqual(r2.horsCache, 1); assert.strictEqual(r2.code, 1);
    });
    await test('BASSE --ecrire : la carte porte déjà une entrée du lot des ok (autre numéro, même set) -> la garde compte l\'AJOUT de ce passage et reste verte', async () => {
        const p = await preparer(1, { larges: { 0: 255 } });
        const deja = { set: SET_PP, numero: '99', langue: 'en', source: 'ctr', lot: 'ctr-2026-10', cleR2: 'ctr/x', w: 500, wOriginal: 500 };
        const { M, etat } = fauxModeles({ cartes: [{ _id: 100, images: [deja] }], sets: [{ _id: SET_PP, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancerEcrire(p, M, { attendu: 1, basseDefinition: true }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.resultats[0].etat, 'verifie'); assert.strictEqual(r.resultats[0].garde.ok, true);
        assert.strictEqual(etat.carte(100).images.length, 2);
    });
    await test('une page relevée SANS adresse d\'image est « écartée » (pas une erreur de cache), dans les deux modes', async () => {
        const p = await preparer(1, { larges: { 0: 255 } });
        p.rels[900] = { page: p.us[0].page, refus: 'aucune image de blueprint dans la page' };
        const { M } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SET_PP, tirage: 'intl' }] });
        for (const basseDefinition of [false, true]) {
            const [r] = await SILENCE(() => K.ecrire(p.us, M, { dossierCache: p.dossier, releves: p.rels, indexImages: p.idx, compterSeulement: true, basseDefinition }));
            assert.deepStrictEqual([r.ecartees, r.horsCache, r.reel], [1, 0, 0]);
        }
    });
    await test('BASSE --planche : ne montre QUE les basses définitions, dans un dossier à elle ; sans le drapeau la planche ne montre toujours que les « ok »', async () => {
        const p = await preparer(6, { larges: { 0: 255, 1: 255, 2: 500, 3: 255, 4: 150, 5: 300 } });
        const sortie = tmp();
        const b = await K.planches({ unites: p.us, releves: p.rels, indexImages: p.idx, dossierCache: p.dossier, sortieDossier: sortie, n: 50, basseDefinition: true });
        assert.strictEqual(b.images, 4);
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(sortie, 'planche.json'), 'utf8')).map(x => x.blueprint).sort(), [900, 901, 903, 905]);
        const n = await K.planches({ unites: p.us, releves: p.rels, indexImages: p.idx, dossierCache: p.dossier, sortieDossier: tmp(), n: 50 });
        assert.strictEqual(n.images, 1);
        await assert.rejects(() => K.planches({ unites: [p.us[2]], releves: p.rels, indexImages: p.idx, dossierCache: p.dossier, sortieDossier: tmp(), n: 50, basseDefinition: true }), /aucune image/);
    });
    await test('BASSE ligne de commande : --basse-definition ne va qu\'avec --compter, --planche, --ecrire (refus code 2 sans connexion)', () => {
        const lance = (...a) => spawnSync(process.execPath, [COLL_FILE, ...a], { encoding: 'utf8', timeout: 20000 });
        for (const a of [['--plan', '--basse-definition'], ['--releve', '--plafond=5', '--basse-definition'], ['--telecharger', '--plafond=5', '--basse-definition'], ['--basse-definition'], ['--ecrire', '--basse-definition'], ['--basse-definition=1', '--compter']]) assert.strictEqual(lance(...a).status, 2, JSON.stringify(a));
        const lot = tmp(); fs.writeFileSync(path.join(lot, 'lot.json'), JSON.stringify({ unites: [] }));
        const r = lance('--ecrire', '--attendu=0', '--basse-definition', `--lot=${lot}`);
        assert.notStrictEqual(r.status, 2); assert.ok(/lot-additif\.js/.test(r.stderr), r.stderr);       // l'écriture basse définition reste sous lot-additif
    });

    // ───────── M5 / M6 : fausse absence, 5xx ─────────
    await test('M5 — une « fausse absence » (200 text/html) n\'est jamais définitive au premier coup : seconde preuve après 24 h', async () => {
        const u1 = unites.slice(0, 1), fichier = path.join(tmp(), 'i.json'), dossier = tmp();
        let n = 0, t = Date.parse('2026-10-18T12:00:00Z');
        const transport = { async get(u) { n++; return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : { status: 200, type: 'text/html', texte: '<html>introuvable</html>' }; } };
        const mk = () => CT.fabriquerClient({ dossierCache: dossier, plafond: 50, transport, cadenceMs: 0, pause: async () => {}, now: () => t, dossierPauses: tmp(), robots: null, suivi: RH.suiviHote() });
        const a = await K.telecharger({ unites: u1, releves, cli: mk(), fichier, now: () => t });
        assert.strictEqual(JSON.parse(fs.readFileSync(fichier, 'utf8'))[releves[u1[0].blueprint].url].statut, 'fausse-absente'); assert.strictEqual(a.parStatut['fausse-absente'], 1);
        const avant = n;
        await K.telecharger({ unites: u1, releves, cli: mk(), fichier, now: () => t + 3600e3 });
        assert.strictEqual(n, avant);
        t += 25 * 3600e3;
        await K.telecharger({ unites: u1, releves, cli: mk(), fichier, now: () => t });
        assert.ok(n > avant);
        assert.strictEqual(JSON.parse(fs.readFileSync(fichier, 'utf8'))[releves[u1[0].blueprint].url].statut, 'absent');
    });
    await test('M6 — téléchargement : un 5xx ISOLÉ saute l\'image sans arrêter ; deux de suite ARRÊTENT', async () => {
        const bon = await jpeg(500, 698);
        const faire = (mauvais) => {
            const vus = []; const dossier = tmp();
            const transport = { async get(url) { if (url.endsWith('robots.txt')) return { status: 200, type: 'text/plain', texte: '' }; const id = Number(/image\/(\d+)\//.exec(url)[1]); vus.push(id); return mauvais.includes(id) ? { status: 503, type: 'text/html', texte: 'oups' } : { status: 200, type: 'image/jpeg', octets: bon }; } };
            return { vus, run: () => K.telecharger({ unites, releves, cli: mkCli(transport, dossier), fichier: path.join(tmp(), 'i.json') }) };
        };
        const id = i => unites[i].blueprint;
        const a = faire([id(3)]), ra = await a.run();
        assert.strictEqual(ra.etat, 'termine'); assert.strictEqual(ra.transitoires, 1); assert.strictEqual(ra.parStatut.ok, 11); assert.strictEqual(ra.restantes, 1);
        const b = faire([id(3), id(4)]), rb = await b.run();
        assert.strictEqual(rb.etat, 'serveur-indisponible'); assert.ok(!b.vus.includes(id(5)), 'aucune requête après le deuxième 5xx');
        const c = faire([id(3), id(5)]), rc = await c.run();       // non consécutifs : le compteur retombe sur un succès
        assert.strictEqual(rc.etat, 'termine'); assert.strictEqual(rc.transitoires, 2);
    });
    await test('M6 — relevé : un 5xx isolé saute la page sans arrêter ; deux de suite arrêtent', async () => {
        const html = new Map(pages.map(p => [p.url, p.html]));
        const faire = mauvais => mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : mauvais.includes(u) ? { status: 502, type: 'text/html', texte: 'bad gateway' } : { status: 200, type: 'text/html', texte: html.get(u) }; } }, tmp());
        const r1 = await K.releve({ unites, cli: faire([unites[2].page]), fichier: path.join(tmp(), 'r.json') });
        assert.strictEqual(r1.etat, 'termine'); assert.strictEqual(r1.transitoires, 1); assert.strictEqual(r1.avecImage, 11);
        const r2 = await K.releve({ unites, cli: faire([unites[2].page, unites[3].page]), fichier: path.join(tmp(), 'r2.json') });
        assert.strictEqual(r2.etat, 'serveur-indisponible'); assert.strictEqual(r2.avecImage, 2);
    });

    // ───────── I1 : la planche montre TOUTES les « clé seule » restantes, avec le nom de fiche réel ─────────
    await test('I1 planche --cle-seule : toutes les « clé seule » du lot, nom de fiche et nom du blueprint dans la description', async () => {
        const dossier = tmp(), sortie = tmp(), bon = await jpeg(500, 698);
        const cli = mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: '' } : { status: 200, type: 'image/jpeg', octets: bon }; } }, dossier, 400);
        await cli.initialiserRobots();
        const us = [], rels = {}, idx = {};
        for (let i = 0; i < 60; i++) {
            const u = { blueprint: 6000 + i, page: `https://www.cardtrader.com/en-US/cards/${6000 + i}-x`, famille: ['wcd', 'pp'][i % 2], groupe: 'G', slugCM: `S-${i}`, carteNom: `Fiche ${i}`, nomBlueprint: `bp ${i}`, numero: String(i), temoins: i % 4 === 0 ? ['non-applicable'] : ['confirme'], cles: [], nomFiche: 'concordant' };
            const url = `https://www.cardtrader.com/uploads/blueprints/image/${u.blueprint}/x.jpg`;
            const r = await cli.lireImage(url); us.push(u); rels[u.blueprint] = { url }; idx[url] = { statut: 'ok', w: 500, h: 698, sha256: r.meta.sha256 };
        }
        const p = await K.planches({ unites: us, releves: rels, indexImages: idx, dossierCache: dossier, sortieDossier: sortie, cleSeuleSeulement: true });
        assert.strictEqual(p.images, 15); assert.strictEqual(p.cleSeule, 15); assert.strictEqual(p.planches.length, 1);
        const d = JSON.parse(fs.readFileSync(path.join(sortie, 'planche.json'), 'utf8'));
        assert.ok(d.every(x => /^Fiche \d+$/.test(x.carteNom) && /^bp \d+$/.test(x.nomBlueprint) && x.cleSeule));
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
