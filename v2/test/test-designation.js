'use strict';
// Lot DESIGNATION (2026-10-18) — désigner, parmi les candidats d'une QUESTION, le seul que les champs DÉJÀ lus sur la photo satisfont, à 0 faux. Toutes les règles sont ÉTEINTES par défaut.
// Données FABRIQUÉES (aucun identifiant réel, aucun dossier du testeur, aucune base, aucun réseau). Chaque contre-exemple connu y est un cas : numéro lu qui désigne un jumeau non montré,
// numéro juste commun à deux candidats, paire partagée, Dark Tyranitar 143/103 lu 144 avec l'attaque « Crush », Bill CLK / CLL 030/032 (le code seul, interdit).
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter } = require('../identifier/adaptateur');
const DES = require('../identifier/designation');

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
const TOUTES = Object.freeze({ numero: true, numeroTotal: true, total: true, langue: true, nom: true, attaque: true, critereASansAttaque: true, critereASansAttaqueSymbole: true });
const seule = nom => ({ [nom]: true });
const jouer = (corps, lignes, ids, regles, extra = {}) => muet(() => adapter({ statutHttp: 200, corps }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: groupe(ids), critereA: false,
    langueDecisive: { R1: false, R2: false, R2BIS: false, R4: false, R5: false }, codeNumeroExiste: index(), designation: regles, ...extra }));
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct).sort() : []);
const idDe = r => (r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null);

// ── (1) l'état livré : le module existe, toutes les règles sont éteintes, aucune règle « code seul »
{
    vrai('(1) REGLES_DESIGNATION est gelé', Object.isFrozen(DES.REGLES_DESIGNATION));
    vrai('(1) toutes les règles livrées sont ÉTEINTES', Object.values(DES.REGLES_DESIGNATION).every(x => x === false));
    v('(1) les huit règles de la table, sans le code seul', Object.keys(DES.REGLES_DESIGNATION).sort(), ['attaque', 'critereASansAttaque', 'critereASansAttaqueSymbole', 'langue', 'nom', 'numero', 'numeroTotal', 'total']);
    vrai('(1) aucune règle « code » (interdit par construction)', !('code' in DES.REGLES_DESIGNATION) && !Object.keys(DES.REGLES_DESIGNATION).some(k => /^code/i.test(k)));
    const P = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), J = ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100');
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [P, J], [4001, 4002], undefined);
    v('(1) sans ctx.designation : la question d\'avant, inchangée', [r.issue, montres(r)], ['question', [4001, 4002]]);
    const r0 = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [P, J], [4001, 4002], {});
    v('(1) ctx.designation vide : la question d\'avant', [r0.issue, montres(r0)], ['question', [4001, 4002]]);
}

// ── (2) chaque règle désigne le SEUL candidat qui satisfait son champ, tous les autres le contredisent
{
    const IDS = [4001, 4002];
    const P = (ex = {}, tir = 'intl', nom = 'Carte [Un | Deux]') => ligne(4001, nom, 'AAA', '12', '100', tir, ex);
    const cas = (nomRegle, lignes, lecture, extra = {}) => {
        const c = corpsDe({ gagnant: 4001, lecture, vivierIds: IDS, nom: extra.nom || 'Carte' });
        const on = jouer(c, lignes, IDS, seule(nomRegle));
        const off = jouer(c, lignes, IDS, {});
        return [on, off];
    };
    const dit = (nomRegle, [on, off]) => {
        v(`(2) ${nomRegle} : le candidat désigné est AFFIRMÉ`, [on.issue, idDe(on)], ['affirmee', 4001]);
        vrai(`(2) ${nomRegle} :   le résultat porte le nom de la règle`, typeof on.critere === 'string' && on.critere.includes(nomRegle));
        v(`(2) ${nomRegle} :   éteinte, la question d'avant`, [off.issue, montres(off)], ['question', IDS]);
    };
    dit('numero', cas('numero', [P(), ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100')], {}));
    dit('numeroTotal', cas('numeroTotal', [P(), ligne(4002, 'Carte [Un | Deux]', 'AAA', '12', '150')], {}));
    dit('total', cas('total', [P(), ligne(4002, 'Carte [Un | Deux]', 'AAA', '12', '150')], { numero: null }));
    dit('langue', cas('langue', [P(), ligne(4002, 'Carte [Un | Deux]', 'AAA', '12', '100', 'jp')], { langue: 'EN' }));
    dit('nom', cas('nom', [P({}, 'intl', 'Alpha [Un | Deux]'), ligne(4002, 'Beta [Trois | Quatre]', 'AAA', '12', '100')], { numero: null, total: null, setCode: null }, { nom: 'Alpha' }));
    dit('attaque', cas('attaque', [P(), ligne(4002, 'Carte [Trois | Quatre]', 'AAA', '12', '100')], { numero: null, total: null, setCode: null, attaque: 'Un', attaqueConfiance: 'haute' }));
    dit('critereASansAttaque', cas('critereASansAttaque', [P(), ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100')], { attaque: 'Zzz', attaqueConfiance: 'haute' }));
    dit('critereASansAttaqueSymbole', cas('critereASansAttaqueSymbole', [P(), ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100')], { attaque: 'Zzz', attaqueConfiance: 'haute', symboleSet: 'e2' }));
}

// ── (3) les deux variantes « sans veto » ne tolèrent que l'attaque, ou l'attaque et le symbole — et SEULEMENT elles
{
    const IDS = [4001, 4002];
    const L = [ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100')];
    const atk = corpsDe({ gagnant: 4001, lecture: { attaque: 'Zzz', attaqueConfiance: 'haute' }, vivierIds: IDS });
    v('(3) l\'attaque lue contredit le candidat : « numéro » seul se TAIT', jouer(atk, L, IDS, seule('numero')).issue, 'question');
    v('(3)     « sans attaque » désigne', idDe(jouer(atk, L, IDS, seule('critereASansAttaque'))), 4001);
    const sym = corpsDe({ gagnant: 4001, lecture: { symboleSet: 'e2' }, vivierIds: IDS });
    v('(3) le symbole lu contredit le candidat : « sans attaque » se TAIT', jouer(sym, L, IDS, seule('critereASansAttaque')).issue, 'question');
    v('(3)     « sans attaque ni symbole » désigne', idDe(jouer(sym, L, IDS, seule('critereASansAttaqueSymbole'))), 4001);
    const tot = corpsDe({ gagnant: 4001, lecture: { total: '150' }, vivierIds: IDS });
    v('(3) le TOTAL lu contredit le candidat : aucune variante ne désigne', [jouer(tot, L, IDS, seule('critereASansAttaque')).issue, jouer(tot, L, IDS, seule('critereASansAttaqueSymbole')).issue], ['question', 'question']);
}

// ── (4) CONTRE-EXEMPLE : Dark Tyranitar 143/103 lu 144, attaque « Crush » (la variante « attaque tolérée » a été rejetée pour lui). Aucune règle ne désigne, aucune ne fait de faux.
{
    const ZH = ligne(7003, 'Sombre [Grind | Spinning Tail | Bite Off]', 'AAAC', '144', null, 'zh-hans');
    const JP = ligne(7002, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', '103', 'jp');
    const VIEUX = ligne(7001, 'Sombre [Mountain Smasher | Fling Away]', 'CCCN', null, null, 'jp');
    const IDS = [7001, 7002, 7003];
    const lec = { numero: '144', total: '103', setCode: 'XXXP', attaque: 'Crush', attaqueConfiance: 'haute', langue: 'JP' };
    const c = corpsDe({ gagnant: 7003, lecture: lec, vivierIds: IDS, nom: 'Sombre' });
    const r = jouer(c, [ZH, JP, VIEUX], IDS, TOUTES);
    vrai('(4) Dark Tyranitar : toutes les règles allumées, JAMAIS une affirmation', r.issue !== 'affirmee');
    const c2 = corpsDe({ gagnant: 7003, lecture: { ...lec, setCode: 'BBBJ' }, vivierIds: IDS, nom: 'Sombre' });
    const r2 = jouer(c2, [ZH, JP, VIEUX], IDS, TOUTES);
    vrai('(4)     même avec le bon code lu : ZH (n° 144, total inconnu) n\'est pas contredit, jamais une affirmation', r2.issue !== 'affirmee');
}

// ── (4 bis) la même photo, le numéro est MAL LU (143 lu 144) et deux impressions japonaises : seul « Crush » (qui contredit le candidat que le numéro désigne) empêche un faux. C'est ce qu'un veto d'attaque TOLÉRÉ perdrait.
{
    const ZH2 = ligne(7011, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '144', null, 'jp'), JP2 = ligne(7012, 'Sombre [Grind | Spinning Tail | Bite Off]', 'BBBJ', '143', '103', 'jp');
    const c = corpsDe({ gagnant: 7011, lecture: { numero: '144', total: '103', setCode: 'BBBJ', attaque: 'Crush', attaqueConfiance: 'haute', langue: 'JP' }, vivierIds: [7011, 7012], nom: 'Sombre' });
    for (const nom of ['numero', 'numeroTotal', 'total', 'langue', 'nom', 'attaque'])
        vrai(`(4 bis) numéro mal lu (144 pour 143), « Crush » contredit le candidat désigné : « ${nom} » ne désigne jamais`, jouer(c, [ZH2, JP2], [7011, 7012], seule(nom)).issue !== 'affirmee');
}

// ── (5) CONTRE-EXEMPLE : Bill CLK / CLL 030/032 — le code seul est INTERDIT. Seul le code sépare, et il est mal lu (« CLL » pour CLK).
{
    const CLK = ligne(5001, 'Bill [Un | Deux]', 'CLK', '030', '032'), CLL = ligne(5002, 'Bill [Un | Deux]', 'CLL', '030', '032');
    const IDS = [5001, 5002];
    const c = corpsDe({ gagnant: 5001, lecture: { numero: '030', total: '032', setCode: 'CLL' }, vivierIds: IDS, nom: 'Bill' });
    const r = jouer(c, [CLK, CLL], IDS, { ...TOUTES, code: true, codeSeul: true });
    vrai('(5) Bill : code CLL lu, numéro commun : AUCUNE règle (ni un « code seul » demandé) ne désigne', r.issue !== 'affirmee');
    vrai('(5)     la liste des règles n\'a pas de code, même demandée', !('code' in DES.reglesDe({ code: true })) && !('codeSeul' in DES.reglesDe({ codeSeul: true })));
    const c2 = corpsDe({ gagnant: 5001, lecture: { numero: '030', total: '032', setCode: 'CLK' }, vivierIds: IDS, nom: 'Bill' });
    vrai('(5)     même avec le bon code lu : le code seul ne désigne jamais (numéro commun)', jouer(c2, [CLK, CLL], IDS, TOUTES).issue !== 'affirmee');
}

// ── (6) CONTRE-EXEMPLE : un numéro lu juste mais COMMUN à deux candidats ne désigne personne
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'BBB', '12', '100');
    const r = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], seule('numero'));
    v('(6) numéro commun : la question d\'avant', [r.issue, montres(r)], ['question', [4001, 4002]]);
}

// ── (7) CONTRE-EXEMPLE : un numéro lu qui désigne un jumeau NON MONTRÉ — la question de la chaîne ne montre que A et B, A a un jumeau C hors question
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'BBB', '99', '100'), C = ligne(4003, 'Carte [Un | Deux]', 'CCC', '12', '100');
    const f = id => ({ conclu: true, ids: id === 4001 ? [4003] : id === 4003 ? [4001] : [] }); f.partagesDe = () => [];
    const c = corpsDe({ gagnant: 4001, vivierIds: [4001, 4002], ambigu: true, candidats: [4001, 4002] });
    const r = jouer(c, [A, B, C], [4001, 4002], seule('numero'), { jumeaux: f });
    v('(7) le jumeau C de A (même numéro) n\'est pas dans la question : jamais un sûr', [r.issue, montres(r)], ['question', [4001, 4002]]);
    const f2 = id => ({ conclu: true, ids: [] }); f2.partagesDe = () => [];
    const r2 = jouer(c, [A, B, C], [4001, 4002], seule('numero'), { jumeaux: f2 });
    v('(7) témoin : A sans jumeau, B à un autre numéro : A est désigné', idDe(r2), 4001);
    const fm = () => ({ conclu: false, ids: [] }); fm.partagesDe = () => [];
    v('(7) la colonne des jumeaux ne conclut pas : jamais un sûr', jouer(c, [A, B], [4001, 4002], seule('numero'), { jumeaux: fm }).issue, 'question');
}

// ── (8) CONTRE-EXEMPLE : une PAIRE PARTAGÉE (holo / non holo, tampon non séparé) n'est jamais séparée par ces règles
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '12', '150');
    const IDS = [4001, 4002];
    const jp = groupe(IDS, { 4001: [4002], 4002: [4001] });
    const c = corpsDe({ gagnant: 4001, vivierIds: IDS });
    v('(8) paire partagée, le total les sépare : « numéro + total » se TAIT', jouer(c, [A, B], IDS, seule('numeroTotal'), { jumeaux: jp }).issue, 'question');
    v('(8)     témoin : sans le partage, le même cas désigne A', idDe(jouer(c, [A, B], IDS, seule('numeroTotal'))), 4001);
    const sym = groupe(IDS, { 4001: [], 4002: [4001] });
    v('(8) le partage ne se déclare que d\'un côté : refus aussi', jouer(c, [A, B], IDS, seule('numeroTotal'), { jumeaux: sym }).issue, 'question');
}

// ── (9) (d) le champ lu ne désigne aucun produit HORS de la question dans le catalogue entier
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const IDS = [4001, 4002];
    const c = corpsDe({ gagnant: 4001, vivierIds: IDS });
    const cache = ligne(9001, 'Carte [Un | Deux]', 'AAA', '12', '100');                   // même nom, même numéro, même code, hors question : un jumeau que personne ne montre
    const loin = ligne(9002, 'Carte [Un | Deux]', 'AAA', '77', '100');                    // même nom, un autre numéro : le numéro lu le contredit
    v('(9) un produit hors question, même nom et même numéro : le numéro lu le désigne aussi, refus', jouer(c, [A, B], IDS, seule('numero'), { codeNumeroExiste: index(() => [cache]) }).issue, 'question');
    v('(9)     un produit hors question à un AUTRE numéro : contredit, A est désigné', idDe(jouer(c, [A, B], IDS, seule('numero'), { codeNumeroExiste: index(() => [loin]) })), 4001);
    v('(9)     la famille vide : A est désigné', idDe(jouer(c, [A, B], IDS, seule('numero'), { codeNumeroExiste: index(() => []) })), 4001);
    v('(9) index ABSENT (pas de famille) : la règle se ferme', jouer(c, [A, B], IDS, seule('numero'), { codeNumeroExiste: () => false }).issue, 'question');
    v('(9) index absent (aucune fonction) : la règle se ferme', jouer(c, [A, B], IDS, seule('numero'), { codeNumeroExiste: undefined }).issue, 'question');
    v('(9) index tronqué (la famille rend null) : la règle se ferme', jouer(c, [A, B], IDS, seule('numero'), { codeNumeroExiste: index(() => null) }).issue, 'question');
    v('(9) index qui lève : la règle se ferme', jouer(c, [A, B], IDS, seule('numero'), { codeNumeroExiste: index(() => { throw new Error('x'); }) }).issue, 'question');
    // une règle sans le numéro : un homonyme hors question que rien ne contredit la ferme (l'attaque seule ne sépare pas des réimpressions)
    const rep = ligne(9003, 'Carte [Un | Deux]', 'ZZZ', '55', '100');
    const ca = corpsDe({ gagnant: 4001, lecture: { numero: null, total: null, setCode: null, attaque: 'Un', attaqueConfiance: 'haute' }, vivierIds: IDS });
    const A2 = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B2 = ligne(4002, 'Carte [Trois | Quatre]', 'AAA', '99', '100');
    v('(9) attaque seule : une réimpression hors question non contredite la ferme', jouer(ca, [A2, B2], IDS, seule('attaque'), { codeNumeroExiste: index(() => [rep]) }).issue, 'question');
    v('(9)     attaque seule : la famille vide la laisse désigner', idDe(jouer(ca, [A2, B2], IDS, seule('attaque'), { codeNumeroExiste: index(() => []) })), 4001);
}

// ── (10) conditions générales : au moins deux candidats ; la garde contradiction ; la langue du candidat ; une exception n'est jamais une affirmation
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const r1 = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001], ambigu: true, candidats: [4001] }), [A], [4001], seule('numero'));
    v('(10) une confirmation à UN candidat reste une confirmation', [r1.issue, montres(r1)], ['question', [4001]]);
    const contre = corpsDe({ gagnant: 4001, lecture: { total: '150' }, vivierIds: [4001, 4002] });
    vrai('(10) le total lu contredit le candidat : jamais désigné', jouer(contre, [A, B], [4001, 4002], seule('numero')).issue !== 'affirmee');
    const lang = corpsDe({ gagnant: 4001, lecture: { langue: 'JP' }, vivierIds: [4001, 4002] });
    vrai('(10) la langue lue contredit le tirage du candidat : jamais désigné', jouer(lang, [A, B], [4001, 4002], seule('numero')).issue !== 'affirmee');
    const sansBloc = corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }); delete sansBloc.lectureGarde;
    vrai('(10) sans bloc de lecture : jamais désigné', jouer(sansBloc, [A, B], [4001, 4002], seule('numero')).issue !== 'affirmee');
    const mauvaise = jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], seule('numero'), { codeNumeroExiste: index(() => { throw new Error('x'); }) });
    vrai('(10) une exception dans la désignation : la question d\'avant, jamais une affirmation', mauvaise.issue === 'question');
    // une règle inconnue demandée est ignorée ; une valeur autre que `true` n'allume rien
    vrai('(10) « true » seulement allume : "oui" n\'allume rien', jouer(corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), [A, B], [4001, 4002], { numero: 'oui', inconnue: true }).issue === 'question');
}

// ── (11) le module seul : designer() est pur et rend { id, regle, raison } ou null
{
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100'), B = ligne(4002, 'Carte [Un | Deux]', 'AAA', '99', '100');
    const produits = new Map([A, B].map(l => [l.idProduct, l]));
    const d = DES.designer({ ids: [4001, 4002], corps: corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), produits, jumeaux: groupe([4001, 4002]), regles: DES.reglesDe({ numero: true }), catalogueExiste: index() });
    v('(11) designer : le candidat et la règle', d && [d.id, d.regles], [4001, ['numero']]);
    v('(11) designer éteint : null', DES.designer({ ids: [4001, 4002], corps: corpsDe({ gagnant: 4001, vivierIds: [4001, 4002] }), produits, jumeaux: groupe([4001, 4002]), regles: DES.REGLES_DESIGNATION, catalogueExiste: index() }), null);
    v('(11) designer sans rien : null, jamais une exception', DES.designer(), null);
    v('(11) actives() nomme les règles allumées', [DES.actives(DES.REGLES_DESIGNATION), DES.actives(DES.reglesDe({ total: true }))], [[], ['total']]);
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
// ── (13) le chargeur : l'index des familles n'est lu que si une règle est allumée, et voyage sur la fonction de R4 ; une panne ferme sans lever
(async () => {
    const { preparer } = require('../identifier/langue-decisive-charge');
    const lu = [];
    const cat = { indexCodeNumero: async () => ({ existe: () => false }), indexFamilles: async () => { lu.push(1); return DES.creerIndexFamilles([{ idProduct: 1, codeSet: 'AAA', numero: '1' }], Array.from({ length: 1 }, () => ({ idProduct: 1, idMetacard: 1, name: 'X' }))); }, lire: async () => new Map() };
    const A = ligne(4001, 'Carte [Un | Deux]', 'AAA', '12', '100');
    const base = { corpsListe: [], produits: new Map([[4001, A]]), jumeaux: groupe([4001]), catalogue: cat, version: null, deps: { jumeaux: true } };
    const eteint = await muet(() => preparer(base));
    vrai('(13) règles éteintes : l\'index des familles n\'est PAS lu', lu.length === 0 && typeof eteint.codeNumeroExiste === 'function' && eteint.codeNumeroExiste.famille === undefined);
    const allume = await muet(() => preparer({ ...base, designation: { numero: true } }));
    vrai('(13) une règle allumée : l\'index est lu et porté par codeNumeroExiste.famille', lu.length === 1 && typeof allume.codeNumeroExiste.famille === 'function' && allume.codeNumeroExiste.famille(1).length === 0);
    const panne = await muet(() => preparer({ ...base, catalogue: { ...cat, indexFamilles: async () => { throw new Error('x'); } }, designation: { numero: true } }));
    vrai('(13) l\'index des familles en panne : pas de famille, la règle se ferme, aucune exception', typeof panne.codeNumeroExiste === 'function' && panne.codeNumeroExiste.famille === undefined);
    bilan();
})();
