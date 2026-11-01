'use strict';
// DECISION-SURS (01/11/2026) — la PROMOTION d'un PROBABLE en SÛR : S2 ∪ S3 ∪ I(0,2), derrière V2_PROMOTION_SURS (éteint par défaut). Module PUR (ni base, ni réseau, ni modèle).
// Mesure : decision-surs-report.md (459 lignes, 0 sûr faux, +76 sûrs justes). Chaque composant est une sortie de la PRODUCTION (critere-a.conditions, garde-contradiction, nom-compatible, sur-par-image.MARGE) ; rien n'est recopié.
// 🔑 Écrit par ce qu'il AUTORISE : un seul chemin mène à « promu » — I2 et I3 tenus ET (S ou I). Toute donnée absente ou illisible, tout jumeau inconnu (null), toute exception : « non promu » et la raison dite.
//   S (S2 ∪ S3) : le critère A de la production sur le désigné et ses VRAIS jumeaux (`version.jumeauxDe`, toute la métacarte), avec deux paramètres : l'attaque lue ne bloque plus, et le numéro d'un jumeau peut être inconnu
//       tant qu'aucun ne concorde. Sans jumeau c'est S3 (numéro exact, code exact, aucun autre champ ne contredit, nom) ; avec des jumeaux c'est S2. Des jumeaux INCONNUS (null) ne sont jamais « aucun jumeau ».
//   I : le désigné est le voisin n°1 de l'index entier, l'écart de COSINUS au second du classement >= MARGE (0,2, la marge de SUR-PAR-IMAGE), aucun champ lu ne le contredit (l'attaque non plus), tous ses jumeaux
//       ont leur ligne et sont au pool, le nom ne le contredit pas.
// Ne s'applique JAMAIS qu'à un probable (la décision d'appeler est dans leviers-abde.js) : cette fonction ne choisit pas le désigné, elle juge s'il peut être affirmé.
const GC = require('./garde-contradiction');
const CA = require('./critere-a');
const { formesLuesDe, nomCompatible } = require('./nom-compatible');
const { MARGE } = require('./sur-par-image');

const MAX_JUMEAUX = 100;                          // au plus 100 jumeaux lus (le plus grand groupe mesuré : 98) ; au-delà, aucune promotion : jamais une lecture sans fin du catalogue
const TOLERANCE = 1e-12;                          // « écart >= m » à l'arrondi flottant près (0,7 - 0,5 vaut 0,19999999999999996)
const entiers = xs => Array.isArray(xs) && xs.every(Number.isInteger);

function parS({ corps, id, produits, jumeaux }) {
    const c = CA.conditions({ corps, gagnant: id, autres: jumeaux, produits, champsIgnores: ['attaque'], jumeauxInconnusPermis: true });
    return c.ok ? { ok: true, regle: jumeaux.length ? 'S2' : 'S3' } : { ok: false, raison: c.raison };
}

function parI({ corps, id, produits, jumeaux, pool, second, cleDe, top1Cle }) {
    const non = raison => ({ ok: false, raison });
    const lu = GC.lectureDe(corps), ligne = produits.get(id);
    if (!lu || !ligne) return non('lecture ou ligne du désigné absente');
    const idsPool = new Set((Array.isArray(pool) ? pool : []).map(x => x && x.id));
    if (!jumeaux.every(j => produits.has(j))) return non('une ligne de jumeau manque');
    if (!jumeaux.every(j => idsPool.has(j))) return non('un jumeau est hors du pool');
    if (GC.contredire({ corps, gagnant: id, produits })) return non('la garde contradiction répond');
    if (Object.values(GC.statuts(lu, ligne)).includes('ko')) return non('un champ lu contredit le désigné');
    const cle = typeof cleDe === 'function' ? cleDe(id) : null;
    if (typeof cle !== 'string' || !cle || cle !== top1Cle) return non('le désigné n\'est pas le voisin n°1 de l\'index');
    const cos = i => { const x = (Array.isArray(pool) ? pool : []).find(y => y && y.id === i); return x && Number.isFinite(x.cos) ? x.cos : null; };
    const a = cos(id), b = cos(second);
    if (a === null || b === null || !(a - b >= MARGE - TOLERANCE)) return non('l\'écart de cosinus au second est inconnu ou sous la marge');
    const formes = formesLuesDe(corps);
    if (formes.length && !nomCompatible(formes, ligne)) return non('le nom lu contredit le désigné');
    return { ok: true, regle: 'I', ecart: Math.round((a - b) * 1e4) / 1e4 };
}

/**
 * @param corps     la réponse de la chaîne (success true) avec son bloc `lectureGarde`
 * @param id        le désigné (le probable)
 * @param produits  Map<idProduct, ligne de catalogue> : porte le désigné, ses jumeaux, le pool
 * @param jumeaux   les VRAIS jumeaux du désigné (`version.jumeauxDe(id)`), ou null quand l'archive ne conclut pas
 * @param pool      [{ id, cos }] : le pool classé de l'étape ; @param second l'idProduct du 2e du classement c3
 * @param cleDe     (idProduct) => la clé du visuel du produit dans l'archive ; @param top1Cle la clé du voisin n°1 de l'index entier
 * @param i2i3      vrai quand le désigné a un prix de guide (I2) et n'est pas de même dessin qu'un autre des 3 (I3)
 * @returns { promu: boolean, regle: 'S2'|'S3'|'I'|null, raison: string, critere: string|null }
 */
function promouvoirEnSur({ corps, id, produits, jumeaux, pool, second, cleDe, top1Cle, i2i3 } = {}) {
    const non = raison => ({ promu: false, regle: null, raison, critere: null });
    try {
        if (!Number.isInteger(id) || !(produits instanceof Map) || !produits.has(id)) return non('désigné ou ligne absente');
        if (i2i3 !== true) return non('I2 / I3 non tenus (prix de guide, même dessin)');
        if (!entiers(jumeaux)) return non('jumeaux inconnus : la colonne ne conclut pas');
        if (jumeaux.length > MAX_JUMEAUX) return non(`plus de ${MAX_JUMEAUX} jumeaux`);
        const s = parS({ corps, id, produits, jumeaux });
        if (s.ok) return { promu: true, regle: s.regle, raison: `${s.regle} : le critère A sur le désigné et ses ${jumeaux.length} jumeaux (attaque ignorée, numéro inconnu d'un jumeau permis)`, critere: `promotion en sûr (${s.regle}) : critère A sur ${jumeaux.length} jumeaux, attaque ignorée` };
        const i = parI({ corps, id, produits, jumeaux, pool, second, cleDe, top1Cle });
        if (i.ok) return { promu: true, regle: 'I', raison: `I : voisin n°1 de l'index, écart de cosinus ${i.ecart} >= ${MARGE}`, critere: `promotion en sûr (I) : voisin n°1 de l'index, écart de cosinus ${i.ecart} >= ${MARGE}` };
        return non(`S : ${s.raison} ; I : ${i.raison}`);
    } catch (e) {
        return non(`décision impossible (${(e && e.name) || 'erreur'})`);
    }
}

module.exports = { promouvoirEnSur, MAX_JUMEAUX };
