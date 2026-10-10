// Ventilation PAR LANGUE de la couverture (fiches / visuels / scan du jumeau), pour mesure-catalogue.js --par-langue.
// Fonction PURE : elle ne calcule aucun ensemble, elle REGROUPE ceux que mesure-catalogue.js a déjà calculés (une seule règle).
// La langue d'un set est son TIRAGE : `tirage ?? region` — c'est la règle du SITE (CONTRAT-SITE.md, CLAUDE.md §61). `region` vaut
// `intl` pour des sets chinois, indonésiens et thaïs, il ne se lit jamais seul. ⚠️ `??` et non `||` : un `tirage` vide ('') n'est
// PAS rattrapé par `region` (le site ne le fait pas), il tombe en « (langue inconnue) », cause (c). Test : « tirage: '' » du banc.

const INCONNUE = '(langue inconnue)';

const tirageDe = set => {
    const t = set && (set.tirage ?? set.region);
    return typeof t === 'string' && t ? t : null;
};

// Les trois CAUSES d'une langue inconnue (la somme des trois = la ligne inconnue, contrôle qui lève).
const CAUSES = {
    a: 'produit sans slug de set',
    b: 'slug présent mais AUCUN document `sets`',
    c: 'set présent sans `tirage` ni `region` (ou valeur vide)',
};

// slugParProduit : Map idProduct -> slugSet (le dénominateur) · ensembles : { fiches, visuels, jumeau } (Set d'idProduct)
// setDe : slugSet -> document set ({ tirage?, region? }) ou undefined
// globaux : les nombres que la MESURE GLOBALE imprime { produits, fiches, visuels, jumeau } — le bouclage compare à EUX, pas à un
//   recomptage sur la même Map (une partition redonne toujours sa propre somme : ce contrôle-là ne pourrait jamais échouer).
// jamaisAppris : Set d'idProduct (optionnel) pour dire combien des produits jamais appris tombent dans chaque cause.
function ventilerParLangue(slugParProduit, ensembles, setDe, globaux, jamaisAppris = new Set()) {
    if (!globaux || ['produits', 'fiches', 'visuels', 'jumeau'].some(k => !Number.isInteger(globaux[k])))
        throw new Error('ventilerParLangue : les comptes de la mesure globale sont obligatoires (produits, fiches, visuels, jumeau)');
    const lignes = new Map();
    const ligne = l => lignes.get(l) || (lignes.set(l, { langue: l, produits: 0, fiches: 0, visuels: 0, jumeau: 0 }), lignes.get(l));
    const inconnue = { a: { produits: 0, jamaisAppris: 0 }, b: { produits: 0, jamaisAppris: 0 }, c: { produits: 0, jamaisAppris: 0 } };
    for (const [id, slug] of slugParProduit) {
        const doc = slug ? setDe(slug) : undefined;
        const langue = tirageDe(doc);
        if (!langue) {
            const cause = !slug ? 'a' : !doc ? 'b' : 'c';
            inconnue[cause].produits++;
            if (jamaisAppris.has(id)) inconnue[cause].jamaisAppris++;
        }
        const l = ligne(langue || INCONNUE);
        l.produits++;
        if (ensembles.fiches.has(id)) l.fiches++;
        if (ensembles.visuels.has(id)) l.visuels++;
        if (ensembles.jumeau.has(id)) l.jumeau++;
    }
    const tableau = [...lignes.values()].sort((a, b) => b.produits - a.produits);
    const somme = { produits: 0, fiches: 0, visuels: 0, jumeau: 0 };
    for (const l of tableau) for (const k of Object.keys(somme)) somme[k] += l[k];
    for (const k of Object.keys(somme))
        if (somme[k] !== globaux[k]) throw new Error(`bouclage par langue en échec sur « ${k} » : somme des langues ${somme[k]} ≠ mesure globale ${globaux[k]}`);
    const ligneInconnue = lignes.get(INCONNUE)?.produits || 0;
    const sommeCauses = inconnue.a.produits + inconnue.b.produits + inconnue.c.produits;
    if (sommeCauses !== ligneInconnue) throw new Error(`causes de « ${INCONNUE} » : a+b+c = ${sommeCauses} ≠ ligne ${ligneInconnue}`);
    return { tableau, somme, attendu: { ...globaux }, inconnue };
}

module.exports = { ventilerParLangue, tirageDe, INCONNUE, CAUSES };
