'use strict';
// Préchargement (-r) du serveur ENFANT de test-repli-quota.js : le faux réseau du verrou (faux-reseau-v2.js) PLUS une panne CIBLÉE de la lecture d'appui du repli.
// Le repli lit `analyses` avec la projection { cartes, produits } (retour-live.js::repliDuRetour) ; la garde `carteIdentifiee` lit { cartes, statut }, le calcul « douteux » lit { cartes } : seule la première est touchée.
// Inerte sans RM_PANNE_REPLI_FICHIER (un chemin dans le dossier temporaire). Ce fichier JSON, posé et relu par le banc, pilote la panne :
//   { "appels": <nombre de lectures du repli vues>, "saut": <lectures laissées passer avant la panne>, "echecs": <nombre de lectures qui LÈVENT ensuite> }
// Chaque lecture du repli incrémente `appels` (le banc compte ainsi les lectures par requête : UN calcul, jamais deux).
require('./faux-reseau-v2.js');
const fs = require('fs');
const FICHIER = process.env.RM_PANNE_REPLI_FICHIER;
if (FICHIER) {
    const db = require('../db');
    const col = db.col;
    db.col = function (nom) {
        const c = col.apply(this, arguments);
        if (nom !== 'analyses') return c;
        return new Proxy(c, {
            get(cible, p) {
                const v = cible[p];
                if (typeof v !== 'function') return v;
                if (p !== 'findOne') return v.bind(cible);
                return async function (filtre, options) {
                    if (options && options.projection && options.projection.produits === 1 && options.projection.cartes === 1) {
                        let etat; try { etat = JSON.parse(fs.readFileSync(FICHIER, 'utf8')); } catch { etat = { appels: 0, saut: 0, echecs: 0 }; }
                        etat.appels = (etat.appels || 0) + 1;
                        const leve = etat.appels > (etat.saut || 0) && etat.appels <= (etat.saut || 0) + (etat.echecs || 0);
                        fs.writeFileSync(FICHIER, JSON.stringify(etat));
                        if (leve) throw new Error('panne ciblée de la lecture du repli (banc)');
                    }
                    return v.call(cible, filtre, options);
                };
            }
        });
    };
}
