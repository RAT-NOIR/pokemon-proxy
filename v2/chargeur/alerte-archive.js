'use strict';
// JUMEAU-V2 (passe 2, I3) — l'ALERTE de l'archive des visuels, écrite EN BASE (collection `alertes` de l'API, un document `alerte/archive-visuels`), sur le modèle de `alerte/file-vide` du worker
// (collecte-cartes/alimentateur.js) : `active`, `depuis` (le début de l'ÉPISODE : posé à la transition, jamais réécrit tant qu'il dure), `constateLe`, `resolueLe`.
// Sans elle, une archive absente, sans colonne des jumeaux ou vieille de plus de 48 h ne se voit que dans un journal et un compteur en mémoire, alors que toute affirmation est un 503.
// Une lecture suffit à la surveiller : `db.alertes.findOne({ _id: 'alerte/archive-visuels', active: true })`. Une seule écriture par essai du cycle (au plus une par jour, ou une toutes les 5 minutes tant que la colonne manque).
const ID = 'alerte/archive-visuels';

/** @param col une collection (`findOne`, `updateOne`) ; @param o { actif, raison, ageHeures, chargeLe, maintenant } */
async function ecrireAlerteArchive(col, { actif, raison = null, ageHeures = null, chargeLe = null, maintenant = new Date() }) {
    const ancien = await col.findOne({ _id: ID });
    if (!actif) {
        if (ancien && ancien.active) await col.updateOne({ _id: ID }, { $set: { active: false, resolueLe: maintenant } });
        return;
    }
    const depuis = ancien && ancien.active && ancien.depuis ? ancien.depuis : maintenant;           // un épisode qui dure garde son début ; un nouvel épisode repart du sien
    await col.updateOne({ _id: ID }, { $set: { active: true, depuis, constateLe: maintenant, raison, ageHeures, chargeLe } }, { upsert: true });
}

/** L'écriture de PRODUCTION (collection `alertes` de la base de l'API) : à brancher dans le montage, jamais par défaut (un banc n'écrit rien d'autre que sa base). */
const ecrire = doc => ecrireAlerteArchive(require('../db').col('alertes'), doc);

module.exports = { ecrireAlerteArchive, ecrire, ID };
