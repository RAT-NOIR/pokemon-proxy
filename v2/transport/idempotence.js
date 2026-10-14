'use strict';
// Idempotency-Key — un rejeu rend la MÊME réponse, sans second débit. Un défaut ici double un débit.
// À monter APRÈS resoudrePorteur : la clé stockée est `porteur|route|valeur`, deux porteurs ne partagent jamais une clé.
// Écrite par ce qu'elle AUTORISE : la route ne s'exécute que si ce processus a GAGNÉ le claim (insertion unique, ou reprise
// conditionnelle d'un claim EXPIRÉ). Tout le reste — autre claim vivant, doute, panne de base — ne l'exécute pas.
const crypto = require('crypto');
const { col } = require('../db');
const { repondreErreur } = require('../erreurs');
const scelle = require('./scelle');

const FORME = /^[A-Za-z0-9_-]{8,64}$/;

function canonique(x) {
    if (Array.isArray(x)) return `[${x.map(canonique).join(',')}]`;
    if (x && typeof x === 'object') return `{${Object.keys(x).sort().map(k => `${JSON.stringify(k)}:${canonique(x[k])}`).join(',')}}`;
    return JSON.stringify(x === undefined ? null : x);
}
const empreinteDuCorps = corps => crypto.createHash('sha256').update(canonique(corps === undefined ? {} : corps)).digest('hex');
const journal = (e, ou) => console.error(`❌ [v2 idempotence ${ou}] ${e && (e.code || e.name) || 'erreur'}`);   // jamais e.message : une erreur E11000 cite la clé

function porteurDe(req) {
    const p = req.v2 && (req.v2.porteur || req.v2);
    return p && p.type && p.id ? `${p.type}:${p.id}` : null;
}

async function reclamer(cle, empreinteCorps, maintenant, cfg) {
    const proprietaire = crypto.randomBytes(8).toString('hex');
    const frais = () => ({ empreinteCorps, etat: 'en-cours', proprietaire, creeLe: maintenant, expireLe: new Date(maintenant.getTime() + cfg.retention.idempotenceEnCoursMinutes * 60000) });
    for (let essai = 0; essai < 3; essai++) {
        try { await col('idempotence').insertOne({ cle, ...frais() }); return { gagne: true, proprietaire }; }
        catch (e) { if (e.code !== 11000) throw e; }
        // un claim EXPIRÉ (processus tué, ou TTL de Mongo pas encore passé) se reprend, atomiquement et seulement s'il est expiré
        const repris = await col('idempotence').findOneAndUpdate({ cle, expireLe: { $lte: maintenant } },
            { $set: frais(), $unset: { statut: '', reponse: '' } }, { returnDocument: 'after' });
        if (repris) return { gagne: true, proprietaire };
        const existant = await col('idempotence').findOne({ cle });
        if (existant) return { gagne: false, existant };
        // le claim a disparu entre-temps (route en échec) : on retente
    }
    throw new Error('claim impossible');
}

/** @returns middleware Express
 *  `porteur` (facultatif) : fonction (req) → texte, pour une route SANS porteur résolu (POST /api/installation : personne n'a encore de jeton). Sans lui : le porteur de la requête.
 *  `sceller` (facultatif) : la réponse conservée est SCELLÉE (transport/scelle.js) — pour une réponse qui porte un jeton, jamais en clair dans la base ; rejouée, elle est ouverte,
 *  et un scellé illisible ne se rejoue pas ET ne s'exécute pas de nouveau (503). */
function idempotente(route, { obligatoire = true, porteur: porteurRoute = null, sceller = false, forme = FORME } = {}, cfg) {
    const dureeFiniMs = cfg.retention.idempotenceHeures * 3600000;
    const secret = cfg.empreinte && cfg.empreinte.secret;
    if (sceller && (typeof secret !== 'string' || secret.length < 16)) throw new Error('idempotente : sceller exige cfg.empreinte.secret');
    return async function idempotenceV2(req, res, next) {
        try {
            const brute = req.headers['idempotency-key'];
            if (brute === undefined) {
                if (!obligatoire) return next();
                return repondreErreur(res, 'ENTREE', 'En-tête Idempotency-Key requis');
            }
            if (typeof brute !== 'string' || !forme.test(brute)) return repondreErreur(res, 'ENTREE', 'Idempotency-Key invalide', forme === FORME ? {} : { detail: 'cle-trop-courte' });
            const porteur = porteurRoute ? porteurRoute(req) : porteurDe(req);
            if (!porteur) return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');   // on ne partage jamais une clé entre inconnus
            const cle = `${porteur}|${route}|${brute}`, empreinteCorps = empreinteDuCorps(req.body), maintenant = new Date();

            const r = await reclamer(cle, empreinteCorps, maintenant, cfg);
            if (!r.gagne) {
                const ex = r.existant;
                if (ex.empreinteCorps !== empreinteCorps) return repondreErreur(res, 'ENTREE', 'Cette Idempotency-Key a déjà servi avec un autre contenu', { detail: 'cle-reutilisee' }, 422);
                if (ex.etat === 'fini' && typeof ex.reponse === 'string') {
                    let corps = ex.reponse;
                    if (sceller) {
                        try { corps = scelle.ouvrir(corps, secret, cle); }
                        catch (e) { journal(e, 'ouverture'); return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible'); }   // jamais de nouvelle exécution : l'effet a déjà eu lieu
                        res.set('Cache-Control', 'no-store');
                    }
                    return res.status(ex.statut).set('Idempotency-Replayed', 'true').type('application/json').send(corps);
                }
                return repondreErreur(res, 'DEBIT', 'Requête identique en cours de traitement', { reessayerDans: 2 });   // 2 s : le claim vit 2 min, mais le client doit réessayer vite
            }

            const filtre = { cle, proprietaire: r.proprietaire };
            let fini = false, viaJson = false;
            // BATTEMENT : tant que la route n'a pas répondu, le claim est repoussé par son propriétaire (updateOne SANS upsert : un claim
            // repris par un autre n'est jamais recréé). Sans lui, une route plus longue que la fenêtre verrait son claim repris et ré-exécutée.
            const fenetreMs = cfg.retention.idempotenceEnCoursMinutes * 60000;
            // Il s'arrête dans TOUS les cas : réponse, finish, close (client coupé), et au plafond de durée totale (route muette).
            // Ensuite le claim n'est PAS supprimé mais laissé expirer (≤ fenêtre) : la route a pu débiter avant la coupure, la libérer tout de suite
            // permettrait un second débit concurrent ; B3 (mouvements.cleIdempotence) borne de toute façon le débit en base.
            const plafondMs = (cfg.retention.idempotenceBattementMaxMinutes ?? 10) * 60000, debutBattement = Date.now();   // 10 min par défaut ; à ajouter au socle
            const battement = setInterval(() => {
                if (Date.now() - debutBattement >= plafondMs) return clearInterval(battement);
                col('idempotence').updateOne({ ...filtre, etat: 'en-cours' }, { $set: { expireLe: new Date(Date.now() + fenetreMs) } }).catch(e => journal(e, 'battement'));
            }, cfg.retention.idempotenceBattementMs ?? 30000);   // 30 s par défaut ; à ajouter au socle : config.retention.idempotenceBattementMs
            battement.unref();
            const origJson = res.json, origSend = res.send;
            res.json = function (corps) { viaJson = true; return origJson.call(this, corps); };
            res.send = function (corps) {
                if (!viaJson || fini || typeof corps !== 'string') return origSend.call(this, corps);
                fini = true; clearInterval(battement); res.json = origJson; res.send = origSend;
                const statut = this.statusCode;
                const travail = statut < 300
                    ? col('idempotence').updateOne(filtre, { $set: { etat: 'fini', statut, reponse: sceller ? scelle.fermer(corps, secret, cle) : corps, expireLe: new Date(Date.now() + dureeFiniMs) } })
                    : col('idempotence').deleteOne(filtre);          // une panne ou un QUOTA n'est jamais rejoué figé
                travail.catch(e => journal(e, 'fin')).then(() => origSend.call(this, corps));   // le rejeu doit trouver le résultat DÈS que le client a la réponse
                return this;
            };
            // LIBÉRATION du claim (la seule : celle des échecs ci-dessous, aussi offerte à une route qui n'a RIEN exécuté — `req.idempotence.liberer()`, p. ex. le scanner dont
            // le client a coupé avant le traitement) : le battement s'arrête et le claim est supprimé, la clé redevient rejouable. Filtre = propriétaire : jamais le claim d'un autre.
            const liberer = () => { clearInterval(battement); return col('idempotence').deleteOne(filtre).catch(e => journal(e, 'nettoyage')); };
            req.idempotence = { liberer, cle };         // O5 : la clé du claim, que la marque de livraison d'un scan range pour retrouver la réponse stockée
            res.on('close', () => clearInterval(battement));
            res.on('finish', () => {                                // réponse sans res.json : en échec, le claim part ; en succès, il reste (2 min) : jamais de double exécution
                clearInterval(battement);
                if (!fini && res.statusCode >= 300) liberer();
            });
            next();
        } catch (e) {
            journal(e, 'claim');
            if (!res.headersSent) repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');   // fail-closed : sans claim, pas d'exécution
        }
    };
}
const FORME_FORTE = /^[A-Za-z0-9_-]{32,64}$/;   // une clé qui tient lieu de secret (POST /api/installation) : 32 caractères au moins
module.exports = { idempotente, FORME, FORME_FORTE, empreinteDuCorps };
