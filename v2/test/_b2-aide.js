'use strict';
// Aide des bancs du lot B2 (pas un banc : le préfixe _ l'écarte). Monte les routes RÉELLES des deux montages par l'assembleur du socle
// (donc avec la vraie garde d'index `pret`, armée sur verifierIndex ; les bancs créent les index avant).
const express = require('express');
const registre = require('../registre');
const H = require('./_harnais');
const pret = require('../pret');
const { verifierIndex } = require('../modeles');

function construireApp(cfg) {
    const app = express();
    app.set('trust proxy', true);              // les bancs varient l'IP par X-Forwarded-For
    app.use(express.json());
    const { assembler } = require('../index');
    pret.armer(verifierIndex);
    app.use(assembler([require('../installations/monter'), require('../comptes/monter')], cfg, {}));
    return app;
}
const SITE = { origin: 'https://rat-market.fr', 'x-rat-market': '1' };
const ip = n => ({ 'x-forwarded-for': `10.0.${Math.floor(n / 250)}.${n % 250 + 1}` });
async function demarrer(cfg) { const s = await H.serveur(construireApp(cfg)); return s; }
// Le travail d'inscription / d'oubli / de renvoi est DÉTACHÉ de la réponse (I2) : un banc qui lit la base ensuite l'attend ici.
const attendre = () => require('../comptes/service').attendre();
module.exports = { construireApp, demarrer, SITE, ip, registre, attendre };
