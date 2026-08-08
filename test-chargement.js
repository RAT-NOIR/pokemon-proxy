// ============================================================
// TEST DE CHARGEMENT — chaque fichier du projet parse-t-il, et ses imports tiennent-ils ?
// ============================================================
// Il couvre ce que RIEN d'autre ne couvrait : les outils en ligne de commande.
// saisir-verites, banc-japonais, banc-seaux, verrou-charges, verrou-avant-push,
// couverture-index, chemin-du-scan, les mesures... aucun n'est chargé par une suite, et le
// verrou ne voit qu'index.js et la route. Ils n'étaient vérifiés que par leur usage.
//
// COÛT : ~1 s, aucun effet de bord, aucune connexion. Voir verifier-sources.js pour
// pourquoi ce n'est PAS un `require` de chaque script.
//
// USAGE : node test-chargement.js

const { fichiersDuProjet, verifierSyntaxe, verifierImports } = require('./verifier-sources');

let echecs = 0;
const fichiers = fichiersDuProjet();
console.log(`${fichiers.length} fichier(s) .js dans le projet\n`);

console.log('--- 1. Chaque fichier PARSE-t-il ? (node --check, sans exécution) ---');
const casses = verifierSyntaxe(fichiers);
if (!casses.length) console.log(`  ✅ les ${fichiers.length} fichiers parsent`);
for (const c of casses) {
    echecs++;
    console.log(`  ❌ ${c.fichier}`);
    console.log(`       ${c.message}`);
}

console.log('\n--- 2. Un nom exporté, appelé, mais jamais importé ? ---');
let oublisTotal = 0;
for (const f of fichiers) {
    let oublis = [];
    try { oublis = verifierImports(f); }
    catch (e) { echecs++; console.log(`  ❌ analyse impossible de ${f} : ${e.message}`); continue; }
    for (const o of oublis) {
        echecs++; oublisTotal++;
        console.log(`  ❌ ${o.fichier} appelle « ${o.nom} » (exporté par ${o.module}) sans l'importer`);
    }
}
if (!oublisTotal) console.log('  ✅ aucun identifiant utilisé sans être importé');

console.log(echecs === 0
    ? `\n🎉 ${fichiers.length} fichiers chargeables.`
    : `\n❌ ${echecs} échec(s) — un fichier qui ne parse pas ne tourne pas, quelles que soient les suites.`);
process.exit(echecs === 0 ? 0 : 1);
