// Faux modèles Mongo EN MÉMOIRE pour les bancs de `ecrire` / `decider` (aucune connexion, aucune base réelle). Ils ne reproduisent QUE les appels que le collecteur et la règle commune font :
//   Carte.findById / find({_id:{$in}}) / updateOne($pull|$push sur images) · Image.findById / find / updateOne($set, upsert) · Set.findById / updateOne · EtatImages.updateOne · Carte.db.db (collection().find().toArray(), command()).
// `echecs` : { carte: (filtre, miseAJour) => erreur|undefined, image: idem } pour fabriquer une panne Mongo à un geste précis.
'use strict';
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o), (k, v) => v));
const requete = v => ({ select() { return this; }, lean: async () => v });

function fauxModeles({ cartes = [], images = [], sets = [{ _id: 'S', tirage: 'intl' }], echecs = {} } = {}) {
    const C = new Map(cartes.map(c => [c._id, clone(c)]));
    const I = new Map(images.map(d => [d._id, clone(d)]));
    const S = new Map(sets.map(s => [s._id, clone(s)]));
    const journal = [];
    const motif = (e, m) => Object.entries(m).every(([k, v]) => (e[k] ?? null) === (v ?? null));
    const nativeDb = {
        collection: nom => ({ find: (q) => ({ toArray: async () => (nom === 'cartes' ? [...C.values()].filter(c => q._id.$in.includes(c._id)).map(clone) : []) }) }),
        command: async () => ({ dataSize: 1000, indexSize: 1000 }),
    };
    const Carte = {
        db: { db: nativeDb },
        findById: id => requete(clone(C.get(id)) ?? null),
        find: q => requete([...C.values()].filter(c => q._id.$in.includes(c._id)).map(clone)),
        updateOne: async (f, u) => {
            const e = echecs.carte?.(f, u); if (e) throw new Error(e);
            journal.push(['carte', clone(f), clone(u)]);
            const c = C.get(f._id); if (!c) return { modifiedCount: 0 };
            c.images = c.images || [];
            if (u.$pull?.images) c.images = c.images.filter(x => !motif(x, u.$pull.images));
            if (u.$push?.images) c.images.push(clone(u.$push.images));
            return { modifiedCount: 1 };
        },
    };
    const trouverImages = q => [...I.values()].filter(d => (q._id !== undefined ? d._id === q._id : true)
        && (q.carteId?.$in ? q.carteId.$in.includes(d.carteId) : true) && ['source', 'set', 'cleR2', 'etat'].every(k => q[k] === undefined || d[k] === q[k]));
    const Image = {
        findById: id => requete(clone(I.get(id)) ?? null),
        find: q => requete(trouverImages(q).map(clone)),
        updateOne: async (f, u, o = {}) => {
            const e = echecs.image?.(f, u); if (e) throw new Error(e);
            journal.push(['image', clone(f), clone(u)]);
            let d = trouverImages(f)[0];
            if (!d && o.upsert) { d = { _id: f._id }; I.set(f._id, d); }
            if (!d) return { modifiedCount: 0 };
            Object.assign(d, clone(u.$set || {}));
            return { modifiedCount: 1 };
        },
    };
    const Set_ = {
        findById: id => requete(clone(S.get(id)) ?? null),
        updateOne: async (f, u) => { journal.push(['set', clone(f), clone(u)]); const s = S.get(f._id); if (s) Object.assign(s, clone(u.$set || {})); return { modifiedCount: 1 }; },
    };
    const EtatImages = { updateOne: async (f, u) => { journal.push(['etat', clone(f), clone(u)]); return { modifiedCount: 1 }; } };
    return { M: { Carte, Image, Set: Set_, EtatImages }, etat: { carte: id => clone(C.get(id)), image: id => clone(I.get(id)), images: () => [...I.values()].map(clone), set: id => clone(S.get(id)) }, journal };
}

module.exports = { fauxModeles };
