// ============================================================
// LIRE UNE VALEUR — le remplaçant de `node -e` sous PowerShell
// ============================================================
//   node lire.js <fichier> [chemin.de.cle] [--n]
//
//   node lire.js package.json scripts
//   node lire.js collecte-cartes/table-sets-auto.json 0.code
//   node lire.js collecte-cartes/seuils-images.js LARGEUR_MIN
//   node lire.js collecte-cartes/univers-expansions.json --n          (longueur du tableau)
//
// 🔑 POURQUOI CET OUTIL EXISTE (2026-09-19). La règle « jamais `node -e` avec des guillemets sous
// PowerShell » est juste — PowerShell mange les guillemets et les `$`, et le code arrive déformé.
// Mais elle gênait un geste COURANT : lire une seule valeur d'un fichier. Écrire un script de six
// lignes pour une question d'une seconde se contourne sans y penser, et la règle a été enfreinte
// deux fois le 2026-09-19. Ici, la ligne de commande ne porte que des DONNÉES : un chemin de
// fichier et un chemin de clé. Aucun code n'y transite, donc rien à déformer.
// ⚠️ Un `.js` est chargé par `require` : il s'EXÉCUTE. On ne lit ainsi qu'un module du dépôt.
const fs = require('fs'), path = require('path');

const args = process.argv.slice(2).filter(a => a !== '--n');
const longueur = process.argv.includes('--n');
const [fichier, chemin] = args;
if (!fichier) { console.error('usage : node lire.js <fichier> [chemin.de.cle] [--n]'); process.exit(1); }

const abs = path.resolve(fichier);
const valeur = /\.json$/i.test(abs) ? JSON.parse(fs.readFileSync(abs, 'utf8')) : require(abs);
let v = valeur;
for (const cle of (chemin ? String(chemin).split('.') : [])) {
    if (v == null) { console.error(`❌ chemin « ${chemin} » : « ${cle} » est demandé sur ${v}`); process.exit(1); }
    v = v[cle];
}
if (longueur) console.log(Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : String(v).length));
else console.log(typeof v === 'object' ? JSON.stringify(v, null, 1) : String(v));
