// ============================================================
// L'ÉCHANTILLON DE MESURE DES LARGEURS — une définition, là où collecteur-images.js choisit ses mesures (lot V8, tour 1, 2026-10-12)
// ============================================================
// La production juge un SET sur la MÉDIANE de trois largeurs (§23) ; l'échantillon était « les 3 premières entrées de la liste ». Dans une liste à
// SOUS-SECTIONS (un deck par sous-section), les 3 premières sont toutes du premier deck : juger le deck Charizard sur les vignettes du deck Venusaur
// (321, 321, 500 px contre 1432 pour la première du Charizard) est juger un set sur un AUTRE deck. Le seuil (350) et la statistique (médiane) ne bougent pas.
// RÈGLE : une ligne de source qui déclare `sousSection` mesure dans CETTE sous-section ; si elle a moins de 3 entrées, toutes ses entrées (jamais celles
// d'une autre) ; si elle n'en a aucune, rien — l'appelant REFUSE, il ne mesure pas un autre deck. Sans déclaration : les 3 premières, comme avant.
const N_MESURES = 3;
// Les entrées que la LIGNE traite (mesure, téléchargement, jointure, complétude) : toute la liste, ou — si elle déclare `sousSection` — celles de cette sous-section.
// Les autres decks de la liste ne sont ni mesurés ni téléchargés par cette ligne (le worker ne demande pas à un tiers des fichiers qu'il ne joindra pas).
// 🔑 LE PRÉDICAT « MÊME SOUS-SECTION » VIT ICI, EN UN EXEMPLAIRE (V8 tour 2, §21 bis) : la sélection des entrées ET la jointure d'une image (sous-section-image.js) l'appellent.
// Une garde qui ne peut pas conclure BLOQUE : un `sourceSetId` absent n'est dans AUCUNE sous-section.
function memeSousSection(sourceSetId, sousSection) {
    if (sousSection == null) return true;
    if (sourceSetId == null || sourceSetId === '') return false;
    return Number(sourceSetId) === Number(sousSection);
}
// 🔑 LOT JA-2 (2026-10-13) : `plageDeRangs: [début, fin]` — une liste artofpkm qui porte DEUX decks sous UN id et n'imprime aucun numéro (Intro Pack Neo, liste 42 : rangs 1-40 = deck
// Chikorita, 41-80 = deck Totodile, 35 produits sur 35 au rang-dans-le-deck = numéro Cardmarket). La ligne ne traite que les entrées dont le RANG (`n`) tombe dans la plage. Une garde
// écrite par ce qu'elle autorise : deux entiers début ≤ fin, sinon on LÈVE (une plage illisible ne se lit pas comme « toute la liste »). Sans déclaration, rien ne change.
function plageDeRangs(S) {
    const p = S?.plageDeRangs;
    if (p == null) return null;
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isInteger) || p[0] < 1 || p[0] > p[1]) throw new Error(`plageDeRangs invalide (${JSON.stringify(p)}) : deux entiers 1 ≤ début ≤ fin attendus`);
    return p;
}
const dansLaPlage = (n, S) => { const p = plageDeRangs(S); return p == null || (Number.isInteger(Number(n)) && Number(n) >= p[0] && Number(n) <= p[1]); };
function entreesDeLaLigne(entrees, S) {
    const liste = entrees || [];
    const parSousSection = S?.sousSection == null ? liste : liste.filter(e => memeSousSection(e.sourceSetId, S.sousSection));
    return plageDeRangs(S) == null ? parSousSection : parSousSection.filter(e => dansLaPlage(e.n, S));
}
function entreesDeMesure(entrees, S, n = N_MESURES) { return entreesDeLaLigne(entrees, S).slice(0, n); }
module.exports = { entreesDeMesure, entreesDeLaLigne, memeSousSection, plageDeRangs, dansLaPlage, N_MESURES };
