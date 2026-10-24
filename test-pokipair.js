// Banc de collecte-cartes/pokipair.js (source « ppr ») — lecture des pages de listes, preuve et plan. Pages RÉELLES (quelques tuiles de chaque forme, lues le 2026-10-24) ; aucune requête, aucune base.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const P = require(process.env.PPR_MODULE || './collecte-cartes/pokipair');
const RC = require('./collecte-cartes/recolte-commun');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'ppr-listes.json'), 'utf8'));

let ok = 0, ko = 0;
const test = (nom, f) => { try { f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${e.message}`); } };

const csv9 = P.lirePage(F.csv9), csv10 = P.lirePage(F.csv10), t30 = P.lirePage(F.t30), gem = P.lirePage(F.gem);
const L9 = P.ligneDe('CSV9C'), L10 = P.ligneDe('CSV10C'), L30 = P.ligneDe('30thC'), LG = P.ligneDe('CBB6C');
const prod = (carteId, idProduct, numeroFiche, carteNom, slug) => ({ carteId, idProduct, numeroFiche, carteNom, slug, carte: { _id: carteId, nomEn: carteNom } });
const plan9 = produits => P.planifier({ ligne: L9, tuiles: csv9.tuiles, produits });

test('lecture : 14 tuiles CSV9, champs lus, finitions cachées, entités décodées (CSV10 « Ethan\'s Pinsir »)', () => {
    assert.strictEqual(csv9.tuiles.length, 14);
    const t = csv9.tuiles[0];
    assert.deepStrictEqual([t.id, t.numero, t.n, t.total, t.variante, t.cachee, t.nom, t.rarete], ['25504', '001/208', '1', 208, 'normal', false, 'Exeggcute', 'Common']);
    assert.strictEqual(t.url, 'https://media.pokipair.com/2026/08/10103101/Stellar-Crystal-CSV9-Simplified-Chinese-Pokemon-Set-List-PokiPair-Store-Ireland-001.png');
    assert.strictEqual(t.miniature, P.miniatureDe(t.url));
    assert.deepStrictEqual(csv9.tuiles.slice(0, 3).map(x => x.cachee), [false, true, true]);
    assert.strictEqual(csv10.tuiles[0].nom, 'Ethan\'s Pinsir');
    assert.ok(csv9.tuiles.every(x => !x.illisible));
});
test('lecture : le titre, le h1, le nombre annoncé et le total dominant', () => {
    assert.match(csv9.titre, /CSV9/); assert.match(csv9.h1, /Stellar Crystal CSV9/); assert.strictEqual(csv9.annonce, 619); assert.strictEqual(csv9.totalDominant, 208);
    assert.strictEqual(csv10.totalDominant, 222); assert.strictEqual(t30.totalDominant, 103);
});
test('lecture : numéro de groupe d\'un Gem Pack « 01 01/07 »', () => {
    const t = gem.tuiles[0];
    assert.deepStrictEqual([t.groupe, t.rang, t.total, t.n], ['01', '01', 7, null]);
});
test('réduction : la page réduite donne EXACTEMENT les mêmes tuiles, en bien moins de caractères', () => {
    for (const h of [F.csv9, F.csv10, F.t30, F.gem]) {
        const r = P.reduirePage(h);
        assert.deepStrictEqual(P.lirePage(r).tuiles, P.lirePage(h).tuiles);
        assert.ok(r.length < h.length * 0.8, `${r.length} contre ${h.length}`);
        assert.strictEqual(P.lirePage(r).annonce, P.lirePage(h).annonce);
        assert.strictEqual(P.lirePage(r).h1, P.lirePage(h).h1);
    }
});
test('lecture : une tuile illisible est RENDUE avec son motif, jamais écartée en silence', () => {
    const casse = F.csv9.replace('data-number="001/208"', 'data-number="zzz"');
    const p = P.lirePage(casse);
    assert.strictEqual(p.tuiles.length, 14);
    assert.ok(p.tuiles.filter(t => t.illisible).length >= 1);
    const sansUrl = P.lirePage(F.csv9.replace(/data-full="[^"]*"/, ''));
    assert.match(sansUrl.tuiles.find(t => t.illisible).illisible, /adresse de l'original/);
    const contredit = P.lirePage(F.csv9.replace('data-caption="001/208 · Exeggcute · Common"', 'data-caption="002/208 · Exeggcute · Common"'));
    assert.match(contredit.tuiles.find(t => t.illisible).illisible, /contredisent/);
});
test('garde de lecture : titre et total attendus ; une page vide, un autre set, un autre total sont refusés', () => {
    assert.strictEqual(P.verdictDePage(csv9, L9).ok, true);
    assert.strictEqual(P.verdictDePage(csv10, L10).ok, true);
    assert.strictEqual(P.verdictDePage(t30, L30).ok, true);
    assert.strictEqual(P.verdictDePage(gem, LG).ok, true);
    assert.match(P.verdictDePage(csv10, L9).motif, /titre/);
    assert.match(P.verdictDePage(csv9, { ...L9, total: 222 }).motif, /total dominant/);
    assert.match(P.verdictDePage(P.lirePage('<html>Just a moment</html>'), L9).motif, /aucune tuile/);
    const trop = { ...csv9, tuiles: csv9.tuiles.map(t => ({ ...t, illisible: 'x' })) };
    assert.match(P.verdictDePage(trop, L9).motif, /illisible/);
});
test('plan : set + numéro + nom + tuile visible unique -> une unité avec l\'original, la preuve et le groupe', () => {
    const r = plan9([prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001'), prod(2, 902, '002', 'Lileep', 'Lileep-CSV9C002')]);
    assert.strictEqual(r.unites.length, 2); assert.deepStrictEqual(r.restes, []);
    const u = r.unites[0];
    assert.deepStrictEqual([u.carteId, u.slugSet, u.numero, u.produits, u.groupe, u.variante, u.nomSource, u.numeroSource, u.idSource], [1, 'Stellar-Crystal', '001', [901], 'CSV9C', 'normal', 'Exeggcute', '001/208', '25504']);
    assert.strictEqual(u.url, csv9.tuiles[0].url);
    assert.match(u.preuve, /n° 001\/208 = fiche 001/); assert.match(u.preuve, /tuile visible unique/);
});
test('plan : une carte holo ou plein cadre n\'a qu\'une tuile — elle est la carte ; les finitions cachées ne comptent pas', () => {
    const r = plan9([prod(3, 903, '6', 'Durant ex', 'Durant-ex-CSV9C006'), prod(4, 904, '017', 'Rabsca', 'Rabsca-CSV9C017'), prod(5, 905, '209', 'Turtonator', 'Turtonator-CSV9C209')]);
    assert.deepStrictEqual(r.unites.map(u => u.variante).sort(), ['full-art', 'holo', 'holo']);
    assert.deepStrictEqual(r.restes, []);
});
test('plan : le numéro compare par la clé de la jointure (« 6 » = « 006 » = « 6/208 »)', () => {
    const r = plan9([prod(3, 903, '006', 'Durant ex', 'Durant-ex-CSV9C006')]);
    assert.strictEqual(r.unites.length, 1);
});
test('plan : un nom différent est un TROU (jamais l\'image du numéro seul) ; un nom qui désigne une autre carte du set est nommé', () => {
    const r = plan9([prod(1, 901, '001', 'Exeggutor', 'Exeggutor-CSV9C001')]);
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.restes[0].motif, 'nom-different');
    const temoin = (carte, p) => (p.nom === 'Exeggcute' ? [{ _id: 9, nomEn: 'Exeggcute' }] : null);
    const r2 = P.planifier({ ligne: L9, tuiles: csv9.tuiles, produits: [prod(1, 901, '001', 'Exeggutor', 'Exeggutor-CSV9C001')], temoin });
    assert.strictEqual(r2.restes[0].motif, 'nom-designe-une-autre-carte');
});
test('plan : le nom du produit (slug) qui contredit la tuile est un trou ; un slug illisible ne bloque pas (la fiche et le numéro concordent)', () => {
    const r = plan9([prod(1, 901, '001', 'Exeggcute', 'Exeggutor-CSV9C001')]);
    assert.strictEqual(r.restes[0].motif, 'nom-produit-different');
    const r2 = plan9([prod(1, 901, '001', 'Exeggcute', null)]);
    assert.strictEqual(r2.unites.length, 1); assert.strictEqual(r2.unites[0].nomProduit, null);
});
test('plan : deux produits au même numéro de la même carte = variantes, AUCUN n\'a d\'image ; sans numéro, sans nom, absente de la source : chacun son motif', () => {
    const r = plan9([prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001'), prod(1, 911, '1', 'Exeggcute', 'Exeggcute-V2-CSV9C001'),
        prod(2, 902, null, 'Lileep', 'Lileep-CSV9C002'), prod(6, 906, '002', null, 'x'), prod(7, 907, '77', 'Absent', 'Absent-CSV9C077')]);
    assert.strictEqual(r.unites.length, 0);
    assert.deepStrictEqual(r.parMotif, { variantes: 2, 'sans-numero': 1, 'sans-nom': 1, 'absente-de-la-source': 1 });
});
test('plan : un produit joint à PLUSIEURS cartes n\'en désigne aucune', () => {
    const r = plan9([prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001'), prod(2, 901, '002', 'Lileep', 'Exeggcute-CSV9C001')]);
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['produit-vers-plusieurs-cartes'], 2);
});
test('plan : deux tuiles VISIBLES au même numéro (30thC 132/103 : Jirachi ex, Mewtwo ex) = ambigu, aucune unité', () => {
    const r = P.planifier({ ligne: L30, tuiles: t30.tuiles, produits: [prod(10, 910, '132', 'Mewtwo ex', 'Mewtwo-ex-30thC132'), prod(11, 911, '1', 'Exeggcute', 'Exeggcute-30thC001')] });
    assert.strictEqual(r.parMotif['tuile-ambigue'], 1); assert.strictEqual(r.unites.length, 1); assert.strictEqual(r.unites[0].numeroSource, '001/103');
});
test('plan : deux produits (deux cartes) qui revendiquent la même tuile : aucun des deux', () => {
    const r = plan9([prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001'), prod(2, 902, '1', 'Exeggcute', 'Exeggcute-CSV9C001')]);
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['tuile-revendiquee-deux-fois'], 2);
});
test('plan : un Gem Pack (groupe + finition) n\'a AUCUNE unité — la finition du produit ne se lit pas', () => {
    const r = P.planifier({ ligne: LG, tuiles: gem.tuiles, produits: [prod(20, 920, '01', 'Alolan Dugtrio', 'Alolan-Dugtrio-V2-SV-PCS01'), prod(20, 921, '01', 'Alolan Dugtrio', 'Alolan-Dugtrio-V3-SV-PCS01')] });
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['format-groupe-variante-non-lue'], 2);
    assert.match(r.restes[0].detail, /2 produits au même groupe/);
});
test('plan : une adresse hors de la forme fermée, ou une miniature incohérente, est un trou', () => {
    const mauvaise = csv9.tuiles.map(t => ({ ...t, url: t.url.replace('media.pokipair.com', 'autre.example') }));
    assert.strictEqual(P.planifier({ ligne: L9, tuiles: mauvaise, produits: [prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001')] }).parMotif['adresse-hors-forme'], 1);
    const incoh = csv9.tuiles.map(t => ({ ...t, miniature: t.miniature.replace('001-218x300', '002-218x300') }));
    assert.strictEqual(P.planifier({ ligne: L9, tuiles: incoh, produits: [prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001')] }).parMotif['image-incoherente'], 1);
});
test('plan : une tuile visible dont la finition n\'est pas la carte (reverse, glitter…) n\'est jamais prise pour elle', () => {
    const seule = csv9.tuiles.filter(t => t.numero === '001/208').map(t => (t.variante === 'normal' ? { ...t, cachee: true } : { ...t, cachee: t.variante === 'masterball-reverse' }));
    const r = P.planifier({ ligne: L9, tuiles: seule, produits: [prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001')] });
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['variante-non-admise'], 1);
    const aucune = P.planifier({ ligne: L9, tuiles: csv9.tuiles.map(t => ({ ...t, cachee: true })), produits: [prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001')] });
    assert.strictEqual(aucune.parMotif['aucune-tuile-visible'], 1);
});
test('plan : une tuile illisible (légende contredite) n\'est jamais la carte, même si son numéro se lit', () => {
    const tuiles = csv9.tuiles.map(t => (t.numero === '001/208' && !t.cachee ? { ...t, illisible: 'légende et alt contredisent le numéro' } : t));
    const r = P.planifier({ ligne: L9, tuiles, produits: [prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001')] });
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['aucune-tuile-visible'], 1); assert.strictEqual(r.base.illisibles, 1);
});
test('D7 : la liste fermée des exclusions motivées est bien formée (carte, tuile, code, nom, motif, date) et porte le Greninja BREAK n° 157', () => {
    assert.ok(P.EXCLUSIONS.length >= 1 && Object.isFrozen(P.EXCLUSIONS));
    for (const x of P.EXCLUSIONS) {
        assert.ok(Number.isInteger(x.carteId) && typeof x.idSource === 'string' && x.idSource && P.ligneDe(x.code), JSON.stringify(x));
        assert.ok(x.motif.length > 30 && x.nom && /^\d{4}-\d{2}-\d{2}$/.test(x.le), JSON.stringify(x));
    }
    assert.ok(P.EXCLUSIONS.some(x => x.carteId === 208222 && x.idSource === '30881' && x.code === '30thC'));
});
test('D7 : une unité exclue ne sort PLUS du plan (la carte ET la tuile doivent concorder) ; le motif est écrit', () => {
    const excl = [{ carteId: 1, idSource: '25504', code: 'CSV9C', nom: 'x', le: '2026-10-24', motif: 'image déformée' }];
    const pr = [prod(1, 901, '001', 'Exeggcute', 'Exeggcute-CSV9C001')];
    const r = P.planifier({ ligne: L9, tuiles: csv9.tuiles, produits: pr, exclusions: excl });
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['exclusion-motivee'], 1); assert.match(r.restes[0].detail, /image déformée/);
    assert.strictEqual(P.planifier({ ligne: L9, tuiles: csv9.tuiles, produits: pr, exclusions: [{ ...excl[0], idSource: '1' }] }).unites.length, 1, 'une autre tuile de la même carte n\'est pas exclue');
    assert.strictEqual(P.planifier({ ligne: L9, tuiles: csv9.tuiles, produits: [prod(2, 902, '001', 'Exeggcute', 'Exeggcute-CSV9C001')], exclusions: excl }).unites.length, 1, 'une autre carte sur la même tuile n\'est pas exclue');
    assert.strictEqual(P.planifier({ ligne: L9, tuiles: csv9.tuiles, produits: pr, exclusions: [] }).unites.length, 1);
    // la liste RÉELLE (par défaut) : le Greninja BREAK 157 de 30thC (tuile 30881) sort du plan, sa voisine non
    const tuiles = t30.tuiles.map(t => (t.numero === '001/103' ? { ...t, id: '30881' } : t));
    const reel = P.planifier({ ligne: L30, tuiles, produits: [prod(208222, 908335, '1', 'Exeggcute', 'Exeggcute-30thC001'), prod(5, 908336, '2', 'Alolan Exeggutor', 'Alolan-Exeggutor-30thC002')] });
    assert.ok(!reel.unites.some(u => u.carteId === 208222)); assert.strictEqual(reel.parMotif['exclusion-motivee'], 1);
});
test('plan : le dénominateur — tuiles, numéros, ambiguïtés de tuiles — est imprimé avec le plan', () => {
    const r = plan9([]);
    assert.deepStrictEqual([r.base.tuiles, r.base.numeros, r.base.illisibles], [14, 7, 0]);
});
test('nom du produit : « Salandit-CSV9C024 », variantes V2 retirées, slug sans le code du set = illisible', () => {
    assert.strictEqual(P.nomDuProduit('Salandit-CSV9C024', 'CSV9C'), 'Salandit');
    assert.strictEqual(P.nomDuProduit('Pikachu-V2-CSV10C089', 'CSV10C'), 'Pikachu');
    assert.strictEqual(P.nomDuProduit('Charizard-30thC137', '30thC'), 'Charizard');
    assert.strictEqual(P.nomDuProduit('Salandit-PAL024', 'CSV9C'), null);
    assert.strictEqual(P.nomDuProduit(null, 'CSV9C'), null);
    assert.strictEqual(P.nomDuProduit('CSV9C024', 'CSV9C'), null);
});
test('hôtes : la liste est FERMÉE — les pages de la table et la forme des images, rien d\'autre', () => {
    const h = P.hotes();
    assert.deepStrictEqual(Object.keys(h).sort(), ['media.pokipair.com', 'www.pokipair.com']);
    for (const l of P.TABLE) assert.ok(h['www.pokipair.com'].chemin.test(`/${l.page}/`), l.page);
    assert.ok(h['www.pokipair.com'].chemin.test('/robots.txt'));
    for (const mauvais of ['/', '/my-account/', '/cart/', '/wp-admin/', '/checkout/', '/stellar-crystal-csv9-card-list/../wp-admin/', '/sitemap_index.xml', '/news/']) assert.ok(!h['www.pokipair.com'].chemin.test(mauvais), mauvais);
    assert.ok(h['media.pokipair.com'].chemin.test('/2026/08/10103101/Stellar-Crystal-CSV9-001.png'));
    assert.ok(h['media.pokipair.com'].chemin.test('/robots.txt'));
    for (const mauvais of ['/', '/wp-content/x.png', '/2026/08/10103101/x.php', '/2026/08/10103101/../x.png', '/2026/08/x.png']) assert.ok(!h['media.pokipair.com'].chemin.test(mauvais), mauvais);
    assert.throws(() => P.urlPage('news'), /hors de la table/);
});
test('urlImageValide : https, l\'hôte des images, la forme fermée, sans requête ni port', () => {
    assert.ok(P.urlImageValide('https://media.pokipair.com/2026/08/10103101/x-001.png'));
    for (const m of ['http://media.pokipair.com/2026/08/10103101/x.png', 'https://www.pokipair.com/2026/08/10103101/x.png', 'https://media.pokipair.com/2026/08/10103101/x.png?a=1', 'https://media.pokipair.com:8443/2026/08/10103101/x.png', 'https://media.pokipair.com.autre.test/2026/08/10103101/x.png', 'nimporte quoi']) assert.ok(!P.urlImageValide(m), m);
});
test('la table : un set de notre base par ligne, codes distincts, formats connus', () => {
    assert.strictEqual(new Set(P.TABLE.map(l => l.code)).size, P.TABLE.length); assert.strictEqual(new Set(P.TABLE.map(l => l.slug)).size, P.TABLE.length); assert.strictEqual(new Set(P.TABLE.map(l => l.page)).size, P.TABLE.length);
    assert.ok(P.TABLE.every(l => ['simple', 'groupe'].includes(l.format) && (l.format === 'groupe' || Number.isInteger(l.total))));
    assert.strictEqual(P.ligneDuSet('Gem-Pack-Vol5').code, 'CBB5C');
});
test('traçabilité neutre : source, lot, clé R2, id, mention et preuve de langue ne nomment JAMAIS la source ; l\'entrée porte l\'adresse d\'origine, la date et retirable', () => {
    assert.deepStrictEqual([P.SOURCE, P.LOT], ['ppr', 'ppr-2026-10']);
    assert.strictEqual(P.SRC.cleR2('Stellar-Crystal', '024', 314739), 'ppr/Stellar-Crystal/024-314739-zh-hans.webp');
    assert.strictEqual(P.SRC.idImage('Stellar-Crystal', 314739, '024'), 'ppr/Stellar-Crystal/314739/024/zh-hans');
    const u = { carteId: 314739, slugSet: 'Stellar-Crystal', numero: '024', produits: [887742], url: csv9.tuiles[0].url, idSource: '25504', preuveNeutre: 'set CSV9C, n° 024/208' };
    const meta = { cleR2: P.SRC.cleR2(u.slugSet, u.numero, u.carteId), sha256: 'a'.repeat(64), w: 350, h: 482, fmt: 'webp', wOriginal: 350, hOriginal: 482 };
    const e = RC.entreeDeCarte(P.SRC, u, meta, new Date('2026-10-24T12:00:00Z')), d = RC.documentImage(P.SRC, u, meta, new Date('2026-10-24T12:00:00Z'));
    for (const o of [e, d]) {
        assert.strictEqual(o.retirable, true); assert.strictEqual(o.urlOriginal, u.url); assert.ok(o.collecteLe instanceof Date); assert.strictEqual(o.source, 'ppr'); assert.strictEqual(o.lot, 'ppr-2026-10');
        assert.strictEqual(o.langue, 'zh-hans'); assert.strictEqual(o.basseDefinition, undefined);
        const sansAdresse = JSON.stringify({ ...o, urlOriginal: null });
        assert.ok(!/poki/i.test(sansAdresse), `un champ nomme la source : ${sansAdresse}`);
    }
    assert.strictEqual(d.etat, 'ok'); assert.deepStrictEqual(d.produits, [887742]); assert.strictEqual(d._id, 'ppr/Stellar-Crystal/314739/024/zh-hans');
});
test('langue : la règle commune (langue-visuel.js) connaît la source ; sa preuve est publique et ne nomme pas la source', () => {
    const v = langueDuVisuel({ source: 'ppr', langueSource: 'zh-hans', urlOriginal: 'https://media.pokipair.com/2026/08/x/y.png' });
    assert.strictEqual(v.langue, 'zh-hans'); assert.ok(!/poki/i.test(v.preuve)); assert.strictEqual(v.preuve, P.LANGUE_PREUVE);
    assert.strictEqual(langueDuVisuel({ source: 'ppr', langueSource: 'en' }).langue, null);
    assert.strictEqual(langueDuVisuel({ source: 'ppr' }).langue, null);
});
test('un descripteur de source qui nomme la source est refusé à la fabrication', () => {
    assert.throws(() => RC.fabriquerSource({ SOURCE: 'pokipair', LOT: 'x-1', LANGUE: 'zh-hans', LANGUE_PREUVE: 'x', TIRAGE: 'zh-hans', CHAMP_BILAN: 'b', nomsInterdits: ['pokipair'] }), /nomme la source/);
    assert.throws(() => RC.fabriquerSource({ SOURCE: 'ppr', LOT: 'ppr-1', LANGUE: 'zh-hans', LANGUE_PREUVE: 'x', TIRAGE: 'zh-hans' }), /absent/);
});

console.log(`${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
