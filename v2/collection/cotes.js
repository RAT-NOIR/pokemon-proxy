'use strict';
// COTES-VISUELS — les COTES de « Ma collection » (CONTRAT-API-V2.md §1.8). Pour chaque fiche du set connue du lien EN MÉMOIRE (v2/chargeur : fiche → produits), { tendance, date } lus dans
// `guide_prix` (la base de l'API) :
//   · une fiche à UN produit a la cote de ce produit ;
//   · à PLUSIEURS, une cote seulement si TOUS ont la même tendance ET la même date de guide ; sinon null. Jamais une moyenne, un minimum ni un maximum ;
//   · un produit sans guide, à tendance nulle ou à date illisible n'a pas de cote (un prix non daté n'est pas servi) ; une fiche dont un produit n'a pas de cote : null.
// UNE seule requête `guide_prix` par appel, bornée aux produits du set et à trois champs. Aucune version chargée ou set sans lien : {} (l'état « sans visuel », le site lit {} comme null).
const etat = require('../chargeur/etat');
const { prix, dateGuide } = require('../identifier/visuels');

const PRODUITS_MAX = 20000;                                  // un set réel en compte quelques milliers : au-delà, on ne lit pas (la réponse reste {})

async function cotesDuSet(slug, { version = () => etat.version(), col = nom => require('../db').col(nom) } = {}) {
    const v = version();
    if (!v || typeof slug !== 'string') return {};
    const fiches = v.fichesDuSet(slug);
    if (!fiches.length) return {};
    const ids = [...new Set(fiches.flatMap(f => f.produits))];
    if (ids.length > PRODUITS_MAX) return {};
    const lignes = await col('guide_prix').find({ idProduct: { $in: ids } }, { projection: { _id: 0, idProduct: 1, trend: 1, guideDu: 1 } }).toArray();
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
module.exports = { cotesDuSet, PRODUITS_MAX };
