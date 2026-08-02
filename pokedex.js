// ============================================================
// LE NOMBRE IMPRIMÉ EST-IL UN NUMÉRO DE POKÉDEX ?
// ============================================================
// LA CAUSE RACINE DU VINTAGE JAPONAIS. Sur les cartes japonaises de 1996 à 2003, le
// nombre imprimé au recto est le numéro national de l'ESPÈCE, pas le rang de la carte
// dans son set. Cardmarket, lui, numérote autrement — ou pas du tout :
//   Raichu     lu 026 (Pokédex #26)   -> Cardmarket : Raichu-IPB3, donc 3
//   Jigglypuff lu 039 (#39)           -> Jungle, No.039
//   Tangela    lu 114 (#114)          -> Expansion Pack, aucun numéro publié
//   Koga's Ditto lu 132 (#132)        -> Challenge from the Darkness, aucun numéro
// Pendant des jours, la chaîne a cherché un numéro de carte avec un numéro d'espèce. Tous
// les symptômes qu'on avait traités séparément — « aucun candidat au numéro lu », le
// troisième état du nom, les désaccords de numéro qui rendaient le NOM suspect alors qu'il
// était juste — venaient de là.
//
// L'AGGRAVANT : quatre sets sont NUMÉROTÉS DANS L'ORDRE DU POKÉDEX (xsv2a 100 %, MEW 83 %,
// sv2a 80 %, 151C 78 %). Un numéro de Pokédex y trouve toujours une correspondance
// plausible et fausse — d'où trois scans consécutifs atterris sur des candidats 151C.
//
// LA PORTÉE DE LA RÈGLE EST VOLONTAIREMENT ÉTROITE, et chaque borne est mesurée :
//
//   1. LANGUE ASIATIQUE. Les promos occidentales sont elles aussi sans total ; on ne sait
//      pas encore si elles échouent de la même façon. On n'élargit pas avant de mesurer.
//
//   2. AUCUN TOTAL LU. C'est la borne qui fait tout le travail. Une carte qui porte
//      « 017/088 » est numérotée à la moderne : la coïncidence avec un dexId y est un
//      hasard, pas une règle. Mesuré sur le journal : des 11 scans où le numéro lu égale
//      le dexId, 8 sont sans total (tous de vrais déclenchements) et 3 ont un total —
//      les trois Charmander McDonald's, dont le 004 EST le vrai numéro de carte et dont
//      la chaîne a besoin pour trouver MCDP. Sans cette borne, la règle cassait le seul
//      cas qu'on venait de réparer.
//
//   3. LE NOM DOIT ÊTRE CONNU. Un nom absent de la table ne prouve rien (principe des
//      sources perdues, voir scoring.js) : la règle ne se déclenche pas.
//
// RISQUE MESURÉ. Sur tout le catalogue, 885 produits sur 48 262 (1,83 %) ont un numéro de
// carte qui coïncide avec le dexId de leur espèce. Mais 746 d'entre eux sont dans les
// quatre sets ordonnés par le Pokédex : PARTOUT AILLEURS, la coïncidence tombe à
// 139 sur 65 249, soit 0,21 %. Un cas sur cinq cents, avant même les bornes ci-dessus.

const { normaliserNomPourComparaison } = require('./scoring');

// Chargé une fois au require. 53 Ko, 2845 noms — négligeable en mémoire, et surtout
// AUCUN appel réseau sur le chemin critique. Voir construire-table-pokedex.js.
let TABLE = {};
try {
    TABLE = require('./pokedex-dexids.json');
} catch (e) {
    // Table absente : la règle ne se déclenchera jamais. C'est la bonne dégradation —
    // on revient au comportement d'avant, on n'invente pas de numéro.
    console.warn(`⚠️ [pokedex] table introuvable (${e.message}) — la règle du numéro de Pokédex est INACTIVE.`);
}

const LANGUES_ASIATIQUES = ['JP', 'ZH', 'KR'];
// Même extraction de chiffres que partout ailleurs. Ne pas la diverger.
const chiffres = n => { const m = String(n ?? '').match(/\d+/); return m ? parseInt(m[0], 10) : null; };

/**
 * Numéros de Pokédex associés à ce nom de carte, ou null si le nom est inconnu.
 * Le nom peut être celui d'un dresseur : « Koga's Ditto » rend [132].
 * @returns {number[]|null}
 */
function dexIdsDuNom(nom) {
    if (!nom) return null;
    const k = normaliserNomPourComparaison(String(nom).split('[')[0]);
    return TABLE[k] || null;
}

/**
 * Le nombre lu sur la carte est-il le numéro de Pokédex de l'espèce nommée, plutôt que le
 * numéro de la carte dans son set ?
 *
 * @param {object} lu
 * @param {string} lu.nom      le nom lu par l'IA (translittéré)
 * @param {string} lu.numero   le nombre lu au recto
 * @param {string} lu.total    le dénominateur imprimé, s'il y en a un
 * @param {string} lu.langue   la langue de la CARTE
 * @returns {{estDex: boolean, dexId: number|null, raison: string}}
 */
function numeroEstUnDexId({ nom, numero, total, langue } = {}) {
    const n = chiffres(numero);
    if (n == null) return { estDex: false, dexId: null, raison: 'aucun numéro lu' };
    if (!LANGUES_ASIATIQUES.includes(String(langue || '').toUpperCase())) {
        return { estDex: false, dexId: null, raison: 'langue non asiatique -> hors périmètre' };
    }
    // Un total imprimé signe une numérotation moderne : le nombre est alors un vrai rang
    // de carte, et une coïncidence avec le dexId n'est qu'une coïncidence.
    if (total != null && String(total).trim() !== '' && chiffres(total) != null) {
        return { estDex: false, dexId: null, raison: `total ${total} imprimé -> numérotation moderne` };
    }
    const dex = dexIdsDuNom(nom);
    if (!dex) return { estDex: false, dexId: null, raison: `espèce "${nom}" inconnue de la table -> aucune preuve` };
    if (!dex.includes(n)) return { estDex: false, dexId: null, raison: `n°${n} ≠ dexId ${dex.join('/')} -> vrai numéro de carte` };

    return {
        estDex: true, dexId: n,
        raison: `n°${n} = numéro de Pokédex de ${nom}, et la carte ne porte aucun total -> ce n'est pas un numéro de carte`
    };
}

module.exports = { dexIdsDuNom, numeroEstUnDexId, LANGUES_ASIATIQUES };
