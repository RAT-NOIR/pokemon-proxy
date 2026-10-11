'use strict';
// Ma collection — le stockage. Un document par (compte, set) dans `collection_fiches` : { compteId, set, cles: [idInterne|numero…], majLe }. Ni adresse, ni nom, ni IP.
// BORNES (cfg.collection), écrites par ce qu'elles protègent — la taille de la grappe de production (457 Mo pour un arrêt dur à 480 Mo) :
//   · clés par SET : ATOMIQUE dans l'écriture (un filtre `cles.<max-1>` inexistant sur la mise à jour : la taille du tableau est jugée par la base, pas lue puis écrite) ;
//   · clés par COMPTE et sets par COMPTE : jugés AVANT l'écriture (un agrégat, un comptage). Deux écritures simultanées peuvent donc passer ensemble le contrôle : le dépassement est
//     BORNÉ par le nombre d'écritures en vol d'un même compte (au plus le limiteur d'écriture, 1 000 par heure, chacune ajoute une seule clé) ; l'écriture suivante voit le vrai total et est refusée ;
//   · clés de TOUS les comptes (plafond du SERVICE) : un compteur UNIQUE, `$inc` CONDITIONNEL (`n < plafond`) AVANT l'écriture — atomique, aucune écriture simultanée ne le dépasse jamais.
//     Rendu si l'écriture n'a rien ajouté, décrémenté quand une clé est réellement retirée et du nombre de clés d'un compte supprimé. Toute dérive possible (arrêt entre `$inc` et l'écriture)
//     va vers le HAUT, donc vers la fermeture ; le compteur est RECOMPTÉ depuis les données réelles au montage du lot (et à la première écriture si ce recompte a échoué).
//     Plusieurs instances : un recompte lancé pendant que l'autre écrit peut sous-compter de quelques écritures en vol ; le prochain recompte le corrige.
// Le serveur ne peut pas savoir si une clé désigne une fiche réelle (l'API ne lit jamais la base `cartes`) : la forme est jugée à la porte (forme.js), jamais ici.
const { col } = require('../db');
const NOM = 'collection_fiches', COMPTEURS = 'compteurs', CLE_TOTAL = 'collection-cles';
const SOUS_LA_BORNE = cfg => ({ [`cles.${cfg.collection.clesParSet - 1}`]: { $exists: false } });

async function totalDuCompte(compteId) {
    const r = await col(NOM).aggregate([{ $match: { compteId } }, { $group: { _id: null, n: { $sum: { $size: '$cles' } } } }]).toArray();
    return r.length ? r[0].n : 0;
}

// ── le compteur global
async function reserver(cfg) {
    const filtre = { cle: CLE_TOTAL, n: { $lt: cfg.collection.clesService } };
    try { await col(COMPTEURS).findOneAndUpdate(filtre, { $inc: { n: 1 } }, { upsert: true }); return true; }     // sans document : il naît à 1 ; au plafond : l'insertion échoue (11000) = refus
    catch (e) {
        if (!(e && e.code === 11000)) throw e;
        return (await col(COMPTEURS).findOneAndUpdate(filtre, { $inc: { n: 1 } })) !== null;                      // deux créations simultanées du compteur : la perdante réessaie sans upsert
    }
}
async function rendre(k) {
    await col(COMPTEURS).updateOne({ cle: CLE_TOTAL }, [{ $set: { n: { $max: [0, { $subtract: ['$n', k] }] } } }]);
}
/** Recompte depuis les données réelles (une agrégation sur la collection) : corrige un compteur faux, vers le haut comme vers le bas, ou absent. Rend le total. */
async function recompter() {
    const r = await col(NOM).aggregate([{ $group: { _id: null, n: { $sum: { $size: '$cles' } } } }]).toArray();
    const n = r.length ? r[0].n : 0;
    await col(COMPTEURS).updateOne({ cle: CLE_TOTAL }, { $set: { n } }, { upsert: true });
    return n;
}
let initialisation = null;
/** Lancé au MONTAGE du lot. Un échec (base pas encore prête) n'est pas définitif : la première écriture le rejoue. */
function initialiser() {
    initialisation = recompter().catch(e => { initialisation = null; throw e; });
    return initialisation;
}
const assurer = () => initialisation || initialiser();

async function mettreAJour(c, doc, { cle, cfg, maintenant }) {
    const r = await c.findOneAndUpdate({ _id: doc._id, ...SOUS_LA_BORNE(cfg), cles: { $ne: cle } }, { $addToSet: { cles: cle }, $set: { majLe: maintenant } }, { returnDocument: 'after', projection: { cles: 1 } });
    if (r) return { ajoute: true, resultat: { possedees: r.cles.length } };
    const now = await c.findOne({ _id: doc._id }, { projection: { cles: 1 } });                          // le filtre a refusé : la clé est arrivée entre-temps, ou le set est plein, ou le document a disparu
    if (!now) return { ajoute: false, recreer: true };
    return { ajoute: false, resultat: now.cles.includes(cle) ? { possedees: now.cles.length } : { refus: 'borne-set', borne: cfg.collection.clesParSet } };
}
// création (ou recréation) du document. Le filtre porte la borne du set : si un concurrent a créé le document entre-temps, l'upsert tente d'insérer, l'index unique le refuse (11000) et on rejoue.
async function creer(c, { compteId, slug, cle, cfg, maintenant }) {
    const r = await c.findOneAndUpdate({ compteId, set: slug, ...SOUS_LA_BORNE(cfg), cles: { $ne: cle } }, { $addToSet: { cles: cle }, $set: { majLe: maintenant } }, { upsert: true, returnDocument: 'after', projection: { cles: 1 } });
    return { ajoute: true, resultat: { possedees: r.cles.length } };
}

async function ajouter(a, essai = 0) {
    const { compteId, slug, cle, cfg } = a, c = col(NOM);
    await assurer();
    const doc = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } });
    if (doc && doc.cles.includes(cle)) return { possedees: doc.cles.length };                                // idempotent : rien ne change, rien n'est consommé, même au plafond
    const total = await totalDuCompte(compteId);
    if (total >= cfg.collection.clesParCompte) return { refus: 'borne-compte', borne: cfg.collection.clesParCompte };
    if (!doc) {
        const nSets = await c.countDocuments({ compteId });
        if (nSets >= cfg.collection.setsParCompte) return { refus: 'borne-sets', borne: cfg.collection.setsParCompte };
    }
    if (!(await reserver(cfg))) {
        const now = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } });                   // la clé a pu arriver entre-temps (même clé simultanée) : idempotent, pas un refus
        return now && now.cles.includes(cle) ? { possedees: now.cles.length } : { refus: 'borne-service', borne: cfg.collection.clesService };
    }
    let r;
    try {
        r = doc ? await mettreAJour(c, doc, a) : await creer(c, a);
        if (r.recreer) r = await creer(c, a);
    } catch (e) {
        await rendre(1);                                                                                    // rien n'a été ajouté : la place est rendue
        if (e && e.code === 11000 && essai < 3) return ajouter(a, essai + 1);
        throw e;
    }
    if (!r.ajoute) await rendre(1);
    return r.resultat;
}

async function retirer({ compteId, slug, cle, maintenant }) {
    const c = col(NOM);
    const r = await c.findOneAndUpdate({ compteId, set: slug, cles: cle }, { $pull: { cles: cle }, $set: { majLe: maintenant } }, { returnDocument: 'after', projection: { cles: 1 } });
    if (!r) { const doc = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } }); return { possedees: doc ? doc.cles.length : 0 }; }   // rien à retirer : idempotent, majLe intact
    await rendre(1); // retrait
    if (r.cles.length === 0) await c.deleteOne({ _id: r._id, cles: { $size: 0 } });                          // plus aucune clé : le document disparaît (sauf si une clé vient d'y être remise)
    return { possedees: r.cles.length };
}

/** Coche (`possedee` true, `$addToSet`) ou décoche (false, `$pull`) ; les deux sont idempotents. Rend { possedees } ou { refus: 'borne-set'|'borne-compte'|'borne-sets'|'borne-service', borne }. */
function cocher({ compteId, slug, cle, possedee, cfg, maintenant = new Date() }) {
    return possedee ? ajouter({ compteId, slug, cle, cfg, maintenant }) : retirer({ compteId, slug, cle, maintenant });
}

async function lireSet(compteId, slug) {
    const doc = await col(NOM).findOne({ compteId, set: slug });
    return doc ? { cles: [...doc.cles].sort(), majLe: doc.majLe } : { cles: [], majLe: null };
}

/** Les sets où au moins une fiche est cochée : [{ slug, possedees, majLe }], triés par slug. */
async function lireSets(compteId) {
    return col(NOM).aggregate([{ $match: { compteId, 'cles.0': { $exists: true } } }, { $project: { _id: 0, slug: '$set', possedees: { $size: '$cles' }, majLe: 1 } }, { $sort: { slug: 1 } }]).toArray();
}

/** La collection d'un compte part avec lui (comptes/service.js supprimerCompte) ; ses clés sont rendues au compteur global. */
async function supprimerDuCompte(compteId) {
    const k = await totalDuCompte(compteId);
    const n = (await col(NOM).deleteMany({ compteId })).deletedCount;
    if (k > 0) await rendre(k);
    return n;
}
module.exports = { NOM, cocher, lireSet, lireSets, totalDuCompte, supprimerDuCompte, recompter, initialiser };
