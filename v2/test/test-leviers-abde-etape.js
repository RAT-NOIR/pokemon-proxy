'use strict';
// LEVIERS-ABDE (ordre n°17) — l'ÉTAPE de la route (identifier/leviers-abde.js::appliquerLeviers), de bout en bout sur un monde FABRIQUÉ : un index d'empreintes factice (cosinus choisis), une archive factice, un catalogue factice,
// la VRAIE construction d'une question (adaptateur), les VRAIES gardes (garde-contradiction, groupe, prix). Aucune base, aucun réseau, aucun appel payant. Chaque levier a son cas ROUGE (le banc de mutation, test-leviers-abde-mutation.js,
// casse chaque garde et exige qu'un cas ici échoue).
const H = require('./_harnais');
const { lireConfig } = require('../config');
const { encoderVecteur } = require('../identifier/empreinte-vecteur');
const { questionParLaRoute } = require('../identifier/adaptateur');
const { consulterProbable, avecNiveau } = require('../identifier/probable-route');
const L = require('../identifier/leviers-abde');

const MODELE = { id: 'p8000-banc', sha256: 'b'.repeat(64) };
const cfgBase = { ...lireConfig({}), probable: true, leviersAbde: true, leviersEcart: 0.1, empreinteExtension: true, modeleEmpreinte: MODELE };
const VEC = Float32Array.from({ length: 256 }, () => 1 / 16);        // norme 1, |x| <= 0,5

// ── le monde : des produits d'un set, la lecture « n°86 / 115, UF », un index où chaque produit a son visuel (clé k<id>) et son cosinus
const ligne = (id, o = {}) => ({ idProduct: id, nomCardmarket: o.nom || 'Mary\'s Request', nomFr: o.nomFr ?? null, set: { slug: 'ufo', nom: 'Unseen Forces', code: o.code ?? 'UF' }, numero: o.numero === undefined ? '86' : o.numero, total: o.total === undefined ? '115' : o.total,
    langue: 'FR', variante: null, rarete: 'Rare', setTcgdex: null, tirageSource: 'intl', prixGuide: o.sansPrix ? null : { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://pub.example/${id}.webp`, w: 255, h: 356 } });
function monde({ cos, lignes, vivier = [], base = [], redressee = true, ext = '2.0.1', groupes = [], leviers = true, sansVisuel = [] } = {}) {
    const ids = Object.keys(cos).map(Number).filter(i => !sansVisuel.includes(i));
    const cleDe = id => `k${(groupes.find(g => g.includes(id)) || [id])[0]}`;      // un groupe partage UN visuel
    const entrees = new Map(ids.map(id => [id, { idProduct: id, grande: { cle: cleDe(id) }, vignette: { cle: cleDe(id) + 'v' }, idMetacard: groupes.some(g => g.includes(id)) ? 77 : id, numero: '86', setNom: 'Unseen Forces', mention: null }]));
    const version = { entree: id => entrees.get(id) || null, identifiants: () => [...entrees.keys()] };
    const parCle = {}; for (const id of ids) parCle[cleDe(id)] = Math.max(parCle[cleDe(id)] ?? -1, cos[id]);
    const index = { voisins: (q, n) => { const top = Object.entries(parCle).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => [k, c]); return { top, meilleur: top[0][1] }; }, similarites: (q, cles) => cles.map(k => parCle[k] ?? 0) };
    const etat = { courante: () => ({ index, meta: { modele: MODELE } }) };
    const produits = new Map(Object.entries(lignes).map(([id, l]) => [Number(id), l]));
    const cfg = { ...cfgBase, leviersAbde: leviers };
    const corps = { success: true, carte: { idProduct: base[0], ambigu: true, nom: 'Mary\'s Request', nomBrut: 'Mary\'s Request', nomConfiance: 'haute', numero: '86', total: '115', setCode: 'UF', langue: 'FR' }, lectureGarde: { numero: '86', total: '115', setCode: 'UF', vivierIds: vivier },
        etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' }, candidats: base.map(idProduct => ({ idProduct })), classement: [], reverse: { attendue: false, strategie: null }, codeLangue: 2 };
    const ctxQuestion = { langueInterface: 'fr', cfg, ficheServie: false, jumeaux: () => ({ conclu: true, ids: [] }) };
    const resultat = questionParLaRoute(corps, base, { ...ctxQuestion, produits });
    const entree = { versionExtension: ext, empreintes: { modele: MODELE, rejet: null, entrees: [{ photo: 0, vecteur: encoderVecteur(VEC), redressee, carte: null }] } };
    const lues = [];
    const catalogue = { lire: async ids => { lues.push([...ids]); return new Map(ids.filter(i => lignes[i]).map(i => [i, lignes[i]])); }, indexAliasFrSansAttente: () => new Map() };
    return { cfg, corps, ctxQuestion, resultat, entree, version, etat, produits, catalogue, lues };
}
const ids = r => r.analyse.cartes[0].candidats.map(x => x.idProduct).sort((a, b) => a - b);
const lancer = (m, plus = {}) => { const diag = {}; return appliquerLeviersDe(m, plus, diag).then(r => ({ r, diag })); };
const appliquerLeviersDe = (m, plus, diag) => L.appliquerLeviers({ cfg: m.cfg, entree: m.entree, resultat: m.resultat, corpsChaine: m.corps, produits: m.produits, version: m.version, traceMarqueurs: null, catalogue: m.catalogue, ctxQuestion: m.ctxQuestion, etat: m.etat, diag, ...plus });

// Le décor commun. 1 = la VRAIE carte (n°86, 115 : deux champs concordent), 2 et 3 = les candidats de la chaîne (autres numéros : contredits par la lecture), 4 = un autre rival.
// Cosinus : 2 est le plus proche de la photo (0,60), la vérité 1 est à 0,40 mais ses deux champs concordent : c3(1) = 0,40 + 0,10 = 0,50 ; c3(2) = 0,60 - 0,50 = 0,10.
const LIGNES = { 1: ligne(1), 2: ligne(2, { numero: '12', total: '99' }), 3: ligne(3, { numero: '14', total: '99' }), 4: ligne(4, { numero: '15', total: '99' }) };
const COS = { 1: 0.40, 2: 0.60, 3: 0.35, 4: 0.30 };

(async () => {
    // ── a : la vérité n'est PAS dans la question de la chaîne ; elle est dans le vivier de la lecture : elle entre au pool, devient le probable, la question suit le classement
    {
        const m = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] });
        const { r, diag } = await lancer(m);
        H.v('a+b : la vérité du VIVIER entre au pool et devient le probable (écart c3 0,5 - 0,35 >= 0,1, aucun champ ne la contredit)', [r && r.probable && r.probable.idProduct, r && r.probable && r.probable.signal, diag.raison], [1, 'A', 'probable']);
        H.v('le signal journalisé reste `A` (les outils qui trient par A / G le voient), le levier est dit à part', [r.probable.signal, r.probable.levier], ['A', 'abde']);
        H.v('a : la question suit le classement c3 (les 3 premiers), la vérité en fait partie', [ids(r.resultat).includes(1), ids(r.resultat).length], [true, 3]);
        const sans = await consulterProbable({ cfg: { ...m.cfg, probableCosinusMin: 0 , probableVecteurExige: false }, entree: m.entree, resultat: m.resultat, corpsChaine: m.corps, produits: m.produits, version: m.version, etat: m.etat });
        H.vrai('contrôle : la règle d\'AVANT (consulterProbable) ne peut pas désigner 1 (absente de la question de la chaîne)', !sans || sans.idProduct !== 1);
        const niv = avecNiveau(r.resultat.analyse, r.probable);
        H.v('un probable porte `à confirmer`, son prix et sa fiabilité de prix (avecNiveau)', [niv.cartes[0].niveau, niv.cartes[0].probable, niv.cartes[0].candidats.find(c => c.idProduct === 1).prixGuide !== null], ['probable', { idProduct: 1, aConfirmer: true }, true]);
    }
    // ── la lecture charge ce qui manque : les lignes des produits du pool qui n'étaient pas lues, UNE lecture
    {
        const m = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] }); m.produits.delete(1);
        await lancer(m);
        H.v('les lignes manquantes du pool sont lues en UNE fois, et seulement elles', [m.lues.length, m.lues[0].includes(1), m.lues[0].includes(2)], [1, true, false]);
        const mp = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] }); mp.produits.delete(1); mp.catalogue.lire = async () => { throw new Error('base en panne'); };
        const av = L.echecs();
        const { r, diag } = await lancer(mp);
        H.v('une lecture du catalogue qui ÉCHOUE laisse la question d\'avant (null), sans lever', [r, diag.raison], [null, 'catalogue-en-panne']);
        H.v('   et l\'échec est COMPTÉ et journalisé (production)', (L.echecs()['catalogue-en-panne'] || 0) - (av['catalogue-en-panne'] || 0), 1);
        // une exception inattendue du levier : jamais avalée sans trace
        const me = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] });
        me.catalogue.indexAliasFrSansAttente = () => Object.assign(new Map(), { has() { throw new TypeError('bug de banc'); } });
        me.corps.carte.nom = 'Etiquette d Erika';
        const av2 = L.echecs(), ex = await lancer(me);
        H.v('une EXCEPTION inattendue : null (la question d\'avant), comptée et journalisée, sans le message de l\'exception', [ex.r, ex.diag.raison, (L.echecs().erreur || 0) - (av2.erreur || 0)], [null, 'erreur', 1]);
    }
    // ── b : l'écart minimal ; un champ lu qui contredit le premier interdit le probable
    {
        // un rival 5 qui concorde aussi (numéro et total) : c3(5) = 0,45 + 0,10 = 0,55 ; c3(1) = 0,40 + 0,10 = 0,50 ; écart 0,05
        const L5 = { ...LIGNES, 5: ligne(5) }, C5 = { ...COS, 5: 0.45 };
        const m = monde({ cos: C5, lignes: L5, base: [2, 3], vivier: [1, 5] });
        const { r } = await lancer(m);
        H.v('b : écart c3 de 0,05 < 0,1 => PAS de probable (la question suit quand même le classement)', [r && r.probable, r && ids(r.resultat).includes(1) && ids(r.resultat).includes(5)], [null, true]);
        const m2 = monde({ cos: C5, lignes: L5, base: [2, 3], vivier: [1, 5] }); m2.cfg.leviersEcart = 0.04;
        const x = await lancer(m2);
        H.v('b : l\'écart se règle (V2_LEVIERS_ECART) : 0,04 => probable (5, le meilleur)', x.r && x.r.probable && x.r.probable.idProduct, 5);
        const lc = { ...LIGNES, 1: ligne(1, { numero: '86', total: '99' }) };                                  // 1 concorde sur le numéro, MAIS le total est contredit : ko = 1
        const m3 = monde({ cos: COS, lignes: lc, base: [2, 3], vivier: [1] });
        const y = await lancer(m3);
        H.v('b : le premier est CONTREDIT par un champ lu (total) : jamais un probable, même avec un grand écart', y.r === null || y.r.probable === null, true);
    }
    // ── a : le tri du pool par c3 garde la vérité que le tri au cosinus coupait (la partie A)
    {
        const cos = {}, lignes = { 1: ligne(1) }; cos[1] = 0.25;
        for (let i = 10; i < 22; i++) { cos[i] = 0.55 - (i - 10) * 0.01; lignes[i] = ligne(i, { numero: '12', total: '99' }); }
        const m = monde({ cos, lignes, base: [10, 11], vivier: [1] });
        const pool = (() => { const d = {}; return d; })();
        const { r, diag } = await lancer(m);
        H.v('a : la vérité (cosinus 0,25 mais deux champs concordants) survit à la coupe à 10 grâce au tri c3 : elle est désignée', [r && r.probable && r.probable.idProduct, diag.raison], [1, 'probable']);
    }
    // ── d : l'alias français fait entrer au pool une carte que ni la chaîne ni le vivier ne portent
    {
        const lignes = { ...LIGNES, 1: ligne(1, { nomFr: 'Étiquette d\'Erika' }) };
        const m = monde({ cos: COS, lignes, base: [2, 3], vivier: [] });
        m.corps.carte.nom = 'Etiquette d Erika'; m.corps.carte.nomBrut = null;
        m.catalogue.indexAliasFrSansAttente = () => L.construireIndexAlias([{ idProduct: 1, nomFr: 'Étiquette d\'Erika' }, { idProduct: 2, nomFr: 'Autre nom' }]);
        const m0 = monde({ cos: COS, lignes, base: [2, 3], vivier: [] }); m0.corps.carte.nom = 'Etiquette d Erika'; m0.corps.carte.nomBrut = null;
        // le visuel de 1 est dans l'index mais hors du top 10 de l'empreinte : on le retire des voisins en le rendant lointain
        const loin = { ...COS }; for (let i = 100; i < 112; i++) { loin[i] = 0.70 - (i - 100) * 0.001; lignes[i] = ligne(i, { numero: '12', total: '99' }); }
        const ma = monde({ cos: loin, lignes, base: [2, 3], vivier: [] }); ma.corps.carte.nom = 'Etiquette d Erika'; ma.corps.carte.nomBrut = null;
        const mb = monde({ cos: loin, lignes, base: [2, 3], vivier: [] }); mb.corps.carte.nom = 'Etiquette d Erika'; mb.corps.carte.nomBrut = null;
        ma.catalogue.indexAliasFrSansAttente = () => L.construireIndexAlias([{ idProduct: 1, nomFr: 'Étiquette d\'Erika' }]);
        const sans = await lancer(mb), avec = await lancer(ma);
        H.v('d : sans l\'alias, la vérité (hors vivier, hors top 10 de l\'empreinte) n\'est pas candidate ; avec l\'alias nomFr = le nom lu, elle est désignée', [Boolean(sans.r && sans.r.probable && sans.r.probable.idProduct === 1), avec.r && avec.r.probable && avec.r.probable.idProduct], [false, 1]);
        const mc = monde({ cos: loin, lignes, base: [2, 3], vivier: [] }); mc.corps.carte.nom = 'Etiquette d Erika'; mc.corps.carte.nomBrut = null; mc.catalogue.indexAliasFrSansAttente = () => { throw new Error('index en panne'); };
        const avant = L.echecs();
        const z = await lancer(mc);
        H.v('d : un index d\'alias EN PANNE échoue FERMÉ : aucun probable, la question d\'avant reste (null), la cause est dite', [z.r, z.diag.raison], [null, 'alias-indisponible']);
        H.v('   et l\'échec est COMPTÉ (journalisé en production, pas seulement dans diag)', (L.echecs()['alias-indisponible'] || 0) - (avant['alias-indisponible'] || 0), 1);
        const mn = monde({ cos: loin, lignes, base: [2, 3], vivier: [] }); mn.corps.carte.nom = 'Etiquette d Erika'; mn.corps.carte.nomBrut = null; mn.catalogue.indexAliasFrSansAttente = () => null;
        const nonPret = await lancer(mn);
        H.v('d : un index d\'alias PAS ENCORE PRÊT (démarrage, construction en cours) : aucun probable, la question reste, aucune attente dans le scan', [nonPret.r, nonPret.diag.raison], [null, 'alias-non-pret']);
        const ma2 = monde({ cos: loin, lignes, base: [2, 3], vivier: [] }); delete ma2.catalogue.indexAliasFrSansAttente;
        const absent = await lancer(ma2);
        H.v('d : un catalogue SANS index d\'alias : aucun probable (jamais un repli vide qui fabrique une marge)', [absent.r, absent.diag.raison], [null, 'alias-absent']);
        // le plafond de l'éventail : 30 produits portent ce nom français, 20 seulement entrent au pool, et la coupe est écrite
        const gros = L.construireIndexAlias(Array.from({ length: 30 }, (_, i) => ({ idProduct: 3000 + i, nomFr: 'Etiquette d Erika' })));
        const lg2 = { ...lignes }; for (let i = 3000; i < 3030; i++) lg2[i] = ligne(i, { numero: '12', total: '99' });
        const mg = monde({ cos: loin, lignes: lg2, base: [2, 3], vivier: [] }); mg.corps.carte.nom = 'Etiquette d Erika'; mg.corps.carte.nomBrut = null; mg.catalogue.indexAliasFrSansAttente = () => gros;
        const cg = await lancer(mg);
        H.v('d : l\'éventail d\'alias est plafonné à 20 par nom lu, et ce qui est coupé est ÉCRIT', [cg.diag.aliasIds.length, cg.diag.aliasCoupes && cg.diag.aliasCoupes[0].total, cg.diag.aliasCoupes && cg.diag.aliasCoupes[0].gardes], [20, 30, 20]);
    }
    // ── les portes : tout le reste rend null et le DIT
    {
        const base = () => monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] });
        const ok = await lancer(base());
        H.vrai('témoin : le monde de base donne bien un probable', ok.r && ok.r.probable && ok.r.probable.idProduct === 1);
        const eteint = base(); eteint.cfg.leviersAbde = false;
        H.v('drapeau éteint => null (inactif)', [(await lancer(eteint)).r, (await lancer(eteint)).diag.raison], [null, 'inactif']);
        const sansProbable = base(); sansProbable.cfg.probable = false;
        H.v('V2_PROBABLE éteint => null (le niveau n\'est pas servi)', (await lancer(sansProbable)).r, null);
        const vieille = base(); vieille.entree.versionExtension = '2.0.0';
        H.v('extension < 2.0.1 => null', (await lancer(vieille)).r, null);
        const nonRedressee = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1], redressee: false });
        H.v('photo non redressée => null (aucun cosinus fiable)', [(await lancer(nonRedressee)).r, (await lancer(nonRedressee)).diag.raison], [null, 'non-redressee']);
        const sansEmpreinte = base(); sansEmpreinte.entree.empreintes = null;
        H.v('sans vecteur => null', [(await lancer(sansEmpreinte)).r, (await lancer(sansEmpreinte)).diag.raison], [null, 'sans-vecteur']);
        const sur = base(); sur.resultat = { ...sur.resultat, issue: 'affirmee' };
        H.v('UN SÛR ne change jamais (issue affirmee) => null', [(await lancer(sur)).r, (await lancer(sur)).diag.raison], [null, 'pas-une-question']);
        const identifiee = base(); identifiee.resultat = { ...identifiee.resultat, analyse: { ...identifiee.resultat.analyse, cartes: [{ ...identifiee.resultat.analyse.cartes[0], statut: 'identifiee' }] } };
        H.v('une carte déjà identifiée (statut) ne change jamais, même sous une issue « question » mal formée => null', [(await lancer(identifiee)).r, (await lancer(identifiee)).diag.raison], [null, 'pas-une-question']);
        const intro = base(); intro.resultat = { issue: 'introuvable', analyse: { cartes: [{ statut: 'introuvable' }] } };
        H.v('un introuvable ne change pas (e agit dans l\'adaptateur, jamais ici)', (await lancer(intro)).r, null);
        const groupe = await lancer(base(), { traceMarqueurs: { garde: { issue: 'question' } } });
        H.v('une question de GROUPE (marqueurs) reste intacte : null', [groupe.r, groupe.diag.raison], [null, 'groupe-marqueurs']);
        const jumbo = await lancer(base(), { traceMarqueurs: { regle: 'jumbo-titre' } });
        H.v('une question tranchée par le titre jumbo reste intacte : null', jumbo.r, null);
        const lot = base(); lot.resultat = { ...lot.resultat, analyse: { ...lot.resultat.analyse, cartes: [lot.resultat.analyse.cartes[0], lot.resultat.analyse.cartes[0]] } };
        H.v('plus d\'une carte (un lot) => null', (await lancer(lot)).r, null);
    }
    // ── I2 : un probable sans prix de guide n'est jamais servi ; I3 : un désigné de MÊME DESSIN qu'un autre des 3 non plus ; la question, elle, suit
    {
        const sp = { ...LIGNES, 1: ligne(1, { sansPrix: true }) };
        const a = await lancer(monde({ cos: COS, lignes: sp, base: [2, 3], vivier: [1] }));
        H.v('I2 : le désigné n\'a pas de prix de guide => pas de probable, la question suit', [a.r && a.r.probable, a.r && ids(a.r.resultat).includes(1), a.diag.raison], [null, true, 'sans-prix']);
        const g = await lancer(monde({ cos: { ...COS, 4: 0.40 }, lignes: LIGNES, base: [2, 3], vivier: [1, 4], groupes: [[1, 4]] }));
        H.v('I3 : le désigné partage son visuel et sa fiche avec un autre des 3 (même dessin) => pas de probable', [g.r && g.r.probable, g.diag.raison], [null, 'groupe-donnees']);
    }
    // ── un seul candidat classable, ou une ligne manquante : la question d'avant, jamais une panne
    {
        const seul = await lancer(monde({ cos: { 2: 0.6, 9: 0.5 }, lignes: { ...LIGNES, 9: ligne(9) }, base: [2, 9], vivier: [], sansVisuel: [9] }));
        H.v('un seul candidat CLASSABLE (l\'autre sans visuel comparable) => null, jamais un probable', [seul.r, seul.diag.raison], [null, 'moins-de-deux-classes']);
        const un = await lancer(monde({ cos: { 2: 0.6 }, lignes: LIGNES, base: [2], vivier: [] }));
        H.v('une confirmation à UN candidat et un pool d\'un seul produit => null (pool trop petit)', [un.r, un.diag.raison], [null, 'pool-trop-petit']);
        const conf = await lancer(monde({ cos: { 1: 0.4, 2: 0.6 }, lignes: LIGNES, base: [2], vivier: [] }));
        H.v('une confirmation à UN candidat (« est-ce cette carte ? ») n\'est JAMAIS un probable (probable-route.js:95) ; la question, elle, suit le classement (la vérité du pool y entre)', [conf.r && conf.r.probable, conf.r && ids(conf.r.resultat).includes(1), conf.diag.raison], [null, true, 'un-candidat']);
        const avecMotif = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] }); avecMotif.resultat = { ...avecMotif.resultat, motif: 'jumeaux-trop-nombreux' };
        H.v('une question qui porte un MOTIF de refus n\'est jamais travaillée (probable-route.js:91) : null', [(await lancer(avecMotif)).r, (await lancer(avecMotif)).diag.raison], [null, 'motif-ou-contradiction']);
        const avecContradiction = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] }); avecContradiction.resultat = { ...avecContradiction.resultat, contradiction: 'contredit par numero' };
        H.v('une question qui porte une CONTRADICTION n\'est jamais travaillée (probable-route.js:91) : null', [(await lancer(avecContradiction)).r, (await lancer(avecContradiction)).diag.raison], [null, 'motif-ou-contradiction']);
        const ml = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] }); delete ml.catalogue.lire; ml.produits.delete(1);
        H.v('une ligne à lire et pas de catalogue => null (sans-catalogue), sans lever', (await lancer(ml)).diag.raison, 'sans-catalogue');
        const sl = monde({ cos: COS, lignes: { 2: LIGNES[2], 3: LIGNES[3], 4: LIGNES[4] }, base: [2, 3], vivier: [1] });
        const rsl = await lancer(sl);
        H.v('un produit SANS ligne de catalogue (innommable) n\'entre jamais au pool : ni candidat, ni probable, ni créneau pris ; jamais une panne', [rsl.diag.T.includes(1), Boolean(rsl.r && rsl.r.probable && rsl.r.probable.idProduct === 1), Boolean(rsl.r && rsl.r.resultat && ids(rsl.r.resultat).includes(1))], [false, false, false]);
        const vivSansLigne = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [900, 901, 902, 903, 904, 905, 906, 907, 908, 909, 910, 1] });
        const rv = await lancer(vivSansLigne);
        H.v('dix produits SANS ligne en tête du vivier ne prennent pas les 10 créneaux : la vérité (12e du vivier, avec ligne) entre au pool', rv.r && rv.r.probable && rv.r.probable.idProduct, 1);
    }
    // ── la même question, avec ou sans probable : la question n'est refaite que si ses 3 candidats changent
    {
        const lignes = { 1: ligne(1), 2: ligne(2, { numero: '12', total: '99' }), 3: ligne(3, { numero: '14', total: '99' }) };
        const m = monde({ cos: { 1: 0.60, 2: 0.30, 3: 0.20 }, lignes, base: [1, 2, 3], vivier: [] });
        const { r } = await lancer(m);
        H.v('la question d\'avant porte déjà les 3 meilleurs : `resultat` null (rien à refaire), le probable seul', [r.resultat, r.probable && r.probable.idProduct], [null, 1]);
    }
    // ── 'un sûr ne change jamais' : sur le monde entier, l'étape ne rend un résultat que pour une question
    {
        const sorties = []; for (const issue of ['affirmee', 'introuvable', 'panne']) { const m = monde({ cos: COS, lignes: LIGNES, base: [2, 3], vivier: [1] }); m.resultat = { issue, analyse: m.resultat.analyse }; sorties.push((await lancer(m)).r); }
        H.v('affirmee / introuvable / panne : rien', sorties, [null, null, null]);
    }
    H.bilan();
})().catch(e => { console.log('ERREUR', e && e.stack || e); process.exit(1); });
