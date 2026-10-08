'use strict';
// Une transaction Mongo (comme le webhook Stripe, index.js ~7000). Si l'appelant (B2 : la liaison) en tient déjà une, on s'y joint (`session`), on n'en ouvre pas une seconde.
// withTransaction rejoue le corps sur une erreur TRANSITOIRE (conflit d'écriture) : le corps ne doit donc rien faire d'autre que des écritures de la session.
const mongoose = require('mongoose'); const db = require('../db');
const client = () => { const b = db.base(); return b.client || mongoose.connection.getClient(); };
async function dansUneTransaction(corps, session = null) {
    if (session) return corps(session);
    const s = client().startSession();
    try { let sortie; await s.withTransaction(async () => { sortie = await corps(s); }, { readPreference: 'primary', readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } }); return sortie; }
    finally { await s.endSession(); }
}
module.exports = { dansUneTransaction };
