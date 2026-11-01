'use strict';
// Emplacement du lot GALERIE : la Communauté du site (fil des pages, banque d'art, votes, dépôt R2, signalements, modération).
//   · V2_GALERIE absent ou ≠ 1 : AUCUNE route (404 natif), aucune connexion, aucun effet — le comportement est celui d'avant, octet pour octet ;
//   · V2_GALERIE=1 mais la configuration dit non (cfg.galerie.pret faux : grappe non déclarée ou connue, buckets, bornes, clés Turnstile factices en production) : le lot NE SE MONTE PAS, une ligne dit pourquoi ;
//   · sinon les routes sont montées et la base dédiée s'ouvre en arrière-plan. Elle n'est BRANCHÉE que si quatre preuves tiennent : la grappe déclarée, le marqueur de la base, la liste fermée de ses collections
//     (grappe.ouvrir) ET les marqueurs des deux buckets R2 (stockage.verifierMarqueurs). Sinon la cause nommée est journalisée (`cause()`), rien n'est branché, et chaque route répond 503.
//   · une fois branchée, un BALAYEUR côté API (balayeur.js) rejoue les suppressions R2 qui ont échoué et retire les objets orphelins ; chaque passe est bornée et journalisée.
const { routesGalerie } = require('./routes');
const G = require('./base');
const grappe = require('./grappe');
const r2 = require('./r2');

let etat = 'eteint', stockageCourant = null, ouverture = null, causeCourante = null, secretCourant = null, minuteur = null;
module.exports = {
    /** 'eteint' | 'refuse' | 'monte' — pour les bancs et l'exploitation. */
    etat: () => etat,
    stockage: () => stockageCourant,
    secret: () => secretCourant,
    /** La cause nommée de la dernière ouverture ratée (`marqueur-absent`, `collection-inconnue`, `marqueur-r2-absent`…), ou null. */
    cause: () => causeCourante,
    /** Pour les BANCS : la promesse de l'ouverture de la base (lève si elle a échoué). */
    pret: () => ouverture || Promise.resolve(null),
    enTete(app, cfg) { },
    routes(router, cfg, deps = {}) {
        const g = cfg.galerie;
        if (!g || !g.actif) { etat = 'eteint'; return; }
        if (!g.pret) { etat = 'refuse'; console.error(`🔴 [v2 galerie] V2_GALERIE=1 mais la Communauté ne se monte pas : ${g.raison}`); return; }
        const env = deps.env || process.env;
        const stockage = deps.stockage || r2.creerStockage(r2.lireConfigR2(env).c, { env });
        stockageCourant = stockage; secretCourant = cfg.empreinte.secret; causeCourante = null;
        routesGalerie(router, cfg, { ...deps, env, stockage });
        const ouvrir = deps.ouvrirBase || (() => grappe.ouvrir({ env }));
        ouverture = (async () => {
            const { db, fermer } = await ouvrir();
            try { await stockage.verifierMarqueurs(); } catch (e) { await fermer(); throw e; }
            G.brancher(db, fermer);
            await G.creerIndex();
            if (deps.balayage !== false) {
                const { demarrer } = require('./balayeur');
                minuteur = demarrer({ stockage, secret: secretCourant, intervalleMs: deps.intervalleBalayageMs === undefined ? g.balayageMs : deps.intervalleBalayageMs });
            }
        })().catch(e => {
            causeCourante = (e && e.cause) || 'ouverture-echouee';
            console.error(`❌ [v2 galerie] la Communauté n'est PAS branchée — cause : ${causeCourante}${e && Array.isArray(e.detail) ? ` (${e.detail.join(', ')})` : ''} — les routes répondent 503`);
            throw e;
        });
        ouverture.catch(() => { /* déjà journalisé : la promesse est aussi exposée aux bancs */ });
        etat = 'monte';
    },
    async arreter() { etat = 'eteint'; stockageCourant = null; ouverture = null; causeCourante = null; if (minuteur) { clearInterval(minuteur); minuteur = null; } await G.debrancher(); }
};
