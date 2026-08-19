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

const { fichiersDuProjet, verifierSyntaxe, verifierImports,
    verifierEnveloppes, SOURCES_A_ENVELOPPER, estUnOutil } = require('./verifier-sources');

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

console.log('\n--- 3. Une source interrogée SANS enveloppe ? ---');
// ⚠️ CE CONTRÔLE EXISTE POUR LE DIXIÈME APPEL, PAS POUR LES NEUF PREMIERS. Les neuf sont
// enveloppés aujourd'hui ; rien ne garantissait que le suivant le soit, et son oubli
// serait invisible — la ligne sortirait comme une absence constatée. Voir sources.js.
// S'il crie à tort parce que tu as enveloppé autrement : ADAPTE-LE, ne le supprime pas.
let nusTotal = 0, outilsDispenses = 0;
for (const f of fichiers) {
    // Les outils sont dispensés — ils n'affirment rien à personne, et une exception qui
    // remonte y est VISIBLE au lieu d'être silencieuse. La règle échoue par défaut :
    // c'est la liste des outils qui est explicite, pas celle des fichiers contrôlés.
    if (estUnOutil(f)) { outilsDispenses++; continue; }
    let nus = [];
    try { nus = verifierEnveloppes(f); }
    catch (e) { echecs++; console.log(`  ❌ analyse impossible de ${f} : ${e.message}`); continue; }
    for (const n of nus) {
        echecs++; nusTotal++;
        console.log(`  ❌ ${n.fichier}:${n.ligne} appelle « ${n.nom} » hors de interrogerSource`);
        console.log(`       ${n.code}`);
        console.log(`       -> une panne y passerait pour une absence. Voir sources.js.`);
    }
}
if (!nusTotal) {
    console.log(`  ✅ les ${SOURCES_A_ENVELOPPER.length} sources ne sont appelées qu'enveloppées` +
        `   (${fichiers.length - outilsDispenses} fichier(s) contrôlé(s), ${outilsDispenses} outil(s) dispensé(s))`);
}

console.log(echecs === 0
    ? `\n🎉 ${fichiers.length} fichiers chargeables.`
    : `\n❌ ${echecs} échec(s) — un fichier qui ne parse pas ne tourne pas, quelles que soient les suites.`);
process.exit(echecs === 0 ? 0 : 1);
