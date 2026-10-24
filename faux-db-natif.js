// Une FAUSSE base native EN MÉMOIRE (collection().find/findOne/updateOne/countDocuments) pour les bancs du retrait : seulement les formes de requête que `retirer-visuels-recolte.js` écrit —
// égalité (chemins pointés compris), `$exists`, `images: { $not: { $elemMatch } }` ; `$set`, `$unset`, `$pull` et `$push` sur `images`. Aucune connexion.
'use strict';
const clone = o => (o == null ? o : structuredClone(o));
const lire = (o, chemin) => chemin.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);
const egal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function correspond(doc, filtre) {
    return Object.entries(filtre).every(([k, v]) => {
        if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
            if ('$exists' in v) return (lire(doc, k) !== undefined) === v.$exists;
            if (v.$not?.$elemMatch) return !(lire(doc, k) || []).some(e => correspond(e, v.$not.$elemMatch));
            if ('$in' in v) return v.$in.some(x => egal(lire(doc, k), x));
        }
        // `images.source` : un tableau d'entrées — une entrée suffit
        const parties = k.split('.');
        if (parties.length === 2 && Array.isArray(doc[parties[0]])) return doc[parties[0]].some(e => egal(e?.[parties[1]], v));
        return egal(lire(doc, k), v);
    });
}
function fauxDbNatif({ cartes = [], images = [], sets = [] } = {}) {
    const col = { cartes: cartes.map(clone), images: images.map(clone), sets: sets.map(clone) };
    const C = nom => ({
        find: (f = {}) => ({ toArray: async () => col[nom].filter(d => correspond(d, f)).map(clone), project() { return this; } }),
        findOne: async (f = {}) => clone(col[nom].find(d => correspond(d, f)) ?? null),
        countDocuments: async (f = {}) => col[nom].filter(d => correspond(d, f)).length,
        updateOne: async (f, u) => {
            const d = col[nom].find(x => correspond(x, f));
            if (!d) return { matchedCount: 0, modifiedCount: 0 };
            const avant = JSON.stringify(d);
            if (u.$pull?.images) d.images = (d.images || []).filter(e => !Object.entries(u.$pull.images).every(([k, v]) => egal(e?.[k], v)));
            if (u.$push?.images) { d.images = d.images || []; d.images.push(clone(u.$push.images)); }
            for (const [k, v] of Object.entries(u.$set || {})) d[k] = clone(v);
            for (const k of Object.keys(u.$unset || {})) delete d[k];
            return { matchedCount: 1, modifiedCount: JSON.stringify(d) !== avant ? 1 : 0 };
        }
    });
    return { db: { collection: C }, etat: { cartes: () => col.cartes.map(clone), images: () => col.images.map(clone), sets: () => col.sets.map(clone) } };
}
module.exports = { fauxDbNatif };
