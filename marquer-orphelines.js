// ============================================================
// MARQUER LES IMAGES ORPHELINES — aucun objet R2 sans décision écrite
// ============================================================
//   node marquer-orphelines.js                                                       (plan : rien d'écrit)
//   node lot-additif.js --quoi="…" --collections=images -- node marquer-orphelines.js --ecrire
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

// Les 9 que Bulbapedia n'avait PAS le 2026-09-12. Nommées, parce qu'une limite définitive se nomme.
// 🔴 CINQ SONT TOMBÉES LE 2026-09-23, ET LA LIMITE N'ÉTAIT PAS DANS LA SOURCE : les cinq Gold Star (PCG6 ×3, PCG9 ×2)
// sont listées par leur Setlist sous une écriture que le parseur n'a lue qu'à partir du 2026-09-15 (§21 n°8) ; ces deux
// sets n'avaient pas été recollectés depuis. La recollecte les a trouvées (3 + 2 redirections vers les pages EX Delta
// Species / Dragon Frontiers), et les cinq objets R2 GARDÉS ici ont joint sans une requête. C'est exactement le cas
// pour lequel on les avait gardés. Le §24 écrivait « aucune page » ; il fallait écrire « aucune page LUE ».
// 🔴 ET LES DEUX « PI » SONT TOMBÉS LE 2026-10-05 : ce sont des PIDGEOT (ピジョット, regardés à l'œil), titrés « Pi, … » par artofpkm —
// un nom TRONQUÉ. Joints par collecte-cartes/corrections-images.js. « Irréductible » voulait dire « titre illisible pour nous ».
const IRREDUCTIBLES = new Set([
    'artofpkm/18/54',                                          // Team Rocket's Hitmonchan (G1)
    'artofpkm/25/85'                                           // Blaine's Quiz #3 (G2)
]);

// 🔴 L'OUTIL A MARQUÉ 828 IMAGES À TORT LE 2026-10-05 (défait par restaurer-marqueurs-orphelines.js) : il prenait pour orpheline toute
// image SANS `carteId`. Écrit quand `images` ne contenait que des fichiers artofpkm, il ne savait pas que la jointure n'écrit pas de
// `carteId` sur une image partagée avec un set de base — servie pourtant. Une orpheline se définit par ce qu'elle EST : un fichier
// à l'état « ok » qu'AUCUNE carte ne sert (`cartes.images.cleR2`). Et l'outil n'écrit plus que sur `--ecrire`.
const AUTORISES = [/^--ecrire$/];
const inconnus = process.argv.slice(2).filter(a => !AUTORISES.some(r => r.test(a)));
if (inconnus.length) { console.error(`❌ argument inconnu : ${inconnus.join(' ')} — autorisé : [--ecrire]`); process.exit(2); }

(async () => {
    const { cartes: cx, fermer } = await ouvrirConnexions();
    const M = modeles(cx);
    const servies = new Set(await cx.db.collection('cartes').distinct('images.cleR2'));
    const candidates = await M.Image.find({ etat: 'ok', $or: [{ carteId: null }, { carteId: { $exists: false } }] }).lean();
    const orph = candidates.filter(im => !servies.has(im.cleR2));
    const total = await M.Image.countDocuments({});
    console.log(`dénominateur : ${total} entrées source · ${candidates.length} à l'état « ok » sans carteId · dont ${orph.length} servies par AUCUNE carte (orphelines)`);
    if (!process.argv.includes('--ecrire')) {
        for (const im of orph.slice(0, 30)) console.log(`   ${im.cleR2} « ${im.titre ?? '—'} » ${im.set ?? '—'}`);
        console.log('(plan seul — --ecrire sous lot-additif.js)'); await fermer(); return;
    }
    let irr = 0, amb = 0;
    for (const im of orph) {
        const motif = IRREDUCTIBLES.has(im._id) ? 'irreductible' : 'ambigue';
        if (motif === 'irreductible') irr++; else amb++;
        await M.Image.updateOne({ _id: im._id }, { $set: { orpheline: true, orphelineMotif: motif, decisionLe: new Date(), decision: 'garder' } });
    }
    // et on RETIRE le marqueur de celles qui ont fini par joindre — sinon il vieillit en mensonge.
    const nettoyees = await M.Image.updateMany({ orpheline: true, $or: [{ carteId: { $ne: null, $exists: true } }, { cleR2: { $in: [...servies] } }] }, { $unset: { orpheline: 1, orphelineMotif: 1, decision: 1, decisionLe: 1 } });
    console.log(`   marquées « garder » : ${orph.length}  ·  irréductibles (aucune page Bulbapedia) : ${irr}  ·  ambiguës (plusieurs cartes, rien ne les sépare) : ${amb}`);
    console.log(`   marqueurs périmés retirés (elles ont joint depuis) : ${nettoyees.modifiedCount}`);
    console.log(`   ${irr === IRREDUCTIBLES.size ? '✅' : '❌'} les ${IRREDUCTIBLES.size} irréductibles nommées sont toutes présentes : ${irr} trouvées`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
