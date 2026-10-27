'use strict';
// MARQUEURS P4 — les deux règles PURES de la route (v2/identifier/garde-marqueurs.js) : le titre « Jumbo » (V2_JUMBO_TITRE) et la garde des groupes (V2_GARDE_MARQUEURS). Aucune base, aucun réseau :
// l'archive, les produits, l'affirmation et la question sont FABRIQUÉS ici. Chaque garde est vue dire NON sur un cas fabriqué avant de lui faire confiance.
const fs = require('fs'), path = require('path');
const H = require('./_harnais');
const MQ = require('../identifier/marqueurs');
const G = require('../identifier/garde-marqueurs');

const el = (type, params = {}) => MQ.valider({ type, params });
const M = {
    jumbo: [el('JUMBO'), el('NON_LEGAL')], staff: [el('STAFF')], normale: [], wcd: [el('WCD', { annee: 2018 }), el('NON_LEGAL')], league: [el('LEAGUE')], place2: [el('PLACE', { rang: 2 })]
};

// ── 1. LE TITRE : liste fermée, mot entier, casse et accents, négation dans les 3 mots qui précèdent
const t = s => { const r = G.lireTitreJumbo(s); return r.oui ? `oui:${r.terme}` : `non:${r.motif}`; };
H.v('1a. un terme de la liste fermée, sans négation : oui (casse et accents indifférents, mot entier)',
    ['Pikachu jumbo', 'PIKACHU JUMBO promo', 'Dracaufeu Oversize', 'carte oversized holo', 'Pikachu XXL', 'Pikachu GÉANT', 'carte géante rare', 'Carte Geante', 'carte geant', 'Jumbo-Pikachu', 'jumbo.', '(jumbo)'].map(t),
    ['oui:jumbo', 'oui:jumbo', 'oui:oversize', 'oui:oversized', 'oui:xxl', 'oui:geant', 'oui:geante', 'oui:geante', 'oui:geant', 'oui:jumbo', 'oui:jumbo', 'oui:jumbo']);
H.v('1b. aucun terme, pas un mot entier, pas un titre : non — l\'absence du mot ne prouve JAMAIS la version normale', ['Pikachu 025/165', 'jumbos', 'jumbo2', 'xxlarge', 'super jumboo', '', '   ', null, undefined, 5, {}].map(t),
    ['non:aucun terme', 'non:aucun terme', 'non:aucun terme', 'non:aucun terme', 'non:aucun terme', 'non:pas de titre', 'non:pas de titre', 'non:pas de titre', 'non:pas de titre', 'non:pas de titre', 'non:pas de titre']);
H.v('1c. une négation dans les 3 mots qui précèdent : non (pas, non, not, no, sans, without, ni ; casse et accents indifférents)',
    ['pas jumbo', 'pas de jumbo', 'non jumbo', 'not a jumbo', 'not oversized', 'no jumbo', 'sans version jumbo', 'without any xxl', 'ni jumbo ni oversize', 'PAS DE VRAIE jumbo'.toUpperCase(), 'Pas de géant'].map(t),
    ['non:négation', 'non:négation', 'non:négation', 'non:négation', 'non:négation', 'non:négation', 'non:négation', 'non:négation', 'non:négation', 'non:négation', 'non:négation']);
H.v('1d. la fenêtre est de 3 mots AVANT et de 2 mots APRÈS : une négation plus loin ne nie pas', ['pas de la belle carte jumbo', 'jumbo en parfait état pas cher', 'jumbo rare holo non abîmée'].map(t), ['oui:jumbo', 'oui:jumbo', 'oui:jumbo']);
H.v('1d2. une négation dans les 2 mots APRÈS le terme nie aussi', ['jumbo pas cher', 'jumbo, pas abîmée', 'Pikachu jumbo ? non', 'jumbo jamais joué', 'oversized sans défaut'].map(t), Array(5).fill('non:négation'));
H.v('1e. un mot de la version normale (normal, normale, standard, regular, classique, classic) n\'importe où dans le titre : non', ['jumbo taille normale', 'Taille Normale ou jumbo ?', 'normal size jumbo', 'jumbo normal size', 'Jumbo or regular size?', 'Lot Pikachu jumbo et normale', 'version normale / jumbo en vente', 'standard et jumbo', 'jumbo classique', 'classic jumbo', 'Jumbo ou Normale'].map(t), Array(11).fill('non:version normale citée'));
H.v('1e2. B1 (relecture) : les contractions et les négations hors de la première liste nient : isn\'t, aren\'t, doesn\'t, never, aucune, aucun, jamais', ['Dracaufeu isn\'t jumbo', 'these aren\'t oversized', 'it doesn’t look jumbo', 'Pikachu never oversized', 'Carte aucune version jumbo', 'aucun jumbo ici', 'jamais jumbo', 'ISN\'T JUMBO'].map(t), Array(8).fill('non:négation'));
H.v('1e3. B1 : les sept titres de la relecture se taisent', ['Dracaufeu isn\'t jumbo', 'Pikachu never oversized', 'Carte standard, aucune version jumbo', 'Pikachu jumbo ? non', 'Jumbo or regular size?', 'Lot Pikachu jumbo et normale', 'version normale / jumbo en vente'].map(s => G.lireTitreJumbo(s).oui), Array(7).fill(false));
H.v('1e4. un titre propre reste affirmé (la règle ne se tait pas partout) : une apostrophe française n\'est pas une contraction', ['Pikachu jumbo holo', 'l\'oversize de Dracaufeu', 'Carte jumbo promo, état neuf'].map(t), ['oui:jumbo', 'oui:oversize', 'oui:jumbo']);
H.v('1f. UNE occurrence niée suffit à se taire (on ne tranche pas un titre qui se contredit)', ['jumbo mais pas jumbo', 'pas jumbo mais oversized'].map(t), ['non:négation', 'non:négation']);

// ── fabriques
const entrees = {}, version = (emprunts = {}, memeFiche = undefined) => ({ entree: id => entrees[id] || null, empruntDe: id => (id in emprunts ? emprunts[id] : null), ...(memeFiche ? { memeFiche } : {}) });
const E = (cle, extra = {}) => ({ vignette: { cle: `v-${cle}` }, grande: { cle: `g-${cle}` }, idMetacard: 7, numero: '5', setNom: 'Set Banc', ...extra });
const affirmee = (id, critere = null) => ({ issue: 'affirmee', analyse: { statut: 'identifiee', cartes: [{ statut: 'identifiee', carte: { idProduct: id }, candidats: [] }] }, ...(critere ? { critere } : {}) });
const question = ids => ({ issue: 'question', analyse: { statut: 'a-trancher', cartes: [{ statut: 'a-trancher', carte: null, candidats: ids.map(idProduct => ({ idProduct })) }] }, question: { choix: ids.map(idProduct => ({ idProduct })) } });
const outils = (marqueurs, extra = {}) => {
    const appels = { affirmer: [], groupe: [], journal: [] };
    return { appels, o: {
        affirmer: (id, surcharge, critere) => { appels.affirmer.push([id, critere]); return affirmee(id, critere); },
        marqueursDe: id => marqueurs[id],
        questionDeGroupe: ids => { appels.groupe.push(ids); return question(ids); },
        journal: (n, e) => appels.journal.push(n), ...extra } };
};
const CFG_JUMBO = { jumboTitre: true, gardeMarqueurs: false }, CFG_GARDE = { jumboTitre: false, gardeMarqueurs: true }, CFG_DEUX = { jumboTitre: true, gardeMarqueurs: true };

// ── 2. LE MÊME DESSIN : visuel commun ET (fiche commune OU emprunt), jamais deviné
entrees[1] = E('a'); entrees[2] = E('a');                                                  // même visuel, même fiche (métacarte, numéro, set)
entrees[3] = E('a', { numero: '6' });                                                      // même visuel, autre numéro
entrees[4] = E('b');                                                                       // autre visuel, même fiche
entrees[5] = E('a', { idMetacard: 8 });                                                    // même visuel, autre métacarte
entrees[6] = E('a', { setNom: 'Autre set' });                                              // même visuel, autre set
entrees[7] = E('a', { numero: null });
entrees[8] = E('x', { vignette: { cle: 'v-a' } });                                         // seule la vignette est commune
H.v('2a. même visuel et même fiche : le même dessin ; il suffit que le fichier de la vignette OU de la grande soit commun', [G.memeDessin(version(), 1, 2), G.memeDessin(version(), 1, 8)], [true, false].map(() => true));
H.v('2b. un autre visuel, un autre numéro, une autre métacarte, un autre set, un numéro absent : PAS le même dessin', [G.memeDessin(version(), 1, 4), G.memeDessin(version(), 1, 3), G.memeDessin(version(), 1, 5), G.memeDessin(version(), 1, 6), G.memeDessin(version(), 1, 7)], Array(5).fill(false));
H.v('2c. l\'emprunt (le visuel de l\'un emprunté à l\'autre) fait le groupe SANS la même fiche — seulement avec avecEmprunt', [G.memeDessin(version({ 3: true }), 1, 3, { avecEmprunt: true }), G.memeDessin(version({ 3: true }), 1, 3), G.memeDessin(version({ 1: true }), 1, 3, { avecEmprunt: true }), G.memeDessin(version({ 3: false }), 1, 3, { avecEmprunt: true }), G.memeDessin(version({ 3: null }), 1, 3, { avecEmprunt: true })], [true, false, true, false, false]);
H.v('2d. la colonne des paires de l\'archive (memeFiche) suffit à dire la même fiche ; elle qui lève ne dit rien', [G.memeDessin(version({}, () => true), 1, 3), G.memeDessin(version({}, () => { throw new Error('x'); }), 1, 3)], [true, false]);
H.v('2e. entrée absente, version illisible : faux (jamais un groupe deviné)', [G.memeDessin(version(), 1, 99), G.memeDessin(null, 1, 2), G.memeDessin({}, 1, 2), G.memeDessin(undefined, 1, 2)], Array(4).fill(false));

// ── 3. L'ÉCART DE MARQUEURS et le signal réel
const ec = (a, b) => { const e = G.ecartMarqueurs(a, b); return [e.different, e.connu, e.types]; };
H.v('3a. deux ensembles connus : l\'écart nomme ses types ; égaux : aucun écart ; un paramètre différent (année) est un écart', [ec(M.staff, M.normale), ec(M.normale, M.normale), ec([el('WCD', { annee: 2018 })], [el('WCD', { annee: 2019 })]), ec(M.jumbo, M.normale)],
    [[true, true, ['STAFF']], [false, true, []], [true, true, ['WCD']], [true, true, ['JUMBO', 'NON_LEGAL']]]);
H.v('3b. inconnu : deux inconnus ne diffèrent pas ; un inconnu contre un connu DIFFÈRE, sans type', [ec(null, null), ec(undefined, null), ec(null, M.normale), ec(M.staff, undefined)], [[false, false, []], [false, false, []], [true, false, []], [true, false, []]]);
const sr = (c, a, b) => G.signalReel(c, G.ecartMarqueurs(a, b));
H.v('3c. un critère « tampon (…) » couvre un écart de seuls types de tampon ; « jumbo (titre) » couvre JUMBO + NON_LEGAL ; rien d\'autre ne couvre rien',
    [sr('tampon (staff) : x', M.staff, M.normale), sr('tampon (league+place-2) : x', [...M.league, ...M.place2], M.normale), sr('tampon (staff) : x', M.jumbo, M.normale), sr('tampon (staff) : x', M.wcd, M.normale), sr(G.critereJumbo('jumbo'), M.jumbo, M.normale), sr(G.critereJumbo('jumbo'), M.staff, M.normale), sr(null, M.staff, M.normale), sr('sur par l\'image : x', M.staff, M.normale), sr('tampon (staff) : x', null, M.normale), sr('désignation : numero', M.staff, M.normale)],
    [true, true, false, false, true, false, false, false, false, false]);
H.v('3d. le critère du jumbo commence par « jumbo (titre) » (le contrat) et nomme le terme', [G.critereJumbo('xxl').startsWith('jumbo (titre)'), G.critereJumbo('xxl').includes('« xxl »'), G.CRITERE_JUMBO], [true, true, 'jumbo (titre)']);

// ── 4. V2_JUMBO_TITRE : exactement un groupe { Jumbo, sans Jumbo }, même fiche, même visuel, titre sans négation
{
    entrees[11] = E('j'); entrees[12] = E('j');                                          // le groupe : 11 normale, 12 jumbo
    entrees[13] = E('k'); entrees[14] = E('j', { numero: '9' });                         // 13 : autre visuel ; 14 : autre fiche
    const mq = { 11: M.normale, 12: M.jumbo, 13: M.normale, 14: M.normale, 15: null, 16: M.jumbo, 17: M.staff, 18: M.jumbo };
    entrees[15] = E('j'); entrees[16] = E('j'); entrees[17] = E('j'); entrees[18] = E('j');
    const v = version();
    const jouer = (cfg, titre, r = question([11, 12]), extra = {}, marqueurs = mq) => { const { appels, o } = outils(marqueurs, extra.outils); const x = G.consulterMarqueurs({ cfg, titre, resultat: r, produits: new Map(), version: extra.version || v, ...o, ...(extra.autres || {}) }); return { x, appels }; };
    const issue = ({ x }) => (x === null ? null : [x.resultat ? `${x.resultat.issue}:${x.resultat.analyse.cartes[0].carte && x.resultat.analyse.cartes[0].carte.idProduct}` : 'question-reste', x.trace && x.trace.issue, x.trace && x.trace.motif]);
    const r1 = jouer(CFG_JUMBO, 'Pikachu jumbo promo');
    H.v('4a. le groupe, un titre « jumbo » sans négation : le produit JUMBO est affirmé, critère « jumbo (titre) », UNE affirmation', [issue(r1), r1.appels.affirmer.length, r1.appels.affirmer[0][0], r1.appels.affirmer[0][1].startsWith('jumbo (titre)'), r1.x.resultat.critere.startsWith('jumbo (titre)')], [['affirmee:12', 'sur', 'terme sans négation'], 1, 12, true, true]);
    H.v('4b. le produit JUMBO est choisi quel que soit l\'ordre des candidats', issue(jouer(CFG_JUMBO, 'xxl', question([12, 11]))), ['affirmee:12', 'sur', 'terme sans négation']);
    H.v('4c. tout le reste LAISSE la question : aucun terme, négation, taille normale, pas de titre — jamais la version normale', ['Pikachu 025', 'pas de jumbo', 'not oversized', 'jumbo taille normale', null, '', 42].map(s => issue(jouer(CFG_JUMBO, s))),
        [['question-reste', 'se-tait', 'aucun terme'], ['question-reste', 'se-tait', 'négation'], ['question-reste', 'se-tait', 'négation'], ['question-reste', 'se-tait', 'version normale citée'], ['question-reste', 'se-tait', 'pas de titre'], ['question-reste', 'se-tait', 'pas de titre'], ['question-reste', 'se-tait', 'pas de titre']]);
    H.v('4d. et il n\'y a AUCUNE affirmation quand le titre se tait (0 appel à affirmer)', ['Pikachu 025', 'pas de jumbo'].map(s => jouer(CFG_JUMBO, s).appels.affirmer.length), [0, 0]);
    H.v('4e. un produit « sans Jumbo » dont les marqueurs sont inconnus (null) est admis dans le groupe ; deux Jumbo, deux sans, ou un Jumbo contre un tampon : pas le cas (rien d\'appelé)',
        [issue(jouer(CFG_JUMBO, 'jumbo', question([15, 16]))), jouer(CFG_JUMBO, 'jumbo', question([16, 18])).x, jouer(CFG_JUMBO, 'jumbo', question([11, 13])).x, jouer(CFG_JUMBO, 'jumbo', question([11, 15])).x],
        [['affirmee:16', 'sur', 'terme sans négation'], null, null, null]);
    H.v('4f. même visuel mais AUTRE fiche, ou autre visuel : le groupe n\'est pas prouvé, la question reste (trace du silence)', [issue(jouer(CFG_JUMBO, 'jumbo', question([12, 14]))), issue(jouer(CFG_JUMBO, 'jumbo', question([12, 13])))], [['question-reste', 'se-tait', 'pas le même dessin (fiche et visuel)'], ['question-reste', 'se-tait', 'pas le même dessin (fiche et visuel)']]);
    H.v('4g. EXACTEMENT deux : trois candidats, un seul, un candidat caché lu par la chaîne (corps.candidats) : rien d\'appelé', [jouer(CFG_JUMBO, 'jumbo', question([11, 12, 15])).x, jouer(CFG_JUMBO, 'jumbo', question([12])).x, jouer(CFG_JUMBO, 'jumbo', question([11, 12]), { autres: { corpsChaine: { candidats: [{ idProduct: 11 }, { idProduct: 12 }, { idProduct: 15 }] } } }).x],
        [null, null, null]);
    H.v('4h. jamais sur un sûr, un refus, une question à motif ou à contradiction, ni quand la règle G a un désaccord ou a influencé', [jouer(CFG_JUMBO, 'jumbo', affirmee(12)).x, jouer(CFG_JUMBO, 'jumbo', { issue: 'introuvable', analyse: { cartes: [{}] } }).x, jouer(CFG_JUMBO, 'jumbo', { ...question([11, 12]), motif: 'jumeaux-trop-nombreux' }).x, jouer(CFG_JUMBO, 'jumbo', { ...question([11, 12]), contradiction: {} }).x,
        jouer(CFG_JUMBO, 'jumbo', question([11, 12]), { autres: { desaccordG: { x: 1 } } }).x, jouer(CFG_JUMBO, 'jumbo', question([11, 12]), { autres: { empreinteInfo: { influence: true } } }).x], Array(6).fill(null));
    H.v('4i. drapeau ÉTEINT (ou absent) : null, aucun appel, même avec le cas parfait', [jouer({ jumboTitre: false, gardeMarqueurs: false }, 'jumbo'), jouer({}, 'jumbo'), jouer(null, 'jumbo'), jouer(undefined, 'jumbo')].map(r => [r.x, r.appels.affirmer.length, r.appels.groupe.length]), Array(4).fill([null, 0, 0]));
    H.v('4j. une affirmation qui ne se construit pas (autre produit, autre issue) ou qui lève : la question reste, jamais une exception',
        [issue(jouer(CFG_JUMBO, 'jumbo', question([11, 12]), { outils: { affirmer: () => question([11, 12]) } })), issue(jouer(CFG_JUMBO, 'jumbo', question([11, 12]), { outils: { affirmer: id => affirmee(11) } })), jouer(CFG_JUMBO, 'jumbo', question([11, 12]), { outils: { affirmer: () => { throw new Error('boum'); } } }).x],
        [['question-reste', 'non-construite', 'l\'affirmation n\'a pas pu être construite'], ['question-reste', 'non-construite', 'l\'affirmation n\'a pas pu être construite'], null]);
    {   // le catalogue ÉCRIT JUMBO (+ NON_LEGAL) avec sa preuve, sans variante `jumbo` : le même Produit servi décide « JUMBO » pour la règle du titre ET pour la garde (une seule lecture : les marqueurs servis)
        const { construireProduit } = require('../identifier/produit');
        const ligne = (id, o = {}) => ({ idProduct: id, nomCardmarket: 'Pikachu', set: { slug: 'Set-Banc', nom: 'Set Banc' }, variante: null, marques: null, ...o });
        const ecrit = [{ type: 'JUMBO' }, { type: 'NON_LEGAL' }];
        const lignes = { 11: ligne(11, { marques: [] }), 12: ligne(12, { marqueurs: ecrit, marqueursPreuve: 'pastille Cardmarket Oversized Card' }), 19: ligne(19, { marqueurs: ecrit }) };
        const servi = id => (lignes[id] ? construireProduit(lignes[id], { langueInterface: 'fr' }).marqueurs : undefined);
        const m = { 11: servi(11), 12: servi(12), 19: servi(19) };
        const { appels, o } = outils(m);
        const x = G.consulterMarqueurs({ cfg: CFG_DEUX, titre: 'Pikachu jumbo', resultat: question([11, 12]), produits: new Map([[11, {}], [12, {}]]), version: v, ...o });
        H.v('4l. un JUMBO ÉCRIT et validé (sans variante jumbo) est un Jumbo pour la règle du titre ET pour la garde ; sans preuve écrite il ne l\'est pas', [m[12].map(e => e.type), m[19], x.resultat.analyse.cartes[0].carte.idProduct, x.trace.garde.issue, appels.affirmer.length],
            [['JUMBO', 'NON_LEGAL'], null, 12, 'sur-confirme', 1]);
        const y = G.consulterMarqueurs({ cfg: CFG_GARDE, titre: null, resultat: affirmee(11, null), produits: new Map([[11, {}], [12, {}]]), version: v, ...outils(m).o });
        H.v('4m. la garde des groupes lit le même Jumbo écrit : le sûr de la normale (11) face au Jumbo (12) de même dessin redevient une question ; pour un visuel différent, pas de groupe', [y.resultat.issue, (() => { const w = { ...entrees }; entrees[12] = E('autre'); const z = G.consulterMarqueurs({ cfg: CFG_GARDE, titre: null, resultat: affirmee(11, null), produits: new Map([[11, {}], [12, {}]]), version: v, ...outils(m).o }); entrees[12] = w[12]; return z; })()], ['question', null]);
    }
    H.v('4k. les marqueurs lus : un produit sans ligne (undefined) des deux côtés ne fait pas de groupe Jumbo', jouer(CFG_JUMBO, 'jumbo', question([11, 12]), {}, {}).x, null);
}

// ── 5. V2_GARDE_MARQUEURS : un sûr avec un rival de groupe redevient la question d'avant, sauf signal réel
{
    entrees[21] = E('g'); entrees[22] = E('g'); entrees[23] = E('g', { numero: '8' }); entrees[24] = E('h'); entrees[25] = E('g'); entrees[26] = E('g');
    const prod = new Map([21, 22, 23, 24].map(i => [i, {}]));            // 25 (inconnu) et 26 (Jumbo) partagent le dessin de 21 : ils n'entrent que quand un cas les nomme
    const marq = { 21: M.staff, 22: M.normale, 23: M.normale, 24: M.normale, 25: null, 26: M.jumbo };
    const jouer = (resultat, { cfg = CFG_GARDE, derniere = null, v = version(), marqueurs = marq, produits = prod, outilsExtra, titre = 'un titre' } = {}) => { const { appels, o } = outils(marqueurs, outilsExtra); const x = G.consulterMarqueurs({ cfg, titre, resultat, derniereQuestion: derniere, produits, version: v, ...o }); return { x, appels }; };
    const lire = ({ x }) => (x === null ? null : [x.resultat ? x.resultat.issue : 'sur-reste', x.trace.garde && x.trace.garde.issue]);
    const Q0 = question([21, 22]);
    H.v('5a. un sûr (critère nul) dont le produit STAFF a un rival de même dessin SANS tampon : la question d\'AVANT revient (la même)', (() => { const r = jouer(affirmee(21), { derniere: Q0 }); return [lire(r), r.x.resultat === Q0, r.x.trace.garde.retour, r.x.trace.garde.rivaux, r.x.trace.garde.bloquants]; })(), [['question', 'question'], true, 'question-d-avant', [22], [22]]);
    H.v('5b. sans question d\'avant (le sûr vient de la chaîne) : la question du GROUPE, le sûr d\'abord puis ses rivaux', (() => { const r = jouer(affirmee(21)); return [lire(r), r.appels.groupe, r.x.trace.garde.retour]; })(), [['question', 'question'], [[21, 22]], 'question-du-groupe']);
    H.v('5b2. I4 : la question d\'avant n\'est rendue que si elle contient le produit ET tous ses rivaux ; une étape tardive (tampon, règle G) a changé de produit, ou la question n\'offre pas le rival : la question du GROUPE (le produit d\'abord, puis ses rivaux)',
        [question([30, 31]), question([21]), question([22, 30]), question([21, 22, 30])].map(q => { const r = jouer(affirmee(21), { derniere: q }); return [r.x.trace.garde.retour, r.x.resultat === q, r.appels.groupe]; }),
        [['question-du-groupe', false, [[21, 22]]], ['question-du-groupe', false, [[21, 22]]], ['question-du-groupe', false, [[21, 22]]], ['question-d-avant', true, []]]);
    H.v('5c. plusieurs rivaux : tous dans la question du groupe, dans l\'ordre des produits connus', jouer(affirmee(21), { produits: new Map([21, 22, 25, 26].map(i => [i, {}])) }).appels.groupe, [[21, 22, 25, 26]]);
    H.v('5d. un critère « tampon (…) » dont l\'écart est un tampon : le sûr RESTE (signal réel), tracé « sur-confirme »', (() => { const r = jouer(affirmee(21, 'tampon (staff) : marques lues'), { derniere: Q0 }); return [r.x.resultat, r.x.trace.garde.issue, r.x.trace.garde.rivaux]; })(), [undefined, 'sur-confirme', [22]]);
    H.v('5e. ce même critère « tampon » ne couvre PAS un écart d\'une autre nature : le Jumbo (26 contre 22), le WCD ; ni un inconnu d\'un côté', [lire(jouer(affirmee(26, 'tampon (staff) : x'), { produits: new Map([[26, {}], [22, {}]]) })), lire(jouer(affirmee(22, 'tampon (staff) : x'), { produits: new Map([[22, {}], [26, {}]]) })), lire(jouer(affirmee(22, 'tampon (staff) : x'), { produits: new Map([[22, {}], [25, {}]]) }))],
        Array(3).fill(['question', 'question']));
    H.v('5f. un critère « jumbo (titre) » couvre l\'écart Jumbo, et lui seul', [lire(jouer(affirmee(26, G.critereJumbo('jumbo')), { produits: new Map([[26, {}], [22, {}]]) })), lire(jouer(affirmee(21, G.critereJumbo('jumbo')), { produits: new Map([[21, {}], [22, {}]]) }))], [['sur-reste', 'sur-confirme'], ['question', 'question']]);
    H.v('5g. tout autre critère (sur par l\'image, désignation, critère A, aucun) ne couvre rien', ['sur par l\'image : x', 'désignation : numero', 'critère A', 'lecture seconde', null].map(c => lire(jouer(affirmee(21, c)))), Array(5).fill(['question', 'question']));
    H.v('5h. pas de rival : un autre numéro (fiche), un autre visuel, un produit hors des produits connus, les mêmes marqueurs : le sûr reste, rien de noté (null)',
        [jouer(affirmee(22), { produits: new Map([[22, {}], [23, {}]]) }).x, jouer(affirmee(22), { produits: new Map([[22, {}], [24, {}]]) }).x, jouer(affirmee(22), { produits: new Map([[22, {}]]) }).x, jouer(affirmee(22), { produits: new Map([[22, {}], [99, {}]]) }).x, jouer(affirmee(22), { marqueurs: { 22: M.normale, 21: M.normale } }).x], Array(5).fill(null));
    H.v('5i. deux inconnus (null / undefined) ne diffèrent pas : le sûr reste ; un inconnu contre un connu : question', [jouer(affirmee(25), { marqueurs: { 25: null, 22: null }, produits: new Map([[25, {}], [22, {}]]) }).x, lire(jouer(affirmee(22), { produits: new Map([[22, {}], [25, {}]]) }))], [null, ['question', 'question']]);
    H.v('5j. l\'EMPRUNT fait le groupe sans la même fiche : un WCD (emprunt) et la carte d\'origine au même visuel ; sans emprunt marqué, pas de groupe', (() => {
        entrees[31] = E('w', { numero: '12', setNom: 'WCD 2018' }); entrees[32] = E('w', { numero: '33', setNom: 'Set d\'origine', idMetacard: 7 });
        const m = { 31: M.wcd, 32: M.normale }, p = new Map([[31, {}], [32, {}]]);
        return [lire(jouer(affirmee(31), { v: version({ 31: true }), marqueurs: m, produits: p })), lire(jouer(affirmee(32), { v: version({ 31: true }), marqueurs: m, produits: p })), jouer(affirmee(31), { v: version({ 31: false }), marqueurs: m, produits: p }).x, jouer(affirmee(31), { v: version({}), marqueurs: m, produits: p }).x];
    })(), [['question', 'question'], ['question', 'question'], null, null]);
    H.v('5k. la question rendue peut n\'être pas une question (plus de 3 produits : introuvable) : elle est rendue telle quelle et tracée', (() => { const r = jouer(affirmee(21), { outilsExtra: { questionDeGroupe: () => ({ issue: 'introuvable', motif: 'jumeaux-trop-nombreux', analyse: { cartes: [{}] } }) } }); return [r.x.resultat.issue, r.x.trace.garde.issueRendue]; })(), ['introuvable', 'introuvable']);
    H.v('5l. drapeau ÉTEINT : le sûr reste, aucune lecture (aucun appel au marqueursDe)', (() => { let lus = 0; const r = jouer(affirmee(21), { cfg: CFG_JUMBO, outilsExtra: {}, marqueurs: new Proxy(marq, { get: (o, k) => { lus++; return o[k]; } }) }); return [r.x, lus]; })(), [null, 0]);
    H.v('5m. jamais sur une question, un refus ni un produit sans ligne ; une version illisible ne fabrique pas de groupe', [jouer(Q0).x, jouer({ issue: 'introuvable', analyse: { cartes: [{}] } }).x, jouer(affirmee(99)).x, jouer(affirmee(21), { v: null }).x, jouer(affirmee(21), { v: {} }).x], Array(5).fill(null));
    H.v('5n. une exception de la garde : la question d\'avant revient quand la route en a une (jamais le sûr en silence), sinon la réponse reste et l\'erreur est journalisée', (() => {
        const piege = { get produitsPiege() { return 1; } };
        const casse = new Proxy(marq, { get: (o, k) => { if (k === '21') throw new Error('boum'); return o[k]; } });
        const a = jouer(affirmee(21), { marqueurs: casse, derniere: Q0 }), b = jouer(affirmee(21), { marqueurs: casse });
        return [a.x.resultat === Q0, a.x.trace.garde.issue, a.appels.journal, b.x, b.appels.journal];
    })(), [true, 'en-erreur', ['garde des marqueurs'], null, ['garde des marqueurs']]);
    // les deux règles ensemble : le titre affirme le Jumbo, la garde reconnaît son critère (signal réel) et le laisse
    const jum = jouer(question([22, 26]), { cfg: CFG_DEUX, titre: 'Pikachu jumbo', produits: new Map([[22, {}], [26, {}]]) });
    H.v('5o. les DEUX drapeaux : un titre « jumbo » affirme le Jumbo (critère « jumbo (titre) »), la garde le laisse (signal réel) ; sans le titre, la question reste', [jum.x.resultat.issue, jum.x.trace.issue, jum.x.trace.garde.issue, jum.x.resultat.critere.startsWith('jumbo (titre)')], ['affirmee', 'sur', 'sur-confirme', true]);
    const sans = (() => { const { appels, o } = outils(marq); return G.consulterMarqueurs({ cfg: CFG_DEUX, titre: 'Pikachu', resultat: question([22, 26]), produits: new Map([[22, {}], [26, {}]]), version: version(), ...o }); })();
    H.v('5p. les DEUX drapeaux, un titre sans terme : la question du Jumbo reste (trace du silence), la garde ne s\'applique pas à une question', [sans.resultat, sans.trace.issue, sans.trace.garde], [undefined, 'se-tait', undefined]);
}

// ── 6. CONTRAT-MARQUEURS §5 : les mots de la liste du contrat sont ceux du code
{
    const contrat = fs.readFileSync(path.join(__dirname, '..', '..', 'CONTRAT-MARQUEURS.md'), 'utf8');
    const section = contrat.split(/^## 5\./m)[1].split(/^## 6\./m)[0];
    H.v('6a. le §5 du contrat cite les termes du titre (jumbo, oversize, XXL, géant) et la négation', [/jumbo, oversize\(d\), XXL, géant\(e\)/.test(section), /pas jumbo/.test(section), /taille normale/.test(section)], [true, true, true]);
    H.v('6b. la liste fermée du code : huit termes, onze négations (+ « n\'t »), six mots de la version normale, fenêtres de 3 avant et 2 après', [G.TERMES_JUMBO.length, G.NEGATIONS.length, G.VERSION_NORMALE.length, G.FENETRE_NEGATION, G.FENETRE_APRES], [8, 11, 6, 3, 2]);
}

H.bilan();
