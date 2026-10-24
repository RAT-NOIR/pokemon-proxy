// Banc du collecteur « scx » : relevé (pages réelles en fixture), plan sur une FAUSSE base, téléchargement (dont le dos de carte), planches, écriture sur de FAUX modèles, ligne de commande.
// Le moteur d'écriture, le retrait et le client sont ceux de la récolte 1 (bancs test-collecteur-pokipair.js, test-recolte-hote.js) : ici, ce que la source ajoute. Transport injecté : AUCUNE requête, AUCUNE base réelle.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const S = require('./collecte-cartes/scrydex');
const RC = require('./collecte-cartes/recolte-commun');
const RH = require('./collecte-cartes/reponse-hote');
const K = require('./collecteur-images-scrydex');
const RETIRER = require('./retirer-visuels-recolte');
const { fauxModeles } = require('./faux-modeles-cardtrader');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scx-pages.json'), 'utf8'));

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 16).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'scx-'));
const png = (w, h, couleur = { r: 40, g: 120, b: 200 }) => sharp({ create: { width: w, height: h, channels: 3, background: couleur } }).png().toBuffer();
const ROBOTS = 'User-agent: *\nAllow: /\n';
const mkCli = (transport, dossier, plafond = 100) => S.fabriquerClient({ dossierCache: dossier, plafond, transport, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), suivi: RH.suiviHote() });
const MCD = K.MOITIES.filter(m => m.id === 'mcd18'), DEUX = K.MOITIES.filter(m => ['mcd18', 'tk10a'].includes(m.id));
const pageDe = id => ({ mcd18: F.mcd18, tk10a: F.tk10a })[id];
const transportPages = (appels = []) => ({ async get(url) {
    appels.push(url);
    if (url.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS };
    const m = K.MOITIES.find(x => url === S.urlPage(x.id));
    return m && pageDe(m.id) ? { status: 200, type: 'text/html; charset=utf-8', texte: pageDe(m.id) } : { status: 404, type: 'text/html', texte: 'Not found' };
} });

(async () => {
    // ───────── le relevé ─────────
    await test('relevé : une requête par page de la table + robots.txt ; les tuiles sont lues et gardées SANS prix ; reprise sans requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), appels = [];
        const r = await K.releve({ cli: mkCli(transportPages(appels), dossier), fichier, moities: DEUX });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 3); assert.strictEqual(r.relevees, 2); assert.strictEqual(r.refusees, 0); assert.strictEqual(r.tuiles, 12 + 30);
        assert.deepStrictEqual(r.requetesParHote, { 'scrydex.com': 3 }); assert.deepStrictEqual(r.codes, { 200: 3 });
        const rel = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.strictEqual(rel.mcd18.tuiles.length, 12); assert.strictEqual(rel.mcd18.verdict.ok, true); assert.strictEqual(rel.mcd18.entete.total, 12);
        await K.releve({ cli: mkCli(transportPages(appels), dossier), fichier, moities: DEUX });
        assert.strictEqual(appels.length, 3, 'reprise : rien redemandé');
        for (const f of fs.readdirSync(dossier).filter(x => /mcd|tk10/.test(x))) {
            const t = fs.readFileSync(path.join(dossier, f), 'utf8');
            assert.ok(!/\$\s?[1-9]|<span class=\\"text-body-12 font-bold|price|prix/i.test(t), `le cache de ${f} porte un prix`);
            assert.ok(t.length < F.mcd18.length * 0.6 + 200, 'le cache garde la page RÉDUITE');
        }
    });
    await test('relevé : une page d\'une AUTRE extension est refusée par la garde de lecture, mais relevée et comptée ; une 404 est « absente »', async () => {
        const fichier = path.join(tmp(), 'r.json');
        const transport = { async get(url) { if (url.endsWith('robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS }; if (url.includes('/mcd18')) return { status: 200, type: 'text/html', texte: F.tk10a }; return { status: 404, type: 'text/html', texte: 'nf' }; } };
        const r = await K.releve({ cli: mkCli(transport, tmp()), fichier, moities: DEUX });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(r.refusees, 1); assert.strictEqual(r.absentes, 1);
        assert.match(JSON.parse(fs.readFileSync(fichier, 'utf8')).mcd18.verdict.motif, /identifiant/);
    });
    await test('relevé : un 403 arrête tout (arret-definitif) ; un robots.txt en 403 aussi ; une page à défi aussi ; le plafond arrête proprement', async () => {
        const r1 = await K.releve({ cli: mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: ROBOTS } : { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'a.json'), moities: DEUX });
        assert.strictEqual(r1.etat, 'arret-definitif'); assert.strictEqual(r1.relevees, 0);
        const r2 = await K.releve({ cli: mkCli({ async get() { return { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'b.json'), moities: DEUX });
        assert.strictEqual(r2.etat, 'arret-definitif');
        const r3 = await K.releve({ cli: mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: ROBOTS } : { status: 200, type: 'text/html', texte: '<html><title>Just a moment...</title>Checking your browser</html>' }; } }, tmp()), fichier: path.join(tmp(), 'c.json'), moities: DEUX });
        assert.strictEqual(r3.etat, 'arret-definitif');
        const r4 = await K.releve({ cli: mkCli(transportPages(), tmp(), 2), fichier: path.join(tmp(), 'd.json'), moities: DEUX });
        assert.strictEqual(r4.etat, 'plafond'); assert.strictEqual(r4.relevees, 1); assert.strictEqual(r4.restantes, 1);
    });
    await test('relevé : un robots.txt qui interdit les pages d\'extensions arrête sans une seule page', async () => {
        const appels = [];
        const r = await K.releve({ cli: mkCli({ async get(u) { appels.push(u); return { status: 200, type: 'text/plain', texte: u.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /pokemon/\n' : 'x' }; } }, tmp()), fichier: path.join(tmp(), 'e.json'), moities: DEUX });
        assert.notStrictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 1); assert.strictEqual(r.relevees, 0);
    });
    await test('maximum : compté AVANT la première requête (robots + pages, ou robots + originaux), 6 s chacune ; ce qui est au cache ne compte pas', () => {
        const dossier = tmp(), F2 = K.fichiersDe(dossier, path.join(dossier, 'c'));
        let m = K.maximumReleve({ F: F2, releves: {}, plafondTotal: 600 });
        assert.strictEqual(m.total, 1 + K.MOITIES.length); assert.strictEqual(m.secondes, (1 + K.MOITIES.length) * 6);
        m = K.maximumReleve({ F: F2, releves: { mcd18: { le: 'x' } }, plafondTotal: 600 });
        assert.strictEqual(m.total, K.MOITIES.length);
        const unites = [{ url: 'https://images.scrydex.com/pokemon/mcd18-1/large' }, { url: 'https://images.scrydex.com/pokemon/mcd18-2/large' }, { url: 'https://images.scrydex.com/pokemon/mcd18-2/large' }];
        m = K.maximumImages({ F: F2, hoteImages: S.HOTE_IMAGES, unites, indexImages: { 'https://images.scrydex.com/pokemon/mcd18-1/large': { statut: 'ok' } }, plafondTotal: 600 });
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
    const SLUG = 'McDonald-s-Collection-2018-2';
    const baseDb = () => ({
        sets: [{ _id: SLUG, code: 'MCD18', tirage: 'intl' }],
        lignes: [{ slugSet: SLUG, carteId: 1, idProduct: 901, numeroFiche: '1', slug: 'Growlithe-MCD181' }, { slugSet: SLUG, carteId: 2, idProduct: 902, numeroFiche: '2', slug: 'Psyduck-MCD182' },
            { slugSet: SLUG, carteId: 3, idProduct: 903, numeroFiche: null, slug: 'Horsea-MCD183' }, { slugSet: SLUG, carteId: 4, idProduct: 904, numeroFiche: '4', slug: 'Autre-MCD184' }],
        cartes: [{ _id: 1, nomEn: 'Growlithe', images: [{ set: SLUG, source: 'pdt', cleR2: 'pdt/1', numero: '1', langue: 'en', w: 322, wOriginal: 322, basseDefinition: true }] },
            { _id: 2, nomEn: 'Psyduck', images: [{ set: SLUG, source: 'pokumon', cleR2: 'pk/2', numero: '2', langue: 'en', w: 700, wOriginal: 700 }] }, { _id: 3, nomEn: 'Horsea', images: [] }, { _id: 4, nomEn: 'Pikachu', images: [] }],
        images: [{ _id: 'pdt-1', source: 'pdt', set: SLUG, cleR2: 'pdt/1', carteId: 1, etat: 'ok' }, { _id: 'pk-2', source: 'pokumon', set: SLUG, cleR2: 'pk/2', carteId: 2, etat: 'ok' }]
    });
    const relevesPlan = () => ({ mcd18: { le: 'x', verdict: { ok: true }, entete: S.lirePage(F.mcd18).entete, tuiles: S.lirePage(F.mcd18).tuiles } });
    await test('plan : lu en LECTURE seule ; unités prouvées, décisions (remplace une basse définition / cède devant une image correcte / ajoute au trou), dénominateurs par set', async () => {
        const { resume, unites, restes } = await K.construirePlan({ db: fauxDb(baseDb()), releves: relevesPlan() });
        const s = resume.parSet.find(x => x.code === 'MCD18');
        assert.deepStrictEqual([s.etat, s.produits, s.deja_servis, s.dont_basse_definition, s.sans_visuel, s.unites], ['planifie', 4, 2, 1, 2, 3]);
        assert.deepStrictEqual(resume.restesParMotif, { 'nom-produit-different': 1 });
        assert.deepStrictEqual(restes.map(r => r.carteId), [4]);
        const par = Object.fromEntries(unites.map(u => [u.carteId, u.decision.action]));
        assert.deepStrictEqual(par, { 1: 'ajouter', 2: 'cede', 3: 'ajouter' });
        assert.strictEqual(unites.find(u => u.carteId === 1).decision.remplace.length, 1);
        assert.strictEqual(unites.find(u => u.carteId === 3).numero, '3');
        assert.strictEqual(resume.aAjouter, 2); assert.strictEqual(resume.dontRemplacentUneBasseDefinition, 1);
        assert.ok(resume.parSet.filter(x => x.etat === 'set-refuse').length === S.TABLE.length - 1, 'les autres lignes : set absent de la fausse base, dit et compté');
    });
    await test('plan : set au mauvais tirage ou au mauvais code = refusé sans lire ses produits ; aucune page lue = dénominateur seul', async () => {
        const d = baseDb(); d.sets[0].tirage = 'jp';
        const r = await K.construirePlan({ db: fauxDb(d), releves: relevesPlan() });
        assert.match(r.resume.parSet.find(x => x.code === 'MCD18').motif, /tirage jp/); assert.strictEqual(r.unites.length, 0);
        const d2 = baseDb(); d2.sets[0].code = 'XXX';
        assert.match((await K.construirePlan({ db: fauxDb(d2), releves: relevesPlan() })).resume.parSet.find(x => x.code === 'MCD18').motif, /code XXX/);
        const r3 = await K.construirePlan({ db: fauxDb(baseDb()), releves: {} });
        const s = r3.resume.parSet.find(x => x.code === 'MCD18');
        assert.deepStrictEqual([s.etat, s.produits, s.deja_servis], ['aucune-page-lue', 4, 2]); assert.strictEqual(r3.unites.length, 0);
    });
    await test('plan : une page refusée par la garde de lecture ou absente ne produit AUCUNE unité (même si ses tuiles se lisent)', async () => {
        const rel = { mcd18: { ...relevesPlan().mcd18, verdict: { ok: false, motif: 'langue' } } };
        const r = await K.construirePlan({ db: fauxDb(baseDb()), releves: rel });
        assert.strictEqual(r.unites.length, 0); const s = r.resume.parSet.find(x => x.code === 'MCD18');
        assert.strictEqual(s.etat, 'aucune-page-lue'); assert.match(s.pages.mcd18, /page-refusee/);
        const r2 = await K.construirePlan({ db: fauxDb(baseDb()), releves: { mcd18: { absente: true, le: 'x' } } });
        assert.strictEqual(r2.resume.parSet.find(x => x.code === 'MCD18').pages.mcd18, 'page-absente');
    });
    await test('plan : produits sans carte lue = ÉCHEC bruyant (§41), jamais un plan vide plausible', async () => {
        const d = baseDb(); d.cartes = [];
        await assert.rejects(() => K.construirePlan({ db: fauxDb(d), releves: relevesPlan() }), /LECTURE VIDE|appariement impossible/);
    });

    // ───────── le téléchargement ─────────
    const UNITES = [1, 2, 3].map(i => ({ carteId: 100 + i, slugSet: SLUG, numero: String(i), produits: [900 + i], url: `https://images.scrydex.com/pokemon/mcd18-${i}/large`, idSource: `mcd18-${i}`, variante: 'holofoil', groupe: 'MCD18', carteNom: `Nom ${i}`, nomSource: `Nom ${i}`, numeroSource: String(i) }));
    const transportImages = (octetsParUrl, appels = []) => ({ async get(url) {
        appels.push(url);
        if (url.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: 'User-agent: *\nAllow: /\n' };
        const o = octetsParUrl[url];
        if (o === 404) return { status: 404, type: 'text/html', texte: 'nf' };
        return { status: 200, type: 'image/png', octets: o };
    } });
    await test('téléchargement : robots.txt de l\'hôte des images lu ; vraie image au cache ; trop-petit AVEC sa largeur ; forme ; LE DOS DE CARTE (200, empreinte connue) jamais une image ; reprise sans requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'images.json'), progression = path.join(tmp(), 'p.json');
        const bon = await png(734, 1024), petit = await png(300, 418), dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
        const us = [...UNITES, { ...UNITES[0], carteId: 104, url: 'https://images.scrydex.com/pokemon/mcd18-4/large' }, { ...UNITES[0], carteId: 105, url: 'https://images.scrydex.com/pokemon/mcd18-5/large' }];
        const octets = { [us[0].url]: bon, [us[1].url]: petit, [us[2].url]: dos, [us[3].url]: await png(500, 500), [us[4].url]: 404 };
        const appels = [];
        const r = await RC.telecharger({ SRC: S.SRC, unites: us, cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: S.HOTE_IMAGES, progression });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 6, 'robots.txt + 5 originaux');
        const idx = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.deepStrictEqual([idx[us[0].url].statut, idx[us[0].url].w, idx[us[1].url].statut, idx[us[1].url].w, idx[us[2].url].statut, idx[us[3].url].statut, idx[us[4].url].statut], ['ok', 734, 'trop-petit', 300, 'dos-de-carte', 'forme-inattendue', 'absent']);
        await RC.telecharger({ SRC: S.SRC, unites: us, cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: S.HOTE_IMAGES, progression });
        assert.ok(appels.length <= 7, `reprise : ${appels.length} requêtes (le robots.txt seul peut être redemandé)`);
    });
    await test('téléchargement : le dos de carte n\'entre JAMAIS dans l\'écriture (écarté, compté), même à la bonne forme', async () => {
        const dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
        const j = await RC.juger(S.SRC, dos);
        assert.strictEqual(j.statut, 'dos-de-carte');
        assert.strictEqual((await RC.juger(RC.fabriquerSource({ SOURCE: 'zzz', LOT: 'zzz-1', LANGUE: 'en', LANGUE_PREUVE: 'x', TIRAGE: 'intl', CHAMP_BILAN: 'b' }), dos)).statut, 'ok', 'une source qui ne déclare pas de refus garde le comportement d\'avant');
    });
    await test('compte : une image jugée « dos-de-carte » est ÉCARTÉE et comptée, jamais « à ajouter » ni « hors cache »', async () => {
        const dossier = tmp(), u = UNITES[0], dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
        const cache = require('./collecte-cartes/recolte-hote');
        // le dos est mis au cache comme n'importe quelle réponse d'image (200) : le téléchargement le juge, le compte l'écarte
        const fichier = path.join(tmp(), 'images.json');
        await RC.telecharger({ SRC: S.SRC, unites: [u], cli: mkCli(transportImages({ [u.url]: dos }), dossier), fichier, hoteImages: S.HOTE_IMAGES });
        const idx = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.strictEqual(idx[u.url].statut, 'dos-de-carte'); assert.ok(cache.lireDuCache(dossier, u.url));
        const lecteur = { cartes: async ids => ids.map(id => ({ _id: id, images: [] })), images: async () => [], document: async () => null };
        const [r] = await silence(() => RC.ecrire({ SRC: S.SRC, unites: [u], M: { Carte: { db: { db: {} } } }, dossierCache: dossier, indexImages: idx, compterSeulement: true, lecteur }));
        assert.deepStrictEqual([r.reel, r.ecartees, r.horsCache, r.tropPetits], [0, 1, 0, 0]);
    });
    await test('téléchargement : un robots.txt en 403 sur l\'hôte des images = arrêt définitif AVANT toute image', async () => {
        const appels = [];
        const r = await RC.telecharger({ SRC: S.SRC, unites: UNITES, cli: mkCli({ async get(u) { appels.push(u); return { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'i.json'), hoteImages: S.HOTE_IMAGES });
        assert.strictEqual(r.etat, 'arret-definitif'); assert.strictEqual(appels.length, 1);
    });

    // ───────── l'écriture, sur de FAUX modèles, depuis le cache ─────────
    await test('écriture : l\'unité qui remplace une basse définition est posée, l\'ancienne entrée est gardée pour le retrait ; le retrait la remet ; aucune requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'images.json'), b = baseDb();
        const bon = await png(734, 1024), appels = [];
        const unites = (await K.construirePlan({ db: fauxDb(b), releves: relevesPlan() })).unites.filter(u => u.decision.action === 'ajouter');
        assert.strictEqual(unites.length, 2);
        const octets = Object.fromEntries(unites.map(u => [u.url, bon]));
        await RC.telecharger({ SRC: S.SRC, unites, cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: S.HOTE_IMAGES });
        const avantAppels = appels.length;
        process.env.R2_BUCKET_IMAGES = 'banc-sans-bucket';
        const { M, etat } = fauxModeles({ cartes: b.cartes.map(c => ({ ...c, images: [...c.images] })), images: b.images, sets: [{ _id: SLUG, tirage: 'intl', code: 'MCD18' }] });
        const deposes = [];
        const [r] = await silence(() => RC.ecrire({ SRC: S.SRC, unites, M, dossierCache: dossier, indexImages: JSON.parse(fs.readFileSync(fichier, 'utf8')), attendu: 2, deposer: async (bk, c) => { deposes.push(c); }, vignetter: async () => ({ vg: { entrees: 0, fabriquees: 0, echecs: 0 } }) }));
        assert.strictEqual(r.code, 0); assert.strictEqual(appels.length, avantAppels, 'l\'écriture ne fait AUCUNE requête');
        const c1 = etat.carte(1);
        assert.deepStrictEqual(c1.images.map(e => e.source), ['scx']); assert.strictEqual(c1.images[0].langue, 'en'); assert.strictEqual(c1.images[0].lot, 'scx-2026-10');
        assert.strictEqual(c1.images[0].urlOriginal, 'https://images.scrydex.com/pokemon/mcd18-1/large');
        assert.strictEqual(etat.carte(3).images.length, 1);
        assert.strictEqual(etat.carte(2).images.map(e => e.source).join(), 'pokumon', 'l\'image correcte d\'une autre source n\'est pas touchée');
        assert.ok(deposes.every(c => c.startsWith('scx/')));
        const doc = etat.images().find(d => d.source === 'scx' && d.carteId === 1);
        assert.strictEqual(doc.remplaceEntrees.length, 1); assert.strictEqual(doc.remplaceEntrees[0].source, 'pdt');
    });

    // ───────── la ligne de commande ─────────
    await test('ligne de commande : un argument inconnu ou deux modes refusent avant toute connexion (code 2)', () => {
        for (const args of [['--plan', '--zzz'], ['--plan', '--releve', '--plafond=5'], ['--releve'], ['--ecrire'], ['--telecharger']]) {
            const r = spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-scrydex.js'), ...args], { encoding: 'utf8', env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
            assert.strictEqual(r.status, 2, `${args.join(' ')} : ${r.stdout}${r.stderr}`);
        }
    });
    await test('le retrait connaît la source (scx), sa liste est fermée', () => {
        assert.strictEqual(RETIRER.SOURCES.scx().SOURCE, 'scx');
        assert.ok(!('zzz' in RETIRER.SOURCES));
    });

    function silence(f) { const l = console.log, e = console.error, sortie = []; console.log = (...a) => sortie.push(a.join(' ')); console.error = (...a) => sortie.push(a.join(' ')); return Promise.resolve().then(f).then(r => { console.log = l; console.error = e; return [r, sortie]; }, err => { console.log = l; console.error = e; throw err; }); }

    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
