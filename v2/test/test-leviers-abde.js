'use strict';
// LEVIERS-ABDE (ordre n°17, 01/11/2026) — banc du module PUR et de la configuration : drapeau V2_LEVIERS_ABDE (éteint par défaut), écart V2_LEVIERS_ECART (0,1), jeton `leviers-abde` du /ping, noyau de décision
// (score c3, pool de 10, admission par l'écart), alias FR, et le levier e de l'adaptateur (« jumeaux-trop-nombreux » devient une question aux 3 premiers). Aucune base, aucun réseau, aucun appel payant.
// La partie ÉTAPE (consulterProbable -> etapeProbable, de bout en bout sur des index factices) est dans test-leviers-abde-etape.js ; le banc de mutation dans test-leviers-abde-mutation.js.
const fs = require('fs');
const path = require('path');
const H = require('./_harnais');
const { lireConfig } = require('../config');
const { capacitesServies, CAPACITES, CONDITIONS } = require('../capacites');
const { adapter } = require('../identifier/adaptateur');
const { creerConstructeur } = require('../chargeur/version');
const J = require('../identifier/jumeaux');

let L = null;
try { L = require('../identifier/leviers-abde'); } catch (e) { L = null; }

const lance = (env) => { try { return { cfg: lireConfig(env) }; } catch (e) { return { erreur: String(e && e.message) }; } };

// ── 1. la configuration : éteint par défaut, écart 0,1, valeurs invalides refusées
{
    const d = lireConfig({});
    H.v('config : V2_LEVIERS_ABDE absent => éteint ; écart par défaut 0,1', [d.leviersAbde, d.leviersEcart], [false, 0.1]);
    H.v('config : V2_LEVIERS_ABDE=1 allume, =0 éteint', [lireConfig({ V2_LEVIERS_ABDE: '1' }).leviersAbde, lireConfig({ V2_LEVIERS_ABDE: '0' }).leviersAbde], [true, false]);
    H.vrai('config : une valeur ni 0 ni 1 est une configuration invalide (jamais un drapeau allumé par accident)', Boolean(lance({ V2_LEVIERS_ABDE: 'oui' }).erreur) && Boolean(lance({ V2_LEVIERS_ABDE: 'true' }).erreur));
    H.v('config : V2_LEVIERS_ECART règle l\'écart entre 0,05 et 0,5, bornes comprises', [lireConfig({ V2_LEVIERS_ECART: '0.05' }).leviersEcart, lireConfig({ V2_LEVIERS_ECART: '0.15' }).leviersEcart, lireConfig({ V2_LEVIERS_ECART: '0.5' }).leviersEcart], [0.05, 0.15, 0.5]);
    H.v('config : un écart SOUS 0,05 (0 = chaque ex aequo débité) ou AU-DESSUS de 0,5 (probable éteint sans le dire) est une configuration invalide', ['0', '0.04', '0.0499', '0.51', '1', '1.5', 'abc', '-0.1'].map(v => Boolean(lance({ V2_LEVIERS_ECART: v }).erreur)), [true, true, true, true, true, true, true, true]);
    H.vrai('config : l\'écart invalide est refusé même drapeau éteint (une faute de frappe se voit tout de suite)', Boolean(lance({ V2_LEVIERS_ABDE: '0', V2_LEVIERS_ECART: '0' }).erreur));
}

// ── 2. /ping : le jeton n'apparaît que si le drapeau est allumé
{
    const off = capacitesServies(lireConfig({})), on = capacitesServies(lireConfig({ V2_LEVIERS_ABDE: '1', V2_PROBABLE: '1' })), seul = capacitesServies(lireConfig({ V2_LEVIERS_ABDE: '1' })), probableSeul = capacitesServies(lireConfig({ V2_PROBABLE: '1' }));
    H.vrai('/ping : `leviers-abde` est dans la liste fermée des jetons', CAPACITES.includes('leviers-abde'));
    H.v('/ping : drapeau éteint => le jeton n\'est pas annoncé', off.includes('leviers-abde'), false);
    H.v('/ping : V2_LEVIERS_ABDE ET V2_PROBABLE allumés => le jeton est annoncé, en dernier', [on.includes('leviers-abde'), on[on.length - 1]], [true, 'leviers-abde']);
    H.v('/ping : V2_LEVIERS_ABDE seul (V2_PROBABLE éteint : a, b, d, e ne font rien) => pas de jeton ; V2_PROBABLE seul non plus', [seul.includes('leviers-abde'), probableSeul.includes('leviers-abde')], [false, false]);
    H.v('/ping : les autres jetons ne changent pas quand le drapeau s\'allume (hors le nouveau)', on.filter(x => x !== 'leviers-abde'), probableSeul);
    H.vrai('/ping : une condition qui rend autre chose que true laisse tomber le jeton', !capacitesServies(lireConfig({ V2_LEVIERS_ABDE: '1', V2_PROBABLE: '1' }), { ...CONDITIONS, 'leviers-abde': () => 'oui' }).includes('leviers-abde'));
}

// ── 3. le noyau (module pur)
H.vrai('le module identifier/leviers-abde.js existe', L !== null);
if (L) {
    const cand = (id, cos, ok = 0, ko = 0) => ({ id, cos, ok, ko });
    H.v('constantes : poids 0,05 / 0,25, pool 10, vivier 10 sur 80, voisins 10, alias >= 4', [L.POIDS_OK, L.POIDS_KO, L.TAILLE_POOL, L.VIVIER_RETENU, L.VIVIER_LU, L.VOISINS, L.ALIAS_LONGUEUR_MIN], [0.05, 0.25, 10, 10, 80, 10, 4]);
    H.v('c3 = cosinus + 0,05 x concordants - 0,25 x contredits', Math.round(L.scoreC3(cand(1, 0.5, 2, 1)) * 1e9) / 1e9, 0.35);
    H.v('c3 d\'un cosinus inconnu = null (jamais classé)', L.scoreC3(cand(1, null, 3, 0)), null);

    // ── admission (b) : écart c3 >= s ET aucun champ lu ne contredit le premier
    const pool = (...xs) => xs;
    let d = L.decider(pool(cand(1, 0.6, 1, 0), cand(2, 0.45, 0, 0)), 0.1);
    H.v('b : écart 0,15 >= 0,1 et le premier non contredit => probable', [d.kind, d.id, d.top3], ['prob', 1, [1, 2]]);
    d = L.decider(pool(cand(1, 0.5, 0, 0), cand(2, 0.41, 0, 0)), 0.1);
    H.v('b : écart 0,09 < 0,1 => question (aucun probable)', [d.kind, d.id ?? null], ['q', null]);
    d = L.decider(pool(cand(1, 0.5, 0, 0), cand(2, 0.4, 0, 0)), 0.1);
    H.v('b : écart de 0,1 à l\'arrondi près (0,5 - 0,4) => probable (seuil inclus, tolérance 1e-12)', [d.kind, d.id], ['prob', 1]);
    d = L.decider(pool(cand(1, 0.9, 0, 1), cand(2, 0.2, 0, 0)), 0.1);
    H.v('b : le premier est contredit (ko >= 1) : jamais un probable, même avec un grand écart. Ici c3 = 0,65 contre 0,2', [d.kind, d.top3], ['q', [1, 2]]);
    d = L.decider(pool(cand(1, 0.3, 0, 0), cand(2, null, 5, 0)), 0.1);
    H.v('b : un seul candidat classable (l\'autre sans cosinus) => question, jamais un probable', [d.kind, d.top3], ['q', [1]]);
    d = L.decider(pool(cand(1, 0.5, 0, 0)), 0.1);
    H.v('b : un pool de moins de 2 candidats => rien', d.kind, 'rien');
    d = L.decider(pool(cand(1, 0.5, 0, 0), cand(2, 0.49, 0, 0), cand(3, 0.2, 0, 0), cand(4, 0.1, 0, 0)), 0.1);
    H.v('la question garde les 3 premiers du classement c3', d.top3, [1, 2, 3]);
    d = L.decider(pool(cand(1, 0.5, 0, 0), cand(2, 0.5, 0, 0)), 0);
    H.v('écart 0 : deux candidats au même c3 => probable le premier du pool (ex aequo accepté par construction, s = 0)', [d.kind, d.id], ['prob', 1]);
    d = L.decider(pool(cand(1, 0.45, 0, 0), cand(2, 0.30, 0, 0)), 0.2);
    H.v('l\'écart se règle (V2_LEVIERS_ECART) : 0,15 < 0,2 => question', d.kind, 'q');

    // ── a : le pool de 10, trié par c3 AVANT la coupe (la partie A de l'ordre n°17)
    const douze = [cand(100, 0.45, 0, 2), ...Array.from({ length: 9 }, (_, i) => cand(200 + i, 0.4 - i * 0.001, 0, 0)), cand(300, 0.3, 3, 0), cand(301, 0.2, 0, 0)];
    const parC3 = L.classerPool(douze, 'c3'), parCos = L.classerPool(douze, 'cosinus');
    H.v('a : pool de 10 (coupe) dans les deux tris', [parC3.length, parCos.length], [10, 10]);
    H.v('a : le tri au COSINUS coupe la vérité (cosinus 0,3, 3 champs concordants) ; le tri c3 la garde', [parCos.some(c => c.id === 300), parC3.some(c => c.id === 300)], [false, true]);
    H.v('a : le tri c3 pose la vérité (0,45) en tête', parC3[0].id, 300);
    H.v('a : un cosinus inconnu est classé après tout cosinus connu, dans les deux tris', [L.classerPool([cand(1, null, 4, 0), cand(2, 0.01, 0, 3)], 'c3').map(c => c.id), L.classerPool([cand(1, null, 4, 0), cand(2, 0.01, 0, 3)], 'cosinus').map(c => c.id)], [[2, 1], [2, 1]]);
    H.v('a : à c3 égal, l\'ordre d\'insertion est gardé (tri stable)', L.classerPool([cand(7, 0.4, 0, 0), cand(8, 0.4, 0, 0), cand(9, 0.4, 0, 0)], 'c3').map(c => c.id), [7, 8, 9]);

    // ── a : la composition du pool (sélection exacte du §8) : choix d'avant + 10 du vivier non contredits (sur 80 lus) + produits du top 10 de l'empreinte (+ alias)
    const viv = Array.from({ length: 100 }, (_, i) => 1000 + i);
    const ko = id => (id === 1001 || id === 1003 ? 1 : 0);
    const cmp = L.composerPool({ baseIds: [5, 6], vivier: viv, ko, produitsDesVoisins: [[9000, 9001], [9002]], alias: [7777, 5] });
    H.v('a : l\'ordre est choix d\'avant, vivier non contredit (10), voisins de l\'empreinte, alias ; sans doublon', cmp, [5, 6, 1000, 1002, 1004, 1005, 1006, 1007, 1008, 1009, 1010, 1011, 9000, 9001, 9002, 7777]);
    H.v('a : seuls les 80 premiers du vivier sont lus (un non contredit après le 80e n\'entre pas)', L.composerPool({ baseIds: [], vivier: viv, ko: id => (id < 1079 ? 1 : 0), produitsDesVoisins: [], alias: [] }), [1079]);
    H.v('a : un vivier absent ou illisible ne lève pas', L.composerPool({ baseIds: [1], vivier: null, ko, produitsDesVoisins: undefined, alias: undefined }), [1]);

    // ── d : l'alias FR : nomFr normalisé = le nom lu (>= 4 caractères)
    H.v('d : normalisation de l\'alias (accents, casse, ponctuation, espaces)', [L.normaliserAlias('  Érika\'s   Étiquette! '), L.normaliserAlias('ポケモン  ピカチュウ'), L.normaliserAlias(null)], ['erika s etiquette', 'ポケモン ピカチュウ'.normalize('NFKD'), '']);
    H.v('d : un nom de moins de 4 caractères ne sert pas de clé d\'alias', [L.cleAlias('Mew'), L.cleAlias('Mewtwo')], [null, 'mewtwo']);
    const A = new Map([['good manners', [902313, 902314]], ['mewtwo', [11]]]);
    H.v('d : les alias viennent du nom lu ET du nom brut, sans doublon', L.aliasDe(A, ['Good  Manners', 'MEWTWO', 'good manners']), [902313, 902314, 11]);
    H.v('d : sans index d\'alias (null), aucun alias', L.aliasDe(null, ['Good Manners']), []);
    // ── tour 1 (ruling C, D) : plafond de l'éventail, nom lu borné, produits sans ligne, échecs comptés et journalisés
    {
        const gros = new Map([['good manners', Array.from({ length: 35 }, (_, i) => 5000 + i)]]), coupes = [];
        const ids = L.aliasDe(gros, ['Good Manners', 'good manners'], coupes);
        H.v('d : un nom porté par 35 produits n\'en envoie que 20, et la coupe est ÉCRITE', [ids.length, coupes.length, coupes[0] && coupes[0].total, coupes[0] && coupes[0].gardes], [20, 2, 35, 20]);
        const long = 'a'.repeat(5000) + ' fin';
        H.v('d : le nom lu est borné AVANT la normalisation (120 caractères)', [L.normaliserAlias(long).length, L.NOM_LU_MAX], [120, 120]);
        const ex = L.composerPool({ baseIds: [5], vivier: [900, 901, 1000, 1001], ko: () => 0, produitsDesVoisins: [[900, 9000]], alias: [901, 7777], existe: id => id >= 1000 || id === 5 || id === 9000 || id === 7777 });
        H.v('a : un produit SANS ligne n\'entre jamais au pool (vivier, voisins, alias) et ne prend aucun créneau', ex, [5, 1000, 1001, 9000, 7777]);
        const w = console.warn, lignes = []; console.warn = (...a) => lignes.push(a.join(' '));
        const avant = L.echecs()['cause-de-banc'] || 0;
        try { L.signaler('cause-de-banc'); L.signaler('cause-de-banc'); L.signaler('cause-de-banc', 'detail'); } finally { console.warn = w; }
        H.v('échec : compté à chaque fois, journalisé UNE fois par minute et par cause, sans message d\'exception', [(L.echecs()['cause-de-banc'] || 0) - avant, lignes.length, /leviers-abde\] cause-de-banc/.test(lignes[0] || '')], [3, 1, true]);
        H.v('le signal journalisé reste `A` et le levier est dit à part', [L.SIGNAL, L.LEVIER], ['A', 'abde']);
    }
}

// ── 4. e : « jumeaux-trop-nombreux » devient une question aux 3 premiers (jamais un sûr) — les TROIS sites de l'adaptateur, sur des mondes fabriqués + la fixture réelle de la colonne des jumeaux
{
    const nn = x => (x == null ? null : String(x).trim().toLowerCase().replace(/^0+(?=\d)/, ''));
    const img = id => ({ cle: `vignettes/${id}.webp`, w: 200, h: 279 });
    const brut = (id, meta) => ({ idProduct: id, vignette: img(id), grande: null, visuel: 'du-set', mention: null, idMetacard: meta, numero: '1', rarete: 'Rare', total: '100', variante: null, setNom: 'S', lien: null });
    const version = (c) => { const b = creerConstructeur(); for (const p of c.produits) { b.entree(brut(p.id, c.meta)); b.jumeau({ idProduct: p.id, idMetacard: c.meta, idExpansion: p.exp ?? null, numero: nn(p.numero), tirage: p.tirage ?? null }); } return b.finir(new Date('2026-10-12T10:00:00.000Z')); };
    const ligne = p => ({ idProduct: p.id, nomCardmarket: p.nom, nomFr: null, set: { slug: `s${p.exp}`, nom: `Set ${p.exp}`, code: p.codeSet }, numero: p.numero == null ? null : String(p.numero), total: '100', langue: 'FR', variante: null, rarete: 'Rare',
        prixGuide: { trend: 5, low: 4, avg30: 4.5, guideDu: new Date('2026-10-04') }, visuel: { url: `https://pub-7d992e666c3d4a2b870b680a920045b6.r2.dev/${p.id}.webp`, w: 255, h: 356 } });
    const corpsDe = (c, o = {}) => ({ success: true, scanId: 's1', question: null,
        carte: { idProduct: c.tete, ambigu: false, niveauReserve: null, raisonReserve: null, concurrent: null, nbExAequo: null, nom: c.lu.nom, nomBrut: c.lu.nom, nomConfiance: 'haute', numero: c.lu.numero, total: c.lu.total, setCode: c.lu.setCode, langue: c.lu.langue, ...o.carte },
        etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' }, candidats: [{ idProduct: c.tete, score: 9 }], classement: [{ idProduct: c.tete, score: 9 }], reverse: { attendue: false, strategie: null }, codeLangue: 2, ...o.corps });
    const monde = (c, o = {}) => { const v = version(c); const produits = new Map(c.produits.map(p => [p.id, ligne(p)])); for (const id of (o.sansLigne || [])) produits.delete(id); return { produits, jumeaux: J.fournisseurDe(v) }; };
    const cfgOff = lireConfig({}), cfgOn = lireConfig({ V2_LEVIERS_ABDE: '1' });
    const { leviersAbde, leviersEcart, ...cfgAvant } = cfgOff;                         // la configuration d'AVANT ce lot : sans les deux champs
    const E = { leviersE: true };                                                    // la route pose leviersE (V2_PROBABLE allumé ET extension >= 2.0.1) ; un lot ne le pose jamais
    const ctx = (m, cfg, plus = {}) => ({ produits: m.produits, langueInterface: 'fr', cfg, jumeaux: m.jumeaux, ...plus });
    const muet = f => { const w = console.warn; console.warn = () => { }; try { return f(); } finally { console.warn = w; } };
    const ids = r => r.analyse.cartes[0].candidats.map(x => x.idProduct).sort((a, b) => a - b);
    const sortie = (corps, c) => muet(() => adapter({ statutHttp: 200, corps }, c));
    const ligneB = (id, nom = 'Roaring Moon ex') => ({ id, nom, numero: String(id), codeSet: 'X', exp: id, tirage: 'intl' });
    const petit = { lu: { nom: 'Roaring Moon ex', numero: '700' }, tete: 700, meta: 7, produits: [ligneB(700), ligneB(701), ligneB(702), ligneB(703)] };

    // site 2 (apresGarde, « nombreux ») : plus de 3 produits, une ligne de jumeau manque => « lignes incomplètes » : l'introuvable d'avant ; allumé, la question des 3 premiers si leurs lignes y sont
    {
        const m = monde(petit, { sansLigne: [703] });
        const off = sortie(corpsDe(petit), ctx(m, cfgOff)), on = sortie(corpsDe(petit), ctx(m, cfgOn, E));
        H.v('e site 2 : éteint, l\'introuvable d\'avant (impression-indeterminee, motif jumeaux-trop-nombreux)', [off.issue, off.analyse.cartes[0].raison, off.motif], ['introuvable', 'impression-indeterminee', 'jumeaux-trop-nombreux']);
        H.v('e site 2 : allumé, une QUESTION aux 3 premiers (P d\'abord, jamais un sûr, jamais plus de 3)', [on.issue, ids(on), on.analyse.cartes[0].statut, on.motif ?? null], ['question', [700, 701, 702], 'a-trancher', null]);
        H.v('e site 2 : éteint = configuration d\'avant, octet pour octet', JSON.stringify(off), JSON.stringify(sortie(corpsDe(petit), ctx(m, cfgAvant))));
        const m2 = monde(petit, { sansLigne: [701] }), on2 = sortie(corpsDe(petit), ctx(m2, cfgOn, E));
        H.v('e site 2 : un des 3 premiers SANS ligne de catalogue => le repli d\'avant (introuvable), jamais une panne SERVEUR', [on2.issue, on2.motif], ['introuvable', 'jumeaux-trop-nombreux']);
        const rl = sortie(corpsDe(petit), ctx(m, cfgOn, { ...E, lot: true }));
        H.v('e : dans un LOT, le comportement d\'avant (introuvable jumeaux-trop-nombreux)', [rl.issue, rl.motif], ['introuvable', 'jumeaux-trop-nombreux']);
    }
    // site 2 bis : tous les jumeaux contredits par le nom lu, P compatible (« un seul candidat compatible ») : l'introuvable d'avant ; allumé, la question
    {
        const c = { ...petit, produits: [ligneB(700), ligneB(704, 'Charizard VMAX'), ligneB(705, 'Charizard VMAX'), ligneB(706, 'Charizard VMAX'), ligneB(707, 'Charizard VMAX')] };
        const m = monde(c), off = sortie(corpsDe(c), ctx(m, cfgOff)), on = sortie(corpsDe(c), ctx(m, cfgOn, E));
        H.v('e site 2 bis : éteint, introuvable jumeaux-trop-nombreux ; allumé, une question de 3 qui contient P', [off.motif, on.issue, ids(on).length, ids(on).includes(700)], ['jumeaux-trop-nombreux', 'question', 3, true]);
    }
    // site 1 (questionAvecPartenaires) : une question de la chaîne dont les partenaires de partage portent le total au-delà de 3
    {
        const ls = [10, 11, 12, 13].map(id => ligne({ id, nom: 'Pikachu', numero: String(id), codeSet: 'Z', exp: 900 + id }));
        const produits = new Map(ls.map(l => [l.idProduct, l]));
        const jumeaux = Object.assign(() => ({ conclu: true, ids: [], partages: [] }), { partagesDe: id => (id === 10 ? [12, 13] : []) });
        const corps = { success: true, scanId: 's1', question: null, carte: { idProduct: 10, ambigu: true, nom: 'Pikachu', nomBrut: 'Pikachu', nomConfiance: 'basse' }, etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' },
            candidats: [{ idProduct: 10 }, { idProduct: 11 }], classement: [], reverse: { attendue: false, strategie: null }, codeLangue: 2 };
        const off = sortie(corps, { produits, langueInterface: 'fr', cfg: cfgOff, jumeaux }), on = sortie(corps, { produits, langueInterface: 'fr', cfg: cfgOn, leviersE: true, jumeaux });
        H.v('e site 1 : éteint, introuvable jumeaux-trop-nombreux (4 produits avec les partenaires)', [off.issue, off.motif], ['introuvable', 'jumeaux-trop-nombreux']);
        H.v('e site 1 : allumé, une question aux 3 premiers (les candidats d\'abord, puis un partenaire)', [on.issue, ids(on)], ['question', [10, 11, 12]]);
    }
    // site 3 (parContradiction) : la lecture contredit P, désigne un autre candidat, et les partenaires de partage portent le total au-delà de 3 : le motif ET le résumé de la contradiction survivent
    {
        const lg = (id, numero) => ligne({ id, nom: 'Pikachu', numero, codeSet: 'Z', exp: 900 + id });
        const produits = new Map([[1, lg(1, '9')], [2, lg(2, '5')], [3, lg(3, '9')], [4, lg(4, '9')]]);
        const jumeaux = Object.assign(() => ({ conclu: true, ids: [], partages: [] }), { partagesDe: id => (id === 1 ? [3, 4] : []) });
        const corps = { success: true, scanId: 's1', question: null, carte: { idProduct: 1, ambigu: false, nom: 'Pikachu', nomBrut: 'Pikachu', nomConfiance: 'haute', numero: '5', total: null, setCode: null, langue: null }, lectureGarde: { numero: '5', vivierIds: [1, 2] },
            etat: { estimeIA: 'EX', confianceIA: 'haute', defautsVus: [], declareVendeur: null, retenu: 'GD' }, candidats: [{ idProduct: 1 }], classement: [{ idProduct: 1 }], reverse: { attendue: false, strategie: null }, codeLangue: 2 };
        const off = sortie(corps, { produits, langueInterface: 'fr', cfg: cfgOff, jumeaux }), on = sortie(corps, { produits, langueInterface: 'fr', cfg: cfgOn, leviersE: true, jumeaux });
        H.v('e site 3 : éteint, introuvable jumeaux-trop-nombreux AVEC la contradiction', [off.issue, off.motif, typeof off.contradiction], ['introuvable', 'jumeaux-trop-nombreux', 'string']);
        H.v('e site 3 : allumé, une question aux 3 premiers (P, le désigné, un partenaire) qui garde le résumé de la contradiction', [on.issue, ids(on), typeof on.contradiction], ['question', [1, 2, 3], 'string']);
    }
    // ── tour 1 (ruling A) : e n'agit que si la route le permet (leviersE), marque la question née de lui, et la désignation ne l'affirme jamais
    {
        const m = monde(petit, { sansLigne: [703] });
        const sans = sortie(corpsDe(petit), ctx(m, cfgOn));
        H.v('e : sans leviersE (V2_PROBABLE éteint ou extension trop ancienne) le drapeau seul ne change rien : l\'introuvable d\'avant', [sans.issue, sans.motif], ['introuvable', 'jumeaux-trop-nombreux']);
        const on = sortie(corpsDe(petit), ctx(m, cfgOn, E));
        H.v('e : la question née de e porte la marque jumeauxEnQuestion (G, SUR-PAR-IMAGE, seconde lecture, tampon, jumbo la lisent)', on.jumeauxEnQuestion, true);
        // la désignation (règle numero) affirmerait 700 seul : une question de e n'est JAMAIS promue en sûr, même par l'adaptateur
        H.v('e : la question née de e reste une question à confirmer (a-trancher), jamais un sûr à ce stade', [on.issue, on.analyse.cartes[0].statut], ['question', 'a-trancher']);
        const ordinaire = sortie(corpsDe({ ...petit, produits: petit.produits.slice(0, 3) }), ctx(monde({ ...petit, produits: petit.produits.slice(0, 3) }), cfgOn, E));
        H.v('une question ORDINAIRE (3 produits) ne porte pas la marque de e', ordinaire.jumeauxEnQuestion ?? null, null);
    }
    // la fixture réelle (72 cartes, VRAIE colonne des jumeaux) : allumer le drapeau ne change AUCUNE autre sortie, ne fabrique jamais un sûr
    {
        const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'banc-reel', 'jumeaux-question.json'), 'utf8')).cartes;
        let autres = 0, sursEnPlus = 0, toutesDeuxQuestions = 0;
        for (const c of FIX) {
            const m = monde(c), a = sortie(corpsDe(c), ctx(m, cfgOff)), b = sortie(corpsDe(c), ctx(m, cfgOn, E));
            if (a.motif !== 'jumeaux-trop-nombreux') { if (JSON.stringify(a) !== JSON.stringify(b)) autres++; if (a.issue === 'question' && b.issue === 'question') toutesDeuxQuestions++; }
            if (b.issue === 'affirmee' && a.issue !== 'affirmee') sursEnPlus++;
        }
        H.v(`e : sur les ${FIX.length} cartes réelles, aucune sortie ne change (hors l'introuvable visé) et aucun sûr de plus`, [autres, sursEnPlus], [0, 0]);
        H.vrai(`e : la fixture porte des questions réelles (${toutesDeuxQuestions}) qui restent identiques`, toutesDeuxQuestions > 50);
    }
}

// ── 5. le câblage de la route (statique : la route HTTP se joue sur une base de test que ce poste n'a pas ; la parité hors ligne rejoue les MÊMES fonctions, v2/mesures/parite-leviers-abde.js)
{
    const src = f => fs.readFileSync(path.join(__dirname, '..', 'identifier', f), 'utf8').replace(/\r\n/g, '\n');
    const routes = src('routes.js'), lot = src('lot.js'), cat = src('catalogue.js');
    const i = routes.indexOf('if (cfg.leviersAbde === true) {'), j = routes.indexOf('appliquerLeviers({', i), k = routes.indexOf('} else probableDecide = consulterProbable({ cfg, entree, resultat, corpsChaine: c, produits, version: version0, traceMarqueurs, memo: te.voisinsUneFois === true });', i);
    H.vrai('route : l\'étape LEVIERS-ABDE n\'est atteinte que sous `cfg.leviersAbde === true`, dans le bloc PROBABLE (cfg.probable) et sous le même try', i > 0 && j > i && j < k && routes.lastIndexOf('if (resultat.issue === \'question\' && cfg.probable === true) {', i) > 0 && routes.lastIndexOf('try {', i) > routes.lastIndexOf('if (resultat.issue === \'question\' && cfg.probable === true) {', i));
    H.vrai('route : drapeau éteint, la branche `else` appelle consulterProbable avec EXACTEMENT les arguments d\'avant', k > 0);
    H.vrai('route : le résultat de l\'étape ne remplace la question que s\'il en rend une, le probable vient de l\'étape (jamais de consulterProbable en même temps)', routes.includes('if (lv) { if (lv.resultat) resultat = lv.resultat; probableDecide = lv.probable; }'));
    H.vrai('route : l\'étape reçoit le catalogue et le contexte de l\'adaptateur (jumeaux, langue décisive) pour fabriquer la question', /appliquerLeviers\(\{[^]*catalogue, ctxQuestion: \{ langueInterface: entree\.langueInterface, cfg, ficheServie: false, jumeaux, \.\.\.ctxLD \}/.test(routes));
    H.vrai('route : le levier qui a désigné un probable est écrit dans analyses.probable.levier (le signal reste A)', routes.includes('...(sortie.probable.levier ? { levier: sortie.probable.levier } : {})'));
    const marq = src('garde-marqueurs.js'), adap = src('adaptateur.js');
    H.vrai('route : le contexte de l\'adaptateur d\'une carte pose leviersE seulement sous V2_LEVIERS_ABDE ET le niveau probable servi (V2_PROBABLE + extension >= 2.0.1)', routes.includes("...(cfg.leviersAbde === true && niveauServi(cfg, entree) ? { leviersE: true } : {})"));
    H.vrai('route : seconde lecture, tampon, règle G (vecteur et V2_REGLE_G), SUR-PAR-IMAGE ne voient jamais une question née de e', routes.includes("if (resultat.issue === 'question' && !resultat.jumeauxEnQuestion) {") && routes.includes("if ((resultat.issue === 'question' || resultat.issue === 'affirmee') && !resultat.jumeauxEnQuestion) {") && routes.includes("if (resultat.jumeauxEnQuestion === true) { /* e : jamais promue */ } else if (resultat.issue !== 'panne' && fournisseurEmpreinte") && routes.includes("cfg.surParImage === true && entree.empreintes && !desaccordG && !(empreinteInfo && empreinteInfo.influence) && !resultat.jumeauxEnQuestion"));
    H.vrai('marqueurs : le titre jumbo n\'affirme pas une question née de e, et lot est transmis à la question du groupe', marq.includes("lot || resultat.jumeauxEnQuestion === true ? { ...cfg, jumboTitre: false } : cfg") && marq.includes("questionDeGroupe(c, ids, { ...pctx, produits, jumeaux, lot })"));
    H.vrai('adaptateur : la désignation ne touche pas une question née de e', adap.includes("if (!r || r.issue !== 'question' || r.jumeauxEnQuestion === true) return r;"));
    H.vrai('lot : le contexte de l\'adaptateur d\'un lot porte `lot: true` (le levier e ne s\'applique qu\'à UNE carte)', /\.\.\.ctxLD, lot: true \}/.test(lot));
    H.vrai('catalogue : `indexAliasFr` est exposé, lu par curseur, sous les gardes des autres index (compte, tronqué, plancher)', cat.includes('indexAliasFr,') && cat.includes('for await (const d of col.find({}, { projection: { idProduct: 1, nomFr: 1 } }))') && cat.includes('if (lus < attendu) throw') && cat.includes('INDEX_CODE_NUMERO_MIN'));
}

// ── 5 bis. réserve 5 : une question à UN candidat réservée par la chaîne qui devient une question à plusieurs. Le remboursement d'une carte seule ne lit PAS le nombre de choix : « aucune » / « ne-sait-pas » / abandon sont des
// déclarations (questions.js::regler, plafond des déclarations) ; le seul endroit qui compte les choix (`choix.length !== 1`) est le JUGEMENT D'UN LOT (jugerLot). Banc statique (la base de test manque ici) : si un autre lecteur du nombre de choix apparaît, il échoue.
{
    const q = fs.readFileSync(path.join(__dirname, '..', 'argent', 'questions.js'), 'utf8');
    const lecteurs = q.split('\n').filter(l => /choix\.length/.test(l) && !/^\s*\/\//.test(l));
    const iRegler = q.indexOf('async function regler'), iLot = q.indexOf('async function jugerLot');
    H.v('questions.js : une seule ligne de code lit `choix.length` (le jugement d\'un lot), jamais le règlement d\'une carte seule', [lecteurs.length, lecteurs.every(l => l.includes('q.choix.length !== 1'))], [1, true]);
    H.vrai('questions.js : cette lecture est dans jugerLot, après `regler` (le règlement « aucune » d\'une question simple)', iRegler > 0 && iLot > iRegler && q.indexOf('q.choix.length !== 1') > iLot);
}

// ── 6. l'index d'alias du catalogue, sur une collection factice (lecture par curseur, gardes de troncature et de plancher)
(async () => {
    const dbMod = require('../db');
    const { creerCatalogue } = require('../identifier/catalogue');
    const colorig = dbMod.col;
    const faux = (docs, attendu = docs.length) => ({ countDocuments: async () => attendu, find: () => (async function* () { for (const d of docs) yield d; })() });
    const gros = Array.from({ length: 10050 }, (_, i) => ({ idProduct: 1000 + i, nomFr: i === 7 ? 'Étiquette d\'Erika' : i === 8 ? 'Mew' : `Carte numéro ${i}` }));
    try {
        dbMod.col = nom => (nom === 'numeros_cartes' ? faux(gros) : (() => { throw new Error('collection inattendue'); })());
        const cat = creerCatalogue({ cfg: lireConfig({}), visuels: { entree: () => null } });
        const idx = await cat.indexAliasFr();
        H.v('alias : l\'index est lu par curseur et normalisé (clé -> idProduct[]), les noms trop courts n\'y entrent pas', [idx.get('etiquette d erika'), idx.has('mew'), idx.size], [[1007], false, 10049]);
        H.vrai('alias : un deuxième appel dans les 6 h rend la MÊME promesse (index gardé)', (await cat.indexAliasFr()) === idx);
        dbMod.col = nom => faux(gros, 20000);
        const cat2 = creerCatalogue({ cfg: lireConfig({}), visuels: { entree: () => null } });
        let e1 = null; try { await cat2.indexAliasFr(); } catch (e) { e1 = String(e.message); }
        H.vrai('alias : moins de documents LUS que COMPTÉS = lecture tronquée, refusée (LÈVE, rien n\'est gardé)', Boolean(e1) && /tronqué/.test(e1));
        dbMod.col = nom => faux(gros.slice(0, 50));
        const cat3 = creerCatalogue({ cfg: lireConfig({}), visuels: { entree: () => null } });
        let e2 = null; try { await cat3.indexAliasFr(); } catch (e) { e2 = String(e.message); }
        H.vrai('alias : sous le plancher de 10 000 lignes, refusé (LÈVE)', Boolean(e2) && /plancher/.test(e2));
        // tour 1 (D) : le scan ne construit JAMAIS l'index : lecture sans attente (null tant qu'il n'est pas prêt, construction lancée en arrière-plan), préchauffage au démarrage, temps et mémoire gardés
        dbMod.col = nom => (nom === 'numeros_cartes' ? faux(gros) : (() => { throw new Error('collection inattendue'); })());
        const w = console.warn; console.warn = () => { };
        let catS, premier, apres, stats;
        try {
            catS = creerCatalogue({ cfg: lireConfig({}), visuels: { entree: () => null } });
            premier = catS.indexAliasFrSansAttente();
            await catS.indexAliasFr();
            apres = catS.indexAliasFrSansAttente(); stats = catS.statsIndexAlias();
        } finally { console.warn = w; }
        H.v('alias : sans attente, le PREMIER appel rend null (le scan n\'attend rien) puis l\'index prêt, le même', [premier, apres instanceof Map && apres.size === 10049, apres === (await catS.indexAliasFr())], [null, true, true]);
        H.v('alias : le temps et la mémoire de la construction sont gardés (noms, lignes, ms mur, ms CPU, tas)', [stats.noms, stats.lignes, typeof stats.msMur, typeof stats.msCpu, typeof stats.tasMo], [10049, 10050, 'number', 'number', 'number']);
        const cats = fs.readFileSync(path.join(__dirname, '..', 'identifier', 'catalogue.js'), 'utf8');
        H.vrai('alias : préchauffé au démarrage sous le drapeau (prechauffer ET prechaufferSiDemande), jamais drapeau éteint', cats.includes('if (cfg.leviersAbde === true) r.alias = await prechaufferAlias();') && cats.includes('if (cfg.leviersAbde === true) return (async () =>'));
        H.vrai('alias : la reconstruction périmée part en arrière-plan sans être attendue par la demande', cats.includes('if (!aliasEnCours || Date.now() - aliasLe >= INDEX_DUREE_MS) indexAliasFr().catch(() => { });\n        return aliasPret;') || cats.includes('if (!aliasEnCours || Date.now() - aliasLe >= INDEX_DUREE_MS) indexAliasFr().catch(() => { });\r\n        return aliasPret;'));
    } finally { dbMod.col = colorig; }
    H.bilan();
})().catch(e => { console.log('ERREUR', e && e.stack || e); process.exit(1); });
