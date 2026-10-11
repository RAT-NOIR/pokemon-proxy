'use strict';
// COTES-VISUELS, tour 1 — le FIL DE TRAVAIL du chargeur : il lit `cartes` en lecture seule (flux), décide, range en colonnes, et renvoie les tampons au serveur SANS copie.
// Plafonné par `resourceLimits` (chargeur.js) : s'il dépasse, c'est LUI qui meurt, et le serveur garde sa version. Il ne reçoit que les deux variables de lecture (jamais le .env que
// dotenv ajouterait à son environnement) et le catalogue en deux colonnes d'entiers.
const { parentPort, workerData } = require('worker_threads');

(async () => {
    try {
        const { sourceCartes } = require('./source');
        const { calculer } = require('./calcul');
        const { regleEmbarquee } = require('./regle-site');
        const src = await sourceCartes({ env: workerData.env });
        if (!src.ok) { parentPort.postMessage({ type: 'refus', raison: src.raison }); return; }
        const metacarte = new Map();
        for (let i = 0; i < workerData.ids.length; i++) metacarte.set(workerData.ids[i], workerData.metas[i] < 0 ? null : workerData.metas[i]);
        let r;
        try { r = await calculer({ sets: src.sets, docs: src.docs, lignes: src.lignes, metacarte, regle: await regleEmbarquee() }); } finally { try { await src.fermer(); } catch { /* déjà fermée */ } }
        if (!r.version) { parentPort.postMessage({ type: 'resultat', donnees: null, comptes: r.comptes }); return; }
        const p = r.version.paquet();
        parentPort.postMessage({ type: 'resultat', donnees: p.donnees, comptes: r.comptes }, p.tampons);
    } catch (e) { parentPort.postMessage({ type: 'erreur', nom: (e && (e.codeName || e.code || e.name)) || 'erreur' }); }
})();
