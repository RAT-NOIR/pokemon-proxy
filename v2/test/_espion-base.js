'use strict';
// Préchargement (-r) du banc test-limiteur-herite.js : le faux réseau de v2 PLUS un espion sur les appels réels du pilote Mongo vers les collections que le plafond par IP doit
// protéger. Une ligne « ESPION <collection>.<méthode> » par appel, sur la sortie du serveur enfant (relue par le banc). Il ne modifie aucun résultat.
require('./faux-reseau-v2');
const { Collection } = require('mongodb');
const SURVEILLEES = new Set(['installations', 'limites', 'comptes', 'sessions']);
for (const m of ['findOne', 'findOneAndUpdate', 'insertOne', 'updateOne', 'updateMany', 'deleteOne']) {
    const original = Collection.prototype[m];
    if (typeof original !== 'function') continue;
    Collection.prototype[m] = function (...args) {
        if (SURVEILLEES.has(this.collectionName)) console.log(`ESPION ${this.collectionName}.${m}`);
        return original.apply(this, args);
    };
}
