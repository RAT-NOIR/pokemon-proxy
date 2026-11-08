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

// LA LISTE FERMÉE des collections de la Communauté : une base qui en porte une autre n'est pas la base de la Communauté (grappe.js la refuse), et l'outil d'initialisation ne la marque pas.
const COLLECTIONS = Object.freeze(['profils', 'publications', 'arts', 'depots', 'votes', 'signalements', 'journal_moderation', 'classeurs', 'limites', 'galerie_meta', 'purges_r2', 'balayages', 'etat_balayeur', 'jetons_turnstile']);

const TTL_12_MOIS = 'conserveJusqua';
/** Les index de la base dédiée. Idempotent ; appelé au branchement et par l'outil d'initialisation (qui passe SA base). Les attributs de filtre ne sont indexés que pour les publications PUBLIQUES (index partiels). */
async function creerIndex(d = null) {
    const c = nom => (d || base()).collection(nom);
    const pub = { partialFilterExpression: { etat: 'public' } };
    await Promise.all([
        c('profils').createIndex({ pseudoCle: 1 }, { unique: true, name: 'pseudo_unique' }),
        c('publications').createIndex({ etat: 1, publieLe: -1 }, { name: 'etat_date' }),
        c('publications').createIndex({ etat: 1, nbJaime: -1, publieLe: -1 }, { name: 'etat_aimes' }),
        c('publications').createIndex({ categories: 1, publieLe: -1 }, { ...pub, name: 'categories' }),
        c('publications').createIndex({ 'attributs.carte': 1 }, { ...pub, name: 'attr_carte' }),
        c('publications').createIndex({ 'attributs.carteIds': 1 }, { ...pub, name: 'attr_carte_ids' }),
        c('publications').createIndex({ 'attributs.couleur': 1 }, { ...pub, name: 'attr_couleur' }),
        c('publications').createIndex({ 'attributs.type': 1 }, { ...pub, name: 'attr_type' }),
        c('publications').createIndex({ 'attributs.illustrateur': 1 }, { ...pub, name: 'attr_illustrateur' }),
        c('publications').createIndex({ 'attributs.set': 1 }, { ...pub, name: 'attr_set' }),
        c('publications').createIndex({ auteurId: 1 }, { name: 'auteur' }),
        // une SEULE mise à jour en attente par classeur public (classeurs.js, deposerMiseAJour) ; les autres documents n'ont pas ce champ
        c('publications').createIndex({ remplace: 1 }, { unique: true, partialFilterExpression: { remplace: { $type: 'string' } }, name: 'une_mise_a_jour_par_classeur' }),
        c('arts').createIndex({ etat: 1, fmt: 1, publieLe: -1 }, { name: 'etat_format_date' }),
        c('arts').createIndex({ etat: 1, nbJaime: -1, publieLe: -1 }, { name: 'etat_aimes' }),
        c('arts').createIndex({ mots: 1, etat: 1 }, { name: 'mots_1_etat_1' }),
        c('arts').createIndex({ auteurId: 1, etat: 1 }, { name: 'auteur' }),
        c('depots').createIndex({ purgeLe: 1 }, { expireAfterSeconds: 0, name: 'ttl_depots' }),
        c('depots').createIndex({ compteId: 1, etat: 1 }, { name: 'compte' }),
        c('votes').createIndex({ compte: 1, genre: 1, type: 1, cible: 1 }, { unique: true, name: 'vote_unique' }),
        c('votes').createIndex({ compte: 1, genre: 1, type: 1, le: -1 }, { name: 'votes_du_compte' }),
        c('votes').createIndex({ type: 1, genre: 1, le: -1 }, { name: 'votes_recents' }),
        c('signalements').createIndex({ [TTL_12_MOIS]: 1 }, { expireAfterSeconds: 0, name: 'ttl_12_mois' }),
        c('signalements').createIndex({ etat: 1, le: 1 }, { name: 'file' }),
        c('signalements').createIndex({ cibleType: 1, cibleId: 1, compteId: 1 }, { unique: true, partialFilterExpression: { compteId: { $type: 'string' } }, name: 'un_signalement_par_compte' }),
        c('journal_moderation').createIndex({ [TTL_12_MOIS]: 1 }, { expireAfterSeconds: 0, name: 'ttl_12_mois' }),
        c('classeurs').createIndex({ auteurId: 1, creeLe: -1 }, { name: 'auteur' }),
        c('limites').createIndex({ cle: 1 }, { unique: true, name: 'cle_unique' }),
        c('limites').createIndex({ expireLe: 1 }, { expireAfterSeconds: 0, name: 'ttl_limites' }),
        c('jetons_turnstile').createIndex({ h: 1 }, { unique: true, name: 'jeton_unique' }),
        c('jetons_turnstile').createIndex({ expireLe: 1 }, { expireAfterSeconds: 0, name: 'ttl_jetons' }),
        c('balayages').createIndex({ [TTL_12_MOIS]: 1 }, { expireAfterSeconds: 0, name: 'ttl_12_mois' }),
        c('purges_r2').createIndex({ le: 1 }, { name: 'file' })
    ]);
}
module.exports = { brancher, branche, base, col, debrancher, creerIndex, COLLECTIONS };
