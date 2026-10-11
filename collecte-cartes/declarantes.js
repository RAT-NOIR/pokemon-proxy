// ============================================================
// LA JOINTURE D'UN PRODUIT À SA CARTE DÉCLARANTE — une définition, lue par creer-sets-sans-page.js (DECLARANTES)
// ============================================================
// Une carte DÉCLARANTE est une carte de la base dont une impression porte (tirage, nom d'expansion) du set qu'on crée. Un produit se joint à
// celle dont le nom est le sien. Trois précisions (SETS-21, 2026-10-11), chacune mesurée sur les 21 expansions « jamais créées » :
//   · une carte ☆ (le ☆ vit dans le TITRE, pas dans `nomEn`) se joint sous « <nom> Gold Star », le nom que Cardmarket lui donne — Gift Box
//     Mew • Lucario refusait « Pikachu Gold Star » et « Mewtwo Gold Star » (déclarantes sans produit) faute de cela ;
//   · deux déclarantes au même nom (Arceus Lv.100 Plante / Feu, Arceus Grass & Fire) : les attaques de la CARTE, toutes présentes parmi
//     celles du produit (les crochets portent aussi un Pouvoir ou un type : « [Grass | Leaf Refresh] »), départagent — à une seule carte ;
//   · si elles ne départagent pas, l'ambiguïté reste et l'appelant refuse le set.
const { nomJointDe } = require('./jointure');

const nu = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

/** Le(s) nom(s) sous lequel une carte déclarante se joint. */
function nomsDeclarante(c) {
    const n = nomJointDe(c);
    return /☆/.test(String(c.bulba?.titre ?? '').replace(/\s*\([^()]*\)\s*$/, '')) ? [`${n} Gold Star`] : [n];
}

/**
 * RÈGLE STRICTE (relecture SETS-21, 2026-10-11) : l'ensemble des attaques du produit est ÉGAL à celui de la carte (normalisation `nu`, ordre et
 * doublons ignorés, ensembles non vides). Une inclusion départagerait A[X] contre B[X,Y] pour un produit qui ne liste que X, ou rendrait vraie
 * une carte dont le produit porte en plus un type (« [Grass | Leaf Refresh] ») : l'ambiguïté reste, et l'appelant refuse le set.
 */
function attaquesDeLaCarteDansLeProduit(c, p) {
    const ca = new Set((c.attaques || []).map(a => nu(a.nom)).filter(Boolean)), pa = new Set((p.attaques || []).map(nu).filter(Boolean));
    return ca.size > 0 && ca.size === pa.size && [...ca].every(a => pa.has(a));
}

/** Les déclarantes qui désignent ce produit : par le nom, puis (si plusieurs) par les attaques. `clesNom` : la fonction de la jointure. */
function declarantesDuProduit(declarantes, nomProduit, p, clesNom) {
    let dd = declarantes.filter(c => nomsDeclarante(c).some(nc => clesNom(nc).some(k => clesNom(nomProduit).includes(k))));
    if (dd.length > 1) { const f = dd.filter(c => attaquesDeLaCarteDansLeProduit(c, p)); if (f.length === 1) dd = f; }
    return dd;
}

module.exports = { nomsDeclarante, attaquesDeLaCarteDansLeProduit, declarantesDuProduit };
