'use strict';
const express = require('express');
const { lireConfig } = require('./config');
const { verifierIndex } = require('./modeles');
const pret = require('./pret');
const { CHEMINS_HERITES, aiguilleur, estAiguilleur } = require('./heritage');
const { repondreErreur } = require('./erreurs');

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
    if (!cfg) {   // configuration invalide : les chemins PROPRES à la v2 sont fermés en 503, l'ancien serveur continue de servir
        for (const chemin of ['/api/installation', '/api/compte', '/api/scanner', '/api/banc'])
            app.use(chemin, (req, res) => res.status(503).json({ success: false, erreur: { code: 'INDISPONIBLE', message: 'Service momentanément indisponible' }, facturation: null }));
        return;
    }
    pret.armer(verifierIndex);
    app.use(assembler(LOTS, cfg, deps));
}
/**
 * B8.1 — les clés qu'un corps JSON v2 ne porte JAMAIS. Écrit par ce qu'il AUTORISE : un nom de clé ordinaire, à profondeur et nombre de nœuds bornés. Sont refusées :
 *   · `__proto__`, `constructor`, `prototype` (JSON.parse les rend en clés PROPRES : un fusionneur d'objets, présent ou futur, les prendrait pour des consignes de prototype) ;
 *   · toute clé qui commence par `$` (opérateurs Mongo : `{"$ne":""}` ne doit jamais atteindre un filtre) ;
 *   · un corps plus profond que 8 niveaux ou de plus de 5 000 nœuds (aucune route n'en demande autant).
 * @returns {string|null} la clé refusée, ou null.
 */
const CLES_RESERVEES = new Set(['__proto__', 'constructor', 'prototype']);
function cleInterdite(valeur, profondeur = 0, vus = { n: 0 }) {
    if (valeur === null || typeof valeur !== 'object') return null;
    if (profondeur > 8 || ++vus.n > 5000) return '(profondeur ou taille)';
    for (const k of Object.keys(valeur)) {
        if (CLES_RESERVEES.has(k) || k.startsWith('$')) return k;
        const r = cleInterdite(valeur[k], profondeur + 1, vus);
        if (r !== null) return r;
    }
    return null;
}
/**
 * Assemble les routeurs des lots. La garde d'index (pret) est posée ICI, UNE fois, sur ce que le routeur de chaque lot
 * CONTIENT (sa pile), et non sur les méthodes qu'il appelle : chaînage, route(), méthodes hors liste (search, copy…)
 * sont tous couverts, et un lot ne peut ni l'oublier ni la contourner.
 * Un lot v2 ne pose AUCUN use() (sans chemin, '/', tableau, sous-routeur…) : un use s'appliquerait aussi aux routes héritées.
 * La pile ne doit donc contenir que des couches `route` ; sinon le lot est REFUSÉ (échoue fermé).
 */
// Minuscules SEULEMENT : Express ignore la casse des chemins, une majuscule contournerait la comparaison aux chemins hérités.
const CHEMIN_DE_LOT = /^\/(?:api\/[a-z0-9_-][a-z0-9_.-]*|ping)(?:\/[a-z0-9_.:-]+)*$/;
function assembler(lots, cfgLots, deps = {}) {
    const router = express.Router();
    lots.forEach((l, i) => {
        const sous = express.Router();
        l.routes(sous, cfgLots, { ...deps, pret: pret.pret });
        if (Object.keys(sous.params || {}).length || (sous._params || []).length) throw new Error(`v2 : refus du lot n°${i} : router.param n'est pas autorisé (il serait ignoré en silence)`);
        for (const couche of sous.stack) {
            if (!couche.route) throw new Error(`v2 : refus du lot n°${i} : un use() (middleware ou sous-routeur) n'est pas autorisé, seules les routes le sont`);
            // LISTE BLANCHE des chemins : chaîne littérale sous /api/<segment littéral> ou /ping. Un joker, une expression
            // régulière, un tableau ou un paramètre en tête capterait des routes héritées.
            if (typeof couche.route.path !== 'string' || !CHEMIN_DE_LOT.test(couche.route.path))
                throw new Error(`v2 : refus du lot n°${i} : chemin « ${String(couche.route.path)} » hors de la liste blanche (/api/<segment> littéral ou /ping)`);
            // Chemin qui RECOUVRE une route héritée : pour CHAQUE méthode de la route, le premier handler doit être un aiguilleur
            // (sinon une requête 1.0.x tomberait sur la garde d'index au lieu de la route héritée).
            if (CHEMINS_HERITES.includes(couche.route.path.toLowerCase())) {   // Express ignore la casse : on compare en minuscules
                const vues = new Set();
                for (const c of couche.route.stack) {
                    const m = c.method || '_toutes';
                    if (vues.has(m)) continue;
                    vues.add(m);
                    if (!estAiguilleur(c.handle)) throw new Error(`v2 : refus du lot n°${i} : ${couche.route.path} recouvre une route héritée, son premier handler (méthode ${m}) doit être un aiguilleur`);
                }
            }
            // Garde à l'EXÉCUTION : on enveloppe le point d'entrée de la couche (route.dispatch), pas une copie de la pile de la
            // Route — un handler ajouté plus tard sur une Route retenue par le lot est donc gardé aussi.
            // L'aiguilleur (premier handler de la méthode demandée) passe AVANT la garde : prédicat faux => la route héritée répond.
            const dispatch = couche.handle, route = couche.route;
            couche.handle = function gardeIndex(req, res, next) {
                // Comme Express : HEAD est servi par les handlers GET quand la route n'en déclare pas pour HEAD.
                let m = String(req.method).toLowerCase();
                if (m === 'head' && !route.methods.head) m = 'get';
                // B8.1 : un corps qui porte une clé réservée ou un opérateur est refusé AVANT toute route (voir cleInterdite) ; placé APRÈS les aiguilleurs : la route héritée d'une requête 1.0.x n'est pas touchée.
                const garde = () => {
                    if (cleInterdite(req.body) !== null) return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'cle-interdite' });
                    return pret.pret(req, res, err => (err ? next(err) : dispatch.call(this, req, res, next)));
                };
                // TOUS les aiguilleurs consécutifs en tête de la méthode demandée sont consultés avant la garde.
                const aiguilleurs = [];
                for (const c of route.stack.filter(c => !c.method || c.method === m)) { if (!estAiguilleur(c.handle)) break; aiguilleurs.push(c.handle); }
                const suite = k => (k >= aiguilleurs.length ? garde() : aiguilleurs[k](req, res, a => (a === 'route' ? next() : a ? next(a) : suite(k + 1))));
                return suite(0);
            };
        }
        router.stack.push(...sous.stack);
    });
    return router;
}
// /ping additif : la route héritée reste en place et appelle ping() (voir index.js racine)
module.exports = { LOTS, monterEnTete, monter, assembler, aiguilleur, cleInterdite, ping: () => (cfg ? { versionMinExtension: cfg.versionMinExtension } : {}), arreter: () => { cfg = null; erreurConfig = null; pret.desarmer(); } };
