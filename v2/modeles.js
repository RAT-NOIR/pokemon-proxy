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
    I('analyses', 'analyses_porteur', { porteur: 1, creeLe: -1 }), TTL('analyses'),
    TTL('annonces'),
    I('idempotence', 'idempotence_cle', { cle: 1 }, { unique: true }), TTL('idempotence'),
    I('limites', 'limites_cle', { cle: 1 }, { unique: true }), TTL('limites'),
    I('banc_lignes', 'banc_jeton', { jetonEmpreinte: 1 }), TTL('banc_lignes'),
    I('visuels', 'visuels_produit', { idProduct: 1 }, { unique: true }),
    I('taux', 'taux_cle', { devise: 1, date: 1 }, { unique: true })
]);

async function creerIndex() {
    for (const i of INDEX) await col(i.c).createIndex(i.cle, i.opts);
    return INDEX.length;
}
async function verifierIndex() {
    const manquants = [];
    for (const i of INDEX) {
        let presents = [];
        try { presents = (await col(i.c).indexes()).map(x => x.name); } catch (e) { if (e.codeName !== 'NamespaceNotFound' && e.code !== 26) throw e; }
        if (!presents.includes(i.opts.name)) manquants.push(`${i.c}.${i.opts.name}`);
    }
    return { manquants };
}

const maintenant = () => new Date();
const nouveauCompte = ({ email, emailCle, motDePasse, now = maintenant() }) => ({
    _id: new (require('mongoose').Types.ObjectId)(), email, emailCle, motDePasse, verifie: false, verifieLe: null, creeLe: now,
    offertesAccordeesLe: null, solde: { accueil: 0, achete: 0 },
    abonnement: { actif: false, quotaMensuel: 0, moisCle: null, restant: 0, jusquAu: null }, stripeClient: null, derniereConnexionLe: null
});
const nouvelleInstallation = ({ jetonEmpreinte, essais, libelle, now = maintenant() }) => ({
    _id: crypto.randomBytes(16).toString('hex'), jetonEmpreinte, compteId: null, essais, libelle, creeLe: now, lieeLe: null, revoqueeLe: null,
    heriteEmpreinte: null, derniereAnalyseLe: null, achete: 0
});
module.exports = { INDEX, creerIndex, verifierIndex, nouveauCompte, nouvelleInstallation };
