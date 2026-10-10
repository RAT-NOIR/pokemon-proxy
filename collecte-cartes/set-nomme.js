// ============================================================
// UN SET NAÎT NOMMÉ, OU IL NE NAÎT PAS — le point d'entrée unique de la création d'un document `sets`
// ============================================================
// 🔴 EX-TRAINER-KIT-2 (2026-10-08) : `poser-par-metacarte.js` a créé le set (`$setOnInsert` sans `nomAffichage`) à 08:51 UTC, dans un lot dont
// l'en-tête renvoyait le nom à une AUTRE commande (« puis rapatrier-noms-sets.js »). Le site ne publie qu'un set nommé : le set est resté
// à moitié créé — cartes et lignes en base, aucun nom — et deux cliquets du site ont sonné (sets-sans-nom, sets-hors-catalogue). C'est le §57
// de nouveau : le collecteur crée et ne nomme pas. Quatre autres outils créaient un set de la même façon ; un seul geste renvoyé « à plus tard »
// suffit à le produire, donc le geste n'est plus renvoyé.
//
// 🔑 ÉCRIT PAR CE QU'IL AUTORISE : `insererSetNeuf` n'insère qu'un set dont `nommerLesNouveaux` a rendu un nom, ou un set déjà en base. Tout autre
// cas LÈVE « SET SANS NOM », AVANT la première écriture du lot (l'appelant nomme tous ses sets neufs dès son plan). Le nom est celui de la règle de
// `nom-affichage.js` (§57, §26 : jamais `nomEn` d'un set non occidental, jamais `nomFr`, collisions vérifiées contre TOUS les noms posés) — rien
// n'est inventé ici : `proposerNoms` est appelée telle quelle. Un set pour lequel la règle ne trouve aucun nom libre ne naît pas : il est refusé
// avec sa raison.
const { TABLE, TABLE_AUTO, TABLE_SANS_PAGE } = require('./table-sets');
const { proposerNoms } = require('./nom-affichage');

const CHAMPS_NOM = ['nomAffichage', 'nomAffichageSource', 'nomAffichagePreuve', 'nomCardmarket', 'nomsLe'];

function tableParSlug() {
    const parSlug = new Map();
    for (const L of [...TABLE, ...TABLE_AUTO, ...TABLE_SANS_PAGE]) if (L.slugSet && !parSlug.has(L.slugSet)) parSlug.set(L.slugSet, L);
    return parSlug;
}

/**
 * Pure. `neufs` : les documents `sets` qu'on s'apprête à insérer (sans nom) ; `existants` : TOUS les documents `sets` de la base ;
 * `slugMajoritaire` : idExpansion -> slugSet Cardmarket majoritaire. Rend { noms: Map<slug, champs>, refuses: [...] }.
 */
function nommerPur({ neufs, existants, slugMajoritaire, parSlug }) {
    const ids = new Set(neufs.map(s => s._id));
    const autres = existants.filter(s => !ids.has(s._id));
    const { proposes, refuses } = proposerNoms([...autres, ...neufs.map(s => ({ ...s, nomAffichage: undefined }))], parSlug, slugMajoritaire);
    const noms = new Map();
    for (const c of proposes) if (ids.has(c.s._id)) noms.set(c.s._id, { nomAffichage: c.a.nom, nomAffichageSource: c.a.source, nomAffichagePreuve: c.preuve, nomCardmarket: c.nomCardmarket, nomsLe: new Date() });
    return { noms, refuses: refuses.filter(c => ids.has(c.s._id)) };
}

/**
 * Lit `sets` (setsDb = la base `cartes`) et `numeros_cartes` (prodDb = la base de production, lecture seule), nomme les sets NEUFS, LÈVE si l'un
 * d'eux ne peut pas l'être. `docs` : les documents tels qu'ils seraient insérés. Rend { champsDe: Map<slug, champs>, existants: Set<slug> }.
 * Un set déjà en base n'est ni renommé ni refusé (additif : `$setOnInsert` ne le touche pas).
 */
async function nommerLesNouveaux(setsDb, prodDb, docs) {
    const tous = await setsDb.collection('sets').find({}, { projection: { _id: 1, nomAffichage: 1, nomEn: 1, nomJaTraduit: 1, region: 1, code: 1, idExpansion: 1 } }).toArray();
    const presents = new Set(tous.map(s => s._id));
    const neufs = docs.filter(d => !presents.has(d._id));
    const existants = new Set(docs.filter(d => presents.has(d._id)).map(d => d._id));
    if (!neufs.length) return { champsDe: new Map(), existants };
    const exps = [...new Set(neufs.flatMap(s => [].concat(s.idExpansion ?? [])))];
    const slugMajoritaire = new Map();
    if (exps.length) {
        const g = await prodDb.collection('numeros_cartes').aggregate([{ $match: { idExpansion: { $in: exps }, slugSet: { $nin: [null, ''] } } },
            { $group: { _id: { exp: '$idExpansion', slug: '$slugSet' }, n: { $sum: 1 } } }, { $sort: { n: -1 } }]).toArray();
        for (const x of g) if (!slugMajoritaire.has(x._id.exp)) slugMajoritaire.set(x._id.exp, x._id.slug);
    }
    const { noms, refuses } = nommerPur({ neufs, existants: tous, slugMajoritaire, parSlug: tableParSlug() });
    if (refuses.length || noms.size !== neufs.length) {
        const sans = neufs.filter(s => !noms.has(s._id)).map(s => s._id);
        throw new Error(`SET SANS NOM REFUSÉ — ${sans.length} set(s) neuf(s) ne peuvent pas naître nommés, rien n'est écrit : ${refuses.map(c => `${c.s._id} (${c.raison})`).join(' ; ') || sans.join(', ')}`);
    }
    return { champsDe: noms, existants };
}

/** Insère un set NEUF, nom compris. Sans nom pour un set absent de la base : LÈVE, rien n'est écrit. Rend upsertedCount. */
async function insererSetNeuf(S, doc, nommes) {
    const { _id, ...corps } = doc;
    const champs = nommes?.champsDe?.get(_id);
    if (!champs && !nommes?.existants?.has(_id)) throw new Error(`SET SANS NOM : « ${_id} » n'a pas été nommé par nommerLesNouveaux — un set ne naît jamais sans nomAffichage, rien n'est écrit.`);
    if (champs && (typeof champs.nomAffichage !== 'string' || !champs.nomAffichage.trim())) throw new Error(`SET SANS NOM : le nom proposé pour « ${_id} » est vide, rien n'est écrit.`);
    return (await S.updateOne({ _id }, { $setOnInsert: { ...corps, ...(champs ?? {}) } }, { upsert: true })).upsertedCount;
}

/** Pour un outil qui crée son set par un `$set` + upsert (collecteur-texte.js) : les champs de nom à mettre dans `$setOnInsert` ({} si le set existe déjà). LÈVE si le set ne peut pas naître nommé. */
async function champsDeNaissance(setsDb, prodDb, doc) {
    const n = await nommerLesNouveaux(setsDb, prodDb, [doc]);
    return n.champsDe.get(doc._id) ?? {};
}

module.exports = { CHAMPS_NOM, tableParSlug, nommerPur, nommerLesNouveaux, insererSetNeuf, champsDeNaissance };
