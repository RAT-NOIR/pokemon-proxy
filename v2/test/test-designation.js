'use strict';
// Lot DESIGNATION (2026-10-18), tour de correction 1 — une SEULE règle, `numero`, ALLUMÉE : elle désigne, parmi les candidats d'une QUESTION, le seul que le numéro déjà lu satisfait, à 0 faux, en gardant le veto de l'attaque.
// Les règles « attaque », « critereASansAttaque », « critereASansAttaqueSymbole » (un faux par construction) et les règles à gain nul sont RETIRÉES DU CODE : ce banc vérifie qu'elles n'existent plus.
// Données FABRIQUÉES (aucun identifiant réel, aucun dossier du testeur, aucune base, aucun réseau). Contre-exemples : Dark Tyranitar 143/103 lu 144 avec « Crush », l'attaque seule qui désigne un rival (CE1 de la relecture),
// Bill CLK / CLL 030/032 (le code seul), un numéro lu qui désigne un jumeau non montré, un numéro commun à deux candidats, une paire partagée, un nom lu contredit.
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');
const DES = require('../identifier/designation');
const LD = require('../identifier/langue-decisive');

const cfg = lireConfig({});
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const ligne = (idProduct, nomCardmarket, code, numero, total, tirageSource = 'intl', extra = {}) => ({ idProduct, nomCardmarket, nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total, setTcgdex: null, langue: null, variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://exemple.invalide/${idProduct}.webp`, w: 255, h: 356 }, tirageSource, ...extra });
const LU = { numero: '12', total: '100', setCode: 'AAA', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false };
function corpsDe({ gagnant, lecture = {}, vivierIds, nom = 'Carte', nomConfiance = 'haute', ambigu = false, candidats } = {}) {
    const l = { ...LU, ...lecture, vivierIds: vivierIds || [gagnant] };
    return { success: true, scanId: 's', question: null,
        carte: { idProduct: gagnant, ambigu, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom, nomBrut: nom, nomConfiance, numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: l.carteTcgdexId, langue: l.langue },
        etat: etatH, candidats: (candidats || [gagnant]).map(idProduct => ({ idProduct })), classement: (candidats || [gagnant]).map(idProduct => ({ idProduct, score: 80 })), reverse: { attendue: false, strategie: null }, codeLangue: 1, lectureGarde: l };
}
// le fournisseur de jumeaux : chaque produit du groupe a pour jumeaux tous les autres ; `partages` : des paires que l'image ne sépare pas
const groupe = (ids, partages = {}) => { const f = id => ({ conclu: true, ids: ids.includes(id) ? ids.filter(i => i !== id) : [], ...(partages[id] ? { partages: partages[id] } : {}) }); f.partagesDe = id => partages[id] || []; return f; };
// l'index du catalogue entier : `famille(id)` rend les lignes de la famille (même nom ou même métacarte) ; vide par défaut
const index = (famille = () => []) => Object.assign(() => false, { famille });
const RETIREES = ['numeroTotal', 'total', 'langue', 'nom', 'attaque', 'critereASansAttaque', 'critereASansAttaqueSymbole'];
const TOUTES = Object.freeze(Object.fromEntries(['numero', ...RETIREES].map(k => [k, true])));
const NUMERO = { numero: true }, ETEINT = { numero: false };
const jouer = (corps, lignes, ids, regles, extra = {}) => muet(() => adapter({ statutHttp: 200, corps }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: groupe(ids), critereA: false,
    langueDecisive: { R1: false, R2: false, R2BIS: false, R4: false, R5: false }, codeNumeroExiste: index(), designation: regles, ...extra }));
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct).sort() : []);
const idDe = r => (r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null);

// ── (1) l'état livré : UNE règle, `numero`, allumée ; les autres n'existent plus ; aucune règle « code seul »
{
    v('(1) REGLES_DESIGNATION : numero seule, allumée', DES.REGLES_DESIGNATION, { numero: true });
    vrai('(1) REGLES_DESIGNATION est gelé', Object.isFrozen(DES.REGLES_DESIGNATION));
    v('(1) les règles retirées ne sont plus demandables (reglesDe les ignore)', Object.keys(DES.reglesDe(TOUTES)), ['numero']);
    vrai('(1) aucune règle « code » (interdit par construction)', !Object.keys(DES.reglesDe({ code: true, codeSeul: true })).some(k => /^code/i.test(k)));
    const P = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), J = ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100');
    const c = corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] });
    const r = jouer(c, [P, J], [4001, 4002], undefined);
    v('(1) sans ctx.designation : l\'état livré désigne (numero allumée)', [r.issue, idDe(r)], ['affirmee', 4001]);
    vrai('(1)     le résultat porte le nom de la règle', typeof r.critere === 'string' && r.critere.includes('numero'));
    const e = jouer(c, [P, J], [4001, 4002], ETEINT);
    v('(1) ctx.designation = { numero: false } : la question d\'avant', [e.issue, montres(e)], ['question', [4001, 4002]]);
    const sans = jouer(c, [P, J], [4001, 4002], undefined, { codeNumeroExiste: () => false });
    v('(1) l\'état livré sans l\'index du catalogue (pas prêt) : la question d\'avant', sans.issue, 'question');
}

// ── (2) `numero` désigne le SEUL candidat dont le numéro concorde, tous les autres le contredisent
{
    const IDS = [4001, 4002];
    const P = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const c = corpsDe({ gagnant: 4001, vivierIds: IDS });
    v('(2) numero : le candidat désigné est AFFIRMÉ', idDe(jouer(c, [P, B], IDS, NUMERO)), 4001);
    const c2 = corpsDe({ gagnant: 4002, lecture: { numero: '99', total: '100' }, vivierIds: IDS });
    v('(2)     la même question, la photo montre l\'autre numéro : l\'autre est désigné', idDe(jouer(c2, [P, B], IDS, NUMERO)), 4002);
    // les règles RETIRÉES, demandées une à une (numéro non lu : seul leur champ parlerait), ne désignent rien
    const T = ligne(4002, 'Carte [Trois | Quatre]', 'AAA', '12', '150');
    const ct = corpsDe({ gagnant: 4001, lecture: { numero: null }, vivierIds: IDS });
    for (const nom of RETIREES) vrai(`(2) « ${nom} » est RETIRÉE : demandée seule, la question reste`, jouer(ct, [P, T], IDS, { numero: false, [nom]: true }).issue === 'question');
}

// ── (3) le veto de l'attaque et du symbole : un champ lu qui contredit le candidat bloque — il n'y a plus de variante qui le tolère
{
    const IDS = [4001, 4002];
    const L = [ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100')];
    const atk = corpsDe({ gagnant: 4001, lecture: { attaque: 'Zzz', attaqueConfiance: 'haute' }, vivierIds: IDS });
    v('(3) l\'attaque lue contredit le candidat : « numero » se TAIT', jouer(atk, L, IDS, NUMERO).issue, 'question');
    v('(3)     … et aucune règle retirée ne le tolère', jouer(atk, L, IDS, TOUTES).issue, 'question');
    const sym = corpsDe({ gagnant: 4001, lecture: { symboleSet: 'e2' }, vivierIds: IDS });
    v('(3) le symbole lu contredit le candidat : « numero » se TAIT', jouer(sym, L, IDS, TOUTES).issue, 'question');
    const tot = corpsDe({ gagnant: 4001, lecture: { total: '150' }, vivierIds: IDS });
    v('(3) le TOTAL lu contredit le candidat : se TAIT', jouer(tot, L, IDS, TOUTES).issue, 'question');
}

// ── (4) CONTRE-EXEMPLE : Dark Tyranitar 143/103 lu 144, attaque « Crush ». Aucune règle ne désigne, aucune ne fait de faux.
{
    const ZH = ligne(7003, 'Sombre [Grind | Spinning Tail | Bite Off]', 'AAAC', '144', null, 'zh-hans');
    const JP = ligne(7002, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', '103', 'jp');
    const VIEUX = ligne(7001, 'Sombre [Mountain Smasher | Fling Away]', 'CCCN', null, null, 'jp');
    const IDS = [7001, 7002, 7003];
    const lec = { numero: '144', total: '103', setCode: 'XXXP', attaque: 'Crush', attaqueConfiance: 'haute', langue: 'JP' };
    vrai('(4) Dark Tyranitar : toutes les règles demandées, JAMAIS une affirmation', jouer(corpsDe({ gagnant: 7003, lecture: lec, vivierIds: IDS, nom: 'Sombre' }), [ZH, JP, VIEUX], IDS, TOUTES).issue !== 'affirmee');
    vrai('(4)     même avec le bon code lu', jouer(corpsDe({ gagnant: 7003, lecture: { ...lec, setCode: 'BBBJ' }, vivierIds: IDS, nom: 'Sombre' }), [ZH, JP, VIEUX], IDS, TOUTES).issue !== 'affirmee');
}
// ── (4 bis) la même photo, le numéro MAL LU (143 lu 144), deux impressions japonaises de même code : seul « Crush » contredit le candidat que le numéro désigne (4011, n° 144 sans total ; la vérité est 4012, n° 143/103)
{
    const A = ligne(4011, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', null, 'jp'), B = ligne(4012, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '143', '103', 'jp');
    const c = corpsDe({ gagnant: 4011, lecture: { numero: '144', total: '103', setCode: 'BBBJ', attaque: 'Crush', attaqueConfiance: 'haute', langue: 'JP' }, vivierIds: [4011, 4012], nom: 'Sombre' });
    for (const [nom, regles] of [['numero (livrée)', NUMERO], ['toutes les règles demandées, retirées comprises', TOUTES]])
        v(`(4 bis) numéro mal lu, « Crush » contredit le candidat que le numéro désigne : ${nom} ne désigne JAMAIS`, jouer(c, [A, B], [4011, 4012], regles).issue, 'question');
    // le veto n'est pas une option : les mêmes données SANS attaque lue sont bien désignées (le témoin de l'attaque est ce qui retient)
    const c0 = corpsDe({ gagnant: 4011, lecture: { numero: '144', total: '103', setCode: 'BBBJ', langue: 'JP' }, vivierIds: [4011, 4012], nom: 'Sombre' });
    v('(4 bis) témoin : sans attaque lue, le numéro désigne 4011 (le veto est bien ce qui retenait)', idDe(jouer(c0, [A, B], [4011, 4012], NUMERO)), 4011);
}
// ── (4 ter) CE1 de la relecture : l'attaque lue est la SEULE donnée (ni numéro, ni total, ni code) et elle désigne un rival (vérité 4002) : jamais une affirmation
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Trois | Quatre]', 'AAA', '99', '100');
    const c = corpsDe({ gagnant: 4001, lecture: { numero: null, total: null, setCode: null, attaque: 'Un', attaqueConfiance: 'haute' }, vivierIds: [4001, 4002] });
    v('(4 ter) attaque lue = celle du rival, rien d\'autre lu : « attaque » (retirée) et « numero » : la question', [jouer(c, [A, B], [4001, 4002], TOUTES).issue, jouer(c, [A, B], [4001, 4002], { numero: false, attaque: true }).issue], ['question', 'question']);
}

// ── (5) CONTRE-EXEMPLE : Bill CLK / CLL 030/032 — le code seul est INTERDIT
{
    const CLK = ligne(5001, 'Bill [Un | Deux]', 'CLK', '030', '032'), CLL = ligne(5002, 'Bill [Un | Deux]', 'CLL', '030', '032');
    const IDS = [5001, 5002];
    const c = corpsDe({ gagnant: 5001, lecture: { numero: '030', total: '032', setCode: 'CLL' }, vivierIds: IDS, nom: 'Bill' });
    vrai('(5) Bill : code CLL lu, numéro commun : AUCUNE règle (ni un « code seul » demandé) ne désigne', jouer(c, [CLK, CLL], IDS, { ...TOUTES, code: true, codeSeul: true }).issue !== 'affirmee');
    const c2 = corpsDe({ gagnant: 5001, lecture: { numero: '030', total: '032', setCode: 'CLK' }, vivierIds: IDS, nom: 'Bill' });
    vrai('(5)     même avec le bon code lu : le code seul ne désigne jamais (numéro commun)', jouer(c2, [CLK, CLL], IDS, TOUTES).issue !== 'affirmee');
}

// ── (6) CONTRE-EXEMPLE : un numéro lu juste mais COMMUN à deux candidats ne désigne personne
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'BBB', '12', '100');
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], NUMERO);
    v('(6) numéro commun : la question d\'avant', [r.issue, montres(r)], ['question', [4001, 4002]]);
}

// ── (7) CONTRE-EXEMPLE : un numéro lu qui désigne un jumeau NON MONTRÉ — la question de la chaîne ne montre que A et B, A a un jumeau C hors question
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100'), C = ligne(4003, 'Carte [Un | Deux]', 'CCC', '12', '100');
    const f = id => ({ conclu: true, ids: id === 4001 ? [4003] : id === 4003 ? [4001] : [] }); f.partagesDe = () => [];
    const c = corpsDe({ gagnant: 4001, vivierIds: [4001, 4002], ambigu: true, candidats: [4001, 4002] });
    const r = jouer(c, [A, B, C], [4001, 4002], NUMERO, { jumeaux: f });
    v('(7) le jumeau C de A (même numéro) n\'est pas dans la question : jamais un sûr', [r.issue, montres(r)], ['question', [4001, 4002]]);
    const f2 = () => ({ conclu: true, ids: [] }); f2.partagesDe = () => [];
    v('(7) témoin : A sans jumeau, B à un autre numéro : A est désigné', idDe(jouer(c, [A, B, C], [4001, 4002], NUMERO, { jumeaux: f2 })), 4001);
    const fm = () => ({ conclu: false, ids: [] }); fm.partagesDe = () => [];
    v('(7) la colonne des jumeaux ne conclut pas : jamais un sûr', jouer(c, [A, B], [4001, 4002], NUMERO, { jumeaux: fm }).issue, 'question');
}

// ── (8) CONTRE-EXEMPLE : une PAIRE PARTAGÉE (holo / non holo, tampon non séparé) n'est jamais séparée, même si le numéro de la ligne la sépare
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const IDS = [4001, 4002];
    const c = corpsDe({ gagnant: 4001, vivierIds: IDS });
    v('(8) paire partagée, le numéro les sépare : « numero » se TAIT', jouer(c, [A, B], IDS, NUMERO, { jumeaux: groupe(IDS, { 4001: [4002], 4002: [4001] }) }).issue, 'question');
    v('(8)     témoin : sans le partage, le même cas désigne A', idDe(jouer(c, [A, B], IDS, NUMERO)), 4001);
    v('(8) le partage ne se déclare que d\'un côté : refus aussi', jouer(c, [A, B], IDS, NUMERO, { jumeaux: groupe(IDS, { 4001: [], 4002: [4001] }) }).issue, 'question');
}

// ── (9) (d) le champ lu ne désigne aucun produit HORS de la question dans le catalogue entier
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const IDS = [4001, 4002];
    const c = corpsDe({ gagnant: 4001, vivierIds: IDS });
    const cache = ligne(9001, 'Carte [Un | Deux]', 'AAA', '12', '100');                   // même nom, même numéro, même code, hors question : un jumeau que personne ne montre
    const loin = ligne(9002, 'Carte [Un | Deux]', 'AAA', '77', '100');                      // même nom, un autre numéro : le numéro lu le contredit
    v('(9) un produit hors question, même nom et même numéro : refus', jouer(c, [A, B], IDS, NUMERO, { codeNumeroExiste: index(() => [cache]) }).issue, 'question');
    v('(9)     un produit hors question à un AUTRE numéro : contredit, A est désigné', idDe(jouer(c, [A, B], IDS, NUMERO, { codeNumeroExiste: index(() => [loin]) })), 4001);
    v('(9)     la famille vide : A est désigné', idDe(jouer(c, [A, B], IDS, NUMERO, { codeNumeroExiste: index(() => []) })), 4001);
    v('(9) index ABSENT (pas de famille) : la règle se ferme', jouer(c, [A, B], IDS, NUMERO, { codeNumeroExiste: () => false }).issue, 'question');
    v('(9) index absent (aucune fonction) : la règle se ferme', jouer(c, [A, B], IDS, NUMERO, { codeNumeroExiste: undefined }).issue, 'question');
    v('(9) index tronqué (la famille rend null) : la règle se ferme', jouer(c, [A, B], IDS, NUMERO, { codeNumeroExiste: index(() => null) }).issue, 'question');
    v('(9) index qui lève : la règle se ferme', jouer(c, [A, B], IDS, NUMERO, { codeNumeroExiste: index(() => { throw new Error('x'); }) }).issue, 'question');
}

// ── (10) conditions générales : au moins deux candidats ; la garde contradiction ; la langue du candidat ; une exception n'est jamais une affirmation
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const r1 = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001], ambigu: true, candidats: [4001] }), [A], [4001], NUMERO);
    v('(10) une confirmation à UN candidat reste une confirmation', [r1.issue, montres(r1)], ['question', [4001]]);
    vrai('(10) le total lu contredit le candidat : jamais désigné', jouer(corpsDe({ gagnant: 4001, lecture: { total: '150' }, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], NUMERO).issue !== 'affirmee');
    vrai('(10) la langue lue contredit le tirage du candidat : jamais désigné', jouer(corpsDe({ gagnant: 4001, lecture: { langue: 'JP' }, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], NUMERO).issue !== 'affirmee');
    const sansBloc = corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }); delete sansBloc.lectureGarde;
    vrai('(10) sans bloc de lecture : jamais désigné', jouer(sansBloc, [A, B], [4001, 4002], NUMERO).issue !== 'affirmee');
    v('(10) une exception dans la désignation : la question d\'avant, jamais une affirmation', jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], NUMERO, { codeNumeroExiste: index(() => { throw new Error('x'); }) }).issue, 'question');
    v('(10) « true » seulement allume : "oui" n\'allume rien', jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], { numero: 'oui' }).issue, 'question');
}

// ── (11) le module seul : designer() est pur et rend { id, regles, critere } ou null
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const produits = new Map([A, B].map(l => [l.idProduct, l]));
    const base = { ids: [4001, 4002], corps: corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), produits, jumeaux: groupe([4001, 4002]), catalogueExiste: index() };
    const d = DES.designer({ ...base, regles: DES.reglesDe({ numero: true }) });
    v('(11) designer : le candidat et la règle', d && [d.id, d.regles], [4001, ['numero']]);
    v('(11) designer éteint : null', DES.designer({ ...base, regles: DES.reglesDe({}) }), null);
    v('(11) designer sans rien : null, jamais une exception', DES.designer(), null);
    v('(11) actives() nomme les règles allumées', [DES.actives(DES.REGLES_DESIGNATION), DES.actives(DES.reglesDe({}))], [['numero'], []]);
}

// ── (12) l'index des familles : même métacarte OU même nom (sans ses attaques), lignes lisibles par `statuts`, total et tirage de l'archive
{
    const num = [{ idProduct: 1, codeSet: 'AAA', numero: '12' }, { idProduct: 2, codeSet: 'BBB', numero: '40' }, { idProduct: 3, codeSet: 'CCC', numeroUrl: 'TG05' }, { idProduct: 4, codeSet: 'DDD', numero: '7' }];
    const prod = [{ idProduct: 1, idMetacard: 10, name: 'Carte [Un | Deux]' }, { idProduct: 2, idMetacard: 10, name: 'Autre nom' }, { idProduct: 3, idMetacard: 11, name: 'carte' }, { idProduct: 4, idMetacard: 12, name: 'Sans rapport' }, { idProduct: 5, idMetacard: 10, name: '' }];
    const idx = DES.creerIndexFamilles(num, prod, () => id => (id === 2 ? { total: '100', tirage: 'jp' } : null));
    v('(12) taille : les produits nommés', idx.taille, 4);
    v('(12) famille de 1 : la même métacarte (2) et le même nom nu (3), jamais lui-même ni 4', idx.famille(1).map(l => l.idProduct).sort(), [2, 3]);
    const l2 = idx.famille(1).find(l => l.idProduct === 2), l3 = idx.famille(1).find(l => l.idProduct === 3);
    v('(12) la ligne porte numéro, code, total et tirage de l\'archive', [l2.numero, l2.set.code, l2.total, l2.tirageSource], ['40', 'BBB', '100', 'jp']);
    v('(12) le numéro d\'URL tient lieu de numéro', l3.numero, 'TG05');
    v('(12) un produit inconnu : null (la règle se ferme)', idx.famille(99), null);
}

// ── (14) M2 : une désignation ne tombe JAMAIS sur un candidat dont le nom lu (confiance haute) est contredit
{
    const A = ligne(4001, 'Alpha [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Beta [Trois | Quatre]', 'AAA', '99', '100');
    const IDS = [4001, 4002];
    const haute = corpsDe({ gagnant: 4001, vivierIds: IDS, nom: 'Beta', nomConfiance: 'haute' });
    v('(14) le numéro désigne Alpha mais le nom lu (haute) est « Beta » : jamais désigné', jouer(haute, [A, B], IDS, NUMERO).issue, 'question');
    const basse = corpsDe({ gagnant: 4001, vivierIds: IDS, nom: 'Beta', nomConfiance: 'basse' });
    v('(14) témoin : nom lu en confiance basse (il ne contredit rien) : Alpha est désigné', idDe(jouer(basse, [A, B], IDS, NUMERO)), 4001);
    const bon = corpsDe({ gagnant: 4001, vivierIds: IDS, nom: 'Alpha', nomConfiance: 'haute' });
    v('(14) témoin : nom lu concordant : Alpha est désigné', idDe(jouer(bon, [A, B], IDS, NUMERO)), 4001);
}

// ── (13) le chargeur : l'index des familles n'est lu que si une règle est allumée ; une panne ferme sans lever ; I3 : le plafond n'abandonne QUE l'extension de la désignation
(async () => {
    const { preparer } = require('../identifier/langue-decisive-charge');
    const lu = [];
    const cat = { indexCodeNumero: async () => ({ existe: () => false }), indexFamilles: async () => { lu.push(1); return DES.creerIndexFamilles([{ idProduct: 1, codeSet: 'AAA', numero: '1' }], [{ idProduct: 1, idMetacard: 1, name: 'X' }]); }, lire: async () => new Map() };
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100');
    const base = { corpsListe: [], produits: new Map([[4001, A]]), jumeaux: groupe([4001]), catalogue: cat, version: null, deps: { jumeaux: true } };
    const eteint = await muet(() => preparer({ ...base, designation: ETEINT }));
    vrai('(13) règle éteinte : l\'index des familles n\'est PAS lu', lu.length === 0 && typeof eteint.codeNumeroExiste === 'function' && eteint.codeNumeroExiste.famille === undefined);
    const allume = await muet(() => preparer(base));
    vrai('(13) l\'état livré (numero allumée) : l\'index est lu et porté par codeNumeroExiste.famille', lu.length === 1 && typeof allume.codeNumeroExiste.famille === 'function' && allume.codeNumeroExiste.famille(1).length === 0);
    const panne = await muet(() => preparer({ ...base, catalogue: { ...cat, indexFamilles: async () => { throw new Error('x'); } } }));
    vrai('(13) l\'index des familles en panne : pas de famille, la règle se ferme, aucune exception', typeof panne.codeNumeroExiste === 'function' && panne.codeNumeroExiste.famille === undefined);

    // I3 : le survivant de LANGUE-DECISIVE (S) a deux jumeaux ; un autre candidat possible de la désignation (D) en a PLAFOND_CHARGE + 1. La préparation propre de LANGUE-DECISIVE ne doit pas être abandonnée.
    const W = ligne(9001, 'Sombre [Grind | Spinning Tail | Bite Off]', 'AAAC', '144', null, 'zh-hans'), S = ligne(9002, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', '103', 'jp');
    const D = { ...ligne(9010, 'Sombre [Autre | Autre2]', 'ZZZ', '144', null, 'id'), set: { slug: 'set-d', nom: 'Set D', code: null } };
    const corps = { success: true, carte: { idProduct: 9001, ambigu: false, nom: 'Sombre', nomBrut: 'わるいバンギラス', nomConfiance: 'haute', numero: '144', total: '103', setCode: 'BBBJ', tcgdexId: null, langue: 'JP' }, candidats: [{ idProduct: 9001 }], classement: [], codeLangue: 7,
        lectureGarde: { numero: '144', total: '103', setCode: 'BBBJ', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: 'JP', totalHorsTailleDeSet: false, vivierIds: [9001, 9002, 9010] } };
    const trop = Array.from({ length: LD.PLAFOND_CHARGE + 1 }, (_, k) => 50000 + k);
    const lues = [];
    const catI3 = { indexCodeNumero: async () => ({ existe: () => false }), indexFamilles: async () => DES.creerIndexFamilles([{ idProduct: 1, codeSet: 'AAA', numero: '1' }], [{ idProduct: 1, idMetacard: 1, name: 'X' }]), plusRecentDansMetacarte: async () => false,
        lire: async ids => { lues.push([...ids]); return new Map(ids.map(id => [id, ligne(id, 'JJJ' + id, String(id), '103', 'jp')])); } };
    const version = { colonneJumeaux: true, jumeauxDe: id => (id === 9002 ? [9101, 9102] : id === 9010 ? trop : []), empreinteJumeaux: () => ({ n: 10, max: 99999 }), metacarteJumeaux: () => 1 };
    const r = await muet(() => preparer({ corpsListe: [corps], produits: new Map([W, S, D].map(l => [l.idProduct, l])), jumeaux: () => ({ conclu: false, ids: [] }), catalogue: catI3, version }));
    vrai('(13) I3 : la désignation dépasse le plafond, LANGUE-DECISIVE garde sa préparation (jumeaux de S conclus et lus)', JSON.stringify(r.jumeaux(9002)) === JSON.stringify({ conclu: true, ids: [9101, 9102] }) && r.produits.has(9101) && r.produits.has(9102));
    vrai('(13) I3 :     l\'extension abandonnée n\'a rien lu de D (aucun de ses jumeaux)', !r.produits.has(50000) && lues.every(l => l.every(i => i < 50000)));
    vrai('(13) I3 :     D ne conclut pas (extension abandonnée, fermé)', r.jumeaux(9010).conclu === false);
    bilan();
})();
