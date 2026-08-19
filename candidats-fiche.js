// ============================================================
// LES CANDIDATS D'UNE LIGNE DE JOURNAL — une seule définition
// ============================================================
// POURQUOI CE MODULE EXISTE. La saisie des vérités se fait désormais SUR FICHE : le
// testeur lit une liste de candidats préparée à l'avance et répond « #3 », au lieu
// d'ouvrir des fiches Cardmarket pour en copier l'URL. Deux programmes ont donc besoin
// de la MÊME liste, dans le MÊME ordre : le générateur de fiches et `saisir-verites.js`.
//
//   ⚠️ DEUX CONSTRUCTIONS DE LA MÊME LISTE DIVERGERAIENT, et la divergence serait
//   SILENCIEUSE ET CHÈRE : « #3 » désignerait une carte dans la fiche et une autre dans
//   l'outil, et la vérité enregistrée serait fausse sans que rien ne le signale. C'est le
//   motif des deux définitions de l'identité (banc-seaux.js), avec un coût pire — là on
//   perdait des rattachements, ici on fabriquerait des vérités fausses.
//
// ⚠️ LE VIVIER VIENT DE LA CHAÎNE, PAS D'UNE REGEX. `trouverProduitsLocaux` puis
// `scorerCandidatsLocal`, exactement comme la production — jamais une recherche par nom
// réécrite ici. Une liste reconstruite autrement mesurerait une chaîne qui n'existe pas.
//
// ⚠️ CE QU'IL FAUT SAVOIR DE SES LIMITES, ET C'EST POURQUOI « AUCUN DE CEUX-LÀ » EXISTE :
// cette reconstruction hors ligne n'est PAS identique à la production. Elle part du nom
// LU, quand la route part du `nomExact` que TCGdex lui rend ; mesuré, les deux divergent
// sur 24,8 % des gagnants. La bonne carte peut donc être absente de la liste — et quand
// elle l'est, ce n'est pas au testeur de se rabattre sur un candidat approchant : c'est
// un DÉFAUT DE PÉRIMÈTRE, et il s'enregistre comme tel.

const { numeroEstUnDexId } = require('./pokedex');
const { trouverProduitsLocaux, scorerCandidatsLocal, lireCodeSets, lireNumeros } = require('./index');

// Le nombre de candidats montrés. 15 était déjà la borne de l'affichage historique.
const MAX_CANDIDATS = 15;

/** L'URL Cardmarket d'un produit, construite EN LOCAL depuis les slugs appris. */
function urlCardmarket(num) {
    if (!num || !num.slug || !num.slugSet) return null;
    return `https://www.cardmarket.com/fr/Pokemon/Products/Singles/${num.slugSet}/${num.slug}`;
}

/** « Base-Expansion-Pack » -> « Base Expansion Pack ». Le slug EST le nom lisible. */
const nomDeSet = num => (num && num.slugSet) ? String(num.slugSet).replace(/-/g, ' ') : null;

/**
 * Un produit lu DIRECTEMENT au catalogue, hors de tout vivier.
 * ⚠️ Réservé au produit RETENU par la production quand la reconstruction du vivier ne le
 * contient pas. Jamais pour proposer un candidat : proposer une carte que la chaîne
 * n'aurait jamais pu atteindre reviendrait à fabriquer un choix qui n'a pas existé.
 */
async function produitDirect(idProduct) {
    const mongoose = require('mongoose');
    if (mongoose.connection.readyState !== 1) return null;
    const p = await mongoose.connection.collection('catalogue_produits').findOne({ idProduct: Number(idProduct) });
    if (!p) return null;
    const num = await mongoose.connection.collection('numeros_cartes').findOne({ idProduct: Number(idProduct) });
    const cs = await mongoose.connection.collection('codes_set').findOne({ idExpansion: Number(p.idExpansion) });
    return {
        idProduct: Number(idProduct),
        nom: String(p.name ?? '').split('[')[0].trim(),
        nomComplet: String(p.name ?? ''),
        codeSet: cs?.codeSet ?? null,
        nomSet: nomDeSet(num),
        region: cs?.region ?? null,
        numero: num?.numero ?? num?.numeroUrl ?? null,
        variante: num?.variante ?? null,
        prix: null,
        url: urlCardmarket(num)
    };
}

/**
 * Construit la liste des candidats d'une ligne de journal.
 *
 * ORDRE : PAR PRIX CROISSANT, et c'est délibéré — l'ordre du scoring désignerait un
 * favori, et le premier de la liste deviendrait la réponse par défaut. Le banc mesurerait
 * alors l'accord du testeur avec la chaîne, pas la vérité.
 *
 * ⚠️ LE PRODUIT RETENU PAR LA PRODUCTION EST SORTI DE LA LISTE ET RENDU À PART. Il ne
 * porte pas de numéro de choix : on ne peut pas le désigner par « #N » sans l'avoir vu
 * nommé comme tel. C'est la dernière chose qu'on regarde, jamais la première.
 *
 * @param {object} d  une ligne de journal_scans
 * @returns {Promise<{total:number, liste:object[], retenu:object|null, aucun:boolean}>}
 */
async function construireCandidats(d) {
    const dex = numeroEstUnDexId({ nom: d.nom, numero: d.numero, total: d.total, langue: d.langue });
    const produits = await trouverProduitsLocaux(d.nom);
    if (!produits.length) return { total: 0, liste: [], retenu: null, aucun: true };

    const cs = await lireCodeSets(produits.map(p => p.idExpansion));
    const r = await scorerCandidatsLocal(produits, {
        name: d.nom, number: dex.estDex ? null : d.numero, total: d.total, setCode: d.setCode,
        language: d.langue, motif: null, reverse: false
    }, null, [], cs, {});

    const nums = await lireNumeros(r.scores.map(s => s.candidat.idProduct));
    const codes = await lireCodeSets(r.scores.map(s => s.candidat.idExpansion));
    const retenuId = d.idProduct != null ? Number(d.idProduct) : null;

    const fiche = s => {
        const p = produits.find(x => x.idProduct === s.candidat.idProduct);
        const num = nums.get(s.candidat.idProduct);
        const c = codes.get(Number(s.candidat.idExpansion));
        return {
            idProduct: s.candidat.idProduct,
            nom: String(p?.name ?? '').split('[')[0].trim(),
            nomComplet: String(p?.name ?? ''),
            codeSet: c?.codeSet ?? null,
            nomSet: nomDeSet(num),
            region: c?.region ?? null,
            numero: num?.numero ?? num?.numeroUrl ?? null,
            variante: num?.variante ?? null,
            prix: Number.isFinite(s.candidat.prix) ? s.candidat.prix : null,
            url: urlCardmarket(num)
        };
    };

    // Le retenu sort du lot AVANT la troncature : sinon il pourrait disparaître de la
    // fiche selon son prix, et le testeur ne saurait jamais ce que la chaîne avait dit.
    const tous = r.scores.map(fiche);
    let retenu = retenuId != null ? (tous.find(x => x.idProduct === retenuId) ?? null) : null;

    // ⚠️ LE RETENU PEUT ÊTRE ABSENT DU VIVIER RECONSTRUIT, ET IL FAUT LE MONTRER QUAND
    // MÊME. Mesuré sur les 29 fiches du holdout : 7 cas, dont « Wooloo » — un SUCCÈS dont
    // le produit retenu (« Hop's Wooloo ») n'apparaît pas dans un vivier bâti sur le nom
    // LU. C'est la divergence connue entre cette reconstruction et la production, qui part
    // du `nomExact` de TCGdex. Le passer sous silence laisserait croire que la chaîne
    // n'avait rien retenu, alors qu'elle avait retenu quelque chose que le vivier local ne
    // contient pas — ce qui est une information, et plutôt une information importante.
    if (retenuId != null && !retenu) {
        const direct = await produitDirect(retenuId);
        if (direct) retenu = { ...direct, absentDuVivier: true };
    }
    const liste = tous
        .filter(x => x.idProduct !== retenuId)
        .sort((a, b) => (a.prix ?? Infinity) - (b.prix ?? Infinity))
        .slice(0, MAX_CANDIDATS)
        .map((x, i) => ({ rang: i + 1, ...x }));

    return { total: r.scores.length, liste, retenu, aucun: false };
}

module.exports = { construireCandidats, urlCardmarket, nomDeSet, MAX_CANDIDATS };
