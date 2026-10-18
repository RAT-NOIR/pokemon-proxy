'use strict';
// INDEX-EMPREINTES — GET /api/modele-empreinte/<sha256> : sert le FICHIER du modèle d'empreinte (ONNX poids 8 bits, ≈ 113 Mo) à l'extension, depuis le bucket R2 PRIVÉ de l'essai (aucun bucket public n'est ouvert).
// Écrit par ce qu'elle AUTORISE :
//   · monté SEULEMENT si V2_EMPREINTE_EXTENSION=1 (éteint : la route n'existe pas, 404 comme toute route inconnue) ;
//   · UN seul chemin mène à un octet : le sha256 de l'adresse est exactement celui de la configuration (V2_MODELE_EMPREINTE_SHA256, le sha256 du FICHIER), sinon 404 — l'API n'en sert qu'UN ;
//   · l'objet doit porter ce même sha256 dans ses métadonnées (x-amz-meta-sha256, posé par le dépôt) ET la taille configurée (V2_MODELE_EMPREINTE_OCTETS) : sinon 502, aucun octet envoyé ;
//   · un flux (jamais le fichier en mémoire), au plus MAX_FLUX envois à la fois par processus (le reste : 503 + Retry-After), un limiteur par IP posé au montage (monter.js) ;
//   · Range : UNE plage simple (a-b, a-, -n) ; plusieurs plages ou une forme illisible : ignorées (réponse entière, 200) ; hors du fichier : 416.
// La VÉRIFICATION de l'intégrité du fichier reçu est celle de l'extension (sha256 du fichier contre celui du contrat) : le serveur ne peut pas hacher un flux avant d'envoyer son premier octet.
const fs = require('fs');
const { pipeline } = require('stream');
const R2 = require('../chargeur/r2-prive');

const MAX_FLUX = 4;
const CACHE = 'public, max-age=31536000, immutable';
const NOMS_R2 = Object.freeze(['V2_VISUELS_R2_COMPTE', 'V2_VISUELS_R2_CLE_ID', 'V2_VISUELS_R2_SECRET', 'V2_VISUELS_R2_BUCKET']);
const SHA = /^[0-9a-f]{64}$/;
let enCours = 0;

/** Une plage simple. @returns {{ type: 'aucune' } | { type: 'ok', debut: number, fin: number } | { type: 'hors' }} — 'aucune' = ignorer l'en-tête (réponse entière). */
function lirePlage(entete, taille) {
    if (typeof entete !== 'string' || entete === '') return { type: 'aucune' };
    const m = /^bytes=(\d*)-(\d*)$/.exec(entete.trim());
    if (!m || (m[1] === '' && m[2] === '')) return { type: 'aucune' };      // plusieurs plages, autre unité, forme illisible : ignorée
    if (m[1] === '') {                                                       // les n derniers octets
        const n = Number(m[2]);
        if (!Number.isSafeInteger(n) || n <= 0) return { type: 'hors' };
        return { type: 'ok', debut: Math.max(0, taille - n), fin: taille - 1 };
    }
    const debut = Number(m[1]), fin = m[2] === '' ? taille - 1 : Number(m[2]);
    if (!Number.isSafeInteger(debut) || !Number.isSafeInteger(fin)) return { type: 'aucune' };
    if (debut >= taille) return { type: 'hors' };
    if (fin < debut) return { type: 'aucune' };                              // « bytes=5-2 » est illisible, pas hors du fichier (RFC 9110 §14.1.2)
    return { type: 'ok', debut, fin: Math.min(fin, taille - 1) };
}

function erreur(res, statut, message, extra = {}) {
    if (extra.retryApres !== undefined) res.setHeader('Retry-After', String(extra.retryApres));
    if (extra.contentRange) res.setHeader('Content-Range', extra.contentRange);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(statut).json({ success: false, error: message });
}

/** La source du fichier : le fichier de banc (SEULEMENT en mode banc, cfg.modeleEmpreinte.fichierModeleBanc) ou l'objet R2 privé. null + raison si la configuration ne permet rien. */
function creerSource(cfg, { client = null, env = process.env } = {}) {
    const m = cfg.modeleEmpreinte || {};
    if (m.fichierModeleBanc) {
        return { async decrire() { return { taille: fs.statSync(m.fichierModeleBanc).size, sha256: m.sha256 }; }, ouvrir(debut, fin) { return fs.createReadStream(m.fichierModeleBanc, { start: debut, end: fin }); } };
    }
    const manque = [...NOMS_R2.filter(n => !(typeof env[n] === 'string' && env[n].trim())), ...(m.objetModele ? [] : ['V2_MODELE_EMPREINTE_OBJET'])];
    if (manque.length) return { raison: `variables absentes : ${manque.join(', ')}` };
    let cl = client;
    const bucket = String(env.V2_VISUELS_R2_BUCKET).trim();
    const cree = () => { if (!cl) cl = R2.creerClient({ compte: String(env.V2_VISUELS_R2_COMPTE).trim(), cleId: String(env.V2_VISUELS_R2_CLE_ID).trim(), secret: String(env.V2_VISUELS_R2_SECRET).trim(), endpoint: env.V2_VISUELS_R2_ENDPOINT || undefined }); return cl; };
    return {
        async decrire() {
            const { HeadObjectCommand } = require('@aws-sdk/client-s3');
            const r = await cree().send(new HeadObjectCommand({ Bucket: bucket, Key: m.objetModele }), { abortSignal: AbortSignal.timeout(R2.DELAI_MS) });
            return { taille: Number(r.ContentLength), sha256: r.Metadata && r.Metadata.sha256 };
        },
        async ouvrir(debut, fin) {
            const { GetObjectCommand } = require('@aws-sdk/client-s3');
            const r = await cree().send(new GetObjectCommand({ Bucket: bucket, Key: m.objetModele, Range: `bytes=${debut}-${fin}` }), { abortSignal: AbortSignal.timeout(R2.DELAI_MS) });
            return r.Body;
        }
    };
}

/** Le gestionnaire Express. `deps` ne règle que les injections des bancs (client S3, environnement, plafond de flux). */
function creerRoute(cfg, deps = {}) {
    const maxFlux = Number.isInteger(deps.maxFlux) && deps.maxFlux > 0 ? deps.maxFlux : MAX_FLUX;
    const source = creerSource(cfg, deps);
    return async function modeleEmpreinte(req, res) {
        const m = cfg.modeleEmpreinte || {};
        const sha = req.params && req.params.sha256;
        if (!m.sha256 || typeof sha !== 'string' || !SHA.test(sha) || sha !== m.sha256) return erreur(res, 404, 'Introuvable');
        if (source.raison) { console.error(`❌ [v2 modèle-empreinte] non servi (${source.raison})`); return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 300 }); }
        if (enCours >= maxFlux) return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 30 });
        enCours++;
        let libere = false;
        const liberer = () => { if (!libere) { libere = true; enCours--; } };
        try {
            let d;
            try { d = await source.decrire(); }
            catch (e) { console.error(`❌ [v2 modèle-empreinte] lecture impossible (${(e && (e.name || e.code)) || 'erreur'})`); liberer(); return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 60 }); }
            if (!Number.isSafeInteger(d.taille) || d.taille <= 0 || d.sha256 !== m.sha256 || (m.octets && d.taille !== m.octets)) {
                console.error('❌ [v2 modèle-empreinte] l\'objet ne correspond pas à la configuration (taille ou sha256) : rien n\'est envoyé');
                liberer(); return erreur(res, 502, 'Fichier indisponible');
            }
            res.setHeader('Accept-Ranges', 'bytes');
            res.setHeader('Cache-Control', CACHE);
            res.setHeader('ETag', `"${sha}"`);
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            if (req.headers['if-none-match'] === `"${sha}"`) { liberer(); return res.status(304).end(); }
            const p = lirePlage(req.headers.range, d.taille);
            if (p.type === 'hors') { liberer(); res.setHeader('Content-Range', `bytes */${d.taille}`); res.setHeader('Cache-Control', 'no-store'); return res.status(416).json({ success: false, error: 'Plage hors du fichier' }); }
            const debut = p.type === 'ok' ? p.debut : 0, fin = p.type === 'ok' ? p.fin : d.taille - 1;
            res.setHeader('Content-Length', String(fin - debut + 1));
            if (p.type === 'ok') res.setHeader('Content-Range', `bytes ${debut}-${fin}/${d.taille}`);
            res.status(p.type === 'ok' ? 206 : 200);
            if (req.method === 'HEAD') { liberer(); return res.end(); }
            let flux;
            try { flux = await source.ouvrir(debut, fin); }
            catch (e) { console.error(`❌ [v2 modèle-empreinte] ouverture impossible (${(e && (e.name || e.code)) || 'erreur'})`); liberer(); res.removeHeader('Content-Length'); res.removeHeader('Content-Range'); res.removeHeader('ETag'); return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 60 }); }
            res.on('close', liberer);
            pipeline(flux, res, err => { if (err) { console.error(`❌ [v2 modèle-empreinte] envoi interrompu (${(err && (err.code || err.name)) || 'erreur'})`); } liberer(); });
        } catch (e) {
            liberer();
            console.error(`❌ [v2 modèle-empreinte] ${(e && (e.code || e.name)) || 'erreur'}`);
            if (!res.headersSent) return erreur(res, 503, 'Service momentanément indisponible', { retryApres: 60 });
            res.destroy();
        }
    };
}

module.exports = { creerRoute, creerSource, lirePlage, MAX_FLUX, CACHE, NOMS_R2, fluxEnCours: () => enCours };
