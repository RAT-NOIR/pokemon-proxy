// ============================================================
// QUI PEUT INSÉRER UN DOCUMENT `sets` ? — le balayage que lit test-publication-sans-trou.js (EX-TRAINER-KIT-2, tour de correction 1)
// ============================================================
// 🔑 UNE GARDE S'ÉCRIT PAR CE QU'ELLE AUTORISE. Tout fichier .js/.mjs de la racine et de collecte-cartes/ qui contient une écriture de `sets`
// CAPABLE D'INSÉRER (insertOne, insertMany, bulkWrite, create, ou un update/replace avec `upsert` / `$setOnInsert`) doit, ou bien appeler
// le point d'entrée (`insererSetNeuf` / `champsDeNaissance`, collecte-cartes/set-nomme.js), ou bien figurer dans une liste FERMÉE et PROUVÉE
// ci-dessous. Tout le reste fait échouer le test. Un fichier de la liste qui n'existe plus, ou qui n'écrit plus de set, fait échouer le test
// aussi : une liste d'exceptions qu'on ne relit jamais vieillit en trou.
// ⚠️ LIMITE ÉCRITE : c'est une lecture de TEXTE. Elle suit la cible `collection('sets')`, ses alias (`const S = …collection('sets')`) et le modèle
// mongoose `M.Set` ; une écriture qui passerait par un nom construit (`collection(nom)`) ou par un autre dossier ne serait pas vue.
const fs = require('fs');
const path = require('path');

const POINTS_D_ENTREE = /\b(insererSetNeuf|champsDeNaissance)\s*\(/;

/** Les copieurs prouvés : ils REPRENNENT un document `sets` qui existe (ils n'en font naître aucun) et le suppriment sous l'ancienne identité. */
const COPIEURS_PROUVES = {
    'renommer-set.js': 'insertOne({ ...setDoc, _id: VERS }) puis deleteOne({ _id: DE }) : renomme le slug d\'un set existant ; refuse si « VERS » existe (refus l.53) ou si « DE » n\'existe pas (refus l.52) — le document recopié porte déjà son nomAffichage tel qu\'il était',
    'reparer-identite-nulle.js': 'insertOne({ ...set, _id: code }) puis deleteOne({ _id: null }) : déplace un set collecté sous _id null vers son code ; refuse si « code » existe déjà (l.37) ; one-shot du 2026-09-20 (Aquapolis)'
};
/** Les bancs : leurs fixtures s'écrivent dans la base EN MÉMOIRE (base-banc.js), jamais dans une grappe. */
const BANCS = {
    'test-lot-garde-scratch.js': 'banc de la garde de lot : insertMany de fixtures dans la base du banc',
    'test-regle-r-fiches.js': 'banc de la règle R : insertMany de fixtures dans la base du banc',
    'test-publication-sans-trou.js': 'ce banc : fixtures de sets dans la base du banc',
    // test-historique-valeur.js (arrivé par a-histo-valeur) : ouvre la base EN MÉMOIRE `const banc = await ouvrirBanc()` (l.22) ; ses deux connexions
    // (`createConnection(banc.uri, …)`, l.24-25) visent banc.uri et rien d'autre ; ses `insertMany` sur `sets` (l.31) sont des sets FICTIFS dans la base du banc.
    'test-historique-valeur.js': 'banc de historique-valeur.js : sets fictifs dans la base en mémoire (ouvrirBanc, createConnection(banc.uri))'
};

/**
 * LA PREUVE QU'UN BANC LISTÉ NE SORT PAS DE SA BASE EN MÉMOIRE (écrite par ce qu'elle autorise) : il appelle `ouvrirBanc(` (collecte-cartes/base-banc.js) ET
 * chacune de ses `createConnection(` vise `banc.uri` — ou `process.env.MONGODB_URI` seulement si le fichier appelle `.appliquer()`, qui REMPLACE cette
 * variable par l'URI du banc (base-banc.js). Toute autre cible, ou un banc sans harnais, est un problème. Rend la liste des problèmes (vide = prouvé).
 * ⚠️ Lecture de texte : elle ne suit pas une URI passée par une variable intermédiaire (elle la refuse, faute de pouvoir la lire).
 */
function preuveDeBanc(t) {
    const pb = [];
    if (!/require\(\s*['"]\.\/collecte-cartes\/base-banc['"]\s*\)/.test(t) || !/\bouvrirBanc\s*\(/.test(t)) pb.push('n\'ouvre pas la base du banc (ouvrirBanc de collecte-cartes/base-banc.js)');
    const appliquer = /\.appliquer\s*\(\s*\)/.test(t);
    for (const m of t.matchAll(/createConnection\(\s*([^,)]*)/g)) {
        const cible = m[1].trim();
        if (cible !== 'banc.uri' && !(appliquer && /^process\.env\.MONGODB_(CARTES_)?URI$/.test(cible))) pb.push(`createConnection(${cible}) : ni banc.uri, ni une variable remplacée par appliquer()`);
    }
    if (/\bMongoClient\b|\bmongoose\.connect\(/.test(t)) pb.push('ouvre une connexion par MongoClient ou mongoose.connect : non prouvée');
    return pb;
}

const METHODES_QUI_INSERENT = new Set(['insertOne', 'insertMany', 'bulkWrite', 'create']);
const METHODES_A_UPSERT = new Set(['updateOne', 'updateMany', 'replaceOne', 'findOneAndUpdate', 'findOneAndReplace', 'findByIdAndUpdate']);

/** Position de la parenthèse fermante qui répond à celle de `ouvrante` ; -1 si illisible (guillemets/gabarits compris). */
function fermante(t, ouvrante) {
    let prof = 0;
    for (let i = ouvrante; i < t.length; i++) {
        const c = t[i];
        if (c === '(') prof++;
        else if (c === ')') { prof--; if (!prof) return i; }
        else if (c === '\'' || c === '"' || c === '`') {
            for (i++; i < t.length && t[i] !== c; i++) if (t[i] === '\\') i++;
        }
    }
    return -1;
}

/** Les écritures de `sets` capables d'insérer dans ce texte : [{ methode, ligne }]. */
function ecrituresDInsertion(t) {
    const cibles = ['collection\\(\\s*[\'"]sets[\'"]\\s*\\)', '\\bM\\.Set'];
    for (const m of t.matchAll(/\b([A-Za-z_$][\w$]*)\s*=\s*[\w.$]*collection\(\s*['"]sets['"]\s*\)/g)) cibles.push(`\\b${m[1].replace(/\$/g, '\\$')}`);
    const re = new RegExp(`(?:${cibles.join('|')})\\s*\\.\\s*(\\w+)\\s*\\(`, 'g');
    const trouvees = [];
    for (const m of t.matchAll(re)) {
        const methode = m[1], ouvrante = m.index + m[0].length - 1;
        let insere = METHODES_QUI_INSERENT.has(methode);
        if (!insere && METHODES_A_UPSERT.has(methode)) {
            const f = fermante(t, ouvrante);
            const appel = t.slice(ouvrante, f === -1 ? ouvrante + 3000 : f + 1);   // illisible : fenêtre large, donc plus de chances d'être signalé
            insere = /upsert|\$setOnInsert/.test(appel);
        }
        if (insere) trouvees.push({ methode, ligne: t.slice(0, m.index).split('\n').length });
    }
    return trouvees;
}

/** Les fichiers à balayer : tous les .js/.mjs de ces deux dossiers. */
function fichiersABalayer(racine) {
    const out = [];
    for (const d of [racine, path.join(racine, 'collecte-cartes')]) for (const f of fs.readdirSync(d)) if (/\.(js|mjs)$/.test(f)) out.push(path.join(d, f));
    return out;
}

/**
 * @returns {{ fautifs, listeObsolete, balayes, ecrivent, parPointDEntree, copieurs, bancs }}
 *   fautifs : écrivent un set sans appeler le point d'entrée et sans figurer dans une liste fermée
 *   listeObsolete : fichiers d'une liste fermée qui n'existent plus OU qui n'écrivent plus de set (la liste n'est plus vraie)
 */
function balayer(racine, { copieurs = COPIEURS_PROUVES, bancs = BANCS, lire = f => fs.readFileSync(f, 'utf8') } = {}) {
    const fautifs = [], parPointDEntree = [], ecrivent = [];
    const vus = new Map();
    for (const f of fichiersABalayer(racine)) {
        const nom = path.relative(racine, f).split(path.sep).join('/');
        const t = lire(f);
        vus.set(nom, t);
        const e = ecrituresDInsertion(t);
        if (!e.length) continue;
        ecrivent.push(nom);
        if (POINTS_D_ENTREE.test(t)) parPointDEntree.push(nom);
        else if (!(nom in copieurs) && !(nom in bancs)) fautifs.push(`${nom} (${e.map(x => `${x.methode}@${x.ligne}`).join(', ')})`);
    }
    const listeObsolete = [];
    for (const [nom] of [...Object.entries(copieurs), ...Object.entries(bancs)]) {
        if (!vus.has(nom)) listeObsolete.push(`${nom} : le fichier n'existe plus`);
        else if (!ecrivent.includes(nom)) listeObsolete.push(`${nom} : il n'écrit plus de set capable d'insérer (la preuve de la liste est périmée)`);
    }
    for (const nom of Object.keys(bancs)) if (vus.has(nom)) for (const p of preuveDeBanc(vus.get(nom))) listeObsolete.push(`${nom} : banc sans preuve d'isolation — ${p}`);
    return { fautifs, listeObsolete, balayes: vus.size, ecrivent, parPointDEntree, copieurs: Object.keys(copieurs), bancs: Object.keys(bancs) };
}

module.exports = { COPIEURS_PROUVES, BANCS, POINTS_D_ENTREE, preuveDeBanc, ecrituresDInsertion, balayer, fermante };
