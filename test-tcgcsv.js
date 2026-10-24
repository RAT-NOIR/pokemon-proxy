// Banc de collecte-cartes/tcgcsv.js (source « tcs ») — table fermée, lecture réduite SANS prix, preuve et plan des Prize Packs et du kit, images FERMÉES par l'arrêt durable. Produits RÉELS en fixture ; aucune requête.
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const TC = require(process.env.TCS_MODULE || './collecte-cartes/tcgcsv');
const RC = require('./collecte-cartes/recolte-commun');
const RH = require('./collecte-cartes/reponse-hote');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tcs-produits.json'), 'utf8'));

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 5).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tcs-'));
const PP = JSON.parse(TC.reduireProduits(F.pp)).results, KIT = JSON.parse(TC.reduireProduits(F.kit)).results;
const SERIE = n => `Play-Pokemon-Prize-Pack-Series-${n}`;
const carte = (id, nomEn, impressions) => ({ _id: id, nomEn, impressions });
const ligne = (slugSet, carteId, idProduct, slug, c) => ({ slugSet, carteId, idProduct, slug, carte: c });
const imp = (numero, total) => ({ tirage: 'intl', expansion: 'X', numero: String(numero), total: String(total) });

(async () => {
    await test('la lecture RÉDUITE ne garde aucun prix ni texte : productId, nom, adresse, groupe, numéro, rareté — et lève sur une liste illisible', () => {
        const r = JSON.parse(TC.reduireProduits(F.pp));
        assert.deepStrictEqual(Object.keys(r.results[0]).sort(), ['groupId', 'imageUrl', 'name', 'number', 'productId', 'rarity']);
        assert.ok(!/price|prix|CardText|Attack/i.test(JSON.stringify(r)));
        assert.throws(() => TC.reduireProduits('<html>Just a moment</html>'), /./);
        assert.throws(() => TC.reduireProduits(JSON.stringify({ success: false })), /illisible/);
    });
    await test('la réduction est IDEMPOTENTE : une liste déjà réduite se réduit à elle-même (le cache peut porter l\'une ou l\'autre)', () => {
        const une = TC.reduireProduits(F.pp), deux = TC.reduireProduits(une);
        assert.strictEqual(deux, une);
        assert.ok(JSON.parse(deux).results.some(p => p.number === '006/163'));
    });
    await test('la garde de lecture des groupes : les deux groupes de la table, sous leur NOM ; un nom changé ou un groupe absent LÈVE', () => {
        assert.deepStrictEqual(TC.verifierGroupes(F.groupes).lus, [22880, 2208]);
        const renomme = JSON.parse(F.groupes); renomme.results.find(g => g.groupId === 22880).name = 'Autre';
        assert.throws(() => TC.verifierGroupes(JSON.stringify(renomme)), /renommé/);
        assert.throws(() => TC.verifierGroupes(JSON.stringify({ success: true, results: [] })), /illisible ou vide/);
    });
    await test('la table fermée : catégorie 3 seulement ; chemins = groupes et produits ; JAMAIS /prices ; images : 200w et 1000x1000 seulement', () => {
        const h = TC.hotes();
        assert.deepStrictEqual(Object.keys(h).sort(), ['tcgcsv.com', 'tcgplayer-cdn.tcgplayer.com']);
        for (const bon of ['/robots.txt', '/tcgplayer/3/groups', '/tcgplayer/3/22880/products']) assert.ok(h['tcgcsv.com'].chemin.test(bon), bon);
        for (const mauvais of ['/tcgplayer/3/22880/prices', '/tcgplayer/85/groups', '/tcgplayer/3/22880/products/x', '/', '/tcgplayer/3/22880/../85/products']) assert.ok(!h['tcgcsv.com'].chemin.test(mauvais), mauvais);
        for (const bon of ['/robots.txt', '/product/475973_in_1000x1000.jpg', '/product/475973_200w.jpg']) assert.ok(h['tcgplayer-cdn.tcgplayer.com'].chemin.test(bon), bon);
        for (const mauvais of ['/product/475973_400x400.jpg', '/product/x.jpg', '/', '/product/475973_in_1000x1000.jpg?x=1']) assert.ok(!h['tcgplayer-cdn.tcgplayer.com'].chemin.test(mauvais), mauvais);
        assert.throws(() => TC.urlGroupes(85), /hors de la liste/); assert.throws(() => TC.urlProduits(3, -1), /refusé/);
        assert.strictEqual(TC.urlProduits(3, 22880), 'https://tcgcsv.com/tcgplayer/3/22880/products');
        assert.strictEqual(TC.GROUPES.length, 2); assert.strictEqual(TC.groupeDe(22880).famille, 'pp');
    });
    await test('l\'image pleine : la miniature du miroir devient la taille mesurée le 24/10 (et rien d\'autre ne se devine)', () => {
        assert.strictEqual(TC.urlPleine('https://tcgplayer-cdn.tcgplayer.com/product/475973_200w.jpg'), 'https://tcgplayer-cdn.tcgplayer.com/product/475973_in_1000x1000.jpg');
        for (const m of ['https://autre.example/product/475973_200w.jpg', 'https://tcgplayer-cdn.tcgplayer.com/product/475973_400w.jpg', null, 'http://tcgplayer-cdn.tcgplayer.com/product/475973_200w.jpg']) assert.strictEqual(TC.urlPleine(m), null, String(m));
    });
    await test('lecture d\'un produit : Prize Pack « nom - n/t » ; finition Cosmos ; énergie de série, tampon, série 7 = null (jamais devinés)', () => {
        const p = n => TC.produitPrizePack(PP.find(x => x.name === n));
        assert.deepStrictEqual([p('Kricketune V - 006/163').nom, p('Kricketune V - 006/163').numero, p('Kricketune V - 006/163').total, p('Kricketune V - 006/163').cosmos], ['Kricketune V', '6', 163, false]);
        assert.strictEqual(p(F.cosmosSeul).cosmos, true);
        for (const n of ['Grass Energy (Prize Pack Series 1)', 'Unfair Stamp - 165/167'.replace('Unfair Stamp', 'Unfair Stamp') + ' (Left Stamp)']) assert.strictEqual(TC.produitPrizePack({ name: n }), null, n);
        assert.strictEqual(TC.produitPrizePack(PP.find(x => /Series 7/.test(x.name))), null);
    });
    await test('lecture d\'un produit de kit : « Hoothoot (1) » + 106/147 ; un suffixe de demi-deck, une énergie sans numéro, la boîte = null', () => {
        const p = n => TC.produitKit(KIT.find(x => x.name === n));
        assert.deepStrictEqual([p('Hoothoot (1)').nom, p('Hoothoot (1)').numero, p('Hoothoot (1)').total, p('Hoothoot (1)').rang], ['Hoothoot', '106', 147, 1]);
        assert.deepStrictEqual([p('Alolan Sandslash (16)').numero, p('Alolan Sandslash (16)').total, p('Alolan Sandslash (16)').prefixe], ['127', null, 'SM']);
        for (const n of ['Hau (19) (Alolan Sandslash Half-Deck)', 'Water Energy (2)', 'Sun & Moon Trainer Kit: Alolan Sandslash & Alolan Ninetales']) assert.strictEqual(p(n), null, n);
    });
    await test('slug de kit : « Piplup-UPR32 », « Stufful-TK11BUS-110 », « Hau-V1-TK11SUM-120 », « Hoothoot-TK11106 » ; une énergie sans numéro = null', () => {
        const s = x => TC.slugDeKit(x, 'TK11');
        assert.deepStrictEqual([s('Piplup-UPR32').nom, s('Piplup-UPR32').numero, s('Piplup-UPR32').origine], ['Piplup', '32', 'UPR']);
        assert.deepStrictEqual([s('Stufful-TK11BUS-110').nom, s('Stufful-TK11BUS-110').numero], ['Stufful', '110']);
        assert.deepStrictEqual([s('Hau-V1-TK11SUM-120').nom, s('Hau-V1-TK11SUM-120').variante, s('Hau-V1-TK11SUM-120').numero], ['Hau', 'V1', '120']);
        assert.strictEqual(s('Hoothoot-TK11106').numero, '106'); assert.strictEqual(s('Staravia-TK1182').numero, '82');
        assert.strictEqual(s('Water-Energy-V1-SUM'), null);
    });

    // ───────── les Prize Packs ─────────
    const L = {
        kric: ligne(SERIE('One'), 1, 501, 'Kricketune-V-PPS1BST-006', carte(1, 'Kricketune V', [imp(6, 163)])),
        cher: ligne(SERIE('Two'), 2, 502, 'Cherrim-PPS2BST-008', carte(2, 'Cherrim', [imp(8, 163)])),
        deci: ligne(SERIE('Three'), 3, 503, 'Decidueye-PPS3DAA-013', carte(3, 'Decidueye', [imp(13, 189)])),
        decideuxSeries: ligne(SERIE('Four'), 3, 504, 'Decidueye-PPS4DAA-013', carte(3, 'Decidueye', [imp(13, 189)]))
    };
    const planPP = ls => TC.planifierPrizePacks({ lignes: ls, produits: PP });
    await test('PP : nom + numéro + total confirmé par NOTRE carte + une seule série + un seul produit = une unité avec l\'image pleine, le tampon est celui du set', () => {
        const r = planPP([L.kric, L.cher]);
        assert.strictEqual(r.unites.length, 2); assert.deepStrictEqual(r.restes, []);
        const u = r.unites[0];
        assert.deepStrictEqual([u.carteId, u.slugSet, u.numero, u.produits, u.groupe, u.nomSource, u.numeroSource, u.url], [1, SERIE('One'), null, [501], 'PP', 'Kricketune V - 006/163', '6/163', 'https://tcgplayer-cdn.tcgplayer.com/product/475973_in_1000x1000.jpg']);
        // le tampon est celui de la règle commune (images-empruntees.js) : les séries Cinq à Neuf seulement
        assert.strictEqual(TC.SRC.tampon(SERIE('Five')), 'Play! Pokémon'); assert.strictEqual(TC.SRC.tampon(SERIE('One')), undefined);
    });
    await test('PP : la même carte d\'origine dans PLUSIEURS séries n\'a aucune unité (le tampon de la série ne se prouve pas)', () => {
        const r = planPP([L.deci, L.decideuxSeries]);
        assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['plusieurs-series'], 2);
    });
    await test('PP : deux produits de la même série pour la carte (V1/V2) : variantes non lues ; le total non confirmé par notre carte : refusé', () => {
        const v = ligne(SERIE('One'), 1, 505, 'Kricketune-V-V2-PPS1BST-006', L.kric.carte);
        assert.strictEqual(planPP([v]).parMotif['variantes-non-lues'], 1);
        const faux = ligne(SERIE('One'), 1, 501, 'Kricketune-V-PPS1BST-006', carte(1, 'Kricketune V', [imp(6, 999)]));
        assert.strictEqual(planPP([faux]).parMotif['total-non-confirme'], 1);
        const sans = ligne(SERIE('One'), 1, 501, 'Kricketune-V-PPS1BST-006', carte(1, 'Kricketune V', []));
        assert.strictEqual(planPP([sans]).parMotif['total-non-confirme'], 1);
    });
    await test('PP : un autre nom au même numéro, ou un numéro absent du marché : trou ; une carte sans nom : trou ; un slug sans numéro : trou', () => {
        const autre = ligne(SERIE('One'), 1, 501, 'Kricketune-V-PPS1BST-006', carte(1, 'Kricketune VMAX', [imp(6, 163)]));
        assert.strictEqual(planPP([autre]).parMotif['absente-de-la-source'], 1);
        const absent = ligne(SERIE('One'), 9, 509, 'Pikachu-PPS1BST-077', carte(9, 'Pikachu', [imp(77, 163)]));
        assert.strictEqual(planPP([absent]).parMotif['absente-de-la-source'], 1);
        assert.strictEqual(planPP([ligne(SERIE('One'), 9, 509, 'Pikachu-PPS1BST-077', carte(9, null, []))]).parMotif['sans-nom'], 1);
        assert.strictEqual(planPP([ligne(SERIE('One'), 9, 509, 'Basic-Grass-Energy-PPS1', carte(9, 'Grass Energy', []))]).parMotif['slug-sans-numero'], 1);
    });
    await test('PP : une finition « Cosmos Holo » à côté de la plain = finitions multiples ; la seule finition Cosmos = non prouvée', () => {
        const [, nomPlain, total] = /^(.*) - (\d+\/\d+)$/.exec(F.frere.plain) ?? [];
        void nomPlain; void total;
        const m = /^(.*?) - (\d+)\/(\d+)$/.exec(F.frere.plain);
        const l = ligne(SERIE('One'), 7, 507, `X-PPS1ABC-${m[2]}`, carte(7, m[1], [imp(Number(m[2]), Number(m[3]))]));
        assert.strictEqual(planPP([l]).parMotif['finitions-multiples'], 1);
        const c = /^(.*?) - (\d+)\/(\d+) \(Cosmos Holo\)$/.exec(F.cosmosSeul);
        const l2 = ligne(SERIE('One'), 8, 508, `X-PPS1ABC-${c[2]}`, carte(8, c[1], [imp(Number(c[2]), Number(c[3]))]));
        assert.strictEqual(planPP([l2]).parMotif['seule-finition-cosmos'], 1);
    });
    await test('PP : le dénominateur du marché — produits, lus, formes inconnues (énergies de série, tampons), cosmos — est imprimé avec le plan', () => {
        const r = planPP([]);
        assert.strictEqual(r.base.produitsMarche, PP.length); assert.strictEqual(r.base.lus + r.base.formesInconnues, PP.length); assert.ok(r.base.formesInconnues >= 2); assert.ok(r.base.cosmos >= 2);
    });

    // ───────── le kit ─────────
    const SK = 'SM-Trainer-Kit-Alolan-Sandslash-Alolan-Ninetales';
    const planKit = ls => TC.planifierKit({ lignes: ls, produits: KIT, code: 'TK11' });
    await test('kit : nom + numéro d\'origine + total confirmé + un seul produit de chaque côté = une unité', () => {
        const r = planKit([ligne(SK, 11, 601, 'Hoothoot-TK11106', carte(11, 'Hoothoot', [imp(106, 147)])), ligne(SK, 12, 602, 'Piplup-UPR32', carte(12, 'Piplup', [imp(32, 156)])), ligne(SK, 13, 603, 'Staravia-TK1182', carte(13, 'Staravia', [imp(82, 111)]))]);
        assert.strictEqual(r.unites.length, 3); assert.deepStrictEqual(r.restes, []);
        assert.deepStrictEqual([r.unites[0].numero, r.unites[0].groupe, r.unites[0].url], [null, 'TK11', 'https://tcgplayer-cdn.tcgplayer.com/product/168146_in_1000x1000.jpg']);
    });
    await test('kit : deux copies (V1/V2 ↔ (14)/(29)) ne s\'apparient pas ; deux copies au marché pour un produit non plus', () => {
        const s = carte(14, 'Alolan Sandshrew', [imp(19, 145)]);
        const deux = planKit([ligne(SK, 14, 604, 'Alolan-Sandshrew-V1-GRI19', s), ligne(SK, 14, 605, 'Alolan-Sandshrew-V2-GRI19', s)]);
        assert.strictEqual(deux.unites.length, 0); assert.strictEqual(deux.parMotif['copies-multiples'], 2);
        const un = planKit([ligne(SK, 14, 604, 'Alolan-Sandshrew-GRI19', s)]);
        assert.strictEqual(un.unites.length, 0); assert.strictEqual(un.parMotif['copies-multiples-source'], 1);
    });
    await test('kit : un nom de produit différent de la fiche, un total non confirmé, un autre préfixe (SM127 contre un code d\'extension) : trous', () => {
        assert.strictEqual(planKit([ligne(SK, 11, 601, 'Hoothoot-TK11106', carte(11, 'Noctowl', [imp(106, 147)]))]).parMotif['nom-produit-different'], 1);
        assert.strictEqual(planKit([ligne(SK, 11, 601, 'Hoothoot-TK11106', carte(11, 'Hoothoot', [imp(106, 150)]))]).parMotif['total-non-confirme'], 1);
        const p = planKit([ligne(SK, 15, 606, 'Alolan-Sandslash-XYZ127', carte(15, 'Alolan Sandslash', [{ tirage: 'intl', numero: 'SM127', total: null }]))]);
        assert.strictEqual(p.unites.length, 0); assert.strictEqual(p.parMotif['absente-de-la-source'], 1);
    });

    // ───────── la traçabilité neutre et la langue ─────────
    await test('source neutre : `tcs`, lot, clé R2, id, mention et preuve de langue ne nomment JAMAIS la source ; l\'entrée porte l\'adresse d\'origine, la date, retirable et le tampon du set', () => {
        assert.deepStrictEqual([TC.SOURCE, TC.LOT], ['tcs', 'tcs-2026-10']);
        assert.strictEqual(TC.SRC.cleR2(SERIE('One'), null, 501), `tcs/${SERIE('One')}/sn-501-en.webp`);
        const u = { carteId: 1, slugSet: SERIE('Five'), numero: null, produits: [501], url: 'https://tcgplayer-cdn.tcgplayer.com/product/475973_in_1000x1000.jpg', idSource: '475973', preuveNeutre: 'x' };
        const meta = { cleR2: TC.SRC.cleR2(u.slugSet, u.numero, u.carteId), sha256: 'a'.repeat(64), w: 576, h: 804, fmt: 'webp', wOriginal: 576, hOriginal: 804 };
        const e = RC.entreeDeCarte(TC.SRC, u, meta, new Date('2026-10-24T12:00:00Z')), d = RC.documentImage(TC.SRC, u, meta, new Date('2026-10-24T12:00:00Z'));
        for (const o of [e, d]) {
            assert.strictEqual(o.retirable, true); assert.strictEqual(o.urlOriginal, u.url); assert.strictEqual(o.source, 'tcs'); assert.strictEqual(o.lot, 'tcs-2026-10'); assert.strictEqual(o.langue, 'en'); assert.strictEqual(o.tampon, 'Play! Pokémon');
            assert.ok(!/tcgplayer|tcgcsv/i.test(JSON.stringify({ ...o, urlOriginal: null })), 'un champ nomme la source');
        }
        const v = langueDuVisuel({ source: 'tcs', langueSource: 'en' });
        assert.strictEqual(v.langue, 'en'); assert.strictEqual(v.preuve, TC.LANGUE_PREUVE); assert.ok(!/tcgplayer|tcgcsv/i.test(v.preuve));
        assert.strictEqual(langueDuVisuel({ source: 'tcs', langueSource: 'ja' }).langue, null);
    });

    // ───────── les IMAGES FERMÉES ─────────
    await test('images : le robots.txt de l\'hôte en 403 = arrêt DÉFINITIF écrit ; aucune image n\'est demandée ; un client NEUF, même processus ou non, ne part plus', async () => {
        const pauses = tmp(), appels = [];
        const mk = () => TC.fabriquerClient({ dossierCache: tmp(), plafond: 20, cadenceMs: 0, pause: async () => {}, dossierPauses: pauses, suivi: RH.suiviHote(), transport: { async get(u) { appels.push(u); return { status: 403, type: 'text/html', texte: 'Forbidden' }; } } });
        const unites = [{ carteId: 1, slugSet: SERIE('One'), numero: null, produits: [1], url: 'https://tcgplayer-cdn.tcgplayer.com/product/475973_in_1000x1000.jpg', groupe: 'PP' }];
        const r = await RC.telecharger({ SRC: TC.SRC, unites, cli: mk(), fichier: path.join(tmp(), 'i.json'), hoteImages: TC.HOTE_IMAGES });
        assert.strictEqual(r.etat, 'arret-definitif'); assert.deepStrictEqual(appels, ['https://tcgplayer-cdn.tcgplayer.com/robots.txt']);
        assert.ok(fs.readdirSync(pauses).some(f => /^ARRET-HOTE-tcgplayer\.com/.test(f)));
        const r2 = await RC.telecharger({ SRC: TC.SRC, unites, cli: mk(), fichier: path.join(tmp(), 'i2.json'), hoteImages: TC.HOTE_IMAGES });
        assert.strictEqual(r2.etat, 'arret-definitif'); assert.strictEqual(appels.length, 1, 'aucune requête de plus : l\'arrêt écrit tient');
    });
    await test('l\'arrêt des images ne touche PAS les données : la racine du miroir de données est une autre racine', async () => {
        const pauses = tmp();
        RH.arretHote('tcgplayer.com', 'test', { dossier: pauses });
        const appels = [];
        const cli = TC.fabriquerClient({ dossierCache: tmp(), plafond: 20, cadenceMs: 0, pause: async () => {}, dossierPauses: pauses, suivi: RH.suiviHote(), transport: { async get(u) { appels.push(u); return /robots/.test(u) ? { status: 200, type: 'text/plain', texte: 'User-agent: *\nAllow: /\n' } : { status: 200, type: 'application/json', texte: F.groupes }; } } });
        await cli.initialiserRobots('tcgcsv.com');
        const r = await cli.lire(TC.urlGroupes(3));
        assert.strictEqual(r.status, 200); assert.strictEqual(appels.length, 2);
        await assert.rejects(() => cli.initialiserRobots('tcgplayer-cdn.tcgplayer.com'), /ARRÊT/i);
        assert.strictEqual(appels.length, 2);
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
