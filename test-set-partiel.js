// Banc PUR de collecte-cartes/set-partiel.js (R3 : Promos 2107, set partiel). Aucune base, aucun réseau.
//   node test-set-partiel.js
const assert = require('assert');
const SP = require('./collecte-cartes/set-partiel');

let ok = 0, ko = 0;
const t = (nom, f) => { try { f(); ok++; console.log('  ✅ ' + nom); } catch (e) { ko++; console.log('  ❌ ' + nom + '\n     ' + String(e.message).split('\n')[0]); } };

// ── décodage du slug : le MÊME que poser-reimpressions.js ──
t('décode « Ultra-Ball-V1-PRBRS-150 » : code BRS n°150 (le -V1 est retiré)', () => assert.deepStrictEqual(SP.decoderOrigine('Ultra-Ball-V1-PRBRS-150', 'PR'), { code: 'BRS', num: '150' }));
t('décode « Pidgey-PRMEW-016 »', () => assert.deepStrictEqual(SP.decoderOrigine('Pidgey-PRMEW-016', 'PR'), { code: 'MEW', num: '016' }));
t('« Fire-Energy-PR14 » ne se décode pas (pas de code d\'origine)', () => assert.strictEqual(SP.decoderOrigine('Fire-Energy-PR14', 'PR'), null));
t('« Metal-Energy-V1-PR0 » ne se décode pas', () => assert.strictEqual(SP.decoderOrigine('Metal-Energy-V1-PR0', 'PR'), null));
t('« Ultra-Ball-V7-ASCMEG-131 » ne se décode pas sous PR (autre code de set)', () => assert.strictEqual(SP.decoderOrigine('Ultra-Ball-V7-ASCMEG-131', 'PR'), null));
t('un slug absent ne se décode pas', () => assert.strictEqual(SP.decoderOrigine(null, 'PR'), null));

// ── résolution : code → expansions → numéro → produits d'origine → carte ──
const ctxDe = (o = {}) => ({
    expsDuCode: new Map([['BRS', new Set([10])], ['SIT', new Set([11])]]),
    parExpNum: new Map([['10|150', [900]], ['11|164', [901]]]),
    cartesDe: new Map([[900, new Set([1])], [901, new Set([2])]]),
    ...o,
});
const p = (idProduct, slug, extra = {}) => ({ idProduct, slug, ...extra });
t('résolu : BRS 150 → produit 900 → carte 1', () => {
    const r = SP.resoudreProduit(p(5, 'Ultra-Ball-V1-PRBRS-150'), 'PR', ctxDe());
    assert.strictEqual(r.cause, 'resolu'); assert.strictEqual(r.carteId, 1); assert.deepStrictEqual(r.cands, [900]);
});
t('déjà jointe : une ligne existe pour ce produit → « deja » (jamais réécrite)', () => assert.strictEqual(SP.resoudreProduit(p(5, 'Ultra-Ball-V1-PRBRS-150'), 'PR', ctxDe({ cartesDe: new Map([[5, new Set([9])]]) })).cause, 'deja'));
t('code inconnu', () => assert.strictEqual(SP.resoudreProduit(p(5, 'X-PRZZZ-150'), 'PR', ctxDe()).cause, 'codeInconnu'));
t('numéro absent de l\'origine', () => assert.strictEqual(SP.resoudreProduit(p(5, 'X-PRBRS-999'), 'PR', ctxDe()).cause, 'numeroAbsent'));
t('origine sans carte', () => assert.strictEqual(SP.resoudreProduit(p(5, 'X-PRBRS-150'), 'PR', ctxDe({ cartesDe: new Map() })).cause, 'origineSansCarte'));
t('ambigu : l\'origine désigne deux cartes', () => assert.strictEqual(SP.resoudreProduit(p(5, 'X-PRBRS-150'), 'PR', ctxDe({ cartesDe: new Map([[900, new Set([1, 2])]]) })).cause, 'ambigu'));
t('non décodé', () => assert.strictEqual(SP.resoudreProduit(p(5, 'Fire-Energy-PR14'), 'PR', ctxDe()).cause, 'nonDecode'));

// ── classement des 3 ensembles : prouvés / contredits par le nom / restes ──
const impr = (numero) => [{ tirage: 'intl', expansion: 'Brilliant Stars', numero }];
const cartes = new Map([
    [1, { _id: 1, nomEn: 'Ultra Ball', impressions: impr('150/172') }],
    [2, { _id: 2, nomEn: 'Serena', impressions: impr('164/198') }],
    [3, { _id: 3, nomEn: 'Nest Ball', impressions: [] }],
]);
const classer = (produits, o = {}) => SP.classerProduits({
    produits, CODE: 'PR', ctx: o.ctx || ctxDe(), cartesParId: o.cartes || cartes,
    poolDe: o.poolDe || (() => [...(o.cartes || cartes).values()]),
});
const prod = (idProduct, slug, name, extra = {}) => ({ idProduct, slug, name, appris: true, ...extra });

t('un produit dont le nom concorde est PROUVÉ', () => {
    const r = classer([prod(5, 'Ultra-Ball-V1-PRBRS-150', 'Ultra Ball')]);
    assert.strictEqual(r.prouves.length, 1); assert.strictEqual(r.prouves[0].carteId, 1);
});
t('🔴 le témoin du nom : « Serena » désigné pour une carte « Ultra Ball » est CONTREDIT (le nom désigne une autre carte du pool)', () => {
    const r = classer([prod(5, 'Serena-PRBRS-150', 'Serena')]);
    assert.strictEqual(r.prouves.length, 0); assert.strictEqual(r.contredits.length, 1);
    assert.ok(r.contredits[0].autres.some(c => c._id === 2));
});
t('un nom qui ne désigne AUCUNE carte du pool et ne concorde pas : écart de forme → reste, pas prouvé (un doute est un trou)', () => {
    const r = classer([prod(5, 'Zzz-PRBRS-150', 'Zzz Truc')]);
    assert.strictEqual(r.prouves.length, 0); assert.strictEqual(r.contredits.length, 0);
    assert.strictEqual(r.restes[0].cause, 'nom-non-concordant');
});
t('la carte désignée est ajoutée au pool même si le pool ne la contient pas (le témoin ne se tait pas faute de la connaître)', () => {
    const r = classer([prod(5, 'Serena-PRBRS-150', 'Serena')], { poolDe: () => [cartes.get(2)] });
    assert.strictEqual(r.contredits.length, 1);
});
t('une carte sans nomEn ne se prouve pas : reste « carte-sans-nom »', () => {
    const c = new Map([[1, { _id: 1, nomEn: null, impressions: impr('150') }]]);
    const r = classer([prod(5, 'Ultra-Ball-V1-PRBRS-150', 'Ultra Ball')], { cartes: c });
    assert.strictEqual(r.restes[0].cause, 'carte-sans-nom');
});
t('le TIRAGE se prouve par l\'impression : une origine sans impression intl au numéro n\'est pas prouvée', () => {
    const c = new Map([[1, { _id: 1, nomEn: 'Ultra Ball', impressions: [{ tirage: 'jp', expansion: 'X', numero: '150' }] }]]);
    const r = classer([prod(5, 'Ultra-Ball-V1-PRBRS-150', 'Ultra Ball')], { cartes: c });
    assert.strictEqual(r.prouves.length, 0); assert.strictEqual(r.restes[0].cause, 'origine-sans-impression-intl');
});
t('produit non appris (aucune ligne numeros_cartes) : reste « produit-non-appris »', () => {
    const r = classer([prod(6, undefined, 'Pikachu (Top Deck)', { appris: false })]);
    assert.strictEqual(r.restes[0].cause, 'produit-non-appris');
});
t('carte-code : hors dénominateur, ni prouvée ni reste', () => {
    const r = classer([prod(7, 'Live-Code-Card-Worlds-2022-PR', 'Live Code Card (Worlds 2022)')]);
    assert.strictEqual(r.horsDenominateur.length, 1); assert.strictEqual(r.restes.length, 0);
});
t('déjà jointe ailleurs : comptée « deja », ni prouvée ni reste', () => {
    const r = classer([prod(5, 'Geeta-V4-OBF188', 'Geeta')], { ctx: ctxDe({ cartesDe: new Map([[5, new Set([8])]]) }) });
    assert.strictEqual(r.deja.length, 1); assert.strictEqual(r.prouves.length + r.restes.length, 0);
});
t('chaque produit est dans UN ensemble (somme = produits)', () => {
    const r = classer([prod(5, 'Ultra-Ball-V1-PRBRS-150', 'Ultra Ball'), prod(6, 'Serena-PRBRS-150', 'Serena'), prod(8, 'Fire-Energy-PR14', 'Fire Energy'), prod(7, 'Live-Code-Card-X-PR', 'Live Code Card (X)')]);
    assert.strictEqual(r.prouves.length + r.contredits.length + r.restes.length + r.deja.length + r.horsDenominateur.length, 4);
});
t('un reste « nonDecode » dit sa raison lisible', () => {
    const r = classer([prod(8, 'Fire-Energy-PR14', 'Fire Energy')]);
    assert.strictEqual(r.restes[0].cause, 'sans-code-origine'); assert.ok(/code d'origine/.test(r.restes[0].raison));
});

// ── le set partiel et ses restes ──
const classe = () => classer([prod(5, 'Ultra-Ball-V1-PRBRS-150', 'Ultra Ball'), prod(6, 'Serena-PRBRS-150', 'Serena'), prod(8, 'Fire-Energy-PR14', 'Fire Energy'), prod(9, 'Victory-Medal-V1-PR', 'Victory Medal')]);
t('partielDe : compte prouvé / total lisible, total = dénominateur hors cartes-code', () => {
    const P = SP.partielDe(classe());
    assert.strictEqual(P.prouves, 1); assert.strictEqual(P.total, 4); assert.strictEqual(P.restes, 2); assert.strictEqual(P.contredits, 1);
    assert.ok(/1 produit/.test(P.mention) && /4/.test(P.mention));
});
t('docSetPartiel : forme des sets de réimpressions + champ partiel + tirage intl, bulba.expansion nul', () => {
    const d = SP.docSetPartiel({ slug: 'Promos', code: 'PR', exps: [2107], route: 'pr', partiel: SP.partielDe(classe()), le: new Date(0) });
    assert.strictEqual(d._id, 'Promos'); assert.strictEqual(d.tirage, 'intl'); assert.strictEqual(d.region, 'intl'); assert.strictEqual(d.reimpressions, 'pr');
    assert.strictEqual(d.bulba.expansion, null); assert.deepStrictEqual(d.idExpansion, [2107]); assert.strictEqual(d.partiel.prouves, 1);
    assert.strictEqual(d.nomAffichage, undefined);
});
t('restesDe : un document par produit non prouvé (contredit compris), avec sa raison, jamais les prouvés', () => {
    const R = SP.restesDe('Promos', classe(), new Date(0));
    assert.strictEqual(R.length, 3);
    assert.ok(R.every(r => r.set === 'Promos' && r.idProduct && r.type.startsWith('partiel-') && r.detail));
    assert.ok(!R.some(r => r.idProduct === 5));
    assert.ok(R.some(r => r.idProduct === 6 && r.type === 'partiel-fiche-contredite-par-le-nom'));
});
t('lignesDe : même forme que les réimpressions déjà jointes (preuve, route, origine, slug, slugSet) et aucune clé numeroFiche inventée', () => {
    const L = SP.lignesDe({ slugSet: 'Promos', CODE: 'PR', classement: classe(), idExpansion: 2107, le: new Date(0) });
    assert.strictEqual(L.length, 1);
    const l = L[0];
    assert.strictEqual(l._id, '1|5'); assert.strictEqual(l.preuve, 'reimpression+origine+numero'); assert.strictEqual(l.route, 'PR'); assert.strictEqual(l.tirage, 'intl');
    assert.deepStrictEqual(l.origine, { code: 'BRS', numero: '150' }); assert.strictEqual(l.slugSet, 'Promos'); assert.strictEqual(l.idExpansion, 2107);
    assert.ok(/tirage d'origine BRS n°150/.test(l.detail));
    assert.ok(!('visuelSubstitut' in l) && !('images' in l));
});

// ════ S6 (session 3) : la forme « code collé au numéro » (Rainbow-Energy-TR17) et la TABLE FERMÉE d'origines (Pikachu World Collection) ════
t('S6 décodage collé : « Rainbow-Energy-TR17 » sous PR → code TR n°17', () => assert.deepStrictEqual(SP.decoderCollee('Rainbow-Energy-TR17', 'PR'), { code: 'TR', num: '17' }));
t('S6 décodage collé : le code de l\'expansion elle-même (PR14, PR0, PR42) est CIRCULAIRE → null', () => {
    for (const s of ['Fire-Energy-PR14', 'Metal-Energy-V1-PR0', 'Water-Energy-V1-PR42', 'Ancient-Mew-PR11']) assert.strictEqual(SP.decoderCollee(s, 'PR'), null, s);
});
t('S6 décodage collé : un slug sans chiffres final ou à tiret (ASCMEG-131) n\'est pas la forme collée', () => {
    for (const s of ['Victory-Medal-V7-PR', 'Ultra-Ball-V7-ASCMEG-131', null, '']) assert.strictEqual(SP.decoderCollee(s, 'PR'), null, String(s));
});
t('S6 la forme collée est OPT-IN : sans ctx.formeCollee, « Rainbow-Energy-TR17 » reste « nonDecode » (poser-reimpressions.js ne change pas)', () => {
    const ctx = ctxDe({ expsDuCode: new Map([['TR', new Set([20])]]), parExpNum: new Map([['20|17', [950]]]), cartesDe: new Map([[950, new Set([4])]]) });
    assert.strictEqual(SP.resoudreProduit(p(5, 'Rainbow-Energy-TR17'), 'PR', ctx).cause, 'nonDecode');
    const r = SP.resoudreProduit(p(5, 'Rainbow-Energy-TR17'), 'PR', { ...ctx, formeCollee: true });
    assert.strictEqual(r.cause, 'resolu'); assert.strictEqual(r.carteId, 4); assert.strictEqual(r.code, 'TR'); assert.strictEqual(r.num, '17'); assert.strictEqual(r.source, 'slug-collee');
});
t('S6 la forme collée ne résout JAMAIS un code absent de codes_set (un doute est un trou)', () => {
    const ctx = ctxDe({ formeCollee: true });
    assert.strictEqual(SP.resoudreProduit(p(5, 'Rainbow-Energy-TR17'), 'PR', ctx).cause, 'codeInconnu');
});
t('S6 la slug décodable l\'emporte sur la forme collée (source « slug »)', () => {
    const r = SP.resoudreProduit(p(5, 'Ultra-Ball-V1-PRBRS-150'), 'PR', { ...ctxDe(), formeCollee: true });
    assert.strictEqual(r.cause, 'resolu'); assert.strictEqual(r.source, 'slug');
});
t('S6 table fermée : l\'origine (code, numéro) vient de la table pour un produit dont le slug ne dit rien', () => {
    const ctx = ctxDe({ origines: new Map([[5, { code: 'BRS', num: '150', langue: 'Spanish', ligne: 'Wizards 26' }]]) });
    const r = SP.resoudreProduit(p(5, 'Pikachu-V13'), 'PWC', ctx);
    assert.strictEqual(r.cause, 'resolu'); assert.strictEqual(r.carteId, 1); assert.strictEqual(r.source, 'table'); assert.strictEqual(r.langue, 'Spanish');
});
const cartePika = (att) => new Map([[1, { _id: 1, nomEn: 'Pikachu', attaques: att.map(nom => ({ nom })), impressions: impr('150') }]]);
const classerT = (produit, att, langue) => SP.classerProduits({
    produits: [produit], CODE: 'PWC', ctx: ctxDe({ origines: new Map([[produit.idProduct, { code: 'BRS', num: '150', langue, ligne: 'Wizards 26' }]]), verifierAttaques: true }),
    cartesParId: cartePika(att), poolDe: () => [...cartePika(att).values()],
});
t('S6 table : langue occidentale + attaques EXACTEMENT celles du produit → PROUVÉ', () => {
    const r = classerT(prod(5, 'Pikachu-V13', 'Pikachu [Scratch | Thunderbolt]'), ['Scratch', 'Thunderbolt'], 'Spanish');
    assert.strictEqual(r.prouves.length, 1); assert.strictEqual(r.prouves[0].source, 'table');
});
t('S6 table : attaques qui ne sont pas celles du produit → reste « attaques-non-concordantes » (deux témoins indépendants doivent s\'accorder)', () => {
    const r = classerT(prod(5, 'Pikachu-V13', 'Pikachu [Scratch | Thunderbolt]'), ['Gnaw', 'Thunder Jolt'], 'Spanish');
    assert.strictEqual(r.prouves.length, 0); assert.strictEqual(r.restes[0].cause, 'attaques-non-concordantes');
});
t('S6 table : langue hors tirage (Chinese, Korean) → reste « langue-hors-tirage », jamais prouvé', () => {
    for (const l of ['Chinese', 'Korean', 'Japanese', '']) {
        const r = classerT(prod(5, 'Pikachu-V15', 'Pikachu [Scratch | Thunderbolt]'), ['Scratch', 'Thunderbolt'], l);
        assert.strictEqual(r.prouves.length, 0, l); assert.strictEqual(r.restes[0].cause, 'langue-hors-tirage', l);
    }
});
t('S6 table : le titre de la page de la carte cité par la ligne doit être celui de la base (sinon « titre-non-concordant »)', () => {
    const mk = (titreBase) => {
        const c = new Map([[1, { _id: 1, nomEn: 'Pikachu', bulba: { titre: titreBase }, attaques: [{ nom: 'Scratch' }, { nom: 'Thunderbolt' }], impressions: impr('150') }]]);
        return SP.classerProduits({ produits: [prod(5, 'Pikachu-V13', 'Pikachu [Scratch | Thunderbolt]')], CODE: 'PWC', ctx: ctxDe({ origines: new Map([[5, { code: 'BRS', num: '150', langue: 'Spanish', ligne: 'Wizards 26', titre: 'Pikachu (Wizards Promo 26)' }]]), verifierAttaques: true }), cartesParId: c, poolDe: () => [...c.values()] });
    };
    assert.strictEqual(mk('Pikachu (Wizards Promo 26)').prouves.length, 1);
    const r = mk('Pikachu (Wizards Promo 4)');
    assert.strictEqual(r.prouves.length, 0); assert.strictEqual(r.restes[0].cause, 'titre-non-concordant');
    assert.strictEqual(mk(undefined).restes[0].cause, 'titre-non-concordant');
});
t('S6 les langues du tirage intl sont les 7 occidentales de la page', () => assert.deepStrictEqual(SP.LANGUES_INTL, ['English', 'German', 'French', 'Dutch', 'Italian', 'Portuguese', 'Spanish']));
t('S6 lignesDe : une ligne issue de la table dit sa source et sa page dans origine et detail', () => {
    const C = classerT(prod(5, 'Pikachu-V13', 'Pikachu [Scratch | Thunderbolt]'), ['Scratch', 'Thunderbolt'], 'Spanish');
    const L = SP.lignesDe({ slugSet: 'Pikachu-World-Collection', CODE: 'PWC', classement: C, idExpansion: 4392, le: new Date(0) });
    assert.strictEqual(L.length, 1); assert.strictEqual(L[0].origine.source, 'table'); assert.strictEqual(L[0].origine.numero, '150');
    assert.ok(/table fermée/.test(L[0].detail) && /Wizards 26/.test(L[0].detail) && /Spanish/.test(L[0].detail));
    assert.strictEqual(L[0].preuve, 'reimpression+origine+numero');
});
t('S6 lignesDe : une ligne issue du slug garde EXACTEMENT sa forme (origine = { code, numero } seulement)', () => {
    const L = SP.lignesDe({ slugSet: 'Promos', CODE: 'PR', classement: classe(), idExpansion: 2107, le: new Date(0) });
    assert.deepStrictEqual(L[0].origine, { code: 'BRS', numero: '150' });
});

// ── la TABLE FERMÉE PWC : chaque entrée cite sa page et sa ligne, et une langue hors tirage est refusée au chargement ──
const TP = require('./collecte-cartes/table-pwc');
t('S6 table PWC : 7 entrées, toutes en langue occidentale, chacune avec sa ligne de page et la copie Wayback à 14 chiffres', () => {
    assert.strictEqual(TP.TABLE_PWC.length, 7);
    for (const e of TP.TABLE_PWC) { assert.ok(SP.LANGUES_INTL.includes(e.langue), e.langue); assert.ok(/^Wizards \d+$/.test(e.ligne)); assert.ok(/copie Wayback \d{14}/.test(e.page)); assert.strictEqual(e.code, 'WP'); }
    assert.deepStrictEqual(TP.TABLE_PWC.map(e => e.ligne.split(' ')[1]).sort((a, b) => a - b), ['1', '4', '24', '25', '26', '27', '28']);
});
t('S6 table PWC : les deux produits de langue hors tirage (chinois, coréen) sont NOMMÉS dans les exclus, avec leur ligne', () => {
    assert.deepStrictEqual(TP.EXCLUS_PWC.map(e => e.langue).sort(), ['Chinese', 'Korean']);
    for (const e of TP.EXCLUS_PWC) assert.ok(/copie Wayback \d{14}/.test(e.page) && e.ligne);
});
t('S6 verifierTablePwc LÈVE sur une langue hors liste, un idProduct doublé, une page sans copie datée', () => {
    const bonne = TP.TABLE_PWC[0];
    assert.throws(() => TP.verifierTablePwc([{ ...bonne, langue: 'Chinese' }]), /langue/);
    assert.throws(() => TP.verifierTablePwc([bonne, bonne]), /doublon/);
    assert.throws(() => TP.verifierTablePwc([{ ...bonne, page: 'la page dit' }]), /Wayback/);
    assert.strictEqual(TP.verifierTablePwc(TP.TABLE_PWC), true);
});

console.log(`\n${ok} passés, ${ko} en échec`);
process.exit(ko ? 1 : 0);
