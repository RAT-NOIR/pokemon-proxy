'use strict';
// Banc UN-CANDIDAT (décision D1 du testeur, 2026-10-13) — « ce qui n'est pas affirmé devient une question, même à un seul candidat ».
// Module PUR : l'adaptateur, la question de confirmation, les chargeurs de jumeaux. L'argent est dans test-un-candidat-route.js.
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');
const { construireQuestion, verifierBijection, CODES_QUESTION } = require('../identifier/questions');
const { construireProduit } = require('../identifier/produit');
const { choixPour } = require('../choix');
const J = require('../identifier/jumeaux');

const cfg = lireConfig({});
const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
const ligne = (id, o = {}) => ({ idProduct: id, nomCardmarket: 'Eevee', set: { slug: 's' + id, nom: 'Set ' + id }, numero: '12', total: '100', langue: 'EN', variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `${HOTE}${id}.webp`, w: 255, h: 356 }, ...o });
const produits = new Map([700, 701, 702, 703, 704].map(i => [i, ligne(i)]));
const sansJumeau = () => ({ conclu: true, ids: [] });
const ctx = (o = {}) => ({ produits, langueInterface: 'fr', cfg, jumeaux: sansJumeau, ...o });
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'GD' };
const amb = (ids, o = {}) => ({ success: true, scanId: 's1', question: null, carte: { idProduct: ids[0], ambigu: true, niveauReserve: 'forte', raisonReserve: 'x', concurrent: null, nbExAequo: 1 },
    etat: etatH, candidats: ids.map(i => ({ idProduct: i })), classement: ids.map(i => ({ idProduct: i, score: 1 })), reverse: { attendue: false, strategie: null }, codeLangue: 2, ...o });
const refus = (motif, o = {}) => ({ success: false, rembourse: true, raisonNonRembourse: null, motifRefus: motif, natureRefus: 'refus-delibere', phraseRefus: 'x', ...o });
const A = (corps, c = ctx()) => adapter({ statutHttp: 200, corps }, c);
const aveuglerLog = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const AS = (corps, c) => aveuglerLog(() => A(corps, c));
const carte0 = r => r.analyse && r.analyse.cartes[0];

// (1) Un candidat sans jumeau : une question « est-ce cette carte ? » à UN choix
{
    const r = A(amb([700])), c = carte0(r);
    v('1 candidat sans jumeau : issue question', [r.issue, c.statut, c.raison], ['question', 'a-trancher', null]);
    v('   un candidat (le produit) et un choix a qui le désigne', [c.candidats.map(x => x.idProduct), c.question.choix], [[700], [{ id: 'a', libelle: 'Oui, c’est cette carte', idProduct: 700 }]]);
    v('   code « confirmation », zone null, prixLive null, carte null', [c.question.code, c.question.zone, c.prixLive, c.carte], ['confirmation', null, null, null]);
    vrai('   bijection (un choix = un candidat)', verifierBijection(c.question, c.candidats));
    vrai('   la question de la réponse est celle de la carte', r.question === c.question);
    vrai('   aucune phrase ne parle de prix ni de classement', !/prix|€|classement|score/i.test(JSON.stringify(c.question)));
    const en = carte0(A(amb([700]), ctx({ langueInterface: 'en' })));
    v('   en anglais : libellé du choix', en.question.choix[0].libelle, 'Yes, this is the card');
}
// (2) un candidat avec jumeaux : la question de départage à 2 ou 3 (le mécanisme existant)
{
    const r2 = A(amb([700]), ctx({ jumeaux: id => ({ conclu: true, ids: id === 700 ? [702] : [] }) })), c2 = carte0(r2);
    v('1 candidat + 1 jumeau : question à 2 (700, 702), pas une confirmation', [r2.issue, c2.candidats.map(x => x.idProduct), c2.question.code !== 'confirmation'], ['question', [700, 702], true]);
    const r3 = A(amb([700]), ctx({ jumeaux: id => ({ conclu: true, ids: id === 700 ? [701, 703] : [] }) })), c3 = carte0(r3);
    v('1 candidat + 2 jumeaux : question à 3', [r3.issue, c3.candidats.map(x => x.idProduct)], ['question', [700, 701, 703]]);
    const r4 = AS(amb([700]), ctx({ jumeaux: id => ({ conclu: true, ids: id === 700 ? [701, 702, 703] : [] }) }));
    // JUMEAUX-QUESTION (2026-10-17) : plus de 3 produits n'est plus un introuvable : une question à 3 (P d'abord, puis l'ordre nommé de jumeaux-nombreux.js)
    v('1 candidat + 3 jumeaux (4 produits) : une QUESTION à 3 (700 d\'abord, puis 701, 702 par idProduct), plus l\'introuvable d\'avant', [r4.issue, carte0(r4).statut, carte0(r4).candidats.map(x => x.idProduct)], ['question', 'a-trancher', [700, 701, 702]]);
}
// (3) la garde en panne : une PANNE, jamais une question ni une affirmation
{
    const cas = [
        ['aucun fournisseur', ctx({ jumeaux: undefined })],
        ['fournisseur qui ne conclut pas', ctx({ jumeaux: () => ({ conclu: false, ids: [], motif: 'jumeaux-perimes' }) })],
        ['fournisseur qui lève', ctx({ jumeaux: () => { throw new Error('x'); } })],
        ['forme inconnue', ctx({ jumeaux: () => 'oui' })],
        ['jumeau sans ligne au catalogue', ctx({ jumeaux: id => ({ conclu: true, ids: id === 700 ? [999999] : [] }) })]
    ];
    for (const [nom, c] of cas) { const r = AS(amb([700]), c); v(`garde en panne (${nom}) : panne INDISPONIBLE, aucune carte`, [r.issue, r.erreur && r.erreur.code, r.analyse], ['panne', 'INDISPONIBLE', null]); }
    const r = AS(amb([700]), ctx({ jumeaux: () => ({ conclu: false, ids: [], motif: 'jumeaux-perimes' }) }));
    v('   le motif interne de la panne est servi à la racine, pas dans le contrat', r.motif, 'jumeaux-perimes');
}
// (4) 0 candidat, produit inconnu, sans-repli
{
    v('0 candidat (ambigu) : introuvable photo-illisible', [A(amb([])).issue, carte0(A(amb([]))).raison], ['introuvable', 'photo-illisible']);
    v('un seul candidat DISTINCT (doublon) : une question à un choix', [A(amb([700, 700])).issue, carte0(A(amb([700, 700]))).candidats.length], ['question', 1]);
    const r = AS(amb([999999]));
    v('1 candidat absent de ctx.produits : panne SERVEUR (on n\'invente pas)', [r.issue, r.erreur && r.erreur.code], ['panne', 'SERVEUR']);
    v('2 candidats : inchangé (question de départage)', [A(amb([700, 701])).issue, carte0(A(amb([700, 701]))).question.code !== 'confirmation'], ['question', true]);
    v('4 candidats : inchangé (les 3 premiers)', carte0(A(amb([704, 703, 702, 701]))).candidats.length, 3);
}
// (5) l'égalité dont l'union ne compte qu'UN candidat (l. 117-119)
{
    const e1 = r => [r.issue, carte0(r).statut, carte0(r).raison, carte0(r).candidats.map(x => x.idProduct), carte0(r).question && carte0(r).question.code];
    v('egalite-parfaite à 1 candidat : question de confirmation', e1(A(refus('egalite-parfaite', { candidats: [{ idProduct: 700 }] }))), ['question', 'a-trancher', null, [700], 'confirmation']);
    v('nom-contredit-egalite, union de 1 (corps + ctx) : question de confirmation', e1(A(refus('nom-contredit-egalite', { candidats: [{ idProduct: 700 }] }), ctx({ candidatsDeRefus: [{ idProduct: 700 }] }))), ['question', 'a-trancher', null, [700], 'confirmation']);
    v('egalite-parfaite : candidats du ctx seuls, un seul : question de confirmation', e1(A(refus('egalite-parfaite'), ctx({ candidatsDeRefus: [{ idProduct: 701 }] }))), ['question', 'a-trancher', null, [701], 'confirmation']);
    v('egalite-parfaite à 1 candidat AVEC jumeau : question de départage à 2', carte0(A(refus('egalite-parfaite', { candidats: [{ idProduct: 700 }] }), ctx({ jumeaux: id => ({ conclu: true, ids: id === 700 ? [702] : [] }) }))).candidats.map(x => x.idProduct), [700, 702]);
    const t = AS(refus('egalite-parfaite', { candidats: [{ idProduct: 700 }] }), ctx({ jumeaux: undefined }));
    v('egalite-parfaite à 1 candidat, garde en panne : panne INDISPONIBLE', [t.issue, t.erreur && t.erreur.code], ['panne', 'INDISPONIBLE']);
    // EXCEPTION : sans-repli — le nom CONTREDIT les candidats, jamais une question, même à un candidat
    v('nom-contredit-sans-repli (corps à 1 candidat) : introuvable photo-illisible', [A(refus('nom-contredit-sans-repli', { candidats: [{ idProduct: 700 }] })).issue, carte0(A(refus('nom-contredit-sans-repli', { candidats: [{ idProduct: 700 }] }))).raison], ['introuvable', 'photo-illisible']);
    v('nom-contredit-sans-repli (ctx à 1 candidat) : introuvable photo-illisible', carte0(A(refus('nom-contredit-sans-repli'), ctx({ candidatsDeRefus: [{ idProduct: 700 }] }))).raison, 'photo-illisible');
    // inchangés
    v('egalite-parfaite sans aucun candidat : introuvable hors-catalogue', carte0(A(refus('egalite-parfaite'))).raison, 'hors-catalogue');
    v('nom-contredit-egalite sans candidat : introuvable photo-illisible', carte0(A(refus('nom-contredit-egalite'))).raison, 'photo-illisible');
    v('egalite-parfaite à 4 candidats : introuvable photo-illisible', carte0(A(refus('egalite-parfaite'), ctx({ candidatsDeRefus: [700, 701, 702, 703].map(idProduct => ({ idProduct })) }))).raison, 'photo-illisible');
}
// (6) la question elle-même et choixPour
{
    const p = construireProduit(ligne(700), { langueInterface: 'fr' });
    const q = construireQuestion([p], { langueInterface: 'fr' });
    v('construireQuestion([p]) : code, 1 choix, id a', [q.code, q.choix.length, q.choix[0].id, q.choix[0].idProduct], ['confirmation', 1, 'a', 700]);
    v('liste fermée des codes (confirmation ajoutée à la fin)', [...CODES_QUESTION], ['reverse', 'symbole', 'numero', 'langue', 'premiere-edition', 'visuel', 'confirmation']);
    const leve = f => { try { f(); return false; } catch { return true; } };
    v('0 candidat et 4 candidats lèvent toujours', [leve(() => construireQuestion([], {})), leve(() => construireQuestion([700, 701, 702, 703].map(i => construireProduit(ligne(i), { langueInterface: 'fr' })), {}))], [true, true]);
    v('choixPour([700]) : un choix a', choixPour([700]), [{ id: 'a', idProduct: 700 }]);
    v('choixPour([]) et choixPour de 4 lèvent toujours', [leve(() => choixPour([])), leve(() => choixPour([1, 2, 3, 4]))], [true, true]);
    v('choixPour([700, 700]) lève (doublon)', leve(() => choixPour([700, 700])), true);
}
// (7) les chargeurs de jumeaux couvrent le candidat unique (sinon la garde répondrait « incomplets » à tort)
{
    const four = id => ({ conclu: true, ids: id === 700 ? [701, 702] : [] });
    v('idsAffirmes : ambigu à 1 candidat -> [700]', J.idsAffirmes(amb([700])), [700]);
    v('idsAffirmes : ambigu à 2 candidats -> []', J.idsAffirmes(amb([700, 701])), []);
    v('idsAffirmes : egalite-parfaite à 1 candidat -> [700]', J.idsAffirmes(refus('egalite-parfaite', { candidats: [{ idProduct: 700 }] })), [700]);
    v('idsAffirmes : nom-contredit-sans-repli à 1 candidat -> []', J.idsAffirmes(refus('nom-contredit-sans-repli', { candidats: [{ idProduct: 700 }] })), []);
    v('idsAffirmes : egalite-parfaite à 2 candidats -> []', J.idsAffirmes(refus('egalite-parfaite', { candidats: [{ idProduct: 700 }, { idProduct: 701 }] })), []);
    v('idsACharger : ambigu à 1 candidat -> ses jumeaux (<= 2)', J.idsACharger(amb([700]), four), [701, 702]);
    v('idsACharger : egalite-parfaite à 1 candidat -> ses jumeaux', J.idsACharger(refus('egalite-parfaite', { candidats: [{ idProduct: 700 }] }), four), [701, 702]);
    v('idsACharger : ambigu à 2 candidats -> rien', J.idsACharger(amb([700, 701]), four), []);
    v('idsACharger : sans-repli -> rien', J.idsACharger(refus('nom-contredit-sans-repli', { candidats: [{ idProduct: 700 }] }), four), []);
    v('idsACharger : affirmation (inchangé)', J.idsACharger({ success: true, carte: { idProduct: 700, ambigu: false } }, four), [701, 702]);
    v('idsAffirmes : affirmation (inchangé)', J.idsAffirmes({ success: true, carte: { idProduct: 700, ambigu: false } }), [700]);
}
bilan();
