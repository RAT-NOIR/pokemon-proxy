'use strict';
// REPLI-REIMPRESSIONS — côté IDENTIFICATION : sur un produit MARQUÉ « partagé » par l'archive (holo/non-holo, tampon non séparé, paire séparée par l'étiquette), l'IMAGE ne départage JAMAIS ses produits
// partagés : ni la chaîne héritée (sa comparaison d'illustrations affirme un des deux : l'affirmation devient une QUESTION entre eux), ni la règle G (affirmation → question), ni le critère A tant que
// le code et le numéro lus ne désignent pas SEUL un produit (deux produits au même numéro et au même code ne sont jamais séparés par eux). Un verdict sûr reste permis quand le code et le numéro
// désignent un produit seul (CRITÈRE-A). L'image ne prouve JAMAIS le Staff ni le Jumbo : une paire dont l'étiquette sépare les produits compte, tant que la lecture du tampon n'existe pas, comme non séparée.
// Pas de base, pas de réseau : données fabriquées, la version est celle du producteur (creerConstructeur) et le fichier est relu par le consommateur.
const H = require('./_harnais');
const { creerConstructeur } = require('../chargeur/version');
const F = require('../chargeur/format');
const etat = require('../chargeur/etat');
const { adapter } = require('../identifier/adaptateur');
const { fournisseurDe } = require('../identifier/jumeaux');
const RG = require('../identifier/regle-g');
const G = require('../../ratmarket/decision-g');
const { lireConfig } = require('../config');

const cfg = lireConfig({});
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const brut = (id, meta, o = {}) => ({ idProduct: id, vignette: { cle: `vignettes/${id}.webp`, w: 200, h: 279 }, grande: null, visuel: 'du-set', mention: null, idMetacard: meta, numero: '7', rarete: 'Rare', total: '100', variante: null, setNom: 'S', lien: null, ...o });
const J = (idProduct, idMetacard, idExpansion, numero, tirage = 'intl') => ({ idProduct, idMetacard, idExpansion, numero, tirage });

// ── la version fabriquée (puis RELUE par le consommateur : ce que l'API charge)
function fabriquer({ marquages = true, jumeaux = true } = {}) {
    const b = creerConstructeur({ marquages });
    const m = (partage) => (marquages ? partage : {});
    // 7001/7002 : holo / non-holo, même carte, même créneau (Prize Pack S1)
    b.entree(brut(7001, 900, m({ partageeHoloNonHolo: true, produitsPartages: [7001, 7002] })));
    b.entree(brut(7002, 900, m({ partageeHoloNonHolo: true, produitsPartages: [7001, 7002] })));
    // 7003 : ordinaire, avec UN jumeau (7004, autre créneau) ; 7005/7006 : paire SÉPARÉE par l'étiquette (normale / staff) ; 7007/7008 : normale / jumbo, séparée
    b.entree(brut(7003, 901)); b.entree(brut(7004, 901));
    b.entree(brut(7005, 902, m({ partageeTamponNonSepare: false, produitsPartages: [7005, 7006], tamponNonRepresente: 'Staff', variante: 'normale' })));
    b.entree(brut(7006, 902, m({ partageeTamponNonSepare: false, produitsPartages: [7005, 7006], tamponNonRepresente: 'Staff', variante: 'staff' })));
    b.entree(brut(7007, 903, m({ partageeTamponNonSepare: false, produitsPartages: [7007, 7008], variante: 'normale' })));
    b.entree(brut(7008, 903, m({ partageeTamponNonSepare: false, produitsPartages: [7007, 7008], variante: 'jumbo' })));
    // 7009/7010 : tampon non séparé (douteux), 7011 : un produit partagé avec 7001/7002 ET ayant un jumeau 7012 + un autre jumeau 7013 (plus de 3 produits)
    b.entree(brut(7009, 904, m({ partageeTamponNonSepare: true, produitsPartages: [7009, 7010], tamponNonRepresente: 'Play! Pokémon' })));
    b.entree(brut(7010, 904, m({ partageeTamponNonSepare: true, produitsPartages: [7009, 7010], tamponNonRepresente: 'Play! Pokémon' })));
    // 7020/7021 : marqués partagés, mais d'AUTRES numéros connus (7021 : « 99 ») — le code et le numéro lus peuvent désigner 7020 seul
    b.entree(brut(7020, 910, m({ partageeTamponNonSepare: true, produitsPartages: [7020, 7021] })));
    b.entree(brut(7021, 910, m({ partageeTamponNonSepare: true, produitsPartages: [7020, 7021] })));
    // 7030/7031 + deux jumeaux (7032, 7033) : quatre produits à montrer
    b.entree(brut(7030, 920, m({ partageeHoloNonHolo: true, produitsPartages: [7030, 7031] }))); b.entree(brut(7031, 920, m({ partageeHoloNonHolo: true, produitsPartages: [7030, 7031] })));
    b.entree(brut(7032, 920)); b.entree(brut(7033, 920));
    if (jumeaux) {
        for (const [a, mc, exp, num] of [[7001, 900, 5204, '7'], [7002, 900, 5204, '7'], [7003, 901, 100, '1'], [7004, 901, 200, '2'], [7005, 902, 300, '7'], [7006, 902, 300, '7'], [7007, 903, 400, '7'], [7008, 903, 400, '7'],
            [7009, 904, 500, '7'], [7010, 904, 500, '7'], [7020, 910, 600, '12'], [7021, 910, 600, '99'], [7030, 920, 700, '7'], [7031, 920, 700, '7']]) b.jumeau(J(a, mc, exp, num));
        b.jumeau(J(7032, 920, 701, '8')); b.jumeau(J(7033, 920, 702, '9'));
    }
    b.lien('Set-A', '1|001', [7001, 7002]);
    return b.finir(new Date('2026-10-17T10:00:00.000Z'));
}
const relue = v => F.deserialiser(F.serialiser(v));

const ligne = (idProduct, code, numero, o = {}) => ({ idProduct, nomCardmarket: 'Carte [Un | Deux]', nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total: '100', setTcgdex: null, langue: 'EN', variante: null, rarete: 'Rare',
    prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://exemple.invalide/${idProduct}.webp`, w: 255, h: 356 }, tirageSource: 'intl', ...o });
const LU = { numero: '7', total: '100', setCode: 'AAA', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false };
function corpsDe(gagnant, { lecture = {}, vivierIds } = {}) {
    const l = { ...LU, ...lecture, vivierIds: vivierIds || [gagnant] };
    return { success: true, scanId: 's', question: null, carte: { idProduct: gagnant, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom: 'Carte', nomBrut: 'Carte', nomConfiance: 'haute', numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: null, langue: null },
        etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' }, candidats: [{ idProduct: gagnant }], classement: [{ idProduct: gagnant, score: 80 }], reverse: { attendue: false, strategie: null }, codeLangue: 1, lectureGarde: l };
}
const tout = [7001, 7002, 7003, 7004, 7005, 7006, 7007, 7008, 7009, 7010, 7020, 7021, 7030, 7031, 7032, 7033];
const produits = new Map(tout.map(i => [i, ligne(i, 'AAA', i === 7021 ? '99' : i === 7004 ? '2' : i === 7032 ? '8' : i === 7033 ? '9' : '7')]));
produits.set(7021, ligne(7021, 'BBB', '99')); produits.set(7020, ligne(7020, 'AAA', '12'));
const jouer = (version, gagnant, o = {}) => muet(() => adapter({ statutHttp: 200, corps: corpsDe(gagnant, o) }, { produits, langueInterface: 'fr', cfg, jumeaux: fournisseurDe(version) }));
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct).sort((a, b) => a - b) : []);

(async () => {
    const v = relue(fabriquer());
    const ancienne = relue(fabriquer({ marquages: false }));
    const sansJum = relue(fabriquer({ jumeaux: false }));

    // ── 1. le fournisseur de jumeaux porte les produits partagés
    const fx = fournisseurDe(v), fa = fournisseurDe(ancienne);
    H.v('1a. 7001 : ses « jumeaux » sont son partenaire de partage (même créneau, donc pas un jumeau de la colonne)', [v.jumeauxDe(7001), fx(7001).conclu, fx(7001).ids], [[], true, [7002]]);
    H.v('1b. 7003 : un vrai jumeau (autre créneau), aucun partage : inchangé', [fx(7003).conclu, fx(7003).ids, fx(7003).partages || []], [true, [7004], []]);
    H.v('1c. 7030 : le partenaire ET les deux jumeaux, triés ; le partenaire est nommé à part', [fx(7030).ids, fx(7030).partages], [[7031, 7032, 7033], [7031]]);
    H.v('1d. une paire SÉPARÉE (false) compte comme non séparée : 7005 ↔ 7006', [fx(7005).ids, fx(7006).ids, fx(7007).ids, fx(7008).ids], [[7006], [7005], [7008], [7007]]);
    H.v('1e. une archive ANCIENNE (sans colonne de marquages) : aucun partage, comportement d\'avant', [fa(7001).conclu, fa(7001).ids, fa(7001).partages || [], ancienne.colonneMarquages], [true, [], [], false]);
    H.v('1f. sans la colonne des jumeaux : le fournisseur ne conclut toujours pas (jamais « aucun partage » comme une conclusion)', fournisseurDe(sansJum)(7001).conclu, false);

    // ── 2. la chaîne affirme un produit marqué : une QUESTION entre les produits partagés, jamais une affirmation
    const r1 = jouer(v, 7001);
    H.v('2a. holo/non-holo : la chaîne affirme 7001 (sa comparaison d\'illustrations) → QUESTION entre 7001 et 7002', [r1.issue, montres(r1)], ['question', [7001, 7002]]);
    const r1b = jouer(v, 7002);
    H.v('2b. … et le partenaire, de même : la question est la même', [r1b.issue, montres(r1b)], ['question', [7001, 7002]]);
    const r0 = jouer(ancienne, 7001);
    H.v('2c. contrôle : avec l\'archive ANCIENNE le produit est affirmé comme avant (le garde-fou vient de la colonne)', [r0.issue, r0.analyse.cartes[0].carte && r0.analyse.cartes[0].carte.idProduct], ['affirmee', 7001]);
    const rs = jouer(v, 7006);
    H.v('2d. STAFF : la chaîne affirme 7006 (la paire est séparée par l\'étiquette) → QUESTION entre 7005 et 7006 : l\'image ne prouve jamais le Staff', [rs.issue, montres(rs)], ['question', [7005, 7006]]);
    const rn = jouer(v, 7005);
    H.v('2e. … ni la version normale : l\'image ne prouve pas non plus qu\'il n\'y a PAS de tampon', [rn.issue, montres(rn)], ['question', [7005, 7006]]);
    const rj = jouer(v, 7008);
    H.v('2f. JUMBO : la chaîne affirme 7008 (jumbo) → QUESTION entre 7007 et 7008 : l\'image ne prouve jamais le Jumbo', [rj.issue, montres(rj)], ['question', [7007, 7008]]);
    const rt = jouer(v, 7009);
    H.v('2g. tampon non séparé (douteux) : QUESTION entre 7009 et 7010', [rt.issue, montres(rt)], ['question', [7009, 7010]]);
    const rj3 = jouer(v, 7030);
    H.v('2h. quatre produits (un partage et deux jumeaux) : jamais une affirmation (une question à trois)', [rj3.issue, montres(rj3).length], ['question', 3]);
    const r3 = jouer(v, 7003, { lecture: { numero: null, setCode: null } });
    H.v('2i. un produit ordinaire avec un jumeau : la question d\'avant, inchangée', [r3.issue, montres(r3)], ['question', [7003, 7004]]);

    // ── 3. le critère A : jamais l'image, mais le code et le numéro lus quand ils désignent UN produit seul
    const lecA = { numero: '7', setCode: 'AAA' };
    const a1 = jouer(v, 7001, { lecture: lecA, vivierIds: [7001, 7002] });
    H.v('3a. deux produits partagés au MÊME numéro et au même code : le code et le numéro lus ne les séparent pas → question', [a1.issue, montres(a1)], ['question', [7001, 7002]]);
    const a2 = jouer(v, 7020, { lecture: { numero: '12', setCode: 'AAA' }, vivierIds: [7020, 7021] });
    H.v('3b. le partenaire a un AUTRE numéro et un autre code (12/AAA contre 99/BBB) : le code et le numéro désignent 7020 seul → verdict sûr permis (critère A)', [a2.issue, a2.analyse.cartes[0].carte && a2.analyse.cartes[0].carte.idProduct, typeof a2.critere], ['affirmee', 7020, 'string']);
    const a3 = jouer(v, 7020, { lecture: { numero: '99', setCode: 'BBB' }, vivierIds: [7020, 7021] });
    H.v('3c. la photo lit 99/BBB alors que la chaîne affirme 7020 : jamais une affirmation de 7020', [a3.issue === 'affirmee' && a3.analyse.cartes[0].carte.idProduct === 7020], [false]);
    const a4 = jouer(v, 7020, { lecture: { numero: null, setCode: null }, vivierIds: [7020, 7021] });
    H.v('3d. ni code ni numéro lus (l\'image seule a parlé) : question entre 7020 et 7021, jamais une affirmation par l\'image', [a4.issue, montres(a4)], ['question', [7020, 7021]]);

    // ── 4. la règle G : jamais une affirmation d'un produit partagé, jamais plus de trois produits
    const ctxG = G.contexte({ groupe: {}, carte: { v1: [1], v2: [2], v3: [3] }, invisibles: {}, produits: { v1: [[7001, 5.0]], v2: [[7001, 5.0], [7002, 5.0]], v3: [[7003, 5.0]] } });
    const lig = (a, b) => ({ top: [[a, 0.9], [b, 0.3]], essai: 0 });
    const mesures = { comparerPaire: () => [0, 0], scoresZones: () => ({ bas: 1, haut: 1, inliers: 99 }) };
    const sansPartage = RG.decisionRegleG({ ligne: lig('v1', 'v3'), nEssais: 1, mesures, contexteG: ctxG });
    H.v('4a. contrôle : G affirme 7001 quand rien ne le dit partagé', [sansPartage && sansPartage.issue, sansPartage && sansPartage.produit], ['affirmee', 7001]);
    const avecPartage = RG.decisionRegleG({ ligne: lig('v1', 'v3'), nEssais: 1, mesures, contexteG: ctxG, partages: id => (id === 7001 ? [7002] : id === 7002 ? [7001] : []) });
    H.v('4b. G affirme 7001 mais 7001 est partagé avec 7002 : une QUESTION entre eux (l\'image ne les départage pas)', [avecPartage.issue, avecPartage.candidats, avecPartage.codeQuestion], ['question', [7001, 7002], 'visuel']);
    const commune = RG.decisionRegleG({ ligne: lig('v2', 'v3'), nEssais: 1, mesures, contexteG: ctxG, partages: id => (id === 7001 ? [7002] : id === 7002 ? [7001] : []) });
    H.v('4c. G donne une réponse commune (même prix) pour 7001 et 7002 : la question du mécanisme existant, les deux produits', [commune.issue, commune.candidats], ['question', [7001, 7002]]);
    const ctxQ = G.contexte({ groupe: {}, carte: { v1: [1], v3: [3] }, invisibles: {}, produits: { v1: [[7001, 5.0], [7005, 9.0]], v3: [[7003, 5.0]] } });
    const elarg = RG.decisionRegleG({ ligne: lig('v1', 'v3'), nEssais: 1, mesures, contexteG: ctxQ, partages: id => (id === 7005 ? [7006] : id === 7006 ? [7005] : []) });
    H.v('4d. G pose une question [7001, 7005] et 7005 a un partenaire (7006) que la question oubliait : il est ajouté (trois candidats)', [elarg.issue, elarg.candidats], ['question', [7001, 7005, 7006]]);
    const trop = RG.decisionRegleG({ ligne: lig('v1', 'v3'), nEssais: 1, mesures, contexteG: ctxQ, partages: id => (id === 7001 ? [7002, 7003] : id === 7005 ? [7006] : []) });
    H.v('4e. quatre produits ou plus : G ne tranche pas (null), la chaîne héritée décide — jamais une question tronquée', trop, null);
    // la version EN PLACE est lue par défaut (comme visuels.js) : sans le paramètre, G voit les partages de l'archive chargée
    etat.installer(v);
    try {
        const enPlace = RG.decisionRegleG({ ligne: lig('v1', 'v3'), nEssais: 1, mesures, contexteG: ctxG });
        H.v('4f. sans paramètre, G lit la version EN PLACE : 7001 est partagé, donc une question', [enPlace.issue, enPlace.candidats], ['question', [7001, 7002]]);
    } finally { etat.vider(); }
    const sansVersion = RG.decisionRegleG({ ligne: lig('v1', 'v3'), nEssais: 1, mesures, contexteG: ctxG });
    H.v('4g. aucune version en place : G décide comme avant', [sansVersion.issue, sansVersion.produit], ['affirmee', 7001]);

    // ── 5. M1 (relecture r1) : le PARTENAIRE d'un produit partagé ne disparaît jamais d'une question
    const b5 = creerConstructeur({ marquages: true });
    const marq = ids => ({ partageeHoloNonHolo: true, produitsPartages: ids });
    b5.entree(brut(100, 950, marq([100, 900]))); b5.entree(brut(900, 950, marq([100, 900])));          // la paire
    for (const id of [2, 3, 4]) b5.entree(brut(id, 950));                                              // trois vrais jumeaux
    b5.entree(brut(200, 960, marq([200, 201, 202, 203]))); for (const i of [201, 202, 203]) b5.entree(brut(i, 960, marq([200, 201, 202, 203])));   // un groupe de QUATRE
    b5.entree(brut(300, 970, marq([300, 301]))); b5.entree(brut(301, 970, marq([300, 301]))); b5.entree(brut(400, 971)); b5.entree(brut(401, 972));
    for (const [id, mc, exp, num] of [[100, 950, 800, '5'], [900, 950, 800, '5'], [2, 950, 801, '6'], [3, 950, 802, '7'], [4, 950, 803, '8'], [200, 960, 810, '5'], [201, 960, 810, '5'], [202, 960, 810, '5'], [203, 960, 810, '5'],
        [300, 970, 820, '5'], [301, 970, 820, '5'], [400, 971, 830, '5'], [401, 972, 840, '5']]) b5.jumeau(J(id, mc, exp, num));
    b5.lien('Set-A', '1|001', [100, 900]);
    const v5 = relue(b5.finir(new Date('2026-10-18T10:00:00.000Z')));
    const prod5 = new Map([100, 900, 2, 3, 4, 200, 201, 202, 203, 300, 301, 400, 401].map(i => [i, ligne(i, 'AAA', [2, 3, 4].includes(i) ? String(i + 4) : '5')]));
    const adapter5 = (corps, version = v5) => muet(() => adapter({ statutHttp: 200, corps }, { produits: prod5, langueInterface: 'fr', cfg, jumeaux: fournisseurDe(version) }));
    const classe = (corps, ids) => ({ ...corps, classement: ids.map((idProduct, k) => ({ idProduct, score: 90 - k })), candidats: ids.map(idProduct => ({ idProduct })) });
    for (const lecture of [{}, { numero: null, setCode: null }]) {
        const m1 = adapter5(classe(corpsDe(100, { lecture, vivierIds: [100, 2, 3, 4, 900] }), [100, 2, 3, 4]));
        H.v(`5a. P=100, partenaire 900, jumeaux 2, 3, 4 classés par la chaîne${lecture.numero === null ? ' (rien de lu)' : ''} : le partenaire est DANS la question (jamais [100, 2, 3])`, [m1.issue, montres(m1).includes(900), montres(m1).includes(100), montres(m1).length], ['question', true, true, 3]);
    }
    const m1b = adapter5(classe(corpsDe(900, { lecture: { numero: null, setCode: null } }), [900, 2, 3, 4]));
    H.v('5b. la chaîne affirme le partenaire 900 : 900 et 100 sont dans la question', [m1b.issue, montres(m1b).includes(900) && montres(m1b).includes(100)], ['question', true]);
    const m4 = adapter5(corpsDe(200, { lecture: { numero: null, setCode: null }, vivierIds: [200] }));
    H.v('5c. P + 3 partenaires (4 produits que l\'image ne sépare pas) : jamais une question tronquée → introuvable impression-indeterminee', [m4.issue, m4.analyse.cartes[0].raison], ['introuvable', 'impression-indeterminee']);
    const amb = ids => ({ ...corpsDe(ids[0]), carte: { ...corpsDe(ids[0]).carte, ambigu: true }, candidats: ids.map(idProduct => ({ idProduct })), classement: ids.map(idProduct => ({ idProduct, score: 80 })) });
    const c1 = adapter5(amb([300, 400]));
    H.v('5d. question de la CHAÎNE [300, 400] : le partenaire 301 de 300 y entre (la vérité peut être 301)', [c1.issue, montres(c1)], ['question', [300, 301, 400]]);
    const c2 = adapter5(amb([300, 400, 401]));
    H.v('5e. question de la chaîne à 3 + un partenaire = 4 : jamais tronquée → introuvable impression-indeterminee', [c2.issue, c2.analyse.cartes[0].raison], ['introuvable', 'impression-indeterminee']);
    const c3 = adapter5(amb([300, 301]));
    H.v('5f. question de la chaîne déjà complète : inchangée', [c3.issue, montres(c3)], ['question', [300, 301]]);
    const c4 = adapter5(amb([400, 401]));
    H.v('5g. question de la chaîne sans produit partagé : inchangée', [c4.issue, montres(c4)], ['question', [400, 401]]);
    const ancienne5 = muet(() => adapter({ statutHttp: 200, corps: amb([300, 400]) }, { produits: prod5, langueInterface: 'fr', cfg, jumeaux: () => ({ conclu: true, ids: [] }) }));
    H.v('5h. un fournisseur sans partages (banc, archive d\'avant) : la question d\'avant, inchangée', [ancienne5.issue, montres(ancienne5)], ['question', [300, 400]]);
    const c5 = adapter5(amb([400, 401, 2, 3]));
    H.v('5j. question de la chaîne à 4 candidats SANS partenaire ajouté : coupée aux 3 premiers comme avant (régression vue sur test-identifier-adaptateur)', [c5.issue, montres(c5).length], ['question', 3]);
    const { idsACharger } = require('../identifier/jumeaux');
    H.v('5i. idsACharger : les partenaires des candidats d\'une question de la chaîne sont chargés', idsACharger(amb([300, 400]), fournisseurDe(v5)), [301]);
    // ── 6. m8 : une question sur des produits PARTAGÉS n'invite pas à comparer l'illustration (elle est la même) : même code (liste fermée), aide propre
    H.v('6a. holo/non-holo : code "visuel" (aucun code fermé ne convient), aide = brillance ou tampon, pas l\'illustration', [r1.question.code, /brillance|tampon/.test(r1.question.aide), /comparez l’illustration/.test(r1.question.aide)], ['visuel', true, false]);
    const enAnglais = muet(() => adapter({ statutHttp: 200, corps: corpsDe(7001) }, { produits, langueInterface: 'en', cfg, jumeaux: fournisseurDe(v) }));
    H.v('6b. en anglais : le même texte d\'aide propre', /shine|stamp/.test(enAnglais.question.aide), true);
    H.v('6c. une question "visuel" SANS produits partagés garde l\'aide d\'avant (comparer l\'illustration)', [c4.question.code, /illustration/.test(c4.question.aide), /brillance/.test(c4.question.aide)], ['visuel', true, false]);
    H.bilan();
})().catch(e => { console.error('❌', e); process.exit(1); });
