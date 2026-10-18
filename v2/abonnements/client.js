'use strict';
// Le client Stripe des abonnements. En production : le SDK, créé à la demande avec la clé de la configuration (une seule fois par clé). Dans les bancs : un FAUX en mémoire, branché ici ;
// aucun banc n'appelle jamais Stripe. Un faux branché l'emporte sur tout (même avec une configuration complète), et se débranche.
let faux = null, reel = null, cleReelle = null;
function brancher(f) { if (!f || typeof f !== 'object') throw new Error('client : un faux Stripe est un objet'); faux = f; }
function debrancher() { faux = null; reel = null; cleReelle = null; }
function obtenir(cfgAbo) {
    if (faux) return faux;
    if (!cfgAbo || !cfgAbo.cle) throw Object.assign(new Error('client Stripe : aucune clé configurée'), { code: 'INDISPONIBLE' });
    if (!reel || cleReelle !== cfgAbo.cle) { reel = require('./sdk').creerClient(cfgAbo.cle); cleReelle = cfgAbo.cle; }
    return reel;
}
module.exports = { brancher, debrancher, obtenir };
