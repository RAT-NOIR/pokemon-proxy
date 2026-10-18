// Banc de collecte-cartes/cardtrader.js — fonctions pures et client à transport injecté. Aucune requête réelle, aucune base.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const C = require('./collecte-cartes/cardtrader');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${e.message}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ctr-'));

(async () => {
    await test('robots : sitemaps déclarés', () => {
        const t = 'User-agent: *\nDisallow: /uploads/\nAllow: /uploads/blueprints/\nSitemap: https://www.cardtrader.com/sitemap.xml\nsitemap: https://www.cardtrader.com/a.xml # note\n';
        assert.deepStrictEqual(C.sitemapsDesRobots(t), ['https://www.cardtrader.com/sitemap.xml', 'https://www.cardtrader.com/a.xml']);
    });
    await test('robots : sitemap hors hôte refusé (jamais suivi)', () => {
        const t = 'Sitemap: https://evil.example/x.xml\nSitemap: https://www.cardtrader.com/ok.xml\n';
        assert.deepStrictEqual(C.sitemapsDesRobots(t), ['https://www.cardtrader.com/ok.xml']);
    });
    await test('sitemap index', () => {
        const x = '<?xml version="1.0"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><sitemap><loc>https://www.cardtrader.com/s1.xml.gz</loc></sitemap><sitemap><loc>https://www.cardtrader.com/s2.xml</loc></sitemap></sitemapindex>';
        const r = C.lireSitemap(x);
        assert.strictEqual(r.type, 'index');
        assert.deepStrictEqual(r.entrees.map(e => e.loc), ['https://www.cardtrader.com/s1.xml.gz', 'https://www.cardtrader.com/s2.xml']);
    });
    await test('sitemap urlset avec image:loc et entités', () => {
        const x = '<urlset xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"><url><loc>https://www.cardtrader.com/en/cards/a?x=1&amp;y=2</loc><image:image><image:loc>https://www.cardtrader.com/uploads/blueprints/image/12/show_a.jpg</image:loc></image:image></url><url><loc>https://www.cardtrader.com/en/cards/b</loc></url></urlset>';
        const r = C.lireSitemap(x);
        assert.strictEqual(r.type, 'urlset');
        assert.strictEqual(r.entrees.length, 2);
        assert.strictEqual(r.entrees[0].loc, 'https://www.cardtrader.com/en/cards/a?x=1&y=2');
        assert.deepStrictEqual(r.entrees[0].images, ['https://www.cardtrader.com/uploads/blueprints/image/12/show_a.jpg']);
        assert.deepStrictEqual(r.entrees[1].images, []);
    });
    await test('sitemap illisible : lève (jamais un vide)', () => {
        assert.throws(() => C.lireSitemap('<html>Just a moment</html>'), /ni sitemapindex ni urlset/);
        assert.throws(() => C.lireSitemap(''), /ni sitemapindex ni urlset/);
    });
    await test('image de blueprint : id et slug', () => {
        const r = C.blueprintDepuisImage('https://www.cardtrader.com/uploads/blueprints/image/311538/show_mewtwo-mew-gx-2019-world-championships-promo-henry-brand-world-championship-decks.jpg');
        assert.strictEqual(r.id, 311538);
        assert.strictEqual(r.slug, 'mewtwo-mew-gx-2019-world-championships-promo-henry-brand-world-championship-decks');
        assert.strictEqual(C.blueprintDepuisImage('https://www.cardtrader.com/autre/chose.jpg'), null);
    });
    await test('famille d\'une expansion', () => {
        assert.deepStrictEqual(C.familleDeExpansion('world-championship-decks-2019'), { famille: 'wcd', cle: '2019' });
        assert.deepStrictEqual(C.familleDeExpansion('play-pokemon-prize-pack'), { famille: 'pp', cle: null });
        assert.strictEqual(C.familleDeExpansion('sword-shield-base-set'), null);
    });
    await test('cache : une réponse en cache n\'est jamais redemandée ; plafond respecté', async () => {
        const dossier = tmp();
        let appels = 0; const dates = [];
        const transport = { async get(url) { appels++; dates.push(Date.now()); return { status: 200, type: 'application/xml', texte: `<urlset><url><loc>${url}</loc></url></urlset>` }; } };
        const cli = C.fabriquerClient({ dossierCache: dossier, plafond: 2, transport, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), robots: null });
        await cli.lire('https://www.cardtrader.com/a.xml');
        await cli.lire('https://www.cardtrader.com/a.xml');
        assert.strictEqual(appels, 1);
        await cli.lire('https://www.cardtrader.com/b.xml');
        await assert.rejects(() => cli.lire('https://www.cardtrader.com/c.xml'), /plafond/);
        assert.strictEqual(cli.requetes(), 2);
    });
    await test('client : hôte étranger refusé sans requête', async () => {
        let appels = 0;
        const cli = C.fabriquerClient({ dossierCache: tmp(), plafond: 5, transport: { async get() { appels++; return { status: 200, type: 'text/plain', texte: 'x' }; } }, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), robots: null });
        await assert.rejects(() => cli.lire('https://www.bulbapedia.example/x'), /hors/);
        assert.strictEqual(appels, 0);
    });
    await test('client : robots interdit le chemin -> refusé sans requête', async () => {
        let appels = 0;
        const cli = C.fabriquerClient({ dossierCache: tmp(), plafond: 5, transport: { async get() { appels++; return { status: 200, type: 'text/plain', texte: 'x' }; } }, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), robots: 'User-agent: *\nDisallow: /secret/\n' });
        await assert.rejects(() => cli.lire('https://www.cardtrader.com/secret/a'), /robots/);
        assert.strictEqual(appels, 0);
    });
    await test('client : défi (403) -> arrêt durable de l\'hôte, plus aucune requête', async () => {
        const pauses = tmp(); let appels = 0;
        const transport = { async get() { appels++; return { status: 403, type: 'text/html', texte: '<html>Just a moment...</html>' }; } };
        const cli = C.fabriquerClient({ dossierCache: tmp(), plafond: 5, transport, cadenceMs: 0, pause: async () => {}, dossierPauses: pauses, robots: null });
        await assert.rejects(() => cli.lire('https://www.cardtrader.com/a.xml'), /BLOQU|ARRÊT/i);
        await assert.rejects(() => cli.lire('https://www.cardtrader.com/b.xml'), /ARRÊT|BLOQU/i);
        assert.strictEqual(appels, 1);
    });
    await test('client : cadence >= 5 s imposée même si on demande 0', async () => {
        const attentes = []; let t = 1000;
        const transport = { async get() { return { status: 200, type: 'application/xml', texte: '<urlset></urlset>' }; } };
        const cli = C.fabriquerClient({ dossierCache: tmp(), plafond: 5, transport, cadenceMs: 0, pause: async ms => { attentes.push(ms); t += ms; }, now: () => t, dossierPauses: tmp(), robots: null });
        await cli.lire('https://www.cardtrader.com/a.xml');
        await cli.lire('https://www.cardtrader.com/b.xml');
        assert.ok(attentes.length === 1 && attentes[0] >= 5000, JSON.stringify(attentes));
    });
    // ───────── les blueprints (formes réelles relevées dans les sitemaps du 2026-10-18) ─────────
    const P = C.blueprintDepuisPage;
    const U = s => `https://www.cardtrader.com/en-US/cards/${s}`;
    await test('page WCD : nom, année, joueur, numéro/total', () => {
        const b = P(U('315523-dedenne-gx-wcd-2019-shintaro-ito-057-214-world-championship-decks-2019'));
        assert.deepStrictEqual([b.id, b.famille, b.annee, b.nom, b.joueur, b.numero, b.total, b.code], [315523, 'wcd', '2019', 'dedenne gx', 'shintaro ito', 57, 214, null]);
    });
    await test('page WCD : rareté retirée du joueur, total non rempli, code SM, non numérotée', () => {
        const a = P(U('318530-forest-seal-stone-wcd-2023-tord-reklev-holo-rare-156-195-world-championship-decks-2023'));
        assert.deepStrictEqual([a.joueur, a.numero, a.total], ['tord reklev', 156, 195]);
        const b = P(U('317708-solgaleo-gx-wcd-2019-henry-brand-sm104-world-championship-decks-2019'));
        assert.deepStrictEqual([b.joueur, b.numero, b.code], ['henry brand', 104, 'sm']);
        const c = P(U('315507-fire-energy-wcd-2019-shintaro-ito-unnumbered-world-championship-decks-2019'));
        assert.deepStrictEqual([c.nom, c.joueur, c.numero], ['fire energy', 'shintaro ito', null]);
        const d = P(U('316617-turtonator-prism-star-wcd-2019-kaya-lichtleitner-050-70-world-championship-decks-2019'));
        assert.deepStrictEqual([d.nom, d.numero, d.total], ['turtonator prism star', 50, 70]);
    });
    await test('page WCD : une boîte de deck n\'est pas une carte', () => {
        assert.strictEqual(P(U('105925-wcd-2019-pikarom-judge-world-championship-decks-2019')).type, 'scelle');
    });
    await test('page PP : code d\'origine, numéro, total, finition', () => {
        const a = P(U('296375-gholdengo-ex-par-139-play-pokemon-prize-pack-series'));
        assert.deepStrictEqual([a.famille, a.nom, a.code, a.numero, a.total, a.finition], ['pp', 'gholdengo ex', 'par', 139, null, null]);
        const b = P(U('321757-ditto-cosmos-holo-132-165-play-pokemon-prize-pack-series'));
        assert.deepStrictEqual([b.nom, b.numero, b.total, b.finition], ['ditto', 132, 165, 'cosmos holo']);
        const c = P(U('296385-counter-catcher-non-holo-cosmos-holo-par-160-play-pokemon-prize-pack-series'));
        assert.deepStrictEqual([c.nom, c.code, c.numero, c.finition], ['counter catcher', 'par', 160, 'non holo cosmos holo']);
        const d = P(U('321752-play-pokemon-prize-pack-series-six-booster-series-six-play-pokemon-prize-pack-series'));
        assert.strictEqual(d.type, 'scelle');
    });
    await test('page BA : année, positions, deck', () => {
        const a = P(U('302783-blitzle-053-185-15-pikachu-stamped-battle-academy-2022'));
        assert.deepStrictEqual([a.famille, a.annee, a.nom, a.numero, a.total, a.position, a.deck], ['ba', '2022', 'blitzle', 53, 185, 15, 'pikachu']);
        const b = P(U('302797-darkness-energy-eevee-stamped-battle-academy-2022'));
        assert.deepStrictEqual([b.nom, b.numero, b.position, b.deck], ['darkness energy', null, null, 'eevee']);
        const c = P(U('321635-charizard-gx-009-068-charizard-stamp-60-battle-academy-2020'));
        assert.deepStrictEqual([c.nom, c.numero, c.total, c.position, c.deck], ['charizard gx', 9, 68, 60, 'charizard']);
        const d = P(U('311169-ampharos-021-066-scarlet-violet-battle-academy'));
        assert.strictEqual(d, null);          // l'expansion Scarlet & Violet Battle Academy n'est pas dans la population
    });
    await test('page : autre jeu ou autre expansion -> null', () => {
        assert.strictEqual(P(U('64182-dark-magician-girl-special-world-championship-celebration-promos')), null);
        assert.strictEqual(P('https://www.cardtrader.com/en-US/games/pokemon'), null);
    });
    // ───────── les produits Cardmarket ─────────
    const S = C.produitDepuisSlug;
    await test('slug Cardmarket WCD / PP / BA', () => {
        assert.deepStrictEqual(S('Jirachi-WCD19TEU-099', 'wcd'), { nom: 'jirachi', code: 'teu', numero: 99, variante: null });
        assert.deepStrictEqual(S('Dedenne-GX-V1-WCD19UNB-057', 'wcd'), { nom: 'dedenne gx', code: 'unb', numero: 57, variante: 'V1' });
        assert.deepStrictEqual(S('Buddy-Buddy-Poffin-V2-PPS6TEF-144', 'pp'), { nom: 'buddy buddy poffin', code: 'tef', numero: 144, variante: 'V2' });
        assert.deepStrictEqual(S('Pikachu-V-VIV43', 'ba'), { nom: 'pikachu v', code: 'viv', numero: 43, variante: null, deck: null, position: null });
        assert.deepStrictEqual(S('Darkness-Energy-BA22', 'ba'), { nom: 'darkness energy', code: null, numero: null, variante: null, deck: null, position: null });
    });
    await test('slug Cardmarket illisible -> null (jamais deviné)', () => {
        assert.strictEqual(S('', 'wcd'), null);
        assert.strictEqual(S(null, 'pp'), null);
    });
    // ───────── l'appariement ─────────
    const bp = (s) => P(U(s));
    const A = C.apparier;
    const prod = (o) => ({ idProduct: 1, famille: 'wcd', annee: '2019', slug: 'Jirachi-WCD19TEU-099', numeroCM: null, impressions: [{ numero: '99', total: '181' }], carteNom: 'Jirachi', ...o });
    await test('WCD : un seul joueur -> apparié', () => {
        const r = A([prod()], [bp('316591-jirachi-wcd-2019-kaya-lichtleitner-099-181-world-championship-decks-2019')]);
        assert.strictEqual(r[0].statut, 'apparie'); assert.strictEqual(r[0].blueprint.id, 316591);
    });
    await test('WCD : plusieurs joueurs -> ambigu (cause joueurs), jamais deviné', () => {
        const r = A([prod({ slug: 'Welder-WCD19UNB-189', carteNom: 'Welder', impressions: [{ numero: '189', total: '214' }] })], [
            bp('315511-welder-wcd-2019-shintaro-ito-189-214-world-championship-decks-2019'),
            bp('316603-welder-wcd-2019-kaya-lichtleitner-189-214-world-championship-decks-2019'),
            bp('317698-welder-wcd-2019-henry-brand-189-214-world-championship-decks-2019')]);
        assert.strictEqual(r[0].statut, 'ambigu'); assert.strictEqual(r[0].cause, 'joueurs'); assert.strictEqual(r[0].candidats.length, 3);
    });
    await test('WCD : mauvaise année -> introuvable', () => {
        const r = A([prod({ annee: '2022' })], [bp('316591-jirachi-wcd-2019-kaya-lichtleitner-099-181-world-championship-decks-2019')]);
        assert.strictEqual(r[0].statut, 'introuvable');
    });
    await test('témoin : le total contredit -> refusé par le témoin', () => {
        const r = A([prod({ impressions: [{ numero: '99', total: '300' }] })], [bp('316591-jirachi-wcd-2019-kaya-lichtleitner-099-181-world-championship-decks-2019')]);
        assert.strictEqual(r[0].statut, 'refuse-temoin');
    });
    await test('témoin : sans carte jointe, apparié mais marqué sans témoin', () => {
        const r = A([prod({ impressions: null, carteNom: null })], [bp('316591-jirachi-wcd-2019-kaya-lichtleitner-099-181-world-championship-decks-2019')]);
        assert.strictEqual(r[0].statut, 'apparie'); assert.strictEqual(r[0].temoin, 'absent');
    });
    await test('PP : code et numéro, deux séries -> même blueprint permis', () => {
        const b = bp('296375-gholdengo-ex-par-139-play-pokemon-prize-pack-series');
        const mk = (id, slug) => ({ idProduct: id, famille: 'pp', annee: null, serie: 'Five', slug, impressions: [{ numero: '139', total: '182' }], carteNom: 'Gholdengo ex' });
        const r = A([mk(1, 'Gholdengo-ex-PPS5PAR-139'), mk(2, 'Gholdengo-ex-PPS7PAR-139')], [b]);
        assert.deepStrictEqual(r.map(x => x.statut), ['apparie', 'apparie']);
        assert.strictEqual(r[0].blueprint.id, r[1].blueprint.id);
    });
    await test('PP : le code d\'origine contredit -> pas candidat', () => {
        const b = bp('296375-gholdengo-ex-par-139-play-pokemon-prize-pack-series');
        const r = A([{ idProduct: 1, famille: 'pp', slug: 'Gholdengo-ex-PPS5SVI-139', impressions: [{ numero: '139', total: '198' }], carteNom: 'Gholdengo ex' }], [b]);
        assert.strictEqual(r[0].statut, 'introuvable');
    });
    await test('PP : deux finitions pour un produit -> ambigu (cause finition)', () => {
        const r = A([{ idProduct: 1, famille: 'pp', slug: 'Ditto-PPS6MEW-132', impressions: [{ numero: '132', total: '165' }], carteNom: 'Ditto' }], [
            bp('321757-ditto-cosmos-holo-132-165-play-pokemon-prize-pack-series'), bp('321758-ditto-non-holo-132-165-play-pokemon-prize-pack-series')]);
        assert.strictEqual(r[0].statut, 'ambigu'); assert.strictEqual(r[0].cause, 'finition');
    });
    await test('BA : deck + position + nom -> apparié ; plusieurs positions -> ambigu', () => {
        const b1 = bp('321635-charizard-gx-009-068-charizard-stamp-60-battle-academy-2020');
        const m = { idProduct: 1, famille: 'ba', annee: '2020', slug: 'Charizard-GX-HIF9', numeroCM: 'C60', impressions: [{ numero: '9', total: '68' }], carteNom: 'Charizard GX' };
        assert.strictEqual(A([m], [b1])[0].statut, 'apparie');
        const m2 = { ...m, numeroCM: 'P15', slug: 'Blitzle-BLW53', carteNom: 'Blitzle', impressions: [{ numero: '53', total: '185' }], annee: '2022' };
        const r = A([m2], [bp('302783-blitzle-053-185-15-pikachu-stamped-battle-academy-2022'), bp('302786-blitzle-053-185-55-pikachu-stamped-battle-academy-2022')]);
        assert.strictEqual(r[0].statut, 'apparie');           // la position 15 désigne un seul des deux
        // un deck à code de trois lettres n'a pas de position : seules les cartes sans position sont candidates
        const m3 = { ...m2, numeroCM: 'EVE' };
        assert.strictEqual(A([m3], [bp('302783-blitzle-053-185-15-pikachu-stamped-battle-academy-2022'), bp('302786-blitzle-053-185-55-pikachu-stamped-battle-academy-2022')])[0].statut, 'introuvable');
        const e1 = bp('302900-blitzle-053-185-eevee-stamped-battle-academy-2022'), e2 = bp('302901-blitzle-053-185-eevee-stamped-battle-academy-2022');
        assert.strictEqual(A([m3], [e1])[0].statut, 'apparie');
        assert.strictEqual(A([m3], [e1, e2])[0].statut, 'ambigu');
    });
    await test('BA : le slug 2022/2024 porte deck+position ou le code du deck', () => {
        assert.deepStrictEqual(S('Vulpix-V1-BA22C13', 'ba'), { nom: 'vulpix', code: null, numero: null, variante: 'V1', deck: 'c', position: 13 });
        assert.deepStrictEqual(S('Basic-Darkness-Energy-BA24DAR', 'ba'), { nom: 'basic darkness energy', code: null, numero: null, variante: null, deck: 'dar', position: null });
    });
    await test('BA : le numéro d\'origine du blueprint, hors de la clé, est le témoin (confirme / contredit)', () => {
        const b = bp('296655-ampharos-109-pikachu-28-battle-academy-2024');
        const mk = impressions => ({ idProduct: 1, famille: 'ba', annee: '2024', slug: 'Ampharos-BA24P28', numeroCM: 'P28', impressions, carteNom: 'Ampharos' });
        assert.strictEqual(A([mk([{ numero: '109', total: '198' }])], [b])[0].temoin, 'confirme');
        const r = A([mk([{ numero: '055', total: '198' }])], [b]);
        assert.strictEqual(r[0].statut, 'refuse-temoin');
        assert.strictEqual(A([mk(null)], [b])[0].temoin, 'absent');
    });
    await test('slug WCD réduit à l\'année : Énergie de base sans code ni numéro', () => {
        assert.deepStrictEqual(S('Basic-Grass-Energy-V1-WCD25', 'wcd'), { nom: 'basic grass energy', code: null, numero: null, variante: 'V1' });
    });
    await test('BA : numéro Cardmarket sans position, deck à code long : sous-suite du nom du deck', () => {
        const b = bp('296663-basic-darkness-energy-007-darkrai-deck-battle-academy-2024');
        const r = A([{ idProduct: 1, famille: 'ba', annee: '2024', slug: 'Basic-Darkness-Energy-BA24DAR', numeroCM: 'DAR', impressions: null, carteNom: null }], [b]);
        assert.strictEqual(r[0].statut, 'apparie');
    });
    await test('slugs sans numéro ou collés : WCD25196, WCD19SUM, PPS1', () => {
        assert.deepStrictEqual(S('Ultra-Ball-V2-WCD25196', 'wcd'), { nom: 'ultra ball', code: null, numero: 196, variante: 'V2' });
        assert.deepStrictEqual(S('Fire-Energy-V1-WCD19SUM', 'wcd'), { nom: 'fire energy', code: 'sum', numero: null, variante: 'V1' });
        assert.deepStrictEqual(S('Fire-Energy-V1-PPS1', 'pp'), { nom: 'fire energy', code: null, numero: null, variante: 'V1' });
    });
    await test('PP : finition après le numéro', () => {
        const b = bp('244123-double-turbo-energy-151-172-non-holo-reverse-holo-play-pokemon-prize-pack-series');
        assert.deepStrictEqual([b.nom, b.numero, b.total, b.finition], ['double turbo energy', 151, 172, 'non holo reverse holo']);
    });
    await test('noms : l\'apostrophe n\'est pas un séparateur (Professors / professor-s), Basic ignoré, Lv collé', () => {
        const pp = bp('296390-professor-s-research-professor-sada-non-holo-170-182-play-pokemon-prize-pack-series');
        const r = A([{ idProduct: 1, famille: 'pp', slug: 'Professors-Research-Professor-Sada-V1-PPS5SVI-170', impressions: [{ numero: '170', total: '182' }], carteNom: null }], [pp]);
        assert.strictEqual(r[0].statut, 'apparie');
        const w = bp('314152-uxie-lv-35-wcd-2009-david-cohen-043-146-world-championship-decks-2009');
        const r2 = A([{ idProduct: 2, famille: 'wcd', annee: '2009', slug: 'Uxie-Lv35-WCD09LA-043', impressions: [{ numero: '43', total: '146' }], carteNom: null }], [w]);
        assert.strictEqual(r2[0].statut, 'apparie');
    });
    await test('nom seul (le blueprint n\'a pas de numéro) : une seule origine -> apparié "nom-seul" ; deux origines -> ambigu', () => {
        const b = bp('327700-dragapult-ex-wcd-2024-sakuya-ota-world-championship-decks-2024');
        const p1 = { idProduct: 1, famille: 'wcd', annee: '2024', slug: 'Dragapult-ex-WCD24TWM-130', impressions: null, carteNom: null };
        const r = A([p1], [b], [p1]);
        assert.strictEqual(r[0].statut, 'apparie'); assert.strictEqual(r[0].cle, 'nom-seul'); assert.strictEqual(r[0].temoin, 'non-applicable');
        const p2 = { idProduct: 2, famille: 'wcd', annee: '2024', slug: 'Dragapult-ex-WCD24SFA-130', impressions: null, carteNom: null };
        const r2 = A([p1], [b], [p1, p2]);
        assert.strictEqual(r2[0].statut, 'ambigu'); assert.strictEqual(r2[0].cause, 'origine');
        const b2 = bp('327701-dragapult-ex-wcd-2024-autre-joueur-world-championship-decks-2024');
        assert.strictEqual(A([p1], [b, b2], [p1])[0].cause, 'joueurs');
    });
    await test('servi : même prédicat que mesure-catalogue (visuel du bon tirage, jamais le scan du jumeau)', () => {
        const liens = [{ idProduct: 1, carteId: 10, slugSet: 'WCD-2019' }, { idProduct: 2, carteId: 11, slugSet: 'WCD-2019' }, { idProduct: 3, carteId: 12, slugSet: 'WCD-2019' }];
        const cartes = new Map([[10, [{ set: 'WCD-2019', langue: 'en' }]], [11, [{ set: 'Autre', langue: 'en' }]], [12, [{ set: 'WCD-2019', langue: 'ja' }]]]);
        const regionDe = new Map([['WCD-2019', 'intl'], ['Autre', 'intl']]);
        const s = C.produitsServis({ liens, imagesParCarte: cartes, regionDe });
        assert.deepStrictEqual([...s].sort(), [1]);
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
