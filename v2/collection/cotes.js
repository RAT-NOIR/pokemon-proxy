'use strict';
// COTES-VISUELS — les COTES de « Ma collection » (CONTRAT-API-V2.md §1.8). Pour chaque fiche du set connue du lien EN MÉMOIRE (v2/chargeur : fiche → produits), { tendance, date } lus dans
// `guide_prix` (la base de l'API) :
//   · une fiche à UN produit a la cote de ce produit ;
//   · à PLUSIEURS, une cote seulement si TOUS ont la même tendance ET la même date de guide ; sinon null. Jamais une moyenne, un minimum ni un maximum ;
//   · un produit sans guide, à tendance nulle ou à date illisible n'a pas de cote (un prix non daté n'est pas servi) ; une fiche dont un produit n'a pas de cote : null.
// UNE seule requête `guide_prix` par appel, bornée aux produits du set et à trois champs. Aucune version chargée ou set sans lien : {} (l'état « sans visuel », le site lit {} comme null).
const etat = require('../chargeur/etat');
const { prix, dateGuide } = require('../identifier/visuels');

// BORNE DURE (revue I7 : la lecture n'est pas limitée, un compte non vérifié peut la boucler sur la grappe de production) : 5 000 produits au plus par appel — le plus gros set RÉEL en compte
// moins de la moitié (mesuré sur l'archive réelle, voir le rapport) —, trois champs, `maxTimeMS`, et l'index unique `idProduct` de `guide_prix` (schéma de import-price-guide.js, ligne 71 : la requête est un `$in` sur cette clé). Au-delà : cotes PARTIELLES, DITES au contrat
// §1.8 (les fiches qui ne tiennent pas dans la borne sont absentes de `cotes`, donc `null` pour le site) et journalisées.
const PRODUITS_MAX = 5000, DELAI_LECTURE_MS = 2000;

async function cotesDuSet(slug, { version = () => etat.version(), col = nom => require('../db').col(nom), journal = m => console.error(m) } = {}) {
    const v = version();
    if (!v || typeof slug !== 'string') return {};
    const toutes = v.fichesDuSet(slug);
    if (!toutes.length) return {};
    const vus = new Set(), fiches = [];
    for (const f of toutes) {
        const nouveaux = f.produits.filter(id => !vus.has(id));
        if (vus.size + nouveaux.length > PRODUITS_MAX) { journal(`ℹ️ [v2 collection] cotes PARTIELLES : ${fiches.length} fiches sur ${toutes.length} (borne de ${PRODUITS_MAX} produits par appel)`); break; }
        for (const id of nouveaux) vus.add(id);
        fiches.push(f);
    }
    const ids = [...vus];
    if (!ids.length) return {};
    const lignes = await col('guide_prix').find({ idProduct: { $in: ids } }, { projection: { _id: 0, idProduct: 1, trend: 1, guideDu: 1 }, maxTimeMS: DELAI_LECTURE_MS }).toArray();
    const parProduit = new Map();
    for (const l of lignes) { const t = prix(l.trend), d = dateGuide(l.guideDu); if (t !== null && d !== null) parProduit.set(l.idProduct, { tendance: t, date: d }); }
    const sortie = {};
    for (const f of fiches) {
        const cotes = f.produits.map(id => parProduit.get(id));
        const premiere = cotes[0];
        sortie[f.cle] = premiere && cotes.every(c => c && c.tendance === premiere.tendance && c.date === premiere.date) ? { tendance: premiere.tendance, date: premiere.date } : null;
    }
    return sortie;
}
module.exports = { cotesDuSet, PRODUITS_MAX, DELAI_LECTURE_MS };
