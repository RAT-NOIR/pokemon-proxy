'use strict';
// Sonde de test-banc-v2.js (son nom ne commence pas par "test-" : le lanceur ne la joue pas seule). Elle charge le harnais, N'OUVRE RIEN, et dit ce que
// process.env contient : un banc fabriqué qui ferait mongoose.connect(process.env.MONGODB_URI) ne trouverait aucune adresse.
const H = require('./_harnais');
const mongoose = require('mongoose');
(async () => {
    const e = process.env;
    let refus = null;
    if (e.MONGODB_URI === undefined) {   // la tentative n'a lieu QUE sans adresse : avec une adresse elle se connecterait, et cette sonde ne se connecte jamais
        try { await mongoose.connect(e.MONGODB_URI); refus = false; } catch (_) { refus = true; }
    }
    console.log('RES=' + JSON.stringify({
        uri: typeof e.MONGODB_URI, cartes: typeof e.MONGODB_CARTES_URI, lecture: typeof e.MONGODB_LECTURE_URI, isole: e.BANC_ISOLE,
        variablesUri: Object.entries(e).filter(([, v]) => /^mongodb(\+srv)?:\/\//i.test(v)).map(([k]) => k), refus, harnais: typeof H.v
    }));
})();
