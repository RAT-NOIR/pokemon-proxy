'use strict';
// COTES-VISUELS — le MONTAGE du chargeur (appelé par identifier/monter.js, donc seulement quand la v2 est allumée et sa configuration valide ; interrupteur éteint : ce fichier n'est jamais chargé).
//   · banc (BANC_ISOLE=1) : AUCUN réseau, AUCUNE connexion à cartes. Une archive LOCALE (V2_VISUELS_BANC_FICHIER, honorée seulement en banc) si elle est donnée, sinon rien.
//   · production, source « fichier » (défaut) : l'archive précalculée, téléchargée sur l'hôte public R2 ; source « calcul » : le fil plafonné, depuis `cartes` en lecture seule.
// Rien n'est lu ici : demarrer() diffère le premier chargement (le serveur écoute avant, et jusqu'au premier chargement réussi l'état est « sans visuel » / cotes {}).
const fs = require('fs');
const I = require('./index');
const { telecharger } = require('./telechargement');

function demarrerPourConfig(cfg, { env = process.env, fetchFn } = {}) {
    const v = cfg.visuels;
    if (v.fichierBanc) {
        // l'archive de banc est locale et petite : installée TOUT DE SUITE (un banc qui répond avant le chargement ne verrait pas ses visuels). Même format, même validation de structure que la voie réelle.
        try { I.etat.installer(require('./format').deserialiser(require('zlib').gunzipSync(fs.readFileSync(v.fichierBanc), { maxOutputLength: 64 * 1048576 }))); }
        catch (e) { console.error(`❌ [v2 chargeur] archive de banc refusée (${(e && (e.name || e.code)) || 'erreur'}) : sans visuel`); }
        return null;
    }
    if (env.BANC_ISOLE === '1') return null;                                              // un banc ne télécharge ni ne lit cartes
    if (v.source === 'calcul') return I.demarrerChargeur({ env });
    const url = `https://${cfg.images.hotesPublics[0]}/${v.cle}`;
    return I.demarrerChargeur({ env, catalogue: async () => new Map(),
        executer: I.executerDepuisFichier({ lireFichier: () => telecharger(url, { hotes: cfg.images.hotesPublics, fetchFn }) }) });
}
module.exports = { demarrerPourConfig };
