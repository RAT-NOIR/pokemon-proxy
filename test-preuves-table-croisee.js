// Banc PUR de la TABLE CROISÉE des noms japonais (2026-11-03) : un nom japonais lu témoigne pour un produit SANS nomJa si une AUTRE carte de même nomEn le porte
// et qu'aucun autre nomEn ne le porte. Aucune base, aucun réseau.
// Fichier séparé de test-preuves.js (que la porte réseau refuse dès qu'il diffère de HEAD : il lance des processus). `lancer(PV)` rend le nombre d'échecs :
// mutants-preuves.js le lance en processus (`node test-preuves-table-croisee.js`), mutants-nomja.js en mémoire sur une copie mutée (jamais sur preuves.js).
'use strict';
const assert = require('assert');

const H1 = 'a'.repeat(64);
const entree = (o = {}) => ({ idProduct: 1001, regle: 'preuve-lue', url: 'https://img.alpha.test/a/1.png', hote: 'img.alpha.test', fichier: 'C:\\x\\a.bin', sha256: H1, w: 570, h: 797, seconde: null,
    attendu: { nom: 'Bulbasaur', numero: '13', langue: 'en', tampon: null, variante: null },
    lu: { nom: 'Bulbasaur', numero: '13', total: '40', langue: 'en', tampon: null, finition: 'normale', marques: ['13/40', 'texte anglais'], note: '' },
    varianteNommee: null, contradictions: [], sourcesConsultees: ['alpha'], luLe: '2026-10-26T10:00:00.000Z', ...o });
const produit = (o = {}) => ({ idProduct: 1001, idExpansion: 5000, tirage: 'intl', tamponnee: null, numero: '13', carteId: 77, slugSet: 'Set-A', nomEn: 'Bulbasaur', ...o });
const trad = (o = {}) => entree({ attendu: { ...entree().attendu, numero: '005' }, lu: { nom: 'ネモ', numero: '005', total: '021', langue: 'ja', tampon: null, finition: 'normale', marques: ['code svAL imprimé'], codeSet: 'svAL', dex: null, pv: null, ...o } });
const ptrad = (o = {}) => produit({ tirage: 'jp', numero: '005', carteId: -1, slugSet: 'Starter-Set-AL', slug: 'Nemona-svAL005', nomEn: 'Nemona', ...o });

/** @returns {Promise<number>} le nombre d'échecs */
async function lancer(PV, silencieux = false) {
    let ok = 0, ko = 0;
    const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; if (!silencieux) console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 14).join('\n   ')}`); } };
    const lueBrut = (e, p) => PV.evaluerPreuveLue({ entree: e, produit: p, langueProduit: PV.langueDuProduit({ ...p, langueLue: e.lu?.langue }) });
    const lue = (e, p) => { const r = lueBrut(e, p); return { ok: r.ok, motifs: r.motifs }; };
    const drap = (e, p) => lueBrut(e, p).drapeaux ?? [];
    const mt = (e, p) => lue(e, p).motifs.join(',');
    const dr = trad();
    const un = { noms: ['ネモ'], cartes: 1, divergent: false };      // la table interne d'UNE carte : « table-ja-insuffisante » avant la règle
    const pd = ptrad({ tableJaInterne: un });
    const T = cs => PV.construireTableJaCroisee(cs);
    const nemo = { _id: 301, nomEn: 'Nemona', nomJa: 'ネモ' };

    await test('avant la règle (sans table croisée) : table-ja-insuffisante', () => {
        assert.match(mt(dr, pd), /table-ja-insuffisante/);
    });
    await test('1. accepté : nom lu = nomJa d\'une AUTRE carte de même nomEn, aucun autre nomEn ne le porte ; la preuve nomme la carte source', () => {
        assert.deepStrictEqual(lue(dr, { ...pd, tableJaCroisee: T([nemo]) }), { ok: true, motifs: [] });
        assert.deepStrictEqual(drap(dr, { ...pd, tableJaCroisee: T([nemo]) }), ['nom-ja-par-table-d-un-autre-set:301']);
        assert.strictEqual(lue(trad({ nom: 'ﾈﾓ' }), { ...pd, tableJaCroisee: T([nemo]) }).ok, true, 'demi-chasse normalisée (NFKC, normalisation de production)');
        assert.strictEqual(lue(trad({ nom: 'ネ・モ' }), { ...pd, tableJaCroisee: T([nemo]) }).ok, true, 'point médian normalisé');
    });
    await test('2. refusé : nom lu absent de la table', () => {
        const autre = trad({ nom: 'ボタン' });
        assert.strictEqual(lue(autre, { ...pd, tableJaCroisee: T([nemo]) }).ok, false);
        assert.match(mt(autre, { ...pd, tableJaCroisee: T([nemo]) }), /table-ja-insuffisante/);
        assert.strictEqual(lue(dr, { ...pd, tableJaCroisee: T([]) }).ok, false, 'table vide');
        assert.strictEqual(lue(dr, { ...pd, tableJaCroisee: null }).ok, false, 'pas de table');
    });
    await test('3. refusé : un nomJa partagé par DEUX nomEn ne désigne rien', () => {
        const t = T([nemo, { _id: 302, nomEn: 'Arven', nomJa: 'ネモ' }]);
        assert.match(mt(dr, { ...pd, tableJaCroisee: t }), /table-ja-insuffisante/);
    });
    await test('4. refusé : nomEn apparié par INCLUSION seulement', () => {
        assert.match(mt(dr, { ...pd, tableJaCroisee: T([{ _id: 303, nomEn: 'Nemona\'s Gift', nomJa: 'ネモ' }]) }), /table-ja-insuffisante/, 'la carte est « Nemona\'s Gift »');
        assert.match(mt(dr, { ...pd, nomEn: 'Nemona Special', slug: 'Nemona-Special-svAL005', tableJaCroisee: T([nemo]) }), /table-ja-insuffisante/, 'le produit est « Nemona Special »');
    });
    await test('5. garde-fous : la carte du produit n\'est pas « une autre » ; ni le code ni le numéro ne sont dispensés ; le japonais seul', () => {
        assert.match(mt(dr, { ...pd, carteId: 301, tableJaCroisee: T([nemo]) }), /table-ja-insuffisante/);
        assert.match(mt(dr, { ...pd, slug: 'Nemona', tableJaCroisee: T([nemo]) }), /code-set-non-verifiable/);
        assert.match(mt(trad({ numero: '006' }), { ...pd, tableJaCroisee: T([nemo]) }), /numero-different/);
        assert.strictEqual(lue(trad({ langue: 'zh-hans' }), { ...ptrad({ tirage: 'zh-hans', tableJaInterne: un }), tableJaCroisee: T([nemo]) }).ok, false, 'chinois : jamais');
        assert.strictEqual(T([{ _id: -4, nomEn: 'Nemona', nomJa: 'ネモ' }]).parNomEn.size, 0, 'une fiche simple (_id < 0) ne fait pas table');
    });
    await test('6. produit AVEC nomJa : règle existante inchangée ; table interne à 2 cartes : drapeau d\'avant', () => {
        const avec = ptrad({ nomJa: 'ボタン', carteId: 77, tableJaCroisee: T([nemo]) });
        assert.deepStrictEqual(lue(dr, avec).motifs, ['nom-different']);
        assert.strictEqual(lue(trad({ nom: 'ボタン' }), avec).ok, true);
        assert.deepStrictEqual(drap(dr, { ...pd, tableJaInterne: { ...un, cartes: 2 }, tableJaCroisee: T([nemo]) }), ['table-ja-interne']);
        assert.match(mt(dr, { ...pd, tableJaInterne: { ...un, divergent: true }, tableJaCroisee: T([nemo]) }), /nom-traduit-sans-temoin/, 'une table interne qui diverge ne témoigne toujours pas');
    });
    await test('7. via evaluerEntree (chemin de production) : drapeau écrit dans la décision', async () => {
        const r = await PV.evaluerEntree({ entree: dr, produit: { ...pd, tableJaCroisee: T([nemo]) } });
        assert.strictEqual(r.ok, true); assert.deepStrictEqual(r.drapeaux, ['nom-ja-par-table-d-un-autre-set:301']);
    });
    await test('8. périmètre : un Pokémon (catégorie pokemon, ou nom à Pokédex sans catégorie) garde ses témoins Pokédex/PV/règle ; un Dresseur / une Énergie passe', () => {
        const pk = trad({ nom: 'ピカチュウ' }), tp = T([{ _id: 401, nomEn: 'Pikachu', nomJa: 'ピカチュウ' }]);
        const base = ptrad({ nomEn: 'Pikachu', slug: 'Pikachu-svAL005', tableJaInterne: un, tableJaCroisee: tp });
        assert.strictEqual(lue(pk, { ...base, categorie: 'pokemon' }).ok, false, 'catégorie pokemon : refus');
        assert.strictEqual(lue(pk, base).ok, false, 'catégorie inconnue mais nom à Pokédex : refus');
        assert.ok(!drap(pk, { ...base, categorie: 'pokemon' }).some(d => d.startsWith('nom-ja-par-table')), 'jamais la preuve croisée pour un Pokémon');
        assert.strictEqual(lue(dr, { ...pd, categorie: 'dresseur', tableJaCroisee: T([nemo]) }).ok, true, 'Dresseur déclaré');
        assert.strictEqual(lue(dr, { ...pd, categorie: 'energie', tableJaCroisee: T([nemo]) }).ok, true, 'Énergie déclarée');
    });
    await test('9. clesNom distingue : Pikachu / Pikachu V, Mew / Mew ☆, Deoxys / Deoxys δ, Palkia / Palkia LV.X ne s\'apparient pas', () => {
        for (const [produitEn, carteEn] of [['Pikachu', 'Pikachu V'], ['Pikachu V', 'Pikachu'], ['Mew', 'Mew ☆'], ['Mew ☆', 'Mew'], ['Deoxys', 'Deoxys δ'], ['Deoxys δ', 'Deoxys'], ['Palkia', 'Palkia LV.X'], ['Palkia LV.X', 'Palkia']]) {
            const t = T([{ _id: 500, nomEn: carteEn, nomJa: 'ネモ' }]);
            assert.strictEqual(PV.preuveParTableCroisee('ネモ', produitEn, t, -1), null, `${produitEn} / ${carteEn}`);
        }
        assert.ok(PV.preuveParTableCroisee('ネモ', 'Basic Fire Energy', T([{ _id: 501, nomEn: 'Basic Fire Energy', nomJa: 'ネモ' }]), -1), 'même nom : accepté');
        assert.strictEqual(PV.preuveParTableCroisee('ネモ', 'Fire Energy', T([{ _id: 502, nomEn: 'Basic Fire Energy', nomJa: 'ネモ' }]), -1), null, '« Basic X Energy » ≠ « X Energy » : sens sûr');
    });
    await test('10. échec FERMÉ : une table absente, vide ou mal formée ne produit jamais d\'acceptation (cas du collecteur qui ne transmettrait pas la table)', () => {
        for (const t of [undefined, null, {}, { parNomEn: new Map() }, { parNomEn: new Map(), parNomJa: new Map() }]) assert.strictEqual(lue(dr, { ...pd, tableJaCroisee: t }).ok, false);
    });
    if (!silencieux) console.log(`${ok} passés, ${ko} en échec`);
    return ko;
}

module.exports = { lancer };
if (require.main === module) lancer(require('./collecte-cartes/preuves')).then(ko => process.exit(ko ? 1 : 0));
