// ============================================================
// LA VÉRIFICATION D'APRÈS-ÉCRITURE D'UN LOT DE LIGNES (PHASE 3a, D1 du 2026-10-24) — pure, partagée par poser-wcd.js et poser-reimpressions.js
// ============================================================
// L'occurrence : `poser-wcd.js` imprimait « 🔴 LE COMPTE RÉEL NE COLLE PAS » par un simple console.log (exit 0), et son attendu (1 684) comparait un compte de la base entière à un lot.
// Une garde rouge SORT en code 1 : lot-additif.js lit le code de sortie. Elle s'écrit par ce qu'elle AUTORISE : tout compte qui n'est pas EXACTEMENT celui qu'on a posé est un problème.
// Entrées (des nombres lus APRÈS l'écriture, en base) :
//   · avant, apres      : le nombre de lignes de CETTE preuve avant et après ;
//   · inserees          : ce que l'écriture dit avoir inséré (upsertedCount) ;
//   · retrouvees        : ce qu'elle dit avoir retrouvé sans le modifier ou en le modifiant (matchedCount) ;
//   · posees            : le nombre de lignes du plan ;
//   · cartesAttendues, cartesRetrouvees : les cartes dont `liens` devait recevoir les produits, et le matchedCount de cette écriture.
function verifierPose({ avant, apres, inserees, retrouvees, posees, cartesAttendues, cartesRetrouvees }) {
    const nombres = { avant, apres, inserees, retrouvees, posees, cartesAttendues, cartesRetrouvees };
    for (const [k, v] of Object.entries(nombres)) if (!Number.isInteger(v) || v < 0) return { ok: false, problemes: [`le nombre « ${k} » n'est pas un entier lu : ${JSON.stringify(v)} — je ne peux pas conclure`] };
    const problemes = [];
    if (apres !== avant + inserees) problemes.push(`les lignes de cette preuve passent de ${avant} à ${apres} : ${inserees} insérées annoncées, ${avant + inserees} attendues`);
    if (inserees + retrouvees !== posees) problemes.push(`${inserees} insérées + ${retrouvees} retrouvées ne font pas les ${posees} lignes du plan`);
    if (cartesRetrouvees !== cartesAttendues) problemes.push(`${cartesRetrouvees} cartes retrouvées pour ${cartesAttendues} attendues (liens.idProduct)`);
    return { ok: problemes.length === 0, problemes };
}

module.exports = { verifierPose };
