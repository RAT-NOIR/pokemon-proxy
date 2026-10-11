// Banc PUR (aucune base) de collecte-cartes/numero-fiche.js : le numeroFiche écrit est celui de l'IMPRESSION, jamais un numéro qui détache le produit.
//   node test-numero-fiche.js
const assert = require('assert');
const { numeroComparable, enDefaut, calibrerForme, numeroReparé, numeroFicheDeCreation, numerosFichesDuPlan, numerosDuSet, FORMES } = require('./collecte-cartes/numero-fiche');
let ok = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ok  ' + nom); } catch (e) { console.error('  ÉCHEC  ' + nom + '\n     ' + e.message); process.exitCode = 1; } };

const SET_GBML = { tirage: 'jp', region: 'jp', bulba: { expansion: 'Gift Box Mew • Lucario' } };
const SET_QCP = { tirage: 'jp', region: 'jp', bulba: { expansion: 'Quick Construction Packs' } };
const carte = (exp, numero, tirage = 'jp') => ({ impressions: [{ tirage, expansion: exp, numero }] });
const d = (c, numero) => ({ carte: c, p: { numero } });

t('numeroComparable : la règle du site (lettre finale gardée, zéros retirés, parenthèse coupée)', () => {
    assert.strictEqual(numeroComparable('007L'), '7L'); assert.strictEqual(numeroComparable('007'), '7');
    assert.strictEqual(numeroComparable('G002'), 'G002'); assert.strictEqual(numeroComparable('SWSH139 (Top Left)'), 'SWSH139');
});
t('enDefaut : 007L contre l\'impression 007 est en défaut ; SWSH139 contre « SWSH139 (Top Left) » ne l\'est PAS (le site coupe la parenthèse)', () => {
    assert.strictEqual(enDefaut('007L', ['007']), true);
    assert.strictEqual(enDefaut('SWSH139', ['SWSH139 (Top Left)', 'SWSH140 (Top Right)']), false);
    assert.strictEqual(enDefaut('007L', []), false);   // aucune impression numérotée : le site ne contredit rien
});
t('Gift Box : la lettre de deck finale est la forme calibrée, la valeur écrite est le numéro DE L\'IMPRESSION', () => {
    const lignes = [{ numeroFiche: '007L', numeros: ['007'] }, { numeroFiche: '003M', numeros: ['003'] }];
    const { forme } = calibrerForme(lignes);
    assert.strictEqual(forme.id, 'suffixe-lettres');
    assert.strictEqual(numeroReparé('007L', ['007'], forme), '007');
});
t('Quick Construction Packs : le préfixe « G » est la forme calibrée', () => {
    const { forme } = calibrerForme([{ numeroFiche: 'G002', numeros: ['002'] }, { numeroFiche: 'G010', numeros: ['010'] }]);
    assert.strictEqual(forme.id, 'prefixe-lettres');
});
t('un set dont les lignes ne partagent pas une forme n\'est pas calibré (une ligne en préfixe, une en suffixe)', () => {
    const r = calibrerForme([{ numeroFiche: 'G002', numeros: ['002'] }, { numeroFiche: '003M', numeros: ['003'] }]);
    assert.strictEqual(r.forme, null);
});
t('une forme qui désignerait DEUX impressions ne désigne rien (007L → 007 ; 007 et 07 sont le même comparable : une seule ; 007 et 7B : deux)', () => {
    assert.strictEqual(calibrerForme([{ numeroFiche: 'X7', numeros: ['7A', '7'] }]).forme?.id, 'prefixe-lettres');   // « 7 » seul désigné
    assert.strictEqual(numeroReparé('7L', ['7', '07A'], FORMES.find(f => f.id === 'suffixe-lettres')), '7');
});
t('une forme ambiguë entre deux formes est refusée, pas tranchée', () => {
    // « G2L » : prefixe → « 2L », suffixe → « G2 » ; deux impressions « 2L » et « G2 » : les deux formes conviennent
    const r = calibrerForme([{ numeroFiche: 'G2L', numeros: ['2L', 'G2'] }]);
    assert.strictEqual(r.forme, null); assert.ok(/ambigu/.test(r.raison));
});
t('ÉCRIVAIN Gift Box : la ligne neuve porte « 007 », pas « 007L »', () => {
    const lots = [d(carte('Gift Box Mew • Lucario', '007'), '007L'), d(carte('Gift Box Mew • Lucario', '003'), '003M')];
    const r = numerosFichesDuPlan(lots, SET_GBML);
    assert.strictEqual(r.valeurs.get(lots[0]), '007'); assert.strictEqual(r.valeurs.get(lots[1]), '003'); assert.strictEqual(r.enDefaut, 2);
});
t('ÉCRIVAIN Quick Construction Packs : « G002 » devient « 002 »', () => {
    const lots = [d(carte('Quick Construction Packs', '002'), 'G002')];
    assert.strictEqual(numerosFichesDuPlan(lots, SET_QCP).valeurs.get(lots[0]), '002');
});
t('ÉCRIVAIN : sans forme calibrable, il n\'écrit PAS un numéro faux (null)', () => {
    const lots = [d(carte('Gift Box Mew • Lucario', '007'), 'X-ZZZ-9')];
    assert.strictEqual(numerosFichesDuPlan(lots, SET_GBML).valeurs.get(lots[0]), null);
});
t('ÉCRIVAIN : une carte sans impression dans le set (désignation croisée) garde le numéro Cardmarket ; une ligne déjà juste aussi', () => {
    const a = d({ impressions: [{ tirage: 'intl', expansion: 'Autre', numero: '5' }] }, 'V1'), b = d(carte('Quick Construction Packs', '004'), '4');
    const r = numerosFichesDuPlan([a, b], SET_QCP);
    assert.strictEqual(r.valeurs.get(a), 'V1'); assert.strictEqual(r.valeurs.get(b), '4');
});
t('numerosDuSet ne lit que (tirage, expansion) du set, et seulement les numéros non nuls', () => {
    const imps = [{ tirage: 'jp', expansion: 'Quick Construction Packs', numero: '1' }, { tirage: 'intl', expansion: 'Quick Construction Packs', numero: '2' }, { tirage: 'jp', expansion: 'Quick Construction Packs', numero: null }];
    assert.deepStrictEqual(numerosDuSet(imps, SET_QCP), ['1']);
});
t('numeroFicheDeCreation : numéro Cardmarket vide → null', () => assert.strictEqual(numeroFicheDeCreation({ numeros: ['1'], numeroCardmarket: ' ', forme: null }), null));
console.log(`\n${ok} bancs verts`);
