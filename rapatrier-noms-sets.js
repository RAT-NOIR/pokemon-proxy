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

// ════ 2026-09-19 : LES 38 SONT DEVENUS 439 ════
// L'outil ne traitait que `TABLE.filter(verifie)` — 38 sets sur les 439 de la collection. Le site
// affichait donc un nom lisible sur moins d'un set sur dix, et le CODE (ou les kana) sur tous les
// autres. Il parcourt maintenant `sets` en entier, et la ligne de table (TABLE + TABLE_AUTO) ne sert
// plus qu'à connaître l'`idExpansion` et la RÉGION.
//   ⚠️ DEUX PIÈGES MESURÉS AVANT D'ÉCRIRE, sur les 439 :
//   1. **146 sets ne portent NI nomFr NI nomEn NI nomJa NI nomJaTraduit** (les promos, les decks).
//      Ils reçoivent le nom CARDMARKET, qui existe toujours : `numeros_cartes.slugSet` rendu lisible,
//      et à défaut le `_id` du set, qui EST ce slug. Aucun set ne reste vide, aucun ne retombe sur son code.
//   2. **165 sets NON occidentaux portent un `nomEn`** qui est le jumeau international — « Shining Fates »
//      sur Shiny Star V (s4a), « Base Set » sur Expansion Pack. Ce n'est pas un cas isolé, c'est la règle
//      pour cette colonne : `nomEn` n'est retenu QUE pour un set occidental, où il désigne le set lui-même.
require('dotenv').config();
const { ouvrirConnexions } = require('./collecte-cartes/garde');
const { modeles } = require('./collecte-cartes/schemas');
const { TABLE, TABLE_AUTO } = require('./collecte-cartes/table-sets');

// « Gold-Silver-to-a-New-World » -> « Gold Silver to a New World ». Les « & » et les virgules du nom
// Cardmarket sont perdus par la slugification et ne se devinent pas : on rend le slug lisible, on
// ne reconstruit pas une ponctuation qu'on n'a pas.
const lisible = s => String(s || '').replace(/-/g, ' ').trim();

/**
 * Le nom à AFFICHER, et d'où il vient — jamais un nom sans sa provenance.
 * 🔴 `nomEn` est EXCLU pour tout set NON occidental : c'est le jumeau international, un autre produit
 * (mesuré le 2026-09-19 : 165 sets sur 439 sont dans ce cas, pas seulement Shiny Star V).
 * Il est au contraire le bon nom pour un set occidental, où il désigne le set lui-même.
 * ⚠️ Le dernier recours n'est PAS le code : c'est le `_id` du set rendu lisible, qui est le slug
 * Cardmarket de l'expansion. « Sword-Shield-Promos » est lisible, « s-P » ne l'est pas.
 */
function choisirAffichage(s, nomCardmarket, occidental) {
    const essais = occidental
        ? [['nomFr', s.nomFr], ['nomEn', s.nomEn], ['cardmarket', nomCardmarket], ['nomJaTraduit', s.nomJaTraduit]]
        : [['nomFr', s.nomFr], ['cardmarket', nomCardmarket], ['nomJaTraduit', s.nomJaTraduit]];
    for (const [source, v] of essais) if (v && String(v).trim()) return { nom: String(v).trim(), source };
    const duSlug = lisible(s._id);
    if (duSlug) return { nom: duSlug, source: 'slug du set' };
    return { nom: s.code || s._id, source: 'code' };
}

(async () => {
    const ecrire = process.argv.includes('--ecrire');
    const { cartes: cx, prod, fermer } = await ouvrirConnexions();
    const M = modeles(cx);
    const NC = prod.db.collection('numeros_cartes');

    // La ligne de table donne l'`idExpansion` et la RÉGION VRAIE (« chinois », « idth » : `sets.region`
    // ne connaît que jp/intl). Le parcours, lui, part de `sets` — tous les sets, pas les 38 vérifiés.
    const parSlug = new Map();
    for (const L of [...TABLE, ...TABLE_AUTO]) if (!parSlug.has(L.slugSet)) parSlug.set(L.slugSet, L);
    const tousLesSets = await M.Set.find({}).lean();

    // UNE SEULE agrégation pour toutes les expansions : le slugSet majoritaire de chacune. Une
    // expansion porte des lignes à slugSet vide (les 1 787 produits sans slug du §6) : elles ne
    // comptent pas comme un nom.
    const g = await NC.aggregate([
        { $match: { slugSet: { $nin: [null, ''] } } },
        { $group: { _id: { exp: '$idExpansion', slug: '$slugSet' }, n: { $sum: 1 } } },
        { $sort: { n: -1 } }
    ]).toArray();
    const slugMajoritaire = new Map();
    for (const x of g) if (!slugMajoritaire.has(x._id.exp)) slugMajoritaire.set(x._id.exp, x._id.slug);

    let avecCardmarket = 0, ecrits = 0, sansLigne = 0;
    const parSource = {};
    const lignes = [];
    const choisis = [];   // rempli avant le contrôle de collision : rien n'est écrit avant lui
    for (const s of tousLesSets) {
        const L = parSlug.get(s._id);
        if (!L) sansLigne++;
        // à défaut d'`idExpansion`, le `_id` du set EST le slug Cardmarket de l'expansion.
        const nomCardmarket = lisible(L && slugMajoritaire.get(L.exp) ? slugMajoritaire.get(L.exp) : s._id) || null;
        if (nomCardmarket) avecCardmarket++;
        const region = L?.region || (s.region === 'intl' ? 'occidental' : 'japonais');
        const occidental = region === 'occidental';
        const a = choisirAffichage(s, nomCardmarket, occidental);
        parSource[a.source] = (parSource[a.source] || 0) + 1;
        lignes.push(`   ${String(L?.code || s.code || s._id).padEnd(10)} ${region.padEnd(11)} cardmarket ${nomCardmarket ? `« ${nomCardmarket} »`.padEnd(44) : '— AUCUN'.padEnd(44)} affiché « ${a.nom} » (${a.source})`);
        choisis.push({ code: L?.code || s.code || s._id, slug: s._id, nomCardmarket, a });
    }
    if (process.argv.includes('--lignes')) for (const l of lignes) console.log(l);
    console.log(`   (${lignes.length} lignes ; --lignes pour les voir toutes · ${sansLigne} set(s) sans ligne de table)`);

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
            // Cardmarket ne les sépare pas (deux lignes de table sur la MÊME expansion). Le `_id` du
            // set, lui, est unique par construction : c'est le dernier départage, et il reste lisible.
            const parSlugLisible = new Set(groupe.map(c => lisible(c.slug)));
            if (parSlugLisible.size === groupe.length) {
                for (const c of groupe) { c.a = { nom: lisible(c.slug), source: 'slug du set (départage de collision)' }; departages++; }
                console.log(`   ⚠️ « ${nom} » porté par ${groupe.length} sets (${groupe.map(c => c.code).join(', ')}) — départagés par le slug du set`);
            } else {
                collisionsRestantes += groupe.length;
                console.log(`   ❌ « ${nom} » porté par ${groupe.length} sets (${groupe.map(c => c.code).join(', ')}) et rien ne les sépare`);
            }
        }
    }
    const parSourceFinal = {};
    for (const c of choisis) parSourceFinal[c.a.source] = (parSourceFinal[c.a.source] || 0) + 1;
    if (ecrire) for (const c of choisis) { await M.Set.updateOne({ _id: c.slug }, { $set: { nomCardmarket: c.nomCardmarket, nomAffichage: c.a.nom, nomAffichageSource: c.a.source, nomsLe: new Date() } }); ecrits++; }

    console.log(`\n════ DÉNOMINATEUR : ${tousLesSets.length} documents de \`sets\` ════`);
    console.log(`   portant un nom Cardmarket : ${avecCardmarket} / ${tousLesSets.length}`);
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
