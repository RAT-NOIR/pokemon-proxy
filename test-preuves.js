// Banc du fournisseur « prv » (preuves validées) : collecte-cartes/preuves.js (pur), le plan sur une FAUSSE base, l'écriture sur de FAUX modèles, la ligne de commande, le retrait.
// AUCUNE base réelle, AUCUN réseau. Chaque garde doit pouvoir ÉCHOUER : mutants-preuves.js retire chaque garde, un test doit casser.
'use strict';
const assert = require('assert');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const PV = require('./collecte-cartes/preuves');
const RC = require('./collecte-cartes/recolte-commun');
const HOTE = require('./collecte-cartes/recolte-hote');
const CO = require('./collecte-cartes/comblement');
const CT = require('./collecte-cartes/cardtrader');
const CLI = require('./collecte-cartes/recolte-cli');
const { fauxModeles } = require('./faux-modeles-cardtrader');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 14).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prv-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const SILENCE = async f => { const l = console.log, e = console.error; const sortie = []; console.log = (...a) => sortie.push(a.join(' ')); console.error = (...a) => sortie.push(a.join(' ')); try { return [await f(), sortie]; } finally { console.log = l; console.error = e; } };
const png = (w, h, couleur = { r: 40, g: 120, b: 200 }) => sharp({ create: { width: w, height: h, channels: 3, background: couleur } }).png().toBuffer();
// une image « à motifs » pour la chaîne réelle de la règle d'image (pHash + ORB) : mêmes pixels -> mêmes empreintes, autre graine -> autre image
const fabrique = (seed, l = 300, h = 420) => { const rn = CT.prng(seed), b = Buffer.alloc(l * h * 3, 128); for (let k = 0; k < 220; k++) { const x0 = Math.floor(rn() * (l - 20)), y0 = Math.floor(rn() * (h - 20)), w = 8 + Math.floor(rn() * 60), hh = 8 + Math.floor(rn() * 60), c = Math.floor(rn() * 256); for (let y = y0; y < Math.min(h, y0 + hh); y++) for (let x = x0; x < Math.min(l, x0 + w); x++) { const o = (y * l + x) * 3; b[o] = b[o + 1] = b[o + 2] = c; } } return sharp(b, { raw: { width: l, height: h, channels: 3 } }); };

const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64), H3 = 'c'.repeat(64);
const entree = (o = {}) => ({ idProduct: 1001, regle: 'preuve-lue', url: 'https://img.alpha.test/a/1.png', hote: 'img.alpha.test', fichier: 'C:\\x\\a.bin', sha256: H1, w: 570, h: 797, seconde: null,
    attendu: { nom: 'Bulbasaur', numero: '13', langue: 'en', tampon: null, variante: null },
    lu: { nom: 'Bulbasaur', numero: '13', total: '40', langue: 'en', tampon: null, finition: 'normale', marques: ['13/40', 'texte anglais'], note: '' },
    varianteNommee: null, contradictions: [], sourcesConsultees: ['alpha'], luLe: '2026-10-26T10:00:00.000Z', ...o });
const validation = (o = {}) => ({ idProduct: 1001, sha256: H1, regle: 'preuve-lue', valideLe: '2026-10-26T12:00:00.000Z', par: 'coordinateur', planche: 'planche-01.jpg', ...o });
const produit = (o = {}) => ({ idProduct: 1001, idExpansion: 5000, tirage: 'intl', tamponnee: null, numero: '13', carteId: 77, slugSet: 'Set-A', nomEn: 'Bulbasaur', ...o });

(async () => {
    // ───────── la langue du tirage du produit (P4) ─────────
    await test('P4 : langue du tirage = la fonction de production ; 2361 et 3354 (McDonald\'s européens) = fr, ILS SEULS', () => {
        assert.deepStrictEqual({ ...PV.EDITIONS_LOCALES }, { 2361: 'fr', 3354: 'fr' });
        assert.ok(Object.isFrozen(PV.EDITIONS_LOCALES));
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 5000, tirage: 'intl' }), 'en');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 5000, tirage: 'jp' }), 'ja');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 2361, tirage: 'intl' }), 'fr');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 3354, tirage: 'intl' }), 'fr');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 2362, tirage: 'intl' }), 'en');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 5000, tirage: 'idth' }), null, 'un tirage à deux langues n\'a pas de langue');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 5000, tirage: undefined }), null);
        assert.strictEqual(PV.langueDuProduit({ idExpansion: '2361', tirage: 'intl' }), 'en', 'la clé est l\'idExpansion ENTIER');
        for (const t of ['intl', 'jp', 'zh-hans', 'zh-hant', 'id', 'th']) assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: t }), CO.langueDuTirage(t), 'la table de production, jamais recopiée');
    });

    // ───────── le manifeste et les validations (P1) ─────────
    await test('manifeste : la forme (famille, entrées, trous) ; une famille qui ne porte pas le nom du dossier est refusée', () => {
        const m = PV.lireManifeste({ famille: 'MCD', le: '2026-10-26T00:00:00Z', entrees: [entree()], trous: [] }, 'MCD');
        assert.strictEqual(m.entrees.length, 1); assert.strictEqual(m.famille, 'MCD');
        // tour 1 (6) : le DOSSIER fait foi ; une famille déclarée autre (ou absente) ne fait pas lever le plan, l'écart est rendu pour être imprimé
        const autre = PV.lireManifeste({ famille: 'SOURCES (transversal R6)', entrees: [], trous: [] }, 'SOURCES');
        assert.deepStrictEqual([autre.famille, autre.familleDeclaree, autre.ecartDeFamille], ['SOURCES', 'SOURCES (transversal R6)', true]);
        assert.strictEqual(PV.lireManifeste({ entrees: [] }, 'X').ecartDeFamille, true);
        assert.strictEqual(m.ecartDeFamille, false);
        assert.throws(() => PV.lireManifeste({ entrees: [] }), /famille/);
        assert.throws(() => PV.lireManifeste(null, 'MCD'), /manifeste/);
        assert.throws(() => PV.lireManifeste({ famille: 'MCD', entrees: {}, trous: [] }, 'MCD'), /entrees/);
        assert.throws(() => PV.lireManifeste({ famille: 'MCD', entrees: [], trous: 'x' }, 'MCD'), /trous/);
        assert.deepStrictEqual(PV.lireManifeste({ famille: 'MCD', entrees: [] }, 'MCD').trous, []);
    });
    await test('entrée de manifeste : chaque champ exigé, sinon refus NOMMÉ (jamais corrigé)', () => {
        assert.strictEqual(PV.formeEntree(entree()), null);
        const mal = (o, re) => assert.match(PV.formeEntree(entree(o)) ?? 'ACCEPTÉE', re);
        mal({ idProduct: '1001' }, /idProduct/); mal({ idProduct: 0 }, /idProduct/);
        mal({ regle: 'au-feeling' }, /regle/); mal({ url: 'http://x.test/a.png' }, /url/); mal({ url: null }, /url/);
        mal({ hote: '' }, /hote/); mal({ fichier: null }, /fichier/); mal({ sha256: 'xyz' }, /sha256/); mal({ sha256: 'A'.repeat(64) }, /sha256/);
        mal({ lu: null }, /\blu\b/); mal({ attendu: null }, /attendu/); mal({ contradictions: 'aucune' }, /contradictions/); mal({ luLe: 'hier' }, /luLe/);
        mal({ regle: 'deux-sources', seconde: null }, /seconde/);
        mal({ regle: 'deux-sources', seconde: { url: 'https://b.test/x.png', hote: 'b.test', fichier: 'f', sha256: 'zz' } }, /seconde/);
    });
    await test('validations : shape exigée (par = coordinateur, date, planche, sha256) ; un fichier faux LÈVE', () => {
        assert.strictEqual(PV.lireValidations([validation()]).length, 1);
        assert.throws(() => PV.lireValidations({}), /tableau/);
        assert.throws(() => PV.lireValidations([validation({ par: 'agent' })]), /coordinateur/);
        assert.throws(() => PV.lireValidations([validation({ par: undefined })]), /coordinateur/);
        assert.throws(() => PV.lireValidations([validation({ valideLe: 'bientôt' })]), /valideLe/);
        assert.throws(() => PV.lireValidations([validation({ planche: '' })]), /planche/);
        assert.throws(() => PV.lireValidations([validation({ sha256: 'abc' })]), /sha256/);
        assert.throws(() => PV.lireValidations([validation({ regle: 'au-feeling' })]), /regle/);
        assert.throws(() => PV.lireValidations([validation({ idProduct: 1.5 })]), /idProduct/);
    });
    await test('P1 : sans validation au MÊME sha256 = refus nommé ; validation sans entrée = refusée ; règle différente ; doublons', () => {
        const r = PV.rapprocher({ entrees: [entree(), entree({ idProduct: 1002 }), entree({ idProduct: 1003 }), entree({ idProduct: 1004, regle: 'deux-sources', seconde: { url: 'https://b.test/x.png', hote: 'b.test', fichier: 'f', sha256: H2 } })],
            validations: [validation(), validation({ idProduct: 1002, sha256: H2 }), validation({ idProduct: 1004, regle: 'preuve-lue' }), validation({ idProduct: 9999 })] });
        assert.deepStrictEqual(r.appariees.map(a => a.entree.idProduct), [1001]);
        const motifs = Object.fromEntries(r.refus.map(x => [x.idProduct, x.motif]));
        assert.deepStrictEqual(motifs, { 1002: 'validation-sha256-different', 1003: 'sans-validation', 1004: 'validation-regle-differente', 9999: 'validation-sans-entree' });
        const d = PV.rapprocher({ entrees: [entree(), entree()], validations: [validation()] });
        assert.strictEqual(d.appariees.length, 0); assert.deepStrictEqual(d.refus.map(x => x.motif), ['doublon-manifeste', 'doublon-manifeste']);
        const c = PV.rapprocher({ entrees: [entree()], validations: [validation(), validation({ sha256: H2 })] });
        assert.strictEqual(c.appariees.length, 0); assert.strictEqual(c.refus[0].motif, 'validations-contradictoires');
        const memes = PV.rapprocher({ entrees: [entree()], validations: [validation(), validation()] });
        assert.strictEqual(memes.appariees.length, 1, 'deux validations identiques = une');
        const mal = PV.rapprocher({ entrees: [entree({ sha256: 'zz' })], validations: [validation({ sha256: H1 })] });
        assert.strictEqual(mal.appariees.length, 0); assert.match(mal.refus[0].motif, /^entree-mal-formee/);
    });

    // ───────── P2 : la règle preuve-lue ─────────
    // ➕ 2026-11-03 : comme la production (evaluerEntree), la langue du produit se calcule AVEC la langue lue (un tirage à deux langues, idth, admet celle des siennes qui est lue)
    const lue = (e, p = produit()) => PV.evaluerPreuveLue({ entree: e, produit: p, langueProduit: PV.langueDuProduit({ ...p, langueLue: e.lu?.langue }) });
    await test('P4 (03/11) : un tirage à DEUX langues (idth) admet la langue lue si elle est l\'une des siennes ; toute autre reste refusée ; un tirage à une langue ignore la langue lue', () => {
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'idth', langueLue: 'id' }), 'id');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'idth', langueLue: 'th' }), 'th');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'idth', langueLue: 'en' }), null, 'anglais sur un set idth : refusé');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'idth', langueLue: 'ja' }), null);
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'idth' }), null, 'rien de lu : on ne sait pas');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'intl', langueLue: 'id' }), 'en', 'un tirage à une langue ne lit pas la langue lue');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'id', langueLue: 'th' }), 'id');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 2361, tirage: 'idth', langueLue: 'id' }), 'fr', 'l\'édition locale énumérée l\'emporte toujours');
        assert.strictEqual(PV.langueDuProduit({ idExpansion: 1, tirage: 'constructor', langueLue: 'constructor' }), null);
    });
    // ➕ 2026-11-03 : DEMI-LISTES indonésiennes/thaïes (AC3, AS1–AS4, tpc-sets.js) — le produit porte « a229 », la carte imprime « 229/205 » et le code « AC3a », le slug Cardmarket finit par « AC3a229 »
    await test('P2 (03/11) : demi-liste (table fermée AC3, AS1–AS4) : « a229 » du produit = « 229 » lu + code « AC3a » lu + slug « …-AC3a229 » ; toute discordance refuse', () => {
        const p = produit({ tirage: 'id', numero: 'a229', slug: 'Gengar-Mimikyu-GX-V3-AC3a229', slugSet: 'Tag-Team-Collection', nomEn: 'Gengar & Mimikyu GX' });
        const l = (o = {}) => entree({ attendu: { ...entree().attendu, numero: 'a229' }, lu: { ...entree().lu, nom: 'Gengar & Mimikyu GX', numero: '229', total: '205', langue: 'id', codeSet: 'AC3a', ...o } });
        const m = (e, pp = p) => lue(e, pp).motifs;
        const sansNumeroNiCode = ms => !ms.includes('numero-different') && !ms.includes('code-set-different');
        assert.ok(sansNumeroNiCode(m(l())), m(l()).join(','));
        assert.ok(m(l({ codeSet: 'AC3b' })).includes('numero-different'), 'lettre du code lue ≠ lettre du numéro du produit');
        assert.ok(m(l({ codeSet: 'AC3' })).includes('numero-different'), 'code lu sans lettre');
        assert.ok(m(l({ numero: '228' })).includes('numero-different'), 'chiffres différents');
        assert.ok(m(l(), produit({ ...p, slug: 'Gengar-Mimikyu-GX-V3-XY229' })).includes('numero-different'), 'le slug ne porte pas le code');
        assert.ok(m(l(), produit({ ...p, slug: null })).includes('numero-different'), 'sans slug : rien ne confronte');
        assert.ok(m(l({ codeSet: 'XX1a' }), produit({ ...p, slug: 'Gengar-XX1a229' })).includes('numero-different'), 'code hors de la table fermée');
        assert.ok(sansNumeroNiCode(m(l({ numero: '013', codeSet: 'AS3a' }), produit({ ...p, numero: 'a013', slug: 'Shaymin-AS3013' }))), 'slug sans la lettre (AS3013) : admis, la lettre vient du code lu et du produit');
        assert.ok(m(l({ numero: '13', codeSet: 'AS3a' }), produit({ ...p, numero: 'b013', slug: 'Shaymin-AS3013' })).includes('numero-different'), 'produit « b », code lu « a »');
        assert.ok(m(l(), produit({ ...p, numero: '229' })).length >= 0 && !m(l(), produit({ ...p, numero: '229' })).includes('numero-different'), 'produit sans lettre : la règle ordinaire (229 = 229)');
    });
    await test('P2 : une preuve complète passe (numéro 013 = 13 par la clé de la jointure)', () => {
        assert.deepStrictEqual(lue(entree()), { ok: true, motifs: [] });
        assert.strictEqual(lue(entree({ lu: { ...entree().lu, numero: '013' } })).ok, true);
        assert.strictEqual(lue(entree(), produit({ numero: '013' })).ok, true);
    });
    await test('P2 : chaque discordance REFUSE, avec son motif', () => {
        const motif = (e, p) => lue(e, p).motifs.join(',');
        const lu = o => entree({ lu: { ...entree().lu, ...o } });
        assert.match(motif(lu({ numero: '' })), /numero-ou-total-absent/);
        assert.match(motif(lu({ numero: null })), /numero-ou-total-absent/);
        assert.match(motif(lu({ total: '' })), /numero-ou-total-absent/);
        assert.match(motif(lu({ total: undefined })), /numero-ou-total-absent/);
        assert.match(motif(lu({ numero: '14' })), /numero-different/);
        assert.match(motif(lu({ numero: '13/40' })), /numero-different/, 'le numéro lu est le numéro, pas la fraction');
        assert.match(motif(lu({ langue: 'ja' })), /langue-differente/);
        assert.match(motif(lu({ langue: null })), /langue-differente/);
        assert.match(motif(lu({ langue: 'fr' })), /langue-differente/, 'fr n\'est admise que pour les éditions locales énumérées');
        assert.match(motif(lu({ tampon: 'pps' })), /tampon-different/, 'tampon lu sur un produit sans tampon');
        assert.match(motif(entree(), produit({ tamponnee: 'pps' })), /tampon-different/, 'produit tamponné, scan sans tampon : null ≠ un tampon');
        assert.match(motif(lu({ tampon: 'ba20' }), produit({ tamponnee: 'pps' })), /tampon-different/);
        assert.strictEqual(lue(lu({ tampon: ' PPS ' }), produit({ tamponnee: 'pps' })).ok, true, 'même tampon, casse et espaces ignorés');
        assert.match(motif(lu({ marques: [] })), /marques-vides/);
        assert.match(motif(lu({ marques: undefined })), /marques-vides/);
        assert.match(motif(lu({ marques: [''] })), /marques-vides/);
        assert.match(motif(entree({ contradictions: ['une boutique dit 14'] })), /contradictions/);
        assert.match(motif(entree({ contradictions: undefined })), /contradictions/);
        assert.match(motif(entree(), produit({ tirage: 'idth' })), /langue-du-tirage-inconnue/);
    });
    await test('P2/P4 : édition française (2361) : lu.langue fr passe, en est refusée ; hors 2361/3354 le fr est refusé', () => {
        const fr = entree({ lu: { ...entree().lu, langue: 'fr', nom: 'Bulbizarre' } });
        // décision du testeur (27/10) : un nom lu en français se compare au nom FRANÇAIS du produit (numeros_cartes.nomFr), SEULEMENT quand le produit est un tirage français
        assert.deepStrictEqual(lue(fr, produit({ idExpansion: 2361, nomFr: 'Bulbizarre' })), { ok: true, motifs: [] });
        assert.deepStrictEqual(lue(fr, produit({ idExpansion: 3354, nomFr: 'Bulbizarre [Razor Leaf]' })), { ok: true, motifs: [] }, 'nom du produit décomposé avant « [ »');
        assert.deepStrictEqual(lue(fr, produit({ idExpansion: 2361, nomFr: 'Herbizarre' })).motifs, ['nom-different']);
        assert.deepStrictEqual(lue(fr, produit({ idExpansion: 2361 })).motifs, ['nom-different'], 'produit français sans nom français : rien à comparer = refus');
        assert.deepStrictEqual(lue(fr, produit({ idExpansion: 2361, nomFr: null, nomEn: 'Bulbizarre' })).motifs, ['nom-different'], 'un nom français ne se compare JAMAIS au nom anglais');
        const enSurFr = lue(entree({ lu: { ...entree().lu, langue: 'en' } }), produit({ idExpansion: 2361, nomFr: 'Bulbizarre' }));
        assert.deepStrictEqual(enSurFr.motifs, ['langue-differente'], 'scan anglais sur produit français : refus de langue ; le nom anglais se compare au nom anglais');
        const de = entree({ lu: { ...entree().lu, langue: 'de', nom: 'Bulbizarre' } });
        assert.match(lue(de, produit({ idExpansion: 2361, nomFr: 'Bulbizarre' })).motifs.join(), /nom-langue-non-anglaise/, 'ni anglais ni français du produit français : refus');
        const r5000 = lue(fr, produit({ idExpansion: 5000, nomFr: 'Bulbizarre' })).motifs;
        assert.match(r5000.join(), /langue-differente/);
        assert.match(r5000.join(), /nom-langue-non-anglaise/, 'produit NON français : le nom français n\'est jamais comparé, même si nomFr existe');
        assert.match(lue(entree(), produit({ idExpansion: 2361 })).motifs.join(), /langue-differente/, 'le produit EST français : un scan anglais n\'est pas son tirage');
    });
    await test('a-reste (japonais) : un nom lu en japonais se compare au nom JAPONAIS de la carte (produit.nomJa), SEULEMENT pour un tirage japonais ; jamais au nom anglais', () => {
        const ja = entree({ lu: { ...entree().lu, langue: 'ja', nom: 'すごいつりざお', numero: '018', total: '032' }, attendu: { ...entree().attendu, numero: '018' } });
        const pj = produit({ tirage: 'jp', numero: '018', nomEn: 'Super Rod', nomJa: 'すごいつりざお' });
        assert.deepStrictEqual(lue(ja, pj), { ok: true, motifs: [] });
        assert.deepStrictEqual(lue({ ...ja, lu: { ...ja.lu, nom: ' すごい つりざお ' } }, pj), { ok: true, motifs: [] }, 'espaces ignorés');
        assert.deepStrictEqual(lue({ ...ja, lu: { ...ja.lu, nom: 'ハイパーボール' } }, pj).motifs, ['nom-different'], 'autre nom japonais');
        assert.deepStrictEqual(lue(ja, produit({ tirage: 'jp', numero: '018', nomEn: 'Super Rod' })).motifs, ['nom-different'], 'carte sans nom japonais : rien à comparer = refus');
        assert.deepStrictEqual(lue(ja, produit({ tirage: 'jp', numero: '018', nomEn: 'すごいつりざお', nomJa: null })).motifs, ['nom-different'], 'un nom japonais ne se compare JAMAIS au nom anglais');
        assert.deepStrictEqual(lue({ ...ja, lu: { ...ja.lu, nom: '' } }, pj).motifs, ['nom-lu-hors-langue'], 'nom lu vide : aucun caractère de l\'écriture (contrôle A, 08/11)');
        assert.deepStrictEqual(lue({ ...ja, lu: { ...ja.lu, nom: '' } }, produit({ tirage: 'jp', numero: '018', nomEn: 'Super Rod', nomJa: null })).motifs, ['nom-lu-hors-langue'], 'vide contre vide : rien à comparer n\'est jamais une concordance');
        assert.deepStrictEqual(lue({ ...ja, lu: { ...ja.lu, nom: '・ ' } }, produit({ tirage: 'jp', numero: '018', nomEn: 'Super Rod', nomJa: ' ' })).motifs, ['nom-lu-hors-langue'], 'nom réduit à une ponctuation (point médian) : refus');
        const surIntl = lue(ja, produit({ tirage: 'intl', numero: '018', nomEn: 'Super Rod', nomJa: 'すごいつりざお' })).motifs.join();
        assert.match(surIntl, /langue-differente/); assert.match(surIntl, /nom-langue-non-anglaise/, 'produit NON japonais : le nom japonais n\'est jamais comparé, même si nomJa existe');
    });
    await test('tour 1 (1) : produit SANS numéro : lu.nom comparé au nom du produit (avant « [ », normalisation de la jointure), sinon nom-different ; avec numéro rien ne change', () => {
        const sans = produit({ numero: null, nomEn: 'Psyduck [Confusion Wave]' }), base = entree({ attendu: { ...entree().attendu, numero: null }, lu: { ...entree().lu, numero: null, total: null, nom: 'Psyduck' } });
        assert.strictEqual(lue(base, sans).ok, true);
        assert.strictEqual(lue({ ...base, lu: { ...base.lu, nom: ' PSYDUCK ' } }, sans).ok, true, 'casse et espaces ignorés (normaliserNom)');
        assert.match(lue({ ...base, lu: { ...base.lu, nom: 'Golduck' } }, sans).motifs.join(), /nom-different/);
        assert.match(lue({ ...base, lu: { ...base.lu, nom: '' } }, sans).motifs.join(), /nom-different/);
        assert.match(lue({ ...base, lu: { ...base.lu, nom: undefined } }, sans).motifs.join(), /nom-different/);
        assert.match(lue(base, produit({ numero: null, nomEn: null })).motifs.join(), /nom-different/, 'produit sans nom : rien à comparer = refus');
    });
    await test('tour 4 (1) : le nom est exigé AUSSI avec numéro (accents tolérés) ; autre nom = nom-different', () => {
        const nom = (n, p = {}) => lue(entree({ lu: { ...entree().lu, nom: n } }), produit({ nomEn: 'Pokégear 3.0', ...p }));
        assert.strictEqual(nom('Pokegear 3.0').ok, true, 'accent toléré');
        assert.strictEqual(nom('Pokégear 3.0').ok, true);
        assert.strictEqual(nom('POKEGEAR 3.0').ok, true);
        assert.match(nom('Pokegear 2.0').motifs.join(), /nom-different/);
        assert.match(nom('').motifs.join(), /nom-different/);
        assert.match(nom(undefined).motifs.join(), /nom-different/);
        assert.match(nom('Pokegear 3.0', { nomEn: null }).motifs.join(), /nom-different/);
        assert.match(lue(entree({ lu: { ...entree().lu, nom: 'Bulbasaur ex' } }), produit()).motifs.join(), /nom-different/, 'strict : « Bulbasaur » ≠ « Bulbasaur ex »');
    });
    await test('P2 : produit SANS numéro : marques non vides ET attendu.numero null, sinon refus ; lu.numero/total ne sont plus exigés', () => {
        const sans = produit({ numero: null }), e = entree({ attendu: { ...entree().attendu, numero: null }, lu: { ...entree().lu, numero: null, total: null, marques: ['tampon ex'] } });
        assert.strictEqual(lue(e, sans).ok, true);
        assert.match(lue({ ...e, attendu: { ...e.attendu, numero: '5' } }, sans).motifs.join(), /numero-attendu-non-null/);
        assert.match(lue({ ...e, lu: { ...e.lu, marques: [] } }, sans).motifs.join(), /marques-vides/);
        assert.strictEqual(lue(e, produit({ numero: '' })).ok, true, 'numéro vide = pas de numéro');
    });

    await test('tour 4 (3) : produit SANS numéro : lu.numero = le numéro en fin de slug quand il en porte un (frontière non alphanumérique) ; sinon inchangé', () => {
        const sans = slug => produit({ numero: null, slug });
        const e = (numero, o = {}) => entree({ attendu: { ...entree().attendu, numero: null }, lu: { ...entree().lu, numero, total: null, ...o } });
        assert.strictEqual(lue(e('114'), sans('Boss-s-Orders-Ghetsis-PPS8MEG-114')).ok, true);
        assert.strictEqual(lue(e('0114'), sans('Boss-s-Orders-Ghetsis-PPS8MEG-114')).ok, true, 'cleNumero');
        assert.match(lue(e('115'), sans('Boss-s-Orders-Ghetsis-PPS8MEG-114')).motifs.join(), /numero-different/);
        assert.match(lue(e(null), sans('Boss-s-Orders-Ghetsis-PPS8MEG-114')).motifs.join(), /numero-different/, 'numéro lu absent alors que le slug en porte un');
        assert.match(lue(e(''), sans('Pikachu-PPS8MEG-114')).motifs.join(), /numero-different/);
        assert.strictEqual(lue(e('21'), sans('Jigglypuff-CIN71')).ok, true, 'collé à des lettres : ce n\'est pas un numéro de slug, inchangé');
        assert.strictEqual(lue(e('21'), sans('Pikachu-V2')).ok, true);
        assert.strictEqual(lue(e(null), sans(null)).ok, true, 'sans slug : inchangé');
        assert.strictEqual(lue(e('150a'), sans('Pikachu-XYPR-150a')).ok, true);
        assert.match(lue(e('150'), sans('Pikachu-XYPR-150a')).motifs.join(), /numero-different/, 'suffixe compris');
    });
    await test('tour 4 (4) : préfixe de promo : le slug finit par le numéro lu AVEC frontière (le caractère qui précède n\'est pas un chiffre)', () => {
        const lu = entree({ lu: { ...entree().lu, numero: 'XY150a', total: null } });
        const P = slug => produit({ numero: '150a', slug });
        assert.strictEqual(lue(lu, P('Pikachu-V1-XYPRXY150a')).ok, true, 'le banc XYPRXY150A : « R » précède, pas un chiffre');
        assert.strictEqual(lue(lu, P('Pikachu-V1-XYPR-XY150a')).ok, true);
        assert.match(lue(lu, P('Pikachu-V1-1XY150a')).motifs.join(), /numero-different/, 'un chiffre précède : pas de frontière');
        assert.match(lue(lu, P('Pikachu-XY150a-Vxxxxx')).motifs.join(), /numero-different/, 'le numéro doit être en FIN de slug');
        assert.match(lue(lu, P('XY150a')).ok ? 'ok' : lue(lu, P('XY150a')).motifs.join(), /^ok$/, 'slug réduit au numéro : admis');
    });
    await test('tour 4 (5) : variante nommée (Blue Border / standard) <-> finition lue, table fermée ; finition absente = refus ; les autres variantes ne sont pas concernées', () => {
        const v = (variante, finition) => lue(entree({ attendu: { ...entree().attendu, variante }, lu: { ...entree().lu, finition } }));
        assert.strictEqual(v('Blue Border', 'blue-border').ok, true);
        assert.strictEqual(v('blue border', 'Blue-Border').ok, true);
        assert.strictEqual(v('standard', 'standard').ok, true);
        assert.match(v('Blue Border', 'standard').motifs.join(), /finition-different/);
        assert.match(v('standard', 'blue-border').motifs.join(), /finition-different/);
        assert.match(v('Blue Border', undefined).motifs.join(), /finition-absente/);
        assert.match(v('standard', '').motifs.join(), /finition-absente/);
        assert.strictEqual(v('V1', 'normale').ok, true, 'V1/V2 : autre mécanisme (paire nommée)');
        assert.strictEqual(v(null, undefined).ok, true);
    });
    await test('tour 3 (1) : `tamponnee` est le champ « reimpressions » du set — `metacarte` n\'est AUCUN tampon physique (table fermée valeur -> tampon attendu, inconnue = tampon-inconnu)', () => {
        assert.strictEqual(PV.TAMPONS_ATTENDUS.metacarte, null);
        assert.ok(Object.isFrozen(PV.TAMPONS_ATTENDUS));
        for (const v of ['wcd', 'pps', 'sea', 'pr', 'ppp', 'boo24', 'boo', 'boo23', 'pwc']) assert.strictEqual(PV.TAMPONS_ATTENDUS[v], v);
        for (const v of ['ba20', 'ba22', 'ba24']) assert.strictEqual(PV.TAMPONS_ATTENDUS[v], 'battle-academy', 'tour 4 : le tampon BA est le même pour les trois années');
        const lu = o => entree({ lu: { ...entree().lu, ...o } });
        // TK2 : produit « metacarte », scan sans tampon -> passe ; un tampon lu sur un produit « metacarte » -> refus
        assert.strictEqual(lue(entree(), produit({ tamponnee: 'metacarte' })).ok, true);
        assert.match(lue(lu({ tampon: 'metacarte' }), produit({ tamponnee: 'metacarte' })).motifs.join(), /tampon-different/);
        assert.match(lue(lu({ tampon: 'pps' }), produit({ tamponnee: 'metacarte' })).motifs.join(), /tampon-different/);
        // les vrais tampons restent comparés strictement
        assert.strictEqual(lue(lu({ tampon: 'pps' }), produit({ tamponnee: 'pps' })).ok, true);
        assert.match(lue(entree(), produit({ tamponnee: 'pps' })).motifs.join(), /tampon-different/);
        assert.match(lue(lu({ tampon: 'ba22' }), produit({ tamponnee: 'ba20' })).motifs.join(), /tampon-different/);
        // une valeur inconnue ne passe JAMAIS (ni sans tampon lu, ni avec le même mot)
        for (const v of ['zzz', 'Metacarte', 'prototype', '__proto__', 'constructor', 42]) {
            assert.match(lue(entree(), produit({ tamponnee: v })).motifs.join(), /tampon-inconnu/, String(v));
            assert.match(lue(lu({ tampon: String(v) }), produit({ tamponnee: v })).motifs.join(), /tampon-inconnu/, String(v));
        }
        assert.strictEqual(lue(entree(), produit({ tamponnee: null })).ok, true); assert.strictEqual(lue(entree(), produit({ tamponnee: undefined })).ok, true);
        assert.strictEqual(PV.tamponAttendu('metacarte').valeur, null);
    });
    await test('tour 3 (2) : préfixe de promo absent du produit (carte « XY150a », produit « 150a ») — admis SEULEMENT avec le slug du produit qui finit par le numéro lu AVEC son préfixe', () => {
        const lu = o => entree({ lu: { ...entree().lu, numero: 'XY150a', total: null, ...o } });
        const P = o => produit({ numero: '150a', slug: 'Pikachu-V1-XYPRXY150a', ...o });
        assert.strictEqual(lue(lu(), P()).ok, true);
        assert.strictEqual(lue(lu(), P({ slug: 'Pikachu-V1-XYPRXY150A' })).ok, true, 'casse ignorée');
        assert.match(lue(lu(), P({ slug: 'Pikachu-V1-XYPR150a' })).motifs.join(), /numero-different/, 'slug sans le préfixe lu');
        assert.match(lue(lu(), P({ slug: 'Pikachu-XY150a-V2' })).motifs.join(), /numero-different/, 'en FIN de slug');
        assert.match(lue(lu(), P({ slug: null })).motifs.join(), /numero-different/, 'sans slug : pas de témoin');
        assert.match(lue(lu(), P({ slug: undefined })).motifs.join(), /numero-different/);
        assert.match(lue(lu({ numero: 'XY151a' }), P()).motifs.join(), /numero-different/, 'chiffres différents');
        assert.match(lue(lu({ numero: 'XY150b' }), P({ slug: 'Pikachu-XYPRXY150b' })).motifs.join(), /numero-different/, 'suffixe différent');
        assert.match(lue(lu(), P({ numero: 'SM150a' })).motifs.join(), /numero-different/, 'le numéro du produit doit COMMENCER par un chiffre');
        assert.match(lue(lu({ numero: '150a' }), P()).motifs.join(), /numero-ou-total-absent/, 'un numéro lu sans préfixe est numérique : le total reste exigé');
        assert.strictEqual(lue(lu(), produit({ numero: 'XY150a', slug: 'Autre' })).ok, true, 'numéro égal d\'emblée : le slug ne sert pas');
        // la position garde sa règle : le repli de préfixe ne s'applique pas
        assert.match(lue(entree({ lu: { ...entree().lu, numero: '36', total: null, position: 'XY150a' } }), produit({ numero: '150a', slug: 'x-XY150a', slugSet: 'Battle-Academy-2022' })).motifs.join(), /numero-different/);
    });
    await test('tour 2 (1) : promo sans total — le total n\'est exigé que pour un numéro purement numérique (+ suffixe) ; un numéro à préfixe alphabétique se juge sans total, par cleNumero', () => {
        const promo = (n, o = {}) => entree({ lu: { ...entree().lu, numero: n, total: null, ...o } });
        assert.strictEqual(lue(promo('XY150a'), produit({ numero: 'XY150a' })).ok, true);
        assert.strictEqual(lue(promo('SM30a'), produit({ numero: 'SM030a' })).ok, true, 'cleNumero : zéros ignorés');
        assert.strictEqual(lue(promo('SM30', { total: '' }), produit({ numero: 'SM30' })).ok, true);
        assert.match(lue(promo('XY150a'), produit({ numero: 'XY177a' })).motifs.join(), /numero-different/, 'sans total, le numéro est quand même comparé');
        assert.match(lue(promo('13'), produit()).motifs.join(), /numero-ou-total-absent/, 'numérique sans total : refusé');
        assert.match(lue(promo('13a'), produit({ numero: '13a' })).motifs.join(), /numero-ou-total-absent/, 'numérique + suffixe sans total : refusé');
        assert.match(lue(promo(''), produit({ numero: 'XY150a' })).motifs.join(), /numero-ou-total-absent/);
        assert.match(lue(promo('150a'), produit({ numero: 'XY150a' })).motifs.join(), /numero-ou-total-absent/);
    });
    await test('tour 2 (2) : position de deck (lu.position) — comparée au numéro du produit, sans total, seulement pour Battle-Academy* et *Trainer-Kit*, ailleurs position-hors-liste', () => {
        // tour 4 (2) : le tampon BA est « battle-academy » (l'année ne se lit pas) ; la position doit être UNIQUE (position + nom) parmi les produits des sets BA / kits, et le numéro imprimé une impression de la carte
        const pos = (position, o = {}) => entree({ lu: { ...entree().lu, numero: '36', total: '236', tampon: 'battle-academy', position, ...o } });
        const imp = [{ numero: '36', total: '236' }];
        const cand = (...l) => l.map(([idProduct, numero, nomEn]) => ({ idProduct, numero, nomEn, slugSet: 'Battle-Academy-2022' }));
        const BA = produit({ numero: 'C36', slugSet: 'Battle-Academy-2022', tamponnee: 'ba22', impressions: imp, candidatsPosition: cand([1001, 'C36', 'Bulbasaur'], [1002, 'C36', 'Ivysaur'], [1003, 'P44', 'Bulbasaur']) });
        const TK = produit({ numero: 'N', slugSet: 'XY-Trainer-Kit-Latias-Latios', impressions: imp, candidatsPosition: cand([1001, 'N', 'Bulbasaur']) });
        assert.strictEqual(lue(pos('C36'), BA).ok, true);
        assert.strictEqual(lue(pos('c036'), BA).ok, true, 'cleNumero');
        assert.strictEqual(lue(pos('N', { tampon: null }), TK).ok, true);
        assert.match(lue(pos('C36', { numero: '999', total: '3' }), BA).motifs.join(), /numero-imprime-hors-carte/, 'le numéro imprimé doit être une impression de la carte');
        assert.match(lue(pos('C36', { total: '99' }), BA).motifs.join(), /numero-imprime-hors-carte/, 'et son total aussi');
        assert.match(lue(pos('C36', { numero: null }), BA).motifs.join(), /numero-imprime-hors-carte/);
        assert.strictEqual(lue(pos('C36', { total: null }), BA).ok, true, 'sans total lu, le numéro suffit');
        assert.match(lue(pos('C36'), { ...BA, impressions: undefined }).motifs.join(), /numero-imprime-hors-carte/, 'sans les impressions de la carte : refus');
        assert.match(lue(pos('C36'), { ...BA, candidatsPosition: undefined }).motifs.join(), /position-ambigue/, 'sans les produits du set : refus');
        assert.match(lue(pos('C36'), { ...BA, candidatsPosition: cand([1001, 'C36', 'Bulbasaur'], [2002, 'C36', 'Bulbasaur']) }).motifs.join(), /position-ambigue/, 'même position et même nom dans un autre set : ambigu');
        assert.match(lue(pos('C36'), { ...BA, candidatsPosition: cand([2002, 'C36', 'Bulbasaur']) }).motifs.join(), /position-ambigue/, 'l\'unique candidat n\'est pas ce produit');
        assert.match(lue(pos('C36', { nom: 'Ivysaur' }), BA).motifs.join(), /nom-different|position-ambigue/, 'un autre nom');
        assert.match(lue(pos('C36', { nom: 'Ivysaur' }), BA).motifs.join(), /nom-different/);
        assert.match(lue(pos('C36', { langue: 'fr' }), { ...BA, idExpansion: 2361 }).motifs.join(), /nom-different/, 'produit français sans nom français : refus');
        assert.match(lue(pos('C36', { langue: 'fr' }), BA).motifs.join(), /nom-langue-non-anglaise/);
        assert.match(lue(pos('C36', { tampon: null }), BA).motifs.join(), /tampon-different/, 'le tampon BA est « battle-academy » : absent = refus');
        assert.match(lue(pos('C36', { tampon: 'ba22' }), BA).motifs.join(), /tampon-different/, 'l\'année n\'est pas un tampon lu');
        assert.match(lue(pos('C37'), BA).motifs.join(), /numero-different/, 'position fausse');
        assert.match(lue(pos('C36'), produit({ numero: 'C36', slugSet: 'Autre-Set' })).motifs.join(), /position-hors-liste/);
        assert.match(lue(pos('C36'), produit({ numero: 'C36', slugSet: 'Mon-Battle-Academy' })).motifs.join(), /position-hors-liste/, 'préfixe, pas inclusion');
        assert.match(lue(pos('C36'), produit({ numero: null, slugSet: 'Battle-Academy-2022' })).motifs.join(), /position-sans-numero/);
        assert.match(lue(pos(''), BA).motifs.join(), /position-vide/, 'une position vide n\'est pas une position');
        assert.strictEqual(lue(entree(), produit({ slugSet: 'Autre-Set' })).ok, true, 'sans position, aucun effet sur les autres sets');
    });

    // ───────── P3 : la règle deux-sources ─────────
    const seconde = (o = {}) => ({ url: 'https://cdn.beta.example/b/1.png', hote: 'cdn.beta.example', fichier: 'C:\\x\\b.bin', sha256: H2, w: 400, h: 560, lu: { ...entree().lu }, ...o });
    const E2 = (o = {}) => entree({ regle: 'deux-sources', seconde: seconde(), ...o });
    const deux = async (e, octets, decider, p = produit()) => PV.evaluerDeuxSources({ entree: e, produit: p, langueProduit: PV.langueDuProduit(p), octets, decider });
    await test('P3 : la règle d\'image de production décide ; les tirages viennent du manifeste ; le produit fait foi', async () => {
        const appels = [];
        const oui = async arg => { appels.push(arg); return { decision: 'ecrire', preuve: { regle: 'strict', paireSources: arg.candidats.map(c => c.source) } }; };
        const r = await deux(E2(), { a: Buffer.from('A'), b: Buffer.from('B') }, oui);
        assert.strictEqual(r.ok, true);
        assert.deepStrictEqual(appels[0].produit, { langue: 'en', codeSet: null, numero: '13', tampon: null });
        assert.deepStrictEqual(appels[0].candidats.map(c => c.tirage), [{ langue: 'en', numero: '13', codeSet: null, tampon: null }, { langue: 'en', numero: '13', codeSet: null, tampon: null }]);
        assert.deepStrictEqual(appels[0].candidats.map(c => c.source), ['img.alpha.test', 'cdn.beta.example']);
        assert.deepStrictEqual(appels[0].scansConformes, []);
        // tour 1 (3) : la seconde lecture est OBLIGATOIRE et jugée comme la première (P2) ; la règle d'image n'est pas appelée sans elle
        const avant = appels.length;
        const m = async s => (await deux(E2({ seconde: seconde(s) }), { a: Buffer.from('A'), b: Buffer.from('B') }, oui)).motif;
        assert.strictEqual(await m({ lu: undefined }), 'deux-sources:seconde-sans-lecture');
        assert.strictEqual(await m({ lu: null }), 'deux-sources:seconde-sans-lecture');
        assert.match(await m({ lu: { ...entree().lu, numero: '14' } }), /^deux-sources:seconde-lecture:numero-different/);
        assert.match(await m({ lu: { ...entree().lu, langue: 'ja' } }), /seconde-lecture:langue-differente/);
        assert.match(await m({ lu: { ...entree().lu, tampon: 'pps' } }), /seconde-lecture:tampon-different/);
        assert.match(await m({ lu: { ...entree().lu, marques: [] } }), /seconde-lecture:marques-vides/);
        assert.strictEqual(appels.length, avant, 'jamais appelée sur une seconde lecture qui ne tient pas');
        const lu2 = E2({ seconde: seconde({ lu: { ...entree().lu, numero: '013' } }) });
        await deux(lu2, { a: Buffer.from('A'), b: Buffer.from('B') }, oui);
        assert.deepStrictEqual(appels[1].candidats.map(c => c.tirage.numero), ['13', '013'], 'chaque source porte SA lecture');
        const tamponne = E2({ lu: { ...entree().lu, tampon: 'pps' }, seconde: seconde({ lu: { ...entree().lu, tampon: 'pps' } }) });
        await deux(tamponne, { a: Buffer.from('A'), b: Buffer.from('B') }, oui, produit({ tamponnee: 'pps' }));
        assert.strictEqual(appels[2].produit.tampon, 'pps', 'le tampon du PRODUIT est transmis à la règle d\'image');
        assert.strictEqual(appels[2].candidats[0].tirage.tampon, 'pps', 'et celui que dit le manifeste pour la source');
        assert.strictEqual(appels[2].candidats[1].tirage.tampon, 'pps');
        const non = await deux(E2(), { a: Buffer.from('A'), b: Buffer.from('B') }, async () => ({ decision: 'trou', motif: 'discordance-image', preuve: {} }));
        assert.deepStrictEqual([non.ok, non.motif], [false, 'deux-sources:discordance-image']);
        const conf = await deux(E2(), { a: Buffer.from('A'), b: Buffer.from('B') }, async () => ({ decision: 'a-confirmer', preuve: {} }));
        assert.deepStrictEqual([conf.ok, conf.motif], [false, 'deux-sources:a-confirmer']);
    });
    await test('P3 : seconde absente, même hôte, même site, même sha256, octets identiques, contradictions = refus (la règle d\'image n\'est même pas appelée)', async () => {
        let n = 0; const oui = async () => { n++; return { decision: 'ecrire', preuve: {} }; };
        const o = { a: Buffer.from('A'), b: Buffer.from('B') };
        const m = async (e, oc = o) => (await deux(e, oc, oui)).motif;
        assert.match(await m(entree({ regle: 'deux-sources', seconde: null })), /seconde/);
        assert.match(await m(E2({ seconde: seconde({ hote: 'IMG.alpha.test' }) })), /meme-hote/);
        assert.match(await m(E2({ seconde: seconde({ hote: 'cdn.alpha.test' }) })), /meme-site/);
        assert.match(await m(E2({ seconde: seconde({ sha256: H1 }) })), /meme-sha256/);
        assert.match(await m(E2(), { a: Buffer.from('A'), b: Buffer.from('A') }), /memes-octets/);
        assert.strictEqual(await m(E2({ contradictions: ['x'] })), 'deux-sources:contradictions');
        assert.match(await m(E2(), { a: Buffer.from('A'), b: null }), /seconde-illisible/);
        assert.strictEqual((await deux(E2(), o, oui, produit({ tamponnee: 'zzz' }))).motif, 'deux-sources:tampon-inconnu');
        assert.strictEqual((await deux(E2(), o, oui, produit({ tamponnee: 'metacarte' }))).ok, true, 'metacarte = aucun tampon attendu');
        assert.strictEqual(n, 1, 'la règle d\'image n\'a été appelée que pour le cas metacarte');
    });
    await test('P3 : la chaîne RÉELLE (pHash + ORB) : deux encodages du même dessin = ecrire ; un autre dessin = refus', async () => {
        const IA = await fabrique(7).png().toBuffer(), IA2 = await sharp(IA).webp({ lossless: true }).toBuffer(), IB = await fabrique(99).png().toBuffer();
        const e = E2({ sha256: sha(IA), seconde: seconde({ sha256: sha(IA2) }) });
        const bon = await PV.evaluerDeuxSources({ entree: e, produit: produit(), langueProduit: 'en', octets: { a: IA, b: IA2 } });
        assert.strictEqual(bon.ok, true, JSON.stringify(bon));
        const mauvais = await PV.evaluerDeuxSources({ entree: E2({ sha256: sha(IA), seconde: seconde({ sha256: sha(IB) }) }), produit: produit(), langueProduit: 'en', octets: { a: IA, b: IB } });
        assert.strictEqual(mauvais.ok, false); assert.match(mauvais.motif, /^deux-sources:/);
        const autreNumero = await PV.evaluerDeuxSources({ entree: e, produit: produit({ numero: '14' }), langueProduit: 'en', octets: { a: IA, b: IA2 } });
        assert.strictEqual(autreNumero.ok, false, 'le produit fait foi : numéro lu ≠ numéro du produit');
    });
    // ───────── décision 5 du testeur (02/11) : les STAFF « SVP 006 » — code + numéro SANS total ─────────
    // Exception par ce qu'elle AUTORISE : liste fermée de sets (SV-Black-Star-Promos, code imprimé SVP) ; code imprimé lu = code du set, numéro lu = numéro du produit, slug du produit qui finit par ce code et ce numéro, ET deux sources.
    const SVP = (o = {}) => produit({ idProduct: 761120, numero: '006', slugSet: 'SV-Black-Star-Promos', slug: 'Pawmot-V2-SVP006', nomEn: 'Pawmot [Electrogenesis | Electro Paws]', ...o });
    const luSVP = (o = {}) => ({ nom: 'Pawmot', numero: '006', total: null, codeSet: 'SVP', langue: 'en', tampon: null, finition: 'scan de carte réelle', marques: ['SVP EN 006', 'mention STAFF'], ...o });
    const E2SVP = (premiere = {}, deuxieme = {}) => E2({ attendu: { nom: 'Pawmot', numero: '006', langue: 'en', tampon: null, variante: null }, lu: luSVP(premiere), seconde: seconde({ lu: luSVP(deuxieme) }) });
    await test('décision 5 : STAFF « SVP 006 » sur le produit 006 — admis à deux sources (code du set + numéro égal, sans total)', async () => {
        let appels = 0; const oui = async () => { appels++; return { decision: 'ecrire', preuve: { regle: 'strict' } }; };
        const o = { a: Buffer.from('A'), b: Buffer.from('B') };
        const r = await deux(E2SVP(), o, oui, SVP());
        assert.strictEqual(r.ok, true, JSON.stringify(r)); assert.strictEqual(appels, 1);
        assert.strictEqual((await deux(E2SVP({ numero: '6' }, { numero: '006' }), o, oui, SVP())).ok, true, 'zéros de tête ignorés (cleNumero)');
        const viaAiguillage = await PV.evaluerEntree({ entree: E2SVP(), produit: SVP(), octets: o, decider: oui });
        assert.deepStrictEqual([viaAiguillage.ok, viaAiguillage.regle], [true, 'deux-sources']);
    });
    await test('décision 5 : tout le reste reste refusé, avec son motif (numéro différent, code différent, une seule source, autre set)', async () => {
        let appels = 0; const oui = async () => { appels++; return { decision: 'ecrire', preuve: {} }; };
        const o = { a: Buffer.from('A'), b: Buffer.from('B') };
        const m = async (e, p = SVP()) => (await deux(e, o, oui, p)).motif ?? 'ADMIS';
        assert.match(await m(E2SVP({ numero: '007' }, { numero: '007' })), /numero-different/, 'SVP 007 sur le produit 006');
        assert.match(await m(E2SVP({}, { numero: '007' })), /seconde-lecture:numero-different/, 'la seconde lecture ne tient pas');
        assert.match(await m(E2SVP({ numero: '007' }, {})), /premiere-lecture:numero-different/, 'la première lecture ne tient pas');
        assert.match(await m(E2SVP({ codeSet: 'SV' }, { codeSet: 'SV' })), /numero-ou-total-absent/, '« SV 006 » : le code n\'est pas celui du set');
        assert.match(await m(E2SVP({ codeSet: 'PAR' }, { codeSet: 'PAR' })), /numero-ou-total-absent/, 'code d\'un autre set');
        assert.match(await m(E2SVP({ codeSet: 'svp' }, { codeSet: 'svp' })), /numero-ou-total-absent/, 'le code s\'égale à la lettre près');
        assert.match(await m(E2SVP({ codeSet: 'SVPX' }, { codeSet: 'SVPX' })), /numero-ou-total-absent/, 'pas d\'inclusion');
        assert.match(await m(E2SVP({ codeSet: undefined }, { codeSet: undefined })), /numero-ou-total-absent/, 'code non lu');
        assert.match(await m(E2SVP({}, { codeSet: 'SV' })), /seconde-lecture:numero-ou-total-absent/, 'les DEUX lectures portent le code');
        assert.match(await m(E2SVP({ codeSet: 'SV' }, {})), /premiere-lecture:numero-ou-total-absent/);
        // un autre set sans total : jamais admis, même avec un code qui ressemble
        assert.match(await m(E2SVP(), SVP({ slugSet: 'Set-A' })), /numero-ou-total-absent/, 'set hors de la liste fermée');
        assert.match(await m(E2SVP({ codeSet: 'SWSH' }, { codeSet: 'SWSH' }), SVP({ slugSet: 'SWSH-Black-Star-Promos', slug: 'Pawmot-V2-SWSH006' })), /numero-ou-total-absent/, 'autre set de promos');
        assert.match(await m(E2SVP(), SVP({ slugSet: 'sv-black-star-promos' })), /numero-ou-total-absent/, 'le slugSet s\'égale exactement');
        // le slug du produit est le témoin : il doit finir par ce code et ce numéro
        assert.match(await m(E2SVP(), SVP({ slug: 'Pawmot-V2' })), /numero-ou-total-absent/, 'slug sans code');
        assert.match(await m(E2SVP(), SVP({ slug: 'Pawmot-V2-SVE006' })), /numero-ou-total-absent/, 'slug d\'un autre code');
        assert.match(await m(E2SVP(), SVP({ slug: null })), /numero-ou-total-absent/, 'sans slug : pas de témoin');
        // le produit ne porte pas le numéro lu
        assert.match(await m(E2SVP(), SVP({ numero: '007', slug: 'Pawmot-V2-SVP007' })), /numero-different/, 'numéro du produit différent');
        // numéro lu non numérique : l'exception ne couvre que les chiffres
        assert.match(await m(E2SVP({ numero: '006a' }, { numero: '006a' }), SVP({ numero: '006a', slug: 'Pawmot-V2-SVP006a' })), /numero-ou-total-absent/);
        // une seule source : la règle preuve-lue ne tolère JAMAIS l'absence de total, même pour ce set
        const seule = PV.evaluerPreuveLue({ entree: entree({ lu: luSVP(), attendu: E2SVP().attendu }), produit: SVP(), langueProduit: 'en' });
        assert.strictEqual(seule.ok, false); assert.match(seule.motifs.join(), /numero-ou-total-absent/, 'une seule source : refus');
        const viaAiguillage = await PV.evaluerEntree({ entree: entree({ lu: luSVP(), attendu: E2SVP().attendu }), produit: SVP(), octets: o });
        assert.deepStrictEqual([viaAiguillage.ok, viaAiguillage.motif], [false, 'preuve-lue:numero-ou-total-absent']);
        // avec un total lu, rien ne change pour ce set : le total reste vérifié comme avant
        assert.strictEqual((await deux(E2SVP({ total: '198' }, { total: '198' }), o, oui, SVP())).ok, true);
        assert.strictEqual(appels, 1, 'la règle d\'image n\'est appelée que pour le seul cas admis (celui qui porte son total)');
    });
    await test('décision 5 (relecture) : le slug du produit est un témoin OBLIGATOIRE, même quand la ligne codes_set porte « SVP »', async () => {
        const lu = { numero: '006', codeSet: 'SVP' };
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'SVP' }), '006'), true, 'slug et codeSet concordent');
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'SVP', slug: 'Pawmot-V2' }), '006'), false, 'codeSet SVP, slug sans code');
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'SVP', slug: undefined }), '006'), false, 'codeSet SVP, slug absent');
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'SVP', slug: null }), '006'), false);
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'SVP', slug: 'Pawmot-V2-SVP007' }), '006'), false, 'codeSet SVP, slug d\'un autre numéro');
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'SVP', slug: 'Pawmot-V2-SVE006' }), '006'), false, 'slug d\'un autre code');
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'SVP', slug: 'Pawmot-V2-XSVP006' }), '006'), false, 'frontière : le code n\'est pas un suffixe de mot');
        assert.strictEqual(PV.sansTotalAdmis(lu, SVP({ codeSet: 'PAR' }), '006'), false, 'la ligne codes_set contredit le code lu : refus même avec le bon slug');
    });
    await test('evaluerEntree : aiguille par règle ; une règle inconnue est refusée', async () => {
        const a = await PV.evaluerEntree({ entree: entree(), produit: produit(), octets: {} });
        assert.deepStrictEqual([a.ok, a.regle], [true, 'preuve-lue']);
        const b = await PV.evaluerEntree({ entree: entree({ lu: { ...entree().lu, numero: '2' } }), produit: produit(), octets: {} });
        assert.deepStrictEqual([b.ok, b.motif], [false, 'preuve-lue:numero-different']);
        const c = await PV.evaluerEntree({ entree: entree({ regle: 'au-feeling' }), produit: produit(), octets: {} });
        assert.strictEqual(c.ok, false);
    });

    // ───────── P5 : les unités ─────────
    const accepte = (e, p, v) => ({ entree: e, validation: v ?? validation({ idProduct: e.idProduct, sha256: e.sha256 }), produit: p, langue: PV.langueDuProduit(p), evaluation: { ok: true, regle: e.regle } });
    // tour 1 (4) : la forme STRUCTURÉE que porte le manifeste réel : { source, fichier, dit, paire: { normale, holo } } — plus de regex sur `dit`
    const nommee = (paire = { normale: 1001, holo: 1002 }, o = {}) => ({ source: 'boutique-x', fichier: 'C:\\x\\11.ts', dit: 'normale = 1001 (V1), holo = 1002 (V2)', paire, ...o });
    const FICHE = (...ids) => new Map([['77|Set-A|13', ids]]);
    await test('tour 3 (1) : le tampon écrit sur l\'unité est le tampon attendu (null pour metacarte)', () => {
        const U = (tamponnee, lutampon) => PV.grouperUnites({ acceptees: [accepte(entree({ lu: { ...entree().lu, tampon: lutampon } }), produit({ tamponnee }))], fiches: new Map([['77|Set-A|13', [1001]]]), famille: 'F' }).unites[0];
        assert.strictEqual(U('metacarte', null).tampon, null);
        assert.strictEqual(U('pps', 'pps').tampon, 'pps');
    });
    await test('tour 2 (2) : lu.numero (imprimé) et lu.position restent écrits, énumérés, dans preuveLue', () => {
        const BA = produit({ numero: 'C36', slugSet: 'Battle-Academy-2022' });
        const e = entree({ lu: { ...entree().lu, numero: '36', total: null, position: 'C36' } });
        const { unites } = PV.grouperUnites({ acceptees: [accepte(e, BA)], fiches: new Map([[PV.cleFiche(BA), [1001]]]), famille: 'F' });
        assert.deepStrictEqual([unites[0].champsEntree.preuveLue.lu.numero, unites[0].champsEntree.preuveLue.lu.position], ['36', 'C36']);
    });
    await test('tour 1 (2) : AUCUN texte libre de l\'agent n\'est écrit : une note (et une marque) qui nomme une source n\'apparaît nulle part dans l\'entrée ni le document', async () => {
        const note = 'Scan Poképédia ; TCGdex et Cardmarket concordent', e = entree({ lu: { ...entree().lu, note, zzz: 'champ libre', finition: 'holo' }, sourcesConsultees: ['pokepedia.fr'], commentaire: 'libre' });
        const { unites } = PV.grouperUnites({ acceptees: [accepte(e, produit())], fiches: FICHE(1001), famille: 'MCD' });
        const p = unites[0].champsEntree.preuveLue;
        assert.deepStrictEqual(Object.keys(p).sort(), ['lu', 'luLe', 'marques', 'regle', 'valideLe']);
        assert.deepStrictEqual(Object.keys(p.lu).sort(), ['finition', 'langue', 'nom', 'numero', 'position', 'tampon', 'total']);
        const tout = JSON.stringify(unites[0]);
        for (const mot of ['Poképédia', 'TCGdex', 'Cardmarket', 'champ libre', 'commentaire', 'pokepedia']) assert.ok(!tout.includes(mot), `« ${mot} » ne doit pas figurer dans l'unité`);
        // une marque qui nomme une source est refusée (ce qu'on écrit ne doit pas la nommer)
        const nomme = PV.evaluerPreuveLue({ entree: entree({ lu: { ...entree().lu, marques: ['13/40', 'filigrane Poképédia'] } }), produit: produit(), langueProduit: 'en' });
        assert.match(nomme.motifs.join(), /marque-nomme-une-source/);
    });
    await test('P5 : un produit seul sur sa fiche = une unité (champs de l\'écriture, adresse neutre, preuve écrite)', () => {
        const { unites, refus } = PV.grouperUnites({ acceptees: [accepte(entree(), produit())], fiches: FICHE(1001), famille: 'MCD' });
        assert.deepStrictEqual(refus, []); assert.strictEqual(unites.length, 1);
        const u = unites[0];
        assert.deepStrictEqual([u.carteId, u.slugSet, u.numero, u.produits, u.url, u.langue, u.tampon, u.tirageAttendu, u.groupe], [77, 'Set-A', '13', [1001], 'https://img.alpha.test/a/1.png', 'en', null, 'intl', 'MCD']);
        assert.strictEqual(u.champsEntree.partageeHoloNonHolo, undefined);
        const p = u.champsEntree.preuveLue;
        assert.deepStrictEqual([p.regle, p.marques, p.luLe, p.valideLe, p.lu.total], ['preuve-lue', ['13/40', 'texte anglais'], '2026-10-26T10:00:00.000Z', '2026-10-26T12:00:00.000Z', '40']);
        assert.deepStrictEqual(u.champsDocument.preuveLue, p);
        assert.strictEqual(u.languePreuve, 'lue sur le scan : n° 13/40 ; finition normale', 'tour 4 (6) : des champs énumérés, jamais les marques');
        assert.ok(!/alpha|boutique|hote/i.test(u.languePreuve + u.preuveNeutre), 'aucun nom de source dans le texte écrit');
        assert.strictEqual(u.sha256, H1);
    });
    await test('P5 : V1/V2 sur une même fiche : ni l\'un sans l\'autre, ni sans variante nommée holo, ni à sha256 différent', () => {
        const p1 = produit({ idProduct: 1001 }), p2 = produit({ idProduct: 1002 });
        const e1 = entree({ varianteNommee: nommee() }), e2 = entree({ idProduct: 1002, varianteNommee: nommee() });
        const ok2 = PV.grouperUnites({ acceptees: [accepte(e1, p1), accepte(e2, p2)], fiches: FICHE(1001, 1002), famille: 'F' });
        assert.deepStrictEqual(ok2.refus, []); assert.strictEqual(ok2.unites.length, 1);
        const u = ok2.unites[0];
        assert.deepStrictEqual(u.produits, [1001, 1002]);
        assert.strictEqual(u.champsEntree.partageeHoloNonHolo, true); assert.deepStrictEqual(u.champsEntree.produitsPartages, [1001, 1002]);
        assert.strictEqual(u.champsDocument.partageeHoloNonHolo, true); assert.deepStrictEqual(u.champsDocument.produitsPartages, [1001, 1002]);
        assert.deepStrictEqual(u.champsDocument.paireHoloNonHolo, { normale: 1001, holo: 1002 }, 'seule la paire structurée est gardée, jamais le texte libre de la source');
        assert.ok(!JSON.stringify([u.champsEntree, u.champsDocument]).includes('boutique-x'), 'ni la source ni son texte dans ce qui s\'écrit');
        const refuse = (acc, fiche = FICHE(1001, 1002)) => PV.grouperUnites({ acceptees: acc, fiches: fiche, famille: 'F' });
        const seul = refuse([accepte(e1, p1)]);
        assert.strictEqual(seul.unites.length, 0); assert.deepStrictEqual(seul.refus.map(x => [x.idProduct, x.motif]), [[1001, 'variantes-indiscernables']]);
        const sansNom = refuse([accepte(entree(), p1), accepte(entree({ idProduct: 1002 }), p2)]);
        assert.strictEqual(sansNom.unites.length, 0); assert.deepStrictEqual(sansNom.refus.map(x => x.motif), ['variantes-indiscernables', 'variantes-indiscernables']);
        const paires = (pa, o) => refuse([accepte(entree({ varianteNommee: nommee(pa, o) }), p1), accepte(entree({ idProduct: 1002, varianteNommee: nommee(pa, o) }), p2)]);
        for (const [nom, pa] of [['ids hors de la fiche', { normale: 1001, holo: 1555 }], ['même produit deux fois', { normale: 1001, holo: 1001 }], ['sans holo', { normale: 1001 }], ['sans normale', { holo: 1002 }], ['ids en texte', { normale: '1001', holo: '1002' }], ['paire absente', null], ['paire en liste', [1001, 1002]]])
            assert.strictEqual(paires(pa).unites.length, 0, `la paire doit désigner EXACTEMENT les produits de la fiche : ${nom}`);
        assert.strictEqual(paires({ normale: 1002, holo: 1001 }).unites.length, 1, 'le sens est celui de la source (V2 normale, V1 holo si elle le dit), pas un ordre deviné');
        assert.strictEqual(paires({ normale: 1001, holo: 1002 }, { source: '' }).unites.length, 0, 'une source qui ne se nomme pas ne prouve rien');
        assert.strictEqual(paires({ normale: 1001, holo: 1002 }, { dit: undefined }).unites.length, 1, 'le texte libre n\'est plus lu');
        const autrePaire = refuse([accepte(entree({ varianteNommee: nommee() }), p1), accepte(entree({ idProduct: 1002, varianteNommee: nommee({ normale: 1002, holo: 1001 }) }), p2)]);
        assert.strictEqual(autrePaire.unites.length, 0, 'les deux entrées doivent dire la même chose');
        const autreSha = refuse([accepte(e1, p1), accepte({ ...e2, sha256: H2 }, p2)]);
        assert.strictEqual(autreSha.unites.length, 0); assert.ok(autreSha.refus.every(x => x.motif === 'variantes-indiscernables'));
        const trois = refuse([accepte(e1, p1), accepte(e2, p2), accepte(entree({ idProduct: 1003, varianteNommee: nommee() }), produit({ idProduct: 1003 }))], FICHE(1001, 1002, 1003));
        assert.strictEqual(trois.unites.length, 0, 'seule une PAIRE holo / non holo est prouvable');
        assert.ok(trois.refus.every(x => /3 produits sur la fiche/.test(x.detail)), 'refusé pour son effectif, pas pour une paire mal nommée');
        const autreFiche = refuse([accepte(e1, p1), accepte(e2, p2)], FICHE(1001, 1002, 1555));
        assert.strictEqual(autreFiche.unites.length, 0, 'un produit de la fiche qui n\'a aucune entrée validée : refus de tous');
    });
    await test('P5 : un produit joint à une fiche inconnue des lignes, ou langue/tampon incohérents dans une paire = refus', () => {
        const p1 = produit({ idProduct: 1001 }), p2 = produit({ idProduct: 1002, tamponnee: 'pps' });
        const e1 = entree({ varianteNommee: nommee() }), e2 = entree({ idProduct: 1002, varianteNommee: nommee(), lu: { ...entree().lu, tampon: 'pps' } });
        const r = PV.grouperUnites({ acceptees: [accepte(e1, p1), accepte(e2, p2)], fiches: FICHE(1001, 1002), famille: 'F' });
        assert.strictEqual(r.unites.length, 0); assert.ok(r.refus.every(x => x.motif === 'unite-incoherente'));
        const orphelin = PV.grouperUnites({ acceptees: [accepte(entree(), produit({ carteId: 5 }))], fiches: FICHE(1001), famille: 'F' });
        assert.strictEqual(orphelin.unites.length, 0); assert.strictEqual(orphelin.refus[0].motif, 'fiche-inconnue');
    });

    // ───────── P9 : les trous du manifeste ─────────
    await test('P9 : trous du manifeste -> trous nommés (motifs FERMÉS, hôtes interrogés, date) ; un produit qui reçoit un visuel n\'a pas de trou', () => {
        const trou = (o = {}) => ({ idProduct: 2001, motif: 'aucune-source', interroges: ['alpha.test', 'beta.example'], date: '2026-10-26T09:00:00.000Z', detail: 'rien', ...o });
        const r = PV.trousDuManifeste({ trous: [trou(), trou({ idProduct: 2002, motif: 'variantes-indiscernables' }), trou({ idProduct: 2003, motif: 'source-bloquee:www.exemple-boutique.com' }), trou({ idProduct: 1001 })], recus: new Set([1001]), famille: 'F' });
        assert.deepStrictEqual(r.trous.map(t => [t.idProduct, t.motif]), [[2001, 'aucune-source'], [2002, 'variantes-indiscernables'], [2003, 'source-bloquee:wwwexempleboutiquecom']]);
        assert.deepStrictEqual(r.ecartes.map(x => [x.idProduct, x.motif]), [[1001, 'visuel-recu']]);
        const t = r.trous[0];
        assert.deepStrictEqual(t.sources, ['alpha.test', 'beta.example']);
        assert.deepStrictEqual([t.preuve.interroges, t.preuve.date, t.preuve.famille, t.preuve.instrument], [['alpha.test', 'beta.example'], '2026-10-26T09:00:00.000Z', 'F', 'preuves-validees']);
        assert.ok(t.le instanceof Date);
        for (const t2 of r.trous) CO.construireTrou(t2);              // la forme de production l'accepte
        assert.throws(() => PV.trousDuManifeste({ trous: [trou({ motif: 'au-feeling' })], recus: new Set(), famille: 'F' }), /motif/);
        assert.throws(() => PV.trousDuManifeste({ trous: [trou({ interroges: [] })], recus: new Set(), famille: 'F' }), /interroges/);
        assert.throws(() => PV.trousDuManifeste({ trous: [trou({ date: 'hier' })], recus: new Set(), famille: 'F' }), /date/);
        assert.throws(() => PV.trousDuManifeste({ trous: [trou({ idProduct: 5 }), trou({ idProduct: 5 })], recus: new Set(), famille: 'F' }), /doublon/);
    });
    await test('P9 : le motif variantes-indiscernables est admis par comblement.js (motif fermé)', () => {
        assert.ok(CO.MOTIFS.includes('variantes-indiscernables')); assert.ok(CO.motifAdmis('variantes-indiscernables'));
        assert.ok(!CO.motifAdmis('variantes-indiscernables '));
    });

    // ───────── P8 : le cache ─────────
    const poserAuCache = (dossier, url, octets, meta = {}) => {
        fs.mkdirSync(dossier, { recursive: true });
        const f = path.join(dossier, HOTE.nomCache(url)), fb = f.replace(/\.json$/, '.bin');
        fs.writeFileSync(fb, octets); fs.writeFileSync(f, JSON.stringify({ url, statut: 'ok', status: 200, type: 'image/png', octets: octets.length, sha256: sha(octets), le: '2026-10-26T08:00:00.000Z', ...meta }));
        return fb;
    };
    await test('P8 : le cache est relu, jamais cru : sha256 du manifeste, de la fiche du cache et du fichier cité ; image décodable, forme de carte, largeur', async () => {
        const dossier = tmp(), octets = await png(400, 560), url = 'https://img.alpha.test/a/1.png';
        const fb = poserAuCache(dossier, url, octets);
        const e = entree({ url, sha256: sha(octets), fichier: fb });
        const bon = await PV.verifierCache({ entree: e, dossierCache: dossier });
        assert.deepStrictEqual([bon.ok, bon.jugement.statut, bon.jugement.w], [true, 'ok', 400]);
        assert.match((await PV.verifierCache({ entree: { ...e, sha256: H1 }, dossierCache: dossier })).motif, /cache-sha256-different/);
        assert.match((await PV.verifierCache({ entree: { ...e, url: 'https://img.alpha.test/a/2.png' }, dossierCache: dossier })).motif, /cache-absent/);
        assert.match((await PV.verifierCache({ entree: { ...e, fichier: path.join(dossier, 'inexistant.bin') }, dossierCache: dossier })).motif, /fichier-illisible/);
        const autre = path.join(dossier, 'autre.bin'); fs.writeFileSync(autre, Buffer.from('autre chose'));
        assert.match((await PV.verifierCache({ entree: { ...e, fichier: autre }, dossierCache: dossier })).motif, /fichier-different/);
        // la fiche du cache dit un autre sha256 que les octets (cache altéré)
        const d2 = tmp(), fb2 = poserAuCache(d2, url, octets, { sha256: H3 });
        assert.match((await PV.verifierCache({ entree: { ...e, fichier: fb2 }, dossierCache: d2 })).motif, /cache-altere/);
        // 200 px ≤ largeur < 350 : admise, basse définition ; < 200 : refus ; carré : refus
        const d3 = tmp(), petit = await png(260, 364), u3 = 'https://img.alpha.test/a/3.png', f3 = poserAuCache(d3, u3, petit);
        const r3 = await PV.verifierCache({ entree: entree({ url: u3, sha256: sha(petit), fichier: f3 }), dossierCache: d3 });
        assert.deepStrictEqual([r3.ok, r3.jugement.statut], [true, 'trop-petit']);
        assert.strictEqual(r3.basseDefinition, true);
        const d4 = tmp(), mini = await png(150, 210), u4 = 'https://img.alpha.test/a/4.png', f4 = poserAuCache(d4, u4, mini);
        const r4 = await PV.verifierCache({ entree: entree({ url: u4, sha256: sha(mini), fichier: f4 }), dossierCache: d4 });
        assert.deepStrictEqual([r4.ok, r4.motif], [false, 'trop-petit']);
        const d5 = tmp(), carre = await png(400, 400), u5 = 'https://img.alpha.test/a/5.png', f5 = poserAuCache(d5, u5, carre);
        assert.match((await PV.verifierCache({ entree: entree({ url: u5, sha256: sha(carre), fichier: f5 }), dossierCache: d5 })).motif, /forme-inattendue/);
        const d6 = tmp(), faux = Buffer.from('pas une image du tout'), u6 = 'https://img.alpha.test/a/6.png', f6 = poserAuCache(d6, u6, faux);
        assert.match((await PV.verifierCache({ entree: entree({ url: u6, sha256: sha(faux), fichier: f6 }), dossierCache: d6 })).motif, /illisible/);
    });

    // ───────── le descripteur de source : adresse publique NEUTRE (P6) ─────────
    await test('P6 : source prv, lot prv-2026-10, clé R2 prv/<set>/<num>-<carte>-<langue>.webp ; aucun nom de source ; la langue vient de l\'unité', () => {
        const S = PV.SRC;
        assert.deepStrictEqual([S.SOURCE, S.LOT, S.parUnite], ['prv', 'prv-2026-10', true]);
        assert.strictEqual(S.cleR2('Set-A', '013', 77, 'fr'), 'prv/Set-A/013-77-fr.webp');
        assert.strictEqual(S.idImage('Set-A', 77, '013', 'fr'), 'prv/Set-A/77/013/fr');
        assert.strictEqual(S.cleR2('Set-A', '013', 77, 'en') !== S.cleR2('Set-A', '013', 77, 'fr'), true);
        for (const v of [S.SOURCE, S.LOT, S.LANGUE_PREUVE, S.CHAMP_BILAN, S.MENTION]) assert.ok(!/pokipair|poki|tcgcsv|scrydex|packmagik|pokellector|pokumon|pikaqian|cardtrader|bulbapedia|tcgdex|artofpkm|pokedata|pkmncards|cardmarket/i.test(v), v);
        assert.throws(() => S.cleR2('Set-A', '013', 77), /langue/, 'une source par unité ne devine jamais la langue');
        assert.throws(() => S.idImage('Set-A', 77, '013'), /langue/);
    });

    // ───────── l'écriture, sur de FAUX modèles (la règle commune, étendue par unité) ─────────
    const SLUG = 'Set-A';
    async function monter({ unitesDef, cartes, sets = [{ _id: SLUG, tirage: 'intl' }], images = [], largeur = 400 }) {
        const dossier = tmp(), idx = {}, us = [];
        for (const d of unitesDef) {
            const octets = await png(d.largeur ?? largeur, Math.round((d.largeur ?? largeur) * 1.4)), url = d.url ?? `https://img.alpha.test/a/${d.carteId}.png`;
            const fb = poserAuCache(dossier, url, octets);
            const p = produit({ idProduct: d.idProduct ?? 1000 + d.carteId, carteId: d.carteId, numero: d.numero ?? '13', idExpansion: d.idExpansion ?? 5000, tirage: d.tirage ?? 'intl', tamponnee: d.tamponnee ?? null });
            const lu = { ...entree().lu, numero: p.numero, langue: d.langue ?? PV.langueDuProduit(p), ...(d.lu ?? {}) };
            const e = entree({ idProduct: p.idProduct, url, sha256: sha(octets), fichier: fb, lu });
            const { unites } = PV.grouperUnites({ acceptees: [accepte(e, p)], fiches: new Map([[`${p.carteId}|${SLUG}|${p.numero}`, [p.idProduct]]]), famille: 'MCD' });
            for (const u of unites) { us.push(u); idx[u.url] = { ...(await RC.juger(PV.SRC, octets)), octets: octets.length, sha256: sha(octets) }; }
        }
        const { M, etat, journal } = fauxModeles({ cartes, sets, images });
        const deposes = [];
        return { dossier, us, idx, M, etat, journal, deposes, deposer: async (b, c) => { deposes.push(c); }, vignetter: async () => ({ vg: { entrees: 0, fabriquees: 0, echecs: 0 } }) };
    }
    const ecrire = (m, o = {}) => RC.ecrire({ SRC: PV.SRC, unites: m.us, M: m.M, dossierCache: m.dossier, indexImages: m.idx, deposer: m.deposer, vignetter: m.vignetter, ...o });
    const vide = id => ({ _id: id, images: [] });

    await test('écriture : l\'entrée et le document portent langue, preuve de langue, preuveLue ; clé R2 neutre ; traçabilité ; bilan du set vérifié', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100, numero: '13' }], cartes: [vide(100)] });
        const [r] = await SILENCE(() => ecrire(m, { attendu: 1 }));
        assert.strictEqual(r.code, 0); assert.strictEqual(r.reel, 1); assert.strictEqual(r.resultats[0].etat, 'verifie');
        const e = m.etat.carte(100).images[0];
        assert.deepStrictEqual([e.source, e.lot, e.retirable, e.langue, e.numero, e.set, e.urlOriginal, e.cleR2], ['prv', 'prv-2026-10', true, 'en', '13', SLUG, m.us[0].url, `prv/${SLUG}/13-100-en.webp`]);
        assert.strictEqual(e.languePreuve, 'lue sur le scan : n° 13/40 ; finition normale');
        assert.ok(!e.languePreuve.includes('anglais'), 'aucune marque (texte libre) dans la preuve de langue');
        assert.strictEqual(e.preuveLue.regle, 'preuve-lue'); assert.deepStrictEqual(e.preuveLue.marques, ['13/40', 'texte anglais']); assert.ok(e.preuveLue.valideLe && e.preuveLue.luLe);
        assert.strictEqual(e.mention, '© Pokémon / The Pokémon Company');
        assert.deepStrictEqual(m.deposes, [`prv/${SLUG}/13-100-en.webp`]);
        const d = m.etat.image(`prv/${SLUG}/100/13/en`);
        assert.deepStrictEqual([d.source, d.lot, d.langue, d.langueSource, d.etat, d.idProduct], ['prv', 'prv-2026-10', 'en', 'en', 'ok', 1100]);
        assert.deepStrictEqual(d.preuveLue, e.preuveLue); assert.strictEqual(d.languePreuve, e.languePreuve);
        assert.strictEqual(m.etat.set(SLUG).bilanLotPrv.concordance, true);
    });
    await test('écriture : une édition française (2361) s\'écrit en fr (clé, entrée, document), sous un set intl', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100, idExpansion: 2361 }], cartes: [vide(100)] });
        assert.strictEqual(m.us[0].langue, 'fr');
        const [r] = await SILENCE(() => ecrire(m, { attendu: 1 }));
        assert.strictEqual(r.code, 0);
        const e = m.etat.carte(100).images[0];
        assert.deepStrictEqual([e.langue, e.cleR2], ['fr', `prv/${SLUG}/13-100-fr.webp`]);
        assert.strictEqual(m.etat.image(`prv/${SLUG}/100/13/fr`).langue, 'fr');
    });
    await test('écriture : un set d\'un AUTRE tirage que celui du produit refuse tout (tirage attendu par unité)', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100 }], cartes: [vide(100)], sets: [{ _id: SLUG, tirage: 'jp' }] });
        const [r] = await SILENCE(() => ecrire(m, { attendu: 1 }));
        assert.strictEqual(r.resultats[0].etat, 'refuse-set'); assert.match(r.resultats[0].erreur, /tirage/); assert.deepStrictEqual(m.deposes, []);
        assert.strictEqual(m.etat.carte(100).images.length, 0);
    });
    await test('écriture : une unité sans langue ou sans tirage attendu LÈVE (rien n\'est deviné)', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100 }], cartes: [vide(100)] });
        delete m.us[0].langue;
        await assert.rejects(() => SILENCE(() => ecrire(m, { attendu: 1 })), /langue/);
        const m2 = await monter({ unitesDef: [{ carteId: 100 }], cartes: [vide(100)] });
        delete m2.us[0].tirageAttendu;
        const [r] = await SILENCE(() => ecrire(m2, { attendu: 1 }).catch(e => ({ leve: e.message })));
        assert.ok(r.leve ? /tirage/.test(r.leve) : r.resultats[0].etat === 'refuse-set');
        assert.strictEqual(m2.etat.carte(100).images.length, 0);
    });
    await test('écriture : --attendu faux = rien écrit ; --attendu exact obligatoire (réel compté depuis le cache)', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100 }, { carteId: 101 }], cartes: [vide(100), vide(101)] });
        const [r] = await SILENCE(() => ecrire(m, { attendu: 1 }));
        assert.strictEqual(r.code, 2); assert.strictEqual(r.reel, 2); assert.deepStrictEqual(m.deposes, []);
        const [c] = await SILENCE(() => ecrire(m, { compterSeulement: true }));
        assert.strictEqual(c.reel, 2);
    });
    await test('écriture : une image dont le sha256 ne correspond plus (cache altéré) n\'est pas écrite', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100 }], cartes: [vide(100)] });
        fs.writeFileSync(path.join(m.dossier, HOTE.nomCache(m.us[0].url)).replace(/\.json$/, '.bin'), await png(400, 560, { r: 1, g: 2, b: 3 }));
        const [r] = await SILENCE(() => ecrire(m, { compterSeulement: true }));
        assert.strictEqual(r.reel, 0); assert.strictEqual(r.altere, 1);
    });
    await test('P8 : sous 350 px (≥ 200) = basse définition marquée, dans le lot --basse-definition seulement ; sous 200 jamais', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100, largeur: 260 }, { carteId: 101, largeur: 400 }], cartes: [vide(100), vide(101)] });
        const [normal] = await SILENCE(() => ecrire(m, { compterSeulement: true }));
        assert.strictEqual(normal.reel, 1, 'le lot ordinaire ne prend que les images au seuil');
        const [basse] = await SILENCE(() => ecrire(m, { compterSeulement: true, basseDefinition: true }));
        assert.strictEqual(basse.reel, 1);
        const [r] = await SILENCE(() => ecrire(m, { attendu: 1, basseDefinition: true }));
        assert.strictEqual(r.code, 0);
        const e = m.etat.carte(100).images[0];
        assert.strictEqual(e.basseDefinition, true); assert.strictEqual(e.wOriginal, 260);
        assert.strictEqual(m.etat.carte(101).images.length, 0);
        assert.strictEqual(require('./collecte-cartes/seuils-images').largeurAdmiseDe('prv'), 200);
        assert.strictEqual(require('./collecte-cartes/seuils-images').largeurMinDe('prv'), 350);
    });
    await test('tour 1 (2) de bout en bout : la note d\'un agent qui nomme des sources n\'arrive ni sur l\'entrée cartes.images ni sur le document images', async () => {
        const note = 'Scan Poképédia ; TCGdex et Cardmarket concordent';
        const m = await monter({ unitesDef: [{ carteId: 100, lu: { note, autre: 'libre' } }], cartes: [vide(100)] });
        await SILENCE(() => ecrire(m, { attendu: 1 }));
        const ecrit = JSON.stringify([m.etat.carte(100), m.etat.image(`prv/${SLUG}/100/13/en`)]);
        assert.ok(ecrit.includes('preuveLue'));
        for (const mot of ['Poképédia', 'TCGdex', 'Cardmarket', 'note', 'libre']) assert.ok(!ecrit.includes(mot), `« ${mot} » dans la base`);
    });
    await test('écriture : le tampon du PRODUIT passe sur l\'entrée et le document (un tampon n\'est jamais perdu en route)', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100, tamponnee: 'pps' }], cartes: [vide(100)] });
        assert.strictEqual(m.us[0].tampon, 'pps');
        const [r] = await SILENCE(() => ecrire(m, { attendu: 1 }));
        assert.strictEqual(r.code, 0);
        assert.strictEqual(m.etat.carte(100).images[0].tampon, 'pps'); assert.strictEqual(m.etat.image(`prv/${SLUG}/100/13/en`).tampon, 'pps');
        const m2 = await monter({ unitesDef: [{ carteId: 100 }], cartes: [vide(100)] });
        await SILENCE(() => ecrire(m2, { attendu: 1 }));
        assert.strictEqual(m2.etat.carte(100).images[0].tampon, undefined, 'produit sans tampon : aucun tampon écrit');
    });
    await test('écriture : la paire V1/V2 porte le marquage de l\'API sur l\'entrée ET le document (partageeHoloNonHolo + produitsPartages)', async () => {
        const dossier = tmp(), octets = await png(400, 560), url = 'https://img.alpha.test/a/pair.png', fb = poserAuCache(dossier, url, octets);
        const p1 = produit({ idProduct: 1001, carteId: 100 }), p2 = produit({ idProduct: 1002, carteId: 100 });
        const mk = (p) => entree({ idProduct: p.idProduct, url, sha256: sha(octets), fichier: fb, varianteNommee: nommee() });
        const { unites } = PV.grouperUnites({ acceptees: [accepte(mk(p1), p1), accepte(mk(p2), p2)], fiches: new Map([[`100|${SLUG}|13`, [1001, 1002]]]), famille: 'F' });
        const { M, etat } = fauxModeles({ cartes: [vide(100)], sets: [{ _id: SLUG, tirage: 'intl' }] });
        const idx = { [url]: { ...(await RC.juger(PV.SRC, octets)), octets: octets.length, sha256: sha(octets) } };
        const [r] = await SILENCE(() => RC.ecrire({ SRC: PV.SRC, unites, M, dossierCache: dossier, indexImages: idx, attendu: 1, deposer: async () => {}, vignetter: async () => ({ vg: {} }) }));
        assert.strictEqual(r.code, 0);
        const e = etat.carte(100).images[0], d = etat.image(`prv/${SLUG}/100/13/en`);
        for (const x of [e, d]) { assert.strictEqual(x.partageeHoloNonHolo, true); assert.deepStrictEqual(x.produitsPartages, [1001, 1002]); }
        assert.deepStrictEqual(d.produits, [1001, 1002]);
        // la garde du contrat de l'API lit ce marquage tel quel (lireEntree) : forme exacte attendue
        const API = 'C:/Users/Yung/Desktop/pokemon-proxy-api-v2/v2/identifier/visuels.js';
        if (fs.existsSync(API)) {
            const { lireEntree } = require(API);
            const r1 = lireEntree({ idProduct: 1001, vignette: { cle: 'v/x.webp', w: 100, h: 140 }, grande: { cle: e.cleR2, w: e.w, h: e.h }, idMetacard: null, numero: '13', rarete: null, total: 40, partageeHoloNonHolo: true, produitsPartages: e.produitsPartages });
            assert.ok(r1.ok || !/partage|produitsPartages/.test(r1.motif ?? ''), r1.motif);
        }
    });
    await test('écriture : un visuel retiré ne revient pas ; une image déjà servie par une autre source correcte cède', async () => {
        const m = await monter({ unitesDef: [{ carteId: 100 }], cartes: [vide(100)], images: [{ _id: `prv/${SLUG}/100/13/en`, source: 'prv', etat: 'retire', carteId: 100 }] });
        const [r] = await SILENCE(() => ecrire(m, { compterSeulement: true }));
        assert.strictEqual(r.reel, 0); assert.strictEqual(r.retires, 1);
        const m2 = await monter({ unitesDef: [{ carteId: 100 }], cartes: [{ _id: 100, images: [{ set: SLUG, source: 'tcgdex', cleR2: 'td/100', numero: '13', langue: 'en', w: 600, wOriginal: 600 }] }], images: [{ _id: 'td-100', source: 'tcgdex', set: SLUG, cleR2: 'td/100', carteId: 100, etat: 'ok' }] });
        const dec = await RC.decider(PV.SRC, m2.us, RC.lecteurModeles(m2.M));
        assert.strictEqual(dec[0].decision.action, 'cede');
    });

    // ───────── le plan, sur une FAUSSE base ─────────
    const K = require('./collecteur-images-preuves');
    function monde({ entrees, validations, produits = {}, etat, lignes, sets = [{ _id: SLUG, tirage: 'intl' }], cartes, famille = 'MCD', trous = [], positions = [], impressionsDe = {}, codesSet = [] }) {
        const racine = tmp(), cache = path.join(racine, 'CACHE');
        fs.mkdirSync(path.join(racine, famille), { recursive: true }); fs.mkdirSync(path.join(racine, 'VALIDATIONS'), { recursive: true }); fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(path.join(racine, famille, 'preuves.json'), JSON.stringify({ famille, le: '2026-10-26T00:00:00.000Z', entrees, trous }));
        fs.writeFileSync(path.join(racine, 'VALIDATIONS', `valide-${famille}.json`), JSON.stringify(validations));
        const fauxLire = {
            lignes: async ids => lignes.filter(l => ids.includes(l.idProduct)),
            fiches: async (carteIds, slugs) => lignes.filter(l => carteIds.includes(l.carteId) && slugs.includes(l.slugSet)),
            numeros: async ids => ids.map(i => ({ idProduct: i, numero: produits[i]?.numeroNumeros ?? null, slug: produits[i]?.slugNumeros ?? null, nomFr: produits[i]?.nomFrNumeros ?? null })).filter(x => x.numero != null || x.nomFr != null),
            sets: async slugs => sets.filter(s => slugs.includes(s._id)),
            nomsJa: async ids => cartes.filter(c => ids.includes(c._id)).map(c => ({ _id: c._id, nomJa: c.nomJa ?? null, nomEn: c.nomEn, ndex: c.ndex, pv: c.pv, categorie: c.categorie, images: c.images })),
            codesSet: async ids => codesSet.filter(c => ids.includes(c.idExpansion)),
            produitsDuSet: async slugs => lignes.filter(l => slugs.includes(l.slugSet)).map(l => ({ idProduct: l.idProduct, slugSet: l.slugSet, numeroFiche: l.numeroFiche })),
            cartesDeNomEn: async noms => cartes.filter(c => noms.includes(c.nomEn) && c.nomJa && c._id > 0).map(c => ({ _id: c._id, nomEn: c.nomEn, nomJa: c.nomJa })),
            positions: async () => positions,
            impressions: async ids => ids.map(i => ({ _id: i, impressions: impressionsDe[i] ?? [] }))
        };
        const imgs = [];
        const db = { collection: n => ({ cartes: { find: q => ({ project: () => ({ toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }) }) }, images: { find: q => ({ toArray: async () => imgs.filter(d => q.carteId.$in.includes(d.carteId)) }), findOne: async () => null } })[n] };
        return { racine, cache, lire: fauxLire, etat, db, F: CLI.fichiersDe('prv', path.join(racine, 'sortie'), cache) };
    }
    async function mondeSimple(opts = {}) {
        const octets = await png(400, 560), url = 'https://img.alpha.test/a/1.png';
        const base = tmp(); // cache provisoire pour le fichier ; le monde crée son propre CACHE : on y copie
        const w = monde({
            entrees: [entree({ url, sha256: sha(octets), fichier: 'à remplacer' })], validations: [validation({ sha256: sha(octets) })],
            etat: [{ idProduct: 1001, idExpansion: 5000, langue: 'intl', tamponnee: null, name: 'Bulbasaur' }],
            lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: '13', idExpansion: 5000 }], cartes: [{ _id: 77, nomEn: 'Bulbasaur', images: [] }], ...opts });
        const fb = poserAuCache(w.cache, url, octets);
        const man = JSON.parse(fs.readFileSync(path.join(w.racine, 'MCD', 'preuves.json'), 'utf8')); man.entrees[0].fichier = fb;
        fs.writeFileSync(path.join(w.racine, 'MCD', 'preuves.json'), JSON.stringify(man));
        void base;
        return { ...w, octets, url };
    }
    await test('plan : une entrée validée, lue, en cache = une unité « ajouter » ; l\'index d\'images est construit depuis le cache ; empreintes des fichiers d\'entrée gardées', async () => {
        const w = await mondeSimple();
        const plan = await K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        assert.strictEqual(plan.unites.length, 1); assert.strictEqual(plan.unites[0].decision.action, 'ajouter');
        assert.deepStrictEqual(plan.resume.refus, []);
        assert.strictEqual(plan.resume.parRegle['preuve-lue'], 1);
        const idx = JSON.parse(fs.readFileSync(w.F.images, 'utf8'));
        assert.deepStrictEqual([idx[w.url].statut, idx[w.url].w, idx[w.url].sha256], ['ok', 400, sha(w.octets)]);
        assert.ok(plan.empreintes.MCD.manifeste && plan.empreintes.MCD.validations);
        assert.strictEqual(plan.unites[0].langue, 'en');
    });
    await test('plan (27/10) : produit français (2361), scan français : le nom lu se compare au nomFr de numeros_cartes ; sans nomFr = refus nom-different', async () => {
        const fr = { etat: [{ idProduct: 1001, idExpansion: 2361, langue: 'intl', tamponnee: null, name: 'Bulbasaur [Razor Leaf]' }],
            lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: '13', idExpansion: 2361 }] };
        const avec = await mondeSimple({ ...fr, produits: { 1001: { nomFrNumeros: 'Bulbizarre [Razor Leaf]' } } });
        const man = JSON.parse(fs.readFileSync(path.join(avec.racine, 'MCD', 'preuves.json'), 'utf8'));
        man.entrees[0].attendu.langue = 'fr'; man.entrees[0].lu = { ...man.entrees[0].lu, langue: 'fr', nom: 'Bulbizarre' };
        fs.writeFileSync(path.join(avec.racine, 'MCD', 'preuves.json'), JSON.stringify(man));
        const p1 = await K.construirePlanAvec({ dossier: avec.racine, cache: avec.cache, lire: avec.lire, etat: avec.etat, lecteur: RC.lecteurNatif(avec.db), fichiers: avec.F });
        assert.deepStrictEqual(p1.resume.refus, []);
        assert.deepStrictEqual([p1.unites.length, p1.unites[0].decision.action, p1.unites[0].langue], [1, 'ajouter', 'fr']);
        const sans = await mondeSimple(fr);
        const man2 = JSON.parse(fs.readFileSync(path.join(sans.racine, 'MCD', 'preuves.json'), 'utf8'));
        man2.entrees[0].attendu.langue = 'fr'; man2.entrees[0].lu = { ...man2.entrees[0].lu, langue: 'fr', nom: 'Bulbizarre' };
        fs.writeFileSync(path.join(sans.racine, 'MCD', 'preuves.json'), JSON.stringify(man2));
        const p2 = await K.construirePlanAvec({ dossier: sans.racine, cache: sans.cache, lire: sans.lire, etat: sans.etat, lecteur: RC.lecteurNatif(sans.db), fichiers: sans.F });
        assert.strictEqual(p2.unites.length, 0);
        assert.match(JSON.stringify(p2.resume.refus), /nom-different/);
    });
    await test('plan (a-reste, japonais) : produit japonais, scan japonais : le nom lu se compare au nomJa de la CARTE de la ligne ; autre nom ou carte sans nomJa = refus nom-different', async () => {
        const jp = (nomJa, luNom) => ({ etat: [{ idProduct: 1001, idExpansion: 5000, langue: 'jp', tamponnee: null, name: 'Bulbasaur' }], sets: [{ _id: SLUG, tirage: 'jp' }], cartes: [{ _id: 77, nomEn: 'Bulbasaur', nomJa, images: [] }], luNom });
        const monter = async (o) => {
            const w = await mondeSimple(o);
            const man = JSON.parse(fs.readFileSync(path.join(w.racine, 'MCD', 'preuves.json'), 'utf8'));
            man.entrees[0].lu = { ...man.entrees[0].lu, langue: 'ja', nom: o.luNom, total: '40' };
            fs.writeFileSync(path.join(w.racine, 'MCD', 'preuves.json'), JSON.stringify(man));
            return K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        };
        const bon = await monter(jp('フシギダネ', 'フシギダネ'));
        assert.deepStrictEqual(bon.resume.refus, []); assert.deepStrictEqual([bon.unites.length, bon.unites[0].langue], [1, 'ja']);
        const autre = await monter(jp('フシギダネ', 'ヒトカゲ'));
        assert.strictEqual(autre.unites.length, 0); assert.match(JSON.stringify(autre.resume.refus), /nom-different/);
        const sans = await monter(jp(undefined, 'フシギダネ'));
        assert.strictEqual(sans.unites.length, 0); assert.match(JSON.stringify(sans.resume.refus), /nom-different/);
    });
    await test('plan (08/11, B) : un Dresseur indonésien de la ligne SV-P/ID passe par l\'illustration relue (cleR2 lue sur la CARTE, en base) ; une référence étrangère à la carte refuse', async () => {
        // la relecture vit HORS du manifeste : VALIDATIONS\illustrations-MCD.json ; une signature dans lu.illustrationRelue est ignorée
        const monter = async (reference, cleR2 = ['cartes/77/a.webp', 'cartes/77/b.webp'], { fichier = true, shaFaux = false, signatureSeule = false } = {}) => {
            const w = await mondeSimple({ etat: [{ idProduct: 1001, idExpansion: 5000, langue: 'id', tamponnee: null, name: 'Switch' }], sets: [{ _id: SLUG, tirage: 'id' }],
                lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: '13', slug: 'Switch-SV-PID013', idExpansion: 5000 }],
                cartes: [{ _id: 77, nomEn: 'Switch', categorie: 'dresseur', images: cleR2.map(c => ({ cleR2: c })) }], codesSet: [{ idExpansion: 5000, codeSet: 'SV-P/ID' }] });
            const man = JSON.parse(fs.readFileSync(path.join(w.racine, 'MCD', 'preuves.json'), 'utf8'));
            man.entrees[0].attendu.langue = 'id';
            man.entrees[0].lu = { ...man.entrees[0].lu, langue: 'id', nom: 'Tukar Pokémon', total: '21', codeSet: 'SV-P/ID', ...(signatureSeule ? { illustrationRelue: { par: 'coordinateur', reference, le: '2026-11-08' } } : {}) };
            fs.writeFileSync(path.join(w.racine, 'MCD', 'preuves.json'), JSON.stringify(man));
            if (fichier) fs.writeFileSync(path.join(w.racine, 'VALIDATIONS', 'illustrations-MCD.json'), JSON.stringify([{ idProduct: 1001, sha256: shaFaux ? H3 : sha(w.octets), reference, par: 'coordinateur', le: '2026-11-08' }]));
            return K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        };
        const bon = await monter('cartes/77/b.webp');
        assert.deepStrictEqual([bon.resume.refus, bon.unites.length], [[], 1]);
        assert.ok(bon.unites[0].champsEntree.preuveLue.drapeaux.includes('temoin-illustration-relue:SV-P/ID'));
        for (const [nom, p] of [['référence étrangère', await monter('cartes/99/z.webp')], ['carte sans visuel', await monter('cartes/77/a.webp', [])]]) {
            assert.strictEqual(p.unites.length, 0, nom); assert.match(JSON.stringify(p.resume.refus), /illustration-non-relue/, nom);
        }
        const autreImage = await monter('cartes/77/b.webp', undefined, { shaFaux: true });
        assert.strictEqual(autreImage.unites.length, 0); assert.match(JSON.stringify(autreImage.resume.refus), /illustration-non-relue/, 'sha256 de l\'illustration relue ≠ celui de l\'image jugée');
        const signee = await monter('cartes/77/b.webp', undefined, { fichier: false, signatureSeule: true });
        assert.strictEqual(signee.unites.length, 0, 'une signature dans le manifeste ne suffit jamais'); assert.match(JSON.stringify(signee.resume.refus), /nom-traduit-sans-temoin/);
        assert.ok(bon.empreintes.MCD.illustrations && bon.empreintes.MCD.illustrations !== 'absent', 'le fichier d\'illustrations fait partie des empreintes du plan');
        assert.strictEqual(signee.empreintes.MCD.illustrations, 'absent');
    });
    await test('plan (nom traduit) : fiche simple japonaise sans carte : Pokédex + PV + règle + code lus ; le code vient du slug OU de codes_set ; la table officielle sert un Dresseur ; un désaccord refuse', async () => {
        const base = o => ({ etat: [{ idProduct: 1001, idExpansion: 5000, langue: o.tirage ?? 'jp', tamponnee: null, name: o.name ?? 'Mareep' }], sets: [{ _id: SLUG, tirage: o.tirage ?? 'jp' }], cartes: o.cartes ?? [], luLangue: o.luLangue ?? 'ja',
            lignes: [{ idProduct: 1001, carteId: -1, slugSet: SLUG, numeroFiche: '13', slug: o.slug ?? 'Mareep-svAL013', idExpansion: 5000 }], codesSet: o.codesSet ?? [], luPlus: o.lu ?? {} });
        const monter = async (o) => {
            const w = await mondeSimple(o);
            const man = JSON.parse(fs.readFileSync(path.join(w.racine, 'MCD', 'preuves.json'), 'utf8'));
            man.entrees[0].lu = { ...man.entrees[0].lu, langue: o.luLangue, nom: o.luLangue === 'ja' ? 'メリープ' : '咩利羊', total: '21', codeSet: 'svAL', dex: 179, pv: 60, ...o.luPlus };
            fs.writeFileSync(path.join(w.racine, 'MCD', 'preuves.json'), JSON.stringify(man));
            return K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        };
        const bon = await monter(base({}));
        assert.deepStrictEqual(bon.resume.refus, []); assert.deepStrictEqual([bon.unites.length, bon.unites[0].langue], [1, 'ja']);
        const pl = bon.unites[0].champsEntree.preuveLue.lu;
        assert.deepStrictEqual([pl.dex, pl.pv, pl.codeSet], [179, 60, 'svAL'], 'ce qui a été lu est écrit dans la preuve');
        for (const [nom, o, motif] of [['Pokédex faux', { lu: { dex: 180 } }, /pokedex-different/], ['PV absent', { lu: { pv: null } }, /pv-non-lu/], ['règle de plus', { lu: { nom: 'メリープex' } }, /regle-differente/],
            ['code du set faux', { lu: { codeSet: 'svOD' } }, /code-set-different/], ['code absent du slug et de la ligne', { slug: 'Mareep' }, /code-set-non-verifiable/]])
            { const p = await monter(base(o)); assert.strictEqual(p.unites.length, 0, nom); assert.match(JSON.stringify(p.resume.refus), motif, nom); }
        const ligne = await monter(base({ slug: 'Mareep', codesSet: [{ idExpansion: 5000, codeSet: 'svAL' }] }));
        assert.deepStrictEqual([ligne.resume.refus, ligne.unites.length], [[], 1], 'le code vient de codes_set (la ligne)');
        // une ligne codes_set sans code ne retire pas le code d'une autre ligne de la même expansion
        const deuxLignes = await monter(base({ slug: 'Mareep', codesSet: [{ idExpansion: 5000, codeSet: 'svAL' }, { idExpansion: 5000, codeSet: null }] }));
        assert.deepStrictEqual([deuxLignes.resume.refus, deuxLignes.unites.length], [[], 1], 'une ligne sans code est ignorée');
        // la preuve écrite porte ses marqueurs ; un jumeau dans le set est listé à part
        assert.deepStrictEqual(bon.unites[0].champsEntree.preuveLue.drapeaux, ['pv-non-verifie']);
        const jum = await monter({ ...base({}), etat: [...base({}).etat, { idProduct: 1002, idExpansion: 5000, langue: 'jp', tamponnee: null, name: 'Mareep [Gnaw]' }], lignes: [...base({}).lignes, { idProduct: 1002, carteId: -2, slugSet: SLUG, numeroFiche: '14', slug: 'Mareep-svAL014', idExpansion: 5000 }] });
        assert.deepStrictEqual([jum.resume.refus, jum.unites.length], [[], 1]);
        assert.deepStrictEqual(jum.unites[0].champsEntree.preuveLue.drapeaux, ['pv-non-verifie', 'jumeau-dans-le-set']);
        assert.deepStrictEqual(jum.resume.jumeauxDansLeSet, [1001], 'le plan liste les jumeaux à part');
        assert.deepStrictEqual(bon.resume.jumeauxDansLeSet, []);
        assert.match(K.def.noteCompte(jum.unites), /1 .*jumeau/i, '--compter les compte à part');
        assert.match(K.def.noteCompte(bon.unites), /0 .*jumeau/i);
        // une entrée sans témoin saisi ne déclenche AUCUNE lecture supplémentaire (codes_set, table, produits du set)
        const w0 = await mondeSimple(); const appels = [];
        for (const k of ['codesSet', 'cartesDeNomEn', 'produitsDuSet']) { const f = w0.lire[k]; w0.lire[k] = async (...a) => { appels.push(k); return f(...a); }; }
        await K.construirePlanAvec({ dossier: w0.racine, cache: w0.cache, lire: w0.lire, etat: w0.etat, lecteur: RC.lecteurNatif(w0.db), fichiers: w0.F });
        assert.deepStrictEqual(appels, [], 'aucune lecture de nom traduit pour une entrée ordinaire');
        // le PV de la carte, quand elle existe : il doit être celui qui est lu
        const carte = pv => base({ cartes: [{ _id: 77, nomEn: 'Mareep', pv, ndex: 179, categorie: 'pokemon', images: [] }] });
        const avecCarte = o => ({ ...o, lignes: [{ ...o.lignes[0], carteId: 77 }] });
        assert.strictEqual((await monter(avecCarte(carte(60)))).unites.length, 1);
        const pvFaux = await monter(avecCarte(carte(70)));
        assert.strictEqual(pvFaux.unites.length, 0); assert.match(JSON.stringify(pvFaux.resume.refus), /pv-different/);
        // chinois : la carte est lue aussi (PV de la carte contre PV lu), pas seulement pour le japonais
        const zhCarte = pv => avecCarte(base({ tirage: 'zh-hans', luLangue: 'zh-hans', cartes: [{ _id: 77, nomEn: 'Mareep', pv, ndex: 179, categorie: 'pokemon', images: [] }] }));
        assert.strictEqual((await monter(zhCarte(60))).unites.length, 1);
        const zhFaux = await monter(zhCarte(70));
        assert.strictEqual(zhFaux.unites.length, 0); assert.match(JSON.stringify(zhFaux.resume.refus), /pv-different/);
        // le n° de Pokédex et la catégorie de la CARTE sont lus aussi ; son nomEn passe avant le nom Cardmarket du produit
        const ndexFaux = await monter(avecCarte(base({ cartes: [{ _id: 77, nomEn: 'Mareep', pv: 60, ndex: 180, categorie: 'pokemon', images: [] }] })));
        assert.strictEqual(ndexFaux.unites.length, 0); assert.match(JSON.stringify(ndexFaux.resume.refus), /ndex-non-confirme/);
        const dresseurCarte = await monter(avecCarte(base({ cartes: [{ _id: 77, nomEn: 'Mareep', pv: 60, ndex: 179, categorie: 'dresseur', images: [] }] })));
        assert.strictEqual(dresseurCarte.unites.length, 0); assert.match(JSON.stringify(dresseurCarte.resume.refus), /nom-traduit-sans-temoin/);
        const nomDeLaCarte = await monter(avecCarte(base({ name: 'Mareep Holo', cartes: [{ _id: 77, nomEn: 'Mareep', pv: 60, categorie: 'pokemon', images: [] }] })));
        assert.deepStrictEqual([nomDeLaCarte.resume.refus, nomDeLaCarte.unites.length], [[], 1], 'le nomEn de la carte fait foi, pas le libellé du produit');
        // un Dresseur au nom traduit : refusé, sauf table officielle (le nomJa d'autres cartes à page de même nomEn)
        const dr = (o = {}) => base({ name: 'Nemona', slug: 'Nemona-svAL013', lu: { nom: 'ネモ', dex: null, pv: null }, ...o });
        const sans = await monter(dr());
        assert.strictEqual(sans.unites.length, 0); assert.match(JSON.stringify(sans.resume.refus), /nom-traduit-sans-temoin/);
        const table = await monter(dr({ cartes: [{ _id: 301, nomEn: 'Nemona', nomJa: 'ネモ', images: [] }, { _id: 302, nomEn: 'Nemona', nomJa: 'ネモ', images: [] }] }));
        assert.deepStrictEqual([table.resume.refus, table.unites.length], [[], 1], 'table officielle : deux cartes à page, même nomJa');
        // la table se cherche sous le nomEn de la CARTE (pas le libellé du produit)
        const tableCarte = await monter({ ...dr({ name: 'Nemona Holo', cartes: [{ _id: 77, nomEn: 'Nemona', categorie: 'dresseur', images: [] }, { _id: 301, nomEn: 'Nemona', nomJa: 'ネモ', images: [] }, { _id: 302, nomEn: 'Nemona', nomJa: 'ネモ', images: [] }] }), lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: '13', slug: 'Nemona-svAL013', idExpansion: 5000 }] });
        assert.deepStrictEqual([tableCarte.resume.refus, tableCarte.unites.length], [[], 1], 'table trouvée sous le nom de la carte');
        const diverge = await monter(dr({ cartes: [{ _id: 301, nomEn: 'Nemona', nomJa: 'ネモ', images: [] }, { _id: 302, nomEn: 'Nemona', nomJa: 'ボタン', images: [] }] }));
        assert.strictEqual(diverge.unites.length, 0); assert.match(JSON.stringify(diverge.resume.refus), /nom-traduit-sans-temoin/);
    });
    await test('plan : sans validation = refus nommé, rien dans l\'index ni dans les unités', async () => {
        const w = await mondeSimple({ validations: [] });
        const plan = await K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        assert.strictEqual(plan.unites.length, 0); assert.deepStrictEqual(plan.resume.refus.map(r => r.motif), ['sans-validation']);
        assert.strictEqual(fs.existsSync(w.F.images) ? Object.keys(JSON.parse(fs.readFileSync(w.F.images, 'utf8'))).length : 0, 0);
    });
    await test('plan : produit absent de l\'état / tirage du set différent / produit sur plusieurs fiches / numéro du produit absent partout = refus nommés', async () => {
        const w1 = await mondeSimple({ etat: [{ idProduct: 4242, idExpansion: 1, langue: 'intl' }] });
        assert.deepStrictEqual((await K.construirePlanAvec({ dossier: w1.racine, cache: w1.cache, lire: w1.lire, etat: w1.etat, lecteur: RC.lecteurNatif(w1.db), fichiers: w1.F })).resume.refus.map(r => r.motif), ['produit-absent-de-letat']);
        const w2 = await mondeSimple({ sets: [{ _id: SLUG, tirage: 'jp' }] });
        assert.deepStrictEqual((await K.construirePlanAvec({ dossier: w2.racine, cache: w2.cache, lire: w2.lire, etat: w2.etat, lecteur: RC.lecteurNatif(w2.db), fichiers: w2.F })).resume.refus.map(r => r.motif), ['tirage-du-set-different']);
        const w3 = await mondeSimple({ lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: '13', idExpansion: 5000 }, { idProduct: 1001, carteId: 78, slugSet: SLUG, numeroFiche: '14', idExpansion: 5000 }] });
        assert.deepStrictEqual((await K.construirePlanAvec({ dossier: w3.racine, cache: w3.cache, lire: w3.lire, etat: w3.etat, lecteur: RC.lecteurNatif(w3.db), fichiers: w3.F })).resume.refus.map(r => r.motif), ['produit-sur-plusieurs-fiches']);
        const w4 = await mondeSimple({ lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: null, idExpansion: 5000 }] });
        const p4 = await K.construirePlanAvec({ dossier: w4.racine, cache: w4.cache, lire: w4.lire, etat: w4.etat, lecteur: RC.lecteurNatif(w4.db), fichiers: w4.F });
        assert.match(p4.resume.refus[0].motif, /preuve-lue:numero/, 'le produit n\'a pas de numéro de fiche : numéro de numeros_cartes absent aussi -> la preuve doit se passer de numéro (marques + attendu.numero null)');
    });
    await test('tour 4 (2) en plan : Battle Academy — la position doit être unique parmi TOUS les produits des sets BA de la base, et le numéro imprimé une impression de la carte', async () => {
        const BAS = 'Battle-Academy-2022';
        const monter4 = async ({ positions, impressions = [{ numero: '189', total: '236' }], lu = {} }) => {
            const w = await mondeSimple({ sets: [{ _id: BAS, tirage: 'intl' }], etat: [{ idProduct: 1001, idExpansion: 5000, langue: 'intl', tamponnee: 'ba22', name: 'Bug Catcher' }, { idProduct: 2002, idExpansion: 5000, langue: 'intl', tamponnee: 'ba24', name: 'Bug Catcher' }],
                lignes: [{ idProduct: 1001, carteId: 77, slugSet: BAS, numeroFiche: 'P44', idExpansion: 5000 }], positions, impressionsDe: { 77: impressions } });
            const f = path.join(w.racine, 'MCD', 'preuves.json'), man = JSON.parse(fs.readFileSync(f, 'utf8'));
            man.entrees[0].lu = { nom: 'Bug Catcher', numero: '189', total: '236', langue: 'en', tampon: 'battle-academy', position: 'P44', finition: 'normale', marques: ['silhouette Pikachu', 'rond 44'], ...lu };
            fs.writeFileSync(f, JSON.stringify(man)); return w;
        };
        const planDe = w => K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        const seul = [{ idProduct: 1001, slugSet: BAS, numeroFiche: 'P44' }, { idProduct: 2002, slugSet: 'Battle-Academy-2024', numeroFiche: 'P45' }];
        const bon = await planDe(await monter4({ positions: seul }));
        assert.deepStrictEqual(bon.resume.refus, [], JSON.stringify(bon.resume.refus)); assert.strictEqual(bon.unites.length, 1); assert.strictEqual(bon.unites[0].tampon, 'battle-academy');
        const ambigu = await planDe(await monter4({ positions: [...seul, { idProduct: 2002, slugSet: 'Battle-Academy-2024', numeroFiche: 'P44' }] }));
        assert.deepStrictEqual(ambigu.resume.refus.map(r => r.motif), ['preuve-lue:position-ambigue']);
        const horsCarte = await planDe(await monter4({ positions: seul, impressions: [{ numero: '12', total: '236' }] }));
        assert.deepStrictEqual(horsCarte.resume.refus.map(r => r.motif), ['preuve-lue:numero-imprime-hors-carte']);
        // décision du testeur : l'année non prouvée devient un TROU nommé variantes-indiscernables (hôte interrogé + date), pas un refus muet ; un refus d'une autre nature n'en fait pas
        for (const p of [ambigu, horsCarte]) { assert.deepStrictEqual(p.trousAuto.map(t => [t.idProduct, t.motif]), [[1001, 'variantes-indiscernables']]); assert.deepStrictEqual(p.trousAuto[0].interroges, ['img.alpha.test']); }
        assert.deepStrictEqual(bon.trousAuto, []);
        const w = await monter4({ positions: [...seul, { idProduct: 2002, slugSet: 'Battle-Academy-2024', numeroFiche: 'P44' }] });
        const pl = await planDe(w), tr = K.trousDuPlan({ plan: pl, dossier: w.racine });
        assert.deepStrictEqual(tr.trous.map(x => [x.idProduct, x.motif, x.sources]), [[1001, 'variantes-indiscernables', ['img.alpha.test']]]);
        const mauvaisNom = await planDe(await monter4({ positions: seul, lu: { nom: 'Autre carte' } }));
        assert.deepStrictEqual(mauvaisNom.trousAuto, [], 'un nom différent est un refus, pas un trou d\'année');
    });
    await test('tour 3 (2) en plan : le numéro ET le slug du produit viennent de numeros_cartes quand la ligne n\'en porte pas (cas réel 311267 : carte « XY150a », produit « 150a »)', async () => {
        const lg = [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: null, idExpansion: 5000 }];
        const monter3 = async slugNumeros => { const w = await mondeSimple({ lignes: lg, produits: { 1001: { numeroNumeros: '150a', slugNumeros } } });
            const f = path.join(w.racine, 'MCD', 'preuves.json'), man = JSON.parse(fs.readFileSync(f, 'utf8')); man.entrees[0].lu = { ...man.entrees[0].lu, numero: 'XY150a', total: null }; fs.writeFileSync(f, JSON.stringify(man)); return w; };
        const planDe = w => K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        const bon = await planDe(await monter3('Yveltal-EX-V3-XYPRXY150a'));
        assert.deepStrictEqual(bon.resume.refus, [], JSON.stringify(bon.resume.refus)); assert.strictEqual(bon.unites.length, 1);
        const sans = await planDe(await monter3(null));
        assert.deepStrictEqual(sans.resume.refus.map(r => r.motif), ['preuve-lue:numero-different']);
    });
    await test('plan : le numéro de la fiche manque -> à défaut numeros_cartes.numero (P2)', async () => {
        const w = await mondeSimple({ lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: null, idExpansion: 5000 }], produits: { 1001: { numeroNumeros: '13' } } });
        const plan = await K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        assert.strictEqual(plan.unites.length, 1, JSON.stringify(plan.resume.refus));
        assert.strictEqual(plan.unites[0].numero, '13');
    });
    await test('plan : le plan est PÉRIMÉ si un manifeste ou une validation a changé depuis (garde avant --compter / --ecrire)', async () => {
        const w = await mondeSimple();
        const plan = await K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        assert.strictEqual(K.planPerime({ plan, dossier: w.racine }), null);
        fs.writeFileSync(path.join(w.racine, 'VALIDATIONS', 'valide-MCD.json'), JSON.stringify([]));
        assert.match(K.planPerime({ plan, dossier: w.racine }), /MCD/);
        const w2 = await mondeSimple();
        const p2 = await K.construirePlanAvec({ dossier: w2.racine, cache: w2.cache, lire: w2.lire, etat: w2.etat, lecteur: RC.lecteurNatif(w2.db), fichiers: w2.F });
        fs.writeFileSync(path.join(w2.racine, 'MCD', 'preuves.json'), JSON.stringify({ famille: 'MCD', entrees: [], trous: [] }));
        assert.match(K.planPerime({ plan: p2, dossier: w2.racine }), /MCD/);
        assert.match(K.planPerime({ plan: { unites: [] }, dossier: w2.racine }), /empreintes/, 'un plan sans empreintes est périmé par défaut');
    });
    await test('plan : une famille sans validations.json = tout refusé « sans-validation » ; une famille dont le manifeste est illisible LÈVE', async () => {
        const w = await mondeSimple();
        fs.rmSync(path.join(w.racine, 'VALIDATIONS', 'valide-MCD.json'));
        const plan = await K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        assert.deepStrictEqual(plan.resume.refus.map(r => r.motif), ['sans-validation']);
        fs.writeFileSync(path.join(w.racine, 'MCD', 'preuves.json'), '{pas du json');
        await assert.rejects(() => K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F }), /MCD/);
    });
    await test('trous : écrits seulement pour les produits SANS visuel validé ; le motif et les hôtes sont ceux du manifeste', async () => {
        const w = await mondeSimple({ trous: [{ idProduct: 1001, motif: 'aucune-source', interroges: ['alpha.test'], date: '2026-10-26T09:00:00.000Z', detail: '' }, { idProduct: 2002, motif: 'une-seule-source', interroges: ['alpha.test'], date: '2026-10-26T09:00:00.000Z', detail: 'x' }] });
        const plan = await K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
        const t = K.trousDuPlan({ plan, dossier: w.racine });
        assert.deepStrictEqual(t.trous.map(x => [x.idProduct, x.motif, x.sources]), [[2002, 'une-seule-source', ['alpha.test']]]);
        assert.deepStrictEqual(t.ecartes.map(x => x.idProduct), [1001]);
    });

    const planDe = w => K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });
    await test('tour 1 (6) : une famille déclarée autre que le dossier ne fait pas lever le plan : le dossier fait foi, l\'écart est dans le résumé', async () => {
        const w = await mondeSimple();
        const f = path.join(w.racine, 'MCD', 'preuves.json'), man = JSON.parse(fs.readFileSync(f, 'utf8'));
        man.famille = 'MCD (transversal R6)'; fs.writeFileSync(f, JSON.stringify(man));
        const p = await planDe(w);
        assert.strictEqual(p.unites.length, 1); assert.deepStrictEqual(p.resume.avertissements, ['famille « MCD » : le manifeste se déclare « MCD (transversal R6) » (le dossier fait foi)']);
        assert.strictEqual(K.planPerime({ plan: p, dossier: w.racine }), null);
    });
    await test('tour 1 (5) : deux produits V1/V2 sur la même fiche en base, chacun validé au même sha256 avec sa paire : UNE unité partagée, marquage de l\'API ; la fiche est lue par (carte, set, numéro)', async () => {
        const octets = await png(400, 560), url = 'https://img.alpha.test/a/p.png';
        const pa = { normale: 1001, holo: 1002 };
        const mk = id => entree({ idProduct: id, url, sha256: sha(octets), varianteNommee: nommee(pa) });
        const w = monde({ entrees: [mk(1001), mk(1002)], validations: [validation({ sha256: sha(octets) }), validation({ idProduct: 1002, sha256: sha(octets) })],
            etat: [1001, 1002].map(i => ({ idProduct: i, idExpansion: 5000, langue: 'intl', tamponnee: null, name: 'Bulbasaur' })),
            lignes: [1001, 1002].map(i => ({ idProduct: i, carteId: 77, slugSet: SLUG, numeroFiche: '13', idExpansion: 5000 })), cartes: [{ _id: 77, nomEn: 'Bulbasaur', images: [] }] });
        const fb = poserAuCache(w.cache, url, octets);
        const man = JSON.parse(fs.readFileSync(path.join(w.racine, 'MCD', 'preuves.json'), 'utf8')); for (const e of man.entrees) e.fichier = fb;
        fs.writeFileSync(path.join(w.racine, 'MCD', 'preuves.json'), JSON.stringify(man));
        const p = await planDe(w);
        assert.deepStrictEqual(p.resume.refus, [], JSON.stringify(p.resume.refus));
        assert.strictEqual(p.unites.length, 1); assert.deepStrictEqual(p.unites[0].produits, [1001, 1002]);
        assert.strictEqual(p.unites[0].champsEntree.partageeHoloNonHolo, true); assert.deepStrictEqual(p.unites[0].champsEntree.produitsPartages, [1001, 1002]);
        assert.strictEqual(p.unites[0].decision.action, 'ajouter');
    });
    await test('plan : le cache est relu — fichier altéré, absent, trop petit : refus nommés, rien dans les unités', async () => {
        const w = await mondeSimple();
        fs.writeFileSync(path.join(w.cache, HOTE.nomCache(w.url)).replace(/\.json$/, '.bin'), await png(400, 560, { r: 9, g: 9, b: 9 }));
        const p = await planDe(w);
        assert.deepStrictEqual(p.resume.refus.map(r => r.motif), ['cache-sha256-different']); assert.strictEqual(p.unites.length, 0);
        const w2 = await mondeSimple();
        fs.rmSync(path.join(w2.cache, HOTE.nomCache(w2.url)));
        assert.deepStrictEqual((await planDe(w2)).resume.refus.map(r => r.motif), ['cache-absent']);
        const petit = await png(150, 210), w3 = await mondeSimple();
        poserAuCache(w3.cache, w3.url, petit);
        const man = JSON.parse(fs.readFileSync(path.join(w3.racine, 'MCD', 'preuves.json'), 'utf8')); man.entrees[0].sha256 = sha(petit); fs.writeFileSync(path.join(w3.racine, 'MCD', 'preuves.json'), JSON.stringify(man));
        fs.writeFileSync(path.join(w3.racine, 'VALIDATIONS', 'valide-MCD.json'), JSON.stringify([validation({ sha256: sha(petit) })]));
        fs.writeFileSync(man.entrees[0].fichier, petit);
        assert.deepStrictEqual((await planDe(w3)).resume.refus.map(r => r.motif), ['trop-petit']);
    });
    await test('plan : une preuve qui ne tient pas (numéro lu ≠ numéro du produit) est refusée avec le motif de la règle', async () => {
        const w = await mondeSimple();
        const f = path.join(w.racine, 'MCD', 'preuves.json'), man = JSON.parse(fs.readFileSync(f, 'utf8'));
        man.entrees[0].lu.numero = '14'; fs.writeFileSync(f, JSON.stringify(man));
        const p = await planDe(w);
        assert.deepStrictEqual(p.resume.refus.map(r => r.motif), ['preuve-lue:numero-different']); assert.strictEqual(p.unites.length, 0);
        assert.deepStrictEqual(p.resume.refusParMotif, { 'preuve-lue:numero-different': 1 });
    });
    await test('plan : deux-sources — la seconde image est relue au cache aussi (absente = refus), puis la règle d\'image de production décide ; l\'image écrite est la VALIDÉE (la première)', async () => {
        const IA = await fabrique(7, 300, 420).png().toBuffer(), IA2 = await sharp(IA).webp({ lossless: true }).toBuffer();
        const urlA = 'https://img.alpha.test/a/1.png', urlB = 'https://cdn.beta.example/b/1.webp';
        const monter2 = async (poserB) => {
            const w = monde({ entrees: [], validations: [validation({ regle: 'deux-sources', sha256: sha(IA) })], etat: [{ idProduct: 1001, idExpansion: 5000, langue: 'intl', tamponnee: null, name: 'Bulbasaur' }],
                lignes: [{ idProduct: 1001, carteId: 77, slugSet: SLUG, numeroFiche: '13', idExpansion: 5000 }], cartes: [{ _id: 77, nomEn: 'Bulbasaur', images: [] }] });
            const fa = poserAuCache(w.cache, urlA, IA), fbPath = poserBLoin(w, poserB);
            fs.writeFileSync(path.join(w.racine, 'MCD', 'preuves.json'), JSON.stringify({ famille: 'MCD', le: '2026-10-26T00:00:00Z', trous: [], entrees: [entree({ regle: 'deux-sources', url: urlA, sha256: sha(IA), fichier: fa, seconde: { url: urlB, hote: 'cdn.beta.example', fichier: fbPath, sha256: sha(IA2), w: 300, h: 420, lu: { ...entree().lu } } })] }));
            return w;
        };
        const poserBLoin = (w, poser) => (poser ? poserAuCache(w.cache, urlB, IA2) : path.join(w.cache, 'absent.bin'));
        const sans = await planDe(await monter2(false));
        assert.deepStrictEqual(sans.resume.refus.map(r => r.motif), ['seconde-cache-absent']); assert.strictEqual(sans.unites.length, 0);
        const avec = await planDe(await monter2(true));
        assert.deepStrictEqual(avec.resume.refus, [], JSON.stringify(avec.resume.refus));
        assert.strictEqual(avec.unites.length, 1); assert.strictEqual(avec.unites[0].url, urlA); assert.strictEqual(avec.unites[0].sha256, sha(IA));
        assert.strictEqual(avec.resume.parRegle['deux-sources'], 1);
        assert.strictEqual(avec.unites[0].champsEntree.preuveLue.regle, 'deux-sources');
    });
    await test('trous : --compter-trous donne le --attendu ; --trous refuse un --attendu faux (rien d\'écrit) et écrit le bon compte, additif', async () => {
        const w = await mondeSimple({ trous: [{ idProduct: 2002, motif: 'une-seule-source', interroges: ['alpha.test'], date: '2026-10-26T09:00:00.000Z', detail: 'x' }, { idProduct: 2003, motif: 'illisible', interroges: ['alpha.test', 'beta.example'], date: '2026-10-26T09:00:00.000Z', detail: '' }] });
        const plan = await planDe(w), ops = [], existants = [];
        let fermes = 0;
        const connexions = { lecture: async () => ({ db: fauxTrous(existants, ops), fermer: async () => { fermes++; } }), ecriture: async () => ({ db: fauxTrous(existants, ops), fermer: async () => { fermes++; } }) };
        function fauxTrous(ex, o) { return { collection: n => { assert.strictEqual(n, 'trous_nommes'); return { find: () => ({ toArray: async () => ex }), bulkWrite: async (x) => { o.push(x); return {}; } }; } }; }
        const sortie = process.exitCode;
        const [, l1] = await SILENCE(() => K.modeTrous({ mode: '--compter-trous', plan, racine: w.racine, connexions }));
        assert.match(l1.join('\n'), /--attendu=2 \(nouveaux 2, changés 0, inchangés 0\)/); assert.strictEqual(ops.length, 0);
        const [, l2] = await SILENCE(() => K.modeTrous({ mode: '--trous', plan, racine: w.racine, attendu: '5', connexions }));
        assert.match(l2.join('\n'), /rien n'est écrit/); assert.strictEqual(process.exitCode, 2); assert.strictEqual(ops.length, 0);
        process.exitCode = sortie;
        const [, l3] = await SILENCE(() => K.modeTrous({ mode: '--trous', plan, racine: w.racine, attendu: '2', connexions }));
        assert.match(l3.join('\n'), /nouveaux 2/); assert.strictEqual(ops.length, 1);
        assert.deepStrictEqual(ops[0].map(o => o.updateOne.filter._id).sort(), [2002, 2003]);
        assert.deepStrictEqual(ops[0].map(o => o.updateOne.update.$set.sources).sort(), [['alpha.test', 'beta.example'], ['alpha.test']].sort());
        assert.ok(ops[0].every(o => !o.deleteOne && !o.replaceOne), 'additif seulement');
        assert.strictEqual(fermes, 3, 'chaque connexion ouverte est refermée, même sur refus');
        assert.strictEqual(process.exitCode, sortie);
    });
    await test('CLI : un plan PÉRIMÉ (validations modifiées depuis) arrête --compter AVANT toute connexion', async () => {
        const { spawnSync } = require('child_process');
        const w = await mondeSimple();
        const plan = await planDe(w);
        fs.mkdirSync(path.dirname(w.F.plan), { recursive: true }); RC.ecrireJson(w.F.plan, plan);
        const lancer = () => spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-preuves.js'), '--compter', `--racine=${w.racine}`, `--dossier=${path.dirname(w.F.plan)}`], { encoding: 'utf8', env: { ...process.env, MONGODB_CARTES_LECTURE_URI: '', MONGODB_URI: '', MONGODB_CARTES_URI: '' } });
        assert.doesNotMatch(lancer().stderr, /plan périmé/, 'plan frais : la garde se tait');
        fs.writeFileSync(path.join(w.racine, 'VALIDATIONS', 'valide-MCD.json'), JSON.stringify([]));
        const r = lancer();
        assert.notStrictEqual(r.status, 0); assert.match(r.stderr, /plan périmé/);
    });

    // ───────── la ligne de commande (P11) : écrite par ce qu'elle AUTORISE ─────────
    await test('CLI : aucun mode réseau (--releve, --telecharger), aucun argument inconnu ; --ecrire exige --attendu ; --trous exige --attendu', () => {
        const v = a => K.verifierArguments(a);
        assert.strictEqual(v(['--plan']), null);
        assert.strictEqual(v(['--compter']), null); assert.strictEqual(v(['--compter', '--basse-definition']), null);
        assert.strictEqual(v(['--planche', '--echantillon=20']), null);
        assert.strictEqual(v(['--ecrire', '--attendu=3']), null); assert.strictEqual(v(['--ecrire', '--attendu=3', '--basse-definition']), null);
        assert.strictEqual(v(['--trous', '--attendu=2']), null); assert.strictEqual(v(['--compter-trous']), null);
        assert.strictEqual(v(['--retirer']), null);
        assert.strictEqual(v(['--plan', '--famille=MCD']), null);
        for (const mauvais of [['--releve', '--plafond=5'], ['--telecharger', '--plafond=5'], ['--ecrire'], ['--trous'], ['--ecrire', '--attendu=x'], ['--plan', '--zzz'], ['--plan', '--compter'], [], ['--attendu=3', '--compter'], ['--compter', '--attendu=3'], ['--plan', '--famille=../x'], ['--plan', '--famille='], ['--trous', '--attendu=1', '--basse-definition'], ['--plafond=3', '--plan']])
            assert.ok(v(mauvais), `devait refuser ${JSON.stringify(mauvais)}`);
    });
    await test('CLI : --ecrire et --trous refusés hors de lot-additif.js, AVANT toute connexion (code 2)', () => {
        const { spawnSync } = require('child_process');
        for (const args of [['--ecrire', '--attendu=0'], ['--trous', '--attendu=0']]) {
            const r = spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-preuves.js'), ...args], { env: { ...process.env, LOT_ADDITIF_PID: '', NODE_PATH: process.env.NODE_PATH }, encoding: 'utf8' });
            assert.notStrictEqual(r.status, 0, args.join(' '));
            assert.match(r.stderr + r.stdout, /lot-additif/, args.join(' '));
        }
        const r = spawnSync(process.execPath, [path.join(__dirname, 'collecteur-images-preuves.js'), '--telecharger', '--plafond=3'], { encoding: 'utf8' });
        assert.strictEqual(r.status, 2); assert.match(r.stderr, /inconnu|mode/);
    });

    await test('un rejeu de la règle de langue (langue-visuel.js) rend à un document prv SA langue (sinon poser-langue-images l\'effacerait)', () => {
        const LV = require('./collecte-cartes/langue-visuel');
        for (const l of ['en', 'fr', 'ja', 'zh-hans']) { const r = LV.langueDuVisuel({ source: 'prv', langueSource: l }); assert.strictEqual(r.langue, l); assert.strictEqual(r.preuve, PV.LANGUE_PREUVE); }
        assert.strictEqual(LV.langueDuVisuel({ source: 'prv', langueSource: 'ko' }).langue, null);
        assert.strictEqual(LV.langueDuVisuel({ source: 'prv' }).langue, null);
    });

    // ───────── le retrait (P10) ─────────
    await test('P10 : retirer-visuels-recolte.js connaît prv (SRC, dossier d\'annonce, argument admis)', () => {
        const R = require('./retirer-visuels-recolte');
        assert.ok(Object.keys(R.SOURCES).includes('prv'));
        const SRC = R.SOURCES.prv();
        assert.deepStrictEqual([SRC.SOURCE, SRC.LOT], ['prv', 'prv-2026-10']);
        const src = fs.readFileSync(path.join(__dirname, 'retirer-visuels-recolte.js'), 'utf8');
        assert.match(src, /--source=\(ppr\|tcs\|scx\|pmk\|prv\)/);
        assert.match(src, /prv:\s*DOSSIER_PRV/);
        const cartes = [{ _id: 1, images: [{ source: 'prv', lot: 'prv-2026-10', set: 'A', cleR2: 'prv/A/1-1-en.webp' }, { source: 'prv', lot: 'ancien', set: 'A', cleR2: 'x' }] }];
        const plan = R.planDeRetrait(cartes, [], SRC);
        assert.strictEqual(plan.entrees, 1, 'le retrait est EXACT : source ET lot');
    });

    // ───────── le nom TRADUIT : se compare par ce qui ne se traduit pas (Pokédex + PV + règle), et seulement avec numéro ET code du set concordants ─────────
    // La règle est celle de tpc.js (dexDuNom, reglesDuNom : jamais recopiées, §21 bis). Un manifeste sans dex/pv/regle/codeSet garde le comportement d'avant.
    const lueBrut = lue;
    {   // (bloc : `lue` rend ici { ok, motifs } sans les drapeaux ; `drap` rend les drapeaux — marques qui n'empêchent rien mais que le coordinateur doit voir)
    const lue = (e, p = produit()) => { const r = lueBrut(e, p); return { ok: r.ok, motifs: r.motifs }; };
    const drap = (e, p = produit()) => lueBrut(e, p).drapeaux ?? [];
    const trad = (o = {}) => entree({ attendu: { ...entree().attendu, numero: '005' }, lu: { nom: 'メリープ', numero: '005', total: '021', langue: 'ja', tampon: null, finition: 'normale', marques: ['code svAL imprimé'], codeSet: 'svAL', dex: 179, pv: 60, ...o } });
    const ptrad = (o = {}) => produit({ tirage: 'jp', numero: '005', carteId: -1, slugSet: 'Starter-Set-AL', slug: 'Mareep-svAL005', nomEn: 'Mareep', ...o });
    const mt = (e, p) => lue(e, p).motifs.join(',');
    await test('nom traduit : fiche simple japonaise (sans carte, sans nomJa) : passe par Pokédex + PV + règle + code + numéro', () => {
        assert.deepStrictEqual(lue(trad(), ptrad()), { ok: true, motifs: [] });
        assert.deepStrictEqual(lue(trad({ nomEn: 'Mareep' }), ptrad()), { ok: true, motifs: [] }, 'un nom anglais lu à côté du japonais (lu.nomEn) n\'est ni témoin ni obstacle');
        assert.strictEqual(lue(trad({ nom: 'Mareep' }), ptrad()).ok, false, 'un nom LATIN lu sur un scan japonais est le nom du produit recopié : refus nom-lu-hors-langue (08/11)');
        assert.strictEqual(lue(trad({ nom: 'メリープ' }), ptrad()).ok, true, 'le nom imprimé en japonais ne sert qu\'à la règle');
        assert.strictEqual(lue(trad({ codeSet: 'SVAL', numero: '5' }), ptrad()).ok, true, 'code insensible à la casse, zéros du numéro ignorés');
        assert.strictEqual(lue(trad({ nom: 'モルペコV-UNION', dex: 877, pv: 160 }), ptrad({ nomEn: 'Morpeko V-UNION [Hunger Burst]', slug: 'Morpeko-V-UNION-svAL005' })).ok, true, 'V-UNION : règle lue dans le nom (et crochets du produit retirés)');
        assert.strictEqual(lue(trad({ nom: 'ネモ', dex: 778, pv: 170 }), ptrad({ nomEn: 'Nemona' })).ok, false, 'un nom absent de la table (Dresseur) n\'a pas de Pokédex possible');
    });
    await test('nom traduit : chinois, indonésien, thaï, « ex » et « X » collés', () => {
        const zh = trad({ nom: '皮卡丘ex', langue: 'zh-hans', codeSet: 'CSV8C', numero: '071', dex: 25, pv: 190 });
        const pzh = ptrad({ tirage: 'zh-hans', numero: '071', slug: 'Pikachu-ex-CSV8C071', nomEn: 'Pikachu ex' });
        assert.deepStrictEqual(lue(zh, pzh), { ok: true, motifs: [] });
        const x = trad({ nom: '超級噴火龍Xex', langue: 'zh-hant', codeSet: 'CSV8C', numero: '071', dex: 6, pv: 360 });
        assert.deepStrictEqual(lue(x, ptrad({ tirage: 'zh-hant', numero: '071', slug: 'Mega-Charizard-X-ex-CSV8C071', nomEn: 'Mega Charizard X ex' })), { ok: true, motifs: [] }, '« Xex » : la forme se retire AVANT « ex »');
        assert.match(mt(trad({ nom: '超級噴火龍Yex', langue: 'zh-hant', codeSet: 'CSV8C', numero: '071', dex: 6, pv: 360 }), ptrad({ tirage: 'zh-hant', numero: '071', slug: 'Mega-Charizard-X-ex-CSV8C071', nomEn: 'Mega Charizard X ex' })), /regle-differente/, 'forme X contre forme Y');
        const th = trad({ nom: 'ฮิโทคาเงะ', langue: 'th', codeSet: 'MA5', numero: '012', dex: 4, pv: 70 });
        assert.deepStrictEqual(lue(th, ptrad({ tirage: 'th', numero: '012', slug: 'Charmander-MA5-012', nomEn: 'Charmander' })), { ok: true, motifs: [] });
        const id = trad({ nom: 'Charmander', langue: 'id', codeSet: 'MA5', numero: '012', dex: 4, pv: 70 });
        assert.deepStrictEqual(lue(id, ptrad({ tirage: 'id', numero: '012', slug: 'Charmander-MA5-012', nomEn: 'Charmander' })), { ok: true, motifs: [] });
        const vu = trad({ nom: 'ピカチュウV-UNION', dex: 25, pv: 130, numero: '026', codeSet: 's8a' });
        assert.deepStrictEqual(lue(vu, ptrad({ numero: '026', slug: 'Pikachu-V-UNION-s8a-026', nomEn: 'Pikachu V-UNION' })), { ok: true, motifs: [] });
        assert.match(mt(vu, ptrad({ numero: '026', slug: 'Pikachu-V-UNION-s8a-026', nomEn: 'Pikachu V' })), /regle-differente/);
    });
    await test('alias de code : mEEv→mEE et sKV→sK, deux paires exactes, dans ce sens, écrites dans la preuve', () => {
        const jolteon = trad({ nom: 'サンダース', dex: 135, pv: 110, numero: '001', total: '019', codeSet: 'mEE' });
        const pj = ptrad({ numero: '001', slug: 'Jolteon-mEEv-001', slugSet: 'MEGA-Starter-Set-Eevee-ex', nomEn: 'Jolteon' });
        assert.deepStrictEqual(lue(jolteon, pj), { ok: true, motifs: [] }, 'mEE imprimé contre un produit mEEv (slug)');
        assert.ok(drap(jolteon, pj).includes('codeAlias:mEEv→mEE'), 'l\'alias est écrit dans la preuve');
        assert.strictEqual(lue(jolteon, ptrad({ numero: '001', slug: 'Jolteon', codeSet: 'mEEv', nomEn: 'Jolteon' })).ok, true, 'mEE imprimé contre la ligne codes_set mEEv');
        const mareep = trad({ codeSet: 'sK' });
        const pm = ptrad({ slug: 'Mareep-sKV005', slugSet: 'Premium-Trainer-Box-VSTAR' });
        assert.deepStrictEqual(lue(mareep, pm), { ok: true, motifs: [] }, 'sK imprimé contre un produit sKV');
        assert.ok(drap(mareep, pm).includes('codeAlias:sKV→sK'));
        assert.match(mt(jolteon, ptrad({ numero: '001', slug: 'Jolteon-mEZ-001', nomEn: 'Jolteon' })), /code-set-different/, 'mEE contre un produit d\'un autre code');
        assert.match(mt(jolteon, ptrad({ numero: '001', slug: 'Jolteon', codeSet: 'mEZ', nomEn: 'Jolteon' })), /code-set-different/, 'idem par la ligne');
        assert.match(mt(mareep, ptrad({ slug: 'Mareep-sKX005' })), /code-set-different/, 'sK contre un autre code');
        assert.match(mt(trad({ nom: 'サンダース', dex: 135, pv: 110, numero: '001', codeSet: 'mEEv' }), ptrad({ numero: '001', slug: 'Jolteon-mEE-001', nomEn: 'Jolteon' })), /code-set-different/, 'le sens est imposé : mEEv imprimé contre un produit mEE refuse');
        assert.match(mt(trad({ codeSet: 'sKV' }), ptrad({ slug: 'Mareep-sK005' })), /code-set-different/, 'sKV imprimé contre un produit sK refuse');
        assert.match(mt(trad({ nom: 'サンダース', dex: 135, pv: 110, numero: '001', codeSet: 'mE' }), ptrad({ numero: '001', slug: 'Jolteon-mEEv-001', nomEn: 'Jolteon' })), /code-set-different/, 'aucune règle générale : « mE » contre mEEv refuse');
        assert.match(mt(trad({ codeSet: 's' }), pm), /code-set-different/, '« s » contre sKV refuse');
        assert.ok(!drap(trad(), ptrad()).some(d => d.startsWith('codeAlias')), 'aucun alias hors des deux paires : pas de drapeau');
    });
    await test('alias de code thaï : M-P/TH→M-P seul (sens unique, ligne exacte, indépendant de l\'ordre des clés)', () => {
        const th = (code, o = {}) => { const t = trad({ langue: 'th', nom: 'เมรีป', codeSet: code, numero: '069', ...o }); return { ...t, attendu: { ...t.attendu, numero: '069' } }; };
        const pth = (ligne, o = {}) => ptrad({ tirage: 'th', numero: '069', slug: 'Mareep-M-PTH069', codeSet: ligne, ...o });
        const e = th('M-P'), p = pth('M-P/TH');
        assert.deepStrictEqual(lue(e, p), { ok: true, motifs: [] }, '(a) M-P imprimé contre la ligne M-P/TH');
        assert.ok(drap(e, p).includes('codeAlias:M-P/TH→M-P'), 'le drapeau codeAlias est écrit');
        assert.match(mt(e, pth('M-P/KR')), /code-set-different/, '(b) ligne non listée');
        assert.match(mt(th('SV-P'), p), /code-set-different/, '(c) SV-P lu sur ligne M-P/TH');
        assert.strictEqual(lue(th('M-P/TH'), p).ok, true, '(d) M-P/TH lu sur M-P/TH comme avant');
        assert.match(mt(e, pth('', { slug: 'Mareep-M-PTH069' })), /code-set-different/, 'ligne vide + slug M-PTH069 : la branche slug ne sert pas aux clés à « / »');
        assert.match(mt(trad({ nom: 'サンダース', dex: 135, pv: 110, numero: '001', codeSet: 'mEE' }), ptrad({ numero: '001', slug: 'Jolteon-mEEv-001', codeSet: 'mEZ', nomEn: 'Jolteon' })), /code-set-different/, 'ligne mEZ + slug mEEv : la ligne non vide l\'emporte sur le slug');
        // (e) deux clés au même code imprimé : l'ordre des clés ne change rien
        const A = { 'X/1': 'ZZ', 'Y/2': 'ZZ' };
        assert.strictEqual(PV.cleAliasPour(A, 'zz', 'y/2'), 'Y/2');
        assert.strictEqual(PV.cleAliasPour({ 'Y/2': 'ZZ', 'X/1': 'ZZ' }, 'zz', 'y/2'), 'Y/2');
        assert.strictEqual(PV.cleAliasPour(A, 'zz', 'x/1'), 'X/1');
        assert.strictEqual(PV.cleAliasPour(A, 'zz', 'w/3'), undefined);
        // (f) alias existants
        assert.strictEqual(lue(trad({ codeSet: 'sK' }), ptrad({ slug: 'Mareep-sKV005', slugSet: 'Premium-Trainer-Box-VSTAR' })).ok, true, 'sKV');
    });
    await test('alias de code des promos régionales (08/11) : chaque alias passe sur SA ligne et échoue sur toute autre', () => {
        const paires = [['M-P/ID', 'M-P'], ['SV-P/ID', 'SV-P'], ['S-P/ID', 'S-P'], ['SM-P/ID', 'SM-P'], ['SV-P/TH', 'SV-P'], ['S-P/TH', 'S-P'], ['SV-P/CS', 'SV-P'], ['S-P/CS', 'S-P'], ['M-P/TH', 'M-P']];
        const lignes = ['M-P/ID', 'SV-P/ID', 'S-P/ID', 'SM-P/ID', 'SV-P/TH', 'S-P/TH', 'SV-P/CS', 'S-P/CS', 'M-P/TH', 'SV-P/KR', 'S-P/KR', 'SM-P/CS', 'M-P/CS', 'M-P/CT'];
        for (const [cm, imp] of paires) {
            const t = trad({ codeSet: imp, numero: '069' });
            const e = { ...t, attendu: { ...t.attendu, numero: '069' } };
            const pl = ligne => ptrad({ numero: '069', slug: 'Mareep-X069', codeSet: ligne });
            assert.deepStrictEqual(lue(e, pl(cm)), { ok: true, motifs: [] }, `${imp} imprimé contre la ligne ${cm}`);
            assert.ok(drap(e, pl(cm)).includes(`codeAlias:${cm}→${imp}`), `drapeau codeAlias pour ${cm}`);
            for (const autre of lignes.filter(l => !paires.some(([c2, i2]) => c2 === l && i2 === imp))) assert.match(mt(e, pl(autre)), /code-set-different/, `${imp} lu sur la ligne ${autre} refuse`);
        }
    });
    await test('V / VMAX / VSTAR sans Pokédex lu : PV + attaques (dégâts) + code + numéro, liste fermée (08/11)', () => {
        const attaquesLues = [{ nom: '风暴俯冲', degats: 220 }, { nom: '星耀汇聚', degats: null }];
        const lugia = (o = {}) => entree({ attendu: { ...entree().attendu, numero: '161' }, lu: { nom: '洛奇亚VSTAR', numero: '161', total: '131', langue: 'zh-hans', tampon: null, finition: 'normale', marques: ['code cs6aC imprimé'], codeSet: 'cs6aC', pv: 280, attaques: attaquesLues, ...o } });
        const plugia = (o = {}) => ptrad({ tirage: 'zh-hans', numero: '161', slug: 'Lugia-VSTAR-cs6aC-161', codeSet: 'cs6aC', nomEn: 'Lugia VSTAR', nomEnCarte: 'Lugia VSTAR', pv: 280, categorie: 'pokemon', attaquesCarte: [{ nom: 'Tempest Dive', degats: '220' }], ...o });
        assert.ok(Array.isArray(PV.REGLES_SANS_POKEDEX) && PV.REGLES_SANS_POKEDEX.join() === 'V,VMAX,VSTAR' && Object.isFrozen(PV.REGLES_SANS_POKEDEX), 'liste fermée exportée et gelée');
        assert.deepStrictEqual(lue(lugia(), plugia()), { ok: true, motifs: [] }, 'Lugia VSTAR accepté');
        assert.ok(drap(lugia(), plugia()).includes('temoin-regle-sans-pokedex:VSTAR'), 'drapeau écrit');
        assert.ok(!drap(lugia(), plugia()).includes('pv-non-verifie'), 'pas de drapeau pv-non-verifie dans cette variante');
        assert.match(mt(lugia({ pv: 270 }), plugia()), /pv-different/, 'PV faux');
        assert.match(mt(lugia({ pv: null }), plugia()), /pv-non-lu/, 'PV non lu');
        assert.match(mt(lugia(), plugia({ pv: null })), /pv-de-base-inconnu/, 'PV de base inconnu = refus');
        assert.match(mt(lugia({ attaques: [{ nom: '风暴俯冲', degats: 210 }, { nom: '星耀汇聚', degats: null }] }), plugia()), /attaques-differentes/, 'dégâts faux');
        assert.match(mt(lugia({ attaques: [{ nom: '星耀汇聚', degats: null }] }), plugia()), /attaques-differentes/, 'attaque en moins');
        assert.match(mt(lugia({ attaques: [{ nom: '风暴俯冲', degats: 220 }, { nom: 'X', degats: 30 }] }), plugia()), /attaques-differentes/, 'attaque en plus');
        assert.match(mt(lugia({ attaques: [] }), plugia()), /attaques-non-lues/, 'aucune attaque lue');
        assert.match(mt(lugia({ attaques: undefined }), plugia()), /attaques-non-lues/, 'champ absent');
        assert.match(mt(lugia({ attaques: [{ nom: '', degats: 220 }] }), plugia()), /attaques-non-lues/, 'nom d\'attaque vide');
        assert.match(mt(lugia({ attaques: [{ nom: '风暴俯冲', degats: '220' }] }), plugia()), /attaques-non-lues/, 'dégâts en texte : illisible');
        assert.match(mt(lugia(), plugia({ attaquesCarte: null })), /attaques-de-base-inconnues/, 'base sans attaques');
        assert.match(mt(lugia(), plugia({ attaquesCarte: [{ nom: 'Tempest Dive', degats: null }] })), /attaques-de-base-inconnues|attaques-differentes/, 'base sans dégâts : refus');
        assert.match(mt(lugia({ attaques: [{ nom: '星耀汇聚', degats: null }] }), plugia({ attaquesCarte: [{ nom: 'Star Requiem', degats: null }] })), /attaques-de-base-inconnues/, 'base ET lecture sans aucune attaque à dégâts : refus, pas égalité de deux suites vides');
        assert.match(mt(lugia({ regle: 'V' }), plugia()), /regle-incoherente/, 'lu.regle posé et différent de la règle du nom lu : refus');
        assert.match(mt(lugia(), plugia({ attaquesCarte: [{ nom: 'Tempest Dive', degats: '220' }, { nom: 'X', degats: '-' }] })), /attaques-de-base-inconnues/, 'dégât de base illisible (« - ») : motif exact attaques-de-base-inconnues');
        assert.match(mt(lugia(), plugia({ attaquesCarte: [{ nom: 'Tempest Dive', degats: '220' }, { nom: 'X', degats: '20+10' }] })), /attaques-de-base-inconnues/, 'dégât de base illisible (« 20+10 ») : idem');
        assert.match(mt(lugia({ codeSet: 'cs6bC' }), plugia()), /code-set-different/, 'code du set faux');
        assert.match(mt(lugia({ numero: '160' }), plugia()), /numero-different/, 'numéro faux');
        assert.match(mt(lugia({ nom: '洛奇亚VMAX' }), plugia()), /pokedex-non-lu/, 'règle lue ≠ règle du produit : variante fermée, règle actuelle (refus)');
        // hors liste : la règle actuelle, inchangée
        const exSans = (o = {}) => lugia({ nom: '洛奇亚ex', ...o });
        assert.match(mt(exSans(), plugia({ nomEn: 'Lugia ex', nomEnCarte: 'Lugia ex' })), /pokedex-non-lu/, 'ex sans dex : pokedex-non-lu');
        assert.match(mt(lugia({ nom: '洛奇亚GX' }), plugia({ nomEn: 'Lugia GX', nomEnCarte: 'Lugia GX' })), /pokedex-non-lu/, 'GX sans dex');
        assert.match(mt(lugia({ nom: '洛奇亚' }), plugia({ nomEn: 'Lugia', nomEnCarte: 'Lugia' })), /pokedex-non-lu/, 'aucune règle');
        assert.match(mt(lugia({ nom: '洛奇亚V' }), plugia({ nomEn: 'Lugia VSTAR', nomEnCarte: 'Lugia VSTAR' })), /regle-differente|nom-produit-carte-divergent|pokedex-non-lu/, 'V lu contre VSTAR produit : jamais accepté');
        assert.notDeepStrictEqual(lue(lugia({ nom: '洛奇亚V' }), plugia({ nomEn: 'Lugia VSTAR', nomEnCarte: 'Lugia VSTAR' })).ok, true);
        // lu.dex présent : règle actuelle (Pokédex 249 attendu)
        assert.strictEqual(lue(lugia({ dex: 249 }), plugia()).ok, true, 'avec dex correct : règle actuelle');
        assert.ok(!drap(lugia({ dex: 249 }), plugia()).includes('temoin-regle-sans-pokedex:VSTAR'), 'avec dex : pas la variante');
        assert.match(mt(lugia({ dex: 250 }), plugia()), /pokedex-different/, 'dex faux : règle actuelle');
        assert.match(mt(lugia({ dex: 249.5 }), plugia()), /pokedex-non-lu/, 'dex illisible présent : règle actuelle, pas la variante');
        // un Dresseur : inchangé
        assert.match(mt(lugia({ nom: '奇树VSTAR' }), plugia({ nomEn: 'Nemona VSTAR', nomEnCarte: 'Nemona VSTAR', categorie: 'dresseur' })), /nom-traduit-sans-temoin/, 'Dresseur : inchangé');
    });
    await test('illustration pleine sans Pokédex (08/11) : liste FERMÉE de deux produits indonésiens, PV + dégâts + code + numéro', () => {
        assert.ok(Array.isArray(PV.ILLUSTRATIONS_PLEINES_SANS_POKEDEX) && PV.ILLUSTRATIONS_PLEINES_SANS_POKEDEX.join() === '879266,859859' && Object.isFrozen(PV.ILLUSTRATIONS_PLEINES_SANS_POKEDEX), 'liste fermée exportée et gelée');
        const wl = (o = {}) => entree({ idProduct: 879266, attendu: { ...entree().attendu, numero: '059' }, lu: { nom: 'Wattrel Mistika', numero: '059', total: null, langue: 'id', tampon: null, finition: 'normale', marques: ['code M-P imprimé'], codeSet: 'M-P', pv: 60, attaques: [{ nom: 'Serangan Cepat', degats: 10 }], ...o } });
        const pw = (o = {}) => ptrad({ idProduct: 879266, tirage: 'id', numero: '059', slug: 'Iono-s-Wattrel-M-P059', codeSet: 'M-P/ID', nomEn: "Iono's Wattrel", nomEnCarte: "Iono's Wattrel", pv: 60, categorie: 'pokemon', attaquesCarte: [{ nom: 'Quick Attack', degats: '10+' }], ...o });
        const mr = (o = {}) => entree({ idProduct: 859859, attendu: { ...entree().attendu, numero: '253' }, lu: { nom: 'Meowth Tim Roket', numero: '253', total: null, langue: 'id', tampon: null, finition: 'normale', marques: ['code SV-P imprimé'], codeSet: 'SV-P', pv: 70, attaques: [{ nom: 'Kucing Maling', degats: null }, { nom: 'Cakaran Kacau', degats: 20 }], ...o } });
        const pm = (o = {}) => ptrad({ idProduct: 859859, tirage: 'id', numero: '253', slug: 'Team-Rocket-s-Meowth-SV-P253', codeSet: 'SV-P/ID', nomEn: "Team Rocket's Meowth", nomEnCarte: "Team Rocket's Meowth", pv: 70, categorie: 'pokemon', attaquesCarte: [{ nom: 'Pilfer', degats: null }, { nom: 'Scratch Frenzy', degats: '20×' }], ...o });
        assert.deepStrictEqual(lue(wl(), pw()), { ok: true, motifs: [] }, 'Wattrel accepté');
        assert.ok(drap(wl(), pw()).includes('temoin-illustration-pleine-sans-pokedex'), 'drapeau Wattrel');
        assert.deepStrictEqual(lue(mr(), pm()), { ok: true, motifs: [] }, 'Meowth accepté');
        assert.ok(drap(mr(), pm()).includes('temoin-illustration-pleine-sans-pokedex'), 'drapeau Meowth');
        assert.match(mt(wl({ pv: 70 }), pw()), /pv-different/, 'PV différent');
        assert.match(mt(wl({ pv: null }), pw()), /pv-non-lu/, 'PV non lu');
        assert.match(mt(wl({ attaques: [{ nom: 'Serangan Cepat', degats: 20 }] }), pw()), /attaques-differentes/, 'dégâts différents');
        assert.match(mt(wl({ attaques: [] }), pw()), /attaques-non-lues/, 'attaques non lues');
        assert.match(mt(wl({ attaques: undefined }), pw()), /attaques-non-lues/, 'champ absent');
        assert.match(mt(wl({ attaques: [{ nom: 'Serangan Cepat', degats: '10+' }] }), pw()), /attaques-non-lues/, 'dégâts en chaîne refusés');
        assert.match(mt(wl(), pw({ attaquesCarte: [{ nom: 'Quick Attack', degats: null }] })), /attaques-de-base-inconnues/, 'base sans dégâts');
        assert.match(mt(wl({ codeSet: 'SV-P' }), pw()), /code-set-different/, 'code faux');
        assert.match(mt(wl({ numero: '058' }), pw()), /numero-different/, 'numéro faux');
        assert.ok(!lue(wl({ langue: 'th' }), pw({ tirage: 'th' })).ok, 'langue th refusée');
        assert.ok(!lue(wl({ langue: 'ja' }), pw({ tirage: 'jp' })).ok, 'langue ja refusée');
        assert.ok(!lue(wl({ dex: 744 }), pw()).ok && !drap(wl({ dex: 744 }), pw()).includes('temoin-illustration-pleine-sans-pokedex'), 'avec dex : pas la variante');
        // hors liste, mêmes lectures : refus comme avant
        const hors = lue({ ...wl(), idProduct: 879267 }, pw({ idProduct: 879267 }));
        assert.strictEqual(hors.ok, false, 'produit hors liste refusé');
        assert.ok(!drap({ ...wl(), idProduct: 879267 }, pw({ idProduct: 879267 })).includes('temoin-illustration-pleine-sans-pokedex'));
        // un V ordinaire : inchangé
        const v = lue(entree({ attendu: { ...entree().attendu, numero: '161' }, lu: { nom: '洛奇亚VSTAR', numero: '161', total: '131', langue: 'zh-hans', tampon: null, finition: 'normale', marques: ['code cs6aC imprimé'], codeSet: 'cs6aC', pv: 280, attaques: [{ nom: 'a', degats: 220 }, { nom: 'b', degats: null }] } }), ptrad({ tirage: 'zh-hans', numero: '161', slug: 'Lugia-VSTAR-cs6aC-161', codeSet: 'cs6aC', nomEn: 'Lugia VSTAR', nomEnCarte: 'Lugia VSTAR', pv: 280, categorie: 'pokemon', attaquesCarte: [{ nom: 'T', degats: '220' }] }));
        assert.strictEqual(v.ok, true, 'V ordinaire inchangé');
    });
    // ───────── (08/11, décision du testeur) A : le nom lu doit être écrit dans l'ÉCRITURE de la langue lue ─────────
    await test('A : nom lu contre langue — th, zh, ja, ko : un nom latin est refusé nom-lu-hors-langue, un nom dans la bonne écriture passe ce contrôle', () => {
        const cas = [['th', 'th', 'Energy Search', 'ค้นหาพลังงาน'], ['zh-hans', 'zh-hans', 'Energy Search', '能量搜索'], ['zh-hant', 'zh-hant', 'Energy Search', '能量搜尋'],
            ['ja', 'jp', 'Energy Search', 'エネルギーサーチ'], ['ja', 'jp', 'Mareep', 'ネモ'], ['ja', 'jp', 'Mareep', 'ﾒﾘｰﾌﾟ'], ['ko', 'ko', 'Energy Search', '에너지 서치']];
        for (const [langue, tirage, latin, ecrit] of cas) {
            const e = nom => trad({ langue, nom, dex: null, pv: null }), p = ptrad({ tirage, nomEn: 'Energy Search', categorie: 'energie' });
            assert.match(mt(e(latin), p), /nom-lu-hors-langue/, `${langue} « ${latin} » refusé`);
            assert.ok(!/nom-lu-hors-langue/.test(mt(e(ecrit), p)), `${langue} « ${ecrit} » : écriture conforme`);
        }
        assert.match(mt(trad({ nom: '' }), ptrad()), /nom-lu-hors-langue/, 'nom vide : aucun caractère de l\'écriture');
        assert.match(mt(trad({ langue: 'th', nom: 'エネルギー' }), ptrad({ tirage: 'th' })), /nom-lu-hors-langue/, 'kana lu comme thaï : refus');
        assert.match(mt(trad({ langue: 'ko', nom: '能量' }), ptrad({ tirage: 'ko' })), /nom-lu-hors-langue/, 'han lu comme coréen : refus');
        // le contrôle passe AVANT tout autre jugement du nom : un nom latin identique au nom du produit ne l'esquive pas
        assert.match(mt(trad({ langue: 'th', nom: 'Energy Search', dex: null, pv: null }), ptrad({ tirage: 'th', nomEn: 'Energy Search', categorie: 'energie' })), /nom-lu-hors-langue/);
        // une langue latine (en, fr) n'est pas concernée
        assert.ok(!/nom-lu-hors-langue/.test(mt(entree(), produit())));
    });
    await test('A : exceptions = liste FERMÉE, prouvée sur l\'image (ENERGY sur une Énergie japonaise, POKEMON MACHINE 549156) ; le reste est refusé', () => {
        assert.ok(Object.isFrozen(PV.NOMS_LATINS_IMPRIMES) && Array.isArray(PV.NOMS_LATINS_IMPRIMES), 'liste exportée et gelée');
        const e = nom => trad({ nom, dex: null, pv: null, codeSet: 'PCG-P' });
        const p = (o = {}) => ptrad({ nomEn: 'Basic Grass Energy', slug: 'Basic-Grass-Energy-PCG-P055', categorie: 'energie', ...o });
        const j = (nom, o) => mt(e(nom), p(o));
        assert.ok(!/nom-lu-hors-langue/.test(j('ENERGY')), 'ENERGY imprimé sur une Énergie japonaise : exempté');
        assert.match(j('ENERGY', { categorie: 'dresseur' }), /nom-lu-hors-langue/, 'ENERGY sur un Dresseur : refus');
        assert.match(j('ENERGY', { categorie: null }), /nom-lu-hors-langue/, 'catégorie inconnue : refus');
        assert.match(j('ENERGY', { categorie: 'pokemon' }), /nom-lu-hors-langue/, 'ENERGY sur un Pokémon : refus');
        assert.match(j('Energy'), /nom-lu-hors-langue/, 'pas de casse tolérée');
        assert.match(j('Lightning Energy (ENERGY, foil)'), /nom-lu-hors-langue/, 'le nom du produit glissé dans lu.nom : refus (N8I2)');
        assert.match(j('Grass Energy'), /nom-lu-hors-langue/, 'JP-HB710 : nom anglais : refus');
        assert.match(mt(trad({ langue: 'th', nom: 'ENERGY', dex: null, pv: null, codeSet: 'PCG-P' }), ptrad({ tirage: 'th', categorie: 'energie' })), /nom-lu-hors-langue/, 'ENERGY n\'est exempté que pour le japonais');
        const pm = (o = {}) => mt(trad({ nom: 'POKEMON MACHINE', dex: null, pv: null, codeSet: null }), ptrad({ idProduct: 549156, nomEn: 'Pokémon Machine', numero: null, categorie: 'dresseur', ...o }));
        assert.ok(!/nom-lu-hors-langue/.test(pm()), 'POKEMON MACHINE du produit 549156 : exempté');
        assert.match(pm({ idProduct: 549157 }), /nom-lu-hors-langue/, 'un autre produit : refus');
    });
    await test('A : id (latin) — un Dresseur ou une Énergie dont lu.nom est identique au nom du produit est refusé nom-lu-identique-produit ; un Pokémon reste jugé par la règle existante', () => {
        assert.ok(Object.isFrozen(PV.NOMS_ID_IMPRIMES_IDENTIQUES) && Array.isArray(PV.NOMS_ID_IMPRIMES_IDENTIQUES), 'liste exportée et gelée');
        const id = (nom, o = {}) => trad({ langue: 'id', nom, dex: null, pv: null, codeSet: 'SV-P/ID', ...o });
        const pid = (o = {}) => ptrad({ tirage: 'id', slug: 'Switch-SV-PID005', slugSet: 'Scarlet-Violet-Indonesian-Promos', codeSet: 'SV-P/ID', nomEn: 'Switch', categorie: 'dresseur', ...o });
        assert.match(mt(id('Switch'), pid()), /nom-lu-identique-produit/, 'Dresseur identique');
        assert.match(mt(id('switch'), pid()), /nom-lu-identique-produit/, 'casse ignorée');
        assert.match(mt(id('Basic Fire Energy'), pid({ nomEn: 'Basic Fire Energy', categorie: 'energie' })), /nom-lu-identique-produit/, 'Énergie identique');
        assert.match(mt(id('Switch'), pid({ categorie: null })), /nom-lu-identique-produit/, 'catégorie inconnue et nom sans Pokédex : traité comme non-Pokémon');
        assert.ok(!/nom-lu-identique-produit/.test(mt(id('Tukar Pokémon'), pid())), 'nom traduit : pas ce motif');
        const poke = id('Charmander', { dex: 4, pv: 70, codeSet: 'MA5', numero: '012' });
        assert.deepStrictEqual(lue(poke, ptrad({ tirage: 'id', numero: '012', slug: 'Charmander-MA5-012', nomEn: 'Charmander', categorie: 'pokemon' })), { ok: true, motifs: [] }, 'Pokémon id : inchangé');
        assert.deepStrictEqual(lue(poke, ptrad({ tirage: 'id', numero: '012', slug: 'Charmander-MA5-012', nomEn: 'Charmander' })), { ok: true, motifs: [] }, 'Pokémon id sans catégorie : inchangé');
        // la liste fermée des noms propres réellement imprimés à l'identique (relus sur scans le 2026-11-08) : cinq noms, ni plus ni moins ; PokéPad en est exclu
        assert.deepStrictEqual([...PV.NOMS_ID_IMPRIMES_IDENTIQUES], ['Dawn', 'Tool Scrapper', 'Judge', 'Guzma', 'Gladion', 'Volkner', 'Ingo & Emmet', 'Lisia', 'Whitney', 'Kahili', 'Faba', 'Mina', 'Nanu', 'Cynthia', 'Gardenia', 'Mars', 'Bonnie', 'Diantha',
            'Looker', 'Jasmine', 'Morgan', 'Dana', 'Evelyn', 'Nita', 'Hala', 'Plumeria', 'Lusamine', 'Ilima', 'Kiawe', 'Lana', 'Hau', 'Olivia']);
        for (const n of PV.NOMS_ID_IMPRIMES_IDENTIQUES) assert.strictEqual(PV.motifNomLuIdentiqueProduit({ langue: 'id', nom: n }, { nomEn: n, categorie: 'dresseur' }), null, `${n} : admis (id)`);
        assert.strictEqual(PV.motifNomLuIdentiqueProduit({ langue: 'id', nom: 'PokéPad' }, { nomEn: 'Poké Pad', categorie: 'dresseur' }), null, 'PokéPad imprimé ≠ Poké Pad produit : le contrôle ne se déclenche pas');
        assert.ok(!PV.NOMS_ID_IMPRIMES_IDENTIQUES.some(n => /pok.?.?pad/i.test(n)), 'PokéPad n\'est pas dans la liste');
        // la liste ne vaut que pour l'indonésien : un autre latin n'est pas excusé, et le nom d'une langue à écriture propre reste refusé
        for (const [langue, tirage] of [['th', 'th'], ['ja', 'jp'], ['zh-hans', 'zh-hans']])
            assert.match(mt(trad({ langue, nom: 'Dawn', dex: null, pv: null }), ptrad({ tirage, nomEn: 'Dawn', categorie: 'dresseur' })), /nom-lu-hors-langue/, `${langue} : « Dawn » refusé malgré la liste`);
        assert.match(mt(trad({ langue: 'id', nom: 'Dawn', dex: null, pv: null, codeSet: 'SV-P/ID' }), ptrad({ tirage: 'id', nomEn: 'Dawn', categorie: 'dresseur', slug: 'Dawn-SV-PID005', codeSet: 'SV-P/ID' })), /^$|nom-traduit-sans-temoin|^(?!.*nom-lu-identique-produit)/, 'id : Dawn n\'est pas refusé par le contrôle d\'identité');
        const lu = { langue: 'id', nom: 'Switch' }, pd = { nomEn: 'Switch', categorie: 'dresseur' };
        assert.strictEqual(PV.motifNomLuIdentiqueProduit(lu, pd), 'nom-lu-identique-produit');
        assert.strictEqual(PV.motifNomLuIdentiqueProduit({ langue: 'en', nom: 'Switch' }, pd), null, 'langue autre que id : le contrôle ne s\'applique pas');
        assert.strictEqual(PV.motifNomLuIdentiqueProduit(lu, pd, ['Switch']), null, 'liste injectée : admis');
        assert.strictEqual(PV.motifNomLuIdentiqueProduit(lu, { ...pd, nomEn: 'Switch [Foo]' }, ['Switch']), null);
        assert.strictEqual(PV.motifNomLuIdentiqueProduit(lu, pd, ['Judge']), 'nom-lu-identique-produit');
    });
    // ───────── B : Dresseur / Énergie au nom traduit : numéro + code + langue + illustration relue, liste fermée ─────────
    await test('B : règle illustration relue (fichier VALIDATIONS, hors manifeste) — acceptée complète, chaque condition manquante refuse', () => {
        assert.deepStrictEqual([...PV.REGLES_NOM_TRADUIT_DRESSEUR], ['M-P/ID', 'SV-P/ID', 'S-P/ID', 'SM-P/ID', 'M-P/TH']);
        assert.ok(Object.isFrozen(PV.REGLES_NOM_TRADUIT_DRESSEUR));
        const ill = (o = {}) => ({ idProduct: 1001, sha256: H1, reference: 'cartes/77/swtich-id.webp', par: 'coordinateur', le: '2026-11-08', ...o });
        const eid = (o = {}) => trad({ langue: 'id', nom: 'Tukar Pokémon', dex: null, pv: null, codeSet: 'SV-P/ID', ...o });
        const pid = (o = {}) => ptrad({ tirage: 'id', slug: 'Switch-SV-PID005', slugSet: 'Scarlet-Violet-Indonesian-Promos', codeSet: 'SV-P/ID', nomEn: 'Switch', categorie: 'dresseur', carteId: 77, cleR2Carte: ['cartes/77/autre.webp', 'cartes/77/swtich-id.webp'], illustrationsRelues: [ill()], ...o });
        assert.deepStrictEqual(lue(eid(), pid()), { ok: true, motifs: [] }, 'complète : acceptée');
        assert.deepStrictEqual(drap(eid(), pid()), ['temoin-illustration-relue:SV-P/ID'], 'drapeau écrit');
        assert.strictEqual(lue(eid(), pid({ categorie: 'energie', nomEn: 'Basic Fire Energy' })).ok, true, 'Énergie : acceptée');
        // thaï, ligne M-P/TH (alias de code M-P/TH→M-P) et nom thaï
        const eth = trad({ langue: 'th', nom: 'เปลี่ยน', dex: null, pv: null, codeSet: 'M-P', numero: '069' });
        const pth = ptrad({ tirage: 'th', numero: '069', slug: 'Switch-M-PTH069', slugSet: 'M-P-Thai-Promos', codeSet: 'M-P/TH', nomEn: 'Switch', categorie: 'dresseur', cleR2Carte: ['cartes/77/swtich-id.webp'], illustrationsRelues: [ill()] });
        assert.deepStrictEqual(lue({ ...eth, attendu: { ...eth.attendu, numero: '069' } }, pth), { ok: true, motifs: [] }, 'M-P/TH accepté');
        for (const l of ['M-P/ID', 'S-P/ID', 'SM-P/ID']) assert.strictEqual(lue(eid({ codeSet: l }), pid({ codeSet: l })).ok, true, l);
        // conditions manquantes
        assert.match(mt(eid({ codeSet: 'SV-P/TH' }), pid({ codeSet: 'SV-P/TH' })), /nom-traduit-sans-temoin/, 'ligne hors liste (SV-P/TH)');
        assert.match(mt(eid({ codeSet: 'CSV8C' }), pid({ codeSet: 'CSV8C', slug: 'Switch-CSV8C005' })), /nom-traduit-sans-temoin/, 'autre ligne');
        assert.ok(!lue(eid(), pid({ categorie: 'pokemon', nomEn: 'Mareep', nomEnCarte: 'Mareep' })).ok, 'un Pokémon n\'emprunte jamais cette voie');
        assert.ok(!drap(eid(), pid({ categorie: 'pokemon', nomEn: 'Mareep' })).some(d => d.startsWith('temoin-illustration-relue')));
        assert.match(mt(eid(), pid({ categorie: null })), /nom-traduit-sans-temoin/, 'catégorie inconnue : pas la voie');
        assert.match(mt(eid(), pid({ illustrationsRelues: undefined })), /nom-traduit-sans-temoin/, 'aucune relecture au fichier : comme avant');
        assert.match(mt(eid(), pid({ illustrationsRelues: [] })), /nom-traduit-sans-temoin/, 'fichier sans ce produit : comme avant');
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ idProduct: 1002 })] })), /nom-traduit-sans-temoin/, 'relecture d\'un AUTRE produit : comme avant');
        // un lu.illustrationRelue dans le MANIFESTE est ignoré : il ne suffit jamais, même complet et à la bonne référence
        const signe = { par: 'coordinateur', reference: 'cartes/77/swtich-id.webp', le: '2026-11-08' };
        assert.match(mt(eid({ illustrationRelue: signe }), pid({ illustrationsRelues: undefined })), /nom-traduit-sans-temoin/, 'signature du manifeste : ignorée');
        assert.ok(!drap(eid({ illustrationRelue: signe }), pid({ illustrationsRelues: [] })).some(d => d.startsWith('temoin-illustration-relue')));
        assert.match(mt(eid({ illustrationRelue: signe }), pid({ illustrationsRelues: [ill({ reference: 'cartes/77/inconnue.webp' })] })), /illustration-non-relue/, 'le manifeste ne rattrape pas un fichier faux');
        // le fichier : même idProduct ET même sha256 que l'image jugée, référence = une cleR2 de la carte
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ sha256: H2 })] })), /illustration-non-relue/, 'sha256 d\'une autre image');
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ reference: 'cartes/77/inconnue.webp' })] })), /illustration-non-relue/, 'référence absente des images de la carte');
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ reference: undefined })] })), /illustration-non-relue/, 'référence manquante');
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ reference: '' })] })), /illustration-non-relue/, 'référence vide');
        assert.match(mt(eid(), pid({ cleR2Carte: undefined })), /illustration-non-relue/, 'images de la carte inconnues');
        assert.match(mt(eid(), pid({ cleR2Carte: [] })), /illustration-non-relue/, 'la carte n\'a aucun visuel');
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ par: 'chasseur' })] })), /illustration-non-relue/, 'par autre que coordinateur');
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ le: 'hier' })] })), /illustration-non-relue/, 'date illisible');
        assert.match(mt(eid(), pid({ illustrationsRelues: [ill({ le: undefined })] })), /illustration-non-relue/, 'date absente');
        assert.strictEqual(lue(eid(), pid({ illustrationsRelues: [ill({ sha256: H2 }), ill()] })).ok, true, 'une entrée juste parmi d\'autres suffit');
        assert.match(mt(eid({ langue: 'th', nom: 'เปลี่ยน' }), pid()), /langue-differente/, 'langue lue autre que celle du tirage');
        assert.ok(!lue(eid({ nom: '' }), pid()).ok, 'nom vide');
        assert.match(mt(eid({ codeSet: 'SV-P/ID', numero: '006' }), pid()), /numero-different/, 'numéro faux : la comparaison reste');
        assert.match(mt(eid(), pid({ slug: 'Switch', codeSet: 'S-P/ID' })), /code-set-different/, 'code faux : la comparaison reste');
        assert.ok(!lue(eid({ codeSet: null }), pid()).ok, 'code non lu : refus');
        // l'écriture thaïe doit rester thaïe : le contrôle A passe avant la règle B
        assert.match(mt({ ...eth, lu: { ...eth.lu, nom: 'Switch' }, attendu: { ...eth.attendu, numero: '069' } }, pth), /nom-lu-hors-langue/, 'A avant B');
        // forme du fichier (lireIllustrations) : comme les validations, il LÈVE sur une entrée mal formée
        assert.deepStrictEqual(PV.lireIllustrations([ill()]).map(i => [i.idProduct, i.sha256, i.reference, i.par]), [[1001, H1, 'cartes/77/swtich-id.webp', 'coordinateur']]);
        assert.throws(() => PV.lireIllustrations({}), /tableau/, 'non tableau');
        for (const [nom, v] of [['idProduct', ill({ idProduct: 0 })], ['sha256', ill({ sha256: 'zz' })], ['reference', ill({ reference: '' })], ['par', ill({ par: 'chasseur' })], ['date', ill({ le: 'hier' })]])
            assert.throws(() => PV.lireIllustrations([v]), undefined, nom);
    });
    await test('A (tour de correction) : TOUTES les lettres du nom dans l\'écriture de la langue, hors marques latines imprimées (liste fermée) ; au moins une lettre de l\'écriture', () => {
        const refus = (langue, nom, tirage = langue === 'ja' ? 'jp' : langue) => /nom-lu-hors-langue/.test(mt(trad({ langue, nom, dex: null, pv: null }), ptrad({ tirage, nomEn: 'Energy Search', categorie: 'energie' })));
        assert.ok(refus('th', 'Energy Search ก'), 'un seul glyphe thaï ne sauve pas un nom anglais');
        assert.ok(refus('zh-hans', 'Energy Search 能'), 'un seul han');
        assert.ok(refus('ja', 'Energy Search ネ'), 'un seul kana');
        assert.ok(refus('ko', 'Energy Search 에', 'ko'), 'un seul hangul');
        assert.ok(refus('th', 'Vivid ก'), 'V à l\'intérieur d\'un mot latin n\'est pas une marque');
        assert.ok(refus('th', 'ก Pokémon'), 'lettre latine accentuée');
        assert.ok(refus('th', 'V'), 'une marque seule : aucune lettre de l\'écriture');
        assert.ok(refus('zh-hans', 'VSTAR'), 'idem');
        for (const [langue, nom] of [['th', 'โรตอมV'], ['zh-hans', '洛奇亚VSTAR'], ['th', 'กาไบต์ ของซิโรนะ'], ['zh-hans', '洗翠 野蛮鲈鱼'], ['zh-hant', '超級噴火龍Xex'], ['ja', 'ピカチュウVMAX'], ['ja', 'メタグロスV-UNION'],
            ['zh-hans', '皮卡丘 TAG TEAM GX'], ['ja', 'ポケモンBREAK'], ['ja', 'ミュウツーLV.X'], ['zh-hans', '喷火龙ex'], ['zh-hans', '喷火龙EX'], ['ja', '佐々木ー'], ['ko', '피카츄 V'],
            ['ja', 'MリザードンEX'], ['ja', 'ルギアＬＥＧＥＮＤ'], ['ja', 'ダグトリオチームバトル ３vs３'], ['ja', 'TVレポーター'], ['ja', 'なんでもなおしW']])
            assert.ok(!refus(langue, nom), `${langue} « ${nom} » : conforme`);
    });
    await test('A (tour de correction) : en deux-sources, le contrôle A juge les DEUX lectures', async () => {
        const ok = async () => ({ decision: 'ecrire', preuve: { regle: 'strict' } });
        const o = { a: Buffer.from('A'), b: Buffer.from('B') };
        const th = (nom, nomSeconde) => E2({ lu: { ...entree().lu, langue: 'th', nom }, seconde: seconde({ lu: { ...entree().lu, langue: 'th', nom: nomSeconde } }) });
        const p = produit({ tirage: 'th', nomEn: 'Energy Search' });
        const r1 = await deux(th('Energy Search', 'ก'), o, ok, p);
        assert.match(r1.motif, /premiere-lecture:nom-lu-hors-langue/, 'première lecture en latin : refus');
        const r2 = await deux(th('ก', 'Energy Search'), o, ok, p);
        assert.match(r2.motif, /seconde-lecture:.*nom-lu-hors-langue|seconde-lecture:/, 'seconde lecture en latin : refus');
        assert.ok(!r2.ok);
    });
    await test('A10 : motifNomLuIdentiqueProduit compare aussi le nom de la CARTE (nomEnCarte) du produit', () => {
        const lu = { langue: 'id', nom: 'Switch' };
        assert.strictEqual(PV.motifNomLuIdentiqueProduit(lu, { nomEn: 'Switch Cart', nomEnCarte: 'Switch', categorie: 'dresseur' }, []), 'nom-lu-identique-produit', 'identique au nom de la carte seulement');
        assert.strictEqual(PV.motifNomLuIdentiqueProduit(lu, { nomEn: 'Switch Cart', nomEnCarte: 'Switch Cart', categorie: 'dresseur' }, []), null, 'ni l\'un ni l\'autre');
    });
    await test('jeu fictif (forme de N8R1) : un Dresseur id à nom anglais et un Dresseur th à nom anglais sont refusés', () => {
        const eth = trad({ langue: 'th', nom: 'Energy Search', dex: null, pv: null, codeSet: 'SV-P/TH' }), pth = ptrad({ tirage: 'th', nomEn: 'Energy Search', categorie: 'energie', slug: 'Energy-Search-SV-PTH005', codeSet: 'SV-P/TH' });
        assert.ok(mt(eth, pth).includes('nom-lu-hors-langue'), 'th : nom anglais');
        const eid = trad({ langue: 'id', nom: 'Crushing Hammer', dex: null, pv: null, codeSet: 'SV-P/ID' }), pid = ptrad({ tirage: 'id', nomEn: 'Crushing Hammer', categorie: 'dresseur', slug: 'Crushing-Hammer-SV-PID005', codeSet: 'SV-P/ID' });
        assert.ok(mt(eid, pid).includes('nom-lu-identique-produit'), 'id : nom anglais identique au produit');
    });
    await test('nom traduit : chaque discordance REFUSE, avec son motif', () => {
        assert.match(mt(trad({ pv: null }), ptrad()), /pv-non-lu/, 'PV absent');
        assert.match(mt(trad({ pv: 0 }), ptrad()), /pv-non-lu/);
        assert.match(mt(trad({ pv: '60' }), ptrad()), /pv-non-lu/, 'un PV est un nombre, pas un texte');
        assert.match(mt(trad(), ptrad({ pv: 70 })), /pv-different/, 'PV faux (la carte a ses PV : ils doivent concorder)');
        assert.strictEqual(lue(trad(), ptrad({ pv: 60 })).ok, true);
        assert.match(mt(trad({ dex: 180 }), ptrad()), /pokedex-different/, 'Pokédex faux');
        assert.match(mt(trad({ dex: null }), ptrad()), /pokedex-non-lu/);
        assert.match(mt(trad({ dex: 179.5 }), ptrad()), /pokedex-non-lu/);
        assert.match(mt(trad(), ptrad({ nomEn: 'Caterpie' })), /pokedex-ambigu/, 'deux Pokédex possibles pour ce nom (table versionnée) : refus');
        assert.match(mt(trad(), ptrad({ nomEn: null })), /nom-traduit-sans-temoin/, 'nomEn absent');
        assert.match(mt(trad(), ptrad({ nomEn: 'Mareep', ndex: 180 })), /ndex-non-confirme/, 'le Pokédex de la carte contredit celui du nom (pokedex-dexids.json)');
        assert.match(mt(trad(), ptrad({ nomEn: 'Nemona', ndex: 179, slug: 'Nemona-svAL005' })), /ndex-non-confirme/, 'un ndex que la table ne peut pas confirmer (nom absent) est refusé');
        assert.match(mt(trad(), ptrad({ nomEn: 'Mareep', ndex: '179' })), /^$/, 'ndex numérique en texte : lu comme nombre');
        assert.strictEqual(lue(trad(), ptrad({ nomEn: 'Mareep', ndex: '' })).ok, true, 'ndex vide = ndex absent (le nom décide)');
        assert.strictEqual(lue(trad(), ptrad({ nomEn: 'Mareep', ndex: null })).ok, true);
        assert.match(mt(trad(), ptrad({ nomEn: 'Mareep', ndex: 'x' })), /ndex-non-confirme/, 'ndex illisible : jamais un témoin');
        assert.strictEqual(lue(trad({ dex: 10 }), ptrad({ nomEn: 'Caterpie', nomEnCarte: 'Caterpie', ndex: 10 })).ok, true, 'ndex contenu dans les Pokédex du nom : confirmé');
        // le nom du PRODUIT et celui de la CARTE disent la même chose, sinon refus : forme régionale ou règle
        assert.match(mt(trad({ nom: 'ファイヤーV', dex: 146, pv: 220 }), ptrad({ nomEnCarte: 'Moltres V', nomEn: 'Galarian Moltres V', slug: 'Moltres-V-svAL005' })), /nom-produit-carte-divergent/, 'carte « Moltres V », produit « Galarian Moltres V »');
        assert.match(mt(trad({ nom: 'ピカチュウ', dex: 25, pv: 60 }), ptrad({ nomEnCarte: 'Pikachu', nomEn: 'Pikachu ex', slug: 'Pikachu-svAL005' })), /nom-produit-carte-divergent/, 'règle différente entre carte et produit');
        assert.strictEqual(lue(trad(), ptrad({ nomEnCarte: 'Mareep', nomEn: 'Mareep [Static Shock]' })).ok, true, 'même espèce et même règle : pas de divergence');
        assert.match(mt(trad(), ptrad({ categorie: 'dresseur' })), /nom-traduit-sans-temoin/, 'la carte est un Dresseur : le Pokédex du nom ne témoigne pas');
        assert.strictEqual(lue(trad(), ptrad({ categorie: 'pokemon' })).ok, true);
        assert.match(mt(trad({ numero: '006' }), ptrad()), /numero-different/, 'numéro discordant');
        assert.match(mt(trad({ codeSet: 'svOD' }), ptrad()), /code-set-different/, 'code du set discordant (le numéro seul ne suffit pas)');
        assert.match(mt(trad({ codeSet: null }), ptrad()), /code-set-non-lu/);
        assert.match(mt(trad(), ptrad({ slug: 'Mareep' })), /code-set-non-verifiable/, 'ni slug ni ligne ne portent le code');
        assert.match(mt(trad(), ptrad({ slug: 'Mareep', codeSet: 'svAL' })), /^$/, 'la ligne (codes_set) porte le code : suffisant');
        assert.match(mt(trad(), ptrad({ slug: 'Mareep-svAL005', codeSet: 'svOD' })), /code-set-different/, 'la ligne contredit : refus même si le slug concorde');
        assert.match(mt(trad({ codeSet: 'AL' }), ptrad({ slug: 'Mareep-svAL005' })), /code-set-different/, 'le code est comparé en entier (frontière), jamais par suffixe');
        assert.match(mt(trad({ nom: 'メリープex' }), ptrad()), /regle-differente/, 'règle lue ≠ règle du produit');
        assert.match(mt(trad({ regle: 'ex' }), ptrad()), /regle-incoherente|regle-differente/, 'règle saisie ≠ nom lu');
        assert.match(mt(trad({ regle: 'V', dex: 25 }), ptrad({ nomEn: 'Pikachu V' })), /regle-incoherente/, 'règle saisie (V) et nom lu (sans règle) en désaccord');
        assert.strictEqual(lue(trad({ regle: 'V', nom: 'ピカチュウV', dex: 25 }), ptrad({ nomEn: 'Pikachu V' })).ok, true, 'règle saisie et nom lu d\'accord');
        assert.match(mt(trad({ nom: '' }), ptrad()), /nom-lu-hors-langue/, 'nom lu vide (contrôle A)');
        assert.match(mt(trad({ langue: 'zh-hans' }), ptrad()), /langue-differente/);
        assert.match(mt(trad(), ptrad({ numero: null, slug: 'Mareep-svAL' })), /nom-traduit-numero-absent/, 'produit sans numéro : le numéro est une des deux clés');
        assert.match(mt(trad({ nom: 'ガラルファイヤーV', dex: 146, pv: 220 }), ptrad({ nomEn: 'Galarian Moltres V', slug: 'Galarian-Moltres-V-svAL005' })), /forme-regionale/, 'forme régionale : le Pokédex ne la distingue pas');
        assert.match(mt(trad({ nom: 'ガラルファイヤーV', dex: 146, pv: 220 }), ptrad({ nomEn: 'Moltres V', slug: 'Moltres-V-svAL005' })), /forme-regionale/, 'forme régionale lue sur un produit qui n\'en nomme pas');
        assert.match(mt(trad({ nom: 'ファイヤーV', dex: 146, pv: 220 }), ptrad({ nomEn: 'Galarian Moltres V', slug: 'Galarian-Moltres-V-svAL005' })), /forme-regionale/, 'produit de forme régionale, nom lu qui ne la marque pas');
        assert.strictEqual(lue(trad({ nom: 'ファイヤーex', dex: 146, pv: 220 }), ptrad({ nomEn: 'Moltres ex', slug: 'Moltres-ex-svAL005' })).ok, true, 'la forme de base passe');
        assert.match(mt(trad({ langue: 'zh-hans', nom: '咩利羊' }), ptrad()), /nom-langue-non-anglaise/, 'langue lue ≠ langue du tirage : la règle du nom traduit ne s\'ouvre pas');
        assert.match(mt(trad({ nom: '洗翠' + 'V' }), ptrad({ nomEn: 'Mareep V' })), /forme-regionale/, 'marque régionale chinoise lue');
    });
    await test('nom traduit : un Dresseur ou une Énergie au nom traduit reste refusé, sauf table de traduction OFFICIELLE (nomJa d\'autres cartes de même nomEn)', () => {
        const dr = trad({ nom: 'ネモ', dex: null, pv: null, codeSet: 'svAL' });
        const pd = ptrad({ nomEn: 'Nemona', slug: 'Nemona-svAL005' });
        assert.match(mt(dr, pd), /nom-traduit-sans-temoin/, 'Dresseur : ni Pokédex ni PV');
        const temoin = { noms: ['ネモ'], cartes: 3, divergent: false };
        assert.deepStrictEqual(lue(dr, { ...pd, tableJaInterne: temoin }), { ok: true, motifs: [] });
        assert.match(mt({ ...dr, lu: { ...dr.lu, nom: 'ボタン' } }, { ...pd, tableJaInterne: temoin }), /nom-different/, 'la table contredit le nom lu');
        assert.match(mt(dr, { ...pd, tableJaInterne: { ...temoin, divergent: true } }), /nom-traduit-sans-temoin/, 'une table qui diverge entre cartes ne témoigne pas');
        assert.match(mt(dr, { ...pd, tableJaInterne: { noms: [], cartes: 0, divergent: false } }), /nom-traduit-sans-temoin/);
        // cette table vient de NOS pages carte, pas d'une source officielle : au moins DEUX cartes distinctes au même nomEn, d'accord sur le nomJa
        assert.match(mt(dr, { ...pd, tableJaInterne: { noms: ['ネモ'], cartes: 1, divergent: false } }), /table-ja-insuffisante/, 'une seule carte ne fait pas une table');
        assert.deepStrictEqual(lue(dr, { ...pd, tableJaInterne: { noms: ['ネモ'], cartes: 2, divergent: false } }), { ok: true, motifs: [] }, 'deux cartes suffisent');
        assert.ok(drap(dr, { ...pd, tableJaInterne: { noms: ['ネモ'], cartes: 2, divergent: false } }).includes('table-ja-interne'), 'la preuve dit que la table est interne');
        assert.ok(!/officiel/i.test(mt(dr, { ...pd, tableJaInterne: { noms: ['ネモ'], cartes: 1, divergent: false } })));
        assert.match(mt(dr, { ...pd, tableJaInterne: temoin, slug: 'Nemona' }), /code-set-non-verifiable/, 'la table ne dispense pas du code');
        const zh = trad({ nom: '妮莫', langue: 'zh-hans', dex: null, pv: null, codeSet: 'CSV8C' });
        assert.match(mt(zh, ptrad({ tirage: 'zh-hans', nomEn: 'Nemona', slug: 'Nemona-CSV8C005', tableJaInterne: temoin })), /nom-traduit-sans-temoin/, 'la table japonaise ne vaut pas pour le chinois');
        const energie = trad({ nom: '基本【火】能量', langue: 'zh-hans', dex: null, pv: null, codeSet: 'CSV8C' });
        assert.match(mt(energie, ptrad({ tirage: 'zh-hans', nomEn: 'Basic Fire Energy', slug: 'Basic-Fire-Energy-CSV8C005' })), /nom-traduit-sans-temoin/, 'Énergie traduite : refus');
    });
    await test('nom traduit : fiche simple sans carte : PV non vérifié (marqueur) ; un nom de produit qualifié refuse ; avec carte et PV comparé, plus de marqueur', () => {
        assert.deepStrictEqual(drap(trad(), ptrad()), ['pv-non-verifie'], 'sans carte, le PV lu n\'est comparé à rien : la preuve le dit');
        assert.deepStrictEqual(drap(trad(), ptrad({ pv: 60, nomEnCarte: 'Mareep' })), [], 'PV de la carte comparé : pas de marqueur');
        assert.deepStrictEqual(drap(trad(), ptrad({ nomEnCarte: 'Mareep' })), ['pv-non-verifie'], 'une carte sans PV connu : toujours non vérifié');
        assert.deepStrictEqual(drap(trad({ pv: 0 }), ptrad()), [], 'un refus ne porte pas de marqueur');
        for (const nom of ['Hiroshima\'s Pikachu', 'Detective Pikachu', 'Pikachu & Zekrom GX', 'Dark Charizard', 'Pikachu Libre', 'Mega Tokyo\'s Pikachu'])
            assert.match(mt(trad({ nom: '皮卡丘', dex: 25, pv: 60 }), ptrad({ nomEn: nom, slug: 'X-svAL005' })), /fiche-simple-nom-qualifie|pokedex-ambigu|nom-traduit-sans-temoin/, nom);
        assert.match(mt(trad({ nom: 'ピカチュウ', dex: 25, pv: 60 }), ptrad({ nomEn: 'Detective Pikachu [Thorough Investigation]', slug: 'X-svAL005' })), /fiche-simple-nom-qualifie/, 'qualificatif');
        assert.match(mt(trad({ nom: 'ピカチュウ', dex: 25, pv: 60 }), ptrad({ nomEn: 'Hiroshima\'s Pikachu', slug: 'X-svAL005' })), /fiche-simple-nom-qualifie/, 'propriétaire');
        assert.match(mt(trad({ nom: 'ピカチュウ', dex: 25, pv: 60 }), ptrad({ nomEn: 'Pikachu Libre', slug: 'X-svAL005' })), /fiche-simple-nom-qualifie/, 'forme');
        assert.strictEqual(lue(trad({ nom: 'ピカチュウ', dex: 25, pv: 60 }), ptrad({ nomEn: 'Pikachu', slug: 'X-svAL005' })).ok, true, 'espèce seule');
        assert.strictEqual(lue(trad({ nom: 'ピカチュウV', dex: 25, pv: 60 }), ptrad({ nomEn: 'Pikachu V', slug: 'X-svAL005' })).ok, true, 'espèce + règle');
        assert.ok(!/qualifie/.test(mt(trad({ nom: 'ピカチュウ', dex: 25, pv: 60 }), ptrad({ nomEn: 'Hiroshima\'s Pikachu', nomEnCarte: 'Hiroshima\'s Pikachu', pv: 60, slug: 'X-svAL005' }))), 'le qualificatif ne vise que la fiche SANS carte');
    });
    await test('nom traduit : jumeau dans le set = marqueur (la preuve passe, le numéro se vérifie à l\'œil) ; autre espèce, autre règle ou même numéro = pas de jumeau', () => {
        const autre = (o = {}) => ({ idProduct: 2002, numero: '006', nomEn: 'Mareep [Static Shock]', ...o });
        assert.ok(drap(trad(), ptrad({ autresDuSet: [autre()] })).includes('jumeau-dans-le-set'));
        assert.strictEqual(lue(trad(), ptrad({ autresDuSet: [autre()] })).ok, true, 'ce n\'est PAS un refus');
        for (const a of [autre({ nomEn: 'Flaaffy' }), autre({ nomEn: 'Mareep ex' }), autre({ numero: '005' }), autre({ numero: '5' }), autre({ idProduct: 1001 }), autre({ nomEn: null }), autre({ nomEn: 'Caterpie' })])
            assert.ok(!drap(trad(), ptrad({ autresDuSet: [a] })).includes('jumeau-dans-le-set'), JSON.stringify(a));
        assert.ok(!drap(trad(), ptrad()).includes('jumeau-dans-le-set'), 'sans liste des autres produits du set : pas de marqueur');
        // un autre produit de même Pokédex et même règle parmi d'autres : jumeau
        assert.ok(drap(trad(), ptrad({ autresDuSet: [autre({ nomEn: 'Flaaffy' }), autre({ idProduct: 2003, numero: '007' })] })).includes('jumeau-dans-le-set'));
    });
    await test('nom traduit : régressions — anglais, français, japonais avec nomJa, et manifestes sans témoin gardent leur comportement', () => {
        assert.deepStrictEqual(lue(entree(), produit()), { ok: true, motifs: [] });
        // japonais AVEC nomJa : la règle d\'avant, sans repli sur Pokédex (un nom japonais qui diffère reste un désaccord)
        const pj = ptrad({ nomJa: 'メリープ', carteId: 77 });
        assert.deepStrictEqual(lue(trad(), pj), { ok: true, motifs: [] });
        assert.deepStrictEqual(lue(trad({ nom: 'モココ' }), pj).motifs, ['nom-different'], 'nomJa présent et différent : pas de repli Pokédex');
        // lu sans aucun témoin : motifs d\'avant
        const nu = o => entree({ lu: { nom: 'メリープ', numero: '005', total: '021', langue: 'ja', tampon: null, finition: 'normale', marques: ['x'], ...o }, attendu: { ...entree().attendu, numero: '005' } });
        assert.deepStrictEqual(lue(nu(), ptrad()).motifs, ['nom-different']);
        assert.deepStrictEqual(lue(nu({ codeSet: '', regle: '' }), ptrad()).motifs, ['nom-different'], 'un témoin vide n\'est pas un témoin saisi');
        // toutes les marques régionales (japonais, chinois, thaï, latin) sont lues dans le nom
        // (le nom lu doit être écrit dans l'écriture de sa langue — contrôle A : chaque marque est jugée dans la sienne)
        for (const m of ['アローラ', 'ガラル', 'ヒスイ', 'パルデア', '阿羅拉', '阿罗拉', '伽勒爾', '伽勒尔', '洗翠', '帕底亞', '帕底亚'])
            assert.match(mt(trad({ nom: `${m}ピカチュウ`, dex: 25, pv: 60 }), ptrad({ nomEn: 'Pikachu', slug: 'X-svAL005' })), /forme-regionale/, m);
        for (const m of ['อโลลา', 'กาลาร์', 'ฮิซุย', 'ปัลเดีย'])
            assert.match(mt(trad({ langue: 'th', nom: `${m}พิคาชู`, dex: 25, pv: 60 }), ptrad({ tirage: 'th', nomEn: 'Pikachu', slug: 'X-svAL005' })), /forme-regionale/, m);
        assert.deepStrictEqual(lue(nu({ langue: 'zh-hans', nom: '皮卡丘' }), ptrad({ tirage: 'zh-hans' })).motifs, ['nom-langue-non-anglaise']);
        // les champs-témoin n\'ouvrent rien pour l\'anglais ni le français : le nom se compare comme avant
        assert.match(mt(entree({ lu: { ...entree().lu, nom: 'Squirtle', dex: 7, pv: 40, codeSet: 'AA' } }), produit()), /nom-different/);
        assert.match(mt(entree({ lu: { ...entree().lu, langue: 'fr', nom: 'Carapuce', dex: 7, pv: 40, codeSet: 'AA' } }), produit({ idExpansion: 2361 })), /nom-different/);
        // ni une langue hors liste (coréen) ni un tirage à deux langues
        assert.match(mt(trad({ langue: 'ko' }), ptrad({ tirage: 'jp' })), /langue-differente/);
        assert.match(mt(trad(), ptrad({ tirage: 'idth' })), /langue-du-tirage-inconnue/);
        // ➕ 2026-11-03 : un scan lu en indonésien ou en thaï sur un set idth est DU tirage (le site admet les deux) : plus de refus de langue ; le nom traduit se juge comme ailleurs
        assert.deepStrictEqual(lue(trad({ langue: 'id', nom: 'Mareep' }), ptrad({ tirage: 'idth' })), { ok: true, motifs: [] }, 'indonésien sur idth : passe');
        assert.doesNotMatch(mt(trad({ langue: 'th' }), ptrad({ tirage: 'idth' })), /langue-du-tirage-inconnue|langue-differente/, 'thaï sur idth : aucun motif de langue');
        assert.match(mt(trad({ langue: 'id', nom: 'Mareep' }), ptrad({ tirage: 'id' })), /^(?!.*langue-).*$/, 'indonésien sur id : inchangé');
        assert.match(mt(trad({ langue: 'th' }), ptrad({ tirage: 'id' })), /langue-differente/, 'thaï sur un set id seul : refusé comme avant');
    });
    // ➕ 2026-11-03 : les cartes INDONÉSIENNES impriment le nom ANGLAIS des Pokémon (les Dresseurs sont traduits) : un nom lu en indonésien identique au nom anglais du produit témoigne seul
    await test('nom indonésien (03/11) : identique au nom anglais du produit = témoin suffisant ; différent, ou thaï, ou autre tirage : règle traduite inchangée', () => {
        const idn = (o = {}) => entree({ lu: { nom: 'Mareep', numero: '005', total: '021', langue: 'id', tampon: null, finition: 'normale', marques: ['x'], ...o }, attendu: { ...entree().attendu, numero: '005' } });
        const pid = ptrad({ tirage: 'id', nomEn: 'Mareep' });
        assert.deepStrictEqual(lue(idn(), pid), { ok: true, motifs: [] }, 'nom anglais lu sur la carte indonésienne : passe sans témoin');
        assert.deepStrictEqual(lue(idn({ nom: ' mareep' }), pid), { ok: true, motifs: [] }, 'casse et espaces indifférents');
        assert.deepStrictEqual(lue(idn(), ptrad({ tirage: 'idth', nomEn: 'Mareep' })), { ok: true, motifs: [] }, 'sur un set idth lu en indonésien : passe');
        assert.deepStrictEqual(lue(idn({ dex: 179, pv: 60 }), pid), { ok: true, motifs: [] }, 'des témoins en plus ne gênent pas');
        assert.match(mt(idn({ nom: 'Flaaffy' }), pid), /nom-langue-non-anglaise/, 'un autre nom sans témoin : refus comme avant (la règle traduite ne s\'ouvre qu\'avec un témoin)');
        assert.match(mt(idn({ nom: 'Flaaffy', codeSet: 'svAL' }), pid), /nom-traduit-sans-temoin|pokedex|nom-different/, 'un autre nom avec témoin : la règle traduite juge, elle n\'accepte pas');
        assert.match(mt(idn({ langue: 'th' }), ptrad({ tirage: 'th', nomEn: 'Mareep' })), /nom-lu-hors-langue/, 'thaï : une carte thaïe n\'imprime pas le nom anglais, refus (contrôle A avant tout, 08/11)');
        assert.match(mt(idn(), ptrad({ tirage: 'jp', nomEn: 'Mareep' })), /langue-differente/, 'indonésien sur un set japonais : langue refusée');
        assert.match(mt(idn(), ptrad({ tirage: 'jp', nomEn: 'Mareep' })), /nom-langue-non-anglaise/, '… et le nom ne témoigne pas pour un autre tirage');
    });
    await test('nom traduit : ce que le chasseur a saisi (dex, pv, règle, code) est ÉCRIT dans la preuve lue, rien d\'autre', () => {
        const a = { entree: trad({ regle: undefined, libre: 'x' }), validation: validation(), produit: ptrad(), langue: 'ja' };
        const pl = PV.preuvesDe(a).preuveLue.lu;
        assert.deepStrictEqual([pl.dex, pl.pv, pl.codeSet], [179, 60, 'svAL']);
        assert.ok(!('libre' in pl));
        const ancien = PV.preuvesDe({ entree: entree(), validation: validation(), produit: produit(), langue: 'en' }).preuveLue.lu;
        assert.ok(!('dex' in ancien) && !('pv' in ancien) && !('codeSet' in ancien), 'les manifestes existants gardent la forme de leur preuve');
    });

    }   // fin du bloc « nom traduit »

    console.log(`\ntest-preuves : ${ok} OK, ${ko} KO`);
    process.exitCode = ko ? 1 : 0;
})();
