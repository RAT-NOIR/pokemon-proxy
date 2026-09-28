// ============================================================
// LA PAGE D'UN PRODUIT DANS UNE LISTE CARDMARKET — règle unique (generer-pages-utiles.js ; banc test-pages-du-rang.js)
// ============================================================
// Une liste triée par nom montre 30 produits par page, et 300 AU PLUS (10 pages) : mesuré sur le journal 1.10 (2026-09-28), les pages
// 11 et 12 de Sun-Moon-Promos (422 produits) sont vides ; les totaux annoncés plafonnaient déjà à 300 (CLAUDE.md §67). Un produit de
// rang r (0 = premier par nom croissant) dans une liste de n produits se lit donc :
//   · dans le tri CROISSANT, page ⌊r/30⌋+1, tant que r < 300 ;
//   · sinon dans le tri DÉCROISSANT, page ⌊(n−1−r)/30⌋+1, tant que n−1−r < 300 (calibré sur les pages ANGLAISES des journaux :
//     89,9 % à la page calculée sur 56 pages décroissantes, 97,1 % sur 74 croissantes ; toutes langues, 386 décroissantes : 90,6 %) ;
//   · sinon (au milieu d'une liste de plus de 600) dans aucune des deux : `principale: null`, l'appelant cherche par le nom.
// La MARGE m (en rangs) ajoute la page voisine quand le produit est à moins de m rangs d'un bord — la fenêtre [x − m, x + m] autour
// du rang dans l'ordre de la page. Une fenêtre qui déborde du plafond ne donne que ses pages atteignables : le croissant n'est
// retenu seul que si SA fenêtre tient entière sous 300, sinon le décroissant si la sienne y tient, sinon les deux.
const PAR_PAGE = 30;
const PAGES_MAX = 10;

function pagesDuRang(r, n, m) {
    if (!Number.isInteger(r) || !Number.isInteger(n) || !Number.isInteger(m) || r < 0 || r >= n || m < 0 || m >= PAR_PAGE) throw new Error(`pagesDuRang(${r}, ${n}, ${m}) : rang, taille ou marge hors bornes`);
    const plafond = PAR_PAGE * PAGES_MAX;
    const fenetre = (x, tri) => {
        const lo = Math.max(0, x - m), hi = Math.min(n - 1, x + m), pages = [];
        for (let p = Math.floor(lo / PAR_PAGE) + 1; p <= Math.floor(hi / PAR_PAGE) + 1; p++) if (p <= PAGES_MAX) pages.push({ tri, site: p });
        return { pages, entiere: hi < plafond };
    };
    const page = (tri, x) => ({ tri, site: Math.floor(x / PAR_PAGE) + 1 });
    const a = fenetre(r, 'name_asc'), d = fenetre(n - 1 - r, 'name_desc');
    if (a.entiere) return { principale: page('name_asc', r), pages: a.pages };
    if (d.entiere) return { principale: page('name_desc', n - 1 - r), pages: d.pages };
    const principale = r < plafond ? page('name_asc', r) : n - 1 - r < plafond ? page('name_desc', n - 1 - r) : null;
    return { principale, pages: [...a.pages, ...d.pages] };
}

module.exports = { pagesDuRang, PAR_PAGE, PAGES_MAX };
