// ============================================================
// QUELLE CELLULE DU VERROU EST REMPLIE, ET POURQUOI L'AUTRE NE L'EST PAS
// ============================================================
// POURQUOI CE SCRIPT EXISTE. `verrou-charges.js` dit « cellule vide » ; il ne dit pas
// POURQUOI. Or les trois causes appellent trois actions différentes :
//   - aucune ligne de ce type au journal      -> il faut scanner une carte de ce type
//   - des lignes, mais toutes en ÉCHEC        -> la chaîne rate ce type de carte : un vrai
//                                                défaut, à regarder avant de rescanner
//   - des lignes abouties, mais sans photo    -> lignes trop anciennes (champ imageUrl
//                                                ajouté après) : rescanner suffit
// Sans cette distinction on rescanne au hasard, ou pire on cherche un bug là où il n'y a
// qu'un manque de données.
//
// LECTURE SEULE. USAGE :  node verrou-cellules.js --base=test

require('dotenv').config();
const mongoose = require('mongoose');
const S = require('./scoring');
const { SETS_VINTAGE_JAPONAIS } = require('./sets-vintage-japonais');

const arg = process.argv.find(a => a.startsWith('--base='));
if (!arg) {
    console.error('❌ Base non nommée. Usage : node verrou-cellules.js --base=test');
    process.exit(1);
}
const BASE = arg.slice('--base='.length);
const codesTable = SETS_VINTAGE_JAPONAIS.map(s => S.normaliserCodeSet(s.code));

// Les mêmes prédicats que verrou-charges.js. ⚠️ Ils y sont DUPLIQUÉS, et c'est le genre de
// double définition qui a déjà coûté cher ici (LANGUES_ASIATIQUES, l'objet scoring). Si
// l'un des deux bouge, l'autre doit bouger : ils sont volontairement identiques mot pour
// mot pour que la comparaison saute aux yeux.
const CELLULES = [
    {
        nom: 'asiatique · setCode HORS table close',
        enjeu: '⚠️ C\'EST CELLE QUI REPRODUIT LE PLANTAGE DU 4 AOÛT',
        conseil: 'une japonaise MODERNE au code bien lisible (sv1a, s12a, sv2a…) : hors table close par construction, et TCGdex la couvre bien',
        test: d => S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase())
            && !!S.normaliserCodeSet(d.setCode)
            && !codesTable.includes(S.ALIAS_CODES_LUS.get(S.normaliserCodeSet(d.setCode)) || S.normaliserCodeSet(d.setCode))
    },
    {
        nom: 'asiatique · aucun setCode lu',
        enjeu: 'la branche qui sortait avant l\'appel, et ne plantait pas',
        conseil: 'une japonaise vintage sans code imprimé',
        test: d => S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase()) && !S.normaliserCodeSet(d.setCode)
    },
    {
        nom: 'occidentale',
        enjeu: 'toutes les gardes du chantier sont conditionnées à LANGUES_ASIATIQUES',
        conseil: 'n\'importe quelle carte EN/FR/DE qui aboutit',
        test: d => !S.LANGUES_ASIATIQUES.includes(String(d.langue || '').toUpperCase())
    }
];

(async () => {
    const c = await mongoose.createConnection(process.env.MONGODB_URI, { dbName: BASE }).asPromise();
    console.log(`base : ${c.db.databaseName} (LECTURE SEULE)\n`);
    const docs = await c.collection('journal_scans').find({}).sort({ le: -1 }).toArray();
    console.log(`${docs.length} lignes au journal\n`);

    let remplies = 0;
    for (const cel of CELLULES) {
        const toutes = docs.filter(cel.test);
        const abouties = toutes.filter(d => d.idProduct != null);
        const utilisables = abouties.filter(d => d.imageUrl && d.nom);
        const ok = utilisables.length > 0;
        if (ok) remplies++;

        console.log(`${ok ? '✅' : '❌'} ${cel.nom}`);
        console.log(`   ${cel.enjeu}`);
        console.log(`   ${toutes.length} ligne(s) de ce type · ${abouties.length} ont abouti · ${utilisables.length} avec photo`);
        if (ok) {
            const d = utilisables[0];
            console.log(`   -> charge : "${d.nom}" n°${d.numero ?? '—'} setCode=${d.setCode ?? '—'} ${d.langue} -> ${d.idProduct} (${d.le?.toISOString?.().slice(0, 16)})`);
        } else {
            // LA CAUSE EXACTE, parce qu'elle décide de ce qu'il faut faire.
            if (toutes.length === 0) {
                console.log(`   -> CAUSE : aucun scan de ce type. ACTION : ${cel.conseil}`);
            } else if (abouties.length === 0) {
                console.log(`   -> CAUSE : ${toutes.length} scan(s) de ce type, TOUS EN ÉCHEC.`);
                console.log(`      Ce n'est pas un manque de données : la chaîne RATE ce type de carte.`);
                for (const d of toutes.slice(0, 5)) {
                    console.log(`        "${d.nom}" n°${d.numero ?? '—'} setCode=${d.setCode ?? '—'} -> ${d.motifEchec ?? '?'} (${d.le?.toISOString?.().slice(0, 10)})`);
                }
            } else {
                console.log(`   -> CAUSE : ${abouties.length} scan(s) ont abouti mais SANS PHOTO enregistrée`);
                console.log(`      (lignes antérieures au champ imageUrl). ACTION : rescanne, ${cel.conseil}`);
            }
        }
        console.log('');
    }

    console.log(`${remplies}/3 cellules remplissables aujourd'hui.`);
    if (remplies < 3) console.log(`Après un nouveau scan : node verrou-charges.js --base=test  puis  node verrou-avant-push.js`);
    await c.close();
})();
