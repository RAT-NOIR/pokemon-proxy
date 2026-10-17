'use strict';
// Lot LANGUE-DECISIVE (2026-10-17, nuit) — la langue, l'illustration, l'attaque et le code de la PHOTO tranchent une question de la garde contradiction ou des jumeaux.
// Cas réel du testeur reconstruit en données FABRIQUÉES (aucun identifiant réel, aucun dossier du testeur, aucune base, aucun réseau) : une photo japonaise « わるいバンギラス » n° 144/103,
// la chaîne affirme l'impression chinoise simplifiée, la garde contradiction pose une question à trois (chinois, japonais, une ancienne carte sans numéro).
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');
const LD = require('../identifier/langue-decisive');

const cfg = lireConfig({});
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const ligne = (idProduct, nomCardmarket, code, numero, total, tirageSource, extra = {}) => ({ idProduct, nomCardmarket, nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total, setTcgdex: null, langue: null, variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://exemple.invalide/${idProduct}.webp`, w: 255, h: 356 }, tirageSource, ...extra });

const ZH = ligne(7003, 'Sombre [Grind | Spinning Tail | Bite Off]', 'AAAC', '144', null, 'zh-hans');
const JP = ligne(7002, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', '103', 'jp');
const VIEUX = ligne(7001, 'Sombre [Mountain Smasher | Fling Away]', 'CCCN', null, null, 'jp');
const INTL = ligne(7004, 'Sombre [Rock Tumble | Bite]', 'DDDE', '19', '109', 'intl');
const TOUT = [VIEUX, JP, ZH, INTL];
const LU = { numero: '144', total: '103', setCode: 'XXXP', symboleSet: null, attaque: 'Crush', attaqueConfiance: 'haute', carteTcgdexId: null, langue: 'JP', totalHorsTailleDeSet: false };
function corps({ gagnant = 7003, lecture = {}, nomBrut = 'わるいバンギラス', nom = 'Sombre', vivier = [7001, 7002, 7003, 7004] } = {}) {
    const l = { ...LU, ...lecture, vivierIds: vivier };
    return { success: true, scanId: 's', question: null,
        carte: { idProduct: gagnant, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom, nomBrut, nomConfiance: 'haute', numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: null, langue: l.langue },
        etat: etatH, candidats: [{ idProduct: gagnant }], classement: [{ idProduct: gagnant, score: 100 }], reverse: { attendue: false, strategie: null }, codeLangue: 7, lectureGarde: l };
}
const jouer = (c, extra = {}, lignes = TOUT) => muet(() => adapter({ statutHttp: 200, corps: c }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: () => ({ conclu: true, ids: [] }), critereA: false, ...extra }));
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct) : []);
const idAffirme = r => (r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null);

// ── (1) la langue lue « avec certitude » : la langue du modèle ET l'écriture du nom brut concordent
{
    const f = (langue, nomBrut) => LD.langueCertaine({ langue, nomBrut });
    v('(1) japonais : kana + JP', f('JP', 'わるいバンギラス'), { famille: 'ja', code: 'ja' });
    v('(1) japonais écrit « JA » (alias)', f('ja', 'ピカチュウ'), { famille: 'ja', code: 'ja' });
    v('(1) JP lu mais nom en lettres latines : pas certain', f('JP', 'Dark Tyranitar'), null);
    v('(1) kana mais langue lue EN : pas certain', f('EN', 'ピカチュウ'), null);
    v('(1) coréen : hangul + KR', f('KR', '피카츄'), { famille: 'ko', code: 'ko' });
    v('(1) chinois : idéogrammes sans kana + ZH (la variante ne se lit pas : code null)', f('ZH', '皮卡丘'), { famille: 'zh', code: null });
    v('(1) ZH lu mais des kana dans le nom : pas certain', f('ZH', 'ピカ丘'), null);
    v('(1) JP lu et nom en idéogrammes seuls : pas certain (jamais deviné)', f('JP', '白金'), null);
    v('(1) français : latin + FR', f('FR', 'Dracaufeu'), { famille: 'ouest', code: 'fr' });
    v('(1) EN lu avec un nom en kana : pas certain', f('EN', 'リザードン'), null);
    v('(1) russe : cyrillique + RU', f('RU', 'Чаризард'), { famille: 'ouest', code: 'ru' });
    v('(1) langue absente', f(null, 'Dracaufeu'), null);
    v('(1) nom brut absent', f('FR', null), null);
    v('(1) langue inconnue du code fermé', f('XX', 'Dracaufeu'), null);
}

// ── (2) le code fermé du TIRAGE d'une impression (contrat 7a) : jamais deviné
{
    v('(2) jp -> ja', LD.langueDeTirage('jp'), 'ja');
    v('(2) zh-hans -> zh-hans', LD.langueDeTirage('zh-hans'), 'zh-hans');
    v('(2) zh-hant -> zh-hant', LD.langueDeTirage('zh-hant'), 'zh-hant');
    v('(2) ko -> ko', LD.langueDeTirage('ko'), 'ko');
    v('(2) intl : plusieurs langues, aucune devinée', LD.langueDeTirage('intl'), null);
    v('(2) id, th, idth, null, texte libre : null', [LD.langueDeTirage('id'), LD.langueDeTirage('th'), LD.langueDeTirage('idth'), LD.langueDeTirage(null), LD.langueDeTirage('klingon')], [null, null, null, null, null]);
}

// ── (3) R1 : le candidat dont le tirage contredit la langue certaine est retiré
{
    const R1 = { R1: true, R2: false, R2BIS: false, R4: false };
    const r = LD.reduire({ ids: [7003, 7002, 7001], corps: corps(), produits: new Map(TOUT.map(l => [l.idProduct, l])), regles: R1 });
    v('(3) R1 : le tirage chinois est retiré, le japonais et le sans-numéro restent', [r.ids, r.retires], [[7002, 7001], [{ id: 7003, regle: 'R1' }]]);
    const r2 = LD.reduire({ ids: [7003, 7002, 7001], corps: corps({ nomBrut: 'Dark Tyranitar' }), produits: new Map(TOUT.map(l => [l.idProduct, l])), regles: R1 });
    v('(3) R1 : langue pas certaine (nom en latin) : rien n\'est retiré', [r2.ids, r2.retires], [[7003, 7002, 7001], []]);
    const r3 = LD.reduire({ ids: [7003, 7002], corps: corps(), produits: new Map(TOUT.map(l => [l.idProduct, l])), regles: { ...R1, R1: false } });
    v('(3) R1 éteinte : rien n\'est retiré', r3.retires, []);
    const ID = ligne(7005, 'Sombre [A | B]', 'EEEI', '144', null, 'id');
    const r4 = LD.reduire({ ids: [7005, 7002], corps: corps(), produits: new Map([...TOUT, ID].map(l => [l.idProduct, l])), regles: R1 });
    v('(3) R1 : un tirage inconnu (id) ne retire rien', r4.retires, []);
    const r5 = LD.reduire({ ids: [7003], corps: corps(), produits: new Map(TOUT.map(l => [l.idProduct, l])), regles: R1 });
    v('(3) R1 : tous les candidats retirés => la question d\'origine, jamais une absence inventée', [r5.ids, r5.retires], [[7003], []]);
    const r6 = LD.reduire({ ids: [7004, 7002], corps: corps({ lecture: { langue: 'FR' }, nomBrut: 'Dracaufeu' }), produits: new Map(TOUT.map(l => [l.idProduct, l])), regles: R1 });
    v('(3) R1 : un français certain retire le japonais, garde l\'international', [r6.ids, r6.retires], [[7004], [{ id: 7002, regle: 'R1' }]]);
}

// ── (4) R2 : l'illustration (inliers de la photo), DEUX seuils : retiré si reconnu par personne (<= bas) ET qu'un AUTRE candidat est reconnu nettement (>= haut)
{
    const R2 = { R1: false, R2: true, R2BIS: false, R4: false };
    const P = new Map(TOUT.map(l => [l.idProduct, l]));
    const sc = o => new Map(Object.entries(o).map(([k, x]) => [Number(k), x]));
    const { bas, haut } = LD.SEUIL_IMAGE;
    vrai('(4) les seuils de la mesure : entiers, bas < haut', Number.isInteger(bas) && Number.isInteger(haut) && bas >= 0 && bas < haut);
    const a = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: R2, scoresImage: sc({ 7001: bas, 7002: haut }) });
    v('(4) R2 : bas retiré quand un autre candidat atteint haut', [a.ids, a.retires], [[7002], [{ id: 7001, regle: 'R2' }]]);
    const b = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: R2, scoresImage: sc({ 7001: bas, 7002: haut - 1 }) });
    v('(4) R2 : personne n\'atteint haut (photo non comparable) : rien n\'est retiré', b.retires, []);
    const g = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: R2, scoresImage: sc({ 7001: bas + 1, 7002: haut }) });
    v('(4) R2 : au-dessus de bas, le candidat reste (zone grise : jamais retiré)', g.retires, []);
    const c = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: R2, scoresImage: sc({ 7002: haut }) });
    v('(4) R2 : un candidat sans score : rien n\'est retiré', c.retires, []);
    const d = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: R2 });
    v('(4) R2 : pas de scores (pas de photo comparable) : rien n\'est retiré', d.retires, []);
    const e = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: { ...R2, R2: false }, scoresImage: sc({ 7001: bas, 7002: haut }) });
    v('(4) R2 éteinte : rien n\'est retiré', e.retires, []);
    const h = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: R2, scoresImage: sc({ 7001: 0, 7002: 0 }) });
    v('(4) R2 : deux candidats à 0 : rien n\'est retiré (un 0 ne retire jamais seul)', h.retires, []);
    const k = LD.reduire({ ids: [7001, 7002, 7003], corps: corps(), produits: P, regles: R2, scoresImage: sc({ 7001: haut, 7002: haut, 7003: bas }) });
    v('(4) R2 : deux candidats nettement reconnus : seul le non reconnu part', [k.ids, k.retires], [[7001, 7002], [{ id: 7003, regle: 'R2' }]]);
}
// ── (5) R2 bis : l'attaque lue en confiance haute, avec repli (jamais si elle contredit tout le monde)
{
    const R2B = { R1: false, R2: false, R2BIS: true, R4: false };
    const P = new Map(TOUT.map(l => [l.idProduct, l]));
    const a = LD.reduire({ ids: [7001, 7002], corps: corps({ lecture: { attaque: 'Grind' } }), produits: P, regles: R2B });
    v('(5) R2 bis : l\'attaque lue concorde avec un seul, l\'autre (attaques connues, aucune ne concorde) est retiré', [a.ids, a.retires], [[7002], [{ id: 7001, regle: 'R2BIS' }]]);
    const b = LD.reduire({ ids: [7001, 7002], corps: corps(), produits: P, regles: R2B });
    v('(5) R2 bis : « Crush » contredit les deux (comme sur la vraie carte) : rien n\'est retiré', b.retires, []);
    const c = LD.reduire({ ids: [7001, 7002], corps: corps({ lecture: { attaque: 'Grind', attaqueConfiance: 'moyenne' } }), produits: P, regles: R2B });
    v('(5) R2 bis : attaque en confiance moyenne : rien n\'est retiré', c.retires, []);
    const SANS = ligne(7006, 'Sombre', 'FFFS', null, null, 'jp');
    const d = LD.reduire({ ids: [7006, 7002], corps: corps({ lecture: { attaque: 'Grind' } }), produits: new Map([...TOUT, SANS].map(l => [l.idProduct, l])), regles: R2B });
    v('(5) R2 bis : un candidat aux attaques inconnues n\'est jamais retiré', d.retires, []);
}

// ── (6) R4 : un code lu qui ne désigne personne dans le vivier ne bloque pas ; un code qui désigne un autre candidat bloque toujours
{
    const P = new Map(TOUT.map(l => [l.idProduct, l]));
    const vide = LD.codeSansDesignation({ corps: corps(), produits: P });
    vrai('(6) le code « XXXP » ne désigne aucun produit du vivier', vide === true);
    const desi = LD.codeSansDesignation({ corps: corps({ lecture: { setCode: 'DDDE' } }), produits: P });
    vrai('(6) le code « DDDE » désigne un produit du vivier (7004)', desi === false);
    const incomplet = LD.codeSansDesignation({ corps: corps({ vivier: [7001, 7002, 7003, 7004, 7999] }), produits: P });
    vrai('(6) une ligne du vivier manque : on ne peut pas conclure (false)', incomplet === false);
    const sansCode = LD.codeSansDesignation({ corps: corps({ lecture: { setCode: null } }), produits: P });
    vrai('(6) code non lu : false (rien à ne pas désigner)', sansCode === false);
}

// ── (7) le CAS RÉEL de bout en bout dans l'adaptateur
{
    const ref = jouer(corps(), { langueDecisive: { R1: false, R2: false, R2BIS: false, R4: false } });
    v('(7) sans règle : la question à trois d\'avant (chinois, japonais, ancienne carte)', [ref.issue, montres(ref).sort()], ['question', [7001, 7002, 7003]]);
    const r1 = jouer(corps(), { langueDecisive: { R1: true, R2: false, R2BIS: false, R4: true } });
    v('(7) R1 + R4 seuls : le chinois part, la question ne porte plus que sur le japonais et l\'ancienne carte', [r1.issue, montres(r1).sort()], ['question', [7001, 7002]]);
    const sc = new Map([[7001, 3], [7002, 80], [7003, 4]]);
    const tout = jouer(corps(), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true }, scoresImage: sc });
    v('(7) R1 + R2 + R4 : le japonais 7002 est SÛR', [tout.issue, idAffirme(tout)], ['affirmee', 7002]);
    vrai('(7)     le résultat dit par quelles règles (côté serveur)', typeof tout.critere === 'string' && /R1/.test(tout.critere) && /R2/.test(tout.critere));
    const sansR4 = jouer(corps(), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: false }, scoresImage: sc });
    v('(7) sans R4 : le code lu « XXXP » contredit 7002, pas de sûr : la question d\'un candidat n\'est pas posée, la question d\'avant reste', [sansR4.issue, montres(sansR4).sort()], ['question', [7001, 7002, 7003]]);
    const faux = jouer(corps({ lecture: { numero: '145' } }), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true }, scoresImage: sc });
    vrai('(7) le numéro lu (145) ne concorde pas avec 7002 : jamais un sûr', faux.issue !== 'affirmee');
    const autre = jouer(corps({ lecture: { setCode: 'DDDE' } }), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true }, scoresImage: sc });
    vrai('(7) le code lu désigne un AUTRE candidat du vivier (7004) : R4 ne lève rien, jamais un sûr', autre.issue !== 'affirmee');
    const latin = jouer(corps({ nomBrut: 'Dark Tyranitar' }), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true } });
    v('(7) la langue n\'est pas certaine (nom brut en latin) : R1 ne fait rien, la question d\'avant', [latin.issue, montres(latin).sort()], ['question', [7001, 7002, 7003]]);
    const toutesSous = jouer(corps(), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true }, scoresImage: new Map([[7001, 1], [7002, 2], [7003, 1]]) });
    v('(7) photo non comparable (personne ne dépasse S) : R1 seule joue, la question à deux', [toutesSous.issue, montres(toutesSous).sort()], ['question', [7001, 7002]]);
    // sans ctx.langueDecisive ni scores d'image : les constantes livrées s'appliquent (R2 n'a rien à juger sans score) ; avec R1 allumée, le chinois part
    const defaut = jouer(corps(), {});
    v('(7) ctx.langueDecisive absent : l\'état livré des constantes (R1 ' + LD.REGLES.R1 + ')', [defaut.issue, montres(defaut).sort()], LD.REGLES.R1 ? ['question', [7001, 7002]] : ['question', [7001, 7002, 7003]]);
}

// ── (8) la question des JUMEAUX : même résolution
{
    const A = ligne(7101, 'Carte [Un | Deux]', 'AAJ', '12', '100', 'jp');
    const B = ligne(7102, 'Carte [Un | Deux]', 'BBZ', '99', '100', 'jp');
    const c = corps({ gagnant: 7101, lecture: { numero: '12', total: '100', setCode: 'AAJ', attaque: null, attaqueConfiance: null }, nomBrut: 'ピカ', nom: 'Carte', vivier: [7101, 7102] });
    const r = jouer(c, { jumeaux: id => ({ conclu: true, ids: id === 7101 ? [7102] : [7101] }), critereA: false, langueDecisive: { R1: true, R2: false, R2BIS: false, R4: true } }, [A, B]);
    v('(8) jumeaux de même tirage et langue compatible : rien n\'est retiré, la question d\'avant', [r.issue, montres(r).sort()], ['question', [7101, 7102]]);
}

// ── (9) R4 dans le critère A : le code lu ne désigne personne => il ne bloque pas ; il désigne un autre produit => il bloque toujours
{
    const A = ligne(7201, 'Carte [Un | Deux]', 'AAJ', '12', '100', 'jp');
    const B = ligne(7202, 'Carte [Un | Deux]', 'BBZ', '99', '100', 'jp');
    const lig = [A, B];
    const base = { numero: '12', total: '100', attaque: null, attaqueConfiance: null };
    const c = (setCode) => corps({ gagnant: 7201, lecture: { ...base, setCode }, nomBrut: 'ピカ', nom: 'Carte', vivier: [7201, 7202] });
    const ctx = r4 => ({ jumeaux: id => ({ conclu: true, ids: id === 7201 ? [7202] : [7201] }), critereA: true, langueDecisive: { R1: false, R2: false, R2BIS: false, R4: r4 } });
    const sans = jouer(c('QQQP'), ctx(false), lig);
    v('(9) sans R4 : un code lu inconnu du vivier bloque le critère A, la question d\'avant', [sans.issue, montres(sans).sort()], ['question', [7201, 7202]]);
    const avec = jouer(c('QQQP'), ctx(true), lig);
    v('(9) avec R4 : le numéro désigne 7201 seul et le code ne désigne personne : SÛR', [avec.issue, idAffirme(avec)], ['affirmee', 7201]);
    const autre = jouer(c('BBZ'), ctx(true), lig);
    vrai('(9) avec R4 : le code lu désigne l\'AUTRE jumeau (BBZ) : jamais un sûr sur 7201', autre.issue !== 'affirmee' || idAffirme(autre) !== 7201);
    const incomplet = jouer(corps({ gagnant: 7201, lecture: { ...base, setCode: 'QQQP' }, nomBrut: 'ピカ', nom: 'Carte', vivier: [7201, 7202, 7999] }), ctx(true), lig);
    vrai('(9) avec R4 : une ligne du vivier manque (7999) : on ne peut pas conclure, pas de sûr', incomplet.issue !== 'affirmee');
}

bilan();
