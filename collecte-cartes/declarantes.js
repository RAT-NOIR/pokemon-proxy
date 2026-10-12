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

// ── T4b (2026-10-12) : le DECK, le NUMÉRO comme témoin, et deux jointures supplémentaires qui n'entrent que par l'appelant ────────────
const nu2 = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
const nn = n => { const s = String(n ?? '').trim(); return s ? s.replace(/^0+(?=\d)/, '').toUpperCase() : null; };

/** Les impressions d'une carte qui sont CELLES du set : tirage, nom d'expansion déclaré et, si le set est un deck, ce deck (égalité normalisée). */
// `alias` (T4b fix1) : des noms d'expansion ÉCRITS autrement par une page de carte (« Giratina vs Dialga » pour « Giratina vs Dialga Deck Kit »),
// NOMMÉS par l'appelant pour un set précis ; sans `alias`, l'égalité exacte d'avant.
function impressionsDuSetDeclare(c, { tirage, expansion, deck = null, alias = null }) {
    const noms = [expansion, ...(alias || [])];
    return (c.impressions || []).filter(i => i && i.tirage === tirage && noms.includes(i.expansion) && (deck == null || nu2(i.deck) === nu2(deck)));
}

/** Les cartes déclarantes d'un set : une impression (tirage, expansion, deck) — `deck` absent = tout le nom d'expansion (le comportement d'avant). */
function declarantesDuSet(cartes, o) { return cartes.filter(c => impressionsDuSetDeclare(c, o).length > 0); }

/** Les numéros (normalisés) que la carte déclare dans ce set. */
function numerosDeclares(c, o) { return impressionsDuSetDeclare(c, o).map(i => nn(i.numero)).filter(Boolean); }

/** Les attaques de la carte (non vides) sont TOUTES dans les crochets du produit : l'inclusion, que le départage STRICT refuse seule. */
function attaquesIncluses(c, p) {
    const ca = new Set((c.attaques || []).map(a => nu2(a.nom)).filter(Boolean)), pa = new Set((p.attaques || []).map(nu2).filter(Boolean));
    return ca.size > 0 && [...ca].every(a => pa.has(a));
}

/**
 * Les déclarantes qui désignent ce produit : par le nom, puis (si plusieurs) par les attaques ÉGALES, puis — SEULEMENT si l'appelant passe
 * `o.set` (T4b : Arceus Lv.100 Plante / Feu) — par le NUMÉRO que la carte déclare dans ce set ET l'inclusion de ses attaques : le nom et le
 * numéro (deux éléments) plus les attaques, à UNE seule carte ; sinon l'ambiguïté reste. `clesNom` : la fonction de la jointure.
 */
function declarantesDuProduit(declarantes, nomProduit, p, clesNom, o = null) {
    let dd = declarantes.filter(c => nomsDeclarante(c).some(nc => clesNom(nc).some(k => clesNom(nomProduit).includes(k))));
    if (dd.length > 1) { const f = dd.filter(c => attaquesDeLaCarteDansLeProduit(c, p)); if (f.length === 1) dd = f; }
    if (dd.length > 1 && o?.set && nn(p.numero)) {
        const f = dd.filter(c => numerosDeclares(c, o.set).includes(nn(p.numero)) && attaquesIncluses(c, p));
        if (f.length === 1) dd = f;
    }
    return dd;
}

/**
 * LE TÉMOIN DU NUMÉRO : une jointure par le nom dont le numéro du produit et ceux que la carte déclare dans le set se CONTREDISENT (les deux
 * présents, aucun égal) n'est pas écrite — une contradiction ne se tranche pas en écrivant (Sceptile 78071 : 003 chez nous, 004 chez Cardmarket
 * et sur la page). Un numéro absent d'un côté ne contredit rien.
 */
function numeroContredit(c, p, setDecl) {
    const n = nn(p.numero), ds = numerosDeclares(c, setDecl);
    return !!n && ds.length > 0 && !ds.includes(n);
}

/**
 * LA PASSE « MÊME NUMÉRO, NOM PRÉFIXE » (« Boss's Orders - Giovanni » → la déclarante « Boss's Orders »). Calibrée le 2026-10-12 sur les
 * 64 181 produits joints de 769 sets (vérité = la ligne) : 268 paires vraies, 0 fausse avec le séparateur « - » (avec un simple espace : 1
 * fausse, les formes de Burmy). Elle ne voit que les déclarantes RESTANTES du set ; une seule candidate, ou rien.
 */
function declarantePrefixeMemeNumero(restantes, nomProduit, p, setDecl) {
    const n = nn(p.numero), np = nu2(nomProduit);
    if (!n) return null;
    const cs = restantes.filter(c => numerosDeclares(c, setDecl).includes(n) && nomsDeclarante(c).some(nc => np.startsWith(nu2(nc) + ' - ')));
    return cs.length === 1 ? cs[0] : null;
}

module.exports = { nomsDeclarante, attaquesDeLaCarteDansLeProduit, declarantesDuProduit, impressionsDuSetDeclare, declarantesDuSet, numerosDeclares, attaquesIncluses, numeroContredit, declarantePrefixeMemeNumero };
