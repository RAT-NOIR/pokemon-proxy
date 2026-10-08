'use strict';
const express = require('express');
const { lireConfig } = require('./config');
const { verifierIndex } = require('./modeles');
const pret = require('./pret');

// L'ORDRE est celui du graphe des lots ; chaque emplacement est un fichier que SEUL son lot réécrit.
const LOTS = [require('./transport/monter'), require('./installations/monter'), require('./comptes/monter'), require('./argent/monter'),
              require('./identifier/monter'), require('./banc/monter'), require('./scanner/monter')];

let cfg = null, erreurConfig = null;
function lire(env) { if (cfg || erreurConfig) return; try { cfg = lireConfig(env); } catch (e) { erreurConfig = e; console.error(`🔴 [v2] ${e.message} — les routes v2 répondront 503`); } }

/** AVANT le cors() hérité : pose les en-têtes CORS v2 et marque req.origineV2 pour que le cors() hérité s'écarte. */
function monterEnTete(app, env = process.env) {
    lire(env);
    if (!cfg) return;
    for (const l of LOTS) l.enTete(app, cfg);
}
/** APRÈS express.json() et le limiteur IA, AVANT les routes héritées. */
function monter(app, deps = {}, env = process.env) {
    lire(env);
    const router = express.Router();
    if (!cfg) {   // configuration invalide : les chemins PROPRES à la v2 sont fermés en 503, l'ancien serveur continue de servir
        for (const chemin of ['/api/installation', '/api/compte', '/api/scanner', '/api/banc'])
            app.use(chemin, (req, res) => res.status(503).json({ success: false, erreur: { code: 'INDISPONIBLE', message: 'Service momentanément indisponible' }, facturation: null }));
        return;
    }
    pret.armer(verifierIndex);
    for (const l of LOTS) l.routes(router, cfg, { ...deps, pret: pret.pret });
    app.use(router);
}
// /ping additif : la route héritée reste en place et appelle ping() (voir index.js racine)
module.exports = { monterEnTete, monter, ping: () => (cfg ? { versionMinExtension: cfg.versionMinExtension } : {}), arreter: () => { cfg = null; erreurConfig = null; } };
