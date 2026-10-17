'use strict';
// Lot CRITERE-A (2026-10-17, décision D2 rouverte par le testeur) — affirmer le jumeau que le code ET le numéro imprimés désignent seuls, APRÈS la garde contradiction.
// « les réimpressions japonaises (Tag All Stars, Dream League…) portent un autre numéro et un autre code ; c'est le code et le numéro imprimés qui tranchent, jamais le nom seul » (testeur).
// Module PUR + adaptateur : données FABRIQUÉES (aucun identifiant réel, aucun dossier du testeur, aucune base, aucun réseau).
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');
const CA = require('../identifier/critere-a');

const cfg = lireConfig({});
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const ligne = (idProduct, nomCardmarket, code, numero, total, extra = {}) => ({ idProduct, nomCardmarket, nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total, setTcgdex: null, langue: 'EN', variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://exemple.invalide/${idProduct}.webp`, w: 255, h: 356 }, tirageSource: 'intl', ...extra });
const LU = { numero: '12', total: '100', setCode: 'AAA', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false };
function corpsDe({ gagnant, lecture = {}, vivierIds, nom = 'Carte', nomConfiance = 'haute', ambigu = false, candidats } = {}) {
    const l = { ...LU, ...lecture, vivierIds: vivierIds || [gagnant] };
    return { success: true, scanId: 's', question: null,
        carte: { idProduct: gagnant, ambigu, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom, nomBrut: nom, nomConfiance, numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: l.carteTcgdexId, langue: l.langue },
        etat: etatH, candidats: (candidats || [gagnant]).map(idProduct => ({ idProduct })), classement: (candidats || [gagnant]).map(idProduct => ({ idProduct, score: 80 })), reverse: { attendue: false, strategie: null }, codeLangue: 1, lectureGarde: l };
}
// le fournisseur de jumeaux : chaque produit du groupe a pour jumeaux tous les autres
const groupe = ids => id => ({ conclu: true, ids: ids.includes(id) ? ids.filter(i => i !== id) : [] });
const jouer = (corps, lignes, ids, extra = {}) => muet(() => adapter({ statutHttp: 200, corps }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: groupe(ids), critereA: true, ...extra }));
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct) : []);

const P = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100');
const J = ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100');          // le jumeau : un AUTRE créneau (autre code, autre numéro), même carte
const IDS = [4001, 4002];

// ── (1) le cas qui passe : le code ET le numéro lus concordent avec P et avec lui seul
{
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: IDS }), [P, J], IDS);
    v('(1) numéro et code lus = ceux de P, le jumeau a un autre numéro : P est AFFIRMÉ', [r.issue, r.analyse.cartes[0].carte && r.analyse.cartes[0].carte.idProduct], ['affirmee', 4001]);
    vrai('(1)     le résultat dit pourquoi (critère A, côté serveur)', typeof r.critere === 'string' && /numéro/.test(r.critere) && /code/.test(r.critere));
    const off = jouer(corpsDe({ gagnant: 4001, vivierIds: IDS }), [P, J], IDS, { critereA: undefined });
    v('(1)     le DRAPEAU par défaut : la question de départage d\'avant (ctx.critereA absent => la constante CRITERE_A)', [off.issue, montres(off), CA.CRITERE_A], CA.CRITERE_A ? ['affirmee', [], true] : ['question', [4001, 4002], false]);
    const eteint = jouer(corpsDe({ gagnant: 4001, vivierIds: IDS }), [P, J], IDS, { critereA: false });
    v('(1)     ctx.critereA = false : la question d\'avant, inchangée', [eteint.issue, montres(eteint)], ['question', [4001, 4002]]);
}
// ── (2) le jumeau réimpression japonaise (Tag All Stars contre l'original : autre numéro, autre code) : le code et le numéro tranchent
{
    const ORI = ligne(4101, 'Carte GX [Un | Deux]', 'SM', '12', '100');
    const TAS = ligne(4102, 'Carte GX [Un | Deux]', 'TAS', '150', '236', { tirageSource: 'jp' });
    const ids = [4101, 4102];
    // la photo est la réimpression (150, TAS) et la chaîne a affirmé l'original : jamais une affirmation de l'original
    const r = jouer(corpsDe({ gagnant: 4101, lecture: { numero: '150', total: '236', setCode: 'TAS' }, vivierIds: ids, nom: 'Carte GX' }), [ORI, TAS], ids);
    vrai('(2) la photo est la réimpression : l\'original n\'est PAS affirmé', r.issue !== 'affirmee');
    // la photo est l'original : l'original est affirmé, la réimpression ne le gêne pas
    const r2 = jouer(corpsDe({ gagnant: 4101, lecture: { numero: '12', total: '100', setCode: 'SM' }, vivierIds: ids, nom: 'Carte GX' }), [ORI, TAS], ids);
    v('(2)     la photo est l\'original (12, SM) : l\'original est affirmé', [r2.issue, r2.analyse.cartes[0].carte && r2.analyse.cartes[0].carte.idProduct], ['affirmee', 4101]);
    // mélange : le numéro de l'original mais le code de la réimpression (une mauvaise lecture du code) : le code ne concorde pas, jamais d'affirmation
    const r3 = jouer(corpsDe({ gagnant: 4101, lecture: { numero: '12', total: null, setCode: 'TAS' }, vivierIds: ids, nom: 'Carte GX' }), [ORI, TAS], ids);
    vrai('(2)     le numéro de l\'original avec le code de la réimpression : pas d\'affirmation', r3.issue !== 'affirmee');
    // le nom seul ne tranche jamais : mêmes noms, aucune lecture de code ni de numéro
    const r4 = jouer(corpsDe({ gagnant: 4101, lecture: { numero: null, total: null, setCode: null }, vivierIds: ids, nom: 'Carte GX' }), [ORI, TAS], ids);
    vrai('(2)     le nom seul ne tranche jamais (ni numéro ni code lus)', r4.issue !== 'affirmee');
}
// ── (3) un code non lu : le critère ne s'applique pas
{
    const r = jouer(corpsDe({ gagnant: 4001, lecture: { setCode: null }, vivierIds: IDS }), [P, J], IDS);
    v('(3) code NON lu : la question d\'avant', [r.issue, montres(r)], ['question', [4001, 4002]]);
}
// ── (4) un numéro porté par deux produits du groupe (le jumeau a le MÊME numéro sous un autre code)
{
    const J2 = ligne(4003, 'Carte [Un | Deux]', 'BBB', '12', '100');
    const ids = [4001, 4003];
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: ids }), [P, J2], ids);
    v('(4) le numéro lu est aussi celui d\'un autre produit : la question d\'avant', [r.issue, montres(r)], ['question', [4001, 4003]]);
}
// ── (5) un autre produit du groupe a un numéro INCONNU, ou ambigu (un seul côté porte des lettres)
{
    const JN = ligne(4004, 'Carte [Un | Deux]', 'BBB', null, '100');
    const ids = [4001, 4004];
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: ids }), [P, JN], ids);
    v('(5) un autre produit sans numéro : la question d\'avant', [r.issue, montres(r)], ['question', [4001, 4004]]);
    const JS = ligne(4005, 'Carte [Un | Deux]', 'BBB', 'S12', '100');
    const ids2 = [4001, 4005];
    const r2 = jouer(corpsDe({ gagnant: 4001, vivierIds: ids2 }), [P, JS], ids2);
    v('(5)     un autre produit « S12 » face à « 12 » lu (mêmes chiffres, ni égal ni contredit) : la question d\'avant', [r2.issue, montres(r2)], ['question', [4001, 4005]]);
}
// ── (6) le nom lu (confiance haute) contredit P
{
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: IDS, nom: 'Pikachu' }), [P, J], IDS);
    vrai('(6) le nom lu contredit P : pas d\'affirmation', r.issue !== 'affirmee');
    const r2 = jouer(corpsDe({ gagnant: 4001, vivierIds: IDS, nom: 'Pikachu', nomConfiance: 'basse' }), [P, J], IDS);
    v('(6)     nom lu en confiance basse : il ne contredit rien, P est affirmé', r2.issue, 'affirmee');
}
// ── (7) la garde contradiction passe EN PREMIER : un champ lu qui contredit P bloque, y compris sans candidat désigné
{
    const r = jouer(corpsDe({ gagnant: 4001, lecture: { total: '150' }, vivierIds: IDS }), [P, J], IDS);
    vrai('(7) le total lu contredit P : pas d\'affirmation', r.issue !== 'affirmee');
    v('(7)     … et c\'est la garde contradiction qui répond (résumé présent)', typeof r.contradiction, 'string');
    // l'attaque seule contredit P et personne n'est désigné : la garde contradiction se tait, le critère A refuse quand même (« un élément lu qui contredit le gagnant bloque toujours »)
    const r2 = jouer(corpsDe({ gagnant: 4001, lecture: { attaque: 'Trois', attaqueConfiance: 'haute' }, vivierIds: IDS }), [P, J], IDS);
    v('(7)     l\'attaque lue contredit P (personne désigné) : la question d\'avant', [r2.issue, montres(r2), r2.contradiction === undefined], ['question', [4001, 4002], true]);
    // un champ qui concorde ne gêne pas
    const r3 = jouer(corpsDe({ gagnant: 4001, lecture: { attaque: 'Un', attaqueConfiance: 'haute' }, vivierIds: IDS }), [P, J], IDS);
    v('(7)     l\'attaque lue concorde : P est affirmé', r3.issue, 'affirmee');
    // la langue lue contredit le tirage de P
    const r4 = jouer(corpsDe({ gagnant: 4001, lecture: { langue: 'JP' }, vivierIds: IDS }), [P, J], IDS);
    vrai('(7)     la langue lue (JP) contredit le tirage de P (intl) : pas d\'affirmation', r4.issue !== 'affirmee');
}
// ── (8) le candidat UNIQUE (ambiguë à un seul candidat) : même critère
{
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: IDS, ambigu: true, candidats: [4001] }), [P, J], IDS);
    v('(8) candidat unique, numéro et code concordent avec lui seul : affirmé', [r.issue, r.analyse.cartes[0].carte && r.analyse.cartes[0].carte.idProduct], ['affirmee', 4001]);
    const r2 = jouer(corpsDe({ gagnant: 4001, vivierIds: IDS, ambigu: true, candidats: [4001] }), [P, J], IDS, { critereA: false });
    v('(8)     drapeau éteint : la question de départage d\'avant', [r2.issue, montres(r2)], ['question', [4001, 4002]]);
    // sans jumeau, un candidat unique reste une CONFIRMATION (le critère parle d'un groupe de jumeaux)
    const r3 = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001], ambigu: true, candidats: [4001] }), [P], [4001]);
    v('(8)     sans jumeau : la question de confirmation à un candidat, inchangée', [r3.issue, montres(r3)], ['question', [4001]]);
}
// ── (9) plus de 3 produits (action `nombreux`) : affirmé si toutes les lignes sont là, sinon la réponse d'avant
{
    const Js = [4201, 4202, 4203].map((id, i) => ligne(id, 'Carte [Un | Deux]', 'C' + i, String(40 + i), '100'));
    const ids = [4001, ...Js.map(j => j.idProduct)];
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: ids }), [P, ...Js], ids);
    v('(9) quatre produits, un seul numéro concorde : affirmé', r.issue, 'affirmee');
    const r2 = jouer(corpsDe({ gagnant: 4001, vivierIds: ids }), [P, ...Js.slice(0, 2)], ids);
    vrai('(9)     une ligne de jumeau manque : jamais une affirmation (un numéro inconnu ne se déduit pas)', r2.issue !== 'affirmee');
}
// ── (10) sans bloc lectureGarde (route héritée directe) : pas de critère
{
    const c = corpsDe({ gagnant: 4001, vivierIds: IDS }); delete c.lectureGarde;
    const r = jouer(c, [P, J], IDS);
    vrai('(10) sans bloc lectureGarde : pas d\'affirmation', r.issue !== 'affirmee');
}
// ── (11) la fonction pure, appelable seule
{
    const base = { corps: corpsDe({ gagnant: 4001, vivierIds: IDS }), gagnant: 4001, jumeaux: [4002], produits: new Map([P, J].map(l => [l.idProduct, l])), actif: true };
    v('(11) critereA : affirme', CA.critereA(base).affirme, true);
    v('(11)     actif non vrai : jamais', [CA.critereA({ ...base, actif: false }).affirme, CA.critereA({ ...base, actif: 'oui' }).affirme], [false, false]);
    v('(11)     aucun jumeau : jamais', CA.critereA({ ...base, jumeaux: [] }).affirme, false);
    v('(11)     entrée absente : jamais, sans lever', [CA.critereA().affirme, CA.critereA({}).affirme, CA.critereA({ ...base, produits: null }).affirme], [false, false, false]);
    const c = CA.compteurs();
    vrai('(11)     les compteurs existent (jugees, affirmees)', Number.isInteger(c.jugees) && Number.isInteger(c.affirmees));
}
// ── (13) TOUR 1 (I2) : la couverture. Chaque cas qui doit REFUSER a son TÉMOIN : la même donnée, changée d'un seul point, qui AFFIRME (le refus ne vient donc que de ce point ; aucune mutation du code de production).
{
    const issue = (lignes, lecture, extra = {}) => { const ids = lignes.map(l => l.idProduct); return jouer(corpsDe({ gagnant: ids[0], lecture, vivierIds: ids, ...extra }), lignes, ids).issue; };
    const duo = (codeP, numP, codeJ, numJ, extra = {}) => [ligne(5001, 'Carte [Un | Deux]', codeP, numP, '100'), ligne(5002, 'Carte [Un | Deux]', codeJ, numJ, '100', extra)];
    // convention X : le jumeau « xASC » au MÊME numéro que P (le code lu « ASC » concorde avec les deux par la convention X)
    v('(13) convention X : le jumeau xASC porte le même numéro => refusé', issue(duo('ASC', '12', 'xASC', '12'), { setCode: 'ASC' }), 'question');
    v('(13)     témoin : le même jumeau xASC à un AUTRE numéro => affirmé', issue(duo('ASC', '12', 'xASC', '99'), { setCode: 'ASC' }), 'affirmee');
    // une variante (reverse) au même numéro ET au même code, que la colonne compte dans le groupe
    v('(13) une variante au même numéro et au même code dans le groupe => refusée', issue(duo('ASC', '12', 'ASC', '12'), { setCode: 'ASC' }), 'question');
    v('(13)     témoin : un jumeau au même code mais à un autre numéro => affirmé', issue(duo('ASC', '12', 'ASC', '99'), { setCode: 'ASC' }), 'affirmee');
    // « 025 » contre « 25 » : égaux au sens de comparer (zéros de tête)
    v('(13) « 25 » lu, P « 025 » : numéro exact, jumeau « 99 » => affirmé', issue(duo('AAA', '025', 'BBB', '99'), { numero: '25', setCode: 'AAA' }), 'affirmee');
    v('(13)     « 025 » lu, jumeau « 25 » : le numéro lu est celui du jumeau (P porte « 99 ») => P non affirmé', issue([ligne(5101, 'Carte [Un | Deux]', 'AAA', '99', '100'), ligne(5102, 'Carte [Un | Deux]', 'BBB', '25', '100')], { numero: '025', setCode: 'AAA' }), 'question');
    // un préfixe alphabétique d'un seul côté n'est NI égal NI contredit : jamais d'affirmation
    v('(13) « 05 » lu, P « 05 », jumeau « TG05 » (mêmes chiffres, préfixe d\'un seul côté) => refusé', issue(duo('AAA', '05', 'BBB', 'TG05'), { numero: '05', setCode: 'AAA' }), 'question');
    v('(13)     témoin : le jumeau « TG06 » (chiffres différents) => affirmé', issue(duo('AAA', '05', 'BBB', 'TG06'), { numero: '05', setCode: 'AAA' }), 'affirmee');
    v('(13) « 028 » lu, P « SV028 » : pas exact => pas d\'affirmation', issue(duo('AAA', 'SV028', 'BBB', '99'), { numero: '028', setCode: 'AAA' }), 'question');
    v('(13)     témoin : « SV028 » lu, P « SV028 » => affirmé', issue(duo('AAA', 'SV028', 'BBB', '99'), { numero: 'SV028', setCode: 'AAA' }), 'affirmee');
    // l'autre langue de tirage : P est du tirage intl, le jumeau du tirage jp ; la langue lue contredit P (statut langue)
    const L = lang => issue(duo('AAA', '12', 'BBB', '99', { tirageSource: 'jp' }), { setCode: 'AAA', langue: lang });
    v('(13) langue lue JP, P tirage intl => refusé', L('JP'), 'question');
    v('(13)     témoin : langue lue EN => affirmé', L('EN'), 'affirmee');
}
// ── (14) TOUR 1 (I1) : le risque suivi en production — un compteur des affirmations du critère, PAR CODE DE SET lu
{
    const avant = CA.compteurs().parCode;
    vrai('(14) compteurs().parCode existe (objet)', avant && typeof avant === 'object');
    const n0 = (avant && avant.AAA) || 0;
    const ids = [4001, 4002];
    jouer(corpsDe({ gagnant: 4001, vivierIds: ids }), [P, J], ids);
    v('(14)     une affirmation du critère sur le code lu « AAA » : +1 sous AAA', ((CA.compteurs().parCode || {}).AAA || 0) - n0, 1);
    const n1 = (CA.compteurs().parCode || {}).AAA || 0;
    jouer(corpsDe({ gagnant: 4001, lecture: { setCode: null }, vivierIds: ids }), [P, J], ids);
    v('(14)     un refus ne compte pas', ((CA.compteurs().parCode || {}).AAA || 0) - n1, 0);
}
// ── (12) l'état du drapeau est tenu : allumé (mesure du 2026-10-17 : 0 faux sur le banc étiqueté) ; éteint, un banc doit le dire
vrai('(12) CRITERE_A est allumé (0 faux mesuré) — l\'éteindre exige de changer ce banc ET de le dire au rapport', CA.CRITERE_A === true);
bilan();
