'use strict';
const express = require('express');
const { lireConfig } = require('./config');
const { verifierIndex } = require('./modeles');
const pret = require('./pret');
const { CHEMINS_HERITES, aiguilleur, estAiguilleur } = require('./heritage');
const { repondreErreur } = require('./erreurs');
const { capacitesServies } = require('./capacites');

// L'ORDRE est celui du graphe des lots ; chaque emplacement est un fichier que SEUL son lot réécrit.
const LOTS = [require('./transport/monter'), require('./installations/monter'), require('./comptes/monter'), require('./argent/monter'),
              require('./identifier/monter'), require('./banc/monter'), require('./scanner/monter'), require('./collection/monter')];
// Les chemins PROPRES à la v2 (aucune route héritée dessous) : fermés en 503 quand la configuration est invalide. test-collection.js la compare aux routes MONTÉES (§21 bis : deux listes, une vérité).
const CHEMINS_FERMES_503 = Object.freeze(['/api/installation', '/api/compte', '/api/scanner', '/api/banc', '/api/collection']);

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
        for (const chemin of CHEMINS_FERMES_503)
            app.use(chemin, (req, res) => res.status(503).json({ success: false, erreur: { code: 'INDISPONIBLE', message: 'Service momentanément indisponible' }, facturation: null }));
        return;
    }
    pret.armer(() => verifierIndex(Boolean(cfg.abonnements && cfg.abonnements.actif)));   // STRIPE-V2 : les index des abonnements ne sont exigés que s'ils sont allumés
    app.use(assembler(LOTS, cfg, deps));
}
// Le limiteur hérité (index.js) ne saute que ce que la v2 traite elle-même : voir limiteur-heritage.js. Pas de drapeau « monté » en plus de `cfg` : `cfg` n'est posé valide que par lire(),
// et monter() monte les routes de façon synchrone dès que `cfg` est valide (une exception du montage arrête le démarrage), donc `cfg` valide ⇒ routes montées avant la première requête.
const limiteurHerite = require('./limiteur-heritage').fabrique(() => cfg);
/**
 * B8.1 (tour 1, I-1) — la garde des CLÉS, écrite par ce qu'elle AUTORISE (liste permise) : une clé n'est acceptée que si elle a la forme d'un identifiant (`FORME_CLE`)
 * ET n'est pas une propriété d'`Object.prototype` (`k in Object.prototype` couvre `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `__defineGetter__`…). Tout le reste est refusé,
 * y compris ce qu'on n'a pas prévu : `$ne` (opérateur Mongo), `a.b` (chemin pointé), une clé avec espace, tiret, accent, chiffre initial, vide.
 * La forme est CONFRONTÉE aux clés de requête légitimes par le banc d'abus (schémas Requete* d'openapi.v2.json, CHAMPS_PRIX de retour-live.js, paramètres de requête) : aucune n'est refusée.
 * S'applique à `req.body` (à toute profondeur, tableaux compris : leurs ÉLÉMENTS sont parcourus, pas leurs indices), à `req.query` (aucun objet imbriqué : une chaîne, ou une liste de chaînes),
 * et à `req.params` (une chaîne). Bornes : au plus NIVEAUX_MAX niveaux d'objets ou de tableaux (la racine est le niveau 1) et NOEUDS_MAX objets ou tableaux au total.
 * @returns {string|null} la clé (ou la borne) refusée, ou null.
 */
const FORME_CLE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const NIVEAUX_MAX = 9, NOEUDS_MAX = 5000;
const cleOk = k => FORME_CLE.test(k) && !(k in Object.prototype);
function cleInterdite(valeur, niveau = 1, vus = { n: 0 }) {
    if (valeur === null || typeof valeur !== 'object') return null;
    if (niveau > NIVEAUX_MAX || ++vus.n > NOEUDS_MAX) return '(profondeur ou taille)';
    if (Array.isArray(valeur)) {
        for (const x of valeur) { const r = cleInterdite(x, niveau + 1, vus); if (r !== null) return r; }
        return null;
    }
    for (const k of Object.keys(valeur)) {
        if (!cleOk(k)) return k;
        const r = cleInterdite(valeur[k], niveau + 1, vus);
        if (r !== null) return r;
    }
    return null;
}
function requeteRefusee(q) {
    if (q === null || typeof q !== 'object') return null;
    for (const k of Object.keys(q)) {
        if (!cleOk(k)) return k;
        const v = q[k];
        if (typeof v === 'string' || (Array.isArray(v) && v.every(x => typeof x === 'string'))) continue;
        return k;
    }
    return null;
}
function parametresRefuses(p) {
    if (p === null || typeof p !== 'object') return null;
    for (const [k, v] of Object.entries(p)) if (typeof v !== 'string') return k;
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
                // B8.1 : un corps, une requête ou un paramètre dont une clé sort de la liste permise est refusé AVANT toute route (voir cleInterdite) ; placé APRÈS les aiguilleurs : la route héritée d'une requête 1.0.x n'est pas touchée.
                const garde = () => {
                    if (cleInterdite(req.body) !== null || requeteRefusee(req.query) !== null) return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'cle-interdite' });
                    if (parametresRefuses(req.params) !== null) return repondreErreur(res, 'ENTREE', 'Requête invalide', { detail: 'parametre' });
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
// FREIN-CONSTATES : l'appel au modèle de la chaîne héritée, SOUS le plafond global de dépense. Sans configuration valide (v2 fermée), l'appel part tel quel : la production reste inchangée.
const depenseModele = { appeler: (post, url, corps, config) => (cfg ? require('./argent/depense-modele').pourConfig(cfg).appeler(post, url, corps, config) : post(url, corps, config)) };
// /ping additif : la route héritée reste en place et appelle ping() (voir index.js racine). CAPACITES-PING : `capacites` (la liste fermée de capacites.js) s'ajoute à `versionMinExtension` sous la MÊME condition
// (v2 configurée) ; une fonction pure de la configuration, synchrone, qui ne lève jamais : /ping reste un keep-alive.
module.exports = { depenseModele, LOTS, CHEMINS_FERMES_503, monterEnTete, monter, assembler, aiguilleur, cleInterdite, requeteRefusee, parametresRefuses, FORME_CLE, ping: () => (cfg ? { versionMinExtension: cfg.versionMinExtension, capacites: capacitesServies(cfg) } : {}), limiteurHerite, arreter: () => { try { require('./identifier/taux-declencheur').arreterTaux(); } catch { /* rien à arrêter */ } cfg = null; erreurConfig = null; pret.desarmer(); } };
