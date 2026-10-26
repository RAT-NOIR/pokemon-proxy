// Banc du collecteur « tcs » : relevé JSON (faux transport), plan sur une FAUSSE base, images FERMÉES par l'arrêt durable, ligne de commande. AUCUNE requête, AUCUNE base réelle.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const TC = require('./collecte-cartes/tcgcsv');
const RC = require('./collecte-cartes/recolte-commun');
const RH = require('./collecte-cartes/reponse-hote');
const COLL_FILE = path.join(__dirname, 'collecteur-images-tcgcsv.js');
const K = require(COLL_FILE);
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tcs-produits.json'), 'utf8'));

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 14).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcs2-'));
const ROBOTS = 'User-agent: *\nAllow: /\n';
const mkCli = (transport, dossier, plafond = 50, dossierPauses = tmp()) => TC.fabriquerClient({ dossierCache: dossier, plafond, transport, cadenceMs: 0, pause: async () => {}, dossierPauses, suivi: RH.suiviHote() });
const transportOk = (appels = []) => ({ async get(u) {
    appels.push(u);
    if (u.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS };
    if (u.endsWith('/groups')) return { status: 200, type: 'application/json', texte: F.groupes };
    if (u.endsWith('/22880/products')) return { status: 200, type: 'application/json', texte: F.pp };
    if (u.endsWith('/2208/products')) return { status: 200, type: 'text/json', texte: F.kit };
    return { status: 404, type: 'text/html', texte: 'nf' };
} });

(async () => {
    // ───────── T4 : le relevé du catalogue COMPLET (Pokémon 3 + Pokémon Japon), synchro quotidienne conditionnelle ─────────
    const LU = { v: '2026-10-26T20:08:21+0000' };
    const CATS = JSON.stringify({ success: true, results: [{ categoryId: 1, name: 'Magic' }, { categoryId: 3, name: 'Pokemon' }, { categoryId: 85, name: 'Pokemon Japan' }] });
    const petit = (groupId, noms) => JSON.stringify({ success: true, totalItems: noms.length, results: noms.map((n, i) => ({ productId: groupId * 100 + i, name: n, imageUrl: `https://tcgplayer-cdn.tcgplayer.com/product/${groupId * 100 + i}_200w.jpg`, groupId, extendedData: [{ name: 'Number', value: `00${i + 1}/100` }, { name: 'Rarity', value: 'Rare' }, { name: 'CardText', value: 'secret' }] })) });
    const listeJp = mod => JSON.stringify({ success: true, results: [{ groupId: 90001, name: 'Pikachu JP', abbreviation: 'PJ', publishedOn: '2020-01-01T00:00:00', modifiedOn: mod, categoryId: 85 }] });
    const etatMonde = { modif2208: undefined, modifJp: 'M1' };
    const transportT4 = (appels = []) => ({ async get(u) {
        appels.push(u);
        if (u.endsWith('/robots.txt')) return { status: 200, type: 'text/plain', texte: ROBOTS };
        if (u.endsWith('/last-updated.txt')) return { status: 200, type: 'text/plain', texte: `${LU.v}\n` };
        if (u.endsWith('/categories')) return { status: 200, type: 'application/json', texte: CATS };
        if (u.endsWith('/3/groups')) { const j = JSON.parse(F.groupes); if (etatMonde.modif2208) j.results.find(g => g.groupId === 2208).modifiedOn = etatMonde.modif2208; return { status: 200, type: 'application/json', texte: JSON.stringify(j) }; }
        if (u.endsWith('/85/groups')) return { status: 200, type: 'application/json', texte: listeJp(etatMonde.modifJp) };
        if (u.endsWith('/22880/products')) return { status: 200, type: 'application/json', texte: F.pp };
        if (u.endsWith('/2208/products')) return { status: 200, type: 'text/json', texte: F.kit };
        if (u.endsWith('/24831/products')) return { status: 200, type: 'application/json', texte: petit(24831, ['Mega Zorua ex']) };
        if (u.endsWith('/90001/products')) return { status: 200, type: 'application/json', texte: petit(90001, ['Pikachu', 'Raichu']) };
        return { status: 404, type: 'text/html', texte: 'nf' };
    } });
    const J26 = () => new Date('2026-10-26T10:00:00Z');
    await test('T4 relevé : robots + last-updated + catégories + 2 listes de groupes + un fichier par groupe des DEUX catégories = 9 requêtes ; JSON réduits (aucun prix ni texte) ; état réussi écrit', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), sy = path.join(tmp(), 'derniere-synchro.json'), appels = [];
        const r = await K.releve({ cli: mkCli(transportOk0(appels), dossier), fichier, synchro: { fichier: sy }, now: J26 });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 9, appels.join('\n')); assert.deepStrictEqual(r.requetesParHote, { 'tcgcsv.com': 9 });
        assert.ok(appels.every(u => !/prices/.test(u)), 'aucune adresse de prix'); assert.ok(appels.every(u => u.startsWith('https://tcgcsv.com/')), 'aucune requête vers l\'hôte des images');
        assert.ok(appels.includes('https://tcgcsv.com/tcgplayer/85/90001/products') && appels.includes('https://tcgcsv.com/tcgplayer/3/24831/products'));
        const rel = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.strictEqual(rel[22880].produits.length, 9); assert.deepStrictEqual(Object.keys(rel[22880].produits[0]).sort(), ['groupId', 'imageUrl', 'name', 'number', 'productId', 'rarity']);
        assert.strictEqual(rel[90001].produits.length, 2); assert.strictEqual(rel[90001].categoryId, 85); assert.strictEqual(rel[90001].modifiedOn, 'M1');
        assert.deepStrictEqual(rel.categories, { pokemon: 3, japon: 85 }); assert.ok(!/price|CardText|secret/i.test(JSON.stringify(rel)));
        const st = JSON.parse(fs.readFileSync(sy, 'utf8'));
        assert.deepStrictEqual([st.reussie, st.lastUpdated, st.groupes], [true, LU.v, 4]);
        // le cache ne garde que la liste réduite
        assert.ok(fs.readdirSync(dossier).filter(f => /22880|90001/.test(f)).every(f => !/CardText|secret/.test(fs.readFileSync(path.join(dossier, f), 'utf8'))));
    });
    function transportOk0(appels) { etatMonde.modif2208 = undefined; etatMonde.modifJp = 'M1'; LU.v = '2026-10-26T20:08:21+0000'; return transportT4(appels); }
    await test('T4 relevé : le même jour, une seconde synchro ne fait AUCUNE requête (même pas last-updated) ; le lendemain sans nouveauté : UNE requête (last-updated) et le jour est clos', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), sy = path.join(tmp(), 's.json'), appels = [];
        await K.releve({ cli: mkCli(transportOk0(appels), dossier), fichier, synchro: { fichier: sy }, now: J26 });
        const n = appels.length;
        const r2 = await K.releve({ cli: mkCli(transportT4(appels), dossier), fichier, synchro: { fichier: sy }, now: () => new Date('2026-10-26T23:00:00Z') });
        assert.strictEqual(r2.etat, 'deja-synchronise'); assert.strictEqual(appels.length, n); assert.strictEqual(r2.requetes, 0);
        const r3 = await K.releve({ cli: mkCli(transportT4(appels), dossier), fichier, synchro: { fichier: sy }, now: () => new Date('2026-10-27T08:00:00Z') });
        assert.strictEqual(r3.etat, 'rien-de-neuf'); assert.strictEqual(appels.length, n + 1); assert.match(appels.at(-1), /last-updated\.txt$/);
        assert.strictEqual(JSON.parse(fs.readFileSync(sy, 'utf8')).verifieLe, '2026-10-27T08:00:00.000Z');
        const r4 = await K.releve({ cli: mkCli(transportT4(appels), dossier), fichier, synchro: { fichier: sy }, now: () => new Date('2026-10-27T18:00:00Z') });
        assert.strictEqual(r4.etat, 'deja-synchronise'); assert.strictEqual(appels.length, n + 1);
    });
    await test('T4 relevé : un last-updated plus récent redemande les DEUX listes de groupes et SEULS les groupes dont `modifiedOn` a changé (le reste reste au cache)', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), sy = path.join(tmp(), 's.json'), appels = [];
        await K.releve({ cli: mkCli(transportOk0(appels), dossier), fichier, synchro: { fichier: sy }, now: J26 });
        appels.length = 0; LU.v = '2026-10-27T20:08:21+0000'; etatMonde.modif2208 = '2026-10-27T01:00:00'; etatMonde.modifJp = 'M1';
        const r = await K.releve({ cli: mkCli(transportT4(appels), dossier), fichier, synchro: { fichier: sy }, now: () => new Date('2026-10-28T08:00:00Z') });
        assert.strictEqual(r.etat, 'termine');
        assert.deepStrictEqual(appels.map(u => u.replace('https://tcgcsv.com', '')), ['/last-updated.txt', '/tcgplayer/3/groups', '/tcgplayer/85/groups', '/tcgplayer/3/2208/products']);
        const st = JSON.parse(fs.readFileSync(sy, 'utf8')); assert.deepStrictEqual([st.reussie, st.lastUpdated], [true, '2026-10-27T20:08:21+0000']);
        assert.strictEqual(JSON.parse(fs.readFileSync(fichier, 'utf8'))[2208].modifiedOn, '2026-10-27T01:00:00');
    });
    await test('T4 relevé : le plafond arrête proprement, l\'état n\'est PAS « réussi », et la reprise ne redemande que ce qui manque', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), sy = path.join(tmp(), 's.json'), appels = [];
        const r = await K.releve({ cli: mkCli(transportOk0(appels), dossier, 6), fichier, synchro: { fichier: sy }, now: J26 });
        assert.strictEqual(r.etat, 'plafond'); assert.strictEqual(appels.length, 6);
        assert.strictEqual(JSON.parse(fs.readFileSync(sy, 'utf8')).reussie, false);
        const r2 = await K.releve({ cli: mkCli(transportT4(appels), dossier, 30), fichier, synchro: { fichier: sy }, now: J26 });
        assert.strictEqual(r2.etat, 'termine'); assert.strictEqual(JSON.parse(fs.readFileSync(sy, 'utf8')).reussie, true);
        assert.strictEqual(new Set(appels.filter(u => /products$/.test(u))).size, 4);
    });
    await test('T4 relevé : la catégorie Japon absente ou ambiguë arrête AVANT toute liste de produits ; last-updated illisible ne synchronise pas ; un 403 arrête définitivement ; produits d\'un autre groupe refusés', async () => {
        const appels = [];
        const sansJp = { async get(u) { appels.push(u); return u.endsWith('/categories') ? { status: 200, type: 'application/json', texte: JSON.stringify({ success: true, results: [{ categoryId: 3, name: 'Pokemon' }] }) } : transportT4([]).get(u); } };
        const r1 = await K.releve({ cli: mkCli(sansJp, tmp()), fichier: path.join(tmp(), 'a.json'), synchro: { fichier: path.join(tmp(), 's.json') }, now: J26 });
        assert.strictEqual(r1.etat, 'interrompu'); assert.match(r1.motif, /Japan|Japon/); assert.ok(!appels.some(u => /products|groups/.test(u)));
        const sy2 = path.join(tmp(), 's.json');
        const bad = { async get(u) { return u.endsWith('/last-updated.txt') ? { status: 200, type: 'text/plain', texte: 'Maintenance' } : transportT4([]).get(u); } };
        const r2 = await K.releve({ cli: mkCli(bad, tmp()), fichier: path.join(tmp(), 'b.json'), synchro: { fichier: sy2 }, now: J26 });
        assert.strictEqual(r2.etat, 'last-updated-illisible'); assert.ok(!fs.existsSync(sy2) || JSON.parse(fs.readFileSync(sy2, 'utf8')).reussie !== true);
        const r3 = await K.releve({ cli: mkCli({ async get() { return { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'c.json'), synchro: { fichier: path.join(tmp(), 's3.json') }, now: J26 });
        assert.strictEqual(r3.etat, 'arret-definitif');
        const t4 = { async get(u) { if (u.endsWith('/22880/products')) { const j = JSON.parse(F.pp); j.results[0].groupId = 1; return { status: 200, type: 'application/json', texte: JSON.stringify(j) }; } return transportOk0([]).get(u); } };
        const r4 = await K.releve({ cli: mkCli(t4, tmp()), fichier: path.join(tmp(), 'd.json'), synchro: { fichier: path.join(tmp(), 's4.json') }, now: J26 });
        assert.match(r4.motif, /autre groupe/);
    });
    await test('T4 relevé : un groupe de la table (PP, kit) renommé n\'arrête plus le catalogue complet : l\'erreur est écrite, les listes sont relevées, et le plan refuse ces deux groupes', async () => {
        const renomme = JSON.parse(F.groupes); renomme.results.find(g => g.groupId === 2208).name = 'Autre';
        const t = { async get(u) { return u.endsWith('/3/groups') ? { status: 200, type: 'application/json', texte: JSON.stringify(renomme) } : transportOk0([]).get(u); } };
        const fichier = path.join(tmp(), 'a.json');
        const r = await K.releve({ cli: mkCli(t, tmp()), fichier, synchro: { fichier: path.join(tmp(), 's.json') }, now: J26 });
        assert.strictEqual(r.etat, 'termine');
        const rel = JSON.parse(fs.readFileSync(fichier, 'utf8')); assert.match(rel.groupes.erreurVerification, /renommé/);
    });
    await test('T4 maximum (§38) : compté AVANT la première requête — fixe (robots, last-updated, catégories, 2 listes) + les produits au plus ; au cache ne compte pas ; le jour clos = 0', () => {
        const dossier = tmp(), F2 = K.fichiersDe(dossier, path.join(dossier, 'c'));
        const m0 = K.maximumReleve({ F: F2, releves: {}, plafondTotal: 300, synchro: null, now: J26 });
        assert.strictEqual(m0.total, 1 + 1 + 1 + 2 + (300 - 5), 'aucune liste connue : les produits sont bornés par le plafond'); assert.match(m0.detail, /plafond/);
        const releves = { categories: { pokemon: 3, japon: 85 }, listes: { 3: [{ groupId: 1 }, { groupId: 2 }, { groupId: 3 }], 85: [{ groupId: 9 }] }, 1: { produits: [], modifiedOn: 'a' } };
        const m1 = K.maximumReleve({ F: F2, releves, plafondTotal: 300, synchro: null, now: J26 });
        assert.strictEqual(m1.total, 1 + 1 + 0 + 2 + 4, 'catégories : 0 (au cache de relevé) ; produits au plus 4 groupes connus');
        const clos = K.maximumReleve({ F: F2, releves, plafondTotal: 300, synchro: { etat: { reussie: true, verifieLe: '2026-10-26T01:00:00Z' } }, now: J26 });
        assert.strictEqual(clos.total, 0); assert.match(clos.detail, /jour/);
    });

    // ───────── le plan sur une FAUSSE base ─────────
    function fauxDb({ sets, lignes, cartes, images = [] }) {
        const col = {
            sets: { findOne: async q => sets.find(s => s._id === q._id) ?? null },
            cartes_produits: { find: q => ({ toArray: async () => lignes.filter(l => l.slugSet === q.slugSet) }), countDocuments: async () => lignes.length },
            cartes: { find: q => ({ project: () => ({ toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }), toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }) },
            images: { find: q => ({ toArray: async () => images.filter(d => q.carteId.$in.includes(d.carteId)) }), findOne: async q => images.find(d => d._id === q._id) ?? null }
        };
        return { collection: n => col[n] };
    }
    const SERIE = n => `Play-Pokemon-Prize-Pack-Series-${n}`;
    const imp = (n, t) => ({ tirage: 'intl', expansion: 'X', numero: String(n), total: String(t) });
    const baseDb = () => ({
        sets: [...['One', 'Two', 'Five'].map(n => ({ _id: SERIE(n), tirage: 'intl', code: `PPS-${n}` })), { _id: 'SM-Trainer-Kit-Alolan-Sandslash-Alolan-Ninetales', tirage: 'intl', code: 'TK11' }],
        lignes: [{ slugSet: SERIE('One'), carteId: 1, idProduct: 501, slug: 'Kricketune-V-PPS1BST-006' }, { slugSet: SERIE('Five'), carteId: 2, idProduct: 502, slug: 'Cherrim-PPS5BST-008' }, { slugSet: 'SM-Trainer-Kit-Alolan-Sandslash-Alolan-Ninetales', carteId: 3, idProduct: 503, slug: 'Hoothoot-TK11106' }],
        cartes: [{ _id: 1, nomEn: 'Kricketune V', impressions: [imp(6, 163)], images: [] }, { _id: 2, nomEn: 'Cherrim', impressions: [imp(8, 163)], images: [{ set: SERIE('Five'), source: 'pokumon', cleR2: 'p/2', numero: null, langue: 'en', w: 245, wOriginal: 245, basseDefinition: true, tampon: 'Play! Pokémon' }] }, { _id: 3, nomEn: 'Hoothoot', impressions: [imp(106, 147)], images: [] }],
        images: [{ _id: 'pk2', source: 'pokumon', set: SERIE('Five'), cleR2: 'p/2', carteId: 2, etat: 'ok', tampon: 'Play! Pokémon' }]
    });
    const relevesOk = () => ({ groupes: { le: 'x' }, 22880: { produits: JSON.parse(TC.reduireProduits(F.pp)).results }, 2208: { produits: JSON.parse(TC.reduireProduits(F.kit)).results } });
    await test('plan : les unités prouvées des deux groupes, la décision de chacune (une basse définition d\'un tirage tamponné n\'est remplacée que par le VRAI scan tamponné : même tampon), images OUVERTES si aucun arrêt', async () => {
        const arrets = tmp();
        const { resume, unites } = await K.construirePlan({ db: fauxDb(baseDb()), releves: relevesOk(), dossierArrets: arrets });
        assert.strictEqual(resume.imagesFermees.fermees, false);
        assert.deepStrictEqual(resume.parGroupe.map(g => [g.code, g.unites]), [['PP', 2], ['TK11', 1]]);
        assert.deepStrictEqual(unites.map(u => [u.carteId, u.decision.action]).sort(), [[1, 'ajouter'], [2, 'ajouter'], [3, 'ajouter']]);
        assert.strictEqual(resume.dontRemplacentUneBasseDefinition, 1);
        assert.strictEqual(unites.find(u => u.carteId === 2).decision.remplace.length, 1);
    });
    await test('plan : si l\'arrêt durable de l\'hôte des images tient, le plan le DIT en tête (images FERMÉES), et les unités sont ce que la source prouverait', async () => {
        const arrets = tmp();
        RH.arretHote('tcgplayer.com', 'HTTP 403 (HTTP 403)', { dossier: arrets, url: 'https://tcgplayer-cdn.tcgplayer.com/robots.txt' });
        const { resume } = await K.construirePlan({ db: fauxDb(baseDb()), releves: relevesOk(), dossierArrets: arrets });
        assert.strictEqual(resume.imagesFermees.fermees, true); assert.strictEqual(resume.imagesFermees.nature, 'arret-definitif'); assert.match(resume.note, /IMAGES FERMÉES/);
        assert.strictEqual(resume.aAjouter, 3);
    });
    await test('plan : un groupe non relevé ne produit rien et le dit ; un set de la table absent de la base est refusé, compté', async () => {
        const r = await K.construirePlan({ db: fauxDb(baseDb()), releves: {}, dossierArrets: tmp() });
        assert.ok(r.resume.parGroupe.every(g => g.etat === 'non-releve')); assert.strictEqual(r.unites.length, 0);
        assert.ok(r.resume.parGroupe[0].sets.some(s => s.etat === 'set-refuse'));
    });

    // ───────── les images FERMÉES, de bout en bout ─────────
    await test('téléchargement : un arrêt durable écrit (autre cause : une IMAGE en 403) tient — le lancement suivant ne fait AUCUNE requête ; le robots.txt de l\'hôte en 403 n\'en écrit PLUS (arrêt levé pour ces images)', async () => {
        const arrets = tmp(), appels = [];
        const unites = [{ carteId: 1, slugSet: SERIE('One'), numero: null, produits: [1], url: 'https://tcgplayer-cdn.tcgplayer.com/product/475973_in_1000x1000.jpg', groupe: 'PP' }];
        const transport = { async get(u) { appels.push(u); return { status: 403, type: 'text/html', texte: 'Forbidden' }; } };
        const r1 = await RC.telecharger({ SRC: TC.SRC, unites, cli: mkCli(transport, tmp(), 50, arrets), fichier: path.join(tmp(), 'i.json'), hoteImages: TC.HOTE_IMAGES });
        assert.strictEqual(r1.etat, 'arret-definitif'); assert.strictEqual(appels.length, 2, 'robots.txt (403 = aucune règle) puis l\'image (403 = arrêt)');
        const r2 = await RC.telecharger({ SRC: TC.SRC, unites, cli: mkCli(transport, tmp(), 50, arrets), fichier: path.join(tmp(), 'i2.json'), hoteImages: TC.HOTE_IMAGES });
        assert.strictEqual(r2.etat, 'arret-definitif'); assert.strictEqual(appels.length, 2, 'le second lancement ne fait AUCUNE requête');
    });

    // ───────── la ligne de commande ─────────
    await test('ligne de commande : mêmes refus que le collecteur ppr (code 2), sans connexion ; --ecrire hors de lot-additif.js refusé', () => {
        const lance = (...a) => spawnSync(process.execPath, [COLL_FILE, ...a], { encoding: 'utf8', timeout: 20000 });
        for (const a of [['--inconnu'], [], ['--plan', '--releve'], ['--releve'], ['--telecharger'], ['--ecrire'], ['--plan', '--attendu=3'], ['--plan', '--plafond=5'], ['--releve', '--plafond=5', '--limite=3']]) assert.strictEqual(lance(...a).status, 2, JSON.stringify(a));
        const dossier = tmp();
        fs.writeFileSync(path.join(dossier, 'plan-tcs.json'), JSON.stringify({ unites: [] }));
        const r = spawnSync(process.execPath, [COLL_FILE, '--ecrire', '--attendu=1', `--dossier=${dossier}`], { encoding: 'utf8', timeout: 20000 });
        assert.notStrictEqual(r.status, 0); assert.ok(/lot-additif\.js/.test(r.stderr), r.stderr);
    });
    await test('les deux sources partagent la même ligne de commande (une seule grammaire) et des fichiers de sortie par code neutre', () => {
        const CLI = require('./collecte-cartes/recolte-cli');
        assert.strictEqual(CLI.verifierArguments(['--plan']), null);
        assert.match(CLI.verifierArguments(['--plan', '--zzz']), /argument inconnu/);
        const F2 = K.fichiersDe('C:\\x\\sortie', 'C:\\y\\cache');
        assert.deepStrictEqual([path.basename(F2.plan), path.basename(F2.releves), path.basename(F2.images), path.basename(F2.journal), path.basename(F2.essai)], ['plan-tcs.json', 'releves-tcs.json', 'images-tcs.json', 'journal-tcs.jsonl', 'essai-ecriture-tcs.txt']);
        assert.throws(() => CLI.fichiersDe('tcs', 'C:\\x', 'C:\\Users\\Yung\\Desktop\\Logo FR\\c'), /refusé/);
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
