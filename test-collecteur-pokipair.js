// Banc du collecteur « ppr » : relevé (pages réelles en fixture), plan sur une FAUSSE base, téléchargement, planches, décision et écriture sur de FAUX modèles, retrait, ligne de commande.
// Transport injecté : AUCUNE requête, AUCUNE base réelle.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const P = require('./collecte-cartes/pokipair');
const RC = require('./collecte-cartes/recolte-commun');
const RH = require('./collecte-cartes/reponse-hote');
const COLL_FILE = path.join(__dirname, 'collecteur-images-pokipair.js');
const K = require(COLL_FILE);
const RETIRER = require('./retirer-visuels-recolte');
const { fauxModeles } = require('./faux-modeles-cardtrader');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ppr-listes.json'), 'utf8'));

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 16).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ppr-'));
const png = (w, h, couleur = { r: 40, g: 120, b: 200 }) => sharp({ create: { width: w, height: h, channels: 3, background: couleur } }).png().toBuffer();
const ROBOTS = 'User-agent: *\nDisallow: /wp-admin/\nDisallow: /cart/\n';
const SILENCE = async f => { const l = console.log, e = console.error; const sortie = []; console.log = (...a) => sortie.push(a.join(' ')); console.error = (...a) => sortie.push(a.join(' ')); try { return [await f(), sortie]; } finally { console.log = l; console.error = e; } };
const mkCli = (transport, dossier, plafond = 100) => P.fabriquerClient({ dossierCache: dossier, plafond, transport, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), suivi: RH.suiviHote() });
const pageDe = code => ({ CSV9C: F.csv9, CSV10C: F.csv10, '30thC': F.t30, CBB6C: F.gem })[code];
const transportPages = (appels = []) => ({ async get(url) {
    appels.push(url);
    if (url.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS };
    const l = P.TABLE.find(x => url === `https://www.pokipair.com/${x.page}/`);
    return l && pageDe(l.code) ? { status: 200, type: 'text/html; charset=UTF-8', texte: pageDe(l.code) } : { status: 404, type: 'text/html', texte: 'Not found' };
} });
const lignes4 = ['CSV9C', 'CSV10C', '30thC', 'CBB6C'].map(c => P.ligneDe(c));

(async () => {
    // ───────── le relevé ─────────
    await test('relevé : une requête par page de la table + robots.txt ; les tuiles sont lues et gardées ; reprise sans requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), appels = [];
        const r = await K.releve({ cli: mkCli(transportPages(appels), dossier), fichier, lignes: lignes4 });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 5); assert.strictEqual(r.relevees, 4); assert.strictEqual(r.refusees, 0); assert.strictEqual(r.tuiles, 14 + 9 + 4 + 7);
        assert.deepStrictEqual(r.requetesParHote, { 'www.pokipair.com': 5 }); assert.deepStrictEqual(r.codes, { 200: 5 });
        const rel = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.strictEqual(rel.CSV9C.tuiles.length, 14); assert.strictEqual(rel.CSV9C.verdict.ok, true); assert.strictEqual(rel.CSV9C.totalDominant, 208);
        await K.releve({ cli: mkCli(transportPages(appels), dossier), fichier, lignes: lignes4 });
        assert.strictEqual(appels.length, 5, 'reprise : rien redemandé');
        // le cache garde la page RÉDUITE, pas la page entière
        const gros = fs.readdirSync(dossier).filter(f => /csv9/.test(f)).map(f => fs.statSync(path.join(dossier, f)).size);
        assert.ok(gros.length && gros.every(n => n < F.csv9.length * 1.2));
    });
    await test('relevé : une page d\'un AUTRE set (titre) est refusée par la garde de lecture, mais relevée et comptée ; une 404 est « absente »', async () => {
        const fichier = path.join(tmp(), 'r.json');
        const transport = { async get(url) { if (url.endsWith('robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS }; if (url.includes('stellar')) return { status: 200, type: 'text/html', texte: F.csv10 }; return { status: 404, type: 'text/html', texte: 'nf' }; } };
        const r = await K.releve({ cli: mkCli(transport, tmp()), fichier, lignes: lignes4.slice(0, 2) });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(r.refusees, 1); assert.strictEqual(r.absentes, 1);
        assert.match(JSON.parse(fs.readFileSync(fichier, 'utf8')).CSV9C.verdict.motif, /titre/);
    });
    await test('relevé : un 403 arrête tout (arret-definitif, écrit) ; un robots.txt en 403 aussi ; le plafond arrête proprement', async () => {
        const f1 = path.join(tmp(), 'a.json');
        const r1 = await K.releve({ cli: mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: ROBOTS } : { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: f1, lignes: lignes4 });
        assert.strictEqual(r1.etat, 'arret-definitif'); assert.strictEqual(r1.relevees, 0);
        const r2 = await K.releve({ cli: mkCli({ async get() { return { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'b.json'), lignes: lignes4 });
        assert.strictEqual(r2.etat, 'arret-definitif');
        const r3 = await K.releve({ cli: mkCli(transportPages(), tmp(), 3), fichier: path.join(tmp(), 'c.json'), lignes: lignes4 });
        assert.strictEqual(r3.etat, 'plafond'); assert.strictEqual(r3.relevees, 2); assert.strictEqual(r3.restantes, 2);
    });
    await test('relevé : deux erreurs serveur de suite arrêtent ; une seule saute la page', async () => {
        let n = 0;
        const r = await K.releve({ cli: mkCli({ async get(u) { if (u.endsWith('robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS }; n++; return { status: 503, type: 'text/html', texte: 'indispo' }; } }, tmp()), fichier: path.join(tmp(), 'd.json'), lignes: lignes4 });
        assert.strictEqual(r.etat, 'serveur-indisponible'); assert.strictEqual(n, 2); assert.strictEqual(r.transitoires, 2);
    });
    await test('maximum : compté AVANT la première requête (robots + pages, ou robots + originaux), 6 s chacune ; ce qui est au cache ne compte pas', () => {
        const dossier = tmp(), F2 = K.fichiersDe(dossier, path.join(dossier, 'c'));
        let m = K.maximumReleve({ F: F2, releves: {}, plafondTotal: 600 });
        assert.strictEqual(m.total, 1 + P.TABLE.length); assert.strictEqual(m.secondes, (1 + P.TABLE.length) * 6);
        m = K.maximumReleve({ F: F2, releves: { CSV9C: { le: 'x' } }, plafondTotal: 600 });
        assert.strictEqual(m.total, P.TABLE.length);
        const unites = [{ url: 'https://media.pokipair.com/2026/08/10103101/a.png' }, { url: 'https://media.pokipair.com/2026/08/10103101/b.png' }, { url: 'https://media.pokipair.com/2026/08/10103101/b.png' }];
        m = K.maximumImages({ F: F2, hoteImages: P.HOTE_IMAGES, unites, indexImages: { 'https://media.pokipair.com/2026/08/10103101/a.png': { statut: 'ok' } }, plafondTotal: 600 });
        assert.strictEqual(m.total, 2); assert.match(m.detail, /originaux 1/);
    });

    // ───────── le plan, sur une FAUSSE base en lecture ─────────
    function fauxDb({ sets, lignes, cartes, images = [] }) {
        const col = {
            sets: { findOne: async q => sets.find(s => s._id === q._id) ?? null, find: () => ({ toArray: async () => sets }), countDocuments: async () => sets.length },
            cartes_produits: { find: q => ({ toArray: async () => lignes.filter(l => l.slugSet === q.slugSet) }), countDocuments: async () => lignes.length },
            cartes: { find: q => ({ project: () => ({ toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }), toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }) },
            images: { find: q => ({ toArray: async () => images.filter(d => q.carteId.$in.includes(d.carteId)) }), findOne: async q => images.find(d => d._id === q._id) ?? null }
        };
        return { collection: n => col[n] };
    }
    const SLUG = 'Stellar-Crystal';
    const baseDb = () => ({
        sets: [{ _id: SLUG, code: 'CSV9C', tirage: 'zh-hans' }],
        lignes: [{ slugSet: SLUG, carteId: 1, idProduct: 901, numeroFiche: '001', slug: 'Exeggcute-CSV9C001' }, { slugSet: SLUG, carteId: 2, idProduct: 902, numeroFiche: '002', slug: 'Lileep-CSV9C002' }, { slugSet: SLUG, carteId: 3, idProduct: 903, numeroFiche: '006', slug: 'Durant-ex-CSV9C006' }, { slugSet: SLUG, carteId: 4, idProduct: 904, numeroFiche: '017', slug: 'Autre-CSV9C017' }],
        cartes: [{ _id: 1, nomEn: 'Exeggcute', images: [{ set: SLUG, source: 'pikaqian', cleR2: 'pk/1', numero: '001', langue: 'zh-hans', w: 300, wOriginal: 300, basseDefinition: true }] }, { _id: 2, nomEn: 'Lileep', images: [{ set: SLUG, source: 'tcgdex', cleR2: 'td/2', numero: '002', langue: 'zh-hans', w: 600, wOriginal: 600 }] }, { _id: 3, nomEn: 'Durant ex', images: [] }, { _id: 4, nomEn: 'Rabsca', images: [] }],
        images: [{ _id: 'pk-1', source: 'pikaqian', set: SLUG, cleR2: 'pk/1', carteId: 1, etat: 'ok' }, { _id: 'td-2', source: 'tcgdex', set: SLUG, cleR2: 'td/2', carteId: 2, etat: 'ok' }]
    });
    const relevesPlan = () => ({ CSV9C: { le: 'x', verdict: { ok: true }, tuiles: P.lirePage(F.csv9).tuiles } });
    await test('plan : lu en LECTURE seule ; unités prouvées, décisions (remplace une basse définition / cède devant une image correcte / ajoute), dénominateurs par set', async () => {
        const { resume, unites, restes } = await K.construirePlan({ db: fauxDb(baseDb()), releves: relevesPlan() });
        const s9 = resume.parSet.find(s => s.code === 'CSV9C');
        assert.deepStrictEqual([s9.etat, s9.produits, s9.deja_servis, s9.dont_basse_definition, s9.sans_visuel, s9.unites], ['planifie', 4, 2, 1, 2, 3]);
        assert.deepStrictEqual(resume.restesParMotif, { 'nom-produit-different': 1 });
        assert.deepStrictEqual(restes.map(r => r.carteId), [4]);
        const par = Object.fromEntries(unites.map(u => [u.carteId, u.decision.action]));
        assert.deepStrictEqual(par, { 1: 'ajouter', 2: 'cede', 3: 'ajouter' });
        assert.strictEqual(unites.find(u => u.carteId === 1).decision.remplace.length, 1);
        assert.strictEqual(resume.aAjouter, 2); assert.strictEqual(resume.dontRemplacentUneBasseDefinition, 1);
        assert.deepStrictEqual(Object.keys(resume.decisions).sort(), ['CSV9C:ajouter', 'CSV9C:cede']);
        // les autres lignes de la table : set absent de la fausse base -> « set-refuse », dit et compté
        assert.ok(resume.parSet.filter(s => s.etat === 'set-refuse').length === P.TABLE.length - 1);
    });
    await test('plan : set au mauvais tirage ou au mauvais code = refusé sans lire ses produits ; page non relevée = dénominateur seul', async () => {
        const d = baseDb(); d.sets[0].tirage = 'intl';
        const r = await K.construirePlan({ db: fauxDb(d), releves: relevesPlan() });
        assert.match(r.resume.parSet.find(s => s.code === 'CSV9C').motif, /tirage intl/); assert.strictEqual(r.unites.length, 0);
        const d2 = baseDb(); d2.sets[0].code = 'XXX';
        assert.match((await K.construirePlan({ db: fauxDb(d2), releves: relevesPlan() })).resume.parSet.find(s => s.code === 'CSV9C').motif, /code XXX/);
        const r3 = await K.construirePlan({ db: fauxDb(baseDb()), releves: {} });
        const s = r3.resume.parSet.find(x => x.code === 'CSV9C');
        assert.deepStrictEqual([s.etat, s.produits, s.deja_servis], ['non-relevee', 4, 2]); assert.strictEqual(r3.unites.length, 0);
    });
    await test('plan : une page refusée par la garde de lecture ne produit AUCUNE unité (même si ses tuiles se lisent)', async () => {
        const rel = { CSV9C: { le: 'x', verdict: { ok: false, motif: 'titre' }, tuiles: P.lirePage(F.csv9).tuiles } };
        const r = await K.construirePlan({ db: fauxDb(baseDb()), releves: rel });
        assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.resume.parSet.find(s => s.code === 'CSV9C').etat, 'page-refusee');
    });
    await test('plan : produits sans carte lue = ÉCHEC bruyant (§41), jamais un plan vide plausible', async () => {
        const d = baseDb(); d.cartes = [];
        await assert.rejects(() => K.construirePlan({ db: fauxDb(d), releves: relevesPlan() }), /LECTURE VIDE|appariement impossible/);
    });

    // ───────── le téléchargement ─────────
    const UNITES = [1, 2, 3].map(i => ({ carteId: 100 + i, slugSet: SLUG, numero: String(i), produits: [900 + i], url: `https://media.pokipair.com/2026/08/10103101/Stellar-Crystal-${i}.png`, idSource: String(i), variante: 'normal', groupe: 'CSV9C', carteNom: `Nom ${i}`, nomSource: `Nom ${i}`, numeroSource: `00${i}/208` }));
    const transportImages = (octetsParUrl, appels = []) => ({ async get(url) {
        appels.push(url);
        if (url.endsWith('/robots.txt')) return { status: 404, type: 'text/html', texte: 'nf' };
        const o = octetsParUrl[url];
        if (o === 404) return { status: 404, type: 'text/html', texte: 'nf' };
        if (o === 'html') return { status: 200, type: 'text/html', texte: '<html>introuvable</html>' };
        return { status: 200, type: 'image/png', octets: o };
    } });
    await test('téléchargement : robots.txt de l\'hôte des images lu (404 = aucune règle) ; vraie image au cache + index ; trop-petit AVEC sa largeur ; 404 absent ; forme ; reprise sans requête ; progression', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'images.json'), progression = path.join(tmp(), 'p.json');
        const bon = await png(350, 482), petit = await png(340, 468), carre = await png(400, 400);
        const us = [...UNITES, { ...UNITES[0], carteId: 104, url: 'https://media.pokipair.com/2026/08/10103101/Stellar-Crystal-4.png' }, { ...UNITES[0], carteId: 105, url: 'https://media.pokipair.com/2026/08/10103101/Stellar-Crystal-5.png' }];
        const octets = { [us[0].url]: bon, [us[1].url]: petit, [us[2].url]: 404, [us[3].url]: carre, [us[4].url]: Buffer.from('<html>pas une image</html>') };
        const appels = [];
        const r = await RC.telecharger({ SRC: P.SRC, unites: us, cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: P.HOTE_IMAGES, progression });
        assert.strictEqual(r.etat, 'pause-hote', 'des octets qui ne sont pas une image sous image/png = réponse inattendue : pause de l\'hôte');
        const r2 = await RC.telecharger({ SRC: P.SRC, unites: us.slice(0, 4), cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: P.HOTE_IMAGES, progression });
        assert.strictEqual(r2.etat, 'termine'); assert.deepStrictEqual(r2.parStatut, { ok: 1, 'trop-petit': 1, absent: 1, 'forme-inattendue': 1 });
        assert.deepStrictEqual(r2.tropPetits.map(t => t.largeur), [340]);
        const avant = appels.length;
        await RC.telecharger({ SRC: P.SRC, unites: us.slice(0, 4), cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: P.HOTE_IMAGES });
        assert.strictEqual(appels.length, avant, 'reprise : rien redemandé');
        assert.ok(appels.some(u => u === 'https://media.pokipair.com/robots.txt'));
        const prog = JSON.parse(fs.readFileSync(progression, 'utf8'));
        assert.strictEqual(prog.total, 4); assert.strictEqual(prog.jugees, 4); assert.strictEqual(prog.etat, 'termine');
        assert.ok(require('./collecte-cartes/recolte-hote').lireDuCache(dossier, us[0].url).octets.length > 100);
    });
    await test('téléchargement : le robots.txt de l\'hôte des images en 403 = images FERMÉES (arrêt définitif, écrit), aucune image demandée', async () => {
        const appels = [], pauses = tmp();
        const cli = P.fabriquerClient({ dossierCache: tmp(), plafond: 50, cadenceMs: 0, pause: async () => {}, dossierPauses: pauses, suivi: RH.suiviHote(), transport: { async get(u) { appels.push(u); return { status: 403, type: 'text/html', texte: 'Forbidden' }; } } });
        const r = await RC.telecharger({ SRC: P.SRC, unites: UNITES, cli, fichier: path.join(tmp(), 'i.json'), hoteImages: P.HOTE_IMAGES });
        assert.strictEqual(r.etat, 'arret-definitif'); assert.deepStrictEqual(appels, ['https://media.pokipair.com/robots.txt']);
        assert.ok(fs.readdirSync(pauses).some(f => /^ARRET-HOTE-pokipair\.com/.test(f)));
    });
    await test('téléchargement : une fausse absence n\'est redemandée qu\'APRÈS 24 h (seconde preuve) ; avant, elle tient ; une seconde fausse absence devient « absent »', async () => {
        const url = UNITES[0].url, maintenant = Date.parse('2026-10-25T12:00:00Z');
        let n = 0;
        const html = { async get(u) { if (u.endsWith('robots.txt')) return { status: 404, type: 'text/html', texte: 'nf' }; n++; return { status: 200, type: 'text/html', texte: '<html>introuvable</html>' }; } };
        const fichier = path.join(tmp(), 'f.json');
        fs.writeFileSync(fichier, JSON.stringify({ [url]: { statut: 'fausse-absente', le: '2026-10-25T11:00:00.000Z' } }));
        await RC.telecharger({ SRC: P.SRC, unites: UNITES.slice(0, 1), cli: mkCli(html, tmp()), fichier, hoteImages: P.HOTE_IMAGES, now: () => maintenant });
        assert.strictEqual(n, 0, 'vue il y a 1 h : on ne redemande pas');
        fs.writeFileSync(fichier, JSON.stringify({ [url]: { statut: 'fausse-absente', le: '2026-10-24T10:00:00.000Z' } }));
        await RC.telecharger({ SRC: P.SRC, unites: UNITES.slice(0, 1), cli: mkCli(html, tmp()), fichier, hoteImages: P.HOTE_IMAGES, now: () => maintenant });
        assert.strictEqual(n, 1, 'vue il y a 26 h : on la redemande une fois');
    });
    await test('téléchargement : l\'hôte des images est obligatoire (sinon aucune image ne partirait sans robots.txt lu)', async () => {
        await assert.rejects(() => RC.telecharger({ SRC: P.SRC, unites: UNITES, cli: mkCli(transportImages({}), tmp()), fichier: path.join(tmp(), 'i.json') }), /hôte des images/);
    });
    await test('téléchargement : une page HTML servie à la place d\'une image (200 text/html) = fausse absence (seconde preuve après 24 h) ; un 5xx isolé saute, deux de suite arrêtent', async () => {
        const r = await RC.telecharger({ SRC: P.SRC, unites: UNITES.slice(0, 1), cli: mkCli(transportImages({ [UNITES[0].url]: 'html' }), tmp()), fichier: path.join(tmp(), 'a.json'), hoteImages: P.HOTE_IMAGES });
        assert.deepStrictEqual(r.parStatut, { 'fausse-absente': 1 });
        let n = 0;
        const transport = { async get(u) { if (u.endsWith('robots.txt')) return { status: 404, type: 'text/html', texte: 'nf' }; n++; return { status: 503, type: 'text/html', texte: 'indispo' }; } };
        const r2 = await RC.telecharger({ SRC: P.SRC, unites: UNITES, cli: mkCli(transport, tmp()), fichier: path.join(tmp(), 'b.json'), hoteImages: P.HOTE_IMAGES });
        assert.strictEqual(r2.etat, 'serveur-indisponible'); assert.strictEqual(n, 2);
    });
    await test('le plafond de téléchargement arrête proprement (reprise à la relance)', async () => {
        const bon = await png(350, 482), octets = Object.fromEntries(UNITES.map(u => [u.url, bon]));
        const r = await RC.telecharger({ SRC: P.SRC, unites: UNITES, cli: mkCli(transportImages(octets), tmp(), 3), fichier: path.join(tmp(), 'i.json'), hoteImages: P.HOTE_IMAGES });
        assert.strictEqual(r.etat, 'plafond'); assert.strictEqual(r.restantes, 1);
    });

    // ───────── les planches ─────────
    await test('planches : lisibles (15 vignettes par planche), nommées planche-<code>-N.jpg, un fichier de description ; l\'échantillon tourne sur les groupes', async () => {
        const dossier = tmp(), sortie = tmp();
        const bon = await png(350, 482), us = [], idx = {};
        const transport = { async get(u) { return u.endsWith('robots.txt') ? { status: 404, type: 'text/html', texte: 'nf' } : { status: 200, type: 'image/png', octets: bon }; } };
        const cli = mkCli(transport, dossier, 400);
        await cli.initialiserRobots(P.HOTE_IMAGES);
        for (let i = 0; i < 40; i++) {
            const u = { ...UNITES[0], carteId: 200 + i, numero: String(i), url: `https://media.pokipair.com/2026/08/10103101/Stellar-Crystal-${i}.png`, groupe: i % 2 ? 'CSV9C' : 'CSV10C' };
            const r = await cli.lireImage(u.url); us.push(u); idx[u.url] = { statut: 'ok', w: 350, h: 482, sha256: r.meta.sha256 };
        }
        const p = await RC.planches({ SRC: P.SRC, unites: us, indexImages: idx, dossierCache: dossier, sortieDossier: sortie, n: 20, prefixe: 'planche-ppr' });
        assert.strictEqual(p.images, 20); assert.strictEqual(p.planches.length, 2); assert.deepStrictEqual(p.parGroupe, { CSV10C: 10, CSV9C: 10 });
        for (const f of p.planches) { assert.match(path.basename(f), /^planche-ppr-\d\.jpg$/); assert.ok(fs.statSync(f).size > 1000); }
        assert.strictEqual(JSON.parse(fs.readFileSync(path.join(sortie, 'planche-ppr.json'), 'utf8')).length, 20);
        const tout = await RC.planches({ SRC: P.SRC, unites: us, indexImages: idx, dossierCache: dossier, sortieDossier: sortie, n: 500, prefixe: 'toutes' });
        assert.strictEqual(tout.images, 40);
        await assert.rejects(() => RC.planches({ SRC: P.SRC, unites: [], indexImages: {}, dossierCache: dossier, sortieDossier: sortie }), /aucune image/);
    });

    // ───────── la décision et l'écriture sur de FAUX modèles ─────────
    process.env.R2_BUCKET_IMAGES = process.env.R2_BUCKET_IMAGES || 'banc-sans-bucket-reel';
    async function preparer(n, { larges = {}, statuts = {} } = {}) {
        const dossier = tmp(), octetsParUrl = {};
        const cli = mkCli(transportImages(octetsParUrl), dossier, 200);
        await cli.initialiserRobots(P.HOTE_IMAGES);
        const us = [], idx = {};
        for (let i = 0; i < n; i++) {
            const u = { carteId: 100 + i, slugSet: SLUG, numero: String(i + 1).padStart(3, '0'), produits: [7000 + i], slugProduit: `P-${i}`, url: `https://media.pokipair.com/2026/08/10103101/Stellar-Crystal-${i}.png`, idSource: String(i), variante: 'normal', groupe: 'CSV9C', carteNom: `N${i}`, nomSource: `N${i}`, numeroSource: `${i}/208`, preuveNeutre: `set CSV9C n° ${i}` };
            const larg = larges[i] ?? 350, haut = Math.round(larg * 1.377);
            octetsParUrl[u.url] = await png(larg, haut);
            const r = await cli.lireImage(u.url);
            us.push(u);
            idx[u.url] = statuts[i] ? { statut: statuts[i] } : { statut: larg >= 350 ? 'ok' : 'trop-petit', w: larg, h: haut, sha256: r.meta.sha256 };
        }
        const deposes = [];
        return { dossier, us, idx, deposes, deposer: async (b, c) => { deposes.push(c); }, vignetter: async () => ({ vg: { entrees: 0, fabriquees: 0, echecs: 0 } }) };
    }
    const cartesVides = n => Array.from({ length: n }, (_, i) => ({ _id: 100 + i, images: [] }));
    const lancer = (p, M, o = {}) => RC.ecrire({ SRC: P.SRC, unites: p.us, M, dossierCache: p.dossier, indexImages: p.idx, deposer: p.deposer, vignetter: p.vignetter, ...o });

    await test('écriture : un ajout (document, entrée neutre, objet R2, bilan du set vérifié) — traçabilité complète', async () => {
        const p = await preparer(1), { M, etat } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.reel, 1); assert.strictEqual(r.resultats[0].etat, 'verifie');
        const c = etat.carte(100);
        assert.strictEqual(c.images.length, 1);
        const e = c.images[0];
        assert.deepStrictEqual([e.source, e.lot, e.retirable, e.langue, e.numero, e.set, e.urlOriginal], ['ppr', 'ppr-2026-10', true, 'zh-hans', '001', SLUG, p.us[0].url]);
        assert.ok(e.collecteLe); assert.strictEqual(e.basseDefinition, undefined); assert.strictEqual(e.mention, '© Pokémon / The Pokémon Company');
        assert.deepStrictEqual(p.deposes, [`ppr/${SLUG}/001-100-zh-hans.webp`]);
        const d = etat.image(`ppr/${SLUG}/100/001/zh-hans`);
        assert.strictEqual(d.etat, 'ok'); assert.strictEqual(d.preuve, 'set CSV9C n° 0'); assert.strictEqual(d.wOriginal, 350);
        assert.deepStrictEqual(r.orphelins, []);
        assert.ok(!/poki/i.test(JSON.stringify({ ...e, urlOriginal: 0 })));
        assert.strictEqual(etat.set(SLUG).bilanLotPpr.concordance, true);
    });
    await test('écriture : une basse définition (300 px, autre source, même set, même numéro, même langue) est REMPLACÉE ; son document passe à « remplace », son adresse gardée', async () => {
        const p = await preparer(1);
        const bas = { set: SLUG, numero: '001', langue: 'zh-hans', source: 'pikaqian', cleR2: 'pk/a', w: 300, wOriginal: 300, basseDefinition: true, urlOriginal: 'https://exemple.test/a.webp' };
        const { M, etat } = fauxModeles({ cartes: [{ _id: 100, images: [bas] }], images: [{ _id: 'pk1', source: 'pikaqian', set: SLUG, cleR2: 'pk/a', carteId: 100, etat: 'ok', urlOriginal: 'https://exemple.test/a.webp' }], sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.resultats[0].remplacees, 1); assert.deepStrictEqual(etat.carte(100).images.map(e => e.source), ['ppr']);
        const d = etat.image('pk1'); assert.strictEqual(d.etat, 'remplace'); assert.strictEqual(d.remplacePar.source, 'ppr'); assert.strictEqual(d.urlOriginal, 'https://exemple.test/a.webp');
    });
    await test('écriture : devant une image correcte au-dessus du seuil (600 px, autre source) l\'unité CÈDE : rien déposé, rien écrit, entrée intacte', async () => {
        const p = await preparer(1);
        const bonne = { set: SLUG, numero: '001', langue: 'zh-hans', source: 'tcgdex', cleR2: 't', w: 600, wOriginal: 600 };
        const { M, etat, journal } = fauxModeles({ cartes: [{ _id: 100, images: [bonne] }], images: [{ _id: 't1', source: 'tcgdex', set: SLUG, cleR2: 't', carteId: 100, etat: 'ok' }], sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 0 }));
        assert.strictEqual(r.reel, 0); assert.strictEqual(r.cedees, 1); assert.deepStrictEqual(p.deposes, []); assert.deepStrictEqual(etat.carte(100).images.map(e => e.source), ['tcgdex']); assert.deepStrictEqual(journal.filter(j => j[0] === 'carte'), []);
    });
    await test('écriture : une image sous le seuil (340 px) n\'est jamais écrite (trop-petit compté) ; absente, forme inattendue : écartées, comptées', async () => {
        const p = await preparer(4, { larges: { 1: 340 }, statuts: { 2: 'absent', 3: 'forme-inattendue' } });
        const { M } = fauxModeles({ cartes: cartesVides(4), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 1 }));
        assert.strictEqual(r.reel, 1); assert.strictEqual(r.tropPetits, 1); assert.strictEqual(r.ecartees, 2); assert.strictEqual(r.code, 0);
    });
    await test('écriture : --attendu faux REFUSÉ (rien déposé, rien écrit) et le nombre réel est imprimé AVANT de refuser', async () => {
        const p = await preparer(3);
        const { M, journal } = fauxModeles({ cartes: cartesVides(3), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r, sortie] = await SILENCE(() => lancer(p, M, { attendu: 5 }));
        assert.strictEqual(r.code, 2); assert.strictEqual(r.etat, 'refuse-attendu'); assert.strictEqual(r.reel, 3); assert.deepStrictEqual(p.deposes, []); assert.deepStrictEqual(journal.filter(j => j[0] !== 'set'), []);
        assert.ok(sortie.some(l => /unités à ajouter dont l'image est ok : 3/.test(l)));
    });
    await test('écriture : le set au mauvais tirage est refusé AVANT tout dépôt ; la base au-delà de 400 Mo aussi', async () => {
        const p = await preparer(1);
        const { M } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SLUG, tirage: 'intl' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 1 }));
        assert.strictEqual(r.resultats[0].etat, 'refuse-set'); assert.strictEqual(r.code, 1); assert.deepStrictEqual(p.deposes, []);
        const { M: M2 } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r2] = await SILENCE(() => lancer(p, M2, { attendu: 1, stopOctets: 10 }));
        assert.strictEqual(r2.resultats[0].etat, 'refuse-taille-base'); assert.deepStrictEqual(p.deposes, []);
    });
    await test('écriture : un échec R2 n\'écrit RIEN en base ; R2 réussit puis Mongo échoue -> l\'objet R2 est un ORPHELIN listé, la relance le reprend', async () => {
        const p = await preparer(2);
        const { M, journal } = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 2, deposer: async () => { throw new Error('R2 en panne'); } }));
        assert.strictEqual(r.code, 1); assert.match(r.resultats[0].erreurJointure, /R2 en panne/); assert.deepStrictEqual(journal.filter(j => j[0] === 'carte'), []);
        let panne = true;
        const f2 = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SLUG, tirage: 'zh-hans' }], echecs: { carte: (f, u) => (panne && u.$push ? 'Mongo en panne' : undefined) } });
        const [r2] = await SILENCE(() => lancer(p, f2.M, { attendu: 2 }));
        assert.strictEqual(r2.code, 1); assert.deepStrictEqual(r2.orphelins, [`ppr/${SLUG}/001-100-zh-hans.webp`]);
        panne = false;
        const [r3] = await SILENCE(() => lancer(p, f2.M, { attendu: 2 }));
        assert.strictEqual(r3.code, 0); assert.strictEqual(f2.etat.carte(100).images.length, 1); assert.strictEqual(f2.etat.carte(101).images.length, 1);
    });
    await test('écriture : rejouée, rien ne se double (reprise : déjà posée, n\'entre pas dans --attendu)', async () => {
        const p = await preparer(1), { M, etat } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        await SILENCE(() => lancer(p, M, { attendu: 1 }));
        const [r2] = await SILENCE(() => lancer(p, M, { attendu: 0 }));
        assert.strictEqual(r2.reel, 0); assert.strictEqual(r2.dejaPosees, 1); assert.strictEqual(etat.carte(100).images.length, 1);
    });
    await test('écriture : un visuel RETIRÉ (document « retire ») ne revient jamais par une recollecte', async () => {
        const p = await preparer(1);
        const { M, etat } = fauxModeles({ cartes: cartesVides(1), images: [{ _id: `ppr/${SLUG}/100/001/zh-hans`, source: 'ppr', etat: 'retire', carteId: 100 }], sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 0 }));
        assert.strictEqual(r.reel, 0); assert.strictEqual(r.retires, 1); assert.strictEqual(etat.carte(100).images.length, 0);
    });
    await test('écriture : le cache altéré (sha256) est refusé et compté ; --compter ne fait aucune écriture et rend le nombre d\'--attendu', async () => {
        const p = await preparer(2);
        const { M, journal } = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        p.idx[p.us[1].url] = { ...p.idx[p.us[1].url], sha256: '0'.repeat(64) };
        const [r] = await SILENCE(() => lancer(p, M, { compterSeulement: true }));
        assert.strictEqual(r.reel, 1); assert.strictEqual(r.altere, 1); assert.deepStrictEqual(journal, []);
    });
    await test('décision par le lecteur NATIF (lecture seule) = la décision par les modèles : le même compte', async () => {
        const base = baseDb();
        const d = RC.lecteurNatif(fauxDb(base));
        const p = await preparer(1);
        const us = [{ ...p.us[0], carteId: 1, numero: '001', produits: [901] }];
        const [a] = await RC.decider(P.SRC, us, d);
        assert.strictEqual(a.decision.action, 'ajouter'); assert.strictEqual(a.decision.remplace.length, 1);
        const { M } = fauxModeles({ cartes: base.cartes, images: base.images, sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [b] = await RC.decider(P.SRC, us, RC.lecteurModeles(M));
        assert.deepStrictEqual(b.decision.action, a.decision.action);
    });

    // ───────── le retrait ─────────
    await test('retrait : à blanc par défaut ; EXACT — la source ET le lot, jamais une autre source ni un autre lot ; clés R2 des vignettes comprises', () => {
        const cartes = [{ _id: 1, images: [{ source: 'ppr', lot: 'ppr-2026-10', set: 'A', cleR2: 'ppr/A/1', vignette: { cleR2: 'vignettes/ppr/A/1' } }, { source: 'autre', set: 'A', cleR2: 'x' }] }, { _id: 2, images: [{ source: 'ppr', lot: 'ppr-2026-10', set: 'B', cleR2: 'ppr/B/2' }, { source: 'ppr', lot: 'ppr-2027-01', set: 'B', cleR2: 'ppr/B/3' }] }, { _id: 3, images: [{ source: 'ppr', lot: 'ppr-2027-01', set: 'B', cleR2: 'ppr/B/4' }] }];
        const docs = [{ source: 'ppr', lot: 'ppr-2026-10', etat: 'ok', cleR2: 'ppr/A/1' }, { source: 'ppr', lot: 'ppr-2026-10', etat: 'retire', cleR2: 'ppr/B/2' }, { source: 'autre', etat: 'ok', cleR2: 'x' }, { source: 'ppr', lot: 'ppr-2027-01', etat: 'ok', cleR2: 'ppr/B/3' }];
        const p = RETIRER.planDeRetrait(cartes, docs, P.SRC);
        assert.deepStrictEqual([p.entrees, p.docs, p.cartes, p.parSet], [2, 1, [1, 2], { A: 1, B: 1 }]);
        assert.deepStrictEqual(p.cles.sort(), ['ppr/A/1', 'ppr/B/2', 'vignettes/ppr/A/1']);
        const lance = (...a) => spawnSync(process.execPath, [path.join(__dirname, 'retirer-visuels-recolte.js'), ...a], { encoding: 'utf8', timeout: 20000 });
        for (const a of [['--inconnu', '--source=ppr'], ['--effacer-r2', '--source=ppr'], [], ['--source=ctr'], ['--source=ppr', '--source=tcs', '--zzz']]) assert.strictEqual(lance(...a).status, 2, JSON.stringify(a));
    });
    await test('retrait : l\'écriture retire les entrées du lot, passe les documents à « retire », nettoie le bilan, relit', async () => {
        const entrees = [{ source: 'ppr', lot: 'ppr-2026-10', set: 'A', cleR2: 'ppr/A/1' }, { source: 'autre', set: 'A', cleR2: 'x' }];
        const cartes = [{ _id: 1, images: entrees.map(e => ({ ...e })) }], docs = [{ _id: 'd1', source: 'ppr', lot: 'ppr-2026-10', etat: 'ok', cleR2: 'ppr/A/1' }], sets = [{ _id: 'A', bilanLotPpr: { x: 1 } }];
        const db = { collection: n => ({
            cartes: { find: () => ({ toArray: async () => cartes.filter(c => c.images.some(e => e.source === 'ppr')) }), updateOne: async (f, u) => { const c = cartes.find(x => x._id === f._id); const av = c.images.length; c.images = c.images.filter(e => !(e.source === u.$pull.images.source && e.lot === u.$pull.images.lot)); return { modifiedCount: av !== c.images.length ? 1 : 0 }; } },
            images: { find: () => ({ toArray: async () => docs.filter(d => d.source === 'ppr') }), updateOne: async (f, u) => { Object.assign(docs.find(d => d._id === f._id), u.$set); return { modifiedCount: 1 }; } },
            sets: { find: () => ({ toArray: async () => sets.filter(s => s.bilanLotPpr) }), updateOne: async (f, u) => { delete sets[0].bilanLotPpr; return { modifiedCount: 1 }; } } })[n] };
        const aBlanc = await RETIRER.retirerLot(db, P.SRC, { ecrire: false });
        assert.strictEqual(aBlanc.entrees, 1); assert.strictEqual(cartes[0].images.length, 2, 'à blanc : rien modifié');
        const r = await RETIRER.retirerLot(db, P.SRC, { ecrire: true });
        assert.deepStrictEqual([r.nC, r.nI, r.reste, r.setsNettoyes], [1, 1, 0, ['A']]);
        assert.deepStrictEqual(cartes[0].images.map(e => e.source), ['autre']); assert.strictEqual(docs[0].etat, 'retire'); assert.strictEqual(sets[0].bilanLotPpr, undefined);
    });

    // ───────── TOUR 1 : D1 (le retrait remet ce que le lot a remplacé), D4 (date du téléchargement), D5 (garde de reprise) ─────────
    const { fauxDbNatif } = require('./faux-db-natif');
    const { compterEtat, comparer } = require('./collecte-cartes/garde-lot');
    const HOTE = require('./collecte-cartes/recolte-hote');
    const pkEntree = (id, num) => ({ set: SLUG, numero: num, langue: 'zh-hans', source: 'pikaqian', cleR2: `pikaqian/${SLUG}/${num}-${id}-zh-hans.webp`, w: 300, wOriginal: 300, basseDefinition: true, sha256: `${id}`.padStart(64, 'a'), urlOriginal: `https://exemple.test/pk/${id}`, vignette: { cleR2: `vignettes/pikaqian/${SLUG}/${num}-${id}.webp`, w: 200, h: 275 }, jointeLe: '2026-10-11T00:00:00.000Z' });
    const pkDoc = (id, num) => ({ _id: `pikaqian/${SLUG}/${id}/${num}/zh-hans`, source: 'pikaqian', set: SLUG, cleR2: pkEntree(id, num).cleR2, carteId: id, numero: num, etat: 'ok', urlOriginal: `https://exemple.test/pk/${id}`, wOriginal: 300, basseDefinition: true });
    const autreSet = id => ({ set: 'Autre-Set', numero: '009', langue: 'en', source: 'tcgdex', cleR2: `tcgdex/Autre-Set/009-${id}.webp`, w: 600, wOriginal: 600 });
    const triees = c => [...(c.images || [])].sort((a, b) => String(a.cleR2).localeCompare(String(b.cleR2)));
    await test('D1 ALLER-RETOUR : écriture (remplacements ET ajout pur) puis retrait = l\'état d\'AVANT (cartes, entrées avec leur vignette, documents « ok » sans remplacePar, bilan du set)', async () => {
        const p = await preparer(3);
        const cartes0 = [{ _id: 100, images: [pkEntree(100, '001'), autreSet(100)] }, { _id: 101, images: [pkEntree(101, '002')] }, { _id: 102, images: [autreSet(102)] }];
        const docs0 = [pkDoc(100, '001'), pkDoc(101, '002')], sets0 = [{ _id: SLUG, tirage: 'zh-hans' }];
        const { M, etat } = fauxModeles({ cartes: cartes0, images: docs0, sets: sets0 });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 3 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.resultats[0].remplacees, 2);
        // l'écriture a GARDÉ ce qu'elle a remplacé, sur le document du lot
        const doc100 = etat.image(`ppr/${SLUG}/100/001/zh-hans`);
        assert.strictEqual(doc100.remplaceEntrees.length, 1); assert.deepStrictEqual(doc100.remplaceEntrees[0], pkEntree(100, '001'));
        assert.strictEqual(etat.image(`ppr/${SLUG}/102/003/zh-hans`).remplaceEntrees, undefined, 'un ajout pur ne remplace rien');
        assert.strictEqual(etat.image(pkDoc(100, '001')._id).etat, 'remplace');
        // le retrait, à blanc d'abord : il annonce ce qu'il remet
        const apresEcriture = { cartes: [100, 101, 102].map(i => etat.carte(i)), images: etat.images(), sets: [etat.set(SLUG)] };
        const { db, etat: etatDb } = fauxDbNatif(apresEcriture);
        const aBlanc = await RETIRER.retirerLot(db, P.SRC, { ecrire: false });
        assert.strictEqual(aBlanc.aRemettre, 2); assert.strictEqual(aBlanc.entrees, 3);
        const plan = await RETIRER.planLu(db, P.SRC);
        const prevu = RETIRER.cartesApresRetrait(plan.cartesLues, plan.documentsLus, P.SRC);
        const annonce = comparer(compterEtat({ cartes: plan.cartesLues }), compterEtat({ cartes: prevu })).baisses;
        assert.ok(annonce.length >= 1 && annonce.every(b => b.baisse === 1), `la seule vraie baisse est celle de l'ajout pur : ${JSON.stringify(annonce)}`);
        const rr = await RETIRER.retirerLot(db, P.SRC, { ecrire: true });
        assert.deepStrictEqual([rr.nRemises, rr.nDocsRestaures, rr.nDocsNonRestaures, rr.reste], [2, 2, 0, 0]);
        // l'état d'après le retrait = l'état d'avant l'écriture
        const apres = etatDb.cartes();
        for (const i of [100, 101, 102]) assert.deepStrictEqual(triees(apres.find(c => c._id === i)), triees(cartes0.find(c => c._id === i)), `carte ${i}`);
        for (const d0 of docs0) assert.deepStrictEqual(etatDb.images().find(d => d._id === d0._id), d0, `document ${d0._id}`);
        assert.ok(etatDb.images().filter(d => d.source === 'ppr').every(d => d.etat === 'retire'));
        assert.strictEqual(etatDb.sets()[0].bilanLotPpr, undefined);
        // rejoué : rien ne se remet une seconde fois
        const encore = await RETIRER.retirerLot(db, P.SRC, { ecrire: true });
        assert.strictEqual(encore.nRemises, 0); assert.deepStrictEqual(triees(etatDb.cartes().find(c => c._id === 100)), triees(cartes0[0]));
    });
    await test('D1 : un document dont l\'état d\'avant n\'était pas « ok » est rendu EXACTEMENT à cet état (jamais « ok » par défaut) ; sans état d\'avant écrit, il n\'est pas touché', async () => {
        const entree = pkEntree(100, '001'), lot = { _id: `ppr/${SLUG}/100/001/zh-hans`, source: 'ppr', lot: 'ppr-2026-10', set: SLUG, carteId: 100, cleR2: `ppr/${SLUG}/001-100-zh-hans.webp`, etat: 'ok', remplaceEntrees: [entree],
            remplaceDocuments: [{ source: 'pikaqian', set: SLUG, cleR2: entree.cleR2, etat: 'a-reverifier', remplacePar: { source: 'ancien', cleR2: 'x' }, remplaceLe: '2026-01-01T00:00:00.000Z' }] };
        const docRemplace = { _id: 'd', source: 'pikaqian', set: SLUG, cleR2: entree.cleR2, etat: 'remplace', remplacePar: { source: 'ppr', cleR2: lot.cleR2 }, remplaceLe: '2026-10-25T00:00:00.000Z' };
        const { db, etat } = fauxDbNatif({ cartes: [{ _id: 100, images: [{ source: 'ppr', lot: 'ppr-2026-10', set: SLUG, cleR2: lot.cleR2 }] }], images: [lot, docRemplace], sets: [] });
        const r = await RETIRER.retirerLot(db, P.SRC, { ecrire: true });
        assert.strictEqual(r.nRemises, 1);
        assert.deepStrictEqual(etat.images().find(d => d._id === 'd'), { _id: 'd', source: 'pikaqian', set: SLUG, cleR2: entree.cleR2, etat: 'a-reverifier', remplacePar: { source: 'ancien', cleR2: 'x' }, remplaceLe: '2026-01-01T00:00:00.000Z' });
        const sans = { ...lot, remplaceDocuments: [] }, { db: db2, etat: e2 } = fauxDbNatif({ cartes: [{ _id: 100, images: [{ source: 'ppr', lot: 'ppr-2026-10', set: SLUG, cleR2: lot.cleR2 }] }], images: [sans, docRemplace], sets: [] });
        const r2 = await RETIRER.retirerLot(db2, P.SRC, { ecrire: true });
        assert.deepStrictEqual([r2.nRemises, r2.nDocsNonRestaures], [1, 1]); assert.strictEqual(e2.images().find(d => d._id === 'd').etat, 'remplace');
    });
    await test('D1 : une écriture REPRISE n\'efface pas ce qu\'elle a déjà noté ; une écriture interrompue entre la note et la sortie ne remet rien de faux (l\'entrée présente n\'est pas doublée)', async () => {
        const p = await preparer(1), cartes0 = [{ _id: 100, images: [pkEntree(100, '001')] }];
        const { M, etat } = fauxModeles({ cartes: cartes0, images: [pkDoc(100, '001')], sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        await SILENCE(() => lancer(p, M, { attendu: 1 }));
        await SILENCE(() => lancer(p, M, { attendu: 0 }));
        assert.strictEqual(etat.image(`ppr/${SLUG}/100/001/zh-hans`).remplaceEntrees.length, 1);
        // la note existe mais l'entrée n'était pas sortie (crash avant) : le retrait la trouve déjà là
        const { db, etat: e2 } = fauxDbNatif({ cartes: [{ _id: 100, images: [pkEntree(100, '001'), etat.carte(100).images.find(e => e.source === 'ppr')] }], images: etat.images(), sets: [] });
        const r = await RETIRER.retirerLot(db, P.SRC, { ecrire: true });
        assert.strictEqual(r.nRemises, 0); assert.strictEqual(e2.cartes()[0].images.filter(e => e.source === 'pikaqian').length, 1);
    });
    await test('D4 : collecteLe et telechargeLe sont la date du TÉLÉCHARGEMENT lue au cache ; jointeLe, celle de l\'écriture', async () => {
        const p = await preparer(1), url = p.us[0].url, f = path.join(p.dossier, HOTE.nomCache(url));
        const meta = JSON.parse(fs.readFileSync(f, 'utf8')); meta.le = '2026-10-20T08:00:00.000Z'; fs.writeFileSync(f, JSON.stringify(meta));
        const { M, etat } = fauxModeles({ cartes: cartesVides(1), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const avant = Date.now();
        await SILENCE(() => lancer(p, M, { attendu: 1 }));
        const e = etat.carte(100).images[0], d = etat.image(`ppr/${SLUG}/100/001/zh-hans`);
        assert.strictEqual(new Date(e.collecteLe).toISOString(), '2026-10-20T08:00:00.000Z'); assert.strictEqual(new Date(d.collecteLe).toISOString(), '2026-10-20T08:00:00.000Z'); assert.strictEqual(new Date(d.telechargeLe).toISOString(), '2026-10-20T08:00:00.000Z');
        assert.ok(new Date(e.jointeLe).getTime() >= avant, 'jointeLe = l\'écriture');
    });
    await test('D5 : une REPRISE sur une carte à deux numéros du même set (l\'un déjà posé) est « verifie », sans faux ❌ ; un VRAI manque (l\'entrée jamais posée) crie encore', async () => {
        const p = await preparer(2);
        p.us[1] = { ...p.us[1], carteId: 100 };                          // la carte 100 porte les numéros 001 et 002 du même set
        const posee = { set: SLUG, source: 'ppr', lot: 'ppr-2026-10', cleR2: P.SRC.cleR2(SLUG, '001', 100), numero: '001', langue: 'zh-hans', w: 350, wOriginal: 350 };
        const { M, etat } = fauxModeles({ cartes: [{ _id: 100, images: [posee] }], images: [{ _id: P.SRC.idImage(SLUG, 100, '001'), source: 'ppr', lot: 'ppr-2026-10', set: SLUG, cleR2: posee.cleR2, carteId: 100, etat: 'ok' }], sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const [r] = await SILENCE(() => lancer(p, M, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.resultats[0].etat, 'verifie'); assert.strictEqual(r.resultats[0].garde.ok, true);
        assert.strictEqual(etat.carte(100).images.filter(e => e.source === 'ppr').length, 2);
        // un vrai manque : la jointure déclare joindre, la base ne reçoit rien
        const p2 = await preparer(2), f2 = fauxModeles({ cartes: cartesVides(2), sets: [{ _id: SLUG, tirage: 'zh-hans' }] });
        const orig = f2.M.Carte.updateOne;
        f2.M.Carte.updateOne = async (f, u) => (u.$push && f._id === 101 ? { modifiedCount: 1 } : orig(f, u));
        const [r2] = await SILENCE(() => lancer(p2, f2.M, { attendu: 2 }));
        assert.strictEqual(r2.resultats[0].etat, 'non-concordant'); assert.strictEqual(r2.resultats[0].garde.ok, false); assert.strictEqual(r2.code, 1);
    });

    // ───────── la ligne de commande ─────────
    await test('ligne de commande : argument inconnu, mode manquant ou double, plafond manquant, --ecrire sans --attendu : refus (code 2) sans connexion', () => {
        const lance = (...a) => spawnSync(process.execPath, [COLL_FILE, ...a], { encoding: 'utf8', timeout: 20000 });
        for (const a of [['--inconnu'], [], ['--plan', '--releve'], ['--releve'], ['--telecharger'], ['--ecrire'], ['--plan', '--attendu=3'], ['--releve', '--plafond=5', '--echantillon=3'], ['--plan', '--plafond=5'], ['--releve', '--plafond=5', '--basse-definition'], ['--plafond=99999', '--releve'], ['--releve', '--plafond=5', '--limite=3'], ['--plan', '--limite=3']]) assert.strictEqual(lance(...a).status, 2, JSON.stringify(a));
        const interdit = lance('--cache=C:\\Users\\Yung\\Desktop\\Logo FR\\x', '--plan');
        assert.notStrictEqual(interdit.status, 0); assert.match(interdit.stderr, /refusé \(dossier d'apports manuels/);
    });
    await test('--ecrire hors de lot-additif.js : refusé avant toute connexion (garde de lot)', () => {
        const dossier = tmp();
        fs.writeFileSync(path.join(dossier, 'plan-ppr.json'), JSON.stringify({ unites: [] }));
        const r = spawnSync(process.execPath, [COLL_FILE, '--ecrire', '--attendu=1', `--dossier=${dossier}`], { encoding: 'utf8', timeout: 20000 });
        assert.notStrictEqual(r.status, 0); assert.ok(/lot-additif\.js/.test(r.stderr), r.stderr);
    });
    await test('chemins : un dossier d\'apports manuels du testeur est refusé', () => {
        for (const p of ['C:\\Users\\Yung\\Desktop\\Logo FR\\x', 'C:\\x\\apport-manuel', 'C:\\Users\\Yung\\Desktop\\LOGO']) assert.throws(() => RC.verifierChemin(p), /refusé/);
        assert.doesNotThrow(() => RC.verifierChemin(tmp()));
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
