'use strict';
// Fabriques communes des bancs du lot B3 : un porteur (forme §3.3) est FABRIQUÉ ici, B2 le produira en vrai.
const db = require('../db'); const M = require('../modeles');
let n = 0;
const compte = async (o = {}) => { const c = M.nouveauCompte({ email: `c${++n}@x.fr`, emailCle: `c${n}@x.fr`, motDePasse: {} }); Object.assign(c, { verifie: true }, o); await db.col('comptes').insertOne(c);
    return { type: 'compte', id: c._id, compte: c, installation: null, surface: 'scanner', administrateur: c.role === 'administrateur' }; };
const inst = async (o = {}) => { const i = Object.assign(M.nouvelleInstallation({ jetonEmpreinte: `h${++n}`, essais: 3, libelle: 'x' }), o); await db.col('installations').insertOne(i);
    return { type: 'installation', id: i._id, compte: null, installation: i, surface: 'extension', administrateur: false }; };
const lire = async p => p.type === 'compte' ? db.col('comptes').findOne({ _id: p.id }) : db.col('installations').findOne({ _id: p.id });
module.exports = { compte, inst, lire };
