'use strict';
// MESURE SEULEMENT (banc) — chargé par `-r` dans l'enfant de mesure, dans le serveur de mesure ET (les options de Node sont héritées) dans le fil de travail du chargeur.
// Il remplace, dans CE processus de banc, la porte de lecture seule par une connexion à la base EN MÉMOIRE du banc (MESURE_URI) : un mongod sans authentification ne peut pas prouver de privilèges.
// Ce n'est PAS du code de production, et il ne fait rien sans MESURE_URI. (La garde réelle des privilèges est éprouvée par test-chargeur-lecture-seule.js et par la mesure réelle.)
if (process.env.MESURE_URI) {
    const LS = require('../../chargeur/lecture-seule');
    const mongoose = require('mongoose');
    const { facadeLecture } = require('../../../collecte-cartes/facade-lecture');
    LS.jugerVariables = () => ({ ok: true });
    LS.ouvrir = async () => {
        const cx = await mongoose.createConnection(process.env.MESURE_URI, { dbName: 'cartes' }).asPromise();
        return { ok: true, cartes: LS.restreindre(facadeLecture(cx.db, () => cx.close())) };
    };
}
