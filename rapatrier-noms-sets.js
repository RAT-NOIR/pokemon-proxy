// ============================================================
// RAPATRIER LE NOM D'EXPANSION CARDMARKET DANS `sets` — le site n'ouvre pas de seconde connexion
// ============================================================
//   node rapatrier-noms-sets.js [--ecrire]
//
// La page /fr/sets affichait les noms en KANA, illisibles. `sets.nomEn` est écarté à juste titre :
// c'est le set international HOMOLOGUE, un autre produit (« Base Set » pour Expansion Pack).
// Le bon nom est celui que CARDMARKET donne à l'expansion japonaise — en anglais, et il désigne
// CETTE expansion-là : « Rocket-Gang », « Gold-Silver-to-a-New-World », « Cry-from-the-Mysterious ».
//
// Il vit dans `numeros_cartes.slugSet`, sur le cluster de PRODUCTION que le site ne peut pas lire.
// Même geste que pour `slug`/`slugSet` : on le rapatrie, on ne fait pas ouvrir une seconde connexion.
//
// ⚠️ Sans --ecrire, l'outil ne fait que MESURER et imprimer. C'est le défaut.

require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { TABLE } = require('./collecte-cartes/table-sets');

// « Gold-Silver-to-a-New-World » -> « Gold Silver to a New World ». Les « & » et les virgules du nom
// Cardmarket sont perdus par la slugification et ne se devinent pas : on rend le slug lisible, on
// ne reconstruit pas une ponctuation qu'on n'a pas.
const lisible = s => String(s || '').replace(/-/g, ' ').trim();

/**
 * Le nom à AFFICHER, et d'où il vient — jamais un nom sans sa provenance.
 * 🔴 `nomEn` est EXCLU pour un set japonais : c'est le jumeau occidental, un autre produit.
 * Il est au contraire le bon nom pour un set occidental, où il désigne le set lui-même.
 */
function choisirAffichage(s, nomCardmarket) {
    const essais = s.region === 'intl'
        ? [['nomFr', s.nomFr], ['nomEn', s.nomEn], ['cardmarket', nomCardmarket]]
        : [['nomFr', s.nomFr], ['cardmarket', nomCardmarket], ['nomJaTraduit', s.nomJaTraduit]];
    for (const [source, v] of essais) if (v && String(v).trim()) return { nom: String(v).trim(), source };
    return { nom: s.code || s._id, source: 'code' };
}

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions();
    const M = modeles(cx);
    const NC = prod.db.collection('numeros_cartes');

    const codes = TABLE.filter(L => L.verifie);
    let avecCardmarket = 0, ecrits = 0;
    const parSource = {};
    const lignes = [];
    const choisis = [];   // rempli avant le contrôle de collision : rien n'est écrit avant lui
    for (const L of codes) {
        const s = await M.Set.findById(L.slugSet).lean();
        if (!s) { lignes.push(`   ${L.code.padEnd(7)} ❌ absent de \`sets\``); continue; }
        // le slugSet MAJORITAIRE de l'expansion : une expansion peut porter des lignes à slugSet
        // vide (les produits appris sans slug du §6), qu'on ne compte pas comme un nom.
        const g = await NC.aggregate([{ $match: { idExpansion: L.exp, slugSet: { $nin: [null, ''] } } }, { $group: { _id: '$slugSet', n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
        const nomCardmarket = g.length ? lisible(g[0]._id) : null;
        if (nomCardmarket) avecCardmarket++;
        const a = choisirAffichage(s, nomCardmarket);
        parSource[a.source] = (parSource[a.source] || 0) + 1;
        lignes.push(`   ${L.code.padEnd(7)} ${s.region === 'intl' ? 'intl' : 'jp  '} cardmarket ${nomCardmarket ? `« ${nomCardmarket} »`.padEnd(44) : '— AUCUN'.padEnd(44)} affiché « ${a.nom} » (${a.source})`);
        choisis.push({ code: L.code, slug: L.slugSet, nomCardmarket, a });
    }
    for (const l of lignes) console.log(l);

    // 🔴 DEUX SETS NE PEUVENT PAS PORTER LE MÊME NOM À L'ÉCRAN. `xASC` et `ASC` ont le même `nomEn`
    // (« Ascended Heroes ») : la liste en aurait affiché deux identiques, et l'utilisateur n'aurait
    // eu aucun moyen de les distinguer. Cardmarket, lui, les sépare (« Ascended Heroes Additionals »).
    // Un nom d'affichage n'est pas seulement lisible, il doit être DISCRIMINANT — sinon il ne
    // désigne plus rien, et c'est le motif du « reste » (§8) appliqué à l'interface.
    const parNom = new Map();
    for (const c of choisis) { if (!parNom.has(c.a.nom)) parNom.set(c.a.nom, []); parNom.get(c.a.nom).push(c); }
    let departages = 0, collisionsRestantes = 0;
    for (const [nom, groupe] of parNom) {
        if (groupe.length < 2) continue;
        const distincts = new Set(groupe.map(c => c.nomCardmarket).filter(Boolean));
        if (distincts.size === groupe.length) {
            for (const c of groupe) { c.a = { nom: c.nomCardmarket, source: 'cardmarket (départage de collision)' }; departages++; }
            console.log(`   ⚠️ « ${nom} » porté par ${groupe.length} sets (${groupe.map(c => c.code).join(', ')}) — départagés par le nom Cardmarket`);
        } else {
            collisionsRestantes += groupe.length;
            console.log(`   ❌ « ${nom} » porté par ${groupe.length} sets (${groupe.map(c => c.code).join(', ')}) et Cardmarket ne les sépare pas`);
        }
    }
    const parSourceFinal = {};
    for (const c of choisis) parSourceFinal[c.a.source] = (parSourceFinal[c.a.source] || 0) + 1;
    if (ecrire) for (const c of choisis) { await M.Set.updateOne({ _id: c.slug }, { $set: { nomCardmarket: c.nomCardmarket, nomAffichage: c.a.nom, nomAffichageSource: c.a.source, nomsLe: new Date() } }); ecrits++; }

    console.log(`\n════ DÉNOMINATEUR : ${codes.length} sets de la table ════`);
    console.log(`   portant un nom Cardmarket : ${avecCardmarket} / ${codes.length}`);
    console.log(`   source du nom affiché     : ${JSON.stringify(parSourceFinal)}`);
    console.log(`   noms d'affichage DISTINCTS : ${new Set(choisis.map(c => c.a.nom)).size} / ${choisis.length}  ${collisionsRestantes ? `❌ ${collisionsRestantes} en collision` : '✅ tous distincts'}${departages ? ` (${departages} départagés par Cardmarket)` : ''}`);
    console.log(`   ${parSourceFinal.code ? `❌ ${parSourceFinal.code} set(s) retombent sur leur CODE — illisibles` : '✅ aucun set ne retombe sur son code'}`);
    console.log(ecrire ? `   écrits : ${ecrits}` : `   (mesure seule — relancer avec --ecrire pour écrire)`);

    // ---- la DATE, l'autre moitié de la question du site -------------------------------------
    const tous = await M.Set.find({}).select('code region dateSortieJa dateSortieEn nomJa').lean();
    const sansDate = tous.filter(s => !s.dateSortieJa && !s.dateSortieEn);
    console.log(`\n──── dates ────`);
    console.log(`   dénominateur : ${tous.length} sets · portant une date (JP ou EN) : ${tous.length - sansDate.length} · AUCUNE : ${sansDate.length}`);
    if (sansDate.length) console.log(`   sans date : ${sansDate.map(s => `${s.code} (${s.region})`).join(' · ')}`);
    await fermer();
})().catch(e => { console.error(e); process.exit(1); });
