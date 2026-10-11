'use strict';
// Ma collection — le stockage. Un document par (compte, set) dans `collection_fiches` : { compteId, set, cles: [idInterne|numero…], majLe }. Ni adresse, ni nom, ni IP.
// BORNES (cfg.collection), écrites par ce qu'elles protègent — la taille de la grappe de production (457 Mo pour un arrêt dur à 480 Mo) :
//   · clés par SET : ATOMIQUE dans l'écriture (un filtre `cles.<max-1>` inexistant sur la mise à jour : la taille du tableau est jugée par la base, pas lue puis écrite) ;
//   · clés par COMPTE et sets par COMPTE : jugés AVANT l'écriture (un agrégat, un comptage). Deux écritures simultanées peuvent donc passer ensemble le contrôle : le dépassement est
//     BORNÉ par le nombre d'écritures en vol d'un même compte (au plus le limiteur d'écriture, 1 000 par heure, chacune ajoute une seule clé) ; l'écriture suivante voit le vrai total et est refusée ;
//   · PLACES de TOUS les comptes (plafond du SERVICE) : un compteur UNIQUE. Une clé coûte 1 place ; la création d'un DOCUMENT (un set neuf pour un compte) coûte en plus un FORFAIT
//     (cfg.collection.forfaitDocument : en-tête du document + entrée d'index, divisés par le coût d'une clé, mesurés en BSON — voir le contrat), car un plafond de clés seul laisse 100 000 documents
//     d'une clé peser plus que la marge. La réservation est faite AVANT l'écriture, au PIRE cas, d'un seul `$inc` CONDITIONNEL (`n + coût ≤ plafond`) : atomique, aucune écriture simultanée
//     ne dépasse jamais le plafond. Le surplus est rendu quand l'écriture n'a rien ajouté (la clé était déjà là) ou quand le document existait déjà (le forfait) ; décrémenté quand une clé
//     est réellement retirée, quand un document vidé est supprimé (son forfait) et à la suppression d'un compte (ses clés et les forfaits de tous ses documents). Toute dérive possible
//     (arrêt entre `$inc` et l'écriture) va vers le HAUT, donc vers la fermeture ; le compteur est RECOMPTÉ depuis les données réelles (clés + documents × forfait) au montage du lot.
//     Plusieurs instances : un recompte lancé pendant que l'autre écrit peut sous-compter quelques écritures en vol ; le prochain recompte le corrige.
// Le serveur ne peut pas savoir si une clé désigne une fiche réelle (l'API ne lit jamais la base `cartes`) : la forme est jugée à la porte (forme.js), jamais ici.
const { col } = require('../db');
const NOM = 'collection_fiches', COMPTEURS = 'compteurs', CLE_TOTAL = 'collection-cles';
const SOUS_LA_BORNE = cfg => ({ [`cles.${cfg.collection.clesParSet - 1}`]: { $exists: false } });

async function totalDuCompte(compteId) {
    const r = await col(NOM).aggregate([{ $match: { compteId } }, { $group: { _id: null, n: { $sum: { $size: '$cles' } } } }]).toArray();
    return r.length ? r[0].n : 0;
}

// ── le compteur global (en PLACES)
async function reserver(cfg, cout) {
    const filtre = { cle: CLE_TOTAL, n: { $lte: cfg.collection.clesService - cout } };
    if ((await col(COMPTEURS).findOneAndUpdate(filtre, { $inc: { n: cout } })) !== null) return true;           // JAMAIS d'upsert : seul le recompte crée le compteur
    if (!(await col(COMPTEURS).findOne({ cle: CLE_TOTAL }, { projection: { _id: 1 } }))) throw new Error('compteur-absent');   // ABSENT : les écritures ferment (503) jusqu'au prochain recompte
    return false;                                                                                            // présent : le plafond est atteint
}
async function rendre(k) {
    if (k > 0) await col(COMPTEURS).updateOne({ cle: CLE_TOTAL }, [{ $set: { n: { $max: [0, { $subtract: ['$n', k] }] } } }]);
}
/** Recompte depuis les données réelles (une agrégation sur la collection) : clés + documents × forfait. Corrige un compteur faux, vers le haut comme vers le bas, ou absent. Rend le total. */
async function recompter(cfg) {
    const r = await col(NOM).aggregate([{ $group: { _id: null, n: { $sum: { $add: [{ $size: '$cles' }, cfg.collection.forfaitDocument] } } } }]).toArray();
    const n = r.length ? r[0].n : 0;
    await col(COMPTEURS).updateOne({ cle: CLE_TOTAL }, { $set: { n } }, { upsert: true });
    return n;
}
let initialisation = null;
/** Lancé au MONTAGE du lot. Un échec (base pas encore prête) n'est pas définitif : la première écriture le rejoue. */
function initialiser(cfg) {
    initialisation = recompter(cfg).catch(e => { initialisation = null; throw e; });
    return initialisation;
}
const assurer = cfg => initialisation || initialiser(cfg);

async function mettreAJour(c, doc, { cle, cfg, maintenant }) {
    const r = await c.findOneAndUpdate({ _id: doc._id, ...SOUS_LA_BORNE(cfg), cles: { $ne: cle } }, { $addToSet: { cles: cle }, $set: { majLe: maintenant } }, { returnDocument: 'after', projection: { cles: 1 } });
    if (r) return { ajoute: true, resultat: { possedees: r.cles.length } };
    const now = await c.findOne({ _id: doc._id }, { projection: { cles: 1 } });                          // le filtre a refusé : la clé est arrivée entre-temps, ou le set est plein, ou le document a disparu
    if (!now) return { ajoute: false, recreer: true };
    return { ajoute: false, resultat: now.cles.includes(cle) ? { possedees: now.cles.length } : { refus: 'borne-set', borne: cfg.collection.clesParSet } };
}
// création (ou recréation) du document. Le filtre porte la borne du set : si un concurrent a créé le document entre-temps, l'upsert tente d'insérer, l'index unique le refuse (11000) et on rejoue ;
// s'il l'a créé et que le filtre passe, l'upsert met à jour SON document (`cree` faux) : le forfait réservé est alors rendu.
async function creer(c, { compteId, slug, cle, cfg, maintenant }) {
    const r = await c.findOneAndUpdate({ compteId, set: slug, ...SOUS_LA_BORNE(cfg), cles: { $ne: cle } }, { $addToSet: { cles: cle }, $set: { majLe: maintenant } },
        { upsert: true, returnDocument: 'after', projection: { cles: 1 }, includeResultMetadata: true });
    return { ajoute: true, cree: Boolean(r.lastErrorObject && r.lastErrorObject.upserted), resultat: { possedees: r.value.cles.length } };
}

async function ajouter(a, essai = 0) {
    const { compteId, slug, cle, cfg } = a, c = col(NOM);
    await assurer(cfg);
    const doc = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } });
    if (doc && doc.cles.includes(cle)) return { possedees: doc.cles.length };                                // idempotent : rien ne change, rien n'est consommé, même au plafond
    const total = await totalDuCompte(compteId);
    if (total >= cfg.collection.clesParCompte) return { refus: 'borne-compte', borne: cfg.collection.clesParCompte };
    if (!doc) {
        const nSets = await c.countDocuments({ compteId });
        if (nSets >= cfg.collection.setsParCompte) return { refus: 'borne-sets', borne: cfg.collection.setsParCompte };
    }
    const cout = 1 + (doc ? 0 : cfg.collection.forfaitDocument);                                             // le pire cas : une clé, plus un document neuf
    if (!(await reserver(cfg, cout))) {
        const now = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } });                   // la clé a pu arriver entre-temps (même clé simultanée) : idempotent, pas un refus
        return now && now.cles.includes(cle) ? { possedees: now.cles.length } : { refus: 'borne-service', borne: cfg.collection.clesService };
    }
    let r;
    try {
        r = doc ? await mettreAJour(c, doc, a) : await creer(c, a);
    } catch (e) {
        await rendre(cout);                                                                                 // rien n'a été ajouté : les places sont rendues
        if (e && e.code === 11000 && essai < 3) return ajouter(a, essai + 1);
        throw e;
    }
    if (r.recreer) {                                                                                        // le document a disparu entre la lecture et l'écriture : on repart de zéro (le forfait se paie alors)
        await rendre(cout);
        if (essai >= 3) throw new Error('collection-course');
        return ajouter(a, essai + 1);
    }
    if (!r.ajoute) await rendre(cout);
    else if (cout > 1 && !r.cree) await rendre(cout - 1);
    return r.resultat;
}

async function retirer({ compteId, slug, cle, cfg, maintenant }) {
    const c = col(NOM);
    const r = await c.findOneAndUpdate({ compteId, set: slug, cles: cle }, { $pull: { cles: cle }, $set: { majLe: maintenant } }, { returnDocument: 'after', projection: { cles: 1 } });
    if (!r) { const doc = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } }); return { possedees: doc ? doc.cles.length : 0 }; }   // rien à retirer : idempotent, majLe intact
    await rendre(1); // retrait
    if (r.cles.length === 0 && (await c.deleteOne({ _id: r._id, cles: { $size: 0 } })).deletedCount === 1) {   // plus aucune clé : le document disparaît (sauf si une clé vient d'y être remise)
        await rendre(cfg.collection.forfaitDocument); // forfait rendu
    }
    return { possedees: r.cles.length };
}

/** Coche (`possedee` true, `$addToSet`) ou décoche (false, `$pull`) ; les deux sont idempotents. Rend { possedees } ou { refus: 'borne-set'|'borne-compte'|'borne-sets'|'borne-service', borne }. */
function cocher({ compteId, slug, cle, possedee, cfg, maintenant = new Date() }) {
    return possedee ? ajouter({ compteId, slug, cle, cfg, maintenant }) : retirer({ compteId, slug, cle, cfg, maintenant });
}

async function lireSet(compteId, slug) {
    const doc = await col(NOM).findOne({ compteId, set: slug });
    return doc ? { cles: [...doc.cles].sort(), majLe: doc.majLe } : { cles: [], majLe: null };
}

/** Les sets où au moins une fiche est cochée : [{ slug, possedees, majLe }], triés par slug. */
async function lireSets(compteId) {
    return col(NOM).aggregate([{ $match: { compteId, 'cles.0': { $exists: true } } }, { $project: { _id: 0, slug: '$set', possedees: { $size: '$cles' }, majLe: 1 } }, { $sort: { slug: 1 } }]).toArray();
}

/** La collection d'un compte part avec lui (comptes/service.js supprimerCompte). Document par document (au plus `setsParCompte`) : chaque suppression rend ce qu'elle a RÉELLEMENT retiré — la longueur de `cles`
 *  au moment de la suppression, plus le forfait —, jamais une lecture d'avant : un retrait en vol a déjà rendu sa clé, la compter une seconde fois ferait passer le compteur SOUS le réel. */
async function supprimerDuCompte(compteId, cfg) {
    let n = 0, rendu = 0;
    for (;;) {
        const d = await col(NOM).findOneAndDelete({ compteId }, { projection: { cles: 1 } });
        if (!d) break;
        n++; rendu += d.cles.length + cfg.collection.forfaitDocument;
    }
    await rendre(rendu);
    return n;
}
module.exports = { NOM, cocher, lireSet, lireSets, totalDuCompte, supprimerDuCompte, recompter, initialiser };
// Limite connue (M-C, relecture finale) : le recompte est ABSOLU ; avec plusieurs instances, un recompte lancé pendant que l'autre écrit peut écraser des incréments en vol (dérive basse d'au plus le nombre d'écritures en vol). Une seule instance aujourd'hui.
