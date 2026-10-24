// Banc de collecte-cartes/scrydex.js (source « scx ») — lecture des pages d'extensions, preuve et plan. Pages RÉELLES (McDonald's 2018 en entier, SM Trainer Kit Lycanroc en entier ; relevées le 2026-10-24,
// prix retirés) ; aucune requête, aucune base.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const S = require(process.env.SCX_MODULE || './collecte-cartes/scrydex');
const RC = require('./collecte-cartes/recolte-commun');
const { langueDuVisuel } = require('./collecte-cartes/langue-visuel');
const F = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'scx-pages.json'), 'utf8'));

let ok = 0, ko = 0;
const test = (nom, f) => { try { f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${e.message}`); } };

const mcd18 = S.lirePage(F.mcd18), tk10a = S.lirePage(F.tk10a);
const LM = S.ligneDe('MCD18'), LK = S.ligneDe('TK10'), LD = S.ligneDe('TK3'), L4 = S.ligneDe('TK4');
const prod = (carteId, idProduct, numeroFiche, carteNom, slug) => ({ carteId, idProduct, numeroFiche, carteNom, slug, carte: { _id: carteId, nomEn: carteNom } });
const planM = produits => S.planifier({ ligne: LM, pages: { mcd18 }, produits });
const planK = produits => S.planifier({ ligne: LK, pages: { tk10a }, produits });

test('lecture : 12 tuiles McDonald\'s 2018, champs lus, original en « large », entités décodées', () => {
    assert.strictEqual(mcd18.tuiles.length, 12);
    const t = mcd18.tuiles[2];
    assert.deepStrictEqual([t.id, t.n, t.nom, t.variante], ['mcd18-3', '3', 'Horsea', 'holofoil']);
    assert.strictEqual(t.url, 'https://images.scrydex.com/pokemon/mcd18-3/large');
    assert.ok(mcd18.tuiles.every(x => !x.illisible));
    assert.strictEqual(tk10a.tuiles.length, 30);
    assert.strictEqual(tk10a.tuiles[1].nom, 'Fighting Energy');
});
test('lecture : l\'entête déclaré (identifiant, langue, total) et le titre', () => {
    assert.deepStrictEqual([mcd18.entete.id, mcd18.entete.language_code, mcd18.entete.total, mcd18.entete.printed_total], ['mcd18', 'EN', 12, 12]);
    assert.strictEqual(tk10a.entete.id, 'tk10a'); assert.strictEqual(tk10a.entete.total, 30);
    assert.match(mcd18.titre, /McDonald's Collection 2018/); assert.match(mcd18.h1, /McDonald's Collection 2018/);
});
test('lecture : les tuiles de la LISTE (sans identifiant) ne comptent pas — une seule tuile par carte', () => {
    assert.strictEqual(new Set(mcd18.tuiles.map(t => t.id)).size, 12);
});
test('aucun prix dans la page lue ni dans la page réduite', () => {
    const r = S.reduirePage(F.mcd18);
    assert.ok(!/\$\s?[1-9]|price|prix/i.test(r), 'la page réduite porte un prix');
    assert.ok(!/<span class="text-body-12 font-bold/.test(r));
    assert.ok(!JSON.stringify(mcd18).match(/\$\s?\d/));
});
test('réduction : la page réduite donne EXACTEMENT les mêmes tuiles et le même entête, en bien moins de caractères', () => {
    for (const h of [F.mcd18, F.tk10a]) {
        const r = S.reduirePage(h), a = S.lirePage(r), b = S.lirePage(h);
        assert.deepStrictEqual(a.tuiles, b.tuiles); assert.deepStrictEqual(a.entete, b.entete); assert.strictEqual(a.h1, b.h1);
        assert.ok(r.length < h.length * 0.6, `${r.length} contre ${h.length}`);
    }
});
test('lecture : une tuile illisible est RENDUE avec son motif, jamais écartée en silence', () => {
    const sansNom = S.lirePage(F.mcd18.replace('Horsea #3', 'Horsea'));
    assert.strictEqual(sansNom.tuiles.length, 12); assert.match(sansNom.tuiles.find(t => t.illisible).illisible, /numéro/);
    const contredit = S.lirePage(F.mcd18.replace('Horsea #3', 'Horsea #4'));
    assert.match(contredit.tuiles.find(t => t.illisible).illisible, /contredisent/);
    const image = S.lirePage(F.mcd18.replace('https://images.scrydex.com/pokemon/mcd18-3/medium', 'https://images.scrydex.com/pokemon/mcd18-9/medium'));
    assert.match(image.tuiles.find(t => t.illisible).illisible, /image/);
    const horsHote = S.lirePage(F.mcd18.replace('https://images.scrydex.com/pokemon/mcd18-3/medium', 'https://autre.example/pokemon/mcd18-3/medium'));
    assert.ok(horsHote.tuiles.find(t => t.id === 'mcd18-3').illisible);
});
test('garde de lecture : identifiant, langue anglaise, total égal aux tuiles lues ; une page vide, un autre set, une autre langue, une liste tronquée sont refusés', () => {
    assert.strictEqual(S.verdictDePage(mcd18, LM.moities[0]).ok, true);
    assert.strictEqual(S.verdictDePage(tk10a, LK.moities[0]).ok, true);
    assert.match(S.verdictDePage(tk10a, LM.moities[0]).motif, /identifiant/);
    assert.match(S.verdictDePage(S.lirePage('<html>Just a moment</html>'), LM.moities[0]).motif, /aucune tuile/);
    const japonais = S.lirePage(F.mcd18.replace('language_code&quot;:&quot;EN', 'language_code&quot;:&quot;JA'));
    assert.match(S.verdictDePage(japonais, LM.moities[0]).motif, /langue/);
    const tronquee = { ...mcd18, tuiles: mcd18.tuiles.slice(0, 11) };
    assert.match(S.verdictDePage(tronquee, LM.moities[0]).motif, /total/);
    const illisibles = { ...mcd18, tuiles: mcd18.tuiles.map(t => ({ ...t, illisible: 'x' })) };
    assert.match(S.verdictDePage(illisibles, LM.moities[0]).motif, /illisible/);
    assert.match(S.verdictDePage(mcd18, null).motif, /absente/);
});
test('plan McDonald\'s : set + numéro + nom -> une unité avec l\'original, la preuve et le groupe', () => {
    const r = planM([prod(1, 901, '1', 'Growlithe', 'Growlithe-MCD181'), prod(2, 902, '2', 'Psyduck', 'Psyduck-MCD182')]);
    assert.strictEqual(r.unites.length, 2); assert.deepStrictEqual(r.restes, []);
    const u = r.unites[0];
    assert.deepStrictEqual([u.carteId, u.slugSet, u.numero, u.produits, u.groupe, u.variante, u.nomSource, u.numeroSource, u.idSource, u.moitie], [1, 'McDonald-s-Collection-2018-2', '1', [901], 'MCD18', 'holofoil', 'Growlithe', '1', 'mcd18-1', 'mcd18']);
    assert.strictEqual(u.url, 'https://images.scrydex.com/pokemon/mcd18-1/large');
    assert.match(u.preuve, /n° 1 = fiche 1/); assert.match(u.preuve, /Growlithe/);
});
test('plan : un produit SANS numéro de fiche prend celui de son slug (code du set + numéro), jamais deviné ailleurs', () => {
    const r = planM([prod(223875, 366771, null, 'Horsea', 'Horsea-MCD183'), prod(219297, 366779, '', 'Eevee', 'Eevee-MCD1811'), prod(9, 909, null, 'Machop', 'Machop-AUTRE6')]);
    assert.deepStrictEqual(r.unites.map(u => u.numero).sort(), ['11', '3']);
    assert.strictEqual(r.parMotif['sans-numero'], 1);
    assert.strictEqual(r.unites.find(u => u.carteId === 223875).sourceNumero, 'slug');
});
test('plan : un nom différent est un TROU (jamais l\'image du numéro seul) ; un nom qui désigne une autre carte du set est nommé', () => {
    const r = planM([prod(1, 901, '1', 'Arcanine', 'Arcanine-MCD181')]);
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.restes[0].motif, 'nom-different');
    const temoin = (carte, p) => (p.nom === 'Growlithe' ? [{ _id: 9, nomEn: 'Growlithe' }] : null);
    const r2 = S.planifier({ ligne: LM, pages: { mcd18 }, produits: [prod(1, 901, '1', 'Arcanine', 'Arcanine-MCD181')], temoin });
    assert.strictEqual(r2.restes[0].motif, 'nom-designe-une-autre-carte');
});
test('plan : le nom du produit (slug) qui contredit la tuile est un trou ; un slug illisible ne bloque pas', () => {
    assert.strictEqual(planM([prod(1, 901, '1', 'Growlithe', 'Arcanine-MCD181')]).restes[0].motif, 'nom-produit-different');
    const r2 = planM([prod(1, 901, '1', 'Growlithe', null)]);
    assert.strictEqual(r2.unites.length, 1); assert.strictEqual(r2.unites[0].nomProduit, null);
});
test('plan : le slug est en ASCII — « Poke-Ball » (produit) = « Poké Ball » (tuile), mais « Poke-Bal » n\'est pas « Poké Ball »', () => {
    const tuiles = [{ id: 'mcd18-1', n: '1', nom: 'Poké Ball', variante: 'normal', url: 'https://images.scrydex.com/pokemon/mcd18-1/large' }];
    const plan = slug => S.planifier({ ligne: LM, pages: { mcd18: { ...mcd18, tuiles } }, produits: [prod(17965, 5, '1', 'Poké Ball', slug)] });
    assert.strictEqual(plan('Poke-Ball-MCD181').unites.length, 1);
    assert.strictEqual(plan('Poke-Bal-MCD181').restes[0].motif, 'nom-produit-different');
});
test('plan : le numéro hors de la page, deux produits au même numéro d\'une même carte, deux produits pour une même tuile : chacun son motif, aucune image', () => {
    const r = planM([prod(1, 901, '77', 'Growlithe', 'Growlithe-MCD1877'),
        prod(2, 902, '2', 'Psyduck', 'Psyduck-MCD182'), prod(2, 912, '2', 'Psyduck', 'Psyduck-V2-MCD182'),
        prod(3, 903, '3', 'Horsea', 'Horsea-MCD183'), prod(4, 904, '3', 'Horsea', 'Horsea-MCD183')]);
    assert.strictEqual(r.unites.length, 0);
    assert.deepStrictEqual(r.parMotif, { 'absente-de-la-source': 1, variantes: 2, 'tuile-revendiquee-deux-fois': 2 });
});
test('plan : un produit joint à PLUSIEURS cartes n\'en désigne aucune', () => {
    const r = planM([prod(1, 901, '1', 'Growlithe', 'Growlithe-MCD181'), prod(2, 901, '2', 'Psyduck', 'Growlithe-MCD181')]);
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['produit-vers-plusieurs-cartes'], 2);
});
test('plan : une tuile illisible n\'est jamais la carte, même si son numéro se lit', () => {
    const tuiles = mcd18.tuiles.map(t => (t.n === '1' ? { ...t, illisible: 'x' } : t));
    const r = S.planifier({ ligne: LM, pages: { mcd18: { ...mcd18, tuiles } }, produits: [prod(1, 901, '1', 'Growlithe', 'Growlithe-MCD181')] });
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['absente-de-la-source'], 1);
});
test('plan : deux tuiles au même numéro dans une page = ambigu, aucune unité', () => {
    const doublee = { ...mcd18, tuiles: [...mcd18.tuiles, { ...mcd18.tuiles[0], id: 'mcd18-1b' }] };
    const r = S.planifier({ ligne: LM, pages: { mcd18: doublee }, produits: [prod(1, 901, '1', 'Growlithe', 'Growlithe-MCD181')] });
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['tuile-ambigue'], 1);
});
test('plan : une adresse hors de la forme fermée est un trou', () => {
    const mauvaise = mcd18.tuiles.map(t => ({ ...t, url: t.url.replace(S.HOTE_IMAGES, 'autre.example') }));
    assert.strictEqual(S.planifier({ ligne: LM, pages: { mcd18: { ...mcd18, tuiles: mauvaise } }, produits: [prod(1, 901, '1', 'Growlithe', 'Growlithe-MCD181')] }).parMotif['adresse-hors-forme'], 1);
});
test('plan : une moitié dont la page n\'est pas lue (absente ou refusée) laisse ses produits sans image, avec ce motif', () => {
    const r = S.planifier({ ligne: LM, pages: {}, produits: [prod(1, 901, '1', 'Growlithe', 'Growlithe-MCD181')] });
    assert.strictEqual(r.parMotif['page-absente'], 1);
});
test('kit à deux moitiés : le jeton du slug désigne la page (TK10L = Lycanroc, TK10A = Alolan Raichu) ; une moitié non lue ou un slug sans jeton ne donne rien', () => {
    const r = planK([prod(223004, 297261, '30', 'Lycanroc', 'Lycanroc-V2-TK10L30'),     // Lycanroc #30, moitié tk10a
        prod(223006, 297280, '30', 'Alolan Raichu', 'Alolan-Raichu-V2-TK10A30'),          // moitié tk10b : page non lue
        prod(216537, 297243, '12', 'Yungoos', 'Yungoos-TK10L12'),
        prod(216538, 297299, '12', 'Yungoos', 'Yungoos-sans-jeton')]);
    assert.deepStrictEqual(r.unites.map(u => [u.numero, u.moitie, u.url]).sort(), [['12', 'tk10a', 'https://images.scrydex.com/pokemon/tk10a-12/large'], ['30', 'tk10a', 'https://images.scrydex.com/pokemon/tk10a-30/large']]);
    assert.strictEqual(r.parMotif['page-absente'], 1); assert.strictEqual(r.parMotif['moitie-illisible'], 1);
});
test('kit : la même carte au même numéro dans les deux moitiés = variantes (une seule image possible par carte et numéro), aucune des deux', () => {
    const r = planK([prod(219480, 297254, '19', 'Hau', 'Hau-V1-TK10L19'), prod(219480, 297282, '19', 'Hau', 'Hau-V3-TK10A19')]);
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif.variantes, 2);
});
test('kit : « Basic Fighting Energy » (fiche) = « Fighting Energy » (tuile) — la clé de la production retire « Basic »', () => {
    const r = planK([prod(13686, 297233, '2', 'Basic Fighting Energy', 'Fighting-Energy-V1-TK10L02')]);
    assert.strictEqual(r.unites.length, 1); assert.strictEqual(r.unites[0].numero, '2');
});
test('kit DP : la lettre du numéro (L = Lucario, M = Manaphy) ou le jeton (Gold, Blue) désignent la moitié ; les deux signaux qui se contredisent = trou ; un produit sans numéro prend celui du slug et la lettre de sa moitié', () => {
    const T = { tk3a: 'Goldeen', tk3b: 'Lucario' };
    const fait = p => S.planifier({ ligne: LD, pages: Object.fromEntries(LD.moities.map(m => [m.id, { entete: { id: m.id, language_code: 'EN', total: 1 }, tuiles: [{ id: `${m.id}-3`, n: '3', nom: T[m.id], variante: 'normal', url: `https://images.scrydex.com/pokemon/${m.id}-3/large` }] }])), produits: [p] });
    assert.strictEqual(fait(prod(1, 1, 'L3', 'Lucario', 'Lucario-Lv30-TK33-Gold')).unites[0].moitie, 'tk3b');
    assert.strictEqual(fait(prod(2, 2, 'M3', 'Goldeen', 'Goldeen-Lv14-TK33-Blue')).unites[0].moitie, 'tk3a');
    assert.strictEqual(fait(prod(1, 1, 'L3', 'Lucario', 'Lucario-Lv30-TK33-Blue')).parMotif['moitie-contradictoire'], 1);
    const sans = fait(prod(3, 3, null, 'Lucario', 'Lucario-Lv30-TK33-Gold'));
    assert.strictEqual(sans.unites[0].numero, 'L3'); assert.strictEqual(sans.unites[0].moitie, 'tk3b');
});
test('kit HGSS : jeton « yellow » ou « R » = Raichu, « blue » ou « G » = Gyarados', () => {
    const jet = slug => L4.moities.filter(m => m.jeton.test(slug)).map(m => m.id);
    assert.deepStrictEqual(jet('Totodile-V1-TK4blue-1'), ['tk4b']); assert.deepStrictEqual(jet('Gyarados-V1-TK4G20'), ['tk4b']);
    assert.deepStrictEqual(jet('Pikachu-V1-TK4yellow-2'), ['tk4a']); assert.deepStrictEqual(jet('Meowth-V2-TK4R12'), ['tk4a']);
    assert.deepStrictEqual(jet('Pikachu-TK4-12'), []);
});
test('exclusions motivées : la liste est fermée et gelée ; l\'unité exclue sort du plan avec son motif (la carte ET la tuile)', () => {
    assert.ok(Object.isFrozen(S.EXCLUSIONS));
    const excl = [{ carteId: 1, idSource: 'mcd18-1', code: 'MCD18', nom: 'x', le: '2026-10-24', motif: 'image déformée' }];
    const pr = [prod(1, 901, '1', 'Growlithe', 'Growlithe-MCD181')];
    const r = S.planifier({ ligne: LM, pages: { mcd18 }, produits: pr, exclusions: excl });
    assert.strictEqual(r.unites.length, 0); assert.strictEqual(r.parMotif['exclusion-motivee'], 1);
    assert.strictEqual(S.planifier({ ligne: LM, pages: { mcd18 }, produits: pr, exclusions: [{ ...excl[0], idSource: 'mcd18-2' }] }).unites.length, 1);
    assert.strictEqual(S.planifier({ ligne: LM, pages: { mcd18 }, produits: [prod(2, 902, '1', 'Growlithe', 'Growlithe-MCD181')], exclusions: excl }).unites.length, 1);
});
test('plan : le dénominateur — tuiles lues, numéros — est imprimé avec le plan', () => {
    const r = planM([]);
    assert.deepStrictEqual([r.base.tuiles, r.base.numeros, r.base.illisibles], [12, 12, 0]);
});
test('nom du produit : variantes, niveaux et numéros intercalés retirés ; slug sans le code du set = illisible', () => {
    assert.strictEqual(S.nomDuProduit('Alolan-Raichu-V1-TK10A17', 'TK10'), 'Alolan Raichu');
    assert.strictEqual(S.nomDuProduit('Lucario-Lv30-TK33-Gold', 'TK3'), 'Lucario');
    assert.strictEqual(S.nomDuProduit('Lotad-01-TK811A', 'TK8'), 'Lotad');
    assert.strictEqual(S.nomDuProduit('Horsea-MCD183', 'MCD18'), 'Horsea');
    assert.strictEqual(S.nomDuProduit('Horsea-PAL183', 'MCD18'), null);
    assert.strictEqual(S.nomDuProduit(null, 'MCD18'), null);
    assert.strictEqual(S.nomDuProduit('MCD183', 'MCD18'), null);
});
test('hôtes : la liste est FERMÉE — les pages de la table et la forme des images, rien d\'autre (ni l\'API, ni une page de carte, ni les prix)', () => {
    const h = S.hotes();
    assert.deepStrictEqual(Object.keys(h).sort(), ['images.scrydex.com', 'scrydex.com']);
    for (const l of S.TABLE) for (const m of l.moities) assert.ok(h['scrydex.com'].chemin.test(`/pokemon/expansions/${m.page}/${m.id}`), m.id);
    assert.ok(h['scrydex.com'].chemin.test('/robots.txt'));
    for (const mauvais of ['/', '/pokemon/v1/expansions/mcd18', '/pokemon/v1/cards', '/pokemon/expansions', '/pokemon/expansions/mcdonalds-collection-2018/mcd18/prices', '/pokemon/cards/growlithe/mcd18-1', '/pokemon/expansions/x/y/../../../login', '/api/', '/pokemon/expansions/mcdonalds-collection-2018/mcd99', '/pokemon/expansions/mcdonalds-collection-2018/mcd18?variant=normal', '/sitemap.xml']) assert.ok(!h['scrydex.com'].chemin.test(mauvais), mauvais);
    assert.ok(h['images.scrydex.com'].chemin.test('/pokemon/mcd18-3/large'));
    assert.ok(h['images.scrydex.com'].chemin.test('/robots.txt'));
    for (const mauvais of ['/', '/pokemon/mcd18-3/small', '/pokemon/mcd18-3/medium', '/pokemon/zzz-3/large', '/pokemon/mcd18-3/large/../x', '/pokemon/mcd18-3/large?x=1', '/pokemon/mcd18-logo/logo', '/pokemon/v1/cards']) assert.ok(!h['images.scrydex.com'].chemin.test(mauvais), mauvais);
    assert.throws(() => S.urlPage('zzz'), /hors de la table/);
    assert.strictEqual(S.urlPage('mcd18'), 'https://' + S.HOTE_PAGES + '/pokemon/expansions/mcdonalds-collection-2018/mcd18');
});
test('urlImageValide : https, l\'hôte des images, la forme fermée, sans requête ni port', () => {
    assert.ok(S.urlImageValide('https://images.scrydex.com/pokemon/tk10a-14/large'));
    const NOM = ['scry', 'dex.com'].join('');       // (formes hostiles bâties par morceaux : la garde statique « jamais d'API » lit des textes)
    for (const m of [`http://images.${NOM}/pokemon/tk10a-14/large`, `https://${NOM}/pokemon/tk10a-14/large`, `https://images.${NOM}/pokemon/tk10a-14/large?a=1`, `https://images.${NOM}:8443/pokemon/tk10a-14/large`, `https://images.${NOM}.autre.test/pokemon/tk10a-14/large`, `https://images.${NOM}/pokemon/tk10a-14/medium`, `https://images.${NOM}/pokemon/zzz-14/large`, 'nimporte quoi']) assert.ok(!S.urlImageValide(m), m);
});
test('le dos de carte du serveur d\'images (HTTP 200, une empreinte connue) est reconnu et ne sera jamais une image', () => {
    const dos = fs.readFileSync(path.join(__dirname, 'fixtures', 'dos-de-carte-serveur-images.png'));
    assert.strictEqual(S.refuserOctets(dos), 'dos-de-carte');
    assert.strictEqual(S.refuserOctets(Buffer.from('autre chose')), null);
    assert.strictEqual(S.SRC.refuserOctets(dos), 'dos-de-carte');
});
test('la table : un set de notre base par ligne, codes distincts, chaque moitié une page et un identifiant uniques, totalement gelée', () => {
    assert.strictEqual(new Set(S.TABLE.map(l => l.code)).size, S.TABLE.length); assert.strictEqual(new Set(S.TABLE.map(l => l.slug)).size, S.TABLE.length);
    const ids = S.TABLE.flatMap(l => l.moities.map(m => m.id)); assert.strictEqual(new Set(ids).size, ids.length);
    assert.ok(Object.isFrozen(S.TABLE) && S.TABLE.every(l => Object.isFrozen(l) && l.moities.every(m => Object.isFrozen(m))));
    assert.ok(S.TABLE.every(l => l.moities.length === 1 || l.moities.every(m => m.jeton || m.prefixe)), 'un kit à deux moitiés doit nommer le signal qui les sépare');
    assert.strictEqual(S.ligneDuSet('HS-Trainer-Kit').code, 'TK4');
});
test('traçabilité neutre : source, lot, clé R2, id, mention et preuve de langue ne nomment JAMAIS la source ; l\'entrée porte l\'adresse d\'origine, la date et retirable', () => {
    assert.deepStrictEqual([S.SOURCE, S.LOT], ['scx', 'scx-2026-10']);
    assert.strictEqual(S.SRC.cleR2('McDonald-s-Collection-2018-2', '3', 223875), 'scx/McDonald-s-Collection-2018-2/3-223875-en.webp');
    assert.strictEqual(S.SRC.idImage('McDonald-s-Collection-2018-2', 223875, '3'), 'scx/McDonald-s-Collection-2018-2/223875/3/en');
    const u = { carteId: 223875, slugSet: 'McDonald-s-Collection-2018-2', numero: '3', produits: [366771], url: mcd18.tuiles[2].url, idSource: 'mcd18-3', preuveNeutre: 'set MCD18, n° 3' };
    const meta = { cleR2: S.SRC.cleR2(u.slugSet, u.numero, u.carteId), sha256: 'a'.repeat(64), w: 700, h: 976, fmt: 'webp', wOriginal: 734, hOriginal: 1024 };
    const e = RC.entreeDeCarte(S.SRC, u, meta, new Date('2026-10-24T12:00:00Z')), d = RC.documentImage(S.SRC, u, meta, new Date('2026-10-24T12:00:00Z'));
    for (const o of [e, d]) {
        assert.strictEqual(o.retirable, true); assert.strictEqual(o.urlOriginal, u.url); assert.ok(o.collecteLe instanceof Date); assert.strictEqual(o.source, 'scx'); assert.strictEqual(o.lot, 'scx-2026-10');
        assert.strictEqual(o.langue, 'en'); assert.strictEqual(o.basseDefinition, undefined);
        const sansAdresse = JSON.stringify({ ...o, urlOriginal: null });
        assert.ok(!/scry/i.test(sansAdresse), `un champ nomme la source : ${sansAdresse}`);
    }
    assert.strictEqual(d.etat, 'ok'); assert.deepStrictEqual(d.produits, [366771]); assert.strictEqual(d._id, 'scx/McDonald-s-Collection-2018-2/223875/3/en');
});
test('langue : la règle commune (langue-visuel.js) connaît la source ; sa preuve est publique et ne nomme pas la source', () => {
    const v = langueDuVisuel({ source: 'scx', langueSource: 'en', urlOriginal: 'https://images.scrydex.com/pokemon/mcd18-3/large' });
    assert.strictEqual(v.langue, 'en'); assert.ok(!/scry/i.test(v.preuve)); assert.strictEqual(v.preuve, S.LANGUE_PREUVE);
    assert.strictEqual(langueDuVisuel({ source: 'scx', langueSource: 'ja' }).langue, null);
    assert.strictEqual(langueDuVisuel({ source: 'scx' }).langue, null);
});
test('un descripteur de source qui nomme la source est refusé à la fabrication', () => {
    assert.throws(() => RC.fabriquerSource({ SOURCE: 'scrydex', LOT: 'x-1', LANGUE: 'en', LANGUE_PREUVE: 'x', TIRAGE: 'intl', CHAMP_BILAN: 'b', nomsInterdits: ['scrydex'] }), /nomme la source/);
});

console.log(`${ok} passés, ${ko} en échec`);
process.exitCode = ko ? 1 : 0;
