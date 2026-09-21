// TEST — verifier-sources.js, la détection « un nom exporté, appelé, mais jamais importé ».
//   node test-verifier-sources.js      -> code 0 si tout passe
// Fixtures écrites dans un dossier temporaire, aucune base, aucun réseau.
//
// 🔴 L'OCCURRENCE, 2026-09-21. `test-chargement.js` échouait en permanence sur
// « collecteur-texte.js appelle « ligne » (exporté par ./collecte-cartes/table-sets) sans
// l'importer ». Le fichier importe bien ce module — sous un ALIAS — et n'appelle jamais `ligne`.
// Ce que le vérificateur avait vu était la CHAÎNE `` `${n} ligne(s) sans lien` `` : il retirait les
// commentaires avant de chercher des appels, jamais les littéraux de chaîne.
// ⚠️ ET UN TEST QUI ÉCHOUE EN PERMANENCE FINIT IGNORÉ — c'est lui qui masquera le prochain vrai
// défaut. Un faux positif dans un contrôle ne coûte pas une ligne de bruit, il coûte le contrôle.
//
// 🔑 ET LA MOITIÉ DU BANC EXISTE POUR QUE LA CORRECTION N'AILLE PAS TROP LOIN. Deux corrections
// étaient possibles et une seule est juste :
//   · retirer les CHAÎNES avant de chercher les appels — oui, c'est le défaut ;
//   · compter un import ALIASÉ (`{ ligne: ligneDeTable }`) comme important « ligne » — NON. Un alias
//     ne met pas `ligne` dans la portée : un appel à `ligne(` serait alors un vrai `ReferenceError`,
//     et l'ajouter à la liste des importés masquerait exactement le défaut que ce contrôle cherche.
// Les cas 3 et 5 tiennent cette frontière.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { verifierImports } = require('./verifier-sources');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'verif-sources-'));
let passes = 0, echecs = 0;
const ok = (nom, cond, detail = '') => { if (cond) { passes++; console.log(`   ✅ ${nom}`); } else { echecs++; console.log(`   🔴 ${nom}${detail ? ` — ${detail}` : ''}`); } };

/** Écrit une fixture et rend les oublis détectés. Le module cité existe vraiment : le vérificateur
 *  le charge pour lire ses exports, donc une fixture ne peut pas mentir sur ce point. */
function oublis(nom, code) {
    const f = path.join(dossier, `${nom}.js`);
    fs.writeFileSync(f, code);
    return verifierImports(f).map(o => o.nom);
}

const M = "require('./collecte-cartes/lecture-sure')";   // exporte champ, champSur, apparier, lireMongo

console.log('\n════ CE QUI NE DOIT PAS ÊTRE SIGNALÉ ════');

ok('1. un appel dans une chaîne à guillemets simples',
    !oublis('t1', `const { champ } = ${M};\nconsole.log('apparier(x) est une phrase');\nchamp({}, 'a');\n`).includes('apparier'));

ok('2. un appel dans une chaîne à guillemets doubles',
    !oublis('t2', `const { champ } = ${M};\nconsole.log("apparier(x)");\nchamp({}, 'a');\n`).includes('apparier'));

// 🔑 LE CAS RÉEL : `ligne(s)` dans un gabarit. C'est celui qui faisait échouer test-chargement.js.
ok('3. un appel dans le TEXTE d\'un gabarit (le cas de collecteur-texte.js)',
    !oublis('t3', `const { champ } = ${M};\nconsole.log(\`\${1} apparier(s) sans lien\`);\nchamp({}, 'a');\n`).includes('apparier'));

ok('4. un nom importé puis appelé',
    !oublis('t4', `const { apparier } = ${M};\napparier([1], [1]);\n`).includes('apparier'));

console.log('\n════ CE QUI DOIT ENCORE ÊTRE SIGNALÉ — la correction ne doit pas trop en retirer ════');

ok('5. un appel RÉEL, module requis, nom jamais importé',
    oublis('t5', `const { champ } = ${M};\napparier([1], [1]);\n`).includes('apparier'));

// ⚠️ Un `${...}` est du CODE, pas du texte : blanchir le gabarit en entier y cacherait de vrais appels.
ok('6. un appel dans une INTERPOLATION `${…}` reste vu',
    oublis('t6', `const { champ } = ${M};\nconsole.log(\`x \${apparier([1],[1])} y\`);\n`).includes('apparier'));

ok('7. un alias NE vaut PAS import : `{ apparier: autreNom }` puis appel à `apparier(`',
    oublis('t7', `const { apparier: autreNom } = ${M};\napparier([1], [1]);\n`).includes('apparier'));

ok('8. une chaîne NON TERMINÉE ne mange pas le reste du fichier',
    oublis('t8', `const { champ } = ${M};\nconst s = 'texte';\napparier([1], [1]);\n`).includes('apparier'));

fs.rmSync(dossier, { recursive: true, force: true });
console.log(`\n════ ${passes} passés · ${echecs} en échec ════`);
process.exit(echecs ? 1 : 0);
