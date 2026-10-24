// Banc de collecte-cartes/packmagik.js (source « pmk ») — lecture d'une page de set, preuve et plan. Page RÉELLE (Happy Set Pikachu & Clefairy & Turtwig & Gimmighoul, 48 tuiles, relevée le 2026-10-24, prix retirés) ;
// aucune requête, aucune base.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require(process.env.PMK_MODULE || './collecte-cartes/packmagik');
const RC = require('./collecte-cartes/recolte-commun');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const { largeurMinDe, largeurAdmiseDe } = require('./collecte-cartes/seuils-images');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'pmk-pages.json'), 'utf8'));

let ok = 0, ko = 0;
const test = (nom, f) => { try { f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${e.message}`); } };

const h1 = P.lirePage(F.csvh1c), L1 = P.ligneDe('CSVH1C');
const prod = (carteId, idProduct, numeroFiche, carteNom, slug) => ({ carteId, idProduct, numeroFiche, carteNom, slug, carte: { _id: carteId, nomEn: carteNom } });
const plan = produits => P.planifier({ ligne: L1, page: h1, produits });

test('lecture : 48 tuiles, champs lus, l\'original est le fichier déclaré par la page (pas la miniature)', () => {
    assert.strictEqual(h1.tuiles.length, 48);
    const t = h1.tuiles[0];
    assert.deepStrictEqual([t.id, t.n, t.nom, t.numeroTexte], ['csvh1c-001', '1', 'Shroomish', '001']);
    assert.strictEqual(t.url, 'https://cxjurdeoweovcukmmplp.supabase.co/storage/v1/object/public/card-images/pokemon/csvh1c/001.png');
    assert.ok(h1.tuiles.every(x => !x.illisible));
    assert.deepStrictEqual(h1.tuiles.map(x => x.n), Array.from({ length: 48 }, (_, i) => String(i + 1)));
    assert.match(h1.h1, /^Happy Set – Pikachu & Clefairy & Turtwig & Gimmighoul$/);
});
test('aucun prix dans la page lue ni dans la page réduite', () => {
    const r = P.reduirePage(F.csvh1c);
    assert.ok(!/\$\s?[1-9]|price|prix/i.test(r.replace(/<title>[^<]*<\/title>/, '')), 'la page réduite porte un prix');
    assert.ok(!JSON.stringify(h1).match(/\$\s?\d/));
});
test('réduction : la page réduite donne EXACTEMENT les mêmes tuiles, en bien moins de caractères', () => {
    const r = P.reduirePage(F.csvh1c), a = P.lirePage(r), b = P.lirePage(F.csvh1c);
    assert.deepStrictEqual(a.tuiles, b.tuiles); assert.strictEqual(a.h1, b.h1);
    assert.ok(r.length < F.csvh1c.length * 0.2, `${r.length} contre ${F.csvh1c.length}`);
});
test('lecture : une tuile illisible est RENDUE avec son motif, jamais écartée en silence', () => {
    const numero = P.lirePage(F.csvh1c.replace('· 001', '· 002'));
    assert.match(numero.tuiles.find(t => t.n === '1').illisible, /contredisent/);
    const nom = P.lirePage(F.csvh1c.replace('alt="Shroomish"', 'alt="Autre"'));
    assert.match(nom.tuiles.find(t => t.n === '1').illisible, /contredisent/);
    const SRC1 = 'src="https://cxjurdeoweovcukmmplp.supabase.co/storage/v1/object/public/thumbs/w768/card-images/pokemon/csvh1c/001.png.webp"';
    assert.ok(F.csvh1c.includes(SRC1));
    const image = P.lirePage(F.csvh1c.replace(SRC1, SRC1.replace('csvh1c/001', 'csvh1c/009')));
    assert.match(image.tuiles.find(t => t.n === '1').illisible, /image/);
    const horsHote = P.lirePage(F.csvh1c.replace(SRC1, 'src="https://autre.example/x/001.png.webp"'));
    assert.ok(horsHote.tuiles.find(t => t.n === '1').illisible);
});
test('lecture : une carte d\'un AUTRE set (autre code dans l\'adresse) n\'est pas une tuile de ce set', () => {
    const autre = P.lirePage(F.csvh1c.replace(/pkmn-csvh1c-cn-001"/, 'pkmn-csvh2c-cn-001"'));
    assert.strictEqual(autre.tuiles.length, 47); assert.strictEqual(autre.horsSet, 1);
});
test('garde de lecture : titre du set, numéros contigus à partir de 1 ; une page vide, un autre set, un trou dans les numéros, trop d\'illisibles sont refusés', () => {
    assert.strictEqual(P.verdictDePage(h1, L1).ok, true);
    assert.match(P.verdictDePage(h1, P.ligneDe('CSVH2C')).motif, /titre/);
    assert.match(P.verdictDePage(P.lirePage('<html>Just a moment</html>'), L1).motif, /aucune tuile/);
    const trou = { ...h1, tuiles: h1.tuiles.filter(t => t.n !== '20') };
    assert.match(P.verdictDePage(trou, L1).motif, /contigu/);
    const illisibles = { ...h1, tuiles: h1.tuiles.map(t => ({ ...t, illisible: 'x' })) };
    assert.match(P.verdictDePage(illisibles, L1).motif, /illisible/);
    assert.match(P.verdictDePage(h1, null).motif, /absente/);
});
test('plan : set + numéro + nom -> une unité avec l\'original, la preuve et le groupe', () => {
    const r = plan([prod(280576, 860907, '1', 'Shroomish', 'Shroomish-CSVH1C001'), prod(280577, 860908, '2', 'Breloom', 'Breloom-CSVH1C002')]);
    assert.strictEqual(r.unites.length, 2); assert.deepStrictEqual(r.restes, []);
    const u = r.unites[0];
    assert.deepStrictEqual([u.carteId, u.slugSet, u.numero, u.produits, u.groupe, u.nomSource, u.numeroSource, u.idSource], [280576, 'Happy-Set-Pikachu-Clefairy-Turtwig-Gimmighoul', '1', [860907], 'CSVH1C', 'Shroomish', '001', 'csvh1c-001']);
    assert.strictEqual(u.url, h1.tuiles[0].url);
    assert.match(u.preuve, /n° 001 = fiche 1/);
});
test('plan : un nom différent est un TROU ; un nom qui désigne une autre carte du set est nommé ; le slug du produit qui contredit la tuile aussi', () => {
    const r = plan([prod(1, 901, '1', 'Breloom', 'Breloom-CSVH1C001')]);
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.restes[0].motif, 'nom-different');
    const temoin = (carte, p) => (p.nom === 'Shroomish' ? [{ _id: 9, nomEn: 'Shroomish' }] : null);
    assert.strictEqual(P.planifier({ ligne: L1, page: h1, produits: [prod(1, 901, '1', 'Breloom', 'Breloom-CSVH1C001')], temoin }).restes[0].motif, 'nom-designe-une-autre-carte');
    assert.strictEqual(plan([prod(1, 901, '1', 'Shroomish', 'Breloom-CSVH1C001')]).restes[0].motif, 'nom-produit-different');
    assert.strictEqual(plan([prod(1, 901, '1', 'Shroomish', null)]).unites.length, 1);
});
test('plan : numéro hors de la page (liste tronquée à 48), sans numéro, sans nom, variantes, produit vers plusieurs cartes, tuile revendiquée deux fois : chacun son motif', () => {
    const r = plan([prod(1, 901, '60', 'Whatever', 'Whatever-CSVH1C060'), prod(2, 902, null, 'Breloom', 'Breloom-CSVH1C002'), prod(3, 903, '3', null, 'x'),
        prod(4, 904, '4', 'Grotle', 'Grotle-CSVH1C004'), prod(4, 914, '4', 'Grotle', 'Grotle-V2-CSVH1C004'),
        prod(5, 905, '5', 'Torterra', 'Torterra-CSVH1C005'), prod(5, 905, '6', 'Zarude', 'Torterra-CSVH1C005'),
        prod(7, 907, '7', 'Empoleon', 'Empoleon-CSVH1C007'), prod(8, 908, '7', 'Empoleon', 'Empoleon-CSVH1C007b')]);
    assert.strictEqual(r.unites.length, 0);
    assert.deepStrictEqual(r.parMotif, { 'absente-de-la-source': 1, 'sans-numero': 1, 'sans-nom': 1, variantes: 2, 'produit-vers-plusieurs-cartes': 2, 'tuile-revendiquee-deux-fois': 2 });
});
test('plan : le numéro compare par la clé de la jointure (« 007 » = « 7 »)', () => {
    assert.strictEqual(plan([prod(7, 907, '007', 'Empoleon', 'Empoleon-CSVH1C007')]).unites.length, 1);
});
test('plan : une adresse hors de la forme fermée est un trou', () => {
    const mauvaise = { ...h1, tuiles: h1.tuiles.map(t => ({ ...t, url: t.url.replace('supabase.co', 'autre.example') })) };
    assert.strictEqual(P.planifier({ ligne: L1, page: mauvaise, produits: [prod(1, 901, '1', 'Shroomish', 'Shroomish-CSVH1C001')] }).parMotif['adresse-hors-forme'], 1);
});
test('plan : une page non lue laisse les produits sans image, avec ce motif ; exclusions : liste fermée', () => {
    assert.strictEqual(P.planifier({ ligne: L1, page: null, produits: [prod(1, 901, '1', 'Shroomish', 'Shroomish-CSVH1C001')] }).parMotif['page-absente'], 1);
    assert.ok(Object.isFrozen(P.EXCLUSIONS));
    const excl = [{ carteId: 1, idSource: 'csvh1c-001', code: 'CSVH1C', nom: 'x', le: '2026-10-24', motif: 'image déformée' }];
    assert.strictEqual(P.planifier({ ligne: L1, page: h1, produits: [prod(1, 901, '1', 'Shroomish', 'Shroomish-CSVH1C001')], exclusions: excl }).parMotif['exclusion-motivee'], 1);
});
test('plan : le dénominateur — tuiles lues, numéros, tuiles d\'autres sets — est imprimé avec le plan', () => {
    const r = plan([]);
    assert.deepStrictEqual([r.base.tuiles, r.base.numeros, r.base.illisibles], [48, 48, 0]);
});
test('hôtes : la liste est FERMÉE — la page de chaque set et la forme de l\'original, rien d\'autre (ni l\'API, ni le magasin, ni les combats, ni une page de carte)', () => {
    const h = P.hotes();
    assert.deepStrictEqual(Object.keys(h).sort(), ['cxjurdeoweovcukmmplp.supabase.co', 'www.packmagik.com']);
    for (const l of P.TABLE) assert.ok(h['www.packmagik.com'].chemin.test(`/sets/${l.page}`), l.page);
    assert.ok(h['www.packmagik.com'].chemin.test('/robots.txt'));
    for (const mauvais of ['/', '/api/cards', '/shop/', '/r/abc', '/pack-battles/', '/cards/pkmn-csvh1c-cn-049', '/sets/pkmn-csvh1c-cn/../../api/x', '/sets/pkmn-zzz-cn', '/sets/pkmn-csvh1c-cn?page=2', '/discover', '/sitemap.xml']) assert.ok(!h['www.packmagik.com'].chemin.test(mauvais), mauvais);
    const img = h['cxjurdeoweovcukmmplp.supabase.co'].chemin;
    assert.ok(img.test('/storage/v1/object/public/card-images/pokemon/csvh1c/001.png')); assert.ok(img.test('/robots.txt'));
    for (const mauvais of ['/', '/storage/v1/object/public/thumbs/w768/card-images/pokemon/csvh1c/001.png.webp', '/storage/v1/object/public/card-images/pokemon/zzz/001.png', '/storage/v1/object/public/card-images/pokemon/csvh1c/001.png?x=1', '/storage/v1/object/public/card-images/pokemon/csvh1c/../x.png', '/storage/v1/object/list/card-images', '/storage/v1/object/sign/card-images/pokemon/csvh1c/001.png']) assert.ok(!img.test(mauvais), mauvais);
    assert.throws(() => P.urlPage('ZZZ'), /hors de la table/);
    assert.strictEqual(P.urlPage('CSVH1C'), 'https://www.packmagik.com/sets/pkmn-csvh1c-cn');
});
test('urlImageValide : https, l\'hôte des images, la forme fermée, sans requête ni port', () => {
    assert.ok(P.urlImageValide('https://cxjurdeoweovcukmmplp.supabase.co/storage/v1/object/public/card-images/pokemon/csvh1c/001.png'));
    for (const m of ['http://cxjurdeoweovcukmmplp.supabase.co/storage/v1/object/public/card-images/pokemon/csvh1c/001.png', 'https://autre.supabase.co/storage/v1/object/public/card-images/pokemon/csvh1c/001.png', 'https://cxjurdeoweovcukmmplp.supabase.co/storage/v1/object/public/card-images/pokemon/csvh1c/001.png?a=1', 'https://cxjurdeoweovcukmmplp.supabase.co:8443/storage/v1/object/public/card-images/pokemon/csvh1c/001.png', 'https://cxjurdeoweovcukmmplp.supabase.co/storage/v1/object/public/thumbs/w768/card-images/pokemon/csvh1c/001.png.webp', 'nimporte quoi']) assert.ok(!P.urlImageValide(m), m);
});
test('la table : un set de notre base par ligne, codes et pages distincts, gelée', () => {
    assert.strictEqual(new Set(P.TABLE.map(l => l.code)).size, P.TABLE.length); assert.strictEqual(new Set(P.TABLE.map(l => l.slug)).size, P.TABLE.length); assert.strictEqual(new Set(P.TABLE.map(l => l.page)).size, P.TABLE.length);
    assert.ok(Object.isFrozen(P.TABLE) && P.TABLE.every(l => Object.isFrozen(l)));
    assert.strictEqual(P.ligneDuSet('Happy-Set-Pikachu-Clefairy-Turtwig-Gimmighoul').code, 'CSVH1C');
});
test('traçabilité neutre : source, lot, clé R2, id, mention et preuve de langue ne nomment JAMAIS la source ; l\'entrée porte l\'adresse d\'origine, la date et retirable', () => {
    assert.deepStrictEqual([P.SOURCE, P.LOT], ['pmk', 'pmk-2026-10']);
    assert.strictEqual(P.SRC.cleR2('Happy-Set-Pikachu-Clefairy-Turtwig-Gimmighoul', '1', 280576), 'pmk/Happy-Set-Pikachu-Clefairy-Turtwig-Gimmighoul/1-280576-zh-hans.webp');
    const u = { carteId: 280576, slugSet: 'Happy-Set-Pikachu-Clefairy-Turtwig-Gimmighoul', numero: '1', produits: [860907], url: h1.tuiles[0].url, idSource: 'csvh1c-001', preuveNeutre: 'set CSVH1C, n° 001' };
    const meta = { cleR2: P.SRC.cleR2(u.slugSet, u.numero, u.carteId), sha256: 'a'.repeat(64), w: 300, h: 419, fmt: 'webp', wOriginal: 300, hOriginal: 419 };
    const e = RC.entreeDeCarte(P.SRC, u, meta, new Date('2026-10-24T12:00:00Z')), d = RC.documentImage(P.SRC, u, meta, new Date('2026-10-24T12:00:00Z'));
    for (const o of [e, d]) {
        assert.strictEqual(o.retirable, true); assert.strictEqual(o.urlOriginal, u.url); assert.strictEqual(o.source, 'pmk'); assert.strictEqual(o.lot, 'pmk-2026-10'); assert.strictEqual(o.langue, 'zh-hans');
        assert.strictEqual(o.basseDefinition, true, '300 px : la marque de basse définition est posée par la règle commune');
        assert.ok(!/pack|magik|supabase/i.test(JSON.stringify({ ...o, urlOriginal: null })), 'un champ nomme la source');
    }
});
test('langue : la règle commune (langue-visuel.js) connaît la source ; sa preuve est publique et ne nomme pas la source', () => {
    const v = langueDuVisuel({ source: 'pmk', langueSource: 'zh-hans', urlOriginal: h1.tuiles[0].url });
    assert.strictEqual(v.langue, 'zh-hans'); assert.ok(!/pack|magik/i.test(v.preuve)); assert.strictEqual(v.preuve, P.LANGUE_PREUVE);
    assert.strictEqual(langueDuVisuel({ source: 'pmk', langueSource: 'en' }).langue, null);
    assert.strictEqual(langueDuVisuel({ source: 'pmk' }).langue, null);
});
test('LE SEUIL : 300 px est SOUS le seuil de la source (350) et la source n\'est pas dans la liste fermée du plancher de 200 px — décision du testeur non anticipée', () => {
    assert.strictEqual(largeurMinDe(P.SOURCE), 350); assert.strictEqual(largeurAdmiseDe(P.SOURCE), 350);
    assert.strictEqual(RC.controleLargeur(P.SRC, 300).statut, 'trop-petit');
    assert.strictEqual(RC.controleLargeur(P.SRC, 350).statut, 'ok');
});

console.log(`${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
