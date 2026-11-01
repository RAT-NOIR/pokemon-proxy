'use strict';
// GALERIE — l'accès à la base DÉDIÉE. Rien de ce dossier n'ouvre la base de l'API (`../db`) : toute lecture et toute écriture de la Communauté passent par `col()` d'ici, qui ne sert QUE la base branchée
// (en production : celle que grappe.ouvrir a ouverte et contrôlée ; dans les bancs : une base en mémoire nommée comme elle). Un accès sans base branchée LÈVE (les routes répondent 503), jamais un repli.
// Seul `porteur.js` (identité, lecture des comptes et des sessions de l'API) reste du côté de la base de l'API : c'est une LECTURE, déjà faite par toutes les routes v2.
let db = null, fermeture = null;
const brancher = (d, fermer = null) => { db = d; fermeture = fermer; };
const branche = () => db !== null;
function base() { if (!db) throw new Error('galerie : aucune base dédiée branchée'); return db; }
const col = nom => base().collection(nom);
async function debrancher() { const f = fermeture; db = null; fermeture = null; if (f) await f(); }

const TTL_12_MOIS = 'conserveJusqua';
/** Les index de la base dédiée. Idempotent ; appelé au branchement. Les attributs de filtre ne sont indexés que pour les publications PUBLIQUES (index partiels). */
async function creerIndex() {
    const pub = { partialFilterExpression: { etat: 'public' } };
    await Promise.all([
        col('profils').createIndex({ pseudoCle: 1 }, { unique: true, name: 'pseudo_unique' }),
        col('publications').createIndex({ etat: 1, publieLe: -1 }, { name: 'etat_date' }),
        col('publications').createIndex({ etat: 1, nbJaime: -1, publieLe: -1 }, { name: 'etat_aimes' }),
        col('publications').createIndex({ categories: 1, publieLe: -1 }, { ...pub, name: 'categories' }),
        col('publications').createIndex({ 'attributs.carte': 1 }, { ...pub, name: 'attr_carte' }),
        col('publications').createIndex({ 'attributs.carteIds': 1 }, { ...pub, name: 'attr_carte_ids' }),
        col('publications').createIndex({ 'attributs.couleur': 1 }, { ...pub, name: 'attr_couleur' }),
        col('publications').createIndex({ 'attributs.type': 1 }, { ...pub, name: 'attr_type' }),
        col('publications').createIndex({ 'attributs.illustrateur': 1 }, { ...pub, name: 'attr_illustrateur' }),
        col('publications').createIndex({ 'attributs.set': 1 }, { ...pub, name: 'attr_set' }),
        col('publications').createIndex({ auteurId: 1 }, { name: 'auteur' }),
        col('arts').createIndex({ etat: 1, fmt: 1, publieLe: -1 }, { name: 'etat_format_date' }),
        col('arts').createIndex({ etat: 1, nbJaime: -1, publieLe: -1 }, { name: 'etat_aimes' }),
        col('arts').createIndex({ auteurId: 1, etat: 1 }, { name: 'auteur' }),
        col('depots').createIndex({ purgeLe: 1 }, { expireAfterSeconds: 0, name: 'ttl_depots' }),
        col('depots').createIndex({ compteId: 1, etat: 1 }, { name: 'compte' }),
        col('votes').createIndex({ compte: 1, genre: 1, type: 1, cible: 1 }, { unique: true, name: 'vote_unique' }),
        col('votes').createIndex({ compte: 1, genre: 1, type: 1, le: -1 }, { name: 'votes_du_compte' }),
        col('votes').createIndex({ type: 1, genre: 1, le: -1 }, { name: 'votes_recents' }),
        col('signalements').createIndex({ [TTL_12_MOIS]: 1 }, { expireAfterSeconds: 0, name: 'ttl_12_mois' }),
        col('signalements').createIndex({ etat: 1, le: 1 }, { name: 'file' }),
        col('signalements').createIndex({ cibleType: 1, cibleId: 1, compteId: 1 }, { unique: true, partialFilterExpression: { compteId: { $type: 'string' } }, name: 'un_signalement_par_compte' }),
        col('journal_moderation').createIndex({ [TTL_12_MOIS]: 1 }, { expireAfterSeconds: 0, name: 'ttl_12_mois' }),
        col('classeurs').createIndex({ auteurId: 1, creeLe: -1 }, { name: 'auteur' }),
        col('limites').createIndex({ cle: 1 }, { unique: true, name: 'cle_unique' }),
        col('limites').createIndex({ expireLe: 1 }, { expireAfterSeconds: 0, name: 'ttl_limites' })
    ]);
}
module.exports = { brancher, branche, base, col, debrancher, creerIndex };
