'use strict';
// Emplacement du lot GALERIE : la Communauté du site (fil des pages, banque d'art, votes, dépôt R2, signalements, modération).
//   · V2_GALERIE absent ou ≠ 1 : AUCUNE route (404 natif), aucune connexion, aucun effet — le comportement est celui d'avant, octet pour octet ;
//   · V2_GALERIE=1 mais la garde de la base dédiée / du stockage dit non (cfg.galerie.pret faux) : le lot NE SE MONTE PAS, une ligne dit pourquoi (jamais une valeur), les routes restent absentes ;
//   · sinon : les routes sont montées et la base dédiée s'ouvre en arrière-plan (grappe.ouvrir) ; tant qu'elle n'est pas branchée, chaque route répond 503.
const { routesGalerie } = require('./routes');
const G = require('./base');
const grappe = require('./grappe');
const r2 = require('./r2');

let etat = 'eteint', stockageCourant = null, ouverture = null;
module.exports = {
    /** 'eteint' | 'refuse' | 'monte' — pour les bancs et l'exploitation. */
    etat: () => etat,
    stockage: () => stockageCourant,
    /** Pour les BANCS : la promesse de l'ouverture de la base (lève si elle a échoué). */
    pret: () => ouverture || Promise.resolve(null),
    enTete(app, cfg) { },
    routes(router, cfg, deps = {}) {
        const g = cfg.galerie;
        if (!g || !g.actif) { etat = 'eteint'; return; }
        if (!g.pret) { etat = 'refuse'; console.error(`🔴 [v2 galerie] V2_GALERIE=1 mais la Communauté ne se monte pas : ${g.raison}`); return; }
        const env = deps.env || process.env;
        const stockage = deps.stockage || r2.creerStockage(r2.lireConfigR2(env).c, { env });
        stockageCourant = stockage;
        routesGalerie(router, cfg, { ...deps, env, stockage });
        const ouvrir = deps.ouvrirBase || (() => grappe.ouvrir({ env }));
        ouverture = ouvrir().then(async ({ db, fermer }) => { G.brancher(db, fermer); await G.creerIndex(); })
            .catch(e => { console.error(`❌ [v2 galerie] la base dédiée ne s'ouvre pas : ${(e && e.name) || 'erreur'} — les routes de la Communauté répondent 503`); throw e; });
        ouverture.catch(() => { /* déjà journalisé : la promesse est aussi exposée aux bancs */ });
        etat = 'monte';
    },
    async arreter() { etat = 'eteint'; stockageCourant = null; ouverture = null; await G.debrancher(); }
};
