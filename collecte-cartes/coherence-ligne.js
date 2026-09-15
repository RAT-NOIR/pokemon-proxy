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
    if (a.cle === 'page (TCG)' && a.nomBulbapedia && serre(nomLisibleDuSlug(l.slugSet)) !== serre(a.nomBulbapedia))
        raisons.push(`page redirigée : « ${nomLisibleDuSlug(l.slugSet)} (TCG) » → « ${a.nomBulbapedia} » (le nom d'expansion est celui de la cible, pas celui de l'expansion Cardmarket)`);
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

module.exports = { raisonsDeCoherence, concordanceDesNoms, teteDuSlug };
