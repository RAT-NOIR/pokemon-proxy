'use strict';
// Lot DESIGNATION-REGLES (2026-10-25) — des règles qui bloquent des cartes DÉJÀ bien lues, relues une à une ; décisions de l'éditeur (2026-10-25) :
//   R1 Persian SM182 / R4 Pheromosa : AUCUN changement de code (R1 se règle à la source, R4 est inchangée) ; ce banc VERROUILLE que les deux restent des questions par défaut (le code lu « UNB » contredit toujours « SM » ;
//      un rival de même numéro contredit seulement par le total et le code n'est pas écarté). Mesuré : assouplir R4 par le total ET le code crée 1 sûr FAUX sur les tamponnées.
//   R2 Drapion VSTAR : non codée (le jumeau PPS3 imprime le MÊME numéro et le même code que l'original ; le catalogue ne porte l'attaque qu'en anglais et en japonais).
//   R3 Sonia : OPTION `ecarteIncomplet`, ÉTEINTE par défaut — un produit sans numéro, sans total et sans entrée d'archive est ignoré par la désignation.
//   R5 : le SEUL candidat restant dans la voie « plus de 3 produits » est montré en QUESTION à un choix (CONFIRMATION_NOMBREUX, allumée par décision de l'éditeur), jamais en affirmation.
// Données FABRIQUÉES (aucun identifiant réel, aucun dossier du testeur, aucune base, aucun réseau).
const { v, vrai, bilan } = require('./_harnais');
const { lireConfig } = require('../config');
const { adapter, CONFIRMATION_NOMBREUX } = require('../identifier/adaptateur');
const DES = require('../identifier/designation');

const cfg = lireConfig({});
const etatH = { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, declareCardmarket: null, retenu: 'EX' };
const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
const ligne = (idProduct, nomCardmarket, code, numero, total, tirageSource = 'intl', extra = {}) => ({ idProduct, nomCardmarket, nomFr: null, set: { slug: 'set-' + code, nom: 'Set ' + code, code }, numero, total, setTcgdex: null, langue: null, variante: null,
    rarete: 'Rare', prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://exemple.invalide/${idProduct}.webp`, w: 255, h: 356 }, tirageSource, ...extra });
const LU = { numero: '12', total: '100', setCode: 'AAA', symboleSet: null, attaque: null, attaqueConfiance: null, carteTcgdexId: null, langue: null, totalHorsTailleDeSet: false };
function corpsDe({ tete, lecture = {}, vivierIds, nom = 'Carte', nomConfiance = 'haute', question } = {}) {
    const l = { ...LU, ...lecture, vivierIds: vivierIds || [tete] }, cands = question || [tete];
    return { success: true, scanId: 's', question: null,
        carte: { idProduct: tete, ambigu: Boolean(question), niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom, nomBrut: nom, nomConfiance, numero: l.numero, total: l.total, setCode: l.setCode, tcgdexId: l.carteTcgdexId, langue: l.langue },
        etat: etatH, candidats: cands.map(idProduct => ({ idProduct })), classement: cands.map(idProduct => ({ idProduct, score: 80 })), reverse: { attendue: false, strategie: null }, codeLangue: 1, lectureGarde: l };
}
const groupe = ids => { const f = id => ({ conclu: true, ids: ids.includes(id) ? ids.filter(i => i !== id) : [] }); f.partagesDe = () => []; return f; };
const index = (famille = () => []) => Object.assign(() => false, { famille });
const OFF = { R1: false, R2: false, R2BIS: false, R4: false, R5: false };
const jouer = (corps, lignes, ids, extra = {}) => muet(() => adapter({ statutHttp: 200, corps }, { produits: new Map(lignes.map(l => [l.idProduct, l])), langueInterface: 'fr', cfg, jumeaux: groupe(ids), critereA: false,
    langueDecisive: OFF, codeNumeroExiste: index(), designation: { numero: true }, ...extra }));
const idDe = r => (r.issue === 'affirmee' ? r.analyse.cartes[0].carte.idProduct : null);
const montres = r => (r.issue === 'question' ? r.analyse.cartes[0].candidats.map(c => c.idProduct).sort((a, b) => a - b) : []);

// ── (1) VERROU R1 : Persian « SM182 », code lu « UNB » (le tampon de l'illustration), rival UNB 148/214 — le code lu contredit « SM » : la question RESTE (corrigé à la source, pas par la règle)
{
    const NOM = 'Persian [Gathering of Cats | Claw Slash]';
    const P = ligne(5201, NOM, 'SM', '182', null), B = ligne(5202, NOM, 'UNB', '148', '214');
    const lec = { numero: 'SM182', total: null, setCode: 'UNB', attaque: 'Claw Slash', attaqueConfiance: 'haute', langue: 'EN', symboleSet: 'promo-etoile' };
    const r = jouer(corpsDe({ tete: 5201, lecture: lec, vivierIds: [5201, 5202], question: [5201, 5202], nom: 'Persian' }), [P, B], [5201, 5202]);
    v('(1) Persian SM182 lu « UNB » : la question d\'avant (le code lu contredit « SM »)', [r.issue, montres(r)], ['question', [5201, 5202]]);
    const ok = jouer(corpsDe({ tete: 5201, lecture: { ...lec, numero: '182', setCode: 'SM' }, vivierIds: [5201, 5202], question: [5201, 5202], nom: 'Persian' }), [P, B], [5201, 5202]);
    v('(1) témoin : numéro « 182 » et code « SM » concordants : Persian SM est désigné', idDe(ok), 5201);
}

// ── (2) VERROU R4 : Pheromosa 001/173 sm12a ; rival sm9b 001/054 (même numéro, total et code différents) ; jumeaux sm9b hors question — la question RESTE
{
    const NOM = 'Pheromosa & Buzzwole GX [Jet Punch | Elegant Sole | Beast Game GX]';
    const X = ligne(5101, NOM, 'sm12a', '001', '173', 'jp'), B = ligne(5102, NOM, 'sm9b', '001', '054', 'jp'), C = ligne(5103, NOM, 'sm9b', '055', '054', 'jp');
    const D = ligne(5104, NOM, 'sm9b', '056', '054', 'jp'), E = ligne(5105, NOM, 'sm9b', '063', '054', 'jp');
    const lec = { numero: '001', total: '173', setCode: 'SM12a', langue: 'JP' };
    const VIV = [5101, 5102, 5103], TOUS = [5101, 5102, 5103, 5104, 5105];
    const r = jouer(corpsDe({ tete: 5101, lecture: lec, vivierIds: VIV, question: VIV, nom: 'Pheromosa' }), [X, B, C, D, E], TOUS);
    v('(2) Pheromosa : le rival de même numéro n\'est pas écarté par le total et le code, deux jumeaux hors question : la question d\'avant', [r.issue, montres(r)], ['question', [5101, 5102, 5103]]);
}

// ── (3) R3 : l'option `ecarteIncomplet` (ÉTEINTE par défaut) — Sonia 192/192 RCL ; le rival PPP n'a ni numéro, ni total, ni entrée d'archive
{
    const X = ligne(5301, 'Sonia', 'RCL', '192', '192'), B = ligne(5302, 'Sonia', 'RCL', '203', '192'), I = ligne(5303, 'Sonia', 'PPP', null, null, null);
    const IDS = [5301, 5302, 5303];
    const corps = (lecture = {}) => corpsDe({ tete: 5301, lecture: { numero: '192', total: '192', setCode: 'RCL', ...lecture }, vivierIds: IDS, question: IDS, nom: 'Sonia' });
    const defaut = jouer(corps(), [X, B, I], IDS);
    v('(3) par défaut : le rival sans numéro ni archive bloque (inconnu n\'est ni contradiction ni concordance) : la question d\'avant', [defaut.issue, montres(defaut)], ['question', IDS]);
    const opt = jouer(corps(), [X, B, I], IDS, { designationAssoupli: { ecarteIncomplet: true } });
    v('(3) option allumée : le produit incomplet est ignoré, Sonia RCL 192 est désignée', [opt.issue, idDe(opt)], ['affirmee', 5301]);
    v('(3) `assouplisDe` : seul true allume ; inconnue ignorée', [DES.assouplisDe({ ecarteIncomplet: 'oui' }), DES.assouplisDe({ inconnue: true }), DES.assouplisDe()], [{ ecarteIncomplet: false }, { ecarteIncomplet: false }, { ecarteIncomplet: false }]);
    const A = ligne(5303, 'Sonia', 'PPP', null, null, 'intl');
    v('(3) un rival sans numéro MAIS avec une entrée d\'archive reste un doute : la question', jouer(corps(), [X, B, A], IDS, { designationAssoupli: { ecarteIncomplet: true } }).issue, 'question');
    const T = ligne(5303, 'Sonia', 'PPP', null, '192', null);
    v('(3) un rival sans numéro MAIS avec un total : la question', jouer(corps(), [X, B, T], IDS, { designationAssoupli: { ecarteIncomplet: true } }).issue, 'question');
    v('(3) option allumée, le total lu contredit X : jamais désigné', jouer(corps({ total: '150' }), [X, B, I], IDS, { designationAssoupli: { ecarteIncomplet: true } }).issue, 'question');
    const B2 = ligne(5302, 'Sonia', 'RCL', '192', '192');
    v('(3) option allumée, un autre rival au même numéro : jamais désigné', jouer(corps(), [X, B2, I], IDS, { designationAssoupli: { ecarteIncomplet: true } }).issue, 'question');
    const CLK = ligne(5401, 'Bill [Un | Deux]', 'CLK', '030', '032'), CLL = ligne(5402, 'Bill [Un | Deux]', 'CLL', '030', '032');
    const bill = jouer(corpsDe({ tete: 5401, lecture: { numero: '030', total: '032', setCode: 'CLL' }, vivierIds: [5401, 5402], question: [5401, 5402], nom: 'Bill' }), [CLK, CLL], [5401, 5402], { designationAssoupli: { ecarteIncomplet: true } });
    v('(3) Bill CLK / CLL, option allumée : aucune affirmation', bill.issue, 'question');
    const G = ligne(5304, 'Sonia', 'PPP', null, null, null), IDSG = [5301, 5302, 5304];
    const cG = corpsDe({ tete: 5301, lecture: { numero: '192', total: '192', setCode: 'RCL' }, vivierIds: IDSG, question: [5301, 5302], nom: 'Sonia' });
    v('(3) jumeau incomplet hors question, par défaut : la question', jouer(cG, [X, B, G], IDSG).issue, 'question');
    v('(3) jumeau incomplet hors question, option allumée : désignée', idDe(jouer(cG, [X, B, G], IDSG, { designationAssoupli: { ecarteIncomplet: true } })), 5301);
    const base = { ids: IDS, corps: corps(), produits: new Map([X, B, I].map(l => [l.idProduct, l])), jumeaux: groupe(IDS), catalogueExiste: index(), regles: DES.reglesDe({ numero: true }) };
    v('(3) designer : null par défaut, le candidat avec l\'option', [DES.designer(base), (DES.designer({ ...base, assoupli: { ecarteIncomplet: true } }) || {}).id], [null, 5301]);
}

// ── (4) R5 : plus de 3 produits, UN seul candidat compatible — la question « est-ce cette carte ? » (CONFIRMATION_NOMBREUX allumée), jamais une affirmation
{
    const P = ligne(5401, 'Roaring Moon ex [Un | Deux]', 'AAA', '700', '100'), J = [5402, 5403, 5404, 5405].map(id => ligne(id, 'Charizard VMAX [Trois | Quatre]', 'BBB', String(id), '100'));
    const corps = () => corpsDe({ tete: 5401, lecture: { numero: '700', total: '100', setCode: 'AAA' }, vivierIds: [5401, 5402, 5403, 5404, 5405], nom: 'Roaring Moon ex' });
    const TOUS = [5401, 5402, 5403, 5404, 5405], SANS = { designation: { numero: false } };
    v('(4) CONFIRMATION_NOMBREUX est allumée (décision de l\'éditeur)', CONFIRMATION_NOMBREUX, true);
    const on = jouer(corps(), [P, ...J], TOUS);
    v('(4) un seul restant : la question à UN candidat, jamais une affirmation', [on.issue, on.analyse.cartes[0].statut, montres(on), on.analyse.cartes[0].carte], ['question', 'a-trancher', [5401], null]);
    vrai('(4)     la question est réservée comme toute question (objet question non nul)', Boolean(on.question));
    const off = jouer(corps(), [P, ...J], TOUS, { confirmationNombreux: false });
    v('(4) interrupteur éteint (ctx) : le contrat d\'avant, introuvable impression-indeterminee / jumeaux-trop-nombreux', [off.issue, off.analyse.cartes[0].raison, off.motif], ['introuvable', 'impression-indeterminee', 'jumeaux-trop-nombreux']);
    v('(4) « true » seulement allume : une valeur autre éteint', jouer(corps(), [P, ...J], TOUS, { confirmationNombreux: 'oui' }).issue, 'introuvable');
    const zero = jouer(corps(), [ligne(5401, 'Klink [Un | Deux]', 'AAA', '700', '100'), ...J], TOUS);
    v('(4) 0 restant : introuvable photo-illisible, comme avant', [zero.issue, zero.analyse.cartes[0].raison], ['introuvable', 'photo-illisible']);
    const deux = jouer(corps(), [P, ligne(5402, 'Roaring Moon ex [Un | Deux]', 'BBB', '701', '100'), ...J.slice(1)], TOUS, SANS);
    v('(4) 2 restants : la question à 2, comme avant', [deux.issue, montres(deux)], ['question', [5401, 5402]]);
    const manque = jouer(corps(), [P, ...J.slice(0, 3)], TOUS);
    v('(4) une ligne de jumeau MANQUE : le repli impression-indeterminee (un jumeau sans ligne pourrait être la vérité)', [manque.issue, manque.analyse.cartes[0].raison], ['introuvable', 'impression-indeterminee']);
    const jum = jouer(corps(), [ligne(5401, 'Klink [Un | Deux]', 'AAA', '700', '100'), ligne(5402, 'Roaring Moon ex [Un | Deux]', 'BBB', '701', '100'), ...J.slice(1)], TOUS, SANS);
    v('(4) P contredit et UN jumeau compatible : la question à ce jumeau', [jum.issue, montres(jum)], ['question', [5402]]);
}
bilan();
