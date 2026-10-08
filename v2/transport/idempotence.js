'use strict';
// Idempotency-Key — un rejeu rend la MÊME réponse, sans second débit. Un défaut ici double un débit.
// À monter APRÈS resoudrePorteur : la clé stockée est `porteur|route|valeur`, deux porteurs ne partagent jamais une clé.
// Écrite par ce qu'elle AUTORISE : la route ne s'exécute que si ce processus a GAGNÉ le claim (insertion unique, ou reprise
// conditionnelle d'un claim EXPIRÉ). Tout le reste — autre claim vivant, doute, panne de base — ne l'exécute pas.
const crypto = require('crypto');
const { col } = require('../db');
const { repondreErreur } = require('../erreurs');

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

/** @returns middleware Express */
function idempotente(route, { obligatoire = true } = {}, cfg) {
    const dureeFiniMs = cfg.retention.idempotenceHeures * 3600000;
    return async function idempotenceV2(req, res, next) {
        try {
            const brute = req.headers['idempotency-key'];
            if (brute === undefined) {
                if (!obligatoire) return next();
                return repondreErreur(res, 'ENTREE', 'En-tête Idempotency-Key requis');
            }
            if (typeof brute !== 'string' || !FORME.test(brute)) return repondreErreur(res, 'ENTREE', 'Idempotency-Key invalide');
            const porteur = porteurDe(req);
            if (!porteur) return repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');   // on ne partage jamais une clé entre inconnus
            const cle = `${porteur}|${route}|${brute}`, empreinteCorps = empreinteDuCorps(req.body), maintenant = new Date();

            const r = await reclamer(cle, empreinteCorps, maintenant, cfg);
            if (!r.gagne) {
                const ex = r.existant;
                if (ex.empreinteCorps !== empreinteCorps) return repondreErreur(res, 'ENTREE', 'Cette Idempotency-Key a déjà servi avec un autre contenu', { detail: 'cle-reutilisee' }, 422);
                if (ex.etat === 'fini' && typeof ex.reponse === 'string')
                    return res.status(ex.statut).set('Idempotency-Replayed', 'true').type('application/json').send(ex.reponse);
                return repondreErreur(res, 'DEBIT', 'Requête identique en cours de traitement', { reessayerDans: 2 });   // 2 s : le claim vit 2 min, mais le client doit réessayer vite
            }

            const filtre = { cle, proprietaire: r.proprietaire };
            let fini = false, viaJson = false;
            // BATTEMENT : tant que la route n'a pas répondu, le claim est repoussé par son propriétaire (updateOne SANS upsert : un claim
            // repris par un autre n'est jamais recréé). Sans lui, une route plus longue que la fenêtre verrait son claim repris et ré-exécutée.
            const fenetreMs = cfg.retention.idempotenceEnCoursMinutes * 60000;
            const battement = setInterval(() => {
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
                    ? col('idempotence').updateOne(filtre, { $set: { etat: 'fini', statut, reponse: corps, expireLe: new Date(Date.now() + dureeFiniMs) } })
                    : col('idempotence').deleteOne(filtre);          // une panne ou un QUOTA n'est jamais rejoué figé
                travail.catch(e => journal(e, 'fin')).then(() => origSend.call(this, corps));   // le rejeu doit trouver le résultat DÈS que le client a la réponse
                return this;
            };
            res.on('finish', () => {                                  // réponse sans res.json : en échec, le claim part ; en succès, il reste (2 min) : jamais de double exécution
                clearInterval(battement);
                if (!fini && res.statusCode >= 300) col('idempotence').deleteOne(filtre).catch(e => journal(e, 'nettoyage'));
            });
            next();
        } catch (e) {
            journal(e, 'claim');
            if (!res.headersSent) repondreErreur(res, 'INDISPONIBLE', 'Service momentanément indisponible');   // fail-closed : sans claim, pas d'exécution
        }
    };
}
module.exports = { idempotente, FORME, empreinteDuCorps };
