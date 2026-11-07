// Banc (07/11) de la table fermée POSITIONS_RONDES de collecte-cartes/preuves.js : Intro Pack Squirtle (numéro dans un rond seul, sans total).
// Décision de l'utilisateur : admis si le nom suffit à identifier la carte (nom unique dans le produit), le rond concorde avec la liste du produit, et deux sources. Liste fermée.
// Pur, aucune base, aucun réseau. Mutants : mutants-preuves.js, groupe « position ronde ».
'use strict';
const assert = require('assert');
const PV = require('./collecte-cartes/preuves');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 14).join('\n   ')}`); } };
const SET = 'Intro-Pack-Squirtle';
const NOMS = ['Arcanine', 'Magmar', 'Poliwag', 'Growlithe', 'Growlithe', 'Squirtle', 'Squirtle', 'Fire Energy', 'Fire Energy'];
const entree = (o = {}) => ({ idProduct: 2001, regle: 'a-lire', url: 'https://img.alpha.test/a/1.png', hote: 'img.alpha.test', fichier: 'C:\\x\\a.bin', sha256: 'a'.repeat(64), w: 570, h: 797, seconde: null,
    attendu: { nom: 'Arcanine', numero: '32', langue: 'ja', tampon: null, variante: null },
    lu: { nom: 'ウインディ', position: '32', langue: 'ja', tampon: null, finition: 'normale', marques: ['numéro 32 dans un rond'], note: '', ...o },
    varianteNommee: null, contradictions: [], sourcesConsultees: ['alpha'], luLe: '2026-11-07T10:00:00.000Z' });
const produit = (o = {}) => ({ idProduct: 2001, idExpansion: 5060, tirage: 'jp', tamponnee: null, numero: '32', carteId: -5, slugSet: SET, slug: 'Arcanine-IPS-32', nomEn: 'Arcanine', nomJa: 'ウインディ', nomsDuSet: NOMS, ...o });
const brut = (e, p, sansTotalAutorise = true) => PV.evaluerPreuveLue({ entree: e, produit: p, langueProduit: PV.langueDuProduit({ ...p, langueLue: e.lu?.langue }), sansTotalAutorise });
const mt = (e, p, s = true) => brut(e, p, s).motifs.join(',');

(async () => {
    await test('admis : deux sources, nom unique dans le set, rond = numéro du produit', () => {
        assert.deepStrictEqual({ ok: brut(entree(), produit()).ok, motifs: brut(entree(), produit()).motifs }, { ok: true, motifs: [] });
    });
    await test('source unique : refusé, motif nommé position-ronde-source-unique', () => {
        assert.match(mt(entree(), produit(), false), /position-ronde-source-unique/);
        assert.strictEqual(brut(entree(), produit(), false).ok, false);
    });
    await test('nom porté plusieurs fois dans le set (Growlithe n°1 et n°26) : refusé nom-non-unique-dans-le-set', () => {
        const e = entree({ nom: 'ガーディ', position: '1' });
        assert.match(mt({ ...e, attendu: { ...e.attendu, nom: 'Growlithe', numero: '1' } }, produit({ numero: '1', nomEn: 'Growlithe', nomJa: 'ガーディ', slug: 'Growlithe-IPS-1' })), /nom-non-unique-dans-le-set/);
    });
    await test('rond différent du numéro du produit : refusé numero-different', () => {
        assert.match(mt(entree({ position: '33' }), produit()), /numero-different/);
    });
    await test('set hors table (même lecture sur un autre set jp) : refusé position-hors-liste', () => {
        assert.match(mt(entree(), produit({ slugSet: 'Autre-Set-JP' })), /position-hors-liste/);
        assert.match(mt(entree(), produit({ slugSet: 'Intro-Pack-Squirtle-2' })), /position-hors-liste/, 'comparaison exacte, jamais un préfixe');
    });
    await test('nomsDuSet absent, vide ou à nom inconnu : refusé noms-du-set-inconnus (« je ne sais pas » n\'est pas « tout va bien »)', () => {
        assert.match(mt(entree(), produit({ nomsDuSet: undefined })), /noms-du-set-inconnus/);
        assert.match(mt(entree(), produit({ nomsDuSet: [] })), /noms-du-set-inconnus/);
        assert.match(mt(entree(), produit({ nomsDuSet: [...NOMS, null] })), /noms-du-set-inconnus/);
        assert.match(mt(entree(), produit({ nomsDuSet: ['Magmar', 'Poliwag'] })), /noms-du-set-inconnus/, 'le produit n\'est pas dans sa propre liste');
    });
    await test('les gardes communes restent : nom lu différent, langue, tampon, contradictions', () => {
        assert.match(mt(entree({ nom: 'ブーバー' }), produit()), /nom-different/);
        assert.match(mt(entree({ langue: 'en' }), produit()), /langue-differente/);
        assert.match(mt(entree({ tampon: 'x' }), produit()), /tampon-different/);
        assert.match(mt({ ...entree(), contradictions: ['x'] }, produit()), /contradictions/);
    });
    await test('la table est gelée et ne porte que Intro-Pack-Squirtle ; Battle Academy / Trainer Kit inchangés', () => {
        assert.deepStrictEqual(Object.keys(PV.POSITIONS_RONDES), [SET]);
        assert.ok(Object.isFrozen(PV.POSITIONS_RONDES) && Object.isFrozen(PV.POSITIONS_RONDES[SET]));
        assert.strictEqual(PV.POSITIONS_RONDES[SET].nomUnique, true);
        assert.strictEqual(PV.POSITIONS_RONDES[SET].deuxSources, true);
        assert.strictEqual(PV.setAdmisPourPosition(SET), false, 'le rond ne passe pas par la voie des decks');
    });
    await test('voie à deux sources : la PREMIÈRE lecture est jugée aussi (rond faux ou nom répété → refus)', async () => {
        const seconde = lu => ({ url: 'https://img.beta.example/b/1.png', hote: 'img.beta.example', fichier: 'C:\\x\\b.bin', sha256: 'b'.repeat(64), lu });
        const e = entree(), s = seconde({ ...e.lu });
        const decider = async () => ({ decision: 'ecrire', preuve: {} });
        const octets = { a: Buffer.from('a'), b: Buffer.from('b') };
        const bon = await PV.evaluerDeuxSources({ entree: { ...e, regle: 'deux-sources', seconde: s }, produit: produit(), langueProduit: 'ja', octets, decider });
        assert.strictEqual(bon.ok, true, JSON.stringify(bon));
        const mauvaise1 = await PV.evaluerDeuxSources({ entree: { ...e, lu: { ...e.lu, position: '33' }, regle: 'deux-sources', seconde: s }, produit: produit(), langueProduit: 'ja', octets, decider });
        assert.strictEqual(mauvaise1.ok, false);
        assert.match(mauvaise1.motif, /premiere-lecture/);
        const repete = await PV.evaluerDeuxSources({ entree: { ...e, regle: 'deux-sources', seconde: s }, produit: produit({ nomsDuSet: ['Arcanine', 'Arcanine'] }), langueProduit: 'ja', octets, decider });
        assert.strictEqual(repete.ok, false);
        assert.match(repete.motif, /nom-non-unique-dans-le-set/);
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
