'use strict';
// SPI-CONTRADICTIONS — le COMPARATEUR de la condition (6) de SUR-PAR-IMAGE (identifier/comparateur-image.js), derrière V2_SPI_COMPARATEUR (éteint par défaut).
// Mesuré avec la vraie lecture : 32 des 47 sûrs de la règle étaient « contredits » à tort. Trois causes, trois règles, aucune ne retire un champ du veto :
//   · attaque-traduite : l'attaque d'une carte NON anglaise est le nom anglais DEVINÉ par le modèle ; le catalogue porte l'anglais de Cardmarket. Un désaccord n'y compte pas quand le numéro ET (le total OU le code) concordent
//     et qu'aucun autre candidat n'est le jumeau du désigné (même nom, même tirage, même numéro : l'attaque, qui ne les sépare pas, y garde son veto) ;
//   · promo-prefixe : « XY85 » est le numéro 85 de XYPR, « SM46 » le 46 de SM : le code que la carte imprime (XY, ou le set d'origine d'une promo à étoile) n'est pas le code Cardmarket ;
//   · symbole-isole : un symbole e-Reader lu sur une carte dont le numéro ET le total concordent est une lecture isolée.
// Sans base ni réseau : l'index d'empreintes est FABRIQUÉ (géométrie connue), l'archive est une fausse version, le catalogue et l'affirmation sont fabriqués.
const H = require('./_harnais');
const A = require('./_empreinte-aide');
const { lireConfig } = require('../config');
const VE = require('../identifier/voisins-empreinte');
const E = require('../identifier/empreinte-vecteur');
const X = require('../identifier/index-empreintes');
const etat = require('../identifier/etat-empreintes');
const G = require('../../ratmarket/decision-g');
const SPI = require('../identifier/sur-par-image');
const GC = require('../identifier/garde-contradiction');
const CI = require('../identifier/comparateur-image');
const { consulterSurParImage } = require('../identifier/sur-par-image-route');

const lu = (o = {}) => ({ numero: null, setCode: null, total: null, symboleSet: null, attaque: null, attaqueConfiance: 'haute', langue: null, tcgdexId: null, totalHorsTailleDeSet: false, vivierIds: [], ...o });
const ligne = (o = {}) => ({ idProduct: 1, numero: '077', total: '184', set: { code: 's8b' }, tirageSource: 'jp', nomCardmarket: 'Mimikyu VMAX [Ominous Numbers | Max Shadow]', marques: [], ...o });
const J = (o = {}) => lu({ numero: '077', total: '184', setCode: 's8b', langue: 'JP', attaque: 'Occult Number', ...o });
const st = (l, g, autres) => CI.statutsPourImage(l, g, autres);

// ── (0) le module est celui de la production : sans règle applicable il rend EXACTEMENT les statuts de garde-contradiction
{
    const cas = [[J({ numero: '078' }), ligne()], [J({ langue: 'EN' }), ligne({ tirageSource: 'intl' })], [lu(), ligne()], [lu({ numero: 'XY85', setCode: 'XY' }), ligne({ numero: '86', set: { code: 'XYPR' } })]];
    H.v('0a. 🔑 hors des trois règles, les statuts rendus sont ceux de la production, champ par champ', cas.map(([l, g]) => JSON.stringify(GC.statuts(l, g)) === JSON.stringify(st(l, g, []))), [true, true, true, true]);
    H.v('0b. la liste des champs est celle de la production (rien n\'est retiré du veto)', Object.keys(st(J(), ligne(), [])), Object.keys(GC.statuts(J(), ligne())));
    H.v('0c. les règles sont nommées et fermées', CI.REGLES, ['attaque-traduite', 'promo-prefixe', 'symbole-isole']);
}
// ── (1) attaque-traduite
{
    const prod = GC.statuts(J(), ligne());
    H.v('1a. (production) l\'attaque lue « Occult Number » face à « Ominous Numbers » : ko — la cause des faux contredits', prod.attaque, 'ko');
    H.v('1b. carte japonaise, numéro ET total concordent : l\'attaque devient inconnue (?), le reste est inchangé', st(J(), ligne(), []), { ...prod, attaque: '?' });
    H.v('1c. numéro ET code concordent (total non lu) : inconnue', st(J({ total: null }), ligne(), []).attaque, '?');
    H.v('1d. 🔴 langue lue = EN : l\'attaque est une lecture directe, le ko reste', st(J({ langue: 'EN' }), ligne({ tirageSource: 'intl' }), []).attaque, 'ko');
    H.v('1e. 🔴 langue lue absente : on ne sait pas qu\'elle est traduite, le ko reste', st(J({ langue: null }), ligne({ tirageSource: 'jp' }), []).attaque, 'ko');
    H.v('1f. 🔴 le numéro ne concorde pas (non lu) : le ko reste (une seule donnée rigide ne suffit pas)', st(J({ numero: null }), ligne(), []).attaque, 'ko');
    H.v('1g. 🔴 numéro concordant seul (ni total ni code lus) : le ko reste', st(J({ total: null, setCode: null }), ligne(), []).attaque, 'ko');
    H.v('1h. 🔴 numéro qui CONTREDIT : ko partout, l\'attaque reste ko', [st(J({ numero: '999' }), ligne(), []).numero, st(J({ numero: '999' }), ligne(), []).attaque], ['ko', 'ko']);
    const jumeau = { nomCardmarket: ligne().nomCardmarket, tirageSource: 'jp', numero: '077' };
    H.v('1i. 🔴 un AUTRE candidat est le jumeau du désigné (même nom, même tirage, même numéro) : l\'attaque ne les sépare pas, le ko reste', st(J(), ligne(), [jumeau]).attaque, 'ko');
    H.v('1j. un candidat de même nom mais d\'un autre numéro n\'est pas un jumeau : inconnue', st(J(), ligne(), [{ ...jumeau, numero: '078' }]).attaque, '?');
    H.v('1k. un candidat de même nom et de même numéro mais d\'un autre tirage n\'est pas un jumeau : inconnue', st(J(), ligne(), [{ ...jumeau, tirageSource: 'intl' }]).attaque, '?');
    H.v('1o. 🔴 un candidat d\'un AUTRE nom (même tirage, même numéro) n\'est pas un jumeau : inconnue', st(J(), ligne(), [{ ...jumeau, nomCardmarket: 'Autre [Gamma]' }]).attaque, '?');
    H.v('1l. une attaque qui CONCORDE reste ok (la règle ne fabrique jamais un ok)', st(J({ attaque: 'Max Shadow' }), ligne(), []).attaque, 'ok');
    H.v('1m. le français est non anglais aussi : « Poison Whip » face à « Poisonous Whip », numéro et total concordent', st(lu({ numero: 'TG02', total: '30', langue: 'FR', attaque: 'Poison Whip' }), ligne({ numero: 'TG02', total: 'TG30', set: { code: 'LOR' }, tirageSource: 'intl', nomCardmarket: 'Roserade [Poisonous Whip | Assassin\'s Rose]' }), []).attaque, '?');
    H.v('1n. 🔴 aucune des règles n\'efface un autre champ : numéro, total et langue contradictoires restent ko', ['numero', 'total', 'langue'].map(k => st(J({ numero: '999', total: '1', langue: 'FR' }), ligne(), [])[k]), ['ko', 'ko', 'ko']);
}
// ── (2) promo-prefixe
{
    const promo = (l, g) => st(lu({ symboleSet: 'promo-etoile', langue: 'FR', ...l }), ligne({ tirageSource: 'intl', nomCardmarket: 'Hoopa EX [Hyperspace Ring | Wonder Trick]', total: null, ...g }), []);
    H.v('2a. (production) « XY85 » code lu XY face à XYPR 85 : le code est ko', GC.statuts(lu({ numero: 'XY85', setCode: 'XY', langue: 'FR' }), ligne({ numero: '85', total: null, set: { code: 'XYPR' }, tirageSource: 'intl' })).code, 'ko');
    H.v('2b. le préfixe du numéro EST le code (XY85, code lu XY) : le code n\'est plus ko', promo({ numero: 'XY85', setCode: 'XY' }, { numero: '85', set: { code: 'XYPR' } }).code, '?');
    H.v('2c. DP19 / DPPR', promo({ numero: 'DP19', setCode: 'DP' }, { numero: '19', set: { code: 'DPPR' } }).code, '?');
    H.v('2d. SM46 : la carte imprime le set d\'origine (BUS) sur une promo à étoile, Cardmarket range en SM', promo({ numero: 'SM46', setCode: 'BUS' }, { numero: '46', set: { code: 'SM' } }).code, '?');
    H.v('2e. XY46 imprimé ROS, rangé XYPR', promo({ numero: 'XY46', setCode: 'ROS' }, { numero: '46', set: { code: 'XYPR' } }).code, '?');
    H.v('2k. le code lu EST le préfixe (XY) sans étoile de promo : inconnu aussi', promo({ numero: 'XY85', setCode: 'XY', symboleSet: 'aucun' }, { numero: '85', set: { code: 'XYPR' } }).code, '?');
    H.v('2f. 🔴 un AUTRE préfixe que la famille du code Cardmarket (SM46 face à XYPR 46) : le code reste ko', promo({ numero: 'SM46', setCode: 'BUS' }, { numero: '46', set: { code: 'XYPR' } }).code, 'ko');
    H.v('2g. 🔴 les chiffres diffèrent (XY85 face à XYPR 86) : le numéro contredit… ou ne concorde pas, et le code reste ko', promo({ numero: 'XY85', setCode: 'XY' }, { numero: '86', set: { code: 'XYPR' } }).code, 'ko');
    H.v('2h. 🔴 sans étoile de promo et un code lu qui n\'est pas le préfixe (BUS) : le code reste ko', promo({ numero: 'SM46', setCode: 'BUS', symboleSet: 'aucun' }, { numero: '46', set: { code: 'SM' } }).code, 'ko');
    H.v('2i. 🔴 le numéro du catalogue porte une lettre (TG13) : la convention ne s\'applique pas', promo({ numero: 'XY13', setCode: 'XY' }, { numero: 'TG13', set: { code: 'XYPR' } }).code, 'ko');
    H.v('2j. 🔴 un numéro lu sans préfixe (85) : rien ne désigne la famille, le code reste ko', promo({ numero: '85', setCode: 'XY' }, { numero: '85', set: { code: 'XYPR' } }).code, 'ko');
}
// ── (3) symbole-isole
{
    const l = J({ symboleSet: 'e5' }), g = ligne();
    H.v('3a. (production) le symbole e5 lu sur un set s8b : ko', GC.statuts(l, g).symbole, 'ko');
    H.v('3b. numéro ET total concordent : le symbole isolé devient inconnu', st(l, g, []).symbole, '?');
    H.v('3c. 🔴 le total n\'est pas lu : le ko reste', st({ ...l, total: null }, g, []).symbole, 'ko');
    H.v('3d. 🔴 le numéro n\'est pas lu : le ko reste', st({ ...l, numero: null }, g, []).symbole, 'ko');
    H.v('3e. un symbole qui concorde reste ok', st(J({ symboleSet: 'e3', setCode: null }), ligne({ set: { code: 'EC3' }, numero: '077', total: '184' }), []).symbole, 'ok');
}
// ── (4) ne lève jamais, rend la production quand il ne sait pas
{
    H.v('4a. lecture absente : tous inconnus (comme la production)', st(null, ligne(), []), GC.statuts(null, ligne()));
    H.v('4b. ligne absente : tous inconnus', st(J(), null, []), GC.statuts(J(), null));
    H.v('4c. `autres` absent ou absurde : traité comme aucun autre candidat', [st(J(), ligne(), undefined).attaque, st(J(), ligne(), 'x').attaque, st(J(), ligne(), [null, 3]).attaque], ['?', '?', '?']);
    H.v('4d. une ligne absurde ne lève pas', typeof st(J(), { numero: {}, set: 3, nomCardmarket: 5 }, []), 'object');
    H.v('4e. 🔴 une correction qui lèverait (un autre candidat illisible) rend les statuts de la production, sans lever', (() => { try { return st(J(), ligne(), [{ get nomCardmarket() { throw new Error('x'); } }]).attaque; } catch { return 'leve'; } })(), 'ko');
}
// ── (5) la règle SUR-PAR-IMAGE : le drapeau `comparateur` de decider()
const M = G.SEUILS_G.marge_carte;
const dec = (over = {}, comparateur) => {
    const ctx = G.contexte({ groupe: {}, carte: { k1: [1], k2: [2] }, invisibles: {}, produits: { k1: [[101, 1.0]], k2: [[102, 1.0]] } });
    return SPI.decider({
        ids: [101, 102], cles: new Map([[101, 'k1'], [102, 'k2']]), cosinus: c => ({ k1: 0.60, k2: 0.60 - M - 0.05 })[c], top1: 'k1', contexte: ctx,
        signaux: () => ({ basse: false, partageAutreDessin: false }), emprunte: () => false, partages: () => [], jumeaux: () => ({ conclu: true, ids: [] }),
        produits: new Map([[101, ligne({ idProduct: 101 })], [102, ligne({ idProduct: 102, numero: '002', nomCardmarket: 'Autre [Gamma]' })]]), lu: J(), marquesLues: null, redressee: true,
        ...(comparateur === undefined ? {} : { comparateur }), ...over
    });
};
{
    H.v('5a. sans le drapeau : l\'attaque traduite contredit le désigné (comme avant)', [dec().sur, dec().motif], [false, 'contredit']);
    H.v('5b. drapeau éteint explicitement : de même', dec({}, false).motif, 'contredit');
    H.v('5c. 🔑 drapeau allumé : le sûr tient, c\'est 101', [dec({}, true).sur, dec({}, true).produit], [true, 101]);
    H.v('5d. drapeau allumé, MAIS un jumeau du désigné parmi les candidats : le veto de l\'attaque reste', dec({ produits: new Map([[101, ligne({ idProduct: 101 })], [102, ligne({ idProduct: 102 })]]) }, true).motif, 'contredit');
    H.v('5e. drapeau allumé, numéro lu qui contredit : le veto reste', dec({ lu: J({ numero: '999' }) }, true).motif, 'contredit');
    H.v('5f. drapeau allumé, langue lue EN face à un tirage jp : le veto de la langue reste', dec({ lu: J({ langue: 'EN' }) }, true).motif, 'contredit');
    H.v('5g. drapeau allumé : toutes les autres conditions tiennent (écart trop faible : se tait)', dec({ cosinus: c => ({ k1: 0.60, k2: 0.58 })[c] }, true).motif, 'ecart');
    H.v('5h. le drapeau doit être EXACTEMENT true (une chaîne, 1, ne l\'allume pas)', [dec({}, 'oui').motif, dec({}, 1).motif], ['contredit', 'contredit']);
}
// ── (6) la configuration et la route
const COS = [0.95, 0.60];
const cles = ['spc/k0.webp', 'spc/k1.webp'];
const matrice = new Float32Array(COS.length * E.DIM);
COS.forEach((a, i) => { for (let j = 0; j < 4; j++) matrice[i * E.DIM + j] = a * 0.5; matrice[i * E.DIM + 4 + i] = Math.sqrt(1 - a * a); });
const contexte = () => ({ groupe: {}, carte: Object.fromEntries(cles.map((c, i) => [c, [3000 + i]])), invisibles: {}, produits: Object.fromEntries(cles.map((c, i) => [c, [[100 + i * 100, 1.0]]])) });
const CLE = { 100: 0, 200: 1 };
const installer = () => { const o = X.ouvrir(X.sceller({ cles, matrice, contexte: contexte(), modele: A.MODELE, chargeLe: '2026-10-26T10:00:00.000Z' }, A.SECRET), A.SECRET, { modeleAttendu: A.MODELE }); etat.installer(Object.freeze({ index: o.index, meta: o.meta })); };
const entreeAvec = () => { const p = new Float32Array(E.DIM); for (let j = 0; j < 4; j++) p[j] = 0.5; return { empreintes: VE.lireEnveloppe({ modeleEmpreinte: A.modeleAnnonce(), empreintes: [{ photo: 0, vecteur: E.encoderVecteur(p), redressee: true }] }, 1) }; };
const version = () => ({ entree: id => (id in CLE ? { grande: { cle: cles[CLE[id]] }, vignette: { cle: `v/${id}.webp` }, idMetacard: 5000 + id, basseDefinition: false, mention: null } : null), empruntDe: () => false, identifiants: () => [100, 200], colonneMarquages: true, partagesDe: () => [] });
const lignes = new Map([[100, ligne({ idProduct: 100 })], [200, ligne({ idProduct: 200, numero: '002', nomCardmarket: 'Autre [Gamma]' })]]);
const corps = { success: true, candidats: [{ idProduct: 100 }, { idProduct: 200 }], carte: { ambigu: true, numero: '077', total: '184', setCode: 's8b', langue: 'JP' }, lectureGarde: { numero: '077', total: '184', setCode: 's8b', langue: 'JP', attaque: 'Occult Number', attaqueConfiance: 'haute' } };
const question = { issue: 'question', analyse: { cartes: [{ statut: 'a-trancher', candidats: [{ idProduct: 100 }, { idProduct: 200 }] }] } };
const ENV = { ...A.ENV_EMPREINTE, V2_SUR_PAR_IMAGE: '1' };
const appel = (cfg) => consulterSurParImage({
    cfg, entree: entreeAvec(), resultat: question, corpsChaine: corps, produits: lignes, version: version(), jumeaux: () => ({ conclu: true, ids: [] }),
    affirmer: (id, s, critere) => ({ issue: 'affirmee', analyse: { cartes: [{ statut: 'identifiee', carte: { idProduct: id } }] }, critere }), journal: () => { }
});
(async () => {
    {
        let refuse = false; try { lireConfig({ MONGODB_BASE: 'test_scratch', V2_SPI_COMPARATEUR: 'oui' }); } catch { refuse = true; }
        H.v('6a. la configuration livrée n\'allume pas le comparateur ; « 1 » l\'allume ; toute autre valeur est refusée', [lireConfig({ MONGODB_BASE: 'test_scratch' }).spiComparateur, lireConfig({ MONGODB_BASE: 'test_scratch', V2_SPI_COMPARATEUR: '1' }).spiComparateur, refuse], [false, true, true]);
    }
    installer();
    {
        const sans = await appel(lireConfig(ENV));
        H.v('6b. la route SANS V2_SPI_COMPARATEUR : la question reste, motif « contredit » (comme avant)', [sans && !sans.resultat, sans && sans.trace && sans.trace.motif], [true, 'contredit']);
        const avec = await appel(lireConfig({ ...ENV, V2_SPI_COMPARATEUR: '1' }));
        H.v('6c. 🔑 la route AVEC V2_SPI_COMPARATEUR : le désigné (100) est affirmé', [avec && avec.resultat && avec.resultat.analyse.cartes[0].carte.idProduct, avec && avec.trace.issue], [100, 'sur']);
        const seul = await appel(lireConfig({ ...A.ENV_EMPREINTE, V2_SPI_COMPARATEUR: '1' }));
        H.v('6d. le comparateur SANS V2_SUR_PAR_IMAGE : rien n\'est consulté (null)', seul, null);
    }
    H.bilan();
})();
