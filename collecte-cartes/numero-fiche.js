// ============================================================
// `cartes_produits.numeroFiche` — le numéro de l'IMPRESSION que le site range la fiche sous, jamais le numéro Cardmarket recopié.
// ============================================================
// POURQUOI (T7a, 2026-10-12) : le site place un produit par `numeroFiche` d'abord (rat-market-site lib/cardmarket.ts,
// `placementParNumeroFiche`) et compare avec `numeroComparable`. Un numéro qui ne désigne aucune impression numérotée de la carte
// dans le set rend `sans-fiche` : le produit est DÉTACHÉ (ni lien, ni prix, ni visuel). creer-sets-sans-page.js écrivait le numéro
// Cardmarket (« 007L », « G002 ») sur des cartes DÉCLARANTES dont l'impression porte « 007 » / « 002 » : 99 lignes détachées.
//
// 🔑 UNE GARDE SE FORME PAR CE QU'ELLE AUTORISE : une forme est dans la liste FERMÉE FORMES, et elle se CALIBRE sur le set entier
// (toutes les lignes à réparer partagent la même), elle ne se devine pas ligne à ligne.

// Recopie MOT POUR MOT de `numeroComparable` (rat-market-site lib/cardmarket.ts:23) ; l'outil de réparation la CONFRONTE à l'export
// du site au démarrage (CAS_COMPARABLE) : si le site la change, l'outil s'arrête au lieu de réparer avec une règle périmée.
function numeroComparable(n) {
    return String(n ?? '').trim().split(/[\s(]/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^0+(?=\d)/, '');
}
const CAS_COMPARABLE = ['007L', '007', 'G002', ' 12 ', 'SWSH139 (Top Left)', 'SV-P 001', '', null, 'A-1', '0', '00'];

// La liste FERMÉE des différences de forme admises, appliquées au numéro Cardmarket DÉJÀ comparable.
const FORMES = [
    { id: 'identique', appliquer: c => c },
    { id: 'prefixe-lettres', appliquer: c => c.replace(/^[A-Z]+(?=\d)/, '') },   // « G002 » → « 002 » (Quick Construction Packs)
    { id: 'suffixe-lettres', appliquer: c => c.replace(/(?<=\d)[A-Z]+$/, '') }    // « 007L » → « 007 » (Gift Box : lettre de deck)
].map(f => ({ ...f, appliquer: x => numeroComparable(f.appliquer(numeroComparable(x))) }));

/** Les numéros d'impression numérotés d'une carte pour CE set (la définition du site : tirage ET nom d'expansion du set). */
function numerosDuSet(impressions, set) {
    const t = set.tirage ?? set.region, noms = [].concat(set.bulba?.expansion ?? []);
    // (T4b) un set DECK (champ `deck` du document du set, écrit par creer-sets-sans-page.js via set-deck.js et relu par corriger-numero-fiche.js : PROJECTION_SETS) ne lit que les numéros de son deck
    const nd = s => String(s ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
    return (impressions || []).filter(i => i && i.tirage === t && noms.includes(i.expansion) && (set.deck == null || nd(i.deck) === nd(set.deck))).map(i => i.numero).filter(n => n != null && String(n).trim() !== '');
}

/** Les impressions (valeurs brutes) dont le numéro comparable est `cle`. */
const designees = (numeros, cle) => numeros.filter(n => numeroComparable(n) === cle);
const distincts = xs => [...new Set(xs.map(numeroComparable))];

/**
 * Une ligne est EN DÉFAUT quand la carte a des impressions numérotées dans le set et que son numeroFiche n'en désigne aucune.
 * @param {string|null} numeroFiche @param {string[]} numerosImpression
 */
function enDefaut(numeroFiche, numerosImpression) {
    const v = numeroComparable(numeroFiche);
    if (!v || !numerosImpression.length) return false;
    return !numerosImpression.some(n => numeroComparable(n) === v);
}

/**
 * CALIBRE la forme d'un set. @param {{numeroFiche:string, numeros:string[]}[]} lignes les lignes EN DÉFAUT du set
 * @returns {{forme: object|null, raison: string|null}} la forme qui désigne, pour CHAQUE ligne, UNE SEULE impression ; sinon aucune.
 * Deux formes qui conviennent à toutes les lignes = ambigu = aucune (on ne choisit pas).
 */
function calibrerForme(lignes) {
    if (!lignes.length) return { forme: null, raison: 'aucune ligne en défaut' };
    const bonnes = FORMES.filter(f => f.id !== 'identique' && lignes.every(l => designees(l.numeros, f.appliquer(l.numeroFiche)).length && distincts(designees(l.numeros, f.appliquer(l.numeroFiche))).length === 1));
    if (bonnes.length === 1) return { forme: bonnes[0], raison: null };
    if (bonnes.length > 1) return { forme: null, raison: `plusieurs formes conviennent à toutes les lignes (${bonnes.map(f => f.id).join(', ')}) : ambigu` };
    return { forme: null, raison: 'aucune forme de la liste fermée ne désigne UNE impression pour chacune des lignes du set' };
}

/** Le numéro d'impression (valeur brute) que `forme` fait désigner par le numéro Cardmarket, ou null. */
function numeroReparé(numeroFiche, numeros, forme) {
    const h = designees(numeros, forme.appliquer(numeroFiche));
    return h.length && distincts(h).length === 1 ? h[0] : null;
}

/**
 * L'ÉCRIVAIN (creer-sets-sans-page.js) : le `numeroFiche` d'une ligne NEUVE dans un set NEUF.
 * · la carte n'a aucune impression numérotée dans le set → le numéro Cardmarket (le site n'en lit alors que l'étiquette) ;
 * · une impression le désigne telle quelle → son numéro ;
 * · sinon la FORME calibrée du set (`forme`, passée par l'appelant, calibrée sur toutes les lignes du set) ;
 * · sinon `null` : jamais un numéro qui détacherait le produit de sa fiche (le site lit alors le slug, comme avant).
 * @param {{numeros: string[], numeroCardmarket: string|null, forme: object|null}} o
 */
function numeroFicheDeCreation({ numeros, numeroCardmarket, forme }) {
    if (numeroCardmarket == null || String(numeroCardmarket).trim() === '') return null;
    if (!numeros.length) return numeroCardmarket;
    if (!enDefaut(numeroCardmarket, numeros)) return numeroCardmarket;
    return forme ? numeroReparé(numeroCardmarket, numeros, forme) : null;
}

/**
 * Le `numeroFiche` de CHAQUE réimpression désignée d'un set NEUF, la forme étant calibrée sur le set entier (toutes ses lignes en défaut).
 * @param {{carte: {impressions: object[]}, p: {numero: string|null}}[]} designes @param {{tirage?, region?, bulba?}} set
 * @returns {{valeurs: Map<object, string|null>, forme: object|null, raison: string|null, enDefaut: number}} valeurs indexées par l'objet `designe`
 */
function numerosFichesDuPlan(designes, set) {
    const lignes = designes.map(d => ({ d, numeros: numerosDuSet(d.carte.impressions, set), numeroFiche: d.p.numero }));
    const fautives = lignes.filter(l => enDefaut(l.numeroFiche, l.numeros));
    const { forme, raison } = fautives.length ? calibrerForme(fautives) : { forme: null, raison: null };
    const valeurs = new Map(lignes.map(l => [l.d, numeroFicheDeCreation({ numeros: l.numeros, numeroCardmarket: l.numeroFiche, forme })]));
    return { valeurs, forme, raison, enDefaut: fautives.length };
}

module.exports = { numerosFichesDuPlan, numeroComparable, CAS_COMPARABLE, FORMES, numerosDuSet, enDefaut, calibrerForme, numeroReparé, numeroFicheDeCreation };
