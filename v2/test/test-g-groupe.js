'use strict';
// Banc G-GROUPE (1) — le module pur qui ORDONNE un groupe de 2 à 5 candidats d'une question avec les mesures de zones que le client a calculées (identifier/g-groupe.js).
// La règle est écrite par ce qu'elle AUTORISE : un candidat ne passe en tête que si TOUS les autres sont mesurés, distincts de lui, et séparés de lui d'au moins `ecartMin` points d'inliers,
// avec lui-même au moins au plancher de la zone clé de G ; une mesure absente, illisible ou ex aequo ne change rien.
// Module sans base ni réseau : mesures FABRIQUÉES. Les mutations sont rejouées par v2/mesures/mutations-g-groupe.js (une mutation de la règle doit faire rougir un cas d'ici).
const H = require('./_harnais');
const G = require('../../ratmarket/decision-g');
const GG = require('../identifier/g-groupe');

const z = (inliers, o = {}) => ({ type: 'zones', ref: 'x', haut: 0.8, illustration: 0.8, bandeau: 0.8, texte: 0.8, bas: 0.8, inliers, ...o });
const cand = (...paires) => paires.map(([id, cle]) => ({ id, cle }));
const parCle = obj => cle => (Object.prototype.hasOwnProperty.call(obj, cle) ? obj[cle] : null);
const E = 100;

(async () => {
    // ── 0. les constantes viennent de la règle G et du contrat, jamais d'un nombre recopié
    H.v('0a. le plancher d\'inliers est celui de la zone clé de G', GG.PLANCHER_INLIERS, G.SEUILS_G.inliers_min);
    H.v('0b. le groupe va de 2 à 5 candidats', [GG.GROUPE_MIN, GG.GROUPE_MAX], [2, 5]);

    // ── 1. un candidat se détache
    const g3 = cand([606417, 'a'], [606801, 'b'], [653908, 'c']);
    const r1 = GG.ordonnerGroupe({ groupe: g3, zones: parCle({ a: z(291), b: z(164), c: z(31) }), ecartMin: E });
    H.v('1a. 291 contre 164 et 31, écart exigé 100 : A en tête, l\'ordre suit les inliers', [r1.change, r1.tete, r1.ordre], [true, 606417, [606417, 606801, 653908]]);
    H.v('1b. l\'écart rendu est celui du premier au meilleur des autres', [r1.ecart, r1.inliersTete, r1.inliersSecond], [127, 291, 164]);
    const r1b = GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(20), b: z(300) }), ecartMin: E });
    H.v('1c. la tête n\'est pas forcément le premier de la liste', [r1b.change, r1b.tete, r1b.ordre], [true, 2, [2, 1]]);
    H.v('1d. deux candidats suffisent', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(300), b: z(0) }), ecartMin: E }).change, true);
    H.v('1e. cinq candidats suffisent', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e']), zones: parCle({ a: z(50), b: z(60), c: z(300), d: z(70), e: z(40) }), ecartMin: E }).tete, 3);
    // l'ordre d'entrée n'entre pas dans la décision
    for (const [nom, g] of [['inversé', [...g3].reverse()], ['tourné', [g3[1], g3[2], g3[0]]]]) H.v(`1f. ${nom} : même tête`, GG.ordonnerGroupe({ groupe: g, zones: parCle({ a: z(291), b: z(164), c: z(31) }), ecartMin: E }).tete, 606417);

    // ── 2. ce qui ne change RIEN (écrit par ce qui est autorisé : tout le reste est un non)
    const non = (nom, res, motif) => H.v(nom, [res.change, res.motif, res.tete ?? null], [false, motif, null]);
    non('2a. l\'écart est trop petit (291 contre 250)', GG.ordonnerGroupe({ groupe: g3, zones: parCle({ a: z(291), b: z(250), c: z(31) }), ecartMin: E }), 'ecart-insuffisant');
    non('2b. l\'écart vaut pile le seuil moins un', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(199), b: z(100) }), ecartMin: E }), 'ecart-insuffisant');
    H.v('2c. l\'écart vaut pile le seuil : la tête change (seuil inclus)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(200), b: z(100) }), ecartMin: E }).change, true);
    non('2d. ex aequo (300 contre 300)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(300), b: z(300) }), ecartMin: E }), 'ecart-insuffisant');
    non('2e. le meilleur est sous le plancher de la zone clé (30 contre 0)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(30), b: z(0) }), ecartMin: 10 }), 'plancher');
    non('2f. le vrai a 0 inlier, les autres 13 et 13 : personne ne se détache', GG.ordonnerGroupe({ groupe: g3, zones: parCle({ a: z(13), b: z(13), c: z(0) }), ecartMin: E }), 'plancher');
    non('2g. une mesure manque (le candidat c n\'a pas été mesuré) : on ne classe pas devant un inconnu', GG.ordonnerGroupe({ groupe: g3, zones: parCle({ a: z(291), b: z(31) }), ecartMin: E }), 'mesure-absente');
    non('2h. une mesure illisible (inliers non entier)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(291.5), b: z(10) }), ecartMin: E }), 'mesure-absente');
    non('2i. une mesure illisible (inliers au-delà du contrat, 301)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(301), b: z(10) }), ecartMin: E }), 'mesure-absente');
    non('2j. une mesure illisible (inliers négatif)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(291), b: z(-1) }), ecartMin: E }), 'mesure-absente');
    non('2k. une mesure illisible (NaN)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(NaN), b: z(10) }), ecartMin: E }), 'mesure-absente');
    non('2l. une mesure illisible (chaîne)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z('291'), b: z(10) }), ecartMin: E }), 'mesure-absente');
    non('2m. une zone hors bornes (haut 2)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(291, { haut: 2 }), b: z(10) }), ecartMin: E }), 'mesure-absente');
    non('2n. un candidat sans visuel connu (cle null)', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, null]), zones: parCle({ a: z(291) }), ecartMin: E }), 'visuel-inconnu');
    non('2o. deux candidats partagent le visuel de tête : on ne choisit pas entre eux', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'a'], [3, 'b']), zones: parCle({ a: z(291), b: z(10) }), ecartMin: E }), 'ex-aequo-visuel');
    H.v('2p. deux candidats partagent un visuel qui n\'est PAS en tête : la tête change quand même', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b'], [3, 'b']), zones: parCle({ a: z(291), b: z(10) }), ecartMin: E }).tete, 1);
    non('2q. un seul candidat', GG.ordonnerGroupe({ groupe: cand([1, 'a']), zones: parCle({ a: z(300) }), ecartMin: E }), 'groupe-hors-bornes');
    non('2r. six candidats', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b'], [3, 'c'], [4, 'd'], [5, 'e'], [6, 'f']), zones: parCle({ a: z(300), b: z(0), c: z(0), d: z(0), e: z(0), f: z(0) }), ecartMin: E }), 'groupe-hors-bornes');
    non('2s. deux fois le même produit', GG.ordonnerGroupe({ groupe: cand([1, 'a'], [1, 'b']), zones: parCle({ a: z(300), b: z(0) }), ecartMin: E }), 'groupe-hors-bornes');
    for (const [nom, v] of [['zéro', 0], ['négatif', -5], ['NaN', NaN], ['chaîne', '100'], ['absent', undefined], ['infini', Infinity]])
        non(`2t. seuil ${nom} : jamais de changement`, GG.ordonnerGroupe({ groupe: cand([1, 'a'], [2, 'b']), zones: parCle({ a: z(300), b: z(0) }), ecartMin: v }), 'seuil-invalide');

    // ── 3. ne lève jamais
    let leve = 0;
    for (const entree of [undefined, null, {}, { groupe: null }, { groupe: [null, null] }, { groupe: [{ id: 'x', cle: 'a' }, { id: 'y', cle: 'b' }], zones: parCle({ a: z(300), b: z(0) }), ecartMin: E }, { groupe: g3, zones: () => { throw new Error('x'); }, ecartMin: E }, { groupe: g3, zones: null, ecartMin: E }]) {
        try { const r = GG.ordonnerGroupe(entree); if (r.change !== false) leve += 100; } catch { leve++; }
    }
    H.v('3a. des entrées absurdes : jamais d\'exception, jamais de changement', leve, 0);
    {
        const zones = { a: z(291), b: z(164), c: z(31) }, avant = JSON.stringify(zones), grp = JSON.stringify(g3);
        GG.ordonnerGroupe({ groupe: g3, zones: parCle(zones), ecartMin: E });
        H.v('3b. l\'entrée n\'est jamais modifiée', [JSON.stringify(zones), JSON.stringify(g3)], [avant, grp]);
    }

    // ── 4. la demande : les zones des visuels du groupe, dans la limite du contrat
    const dej = [{ type: 'zones', ref: 'a' }, { type: 'paire', a: 'a', b: 'b' }];
    H.v('4a. seules les zones qui manquent sont ajoutées, sans doublon', GG.demandeDuGroupe({ groupe: cand([1, 'a'], [2, 'b'], [3, 'b'], [4, 'c']), deja: dej, max: 12 }), [{ type: 'zones', ref: 'b' }, { type: 'zones', ref: 'c' }]);
    H.v('4b. tout est déjà demandé : rien à ajouter (liste vide, le groupe reste ordonnable)', GG.demandeDuGroupe({ groupe: cand([1, 'a'], [2, 'b']), deja: [...dej, { type: 'zones', ref: 'b' }], max: 12 }), []);
    H.v('4c. un candidat sans visuel : pas de groupe (null)', GG.demandeDuGroupe({ groupe: cand([1, 'a'], [2, null]), deja: dej, max: 12 }), null);
    H.v('4d. au-delà du maximum du contrat : pas de groupe (null), la demande d\'avant n\'est pas touchée', GG.demandeDuGroupe({ groupe: cand([1, 'a'], [2, 'b'], [3, 'c']), deja: Array.from({ length: 11 }, (_, i) => ({ type: 'zones', ref: 'z' + i })), max: 12 }), null);
    H.v('4e. pile au maximum (10 déjà demandées + 2) : accepté', GG.demandeDuGroupe({ groupe: cand([1, 'a'], [2, 'b']), deja: Array.from({ length: 10 }, (_, i) => ({ type: 'zones', ref: 'z' + i })), max: 12 }), [{ type: 'zones', ref: 'a' }, { type: 'zones', ref: 'b' }]);
    H.v('4e2. un de plus que le maximum (11 déjà + 2 = 13) : refusé', GG.demandeDuGroupe({ groupe: cand([1, 'a'], [2, 'b']), deja: Array.from({ length: 11 }, (_, i) => ({ type: 'zones', ref: 'z' + i })), max: 12 }), null);
    H.v('4f. entrée absurde : null', [GG.demandeDuGroupe(undefined), GG.demandeDuGroupe({}), GG.demandeDuGroupe({ groupe: 'x', deja: [], max: 12 })], [null, null, null]);

    // ── 5. le groupe d'une question
    const version = id => ({ 1: { grande: { cle: 'k1' } }, 2: { grande: { cle: 'k2' } }, 3: { grande: { cle: 'k3' } }, 4: {}, 6: { grande: { cle: 'k6' } } }[id] || null);
    const v = { entree: version, empruntDe: id => (id === 3 ? true : id === 5 || id === 6 ? null : false) };
    const cleDe = GG.cleDeLaVersion(v);
    H.v('5a. la clé d\'un produit à visuel propre', [cleDe(1), cleDe(2)], ['k1', 'k2']);
    H.v('5b. un visuel emprunté, un emprunt inconnu (entrée présente ou non), une entrée sans visuel ou absente : pas de clé', [cleDe(3), cleDe(5), cleDe(6), cleDe(4), cleDe(99)], [null, null, null, null, null]);
    H.v('5c. sans version : pas de clé', [GG.cleDeLaVersion(null)(1), GG.cleDeLaVersion({})(1)], [null, null]);
    H.v('5d. le groupe d\'une question', GG.groupeDeLaQuestion([1, 2], cleDe), [{ id: 1, cle: 'k1' }, { id: 2, cle: 'k2' }]);
    H.v('5e. un seul id, six ids, un doublon ou un id non entier : pas de groupe', [GG.groupeDeLaQuestion([1], cleDe), GG.groupeDeLaQuestion([1, 2, 3, 4, 5, 6], cleDe), GG.groupeDeLaQuestion([1, 1], cleDe), GG.groupeDeLaQuestion([1, '2'], cleDe)], [null, null, null, null]);
    H.v('5f. un id sans clé garde sa place avec cle null (le groupe existe, la règle se taira)', GG.groupeDeLaQuestion([1, 4], cleDe), [{ id: 1, cle: 'k1' }, { id: 4, cle: null }]);

    H.bilan();
})().catch(e => { console.error('❌', e); process.exitCode = 1; });
