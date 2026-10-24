// Banc du collecteur « pmk » : relevé (page réelle en fixture), plan sur une FAUSSE base, téléchargement (300 px -> trop-petit AVEC sa largeur), compte, ligne de commande.
// Le moteur d'écriture, le retrait et le client sont ceux de la récolte 1 (bancs test-collecteur-pokipair.js, test-recolte-hote.js). Transport injecté : AUCUNE requête, AUCUNE base réelle.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sharp = require('sharp');
const P = require('./collecte-cartes/packmagik');
const RC = require('./collecte-cartes/recolte-commun');
const RH = require('./collecte-cartes/reponse-hote');
const K = require('./collecteur-images-packmagik');
const RETIRER = require('./retirer-visuels-recolte');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pmk-pages.json'), 'utf8'));

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 16).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pmk-'));
const png = (w, h, couleur = { r: 40, g: 120, b: 200 }) => sharp({ create: { width: w, height: h, channels: 3, background: couleur } }).png().toBuffer();
const ROBOTS = 'User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /pack-battles/\nDisallow: /shop/\nDisallow: /r/\n';
const mkCli = (transport, dossier, plafond = 100) => P.fabriquerClient({ dossierCache: dossier, plafond, transport, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), suivi: RH.suiviHote() });
const UN = [P.ligneDe('CSVH1C')], DEUX = [P.ligneDe('CSVH1C'), P.ligneDe('CSVH2C')];
const transportPages = (appels = []) => ({ async get(url) {
    appels.push(url);
    if (url.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS };
    return url === P.urlPage('CSVH1C') ? { status: 200, type: 'text/html; charset=utf-8', texte: F.csvh1c } : { status: 404, type: 'text/html', texte: 'Not found' };
} });

(async () => {
    await test('relevé : une requête par page de la table + robots.txt ; les tuiles sont lues et gardées SANS prix ; une 404 est « absente » ; reprise sans requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), appels = [];
        const r = await K.releve({ cli: mkCli(transportPages(appels), dossier), fichier, lignes: DEUX });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 3); assert.strictEqual(r.relevees, 2); assert.strictEqual(r.absentes, 1); assert.strictEqual(r.tuiles, 48);
        assert.deepStrictEqual(r.requetesParHote, { 'www.packmagik.com': 3 }); assert.deepStrictEqual(r.codes, { 200: 2, 404: 1 });
        const rel = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.strictEqual(rel.CSVH1C.tuiles.length, 48); assert.strictEqual(rel.CSVH1C.verdict.ok, true); assert.strictEqual(rel.CSVH2C.absente, true);
        await K.releve({ cli: mkCli(transportPages(appels), dossier), fichier, lignes: DEUX });
        assert.strictEqual(appels.length, 3, 'reprise : rien redemandé');
        for (const f of fs.readdirSync(dossier).filter(x => /sets/.test(x))) {
            const t = fs.readFileSync(path.join(dossier, f), 'utf8');
            assert.ok(!/\$\s?[1-9]|price/i.test(t.replace(/<title>[^<]*<\/title>/, '')), `le cache de ${f} porte un prix`);
            assert.ok(t.length < F.csvh1c.length * 0.25, 'le cache garde la page RÉDUITE');
        }
    });
    await test('relevé : une page d\'un AUTRE set (titre) est refusée par la garde de lecture, mais relevée et comptée', async () => {
        const fichier = path.join(tmp(), 'r.json');
        const transport = { async get(url) { if (url.endsWith('robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS }; return { status: 200, type: 'text/html', texte: F.csvh1c }; } };
        const r = await K.releve({ cli: mkCli(transport, tmp()), fichier, lignes: DEUX });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(r.refusees, 1);
        assert.match(JSON.parse(fs.readFileSync(fichier, 'utf8')).CSVH2C.verdict.motif, /aucune tuile lue \(48 tuile\(s\) d'un AUTRE set\)/);
        // et si la page est celle du bon set mais le titre porte un autre set : la garde de titre refuse
        assert.match(P.verdictDePage({ ...P.lirePage(F.csvh1c), h1: 'Autre set' , titre: 'Autre set' }, P.ligneDe('CSVH1C')).motif, /titre/);
    });
    await test('relevé : un 403 arrête tout ; un robots.txt en 403 aussi ; un défi aussi ; le plafond arrête proprement', async () => {
        const r1 = await K.releve({ cli: mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: ROBOTS } : { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'a.json'), lignes: DEUX });
        assert.strictEqual(r1.etat, 'arret-definitif'); assert.strictEqual(r1.relevees, 0);
        const r2 = await K.releve({ cli: mkCli({ async get() { return { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'b.json'), lignes: DEUX });
        assert.strictEqual(r2.etat, 'arret-definitif');
        const r3 = await K.releve({ cli: mkCli({ async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: ROBOTS } : { status: 200, type: 'text/html', texte: '<html><title>Just a moment...</title>Checking your browser</html>' }; } }, tmp()), fichier: path.join(tmp(), 'c.json'), lignes: DEUX });
        assert.strictEqual(r3.etat, 'arret-definitif');
        const r4 = await K.releve({ cli: mkCli(transportPages(), tmp(), 2), fichier: path.join(tmp(), 'd.json'), lignes: DEUX });
        assert.strictEqual(r4.etat, 'plafond'); assert.strictEqual(r4.relevees, 1); assert.strictEqual(r4.restantes, 1);
    });
    await test('relevé : un robots.txt qui interdit les pages de sets arrête sans une seule page', async () => {
        const appels = [];
        const r = await K.releve({ cli: mkCli({ async get(u) { appels.push(u); return { status: 200, type: 'text/plain', texte: u.endsWith('robots.txt') ? 'User-agent: *\nDisallow: /sets/\n' : 'x' }; } }, tmp()), fichier: path.join(tmp(), 'e.json'), lignes: UN });
        assert.notStrictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 1); assert.strictEqual(r.relevees, 0);
    });
    await test('maximum : compté AVANT la première requête (robots + pages, ou robots + originaux), 6 s chacune ; ce qui est au cache ne compte pas', () => {
        const dossier = tmp(), F2 = K.fichiersDe(dossier, path.join(dossier, 'c'));
        let m = K.maximumReleve({ F: F2, releves: {}, plafondTotal: 600 });
        assert.strictEqual(m.total, 1 + P.TABLE.length); assert.strictEqual(m.secondes, (1 + P.TABLE.length) * 6);
        m = K.maximumReleve({ F: F2, releves: { CSVH1C: { le: 'x' } }, plafondTotal: 600 });
        assert.strictEqual(m.total, P.TABLE.length);
        const u1 = P.urlOriginalDe('csvh1c', '001'), u2 = P.urlOriginalDe('csvh1c', '002');
        m = K.maximumImages({ F: F2, hoteImages: P.HOTE_IMAGES, unites: [{ url: u1 }, { url: u2 }, { url: u2 }], indexImages: { [u1]: { statut: 'ok' } }, plafondTotal: 600 });
        assert.strictEqual(m.total, 2); assert.match(m.detail, /originaux 1/);
    });

    function fauxDb({ sets, lignes, cartes, images = [] }) {
        const col = {
            sets: { findOne: async q => sets.find(s => s._id === q._id) ?? null, find: () => ({ toArray: async () => sets }), countDocuments: async () => sets.length },
            cartes_produits: { find: q => ({ toArray: async () => lignes.filter(l => l.slugSet === q.slugSet) }), countDocuments: async () => lignes.length },
            cartes: { find: q => ({ project: () => ({ toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }), toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }) },
            images: { find: q => ({ toArray: async () => images.filter(d => q.carteId.$in.includes(d.carteId)) }), findOne: async q => images.find(d => d._id === q._id) ?? null }
        };
        return { collection: n => col[n] };
    }
    const SLUG = 'Happy-Set-Pikachu-Clefairy-Turtwig-Gimmighoul';
    const baseDb = () => ({
        sets: [{ _id: SLUG, code: 'CSVH1C', tirage: 'zh-hans' }],
        lignes: [{ slugSet: SLUG, carteId: 1, idProduct: 901, numeroFiche: '1', slug: 'Shroomish-CSVH1C001' }, { slugSet: SLUG, carteId: 2, idProduct: 902, numeroFiche: '2', slug: 'Breloom-CSVH1C002' },
            { slugSet: SLUG, carteId: 3, idProduct: 903, numeroFiche: '3', slug: 'Turtwig-CSVH1C003' }, { slugSet: SLUG, carteId: 4, idProduct: 904, numeroFiche: '60', slug: 'Autre-CSVH1C060' }],
        cartes: [{ _id: 1, nomEn: 'Shroomish', images: [] }, { _id: 2, nomEn: 'Breloom', images: [{ set: SLUG, source: 'pikaqian', cleR2: 'pq/2', numero: '2', langue: 'zh-hans', w: 300, wOriginal: 300, basseDefinition: true }] },
            { _id: 3, nomEn: 'Turtwig', images: [{ set: SLUG, source: 'tpc', cleR2: 'tpc/3', numero: '3', langue: 'zh-hans', w: 500, wOriginal: 500 }] }, { _id: 4, nomEn: 'Autre', images: [] }],
        images: [{ _id: 'pq-2', source: 'pikaqian', set: SLUG, cleR2: 'pq/2', carteId: 2, etat: 'ok' }, { _id: 'tpc-3', source: 'tpc', set: SLUG, cleR2: 'tpc/3', carteId: 3, etat: 'ok' }]
    });
    const relevesPlan = () => { const p = P.lirePage(F.csvh1c); return { CSVH1C: { le: 'x', verdict: { ok: true }, horsSet: 0, tuiles: p.tuiles } }; };
    await test('plan : lu en LECTURE seule ; unités prouvées, décisions (ajoute au trou / cède devant une basse définition ET une image correcte), dénominateurs par set', async () => {
        const { resume, unites, restes } = await K.construirePlan({ db: fauxDb(baseDb()), releves: relevesPlan() });
        const s = resume.parSet.find(x => x.code === 'CSVH1C');
        assert.deepStrictEqual([s.etat, s.produits, s.deja_servis, s.dont_basse_definition, s.sans_visuel, s.unites], ['planifie', 4, 2, 1, 2, 3]);
        assert.deepStrictEqual(resume.restesParMotif, { 'absente-de-la-source': 1 });
        assert.deepStrictEqual(restes.map(r => r.carteId), [4]);
        const par = Object.fromEntries(unites.map(u => [u.carteId, u.decision.action]));
        assert.deepStrictEqual(par, { 1: 'ajouter', 2: 'ajouter', 3: 'cede' });
        assert.strictEqual(unites.find(u => u.carteId === 2).decision.remplace.length, 1, 'avec la largeur nominale (350) du plan ; la vraie largeur (300) est jugée à l\'écriture');
        assert.ok(resume.parSet.filter(x => x.etat === 'set-refuse').length === P.TABLE.length - 1);
    });
    await test('plan : set au mauvais tirage ou au mauvais code = refusé sans lire ses produits ; page non relevée / absente / refusée = dénominateur seul', async () => {
        const d = baseDb(); d.sets[0].tirage = 'intl';
        const r = await K.construirePlan({ db: fauxDb(d), releves: relevesPlan() });
        assert.match(r.resume.parSet.find(x => x.code === 'CSVH1C').motif, /tirage intl/); assert.strictEqual(r.unites.length, 0);
        const d2 = baseDb(); d2.sets[0].code = 'XXX';
        assert.match((await K.construirePlan({ db: fauxDb(d2), releves: relevesPlan() })).resume.parSet.find(x => x.code === 'CSVH1C').motif, /code XXX/);
        assert.strictEqual((await K.construirePlan({ db: fauxDb(baseDb()), releves: {} })).resume.parSet.find(x => x.code === 'CSVH1C').etat, 'non-relevee');
        assert.strictEqual((await K.construirePlan({ db: fauxDb(baseDb()), releves: { CSVH1C: { absente: true, le: 'x' } } })).resume.parSet.find(x => x.code === 'CSVH1C').etat, 'page-absente');
        const refusee = await K.construirePlan({ db: fauxDb(baseDb()), releves: { CSVH1C: { ...relevesPlan().CSVH1C, verdict: { ok: false, motif: 'titre' } } } });
        assert.strictEqual(refusee.unites.length, 0); assert.strictEqual(refusee.resume.parSet.find(x => x.code === 'CSVH1C').etat, 'page-refusee');
    });
    await test('plan : produits sans carte lue = ÉCHEC bruyant (§41), jamais un plan vide plausible', async () => {
        const d = baseDb(); d.cartes = [];
        await assert.rejects(() => K.construirePlan({ db: fauxDb(d), releves: relevesPlan() }), /LECTURE VIDE|appariement impossible/);
    });

    const UNITES = [1, 2, 3].map(i => ({ carteId: 100 + i, slugSet: SLUG, numero: String(i), produits: [900 + i], url: P.urlOriginalDe('csvh1c', String(i).padStart(3, '0')), idSource: `csvh1c-00${i}`, groupe: 'CSVH1C', carteNom: `Nom ${i}`, nomSource: `Nom ${i}`, numeroSource: `00${i}` }));
    const transportImages = (octetsParUrl, appels = []) => ({ async get(url) {
        appels.push(url);
        if (url.endsWith('/robots.txt')) return { status: 404, type: 'text/html', texte: 'nf' };
        const o = octetsParUrl[url];
        if (o === 404) return { status: 404, type: 'text/html', texte: 'nf' };
        return { status: 200, type: 'image/png', octets: o };
    } });
    await test('téléchargement : robots.txt du serveur d\'images (404 = aucune règle) ; l\'original 300 px est TROP PETIT sous la règle de la source, AVEC sa largeur ; 350 px passe ; 404 absent ; reprise sans requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'images.json');
        const a300 = await png(300, 419), a350 = await png(350, 489);
        const octets = { [UNITES[0].url]: a300, [UNITES[1].url]: a350, [UNITES[2].url]: 404 };
        const appels = [];
        const r = await RC.telecharger({ SRC: P.SRC, unites: UNITES, cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: P.HOTE_IMAGES });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 4, 'robots.txt + 3 originaux');
        const idx = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.deepStrictEqual([idx[UNITES[0].url].statut, idx[UNITES[0].url].w, idx[UNITES[1].url].statut, idx[UNITES[2].url].statut], ['trop-petit', 300, 'ok', 'absent']);
        assert.deepStrictEqual(r.tropPetits, [{ url: UNITES[0].url, largeur: 300 }]);
        await RC.telecharger({ SRC: P.SRC, unites: UNITES, cli: mkCli(transportImages(octets, appels), dossier), fichier, hoteImages: P.HOTE_IMAGES });
        assert.ok(appels.length <= 5, `reprise : ${appels.length} requêtes`);
    });
    await test('compte : un original à 300 px est compté « trop petite », jamais « à ajouter » — sous la règle actuelle, --attendu vaut 0', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'images.json');
        const octets = Object.fromEntries(UNITES.map(u => [u.url, null]));
        const a300 = await png(300, 419);
        for (const u of UNITES) octets[u.url] = a300;
        await RC.telecharger({ SRC: P.SRC, unites: UNITES, cli: mkCli(transportImages(octets), dossier), fichier, hoteImages: P.HOTE_IMAGES });
        const lecteur = { cartes: async ids => ids.map(id => ({ _id: id, images: [] })), images: async () => [], document: async () => null };
        const sortie = []; const l = console.log; console.log = (...a) => sortie.push(a.join(' '));
        let r; try { r = await RC.ecrire({ SRC: P.SRC, unites: UNITES, M: { Carte: { db: { db: {} } } }, dossierCache: dossier, indexImages: JSON.parse(fs.readFileSync(fichier, 'utf8')), compterSeulement: true, lecteur }); } finally { console.log = l; }
        assert.deepStrictEqual([r.reel, r.tropPetits], [0, 3]);
    });

    await test('ligne de commande : un argument inconnu ou deux modes refusent avant toute connexion (code 2)', () => {
        for (const args of [['--plan', '--zzz'], ['--plan', '--releve', '--plafond=5'], ['--releve'], ['--ecrire'], ['--telecharger']]) {
            const r = spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-packmagik.js'), ...args], { encoding: 'utf8', env: { ...process.env, NODE_PATH: process.env.NODE_PATH } });
            assert.strictEqual(r.status, 2, `${args.join(' ')} : ${r.stdout}${r.stderr}`);
        }
    });
    await test('le retrait connaît la source (pmk), sa liste est fermée', () => {
        assert.strictEqual(RETIRER.SOURCES.pmk().SOURCE, 'pmk');
        assert.deepStrictEqual(Object.keys(RETIRER.SOURCES).sort(), ['pmk', 'ppr', 'scx', 'tcs']);
    });

    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
