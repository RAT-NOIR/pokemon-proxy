// Banc (07/11) de la table fermée CODES_IMPRIMES_ADMIS de collecte-cartes/preuves.js : sC→sC2 (VMAX-Starter-Decks), T-P→T (T-Promos). Pur, aucune base, aucun réseau.
// (Fichier à part : test-preuves.js lance child_process, que la porte réseau n'ouvre pas dès qu'il diffère de HEAD.) Mutants : mutants-preuves.js, groupe « codes imprimés admis ».
// Les témoins Pokédex/PV sont ceux d'un Pokémon (Mareep, Slowpoke) : seul le CODE est l'objet du banc, le nom et le numéro restent comparés par la règle ordinaire.
'use strict';
const assert = require('assert');
const PV = require('./collecte-cartes/preuves');

let ok = 0, ko = 0;
const test = async (nom, f) => { try { await f(); ok++; } catch (e) { ko++; console.log(`ECHEC ${nom}\n   ${(e.stack || e.message).split('\n').slice(0, 14).join('\n   ')}`); } };
const entree = (o = {}) => ({ idProduct: 1001, regle: 'preuve-lue', url: 'https://img.alpha.test/a/1.png', hote: 'img.alpha.test', fichier: 'C:\\x\\a.bin', sha256: 'a'.repeat(64), w: 570, h: 797, seconde: null,
    attendu: { nom: 'Bulbasaur', numero: '13', langue: 'en', tampon: null, variante: null },
    lu: { nom: 'Bulbasaur', numero: '13', total: '40', langue: 'en', tampon: null, finition: 'normale', marques: ['13/40', 'texte anglais'], note: '' },
    varianteNommee: null, contradictions: [], sourcesConsultees: ['alpha'], luLe: '2026-10-26T10:00:00.000Z', ...o });
const produit = (o = {}) => ({ idProduct: 1001, idExpansion: 5000, tirage: 'intl', tamponnee: null, numero: '13', carteId: 77, slugSet: 'Set-A', nomEn: 'Bulbasaur', ...o });
const brut = (e, p) => PV.evaluerPreuveLue({ entree: e, produit: p, langueProduit: PV.langueDuProduit({ ...p, langueLue: e.lu?.langue }) });
const lue = (e, p) => { const r = brut(e, p); return { ok: r.ok, motifs: r.motifs }; };
const drap = (e, p) => brut(e, p).drapeaux ?? [];
const trad = (o = {}) => entree({ attendu: { ...entree().attendu, numero: '005' }, lu: { nom: 'メリープ', numero: '005', total: '021', langue: 'ja', tampon: null, finition: 'normale', marques: ['code svAL imprimé'], codeSet: 'svAL', dex: 179, pv: 60, ...o } });
const ptrad = (o = {}) => produit({ tirage: 'jp', numero: '005', carteId: -1, slugSet: 'Starter-Set-AL', slug: 'Mareep-svAL005', nomEn: 'Mareep', ...o });
const mt = (e, p) => lue(e, p).motifs.join(',');
const psc = (o = {}) => ptrad({ numero: '17', slug: 'Mareep-sC-017', slugSet: 'VMAX-Starter-Decks', codeSet: 'sC', ...o });
const sc = (o = {}) => { const e = trad({ numero: '017', codeSet: 'sC2', ...o }); return { ...e, attendu: { ...e.attendu, numero: '17' } }; };
const lt = (o = {}) => trad({ nom: 'ヤドン', dex: 79, pv: 50, numero: '004', total: 'T', codeSet: 'T', ...o });
const pt = (o = {}) => ptrad({ numero: '004', slug: 'Slowpoke-T-P-004', slugSet: 'T-Promos', codeSet: 'T-P', nomEn: 'Slowpoke', ...o });
const att4 = e => ({ ...e, attendu: { ...e.attendu, numero: '004' } });

(async () => {
    await test('sC2 sous sC (VMAX-Starter-Decks) : admis, drapeau écrit dans la preuve', () => {
        const e = sc();
        assert.deepStrictEqual(lue(e, psc()), { ok: true, motifs: [] }, 'n°17 admis');
        assert.ok(drap(e, psc()).includes('code-imprime-admis:sC2'), 'le drapeau est écrit');
        for (const n of ['18', '19', '20']) assert.strictEqual(lue(sc({ numero: '0' + n }), psc({ numero: n, slug: `Mareep-sC-0${n}` })).ok, true, `n°${n} admis`);
    });
    await test('sC2 n°21 (hors des numéros prouvés) : refusé, la liste de numéros fait partie de la preuve', () => {
        const e = sc({ numero: '021' });
        assert.match(mt({ ...e, attendu: { ...e.attendu, numero: '21' } }, psc({ numero: '21', slug: 'Mareep-sC-021' })), /code-set-different/);
    });
    await test('sC2 admis mais nom différent : refusé (le drapeau n\'affaiblit pas le témoin du nom)', () => {
        const r = lue(sc({ dex: 25 }), psc());
        assert.strictEqual(r.ok, false);
        assert.match(r.motifs.join(','), /pokedex-different/);
        assert.doesNotMatch(r.motifs.join(','), /code-set-different/);
    });
    await test('sC3 sous sC : refusé (non prouvé) ; sC2 sous un autre slugSet ou un autre code : refusé', () => {
        assert.match(mt(sc({ codeSet: 'sC3' }), psc()), /code-set-different/);
        assert.match(mt(sc({ codeSet: 'sC21' }), psc()), /code-set-different/, 'comparaison exacte : sC21 n\'est pas sC2 (jamais un préfixe)');
        const e = sc();
        assert.match(mt(e, psc({ slugSet: 'Autre-Deck' })), /code-set-different/, 'le slugSet est exigé');
        assert.match(mt(e, psc({ slug: 'Mareep-sK-017', codeSet: 'sK' })), /code-set-different/, 'sC2 sous un set qui n\'est pas sC');
        assert.match(mt(sc({ codeSet: 'sC' }), psc({ slug: 'Mareep-sC2-017', codeSet: 'sC2' })), /code-set-different/, 'le sens est imposé : sC imprimé contre un produit sC2');
    });
    await test('T sous T-P (T-Promos) : admis avec drapeau ; set inventé T-Promos-2 et code TG : refusés', () => {
        assert.deepStrictEqual(lue(att4(lt()), pt()), { ok: true, motifs: [] });
        assert.ok(drap(att4(lt()), pt()).includes('code-imprime-admis:T'));
        assert.match(mt(att4(lt()), pt({ slug: 'Slowpoke-T-P2-004', slugSet: 'T-Promos-2', codeSet: 'T-P2' })), /code-set-different/, 'code et slugSet inventés');
        assert.match(mt(att4(lt()), pt({ slugSet: 'T-Promos-2' })), /code-set-different/, 'slugSet inventé');
        assert.match(mt(att4(lt({ codeSet: 'TG' })), pt()), /code-set-different/, 'TG n\'est pas T');
    });
    await test('code identique : inchangé, aucun drapeau ; la table est gelée et ne porte que les deux entrées prouvées', () => {
        assert.strictEqual(lue(trad(), ptrad()).ok, true);
        assert.ok(!drap(trad(), ptrad()).some(d => d.startsWith('code-imprime-admis')));
        assert.deepStrictEqual(Object.keys(PV.CODES_IMPRIMES_ADMIS).sort(), ['T-P', 'sC']);
        assert.ok(Object.isFrozen(PV.CODES_IMPRIMES_ADMIS) && Object.isFrozen(PV.CODES_IMPRIMES_ADMIS.sC) && Object.isFrozen(PV.CODES_IMPRIMES_ADMIS.sC.imprimes));
        assert.deepStrictEqual(PV.CODES_IMPRIMES_ADMIS.sC.imprimes.map(i => [i.code, [...i.numeros]]), [['sC2', ['17', '18', '19', '20']]]);
        assert.deepStrictEqual(PV.CODES_IMPRIMES_ADMIS['T-P'].imprimes.map(i => [i.code, [...i.numeros]]), [['T', ['004']]]);
    });
    console.log(`${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
