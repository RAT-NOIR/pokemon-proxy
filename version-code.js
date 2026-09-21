// ============================================================
// LA VERSION DU CODE QUI TOURNE — une seule définition, pour tout le dépôt
// ============================================================
// Render pose `RENDER_GIT_COMMIT` ; en local on le dit par `VERSION`, sinon « local ».
//
// 🔑 POURQUOI UN FICHIER À TROIS LIGNES PLUTÔT QU'UNE CONSTANTE DANS `journal-scans.js` :
// l'avertissement était déjà écrit là-bas (« deux `String(process.env.RENDER_GIT_COMMIT || …)`
// dans deux fichiers créeraient deux versions du même fait, qui divergeraient au premier
// changement »). Le verrou de source a besoin du MÊME fait, et `journal-scans.js` traîne avec lui
// ses modèles Mongoose : l'importer depuis un collecteur pour trois caractères, c'est payer un
// module entier et risquer un cycle. **Une définition unique dans le module le plus LÉGER qui
// puisse la porter** — `journal-scans.js` la réexporte, donc aucun appelant existant ne change.
//
// ⚠️ ET CE QU'ELLE VAUT QUAND ELLE DIT « local » : rien de plus que « ce n'est pas un pod Render ».
// Un processus local tourne sur un arbre de travail, pas sur un commit — il peut porter des
// modifications non commises. Aucune garde ne doit donc lire « local » comme un commit connu.
const VERSION = String(process.env.RENDER_GIT_COMMIT || process.env.VERSION || 'local').slice(0, 12);

module.exports = { VERSION };
