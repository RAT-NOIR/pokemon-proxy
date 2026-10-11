'use strict';
const crypto = require('crypto');
const { col } = require('./db');

// nom de collection, clé, options. `nom` est EXPLICITE : verifierIndex() compare des noms, pas des formes.
const I = (c, nom, cle, opts = {}) => ({ c, nom, cle, opts: { name: nom, ...opts } });
const TTL = c => I(c, `${c}_ttl`, { expireLe: 1 }, { expireAfterSeconds: 0 });
const INDEX = Object.freeze([
    I('comptes', 'comptes_emailCle', { emailCle: 1 }, { unique: true }),
    I('installations', 'installations_jeton', { jetonEmpreinte: 1 }, { unique: true }),
    I('installations', 'installations_compte', { compteId: 1 }),
    I('installations', 'installations_heritage', { heriteEmpreinte: 1 }, { unique: true, partialFilterExpression: { heriteEmpreinte: { $type: 'string' } } }),
    I('codes_liaison', 'codes_empreinte', { codeEmpreinte: 1 }, { unique: true }), TTL('codes_liaison'),
    I('sessions', 'sessions_token', { tokenEmpreinte: 1 }, { unique: true }), TTL('sessions'),
    I('liens_email', 'liens_empreinte', { empreinte: 1 }, { unique: true }), TTL('liens_email'),
    I('mouvements', 'mouvements_cle', { cleIdempotence: 1 }, { unique: true, partialFilterExpression: { cleIdempotence: { $type: 'string' } } }),
    I('mouvements', 'mouvements_compte', { compteId: 1, le: -1 }), I('mouvements', 'mouvements_installation', { installationId: 1, le: -1 }), TTL('mouvements'),
    I('hebdo', 'hebdo_cle', { compteId: 1, semaine: 1 }, { unique: true }), TTL('hebdo'),
    I('plafonds', 'plafonds_cle', { porteur: 1, jour: 1, type: 1 }, { unique: true }), TTL('plafonds'),
    I('questions', 'questions_etat', { etat: 1, poseeLe: 1 }),
    // O5 : la marque de livraison d'un scan (v2/argent/marque-scan.js). (etat, ouverteLe) sert la passe de rattrapage et la réconciliation ; le TTL ne porte que sur les marques CLOSES (une marque non close n'a pas d'expireLe).
    I('scans_en_cours', 'scans_etat', { etat: 1, ouverteLe: 1 }), TTL('scans_en_cours'),
    I('analyses', 'analyses_porteur', { porteur: 1, creeLe: -1 }), TTL('analyses'),
    TTL('annonces'),
    I('idempotence', 'idempotence_cle', { cle: 1 }, { unique: true }), TTL('idempotence'),
    I('limites', 'limites_cle', { cle: 1 }, { unique: true }), TTL('limites'),
    // B6.4 : PAS de TTL sur banc_lignes. La purge (v2/banc/purge.js) est le SEUL effaceur : Mongo supprimerait la ligne avant que la purge ait effacé son objet R2
    // (objets d'abord, lignes ensuite) et l'objet resterait orphelin, hors rétention. Un index simple sur expireLe sert la requête de la purge.
    I('banc_lignes', 'banc_jeton', { jetonEmpreinte: 1 }), I('banc_lignes', 'banc_lignes_expire', { expireLe: 1 }),
    I('taux', 'taux_cle', { devise: 1, date: 1 }, { unique: true }),
    // lot B2 : HMAC de l'emailCle d'un compte qui a reçu ses offertes, conservé après la suppression du compte
    I('adresses_octroyees', 'adresses_empreinte', { empreinte: 1 }, { unique: true }), TTL('adresses_octroyees'),
    // lot COLLECTION : un document par (compte, set) ; l'unicité sert l'upsert et l'isolement, et son préfixe `compteId` sert le compte, la suppression et les bornes. Pas de TTL : la collection d'un compte est son bien.
    I('collection_fiches', 'collection_cle', { compteId: 1, set: 1 }, { unique: true }),
    // lot COLLECTION : le compteur GLOBAL de clés ({ cle: 'collection-cles', n }), un document ; l'unicité de `cle` fait échouer en 11000 la création simultanée du compteur
    I('compteurs', 'compteurs_cle', { cle: 1 }, { unique: true })
]);

// `collections` : liste de noms (seuls leurs index sont créés) ; absente = tout le socle. `colFn` est injectable pour les bancs.
async function creerIndex(collections, colFn = col) {
    const choisis = Array.isArray(collections) ? INDEX.filter(i => collections.includes(i.c)) : INDEX;
    for (const i of choisis) await colFn(i.c).createIndex(i.cle, i.opts);
    return choisis.length;
}
// Les propriétés qu'un index GARANTIT : c'est elles qu'on compare, jamais le seul nom (un index de même nom, non unique ou sans TTL,
// ne garantit rien). Retourne la liste des propriétés qui diffèrent (vide = conforme).
const sig = x => JSON.stringify(x === undefined ? null : x);
function ecarts(declare, present) {
    const e = [];
    if (sig(Object.entries(present.key)) !== sig(Object.entries(declare.cle))) e.push('key');
    if (Boolean(present.unique) !== Boolean(declare.opts.unique)) e.push('unique');
    if (sig(present.expireAfterSeconds) !== sig(declare.opts.expireAfterSeconds)) e.push('expireAfterSeconds');
    if (sig(present.partialFilterExpression) !== sig(declare.opts.partialFilterExpression)) e.push('partialFilterExpression');
    return e;
}
async function verifierIndex() {
    const manquants = [];
    for (const i of INDEX) {
        let presents = [];
        try { presents = await col(i.c).indexes(); } catch (e) { if (e.codeName !== 'NamespaceNotFound' && e.code !== 26) throw e; }
        const p = presents.find(x => x.name === i.opts.name);
        if (!p) { manquants.push(`${i.c}.${i.opts.name}`); continue; }
        const diff = ecarts(i, p);
        if (diff.length) manquants.push(`${i.c}.${i.opts.name} (forme fausse : ${diff.join(', ')})`);
    }
    return { manquants };
}

const maintenant = () => new Date();
const nouveauCompte = ({ email, emailCle, motDePasse, now = maintenant() }) => ({
    _id: new (require('mongoose').Types.ObjectId)(), email, emailCle, motDePasse, verifie: false, verifieLe: null, creeLe: now,
    offertesAccordeesLe: null, solde: { accueil: 0, achete: 0 }, generation: 0,   // O3 tour 2 : incrémentée par la réinitialisation ; session, code de liaison et installation liée la portent
    abonnement: { actif: false, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: null }, stripeClient: null, derniereConnexionLe: null
});
const nouvelleInstallation = ({ jetonEmpreinte, essais, libelle, now = maintenant() }) => ({
    _id: crypto.randomBytes(16).toString('hex'), jetonEmpreinte, compteId: null, essais, libelle, creeLe: now, lieeLe: null, revoqueeLe: null,
    heriteEmpreinte: null, derniereAnalyseLe: null, achete: 0, generation: 0   // O3 tour 2 : la liaison y pose la génération du code ; sans égalité avec celle du compte, l'installation est anonyme
});
module.exports = { INDEX, creerIndex, verifierIndex, nouveauCompte, nouvelleInstallation };
