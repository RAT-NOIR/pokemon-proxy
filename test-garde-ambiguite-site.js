'use strict';
// La garde de lot rejoue `documentAmbigu` du site (règle IMPORTÉE du site, jamais recopiée). Aucune base, aucun vrai chemin : états fabriqués en mémoire.
//   node test-garde-ambiguite-site.js
const assert = require('assert');
const path = require('path');
const G = require('./collecte-cartes/garde-ambiguite-site');
const GC = require('./collecte-cartes/garde-contrat-api');
let ok = 0, ko = 0;
const t = async (nom, f) => { try { await f(); ok++; console.log('  ✅', nom); } catch (e) { ko++; console.log('  ❌', nom, '—', e.message); } };

const SET = { _id: 'Set-test', region: 'intl', tirage: 'intl', bulba: { expansion: 'Exp test' }, idExpansion: 9 };
const imp = numero => ({ tirage: 'intl', expansion: 'Exp test', numero });
const img = (numero, cleR2) => ({ set: 'Set-test', cleR2, numero });
const carte = (id, numeros, images) => ({ _id: id, nomEn: `Carte ${id}`, sets: ['Set-test'], impressions: numeros.map(imp), images });
const etat = (cartes, sets = [SET]) => ({ cartes, sets, cartesProduits: [{ _id: 1, carteId: 1 }] });
const touches = () => ['Set-test'];            // la liste des sets touchés est injectée : ce banc ne juge que la comparaison
const lib = process.env.RAT_MARKET_SITE_LIB || 'C:/Users/Yung/Desktop/rat-market-site/lib';

(async () => {
    let regle;
    await t('la règle du site s\'importe (sept fonctions)', async () => { regle = await G.chargerRegleAmbiguite({ lib }); assert.strictEqual(typeof regle.documentAmbigu, 'function'); });
    const rejouer = (avant, apres) => G.verifierAmbiguite({ regle, avant, apres, touchesFn: touches });

    await t('un document qui DEVIENT ambigu arrête (image sans numéro posée sur un document à 2 impressions)', () => {
        const v = rejouer(etat([carte(1, ['1', '2'], [img('1', 'a')])]), etat([carte(1, ['1', '2'], [img('1', 'a'), img(null, 'b')])]));
        assert.strictEqual(v.nouveaux.length, 1);
        assert.deepStrictEqual(v.bascules, ['Set-test']);
        assert.strictEqual(v.fautives.length, 2);
        assert.match(v.ligne, /1 sets rejoués · documents ambigus avant 0, après 1, nouveaux 1 · bascules 1/);
    });
    await t('un document DÉJÀ ambigu avant le lot passe et s\'imprime (persistant)', () => {
        const e = etat([carte(1, ['1', '2'], [img(null, 'b')])]);
        const v = rejouer(e, etat([carte(1, ['1', '2'], [img(null, 'b')])]));
        assert.deepStrictEqual(v.fautives, []);
        assert.strictEqual(v.persistants.length, 1);
        assert.match(v.ligne, /avant 1, après 1, nouveaux 0 · bascules 0 · persistants 1/);
    });
    await t('un autre document devient ambigu dans un set DÉJÀ ambigu : arrête quand même (nouveau)', () => {
        const avant = etat([carte(1, ['1', '2'], [img(null, 'b')]), carte(2, ['1', '2'], [img('1', 'c')])]);
        const apres = etat([carte(1, ['1', '2'], [img(null, 'b')]), carte(2, ['1', '2'], [img('1', 'c'), img(null, 'd')])]);
        const v = rejouer(avant, apres);
        assert.strictEqual(v.nouveaux.length, 1); assert.strictEqual(v.nouveaux[0].carteId, 2); assert.deepStrictEqual(v.bascules, []);
        assert.strictEqual(v.fautives.length, 1);
    });
    await t('une image AVEC numéro ne fait rien', () => {
        const v = rejouer(etat([carte(1, ['1', '2'], [img('1', 'a')])]), etat([carte(1, ['1', '2'], [img('1', 'a'), img('2', 'b')])]));
        assert.deepStrictEqual(v.fautives, []); assert.strictEqual(v.nouveaux.length, 0);
    });
    await t('une image sans numéro sur un document à UNE impression ne fait rien (pas plusieurs fiches)', () => {
        const v = rejouer(etat([carte(1, ['1'], [])]), etat([carte(1, ['1'], [img(null, 'b')])]));
        assert.deepStrictEqual(v.fautives, []);
    });
    await t('règle absente : chargerRegleAmbiguite LÈVE « je ne peux pas conclure »', async () => {
        const importer = async chemin => (/annexes\.ts$/.test(chemin) ? {} : { fichesDuDocument() {}, documentAmbigu() {}, setParImpression() {}, expansionsDuSet() {}, tirageDuSet() {}, impressionDuSet() {} });
        await assert.rejects(G.chargerRegleAmbiguite({ lib: 'x', importer }), /je ne peux pas conclure.*impressionsEtAnnexes/);
        await assert.rejects(G.chargerRegleAmbiguite({ lib: 'x', importer: async () => { throw new Error('introuvable'); } }), /je ne peux pas conclure.*introuvable/);
    });
    await t('règle absente ou qui lève dans le verdict : jouerAmbiguite BLOQUE et le dit (jamais ✅)', () => {
        const casse = { ...regle, documentAmbigu() { throw new Error('boum'); } };
        const e = etat([carte(1, ['1', '2'], [])]);
        const r1 = G.jouerAmbiguite({ regle: casse, avant: e, apres: e, touchesFn: touches });
        assert.strictEqual(r1.fautives.length, 1); assert.match(r1.fautives[0], /je ne peux pas conclure \(boum\)/);
        const r2 = G.jouerAmbiguite({ regle: { ...regle, fichesDuDocument: undefined }, avant: e, apres: e, touchesFn: touches });
        assert.match(r2.fautives[0], /je ne peux pas conclure.*fichesDuDocument/);
        const r3 = G.jouerAmbiguite({ regle: null, avant: e, apres: e, touchesFn: touches });
        assert.strictEqual(r3.fautives.length, 1);
    });
    await t('état vide : bloque (une comparaison sur du vide ne mesure rien)', () => {
        const r = G.jouerAmbiguite({ regle, avant: { cartes: [], sets: [SET] }, apres: etat([carte(1, ['1'], [])]), touchesFn: touches });
        assert.strictEqual(r.fautives.length, 1); assert.match(r.fautives[0], /vides/);
    });
    await t('PREUVE QUE LA GARDE SAIT REFUSER : sur un état fabriqué le verdict dit NON, sur le même état sans l\'image fautive il dit OUI', () => {
        const avant = etat([carte(1, ['1', '2'], [img('1', 'a')]), carte(2, ['5'], [img('5', 'z')])]);
        const mauvais = G.jouerAmbiguite({ regle, avant, apres: etat([carte(1, ['1', '2'], [img('1', 'a'), img(null, 'b')]), carte(2, ['5'], [img('5', 'z')])]), touchesFn: touches });
        const bon = G.jouerAmbiguite({ regle, avant, apres: etat([carte(1, ['1', '2'], [img('1', 'a')]), carte(2, ['5'], [img('5', 'z')])]), touchesFn: touches });
        assert.ok(mauvais.fautives.length > 0 && bon.fautives.length === 0);
    });
    await t('branchement : la liste des sets touchés vient de setsTouchesContrat (image ajoutée → le set est rejoué)', () => {
        const avant = etat([carte(1, ['1', '2'], [img('1', 'a')])]), apres = etat([carte(1, ['1', '2'], [img('1', 'a'), img(null, 'b')])]);
        const v = G.verifierAmbiguite({ regle, avant, apres, touchesFn: GC.setsTouchesContrat });
        assert.strictEqual(v.sets, 1); assert.strictEqual(v.nouveaux.length, 1);
    });
    // ── tour 1 : projection symétrique, cas « seul images[].numero change »
    const PROJ = { cartes: { sets: 1, nomEn: 1, 'impressions.tirage': 1, 'impressions.expansion': 1, 'impressions.deck': 1, 'impressions.numero': 1, 'images.set': 1, 'images.numero': 1 }, cartesProduits: { carteId: 1 } };
    await t('(1) un lot où seul un champ HORS projection change ne rejoue aucun set (avant et après projetés pareil)', () => {
        const c = (id, hors) => ({ ...carte(id, ['1', '2'], [img('1', 'a')]), collecteLe: hors, bulba: { x: hors } });
        const r = G.jouerAmbiguite({ regle, avant: etat([c(1, 'lundi')]), apres: etat([c(1, 'mardi')]), touchesFn: GC.setsTouchesContrat, projections: PROJ });
        assert.deepStrictEqual(r.fautives, []); assert.strictEqual(r.v.sets, 0);
        const sans = G.jouerAmbiguite({ regle, avant: etat([c(1, 'lundi')]), apres: etat([c(1, 'mardi')]), touchesFn: GC.setsTouchesContrat });
        assert.strictEqual(sans.v.sets, 1);                       // sans projection le champ hors projection ferait rejouer le set : c'est ce que la projection évite
    });
    await t('(1) la projection donne les mêmes verdicts qu\'un état déjà projeté', () => {
        const avant = etat([carte(1, ['1', '2'], [img('1', 'a')])]), apres = etat([carte(1, ['1', '2'], [img('1', 'a'), img(null, 'b')])]);
        const r = G.jouerAmbiguite({ regle, avant, apres, touchesFn: GC.setsTouchesContrat, projections: PROJ });
        assert.strictEqual(r.v.nouveaux.length, 1); assert.deepStrictEqual(r.v.bascules, ['Set-test']);
    });
    await t('(2) SEUL images[].numero change : numero effacé → le document devient ambigu et arrête', () => {
        const r = G.jouerAmbiguite({ regle, avant: etat([carte(1, ['1', '2'], [img('1', 'a')])]), apres: etat([carte(1, ['1', '2'], [img(null, 'a')])]), touchesFn: GC.setsTouchesContrat, projections: PROJ });
        assert.strictEqual(r.v.sets, 1); assert.strictEqual(r.v.nouveaux.length, 1); assert.strictEqual(r.fautives.length, 2);
    });
    await t('(2) SEUL images[].numero change : numero posé sur une image ambiguë → le set se répare, rien n\'arrête', () => {
        const r = G.jouerAmbiguite({ regle, avant: etat([carte(1, ['1', '2'], [img(null, 'a')])]), apres: etat([carte(1, ['1', '2'], [img('1', 'a')])]), touchesFn: GC.setsTouchesContrat, projections: PROJ });
        assert.deepStrictEqual(r.fautives, []); assert.strictEqual(r.v.avant, 1); assert.strictEqual(r.v.apres, 0);
    });

    // ── tour 1 points 3 et 4 : la décision d'arrêt, isolée, avec des doubles en mémoire (aucune base, aucune grappe)
    const DL = require('./collecte-cartes/decision-lot');
    const doubles = (relu = { ok: true }) => { const appels = []; return { appels, restaurer: async () => { appels.push('restaurer'); }, relire: async () => { appels.push('relire'); return relu; } }; };
    await t('(4) fautif (ambiguïté) → restauration appelée → relecture → code d\'arrêt 3', async () => {
        const d = doubles();
        const r = await DL.arretDuLot({ nonAutorisees: [], contrat: [], ambiguite: ['ambiguïté du site : x'], restaurer: d.restaurer, relire: d.relire });
        assert.deepStrictEqual(d.appels, ['restaurer', 'relire']); assert.strictEqual(r.arret, true); assert.strictEqual(r.code, 3);
    });
    await t('(4) fautif et relecture incomplète → code 4', async () => {
        const d = doubles({ ok: false });
        const r = await DL.arretDuLot({ nonAutorisees: [], contrat: ['c'], ambiguite: [], restaurer: d.restaurer, relire: d.relire });
        assert.strictEqual(r.code, 4); assert.deepStrictEqual(d.appels, ['restaurer', 'relire']);
    });
    await t('(4) non fautif → ni restauration ni relecture, pas d\'arrêt', async () => {
        const d = doubles();
        const r = await DL.arretDuLot({ nonAutorisees: [], contrat: [], ambiguite: [], restaurer: d.restaurer, relire: d.relire });
        assert.deepStrictEqual(d.appels, []); assert.strictEqual(r.arret, false); assert.strictEqual(r.code, null);
    });
    await t('(4) une restauration qui lève : l\'erreur remonte, la relecture n\'a pas lieu (jamais ✅)', async () => {
        const appels = [];
        await assert.rejects(DL.arretDuLot({ nonAutorisees: [{}], contrat: [], ambiguite: [], restaurer: async () => { throw new Error('boum'); }, relire: async () => { appels.push('relire'); return { ok: true }; } }), /boum/);
        assert.deepStrictEqual(appels, []);
    });
    await t('(3) le message nomme la cause : ambiguïté seule ≠ contrat API', () => {
        const a = DL.causesDArret({ nonAutorisees: [], contrat: [], ambiguite: ['x', 'y'] });
        assert.match(a.phrases.join(' '), /2 refus de l'AMBIGUÏTÉ DU SITE/); assert.doesNotMatch(a.phrases.join(' '), /CONTRAT/); assert.strictEqual(a.court, 'refus de l\'ambiguïté du site');
        const c = DL.causesDArret({ nonAutorisees: [], contrat: ['x'], ambiguite: [] });
        assert.match(c.phrases.join(' '), /1 refus du CONTRAT DE L'API/); assert.doesNotMatch(c.phrases.join(' '), /AMBIGU/); assert.strictEqual(c.court, 'refus du contrat API');
        const m = DL.causesDArret({ nonAutorisees: [{}], contrat: ['x'], ambiguite: ['y'] });
        assert.strictEqual(m.phrases.length, 3); assert.match(m.court, /baisses non annoncées.*contrat API.*ambiguïté du site/);
    });
    await t('lot-additif.js appelle la décision isolée, fautives séparées par cause, projection symétrique', () => {
        const src = require('fs').readFileSync(path.join(__dirname, 'lot-additif.js'), 'utf8');
        for (const m of [/garde-ambiguite-site/, /chargerRegleAmbiguite/, /jouerAmbiguite/, /DL\.arretDuLot\(/, /DL\.causesDArret\(/, /projections: \{ cartes: api\.projectionsEtat\.cartes/]) assert.match(src, m);
        assert.doesNotMatch(src, /'refus du contrat API'\} \$\{liste\(fautives\)\}/);
    });

    console.log(`\n${ok} passés, ${ko} en échec`);
    process.exit(ko ? 1 : 0);
})();
