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
    await test('relevé : robots + groupes + un fichier par groupe de la table = 4 requêtes ; JSON seulement, réduits (aucun prix) ; reprise sans requête', async () => {
        const dossier = tmp(), fichier = path.join(tmp(), 'r.json'), appels = [];
        const r = await K.releve({ cli: mkCli(transportOk(appels), dossier), fichier });
        assert.strictEqual(r.etat, 'termine'); assert.strictEqual(appels.length, 4); assert.deepStrictEqual(r.requetesParHote, { 'tcgcsv.com': 4 });
        assert.ok(appels.every(u => !/prices/.test(u)), 'aucune adresse de prix'); assert.ok(appels.every(u => u.startsWith('https://tcgcsv.com/')), 'aucune requête vers l\'hôte des images');
        const rel = JSON.parse(fs.readFileSync(fichier, 'utf8'));
        assert.strictEqual(rel[22880].produits.length, 9); assert.deepStrictEqual(Object.keys(rel[22880].produits[0]).sort(), ['groupId', 'imageUrl', 'name', 'number', 'productId', 'rarity']);
        assert.ok(!/price|CardText/i.test(JSON.stringify(rel)));
        await K.releve({ cli: mkCli(transportOk(appels), dossier), fichier });
        assert.strictEqual(appels.length, 4);
        // le cache ne garde que la liste réduite
        assert.ok(fs.readdirSync(dossier).filter(f => /22880/.test(f)).every(f => !/CardText/.test(fs.readFileSync(path.join(dossier, f), 'utf8'))));
    });
    await test('relevé : un groupe renommé ou absent de la liste LÈVE (arrêt, rien relevé) ; un 403 arrête définitivement ; un groupe qui rend les produits d\'un autre est refusé', async () => {
        const renomme = JSON.parse(F.groupes); renomme.results.find(g => g.groupId === 2208).name = 'Autre';
        const t1 = { async get(u) { return u.endsWith('robots.txt') ? { status: 200, type: 'text/plain', texte: ROBOTS } : { status: 200, type: 'application/json', texte: JSON.stringify(renomme) }; } };
        const r1 = await K.releve({ cli: mkCli(t1, tmp()), fichier: path.join(tmp(), 'a.json') });
        assert.strictEqual(r1.etat, 'interrompu'); assert.match(r1.motif, /renommé/);
        const r2 = await K.releve({ cli: mkCli({ async get() { return { status: 403, type: 'text/html', texte: 'x' }; } }, tmp()), fichier: path.join(tmp(), 'b.json') });
        assert.strictEqual(r2.etat, 'arret-definitif');
        const t3 = { async get(u) { if (u.endsWith('/22880/products')) { const j = JSON.parse(F.pp); j.results[0].groupId = 1; return { status: 200, type: 'application/json', texte: JSON.stringify(j) }; } return transportOk().get(u); } };
        const r3 = await K.releve({ cli: mkCli(t3, tmp()), fichier: path.join(tmp(), 'c.json') });
        assert.match(r3.motif, /autre groupe/);
    });
    await test('maximum : compté avant la première requête ; ce qui est au cache ne compte pas', () => {
        const dossier = tmp(), F2 = K.fichiersDe(dossier, path.join(dossier, 'c'));
        assert.strictEqual(K.maximumReleve({ F: F2, releves: {}, plafondTotal: 300 }).total, 4);
        assert.strictEqual(K.maximumReleve({ F: F2, releves: { groupes: {}, 22880: { produits: [] } }, plafondTotal: 300 }).total, 3);
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
    await test('téléchargement : refusé SANS une requête tant que l\'arrêt durable tient ; le robots.txt de l\'hôte en 403 l\'écrit', async () => {
        const arrets = tmp(), appels = [];
        const unites = [{ carteId: 1, slugSet: SERIE('One'), numero: null, produits: [1], url: 'https://tcgplayer-cdn.tcgplayer.com/product/475973_in_1000x1000.jpg', groupe: 'PP' }];
        const transport = { async get(u) { appels.push(u); return { status: 403, type: 'text/html', texte: 'Forbidden' }; } };
        const r1 = await RC.telecharger({ SRC: TC.SRC, unites, cli: mkCli(transport, tmp(), 50, arrets), fichier: path.join(tmp(), 'i.json'), hoteImages: TC.HOTE_IMAGES });
        assert.strictEqual(r1.etat, 'arret-definitif'); assert.strictEqual(appels.length, 1);
        const r2 = await RC.telecharger({ SRC: TC.SRC, unites, cli: mkCli(transport, tmp(), 50, arrets), fichier: path.join(tmp(), 'i2.json'), hoteImages: TC.HOTE_IMAGES });
        assert.strictEqual(r2.etat, 'arret-definitif'); assert.strictEqual(appels.length, 1, 'le second lancement ne fait AUCUNE requête');
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
