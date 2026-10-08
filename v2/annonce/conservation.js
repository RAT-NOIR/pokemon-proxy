'use strict';
// Conservation de la description EXPURGÉE : 90 jours (cfg.retention.annonceJours), puis effacée.
// Deux mécanismes : l'index TTL de `annonces.expireLe` (modeles.js, filet de sécurité : Mongo tourne par pas de 60 s) ET une purge
// applicative à horloge injectable, la seule qui se TESTE (on ne peut attendre ni 90 jours ni le moniteur TTL).
const { col } = require('../db');
const { preparerAnnonce } = require('./verifier');

const JOUR_MS = 86400e3, PASSE_MS = 24 * 3600e3;

// Jamais ne lève : une écriture qui échoue ne doit pas faire échouer l'analyse. Le journal ne porte que le code d'erreur, jamais le texte.
async function conserverAnnonce(scanId, annonce, cfg, maintenant = new Date()) {
    try {
        if (!cfg || !cfg.annonce || cfg.annonce.conservee !== true) return;               // interrupteur éteint (ou inconnu) : rien n'est écrit
        if (typeof scanId !== 'string' || !scanId || !annonce || typeof annonce !== 'object') return;
        const p = preparerAnnonce({ title: annonce.titre, description: annonce.description }, cfg);   // ceinture : re-expurgé, idempotent
        await col('annonces').insertOne({
            _id: scanId, titre: p.titre, description: p.description, expurgeeParServeur: Boolean(annonce.expurgeeParServeur) || p.expurgeeParServeur,
            creeLe: maintenant, expireLe: new Date(maintenant.getTime() + cfg.retention.annonceJours * JOUR_MS)
        });
    } catch (e) {
        console.error(`v2/annonce : conservation de ${typeof scanId === 'string' ? scanId : '?'} échouée (code ${e && e.code ? e.code : 'inconnu'})`);
    }
}

async function purgerAnnonces(maintenant = new Date()) {
    const r = await col('annonces').deleteMany({ expireLe: { $lte: maintenant } });
    return { supprimees: r.deletedCount };
}

// Une passe au démarrage, puis toutes les 24 h. Appelé UNE fois par le montage (monter.js de B1b). Rend le timer (unref).
function demarrerPurge() {
    const passe = () => purgerAnnonces().catch(e => console.error(`v2/annonce : purge échouée (code ${e && e.code ? e.code : 'inconnu'})`));
    passe();
    return setInterval(passe, PASSE_MS).unref();
}
module.exports = { conserverAnnonce, purgerAnnonces, demarrerPurge };
