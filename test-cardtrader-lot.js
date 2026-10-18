// Banc de la phase 2 (lot d'images) de collecte-cartes/cardtrader.js : extraction de l'adresse d'image, contrôle de largeur, lot après exclusions, décision d'écriture, entrées neutres.
// Fixtures : fixtures/cardtrader-pages.json = 12 pages RÉELLES relevées le 2026-10-18, réduites (en-tête og:image + extraits qui citent les fichiers du blueprint). Aucune requête, aucune base.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const C = require(process.env.CTR_MODULE || './collecte-cartes/cardtrader');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${e.message}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ctr2-'));
const pages = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'cardtrader-pages.json'), 'utf8'));

(async () => {
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);
    const mk = (transport, o = {}) => C.fabriquerClient({ dossierCache: tmp(), plafond: 5, transport, cadenceMs: 0, pause: async () => {}, dossierPauses: tmp(), robots: null, suivi: require('./collecte-cartes/reponse-hote').suiviHote(), ...o });
    const URL_IMG = 'https://www.cardtrader.com/uploads/blueprints/image/77/x.jpg';
    await test('12 pages réelles : l\'adresse est l\'og:image pleine taille du blueprint, jamais une variante réduite ni le dos', () => {
        assert.strictEqual(pages.length, 12);
        for (const p of pages) {
            const r = C.imageDePage(p.html, p.url);
            assert.ok(r.url, `${p.url} : ${JSON.stringify(r)}`);
            const id = /cards\/(\d+)-/.exec(p.url)[1];
            assert.ok(r.url.startsWith(`https://www.cardtrader.com/uploads/blueprints/image/${id}/`), r.url);
            assert.ok(!/\/(show|thumb|small|preview)_/.test(r.url) && !/back_image/.test(r.url), r.url);
            assert.strictEqual(r.via, 'og');
        }
    });
    await test('sans og:image : l\'image non préfixée citée par la page ; sinon la variante « show_ » ; le dos jamais', () => {
        const base = 'https://www.cardtrader.com/uploads/blueprints';
        const url = 'https://www.cardtrader.com/en-US/cards/77-x-battle-academy-2022';
        assert.deepStrictEqual(C.imageDePage(`<body><img src="/uploads/blueprints/image/77/show_x.jpg"><img src="/uploads/blueprints/image/77/x.jpg"></body>`, url), { url: `${base}/image/77/x.jpg`, via: 'page' });
        assert.deepStrictEqual(C.imageDePage(`<body><img src="/uploads/blueprints/image/77/show_x.jpg"></body>`, url), { url: `${base}/image/77/show_x.jpg`, via: 'show' });
        assert.ok(C.imageDePage(`<body><img src="/uploads/blueprints/back_image/77/show_x.jpg"></body>`, url).refus);
        assert.ok(C.imageDePage('<html></html>', url).refus);
    });
    await test('une vignette n\'est jamais acceptée, même en og:image ; un autre identifiant ou un autre hôte non plus', () => {
        const url = 'https://www.cardtrader.com/en-US/cards/77-x-battle-academy-2022';
        const og = u => `<head><meta property="og:image" content="${u}" /></head>`;
        for (const v of ['thumb', 'small', 'preview', 'tiny', 'mini']) assert.ok(C.imageDePage(og(`https://www.cardtrader.com/uploads/blueprints/image/77/${v}_x.jpg`), url).refus, v);
        assert.ok(C.imageDePage(og('https://www.cardtrader.com/uploads/blueprints/image/78/x.jpg'), url).refus);
        assert.ok(C.imageDePage(og('https://autre.example/uploads/blueprints/image/77/x.jpg'), url).refus);
        assert.ok(C.imageDePage(og('http://www.cardtrader.com/uploads/blueprints/image/77/x.jpg'), url).refus);
    });
    await test('une page qui ne cite qu\'une vignette, ou que le dos, ne donne aucune adresse', () => {
        const url = 'https://www.cardtrader.com/en-US/cards/77-x-battle-academy-2022';
        assert.ok(C.imageDePage('<body><img src="/uploads/blueprints/image/77/thumb_x.jpg"><img src="/uploads/blueprints/image/77/small_x.jpg"></body>', url).refus);
        assert.ok(C.imageDePage('<body><img src="/uploads/blueprints/back_image/77/x.jpg"><img src="https://www.cardtrader.com/uploads/blueprints/back_image/77/show_x.jpg"></body>', url).refus);
    });
    await test('largeur : >= 350 ok, sinon trop-petit AVEC sa largeur (aucun plancher de 200 px)', () => {
        assert.deepStrictEqual(C.controleLargeur(350), { statut: 'ok', largeur: 350 });
        assert.deepStrictEqual(C.controleLargeur(500), { statut: 'ok', largeur: 500 });
        assert.deepStrictEqual(C.controleLargeur(349), { statut: 'trop-petit', largeur: 349 });
        assert.deepStrictEqual(C.controleLargeur(200), { statut: 'trop-petit', largeur: 200 });
        assert.strictEqual(C.controleLargeur(0).statut, 'trop-petit');
        assert.strictEqual(C.controleLargeur(undefined).statut, 'trop-petit');
    });
    await test('neutre : source, lot, clé R2 et mention ne nomment jamais la source', () => {
        assert.strictEqual(C.SOURCE, 'ctr'); assert.strictEqual(C.LOT, 'ctr-2026-10');
        const cle = C.cleR2('WCD-2019', '099', 232503);
        assert.strictEqual(cle, 'ctr/WCD-2019/099-232503-en.webp');
        for (const s of [C.SOURCE, C.LOT, cle, C.MENTION, C.cleR2('Play-Pokemon-Prize-Pack-Series-Five', null, 5)]) assert.ok(!/cardtrader/i.test(s), s);
        assert.ok(C.cleR2('Battle-Academy-2020', null, 9).startsWith('ctr/Battle-Academy-2020/'));
    });

    // ───────── le lot après exclusions ─────────
    const ap = (id, o = {}) => ({ idProduct: id, groupe: 'WCD 2019', slug: `X-${id}`, statut: 'apparie', blueprint: 100 + id, blueprintSlug: `s${id}`, carteId: 1000 + id, numeroFiche: '099', slugSet: 'WCD-2019', temoin: 'confirme', cle: 'nom+numero', ...o });
    await test('lot : un apparié sans réserve devient une unité', () => {
        const r = C.construireLot([ap(1)]);
        assert.strictEqual(r.unites.length, 1); assert.deepStrictEqual(r.unites[0].produits, [1]); assert.strictEqual(r.unites[0].blueprint, 101);
    });
    await test('lot : un « à réserve », un ambigu, un introuvable, un refusé par le témoin ne sont JAMAIS une unité, et chacun garde sa raison', () => {
        const r = C.construireLot([ap(1, { reserve: 'variantes-un-blueprint' }), ap(2, { statut: 'ambigu', candidats: [1, 2] }), ap(3, { statut: 'introuvable', blueprint: undefined }), ap(4, { statut: 'refuse-temoin', blueprint: undefined })]);
        assert.strictEqual(r.unites.length, 0);
        assert.deepStrictEqual(r.exclus.map(e => [e.idProduct, e.raison]), [[1, 'a-reserve'], [2, 'ambigu'], [3, 'introuvable'], [4, 'refuse-temoin']]);
    });
    await test('lot : un produit sans carte jointe ne s\'écrit pas (aucune carte où poser l\'entrée)', () => {
        const r = C.construireLot([ap(1, { carteId: null })]);
        assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.exclus[0].raison, 'sans-carte');
    });
    await test('I2 — une unité = un produit : deux produits de la même carte et du même set au MÊME blueprint sont exclus (raison « variantes »), quel que soit le drapeau du plan ; deux blueprints = conflit', () => {
        const a = C.construireLot([ap(1, { carteId: 5 }), ap(2, { carteId: 5, blueprint: 101 })]);
        assert.strictEqual(a.unites.length, 0); assert.deepStrictEqual(a.exclus.map(e => [e.idProduct, e.raison]), [[1, 'variantes'], [2, 'variantes']]);
        const b = C.construireLot([ap(1, { carteId: 5 }), ap(2, { carteId: 5, blueprint: 999 })]);
        assert.strictEqual(b.unites.length, 0); assert.deepStrictEqual(b.exclus.map(e => e.raison), ['conflit', 'conflit']);
        // aucune unité du lot n'a jamais plus d'un produit
        const c = C.construireLot([ap(1), ap(2), ap(3, { carteId: 5 }), ap(4, { carteId: 5 })]);
        assert.ok(c.unites.every(u => u.produits.length === 1)); assert.strictEqual(c.unites.length, 2);
    });
    await test('lot : tout ce qui n\'est pas explicitement « apparie » sans réserve est exclu (statut inconnu, réserve vague)', () => {
        const r = C.construireLot([ap(1, { statut: 'autre' }), ap(2, { reserve: 'x' }), ap(3, { statut: undefined })]);
        assert.strictEqual(r.unites.length, 0);
    });
    await test('lot : comptes par famille', () => {
        const r = C.construireLot([ap(1), ap(2, { groupe: 'PP S5', slugSet: 'Play-Pokemon-Prize-Pack-Series-Five' }), ap(3, { groupe: 'BA 2022', slugSet: 'Battle-Academy-2022' }), ap(4, { reserve: 'v' })]);
        assert.deepStrictEqual(r.parFamille, { wcd: 1, pp: 1, ba: 1 });
    });

    // ───────── levée d'une ambiguïté WCD par le JOUEUR, seulement si NOTRE fiche le porte ─────────
    const Bw = s => C.blueprintDepuisPage(`https://www.cardtrader.com/en-US/cards/${s}`);
    const trois = [Bw('315511-welder-wcd-2019-shintaro-ito-189-214-world-championship-decks-2019'), Bw('316603-welder-wcd-2019-kaya-lichtleitner-189-214-world-championship-decks-2019'), Bw('317698-welder-wcd-2019-henry-brand-189-214-world-championship-decks-2019')];
    const welder = (o = {}) => ({ idProduct: 1, famille: 'wcd', annee: '2019', slug: 'Welder-WCD19UNB-189', impressions: [{ numero: '189', total: '214' }], carteNom: 'Welder', ...o });
    await test('joueur : lu sur NOTRE fiche seulement (parenthèse « (Prénom Nom "Deck") » du nom du produit) ; une carte ordinaire n\'en porte pas', () => {
        assert.strictEqual(C.joueurDeLaFiche({ nomProduit: 'Live Code Card (Evan Pavelski ""Regidrago VSTAR"")' }), 'evan pavelski');
        assert.strictEqual(C.joueurDeLaFiche({ nomProduit: 'Jirachi [Stellar Wish | Slap]' }), null);
        assert.strictEqual(C.joueurDeLaFiche({ nomProduit: 'Welder', slug: 'Welder-WCD19UNB-189', slugSet: 'WCD-2019' }), null);
        assert.strictEqual(C.joueurDeLaFiche({}), null);
    });
    await test('joueur : la fiche porte « kaya lichtleitner » -> UN seul candidat reste -> apparié (clé nom+numero+joueur)', () => {
        const r = C.apparier([welder({ joueurFiche: 'Kaya Lichtleitner' })], trois)[0];
        assert.strictEqual(r.statut, 'apparie'); assert.strictEqual(r.blueprint.id, 316603); assert.strictEqual(r.cle, 'nom+numero+joueur');
    });
    await test('joueur : égalité de tokens ENTIERS — « kaya » seul, « lichtleitner » seul, « henry brand jr » ne lèvent rien (aucune inclusion de chaîne)', () => {
        for (const j of ['kaya', 'lichtleitner', 'henry brand jr', 'Kay Lichtleitner']) {
            const r = C.apparier([welder({ joueurFiche: j })], trois)[0];
            assert.strictEqual(r.statut, 'ambigu', j); assert.strictEqual(r.raisonTrou, 'joueur-different', j);
        }
    });
    await test('joueur : fiche sans joueur -> reste un trou, raison « fiche-sans-joueur » ; joueur qui n\'existe pas chez CardTrader -> « joueur-different »', () => {
        const a = C.apparier([welder()], trois)[0];
        assert.deepStrictEqual([a.statut, a.cause, a.raisonTrou], ['ambigu', 'joueurs', 'fiche-sans-joueur']);
        const b = C.apparier([welder({ joueurFiche: 'Quelqu\'un D\'autre' })], trois)[0];
        assert.deepStrictEqual([b.statut, b.raisonTrou], ['ambigu', 'joueur-different']);
    });
    await test('joueur : la levée exige la carte DÉJÀ appariée (même nom, même numéro d\'origine) ; deux candidats du même joueur restent un doublon', () => {
        assert.strictEqual(C.apparier([welder({ slug: 'Welder-WCD19UNB-190', impressions: [{ numero: '190', total: '214' }], joueurFiche: 'Kaya Lichtleitner' })], trois)[0].statut, 'introuvable');
        const dbl = [...trois, Bw('316604-welder-wcd-2019-kaya-lichtleitner-189-214-world-championship-decks-2019')];
        const r = C.apparier([welder({ joueurFiche: 'kaya lichtleitner' })], dbl)[0];
        assert.deepStrictEqual([r.statut, r.cause], ['ambigu', 'doublon']);
    });
    await test('joueur — calibration : sur les WCD déjà appariés, la règle est jugée justes/faux/non évaluables ; un seul faux l\'éteint', () => {
        const ok = { statut: 'apparie', blueprint: trois[1] }, mauvais = { statut: 'apparie', blueprint: trois[2] };
        const c = C.calibrerJoueur([{ joueurFiche: 'kaya lichtleitner' }, { joueurFiche: 'kaya lichtleitner' }, {}, { joueurFiche: 'x y' }], [ok, mauvais, ok, ok]);
        assert.deepStrictEqual(c, { evaluables: 3, justes: 1, faux: 2, nonEvaluables: 1, active: false });
        assert.deepStrictEqual(C.calibrerJoueur([{ joueurFiche: 'kaya lichtleitner' }], [ok]), { evaluables: 1, justes: 1, faux: 0, nonEvaluables: 0, active: true });
        assert.deepStrictEqual(C.calibrerJoueur([{}, {}], [ok, ok]), { evaluables: 0, justes: 0, faux: 0, nonEvaluables: 2, active: false });
    });

    // ───────── I1 : le nom de NOTRE fiche contre le nom du blueprint ─────────
    const SLUG_JIRACHI = 'jirachi-wcd-2019-kaya-lichtleitner-099-181-world-championship-decks-2019';
    await test('I1 — le nom de la fiche concorde avec le blueprint (même normalisation que l\'appariement) : l\'unité reste, marquée', () => {
        const r = C.construireLot([ap(1, { carteNom: 'Jirachi', blueprintSlug: SLUG_JIRACHI }), ap(2, { carteNom: 'Professor\'s Research (Professor Sada)', blueprintSlug: 'professor-s-research-professor-sada-wcd-2023-tord-reklev-189-198-world-championship-decks-2023' })]);
        assert.strictEqual(r.unites.length, 2); assert.ok(r.unites.every(u => u.nomFiche === 'concordant'));
    });
    await test('I1 — un DÉSACCORD entre la fiche et le blueprint exclut l\'unité (raison écrite, noms listés), même avec un total confirmé', () => {
        const r = C.construireLot([ap(1, { carteNom: 'Cinccino', blueprintSlug: SLUG_JIRACHI, temoin: 'confirme', temoins: ['confirme'] })]);
        assert.strictEqual(r.unites.length, 0);
        assert.strictEqual(r.exclus[0].raison, 'nom-fiche-different-du-blueprint');
        assert.deepStrictEqual([r.exclus[0].nomFiche, r.exclus[0].nomBlueprint], ['Cinccino', 'jirachi']);
    });
    await test('I1 — fiche sans nom : pas un désaccord ; une « clé seule » SANS aucun témoin (ni total, ni nom de fiche concordant) est exclue, avec le nom concordant elle reste, marquée', () => {
        const seule = { temoin: 'non-applicable', cle: 'nom-seul' };
        const r = C.construireLot([ap(1, { temoin: 'confirme' }), ap(2, seule), ap(3, { ...seule, carteNom: 'Jirachi', blueprintSlug: SLUG_JIRACHI }), ap(4, { temoin: 'absent', cle: 'nom+numero', carteNom: 'Jirachi', blueprintSlug: SLUG_JIRACHI })]);
        assert.deepStrictEqual(r.unites.map(u => u.produits[0]), [1, 3, 4]);
        assert.deepStrictEqual(r.exclus.map(e => [e.idProduct, e.raison]), [[2, 'cle-seule-sans-temoin']]);
        const u3 = r.unites.find(u => u.produits[0] === 3);
        assert.strictEqual(u3.nomFiche, 'concordant'); assert.strictEqual(u3.temoinNom, true); assert.ok(C.estCleSeule(u3));
        assert.strictEqual(r.unites.find(u => u.produits[0] === 1).temoinNom, false);
    });
    await test('I1 — le nom du blueprint vient du slug par la MÊME fonction que l\'appariement ; un slug illisible avec un nom de fiche exclut', () => {
        assert.strictEqual(C.nomDuBlueprint(101, SLUG_JIRACHI), 'jirachi');
        assert.strictEqual(C.nomDuBlueprint(101, 'n-importe-quoi'), null);
        const r = C.construireLot([ap(1, { carteNom: 'Jirachi', blueprintSlug: 'n-importe-quoi' })]);
        assert.strictEqual(r.exclus[0].raison, 'blueprint-illisible');
    });
    await test('I1 — les produits « cle seule » comptés par famille après I1', () => {
        const r = C.construireLot([ap(1, { temoin: 'confirme' }), ap(2, { groupe: 'PP S5', slugSet: 'Play-Pokemon-Prize-Pack-Series-Five', cle: 'nom-seul', temoin: 'non-applicable', carteNom: 'Jirachi', blueprintSlug: SLUG_JIRACHI })]);
        assert.deepStrictEqual(r.parFamille, { wcd: 1, pp: 1, ba: 0 }); assert.deepStrictEqual(r.cleSeuleParFamille, { wcd: 0, pp: 1, ba: 0 });
    });

    // ───────── la décision d'écriture (règle commune de remplacement) ─────────
    const cand = (o = {}) => ({ set: 'Play-Pokemon-Prize-Pack-Series-Five', numero: '072', langue: 'en', source: 'ctr', cleR2: 'ctr/x', wOriginal: 500, tampon: 'Play! Pokémon', ...o });
    await test('écriture : carte sans entrée du set -> ajouter', () => {
        assert.deepStrictEqual(C.decisionEcriture([], cand()), { action: 'ajouter', remplace: [] });
        assert.strictEqual(C.decisionEcriture([{ set: 'Autre', numero: '072', source: 'x', cleR2: 'a', w: 500 }], cand()).action, 'ajouter');
    });
    await test('écriture : une entrée correcte au-dessus du seuil n\'est JAMAIS remplacée (la nôtre cède)', () => {
        const d = C.decisionEcriture([{ set: 'Play-Pokemon-Prize-Pack-Series-Five', numero: '072', langue: 'en', source: 'tcgdex', cleR2: 'a', wOriginal: 600, w: 600 }], cand({ wOriginal: 700 }));
        assert.strictEqual(d.action, 'cede');
    });
    await test('écriture : une basse définition de même impression est remplacée', () => {
        const e = { set: 'Play-Pokemon-Prize-Pack-Series-Five', numero: '072', langue: 'en', source: 'pokumon', cleR2: 'a', w: 245, wOriginal: 245, basseDefinition: true, tampon: 'Play! Pokémon' };
        const documents = new Map([[`${e.source}|${e.set}|${e.cleR2}`, { source: e.source, set: e.set, cleR2: e.cleR2 }]]);
        // une basse définition SANS le même tampon est peut-être une autre impression : la règle commune ne la remplace pas
        const sansTampon = { ...e, tampon: undefined };
        assert.strictEqual(C.decisionEcriture([sansTampon], cand(), { documents }).action, 'cede');
        const d = C.decisionEcriture([e], cand(), { documents });
        assert.strictEqual(d.action, 'ajouter'); assert.deepStrictEqual(d.remplace, [e]);
        // sans le document de l'entrée la règle commune ne conclut pas : on ne remplace pas
        assert.strictEqual(C.decisionEcriture([e], cand()).action, 'cede');
    });
    await test('écriture : l\'image empruntée d\'un Prize Pack est remplacée par le vrai scan tamponné ; celle d\'un Battle Academy (aucun libellé de tampon) ne l\'est pas', () => {
        const emprunt = { set: 'Play-Pokemon-Prize-Pack-Series-Five', numero: '072', langue: 'en', source: 'emprunt', cleR2: 'e', w: 600, imageEmprunteeTirage: true, tamponNonRepresente: 'Play! Pokémon' };
        assert.deepStrictEqual(C.decisionEcriture([emprunt], cand()).remplace, [emprunt]);
        const ba = { set: 'Battle-Academy-2022', numero: null, langue: 'en', source: 'emprunt', cleR2: 'e', w: 600, imageEmprunteeTirage: true };
        assert.strictEqual(C.decisionEcriture([ba], cand({ set: 'Battle-Academy-2022', numero: null, tampon: undefined })).action, 'cede');
    });
    await test('écriture : le scan japonais du jumeau ne sert pas le set : on ajoute quand même', () => {
        const ja = { set: 'Play-Pokemon-Prize-Pack-Series-Five', numero: '072', langue: 'ja', source: 'artofpkm', cleR2: 'j', w: 868 };
        assert.strictEqual(C.decisionEcriture([ja], cand()).action, 'ajouter');
    });
    await test('écriture : l\'entrée de même source et même clé est déjà là (reprise) -> rien', () => {
        const e = { set: 'Play-Pokemon-Prize-Pack-Series-Five', numero: '072', langue: 'en', source: 'ctr', cleR2: 'ctr/x', w: 500 };
        assert.strictEqual(C.decisionEcriture([e], cand()).action, 'deja-posee');
    });

    await test('page réduite avant le cache : l\'adresse d\'image reste la même, la page de 900 Ko tient en quelques Ko', async () => {
        const url = 'https://www.cardtrader.com/en-US/cards/77-x-battle-academy-2022';
        const bruit = Array.from({ length: 4000 }, (_, i) => `<a href="/uploads/blueprints/image/${1000 + i}/show_autre-${i}.jpg">autre ${i}</a>`).join('\n');
        const pleine = `<html><head><meta property="og:image" content="https://www.cardtrader.com/uploads/blueprints/image/77/x.jpg" /><script>${'x'.repeat(50000)}</script></head><body>${bruit}<img src="/uploads/blueprints/image/77/show_x.jpg"><img src="/uploads/blueprints/back_image/77/show_x.jpg"></body></html>`;
        const r = C.reduirePage(pleine, url);
        assert.ok(r.length < 3000 && pleine.length > 200000, `${r.length}`);
        assert.deepStrictEqual(C.imageDePage(r, url), C.imageDePage(pleine, url));
        assert.ok(!/autre-/.test(r));
        const dossier = tmp();
        const cli = mk({ async get() { return { status: 200, type: 'text/html', texte: pleine }; } }, { dossierCache: dossier });
        const page = await cli.lire(url, { reduire: h => C.reduirePage(h, url) });
        assert.ok(page.texte.length < 3000);
        assert.ok(fs.readdirSync(dossier).every(f => fs.statSync(path.join(dossier, f)).size < 5000));
    });
    await test('lecture du cache sans réseau : octets et fiche, null si absent', async () => {
        const dossier = tmp();
        const cli = mk({ async get() { return { status: 200, type: 'image/jpeg', octets: jpeg }; } }, { dossierCache: dossier });
        assert.strictEqual(C.lireDuCache(dossier, URL_IMG), null);
        await cli.lireImage(URL_IMG);
        const c = C.lireDuCache(dossier, URL_IMG);
        assert.ok(Buffer.compare(c.octets, jpeg) === 0); assert.strictEqual(c.meta.statut, 'ok');
    });
    // ───────── l'échantillon de planche ─────────
    await test('planche : n unités, au moins 15 « clé seule », toutes les familles, déterministe', () => {
        const unites = [];
        for (let i = 0; i < 300; i++) unites.push({ carteId: i, slugSet: 's', numero: null, famille: ['wcd', 'pp', 'ba'][i % 3], temoins: [i % 5 === 0 ? 'non-applicable' : i % 7 === 0 ? 'absent' : 'confirme'], cles: ['nom+numero'] });
        const a = C.choisirEchantillon(unites, 50), b = C.choisirEchantillon(unites, 50);
        assert.strictEqual(a.length, 50); assert.deepStrictEqual(a.map(u => u.carteId), b.map(u => u.carteId));
        assert.ok(a.filter(C.estCleSeule).length >= 15, `${a.filter(C.estCleSeule).length}`);
        assert.deepStrictEqual([...new Set(a.map(u => u.famille))].sort(), ['ba', 'pp', 'wcd']);
        assert.strictEqual(new Set(a.map(u => u.carteId)).size, 50);
        assert.ok(a.filter(u => C.estCleSeule(u) && u.famille === 'wcd').length >= 1 && a.filter(u => C.estCleSeule(u) && u.famille === 'ba').length >= 1);
    });
    await test('planche : peu de clé seule disponibles -> toutes prises, jamais une unité deux fois ; n plus grand que la population -> tout', () => {
        const u = [{ carteId: 1, famille: 'wcd', temoins: ['absent'], cles: [] }, { carteId: 2, famille: 'pp', temoins: ['confirme'], cles: [] }, { carteId: 3, famille: 'ba', temoins: ['confirme'], cles: ['nom-seul'] }];
        assert.strictEqual(C.choisirEchantillon(u, 50).length, 3);
        assert.strictEqual(C.choisirEchantillon(u, 2).filter(C.estCleSeule).length, 2);
    });

    // ───────── les entrées écrites ─────────
    await test('entrée de carte et document : source/lot neutres, traçabilité commune, retirable, marque de basse définition d\'après l\'original', () => {
        const u = { carteId: 5, slugSet: 'WCD-2019', numero: '099', url: 'https://www.cardtrader.com/uploads/blueprints/image/316591/x.jpg', blueprint: 316591, produits: [1] };
        const le = new Date('2026-10-18T12:00:00Z');
        const meta = { wOriginal: 500, hOriginal: 698, cleR2: C.cleR2('WCD-2019', '099', 5), sha256: 'a'.repeat(64), w: 500, h: 698, fmt: 'webp' };
        const e = C.entreeDeCarte(u, meta, le);
        assert.strictEqual(e.source, 'ctr'); assert.strictEqual(e.lot, 'ctr-2026-10'); assert.strictEqual(e.retirable, true);
        assert.strictEqual(e.urlOriginal, u.url); assert.strictEqual(e.collecteLe.getTime(), le.getTime()); assert.strictEqual(e.langue, 'en');
        assert.strictEqual(e.basseDefinition, undefined);
        for (const k of ['cleR2', 'mention', 'attribution', 'languePreuve']) assert.ok(!/cardtrader/i.test(String(e[k])), k);
        const d = C.documentImage(u, meta, le);
        assert.strictEqual(d.etat, 'ok'); assert.strictEqual(d.source, 'ctr'); assert.strictEqual(d.retirable, true); assert.strictEqual(d.set, 'WCD-2019'); assert.strictEqual(d.carteId, 5);
        const petit = C.entreeDeCarte(u, { ...meta, wOriginal: 340, w: 340 }, le);
        assert.strictEqual(petit.basseDefinition, true);
        assert.throws(() => C.entreeDeCarte({ ...u, url: '' }, meta, le), /adresse/);
    });
    await test('tampon : seuls les Prize Packs portent le libellé « Play! Pokémon » (le candidat positif du remplacement)', () => {
        assert.strictEqual(C.tamponDeLaFamille('Play-Pokemon-Prize-Pack-Series-Five'), 'Play! Pokémon');
        assert.strictEqual(C.tamponDeLaFamille('WCD-2019'), undefined);
        assert.strictEqual(C.tamponDeLaFamille('Battle-Academy-2022'), undefined);
    });

    // ───────── le client : images ─────────
    await test('client image : octets rendus, cache disque, jamais redemandée', async () => {
        let n = 0;
        const cli = mk({ async get() { n++; return { status: 200, type: 'image/jpeg', octets: jpeg }; } });
        const a = await cli.lireImage(URL_IMG), b = await cli.lireImage(URL_IMG);
        assert.ok(Buffer.compare(a.octets, jpeg) === 0 && Buffer.compare(b.octets, jpeg) === 0); assert.strictEqual(n, 1); assert.strictEqual(b.cache, true);
    });
    await test('client image : une redirection n\'est JAMAIS suivie (arrêt, rien au cache)', async () => {
        let n = 0;
        const cli = mk({ async get() { n++; return { status: 302, location: 'https://autre.example/x.jpg', type: 'text/html' }; } });
        await assert.rejects(() => cli.lireImage(URL_IMG), /redirection|inattendue|PAUSE|pause/i);
        assert.strictEqual(n, 1);
    });
    await test('client image : 200 text/html sans défi = introuvable ; 403 = arrêt définitif de l\'hôte ; 200 JSON = pause', async () => {
        const c1 = mk({ async get() { return { status: 200, type: 'text/html', texte: '<html>not found</html>' }; } });
        assert.strictEqual((await c1.lireImage(URL_IMG)).absente, true);
        const c2 = mk({ async get() { return { status: 403, type: 'text/html', texte: 'x' }; } });
        await assert.rejects(() => c2.lireImage(URL_IMG), /BLOQU|ARRÊT/i);
        const c3 = mk({ async get() { return { status: 200, type: 'application/json', texte: '{}' }; } });
        await assert.rejects(() => c3.lireImage(URL_IMG), /pause|PAUSE|inattendue/i);
    });
    await test('client image : hors de /uploads/blueprints/ ou hôte étranger refusé sans requête ; plafond ; robots', async () => {
        let n = 0;
        const cli = mk({ async get() { n++; return { status: 200, type: 'image/jpeg', octets: jpeg }; } }, { plafond: 1, robots: 'User-agent: *\nDisallow: /uploads/\nAllow: /uploads/blueprints/\n' });
        await assert.rejects(() => cli.lireImage('https://www.cardtrader.com/uploads/autre/x.jpg'), /hors|robots/);
        await assert.rejects(() => cli.lireImage('https://evil.example/uploads/blueprints/image/77/x.jpg'), /hors/);
        const libre = mk({ async get() { n++; return { status: 200, type: 'image/jpeg', octets: jpeg }; } });      // sans règle robots : seul le CHEMIN de la garde du client protège
        for (const u of ['https://www.cardtrader.com/uploads/autre/x.jpg', 'https://www.cardtrader.com/uploads/blueprints/back_image/77/x.jpg', 'https://www.cardtrader.com/uploads/blueprints/image/77/x.php', 'https://www.cardtrader.com/robots.txt']) await assert.rejects(() => libre.lireImage(u), /hors/);
        assert.strictEqual(n, 0);
        await cli.lireImage(URL_IMG);
        await assert.rejects(() => cli.lireImage('https://www.cardtrader.com/uploads/blueprints/image/78/y.jpg'), /plafond/);
    });
    await test('transport réel : redirect manual (jamais de redirection suivie), l\'agent du dépôt, aucun cookie', () => {
        const src = fs.readFileSync(path.join(__dirname, 'collecte-cartes', path.basename(process.env.CTR_MODULE || 'cardtrader.js').replace(/(\.js)?$/, '.js')), 'utf8');
        assert.ok(/redirect:\s*'manual'/.test(src) && !/redirect:\s*'follow'/.test(src));
        assert.ok(!/credentials|cookie/i.test(src.replace(/aucun cookie|jamais de cookie/gi, '')));
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exitCode = ko ? 1 : 0;
})();
