// Banc de la règle « remplacement-meme-dessin » de collecte-cartes/preuves.js (HD-ZH, 2026-11-01) : une preuve SANS NOM, réservée à un tirage à écriture non latine, qui REMPLACE une entrée déjà servie.
// AUCUNE base réelle, AUCUN réseau. Chaque condition de la règle doit pouvoir faire dire NON : un cas par condition (et mutants-preuves.js retire chaque garde).
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
const CLI = require('./collecte-cartes/recolte-cli');
const BD = require('./collecte-cartes/basse-definition');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 10).join('\n   ')}`); } };
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prv-zh-'));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const png = (w, h = Math.round(w * 1.4)) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 40, g: 120, b: 200 } } }).png().toBuffer();

const SLUG = 'Scarlet-Violet-Simplified-Chinese-Promos', R = 'remplacement-meme-dessin';
const CLE_ANCIENNE = 'ancienne/Scarlet-Violet-Simplified-Chinese-Promos/419--917920-zh-hans.webp';
const H1 = 'a'.repeat(64), H3 = 'c'.repeat(64);
const SHA_E = 'e'.repeat(64), SHA1_E = 'd'.repeat(40), URL_E = 'https://old.test/e.webp', MOYEN_LANGUE = 'liste-source-zh-hans+planche';
const servie = (o = {}) => ({ set: SLUG, source: 'ancienne', cleR2: CLE_ANCIENNE, numero: '419', langue: 'zh-hans', w: 300, wOriginal: 300, basseDefinition: true, sha256: SHA_E, urlOriginal: URL_E, ...o });
const docDe = (e, surcharge = {}) => ({ source: e.source, set: e.set, cleR2: e.cleR2, etat: 'ok', sha256: e.sha256, urlOriginal: e.urlOriginal, ...surcharge });
const produit = (o = {}) => {
    const images = o.imagesServies ?? [servie()];
    return { idProduct: 917920, idExpansion: 6000, tirage: 'zh-hans', tamponnee: null, numero: '419', carteId: -917920, slugSet: SLUG, slug: null, nomEn: 'Luminous Energy', nomFr: null,
        imagesServies: images, documentsServis: new Map(images.map(e => [`${e.source}|${e.set}|${e.cleR2}`, docDe(e, o.doc ?? {})])), ...o };
};
const entree = (o = {}) => ({ idProduct: 917920, regle: R, url: 'https://img.alpha.test/z/419.png', hote: 'img.alpha.test', fichier: 'C:\\x\\z.bin', sha256: H1,
    lu: { nom: null, numero: '419', total: 'SV-P', langue: 'zh-hans', langueMoyen: MOYEN_LANGUE, pageListe: 'https://img.alpha.test/liste-zh-hans/', tampon: null, moyen: 'ocr', marques: ['SV-P'] }, attendu: { numero: '419' },
    memeDessin: { cleR2: CLE_ANCIENNE, sha256: SHA_E, score: 0.998, seuil: 0.875, vide: 0.198 }, contradictions: [], luLe: '2026-11-01T00:00:00.000Z', ...o });
const lu = o => ({ ...entree().lu, ...o });
const md = o => ({ ...entree().memeDessin, ...o });
const evaluer = async (e, p = produit(), largeur = 868) => PV.evaluerEntree({ entree: e, produit: p, octets: { a: await png(largeur) } });
const non = async (e, p, motif, largeur) => { const r = await evaluer(e, p, largeur); assert.strictEqual(r.ok, false, 'ACCEPTÉE à tort'); assert.strictEqual(r.motif, `${R}:${motif}`, `motifs : ${(r.motifs || []).join(',')}`); return r; };

(async () => {
    await test('la règle existe : REGLES la nomme ; les validations du coordinateur la reconnaissent (même shape)', () => {
        assert.ok(PV.REGLES.includes(R));
        assert.strictEqual(PV.lireValidations([{ idProduct: 917920, sha256: H1, regle: R, valideLe: '2026-11-01T10:00:00Z', par: 'coordinateur', planche: 'A-prouvees-SV-P-01.jpg' }]).length, 1);
        assert.throws(() => PV.lireValidations([{ idProduct: 917920, sha256: H1, regle: R, valideLe: '2026-11-01T10:00:00Z', par: 'agent', planche: 'p.jpg' }]), /coordinateur/);
    });
    await test('liste FERMÉE des langues : zh-hans, zh-hant, th — rien d\'autre (ja rouvrira avec son durcissement, ko est inatteignable)', () => {
        assert.deepStrictEqual([...PV.LANGUES_NON_LATINES].sort(), ['th', 'zh-hans', 'zh-hant']);
        assert.ok(Object.isFrozen(PV.LANGUES_NON_LATINES));
    });
    await test('OUI : tirage zh-hans, entrée servie en basse définition, même dessin prouvé, numéro et langue lus, résolution supérieure', async () => {
        const r = await evaluer(entree());
        assert.deepStrictEqual([r.ok, r.regle], [true, R]);
    });
    await test('NON (a) : ja (sorti de la liste) ne passe pas ; zh-hant et th sont dans la liste mais sans moyen de langue admis (le moyen ne vaut que pour zh-hans)', async () => {
        await non(entree({ lu: lu({ langue: 'ja' }) }), produit({ tirage: 'jp', imagesServies: [servie({ langue: 'ja' })] }), 'langue-hors-liste');
        for (const [tirage, langue] of [['zh-hant', 'zh-hant'], ['th', 'th']]) await non(entree({ lu: lu({ langue }) }), produit({ tirage, imagesServies: [servie({ langue })] }), 'moyen-de-langue-hors-tirage');
    });
    await test('OUI : une entrée à 350 px NON marquée est remplacée dès ×1,5 (525), pas avant (524)', async () => {
        const p = () => produit({ imagesServies: [servie({ basseDefinition: undefined, w: 350, wOriginal: 350 })] });
        assert.strictEqual((await evaluer(entree(), p(), 525)).ok, true);
        await non(entree(), p(), 'resolution-insuffisante', 524);
    });

    // ───────── les NON, un par condition ─────────
    await test('NON (a) : langue latine — tirage intl (en), français (2361), indonésien (id)', async () => {
        await non(entree({ lu: lu({ langue: 'en' }) }), produit({ tirage: 'intl', imagesServies: [servie({ langue: 'en' })] }), 'langue-hors-liste');
        await non(entree({ lu: lu({ langue: 'fr' }) }), produit({ tirage: 'intl', idExpansion: 2361, imagesServies: [servie({ langue: 'fr' })] }), 'langue-hors-liste');
        await non(entree({ lu: lu({ langue: 'id' }) }), produit({ tirage: 'id', imagesServies: [servie({ langue: 'id' })] }), 'langue-hors-liste');
    });
    await test('NON (a) : tirage sans langue (idth, inconnu) = langue du tirage inconnue', async () => {
        await non(entree(), produit({ tirage: 'idth' }), 'langue-du-tirage-inconnue');
        await non(entree(), produit({ tirage: undefined }), 'langue-du-tirage-inconnue');
    });
    await test('NON (b) : aucune entrée servie (carte sans visuel : elle n\'entre PAS par cette règle)', async () => {
        await non(entree(), produit({ imagesServies: [] }), 'aucune-entree-servie');
        await non(entree(), produit({ imagesServies: undefined }), 'aucune-entree-servie');
    });
    await test('NON (b) : l\'entrée comparée n\'est pas celle du set, du numéro ou de la langue du produit (ou n\'existe pas)', async () => {
        await non(entree(), produit({ imagesServies: [servie({ set: 'Autre-Set' })] }), 'aucune-entree-servie');
        await non(entree(), produit({ imagesServies: [servie({ numero: '420' })] }), 'aucune-entree-servie');
        await non(entree(), produit({ imagesServies: [servie({ langue: 'ja' })] }), 'aucune-entree-servie');
        await non(entree(), produit({ imagesServies: [servie({ langue: null })] }), 'aucune-entree-servie');
        await non(entree({ memeDessin: md({ cleR2: 'ancienne/inconnue.webp' }) }), produit(), 'aucune-entree-servie');
    });
    await test('NON (b) : la décision de remplacement est celle de basse-definition.js — deux entrées remplaçables = ambigu ; document introuvable = non autorisé ; variante d\'un seul côté = non autorisé', async () => {
        const deux = [servie(), servie({ cleR2: 'autre/419.webp', source: 'autre' })];
        await non(entree(), produit({ imagesServies: deux }), 'remplacement-ambigu');
        const sansDoc = produit(); sansDoc.documentsServis = new Map();
        await non(entree(), sansDoc, 'remplacement-non-autorise');
        await non(entree(), produit({ imagesServies: [servie({ noteVariante: 'Master Ball' })] }), 'remplacement-non-autorise');
    });
    await test('NON (b) : une entrée correcte au-dessus du seuil n\'est jamais remplacée par une équivalente (500 -> 868 = 1,7 ×, mais 600 -> 868 = 1,45 ×)', async () => {
        assert.strictEqual((await evaluer(entree(), produit({ imagesServies: [servie({ basseDefinition: undefined, w: 500, wOriginal: 500 })] }))).ok, true);
        await non(entree(), produit({ imagesServies: [servie({ basseDefinition: undefined, w: 600, wOriginal: 600 })] }), 'resolution-insuffisante');
    });
    await test('NON (c) : score sous le seuil (0,874 < 0,875) ; score = seuil admis', async () => {
        await non(entree({ memeDessin: md({ score: 0.874 }) }), produit(), 'score-sous-le-seuil');
        assert.strictEqual((await evaluer(entree({ memeDessin: md({ score: 0.875 }) }))).ok, true);
    });
    await test('NON (c) : champ de preuve absent ou mal formé — memeDessin, cleR2, score, seuil, vide', async () => {
        await non(entree({ memeDessin: undefined }), produit(), 'preuve-absente');
        await non(entree({ memeDessin: null }), produit(), 'preuve-absente');
        for (const k of ['cleR2', 'sha256', 'score', 'seuil', 'vide']) await non(entree({ memeDessin: md({ [k]: undefined }) }), produit(), 'preuve-absente');
        for (const [k, v] of [['sha256', 'xyz'], ['sha256', 'E'.repeat(64)], ['score', '0.99'], ['score', NaN], ['seuil', 0], ['seuil', 1.5], ['vide', 0], ['vide', -0.1], ['cleR2', ' ']]) await non(entree({ memeDessin: md({ [k]: v }) }), produit(), 'preuve-absente');
    });
    await test('NON (c) : la forme du manifeste refuse aussi (entree-mal-formee) une entrée de cette règle sans preuve de même dessin', () => {
        assert.strictEqual(PV.formeEntree(entree()), null);
        assert.match(PV.formeEntree(entree({ memeDessin: undefined })) ?? 'ACCEPTÉE', /memeDessin/);
        assert.match(PV.formeEntree(entree({ memeDessin: md({ score: undefined }) })) ?? 'ACCEPTÉE', /memeDessin/);
        assert.match(PV.formeEntree(entree({ memeDessin: md({ vide: 0 }) })) ?? 'ACCEPTÉE', /memeDessin/);
    });
    // ───────── B1 : les PLANCHERS (seuil ≥ 0,70 ; score ≥ 0,80 en plus de score ≥ seuil ; vide ≥ 0,05) ─────────
    await test('B1 : planchers exportés (0,70 / 0,80 / 0,05)', () => {
        assert.deepStrictEqual([PV.SEUIL_PLANCHER, PV.SCORE_PLANCHER, PV.VIDE_PLANCHER], [0.70, 0.80, 0.05]);
    });
    await test('B1 NON : seuil sous le plancher (0,69), même avec un bon score ; 0,70 admis', async () => {
        await non(entree({ memeDessin: md({ seuil: 0.69, score: 0.99 }) }), produit(), 'seuil-sous-le-plancher');
        await non(entree({ memeDessin: md({ seuil: 0.05, score: 0.99 }) }), produit(), 'seuil-sous-le-plancher');
        assert.strictEqual((await evaluer(entree({ memeDessin: md({ seuil: 0.70, score: 0.99 }) }))).ok, true);
    });
    await test('B1 NON : score sous le plancher (0,79) même au-dessus d\'un seuil bas ; 0,80 admis', async () => {
        await non(entree({ memeDessin: md({ seuil: 0.70, score: 0.79 }) }), produit(), 'score-sous-le-plancher');
        assert.strictEqual((await evaluer(entree({ memeDessin: md({ seuil: 0.70, score: 0.80 }) }))).ok, true);
    });
    await test('B1 NON : vide sous le plancher (0,049) ; 0,05 admis', async () => {
        await non(entree({ memeDessin: md({ vide: 0.049 }) }), produit(), 'vide-sous-le-plancher');
        assert.strictEqual((await evaluer(entree({ memeDessin: md({ vide: 0.05 }) }))).ok, true);
    });
    await test('B1 : les trois seuils réels du lot (SV-P 0,8747 / 30th-P 0,7739 / 30thC 0,7523) avec leur pire score (0,9647 / 0,9894 / 0,8343) et vide (0,198 / 0,431 / 0,164) passent', async () => {
        for (const [seuil, score, vide] of [[0.8747, 0.9647, 0.198], [0.7739, 0.9894, 0.431], [0.7523, 0.8343, 0.164]]) assert.strictEqual((await evaluer(entree({ memeDessin: md({ seuil, score, vide }) }))).ok, true, `${seuil}`);
    });

    // ───────── I2 : la preuve est reliée à l'entrée SERVIE (sha256 des octets comparés = sha256 de l'entrée ou de son document ; à défaut sha1Original du document ; à défaut l'adresse d'origine) ─────────
    await test('I2 OUI : sha256 comparé = sha256 de l\'entrée ; ou seulement celui du document', async () => {
        assert.strictEqual((await evaluer(entree())).ok, true);
        assert.strictEqual((await evaluer(entree(), produit({ imagesServies: [servie({ sha256: H3 })], doc: { sha256: SHA_E } }))).ok, true);
    });
    await test('I2 OUI : sha256 comparé = celui de l\'entrée seule (le document porte un autre)', async () => {
        assert.strictEqual((await evaluer(entree(), produit({ doc: { sha256: H3 } }))).ok, true);
    });
    await test('I2 NON : ni l\'entrée ni le document n\'ont d\'adresse et le manifeste non plus (undefined n\'est pas égal à undefined)', async () => {
        const p = produit({ imagesServies: [servie({ sha256: H3, urlOriginal: undefined })], doc: { sha256: H3, urlOriginal: undefined } });
        await non(entree({ memeDessin: md({ urlOriginal: undefined }) }), p, 'preuve-non-reliee');
    });
    await test('I2 NON : sha256 comparé ≠ celui de l\'entrée servie et de son document (aucun autre lien) = preuve non reliée', async () => {
        await non(entree({ memeDessin: md({ sha256: H3 }) }), produit(), 'preuve-non-reliee');
        await non(entree(), produit({ imagesServies: [servie({ sha256: undefined, urlOriginal: undefined })], doc: { sha256: undefined, urlOriginal: undefined } }), 'preuve-non-reliee');
    });
    await test('I2 : lien de repli par le sha1 de l\'original du document (octets sources, que la ré-encodée ne porte pas)', async () => {
        const p = (sha1Original, extra = {}) => produit({ imagesServies: [servie({ sha256: H3, urlOriginal: undefined })], doc: { sha256: H3, urlOriginal: undefined, sha1Original, ...extra } });
        assert.strictEqual((await evaluer(entree({ memeDessin: md({ sha1: SHA1_E }) }), p(SHA1_E))).ok, true);
        await non(entree({ memeDessin: md({ sha1: SHA1_E }) }), p('f'.repeat(40)), 'preuve-non-reliee');
        await non(entree({ memeDessin: md({ sha1: undefined }) }), p(SHA1_E), 'preuve-non-reliee');
        await non(entree({ memeDessin: md({ sha1: 'zz' }) }), p('zz'), 'preuve-non-reliee');
    });
    await test('I2 : lien de dernier recours par l\'adresse d\'origine de l\'entrée servie (écrit « urlOriginal » dans la preuve)', async () => {
        const p = (u) => produit({ imagesServies: [servie({ sha256: H3, urlOriginal: u })], doc: { sha256: H3, urlOriginal: u } });
        assert.strictEqual((await evaluer(entree({ memeDessin: md({ urlOriginal: URL_E }) }), p(URL_E))).ok, true);
        await non(entree({ memeDessin: md({ urlOriginal: URL_E }) }), p('https://old.test/autre.webp'), 'preuve-non-reliee');
        await non(entree({ memeDessin: md({ urlOriginal: undefined }) }), p(URL_E), 'preuve-non-reliee');
    });

    // ───────── (e) la langue n'est pas « lue » : le moyen le dit, et il ne vaut que pour son tirage ─────────
    await test('(e) NON : moyen de langue absent, inconnu ou prototype ; page source absente ; moyen d\'un autre tirage', async () => {
        await non(entree({ lu: lu({ langueMoyen: undefined }) }), produit(), 'moyen-de-langue-hors-tirage');
        await non(entree({ lu: lu({ langueMoyen: 'lu-sur-image' }) }), produit(), 'moyen-de-langue-hors-tirage');
        await non(entree({ lu: lu({ langueMoyen: 'constructor' }) }), produit(), 'moyen-de-langue-hors-tirage');
        await non(entree({ lu: lu({ pageListe: undefined }) }), produit(), 'page-liste-absente');
        await non(entree({ lu: lu({ pageListe: 'http://x.test/l' }) }), produit(), 'page-liste-absente');
        assert.strictEqual(PV.MOYENS_DE_LANGUE[MOYEN_LANGUE], 'zh-hans');
        assert.ok(Object.isFrozen(PV.MOYENS_DE_LANGUE));
    });

    await test('NON (d) : numéro lu différent ; numéro lu absent ; moyen de lecture absent ou hors liste', async () => {
        await non(entree({ lu: lu({ numero: '420' }) }), produit(), 'numero-different');
        await non(entree({ lu: lu({ numero: '39' }) }), produit({ numero: '397', imagesServies: [servie({ numero: '397' })] }), 'numero-different');
        await non(entree({ lu: lu({ numero: '' }) }), produit(), 'numero-lu-absent');
        await non(entree({ lu: lu({ numero: null }) }), produit(), 'numero-lu-absent');
        await non(entree({ lu: lu({ moyen: undefined }) }), produit(), 'moyen-de-lecture-absent');
        await non(entree({ lu: lu({ moyen: 'devine' }) }), produit(), 'moyen-de-lecture-absent');
        assert.strictEqual((await evaluer(entree({ lu: lu({ moyen: 'oeil' }) }))).ok, true);
        assert.strictEqual((await evaluer(entree({ lu: lu({ numero: '0419' }) }))).ok, true, 'même clé de jointure');
    });
    await test('NON (e) : langue lue différente de celle du tirage (ja lu sur un tirage zh-hans, en, absente)', async () => {
        await non(entree({ lu: lu({ langue: 'ja' }) }), produit(), 'langue-differente');
        await non(entree({ lu: lu({ langue: 'en' }) }), produit(), 'langue-differente');
        await non(entree({ lu: lu({ langue: null }) }), produit(), 'langue-differente');
    });
    await test('NON (f) : résolution insuffisante — candidate sous le seuil (340, marquée), ou pas assez plus grande', async () => {
        await non(entree(), produit(), 'resolution-insuffisante', 340);
        await non(entree(), produit(), 'resolution-insuffisante', 200);
        assert.strictEqual((await evaluer(entree(), produit(), 350)).ok, true, '350 px remplace une basse définition (règle de basse-definition.js)');
    });
    await test('NON (f) : octets absents ou illisibles = largeur illisible', async () => {
        assert.strictEqual((await PV.evaluerEntree({ entree: entree(), produit: produit(), octets: {} })).motif, `${R}:largeur-illisible`);
        assert.strictEqual((await PV.evaluerEntree({ entree: entree(), produit: produit(), octets: { a: Buffer.from('pas une image') } })).motif, `${R}:largeur-illisible`);
    });
    await test('NON : tampon lu sur un produit sans tampon, contradictions, marques vides ou qui nomment une source', async () => {
        await non(entree({ lu: lu({ tampon: 'pps' }) }), produit(), 'tampon-different');
        await non(entree({ contradictions: ['une boutique dit 420'] }), produit(), 'contradictions');
        await non(entree({ lu: lu({ marques: [] }) }), produit(), 'marques-vides');
        await non(entree({ lu: lu({ marques: ['pikaqian'] }) }), produit(), 'marque-nomme-une-source');
    });
    await test('les règles existantes ne bougent pas : preuve-lue sur un tirage zh-hans reste refusée pour son nom (nom-lu-hors-langue depuis le contrôle A du 08/11, nom-langue-non-anglaise avant)', async () => {
        const e = entree({ regle: 'preuve-lue' }); delete e.memeDessin;
        const r = await PV.evaluerEntree({ entree: e, produit: produit(), octets: {} });
        assert.strictEqual(r.ok, false); assert.match(r.motifs.join(','), /nom-lu-hors-langue|nom-langue-non-anglaise/);
    });
    await test('le nom n\'est jamais lu : un lu.nom quelconque ne change rien à la décision', async () => {
        assert.strictEqual((await evaluer(entree({ lu: lu({ nom: 'n\'importe quoi' }) }))).ok, true);
    });

    // ───────── le plan, sur une FAUSSE base : l'unité, la décision de remplacement et la neutralité ─────────
    const K = require('./collecteur-images-preuves');
    const poserAuCache = (dossier, url, octets) => {
        fs.mkdirSync(dossier, { recursive: true });
        const f = path.join(dossier, HOTE.nomCache(url)), fb = f.replace(/\.json$/, '.bin');
        fs.writeFileSync(fb, octets); fs.writeFileSync(f, JSON.stringify({ url, statut: 'ok', status: 200, type: 'image/png', octets: octets.length, sha256: sha(octets), le: '2026-11-01T08:00:00.000Z' }));
        return fb;
    };
    async function monde({ largeur = 868, imagesServies = [servie()], documents = null, nCartes = 1, aucuneImage = false } = {}) {
        const racine = tmp(), cache = path.join(racine, 'CACHE'), famille = 'ZH-HD-SC';
        fs.mkdirSync(path.join(racine, famille), { recursive: true }); fs.mkdirSync(path.join(racine, 'VALIDATIONS'), { recursive: true }); fs.mkdirSync(cache, { recursive: true });
        const entrees = [], validations = [], lignes = [], etat = [], cartes = [], docs = [];
        for (let i = 0; i < nCartes; i++) {
            const id = 917920 + i, carteId = -id, numero = String(419 - i), octets = await png(largeur + i);
            const url = `https://img.alpha.test/z/${numero}.png`, fb = poserAuCache(cache, url, octets);
            const mes = imagesServies.map(e => ({ ...e, cleR2: e.cleR2.replace('419', numero), numero }));
            entrees.push(entree({ idProduct: id, url, fichier: fb, sha256: sha(octets), lu: lu({ numero }), attendu: { numero }, memeDessin: md({ cleR2: mes[0].cleR2 }) }));
            validations.push({ idProduct: id, sha256: sha(octets), regle: R, valideLe: '2026-11-01T10:00:00.000Z', par: 'coordinateur', planche: 'A-prouvees-SV-P-01.jpg' });
            lignes.push({ idProduct: id, carteId, slugSet: SLUG, numeroFiche: numero, idExpansion: 6000 });
            etat.push({ idProduct: id, idExpansion: 6000, langue: 'zh-hans', tamponnee: null, name: 'Luminous Energy' });
            cartes.push({ _id: carteId, images: aucuneImage ? [] : mes });
            if (!aucuneImage) for (const e of mes) docs.push({ carteId, ...docDe(e) });
        }
        fs.writeFileSync(path.join(racine, famille, 'preuves.json'), JSON.stringify({ famille, le: '2026-11-01T00:00:00.000Z', entrees, trous: [] }));
        fs.writeFileSync(path.join(racine, 'VALIDATIONS', `valide-${famille}.json`), JSON.stringify(validations));
        const lire = { lignes: async ids => lignes.filter(l => ids.includes(l.idProduct)), fiches: async (cs, ss) => lignes.filter(l => cs.includes(l.carteId) && ss.includes(l.slugSet)),
            numeros: async () => [], sets: async slugs => [{ _id: SLUG, tirage: 'zh-hans' }].filter(s => slugs.includes(s._id)), positions: async () => [], impressions: async ids => ids.map(i => ({ _id: i, impressions: [] })) };
        const lesDocs = documents ?? docs;
        const db = { collection: n => ({ cartes: { find: q => ({ project: () => ({ toArray: async () => cartes.filter(c => q._id.$in.includes(c._id)) }) }) }, images: { find: q => ({ toArray: async () => lesDocs.filter(d => q.carteId.$in.includes(d.carteId)) }), findOne: async () => null } })[n] };
        return { racine, cache, lire, etat, db, F: CLI.fichiersDe('prv', path.join(racine, 'sortie'), cache) };
    }
    const planDe = w => K.construirePlanAvec({ dossier: w.racine, cache: w.cache, lire: w.lire, etat: w.etat, lecteur: RC.lecteurNatif(w.db), fichiers: w.F });

    await test('plan : une entrée de la règle sur une carte à entrée servie en basse définition = « ajouter » qui remplace exactement 1 entrée', async () => {
        const w = await monde({ nCartes: 3 });
        const plan = await planDe(w);
        assert.deepStrictEqual(plan.resume.refus, []);
        assert.strictEqual(plan.resume.parRegle[R], 3);
        assert.strictEqual(plan.unites.length, 3);
        for (const u of plan.unites) { assert.strictEqual(u.decision.action, 'ajouter'); assert.strictEqual(u.decision.remplace.length, 1); assert.strictEqual(u.decision.remplace[0].cleR2.startsWith('ancienne/'), true); }
        assert.strictEqual(plan.resume.aAjouter, 3); assert.strictEqual(plan.resume.dontRemplacentUneBasseDefinition, 3);
    });
    await test('plan : une carte SANS entrée servie n\'entre pas par cette règle (refus nommé, aucune unité)', async () => {
        const plan = await planDe(await monde({ aucuneImage: true }));
        assert.strictEqual(plan.unites.length, 0);
        assert.match(plan.resume.refus.map(r => r.motif).join(','), new RegExp(`${R}:aucune-entree-servie`));
    });
    await test('plan : candidate pas assez plus grande = refus resolution-insuffisante, aucune unité', async () => {
        const plan = await planDe(await monde({ largeur: 340 }));
        assert.strictEqual(plan.unites.length, 0);
        assert.match(plan.resume.refus.map(r => r.motif).join(','), new RegExp(`${R}:resolution-insuffisante`));
        assert.strictEqual(plan.resume.refusParMotif[`${R}:resolution-insuffisante`], 1, 'le détail du motif est gardé dans refusParMotif');
    });
    await test('NEUTRALITÉ : ni l\'unité (clé R2, preuve, mention, champs écrits) ni la source ne portent le nom d\'une source ; la clé R2 est prv/…', async () => {
        const plan = await planDe(await monde());
        const u = plan.unites[0];
        assert.strictEqual(u.cleR2, 'prv/Scarlet-Violet-Simplified-Chinese-Promos/419--917920-zh-hans.webp');
        const publics = JSON.stringify({ cleR2: u.cleR2, languePreuve: u.languePreuve, preuveNeutre: u.preuveNeutre, champsEntree: u.champsEntree, champsDocument: u.champsDocument, mention: PV.SRC.MENTION, source: PV.SRC.SOURCE, lot: PV.SRC.LOT });
        assert.ok(!/pokipair|poki|tcgcsv|scrydex|packmagik|pokellector|pokumon|pikaqian|cardtrader|bulbapedia|tcgdex|artofpkm|pokedata|pkmncards|cardmarket|simplifiedcollector|alpha\.test|ancienne/i.test(publics), publics);
        assert.match(u.preuveNeutre, /même dessin/); assert.doesNotMatch(u.preuveNeutre, /deux sources/);
        assert.deepStrictEqual(Object.keys(u.champsEntree.preuveLue.memeDessin).sort(), ['lien', 'score', 'seuil', 'vide']);
        assert.strictEqual(u.champsEntree.preuveLue.memeDessin.lien, 'sha256');
        assert.strictEqual(u.champsEntree.preuveLue.lu.moyen, 'ocr');
        assert.strictEqual(u.champsEntree.preuveLue.lu.langueMoyen, MOYEN_LANGUE, 'la langue dit comment elle est connue');
        assert.match(u.preuveNeutre, /liste/);
        assert.strictEqual(u.url, 'https://img.alpha.test/z/419.png', 'urlOriginal garde l\'hôte comme pour toute source (traçabilité, retrait)');
    });

    console.log(`\ntest-preuves-remplacement : ${ok} OK, ${ko} KO`);
    process.exitCode = ko ? 1 : 0;
})();
