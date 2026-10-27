'use strict';
// PERF-SCAN P1 — la recherche du catalogue PAR LES CLÉS DE NOM (cle-nom.js), à la place du balayage complet, quand — et seulement quand — le champ et son index existent PARTOUT.
// Écrit par ce qu'il AUTORISE : l'index n'est utilisé que si (1) l'index existe, (2) AUCUN document ne manque du champ (un import quotidien ajoute des produits sans clé : un seul suffit à refuser),
// (3) l'interrupteur V2_INDEX_NOM n'est pas à 0. Dans tous les autres cas — et sur toute panne — les fonctions rendent `null` et l'appelant exécute la requête d'AVANT, inchangée. Jamais `[]` : un vide
// ne dit pas « pas de candidat », il dirait « pas d'index ».
// Chaque fonction rend le SUR-ENSEMBLE trouvé par l'index, filtré par la regex d'avant (passée par l'appelant, jamais reconstruite ici : une seule définition), dans l'ordre de _id (l'ordre naturel d'une
// collection copiée par _id). Le filtre propre à l'appelant (les cibles normalisées) s'applique ensuite, comme avant.
const CN = require('./cle-nom');

const DUREE_PAR_DEFAUT_MS = 60 * 1000;               // la fenêtre pendant laquelle un produit ajouté sans clé peut ne pas être vu : une minute, puis le contrôle est refait
const FRAICHEUR = new Map();                           // collection|champ|témoin -> { le, p } : la dernière lecture de fraîcheur (partagée, vidée par oublier())
const interrupteurOuvert = () => process.env.V2_INDEX_NOM !== '0';
const S = require('../../sources');
const HORS_CLES = { [CN.CHAMP_CATALOGUE]: 0, [CN.CHAMP_NOM_MIN]: 0, [CN.CHAMP_SOURCE_CATALOGUE]: 0 };       // les champs internes ne sortent jamais dans les produits rendus (le repli d'avant les écarte de même)

/** L'indicateur du scan en cours : true si toutes ses recherches par nom ont été servies par l'index, false si UNE est retombée sur le balayage d'avant, null si aucune n'a été tentée (ou hors scan). */
const indexDuScan = () => S.lireDansLeScan('catalogueIndex');
const noterScan = servi => { if (servi === false || S.lireDansLeScan('catalogueIndex') !== false) S.noterDansLeScan('catalogueIndex', servi); };

/**
 * @param {{ col: object|function, champ: string, nomIndex: string, source?: { champ: string, temoin: string }, dureeMs?: number, maintenant?: () => number }} p  `col` : une collection native (pilote) ou celle d'un modèle mongoose.
 *        `source` : { champ: le champ dont les clés dérivent (« name »), temoin: le champ où l'outil de pose en a gardé la valeur } — la FRAÎCHEUR des clés (un produit renommé par l'import garde ses anciennes clés).
 * @returns {{ disponible(): Promise<boolean>, oublier(): void }}
 * Chaque TRANSITION de verdict (index → repli, repli → index) est écrite au journal avec sa cause, une fois : un essai qui tourne des heures en balayage complet ne passe pas inaperçu.
 */
function creerDisponibilite({ col, champ, nomIndex, source = null, dureeMs = DUREE_PAR_DEFAUT_MS, maintenant = Date.now }) {
    let verdict = null, le = 0, enCours = null, publie = null;
    const publier = (ok, cause) => {
        if (publie === ok) return;
        const avant = publie; publie = ok;
        try {
            if (ok) console.warn(`ℹ️ [index-nom] ${champ} : ${avant === false ? 'retour à l\'index' : 'index utilisé'} (couverture entière, clés fraîches)`);
            else console.warn(`⚠️ [index-nom] ${champ} : ${avant === true ? 'index → repli' : 'repli'} sur le balayage d'avant — ${cause}`);
        } catch { /* journal muet */ }
    };
    async function controler() {
        try {
            const c = typeof col === 'function' ? col() : col;                          // une fonction : la collection n'existe qu'une fois la connexion ouverte (pont-cartes.js)
            if (!c) return { ok: false, cause: 'collection injoignable' };
            const index = await c.indexes();
            if (!index.some(i => i.name === nomIndex && i.key && Object.keys(i.key).length === 1 && i.key[champ] === 1)) return { ok: false, cause: `index absent (${nomIndex})` };
            // aucun document sans le champ : par l'index lui-même (les documents sans champ y sont à la clé null), donc instantané quand la couverture est entière
            const sans = await c.findOne({ [champ]: { $exists: false } }, { projection: { _id: 1 } });
            if (sans !== null && sans !== undefined) return { ok: false, cause: 'documents sans clé (produit ajouté depuis la pose)' };
            if (source) {
                // la FRAÎCHEUR : un document dont la source ≠ son témoin a été modifié depuis la pose (renommé par un import) — ses clés sont périmées. Une requête bornée (limit 1) : balayage tant que tout est frais.
                // PARTAGÉ entre les index d'une même collection et d'un même témoin (nomCles et nomMin lisent le même « name ») : un balayage par fenêtre et par collection, pas un par index.
                const cle = `${c.collectionName}|${source.champ}|${source.temoin}`, gardee = FRAICHEUR.get(cle);
                let perime;
                if (gardee && maintenant() - gardee.le < dureeMs) perime = await gardee.p;
                else { const p = c.findOne({ $expr: { $ne: [{ $ifNull: ['$' + source.champ, ''] }, { $ifNull: ['$' + source.temoin, ''] }] } }, { projection: { _id: 1 } }); FRAICHEUR.set(cle, { le: maintenant(), p }); p.catch(() => FRAICHEUR.delete(cle)); perime = await p; }
                if (perime !== null && perime !== undefined) return { ok: false, cause: `clé périmée (« ${source.champ} » ≠ « ${source.temoin} » : un produit modifié depuis la pose)` };
            }
            return { ok: true, cause: null };
        } catch { return { ok: false, cause: 'lecture en panne' }; }                    // « je ne sais pas » n'est jamais « tout va bien »
    }
    return {
        async disponible() {
            if (!interrupteurOuvert()) { publier(false, 'interrupteur V2_INDEX_NOM=0'); return false; }
            if (verdict !== null && maintenant() - le < dureeMs) return verdict;
            if (!enCours) enCours = controler().then(r => { verdict = r.ok; le = maintenant(); publier(r.ok, r.cause); return r.ok; }).finally(() => { enCours = null; });
            return enCours;
        },
        oublier() { verdict = null; le = 0; if (source) for (const k of [...FRAICHEUR.keys()]) if (k.endsWith('|' + source.champ + '|' + source.temoin)) FRAICHEUR.delete(k); }
    };
}

async function sous(dispo, quoi, fn) {
    if (!(await dispo.disponible())) { noterScan(false); return null; }
    try { const r = await fn(); noterScan(true); return r; }
    catch (e) { dispo.oublier(); noterScan(false); console.warn(`⚠️ [index-nom] ${quoi} : l'index n'a pas répondu (${(e && (e.code || e.name)) || 'erreur'}) — repli sur la requête d'avant`); return null; }
}
/** La présélection par le premier mot (trouverProduitsLocaux, identification-locale) : les produits dont une CLÉ est l'une des cibles ET dont le nom contient le premier mot (regex d'avant). null = utiliser la requête d'avant. */
function preselection({ col, dispo, cles, regexPremierMot }) {
    return sous(dispo, 'présélection par le nom', async () => {
        const docs = await col.find({ [CN.CHAMP_CATALOGUE]: { $in: cles } }, { projection: HORS_CLES }).sort({ _id: 1 }).toArray();
        return docs.filter(d => typeof d.name === 'string' && regexPremierMot.test(d.name));
    });
}

/** Le nom court (< 3 lettres) : la regex ancrée « ^variante(\s*\[|$) » en i. Une variante qui contient « [ » n'est pas dans le domaine de la clé (le nom avant « [ » ne la contient pas) : null, la requête d'avant. */
function parNomCourt({ col, dispo, variante, regex }) {
    if (typeof variante !== 'string' || variante.includes('[')) { noterScan(false); return Promise.resolve(null); }
    return sous(dispo, 'nom court', async () => {
        const docs = await col.find({ [CN.CHAMP_CATALOGUE]: CN.normaliserNom(variante) }, { projection: HORS_CLES }).sort({ _id: 1 }).toArray();
        return docs.filter(d => typeof d.name === 'string' && regex.test(d.name));
    });
}

/** Le nom français appris (numeros_cartes.nomFr) : la regex ancrée « ^nom$ » en i. Rend { _id, idProduct } comme la requête d'avant (projection idProduct). */
function parNomFrancais({ col, dispo, nomLu, regex }) {
    const cle = CN.cleNomFr(nomLu);
    if (!cle) { noterScan(false); return Promise.resolve(null); }
    return sous(dispo, 'nom français', async () => {
        const docs = await col.find({ [CN.CHAMP_FR]: cle }, { projection: { idProduct: 1, nomFr: 1 } }).sort({ _id: 1 }).toArray();
        return docs.filter(d => typeof d.nomFr === 'string' && regex.test(d.nomFr)).map(d => { const o = { _id: d._id }; if (d.idProduct !== undefined) o.idProduct = d.idProduct; return o; });
    });
}

/**
 * Les produits dont le nom COMMENCE par `nom` (insensible à la casse), suivi d'un blanc, d'un « [ » ou de la fin — la regex ancrée « ^nom(\s|\[|$) » de pont-cartes.js (homonymes hors couverture), `regex` étant celle d'avant.
 * L'index porte le nom en minuscules : l'intervalle [préfixe, préfixe + U+FFFF[ contient tout nom qui commence ainsi (le caractère qui suit le préfixe est un blanc ou « [ », bien en dessous de U+FFFF), puis la regex d'avant
 * est réappliquée. Rend { _id, idProduct, idExpansion } comme la requête d'avant (même projection) ; null = utiliser la requête d'avant.
 */
function debutDeNom({ col, dispo, nom, regex }) {
    const prefixe = CN.cleNomMin(nom);
    if (!prefixe) { noterScan(false); return Promise.resolve(null); }
    return sous(dispo, 'nom qui commence par', async () => {
        const docs = await col.find({ [CN.CHAMP_NOM_MIN]: { $gte: prefixe, $lt: prefixe + '￿' } }, { projection: { idProduct: 1, idExpansion: 1, name: 1 } }).sort({ _id: 1 }).toArray();
        return docs.filter(d => typeof d.name === 'string' && regex.test(d.name)).map(d => { const o = { _id: d._id }; if (d.idProduct !== undefined) o.idProduct = d.idProduct; if (d.idExpansion !== undefined) o.idExpansion = d.idExpansion; return o; });
    });
}

module.exports = { indexDuScan, creerDisponibilite, preselection, parNomCourt, parNomFrancais, debutDeNom, DUREE_PAR_DEFAUT_MS };
