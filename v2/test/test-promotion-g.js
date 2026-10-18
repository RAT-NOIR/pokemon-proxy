'use strict';
// Banc MODELE-VISUEL-API (3) — la PROMOTION par la règle G (« règle (b) » de l'issue (2) de la mesure combinée) et la garde (2) sur le produit de G. Module PUR : aucune base, aucun réseau.
// Deux fonctions : `evaluerGarde` (GC.contredire sur le produit que G désigne, avec la lecture de la chaîne) et `arbitrerAvecPromotion` (l'arbitrage PRUDENT d'arbitrage-g.js, inchangé pour une chaîne qui affirme,
// plus la promotion quand la chaîne pose une question ou rend un introuvable et que G affirme). Écrit par ce qu'il AUTORISE : une promotion exige une garde qui a pu JUGER et n'a rien contredit.
// Les lignes de catalogue sont FABRIQUÉES (même forme que test-garde-contradiction.js) ; aucun identifiant réel d'utilisateur.
const H = require('./_harnais');
const { arbitrer } = require('../identifier/arbitrage-g');
const P = require('../identifier/promotion-g');

const HOTE = 'https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/';
const ligne = (idProduct, nomCardmarket, code, numero, total, setTcgdex, extra = {}) => ({ idProduct, nomCardmarket, nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total, setTcgdex, langue: 'EN', variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `${HOTE}${idProduct}.webp`, w: 255, h: 356 }, ...extra });
const mapDe = ls => new Map(ls.map(l => [l.idProduct, l]));
const corpsDe = ({ gagnant, lecture = {}, vivierIds = [], success = true, ambigu = true, candidats = [gagnant] } = {}) => {
    const l = { numero: '12', total: '100', setCode: 'AAA', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false, vivierIds, ...lecture };
    if (!success) return { success: false, natureRefus: 'refus-delibere', motifRefus: 'aucun-prix' };
    return { success: true, carte: { idProduct: gagnant, ambigu, nom: 'Carte', nomBrut: 'Carte', nomConfiance: 'haute', numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: null, langue: null },
        candidats: candidats.map(idProduct => ({ idProduct })), classement: [], lectureGarde: l };
};
const W = ligne(1001, 'Carte [Un | Deux]', 'AAA', '12', '100', 'set1', { tirageSource: 'intl' });      // concorde avec la lecture par défaut (12, /100, AAA)
const Y = ligne(1002, 'Carte [Un | Deux]', 'BBB', '12', '150', 'set1', { tirageSource: 'intl' });      // contredit : autre total, autre code
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };

// ── evaluerGarde : jugeable / contredit / concordante
{
    const ok = muet(() => P.evaluerGarde({ corps: corpsDe({ gagnant: 1001, vivierIds: [1001, 1002] }), gagnant: 1001, produits: mapDe([W, Y]) }));
    H.v('1a. le produit de G concorde avec la lecture (numéro, total, code) : jugeable, non contredit, concordante', [ok.jugeable, ok.contredit, ok.concordante], [true, false, true]);
    const ko = muet(() => P.evaluerGarde({ corps: corpsDe({ gagnant: 1002, vivierIds: [1001, 1002] }), gagnant: 1002, produits: mapDe([W, Y]) }));
    H.vrai('1b. le produit de G contredit la lecture (total /150 face à lu 100, code BBB face à AAA) : jugeable, contredit, jamais concordante, le résumé est rendu', ko.jugeable && ko.contredit === true && ko.concordante === false && typeof ko.resume === 'string' && /total/.test(ko.resume));
    const sansLecture = P.evaluerGarde({ corps: corpsDe({ gagnant: 1001, success: false }), gagnant: 1001, produits: mapDe([W]) });
    H.v('1c. un corps de refus (pas de lecture, p. ex. un introuvable de la chaîne) : la garde ne peut PAS juger', [sansLecture.jugeable, sansLecture.contredit, sansLecture.concordante], [false, null, false]);
    const absent = P.evaluerGarde({ corps: corpsDe({ gagnant: 1001 }), gagnant: 1001, produits: mapDe([Y]) });
    H.v('1d. le produit de G absent du catalogue de l\'API : non jugeable', [absent.jugeable, absent.concordante], [false, false]);
    const vide = muet(() => P.evaluerGarde({ corps: corpsDe({ gagnant: 1001, lecture: { numero: null, total: null, setCode: null } }), gagnant: 1001, produits: mapDe([W]) }));
    H.v('1e. une lecture qui ne dit RIEN d\'exploitable (aucun champ ne concorde) : jugeable, non contredit, mais PAS concordante (« rien ne contredit » n\'est pas « quelque chose concorde »)', [vide.jugeable, vide.contredit, vide.concordante], [true, false, false]);
    const nul = P.evaluerGarde({ corps: null, gagnant: 1001, produits: mapDe([W]) });
    H.v('1f. corps nul ou produits qui ne sont pas une Map : non jugeable, sans exception', [nul.jugeable, P.evaluerGarde({ corps: corpsDe({ gagnant: 1001 }), gagnant: 1001, produits: {} }).jugeable], [false, false]);
    const leve = P.evaluerGarde({ corps: { success: true, carte: {}, get lectureGarde() { throw new Error('x'); } }, gagnant: 1001, produits: mapDe([W]) });
    H.v('1g. une exception dans la garde : non jugeable (elle se tait), jamais propagée', [leve.jugeable, leve.concordante], [false, false]);
}

// ── arbitrerAvecPromotion : la chaîne AFFIRME => l'arbitrage prudent d'arbitrage-g.js, sans la moindre différence
{
    const A = 100, B = 200, C = 300;
    const g = [{ issue: 'affirmee', produit: A }, { issue: 'affirmee', produit: B }, { issue: 'question', candidats: [B, C] }];
    let tous = true;
    for (const x of g) { const a = arbitrer({ issue: 'affirmee', ids: [A] }, x), b = P.arbitrerAvecPromotion({ issue: 'affirmee', ids: [A] }, x, {}); if (JSON.stringify({ action: b.action, ids: b.ids, desaccord: b.desaccord }) !== JSON.stringify({ action: a.action, ids: a.ids, desaccord: a.desaccord }) || b.promotion !== false) tous = false; }
    H.vrai('2. chaîne qui AFFIRME : accord, produit différent, doute de G — l\'arbitrage est celui d\'arbitrage-g.js (action, ids, désaccord), promotion jamais', tous);
}
// ── chaîne QUESTION ou INTROUVABLE, G affirme Q : la promotion
{
    const Q = 555, okG = { jugeable: true, contredit: false, concordante: true, resume: null };
    const g = { issue: 'affirmee', produit: Q };
    const dsc = (chaine, produitsChaine, retenue) => ({ chaine, regleG: 'affirmee', retenue, produitsChaine, produitsRegleG: [Q] });
    const a = P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, g, { garde: okG });
    H.v('3a. question de la chaîne [1, 2], G affirme 555 (hors des choix), garde ok : promotion de 555', [a.action, a.ids, a.promotion, a.desaccord, a.concordante], ['promouvoir', [Q], true, dsc('question', [1, 2], 'promotion'), true]);
    const b = P.arbitrerAvecPromotion({ issue: 'question', ids: [Q, 2] }, g, { garde: okG });
    H.v('3b. … le produit de G est DANS les choix de la chaîne : promu aussi (19 des 44 promotions de la mesure)', [b.action, b.ids], ['promouvoir', [Q]]);
    const c = P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, g, { garde: { jugeable: true, contredit: false, concordante: false, resume: null } });
    H.v('3c. garde jugeable, rien ne contredit, mais aucun champ ne concorde : promu (comme la mesure), `concordante` faux — rien de partagé ne s\'écrira', [c.action, c.concordante], ['promouvoir', false]);
    const d = P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, g, { garde: { jugeable: true, contredit: true, concordante: false, resume: 'contredit par numero' } });
    H.v('3d. la garde (2) CONTREDIT le produit de G : la question de la chaîne reste, désaccord « garde-contradiction »', [d.action, d.promotion, d.desaccord], ['garder', false, dsc('question', [1, 2], 'garde-contradiction')]);
    const e = P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, g, { garde: { jugeable: false, contredit: null, concordante: false, resume: null } });
    H.v('3e. la garde n\'a pas pu JUGER (écrit par ce qu\'on autorise : une garde muette n\'autorise rien) : la question reste, désaccord « garde-muette »', [e.action, e.desaccord], ['garder', dsc('question', [1, 2], 'garde-muette')]);
    H.v('3f. aucune garde fournie : la question reste (échec fermé)', P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, g, {}).action, 'garder');
    H.v('3g. garde mal formée (pas un objet) : la question reste', [P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, g, { garde: 'ok' }).action, P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, g, { garde: { jugeable: 'oui', contredit: false } }).action], ['garder', 'garder']);
    const f = P.arbitrerAvecPromotion({ issue: 'introuvable', ids: [] }, g, { garde: okG });
    H.v('4a. chaîne INTROUVABLE (crédit déjà rendu par la chaîne) : par défaut on n\'affirme pas — désaccord « introuvable » (celui d\'arbitrage-g.js)', [f.action, f.desaccord], ['garder', dsc('introuvable', [], 'introuvable')]);
    const h = P.arbitrerAvecPromotion({ issue: 'introuvable', ids: [] }, g, { garde: okG, depuisIntrouvable: true });
    H.v('4b. … `depuisIntrouvable: true` (la mesure : 2 des 44 promotions) : promu quand la garde a jugé', [h.action, h.ids], ['promouvoir', [Q]]);
    H.v('4c. … introuvable, garde muette ou contredit, même avec l\'autorisation : jamais promu', [P.arbitrerAvecPromotion({ issue: 'introuvable', ids: [] }, g, { garde: { jugeable: false, contredit: null, concordante: false }, depuisIntrouvable: true }).action, P.arbitrerAvecPromotion({ issue: 'introuvable', ids: [] }, g, { garde: { jugeable: true, contredit: true, concordante: false }, depuisIntrouvable: true }).action], ['garder', 'garder']);
    // G pose une question : la chaîne (question ou introuvable) garde la sienne — c'est l'arbitrage existant
    const gq = { issue: 'question', candidats: [7, 8] };
    for (const ch of [{ issue: 'question', ids: [1, 2] }, { issue: 'introuvable', ids: [] }]) {
        const r = P.arbitrerAvecPromotion(ch, gq, { garde: okG, depuisIntrouvable: true }), ref = arbitrer(ch, gq);
        H.vrai(`5. chaîne ${ch.issue}, G pose une question : l\'arbitrage existant, inchangé (jamais une promotion)`, r.action === ref.action && JSON.stringify(r.desaccord) === JSON.stringify(ref.desaccord) && r.promotion === false);
    }
    H.v('6a. G « affirme » sans produit entier : jamais promu', [P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, { issue: 'affirmee', produit: '555' }, { garde: okG }).action, P.arbitrerAvecPromotion({ issue: 'question', ids: [1, 2] }, { issue: 'affirmee' }, { garde: okG }).action], ['garder', 'garder']);
    H.v('6b. une issue de chaîne inconnue : l\'arbitrage existant (garder, désaccord « introuvable »), jamais une promotion', P.arbitrerAvecPromotion({ issue: 'autre', ids: [] }, g, { garde: okG, depuisIntrouvable: true }).action, 'garder');
    H.v('6c. une seule fonction de promotion : la liste fermée des actions est garder, question, promouvoir', P.ACTIONS, ['garder', 'question', 'promouvoir']);
}
H.bilan();
