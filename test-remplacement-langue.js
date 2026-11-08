// node test-remplacement-langue.js — le remplacement d'une entrée de LANGUE NON PROUVÉE par un scan dont la langue est lue sur la carte (décision du testeur, 2026-11-08 : « OUI pour les 255 scans
// anglais prouvés, à la place des scans de langue non prouvée, sous la garde de lot, anciennes images journalisées »). Pur : aucune base, aucun réseau.
// Ce que le banc garde, une garde s'écrivant par ce qu'elle AUTORISE :
//   · la branche ne s'ouvre que pour une famille de la table fermée (N8O1), posée sur la candidate par la chaîne prv (jamais par un manifeste) ;
//   · l'entrée doit être de la source de la table ET de langue absente/null ; même set, même numéro (cleNumero), mêmes marqueurs de variante, document lisible ;
//   · la candidate doit porter exactement la langue de la table, n'être ni basse définition ni de largeur inconnue ;
//   · tout le reste (deux langues connues différentes, autre source, aucune famille) ne bouge pas.
const assert = require('assert');
const B = require('./collecte-cartes/basse-definition');
const RC = require('./collecte-cartes/recolte-commun');
const CT = require('./collecte-cartes/cardtrader');

let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log(`✅ ${nom}`); } catch (e) { ko++; console.log(`❌ ${nom}\n   ${e.message}`); } };

const M = B.MARQUEUR_REMPLACEMENT_LANGUE;
const cleDoc = e => `${e.source}|${e.set}|${e.cleR2}`;
const docs = (images, plus = {}) => new Map(images.map(e => [cleDoc(e), { ...(plus[cleDoc(e)] || {}) }]));
const ancienne = (o = {}) => ({ set: 'Shining-Fates', source: 'bulbapedia', numero: '023', cleR2: 'bulbapedia/SF/023.webp', w: 700, wOriginal: 734, ...o });   // langue absente
const nouvelle = (o = {}) => ({ set: 'Shining-Fates', source: 'prv', numero: '23', cleR2: 'prv/SF/23.webp', langue: 'en', wOriginal: 734, w: 700, [M]: 'N8O1', ...o });
const rem = (images, cand, plus) => B.entreesARemplacer(images, cand, { documents: docs(images, plus) }).map(e => e.cleR2);

t('la table fermée : N8O1 seulement, langue en, source bulbapedia, décision nommée', () => {
    assert.deepStrictEqual(Object.keys(B.REMPLACEMENTS_LANGUE_NON_PROUVEE), ['N8O1']);
    const a = B.REMPLACEMENTS_LANGUE_NON_PROUVEE.N8O1;
    assert.strictEqual(a.langue, 'en'); assert.deepStrictEqual(a.sources, ['bulbapedia']); assert.match(a.decision, /2026-11-08/);
    assert.ok(Object.isFrozen(B.REMPLACEMENTS_LANGUE_NON_PROUVEE));
});
t('famille autorisée + entrée bulbapedia de langue absente, même set et numéro → sort', () => assert.deepStrictEqual(rem([ancienne()], nouvelle()), ['bulbapedia/SF/023.webp']));
t('… langue null (et non absente) → sort aussi', () => assert.deepStrictEqual(rem([ancienne({ langue: null })], nouvelle()), ['bulbapedia/SF/023.webp']));
t('… langue chaîne vide → sort (pas une chaîne non vide)', () => assert.deepStrictEqual(rem([ancienne({ langue: '' })], nouvelle()), ['bulbapedia/SF/023.webp']));
t('SANS le marqueur de famille → rien (l\'état d\'avant)', () => { const { [M]: _m, ...sans } = nouvelle(); assert.deepStrictEqual(rem([ancienne()], sans), []); });
t('marqueur d\'une famille inconnue → rien', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ [M]: 'AUTRE' })), []));
t('marqueur booléen (true) → rien : il faut le NOM d\'une famille de la table', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ [M]: true })), []));
t('marqueur hérité (__proto__ / toString) → rien', () => assert.deepStrictEqual([rem([ancienne()], nouvelle({ [M]: 'toString' })), rem([ancienne()], nouvelle({ [M]: '__proto__' }))], [[], []]));
t('famille autorisée mais entrée de langue ja → la règle existante seulement (rien)', () => assert.deepStrictEqual(rem([ancienne({ langue: 'ja' })], nouvelle()), []));
t('famille autorisée mais entrée de langue en, de taille voisine → la règle existante seulement (rien)', () => assert.deepStrictEqual(rem([ancienne({ langue: 'en' })], nouvelle()), []));
t('entrée de langue en, basse définition → la règle existante la remplace toujours', () => assert.deepStrictEqual(rem([ancienne({ langue: 'en', basseDefinition: true, wOriginal: 300 })], nouvelle()), ['bulbapedia/SF/023.webp']));
t('entrée d\'une autre source (tcgdex), langue null → rien', () => assert.deepStrictEqual(rem([ancienne({ source: 'tcgdex', cleR2: 'tcgdex/x.webp' })], nouvelle()), []));
t('autre numéro → rien', () => assert.deepStrictEqual(rem([ancienne({ numero: '024' })], nouvelle()), []));
t('autre set → rien', () => assert.deepStrictEqual(rem([ancienne({ set: 'Crown-Zenith' })], nouvelle()), []));
t('tampon différent (entrée avec noteVariante) → rien', () => assert.deepStrictEqual(rem([ancienne({ noteVariante: 'Galarian Gallery' })], nouvelle()), []));
t('tampon différent (candidate tamponnée, entrée non) → rien', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ tampon: 'Staff' })), []));
t('marqueur de variante porté seulement par le DOCUMENT de l\'entrée → rien', () => { const e = ancienne(); assert.deepStrictEqual(rem([e], nouvelle(), { [cleDoc(e)]: { noteVariante: 'x' } }), []); });
t('document de l\'entrée INTROUVABLE → rien', () => assert.deepStrictEqual(B.entreesARemplacer([ancienne()], nouvelle(), { documents: new Map() }).length, 0));
t('entrée sans cleR2 (absente, null, vide, non chaîne) → rien : le $pull partirait sans clé', () => {
    for (const c of [undefined, null, '', 5]) { const e = ancienne({ cleR2: c }); assert.strictEqual(B.entreesARemplacer([e], nouvelle(), { documents: docs([e]) }).length, 0); }
});
t('documents omis → rien', () => assert.deepStrictEqual(B.entreesARemplacer([ancienne()], nouvelle()).length, 0));
t('document CONTRADICTOIRE avec l\'entrée → rien', () => { const e = ancienne({ noteVariante: 'a' }); assert.deepStrictEqual(rem([e], nouvelle(), { [cleDoc(e)]: { noteVariante: 'b' } }), []); });
t('candidate basse définition (marquée) → rien', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ basseDefinition: true })), []));
t('candidate de largeur d\'original basse sans marque → rien', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ wOriginal: 300, w: 300 })), []));
t('largeur de la candidate inconnue → rien', () => { const { wOriginal: _a, w: _b, ...sans } = nouvelle(); assert.deepStrictEqual(rem([ancienne()], sans), []); });
t('candidate de langue fr → rien', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ langue: 'fr' })), []));
t('candidate de langue ja → rien', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ langue: 'ja' })), []));
t('candidate de langue null → rien', () => assert.deepStrictEqual(rem([ancienne()], nouvelle({ langue: null })), []));
t('la candidate n\'est pas son propre remplacement', () => assert.deepStrictEqual(rem([ancienne({ source: 'prv', cleR2: 'prv/SF/23.webp' })], nouvelle()), []));
t('empruntée à un autre tirage (entrée) → rien : mêmes marqueurs exigés', () => assert.deepStrictEqual(rem([ancienne({ imageEmprunteeTirage: true, tamponNonRepresente: 'Staff' })], nouvelle()), []));

// ── la chaîne prv pose le marqueur à partir de la FAMILLE de l'unité, et d'elle seule ──────────────────────────────────────────────────────────
const SRC_PRV = RC.fabriquerSource({ SOURCE: 'prv', LOT: 'prv-2026-10', LANGUE: 'par-unite', LANGUE_PREUVE: 'x', TIRAGE: 'par-unite', CHAMP_BILAN: 'bilanLotPrv', parUnite: true });
const SRC_AUTRE = RC.fabriquerSource({ SOURCE: 'autre', LOT: 'l', LANGUE: 'en', LANGUE_PREUVE: 'x', TIRAGE: 'intl', CHAMP_BILAN: 'bilanAutre' });
const unite = (o = {}) => ({ slugSet: 'Shining-Fates', numero: '23', langue: 'en', groupe: 'N8O1', ...o });
t('candidatDe (source parUnite) : la famille N8O1 pose le marqueur', () => assert.strictEqual(RC.candidatDe(SRC_PRV, unite(), { cleR2: 'k', wOriginal: 734 })[M], 'N8O1'));
t('candidatDe : une autre famille ne le pose pas', () => assert.strictEqual(RC.candidatDe(SRC_PRV, unite({ groupe: 'ZZ' }), { cleR2: 'k', wOriginal: 734 })[M], undefined));
t('candidatDe : un champ du manifeste (champsEntree, marqueur sur l\'unité) ne le pose pas', () => {
    const c = RC.candidatDe(SRC_PRV, unite({ groupe: 'ZZ', [M]: 'N8O1', champsEntree: { [M]: 'N8O1' } }), { cleR2: 'k', wOriginal: 734, [M]: 'N8O1' });
    assert.strictEqual(c[M], undefined);
});
t('candidatDe : une source qui n\'est pas parUnite ne le pose jamais', () => assert.strictEqual(RC.candidatDe(SRC_AUTRE, unite(), { cleR2: 'k', wOriginal: 734 })[M], undefined));
t('l\'entrée écrite (entreeDeCarte) ne porte pas le marqueur', () => {
    const e = RC.entreeDeCarte(SRC_PRV, unite({ url: 'https://x/y.png', produits: [1], carteId: 5, languePreuve: 'lue sur le scan', champsEntree: { [M]: 'N8O1' } }), { cleR2: 'k', sha256: 'a', w: 700, h: 980, fmt: 'webp', wOriginal: 734 });
    assert.strictEqual(e[M], undefined);
});
t('de bout en bout : decisionEcriture (la cible de « cede ») ajoute et remplace avec le marqueur, cède sans', () => {
    const images = [ancienne()];
    const avec = CT.decisionEcriture(images, RC.candidatDe(SRC_PRV, unite(), { cleR2: 'k', wOriginal: 734 }), { documents: docs(images) });
    assert.strictEqual(avec.action, 'ajouter'); assert.deepStrictEqual(avec.remplace.map(e => e.cleR2), ['bulbapedia/SF/023.webp']);
    const sans = CT.decisionEcriture(images, RC.candidatDe(SRC_PRV, unite({ groupe: 'ZZ' }), { cleR2: 'k', wOriginal: 734 }), { documents: docs(images) });
    assert.strictEqual(sans.action, 'cede');
});

// ── le plan compte et liste à part ces remplacements ───────────────────────────────────────────────────────────────────────────────────────────
t('remplacementsLangueNonProuvee : liste carteId/set/numero/cleR2 des seules entrées de langue non prouvée sortantes', () => {
    const us = [
        { carteId: 5, slugSet: 'Shining-Fates', numero: '23', cleR2: 'prv/SF/23.webp', groupe: 'N8O1', decision: { action: 'ajouter', remplace: [ancienne(), ancienne({ langue: 'en', cleR2: 'b.webp', basseDefinition: true })] } },
        { carteId: 6, slugSet: 'S', numero: '1', cleR2: 'prv/S/1.webp', groupe: 'X', decision: { action: 'ajouter', remplace: [ancienne({ langue: 'id', cleR2: 'c.webp' })] } },
        { carteId: 7, slugSet: 'S', numero: '2', cleR2: 'prv/S/2.webp', groupe: 'X', decision: { action: 'cede', remplace: [] } }
    ];
    assert.deepStrictEqual(B.remplacementsLangueNonProuvee(us), [{ carteId: 5, set: 'Shining-Fates', numero: '023', source: 'bulbapedia', cleR2: 'bulbapedia/SF/023.webp', remplacePar: 'prv/SF/23.webp', famille: 'N8O1' }]);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
