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
    const lue = (e, p = produit()) => PV.evaluerPreuveLue({ entree: e, produit: p, langueProduit: PV.langueDuProduit(p) });
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
        assert.match(motif(lu({ tampon: 'Staff' })), /tampon-different/, 'tampon lu sur un produit sans tampon');
        assert.match(motif(entree(), produit({ tamponnee: 'Staff' })), /tampon-different/, 'produit tamponné, scan sans tampon : null ≠ un tampon');
        assert.match(motif(lu({ tampon: 'Prize Pack' }), produit({ tamponnee: 'Staff' })), /tampon-different/);
        assert.strictEqual(lue(lu({ tampon: ' staff ' }), produit({ tamponnee: 'Staff' })).ok, true, 'même tampon, casse et espaces ignorés');
        assert.match(motif(lu({ marques: [] })), /marques-vides/);
        assert.match(motif(lu({ marques: undefined })), /marques-vides/);
        assert.match(motif(lu({ marques: [''] })), /marques-vides/);
        assert.match(motif(entree({ contradictions: ['une boutique dit 14'] })), /contradictions/);
        assert.match(motif(entree({ contradictions: undefined })), /contradictions/);
        assert.match(motif(entree(), produit({ tirage: 'idth' })), /langue-du-tirage-inconnue/);
    });
    await test('P2/P4 : édition française (2361) : lu.langue fr passe, en est refusée ; hors 2361/3354 le fr est refusé', () => {
        const fr = entree({ lu: { ...entree().lu, langue: 'fr' } });
        assert.strictEqual(lue(fr, produit({ idExpansion: 2361 })).ok, true);
        assert.strictEqual(lue(fr, produit({ idExpansion: 3354 })).ok, true);
        assert.match(lue(fr, produit({ idExpansion: 5000 })).motifs.join(), /langue-differente/);
        assert.match(lue(entree(), produit({ idExpansion: 2361 })).motifs.join(), /langue-differente/, 'le produit EST français : un scan anglais n\'est pas son tirage');
    });
    await test('tour 1 (1) : produit SANS numéro : lu.nom comparé au nom du produit (avant « [ », normalisation de la jointure), sinon nom-different ; avec numéro rien ne change', () => {
        const sans = produit({ numero: null, nomEn: 'Psyduck [Confusion Wave]' }), base = entree({ attendu: { ...entree().attendu, numero: null }, lu: { ...entree().lu, numero: null, total: null, nom: 'Psyduck' } });
        assert.strictEqual(lue(base, sans).ok, true);
        assert.strictEqual(lue({ ...base, lu: { ...base.lu, nom: ' PSYDUCK ' } }, sans).ok, true, 'casse et espaces ignorés (normaliserNom)');
        assert.match(lue({ ...base, lu: { ...base.lu, nom: 'Golduck' } }, sans).motifs.join(), /nom-different/);
        assert.match(lue({ ...base, lu: { ...base.lu, nom: '' } }, sans).motifs.join(), /nom-different/);
        assert.match(lue({ ...base, lu: { ...base.lu, nom: undefined } }, sans).motifs.join(), /nom-different/);
        assert.match(lue(base, produit({ numero: null, nomEn: null })).motifs.join(), /nom-different/, 'produit sans nom : rien à comparer = refus');
        const fr = entree({ lu: { ...entree().lu, nom: 'Psykokwak' } });
        assert.strictEqual(lue(fr, produit({ nomEn: 'Psyduck [Confusion Wave]' })).ok, true, 'AVEC numéro, le nom (traduit) n\'est pas comparé');
    });
    await test('P2 : produit SANS numéro : marques non vides ET attendu.numero null, sinon refus ; lu.numero/total ne sont plus exigés', () => {
        const sans = produit({ numero: null }), e = entree({ attendu: { ...entree().attendu, numero: null }, lu: { ...entree().lu, numero: null, total: null, marques: ['tampon ex'] } });
        assert.strictEqual(lue(e, sans).ok, true);
        assert.match(lue({ ...e, attendu: { ...e.attendu, numero: '5' } }, sans).motifs.join(), /numero-attendu-non-null/);
        assert.match(lue({ ...e, lu: { ...e.lu, marques: [] } }, sans).motifs.join(), /marques-vides/);
        assert.strictEqual(lue(e, produit({ numero: '' })).ok, true, 'numéro vide = pas de numéro');
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
        assert.match(await m({ lu: { ...entree().lu, tampon: 'Staff' } }), /seconde-lecture:tampon-different/);
        assert.match(await m({ lu: { ...entree().lu, marques: [] } }), /seconde-lecture:marques-vides/);
        assert.strictEqual(appels.length, avant, 'jamais appelée sur une seconde lecture qui ne tient pas');
        const lu2 = E2({ seconde: seconde({ lu: { ...entree().lu, numero: '013' } }) });
        await deux(lu2, { a: Buffer.from('A'), b: Buffer.from('B') }, oui);
        assert.deepStrictEqual(appels[1].candidats.map(c => c.tirage.numero), ['13', '013'], 'chaque source porte SA lecture');
        const tamponne = E2({ lu: { ...entree().lu, tampon: 'Staff' }, seconde: seconde({ lu: { ...entree().lu, tampon: 'Staff' } }) });
        await deux(tamponne, { a: Buffer.from('A'), b: Buffer.from('B') }, oui, produit({ tamponnee: 'Staff' }));
        assert.strictEqual(appels[2].produit.tampon, 'Staff', 'le tampon du PRODUIT est transmis à la règle d\'image');
        assert.strictEqual(appels[2].candidats[0].tirage.tampon, 'Staff', 'et celui que dit le manifeste pour la source');
        assert.strictEqual(appels[2].candidats[1].tirage.tampon, 'Staff');
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
        assert.strictEqual(n, 0);
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
    await test('tour 1 (2) : AUCUN texte libre de l\'agent n\'est écrit : une note (et une marque) qui nomme une source n\'apparaît nulle part dans l\'entrée ni le document', async () => {
        const note = 'Scan Poképédia ; TCGdex et Cardmarket concordent', e = entree({ lu: { ...entree().lu, note, zzz: 'champ libre', finition: 'holo' }, sourcesConsultees: ['pokepedia.fr'], commentaire: 'libre' });
        const { unites } = PV.grouperUnites({ acceptees: [accepte(e, produit())], fiches: FICHE(1001), famille: 'MCD' });
        const p = unites[0].champsEntree.preuveLue;
        assert.deepStrictEqual(Object.keys(p).sort(), ['lu', 'luLe', 'marques', 'regle', 'valideLe']);
        assert.deepStrictEqual(Object.keys(p.lu).sort(), ['finition', 'langue', 'nom', 'numero', 'tampon', 'total']);
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
        assert.strictEqual(u.languePreuve, 'lue sur le scan : 13/40 ; texte anglais');
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
        const p1 = produit({ idProduct: 1001 }), p2 = produit({ idProduct: 1002, tamponnee: 'Staff' });
        const e1 = entree({ varianteNommee: nommee() }), e2 = entree({ idProduct: 1002, varianteNommee: nommee(), lu: { ...entree().lu, tampon: 'Staff' } });
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
        assert.strictEqual(e.languePreuve, 'lue sur le scan : 13/40 ; texte anglais');
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
        const m = await monter({ unitesDef: [{ carteId: 100, tamponnee: 'Staff' }], cartes: [vide(100)] });
        assert.strictEqual(m.us[0].tampon, 'Staff');
        const [r] = await SILENCE(() => ecrire(m, { attendu: 1 }));
        assert.strictEqual(r.code, 0);
        assert.strictEqual(m.etat.carte(100).images[0].tampon, 'Staff'); assert.strictEqual(m.etat.image(`prv/${SLUG}/100/13/en`).tampon, 'Staff');
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
    function monde({ entrees, validations, produits = {}, etat, lignes, sets = [{ _id: SLUG, tirage: 'intl' }], cartes, famille = 'MCD', trous = [] }) {
        const racine = tmp(), cache = path.join(racine, 'CACHE');
        fs.mkdirSync(path.join(racine, famille), { recursive: true }); fs.mkdirSync(path.join(racine, 'VALIDATIONS'), { recursive: true }); fs.mkdirSync(cache, { recursive: true });
        fs.writeFileSync(path.join(racine, famille, 'preuves.json'), JSON.stringify({ famille, le: '2026-10-26T00:00:00.000Z', entrees, trous }));
        fs.writeFileSync(path.join(racine, 'VALIDATIONS', `valide-${famille}.json`), JSON.stringify(validations));
        const fauxLire = {
            lignes: async ids => lignes.filter(l => ids.includes(l.idProduct)),
            fiches: async (carteIds, slugs) => lignes.filter(l => carteIds.includes(l.carteId) && slugs.includes(l.slugSet)),
            numeros: async ids => ids.map(i => ({ idProduct: i, numero: produits[i]?.numeroNumeros ?? null })).filter(x => x.numero != null),
            sets: async slugs => sets.filter(s => slugs.includes(s._id))
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

    console.log(`\ntest-preuves : ${ok} OK, ${ko} KO`);
    process.exitCode = ko ? 1 : 0;
})();
