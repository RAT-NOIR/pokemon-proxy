'use strict';
// Ma collection — le stockage. Un document par (compte, set) dans `collection_fiches` : { compteId, set, cles: [idInterne|numero…], majLe }. Ni adresse, ni nom, ni IP.
// BORNES (cfg.collection), écrites par ce qu'elles protègent — la taille de la grappe de production (457 Mo pour un arrêt dur à 480 Mo) :
//   · clés par SET : ATOMIQUE dans l'écriture (un filtre `cles.<max-1>` inexistant sur la mise à jour : la taille du tableau est jugée par la base, pas lue puis écrite) ;
//   · clés par COMPTE et sets par COMPTE : jugés AVANT l'écriture (un agrégat, un comptage). Deux écritures simultanées peuvent donc passer ensemble le contrôle : le dépassement est
//     BORNÉ par le nombre d'écritures en vol d'un même compte (au plus le limiteur d'écriture, 1 000 par heure, chacune ajoute une seule clé) ; l'écriture suivante voit le vrai total et est refusée.
// Le serveur ne peut pas savoir si une clé désigne une fiche réelle (l'API ne lit jamais la base `cartes`) : la forme est jugée à la porte (forme.js), jamais ici.
const { col } = require('../db');
const NOM = 'collection_fiches';
const SOUS_LA_BORNE = cfg => ({ [`cles.${cfg.collection.clesParSet - 1}`]: { $exists: false } });

async function totalDuCompte(compteId) {
    const r = await col(NOM).aggregate([{ $match: { compteId } }, { $group: { _id: null, n: { $sum: { $size: '$cles' } } } }]).toArray();
    return r.length ? r[0].n : 0;
}

async function ajouter(a, essai = 0) {
    const { compteId, slug, cle, cfg, maintenant } = a, c = col(NOM);
    const doc = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } });
    if (doc && doc.cles.includes(cle)) return { possedees: doc.cles.length };                                // idempotent : rien ne change, même au plafond
    const total = await totalDuCompte(compteId);
    if (total >= cfg.collection.clesParCompte) return { refus: 'borne-compte', borne: cfg.collection.clesParCompte };
    if (doc) {
        const r = await c.findOneAndUpdate({ _id: doc._id, ...SOUS_LA_BORNE(cfg), cles: { $ne: cle } }, { $addToSet: { cles: cle }, $set: { majLe: maintenant } }, { returnDocument: 'after', projection: { cles: 1 } });
        if (r) return { possedees: r.cles.length };
        const now = await c.findOne({ _id: doc._id }, { projection: { cles: 1 } });                          // le filtre a refusé : la clé est arrivée entre-temps, ou le set est plein, ou le document a disparu
        if (now) return now.cles.includes(cle) ? { possedees: now.cles.length } : { refus: 'borne-set', borne: cfg.collection.clesParSet };
    } else {
        const nSets = await c.countDocuments({ compteId });
        if (nSets >= cfg.collection.setsParCompte) return { refus: 'borne-sets', borne: cfg.collection.setsParCompte };
    }
    // création (ou recréation) du document. Le filtre porte la borne du set : si un concurrent a créé le document entre-temps, l'upsert tente d'insérer, l'index unique le refuse (11000) et on rejoue.
    try {
        const r = await c.findOneAndUpdate({ compteId, set: slug, ...SOUS_LA_BORNE(cfg), cles: { $ne: cle } }, { $addToSet: { cles: cle }, $set: { majLe: maintenant } }, { upsert: true, returnDocument: 'after', projection: { cles: 1 } });
        return { possedees: r.cles.length };
    } catch (e) {
        if (e && e.code === 11000 && essai < 3) return ajouter(a, essai + 1);
        throw e;
    }
}

async function retirer({ compteId, slug, cle, maintenant }) {
    const c = col(NOM);
    const r = await c.findOneAndUpdate({ compteId, set: slug, cles: cle }, { $pull: { cles: cle }, $set: { majLe: maintenant } }, { returnDocument: 'after', projection: { cles: 1 } });
    if (!r) { const doc = await c.findOne({ compteId, set: slug }, { projection: { cles: 1 } }); return { possedees: doc ? doc.cles.length : 0 }; }   // rien à retirer : idempotent, majLe intact
    if (r.cles.length === 0) await c.deleteOne({ _id: r._id, cles: { $size: 0 } });                          // plus aucune clé : le document disparaît (sauf si une clé vient d'y être remise)
    return { possedees: r.cles.length };
}

/** Coche (`possedee` true, `$addToSet`) ou décoche (false, `$pull`) ; les deux sont idempotents. Rend { possedees } ou { refus: 'borne-set'|'borne-compte'|'borne-sets', borne }. */
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

/** La collection d'un compte part avec lui (comptes/service.js supprimerCompte). */
async function supprimerDuCompte(compteId) {
    return (await col(NOM).deleteMany({ compteId })).deletedCount;
}
module.exports = { NOM, cocher, lireSet, lireSets, totalDuCompte, supprimerDuCompte };
