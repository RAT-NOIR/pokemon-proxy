// A charger au DÉBUT de tout banc qui peut toucher un client TPC (après bancs-dossier-arrets) : AUCUN banc ne touche le réseau ni la vraie porte.
// (Incident du 2026-11-08, 10:58 UTC : un client de banc retombé sur le transport par défaut a émis de VRAIES requêtes vers asia.pokemon-card.com ; un 403 a fermé la racine pokemon-card.com.)
//   · `porte-reseau.lire` est remplacée par un piège : tout appel LÈVE, est compté, et fait ÉCHOUER le banc (code de sortie 1) ;
//   · `fetch` global, s'il n'est pas déjà piégé par le banc lui-même, lève aussi.
require('./bancs-dossier-arrets');
const P = require('./collecte-cartes/porte-reseau');
const appels = [];
const lireReelle = P.lire;
P.lire = async (url, ...r) => { appels.push(String(url)); throw new Error(`banc : aucun accès réseau (la vraie porte a été appelée : ${url})`); };
const fetchOrigine = global.fetch;
global.fetch = async u => { appels.push(`fetch ${u}`); throw new Error(`banc : aucun accès réseau (fetch ${u})`); };
process.on('exit', code => {
    if (appels.length) { console.error(`❌ BANC : ${appels.length} appel(s) réseau ou à la vraie porte : ${appels.slice(0, 5).join(' | ')}`); process.exitCode = 1; }
});
module.exports = { appels: () => [...appels], lireReelle, fetchOrigine };
