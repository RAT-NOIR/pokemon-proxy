// ============================================================
// LA TABLE FERMÉE DES ORIGINES DU PIKACHU WORLD COLLECTION 2000 (Cardmarket 4392) — S6, 2026-10-12
// ============================================================
// 🔑 POURQUOI UNE TABLE : les slugs Cardmarket de ces produits (« Pikachu-V13 », « Flying-Pikachu ») ne disent pas leur tirage d'origine —
// seul « Pikachu-V12-PWCWP-4 » écrit « WP-4 ». La page Bulbapedia du produit, lue dans sa copie Wayback datée, liste les NEUF cartes du
// collection : chaque ligne porte le numéro Wizards Black Star Promos de la carte d'origine, un LIEN vers la page de cette carte (le titre
// est celui de notre `cartes.bulba.titre`) et la LANGUE du tirage. Les neuf lignes ont des attaques deux à deux différentes ; sept sont
// des langues occidentales (le tirage `intl` du site), deux ne le sont pas (chinois, coréen) et sont NOMMÉES dans EXCLUS_PWC.
// ⚠️ Cette table n'est QU'UNE moitié de la preuve : l'AUTRE moitié est l'accord, chiffré dans classerProduits, entre les attaques que
// CARDMARKET écrit entre crochets et celles de la carte au numéro (set-partiel.js, `verifierAttaques`) et le témoin du nom de la
// jointure. Une ligne de page que Cardmarket ne confirme pas reste un trou.
// 🕳️ Les 10 produits « Pikachu [Hello! | Thunderbolt] » (V1…V10) ne sont dans aucune ligne de cette page : aucune carte de la base ne porte
// ces attaques. Ils ne sont NI dans la table NI dans les exclus : ils restent « sans-code-origine ».
const { LANGUES_INTL } = require('./langues-intl');

const PAGE = 'Pikachu World Collection (TCG), copie Wayback 20260709110309 (table « Card list — Pikachu World Collection 2000 »)';
const e = (idProduct, ligne, titre, langue) => ({ idProduct, code: 'WP', num: ligne.split(' ')[1], ligne, titre, langue, page: PAGE });

// Les SEPT entrées : code WP = Wizards Black Star Promos (codes_set : WP → 1607, occidental).
const TABLE_PWC = [
    e(576936, 'Wizards 24', "'s Pikachu (Wizards Promo 24)", 'English'),
    e(576937, 'Wizards 25', 'Flying Pikachu (Wizards Promo 25)', 'German'),
    e(576939, 'Wizards 1', 'Pikachu (Wizards Promo 1)', 'Portuguese'),
    e(576941, 'Wizards 26', 'Pikachu (Wizards Promo 26)', 'Spanish'),
    e(576940, 'Wizards 4', 'Pikachu (Wizards Promo 4)', 'Dutch'),
    e(576942, 'Wizards 27', 'Pikachu (Wizards Promo 27)', 'Italian'),
    e(576938, 'Wizards 28', 'Surfing Pikachu (Wizards Promo 28)', 'French'),
];

// Les deux lignes de la page dont la langue n'est pas occidentale : le produit existe chez Cardmarket (V15 [Spark], V16 [Gnaw | Thunder Jolt]),
// il n'est PAS du tirage intl, donc il reste hors du set partiel. Nommés pour que leur absence soit une décision écrite.
const EXCLUS_PWC = [
    { idProduct: 576943, ligne: '60/64', titre: 'Pikachu (Jungle 60)', langue: 'Chinese', page: PAGE },
    { idProduct: 576944, ligne: '58/102', titre: 'Pikachu (Base Set 58)', langue: 'Korean', page: PAGE },
];

/** LÈVE sur une langue hors liste, un doublon d'idProduct, une page sans copie Wayback datée, un code ≠ WP, un numéro absent de la ligne. */
function verifierTablePwc(table) {
    const vus = new Set();
    for (const t of table) {
        if (!LANGUES_INTL.includes(t.langue)) throw new Error(`table PWC : produit ${t.idProduct} : langue « ${t.langue} » hors tirage intl (${LANGUES_INTL.join(', ')})`);
        if (vus.has(t.idProduct)) throw new Error(`table PWC : doublon sur le produit ${t.idProduct}`);
        vus.add(t.idProduct);
        if (!/copie Wayback \d{14}/.test(String(t.page))) throw new Error(`table PWC : produit ${t.idProduct} : page sans copie Wayback datée (14 chiffres)`);
        if (t.code !== 'WP' || !/^Wizards \d+$/.test(String(t.ligne)) || t.num !== String(t.ligne).split(' ')[1]) throw new Error(`table PWC : produit ${t.idProduct} : ligne « ${t.ligne} » / code « ${t.code} » / numéro « ${t.num} » incohérents`);
        if (!t.titre) throw new Error(`table PWC : produit ${t.idProduct} sans titre de page de carte`);
    }
    return true;
}
verifierTablePwc(TABLE_PWC);

/** La Map attendue par set-partiel.js (ctx.origines) : idProduct → { code, num, langue, ligne, titre, page }. Les exclus y entrent avec leur langue (refusés par le classement). */
function originesPwc() {
    const m = new Map(TABLE_PWC.map(t => [t.idProduct, t]));
    for (const x of EXCLUS_PWC) m.set(x.idProduct, { ...x, code: null, num: null });
    return m;
}

module.exports = { TABLE_PWC, EXCLUS_PWC, verifierTablePwc, originesPwc, PAGE };
