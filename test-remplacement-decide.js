// node test-remplacement-decide.js — le remplacement DÉCIDÉ (testeur, 2026-11-08) : « pose-le aussi en base, meilleur que le 600 × 825 actuel » (Pikachu ex 30th Celebration n° 150, produit 907757, famille N8P3).
// Table FERMÉE famille → liste d'idProduct. La branche ne s'ouvre que si : famille de la table ET produit de la liste (posé sur la candidate par candidatDe, jamais par un manifeste) ; même impression
// (set, numéro, mêmes marqueurs), langues connues et égales, largeur de l'ORIGINAL de la candidate connue et STRICTEMENT supérieure à celle de l'entrée. Sinon : la règle ordinaire (cède). Pur : ni base ni réseau.
const assert = require('assert');
const B = require('./collecte-cartes/basse-definition');
const RC = require('./collecte-cartes/recolte-commun');
const CT = require('./collecte-cartes/cardtrader');

let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`❌ ${nom}\n   ${e.message}`); } };

const cleDoc = e => `${e.source}|${e.set}|${e.cleR2}`;
const docs = images => new Map(images.map(e => [cleDoc(e), {}]));
const SRC = RC.fabriquerSource({ SOURCE: 'prv', LOT: 'prv-2026-10', LANGUE: 'par-unite', LANGUE_PREUVE: 'x', TIRAGE: 'par-unite', CHAMP_BILAN: 'bilanLotPrv', parUnite: true });
const SRC_AUTRE = RC.fabriquerSource({ SOURCE: 'autre', LOT: 'l', LANGUE: 'en', LANGUE_PREUVE: 'x', TIRAGE: 'intl', CHAMP_BILAN: 'bilanAutre' });
const actuelle = (o = {}) => ({ set: '30th-Celebration', source: 'tcgdex', numero: '150', cleR2: 'tcgdex/30th-Celebration/150-357180.webp', langue: 'en', w: 600, wOriginal: 600, ...o });
const unite = (o = {}) => ({ slugSet: '30th-Celebration', numero: '150', langue: 'en', groupe: 'N8P3', produits: [907757], ...o });
const decision = (images, u, w = 733) => CT.decisionEcriture(images, RC.candidatDe(SRC, u, { cleR2: 'prv/30C/150.webp', wOriginal: w }), { documents: docs(images) });
const sorties = d => d.remplace.map(e => e.cleR2);

t('la table fermée : N8P3 → [907757], décision nommée, gelée', () => {
    assert.ok(B.REMPLACEMENTS_DECIDES && Object.isFrozen(B.REMPLACEMENTS_DECIDES));
    assert.deepStrictEqual(Object.keys(B.REMPLACEMENTS_DECIDES), ['N8P3']);
    assert.deepStrictEqual([...B.REMPLACEMENTS_DECIDES.N8P3.produits], [907757]);
    assert.match(B.REMPLACEMENTS_DECIDES.N8P3.decision, /2026-11-08/);
});
t('907757 de N8P3, plus large (733 > 600), même langue → ajoute et remplace', () => {
    const d = decision([actuelle()], unite());
    assert.strictEqual(d.action, 'ajouter'); assert.deepStrictEqual(sorties(d), ['tcgdex/30th-Celebration/150-357180.webp']);
});
t('largeur égale → cède', () => assert.strictEqual(decision([actuelle()], unite(), 600).action, 'cede'));
t('largeur plus petite → cède', () => assert.strictEqual(decision([actuelle()], unite(), 500).action, 'cede'));
t('un AUTRE produit de N8P3 → cède', () => assert.strictEqual(decision([actuelle()], unite({ produits: [111111] })).action, 'cede'));
t('907757 mêlé à un autre produit dans l\'unité → cède (tous les produits doivent être listés)', () => assert.strictEqual(decision([actuelle()], unite({ produits: [907757, 111111] })).action, 'cede'));
t('unité sans produits → cède', () => assert.strictEqual(decision([actuelle()], unite({ produits: [] })).action, 'cede'));
t('le même produit dans une AUTRE famille → cède', () => assert.strictEqual(decision([actuelle()], unite({ groupe: 'ZZ' })).action, 'cede'));
t('langue de l\'entrée différente → cède', () => assert.strictEqual(decision([actuelle({ langue: 'fr' })], unite()).action, 'cede'));
t('langue de l\'entrée inconnue → cède (la branche ne remplace pas une langue inconnue)', () => assert.strictEqual(decision([actuelle({ langue: null })], unite()).action, 'cede'));
t('langue de la candidate inconnue → rien ne sort', () => {
    const c = { set: '30th-Celebration', numero: '150', langue: null, source: 'prv', cleR2: 'k', wOriginal: 733, [B.MARQUEUR_REMPLACEMENT_DECIDE]: 'N8P3' };
    assert.strictEqual(B.entreesARemplacer([actuelle()], c, { documents: docs([actuelle()]) }).length, 0);
});
t('marqueur de variante différent (entrée avec noteVariante) → cède', () => assert.strictEqual(decision([actuelle({ noteVariante: 'x' })], unite()).action, 'cede'));
t('marqueur de variante différent (candidate tamponnée) → cède', () => assert.strictEqual(decision([actuelle()], unite({ tampon: 'Staff' })).action, 'cede'));
t('la table épingle l\'impression : set, numéro, langue', () => {
    const a = B.REMPLACEMENTS_DECIDES.N8P3;
    assert.strictEqual(a.set, '30th-Celebration'); assert.strictEqual(a.numero, '150'); assert.strictEqual(a.langue, 'en');
});
t('même produit/famille mais candidate ja (entrée ja aussi) → cède', () => assert.deepStrictEqual(sorties(decision([actuelle({ langue: 'ja' })], unite({ langue: 'ja' }))), []));
t('même produit/famille mais autre numéro (entrée et candidate au 151) → cède', () => assert.deepStrictEqual(sorties(decision([actuelle({ numero: '151' })], unite({ numero: '151' }))), []));
t('même produit/famille mais autre set (entrée et candidate) → cède', () => assert.deepStrictEqual(sorties(decision([actuelle({ set: 'Crown-Zenith' })], unite({ slugSet: 'Crown-Zenith' }))), []));
t('le numéro s\'écrit « 150 » ou « 0150 » (cleNumero) → remplace', () => assert.deepStrictEqual(sorties(decision([actuelle({ numero: '0150' })], unite({ numero: '0150' }))), ['tcgdex/30th-Celebration/150-357180.webp']));
t('le marqueur ne vit pas non plus sur le document (champsDocument)', () => {
    const M = B.MARQUEUR_REMPLACEMENT_DECIDE;
    const d = RC.documentImage(SRC, unite({ url: 'https://x/y.png', carteId: 5, languePreuve: 'lue', champsDocument: { [M]: 'N8P3' } }), { cleR2: 'k', sha256: 'a', w: 700, h: 980, fmt: 'webp', wOriginal: 733, hOriginal: 1024 });
    assert.strictEqual(d[M], undefined);
});
t('autre numéro → rien ne sort', () => assert.deepStrictEqual(sorties(decision([actuelle({ numero: '151' })], unite())), []));
t('document de l\'entrée introuvable → cède', () => {
    const d = CT.decisionEcriture([actuelle()], RC.candidatDe(SRC, unite(), { cleR2: 'k', wOriginal: 733 }), { documents: new Map() });
    assert.strictEqual(d.action, 'cede');
});
t('largeur d\'original de la candidate inconnue → cède', () => {
    const c = RC.candidatDe(SRC, unite(), { cleR2: 'k' });
    assert.strictEqual(B.entreesARemplacer([actuelle()], c, { documents: docs([actuelle()]) }).length, 0);
});
t('largeur de l\'entrée inconnue → cède', () => {
    const { w: _w, wOriginal: _o, ...sans } = actuelle();
    assert.strictEqual(decision([sans], unite()).action, 'cede');
});
t('entrée empruntée à un autre tirage → la règle des emprunts, pas la branche (cède)', () => assert.strictEqual(decision([actuelle({ imageEmprunteeTirage: true, tamponNonRepresente: 'Staff' })], unite()).action, 'cede'));
t('une source qui n\'est pas parUnite ne pose jamais le marqueur', () => assert.strictEqual(RC.candidatDe(SRC_AUTRE, unite(), { cleR2: 'k', wOriginal: 733 })[B.MARQUEUR_REMPLACEMENT_DECIDE], undefined));
t('un champ du manifeste ne pose pas le marqueur ; l\'entrée écrite non plus', () => {
    const M = B.MARQUEUR_REMPLACEMENT_DECIDE;
    const c = RC.candidatDe(SRC, unite({ groupe: 'ZZ', [M]: 'N8P3', champsEntree: { [M]: 'N8P3' } }), { cleR2: 'k', wOriginal: 733, [M]: 'N8P3' });
    assert.strictEqual(c[M], undefined);
    const e = RC.entreeDeCarte(SRC, unite({ url: 'https://x/y.png', carteId: 5, languePreuve: 'lue', champsEntree: { [M]: 'N8P3' } }), { cleR2: 'k', sha256: 'a', w: 700, h: 980, fmt: 'webp', wOriginal: 733 });
    assert.strictEqual(e[M], undefined);
});
t('marqueur hérité / booléen / famille inconnue posé à la main sur la candidate → rien', () => {
    const M = B.MARQUEUR_REMPLACEMENT_DECIDE;
    for (const v of ['toString', '__proto__', true, 'AUTRE']) {
        const c = { set: '30th-Celebration', numero: '150', langue: 'en', source: 'prv', cleR2: 'k', wOriginal: 733, [M]: v };
        assert.strictEqual(B.entreesARemplacer([actuelle()], c, { documents: docs([actuelle()]) }).length, 0);
    }
});
t('sans marqueur : 733 contre 600 (ratio 1,22) cède, comme avant', () => {
    const c = { set: '30th-Celebration', numero: '150', langue: 'en', source: 'prv', cleR2: 'k', wOriginal: 733 };
    assert.strictEqual(B.entreesARemplacer([actuelle()], c, { documents: docs([actuelle()]) }).length, 0);
});
t('la règle ordinaire (ratio 1,5) reste valable sans marqueur', () => {
    const c = { set: '30th-Celebration', numero: '150', langue: 'en', source: 'prv', cleR2: 'k', wOriginal: 900 };
    assert.strictEqual(B.entreesARemplacer([actuelle()], c, { documents: docs([actuelle()]) }).length, 1);
});
t('remplacementsDecides : liste à part les seules entrées sortant par la branche décidée', () => {
    const us = [
        { carteId: 5, slugSet: '30th-Celebration', numero: '150', cleR2: 'prv/30C/150.webp', groupe: 'N8P3', produits: [907757], decision: { action: 'ajouter', remplace: [actuelle()] } },
        { carteId: 6, slugSet: 'S', numero: '1', cleR2: 'prv/S/1.webp', groupe: 'X', produits: [1], decision: { action: 'ajouter', remplace: [actuelle({ cleR2: 'c.webp', basseDefinition: true })] } },
        { carteId: 7, slugSet: 'S', numero: '2', cleR2: 'prv/S/2.webp', groupe: 'N8P3', produits: [111111], decision: { action: 'cede', remplace: [] } }
    ];
    assert.deepStrictEqual(B.remplacementsDecides(us), [{ carteId: 5, set: '30th-Celebration', numero: '150', source: 'tcgdex', cleR2: 'tcgdex/30th-Celebration/150-357180.webp', remplacePar: 'prv/30C/150.webp', famille: 'N8P3', produits: [907757] }]);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
