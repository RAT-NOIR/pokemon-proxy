// ============================================================
// MARQUER LES IMAGES ORPHELINES — aucun objet R2 sans décision écrite
// ============================================================
//   node marquer-orphelines.js
//
// Une image sans `carteId` occupe R2 et ne s'affichera jamais. Elle ne doit pas rester là SANS
// DÉCISION : ou on la supprime, ou on la garde en disant pourquoi. La décision est GARDER, et elle
// est portée par la ligne elle-même (`orpheline`, `orphelineMotif`, `decisionLe`), pas seulement
// par une note de dépôt.
//
// POURQUOI GARDER — les deux coûts, comparés :
//   · garder  : 18 objets WebP, ~0,6 Mo sur un bucket qui en prévoit 6 600.
//   · effacer : il faudra les redemander à artofpkm.com le jour où la clé arrive — une requête de
//               plus chez un tiers à qui on promet déjà 1 requête / 5 s, pour un octet qu'on avait.
// Le motif est écrit par ligne : `irreductible` (aucune page Bulbapedia n'existe) ou `ambigue`
// (plusieurs cartes du set correspondent, rien ne les sépare aujourd'hui).

require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');

// Les 9 que Bulbapedia n'a PAS. Nommées, parce qu'une limite définitive se nomme.
const IRREDUCTIBLES = new Set([
    'artofpkm/127/28', 'artofpkm/127/54', 'artofpkm/127/73',   // Kyogre ☆, Groudon ☆, Metagross ☆ (PCG6)
    'artofpkm/137/15', 'artofpkm/137/52',                      // Mew ☆, Charizard ☆ (PCG9)
    'artofpkm/8/34', 'artofpkm/27/2',                          // « Pi » (Jungle, Southern Islands)
    'artofpkm/18/54',                                          // Team Rocket's Hitmonchan (G1)
    'artofpkm/25/85'                                           // Blaine's Quiz #3 (G2)
]);

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions();
    const M = modeles(cx);
    const orph = await M.Image.find({ $or: [{ carteId: null }, { carteId: { $exists: false } }] }).lean();
    const total = await M.Image.countDocuments({});
    console.log(`dénominateur : ${total} entrées source · ${orph.length} sans carteId`);
    let irr = 0, amb = 0;
    for (const im of orph) {
        const motif = IRREDUCTIBLES.has(im._id) ? 'irreductible' : 'ambigue';
        if (motif === 'irreductible') irr++; else amb++;
        await M.Image.updateOne({ _id: im._id }, { $set: { orpheline: true, orphelineMotif: motif, decisionLe: new Date(), decision: 'garder' } });
    }
    // et on RETIRE le marqueur de celles qui ont fini par joindre — sinon il vieillit en mensonge.
    const nettoyees = await M.Image.updateMany({ orpheline: true, carteId: { $ne: null, $exists: true } }, { $unset: { orpheline: 1, orphelineMotif: 1, decision: 1, decisionLe: 1 } });
    console.log(`   marquées « garder » : ${orph.length}  ·  irréductibles (aucune page Bulbapedia) : ${irr}  ·  ambiguës (plusieurs cartes, rien ne les sépare) : ${amb}`);
    console.log(`   marqueurs périmés retirés (elles ont joint depuis) : ${nettoyees.modifiedCount}`);
    console.log(`   ${irr === IRREDUCTIBLES.size ? '✅' : '❌'} les ${IRREDUCTIBLES.size} irréductibles nommées sont toutes présentes : ${irr} trouvées`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
