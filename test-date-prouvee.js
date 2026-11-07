'use strict';
// Banc pur de collecte-cartes/date-prouvee.js (aucune base, aucun réseau).   node test-date-prouvee.js
const assert = require('assert');
const { dateAPoser, planDesDates, ecartsRegionTirage, datesDansTexte, filtreEcriture, lignePosee, SOURCE_LOT } = require('./collecte-cartes/date-prouvee');
const NOW = new Date('2026-11-07T10:00:00Z');
const src = (code, rang = 'wiki', phrase = 'sortie confirmee par la source', extra = {}) => ({ code, rang, phrase, adresse: 'https://exemple.test/x', site: 'site-' + code, ...extra });
const preuve = (o = {}) => ({ slugSet: 'Premium-Trainer-Box-VSTAR', date: { valeur: '2022-01-14', precision: 'jour', sources: [src('S1'), src('S2')], ...o }, introuvable: null });
const jp = { _id: 'Premium-Trainer-Box-VSTAR', region: 'jp' };
const intl = { _id: '30th-Anniversary-Celebration-Simplified-Chinese', region: 'intl' };
let n = 0;
const cas = (nom, f) => { try { f(); n++; console.log('  ok  ' + nom); } catch (e) { console.error('  ECHEC ' + nom + ' : ' + e.message); process.exitCode = 1; } };
const refus = (r, motif) => { assert.ok(r.refus, 'attendu un refus, reçu ' + JSON.stringify(r)); if (motif) assert.strictEqual(r.refus, motif); };

cas('2 sources wiki, même jour, set jp : dateSortieJa posée au format de la base', () => {
    const r = dateAPoser(jp, preuve(), { maintenant: NOW });
    assert.ok(r.set, JSON.stringify(r));
    assert.strictEqual(r.set.dateSortieJa, 'January 14, 2022');
    assert.strictEqual(r.set.dateSortieEn, undefined);
    assert.strictEqual(r.set.dateSortieSource, SOURCE_LOT);
    assert.strictEqual(SOURCE_LOT, 'chasse-2026-11-07');
    assert.ok(/chasse-2026-11-07/.test(r.set.dateSortieJaSource) && /S1/.test(r.set.dateSortieJaSource));
    assert.deepStrictEqual(r.set.dateSortiePoseeLe, NOW);
});
cas('set intl (même chinois) : dateSortieEn', () => {
    const r = dateAPoser(intl, preuve({ valeur: '2026-09-16' }), { maintenant: NOW });
    assert.strictEqual(r.set.dateSortieEn, 'September 16, 2026');
    assert.strictEqual(r.set.dateSortieJa, undefined);
});
cas('la provenance porte codes et phrases, jamais adresse ni hôte', () => {
    const r = dateAPoser(jp, preuve(), { maintenant: NOW });
    const s = JSON.stringify(r.set);
    assert.ok(!/https?:|exemple\.test|\/\//.test(s), s);
    assert.deepStrictEqual(r.set.dateSortiePreuves.map(p => p.code), ['S1', 'S2']);
    assert.ok(r.set.dateSortiePreuves.every(p => p.phrase && !('adresse' in p)));
});
cas('une phrase qui contient un nom d\'hôte est refusée', () => {
    refus(dateAPoser(jp, preuve({ sources: [src('S1', 'wiki', 'lu sur pokeguardian.com le 14'), src('S2')] })), 'adresse-dans-la-phrase');
});
cas('set déjà daté (En, Ja ou dateSortie) : jamais écrasé', () => {
    for (const champ of ['dateSortieEn', 'dateSortieJa', 'dateSortie']) refus(dateAPoser({ ...jp, [champ]: 'May 1, 2020' }, preuve()), 'deja-datee');
});
cas('une seule source non officielle : refus', () => refus(dateAPoser(jp, preuve({ sources: [src('S1')] })), 'sources-insuffisantes'));
cas('deux fois la même source compte une fois', () => refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S1', 'boutique')] })), 'sources-insuffisantes'));
cas('une officielle seule suffit', () => assert.ok(dateAPoser(jp, preuve({ sources: [src('S1', 'officielle')] })).set));
cas('rang inconnu ne compte pas', () => refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'rumeur')] })), 'sources-insuffisantes'));
cas('divergence : une source donne un autre jour : rien', () => refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', 'x', { valeur: '2022-01-15' })] })), 'divergence'));
cas('divergence déclarée (contre) : rien', () => refus(dateAPoser(jp, preuve({ contre: ['2022-01-15'] })), 'divergence'));
cas('précision mois : dateSortieMois seulement, pas de jour', () => {
    const r = dateAPoser(jp, preuve({ valeur: '2006-03', precision: 'mois' }), { maintenant: NOW });
    assert.deepStrictEqual(Object.keys(r.set).filter(k => /^dateSortie(En|Ja)?$/.test(k)), []);
    assert.strictEqual(r.set.dateSortieMois.iso, '2006-03');
    assert.strictEqual(r.set.dateSortieMois.texte, 'March 2006');
});
cas('précision période : periodeDistribution, aucun dateSortie*', () => {
    const r = dateAPoser(jp, preuve({ valeur: '2002-12', precision: 'periode', fin: '2003-07' }), { maintenant: NOW });
    assert.strictEqual(r.set.periodeDistribution.debutIso, '2002-12');
    assert.strictEqual(r.set.periodeDistribution.debut, 'December 2002');
    assert.strictEqual(r.set.periodeDistribution.fin, 'July 2003');
    assert.strictEqual(r.set.dateSortieJa, undefined);
});
cas('période sans fin prouvée (P-Promos) : refus, rien posé', () => {
    refus(dateAPoser(jp, preuve({ valeur: '2001-07', precision: 'periode', fin: null })), 'periode-non-etablie');
    refus(dateAPoser(jp, preuve({ valeur: '2001-07', precision: 'periode' })), 'periode-non-etablie');
});
cas('période : texte « début - fin » et source du lot', () => {
    const r = dateAPoser(jp, preuve({ valeur: '2002-12', precision: 'periode', fin: '2003-07' }), { maintenant: NOW });
    assert.strictEqual(r.set.periodeDistribution.texte, 'December 2002 - July 2003');
    assert.ok(r.set.periodeDistribution.source.startsWith(SOURCE_LOT));
});
cas('mois déjà écrit / période déjà écrite : refus', () => {
    refus(dateAPoser({ ...jp, dateSortieMois: { iso: '2006-03' } }, preuve({ valeur: '2006-03', precision: 'mois' })), 'deja-datee');
    refus(dateAPoser({ ...jp, periodeDistribution: { debutIso: '2002-12' } }, preuve({ valeur: '2002-12', precision: 'periode' })), 'deja-datee');
});
cas('valeur illisible, jour impossible, précision inconnue, région inconnue, date nulle : refus', () => {
    refus(dateAPoser(jp, preuve({ valeur: '14/01/2022' })), 'valeur-illisible');
    refus(dateAPoser(jp, preuve({ valeur: '2022-02-31' })), 'valeur-illisible');
    refus(dateAPoser(jp, preuve({ precision: 'trimestre' })), 'precision-inconnue');
    refus(dateAPoser({ _id: 'x', region: 'zh' }, preuve()), 'region-inconnue');
    refus(dateAPoser(jp, { slugSet: 'x', date: null }), 'sans-date');
    refus(dateAPoser(null, preuve()), 'set-introuvable');
});
cas('planDesDates : dénominateur = entrées, set absent refusé, comptes cohérents', () => {
    const p = planDesDates([preuve(), preuve({}), { slugSet: 'Inconnu', date: preuve().date }, { slugSet: 'Shadow-Threat', date: { valeur: '2026-06-19', precision: 'jour', sources: [src('S1')] } }], new Map([[jp._id, jp], ['Shadow-Threat', { _id: 'Shadow-Threat', region: 'intl' }]]), { maintenant: NOW });
    assert.strictEqual(p.entrees, 4);
    assert.strictEqual(p.posees.length + p.refus.length, 4);
    assert.strictEqual(p.refus.find(r => r.slugSet === 'Inconnu').refus, 'set-introuvable');
    assert.strictEqual(p.refus.find(r => r.slugSet === 'Shadow-Threat').refus, 'sources-insuffisantes');
    assert.strictEqual(p.posees.length, 1, 'un doublon de slugSet ne se pose qu\'une fois');
    assert.strictEqual(p.refus.find(r => r.refus === 'doublon-dans-le-fichier').slugSet, jp._id);
});
cas('base = témoin sans voix : wiki + base ne suffit pas, avec la raison dite', () => {
    const r = dateAPoser(intl, preuve({ valeur: '2026-09-16', sources: [src('S1', 'base'), src('S2', 'boutique')] }));
    refus(r, 'sources-insuffisantes');
    assert.ok(/base/.test(r.detail) && /sans voix/.test(r.detail), r.detail);
    refus(dateAPoser(jp, preuve({ sources: [src('S1', 'base'), src('S2', 'base'), src('S3', 'wiki')] })), 'sources-insuffisantes');
    assert.ok(dateAPoser(jp, preuve({ sources: [src('S1', 'base'), src('S2', 'wiki'), src('S3', 'boutique')] })).set);
});
cas('une source base n\'est pas écrite en base', () => {
    const r = dateAPoser(jp, preuve({ sources: [src('S1', 'base'), src('S2'), src('S3')] }));
    assert.deepStrictEqual(r.set.dateSortiePreuves.map(p => p.code), ['S2', 'S3']);
});
cas('contre [{code, valeur}] (smL, 2019-05-03) : divergence', () => {
    refus(dateAPoser(jp, preuve({ valeur: '2019-03-15', contre: [{ code: 'S3', valeur: '2019-05-03' }] })), 'divergence');
});
cas('codes neutres seulement : un code qui nomme un site est refusé', () => {
    for (const code of ['S-DB-SEREBII', 'SEREBII', 'BILL', 'RC', 's1', 'S', '']) refus(dateAPoser(jp, preuve({ sources: [src(code), src('S2')] })), 'code-non-neutre');
});
cas('une phrase qui nomme une autre date complète est refusée (EN, FR, DE, ISO)', () => {
    for (const ph of ['sortie le March 27, 2020 puis December 4, 2020', 'réédition le 4 décembre 2020', 'am 14. Januar 2022 und 3. Mai 2022', 'sortie 2022-01-14 et 2022-02-01', 'du 27 March 2020'])
        refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', ph)] })), 'phrase-autre-date');
});
cas('une phrase qui ne nomme que la date posée (toutes écritures) passe', () => {
    for (const ph of ['Friday, January 14, 2022', 'Japanisch: 14. Januar 2022', 'Date de sortie : 14 janvier 2022', 'Release Period: January 14th 2022', 'le 2022-01-14', 'depuis 2022 (annee seule)'])
        assert.ok(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', ph)] })).set, ph);
});
cas('datesDansTexte', () => {
    assert.deepStrictEqual(datesDansTexte('27 mars 2020 / 4 décembre 2020'), ['2020-03-27', '2020-12-04']);
    assert.deepStrictEqual(datesDansTexte('mars 2020'), []);
});
// ── tour 2 : D1 formes de dates, D3 sites distincts, D2 notes, filtre d'écriture
const FORMES = [   // [forme, phrase portant une AUTRE date (4 décembre 2020), même phrase portant la date posée (14 janvier 2022)]
    ['mois abrégé EN', 'sortie Dec 4, 2020', 'sortie Jan 14, 2022'],
    ['janvier abrégé FR', 'sortie le 4 janv. 2021', 'sortie le 14 janv. 2022'],
    ['mois abrégé EN pointé/Sept', 'sortie Sept. 4 2020', 'sortie Jan. 14 2022'],
    ['jour avant mois abrégé FR', 'sortie le 4 déc. 2020', 'sortie le 14 janv. 2022'],
    ['jour avant mois abrégé EN', 'sortie 4 Dec 2020', 'sortie 14 Jan 2022'],
    ['numérique d/m/y', 'sortie le 4/12/2020', 'sortie le 14/01/2022'],
    ['numérique d.m.y', 'sortie le 04.12.2020', 'sortie le 14.01.2022'],
    ['numérique y/m/d', 'sortie 2020/12/04', 'sortie 2022/01/14'],
    ['CJK', 'sortie 2020年12月4日', 'sortie 2022年1月14日'],
    ['« 4th of December 2020 »', 'released on the 4th of December 2020', 'released on the 14th of January 2022']
];
for (const [nom, autre, memeDate] of FORMES) cas('D1 ' + nom + ' : une autre date refuse, la date posée passe', () => {
    refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', autre)] })), 'phrase-autre-date');
    assert.ok(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', memeDate)] })).set, memeDate);
});
cas('D1 numérique ambigu : 04/01/2022 passe pour 2022-01-14 ? non (ni d/m ni m/d) ; 01/14/2022 passe (m/d)', () => {
    refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', 'le 04/01/2022')] })), 'phrase-autre-date');
    assert.ok(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', 'on 01/14/2022')] })).set);
});
cas('D1 numérique à deux lectures : une seule suffit si elle est la date posée', () => {
    assert.ok(dateAPoser(jp, preuve({ valeur: '2022-01-04', sources: [src('S1'), src('S2', 'wiki', 'le 04/01/2022')] })).set);
});
cas('site absent : une source sans site (chaîne non vide) ne vote pas', () => {
    const sans = (code, site) => ({ code, rang: 'wiki', phrase: 'sortie confirmee', ...(site === undefined ? {} : { site }) });
    const r = dateAPoser(jp, preuve({ sources: [sans('S1'), sans('S2')] }));
    refus(r, 'site-absent');
    refus(dateAPoser(jp, preuve({ sources: [sans('S1', ''), sans('S2', null)] })), 'site-absent');
    refus(dateAPoser(jp, preuve({ sources: [sans('S1', 'PG'), sans('S2')] })), 'site-absent');
    refus(dateAPoser(jp, preuve({ sources: [{ ...sans('S1'), rang: 'officielle' }] })), 'site-absent');
    assert.ok(dateAPoser(jp, preuve({ sources: [sans('S1', 'PG'), sans('S2', 'DE'), sans('S3')] })).set, 'deux sites + une sans site : les deux votent');
});
cas('D3 deux codes du même site = une seule source', () => {
    refus(dateAPoser(jp, preuve({ sources: [src('S1', 'wiki', 'a', { site: 'PG' }), src('S2', 'wiki', 'b', { site: 'PG' })] })), 'sources-insuffisantes');
    assert.ok(dateAPoser(jp, preuve({ sources: [src('S1', 'wiki', 'a', { site: 'PG' }), src('S2', 'wiki', 'b', { site: 'DE' })] })).set);
    const r = dateAPoser(jp, preuve({ sources: [src('S1', 'wiki', 'a', { site: 'PG' }), src('S2', 'wiki', 'b', { site: 'PG' }), src('S3', 'wiki', 'c', { site: 'DE' })] }));
    assert.deepStrictEqual(r.set.dateSortiePreuves.map(p => p.code), ['S1', 'S3']);
    assert.ok(!JSON.stringify(r.set).includes('"site"'));
});
cas('D2 sC : la 1re vague est posée, la seconde vague est une note, pas une candidate', () => {
    const p = preuve({ valeur: '2020-03-27', sources: [src('S1', 'wiki', 'It will release on March 27, 2020'), src('S2', 'wiki', 'Date de sortie : 27 mars 2020'), src('S3', 'base', 'Release Period: March 27th 2020')],
        notes: [{ code: 'S4', rang: 'wiki', phrase: 'go on sale Friday, December 4th, 2020 (2e vague)', note: 'seconde vague 2020-12-04' }] });
    const r = dateAPoser(jp, p, { maintenant: NOW });
    assert.strictEqual(r.set.dateSortieJa, 'March 27, 2020');
    const note = r.set.dateSortiePreuves.find(x => x.code === 'S4');
    assert.deepStrictEqual(note, { code: 'S4', rang: 'wiki', phrase: 'go on sale Friday, December 4th, 2020 (2e vague)', note: 'seconde vague 2020-12-04' });
    assert.ok(!/S4/.test(r.set.dateSortieJaSource), 'la note ne vote pas');
    refus(dateAPoser(jp, { ...p, date: { ...p.date, notes: [{ ...p.date.notes[0], code: 'SEREBII' }] } }), 'code-non-neutre');
    refus(dateAPoser(jp, { ...p, date: { ...p.date, notes: [{ ...p.date.notes[0], phrase: 'vu sur pocketmonsters.net' }] } }), 'adresse-dans-la-phrase');
    refus(dateAPoser(jp, { ...p, date: { ...p.date, sources: [src('S1', 'wiki', 'x'), src('S2', 'wiki', 'December 4, 2020')] } }), 'phrase-autre-date');
});
cas('filtreEcriture : champ de date, region, tirage, et rien d\'autre de plus faible', () => {
    const e = { slugSet: 'x', champs: ['dateSortieJa'], region: 'jp', tirage: null };
    const f = filtreEcriture({ dateSortieJa: 'January 14, 2022' }, e);
    assert.strictEqual(f._id, 'x'); assert.strictEqual(f.region, 'jp'); assert.strictEqual(f.tirage, null); assert.strictEqual(f.dateSortieJa, null);
    for (const k of ['dateSortie', 'dateSortieEn']) assert.strictEqual(f[k], null);
    assert.deepStrictEqual(f.dateSortieMois, { $exists: false });
    assert.strictEqual(filtreEcriture({ dateSortieEn: 'x' }, { ...e, champs: ['dateSortieEn'], region: 'intl', tirage: 'zh-hans' }).tirage, 'zh-hans');
    const m = filtreEcriture({ dateSortieMois: {} }, { ...e, champs: ['dateSortieMois'] });
    assert.deepStrictEqual(m.dateSortieMois, { $exists: false });
    const p = filtreEcriture({ periodeDistribution: {} }, { ...e, champs: ['periodeDistribution'] });
    assert.deepStrictEqual(p.periodeDistribution, { $exists: false });
    assert.throws(() => filtreEcriture({ dateSortieEn: 'x' }, e), /champ/);
});
cas('le CLI lit filtreEcriture et ne reconstruit pas le filtre', () => {
    const cli = require('fs').readFileSync(require('path').join(__dirname, 'poser-dates-prouvees.js'), 'utf8');
    assert.ok(/updateOne\(filtre,/.test(cli) && /filtre = filtreEcriture\(d\.set, d\)/.test(cli));
    assert.ok(!/dateSortieEn: null, dateSortieJa: null/.test(cli));
});
cas('ecartsRegionTirage : région ou tirage changés, ou set absent', () => {
    const plan = { posees: [{ slugSet: 'a', region: 'jp', tirage: null }, { slugSet: 'b', region: 'intl', tirage: 'zh-hans' }] };
    assert.deepStrictEqual(ecartsRegionTirage(plan, new Map([['a', { region: 'jp' }], ['b', { region: 'intl', tirage: 'zh-hans' }]])), []);
    assert.strictEqual(ecartsRegionTirage(plan, new Map([['a', { region: 'intl' }], ['b', { region: 'intl', tirage: 'zh-hans' }]])).length, 1);
    assert.strictEqual(ecartsRegionTirage(plan, new Map([['a', { region: 'jp' }], ['b', { region: 'intl', tirage: 'th' }]])).length, 1);
    assert.strictEqual(ecartsRegionTirage(plan, new Map([['a', { region: 'jp' }]])).length, 1);
});
cas('planDesDates porte region et tirage du set', () => {
    const p = planDesDates([preuve()], new Map([[jp._id, { ...jp, tirage: 'jp' }]]));
    assert.strictEqual(p.posees[0].region, 'jp'); assert.strictEqual(p.posees[0].tirage, 'jp');
});
// ── tour 3 : une source OFFICIELLE l'emporte sur une divergence, et la divergence est NOTÉE (décision de l'utilisateur, 2026-11-07)
const off = (code, extra = {}) => src(code, 'officielle', 'sortie confirmee par la source officielle', extra);
cas('D (a) officielle + contre : posée, divergence notée (codes, valeurs)', () => {
    const r = dateAPoser(jp, preuve({ sources: [off('S1')], contre: [{ code: 'S3', valeur: '2022-01-20' }] }), { maintenant: NOW });
    assert.ok(r.set, JSON.stringify(r));
    assert.strictEqual(r.set.dateSortieJa, 'January 14, 2022');
    assert.deepStrictEqual(r.set.dateSortieDivergence, { codes: ['S3'], valeurs: ['2022-01-20'], le: NOW });
});
cas('D (a) contre en simples dates : valeurs notées, codes vides', () => {
    const r = dateAPoser(jp, preuve({ sources: [off('S1')], contre: ['2022-01-20'] }), { maintenant: NOW });
    assert.deepStrictEqual(r.set.dateSortieDivergence, { codes: [], valeurs: ['2022-01-20'], le: NOW });
});
cas('D (b) officielle + autre source wiki divergente : posée, notée, la divergente n\'est pas une preuve écrite', () => {
    const r = dateAPoser(jp, preuve({ sources: [off('S1'), src('S2', 'wiki', 'sortie annoncee', { valeur: '2022-01-20' })] }), { maintenant: NOW });
    assert.ok(r.set, JSON.stringify(r));
    assert.deepStrictEqual(r.set.dateSortieDivergence, { codes: ['S2'], valeurs: ['2022-01-20'], le: NOW });
    assert.deepStrictEqual(r.set.dateSortiePreuves.map(p => p.code), ['S1']);
    assert.ok(!/S2/.test(r.set.dateSortieJaSource));
});
cas('D (b) la divergente peut nommer sa propre date dans sa phrase : elle n\'est pas écrite', () => {
    const r = dateAPoser(jp, preuve({ sources: [off('S1'), src('S2', 'wiki', 'sortie le January 20, 2022', { valeur: '2022-01-20' })] }));
    assert.ok(r.set, JSON.stringify(r));
});
cas('D (b) officielle qui porte la valeur posée + wiki divergente : posée', () => {
    assert.ok(dateAPoser(jp, preuve({ sources: [off('S1', { valeur: '2022-01-14' }), src('S2', 'wiki', 'x', { valeur: '2022-01-20' })] })).set);
});
cas('D (c) deux officielles divergentes : refus divergence', () => {
    refus(dateAPoser(jp, preuve({ sources: [off('S1'), off('S2', { valeur: '2022-01-20' })] })), 'divergence');
    refus(dateAPoser(jp, preuve({ sources: [off('S1', { valeur: '2022-01-14' }), off('S2', { valeur: '2022-01-20' })] })), 'divergence');
    refus(dateAPoser(jp, preuve({ sources: [off('S1')], contre: [{ code: 'S3', rang: 'officielle', valeur: '2022-01-20' }] })), 'divergence');
});
cas('D une officielle qui contredit la valeur posée n\'est jamais écartée par une wiki', () => {
    refus(dateAPoser(jp, preuve({ sources: [off('S1', { valeur: '2022-01-20' }), src('S2'), src('S3')] })), 'divergence');
});
cas('D (d) sans officielle + contre ou source divergente : refus divergence (inchangé)', () => {
    refus(dateAPoser(jp, preuve({ contre: [{ code: 'S3', valeur: '2022-01-20' }] })), 'divergence');
    refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2'), src('S3', 'boutique', 'x', { valeur: '2022-01-20' })] })), 'divergence');
    refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'wiki', 'x', { valeur: '2022-01-20' })], contre: ['2022-01-20'] })), 'divergence');
});
cas('D un témoin « base » n\'est pas une officielle : divergence refusée', () => {
    refus(dateAPoser(jp, preuve({ sources: [src('S1'), src('S2', 'base'), src('S3', 'wiki', 'x', { valeur: '2022-01-20' })] })), 'divergence');
});
cas('D sans divergence : aucun champ dateSortieDivergence', () => {
    assert.strictEqual(dateAPoser(jp, preuve({ sources: [off('S1')] })).set.dateSortieDivergence, undefined);
    assert.strictEqual(dateAPoser(jp, preuve()).set.dateSortieDivergence, undefined);
});
cas('D contre illisible ou à code non neutre : refus (rien d\'inventé en base)', () => {
    refus(dateAPoser(jp, preuve({ sources: [off('S1')], contre: [{ code: 'SEREBII', valeur: '2022-01-20' }] })), 'code-non-neutre');
    refus(dateAPoser(jp, preuve({ sources: [off('S1')], contre: ['pas une date'] })), 'divergence');
    refus(dateAPoser(jp, preuve({ sources: [off('S1')], contre: [{ code: 'S3' }] })), 'divergence');
});
cas('D (e) la divergence notée ne porte ni adresse ni hôte', () => {
    const r = dateAPoser(jp, preuve({ sources: [off('S1'), src('S2', 'wiki', 'x', { valeur: '2022-01-20' })], contre: [{ code: 'S3', valeur: '2022-02-02', adresse: 'https://exemple.test/y' }] }), { maintenant: NOW });
    const s = JSON.stringify(r.set);
    assert.ok(!/https?:|exemple\.test|\/\/|adresse|site-S/.test(s), s);
    assert.deepStrictEqual(r.set.dateSortieDivergence, { codes: ['S2', 'S3'], valeurs: ['2022-01-20', '2022-02-02'], le: NOW });
});
cas('D la divergence suit aussi les précisions mois et période', () => {
    assert.ok(dateAPoser(jp, preuve({ valeur: '2006-03', precision: 'mois', sources: [off('S1')], contre: ['2006-04'] })).set.dateSortieDivergence.valeurs.includes('2006-04'));
    assert.ok(dateAPoser(jp, preuve({ valeur: '2002-12', precision: 'periode', fin: '2003-07', sources: [off('S1')], contre: ['2002-11'] })).set.dateSortieDivergence);
});
cas('D filtreEcriture inchangé avec une divergence (champ de date toujours en tête)', () => {
    const p = planDesDates([preuve({ sources: [off('S1')], contre: ['2022-01-20'] })], new Map([[jp._id, jp]]), { maintenant: NOW });
    assert.strictEqual(p.posees.length, 1);
    assert.deepStrictEqual(p.posees[0].champs, ['dateSortieJa']);
    assert.strictEqual(filtreEcriture(p.posees[0].set, p.posees[0]).dateSortieJa, null);
});
cas('D (f) la ligne de simulation montre la divergence ; le CLI imprime par cette fonction', () => {
    const p = planDesDates([preuve({ sources: [off('S1')], contre: [{ code: 'S3', valeur: '2022-01-20' }] })], new Map([[jp._id, jp]]), { maintenant: NOW });
    const l = lignePosee(p.posees[0]);
    assert.ok(/POSÉ\s+Premium-Trainer-Box-VSTAR/.test(l) && /dateSortieJa/.test(l) && /S1/.test(l), l);
    assert.ok(/divergence/.test(l) && /S3/.test(l) && /2022-01-20/.test(l), l);
    assert.ok(!/https?:|exemple\.test/.test(l), l);
    const sans = lignePosee(planDesDates([preuve()], new Map([[jp._id, jp]]), { maintenant: NOW }).posees[0]);
    assert.ok(!/divergence/.test(sans), sans);
    const cli = require('fs').readFileSync(require('path').join(__dirname, 'poser-dates-prouvees.js'), 'utf8');
    assert.ok(/lignePosee\(d\)/.test(cli) && /\{ planDesDates, lignePosee \}/.test(cli));
});
console.log(`${n} cas passés`);
