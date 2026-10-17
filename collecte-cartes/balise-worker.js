// ============================================================
// LA BALISE DU WORKER — « sur quel commit tourne le processus qui va lire ça ? »
// ============================================================
// 🔴 POURQUOI ELLE EXISTE, ET C'EST LA MOITIÉ QUI MANQUAIT À LA GARDE DU §23 : le commit du worker
// était lu dans le VERROU DE SOURCE. Or un worker dont la file est vide **rend son verrou et dort
// dix minutes** (`collecteur-images.js`, la boucle) — parce qu'un dormeur ne fait aucune requête et
// n'a donc rien à protéger. **Le seul moment où le worker publie son commit est donc celui où il
// travaille**, c'est-à-dire exactement le moment où l'on ne remplit pas la file.
// ⚠️ Conséquence mesurée le 2026-09-21 : la garde ne pouvait JAMAIS conclure sur une file vide, et
// comme elle échouait vers le passant, elle laissait enfiler sans avoir rien lu.
//
// 🔑 UN VERROU ET UNE BALISE NE RÉPONDENT PAS À LA MÊME QUESTION, ET LES CONFONDRE EST CE QUI A
// COÛTÉ CHER : un verrou dit « QUI a le droit de frapper la source maintenant » — il doit donc
// disparaître dès qu'on ne frappe plus. Une balise dit « QUEL CODE tourne ici » — elle doit vivre
// tant que le processus vit, au travail comme au repos. Le premier protège un tiers, la seconde
// répond à une question sur nous.
//
// La balise bat à chaque tour de boucle ET pendant le sommeil. Elle porte son `commit`, et c'est
// l'ABSENCE de ce champ qui reste l'information : un worker qui n'écrit pas de balise tourne sur du
// code antérieur au 2026-09-21 (§23).
const os = require('os');
const { VERSION } = require('../version-code');

const COLLECTION = 'collecte_images_etat';          // la collection réelle, pas le nom du modèle mongoose
const PREFIXE = 'worker/';
const FRAIS_MS = 3 * 60 * 1000;                     // trois battements manqués, comme le verrou global (§17)

const identite = Object.freeze({ pid: process.pid, hote: os.hostname(), commit: VERSION });

/** L'identifiant de CE processus. Un pod remplacé en crée un autre ; les vieux expirent. */
function idBalise() { return `${PREFIXE}${identite.hote}/${identite.pid}`; }

/**
 * Pose ou rafraîchit la balise. À appeler à chaque tour de boucle, y compris au repos.
 * @param {*} db  la base `cartes` (driver natif)
 * @param {'travail'|'repos'} etat  ce que le worker est en train de faire
 */
// 🔑 (2026-10-17, collecte locale) Le commit se RÉSOUT À CHAQUE BATTEMENT (commit-local.js) : un arbre devenu sale après le démarrage retire
// le champ à la minute suivante. Sans commit vérifiable, le champ est ABSENT (jamais « local », jamais null) : la garde bloque.
// `resoudre` est injectable pour les bancs ; par défaut, la définition unique de commit-local.js.
async function battre(db, etat = 'travail', { commit: resoudre = () => require('./commit-local').commitVerifiable() } = {}) {
    const { commit } = resoudre();
    const { commit: _ignore, ...sansCommit } = identite;
    await db.collection(COLLECTION).updateOne({ _id: idBalise() },
        { $set: { balise: { ...sansCommit, ...(commit ? { commit } : {}), etat, depuis: new Date() } } }, { upsert: true });
}

/** Retire la balise de CE processus. Un arrêt propre ne laisse pas de fantôme. */
async function eteindre(db) {
    await db.collection(COLLECTION).deleteOne({ _id: idBalise() });
}

/**
 * Lit les balises FRAÎCHES. Rend { balises, perimees } — jamais un `null` qui ressemblerait à
 * « tout va bien ». C'est à l'appelant de décider, et la garde de `remettre-en-file.js` BLOQUE dès
 * qu'elle ne peut pas conclure.
 */
async function lireBalises(db) {
    const docs = await db.collection(COLLECTION).find({ _id: new RegExp(`^${PREFIXE}`) }).toArray();
    const maintenant = Date.now();
    const toutes = docs.map(d => d.balise).filter(Boolean);
    const balises = toutes.filter(b => b.depuis && maintenant - new Date(b.depuis).getTime() < FRAIS_MS);
    return { balises, perimees: toutes.filter(b => !balises.includes(b)), FRAIS_MS };
}

module.exports = { battre, eteindre, lireBalises, idBalise, identite, COLLECTION, PREFIXE, FRAIS_MS };
