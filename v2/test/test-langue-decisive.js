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
// codeNumeroExiste : l'index code × numéro du CATALOGUE ENTIER (M2) ; par défaut « aucun produit du catalogue ne porte ce code et ce numéro »
const jouer = (c, extra = {}, lignes = TOUT) => muet(() => adapter({ statutHttp: 200, corps: c }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: () => ({ conclu: true, ids: [] }), critereA: false, codeNumeroExiste: () => false, ...extra }));
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
    const aucun = () => false;
    const vide = LD.codeSansDesignation({ corps: corps(), produits: P, catalogueExiste: aucun });
    vrai('(6) le code « XXXP » ne désigne aucun produit du vivier NI du catalogue', vide === true);
    const desi = LD.codeSansDesignation({ corps: corps({ lecture: { setCode: 'DDDE' } }), produits: P, catalogueExiste: aucun });
    vrai('(6) le code « DDDE » désigne un produit du vivier (7004)', desi === false);
    const incomplet = LD.codeSansDesignation({ corps: corps({ vivier: [7001, 7002, 7003, 7004, 7999] }), produits: P, catalogueExiste: aucun });
    vrai('(6) une ligne du vivier manque : on ne peut pas conclure (false)', incomplet === false);
    const sansCode = LD.codeSansDesignation({ corps: corps({ lecture: { setCode: null } }), produits: P, catalogueExiste: aucun });
    vrai('(6) code non lu : false (rien à ne pas désigner)', sansCode === false);
    // M2 : le catalogue ENTIER
    vrai('(6) M2 : sans index du catalogue (absent) : R4 FERMÉE (false)', LD.codeSansDesignation({ corps: corps(), produits: P }) === false);
    let appel = null;
    const porte = (c, n) => { appel = [c, n]; return true; };
    vrai('(6) M2 : un produit du catalogue porte ce code ET ce numéro (hors vivier) : false', LD.codeSansDesignation({ corps: corps(), produits: P, catalogueExiste: porte }) === false && appel[0] === 'XXXP' && appel[1] === '144');
    vrai('(6) M2 : l\'index qui lève : false (fermé)', LD.codeSansDesignation({ corps: corps(), produits: P, catalogueExiste: () => { throw new Error('x'); } }) === false);
    // l'index code × numéro lui-même
    const idx = LD.creerIndexCodeNumero([{ codeSet: 'SV4a', numero: '213' }, { codeSet: 'SIT', numeroUrl: 'TG18' }, { codeSet: 'M6a', numero: '144' }, { codeSet: 'SV-P/CS', numero: '144' }, { codeSet: null, numero: '5' }, { codeSet: 'ZZ', numero: null }]);
    vrai('(6) index : (sv4a, 213) existe, casse et zéros ignorés', idx.existe('sv4a', '213') && idx.existe('SV4A', '0213'));
    vrai('(6) index : (sv4a, 214) et (s8a-P, 144) n\'existent pas ; (m6a, 144) existe', !idx.existe('sv4a', '214') && !idx.existe('s8a-P', '144') && idx.existe('m6a', '144'));
    vrai('(6) index : entrées sans code ou sans numéro ignorées, taille comptée', idx.taille === 4);
    vrai('(6) index : code ou numéro illisible : false', idx.existe(null, '5') === false && idx.existe('ZZ', null) === false);
    // M-A : un code lu TRONQUÉ ou de SOUS-SET que `comparer` ne juge pas contredit DÉSIGNE (vivier comme index)
    vrai('(6) M-A index : « sv4 » (tronqué) face à SV4A au n° 213 : désigne', idx.existe('sv4', '213') === true);
    vrai('(6) M-A index : « SV-P » face à SV-P/CS au n° 144 : désigne', idx.existe('SV-P', '144') === true);
    vrai('(6) M-A index : « m6 » (2 caractères, sous LONGUEUR_MIN_PARENTE) face à M6A : `comparer` le juge CONTREDIT, R4 suit la production (ne désigne pas)', idx.existe('m6', '144') === false);
    vrai('(6) M-A index : un code CONTREDIT par tous les produits au numéro (TG lu, SIT au n° TG18) : ne désigne personne', idx.existe('TG', 'TG18') === false);
    vrai('(6) M-A index : le code du candidat testé est exclu (m6a au n° 144 exclu : reste SV-P/CS, contredit)', idx.existe('m6a', '144', 'M6A') === false && idx.existe('m6a', '144') === true);
    // M-A : le vivier — Y est un sous-set du code lu
    const Xv = ligne(7301, 'Carte [Un | Deux]', 'BBB', '144', null, 'jp'), Yv = ligne(7302, 'Carte [Un | Deux]', 'SV-P/CS', '144', null, 'jp');
    const PV = new Map([Xv, Yv].map(l => [l.idProduct, l]));
    const cv = corps({ gagnant: 7301, lecture: { setCode: 'SV-P', numero: '144' }, vivier: [7301, 7302] });
    vrai('(6) M-A vivier : « SV-P » face à Y = SV-P/CS (non contredit) dans le vivier : R4 ne joue pas', LD.codeSansDesignation({ corps: cv, produits: PV, catalogueExiste: aucun, pour: 7301 }) === false);
    const cv2 = corps({ gagnant: 7301, lecture: { setCode: 'ZZZZ', numero: '144' }, vivier: [7301, 7302] });
    vrai('(6) M-A vivier : un code contredit par X et par Y : R4 joue (X exclu comme candidat testé)', LD.codeSansDesignation({ corps: cv2, produits: PV, catalogueExiste: aucun, pour: 7301 }) === true);
    // M-B : le PLANCHER de taille de l'index
    vrai('(6) M-B : le plancher nommé est un entier de plusieurs milliers', Number.isInteger(LD.INDEX_CODE_NUMERO_MIN) && LD.INDEX_CODE_NUMERO_MIN >= 10000);
    let leve = null; try { LD.construireIndexVerifie([]); } catch (e) { leve = e; }
    vrai('(6) M-B : un index VIDE est tenu pour en panne (lève)', leve instanceof Error);
    leve = null; try { LD.construireIndexVerifie([{ codeSet: 'A', numero: '1' }, { codeSet: 'B', numero: '2' }, { codeSet: 'C', numero: '3' }, { codeSet: 'D', numero: '4' }, { codeSet: 'E', numero: '5' }]); } catch (e) { leve = e; }
    vrai('(6) M-B : un index de 5 couples lève aussi', leve instanceof Error);
    vrai('(6) M-B : le message ne porte aucune valeur lue', leve && !/[ABCDE] ?[1-5]/.test(String(leve.message)) && /plancher/.test(String(leve.message)));
    const avant = LD.compteurs().indexFermes;
    vrai('(6) M-B : un index sous le plancher est COMPTÉ', Number.isInteger(avant) && avant >= 2);
    vrai('(6) M-B : au plancher fourni, l\'index est rendu', LD.construireIndexVerifie([{ codeSet: 'A', numero: '1' }, { codeSet: 'B', numero: '2' }], 2).taille === 2);
}

// ── (7) le CAS RÉEL de bout en bout dans l'adaptateur
{
    const ref = jouer(corps(), { langueDecisive: { R1: false, R2: false, R2BIS: false, R4: false } });
    v('(7) sans règle : la question à trois d\'avant (chinois, japonais, ancienne carte)', [ref.issue, montres(ref).sort()], ['question', [7001, 7002, 7003]]);
    const r1 = jouer(corps(), { langueDecisive: { R1: true, R2: false, R2BIS: false, R4: true } });
    v('(7) R1 + R4 seuls : le chinois part, la question ne porte plus que sur le japonais et l\'ancienne carte', [r1.issue, montres(r1).sort()], ['question', [7001, 7002]]);
    const sc = new Map([[7001, 3], [7002, 80], [7003, 4]]);
    const tout = jouer(corps({ lecture: { attaque: null, attaqueConfiance: null } }), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true }, scoresImage: sc });
    v('(7) R1 + R2 + R4 (attaque non lue) : le japonais 7002 est SÛR', [tout.issue, idAffirme(tout)], ['affirmee', 7002]);
    const crush = jouer(corps(), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true }, scoresImage: sc });
    v('(7) M1 : « Crush » (haute) contredit 7002 (Grind…) : toutes les conditions du critère A, PAS de sûr ; la question garde la réduction de la langue seule (le chinois part)', [crush.issue, montres(crush).sort()], ['question', [7001, 7002]]);
    // la variante « attaque tolérée pour le seul restant » est RETIRÉE du code (r2 : un faux sûr prouvé sous sa forme actuelle) : aucun drapeau, aucun chemin de production ne l'atteint
    const toleree = jouer(corps(), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: true, attaqueTolereeRestant: true, toleres: ['attaque'] }, scoresImage: sc });
    vrai('(7) « attaqueTolereeRestant » n\'existe plus : même demandée, « Crush » bloque encore le restant (question, jamais un sûr)', toleree.issue === 'question');
    vrai('(7)     aucune trace de la variante dans le code livré', !/attaqueTolereeRestant|toleres/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'identifier', 'langue-decisive.js'), 'utf8')) && !/attaqueTolereeRestant|toleres/.test(require('fs').readFileSync(require('path').join(__dirname, '..', 'identifier', 'critere-a.js'), 'utf8')));
    vrai('(7)     le résultat dit par quelles règles (côté serveur)', typeof tout.critere === 'string' && /R1/.test(tout.critere) && /R2/.test(tout.critere));
    const sansR4 = jouer(corps(), { langueDecisive: { R1: true, R2: true, R2BIS: false, R4: false }, scoresImage: sc });
    v('(7) sans R4 : le code lu « XXXP » contredit 7002, pas de sûr : la question garde la réduction de la langue seule (le chinois part)', [sansR4.issue, montres(sansR4).sort()], ['question', [7001, 7002]]);
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
    v('(9) avec R4 : le code lu désigne l\'AUTRE jumeau (BBZ) : aucun sûr, la question de départage', [autre.issue, montres(autre).sort()], ['question', [7201, 7202]]);
    const cat = jouer(c('QQQP'), { ...ctx(true), codeNumeroExiste: () => true }, lig);
    v('(9) M2 : un produit du catalogue porte ce code ET ce numéro (hors vivier) : R4 ne joue pas, la question d\'avant', [cat.issue, montres(cat).sort()], ['question', [7201, 7202]]);
    const sansIndex = jouer(c('QQQP'), { ...ctx(true), codeNumeroExiste: undefined }, lig);
    v('(9) M2 : index du catalogue indisponible : R4 fermée, la question d\'avant', [sansIndex.issue, montres(sansIndex).sort()], ['question', [7201, 7202]]);
    const incomplet = jouer(corps({ gagnant: 7201, lecture: { ...base, setCode: 'QQQP' }, nomBrut: 'ピカ', nom: 'Carte', vivier: [7201, 7202, 7999] }), ctx(true), lig);
    vrai('(9) avec R4 : une ligne du vivier manque (7999) : on ne peut pas conclure, pas de sûr', incomplet.issue !== 'affirmee');
    // M-A, de bout en bout : le scénario de r2 — X (code BBB n° 144) est le produit affirmé, Y (SV-P/CS n° 144) est dans le vivier ; le code lu « SV-P » est un SOUS-SET de Y, pas une absence
    const X = ligne(7401, 'Carte [Un | Deux]', 'BBB', '144', '100', 'jp'), Z = ligne(7402, 'Carte [Un | Deux]', 'CCC', '99', '100', 'jp'), Y = ligne(7403, 'Carte [Un | Deux]', 'SV-P/CS', '144', '100', 'jp');
    const lecA = { numero: '144', total: '100', setCode: 'SV-P', attaque: null, attaqueConfiance: null };
    const cA = corps({ gagnant: 7401, lecture: lecA, nomBrut: 'ピカ', nom: 'Carte', vivier: [7401, 7402, 7403] });
    const ctxA = { jumeaux: id => ({ conclu: true, ids: id === 7401 ? [7402] : id === 7402 ? [7401] : [] }), critereA: true, langueDecisive: { R1: false, R2: false, R2BIS: false, R4: true, R5: false } };
    const sousSet = jouer(cA, ctxA, [X, Z, Y]);
    v('(9) M-A : « SV-P » face à Y = SV-P/CS dans le vivier (non contredit) : R4 ne joue pas, pas de sûr sur X', [sousSet.issue, idAffirme(sousSet)], ['question', null]);
    const sansY = jouer(corps({ gagnant: 7401, lecture: lecA, nomBrut: 'ピカ', nom: 'Carte', vivier: [7401, 7402] }), ctxA, [X, Z]);
    v('(9) M-A témoin : sans Y, le code lu ne désigne personne : X SÛR', [sansY.issue, idAffirme(sansY)], ['affirmee', 7401]);
}

// ── (10) B1 : le candidat restant passe par la GARDE DES JUMEAUX (groupe lu dans la colonne des jumeaux, pas dans le vivier)
{
    const Z = ligne(8001, 'Sombre [Grind | Spinning Tail | Bite Off]', 'AAAC', '144', '103', 'zh-hans');
    const J = ligne(8002, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', '103', 'jp');
    const JJ = ligne(8003, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', '103', 'jp');     // le jumeau de 8002 : même numéro, même total, même code, HORS du vivier
    const JD = ligne(8004, 'Sombre [Grind | Spinning Tail | Bite Off]', 'DDDJ', '99', '103', 'jp');      // un jumeau à un autre numéro
    const lec = { setCode: 'BBBJ', attaque: null, attaqueConfiance: null };
    const R = { langueDecisive: { R1: true, R2: false, R2BIS: false, R4: false, R5: false } };
    const groupe = (jum) => id => ({ conclu: true, ids: id === 8002 ? [jum] : id === 8001 ? [] : [8002] });
    const refus = jouer(corps({ gagnant: 8001, lecture: lec, vivier: [8001, 8002] }), { ...R, jumeaux: groupe(8003) }, [Z, J, JJ]);
    v('(10) B1 : 8002 a un jumeau (8003) de même numéro, total et code HORS du vivier : jamais un sûr, la question d\'avant', [refus.issue, montres(refus).sort()], ['question', [8001, 8002]]);
    const ok = jouer(corps({ gagnant: 8001, lecture: lec, vivier: [8001, 8002] }), { ...R, jumeaux: groupe(8004) }, [Z, J, JD]);
    v('(10) B1 témoin : le jumeau est à un AUTRE numéro (99) que le numéro lu : 8002 est SÛR', [ok.issue, idAffirme(ok)], ['affirmee', 8002]);
    const sansColonne = jouer(corps({ gagnant: 8001, lecture: lec, vivier: [8001, 8002] }), { ...R, jumeaux: () => ({ conclu: false, ids: [] }) }, [Z, J]);
    vrai('(10) B1 : la colonne des jumeaux ne conclut pas : jamais un sûr', sansColonne.issue !== 'affirmee');
    // m-2 : la sonde de la résolution ne pollue pas les compteurs de la garde des jumeaux
    const JC = require('../identifier/jumeaux');
    const c0 = JC.compteurs();
    jouer(corps({ gagnant: 8001, lecture: lec, vivier: [8001, 8002] }), { ...R, jumeaux: () => ({ conclu: false, ids: [] }) }, [Z, J]);
    jouer(corps({ gagnant: 8001, lecture: lec, vivier: [8001, 8002] }), { ...R, jumeaux: groupe(8003) }, [Z, J, JJ]);
    v('(10) m-2 : une résolution refusée (colonne muette, jumeau) ne touche aucun compteur de la garde des jumeaux', JC.compteurs(), c0);
    const sansJumeau = jouer(corps({ gagnant: 8001, lecture: lec, vivier: [8001, 8002] }), { ...R, jumeaux: () => ({ conclu: true, ids: [] }) }, [Z, J]);
    v('(10) B1 témoin : 8002 n\'a aucun jumeau : SÛR', [sansJumeau.issue, idAffirme(sansJumeau)], ['affirmee', 8002]);
}

// ── (11) R5 : un candidat d'un set SANS NUMÉROTATION (liste figée en idExpansion) est retiré quand le numéro et le total sont lus et qu'un autre candidat, hors liste, a un total qui concorde
{
    const SANS = LD.SANS_NUMEROTATION[0].idExpansion;
    const vieux = ligne(8101, 'Sombre [Mountain Smasher | Fling Away]', 'CCCN', null, null, 'jp', { idExpansion: SANS });
    const vieux2 = ligne(8104, 'Sombre [Mountain Smasher | Fling Away]', 'CCCM', null, null, 'jp', { idExpansion: SANS });
    const jp = ligne(8102, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', '103', 'jp', { idExpansion: 123456 });
    const horsListe = ligne(8105, 'Sombre [Mountain Smasher | Fling Away]', 'CCCH', null, null, 'jp', { idExpansion: 654321 });
    const zh = ligne(8103, 'Sombre [Grind | Spinning Tail | Bite Off]', 'AAAC', '144', null, 'zh-hans', { idExpansion: 123457 });
    const P = new Map([vieux, vieux2, jp, horsListe, zh].map(l => [l.idProduct, l]));
    const R5 = { R1: false, R2: false, R2BIS: false, R4: false, R5: true };
    const lec = (o = {}) => corps({ gagnant: 8103, lecture: { setCode: 'BBBJ', attaque: null, attaqueConfiance: null, ...o }, vivier: [8101, 8102, 8103, 8104, 8105] });
    const a = LD.reduire({ ids: [8101, 8102], corps: lec(), produits: P, regles: R5 });
    v('(11) R5 : le set sans numérotation est retiré (numéro et total lus, un autre candidat au total concordant)', [a.ids, a.retires], [[8102], [{ id: 8101, regle: 'R5' }]]);
    const b = LD.reduire({ ids: [8101, 8104], corps: lec(), produits: P, regles: R5 });
    v('(11) R5 : jamais tous retirés (deux candidats de la liste : aucun autre au total concordant)', [b.ids, b.retires], [[8101, 8104], []]);
    const c = LD.reduire({ ids: [8105, 8102], corps: lec(), produits: P, regles: R5 });
    v('(11) R5 : un set HORS liste n\'est jamais retiré', c.retires, []);
    const d = LD.reduire({ ids: [8101, 8102], corps: lec({ total: '999' }), produits: P, regles: R5 });
    v('(11) R5 : total lu discordant avec l\'autre candidat : rien', d.retires, []);
    const e = LD.reduire({ ids: [8101, 8102], corps: lec({ numero: null }), produits: P, regles: R5 });
    v('(11) R5 : numéro non lu : rien', e.retires, []);
    const f = LD.reduire({ ids: [8101, 8102], corps: lec({ total: null }), produits: P, regles: R5 });
    v('(11) R5 : total non lu : rien', f.retires, []);
    const g = LD.reduire({ ids: [8101, 8102], corps: lec({ totalHorsTailleDeSet: true }), produits: P, regles: R5 });
    v('(11) R5 : total hors taille de set (mauvaise lecture) : rien', g.retires, []);
    const h = LD.reduire({ ids: [8101, 8102], corps: lec(), produits: P, regles: { ...R5, R5: false } });
    v('(11) R5 éteinte : rien', h.retires, []);
    const i = LD.reduire({ ids: [8101, 8103], corps: lec(), produits: P, regles: R5 });
    v('(11) R5 : l\'autre candidat n\'a pas de total : rien', i.retires, []);
    // de bout en bout : le chinois part (R1), le set sans numérotation part (R5), reste le japonais numéroté : SÛR
    const bout = jouer(lec(), { langueDecisive: { R1: true, R2: false, R2BIS: false, R4: false, R5: true } }, [vieux, jp, zh]);
    v('(11) de bout en bout : R1 + R5 => 8102 SÛR (code lu concordant)', [bout.issue, idAffirme(bout)], ['affirmee', 8102]);
    vrai('(11)     le résultat dit les règles (R5)', typeof bout.critere === 'string' && /R5/.test(bout.critere));
    // le CAS RÉEL avec l'attaque « Crush » (haute) qui contredit aussi la vraie carte : R1 + R5 laissent 8102 seul, M1 refuse le sûr ; la question garde la réduction de la langue (le chinois part, le set sans numérotation reste)
    const reel = jouer(lec({ attaque: 'Crush', attaqueConfiance: 'haute' }), { langueDecisive: { R1: true, R2: false, R2BIS: false, R4: false, R5: true } }, [vieux, jp, zh]);
    v('(11) cas réel (Crush haute) : pas de sûr, la question à deux (R1 seule)', [reel.issue, montres(reel).sort()], ['question', [8101, 8102]]);
    // la liste figée
    vrai('(11) la liste est figée : gelée, 9 expansions, entiers, noms en clair, sans doublon', Object.isFrozen(LD.SANS_NUMEROTATION) && LD.SANS_NUMEROTATION.length === 9 && LD.SANS_NUMEROTATION.every(x => Number.isInteger(x.idExpansion) && typeof x.nom === 'string' && x.nom) && new Set(LD.SANS_NUMEROTATION.map(x => x.idExpansion)).size === 9);
    vrai('(11)     les sets DP exclus (DP2 4317, DP4d 4308, DP4m 4309, EP08 4306, HRDK 4303) n\'y sont PAS', [4317, 4308, 4309, 4306, 4303].every(id => !LD.SANS_NUMEROTATION.some(x => x.idExpansion === id)));
    // le déclencheur est un numéro au FORMAT COLLECTION : « DPBP#280 » lu seul (numéro 280, aucun total) ne retire jamais le vrai candidat
    const dp = LD.reduire({ ids: [8101, 8102], corps: lec({ numero: '280', total: null }), produits: P, regles: R5 });
    v('(11) un numéro lu SANS total (280, DPBP#) ne déclenche jamais R5', dp.retires, []);
    vrai('(11)     elle contient Darkness-and-to-Light (4509) et Expansion-Pack (4169)', [4509, 4169].every(id => LD.SANS_NUMEROTATION.some(x => x.idExpansion === id)));
}

// ── (12) l'ÉTAT LIVRÉ : R1, R4, R5 allumées ; R2 et R2 bis ÉTEINTES en production (sans ctx.langueDecisive, même avec des scores d'image)
{
    vrai('(12) REGLES gelé, R1 R4 R5 allumées, R2 et R2 bis éteintes', Object.isFrozen(LD.REGLES) && LD.REGLES.R1 === true && LD.REGLES.R4 === true && LD.REGLES.R5 === true && LD.REGLES.R2 === false && LD.REGLES.R2BIS === false);
    const sc = new Map([[7001, 3], [7002, 80], [7003, 4]]);
    const prod = jouer(corps({ lecture: { attaque: null, attaqueConfiance: null } }), { scoresImage: sc });
    v('(12) production (aucun ctx.langueDecisive) avec des scores d\'image qui feraient un sûr : R2 éteinte, R1 seule joue, la question à deux', [prod.issue, montres(prod).sort()], ['question', [7001, 7002]]);
    const bis = LD.reduire({ ids: [7001, 7002], corps: corps({ lecture: { attaque: 'Grind' } }), produits: new Map(TOUT.map(l => [l.idProduct, l])), scoresImage: new Map([[7001, 0], [7002, 90]]) });   // les règles LIVRÉES (aucun argument `regles`)
    v('(12) production : ni R2 bis (attaque concordante) ni R2 (scores) ne retirent 7001 quand on ne passe pas de règles', bis.retires, []);
}

// ── (13) M-B, le câblage du plancher : catalogue.indexCodeNumero passe par construireIndexVerifie (jamais creerIndexCodeNumero nu)
{
    const cat = require('fs').readFileSync(require('path').join(__dirname, '..', 'identifier', 'catalogue.js'), 'utf8');
    vrai('(13) catalogue.js construit l\'index par construireIndexVerifie (plancher) et non par creerIndexCodeNumero', /construireIndexVerifie\(await/.test(cat) && !/creerIndexCodeNumero\(/.test(cat));
}

bilan();
