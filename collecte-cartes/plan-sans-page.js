// ============================================================
// LE PLAN D'UNE COLLECTE « SANS PAGE » — une définition, pour la collecte ET pour la simulation (lot CEL, 2026-10-13)
// ============================================================
// Extrait de collecteur-texte.js (branche `bulba.sansPage`) au moment où un second appelant est apparu : la simulation à blanc de la recollecte de
// Celebrations. 🔑 Une simulation qui recopie la jointure fabrique le défaut qu'elle mesure (en tête du catalogue) : c'est la MÊME fonction que la
// collecte qui calcule, et la collecte n'ajoute que ses effets (écriture, journal).
// Pur : aucune lecture de base, aucune écriture, aucun log.
const { joindre } = require('./jointure');
const { gardeNomSeul, numerosExacts } = require('./garde-nom-seul');

/**
 * @param {{ cartesDuSet: object[], produitsLus: object[], L: object, slugCardmarket: string|null }} x
 *        `cartesDuSet` : les cartes qui déclarent l'expansion (tirage + nom) ; `produitsLus` : `produitsDeLExpansion()` ; `L` : la ligne de table
 * @returns {{ J: object, produits: object[], G: object|null, exact: object|null }}
 *        `J` : le retour de `joindre()` — pour `nomSeul`, ses lignes sont celles de la garde ; `G` : la garde (null hors `nomSeul`)
 */
function planSansPage({ cartesDuSet, produitsLus, L, slugCardmarket }) {
    const TIRAGE = L.bulba.tirage || 'jp';
    const nomsCibles = [].concat(L.bulba.expansion);
    // `nomSeul` = LE NOM SEUL, numéros MASQUÉS (2026-10-05) : c'est la situation que la garde a calibrée (rejouer-nom-seul.js, « numéros
    // masqués des deux côtés »). Sans masque, un kit à deux decks (Master Kit) ne joignait RIEN — ses numéros désignent deux cartes —
    // et Celebrations perdait sa Classic Collection, numérotée comme ses sets d'origine. Sans effet sur UNP et les séries du 2026-09-26 :
    // leurs produits n'ont aucun numéro.
    const produits = L.bulba.nomSeul ? produitsLus.map(p => ({ ...p, numero: null })) : produitsLus;
    let J = joindre(cartesDuSet, produits, { idExpansion: L.exp, expansionBulba: L.bulba.expansion, deck: L.bulba.deck || null, suffixesParDeck: L.bulba.suffixesParDeck || null, prefixesParDeck: L.bulba.prefixesParDeck || null, prefixesParJeton: L.bulba.prefixesParJeton || null, prefixesParSection: L.bulba.prefixesParSection || null, tirage: TIRAGE, slugSet: slugCardmarket });
    if (!L.bulba.nomSeul) return { J, produits, G: null, exact: null };
    // `nomSeul` : une expansion SANS AUCUN numéro (Unnumbered Promos) ne se joint que par le nom. La garde bidirectionnelle
    // calibrée (collecte-cartes/garde-nom-seul.js : 21 925 justes, 0 faux) décide ; ce qu'elle refuse reste un produit sans
    // carte, AVEC sa raison — un refus nommé, pas un silence.
    // 🔑 CEL (2026-10-13) : la jointure a masqué les numéros (la Classic Collection porte « 2 », le tirage principal « 002 » : dé-masquer ferait perdre à Blastoise sa jointure),
    // mais la GARDE reçoit les numéros ORIGINAUX — exacts, zéros de tête gardés — pour rattraper les homonymes qu'un numéro (ou nom + attaques exactes) désigne seul.
    // 🔑 LES DEUX CLÉS S'OUVRENT PAR LA TABLE, LIGNE PAR LIGNE (`bulba.cles`) : mesuré le 2026-10-13, la clé nom + attaques exactes rattrape aussi 47 lignes d'UNP et des six Gym chinois,
    // que ce lot n'a pas à décider. Une ligne sans `cles` joint exactement comme avant.
    const cles = L.bulba.cles || [];
    const exact = cles.includes('numero-exact') ? numerosExacts({ produits: produitsLus, cartes: cartesDuSet, tirage: TIRAGE, expansions: nomsCibles, deck: L.bulba.deck || null, code: L.code }) : null;
    const G = gardeNomSeul({ lignes: J.lignes, produits, cartes: cartesDuSet, exact, attaquesExactes: cles.includes('attaques-exactes') });
    const nomDe = new Map(produits.map(p => [p.idProduct, p.nom]));
    // `numeroFiche` (relecture du 2026-10-05) : le masque le laissait vide, et le site retombait sur la devinette par le slug pour
    // une carte présente dans plusieurs sets. Il se RESTITUE quand la carte n'a qu'UNE impression dans ce set : c'est alors
    // l'impression retenue, sans choix à faire. Deux impressions (une carte des deux decks d'un kit) : null, comme avant.
    const impsDe = new Map(cartesDuSet.map(c => [c._id, c.impressions.filter(x => x.tirage === TIRAGE && nomsCibles.includes(x.expansion) && (!L.bulba.deck || x.deck === L.bulba.deck))]));
    for (const l of G.gardees) { const imps = impsDe.get(l.carteId) || []; if (l.numeroFiche == null && imps.length === 1 && imps[0].numero != null) l.numeroFiche = imps[0].numero; }
    J = { ...J, lignes: G.gardees, restes: [...J.restes, ...G.refusees.map(r => ({ type: 'produit-sans-carte', detail: `${r.idProduct} « ${nomDe.get(r.idProduct)} » n°— — nom seul refusé : ${r.raison}` }))],
        compte: { ...J.compte, produitsJoints: new Set(G.gardees.map(l => l.idProduct)).size } };
    return { J, produits, G, exact };
}

module.exports = { planSansPage };
