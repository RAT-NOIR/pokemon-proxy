'use strict';
// Aide des bancs du lot B2 (pas un banc : le préfixe _ l'écarte). Construit une app Express qui monte les routes RÉELLES des deux montages.
const express = require('express');
const registre = require('../registre');
const H = require('./_harnais');

function construireApp(cfg) {
    const app = express();
    app.set('trust proxy', true);              // les bancs varient l'IP par X-Forwarded-For
    app.use(express.json());
    const router = express.Router();
    const pret = (req, res, next) => next();   // la garde d'index est celle du socle (pret.js), non rejouée ici
    for (const m of [require('../installations/monter'), require('../comptes/monter')]) m.routes(router, cfg, { pret });
    app.use(router);
    return app;
}
const SITE = { origin: 'https://rat-market.fr', 'x-rat-market': '1' };
const ip = n => ({ 'x-forwarded-for': `10.0.${Math.floor(n / 250)}.${n % 250 + 1}` });
async function demarrer(cfg) { const s = await H.serveur(construireApp(cfg)); return s; }
module.exports = { construireApp, demarrer, SITE, ip, registre };
