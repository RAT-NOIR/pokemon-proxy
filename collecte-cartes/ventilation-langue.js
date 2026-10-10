// Ventilation PAR LANGUE de la couverture (fiches / visuels / scan du jumeau), pour mesure-catalogue.js --par-langue.
// Fonction PURE : elle ne calcule aucun ensemble, elle REGROUPE ceux que mesure-catalogue.js a déjà calculés (une seule règle).
// La langue d'un set est son TIRAGE : `tirage ?? region` (CONTRAT-SITE.md, CLAUDE.md §61) — `region` vaut `intl` pour des sets
// chinois, indonésiens et thaïs, il ne se lit jamais seul.

const INCONNUE = '(langue inconnue)';

const tirageDe = set => {
    const t = set && (set.tirage ?? set.region);
    return typeof t === 'string' && t ? t : null;
};

// slugParProduit : Map idProduct -> slugSet (le dénominateur) · ensembles : { fiches, visuels, jumeau } (Set d'idProduct)
// setDe : slugSet -> document set ({ tirage?, region? }) ou undefined
function ventilerParLangue(slugParProduit, ensembles, setDe) {
    const lignes = new Map();
    const ligne = l => lignes.get(l) || (lignes.set(l, { langue: l, produits: 0, fiches: 0, visuels: 0, jumeau: 0 }), lignes.get(l));
    for (const [id, slug] of slugParProduit) {
        const l = ligne((slug && tirageDe(setDe(slug))) || INCONNUE);
        l.produits++;
        if (ensembles.fiches.has(id)) l.fiches++;
        if (ensembles.visuels.has(id)) l.visuels++;
        if (ensembles.jumeau.has(id)) l.jumeau++;
    }
    const tableau = [...lignes.values()].sort((a, b) => b.produits - a.produits);
    // Bouclage : lève s'il échoue. Les compteurs globaux sont recomptés sur les ensembles ÉGAUX AU DÉNOMINATEUR (un id hors
    // dénominateur ne compte nulle part, comme dans la mesure globale).
    const dans = s => [...s].filter(id => slugParProduit.has(id)).length;
    const attendu = { produits: slugParProduit.size, fiches: dans(ensembles.fiches), visuels: dans(ensembles.visuels), jumeau: dans(ensembles.jumeau) };
    const somme = { produits: 0, fiches: 0, visuels: 0, jumeau: 0 };
    for (const l of tableau) for (const k of Object.keys(somme)) somme[k] += l[k];
    for (const k of Object.keys(somme))
        if (somme[k] !== attendu[k]) throw new Error(`bouclage par langue en échec sur « ${k} » : somme des langues ${somme[k]} ≠ global ${attendu[k]}`);
    return { tableau, somme, attendu };
}

module.exports = { ventilerParLangue, tirageDe, INCONNUE };
