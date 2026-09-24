// ============================================================
// LA COHÉRENCE D'UNE LIGNE AUTOMATIQUE — deux gardes, pures, sans requête
// ============================================================
// 🔴 LE CAS FONDATEUR, 2026-09-15 : `20th` « BREAK Starter Pack », une expansion JAPONAISE pour codes_set, a été
// admise sur « Generations (TCG) » en tirage `intl`, et collectée : 84 produits sur 84 joints, concordance vraie,
// verdict « ok » — et 65 noms discordants sur 76 (Rapidash n°013 → Ninetales, Hitmonchan n°037 → Meowstic). Deux
// défauts se sont additionnés :
//   1. generer-table-auto.js demande « BREAK Starter Pack (TCG) », Bulbapedia REDIRIGE vers « Generations (TCG) », et le
//      nom d'expansion retenu est celui de la CIBLE. 53 lignes sur 398 sont redirigées ; la plupart visent le set
//      international qui fusionne deux demi-sets japonais (Future Flash + Ancient Roar → Paradox Rift) ;
//   2. verifier-table.js établit le tirage depuis la carte-échantillon et RÉÉCRIT la région, sans la confronter à
//      codes_set.
// Aucun chiffre n'a crié : la jointure set+numéro ne regarde pas le nom, et la concordance compte ce qu'elle a énuméré.
//
// raisonsDeCoherence(ligne, tirage) : les raisons de NE PAS admettre une ligne (tableau vide = rien à redire).
//   Coût mesuré sur les 87 lignes admises au 2026-09-15 : chaque garde ne déclenche que sur 20th.
// concordanceDesNoms(paires) : [[slug produit Cardmarket, nomEn de la carte jointe], …] → part concordante, contrôle
//   INDÉPENDANT de la jointure (§16 : ce qui trouve une vérité fausse est une seconde source, jamais un contrôle interne).

const serre = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const regionDeTirage = t => t === 'jp' ? 'japonais' : t === 'intl' ? 'occidental' : null;
const nomLisibleDuSlug = slug => String(slug ?? '').replace(/-/g, ' ');

function raisonsDeCoherence(l, tirage) {
    const raisons = [];
    const a = l.auto || {};
    // On compare au nom d'expansion LU (`bulba.expansion`), pas au nom de la page : un demi-set japonais corrigé garde la
    // page cible (« Paradox Rift (TCG) ») et lit la section à son nom (« Future Flash ») — c'est juste, et ne doit pas crier.
    const lue = [].concat(l.bulba?.expansion ?? a.nomBulbapedia ?? []);
    // Une page COLLECTIVE (deux starter sets, 2026-09-25) : la carte déclare l'expansion collective et son `deck`, et la ligne
    // se restreint au deck. Ce deck porte alors le nom Cardmarket — et c'est la seule égalité qui passe en plus.
    const deckAuNom = l.bulba?.deck && serre(l.bulba.deck) === serre(nomLisibleDuSlug(l.slugSet));
    if (a.cle === 'page (TCG)' && lue.length && !deckAuNom && !lue.some(x => serre(x) === serre(nomLisibleDuSlug(l.slugSet))))
        raisons.push(`page redirigée : « ${nomLisibleDuSlug(l.slugSet)} (TCG) » → « ${lue.join(' / ')} » (le nom d'expansion lu est celui de la cible, pas celui de l'expansion Cardmarket)`);
    const r = regionDeTirage(tirage);
    if (a.regionCodesSet && r && a.regionCodesSet !== r)
        raisons.push(`région codes_set « ${a.regionCodesSet} » contredite par le tirage « ${tirage} » de la carte-échantillon`);
    return raisons;
}

// Tête du slug Cardmarket : on retire les jetons de queue qui portent un chiffre (« 20th025 », « IPB6 », « Lv11 », « 123 »)
// ou une variante (« V1 »), en gardant au moins le premier jeton.
function teteDuSlug(slug) {
    const jetons = String(slug ?? '').split('-').filter(Boolean);
    while (jetons.length > 1 && /^(V\d+|[A-Za-z]{0,5}\d+[a-z]?)$/.test(jetons[jetons.length - 1])) jetons.pop();
    return serre(jetons.join(''));
}

function concordanceDesNoms(paires) {
    let concordants = 0, evaluables = 0, nonEvaluables = 0;
    const exemples = [];
    for (const [slug, nom] of paires) {
        const a = teteDuSlug(slug), b = serre(nom);
        if (!a || !b) { nonEvaluables++; continue; }
        evaluables++;
        if (a.includes(b) || b.includes(a)) concordants++;
        else if (exemples.length < 5) exemples.push(`${slug} → ${nom}`);
    }
    return { concordants, evaluables, nonEvaluables, taux: evaluables ? concordants / evaluables : null, exemples };
}

// 🔴 2026-09-15, SWSH Black Star Promos : Cardmarket numérote « 002 », Bulbapedia « SWSH002 ». set+numéro échoue, le repli par
// NOM rattache un produit à toutes les cartes du nom (Scorbunny n°002 → SWSH002 et SWSH244) : 56 produits vers plusieurs
// cartes, ≥ 124 lignes fausses, et le contrôle des noms n'y voit rien (les noms sont justes). Sur les 206 sets collectés,
// aucun autre n'en a plus d'UN. Seuil à 3 : deux passent encore, ce qui laisse une marge au-dessus du maximum sain.
const SEUIL_PLUSIEURS_CARTES = 3;
function plusieursCartesAnormal(complet) {
    return (complet?.restes?.['produit-vers-plusieurs-cartes'] || 0) >= SEUIL_PLUSIEURS_CARTES;
}

module.exports = { raisonsDeCoherence, concordanceDesNoms, teteDuSlug, plusieursCartesAnormal, SEUIL_PLUSIEURS_CARTES };
