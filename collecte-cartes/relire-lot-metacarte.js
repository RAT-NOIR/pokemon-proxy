// La relecture finale de poser-par-metacarte.js : elle compte ce que CE lancement a écrit, jamais le total de la preuve dans ces codes.
// 🔑 Le total mélange les lignes de même preuve écrites par un lancement antérieur (le 2026-10-08 : 131 du lot + 39 du 2026-10-06 = 170 « pour 131 »)
// et échoue sur toute base où la preuve a déjà servi. Le critère qui ne peut pas compter une ligne d'un autre lot est la CONJONCTION de deux
// choses que seul ce lancement réunit : l'`_id` figure dans la liste que CE lancement a écrite (carteId|idProduct) ET son `verifieLe` est l'instant
// `le` posé par ce lancement. Une ligne du lot déjà présente avant (`$setOnInsert` ne la réécrit pas) garde son ancien `verifieLe` : non comptée.
const PREUVE = 'metacarte+nom+attaques';
async function relireLot(col, { codes, ids, le }) {
    const [ecrites, total] = await Promise.all([
        col.countDocuments({ _id: { $in: ids }, preuve: PREUVE, route: { $in: codes }, verifieLe: le }),
        col.countDocuments({ preuve: PREUVE, route: { $in: codes } })
    ]);
    return { ecrites, dejaAvant: total - ecrites, total };
}
module.exports = { relireLot, PREUVE };
